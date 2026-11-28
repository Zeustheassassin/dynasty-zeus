import { describe, it, expect } from "vitest";
import {
  LINE_KEYS, finishedSeasons, fromPayload, seasonLinesFromWeeklyCsv, toPayload, uncountedScoringKeys,
} from "../../../lib/helpers/nflSeasonLines";
import { computeLeagueFpts } from "../../../lib/helpers/scoring";

// Positional value per league, stage 1 (2026-11-27): nflverse's weekly player
// stats reduced to season lines under Sleeper's stat keys.

const HEADER = [
  "player_id", "player_display_name", "position", "season", "week", "season_type",
  "completions", "attempts", "passing_yards", "passing_tds", "passing_interceptions", "sacks_suffered",
  "passing_first_downs", "passing_2pt_conversions", "passing_40",
  "carries", "rushing_yards", "rushing_tds", "rushing_first_downs", "rushing_2pt_conversions", "rushing_40",
  "receptions", "receiving_yards", "receiving_tds", "receiving_first_downs", "receiving_2pt_conversions",
  "receiving_10", "receiving_20", "receiving_40", "fumbles_total", "fumbles_lost_total",
];
type Row = Partial<Record<(typeof HEADER)[number], string | number>>;
const csv = (rows: Row[]) =>
  [HEADER.join(","), ...rows.map((r) => HEADER.map((h) => {
    const v = r[h] ?? (h === "season_type" ? "REG" : h === "season" ? 2025 : 0);
    return typeof v === "string" && v.includes(",") ? `"${v}"` : String(v);
  }).join(","))].join("\n");

describe("seasonLinesFromWeeklyCsv", () => {
  const text = csv([
    { player_id: "qb1", player_display_name: "Allen, Josh", position: "QB", week: 1, completions: 33, attempts: 46, passing_yards: 394, passing_tds: 2, carries: 14, rushing_yards: 30 },
    { player_id: "qb1", player_display_name: "Allen, Josh", position: "QB", week: 2, completions: 14, attempts: 25, passing_yards: 148, passing_tds: 1, passing_interceptions: 1, carries: 6, rushing_yards: 59, rushing_40: 1, fumbles_total: 1, fumbles_lost_total: 1 },
    { player_id: "qb1", player_display_name: "Allen, Josh", position: "QB", week: 19, season_type: "POST", passing_yards: 400 },
    { player_id: "rb1", player_display_name: "Bijan Robinson", position: "RB", week: 1, carries: 12, rushing_yards: 24, receptions: 6, receiving_yards: 100, receiving_10: 3, receiving_20: 2, receiving_40: 1, receiving_first_downs: 3 },
    { player_id: "rb1", player_display_name: "Bijan Robinson", position: "RB", week: 2, carries: 22, rushing_yards: 110, rushing_tds: 1, receptions: 2, receiving_yards: 9 },
    { player_id: "lb1", player_display_name: "A Linebacker", position: "LB", week: 1 },
    { player_id: "x1", player_display_name: "Two Spots", position: "TE", week: 1, receptions: 1 },
    { player_id: "x1", player_display_name: "Two Spots", position: "TE", week: 2, receptions: 1 },
    { player_id: "x1", player_display_name: "Two Spots", position: "WR", week: 3, receptions: 1 },
  ]);

  it("sums the regular season under Sleeper's keys and counts per-game bonuses", () => {
    const lines = seasonLinesFromWeeklyCsv(text, 2025);
    const qb = lines.find((l) => l.pos === "QB")!;
    expect(qb.games).toBe(2); // the playoff game is left out
    expect(qb.stats).toMatchObject({
      pass_cmp: 47, pass_att: 71, pass_inc: 24, pass_yd: 542, pass_td: 3, pass_int: 1,
      rush_att: 20, rush_yd: 89, rush_40p: 1, fum: 1, fum_lost: 1,
      bonus_pass_yd_300: 1, bonus_pass_yd_400: 0, bonus_pass_cmp_25: 1,
    });
    const rb = lines.find((l) => l.pos === "RB")!;
    expect(rb.stats).toMatchObject({
      rec: 8, rec_yd: 109, rec_fd: 3, rec_10_19: 1, rec_40p: 1, rush_att: 34, rush_yd: 134, rush_td: 1,
      bonus_rec_yd_100: 1, bonus_rush_yd_100: 1, bonus_rush_att_20: 1, bonus_rush_rec_yd_100: 2,
    });
    expect(Object.keys(qb.stats).sort()).toEqual([...LINE_KEYS].sort());
  });

  it("keeps QB / RB / WR / TE only, at the position he was listed at most, from minGames", () => {
    const lines = seasonLinesFromWeeklyCsv(text, 2025);
    expect(lines.map((l) => l.pos).sort()).toEqual(["QB", "RB", "TE"]);
    expect(lines.find((l) => l.pos === "TE")!.games).toBe(3);
    expect(seasonLinesFromWeeklyCsv(text, 2025, 3).map((l) => l.pos)).toEqual(["TE"]);
    // Rows of another season are ignored.
    expect(seasonLinesFromWeeklyCsv(text, 2024)).toEqual([]);
  });

  it("scores with any league's rules through computeLeagueFpts", () => {
    const rb = seasonLinesFromWeeklyCsv(text, 2025).find((l) => l.pos === "RB")!;
    // PPR + 0.1/yd + 6/TD, then a league adding first downs and 100-yard bonuses.
    const ppr = { rec: 1, rec_yd: 0.1, rush_yd: 0.1, rush_td: 6 };
    expect(computeLeagueFpts(rb.stats, ppr, "RB")).toBeCloseTo(8 + 10.9 + 13.4 + 6);
    expect(computeLeagueFpts(rb.stats, { ...ppr, rec_fd: 0.5, bonus_rec_yd_100: 3 }, "RB")).toBeCloseTo(38.3 + 1.5 + 3);
  });

  it("throws on a file without the columns it needs", () => {
    expect(() => seasonLinesFromWeeklyCsv("a,b\n1,2", 2025)).toThrow(/player_id/);
  });
});

