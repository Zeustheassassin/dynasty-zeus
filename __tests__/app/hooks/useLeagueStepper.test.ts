// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useLeagueStepper, type UseLeagueStepperArgs } from "@/app/hooks/useLeagueStepper";
import type { ActionItem } from "@/lib/helpers/actionQueue";
import type { SleeperLeague } from "@/lib/types";

// To-Do Stage 3 (10/14): a run through the leagues needing attention is the To-Do list's By league
// order, fixed when it starts; League Hub steps walk it, steps from elsewhere start a new one.

afterEach(cleanup);

const NOW = Date.now();
const HOUR = 3_600_000;
const LEAGUES = ["A", "B", "C", "D"].map((id) => ({ league_id: id, name: `League ${id}` })) as SleeperLeague[];

function item(key: string, leagueId: string, over: Partial<ActionItem> = {}): ActionItem {
  return {
    key, kind: "irEligible", leagueId, leagueName: leagueId, playerIds: [], title: key, detail: "",
    deadline: null, deadlineLabel: null, expiresAt: null, earlyLockDay: null, appTab: "ROSTERS", asOf: NOW, ...over,
  };
}
const lineup = (key: string, leagueId: string, hours: number) =>
  item(key, leagueId, {
    kind: "lineup", deadline: NOW + hours * HOUR, deadlineLabel: "Locks", expiresAt: NOW + hours * HOUR, appTab: "STARTERS",
  });

// By league: B (locks in 1h), A (2h), then untimed C. D has nothing to do.
const ITEMS = [lineup("lineup:A", "A", 2), lineup("lineup:B", "B", 1), item("ir:C", "C")];

function setup(over: Partial<UseLeagueStepperArgs> = {}) {
  const open = vi.fn();
  const initial: UseLeagueStepperArgs = {
    userId: "me", items: ITEMS, done: {}, leagues: LEAGUES, selectedLeagueId: null,
    inLeagueHub: false, lineupPending: false, open, ...over,
  };
  const hook = renderHook((props: UseLeagueStepperArgs) => useLeagueStepper(props), { initialProps: initial });
  return { ...hook, open, props: initial };
}

describe("useLeagueStepper", () => {
  it("To-Do's Open in app starts a run at that league, in By league order", () => {
    const { result, open } = setup();
    act(() => result.current.openFromTodo("A", "STARTERS"));
    expect(open).toHaveBeenCalledWith("A", "STARTERS");
    expect(result.current.session).toEqual({
      userId: "me",
      stops: [{ leagueId: "B", appTab: "STARTERS" }, { leagueId: "A", appTab: "STARTERS" }, { leagueId: "C", appTab: "ROSTERS" }],
      cursor: 1,
    });
  });

  it("League Hub steps walk the run and land on each league's tab; nothing past the end", () => {
    const { result, rerender, open, props } = setup({ inLeagueHub: true, selectedLeagueId: "A" });
    act(() => result.current.openFromTodo("A", "STARTERS"));
    act(() => { expect(result.current.step(1)).toBe(true); });
    expect(open).toHaveBeenLastCalledWith("C", "ROSTERS");
    rerender({ ...props, inLeagueHub: true, selectedLeagueId: "C" });
    act(() => { expect(result.current.step(1)).toBe(false); });
    expect(open).toHaveBeenCalledTimes(2);
    act(() => { expect(result.current.step(-1)).toBe(true); });
    expect(open).toHaveBeenLastCalledWith("A", "STARTERS");
  });

  it("the run doesn't change when the live list does (projections reloading, a poll landing)", () => {
    const { result, rerender, open, props } = setup({ inLeagueHub: true, selectedLeagueId: "B" });
    act(() => result.current.openFromTodo("B", "STARTERS"));
    // Lineup moves vanish mid-run (another league's scoring cleared the projections).
    rerender({ ...props, inLeagueHub: true, selectedLeagueId: "B", items: [item("ir:C", "C")] });
    expect(result.current.peek(1)).toEqual({ stop: { leagueId: "A", appTab: "STARTERS" }, index: 1, total: 3 });
    act(() => { result.current.step(1); });
    expect(open).toHaveBeenLastCalledWith("A", "STARTERS");
  });

  it("off the list, Next resumes after the last league landed on", () => {
    const { result, rerender, open, props } = setup({ inLeagueHub: true, selectedLeagueId: "B" });
    act(() => result.current.openFromTodo("B", "STARTERS"));
    rerender({ ...props, inLeagueHub: true, selectedLeagueId: "D" }); // picked from the header
    expect(result.current.peek(-1)?.stop.leagueId).toBe("B");
    act(() => { result.current.step(1); });
    expect(open).toHaveBeenLastCalledWith("A", "STARTERS");
  });

  it("outside the League Hub, a step starts a new run from the live list: Next at the top, Prev at the end", () => {
    const { result, open } = setup({ selectedLeagueId: "A" });
    expect(result.current.peek(1)).toEqual({ stop: { leagueId: "B", appTab: "STARTERS" }, index: 0, total: 3 });
    expect(result.current.peek(-1)?.stop.leagueId).toBe("C");
    expect(result.current.session).toBeNull(); // peek doesn't start one
    act(() => { result.current.step(1); });
    expect(open).toHaveBeenCalledWith("B", "STARTERS");
    expect(result.current.session?.cursor).toBe(0);
  });

  it("leaves out leagues whose moves are all marked done or past their lock", () => {
    const { result } = setup({ done: { "lineup:B": { at: NOW + 1 } } });
    expect(result.current.peek(1)?.stop.leagueId).toBe("A");
    const expired = setup({ items: [lineup("lineup:A", "A", -1), item("ir:C", "C")] });
    expect(expired.result.current.peek(1)).toEqual({ stop: { leagueId: "C", appTab: "ROSTERS" }, index: 0, total: 1 });
  });

  it("a run started while the lineup status reloads keeps the last lineup moves", () => {
    const { result, rerender, props } = setup();
    rerender({ ...props, lineupPending: true, items: [item("ir:C", "C"), item("ir:D", "D")] });
    act(() => result.current.openFromTodo("C", "ROSTERS"));
    expect(result.current.session?.stops.map((s) => s.leagueId)).toEqual(["B", "A", "C", "D"]);
  });

  it("does nothing with nothing to do, and a Waiver Watch league opens off the list", () => {
    const empty = setup({ items: [] });
    act(() => { expect(empty.result.current.step(1)).toBe(false); });
    act(() => empty.result.current.openFromTodo("D", "ROSTERS"));
    expect(empty.open).toHaveBeenCalledWith("D", "ROSTERS");
    expect(empty.result.current.session).toBeNull();

    const { result, open } = setup();
    act(() => result.current.openFromTodo("D", "ROSTERS"));
    expect(open).toHaveBeenCalledWith("D", "ROSTERS");
    expect(result.current.session?.cursor).toBe(-1);
  });

  it("closes, and ignores a run from another Sleeper account", () => {
    const { result, rerender, props } = setup();
    act(() => result.current.openFromTodo("A", "STARTERS"));
    rerender({ ...props, userId: "someone-else" });
    expect(result.current.session).toBeNull();
    rerender(props);
    expect(result.current.session).not.toBeNull();
    act(() => result.current.end());
    expect(result.current.session).toBeNull();
  });
});
