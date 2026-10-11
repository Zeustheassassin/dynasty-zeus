import { describe, it, expect, vi, beforeEach } from "vitest";
import { DRAFT_HISTORY_LEAGUE_CONCURRENCY } from "@/lib/constants";

// Sleeper call-budget Stage 3 (10/10): Draft History's load was a nested Promise.all over every
// league x season x draft (~550 calls at 50 leagues, all at once). Now a few leagues at a time, each
// league's calls one after another — same drafts found, same filters.

const h = vi.hoisted(() => ({
  open: 0,
  maxOpen: 0,
  calls: [] as string[],
  // league_id -> previous_league_id (null = chain ends)
  chain: {} as Record<string, string | null>,
  // league_id -> drafts
  drafts: {} as Record<string, Array<{ draft_id: string; season: string; status: string; settings?: { rounds?: number } }>>,
}));

async function track<T>(label: string, value: () => T): Promise<T> {
  h.calls.push(label);
  h.open++;
  h.maxOpen = Math.max(h.maxOpen, h.open);
  await new Promise((r) => setTimeout(r, 1));
  h.open--;
  return value();
}

vi.mock("@/lib/sleeperApi", () => ({
  sleeperApi: {
    getLeagueInfo: vi.fn((id: string) =>
      track(`info:${id}`, () => (id in h.chain ? { league_id: id, previous_league_id: h.chain[id] } : null))),
    getLeagueDrafts: vi.fn((id: string) => track(`drafts:${id}`, () => h.drafts[id] ?? [])),
    getDraftPicks: vi.fn((draftId: string) =>
      track(`picks:${draftId}`, () => [{ player_id: `p-${draftId}`, round: 1, draft_slot: 1, pick_no: 1, picked_by: "u1" }])),
  },
}));

import { fetchRookieDraftHistory, ROOKIE_YEAR } from "@/components/draftHub/DraftHistory/fetchDraftHistory";

const PREV = String(Number(ROOKIE_YEAR) - 1);
const rookie = (draft_id: string, season: string, status = "complete") =>
  ({ draft_id, season, status, settings: { rounds: 4 } });

beforeEach(() => {
  h.open = 0;
  h.maxOpen = 0;
  h.calls = [];
  h.chain = {};
  h.drafts = {};
});

describe("fetchRookieDraftHistory", () => {
  it("walks up to 3 seasons back and labels every season with the current league's name", async () => {
    h.chain = { p1: "p2", p2: "p3", p3: "p4", p4: null };
    h.drafts = {
      cur: [rookie("d-cur", ROOKIE_YEAR)],
      p1: [rookie("d-p1", PREV)],
      p3: [rookie("d-p3", String(Number(PREV) - 2))],
      p4: [rookie("d-p4", "2019")], // 4 seasons back — never reached
    };
    const out = await fetchRookieDraftHistory([{ league_id: "cur", name: "Dynasty", previous_league_id: "p1" }] as never[]);
    expect(out.map((d) => [d.leagueId, d.draftId, d.leagueName])).toEqual([
      ["cur", "d-cur", "Dynasty"], ["p1", "d-p1", "Dynasty"], ["p3", "d-p3", "Dynasty"],
    ]);
    expect(h.calls.filter((c) => c.startsWith("info:"))).toEqual(["info:p1", "info:p2", "info:p3"]);
    expect(out[0].picks[0].player_id).toBe("p-d-cur");
  });

  it("keeps rookie-length drafts: complete for past classes, also drafting/paused for this year's", async () => {
    h.drafts = {
      cur: [
        rookie("live", ROOKIE_YEAR, "drafting"),
        rookie("paused", ROOKIE_YEAR, "paused"),
        rookie("pre", ROOKIE_YEAR, "pre_draft"),
        { draft_id: "startup", season: ROOKIE_YEAR, status: "complete", settings: { rounds: 25 } },
        rookie("old-live", PREV, "drafting"),
        rookie("old-done", PREV),
      ],
    };
    const out = await fetchRookieDraftHistory([{ league_id: "cur", name: "L" }] as never[]);
    expect(out.map((d) => d.draftId)).toEqual(["live", "paused", "old-done"]);
  });

  it("never has more than DRAFT_HISTORY_LEAGUE_CONCURRENCY calls open, and reports each league done", async () => {
    const leagues = Array.from({ length: 10 }, (_, i) => {
      const id = `L${i}`;
      h.chain[`${id}-prev`] = null;
      h.drafts[id] = [rookie(`${id}-d`, ROOKIE_YEAR)];
      h.drafts[`${id}-prev`] = [rookie(`${id}-pd`, PREV)];
      return { league_id: id, name: id, previous_league_id: `${id}-prev` };
    });
    const onLeagueDone = vi.fn();
    const out = await fetchRookieDraftHistory(leagues as never[], { onLeagueDone });
    expect(out).toHaveLength(20);
    expect(h.maxOpen).toBe(DRAFT_HISTORY_LEAGUE_CONCURRENCY);
    expect(onLeagueDone).toHaveBeenCalledTimes(10);
  });

  it("stops queueing calls once shouldBail turns true (a superseded load)", async () => {
    const leagues = Array.from({ length: 10 }, (_, i) => {
      h.drafts[`L${i}`] = [rookie(`L${i}-d`, ROOKIE_YEAR)];
      return { league_id: `L${i}`, name: `L${i}` };
    });
    // Superseded the moment the first call goes out: no other league starts, and the one that did
    // stops before its picks call.
    const out = await fetchRookieDraftHistory(leagues as never[], { shouldBail: () => h.calls.length > 0 });
    expect(h.calls).toEqual(["drafts:L0"]);
    expect(out).toEqual([]);
  });
});
