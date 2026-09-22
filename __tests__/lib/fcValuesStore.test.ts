// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getFcValuesRaw, invalidateFcValuesCache } from "@/lib/fcValuesStore";

// Sept 21 audit, Batch 5: useCalcValues, useRookieBoardState, useSpyState and several
// useAppState call sites each fetched /api/fc-values (or FantasyCalc directly) independently.
// This store is the single chokepoint they now share — these tests cover in-flight coalescing,
// the client TTL cache, that a bad/empty response is never cached, and the force bypass used by
// the manual "refresh trends" action.

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fcBody = () => [{ player: { sleeperId: "1" }, value: 5000 }];

beforeEach(() => invalidateFcValuesCache());
afterEach(() => vi.unstubAllGlobals());

describe("getFcValuesRaw", () => {
  it("builds the dynasty URL without an isDynasty param, and the redraft URL with isDynasty=false", async () => {
    const fetchMock = vi.fn(async (_url: string) => ok(fcBody()));
    vi.stubGlobal("fetch", fetchMock);

    await getFcValuesRaw(2, true);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/fc-values?numQbs=2");

    await getFcValuesRaw(1, false);
    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/fc-values?numQbs=1&isDynasty=false");
  });

  it("coalesces concurrent callers for the same key into one network request", async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => { resolveFetch = r; }));
    vi.stubGlobal("fetch", fetchMock);

    const p1 = getFcValuesRaw(2, true);
    const p2 = getFcValuesRaw(2, true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(ok(fcBody()));
    const [d1, d2] = await Promise.all([p1, p2]);
    expect(d1).toBe(d2); // same array reference — one shared fetch, not two
  });

  it("does not coalesce different keys", async () => {
    const fetchMock = vi.fn(async () => ok(fcBody()));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([getFcValuesRaw(2, true), getFcValuesRaw(1, true), getFcValuesRaw(2, false)]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("serves a repeat call for the same key from the cache without hitting the network", async () => {
    const fetchMock = vi.fn(async () => ok(fcBody()));
    vi.stubGlobal("fetch", fetchMock);

    await getFcValuesRaw(2, true);
    await getFcValuesRaw(2, true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a 502", () => new Response(JSON.stringify({ error: "down" }), { status: 502 })],
    ["an empty array", () => ok([])],
    ["a non-array body", () => ok({ error: "nope" })],
  ])("never caches %s — the next call retries the network", async (_label, bad) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(bad()).mockResolvedValueOnce(ok(fcBody()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getFcValuesRaw(2, true)).rejects.toThrow();
    const data = await getFcValuesRaw(2, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(data).toEqual(fcBody());
  });

  it("force bypasses a warm cache and refreshes it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(fcBody()))
      .mockResolvedValueOnce(ok([{ player: { sleeperId: "1" }, value: 9999 }]));
    vi.stubGlobal("fetch", fetchMock);

    await getFcValuesRaw(2, true);
    const forced = await getFcValuesRaw(2, true, { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(forced).toEqual([{ player: { sleeperId: "1" }, value: 9999 }]);

    // The forced result is itself now cached for subsequent non-forced callers.
    await getFcValuesRaw(2, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
