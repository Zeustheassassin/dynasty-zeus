import { describe, it, expect } from "vitest";
import { wrRoleFit, wrFeatures, WR_MIN_ROUTES, WR_MIN_INAPP_SNAPS, WR_RECIPES, X_PRESS_REPS, X_RELEASE_REPS, type WRRoleInputs, type WRRoleSkill } from "@/lib/scouting/roleFitWR";
import { matchFor, matchTooltip, roleLabel, scoreBucket, type AESum, type Feature } from "@/lib/scouting/roleFit";
import type { LinedUp } from "@/lib/types";

// A slice where he was `ae` pts above expected on `n` routes.
const sum = (ae: number, n: number): AESum => ({ n, w: n, expected: 0.5 * n, actual: 0.5 * n + (ae / 100) * n });
const ROUTES = ["nine", "post", "dig", "curl", "slant", "screen", "flat", "comeback", "out", "corner"];

function skill(byRoute: Partial<Record<string, number>>, cov: { zone?: number; man?: number; press?: number }, n = 25, pressN = 30): WRRoleSkill {
  return {
    byRoute: Object.fromEntries(ROUTES.map((r) => [r, sum(byRoute[r] ?? 0, n)])),
    zone: sum(cov.zone ?? 0, 120),
    man: sum(cov.man ?? 0, 80),
    press: pressN > 0 ? sum(cov.press ?? 0, pressN) : { n: 0, w: 0, actual: 0, expected: 0 },
  };
}
const lined = (x: number, z: number, slot: number, back = 0): LinedUp => {
  const snaps = x + z + slot + back;
  return { snaps, left_on: x, right_on: 0, left_off: z, right_off: 0, slot_on: 0, slot_off: slot, backfield: back };
};
const inputs = (s: WRRoleSkill, lu: LinedUp | null, extra: Partial<WRRoleInputs> = {}): WRRoleInputs => ({
  skill: s, linedUp: lu, inAppRouteCounts: { nine: 30, post: 20, slant: 30, curl: 30, screen: 10, flat: 10 }, heightIn: 74, weightLb: 205, ...extra,
});

// An X: wins vs press and man on the X routes; no zone receiver.
const X_SKILL = skill({ nine: 10, post: 10, comeback: 10, dig: 8, corner: 8, slant: 10 }, { press: 12, man: 10, zone: -8 });
// The pool's contested catch rate in these tests: 55%.
const POOL_CC = { hits: 55, n: 100 };
// A Slot: wins short vs zone, not deep (so his Z stays under 60).
const SLOT_SKILL = skill({ slant: 12, curl: 12, flat: 12, screen: 4, nine: -8, post: -8, dig: -8 }, { zone: 12, man: 2, press: -10 });

