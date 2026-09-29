import { describe, it, expect } from "vitest";
import {
  nonInjuryReason,
  describeInjury,
  describeReturn,
  buildInjurySummary,
} from "@/lib/helpers/injurySummary";
import type { InjuryDetail } from "@/lib/helpers/espnInjuryDetail";

// Template-built injury summaries for the Alert Hub (no AI). Fixtures are real
// ESPN records as of 2026-09-29.
const TODAY = new Date("2026-09-29T15:00:00Z");

const espn = (d: Partial<InjuryDetail>): InjuryDetail => ({ found: true, season: 2026, ...d });

describe("nonInjuryReason", () => {
  it("reads Sleeper's Coach's Decision tag as a healthy scratch", () => {
    expect(nonInjuryReason({ injury_status: "Out", injury_body_part: "Coach's Decision" })).toBe("scratch");
  });
  it("reads personal and suspension tags", () => {
    expect(nonInjuryReason({ injury_status: "Out", injury_body_part: "Personal" })).toBe("personal");
    expect(nonInjuryReason({ injury_status: "NA", injury_body_part: "Not Injury Related - Personal" })).toBe("personal");
    expect(nonInjuryReason({ injury_status: "Sus", injury_body_part: null })).toBe("suspension");
  });
  it("leaves real injuries — and IR / PUP whatever the tag — as injuries", () => {
    expect(nonInjuryReason({ injury_status: "Out", injury_body_part: "Hamstring" })).toBeNull();
    expect(nonInjuryReason({ injury_status: "PUP", injury_body_part: "Personal" })).toBeNull();
    expect(nonInjuryReason({ injury_status: "Questionable" })).toBeNull();
  });
});

describe("describeInjury", () => {
  it("builds the injury phrase from ESPN's type / side / detail", () => {
    expect(describeInjury("Hamstring", "Right", "Strain")).toBe("a right hamstring strain");
    expect(describeInjury("Knee - ACL", "Left", "Surgery")).toBe("a left knee (ACL) injury that required surgery");
    expect(describeInjury("Heel", "Left", null)).toBe("a left heel injury");
    expect(describeInjury("Ankle", null, "Sprain")).toBe("an ankle sprain");
    expect(describeInjury("Knee - Meniscus", "Left", null)).toBe("a left knee (meniscus) injury");
  });
  it("handles the odd ones", () => {
    expect(describeInjury("Concussion", null, "Concussion")).toBe("a concussion");
    expect(describeInjury("Undisclosed", null, null)).toBe("an undisclosed injury");
    expect(describeInjury("Illness", null, null)).toBe("an illness");
    expect(describeInjury(null, "Left", "Strain")).toBeNull();
  });
});

describe("describeReturn", () => {
  it("counts weeks to a projected return", () => {
    expect(describeReturn("2026-10-11", 2026, TODAY)).toBe("Projected return: Oct 11 (about 2 weeks)");
    expect(describeReturn("2026-10-25", 2026, TODAY)).toBe("Projected return: Oct 25 (about 4 weeks)");
    expect(describeReturn("2026-10-03", 2026, TODAY)).toBe("Projected return: Oct 3 (within a week)");
  });
  it("says season-ending instead of counting weeks past the regular season", () => {
    expect(describeReturn("2027-02-15", 2026, TODAY))
      .toBe("Projected return: Feb 15, 2027 — likely out for the rest of the regular season");
  });
  it("flags a projected return that has already passed", () => {
    expect(describeReturn("2026-09-20", 2026, TODAY)).toBe("Projected return was Sep 20 — no newer timeline reported");
  });
  it("is null without a date", () => {
    expect(describeReturn(null, 2026, TODAY)).toBeNull();
  });
});

