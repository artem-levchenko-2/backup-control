/**
 * Background scheduler — checks every 60 seconds which jobs need to run
 * based on their schedule string, then triggers them via the local API.
 */

import { getAllJobs, getSetting, getDb } from "./db";
import type { Job } from "./types";

const CHECK_INTERVAL_MS = 60_000; // 1 minute
let intervalId: ReturnType<typeof setInterval> | null = null;

// Track jobs we've already triggered this cycle to avoid double-fire
const recentlyTriggered = new Map<number, number>(); // jobId → timestamp

export function startScheduler(): void {
  if (intervalId) return; // already running

  console.log("[scheduler] Starting background scheduler (checking every 60s)");

  // Initial check after 30s to let the server fully boot
  setTimeout(() => {
    console.log("[scheduler] First check starting...");
    checkAndRun();
    intervalId = setInterval(checkAndRun, CHECK_INTERVAL_MS);
  }, 30_000);
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[scheduler] Stopped");
  }
}

// ── Main check loop ──────────────────────────────────────────

async function checkAndRun(): Promise<void> {
  try {
    const jobs = getAllJobs();
    const tz = resolveTimezone(getSetting("timezone") || "Europe/Kyiv");
    const nowUTC = Date.now();

    for (const job of jobs) {
      if (!job.enabled) continue;
      if (!job.schedule) continue;
      if (!job.source_path || !job.destination_path) continue;

      // Skip if we triggered this job within the last 10 minutes
      const lastTriggered = recentlyTriggered.get(job.id) || 0;
      if (nowUTC - lastTriggered < 10 * 60_000) continue;

      // Skip if the job already has a "running" status in the DB
      if (isJobRunning(job.id)) continue;

      const result = isDue(job, tz, nowUTC);

      if (result.due) {
        console.log(
          `[scheduler] TRIGGERING job "${job.name}" (id=${job.id}) ` +
          `| schedule="${job.schedule}" | reason: ${result.reason}`
        );
        recentlyTriggered.set(job.id, nowUTC);
        await triggerJob(job.id);
      }
    }
  } catch (err) {
    console.error("[scheduler] Error during check:", err);
  }
}

// ── Is a job due? ────────────────────────────────────────────

interface DueResult {
  due: boolean;
  reason: string;
}

function isDue(job: Job, tz: string, nowUTC: number): DueResult {
  const schedule = job.schedule.trim();
  const now = new Date(nowUTC);

  // Get current local time in the configured timezone
  const local = getLocalTime(now, tz);

  // ── "daily HH:MM" ──
  const dailyMatch = schedule.match(/^daily\s+(\d{1,2}):(\d{2})$/i);
  if (dailyMatch) {
    const targetH = parseInt(dailyMatch[1], 10);
    const targetM = parseInt(dailyMatch[2], 10);

    // Target time in UTC for TODAY (in the user's timezone)
    const targetUTC = localTimeToUTC(local.year, local.month, local.day, targetH, targetM, tz);

    if (nowUTC < targetUTC) {
      return { due: false, reason: `Not yet ${targetH}:${pad(targetM)} (${tz}), target UTC=${new Date(targetUTC).toISOString()}` };
    }

    const lastRun = getLastRunTimeForJob(job.id);
    if (lastRun !== null && lastRun >= targetUTC) {
      return { due: false, reason: `Already ran since target (lastRun=${new Date(lastRun).toISOString()})` };
    }

    return { due: true, reason: `Daily ${targetH}:${pad(targetM)} — time reached and no run since ${new Date(targetUTC).toISOString()}` };
  }

  // ── "every Nh" ──
  const everyMatch = schedule.match(/^every\s+(\d+)h$/i);
  if (everyMatch) {
    const intervalH = parseInt(everyMatch[1], 10);
    const intervalMs = intervalH * 3600_000;

    const lastRun = getLastRunTimeForJob(job.id);
    if (lastRun === null) {
      return { due: true, reason: `Every ${intervalH}h — never ran before` };
    }

    const elapsed = nowUTC - lastRun;
    if (elapsed >= intervalMs) {
      return { due: true, reason: `Every ${intervalH}h — ${Math.round(elapsed / 60_000)}min since last run` };
    }

    return { due: false, reason: `Every ${intervalH}h — only ${Math.round(elapsed / 60_000)}min since last run (need ${intervalH * 60}min)` };
  }

  // ── "weekly DAY HH:MM" ──
  const weeklyMatch = schedule.match(/^weekly\s+(\w+)\s+(\d{1,2}):(\d{2})$/i);
  if (weeklyMatch) {
    const targetDay = parseDayOfWeek(weeklyMatch[1]);
    const targetH = parseInt(weeklyMatch[2], 10);
    const targetM = parseInt(weeklyMatch[3], 10);

    if (targetDay < 0) {
      return { due: false, reason: `Invalid day of week: ${weeklyMatch[1]}` };
    }

    if (local.dayOfWeek !== targetDay) {
      return { due: false, reason: `Not the right day (today=${local.dayOfWeek}, target=${targetDay})` };
    }

    const targetUTC = localTimeToUTC(local.year, local.month, local.day, targetH, targetM, tz);

    if (nowUTC < targetUTC) {
      return { due: false, reason: `Not yet ${targetH}:${pad(targetM)} on target day` };
    }

    const lastRun = getLastRunTimeForJob(job.id);
    if (lastRun !== null && lastRun >= targetUTC) {
      return { due: false, reason: `Already ran this week` };
    }

    return { due: true, reason: `Weekly — correct day and time reached` };
  }

  return { due: false, reason: `Unknown schedule format: "${schedule}"` };
}

