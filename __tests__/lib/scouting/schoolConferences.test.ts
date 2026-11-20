import { describe, it, expect } from "vitest";
import { displayConference, isRedConference, lookupConference } from "../../../lib/scouting/schoolConferences";

// 2026-11-19, the user: on the Prospects lists, "After the team name can you list
// the Conference (Make Big Ten and Big 12 Red)", then "Also Make Independents Red
// (Notre Dame and UConn) and any FCS Conference Red".

describe("isRedConference", () => {
  it("is red for the spellings saved on prospects (BIG 10, BIG 12, Independents, FCS)", () => {
    for (const c of ["BIG 10", "BIG 12", "Independents", "FCS"]) expect(isRedConference(c)).toBe(true);
  });

  it("tolerates other spellings", () => {
    for (const c of ["Big Ten", "B1G", "big-12", "Big XII", "Independent", "FBS Independents", "Big Sky", "MVFC", "CAA", "SWAC", "Ivy League"]) {
      expect(isRedConference(c)).toBe(true);
    }
  });

  it("isn't red for the other FBS conferences, or nothing", () => {
    for (const c of ["SEC", "ACC", "AAC", "Sun Belt", "Mountain West", "Pac-12", "Conference USA", "MAC", "", null, undefined]) {
      expect(isRedConference(c)).toBe(false);
    }
  });

  it("covers every Big Ten / Big 12 / Independents school the autofill knows", () => {
    for (const school of ["Ohio State", "UCLA", "BYU", "Utah", "Notre Dame", "UConn"]) {
      expect(isRedConference(lookupConference(school))).toBe(true);
    }
    expect(isRedConference(lookupConference("Louisville"))).toBe(false);
  });
});

describe("displayConference", () => {
  it("shows the saved conference, else the school's, else nothing", () => {
    expect(displayConference({ conference: "FCS", school: "Montana" })).toBe("FCS");
    expect(displayConference({ conference: "  ", school: "Virginia Tech" })).toBe("ACC");
    expect(displayConference({ conference: "", school: "Manual Check University" })).toBeNull();
    expect(displayConference({ conference: null, school: null })).toBeNull();
  });
});
