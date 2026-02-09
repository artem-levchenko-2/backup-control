/**
 * Background scheduler — checks every 60 seconds which jobs need to run
 * based on their schedule string, then triggers them via the local API.
 */

import { getAllJobs, getSetting } from "./db";
import type { Job } from "./types";

const CHECK_INTERVAL_MS = 60_000; // 1 minute
let intervalId: ReturnType<typeof setInterval> | null = null;

// Track jobs we've already triggered this cycle to avoid double-fire
const recentlyTriggered = new Map<number, number>(); // jobId -> timestamp

export function startScheduler(): void {
  if (intervalId) return; // already running

  console.log("[scheduler] Starting background scheduler (checking every 60s)");

  // Initial check after 15s to let the server fully boot
  setTimeout(() => {
    checkAndRun();
    intervalId = setInterval(checkAndRun, CHECK_INTERVAL_MS);
  }, 15_000);
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[scheduler] Stopped");
  }
}

async function checkAndRun(): Promise<void> {
  try {
    const jobs = getAllJobs();
    const tz = getSetting("timezone") || "UTC";

    for (const job of jobs) {
      if (!job.enabled) continue;
      if (!job.schedule) continue;
      if (!job.source_path || !job.destination_path) continue;

      // Skip if we triggered this job within the last 5 minutes
      const lastTriggered = recentlyTriggered.get(job.id) || 0;
      if (Date.now() - lastTriggered < 5 * 60_000) continue;

      if (isDue(job, tz)) {
        console.log(`[scheduler] Job "${job.name}" (id=${job.id}) is due — triggering`);
        recentlyTriggered.set(job.id, Date.now());
        await triggerJob(job.id);
      }
    }
  } catch (err) {
    console.error("[scheduler] Error during check:", err);
  }
}

function isDue(job: Job, tz: string): boolean {
  const schedule = job.schedule.trim();

  // Get current time in the configured timezone
  const now = new Date();
  const nowInTz = getTimeInTz(now, tz);

  // Parse "daily HH:MM"
  const dailyMatch = schedule.match(/^daily\s+(\d{1,2}):(\d{2})$/i);
  if (dailyMatch) {
    const targetHour = parseInt(dailyMatch[1], 10);
    const targetMinute = parseInt(dailyMatch[2], 10);

    // Today's target time in UTC
    const targetUTC = tzDateToUTC(nowInTz.year, nowInTz.month - 1, nowInTz.day, targetHour, targetMinute, tz);

    // Not yet time today
    if (now.getTime() < targetUTC) return false;

    // Already ran since today's target? Then not due.
    return !hasRunSince(job.id, targetUTC);
  }

  // Parse "every Nh"
  const everyMatch = schedule.match(/^every\s+(\d+)h$/i);
  if (everyMatch) {
    const intervalHours = parseInt(everyMatch[1], 10);
    const intervalMs = intervalHours * 60 * 60 * 1000;

    const lastRunTime = getLastRunTime(job.id);
    if (!lastRunTime) return true; // Never ran — due now

    return (now.getTime() - lastRunTime) >= intervalMs;
  }

  // Parse "weekly DAY HH:MM"
  const weeklyMatch = schedule.match(/^weekly\s+(\w+)\s+(\d{1,2}):(\d{2})$/i);
  if (weeklyMatch) {
    const targetDay = parseDayOfWeek(weeklyMatch[1]);
    const targetHour = parseInt(weeklyMatch[2], 10);
    const targetMinute = parseInt(weeklyMatch[3], 10);

    if (targetDay < 0) return false; // Invalid day

    // Only trigger on the correct day of week
    if (nowInTz.dayOfWeek !== targetDay) return false;

    const targetUTC = tzDateToUTC(nowInTz.year, nowInTz.month - 1, nowInTz.day, targetHour, targetMinute, tz);

    if (now.getTime() < targetUTC) return false;

    return !hasRunSince(job.id, targetUTC);
  }

  // Unknown schedule format — skip
  return false;
}

// ── Helpers for timezone handling ────────────────────────────

interface TzTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
}

function getTimeInTz(date: Date, tz: string): TzTime {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      weekday: "short",
    }).formatToParts(date);

    const get = (type: string) => parts.find((p) => p.type === type)?.value || "";

    const weekdayStr = get("weekday");
    const dayOfWeekMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };

    return {
      year: parseInt(get("year"), 10),
      month: parseInt(get("month"), 10),
      day: parseInt(get("day"), 10),
      hour: parseInt(get("hour"), 10) % 24, // handle "24" → 0
      minute: parseInt(get("minute"), 10),
      second: parseInt(get("second"), 10),
      dayOfWeek: dayOfWeekMap[weekdayStr] ?? date.getDay(),
    };
  } catch {
    // Fallback to UTC if timezone is invalid
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      dayOfWeek: date.getUTCDay(),
    };
  }
}

/**
 * Convert a date/time in a specific timezone to a UTC millisecond timestamp.
 */
function tzDateToUTC(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  // Create a date string and use the timezone to figure out the offset
  // We use a reference date to calculate the offset
  const refDate = new Date(Date.UTC(year, month, day, hour, minute, 0));

  try {
    // Get what time it is in the target timezone at our reference UTC time
    const tzParts = getTimeInTz(refDate, tz);

    // The offset (in minutes) is: tzTime - utcTime
    const tzMinutes = tzParts.hour * 60 + tzParts.minute;
    const utcMinutes = refDate.getUTCHours() * 60 + refDate.getUTCMinutes();
    let offsetMinutes = tzMinutes - utcMinutes;

    // Handle day boundary
    if (offsetMinutes > 720) offsetMinutes -= 1440;
    if (offsetMinutes < -720) offsetMinutes += 1440;

    // The actual UTC time = local time - offset
    return Date.UTC(year, month, day, hour, minute, 0) - offsetMinutes * 60_000;
  } catch {
    return Date.UTC(year, month, day, hour, minute, 0);
  }
}

function parseDayOfWeek(day: string): number {
  const map: Record<string, number> = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tuesday: 2,
    wed: 3, wednesday: 3,
    thu: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  return map[day.toLowerCase()] ?? -1;
}

// ── DB queries for scheduler ─────────────────────────────────

function getLastRunTime(jobId: number): number | null {
  try {
    // Import dynamically to avoid circular dependency issues
    const { getDb } = require("./db");
    const row = getDb()
      .prepare("SELECT started_at FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1")
      .get(jobId) as { started_at: string } | undefined;

    if (!row) return null;

    const dateStr = row.started_at.endsWith("Z") ? row.started_at : row.started_at + "Z";
    return new Date(dateStr).getTime();
  } catch {
    return null;
  }
}

function hasRunSince(jobId: number, sinceTimestamp: number): boolean {
  const lastRun = getLastRunTime(jobId);
  if (!lastRun) return false;
  return lastRun >= sinceTimestamp;
}

// ── Trigger a job via the local API ──────────────────────────

async function triggerJob(jobId: number): Promise<void> {
  const port = process.env.PORT || 3000;
  const url = `http://localhost:${port}/api/jobs/${jobId}/run`;

  try {
    const res = await fetch(url, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      console.log(`[scheduler] Job ${jobId} triggered: ${data.message}`);
    } else {
      console.error(`[scheduler] Job ${jobId} trigger failed: ${data.error}`);
    }
  } catch (err) {
    console.error(`[scheduler] Failed to trigger job ${jobId}:`, err);
  }
}
