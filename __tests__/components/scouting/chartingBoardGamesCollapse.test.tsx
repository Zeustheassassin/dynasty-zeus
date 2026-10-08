// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ChartingBoard, { type ChartingBoardProps } from "@/components/scouting/shared/ChartingBoard";
import type { OverviewData } from "@/components/scouting/overview/ProspectOverview";
import type { Prospect, ScoutingGame } from "@/lib/types";

// Oct 7 2026: charting in split screen, the user asked to shrink the Chart Game tab's games
// list out of the way. A « button collapses it to a thin rail and the logger takes the full
// width; the rail brings it back, and the choice is remembered.

// The report tabs aren't on Chart Game; stubbing them keeps their data layer (Supabase) out.
vi.mock("@/components/scouting/overview/ProspectOverview", () => ({ default: () => null }));
vi.mock("@/components/scouting/overview/ProspectScorePieces", () => ({ default: () => null }));
vi.mock("@/components/scouting/overview/ProspectProduction", () => ({ default: () => null }));

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const game = { id: "g1", prospect_id: "p", season_year: 2026, opponent: "Eastern Illinois", game_type: "regular" } as ScoutingGame;

function props(): ChartingBoardProps {
  return {
    prospect: { id: "p", name: "Darius Taylor", position: "RB", school: "Minnesota", draft_class_year: 2027 } as Prospect,
    config: { positionLabel: "RB", accentColor: "green", nflRoles: [] },
    overviewData: {} as OverviewData,
    tab: "chart", games: [game], selectedGameId: "g1", loading: false, gamePlayCounts: { g1: 0 },
    showAddGame: false, newGame: { year: 2026, opponent: "", type: "regular" }, savingGame: false, gameError: null,
    editBio: false, bio: {}, savingBio: false,
    onBack: vi.fn(), onTabChange: vi.fn(), onSelectGame: vi.fn(), onToggleAddGame: vi.fn(), onNewGameChange: vi.fn(),
    onAddGame: vi.fn(), onDeleteGame: vi.fn(), onUpdateGame: vi.fn(), onToggleEditBio: vi.fn(), onBioChange: vi.fn(), onSaveBio: vi.fn(),
    renderPlayLogger: () => <div data-testid="logger">logger</div>,
    renderGamesTable: () => null,
  };
}

describe("Chart Game: collapsible games list", () => {
  it("collapses the games list to a rail, gives the logger the full row, and expands it again", () => {
    render(<ChartingBoard {...props()} />);
    expect(screen.getByText("2026 Eastern Illinois")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide games list" }));
    expect(screen.queryByText("2026 Eastern Illinois")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add" })).toBeNull();
    expect(screen.getByTestId("logger").parentElement!.className).toContain("flex-1");
    expect(screen.getByRole("button", { name: "Show games list" }).textContent).toContain("Games (1)");

    fireEvent.click(screen.getByRole("button", { name: "Show games list" }));
    expect(screen.getByText("2026 Eastern Illinois")).toBeTruthy();
    expect(screen.getByTestId("logger").parentElement!.className).toContain("md:col-span-2");
  });

  it("remembers the collapsed choice for the next board opened", () => {
    render(<ChartingBoard {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide games list" }));
    cleanup();

    render(<ChartingBoard {...props()} />);
    expect(screen.getByRole("button", { name: "Show games list" })).toBeTruthy();
    expect(screen.queryByText("2026 Eastern Illinois")).toBeNull();
  });
});
