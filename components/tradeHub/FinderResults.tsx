"use client";
import type {
  TradeAttempt, AugmentedPick, LeagueMateView, LeagueSimulation, SleeperRoster,
  LeagueAssetDispositions, LeagueExpiringBlocks,
} from "../../lib/types";
import type { FinderSortMode, FinderTierMode, TradeResult } from "./finderTypes";
import type { PlayerWithValue } from "./shared";
import { buildTradeFingerprint } from "./shared";
import { finderPickKey } from "./finderUtils";
import { computeFinderAdjustedNet } from "./calculatorUtils";
import {
  fairnessTier, playoffGain, titleGain, MIN_TITLE_ODDS_GAIN, type TradeSimImpact,
} from "./FinderScoring";
import TradeCard from "./TradeCard";

interface FinderResultsProps {
  allTrades: TradeResult[];
  /** "recommended" (default heuristic/net ranking), or a win-now team's impact view: rank the
   *  measured trades by real playoff-odds or title-odds gain (toggle in TradeFinder.tsx). */
  sortMode: FinderSortMode;
  /** The trade shape being looked for, for the empty message. */
  tierMode: FinderTierMode;
  /** Trade fingerprint -> what it measured. Only the win-now candidate pool
   *  (finderModel.simCandidates) is measured — other trades have no entry, sort to the bottom of
   *  an impact view, and show no odds on their card. */
  simImpacts: Map<string, TradeSimImpact>;
  /** Real-simulation playoff-odds vetting pass progress (TradeFinder.tsx) — set while it's
   *  running, null once idle/done. Purely informational; allTrades already reflects the
   *  vetted list once available (the pipeline recomputes when the pass completes). */
  simVettingProgress?: { done: number; total: number } | null;
  recentFingerprints: Set<string>;
  pinnedPlayer: PlayerWithValue | null;
  draftCapitalMode: boolean;
  leagueId: string;
  myRoster: SleeperRoster | undefined;
  selectedLeagueSimulation: LeagueSimulation | null;
  previewTradeSimulation: (
    myRosterId: number,
    opponentRosterId: number,
    giveIds: string[],
    receiveIds: string[],
  ) => LeagueSimulation | null;
  posTeamTotals: { rosterId: number; totals: Record<string, number> }[];
  numTeams: number;
  leaguePlayerTags: LeagueAssetDispositions;
  noInterestPlayers: LeagueExpiringBlocks;
  onSetNoInterest: (leagueId: string, playerId: string, days: number | null) => void;
  marketSignalMap: Map<string, string>;
  rankGapMap: Record<string, number>;
  tradeAttempts: TradeAttempt[];
  sessionMarked: Set<string>;
  iAmTankingFinder: boolean;
  finderDirection: string;
  weakPositions: Set<string>;
  leagueMateProfileByRosterId: Map<number, LeagueMateView>;
  calcDropCost: (rosterId: number, netPlayerGain: number) => number;
  computePosRank: (pos: string, rosterId: number, overrideTotal?: number) => number;
  getTradeIntent: (trade: TradeResult) => { label: string; detail: string };
  finderPickLabel: (p: AugmentedPick) => string;
  onSetPlayerProfileId: (id: string | null) => void;
  onSetViewRosterRosterId: (id: number | null) => void;
  onOpenInCalculator: (trade: TradeResult) => void;
  onMarkAttempted: (attempt: Omit<TradeAttempt, "id" | "user_id" | "attempted_at" | "resolved_at">) => Promise<void>;
  onSessionMark: (fingerprint: string) => void;
  onDiscardTrade: (leagueId: string, fingerprint: string) => void;
}

