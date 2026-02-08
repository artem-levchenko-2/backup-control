import { NextResponse } from "next/server";
import { seedDatabase } from "@/lib/db";

export async function POST() {
  try {
    seedDatabase();
    return NextResponse.json({ ok: true, message: "Database seeded successfully" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
