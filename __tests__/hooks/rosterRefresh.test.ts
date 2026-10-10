import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { CURRENT_YEAR } from "@/lib/helpers";

// Sleeper call-budget Stage 1 (10/10), end to end through useAppState:
//   - the injury report / Shares / Dashboard (allLeagueData) read the user's rosters off the League
//     Overview's shared Sleeper roster fetch — no more /api/cross-league-rosters 6h Supabase copy;
//   - Roster Overview's Refresh re-pulls rosters past every cache AND /api/players?fresh=1, and the
//     injury report moves with it (Starting -> IR, Sleeper's new designation);
//   - loadRoster has no 2h leagueData_* layer and names owners from one league-users call.
// IR eligibility keeps reading Sleeper's raw player map (`providerProps.players`), never the ESPN overlay.

type Fn = (...args: never[]) => unknown;
const api = vi.hoisted(() => ({ impl: {} as Record<string, Fn> }));
vi.mock("@/lib/sleeperApi", () => ({
  sleeperApi: new Proxy({}, { get: (_t, k: string) => api.impl[k] ?? (async () => []) }),
}));

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

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ME = "u1";
const LEAGUE = {
  league_id: "555", name: "Test League", season: CURRENT_YEAR,
  roster_positions: Array.from({ length: 22 }, () => "BN"), // >20 => counts as dynasty
  settings: { taxi_slots: 2, best_ball: 0, reserve_slots: 1, reserve_allow_out: 1 },
} as never;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const player = (id: string, injury_status: string | null) => ({
  player_id: id, full_name: `Player ${id}`, position: "WR", team: "KC", age: 25, birth_date: null,
  years_exp: 3, search_rank: 100, fantasy_positions: ["WR"], active: true, status: "Active",
  injury_status, injury_body_part: null, injury_notes: null,
});

// What "Sleeper" currently says. Tests flip these to simulate a move between loads.
let sleeper = {
  myRoster: { players: ["p1", "p2"], starters: ["p1"], reserve: [] as string[] },
  p1Status: "Questionable" as string | null,
};
const rosterCalls: { leagueId: string; bypass: boolean }[] = [];
let urls: string[] = [];

function installApi() {
  api.impl = {
    getUserLeagues: async () => [LEAGUE],
    getLeagueRosters: async (leagueId: string, bypass?: boolean) => {
      rosterCalls.push({ leagueId, bypass: !!bypass });
      return [
        { roster_id: 1, owner_id: ME, taxi: [], settings: {}, ...sleeper.myRoster },
        { roster_id: 2, owner_id: "u2", players: ["p9"], starters: ["p9"], reserve: [], taxi: [], settings: {} },
      ];
    },
    getLeagueUsers: async () => [
      { user_id: ME, display_name: "Me" },
      { user_id: "u2", display_name: "Rival" },
    ],
    getUserById: vi.fn(async (id: string) => ({ user_id: id, display_name: `Lookup ${id}` })),
  } as unknown as Record<string, Fn>;
}

const fetchMock = vi.fn(async (input: unknown) => {
  const url = String(input);
  urls.push(url);
  if (url.startsWith("/api/players")) {
    return json({
      players: { p1: player("p1", sleeper.p1Status), p2: player("p2", null), p9: player("p9", null), fa: player("fa", null) },
      nflState: null,
    });
  }
  if (url.startsWith("/api/fc-values")) {
    return json([
      { player: { sleeperId: "p1", name: "Player p1", position: "WR", maybeTeam: "KC" }, value: 5000 },
      { player: { sleeperId: "p2", name: "Player p2", position: "WR", maybeTeam: "KC" }, value: 4000 },
    ]);
  }
  if (url.startsWith("/api/nfl-state")) return json(null);
  return json([]);
});

type Hook = Awaited<ReturnType<typeof mount>>["result"];
async function mount() {
  const { useAppState } = await import("@/app/hooks/useAppState");
  return renderHook(() => useAppState());
}
const myEntry = (r: Hook) => r.current.hubRouterProps.allLeagueData.find((e) => e.leagueId === "555");
const injuryRow = (r: Hook, id: string) => r.current.hubRouterProps.injuryReportPlayers.find((p) => p.playerId === id);

// First import transforms useAppState's whole graph (~5s cold) — pay it outside the 5s test timeout.
beforeAll(async () => { await import("@/app/hooks/useAppState"); }, 60_000);

