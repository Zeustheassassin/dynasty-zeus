import { describe, it, expect } from "vitest";
import { rbRoleFit, computeRBRoleFits, runSideTag, GOAL_LINE_NAMED_LB, RB_MIN_RUNS, RB_SY_TAG_MIN, type RBRoleInputs } from "@/lib/scouting/roleFitRB";
import { matchFor, matchTooltip, roleFitTooltip, roleLabel, RUN_SIDE_GAP, RUN_SIDE_MIN_RUNS } from "@/lib/scouting/roleFit";
import type { Prospect, RBPlay, RBRunType, ScoutingGame } from "@/lib/types";
import type { PffTotals } from "@/lib/pff/totals";

const play = (over: Partial<RBPlay>): RBPlay => ({
  id: "", user_id: "", game_id: "g", formation: "gun", run_type: "inside_zone", success: true,
  loaded_box: false, unblocked_defender: false, broken_tackle: false, explosive_play: false, run_stuff: false,
  play_notes: null, aligned_as_wr: false, targeted: false, route_type: null, was_open: null, created_at: "", ...over,
});
const runs = (n: number, run_type: RBRunType, over: Partial<RBPlay> = {}) => Array.from({ length: n }, () => play({ run_type, ...over }));
const routes = (n: number, open: number) => Array.from({ length: n }, (_, i) => play({ run_type: "route", success: null, was_open: i < open, route_type: "flats" }));
const passBlocks = (n: number, won: number) => Array.from({ length: n }, (_, i) => play({ run_type: "pass_block", success: i < won }));

// League rates: stuffed 15%, pass pro 70%, open on routes 60%, on longer
// routes 45%, drops 9% of targets, tagged short-yardage runs converted 70%.
// PFF pool: 10+ yard runs 16% of carries, missed tackles 0.26 and yards after
// contact 3.00 per carry.
const LEAGUE = {
  stuff: { hits: 15, n: 100 },
  passPro: { hits: 70, n: 100 }, open: { hits: 60, n: 100 }, bigOpen: { hits: 45, n: 100 }, drops: { hits: 9, n: 100 },
  shortYardage: { hits: 70, n: 100 },
};
const PFF_POOL = { leaguePffExplosive: { hits: 16, n: 100 }, leaguePffMissedTackles: { hits: 26, n: 100 }, leaguePffYco: { hits: 300, n: 100 } };
const slices = (s: Partial<Record<"all" | "loaded" | "zone" | "gap" | "inside" | "outside", [number, number]>>): RBRoleInputs["slices"] => ({
  all: { ae: s.all?.[0] ?? 0, n: s.all?.[1] ?? 100 },
  loaded: { ae: s.loaded?.[0] ?? 0, n: s.loaded?.[1] ?? 10 },
  zone: { ae: s.zone?.[0] ?? 0, n: s.zone?.[1] ?? 50 },
  gap: { ae: s.gap?.[0] ?? 0, n: s.gap?.[1] ?? 50 },
  inside: { ae: s.inside?.[0] ?? 0, n: s.inside?.[1] ?? 50 },
  // Unset, outside mirrors inside: no split, so no Inside / Outside tag in tests about the roles.
  outside: { ae: (s.outside ?? s.inside)?.[0] ?? 0, n: (s.outside ?? s.inside)?.[1] ?? 50 },
});
const fit = (plays: RBPlay[], sl: RBRoleInputs["slices"], heightIn: number | null = 71, weightLb: number | null = 212, pff: Partial<RBRoleInputs> = {}) =>
  rbRoleFit({ plays, slices: sl, league: LEAGUE, heightIn, weightLb, ...PFF_POOL, ...pff });

