// @vitest-environment node
// The situation loader: paged contract reads, Sleeper facts, and a build that
// degrades (with notes) when an optional source fails.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/server/sleeperBudget", () => ({ waitForSleeperSlot: vi.fn(async () => undefined) }));
vi.mock("@/lib/pff/client", () => ({ getPffClient: () => null }));

import { loadContractSituation, readActiveContracts, sleeperFacts } from "@/lib/server/contractSituation";
import type { NflContractRow } from "@/lib/nflContracts";

const row = (otc: number, extra: Partial<NflContractRow> = {}): NflContractRow => ({
  otc_id: otc, gsis_id: null, sleeper_id: null, player: `P${otc}`, position: "WR", team: "Packers", is_active: true,
  contract_type: "UFA", year_signed: 2026, years: 1, value: 1, apy: 1, guaranteed: 0, apy_cap_pct: 0.003,
  draft_year: 2020, draft_round: 4, draft_overall: 120,
  seasons: [{ year: 2026, team: "Packers", base_salary: 1, prorated_bonus: 0, option_bonus: 0, roster_bonus: 0, guaranteed_salary: 0, cap_number: 1, cap_percent: null, cash_paid: 1, workout_bonus: 0, per_game_roster_bonus: 0, other_bonus: null }],
  source_updated_at: "2026-11-10T15:31:04.000Z", refreshed_at: "2026-11-11T00:00:00Z", ...extra,
});

/** A Supabase stand-in serving `rows` a page at a time, recording the ranges asked for. */
function fakeDb(rows: NflContractRow[], error: string | null = null) {
  const ranges: [number, number][] = [];
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({
      range: async (a: number, b: number) => {
        ranges.push([a, b]);
        return error ? { data: null, error: { message: error } } : { data: rows.slice(a, b + 1), error: null };
      },
    }) }) }) }),
  };
  return { db: db as never, ranges };
}

describe("readActiveContracts", () => {
  it("reads 1,000 rows at a time until a short page", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => row(i + 1));
    const { db, ranges } = fakeDb(rows);
    expect(await readActiveContracts(db)).toHaveLength(2345);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("throws on a read error", async () => {
    await expect(readActiveContracts(fakeDb([], "permission denied").db)).rejects.toThrow(/permission denied/);
  });
});

describe("sleeperFacts", () => {
  it("keeps team, depth order and a well-formed birth date for the players asked for", () => {
    const raw = { a: { team: "GB", depth_chart_order: 2, birth_date: "1999-05-01" }, b: { team: null, depth_chart_order: null, birth_date: "May 1" }, c: { team: "KC" } };
    expect([...sleeperFacts(raw, new Set(["a", "b", "zz"])).entries()]).toEqual([
      ["a", { team: "GB", depthOrder: 2, birthDate: "1999-05-01" }],
      ["b", { team: null, depthOrder: null, birthDate: null }],
    ]);
  });
});

describe("loadContractSituation", () => {
  it("builds from the contracts alone when every other source fails, saying what was missing", async () => {
    const fetchFn = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const s = await loadContractSituation(fakeDb([row(1, { sleeper_id: "s1" })]).db, new Date("2026-11-11T12:00:00Z"), fetchFn);
    expect(s.season).toBe(2027);
    expect(s.players[1]).toMatchObject({ name: "P1", teamId: 9 });
    const notes = s.notes.join(" | ");
    for (const what of ["Sleeper's player map", "The id crosswalk", "ESPN's standings", "PFF's offense grades", "The 2027 draft page", "The 2028 draft page"]) {
      expect(notes).toContain(what);
    }
    expect(s.pffSeasons).toBeNull();
    expect(s.contractsUpdatedAt).toBe("2026-11-10T15:31:04.000Z");
  });

  it("throws when there are no active contracts", async () => {
    const fetchFn = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    await expect(loadContractSituation(fakeDb([]).db, new Date("2026-11-11T12:00:00Z"), fetchFn)).rejects.toThrow(/no active rows/);
  });
});