describe("the route payload", () => {
  it("round-trips, and drops a line it can't read", () => {
    const lines = seasonLinesFromWeeklyCsv(csv([
      { player_id: "a", position: "WR", receptions: 5, receiving_yards: 70 },
      { player_id: "b", position: "TE", receptions: 3 },
    ]), 2025);
    const payload = toPayload([2025], lines);
    expect(payload.keys).toEqual([...LINE_KEYS]);
    expect(fromPayload(payload)).toEqual(lines);
    expect(fromPayload({ ...payload, lines: [...payload.lines, ["K", 2025, 1], ["WR", 2025, 1, 5]] })).toEqual(lines);
  });
});

describe("uncountedScoringKeys", () => {
  it("lists a league's offensive rules the stats can't rebuild, nothing else", () => {
    expect(uncountedScoringKeys({
      rec: 1, bonus_rec_te: 0.5, rec_fd: 0.5, bonus_rec_yd_100: 2, rush_40p: 1,
      rec_td_40p: 2, pass_int_td: -4, rec_0_4: 0.1, rec_20_29: 0,
      fgm: 3, idp_tkl: 1, def_td: 6, fum_rec_td: 6, st_td: 6,
    })).toEqual(["pass_int_td", "rec_0_4", "rec_td_40p"]);
    expect(uncountedScoringKeys(null)).toEqual([]);
  });
});

describe("finishedSeasons", () => {
  it("the last three regular seasons, rolling on February 1", () => {
    expect(finishedSeasons(new Date("2026-11-27T12:00:00Z"))).toEqual([2023, 2024, 2025]);
    expect(finishedSeasons(new Date("2027-01-20T12:00:00Z"))).toEqual([2023, 2024, 2025]);
    expect(finishedSeasons(new Date("2027-02-01T12:00:00Z"))).toEqual([2024, 2025, 2026]);
  });
});
