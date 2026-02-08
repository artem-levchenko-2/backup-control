// ============================================================
// Real Job Runner — executes rclone / immich-go on the server
// ============================================================

import { spawn } from "child_process";
import { completeRun } from "./db";
import type { Job } from "./types";

const RCLONE_CONFIG = process.env.RCLONE_CONFIG || "/root/.config/rclone/rclone.conf";

interface RcloneStats {
  bytes: number;
  files: number;
  errors: number;
}

/**
 * Parse rclone --stats output to extract transferred bytes/files
 */
function parseRcloneOutput(output: string): RcloneStats {
  let bytes = 0;
  let files = 0;
  let errors = 0;

  // Match "Transferred: 12.306 GiB / 12.306 GiB"
  const bytesMatch = output.match(/Transferred:\s+([\d.]+)\s*(B|KiB|MiB|GiB|TiB)\s*\/\s*([\d.]+)\s*(B|KiB|MiB|GiB|TiB)/);
  if (bytesMatch) {
    const multipliers: Record<string, number> = {
      B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4,
    };
    bytes = Math.round(parseFloat(bytesMatch[3]) * (multipliers[bytesMatch[4]] || 1));
  }

  // Match "Transferred: 7052 / 7052, 100%"
  const filesMatch = output.match(/Transferred:\s+(\d+)\s*\/\s*(\d+),\s*100%/);
  if (filesMatch) {
    files = parseInt(filesMatch[2], 10);
  }

  // Match "Errors: 3"
  const errorsMatch = output.match(/Errors:\s+(\d+)/);
  if (errorsMatch) {
    errors = parseInt(errorsMatch[1], 10);
  }

  return { bytes, files, errors };
}

/**
 * Execute an rclone copy/sync job
 */
export function executeRcloneJob(job: Job, runId: number): void {
  const command = job.type === "rclone_sync" ? "sync" : "copy";

  // Build args
  const args: string[] = [
    command,
    job.source_path,
    job.destination_path,
    "--config", RCLONE_CONFIG,
    "--stats", "5s",
    "--stats-one-line",
    "-v",     // verbose logging
    "--stats-log-level", "NOTICE",
  ];

  // Parse extra flags from job config
  if (job.flags) {
    const extraFlags = job.flags.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    args.push(...extraFlags);
  }

  let stdout = "";
  let stderr = "";

  console.log(`[Job Runner] Starting: rclone ${args.join(" ")}`);

  const proc = spawn("rclone", args, {
    env: { ...process.env, RCLONE_CONFIG },
  });

  proc.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    stdout += text;
  });

  proc.stderr.on("data", (data: Buffer) => {
    const text = data.toString();
    stderr += text;
  });

  proc.on("close", (code) => {
    const fullOutput = stdout + "\n" + stderr;
    const stats = parseRcloneOutput(fullOutput);

    // Keep last 2000 chars of output as log excerpt
    const logExcerpt = fullOutput.trim().slice(-2000);

    if (code === 0) {
      const summary = stats.files > 0
        ? `Transferred ${(stats.bytes / (1024 ** 3)).toFixed(1)} GB, ${stats.files} files. No errors.`
        : `Completed successfully. No new files to transfer.`;

      completeRun(runId, {
        status: "success",
        bytes_transferred: stats.bytes,
        files_transferred: stats.files,
        errors_count: 0,
        short_summary: summary,
        log_excerpt: logExcerpt,
      });
      console.log(`[Job Runner] Job "${job.name}" completed: ${summary}`);
    } else {
      const errorSummary = stats.errors > 0
        ? `Failed with ${stats.errors} error(s). Exit code: ${code}`
        : `Failed with exit code ${code}. Check logs.`;

      completeRun(runId, {
        status: "failure",
        bytes_transferred: stats.bytes,
        files_transferred: stats.files,
        errors_count: stats.errors || 1,
        short_summary: errorSummary,
        log_excerpt: logExcerpt,
      });
      console.log(`[Job Runner] Job "${job.name}" FAILED: ${errorSummary}`);
    }
  });

  proc.on("error", (err) => {
    console.error(`[Job Runner] Failed to start rclone:`, err);
    completeRun(runId, {
      status: "failure",
      bytes_transferred: 0,
      files_transferred: 0,
      errors_count: 1,
      short_summary: `Failed to start rclone: ${err.message}`,
      log_excerpt: `ERROR: ${err.message}\n\nIs rclone installed? Check RCLONE_CONFIG=${RCLONE_CONFIG}`,
    });
  });
}

/**
 * Execute a job based on its type
 */
export function executeJob(job: Job, runId: number): void {
  switch (job.type) {
    case "rclone_copy":
    case "rclone_sync":
      executeRcloneJob(job, runId);
      break;

    case "immich_db_backup":
      // For Immich DB backup, we first do rclone copy of the backups folder
      executeRcloneJob(job, runId);
      break;

    case "immich_go_import":
      // Placeholder for future immich-go integration
      completeRun(runId, {
        status: "failure",
        errors_count: 1,
        short_summary: "Immich-go import not yet implemented. Coming in Phase C.",
        log_excerpt: "immich-go integration is planned for a future update.",
      });
      break;

    default:
      completeRun(runId, {
        status: "failure",
        errors_count: 1,
        short_summary: `Unknown job type: ${job.type}`,
        log_excerpt: `No handler for job type "${job.type}"`,
      });
  }
}
