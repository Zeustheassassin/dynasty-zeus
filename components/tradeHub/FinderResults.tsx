"use client";
import type {
  TradeAttempt, AugmentedPick, LeagueMateView, LeagueSimulation, SleeperRoster,
} from "../../lib/types";
import type { TradeResult } from "./finderTypes";
import type { PlayerWithValue } from "./shared";
import { buildTradeFingerprint } from "./shared";
import { finderPickKey } from "./finderUtils";
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
  leaguePlayerTags: Record<string, Record<string, "CORE" | "WANT_TO_TRADE">>;
  marketSignalMap: Map<string, string>;
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
  onToggleLeaguePlayerTag: (leagueId: string, playerId: string, forceTag?: "CORE" | "WANT_TO_TRADE") => void;
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
  onToggleLeaguePlayerTag,
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
      const gVals = [...trade.give.map((p) => p.value), ...trade.givePicks.map((p) => p.value)];
      const rVals = [...trade.receive.map((p) => p.value), ...trade.receivePicks.map((p) => p.value)];
      const gSum  = gVals.reduce((s, v) => s + v, 0);
      const rSum  = rVals.reduce((s, v) => s + v, 0);
      const approxPickParams = (picks: { round?: number | string }[]): { thr: number; pct: number } => {
        if (picks.length === 0) return { thr: 0.78, pct: 0.12 };
        const rd = Math.min(...picks.map((p) => Number(p.round)));
        if (rd === 1) return { thr: 0.78, pct: 0.0125 };
        if (rd === 2) return { thr: 0.83, pct: 0.09 };
        if (rd === 3) return { thr: 0.87, pct: 0.14 };
        return             { thr: 0.91, pct: 0.20 };
      };
      const rp = approxPickParams(trade.receivePicks);
      const gp = approxPickParams(trade.givePicks);
      const gSorted = [...gVals].sort((a, b) => b - a);
      const rSorted = [...rVals].sort((a, b) => b - a);
      let starOnReceive = 0;
      let starOnGive = 0;
      const approxPairs = Math.min(gSorted.length, rSorted.length);
      for (let i = 0; i < approxPairs; i++) {
        const gv = gSorted[i];
        const rv = rSorted[i];
        if (gv > rv && gv >= 2000) {
          const ratio = rv / gv;
          if (ratio < rp.thr) starOnReceive -= Math.round(Math.min((rp.thr - ratio) / 0.25, 1) * gv * rp.pct);
        } else if (rv > gv && rv >= 2000) {
          const ratio = gv / rv;
          if (ratio < gp.thr) starOnGive -= Math.round(Math.min((gp.thr - ratio) / 0.25, 1) * rv * gp.pct);
        }
      }
      const approxNetPlayerGain = trade.receive.length - trade.give.length;
      const approxMyDropCost  = approxNetPlayerGain > 0 ? calcDropCost(myRoster?.roster_id ?? 0, approxNetPlayerGain) : 0;
      const approxOppDropCost = approxNetPlayerGain < 0 ? calcDropCost(trade.oppRosterId, -approxNetPlayerGain) : 0;
      const approxBadge = (rSum + approxOppDropCost + starOnReceive) - (gSum + approxMyDropCost + starOnGive);
      return { trade, approxBadge };
    })
    .sort((a, b) => Math.abs(a.approxBadge) - Math.abs(b.approxBadge));

  return (
    <>
      {allTrades.length === 0 && (
        <p className="text-gray-400 text-sm">
          {pinnedPlayer
            ? `No balanced trades found involving ${pinnedPlayer.full_name}. Try a different player or hit Refresh.`
            : draftCapitalMode
            ? "No balanced draft-capital trades found. Try Refresh, pin a player you want to move, or turn Draft Capital Mode off."
            : "No balanced trades found. You can still turn Draft Capital Mode on above to look for pick-return deals."
          }
        </p>
      )}
      {suppressedCount > 0 && (
        <p className="text-xs text-gray-500 italic">
          {suppressedCount} recently-offered trade{suppressedCount > 1 ? "s" : ""} hidden (28-day window).
        </p>
      )}
      {visibleTrades.map(({ trade }, idx) => (
        <TradeCard
          key={idx}
          trade={trade}
          leagueId={leagueId}
          myRoster={myRoster}
          selectedLeagueSimulation={selectedLeagueSimulation}
          posTeamTotals={posTeamTotals}
          numTeams={numTeams}
          leaguePlayerTags={leaguePlayerTags}
          marketSignalMap={marketSignalMap}
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
          onToggleLeaguePlayerTag={onToggleLeaguePlayerTag}
          onMarkAttempted={onMarkAttempted}
          onSessionMark={onSessionMark}
        />
      ))}
    </>
  );
}
