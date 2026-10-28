// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { refreshAllLeagueRosters, getMyOneOhOneOdds } from "@/components/LeagueHub/overviewTabHelpers";
import { OVERVIEW_REFRESH_ROSTERS_CONCURRENCY } from "@/lib/constants";
import type { SleeperLeague, SleeperRoster, AugmentedPick, SimRow, CachedSimRow } from "@/lib/types";

// Sept 22 code-review 50-league-scalability finding, Tier 1 #3: OverviewTab's manual "Refresh
// Rosters" button fanned out every league at once (4 concurrent Sleeper calls each, all
// guaranteed real requests via bypass:true) — the same unbounded-burst shape Batch 1 fixed for
// Gameday Dashboard. These tests cover the extracted fix: a bounded per-league concurrency cap,
// with per-league progress reporting preserved.

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

beforeEach(() => {
  api.impl = {};
  localStorage.clear();
});

describe("refreshAllLeagueRosters — concurrency cap", () => {
  it(`fetches at most OVERVIEW_REFRESH_ROSTERS_CONCURRENCY (${OVERVIEW_REFRESH_ROSTERS_CONCURRENCY}) leagues at once, deferring the rest`, async () => {
    const leagues = Array.from(
      { length: OVERVIEW_REFRESH_ROSTERS_CONCURRENCY + 1 },
      (_, i) => league(`L${i + 1}`)
    );
    let callCount = 0;
    const releasers: (() => void)[] = [];
    api.impl.getLeagueRosters = vi.fn(() => {
      callCount++;
      return new Promise((resolve) => releasers.push(() => resolve([])));
    });

    const done = vi.fn();
    const finished = refreshAllLeagueRosters(leagues, done);

    await waitFor(() => expect(callCount).toBeGreaterThan(0));
    // The cap's calls fire synchronously together — the extra league must not have started yet.
    expect(callCount).toBe(OVERVIEW_REFRESH_ROSTERS_CONCURRENCY);

    // Releasing only the first chunk lets the next chunk start (and register its own releaser);
    // re-running release() afterward is a no-op on the already-settled ones and unblocks the new one.
    releasers.forEach((release) => release());
    await waitFor(() => expect(callCount).toBe(OVERVIEW_REFRESH_ROSTERS_CONCURRENCY + 1));
    releasers.forEach((release) => release());
    await finished;
  });

  it("calls onLeagueDone once per completed league, not just once at the end", async () => {
    const leagues = [league("A"), league("B")];
    const done = vi.fn();

    await refreshAllLeagueRosters(leagues, done);

    expect(done).toHaveBeenCalledTimes(2);
  });

  // 10/10 (Sleeper call-budget Stage 1): the 2h leagueData_* copy this used to write is retired —
  // the bypass answers land in sleeperApi's own cache, which loadRoster and the overview read.
  it("bypasses the cache on all four calls and writes no leagueData_* entry", async () => {
    const leagues = [league("A")];
    for (const k of ["getLeagueRosters", "getLeagueTradedPicks", "getLeagueDrafts", "getLeagueUsers"]) {
      api.impl[k] = vi.fn(async () => []);
    }

    await refreshAllLeagueRosters(leagues, () => {});

    for (const k of ["getLeagueRosters", "getLeagueTradedPicks", "getLeagueDrafts", "getLeagueUsers"]) {
      expect(api.impl[k]).toHaveBeenCalledWith("A", true);
    }
    expect(Object.keys(localStorage).filter((k) => k.startsWith("leagueData_"))).toEqual([]);
  });

  it("resolves (rather than rejecting) when getLeagueRosters fails, still counting the league done", async () => {
    const leagues = [league("A")];
    api.impl.getLeagueRosters = vi.fn(() => Promise.reject(new Error("429")));
    const done = vi.fn();

    await expect(refreshAllLeagueRosters(leagues, done)).resolves.toBeUndefined();
    expect(done).toHaveBeenCalledTimes(1);
  });
});

