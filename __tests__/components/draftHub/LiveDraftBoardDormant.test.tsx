// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Weeks 1–17 the Live Draft Board is blank (user 10/10): no grid, no Refresh, no Draft Scout —
// nothing on it can call Sleeper. useAppState doesn't load the board then either.

vi.mock("@/lib/PlayersContext", () => ({ usePlayers: () => ({}) }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ supabaseUser: null }) }));
vi.mock("@/lib/LeagueContext", () => ({
  useLeague: () => ({ selectedLeague: { league_id: "1", name: "League" }, rosters: [], users: {} }),
}));
vi.mock("@/lib/supabaseclient", () => ({ supabase: { from: vi.fn() } }));

import LiveDraftBoard from "@/components/draftHub/LiveDraftBoard";

// This project doesn't set `test.globals: true`, so testing-library's auto-cleanup never registers.
afterEach(cleanup);

function renderBoard(dormant: boolean) {
  const refreshDraftBoard = vi.fn();
  const loadDraftScout = vi.fn();
  render(
    <LiveDraftBoard
      myDraftSlotPicks={{}} setMyDraftSlotPicks={vi.fn()}
      draftSlotEditing={null} setDraftSlotEditing={vi.fn()}
      draftSlotSearchQuery="" setDraftSlotSearchQuery={vi.fn()}
      user={{ user_id: "me" } as never}
      draftSettings={null} draftPicks={[]} draftOrder={{}} allPicks={[]}
      boardRookies={[]} myPickList={[]} draftedPlayerIds={new Set()}
      predictedDraftPicks={{}} draftPoolRanks={{} as never} topAvailableRookies={[]}
      refreshDraftBoard={refreshDraftBoard} loadDraftScout={loadDraftScout} loadingDraftRefresh={false}
      dormant={dormant}
    />,
  );
  return { refreshDraftBoard, loadDraftScout };
}

describe("LiveDraftBoard in season", () => {
  it("shows only the off-season note — no Refresh, nothing that calls Sleeper", () => {
    const { refreshDraftBoard, loadDraftScout } = renderBoard(true);
    expect(screen.getByRole("status").textContent).toContain("Rookie drafts are done for the season");
    expect(screen.getByRole("status").textContent).toContain("Week 17");
    expect(screen.queryByText(/Refresh Board/)).toBeNull();
    expect(screen.queryByText("No draft data available")).toBeNull();
    expect(refreshDraftBoard).not.toHaveBeenCalled();
    expect(loadDraftScout).not.toHaveBeenCalled();
  });

  it("is the normal board the rest of the year", () => {
    renderBoard(false);
    expect(screen.queryByText("Rookie drafts are done for the season")).toBeNull();
    expect(screen.getByText(/Refresh Board/)).toBeTruthy();
    expect(screen.getByText("No draft data available")).toBeTruthy();
  });
});
