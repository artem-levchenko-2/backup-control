/**
 * Next.js instrumentation — runs once on server startup.
 * Starts the background job scheduler.
 */
export async function register() {
  // Only start the scheduler in the Node.js server runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
