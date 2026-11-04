import type { LeagueSimulation } from "../../lib/types";
import { titleGain, tradeImpactPasses, type TradeSimImpact } from "./FinderScoring";
import type { FinderBoardView, FinderSimCandidate } from "./finderPipeline";

/** How long the Finder keeps checking a board's trades in the simulator (user, 2026-11-04: "within
 *  reason", not a full minute). A time rather than a count because a phone runs these slower.
 *  About 180 trades on a desktop. Cards it doesn't reach show no odds and keep their Preview button. */
export const TRADE_CHECK_LIMIT_MS = 20000;

export type PreviewTrade = (
  myRosterId: number,
  opponentRosterId: number,
  giveIds: string[],
  receiveIds: string[],
) => LeagueSimulation | null;

/** Everything measured with one set of sim inputs. Outlives a pass that gets cut short. */
export interface MeasuredTrades {
  forPreview: PreviewTrade | null;
  baseline: LeagueSimulation | null;
  impacts: Map<string, TradeSimImpact>;
  unmeasurable: Set<string>;
  /** Which board the time below was spent on: Tier Up's trades aren't Tier Down's. */
  board: string;
  spentMs: number;
}

export const newMeasuredTrades = (forPreview: PreviewTrade | null): MeasuredTrades => ({
  forPreview, baseline: null, impacts: new Map(), unmeasurable: new Set(), board: "", spentMs: 0,
});

export const unmeasuredTrades = (measured: MeasuredTrades, candidates: FinderSimCandidate[]): FinderSimCandidate[] =>
  candidates.filter((c) => !measured.impacts.has(c.fingerprint) && !measured.unmeasurable.has(c.fingerprint));

/** Measures a board's trades, each against a no-trade run with the same dice. A trade that fails
 *  leaves its slot to an unmeasured one, so it goes round again on those (nextCandidates) until the
 *  board is all checked, the time runs out, or the caller cancels. Does nothing until the sim's
 *  inputs are ready: new inputs make a new preview, and with it a new pass. */
export const measureBoardTrades = async ({ measured, preview, firstCandidates, nextCandidates, isCancelled, onProgress }: {
  measured: MeasuredTrades;
  preview: PreviewTrade;
  firstCandidates: FinderSimCandidate[];
  nextCandidates: () => FinderSimCandidate[];
  isCancelled: () => boolean;
  onProgress: (done: number, total: number) => void;
}): Promise<void> => {
  if (firstCandidates.length === 0) return;
  if (!measured.baseline) {
    measured.baseline = preview(firstCandidates[0].myRosterId, firstCandidates[0].oppRosterId, [], []);
    if (!measured.baseline) return;
  }
  const baseline = measured.baseline;
  let candidates = firstCandidates;
  let lastTick = performance.now();
  while (measured.spentMs < TRADE_CHECK_LIMIT_MS) {
    const missing = unmeasuredTrades(measured, candidates);
    if (missing.length === 0) return;
    const total = candidates.length;
    const alreadyDone = total - missing.length;
    onProgress(alreadyDone, total);
    for (let i = 0; i < missing.length; i++) {
      if (isCancelled()) return;
      if (measured.spentMs >= TRADE_CHECK_LIMIT_MS) return;
      const c = missing[i];
      const after = preview(c.myRosterId, c.oppRosterId, c.giveIds, c.receiveIds);
      const myBefore = baseline.rowByRosterId?.get(c.myRosterId);
      const myAfter = after?.rowByRosterId?.get(c.myRosterId);
      const oppBefore = baseline.rowByRosterId?.get(c.oppRosterId);
      const oppAfter = after?.rowByRosterId?.get(c.oppRosterId);
      if (myBefore && myAfter && oppBefore && oppAfter) {
        measured.impacts.set(c.fingerprint, {
          myPlayoffBefore: myBefore.playoffOdds, myPlayoffAfter: myAfter.playoffOdds,
          myTitleBefore: myBefore.titleOdds, myTitleAfter: myAfter.titleOdds,
          oppPlayoffDelta: oppAfter.playoffOdds - oppBefore.playoffOdds,
          oppTitleDelta: oppAfter.titleOdds - oppBefore.titleOdds,
          oppIsContender: c.oppIsContender, oppIsRebuildSide: c.oppIsRebuildSide,
        });
      } else {
        measured.unmeasurable.add(c.fingerprint);
      }
      onProgress(alreadyDone + i + 1, total);
      // Yield to the main thread between sim calls so this can't jank the UI.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const now = performance.now();
      measured.spentMs += now - lastTick;
      lastTick = now;
    }
    if (isCancelled()) return;
    candidates = nextCandidates();
  }
};

/** What the measurements so far mean for the board. Only a win-now team's board is judged by them. */
export const finderBoardView = (
  impacts: Map<string, TradeSimImpact>,
  userIsWinNow: boolean,
  championshipSelected: boolean,
): FinderBoardView => {
  const championshipBoard = userIsWinNow && championshipSelected;
  return {
    simDiscardedFingerprints: new Set(
      userIsWinNow
        ? [...impacts.entries()]
            .filter(([, impact]) => !tradeImpactPasses(impact, championshipBoard ? "championshipImpact" : "recommended"))
            .map(([fp]) => fp)
        : []
    ),
    measuredFingerprints: new Set(impacts.keys()),
    titleGainByFingerprint: championshipBoard
      ? new Map([...impacts.entries()].map(([fp, impact]) => [fp, titleGain(impact)]))
      : undefined,
  };
};
