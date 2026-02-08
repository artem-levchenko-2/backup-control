import { NextRequest, NextResponse } from "next/server";
import { getRunById, completeRun } from "@/lib/db";
import { stopProcess } from "@/lib/process-manager";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const runId = Number(id);
  const run = getRunById(runId);

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.status !== "running") {
    return NextResponse.json({ error: "Run is not currently running" }, { status: 400 });
  }

  const killed = stopProcess(runId);

  if (!killed) {
    // Process not found in memory — mark as cancelled in DB directly
    completeRun(runId, {
      status: "cancelled",
      short_summary: "Force stopped by user (process not found in memory).",
      log_excerpt: run.log_excerpt || "",
    });
  }

  // Note: if killed=true, the child.on("close") handler in run/route.ts
  // will fire and update the run status. We mark it cancelled there via signal detection.

  return NextResponse.json({
    ok: true,
    message: `Run #${runId} stop signal sent.`,
  });
}
