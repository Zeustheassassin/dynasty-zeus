import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import * as C from "@/lib/constants";

// POST /api/draft-history (Draft History snapshots, 10/10). Completed rookie drafts and each
// league-season's draft list are saved (migration 070) and read back; Sleeper is asked only for a
// league-season with no saved row or a row that isn't final, and for a completed draft whose picks
// aren't saved. In season, once a league's drafts are saved, a visit makes no Sleeper calls.

const h = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));

// unstable_cache only works inside a running Next server: a pass-through that records each cached
// call's key and window. A bypass call (straight to Sleeper) never comes through here.
const nc = vi.hoisted(() => ({ cached: [] as { url: string; revalidate: number }[] }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, key: string[], opts: { revalidate: number }) => () => {
    nc.cached.push({ url: key[1], revalidate: opts.revalidate });
    return fn();
  },
}));
const budget = vi.hoisted(() => ({ slots: [] as string[] }));
vi.mock("@/lib/server/sleeperBudget", () => ({
  waitForSleeperSlot: async (priority: string) => { budget.slots.push(priority); },
}));

// The saved tables, in memory.
interface Row { league_id: string; season: string; previous_league_id: string | null; rookie_draft_ids: string[]; final: boolean }
interface Saved { draftId: string; leagueId: string | null; season: string; picks: unknown[]; rounds?: number | null }
const store = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  drafts: new Map<string, unknown>(),
  savedRows: [] as unknown[],
  savedDrafts: [] as unknown[],
}));
vi.mock("@/lib/server/draftSnapshots", () => ({
  readLeagueSeasons: async (ids: string[]) => new Map(ids.filter((id) => store.rows.has(id)).map((id) => [id, store.rows.get(id)])),
  saveLeagueSeasons: async (rows: Row[]) => {
    store.savedRows.push(...rows);
    rows.forEach((r) => store.rows.set(r.league_id, r));
  },
  readSavedDrafts: async (ids: string[]) => new Map(ids.filter((id) => store.drafts.has(id)).map((id) => [id, store.drafts.get(id)])),
  saveDrafts: async (drafts: Saved[]) => {
    store.savedDrafts.push(...drafts);
    drafts.forEach((d) => store.drafts.set(d.draftId, { draftId: d.draftId, leagueId: d.leagueId, season: d.season, picks: d.picks }));
    return drafts.length;
  },
}));

import { POST, maxDuration } from "@/app/api/draft-history/route";

const B = C.SLEEPER_BASE_URL;
const Y = new Date().getFullYear();
const yr = (back = 0) => String(Y - back);
const IN_SEASON = { season: yr(), season_type: "regular", week: 6 };
const PRESEASON = { season: yr(), season_type: "pre", week: 0 };

type Draft = { draft_id: string; season: string; status: string; settings: { rounds: number } };
const rookie = (draft_id: string, season: string, status = "complete"): Draft => ({ draft_id, season, status, settings: { rounds: 4 } });
/** A Sleeper pick carrying the fields the save trims away. */
const rawPick = (player_id: string, pick_no = 1) => ({
  draft_id: "x", pick_no, round: 1, draft_slot: pick_no, player_id, picked_by: "u1", roster_id: 3, is_keeper: null,
  reactions: { u2: "🔥" },
  metadata: { first_name: "A", last_name: "B", position: "WR", team: "KC", years_exp: "0", injury_status: "", news_updated: "1" },
});

let world: {
  state: unknown;
  leagues: Record<string, { season: string; previous_league_id: string | null }>;
  drafts: Record<string, Draft[]>;
  picks: Record<string, unknown[]>;
  /** Sleeper path → the response it answers with instead. */
  fail: Record<string, () => Response>;
  /** Runs before each Sleeper request (to move the clock). */
  onRequest?: (path: string) => void;
};
let sleeperPaths: string[];

