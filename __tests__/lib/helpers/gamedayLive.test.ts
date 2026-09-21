import { describe, it, expect } from "vitest";
import {
  gameFractionRemaining, formatGameDetail, playerAvailability, DOUBTFUL_FACTOR,
  gameScriptMultiplier, projectRemainingPoints, playerRemainingStdDev,
  normalCdf, winProbability, computeBenchRegret, getGamedayPollPlan,
  POLL_LIVE_SCOREBOARD_MS, POLL_LIVE_MATCHUPS_MS, POLL_LIVE_DASHBOARD_MS, POLL_IDLE_SCOREBOARD_MS,
  playerCorrelation, teamVariance, crossTeamCovariance, projectRemainingFromStats, liveStatsMatchOfficialPoints,
  type CorrelatedPlayer,
} from "@/lib/helpers/gamedayLive";
import type { SleeperPlayer, TeamGameState } from "@/lib/types";

const live = (over: Partial<TeamGameState> = {}): TeamGameState => ({ kickoffAt: 1, state: "Live", ...over });
const MIN = 60_000;

describe("gameFractionRemaining", () => {
  it("is 1 for Upcoming and 0 for Final", () => {
    expect(gameFractionRemaining({ kickoffAt: 1, state: "Upcoming" })).toBe(1);
    expect(gameFractionRemaining({ kickoffAt: 1, state: "Final" })).toBe(0);
  });

  it("reads the game clock: full game left at the start of Q1", () => {
    expect(gameFractionRemaining(live({ period: 1, clockSeconds: 900 }))).toBe(1);
  });

  it("reads the game clock: Q3 with 4:12 left", () => {
    expect(gameFractionRemaining(live({ period: 3, clockSeconds: 252 }))).toBeCloseTo((900 + 252) / 3600, 10);
  });

  it("is 0 at the end of Q4", () => {
    expect(gameFractionRemaining(live({ period: 4, clockSeconds: 0 }))).toBe(0);
  });

  it("treats halftime as exactly half the game left", () => {
    expect(gameFractionRemaining(live({ status: "halftime", period: 2, clockSeconds: 0 }))).toBe(0.5);
  });

  it("measures overtime against regulation length", () => {
    expect(gameFractionRemaining(live({ period: 5, clockSeconds: 600 }))).toBeCloseTo(600 / 3600, 10);
  });

  it("assumes a period just started when there's a period but no clock", () => {
    expect(gameFractionRemaining(live({ period: 2 }))).toBeCloseTo((2 * 900 + 900) / 3600, 10);
  });

  it("returns null for a Live game with no period data, and for a missing game", () => {
    expect(gameFractionRemaining(live())).toBeNull();
    expect(gameFractionRemaining(undefined)).toBeNull();
  });
});

describe("formatGameDetail", () => {
  it("shows quarter, clock, score and possession for a live game", () => {
    const g = live({ period: 3, clockDisplay: "4:12", score: 17, oppScore: 10, hasPossession: true });
    expect(formatGameDetail(g, "SF")).toBe("Q3 4:12 · SF 17-10 · SF ball");
  });

  it("labels halftime and overtime", () => {
    expect(formatGameDetail(live({ status: "halftime", score: 17, oppScore: 10 }), "SF")).toBe("Halftime · SF 17-10");
    expect(formatGameDetail(live({ period: 5, clockDisplay: "8:00" }), "SF")).toBe("OT 8:00");
  });

  it("shows the final score for a Final game and nothing for a plain Upcoming one", () => {
    expect(formatGameDetail({ kickoffAt: 1, state: "Final", score: 24, oppScore: 20 }, "SF")).toBe("SF 24-20");
    expect(formatGameDetail({ kickoffAt: 1, state: "Upcoming" }, "SF")).toBe("");
    expect(formatGameDetail(undefined, "SF")).toBe("");
  });

  it("surfaces postponed / delayed / canceled instead of a bare Upcoming", () => {
    expect(formatGameDetail({ kickoffAt: 1, state: "Upcoming", status: "postponed" }, "SF")).toBe("Postponed");
    expect(formatGameDetail({ kickoffAt: 1, state: "Upcoming", status: "delayed" }, "SF")).toBe("Delayed");
    expect(formatGameDetail({ kickoffAt: 1, state: "Final", status: "canceled" }, "SF")).toBe("Canceled");
    expect(formatGameDetail(live({ status: "delayed", period: 2, score: 3, oppScore: 0 }), "SF")).toBe("Delayed · SF 3-0");
  });
});

