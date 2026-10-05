// ============================================================
// Matching charted prospects and games to PFF — pure, no I/O.
// ============================================================
// Players: PFF's directory search by name, then each name-matching candidate
// is checked against the charting itself: did he play the charted opponents
// in the charted seasons? That game log is the strongest evidence there is
// (it also follows transfers), so a candidate who played most of the charted
// games auto-links; a lone exact name + position + school does when there
// are no charted games to check. Anything weaker goes to the user ("review").
//
// Games: a charted game is (season, opponent). It is matched against HIS PFF
// games that season, not his current school's, so transfers just work. Two
// charted games against the same opponent in one season (a regular-season
// game and a CFP rematch) are paired by snap count and left for the user to
// confirm. A single charted game against a team he played twice is settled
// by snap count when it's clear (see snapPick). A charted game with no PFF
// row is split into
// "PFF has the game but no row for him" (not_charted) and "no such game on
// his team's PFF schedule" (no_match).
//
// PFF's NCAA week numbers aren't chronological after the regular season
// (2025: conference title games were week 17 on Dec 6, week 16 was Dec 13,
// bowls and the CFP 18–21, all-star games 30), so order comes from kickoff
// time and "postseason" is week 15 and later.
// ============================================================

import { opponentSchool, schoolByExactName } from "../scouting/opponentTier";
import type { PffGameMatchStatus, PffPlayerMatchStatus } from "../types";
import type { PffPlayer, PffScheduleGame, PffTeam, PffWeekRow } from "./ncaa";

/** First PFF NCAA week after the regular season. */
export const POSTSEASON_WEEK = 15;

// ── Names ────────────────────────────────────────────────────

const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g;

/** Lowercase, accents and apostrophes dropped, suffixes (Jr., III) removed. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type NameMatch = "exact" | "close" | "none";

/** exact = same name (spacing aside: "CJ" = "C.J."); close = same first
 *  initial and a shared last name ("Nick" / "Nicholas", "Ryan Williams" /
 *  "Ryan Coleman-Williams"); none otherwise. */
export function compareNames(prospectName: string, player: Pick<PffPlayer, "first_name" | "last_name">): NameMatch {
  const tokens = normalizeName(prospectName).split(" ").filter(Boolean);
  const first = normalizeName(player.first_name).replace(/ /g, "");
  const lastParts = normalizeName(player.last_name).split(" ").filter(Boolean);
  if (tokens.length === 0 || lastParts.length === 0) return "none";
  if (tokens.join("") === first + lastParts.join("")) return "exact";
  if (!first || tokens.length < 2 || tokens[0][0] !== first[0]) return "none";
  const prospectLast = tokens.slice(1);
  if (prospectLast.join("") === lastParts.join("")) return "close";
  return lastParts.some((l) => prospectLast.includes(l)) || prospectLast.some((l) => lastParts.includes(l)) ? "close" : "none";
}

// ── Positions ────────────────────────────────────────────────

// Directory positions are WR / TE / HB / QB; game rows add the spot (LWR,
// SWR, TE-L, …).
const POSITION_FIT: Record<string, RegExp> = {
  QB: /QB/,
  RB: /^(HB|RB|FB)/,
  WR: /WR$/,
  TE: /^TE/,
};

export function positionFits(prospectPosition: string, pffPosition: string | null | undefined): boolean {
  const re = POSITION_FIT[prospectPosition];
  return Boolean(re && pffPosition && re.test(pffPosition.toUpperCase()));
}

// ── Schools ──────────────────────────────────────────────────

// PFF school names CFD's team table doesn't carry (checked against PFF's 2025
// FBS + FCS list on 2026-10-04). PFF names are clean, so they're matched
// exactly: a typo match would turn "Mississippi" into Mississippi State.
const PFF_SCHOOL_ALIASES: Record<string, string> = {
  "Mississippi": "Ole Miss",
  "North Carolina State": "NC State",
  "San Jose State": "San José State",
  "Louisiana-Monroe": "UL Monroe",
  "Bryant University": "Bryant",
  "McNeese State": "McNeese",
  "Southern University": "Southern",
  "Southeastern Louisiana": "SE Louisiana",
  "UT Rio Grand Valley": "UT Rio Grande Valley",
  "Albany": "UAlbany",
};

