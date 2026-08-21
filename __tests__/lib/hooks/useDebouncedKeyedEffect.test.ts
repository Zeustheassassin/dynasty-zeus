// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedKeyedEffect } from "@/lib/hooks/useDebouncedKeyedEffect";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedKeyedEffect", () => {
  it("collapses rapid repeated calls with the same key into a single call carrying the last value", () => {
    const { result } = renderHook(() => useDebouncedKeyedEffect(500));
    const calls: string[] = [];

    act(() => {
      result.current("player:1", () => calls.push("a"));
      result.current("player:1", () => calls.push("b"));
      result.current("player:1", () => calls.push("c"));
    });

    // Nothing fires until the debounce window elapses.
    expect(calls).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Only the LAST scheduled call for that key fires — not "a" or "b".
    expect(calls).toEqual(["c"]);
  });

  it("keeps different keys independent — each debounces on its own", () => {
    const { result } = renderHook(() => useDebouncedKeyedEffect(500));
    const calls: string[] = [];

    act(() => {
      result.current("player:1", () => calls.push("p1"));
      result.current("player:2", () => calls.push("p2"));
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(calls.sort()).toEqual(["p1", "p2"]);
  });

  it("a call arriving after the window closes fires again as a fresh debounce", () => {
    const { result } = renderHook(() => useDebouncedKeyedEffect(500));
    const calls: string[] = [];

    act(() => {
      result.current("k", () => calls.push("first"));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(calls).toEqual(["first"]);

    act(() => {
      result.current("k", () => calls.push("second"));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(calls).toEqual(["first", "second"]);
  });

  it("clears pending timers on unmount so an unmounted caller's write never fires", () => {
    const { result, unmount } = renderHook(() => useDebouncedKeyedEffect(500));
    const calls: string[] = [];

    act(() => {
      result.current("k", () => calls.push("should-not-fire"));
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(calls).toEqual([]);
  });
});
