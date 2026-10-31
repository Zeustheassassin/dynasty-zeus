// ============================================================
// Run All Sims — is the league at the front of the queue ready to save?
//
// Run All Sims selects each league in turn and saves the same selectedLeagueSimulation the
// Season Simulator tab shows. That sim reads several inputs that load on their own after a
// league switch, so saving the moment the rosters land used to store odds built from another
// league's scoring (or from no projections at all), a generated schedule instead of the real
// one, and the wrong QB format's redraft values. A league is saved only once every input below
// belongs to it.
// ============================================================

import type { SleeperLeague, SleeperNFLState } from "../types";
import { getLeagueNumQbs, projectionScoringKey } from "./scoring";
import { getCurrentNflWeek } from "./season";
import { getRegularSeasonWeeks } from "./weeklyProjections";

/** What the front league is still waiting on, in the order they're checked. */
export type SimRunWait =
  | "league"          // loadRoster hasn't finished for this league (rosters, owners, standings)
  | "players"         // the Sleeper player map is empty
  | "nflState"        // current week unknown — the sim would run in offseason mode
  | "projections"     // this week's projections under THIS league's scoring
  | "redraftValues"   // redraft values in this league's QB format (1QB vs superflex)
  | "matchups"        // this league's weekly matchups (real schedule + played-week scores), with
                      //   this week's live scores fetched since the run started
  | "scoreboard"      // this week's NFL scoreboard (which games have kicked off)
  | "weeklyProjections"; // Sleeper's remaining-week projections (byes, injury return dates)

/** Short progress-line text for each wait. */
export const SIM_RUN_WAIT_LABELS: Record<SimRunWait, string> = {
  league: "loading rosters",
  players: "loading players",
  nflState: "loading NFL week",
  projections: "loading projections for its scoring",
  redraftValues: "loading player values",
  matchups: "loading schedule and this week's scores",
  scoreboard: "loading this week's NFL games",
  weeklyProjections: "loading byes and injury return dates",
};

export interface SimRunReadinessInput {
  /** The league at the front of the Run All Sims queue. */
  leagueId: string;
  selectedLeague: SleeperLeague | null;
  readyLeagueId: string | null;
  playersLoaded: boolean;
  nflState: SleeperNFLState | null;
  /** Week simulateLeague reads projectionData for (0 = full season). */
  projectionWeek: number;
  loadingProjections: boolean;
  /** Week + scoring the current projectionData was built for (useProjections). */
  projectionLoadedFor: { week: number; scoringKey: string } | null;
  loadingRedraft: boolean;
  /** Format of the latest redraft load to finish, success or failure (useCalcValues). */
  redraftSettledNumQbs: number | null;
  leagueWeeklyMatchups: Record<string, unknown>;
  /** The remaining-week projections load has settled, success or failure (useWeeklyProjections).
   *  League-independent, so a settled load serves every league in the queue. */
  weeklyProjectionsSettled: boolean;
  /** When this league's current-week matchups (live scores) were last fetched; null = never. */
  liveWeekMatchupsFetchedAt: number | null;
  /** When the run started (useSimulatorState); null outside a run. */
  simRunStartedAt: number | null;
  /** Week the loaded NFL scoreboard belongs to (useNflSchedule; 0 until one settles). */
  scheduleWeek: number;
}

export function getSimRunWait(input: SimRunReadinessInput): SimRunWait | null {
  const { leagueId, selectedLeague } = input;
  if (!selectedLeague || selectedLeague.league_id !== leagueId || input.readyLeagueId !== leagueId) {
    return "league";
  }
  if (!input.playersLoaded) return "players";
  if (!input.nflState) return "nflState";

  // Same week rule the Simulator/Overview load effect uses: this regular-season week, else the
  // full-season numbers (0).
  const week = getCurrentNflWeek(input.nflState);
  const loadedFor = input.projectionLoadedFor;
  if (
    input.loadingProjections ||
    input.projectionWeek !== week ||
    !loadedFor ||
    loadedFor.week !== week ||
    loadedFor.scoringKey !== projectionScoringKey(selectedLeague.scoring_settings)
  ) {
    return "projections";
  }

  if (input.loadingRedraft || input.redraftSettledNumQbs !== getLeagueNumQbs(selectedLeague)) {
    return "redraftValues";
  }

  if (!input.leagueWeeklyMatchups[leagueId]) return "matchups";

  // A regular-season week still being played: its games already kicked off count their real
  // points, so the league's scores this week must be fetched since the run started, and the
  // scoreboard loaded (success or failure) must be this week's.
  if (week > 0 && week <= getRegularSeasonWeeks(selectedLeague)) {
    const fetchedAt = input.liveWeekMatchupsFetchedAt;
    if (fetchedAt == null || fetchedAt < (input.simRunStartedAt ?? 0)) return "matchups";
    if (input.scheduleWeek !== week) return "scoreboard";
  }

  if (!input.weeklyProjectionsSettled) return "weeklyProjections";
  return null;
}
