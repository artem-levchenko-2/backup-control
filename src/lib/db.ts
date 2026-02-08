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
    // Ensure data directory exists
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

  // Jobs with their last run info
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

  // Simulated disk info (on real server, would use df command)
  const disks: DiskInfo[] = [
    { mount: "/srv/storage", label: "MEDIA", total_gb: 190, used_gb: 72, free_gb: 118, usage_percent: 38 },
    { mount: "/srv/storage/toshiba", label: "Toshiba (Nextcloud)", total_gb: 466, used_gb: 13, free_gb: 453, usage_percent: 3 },
    { mount: "/srv/storage/transcend", label: "Transcend (Immich)", total_gb: 458, used_gb: 85, free_gb: 373, usage_percent: 19 },
    { mount: "/dev/sda1", label: "System VM", total_gb: 50, used_gb: 12, free_gb: 38, usage_percent: 24 },
  ];

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
  const jobCount = (db.prepare("SELECT COUNT(*) as count FROM jobs").get() as { count: number }).count;
  if (jobCount > 0) return; // Already seeded

  const now = new Date();

  // Create example jobs matching the user's actual server setup
  const jobs = [
    {
      name: "Nextcloud Datadir → Google Drive",
      type: "rclone_copy",
      source_path: "/mnt/toshiba/nextcloud-data",
      destination_path: "artem-g-drive:homelab-backup/nextcloud-data",
      schedule: "daily 02:00",
      flags: "--checksum --transfers 4 --bwlimit 10M",
      description: "Копія Nextcloud datadir (Toshiba диск) у Google Drive. ~13GB даних.",
    },
    {
      name: "Immich Media → Google Drive",
      type: "rclone_copy",
      source_path: "/srv/storage/transcend/immich",
      destination_path: "artem-g-drive:homelab-backup/immich-media",
      schedule: "daily 03:00",
      flags: "--checksum --transfers 4 --bwlimit 10M --exclude 'thumbs/**' --exclude 'encoded-video/**'",
      description: "Копія Immich фото/відео (Transcend диск) у Google Drive. Бібліотека + uploads.",
    },
    {
      name: "Immich DB Backup",
      type: "immich_db_backup",
      source_path: "/srv/storage/transcend/immich/backups",
      destination_path: "artem-g-drive:homelab-backup/immich-db",
      schedule: "daily 04:00",
      flags: "",
      description: "Дамп бази даних Immich (Postgres) + копія у Google Drive. Критично для відновлення.",
    },
    {
      name: "Media Library → Google Drive",
      type: "rclone_copy",
      source_path: "/srv/storage/media",
      destination_path: "artem-g-drive:homelab-backup/media",
      schedule: "weekly sun 05:00",
      flags: "--checksum --transfers 2 --bwlimit 5M",
      description: "Фільми та серіали з MEDIA диска. Щотижневий бекап.",
    },
  ];

  const insertJob = db.prepare(`
    INSERT INTO jobs (name, type, source_path, destination_path, schedule, flags, description)
    VALUES (@name, @type, @source_path, @destination_path, @schedule, @flags, @description)
  `);

  const insertRun = db.prepare(`
    INSERT INTO runs (job_id, status, started_at, finished_at, duration_seconds, bytes_transferred, files_transferred, errors_count, short_summary, log_excerpt)
    VALUES (@job_id, @status, @started_at, @finished_at, @duration_seconds, @bytes_transferred, @files_transferred, @errors_count, @short_summary, @log_excerpt)
  `);

  const transaction = db.transaction(() => {
    for (const job of jobs) {
      insertJob.run(job);
    }

    // Create some example runs for realistic dashboard
    const sampleRuns = [
      {
        job_id: 1, status: "success",
        started_at: new Date(now.getTime() - 2 * 3600000).toISOString(),
        finished_at: new Date(now.getTime() - 2 * 3600000 + 1080000).toISOString(),
        duration_seconds: 1080, bytes_transferred: 13958643712, files_transferred: 2847,
        errors_count: 0, short_summary: "Transferred 13.0 GB, 2847 files. No errors.",
        log_excerpt: "2026/02/08 02:00:01 INFO  : Starting rclone copy\n2026/02/08 02:18:00 INFO  : Transferred: 13.0 GiB (12.3 MiB/s)\n2026/02/08 02:18:00 INFO  : Checks: 2847 / 2847, 100%\n2026/02/08 02:18:00 INFO  : Transferred: 128 / 128, 100%\nElapsed time: 18m0.1s",
      },
      {
        job_id: 2, status: "success",
        started_at: new Date(now.getTime() - 1 * 3600000).toISOString(),
        finished_at: new Date(now.getTime() - 1 * 3600000 + 2700000).toISOString(),
        duration_seconds: 2700, bytes_transferred: 45097156608, files_transferred: 12543,
        errors_count: 0, short_summary: "Transferred 42.0 GB, 12543 files. No errors.",
        log_excerpt: "2026/02/08 03:00:01 INFO  : Starting rclone copy\n2026/02/08 03:45:00 INFO  : Transferred: 42.0 GiB (15.9 MiB/s)\n2026/02/08 03:45:00 INFO  : Checks: 12543 / 12543, 100%\nElapsed time: 45m0.2s",
      },
      {
        job_id: 3, status: "failure",
        started_at: new Date(now.getTime() - 0.5 * 3600000).toISOString(),
        finished_at: new Date(now.getTime() - 0.5 * 3600000 + 15000).toISOString(),
        duration_seconds: 15, bytes_transferred: 0, files_transferred: 0,
        errors_count: 1, short_summary: "Failed: pg_dump connection refused. Check Immich Postgres container.",
        log_excerpt: "2026/02/08 04:00:01 ERROR : pg_dump: connection to server at \"127.0.0.1\", port 5432 failed: Connection refused\n\tIs the server running on that host and accepting TCP/IP connections?\n2026/02/08 04:00:15 ERROR : Job failed after 15s",
      },
      {
        job_id: 1, status: "success",
        started_at: new Date(now.getTime() - 26 * 3600000).toISOString(),
        finished_at: new Date(now.getTime() - 26 * 3600000 + 960000).toISOString(),
        duration_seconds: 960, bytes_transferred: 13421772800, files_transferred: 2831,
        errors_count: 0, short_summary: "Transferred 12.5 GB, 2831 files. No errors.",
        log_excerpt: "2026/02/07 02:00:01 INFO  : Starting rclone copy\n2026/02/07 02:16:00 INFO  : Transferred: 12.5 GiB\nElapsed time: 16m0.3s",
      },
      {
        job_id: 2, status: "success",
        started_at: new Date(now.getTime() - 25 * 3600000).toISOString(),
        finished_at: new Date(now.getTime() - 25 * 3600000 + 2400000).toISOString(),
        duration_seconds: 2400, bytes_transferred: 42949672960, files_transferred: 12501,
        errors_count: 0, short_summary: "Transferred 40.0 GB, 12501 files. No errors.",
        log_excerpt: "2026/02/07 03:00:01 INFO  : Starting rclone copy\n2026/02/07 03:40:00 INFO  : Transferred: 40.0 GiB\nElapsed time: 40m0.1s",
      },
      {
        job_id: 3, status: "success",
        started_at: new Date(now.getTime() - 24 * 3600000).toISOString(),
        finished_at: new Date(now.getTime() - 24 * 3600000 + 45000).toISOString(),
        duration_seconds: 45, bytes_transferred: 52428800, files_transferred: 1,
        errors_count: 0, short_summary: "DB dump created and uploaded. 50 MB.",
        log_excerpt: "2026/02/07 04:00:01 INFO  : pg_dump completed\n2026/02/07 04:00:30 INFO  : Uploaded immich-db-20260207.sql (50 MB)\nElapsed time: 45s",
      },
      {
        job_id: 4, status: "success",
        started_at: new Date(now.getTime() - 72 * 3600000).toISOString(),
        finished_at: new Date(now.getTime() - 72 * 3600000 + 7200000).toISOString(),
        duration_seconds: 7200, bytes_transferred: 63350767616, files_transferred: 145,
        errors_count: 0, short_summary: "Transferred 59.0 GB, 145 files. Weekly backup complete.",
        log_excerpt: "2026/02/05 05:00:01 INFO  : Starting weekly rclone copy\n2026/02/05 07:00:00 INFO  : Transferred: 59.0 GiB\nElapsed time: 2h0m0.5s",
      },
    ];

    for (const run of sampleRuns) {
      insertRun.run(run);
    }

    // Default settings
    setSetting("telegram_bot_token", "");
    setSetting("telegram_chat_id", "");
    setSetting("telegram_enabled", "false");
    setSetting("notify_on_failure", "true");
    setSetting("notify_on_success", "false");
    setSetting("notify_daily_digest", "true");
    setSetting("rclone_config_path", "/home/artem/.config/rclone/rclone.conf");
    setSetting("blackout_start", "18:00");
    setSetting("blackout_end", "23:00");
    setSetting("max_concurrent_jobs", "1");
    setSetting("max_bandwidth", "10M");
  });

  transaction();
}
