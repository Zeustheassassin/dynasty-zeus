// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import TodoHub from "@/components/TodoHub";
import type { ActionItem, DoneRecord } from "@/lib/helpers/actionQueue";
import type { LeagueOverviewEntry, SleeperLeague, SleeperPlayer, SleeperRoster, SleeperUser } from "@/lib/types";
import type { WeeklyValueRisers } from "@/hooks/useWeeklyValueRisers";

// Waiver Watch's Supabase read, stubbed per test.
const risers = vi.hoisted(() => ({
  state: { data: null, error: null, loading: false, retry: () => {} } as {
    data: WeeklyValueRisers | null; error: string | null; loading: boolean; retry: () => void;
  },
}));
vi.mock("@/hooks/useWeeklyValueRisers", () => ({ useWeeklyValueRisers: () => risers.state }));

// This project doesn't set `test.globals: true`, so testing-library's auto-cleanup never registers.
afterEach(cleanup);

const HOUR = 3_600_000;
// By league puts a league first only when its deadline falls before Sunday's slate (Wed–Sun
// morning ET), so the moves below are timed from a fixed Thursday noon ET — on a Monday or
// Tuesday a real clock put Alpha first and failed the ordering test.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-10-15T16:00:00Z"));
afterAll(() => { vi.useRealTimers(); });
const NOW = Date.now();

const LEAGUES = [
  { league_id: "A", name: "Alpha" },
  { league_id: "B", name: "Bravo" },
] as SleeperLeague[];

const PLAYERS = {
  p1: { player_id: "p1", full_name: "Ace Runner", position: "RB", team: "KC", injury_status: null },
  p2: { player_id: "p2", full_name: "Bo Catcher", position: "WR", team: "SF", injury_status: "Out" },
} as unknown as Record<string, SleeperPlayer>;

function item(over: Partial<ActionItem> & Pick<ActionItem, "key" | "leagueId">): ActionItem {
  return {
    kind: "irEligible", leagueName: over.leagueId === "A" ? "Alpha" : "Bravo", playerIds: [],
    title: over.key, detail: "detail", deadline: null, deadlineLabel: null, expiresAt: null,
    earlyLockDay: null, appTab: "ROSTERS", asOf: NOW, ...over,
  };
}

// Bravo's lineup move locks first, so Bravo leads By league; Alpha only has an untimed IR move.
const SWAP = item({
  key: "lineup:B:p1:p2", leagueId: "B", kind: "lineup", playerIds: ["p1", "p2"], title: "Start Ace Runner over Bo Catcher",
  deadline: NOW + 2 * HOUR, deadlineLabel: "Locks", expiresAt: NOW + 2 * HOUR, earlyLockDay: "Thu", appTab: "STARTERS",
});
const IR_MOVE = item({ key: "irEligible:A:p2", leagueId: "A", playerIds: ["p2"], title: "Move Bo Catcher to IR" });

