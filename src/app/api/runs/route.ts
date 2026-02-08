import { NextRequest, NextResponse } from "next/server";
import { getAllRuns, seedDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    seedDatabase();
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit")) || 50;
    const offset = Number(searchParams.get("offset")) || 0;
    const jobId = searchParams.get("job_id") ? Number(searchParams.get("job_id")) : undefined;
    const status = searchParams.get("status") || undefined;

    const runs = getAllRuns(limit, offset, jobId, status);
    return NextResponse.json(runs);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
