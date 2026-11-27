import { describe, it, expect } from "vitest";
import {
  backToListedPatch, combineMatches, draftYearOf, keptBecause, lineSize, matchCombineSizes, matchPastedList, measuredFact, measuredHeightText,
  measuredShort, measuredTitle, parseCombineSizes, parseMeasuredHeight, sizeChanges,
  type CombineSizeRow, type SizeMatch, type SizeProspect,
} from "@/lib/scouting/measuredSize";
import { matchFortyRows } from "@/lib/scouting/fortyFill";
import { parseHeightInches } from "@/lib/scouting/prospectAge";

// Stage 5 of the 2026-11-26 scouting plan: measured sizes replace the listed
// ones. Combine, then the most recent other measurement, then listed.

const p = (id: string, name: string, extra: Partial<SizeProspect> = {}): SizeProspect => ({
  id, name, position: "RB", school: "Florida", draft_class_year: 2027, height: `6'1"`, weight: 212, ...extra,
});
const sb = (h: number | null, w: number | null, on = "2027-01-27"): SizeMatch =>
  ({ measurement: { source: "senior_bowl", measuredOn: on, heightEighths: h, weight: w } });

describe("heights", () => {
  it("writes eighths as a measured height, reduced", () => {
    expect(measuredHeightText(72 * 8)).toBe(`6'0"`);
    expect(measuredHeightText(72 * 8 + 3)).toBe(`6'0 3/8"`);
    expect(measuredHeightText(70 * 8 + 6)).toBe(`5'10 3/4"`);
    expect(measuredHeightText(71 * 8 + 4)).toBe(`5'11 1/2"`);
  });
  it("reads the formats lists use", () => {
    expect(parseMeasuredHeight("6003")).toBe(72 * 8 + 3);
    expect(parseMeasuredHeight("5106")).toBe(70 * 8 + 6);
    expect(parseMeasuredHeight(`6'0 3/8"`)).toBe(72 * 8 + 3);
    expect(parseMeasuredHeight("6-0 3/8")).toBe(72 * 8 + 3);
    expect(parseMeasuredHeight("6’1”")).toBe(73 * 8);
    expect(parseMeasuredHeight("6-2")).toBe(74 * 8);
    expect(parseMeasuredHeight("72.375")).toBe(72 * 8 + 3);
    expect(parseMeasuredHeight("72 1/2")).toBe(72 * 8 + 4);
  });
  it("drops what isn't a height", () => {
    // 6123: 12 inches; 6018: an eighth of 8; 4110: 4'11", too short to be measured here.
    for (const s of ["", "2027", "6123", "6018", "4110", "6'12\"", "4.45", "228", "10'4\"", "6'0 9/8\"", "abc"]) expect(parseMeasuredHeight(s), s).toBeNull();
  });
  it("every score still reads a measured height to the nearest inch", () => {
    expect(parseHeightInches(`6'0 3/8"`)).toBe(72);
    expect(parseHeightInches(`6'0 1/2"`)).toBe(73);
    expect(parseHeightInches(`5'11 7/8"`)).toBe(72);
    expect(parseHeightInches(`6'2"`)).toBe(74);
  });
});

describe("lineSize", () => {
  it("finds the height and the weight in a pasted line", () => {
    expect(lineSize("Jordan Doe  RB  Florida  6003  228")).toEqual({ heightEighths: 72 * 8 + 3, weight: 228 });
    expect(lineSize(`C.J. Doe, WR, Georgia, 5'11 1/4", 197 lbs`)).toEqual({ heightEighths: 71 * 8 + 2, weight: 197 });
    expect(lineSize("1\tSam Roe\tTE\tIowa\t6-4 5/8\t251")).toEqual({ heightEighths: 76 * 8 + 5, weight: 251 });
  });
  it("skips the other numbers measurement lists carry", () => {
    // Hand 9 1/4, arm 32 1/2, wing 77 3/4, 40 4.45, broad 10'4", bench 22, a year.
    expect(lineSize(`Jordan Doe RB 6003 228 9 1/4 32 1/2 77 3/4 4.45 10'4" 22 2027`)).toEqual({ heightEighths: 72 * 8 + 3, weight: 228 });
  });
  it("keeps a line with only a weight, and drops one with neither", () => {
    expect(lineSize("Jordan Doe 228 lbs")).toEqual({ heightEighths: null, weight: 228 });
    expect(lineSize("Name Pos School Height Weight")).toBeNull();
  });
});

