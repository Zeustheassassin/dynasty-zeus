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

// Regression coverage for a second bug found in the same area: the season÷17
// fallback used to trigger off a blind calendar cutoff (Jan-Aug = "offseason")
// instead of actually checking whether weekly data existed, so a real weekly
// consensus from FantasyPros/numberFire/Sleeper was ignored for 8 months of
// the year even when the source genuinely had current-week numbers.
describe("useProjections — weekly-data-first fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses real weekly Sleeper data without falling back to season÷17, regardless of calendar date", async () => {
    const players = {
      "1": { player_id: "1", full_name: "Test Back", position: "RB", team: "SF" },
    } as unknown as Record<string, import("@/lib/types").SleeperPlayer>;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/projections/nfl/") && /\/\d+\?season_type=regular&position\[\]/.test(url)) {
          // Weekly endpoint: real data already published for this week.
          return Promise.resolve({
            json: () => Promise.resolve([
              { player_id: "1", player: { position: "RB" }, stats: { rush_yd: 100 } },
            ]),
          });
        }
        // Season-fallback endpoint (per-position, singular `position=`) should
        // never even matter here since the weekly attempt already found data.
        return Promise.resolve({ json: () => Promise.resolve([]) });
      })
    );

    const { result } = renderHook(() => useProjections(players, null));
    await act(async () => {
      await result.current.loadProjections(1);
    });

    expect(result.current.projectionUsesSeasonFallback).toBe(false);
    expect(result.current.projectionData).toHaveLength(1);
    expect(result.current.projectionData[0].fpts).toBeCloseTo(10, 1); // 100 rush_yd * 0.1
  });

  it("falls back to season÷17 only when the weekly attempt truly comes back empty", async () => {
    const players = {
      "1": { player_id: "1", full_name: "Test Back", position: "RB", team: "SF" },
    } as unknown as Record<string, import("@/lib/types").SleeperPlayer>;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/projections/nfl/") && /\/\d+\?season_type=regular&position\[\]/.test(url)) {
          // Weekly endpoint: nothing published yet.
          return Promise.resolve({ json: () => Promise.resolve([]) });
        }
        // Season-fallback endpoint: has data.
        return Promise.resolve({
          json: () => Promise.resolve([
            { player_id: "1", player: { position: "RB" }, stats: { rush_yd: 1700 } },
          ]),
        });
      })
    );

    const { result } = renderHook(() => useProjections(players, null));
    await act(async () => {
      await result.current.loadProjections(1);
    });

    expect(result.current.projectionUsesSeasonFallback).toBe(true);
    expect(result.current.projectionData).toHaveLength(1);
    expect(result.current.projectionData[0].fpts).toBeCloseTo(10, 1); // 1700 * 0.1 / 17
  });

  it("never trusts FantasyPros' weekly numbers until Sleeper's year-explicit weekly fetch confirms real data exists", async () => {
    // FantasyPros' weekly scrape has no year of its own — it can return
    // *something* for "week 1" even in the dead of the prior season's
    // offseason with no way to tell it's stale. This must be ignored (and the
    // season÷17 fallback used instead) whenever Sleeper's own weekly fetch —
    // which does have the year baked into its URL — comes back empty.
    const players = {
      "1": { player_id: "1", full_name: "Test Back", position: "RB", team: "SF" },
    } as unknown as Record<string, import("@/lib/types").SleeperPlayer>;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/api/projections/fantasypros")) {
          return Promise.resolve({
            json: () => Promise.resolve([{ name: "Test Back", position: "RB", fpts: 999 }]),
          });
        }
        if (url.includes("/projections/nfl/") && /\/\d+\?season_type=regular&position\[\]/.test(url)) {
          // Sleeper's own weekly endpoint: no real data yet for this year/week.
          return Promise.resolve({ json: () => Promise.resolve([]) });
        }
        // Sleeper season-fallback endpoint: has data.
        return Promise.resolve({
          json: () => Promise.resolve([
            { player_id: "1", player: { position: "RB" }, stats: { rush_yd: 1700 } },
          ]),
        });
      })
    );

    const { result } = renderHook(() => useProjections(players, null));
    await act(async () => {
      await result.current.loadProjections(1, ["fantasypros"]);
    });

    expect(result.current.projectionSourceStatus.fantasypros).toBeUndefined();
    expect(result.current.projectionUsesSeasonFallback).toBe(true);
    expect(result.current.projectionData).toHaveLength(1);
    expect(result.current.projectionData[0].fpts).toBeCloseTo(10, 1); // season÷17, not FantasyPros' 999
  });
});
