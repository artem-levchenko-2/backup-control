import { NextRequest, NextResponse } from "next/server";
import { getJobById, createRun } from "@/lib/db";
import { executeJob } from "@/lib/job-runner";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getJobById(Number(id));
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  if (!job.enabled) {
    return NextResponse.json({ error: "Job is disabled" }, { status: 400 });
  }

  // Create a new run record
  const run = createRun(job.id);

  // Execute the job asynchronously (non-blocking)
  executeJob(job, run.id);

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    message: `Job "${job.name}" started. Run #${run.id} created.`,
  });
}