export default function FinderResults({
  allTrades,
  sortMode,
  tierMode,
  simImpacts,
  simVettingProgress,
  recentFingerprints,
  pinnedPlayer,
  draftCapitalMode,
  leagueId,
  myRoster,
  selectedLeagueSimulation,
  previewTradeSimulation,
  posTeamTotals,
  numTeams,
  leaguePlayerTags,
  noInterestPlayers,
  onSetNoInterest,
  marketSignalMap,
  rankGapMap,
  tradeAttempts,
  sessionMarked,
  iAmTankingFinder,
  finderDirection,
  weakPositions,
  leagueMateProfileByRosterId,
  calcDropCost,
  computePosRank,
  getTradeIntent,
  finderPickLabel,
  onSetPlayerProfileId,
  onSetViewRosterRosterId,
  onOpenInCalculator,
  onMarkAttempted,
  onSessionMark,
  onDiscardTrade,
}: FinderResultsProps) {
  const suppressedCount = allTrades.filter((trade) => {
    const fp = buildTradeFingerprint(
      leagueId,
      trade.oppRosterId,
      [...trade.give.map((p) => p.player_id), ...trade.givePicks.map((p) => finderPickKey(p))],
      [...trade.receive.map((p) => p.player_id), ...trade.receivePicks.map((p) => finderPickKey(p))],
    );
    return recentFingerprints.has(fp);
  }).length;

  const visibleTrades = allTrades
    .filter((trade) => {
      const fp = buildTradeFingerprint(
        leagueId,
        trade.oppRosterId,
        [...trade.give.map((p) => p.player_id), ...trade.givePicks.map((p) => finderPickKey(p))],
        [...trade.receive.map((p) => p.player_id), ...trade.receivePicks.map((p) => finderPickKey(p))],
      );
      return !recentFingerprints.has(fp);
    })
    .map((trade, order) => {
      // Same canonical adjusted-net TradeCard displays (shared helper), so the net can't
      // drift from each card's badge. `order` is the pipeline's own ranking.
      const { net } = computeFinderAdjustedNet(trade, calcDropCost, myRoster?.roster_id ?? 0);
      const fp = buildTradeFingerprint(
        leagueId,
        trade.oppRosterId,
        [...trade.give.map((p) => p.player_id), ...trade.givePicks.map((p) => finderPickKey(p))],
        [...trade.receive.map((p) => p.player_id), ...trade.receivePicks.map((p) => finderPickKey(p))],
      );
      const impact = simImpacts.get(fp);
      const gain = !impact || sortMode === "recommended"
        ? undefined
        : sortMode === "championshipImpact" ? titleGain(impact) : playoffGain(impact);
      return { trade, net, gain, impact, order };
    })
    // Fair-target ranking (user policy 10/30): every trade here already cleared the
    // opponent-acceptance gate and the fair-target cap in the pipeline. Show the ones on the
    // fair mark first, then close ones, then the rest, each tier in the pipeline's own strategy
    // order. Keep bonus buy-low slots grouped after the headline board so they stay visible.
    .sort((a, b) => {
      if (sortMode !== "recommended") {
        // Trades outside the win-now sim-vetted pool have no real gain figure — push them
        // below every trade that does, rather than mixing an unmeasured trade in by net value.
        const aHas = a.gain != null;
        const bHas = b.gain != null;
        if (aHas !== bHas) return aHas ? -1 : 1;
        if (aHas && bHas && a.gain !== b.gain) {
          return b.gain! - a.gain!;
        }
      }
      // A tier mode's headline shape stays on top of the related shapes.
      const shapeDiff = (a.trade.tierRank ?? 0) - (b.trade.tierRank ?? 0);
      if (shapeDiff !== 0) return shapeDiff;
      const aBuy = a.trade.isBuyLow ? 1 : 0;
      const bBuy = b.trade.isBuyLow ? 1 : 0;
      if (aBuy !== bBuy) return aBuy - bBuy;
      const tierDiff = fairnessTier(a.trade.fairness) - fairnessTier(b.trade.fairness);
      if (tierDiff !== 0) return tierDiff;
      return a.order - b.order;
    });

  return (
    <>
      {simVettingProgress && (
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${(simVettingProgress.done / simVettingProgress.total) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-400 whitespace-nowrap">
            {sortMode === "championshipImpact" ? "Measuring title odds" : "Verifying playoff impact"}… {simVettingProgress.done}/{simVettingProgress.total}
          </span>
        </div>
      )}
      {sortMode === "championshipImpact" && !simVettingProgress && simImpacts.size > 0 && allTrades.length > 0 && (
        <p className="text-xs text-slate-500">
          Trades that raise your title odds at least {MIN_TITLE_ODDS_GAIN} points in the simulator, biggest gain first.
        </p>
      )}
      {allTrades.length === 0 && !simVettingProgress && (
        <p className="text-slate-400 text-sm">
          {sortMode === "championshipImpact"
            ? `None of the trades checked raises your title odds at least ${MIN_TITLE_ODDS_GAIN} points. Try Recommended to see the rest of the board.`
            : tierMode !== "ANY"
            ? `No ${tierMode === "TIER_UP" ? "tier-up" : "tier-down"} trades found${pinnedPlayer ? ` involving ${pinnedPlayer.full_name}` : ""}. Try a different player, or set Trade Shape back to Any.`
            : pinnedPlayer
            ? `No balanced trades found involving ${pinnedPlayer.full_name}. Try a different player or hit Refresh.`
            : draftCapitalMode
            ? "No balanced draft-capital trades found. Try Refresh, pin a player you want to move, or turn Draft Capital Mode off."
            : "No balanced trades found. You can still turn Draft Capital Mode on above to look for pick-return deals."
          }
        </p>
      )}
      {suppressedCount > 0 && (
        <p className="text-xs text-slate-500 italic">
          {suppressedCount} recently-offered trade{suppressedCount > 1 ? "s" : ""} hidden (28-day window).
        </p>
      )}
      {visibleTrades.map(({ trade, impact }) => (
        <TradeCard
          simImpact={impact}
          key={buildTradeFingerprint(leagueId, trade.oppRosterId, [...trade.give.map((p) => p.player_id), ...trade.givePicks.map((p) => finderPickKey(p))], [...trade.receive.map((p) => p.player_id), ...trade.receivePicks.map((p) => finderPickKey(p))])}
          trade={trade}
          leagueId={leagueId}
          myRoster={myRoster}
          selectedLeagueSimulation={selectedLeagueSimulation}
          previewTradeSimulation={previewTradeSimulation}
          posTeamTotals={posTeamTotals}
          numTeams={numTeams}
          leaguePlayerTags={leaguePlayerTags}
          noInterestPlayers={noInterestPlayers}
          onSetNoInterest={onSetNoInterest}
          marketSignalMap={marketSignalMap}
          rankGapMap={rankGapMap}
          tradeAttempts={tradeAttempts}
          sessionMarked={sessionMarked}
          iAmTankingFinder={iAmTankingFinder}
          finderDirection={finderDirection}
          weakPositions={weakPositions}
          leagueMateProfileByRosterId={leagueMateProfileByRosterId}
          calcDropCost={calcDropCost}
          computePosRank={computePosRank}
          getTradeIntent={getTradeIntent}
          finderPickLabel={finderPickLabel}
          onSetPlayerProfileId={onSetPlayerProfileId}
          onSetViewRosterRosterId={onSetViewRosterRosterId}
          onOpenInCalculator={onOpenInCalculator}
          onMarkAttempted={onMarkAttempted}
          onSessionMark={onSessionMark}
          onDiscardTrade={onDiscardTrade}
        />
      ))}
    </>
  );
}