describe("WR role buckets", () => {
  it("makes a press-and-man winner who lines up on the line an X", () => {
    const fit = wrRoleFit(inputs(X_SKILL, lined(140, 30, 30)))!;
    expect(fit.best).toBe("x");
    expect(fit.usedAs).toBe("x");
    expect(matchFor(fit, "x")!.pct).toBeGreaterThan(matchFor(fit, "slot")!.pct + 15);
  });

  it("makes a zone beater on slants, curls and flats who lives inside a Slot, weak press and all", () => {
    const fit = wrRoleFit(inputs(SLOT_SKILL, lined(20, 20, 160)))!;
    expect(fit.best).toBe("slot");
    expect(fit.usedAs).toBe("slot");
  });

  it("leads with where he wins, and says where he was used when that differs", () => {
    const fit = wrRoleFit(inputs(X_SKILL, lined(20, 20, 160)))!;
    expect(fit.usedAs).toBe("slot");
    expect(matchFor(fit, "x")!.pct).toBeGreaterThan(55);
  });

  it("needs WR_MIN_ROUTES", () => {
    const thin = skill({}, {}, Math.floor((WR_MIN_ROUTES - 1) / ROUTES.length), 0);
    expect(wrRoleFit(inputs(thin, null))).toBeNull();
  });

  it("scores skill only without enough in-app snaps", () => {
    const few = lined(WR_MIN_INAPP_SNAPS - 1, 0, 0);
    const fit = wrRoleFit(inputs(X_SKILL, few))!;
    expect(fit.skillOnly).toBe(true);
    expect(fit.usedAs).toBeNull();
    expect(wrRoleFit(inputs(X_SKILL, null))!.skillOnly).toBe(true);
  });

  it("reads untested press as average at best, and no better than his man", () => {
    const noPress = (man: number) => skill({ nine: 10, post: 10, comeback: 10, dig: 8, corner: 8, slant: 10 }, { man }, 25, 0);
    const good = wrFeatures(inputs(noPress(10), null));
    expect(good.press).toMatchObject({ fit: 0.5, n: 0, display: "untested (no in-app press reps)" });
    const weak = wrFeatures(inputs(noPress(-10), null));
    expect(weak.press!.fit).toBe(weak.man!.fit);
    expect(wrFeatures(inputs(X_SKILL, null)).press!.fit).toBeGreaterThan(0.5);
  });

  it("shows an X without press tape as X?, and never lets it win a near tie", () => {
    // Wins vs man and on 50/50 balls, lined up on the line; no route-tree
    // receiver (loses on posts, digs and curls) and weak vs zone.
    const noPressX = skill({ slant: 10, flat: 10, out: 10, post: -10, dig: -10, curl: -10 }, { man: 14, zone: -10 }, 40, 0);
    const top = wrRoleFit(inputs(noPressX, lined(140, 30, 30), { pffContested: { hits: 14, n: 15 }, leaguePffContested: POOL_CC }))!;
    expect(top.best).toBe("x");
    expect(matchFor(top, "x")!.proven).toBe(false);
    expect(roleLabel(top).startsWith("X?")).toBe(true);
    expect(matchTooltip(top, "x")).toContain(`an X needs ${X_PRESS_REPS}+ in-app press reps (has 0)`);
    // Just below another bucket, an unproven X doesn't take the tie.
    const thin = skill({ nine: 3, post: 3, slant: 3 }, { press: 0 }, 25, X_PRESS_REPS - 1);
    expect(matchFor(wrRoleFit(inputs(thin, null))!, "x")!.proven).toBe(false);
  });

  // PFF over his charted games: yards after the catch and missed tackles, each
  // over catches, against a pool at 5.7 yds and 0.17 per catch.
  const POOL = { leaguePffYac: { hits: 5700, n: 1000 }, leaguePffYacMtf: { hits: 170, n: 1000 } };
  const yac = (yds: number, mtf: number, catches = 40) => ({ ...POOL, pffYac: { hits: yds * catches, n: catches }, pffYacMtf: { hits: Math.round(mtf * catches), n: catches } });
  const WEAK = skill({ screen: 4, flat: 2, slant: -4, nine: -10, post: -10, dig: -10, curl: -8, comeback: -10, out: -10, corner: -10 }, { zone: -6, man: -10, press: -10 });

  it("reads Gadget % from yards after the catch and missed tackles (PFF), not from the route tree", () => {
    const g = (extra: Partial<WRRoleInputs>, sk = WEAK) => matchFor(wrRoleFit(inputs(sk, null, extra))!, "gadget")!.pct;
    expect(g(yac(8.5, 0.35))).toBeGreaterThan(75);
    expect(g(yac(3.5, 0.06))).toBeLessThan(25);
    expect(g({})).toBe(50);  // no PFF catches: average
    // The route tree doesn't move it.
    expect(g(yac(8.5, 0.35), X_SKILL)).toBe(g(yac(8.5, 0.35)));
    const f = wrFeatures(inputs(WEAK, null, yac(8.5, 0.35)));
    expect(f.yac!.display).toBe("8.50 vs 5.70 league yds after the catch per catch on 40 catches");
    expect(f.yacMtf!.display).toBe("0.35 vs 0.17 league per catch on 40 catches");
  });

  it("makes a receiver who isn't good enough for X, Z or Slot a Gadget with high YAC, else Special Teams", () => {
    const gadget = wrRoleFit(inputs(WEAK, null, yac(8, 0.3)))!;
    expect(gadget.best).toBe("gadget");
    expect(Math.max(...gadget.matches.filter((m) => m.role !== "gadget" && m.role !== "special_teams").map((m) => m.pct))).toBeLessThan(50);
    const st = wrRoleFit(inputs(WEAK, null, yac(4, 0.08)))!;
    expect(st.best).toBe("special_teams");
    expect(roleLabel(st)).toBe("Special Teams");
    expect(matchFor(st, "gadget")!.pct).toBeLessThan(50);
    // High YAC never pulls a real role down to Gadget.
    expect(wrRoleFit(inputs(X_SKILL, lined(140, 30, 30), yac(9, 0.4)))!.best).toBe("x");
  });

  it("lets alignment only nudge: a clear press winner lined up off the line still projects X", () => {
    // An elite press winner and 50/50 ball winner who isn't a tree-wide receiver.
    const pressX = skill({ nine: 10, comeback: 10, slant: 10, corner: 8 }, { press: 25, man: 10, zone: -8 });
    const cc = { pffContested: { hits: 12, n: 15 }, leaguePffContested: POOL_CC };
    const off = wrRoleFit(inputs(pressX, lined(40, 120, 40), cc))!;
    expect(off.usedAs).toBe("z");
    expect(off.best).toBe("x");
    // Moving him on the line moves X by no more than alignment's share.
    const on = wrRoleFit(inputs(pressX, lined(140, 30, 30), cc))!;
    expect(matchFor(on, "x")!.pct - matchFor(off, "x")!.pct).toBeLessThanOrEqual(10);
  });

  it("doesn't count press for or against a Z (the user, 2026-11-09)", () => {
    const routes = { nine: 8, post: 8, dig: 8, comeback: 8, corner: 8, curl: 8 };
    const winsPress = wrRoleFit(inputs(skill(routes, { man: 8, zone: 6, press: 15 }), lined(40, 120, 40)))!;
    const losesPress = wrRoleFit(inputs(skill(routes, { man: 8, zone: 6, press: -15 }), lined(40, 120, 40)))!;
    expect(matchFor(winsPress, "z")!.pct).toBe(matchFor(losesPress, "z")!.pct);
    expect(matchFor(winsPress, "x")!.pct).toBeGreaterThan(matchFor(losesPress, "x")!.pct);
    expect(losesPress.best).toBe("z");
    // A press winner above 60% at both leads with X, his higher Z after it.
    expect(matchFor(winsPress, "z")!.pct).toBeGreaterThan(matchFor(winsPress, "x")!.pct);
    expect(roleLabel(winsPress)).toBe("X / Z");
  });

  it("leads a do-everything receiver with X, his higher Z after it (the user, 2026-11-09)", () => {
    const all = (ae: number) => Object.fromEntries(ROUTES.filter((r) => r !== "screen").map((r) => [r, ae]));
    const star = wrRoleFit(inputs(skill(all(10), { press: 12, man: 10, zone: 5 }), lined(40, 120, 40)))!;
    expect(matchFor(star, "z")!.pct).toBeGreaterThan(matchFor(star, "x")!.pct);
    expect(star.versatile).toBe(true);
    expect(roleLabel(star)).toBe("X / Z");
    expect(star.leadNote).toMatch(/^X leads over Z \d+%/);
  });

  it("weights a Z's route tree toward the intermediate and deep routes", () => {
    const deep = wrFeatures(inputs(skill({ post: 10, dig: 10, corner: 10 }, {}), null)).tree!;
    const short = wrFeatures(inputs(skill({ slant: 10, flat: 10, out: 10 }, {}), null)).tree!;
    expect(deep.fit).toBeGreaterThan(short.fit);
    expect(short.fit).toBeGreaterThan(0.5);
    expect(deep.display).toBe("winning on 3 of 9 (post, dig, corner)");
  });

  it("gives a Z a slight edge vs man over zone", () => {
    // The same fit vs man as the other's vs zone (the scales differ, so read fits).
    const zRecipe = WR_RECIPES.find((r) => r.role === "z")!;
    const feat = (fit: number): Feature => ({ label: "", kind: "skill", fit, display: "" });
    const z = (man: number, zone: number) => scoreBucket(zRecipe, { tree: feat(0.6), man: feat(man), zone: feat(zone) }, null, null).pct;
    expect(z(0.9, 0.5)).toBeGreaterThan(z(0.5, 0.9));
  });

  it("counts curls and outs toward the X routes, a little less than the rest", () => {
    const xr = (byRoute: Partial<Record<string, number>>) => wrFeatures(inputs(skill(byRoute, {}), null)).xRoutes!;
    const curlOut = xr({ curl: 10, out: 10 }), postDig = xr({ post: 10, dig: 10 });
    expect(curlOut.fit).toBeGreaterThan(0.5);
    expect(postDig.fit).toBeGreaterThan(curlOut.fit);
    // The display counts real routes: 8 route types × 25.
    expect(postDig.display).toMatch(/ on 200 routes$/);
  });

  it("counts the better of separating and 50/50 balls (PFF) toward X: either kind of X (the user, 2026-11-09)", () => {
    const cc = (hits: number) => ({ pffContested: { hits, n: 15 }, leaguePffContested: POOL_CC });
    const x = (sk: WRRoleSkill, extra: Partial<WRRoleInputs>) => matchFor(wrRoleFit(inputs(sk, lined(140, 30, 30), extra))!, "x")!.pct;
    // A separator isn't docked for losing 50/50 balls.
    expect(x(X_SKILL, cc(3))).toBe(x(X_SKILL, {}));
    expect(wrFeatures(inputs(X_SKILL, null, cc(3))).xWin!.display).toMatch(/^separating, /);
    // A contested-catch merchant who doesn't separate gets his X from the 50/50 balls.
    const merchant = skill({ nine: -4, post: -4, comeback: -4, dig: -4, corner: -4, slant: -4 }, { press: 12, man: 4, zone: -8 });
    expect(x(merchant, cc(14))).toBeGreaterThan(x(merchant, {}) + 8);
    expect(wrFeatures(inputs(merchant, null, cc(14))).xWin!.display).toMatch(/^50\/50 balls, 93% vs 55% league on 15 contested targets/);
    // Z doesn't read them.
    const z = (extra: Partial<WRRoleInputs>) => matchFor(wrRoleFit(inputs(X_SKILL, lined(140, 30, 30), extra))!, "z")!.pct;
    expect(z(cc(14))).toBe(z({}));
    // No contested targets: average.
    const none = wrFeatures(inputs(X_SKILL, null, { leaguePffContested: POOL_CC })).contested!;
    expect(none).toMatchObject({ fit: 0.5, display: "no contested targets yet" });
  });

  it("drops a 5'7\" 170 as an X, unless he's elite at the X skills", () => {
    const solid = skill({ nine: 3, post: 3, slant: 3 }, { press: 3, man: 3 });
    const small = { heightIn: 67, weightLb: 170 };
    const plain = matchFor(wrRoleFit(inputs(solid, lined(140, 30, 30), small))!, "x")!;
    expect(plain.sizeDrop).toBeCloseTo(0.45);
    const elite = matchFor(wrRoleFit(inputs(skill({ nine: 25, post: 25, comeback: 25, dig: 25, corner: 25, slant: 25 }, { press: 25, man: 25 }, 60, 80), lined(140, 30, 30), small))!, "x")!;
    expect(elite.sizeDrop).toBeLessThan(0.15);
    expect(elite.pct).toBeGreaterThan(plain.pct);
  });

  it("keeps Slot and Gadget open to any size", () => {
    const fit = wrRoleFit(inputs(SLOT_SKILL, lined(20, 20, 160), { heightIn: 67, weightLb: 165 }))!;
    expect(matchFor(fit, "slot")!.sizeDrop).toBe(0);
    expect(matchFor(fit, "gadget")!.sizeDrop).toBe(0);
  });
});

