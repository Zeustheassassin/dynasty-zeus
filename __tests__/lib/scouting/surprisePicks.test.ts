import { describe, it, expect } from "vitest";
import { surprisePicks, surpriseWhyText, udfasOf, type SurpriseProspect, type UdfaRow } from "../../../lib/scouting/surprisePicks";
import type { DraftPickRow } from "../../../lib/nflDraft";
import { SAMPLE_FULL, sampleText, type SampleSize } from "../../../lib/scouting/sampleSize";
import { sampleTier } from "../../../lib/scouting/sampleTiers";

// Stage 8 of the 2026-11-26 scouting plan: the drafted and undrafted skill
// players the board can't speak for yet.

const pick = (overall: number, name: string, position: string, team = "Jets", college: string | null = null): DraftPickRow => ({
  year: 2027, overall, round: Math.min(7, Math.ceil(overall / 32)), pick: ((overall - 1) % 32) + 1,
  nfl_team_id: null, nfl_team: team, position, name, college,
});
const prospect = (id: string, name: string, position: string, draft_class_year = 2027, school: string | null = "State"): SurpriseProspect =>
  ({ id, name, position, school, draft_class_year });
const sample = (pos: "QB" | "RB" | "WR" | "TE", n: number | null): SampleSize => {
  const f = SAMPLE_FULL[pos];
  return { ...f, n, share: Math.min(1, (n ?? 0) / f.full), tier: sampleTier(n ?? 0, f.full) };
};
const udfa = (otc_id: number, player: string, position: string, extra: Partial<UdfaRow> = {}): UdfaRow =>
  ({ otc_id, player, position, team: "Eagles", is_active: true, contract_type: "UDFA", draft_year: 2027, draft_round: null, ...extra });

describe("udfasOf", () => {
  it("keeps the year's skill players with no draft round (FB as RB), whatever deal they're on now", () => {
    const rows = [
      udfa(1, "A", "WR"), udfa(2, "B", "FB"), udfa(3, "C", "CB"), udfa(4, "D", "TE", { draft_round: 6 }),
      udfa(5, "E", "QB", { draft_year: 2026 }), udfa(6, "F", "RB", { contract_type: "Practice", is_active: false }),
    ];
    expect(udfasOf(rows, 2027).map((r) => r.otc_id)).toEqual([1, 2, 6]);
  });
});

describe("surprisePicks", () => {
  const board = [
    prospect("wr1", "Wide One", "WR"),       // well charted
    prospect("wr2", "Thin Two", "WR"),       // thin
    prospect("qb9", "Later Guy", "QB", 2028), // another class
    prospect("rb1", "Same Name", "RB"),
    prospect("rb2", "Same Name", "RB", 2027, "Other"),
    prospect("te1", "Tight Udfa", "TE"),
  ];
  const samples = new Map<string, SampleSize>([
    ["wr1", sample("WR", 120)], ["wr2", sample("WR", 30)], ["qb9", sample("QB", 100)],
    ["rb1", sample("RB", 10)], ["rb2", sample("RB", 80)], ["te1", sample("TE", null)],
  ]);
  const picks = [
    pick(40, "Thin Two", "Wide Receiver"),
    pick(5, "Wide One", "Wide Receiver"),
    pick(70, "Later Guy", "Quarterback"),
    pick(90, "Nobody Known", "Tight End", "Rams", "Iowa"),
    pick(120, "Same Name", "Running Back"),
    pick(130, "A Lineman", "Offensive Tackle"),
  ];

  it("lists the drafted ones off the board or under a quarter sample, in pick order", () => {
    const r = surprisePicks(2027, picks, [], board, samples, true);
    expect(r.drafted).toBe(5); // the lineman isn't a skill player
    expect(r.rows.map((x) => [x.pick?.overall, x.name, x.why])).toEqual([
      [40, "Thin Two", "thin"],
      [70, "Later Guy", "other_class"],
      [90, "Nobody Known", "off_board"],
      [120, "Same Name", "unsettled"], // two of the class's RBs share it
    ]);
    const later = r.rows.find((x) => x.name === "Later Guy")!;
    expect([later.otherClass, later.prospectId, later.sample?.n]).toEqual([2028, "qb9", 100]);
    const nobody = r.rows.find((x) => x.name === "Nobody Known")!;
    expect([nobody.position, nobody.team, nobody.college, nobody.pick]).toEqual(["TE", "Rams", "Iowa", { round: 3, overall: 90 }]);
  });

  it("leaves the thin check out until the plays are in", () => {
    const r = surprisePicks(2027, picks, [], board, samples, false);
    expect(r.samplesChecked).toBe(false);
    expect(r.rows.map((x) => x.why)).toEqual(["other_class", "off_board", "unsettled"]);
    expect(r.rows[0].sample).toBeNull();
  });

  it("adds the undrafted free agents: matched by name in the class, active first, released marked", () => {
    const rows = [
      udfa(10, "Gone Guy", "WR", { is_active: false }),
      udfa(11, "Tight Udfa", "TE"),
      udfa(12, "Fresh Face", "RB"),
      udfa(13, "Wide One", "WR"), // the draft has him: not a UDFA
      udfa(14, "Same Name", "RB", { team: "Bills" }), // two of the class share it, positions too
    ];
    const r = surprisePicks(2027, [], rows, board, samples, true);
    expect(r.udfa).toBe(5);
    expect(r.rows.map((x) => [x.name, x.why, x.released, x.pick])).toEqual([
      ["Fresh Face", "off_board", false, null],
      ["Same Name", "unsettled", false, null],
      ["Tight Udfa", "thin", false, null],
      ["Gone Guy", "off_board", true, null],
    ]);
    const withDraft = surprisePicks(2027, [pick(5, "Wide One", "Wide Receiver")], rows, board, samples, true);
    expect(withDraft.udfa).toBe(4);
  });

  it("a UDFA whose name two prospects share is settled by position", () => {
    const two = [prospect("a", "Jo Smith", "WR"), prospect("b", "Jo Smith", "TE")];
    const r = surprisePicks(2027, [], [udfa(20, "Jo Smith", "TE")], two, new Map([["a", sample("WR", 10)], ["b", sample("TE", 100)]]), true);
    expect(r.rows).toEqual([]); // the TE is well charted
  });

  it("says why", () => {
    const r = surprisePicks(2027, picks, [], board, samples, true);
    expect(r.rows.map((x) => surpriseWhyText(x, sampleText))).toEqual([
      "Under a quarter sample: 30 of 160 routes",
      "On your 2028 board (100 of 180 throws)",
      "Not on your board",
      "On your board by name, but couldn't be matched (a shared name): check him by hand",
    ]);
  });
});
