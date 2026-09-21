import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { CURRENT_YEAR, YEARS, ROUNDS } from "@/lib/helpers";
import type { AugmentedPick } from "@/lib/types";

// Characterization of the THREE client copies of the pick-window / pick-building logic:
//   1. useAppState.loadRoster        (selected league)
//   2. useSpyState.loadSpyLeagueCore (read-only user scout)
//   3. useLeagueOverview             (all-leagues overview)
// Written BEFORE any consolidation (audit Batch 6). The copies share the window rule but
// DIFFER in details (round trimming, slot fallback, non-current-year slots); those
// differences are pinned explicitly so a merge can't silently change one caller.

// ── Mocks ────────────────────────────────────────────────────────────────────
type Fn = (...args: never[]) => unknown;
const api = vi.hoisted(() => ({ impl: {} as Record<string, Fn> }));
vi.mock("@/lib/sleeperApi", () => ({
  sleeperApi: new Proxy({}, { get: (_t, k: string) => api.impl[k] ?? (async () => []) }),
}));

// Chainable, awaitable supabase stub: every method returns the chain; awaiting resolves empty.
vi.mock("@/lib/supabaseclient", () => {
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? (res: (v: unknown) => void) => res({ data: null, error: null }) : chain),
    apply: () => chain,
  });
  return {
    supabase: {
      from: () => chain,
      rpc: () => chain,
      auth: {
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signOut: async () => ({}),
      },
    },
  };
});

import { useLeagueOverview } from "@/hooks/useLeagueOverview";
import { useSpyState } from "@/hooks/useSpyState";
import { useAppState } from "@/app/hooks/useAppState";

// ── Scenario fixtures ────────────────────────────────────────────────────────
const Y = (n: number) => String(Number(CURRENT_YEAR) + n);
const ME = "u1";
const LEAGUE = {
  league_id: "555", name: "Test League", season: CURRENT_YEAR,
  roster_positions: Array.from({ length: 22 }, () => "BN"), // >20 => counts as dynasty
  settings: { taxi_slots: 2, best_ball: 0 },
} as never;
const rosters = [1, 2, 3, 4].map((id) => ({ roster_id: id, owner_id: `u${id}`, players: [], settings: {} }));
const leagueUsers = [1, 2, 3, 4].map((id) => ({ user_id: `u${id}`, display_name: `Owner ${id}` }));

interface Draft { season: string; status: string; rounds?: number; settings?: { rounds?: number; teams?: number }; draft_order?: Record<string, number> }
interface Scenario { drafts: Draft[]; traded?: { season: string; round: number; roster_id: number; owner_id: number }[] }

function installApi(sc: Scenario) {
  api.impl = {
    getLeagueRosters: async () => rosters,
    getLeagueTradedPicks: async () => sc.traded ?? [],
    getLeagueDrafts: async () => sc.drafts,
    getLeagueUsers: async () => leagueUsers,
    getUserById: async (id: string) => ({ user_id: id, display_name: `Owner ${id}` }),
    getUserByUsername: async () => ({ user_id: ME, display_name: "Me", username: "me" }),
    getUserLeagues: async () => [LEAGUE],
  } as unknown as Record<string, Fn>;
}

const fetchMock = vi.fn(async (url: string) =>
  new Response(JSON.stringify(String(url).includes("/api/players") ? { players: {}, nflState: null } : []))
);

// ── Harnesses: each returns the league's full pick list as built by that copy ─
async function viaOverview(sc: Scenario): Promise<AugmentedPick[]> {
  installApi(sc);
  const { result } = renderHook(() => useLeagueOverview([LEAGUE], { user_id: ME }));
  await act(async () => { await result.current.loadLeagueOverview(); });
  return result.current.leagueOverviewData["555"].picks;
}

async function viaSpy(sc: Scenario): Promise<{ all: AugmentedPick[]; mine: AugmentedPick[] }> {
  installApi(sc);
  const { result } = renderHook(() =>
    useSpyState({ players: {}, nflState: null, projectionData: [], projectionWeek: 0, playerStats: null, rookies: [] })
  );
  await act(async () => { await result.current.lookup("me"); });
  await act(async () => { await result.current.selectSpyLeague(LEAGUE); });
  await waitFor(() => expect(result.current.spyLeagueBundle).not.toBeNull());
  return { all: result.current.spyLeagueBundle!.allPicks, mine: result.current.spyLeagueBundle!.picks };
}

