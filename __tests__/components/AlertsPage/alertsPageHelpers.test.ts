import { describe, it, expect } from "vitest";
import { isReserveEligible } from "@/components/AlertsPage/alertsPageHelpers";
import type { SleeperLeagueSettings, SleeperPlayer } from "@/lib/types";

function mkPlayer(status: string, injuryStatus: string | null = null): SleeperPlayer {
  return {
    player_id: "p1",
    full_name: "Test Player",
    position: "RB",
    team: "KC",
    status,
    injury_status: injuryStatus,
  } as SleeperPlayer;
}

describe("isReserveEligible", () => {
  it("treats IR and PUP as always eligible, regardless of settings", () => {
    expect(isReserveEligible(mkPlayer("Injured Reserve"), {})).toBe(true);
    expect(isReserveEligible(mkPlayer("IR"), {})).toBe(true);
    expect(isReserveEligible(mkPlayer("PUP"), {})).toBe(true);
  });

  it("defaults gated statuses to NOT eligible when the league setting is unset (opt-in, default off)", () => {
    const settings: SleeperLeagueSettings = {} as SleeperLeagueSettings;
    expect(isReserveEligible(mkPlayer("Active", "Out"), settings)).toBe(false);
    expect(isReserveEligible(mkPlayer("Active", "Doubtful"), settings)).toBe(false);
    expect(isReserveEligible(mkPlayer("Suspended"), settings)).toBe(false);
    expect(isReserveEligible(mkPlayer("NA"), settings)).toBe(false);
    expect(isReserveEligible(mkPlayer("DNR"), settings)).toBe(false);
  });

  it("allows a gated status once its specific reserve_allow_* flag is on, without allowing the others", () => {
    const settings: SleeperLeagueSettings = { reserve_allow_out: 1 } as SleeperLeagueSettings;
    expect(isReserveEligible(mkPlayer("Active", "Out"), settings)).toBe(true);
    expect(isReserveEligible(mkPlayer("Active", "Doubtful"), settings)).toBe(false);
    expect(isReserveEligible(mkPlayer("Suspended"), settings)).toBe(false);
  });

  it("Questionable/Active players are never IR-eligible, even with every flag enabled", () => {
    const settings: SleeperLeagueSettings = {
      reserve_allow_out: 1,
      reserve_allow_doubtful: 1,
      reserve_allow_sus: 1,
      reserve_allow_na: 1,
      reserve_allow_dnr: 1,
      reserve_allow_cov: 1,
    };
    expect(isReserveEligible(mkPlayer("Active", "Questionable"), settings)).toBe(false);
    expect(isReserveEligible(mkPlayer("Active"), settings)).toBe(false);
  });

  it("falls back to eligible when league settings are missing entirely (avoids over-excluding on a data gap)", () => {
    expect(isReserveEligible(mkPlayer("Active", "Out"), null)).toBe(true);
    expect(isReserveEligible(mkPlayer("Active", "Out"), undefined)).toBe(true);
  });
});
