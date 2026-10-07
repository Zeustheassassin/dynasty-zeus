// Per-game trait grades (tape-grading expansion, Stage 5). Pure.
//
// The user grades a set of traits per position (six; WR eleven since
// 2026-10-06), 1–10, per charted game, on NEW
// games only (scouting_games.trait_grades, migration 065): an old game was
// charted before traits existed and isn't re-watched, so it never gets them
// and nothing about it changes.
//
// By the user's call (2026-10-05) traits sit BESIDE the AE Score: their
// averages show in the Big Board, Analysis and Compare, and the AE Score
// leaves them out. A Big Board toggle shows the same scores with the
// UNCOVERED traits added (the ones no charted or PFF stat already measures:
// one source per skill), each a per-player component at TRAIT_WEIGHT (0.2,
// the user's call) × its trust, so a prospect without grades keeps his score.
// Draft-day snapshots always keep the score without traits.
import type { AESample, ScoutingGame } from "../types";
import type { CompositeMetric, CompositePos } from "./aeComposite";
import { seasonWeights } from "./seasonWeight";

export interface TraitDef {
  key: string;
  label: string;
  short: string;
  /** What already measures it in the AE Score (so it stays beside), or null when nothing does. */
  coveredBy: string | null;
  /** How to read the grade, when 10 isn't obviously "best" (the column's tooltip). */
  hint?: string;
}

export const TRAITS: Record<CompositePos, readonly TraitDef[]> = {
  QB: [
    { key: "accuracy", label: "Accuracy", short: "Acc", coveredBy: "AAE" },
    { key: "arm", label: "Arm", short: "Arm", coveredBy: null },
    { key: "processing", label: "Processing", short: "Proc", coveredBy: "better-option-missed tag" },
    { key: "pocket_presence", label: "Pocket presence", short: "Pkt", coveredBy: "charted sacks per pressured dropback" },
    { key: "creation", label: "Creation", short: "Crt", coveredBy: null },
    { key: "rushing", label: "Rushing", short: "Rush", coveredBy: "PFF rushing and the run-result tag" },
  ],
  RB: [
    { key: "vision", label: "Vision", short: "Vis", coveredBy: "missed-read tag" },
    { key: "burst", label: "Burst", short: "Bur", coveredBy: null },
    { key: "contact_balance", label: "Contact balance", short: "Bal", coveredBy: "charted broken tackles and PFF YCO/A" },
    { key: "long_speed", label: "Long speed", short: "Spd", coveredBy: "charted explosives and the caught-from-behind tag" },
    { key: "hands", label: "Hands", short: "Hnd", coveredBy: "charted drops" },
    { key: "pass_pro", label: "Pass pro", short: "PP", coveredBy: "charted pass blocks" },
  ],
  WR: [
    { key: "release", label: "Release", short: "Rel", coveredBy: "release-vs-press tag" },
    { key: "route_craft", label: "Route craft", short: "Rte", coveredBy: "cSAE" },
    { key: "separation_speed", label: "Separation speed", short: "Sep", coveredBy: "SAE" },
    { key: "hands", label: "Hands", short: "Hnd", coveredBy: "charted drops" },
    { key: "contested_catch", label: "Contested catch", short: "CC", coveredBy: "charted contested catch %" },
    { key: "yac", label: "YAC", short: "YAC", coveredBy: "PFF YAC/R and the broken-tackle tag" },
    // Added 2026-10-06 at the user's request; nothing charted or PFF measures
    // any of them. Route suddenness and wasted movement aren't read by cSAE
    // either (the user's call): a receiver can round a route, or waste
    // movement, and still get open; being sudden and efficient is what makes
    // the better route runner.
    { key: "game_speed", label: "Game speed", short: "Spd", coveredBy: null },
    { key: "route_suddenness", label: "Route suddenness", short: "Sud", coveredBy: null },
    { key: "play_strength", label: "Play strength", short: "Str", coveredBy: null },
    { key: "wasted_movement", label: "Wasted movement", short: "WM", coveredBy: null, hint: "10 = no wasted movement" },
    { key: "scramble_drill", label: "Scramble drill", short: "Scr", coveredBy: null },
  ],
  TE: [
    { key: "inline_block", label: "Inline block", short: "Inl", coveredBy: "TE-SAEB" },
    { key: "move_block", label: "Move block", short: "Mov", coveredBy: "TE-SAEB" },
    { key: "release", label: "Release", short: "Rel", coveredBy: "release-vs-press tag" },
    { key: "route_craft", label: "Route craft", short: "Rte", coveredBy: "TE-SAER" },
    { key: "hands", label: "Hands", short: "Hnd", coveredBy: null },
    { key: "yac", label: "YAC", short: "YAC", coveredBy: null },
  ],
};

export const TRAIT_MIN = 1;
export const TRAIT_MAX = 10;
/** Full-trust weight of each uncovered trait when the toggle is on (the user's call, 2026-10-05). */
export const TRAIT_WEIGHT = 0.2;
/** Games created from this instant on can be graded (the day per-play tags began; older games predate traits). */
export const TRAIT_GRADES_FROM = "2026-10-05T00:00:00Z";

