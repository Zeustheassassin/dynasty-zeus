// @vitest-environment node
import { describe, it, expect } from "vitest";
import { alignmentMixByGame, blendCoverage, teRoutesBySpot, wrRoutesBySpot } from "@/lib/scouting/alignmentMix";
import { COV, gameCovariates, LINE_MATCHUP_WEIGHT, lineMatchup, lineRefOf, SEASON_UNIT_SPECS, resolveGameContexts, type GameContext, type GameContextData, type GameContextRow, type SeasonUnits } from "@/lib/scouting/gameContext";
import { SEASON_UNIT_TESTS, seasonUnitCheck, type ContextMetric } from "@/lib/scouting/contextChecks";
import { addGameResidual, contextLift, type ByGame } from "@/lib/scouting/contextEffects";
import type { TEPlay } from "@/lib/types";

describe("where he ran his routes", () => {
  it("counts a WR's routes by spot from his route cells, tagged cells filling games the plain ones lack", () => {
    const m = wrRoutesBySpot(
      [{ prospect_id: "w", game_id: "g1", cells: { "slant|man|left|on": [6, 3], "go|zone|right|off": [4, 1], "dig|zone|slot|off": [5, 2], "flat|zone|backfield|off": [1, 1], "x|y|nowhere|on": [9, 9] } }],
      [
        { prospect_id: "w", game_id: "g1", cells: { "slant|man|slot|off|0|0|0|0|-|-": [50, 0] } },
        { prospect_id: "w", game_id: "g2", cells: { "slant|man|slot|off|0|0|0|0|-|-": [3, 1] } },
      ],
    );
    expect(m.get("g1")).toEqual({ outside: 10, slot: 5, box: 1 });
    expect(m.get("g2")).toEqual({ outside: 0, slot: 3, box: 0 });
  });

  it("counts a TE's route-run plays by spot (inline / wing / backfield = box)", () => {
    const p = (game_id: string, positioning: TEPlay["positioning"], play_type: TEPlay["play_type"] = "route_run") => ({ game_id, positioning, play_type });
    const m = teRoutesBySpot([p("t", "inline"), p("t", "wing_back"), p("t", "slot"), p("t", "wide"), p("t", "inline", "run_block")]);
    expect(m.get("t")).toEqual({ outside: 1, slot: 1, box: 2 });
  });

  it("uses his routes that game, else his usual mix", () => {
    const games = [{ id: "a", prospect_id: "w" }, { id: "b", prospect_id: "w" }, { id: "c", prospect_id: "w" }, { id: "z", prospect_id: "none" }];
    const mix = alignmentMixByGame(games, new Map([["a", { outside: 3, slot: 1, box: 0 }], ["b", { outside: 1, slot: 3, box: 0 }]]));
    expect(mix.get("a")).toEqual({ outside: 0.75, slot: 0.25, box: 0 });
    expect(mix.get("c")).toEqual({ outside: 0.5, slot: 0.5, box: 0 });
    expect(mix.has("z")).toBe(false);
  });

  it("blends the coverage grades by his mix, dropping a spot without a grade", () => {
    expect(blendCoverage({ outside: 0.75, slot: 0.25, box: 0 }, { outside: 60, slot: 80, box: 50 })).toBe(65);
    expect(blendCoverage({ outside: 0.5, slot: 0.5, box: 0 }, { outside: null, slot: 80, box: 50 })).toBe(80);
    expect(blendCoverage({ outside: 1, slot: 0, box: 0 }, { outside: null, slot: 80, box: 50 })).toBeNull();
  });
});