async function viaLoadRoster(sc: Scenario): Promise<{ all: AugmentedPick[]; mine: AugmentedPick[] }> {
  installApi(sc);
  window.localStorage.setItem("sleeperUser", JSON.stringify({ user_id: ME, username: "me", display_name: "Me" }));
  const { result } = renderHook(() => useAppState());
  await waitFor(() => expect(result.current.mainLayoutProps.user?.user_id).toBe(ME));
  await act(async () => { await result.current.mainLayoutProps.loadRoster(LEAGUE); });
  await waitFor(() => expect(result.current.hubRouterProps.allPicks.length).toBeGreaterThan(0));
  return { all: result.current.hubRouterProps.allPicks, mine: result.current.hubRouterProps.picks };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const seasons = (picks: AugmentedPick[]) => [...new Set(picks.map((p) => p.season))].sort();
const maxRound = (picks: AugmentedPick[]) => Math.max(...picks.map((p) => p.round));
const key = (p: AugmentedPick) => `${p.season}-${p.round}-r${p.roster_id}->o${p.owner_id}`;

const rookieDraft = (season: string, status: string, extra: Partial<Draft> = {}): Draft =>
  ({ season, status, settings: { rounds: 4, teams: 4 }, ...extra });
const startupDraft = (season: string, status: string): Draft =>
  ({ season, status, settings: { rounds: 15, teams: 4 } });

const COPIES: [string, (sc: Scenario) => Promise<{ all: AugmentedPick[]; mine: AugmentedPick[] }>][] = [
  ["useAppState.loadRoster", viaLoadRoster],
  ["useSpyState (loadSpyLeagueCore)", viaSpy],
  ["useLeagueOverview", async (sc) => { const all = await viaOverview(sc); return { all, mine: all.filter((p) => p.owner_id === 1) }; }],
];

// ── Behavior all three copies share: the pick-year window ────────────────────
describe.each(COPIES)("pick-year window — %s", (_name, run) => {
  it("no completed drafts: current year + next two", async () => {
    const { all } = await run({ drafts: [] });
    expect(seasons(all)).toEqual(YEARS);
  });

  it("a completed rookie-sized draft retires that season and extends the window forward", async () => {
    const { all } = await run({ drafts: [rookieDraft(CURRENT_YEAR, "complete")] });
    expect(seasons(all)).toEqual([Y(1), Y(2), Y(3)]);
  });

  it("an incomplete rookie draft does not retire its season", async () => {
    const { all } = await run({ drafts: [rookieDraft(CURRENT_YEAR, "pre_draft")] });
    expect(seasons(all)).toEqual(YEARS);
  });

  it("a completed startup-sized draft retires its season when no rookie-sized draft exists for it", async () => {
    const { all } = await run({ drafts: [startupDraft(CURRENT_YEAR, "complete")] });
    expect(seasons(all)).toEqual([Y(1), Y(2), Y(3)]);
  });

  it("a completed startup draft does NOT retire a season that also has a (pending) rookie-sized draft", async () => {
    const { all } = await run({ drafts: [startupDraft(CURRENT_YEAR, "complete"), rookieDraft(CURRENT_YEAR, "pre_draft")] });
    expect(seasons(all)).toEqual(YEARS);
  });

  it("applies traded picks to owner_id, leaving previous_owner_id as the original roster", async () => {
    const { all } = await run({ drafts: [], traded: [{ season: Y(1), round: 2, roster_id: 2, owner_id: 1 }] });
    const traded = all.find((p) => p.season === Y(1) && p.round === 2 && p.roster_id === 2)!;
    expect(traded.owner_id).toBe(1);
    expect(traded.previous_owner_id).toBe(2);
    // an untouched pick still belongs to its original roster
    expect(all.find((p) => p.season === Y(1) && p.round === 2 && p.roster_id === 3)!.owner_id).toBe(3);
  });

  it("builds one pick per (season, round, roster)", async () => {
    const { all } = await run({ drafts: [] });
    expect(new Set(all.map(key)).size).toBe(all.length);
    expect(new Set(all.map((p) => p.roster_id))).toEqual(new Set([1, 2, 3, 4]));
  });
});

// ── Where the copies DIFFER (pinned so a merge can't silently change a caller) ─
describe("pick building — intentional differences between the copies", () => {
  const fiveRound: Scenario = { drafts: [rookieDraft(CURRENT_YEAR, "pre_draft", { settings: { rounds: 5, teams: 4 } })] };

  it("round count: loadRoster and spy honor the league's draft rounds; overview is fixed at ROUNDS (1-4)", async () => {
    expect(maxRound((await viaLoadRoster(fiveRound)).all)).toBe(5);
    expect(maxRound((await viaSpy(fiveRound)).all)).toBe(5);
    expect(maxRound(await viaOverview(fiveRound))).toBe(ROUNDS.length);
  });

  it("round count: default league (no draft info) is trimmed to 4 rounds by loadRoster/spy, 4 in overview", async () => {
    const sc: Scenario = { drafts: [] };
    expect(maxRound((await viaLoadRoster(sc)).all)).toBe(ROUNDS.length);
    expect(maxRound((await viaSpy(sc)).all)).toBe(ROUNDS.length);
    expect(maxRound(await viaOverview(sc))).toBe(ROUNDS.length);
  });

  it("a traded pick in a round beyond the draft settings widens the trim in loadRoster/spy only", async () => {
    const sc: Scenario = { drafts: [], traded: [{ season: Y(1), round: 6, roster_id: 2, owner_id: 1 }] };
    // roster copies build rounds 1-6 then trim to max(settings, tradedMax, 4) = 6
    expect(maxRound((await viaLoadRoster(sc)).all)).toBe(6);
    expect(maxRound((await viaSpy(sc)).all)).toBe(6);
    // overview only ever creates rounds 1-4, so the round-6 trade matches nothing
    expect(maxRound(await viaOverview(sc))).toBe(ROUNDS.length);
  });

  describe("draft slot labels", () => {
    // no draft_order info at all: fallback label differs between copies
    const noOrder: Scenario = { drafts: [rookieDraft(CURRENT_YEAR, "pre_draft")] };
    const withOrder: Scenario = {
      drafts: [rookieDraft(CURRENT_YEAR, "pre_draft", { draft_order: { u1: 3, u2: 1, u3: 4, u4: 2 } })],
    };
    const slot = (picks: AugmentedPick[], season: string, round: number, rosterId: number) =>
      picks.find((p) => p.season === season && p.round === round && p.roster_id === rosterId)?.slot;

    it("with a draft_order: current-year picks are labelled round.slot in every copy", async () => {
      expect(slot((await viaLoadRoster(withOrder)).all, CURRENT_YEAR, 1, 1)).toBe("1.03");
      expect(slot((await viaSpy(withOrder)).all, CURRENT_YEAR, 1, 1)).toBe("1.03");
      expect(slot(await viaOverview(withOrder), CURRENT_YEAR, 1, 1)).toBe("1.03");
    });

    it("without a draft_order: loadRoster/spy fall back to round.rosterId (zero-padded); overview to bare round", async () => {
      expect(slot((await viaLoadRoster(noOrder)).all, CURRENT_YEAR, 1, 2)).toBe("1.02");
      expect(slot((await viaSpy(noOrder)).all, CURRENT_YEAR, 1, 2)).toBe("1.02");
      expect(slot(await viaOverview(noOrder), CURRENT_YEAR, 1, 2)).toBe("1");
    });

    it("future-season picks: loadRoster/spy label them with the bare round; overview leaves slot unset", async () => {
      expect(slot((await viaLoadRoster(noOrder)).all, Y(1), 2, 1)).toBe("2");
      expect(slot((await viaSpy(noOrder)).all, Y(1), 2, 1)).toBe("2");
      expect(slot(await viaOverview(noOrder), Y(1), 2, 1)).toBeUndefined();
    });
  });

  it("my picks (loadRoster/spy) are sorted by season, round, then slot", async () => {
    const sc: Scenario = {
      drafts: [rookieDraft(CURRENT_YEAR, "pre_draft", { draft_order: { u1: 3, u2: 1, u3: 4, u4: 2 } })],
      traded: [{ season: CURRENT_YEAR, round: 1, roster_id: 2, owner_id: 1 }],
    };
    for (const { mine } of [await viaLoadRoster(sc), await viaSpy(sc)]) {
      expect(mine.every((p) => p.owner_id === 1)).toBe(true);
      const order = mine.map((p) => `${p.season}-${p.round}-${p.slot}`);
      const sorted = [...mine]
        .sort((a, b) => Number(a.season) - Number(b.season) || a.round - b.round ||
          parseInt(a.slot!.split(".")[1] ?? "0", 10) - parseInt(b.slot!.split(".")[1] ?? "0", 10))
        .map((p) => `${p.season}-${p.round}-${p.slot}`);
      expect(order).toEqual(sorted);
      // the traded-in 1st (slot 1.01, from roster 2) sorts ahead of my own 1st (1.03)
      expect(order.slice(0, 2)).toEqual([`${CURRENT_YEAR}-1-1.01`, `${CURRENT_YEAR}-1-1.03`]);
    }
  });
});
