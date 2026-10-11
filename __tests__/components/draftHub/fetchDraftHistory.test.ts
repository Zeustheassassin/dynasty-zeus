import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DRAFT_HISTORY_LEAGUES_PER_REQUEST, DRAFT_HISTORY_MAX_IDLE_ROUNDS } from "@/lib/constants";
import type { DraftHistoryResponse } from "@/lib/draft/rookieDrafts";

// Draft History snapshots (10/10): the browser no longer walks Sleeper itself (~11 calls a league,
// ~550 at 50 leagues, on every visit). It posts its leagues to /api/draft-history in batches, which
// answers from saved drafts and asks Sleeper only for what isn't saved; leagues a request ran out of
// time for come back as `pending` and go out again.

import { fetchRookieDraftHistory } from "@/components/draftHub/DraftHistory/fetchDraftHistory";

const pick = (player_id: string) => ({ pick_no: 1, round: 1, draft_slot: 1, player_id, picked_by: "u1", metadata: {} });
const stats = { savedDrafts: 0, fetchedDrafts: 0, liveDrafts: 0, sleeperRequests: 0 };

/** Each request's league ids, and a responder deciding what the route answers. */
let requests: string[][];
let respond: (leagueIds: string[], n: number) => Response | DraftHistoryResponse;

function finished(leagueIds: string[]): DraftHistoryResponse {
  return {
    leagues: leagueIds.map((leagueId) => ({
      leagueId,
      drafts: [{ leagueId: `${leagueId}-prev`, season: "2025", draftId: `${leagueId}-d`, picks: [pick(`p-${leagueId}`)] }],
    })),
    pending: [],
    stats,
  };
}

beforeEach(() => {
  requests = [];
  respond = (ids) => finished(ids);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("/api/draft-history");
    expect(init.method).toBe("POST");
    const { leagueIds } = JSON.parse(String(init.body)) as { leagueIds: string[] };
    requests.push(leagueIds);
    const out = respond(leagueIds, requests.length);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const leaguesOf = (n: number) => Array.from({ length: n }, (_, i) => ({ league_id: `L${i}`, name: `League ${i}` }));

describe("fetchRookieDraftHistory", () => {
  it("posts the leagues in batches and labels every draft with the current league's name", async () => {
    const leagues = leaguesOf(DRAFT_HISTORY_LEAGUES_PER_REQUEST + 5);
    const onLeagueDone = vi.fn();
    const out = await fetchRookieDraftHistory(leagues as never[], { onLeagueDone });

    expect(requests.map((r) => r.length)).toEqual([DRAFT_HISTORY_LEAGUES_PER_REQUEST, 5]);
    expect(out).toHaveLength(leagues.length);
    expect(out[0]).toEqual({ leagueName: "League 0", leagueId: "L0-prev", season: "2025", draftId: "L0-d", picks: [pick("p-L0")] });
    expect(onLeagueDone).toHaveBeenCalledTimes(leagues.length);
  });

  it("sends a pending league again with the next batch, after retryAfterMs when Sleeper asked to slow down", async () => {
    vi.useFakeTimers();
    const leagues = leaguesOf(3);
    respond = (ids, n) => (n === 1
      ? { ...finished(ids.slice(0, 1)), pending: ids.slice(1), retryAfterMs: 5_000 }
      : finished(ids));
    const p = fetchRookieDraftHistory(leagues as never[]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const out = await p;
    expect(requests).toEqual([["L0", "L1", "L2"], ["L1", "L2"]]);
    expect(out.map((d) => d.draftId)).toEqual(["L0-d", "L1-d", "L2-d"]);
  });

  it("gives up with what it has after DRAFT_HISTORY_MAX_IDLE_ROUNDS requests that finish nothing", async () => {
    respond = (ids) => ({ leagues: [], pending: ids, stats });
    const out = await fetchRookieDraftHistory(leaguesOf(2) as never[]);
    expect(requests).toHaveLength(DRAFT_HISTORY_MAX_IDLE_ROUNDS);
    expect(out).toEqual([]);
  });

  it("retries the route's own 429, then keeps going", async () => {
    vi.useFakeTimers();
    respond = (ids, n) => (n === 1
      ? new Response("{}", { status: 429, headers: { "Retry-After": "2" } })
      : finished(ids));
    const p = fetchRookieDraftHistory(leaguesOf(1) as never[]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toHaveLength(1);
    expect(requests).toHaveLength(2);
  });

  it("shows what loaded when a request fails outright", async () => {
    const leagues = leaguesOf(DRAFT_HISTORY_LEAGUES_PER_REQUEST + 1);
    respond = (ids, n) => (n === 1 ? finished(ids) : new Response("{}", { status: 400 }));
    const out = await fetchRookieDraftHistory(leagues as never[]);
    expect(out).toHaveLength(DRAFT_HISTORY_LEAGUES_PER_REQUEST);
  });

  it("stops between requests once shouldBail turns true (a superseded load)", async () => {
    const leagues = leaguesOf(DRAFT_HISTORY_LEAGUES_PER_REQUEST * 2);
    const out = await fetchRookieDraftHistory(leagues as never[], { shouldBail: () => requests.length > 0 });
    expect(requests).toHaveLength(1);
    expect(out).toEqual([]); // the superseded answer is dropped too
  });

  it("ignores a league the route answers that wasn't asked for", async () => {
    respond = (ids) => finished([...ids, "stranger"]);
    const out = await fetchRookieDraftHistory(leaguesOf(1) as never[]);
    expect(out.map((d) => d.draftId)).toEqual(["L0-d"]);
  });
});