describe("buildInjurySummary", () => {
  it("Jordyn Tyson — IR designated to return, with a timeline and ESPN's news", () => {
    const s = buildInjurySummary(
      "Jordyn Tyson",
      { injury_status: "IR", injury_body_part: "Hamstring", injury_notes: "Strain" },
      espn({
        status: "Injured Reserve", fantasyStatus: "IR-R", type: "Hamstring", side: "Right", detail: "Strain",
        returnDate: "2026-10-11", date: "2026-08-30T22:30Z",
        shortComment: "Tyson (hamstring) was placed on injured reserve with a designation to return by New Orleans on Sunday.",
      }),
      TODAY,
    );
    expect(s.headline).toBe("Based on reports, Jordyn Tyson is on injured reserve (designated to return) with a right hamstring strain.");
    expect(s.returnLine).toBe("Projected return: Oct 11 (about 2 weeks)");
    expect(s.source).toBe("ESPN");
    expect(s.reportedOn).toBe("Aug 30");
    expect(s.latestNews).toContain("designation to return");
  });

  it("De'Von Achane — season-ending surgery", () => {
    const s = buildInjurySummary(
      "De'Von Achane",
      { injury_status: "IR", injury_body_part: "Knee - ACL", injury_notes: "Surgery" },
      espn({ status: "Injured Reserve", fantasyStatus: "IR", type: "Knee - ACL", side: "Left", detail: "Surgery", returnDate: "2027-02-15" }),
      TODAY,
    );
    expect(s.headline).toBe("Based on reports, De'Von Achane is on injured reserve with a left knee (ACL) injury that required surgery.");
    expect(s.returnLine).toContain("rest of the regular season");
  });

  it("Zach Charbonnet — PUP reads as the PUP list, not just 'out'", () => {
    const s = buildInjurySummary(
      "Zach Charbonnet",
      { injury_status: "PUP" },
      espn({ status: "Out", fantasyStatus: "PUP-R", type: "Knee - ACL", side: "Left", detail: "Surgery", returnDate: "2026-10-11" }),
      TODAY,
    );
    expect(s.headline).toBe("Based on reports, Zach Charbonnet is on the PUP list with a left knee (ACL) injury that required surgery.");
  });

  it("a healthy scratch is said plainly, with no return line", () => {
    const s = buildInjurySummary(
      "Devin Singletary",
      { injury_status: "Out", injury_body_part: "Coach's Decision" },
      espn({ status: "Out", type: "Coach's Decision", shortComment: "Singletary (coach's decision) is inactive for Sunday's game." }),
      TODAY,
    );
    expect(s.headline).toBe("Based on reports, Devin Singletary was a healthy scratch (coach's decision) — not injured.");
    expect(s.returnLine).toBeNull();
    expect(s.latestNews).toContain("inactive");
  });

  it("ESPN's coach's-decision blurb marks a scratch even when Sleeper hasn't tagged it", () => {
    const s = buildInjurySummary("Elijah Sarratt", { injury_status: "Out" },
      espn({ status: "Active", shortComment: "Sarratt (coach's decision) is inactive for Sunday's game against Dallas." }), TODAY);
    expect(s.headline).toContain("healthy scratch");
  });

  it("personal absences and suspensions aren't called injuries", () => {
    expect(buildInjurySummary("Aidan O'Connell", { injury_status: "Out", injury_body_part: "Personal" }, null, TODAY).headline)
      .toBe("Based on reports, Aidan O'Connell is out for personal reasons — not an injury.");
    expect(buildInjurySummary("Jeshaun Jones", { injury_status: "Sus", injury_body_part: "Suspension" }, null, TODAY).headline)
      .toBe("Based on reports, Jeshaun Jones is suspended — not an injury.");
  });

  it("falls back to Sleeper's own fields when ESPN has no record", () => {
    const s = buildInjurySummary("Kendrick Law", { injury_status: "IR", injury_body_part: "Knee - ACL" }, { found: false }, TODAY);
    expect(s.headline).toBe("Based on Sleeper's injury feed, Kendrick Law is on injured reserve with a knee (ACL) injury.");
    expect(s.source).toBe("Sleeper");
    expect(s.returnLine).toBeNull();
    expect(s.latestNews).toBeNull();
  });

  it("uses Sleeper's status when ESPN's record says Active (stale record)", () => {
    const s = buildInjurySummary("Some WR", { injury_status: "Questionable", injury_body_part: "Ankle" },
      espn({ status: "Active", type: "Ankle", side: "Right", detail: "Sprain" }), TODAY);
    expect(s.headline).toBe("Based on reports, Some WR is questionable with a right ankle sprain.");
  });

  it("still says something when nothing is specified", () => {
    expect(buildInjurySummary("Some RB", { injury_status: "Out" }, null, TODAY).headline)
      .toBe("Based on Sleeper's injury feed, Some RB is out; the injury hasn't been specified.");
  });
});
