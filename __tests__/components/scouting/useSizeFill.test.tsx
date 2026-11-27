// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSizeFill } from "@/components/scouting/size/useSizeFill";
import type { CombineSizesResponse, SizeProspect } from "@/lib/scouting/measuredSize";

// Measured sizes, client side (migration 108): one combine request per class
// shown, or a pasted list read in the browser; only the ticked changes saved.

const { UPDATES, ERRORS } = vi.hoisted(() => ({
  UPDATES: [] as { id: string; patch: Record<string, unknown> }[],
  ERRORS: [] as ({ message: string } | null)[],
}));
vi.mock("@/lib/supabaseclient", () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          UPDATES.push({ id, patch });
          return Promise.resolve({ error: ERRORS.shift() ?? null });
        },
      }),
    }),
  },
}));
vi.mock("@/components/scouting/pff/pffClient", () => ({ pffAuthHeader: async () => ({ Authorization: "Bearer t" }) }));

const ANSWERS: Record<number, CombineSizesResponse> = {
  2026: { year: 2026, rows: [{ name: "Kaytron Allen", school: "Penn St.", position: "RB", heightEighths: 568, weight: 216 }] },
  2027: { year: 2027, rows: null },
};
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  const { year } = JSON.parse(String(init?.body)) as { year: number };
  return new Response(JSON.stringify(ANSWERS[year]), { status: 200 });
});

const p = (id: string, name: string, year: number, extra: Partial<SizeProspect> = {}): SizeProspect =>
  ({ id, name, position: "RB", school: "Penn State", draft_class_year: year, height: `6'0"`, weight: 220, ...extra });
const POOL = [
  p("allen", "Kaytron Allen", 2026),
  p("doe", "Jordan Doe", 2027, { position: "WR", school: "Iowa" }),
  p("roe", "Sam Roe", 2027, { position: "TE", size_source: "combine" }),
];

beforeEach(() => { UPDATES.length = 0; ERRORS.length = 0; fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("useSizeFill", () => {
  it("reads the combine for each class shown and saves the ticked change with the listed size kept", async () => {
    const onDataChanged = vi.fn();
    const { result } = renderHook(() => useSizeFill(onDataChanged));
    act(() => result.current.open());
    expect(result.current.phase).toBe("choose");
    await act(async () => { await result.current.readCombine(POOL); });
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).year)).toEqual([2026, 2027]);
    expect(result.current.phase).toBe("review");
    expect(result.current.summary?.years).toEqual([{ year: 2026, matched: 1 }, { year: 2027, matched: null }]);
    // 2027's combine isn't out, so nobody in it is listed as missing.
    expect(result.current.summary?.notFound).toEqual([]);
    expect(result.current.changes.map((c) => c.key)).toEqual(["allen|size"]);
    expect([...result.current.selected]).toEqual(["allen|size"]);

    await act(async () => { await result.current.apply(); });
    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0].id).toBe("allen");
    expect(UPDATES[0].patch).toMatchObject({
      height: `5'11"`, weight: 216, size_source: "combine", size_measured_on: null, listed_height: `6'0"`, listed_weight: 220,
    });
    expect(result.current.phase).toBe("done");
    expect(result.current.summary?.saved).toBe(1);
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  });

  it("reads a pasted list across positions, keeping an outranking measurement as it is", () => {
    const { result } = renderHook(() => useSizeFill());
    act(() => result.current.readPaste(POOL, "Jordan Doe WR Iowa 6011 197\nSam Roe TE 6044 250\nNobody Here RB 5100 200", "senior_bowl", "2027-01-27"));
    expect(result.current.phase).toBe("review");
    expect(result.current.changes.map((c) => [c.prospectId, c.to])).toEqual([["doe", `6'1 1/8" 197`]]);
    expect(result.current.summary?.kept.map((k) => k.id)).toEqual(["roe"]);
    expect(result.current.summary?.pasted?.unmatched).toEqual(["Nobody Here RB 5100 200"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names migration 108 when a save fails on its columns", async () => {
    ERRORS.push({ message: "Could not find the 'size_source' column of 'prospects' in the schema cache" });
    const onDataChanged = vi.fn();
    const { result } = renderHook(() => useSizeFill(onDataChanged));
    act(() => result.current.readPaste(POOL, "Jordan Doe 6011 197", "pro_day", "2027-03-20"));
    await act(async () => { await result.current.apply(); });
    expect(result.current.error).toMatch(/migration 108/);
    expect(result.current.summary?.saved).toBe(0);
    expect(onDataChanged).not.toHaveBeenCalled();
  });
});
