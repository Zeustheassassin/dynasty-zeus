import { describe, it, expect } from "vitest";
import {
  importanceOf, judgeImportance, missedTime, teamDirection, cutRisk, stayOdds, roomVerdict,
  type PlayerContext, type SeasonBars, type TeamContext,
} from "@/lib/contractOutlook";
import { contractStatus } from "@/lib/contractStatus";
import { buildContractRooms } from "@/lib/contractRooms";
import type { ContractSeason, NflContractRow } from "@/lib/nflContracts";

const NOV_2026 = new Date("2026-11-11T12:00:00Z");
// PFF's 2026 bars at midseason (lib/nflRooms.ts positionBars), and 2025's.
const BARS: Record<"QB" | "RB" | "WR" | "TE", SeasonBars> = {
  QB: { current: { regular: 55.8, star: 79.2 }, prior: { regular: 68, star: 79 } },
  RB: { current: { regular: 62.5, star: 80.8 }, prior: { regular: 68.5, star: 80.4 } },
  WR: { current: { regular: 60, star: 74.8 }, prior: { regular: 60, star: 76.6 } },
  TE: { current: { regular: 58.7, star: 70.3 }, prior: { regular: 58.5, star: 72.4 } },
};
const ctx = (current: [number, number, number] | null, prior: [number, number, number] | null = null, birthDate: string | null = null): PlayerContext => ({
  birthDate,
  current: current && { grade: current[0], share: current[1], games: current[2] },
  prior: prior && { grade: prior[0], share: prior[1], games: prior[2] },
});
const team = (winPct: number | null, capSpace: number | null, gamesPlayed = 9): TeamContext => ({ winPct, gamesPlayed, capSpace });

const line = (year: number, base: number, pror = 0, g = 0): ContractSeason => ({
  year, team: null, base_salary: base, prorated_bonus: pror, option_bonus: 0, roster_bonus: 0, guaranteed_salary: g,
  cap_number: base + pror, cap_percent: null, cash_paid: base, workout_bonus: 0, per_game_roster_bonus: 0, other_bonus: null,
});
let nextId = 1;
function row(extra: Partial<NflContractRow>): NflContractRow {
  return {
    otc_id: nextId++, gsis_id: null, sleeper_id: null, player: `P${nextId}`, position: "WR", team: "Rams", is_active: true,
    contract_type: "UFA", year_signed: 2025, years: 2, value: 1, apy: 1, guaranteed: 0, apy_cap_pct: 0.003,
    draft_year: 2020, draft_round: 4, draft_overall: 120, seasons: [line(2026, 1)],
    source_updated_at: null, refreshed_at: "2026-11-11T00:00:00Z", ...extra,
  };
}

describe("importanceOf (Dynasty+'s definitions on PFF snaps and grades)", () => {
  it("star, established, starter, depth from this season", () => {
    expect(importanceOf(ctx([90.4, 0.67, 7]), BARS.WR, "WR", 9)).toBe("star"); // Puka 2026
    expect(importanceOf(ctx([70.5, 0.69, 7]), BARS.QB, "QB", 9)).toBe("established"); // Kyler Murray 2026
    expect(importanceOf(ctx([61.8, 0.77, 9]), BARS.RB, "RB", 9)).toBe("starter"); // Jonathan Taylor 2026: under the bar on 77%
    expect(importanceOf(ctx([62.9, 0.25, 9]), BARS.RB, "RB", 9)).toBe("depth");
  });

  it("missed much of the season: last season one level lower, and unavailable (the user, 2026-11-11)", () => {
    // Jacobs: 3 of 9 games in 2026 (58.5 on 15%; injury and legal trouble); 2025: 86.0 on 56%.
    const jacobs = ctx([58.5, 0.15, 3], [86, 0.56, 18]);
    expect(missedTime(jacobs, 9)).toBe(true);
    expect(judgeImportance(jacobs, BARS.RB, "RB", 9)).toEqual({
      level: "established", unavailable: true, basis: "established: a star last season, 3 of 9 games this season",
    });
    // Played most of the season: last season doesn't count, and he's available.
    expect(judgeImportance(ctx([62.9, 0.25, 9], [86, 0.56, 18]), BARS.RB, "RB", 9)).toMatchObject({ level: "depth", unavailable: false });
    // No snaps at all this season: last season decides.
    expect(judgeImportance(ctx(null, [80, 0.7, 17]), BARS.WR, "WR", 9)).toMatchObject({
      level: "established", unavailable: true, basis: "established: a star last season, no snaps this season",
    });
    // A backup who rarely plays isn't "unavailable": he wasn't a regular last season either.
    expect(judgeImportance(ctx([50, 0.05, 2], [55, 0.1, 6]), BARS.QB, "QB", 9)).toMatchObject({ level: "depth", unavailable: false });
  });

  it("falls back to the depth chart, then unknown", () => {
    expect(importanceOf({ birthDate: null, current: null, prior: null, depthOrder: 2 }, BARS.WR, "WR", 9)).toBe("established");
    expect(importanceOf({ birthDate: null, current: null, prior: null, depthOrder: 4 }, BARS.WR, "WR", 9)).toBe("depth");
    expect(importanceOf(null, BARS.WR, "WR", 9)).toBe("unknown");
  });
});

