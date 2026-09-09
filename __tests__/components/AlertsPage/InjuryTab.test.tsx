// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import InjuryTab from "@/components/AlertsPage/InjuryTab";
import type { InjuryReportPlayer } from "@/components/AlertsPage/alertsPageHelpers";
import type { SleeperPlayer } from "@/lib/types";

// This project doesn't set `test.globals: true` in vitest.config.mts, so
// @testing-library/react's automatic afterEach cleanup never registers.
afterEach(cleanup);

function mkPlayer(): SleeperPlayer {
  return {
    player_id: "p1",
    full_name: "Test Player",
    position: "RB",
    team: "KC",
    injury_status: "Questionable",
    status: "Active",
    bye_week: 0,
  } as SleeperPlayer;
}

describe("InjuryTab — league membership compared by id, not name", () => {
  it("a player starting in one league and benched in another SAME-NAMED league shows correctly in both, not merged", () => {
    // Regression: two distinct leagues both named "Dynasty League". The
    // player starts in leagueA and is benched in leagueB. Pre-fix, dedup-by-
    // name would collapse both into a single "Dynasty League" string that
    // reads as "starting" everywhere, hiding the bench status in leagueB.
    const entry: InjuryReportPlayer = {
      player: mkPlayer(),
      playerId: "p1",
      leagues: [
        { id: "leagueA", name: "Dynasty League" },
        { id: "leagueB", name: "Dynasty League" },
      ],
      startingLeagues: [{ id: "leagueA", name: "Dynasty League" }],
      irLeagues: [],
      irEligibleLeagues: [],
      isWatchlisted: false,
    };

    render(
      <InjuryTab
        injuryReportPlayers={[entry]}
        currentNFLWeek={5}
        expandedInjuryId="p1"
        setExpandedInjuryId={vi.fn()}
      />
    );

    // Both an "In starting lineup" chip AND an "On bench" chip must appear —
    // pre-fix, benchLeagues would have been empty (both entries share the
    // name "Dynasty League", which name-based .includes() would find in
    // startingLeagues and wrongly exclude from the bench list).
    expect(screen.getByText("In starting lineup")).toBeTruthy();
    expect(screen.getByText("On bench")).toBeTruthy();

    // Exactly one chip in each section (two total), not deduped into one.
    const chips = screen.getAllByText("Dynasty League");
    expect(chips.length).toBe(2);
  });

  it("Starting count reflects the number of distinct league ids, not deduped-by-name count", () => {
    const entry: InjuryReportPlayer = {
      player: mkPlayer(),
      playerId: "p1",
      leagues: [
        { id: "leagueA", name: "Dynasty League" },
        { id: "leagueB", name: "Dynasty League" },
      ],
      startingLeagues: [
        { id: "leagueA", name: "Dynasty League" },
        { id: "leagueB", name: "Dynasty League" },
      ],
      irLeagues: [],
      irEligibleLeagues: [],
      isWatchlisted: false,
    };

    render(
      <InjuryTab
        injuryReportPlayers={[entry]}
        currentNFLWeek={5}
        expandedInjuryId={null}
        setExpandedInjuryId={vi.fn()}
      />
    );

    expect(screen.getByText("Starting 2/2")).toBeTruthy();
  });

  it("clicking a row toggles the expanded id via setExpandedInjuryId", () => {
    const entry: InjuryReportPlayer = {
      player: mkPlayer(),
      playerId: "p1",
      leagues: [{ id: "leagueA", name: "League A" }],
      startingLeagues: [],
      irLeagues: [],
      irEligibleLeagues: [],
      isWatchlisted: false,
    };
    const setExpandedInjuryId = vi.fn();

    render(
      <InjuryTab
        injuryReportPlayers={[entry]}
        currentNFLWeek={5}
        expandedInjuryId={null}
        setExpandedInjuryId={setExpandedInjuryId}
      />
    );

    fireEvent.click(screen.getByText("Test Player"));
    expect(setExpandedInjuryId).toHaveBeenCalledWith("p1");
  });
});

describe("InjuryTab — IR-eligibility badge and chip outline", () => {
  it("shows the IR badge at 0/N when the player isn't on IR anywhere yet but is eligible somewhere", () => {
    const entry: InjuryReportPlayer = {
      player: mkPlayer(),
      playerId: "p1",
      leagues: [
        { id: "leagueA", name: "Deep Ball Dimes" },
        { id: "leagueB", name: "SF Dynasty 1" },
        { id: "leagueC", name: "Dynasty 26" },
      ],
      startingLeagues: [
        { id: "leagueA", name: "Deep Ball Dimes" },
        { id: "leagueB", name: "SF Dynasty 1" },
      ],
      irLeagues: [],
      irEligibleLeagues: [
        { id: "leagueA", name: "Deep Ball Dimes" },
        { id: "leagueB", name: "SF Dynasty 1" },
      ],
      isWatchlisted: false,
    };

    render(
      <InjuryTab
        injuryReportPlayers={[entry]}
        currentNFLWeek={5}
        expandedInjuryId="p1"
        setExpandedInjuryId={vi.fn()}
      />
    );

    expect(screen.getByText("IR 0/2")).toBeTruthy();
  });

  it("does not show the IR badge when no league is IR-eligible for this player", () => {
    const entry: InjuryReportPlayer = {
      player: mkPlayer(),
      playerId: "p1",
      leagues: [{ id: "leagueA", name: "League A" }],
      startingLeagues: [{ id: "leagueA", name: "League A" }],
      irLeagues: [],
      irEligibleLeagues: [],
      isWatchlisted: false,
    };

    render(
      <InjuryTab
        injuryReportPlayers={[entry]}
        currentNFLWeek={5}
        expandedInjuryId="p1"
        setExpandedInjuryId={vi.fn()}
      />
    );

    expect(screen.queryByText(/^IR /)).toBeNull();
  });

  it("outlines an eligible starting-lineup chip in red but leaves an ineligible one alone", () => {
    const entry: InjuryReportPlayer = {
      player: mkPlayer(),
      playerId: "p1",
      leagues: [
        { id: "leagueA", name: "Deep Ball Dimes" },
        { id: "leagueC", name: "Dynasty 26" },
      ],
      startingLeagues: [
        { id: "leagueA", name: "Deep Ball Dimes" },
        { id: "leagueC", name: "Dynasty 26" },
      ],
      irLeagues: [],
      irEligibleLeagues: [{ id: "leagueA", name: "Deep Ball Dimes" }],
      isWatchlisted: false,
    };

    render(
      <InjuryTab
        injuryReportPlayers={[entry]}
        currentNFLWeek={5}
        expandedInjuryId="p1"
        setExpandedInjuryId={vi.fn()}
      />
    );

    expect(screen.getByText("Deep Ball Dimes").className).toContain("border-red-500");
    expect(screen.getByText("Dynasty 26").className).not.toContain("border-red-500");
  });
});