describe("playerAvailability", () => {
  const p = (over: Partial<SleeperPlayer>) => over as SleeperPlayer;

  it("zeroes players who can't play", () => {
    expect(playerAvailability(p({ injury_status: "Out" }))).toBe(0);
    expect(playerAvailability(p({ injury_status: "IR" }))).toBe(0);
    expect(playerAvailability(p({ injury_status: "PUP" }))).toBe(0);
    expect(playerAvailability(p({ injury_status: null, status: "Inactive" }))).toBe(0);
  });

  it("discounts Doubtful, leaves Questionable and healthy alone", () => {
    expect(playerAvailability(p({ injury_status: "Doubtful" }))).toBe(DOUBTFUL_FACTOR);
    expect(playerAvailability(p({ injury_status: "Questionable" }))).toBe(1);
    expect(playerAvailability(p({ injury_status: null, status: "Active" }))).toBe(1);
  });

  it("assumes available when there's no player record", () => {
    expect(playerAvailability(null)).toBe(1);
  });
});

describe("gameScriptMultiplier", () => {
  it("is neutral with no score, before kickoff and after the game", () => {
    expect(gameScriptMultiplier("RB", null, 0.5)).toBe(1);
    expect(gameScriptMultiplier("RB", 14, 1)).toBe(1);
    expect(gameScriptMultiplier("RB", 14, 0)).toBe(1);
  });

  it("boosts RBs and trims pass-catchers when leading at halftime", () => {
    expect(gameScriptMultiplier("RB", 14, 0.5)).toBeCloseTo(1.12, 10);
    expect(gameScriptMultiplier("WR", 14, 0.5)).toBeCloseTo(0.92, 10);
    expect(gameScriptMultiplier("QB", 14, 0.5)).toBeCloseTo(0.95, 10);
  });

  it("does the opposite when trailing", () => {
    expect(gameScriptMultiplier("RB", -14, 0.5)).toBeCloseTo(0.88, 10);
    expect(gameScriptMultiplier("WR", -14, 0.5)).toBeCloseTo(1.08, 10);
  });

  it("ramps in: a lead early in the game moves things less", () => {
    const early = gameScriptMultiplier("RB", 14, 0.9); // 10% elapsed → ramp 0.2
    expect(early).toBeGreaterThan(1);
    expect(early).toBeLessThan(gameScriptMultiplier("RB", 14, 0.5));
  });

  it("cuts a leading team's QB and pass-catchers hard in a late blowout, but not the RB", () => {
    expect(gameScriptMultiplier("QB", 21, 0.2)).toBeCloseTo(0.95 * 0.5, 10);
    expect(gameScriptMultiplier("WR", 21, 0.2)).toBeCloseTo(0.92 * 0.7, 10);
    expect(gameScriptMultiplier("RB", 21, 0.2)).toBeCloseTo(1.12, 10);
  });

  it("does not apply the blowout cut while the game is still young", () => {
    expect(gameScriptMultiplier("QB", 21, 0.6)).toBeCloseTo(1 - 0.05 * (0.4 / 0.5), 10);
  });
});