describe("matchPastedList", () => {
  const pool = [
    p("doe", "Jordan Doe"),
    p("cj", "CJ Roe", { position: "WR" }),
    p("lee", "Will Lee", { position: "WR" }),
    p("leesmith", "Will Lee Smith", { position: "TE" }),
    p("young", "Kid Young", { draft_class_year: 2028 }),
    p("twin1", "Sam Twin"), p("twin2", "Sam Twin", { position: "WR" }),
  ];
  const list = [
    "Name  Pos  School  Ht  Wt",
    "Jordan Doe Jr.  RB  Florida  6003  228",
    "C.J. Roe  WR  Georgia  5111  197",
    "Will Lee Smith  TE  Iowa  6044  251",
    "Will Leeson  WR  Ohio  6010  190",
    "Kid Young  RB  Utah  5100  201",
    "Sam Twin  RB  Ohio  5110  205",
    "Big Tackle  OT  Ohio  6050  320",
  ].join("\n");
  const r = matchPastedList(list, pool, "senior_bowl", "2027-01-27");

  it("matches by the whole name, suffixes and punctuation aside, and the longer name wins", () => {
    expect(r.matches.get("doe")?.measurement).toEqual({ source: "senior_bowl", measuredOn: "2027-01-27", heightEighths: 72 * 8 + 3, weight: 228 });
    expect(r.matches.get("cj")?.measurement.weight).toBe(197);
    expect(r.matches.get("leesmith")?.measurement.weight).toBe(251);
    expect(r.matches.has("lee")).toBe(false); // "Will Leeson" isn't Will Lee
  });
  it("leaves a name two prospects share out, and lists a skill player it couldn't place", () => {
    expect(r.ambiguous).toEqual(["Sam Twin  RB  Ohio  5110  205"]);
    expect(r.unmatched).toEqual(["Will Leeson  WR  Ohio  6010  190"]); // the OT isn't worth a look
    expect(r.sized).toBe(7);
  });
  it("unticks a class that doesn't fit the measurement day", () => {
    expect(r.matches.get("young")?.note).toMatch(/2028 class.*2027 draft/);
    expect(r.matches.get("doe")?.note).toBeUndefined();
  });
  it("unticks a line that names a different position", () => {
    const m = matchPastedList("Jordan Doe  LB  Florida  6003  228", pool, "senior_bowl", "2027-01-27");
    expect(m.matches.get("doe")?.note).toMatch(/at LB/);
  });
  it("drops a prospect named on two lines", () => {
    const m = matchPastedList("Jordan Doe 6003 228\nJordan Doe 6004 230", pool, "pro_day", "2027-03-20");
    expect(m.matches.has("doe")).toBe(false);
    expect(m.repeated).toEqual([{ id: "doe", name: "Jordan Doe" }]);
  });
  it("reads a measurement day as its draft", () => {
    expect(draftYearOf("2027-01-27")).toBe(2027);
    expect(draftYearOf("2027-04-20")).toBe(2027);
    expect(draftYearOf("2026-09-01")).toBe(2027);
    expect(draftYearOf("bad")).toBeNull();
  });
});

describe("precedence", () => {
  it("anything replaces a listed size, and the combine replaces anything", () => {
    expect(keptBecause(p("a", "A"), sb(1, 1).measurement)).toBeNull();
    const combine = { source: "combine" as const, measuredOn: null, heightEighths: 1, weight: 1 };
    expect(keptBecause(p("a", "A", { size_source: "pro_day", size_measured_on: "2027-04-01" }), combine)).toBeNull();
  });
  it("nothing replaces the combine; an older measurement doesn't replace a newer one", () => {
    expect(keptBecause(p("a", "A", { size_source: "combine" }), sb(1, 1).measurement)).toMatch(/combine/);
    expect(keptBecause(p("a", "A", { size_source: "pro_day", size_measured_on: "2027-03-20" }), sb(1, 1).measurement)).toMatch(/Pro day, Mar 20, 2027/);
    // Same day or later: replaces (a corrected re-import).
    expect(keptBecause(p("a", "A", { size_source: "senior_bowl", size_measured_on: "2027-01-27" }), sb(1, 1).measurement)).toBeNull();
  });
});

