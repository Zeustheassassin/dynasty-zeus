// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import GameContextPanel from "@/components/scouting/context/GameContextPanel";
import GradingChecks from "@/components/scouting/stats/GradingChecks";
import type { GameContextLog } from "@/components/scouting/context/useGameContextLog";
import type { GameContext } from "@/lib/scouting/gameContext";
import { EMPTY_GRADING_DATA } from "@/lib/scouting/aeComponents";
import type { Prospect, RBPlay, ScoutingGame } from "@/lib/types";

afterEach(cleanup);

const game = (id: string, opponent: string, created: string, extra: Partial<ScoutingGame> = {}) =>
  ({ id, prospect_id: "p", season_year: 2025, opponent, created_at: created, game_type: "regular", left_early: null, played_hurt: false, ...extra }) as ScoutingGame;

const ctx = (gameId: string, extra: Partial<GameContext> = {}): GameContext => ({
  gameId, matched: true, note: null, teamSchool: "Iowa", opponentSchool: "Michigan State", opponentFcs: false,
  oppDefSp: 18.4, oppDefRank: 20, oppSp: 10, oppSpRank: 30, kickoff: "2025-11-15T17:00:00Z", venue: "Kinnick", home: true,
  neutral: false, teamPoints: 24, oppPoints: 17,
  weather: { status: "ok", temperatureF: 38, windMph: 16, gustMph: 28, precipIn: 0.12, snowIn: 0, code: 63 },
  cast: { olPassBlock: 68, olRunBlock: 61, qbPassGrade: 72.4, qbName: "Mark Gronowski" },
  hisSnaps: 30, teamSnaps: 70, snapShare: 30 / 70, ...extra,
});

function log(over: Partial<GameContextLog> = {}): GameContextLog {
  return {
    contexts: new Map(), suggestions: new Map(), unmatched: new Map(), error: null,
    refresh: vi.fn(async () => {}), patchGame: vi.fn(async () => {}), setTrait: vi.fn(async () => {}),
    refreshing: false, progressNote: null, filled: 0, ...over,
  } as GameContextLog;
}

describe("Games tab: game context", () => {
  it("shows each game's opponent defense, weather, cast and snaps, and flags a mislabeled opponent", () => {
    const g = game("g1", "Mississippi State", "2026-04-01T00:00:00Z");
    render(<GameContextPanel position="RB" games={[g]} log={log({ contexts: new Map([["g1", ctx("g1")]]), filled: 1 })} />);
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText(/→ Michigan State/)).toBeTruthy();
    expect(row.textContent).toContain("18.4 #20");
    expect(row.textContent).toContain("38° · 16 mph · rain");
    expect(row.textContent).toContain("68 / 61");
    expect(row.textContent).toContain("Gronowski 72");
    expect(row.textContent).toContain("30/70 (43%)");
  });

  it("left early: confirm or dismiss a suggestion; mark one by hand; undo a call", () => {
    const l = log({
      contexts: new Map([["g1", ctx("g1")], ["g2", ctx("g2")]]),
      suggestions: new Map([["g1", { gameId: "g1", share: 0.43, usual: 0.9, hisSnaps: 30, teamSnaps: 70, blowout: false }]]),
    });
    const g3 = game("g3", "Ohio State", "2026-04-01T00:00:00Z", { left_early: true });
    render(<GameContextPanel position="RB" games={[game("g1", "A", "2026-04-01T00:00:00Z"), game("g2", "B", "2026-04-01T00:00:00Z"), g3]} log={l} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm he left early" }));
    expect(l.patchGame).toHaveBeenCalledWith("g1", { left_early: true });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss: he didn't leave early" }));
    expect(l.patchGame).toHaveBeenCalledWith("g1", { left_early: false });
    fireEvent.click(screen.getByRole("button", { name: "Mark" }));
    expect(l.patchGame).toHaveBeenCalledWith("g2", { left_early: true });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(l.patchGame).toHaveBeenCalledWith("g3", { left_early: null });
  });

  it("played hurt is a toggle on any game, old ones too", () => {
    const l = log();
    render(<GameContextPanel position="WR" games={[game("old", "Iowa", "2026-03-01T00:00:00Z")]} log={l} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Played hurt: 2025 Iowa" }));
    expect(l.patchGame).toHaveBeenCalledWith("old", { played_hurt: true });
  });

  it("trait grades (1–10) only on new games", () => {
    const l = log();
    const newGame = game("new", "Purdue", "2026-10-06T00:00:00Z", { trait_grades: { arm: 7 } });
    render(<GameContextPanel position="QB" games={[game("old", "Iowa", "2026-03-01T00:00:00Z"), newGame]} log={l} />);
    expect(screen.queryByRole("combobox", { name: "Arm: 2025 Iowa" })).toBeNull();
    const arm = screen.getByRole("combobox", { name: "Arm: 2025 Purdue" }) as HTMLSelectElement;
    expect(arm.value).toBe("7");
    expect(within(arm).getAllByRole("option")).toHaveLength(11);
    fireEvent.change(screen.getByRole("combobox", { name: "Creation: 2025 Purdue" }), { target: { value: "9" } });
    expect(l.setTrait).toHaveBeenCalledWith(newGame, "creation", 9);
    // No QB column on a QB's own board.
    expect(screen.queryByRole("columnheader", { name: "QB" })).toBeNull();
  });

  it("says when no game can be graded yet", () => {
    render(<GameContextPanel position="TE" games={[game("old", "Iowa", "2026-03-01T00:00:00Z")]} log={log()} />);
    expect(screen.getByText(/No new games yet/)).toBeTruthy();
  });
});

describe("Analysis → Grading checks: game context", () => {
  it("shows the context tests, the flag tests and trait readiness", () => {
    const games = [{ id: "g", prospect_id: "r", season_year: 2025, created_at: "2026-06-01T00:00:00Z" }] as ScoutingGame[];
    const rbPlays = Array.from({ length: 20 }, (_, i) => ({ game_id: "g", run_type: "inside_zone", formation: "gun", success: i % 2 === 0, loaded_box: false, unblocked_defender: false })) as RBPlay[];
    render(
      <GradingChecks
        prospects={[{ id: "r", position: "RB" } as Prospect]}
        games={games} qbPlays={[]} rbPlays={rbPlays} tePlays={[]}
        gameRouteCells={null} gradingData={EMPTY_GRADING_DATA}
      />,
    );
    for (const h of ["Game context", "Left early and played hurt", "Trait grades"]) {
      expect(screen.getByRole("heading", { name: h })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Run the chance checks" })).toBeTruthy();
    expect(screen.getAllByText("Opp. defense SP+").length).toBeGreaterThan(0);
  });
});