beforeEach(() => {
  vi.resetModules(); // fresh module-level player map
  window.localStorage.clear();
  window.localStorage.setItem("sleeperUser", JSON.stringify({ user_id: ME, username: "me", display_name: "Me" }));
  sleeper = { myRoster: { players: ["p1", "p2"], starters: ["p1"], reserve: [] }, p1Status: "Questionable" };
  rosterCalls.length = 0;
  urls = [];
  installApi();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("allLeagueData — the League Overview's shared roster fetch", () => {
  it("loads my roster per league through sleeperApi, never /api/cross-league-rosters", async () => {
    const { result } = await mount();
    await waitFor(() => expect(myEntry(result)?.roster?.players).toEqual(["p1", "p2"]));

    expect(urls.some((u) => u.includes("cross-league-rosters"))).toBe(false);
    expect(rosterCalls.some((c) => c.leagueId === "555")).toBe(true);
    // The injury report is built from it: p1 starts here, and isn't IR-eligible while Sleeper only
    // lists p1 as Questionable (this league allows Out, with its one IR slot open).
    await waitFor(() => expect(injuryRow(result, "p1")?.startingLeagues.map((l) => l.id)).toEqual(["555"]));
    expect(injuryRow(result, "p1")?.irEligibleLeagues).toEqual([]);
  });
});

describe("Roster Overview Refresh", () => {
  it("re-pulls rosters past every cache plus /api/players?fresh=1, and the injury report follows", async () => {
    const { result } = await mount();
    await waitFor(() => expect(myEntry(result)?.roster?.starters).toEqual(["p1"]));
    await waitFor(() => expect(result.current.providerProps.players.p1?.injury_status).toBe("Questionable"));

    // Sleeper: p1 is now Out and has been moved from the starting lineup onto IR.
    sleeper = { myRoster: { players: ["p1", "p2"], starters: [], reserve: ["p1"] }, p1Status: "Out" };
    await act(async () => { await result.current.hubRouterProps.refreshRosterOverview(); });

    expect(rosterCalls.filter((c) => c.bypass).map((c) => c.leagueId)).toEqual(["555"]);
    expect(urls).toContain("/api/players?fresh=1");
    expect(myEntry(result)?.roster?.reserve).toEqual(["p1"]);
    expect(result.current.providerProps.players.p1?.injury_status).toBe("Out");
    const row = injuryRow(result, "p1");
    expect(row?.startingLeagues).toEqual([]);
    expect(row?.irLeagues.map((l) => l.id)).toEqual(["555"]);
  });

  it("a second click inside a minute is an ordinary reload — no second bypass burst or ?fresh=1", async () => {
    const { result } = await mount();
    await waitFor(() => expect(myEntry(result)?.roster).toBeTruthy());

    await act(async () => { await result.current.hubRouterProps.refreshRosterOverview(); });
    await act(async () => { await result.current.hubRouterProps.refreshRosterOverview(); });

    expect(rosterCalls.filter((c) => c.bypass)).toHaveLength(1);
    expect(urls.filter((u) => u === "/api/players?fresh=1")).toHaveLength(1);
  });
});

describe("loadRoster", () => {
  it("names owners from the one league-users call, not a /user/{id} lookup per roster", async () => {
    const { result } = await mount();
    await waitFor(() => expect(result.current.mainLayoutProps.user?.user_id).toBe(ME));
    await act(async () => { await result.current.mainLayoutProps.loadRoster(LEAGUE); });

    expect(result.current.hubRouterProps.users).toMatchObject({ [ME]: "Me", u2: "Rival", 1: "Me", 2: "Rival" });
    expect(api.impl.getUserById).not.toHaveBeenCalled();
  });

  it("free agents follow the player map even when the league is restored before it arrives", async () => {
    // Cold start: no cached player map, and the saved league is restored as soon as leagues load.
    window.localStorage.setItem("selectedLeague", JSON.stringify(LEAGUE));
    const { result } = await mount();
    // p1/p2 are mine and p9 is the rival's; the map's only other player is the free agent.
    await waitFor(() => expect(result.current.hubRouterProps.freeAgents.map((p) => p.player_id)).toEqual(["fa"]));
  });

  it("writes no leagueData_* copy and clears the ones older builds left", async () => {
    window.localStorage.setItem("leagueData_555", JSON.stringify({ data: { allRosters: [] }, cachedAt: Date.now() }));
    const { result } = await mount();
    await waitFor(() => expect(result.current.mainLayoutProps.user?.user_id).toBe(ME));
    await act(async () => { await result.current.mainLayoutProps.loadRoster(LEAGUE); });

    // The stale (empty) leagueData_ copy wasn't served — the live roster was.
    expect(result.current.providerProps.myRoster?.players).toEqual(["p1", "p2"]);
    expect(Object.keys(window.localStorage).filter((k) => k.startsWith("leagueData_"))).toEqual([]);
  });
});
