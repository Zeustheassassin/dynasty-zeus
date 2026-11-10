// Role standing, the second landing-spot piece of Dynasty Score Plus
// (dynastyScore.ts; stage 3 of the landing-spot plan, 2026-11-10). The user:
// "if you grade out as an X, are you the alpha of the X's or the bottom
// dweller", judged at the role he'll actually play after the draft.
//
// The role he plays is his Will Play (Post) when it's set (a role bucket of his
// position, saved as its key), else his best role bucket (Should Play, which is
// now always the computed bucket). The pool is the players at his position who
// play that role, each by the same rule, and he's ranked by his match % there
// (roleFit.ts). His class is the pool that counts (the user's call); the rank
// across every class shows beside it. Classes from LANDING_FIRST_CLASS only:
// the 2026 class is left out of the pools too.
//
// Value: his place in the class pool from +ROLE_STANDING_MAX (the alpha) to
// −ROLE_STANDING_MAX (the bottom), at the middle of his rank:
// (n − 2·rank + 1) / n. A pool of one reads 0 (alone tells us nothing), a pool
// of two ±half, and the ends come closer to the max as the pool grows, so small
// pools count for less on their own. Kept small: the role recipes read the
// same win rates as the AE Score, so this partly counts skill twice; it has its
// own slider (Role).

import { LANDING_FIRST_CLASS } from "./dynastyScore";
import { ROLES, matchFor, roleInfo, type RoleFit, type RoleKey, type RolePos } from "./roleFit";
import type { Prospect } from "../types";

export const ROLE_STANDING_MAX = 0.25;

export type StandingProspect = Pick<Prospect, "id" | "name" | "position" | "draft_class_year" | "will_play_post">;

const ROLE_POS = new Set<string>(["QB", "RB", "WR", "TE"]);
const isRolePos = (pos: string): pos is RolePos => ROLE_POS.has(pos);

/**
 * His Will Play (Post) as a role bucket of his position: the saved role key
 * ("x", "move", "three_down"), or a role's label in any case ("Move/Big slot").
 * Null when it's blank or doesn't name one of the position's roles (an older
 * free-text answer).
 */
export function willPlayRole(pos: string, text: string | null | undefined): RoleKey | null {
  const t = text?.trim();
  if (!t || !isRolePos(pos)) return null;
  const lower = t.toLowerCase();
  return ROLES[pos].find((r) => r.key === t || r.label.toLowerCase() === lower)?.key ?? null;
}

/** Will Play (Post) choices for a position: "" (not set) and each role bucket, highest ceiling first. */
export function willPlayOptions(pos: RolePos): { value: string; label: string }[] {
  return [{ value: "", label: "—" }, ...ROLES[pos].map((r) => ({ value: r.key, label: r.label }))];
}

export interface RolePlayed {
  role: RoleKey;
  /** His Will Play (Post), or his best role bucket when that isn't set. */
  from: "post" | "best";
}

/** The role he'll play: his Will Play (Post) when it names a role, else his best role bucket. */
export function rolePlayed(p: Pick<StandingProspect, "position" | "will_play_post">, fit: RoleFit | undefined): RolePlayed | null {
  const post = willPlayRole(p.position, p.will_play_post);
  if (post) return { role: post, from: "post" };
  return fit ? { role: fit.best, from: "best" } : null;
}

export interface PoolRank {
  /** 1 = the best at the role; tied players share the better rank. */
  rank: number;
  of: number;
}

export interface PoolEntry { id: string; name: string; classYear: number; pct: number }

export interface RoleStanding {
  role: RoleKey;
  from: RolePlayed["from"];
  /** His match % at the role. */
  pct: number;
  /** Among his class's players at his position who play the role. */
  inClass: PoolRank;
  /** Among every class's from LANDING_FIRST_CLASS. */
  allClasses: PoolRank;
  /** From the class rank, ±ROLE_STANDING_MAX, before the Role weight. */
  value: number;
  /** His class pool, best first, for the tooltip. */
  classPool: PoolEntry[];
}

