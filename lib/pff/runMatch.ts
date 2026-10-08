// ============================================================
// Match one prospect and his charted games to PFF — SERVER-ONLY.
// ============================================================
// The I/O around the pure rules in match.ts: search the directory, fetch the
// candidates' game logs for the charted seasons, decide the player, then
// match his games and ask PFF whether it charted the ones he has no row in.
// The user's own calls (status confirmed / none) are never re-decided.
// Calls per prospect: 1–3 searches, one log per candidate per charted season
// (most prospects: one candidate, one or two seasons), plus one /v1/games per
// game PFF has no row for him in. Season team lists are cached (ncaa.ts).
// ============================================================

import { opponentSchool, type LearnedNames } from "../scouting/opponentTier";
import type { PffPlayerMatchStatus } from "../types";
import type { PffClient } from "./client";
import {
  candidateEvidence, compareNames, decidePlayer, hisGames, matchGames, noPlayerGames, pffTeamSchool,
  positionFits, teamSchedule, type CandidateEvidence, type ChartedGame, type GameDecision, type HisGame,
  type PlayerDecision, type ProspectForMatch,
} from "./match";
import { offenseWeeks, searchPlayers, seasonTeams, weekGames, type PffPlayer, type PffSeasonTeams } from "./ncaa";

/** Most candidates whose game logs are fetched per prospect. */
export const MAX_CANDIDATES = 3;

export interface ProspectToMatch extends ProspectForMatch {
  id: string;
  pff_player_id: number | null;
  pff_match_status: PffPlayerMatchStatus | null;
}

export interface ProspectMatch {
  prospectId: string;
  /** The new player decision; null = the user's own call, left as is. */
  player: PlayerDecision | null;
  /** The PFF player his games were matched against, if any. */
  playerId: number | null;
  games: GameDecision[];
}

/** Directory search with fallbacks: as typed, without a suffix, then by last name. */
export async function findCandidates(client: PffClient, name: string): Promise<PffPlayer[]> {
  const seen = new Map<number, PffPlayer>();
  const named = () => [...seen.values()].some((p) => compareNames(name, p) !== "none");
  const typed = name.replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  const queries = [
    typed,
    typed.replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "").replace(/\s+/g, " ").trim(),
    typed.replace(/'/g, ""),
    typed.split(" ").filter((w) => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w)).pop() ?? "",
  ];
  const tried = new Set<string>();
  for (const q of queries) {
    if (q.length < 3 || tried.has(q.toLowerCase())) continue;
    tried.add(q.toLowerCase());
    for (const p of await searchPlayers(client, q)) seen.set(p.id, p);
    if (named()) break;
  }
  return [...seen.values()];
}

/** `learned`: opponent names the user taught by linking other games (learnedOpponentNames.ts). */
export async function matchProspect(
  client: PffClient,
  prospect: ProspectToMatch,
  games: readonly ChartedGame[],
  learned?: LearnedNames,
): Promise<ProspectMatch> {
  const seasons = [...new Set(games.map((g) => g.season_year))].sort();
  const teams = new Map<number, Promise<PffSeasonTeams>>();
  const teamsFor = (season: number) => {
    if (!teams.has(season)) teams.set(season, seasonTeams(client, season));
    return teams.get(season)!;
  };
  const logs = new Map<number, Map<number, HisGame[]>>();
  const logFor = async (playerId: number) => {
    const hit = logs.get(playerId);
    if (hit) return hit;
    const bySeason = new Map<number, HisGame[]>();
    for (const season of seasons) {
      const [t, rows] = await Promise.all([teamsFor(season), offenseWeeks(client, playerId, season)]);
      bySeason.set(season, hisGames(rows, season, t.teams, t.games, prospect.position));
    }
    logs.set(playerId, bySeason);
    return bySeason;
  };

  let player: PlayerDecision | null = null;
  let playerId: number | null = null;
  if (prospect.pff_match_status === "confirmed") {
    playerId = prospect.pff_player_id;
  } else if (prospect.pff_match_status !== "none") {
    const candidates = (await findCandidates(client, prospect.name))
      .map((p) => ({ p, name: compareNames(prospect.name, p), pos: positionFits(prospect.position, p.position) }))
      .filter((c) => c.name !== "none")
      .sort((a, b) => Number(b.pos) - Number(a.pos) || Number(b.name === "exact") - Number(a.name === "exact"));
    const evidence: CandidateEvidence[] = [];
    for (const c of candidates.slice(0, MAX_CANDIDATES)) {
      evidence.push(candidateEvidence(prospect, c.p, games, seasons.length ? await logFor(c.p.id) : null, learned));
    }
    player = decidePlayer(prospect, evidence);
    const unchecked = candidates.slice(MAX_CANDIDATES).filter((c) => c.pos).length;
    if (player.status === "auto" && unchecked > 0) {
      player = { ...player, status: "review", note: `${player.note}; ${unchecked} more PFF ${prospect.position}(s) with this name weren't checked` };
    }
    playerId = player.status === "auto" ? player.playerId : null;
  }

  if (playerId == null) {
    const note = prospect.pff_match_status === "none" ? "You marked him as not in PFF"
      : player?.status === "review" ? "Waiting on the player link" : "No PFF player linked";
    return { prospectId: prospect.id, player, playerId: null, games: noPlayerGames(games, note) };
  }
  if (seasons.length === 0) return { prospectId: prospect.id, player, playerId, games: [] };

  const his = await logFor(playerId);
  const schedules = new Map<number, HisGame[]>();
  for (const season of seasons) {
    const t = await teamsFor(season);
    let teamIds = [...new Set((his.get(season) ?? []).map((h) => h.teamId))];
    if (teamIds.length === 0) {
      // No rows for him that season: fall back to his listed school's schedule.
      const school = opponentSchool(prospect.school, learned);
      teamIds = school ? [...t.teams.values()].filter((tm) => pffTeamSchool(tm) === school).map((tm) => tm.franchise_id) : [];
    }
    schedules.set(season, teamSchedule(teamIds, season, t.teams, t.games));
  }

  const decisions = matchGames(games, his, schedules, learned);
  for (const d of decisions) {
    if (d.status !== "not_charted" || !d.lookup || d.pffGameId == null) continue;
    const info = (await weekGames(client, d.lookup.season, d.lookup.week, d.lookup.teamId)).find((g) => g.id === d.pffGameId);
    if (info && !info.has_stats) d.note = `PFF hasn't charted this game. ${d.note}`;
    else if (info) d.note = `${d.note}; PFF charted the game, so he likely didn't play`;
  }
  return { prospectId: prospect.id, player, playerId, games: decisions };
}