describe("RB role buckets", () => {
  it("makes a back who wins on zone runs, and runs mostly zone, a Zone runner", () => {
    const f = fit([...runs(75, "inside_zone"), ...runs(25, "inside_man_gap"), ...routes(15, 9), ...passBlocks(10, 7)],
      slices({ all: [6, 100], zone: [14, 75], gap: [-4, 25] }))!;
    expect(f.best).toBe("zone");
    expect(f.usedAs).toBe("zone");
  });

  it("makes a heavy back who wins on gap runs and breaks tackles (PFF missed tackles), but can't pass block, a Gap/Power back", () => {
    const f = fit([...runs(25, "inside_zone"), ...runs(75, "inside_man_gap"), ...passBlocks(20, 8)],
      slices({ all: [6, 100], zone: [-4, 25], gap: [12, 75], loaded: [10, 20] }), 72, 228, { pffMissedTackles: { hits: 38, n: 100 } })!;
    expect(f.best).toBe("gap");
    expect(f.features.btk!.display).toBe("0.38 vs 0.26 league per carry on 100 carries");
  });

  it("makes a back who runs routes and gets open a Receiving back", () => {
    const plays = [...runs(30, "outside_zone"), ...runs(30, "inside_man_gap"), ...routes(50, 42)];
    plays.push(...Array.from({ length: 10 }, () => play({ run_type: "route", success: true, targeted: true, was_open: true, route_type: "big_boy_route" })));
    const f = fit(plays, slices({ all: [-3, 60], zone: [-3, 30], gap: [-3, 30] }))!;
    expect(f.best).toBe("receiving"); // level C: no Zone or Gap/Power role
  });

  it("makes a back with explosive runs (PFF 10+ yards) and stuffs a Big-play back", () => {
    const plays = runs(80, "outside_zone").map((p, i) => ({ ...p, run_stuff: i >= 60 }));
    const f = fit(plays, slices({ all: [0, 80], zone: [0, 80], gap: [0, 0] }), 71, 212, { pffExplosive: { hits: 24, n: 80 } })!;
    expect(matchFor(f, "big_play")!.pct).toBe(Math.max(...f.matches.map((m) => m.pct)));
  });

  it("reads explosive runs and broken tackles as neutral without PFF rows, never off the old charted buttons", () => {
    const plays = runs(80, "outside_zone", { explosive_play: true, broken_tackle: true });
    const f = fit(plays, slices({ all: [0, 80], zone: [0, 80], gap: [0, 0] }))!;
    expect(f.features.explosive!.fit).toBe(0.5);
    expect(f.features.btk!.fit).toBe(0.5);
  });

  // A Jadan Baugh-like back: wins on zone and gap runs, 0 drops on 13 targets
  // (3 of them uncatchable, not drops), wins 22 of 24 pass blocks, 231 lb,
  // and his college barely used him on passing downs.
  const targets = (n: number, caught: number, drops: number) => Array.from({ length: n }, (_, i) =>
    play({ run_type: "route", targeted: true, was_open: true, route_type: "flats", success: i < caught ? true : i < caught + drops ? false : null }));
  const workhorse = (hands = targets(13, 10, 0), blocks = passBlocks(24, 22)) =>
    [...runs(55, "inside_zone"), ...runs(48, "inside_man_gap"), ...hands, ...blocks];
  const WORKHORSE_SLICES = slices({ all: [12, 103], zone: [12, 55], gap: [10, 48] });

  it("makes a big back who runs well in both schemes, has no drops and blocks decently a Three-down back, whatever his college usage", () => {
    const f = fit(workhorse(), WORKHORSE_SLICES, 73, 231)!;
    expect(f.best).toBe("three_down");
    expect(matchFor(f, "three_down")!.pct).toBeGreaterThanOrEqual(75);
    expect(f.features.passGame!.fit).toBe(0); // 26% passing-down snaps: no credit, and none needed
  });

  it("cuts Three-down for drops and for poor pass protection, but not for uncatchable balls", () => {
    const pct = (plays: RBPlay[]) => matchFor(fit(plays, WORKHORSE_SLICES, 73, 231)!, "three_down")!.pct;
    const clean = pct(workhorse());
    expect(pct(workhorse(targets(13, 13, 0)))).toBe(clean);          // 3 more catches instead of uncatchables: same
    expect(pct(workhorse(targets(13, 7, 3)))).toBeLessThan(clean - 10); // 3 drops
    expect(pct(workhorse(undefined, passBlocks(24, 14)))).toBeLessThan(clean - 10); // 58% pass pro
  });

  it("doesn't make an average runner a workhorse just for clearing the bars", () => {
    const f = fit(workhorse(), slices({ all: [0, 103], zone: [0, 55], gap: [0, 48] }), 72, 215)!;
    expect(matchFor(f, "three_down")!.pct).toBeLessThan(55);
  });

  it("doesn't cut a back with no targets charted for unknown hands", () => {
    const f = fit([...runs(55, "inside_zone"), ...runs(48, "inside_man_gap"), ...passBlocks(24, 22)], WORKHORSE_SLICES, 73, 231)!;
    expect(f.features.handsOk).toBeUndefined();
    expect(matchFor(f, "three_down")!.drivers.join(" ")).not.toContain("Hands");
  });

  it("holds a 5'7\" 185 back out of Three-down", () => {
    const plays = [...runs(60, "inside_zone"), ...routes(30, 20), ...passBlocks(20, 16)];
    const m = matchFor(fit(plays, slices({ all: [2, 60] }), 67, 185)!, "three_down")!;
    expect(m.sizeDrop).toBeCloseTo(2 * 0.06 + 20 * 0.006);
  });

  it(`needs ${RB_MIN_RUNS} known runs`, () => {
    expect(fit(runs(RB_MIN_RUNS - 1, "inside_zone"), slices({}))).toBeNull();
  });

  it("scores every RB from the league's plays, and only RBs", () => {
    const prospects = [
      { id: "rb", position: "RB", height: "5'11\"", weight: 210 },
      { id: "wr", position: "WR", height: "", weight: null },
    ] as unknown as Prospect[];
    const games = [{ id: "g1", prospect_id: "rb", season_year: 2025 }, { id: "g2", prospect_id: "lg", season_year: 2025 }] as unknown as ScoutingGame[];
    const league = [
      ...runs(40, "inside_zone", { game_id: "g1" }).map((p, i) => ({ ...p, success: i % 3 !== 0 })),
      ...runs(60, "inside_zone", { game_id: "g2" }).map((p, i) => ({ ...p, success: i % 2 === 0 })),
    ];
    const fits = computeRBRoleFits(prospects, games, league);
    expect([...fits.keys()]).toEqual(["rb"]);
    const f = fits.get("rb")!;
    expect(f.sample).toEqual({ n: 40, unit: "runs" });
    expect(f.features.srae!.display).toMatch(/^\+\d/); // 67% vs the league's 58%
  });

  it("takes each back's PFF 10+ runs and missed tackles over his charted games, against every back's", () => {
    const prospects = [
      { id: "a", position: "RB", height: "5'11\"", weight: 210 },
      { id: "b", position: "RB", height: "5'11\"", weight: 210 },
    ] as unknown as Prospect[];
    const games = [{ id: "ga", prospect_id: "a", season_year: 2025 }, { id: "gb", prospect_id: "b", season_year: 2025 }] as unknown as ScoutingGame[];
    const league = [...runs(40, "inside_zone", { game_id: "ga" }), ...runs(40, "inside_zone", { game_id: "gb" })];
    const sum = (rush_att: number, rush_10plus: number, rush_mtf: number) => ({ sum: { rush_att, rush_10plus, rush_mtf, pressures_allowed: null, pass_block_snaps: null } }) as unknown as PffTotals;
    const fits = computeRBRoleFits(prospects, games, league, new Map([["a", sum(60, 12, 18)], ["b", sum(40, 4, 8)]]));
    expect(fits.get("a")!.features.explosive!.display).toBe("20% vs 16% league on 60 carries");
    expect(fits.get("b")!.features.btk!.display).toBe("0.20 vs 0.26 league per carry on 40 carries");
  });
});

