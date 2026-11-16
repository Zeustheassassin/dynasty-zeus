// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useFortyFill } from "@/components/scouting/forty/useFortyFill";
import type { FortyFillProspect, FortyTimesResponse } from "@/lib/scouting/fortyFill";

// Fill 40s, client side: one request per class shown, the matches turned into
// changes to review, and only the ticked ones saved.

const { UPDATES } = vi.hoisted(() => ({ UPDATES: [] as { id: string; patch: Record<string, unknown> }[] }));
vi.mock("@/lib/supabaseclient", () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => { UPDATES.push({ id, patch }); return Promise.resolve({ error: null }); },
      }),
    }),
  },
}));
vi.mock("@/components/scouting/pff/pffClient", () => ({ pffAuthHeader: async () => ({ Authorization: "Bearer t" }) }));

const ANSWERS: Record<number, FortyTimesResponse> = {
  2026: {
    year: 2026, position: "RB",
    combine: [{ name: "Jeremiyah Love", school: "Notre Dame", position: "RB", forty: 4.36, weight: 212 }],
    projected: [{ name: "Nicholas Singleton", school: "Penn State", position: "RB", forty: 4.51, weight: 224 }],
  },
  2027: {
    year: 2027, position: "RB", combine: null,
    projected: [
      { name: "Jadan Baugh", school: "Florida", position: "RB", forty: 4.5, weight: 228 },
      { name: "Makhi Hughes", school: "Oregon", position: "RB", forty: 4.5, weight: 210 },
    ],
  },
};

const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  const { year } = JSON.parse(String(init?.body)) as { year: number };
  return new Response(JSON.stringify(ANSWERS[year]), { status: 200 });
});

const p = (id: string, name: string, school: string, year: number, extra: Partial<FortyFillProspect> = {}): FortyFillProspect =>
  ({ id, name, school, position: "RB", draft_class_year: year, ...extra });
const PROSPECTS = [
  p("love", "Jeremiyah Love", "Notre Dame", 2026),
  p("single", "Nicholas Singleton", "Penn State", 2026),
  p("baugh", "Jadan Baugh", "Florida", 2027),
  p("hughes", "Makhi Hughes", "Tulane", 2027),
  p("nobody", "Unranked Back", "Iowa", 2027),
  p("wr", "A Receiver", "Iowa", 2027, { position: "WR" }),
];

beforeEach(() => { UPDATES.length = 0; fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("useFortyFill", () => {
  it("reads each class at the position, lists the changes, and saves only the ticked ones", async () => {
    const onDataChanged = vi.fn();
    const { result } = renderHook(() => useFortyFill(onDataChanged));
    await act(async () => { await result.current.start(PROSPECTS, "RB"); });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))])).toEqual([
      ["/api/scouting/forty-times", { year: 2026, position: "RB" }],
      ["/api/scouting/forty-times", { year: 2027, position: "RB" }],
    ]);
    expect(result.current.phase).toBe("review");
    expect(result.current.changes.map((c) => [c.prospectId, c.kind, c.on])).toEqual([
      ["love", "combine", true],
      ["single", "projected", true],
      ["baugh", "projected", true],
      ["hughes", "projected", false], // WalterFootball has him at Oregon
    ]);
    expect(result.current.summary!.years).toEqual([
      { year: 2026, combine: 1, projected: 1 },
      { year: 2027, combine: null, projected: 2 },
    ]);
    expect(result.current.summary!.notFound).toEqual([{ id: "nobody", name: "Unranked Back", year: 2027 }]);

    act(() => result.current.toggle("baugh|projected")); // untick one
    await act(async () => { await result.current.apply(); });
    const byId = Object.fromEntries(UPDATES.map((u) => [u.id, u.patch]));
    expect(Object.keys(byId).sort()).toEqual(["love", "single"]);
    expect(byId.love).toMatchObject({ forty_time: 4.36, forty_source: "combine", forty_weight: 212 });
    expect(byId.single).toMatchObject({ forty_projected: 4.51, forty_projected_from: "WalterFootball" });
    expect(result.current.phase).toBe("done");
    expect(result.current.summary!.saved).toBe(2);
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  });

  it("stops with the route's message when a class can't be read", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }));
    const { result } = renderHook(() => useFortyFill());
    await act(async () => { await result.current.start(PROSPECTS, "RB"); });
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toBe("Fill 40s stopped: Too many requests");
  });
});
