// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjections } from "@/hooks/useProjections";

// The bug this guards against: projectionData carries no league_id/scoring on
// its rows — it's fpts baked with whatever scoring was active when computed.
// Switching leagues (different scoring_settings) must invalidate that cache
// instead of silently letting the Simulator reuse another league's fpts.
describe("useProjections — scoring-settings cache invalidation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resets projectionLoaded/projectionData once the league's scoring settings change", async () => {
    const scoringA = { rec: 1 };
    const scoringB = { rec: 0.5 };
    const { result, rerender } = renderHook(
      ({ scoring }) => useProjections({}, scoring),
      { initialProps: { scoring: scoringA as Record<string, number> | null } }
    );

    await act(async () => {
      await result.current.loadProjections(1);
    });
    expect(result.current.projectionLoaded).toBe(true);

    rerender({ scoring: scoringB });
    expect(result.current.projectionLoaded).toBe(false);
    expect(result.current.projectionData).toEqual([]);
  });

  it("does not reset when the scoring settings object changes reference but not content", async () => {
    const { result, rerender } = renderHook(
      ({ scoring }) => useProjections({}, scoring),
      { initialProps: { scoring: { rec: 1 } as Record<string, number> | null } }
    );

    await act(async () => {
      await result.current.loadProjections(1);
    });
    expect(result.current.projectionLoaded).toBe(true);

    // A brand-new object with identical values (e.g. selectedLeague re-fetched
    // from Supabase) must not be treated as a scoring change.
    rerender({ scoring: { rec: 1 } });
    expect(result.current.projectionLoaded).toBe(true);
  });
});
