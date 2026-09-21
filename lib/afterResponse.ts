import { after } from "next/server";
import { logger } from "./logger";

const log = logger("lib/afterResponse");

/**
 * Runs `task` once the response has been sent, keeping the serverless invocation alive until it
 * settles (Next's `after`, backed by Vercel's `waitUntil`). A bare un-awaited promise can be frozen
 * mid-flight when the handler returns, silently dropping fire-and-forget work such as cache writes.
 *
 * Outside a request scope (unit tests, scripts) `after` throws, so the task simply starts right away.
 * A failing task is logged, never thrown — it must not affect the response that already went out.
 */
export function afterResponse(task: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await task();
    } catch (err) {
      log.error("after-response task failed", { err: String(err) });
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
