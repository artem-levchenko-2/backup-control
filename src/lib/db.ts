// ============================================================
// SQLite Database Layer
// ============================================================

import Database from "better-sqlite3";
import path from "path";
import type { Job, Run, Settings, DashboardStats, JobWithLastRun, DiskInfo } from "./types";

const DB_PATH = path.join(process.cwd(), "data", "backup-control.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    const fs = require("fs");
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'rclone_copy',
      enabled INTEGER NOT NULL DEFAULT 1,
      source_path TEXT NOT NULL DEFAULT '',
      destination_path TEXT NOT NULL DEFAULT '',
      schedule TEXT NOT NULL DEFAULT 'daily 02:00',
      flags TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      duration_seconds INTEGER,
      bytes_transferred INTEGER DEFAULT 0,
      files_transferred INTEGER DEFAULT 0,
      errors_count INTEGER DEFAULT 0,
      short_summary TEXT NOT NULL DEFAULT '',
      log_excerpt TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_runs_job_id ON runs(job_id);
    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
  `);
}

// ── Jobs ────────────────────────────────────────────────────

export function getAllJobs(): Job[] {
  return getDb().prepare("SELECT * FROM jobs ORDER BY name").all() as Job[];
}

export function getJobById(id: number): Job | undefined {
  return getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
}

export function createJob(data: Partial<Job>): Job {
  const stmt = getDb().prepare(`
    INSERT INTO jobs (name, type, enabled, source_path, destination_path, schedule, flags, description)
    VALUES (@name, @type, @enabled, @source_path, @destination_path, @schedule, @flags, @description)
  `);
  const result = stmt.run({
    name: data.name || "New Job",
    type: data.type || "rclone_copy",
    enabled: data.enabled ?? 1,
    source_path: data.source_path || "",
    destination_path: data.destination_path || "",
    schedule: data.schedule || "daily 02:00",
    flags: data.flags || "",
    description: data.description || "",
  });
  return getJobById(Number(result.lastInsertRowid))!;
}

export function updateJob(id: number, data: Partial<Job>): Job | undefined {
  const existing = getJobById(id);
  if (!existing) return undefined;

  const stmt = getDb().prepare(`
    UPDATE jobs SET
      name = @name,
      type = @type,
      enabled = @enabled,
      source_path = @source_path,
      destination_path = @destination_path,
      schedule = @schedule,
      flags = @flags,
      description = @description,
      updated_at = datetime('now')
    WHERE id = @id
  `);
  stmt.run({
    id,
    name: data.name ?? existing.name,
    type: data.type ?? existing.type,
    enabled: data.enabled ?? existing.enabled,
    source_path: data.source_path ?? existing.source_path,
    destination_path: data.destination_path ?? existing.destination_path,
    schedule: data.schedule ?? existing.schedule,
    flags: data.flags ?? existing.flags,
    description: data.description ?? existing.description,
  });
  return getJobById(id);
}

export function deleteJob(id: number): boolean {
  const result = getDb().prepare("DELETE FROM jobs WHERE id = ?").run(id);
  return result.changes > 0;
}

export function toggleJob(id: number): Job | undefined {
  const job = getJobById(id);
  if (!job) return undefined;
  getDb().prepare("UPDATE jobs SET enabled = ?, updated_at = datetime('now') WHERE id = ?")
    .run(job.enabled ? 0 : 1, id);
  return getJobById(id);
}

// ── Runs ────────────────────────────────────────────────────

export function getAllRuns(limit = 50, offset = 0, jobId?: number, status?: string): Run[] {
  let sql = `
    SELECT r.*, j.name as job_name, j.type as job_type
    FROM runs r
    LEFT JOIN jobs j ON r.job_id = j.id
  `;
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (jobId) {
    conditions.push("r.job_id = @jobId");
    params.jobId = jobId;
  }
  if (status) {
    conditions.push("r.status = @status");
    params.status = status;
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY r.started_at DESC LIMIT @limit OFFSET @offset";
  params.limit = limit;
  params.offset = offset;

  return getDb().prepare(sql).all(params) as Run[];
}

export function getRunById(id: number): Run | undefined {
  return getDb().prepare(`
    SELECT r.*, j.name as job_name, j.type as job_type
    FROM runs r LEFT JOIN jobs j ON r.job_id = j.id
    WHERE r.id = ?
  `).get(id) as Run | undefined;
}

export function createRun(jobId: number): Run {
  const stmt = getDb().prepare(`
    INSERT INTO runs (job_id, status, short_summary)
    VALUES (?, 'running', 'Job started...')
  `);
  const result = stmt.run(jobId);
  return getRunById(Number(result.lastInsertRowid))!;
}

export function completeRun(
  id: number,
  data: {
    status: string;
    bytes_transferred?: number;
    files_transferred?: number;
    errors_count?: number;
    short_summary?: string;
    log_excerpt?: string;
  }
): Run | undefined {
  const run = getRunById(id);
  if (!run) return undefined;

  const startedAt = new Date(run.started_at).getTime();
  const now = Date.now();
  const durationSeconds = Math.round((now - startedAt) / 1000);

  getDb().prepare(`
    UPDATE runs SET
      status = @status,
      finished_at = datetime('now'),
      duration_seconds = @duration_seconds,
      bytes_transferred = @bytes_transferred,
      files_transferred = @files_transferred,
      errors_count = @errors_count,
      short_summary = @short_summary,
      log_excerpt = @log_excerpt
    WHERE id = @id
  `).run({
    id,
    status: data.status,
    duration_seconds: durationSeconds,
    bytes_transferred: data.bytes_transferred ?? 0,
    files_transferred: data.files_transferred ?? 0,
    errors_count: data.errors_count ?? 0,
    short_summary: data.short_summary ?? "",
    log_excerpt: data.log_excerpt ?? "",
  });

  return getRunById(id);
}

// ── Dashboard Stats ─────────────────────────────────────────

export function getDashboardStats(): DashboardStats {
  const db = getDb();

  const totalJobs = (db.prepare("SELECT COUNT(*) as count FROM jobs").get() as { count: number }).count;
  const activeJobs = (db.prepare("SELECT COUNT(*) as count FROM jobs WHERE enabled = 1").get() as { count: number }).count;
  const totalRuns = (db.prepare("SELECT COUNT(*) as count FROM runs").get() as { count: number }).count;
  const successfulRuns = (db.prepare("SELECT COUNT(*) as count FROM runs WHERE status = 'success'").get() as { count: number }).count;
  const failedRuns = (db.prepare("SELECT COUNT(*) as count FROM runs WHERE status = 'failure'").get() as { count: number }).count;
  const last24hRuns = (db.prepare("SELECT COUNT(*) as count FROM runs WHERE started_at >= datetime('now', '-1 day')").get() as { count: number }).count;
  const totalBytes = (db.prepare("SELECT COALESCE(SUM(bytes_transferred), 0) as total FROM runs WHERE status = 'success'").get() as { total: number }).total;

  const recentRuns = getAllRuns(5);

  const jobsWithLastRun = db.prepare(`
    SELECT j.*,
      lr.status as last_run_status,
      lr.started_at as last_run_at,
      lr.duration_seconds as last_run_duration
    FROM jobs j
    LEFT JOIN (
      SELECT job_id, status, started_at, duration_seconds,
             ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY started_at DESC) as rn
      FROM runs
    ) lr ON lr.job_id = j.id AND lr.rn = 1
    ORDER BY j.name
  `).all() as JobWithLastRun[];

  // Disk info — auto-detect sizes via statfs from configured mount points
  const disks: DiskInfo[] = [];
  const disksJson = getSetting("disks_config");
  if (disksJson) {
    try {
      const fs = require("fs");
      const parsed = JSON.parse(disksJson);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const mount = entry.mount || "";
          const label = entry.label || mount;
          try {
            // Check path exists first
            fs.accessSync(mount, fs.constants.R_OK);
            const stats = fs.statfsSync(mount);
            const blockSize = stats.bsize;
            const totalBytes = stats.blocks * blockSize;
            const freeBytes = stats.bfree * blockSize;
            const usedBytes = totalBytes - freeBytes;
            const totalGb = Math.round((totalBytes / (1024 ** 3)) * 10) / 10;
            const usedGb = Math.round((usedBytes / (1024 ** 3)) * 10) / 10;
            const freeGb = Math.round((freeBytes / (1024 ** 3)) * 10) / 10;
            const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
            console.log(`[disk] ${mount} (${label}): ${usedGb}/${totalGb} GB (${usagePercent}%)`);
            disks.push({ mount, label, total_gb: totalGb, used_gb: usedGb, free_gb: freeGb, usage_percent: usagePercent });
          } catch (err: unknown) {
            // Path not mounted or inaccessible — show N/A values
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`[disk] statfs failed for "${mount}": ${errMsg}`);
            disks.push({ mount, label, total_gb: 0, used_gb: 0, free_gb: 0, usage_percent: 0 });
          }
        }
      }
    } catch { /* ignore malformed JSON */ }
  }

  // Server info from settings
  const serverInfo: Record<string, string> = {};
  const serverKeys = [
    "server_hostname", "server_cpu", "server_ram",
    "server_docker_ip", "server_tailscale_ip", "server_proxmox_ip",
  ];
  for (const key of serverKeys) {
    const val = getSetting(key);
    if (val) serverInfo[key] = val;
  }

  return {
    total_jobs: totalJobs,
    active_jobs: activeJobs,
    total_runs: totalRuns,
    successful_runs: successfulRuns,
    failed_runs: failedRuns,
    last_24h_runs: last24hRuns,
    total_bytes_transferred: totalBytes,
    disks,
    recent_runs: recentRuns,
    jobs_with_last_run: jobsWithLastRun,
    server_info: serverInfo,
  };
}

// ── Settings ────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (@key, @value, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = datetime('now')
  `).run({ key, value });
}

