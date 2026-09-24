import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPacer } from "@/lib/sleeperServer";

// Fake timers: the pacer's whole job is to wait, and a real 60/min pacer would
// make this suite take a minute.
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Runs `fn`, draining timers as they are scheduled, and returns when it settles. */
async function runWithTimers<T>(fn: () => Promise<T>): Promise<T> {
  const p = fn();
  await vi.runAllTimersAsync();
  return p;
}

describe("createPacer", () => {
  it("lets the first request through immediately", async () => {
    const pace = createPacer(60); // one per second
    const started = Date.now();
    await runWithTimers(() => pace());
    expect(Date.now() - started).toBe(0);
  });

  it("spaces subsequent requests by 60s / rpm", async () => {
    const pace = createPacer(60); // 1000 ms apart
    const t0 = Date.now();
    const stamps: number[] = [];
    await runWithTimers(async () => {
      for (let i = 0; i < 4; i++) { await pace(); stamps.push(Date.now() - t0); }
    });
    expect(stamps).toEqual([0, 1000, 2000, 3000]);
  });

  it("holds concurrent callers to the same overall rate", async () => {
    // Ten workers all awaiting the pacer must still collectively issue at the
    // configured rate — this is the property bounded concurrency alone lacks.
    const pace = createPacer(600); // 100 ms apart
    const t0 = Date.now();
    const stamps: number[] = [];
    await runWithTimers(async () => {
      await Promise.all(
        Array.from({ length: 10 }, async () => { await pace(); stamps.push(Date.now() - t0); }),
      );
    });
    expect(stamps.sort((a, b) => a - b)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it("does not bank credit during a lull and then fire a burst", async () => {
    // A naive implementation that tracks "requests owed" would let a long gap
    // accumulate slots and then release them all at once, overshooting the
    // ceiling exactly when traffic resumes.
    const pace = createPacer(60); // 1000 ms apart
    await runWithTimers(() => pace());

    vi.setSystemTime(Date.now() + 60_000); // a minute of silence

    const t0 = Date.now();
    const stamps: number[] = [];
    await runWithTimers(async () => {
      for (let i = 0; i < 3; i++) { await pace(); stamps.push(Date.now() - t0); }
    });
    // First one is free (schedule had fallen behind), then normal spacing —
    // not three instant releases.
    expect(stamps).toEqual([0, 1000, 2000]);
  });

  it("treats a non-positive rate as one request per minute rather than dividing by zero", async () => {
    const pace = createPacer(0);
    const t0 = Date.now();
    const stamps: number[] = [];
    await runWithTimers(async () => {
      for (let i = 0; i < 2; i++) { await pace(); stamps.push(Date.now() - t0); }
    });
    expect(stamps).toEqual([0, 60_000]);
    expect(Number.isFinite(stamps[1])).toBe(true);
  });
});
