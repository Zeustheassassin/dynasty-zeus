import { describe, it, expect } from "vitest";
import { formatSummary, formatValue, leagueFormat, lineupText, usualFormat } from "../../../lib/helpers/leagueFormat";
import type { SleeperLeague } from "../../../lib/types";

// Stage 9 of the 2026-11-26 scouting plan: each league's format, off the league list the app loads.

const league = (id: string, roster: string[], scoring: Record<string, number>, extra: Partial<SleeperLeague> = {}, settings: Record<string, number> = {}): SleeperLeague =>
  ({
    league_id: id, name: `League ${id}`, season: "2026", season_type: "regular", status: "in_season", sport: "nfl",
    total_rosters: 12, roster_positions: roster, scoring_settings: scoring, avatar: null, draft_id: null, previous_league_id: null,
    settings: { playoff_week_start: 15, playoff_teams: 6, num_teams: 12, type: 2, taxi_slots: 3, draft_rounds: 4, ...settings },
    ...extra,
  }) as SleeperLeague;

const SF = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX", "BN", "BN", "BN", "IR", "TAXI"];

describe("leagueFormat", () => {
  it("reads the lineup, the QB format and the scoring", () => {
    const f = leagueFormat(league("a", SF, { rec: 1, bonus_rec_te: 0.5, pass_td: 6, rush_att: 0.25, rec_fd: 0.5 }));
    expect(f).toMatchObject({
      kind: "Dynasty", teams: 12, qb: "SF", starters: 10, wr: 3, rb: 2, te: 1, flex: 2, bench: 3,
      ppr: 1, tep: 0.5, passTd: 6, ppc: 0.25, firstDown: 0.5, taxi: 3, rookieRounds: 4, bestBall: false,
    });
    expect(lineupText(f)).toBe("QB 1 · RB 2 · WR 3 · TE 1 · FLEX 2 · SF 1");
  });

  it("tells superflex, 2QB and 1QB apart, and counts the WR/RB and WR/TE flexes", () => {
    expect(leagueFormat(league("b", ["QB", "QB", "RB", "WR", "TE", "BN"], {})).qb).toBe("2QB");
    const one = leagueFormat(league("c", ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "WRRB_FLEX", "REC_FLEX", "K", "DEF", "BN"], { pass_td: 4 }));
    expect([one.qb, one.flex, one.starters]).toEqual(["1QB", 3, 11]);
    expect(lineupText(one)).toBe("QB 1 · RB 2 · WR 2 · TE 1 · FLEX 1 · W/R 1 · W/T 1 · DEF 1 · K 1");
    // Missing scoring keys count as 0; no rookie rounds reads as none.
    expect([one.ppr, one.tep, one.ppc, one.firstDown]).toEqual([0, 0, 0, 0]);
    const noRounds = leagueFormat(league("d", SF, {}, {}, { draft_rounds: undefined as unknown as number }));
    expect(formatValue(noRounds, "rookieRounds")).toBe("—");
  });

  it("reads the league type, best ball and the team count", () => {
    expect(leagueFormat(league("e", SF, {}, {}, { type: 0 })).kind).toBe("Redraft");
    expect(leagueFormat(league("f", SF, {}, {}, { type: 1, best_ball: 1 }))).toMatchObject({ kind: "Keeper", bestBall: true });
    expect(leagueFormat(league("g", SF, {}, { total_rosters: 0 }, { num_teams: 10 })).teams).toBe(10);
  });
});

describe("formatSummary", () => {
  const formats = [
    leagueFormat(league("1", SF, { rec: 1, bonus_rec_te: 0.5, pass_td: 4 })),
    leagueFormat(league("2", SF, { rec: 1, bonus_rec_te: 0.5, pass_td: 4 })),
    leagueFormat(league("3", SF, { rec: 1, bonus_rec_te: 1, pass_td: 6 }, { total_rosters: 10 })),
    leagueFormat(league("4", ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"], { rec: 0.5, pass_td: 4 })),
  ];

  it("counts each setting's values across the leagues, most common first", () => {
    const s = formatSummary(formats);
    expect(s.teams).toEqual([{ value: "12", leagues: 3 }, { value: "10", leagues: 1 }]);
    expect(s.qb).toEqual([{ value: "SF", leagues: 3 }, { value: "1QB", leagues: 1 }]);
    expect(s.tep).toEqual([{ value: "0.5", leagues: 2 }, { value: "0", leagues: 1 }, { value: "1", leagues: 1 }]);
    expect(s.passTd).toEqual([{ value: "4", leagues: 3 }, { value: "6", leagues: 1 }]);
    expect(s.ppr).toEqual([{ value: "1", leagues: 3 }, { value: "0.5", leagues: 1 }]);
  });

  it("the usual value per setting is the most common one", () => {
    expect(usualFormat(formatSummary(formats))).toMatchObject({ teams: "12", qb: "SF", tep: "0.5", passTd: "4", starters: "10", wr: "3", flex: "2" });
    expect(usualFormat(formatSummary([])).teams).toBeNull();
  });
});
