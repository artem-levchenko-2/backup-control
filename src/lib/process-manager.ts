// ============================================================
// In-memory tracker for running rclone child processes
// Allows force-stopping jobs via their run ID
// ============================================================

import type { ChildProcess } from "child_process";

const runningProcesses = new Map<number, ChildProcess>();

export function registerProcess(runId: number, child: ChildProcess): void {
  runningProcesses.set(runId, child);
}

export function unregisterProcess(runId: number): void {
  runningProcesses.delete(runId);
}

export function stopProcess(runId: number): boolean {
  const child = runningProcesses.get(runId);
  if (!child || child.killed) return false;
  child.kill("SIGTERM");
  // Force kill after 5 seconds if still alive
  setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }, 5000);
  return true;
}

export function isProcessRunning(runId: number): boolean {
  const child = runningProcesses.get(runId);
  return !!child && !child.killed;
}
