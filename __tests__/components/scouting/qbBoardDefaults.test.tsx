// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import QBChartingBoard from "@/components/scouting/qb/QBChartingBoard";
import type { OverviewData } from "@/components/scouting/overview/ProspectOverview";
import type { Prospect } from "@/lib/types";

// Stage 4 of the 2026-11-26 scouting plan (the user's call): the QB board opens
// on, and resets to, Shotgun / Pass / 1st Option / Clean Pocket / On Platform /
// Touch Correct. The real board; only the database and the other tabs are stubbed.

const { TABLES, INSERTS } = vi.hoisted(() => ({
  TABLES: {} as Record<string, Record<string, unknown>[]>,
  INSERTS: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabaseclient", () => {
  function query(table: string) {
    const filters: [string, unknown][] = [];
    let inserted: Record<string, unknown> | null = null;
    const rows = () => (TABLES[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const q: Record<string, unknown> = {};
    for (const m of ["select", "in", "order", "range", "limit", "is", "not", "gte", "lte", "neq", "or", "update", "upsert", "delete"]) {
      q[m] = () => q;
    }
    q.insert = (payload: Record<string, unknown>) => {
      inserted = { ...payload, id: `new${INSERTS.length}`, created_at: "2026-11-27T12:00:00Z" };
      INSERTS.push(payload);
      return q;
    };
    q.eq = (k: string, v: unknown) => { filters.push([k, v]); return q; };
    q.single = () => Promise.resolve({ data: inserted ?? rows()[0] ?? null, error: null });
    q.maybeSingle = q.single;
    q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, bad);
    return q;
  }
  return {
    supabase: {
      from: (t: string) => query(t),
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    },
  };
});
vi.mock("@/components/scouting/qb/QBOverviewPanel", () => ({ default: () => null }));
vi.mock("@/components/scouting/qb/QBPlayerCharts", () => ({ default: () => null }));
vi.mock("@/components/scouting/overview/ProspectOverview", () => ({ default: () => null }));
vi.mock("@/components/scouting/overview/ProspectScorePieces", () => ({ default: () => null }));
vi.mock("@/components/scouting/overview/ProspectProduction", () => ({ default: () => null }));
vi.mock("@/components/scouting/shared/RoleFields", () => ({ ShouldPlayField: () => null, WillPlayPostSelect: () => null }));

const prospect = { id: "p", name: "Test Passer", position: "QB", school: "State", draft_class_year: 2027 } as Prospect;

beforeEach(() => {
  INSERTS.length = 0;
  localStorage.clear();
  TABLES.scouting_games = [{
    id: "g1", user_id: "u", prospect_id: "p", season_year: 2026, opponent: "Rival", game_slot: 1,
    game_type: "regular", created_at: "2026-11-20T12:00:00Z", count_in_sample: true,
  }];
  TABLES.qb_plays = [];
});
afterEach(() => cleanup());

async function openBoard() {
  render(
    <QBChartingBoard prospect={prospect} initialGameId="g1" onBack={vi.fn()} onDataChanged={vi.fn()}
      overviewData={{} as OverviewData} allProspects={[]} allGames={[]} />,
  );
  await screen.findByText(/Logging:/);
}

const button = (name: string) => screen.getByRole("button", { name });
const on = (name: string) => !button(name).className.includes("bg-slate-800");
const queryButton = (name: string) => screen.queryByRole("button", { name });

function expectFreshDropback() {
  for (const name of ["Shotgun", "Pass", "1st Option", "Clean Pocket", "On Platform", "Correct"]) {
    expect(on(name), name).toBe(true);
  }
  for (const name of ["Under Center", "RPO", "2nd Option +", "Sack", "Mid Pressure", "Off Platform", "On the Run", "Incorrect"]) {
    expect(on(name), name).toBe(false);
  }
}

describe("QB board defaults", () => {
  it("opens on Shotgun / Pass / 1st Option / Clean Pocket / On Platform / Touch Correct", async () => {
    await openBoard();
    expectFreshDropback();
    // No pressure, so no handling to pick; the throw box is already open.
    expect(screen.queryByText("Pressure Handling")).toBeNull();
    expect(screen.getByText("Target Position")).toBeTruthy();
  });

  it("Run clears the dropback; back to Pass starts on the defaults again", async () => {
    await openBoard();
    fireEvent.click(button("Off Platform"));
    fireEvent.click(button("Mid Pressure"));
    fireEvent.click(button("Run"));
    expect(queryButton("1st Option")).toBeNull();
    expect(queryButton("Clean Pocket")).toBeNull();
    fireEvent.click(button("Pass"));
    expectFreshDropback();
  });

  it("Pass ↔ RPO keeps the picks", async () => {
    await openBoard();
    fireEvent.click(button("2nd Option +"));
    fireEvent.click(button("Off Platform"));
    fireEvent.click(button("RPO"));
    expect(on("2nd Option +")).toBe(true);
    expect(on("Off Platform")).toBe(true);
    expect(on("Clean Pocket")).toBe(true);
  });

  it("a throw after a sack starts On Platform again; between throws the platform pick stays", async () => {
    await openBoard();
    fireEvent.click(button("Off Platform"));
    fireEvent.click(button("2nd Option +"));
    expect(on("Off Platform")).toBe(true);
    fireEvent.click(button("Sack"));
    expect(queryButton("On Platform")).toBeNull();
    expect(on("Clean Pocket")).toBe(true); // pressure carries across timings
    fireEvent.click(button("Check Down"));
    expect(on("On Platform")).toBe(true);
    expect(on("Off Platform")).toBe(false);
  });

  it("Log Play saves the picks and the next play starts on the defaults", async () => {
    await openBoard();
    fireEvent.click(button("2nd Option +"));
    fireEvent.click(button("Mid Pressure"));
    fireEvent.click(button("Step Up"));
    fireEvent.click(button("Off Platform"));
    fireEvent.click(button("Incorrect"));
    fireEvent.click(button("WR"));
    fireEvent.click(button("curl"));
    const shortRow = screen.getByText("U10 (Short)").closest("tr") as HTMLElement;
    fireEvent.click(within(shortRow).getByRole("button", { name: "Left" }));
    fireEvent.click(button("On Target"));
    fireEvent.click(button("Caught"));
    fireEvent.click(button("man"));
    const log = button("Log Play") as HTMLButtonElement;
    expect(log.disabled).toBe(false);
    fireEvent.click(log);
    await waitFor(() => expect(INSERTS).toHaveLength(1));
    expect(INSERTS[0]).toMatchObject({
      snap_position: "shotgun", play_type: "pass", timing: "second_option", pressure: "mid",
      pressure_handling: "step_up", platform: "off_platform", touch: "incorrect",
    });
    await waitFor(() => expect(on("1st Option")).toBe(true));
    expectFreshDropback();
    expect(screen.queryByText("Pressure Handling")).toBeNull();
  });
});