describe("WR X reads release vs press (tagged, Stage 4)", () => {
  it(`leaves X% exactly as it was without ${X_RELEASE_REPS} tagged press reps`, () => {
    const base = wrRoleFit(inputs(X_SKILL, lined(140, 30, 30)))!;
    const thin = wrRoleFit(inputs(X_SKILL, lined(140, 30, 30), { release: { won: 9, n: X_RELEASE_REPS - 1 }, leagueRelease: 0.5 }))!;
    expect(thin.matches).toEqual(base.matches);
    expect(thin.features.release).toBeUndefined();
  });

  it("raises an X who wins his releases and lowers one who loses them", () => {
    const base = matchFor(wrRoleFit(inputs(X_SKILL, lined(140, 30, 30)))!, "x")!.pct;
    const wins = matchFor(wrRoleFit(inputs(X_SKILL, lined(140, 30, 30), { release: { won: 36, n: 40 }, leagueRelease: 0.55 }))!, "x")!.pct;
    const loses = matchFor(wrRoleFit(inputs(X_SKILL, lined(140, 30, 30), { release: { won: 8, n: 40 }, leagueRelease: 0.55 }))!, "x")!.pct;
    expect(wins).toBeGreaterThan(base);
    expect(loses).toBeLessThan(base);
  });
});
