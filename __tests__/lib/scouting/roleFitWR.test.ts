import { describe, it, expect } from "vitest";
import { wrRoleFit, wrFeatures, WR_MIN_ROUTES, WR_MIN_INAPP_SNAPS, X_PRESS_REPS, X_RELEASE_REPS, type WRRoleInputs, type WRRoleSkill } from "@/lib/scouting/roleFitWR";
import { matchFor, matchTooltip, roleLabel, type AESum } from "@/lib/scouting/roleFit";
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

const X_SKILL = skill({ nine: 10, post: 10, comeback: 10, dig: 8, corner: 8, slant: 10 }, { press: 12, man: 10, zone: 0 });
const SLOT_SKILL = skill({ slant: 12, curl: 12, flat: 12, screen: 4 }, { zone: 12, man: 2, press: -10 });

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
    expect(good.manZoneOverPress).toBeUndefined();
    const weak = wrFeatures(inputs(noPress(-10), null));
    expect(weak.press!.fit).toBe(weak.man!.fit);
    expect(wrFeatures(inputs(X_SKILL, null)).press!.fit).toBeGreaterThan(0.5);
  });

  it("shows an X without press tape as X?, and never lets it win a near tie", () => {
    // Wins on the X routes and vs man, loses badly on curls / flats / outs and vs zone.
    const noPressX = skill({ nine: 14, post: 14, comeback: 14, dig: 14, corner: 14, slant: 14, curl: -25, flat: -25, out: -25, screen: -10 }, { man: 14, zone: -10 }, 40, 0);
    const top = wrRoleFit(inputs(noPressX, lined(140, 30, 30)))!;
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

  it("lets alignment only nudge: a press winner lined up off the line still projects X", () => {
    const fit = wrRoleFit(inputs(X_SKILL, lined(40, 120, 40)))!;
    expect(fit.usedAs).toBe("z");
    expect(fit.best).toBe("x");
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