describe("RB Goal-line (the user's recipe, 2026-10-07)", () => {
  // A 225 lb back who wins inside and vs a loaded box, runs through contact
  // and is rarely stuffed, and also wins on zone runs.
  const plays = [...runs(70, "inside_zone"), ...runs(30, "inside_man_gap")];
  const POWER_SLICES = slices({ all: [8, 100], zone: [10, 70], gap: [6, 30], inside: [10, 100], loaded: [8, 30] });
  const PFF = { pffYco: { hits: 400, n: 100 }, pffMissedTackles: { hits: 35, n: 100 } };

  it("makes a heavy back who wins inside and through contact a Goal-line fit, named after his Zone role", () => {
    // 4 drops in 10 targets keep him out of Three-down.
    const drops = Array.from({ length: 10 }, (_, i) => play({ run_type: "route", targeted: true, was_open: true, route_type: "flats", success: i >= 4 }));
    const f = fit([...plays, ...drops], POWER_SLICES, 72, 225, PFF)!;
    expect(matchFor(f, "goal_line")!.pct).toBeGreaterThanOrEqual(75);
    expect(matchFor(f, "zone")!.pct).toBeGreaterThanOrEqual(60);
    expect(f.best).toBe("zone"); // level B leads, Goal-line (level D) follows
    expect(f.also[f.also.length - 1]).toBe("goal_line");
    expect(roleLabel(f)).toMatch(/^Zone \/.* Goal-line$/);
    expect(f.features.yco!.display).toBe("4.00 vs 3.00 league yds after contact per carry on 100 carries");
    expect(f.features.notStuffed!.fit).toBeGreaterThan(0.5);
  });

  it("drops a light back under the 215 lb floor", () => {
    expect(matchFor(fit(plays, POWER_SLICES, 70, 195, PFF)!, "goal_line")!.sizeDrop).toBeGreaterThan(0);
  });

  it(`grades an elite small back well at Goal-line but never names him one under ${GOAL_LINE_NAMED_LB} lb`, () => {
    // Elite inside and through contact at 5'7" 193 (the Wayne Knight case, 2026-10-08).
    const elite = slices({ all: [12, 100], zone: [12, 70], gap: [12, 30], inside: [20, 100], loaded: [25, 30] });
    const small = fit(plays, elite, 67, 193, { pffYco: { hits: 700, n: 100 } })!;
    const gl = matchFor(small, "goal_line")!;
    expect(gl.pct).toBeGreaterThanOrEqual(75);
    expect(gl.unnamed).toBe(`5'7" 193 under 200`);
    expect([small.best, ...small.also]).not.toContain("goal_line");
    expect(matchTooltip(small, "goal_line")).toContain(`Never named as his role: 5'7" 193 under 200`);
    // At 200 lb he can be named again.
    const bigger = fit(plays, elite, 67, GOAL_LINE_NAMED_LB, { pffYco: { hits: 700, n: 100 } })!;
    expect(matchFor(bigger, "goal_line")!.unnamed).toBeUndefined();
    expect([bigger.best, ...bigger.also]).toContain("goal_line");
  });

  it("leaves Power out until he has a graded game, then reads it against the scale's midpoint", () => {
    const AVG = slices({ all: [0, 100], inside: [0, 100] });
    const base = fit(plays, AVG, 72, 225)!;
    expect(base.features.power).toBeUndefined();
    const strong = fit(plays, AVG, 72, 225, { power: { avg: 9, games: 3 } })!;
    expect(strong.features.power!.display).toBe("9.0 / 10 over 3 graded games");
    expect(matchFor(strong, "goal_line")!.pct).toBeGreaterThan(matchFor(base, "goal_line")!.pct);
    const weak = fit(plays, AVG, 72, 225, { power: { avg: 2, games: 3 } })!;
    expect(matchFor(weak, "goal_line")!.pct).toBeLessThan(matchFor(base, "goal_line")!.pct);
  });

  it(`counts tagged short-yardage runs only from ${RB_SY_TAG_MIN} on`, () => {
    const sy = (n: number, made: number) => Array.from({ length: n }, (_, i) => play({ run_type: "inside_man_gap", short_yardage: true, success: i < made }));
    expect(fit([...plays, ...sy(RB_SY_TAG_MIN - 1, 9)], POWER_SLICES, 72, 225, PFF)!.features.shortYardage).toBeUndefined();
    const f = fit([...plays, ...sy(RB_SY_TAG_MIN, 10)], POWER_SLICES, 72, 225, PFF)!;
    expect(f.features.shortYardage!.display).toBe("100% vs 70% league on 10 tagged runs");
    expect(f.features.shortYardage!.fit).toBeGreaterThan(0.5);
  });

  it("reads his Power grades off the charted games' trait grades", () => {
    const prospects = [{ id: "a", position: "RB", height: "6'0", weight: 225 }] as unknown as Prospect[];
    const games = [
      { id: "g1", prospect_id: "a", season_year: 2026, created_at: "2026-10-06T00:00:00Z", trait_grades: { power: 8 } },
      { id: "g0", prospect_id: "a", season_year: 2026, created_at: "2026-09-01T00:00:00Z", trait_grades: null },
    ] as unknown as ScoutingGame[];
    const fits = computeRBRoleFits(prospects, games, runs(40, "inside_zone", { game_id: "g1" }));
    expect(fits.get("a")!.features.power!.display).toBe("8.0 / 10 over 1 graded game");
  });
});

