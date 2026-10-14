// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import LeagueStepperBar from "@/components/LeagueHub/LeagueStepperBar";
import type { LeagueStepSession } from "@/lib/helpers/actionQueue";
import type { SleeperLeague } from "@/lib/types";

// To-Do Stage 3 (10/14): the League Hub bar during a run through the leagues needing attention.

afterEach(cleanup);

const LEAGUES = [
  { league_id: "A", name: "Alpha" },
  { league_id: "B", name: "Bravo" },
  { league_id: "C", name: "Charlie" },
  { league_id: "D", name: "Delta" },
] as SleeperLeague[];
const SESSION: LeagueStepSession = {
  userId: "me",
  stops: [{ leagueId: "B", appTab: "STARTERS" }, { leagueId: "A", appTab: "STARTERS" }, { leagueId: "C", appTab: "ROSTERS" }],
  cursor: 1,
};

function renderBar(selectedLeagueId: string | null, session: LeagueStepSession = SESSION) {
  const handlers = { onStep: vi.fn(), onBackToTodo: vi.fn(), onClose: vi.fn() };
  render(<LeagueStepperBar session={session} leagues={LEAGUES} selectedLeagueId={selectedLeagueId} {...handlers} />);
  return handlers;
}
const prev = () => screen.getByRole("button", { name: "Previous league needing attention" }) as HTMLButtonElement;
const next = () => screen.getByRole("button", { name: "Next league needing attention" }) as HTMLButtonElement;

describe("LeagueStepperBar", () => {
  it("shows where the selected league sits in the run, with Prev / Next", () => {
    const handlers = renderBar("A");
    expect(screen.getByText("League 2 of 3 needing attention")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    fireEvent.click(prev());
    fireEvent.click(next());
    expect(handlers.onStep.mock.calls).toEqual([[-1], [1]]);
  });

  it("disables Prev on the first league and Next on the last", () => {
    renderBar("B");
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(false);
    cleanup();
    renderBar("C");
    expect(prev().disabled).toBe(false);
    expect(next().disabled).toBe(true);
  });

  it("off the list: says so, and Next / Prev go on from the last league landed on", () => {
    renderBar("D");
    expect(screen.getByText("Not on the list · 3 leagues needing attention")).toBeTruthy();
    expect(prev().disabled).toBe(false);
    expect(next().disabled).toBe(false);
    cleanup();
    renderBar("D", { ...SESSION, cursor: -1 });
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(false);
  });

  it("opens the selected league in Sleeper, goes back to To-Do, and closes", () => {
    const handlers = renderBar("A");
    const link = screen.getByRole("link", { name: /Open in Sleeper/ }) as HTMLAnchorElement;
    expect(link.href).toBe("https://sleeper.com/leagues/A");
    expect(link.target).toBe("_blank");
    fireEvent.click(screen.getByRole("button", { name: "Back to To-Do" }));
    fireEvent.click(screen.getByRole("button", { name: "Close the leagues needing attention bar" }));
    expect(handlers.onBackToTodo).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});
