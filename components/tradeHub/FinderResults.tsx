"use client";
import type {
  TradeAttempt, AugmentedPick, LeagueMateView, LeagueSimulation, SleeperRoster,
} from "../../lib/types";
import type { TradeResult } from "./finderTypes";
import type { PlayerWithValue } from "./shared";
import { buildTradeFingerprint } from "./shared";
import { finderPickKey } from "./finderUtils";
import { computeFinderStarDiscounts } from "./calculatorUtils";
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
      // Same canonical star-discount call TradeCard uses for its displayed net,
      // so the sort key below can't drift from the badge on each card.
      const { onReceive: starOnReceive, onGive: starOnGive } = computeFinderStarDiscounts(
        trade.give, trade.receive, trade.givePicks, trade.receivePicks,
      );
      const approxNetPlayerGain = trade.receive.length - trade.give.length;
      const approxMyDropCost  = approxNetPlayerGain > 0 ? calcDropCost(myRoster?.roster_id ?? 0, approxNetPlayerGain) : 0;
      const approxOppDropCost = approxNetPlayerGain < 0 ? calcDropCost(trade.oppRosterId, -approxNetPlayerGain) : 0;
      // Mirror TradeCard.adjustedCardNet exactly — incl. the Math.max(0,...)
      // receive clamp — so the list sorts by the same net each card displays.
      const approxBadge = Math.max(0, rSum + approxOppDropCost + starOnReceive) - (gSum + approxMyDropCost + starOnGive);
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
