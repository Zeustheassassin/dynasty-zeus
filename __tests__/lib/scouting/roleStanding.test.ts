import { describe, it, expect } from "vitest";
import { ROLES, type RoleFit, type RoleKey, type RolePos } from "@/lib/scouting/roleFit";
import {
  ROLE_STANDING_MAX, poolRankText, rolePlayed, roleStandingText, roleStandings, willPlayOptions, willPlayRole,
  type StandingProspect,
} from "@/lib/scouting/roleStanding";
import { standingLine, standingPoolText } from "@/lib/scouting/landingSpot";

const fit = (pos: RolePos, best: RoleKey, pcts: Partial<Record<RoleKey, number>>): RoleFit => ({
  pos, best, also: [],
  matches: Object.entries(pcts).map(([role, pct]) => ({ role, pct, sizeDrop: 0, sizeNote: null, drivers: [], proven: true })),
} as unknown as RoleFit);

const p = (id: string, position: string, extra: Partial<StandingProspect> = {}): StandingProspect => ({
  id, name: id, position, draft_class_year: 2027, will_play_post: "", ...extra,
});

describe("willPlayRole", () => {
  it("reads a role key or a role label of his position, else null", () => {
    expect(willPlayRole("WR", "x")).toBe("x");
    expect(willPlayRole("WR", " Slot ")).toBe("slot");
    expect(willPlayRole("TE", "move/big SLOT")).toBe("move");
    expect(willPlayRole("RB", "three_down")).toBe("three_down");
    expect(willPlayRole("TE", "x")).toBeNull();          // another position's role
    expect(willPlayRole("WR", "X or Z")).toBeNull();     // an older free-text answer
    expect(willPlayRole("QB", "Franchise QB")).toBeNull(); // depth, not a role
    expect(willPlayRole("WR", "")).toBeNull();
    expect(willPlayRole("K", "x")).toBeNull();
  });

  it("offers blank, then the position's role buckets in order", () => {
    const opts = willPlayOptions("TE");
    expect(opts[0]).toEqual({ value: "", label: "—" });
    expect(opts.slice(1).map((o) => o.value)).toEqual(ROLES.TE.map((r) => r.key));
  });
});

describe("rolePlayed", () => {
  it("is Will Play (Post) when it names a role, else his best bucket", () => {
    const f = fit("WR", "z", { x: 60, z: 70 });
    expect(rolePlayed({ position: "WR", will_play_post: "x" }, f)).toEqual({ role: "x", from: "post" });
    expect(rolePlayed({ position: "WR", will_play_post: "" }, f)).toEqual({ role: "z", from: "best" });
    expect(rolePlayed({ position: "WR", will_play_post: "X or Z" }, f)).toEqual({ role: "z", from: "best" });
    expect(rolePlayed({ position: "WR", will_play_post: "" }, undefined)).toBeNull();
  });
});