describe("projectRemainingPoints", () => {
  const base = { position: "WR", lead: null, availability: 1 } as const;

  it("is the full projection before kickoff", () => {
    expect(projectRemainingPoints({ ...base, projected: 18.2, actual: 0, fractionRemaining: 1 })).toBeCloseTo(18.2, 10);
  });

  it("is zero once the game is over or the player can't play", () => {
    expect(projectRemainingPoints({ ...base, projected: 18, actual: 12, fractionRemaining: 0 })).toBe(0);
    expect(projectRemainingPoints({ ...base, projected: 18, actual: 0, fractionRemaining: 1, availability: 0 })).toBe(0);
  });

  it("scales the projection by the share of the game left when pacing exactly to projection", () => {
    // 20 proj, 10 scored at halftime = right on pace → half the projection is left.
    expect(projectRemainingPoints({ ...base, projected: 20, actual: 10, fractionRemaining: 0.5 })).toBeCloseTo(10, 10);
  });

  it("does NOT report 0 left for a player who already passed their pre-game number (the reported bug)", () => {
    // Old behavior: max(10 - 25, 0) = 0 at halftime. Now: still half a game to play.
    const remaining = projectRemainingPoints({ ...base, projected: 10, actual: 25, fractionRemaining: 0.5 });
    expect(remaining).toBeGreaterThan(0);
    // ratio clamped to 2 → pace 1.25 → 5 * 1.25
    expect(remaining).toBeCloseTo(6.25, 10);
  });

  it("shrinks a hot start toward the projection instead of extrapolating it", () => {
    // 20 proj, 20 scored at halftime = 2× pace. Full extrapolation would say 20 more; shrunk = 12.5.
    expect(projectRemainingPoints({ ...base, projected: 20, actual: 20, fractionRemaining: 0.5 })).toBeCloseTo(12.5, 10);
  });

  it("trims a cold start, but bounded by the pace floor", () => {
    expect(projectRemainingPoints({ ...base, projected: 20, actual: 0, fractionRemaining: 0.5 })).toBeCloseTo(8.5, 10);
  });

  it("ignores pace this early in the game — three snaps is not a trend", () => {
    expect(projectRemainingPoints({ ...base, projected: 20, actual: 15, fractionRemaining: 0.95 })).toBeCloseTo(19, 10);
  });

  it("trusts observed pace more as the game goes on", () => {
    const at = (fractionRemaining: number) => {
      const elapsed = 1 - fractionRemaining;
      // Scoring at exactly 1.5× projected pace at every checkpoint.
      const r = projectRemainingPoints({ ...base, projected: 20, actual: 20 * elapsed * 1.5, fractionRemaining });
      return r / (20 * fractionRemaining); // implied pace multiplier
    };
    expect(at(0.25)).toBeGreaterThan(at(0.75));
  });

  it("applies availability (Doubtful) and game script", () => {
    expect(projectRemainingPoints({ ...base, projected: 20, actual: 0, fractionRemaining: 1, availability: DOUBTFUL_FACTOR })).toBeCloseTo(4, 10);
    const script = projectRemainingPoints({ ...base, position: "RB", projected: 20, actual: 10, fractionRemaining: 0.5, lead: 14 });
    expect(script).toBeCloseTo(10 * 1.12, 10);
  });
});

describe("playerRemainingStdDev", () => {
  it("is about 0.4 x projection + 2 for a full game left", () => {
    expect(playerRemainingStdDev(null, 15, 1, 1)).toBeCloseTo(8, 10);
  });

  it("shrinks with the square root of the time left", () => {
    expect(playerRemainingStdDev(null, 15, 0.25, 1)).toBeCloseTo(4, 10);
  });

  it("is zero when nothing is left to play", () => {
    expect(playerRemainingStdDev(null, 15, 0, 1)).toBe(0);
    expect(playerRemainingStdDev(null, 15, 1, 0)).toBe(0);
    expect(playerRemainingStdDev(null, 0, 1, 1)).toBe(0);
  });

  it("widens when sources disagree and narrows when they agree", () => {
    const volatile = { fpts: 15, sourceFpts: { a: 10, b: 15, c: 22 } };
    const steady = { fpts: 15, sourceFpts: { a: 14.5, b: 15, c: 15.5 } };
    expect(playerRemainingStdDev(volatile, 15, 1, 1)).toBeCloseTo(8 * 1.15, 10);
    expect(playerRemainingStdDev(steady, 15, 1, 1)).toBeCloseTo(8 * 0.9, 10);
  });
});

