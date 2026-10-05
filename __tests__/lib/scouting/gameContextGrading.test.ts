import { describe, it, expect } from "vitest";
import { gameCovariates, resolveGameContexts, COV, type GameContext, type GameContextData } from "@/lib/scouting/gameContext";
import { contextAdjust, metricContext, OPPONENT_SP, WEATHER_ON, CAST_ON } from "@/lib/scouting/contextGrading";
import { addGameResidual, type ByGame } from "@/lib/scouting/contextEffects";
import { gameFlagWeight, leftEarlySuggestions, flaggedGameTest, LEFT_EARLY_WEIGHT, PLAYED_HURT_WEIGHT } from "@/lib/scouting/gameFlags";
import { seasonWeights } from "@/lib/scouting/seasonWeight";
import type { AESample, ScoutingGame } from "@/lib/types";
import type { CfdGameWithWeather } from "@/lib/cfd/types";
import type { OpponentTier } from "@/lib/scouting/opponentTier";

const cfdGame = (id: number, home: string, away: string, extra: Partial<CfdGameWithWeather> = {}): CfdGameWithWeather => ({
  id, season: 2025, week: 1, season_type: "regular", start_date: "2025-09-06T17:00:00Z", start_time_tbd: false, completed: true,
  neutral_site: false, venue_id: 1, venue: "V", home_team: home, home_classification: "fbs", home_points: 42, away_team: away,
  away_classification: "fbs", away_points: 7, weather_status: "ok", temperature_f: 35, wind_mph: 12, precip_in: 0.2, snow_in: 0,
  gust_mph: 20, weather_code: 63, humidity: 80, ...extra,
});
const row = (game_id: string, cfd: number | null, opp: string | null, extra = {}) => ({
  game_id, prospect_id: "p", cfd_game_id: cfd, cfd_match_status: cfd ? "auto" as const : "no_match" as const, cfd_match_note: null,
  team_school: "Ohio State", opponent_school: opp, cast_status: "ok" as const, pff_franchise_id: 260, team_snaps: 60, his_snaps: 50,
  ol_pass_block: 70, ol_pass_block_snaps: 100, ol_run_block: 65, ol_run_block_snaps: 100, qb_pass_grade: 80, qb_name: "QB", qb_pff_id: 1,
  qb_dropbacks: 30, fetched_at: "", ...extra,
});

describe("resolveGameContexts / gameCovariates", () => {
  const data: GameContextData = {
    rows: [row("g1", 1, "Michigan"), row("g2", 2, "Youngstown State"), row("g3", 3, "Toledo"), row("g4", null, null)],
    cfdGames: [
      cfdGame(1, "Ohio State", "Michigan"),
      cfdGame(2, "Ohio State", "Youngstown State", { away_classification: "fcs", weather_status: "dome" }),
      cfdGame(3, "Toledo", "Ohio State", { temperature_f: 70, wind_mph: 5, precip_in: 0 }),
    ],
    teamSeasons: [
      { season: 2025, school: "Michigan", conference: "Big Ten", sp_rating: 15, sp_offense: 30, sp_defense: 12, sp_ranking: 10, sp_defense_ranking: 5 },
      { season: 2025, school: "Toledo", conference: "MAC", sp_rating: 2, sp_offense: 25, sp_defense: 30, sp_ranking: 70, sp_defense_ranking: 90 },
    ],
  };
  const games = ["g1", "g2", "g3", "g4"].map((id) => ({ id, season_year: 2025 }));
  const ctx = resolveGameContexts(games, data);

  it("joins the CFD game, the opponent's SP+, weather and cast", () => {
    expect(ctx.get("g1")).toMatchObject({ matched: true, opponentFcs: false, oppDefSp: 12, oppDefRank: 5, home: true, teamPoints: 42, oppPoints: 7, snapShare: 50 / 60 });
    expect(ctx.get("g1")!.weather).toMatchObject({ status: "ok", temperatureF: 35, precipIn: 0.2 });
    expect(ctx.get("g3")).toMatchObject({ home: false, teamPoints: 7, oppPoints: 42 });
    expect(ctx.get("g2")).toMatchObject({ opponentFcs: true, oppDefSp: null });
    expect(ctx.get("g4")).toMatchObject({ matched: false });
  });

  it("an FCS opponent counts as the average charted G5 defense; a dome is calm and dry", () => {
    const tiers = new Map<string, OpponentTier>([["g1", "P4"], ["g2", "FCS"], ["g3", "G5"]]);
    const cc = gameCovariates(games, ctx, tiers);
    expect(cc.spRef).toBe(21);
    expect(cc.fcsSp).toBe(30);
    expect(cc.cov.get("g2")).toMatchObject({ [COV.oppFcs]: 1, [COV.oppDefSp]: 30, [COV.wind]: 0, [COV.rain]: 0, [COV.cold]: 0, [COV.fcsTier]: 1 });
    expect(cc.cov.get("g1")).toMatchObject({ [COV.oppFcs]: 0, [COV.oppDefSp]: 12, [COV.rain]: 1, [COV.cold]: 1, [COV.wind]: 12, [COV.g5]: 0, [COV.qbGrade]: 80 });
    // No CFD match: no opponent or weather, but the cast (PFF) is still there.
    expect(Object.keys(cc.cov.get("g4")!).sort()).toEqual([COV.olPassBlock, COV.olRunBlock, COV.qbGrade].sort());
  });
});