// 10/27: the Overview's 1.01% column — the chance you hold the first pick of next year's rookie
// draft, summed over every 1st you own in it (each carries its original roster's last-place odds).
describe("getMyOneOhOneOdds", () => {
  const rosters = [1, 2, 3].map((id) => ({ roster_id: id, owner_id: `u${id}` }) as unknown as SleeperRoster);
  const userMap = { u1: "Me", u2: "Alice", u3: "Bob" };
  const pick = (season: string, round: number, rosterId: number, ownerId: number): AugmentedPick =>
    ({ season, round, roster_id: rosterId, owner_id: ownerId, previous_owner_id: rosterId }) as AugmentedPick;
  const committed = (odds: Record<number, number | undefined>): Record<number, SimRow> =>
    Object.fromEntries(Object.entries(odds).map(([rid, o]) => [rid, {
      rosterId: Number(rid), wins: 0, losses: 0, ties: 0, pointsFor: 0, playoffOdds: 0, oneOhOneOdds: o,
    }]));
  const cached = (odds: Record<number, number | null>): Record<number, CachedSimRow> =>
    Object.fromEntries(Object.entries(odds).map(([rid, o]) => [rid, {
      league_id: "L", roster_id: Number(rid), playoff_odds: 0, title_odds: 0, expected_wins: 0,
      avg_finish: 0, finish_range: null, one_oh_one_odds: o, computed_at: null,
    }]));
  const base = { leagueSeason: "2026", myRosterId: 1, rosters, userMap, cachedRows: undefined, hasSim: true };

  it("sums the odds of every next-draft 1st you hold — own and traded-in — and ignores other seasons, rounds and traded-away picks", () => {
    const picks = [
      pick("2027", 1, 1, 1), // own 1st, kept
      pick("2027", 1, 2, 1), // Alice's 1st, traded to me
      pick("2027", 1, 3, 3), // Bob's 1st, Bob still has it
      pick("2027", 2, 3, 1), // Bob's 2nd — not a 1st
      pick("2028", 1, 3, 1), // Bob's 2028 1st — not the draft this season decides
    ];
    const r = getMyOneOhOneOdds({ ...base, picks, committedRows: committed({ 1: 2.4, 2: 30.1, 3: 67.5 }) });
    expect(r.odds).toBe(32.5);
    expect(r.title).toContain("2027 1.01: 2.4% via your own 1st + 30.1% via Alice's 1st");
  });

  it("gives 0 when your own 1st was traded away and you hold no other", () => {
    const picks = [pick("2027", 1, 1, 2), pick("2027", 1, 2, 2), pick("2027", 1, 3, 3)];
    const r = getMyOneOhOneOdds({ ...base, picks, committedRows: committed({ 1: 80, 2: 10, 3: 10 }) });
    expect(r).toEqual({ odds: 0, title: "You don't hold a 2027 1st" });
  });

  it("falls back to the saved Supabase rows when this device has no committed 1.01 odds", () => {
    const picks = [pick("2027", 1, 1, 1)];
    const r = getMyOneOhOneOdds({ ...base, picks, committedRows: committed({ 1: undefined }), cachedRows: cached({ 1: 12.3 }) });
    expect(r.odds).toBe(12.3);
  });

  it("shows no number for a sim saved before 1.01 odds were kept, rather than a made-up 0%", () => {
    const picks = [pick("2027", 1, 1, 1)];
    const r = getMyOneOhOneOdds({ ...base, picks, committedRows: undefined, cachedRows: cached({ 1: null }) });
    expect(r).toEqual({ odds: null, title: "Run All Sims to get 1.01 odds" });
  });

  it("shows nothing when the league has no sim at all", () => {
    const r = getMyOneOhOneOdds({ ...base, picks: [pick("2027", 1, 1, 1)], committedRows: undefined, hasSim: false });
    expect(r).toEqual({ odds: null, title: undefined });
  });
});
