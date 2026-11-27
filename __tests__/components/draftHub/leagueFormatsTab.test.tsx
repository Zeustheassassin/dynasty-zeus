// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import LeagueFormatsTab from "@/components/draftHub/LeagueFormatsTab";
import type { SleeperLeague } from "@/lib/types";

// Draft Hub → League Formats (stage 9 of the 2026-11-26 scouting plan).

afterEach(cleanup);

const SF = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX", "BN"];
const league = (id: string, name: string, scoring: Record<string, number>, type = 2, roster = SF): SleeperLeague =>
  ({
    league_id: id, name, season: "2026", season_type: "regular", status: "in_season", sport: "nfl", total_rosters: 12,
    roster_positions: roster, scoring_settings: scoring, avatar: null, draft_id: null, previous_league_id: null,
    settings: { playoff_week_start: 15, playoff_teams: 6, num_teams: 12, type, draft_rounds: 4 },
  }) as SleeperLeague;

const LEAGUES = [
  league("1", "Alpha Dynasty", { rec: 1, bonus_rec_te: 0.5, pass_td: 4 }),
  league("2", "Beta Dynasty", { rec: 1, bonus_rec_te: 0.5, pass_td: 4 }),
  league("3", "Gamma TEP", { rec: 1, bonus_rec_te: 1, pass_td: 6 }),
  league("4", "Redraft Pals", { rec: 0.5, pass_td: 4 }, 0, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"]),
];

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
