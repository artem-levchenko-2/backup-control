// ============================================================
// Telegram Notification Utility
// ============================================================

import { getSetting } from "./db";

interface JobNotificationData {
  jobName: string;
  status: "success" | "failure";
  bytesTransferred: number;
  filesTransferred: number;
  errorsCount: number;
  durationSeconds: number;
  summary: string;
}

export async function sendJobNotification(data: JobNotificationData): Promise<void> {
  const enabled = getSetting("telegram_enabled");
  if (enabled !== "true") return;

  const botToken = getSetting("telegram_bot_token");
  const chatId = getSetting("telegram_chat_id");
  if (!botToken || !chatId) return;

  // Check if we should notify for this status
  if (data.status === "success" && getSetting("notify_on_success") !== "true") return;
  if (data.status === "failure" && getSetting("notify_on_failure") !== "true") return;

  const emoji = data.status === "success" ? "\u2705" : "\u274C";
  const statusText = data.status === "success" ? "Success" : "Failed";

  const message = [
    `${emoji} *Backup ${statusText}*: ${escapeMarkdown(data.jobName)}`,
    "",
    `\uD83D\uDCCA ${formatBytes(data.bytesTransferred)} transferred, ${data.filesTransferred} files`,
    `\u23F1 Duration: ${formatDuration(data.durationSeconds)}`,
    data.errorsCount > 0 ? `\u26A0\uFE0F Errors: ${data.errorsCount}` : "",
    "",
    escapeMarkdown(data.summary),
  ].filter(Boolean).join("\n");

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
    const result = await res.json();
    if (!result.ok) {
      console.error("[telegram] API error:", result.description);
    }
  } catch (err) {
    console.error("[telegram] Failed to send notification:", err);
  }
}

// ── Verify Notification ──────────────────────────────────────

interface VerifyNotificationData {
  jobName: string;
  status: "success" | "failure";
  matchedFiles: number;
  errorsCount: number;
  durationSeconds: number;
  summary: string;
}

export async function sendVerifyNotification(data: VerifyNotificationData): Promise<void> {
  const enabled = getSetting("telegram_enabled");
  if (enabled !== "true") return;

  const botToken = getSetting("telegram_bot_token");
  const chatId = getSetting("telegram_chat_id");
  if (!botToken || !chatId) return;

  // Notify on both success and failure for verification
  if (data.status === "failure" && getSetting("notify_on_failure") !== "true") return;
  if (data.status === "success" && getSetting("notify_on_success") !== "true") return;

  const emoji = data.status === "success" ? "\u2705" : "\u274C";
  const statusText = data.status === "success" ? "Verified" : "Verification Failed";

  const message = [
    `${emoji} *Backup ${statusText}*: ${escapeMarkdown(data.jobName)}`,
    "",
    `\uD83D\uDD0D ${data.matchedFiles} files checked`,
    data.errorsCount > 0 ? `\u26A0\uFE0F ${data.errorsCount} differences found` : "\u2705 All files match",
    `\u23F1 Duration: ${formatDuration(data.durationSeconds)}`,
    "",
    escapeMarkdown(data.summary),
  ].filter(Boolean).join("\n");

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
    const result = await res.json();
    if (!result.ok) {
      console.error("[telegram] Verify notification API error:", result.description);
    }
  } catch (err) {
    console.error("[telegram] Failed to send verify notification:", err);
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
