/**
 * Next.js instrumentation — runs once on server startup.
 * Starts the background job scheduler.
 */
export async function register() {
  // Only start the scheduler in the Node.js server runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverStaleRunningRuns } = await import("./lib/db");
    const { startScheduler } = await import("./lib/scheduler");
    const recovered = recoverStaleRunningRuns();
    if (recovered > 0) {
      console.log(`[startup] Recovered ${recovered} stale running run(s) -> cancelled`);
    }
    startScheduler();
  }
}