describe("season units as covariates", () => {
  const row = (game_id: string, extra: Partial<GameContextRow>): GameContextRow => ({
    game_id, prospect_id: "p", cfd_game_id: null, cfd_match_status: "no_match", cfd_match_note: null, team_school: null, opponent_school: null,
    cast_status: "ok", pff_franchise_id: 1, team_snaps: null, his_snaps: null, ol_pass_block: null, ol_pass_block_snaps: null,
    ol_run_block: null, ol_run_block_snaps: null, qb_pass_grade: null, qb_name: null, qb_pff_id: null, qb_dropbacks: null, fetched_at: "",
    season_units_status: "ok", ol_run_block_season: 58, team_season_games: 12, opp_front7_run_def: 70, opp_mt_rate: 14.2,
    opp_cov_outside: 60, opp_cov_slot: 80, opp_cov_box: 50, opp_season_games: 13, ...extra,
  });
  const data: GameContextData = {
    rows: [
      row("full", {}),
      row("thinOpp", { opp_season_games: 2 }),
      row("thinTeam", { team_season_games: 1 }),
      row("qb", { season_units_status: "n/a" }),
    ],
    cfdGames: [], teamSeasons: [],
  };
  const games = ["full", "thinOpp", "thinTeam", "qb"].map((id) => ({ id, season_year: 2025 }));
  const ctx = resolveGameContexts(games, data);

  it("resolves the units and whether each report has a full season behind it", () => {
    expect(ctx.get("full")!.units).toMatchObject({ olRunBlock: 58, oppFront7: 70, oppMtRate: 14.2, teamFull: true, oppFull: true });
    expect(ctx.get("thinOpp")!.units).toMatchObject({ oppFull: false, teamFull: true });
    expect(ctx.get("qb")!.units).toBeNull();
  });

  it("uses only full-season reports, and blends coverage by where he lined up", () => {
    const mix = new Map([["full", { outside: 0.75, slot: 0.25, box: 0 }], ["thinTeam", { outside: 0, slot: 1, box: 0 }]]);
    const cc = gameCovariates(games, ctx, new Map(), mix);
    expect(cc.cov.get("full")).toMatchObject({ [COV.seasonOlRunBlock]: 58, [COV.oppFront7]: 70, [COV.oppMtRate]: 14.2, [COV.oppCoverage]: 65 });
    // The opponent's report is thin (2 games): only his own line counts.
    expect(cc.cov.get("thinOpp")![COV.seasonOlRunBlock]).toBe(58);
    expect(cc.cov.get("thinOpp")![COV.oppFront7]).toBeUndefined();
    expect(cc.cov.get("thinTeam")).toMatchObject({ [COV.oppFront7]: 70, [COV.oppCoverage]: 80 });
    expect(cc.cov.get("thinTeam")![COV.seasonOlRunBlock]).toBeUndefined();
    expect(cc.cov.get("qb")?.[COV.oppFront7]).toBeUndefined();
    // No alignment mix: no coverage input.
    expect(gameCovariates(games, ctx, new Map()).cov.get("full")![COV.oppCoverage]).toBeUndefined();
  });
});

describe("the line matchup", () => {
  const u = (ol: number | null, f7: number | null, over: Partial<SeasonUnits> = {}): SeasonUnits => ({
    olRunBlock: ol, teamGames: 12, oppFront7: f7, oppCoverage: { outside: null, slot: null, box: null }, oppMtRate: null, oppGames: 12,
    teamFull: true, oppFull: true, ...over,
  });
  const ref = { ol: 65, olSd: 5, front7: 69, front7Sd: 4.5 };

  it("is 0 for average vs average, tough for a bad line against a great front, each on its own scale", () => {
    expect(lineMatchup(u(65, 69), ref)).toBe(0);
    expect(lineMatchup(u(55, 75), ref)).toBeCloseTo(6 / 4.5 + 2, 6); // 55 line −2 steps, 75 front +1.33
    expect(lineMatchup(u(55, 55), ref)! < 0).toBe(true); // a 55 front is further below its average than a 55 line
  });

  it("counts a thin line report as an average line so the D-line still counts; skips a thin front or a non-RB game", () => {
    expect(lineMatchup(u(55, 78, { teamFull: false }), ref)).toBe(2);
    expect(lineMatchup(u(55, 78, { oppFull: false }), ref)).toBeNull();
    expect(lineMatchup(u(null, 78, { teamGames: null }), ref)).toBeNull(); // a WR / TE game: no line report read
  });

  it("fits on the D-line half and applies the effect to the whole gap", () => {
    const ctx = new Map<string, GameContext>([
      ["a", { units: u(55, 78) } as unknown as GameContext],
      ["b", { units: u(75, 72) } as unknown as GameContext],
    ]);
    const cc = gameCovariates([{ id: "a" }, { id: "b" }], ctx, new Map());
    expect(cc.lineRef).toEqual({ ol: 65, olSd: 10, front7: 75, front7Sd: 3 });
    expect(cc.cov.get("a")![COV.lineFront7]).toBeCloseTo(1, 9); // a front one spread above average
    expect(cc.cov.get("a")![COV.lineMatchup]).toBeCloseTo(2, 9); // ...against a line one spread below: tough
    expect(cc.cov.get("b")![COV.lineMatchup]).toBeCloseTo(-2, 9);
    // One effect of −0.02 per step, fit on the D-line: a game's lift reads the whole gap, at LINE_MATCHUP_WEIGHT.
    const fit = { specs: [SEASON_UNIT_SPECS.lineMatchup], beta: { [COV.lineFront7]: -0.02 }, ref: { [COV.lineFront7]: 0 }, prospects: 10, games: 20, reps: 400 };
    const byGame = { a: { n: 10, resid: 0, w: 10 } };
    expect(LINE_MATCHUP_WEIGHT).toBe(0.5); // the user's call, 2026-11-19: "cut in half"
    expect(contextLift(byGame, cc.cov, fit)).toBeCloseTo(-0.02 * LINE_MATCHUP_WEIGHT * cc.cov.get("a")![COV.lineMatchup], 9);
    // A spec without applyWeight counts in full.
    const full = { ...fit, specs: [{ ...SEASON_UNIT_SPECS.lineMatchup, applyWeight: undefined }] };
    expect(contextLift(byGame, cc.cov, full)).toBeCloseTo(-0.02 * cc.cov.get("a")![COV.lineMatchup], 9);
  });

  it("measures the yardsticks over RB games with full reports", () => {
    const c = (units: SeasonUnits) => ({ units }) as unknown as GameContext;
    const r = lineRefOf([c(u(60, 66)), c(u(70, 72)), c(u(null, 99, { teamGames: null })), c(u(99, 99, { teamFull: false, oppFull: false }))])!;
    expect(r).toMatchObject({ ol: 65, olSd: 5, front7: 69, front7Sd: 3 });
  });
});

