// Dynasty+'s team inputs (stage 4 of the landing-spot plan, 2026-11-10): what
// his NFL team does to his early opportunity beyond the rookies it drafted
// ahead of him (rookie competition, landingSpot.ts).
//
//   Vets ahead      established veterans at his position he has to pass (Landing slider)
//   Path by year 2  does the way open, stay, or close by his second season (Landing slider)
//   QB              his team's starting QB's prior-season PFF passing grade (Offense slider; not for a QB)
//   Offense         pass-heavy / balanced / run-heavy (Offense slider)
//
// Each is the user's entry when set, else a suggestion read from his team's
// room as saved on the Post-Draft tab (PFF's live depth chart at the time,
// with the prior season's grades; lib/nflRooms.ts). The room is saved on his
// row (prospects.landing_inputs, migration 091) and never re-read: the class
// locks at its draft. Classes from LANDING_FIRST_CLASS only (landingSpot.ts).
//
// The values are the user's plan made concrete (my calls, 2026-11-10), kept
// small next to draft capital (±2 at 2×): together the team inputs move
// Dynasty+ by at most about ±0.6 at 1×.

import { nflTeamId } from "../nflDraft";
import { REGULAR_SHARE, type NflRoomsResponse, type NflTeamRoom, type PositionBar, type RoomPos } from "../nflRooms";
import { PRIME_END_AGE } from "./dynastyScore";
import { roleInfo, type RoleKey } from "./roleFit";
import type { ContractPathHint } from "../contractSituation";

export type OffenseLean = "pass" | "balanced" | "run";
export type PathCall = "opens" | "same" | "closes";
/** Whose input it is: the user's entry, a suggestion from the saved PFF room, or one from his team's contracts. */
export type InputSource = "yours" | "pff" | "contracts";

/** A veteran in his room, as saved. */
export interface SnapPlayer {
  name: string;
  depth: number;
  /** Prior-season PFF offense grade. */
  grade: number | null;
  /** Prior-season share of his team's snaps, 0–1. */
  share: number | null;
  birthDate: string | null;
}

/** His team's room as saved from PFF on the Post-Draft tab. */
export interface TeamSnapshot {
  /** When PFF's depth chart was read (ISO). */
  asOf: string;
  /** The season the grades, snaps and pass rate are from. */
  season: number;
  /** "Philadelphia Eagles" and ESPN's id for it; a different draft_team makes the room stale. */
  team: string;
  teamId: number;
  /** Veterans at his position on the depth chart, by depth (this draft's rookies left out). */
  room: SnapPlayer[];
  /** The depth chart's first QB, a rookie included, with his prior-season passing grade. */
  qb: { name: string; grade: number | null; rookie: boolean } | null;
  /** His position's grade bars that season (lib/nflRooms.ts PositionBar). */
  bar: PositionBar | null;
  /** Pass rate over expectation, as a fraction. */
  passOe: number | null;
  passPct: number | null;
  /** His position's share of targets (null for a QB). */
  targetShare: number | null;
}

/** prospects.landing_inputs (migration 091): the saved room and the user's entries. Absent fields mean "not set". */
export interface LandingSaved {
  pff?: TeamSnapshot | null;
  /** Established veterans ahead of him (the last option means "that many or more"). */
  vetsAhead?: number | null;
  /** His starting QB's passing grade, 0–100. */
  qbGrade?: number | null;
  offense?: OffenseLean | null;
  path?: PathCall | null;
  /** The contracts' read on his year 2 (lib/contractSituation.ts contractPathHint), saved from the Post-Draft tab
   *  (contracts plan stage 7). A suggestion like the PFF room's; the user's own path entry beats it. */
  contract?: ContractPathHint | null;
}

