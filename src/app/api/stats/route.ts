import { NextResponse } from "next/server";
import { getDashboardStats, seedDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    seedDatabase(); // ensure seeded
    const stats = getDashboardStats();
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
