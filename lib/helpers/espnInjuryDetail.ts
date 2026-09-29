// ============================================================
// ESPN per-player injury detail — the pure half of /api/injuries/detail.
//
// ESPN's league-wide injury feed (/api/injuries/espn) keeps only the 25 newest
// reports per team, so long-term IR players fall off it. The per-athlete core
// endpoint has every current record — injury type, side, "Strain"/"Surgery",
// a projected return date, and the beat-writer news blurb — but needs ESPN's
// athlete id, and Sleeper's `espn_id` is empty for most players. So the route
// resolves the id by name against ESPN's fantasy player list (matchEspnAthlete)
// and then fetches that one player's record. No key, no cost.
// ============================================================
import { normalizeProjName } from "./scoring";

/** ESPN fantasy proTeamId → NFL abbreviation (Sleeper's spelling). 0 = free
 *  agent / practice squad, which the matcher treats as "team unknown".
 *  Checked 2026-09 against 586 uniquely-named players: every non-zero id agreed
 *  with Sleeper's team. */
export const ESPN_TEAM_BY_ID: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
  25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};

/** ESPN fantasy defaultPositionId → the Sleeper positions it can stand for. */
const ESPN_POSITIONS: Record<number, readonly string[]> = {
  1: ["QB"], 2: ["RB"], 3: ["WR"], 4: ["TE"], 5: ["K"],
  9: ["DL", "DT"], 10: ["DL", "DE"], 11: ["LB"], 12: ["DB", "CB"], 13: ["DB", "S"],
};

/** One row of ESPN's fantasy player list (`view=players_wl`). */
export interface EspnListPlayer {
  id: number;
  fullName?: string;
  lastName?: string;
  proTeamId?: number;
  defaultPositionId?: number;
}

export interface AthleteQuery {
  name: string;
  team?: string | null;
  position?: string | null;
  lastName?: string | null;
}

const posOk = (p: EspnListPlayer, position?: string | null): boolean => {
  if (!position) return true;
  const allowed = ESPN_POSITIONS[p.defaultPositionId ?? -1];
  return !allowed || allowed.includes(position.toUpperCase());
};
// Team 0 / unmapped = unknown, which never rules a player out.
const teamOf = (p: EspnListPlayer): string | null => ESPN_TEAM_BY_ID[p.proTeamId ?? 0] ?? null;
const sameTeam = (p: EspnListPlayer, team?: string | null): boolean =>
  !team || !teamOf(p) || teamOf(p) === team.toUpperCase();

/**
 * The ESPN athlete id for a Sleeper player, or null when there's no single
 * confident match. Full name first (position must fit; team breaks ties), then
 * last name + team + position for nickname cases — Marquise "Hollywood" Brown.
 * Measured 2026-09: 161 of 175 injured skill players matched; the misses were
 * practice-squad names ESPN doesn't carry.
 */
export function matchEspnAthlete(list: EspnListPlayer[], q: AthleteQuery): number | null {
  const want = normalizeProjName(q.name);
  if (!want) return null;
  let hits = list.filter((p) => normalizeProjName(p.fullName ?? "") === want && posOk(p, q.position));
  if (hits.length > 1) hits = hits.filter((p) => sameTeam(p, q.team));
  if (hits.length === 1) return hits[0].id;
  if (hits.length > 1) return null;

  // Nickname fallback needs a real team to be safe.
  const last = normalizeProjName(q.lastName ?? q.name.trim().split(/\s+/).slice(-1)[0] ?? "");
  if (!last || !q.team) return null;
  const byLast = list.filter((p) =>
    normalizeProjName(p.lastName ?? "") === last && teamOf(p) === q.team!.toUpperCase() && posOk(p, q.position),
  );
  return byLast.length === 1 ? byLast[0].id : null;
}

/** What /api/injuries/detail returns for one player. */
export interface InjuryDetail {
  found: boolean;
  /** Season the record came from (drives "rest of the regular season"). */
  season?: number;
  /** ESPN status: "Injured Reserve", "Out", "Questionable", "Day-To-Day", … */
  status?: string | null;
  /** ESPN fantasy status abbreviation: "IR", "IR-R", "PUP-R", "O", … */
  fantasyStatus?: string | null;
  /** When ESPN last updated this record (ISO). */
  date?: string | null;
  type?: string | null;
  side?: string | null;
  detail?: string | null;
  /** Projected return, YYYY-MM-DD — ESPN's estimate, often absent. */
  returnDate?: string | null;
  shortComment?: string | null;
  longComment?: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

/**
 * ESPN's news blurbs occasionally carry a mangled link — seen 2026-09:
 * `…loss to https://www.palmbeachpost.com/…/91989229007/"&gt;Hal Habib of…`.
 * Decode entities, drop tags and URL remnants, tidy spacing. Plain text out.
 */
export function cleanEspnComment(text: string | null | undefined): string | null {
  if (!text) return null;
  const out = text
    .replace(/&(#39|[a-z]+);/gi, (m, k: string) => ENTITIES[k.toLowerCase()] ?? m)
    .replace(/<[^>]*>/g, "")
    .replace(/https?:\/\/\S*?(?:\\?"\s*>|\s|$)/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out || null;
}

interface EspnInjuryItem {
  status?: string;
  date?: string;
  shortComment?: string;
  longComment?: string;
  details?: {
    fantasyStatus?: { abbreviation?: string };
    type?: string;
    side?: string;
    detail?: string;
    returnDate?: string;
  };
}

/** The newest record in a per-athlete injuries response, slimmed. ESPN keeps
 *  one current record per player in practice; picking by date is a guard. */
export function toInjuryDetail(items: EspnInjuryItem[] | undefined, season: number): InjuryDetail {
  const latest = [...(items ?? [])].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
  if (!latest) return { found: false };
  const d = latest.details ?? {};
  const clean = (v?: string) => (v && v.trim() && v !== "Not Specified" ? v.trim() : null);
  return {
    found: true,
    season,
    status: clean(latest.status),
    fantasyStatus: clean(d.fantasyStatus?.abbreviation),
    date: latest.date ?? null,
    type: clean(d.type),
    side: clean(d.side),
    detail: clean(d.detail),
    returnDate: /^\d{4}-\d{2}-\d{2}$/.test(d.returnDate ?? "") ? d.returnDate! : null,
    shortComment: cleanEspnComment(latest.shortComment),
    longComment: cleanEspnComment(latest.longComment),
  };
}

/** NFL season a date falls in: January and February belong to the prior season. */
export function seasonForDate(now: Date): number {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() < 2 ? y - 1 : y;
}
