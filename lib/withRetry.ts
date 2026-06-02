/**
 * Retries an async operation up to `attempts` times with exponential back-off.
 * Delays: 200 ms, 400 ms, 800 ms, … (200 × 2^i between each attempt).
 * Throws the last error if all attempts fail.
 *
 * `shouldRetry` lets callers skip retries for deterministic failures (e.g. a
 * 4xx HTTP response that will never succeed on retry). It defaults to retrying
 * every error, preserving the original behaviour. When it returns false the
 * error is re-thrown immediately without further attempts or back-off.
 */
export async function withRetry<T>(
  fn: () => PromiseLike<T>,
  attempts = 3,
  shouldRetry: (err: unknown) => boolean = () => true,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (i >= attempts - 1 || !shouldRetry(err)) break;
      await new Promise((r) => setTimeout(r, 200 * 2 ** i));
    }
  }
  throw lastErr;
}
