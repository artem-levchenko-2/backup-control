/**
 * Background scheduler — checks every 60 seconds which jobs need to run
 * based on their schedule string, then triggers them via the local API.
 *
 * All time comparisons are done in the user's configured timezone
 * (Settings → Timezone). No complex UTC↔TZ conversion needed.
 */

import { getAllJobs, getSetting, getDb } from "./db";
import type { Job } from "./types";
import { isProcessRunning } from "./process-manager";

const CHECK_INTERVAL_MS = 60_000; // 1 minute
let intervalId: ReturnType<typeof setInterval> | null = null;

// Track jobs we've already triggered this cycle to avoid double-fire
const recentlyTriggered = new Map<number, number>(); // jobId → timestamp(ms)

export function startScheduler(): void {
  if (intervalId) return;

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

// ═════════════════════════════════════════════════════════════
// Main loop
// ═════════════════════════════════════════════════════════════

async function checkAndRun(): Promise<void> {
  try {
    const jobs = getAllJobs();
    const tz = getSetting("timezone") || "UTC";
    const nowTz = getTimeInTz(new Date(), tz);

    for (const job of jobs) {
      if (!job.enabled) continue;
      if (!job.schedule) continue;
      if (!job.source_path || !job.destination_path) continue;

      // Skip if we triggered this job within the last 5 minutes
      const lastTriggered = recentlyTriggered.get(job.id) || 0;
      if (Date.now() - lastTriggered < 5 * 60_000) continue;

      // Skip if the job is currently running
      if (isJobRunning(job.id)) continue;

      const due = isDue(job, tz, nowTz);
      if (due) {
        console.log(`[scheduler] Job "${job.name}" (id=${job.id}) is due — triggering now`);
        recentlyTriggered.set(job.id, Date.now());
        await triggerJob(job.id);
      }
    }
  } catch (err) {
    console.error("[scheduler] Error during check:", err);
  }
}

// ═════════════════════════════════════════════════════════════
// Schedule evaluation — all comparisons in the user's timezone
// ═════════════════════════════════════════════════════════════

function isDue(job: Job, tz: string, nowTz: TzTime): boolean {
  const schedule = job.schedule.trim();
  const nowMinOfDay = nowTz.hour * 60 + nowTz.minute;

  // ── "daily HH:MM" ──────────────────────────────────────────
  const dailyMatch = schedule.match(/^daily\s+(\d{1,2}):(\d{2})$/i);
  if (dailyMatch) {
    const targetH = parseInt(dailyMatch[1], 10);
    const targetM = parseInt(dailyMatch[2], 10);
    const targetMinOfDay = targetH * 60 + targetM;

    // Not yet time today?
    if (nowMinOfDay < targetMinOfDay) {
      return false;
    }

    // Check if already ran today at or after the target time
    const lastRun = getLastRunInTz(job.id, tz);
    if (lastRun && isSameDate(lastRun, nowTz) && (lastRun.hour * 60 + lastRun.minute) >= targetMinOfDay) {
      return false;
    }

    console.log(
      `[scheduler] daily check: job=${job.id} schedule="${schedule}" ` +
      `now=${pad(nowTz.hour)}:${pad(nowTz.minute)} target=${pad(targetH)}:${pad(targetM)} ` +
      `lastRun=${lastRun ? `${lastRun.year}-${pad(lastRun.month)}-${pad(lastRun.day)} ${pad(lastRun.hour)}:${pad(lastRun.minute)}` : "never"} → DUE`
    );
    return true;
  }

  // ── "every Nh" ─────────────────────────────────────────────
  const everyMatch = schedule.match(/^every\s+(\d+)h$/i);
  if (everyMatch) {
    const intervalMs = parseInt(everyMatch[1], 10) * 3600_000;
    const lastRunMs = getLastRunTimeMs(job.id);

    if (!lastRunMs) {
      console.log(`[scheduler] every-N check: job=${job.id} never ran → DUE`);
      return true;
    }

    const elapsed = Date.now() - lastRunMs;
    if (elapsed >= intervalMs) {
      console.log(`[scheduler] every-N check: job=${job.id} elapsed=${Math.round(elapsed / 60000)}min interval=${Math.round(intervalMs / 60000)}min → DUE`);
      return true;
    }
    return false;
  }

  // ── "weekly DAY HH:MM" ─────────────────────────────────────
  const weeklyMatch = schedule.match(/^weekly\s+(\w+)\s+(\d{1,2}):(\d{2})$/i);
  if (weeklyMatch) {
    const targetDay = parseDayOfWeek(weeklyMatch[1]);
    const targetH = parseInt(weeklyMatch[2], 10);
    const targetM = parseInt(weeklyMatch[3], 10);
    const targetMinOfDay = targetH * 60 + targetM;

    if (targetDay < 0) return false;

    // Wrong day of week?
    if (nowTz.dayOfWeek !== targetDay) return false;

    // Not yet time today?
    if (nowMinOfDay < targetMinOfDay) return false;

    // Already ran today at or after target?
    const lastRun = getLastRunInTz(job.id, tz);
    if (lastRun && isSameDate(lastRun, nowTz) && (lastRun.hour * 60 + lastRun.minute) >= targetMinOfDay) {
      return false;
    }

    console.log(`[scheduler] weekly check: job=${job.id} → DUE`);
    return true;
  }

  // Unknown format — skip
  return false;
}

// ═════════════════════════════════════════════════════════════
// Timezone helpers (simple — no UTC conversion needed)
// ═════════════════════════════════════════════════════════════

interface TzTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;   // 0-23
  minute: number;
  second: number;
  dayOfWeek: number; // 0=Sun … 6=Sat
}