/** 10 (this season) → 11 → 12 → 13 → 14, one completed rookie draft each. */
function chainWorld() {
  world.leagues = {
    "10": { season: yr(0), previous_league_id: "11" },
    "11": { season: yr(1), previous_league_id: "12" },
    "12": { season: yr(2), previous_league_id: "13" },
    "13": { season: yr(3), previous_league_id: "14" },
    "14": { season: yr(4), previous_league_id: null },
  };
  for (const [id, l] of Object.entries(world.leagues)) {
    world.drafts[id] = [rookie(`d-${id}`, l.season)];
    world.picks[`d-${id}`] = [rawPick(`pl-${id}`)];
  }
}

beforeEach(() => {
  h.checkRateLimit.mockReset();
  h.checkRateLimit.mockResolvedValue({ allowed: true });
  nc.cached = [];
  budget.slots = [];
  store.rows.clear();
  store.drafts.clear();
  store.savedRows = [];
  store.savedDrafts = [];
  sleeperPaths = [];
  world = { state: IN_SEASON, leagues: {}, drafts: {}, picks: {}, fail: {} };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = url.slice(B.length);
    sleeperPaths.push(path);
    world.onRequest?.(path);
    if (world.fail[path]) return world.fail[path]();
    let body: unknown = null;
    let m: RegExpMatchArray | null;
    if (path === "/state/nfl") body = world.state;
    else if ((m = path.match(/^\/league\/(\w+)\/drafts$/))) body = world.drafts[m[1]] ?? [];
    else if ((m = path.match(/^\/league\/(\w+)$/))) body = world.leagues[m[1]] ? { league_id: m[1], ...world.leagues[m[1]] } : null;
    else if ((m = path.match(/^\/draft\/([\w-]+)\/picks$/))) body = world.picks[m[1]] ?? [];
    return new Response(JSON.stringify(body), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function post(body: unknown) {
  const req = new NextRequest("http://localhost/api/draft-history", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

const savedRow = (league_id: string, season: string, previous_league_id: string | null, ids: string[], final = true): Row =>
  ({ league_id, season, previous_league_id, rookie_draft_ids: ids, final });
const savedDraft = (draftId: string, leagueId: string, season: string): Saved =>
  ({ draftId, leagueId, season, picks: [{ pick_no: 1, round: 1, draft_slot: 1, player_id: `saved-${draftId}`, picked_by: "u1", metadata: {} }] });

describe("POST /api/draft-history — guards", () => {
  it("gives the route a 60s ceiling", () => {
    expect(maxDuration).toBe(60);
  });

  it("returns the limiter's response when rate limited, before touching anything", async () => {
    h.checkRateLimit.mockResolvedValue({ allowed: false, response: new Response("slow", { status: 429 }) });
    const req = new NextRequest("http://localhost/api/draft-history", { method: "POST", body: "{}" });
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(h.checkRateLimit).toHaveBeenCalledWith(req, C.DRAFT_HISTORY_RPM_PER_IP, 60_000, "draft-history");
    expect(sleeperPaths).toEqual([]);
  });

  it.each([
    ["bad JSON", "{nope"],
    ["no leagueIds", {}],
    ["an empty list", { leagueIds: [] }],
    ["too many leagues", { leagueIds: Array.from({ length: C.DRAFT_HISTORY_LEAGUES_PER_REQUEST + 1 }, (_, i) => String(i + 1)) }],
    ["a non-numeric id", { leagueIds: ["123", "abc"] }],
    ["a non-string id", { leagueIds: [123] }],
  ])("400s on %s", async (_label, body) => {
    const { status } = await post(body);
    expect(status).toBe(400);
    expect(sleeperPaths).toEqual([]);
  });
});

describe("POST /api/draft-history — first visit (nothing saved)", () => {
  it("walks this season and 3 back, saving each league-season and every completed draft", async () => {
    chainWorld();
    const { status, body } = await post({ leagueIds: ["10"] });
    expect(status).toBe(200);
    expect(body.pending).toEqual([]);
    expect(body.leagues).toHaveLength(1);
    expect(body.leagues[0].drafts.map((d: { leagueId: string; season: string; draftId: string }) => [d.leagueId, d.season, d.draftId])).toEqual([
      ["10", yr(0), "d-10"], ["11", yr(1), "d-11"], ["12", yr(2), "d-12"], ["13", yr(3), "d-13"],
    ]);
    // 4 seasons only: 14 is never asked about.
    expect(sleeperPaths.filter((p) => p.startsWith("/league/14"))).toEqual([]);
    expect(sleeperPaths.filter((p) => p.endsWith("/picks"))).toEqual(["/draft/d-10/picks", "/draft/d-11/picks", "/draft/d-12/picks", "/draft/d-13/picks"]);

    // In season, nothing open: every row is final.
    expect(store.savedRows).toEqual([
      savedRow("10", yr(0), "11", ["d-10"]), savedRow("11", yr(1), "12", ["d-11"]),
      savedRow("12", yr(2), "13", ["d-12"]), savedRow("13", yr(3), "14", ["d-13"]),
    ]);
    // Completed drafts saved with their picks trimmed to what the app reads.
    expect((store.savedDrafts as Saved[]).map((d) => [d.draftId, d.leagueId, d.season, d.rounds])).toEqual([
      ["d-10", "10", yr(0), 4], ["d-11", "11", yr(1), 4], ["d-12", "12", yr(2), 4], ["d-13", "13", yr(3), 4],
    ]);
    expect((store.savedDrafts as Saved[])[0].picks).toEqual([{
      pick_no: 1, round: 1, draft_slot: 1, player_id: "pl-10", picked_by: "u1",
      metadata: { first_name: "A", last_name: "B", position: "WR", team: "KC", years_exp: "0" },
    }]);
    expect(body.leagues[0].drafts[0].picks).toEqual((store.savedDrafts as Saved[])[0].picks);
    expect(body.stats).toMatchObject({ savedDrafts: 0, fetchedDrafts: 4, liveDrafts: 0 });
  });

  it("reads league info and draft lists through the proxies' Data Cache entries, but completed picks uncached", async () => {
    chainWorld();
    await post({ leagueIds: ["10"] });
    const cached = (path: string) => nc.cached.find((c) => c.url === `${B}${path}`);
    expect(cached("/league/10")?.revalidate).toBe(C.SLEEPER_LEAGUE_INFO_REVALIDATE_S);
    expect(cached("/league/10/drafts")?.revalidate).toBe(C.SLEEPER_LEAGUE_DRAFTS_REVALIDATE_S);
    expect(cached("/state/nfl")?.revalidate).toBe(C.NFL_STATE_REVALIDATE_S);
    // A cache entry from while the draft was running could miss its last picks — the save must not.
    expect(nc.cached.some((c) => c.url.endsWith("/picks"))).toBe(false);
    // Every request that reached Sleeper took an interactive slot.
    expect(budget.slots).toEqual(Array(sleeperPaths.length).fill("interactive"));
  });

  it("keeps rookie-length drafts only, and this class's unfinished drafts as live picks that are never saved", async () => {
    world.state = PRESEASON;
    world.leagues = { "10": { season: yr(0), previous_league_id: "11" }, "11": { season: yr(1), previous_league_id: null } };
    world.drafts = {
      "10": [
        rookie("live", yr(0), "drafting"),
        rookie("pre", yr(0), "pre_draft"),
        { draft_id: "startup", season: yr(0), status: "complete", settings: { rounds: 25 } },
      ],
      "11": [rookie("old-live", yr(1), "drafting"), rookie("old-done", yr(1))],
    };
    world.picks = { live: [rawPick("lv")], "old-done": [rawPick("od")] };
    const { body } = await post({ leagueIds: ["10"] });
    expect(body.leagues[0].drafts.map((d: { draftId: string }) => d.draftId)).toEqual(["live", "old-done"]);
    expect(sleeperPaths).not.toContain("/draft/startup/picks");
    expect(sleeperPaths).not.toContain("/draft/old-live/picks");
    // The live draft's picks come through the picks proxy's 60s Data Cache entry, and aren't saved.
    expect(nc.cached.find((c) => c.url === `${B}/draft/live/picks`)?.revalidate).toBe(C.SLEEPER_DRAFT_PICKS_REVALIDATE_S);
    expect((store.savedDrafts as Saved[]).map((d) => d.draftId)).toEqual(["old-done"]);
    // Preseason: this season's list can still change, last season's can't.
    expect(store.savedRows).toEqual([savedRow("10", yr(0), "11", [], false), savedRow("11", yr(1), null, ["old-done"], true)]);
    expect(body.stats).toMatchObject({ liveDrafts: 1, fetchedDrafts: 1 });
  });

  it("ends the chain at a league Sleeper doesn't know, and at a previous_league_id of \"0\" without asking", async () => {
    world.leagues = { "20": { season: yr(0), previous_league_id: "99" }, "30": { season: yr(0), previous_league_id: "0" } };
    world.drafts = { "20": [rookie("da", yr(0))], "30": [rookie("db", yr(0))] };
    world.picks = { da: [rawPick("x")], db: [rawPick("y")] };
    const { body } = await post({ leagueIds: ["20", "30"] });
    expect(body.leagues.map((l: { leagueId: string; drafts: unknown[] }) => [l.leagueId, l.drafts.length])).toEqual([["20", 1], ["30", 1]]);
    expect(sleeperPaths).toContain("/league/99");
    expect(sleeperPaths.some((p) => p.startsWith("/league/0"))).toBe(false);
    expect((store.savedRows as Row[]).find((r) => r.league_id === "30")?.previous_league_id).toBeNull();
    // The link to the league Sleeper doesn't know is cut on the saved row, so the next visit stops
    // there without asking again.
    expect((store.rows.get("20") as Row).previous_league_id).toBeNull();
    sleeperPaths = [];
    const again = await post({ leagueIds: ["20", "30"] });
    expect(sleeperPaths).toEqual([]);
    expect(again.body.leagues.map((l: { drafts: unknown[] }) => l.drafts.length)).toEqual([1, 1]);
  });

  it("keeps the link when asking about the previous league fails — it's tried again next visit", async () => {
    world.leagues = { "20": { season: yr(0), previous_league_id: "21" }, "21": { season: yr(1), previous_league_id: null } };
    world.drafts = { "20": [rookie("da", yr(0))] };
    world.picks = { da: [rawPick("x")] };
    world.fail["/league/21"] = () => new Response("down", { status: 503 });
    const { body } = await post({ leagueIds: ["20"] });
    expect(body.pending).toEqual([]);
    expect((store.rows.get("20") as Row).previous_league_id).toBe("21");
    expect(store.rows.has("21")).toBe(false);
  });

  it("skips a completed draft whose picks fail to load (the league still finishes), and doesn't save it", async () => {
    world.leagues = { "10": { season: yr(0), previous_league_id: null } };
    world.drafts = { "10": [rookie("ok", yr(0)), rookie("bad", yr(0))] };
    world.picks = { ok: [rawPick("x")] };
    world.fail["/draft/bad/picks"] = () => new Response("nope", { status: 500 });
    const { body } = await post({ leagueIds: ["10"] });
    expect(body.pending).toEqual([]);
    expect(body.leagues[0].drafts.map((d: { draftId: string }) => d.draftId)).toEqual(["ok"]);
    expect((store.savedDrafts as Saved[]).map((d) => d.draftId)).toEqual(["ok"]);
  });

  it("drops a completed draft that came back with no picks from its final row, so it isn't asked for again", async () => {
    world.leagues = { "10": { season: yr(0), previous_league_id: null } };
    world.drafts = { "10": [rookie("empty", yr(0)), rookie("full", yr(0))] };
    world.picks = { empty: [], full: [rawPick("x")] };
    const { body } = await post({ leagueIds: ["10"] });
    expect(body.leagues[0].drafts.map((d: { draftId: string }) => d.draftId)).toEqual(["full"]);
    expect((store.savedDrafts as Saved[]).map((d) => d.draftId)).toEqual(["full"]);
    expect(store.savedRows).toEqual([savedRow("10", yr(0), null, ["full"])]);
    sleeperPaths = [];
    await post({ leagueIds: ["10"] });
    expect(sleeperPaths).toEqual([]);
  });

  it("keeps an empty completed draft on a row that isn't final yet (the list is re-checked anyway)", async () => {
    world.state = PRESEASON;
    world.leagues = { "10": { season: yr(0), previous_league_id: null } };
    world.drafts = { "10": [rookie("empty", yr(0))] };
    world.picks = { empty: [] };
    await post({ leagueIds: ["10"] });
    expect(store.savedRows).toEqual([savedRow("10", yr(0), null, ["empty"], false)]);
    expect(store.savedDrafts).toEqual([]);
  });
});

describe("POST /api/draft-history — saved drafts", () => {
  function seedSavedChain() {
    store.rows.set("10", savedRow("10", yr(0), "11", ["d-10"]));
    store.rows.set("11", savedRow("11", yr(1), "12", ["d-11"]));
    store.rows.set("12", savedRow("12", yr(2), null, []));
    store.drafts.set("d-10", savedDraft("d-10", "10", yr(0)));
    store.drafts.set("d-11", savedDraft("d-11", "11", yr(1)));
  }

  it("makes no Sleeper calls at all once a league's drafts are saved and final", async () => {
    seedSavedChain();
    const { body } = await post({ leagueIds: ["10"] });
    expect(sleeperPaths).toEqual([]);
    expect(budget.slots).toEqual([]);
    expect(body.leagues[0].drafts.map((d: { draftId: string; picks: Array<{ player_id: string }> }) => [d.draftId, d.picks[0].player_id])).toEqual([
      ["d-10", "saved-d-10"], ["d-11", "saved-d-11"],
    ]);
    expect(body.stats).toEqual({ savedDrafts: 2, fetchedDrafts: 0, liveDrafts: 0, sleeperRequests: 0 });
    expect(store.savedRows).toEqual([]);
  });

  it("re-checks only a league-season that isn't final — its draft list, not its league info", async () => {
    seedSavedChain();
    store.rows.set("10", savedRow("10", yr(0), "11", [], false));
    world.drafts = { "10": [rookie("d-new", yr(0))] };
    world.picks = { "d-new": [rawPick("new")] };
    const { body } = await post({ leagueIds: ["10"] });
    expect(sleeperPaths).toEqual(["/league/10/drafts", "/state/nfl", "/draft/d-new/picks"]);
    expect(store.savedRows).toEqual([savedRow("10", yr(0), "11", ["d-new"], true)]);
    expect(body.leagues[0].drafts.map((d: { draftId: string }) => d.draftId)).toEqual(["d-new", "d-11"]);
  });

  it("keeps showing a saved row when its re-check fails", async () => {
    seedSavedChain();
    store.rows.set("10", savedRow("10", yr(0), "11", ["d-10"], false));
    world.fail["/league/10/drafts"] = () => new Response("down", { status: 503 });
    const { body } = await post({ leagueIds: ["10"] });
    expect(body.pending).toEqual([]);
    expect(body.leagues[0].drafts.map((d: { draftId: string }) => d.draftId)).toEqual(["d-10", "d-11"]);
    expect(store.savedRows).toEqual([]);
  });

  it("fetches and saves a completed draft a saved row lists but whose picks weren't saved", async () => {
    seedSavedChain();
    store.drafts.delete("d-11");
    world.picks = { "d-11": [rawPick("refetched")] };
    const { body } = await post({ leagueIds: ["10"] });
    expect(sleeperPaths).toEqual(["/draft/d-11/picks"]);
    expect((store.savedDrafts as Saved[]).map((d) => [d.draftId, d.leagueId, d.season])).toEqual([["d-11", "11", yr(1)]]);
    expect(body.leagues[0].drafts[1].picks[0].player_id).toBe("refetched");
  });
});

describe("POST /api/draft-history — when a list is final", () => {
  it("in season: final with no rookie draft open, not final while one still is; a past season is final regardless", async () => {
    world.leagues = { "20": { season: yr(0), previous_league_id: "21" }, "21": { season: yr(1), previous_league_id: null }, "30": { season: yr(0), previous_league_id: null } };
    world.drafts = {
      "20": [rookie("a-done", yr(0))],
      "21": [rookie("a1-done", yr(1)), rookie("a1-abandoned", yr(1), "pre_draft")],
      "30": [rookie("b-slow", yr(0), "drafting")],
    };
    world.picks = { "a-done": [rawPick("1")], "a1-done": [rawPick("2")], "b-slow": [rawPick("3")] };
    await post({ leagueIds: ["20", "30"] });
    const final = Object.fromEntries((store.savedRows as Row[]).map((r) => [r.league_id, r.final]));
    expect(final).toEqual({ "20": true, "21": true, "30": false });
  });

  it("without Sleeper's NFL state only past seasons are final", async () => {
    world.leagues = { "20": { season: yr(0), previous_league_id: "21" }, "21": { season: yr(1), previous_league_id: null } };
    world.drafts = { "20": [rookie("a-done", yr(0))], "21": [rookie("a1-done", yr(1))] };
    world.picks = { "a-done": [rawPick("1")], "a1-done": [rawPick("2")] };
    world.fail["/state/nfl"] = () => new Response("down", { status: 502 });
    await post({ leagueIds: ["20"] });
    const final = Object.fromEntries((store.savedRows as Row[]).map((r) => [r.league_id, r.final]));
    // The calendar season year is this year, or last year in Jan/Feb — either way a1 is past.
    expect(final["21"]).toBe(true);
    if (new Date().getMonth() > 1) expect(final["20"]).toBe(false);
  });
});

describe("POST /api/draft-history — cut off", () => {
  it("stops starting Sleeper calls at the fill budget; the league comes back pending and the next request picks up from what was saved", async () => {
    chainWorld();
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    world.onRequest = (path) => { if (path === "/league/11/drafts") now += C.DRAFT_HISTORY_FILL_BUDGET_MS + 1; };

    const first = await post({ leagueIds: ["10"] });
    expect(first.body.leagues).toEqual([]);
    expect(first.body.pending).toEqual(["10"]);
    expect(sleeperPaths.some((p) => p.startsWith("/league/12"))).toBe(false);
    expect(sleeperPaths.some((p) => p.endsWith("/picks"))).toBe(false);
    expect((store.savedRows as Row[]).map((r) => r.league_id)).toEqual(["10", "11"]);

    sleeperPaths = [];
    world.onRequest = undefined;
    const second = await post({ leagueIds: ["10"] });
    expect(second.body.pending).toEqual([]);
    expect(second.body.leagues[0].drafts).toHaveLength(4);
    // 10 and 11 came from their saved rows.
    expect(sleeperPaths.filter((p) => /^\/league\/(10|11)/.test(p))).toEqual([]);
  });

  it("stops at Sleeper's 429 and passes its Retry-After back so the browser waits", async () => {
    chainWorld();
    world.fail["/league/11/drafts"] = () => new Response("slow down", { status: 429, headers: { "Retry-After": "7" } });
    const { body } = await post({ leagueIds: ["10"] });
    expect(body.pending).toEqual(["10"]);
    expect(body.retryAfterMs).toBe(7_000);
    const at = sleeperPaths.indexOf("/league/11/drafts");
    expect(sleeperPaths.slice(at + 1)).toEqual([]); // nothing after the 429
    expect((store.savedRows as Row[]).map((r) => r.league_id)).toEqual(["10"]);
  });

  it("finishes the leagues it can and sends back only the ones cut off", async () => {
    world.leagues = { "20": { season: yr(0), previous_league_id: null }, "30": { season: yr(0), previous_league_id: null } };
    world.drafts = { "20": [rookie("da", yr(0))], "30": [rookie("db", yr(0))] };
    world.picks = { da: [rawPick("x")], db: [rawPick("y")] };
    world.fail["/draft/db/picks"] = () => new Response("slow down", { status: 429 });
    const { body } = await post({ leagueIds: ["20", "30"] });
    expect(body.leagues.map((l: { leagueId: string }) => l.leagueId)).toEqual(["20"]);
    expect(body.pending).toEqual(["30"]);
    expect(body.retryAfterMs).toBe(C.SLEEPER_UPSTREAM_RETRY_AFTER_S * 1000);
  });
});
