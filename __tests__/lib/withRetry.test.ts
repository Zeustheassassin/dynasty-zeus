import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry } from "@/lib/withRetry";

describe("withRetry", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("resolves on the first attempt without any retry", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const promise = withRetry(fn, 3);
    await vi.runAllTimersAsync();
    expect(await promise).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once and succeeds on the second attempt", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("first fail"))
      .mockResolvedValue("ok");
    const promise = withRetry(fn, 3);
    await vi.runAllTimersAsync();
    expect(await promise).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("uses all available attempts before returning a successful result", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValue("ok");
    const promise = withRetry(fn, 3);
    await vi.runAllTimersAsync();
    expect(await promise).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error when all attempts fail", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("permanent failure"));
    const promise = withRetry(fn, 3);
    await Promise.all([vi.runAllTimersAsync(), expect(promise).rejects.toThrow("permanent failure")]);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the error from the final attempt (not an earlier one)", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("early error"))
      .mockRejectedValueOnce(new Error("early error"))
      .mockRejectedValue(new Error("final error"));
    const promise = withRetry(fn, 3);
    await Promise.all([vi.runAllTimersAsync(), expect(promise).rejects.toThrow("final error")]);
  });

  it("defaults to 3 attempts when no count is provided", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const promise = withRetry(fn);
    await Promise.all([vi.runAllTimersAsync(), expect(promise).rejects.toThrow()]);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects the 200ms initial delay — does not retry immediately", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    withRetry(fn, 2);

    // Drain the microtask queue so the first fn() call settles
    await Promise.resolve();
    await Promise.resolve();

    // fn fired once; retry is waiting behind the 200ms timer
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance past the 200ms delay → second call fires
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("uses exponential back-off: 200ms after attempt 1, 400ms after attempt 2", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, 3);
    await vi.runAllTimersAsync();
    await promise;

    const delays = setTimeoutSpy.mock.calls.map((c) => c[1] as number);
    expect(delays).toContain(200); // 200 * 2^0
    expect(delays).toContain(400); // 200 * 2^1
  });

  it("does not fire a delay after the final failing attempt", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const promise = withRetry(fn, 3);
    await Promise.all([vi.runAllTimersAsync(), expect(promise).rejects.toThrow()]);

    // 3 attempts → 2 inter-attempt delays (not 3)
    const delays = setTimeoutSpy.mock.calls.map((c) => c[1] as number);
    expect(delays).toHaveLength(2);
  });
});
