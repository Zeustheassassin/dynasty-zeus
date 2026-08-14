// ============================================================
// simulateLeague — pure season-simulation engine
// ============================================================
// Extracted verbatim from the useSimulatorState memo so it can be
// called both by the connected-user simulator (one selected league)
// and by the read-only User Scout view (looping every target league
// with NO persistence). Behavior is identical to the original memo;
// the only change is that every closure input is now an explicit
// argument. Keep this in sync with useSimulatorState's dep list.
// ============================================================
import {
  createSeededRandom, randomNormal, buildRoundRobinSchedule,
  average, logisticWinProb, percentileFromCounts,
} from "./math";
import type { PlayerUsage } from "../../hooks/usePlayerStats";
import type {
  SleeperLeague, SleeperRoster, SleeperPlayer, SleeperMatchup, SleeperNFLState,
  SimulationTeamRow, LeagueSimulation, ProjectionRow, StandingRow,
} from "../types";

export type PoolPlayer = { id: string; position: string; nflTeam: string | null; score: number };

/**
 * Clones `rosters` with a hypothetical trade applied — moves `giveIds` off myRosterId onto
 * opponentRosterId and `receiveIds` the other way. Used to preview a trade's effect on
 * simulateLeague's output before it's actually made; does not touch picks (simulateLeague's
 * in-season math never reads them, so a pick-only trade would be a no-op anyway).
 */
export function buildRostersWithTrade(
  rosters: SleeperRoster[],
  myRosterId: number,
  opponentRosterId: number,
  giveIds: string[],
  receiveIds: string[],
): SleeperRoster[] {
  if (giveIds.length === 0 && receiveIds.length === 0) return rosters;
  const giveSet = new Set(giveIds);
  const receiveSet = new Set(receiveIds);
  return rosters.map((r) => {
    const rid = Number(r.roster_id);
    if (rid === myRosterId) {
      return { ...r, players: [...(r.players || []).filter((id) => !giveSet.has(id)), ...receiveIds] };
    }
    if (rid === opponentRosterId) {
      return { ...r, players: [...(r.players || []).filter((id) => !receiveSet.has(id)), ...giveIds] };
    }
    return r;
  });
}

export interface SimulateLeagueArgs {
  selectedLeague: SleeperLeague | null;
  rosters: SleeperRoster[];
  players: Record<string, SleeperPlayer>;
  nflState: SleeperNFLState | null;
  projectionData: ProjectionRow[];
  projectionWeek: number;
  playerStats: Record<string, PlayerUsage> | null;
  leagueWeeklyMatchups: Record<string, { week: number; matchups: SleeperMatchup[] }[]>;
  standings: StandingRow[];
  users: Record<string, string>;
  leagueAdjustedFcValues: Record<string, number>;
  leagueAdjustedRedraftValues: Record<string, number>;
  projectedRookiesByRoster: Map<number, PoolPlayer[]>;
  simSalt: number;
}

