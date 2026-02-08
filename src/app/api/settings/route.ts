import { NextRequest, NextResponse } from "next/server";
import { getAllSettings, setSetting, seedDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    seedDatabase();
    const settings = getAllSettings();
    const obj: Record<string, string> = {};
    for (const s of settings) {
      obj[s.key] = s.value;
    }
    return NextResponse.json(obj);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    seedDatabase();
    const body = await req.json();
    for (const [key, value] of Object.entries(body)) {
      setSetting(key, String(value));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
