// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ChartingBoard, { type ChartingBoardProps } from "@/components/scouting/shared/ChartingBoard";
import type { OverviewData } from "@/components/scouting/overview/ProspectOverview";
import type { BoardScores, Prospect } from "@/lib/types";

// Nov 12 2026: the Pre grade mirrors the Dynasty Score until the class is
// drafted, and the Big Board writes it. The Bio panel shows it instead of
// offering to type over it; a drafted class, or a prospect without a Dynasty
// Score, keeps the input.

vi.mock("@/components/scouting/overview/ProspectOverview", () => ({ default: () => null }));
vi.mock("@/components/scouting/overview/ProspectScorePieces", () => ({ default: () => null }));
vi.mock("@/components/scouting/overview/ProspectProduction", () => ({ default: () => null }));
vi.mock("@/components/scouting/shared/RoleFields", () => ({ ShouldPlayField: () => null, WillPlayPostSelect: () => null }));

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
});

function props(prospect: Partial<Prospect>): ChartingBoardProps {
  const p = { id: "p", name: "Darius Taylor", position: "RB", school: "Minnesota", draft_class_year: 2027, ...prospect } as Prospect;
  return {
    prospect: p,
    config: { positionLabel: "RB", accentColor: "green", rolePos: "RB" },
    overviewData: {} as OverviewData,
    tab: "chart", games: [], selectedGameId: null, loading: false, gamePlayCounts: {},
    showAddGame: false, newGame: { year: 2026, opponent: "", type: "regular" }, savingGame: false, gameError: null,
    editBio: true, bio: { pre_draft_grade: p.pre_draft_grade, post_draft_grade: null }, savingBio: false,
    onBack: vi.fn(), onTabChange: vi.fn(), onSelectGame: vi.fn(), onToggleAddGame: vi.fn(), onNewGameChange: vi.fn(),
    onAddGame: vi.fn(), onDeleteGame: vi.fn(), onUpdateGame: vi.fn(), onToggleEditBio: vi.fn(), onBioChange: vi.fn(), onSaveBio: vi.fn(),
    renderPlayLogger: () => null,
    renderGamesTable: () => null,
  };
}
const scores = (dynasty: number | null) => ({ dynasty }) as BoardScores;

describe("Bio panel Pre-Draft Grade", () => {
  it("shows the mirrored grade, not an input, while it mirrors the Dynasty Score", () => {
    render(<ChartingBoard {...props({ pre_draft_grade: 83.9, board_scores: scores(1) })} />);
    expect(screen.queryByRole("textbox", { name: /^Pre-Draft Grade/ })).toBeNull();
    expect(screen.getByText("· mirrors Dynasty")).toBeTruthy();
    expect(screen.getAllByText("83.9").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: /^Post-Draft Grade/ })).toBeTruthy();
  });

  it("keeps the input without a Dynasty Score, or once the class is drafted", () => {
    render(<ChartingBoard {...props({ pre_draft_grade: 70, board_scores: scores(null) })} />);
    expect(screen.getByRole("textbox", { name: /^Pre-Draft Grade/ })).toBeTruthy();
    cleanup();
    render(<ChartingBoard {...props({ draft_class_year: 2026, pre_draft_grade: 70, board_scores: scores(1) })} />);
    expect(screen.getByRole("textbox", { name: /^Pre-Draft Grade/ })).toBeTruthy();
  });
});