export const OFFENSE_LEANS: readonly OffenseLean[] = ["pass", "balanced", "run"];
export const PATH_CALLS: readonly PathCall[] = ["opens", "same", "closes"];
export const OFFENSE_LABEL: Record<OffenseLean, string> = { pass: "Pass-heavy", balanced: "Balanced", run: "Run-heavy" };
export const PATH_LABEL: Record<PathCall, string> = { opens: "Opens", same: "Same", closes: "Closes" };

// ── Values ─────────────────────────────────────────────────────────────────
// Vets ahead: one starting spot at QB, RB and TE, three at WR (11 personnel).
// Each table puts the typical room near 0. Checked on PFF's depth charts of
// 2026-11-10 with 2026 grades, the counts over the 32 teams were QB 0/1/2+:
// 7/21/4, RB 11/19/2, WR 1/2/3/4+: 5/12/12/3, TE 0/1/2/3+: 1/18/10/3, so the
// average room is worth about −0.05 to +0.01 at every position. With the QB
// and RB starter counted whatever his grade (ONE_STARTER, stage 5), the counts
// that night (half-season grades) were QB 2/27/3 and RB 6/24/2: an average QB
// room −0.09 and RB −0.02 before the path, which opens behind a weak starter.
// A QB sitting behind a starter loses more than the others; the path says for
// how long.
export const PECKING_VALUE: Record<RoomPos, readonly number[]> = {
  QB: [0.2, -0.1, -0.2],
  RB: [0.15, -0.05, -0.2],
  WR: [0.2, 0.1, 0, -0.1, -0.2],
  TE: [0.15, 0, -0.1, -0.2],
};
/** The last option of the vets-ahead picker ("2+", "3+"). */
export const vetsAheadMax = (pos: RoomPos) => PECKING_VALUE[pos].length - 1;

export const PATH_VALUE: Record<PathCall, number> = { opens: 0.1, same: 0, closes: -0.1 };

// QB: a point of passing grade above or below a typical starter's is worth
// 0.01, capped at ±0.2 (90 → +0.18, 60 → −0.12). Half for an RB, whose value
// leans on the run game. Not for a QB prospect: the vets-ahead count and the
// path already say whether he plays.
export const QB_GRADE_CENTER = 72;
export const QB_PER_POINT = 0.01;
export const QB_CAP = 0.2;
export const QB_SHARE: Record<RoomPos, number> = { QB: 0, RB: 0.5, WR: 1, TE: 1 };

// A Blocking TE is on the field to block, so his QB and the pass/run lean
// reach him half as much (stage 5's mock test, 2026-11-10: a 7th-round
// Blocking TE was the biggest riser, +0.30 of his +0.40 from his QB and a
// pass-heavy offense). By the role he'll play: Will Play (Post), else his best
// role bucket (roleStanding.ts rolePlayed).
export const ROLE_PASS_SHARE: Partial<Record<RoleKey, number>> = { blocking: 0.5 };
export const passShare = (role: RoleKey | null | undefined): number => (role ? ROLE_PASS_SHARE[role] ?? 1 : 1);

// Offense: pass-heavy helps the passers and catchers, run-heavy the backs
// (less: backs catch passes in a pass-heavy offense too).
export const OFFENSE_VALUE: Record<RoomPos, Record<OffenseLean, number>> = {
  QB: { pass: 0.1, balanced: 0, run: -0.1 },
  RB: { pass: -0.05, balanced: 0, run: 0.05 },
  WR: { pass: 0.1, balanced: 0, run: -0.1 },
  TE: { pass: 0.1, balanced: 0, run: -0.1 },
};

export const peckingValue = (pos: RoomPos, n: number) => PECKING_VALUE[pos][Math.max(0, Math.min(n, vetsAheadMax(pos)))];
export function qbValue(pos: RoomPos, grade: number): number {
  const v = Math.max(-QB_CAP, Math.min(QB_CAP, (grade - QB_GRADE_CENTER) * QB_PER_POINT));
  return v * QB_SHARE[pos];
}