describe("RB Three-down pass-pro gate adds PFF pass blocking (Stage 4)", () => {
  const plays = [...runs(80, "inside_zone"), ...runs(40, "outside_zone"), ...passBlocks(20, 14)];
  const three = (extra: Partial<RBRoleInputs>) =>
    matchFor(rbRoleFit({ plays, slices: slices({ all: [6, 120] }), league: LEAGUE, heightIn: 72, weightLb: 222, ...extra })!, "three_down")!.pct;

  it("is unchanged without PFF pass-block snaps", () => {
    expect(three({})).toBe(three({ pffPassPro: null, leaguePffPassPro: { hits: 7, n: 100 } }));
  });

  it("cuts a back PFF says gives up pressure, and keeps one who gives up none", () => {
    const leaky = three({ pffPassPro: { hits: 12, n: 60 }, leaguePffPassPro: { hits: 7, n: 100 } });
    const clean = three({ pffPassPro: { hits: 0, n: 60 }, leaguePffPassPro: { hits: 7, n: 100 } });
    expect(leaky).toBeLessThan(three({}));
    expect(clean).toBeGreaterThanOrEqual(three({}));
  });
});

describe("RB 2-Down, 3rd-Down and Blocking/ST (the user's definitions, 2026-10-08)", () => {
  const targets = (n: number, drops: number) => Array.from({ length: n }, (_, i) =>
    play({ run_type: "route", targeted: true, was_open: true, route_type: "flats", success: i >= drops }));
  const quietRoutes = (n: number, open: number) => routes(n, open).map((p) => ({ ...p, route_type: "flats" as const }));
  const RUNNER = slices({ all: [10, 100], zone: [10, 50], gap: [10, 50] });
  const AVERAGE_RUNNER = slices({ all: [0, 100], zone: [0, 50], gap: [0, 50] });
  const runner = (passing: RBPlay[]) => [...runs(50, "inside_zone"), ...runs(50, "inside_man_gap"), ...passing];

  it("names a good, heavy runner who can't pass block and doesn't catch well 2-Down, after his run role", () => {
    const f = fit(runner([...passBlocks(25, 10), ...quietRoutes(15, 5), ...targets(10, 3)]), RUNNER, 72, 225)!;
    expect(f.best).not.toBe("three_down");
    expect(f.also[0]).toBe("two_down");
    // +10 on zone and on gap runs: Scheme Versatile (2026-10-15) is his level-B role.
    expect(roleLabel(f)).toMatch(/^Scheme Versatile \/ 2-Down/);
    expect(matchFor(f, "two_down")!.pct).toBeGreaterThan(matchFor(f, "three_down")!.pct + 15);
    expect(matchFor(f, "two_down")!.drivers.join(" ")).toContain("Not good in pass protection");
  });

  it("moves Three-down and 2-Down in opposite directions for the same runner", () => {
    const f = fit(runner([...passBlocks(25, 23), ...quietRoutes(15, 13), ...targets(10, 0)]), RUNNER, 72, 225)!;
    expect(f.best).toBe("three_down");
    expect(matchFor(f, "two_down")!.pct).toBeLessThan(30);
    expect(matchFor(f, "two_down")!.drivers).toContain("− Holds up in pass protection (−50%)");
  });

  it("makes an average runner who excels in pass pro and as a receiver a 3rd-Down back, and cuts it for a good runner", () => {
    const passing = [...passBlocks(25, 25), ...quietRoutes(15, 14), ...targets(10, 0)];
    const f = fit(runner(passing), AVERAGE_RUNNER, 71, 210)!;
    expect(f.best).toBe("third_down");
    expect(matchFor(f, "third_down")!.pct).toBeGreaterThanOrEqual(60);
    const good = fit(runner(passing), RUNNER, 71, 210)!;
    expect(matchFor(good, "third_down")!.pct).toBeLessThan(matchFor(f, "third_down")!.pct - 15);
    expect(matchFor(good, "third_down")!.drivers.join(" ")).toContain("Good runner");
  });

  it("reads PFF yards per route run as receiving skill: a productive receiver isn't 2-Down", () => {
    // Open a bit under the league's rate and can't pass block; PFF says what he does with his routes.
    const passing = [...passBlocks(25, 10), ...quietRoutes(15, 8), ...targets(10, 2)];
    const pool = { leaguePffYprr: { hits: 100, n: 100 } };
    const quiet = fit(runner(passing), RUNNER, 69, 195, { ...pool, pffYprr: { hits: 25, n: 25 } })!;
    const productive = fit(runner(passing), RUNNER, 69, 195, { ...pool, pffYprr: { hits: 75, n: 25 } })!;
    expect(productive.features.yprr!.display).toBe("3.00 vs 1.00 league yds per route run on 25 routes");
    expect(matchFor(productive, "receiving")!.pct).toBeGreaterThan(matchFor(quiet, "receiving")!.pct + 5);
    expect(matchFor(productive, "two_down")!.pct).toBeLessThan(matchFor(quiet, "two_down")!.pct - 15);
    expect(matchFor(productive, "two_down")!.drivers.join(" ")).toContain("Good receiver");
    // Without PFF rows it reads neutral.
    expect(fit(runner(passing), RUNNER, 69, 195)!.features.yprr!.fit).toBe(0.5);
  });

  it("holds a back who can't pass block out of 3rd-Down, however well he catches", () => {
    const f = fit(runner([...passBlocks(25, 8), ...quietRoutes(15, 14), ...targets(10, 0)]), AVERAGE_RUNNER, 71, 210)!;
    expect(matchFor(f, "third_down")!.pct).toBeLessThan(50);
  });

  const BAD = slices({ all: [-15, 100], zone: [-15, 50], gap: [-15, 50], inside: [-15, 100], loaded: [-15, 20] });
  const NO_PLAYS = { pffExplosive: { hits: 6, n: 100 }, pffMissedTackles: { hits: 10, n: 100 }, pffYco: { hits: 220, n: 100 } };
  const stuffed = (plays: RBPlay[]) => plays.map((p, i) => (i < 15 ? { ...p, run_stuff: true } : p));

  const poorReceiver = () => [...quietRoutes(15, 4), ...targets(10, 4)];
  const blocker = (won: number) => fit(stuffed(runner([...passBlocks(25, won), ...poorReceiver()])), BAD, 70, 200, NO_PLAYS)!;

  it("makes a back terrible at everything but blocking Blocking/ST", () => {
    const f = blocker(25);
    expect(Math.max(...f.matches.filter((m) => m.role !== "blocking_st").map((m) => m.pct))).toBeLessThan(40);
    expect(f.best).toBe("blocking_st");
    expect(roleLabel(f)).toBe("Blocking/ST");
  });

  it("doesn't call a back Blocking/ST when he can't block either, or when he's decent at something else", () => {
    expect(blocker(12).best).not.toBe("blocking_st");
    const canRun = fit(runner([...passBlocks(25, 25), ...poorReceiver()]), RUNNER, 72, 225)!;
    expect(canRun.best).not.toBe("blocking_st");
    expect(matchFor(canRun, "blocking_st")!.pct).toBeLessThan(matchFor(blocker(25), "blocking_st")!.pct); // cut for running well
  });
});

