// Opponent strength for a charted game: the opponent's tier (P4 / G5 / FCS)
// in that season, read from the free-text `scouting_games.opponent`. It feeds
// the opponent-aware difficulty models behind the AE Score (aeComposite.ts).
// Each rep is judged against the competition it came against, not the
// prospect's own school, so four games against Ohio State, Illinois, Georgia
// and LSU count as P4 reps wherever the prospect plays.
//
// Matching, in order: drop tags people add ("Miami - CFP", "Alabama CC",
// "Georgia SEC Championship"), then an exact match on any of the team's
// names, then the ALIASES below, then the names the user taught by linking
// games to PFF (learnOpponents), then a one- or two-letter typo match when
// exactly one team is that close ("Flordia State", "South Flordia"). A game
// whose name still doesn't match takes the opponent of the PFF game it's
// linked to. Anything left is null: that game carries no opponent effect, and
// the Big Board lists it so the name can be fixed. Teams and tiers:
// opponentTierData.ts, generated from CollegeFootballData.

import { OPPONENT_TEAMS, TIER_SEASONS, type TierCode } from "./opponentTierData";

export type OpponentTier = TierCode;
export const OPPONENT_TIERS: readonly OpponentTier[] = ["P4", "G5", "FCS"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Trailing tags for the game, not the team.
const TAG = /[\s\-–(]*(cfp|ccg|cc|((sec|big ten|big 12|acc|aac|american|mac|sun belt|mountain west|c-?usa|pac-12)\s+)?(conference\s+)?championship( game)?|title game|bowl game|playoffs?|semifinal|quarterfinal)\)?\s*$/i;
function stripTags(s: string): string {
  let out = s.trim();
  for (let prev = ""; prev !== out; ) { prev = out; out = out.replace(TAG, "").trim(); }
  return out;
}

// Names seen in charting that aren't among CFD's names for the team.
const ALIASES: Record<string, string> = {
  southantonio: "UTSA",
  utsanantonio: "UTSA",
  louisianalafayette: "Louisiana",
  northcarolinastate: "NC State",
  ullafayette: "Louisiana",
  latech: "Louisiana Tech",
  floridaatlanticuniversity: "Florida Atlantic",
};

// Every name a team goes by (aliases included, so their typos match too).
const bySchool = new Map(OPPONENT_TEAMS.map((t) => [t.s, t]));
const byName = new Map<string, (typeof OPPONENT_TEAMS)[number]>();
for (const t of OPPONENT_TEAMS) for (const n of [t.s, ...t.a]) if (!byName.has(norm(n))) byName.set(norm(n), t);
for (const [alias, school] of Object.entries(ALIASES)) {
  const t = bySchool.get(school);
  if (t && !byName.has(alias)) byName.set(alias, t);
}

// Optimal string alignment distance (a swap of two neighbours counts as one).
function typoDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Opponent names the user taught by linking games to PFF: the typed name
 *  (tags, case and punctuation dropped) → the school. See learnOpponents. */
export type LearnedNames = ReadonlyMap<string, string>;

type Team = (typeof OPPONENT_TEAMS)[number];

const nameKey = (opponent: string) => norm(stripTags(opponent));

function findTeam(opponent: string, learned?: LearnedNames): Team | null {
  const k = nameKey(opponent);
  if (!k) return null;
  const exact = byName.get(k);
  if (exact) return exact;
  const taught = learned?.get(k);
  if (taught && bySchool.has(taught)) return bySchool.get(taught)!;
  if (k.length < 6) return null;
  let best: Team | null = null;
  let bestD = 3;
  let tie = false;
  for (const [name, team] of byName) {
    if (Math.abs(name.length - k.length) > 2) continue;
    const dist = typoDistance(k, name);
    if (dist < bestD) { best = team; bestD = dist; tie = false; }
    else if (dist === bestD && team !== best) tie = true;
  }
  return best && !tie ? best : null;
}

/** The school (CFD's name) a charted opponent resolves to: tags dropped,
 *  aliases, learned names and small typos allowed. null when the name isn't recognized. */
export function opponentSchool(opponent: string | null | undefined, learned?: LearnedNames): string | null {
  return opponent ? findTeam(opponent, learned)?.s ?? null : null;
}

/** Exact names and aliases only, no typo matching: for clean names from
 *  another source (PFF), where a near-miss could be a different school
 *  ("Mississippi" is two letters from "Mississippi St"). */
export function schoolByExactName(name: string | null | undefined): string | null {
  return name ? byName.get(norm(name))?.s ?? null : null;
}

function teamTier(team: Team | null | undefined, season: number): OpponentTier | null {
  if (!team) return null;
  if (typeof team.t === "string") return team.t;
  // Seasons outside the table use the nearest one listed.
  const nearest = [...TIER_SEASONS].sort((a, b) => Math.abs(a - season) - Math.abs(b - season));
  for (const s of nearest) if (team.t[s]) return team.t[s]!;
  return null;
}

/** The opponent's tier in that season; null when the name isn't recognized. */
export function opponentTier(opponent: string | null | undefined, season: number, learned?: LearnedNames): OpponentTier | null {
  return opponent ? teamTier(findTeam(opponent, learned), season) : null;
}

// ── Names learned from PFF links ─────────────────────────────

/** What the user's PFF links say about opponent names the tables can't read. */
export interface LearnedOpponents {
  /** game id → the school of the PFF game it's linked to. */
  byGame: ReadonlyMap<string, string>;
  /** Every such typed name → its school, for the user's other games. */
  byName: LearnedNames;
}

export const NO_LEARNED_OPPONENTS: LearnedOpponents = { byGame: new Map(), byName: new Map() };

const LINKED = new Set(["auto", "confirmed"]);

/**
 * The opponent names the user taught by linking charted games to PFF (most
 * often by picking the game by hand in PFF Links): a linked game whose typed
 * opponent isn't recognized, and whose game context (migration 065) names the
 * PFF game's opponent. That game takes the PFF opponent, and the typed name
 * reads as that school on every other game too, so the next game typed the
 * same way is recognized and matches PFF on its own. Unlinking the game
 * forgets the name. A name linked to two different schools is left out.
 */
export function learnOpponents(
  games: readonly { id: string; opponent: string | null; pff_game_id?: number | null; pff_match_status?: string | null }[],
  contextRows: readonly { game_id: string; opponent_school: string | null }[],
): LearnedOpponents {
  const linkedSchool = new Map(contextRows.filter((r) => r.opponent_school && bySchool.has(r.opponent_school)).map((r) => [r.game_id, r.opponent_school!]));
  const byGame = new Map<string, string>();
  const byName = new Map<string, string>();
  const clashing = new Set<string>();
  for (const g of games) {
    const school = linkedSchool.get(g.id);
    if (!school || !g.opponent || g.pff_game_id == null || !LINKED.has(g.pff_match_status ?? "")) continue;
    if (findTeam(g.opponent)) continue;
    byGame.set(g.id, school);
    const k = nameKey(g.opponent);
    if (!k) continue;
    if (byName.has(k) && byName.get(k) !== school) clashing.add(k);
    byName.set(k, school);
  }
  for (const k of clashing) byName.delete(k);
  return { byGame, byName };
}

export interface GameTiers {
  /** game id → its opponent's tier, for recognized opponents. */
  byGame: Map<string, OpponentTier>;
  /** Opponent names that couldn't be matched, with how many games each. */
  unrecognized: Map<string, number>;
}

/** Each game's opponent tier: its typed name first, then the PFF game it's linked to, then the learned names. */
export function tierGames(
  games: readonly { id: string; opponent: string | null; season_year: number }[],
  learned: LearnedOpponents = NO_LEARNED_OPPONENTS,
): GameTiers {
  const byGame = new Map<string, OpponentTier>();
  const unrecognized = new Map<string, number>();
  for (const g of games) {
    const taught = learned.byGame.get(g.id) ?? (g.opponent ? learned.byName.get(nameKey(g.opponent)) : undefined);
    const team = (g.opponent ? findTeam(g.opponent) : null) ?? (taught ? bySchool.get(taught) : null);
    const t = teamTier(team, g.season_year);
    if (t) byGame.set(g.id, t);
    else if (g.opponent?.trim()) unrecognized.set(g.opponent.trim(), (unrecognized.get(g.opponent.trim()) ?? 0) + 1);
  }
  return { byGame, unrecognized };
}
