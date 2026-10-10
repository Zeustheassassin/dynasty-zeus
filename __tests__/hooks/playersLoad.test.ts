import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";

// Regression coverage for the player-map loader in useAppState (audit Batch 2 step 6).
// Before the guards, an upstream outage was cached as real data:
//   - /api/players answering 502 still parsed to { players: {} } and that EMPTY map was pinned in
//     the module-level _playersInMemory, which the mount loader treats as "already loaded" — so the
//     whole session (and every remount) showed no players until a hard reload;
//   - a FantasyCalc outage produced a value-less player map that was persisted for 24h;
//   - the cached-players path threw away the fresh FC values it had just fetched.
// _playersInMemory is module state, so each test gets a fresh module graph (see mount()).

// ── Mocks (same stubs as pickWindowCopies.test.ts) ───────────────────────────
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

// ── Upstream fixtures ────────────────────────────────────────────────────────
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Shaped like /api/players' SlimPlayer — carries the fields the cached path checks for.
const player = (id: string, extra: Record<string, unknown> = {}) => ({
  player_id: id, full_name: `Player ${id}`, position: "WR", team: "KC",
  age: 25, birth_date: null, years_exp: 3, search_rank: 100, fantasy_positions: ["WR"],
  active: true, status: "Active", injury_status: null, injury_body_part: null, injury_notes: null, ...extra,
});
const playersBody = (extra: Record<string, unknown> = {}) => ({
  players: { "1": player("1", extra), "2": player("2") },
  nflState: null,
});
const fcBody = (v1 = 9000) => [
  { player: { sleeperId: "1", name: "Player 1", position: "WR", maybeTeam: "KC" }, value: v1 },
  { player: { sleeperId: "2", name: "Player 2", position: "WR", maybeTeam: "KC" }, value: 4000 },
];

const up = {
  players: (): Response => json(playersBody()),
  fc: (): Response => json(fcBody()),
};
let urls: string[] = [];

const fetchMock = vi.fn(async (input: unknown) => {
  const url = String(input);
  urls.push(url);
  if (url.startsWith("/api/players")) return up.players();
  if (url.startsWith("/api/fc-values")) return up.fc();
  if (url.startsWith("/api/nfl-state")) return json(null);
  return json([]);
});

async function mount() {
  const { useAppState } = await import("@/app/hooks/useAppState");
  return renderHook(() => useAppState());
}
const playersOf = (r: { current: { providerProps: { players: Record<string, { value?: number; injury_status?: string | null }> } } }) =>
  r.current.providerProps.players;
const playersFetches = () => urls.filter((u) => u.startsWith("/api/players")).length;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 25)); });

// The first import transforms useAppState's whole module graph (~5.3s cold here), which sat right on
// the 5s per-test timeout and flaked whichever test ran first. Pay it once up front; resetModules
// below only re-evaluates the already-transformed modules (~50-100ms a test).
beforeAll(async () => { await import("@/app/hooks/useAppState"); }, 60_000);