describe("normalCdf / winProbability", () => {
  it("matches known normal quantiles", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(1) + normalCdf(-1)).toBeCloseTo(1, 6);
  });

  it("is a coin flip for equal teams", () => {
    expect(winProbability(100, 10, 100, 10)).toBeCloseTo(0.5, 6);
  });

  it("favors the higher projection, more so with less spread", () => {
    const wide = winProbability(110, 20, 100, 20);
    const tight = winProbability(110, 5, 100, 5);
    expect(wide).toBeGreaterThan(0.5);
    expect(tight).toBeGreaterThan(wide);
    // z = 10 / sqrt(200) = 0.7071 → ~0.760
    expect(winProbability(110, 10, 100, 10)).toBeCloseTo(0.760, 2);
  });

  it("is exactly 1 / 0 / 0.5 when neither side has any uncertainty left", () => {
    expect(winProbability(110, 0, 100, 0)).toBe(1);
    expect(winProbability(90, 0, 100, 0)).toBe(0);
    expect(winProbability(100, 0, 100, 0)).toBe(0.5);
  });

  it("moves toward certainty as the trailing side runs out of time", () => {
    const early = winProbability(110, 20, 100, 20);
    const late = winProbability(110, 4, 100, 4);
    expect(late).toBeGreaterThan(early);
  });
});

describe("computeBenchRegret", () => {
  const pl = (playerId: string, position: string, points: number, isStarter: boolean) =>
    ({ playerId, name: playerId, position, points, isStarter });

  it("reports the gap to the best possible lineup and the swaps that close it", () => {
    const regret = computeBenchRegret(
      ["QB", "RB", "FLEX"],
      [pl("qb", "QB", 10, true), pl("rb", "RB", 5, true), pl("wr", "WR", 2, true)],
      [pl("rb2", "RB", 12, false), pl("wr2", "WR", 7, false)]
    );
    // Best: RB rb2 12, QB 10, FLEX wr2 7 = 29; actual 17.
    expect(regret.optimalPoints).toBe(29);
    expect(regret.points).toBe(12);
    expect(regret.swaps).toHaveLength(2);
    expect(regret.swaps.reduce((t, s) => t + s.gain, 0)).toBeCloseTo(12, 10);
    expect(regret.swaps.map((s) => s.benchPlayerId).sort()).toEqual(["rb2", "wr2"]);
  });

  it("is zero when the starters are already the best lineup", () => {
    const regret = computeBenchRegret(
      ["QB", "RB"],
      [pl("qb", "QB", 20, true), pl("rb", "RB", 15, true)],
      [pl("rb2", "RB", 3, false)]
    );
    expect(regret.points).toBe(0);
    expect(regret.swaps).toEqual([]);
  });

  it("respects position eligibility — a bench QB can't fill an RB slot", () => {
    const regret = computeBenchRegret(
      ["QB", "RB"],
      [pl("qb", "QB", 40, true), pl("rb", "RB", 4, true)],
      [pl("qb2", "QB", 30, false)]
    );
    // The 30-pt bench QB can't take the RB slot, and the 40-pt starter keeps QB.
    expect(regret.optimalPoints).toBe(44);
    expect(regret.points).toBe(0);
    expect(regret.swaps).toEqual([]);
  });

  it("fills restrictive slots before SUPER_FLEX so a QB isn't wasted in the flex", () => {
    const regret = computeBenchRegret(
      ["SUPER_FLEX", "QB"],
      [pl("qbA", "QB", 20, true), pl("rb", "RB", 15, true)],
      [pl("qbB", "QB", 18, false)]
    );
    // QB slot: qbA 20. SUPER_FLEX: best of qbB 18 / rb 15 = 18. Total 38 vs actual 35.
    expect(regret.optimalPoints).toBe(38);
    expect(regret.points).toBe(3);
  });
});