// ── Timezone helpers (simplified & robust) ───────────────────

/**
 * Resolve timezone name — handle "Europe/Kyiv" vs "Europe/Kiev" compatibility.
 */
function resolveTimezone(tz: string): string {
  // Test if the timezone works
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    // Try common aliases
    const aliases: Record<string, string> = {
      "Europe/Kyiv": "Europe/Kiev",
      "Europe/Kiev": "Europe/Kyiv",
    };
    const alias = aliases[tz];
    if (alias) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: alias }).format(new Date());
        console.log(`[scheduler] Timezone "${tz}" not available, using alias "${alias}"`);
        return alias;
      } catch { /* fall through */ }
    }
    console.warn(`[scheduler] Timezone "${tz}" not recognized, falling back to UTC`);
    return "UTC";
  }
}

interface LocalTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
}

function getLocalTime(date: Date, tz: string): LocalTime {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour: parseInt(get("hour"), 10) % 24,
    minute: parseInt(get("minute"), 10),
    dayOfWeek: weekdayMap[get("weekday")] ?? date.getUTCDay(),
  };
}

/**
 * Convert a local time (year, month 1-indexed, day, hour, minute) in a
 * given timezone to a UTC timestamp in milliseconds.
 *
 * Approach: compute the timezone's UTC offset using two toLocaleString calls,
 * then shift the local time accordingly.
 */
function localTimeToUTC(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  // Step 1: Create a probe Date near the target time (use UTC as approximation)
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  // Step 2: Get the timezone offset at that moment
  // Format the probe in UTC and in the target tz, then diff
  const utcStr = probe.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = probe.toLocaleString("en-US", { timeZone: tz });
  const offsetMs = new Date(tzStr).getTime() - new Date(utcStr).getTime();

  // Step 3: target local time "as if UTC" minus offset = actual UTC
  const localAsUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  return localAsUTC - offsetMs;
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

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// ── DB queries ───────────────────────────────────────────────

function getLastRunTimeForJob(jobId: number): number | null {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT started_at FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1")
      .get(jobId) as { started_at: string } | undefined;

    if (!row) return null;

    const dateStr = row.started_at.endsWith("Z") ? row.started_at : row.started_at + "Z";
    const ts = new Date(dateStr).getTime();

    if (isNaN(ts)) {
      console.error(`[scheduler] Invalid started_at for job ${jobId}: "${row.started_at}"`);
      return null;
    }

    return ts;
  } catch (err) {
    console.error(`[scheduler] getLastRunTimeForJob(${jobId}) failed:`, err);
    return null;
  }
}

function isJobRunning(jobId: number): boolean {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT COUNT(*) as count FROM runs WHERE job_id = ? AND status = 'running'")
      .get(jobId) as { count: number };
    return row.count > 0;
  } catch (err) {
    console.error(`[scheduler] isJobRunning(${jobId}) failed:`, err);
    return true; // err on the side of caution — assume running
  }
}

// ── Trigger a job via the local API ──────────────────────────

async function triggerJob(jobId: number): Promise<void> {
  const port = process.env.PORT || 3000;
  const url = `http://localhost:${port}/api/jobs/${jobId}/run`;

  try {
    const res = await fetch(url, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      console.log(`[scheduler] Job ${jobId} triggered successfully: ${data.message}`);
    } else {
      console.error(`[scheduler] Job ${jobId} trigger failed: ${data.error}`);
    }
  } catch (err) {
    console.error(`[scheduler] Failed to trigger job ${jobId}:`, err);
  }
}
