// ============================================================
// Lineup availability — who the Lineup Coach should treat as out this week
// beyond the official tag, and which risky starters play too late to pivot.
//
//   - The user's own per-week call (LineupAvailabilityOverride), applied in
//     every league: OUT keeps a player out of suggested lineups; IN says
//     "start him anyway" and silences the ESPN news read and late-game warning.
//   - The ESPN news read (injuryNews.ts): a Questionable player whose note says
//     he's unlikely to play is treated like a Doubtful one.
//   - Late-game pivot risk: a Questionable starter's inactive call lands ~90
//     minutes before his own kickoff. If every bench player who could fill his
//     slot has already kicked off by then, an inactive call leaves a 0 in the
//     lineup. Shown as a warning; the coach doesn't act on it.
//
// Shared by the Starters tab and the League Overview status dot so both agree.
// ============================================================
import { getLineupSlotEligiblePositions, isInjuryExcludedFromLineup } from "./lineup";
import type { InjuryNewsFlag } from "./injuryNews";
import type { LineupAvailabilityOverride, LineupCoachRow, SleeperPlayer } from "../types";

/** NFL teams announce inactives 90 minutes before kickoff. */
export const INACTIVES_LEAD_MS = 90 * 60_000;

/** Key for one NFL week in LineupAvailabilityOverrides. */
export const lineupWeekKey = (season: string | number, week: number): string => `${season}:${week}`;

/** What the Starters tab needs on top of the base data — built once in
 *  useAppState so the tab and the Overview dot read the same inputs. */
export interface LineupAvailability {
  /** Sleeper's players map with ESPN's fresher injury statuses applied. */
  players: Record<string, SleeperPlayer>;
  /** This week's ESPN news reads, keyed by player id (Questionable players only). */
  news: Record<string, InjuryNewsFlag>;
  /** The user's calls for the current week, keyed by player id. */
  overrides: Record<string, LineupAvailabilityOverride>;
  /** Sets (or clears, with null) the user's call on a player for the current week. */
  setOverride: (playerId: string, value: LineupAvailabilityOverride | null) => void;
}

/** True when the coach should treat a player as out on top of his official
 *  tag: the user marked him out, or this week's ESPN note says he's unlikely
 *  to play and the user hasn't said to start him anyway. */
export function isAvailabilityExcluded(
  id: string,
  overrides: Record<string, LineupAvailabilityOverride>,
  news: Record<string, InjuryNewsFlag>
): boolean {
  const override = overrides[id];
  if (override === "OUT") return true;
  if (override === "IN") return false;
  return news[id]?.lean === "likely-out";
}

/** True for a starter who might be ruled inactive: Questionable (unless his
 *  note says he's likely to play), Doubtful, or flagged by the news. A player
 *  the user has made a call on is never a risk — they've decided. */
export function isLateScratchRisk(
  player: SleeperPlayer,
  override: LineupAvailabilityOverride | undefined,
  news: InjuryNewsFlag | undefined
): boolean {
  if (override) return false;
  if (news?.lean === "likely-in") return false;
  const status = `${player.injury_status || ""}`.toLowerCase();
  return status === "questionable" || status === "doubtful" || news != null;
}

/** The three per-player checks both the Starters tab and the Overview dot
 *  feed into computeSuggestedLineup / getLatePivotRisks, built one way. */
export function getLineupAvailabilityChecks(
  availability: Pick<LineupAvailability, "players" | "news" | "overrides">
): {
  isExcludedFn: (id: string) => boolean;
  isRiskFn: (id: string) => boolean;
  isUnavailableFn: (id: string) => boolean;
} {
  const { players, news, overrides } = availability;
  const isExcludedFn = (id: string) => isAvailabilityExcluded(id, overrides, news);
  return {
    isExcludedFn,
    isRiskFn: (id) => {
      const player = players[id];
      return !!player && isLateScratchRisk(player, overrides[id], news[id]);
    },
    isUnavailableFn: (id) => isInjuryExcludedFromLineup(players[id]) || isExcludedFn(id),
  };
}

export interface LatePivotRisk {
  slot: string;
  player: SleeperPlayer;
  kickoffAt: number;
  /** When his inactive call should land (kickoff − 90 min). */
  decisionAt: number;
  /** Bench players who can fill his slot and whose game hasn't started by
   *  decisionAt, best projection first. Empty = no way out if he sits. */
  pivots: SleeperPlayer[];
}

export interface LatePivotRiskInput {
  /** The suggested lineup (computeSuggestedLineup's `lineup`). */
  lineup: LineupCoachRow[];
  /** The roster's lineup-eligible player ids (taxi excluded). */
  playerIds: string[];
  players: Record<string, SleeperPlayer>;
  scoreFn: (id: string) => number;
  /** Real kickoff of the player's game this week, or null (bye / unknown). */
  kickoffFn: (id: string) => number | null;
  isRiskFn: (id: string) => boolean;
  /** Can't be a pivot: Out/IR/Doubtful, marked out, or news says out. */
  isUnavailableFn: (id: string) => boolean;
}

/** Risky starters whose inactive call is still to come, each with the bench
 *  players who'd still be swappable when it lands. Once the call is due the
 *  ESPN status feed takes over (Active or Out), so those drop off. */
export function getLatePivotRisks(input: LatePivotRiskInput, now: number = Date.now()): LatePivotRisk[] {
  const starting = new Set(
    input.lineup.map((row) => row.player?.player_id).filter((id): id is string => !!id)
  );
  const risks: LatePivotRisk[] = [];
  for (const row of input.lineup) {
    const player = row.player;
    if (!player?.player_id || !input.isRiskFn(player.player_id)) continue;
    const kickoffAt = input.kickoffFn(player.player_id);
    if (kickoffAt == null) continue;
    const decisionAt = kickoffAt - INACTIVES_LEAD_MS;
    if (now >= decisionAt) continue;

    const eligible = getLineupSlotEligiblePositions(row.slot);
    const pivots = input.playerIds
      .filter((id) => !starting.has(id))
      .map((id) => input.players[id])
      .filter((p): p is SleeperPlayer => !!p && eligible.includes(p.position))
      .filter((p) => !input.isUnavailableFn(p.player_id) && input.scoreFn(p.player_id) > 0)
      .filter((p) => {
        const kickoff = input.kickoffFn(p.player_id);
        return kickoff != null && kickoff > decisionAt;
      })
      .sort((a, b) => input.scoreFn(b.player_id) - input.scoreFn(a.player_id));
    risks.push({ slot: row.slot, player, kickoffAt, decisionAt, pivots });
  }
  return risks;
}
