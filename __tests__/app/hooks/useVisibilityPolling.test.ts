// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVisibilityPolling } from "@/app/hooks/useVisibilityPolling";

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useVisibilityPolling", () => {
  it("calls back every interval, and not on mount", async () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityPolling(cb, 1000));
    expect(cb).not.toHaveBeenCalled();
    // Async advance: each tick awaits its callback, so ticks need microtasks flushed between them.
    await vi.advanceTimersByTimeAsync(3000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("does nothing when the interval is null (polling disabled)", () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityPolling(cb, null));
    vi.advanceTimersByTime(10_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("pauses while the tab is hidden", () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityPolling(cb, 1000));
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    vi.advanceTimersByTime(10_000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("polls immediately on return if the data went stale, then resumes the cadence", async () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityPolling(cb, 1000));
    setVisibility("hidden");
    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();

    setVisibility("visible");
    expect(cb).toHaveBeenCalledTimes(1); // immediate catch-up
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("does not poll immediately on return if it just ran", () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityPolling(cb, 1000));
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    setVisibility("hidden");
    setVisibility("visible");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("never overlaps: a tick is skipped while the previous callback is still running", async () => {
    let release: () => void = () => {};
    const cb = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    renderHook(() => useVisibilityPolling(cb, 1000));

    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000); // slow call still in flight
    expect(cb).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("always calls the latest callback without restarting the timer", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useVisibilityPolling(cb, 1000), { initialProps: { cb: first } });
    rerender({ cb: second });
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops on unmount and when the interval becomes null", () => {
    const cb = vi.fn();
    const { rerender, unmount } = renderHook(({ ms }) => useVisibilityPolling(cb, ms), { initialProps: { ms: 1000 as number | null } });
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);

    rerender({ ms: null });
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1);

    rerender({ ms: 1000 });
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(2);
    unmount();
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("swallows a callback that throws so the poll keeps running", async () => {
    const cb = vi.fn(() => { throw new Error("boom"); });
    renderHook(() => useVisibilityPolling(cb, 1000));
    await vi.advanceTimersByTimeAsync(3000);
    expect(cb).toHaveBeenCalledTimes(3);
  });
});
