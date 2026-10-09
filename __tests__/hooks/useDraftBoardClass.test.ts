// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDraftBoardClass } from "@/hooks/useDraftBoardClass";

const getWeek1Kickoff = vi.fn<(season: number) => Promise<number | null>>();
vi.mock("@/lib/scheduleApi", () => ({
  scheduleApi: { getWeek1Kickoff: (season: number) => getWeek1Kickoff(season) },
}));

const KICKOFF_2026 = Date.parse("2026-09-10T00:20:00Z");

beforeEach(() => {
  getWeek1Kickoff.mockReset();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
});
afterEach(() => { vi.useRealTimers(); });

describe("useDraftBoardClass", () => {
  it("asks for this year's Week 1 and uses its kickoff", async () => {
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    getWeek1Kickoff.mockResolvedValue(KICKOFF_2026);
    const { result } = renderHook(() => useDraftBoardClass(null));
    expect(result.current).toEqual({ classYear: 2026, source: "calendar", ready: false });
    await act(async () => {});
    expect(getWeek1Kickoff).toHaveBeenCalledWith(2026);
    expect(result.current).toEqual({ classYear: 2027, source: "espn", ready: true });
  });

  it("goes by Sleeper while ESPN loads, and when ESPN has no kickoff", async () => {
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    getWeek1Kickoff.mockResolvedValue(null);
    const state = { season: "2026", season_type: "regular", week: 6 };
    const { result } = renderHook(() => useDraftBoardClass(state));
    expect(result.current).toEqual({ classYear: 2027, source: "sleeper", ready: false });
    await act(async () => {});
    expect(result.current).toEqual({ classYear: 2027, source: "sleeper", ready: true });
  });

  it("flips at the kickoff on a board left open across it", async () => {
    vi.setSystemTime(new Date("2026-09-09T20:00:00Z"));
    getWeek1Kickoff.mockResolvedValue(KICKOFF_2026);
    const { result } = renderHook(() => useDraftBoardClass(null));
    await act(async () => {});
    expect(result.current.classYear).toBe(2026);
    await act(async () => { vi.advanceTimersByTime(KICKOFF_2026 - Date.now() + 1000); });
    expect(result.current).toEqual({ classYear: 2027, source: "espn", ready: true });
  });
});