describe("getGamedayPollPlan", () => {
  const NOW = 1_000_000_000_000;
  const up = (minutesAway: number, over: Partial<TeamGameState> = {}): TeamGameState =>
    ({ kickoffAt: NOW + minutesAway * MIN, state: "Upcoming", ...over });

  it("retries slowly when no scoreboard has loaded", () => {
    expect(getGamedayPollPlan({}, NOW)).toEqual({
      scoreboardMs: POLL_IDLE_SCOREBOARD_MS, matchupsMs: null, dashboardMs: null, refreshProjections: false, anyLive: false,
    });
  });

  it("polls everything at live cadence while a game is in progress", () => {
    const plan = getGamedayPollPlan({ SF: live({ kickoffAt: NOW - 60 * MIN }), DAL: up(180) }, NOW);
    expect(plan.scoreboardMs).toBe(POLL_LIVE_SCOREBOARD_MS);
    expect(plan.matchupsMs).toBe(POLL_LIVE_MATCHUPS_MS);
    expect(plan.dashboardMs).toBe(POLL_LIVE_DASHBOARD_MS);
    expect(plan.anyLive).toBe(true);
  });

  it("polls the dashboard slower than the single league", () => {
    expect(POLL_LIVE_DASHBOARD_MS).toBeGreaterThan(POLL_LIVE_MATCHUPS_MS);
  });

  it("speeds up the scoreboard (only) in the 15 minutes before a kickoff", () => {
    const plan = getGamedayPollPlan({ SF: up(10) }, NOW);
    expect(plan.scoreboardMs).toBe(POLL_LIVE_SCOREBOARD_MS);
    expect(plan.matchupsMs).toBeNull();
    expect(plan.dashboardMs).toBeNull();
  });

  it("keeps polling fast when ESPN hasn't flipped a past-kickoff game to Live yet", () => {
    expect(getGamedayPollPlan({ SF: up(-2) }, NOW).scoreboardMs).toBe(POLL_LIVE_SCOREBOARD_MS);
  });

  it("idles between game windows", () => {
    const plan = getGamedayPollPlan({ SF: { kickoffAt: NOW - 240 * MIN, state: "Final" }, DAL: up(180) }, NOW);
    expect(plan.scoreboardMs).toBe(POLL_IDLE_SCOREBOARD_MS);
    expect(plan.matchupsMs).toBeNull();
  });

  it("stops entirely once every game is Final", () => {
    const plan = getGamedayPollPlan({ SF: { kickoffAt: NOW - 240 * MIN, state: "Final" } }, NOW);
    expect(plan.scoreboardMs).toBeNull();
    expect(plan.matchupsMs).toBeNull();
  });

  it("asks for a projection re-pull only inside the two hours before a kickoff", () => {
    expect(getGamedayPollPlan({ SF: up(90) }, NOW).refreshProjections).toBe(true);
    expect(getGamedayPollPlan({ SF: up(180) }, NOW).refreshProjections).toBe(false);
    expect(getGamedayPollPlan({ SF: up(-5) }, NOW).refreshProjections).toBe(false);
  });

  it("does not treat a postponed game as an imminent kickoff", () => {
    const plan = getGamedayPollPlan({ SF: up(10, { status: "postponed" }) }, NOW);
    expect(plan.scoreboardMs).toBe(POLL_IDLE_SCOREBOARD_MS);
    expect(plan.refreshProjections).toBe(false);
  });
});

// ── correlation ──────────────────────────────────────────────────────────