/** Whether a higher match is better at the role. Special Teams' % is 100 − his best other match, so lower is better. */
const higherIsBetter = (role: RoleKey) => !roleInfo(role).remainder;

function rankIn(pool: readonly PoolEntry[], me: PoolEntry, role: RoleKey): { rank: PoolRank; centered: number } {
  const better = (x: PoolEntry) => (higherIsBetter(role) ? x.pct > me.pct : x.pct < me.pct);
  const ahead = pool.filter(better).length;
  const tied = pool.filter((x) => x.id !== me.id && x.pct === me.pct).length;
  const n = pool.length;
  // His middle rank, from +1 (alone at the top of a big pool) to −1.
  const centered = n > 0 ? (n - 1 - 2 * ahead - tied) / n : 0;
  return { rank: { rank: ahead + 1, of: n }, centered };
}

/**
 * Every 2027+ prospect's role standing (QB / RB / WR / TE with a role fit).
 * Drafted or not, everyone with a fit is in the pools; Dynasty+ adds the value
 * for the drafted ones.
 */
export function roleStandings(
  prospects: readonly StandingProspect[],
  roleFits: ReadonlyMap<string, RoleFit>,
): Map<string, RoleStanding> {
  // Who plays what: position|role → entries.
  const pools = new Map<string, PoolEntry[]>();
  const played = new Map<string, RolePlayed>();
  for (const p of prospects) {
    if (p.draft_class_year == null || p.draft_class_year < LANDING_FIRST_CLASS || !isRolePos(p.position)) continue;
    const fit = roleFits.get(p.id);
    if (!fit || fit.pos !== p.position) continue;
    const r = rolePlayed(p, fit);
    const m = r ? matchFor(fit, r.role) : undefined;
    if (!r || !m) continue;
    played.set(p.id, r);
    const key = `${p.position}|${r.role}`;
    const entry: PoolEntry = { id: p.id, name: p.name, classYear: p.draft_class_year, pct: m.pct };
    const list = pools.get(key);
    if (list) list.push(entry); else pools.set(key, [entry]);
  }

  const out = new Map<string, RoleStanding>();
  for (const p of prospects) {
    const r = played.get(p.id);
    if (!r) continue;
    const all = pools.get(`${p.position}|${r.role}`)!;
    const me = all.find((x) => x.id === p.id)!;
    const cls = all.filter((x) => x.classYear === me.classYear);
    const inClass = rankIn(cls, me, r.role);
    const order = higherIsBetter(r.role) ? (a: PoolEntry, b: PoolEntry) => b.pct - a.pct : (a: PoolEntry, b: PoolEntry) => a.pct - b.pct;
    out.set(p.id, {
      role: r.role,
      from: r.from,
      pct: me.pct,
      inClass: inClass.rank,
      allClasses: rankIn(all, me, r.role).rank,
      value: ROLE_STANDING_MAX * inClass.centered,
      classPool: [...cls].sort((a, b) => order(a, b) || a.name.localeCompare(b.name)),
    });
  }
  return out;
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
};

/** "2nd of 6" (tied players share the better rank). */
export const poolRankText = (r: PoolRank) => `${ordinal(r.rank)} of ${r.of}`;

/** One line: "X 78% (Will Play (Post)): 2nd of 6 at X in the 2027 class, 5th of 14 across classes". */
export function roleStandingText(s: RoleStanding, classYear: number): string {
  const label = roleInfo(s.role).label;
  const why = s.from === "post" ? "Will Play (Post)" : "his best role; set Will Play (Post) to change it";
  return `${label} ${s.pct}% (${why}): ${poolRankText(s.inClass)} at ${label} in the ${classYear} class, ${poolRankText(s.allClasses)} across classes`;
}
