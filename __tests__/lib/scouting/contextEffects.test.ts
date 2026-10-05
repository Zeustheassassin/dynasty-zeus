import { describe, it, expect } from "vitest";
import {
  addGameResidual, adjustForContext, beats, contextLift, contextVerdict, fitContext, heldOutContextTest, shuffleCovariates,
  CONTEXT_TEST_MIN_PROSPECTS, type ByGame, type CovariateSpec,
} from "@/lib/scouting/contextEffects";
import type { AESample } from "@/lib/types";

// A deterministic league: 30 prospects × 6 games, each with its own talent
// level; a game's mean residual = talent + effect × (x − 20) + noise.
function league(effect: number, opts: { players?: number; noise?: number; seed?: number } = {}) {
  const players = opts.players ?? 30, noise = opts.noise ?? 0.03;
  let s = opts.seed ?? 7;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const samples: [string, ByGame][] = [];
  const cov = new Map<string, Record<string, number>>();
  for (let p = 0; p < players; p++) {
    const talent = (rand() - 0.5) * 0.2;
    const bg: ByGame = {};
    for (let g = 0; g < 6; g++) {
      const id = `p${p}g${g}`, x = 10 + rand() * 25, n = 30;
      const y = talent + effect * (x - 20) + (rand() - 0.5) * 2 * noise;
      addGameResidual(bg, id, n, y * n);
      cov.set(id, { x });
    }
    samples.push([`p${p}`, bg]);
  }
  return { samples, cov };
}
const X: CovariateSpec = { key: "x", label: "X", sign: 1, ref: "mean", unit: "pt" };

describe("fitContext", () => {
  it("recovers a planted within-player effect, untouched by talent differences", () => {
    const { samples, cov } = league(0.004);
    const fit = fitContext(samples, cov, [X], 1)!;
    expect(fit.beta.x).toBeGreaterThan(0.0035);
    expect(fit.beta.x).toBeLessThan(0.0045);
    expect(fit.prospects).toBe(30);
    expect(fit.games).toBe(180);
  });

  it("drops an effect pointing the wrong way, and shrinks with the ridge", () => {
    const { samples, cov } = league(-0.004);
    expect(fitContext(samples, cov, [X])!.specs).toEqual([]);
    const strong = fitContext(league(0.004).samples, league(0.004).cov, [X], 1)!.beta.x;
    const shrunk = fitContext(league(0.004).samples, league(0.004).cov, [X], 1e6)!.beta.x;
    expect(shrunk).toBeLessThan(strong / 2);
  });

  it("sets each covariate's reference: the pool mean, 0, or a given level", () => {
    const { samples, cov } = league(0.004);
    expect(fitContext(samples, cov, [{ ...X, ref: "zero" }])!.ref.x).toBe(0);
    expect(fitContext(samples, cov, [{ ...X, ref: 21 }])!.ref.x).toBe(21);
    expect(fitContext(samples, cov, [X])!.ref.x).toBeGreaterThan(15);
  });
});

describe("contextLift / adjustForContext", () => {
  const fit = { specs: [X], beta: { x: 0.01 }, ref: { x: 20 }, prospects: 10, games: 20, reps: 100 };
  const cov = new Map([["a", { x: 30 }], ["b", { x: 20 }]]);

  it("weights each game's lift by its reps; unknown context counts as the reference", () => {
    const bg: ByGame = { a: { n: 10, resid: 0, w: 10 }, b: { n: 10, resid: 0, w: 10 }, c: { n: 20, resid: 0, w: 20 } };
    expect(contextLift(bg, cov, fit)).toBeCloseTo((10 * 0.1) / 40);
  });

  it("takes the lift out of the AE (pts) and keeps the first raw value", () => {
    // 0.001 per unit × (30 − 20) = 0.01 of a rep = 1 pt.
    const fit = { specs: [X], beta: { x: 0.001 }, ref: { x: 20 }, prospects: 10, games: 20, reps: 100 };
    const s: AESample = { ae: 5, n: 10, w: 10, variance: 4, byGame: { a: { n: 10, resid: 0, w: 10 } }, rawAe: 6 };
    expect(adjustForContext(s, cov, fit)).toMatchObject({ ae: 4, rawAe: 6, variance: 4 });
    expect(adjustForContext({ ...s, rawAe: undefined }, cov, fit)).toMatchObject({ ae: 4, rawAe: 5 });
    expect(adjustForContext(s, cov, null)).toBe(s);
  });
});

describe("the held-out test", () => {
  it("needs enough prospects", () => {
    const { samples, cov } = league(0.004, { players: CONTEXT_TEST_MIN_PROSPECTS - 1 });
    expect(heldOutContextTest(samples, cov, [[X]]).testable).toBe(false);
  });

  it("a real effect predicts held-out games better, in most folds and beyond chance", () => {
    const { samples, cov } = league(0.004);
    const t = heldOutContextTest(samples, cov, [[X]]);
    expect(beats(t.models[0], t.none)).toBe(true);
    const v = contextVerdict(samples, cov, [], [X], { permutations: 40 });
    expect(v.passes).toBe(true);
    expect(v.p).toBeLessThanOrEqual(0.05);
  });

  it("noise doesn't pass", () => {
    const { samples, cov } = league(0, { noise: 0.1 });
    expect(contextVerdict(samples, cov, [], [X], { permutations: 40 }).passes).toBe(false);
  });

  it("is reproducible (seeded shuffles)", () => {
    const { samples, cov } = league(0.002, { noise: 0.06 });
    const a = contextVerdict(samples, cov, [], [X], { permutations: 30 });
    const b = contextVerdict(samples, cov, [], [X], { permutations: 30 });
    expect(a.p).toBe(b.p);
  });

  it("shuffling moves values between games, never invents them", () => {
    const cov = new Map<string, Record<string, number>>([["a", { x: 1, y: 9 }], ["b", { x: 2, y: 8 }], ["c", { x: 3 }]]);
    let s = 3;
    const out = shuffleCovariates(cov, ["x", "y"], () => ((s = (s * 7 + 1) % 11) / 11));
    expect(out.get("c")).toEqual({ x: 3 });
    expect([out.get("a")!.x, out.get("b")!.x].sort()).toEqual([1, 2]);
    expect(out.get("a")!.x + out.get("a")!.y).toBe(10);
  });
});