describe("roleStandings", () => {
  const prospects = [
    p("A", "WR"), p("B", "WR"), p("C", "WR"), p("D", "WR"),
    p("E", "WR", { will_play_post: "x" }),                  // best Z, cast as an X
    p("old", "WR", { draft_class_year: 2026 }),               // 2026: out of every pool
    p("next", "WR", { draft_class_year: 2028 }),              // another class: all-classes rank only
    p("noFit", "WR"),
    p("T", "TE"),
  ];
  const fits = new Map<string, RoleFit>([
    ["A", fit("WR", "x", { x: 90, z: 70 })],
    ["B", fit("WR", "x", { x: 80, z: 60 })],
    ["C", fit("WR", "x", { x: 70, z: 50 })],
    ["D", fit("WR", "slot", { x: 40, slot: 60 })],
    ["E", fit("WR", "z", { x: 75, z: 78 })],
    ["old", fit("WR", "x", { x: 95 })],
    ["next", fit("WR", "x", { x: 85 })],
    ["T", fit("TE", "move", { move: 66 })],
  ]);
  const s = roleStandings(prospects, fits);

  it("ranks him at the role he plays among his class's players at it", () => {
    // 2027 X pool: A 90, B 80, E 75 (cast by Will Play (Post)), C 70. D plays Slot.
    expect(s.get("A")).toMatchObject({ role: "x", from: "best", pct: 90, inClass: { rank: 1, of: 4 }, allClasses: { rank: 1, of: 5 } });
    expect(s.get("B")).toMatchObject({ inClass: { rank: 2, of: 4 }, allClasses: { rank: 3, of: 5 } });
    expect(s.get("E")).toMatchObject({ role: "x", from: "post", pct: 75, inClass: { rank: 3, of: 4 } });
    expect(s.get("C")).toMatchObject({ inClass: { rank: 4, of: 4 }, allClasses: { rank: 5, of: 5 } });
    expect(s.get("A")!.classPool.map((x) => x.id)).toEqual(["A", "B", "E", "C"]);
  });

  it("values the class rank from +max (alpha) to −max (bottom), at the middle of his rank", () => {
    expect(s.get("A")!.value).toBeCloseTo(ROLE_STANDING_MAX * 3 / 4, 12);
    expect(s.get("B")!.value).toBeCloseTo(ROLE_STANDING_MAX * 1 / 4, 12);
    expect(s.get("E")!.value).toBeCloseTo(-ROLE_STANDING_MAX * 1 / 4, 12);
    expect(s.get("C")!.value).toBeCloseTo(-ROLE_STANDING_MAX * 3 / 4, 12);
    // Alone at his role in his class: nothing to rank against.
    expect(s.get("D")).toMatchObject({ role: "slot", inClass: { rank: 1, of: 1 }, value: 0 });
    expect(s.get("T")!.value).toBe(0);
    expect(s.get("next")!.value).toBe(0);
  });

  it("leaves out the 2026 class and anyone without a role fit", () => {
    expect(s.has("old")).toBe(false);
    expect(s.has("noFit")).toBe(false);
  });

  it("shares a rank on a tie, and counts a lower Special Teams % as better", () => {
    const tie = roleStandings([p("a", "WR"), p("b", "WR")], new Map([
      ["a", fit("WR", "z", { z: 70 })], ["b", fit("WR", "z", { z: 70 })],
    ]));
    expect(tie.get("a")).toMatchObject({ inClass: { rank: 1, of: 2 }, value: 0 });
    expect(tie.get("b")).toMatchObject({ inClass: { rank: 1, of: 2 }, value: 0 });
    // Special Teams % = 100 − his best other match: 30 is the better player.
    const st = roleStandings([p("good", "WR"), p("bad", "WR")], new Map([
      ["good", fit("WR", "special_teams", { special_teams: 55 })], ["bad", fit("WR", "special_teams", { special_teams: 70 })],
    ]));
    expect(st.get("good")!.inClass.rank).toBe(1);
    expect(st.get("good")!.value).toBeGreaterThan(0);
    expect(st.get("bad")!.value).toBeLessThan(0);
  });

  it("says it in words", () => {
    expect(poolRankText({ rank: 2, of: 4 })).toBe("2nd of 4");
    expect(poolRankText({ rank: 11, of: 12 })).toBe("11th of 12");
    expect(roleStandingText(s.get("E")!, 2027)).toBe("X 75% (Will Play (Post)): 3rd of 4 at X in the 2027 class, 4th of 5 across classes");
    expect(standingLine(s.get("A")!, 2027, 2)).toBe(
      "Role standing: X 90% (his best role; set Will Play (Post) to change it): 1st of 4 at X in the 2027 class, 1st of 5 across classes → +0.38",
    );
    expect(standingPoolText(s.get("B")!, 2027, "B")).toMatch(/^X in the 2027 class: A 90%, B 80% \(him\), E 75%, C 70%\./);
  });
});
