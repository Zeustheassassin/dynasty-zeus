import { describe, it, expect, vi, beforeEach } from "vitest";

// Saved Sleeper drafts (migration 070): server-only reads/writes through the service role that never
// throw — no key, no table or a Supabase error means "nothing saved" and a skipped write, so callers
// fall back to Sleeper.

const h = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: h.getSupabaseAdmin }));

import {
  readSavedDrafts, saveDrafts, readLeagueSeasons, saveLeagueSeasons,
} from "@/lib/server/draftSnapshots";

type Result = { data?: unknown; error: { message: string } | null };

/** A service-role client whose reads answer from `rows` (by id column) and whose writes are recorded. */
function fakeClient(opts: {
  rows?: Record<string, Array<Record<string, unknown>>>;
  failSelect?: (n: number) => boolean;
  failUpsert?: (n: number) => boolean;
} = {}) {
  const selects: Array<{ table: string; col: string; ids: string[] }> = [];
  const upserts: Array<{ table: string; rows: Array<Record<string, unknown>>; opts: unknown }> = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        in: async (col: string, ids: string[]): Promise<Result> => {
          selects.push({ table, col, ids });
          if (opts.failSelect?.(selects.length)) return { data: null, error: { message: "boom" } };
          return { data: (opts.rows?.[table] ?? []).filter((r) => ids.includes(String(r[col]))), error: null };
        },
      }),
      upsert: async (rows: Array<Record<string, unknown>>, o: unknown): Promise<Result> => {
        upserts.push({ table, rows, opts: o });
        return { error: opts.failUpsert?.(upserts.length) ? { message: "nope" } : null };
      },
    }),
  };
  return { client, selects, upserts };
}

const pick = { pick_no: 1, round: 1, draft_slot: 1, player_id: "p", picked_by: null, metadata: {} };

beforeEach(() => {
  h.getSupabaseAdmin.mockReset();
});

describe("without a service-role client", () => {
  it("reads nothing and writes nothing", async () => {
    h.getSupabaseAdmin.mockReturnValue(null);
    expect((await readSavedDrafts(["1"])).size).toBe(0);
    expect((await readLeagueSeasons(["1"])).size).toBe(0);
    expect(await saveDrafts([{ draftId: "1", leagueId: null, season: "2025", rounds: 4, picks: [pick] }])).toBe(0);
    await expect(saveLeagueSeasons([{ league_id: "1", season: "2025", previous_league_id: null, rookie_draft_ids: [], final: true }])).resolves.toBeUndefined();
  });
});

describe("readSavedDrafts", () => {
  it("reads 100 ids a query, once per id, and skips a row whose picks aren't a list", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => String(i));
    const fake = fakeClient({
      rows: {
        sleeper_draft_snapshots: [
          { draft_id: "3", league_id: "L", season: "2025", picks: [pick] },
          { draft_id: "120", league_id: null, season: "2024", picks: "corrupt" },
        ],
      },
    });
    h.getSupabaseAdmin.mockReturnValue(fake.client);
    const out = await readSavedDrafts([...ids, "3"]);
    expect(fake.selects.map((s) => s.ids.length)).toEqual([100, 50]);
    expect(fake.selects[0].col).toBe("draft_id");
    expect(Array.from(out.keys())).toEqual(["3"]);
    expect(out.get("3")).toEqual({ draftId: "3", leagueId: "L", season: "2025", picks: [pick] });
  });

  it("stops at a failed read and returns what it already had", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => String(i));
    const fake = fakeClient({
      rows: { sleeper_draft_snapshots: [{ draft_id: "5", league_id: null, season: "2025", picks: [pick] }] },
      failSelect: (n) => n === 2,
    });
    h.getSupabaseAdmin.mockReturnValue(fake.client);
    const out = await readSavedDrafts(ids);
    expect(Array.from(out.keys())).toEqual(["5"]);
  });
});

describe("saveDrafts", () => {
  it("never overwrites a saved draft, and leaves out one with no picks or a bad season", async () => {
    const fake = fakeClient();
    h.getSupabaseAdmin.mockReturnValue(fake.client);
    const n = await saveDrafts([
      { draftId: "1", leagueId: "L", season: "2025", rounds: 4, picks: [pick, { ...pick, pick_no: 2 }] },
      { draftId: "2", leagueId: "L", season: "2025", rounds: 4, picks: [] },
      { draftId: "3", leagueId: "L", season: "", rounds: null, picks: [pick] },
    ]);
    expect(n).toBe(1);
    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0].table).toBe("sleeper_draft_snapshots");
    expect(fake.upserts[0].opts).toEqual({ onConflict: "draft_id", ignoreDuplicates: true });
    expect(fake.upserts[0].rows).toEqual([
      { draft_id: "1", league_id: "L", season: "2025", rounds: 4, pick_count: 2, picks: [pick, { ...pick, pick_no: 2 }] },
    ]);
  });

  it("writes 50 a request and carries on past a failed one", async () => {
    const fake = fakeClient({ failUpsert: (n) => n === 1 });
    h.getSupabaseAdmin.mockReturnValue(fake.client);
    const drafts = Array.from({ length: 120 }, (_, i) => ({ draftId: String(i), leagueId: null, season: "2024", rounds: 4, picks: [pick] }));
    const n = await saveDrafts(drafts);
    expect(fake.upserts.map((u) => u.rows.length)).toEqual([50, 50, 20]);
    expect(n).toBe(70);
  });
});

describe("league-seasons", () => {
  it("reads rows back normalized", async () => {
    const fake = fakeClient({
      rows: {
        sleeper_league_seasons: [
          { league_id: "1", season: "2025", previous_league_id: null, rookie_draft_ids: null, final: null },
          { league_id: "2", season: "2026", previous_league_id: "1", rookie_draft_ids: ["d"], final: true },
        ],
      },
    });
    h.getSupabaseAdmin.mockReturnValue(fake.client);
    const out = await readLeagueSeasons(["1", "2", "3"]);
    expect(fake.selects[0]).toMatchObject({ table: "sleeper_league_seasons", col: "league_id" });
    expect(out.get("1")).toEqual({ league_id: "1", season: "2025", previous_league_id: null, rookie_draft_ids: [], final: false });
    expect(out.get("2")).toEqual({ league_id: "2", season: "2026", previous_league_id: "1", rookie_draft_ids: ["d"], final: true });
    expect(out.has("3")).toBe(false);
  });

  it("upserts by league_id with a checked_at stamp, leaving out a bad season", async () => {
    const fake = fakeClient();
    h.getSupabaseAdmin.mockReturnValue(fake.client);
    await saveLeagueSeasons([
      { league_id: "1", season: "2025", previous_league_id: null, rookie_draft_ids: ["d"], final: true },
      { league_id: "2", season: "soon", previous_league_id: null, rookie_draft_ids: [], final: false },
    ]);
    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0].opts).toEqual({ onConflict: "league_id" });
    expect(fake.upserts[0].rows).toEqual([
      { league_id: "1", season: "2025", previous_league_id: null, rookie_draft_ids: ["d"], final: true, checked_at: expect.any(String) },
    ]);
  });
});