function getTimeInTz(date: Date, tz: string): TzTime {
  try {
    // Use individual toLocaleString calls — most reliable across Node.js versions
    const opts = { timeZone: tz } as const;

    const year = parseInt(date.toLocaleString("en-US", { ...opts, year: "numeric" }), 10);
    const month = parseInt(date.toLocaleString("en-US", { ...opts, month: "numeric" }), 10);
    const day = parseInt(date.toLocaleString("en-US", { ...opts, day: "numeric" }), 10);

    // hour12: false gives 0-23 range
    const hourStr = date.toLocaleString("en-GB", { ...opts, hour: "2-digit", hour12: false });
    const hour = parseInt(hourStr, 10) % 24; // "24" → 0

    const minute = parseInt(date.toLocaleString("en-US", { ...opts, minute: "numeric" }), 10);
    const second = parseInt(date.toLocaleString("en-US", { ...opts, second: "numeric" }), 10);

    // Day of week
    const weekdayStr = date.toLocaleString("en-US", { ...opts, weekday: "short" });
    const dayOfWeekMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const dayOfWeek = dayOfWeekMap[weekdayStr] ?? date.getDay();

    return { year, month, day, hour, minute, second, dayOfWeek };
  } catch (err) {
    console.error(`[scheduler] getTimeInTz failed for tz="${tz}":`, err);
    // Fallback to UTC
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

function isSameDate(a: TzTime, b: TzTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function parseDayOfWeek(day: string): number {
  const map: Record<string, number> = {
    sun: 0, sunday: 0, mon: 1, monday: 1,
    tue: 2, tuesday: 2, wed: 3, wednesday: 3,
    thu: 4, thursday: 4, fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  return map[day.toLowerCase()] ?? -1;
}

// ═════════════════════════════════════════════════════════════
// DB helpers
// ═════════════════════════════════════════════════════════════

/** Get the last run's start time as TzTime in the given timezone */
function getLastRunInTz(jobId: number, tz: string): TzTime | null {
  const ms = getLastRunTimeMs(jobId);
  if (!ms) return null;
  return getTimeInTz(new Date(ms), tz);
}

/** Get the last run's start time in milliseconds (UTC) */
function getLastRunTimeMs(jobId: number): number | null {
  try {
    const row = getDb()
      .prepare("SELECT started_at FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1")
      .get(jobId) as { started_at: string } | undefined;

    if (!row) return null;

    const dateStr = row.started_at.endsWith("Z") ? row.started_at : row.started_at + "Z";
    const ts = new Date(dateStr).getTime();
    if (isNaN(ts)) return null;
    return ts;
  } catch (err) {
    console.error(`[scheduler] getLastRunTimeMs failed for job ${jobId}:`, err);
    return null;
  }
}

/** Check if a job currently has a "running" status in the DB */
function isJobRunning(jobId: number): boolean {
  try {
    const row = getDb()
      .prepare("SELECT COUNT(*) as cnt FROM runs WHERE job_id = ? AND status = 'running'")
      .get(jobId) as { cnt: number } | undefined;
    return (row?.cnt ?? 0) > 0;
  } catch {
    return false;
  }
}

// ═════════════════════════════════════════════════════════════
// Trigger via local API
// ═════════════════════════════════════════════════════════════

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
    console.error(`[scheduler] Failed to reach API for job ${jobId}:`, err);
  }
}