// ── Suggestions from the saved room ────────────────────────────────────────
/** A regular this many snaps short of REGULAR_SHARE still counts when he graded like a star (an injury-shortened season). */
export const STAR_SHARE = 0.15;
/** Pass rate over expectation that makes an offense pass-heavy (or, negative, run-heavy). 2025: 7 teams at +3% or more, 9 at −3% or less. */
export const PROE_EDGE = 0.03;

/** An established veteran: a regular graded above his position's bottom quarter, or a star on a short season. */
export function isEstablished(p: Pick<SnapPlayer, "grade" | "share">, bar: PositionBar | null): boolean {
  if (!bar || p.grade == null || p.share == null) return false;
  return (p.share >= REGULAR_SHARE && p.grade >= bar.regular) || (p.share >= STAR_SHARE && p.grade >= bar.star);
}

// One starting spot at QB and RB: the depth chart's first player there, on a
// regular's share of snaps, is ahead of a rookie whatever his grade (stage 5's
// mock test, 2026-11-10: the grade bar alone dropped 6 of 26 starting QBs,
// Herbert at 41.7 among them, and 5 of 24 lead backs, so a rookie QB behind
// Herbert read "nobody ahead", +0.2). How weak he is goes to the path by year
// 2 instead. At WR and TE, with more than one starting spot, a rookie is
// expected to pass a regular graded under the bar.
export const ONE_STARTER: Record<RoomPos, boolean> = { QB: true, RB: true, WR: false, TE: false };

/** At QB and RB, the depth chart's first player at his position, when he played a regular's share of snaps. */
export function roomStarters(room: readonly SnapPlayer[], pos: RoomPos): SnapPlayer[] {
  if (!ONE_STARTER[pos] || !room.length) return [];
  const top = Math.min(...room.map((p) => p.depth));
  return room.filter((p) => p.depth === top && (p.share ?? 0) >= REGULAR_SHARE);
}

/** The veterans ahead of him: the established ones, and at QB and RB the starter whatever his grade. */
export function suggestedVetsAhead(snap: TeamSnapshot, pos: RoomPos): SnapPlayer[] {
  const starters = new Set(roomStarters(snap.room, pos));
  return snap.room.filter((p) => starters.has(p) || isEstablished(p, snap.bar));
}

export function suggestedOffense(passOe: number | null): OffenseLean | null {
  if (passOe == null) return null;
  return passOe >= PROE_EDGE ? "pass" : passOe <= -PROE_EDGE ? "run" : "balanced";
}

/** His age on Sept 1 of a season, from YYYY-MM-DD. */
export function ageOnSept1(birthDate: string | null, season: number): number | null {
  const m = birthDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const born = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return (Date.UTC(season, 8, 1) - born) / (365.2425 * 86_400_000);
}

/**
 * Opens when a veteran ahead of him will be past his position's prime by his
 * second season (PRIME_END_AGE); for a QB, when every QB ahead graded like a
 * bridge (under the midpoint of the QB bars); for an RB, when every back ahead
 * is a weak starter (graded under the bar, counted only because he starts).
 * Else the same. Never suggests "closes": that's knowledge the room can't show
 * (a young star signed through year 2 is already counted as ahead).
 */
export function suggestedPath(pos: RoomPos, classYear: number, snap: TeamSnapshot, ahead: readonly SnapPlayer[]): { call: PathCall; why: string | null } {
  const year2 = classYear + 1;
  for (const v of ahead) {
    const age = ageOnSept1(v.birthDate, year2);
    if (age != null && age >= PRIME_END_AGE[pos]) return { call: "opens", why: `${v.name} is ${Math.floor(age)} in ${year2}` };
  }
  const graded = () => ahead.map((v) => `${v.name} ${v.grade != null ? v.grade.toFixed(1) : "(no grade)"}`).join(", ");
  if (pos === "QB" && snap.bar && ahead.length) {
    const mid = (snap.bar.regular + snap.bar.star) / 2;
    if (ahead.every((v) => (v.grade ?? 0) < mid)) return { call: "opens", why: `${graded()}: graded like a bridge (under ${mid.toFixed(1)})` };
  }
  if (pos === "RB" && snap.bar && ahead.length) {
    const bar = snap.bar.regular;
    if (ahead.every((v) => (v.grade ?? 0) < bar)) return { call: "opens", why: `${graded()}: a weak starter (under ${bar.toFixed(1)})` };
  }
  return { call: "same", why: null };
}

