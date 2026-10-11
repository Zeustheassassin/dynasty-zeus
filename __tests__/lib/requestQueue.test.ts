import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequestQueue } from "@/lib/requestQueue";

// Sleeper call-budget Stage 3 (10/10): the browser-wide queue in front of every Sleeper call —
// in-flight cap, token bucket (burst then a steady rate), strict FIFO, and a Retry-After pause.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 10, 18));
});
afterEach(() => vi.useRealTimers());

/** A task that stays open until `release()` — lets a test hold slots in flight. */
function heldTask() {
  let release!: () => void;
  const done = new Promise<void>((r) => { release = r; });
  return { task: () => done, release };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("createRequestQueue", () => {
  it("never has more than maxInFlight tasks open, and starts the next as one finishes", async () => {
    const q = createRequestQueue({ maxInFlight: 2, burst: 100, refillPerSec: 100 });
    const held = [heldTask(), heldTask(), heldTask(), heldTask()];
    const started: number[] = [];
    const runs = held.map((h, i) => q.run(async () => { started.push(i); await h.task(); return i; }));

    await flush();
    expect(started).toEqual([0, 1]);
    expect(q.stats()).toMatchObject({ inFlight: 2, waiting: 2 });

    held[1].release();
    await flush();
    expect(started).toEqual([0, 1, 2]);

    held.forEach((h) => h.release());
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
    expect(q.stats()).toMatchObject({ inFlight: 0, waiting: 0 });
  });

  it("lets a burst through back to back, then paces at refillPerSec", async () => {
    const q = createRequestQueue({ maxInFlight: 50, burst: 5, refillPerSec: 2 });
    const started: number[] = [];
    const runs = Array.from({ length: 9 }, (_, i) => q.run(async () => { started.push(i); }));

    await flush();
    expect(started).toHaveLength(5); // the whole bucket at once

    await vi.advanceTimersByTimeAsync(499);
    expect(started).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toHaveLength(6); // one token every 500ms

    await vi.advanceTimersByTimeAsync(1500);
    expect(started).toHaveLength(9);
    await Promise.all(runs);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]); // FIFO
  });

  it("refills while idle, but never past the burst size", async () => {
    const q = createRequestQueue({ maxInFlight: 50, burst: 3, refillPerSec: 1 });
    await Promise.all([q.run(async () => {}), q.run(async () => {}), q.run(async () => {})]);
    expect(q.stats().tokens).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(q.stats().tokens).toBe(3);
  });

  it("keeps arrival order when a later request finds the bucket empty", async () => {
    const q = createRequestQueue({ maxInFlight: 50, burst: 1, refillPerSec: 1 });
    const order: string[] = [];
    const a = q.run(async () => { order.push("a"); });
    const b = q.run(async () => { order.push("b"); });
    const c = q.run(async () => { order.push("c"); });
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all([a, b, c]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("pauseFor holds every waiting and new request, then resumes; in-flight ones finish", async () => {
    const q = createRequestQueue({ maxInFlight: 1, burst: 100, refillPerSec: 100 });
    const first = heldTask();
    const started: string[] = [];
    const a = q.run(async () => { started.push("a"); await first.task(); });
    const b = q.run(async () => { started.push("b"); });
    await flush();
    expect(started).toEqual(["a"]);

    q.pauseFor(5_000);
    first.release();
    await a; // the request already in flight is not interrupted
    const c = q.run(async () => { started.push("c"); });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(started).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([b, c]);
    expect(started).toEqual(["a", "b", "c"]);
  });

  it("a shorter pause never cuts a longer one short", async () => {
    const q = createRequestQueue({ maxInFlight: 5, burst: 100, refillPerSec: 100 });
    q.pauseFor(10_000);
    q.pauseFor(1_000);
    let ran = false;
    const p = q.run(async () => { ran = true; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(ran).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(ran).toBe(true);
  });

  it("frees the slot when a task throws, and passes the error through", async () => {
    const q = createRequestQueue({ maxInFlight: 1, burst: 100, refillPerSec: 100 });
    await expect(q.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await q.run(async () => "next")).toBe("next");
    expect(q.stats().inFlight).toBe(0);
  });
});
