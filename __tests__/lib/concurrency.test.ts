import { describe, it, expect } from "vitest";
import { withConcurrency } from "@/lib/concurrency";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("withConcurrency", () => {
  it("never has more than `limit` calls in flight at once", async () => {
    let started = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const pending: (() => void)[] = [];
    const fn = (n: number) => {
      started++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const { promise, resolve } = deferred<number>();
      pending.push(() => { inFlight--; resolve(n); });
      return promise;
    };

    const runPromise = withConcurrency([1, 2, 3, 4, 5], fn, 2);
    // Let the first chunk (2 calls) start.
    await Promise.resolve();
    await Promise.resolve();
    expect(maxInFlight).toBe(2);

    // Release calls one at a time until all 5 items have been dispatched and resolved —
    // `started` only ever increases, unlike the pending queue, which drains and refills
    // per chunk, so it's the only safe loop-termination signal here.
    while (started < 5 || pending.length > 0) {
      pending.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    await expect(runPromise).resolves.toEqual([1, 2, 3, 4, 5]);
  });

  it("returns results in item order across chunks", async () => {
    const results = await withConcurrency([1, 2, 3, 4], async (n) => n * 10, 3);
    expect(results).toEqual([10, 20, 30, 40]);
  });

  it("stops issuing new chunks once shouldBail returns true, without throwing", async () => {
    const called: number[] = [];
    const results = await withConcurrency(
      [1, 2, 3, 4, 5, 6],
      async (n) => { called.push(n); return n; },
      2,
      { shouldBail: () => called.length >= 2 }
    );
    // First chunk (2 items) runs before shouldBail is checked again; the second chunk never starts.
    expect(called).toEqual([1, 2]);
    expect(results).toEqual([1, 2]);
  });

  it("propagates a rejection from any item in a chunk (fail-fast, not per-item isolated)", async () => {
    await expect(
      withConcurrency([1, 2, 3], async (n) => { if (n === 2) throw new Error("boom"); return n; }, 3)
    ).rejects.toThrow("boom");
  });
});