beforeEach(() => {
  vi.resetModules(); // fresh _playersInMemory
  window.localStorage.clear();
  urls = [];
  up.players = () => json(playersBody());
  up.fc = () => json(fcBody());
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("player map loader — fresh path", () => {
  it("overlays FantasyCalc values onto the players and persists the merged map", async () => {
    const { result } = await mount();
    await waitFor(() => expect(playersOf(result)["1"]?.value).toBe(9000));
    expect(playersOf(result)["2"].value).toBe(4000);

    const cached = JSON.parse(window.localStorage.getItem("playersCache") ?? "null");
    expect(cached["1"].value).toBe(9000);
    expect(window.localStorage.getItem("playersCacheAt")).not.toBeNull();
  });

  it("an upstream players failure (502 + empty map) does not poison the session", async () => {
    up.players = () => json({ error: "Failed to fetch player data", players: {}, nflState: null }, 502);
    const first = await mount();
    await waitFor(() => expect(playersFetches()).toBe(1));
    await settle();
    expect(playersOf(first.result)).toEqual({});
    expect(window.localStorage.getItem("playersCache")).toBeNull();

    // Next mount must retry the network, not serve an "already loaded" empty map.
    first.unmount();
    up.players = () => json(playersBody());
    const second = await mount();
    await waitFor(() => expect(playersOf(second.result)["1"]?.value).toBe(9000));
    expect(playersFetches()).toBe(2);
  });

  it("a 200 with an empty player map is treated as a failure too", async () => {
    up.players = () => json({ players: {}, nflState: null });
    const { result } = await mount();
    await waitFor(() => expect(playersFetches()).toBe(1));
    await settle();
    expect(playersOf(result)).toEqual({});
    expect(window.localStorage.getItem("playersCache")).toBeNull();
  });

  it("a FantasyCalc outage still loads the players, but persists nothing and retries on the next mount", async () => {
    up.fc = () => json({ error: "FantasyCalc unavailable" }, 502);
    const first = await mount();
    await waitFor(() => expect(playersOf(first.result)["1"]).toBeDefined());
    await settle();
    expect(playersOf(first.result)["1"].value).toBeUndefined();
    // Not persisted (would be served value-less for 24h) and not pinned for the session.
    expect(window.localStorage.getItem("playersCache")).toBeNull();

    first.unmount();
    up.fc = () => json(fcBody());
    const second = await mount();
    await waitFor(() => expect(playersOf(second.result)["1"]?.value).toBe(9000));
    expect(playersFetches()).toBe(2);
  });

  it("a manual injury refresh during an FC outage updates injuries but keeps the last known values", async () => {
    const { result } = await mount();
    await waitFor(() => expect(playersOf(result)["1"]?.value).toBe(9000));

    up.fc = () => json({ error: "FantasyCalc unavailable" }, 502);
    up.players = () => json(playersBody({ injury_status: "Out" }));
    await act(async () => { await result.current.hubRouterProps.refreshInjuryReport(); });

    expect(playersOf(result)["1"].injury_status).toBe("Out");
    expect(playersOf(result)["1"].value).toBe(9000);
    expect(playersOf(result)["2"].value).toBe(4000);
  });
});

describe("player map loader — cached path", () => {
  const seedCache = (players: Record<string, unknown>, cachedAt = Date.now()) => {
    window.localStorage.setItem("playersCache", JSON.stringify(players));
    window.localStorage.setItem("playersCacheAt", String(cachedAt));
  };

  it("overlays the current FantasyCalc values onto the cached players (and never hits /api/players)", async () => {
    seedCache({ "1": player("1", { value: 1000 }), "2": player("2", { value: 500 }) });
    const { result } = await mount();

    // Shown immediately from cache, then corrected once FantasyCalc answers.
    await waitFor(() => expect(playersOf(result)["1"]?.value).toBe(9000));
    expect(playersOf(result)["2"].value).toBe(4000);
    expect(playersFetches()).toBe(0);
  });

  it("keeps the cached players when FantasyCalc is down", async () => {
    seedCache({ "1": player("1", { value: 1000 }), "2": player("2", { value: 500 }) });
    up.fc = () => json({ error: "FantasyCalc unavailable" }, 502);
    const { result } = await mount();

    await waitFor(() => expect(urls.some((u) => u.startsWith("/api/fc-values"))).toBe(true));
    await settle();
    expect(playersOf(result)["1"].value).toBe(1000);
    expect(playersFetches()).toBe(0);
  });

  it("refetches a cache saved before injury_body_part existed (scratch badge + injury summaries)", async () => {
    const old = (id: string, value: number) => {
      const { injury_body_part: _b, injury_notes: _n, ...rest } = player(id, { value });
      return rest;
    };
    seedCache({ "1": old("1", 1000), "2": old("2", 500) });
    const { result } = await mount();

    await waitFor(() => expect(playersOf(result)["1"]?.value).toBe(9000));
    expect(playersFetches()).toBe(1);
  });

  it("treats a cache with no values at all as a miss and refetches", async () => {
    seedCache({ "1": player("1"), "2": player("2") });
    const { result } = await mount();

    await waitFor(() => expect(playersOf(result)["1"]?.value).toBe(9000));
    expect(playersFetches()).toBe(1);
  });
});

// Sleeper call-budget Stage 1 (10/10): the browser copy of Sleeper's player map — whose
// injury_status decides every IR-eligibility count — used to sit for its full 24h. Past
// PLAYERS_BACKGROUND_REFRESH_MS (15 min) it's now re-pulled behind the copy on screen, through the
// normal CDN-cached /api/players (never ?fresh=1, which only the Refresh buttons send).
describe("player map loader — background re-pull past 15 min", () => {
  const seedCache = (cachedAt: number) => {
    window.localStorage.setItem("playersCache", JSON.stringify({ "1": player("1", { value: 1000 }), "2": player("2", { value: 500 }) }));
    window.localStorage.setItem("playersCacheAt", String(cachedAt));
  };
  const players = () => urls.filter((u) => u.startsWith("/api/players"));

  it("a cached copy older than 15 min is shown, then replaced by a background re-pull", async () => {
    seedCache(Date.now() - 20 * 60_000);
    up.players = () => json(playersBody({ injury_status: "Out" }));
    const { result } = await mount();

    await waitFor(() => expect(playersOf(result)["1"]?.injury_status).toBe("Out"));
    expect(players()).toEqual(["/api/players"]);
    const cached = JSON.parse(window.localStorage.getItem("playersCache") ?? "null");
    expect(cached["1"].injury_status).toBe("Out");
  });

  it("a cached copy younger than 15 min is not re-pulled", async () => {
    seedCache(Date.now() - 10 * 60_000);
    const { result } = await mount();
    await waitFor(() => expect(playersOf(result)["1"]?.value).toBe(9000));
    await settle();
    expect(players()).toEqual([]);
  });

  it("the session's in-memory copy is re-pulled on a later mount once it's past 15 min", async () => {
    const first = await mount();
    await waitFor(() => expect(playersOf(first.result)["1"]?.value).toBe(9000));
    first.unmount();

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 20 * 60_000);
      up.players = () => json(playersBody({ injury_status: "IR" }));
      const second = await mount(); // same module graph: _playersInMemory is still set
      await waitFor(() => expect(playersOf(second.result)["1"]?.injury_status).toBe("IR"));
      expect(players()).toEqual(["/api/players", "/api/players"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