/** Can this game carry trait grades (a new game)? */
export function isTraitGame(g: Pick<ScoutingGame, "created_at">): boolean {
  return Date.parse(g.created_at) >= Date.parse(TRAIT_GRADES_FROM);
}

export const traitsFor = (pos: string): readonly TraitDef[] => TRAITS[pos as CompositePos] ?? [];
export const uncoveredTraits = (pos: string): TraitDef[] => traitsFor(pos).filter((t) => t.coveredBy == null);

/** A valid grade: a whole number 1–10. */
export function validTraitGrade(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= TRAIT_MIN && v <= TRAIT_MAX;
}

/** The position's grades from a game's trait_grades (invalid or unknown keys dropped). */
export function gameTraits(pos: string, grades: ScoutingGame["trait_grades"]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!grades) return out;
  for (const t of traitsFor(pos)) if (validTraitGrade(grades[t.key])) out[t.key] = grades[t.key];
  return out;
}

/** A game's trait_grades after setting one trait (null clears it); null when none are left. */
export function withTrait(grades: ScoutingGame["trait_grades"], key: string, value: number | null): Record<string, number> | null {
  const next = { ...(grades ?? {}) };
  if (value == null) delete next[key];
  else next[key] = value;
  return Object.keys(next).length ? next : null;
}

export interface TraitAverage {
  /** Season-weighted mean grade. */
  avg: number;
  /** Games graded. */
  games: number;
}

/** prospect id → trait key → his average over graded new games (season-weighted like every AE). */
export function traitAverages(
  prospects: readonly { id: string; position: string }[],
  games: readonly ScoutingGame[],
): Map<string, Record<string, TraitAverage>> {
  const pos = new Map(prospects.map((p) => [p.id, p.position]));
  const w = seasonWeights(games);
  const acc = new Map<string, Record<string, { sw: number; swx: number; n: number }>>();
  for (const g of games) {
    if (!isTraitGame(g)) continue;
    const grades = gameTraits(pos.get(g.prospect_id) ?? "", g.trait_grades);
    const keys = Object.keys(grades);
    if (!keys.length) continue;
    const a = acc.get(g.prospect_id) ?? {};
    acc.set(g.prospect_id, a);
    const gw = w.get(g.id) ?? 1;
    for (const k of keys) {
      const t = (a[k] ??= { sw: 0, swx: 0, n: 0 });
      t.sw += gw; t.swx += gw * grades[k]; t.n++;
    }
  }
  return new Map([...acc].map(([id, a]) => [id, Object.fromEntries(Object.entries(a).map(([k, t]) => [k, { avg: t.swx / t.sw, games: t.n }]))]));
}

/** Each uncovered trait as a per-player composite component (the Big Board's "with traits" view). */
export function traitComponents(
  prospects: readonly { id: string; position: string }[],
  games: readonly ScoutingGame[],
): Record<CompositePos, CompositeMetric[]> {
  const out: Record<CompositePos, CompositeMetric[]> = { QB: [], RB: [], WR: [], TE: [] };
  const posOf = new Map(prospects.map((p) => [p.id, p.position]));
  const w = seasonWeights(games);
  for (const pos of Object.keys(TRAITS) as CompositePos[]) {
    for (const t of uncoveredTraits(pos)) {
      // Each prospect's graded games for this trait.
      const by = new Map<string, { g: number; w: number }[]>();
      for (const g of games) {
        if (posOf.get(g.prospect_id) !== pos || !isTraitGame(g)) continue;
        const v = gameTraits(pos, g.trait_grades)[t.key];
        if (v == null) continue;
        (by.get(g.prospect_id) ?? by.set(g.prospect_id, []).get(g.prospect_id)!).push({ g: v, w: w.get(g.id) ?? 1 });
      }
      // Game-to-game scatter around each player's own mean, pooled: the noise in one grade.
      let ss = 0, dof = 0;
      for (const xs of by.values()) {
        if (xs.length < 2) continue;
        const m = xs.reduce((s, x) => s + x.g, 0) / xs.length;
        for (const x of xs) ss += (x.g - m) ** 2;
        dof += xs.length - 1;
      }
      const perGame = dof > 0 ? ss / dof : null;
      const samples = new Map<string, AESample | null>();
      for (const [id, xs] of by) {
        const sw = xs.reduce((s, x) => s + x.w, 0), sw2 = xs.reduce((s, x) => s + x.w * x.w, 0);
        const avg = xs.reduce((s, x) => s + x.w * x.g, 0) / sw;
        samples.set(id, perGame == null ? null : { ae: avg, n: xs.length, w: sw, variance: perGame * (sw2 / (sw * sw)) });
      }
      out[pos].push({
        key: `trait_${t.key}`,
        label: `Trait ${t.label}`,
        weight: TRAIT_WEIGHT,
        samples,
        perPlayer: true,
        describe: (_id, s) => `${s.ae.toFixed(1)} / 10 over ${s.n} graded game${s.n === 1 ? "" : "s"}`,
        spreadFloor: 0.5,
        minVariance: 1e-12,
      });
    }
  }
  return out;
}
