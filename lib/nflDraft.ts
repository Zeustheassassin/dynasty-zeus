// NFL draft results (CollegeFootballData /draft/picks, cached in
// cfd_draft_picks by migration 090): the row shape, team names, positions,
// and matching picks to the user's prospects. Shared by the loader route and
// the Big Board (Dynasty+ rookie competition, the Post-Draft tab).

import { normalizeRookieName } from "./helpers/formatting";

/** One stored pick (a cfd_draft_picks row). */
export interface DraftPickRow {
  year: number;
  overall: number;
  round: number;
  pick: number;
  nfl_team_id: number | null;
  /** Nickname, e.g. "Eagles": the style prospects.draft_team uses. */
  nfl_team: string;
  /** CFD's position, e.g. "Wide Receiver". */
  position: string;
  name: string;
  college: string | null;
}

/** A prospect's actual draft result, written by the Post-Draft tab. */
export interface DraftResultUpdate {
  id: string;
  draft_round: number;
  draft_pick: number | null;
  draft_team: string | null;
}

/** POST /api/scouting/nfl-draft's answer. */
export interface NflDraftResponse {
  picks: DraftPickRow[];
  /** CollegeFootballData was called this time. */
  fetched: boolean;
  /** CFD's calls left this month, when it was called. */
  remaining: number | null;
}

/** The fields of a CFD /draft/picks item the cache keeps. */
export interface CfdDraftPick {
  year?: number;
  overall?: number;
  round?: number;
  pick?: number;
  nflTeamId?: number | null;
  /** A city ("New York", "Los Angeles"), so the id decides the team. */
  nflTeam?: string | null;
  position?: string | null;
  name?: string | null;
  collegeTeam?: string | null;
}

