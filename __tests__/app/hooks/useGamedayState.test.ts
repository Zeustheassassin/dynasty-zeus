// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGamedayState } from "@/app/hooks/useGamedayState";
import type { SleeperMatchup } from "@/lib/types";

const getLeagueMatchups = vi.fn();
vi.mock("@/lib/sleeperApi", () => ({
  sleeperApi: { getLeagueMatchups: (...args: unknown[]) => getLeagueMatchups(...args) },
}));

const mkMatchup = (points: number): SleeperMatchup => ({
  matchup_id: 1, roster_id: 1, points, custom_points: null,
  starters: [], players: [], starters_points: [], players_points: {},
});

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => getLeagueMatchups.mockReset());

describe("useGamedayState.loadGamedayMatchups", () => {
  it("loads matchups, passes bypass through, and stamps the update time", async () => {
    getLeagueMatchups.mockResolvedValue([mkMatchup(10)]);
    const { result } = renderHook(() => useGamedayState());

    await act(async () => { await result.current.loadGamedayMatchups("L1", 3, { bypass: true }); });

    expect(getLeagueMatchups).toHaveBeenCalledWith("L1", 3, true);
    expect(result.current.gamedayMatchups).toHaveLength(1);
    expect(result.current.gamedayMatchupsUpdatedAt).not.toBeNull();
    expect(result.current.loadingGamedayMatchups).toBe(false);
  });

  it("a normal load that fails clears the list (existing behavior)", async () => {
    getLeagueMatchups.mockResolvedValueOnce([mkMatchup(10)]);
    const { result } = renderHook(() => useGamedayState());
    await act(async () => { await result.current.loadGamedayMatchups("L1", 3); });

    getLeagueMatchups.mockRejectedValueOnce(new Error("502"));
    await act(async () => { await result.current.loadGamedayMatchups("L1", 3); });

    expect(result.current.gamedayMatchups).toEqual([]);
  });

  it("a silent poll that fails keeps the scores already on screen", async () => {
    getLeagueMatchups.mockResolvedValueOnce([mkMatchup(10)]);
    const { result } = renderHook(() => useGamedayState());
    await act(async () => { await result.current.loadGamedayMatchups("L1", 3); });
    const stamp = result.current.gamedayMatchupsUpdatedAt;

    getLeagueMatchups.mockRejectedValueOnce(new Error("429"));
    await act(async () => { await result.current.loadGamedayMatchups("L1", 3, { bypass: true, silent: true }); });

    expect(result.current.gamedayMatchups).toHaveLength(1);
    expect(result.current.gamedayMatchupsUpdatedAt).toBe(stamp);
  });

  it("a silent poll doesn't flash the loading state", async () => {
    getLeagueMatchups.mockResolvedValueOnce([mkMatchup(10)]);
    const { result } = renderHook(() => useGamedayState());
    await act(async () => { await result.current.loadGamedayMatchups("L1", 3); });

    const d = deferred<SleeperMatchup[]>();
    getLeagueMatchups.mockReturnValueOnce(d.promise);
    let pending!: Promise<void>;
    act(() => { pending = result.current.loadGamedayMatchups("L1", 3, { silent: true }); });
    expect(result.current.loadingGamedayMatchups).toBe(false);
    await act(async () => { d.resolve([mkMatchup(12)]); await pending; });
    expect(result.current.gamedayMatchups[0].points).toBe(12);
  });

  it("drops a slow poll for a league the user has since switched away from", async () => {
    getLeagueMatchups.mockResolvedValueOnce([mkMatchup(10)]);
    const { result } = renderHook(() => useGamedayState());
    await act(async () => { await result.current.loadGamedayMatchups("L1", 3); });

    // A poll for L1 goes out…
    const slowPoll = deferred<SleeperMatchup[]>();
    getLeagueMatchups.mockReturnValueOnce(slowPoll.promise);
    let pollPromise!: Promise<void>;
    act(() => { pollPromise = result.current.loadGamedayMatchups("L1", 3, { bypass: true, silent: true }); });

    // …the user switches to L2, which loads first…
    getLeagueMatchups.mockResolvedValueOnce([mkMatchup(77)]);
    await act(async () => { await result.current.loadGamedayMatchups("L2", 3); });
    expect(result.current.gamedayMatchups[0].points).toBe(77);

    // …then L1's stale poll finally lands. It must not overwrite L2.
    await act(async () => { slowPoll.resolve([mkMatchup(999)]); await pollPromise; });
    expect(result.current.gamedayMatchups[0].points).toBe(77);
  });

  it("ignores calls with no league or week", async () => {
    const { result } = renderHook(() => useGamedayState());
    await act(async () => {
      await result.current.loadGamedayMatchups("", 3);
      await result.current.loadGamedayMatchups("L1", 0);
    });
    expect(getLeagueMatchups).not.toHaveBeenCalled();
  });
});
