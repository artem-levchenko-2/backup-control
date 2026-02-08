import { NextResponse } from "next/server";
import { getSetting } from "@/lib/db";

export async function POST() {
  const botToken = getSetting("telegram_bot_token");
  const chatId = getSetting("telegram_chat_id");

  if (!botToken || !chatId) {
    return NextResponse.json(
      { error: "Telegram Bot Token and Chat ID must be configured in Settings." },
      { status: 400 }
    );
  }

  const message = [
    "✅ *Backup Control — Test Notification*",
    "",
    "Your Telegram integration is working correctly!",
    "",
    `🕐 ${new Date().toISOString()}`,
    "📡 Sent from Homelab Backup Control Plane",
  ].join("\n");

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      return NextResponse.json(
        {
          error: `Telegram API error: ${data.description || "Unknown error"}`,
          details: data,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Test notification sent successfully!",
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to connect to Telegram API: ${errorMessage}` },
      { status: 502 }
    );
  }
}
