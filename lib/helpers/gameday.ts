// ============================================================
// Gameday / kickoff timing helpers.
// Used by GamedayHub to determine game state and display times.
// ============================================================
import { sum } from "./math";
import { recomputeConsensusFpts, DEFAULT_SCORING } from "./scoring";
import {
  gameFractionRemaining, formatGameDetail, playerAvailability, projectRemainingPoints,
  playerRemainingStdDev, winProbability, computeBenchRegret, projectRemainingFromStats,
  liveStatsMatchOfficialPoints, teamVariance, crossTeamCovariance,
  type CorrelatedPlayer, type StatLine,
} from "./gamedayLive";
import type {
  SleeperLeague, SleeperRoster, SleeperMatchup, SleeperPlayer, SleeperUser,
  ProjectionRow, GamedayMatchup, GamedayTeamView, GamedayLineupRow,
  GamedayReserveRow, GamedayDashboardEntry, GamedayDashboardRaw, TeamGameState,
} from "../types";

interface KickoffSource {
  kickoffAt?: unknown;
  kickoff_at?: unknown;
  gameTime?: unknown;
  game_time?: unknown;
  startTime?: unknown;
  start_time?: unknown;
}

/** Extracts a kickoff timestamp (ms) from a raw Sleeper projection object,
 *  trying multiple field name variants returned by different API versions. */
export const getProjectionKickoffAt = (projection: KickoffSource | Record<string, unknown> | null | undefined): number | null => {
  if (!projection) return null;
  const rawCandidates = [
    projection.kickoffAt,
    projection.kickoff_at,
    projection.gameTime,
    projection.game_time,
    projection.startTime,
    projection.start_time,
  ];
  const parsed = rawCandidates
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
  return parsed || null;
};

/** Returns the current game state: "Upcoming", "Live", or "Final".
 *  A game is considered Live for up to 6 hours after kickoff.
 *  Fallback heuristic only — prefer `resolveGameState` below, which uses the
 *  real per-team schedule when available. This stays because a kickoff
 *  timestamp is all we have when a team is missing from that schedule
 *  (bye week, fetch failure). */
export const getKickoffState = (kickoffAt: number | null, now = Date.now()) => {
  if (!kickoffAt) return "Upcoming";
  if (now < kickoffAt) return "Upcoming";
  if (now - kickoffAt < 6 * 60 * 60 * 1000) return "Live";
  return "Final";
};

/** Returns Tailwind class string for a game state badge. */
export const getKickoffStateClasses = (state: string) => {
  if (state === "Live")  return "border-green-500/40 bg-green-500/10 text-green-300";
  if (state === "Final") return "border-gray-600 bg-gray-800 text-gray-300";
  if (state === "No game") return "border-gray-700 bg-gray-900 text-gray-500";
  return "border-blue-500/40 bg-blue-500/10 text-blue-300";
};

