// ============================================================
// Homelab Backup & Import Control Plane — Type Definitions
// ============================================================

export type JobType =
  | "rclone_copy"
  | "rclone_sync"
  | "rclone_check"
  | "immich_db_backup"
  | "immich_go_import";

export type RunType = "backup" | "verify";

export type JobStatus = "active" | "disabled";

export type RunStatus = "success" | "failure" | "running" | "cancelled" | "skipped";

export type NotificationChannel = "telegram";

export type NotificationEventType =
  | "RUN_FAILED"
  | "RUN_SUCCEEDED"
  | "RUN_SKIPPED"
  | "LOW_DISK_SPACE"
  | "AUTH_EXPIRED";

// ── Database row types ──────────────────────────────────────

export interface Job {
  id: number;
  name: string;
  type: JobType;
  enabled: 0 | 1;
  source_path: string;
  destination_path: string;
  schedule: string;           // cron-like or human-readable
  flags: string;              // extra CLI flags (JSON or plain)
  description: string;
  created_at: string;
  updated_at: string;
}

export interface Run {
  id: number;
  job_id: number;
  job_name?: string;          // joined from jobs table
  job_type?: JobType;         // joined from jobs table
  run_type: RunType;          // "backup" or "verify"
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
  bytes_transferred: number | null;
  files_transferred: number | null;
  errors_count: number;
  short_summary: string;
  log_excerpt: string;
}

export interface Settings {
  id: number;
  key: string;
  value: string;
  updated_at: string;
}

// ── API response types ──────────────────────────────────────

export interface DashboardStats {
  total_jobs: number;
  active_jobs: number;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  last_24h_runs: number;
  total_bytes_transferred: number;
  disks: DiskInfo[];
  recent_runs: Run[];
  jobs_with_last_run: JobWithLastRun[];
  server_info: Record<string, string>;
}

export interface DiskInfo {
  mount: string;
  label: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  usage_percent: number;
}

export interface JobWithLastRun extends Job {
  last_run_id: number | null;
  last_run_status: RunStatus | null;
  last_run_at: string | null;
  last_run_duration: number | null;
  last_run_bytes: number | null;
  last_run_files: number | null;
  last_run_summary: string | null;
  // Verification info
  last_verify_id: number | null;
  last_verify_status: RunStatus | null;
  last_verify_at: string | null;
  last_verify_summary: string | null;
}
