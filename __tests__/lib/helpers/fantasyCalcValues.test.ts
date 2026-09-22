import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchFantasyCalcValues, withFcValues } from "@/lib/helpers/picks";
import { CURRENT_YEAR } from "@/lib/helpers/season";
import { invalidateFcValuesCache } from "@/lib/fcValuesStore";

function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => invalidateFcValuesCache()); // the shared store is module-level state — isolate each test
afterEach(() => vi.unstubAllGlobals());

describe("fetchFantasyCalcValues", () => {
  it("normalises player values, pick slot values and skill-position trend rows", async () => {
    const fetchMock = stubFetch([
      { player: { sleeperId: "1", name: "Star QB", position: "QB", maybeTeam: "KC" }, value: 9000, redraftValue: 8000, trend30Day: 150, maybeTradeFrequency: 0.1 },
      { player: { sleeperId: "2", name: "Some K", position: "K" }, value: 100 },
      { player: { sleeperId: "3", name: "Zero WR", position: "WR" }, value: 0 },
      { player: { name: `${CURRENT_YEAR} Pick 1.04`, position: "PICK" }, value: 6000 },
    ]);

    const r = await fetchFantasyCalcValues(2);

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/fc-values?numQbs=2");
    // Zero-value entries are dropped; non-skill positions keep a value but get no trend row.
    expect(r.playerValues).toEqual({ "1": 9000, "2": 100 });
    expect(r.pickValues[`${CURRENT_YEAR}-1.04`]).toBe(6000);
    expect(r.trendData).toEqual([
      { sleeperId: "1", name: "Star QB", position: "QB", team: "KC", value: 9000, redraftValue: 8000, trend30Day: 150, tradeFrequency: 0.1 },
    ]);
  });

  // The proxy answers an FC outage with a non-OK status (or, on older deploys, 200 + []). Either way
  // "no data" must surface as an error — callers cache the result, and an empty success would be
  // cached as "no player has a value".
  it.each([500, 502, 503])("throws on a %i response", async (status) => {
    stubFetch({ error: "FantasyCalc unavailable" }, status);
    await expect(fetchFantasyCalcValues(2)).rejects.toThrow(`fc-values ${status}`);
  });

  it("throws on a 200 with an empty array", async () => {
    stubFetch([]);
    await expect(fetchFantasyCalcValues(2)).rejects.toThrow("no data");
  });

  it("throws on a 200 with a non-array body", async () => {
    stubFetch({ error: "nope" });
    await expect(fetchFantasyCalcValues(2)).rejects.toThrow("no data");
  });
});

describe("withFcValues", () => {
  interface TestPlayer { id: string; value?: number }
  const players: Record<string, TestPlayer> = {
    a: { id: "a", value: 100 },
    b: { id: "b" },
    c: { id: "c", value: 300 },
  };

  it("sets values from the map, ignores ids that are not players, and does not mutate the input", () => {
    const out = withFcValues(players, { a: 150, b: 250, zzz: 999 });
    expect(out.a.value).toBe(150);
    expect(out.b.value).toBe(250);
    expect(out).not.toHaveProperty("zzz");
    expect(players.a.value).toBe(100);
    expect(players.b).not.toHaveProperty("value");
  });

  it("only clones players whose value changed; the rest keep their identity", () => {
    const out = withFcValues(players, { a: 150 });
    expect(out).not.toBe(players);
    expect(out.a).not.toBe(players.a);
    expect(out.b).toBe(players.b);
    expect(out.c).toBe(players.c);
  });

  it("is merge-only: a player absent from the map keeps its existing value", () => {
    expect(withFcValues(players, { a: 150 }).c.value).toBe(300);
  });

  it("returns the very same map when nothing would change (no pointless React update)", () => {
    expect(withFcValues(players, { a: 100, c: 300 })).toBe(players);
    expect(withFcValues(players, {})).toBe(players);
    expect(withFcValues(players, { zzz: 1 })).toBe(players);
  });
});