/** Formats a kickoff timestamp as a short local time string (e.g. "1:00 PM"). */
export const formatKickoffTime = (kickoffAt: number | null) => {
  if (!kickoffAt) return "--";
  try {
    return new Date(kickoffAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "--";
  }
};

/** A scoreboard covering fewer teams than this is treated as a failed/partial
 *  fetch, not proof that a missing team is on bye. A real week has 12+ teams
 *  playing even in the sparsest bye weeks. (Code-review catch: this was 8,
 *  contradicting its own comment — a truncated ESPN response of 5-6 games
 *  would have been trusted as complete, silently zeroing out every player on
 *  a missing team that actually had a game in progress.) */
const MIN_TEAMS_TO_TRUST_SCHEDULE = 12;

/**
 * Resolves a player's real game state from the NFL scoreboard, keyed by team
 * (kickoff/live/final is a property of the game, not any one player — every
 * player on the same team must agree).
 *
 * A team missing from a *complete* scoreboard has no game this week ("No
 * game": bye week) and can't score. A team missing from an empty/partial one
 * (fetch failed, hasn't loaded yet) falls back to the kickoff-timestamp
 * heuristic above, so a missing schedule degrades gracefully instead of
 * zeroing everyone out.
 */
export const resolveGameState = (
  team: string | null | undefined,
  scheduleByTeam: Record<string, TeamGameState>,
  fallbackKickoffAt: number | null
): { state: string; kickoffAt: number | null } => {
  const scheduled = team ? scheduleByTeam[team] : undefined;
  if (scheduled) return { state: scheduled.state, kickoffAt: scheduled.kickoffAt };
  if (team && Object.keys(scheduleByTeam).length >= MIN_TEAMS_TO_TRUST_SCHEDULE) {
    return { state: "No game", kickoffAt: null };
  }
  return { state: getKickoffState(fallbackKickoffAt), kickoffAt: fallbackKickoffAt };
};

/** Probability team A beats team B: 0/1/0.5 once every starter on both sides
 *  is done, otherwise from each side's projected final and remaining spread.
 *  Returns null when games remain but neither side has any uncertainty left —
 *  that's the "projections haven't loaded" state (or every remaining starter is
 *  out), where a 100%/0% would be a made-up certainty rather than a prediction. */
export function getMatchupWinProbability(a: GamedayTeamView, b: GamedayTeamView): number | null {
  const done = a.upcomingStarters === 0 && a.liveStarters === 0
    && b.upcomingStarters === 0 && b.liveStarters === 0;
  if (done) return a.actualPoints > b.actualPoints ? 1 : a.actualPoints < b.actualPoints ? 0 : 0.5;
  if (a.remainingStdDev === 0 && b.remainingStdDev === 0) return null;
  // Starters on opposite sides who share an NFL team/game move together, which
  // tightens the spread of the score *difference*.
  const covariance = crossTeamCovariance(toCorrelated(a), toCorrelated(b));
  return winProbability(a.projectedFinal, a.remainingStdDev, b.projectedFinal, b.remainingStdDev, covariance);
}

const toCorrelated = (team: GamedayTeamView): CorrelatedPlayer[] =>
  team.starterRows
    .filter((row) => row.player && row.remainingStdDev > 0)
    .map((row) => ({
      position: row.player?.position ?? "",
      team: row.player?.team ?? null,
      opponent: row.nflOpponent,
      stdDev: row.remainingStdDev,
    }));

/** Win/loss read on a Gameday Dashboard matchup: projected (from
 *  projectedFinal) while any starter on either side hasn't finished yet,
 *  actual (from actualPoints) once every starter on both sides is Final.
 *  `winProbability` moves with the game; `pointsNeeded` is what my remaining
 *  players must add to match the opponent's projected final. */
export function getGamedayResultStatus(
  myTeam: GamedayTeamView | null | undefined,
  oppTeam: GamedayTeamView | null | undefined
): { status: "win" | "loss" | "tie"; final: boolean; winProbability: number | null; pointsNeeded: number } | null {
  if (!myTeam || !oppTeam) return null;
  const final = myTeam.upcomingStarters === 0 && myTeam.liveStarters === 0
    && oppTeam.upcomingStarters === 0 && oppTeam.liveStarters === 0;
  const myScore = final ? myTeam.actualPoints : myTeam.projectedFinal;
  const oppScore = final ? oppTeam.actualPoints : oppTeam.projectedFinal;
  const status = myScore > oppScore ? "win" : myScore < oppScore ? "loss" : "tie";
  return {
    status,
    final,
    winProbability: getMatchupWinProbability(myTeam, oppTeam),
    pointsNeeded: final ? 0 : Math.max(Math.round((oppTeam.projectedFinal - myTeam.actualPoints) * 10) / 10, 0),
  };
}

/**
 * Builds this week's full matchup grid for one league: groups raw Sleeper
 * matchup rows by matchup_id, and for each roster computes actual/remaining/
 * projected-final points per starter slot plus sorted bench/taxi. Shared by
 * the single-league Gameday view and the cross-league Gameday Dashboard so
 * the two never drift apart.
 */
export function buildGamedayMatchups(
  league: SleeperLeague | null | undefined,
  rosters: SleeperRoster[],
  matchups: SleeperMatchup[],
  week: number,
  players: Record<string, SleeperPlayer>,
  projectionData: ProjectionRow[],
  usersByOwnerOrRoster: Record<string | number, string>,
  scheduleByTeam: Record<string, TeamGameState>,
  /** Live cumulative stat lines by Sleeper player id (see /api/stats/sleeper-live).
   *  Optional: without it — or when it disagrees with Sleeper's official points —
   *  pace is read from points instead. */
  liveStatsByPlayerId: Record<string, StatLine> = {}
): GamedayMatchup[] {
  if (!league || !rosters.length || !week) return [];

  const starterSlots = (league.roster_positions || []).filter(
    (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
  );
  const rosterMap = new Map(rosters.map((entry) => [Number(entry.roster_id), entry]));
  const projectionByPlayerId = new Map(
    projectionData.map((row) => [String(row.sleeperId), row])
  );
  const matchupMap = new Map<number, SleeperMatchup[]>();

  // projectionData's fpts is baked with whatever league's scoring was
  // selected when it was fetched (see useProjections) — not necessarily
  // THIS league's. Re-derive each player's points under this league's own
  // scoring_settings so a cross-league view (the Gameday Dashboard) can't
  // leak one league's scoring into another's projected numbers. No-ops back
  // to `fpts` for rows without stats/sourceWeights (tests, older snapshots).
  const leagueScoring = league.scoring_settings ?? DEFAULT_SCORING;
  const scoreProjection = (projection: ProjectionRow | null | undefined): number =>
    projection ? recomputeConsensusFpts(projection, leagueScoring) : 0;

  matchups.forEach((entry) => {
    const matchupId = Number(entry?.matchup_id || 0);
    if (!matchupId) return;
    if (!matchupMap.has(matchupId)) matchupMap.set(matchupId, []);
    matchupMap.get(matchupId)?.push(entry);
  });

  /** One player's live line: game state, what's left, and how uncertain it is.
   *  Shared by starters and reserves so the two can never disagree. */
  const buildPlayerLine = (player: SleeperPlayer | null | undefined, playerId: string, actualPoints: number) => {
    const projection = playerId ? projectionByPlayerId.get(playerId) : null;
    const fallbackKickoffAt = getProjectionKickoffAt(projection);
    const { state: gameState, kickoffAt } = resolveGameState(player?.team, scheduleByTeam, fallbackKickoffAt);
    const scheduled = player?.team ? scheduleByTeam[player.team] : undefined;
    const projected = scoreProjection(projection);
    const availability = playerAvailability(player);

    // Fraction of the game left. null = Live with no clock data (older payload,
    // or the game state came from the kickoff heuristic because the team isn't
    // on the scoreboard) — falls back to "projection minus points so far".
    let fraction: number | null;
    if (gameState === "Upcoming") fraction = 1;
    else if (gameState === "Live") fraction = gameFractionRemaining(scheduled);
    else fraction = 0; // Final, No game

    const lead = scheduled?.score != null && scheduled?.oppScore != null
      ? scheduled.score - scheduled.oppScore
      : null;
    const position = player?.position ?? "";

    let remainingProjection: number;
    let paceSource: "projection" | "points" | "stats" = "projection";
    if (gameState === "Live" && fraction === null) {
      // Live but no clock: nothing to scale by.
      remainingProjection = Math.max(projected * availability - actualPoints, 0);
      paceSource = "points";
    } else {
      // Per-stat pace needs the projection's stat line AND a live stat line that
      // agrees with Sleeper's official points (the feed can lag the matchup feed).
      const liveStats = gameState === "Live" ? liveStatsByPlayerId[playerId] : undefined;
      const fromStats = liveStats && projection?.stats && fraction !== null
        ? projectRemainingFromStats({
            projectedStats: projection.stats,
            observedStats: liveStats,
            projectedFpts: projected,
            fractionRemaining: fraction,
            position,
            lead,
            availability,
            scoring: leagueScoring,
          })
        : null;
      if (fromStats && liveStatsMatchOfficialPoints(fromStats.observedFpts, actualPoints)) {
        remainingProjection = fromStats.remaining;
        paceSource = "stats";
      } else {
        remainingProjection = projectRemainingPoints({
          projected,
          actual: actualPoints,
          fractionRemaining: fraction ?? 0,
          position,
          lead,
          availability,
        });
        if (gameState === "Live") paceSource = "points";
      }
    }

    return {
      gameState,
      kickoffAt,
      kickoffLabel: formatKickoffTime(kickoffAt),
      gameDetail: formatGameDetail(scheduled, player?.team),
      nflOpponent: scheduled?.opponent ?? null,
      paceSource,
      actualPoints,
      remainingProjection,
      projectedFinal: actualPoints + remainingProjection,
      remainingStdDev: playerRemainingStdDev(projection, projected, fraction ?? 0.5, availability),
    };
  };

  const buildTeamView = (entry: SleeperMatchup): GamedayTeamView => {
    const rosterId = Number(entry?.roster_id || 0);
    const rosterEntry = rosterMap.get(rosterId);
    const starterIds = Array.isArray(entry?.starters) && entry.starters.length > 0
      ? entry.starters.map((id) => String(id || ""))
      : (rosterEntry?.starters || []).map((id) => String(id || ""));
    const playerPoints = entry?.players_points || {};
    const starterRows: GamedayLineupRow[] = starterSlots.map((slot: string, index: number) => {
      const playerId = starterIds[index] ? String(starterIds[index]) : "";
      const player = playerId ? players[playerId] : null;
      const actualPoints = Number(playerId ? playerPoints[playerId] ?? entry?.starters_points?.[index] ?? 0 : 0);
      return { slot, playerId, player, ...buildPlayerLine(player, playerId, actualPoints) };
    });

    const starterIdSet = new Set(starterRows.map((row) => row.playerId).filter(Boolean));
    const taxiIdSet = new Set((rosterEntry?.taxi || []).map((id) => String(id)));
    const reserveIdSet = new Set((rosterEntry?.reserve || []).map((id) => String(id)));
    const buildReserveRow = (playerId: string): GamedayReserveRow => {
      const player = players[playerId];
      return { playerId, player, ...buildPlayerLine(player, playerId, Number(playerPoints[playerId] ?? 0)) };
    };

    const benchRows = (rosterEntry?.players || [])
      .map((id) => String(id))
      .filter((playerId: string) => !starterIdSet.has(playerId) && !taxiIdSet.has(playerId))
      .map(buildReserveRow)
      .filter((row) => row.player)
      .sort((a, b) => (b.remainingProjection + b.actualPoints) - (a.remainingProjection + a.actualPoints));

    const taxiRows = (rosterEntry?.taxi || [])
      .map((id) => String(id))
      .map(buildReserveRow)
      .filter((row) => row.player)
      .sort((a, b) => (b.remainingProjection + b.actualPoints) - (a.remainingProjection + a.actualPoints));

    // Hindsight lineup check on points so far. IR can't be started, taxi neither.
    const toRegretPlayer = (row: GamedayLineupRow | GamedayReserveRow, isStarter: boolean) => ({
      playerId: row.playerId,
      name: row.player?.full_name ?? row.playerId,
      position: row.player?.position ?? "",
      points: row.actualPoints,
      isStarter,
    });
    const benchRegret = computeBenchRegret(
      starterSlots,
      starterRows.filter((row) => row.player).map((row) => toRegretPlayer(row, true)),
      benchRows.filter((row) => !reserveIdSet.has(row.playerId)).map((row) => toRegretPlayer(row, false))
    );

    const ownerId = rosterEntry?.owner_id ?? "";
    const remainingTotal = sum(starterRows.map((row) => row.remainingProjection));
    return {
      rosterId,
      ownerId,
      ownerName: usersByOwnerOrRoster[ownerId] || usersByOwnerOrRoster[rosterId] || `Team ${rosterId}`,
      actualPoints: Number(entry?.points || 0),
      remainingProjection: Math.round(remainingTotal * 10) / 10,
      projectedFinal: Math.round((Number(entry?.points || 0) + remainingTotal) * 10) / 10,
      // Variances add, plus QB↔pass-catcher (same NFL team) covariance.
      remainingStdDev: Math.sqrt(teamVariance(
        starterRows
          .filter((row) => row.player && row.remainingStdDev > 0)
          .map((row) => ({ position: row.player?.position ?? "", team: row.player?.team ?? null, opponent: row.nflOpponent, stdDev: row.remainingStdDev }))
      )),
      finishedStarters: starterRows.filter((row) => row.gameState === "Final" && row.playerId).length,
      liveStarters: starterRows.filter((row) => row.gameState === "Live" && row.playerId).length,
      upcomingStarters: starterRows.filter((row) => row.gameState === "Upcoming" && row.playerId).length,
      noGameStarters: starterRows.filter((row) => row.gameState === "No game" && row.playerId).length,
      totalStarters: starterRows.filter((row) => row.playerId).length,
      starterRows,
      benchRows,
      taxiRows,
      benchRegret,
    };
  };

  return [...matchupMap.entries()]
    .map(([matchupId, entries]) => {
      const teams = entries
        .map((entry) => buildTeamView(entry))
        .sort((a, b) => b.actualPoints - a.actualPoints);
      const sortKickoff = teams
        .flatMap((team) => team.starterRows.map((row) => row.kickoffAt).filter((k): k is number => k !== null))
        .sort((a, b) => a - b)[0] || Number.MAX_SAFE_INTEGER;

      return {
        matchupId,
        teams,
        sortKickoff,
      };
    })
    .sort((a, b) => {
      if (a.sortKickoff !== b.sortKickoff) return a.sortKickoff - b.sortKickoff;
      return a.matchupId - b.matchupId;
    });
}

/**
 * Scores every league's raw dashboard data into the entries the Gameday
 * Dashboard renders: the user's own matchup per league, split into my/opp
 * teams. Pure and cheap, so the hook re-derives it whenever the live
 * scoreboard or projections change instead of baking a snapshot at fetch time.
 */
export function buildGamedayDashboardEntries(
  raw: GamedayDashboardRaw[],
  user: Pick<SleeperUser, "user_id"> | null | undefined,
  week: number,
  players: Record<string, SleeperPlayer>,
  projectionData: ProjectionRow[],
  scheduleByTeam: Record<string, TeamGameState>,
  liveStatsByPlayerId: Record<string, StatLine> = {}
): GamedayDashboardEntry[] {
  return raw.map((item): GamedayDashboardEntry => {
    const { league, rosters, users, matchups } = item;
    if (item.error) return { league, myTeam: null, oppTeam: null, error: true };

    const myRoster = rosters.find((r) => r.owner_id === user?.user_id);
    if (!myRoster) return { league, myTeam: null, oppTeam: null, error: false };

    const myEntry = matchups.find((m) => Number(m.roster_id) === Number(myRoster.roster_id));
    if (!myEntry) return { league, myTeam: null, oppTeam: null, error: false };

    const scopedMatchups = matchups.filter((m) => Number(m.matchup_id) === Number(myEntry.matchup_id));

    const userMap: Record<string, string> = {};
    rosters.forEach((r) => {
      const u = users.find((lu) => lu.user_id === r.owner_id);
      if (u) {
        userMap[r.roster_id] = u.display_name;
        userMap[r.owner_id] = u.display_name;
      }
    });

    const [matchup] = buildGamedayMatchups(league, rosters, scopedMatchups, week, players, projectionData, userMap, scheduleByTeam, liveStatsByPlayerId);
    const myTeam = matchup?.teams.find((t) => t.rosterId === myRoster.roster_id) ?? null;
    const oppTeam = matchup?.teams.find((t) => t.rosterId !== myRoster.roster_id) ?? null;
    return { league, myTeam, oppTeam, error: false };
  });
}
