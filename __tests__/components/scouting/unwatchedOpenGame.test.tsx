// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Prospect } from "@/lib/types";

// 2026-11-17, the user (Unwatched tab): "if i click on the game it jumps me to
// that player and to that game on the charting board." The whole path through
// the real ScoutingHub, Unwatched tab and position hubs; only the database and
// the boards' contents are stubbed (the stub boards run the real useChartingState).

const { TABLES } = vi.hoisted(() => ({ TABLES: {} as Record<string, Record<string, unknown>[]> }));

vi.mock("@/lib/supabaseclient", () => {
  function query(table: string) {
    const filters: [string, unknown][] = [];
    const rows = () => (TABLES[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const q: Record<string, unknown> = {};
    for (const m of ["select", "in", "order", "range", "limit", "is", "not", "gte", "lte", "neq", "or", "update", "insert", "upsert", "delete"]) {
      q[m] = () => q;
    }
    q.eq = (k: string, v: unknown) => { filters.push([k, v]); return q; };
    q.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
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

// next/dynamic as plain React.lazy, so the hub's lazy tabs load in jsdom.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> } | React.ComponentType<Record<string, unknown>>>) => {
    const Lazy = React.lazy(async () => {
      const m = await loader();
      return { default: "default" in m ? m.default : m };
    });
    return function Dynamic(props: Record<string, unknown>) {
      return React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
    };
  },
}));

// The boards, reduced to where they opened: the real useChartingState, fed the
// props the real boards pass it.
vi.mock("@/components/scouting/qb/QBChartingBoard", async () => {
  const { useChartingState } = await import("@/components/scouting/shared/hooks/useChartingState");
  return {
    default: function QBBoard({ prospect, initialGameId, onDataChanged }: { prospect: Prospect; initialGameId?: string | null; onDataChanged: () => void }) {
      const cs = useChartingState(prospect, { onDataChanged, initialGameId });
      return <div data-testid="board">{`${prospect.name} | ${cs.tab} | ${cs.selectedGame?.opponent ?? "-"}`}</div>;
    },
  };
});
vi.mock("@/components/scouting/wr/PlayerChartingBoard", async () => {
  const { useChartingState } = await import("@/components/scouting/shared/hooks/useChartingState");
  return {
    default: function WRBoard({ prospect, initialGameId, onDataChanged }: { prospect: Prospect; initialGameId?: string | null; onDataChanged: () => void }) {
      const cs = useChartingState(prospect, { onDataChanged, initialGameId });
      return <div data-testid="board">{`${prospect.name} | ${cs.tab} | ${cs.selectedGame?.opponent ?? "-"}`}</div>;
    },
  };
});

const prospect = (id: string, name: string, position: string, school: string, rank: number) => ({
  id, user_id: "u", name, position, school, draft_class_year: 2027, personal_rank: rank,
  conference: "", charting_decision: null, created_at: "2026-01-01", updated_at: "2026-01-01",
});
const game = (id: string, prospect_id: string, opponent: string, game_slot: number) => ({
  id, user_id: "u", prospect_id, season_year: 2026, opponent, game_slot, game_type: "regular",
  created_at: "2026-11-16T12:00:00Z", watch_date: null, notes: "",
});

function seed() {
  TABLES.prospects = [
    prospect("qb1", "Drew Mestemaker", "QB", "Oklahoma State", 1),
    prospect("qb2", "Arch Manning", "QB", "Texas", 2),
    prospect("wr1", "Justin Bowick", "WR", "Western Kentucky", 3),
  ];
  TABLES.scouting_games = [
    game("dm1", "qb1", "Tulsa", 1), game("dm2", "qb1", "Colorado", 2), game("dm3", "qb1", "Houston", 3),
    game("am1", "qb2", "Texas State", 1), game("am2", "qb2", "Oklahoma", 2),
    game("jb1", "wr1", "Colorado", 1), game("jb2", "wr1", "Oregon", 2),
  ];
  TABLES.prospect_game_snap_stats = TABLES.scouting_games.map((g) => ({
    game_id: g.id, prospect_id: g.prospect_id, snaps_charted: g.id === "dm1" ? 50 : 0,
  }));
}

afterEach(() => { cleanup(); for (const k of Object.keys(TABLES)) delete TABLES[k]; });

async function openUnwatched() {
  seed();
  const { default: ScoutingHub } = await import("@/components/ScoutingHub");
  render(<ScoutingHub />);
  fireEvent.click(await screen.findByRole("button", { name: /^Unwatched/ }));
  await screen.findByText("6 games across 3 prospects", {}, { timeout: 5000 });
}

// Each renders the whole hub with its lazy tabs: more than vitest's 5 s default under a full run.
describe("Unwatched → his board on that game", () => {
  it("opens the QB's board on Chart Game with the clicked game picked", async () => {
    await openUnwatched();
    const card = screen.getByText("Drew Mestemaker").closest("li")!;
    fireEvent.click(within(card).getByText("Houston"));
    await waitFor(() => expect(screen.getByTestId("board").textContent).toBe("Drew Mestemaker | chart | Houston"), { timeout: 5000 });
  }, 20_000);

  it("opens the right player when two have unwatched games, and works for a WR", async () => {
    await openUnwatched();
    const card = screen.getByText("Justin Bowick").closest("li")!;
    fireEvent.click(within(card).getByText("Oregon"));
    await waitFor(() => expect(screen.getByTestId("board").textContent).toBe("Justin Bowick | chart | Oregon"), { timeout: 5000 });
  }, 20_000);
});
