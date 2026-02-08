import { NextRequest, NextResponse } from "next/server";
import { getJobById, createRun, completeRun } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getJobById(Number(id));
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Create a new run
  const run = createRun(job.id);

  // In MVP, simulate execution with a realistic delay
  // On real server, this would invoke rclone / immich-go CLI
  setTimeout(() => {
    const isSuccess = Math.random() > 0.15; // 85% success rate

    if (isSuccess) {
      const bytes = Math.floor(Math.random() * 5e9) + 1e8; // 100MB - 5GB
      const files = Math.floor(Math.random() * 500) + 10;
      completeRun(run.id, {
        status: "success",
        bytes_transferred: bytes,
        files_transferred: files,
        errors_count: 0,
        short_summary: `Transferred ${(bytes / 1e9).toFixed(1)} GB, ${files} files. No errors.`,
        log_excerpt: `INFO  : Starting ${job.type}\nINFO  : Transferred: ${(bytes / 1e9).toFixed(1)} GiB\nINFO  : Checks: ${files} / ${files}, 100%\nINFO  : Job completed successfully`,
      });
    } else {
      completeRun(run.id, {
        status: "failure",
        bytes_transferred: 0,
        files_transferred: 0,
        errors_count: 1,
        short_summary: "Failed: connection timeout. Check rclone config and network.",
        log_excerpt: `ERROR : ${job.type} failed\nERROR : Post "https://www.googleapis.com/upload/drive/v3/files": dial tcp: lookup www.googleapis.com: no such host\nERROR : Job failed after retry attempts exhausted`,
      });
    }
  }, 3000 + Math.random() * 5000); // 3-8 second simulated run

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    message: `Job "${job.name}" started. Run #${run.id} created.`,
  });
}
