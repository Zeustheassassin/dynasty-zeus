// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import StatsTableShell, { type ColDef, type StatRow } from "@/components/scouting/stats/StatsTableShell";
import { buildQBStatRows } from "@/components/scouting/stats/QBStatsTable";
import type { Prospect, ScoutingGame, QBPlay } from "@/lib/types";

// The Analysis tables' "Min Routes / Runs / Blocks / Throws" boxes: hide
// prospects below a sample size, the way search hides by name.

const COLS: ColDef[] = [
  { key: "name",   label: "Name",   group: "Identity", fmt: "name",  sticky: true },
  { key: "routes", label: "Routes", group: "Identity", fmt: "count" },
  { key: "blocks", label: "Blocks", group: "Identity", fmt: "count" },
];
const ROWS: StatRow[] = [
  { id: "a", name: "Alpha",   routes: 150, blocks: 10 },
  { id: "b", name: "Bravo",   routes: 40,  blocks: 90 },
  { id: "c", name: "Charlie", routes: 12,  blocks: null },
];

afterEach(cleanup);

// The shell sizes its proxy scrollbars with a ResizeObserver, which jsdom lacks.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const renderShell = () =>
  render(
    <StatsTableShell
      cols={COLS}
      rows={ROWS}
      minFilters={[{ key: "routes", label: "Routes" }, { key: "blocks", label: "Blocks" }]}
    />,
  );
const visibleNames = () =>
  screen.getAllByRole("row")
    .map((r) => within(r).queryAllByRole("cell")[0]?.textContent)
    .filter((n): n is string => !!n && n !== "League");

describe("StatsTableShell min filters", () => {
  it("shows every row until a minimum is typed", () => {
    renderShell();
    expect(visibleNames()).toEqual(expect.arrayContaining(["Alpha", "Bravo", "Charlie"]));
    expect(screen.getByText("3 players")).toBeTruthy();
  });

  it("hides rows below the minimum, inclusive of the number typed", () => {
    renderShell();
    fireEvent.change(screen.getByLabelText("Min Routes"), { target: { value: "40" } });
    expect(visibleNames().sort()).toEqual(["Alpha", "Bravo"]);
    expect(screen.getByText("2 players")).toBeTruthy();
  });

  it("combines filters, and a missing count never passes a minimum", () => {
    renderShell();
    fireEvent.change(screen.getByLabelText("Min Routes"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Min Blocks"), { target: { value: "5" } });
    // Charlie has 12 routes but no block count → out once Min Blocks is set.
    expect(visibleNames().sort()).toEqual(["Alpha", "Bravo"]);
  });

  it("clearing the box brings the rows back", () => {
    renderShell();
    const box = screen.getByLabelText("Min Routes");
    fireEvent.change(box, { target: { value: "100" } });
    expect(visibleNames()).toEqual(["Alpha"]);
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getByText("3 players")).toBeTruthy();
  });

  it("keeps the League footer on every row, not just the visible ones", () => {
    renderShell();
    fireEvent.change(screen.getByLabelText("Min Routes"), { target: { value: "100" } });
    const footer = screen.getAllByRole("row").find((r) => r.textContent?.startsWith("League"))!;
    // 150 + 40 + 12 routes
    expect(footer.textContent).toContain("202");
  });
});

describe("QB Throws column", () => {
  it("counts balls thrown: pass/RPO snaps minus scrambles, sacks and throw-aways", () => {
    const prospects = [{ id: "qb", name: "QB", position: "QB", draft_class_year: 2027 }] as unknown as Prospect[];
    const games = [{ id: "g", prospect_id: "qb" }] as unknown as ScoutingGame[];
    const play = (p: Partial<QBPlay>) => ({ game_id: "g", play_type: "pass", timing: "first_option", accuracy: "on_target", ...p }) as unknown as QBPlay;
    const plays = [
      play({}), play({ play_type: "rpo" }), play({ accuracy: "tipped_ball" }), play({ accuracy: null }),  // 4 thrown
      play({ timing: "scramble", accuracy: null }),
      play({ timing: "sack", accuracy: null }),
      play({ timing: "throw_away", accuracy: null }),
      play({ play_type: "run", timing: null, accuracy: null }),
    ];
    const [row] = buildQBStatRows(prospects, games, plays);
    expect(row.snaps).toBe(8);
    expect(row.throws).toBe(4);
  });
});
