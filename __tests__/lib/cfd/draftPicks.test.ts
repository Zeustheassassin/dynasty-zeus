// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DRAFT_REFRESH_MS, loadDraftYear } from "@/lib/cfd/draftPicks";
import type { CfdGet } from "@/lib/cfd/client";
import type { DraftPickRow } from "@/lib/nflDraft";

const NOW = Date.parse("2027-04-26T12:00:00Z");

const row = (overall: number, round: number): DraftPickRow => ({
  year: 2027, overall, round, pick: 1, nfl_team_id: 21, nfl_team: "Eagles", position: "Wide Receiver", name: `P${overall}`, college: null,
});

/** A fake client: cfd_draft_picks reads return `stored`, the fetch log returns `loggedAt`; writes are recorded. */
function fakeSupabase(stored: DraftPickRow[], loggedAt: string | null) {
  const writes: { table: string; rows: unknown }[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: stored, error: null }),
          maybeSingle: async () => ({ data: loggedAt ? { fetched_at: loggedAt } : null, error: null }),
        }),
      }),
      upsert: async (rows: unknown) => { writes.push({ table, rows }); return { error: null }; },
    }),
  };
  return { supabase: client as unknown as SupabaseClient, writes };
}

const cfdReturning = (body: unknown) => vi.fn(async () => ({ body, remaining: 812 })) as unknown as CfdGet & ReturnType<typeof vi.fn>;

describe("loadDraftYear", () => {
  it("serves a finished draft from the cache without calling CFD", async () => {
    const { supabase, writes } = fakeSupabase([row(1, 1), row(250, 7)], null);
    const get = cfdReturning([]);
    const r = await loadDraftYear(supabase, get, 2027, NOW);
    expect(r).toEqual({ picks: [row(1, 1), row(250, 7)], fetched: false, remaining: null });
    expect(get).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("fetches an unfinished year, names teams from CFD's ids, and logs the fetch", async () => {
    const { supabase, writes } = fakeSupabase([], null);
    const get = cfdReturning([
      { year: 2027, overall: 2, round: 1, pick: 2, nflTeamId: 19, nflTeam: "New York", position: "Wide Receiver", name: "B", collegeTeam: "X" },
      { year: 2027, overall: 1, round: 1, pick: 1, nflTeamId: 13, nflTeam: "Las Vegas", position: "Quarterback", name: "A", collegeTeam: "Y" },
      { year: 2027, overall: 3, round: 1, name: "broken" },
    ]);
    const r = await loadDraftYear(supabase, get, 2027, NOW);
    expect(get).toHaveBeenCalledWith("/draft/picks", { year: 2027 });
    expect(r.fetched).toBe(true);
    expect(r.remaining).toBe(812);
    expect(r.picks.map((p) => [p.overall, p.nfl_team])).toEqual([[1, "Raiders"], [2, "Giants"]]);
    expect(writes.map((w) => w.table)).toEqual(["cfd_draft_picks", "cfd_fetch_log"]);
    expect(writes[1].rows).toMatchObject({ key: "draft:2027", rows: 2, calls_remaining: 812 });
  });

  it("waits an hour between fetches of an unfinished year", async () => {
    const recent = new Date(NOW - DRAFT_REFRESH_MS / 2).toISOString();
    const { supabase } = fakeSupabase([row(1, 1)], recent);
    const get = cfdReturning([]);
    const r = await loadDraftYear(supabase, get, 2027, NOW);
    expect(get).not.toHaveBeenCalled();
    expect(r.picks).toHaveLength(1);

    const stale = new Date(NOW - DRAFT_REFRESH_MS - 1).toISOString();
    const again = fakeSupabase([row(1, 1)], stale);
    await loadDraftYear(again.supabase, get, 2027, NOW);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("only reads the cache without a CFD key", async () => {
    const { supabase, writes } = fakeSupabase([row(1, 1)], null);
    expect((await loadDraftYear(supabase, null, 2027, NOW)).fetched).toBe(false);
    expect(writes).toEqual([]);
  });
});
