/**
 * Retries an async operation up to `attempts` times with exponential back-off.
 * Delays: 200 ms, 400 ms, 800 ms, … (200 × 2^i between each attempt).
 * Throws the last error if all attempts fail.
 */
export async function withRetry<T>(fn: () => PromiseLike<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 200 * 2 ** i));
    }
  }
  throw lastErr;
}