describe("sizeChanges", () => {
  it("the first measurement replaces the listed size and keeps it as listed", () => {
    const { changes, kept } = sizeChanges([p("a", "Jordan Doe")], new Map([["a", sb(72 * 8 + 3, 205)]]));
    expect(kept).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      prospectId: "a", on: true, source: "senior_bowl", from: `6'1" 212 (listed)`, to: `6'0 3/8" 205`,
      patch: { height: `6'0 3/8"`, weight: 205, size_source: "senior_bowl", size_measured_on: "2027-01-27", listed_height: `6'1"`, listed_weight: 212 },
    });
  });
  it("a later one keeps the listed size from before the first", () => {
    const cur = p("a", "A", { height: `6'0 3/8"`, weight: 205, size_source: "senior_bowl", size_measured_on: "2027-01-27", listed_height: `6'1"`, listed_weight: 212 });
    const { changes } = sizeChanges([cur], new Map([["a", combineMatch(72 * 8, 207)]]));
    expect(changes[0].patch).toEqual({ height: `6'0"`, weight: 207, size_source: "combine", size_measured_on: null });
    expect(changes[0].from).toBe(`6'0 3/8" 205 (Senior Bowl, Jan 27, 2027)`);
  });
  it("lists an outranked measurement as kept, and leaves out one already on file", () => {
    const combineOnFile = p("c", "C", { size_source: "combine" });
    const same = p("s", "S", { height: `6'0 3/8"`, weight: 205, size_source: "senior_bowl", size_measured_on: "2027-01-27" });
    const { changes, kept } = sizeChanges([combineOnFile, same], new Map([["c", sb(1, 1)], ["s", sb(72 * 8 + 3, 205)]]));
    expect(changes).toEqual([]);
    expect(kept.map((k) => k.id)).toEqual(["c"]);
  });
  it("the same numbers but a listed mark is a change: it stops PFF overwriting them", () => {
    const { changes } = sizeChanges([p("a", "A", { height: `6'0"`, weight: 205 })], new Map([["a", sb(72 * 8, 205)]]));
    expect(changes[0].patch).toEqual({ size_source: "senior_bowl", size_measured_on: "2027-01-27", listed_height: `6'0"`, listed_weight: 205 });
  });
  it("a field the measurement lacks stays, and a note says so; a match's note unticks it", () => {
    const { changes } = sizeChanges(
      [p("a", "A"), p("b", "B")],
      new Map<string, SizeMatch>([["a", sb(null, 205)], ["b", { ...sb(72 * 8, 205), note: "the list has him at LB" }]]),
    );
    expect(changes[0]).toMatchObject({ on: true, to: `6'1" 205`, note: "no height in it: his stays" });
    expect(changes[0].patch.height).toBeUndefined();
    expect(changes[1]).toMatchObject({ on: false, note: "the list has him at LB" });
  });
});

function combineMatch(h: number, w: number): SizeMatch {
  return { measurement: { source: "combine", measuredOn: null, heightEighths: h, weight: w } };
}

