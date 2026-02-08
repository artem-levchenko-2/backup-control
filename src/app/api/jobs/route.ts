import { NextRequest, NextResponse } from "next/server";
import { getAllJobs, createJob, seedDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    seedDatabase();
    const jobs = getAllJobs();
    return NextResponse.json(jobs);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    seedDatabase();
    const body = await req.json();
    const job = createJob(body);
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