// Inside / Outside tags (the user, 2026-10-15): "+ in one and - in the other with a significant
// difference"; above average on both or below on both gets neither. Real 2026-10-15 numbers.
describe("RB Inside / Outside tags", () => {
  const side = (inside: [number, number], outside: [number, number]) => runSideTag({
    inside: { ae: inside[0], n: inside[1] }, outside: { ae: outside[0], n: outside[1] },
  });

  it("tags the user's examples", () => {
    expect(side([21.9, 42], [-8.4, 30])?.label).toBe("Inside");   // Marcellous Hawkins
    expect(side([14.5, 28], [-16.9, 18])?.label).toBe("Inside");  // Nate Frazier
    expect(side([-10.8, 16], [4.4, 16])?.label).toBe("Outside");  // Isaac Brown, 5.3 apart
  });

  it("gives neither to a back below average on both sides, however far apart (Dilin Jones, Demond Claiborne)", () => {
    expect(side([-23.1, 24], [-11.8, 20])).toBeNull();
    expect(side([-1.1, 54], [-22.7, 23])).toBeNull();          // 9.2 apart
  });

  it("gives neither to a back above average on both sides (Darius Taylor)", () => {
    expect(side([11.7, 31], [2, 20])).toBeNull();               // 5.1 apart
  });

  it("tags a back just over average on one side and just under on the other, given the gap", () => {
    expect(side([6.3, 77], [-1.1, 25])?.label).toBe("Inside");  // Justice Haynes, 5.05 apart
    expect(side([1.4, 23], [-15.3, 15])?.label).toBe("Inside"); // Waymond Jordan
  });

  it("needs the gap: good at both, a little better inside, is no tag", () => {
    expect(side([7, 44], [4.8, 45])).toBeNull();                   // LJ Martin-like, ~1.3 apart
  });

  it("needs RUN_SIDE_MIN_RUNS runs on each side", () => {
    expect(side([2.6, 46], [-32.5, RUN_SIDE_MIN_RUNS - 2])).toBeNull();   // 8 outside runs
    expect(side([2.6, 46], [-32.5, RUN_SIDE_MIN_RUNS])?.label).toBe("Inside");
  });

  it("measures the gap after the sample discount, at RUN_SIDE_GAP", () => {
    // 30 runs each (the prior): half of each AE counts, so raw 2×gap apart is exactly the line.
    expect(side([RUN_SIDE_GAP + 0.2, 30], [-RUN_SIDE_GAP + 0.2, 30])?.key).toBe("inside");  // 2×5.0 raw apart
    expect(side([RUN_SIDE_GAP, 30], [-RUN_SIDE_GAP + 0.2, 30])).toBeNull();                 // 2×4.9
    // Exactly average on one side isn't below average.
    expect(side([20, 30], [0, 30])).toBeNull();
  });

  it("explains itself, and shows after the role in the label and tooltip", () => {
    const t = side([21.9, 42], [-8.4, 30])!;
    expect(t.why).toBe("inside +21.9 pts on 42 runs vs outside -8.4 pts on 30 runs (SRAE): 17.0 pts apart after the sample discount");
    const plays = [...runs(42, "inside_zone"), ...runs(30, "outside_zone")];
    const f = fit(plays, slices({ all: [9.4, 72], inside: [21.9, 42], outside: [-8.4, 30] }), 71, 221)!;
    expect(f.tags?.map((x) => x.key)).toEqual(["inside"]);
    expect(roleLabel(f)).toMatch(/ · Inside$/);
    expect(roleFitTooltip(f)).toContain("Inside: inside +21.9 pts on 42 runs");
    const plain = fit(plays, slices({ all: [0, 72] }))!;
    expect(plain.tags).toBeUndefined();
    expect(roleLabel(plain)).not.toContain("·");
  });
});

