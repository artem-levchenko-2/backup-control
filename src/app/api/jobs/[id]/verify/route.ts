import { NextRequest, NextResponse } from "next/server";
import { getJobById, createRun, completeRun, updateRunProgress, getSetting } from "@/lib/db";
import { sendVerifyNotification } from "@/lib/notifications";
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

  // Create a new run record with type "verify"
  const run = createRun(job.id, "verify");

  // Read rclone settings
  const rcloneConfig = process.env.RCLONE_CONFIG || getSetting("rclone_config_path") || "/etc/rclone/rclone.conf";

  // Build rclone check arguments
  const args: string[] = [
    "check",
    job.source_path,
    job.destination_path,
    "--config", rcloneConfig,
    "--one-way",           // Only check that source files exist in destination
    "--stats-one-line",
    "--stats", "5s",
    "-v",
    "--use-json-log",
  ];

  // Parse request body for optional flags
  let useChecksum = false;
  try {
    const body = await _req.json();
    if (body?.checksum) {
      useChecksum = true;
    }
  } catch {
    // No body or invalid JSON — that's fine
  }

  if (useChecksum) {
    args.push("--checksum");
  }

  // Add any exclude flags from the job (to verify same subset that was backed up)
  if (job.flags) {
    try {
      const extraFlags = JSON.parse(job.flags);
      if (Array.isArray(extraFlags)) {
        // Only keep --exclude and filter flags, not transfer-related ones
        for (const f of extraFlags) {
          if (typeof f === "string" && (f.startsWith("--exclude") || f.startsWith("--min-size") || f.startsWith("--max-size"))) {
            args.push(f);
          }
        }
      }
    } catch {
      const parts = job.flags.split(/\s+/).filter(Boolean);
      let i = 0;
      while (i < parts.length) {
        if (parts[i] === "--exclude" && i + 1 < parts.length) {
          args.push(parts[i], parts[i + 1]);
          i += 2;
        } else if (parts[i] === "--min-size" || parts[i] === "--max-size") {
          if (i + 1 < parts.length) {
            args.push(parts[i], parts[i + 1]);
            i += 2;
          } else {
            i++;
          }
        } else {
          i++;
        }
      }
    }
  }

  // Execute rclone check asynchronously
  const logChunks: string[] = [];
  let matchedFiles = 0;
  let mismatchedFiles = 0;
  let missingFiles = 0;   // files in source not in dest
  let errorsCount = 0;
  let totalChecks = 0;
  let lastProgressUpdate = 0;
  let wasSignaled = false;
  const startTime = Date.now();

  const child = spawn("rclone", args, {
    env: { ...process.env, RCLONE_CONFIG: rcloneConfig },
  });

  registerProcess(run.id, child);

  child.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    logChunks.push(text);
    parseCheckStats(text);
  });

  child.stderr.on("data", (data: Buffer) => {
    const text = data.toString();
    logChunks.push(text);
    parseCheckStats(text);
  });

  function parseCheckStats(text: string) {
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);

        // rclone check JSON stats
        if (entry.stats) {
          if (entry.stats.checks != null) matchedFiles = entry.stats.checks;
          if (entry.stats.totalChecks != null) totalChecks = entry.stats.totalChecks;
          if (entry.stats.errors != null) errorsCount = entry.stats.errors;
          if (entry.stats.transfers != null) mismatchedFiles = entry.stats.transfers;
        }

        // rclone check emits "msg":"...not in..." for missing/mismatched files
        if (entry.msg) {
          if (/not in/i.test(entry.msg)) {
            missingFiles++;
          }
        }
        if (entry.level === "error") {
          // Errors like "file not in destination" or hash mismatch
          if (/not in|differ|mismatch/i.test(entry.msg || "")) {
            // Already counted in errorsCount from stats
          }
        }
      } catch {
        // Text-based parsing fallback
        const checksMatch = line.match(/Checks:\s+(\d+)\s*\/\s*(\d+)/);
        if (checksMatch) {
          matchedFiles = parseInt(checksMatch[1], 10);
          totalChecks = parseInt(checksMatch[2], 10);
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

      const parts: string[] = [];
      if (totalChecks > 0) {
        const pct = Math.round((matchedFiles / totalChecks) * 100);
        parts.push(`Checked ${matchedFiles}/${totalChecks} files (${pct}%)`);
      } else {
        parts.push(`Checked ${matchedFiles} files`);
      }
      if (errorsCount > 0) {
        parts.push(`${errorsCount} differences found`);
      }

      updateRunProgress(run.id, {
        bytes_transferred: 0,
        files_transferred: matchedFiles,
        errors_count: errorsCount,
        short_summary: parts.join(" · "),
      });
    }
  }

  child.on("close", async (code, signal) => {
    unregisterProcess(run.id);

    const fullLog = logChunks.join("");
    const logExcerpt = fullLog.length > 4000 ? "...\n" + fullLog.slice(-4000) : fullLog;

    const startedAtStr = run.started_at.endsWith("Z") ? run.started_at : run.started_at + "Z";
    const startedAt = new Date(startedAtStr).getTime();
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);

    wasSignaled = signal === "SIGTERM" || signal === "SIGKILL";

    let status: string;
    let summary: string;

    if (wasSignaled) {
      status = "cancelled";
      summary = `Verification cancelled by user after ${formatDuration(durationSeconds)}.`;
    } else if (code === 0 && errorsCount === 0) {
      status = "success";
      summary = `Verified: all ${matchedFiles} files match between source and destination.${useChecksum ? " (checksum verified)" : " (size/modtime verified)"} Duration: ${formatDuration(durationSeconds)}.`;
    } else {
      status = "failure";
      const issues: string[] = [];
      if (errorsCount > 0) issues.push(`${errorsCount} differences`);
      if (missingFiles > 0) issues.push(`${missingFiles} files missing from destination`);
      if (mismatchedFiles > 0) issues.push(`${mismatchedFiles} files mismatched`);
      summary = `Verification FAILED: ${issues.join(", ")}. ${matchedFiles} files matched.${useChecksum ? " (checksum)" : " (size/modtime)"} Duration: ${formatDuration(durationSeconds)}.`;
    }

    completeRun(run.id, {
      status,
      bytes_transferred: 0,
      files_transferred: matchedFiles,
      errors_count: errorsCount,
      short_summary: summary,
      log_excerpt: logExcerpt,
    });

    // Send Telegram notification for verify results
    if (!wasSignaled) {
      await sendVerifyNotification({
        jobName: job.name,
        status: status as "success" | "failure",
        matchedFiles,
        errorsCount,
        durationSeconds,
        summary,
      });
    }
  });

  child.on("error", async (err) => {
    unregisterProcess(run.id);
    const summary = `Failed to start rclone check: ${err.message}`;
    completeRun(run.id, {
      status: "failure",
      bytes_transferred: 0,
      files_transferred: 0,
      errors_count: 1,
      short_summary: summary,
      log_excerpt: `ERROR: Could not execute rclone check command.\n${err.message}\n\nMake sure rclone is installed in the Docker container.`,
    });
  });

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    message: `Verification of "${job.name}" started. Run #${run.id} created.${useChecksum ? " Using checksum comparison." : ""}`,
  });
}

// ── Helpers ──────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
