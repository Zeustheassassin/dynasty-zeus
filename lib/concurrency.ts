// Pure, dependency-free concurrency helper — safe to import from client code
// (unlike lib/sleeperServer.ts, which bypasses the client proxy/cache by design).

/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once, as a ROLLING POOL:
 * the next item starts the instant any slot frees, rather than waiting for a whole batch to
 * finish first. Returns results in ITEM order, not completion order.
 *
 * This replaced a chunk-then-`Promise.all` version that awaited every item in a group of
 * `limit` before starting the next group. That left `limit - 1` slots idle for as long as the
 * slowest item in a group took — routine here, since a Sleeper call retrying a 429 backs off
 * for seconds while its neighbours return in milliseconds. The contract below is what every
 * caller already depended on under the old shape and is deliberately unchanged:
 *
 *   - **Result order is input order.** Callers render straight off the returned array
 *     (`useGamedayDashboard`'s per-league entries, `useDraftScout`'s per-league picks), so
 *     completion order must never leak into it.
 *   - **A rejection from any item fails the whole call**, and dispatch then stops. Two edges
 *     differ slightly from the old `Promise.all`-per-chunk shape, in opposite directions, and
 *     no caller currently depends on either: every one of them either catches inside `fn` or
 *     calls `safeFetch`, which returns null rather than throwing.
 *       (a) Items already in flight are awaited before the rejection surfaces. The old version
 *           rejected the moment `Promise.all` saw the first failure, leaving its siblings
 *           running unobserved past the point the caller had moved on; waiting is the safer end
 *           of that.
 *       (b) Up to `limit - 1` items can still be handed out alongside the failure, because a
 *           worker freed by a sibling that succeeded resumes before the failing sibling does,
 *           and nothing can observe a rejection until that promise's own continuation runs.
 *     Callers that want per-item fault isolation still get it the same way — catch inside `fn`.
 *   - **`shouldBail`, when given, stops NEW items from starting** so a caller can abandon work
 *     whose result is no longer wanted (a newer request superseded this one; a cron ran out of
 *     wall-clock budget) without aborting calls already in flight. It is now checked before
 *     each item rather than once per group, so a bail takes effect up to `limit - 1` items
 *     sooner; every caller either discards the whole result on bail or counts what came back,
 *     and both want the bail as early as possible.
 *   - **On bail the returned array is the prefix of items that actually ran** (same as the old
 *     version, where that prefix was always a whole number of chunks). `items.length -
 *     results.length` is therefore the skipped count — which is how both crons report it.
 *
 * A `limit` below 1 (or NaN) runs serially instead of hanging, which is what the old
 * `i += limit` loop did with a limit of 0.
 */
export async function withConcurrency<T, R = void>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
  opts?: { shouldBail?: () => boolean }
): Promise<R[]> {
  const results: R[] = [];
  // Workers pull from a shared cursor, so the set of dispatched indices is always a contiguous
  // prefix of `items` even though they finish out of order.
  let next = 0;
  let stopped = false;
  // A mutable holder rather than a `let`: TypeScript's control-flow analysis doesn't see
  // assignments made inside the worker closures, so a nullable `let` would narrow to `null`
  // by the time it's read below.
  const failure: { failed: boolean; err: unknown } = { failed: false, err: undefined };

  const runWorker = async (): Promise<void> => {
    while (!stopped) {
      if (opts?.shouldBail?.()) {
        stopped = true;
        break;
      }
      if (next >= items.length) break;
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (err) {
        // Keep the first failure and stop handing out work. Every worker's rejection is caught
        // here, so a second concurrent failure can't escape as an unhandled rejection.
        if (!failure.failed) {
          failure.failed = true;
          failure.err = err;
        }
        stopped = true;
        break;
      }
    }
  };

  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: workerCount }, runWorker));

  if (failure.failed) throw failure.err;
  return results;
}
