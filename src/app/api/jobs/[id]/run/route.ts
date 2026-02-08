import { NextRequest, NextResponse } from "next/server";
import { getJobById, createRun, completeRun, updateRunProgress, getSetting } from "@/lib/db";
import { sendJobNotification } from "@/lib/notifications";
import { registerProcess, unregisterProcess } from "@/lib/process-manager";
import { spawn } from "child_process";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getJobById(Number(id));
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Validate source & destination
  if (!job.source_path || !job.destination_path) {
    return NextResponse.json(
      { error: "Job source_path and destination_path must be configured" },
      { status: 400 }
    );
  }

  // Create a new run record
  const run = createRun(job.id);

  // Read rclone settings
  const rcloneConfig = process.env.RCLONE_CONFIG || getSetting("rclone_config_path") || "/etc/rclone/rclone.conf";
  const maxBandwidth = getSetting("max_bandwidth") || "";

  // Determine rclone sub-command from job type
  let rcloneCmd: string;
  switch (job.type) {
    case "rclone_sync":
      rcloneCmd = "sync";
      break;
    case "rclone_copy":
    default:
      rcloneCmd = "copy";
      break;
  }

  // Build rclone arguments
  const args: string[] = [
    rcloneCmd,
    job.source_path,
    job.destination_path,
    "--config", rcloneConfig,
    "--stats-one-line",
    "--stats", "5s",
    "-v",
    "--use-json-log",
  ];

  // Add bandwidth limit if configured
  if (maxBandwidth) {
    args.push("--bwlimit", maxBandwidth);
  }

  // Add any extra flags from job config
  if (job.flags) {
    try {
      const extraFlags = JSON.parse(job.flags);
      if (Array.isArray(extraFlags)) {
        args.push(...extraFlags);
      }
    } catch {
      const parts = job.flags.split(/\s+/).filter(Boolean);
      args.push(...parts);
    }
  }

  // Execute rclone asynchronously
  const logChunks: string[] = [];
  let bytesTransferred = 0;
  let filesTransferred = 0;
  let errorsCount = 0;
  let lastProgressUpdate = 0;
  let speed = 0;
  let eta: number | null = null;
  let totalBytes = 0;
  let wasSignaled = false;

  const child = spawn("rclone", args, {
    env: { ...process.env, RCLONE_CONFIG: rcloneConfig },
  });

  // Register process for force-stop capability
  registerProcess(run.id, child);

  child.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    logChunks.push(text);
    parseRcloneStats(text);
  });

  child.stderr.on("data", (data: Buffer) => {
    const text = data.toString();
    logChunks.push(text);
    parseRcloneStats(text);
  });

  function parseRcloneStats(text: string) {
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.stats) {
          if (entry.stats.bytes != null) bytesTransferred = entry.stats.bytes;
          if (entry.stats.transfers != null) filesTransferred = entry.stats.transfers;
          if (entry.stats.errors != null) errorsCount = entry.stats.errors;
          if (entry.stats.speed != null) speed = entry.stats.speed;
          if (entry.stats.eta != null) eta = entry.stats.eta;
          if (entry.stats.totalBytes != null) totalBytes = entry.stats.totalBytes;
        }
      } catch {
        const bytesMatch = line.match(/Transferred:\s+([\d.]+)\s*(\w+)/);
        if (bytesMatch) {
          bytesTransferred = parseTransferredBytes(bytesMatch[1], bytesMatch[2]);
        }
        const filesMatch = line.match(/Transferred:\s+(\d+)\s*\/\s*\d+,/);
        if (filesMatch) {
          filesTransferred = parseInt(filesMatch[1], 10);
        }
        const errMatch = line.match(/Errors:\s+(\d+)/);
        if (errMatch) {
          errorsCount = parseInt(errMatch[1], 10);
        }
      }
    }

    // Update progress in DB every 5 seconds
    const now = Date.now();
    if (now - lastProgressUpdate >= 5000) {
      lastProgressUpdate = now;

      // Build rich summary
      const parts: string[] = [formatBytes(bytesTransferred)];
      if (totalBytes > 0) {
        const pct = Math.round((bytesTransferred / totalBytes) * 100);
        parts[0] = `${formatBytes(bytesTransferred)} / ${formatBytes(totalBytes)} (${pct}%)`;
      }
      parts.push(`${filesTransferred} files`);
      if (speed > 0) parts.push(`${formatBytes(speed)}/s`);
      if (eta != null && eta > 0) parts.push(`ETA ${formatEta(eta)}`);

      updateRunProgress(run.id, {
        bytes_transferred: bytesTransferred,
        files_transferred: filesTransferred,
        errors_count: errorsCount,
        short_summary: parts.join(" \u00B7 "),
      });
    }
  }

  child.on("close", async (code, signal) => {
    unregisterProcess(run.id);

    const fullLog = logChunks.join("");
    const logExcerpt = fullLog.length > 4000 ? "...\n" + fullLog.slice(-4000) : fullLog;

    const startedAt = new Date(run.started_at).getTime();
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);

    // Detect if stopped by user (SIGTERM/SIGKILL)
    wasSignaled = signal === "SIGTERM" || signal === "SIGKILL";

    let status: string;
    let summary: string;

    if (wasSignaled) {
      status = "cancelled";
      summary = `Stopped by user after ${formatDuration(durationSeconds)}. Transferred ${formatBytes(bytesTransferred)}, ${filesTransferred} files.`;
    } else if (code === 0) {
      status = "success";
      summary = `Transferred ${formatBytes(bytesTransferred)}, ${filesTransferred} files. ${errorsCount} errors.`;
    } else {
      status = "failure";
      summary = `Failed with exit code ${code}. ${errorsCount} errors. Check logs.`;
    }

    completeRun(run.id, {
      status,
      bytes_transferred: bytesTransferred,
      files_transferred: filesTransferred,
      errors_count: wasSignaled ? errorsCount : (code === 0 ? errorsCount : (errorsCount || 1)),
      short_summary: summary,
      log_excerpt: logExcerpt,
    });

    // Send Telegram notification (not for user-cancelled jobs)
    if (!wasSignaled) {
      await sendJobNotification({
        jobName: job.name,
        status: status as "success" | "failure",
        bytesTransferred,
        filesTransferred,
        errorsCount: code === 0 ? errorsCount : (errorsCount || 1),
        durationSeconds,
        summary,
      });
    }
  });

  child.on("error", async (err) => {
    unregisterProcess(run.id);
    const summary = `Failed to start rclone: ${err.message}`;
    completeRun(run.id, {
      status: "failure",
      bytes_transferred: 0,
      files_transferred: 0,
      errors_count: 1,
      short_summary: summary,
      log_excerpt: `ERROR: Could not execute rclone command.\n${err.message}\n\nMake sure rclone is installed in the Docker container.`,
    });

    await sendJobNotification({
      jobName: job.name,
      status: "failure",
      bytesTransferred: 0,
      filesTransferred: 0,
      errorsCount: 1,
      durationSeconds: 0,
      summary,
    });
  });

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    message: `Job "${job.name}" started. Run #${run.id} created. rclone ${rcloneCmd} is running.`,
  });
}

// ── Helpers ──────────────────────────────────────────────────

function parseTransferredBytes(value: string, unit: string): number {
  const num = parseFloat(value);
  switch (unit.toUpperCase()) {
    case "B": case "BYTES": return Math.round(num);
    case "KIB": case "KB": return Math.round(num * 1024);
    case "MIB": case "MB": return Math.round(num * 1024 * 1024);
    case "GIB": case "GB": return Math.round(num * 1024 * 1024 * 1024);
    case "TIB": case "TB": return Math.round(num * 1024 * 1024 * 1024 * 1024);
    default: return Math.round(num);
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