export function simulateLeague({
  selectedLeague,
  rosters,
  players,
  nflState,
  projectionData,
  projectionWeek,
  playerStats,
  leagueWeeklyMatchups,
  standings,
  users,
  leagueAdjustedFcValues,
  leagueAdjustedRedraftValues,
  projectedRookiesByRoster,
  simSalt,
}: SimulateLeagueArgs): LeagueSimulation | null {
  if (!selectedLeague || !rosters.length) return null;

  const leagueId = selectedLeague.league_id;
  const nflWeek = Number(nflState?.week || 0);
  const isRegularSeason = nflState?.season_type === "regular" && nflWeek > 0;
  const currentWeek = isRegularSeason ? nflWeek : 0;
  const simulationMode = (currentWeek > 0 ? "in_season" : "offseason") as "in_season" | "offseason";
  const regularSeasonWeeks = Math.max(1, Number(selectedLeague?.settings?.playoff_week_start || 15) - 1);
  const playoffTeams = Number(selectedLeague?.settings?.playoff_teams || Math.ceil(rosters.length / 2));
  const byeTeams = playoffTeams >= 6 ? 2 : playoffTeams === 5 ? 1 : 0;
  const simCount = simulationMode === "offseason" ? 350 : 250;
  const weeklyHistory = (leagueWeeklyMatchups[leagueId] || []) as Array<{ week: number; matchups: SleeperMatchup[] }>;
  const projectionMap = new Map(
    ((projectionWeek === 0 || projectionWeek === currentWeek) ? projectionData : []).map((row) => [String(row.sleeperId), Number(row.fpts || 0)])
  );
  const lineupSlots = (selectedLeague?.roster_positions || []).filter(
    (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
  );
  const weeksPlayed = currentWeek > 0
    ? weeklyHistory.filter((week) => week.week < currentWeek).length
    : 0;
  const projectionIsSeason = projectionWeek === 0;

  const scorePlayer = (playerId: string) => {
    const projected = projectionMap.get(String(playerId));
    if (typeof projected === "number" && projected > 0) return projected;
    const redraftVal = leagueAdjustedRedraftValues[playerId] ?? 0;
    if (redraftVal > 0) return redraftVal / 250;
    const p = players[playerId] as SleeperPlayer | undefined;
    if (p?.years_exp === 0) {
      const fcVal = leagueAdjustedFcValues[playerId] ?? 0;
      if (fcVal > 0) return fcVal / 425;
    }
    return 0;
  };

  const teamByeWeekMap = new Map<string, number>();
  (Object.values(players) as SleeperPlayer[]).forEach((p) => {
    if (p.team && p.bye_week) teamByeWeekMap.set(p.team, p.bye_week);
  });

  const getPlayerByeWeek = (playerId: string, nflTeam: string | null): number => {
    const explicit = (players[playerId] as SleeperPlayer | undefined)?.bye_week;
    if (explicit) return explicit;
    if (nflTeam && teamByeWeekMap.has(nflTeam)) return teamByeWeekMap.get(nflTeam)!;
    if (nflTeam) {
      const hash = nflTeam.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
      return 5 + (hash % 10);
    }
    return 0;
  };

  // Per-player weekly injury risk, replacing the old flat 6.5% roll. BASE_INJURY_RATE
  // stays the mid-tier (average age/durability) rate so the league-wide center of mass
  // is unchanged from before; age/position pushes durability risk up or down around it
  // every week (same thresholds as dataHubHelpers' ageRiskScore), while a live
  // Sleeper injury_status only informs the *current* week — future weeks have no basis
  // to assume a Questionable/Doubtful tag still holds, so only durability carries there.
  const BASE_INJURY_RATE = 0.065;
  const durabilityMultiplier = (age: number | null | undefined, position: string): number => {
    if (!age) return 1;
    const [young, mid] = position === "RB" ? [23, 26] : [24, 27];
    if (age <= young) return 0.7;
    if (age <= mid) return 1;
    return 1.5;
  };
  const getPlayerInjuryRate = (playerId: string, position: string, simWeek: number): number => {
    const p = players[playerId] as SleeperPlayer | undefined;
    let rate = BASE_INJURY_RATE * durabilityMultiplier(p?.age, position);
    if (simWeek === currentWeek) {
      const status = (p?.injury_status ?? "").trim();
      if (/^(?:q|questionable)$/i.test(status)) rate = Math.max(rate, 0.25);
      else if (/^(?:d|doubtful)$/i.test(status)) rate = Math.max(rate, 0.75);
      else if (status && !/^(?:active|probable)$/i.test(status)) rate = Math.max(rate, 0.97);
    }
    return Math.min(0.97, rate);
  };

  const pickBestStarters = (pool: PoolPlayer[], unavailableIds: Set<string>): { score: number; used: Set<string> } => {
    const avail = [...pool].filter((p) => !unavailableIds.has(p.id)).sort((a, b) => b.score - a.score);
    const used = new Set<string>();
    let score = 0;
    lineupSlots.forEach((slot: string) => {
      const eligible = slot === "FLEX" ? ["RB", "WR", "TE"] : slot === "SUPER_FLEX" ? ["QB", "RB", "WR", "TE"] : [slot];
      const next = avail.find((p) => !used.has(p.id) && eligible.includes(p.position));
      if (next) { used.add(next.id); score += next.score; }
    });
    return { score, used };
  };

  const rosterPoolMap = new Map<number, PoolPlayer[]>();
  rosters.forEach((rEntry) => {
    const existing: PoolPlayer[] = ((rEntry?.players || []) as string[])
      .map((id: string) => {
        const p = players[id] as SleeperPlayer | undefined;
        if (!p || !["QB", "RB", "WR", "TE"].includes(p.position)) return null;
        return { id, position: p.position, nflTeam: p.team, score: scorePlayer(id) } as PoolPlayer;
      })
      .filter((p): p is PoolPlayer => p !== null);
    const rookieExtras: PoolPlayer[] = simulationMode === "offseason"
      ? (projectedRookiesByRoster.get(Number(rEntry.roster_id)) || [])
      : [];
    rosterPoolMap.set(Number(rEntry.roster_id), [...existing, ...rookieExtras]);
  });

  const buildLineupStrength = (rosterEntry: SleeperRoster, pool: PoolPlayer[]) => {
    const { score: rawLineupScore, used } = pickBestStarters(pool, new Set());
    const bench = pool.filter((p) => !used.has(p.id));
    const rawBenchDepth = bench.slice(0, 5).reduce((s, p) => s + p.score, 0);
    const weeklyLineupScore = rawLineupScore / (projectionIsSeason ? regularSeasonWeeks : 1);
    const weeklyBenchDepth = rawBenchDepth / (projectionIsSeason ? regularSeasonWeeks : 1);
    const seasonProjection = projectionIsSeason
      ? rawLineupScore
      : Number(rosterEntry?.settings?.fpts_max || 0) + (Math.max(regularSeasonWeeks - Math.max(currentWeek - 1, 0), 0) * rawLineupScore);

    const teamVolatilityMultiplier = (() => {
      const starters = pool.filter((p) => used.has(p.id) && players[p.id]);
      if (starters.length === 0) return 1.0;
      const posBase: Record<string, number> = { QB: 0.75, RB: 0.88, WR: 1.05, TE: 0.90 };
      let wVolSum = 0;
      let wSum = 0;
      starters.forEach((sp) => {
        const dynVal = leagueAdjustedFcValues[sp.id] ?? (players[sp.id] as SleeperPlayer | undefined)?.value ?? 0;
        const redVal = leagueAdjustedRedraftValues[sp.id] ?? 0;
        const base = posBase[sp.position] ?? 1.0;
        const ratio = redVal > 100 ? dynVal / redVal : 1.0;
        const ratioMod = ratio > 2.5 ? 1.22 : ratio > 1.8 ? 1.12 : ratio > 1.3 ? 1.05 : ratio < 0.7 ? 0.90 : 1.0;
        const stats = playerStats?.[sp.id];
        let usageMod = 1.0;
        if (stats && (stats.gamesPlayed ?? 0) >= 2) {
          if (sp.position === "WR" || sp.position === "TE") {
            const tgt = stats.avgTargets ?? 0;
            usageMod = tgt >= 8 ? 0.87 : tgt >= 5 ? 0.94 : tgt >= 3 ? 1.05 : 1.18;
          } else if (sp.position === "RB") {
            const touch = (stats.avgCarries ?? 0) + (stats.avgTargets ?? 0);
            usageMod = touch >= 15 ? 0.82 : touch >= 10 ? 0.91 : touch >= 6 ? 1.0 : 1.14;
          }
        }
        const vol = base * ratioMod * usageMod;
        const weight = Math.max(dynVal > 0 ? dynVal : 200, 200);
        wVolSum += vol * weight;
        wSum += weight;
      });
      const raw = wSum > 0 ? wVolSum / wSum : 1.0;
      return Math.max(0.75, Math.min(1.35, raw));
    })();

    return {
      lineupScore: weeklyLineupScore,
      benchDepth: weeklyBenchDepth,
      projectedMaxPf: Math.round(seasonProjection * 10) / 10,
      powerScore: Math.round((weeklyLineupScore + weeklyBenchDepth * 0.35) * 10) / 10,
      weeklyStdDev: Math.max(8, (weeklyLineupScore * 0.16 + weeklyBenchDepth * 0.08) * teamVolatilityMultiplier),
    };
  };

  const rows: SimulationTeamRow[] = rosters.map((rosterEntry) => {
    const pool = rosterPoolMap.get(Number(rosterEntry.roster_id)) || [];
    const strength = buildLineupStrength(rosterEntry, pool);
    const standing = standings.find((entry) => Number(entry.roster_id) === Number(rosterEntry.roster_id));
    const ownerName = users[rosterEntry.owner_id] || `Team ${rosterEntry.roster_id}`;
    return {
      rosterId: Number(rosterEntry.roster_id),
      ownerId: rosterEntry.owner_id,
      ownerName,
      actualWins: Number(standing?.wins || rosterEntry.settings?.wins || 0),
      actualLosses: Number(standing?.losses || rosterEntry.settings?.losses || 0),
      pointsFor: Number(standing?.fpts || rosterEntry.settings?.fpts || 0),
      maxPf: Number(standing?.max_pf || rosterEntry.settings?.fpts_max || 0),
      ...strength,
      expectedWins: 0,
      avgFinish: 0,
      projectedFinish: 0,
      finishRange: "",
      playoffOdds: 0,
      byeOdds: 0,
      titleOdds: 0,
      oneOhOneOdds: 0,
      luckScore: 0,
      allPlayWins: 0,
      allPlayLosses: 0,
      allPlayExpectedWins: 0,
      avgWinProb: 0,
      currentWeekWinProb: 0,
      currentOpponent: undefined,
      finishProbabilities: [],
      slotProbabilities: [],
      upcomingSchedule: [],
    } satisfies SimulationTeamRow;
  });

  const rowByRosterId = new Map(rows.map((row) => [row.rosterId, row]));
  const rosterIds = rows.map((row) => row.rosterId).sort((a, b) => a - b);
  const generatedSchedule = buildRoundRobinSchedule(rosterIds, regularSeasonWeeks);
  const actualScheduleByWeek = new Map<number, Array<[number, number]>>();
  weeklyHistory.forEach((week) => {
    const grouped = new Map<number, number[]>();
    (week.matchups || [])
      .filter((entry) => entry?.matchup_id && entry?.roster_id)
      .forEach((entry) => {
        const matchupId = Number(entry.matchup_id);
        if (!grouped.has(matchupId)) grouped.set(matchupId, []);
        grouped.get(matchupId)?.push(Number(entry.roster_id));
      });
    const pairs = [...grouped.values()]
      .filter((pair) => pair.length === 2)
      .map((pair) => [pair[0], pair[1]] as [number, number]);
    if (pairs.length > 0) actualScheduleByWeek.set(Number(week.week), pairs);
  });

  const scheduleByWeek = Array.from({ length: regularSeasonWeeks }, (_, idx) => {
    const week = idx + 1;
    const actualPairs = actualScheduleByWeek.get(week) || [];
    return {
      week,
      source: actualPairs.length > 0 ? "scheduled" : "generated",
      pairs: actualPairs.length > 0 ? actualPairs : generatedSchedule[idx] || [],
    };
  });

  const teamActualScores = new Map<number, number[]>();
  if (currentWeek > 0) {
    weeklyHistory
      .filter((w) => w.week < currentWeek)
      .forEach((w) => {
        (w.matchups || []).forEach((entry) => {
          const pts = Number(entry?.points ?? 0);
          if (!entry?.roster_id || pts === 0) return;
          const rid = Number(entry.roster_id);
          if (!teamActualScores.has(rid)) teamActualScores.set(rid, []);
          teamActualScores.get(rid)!.push(pts);
        });
      });

    rows.forEach((row) => {
      const scores = teamActualScores.get(row.rosterId);
      if (!scores || scores.length < 2) return;

      const recentN = Math.min(4, scores.length);
      const weights = scores.map((_, i) => (i >= scores.length - recentN ? 2 : 1));
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      const weightedMean = scores.reduce((s, v, i) => s + v * weights[i], 0) / totalWeight;
      const wVariance = scores.reduce((s, v, i) => s + weights[i] * (v - weightedMean) ** 2, 0) / totalWeight;
      const historicalStdDev = Math.max(6, Math.sqrt(wVariance));

      if (scores.length >= 4) {
        const histWeight = Math.min(0.65, 0.40 + (scores.length - 4) * 0.0625);
        row.lineupScore = row.lineupScore * (1 - histWeight) + weightedMean * histWeight;
      }

      const formulaStdDev = row.weeklyStdDev;
      if (scores.length >= 6) {
        row.weeklyStdDev = historicalStdDev;
      } else if (scores.length >= 3) {
        const blend = (scores.length - 2) / 4;
        row.weeklyStdDev = formulaStdDev * (1 - blend) + historicalStdDev * blend;
      }

      row.powerScore = Math.round((row.lineupScore + row.benchDepth * 0.35) * 10) / 10;
    });
  }

  let scoreFloor = 40;
  if (currentWeek > 0) {
    const allActual = [...teamActualScores.values()].flat().sort((a, b) => a - b);
    if (allActual.length >= 10) {
      scoreFloor = Math.max(30, Math.round(allActual[Math.floor(allActual.length * 0.10)]));
    }
  }

  const rosterBaseScore = new Map<number, number>();
  rows.forEach((row) => {
    const pool = rosterPoolMap.get(row.rosterId) || [];
    const { score } = pickBestStarters(pool, new Set());
    rosterBaseScore.set(row.rosterId, score > 0 ? score : 1);
  });

  const playMatch = (aRosterId: number, bRosterId: number, simWeek: number, rng: () => number) => {
    const aRow = rowByRosterId.get(aRosterId);
    const bRow = rowByRosterId.get(bRosterId);
    if (!aRow || !bRow) return { winner: aRosterId, loser: bRosterId, aPoints: 0, bPoints: 0 };

    const computeScore = (rosterId: number, row: SimulationTeamRow): number => {
      const pool = rosterPoolMap.get(rosterId) || [];
      if (simWeek > 0 && pool.length > 0) {
        const unavail = new Set<string>();
        pool.forEach((p) => {
          const byeWk = getPlayerByeWeek(p.id, p.nflTeam);
          if (byeWk > 0 && byeWk === simWeek) {
            unavail.add(p.id);
          } else if (rng() < getPlayerInjuryRate(p.id, p.position, simWeek)) {
            unavail.add(p.id);
          }
        });
        const weekRaw = pickBestStarters(pool, unavail).score;
        const baseRaw = rosterBaseScore.get(rosterId) || weekRaw;
        const weeklyRaw = weekRaw / (projectionIsSeason ? regularSeasonWeeks : 1);
        const baseWeekly = baseRaw / (projectionIsSeason ? regularSeasonWeeks : 1);
        const ratio = baseWeekly > 0 ? Math.max(0.35, Math.min(1.0, weeklyRaw / baseWeekly)) : 1.0;
        return Math.max(scoreFloor, row.lineupScore * ratio + randomNormal(rng) * row.weeklyStdDev * 0.82);
      }
      return Math.max(scoreFloor, row.lineupScore + randomNormal(rng) * row.weeklyStdDev);
    };

    const aPoints = computeScore(aRosterId, aRow);
    const bPoints = computeScore(bRosterId, bRow);
    if (aPoints === bPoints) {
      return rng() < 0.5
        ? { winner: aRosterId, loser: bRosterId, aPoints, bPoints }
        : { winner: bRosterId, loser: aRosterId, aPoints, bPoints };
    }
    return aPoints > bPoints
      ? { winner: aRosterId, loser: bRosterId, aPoints, bPoints }
      : { winner: bRosterId, loser: aRosterId, aPoints, bPoints };
  };

  const seededIndex = (seededIds: number[], rosterId: number) => seededIds.indexOf(rosterId);
  const simulatePlayoffs = (seededIds: number[], rng: () => number) => {
    if (seededIds.length === 0) return null;
    if (seededIds.length === 1) return seededIds[0];

    let roundTeams = [...seededIds];
    if (byeTeams > 0 && roundTeams.length > byeTeams) {
      const byes = roundTeams.slice(0, byeTeams);
      const openingRound = roundTeams.slice(byeTeams);
      const winners: number[] = [];
      while (openingRound.length >= 2) {
        const high = openingRound.shift()!;
        const low = openingRound.pop()!;
        winners.push(playMatch(high, low, 0, rng).winner);
      }
      roundTeams = [...byes, ...winners].sort((a, b) => seededIndex(seededIds, a) - seededIndex(seededIds, b));
    }

    while (roundTeams.length > 1) {
      const roundSeeds = [...roundTeams].sort((a, b) => seededIndex(seededIds, a) - seededIndex(seededIds, b));
      const winners: number[] = [];
      while (roundSeeds.length >= 2) {
        const high = roundSeeds.shift()!;
        const low = roundSeeds.pop()!;
        winners.push(playMatch(high, low, 0, rng).winner);
      }
      roundTeams = winners.sort((a, b) => seededIndex(seededIds, a) - seededIndex(seededIds, b));
    }
    return roundTeams[0];
  };

  rows.forEach((row) => {
    const others = rows.filter((other) => other.rosterId !== row.rosterId);
    row.avgWinProb = others.length
      ? average(others.map((other) => logisticWinProb(row.powerScore, other.powerScore, 14) * 100)) / 100
      : 0.5;
    row.currentWeekWinProb = row.avgWinProb;
    row.currentOpponent = undefined;
    row.allPlayWins = 0;
    row.allPlayLosses = 0;
    row.upcomingSchedule = [];
  });

  if (currentWeek > 0) {
    weeklyHistory
      .filter((week) => week.week < currentWeek)
      .forEach((week) => {
        const scored = (week.matchups || []).filter((matchup) => matchup?.roster_id);
        scored.forEach((entry) => {
          const row = rowByRosterId.get(Number(entry.roster_id));
          if (!row) return;
          const wins = scored.filter((other) => Number(other.roster_id) !== Number(entry.roster_id) && Number(entry.points || 0) > Number(other.points || 0)).length;
          const losses = scored.filter((other) => Number(other.roster_id) !== Number(entry.roster_id) && Number(entry.points || 0) < Number(other.points || 0)).length;
          row.allPlayWins += wins;
          row.allPlayLosses = (row.allPlayLosses ?? 0) + losses;
        });
      });
  }

  const displayWeeks = scheduleByWeek
    .filter((week) => week.week >= (currentWeek || 1))
    .slice(0, 4)
    .map((week) => {
      const matchups = week.pairs.map(([aRosterId, bRosterId]) => {
        const aRow = rowByRosterId.get(aRosterId);
        const bRow = rowByRosterId.get(bRosterId);
        if (!aRow || !bRow) return null;
        const aProb = logisticWinProb(aRow.powerScore, bRow.powerScore, 14);
        const bProb = 1 - aProb;
        const matchup = {
          week: week.week,
          source: week.source,
          aRosterId,
          aName: aRow.ownerName,
          aWinProb: aProb,
          aProjected: Math.round(aRow.lineupScore * 10) / 10,
          bRosterId,
          bName: bRow.ownerName,
          bWinProb: bProb,
          bProjected: Math.round(bRow.lineupScore * 10) / 10,
        };
        aRow.upcomingSchedule.push({
          week: week.week,
          opponentRosterId: bRosterId,
          opponentName: bRow.ownerName,
          winProb: aProb,
          projectedPoints: matchup.aProjected,
          source: week.source,
        });
        bRow.upcomingSchedule.push({
          week: week.week,
          opponentRosterId: aRosterId,
          opponentName: aRow.ownerName,
          winProb: bProb,
          projectedPoints: matchup.bProjected,
          source: week.source,
        });
        if (week.week === currentWeek) {
          aRow.currentWeekWinProb = aProb;
          bRow.currentWeekWinProb = bProb;
          aRow.currentOpponent = bRow.ownerName;
          bRow.currentOpponent = aRow.ownerName;
        }
        return matchup;
      }).filter((m): m is NonNullable<typeof m> => m !== null);
      return { week: week.week, source: week.source, matchups };
    });

  const simulationStats = Object.fromEntries(
    rows.map((row) => [row.rosterId, {
      winsSum: 0,
      finishCounts: Array.from({ length: rosters.length + 1 }, () => 0),
      slotCounts: Array.from({ length: rosters.length + 1 }, () => 0),
      playoffCount: 0,
      byeCount: 0,
      titleCount: 0,
    }])
  ) as Record<number, { winsSum: number; finishCounts: number[]; slotCounts: number[]; playoffCount: number; byeCount: number; titleCount: number }>;

  const leagueSeed = String(leagueId).split("").reduce((acc, char, idx) => acc + char.charCodeAt(0) * (idx + 1), 0) + simSalt;
  const simStartWeek = currentWeek > 0 ? currentWeek : 1;
  for (let sim = 0; sim < simCount; sim++) {
    const rng = createSeededRandom(leagueSeed + sim * 7919 + regularSeasonWeeks * 17);
    const winMap = new Map<number, number>(rows.map((row) => [row.rosterId, row.actualWins]));
    const pointMap = new Map<number, number>(rows.map((row) => [row.rosterId, row.pointsFor]));

    scheduleByWeek
      .filter((week) => week.week >= simStartWeek)
      .forEach((week) => {
        week.pairs.forEach(([aRosterId, bRosterId]) => {
          const result = playMatch(aRosterId, bRosterId, week.week, rng);
          pointMap.set(aRosterId, (pointMap.get(aRosterId) || 0) + result.aPoints);
          pointMap.set(bRosterId, (pointMap.get(bRosterId) || 0) + result.bPoints);
          winMap.set(result.winner, (winMap.get(result.winner) || 0) + 1);
        });
      });

    const simStandings = rows
      .map((row) => ({
        rosterId: row.rosterId,
        wins: winMap.get(row.rosterId) || 0,
        points: pointMap.get(row.rosterId) || 0,
        powerScore: row.powerScore,
        projectedMaxPf: row.projectedMaxPf,
      }))
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.points !== a.points) return b.points - a.points;
        if (b.powerScore !== a.powerScore) return b.powerScore - a.powerScore;
        return b.projectedMaxPf - a.projectedMaxPf;
      });

    const seededIds = simStandings.map((entry) => entry.rosterId);
    seededIds.forEach((rosterId, index) => {
      const stats = simulationStats[rosterId];
      stats.winsSum += winMap.get(rosterId) || 0;
      stats.finishCounts[index + 1] += 1;
      stats.slotCounts[rosters.length - index] += 1;
    });
    seededIds.slice(0, playoffTeams).forEach((rosterId, index) => {
      simulationStats[rosterId].playoffCount += 1;
      if (index < byeTeams) simulationStats[rosterId].byeCount += 1;
    });
    const championRosterId = simulatePlayoffs(seededIds.slice(0, playoffTeams), rng);
    if (championRosterId != null) simulationStats[championRosterId].titleCount += 1;
  }

  rows.forEach((row) => {
    const stats = simulationStats[row.rosterId];
    const finishCounts = stats.finishCounts as number[];
    const slotCounts = stats.slotCounts as number[];
    const expectedFinish = finishCounts.reduce((total, count, finish) => total + finish * count, 0) / simCount;
    const likelyFinish = finishCounts.reduce((bestIdx, count, idx, arr) => count > arr[bestIdx] ? idx : bestIdx, 1);
    const floorFinish = percentileFromCounts(finishCounts, 0.2);
    const ceilingFinish = percentileFromCounts(finishCounts, 0.8);

    row.expectedWins = Math.round((stats.winsSum / simCount) * 10) / 10;
    row.avgFinish = Math.round(expectedFinish * 10) / 10;
    row.projectedFinish = likelyFinish;
    row.finishRange = `${floorFinish || likelyFinish}-${ceilingFinish || likelyFinish}`;
    row.playoffOdds = Math.round((stats.playoffCount / simCount) * 1000) / 10;
    row.byeOdds = Math.round((stats.byeCount / simCount) * 1000) / 10;
    row.titleOdds = Math.round((stats.titleCount / simCount) * 1000) / 10;
    row.finishProbabilities = finishCounts.map((count) => count / simCount);
    row.slotProbabilities = slotCounts.map((count) => count / simCount);
    row.allPlayExpectedWins = weeksPlayed > 0 ? Math.round((row.allPlayWins / Math.max(rosters.length - 1, 1)) * 10) / 10 : 0;
    row.luckScore = weeksPlayed > 0 ? Math.round((row.actualWins - row.allPlayExpectedWins) * 10) / 10 : 0;
    row.oneOhOneOdds = Math.round(((slotCounts[1] || 0) / simCount) * 1000) / 10;
    row.upcomingSchedule = row.upcomingSchedule.slice(0, 4);
  });

  const ranked = [...rows].sort((a, b) => {
    if (b.playoffOdds !== a.playoffOdds) return b.playoffOdds - a.playoffOdds;
    if (b.titleOdds !== a.titleOdds) return b.titleOdds - a.titleOdds;
    if (b.expectedWins !== a.expectedWins) return b.expectedWins - a.expectedWins;
    return b.powerScore - a.powerScore;
  });

  return {
    currentWeek,
    simulationMode,
    regularSeasonWeeks,
    playoffTeams,
    byeTeams,
    weeksPlayed,
    simCount,
    rows: ranked,
    weeklyMatchups: displayWeeks,
    rowByRosterId: new Map(ranked.map((row) => [row.rosterId, row])),
  };
}