/** His room from a load of every team's, for saving on his row. */
export function teamSnapshotFor(rooms: Pick<NflRoomsResponse, "asOf" | "season" | "bars">, room: NflTeamRoom, pos: RoomPos): TeamSnapshot {
  const qb = room.players.filter((p) => p.pos === "QB").sort((a, b) => a.depth - b.depth)[0];
  return {
    asOf: rooms.asOf,
    season: rooms.season,
    team: room.name,
    teamId: room.teamId,
    room: room.players
      .filter((p) => p.pos === pos && !p.rookie)
      .map((p) => ({ name: p.name, depth: p.depth, grade: p.grade, share: p.share, birthDate: p.birthDate })),
    qb: qb ? { name: qb.name, grade: qb.passGrade, rookie: qb.rookie } : null,
    bar: rooms.bars[pos] ?? null,
    passOe: room.passOe,
    passPct: room.passPct,
    targetShare: pos === "QB" ? null : room.targetShare[pos],
  };
}

// ── Reading the saved inputs ───────────────────────────────────────────────
const isRoomPos = (pos: string): pos is RoomPos => pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE";
const intIn = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const numIn = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const oneOf = <T extends string>(v: unknown, opts: readonly T[]) => (opts.includes(v as T) ? (v as T) : null);

/** The user's entries from a saved value, each null when unset or unreadable. */
export function savedEntries(saved: LandingSaved | null | undefined): { vetsAhead: number | null; qbGrade: number | null; offense: OffenseLean | null; path: PathCall | null } {
  return {
    vetsAhead: intIn(saved?.vetsAhead, 0, 9),
    qbGrade: numIn(saved?.qbGrade, 0, 100),
    offense: oneOf(saved?.offense, OFFENSE_LEANS),
    path: oneOf(saved?.path, PATH_CALLS),
  };
}

/** A saved contract hint, when it's well formed and for his year 2 (a hint for another season is ignored). */
export function contractHint(raw: unknown, classYear: number): ContractPathHint | null {
  const h = raw as Partial<ContractPathHint> | null | undefined;
  if (!h || typeof h !== "object") return null;
  if (h.season !== classYear + 1 || (h.call !== "opens" && h.call !== "closes" && h.call !== "same")) return null;
  return { season: h.season, call: h.call, why: typeof h.why === "string" ? h.why : "", asOf: typeof h.asOf === "string" ? h.asOf : "" };
}

