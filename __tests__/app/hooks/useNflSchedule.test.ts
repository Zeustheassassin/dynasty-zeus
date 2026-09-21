// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNflSchedule } from "@/app/hooks/useNflSchedule";
import type { TeamGameState } from "@/lib/types";

const getNflScoreboard = vi.fn();
vi.mock("@/lib/scheduleApi", () => ({
  scheduleApi: { getNflScoreboard: (...args: unknown[]) => getNflScoreboard(...args) },
}));

const sf = (state: TeamGameState["state"]): Record<string, TeamGameState> => ({ SF: { kickoffAt: 1, state } });

beforeEach(() => getNflScoreboard.mockReset());

describe("useNflSchedule", () => {
  it("loads the scoreboard and stamps when it was updated", async () => {
    getNflScoreboard.mockResolvedValue(sf("Live"));
    const { result } = renderHook(() => useNflSchedule());
    expect(result.current.scheduleUpdatedAt).toBeNull();

    await act(async () => { await result.current.loadSchedule(3); });

    expect(result.current.scheduleByTeam).toEqual(sf("Live"));
    expect(result.current.scheduleUpdatedAt).not.toBeNull();
  });

  it("ignores week 0 (offseason)", async () => {
    const { result } = renderHook(() => useNflSchedule());
    await act(async () => { await result.current.loadSchedule(0); });
    expect(getNflScoreboard).not.toHaveBeenCalled();
  });

  it("passes bypass through, and a bypass poll does not flip the loading flag", async () => {
    getNflScoreboard.mockResolvedValue(sf("Live"));
    const { result } = renderHook(() => useNflSchedule());
    let sawLoading = false;
    getNflScoreboard.mockImplementation(async () => {
      sawLoading = result.current.loadingSchedule;
      return sf("Live");
    });

    await act(async () => { await result.current.loadSchedule(3, { bypass: true }); });

    expect(getNflScoreboard).toHaveBeenCalledWith(3, true);
    expect(sawLoading).toBe(false);
    expect(result.current.loadingSchedule).toBe(false);
  });

  it("keeps the last good scoreboard when a later fetch for the same week fails (returns {})", async () => {
    getNflScoreboard.mockResolvedValueOnce(sf("Live"));
    const { result } = renderHook(() => useNflSchedule());
    await act(async () => { await result.current.loadSchedule(3); });
    const stamp = result.current.scheduleUpdatedAt;

    getNflScoreboard.mockResolvedValueOnce({});
    await act(async () => { await result.current.loadSchedule(3, { bypass: true }); });

    expect(result.current.scheduleByTeam).toEqual(sf("Live"));
    expect(result.current.scheduleUpdatedAt).toBe(stamp);
  });

  it("does not carry a previous week's scoreboard across a week change when the new fetch fails", async () => {
    getNflScoreboard.mockResolvedValueOnce(sf("Final"));
    const { result } = renderHook(() => useNflSchedule());
    await act(async () => { await result.current.loadSchedule(3); });

    getNflScoreboard.mockResolvedValueOnce({});
    await act(async () => { await result.current.loadSchedule(4); });

    expect(result.current.scheduleByTeam).toEqual({});
  });
});