describe("playerCorrelation / teamVariance / crossTeamCovariance", () => {
  const p = (position: string, team: string | null, opponent: string | null, stdDev: number): CorrelatedPlayer =>
    ({ position, team, opponent, stdDev });

  it("links a QB strongly to his own pass catchers, in either order", () => {
    expect(playerCorrelation(p("QB", "ARI", "DAL", 8), p("WR", "ARI", "DAL", 6))).toBe(0.45);
    expect(playerCorrelation(p("WR", "ARI", "DAL", 6), p("QB", "ARI", "DAL", 8))).toBe(0.45);
    expect(playerCorrelation(p("QB", "ARI", "DAL", 8), p("TE", "ARI", "DAL", 5))).toBe(0.35);
  });

  it("leaves RBs ~uncorrelated with the passing game and with each other", () => {
    expect(playerCorrelation(p("RB", "ARI", "DAL", 6), p("WR", "ARI", "DAL", 6))).toBe(0);
    expect(playerCorrelation(p("RB", "ARI", "DAL", 6), p("RB", "ARI", "DAL", 6))).toBe(0);
  });

  it("gives a mild link between passing-game players on opposite sides of one game", () => {
    expect(playerCorrelation(p("QB", "ARI", "DAL", 8), p("WR", "DAL", "ARI", 6))).toBe(0.1);
    expect(playerCorrelation(p("RB", "ARI", "DAL", 8), p("WR", "DAL", "ARI", 6))).toBe(0);
  });

  it("treats players in different games (or with unknown teams) as independent", () => {
    expect(playerCorrelation(p("QB", "ARI", "DAL", 8), p("WR", "SF", "SEA", 6))).toBe(0);
    expect(playerCorrelation(p("QB", null, null, 8), p("WR", null, null, 6))).toBe(0);
  });

  it("teamVariance adds plain variances for independent players", () => {
    expect(teamVariance([p("QB", "ARI", "DAL", 4), p("WR", "SF", "SEA", 3)])).toBeCloseTo(25, 10);
  });

  it("teamVariance widens for a stacked QB + WR: 64 + 36 + 2 × 0.45 × 8 × 6", () => {
    expect(teamVariance([p("QB", "ARI", "DAL", 8), p("WR", "ARI", "DAL", 6)])).toBeCloseTo(143.2, 10);
  });

  it("crossTeamCovariance is nonzero only where opposite sides share a team or game", () => {
    const mine = [p("QB", "ARI", "DAL", 8)];
    expect(crossTeamCovariance(mine, [p("WR", "ARI", "DAL", 6)])).toBeCloseTo(0.45 * 48, 10); // same NFL team
    expect(crossTeamCovariance(mine, [p("WR", "DAL", "ARI", 6)])).toBeCloseTo(0.1 * 48, 10);  // same game
    expect(crossTeamCovariance(mine, [p("WR", "SF", "SEA", 6)])).toBe(0);
  });

  it("winProbability: positive covariance between the sides narrows the spread of the difference", () => {
    const independent = winProbability(110, 10, 100, 10);
    const linked = winProbability(110, 10, 100, 10, 50); // ρ = 0.5 → spread 10, z = 1
    expect(independent).toBeCloseTo(0.760, 2);
    expect(linked).toBeCloseTo(0.841, 2);
    expect(winProbability(110, 10, 100, 10, 100)).toBe(1); // perfectly linked: the leader can't lose
  });
});

// ── per-stat pace ────────────────────────────────────────────────────────

