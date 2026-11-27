// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GameSampleToggle, SampleSwitchPanel, SampleTotalLabel, SetAsideMark, SetAsideNote } from "@/components/scouting/shared/SampleSwitch";
import { sampleSwitchFor } from "@/lib/scouting/sampleGames";
import type { RoutePlay, ScoutingGame } from "@/lib/types";

// The imported-game "Count in sample" switch on a board (stage 3 of the
// 2026-11-26 scouting plan).

afterEach(cleanup);

const IMPORTED = "2026-04-30T19:00:00Z";
const game = (id: string, created_at: string, count_in_sample?: boolean): ScoutingGame =>
  ({ id, prospect_id: "w", season_year: 2025, opponent: `Opp ${id}`, created_at, ...(count_in_sample === undefined ? {} : { count_in_sample }) }) as unknown as ScoutingGame;
const routes = (game_id: string, n: number): RoutePlay[] =>
  Array.from({ length: n }, () => ({ game_id, no_route_run: false }) as unknown as RoutePlay);
const isRoute = (p: RoutePlay) => !p.no_route_run;

describe("SampleSwitchPanel", () => {
  it("shows the floor until he has half a sample in the app, with no buttons", () => {
    const games = [game("old", IMPORTED, true), game("new", "2026-11-01T12:00:00Z", true)];
    const sw = sampleSwitchFor("WR", games, [...routes("old", 48), ...routes("new", 40)], isRoute);
    render(<SampleSwitchPanel sw={sw} games={games} onSet={vi.fn()} />);
    expect(screen.getByText(/Count in sample opens at 80/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set all aside" })).toBeNull();
  });

  it("once open, sets every counting imported game aside in one go", () => {
    const games = [game("old1", IMPORTED, true), game("old2", IMPORTED, true), game("new", "2026-11-01T12:00:00Z", true)];
    const sw = sampleSwitchFor("WR", games, [...routes("old1", 20), ...routes("old2", 28), ...routes("new", 160)], isRoute);
    const onSet = vi.fn();
    render(<SampleSwitchPanel sw={sw} games={games} onSet={onSet} />);
    fireEvent.click(screen.getByRole("button", { name: "Set all aside" }));
    expect(onSet).toHaveBeenCalledWith(["old1", "old2"], false);
  });

  it("says migration 107 is needed while the games carry no column", () => {
    const games = [game("old", IMPORTED), game("new", "2026-11-01T12:00:00Z")];
    const sw = sampleSwitchFor("WR", games, [...routes("old", 48), ...routes("new", 160)], isRoute);
    render(<SampleSwitchPanel sw={sw} games={games} onSet={vi.fn()} />);
    expect(screen.getByText("Count in sample needs migration 107.")).toBeTruthy();
  });
});

describe("GameSampleToggle and the set-aside marks", () => {
  const games = [game("old", IMPORTED, false), game("new", "2026-11-01T12:00:00Z", true)];
  const sw = sampleSwitchFor("WR", games, [...routes("old", 48), ...routes("new", 20)], isRoute);

  it("a set-aside game keeps its switch under the floor, and switching it counts it again", () => {
    const onSet = vi.fn();
    render(<GameSampleToggle game={games[0]} sw={sw} ready onSet={onSet} />);
    const btn = screen.getByRole("button", { name: /Count imported game/ });
    expect(btn.textContent).toBe("Set aside");
    fireEvent.click(btn);
    expect(onSet).toHaveBeenCalledWith(["old"], true);
  });

  it("an in-app game has no switch", () => {
    const { container } = render(<GameSampleToggle game={games[1]} sw={sw} ready onSet={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("notes the set-aside games on the report tabs and the Games table", () => {
    render(<><SetAsideNote sw={sw} /><SetAsideMark game={games[0]} /><SampleTotalLabel games={games} /></>);
    expect(screen.getByText(/1 imported game \(48 routes\) set aside/)).toBeTruthy();
    expect(screen.getByText("set aside")).toBeTruthy();
    expect(screen.getByText("Sample total (1 of 2 games)")).toBeTruthy();
  });
});
