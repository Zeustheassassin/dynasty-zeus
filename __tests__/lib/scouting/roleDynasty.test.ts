import { describe, it, expect } from "vitest";
import type { AEComposite } from "@/lib/scouting/aeComposite";
import type { DynastyBreakdown } from "@/lib/scouting/dynastyScore";
import type { ScoreView } from "@/lib/scouting/prospectScores";
import type { Feature, RoleFit } from "@/lib/scouting/roleFit";
import { ROLE_DYNASTY_MIN_POOL, roleDynastyScores, type RoleDynastyProspect } from "@/lib/scouting/roleDynasty";

// Two ready separation metrics at weight 1: each adds z / 2 to the AE Score.
const composite = {
  positions: {
    WR: { pos: "WR", metrics: [
      { key: "sae", label: "SAE", weight: 1, ready: true },
      { key: "csae", label: "cSAE", weight: 1, ready: true },
    ] },
  },
} as unknown as AEComposite;

const skill = (fit: number): Feature => ({ label: "s", kind: "skill", fit, display: "", n: 50 });
const usage = (fit: number): Feature => ({ label: "u", kind: "usage", fit, display: "" });

interface Spec { press: number; zone: number; slotRoutes: number; tree?: number; xShare?: number; sepZ: number; dyn?: number; cls?: number; pos?: string }

function build(specs: Record<string, Spec>) {
  const prospects: RoleDynastyProspect[] = [];
  const views = new Map<string, ScoreView>();
  const dynasty = new Map<string, DynastyBreakdown>();
  const fits = new Map<string, RoleFit>();
  for (const [id, s] of Object.entries(specs)) {
    prospects.push({ id, position: s.pos ?? "WR", draft_class_year: s.cls ?? 2027, height: `6'2"`, weight: 205 });
    views.set(id, { score: s.sepZ, components: [
      { key: "sae", label: "SAE", weight: 1, z: s.sepZ, ae: 0, n: 100, reliability: 1, tau: 1 },
      { key: "csae", label: "cSAE", weight: 1, z: s.sepZ, ae: 0, n: 100, reliability: 1, tau: 1 },
    ] } as unknown as ScoreView);
    dynasty.set(id, { dynasty: s.dyn ?? s.sepZ } as DynastyBreakdown);
    fits.set(id, {
      pos: s.pos ?? "WR",
      features: {
        press: skill(s.press), man: skill(0.5), xWin: skill(0.5), zone: skill(s.zone), tree: skill(s.tree ?? 0.5),
        slotRoutes: skill(s.slotRoutes), xShare: usage(s.xShare ?? 0.5), zShare: usage(0.5), slotShare: usage(0.5),
      },
    } as unknown as RoleFit);
  }
  return { prospects, views, dynasty, fits };
}

// A pool of ten with a spread at every role.
const POOL: Record<string, Spec> = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`p${i}`, { press: 0.2 + i * 0.06, zone: 0.75 - i * 0.04, slotRoutes: 0.3 + (i % 5) * 0.1, tree: 0.4 + (i % 3) * 0.1, sepZ: -1 + i * 0.2 }]),
);

const run = (specs: Record<string, Spec>) => {
  const b = build(specs);
  return roleDynastyScores(b.prospects, b.views, b.dynasty, b.fits, composite);
};

describe("roleDynastyScores", () => {
  it("swaps his separation for his separation at the role, keeping the rest of his Dynasty", () => {
    const specs = { ...POOL, me: { press: 0.2, zone: 0.75, slotRoutes: 0.75, sepZ: 0.8, dyn: 0.9 } };
    const out = run(specs);
    const me = out.get("me")!;
    expect(me.dynasty).toBe(0.9);
    expect(me.ownSeparation).toBeCloseTo(0.8, 6); // sae z/2 + csae z/2
    expect(me.pool).toBe(11);
    const x = me.roles.find((e) => e.role === "x")!;
    const slot = me.roles.find((e) => e.role === "slot")!;
    // Beats zone, loses to press: a poor X, a good Slot.
    expect(x.score).toBeLessThan(me.dynasty);
    expect(slot.score).toBeGreaterThan(x.score);
    for (const e of me.roles) expect(e.score).toBeCloseTo(me.dynasty - me.ownSeparation + e.separation, 9);
    // The separation at a role is the pool's average plus z × the pool's spread.
    const seps = [...out.values()].map((r) => r.ownSeparation);
    const m = seps.reduce((a, b) => a + b, 0) / seps.length;
    const sd = Math.sqrt(seps.reduce((a, b) => a + (b - m) ** 2, 0) / (seps.length - 1));
    expect(x.separation).toBeCloseTo(m + x.z * sd, 9);
  });

  it("leaves where he lined up out: an X's alignment doesn't move his X score", () => {
    const a = run({ ...POOL, me: { press: 0.3, zone: 0.6, slotRoutes: 0.6, sepZ: 0.2, xShare: 1 } }).get("me")!;
    const b = run({ ...POOL, me: { press: 0.3, zone: 0.6, slotRoutes: 0.6, sepZ: 0.2, xShare: 0 } }).get("me")!;
    expect(a.roles.find((e) => e.role === "x")!.score).toBeCloseTo(b.roles.find((e) => e.role === "x")!.score, 9);
  });

  it("ranks within his class at each role; ties share the better rank", () => {
    const specs: Record<string, Spec> = { ...POOL, a: { press: 0.9, zone: 0.5, slotRoutes: 0.5, sepZ: 0 }, b: { press: 0.9, zone: 0.5, slotRoutes: 0.5, sepZ: 0 }, n: { press: 0.95, zone: 0.5, slotRoutes: 0.5, sepZ: 0, cls: 2028 } };
    const out = run(specs);
    const xa = out.get("a")!.roles.find((e) => e.role === "x")!;
    const xb = out.get("b")!.roles.find((e) => e.role === "x")!;
    expect(xa.inClass).toEqual(xb.inClass);
    expect(xa.inClass).toEqual({ rank: 1, of: 12 });
    expect(out.get("n")!.roles.find((e) => e.role === "x")!.inClass).toEqual({ rank: 1, of: 1 }); // alone in 2028
  });

  it("covers WRs only, and needs a pool to read a spread against", () => {
    const out = run({ ...POOL, te: { press: 0.5, zone: 0.5, slotRoutes: 0.5, sepZ: 0, pos: "TE" } });
    expect(out.has("te")).toBe(false);
    expect([...out.values()][0].roles.map((e) => e.role)).toEqual(["x", "z", "slot"]);
    const small = Object.fromEntries(Object.entries(POOL).slice(0, ROLE_DYNASTY_MIN_POOL - 1));
    expect(run(small).size).toBe(0);
  });
});
