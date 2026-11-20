// Scouting → Unwatched: logged games with no charted plays yet. A logged game
// counts in a prospect's games total (the "8G" on his prospect row, the hub
// header's games) from the moment it's added, charted or not, so a prospect can
// read as 8 games when only 6 have plays. This lists the games behind the gap.
//
// "Charted" = at least one play on the game, in whichever of the four play
// tables its position uses (prospect_game_snap_stats, migration 022). Client-safe,
// no I/O.

import type { Prospect, ScoutingGame } from "../types";

export interface GameSnapCount {
  game_id: string;
  snaps_charted: number;
}

type GroupProspect = Pick<Prospect, "id" | "name" | "position" | "draft_class_year" | "personal_rank" | "board_scores">;

export interface UnwatchedGroup<P extends GroupProspect> {
  prospect: P;
  /** His logged games with no charted plays, oldest season first, then by slot. */
  games: ScoutingGame[];
  /** All his logged games, charted or not (the games total the rest of the hub shows). */
  logged: number;
}

/** The Dynasty Score the Big Board last saved for him (prospects.board_scores), or null. */
export function unwatchedDynasty(p: Pick<Prospect, "board_scores">): number | null {
  const v = p.board_scores?.dynasty;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * One group per prospect with at least one unwatched game: class, then the
 * prospects with no Dynasty Score yet (no eyes on them, so they're watched
 * first), then the Big Board's Dynasty Score, highest first; ties by his rank
 * (unranked last), then name. Positions mix, as on the Big Board's Dynasty sort.
 * A game missing from `snapCounts` counts as unwatched (the view has a row for
 * every logged game, so that's only a game logged between the two reads). Games
 * whose prospect isn't in `prospects` are skipped.
 */
export function unwatchedByProspect<P extends GroupProspect>(
  games: readonly ScoutingGame[],
  snapCounts: readonly GameSnapCount[],
  prospects: readonly P[],
): UnwatchedGroup<P>[] {
  const snaps = new Map(snapCounts.map((r) => [r.game_id, r.snaps_charted]));
  const byId = new Map(prospects.map((p) => [p.id, p]));
  const groups = new Map<string, UnwatchedGroup<P>>();
  const logged = new Map<string, number>();

  for (const g of games) {
    const prospect = byId.get(g.prospect_id);
    if (!prospect) continue;
    logged.set(prospect.id, (logged.get(prospect.id) ?? 0) + 1);
    if ((snaps.get(g.id) ?? 0) > 0) continue;
    const group = groups.get(prospect.id) ?? { prospect, games: [], logged: 0 };
    group.games.push(g);
    groups.set(prospect.id, group);
  }

  const out = [...groups.values()];
  for (const group of out) {
    group.logged = logged.get(group.prospect.id) ?? group.games.length;
    group.games.sort((a, b) => a.season_year - b.season_year || a.game_slot - b.game_slot);
  }
  return out.sort((a, b) => {
    const da = unwatchedDynasty(a.prospect), db = unwatchedDynasty(b.prospect);
    return a.prospect.draft_class_year - b.prospect.draft_class_year
      || (da == null ? 0 : 1) - (db == null ? 0 : 1)
      || (da != null && db != null ? db - da : 0)
      || (a.prospect.personal_rank ?? Infinity) - (b.prospect.personal_rank ?? Infinity)
      || a.prospect.name.localeCompare(b.prospect.name);
  });
}

/**
 * Each prospect's charted games (at least one play), keyed by prospect id, for
 * the Prospects lists' "6/8G" (charted / logged). Charted exactly as above, so
 * logged minus charted is his Unwatched count. Prospects with none are absent.
 */
export function chartedGamesByProspect(
  games: readonly Pick<ScoutingGame, "id" | "prospect_id">[],
  snapCounts: readonly GameSnapCount[],
): Map<string, number> {
  const snaps = new Map(snapCounts.map((r) => [r.game_id, r.snaps_charted]));
  const out = new Map<string, number>();
  for (const g of games) {
    if ((snaps.get(g.id) ?? 0) > 0) out.set(g.prospect_id, (out.get(g.prospect_id) ?? 0) + 1);
  }
  return out;
}

/** Unwatched games across the groups. */
export function countUnwatched(groups: readonly { games: readonly unknown[] }[]): number {
  return groups.reduce((n, g) => n + g.games.length, 0);
}

// ── Where the tape is (scouting_games.tape_source, migration 101) ──

/** The column's CHECK: 1–300 characters (room for a link). */
export const TAPE_SOURCE_MAX = 300;

/** What a typed tape source saves as: trimmed, inner runs of spaces made one; blank = null. */
export function normalizeTapeSource(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, TAPE_SOURCE_MAX) : null;
}

/**
 * The sources already used, for the field's suggestions: most-used first, then
 * A–Z. Spellings that differ only in case are one source, shown as its
 * most-used spelling (the first seen on a tie). Links are left out.
 */
export function tapeSourceSuggestions(values: Iterable<string | null | undefined>): string[] {
  const bySource = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const v of values) {
    const s = normalizeTapeSource(v);
    if (!s || tapeLink(s)) continue;
    const key = s.toLowerCase();
    const entry = bySource.get(key) ?? { count: 0, spellings: new Map<string, number>() };
    entry.count++;
    entry.spellings.set(s, (entry.spellings.get(s) ?? 0) + 1);
    bySource.set(key, entry);
  }
  return [...bySource.values()]
    .map(({ count, spellings }) => ({
      count,
      label: [...spellings].reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0],
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((e) => e.label);
}

/** The source as a link to open, when it's an http(s) URL; null otherwise. */
export function tapeLink(source: string | null | undefined): string | null {
  const s = (source ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
