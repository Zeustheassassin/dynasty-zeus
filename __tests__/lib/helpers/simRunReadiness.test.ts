import { describe, it, expect } from "vitest";
import { getSimRunWait, type SimRunReadinessInput } from "@/lib/helpers/simRunReadiness";
import { projectionScoringKey } from "@/lib/helpers/scoring";
import type { SleeperLeague, SleeperNFLState } from "@/lib/types";

// Run All Sims saves selectedLeagueSimulation for each league it selects. It used to save as soon
// as the rosters landed, so odds were built from the previous league's projection scoring (or none),
// a generated schedule, and the wrong QB format's values. Every input must belong to the league.

const halfPpr = { rec: 0.5, pass_td: 4 };
const fullPpr = { rec: 1, pass_td: 6 };

const league = (id: string, scoring: Record<string, number>, positions: string[] = ["QB", "RB", "WR", "SUPER_FLEX"]) =>
  ({ league_id: id, scoring_settings: scoring, roster_positions: positions }) as unknown as SleeperLeague;

const week6 = { season_type: "regular", week: 6 } as SleeperNFLState;

function readyInput(overrides: Partial<SimRunReadinessInput> = {}): SimRunReadinessInput {
  return {
    leagueId: "L1",
    selectedLeague: league("L1", halfPpr),
    readyLeagueId: "L1",
    playersLoaded: true,
    nflState: week6,
    projectionWeek: 6,
    loadingProjections: false,
    projectionLoadedFor: { week: 6, scoringKey: projectionScoringKey(halfPpr) },
    loadingRedraft: false,
    redraftSettledNumQbs: 2,
    leagueWeeklyMatchups: { L1: [] },
    ...overrides,
  };
}

describe("getSimRunWait", () => {
  it("is ready once every input belongs to the front league", () => {
    expect(getSimRunWait(readyInput())).toBeNull();
  });

  it("waits for loadRoster: the selected league or the ready flag still points elsewhere", () => {
    expect(getSimRunWait(readyInput({ readyLeagueId: "L0" }))).toBe("league");
    expect(getSimRunWait(readyInput({ selectedLeague: league("L0", halfPpr) }))).toBe("league");
    expect(getSimRunWait(readyInput({ selectedLeague: null }))).toBe("league");
  });

  it("waits for the player map and the NFL week", () => {
    expect(getSimRunWait(readyInput({ playersLoaded: false }))).toBe("players");
    expect(getSimRunWait(readyInput({ nflState: null }))).toBe("nflState");
  });

  it("waits while projections still carry the previous league's scoring", () => {
    expect(getSimRunWait(readyInput({
      projectionLoadedFor: { week: 6, scoringKey: projectionScoringKey(fullPpr) },
    }))).toBe("projections");
  });

  it("waits while projections are cleared, loading, or for another week", () => {
    expect(getSimRunWait(readyInput({ projectionLoadedFor: null }))).toBe("projections");
    expect(getSimRunWait(readyInput({ loadingProjections: true }))).toBe("projections");
    expect(getSimRunWait(readyInput({ projectionLoadedFor: { week: 5, scoringKey: projectionScoringKey(halfPpr) } }))).toBe("projections");
    expect(getSimRunWait(readyInput({ projectionWeek: 5 }))).toBe("projections");
  });

  it("reads full-season projections (week 0) outside the regular season", () => {
    const offseason = { season_type: "off", week: 0 } as SleeperNFLState;
    expect(getSimRunWait(readyInput({
      nflState: offseason,
      projectionWeek: 0,
      projectionLoadedFor: { week: 0, scoringKey: projectionScoringKey(halfPpr) },
    }))).toBeNull();
    expect(getSimRunWait(readyInput({ nflState: offseason }))).toBe("projections");
  });

  it("treats a league with no scoring settings as DEFAULT_SCORING, like useProjections", () => {
    const bare = { league_id: "L1", roster_positions: ["QB", "SUPER_FLEX"] } as unknown as SleeperLeague;
    expect(getSimRunWait(readyInput({
      selectedLeague: bare,
      projectionLoadedFor: { week: 6, scoringKey: projectionScoringKey(null) },
    }))).toBeNull();
  });

  it("waits for redraft values in the league's QB format", () => {
    const oneQb = league("L1", halfPpr, ["QB", "RB", "WR", "FLEX"]);
    expect(getSimRunWait(readyInput({ selectedLeague: oneQb }))).toBe("redraftValues");
    expect(getSimRunWait(readyInput({ selectedLeague: oneQb, redraftSettledNumQbs: 1 }))).toBeNull();
    expect(getSimRunWait(readyInput({ loadingRedraft: true }))).toBe("redraftValues");
    expect(getSimRunWait(readyInput({ redraftSettledNumQbs: null }))).toBe("redraftValues");
  });

  it("waits for this league's weekly matchups (another league's don't count)", () => {
    expect(getSimRunWait(readyInput({ leagueWeeklyMatchups: {} }))).toBe("matchups");
    expect(getSimRunWait(readyInput({ leagueWeeklyMatchups: { L0: [] } }))).toBe("matchups");
  });
});
