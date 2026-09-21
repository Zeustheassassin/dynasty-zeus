import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// afterResponse wraps Next's after() (Vercel waitUntil) so fire-and-forget work like cache writes
// isn't frozen when the serverless handler returns. after() throws outside a request scope, so the
// wrapper has to cope with both worlds.

const h = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after: h.after }));

import { afterResponse } from "@/lib/afterResponse";

beforeEach(() => {
  h.after.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("inside a request scope", () => {
  it("hands the task to after() and does not start it early", () => {
    let scheduled: (() => Promise<void>) | undefined;
    h.after.mockImplementation((fn: () => Promise<void>) => { scheduled = fn; });
    const task = vi.fn(async () => {});

    afterResponse(task);

    expect(h.after).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled();
    return scheduled!().then(() => expect(task).toHaveBeenCalledTimes(1));
  });

  it("the scheduled callback swallows and logs a rejection (the response already went out)", async () => {
    let scheduled: (() => Promise<void>) | undefined;
    h.after.mockImplementation((fn: () => Promise<void>) => { scheduled = fn; });

    afterResponse(async () => { throw new Error("db down"); });

    await expect(scheduled!()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("outside a request scope (after() throws — unit tests, scripts)", () => {
  beforeEach(() => {
    h.after.mockImplementation(() => { throw new Error("`after` was called outside a request scope"); });
  });

  it("still runs the task", () => {
    const task = vi.fn(async () => {});
    afterResponse(task);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("logs a rejected task instead of leaking an unhandled rejection", async () => {
    afterResponse(async () => { throw new Error("boom"); });
    await new Promise((r) => setTimeout(r, 0));
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("logs a task that throws synchronously instead of throwing at the caller", async () => {
    expect(() => afterResponse((() => { throw new Error("sync boom"); }) as () => Promise<unknown>)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
