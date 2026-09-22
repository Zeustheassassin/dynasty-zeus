// Pure, dependency-free chunked-concurrency helper — safe to import from client code
// (unlike lib/sleeperServer.ts, which bypasses the client proxy/cache by design).

/**
 * Runs `fn` over `items` in chunks of at most `limit` concurrent calls, awaiting each
 * chunk (via `Promise.all`, so one rejection fails the whole chunk — callers that need
 * per-item fault isolation should catch inside `fn`) before starting the next. Returns
 * results in item order.
 *
 * `shouldBail`, when given, is checked before each new chunk starts so a caller can stop
 * issuing further chunks once its result is no longer wanted (e.g. a newer request
 * superseded this one) without aborting calls already in flight.
 */
export async function withConcurrency<T, R = void>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
  opts?: { shouldBail?: () => boolean }
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    if (opts?.shouldBail?.()) break;
    const slice = items.slice(i, i + limit);
    results.push(...(await Promise.all(slice.map(fn))));
  }
  return results;
}