describe("the combine", () => {
  const csv = [
    "season,draft_year,draft_team,draft_round,draft_ovr,pfr_id,cfb_id,player_name,pos,school,ht,wt,forty,bench,vertical,broad_jump,cone,shuttle",
    "2026,,,,,X,y,Kaytron Allen,RB,Penn St.,5-11,216,,,,,,",
    "2026,,,,,X,y,Fast Guy,WR,\"Miami (FL)\",6-1,190,4.38,,,,,",
    "2026,,,,,X,y,Big Tackle,OT,Ohio St.,6-5,311,,,,,,",
    "2026,,,,,X,y,No Size,TE,Iowa,,,,,,,,",
    "2025,,,,,X,y,Old Back,RB,Utah,5-10,205,4.5,,,,,",
  ].join("\n");

  it("reads every skill player's height and weight, ran or not", () => {
    const { rows, inYear } = parseCombineSizes(csv, 2026);
    expect(inYear).toBe(4);
    expect(rows).toEqual([
      { name: "Kaytron Allen", school: "Penn St.", position: "RB", heightEighths: 71 * 8, weight: 216 },
      { name: "Fast Guy", school: "Miami (FL)", position: "WR", heightEighths: 73 * 8, weight: 190 },
    ]);
    expect(parseCombineSizes(csv, 2027).inYear).toBe(0);
  });
  it("matches at his position in his class, a different school unticked", () => {
    const { rows } = parseCombineSizes(csv, 2026);
    const pool = [
      p("allen", "Kaytron Allen", { school: "Penn State", draft_class_year: 2026 }),
      p("fast", "Fast Guy", { position: "WR", school: "Oregon", draft_class_year: 2026 }),
    ];
    const found = combineMatches(matchFortyRows<CombineSizeRow>(pool, rows, 2026));
    expect(found.get("allen")).toEqual({ measurement: { source: "combine", measuredOn: null, heightEighths: 568, weight: 216 } });
    expect(found.get("fast")?.note).toMatch(/Miami/);
    const { changes } = sizeChanges(pool, found);
    expect(changes.map((c) => [c.prospectId, c.on, c.to])).toEqual([["allen", true, `5'11" 216`], ["fast", false, `6'1" 190`]]);
  });
  it("matches at another skill position only when the school agrees too", () => {
    const { rows } = parseCombineSizes(csv, 2026);
    const pool = [
      p("allen", "Kaytron Allen", { position: "WR", school: "Penn State", draft_class_year: 2026 }), // the combine: RB, Penn St.
      p("fast", "Fast Guy", { position: "RB", school: "Oregon", draft_class_year: 2026 }),            // the combine: WR, Miami
    ];
    const found = matchCombineSizes(pool, rows, 2026);
    expect([...found.keys()]).toEqual(["allen"]);
    expect(found.get("allen")?.note).toBeUndefined();
  });
});

describe("a pasted combine line", () => {
  it("is undated and skips the draft-cycle check", () => {
    const m = matchPastedList("Jordan Doe 6003 228", [p("doe", "Jordan Doe", { draft_class_year: 2026 })], "combine", "2026-11-27");
    expect(m.matches.get("doe")).toEqual({
      measurement: { source: "combine", measuredOn: null, heightEighths: 72 * 8 + 3, weight: 228 }, line: "Jordan Doe 6003 228",
    });
  });
});

describe("on file", () => {
  const measured = p("a", "A", { height: `6'0 3/8"`, weight: 205, size_source: "senior_bowl", size_measured_on: "2027-01-27", listed_height: `6'1"`, listed_weight: 212 });
  it("says where it was measured and what he was listed at", () => {
    expect(measuredShort(measured)).toBe("SB");
    expect(measuredTitle(measured)).toBe(`Measured: Senior Bowl, Jan 27, 2027. Listed 6'1" 212.`);
    expect(measuredFact(measured)).toBe(`measured at the Senior Bowl (listed 6'1" 212)`);
    expect(measuredTitle(p("b", "B", { size_source: "combine" }))).toBe("Measured: Combine.");
    expect(measuredShort(p("c", "C"))).toBeNull();
    expect(measuredTitle(p("c", "C"))).toBeNull();
    expect(measuredFact(p("c", "C"))).toBeNull();
  });
  it("Back to listed restores the listed size and drops the measurement", () => {
    expect(backToListedPatch(measured)).toEqual({
      height: `6'1"`, weight: 212, size_source: null, size_measured_on: null, listed_height: null, listed_weight: null,
    });
    expect(backToListedPatch(p("n", "N", { size_source: "combine", listed_height: null, listed_weight: null })).height).toBe("");
  });
});
