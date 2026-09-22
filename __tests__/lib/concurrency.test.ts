import { describe, it, expect, vi } from "vitest";
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
    // Let the first `limit` calls start.
    await Promise.resolve();
    await Promise.resolve();
    expect(maxInFlight).toBe(2);

    // Release calls one at a time until all 5 items have been dispatched and resolved —
    // `started` only ever increases, unlike the pending queue, which drains and refills as
    // slots turn over, so it's the only safe loop-termination signal here.
    while (started < 5 || pending.length > 0) {
      pending.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    await expect(runPromise).resolves.toEqual([1, 2, 3, 4, 5]);
  });

  it("returns results in item order", async () => {
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
    // Two items are handed out before the third worker re-checks shouldBail and stops.
    expect(called).toEqual([1, 2]);
    expect(results).toEqual([1, 2]);
  });

  it("propagates a rejection from any item (fail-fast, not per-item isolated)", async () => {
    await expect(
      withConcurrency([1, 2, 3], async (n) => { if (n === 2) throw new Error("boom"); return n; }, 3)
    ).rejects.toThrow("boom");
  });
});

// -- Rolling-pool contract ---------------------------------------------------
// Sept 22 deferred follow-up #2: withConcurrency used to chunk items into groups of `limit`
// and await the WHOLE group before starting the next, so one slow item (a Sleeper call backing
// off a 429) left the other limit-1 slots idle. It is now a rolling pool. These tests pin the
// properties every existing caller already depended on under the old shape, since a rolling
// rewrite is exactly where they are easy to break silently.

/** Let queued microtasks drain without advancing real time. */
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe("withConcurrency - rolling pool", () => {
  it("returns results in INPUT order even when items complete in reverse order", async () => {
    const gates = new Map<number, () => void>();
    const completed: number[] = [];
    const run = withConcurrency(
      [1, 2, 3, 4],
      (n: number) => new Promise<number>((resolve) => {
        gates.set(n, () => { completed.push(n); resolve(n * 10); });
      }),
      4
    );
    await tick();

    // Settle them backwards - the single easiest thing for a rolling rewrite to leak into the
    // result array, and callers like useGamedayDashboard render straight off that order.
    [4, 3, 2, 1].forEach((n) => gates.get(n)!());

    await expect(run).resolves.toEqual([10, 20, 30, 40]);
    expect(completed).toEqual([4, 3, 2, 1]);
  });

  it("starts the next item as soon as ONE slot frees, not when the whole group finishes", async () => {
    const started: number[] = [];
    const gates = new Map<number, () => void>();
    const run = withConcurrency(
      [1, 2, 3, 4],
      (n: number) => {
        started.push(n);
        return new Promise<number>((resolve) => gates.set(n, () => resolve(n)));
      },
      2
    );

    await tick();
    expect(started).toEqual([1, 2]);

    // Release ONLY item 2 - item 1 is still in flight. The old chunk-then-Promise.all version
    // could not have started item 3 here; it waited for every item in the group.
    gates.get(2)!();
    await tick();
    expect(started).toEqual([1, 2, 3]);

    gates.get(1)!();
    await tick();
    expect(started).toEqual([1, 2, 3, 4]);

    gates.get(3)!();
    gates.get(4)!();
    await expect(run).resolves.toEqual([1, 2, 3, 4]);
  });

  it("never exceeds `limit` in flight while rolling through items of varying latency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await withConcurrency(
      [40, 5, 30, 10, 25, 0, 15, 20],
      async (ms: number) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, ms));
        inFlight--;
        return ms;
      },
      3
    );
    expect(maxInFlight).toBe(3);
    expect(results).toEqual([40, 5, 30, 10, 25, 0, 15, 20]);
  });

  it("checks shouldBail before every item, not once per group of `limit`", async () => {
    const called: number[] = [];
    const results = await withConcurrency(
      [1, 2, 3, 4, 5, 6, 7, 8],
      async (n) => { called.push(n); return n; },
      4,
      { shouldBail: () => called.length >= 2 }
    );
    // The old version checked once per chunk, so all 4 of the first chunk ran before the bail
    // was re-evaluated. Bailing sooner is what useLeagueOverview's staleness guard and both
    // crons' TIME_BUDGET_MS guards want.
    expect(called).toEqual([1, 2]);
    expect(results).toEqual([1, 2]);
  });

  it("returns a dense prefix on bail, so items.length - results.length is the skipped count", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const called: number[] = [];
    const results = await withConcurrency(
      items,
      async (n) => { called.push(n); await new Promise((r) => setTimeout(r, n % 3)); return n; },
      3,
      { shouldBail: () => called.length >= 5 }
    );
    // Both crons report skipped work as items.length - results.length, which only holds if the
    // dispatched set is a contiguous prefix with no holes despite out-of-order completion.
    expect(called).toEqual(items.slice(0, called.length));
    expect(results).toEqual(called);
    expect(results.some((r) => r === undefined)).toBe(false);
  });

  it("stops handing out new items once a rejection lands", async () => {
    const started: number[] = [];
    await expect(
      withConcurrency(
        [1, 2, 3, 4, 5, 6],
        async (n) => { started.push(n); if (n === 2) throw new Error("boom"); return n; },
        2
      )
    ).rejects.toThrow("boom");
    // 1 and 2 start together. 3 is picked up by the worker that item 1 freed, one microtask
    // before item 2's rejection latches - a pool cannot see a sibling's failure until that
    // sibling resumes, so up to limit-1 items can still be handed out alongside it. What
    // matters is that dispatch then stops: the rest of the list never runs.
    expect(started).toEqual([1, 2, 3]);
    expect(started).not.toContain(4);
  });

  it("waits for in-flight items to settle before surfacing the rejection", async () => {
    let slowFinished = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const run = withConcurrency(
      [1, 2],
      async (n) => {
        if (n === 2) throw new Error("boom");
        await gate;
        slowFinished = true;
        return n;
      },
      2
    );

    let rejectedWhileSlowPending = false;
    const settled = run.then(
      () => "resolved",
      () => { rejectedWhileSlowPending = !slowFinished; return "rejected"; }
    );

    await tick();
    expect(slowFinished).toBe(false);

    release();
    await expect(settled).resolves.toBe("rejected");
    // The old Promise.all rejected the instant it saw the failure, leaving the slow sibling
    // running unobserved past the point the caller had moved on.
    expect(rejectedWhileSlowPending).toBe(false);
    expect(slowFinished).toBe(true);
  });

  it("does not let a second concurrent rejection escape as an unhandled rejection", async () => {
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(
        withConcurrency([1, 2], async (n) => { throw new Error(`boom-${n}`); }, 2)
      ).rejects.toThrow("boom-1");
      await tick();
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("handles an empty item list without calling fn", async () => {
    const fn = vi.fn(async (n: number) => n);
    await expect(withConcurrency([], fn, 3)).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("handles a limit larger than the item count", async () => {
    await expect(withConcurrency([1, 2], async (n) => n * 2, 10)).resolves.toEqual([2, 4]);
  });

  it("runs serially instead of hanging when limit is below 1", async () => {
    // The old `i += limit` loop spun forever on a limit of 0; a rolling pool would instead
    // spawn zero workers and silently drop every item, which is worse. Clamp to serial.
    await expect(withConcurrency([1, 2, 3], async (n) => n, 0)).resolves.toEqual([1, 2, 3]);
  });
});