// Scheme Versatile (the user, 2026-10-15): level B with Zone and Gap/Power, for a back "better than
// average at both zone and gap" — Marcellous Hawkins, "not a Zone specific runner". Real numbers.
describe("RB Scheme Versatile", () => {
  // Mostly zone in college, like Hawkins (63% zone), so Zone's usage share favors Zone.
  const zoneHeavy = [...runs(45, "inside_zone"), ...runs(27, "inside_man_gap")];
  const levelB = (f: NonNullable<ReturnType<typeof fit>>) =>
    (["zone", "gap", "scheme_versatile"] as const).map((r) => matchFor(f, r)!).sort((a, b) => b.pct - a.pct)[0].role;

  it("beats Zone for a back above average on both schemes, however zone-heavy his college was (Hawkins)", () => {
    const f = fit(zoneHeavy, slices({ all: [9.4, 72], zone: [6.1, 45], gap: [15, 27] }), 74, 221)!;
    expect(levelB(f)).toBe("scheme_versatile");
    expect(matchFor(f, "scheme_versatile")!.pct).toBeGreaterThan(matchFor(f, "zone")!.pct);
    expect(matchFor(f, "scheme_versatile")!.drivers.join(" ")).toContain("Weaker scheme (zone)");
  });

  it("leaves a zone-only back Zone, cut in half for his gap runs", () => {
    const f = fit(zoneHeavy, slices({ all: [4, 72], zone: [9.4, 47], gap: [-6.9, 23] }), 71, 210)!;  // Ahmad Hardy
    expect(levelB(f)).toBe("zone");
    expect(matchFor(f, "scheme_versatile")!.drivers).toContain("− Above average on both zone and gap runs (−50%)");
  });

  it("isn't Scheme Versatile for a gap back who's average at zone (Kaelon Black) or a thin gap sample (Jeremy Payne)", () => {
    const black = fit(zoneHeavy, slices({ all: [4.5, 72], zone: [-0.6, 38], gap: [11.1, 34] }), 70, 211)!;
    expect(levelB(black)).not.toBe("scheme_versatile");
    const payne = fit(zoneHeavy, slices({ all: [2.4, 26], zone: [0.3, 23], gap: [14.4, 3] }), 68, 180)!;
    expect(matchFor(payne, "scheme_versatile")!.pct).toBeLessThan(40);
  });

  it("reads Scheme Versatile / 2-Down / Goal-line · Inside for a Hawkins-like back", () => {
    const plays = [...runs(42, "inside_zone"), ...runs(30, "outside_man_gap"), ...passBlocks(20, 9), ...routes(12, 4)];
    const f = fit(plays, slices({ all: [9.4, 72], zone: [6.1, 45], gap: [15, 27], inside: [21.9, 42], outside: [-8.4, 30], loaded: [8, 20] }), 74, 221,
      { pffYco: { hits: 420, n: 100 }, pffMissedTackles: { hits: 35, n: 100 } })!;
    expect(roleLabel(f)).toMatch(/^Scheme Versatile \/ /);
    expect(roleLabel(f)).toMatch(/ · Inside$/);
  });
});