/** His saved inputs with a patch: null entries dropped, and null overall when nothing is left. */
export function patchedLandingInputs(saved: LandingSaved | null | undefined, patch: Partial<LandingSaved>): LandingSaved | null {
  const next: Record<string, unknown> = { ...(saved ?? {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  return Object.keys(next).length ? (next as LandingSaved) : null;
}

export interface TeamLanding {
  pos: RoomPos;
  /** The role he'll play, when known (Will Play (Post), else his best bucket). */
  role: RoleKey | null;
  /** How much of the QB and offense values reach him (ROLE_PASS_SHARE): 0.5 for a Blocking TE, else 1. */
  passShare: number;
  /** His saved room; null when none was saved or it's for another team (stale). */
  snapshot: TeamSnapshot | null;
  /** The saved room is for a different team than his draft_team. */
  stale: boolean;
  vetsAhead: { n: number; source: InputSource; ahead: SnapPlayer[] } | null;
  /** Null for a QB prospect, or with neither an entry nor a graded starter. */
  qb: { grade: number; source: InputSource; name: string | null } | null;
  offense: { lean: OffenseLean; source: InputSource; passOe: number | null } | null;
  path: { call: PathCall; source: InputSource; why: string | null } | null;
  /** Before the sliders: pecking and path go with Landing, qb and offense with Offense. */
  values: { pecking: number; path: number; qb: number; offense: number };
}

export interface TeamLandingProspect {
  position: string;
  draft_class_year: number;
  draft_team: string | null;
  landing_inputs?: LandingSaved | null;
}

/**
 * His team inputs: each the user's entry, else the suggestion from his saved
 * room. `role` is the role he'll play (roleStanding.ts rolePlayed), for
 * ROLE_PASS_SHARE. Null off QB/RB/WR/TE.
 */
export function resolveTeamLanding(p: TeamLandingProspect, role: RoleKey | null = null): TeamLanding | null {
  if (!isRoomPos(p.position)) return null;
  const pos = p.position;
  const share = passShare(role);
  const saved = p.landing_inputs ?? null;
  const mine = savedEntries(saved);
  const raw = saved?.pff ?? null;
  const team = nflTeamId(p.draft_team);
  const stale = raw != null && raw.teamId !== team;
  const snap = raw && !stale ? raw : null;

  const ahead = snap ? suggestedVetsAhead(snap, pos) : [];
  const vetsAhead = mine.vetsAhead != null
    ? { n: mine.vetsAhead, source: "yours" as const, ahead }
    : snap ? { n: ahead.length, source: "pff" as const, ahead } : null;

  let qb: TeamLanding["qb"] = null;
  if (pos !== "QB") {
    if (mine.qbGrade != null) qb = { grade: mine.qbGrade, source: "yours", name: snap?.qb?.name ?? null };
    else if (snap?.qb && !snap.qb.rookie && snap.qb.grade != null) qb = { grade: snap.qb.grade, source: "pff", name: snap.qb.name };
  }

  const pffLean = snap ? suggestedOffense(snap.passOe) : null;
  const offense = mine.offense != null
    ? { lean: mine.offense, source: "yours" as const, passOe: snap?.passOe ?? null }
    : pffLean ? { lean: pffLean, source: "pff" as const, passOe: snap!.passOe } : null;

  // The path: the user's entry; else a way that opens (the contracts first: a vet ahead cut or leaving, then the
  // saved room's age / bridge / weak-starter reads); else the contracts' "closes" (his team is among the likeliest
  // to add competition at his position); else the room's "same".
  const hint = contractHint(saved?.contract, p.draft_class_year);
  const fromRoom = snap ? { ...suggestedPath(pos, p.draft_class_year, snap, ahead), source: "pff" as const } : null;
  const fromContracts = hint ? { call: hint.call, source: "contracts" as const, why: hint.why } : null;
  const path = mine.path != null
    ? { call: mine.path, source: "yours" as const, why: null }
    : fromContracts?.call === "opens" ? fromContracts
    : fromRoom?.call === "opens" ? fromRoom
    : fromContracts ?? fromRoom;

  return {
    pos,
    role,
    passShare: share,
    snapshot: snap,
    stale,
    vetsAhead,
    qb,
    offense,
    path,
    values: {
      pecking: vetsAhead ? peckingValue(pos, vetsAhead.n) : 0,
      path: path ? PATH_VALUE[path.call] : 0,
      qb: qb ? share * qbValue(pos, qb.grade) : 0,
      offense: offense ? share * OFFENSE_VALUE[pos][offense.lean] : 0,
    },
  };
}

/** The team inputs' share of Dynasty+ at the slider weights. */
export function teamLandingTotal(t: TeamLanding | null | undefined, w: { landing: number; offense: number }): number {
  if (!t) return 0;
  return w.landing * (t.values.pecking + t.values.path) + w.offense * (t.values.qb + t.values.offense);
}

// ── Words ──────────────────────────────────────────────────────────────────
const sgn2 = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
const pct1 = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;
const src = (s: InputSource) => (s === "yours" ? "yours" : s === "contracts" ? "suggested by contracts" : "suggested");
const NOT_LOADED = "not set (save the rooms on the Post-Draft tab, or enter it)";

/** "2+" for the last option of the vets-ahead picker. */
export function vetsAheadLabel(pos: RoomPos, n: number): string {
  return n >= vetsAheadMax(pos) ? `${vetsAheadMax(pos)}+` : String(n);
}

/** A veteran in words: "DeVonta Smith 90.5 (88%)". */
export function snapPlayerText(p: SnapPlayer): string {
  const g = p.grade != null ? ` ${p.grade.toFixed(1)}` : " (no grade)";
  const s = p.share != null ? ` (${Math.round(p.share * 100)}%)` : "";
  return `${p.name}${g}${s}`;
}

export function vetsAheadLine(t: TeamLanding, weight: number): string {
  if (!t.vetsAhead) return `Vets ahead: ${t.stale ? "the saved room is for another team (save the rooms again)" : NOT_LOADED} → +0.00`;
  const who = t.vetsAhead.source === "pff"
    ? (t.vetsAhead.ahead.length ? ` (${t.vetsAhead.ahead.map(snapPlayerText).join(", ")})` : " (no established veteran)")
    : "";
  return `Vets ahead: ${vetsAheadLabel(t.pos, t.vetsAhead.n)}, ${src(t.vetsAhead.source)}${who} → ${sgn2(weight * t.values.pecking)}`;
}

export function pathLine(t: TeamLanding, weight: number): string {
  if (!t.path) return `Path by year 2: ${NOT_LOADED} → +0.00`;
  const why = t.path.why ? ` (${t.path.why})` : "";
  return `Path by year 2: ${PATH_LABEL[t.path.call].toLowerCase()}, ${src(t.path.source)}${why} → ${sgn2(weight * t.values.path)}`;
}

export function qbLine(t: TeamLanding, weight: number): string | null {
  if (t.pos === "QB") return null;
  if (!t.qb) {
    const why = t.snapshot?.qb?.rookie ? `${t.snapshot.qb.name} is a rookie: enter a guess`
      : t.snapshot?.qb ? `${t.snapshot.qb.name} has no ${t.snapshot.season} grade: enter a guess` : NOT_LOADED;
    return `QB: ${why} → +0.00`;
  }
  const who = t.qb.name ? `${t.qb.name} ` : "";
  const half = t.pos === "RB" ? " (half for an RB)" : roleHalf(t);
  return `QB: ${who}${t.qb.grade.toFixed(1)} passing grade, ${src(t.qb.source)}${half} → ${sgn2(weight * t.values.qb)}`;
}

/** " (half for a Blocking TE)" when his role takes a share of the QB and offense values. */
function roleHalf(t: TeamLanding): string {
  return t.passShare < 1 && t.role ? ` (${t.passShare === 0.5 ? "half" : `×${t.passShare}`} for a ${roleInfo(t.role).label})` : "";
}

export function offenseLine(t: TeamLanding, weight: number): string {
  if (!t.offense) return `Offense: ${NOT_LOADED} → +0.00`;
  const proe = t.offense.passOe != null && t.snapshot ? ` (pass rate over expectation ${pct1(t.offense.passOe)} in ${t.snapshot.season})` : "";
  return `Offense: ${OFFENSE_LABEL[t.offense.lean].toLowerCase()}, ${src(t.offense.source)}${proe}${roleHalf(t)} → ${sgn2(weight * t.values.offense)}`;
}

/** The team-input tooltip lines at the slider weights: vets ahead and path (Landing), QB and offense (Offense). */
export function teamLandingLines(t: TeamLanding | null | undefined, w: { landing: number; offense: number }): string[] {
  if (!t) return [];
  const qb = qbLine(t, w.offense);
  return [vetsAheadLine(t, w.landing), pathLine(t, w.landing), ...(qb ? [qb] : []), offenseLine(t, w.offense)];
}
