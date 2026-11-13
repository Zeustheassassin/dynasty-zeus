// Dynasty by role: what a WR's Dynasty Score would be if he played X, Z or
// Slot (the user, 2026-11-13: "if this guy is an X then he would be this
// score … so I know if he's drafted to a team in dire need of an X I am 100%
// staying away"). A pre-draft read beside Dynasty and Dynasty+. It feeds
// neither, and no rank or sort reads it.
//
// The Dynasty Score's AE Score reads his separation over every route he ran
// (the SAE and cSAE pieces). Each role weighs separation its own way
// (roleFitWR.ts WR_RECIPES): press counts for half of an X, the deep tree for
// half of a Z, and the quick tree with zone for most of a Slot. So for each role, his
// separation pieces come out of his Dynasty Score and his separation at the
// role goes in, on the same scale: the pool's average separation plus his role
// skill's z-score times the pool's separation spread. Everything else stays:
// target data, the one-side alignment penalty, age and size.
//
// His role skill is the role's recipe with the usage features left out. Where
// he lined up in college isn't the question ("if he played X"). The recipe's
// size floor still counts. The pool is every charted WR with an AE Score
// and a role fit, all classes.
//
// Worked on 2026-11-13: T.J. Moore (Dynasty +0.45, AE +0.40, separation
// +0.76 almost all vs zone) reads X −1.00 (27th of 34 2027 WRs), Z +0.10,
// Slot +0.77. Jeremiah Smith reads X +2.85, first in the class. Adding a role bonus on top
// of Dynasty instead left Moore positive as an X; replacing the whole AE Score
// dropped his target data. This swap is the middle, the user's pick.

import type { AEComposite, CompositePos } from "./aeComposite";
import type { DynastyBreakdown } from "./dynastyScore";
import { parseHeightInches } from "./prospectAge";
import { scorePieces, type ScoreView } from "./prospectScores";
import { scoreBucket, type BucketRecipe, type RoleFit, type RoleKey } from "./roleFit";
import { WR_RECIPES } from "./roleFitWR";
import type { PoolRank } from "./roleStanding";
import type { Prospect } from "../types";

interface RoleDynastySpec {
  roles: readonly RoleKey[];
  recipes: readonly BucketRecipe[];
  /** The AE Score pieces that read his separation (scorePieces keys). */
  separation: ReadonlySet<string>;
}

/** Positions with a Dynasty by role read. WR only (X / Z / Slot) for now. */
export const ROLE_DYNASTY: Partial<Record<CompositePos, RoleDynastySpec>> = {
  WR: { roles: ["x", "z", "slot"], recipes: WR_RECIPES, separation: new Set(["sae", "csae"]) },
};

/** Fewer scored WRs than this and there's no spread to read a z-score against. */
export const ROLE_DYNASTY_MIN_POOL = 10;

export type RoleDynastyProspect = Pick<Prospect, "id" | "position" | "draft_class_year" | "height" | "weight">;

export interface RoleDynastyEntry {
  role: RoleKey;
  /** His Dynasty Score if he played the role. */
  score: number;
  /** His role skill: the recipe's skill parts with the size floor kept, 0–100. */
  skill: number;
  /** The pool's average role skill. */
  poolSkill: number;
  /** His role skill vs the pool, in pool SDs. */
  z: number;
  /** What his separation adds at the role, in place of his own. */
  separation: number;
  /** The two or three features that moved his role skill most, signed. */
  drivers: string[];
  /** Short of the recipe's sample bar (an X needs press reps); still shown. */
  pendingWhy: string | null;
  sizeNote: string | null;
  /** Among his class's WRs with a role read, by score at this role. */
  inClass: PoolRank;
}

export interface RoleDynasty {
  /** His Dynasty Score as it stands. */
  dynasty: number;
  /** What his own separation adds to the AE Score (out of every role's score). */
  ownSeparation: number;
  /** The pool it's read against. */
  pool: number;
  roles: RoleDynastyEntry[];
}

/** The role's recipe without its usage features (where he lined up). */
function skillRecipe(recipe: BucketRecipe, features: RoleFit["features"]): BucketRecipe {
  return { ...recipe, ingredients: recipe.ingredients.filter((i) => features[i.feature]?.kind !== "usage") };
}