describe("contextGrading policy", () => {
  it("switches on only what passed (cast never)", () => {
    expect([...OPPONENT_SP].sort()).toEqual(["ch_qb_p2s", "pff_wr_yprr", "wr_csae"]);
    expect([...WEATHER_ON].sort()).toEqual(["ch_wr_cc", "pff_rb_yprr"]);
    expect(CAST_ON.size).toBe(0);
    expect(metricContext("rb_srae")).toEqual({ opponent: "tier", weather: false, cast: false });
  });

  // 12 prospects, 4 games each, residual rising with the opponent's defensive SP+.
  function samples(): { raw: Map<string, AESample>; cov: Map<string, Record<string, number>> } {
    const raw = new Map<string, AESample>(), cov = new Map<string, Record<string, number>>();
    for (let p = 0; p < 12; p++) {
      const bg: ByGame = {};
      for (let g = 0; g < 4; g++) {
        const id = `p${p}g${g}`, sp = 12 + ((p * 4 + g) * 7) % 20;
        addGameResidual(bg, id, 40, 40 * (0.01 * (sp - 21) + (p % 3) * 0.01));
        cov.set(id, { [COV.oppDefSp]: sp, [COV.oppFcs]: 0, [COV.g5]: 0, [COV.fcsTier]: 0, [COV.wind]: 5, [COV.rain]: 0, [COV.cold]: 0 });
      }
      raw.set(`p${p}`, { ae: p, n: 160, w: 160, variance: 4, byGame: bg });
    }
    return { raw, cov };
  }

  it("a tier-only metric keeps today's tier-adjusted sample exactly", () => {
    const { raw, cov } = samples();
    const tier = new Map([...raw].map(([id, s]) => [id, { ...s, ae: s.ae - 1, rawAe: s.ae }]));
    const out = contextAdjust("rb_srae", "RB", raw, tier, { cov, spRef: 21, fcsSp: 30 });
    expect(out.samples.get("p3")).toBe(tier.get("p3"));
    expect(out.info.fit).toBeNull();
  });

  it("an SP+ metric replaces the tier adjustment with the SP+ fit", () => {
    const { raw, cov } = samples();
    const tier = new Map([...raw].map(([id, s]) => [id, { ...s, ae: s.ae - 1, rawAe: s.ae }]));
    const out = contextAdjust("wr_csae", "WR", raw, tier, { cov, spRef: 21, fcsSp: 30 });
    expect(out.info.fit!.beta[COV.oppDefSp]).toBeGreaterThan(0.005);
    expect(out.samples.get("p3")!.rawAe).toBe(3);
    expect(out.samples.get("p3")!.ae).not.toBe(2);
  });

  it("falls back to today's adjustment with too few prospects (before the context is filled)", () => {
    const { raw, cov } = samples();
    const few = new Map([...raw].slice(0, 5));
    const out = contextAdjust("wr_csae", "WR", few, few, { cov, spRef: 21, fcsSp: 30 });
    expect(out.info.fit).toBeNull();
    expect(out.samples.get("p1")).toBe(few.get("p1"));
  });

  it("weather on a tier metric goes on top of today's tier adjustment", () => {
    const { raw, cov } = samples();
    for (const [id, v] of cov) v[COV.wind] = 3 + (Number(id.split("g")[1]) * 5);
    const tier = new Map([...raw].map(([id, s]) => [id, { ...s, ae: s.ae - 1, rawAe: s.ae }]));
    const out = contextAdjust("ch_wr_cc", "WR", raw, tier, { cov, spRef: 21, fcsSp: 30 }, 100);
    expect(out.info.fit?.specs.every((s) => ["wind", "rain", "cold"].includes(s.key)) ?? true).toBe(true);
    expect(out.samples.get("p3")!.rawAe).toBe(3);
  });
});