describe("projectRemainingFromStats", () => {
  const scoring = { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6 };
  const wrProjection = { rec: 6, rec_yd: 80, rec_td: 0.6 }; // 6 + 8 + 3.6 = 17.6
  const base = { position: "WR", lead: null, availability: 1, scoring, projectedStats: wrProjection, projectedFpts: 17.6 };

  it("equals the full projection at kickoff — including projection mass the stat line doesn't explain", () => {
    expect(projectRemainingFromStats({ ...base, observedStats: {}, fractionRemaining: 1 }).remaining).toBeCloseTo(17.6, 10);
    const withExtra = projectRemainingFromStats({ ...base, projectedFpts: 19.6, observedStats: {}, fractionRemaining: 1 });
    expect(withExtra.remaining).toBeCloseTo(19.6, 10);
  });

  it("is half the projection at halftime when exactly on pace", () => {
    const out = projectRemainingFromStats({ ...base, observedStats: { rec: 3, rec_yd: 40 }, fractionRemaining: 0.5 });
    expect(out.remaining).toBeCloseTo(8.8, 10);
    expect(out.observedFpts).toBeCloseTo(7, 10); // 3 + 4
  });

  it("paces yardage but regresses touchdowns instead of extrapolating them", () => {
    // Halftime, 160 yds (4× pace → clamped to 2×) and 2 TDs vs a 0.6-TD projection.
    const out = projectRemainingFromStats({ ...base, observedStats: { rec: 3, rec_yd: 160, rec_td: 2 }, fractionRemaining: 0.5 });
    // rec: on pace → 3.  rec_yd: 80×0.5 × (1 + 0.25×(2−1)) = 50 → 5.0.
    // rec_td: 0.6×0.5 × (1 + 0.5×(1.25−1)) = 0.3375 → 2.025 — NOT 2 more TDs.
    expect(out.remaining).toBeCloseTo(3 + 5 + 2.025, 10);
  });

  it("ignores pace for a stat until enough is expected — no verdict from three snaps", () => {
    // 5% into the game: nothing observed yet must not read as a cold start.
    const cold = projectRemainingFromStats({ ...base, observedStats: {}, fractionRemaining: 0.95 });
    expect(cold.remaining).toBeCloseTo(17.6 * 0.95, 10);
  });

  it("reads a cold start as slower volume, bounded by the pace floor", () => {
    const out = projectRemainingFromStats({ ...base, observedStats: { rec: 0, rec_yd: 0 }, fractionRemaining: 0.5 });
    // rec & rec_yd at the 0.4 ratio floor: factor 1 + 0.25×(0.4−1) = 0.85; rec_td linked: 1 + 0.5×(0.85−1) = 0.925
    expect(out.remaining).toBeCloseTo(3 * 0.85 + 4 * 0.85 + 1.8 * 0.925, 10);
  });

  it("applies game script to every remaining stat (RB, up 14 at halftime, on pace)", () => {
    const out = projectRemainingFromStats({
      ...base, position: "RB", lead: 14,
      projectedStats: { rush_yd: 80 }, projectedFpts: 8, observedStats: { rush_yd: 40 }, fractionRemaining: 0.5,
    });
    expect(out.remaining).toBeCloseTo(4 * 1.12, 10);
  });

  it("is zero for a player who can't play or a finished game, but still reports observed points", () => {
    const out = projectRemainingFromStats({ ...base, observedStats: { rec: 3, rec_yd: 40 }, fractionRemaining: 0.5, availability: 0 });
    expect(out.remaining).toBe(0);
    expect(out.observedFpts).toBeCloseTo(7, 10);
    expect(projectRemainingFromStats({ ...base, observedStats: {}, fractionRemaining: 0 }).remaining).toBe(0);
  });

  it("never returns a negative remaining", () => {
    const out = projectRemainingFromStats({ ...base, projectedFpts: 2, observedStats: {}, fractionRemaining: 1 });
    // stat line explains 17.6 but the blended projection is only 2 → unexplained is negative; total clamps at 0.
    expect(out.remaining).toBeGreaterThanOrEqual(0);
  });

  it("does not pace interceptions", () => {
    const out = projectRemainingFromStats({
      ...base, position: "QB", projectedStats: { pass_yd: 250, pass_int: 1 }, projectedFpts: 10 - 2,
      observedStats: { pass_yd: 125, pass_int: 3 }, fractionRemaining: 0.5,
    });
    expect(out.remaining).toBeCloseTo(125 * 0.04 - 0.5 * 2, 10);
  });
});

describe("liveStatsMatchOfficialPoints", () => {
  it("accepts small gaps from scoring the stat line doesn't cover (fumbles, 2-pt, bonuses)", () => {
    expect(liveStatsMatchOfficialPoints(10, 10)).toBe(true);
    expect(liveStatsMatchOfficialPoints(10, 13)).toBe(true);
    expect(liveStatsMatchOfficialPoints(40, 50)).toBe(true);
  });

  it("rejects a stat feed that's lagging or ahead of the official points", () => {
    expect(liveStatsMatchOfficialPoints(0, 15)).toBe(false);
    expect(liveStatsMatchOfficialPoints(30, 5)).toBe(false);
    expect(liveStatsMatchOfficialPoints(40, 60)).toBe(false);
  });
});
