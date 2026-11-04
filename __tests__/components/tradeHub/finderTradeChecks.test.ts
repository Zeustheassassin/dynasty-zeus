import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TRADE_CHECK_LIMIT_MS, finderBoardView, measureBoardTrades, newMeasuredTrades, unmeasuredTrades,
  type MeasuredTrades, type PreviewTrade,
} from "@/components/tradeHub/finderTradeChecks";
import type { FinderSimCandidate } from "@/components/tradeHub/finderPipeline";
import type { TradeSimImpact } from "@/components/tradeHub/FinderScoring";
import type { LeagueSimulation } from "@/lib/types";

const ME = 1;
const OPP = 2;
const candidate = (n: number, over: Partial<FinderSimCandidate> = {}): FinderSimCandidate => ({
  fingerprint: `trade-${n}`, myRosterId: ME, oppRosterId: OPP,
  giveIds: [`g${n}`], receiveIds: [`r${n}`],
  oppPlayoffOddsBefore: 50, oppIsContender: false, oppIsRebuildSide: false,
  ...over,
});
const sim = (mine: [number, number], theirs: [number, number]) => ({
  rowByRosterId: new Map([
    [ME, { playoffOdds: mine[0], titleOdds: mine[1] }],
    [OPP, { playoffOdds: theirs[0], titleOdds: theirs[1] }],
  ]),
}) as unknown as LeagueSimulation;

/** The no-trade run is 60% / 10%, and any trade adds a point of playoff odds for me. */
const preview = (): ReturnType<typeof vi.fn<PreviewTrade>> => vi.fn<PreviewTrade>((_me, _opp, give) =>
  give.length === 0 ? sim([60, 10], [40, 5]) : sim([61, 12], [39, 4]));

const run = (measured: MeasuredTrades, firstCandidates: FinderSimCandidate[], over: Partial<Parameters<typeof measureBoardTrades>[0]> = {}) => {
  const onProgress = vi.fn();
  return measureBoardTrades({
    measured,
    preview: preview(),
    firstCandidates,
    nextCandidates: () => firstCandidates,
    isCancelled: () => false,
    onProgress,
    ...over,
  }).then(() => onProgress);
};

afterEach(() => vi.restoreAllMocks());

