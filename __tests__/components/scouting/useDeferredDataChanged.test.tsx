// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDeferredDataChanged } from "@/components/scouting/shared/hooks/useDeferredDataChanged";

// Batch 4 (Sept 21 2026 audit): charting boards called the hub's onDataChanged() (8 queries +
// a full league-plays refetch) after EVERY charted play. This turns that into "mark dirty,
// reload once" — the reload fires only when the user is looking at hub-derived data, or when
// the board goes away.

const FLUSH_TABS = ["overview", "charts"] as const;

describe("useDeferredDataChanged", () => {
  it("does not reload on markDirty while on a non-flush tab", () => {
    const onDataChanged = vi.fn();
    const { result } = renderHook(
      ({ tab }) => useDeferredDataChanged(onDataChanged, tab, FLUSH_TABS),
      { initialProps: { tab: "chart" } },
    );

    result.current.markDirty();
    result.current.markDirty();
    result.current.markDirty();

    expect(onDataChanged).not.toHaveBeenCalled();
  });

  it("reloads immediately on markDirty when already on a flush tab", () => {
    const onDataChanged = vi.fn();
    const { result } = renderHook(
      ({ tab }) => useDeferredDataChanged(onDataChanged, tab, FLUSH_TABS),
      { initialProps: { tab: "overview" } },
    );

    result.current.markDirty();
    expect(onDataChanged).toHaveBeenCalledTimes(1);

    // Nothing pending — a second markDirty with no new dirt in between still only
    // reloads once per actual write.
    result.current.markDirty();
    expect(onDataChanged).toHaveBeenCalledTimes(2);
  });

  it("flushes exactly once when the user switches into a flush tab after several writes", () => {
    const onDataChanged = vi.fn();
    const { result, rerender } = renderHook(
      ({ tab }) => useDeferredDataChanged(onDataChanged, tab, FLUSH_TABS),
      { initialProps: { tab: "chart" } },
    );

    result.current.markDirty();
    result.current.markDirty();
    result.current.markDirty();
    expect(onDataChanged).not.toHaveBeenCalled();

    rerender({ tab: "charts" });
    expect(onDataChanged).toHaveBeenCalledTimes(1);

    // No further writes since the flush — switching tabs again doesn't reload again.
    rerender({ tab: "games" });
    rerender({ tab: "charts" });
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  });

  it("does not reload on unmount if nothing was written", () => {
    const onDataChanged = vi.fn();
    const { unmount } = renderHook(() => useDeferredDataChanged(onDataChanged, "chart", FLUSH_TABS));

    unmount();
    expect(onDataChanged).not.toHaveBeenCalled();
  });

  it("flushes pending writes on unmount (board closing / navigating away)", () => {
    const onDataChanged = vi.fn();
    const { result, unmount } = renderHook(() => useDeferredDataChanged(onDataChanged, "chart", FLUSH_TABS));

    result.current.markDirty();
    expect(onDataChanged).not.toHaveBeenCalled();

    unmount();
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  });

  it("always uses the latest onDataChanged/tab even though markDirty is a stable reference", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ onDataChanged, tab }) => useDeferredDataChanged(onDataChanged, tab, FLUSH_TABS),
      { initialProps: { onDataChanged: first, tab: "chart" } },
    );
    const markDirty = result.current.markDirty;

    rerender({ onDataChanged: second, tab: "overview" });
    markDirty(); // same function identity as before the rerender

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("flush() is a no-op when nothing is dirty", () => {
    const onDataChanged = vi.fn();
    const { result } = renderHook(() => useDeferredDataChanged(onDataChanged, "overview", FLUSH_TABS));

    result.current.flush();
    expect(onDataChanged).not.toHaveBeenCalled();
  });
});