describe("teamDirection", () => {
  it("rebuilding at .350 or under, contending at .600 or over, nothing before 4 games", () => {
    expect(teamDirection(team(0.3, 0))).toBe("rebuilding");
    expect(teamDirection(team(0.5, 0))).toBe("middle");
    expect(teamDirection(team(0.67, 0))).toBe("contending");
    expect(teamDirection(team(0, 0, 2))).toBe("middle");
    expect(teamDirection(team(null, 0))).toBe("middle");
  });
});

describe("cutRisk — the user's rule (2026-11-11)", () => {
  // A deal that's cheap to cut in 2027: $15M hit, $3M of proration left → saves $12M.
  const cheap = contractStatus(row({ seasons: [line(2026, 12, 3), line(2027, 12, 3)] }), NOV_2026);

  it("an important player on a team with lots of room isn't cut, however cuttable the deal", () => {
    const call = cutRisk(cheap, "WR", "established", 28, team(0.5, 80), 2027)!;
    expect(call.level).toBe("low");
    expect(call.reasons).toContain("the team has $80.0M of room");
  });

  it("a 31-year-old on a bad, rebuilding team might be", () => {
    const call = cutRisk(cheap, "WR", "starter", 31.5, team(0.22, 20), 2027)!;
    expect(call.level).toBe("likely");
    expect(call.reasons).toEqual([
      "releasing him in 2027 saves $12.0M for $3.0M dead", "a clean exit (4.0× the dead money)", "starter this season",
      "31 in 2027, past a WR's prime (30)", "a veteran on a rebuilding team",
    ]);
    expect(cutRisk(cheap, "WR", "star", 31.5, team(0.22, 20), 2027)!.level).toBe("possible");
  });

  it("Jacobs over Jonathan Taylor (the user's tuning): a lopsided release and missed time vs one that nets little", () => {
    // Jacobs 2027: $16.6M hit, $3.1M dead → saves $13.5M; 29; 3 of 9 games in 2026; Packers 6-3, ~$2M of room.
    const jacobs = contractStatus(row({ position: "RB", seasons: [line(2026, 10.2, 3.1), line(2027, 13.5, 3.1)] }), NOV_2026);
    const who = { level: "established" as const, unavailable: true, basis: "established: a star last season, 3 of 9 games this season" };
    const j = cutRisk(jacobs, "RB", who, 29.4, team(0.67, 2.4), 2027)!;
    expect(j.level).toBe("likely");
    expect(j.reasons).toContain("missed most of this season");
    // Taylor 2027: $21.0M hit, $10.0M dead → saves $11.0M; 28; a 77%-snap starter; Colts tanking with $68.5M of room.
    const taylor = contractStatus(row({ position: "RB", seasons: [line(2026, 8, 10), line(2027, 11, 10)] }), NOV_2026);
    const tay = cutRisk(taylor, "RB", "starter", 28.6, team(0.3, 68.5), 2027)!;
    expect(tay.level).toBe("low");
    expect(tay.reasons).toContain("that nets little: a team would rather trade or keep him");
  });

  it("a minimum backup with no dead money isn't a clean exit", () => {
    const backup = contractStatus(row({ seasons: [line(2026, 1.1), line(2027, 1.1)] }), NOV_2026);
    const call = cutRisk(backup, "WR", "depth", 25, team(0.5, 20), 2027)!;
    expect(call.reasons.some((r) => r.startsWith("a clean exit"))).toBe(false);
    expect(call.level).toBe("possible");
  });

  it("low whenever a release costs more than it saves", () => {
    const locked = contractStatus(row({ seasons: [line(2026, 5, 10), line(2027, 5, 10)] }), NOV_2026);
    const call = cutRisk(locked, "WR", "depth", 35, team(0.1, -20), 2027)!;
    expect(call).toMatchObject({ level: "low", reasons: ["releasing him in 2027 saves $5.0M and leaves $10.0M dead"] });
  });

  it("nothing for a deal that ends first; low for a new deal OTC hasn't broken down", () => {
    const expiring = contractStatus(row({ years: 1, year_signed: 2026 }), NOV_2026);
    expect(cutRisk(expiring, "WR", "depth", 30, team(0.5, 0), 2027)).toBeNull();
    const rookie = contractStatus(row({ contract_type: "Drafted", year_signed: 2026, years: 4, seasons: [] }), NOV_2026);
    expect(cutRisk(rookie, "WR", "depth", 22, team(0.5, 0), 2027)).toMatchObject({ level: "low", reasons: ["a new deal OTC hasn't broken down yet"] });
  });
});