// CFD's nflTeamId is ESPN's team id (checked on the 2026 draft: 13 = Las
// Vegas, 19 and 20 = the two New York teams, 14 and 24 = the two LA teams).
export const NFL_TEAMS: Record<number, { nickname: string; abbr: string[] }> = {
  1: { nickname: "Falcons", abbr: ["ATL"] },
  2: { nickname: "Bills", abbr: ["BUF"] },
  3: { nickname: "Bears", abbr: ["CHI"] },
  4: { nickname: "Bengals", abbr: ["CIN"] },
  5: { nickname: "Browns", abbr: ["CLE"] },
  6: { nickname: "Cowboys", abbr: ["DAL"] },
  7: { nickname: "Broncos", abbr: ["DEN"] },
  8: { nickname: "Lions", abbr: ["DET"] },
  9: { nickname: "Packers", abbr: ["GB", "GNB"] },
  10: { nickname: "Titans", abbr: ["TEN"] },
  11: { nickname: "Colts", abbr: ["IND"] },
  12: { nickname: "Chiefs", abbr: ["KC", "KAN"] },
  13: { nickname: "Raiders", abbr: ["LV", "LVR", "OAK"] },
  14: { nickname: "Rams", abbr: ["LAR", "LA"] },
  15: { nickname: "Dolphins", abbr: ["MIA"] },
  16: { nickname: "Vikings", abbr: ["MIN"] },
  17: { nickname: "Patriots", abbr: ["NE", "NWE"] },
  18: { nickname: "Saints", abbr: ["NO", "NOR"] },
  19: { nickname: "Giants", abbr: ["NYG"] },
  20: { nickname: "Jets", abbr: ["NYJ"] },
  21: { nickname: "Eagles", abbr: ["PHI"] },
  22: { nickname: "Cardinals", abbr: ["ARI"] },
  23: { nickname: "Steelers", abbr: ["PIT"] },
  24: { nickname: "Chargers", abbr: ["LAC"] },
  25: { nickname: "49ers", abbr: ["SF", "SFO"] },
  26: { nickname: "Seahawks", abbr: ["SEA"] },
  27: { nickname: "Buccaneers", abbr: ["TB", "TAM"] },
  28: { nickname: "Commanders", abbr: ["WAS", "WSH"] },
  29: { nickname: "Panthers", abbr: ["CAR"] },
  30: { nickname: "Jaguars", abbr: ["JAX", "JAC"] },
  33: { nickname: "Ravens", abbr: ["BAL"] },
  34: { nickname: "Texans", abbr: ["HOU"] },
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The ESPN team id for a team as the user or CFD wrote it: a nickname
 * ("Eagles"), an abbreviation ("PHI"), or a full name ("Philadelphia Eagles").
 * Null for a bare city or anything unknown.
 */
export function nflTeamId(team: string | null | undefined): number | null {
  if (!team) return null;
  const t = squash(team);
  if (!t) return null;
  for (const [id, info] of Object.entries(NFL_TEAMS)) {
    if (t === squash(info.nickname) || info.abbr.some((a) => t === squash(a))) return Number(id);
  }
  for (const [id, info] of Object.entries(NFL_TEAMS)) {
    if (t.endsWith(squash(info.nickname))) return Number(id);
  }
  return null;
}

/** CFD's position names for the four fantasy positions. Everything else is null. */
export function draftSkillPosition(position: string | null | undefined): "QB" | "RB" | "WR" | "TE" | null {
  switch ((position ?? "").trim().toLowerCase()) {
    case "quarterback": case "qb": return "QB";
    case "running back": case "rb": return "RB";
    case "wide receiver": case "wr": return "WR";
    case "tight end": case "te": return "TE";
    default: return null;
  }
}

/** A CFD pick as a cache row; null when a field the board needs is missing. */
export function toDraftPickRow(p: CfdDraftPick): DraftPickRow | null {
  if (p.year == null || p.overall == null || p.round == null || p.pick == null || !p.name || !p.position) return null;
  const id = p.nflTeamId ?? null;
  const team = (id != null ? NFL_TEAMS[id]?.nickname : null) ?? p.nflTeam ?? null;
  if (!team) return null;
  return {
    year: p.year, overall: p.overall, round: p.round, pick: p.pick,
    nfl_team_id: id, nfl_team: team, position: p.position, name: p.name.trim(), college: p.collegeTeam?.trim() || null,
  };
}

/** Is a year's stored list the whole draft? Round 7 starts once the first six are in. */
export function isCompleteDraft(rows: readonly Pick<DraftPickRow, "round">[]): boolean {
  return rows.some((r) => r.round >= 7);
}

export interface MatchableProspect {
  id: string;
  name: string;
  school: string | null;
  position: string;
  draft_class_year: number | null;
}

/**
 * Each prospect's pick in his class's draft, by name (suffixes and punctuation
 * dropped, normalizeRookieName). Two picks with his name: the one from his
 * school, else the one at his position, else none. A pick goes to one prospect
 * at most; when two prospects claim it, neither gets it.
 */
export function matchDraftPicks(
  prospects: readonly MatchableProspect[], picks: readonly DraftPickRow[],
): Map<string, DraftPickRow> {
  const byName = new Map<string, DraftPickRow[]>();
  for (const pk of picks) {
    const k = `${pk.year}|${normalizeRookieName(pk.name)}`;
    const list = byName.get(k);
    if (list) list.push(pk); else byName.set(k, [pk]);
  }
  const claims = new Map<string, string[]>(); // "year|overall" → prospect ids
  const found = new Map<string, DraftPickRow>();
  for (const p of prospects) {
    if (p.draft_class_year == null) continue;
    let cands = byName.get(`${p.draft_class_year}|${normalizeRookieName(p.name)}`) ?? [];
    if (cands.length > 1 && p.school) {
      const school = squash(p.school);
      const same = cands.filter((c) => c.college && squash(c.college) === school);
      if (same.length) cands = same;
    }
    if (cands.length > 1) {
      const same = cands.filter((c) => draftSkillPosition(c.position) === p.position);
      if (same.length) cands = same;
    }
    if (cands.length !== 1) continue;
    const key = `${cands[0].year}|${cands[0].overall}`;
    claims.set(key, [...(claims.get(key) ?? []), p.id]);
    found.set(p.id, cands[0]);
  }
  for (const ids of claims.values()) if (ids.length > 1) for (const id of ids) found.delete(id);
  return found;
}

const SKILL_POS = new Set(["QB", "RB", "WR", "TE"]);

export interface DraftedProspect extends MatchableProspect {
  draft_round: number | null;
  draft_pick: number | null;
  draft_team: string | null;
}

/** What applying a class's draft would change: matched QB/RB/WR/TE prospects whose round, pick or team differ. */
export function draftChanges<P extends DraftedProspect>(
  prospects: readonly P[], picks: readonly DraftPickRow[], year: number,
): { p: P; update: DraftResultUpdate }[] {
  const pool = prospects.filter((p) => p.draft_class_year === year && SKILL_POS.has(p.position));
  const matched = matchDraftPicks(pool, picks.filter((pk) => pk.year === year));
  const out: { p: P; update: DraftResultUpdate }[] = [];
  for (const p of pool) {
    const pk = matched.get(p.id);
    if (!pk) continue;
    if (p.draft_round === pk.round && p.draft_pick === pk.overall && p.draft_team === pk.nfl_team) continue;
    out.push({ p, update: { id: p.id, draft_round: pk.round, draft_pick: pk.overall, draft_team: pk.nfl_team } });
  }
  return out;
}
