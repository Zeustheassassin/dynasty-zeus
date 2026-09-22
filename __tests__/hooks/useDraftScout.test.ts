// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDraftScout } from "@/hooks/useDraftScout";
import { TARGET_USER_LEAGUE_CONCURRENCY } from "@/lib/constants";
import type { SleeperLeague, SleeperPlayer } from "@/lib/types";

// Sept 22 code-review 50-league-scalability finding, Tier 1 #4: loadDraftScout fanned out
// across every one of the TARGET user's leagues at once (drafts, then draft picks per league)
// — scaling with the LOOKED-UP user's league count, not the viewer's own, so even a
// small-league viewer could trip a burst by looking up a whale. This test covers the fix: a
// bounded per-league concurrency cap.

type Fn = (...args: never[]) => unknown;
const api = vi.hoisted(() => ({ impl: {} as Record<string, Fn> }));
vi.mock("@/lib/sleeperApi", () => ({
  sleeperApi: new Proxy({}, { get: (_t, k: string) => api.impl[k] ?? (async () => []) }),
}));

function league(id: string): SleeperLeague {
  return {
    league_id: id, name: id, season: "2026", season_type: "regular", status: "in_season",
    sport: "nfl", total_rosters: 12, roster_positions: [], settings: {
      playoff_week_start: 15, playoff_teams: 6, num_teams: 12,
    }, scoring_settings: {}, avatar: null, draft_id: null, previous_league_id: null,
  };
}

const players: Record<string, SleeperPlayer> = {};

beforeEach(() => { api.impl = {}; });

describe("useDraftScout — concurrency cap", () => {
  it(`fetches at most TARGET_USER_LEAGUE_CONCURRENCY (${TARGET_USER_LEAGUE_CONCURRENCY}) leagues at once, deferring the rest`, async () => {
    const leagues = Array.from(
      { length: TARGET_USER_LEAGUE_CONCURRENCY + 1 },
      (_, i) => league(`L${i + 1}`)
    );
    api.impl.getUserLeagues = vi.fn(async () => leagues);
    let callCount = 0;
    const releasers: (() => void)[] = [];
    api.impl.getLeagueDrafts = vi.fn(() => {
      callCount++;
      return new Promise((resolve) => releasers.push(() => resolve([])));
    });

    const { result } = renderHook(() => useDraftScout(players));
    act(() => { result.current.loadDraftScout("me"); });

    await waitFor(() => expect(callCount).toBeGreaterThan(0));
    // The cap's calls fire synchronously together — the extra league must not have started yet.
    expect(callCount).toBe(TARGET_USER_LEAGUE_CONCURRENCY);

    releasers.forEach((release) => release());
    await waitFor(() => expect(callCount).toBe(TARGET_USER_LEAGUE_CONCURRENCY + 1));
    releasers.forEach((release) => release());
  });
});
