// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import ChartNextTab from "@/components/scouting/ChartNextTab";
import type { PaceCounts } from "@/lib/scouting/chartNext";
import type { ProspectWithStats, ScoutingGame } from "@/lib/types";

// 2026-11-26: Scouting → Chart Next, stage 1 of the scouting plan. Slow-tape
// conferences (Big Ten, Big 12, Independents, FCS) are hidden by default.

vi.mock("@/components/scouting/chartNextPace", () => ({ fetchChartingPace: vi.fn(async () => null) }));

const prospect = (id: string, extra: Partial<ProspectWithStats> = {}) =>
  ({
    id, name: id, position: "WR", school: "Georgia", conference: "SEC", draft_class_year: 2027,
    overall_rank: null, personal_rank: null, eligible_thru_year: null, total_routes: 0, sae_sample: null, ...extra,
  }) as unknown as ProspectWithStats;
const game = (id: string, prospect_id: string, extra: Partial<ScoutingGame> = {}) =>
  ({ id, prospect_id, season_year: 2026, game_slot: 1, opponent: `Opp ${id}`, game_type: "regular", created_at: "2026-11-01T12:00:00Z", ...extra }) as ScoutingGame;
const wrSample = (n: number) => ({ ae: 0, n, variance: 0 });

const prospects = [
  prospect("Good WR", { overall_rank: 1, sae_sample: wrSample(100) }),
  prospect("Slow RB", { overall_rank: 2, position: "RB", school: "Ohio State", conference: "BIG 10" }),
  prospect("Done WR", { overall_rank: 3, sae_sample: wrSample(170) }),
  prospect("Half TE", { overall_rank: 70, position: "TE" }),
  prospect("Fresh QB", { position: "QB" }),
];
const games = [
  game("gw1", "Good WR", { season_year: 2025 }), game("gw2", "Good WR"), game("gw3", "Good WR", { season_year: 2025, game_slot: 2 }),
  game("fq1", "Fresh QB"),
];
const snapCounts = [
  { game_id: "gw1", snaps_charted: 50 }, { game_id: "gw2", snaps_charted: 0 }, { game_id: "gw3", snaps_charted: 0 },
  { game_id: "fq1", snaps_charted: 0 },
];

afterEach(() => cleanup());

function renderTab(extra: Partial<Parameters<typeof ChartNextTab>[0]> = {}) {
  const onOpenProspect = vi.fn();
  const onOpenGame = vi.fn();
  const setDraftYearFilter = vi.fn();
  const loadPace = extra.loadPace ?? (async (): Promise<PaceCounts | null> => ({ QB: 0, RB: 0, WR: 280, TE: 0 }));
  render(
    <ChartNextTab
      prospects={prospects} games={games} snapCounts={snapCounts} samplePlays={new Map([["Slow RB", { RB: 40 }]])}
      pffTotals={new Map()} routeCounts={[]} years={[2027, 2028]} loading={false}
      draftYearFilter={2027} setDraftYearFilter={setDraftYearFilter}
      onOpenProspect={onOpenProspect} onOpenGame={onOpenGame} {...extra} loadPace={loadPace}
    />,
  );
  return { onOpenProspect, onOpenGame, setDraftYearFilter };
}

const section = (name: string) => screen.getByRole("region", { name });

describe("ChartNextTab", () => {
  it("shows the goal: done, plays to go (with the slow-tape part) and weeks at the pace", async () => {
    renderTab();
    expect(screen.getByRole("progressbar", { name: "Top 60 at a full sample" }).getAttribute("aria-valuenow")).toBe("1");
    // Good WR 60 to go + Slow RB 60 = 120; Slow RB's 60 is slow tape.
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("60 slow tape")).toBeTruthy();
    // 280 routes over 4 weeks = 70 a week. Top 60: 120 → 1.7 weeks; with Half
    // TE's 70, 190 → 2.7; without the slow 60, 130 → 1.9.
    const pace = await screen.findByText(/sample plays a week/);
    expect(pace.textContent).toMatch(/^Pace 70 sample plays a week \(last 4 weeks, every class\) · top 60: ~1\.7 wk · both goals: ~2\.7 wk · both without slow tape: ~1\.9 wk/);
  });

  it("hides slow-tape conferences until the Conference filter shows them", () => {
    renderTab();
    const top = section("Finish the top 60");
    expect(within(top).getByText("Good WR")).toBeTruthy();
    expect(within(top).queryByText("Slow RB")).toBeNull();
    expect(within(top).getByText(/1 hidden by the filters/)).toBeTruthy();
    expect(within(top).queryByText("Done WR")).toBeNull();

    fireEvent.change(screen.getByLabelText(/Conference/), { target: { value: "__all" } });
    expect(within(section("Finish the top 60")).getByText("Slow RB")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Conference/), { target: { value: "__slow" } });
    expect(within(section("Finish the top 60")).queryByText("Good WR")).toBeNull();
  });

  it("filters by position", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "TE" }));
    expect(within(section("Finish the top 60")).queryByText("Good WR")).toBeNull();
    expect(within(section("61–150 to half")).getByText("Half TE")).toBeTruthy();
  });

  it("a name opens his board; tape in hand opens his newest unwatched game on Chart Game", () => {
    const { onOpenProspect, onOpenGame } = renderTab();
    const top = section("Finish the top 60");
    fireEvent.click(within(top).getByRole("button", { name: "Good WR" }));
    expect(onOpenProspect).toHaveBeenCalledWith(expect.objectContaining({ id: "Good WR" }));
    fireEvent.click(within(top).getByRole("button", { name: /2 games/ }));
    expect(onOpenGame).toHaveBeenCalledWith(expect.objectContaining({ id: "Good WR" }), "gw2");
  });

  it("lists first looks with their tape in hand", () => {
    renderTab();
    const first = section("First looks");
    expect(within(first).getByText("Fresh QB")).toBeTruthy();
    expect(within(first).getByRole("button", { name: /1 game/ })).toBeTruthy();
  });

  it("class chips set the shared class filter", () => {
    const { setDraftYearFilter } = renderTab();
    fireEvent.click(screen.getByRole("button", { name: "2028" }));
    expect(setDraftYearFilter).toHaveBeenCalledWith(2028);
  });

  it("says so when the pace or the play counts didn't load", async () => {
    renderTab({ loadPace: async () => null, snapCounts: null });
    expect(await screen.findByText(/couldn't load the recent plays/)).toBeTruthy();
    expect(screen.getByText(/tape in hand and first looks are unknown/)).toBeTruthy();
  });
});
