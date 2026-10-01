import { describe, it, expect } from "vitest";
import { draftRoundLabel, nflDraftSlotLabel, DRAFT_ROUND_CHOICES, UNDRAFTED_ROUND } from "@/lib/draftRound";

describe("draft round labels", () => {
  it("names rounds 1–7 and reads 8 as Undrafted", () => {
    expect(DRAFT_ROUND_CHOICES.map(draftRoundLabel))
      .toEqual(["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "Undrafted"]);
    expect(UNDRAFTED_ROUND).toBe(8);
  });

  it("builds the Draft Hub slot tag, dropping the undrafted placeholder pick", () => {
    expect(nflDraftSlotLabel({ team: "KC", round: 1, pick: 8 })).toBe("KC · R1 · #8");
    expect(nflDraftSlotLabel({ team: "KC", round: 8, pick: 300 })).toBe("KC · Undrafted");
    expect(nflDraftSlotLabel({ team: "", round: null, pick: null })).toBeNull();
  });
});
