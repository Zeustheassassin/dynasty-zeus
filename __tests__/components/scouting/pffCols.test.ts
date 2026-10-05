import { describe, it, expect } from "vitest";
import { pffCols, PFF_BOARD_KEYS } from "@/components/scouting/stats/pffCols";
import { buildWRStatRows, WR_STAT_COLS } from "@/components/scouting/stats/WRStatsTable";
import { totalsFor, pffValues } from "@/lib/pff/totals";
import { GAME_STAT_KEYS, SEASON_STAT_KEYS, type PffGameRow, type PffPos, type PffSeasonRow } from "@/lib/pff/stats";
import type { ProspectWithStats } from "@/lib/types";

// A game row and season row with every column set, so every value exists.
const full = Object.fromEntries(GAME_STAT_KEYS.map((k) => [k, 5])) as unknown as PffGameRow;
const row: PffGameRow = { ...full, game_id: "g1", prospect_id: "w", pff_player_id: 1, pff_game_id: 10, season: 2025, week: 1, franchise_id: 1, pff_position: "LWR", fetched_at: "" };
const season = { ...Object.fromEntries(SEASON_STAT_KEYS.map((k) => [k, 5])), prospect_id: "w", pff_player_id: 1, season: 2025, pff_game_ids: [10], weeks: [1], fetched_at: "" } as PffSeasonRow;
const totals = totalsFor(1, [row], new Map([[2025, season]]));
const values = pffValues(totals);

describe("PFF columns", () => {
  const POSITIONS: PffPos[] = ["QB", "RB", "WR", "TE"];

  it("reads only values pffValues computes, and weights by fields it fills", () => {
    for (const pos of POSITIONS) {
      for (const c of pffCols(pos)) {
        expect(values, `${pos} ${c.key}`).toHaveProperty(c.key);
        if (c.weightBy) expect(values, `${pos} ${c.key} weight`).toHaveProperty(c.weightBy);
      }
    }
  });

  it("has one column per key, in PFF-labelled groups", () => {
    for (const pos of POSITIONS) {
      const keys = pffCols(pos).map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(pffCols(pos).every((c) => c.group.startsWith("PFF"))).toBe(true);
    }
  });

  it("builds the Big Board band from the position's own columns", () => {
    for (const pos of POSITIONS) {
      const keys = new Set(pffCols(pos).map((c) => c.key));
      expect(PFF_BOARD_KEYS[pos].every((k) => keys.has(k))).toBe(true);
    }
  });
});

describe("WR stats table yards", () => {
  const wr = { id: "w", name: "W", position: "WR", draft_class_year: 2027, lined_up: null, role_fit: null,
    route_stats: {}, coverage_stats: { man: { count: 0 }, zone: { count: 0 }, double: { count: 0 }, press: { count: 0 } },
  } as unknown as ProspectWithStats;

  it("has no typed-yards columns; yards are PFF's", () => {
    const keys = WR_STAT_COLS.map((c) => c.key);
    expect(keys).not.toContain("raw_yards");
    expect(keys).not.toContain("ypc");
    expect(keys).toContain("pff_recyds");
    const [r] = buildWRStatRows([wr], new Map([["w", totals]]));
    expect(r.pff_recyds).toBe(5);
    expect(r.pff_yprr).toBe(1);
  });

  it("shows — without PFF stats", () => {
    const [r] = buildWRStatRows([wr]);
    expect(r.pff_recyds ?? null).toBeNull();
  });
});