/** CFD's name for a PFF team, or null. */
export function pffTeamSchool(team: Pick<PffTeam, "city"> | null | undefined): string | null {
  if (!team?.city) return null;
  return PFF_SCHOOL_ALIASES[team.city] ?? schoolByExactName(team.city);
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Does a charted opponent (free text) name this PFF team? */
export function opponentIsTeam(charted: string, team: Pick<PffTeam, "city"> | null | undefined): boolean {
  if (!team?.city) return false;
  const a = opponentSchool(charted);
  const b = pffTeamSchool(team);
  if (a && b) return a === b;
  // One side unrecognized: fall back to the bare names.
  return compact(charted) === compact(team.city);
}

// ── His games ────────────────────────────────────────────────

export interface HisGame {
  pffGameId: number;
  season: number;
  week: number;
  /** Kickoff (ISO); "" when the season schedule doesn't list the game. */
  start: string;
  teamId: number;
  opponentId: number;
  opponent: PffTeam | null;
  /** His PFF snaps in the game, counted the way the charting counts plays
   *  (see chartableSnaps); null on a schedule entry. */
  snaps: number | null;
}

/** His games in one season from his week-by-week rows. */
/**
 * His PFF snaps in a game, counted like the charting counts plays. Every snap
 * is charted for WR / RB / TE, but a QB's handoffs aren't, so a QB's count is
 * his pass plays plus his own runs. Checked on 2026-10-04 against the games
 * the matcher linked: charted plays were within a few of this on all 56 QB
 * games (charted minus PFF −5…+1, median −1) and equal on WR / RB games
 * (median ratio 1.00 over 93 games).
 */
export function chartableSnaps(row: PffWeekRow, position: string): number | null {
  const n = (k: string) => (typeof row[k] === "number" ? (row[k] as number) : null);
  if (position === "QB") {
    const pass = n("snap_counts_pass");
    const run = n("snap_counts_run");
    return pass == null && run == null ? null : (pass ?? 0) + (run ?? 0);
  }
  return n("snap_counts_total");
}

export function hisGames(
  rows: readonly PffWeekRow[],
  season: number,
  teams: ReadonlyMap<number, PffTeam>,
  schedule: readonly PffScheduleGame[] = [],
  /** The prospect's position, for counting snaps like the charting. */
  position = "",
): HisGame[] {
  const startById = new Map(schedule.map((g) => [g.id, g.start]));
  return rows.map((r) => {
    const teamId = r.player_franchise_id;
    const opponentId = teamId === r.home_franchise_id ? r.away_franchise_id : r.home_franchise_id;
    return {
      pffGameId: r.game_id, season, week: r.week, start: startById.get(r.game_id) ?? "",
      teamId, opponentId, opponent: teams.get(opponentId) ?? null,
      snaps: chartableSnaps(r, position),
    };
  });
}

/** Every game of the given teams in one season (his team's schedule). */
export function teamSchedule(
  teamIds: readonly number[],
  season: number,
  teams: ReadonlyMap<number, PffTeam>,
  schedule: readonly PffScheduleGame[],
): HisGame[] {
  const ids = new Set(teamIds);
  const out: HisGame[] = [];
  for (const g of schedule) {
    const teamId = ids.has(g.home_franchise_id) ? g.home_franchise_id : ids.has(g.away_franchise_id) ? g.away_franchise_id : null;
    if (teamId == null) continue;
    const opponentId = teamId === g.home_franchise_id ? g.away_franchise_id : g.home_franchise_id;
    out.push({ pffGameId: g.id, season, week: g.week, start: g.start, teamId, opponentId, opponent: teams.get(opponentId) ?? null, snaps: null });
  }
  return out;
}

const byKickoff = (a: HisGame, b: HisGame) => (a.start || "").localeCompare(b.start || "") || a.week - b.week;

// ── Charted games ────────────────────────────────────────────

export interface ChartedGame {
  id: string;
  season_year: number;
  opponent: string;
  game_type: string;
  game_slot: number;
  created_at: string;
  pff_game_id?: number | null;
  pff_match_status?: PffGameMatchStatus | null;
  /** Plays charted in the game (prospect_game_snap_stats), for telling rematches apart. */
  snaps_charted?: number | null;
}

const POSTSEASON_LABEL = /\b(cfp|ccg?|championship|title game|bowl|playoffs?|semifinal|quarterfinal)\b/i;

/** Marked as postseason by its game type or a tag in the opponent name ("Oregon CFP", "Alabama CC"). */
export function isPostseasonGame(g: Pick<ChartedGame, "opponent" | "game_type">): boolean {
  return g.game_type === "bowl" || g.game_type === "playoff" || POSTSEASON_LABEL.test(g.opponent);
}

/** The user's own calls; the matcher never overwrites them. */
export function isUserGameDecision(g: Pick<ChartedGame, "pff_match_status">): boolean {
  return g.pff_match_status === "confirmed" || g.pff_match_status === "none";
}

const byChartOrder = (a: ChartedGame, b: ChartedGame) =>
  a.game_slot - b.game_slot || a.created_at.localeCompare(b.created_at);

// ── Player decision ──────────────────────────────────────────

export interface ProspectForMatch {
  name: string;
  position: string;
  school: string;
  birthday: string | null;
}

export interface CandidateEvidence {
  player: PffPlayer;
  name: NameMatch;
  positionOk: boolean;
  /** Current school vs PFF's current team; null when either is unknown. */
  schoolOk: boolean | null;
  dob: "same" | "different" | "unknown";
  /** Charted games whose opponent he played that season. */
  gamesFound: number;
  /** Charted games in the seasons his log was fetched for. */
  gamesChecked: number;
}

export function candidateEvidence(
  prospect: ProspectForMatch,
  player: PffPlayer,
  games: readonly ChartedGame[],
  /** His games per season, for the seasons fetched; null when none were. */
  his: ReadonlyMap<number, readonly HisGame[]> | null,
): CandidateEvidence {
  const school = opponentSchool(prospect.school);
  const pffSchool = pffTeamSchool(player.team);
  let gamesFound = 0;
  let gamesChecked = 0;
  if (his) {
    for (const g of games) {
      const season = his.get(g.season_year);
      if (!season) continue;
      gamesChecked++;
      if (season.some((h) => opponentIsTeam(g.opponent, h.opponent))) gamesFound++;
    }
  }
  return {
    player,
    name: compareNames(prospect.name, player),
    positionOk: positionFits(prospect.position, player.position),
    schoolOk: school && pffSchool ? school === pffSchool : null,
    dob: prospect.birthday && player.dob ? (prospect.birthday === player.dob ? "same" : "different") : "unknown",
    gamesFound,
    gamesChecked,
  };
}

export interface PlayerDecision {
  status: Extract<PffPlayerMatchStatus, "auto" | "review" | "not_found">;
  playerId: number | null;
  note: string;
}

export function describePffPlayer(p: PffPlayer): string {
  return `${p.first_name} ${p.last_name} · ${p.position}${p.team?.city ? ` · ${p.team.city}` : ""} (PFF ${p.id})`;
}

function rank(e: CandidateEvidence): number[] {
  return [
    e.gamesFound,
    e.name === "exact" ? 1 : 0,
    e.dob === "same" ? 1 : e.dob === "different" ? -1 : 0,
    e.positionOk ? 1 : 0,
    e.schoolOk === true ? 1 : e.schoolOk === false ? -1 : 0,
  ];
}

function compareRank(a: CandidateEvidence, b: CandidateEvidence): number {
  const ra = rank(a), rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
  return 0;
}

function caveats(e: CandidateEvidence): string[] {
  const out: string[] = [];
  if (e.name === "close") out.push("name differs slightly");
  if (!e.positionOk) out.push(`PFF lists him at ${e.player.position}`);
  if (e.dob === "different") out.push(`birthday differs (PFF ${e.player.dob})`);
  if (e.schoolOk === false && e.player.team?.city) out.push(`PFF's current team is ${e.player.team.city}`);
  return out;
}

/**
 * Pick the PFF player for a prospect from the search candidates' evidence.
 * auto only on strong evidence; a plausible but unproven guess is review.
 */
export function decidePlayer(prospect: ProspectForMatch, evidence: readonly CandidateEvidence[]): PlayerDecision {
  const named = evidence.filter((e) => e.name !== "none").sort(compareRank);
  if (named.length === 0) {
    return { status: "not_found", playerId: null, note: `No PFF player named ${prospect.name}` };
  }
  const best = named[0];
  const who = describePffPlayer(best.player);
  const checked = named.some((e) => e.gamesChecked > 0);

  if (checked) {
    const withGames = named.filter((e) => e.gamesFound > 0);
    const coverage = best.gamesChecked ? best.gamesFound / best.gamesChecked : 0;
    const played = `played ${best.gamesFound} of ${best.gamesChecked} charted games`;
    // He played the charted games: that settles who he is, so a birthday or
    // position that disagrees with PFF is noted, not a reason to ask.
    const onlyOne = withGames.length === 1 && best.gamesFound > 0;
    const clean = best.name === "exact" && best.positionOk && best.dob !== "different" && coverage >= 0.5;
    const proven = coverage >= 0.75 && (best.name === "exact" || best.gamesFound >= 2 || best.schoolOk === true);
    if (onlyOne && (clean || proven)) {
      const notes = caveats(best);
      return { status: "auto", playerId: best.player.id, note: `${who}: ${played}${notes.length ? `; ${notes.join("; ")}` : ""}` };
    }
    if (best.gamesFound > 0) {
      const why = [
        withGames.length > 1 ? `${withGames.length} PFF players with this name played his charted opponents` : null,
        coverage < 0.5 ? "fewer than half his charted games found" : null,
        ...caveats(best),
      ].filter(Boolean).join("; ");
      return { status: "review", playerId: best.player.id, note: `${who}: ${played}${why ? `; ${why}` : ""}` };
    }
    if (best.name === "exact" && best.positionOk) {
      return {
        status: "review", playerId: best.player.id,
        note: `${who}: name and position fit, but none of his ${best.gamesChecked} charted games are in this player's PFF log`,
      };
    }
    return {
      status: "not_found", playerId: null,
      note: `${named.length} PFF player(s) named like ${prospect.name}, none at ${prospect.position} with his charted games`,
    };
  }

  // No charted games to check: name, position, school and birthday only.
  const exactPos = named.filter((e) => e.name === "exact" && e.positionOk && e.dob !== "different");
  if (exactPos.length === 1 && (exactPos[0].schoolOk === true || exactPos[0].dob === "same")) {
    const how = exactPos[0].dob === "same" ? "birthday" : "school";
    return { status: "auto", playerId: exactPos[0].player.id, note: `${describePffPlayer(exactPos[0].player)}: name, position and ${how} match (no charted games to check)` };
  }
  if (exactPos.length > 0) {
    const pick = exactPos[0];
    const why = exactPos.length > 1 ? `${exactPos.length} PFF players named ${prospect.name} at ${prospect.position}` : caveats(pick).join("; ") || "school unconfirmed";
    return { status: "review", playerId: pick.player.id, note: `${describePffPlayer(pick.player)}: ${why}` };
  }
  if (best.positionOk) {
    return { status: "review", playerId: best.player.id, note: `${who}: ${caveats(best).join("; ") || "unconfirmed"}` };
  }
  return { status: "not_found", playerId: null, note: `No PFF ${prospect.position} named ${prospect.name} (${named.length} at other positions)` };
}

// ── Game decisions ───────────────────────────────────────────

export interface GameDecision {
  gameId: string;
  status: Extract<PffGameMatchStatus, "auto" | "review" | "not_charted" | "no_match" | "no_player">;
  pffGameId: number | null;
  note: string;
  /** For a not_charted game on his team's schedule: where to ask PFF whether it charted it. */
  lookup?: { season: number; week: number; teamId: number };
}

const teamName = (h: HisGame) => h.opponent?.city ?? `team ${h.opponentId}`;

/** A charted game's play count clearly names one of these games: close to
 *  it, and clearly off every other. Otherwise null, and the user decides.
 *  Lopsided on purpose: the user skips the odd play (a Hail Mary, say), so a
 *  charted count can run a few under PFF's snaps but barely over them. */
export function snapPick(charted: number | null | undefined, fits: readonly HisGame[]): HisGame | null {
  if (!charted || fits.some((h) => h.snaps == null)) return null;
  const under = Math.max(3, Math.round(charted * 0.06));
  const over = 2;
  const far = Math.max(5, Math.round(charted * 0.1));
  const close = fits.filter((h) => h.snaps! - charted <= under && charted - h.snaps! <= over);
  if (close.length !== 1) return null;
  return fits.every((h) => h === close[0] || Math.abs(h.snaps! - charted) >= far) ? close[0] : null;
}

const snapText = (g: ChartedGame, fits: readonly HisGame[]) =>
  g.snaps_charted && fits.every((h) => h.snaps != null)
    ? ` Charted ${g.snaps_charted} plays; PFF snaps ${fits.map((h) => `${h.snaps} (week ${h.week})`).join(", ")}.`
    : "";
const fmtDate = (iso: string) => (iso ? iso.slice(0, 10) : "");
const describeGame = (h: HisGame) => `week ${h.week}${h.start ? ` (${fmtDate(h.start)})` : ""} vs ${teamName(h)}`;

/** Every charted game of an unlinked prospect, except the user's own calls. */
export function noPlayerGames(games: readonly ChartedGame[], note: string): GameDecision[] {
  return games.filter((g) => !isUserGameDecision(g)).map((g) => ({ gameId: g.id, status: "no_player", pffGameId: null, note }));
}

/**
 * Match a linked player's charted games to his PFF games.
 * `his` = his games per season; `schedules` = his team's whole PFF schedule
 * per season (to tell "no row for him" from "no such game"). Games the user
 * confirmed or ruled out are left alone, and their PFF games aren't reused.
 */
export function matchGames(
  games: readonly ChartedGame[],
  his: ReadonlyMap<number, readonly HisGame[]>,
  schedules: ReadonlyMap<number, readonly HisGame[]>,
): GameDecision[] {
  const taken = new Set(games.filter(isUserGameDecision).map((g) => g.pff_game_id).filter((id): id is number => id != null));
  const open = games.filter((g) => !isUserGameDecision(g));
  const out: GameDecision[] = [];

  for (const season of [...new Set(open.map((g) => g.season_year))].sort()) {
    const charted = open.filter((g) => g.season_year === season).sort(byChartOrder);
    const mine = (his.get(season) ?? []).filter((h) => !taken.has(h.pffGameId)).sort(byKickoff);
    const groups = new Map<string, { charted: ChartedGame[]; fits: HisGame[] }>();

    for (const g of charted) {
      const fits = mine.filter((h) => opponentIsTeam(g.opponent, h.opponent));
      if (fits.length === 0) {
        out.push(unmatchedGame(g, season, schedules.get(season) ?? [], taken, his.has(season) && mine.length > 0));
        continue;
      }
      const key = fits.map((h) => h.pffGameId).join(",");
      const group = groups.get(key) ?? { charted: [], fits };
      group.charted.push(g);
      groups.set(key, group);
    }

    for (const { charted: cs, fits } of groups.values()) {
      if (cs.length === 1) {
        out.push(singleGame(cs[0], fits, season));
        continue;
      }
      // Two or more charted games vs the same opponent this season (the
      // user confirms these by hand): pair each with the game whose snaps it
      // matches, else by order (labelled postseason games last).
      const bySnaps = pairBySnaps(cs, fits);
      const pairs = bySnaps
        ?? [...cs].sort((a, b) => Number(isPostseasonGame(a)) - Number(isPostseasonGame(b)) || byChartOrder(a, b))
          .map((g, i) => [g, fits[i] ?? null] as const);
      const how = bySnaps ? "paired by snap count" : "paired by game order";
      for (const [g, h] of pairs) {
        out.push({
          gameId: g.id, status: "review", pffGameId: h?.pffGameId ?? null,
          note: h
            ? `${cs.length} charted games vs ${teamName(fits[0])} in ${season}; ${how}: ${describeGame(h)}.${snapText(g, fits)} Confirm.`
            : `${cs.length} charted games vs ${teamName(fits[0])} in ${season} but PFF has only ${fits.length}`,
        });
      }
    }
  }
  return out;
}

/** Each charted game to a distinct PFF game, when snap counts settle every pair. */
function pairBySnaps(cs: readonly ChartedGame[], fits: readonly HisGame[]): (readonly [ChartedGame, HisGame])[] | null {
  const pairs: (readonly [ChartedGame, HisGame])[] = [];
  for (const g of cs) {
    const h = snapPick(g.snaps_charted, fits);
    if (!h) return null;
    pairs.push([g, h]);
  }
  return new Set(pairs.map(([, h]) => h)).size === pairs.length ? pairs : null;
}

function singleGame(g: ChartedGame, fits: HisGame[], season: number): GameDecision {
  if (fits.length === 1) return { gameId: g.id, status: "auto", pffGameId: fits[0].pffGameId, note: describeGame(fits[0]) };
  // He played this opponent more than once (a rematch). The snap count
  // settles it when it's clear; else a postseason label does when exactly
  // one of the games is postseason; else the user picks.
  const twice = `played ${teamName(fits[0])} ${fits.length} times in ${season}`;
  const bySnaps = snapPick(g.snaps_charted, fits);
  if (bySnaps) {
    return { gameId: g.id, status: "auto", pffGameId: bySnaps.pffGameId, note: `${describeGame(bySnaps)} (${twice}; matched by snap count).${snapText(g, fits)}` };
  }
  const post = fits.filter((h) => h.week >= POSTSEASON_WEEK);
  const regular = fits.filter((h) => h.week < POSTSEASON_WEEK);
  if (isPostseasonGame(g)) {
    if (post.length === 1) return { gameId: g.id, status: "auto", pffGameId: post[0].pffGameId, note: `${describeGame(post[0])} (postseason; ${twice})` };
    const pick = fits[fits.length - 1];
    return { gameId: g.id, status: "review", pffGameId: pick.pffGameId, note: `${twice}; picked the latest, ${describeGame(pick)}.${snapText(g, fits)} Confirm.` };
  }
  const pick = regular[0] ?? fits[0];
  return {
    gameId: g.id, status: "review", pffGameId: pick.pffGameId,
    note: `${twice}; snap counts don't settle it, so picked ${describeGame(pick)}.${snapText(g, fits)} Confirm.`,
  };
}

function unmatchedGame(
  g: ChartedGame,
  season: number,
  schedule: readonly HisGame[],
  taken: ReadonlySet<number>,
  hasRows: boolean,
): GameDecision {
  const onSchedule = schedule.filter((s) => !taken.has(s.pffGameId) && opponentIsTeam(g.opponent, s.opponent)).sort(byKickoff);
  if (onSchedule.length > 0) {
    const s = onSchedule[0];
    const why = hasRows ? `PFF has no row for him in ${describeGame(s)}` : `PFF has no ${season} rows for him; his team played ${describeGame(s)}`;
    return {
      gameId: g.id, status: "not_charted", pffGameId: onSchedule.length === 1 ? s.pffGameId : null, note: why,
      lookup: { season, week: s.week, teamId: s.teamId },
    };
  }
  const known = opponentSchool(g.opponent);
  const note = !known
    ? `Couldn't read the opponent "${g.opponent}"`
    : hasRows || schedule.length > 0
      ? `No ${season} game vs ${known} in his PFF log or his team's schedule`
      : `PFF has no ${season} games for him`;
  return { gameId: g.id, status: "no_match", pffGameId: null, note };
}
