// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { SleeperLeague } from "@/lib/types";
import type { NflSeasonLinesState } from "@/hooks/useNflSeasonLines";
import type { LinePos, SeasonLine } from "@/lib/helpers/nflSeasonLines";

// Draft Hub → League Formats (stage 9 of the 2026-11-26 scouting plan), and
// positional value per league on it (stage 1 of the 2026-11-27 plan).

const h = vi.hoisted(() => ({ state: null as unknown as NflSeasonLinesState }));
vi.mock("@/hooks/useNflSeasonLines", () => ({ useNflSeasonLines: () => h.state }));

import LeagueFormatsTab from "@/components/draftHub/LeagueFormatsTab";

afterEach(cleanup);

const SF = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX", "BN"];
const league = (id: string, name: string, scoring: Record<string, number>, type = 2, roster = SF): SleeperLeague =>
  ({
    league_id: id, name, season: "2026", season_type: "regular", status: "in_season", sport: "nfl", total_rosters: 12,
    roster_positions: roster, scoring_settings: scoring, avatar: null, draft_id: null, previous_league_id: null,
    settings: { playoff_week_start: 15, playoff_teams: 6, num_teams: 12, type, draft_rounds: 4 },
  }) as SleeperLeague;

const YARDS = { pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1, rec_td: 6 };
const LEAGUES = [
  league("1", "Alpha Dynasty", { ...YARDS, rec: 1, bonus_rec_te: 0.5, pass_td: 4 }),
  league("2", "Beta Dynasty", { ...YARDS, rec: 1, bonus_rec_te: 0.5, pass_td: 4, rec_td_40p: 2 }),
  league("3", "Gamma TEP", { ...YARDS, rec: 1, bonus_rec_te: 1, pass_td: 6 }),
  league("4", "Redraft Pals", { rec: 0.5, pass_td: 4 }, 0, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"]),
];

const line = (season: number, pos: LinePos, stats: Record<string, number>): SeasonLine => ({ season, pos, games: 16, stats });
const LINES: SeasonLine[] = [2024, 2025].flatMap((season) => [
  ...Array.from({ length: 30 }, (_, i) => line(season, "QB", { pass_td: 40 - i, pass_yd: 4500 - 60 * i })),
  ...Array.from({ length: 50 }, (_, i) => line(season, "RB", { rush_yd: 1600 - 25 * i, rec: 60 - i, rec_yd: 450 - 5 * i })),
  ...Array.from({ length: 70 }, (_, i) => line(season, "WR", { rec: 115 - i, rec_yd: 1500 - 17 * i, rec_td: 10 - i / 10 })),
  ...Array.from({ length: 35 }, (_, i) => line(season, "TE", { rec: 95 - 2 * i, rec_yd: 1100 - 25 * i, rec_td: 8 - i / 5 })),
]);

const retry = vi.fn();
beforeEach(() => {
  retry.mockReset();
  h.state = { lines: LINES, seasons: [2024, 2025], error: null, retry };
});

const valueCells = (row: HTMLElement) => within(row).getAllByText(/^×\d/);

describe("LeagueFormatsTab", () => {
  it("shows each dynasty league's format and the counts across them, odd values highlighted", () => {
    render(<LeagueFormatsTab leagues={LEAGUES} />);
    const summary = screen.getByRole("region", { name: "Formats across your leagues" });
    expect(within(summary).getByText("3 leagues")).toBeTruthy();
    expect(within(summary).getByText("0.5 ×2 · 1 ×1")).toBeTruthy(); // TEP
    expect(within(summary).getByText("4 ×2 · 6 ×1")).toBeTruthy(); // pass TD
    expect(screen.queryByText("Redraft Pals")).toBeNull();
    const gamma = screen.getByText("Gamma TEP").closest("tr")!;
    expect(within(gamma).getByText("QB 1 · RB 2 · WR 3 · TE 1 · FLEX 2 · SF 1")).toBeTruthy();
    const six = within(gamma).getByText("6");
    expect(six.className).toContain("text-amber-300");
    expect(six.getAttribute("title")).toBe("Most of your leagues: 4");
  });

  it("can take in the redraft leagues too", () => {
    render(<LeagueFormatsTab leagues={LEAGUES} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Dynasty leagues only \(3 of 4\)/ }));
    expect(screen.getByText("Redraft Pals")).toBeTruthy();
    expect(within(screen.getByText("Redraft Pals").closest("tr")!).getByText("Redraft")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Formats across your leagues" })).getByText("4 leagues")).toBeTruthy();
  });

  it("says so when no league is loaded", () => {
    render(<LeagueFormatsTab leagues={[]} />);
    expect(screen.getByText("No leagues loaded yet.")).toBeTruthy();
  });
});

describe("positional value", () => {
  it("states the usual format and its starters, and values each league against it", () => {
    render(<LeagueFormatsTab leagues={LEAGUES} />);
    const section = screen.getByRole("region", { name: "Positional value" });
    expect(within(section).getByText("Your usual format: 12 teams · QB 1 · RB 2 · WR 3 · TE 1 · FLEX 2 · SF 1 · PPR 1 · TEP 0.5 · pass TD 4")).toBeTruthy();
    expect(within(section).getByText(/across your 3 dynasty leagues/)).toBeTruthy();
    expect(within(section).getByText(/^QB \d+ start \(\d+ in superflex\) · replacement [\d.]+ pts\/g · \d+% of starting value$/)).toBeTruthy();
    expect(within(section).getByText(/2024–2025 NFL seasons/)).toBeTruthy();

    // A league in the usual format reads ×1.00 everywhere.
    expect(valueCells(screen.getByText("Alpha Dynasty").closest("tr")!).map((c) => c.textContent)).toEqual(["×1.00", "×1.00", "×1.00", "×1.00"]);
    // Full TE premium and 6-point TDs: QB and TE up (teal), with their starters in the tooltip.
    const [qb, , , te] = valueCells(screen.getByText("Gamma TEP").closest("tr")!);
    expect(Number(te.textContent!.slice(1))).toBeGreaterThan(1.05);
    expect(te.className).toContain("text-teal-300");
    expect(Number(qb.textContent!.slice(1))).toBeGreaterThan(1.05);
    expect(te.getAttribute("title")).toMatch(/^TE here: \d+ start.*\nYour usual format: \d+ start/);
  });

  it("marks a league whose rules the NFL stats can't all rebuild", () => {
    render(<LeagueFormatsTab leagues={LEAGUES} />);
    const beta = screen.getByText("Beta Dynasty").closest("tr")!;
    const chip = within(beta).getByText("1 rule not counted");
    expect(chip.getAttribute("title")).toBe("Not in the value numbers (the NFL stats can't rebuild them): 40+ Yard TD Catch 2");
    // The usual format takes the most common value of each rule, so Beta's extra one doesn't move it.
    expect(within(screen.getByText("Alpha Dynasty").closest("tr")!).queryByText(/not counted/)).toBeNull();
  });

  it("waits for the seasons, and offers a retry when they fail", () => {
    h.state = { lines: null, seasons: [2023, 2024, 2025], error: null, retry };
    const { unmount } = render(<LeagueFormatsTab leagues={LEAGUES} />);
    expect(screen.getByText("Reading the 2023–2025 NFL seasons (nflverse)…")).toBeTruthy();
    expect(within(screen.getByText("Alpha Dynasty").closest("tr")!).getAllByText("…")).toHaveLength(4);
    unmount();

    h.state = { lines: null, seasons: [2023, 2024, 2025], error: "The NFL season stats couldn't be loaded.", retry };
    render(<LeagueFormatsTab leagues={LEAGUES} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