describe("the season unit tests", () => {
  it("tests coverage only for WR and TE, and every planned input", () => {
    expect(SEASON_UNIT_TESTS).toHaveLength(18);
    expect(SEASON_UNIT_TESTS.filter((t) => t.input === "coverage").every((t) => /^(wr_|te_|pff_wr_|pff_te_)/.test(t.key))).toBe(true);
    expect(SEASON_UNIT_TESTS.filter((t) => t.key.includes("rb")).map((t) => t.input).sort()).toEqual(["matchup", "matchup", "matchup", "matchup", "matchup", "mt", "mt"]);
    expect(SEASON_UNIT_TESTS.find((t) => t.key === "te_saeb")?.input).toBe("front7");
  });

  // 14 prospects × 5 games: a game's residual falls as the opponent's coverage rises; SP+ is noise.
  function metric(key: string): { m: ContextMetric; cov: Map<string, Record<string, number>> } {
    const samples: [string, ByGame][] = [];
    const cov = new Map<string, Record<string, number>>();
    for (let p = 0; p < 14; p++) {
      const bg: ByGame = {};
      for (let g = 0; g < 5; g++) {
        const id = `p${p}g${g}`;
        const coverage = 55 + ((p * 5 + g) * 7) % 25;
        addGameResidual(bg, id, 40, 40 * (-0.01 * (coverage - 67) + (p % 4) * 0.02));
        cov.set(id, {
          [COV.oppCoverage]: coverage, [COV.oppDefSp]: 15 + ((p * 3 + g * 11) % 13), [COV.oppFcs]: 0, [COV.g5]: g === 4 ? 1 : 0, [COV.fcsTier]: 0,
        });
      }
      samples.push([`p${p}`, bg]);
    }
    return { m: { key, label: key, pos: "WR", scale: 100, samples }, cov };
  }

  it("finds a planted coverage effect on top of SP+, and as SP+'s replacement", () => {
    const { m, cov } = metric("wr_csae");
    const u = seasonUnitCheck(m, "coverage", { cov, spRef: 21, fcsSp: 30 });
    expect(u).toMatchObject({ id: "wr_csae|coverage", base: "Opp. D SP+", testable: true, prospects: 14, games: 70, beatsBase: true });
    expect(u.improvement!).toBeGreaterThan(0.2);
    expect(u.effects).toHaveLength(1);
    expect(u.effects[0].effect).toBeLessThan(0); // tougher coverage, fewer open routes
    expect(u.replace!.beatsSp).toBe(true);
    expect(u.replace!.improvement!).toBeGreaterThan(u.replace!.sp ?? 0);
  });

  it("tests a tier metric on top of the tiers, with no SP+ replacement", () => {
    const { m, cov } = metric("te_saer");
    const u = seasonUnitCheck({ ...m, pos: "TE" }, "coverage", { cov, spRef: 21, fcsSp: 30 });
    expect(u.base).toBe("Tiers");
    expect(u.replace).toBeNull();
    expect(u.beatsBase).toBe(true);
  });

  it("isn't testable before 10 prospects have the input", () => {
    const { m, cov } = metric("wr_csae");
    const u = seasonUnitCheck({ ...m, samples: m.samples.slice(0, 6) }, "coverage", { cov, spRef: 21, fcsSp: 30 });
    expect(u.testable).toBe(false);
    expect(u.improvement).toBeNull();
  });
});
