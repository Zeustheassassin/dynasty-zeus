import { describe, it, expect } from "vitest";
import { bioChanges, bioPatches, heightText, pffHeightInches, readPffBio, type BioRow } from "@/lib/scouting/pffBio";

const row = (current: Partial<BioRow["current"]>, pff: Partial<BioRow["pff"]>, id = "p1"): BioRow => ({
  prospectId: id,
  name: `Name ${id}`,
  current: { height: "", weight: null, birthday: null, eligibleThru: null, ...current },
  pff: { heightIn: null, weight: null, dob: null, eligibleThru: null, ...pff },
});

describe("pffHeightInches", () => {
  it("reads PFF's feet-and-inches number", () => {
    expect(pffHeightInches(602)).toBe(74);
    expect(pffHeightInches(511)).toBe(71);
    expect(pffHeightInches(600)).toBe(72);
  });
  it("drops blank and unreadable heights", () => {
    expect(pffHeightInches(null)).toBeNull();
    expect(pffHeightInches(undefined)).toBeNull();
    expect(pffHeightInches(0)).toBeNull();
    expect(pffHeightInches(612)).toBeNull(); // 12 inches
    expect(pffHeightInches(74)).toBeNull(); // inches, not PFF's format
    expect(pffHeightInches(602.5)).toBeNull();
  });
  it("formats inches the way the sheet stores them", () => {
    expect(heightText(74)).toBe(`6'2"`);
    expect(heightText(72)).toBe(`6'0"`);
    expect(heightText(71)).toBe(`5'11"`);
  });
});

describe("readPffBio", () => {
  it("keeps plausible values", () => {
    expect(readPffBio({ height: 603, weight: 215, dob: "2005-04-26", current_eligible_year: 2028 })).toEqual({ heightIn: 75, weight: 215, dob: "2005-04-26", eligibleThru: 2028 });
  });
  it("trims a timestamp birthday to the date", () => {
    expect(readPffBio({ height: null, weight: null, dob: "2005-04-26T00:00:00Z" }).dob).toBe("2005-04-26");
  });
  it("drops implausible weights and unreadable birthdays", () => {
    expect(readPffBio({ height: null, weight: 0, dob: "unknown" })).toEqual({ heightIn: null, weight: null, dob: null, eligibleThru: null });
    expect(readPffBio({ height: null, weight: null, dob: null, current_eligible_year: 0 }).eligibleThru).toBeNull();
    expect(readPffBio({ height: null, weight: null, dob: null, current_eligible_year: null }).eligibleThru).toBeNull();
    expect(readPffBio({ height: null, weight: 900, dob: "2005-13-45" }).weight).toBeNull();
    expect(readPffBio({ height: null, weight: 900, dob: "2005-13-45" }).dob).toBeNull();
  });
});

describe("bioChanges", () => {
  it("PFF's height and weight win when they differ", () => {
    const out = bioChanges([row({ height: `6'3"`, weight: 215 }, { heightIn: 76, weight: 220 })]);
    expect(out).toEqual([
      expect.objectContaining({ key: "p1:height", field: "height", from: `6'3"`, to: `6'4"`, kind: "update", on: true }),
      expect.objectContaining({ key: "p1:weight", field: "weight", from: 215, to: 220, kind: "update", on: true }),
    ]);
  });

  it("fills blanks, ticked", () => {
    const out = bioChanges([row({}, { heightIn: 74, weight: 205, dob: "2005-01-02" })]);
    expect(out.map((c) => [c.field, c.kind, c.on])).toEqual([
      ["height", "fill", true],
      ["weight", "fill", true],
      ["birthday", "fill", true],
    ]);
  });

  it("never blanks a field PFF leaves empty", () => {
    expect(bioChanges([row({ height: `6'2"`, weight: 210, birthday: "2004-05-06" }, {})])).toEqual([]);
  });

  it("compares heights by inches, whatever quotes were typed", () => {
    expect(bioChanges([row({ height: "6’5”" }, { heightIn: 77 })])).toEqual([]);
    expect(bioChanges([row({ height: "6-5" }, { heightIn: 77 })])).toEqual([]);
  });

  it("replaces a height it can't read", () => {
    expect(bioChanges([row({ height: "tall" }, { heightIn: 77 })])).toEqual([
      expect.objectContaining({ field: "height", from: "tall", to: `6'5"`, kind: "update" }),
    ]);
  });

  it("offers a birthday PFF disagrees on, unticked", () => {
    expect(bioChanges([row({ birthday: "2004-04-27" }, { dob: "2005-04-26" })])).toEqual([
      expect.objectContaining({ field: "birthday", from: "2004-04-27", to: "2005-04-26", kind: "differs", on: false }),
    ]);
  });

  it("fills Eligible Thru from PFF and PFF's year wins, ticked", () => {
    expect(bioChanges([row({}, { eligibleThru: 2028 })])).toEqual([
      expect.objectContaining({ key: "p1:eligible_thru_year", field: "eligible_thru_year", from: null, to: 2028, kind: "fill", on: true }),
    ]);
    expect(bioChanges([row({ eligibleThru: 2027 }, { eligibleThru: 2028 })])).toEqual([
      expect.objectContaining({ field: "eligible_thru_year", from: 2027, to: 2028, kind: "update", on: true }),
    ]);
    expect(bioChanges([row({ eligibleThru: 2028 }, { eligibleThru: 2028 })])).toEqual([]);
    expect(bioChanges([row({ eligibleThru: 2028 }, { eligibleThru: null })])).toEqual([]);
  });

  it("skips fields that already match", () => {
    expect(bioChanges([row({ height: `6'0"`, weight: 200, birthday: "2005-01-02" }, { heightIn: 72, weight: 200, dob: "2005-01-02" })])).toEqual([]);
  });
});

describe("bioPatches", () => {
  it("groups the chosen fields into one update per prospect", () => {
    const changes = bioChanges([
      row({ height: `6'3"`, weight: 215 }, { heightIn: 76, weight: 220 }, "a"),
      row({}, { dob: "2005-01-02", eligibleThru: 2029 }, "b"),
    ]);
    expect([...bioPatches(changes)]).toEqual([
      ["a", { height: `6'4"`, weight: 220 }],
      ["b", { birthday: "2005-01-02", eligible_thru_year: 2029 }],
    ]);
  });
});