export function getAllSettings(): Settings[] {
  return getDb().prepare("SELECT * FROM settings ORDER BY key").all() as Settings[];
}

// ── Seed Data ───────────────────────────────────────────────

export function seedDatabase(): void {
  const db = getDb();

  // Check if settings exist — if yes, already seeded
  const settingsCount = (db.prepare("SELECT COUNT(*) as count FROM settings").get() as { count: number }).count;
  if (settingsCount > 0) return;

  const transaction = db.transaction(() => {
    // Default settings — all empty, user fills in via UI
    // Telegram
    setSetting("telegram_bot_token", "");
    setSetting("telegram_chat_id", "");
    setSetting("telegram_enabled", "false");
    setSetting("notify_on_failure", "true");
    setSetting("notify_on_success", "false");
    setSetting("notify_daily_digest", "true");

    // Rclone
    setSetting("rclone_remote_name", "");
    setSetting("rclone_config_path", "");
    setSetting("gdrive_backup_folder", "");
    setSetting("max_bandwidth", "10M");

    // Server info (user fills in)
    setSetting("server_hostname", "");
    setSetting("server_cpu", "");
    setSetting("server_ram", "");
    setSetting("server_docker_ip", "");
    setSetting("server_tailscale_ip", "");
    setSetting("server_proxmox_ip", "");

    // Storage paths
    setSetting("path_nextcloud_data", "");
    setSetting("path_immich_data", "");
    setSetting("path_immich_db_backups", "");
    setSetting("path_media_library", "");

    // Disk config (JSON array, user fills via UI)
    setSetting("disks_config", "[]");

    // Scheduling
    setSetting("blackout_start", "18:00");
    setSetting("blackout_end", "23:00");
    setSetting("max_concurrent_jobs", "1");
  });

  transaction();
}
