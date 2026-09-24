import { describe, it, expect } from "vitest";
import { orderStandingsForDisplay } from "@/lib/helpers/standings";

interface Row { name: string; max_pf: number }
const row = (name: string, max_pf: number): Row => ({ name, max_pf });

// The real 12-team league this was built from, already in seeding order
// (wins desc, then fpts desc). Six make the playoffs.
const LEAGUE: Row[] = [
  row("seed1", 300), row("seed2", 310), row("seed3", 305),
  row("seed4", 290), row("seed5", 288), row("seed6", 275),
  row("fourdirectionz", 263),
  row("mayfield217", 289),
  row("klars14", 272),
  row("klewlessj", 251),
  row("dtsherrill", 178),
  row("icedDevil", 296),
];

describe("orderStandingsForDisplay", () => {
  it("re-ranks the eliminated teams by max PF, highest first", () => {
    const out = orderStandingsForDisplay(LEAGUE, 6);
    expect(out.slice(6).map((t) => t.name)).toEqual([
      "icedDevil",      // 296 -> 7th
      "mayfield217",    // 289 -> 8th
      "klars14",        // 272 -> 9th
      "fourdirectionz", // 263 -> 10th
      "klewlessj",      // 251 -> 11th
      "dtsherrill",     // 178 -> 12th
    ]);
  });

  it("leaves the playoff seeds exactly as they were", () => {
    const out = orderStandingsForDisplay(LEAGUE, 6);
    expect(out.slice(0, 6)).toEqual(LEAGUE.slice(0, 6));
  });

  it("does not mutate the input, which the simulator also reads", () => {
    const before = LEAGUE.map((t) => t.name);
    orderStandingsForDisplay(LEAGUE, 6);
    expect(LEAGUE.map((t) => t.name)).toEqual(before);
  });

  it("returns a new array even when nothing moves", () => {
    const out = orderStandingsForDisplay(LEAGUE, 12);
    expect(out).not.toBe(LEAGUE);
    expect(out).toEqual(LEAGUE);
  });

  it("keeps seeding order for teams tied on max PF", () => {
    // Stable sort: a tie falls back to the real seeding rule rather than
    // shuffling two teams arbitrarily between renders.
    const tied = [
      row("seedA", 400),
      row("first", 200), row("second", 200), row("third", 200),
    ];
    expect(orderStandingsForDisplay(tied, 1).map((t) => t.name))
      .toEqual(["seedA", "first", "second", "third"]);
  });

  it("changes nothing when every team makes the playoffs", () => {
    expect(orderStandingsForDisplay(LEAGUE, LEAGUE.length)).toEqual(LEAGUE);
  });

  it("handles a cut line past the end of the table", () => {
    expect(orderStandingsForDisplay(LEAGUE, 99)).toEqual(LEAGUE);
  });

  it("re-ranks the whole table when nobody makes the playoffs", () => {
    const out = orderStandingsForDisplay([row("a", 1), row("b", 3), row("c", 2)], 0);
    expect(out.map((t) => t.name)).toEqual(["b", "c", "a"]);
  });

  it("treats a negative cut line as zero rather than slicing from the end", () => {
    const out = orderStandingsForDisplay([row("a", 1), row("b", 3)], -2);
    expect(out.map((t) => t.name)).toEqual(["b", "a"]);
  });

  it("leaves a preseason table alone when no team has a max PF yet", () => {
    const preseason = [row("a", 0), row("b", 0), row("c", 0), row("d", 0)];
    expect(orderStandingsForDisplay(preseason, 2).map((t) => t.name))
      .toEqual(["a", "b", "c", "d"]);
  });

  it("handles an empty table", () => {
    expect(orderStandingsForDisplay([], 6)).toEqual([]);
  });

  it("only ever reorders below the cut, for any cut line", () => {
    for (let cut = 0; cut <= LEAGUE.length; cut++) {
      const out = orderStandingsForDisplay(LEAGUE, cut);
      expect(out.slice(0, cut), `cut ${cut}`).toEqual(LEAGUE.slice(0, cut));
      // And no team is lost or duplicated.
      expect([...out].map((t) => t.name).sort()).toEqual(LEAGUE.map((t) => t.name).sort());
    }
  });
});