describe("game flags", () => {
  const game = (id: string, prospect: string, extra: Partial<ScoutingGame> = {}) =>
    ({ id, prospect_id: prospect, season_year: 2025, left_early: null, played_hurt: false, ...extra }) as ScoutingGame;

  it("count in full until a flag's weight is switched on", () => {
    expect(LEFT_EARLY_WEIGHT).toBe(1);
    expect(PLAYED_HURT_WEIGHT).toBe(1);
    expect(gameFlagWeight({ left_early: true, played_hurt: true })).toBe(1);
    const gs = [game("a", "p", { left_early: true, played_hurt: true }), game("b", "p")];
    expect(seasonWeights(gs)).toEqual(new Map([["a", 1], ["b", 1]]));
  });

  it("suggests left early from his snap share vs his usual, notes blowouts, skips dismissed games", () => {
    const share = (s: number, extra = {}) =>
      ({ snapShare: s, hisSnaps: Math.round(s * 60), teamSnaps: 60, teamPoints: 21, oppPoints: 17, ...extra }) as unknown as GameContext;
    const contexts = new Map<string, GameContext>([
      ["a", share(0.9)], ["b", share(0.85)], ["c", share(0.3)], ["d", share(0.25, { teamPoints: 56, oppPoints: 10 })], ["e", share(0.2)],
    ]);
    const games = [game("a", "p"), game("b", "p"), game("c", "p"), game("d", "p"), game("e", "p", { left_early: false })];
    const s = leftEarlySuggestions(games, contexts);
    expect([...s.keys()].sort()).toEqual(["c", "d"]);
    expect(s.get("c")).toMatchObject({ blowout: false });
    expect(s.get("d")).toMatchObject({ blowout: true });
    expect(leftEarlySuggestions(games.slice(0, 2), contexts).size).toBe(0);
  });

  it("tests whether flagged games say less about a player", () => {
    const samples: [string, ByGame][] = [];
    const flagged = new Set<string>();
    for (let p = 0; p < 6; p++) {
      const bg: ByGame = {};
      for (let g = 0; g < 4; g++) addGameResidual(bg, `p${p}g${g}`, 20, 20 * 0.05 * p);
      addGameResidual(bg, `p${p}hurt`, 20, 20 * -0.5);
      flagged.add(`p${p}hurt`);
      samples.push([`p${p}`, bg]);
    }
    const t = flaggedGameTest(samples, flagged);
    expect(t).toMatchObject({ testable: true, prospects: 6, flaggedGames: 6, best: 0 });
    expect(flaggedGameTest(samples.slice(0, 3), flagged).testable).toBe(false);
  });
});
