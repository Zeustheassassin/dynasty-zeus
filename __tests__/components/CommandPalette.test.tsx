// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette, type CommandPaletteProps } from "@/components/CommandPalette";
import type { LeagueStepTarget } from "@/app/hooks/useLeagueStepper";
import type { SleeperLeague } from "@/lib/types";

// To-Do Stage 3 (10/14): the palette's league-stepping entries, the To-Do views, and "todo"
// finding To-Do.

afterEach(cleanup);
// jsdom has no scrollIntoView (the palette keeps the highlighted row in view).
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });

const LEAGUES = [{ league_id: "A", name: "Alpha" }, { league_id: "B", name: "Bravo" }] as SleeperLeague[];
const target = (leagueId: string, index: number, total = 9): LeagueStepTarget => ({
  stop: { leagueId, appTab: "STARTERS" }, index, total,
});

function renderPalette(peek: (dir: 1 | -1) => LeagueStepTarget | null) {
  const props: CommandPaletteProps = {
    players: {},
    leagues: LEAGUES,
    setMainTab: vi.fn(),
    setTradeHubSection: vi.fn(),
    setLeagueHubTab: vi.fn(),
    setDataHubTab: vi.fn(),
    setDraftHubSection: vi.fn(),
    setPlayerProfileId: vi.fn(),
    setTodoView: vi.fn(),
    stepLeague: vi.fn(() => true),
    peekLeagueStep: vi.fn(peek),
    onClose: vi.fn(),
  };
  render(<CommandPalette {...props} />);
  return props;
}
const options = () => screen.getAllByRole("button").map((b) => b.textContent);
const search = (q: string) => fireEvent.change(screen.getByPlaceholderText(/Jump to/), { target: { value: q } });

describe("CommandPalette — leagues needing attention", () => {
  it("leads with Next (and Previous mid-run), naming the league and its place", () => {
    const props = renderPalette((dir) => (dir > 0 ? target("B", 3) : target("A", 1)));
    expect(options().slice(0, 2)).toEqual([
      "Next league needing attention: Bravo (4 of 9)",
      "Previous league needing attention: Alpha (2 of 9)",
    ]);
    fireEvent.click(screen.getByText("Previous league needing attention: Alpha (2 of 9)"));
    expect(props.stepLeague).toHaveBeenCalledWith(-1);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("leaves out Previous when it would jump to the end of a new run", () => {
    renderPalette((dir) => (dir > 0 ? target("B", 0) : target("A", 8)));
    expect(options()[0]).toBe("Next league needing attention: Bravo (1 of 9)");
    expect(options().some((o) => o?.startsWith("Previous"))).toBe(false);
  });

  it("shows no stepping entries with nothing to do, and filters them by the search", () => {
    renderPalette(() => null);
    expect(options().some((o) => o?.includes("needing attention"))).toBe(false);
    cleanup();
    renderPalette((dir) => (dir > 0 ? target("B", 0) : null));
    search("next");
    expect(options()[0]).toBe("Next league needing attention: Bravo (1 of 9)");
    search("rankings");
    expect(options().some((o) => o?.includes("needing attention"))).toBe(false);
  });
});

describe("CommandPalette — To-Do", () => {
  it("finds To-Do and its views by \"todo\" and opens the view picked", () => {
    const props = renderPalette(() => null);
    search("todo");
    expect(options()).toEqual(["To-Do", "To-Do: By league", "To-Do: By player", "To-Do: Waiver Watch"]);
    fireEvent.click(screen.getByText("To-Do: Waiver Watch"));
    expect(props.setMainTab).toHaveBeenCalledWith("TODO");
    expect(props.setTodoView).toHaveBeenCalledWith("WAIVER_WATCH");
  });
});
