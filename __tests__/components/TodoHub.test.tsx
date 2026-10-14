// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import TodoHub from "@/components/TodoHub";
import type { ActionItem, DoneRecord } from "@/lib/helpers/actionQueue";
import type { SleeperLeague, SleeperPlayer, SleeperUser } from "@/lib/types";

// This project doesn't set `test.globals: true`, so testing-library's auto-cleanup never registers.
afterEach(cleanup);

const HOUR = 3_600_000;
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
