"use client";
import type {
  TradeAttempt, AugmentedPick, LeagueMateView, LeagueSimulation, SleeperRoster,
  LeagueAssetDispositions,
} from "../../lib/types";
import type { TradeResult } from "./finderTypes";
import type { PlayerWithValue } from "./shared";
import { buildTradeFingerprint } from "./shared";
import { finderPickKey } from "./finderUtils";
import { computeFinderAdjustedNet } from "./calculatorUtils";
import TradeCard from "./TradeCard";

interface FinderResultsProps {
  allTrades: TradeResult[];
  recentFingerprints: Set<string>;
  pinnedPlayer: PlayerWithValue | null;
  draftCapitalMode: boolean;
  leagueId: string;
  myRoster: SleeperRoster | undefined;
  selectedLeagueSimulation: LeagueSimulation | null;
  posTeamTotals: { rosterId: number; totals: Record<string, number> }[];
  numTeams: number;
  leaguePlayerTags: LeagueAssetDispositions;
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
}

export default function FinderResults({
  allTrades,
  recentFingerprints,
  pinnedPlayer,
  draftCapitalMode,
  leagueId,
  myRoster,
  selectedLeagueSimulation,
  posTeamTotals,
  numTeams,
  leaguePlayerTags,
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
    .map((trade) => {
      // Same canonical adjusted-net TradeCard displays (shared helper), so the sort key
      // can't drift from each card's badge.
      const { net } = computeFinderAdjustedNet(trade, calcDropCost, myRoster?.roster_id ?? 0);
      return { trade, net };
    })
    // Acceptance-first ranking: every trade here already cleared the opponent-acceptance
    // gate in the pipeline, so order the survivors by the USER's gain — most favorable
    // first — instead of "closest to even". Keep bonus buy-low slots grouped after the
    // headline board (they're often ~even net) so they stay visible instead of scattered.
    .sort((a, b) => {
      const aBuy = a.trade.isBuyLow ? 1 : 0;
      const bBuy = b.trade.isBuyLow ? 1 : 0;
      if (aBuy !== bBuy) return aBuy - bBuy;
      return b.net - a.net;
    });

  return (
    <>
      {allTrades.length === 0 && (
        <p className="text-slate-400 text-sm">
          {pinnedPlayer
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
      {visibleTrades.map(({ trade }) => (
        <TradeCard
          key={buildTradeFingerprint(leagueId, trade.oppRosterId, [...trade.give.map((p) => p.player_id), ...trade.givePicks.map((p) => finderPickKey(p))], [...trade.receive.map((p) => p.player_id), ...trade.receivePicks.map((p) => finderPickKey(p))])}
          trade={trade}
          leagueId={leagueId}
          myRoster={myRoster}
          selectedLeagueSimulation={selectedLeagueSimulation}
          posTeamTotals={posTeamTotals}
          numTeams={numTeams}
          leaguePlayerTags={leaguePlayerTags}
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
        />
      ))}
    </>
  );
}