function renderHub(props: Partial<React.ComponentProps<typeof TodoHub>> = {}) {
  const handlers = { onMarkDone: vi.fn(), onUndoDone: vi.fn(), setView: vi.fn(), onRefresh: vi.fn(), onOpenInApp: vi.fn() };
  render(
    <TodoHub
      user={{ user_id: "me" } as SleeperUser}
      leagues={LEAGUES}
      players={PLAYERS}
      leagueOverviewData={{}}
      committedSimsByLeague={{}}
      leagueSimCache={{}}
      items={[SWAP, IR_MOVE]}
      done={{}}
      view="BY_LEAGUE"
      focusPlayerId={null}
      isInSeason
      lineupReady
      overviewLoaded
      loadingOverview={false}
      updatedAt={NOW}
      refreshing={false}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe("TodoHub — By league", () => {
  it("orders leagues by earliest deadline and counts the moves", () => {
    renderHub();
    const names = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(["Bravo", "Alpha"]);
    expect(screen.getByText("2 moves in 2 leagues. Make each one in Sleeper, then mark it done.")).toBeTruthy();
  });

  it("links each league to Sleeper and into the app's matching tab", () => {
    const { onOpenInApp } = renderHub();
    const bravo = within(screen.getByRole("region", { name: "Bravo" }));
    expect(bravo.getByRole("link", { name: /Open in Sleeper/ }).getAttribute("href")).toBe("https://sleeper.com/leagues/B");
    fireEvent.click(bravo.getByRole("button", { name: "Open in app" }));
    expect(onOpenInApp).toHaveBeenCalledWith("B", "STARTERS");
    fireEvent.click(within(screen.getByRole("region", { name: "Alpha" })).getByRole("button", { name: "Open in app" }));
    expect(onOpenInApp).toHaveBeenLastCalledWith("A", "ROSTERS");
  });

  it("shows the T badge and the lock time on an early-locking lineup move", () => {
    renderHub();
    expect(screen.getByRole("img", { name: /Thursday game/ }).textContent).toBe("T");
    expect(screen.getByText(/^Locks /)).toBeTruthy();
  });

  it("marks a move done", () => {
    const { onMarkDone } = renderHub();
    fireEvent.click(screen.getByRole("button", { name: "Done: Move Bo Catcher to IR" }));
    expect(onMarkDone).toHaveBeenCalledWith([{ key: "irEligible:A:p2", final: false }]);
  });
});

describe("TodoHub — Done marks", () => {
  it("hides a done move and lists it under Marked done with Undo", () => {
    const done: Record<string, DoneRecord> = { "irEligible:A:p2": { at: NOW + 1 } };
    const { onUndoDone } = renderHub({ done });
    expect(screen.queryByRole("region", { name: "Alpha" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Marked done this week \(1\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndoDone).toHaveBeenCalledWith("irEligible:A:p2");
  });

  it("brings a done move back, flagged, when data from after the click still has it — Done again is final", () => {
    const done: Record<string, DoneRecord> = { "irEligible:A:p2": { at: NOW - 1 } };
    const { onMarkDone } = renderHub({ done });
    expect(screen.getByText(/Still showing in Sleeper/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done: Move Bo Catcher to IR" }));
    expect(onMarkDone).toHaveBeenCalledWith([{ key: "irEligible:A:p2", final: true }]);
  });

  it("drops a lineup move once its game has kicked off", () => {
    renderHub({ items: [{ ...SWAP, deadline: NOW - HOUR, expiresAt: NOW - HOUR }, IR_MOVE] });
    expect(screen.queryByRole("region", { name: "Bravo" })).toBeNull();
    expect(screen.getByRole("region", { name: "Alpha" })).toBeTruthy();
  });
});

describe("TodoHub — By player", () => {
  it("groups by player, a swap under both, with each move's league", () => {
    renderHub({ view: "BY_PLAYER" });
    const bo = within(screen.getByRole("region", { name: "Bo Catcher" }));
    expect(bo.getByText("Out")).toBeTruthy();
    expect(bo.getByText("Alpha")).toBeTruthy();
    expect(bo.getByText("Bravo")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Ace Runner" })).getByText("Start Ace Runner over Bo Catcher")).toBeTruthy();
  });

  it("scrolls to and outlines the player the Injury Report asked for", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderHub({ view: "BY_PLAYER", focusPlayerId: "p2" });
    const card = screen.getByRole("region", { name: "Bo Catcher" });
    expect(card.id).toBe("todo-player-p2");
    expect(card.className).toContain("border-blue-500");
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("switches views from the tabs", () => {
    const { setView } = renderHub();
    fireEvent.click(screen.getByRole("tab", { name: "By player" }));
    expect(setView).toHaveBeenCalledWith("BY_PLAYER");
  });
});

describe("TodoHub — states", () => {
  it("says it's the offseason when lineup moves can't exist", () => {
    renderHub({ isInSeason: false, items: [IR_MOVE] });
    expect(screen.getByText(/Offseason — roster and IR moves only/)).toBeTruthy();
  });

  it("says lineup moves are still loading", () => {
    renderHub({ lineupReady: false });
    expect(screen.getByText(/lineup moves will appear shortly/)).toBeTruthy();
  });

  it("shows an all-clear when nothing is left", () => {
    renderHub({ items: [] });
    expect(screen.getByText("Lineups and rosters look set in every league.")).toBeTruthy();
  });

  it("refreshes", () => {
    const { onRefresh } = renderHub();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();
  });
});

describe("TodoHub — Waiver Watch", () => {
  const WW_PLAYERS = {
    ...PLAYERS,
    low: { player_id: "low", full_name: "Low Guy", position: "RB", team: "NYJ", value: 800 },
    mid: { player_id: "mid", full_name: "Mid Guy", position: "WR", team: "NYG", value: 2500 },
    irGuy: { player_id: "irGuy", full_name: "Ir Guy", position: "TE", team: "LV", injury_status: "IR", value: 300 },
    hot: { player_id: "hot", full_name: "Hot Pickup", position: "WR", team: "DET", value: 2200 },
    warm: { player_id: "warm", full_name: "Warm Pickup", position: "TE", team: "ARI", value: 600 },
  } as unknown as Record<string, SleeperPlayer>;
  const lg = (id: string, name: string, reserveSlots: number) =>
    ({ league_id: id, name, roster_positions: ["WR", "BN"], settings: { reserve_slots: reserveSlots } } as unknown as SleeperLeague);
  const rosterOf = (owner: string, players: string[], reserve: string[] = []) =>
    ({ owner_id: owner, players, reserve, taxi: [] } as unknown as SleeperRoster);
  const ALPHA = lg("A", "Alpha", 1);
  const BRAVO = lg("B", "Bravo", 0);
  const OVERVIEW: Record<string, LeagueOverviewEntry> = {
    // Alpha: lowest is Low Guy (800); Ir Guy sits in the one IR slot with no overflow, so he's off.
    A: { league: ALPHA, rosters: [rosterOf("me", ["low", "mid", "irGuy"], ["irGuy"])], picks: [], userMap: {} },
    // Bravo: Hot Pickup is rostered by someone else; lowest is Mid Guy (2500), nothing beats it.
    B: { league: BRAVO, rosters: [rosterOf("me", ["mid"]), rosterOf("other", ["hot"])], picks: [], userMap: {} },
  };
  const DATA: WeeklyValueRisers = {
    latestDate: "2026-10-14",
    baseDate: "2026-10-07",
    risers: [
      { playerId: "hot", from: 1500, to: 2200, gain: 700 },
      { playerId: "warm", from: 200, to: 600, gain: 400 },
    ],
  };

  function renderWatch(state: Partial<typeof risers.state> = {}, props: Partial<React.ComponentProps<typeof TodoHub>> = {}) {
    risers.state = { data: DATA, error: null, loading: false, retry: vi.fn(), ...state };
    return renderHub({
      view: "WAIVER_WATCH",
      leagues: [BRAVO, ALPHA],
      players: WW_PLAYERS,
      leagueOverviewData: OVERVIEW,
      done: { "irEligible:A:p2": { at: NOW + 1 } },
      ...props,
    });
  }

  it("is the third tab", () => {
    const { setView } = renderHub();
    fireEvent.click(screen.getByRole("tab", { name: "Waiver Watch" }));
    expect(setView).toHaveBeenCalledWith("WAIVER_WATCH");
  });

  it("lists leagues in the user's Sleeper order, highlighting one whose rising free agent beats the lowest player", () => {
    renderWatch();
    // Sleeper order is the list order here (Bravo, then Alpha); the upgrade doesn't move Alpha up.
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Bravo", "Alpha"]);
    expect(screen.getByText("1 league has a rising free agent worth more than your lowest player.")).toBeTruthy();
    const alpha = within(screen.getByRole("region", { name: "Alpha" }));
    expect(alpha.getByText("Upgrade +1,400")).toBeTruthy();
    expect(alpha.getByText("Worth more than Low Guy")).toBeTruthy();
    expect(alpha.getByText("+700")).toBeTruthy();
    expect(alpha.queryByText("Ir Guy")).toBeNull();
    const bravo = within(screen.getByRole("region", { name: "Bravo" }));
    expect(bravo.queryByText("Hot Pickup")).toBeNull();
    expect(bravo.getByText("Warm Pickup")).toBeTruthy();
    expect(bravo.queryByText(/Worth more than/)).toBeNull();
  });

  it("links each league to Sleeper and its roster in the app", () => {
    const { onOpenInApp } = renderWatch();
    const alpha = within(screen.getByRole("region", { name: "Alpha" }));
    expect(alpha.getByRole("link", { name: /Open in Sleeper/ }).getAttribute("href")).toBe("https://sleeper.com/leagues/A");
    fireEvent.click(alpha.getByRole("button", { name: "Open in app" }));
    expect(onOpenInApp).toHaveBeenCalledWith("A", "ROSTERS");
  });

  it("leaves out the move list's Done section and season notes", () => {
    renderWatch({}, { isInSeason: false });
    expect(screen.queryByText(/Marked done this week/)).toBeNull();
    expect(screen.queryByText(/Offseason/)).toBeNull();
    cleanup();
    renderWatch({}, { lineupReady: false });
    expect(screen.queryByText(/lineup moves will appear/)).toBeNull();
  });

  it("still shows your lowest players while the risers fail to load, with Retry", () => {
    const retry = vi.fn();
    renderWatch({ data: null, error: "boom", retry });
    expect(within(screen.getByRole("region", { name: "Alpha" })).getByText("Low Guy")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("says when there isn't a week of value history yet", () => {
    renderWatch({ data: null });
    expect(screen.getByText(/need a week of value history/)).toBeTruthy();
  });
});

describe("TodoHub — playoff odds on every league (10/14)", () => {
  const entry = (leagueId: string) => ({
    league: { league_id: leagueId }, rosters: [{ roster_id: 4, owner_id: "me", players: [] }], picks: [], userMap: {},
  }) as unknown as LeagueOverviewEntry;
  const sim = (playoff_odds: number) => ({
    4: { league_id: "x", roster_id: 4, playoff_odds, title_odds: 0, expected_wins: 0, avg_finish: 0, finish_range: null, computed_at: null },
  });
  const props = {
    leagueOverviewData: { A: entry("A"), B: entry("B") },
    leagueSimCache: { B: sim(62) },
    committedSimsByLeague: { A: { 4: { rosterId: 4, wins: 0, losses: 0, ties: 0, pointsFor: 0, playoffOdds: 8 } } },
  };

  it("By league: each card's odds, colored like League Overview", () => {
    renderHub(props);
    const bravo = within(screen.getByRole("region", { name: "Bravo" }));
    const alpha = within(screen.getByRole("region", { name: "Alpha" }));
    expect(bravo.getByText("62% playoff").className).toContain("emerald");
    expect(alpha.getByText("8% playoff").className).toContain("red");
  });

  it("says No sim for a league that has never been simulated", () => {
    renderHub({ ...props, leagueSimCache: {}, committedSimsByLeague: {} });
    expect(within(screen.getByRole("region", { name: "Bravo" })).getByText("No sim")).toBeTruthy();
  });

  it("By player: beside each move's league", () => {
    renderHub({ ...props, view: "BY_PLAYER" });
    const ace = within(screen.getByRole("region", { name: "Ace Runner" }));
    expect(ace.getByText("Bravo")).toBeTruthy();
    expect(ace.getByText("62% playoff")).toBeTruthy();
  });

  it("Waiver Watch: on each league card", () => {
    risers.state = { data: null, error: null, loading: false, retry: vi.fn() };
    renderHub({ ...props, view: "WAIVER_WATCH" });
    expect(within(screen.getByRole("region", { name: "Alpha" })).getByText("8% playoff")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Bravo" })).getByText("62% playoff")).toBeTruthy();
  });
});