describe("stayOdds", () => {
  const expiring = (extra: Partial<NflContractRow> = {}) => contractStatus(row({ years: 1, year_signed: 2026, ...extra }), NOV_2026);

  it("a young star UFA stays (re-signed or tagged); an old, marginal one leaves", () => {
    const puka = expiring({ draft_year: 2023 });
    expect(stayOdds(puka, "WR", "star", 26, team(0.56, 79), 2027)).toMatchObject({ call: "stays" });
    const old = expiring({ draft_year: 2014 });
    expect(stayOdds(old, "QB", "depth", 38, team(0.67, 2), 2027)).toMatchObject({ call: "leaves" });
    expect(stayOdds(old, "WR", "star", 34, team(0.56, 79), 2027)).toMatchObject({ call: "toss-up" }); // Davante Adams
  });

  it("restricted and exclusive-rights free agents are the team's to keep when they play a role", () => {
    expect(stayOdds(expiring({ draft_year: 2025 }), "WR", "starter", 24, team(0.5, 0), 2027)).toMatchObject({ call: "stays" }); // ERFA
    expect(stayOdds(expiring({ draft_year: 2025 }), "WR", "unknown", 24, team(0.5, 0), 2027)).toMatchObject({ call: "toss-up" });
    expect(stayOdds(expiring({ draft_year: 2024 }), "WR", "established", 25, team(0.5, 0), 2027)).toMatchObject({ call: "stays" }); // RFA
    expect(stayOdds(expiring({ draft_year: 2024 }), "WR", "depth", 25, team(0.5, 0), 2027)).toMatchObject({ call: "toss-up" });
  });

  it("nothing for a practice-squad deal or a player signed for the season", () => {
    expect(stayOdds(expiring({ contract_type: "Practice" }), "WR", "star", 25, team(0.5, 0), 2027)).toBeNull();
    const signed = contractStatus(row({ seasons: [line(2026, 2), line(2027, 2)] }), NOV_2026);
    expect(stayOdds(signed, "WR", "star", 25, team(0.5, 0), 2027)).toBeNull();
  });
});

describe("roomVerdict", () => {
  it("an expiring star who stays fills a spot; a likely cut opens one (the Rams' 2027 WRs, simplified)", () => {
    nextId = 1;
    const rows = [
      row({ player: "Puka", years: 1, year_signed: 2023, draft_year: 2023, draft_round: 5, contract_type: "Drafted", seasons: [line(2026, 5.8)] }),
      row({ player: "Adams", years: 1, year_signed: 2025, draft_year: 2014, apy_cap_pct: 0.079, seasons: [line(2026, 18)] }),
      // Invested, but a 32-year-old starter on a rebuilding team who's cheap to cut: likely gone.
      row({ player: "Vet", years: 2, apy_cap_pct: 0.06, draft_year: 2016, seasons: [line(2026, 15, 2), line(2027, 15, 2)] }),
      row({ player: "Late", contract_type: "Drafted", draft_round: 7, draft_year: 2025, year_signed: 2025, years: 4, seasons: [line(2026, 1), line(2027, 1.1), line(2028, 1.2)] }),
    ];
    const room = buildContractRooms(rows, NOV_2026).teams.find((t) => t.teamId === 14)!.rooms.WR;
    expect(room.outlook[0].openSpots).toBe(2); // contracts alone: only Vet is invested for 2027

    const contexts: Record<string, PlayerContext> = {
      Puka: ctx([90.4, 0.67, 7], null, "2001-05-29"),
      Adams: ctx([80, 0.6, 9], null, "1992-12-24"),
      Vet: ctx([55, 0.5, 9], null, "1994-12-20"),
      Late: ctx([58, 0.2, 9], null, "2002-01-01"),
    };
    const v = roomVerdict(room, 2027, (p) => contexts[p.name], team(0.3, 20), BARS.WR);
    const by = Object.fromEntries(v.players.map((p) => [p.player.name, p]));
    expect(by.Puka).toMatchObject({ importance: "star", core: true, stay: { call: "stays" } });
    expect(by.Adams).toMatchObject({ importance: "star", core: false, stay: { call: "leaves" } }); // 34, a rebuilding team
    expect(by.Vet).toMatchObject({ importance: "starter", core: false, cut: { level: "likely" } });
    expect(by.Late).toMatchObject({ importance: "depth", core: false });
    expect(v).toMatchObject({ expectedCore: 1, openSpots: 2 });
    expect(Math.floor(by.Puka.age!)).toBe(26);
  });
});
