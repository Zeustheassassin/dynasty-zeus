"use client";
import { CURRENT_YEAR } from "../../lib/helpers";
import type {
  TradeAttempt, TradeAttemptAsset, TradeAttemptPick,
  AugmentedPick, LeagueMateView, LeagueSimulation, SleeperRoster,
} from "../../lib/types";
import {
  isOldProducerBuy, isAgingAsset, isYoungBuildingBlock, isFutureInsulationAsset,
  isPremiumCurrentPick,
} from "./FinderScoring";
import { finderPickKey } from "./finderUtils";
import type { TradeResult } from "./finderTypes";
import { ordinalSuffix, buildTradeFingerprint } from "./shared";
import { computeFinderAdjustedNet, EVEN_NET_THRESHOLD } from "./calculatorUtils";

interface TradeCardProps {
  trade: TradeResult;
  leagueId: string | null;
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

export default function TradeCard({
  trade,
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
}: TradeCardProps) {
  const partnerProfile = leagueMateProfileByRosterId.get(Number(trade.oppRosterId));
  const tradeIntent = getTradeIntent(trade);

  const scoreFactors = (() => {
    const out = trade.give || [];
    const inc = trade.receive || [];
    const outPicks = trade.givePicks || [];
    const incPicks = trade.receivePicks || [];
    const factors: { label: string; positive: boolean }[] = [];
    const oldSells = out.filter((p) => isOldProducerBuy(p)).length;
    const oldBuys = inc.filter((p) => isOldProducerBuy(p)).length;
    const agingSells = out.filter((p) => isAgingAsset(p)).length;
    const youngBuys = inc.filter((p) => isYoungBuildingBlock(p)).length;
    const insulBuys = inc.filter((p) => isFutureInsulationAsset(p)).length;
    const futureFirstsIn = incPicks.filter((p) => Number(p.round) === 1 && String(p.season) !== CURRENT_YEAR).length;
    const weakAdds = inc.filter((p) => weakPositions.has(p.position)).length;
    const weakLosses = out.filter((p) => weakPositions.has(p.position)).length;
    const premPicksOut = outPicks.filter((p) => isPremiumCurrentPick(p)).length;
    if (oldSells > 0) factors.push({ label: `Selling aging ${oldSells > 1 ? "veterans" : "vet"}`, positive: true });
    if (oldBuys > 0) factors.push({ label: `Buying aging ${oldBuys > 1 ? "veterans" : "vet"}`, positive: ["Elite","True Contender","Almost There"].includes(finderDirection) && !iAmTankingFinder });
    if (agingSells > 0 && oldSells === 0) factors.push({ label: "Trading aging asset", positive: true });
    if (youngBuys > 0) factors.push({ label: "Young core incoming", positive: true });
    if (insulBuys > 0 && youngBuys === 0) factors.push({ label: "Insulation asset incoming", positive: true });
    if (futureFirstsIn > 0) factors.push({ label: `${futureFirstsIn} future 1st${futureFirstsIn > 1 ? "s" : ""} incoming`, positive: true });
    if (weakAdds > 0) factors.push({ label: `Patching weak ${weakAdds > 1 ? "positions" : "position"}`, positive: !iAmTankingFinder });
    if (weakLosses > 0) factors.push({ label: "Weakening a thin position", positive: false });
    if (premPicksOut > 0) factors.push({ label: `Selling premium pick`, positive: iAmTankingFinder });
    if (outPicks.length > 0 && incPicks.length === 0 && !iAmTankingFinder) factors.push({ label: "Giving up draft capital", positive: false });
    if (incPicks.length > 0 && iAmTankingFinder) factors.push({ label: "Accumulating picks", positive: true });
    {
      const allOutVals = [...out.map((p) => p.value), ...outPicks.map((p) => p.value)];
      const allIncVals = [...inc.map((p) => p.value), ...incPicks.map((p) => p.value)];
      if (allOutVals.length > 0 && allIncVals.length > 0) {
        const topOut = Math.max(...allOutVals);
        const topInc = Math.max(...allIncVals);
        const hasFirstInInc = incPicks.some((p) => Number(p.round) === 1);
        const hasFirstInOut = outPicks.some((p) => Number(p.round) === 1);
        if (topOut >= 2000 && allIncVals.length >= 2 && (topInc / topOut) < 0.78 && !hasFirstInInc) {
          factors.push({ label: "Value fragmented — best piece coming back is far below your star", positive: false });
        }
        if (topInc >= 2000 && allOutVals.length >= 2 && (topOut / topInc) < 0.78 && !hasFirstInOut) {
          factors.push({ label: "Asking them to give a star for depth — unlikely to accept", positive: false });
        }
      }
    }
    const sellHighGiveNames = out.filter((p) => marketSignalMap.get(p.player_id) === "SELL_HIGH").map((p) => p.full_name.split(" ")[1] ?? p.full_name);
    const buyLowReceiveNames = inc.filter((p) => marketSignalMap.get(p.player_id) === "BUY_LOW").map((p) => p.full_name.split(" ")[1] ?? p.full_name);
    const liquidGiveNames = out.filter((p) => marketSignalMap.get(p.player_id) === "LIQUID").map((p) => p.full_name.split(" ")[1] ?? p.full_name);
    const liquidReceiveNames = inc.filter((p) => marketSignalMap.get(p.player_id) === "LIQUID").map((p) => p.full_name.split(" ")[1] ?? p.full_name);
    if (sellHighGiveNames.length > 0) factors.push({ label: `Sell High: ${sellHighGiveNames.join(", ")} trending up`, positive: true });
    if (buyLowReceiveNames.length > 0) factors.push({ label: `Buy Low: ${buyLowReceiveNames.join(", ")} trending down`, positive: true });
    if (liquidGiveNames.length > 0 && sellHighGiveNames.length === 0) factors.push({ label: `${liquidGiveNames.join(", ")} actively traded (easy to move)`, positive: true });
    if (liquidReceiveNames.length > 0 && buyLowReceiveNames.length === 0) factors.push({ label: `${liquidReceiveNames.join(", ")} actively traded (opponent motivated)`, positive: true });
    if (partnerProfile?.fitLabel) factors.push({ label: `Partner fit: ${partnerProfile.fitLabel}`, positive: partnerProfile.fitScore > 0 });
    if (leagueId && tradeAttempts.length > 0) {
      const oppPastAttempts = tradeAttempts.filter(
        (a) => a.league_id === leagueId && Number(a.partner_roster_id) === Number(trade.oppRosterId)
      );
      if (oppPastAttempts.length > 0) {
        const theirSellIds = new Set(oppPastAttempts.filter(a => a.initiated_by === "THEM").flatMap(a => a.give_players.map(p => p.player_id)));
        const theirBuyIds  = new Set(oppPastAttempts.filter(a => a.initiated_by === "THEM").flatMap(a => a.receive_players.map(p => p.player_id)));
        const myShopIds    = new Set(oppPastAttempts.filter(a => a.initiated_by === "ME").flatMap(a => a.give_players.map(p => p.player_id)));
        const myTargetIds  = new Set(oppPastAttempts.filter(a => a.initiated_by === "ME").flatMap(a => a.receive_players.map(p => p.player_id)));
        const receiveMatchesSell   = inc.filter((p) => theirSellIds.has(p.player_id));
        const giveMatchesBuySignal = out.filter((p) => theirBuyIds.has(p.player_id));
        const receiveIsTheirTarget = inc.filter((p) => theirBuyIds.has(p.player_id));
        const giveMatchesMyShop    = out.filter((p) => myShopIds.has(p.player_id));
        const receiveMatchesMyTarget = inc.filter((p) => myTargetIds.has(p.player_id));
        if (receiveMatchesSell.length > 0) factors.push({ label: `${receiveMatchesSell.map((p) => p.full_name.split(" ")[1]).join(", ")} — they've tried to sell this`, positive: true });
        if (giveMatchesBuySignal.length > 0) factors.push({ label: `${giveMatchesBuySignal.map((p) => p.full_name.split(" ")[1]).join(", ")} — they've asked for this`, positive: true });
        if (receiveIsTheirTarget.length > 0) factors.push({ label: `${receiveIsTheirTarget.map((p) => p.full_name.split(" ")[1]).join(", ")} — they've been acquiring this`, positive: false });
        if (giveMatchesMyShop.length > 0) factors.push({ label: `${giveMatchesMyShop.map((p) => p.full_name.split(" ")[1]).join(", ")} — aligns with your sell history`, positive: true });
        if (receiveMatchesMyTarget.length > 0) factors.push({ label: `${receiveMatchesMyTarget.map((p) => p.full_name.split(" ")[1]).join(", ")} — you've been targeting this`, positive: true });
      }
    }
    return factors.slice(0, 6);
  })();

  // Single source of truth (shared with FinderResults' sort key) so the displayed net and
  // the list ordering can never disagree. Returns the full breakdown for the adjustment lines.
  const {
    myDropCost: cardMyDropCost,
    oppDropCost: cardOppDropCost,
    starOnGive: cardStarOnGive,
    starOnReceive: cardStarOnReceive,
    giveTotalAdj,
    receiveTotalAdj,
    net: adjustedCardNet,
  } = computeFinderAdjustedNet(trade, calcDropCost, myRoster?.roster_id ?? 0);
  const netDisplay = Math.abs(adjustedCardNet);
  const isEven = netDisplay <= EVEN_NET_THRESHOLD;
  const oppSimRow = selectedLeagueSimulation?.rowByRosterId?.get(Number(trade.oppRosterId));
  const oppProjFinish   = oppSimRow ? Math.round(oppSimRow.projectedFinish) : null;
  const oppPlayoffOdds  = oppSimRow ? Math.round(oppSimRow.playoffOdds)     : null;
  const playoffCutline  = selectedLeagueSimulation?.playoffTeams ?? 6;
  const oppNearBubble   = oppProjFinish !== null && (oppProjFinish === playoffCutline || oppProjFinish === playoffCutline + 1);
  const oppInPlayoffs   = oppProjFinish !== null && oppProjFinish <= playoffCutline;
  const oppStandingsBadgeColor = oppInPlayoffs
    ? "border-green-700 bg-green-950/30 text-green-300"
    : oppNearBubble
      ? "border-yellow-700 bg-yellow-950/30 text-yellow-300"
      : "border-gray-700 bg-gray-800/30 text-gray-400";

  const cardLeagueId = leagueId ?? "";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{trade.format}</span>
          <span className="text-xs text-gray-500">with</span>
          <button
            onClick={() => onSetViewRosterRosterId(trade.oppRosterId)}
            className="text-sm font-semibold text-blue-300 hover:text-blue-200 hover:underline transition"
          >
            {trade.oppName}
          </button>
          {oppProjFinish !== null && oppPlayoffOdds !== null && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${oppStandingsBadgeColor}`}>
              {oppInPlayoffs ? "In Playoffs" : oppNearBubble ? "Playoff Bubble" : `~${oppProjFinish}${ordinalSuffix(oppProjFinish)}`} &middot; {oppPlayoffOdds}%
            </span>
          )}
          <span className="rounded-full border border-violet-800 bg-violet-950/30 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
            {tradeIntent.label}
          </span>
          {trade.isBuyLow && (
            <span className="rounded-full border border-green-700 bg-green-950/40 px-2 py-0.5 text-[10px] font-semibold text-green-300">
              Buy Low Target
            </span>
          )}
          {partnerProfile?.fitLabel && (
            <span className="rounded-full border border-cyan-800 bg-cyan-950/30 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
              {partnerProfile.fitLabel}
            </span>
          )}
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isEven ? "bg-yellow-900 text-yellow-300" : adjustedCardNet > 0 ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
          {isEven ? "EVEN" : adjustedCardNet > 0 ? `+${netDisplay.toLocaleString()}` : `-${netDisplay.toLocaleString()}`}
        </span>
      </div>
      {partnerProfile?.fitReasons?.[0] && (
        <div className="mb-3 text-xs text-gray-500">
          {tradeIntent.detail} {partnerProfile.fitReasons[0] ? `• ${partnerProfile.fitReasons[0]}` : ""}
        </div>
      )}
      {!partnerProfile?.fitReasons?.[0] && (
        <div className="mb-3 text-xs text-gray-500">
          {tradeIntent.detail}
        </div>
      )}
      {((partnerProfile?.repeatedPlayers?.length ?? 0) > 0 || (partnerProfile?.acquiredPlayers?.length ?? 0) > 0 || partnerProfile?.tradePreferenceLabel) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {partnerProfile?.tradePreferenceLabel && (
            <span className="rounded-full border border-amber-800 bg-amber-950/20 px-2 py-0.5 text-[10px] text-amber-200">
              {partnerProfile.tradePreferenceLabel}
            </span>
          )}
          {(partnerProfile?.repeatedPlayers || []).slice(0, 2).map((player) => (
            <span key={player.playerId} className="rounded-full border border-cyan-800 bg-cyan-950/30 px-2 py-0.5 text-[10px] text-cyan-200">
              Likes {player.name}
            </span>
          ))}
          {(partnerProfile?.acquiredPlayers || []).slice(0, 1).map((player) => (
            <span key={`recent-${player.playerId}`} className="rounded-full border border-emerald-800 bg-emerald-950/30 px-2 py-0.5 text-[10px] text-emerald-200">
              Recently Bought {player.name}
            </span>
          ))}
        </div>
      )}
      {/* Position ranks before → after trade, both teams */}
      {(() => {
        const myRosterId  = myRoster?.roster_id ?? 0;
        const oppRosterId = Number(trade.oppRosterId);
        if (!myRosterId || !oppRosterId) return null;
        const positions = ["QB", "RB", "WR", "TE"] as const;

        const delta: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
        trade.give.forEach((p) => { if (delta[p.position] !== undefined) delta[p.position] -= p.value; });
        trade.receive.forEach((p) => { if (delta[p.position] !== undefined) delta[p.position] += p.value; });

        const myBase  = posTeamTotals.find((t) => t.rosterId === myRosterId)?.totals  ?? {};
        const oppBase = posTeamTotals.find((t) => t.rosterId === oppRosterId)?.totals ?? {};

        const rankColor = (rank: number) => {
          if (rank <= 3) return "text-green-400";
          if (rank >= numTeams - 2) return "text-red-400";
          return "text-gray-400";
        };

        const rows = positions.map((pos) => {
          const myBefore  = computePosRank(pos, myRosterId);
          const myAfter   = computePosRank(pos, myRosterId,  (myBase[pos]  ?? 0) + delta[pos]);
          const oppBefore = computePosRank(pos, oppRosterId);
          const oppAfter  = computePosRank(pos, oppRosterId, (oppBase[pos] ?? 0) - delta[pos]);
          const myChanged  = myBefore  !== myAfter;
          const oppChanged = oppBefore !== oppAfter;
          if (!myChanged && !oppChanged) return null;
          const arrow = (before: number, after: number) =>
            before > after ? <span className="text-green-400">&#8679;</span>
            : before < after ? <span className="text-red-400">&#8681;</span>
            : null;
          return (
            <div key={pos} className="flex items-center gap-3 text-[9px]">
              <span className="text-gray-500 w-6">{pos}</span>
              <span className="text-gray-600 w-8 shrink-0">You:</span>
              <span className={`font-mono ${rankColor(myBefore)}`}>#{myBefore}</span>
              <span className="text-gray-600">&#8594;</span>
              <span className={`font-mono ${rankColor(myAfter)}`}>#{myAfter}</span>
              {arrow(myBefore, myAfter)}
              <span className="text-gray-700 mx-1">|</span>
              <span className="text-gray-600 w-10 shrink-0">Them:</span>
              <span className={`font-mono ${rankColor(oppBefore)}`}>#{oppBefore}</span>
              <span className="text-gray-600">&#8594;</span>
              <span className={`font-mono ${rankColor(oppAfter)}`}>#{oppAfter}</span>
              {arrow(oppBefore, oppAfter)}
            </div>
          );
        }).filter(Boolean);

        if (rows.length === 0) return null;
        return (
          <div className="mb-3 bg-gray-800/50 rounded-lg px-3 py-2 space-y-0.5">
            {rows}
          </div>
        );
      })()}
      {/* Trade columns */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-1.5">You Give</div>
          <div className="space-y-1">
            {trade.give.map((p) => {
              const playerTag = leaguePlayerTags[cardLeagueId]?.[p.player_id];
              const isSweetener = p.player_id === trade.sweetenerPlayerId;
              return (
                <div key={p.player_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button onClick={() => onSetPlayerProfileId(p.player_id)} className="text-xs text-white hover:text-blue-400 transition truncate text-left">{p.full_name}</button>
                    <span className="text-[10px] text-gray-500 shrink-0">{p.position}{p.team ? ` · ${p.team}` : ""}</span>
                    {isSweetener && (
                      <span title="Goodwill sweetener — this owner rosters this player on their other dynasty teams. Not counted in the value totals." className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-pink-700 bg-pink-950/40 text-pink-300 shrink-0">Sweetener &#127873;</span>
                    )}
                    {playerTag === "CORE" && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-emerald-700 bg-emerald-950/40 text-emerald-300 shrink-0">Core</span>
                    )}
                    {playerTag === "WANT_TO_TRADE" && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-orange-700 bg-orange-950/40 text-orange-300 shrink-0">Shopping</span>
                    )}
                    {marketSignalMap.get(p.player_id) === "SELL_HIGH" && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-amber-600 bg-amber-950/40 text-amber-300 shrink-0">Sell High &#8679;</span>
                    )}
                    {marketSignalMap.get(p.player_id) === "LIQUID" && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-sky-700 bg-sky-950/40 text-sky-300 shrink-0">Active</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-1">
                    {p.age && <span className="text-[10px] text-gray-500">Age {p.age}</span>}
                    <span className={`text-xs font-mono ${isSweetener ? "text-gray-600 line-through" : "text-gray-400"}`}>{p.value.toLocaleString()}</span>
                    <button
                      title={playerTag === "CORE" ? "Remove Core tag" : "Tag as Core (Do Not Sell)"}
                      onClick={() => onToggleLeaguePlayerTag(cardLeagueId, p.player_id, "CORE")}
                      className={`text-[11px] leading-none px-1 py-0.5 rounded transition ${playerTag === "CORE" ? "text-emerald-300 hover:text-gray-400" : "text-gray-600 hover:text-emerald-400"}`}
                    >
                      &#128274;
                    </button>
                    <button
                      title={playerTag === "WANT_TO_TRADE" ? "Remove Shopping tag" : "Tag as Shopping (Want to Trade)"}
                      onClick={() => onToggleLeaguePlayerTag(cardLeagueId, p.player_id, "WANT_TO_TRADE")}
                      className={`text-[11px] leading-none px-1 py-0.5 rounded transition ${playerTag === "WANT_TO_TRADE" ? "text-orange-300 hover:text-gray-400" : "text-gray-600 hover:text-orange-400"}`}
                    >
                      &#128276;
                    </button>
                  </div>
                </div>
              );
            })}
            {trade.givePicks.map((p) => (
              <div key={finderPickKey(p)} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs text-white truncate">{finderPickLabel(p)}</span>
                  <span className="text-[10px] text-gray-500 shrink-0">PICK</span>
                </div>
                <span className="text-xs text-gray-400 font-mono shrink-0 ml-1">{p.value.toLocaleString()}</span>
              </div>
            ))}
            {cardMyDropCost > 0 && (
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[10px] text-amber-500 italic">Your Drop Cost</span>
                <span className="text-[10px] text-amber-400 font-mono">+{cardMyDropCost.toLocaleString()}</span>
              </div>
            )}
            {cardStarOnGive < 0 && (
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[10px] text-violet-400 italic">Star Discount</span>
                <span className="text-[10px] text-violet-400 font-mono">{cardStarOnGive.toLocaleString()}</span>
              </div>
            )}
            <div className="text-[10px] text-gray-600 text-right pr-1">Total: {giveTotalAdj.toLocaleString()}</div>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-green-400 mb-1.5">You Receive</div>
          <div className="space-y-1">
            {trade.receive.map((p) => (
              <div key={p.player_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button onClick={() => onSetPlayerProfileId(p.player_id)} className="text-xs text-white hover:text-blue-400 transition truncate text-left">{p.full_name}</button>
                  <span className="text-[10px] text-gray-500 shrink-0">{p.position}{p.team ? ` · ${p.team}` : ""}</span>
                  {marketSignalMap.get(p.player_id) === "BUY_LOW" && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-green-700 bg-green-950/40 text-green-300 shrink-0">Buy Low &#8681;</span>
                  )}
                  {marketSignalMap.get(p.player_id) === "LIQUID" && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-sky-700 bg-sky-950/40 text-sky-300 shrink-0">Active</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-1">
                  {p.age && <span className="text-[10px] text-gray-500">Age {p.age}</span>}
                  <span className="text-xs text-gray-400 font-mono">{p.value.toLocaleString()}</span>
                </div>
              </div>
            ))}
            {trade.receivePicks.map((p) => (
              <div key={finderPickKey(p)} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs text-white truncate">{finderPickLabel(p)}</span>
                  <span className="text-[10px] text-gray-500 shrink-0">PICK</span>
                </div>
                <span className="text-xs text-gray-400 font-mono shrink-0 ml-1">{p.value.toLocaleString()}</span>
              </div>
            ))}
            {cardOppDropCost > 0 && (
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[10px] text-amber-500 italic">Their Drop Cost</span>
                <span className="text-[10px] text-amber-400 font-mono">+{cardOppDropCost.toLocaleString()}</span>
              </div>
            )}
            {cardStarOnReceive < 0 && (
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[10px] text-violet-400 italic">Star Discount</span>
                <span className="text-[10px] text-violet-400 font-mono">{cardStarOnReceive.toLocaleString()}</span>
              </div>
            )}
            <div className="text-[10px] text-gray-600 text-right pr-1">Total: {receiveTotalAdj.toLocaleString()}</div>
          </div>
        </div>
      </div>
      {/* Trade Reasoning expander */}
      {scoreFactors.length > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-[11px] text-gray-500 hover:text-gray-300 transition list-none flex items-center gap-1 select-none">
            <span className="group-open:rotate-90 inline-block transition-transform">&#9656;</span>
            Why this trade?
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {scoreFactors.map((f) => (
              <span
                key={f.label}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                  f.positive
                    ? "border-green-800 bg-green-950/30 text-green-300"
                    : "border-red-800 bg-red-950/30 text-red-300"
                }`}
              >
                {f.positive ? "+" : "−"} {f.label}
              </span>
            ))}
          </div>
        </details>
      )}

      {/* Actions row */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onOpenInCalculator(trade)}
          className="flex-1 text-xs text-gray-500 hover:text-blue-400 border border-gray-700 hover:border-blue-500 rounded-lg py-1.5 transition"
        >
          Open in Calculator &#8594;
        </button>
        {leagueId !== null && (() => {
          const fp = buildTradeFingerprint(
            leagueId,
            trade.oppRosterId,
            [...trade.give.map((p) => p.player_id), ...trade.givePicks.map((p) => finderPickKey(p))],
            [...trade.receive.map((p) => p.player_id), ...trade.receivePicks.map((p) => finderPickKey(p))],
          );
          const alreadyMarked = sessionMarked.has(fp);
          return (
            <button
              disabled={alreadyMarked}
              onClick={async () => {
                await onMarkAttempted({
                  league_id: leagueId,
                  partner_roster_id: trade.oppRosterId,
                  partner_name: trade.oppName,
                  give_players: trade.give.map((p) => ({ player_id: p.player_id, name: p.full_name, position: p.position, value: p.value }) as TradeAttemptAsset),
                  give_picks: trade.givePicks.map((p) => ({ key: finderPickKey(p), label: finderPickLabel(p), value: p.value }) as TradeAttemptPick),
                  receive_players: trade.receive.map((p) => ({ player_id: p.player_id, name: p.full_name, position: p.position, value: p.value }) as TradeAttemptAsset),
                  receive_picks: trade.receivePicks.map((p) => ({ key: finderPickKey(p), label: finderPickLabel(p), value: p.value }) as TradeAttemptPick),
                  source: "FINDER",
                  initiated_by: "ME",
                  status: "PENDING",
                  counter_details: null,
                });
                onSessionMark(fp);
              }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition shrink-0 ${alreadyMarked ? "border-green-700 text-green-400 cursor-default" : "border-orange-700 text-orange-400 hover:border-orange-500"}`}
            >
              {alreadyMarked ? "✓ Offered" : "I Sent This"}
            </button>
          );
        })()}
      </div>
    </div>
  );
}
