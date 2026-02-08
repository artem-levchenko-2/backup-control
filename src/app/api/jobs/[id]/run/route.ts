import { NextRequest, NextResponse } from "next/server";
import { getJobById, createRun, completeRun, getSetting } from "@/lib/db";
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
      // If not JSON, split by whitespace
      const parts = job.flags.split(/\s+/).filter(Boolean);
      args.push(...parts);
    }
  }

  // Execute rclone asynchronously
  const logChunks: string[] = [];
  let bytesTransferred = 0;
  let filesTransferred = 0;
  let errorsCount = 0;

  const child = spawn("rclone", args, {
    env: { ...process.env, RCLONE_CONFIG: rcloneConfig },
  });

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
    // Try JSON log lines (--use-json-log format)
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        // rclone json stats include these fields
        if (entry.stats) {
          if (entry.stats.bytes != null) bytesTransferred = entry.stats.bytes;
          if (entry.stats.transfers != null) filesTransferred = entry.stats.transfers;
          if (entry.stats.errors != null) errorsCount = entry.stats.errors;
        }
      } catch {
        // Fallback: parse plain text stats
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
  }

  child.on("close", (code) => {
    const fullLog = logChunks.join("");
    // Keep last 4000 chars of log for the DB
    const logExcerpt = fullLog.length > 4000 ? "...\n" + fullLog.slice(-4000) : fullLog;

    if (code === 0) {
      completeRun(run.id, {
        status: "success",
        bytes_transferred: bytesTransferred,
        files_transferred: filesTransferred,
        errors_count: errorsCount,
        short_summary: `Transferred ${formatBytes(bytesTransferred)}, ${filesTransferred} files. ${errorsCount} errors.`,
        log_excerpt: logExcerpt,
      });
    } else {
      completeRun(run.id, {
        status: "failure",
        bytes_transferred: bytesTransferred,
        files_transferred: filesTransferred,
        errors_count: errorsCount || 1,
        short_summary: `Failed with exit code ${code}. ${errorsCount} errors. Check logs.`,
        log_excerpt: logExcerpt,
      });
    }
  });

  child.on("error", (err) => {
    completeRun(run.id, {
      status: "failure",
      bytes_transferred: 0,
      files_transferred: 0,
      errors_count: 1,
      short_summary: `Failed to start rclone: ${err.message}`,
      log_excerpt: `ERROR: Could not execute rclone command.\n${err.message}\n\nMake sure rclone is installed in the Docker container.`,
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
    case "B":
    case "BYTES": return Math.round(num);
    case "KIB":
    case "KB": return Math.round(num * 1024);
    case "MIB":
    case "MB": return Math.round(num * 1024 * 1024);
    case "GIB":
    case "GB": return Math.round(num * 1024 * 1024 * 1024);
    case "TIB":
    case "TB": return Math.round(num * 1024 * 1024 * 1024 * 1024);
    default: return Math.round(num);
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}