const meanSd = (xs: readonly number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
  return { m, sd };
};

interface Scored {
  id: string;
  classYear: number | null;
  dynasty: number;
  ownSeparation: number;
  skill: Map<RoleKey, ReturnType<typeof scoreBucket>>;
}

/**
 * Dynasty by role for every prospect at a position with a spec (WR), from the
 * screen's AE Score views and Dynasty scores. Empty under
 * ROLE_DYNASTY_MIN_POOL scored WRs or with no spread.
 */
export function roleDynastyScores(
  prospects: readonly RoleDynastyProspect[],
  views: ReadonlyMap<string, ScoreView>,
  dynasty: ReadonlyMap<string, DynastyBreakdown>,
  roleFits: ReadonlyMap<string, RoleFit>,
  composite: AEComposite,
): Map<string, RoleDynasty> {
  const out = new Map<string, RoleDynasty>();
  for (const [pos, spec] of Object.entries(ROLE_DYNASTY) as [CompositePos, RoleDynastySpec][]) {
    const pc = composite.positions[pos];
    const scored: Scored[] = [];
    for (const p of prospects) {
      if (p.position !== pos) continue;
      const view = views.get(p.id);
      const d = dynasty.get(p.id);
      const fit = roleFits.get(p.id);
      if (!view || !d || !fit || fit.pos !== pos) continue;
      const ownSeparation = scorePieces(view, pc).filter((x) => spec.separation.has(x.key)).reduce((s, x) => s + x.add, 0);
      const heightIn = parseHeightInches(p.height);
      const skill = new Map<RoleKey, ReturnType<typeof scoreBucket>>();
      for (const role of spec.roles) {
        const recipe = spec.recipes.find((r) => r.role === role);
        if (recipe) skill.set(role, scoreBucket(skillRecipe(recipe, fit.features), fit.features, heightIn, p.weight));
      }
      scored.push({ id: p.id, classYear: p.draft_class_year, dynasty: d.dynasty, ownSeparation, skill });
    }
    if (scored.length < ROLE_DYNASTY_MIN_POOL) continue;

    const sep = meanSd(scored.map((s) => s.ownSeparation));
    const stats = new Map(spec.roles.map((role) => [role, meanSd(scored.map((s) => s.skill.get(role)?.pct ?? 0))]));
    if (!(sep.sd > 0)) continue;

    const entries = new Map<string, RoleDynastyEntry[]>();
    for (const s of scored) {
      const list: RoleDynastyEntry[] = [];
      for (const role of spec.roles) {
        const m = s.skill.get(role);
        const st = stats.get(role)!;
        if (!m || !(st.sd > 0)) continue;
        const z = (m.pct - st.m) / st.sd;
        const separation = sep.m + z * sep.sd;
        list.push({
          role, score: s.dynasty - s.ownSeparation + separation, skill: m.pct, poolSkill: st.m, z, separation,
          drivers: m.drivers, pendingWhy: m.proven ? null : m.pendingWhy ?? null, sizeNote: m.sizeNote,
          inClass: { rank: 1, of: 1 },
        });
      }
      entries.set(s.id, list);
    }

    // Class rank at each role: tied scores share the better rank.
    for (const role of spec.roles) {
      const byClass = new Map<number | null, { id: string; score: number }[]>();
      for (const s of scored) {
        const e = entries.get(s.id)!.find((x) => x.role === role);
        if (!e) continue;
        const list = byClass.get(s.classYear);
        if (list) list.push({ id: s.id, score: e.score }); else byClass.set(s.classYear, [{ id: s.id, score: e.score }]);
      }
      for (const list of byClass.values()) {
        for (const me of list) {
          const e = entries.get(me.id)!.find((x) => x.role === role)!;
          e.inClass = { rank: 1 + list.filter((x) => x.score > me.score).length, of: list.length };
        }
      }
    }

    for (const s of scored) {
      out.set(s.id, { dynasty: s.dynasty, ownSeparation: s.ownSeparation, pool: scored.length, roles: entries.get(s.id)! });
    }
  }
  return out;
}