describe("measureBoardTrades", () => {
  it("measures each trade against one no-trade run", async () => {
    const measured = newMeasuredTrades(null);
    const fake = preview();
    await run(measured, [candidate(1), candidate(2)], { preview: fake });
    expect(fake).toHaveBeenCalledTimes(3);
    expect(fake.mock.calls[0].slice(2)).toEqual([[], []]);
    expect(measured.impacts.get("trade-1")).toEqual({
      myPlayoffBefore: 60, myPlayoffAfter: 61, myTitleBefore: 10, myTitleAfter: 12,
      oppPlayoffDelta: -1, oppTitleDelta: -1, oppIsContender: false, oppIsRebuildSide: false,
    });
  });

  it("goes round again on what the results put on the board, until nothing's new", async () => {
    const measured = newMeasuredTrades(null);
    const rounds = [[candidate(1), candidate(2), candidate(3)], [candidate(1), candidate(2), candidate(3)]];
    const nextCandidates = vi.fn(() => rounds.shift() ?? []);
    await run(measured, [candidate(1), candidate(2)], { nextCandidates });
    expect([...measured.impacts.keys()]).toEqual(["trade-1", "trade-2", "trade-3"]);
    expect(nextCandidates).toHaveBeenCalledTimes(2);
  });

  it("never measures a trade twice", async () => {
    const measured = newMeasuredTrades(null);
    const fake = preview();
    await run(measured, [candidate(1)], { preview: fake });
    await run(measured, [candidate(1), candidate(2)], { preview: fake });
    expect(fake.mock.calls.filter((call) => call[2][0] === "g1")).toHaveLength(1);
    expect(measured.impacts.size).toBe(2);
  });

  it("counts progress across the whole board", async () => {
    const measured = newMeasuredTrades(null);
    measured.baseline = sim([60, 10], [40, 5]);
    measured.impacts.set("trade-1", {} as TradeSimImpact);
    const onProgress = await run(measured, [candidate(1), candidate(2), candidate(3)]);
    expect(onProgress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("stops at the time limit, keeping what it measured", async () => {
    const measured = newMeasuredTrades(null);
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += TRADE_CHECK_LIMIT_MS / 2));
    await run(measured, Array.from({ length: 10 }, (_, i) => candidate(i)));
    expect(measured.impacts.size).toBe(2);
    expect(measured.spentMs).toBeGreaterThanOrEqual(TRADE_CHECK_LIMIT_MS);
  });

  it("does nothing with no time left", async () => {
    const measured = newMeasuredTrades(null);
    measured.spentMs = TRADE_CHECK_LIMIT_MS;
    await run(measured, [candidate(1)]);
    expect(measured.impacts.size).toBe(0);
  });

  it("stops when cancelled, and a later pass picks up where it stopped", async () => {
    const measured = newMeasuredTrades(null);
    let cancelled = false;
    const fake = vi.fn<PreviewTrade>((_me, _opp, give) => {
      if (give.length > 0) cancelled = true;
      return give.length === 0 ? sim([60, 10], [40, 5]) : sim([61, 12], [39, 4]);
    });
    const candidates = [candidate(1), candidate(2), candidate(3)];
    await run(measured, candidates, { preview: fake, isCancelled: () => cancelled });
    expect(measured.impacts.size).toBe(1);
    await run(measured, candidates);
    expect(measured.impacts.size).toBe(3);
  });

  it("while the sim's inputs load: no progress bar, nothing written off", async () => {
    const measured = newMeasuredTrades(null);
    const onProgress = await run(measured, [candidate(1), candidate(2)], { preview: vi.fn<PreviewTrade>(() => null) });
    expect(onProgress).not.toHaveBeenCalled();
    expect(measured.unmeasurable.size).toBe(0);
    expect(measured.spentMs).toBe(0);
  });

  it("a trade the sim can't answer for is set aside, not retried forever", async () => {
    const measured = newMeasuredTrades(null);
    const fake = vi.fn<PreviewTrade>((_me, _opp, give) => {
      if (give.length === 0) return sim([60, 10], [40, 5]);
      return give[0] === "g1" ? null : sim([61, 12], [39, 4]);
    });
    await run(measured, [candidate(1), candidate(2)], { preview: fake });
    expect(measured.unmeasurable.has("trade-1")).toBe(true);
    expect(measured.impacts.has("trade-2")).toBe(true);
    expect(fake).toHaveBeenCalledTimes(3);
    expect(unmeasuredTrades(measured, [candidate(1), candidate(2)])).toEqual([]);
  });
});

describe("finderBoardView", () => {
  const impact = (over: Partial<TradeSimImpact>): TradeSimImpact => ({
    myPlayoffBefore: 60, myPlayoffAfter: 60, myTitleBefore: 10, myTitleAfter: 10,
    oppPlayoffDelta: 0, oppTitleDelta: 0, oppIsContender: false, oppIsRebuildSide: false,
    ...over,
  });
  const impacts = new Map([
    ["helps", impact({ myPlayoffAfter: 65, myTitleAfter: 12 })],
    ["playoffOnly", impact({ myPlayoffAfter: 65 })],
    ["nothing", impact({})],
  ]);

  it("the normal board hides what doesn't help", () => {
    const view = finderBoardView(impacts, true, false);
    expect([...view.simDiscardedFingerprints!]).toEqual(["nothing"]);
    expect(view.titleGainByFingerprint).toBeUndefined();
    expect(view.measuredFingerprints!.size).toBe(3);
  });

  it("Championship Impact hides what doesn't raise title odds, and ranks the rest", () => {
    const view = finderBoardView(impacts, true, true);
    expect([...view.simDiscardedFingerprints!].sort()).toEqual(["nothing", "playoffOnly"]);
    expect(view.titleGainByFingerprint!.get("helps")).toBe(2);
  });

  it("a team that isn't win-now isn't judged, whichever view was picked", () => {
    const view = finderBoardView(impacts, false, true);
    expect(view.simDiscardedFingerprints!.size).toBe(0);
    expect(view.titleGainByFingerprint).toBeUndefined();
  });
});
