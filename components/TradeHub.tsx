"use client";
import React, { useState } from "react";
import {
  getStoredPickValue,
  getLeagueDirectionBucket,
  average,
  sum,
  CURRENT_YEAR,
  formatRelativeDate,
} from "../lib/helpers";
import type { TradeAttempt, TradeAttemptStatus, TradeAttemptAsset, TradeAttemptPick } from "../lib/types";
import { usePlayers } from "../lib/PlayersContext";

const BASE_YEAR_TH = new Date().getFullYear();
const YEARS = Array.from({ length: 3 }, (_, index) => String(BASE_YEAR_TH + index));

// ── Props ──────────────────────────────────────────────────────────────────
interface TradeHubProps {
  // Tab state
  tradeHubSection: "CALCULATOR" | "FINDER" | "RECOMMENDATIONS" | "TRADE_LOG" | "ATTEMPTS";
  setTradeHubSection: (section: "CALCULATOR" | "FINDER" | "RECOMMENDATIONS" | "TRADE_LOG" | "ATTEMPTS") => void;

  // League / roster state
  leagues: any[];
  user: any;
  rosters: any[];
  users: Record<string, any>;
  selectedLeague: any;
  allPicks: any[];
  pickFcValues: Record<string, number>;
  calcFcValues: Record<string, number>;
  redraftValues: Record<string, number>;
  selectedLeagueDynamicPickValues: Record<string, any>;

  // Computed direction / sim
  selectedLeagueDirection: any;
  selectedLeagueDirectionAdjusted: any;
  selectedLeagueSimulation: any;

  // Trade calculator state
  calcOpponentRosterId: number | null;
  setCalcOpponentRosterId: (id: number | null) => void;
  calcGive: string[];
  setCalcGive: React.Dispatch<React.SetStateAction<string[]>>;
  calcReceive: string[];
  setCalcReceive: React.Dispatch<React.SetStateAction<string[]>>;
  calcGivePicks: string[];
  setCalcGivePicks: React.Dispatch<React.SetStateAction<string[]>>;
  calcReceivePicks: string[];
  setCalcReceivePicks: React.Dispatch<React.SetStateAction<string[]>>;

  // Trade finder state
  finderSeed: number;
  setFinderSeed: React.Dispatch<React.SetStateAction<number>>;
  finderPlayerSearch: string;
  setFinderPlayerSearch: (s: string) => void;
  finderPinnedPlayerId: string | null;
  setFinderPinnedPlayerId: (id: string | null) => void;
  finderTargetOppRosterId: number | null;
  setFinderTargetOppRosterId: (id: number | null) => void;
  finderTargetPlayerSearch: string;
  setFinderTargetPlayerSearch: (s: string) => void;
  finderTargetPlayerId: string | null;
  setFinderTargetPlayerId: (id: string | null) => void;

  // Draft state
  selectedLeagueDraftHasOccurred: boolean;

  // Additional state
  loadingCalcValues: boolean;
  calcSearchA: string;
  setCalcSearchA: (s: string) => void;
  calcSearchB: string;
  setCalcSearchB: (s: string) => void;
  playerDispositions: Record<string, { sell: string; buy: string }>;
  finderDraftCapitalMode: boolean;
  setFinderDraftCapitalMode: React.Dispatch<React.SetStateAction<boolean>>;

  // Computed
  leagueMateProfileByRosterId: Map<number, any>;
  selectedLeagueMateProfilesView: any[];
  tradeRecommendationCards: any[];
  tradePartnerRankings: any[];

  // Functions
  setPlayerProfileId: (id: string | null) => void;
  loadUserExposure: (ownerId: string) => void;
  loadUserTrades: (ownerId: string) => void;

  // Value trends
  historicalSnapshot: { players: Record<string, any>; recorded_at: string } | null;

  // Trade log
  tradeHubData: any[] | null;
  loadingTradeHub: boolean;
  tradeHubUserId: string | null;

  // Trade attempts
  tradeAttempts: TradeAttempt[];
  loadingTradeAttempts: boolean;
  tradeAttemptsLeagueId: string | null;
  onMarkAttempted: (attempt: Omit<TradeAttempt, "id" | "user_id" | "attempted_at" | "resolved_at">) => Promise<void>;
  onUpdateAttemptStatus: (id: string, status: TradeAttemptStatus, counterDetails?: string) => Promise<void>;
  onDeleteAttempt: (id: string) => Promise<void>;
  onLoadTradeAttempts: (leagueId: string) => Promise<void>;
  onRefreshDirection: () => void;
  buyLowPlayerIds: string[];
  ignoredOwnerIds: string[];
  toggleIgnoredOwner: (ownerId: string) => void;

  // NFL season timing — optional, gracefully unused during off-season
  nflState?: { week: number; season_type: string; season: string; display_week?: number } | null;
  // Per-player rolling usage stats (targets, carries, snap%) — optional, available in-season only
  playerStats?: Record<string, { avgTargets: number; avgCarries: number; snapPct: number; gamesPlayed: number; recentTargets?: number; recentCarries?: number; recentSnapPct?: number; targetTrend?: number; carryTrend?: number; snapTrend?: number }> | null;
  // Cross-league ownership: player_id → { count: number } — from allLeagueData shares map
  crossLeagueExposure?: Record<string, { count: number }> | null;
}

// ── Component ──────────────────────────────────────────────────────────────
function TradeHub({
  tradeHubSection, setTradeHubSection,
  leagues, user, rosters, users, selectedLeague, allPicks,
  pickFcValues, calcFcValues, redraftValues, selectedLeagueDynamicPickValues,
  selectedLeagueDirection, selectedLeagueDirectionAdjusted, selectedLeagueSimulation,
  calcOpponentRosterId, setCalcOpponentRosterId,
  calcGive, setCalcGive, calcReceive, setCalcReceive,
  calcGivePicks, setCalcGivePicks, calcReceivePicks, setCalcReceivePicks,
  finderSeed, setFinderSeed, finderPlayerSearch, setFinderPlayerSearch,
  finderPinnedPlayerId, setFinderPinnedPlayerId,
  finderTargetOppRosterId, setFinderTargetOppRosterId,
  finderTargetPlayerSearch, setFinderTargetPlayerSearch,
  finderTargetPlayerId, setFinderTargetPlayerId,
  selectedLeagueDraftHasOccurred,
  loadingCalcValues, calcSearchA, setCalcSearchA, calcSearchB, setCalcSearchB,
  playerDispositions, finderDraftCapitalMode, setFinderDraftCapitalMode,
  leagueMateProfileByRosterId, selectedLeagueMateProfilesView,
  tradeRecommendationCards, tradePartnerRankings,
  setPlayerProfileId, loadUserExposure, loadUserTrades,
  historicalSnapshot,
  tradeHubData, loadingTradeHub, tradeHubUserId,
  tradeAttempts, loadingTradeAttempts, tradeAttemptsLeagueId,
  onMarkAttempted, onUpdateAttemptStatus, onDeleteAttempt, onLoadTradeAttempts,
  onRefreshDirection,
  buyLowPlayerIds,
  ignoredOwnerIds, toggleIgnoredOwner,
  nflState,
  playerStats,
  crossLeagueExposure,
}: TradeHubProps) {
  const players = usePlayers();
  // Local UI state for the Attempts tab
  const [counterInputs, setCounterInputs] = useState<Record<string, string>>({});
  const [showCounterInput, setShowCounterInput] = useState<string | null>(null);
  // Fingerprints of trades marked this session (so the button turns into a checkmark immediately)
  const [sessionMarked, setSessionMarked] = useState<Set<string>>(new Set());
  // IDs auto-marked this session to avoid repeat async calls on re-renders
  const autoMarkedRef = React.useRef<Set<string>>(new Set());
  // Auto-mark stale PENDING attempts (>2 days old, ME-initiated) as NO_RESPONSE
  React.useEffect(() => {
    const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
    const stale = tradeAttempts.filter(
      (a) =>
        a.status === "PENDING" &&
        a.initiated_by === "ME" &&
        Date.now() - new Date(a.attempted_at).getTime() > TWO_DAYS &&
        !autoMarkedRef.current.has(a.id)
    );
    if (stale.length === 0) return;
    stale.forEach((a) => {
      autoMarkedRef.current.add(a.id);
      onUpdateAttemptStatus(a.id, "NO_RESPONSE");
    });
  }, [tradeAttempts, onUpdateAttemptStatus]);
  // Direction refresh state
  const [directionRefreshing, setDirectionRefreshing] = useState(false);
  // Tier Down mode: filter finder to trades where you trade down at a position and collect adders
  const [finderTierDownPos, setFinderTierDownPos] = useState<"QB" | "RB" | "WR" | "TE" | null>(null);
  // Tank Mode: removes user-side restrictions (QB minimums, package limits, direction guardrail)
  const [finderTankMode, setFinderTankMode] = useState(false);
  // Prefer Future Picks: in Draft Capital Mode, surface picks from future years first
  const [finderPreferFuturePicks, setFinderPreferFuturePicks] = useState(false);
  // Attempted Trades owner search
  const [attemptsOwnerSearch, setAttemptsOwnerSearch] = useState("");
  // Session set of trade transaction IDs logged from the Trade Log tab
  const [tradeLogLogged, setTradeLogLogged] = useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (directionRefreshing && selectedLeagueDirectionAdjusted) setDirectionRefreshing(false);
  }, [directionRefreshing, selectedLeagueDirectionAdjusted]);

  const buildTradeFingerprint = (leagueId: string, partnerRosterId: number | string, givePids: string[], receiveIds: string[]) =>
    `${leagueId}|${partnerRosterId}|${[...givePids].sort().join(",")}|${[...receiveIds].sort().join(",")}`;

  return (
    <>
  <div className="max-w-4xl mx-auto p-6">

    {/* Sub-tab nav */}
    <div className="flex justify-center border-b border-gray-700 mb-6 overflow-x-auto">
      <div className="flex justify-center gap-6 text-center">
      <button
        onClick={() => setTradeHubSection("CALCULATOR")}
        className={`pb-2 px-1 text-sm font-semibold transition ${
          tradeHubSection === "CALCULATOR"
            ? "border-b-2 border-blue-400 text-blue-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        Trade Calculator
      </button>
      <button
        onClick={() => setTradeHubSection("FINDER")}
        className={`pb-2 px-1 text-sm font-semibold transition ${
          tradeHubSection === "FINDER"
            ? "border-b-2 border-blue-400 text-blue-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        Trade Finder
      </button>
      <button
        onClick={() => {
          if (user?.user_id && tradeHubUserId !== user.user_id) {
            loadUserTrades(user.user_id);
          }
          setTradeHubSection("TRADE_LOG");
        }}
        className={`pb-2 px-1 text-sm font-semibold transition ${
          tradeHubSection === "TRADE_LOG"
            ? "border-b-2 border-blue-400 text-blue-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        Trade Log
      </button>
      <button
        onClick={() => {
          if (selectedLeague?.league_id && tradeAttemptsLeagueId !== selectedLeague.league_id) {
            onLoadTradeAttempts(selectedLeague.league_id);
          }
          setTradeHubSection("ATTEMPTS");
        }}
        className={`pb-2 px-1 text-sm font-semibold transition whitespace-nowrap ${
          tradeHubSection === "ATTEMPTS"
            ? "border-b-2 border-orange-400 text-orange-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        Attempted Trades
        {tradeAttempts.filter(a => a.league_id === selectedLeague?.league_id && a.status === "PENDING").length > 0 && (
          <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-[9px] font-bold">
            {tradeAttempts.filter(a => a.league_id === selectedLeague?.league_id && a.status === "PENDING").length}
          </span>
        )}
      </button>
      </div>
    </div>

    {/* ── Trade Calculator ── */}
    {tradeHubSection === "CALCULATOR" && (() => {
      const rosterToUser: Record<number, string> = {};
      rosters.forEach((r: any) => { rosterToUser[r.roster_id] = r.owner_id; });

      const myRoster = rosters.find((r: any) => r.owner_id === user?.user_id);
      const opponentRoster = calcOpponentRosterId != null
        ? rosters.find((r: any) => r.roster_id === calcOpponentRosterId)
        : null;

      // League-specific value lookup (falls back to generic if not yet loaded)
      const calcVal = (id: string) =>
        calcFcValues[id] ?? (players as any)[id]?.value ?? 0;

      // Player lists (excluding already-traded items), sorted by league-specific value
      const myAvailPlayers = (myRoster?.players || [] as string[])
        .map((id: string) => (players as any)[id])
        .filter((p: any) => p && ["QB","RB","WR","TE"].includes(p.position))
        .sort((a: any, b: any) => calcVal(b.player_id) - calcVal(a.player_id))
        .filter((p: any) => !calcGive.includes(p.player_id));

      const theirAvailPlayers = (opponentRoster?.players || [] as string[])
        .map((id: string) => (players as any)[id])
        .filter((p: any) => p && ["QB","RB","WR","TE"].includes(p.position))
        .sort((a: any, b: any) => calcVal(b.player_id) - calcVal(a.player_id))
        .filter((p: any) => !calcReceive.includes(p.player_id));

      // Pick lists (excluding already-added picks)
      const pickKey = (p: any) => `${p.season}-${p.round}-${p.roster_id}`;
      const myAvailPicks = (allPicks as any[]).filter(
        (p: any) => p.owner_id === myRoster?.roster_id && !calcGivePicks.includes(pickKey(p))
      );
      const theirAvailPicks = (allPicks as any[]).filter(
        (p: any) => p.owner_id === opponentRoster?.roster_id && !calcReceivePicks.includes(pickKey(p))
      );
      const pickInsight = (pick: any) => selectedLeagueDynamicPickValues[pickKey(pick)];

      const getPickValue = (key: string) => {
        const pick = (allPicks as any[]).find((p: any) => pickKey(p) === key);
        if (!pick) return 0;
        return pickInsight(pick)?.expectedValue ?? getStoredPickValue(pickFcValues, pick);
      };
      const pickLabel = (p: any) => {
        const origOwnerUserId = rosterToUser[p.roster_id];
        const origName = (users as any)[origOwnerUserId] || `Team ${p.roster_id}`;
        const via = p.roster_id !== p.owner_id ? ` (via ${origName})` : "";
        const dynamic = pickInsight(p);
        // For current year, slot is "1.04" format; for future years slot is just the round number
        const slotLabel = p.slot && p.slot.includes(".")
          ? `${p.season} ${p.slot}`
          : `${p.season} Rd ${p.round}`;
        return `${slotLabel}${via}${dynamic ? ` • ${dynamic.label}` : ""}`;
      };

      // Trade totals using league-specific values
      const totalGive =
        calcGive.reduce((s: number, id: string) => s + calcVal(id), 0) +
        calcGivePicks.reduce((s: number, k: string) => s + getPickValue(k), 0);
      const totalReceive =
        calcReceive.reduce((s: number, id: string) => s + calcVal(id), 0) +
        calcReceivePicks.reduce((s: number, k: string) => s + getPickValue(k), 0);

      // Waiver adjustment — when one side has more assets, the side with fewer gets
      // a waiver credit equal to each extra asset's value × 0.42 (FantasyCalc approximation)
      const giveAssets = [
        ...calcGive.map((id: string) => calcVal(id)),
        ...calcGivePicks.map((k: string) => getPickValue(k)),
      ].sort((a, b) => b - a);
      const receiveAssets = [
        ...calcReceive.map((id: string) => calcVal(id)),
        ...calcReceivePicks.map((k: string) => getPickValue(k)),
      ].sort((a, b) => b - a);
      const assetDiff = giveAssets.length - receiveAssets.length;
      let waiverAdj = 0;
      let waiverAdjSide: "give" | "receive" | null = null;
      // No waiver adjustment if either side is completely empty
      const calcWaiverAdj = (extras: number[]) =>
        extras.reduce((sum, val, i) => {
          const cap = i === 0 ? 550 : 750;
          return sum + Math.min(Math.round(val * 0.42), cap);
        }, 0);
      if (assetDiff > 0 && receiveAssets.length > 0) {
        waiverAdj = calcWaiverAdj(giveAssets.slice(receiveAssets.length));
        waiverAdjSide = "receive";
      } else if (assetDiff < 0 && giveAssets.length > 0) {
        waiverAdj = calcWaiverAdj(receiveAssets.slice(giveAssets.length));
        waiverAdjSide = "give";
      }

      const totalGiveAdj = totalGive + (waiverAdjSide === "give" ? waiverAdj : 0);
      const totalReceiveAdj = totalReceive + (waiverAdjSide === "receive" ? waiverAdj : 0);

      const net = totalReceiveAdj - totalGiveAdj;
      const verdict = Math.abs(net) <= 300 ? "EVEN" : net > 0 ? "YOU WIN" : "YOU LOSE";
      const verdictColor = verdict === "EVEN" ? "text-yellow-400" : verdict === "YOU WIN" ? "text-green-400" : "text-red-400";

      const filterPlayers = (list: any[], search: string) =>
        search.trim().length >= 1
          ? list.filter((p: any) => p.full_name?.toLowerCase().includes(search.toLowerCase()))
          : list;

      // Asset row component (inline) — playerId optional to enable profile panel
      const assetRow = (label: string, value: number, onAdd: () => void, playerId?: string) => (
        <div
          key={label}
          className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
        >
          <button onClick={onAdd} className="flex-1 text-sm truncate text-left">{label}</button>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-xs text-blue-300 font-mono">{value > 0 ? value.toLocaleString() : "—"}</span>
            {playerId && (
              <button
                onClick={(e) => { e.stopPropagation(); setPlayerProfileId(playerId); }}
                className="text-gray-600 hover:text-blue-400 text-xs transition"
                title="View profile"
              >ⓘ</button>
            )}
          </div>
        </div>
      );

      // Trade item row (inline)
      const tradeRow = (label: string, value: number, onRemove: () => void) => (
        <div key={label} className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
          <span className="text-sm truncate">{label}</span>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-xs text-blue-300 font-mono">{value > 0 ? value.toLocaleString() : "—"}</span>
            <button onClick={onRemove} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
          </div>
        </div>
      );

      if (!selectedLeague) {
        return <p className="text-gray-400 text-sm">Select a league from the dropdown above to use the Trade Calculator.</p>;
      }

      return (
        <div>
          <p className="text-xs text-gray-500 mb-2">
            Powered by FantasyCalc — values calibrated for <strong className="text-gray-300">{selectedLeague.name}</strong>.
            {loadingCalcValues && <span className="ml-2 text-blue-400">Loading values…</span>}
          </p>

          {/* Opponent picker */}
          <div className="mb-6">
            <label className="text-xs text-gray-400 mb-1 block">Trade with</label>
            <div className="flex flex-col md:flex-row gap-3">
              <select
                value={calcOpponentRosterId ?? ""}
                onChange={(e) => {
                  setCalcOpponentRosterId(e.target.value ? Number(e.target.value) : null);
                  setCalcReceive([]);
                  setCalcReceivePicks([]);
                  setCalcSearchB("");
                }}
                className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 w-full md:w-64"
              >
                <option value="">Select opponent...</option>
                {rosters
                  .filter((r: any) => r.owner_id !== user?.user_id)
                  .map((r: any) => {
                    const isIgnored = ignoredOwnerIds.includes(r.owner_id);
                    return (
                      <option key={r.roster_id} value={r.roster_id}>
                        {isIgnored ? "🚫 " : ""}{(users as any)[r.owner_id] || `Team ${r.roster_id}`}{isIgnored ? " (Ignored)" : ""}
                      </option>
                    );
                  })}
              </select>

          {opponentRoster && (
            <>
              <button
                onClick={() => loadUserExposure(opponentRoster.owner_id)}
                className="bg-gray-800 border border-gray-700 hover:border-blue-500 text-white rounded-xl px-3 py-2 text-sm font-medium transition whitespace-nowrap"
              >
                Most Owned Players
              </button>

              <button
                onClick={() => loadUserTrades(opponentRoster.owner_id)}
                className="bg-gray-800 border border-gray-700 hover:border-blue-500 text-white rounded-xl px-3 py-2 text-sm font-medium transition whitespace-nowrap"
              >
                Recent Trades
              </button>

              <button
                onClick={() => toggleIgnoredOwner(opponentRoster.owner_id)}
                className={`rounded-xl px-3 py-2 text-sm font-medium border transition whitespace-nowrap ${
                  ignoredOwnerIds.includes(opponentRoster.owner_id)
                    ? "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300"
                }`}
              >
                {ignoredOwnerIds.includes(opponentRoster.owner_id) ? "Remove Ignore" : "Ignore Owner"}
              </button>
            </>
          )}
            </div>

            {/* Ignored owner warning banner */}
            {opponentRoster && ignoredOwnerIds.includes(opponentRoster.owner_id) && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2.5">
                <span className="text-gray-500 text-sm leading-none mt-0.5">🚫</span>
                <div>
                  <p className="text-sm font-medium text-gray-400">
                    {(users as any)[opponentRoster.owner_id] || "This owner"} is on your ignore list
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Excluded from Trade Finder and Recommendations. Click "Remove Ignore" above to re-enable.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Two-column asset panels */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* Your assets */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
                Your Assets — {(users as any)[user?.user_id] || "You"}
              </div>
              <input
                type="text"
                value={calcSearchA}
                onChange={(e) => setCalcSearchA(e.target.value)}
                placeholder="Filter players..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs mb-3 focus:outline-none focus:border-blue-500"
              />
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {(() => {
                  const items = [
                    ...filterPlayers(myAvailPlayers, calcSearchA).map((p: any) => ({
                      label: `${p.full_name} (${p.position} · ${p.team})`,
                      value: calcVal(p.player_id),
                      playerId: p.player_id as string | undefined,
                      onAdd: () => setCalcGive((prev: string[]) => [...prev, p.player_id]),
                    })),
                    ...(calcSearchA.trim().length === 0 ? myAvailPicks.map((p: any) => ({
                      label: pickLabel(p),
                      value: pickInsight(p)?.expectedValue ?? getStoredPickValue(pickFcValues, p),
                      playerId: undefined as string | undefined,
                      onAdd: () => setCalcGivePicks((prev: string[]) => [...prev, pickKey(p)]),
                    })) : []),
                  ].sort((a, b) => b.value - a.value);
                  if (items.length === 0) return <p className="text-xs text-gray-600">No assets available</p>;
                  return items.map((item) => assetRow(item.label, item.value, item.onAdd, item.playerId));
                })()}
              </div>
            </div>

            {/* Their assets */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
                {opponentRoster
                  ? `${(users as any)[opponentRoster.owner_id] || "Opponent"}'s Assets`
                  : "Their Assets"}
              </div>
              <input
                type="text"
                value={calcSearchB}
                onChange={(e) => setCalcSearchB(e.target.value)}
                placeholder={opponentRoster ? "Filter players..." : "Search any player to find their team..."}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs mb-3 focus:outline-none focus:border-blue-500"
              />
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {!opponentRoster ? (() => {
                  const q = calcSearchB.trim().toLowerCase();
                  if (q.length < 1) return (
                    <p className="text-xs text-gray-600">Search a player name above or select an opponent from the dropdown</p>
                  );
                  const allRosterPlayers = rosters
                    .filter((r: any) => r.owner_id !== user?.user_id)
                    .flatMap((r: any) =>
                      (r.players || []).map((id: string) => {
                        const p = (players as any)[id];
                        return p ? { ...p, _rosterId: r.roster_id } : null;
                      })
                    )
                    .filter((p: any) =>
                      p &&
                      ["QB","RB","WR","TE"].includes(p.position) &&
                      p.full_name?.toLowerCase().includes(q) &&
                      !calcReceive.includes(p.player_id)
                    )
                    .sort((a: any, b: any) => calcVal(b.player_id) - calcVal(a.player_id));
                  if (allRosterPlayers.length === 0) return (
                    <p className="text-xs text-gray-600">No player found — try a different name</p>
                  );
                  return allRosterPlayers.map((p: any) =>
                    assetRow(`${p.full_name} (${p.position} · ${p.team})`, calcVal(p.player_id), () => {
                      setCalcOpponentRosterId(p._rosterId);
                      setCalcReceive((prev) => [...prev, p.player_id]);
                    }, p.player_id)
                  );
                })() : (() => {
                    const items = [
                      ...filterPlayers(theirAvailPlayers, calcSearchB).map((p: any) => ({
                        label: `${p.full_name} (${p.position} · ${p.team})`,
                        value: calcVal(p.player_id),
                        playerId: p.player_id as string | undefined,
                        onAdd: () => setCalcReceive((prev: string[]) => [...prev, p.player_id]),
                      })),
                      ...(calcSearchB.trim().length === 0 ? theirAvailPicks.map((p: any) => ({
                        label: pickLabel(p),
                        value: pickInsight(p)?.expectedValue ?? getStoredPickValue(pickFcValues, p),
                        playerId: undefined as string | undefined,
                        onAdd: () => setCalcReceivePicks((prev: string[]) => [...prev, pickKey(p)]),
                      })) : []),
                    ].sort((a, b) => b.value - a.value);
                    if (items.length === 0) return <p className="text-xs text-gray-600">No assets available</p>;
                    return items.map((item) => assetRow(item.label, item.value, item.onAdd, item.playerId));
                  })()
                }
              </div>
            </div>
          </div>

          {/* Trade summary */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="grid grid-cols-2 gap-6">
              {/* You Give */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-red-400 mb-2">You Give</div>
                <div className="space-y-1 min-h-[48px]">
                  {calcGive.length === 0 && calcGivePicks.length === 0 && (
                    <p className="text-xs text-gray-600">Click assets above to add</p>
                  )}
                  {calcGive.map((id: string) => {
                    const p = (players as any)[id];
                    return tradeRow(
                      `${p?.full_name ?? id} (${p?.position})`,
                      calcVal(id),
                      () => setCalcGive((prev) => prev.filter((x) => x !== id))
                    );
                  })}
                  {calcGivePicks.map((k: string) => {
                    const pick = (allPicks as any[]).find((p: any) => pickKey(p) === k);
                    const label = pick ? pickLabel(pick) : k;
                    return tradeRow(label, getPickValue(k),
                      () => setCalcGivePicks((prev) => prev.filter((x) => x !== k)));
                  })}
                </div>
                {waiverAdjSide === "give" && waiverAdj > 0 && (
                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
                    <span className="text-xs text-gray-400 italic">Waiver Adjustment</span>
                    <span className="text-xs text-blue-300 font-mono">+{waiverAdj.toLocaleString()}</span>
                  </div>
                )}
                <div className="mt-3 pt-2 border-t border-gray-700 flex justify-between items-center">
                  <span className="text-xs text-gray-500">Total</span>
                  <span className="text-base font-bold text-red-400">{totalGiveAdj.toLocaleString()}</span>
                </div>
              </div>

              {/* You Receive */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-green-400 mb-2">You Receive</div>
                <div className="space-y-1 min-h-[48px]">
                  {calcReceive.length === 0 && calcReceivePicks.length === 0 && (
                    <p className="text-xs text-gray-600">Click assets above to add</p>
                  )}
                  {calcReceive.map((id: string) => {
                    const p = (players as any)[id];
                    return tradeRow(
                      `${p?.full_name ?? id} (${p?.position})`,
                      calcVal(id),
                      () => setCalcReceive((prev) => prev.filter((x) => x !== id))
                    );
                  })}
                  {calcReceivePicks.map((k: string) => {
                    const pick = (allPicks as any[]).find((p: any) => pickKey(p) === k);
                    const label = pick ? pickLabel(pick) : k;
                    return tradeRow(label, getPickValue(k),
                      () => setCalcReceivePicks((prev) => prev.filter((x) => x !== k)));
                  })}
                </div>
                {waiverAdjSide === "receive" && waiverAdj > 0 && (
                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
                    <span className="text-xs text-gray-400 italic">Waiver Adjustment</span>
                    <span className="text-xs text-blue-300 font-mono">+{waiverAdj.toLocaleString()}</span>
                  </div>
                )}
                <div className="mt-3 pt-2 border-t border-gray-700 flex justify-between items-center">
                  <span className="text-xs text-gray-500">Total</span>
                  <span className="text-base font-bold text-green-400">{totalReceiveAdj.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Verdict */}
            {(calcGive.length > 0 || calcGivePicks.length > 0 || calcReceive.length > 0 || calcReceivePicks.length > 0) && (
              <div className="mt-4 pt-4 border-t border-gray-700 flex items-center justify-between">
                <div>
                  <span className={`text-xl font-black ${verdictColor}`}>{verdict}</span>
                  {verdict !== "EVEN" && (
                    <span className="ml-2 text-sm text-gray-400">
                      by {Math.abs(net).toLocaleString()} pts
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {calcOpponentRosterId != null && (calcGive.length > 0 || calcGivePicks.length > 0) && (calcReceive.length > 0 || calcReceivePicks.length > 0) && selectedLeague && (() => {
                    const calcFp = buildTradeFingerprint(
                      selectedLeague.league_id,
                      calcOpponentRosterId,
                      calcGive,
                      calcReceive,
                    );
                    const alreadyMarked = sessionMarked.has(calcFp);
                    const buildCalcPayload = (direction: "ME" | "THEM") => {
                      const oppRosterForCalc = rosters.find((r: any) => r.roster_id === calcOpponentRosterId);
                      const oppName = (users as any)[oppRosterForCalc?.owner_id] || `Team ${calcOpponentRosterId}`;
                      return {
                        league_id: selectedLeague.league_id,
                        partner_roster_id: calcOpponentRosterId,
                        partner_name: oppName,
                        give_players: calcGive.map((id: string) => {
                          const p = (players as any)[id];
                          return { player_id: id, name: p?.full_name || id, position: p?.position || "", value: calcVal(id) } as TradeAttemptAsset;
                        }),
                        give_picks: calcGivePicks.map((k: string) => {
                          const pick = (allPicks as any[]).find((p: any) => pickKey(p) === k);
                          return { key: k, label: pick ? pickLabel(pick) : k, value: getPickValue(k) } as TradeAttemptPick;
                        }),
                        receive_players: calcReceive.map((id: string) => {
                          const p = (players as any)[id];
                          return { player_id: id, name: p?.full_name || id, position: p?.position || "", value: calcVal(id) } as TradeAttemptAsset;
                        }),
                        receive_picks: calcReceivePicks.map((k: string) => {
                          const pick = (allPicks as any[]).find((p: any) => pickKey(p) === k);
                          return { key: k, label: pick ? pickLabel(pick) : k, value: getPickValue(k) } as TradeAttemptPick;
                        }),
                        source: "CALCULATOR" as const,
                        initiated_by: direction,
                        status: "PENDING" as const,
                        counter_details: null,
                      };
                    };
                    if (alreadyMarked) {
                      return <span className="text-xs text-green-400 font-semibold">✓ Recorded</span>;
                    }
                    return (
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            await onMarkAttempted(buildCalcPayload("ME"));
                            setSessionMarked((prev) => new Set([...prev, calcFp]));
                          }}
                          className="text-xs font-semibold px-3 py-1 rounded-lg border border-orange-700 text-orange-400 hover:border-orange-500 hover:text-orange-300 transition"
                        >
                          I Sent This
                        </button>
                        <button
                          onClick={async () => {
                            await onMarkAttempted(buildCalcPayload("THEM"));
                            setSessionMarked((prev) => new Set([...prev, calcFp]));
                          }}
                          className="text-xs font-semibold px-3 py-1 rounded-lg border border-indigo-700 text-indigo-400 hover:border-indigo-500 hover:text-indigo-300 transition"
                        >
                          They Sent This
                        </button>
                      </div>
                    );
                  })()}
                  <button
                    onClick={() => { setCalcGive([]); setCalcReceive([]); setCalcGivePicks([]); setCalcReceivePicks([]); }}
                    className="text-xs text-gray-600 hover:text-gray-300 transition"
                  >
                    Clear trade
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Position Health Panel */}
          {(calcGive.length > 0 || calcReceive.length > 0) && (() => {
            const calcPosTotals = (playerIds: string[]) => {
              const t: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
              playerIds.forEach((id) => {
                const p = (players as any)[id];
                if (p && ["QB","RB","WR","TE"].includes(p.position)) {
                  t[p.position] = (t[p.position] || 0) + calcVal(id);
                }
              });
              return t;
            };
            const allTeamsCalcPos = rosters.map((r: any) => calcPosTotals(r.players || []));
            const calcLeagueRank = (pos: string, total: number) => {
              const sorted = allTeamsCalcPos.map((t) => t[pos] || 0).sort((a, b) => b - a);
              let rank = 1;
              for (const t of sorted) { if (total >= t) break; rank++; }
              return Math.min(rank, rosters.length);
            };
            const preT = calcPosTotals(myRoster?.players || []);
            const postT = { ...preT };
            calcGive.forEach((id) => {
              const p = (players as any)[id];
              if (p && postT[p.position] !== undefined) postT[p.position] = Math.max(0, postT[p.position] - calcVal(id));
            });
            calcReceive.forEach((id) => {
              const p = (players as any)[id];
              if (p && postT[p.position] !== undefined) postT[p.position] = (postT[p.position] || 0) + calcVal(id);
            });
            const positions = ["QB", "RB", "WR", "TE"] as const;
            return (
              <div className="mt-4 bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Position Health</h3>
                <div className="grid grid-cols-4 gap-2">
                  {positions.map((pos) => {
                    const preRank = calcLeagueRank(pos, preT[pos]);
                    const postRank = calcLeagueRank(pos, postT[pos]);
                    const delta = preRank - postRank;
                    const color = delta > 0 ? "text-green-400" : delta < 0 ? "text-red-400" : "text-gray-500";
                    return (
                      <div key={pos} className="bg-gray-800 rounded-xl p-3 text-center">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">{pos}</div>
                        <div className="text-sm font-bold text-white">#{postRank}</div>
                        <div className={`text-[10px] mt-0.5 ${color}`}>
                          {delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : "—"} from #{preRank}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Trade Equalizer */}
          {verdict !== "EVEN" &&
            (calcGive.length + calcGivePicks.length) > 0 &&
            (calcReceive.length + calcReceivePicks.length) > 0 &&
            (() => {
              const gap = Math.abs(net);
              const youWin = net > 0;

              type EqCandidate = {
                label: string; value: number; age?: number;
                position?: string; isPick: boolean; onAdd: () => void;
              };

              const candidates: EqCandidate[] = youWin
                ? [
                    ...myAvailPlayers.map((p: any) => ({
                      label: p.full_name, value: calcVal(p.player_id),
                      age: p.age, position: p.position, isPick: false,
                      onAdd: () => setCalcGive((prev: string[]) => [...prev, p.player_id]),
                    })),
                    ...myAvailPicks.map((p: any) => ({
                      label: pickLabel(p),
                      value: pickInsight(p)?.expectedValue ?? getStoredPickValue(pickFcValues, p),
                      isPick: true,
                      onAdd: () => setCalcGivePicks((prev: string[]) => [...prev, pickKey(p)]),
                    })),
                  ]
                : [
                    ...theirAvailPlayers.map((p: any) => ({
                      label: p.full_name, value: calcVal(p.player_id),
                      age: p.age, position: p.position, isPick: false,
                      onAdd: () => setCalcReceive((prev: string[]) => [...prev, p.player_id]),
                    })),
                    ...theirAvailPicks.map((p: any) => ({
                      label: pickLabel(p),
                      value: pickInsight(p)?.expectedValue ?? getStoredPickValue(pickFcValues, p),
                      isPick: true,
                      onAdd: () => setCalcReceivePicks((prev: string[]) => [...prev, pickKey(p)]),
                    })),
                  ];

              const suggestions = candidates
                .filter((c) => c.value > 0)
                .sort((a, b) => Math.abs(a.value - gap) - Math.abs(b.value - gap))
                .slice(0, 5);

              if (suggestions.length === 0) return null;

              return (
                <div className="mt-4 flex justify-center">
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 w-full max-w-md">
                    <h3 className="text-sm font-semibold text-gray-200 mb-3">Equalize the Trade</h3>
                    <div className="flex justify-end gap-6 text-[11px] text-gray-500 mb-1 pr-9">
                      <span>Age</span>
                      <span>Value</span>
                    </div>
                    <div className="space-y-1">
                      {suggestions.map((s) => (
                        <div key={s.label} className="flex items-center justify-between px-3 py-2 bg-gray-800 rounded-lg">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium text-blue-400 truncate">{s.label}</span>
                            <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                              {s.isPick ? "PICK" : s.position}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 ml-3">
                            <span className="text-xs text-gray-400 w-8 text-right">{s.age ?? ""}</span>
                            <span className="text-xs font-mono text-gray-300 w-12 text-right">{s.value.toLocaleString()}</span>
                            <button
                              onClick={s.onAdd}
                              className="w-6 h-6 bg-blue-500 hover:bg-blue-400 rounded-full flex items-center justify-center text-white text-sm font-bold transition shrink-0"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

          <p className="text-[10px] text-gray-700 mt-3">
            Pick values shown as averages for that round. Waiver adjustment approximated at 42% of extra assets' value when sides have unequal player counts.
          </p>
        </div>
      );
    })()}

    {/* ── Trade Finder ── */}
    {tradeHubSection === "FINDER" && (() => {
      if (!selectedLeague) return (
        <p className="text-gray-400 text-sm">Select a league from the dropdown above to use the Trade Finder.</p>
      );
      // Block the entire finder until the authoritative direction profile is ready.
      // selectedLeagueDirectionAdjusted returns null whenever its inputs are mid-update
      // (league switch, sim recomputing for the new league, etc.). Showing stale trades
      // driven by the wrong direction is worse than showing a spinner.
      if (!selectedLeagueDirectionAdjusted) return (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
          <p className="text-sm text-gray-400">Computing direction engine…</p>
          <p className="text-xs text-gray-600">Analysing your roster, picks, and playoff simulation</p>
        </div>
      );

      const calcVal = (id: string) => calcFcValues[id] ?? (players as any)[id]?.value ?? 0;
      const finderPickKey = (p: any) => `${p.season}-${p.round}-${p.roster_id}`;
      const finderPickLabel = (p: any) => {
        const via = p.roster_id !== p.owner_id ? ` (via ${users[p.roster_id] || `Team ${p.roster_id}`})` : "";
        const isSlotted = p.slot && String(p.slot).includes(".");
        const slotLabel = isSlotted
          ? `${p.season} ${p.slot}`
          : `${p.season} Rd ${p.round}`;
        const expectedSlot = !isSlotted
          ? (selectedLeagueDynamicPickValues[`${p.season}-${p.round}-${p.roster_id}`]?.expectedSlot ?? null)
          : null;
        const expectedSuffix = expectedSlot != null ? ` · Predicted Slot ${expectedSlot}` : "";
        return `${slotLabel}${expectedSuffix}${via}`;
      };

      // Build roster player list with values
      const rosterPlayers = (roster: any) =>
        (roster?.players || [])
          .map((id: string) => { const p = (players as any)[id]; return p ? { ...p, value: calcVal(id) } : null; })
          .filter((p: any) => p && ["QB","RB","WR","TE"].includes(p.position) && p.value > 0)
          .sort((a: any, b: any) => b.value - a.value);

      // Position totals for a player list
      const posTotals = (plist: any[]) => {
        const t: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
        plist.forEach((p: any) => { t[p.position] = (t[p.position] || 0) + p.value; });
        return t;
      };

      // Waiver adj using same caps as calculator
      const tradeWaiverAdj = (giveVals: number[], receiveVals: number[]) => {
        const diff = giveVals.length - receiveVals.length;
        if (diff === 0) return 0;
        const capAdj = (extras: number[]) =>
          extras.reduce((s, v, i) => s + Math.min(Math.round(v * 0.42), i === 0 ? 550 : 750), 0);
        if (diff > 0) {
          const sg = [...giveVals].sort((a, b) => b - a);
          return capAdj(sg.slice(receiveVals.length));
        } else {
          const sr = [...receiveVals].sort((a, b) => b - a);
          return capAdj(sr.slice(giveVals.length));
        }
      };

      // Check if a trade is value-balanced (within ±600 after waiver adj).
      // ±600 gives enough room for legitimate depth swaps and minor tweaks to surface
      // without the engine returning zero results on tight rosters.
      const isBalanced = (giveVals: number[], receiveVals: number[]) => {
        const gTotal = giveVals.reduce((s, v) => s + v, 0);
        const rTotal = receiveVals.reduce((s, v) => s + v, 0);
        const diff = giveVals.length - receiveVals.length;
        const adjG = gTotal + (diff < 0 ? tradeWaiverAdj(giveVals, receiveVals) : 0);
        const adjR = rTotal + (diff > 0 ? tradeWaiverAdj(giveVals, receiveVals) : 0);
        return Math.abs(adjR - adjG) <= 600;
      };

      const myRoster = rosters.find((r: any) => r.owner_id === user?.user_id);
      const myPlayers = rosterPlayers(myRoster);
      const isBlockedSellDisposition = (playerId?: string | null) =>
        !!playerId && playerDispositions[playerId]?.sell === "Not Willing to Trade";
      const isBlockedBuyDisposition = (playerId?: string | null) =>
        !!playerId && ["Zero Interest", "Skip"].includes(playerDispositions[playerId]?.buy || "");
      const myT = posTotals(myPlayers);
      const rosterDynVal = rosters
        .map((r: any) => ({
          roster_id: r.roster_id,
          val:
            rosterPlayers(r).reduce((s: number, p: any) => s + p.value, 0) +
            (allPicks as any[])
              .filter((p: any) => p.owner_id === r.roster_id)
              .reduce((s: number, p: any) => s + (selectedLeagueDynamicPickValues[`${p.season}-${p.round}-${p.roster_id}`]?.expectedValue ?? getStoredPickValue(pickFcValues, p)), 0),
        }))
        .sort((a, b) => b.val - a.val);
      const rosterRedVal = rosters
        .map((r: any) => ({
          roster_id: r.roster_id,
          val: (r.players || []).reduce((s: number, id: string) => s + (redraftValues[id] || 0), 0),
        }))
        .sort((a, b) => b.val - a.val);
      const dynRank = myRoster ? rosterDynVal.findIndex((r) => r.roster_id === myRoster.roster_id) + 1 : 0;
      const redRank = myRoster ? rosterRedVal.findIndex((r) => r.roster_id === myRoster.roster_id) + 1 : 0;
      // Single source of truth: the fully adjusted profile (dynasty + redraft + sim + age).
      // At this point selectedLeagueDirectionAdjusted is guaranteed non-null (loading gate above).
      const finderDirectionProfile = selectedLeagueDirectionAdjusted;
      const finderDirection = finderDirectionProfile.bucket;
      // Sim is now required before selectedLeagueDirectionAdjusted resolves — playoffOdds
      // is always a real number by the time we reach here (loading gate above blocks otherwise).
      const myFinderPlayoffOdds = (finderDirectionProfile as any).playoffOdds as number;
      const iAmTankingFinder = myFinderPlayoffOdds < 50;
      const draftCapitalMode = finderDraftCapitalMode;
      const priorityDraftYear = String(
        Number(CURRENT_YEAR) + (selectedLeagueDraftHasOccurred ? 1 : 0)
      );
      const orderedDraftYears = [
        ...YEARS.filter((year) => Number(year) >= Number(priorityDraftYear)),
        ...YEARS.filter((year) => Number(year) < Number(priorityDraftYear)),
      ];
      const draftYearPriority = Object.fromEntries(
        orderedDraftYears.map((year, idx) => [year, idx])
      ) as Record<string, number>;
      const numTeams = rosters.length;
      const finderPickValue = (p: any) => selectedLeagueDynamicPickValues[`${p.season}-${p.round}-${p.roster_id}`]?.expectedValue ?? getStoredPickValue(pickFcValues, p);
      const myFinderPicks = (allPicks as any[])
        .filter((p: any) => p.owner_id === myRoster?.roster_id)
        .map((p: any) => ({ ...p, value: finderPickValue(p) }))
        .filter((p: any) => p.value > 0)
        .sort((a: any, b: any) => {
          const yearDiff = (draftYearPriority[a.season] ?? 999) - (draftYearPriority[b.season] ?? 999);
          if (yearDiff !== 0) return yearDiff;
          if (a.round !== b.round) return a.round - b.round;
          return b.value - a.value;
        })
        .slice(0, 6);
      const ageCutoffByPos: Record<string, number> = { QB: 30, RB: 26, WR: 29, TE: 29 };
      const weakPositions = new Set(
        (finderDirectionProfile?.positionRanks || [])
          .filter((entry: any) => entry.rank >= Math.max(4, numTeams - 2))
          .map((entry: any) => entry.pos)
      );
      const strongPositions = new Set(
        (finderDirectionProfile?.positionRanks || [])
          .filter((entry: any) => entry.rank <= Math.max(2, Math.ceil(numTeams / 3)))
          .map((entry: any) => entry.pos)
      );
      const isAgingAsset = (player: any) =>
        Number(player?.age || 0) >= (ageCutoffByPos[player?.position] || 29);
      const isOldProducerBuy = (player: any) => {
        const age = Number(player?.age || 0);
        if (player?.position === "RB") return age >= 25;
        if (player?.position === "QB") return age >= 31;
        if (player?.position === "WR" || player?.position === "TE") return age >= 29;
        return age >= 29;
      };
      const isYoungBuildingBlock = (player: any) =>
        ["QB", "WR"].includes(player?.position) && Number(player?.age || 99) <= 24;
      const isFutureInsulationAsset = (player: any) =>
        (["QB", "WR"].includes(player?.position) && Number(player?.age || 99) <= 25) ||
        (player?.position === "TE" && Number(player?.age || 99) <= 25) ||
        (player?.position === "RB" && Number(player?.age || 99) <= 23);
      // Continuous 0.0–1.0 sell-urgency curve. 0 = hold forever, 1 = sell immediately.
      // Position-specific cliffs: RB peaks at 26-27, WR/TE at 29-30, QB at 32-33.
      const getAgeUrgency = (player: any): number => {
        const age = Number(player?.age || 0);
        if (age === 0) return 0;
        const pos = player?.position;
        if (pos === "RB") {
          if (age <= 22) return 0;
          if (age <= 24) return 0.15;
          if (age <= 25) return 0.40;
          if (age <= 26) return 0.70;
          if (age <= 27) return 0.90;
          return 1.0;
        }
        if (pos === "QB") {
          if (age <= 26) return 0;
          if (age <= 29) return 0.15;
          if (age <= 31) return 0.40;
          if (age <= 33) return 0.75;
          return 1.0;
        }
        // WR / TE
        if (age <= 24) return 0;
        if (age <= 26) return 0.15;
        if (age <= 28) return 0.35;
        if (age <= 30) return 0.65;
        if (age <= 31) return 0.85;
        return 1.0;
      };
      // Complement: 0 = window closing now, 1 = prime years ahead.
      const getFutureValue = (player: any): number => 1 - getAgeUrgency(player);
      // "Years-to-positional-cliff" — used for team window scoring.
      const yearsToCliff = (player: any): number => {
        const age = Number(player?.age || 0);
        if (age === 0) return 5;
        const pos = player?.position;
        const cliff = pos === "RB" ? 28 : pos === "QB" ? 35 : 32;
        return Math.max(0, cliff - age);
      };
      const isPremiumCurrentPick = (pick: any) =>
        String(pick?.season) === CURRENT_YEAR && String(pick?.slot || "").match(/^1\.(0[1-6]|[1-6])$/);
      const getDirectionTradeScore = (trade: TradeResult) => {
        const outgoingPlayers = trade.give || [];
        const incomingPlayers = trade.receive || [];
        const outgoingPicks = trade.givePicks || [];
        const incomingPicks = trade.receivePicks || [];
        const outgoingRedraft = outgoingPlayers.reduce((sum: number, p: any) => sum + (redraftValues[p.player_id] || 0), 0);
        const incomingRedraft = incomingPlayers.reduce((sum: number, p: any) => sum + (redraftValues[p.player_id] || 0), 0);
        const outgoingDynasty = outgoingPlayers.reduce((sum: number, p: any) => sum + p.value, 0);
        const incomingDynasty = incomingPlayers.reduce((sum: number, p: any) => sum + p.value, 0);
        const weakPosAdds = incomingPlayers.filter((p: any) => weakPositions.has(p.position)).length;
        const weakPosLosses = outgoingPlayers.filter((p: any) => weakPositions.has(p.position)).length;
        const strongPosSells = outgoingPlayers.filter((p: any) => strongPositions.has(p.position)).length;
        const agingSells = outgoingPlayers.filter((p: any) => isAgingAsset(p)).length;
        const youngCoreBuys = incomingPlayers.filter((p: any) => isYoungBuildingBlock(p)).length;
        const picksIn = incomingPicks.reduce((sum: number, p: any) => sum + p.value, 0);
        const picksOut = outgoingPicks.reduce((sum: number, p: any) => sum + p.value, 0);
        const premiumCurrentPicksOut = outgoingPicks.filter((p: any) => isPremiumCurrentPick(p)).length;
        const futureFirstsIn = incomingPicks.filter((p: any) => Number(p.round) === 1 && String(p.season) !== CURRENT_YEAR).length;
        const oldProducerBuys = incomingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const oldProducerSells = outgoingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const insulationBuys = incomingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const insulationSells = outgoingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const currentPlayerCapitalOut = outgoingPlayers.reduce((sum: number, p: any) => {
          const age = Number(p.age || 0);
          const position = p.position;
          const olderProducer =
            (position === "RB" && age >= 25) ||
            (position === "QB" && age >= 28) ||
            ((position === "WR" || position === "TE") && age >= 27);
          return sum + (olderProducer ? 1 : 0);
        }, 0);
        const assetConsolidation =
          outgoingPlayers.length + outgoingPicks.length - incomingPlayers.length - incomingPicks.length;

        let score = 0;

        // iAmTankingFinder ALWAYS takes priority over the asset-based bucket.
        // A team at 0% playoff odds is NOT a True Contender — buying points is actively harmful
        // regardless of how good the assets look on paper.
        if (iAmTankingFinder) {
          // Tank mode: below 50% playoff odds. Only valid moves are selling floor production,
          // stacking picks, and targeting young upside shots.
          score += oldProducerSells * 10;
          score += agingSells * 8;
          score += insulationBuys * 9;
          score += youngCoreBuys * 8;
          score += futureFirstsIn * 14;
          score += picksIn / 150;
          // Every pick traded away is a lost future draft slot — penalize heavily
          score -= outgoingPicks.length * 10;
          score -= picksOut / 150;
          score -= premiumCurrentPicksOut * 18;
          score -= oldProducerBuys * 18;
          score -= incomingPlayers.filter((p: any) => p.position === "RB" && Number(p.age || 0) >= 25).length * 8;
          // Counter the posScore reward for filling weak positions — that wins games you don't want
          score -= incomingRedraft / 160;
          score -= weakPosAdds * 10;
          score += strongPosSells * 3;
        } else if (["Elite", "True Contender", "Almost There"].includes(finderDirection)) {
          score += (incomingRedraft - outgoingRedraft) / 160;
          score += weakPosAdds * 8;
          score -= weakPosLosses * 10;
          score += assetConsolidation > 0 ? assetConsolidation * 4 : assetConsolidation * 1.5;
          score += currentPlayerCapitalOut * 3;
          score -= outgoingPicks.length * 3;
          score -= premiumCurrentPicksOut * 10;
          score -= incomingPicks.length * 2;
          score -= incomingPlayers.filter((p: any) => p.position === "RB" && Number(p.age || 0) >= 28).length * 4;
          // RBs injure most often and are hardest to replace off waivers.
          // Contending teams should value RB depth even when RB is already a "strong" position.
          score += incomingPlayers.filter((p: any) =>
            p.position === "RB" && Number(p.age || 0) >= 22 && Number(p.age || 0) <= 26
          ).length * 4;
        } else if (["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection)) {
          score += agingSells * 9;
          score += oldProducerSells * 8;
          score += youngCoreBuys * 8;
          score += insulationBuys * 10;
          score -= insulationSells * 10;
          score += futureFirstsIn * 12;
          score += picksIn / 180;
          score -= picksOut / 180;
          score -= premiumCurrentPicksOut * 12;
          score -= oldProducerBuys * 18;
          score -= incomingPlayers.filter((p: any) => p.position === "RB" && Number(p.age || 0) >= 25).length * 7;
          score -= incomingRedraft / 160;
          score += strongPosSells * 3;
        } else {
          // True middle — has a realistic playoff path, balanced approach
          score += weakPosAdds * 6;
          score -= weakPosLosses * 7;
          score += assetConsolidation > 0 ? assetConsolidation * 5 : assetConsolidation * 1.5;
          score += agingSells * 4;
          score += youngCoreBuys * 4;
          score += futureFirstsIn * 6;
          score -= outgoingPicks.length * 4;
          score -= premiumCurrentPicksOut * 9;
          score += currentPlayerCapitalOut * 2;
          score += (incomingDynasty - outgoingDynasty) / 250;
        }

        if (outgoingPicks.length > 0 && currentPlayerCapitalOut === 0 && !iAmTankingFinder) score -= 6;
        if (incomingPicks.length > 0 && outgoingPlayers.length === 0 && !draftCapitalMode && !iAmTankingFinder) score -= 4;
        // Don't penalize draft capital trades for tanking or rebuild teams
        if (trade.draftCapital && !["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection) && !iAmTankingFinder) score -= 3;

        return score;
      };
      const getTradeIntent = (trade: TradeResult) => {
        const outgoingPlayers = trade.give || [];
        const incomingPlayers = trade.receive || [];
        const outgoingPicks = trade.givePicks || [];
        const incomingPicks = trade.receivePicks || [];
        const outgoingOldProducers = outgoingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const incomingOldProducers = incomingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const incomingInsulation = incomingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const outgoingInsulation = outgoingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const weakPosAdds = incomingPlayers.filter((p: any) => weakPositions.has(p.position)).length;
        const strongPosSells = outgoingPlayers.filter((p: any) => strongPositions.has(p.position)).length;
        const futureFirstsIn = incomingPicks.filter((p: any) => Number(p.round) === 1 && String(p.season) !== CURRENT_YEAR).length;
        const playerCountDelta =
          outgoingPlayers.length + outgoingPicks.length - incomingPlayers.length - incomingPicks.length;
        const incomingBest = [...incomingPlayers].sort((a: any, b: any) => b.value - a.value)[0];
        const outgoingBest = [...outgoingPlayers].sort((a: any, b: any) => b.value - a.value)[0];

        if (incomingPicks.length > 0 && incomingPlayers.length === 0) {
          return {
            label: "Pick Accumulation",
            detail: "Turning player value into future insulation and draft capital.",
          };
        }
        if (outgoingPicks.length > 0 && incomingPlayers.length > 0 && weakPosAdds > 0) {
          return {
            label: "Pick-For-Points",
            detail: "Using picks to patch a lineup need with immediate player help.",
          };
        }
        // iAmTankingFinder takes priority — even a "True Contender" bucket team at 0% is a seller
        if (iAmTankingFinder && outgoingOldProducers > 0 && (incomingPicks.length > 0 || incomingInsulation > 0)) {
          return {
            label: "Tank Sell",
            detail: `At ${Math.round(myFinderPlayoffOdds)}% playoff odds, converting floor production into draft capital maximizes future pick position without sacrificing cornerstone pieces.`,
          };
        }
        if (!iAmTankingFinder && ["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection) && outgoingOldProducers > 0 && (futureFirstsIn > 0 || incomingInsulation > 0)) {
          return {
            label: "Rebuild Sell",
            detail: "Selling present points for youth, insulation, or future firsts.",
          };
        }
        if (!iAmTankingFinder && ["Elite", "True Contender", "Almost There"].includes(finderDirection) && incomingOldProducers > 0 && weakPosAdds > 0) {
          return {
            label: "Win-Now Patch",
            detail: "Buying immediate production where your current lineup needs help.",
          };
        }
        if (
          incomingBest &&
          outgoingBest &&
          incomingBest.value > outgoingBest.value &&
          playerCountDelta > 0
        ) {
          return {
            label: "Tier-Up",
            detail: "Condensing depth into one stronger difference-maker.",
          };
        }
        if (incomingInsulation > outgoingInsulation && incomingOldProducers === 0) {
          return {
            label: "Insulation Buy",
            detail: "Shifting value into younger assets that better fit a long-term build.",
          };
        }
        if (strongPosSells > 0 && weakPosAdds > 0) {
          return {
            label: "Strength-For-Need",
            detail: "Using excess at a strong position to solve a weaker room.",
          };
        }
        if (playerCountDelta > 0 && incomingPlayers.length > 0) {
          return {
            label: "Consolidation",
            detail: "Shrinking asset count to clean up your lineup and bench shape.",
          };
        }
        if (playerCountDelta < 0 && incomingPlayers.length > 1) {
          return {
            label: "Depth Split",
            detail: "Breaking one concentrated asset into multiple usable pieces.",
          };
        }
        if (incomingInsulation > 0 && outgoingOldProducers > 0) {
          return {
            label: "Age-Down Bet",
            detail: "Moving from older production into a younger value window.",
          };
        }
        return {
          label: "Value Rebalance",
          detail: "A balanced value move that changes roster shape more than headline value.",
        };
      };
      const failsDirectionGuardrail = (trade: TradeResult) => {
        const incomingPlayers = trade.receive || [];
        const incomingPicks = trade.receivePicks || [];

        // iAmTankingFinder covers ALL seller/rebuild cases regardless of bucket label.
        // A team at 0% playoff odds is a seller even if their assets say "True Contender."
        const isEffectiveSeller = iAmTankingFinder || ["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection);
        const isEffectiveContender = !iAmTankingFinder && ["Elite", "True Contender", "Almost There"].includes(finderDirection);

        if (isEffectiveSeller) {
          // Block giving away early/mid picks in exchange for non-young players (pick-for-points).
          // Allowed exceptions:
          //   1. ALL incoming players are young prospects (building-block trade)
          //   2. User has 8+ picks already (excess-pick relief)
          //   3. All outgoing picks are Round 3+ (late picks as sweeteners are fine)
          const outgoingPicksGuard = trade.givePicks || [];
          if (outgoingPicksGuard.length > 0 && incomingPlayers.length > 0) {
            const incomingAllYoung = incomingPlayers.every((p: any) => isFutureInsulationAsset(p));
            const myTotalPickCount = (allPicks as any[]).filter(
              (p: any) => Number(p.owner_id) === Number(myRoster?.roster_id)
            ).length;
            const hasExcessPicks = myTotalPickCount >= 8;
            const allOutgoingPicksLate = outgoingPicksGuard.every((p: any) => Number(p.round) >= 3);
            if (!incomingAllYoung && !hasExcessPicks && !allOutgoingPicksLate) return true;
          }
        }

        if (isEffectiveContender) {
          if (incomingPlayers.length === 0 && incomingPicks.length > 0) return true;
        }

        return false;
      };
      // Full roster is the give pool — no artificial cap
      const myTopBase = myPlayers
        .filter((p: any) => !isBlockedSellDisposition(p.player_id));
      const myPinnedPlayer = finderPinnedPlayerId && !isBlockedSellDisposition(finderPinnedPlayerId)
        ? myPlayers.find((p: any) => p.player_id === finderPinnedPlayerId)
        : null;
      const myTop = myPinnedPlayer && !myTopBase.some((p: any) => p.player_id === myPinnedPlayer.player_id)
        ? [...myTopBase.slice(0, 9), myPinnedPlayer].filter(Boolean)
        : myTopBase;
      // When either give or receive player is pinned, relax loop caps so rarer combos surface
      const pinnedActive = !!(finderPinnedPlayerId || finderTargetPlayerId);


      // League-wide positional totals for every team (used for ranking)
      const allTeamPosTotals = rosters.map((r: any) => posTotals(rosterPlayers(r)));

      // Rank user (1 = best) at a given position given their total at that position
      const leagueRank = (pos: string, total: number) => {
        const sorted = allTeamPosTotals.map((t) => t[pos] || 0).sort((a, b) => b - a);
        let rank = 1;
        for (const t of sorted) { if (total >= t) break; rank++; }
        return Math.min(rank, numTeams);
      };

      // Positional fit score using post-trade league rankings.
      // Rewards improving weak positions, penalizes destroying strong ones.
      // Heavy drops now hurt instead of hard-blocking the trade so rebuild paths
      // and value-insulation deals can still surface.
      const posScore = (givePL: any[], receivePL: any[]) => {
        const postT: Record<string, number> = { ...myT };
        givePL.forEach((p: any) => { postT[p.position] = (postT[p.position] || 0) - p.value; });
        receivePL.forEach((p: any) => { postT[p.position] = (postT[p.position] || 0) + p.value; });

        let score = 0;
        for (const pos of ["QB", "RB", "WR", "TE"]) {
          const beforeRank = leagueRank(pos, myT[pos] || 0);
          const afterRank  = leagueRank(pos, postT[pos] || 0);
          const rankDelta  = beforeRank - afterRank; // positive = moved up (improved)

          // Scale reward/penalty by rank change; improving a weak spot is worth more
          const wasWeak = beforeRank > Math.floor(numTeams / 2);
          score += rankDelta * (wasWeak && rankDelta > 0 ? 3 : 2);

          const drop = afterRank - beforeRank;
          if (drop >= 3) score -= drop * 2.5;
          if (afterRank >= Math.max(8, numTeams - 2)) score -= 4;
          if (afterRank === numTeams) score -= 5;
        }
        return score;
      };

      if (loadingCalcValues) return <p className="text-sm text-blue-400">Loading player values…</p>;

      // ── Ignored owners notice ──
      const ignoredInLeague = rosters.filter((r: any) => r.owner_id !== user?.user_id && ignoredOwnerIds.includes(r.owner_id));

      // ── Player search / pin UI ──
      const searchMatches = finderPlayerSearch.trim().length >= 2
        ? myPlayers.filter((p: any) =>
            p.full_name.toLowerCase().includes(finderPlayerSearch.toLowerCase())
          ).slice(0, 6)
        : [];
      const pinnedPlayer = finderPinnedPlayerId
        ? myPlayers.find((p: any) => p.player_id === finderPinnedPlayerId && !isBlockedSellDisposition(p.player_id)) ?? null
        : null;

      // Opponent roster(s) for target player search
      const finderOppRostersFiltered = rosters.filter((r: any) =>
        r.owner_id !== user?.user_id &&
        (finderTargetOppRosterId === null || r.roster_id === finderTargetOppRosterId)
      );
      const allOppPlayers = finderOppRostersFiltered.flatMap((r: any) => rosterPlayers(r));
      const targetSearchMatches = finderTargetPlayerSearch.trim().length >= 2
        ? allOppPlayers.filter((p: any) =>
            p.full_name.toLowerCase().includes(finderTargetPlayerSearch.toLowerCase())
          ).slice(0, 6)
        : [];
      const targetPinnedPlayer = finderTargetPlayerId
        ? allOppPlayers.find((p: any) => p.player_id === finderTargetPlayerId) ?? null
        : null;

      // QB safety gate — find the top-32 QB value floor across all known players
      const allQBsSorted = Object.values(players as Record<string, any>)
        .filter((p: any) => p.position === "QB")
        .map((p: any) => calcVal(p.player_id))
        .filter((v) => v > 0)
        .sort((a, b) => b - a);
      const top32QBFloor = allQBsSorted[31] ?? 0; // value of the 32nd-best QB

      // How many of my QBs are within top-32 threshold
      const myTop32QBs = myPlayers.filter(
        (p: any) => p.position === "QB" && p.value >= top32QBFloor
      );

      // Returns true if giving these players still leaves ≥3 top-32 QBs on my roster.
      // Bypassed in Tank Mode — user explicitly chose to shed QB depth.
      const qbSafe = (givePlayers: any[]) => {
        if (finderTankMode) return true;
        const qbsGiven = givePlayers.filter((p: any) => p.position === "QB" && p.value >= top32QBFloor).length;
        return myTop32QBs.length - qbsGiven >= 3;
      };

      // Returns true if the opponent still has ≥3 top-32 QBs after giving these players away
      const oppQbSafe = (oppPlayersList: any[], givePlayers: any[]) => {
        const oppTop32QBs = oppPlayersList.filter(
          (p: any) => p.position === "QB" && p.value >= top32QBFloor
        );
        const qbsGiven = givePlayers.filter((p: any) => p.position === "QB" && p.value >= top32QBFloor).length;
        return oppTop32QBs.length - qbsGiven >= 3;
      };

      // Any QB/WR/TE the opponent receives must rank within the positional threshold
      // on their roster post-trade. Prevents dumping low-end players on teams that
      // already have better depth at that spot.
      //   QB  → must be top 3  (they need a real starter)
      //   WR  → must be top 5  (starter/flex quality)
      //   TE  → must be top 2  (positional scarcity)
      const POS_RANK_LIMITS: Record<string, number> = { QB: 3, WR: 5, TE: 2 };
      const oppReceiveOk = (oppPlayersList: any[], givePlayers: any[], receivePlayers: any[]) => {
        const outgoingIds = new Set(receivePlayers.map((p: any) => p.player_id));
        for (const pos of ["QB", "WR", "TE"] as const) {
          const limit = POS_RANK_LIMITS[pos];
          const incoming = givePlayers.filter((p: any) => p.position === pos);
          if (incoming.length === 0) continue;
          // Skip rank constraint for low-value depth pieces — bench swaps and handcuffs
          // should never be blocked just because they don't crack the opponent's top-N
          const impactIncoming = incoming.filter((p: any) => p.value >= 2000);
          if (impactIncoming.length === 0) continue;
          const oppPosAfter = oppPlayersList
            .filter((p: any) => p.position === pos && !outgoingIds.has(p.player_id))
            .concat(incoming)
            .sort((a: any, b: any) => b.value - a.value);
          const passes = impactIncoming.every((pl: any) => {
            const rank = oppPosAfter.findIndex((p: any) => p.player_id === pl.player_id);
            return rank < limit; // 0-indexed: rank 0…limit-1 = top N
          });
          if (!passes) return false;
        }
        return true;
      };

      // No package (give or receive) may contain 2+ QBs or 2+ TEs
      const packageOk = (pkg: any[]) => {
        const qbs = pkg.filter((p: any) => p.position === "QB").length;
        const tes = pkg.filter((p: any) => p.position === "TE").length;
        return qbs <= 1 && tes <= 1;
      };
      // User-side package check — bypassed in Tank Mode so the user can give 2+ QBs/TEs
      const myPkgOk = (pkg: any[]) => finderTankMode || packageOk(pkg);

      type TradeResult = {
        give: any[]; receive: any[];
        givePicks: any[]; receivePicks: any[];
        oppName: string; oppRosterId: number;
        score: number; net: number; format: string;
        draftCapital?: boolean;
      };

      const starterSlots = (selectedLeague?.roster_positions || []).filter(
        (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
      );
      const starterCounts = starterSlots.reduce((acc: Record<string, number>, slot: string) => {
        acc[slot] = (acc[slot] || 0) + 1;
        return acc;
      }, {});
      const hasSuperFlex = (starterCounts.SUPER_FLEX || 0) > 0;
      const hasFlex = (starterCounts.FLEX || 0) > 0;
      const rosterById = new Map(
        rosters.map((r: any) => [Number(r.roster_id), r])
      );
      const playerTradeScore = (player: any) =>
        (redraftValues[player?.player_id] ?? 0) * 2 + (player?.value ?? 0);

      const buildPostTradePlayers = (baseRoster: any, givePlayers: any[], receivePlayers: any[]) => {
        const giveIds = new Set(givePlayers.map((p: any) => p.player_id));
        return [
          ...(baseRoster?.players || [])
            .map((id: string) => (players as any)[id])
            .filter((p: any) => p && !giveIds.has(p.player_id)),
          ...receivePlayers,
        ].filter((p: any) => p && ["QB", "RB", "WR", "TE"].includes(p.position));
      };

      const evaluateLineupSafety = (rosterPlayersList: any[], relaxed = false) => {
        const available = [...rosterPlayersList].sort(
          (a: any, b: any) => playerTradeScore(b) - playerTradeScore(a)
        );
        const usedIds = new Set<string>();
        const lineup: Array<{ slot: string; player: any; score: number }> = [];

        const claimBest = (eligiblePositions: string[], slot: string) => {
          const idx = available.findIndex(
            (player: any) =>
              !usedIds.has(player.player_id) &&
              eligiblePositions.includes(player.position)
          );
          if (idx === -1) {
            lineup.push({ slot, player: null, score: 0 });
            return;
          }
          const player = available[idx];
          usedIds.add(player.player_id);
          lineup.push({ slot, player, score: playerTradeScore(player) });
        };

        starterSlots.forEach((slot: string) => {
          if (slot === "FLEX") return claimBest(["RB", "WR", "TE"], slot);
          if (slot === "SUPER_FLEX") return claimBest(["QB", "RB", "WR", "TE"], slot);
          return claimBest([slot], slot);
        });

        const bench = available.filter((player: any) => !usedIds.has(player.player_id));
        const benchCounts = bench.reduce((acc: Record<string, number>, player: any) => {
          acc[player.position] = (acc[player.position] || 0) + 1;
          return acc;
        }, {});

        const emptySlots = lineup.filter((slot) => !slot.player).length;
        const lineupScore = lineup.reduce((sum, slot) => sum + slot.score, 0);
        const reserveFlex = bench.filter((p: any) => ["RB", "WR", "TE"].includes(p.position)).length;
        const reserveQb = benchCounts.QB || 0;
        const reserveTe = benchCounts.TE || 0;
        const reserveRb = benchCounts.RB || 0;
        const reserveWr = benchCounts.WR || 0;
        const reserveTotal = bench.length;

        const minReserveQb = hasSuperFlex ? (relaxed ? 0 : 1) : starterCounts.QB ? (relaxed ? 0 : 1) : 0;
        const minReserveTe = starterCounts.TE ? (relaxed ? 0 : 1) : 0;
        const minReserveFlex = hasFlex || hasSuperFlex ? (relaxed ? 1 : 2) : (relaxed ? 0 : 1);
        const minReserveRb = starterCounts.RB >= 2 ? (relaxed ? 0 : 1) : 0;
        const minReserveWr = starterCounts.WR >= 2 ? (relaxed ? 0 : 1) : 0;
        const minReserveTotal = relaxed ? 2 : 4;

        const shortages = [
          emptySlots > 0 ? `empty-${emptySlots}` : null,
          reserveQb < minReserveQb ? "qb" : null,
          reserveTe < minReserveTe ? "te" : null,
          reserveFlex < minReserveFlex ? "flex" : null,
          reserveRb < minReserveRb ? "rb" : null,
          reserveWr < minReserveWr ? "wr" : null,
          reserveTotal < minReserveTotal ? "total" : null,
        ].filter(Boolean);

        return {
          valid: emptySlots === 0,
          shortages,
          emptySlots,
          lineupScore,
          reserveQb,
          reserveTe,
          reserveFlex,
          reserveRb,
          reserveWr,
          reserveTotal,
        };
      };

      const getTradeLineupSafety = (trade: TradeResult) => {
        const myAfterPlayers = buildPostTradePlayers(myRoster, trade.give, trade.receive);
        const oppRoster = rosterById.get(Number(trade.oppRosterId));
        const oppBeforePlayers = rosterPlayers(oppRoster);
        const oppAfterPlayers = buildPostTradePlayers(oppRoster, trade.receive, trade.give);
        const myBefore = evaluateLineupSafety(myPlayers, false);
        const myAfter = evaluateLineupSafety(myAfterPlayers, false);
        const oppBefore = evaluateLineupSafety(oppBeforePlayers, true);
        const oppAfter = evaluateLineupSafety(oppAfterPlayers, true);
        const myShortagePenalty =
          myAfter.emptySlots * 14 +
          Math.max(0, (starterCounts.QB || 0 ? 1 : 0) - myAfter.reserveQb) * (hasSuperFlex ? 7 : 4) +
          Math.max(0, (starterCounts.TE || 0 ? 1 : 0) - myAfter.reserveTe) * 3 +
          Math.max(0, (hasFlex || hasSuperFlex ? 1 : 0) - myAfter.reserveFlex) * 2.5 +
          Math.max(0, 2 - myAfter.reserveTotal) * 2;
        const oppShortagePenalty =
          oppAfter.emptySlots * 10 +
          Math.max(0, (starterCounts.QB || 0 ? 1 : 0) - oppAfter.reserveQb) * (hasSuperFlex ? 5 : 3) +
          Math.max(0, (starterCounts.TE || 0 ? 1 : 0) - oppAfter.reserveTe) * 2 +
          Math.max(0, (hasFlex || hasSuperFlex ? 1 : 0) - oppAfter.reserveFlex) * 1.5;

        const myDelta =
          (myAfter.lineupScore - myBefore.lineupScore) / 150 +
          (myAfter.reserveFlex - myBefore.reserveFlex) * 2 +
          (myAfter.reserveQb - myBefore.reserveQb) * (hasSuperFlex ? 3 : 1.5) +
          (myAfter.reserveTotal - myBefore.reserveTotal) * 1.25;
        const oppDelta =
          (oppAfter.lineupScore - oppBefore.lineupScore) / 175 +
          (oppAfter.reserveFlex - oppBefore.reserveFlex) * 1.5 +
          (oppAfter.reserveQb - oppBefore.reserveQb) * (hasSuperFlex ? 2 : 1) +
          (oppAfter.reserveTotal - oppBefore.reserveTotal);

        const contenderBuckets = new Set(["Elite", "True Contender", "Almost There", "Fading Contender"]);
        const isContenderish = contenderBuckets.has(finderDirection);
        const reserveTotalDrop = myBefore.reserveTotal - myAfter.reserveTotal;
        const reserveFlexDrop = myBefore.reserveFlex - myAfter.reserveFlex;
        const reserveQbDrop = myBefore.reserveQb - myAfter.reserveQb;
        const reserveTeDrop = myBefore.reserveTe - myAfter.reserveTe;
        const severeDepthLoss =
          reserveTotalDrop >= 2 ||
          reserveFlexDrop >= 2 ||
          (hasSuperFlex && reserveQbDrop >= 1) ||
          (!hasSuperFlex && starterCounts.QB > 0 && myAfter.reserveQb < 1 && myBefore.reserveQb >= 1) ||
          (starterCounts.TE > 0 && myAfter.reserveTe < 1 && myBefore.reserveTe >= 1);
        const thinBenchForContender =
          isContenderish && (
            myAfter.reserveTotal < Math.max(4, Math.min(myBefore.reserveTotal, 5)) ||
            myAfter.reserveFlex < (hasFlex || hasSuperFlex ? Math.max(2, Math.min(myBefore.reserveFlex, 3)) : 1) ||
            (starterCounts.QB > 0 && myAfter.reserveQb < 1 && myBefore.reserveQb >= 1) ||
            (starterCounts.TE > 0 && myAfter.reserveTe < 1 && myBefore.reserveTe >= 1)
          );
        const lineupGain = myAfter.lineupScore - myBefore.lineupScore;
        const depthCollapsePenalty =
          Math.max(0, reserveTotalDrop) * 3.5 +
          Math.max(0, reserveFlexDrop) * 4 +
          Math.max(0, reserveQbDrop) * (hasSuperFlex ? 6 : 3) +
          Math.max(0, reserveTeDrop) * 2.5;
        const blocksForDepth =
          (isContenderish && severeDepthLoss && lineupGain < 90) ||
          thinBenchForContender;

        return {
          myBefore,
          myAfter,
          oppBefore,
          oppAfter,
          myValid: myAfter.valid,
          oppValid: oppAfter.valid,
          valid: myAfter.emptySlots === 0 && oppAfter.emptySlots === 0 && !blocksForDepth,
          blocksForDepth,
          reserveTotalDrop,
          reserveFlexDrop,
          reserveQbDrop,
          reserveTeDrop,
          score: myDelta + oppDelta * 0.7 - myShortagePenalty - oppShortagePenalty * 0.7 - depthCollapsePenalty,
        };
      };

      // ── NFL depth chart map (mirrors DataHub logic) ─────────────────────────
      // Used throughout the finder & scoring for accurate starter/handcuff detection.
      // Sorted: explicit depth_chart_order first, dynasty value descending as fallback.
      const nflTeamDepth = new Map<string, Record<string, any[]>>();
      Object.values(players as Record<string, any>).forEach((p: any) => {
        if (!p.team || !["QB","RB","WR","TE"].includes(p.position)) return;
        if ((p.status ?? "").toLowerCase() === "retired") return;
        if (!nflTeamDepth.has(p.team)) nflTeamDepth.set(p.team, { QB: [], RB: [], WR: [], TE: [] });
        nflTeamDepth.get(p.team)![p.position].push({ ...p, value: calcVal(p.player_id) });
      });
      nflTeamDepth.forEach((posMap) => {
        Object.keys(posMap).forEach((pos) => {
          posMap[pos].sort((a: any, b: any) => {
            const oa = a.depth_chart_order ?? null;
            const ob = b.depth_chart_order ?? null;
            if (oa !== null && ob !== null) return oa - ob;
            if (oa !== null) return -1;
            if (ob !== null) return 1;
            return b.value - a.value; // higher dynasty value = likely higher on depth chart
          });
        });
      });
      // Returns sorted depth index for a player (0=starter, 1=primary HC, 2=secondary HC…)
      const getNFLDepthIdx = (team: string, pos: string, playerId: string): number | null => {
        const group = nflTeamDepth.get(team)?.[pos] ?? [];
        const idx = group.findIndex((p: any) => p.player_id === playerId);
        return idx >= 0 ? idx : null;
      };

      const results: TradeResult[] = [];

      for (const oppRoster of rosters.filter((r: any) => r.owner_id !== user?.user_id && !ignoredOwnerIds.includes(r.owner_id) && (finderTargetOppRosterId === null || r.roster_id === finderTargetOppRosterId))) {
        const oppPlayers = rosterPlayers(oppRoster);
        const oppPicks = (allPicks as any[])
          .filter((p: any) => p.owner_id === oppRoster.roster_id)
          .map((p: any) => ({ ...p, value: finderPickValue(p) }))
          .filter((p: any) => p.value > 0)
          .sort((a: any, b: any) => {
            const yearDiff = (draftYearPriority[a.season] ?? 999) - (draftYearPriority[b.season] ?? 999);
            if (yearDiff !== 0) return yearDiff;
            if (a.round !== b.round) return a.round - b.round;
            return b.value - a.value;
          })
          .slice(0, 8);

        // Full opponent roster is the receive pool — no artificial cap
        // Also exclude "Zero Interest" buy-disposition players unless explicitly targeted
        const oppTopBase = oppPlayers
          .filter((p: any) => !isBlockedBuyDisposition(p.player_id));
        const targetPinnedOppPlayer = finderTargetPlayerId && !isBlockedBuyDisposition(finderTargetPlayerId)
          ? oppPlayers.find((p: any) => p.player_id === finderTargetPlayerId)
          : null;
        const oppTop = targetPinnedOppPlayer && !oppTopBase.some((p: any) => p.player_id === targetPinnedOppPlayer.player_id)
          ? [...oppTopBase.slice(0, 9), targetPinnedOppPlayer].filter(Boolean)
          : oppTopBase;
        const oppName = (users as any)[oppRoster.owner_id] || `Team ${oppRoster.roster_id}`;

        if (draftCapitalMode) {
          for (const mp of myTop) {
            if (isBlockedSellDisposition(mp.player_id)) continue;
            for (const pick of oppPicks) {
              if (!isBalanced([mp.value], [pick.value])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [])) continue;
              results.push({
                give: [mp], receive: [], givePicks: [], receivePicks: [pick], oppName, oppRosterId: oppRoster.roster_id,
                score: -Math.abs(pick.value - mp.value), net: pick.value - mp.value, format: "1 for 1", draftCapital: true,
              });
            }
          }

          for (const mp of myTop) {
            if (isBlockedSellDisposition(mp.player_id)) continue;
            for (let i = 0; i < oppPicks.length; i++) {
              for (let j = i + 1; j < oppPicks.length; j++) {
                const p1 = oppPicks[i], p2 = oppPicks[j];
                if (!isBalanced([mp.value], [p1.value, p2.value])) continue;
                if (!qbSafe([mp])) continue;
                if (!oppReceiveOk(oppPlayers, [mp], [])) continue;
                const adj = tradeWaiverAdj([mp.value], [p1.value, p2.value]);
                results.push({
                  give: [mp], receive: [], givePicks: [], receivePicks: [p1, p2], oppName, oppRosterId: oppRoster.roster_id,
                  score: -Math.abs((p1.value + p2.value - adj) - mp.value), net: p1.value + p2.value - mp.value - adj, format: "1 for 2", draftCapital: true,
                });
              }
            }
          }

          for (let i = 0; i < Math.min(myTop.length, 14); i++) {
            for (let j = i + 1; j < Math.min(myTop.length, 14); j++) {
              const mp1 = myTop[i], mp2 = myTop[j];
              if (isBlockedSellDisposition(mp1.player_id) || isBlockedSellDisposition(mp2.player_id)) continue;
              if (!myPkgOk([mp1, mp2])) continue;
              if (!qbSafe([mp1, mp2])) continue;
              if (!oppReceiveOk(oppPlayers, [mp1, mp2], [])) continue;
              for (const pick of oppPicks) {
                if (!isBalanced([mp1.value, mp2.value], [pick.value])) continue;
                const adj = tradeWaiverAdj([mp1.value, mp2.value], [pick.value]);
                results.push({
                  give: [mp1, mp2], receive: [], givePicks: [], receivePicks: [pick], oppName, oppRosterId: oppRoster.roster_id,
                  score: -Math.abs((pick.value + adj) - (mp1.value + mp2.value)), net: pick.value + adj - mp1.value - mp2.value, format: "2 for 1", draftCapital: true,
                });
              }
            }
          }

          continue;
        }

        // When a player is pinned, extend the cap just enough to include that player's position
        // in the sorted list — never blow open the entire roster (that causes C(n,4)^2 freezes).
        const pinnedMyIdx = myPinnedPlayer ? myTop.findIndex((p: any) => p.player_id === myPinnedPlayer.player_id) : -1;
        const pinnedOppIdx = targetPinnedOppPlayer ? oppTop.findIndex((p: any) => p.player_id === targetPinnedOppPlayer.player_id) : -1;
        const myCap = (base: number) => Math.min(myTop.length, pinnedMyIdx >= 0 ? Math.min(Math.max(base, pinnedMyIdx + 1), 18) : base);
        const oppCap = (base: number) => Math.min(oppTop.length, pinnedOppIdx >= 0 ? Math.min(Math.max(base, pinnedOppIdx + 1), 18) : base);

        // 1v1
        for (const mp of myTop) {
          for (const op of oppTop) {
            if (!isBalanced([mp.value], [op.value])) continue;
            if (!qbSafe([mp])) continue;
            if (!oppQbSafe(oppPlayers, [op])) continue;
            if (!oppReceiveOk(oppPlayers, [mp], [op])) continue;
            results.push({
              give: [mp], receive: [op], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
              score: posScore([mp], [op]),
              net: op.value - mp.value, format: "1 for 1",
            });
          }
        }

        // 1v2
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(18); i++) {
            for (let j = i + 1; j < oppCap(18); j++) {
              const op1 = oppTop[i], op2 = oppTop[j];
              if (!isBalanced([mp.value], [op1.value, op2.value])) continue;
              if (!packageOk([op1, op2])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op1, op2])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op1, op2])) continue;
              const adj = tradeWaiverAdj([mp.value], [op1.value, op2.value]);
              results.push({
                give: [mp], receive: [op1, op2], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op1, op2]),
                net: op1.value + op2.value - mp.value - adj, format: "1 for 2",
              });
            }
          }
        }

        // 1v3
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(14); i++) {
            for (let j = i + 1; j < oppCap(14); j++) {
              for (let k = j + 1; k < oppCap(14); k++) {
                const op1 = oppTop[i], op2 = oppTop[j], op3 = oppTop[k];
                if (!isBalanced([mp.value], [op1.value, op2.value, op3.value])) continue;
                if (!packageOk([op1, op2, op3])) continue;
                if (!qbSafe([mp])) continue;
                if (!oppQbSafe(oppPlayers, [op1, op2, op3])) continue;
                if (!oppReceiveOk(oppPlayers, [mp], [op1, op2, op3])) continue;
                const adj = tradeWaiverAdj([mp.value], [op1.value, op2.value, op3.value]);
                results.push({
                  give: [mp], receive: [op1, op2, op3], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp], [op1, op2, op3]),
                  net: op1.value + op2.value + op3.value - mp.value - adj, format: "1 for 3",
                });
              }
            }
          }
        }

        // 1v4
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(10); i++) {
            for (let j = i + 1; j < oppCap(10); j++) {
              for (let k = j + 1; k < oppCap(10); k++) {
                for (let l = k + 1; l < oppCap(10); l++) {
                  const op1 = oppTop[i], op2 = oppTop[j], op3 = oppTop[k], op4 = oppTop[l];
                  if (!isBalanced([mp.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                  if (!packageOk([op1, op2, op3, op4])) continue;
                  if (!qbSafe([mp])) continue;
                  if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                  if (!oppReceiveOk(oppPlayers, [mp], [op1, op2, op3, op4])) continue;
                  const adj = tradeWaiverAdj([mp.value], [op1.value, op2.value, op3.value, op4.value]);
                  results.push({
                    give: [mp], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                    score: posScore([mp], [op1, op2, op3, op4]),
                    net: op1.value + op2.value + op3.value + op4.value - mp.value - adj, format: "1 for 4",
                  });
                }
              }
            }
          }
        }

        // 2v1
        for (let i = 0; i < myCap(18); i++) {
          for (let j = i + 1; j < myCap(18); j++) {
            for (const op of oppTop) {
              const mp1 = myTop[i], mp2 = myTop[j];
              if (!isBalanced([mp1.value, mp2.value], [op.value])) continue;
              if (!myPkgOk([mp1, mp2])) continue;
              if (!qbSafe([mp1, mp2])) continue;
              if (!oppQbSafe(oppPlayers, [op])) continue;
              if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op])) continue;
              const adj = tradeWaiverAdj([mp1.value, mp2.value], [op.value]);
              results.push({
                give: [mp1, mp2], receive: [op], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp1, mp2], [op]),
                net: op.value + adj - mp1.value - mp2.value, format: "2 for 1",
              });
            }
          }
        }

        // 2v2
        for (let i = 0; i < myCap(14); i++) {
          for (let j = i + 1; j < myCap(14); j++) {
            for (let k = 0; k < oppCap(14); k++) {
              for (let l = k + 1; l < oppCap(14); l++) {
                const mp1 = myTop[i], mp2 = myTop[j];
                const op1 = oppTop[k], op2 = oppTop[l];
                if (!isBalanced([mp1.value, mp2.value], [op1.value, op2.value])) continue;
                if (!myPkgOk([mp1, mp2])) continue;
                if (!packageOk([op1, op2])) continue;
                if (!qbSafe([mp1, mp2])) continue;
                if (!oppQbSafe(oppPlayers, [op1, op2])) continue;
                if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op1, op2])) continue;
                results.push({
                  give: [mp1, mp2], receive: [op1, op2], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp1, mp2], [op1, op2]),
                  net: op1.value + op2.value - mp1.value - mp2.value, format: "2 for 2",
                });
              }
            }
          }
        }

        // 2v3
        for (let i = 0; i < myCap(12); i++) {
          for (let j = i + 1; j < myCap(12); j++) {
            for (let k = 0; k < oppCap(12); k++) {
              for (let l = k + 1; l < oppCap(12); l++) {
                for (let m = l + 1; m < oppCap(12); m++) {
                  const mp1 = myTop[i], mp2 = myTop[j];
                  const op1 = oppTop[k], op2 = oppTop[l], op3 = oppTop[m];
                  if (!isBalanced([mp1.value, mp2.value], [op1.value, op2.value, op3.value])) continue;
                  if (!myPkgOk([mp1, mp2])) continue;
                  if (!packageOk([op1, op2, op3])) continue;
                  if (!qbSafe([mp1, mp2])) continue;
                  if (!oppQbSafe(oppPlayers, [op1, op2, op3])) continue;
                  if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op1, op2, op3])) continue;
                  const adj = tradeWaiverAdj([mp1.value, mp2.value], [op1.value, op2.value, op3.value]);
                  results.push({
                    give: [mp1, mp2], receive: [op1, op2, op3], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                    score: posScore([mp1, mp2], [op1, op2, op3]),
                    net: op1.value + op2.value + op3.value - mp1.value - mp2.value - adj, format: "2 for 3",
                  });
                }
              }
            }
          }
        }

        // 2v4
        for (let i = 0; i < myCap(10); i++) {
          for (let j = i + 1; j < myCap(10); j++) {
            for (let k = 0; k < oppCap(10); k++) {
              for (let l = k + 1; l < oppCap(10); l++) {
                for (let m = l + 1; m < oppCap(10); m++) {
                  for (let n = m + 1; n < oppCap(10); n++) {
                    const mp1 = myTop[i], mp2 = myTop[j];
                    const op1 = oppTop[k], op2 = oppTop[l], op3 = oppTop[m], op4 = oppTop[n];
                    if (!isBalanced([mp1.value, mp2.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                    if (!myPkgOk([mp1, mp2])) continue;
                    if (!packageOk([op1, op2, op3, op4])) continue;
                    if (!qbSafe([mp1, mp2])) continue;
                    if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                    if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op1, op2, op3, op4])) continue;
                    const adj = tradeWaiverAdj([mp1.value, mp2.value], [op1.value, op2.value, op3.value, op4.value]);
                    results.push({
                      give: [mp1, mp2], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                      score: posScore([mp1, mp2], [op1, op2, op3, op4]),
                      net: op1.value + op2.value + op3.value + op4.value - mp1.value - mp2.value - adj, format: "2 for 4",
                    });
                  }
                }
              }
            }
          }
        }

        // 3v3
        for (let i = 0; i < myCap(10); i++) {
          for (let j = i + 1; j < myCap(10); j++) {
            for (let k = j + 1; k < myCap(10); k++) {
              const mp1 = myTop[i], mp2 = myTop[j], mp3 = myTop[k];
              if (!myPkgOk([mp1, mp2, mp3])) continue;
              if (!qbSafe([mp1, mp2, mp3])) continue;
              for (let a = 0; a < oppCap(10); a++) {
                for (let b = a + 1; b < oppCap(10); b++) {
                  for (let c = b + 1; c < oppCap(10); c++) {
                    const op1 = oppTop[a], op2 = oppTop[b], op3 = oppTop[c];
                    if (!isBalanced([mp1.value, mp2.value, mp3.value], [op1.value, op2.value, op3.value])) continue;
                    if (!packageOk([op1, op2, op3])) continue;
                    if (!oppQbSafe(oppPlayers, [op1, op2, op3])) continue;
                    if (!oppReceiveOk(oppPlayers, [mp1, mp2, mp3], [op1, op2, op3])) continue;
                    results.push({
                      give: [mp1, mp2, mp3], receive: [op1, op2, op3], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                      score: posScore([mp1, mp2, mp3], [op1, op2, op3]),
                      net: op1.value + op2.value + op3.value - mp1.value - mp2.value - mp3.value, format: "3 for 3",
                    });
                  }
                }
              }
            }
          }
        }

        // 3v4
        for (let i = 0; i < myCap(8); i++) {
          for (let j = i + 1; j < myCap(8); j++) {
            for (let k = j + 1; k < myCap(8); k++) {
              const mp1 = myTop[i], mp2 = myTop[j], mp3 = myTop[k];
              if (!myPkgOk([mp1, mp2, mp3])) continue;
              if (!qbSafe([mp1, mp2, mp3])) continue;
              for (let a = 0; a < oppCap(8); a++) {
                for (let b = a + 1; b < oppCap(8); b++) {
                  for (let c = b + 1; c < oppCap(8); c++) {
                    for (let d = c + 1; d < oppCap(8); d++) {
                      const op1 = oppTop[a], op2 = oppTop[b], op3 = oppTop[c], op4 = oppTop[d];
                      if (!isBalanced([mp1.value, mp2.value, mp3.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                      if (!packageOk([op1, op2, op3, op4])) continue;
                      if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                      if (!oppReceiveOk(oppPlayers, [mp1, mp2, mp3], [op1, op2, op3, op4])) continue;
                      const adj = tradeWaiverAdj([mp1.value, mp2.value, mp3.value], [op1.value, op2.value, op3.value, op4.value]);
                      results.push({
                        give: [mp1, mp2, mp3], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                        score: posScore([mp1, mp2, mp3], [op1, op2, op3, op4]),
                        net: op1.value + op2.value + op3.value + op4.value - mp1.value - mp2.value - mp3.value - adj, format: "3 for 4",
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // 4v4
        for (let i = 0; i < myCap(8); i++) {
          for (let j = i + 1; j < myCap(8); j++) {
            for (let k = j + 1; k < myCap(8); k++) {
              for (let l = k + 1; l < myCap(8); l++) {
                const mp1 = myTop[i], mp2 = myTop[j], mp3 = myTop[k], mp4 = myTop[l];
                if (!myPkgOk([mp1, mp2, mp3, mp4])) continue;
                if (!qbSafe([mp1, mp2, mp3, mp4])) continue;
                for (let a = 0; a < oppCap(8); a++) {
                  for (let b = a + 1; b < oppCap(8); b++) {
                    for (let c = b + 1; c < oppCap(8); c++) {
                      for (let d = c + 1; d < oppCap(8); d++) {
                        const op1 = oppTop[a], op2 = oppTop[b], op3 = oppTop[c], op4 = oppTop[d];
                        if (!isBalanced([mp1.value, mp2.value, mp3.value, mp4.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                        if (!packageOk([op1, op2, op3, op4])) continue;
                        if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                        if (!oppReceiveOk(oppPlayers, [mp1, mp2, mp3, mp4], [op1, op2, op3, op4])) continue;
                        results.push({
                          give: [mp1, mp2, mp3, mp4], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                          score: posScore([mp1, mp2, mp3, mp4], [op1, op2, op3, op4]),
                          net: op1.value + op2.value + op3.value + op4.value - mp1.value - mp2.value - mp3.value - mp4.value, format: "4 for 4",
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }

        const myEqualizerPicks = myFinderPicks.slice(0, 4);
        const oppEqualizerPicks = oppPicks.slice(0, 4);

        // 1 + your pick for 1
        for (const mp of myTop) {
          for (const myPick of myEqualizerPicks) {
            for (const op of oppTop) {
              if (!isBalanced([mp.value, myPick.value], [op.value])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op])) continue;
              const adj = tradeWaiverAdj([mp.value, myPick.value], [op.value]);
              results.push({
                give: [mp], receive: [op], givePicks: [myPick], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op]),
                net: op.value + adj - mp.value - myPick.value, format: "1 + pick for 1",
              });
            }
          }
        }

        // 2 + your pick for 1
        for (let i = 0; i < Math.min(myTop.length, 7); i++) {
          for (let j = i + 1; j < Math.min(myTop.length, 7); j++) {
            const mp1 = myTop[i], mp2 = myTop[j];
            if (!myPkgOk([mp1, mp2])) continue;
            if (!qbSafe([mp1, mp2])) continue;
            for (const myPick of myEqualizerPicks) {
              for (const op of oppTop) {
                if (!isBalanced([mp1.value, mp2.value, myPick.value], [op.value])) continue;
                if (!oppQbSafe(oppPlayers, [op])) continue;
                if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op])) continue;
                const adj = tradeWaiverAdj([mp1.value, mp2.value, myPick.value], [op.value]);
                results.push({
                  give: [mp1, mp2], receive: [op], givePicks: [myPick], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp1, mp2], [op]),
                  net: op.value + adj - mp1.value - mp2.value - myPick.value, format: "2 + pick for 1",
                });
              }
            }
          }
        }

        // 1 for 1 + their pick
        for (const mp of myTop) {
          for (const op of oppTop) {
            for (const oppPick of oppEqualizerPicks) {
              if (!isBalanced([mp.value], [op.value, oppPick.value])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op])) continue;
              const adj = tradeWaiverAdj([mp.value], [op.value, oppPick.value]);
              results.push({
                give: [mp], receive: [op], givePicks: [], receivePicks: [oppPick], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op]),
                net: op.value + oppPick.value - mp.value - adj, format: "1 for 1 + pick",
              });
            }
          }
        }

        // 1 for 2 + their pick
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(8); i++) {
            for (let j = i + 1; j < oppCap(8); j++) {
              const op1 = oppTop[i], op2 = oppTop[j];
              if (!packageOk([op1, op2])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op1, op2])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op1, op2])) continue;
              for (const oppPick of oppEqualizerPicks) {
                if (!isBalanced([mp.value], [op1.value, op2.value, oppPick.value])) continue;
                const adj = tradeWaiverAdj([mp.value], [op1.value, op2.value, oppPick.value]);
                results.push({
                  give: [mp], receive: [op1, op2], givePicks: [], receivePicks: [oppPick], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp], [op1, op2]),
                  net: op1.value + op2.value + oppPick.value - mp.value - adj, format: "1 for 2 + pick",
                });
              }
            }
          }
        }

        // ── Lottery ticket trades for this opponent ───────────────────────────
        // Any player outside the top ~150 dynasty value (< 700) who is young enough
        // to have breakout upside, traded for one of my 3rd+ round picks.
        // Disposition guards: skip "Zero Interest" receives and "Not Willing to Trade" gives.
        const FINDER_LOTTERY_CEILING = 700;
        const myLotteryFinderPicks = myFinderPicks.filter((p: any) =>
          Number(p.round) >= 3 && Number(p.value || 0) > 0 && Number(p.value || 0) < FINDER_LOTTERY_CEILING
        );
        const oppLotteryPlayers = oppPlayers.filter((p: any) => {
          if (isBlockedBuyDisposition(p.player_id)) return false;
          const age = Number(p.age || 99);
          const val = Number(p.value || 0);
          if (val < 60 || val >= FINDER_LOTTERY_CEILING) return false;
          if (p.position === "RB" && age > 23) return false;
          if (p.position === "QB" && age > 26) return false;
          if (["WR", "TE"].includes(p.position) && age > 27) return false;
          return true;
        });
        for (const lp of oppLotteryPlayers) {
          // Pick the single closest-value pick per player so dedup never discards the better one
          const bestPick = myLotteryFinderPicks
            .filter((p: any) => {
              if (playerDispositions[p.player_id]?.sell === "Not Willing to Trade") return false;
              const ratio = lp.value / Math.max(p.value, 1);
              return ratio >= 0.5 && ratio <= 2.0;
            })
            .sort((a: any, b: any) => Math.abs(a.value - lp.value) - Math.abs(b.value - lp.value))[0];
          if (!bestPick) continue;
          results.push({
            give: [], receive: [lp], givePicks: [bestPick], receivePicks: [],
            oppName, oppRosterId: oppRoster.roster_id,
            score: posScore([], [lp]) * 0.6,
            net: lp.value - bestPick.value,
            format: "Lottery",
          });
        }
      }

      const getSortedIds = (items: any[], getId: (item: any) => string) =>
        items.map(getId).filter(Boolean).sort();
      const sameIds = (a: string[], b: string[]) =>
        a.length === b.length && a.every((id, index) => id === b[index]);
      const overlapRatio = (a: string[], b: string[]) => {
        if (!a.length || !b.length) return 0;
        const bSet = new Set(b);
        const overlap = a.filter((id) => bSet.has(id)).length;
        return overlap / Math.min(a.length, b.length);
      };
      const getTradeSimilarityProfile = (trade: any) => {
        const givePlayers = getSortedIds(trade.give, (p: any) => String(p.player_id));
        const receivePlayers = getSortedIds(trade.receive, (p: any) => String(p.player_id));
        const givePicks = getSortedIds(trade.givePicks, (p: any) => finderPickKey(p));
        const receivePicks = getSortedIds(trade.receivePicks, (p: any) => finderPickKey(p));
        return {
          givePlayers,
          receivePlayers,
          givePicks,
          receivePicks,
          allAssets: [
            ...givePlayers.map((id) => `give-player-${id}`),
            ...receivePlayers.map((id) => `receive-player-${id}`),
            ...givePicks.map((id) => `give-pick-${id}`),
            ...receivePicks.map((id) => `receive-pick-${id}`),
          ].sort(),
        };
      };
      const areTradesTooSimilar = (a: any, b: any) => {
        if (String(a.oppRosterId) !== String(b.oppRosterId)) return false;

        const aProfile = getTradeSimilarityProfile(a);
        const bProfile = getTradeSimilarityProfile(b);
        const sameFormat = a.format === b.format;
        const sameReceivePlayers = sameIds(aProfile.receivePlayers, bProfile.receivePlayers);
        const sameGivePlayers = sameIds(aProfile.givePlayers, bProfile.givePlayers);
        const sameReceivePackage = sameReceivePlayers && sameIds(aProfile.receivePicks, bProfile.receivePicks);
        const sameGivePackage = sameGivePlayers && sameIds(aProfile.givePicks, bProfile.givePicks);
        const givePlayerOverlap = overlapRatio(aProfile.givePlayers, bProfile.givePlayers);
        const receivePlayerOverlap = overlapRatio(aProfile.receivePlayers, bProfile.receivePlayers);
        const fullAssetOverlap = overlapRatio(aProfile.allAssets, bProfile.allAssets);

        if (sameFormat && sameReceivePlayers && givePlayerOverlap >= 0.5) return true;
        if (sameFormat && sameGivePlayers && receivePlayerOverlap >= 0.5) return true;
        if (sameFormat && sameReceivePackage && givePlayerOverlap >= 0.5) return true;
        if (sameFormat && sameGivePackage && receivePlayerOverlap >= 0.5) return true;
        if (sameFormat && fullAssetOverlap >= 0.75) return true;
        return false;
      };

      // Deduplicate by player set, filter near-duplicate frameworks, enforce per-player and per-opponent appearance caps, take 15
      const seen = new Set<string>();
      const playerCount: Record<string, number> = {};
      const oppCount: Record<string, number> = {};
      // Hard block: every given player is a true HC RB going to someone who doesn't own the starter.
      const isWrongOwnerHCPackage = (r: TradeResult) => {
        if (r.give.length === 0) return false;
        return r.give.every((gp: any) => {
          if (gp.position !== "RB" || gp.value >= 1400) return false;
          const gpData = (players as any)?.[gp.player_id];
          if (!gpData?.team) return false;
          const gpIdx = getNFLDepthIdx(gpData.team, "RB", gp.player_id);
          if (gpIdx === null || gpIdx === 0) return false;
          const starter = nflTeamDepth.get(gpData.team)?.RB?.[0];
          const oppRoster = rosters.find((ros: any) => ros.roster_id === r.oppRosterId);
          const oppRosterPlayers = oppRoster ? rosterPlayers(oppRoster) : [];
          return !starter || !oppRosterPlayers.some((op: any) => op.player_id === starter.player_id);
        });
      };

      // Positional rank lists for Tier Down quality gates (ranked by dynasty value, desc).
      // Used to enforce that both the given and received player are meaningful starters —
      // not handcuffs or late-bench players — when Tier Down mode is active.
      const tierDownPosRankings: Record<string, string[]> = {};
      if (finderTierDownPos) {
        for (const pos of ["QB", "RB", "WR", "TE"] as const) {
          tierDownPosRankings[pos] = Object.values(players as Record<string, any>)
            .filter((p: any) => p.position === pos && Number(p.value || 0) > 0)
            .sort((a: any, b: any) => b.value - a.value)
            .map((p: any) => p.player_id);
        }
      }
      // Give-side rank cap: the player you're trading away must be a meaningful starter.
      // Receive-side rank cap: the player coming back must still be a real starter (not a scrub).
      const TIER_DOWN_GIVE_RANK:    Record<string, number> = { QB: 14, RB: 16, WR: 20, TE:  8 };
      const TIER_DOWN_RECEIVE_RANK: Record<string, number> = { QB: 24, RB: 32, WR: 40, TE: 14 };

      // Pre-filter: apply all hard blocks except the direction guardrail
      const preGuardrail = results
        .filter((r) => isFinite(r.score))
        .filter((r) => !r.give.some((p: any) => isBlockedSellDisposition(p.player_id)))
        .filter((r) => !r.receive.some((p: any) => isBlockedBuyDisposition(p.player_id)))
        .filter((r) => !pinnedPlayer || r.give.some((p: any) => p.player_id === pinnedPlayer.player_id))
        .filter((r) => !finderTargetPlayerId || r.receive.some((p: any) => p.player_id === finderTargetPlayerId))
        .filter((r) => !isWrongOwnerHCPackage(r))
        // Tank Mode: every received player must be a young prospect — picks-only receive is always ok
        .filter((r) => !finderTankMode || r.receive.every((p: any) => isFutureInsulationAsset(p)))
        .filter((r) => {
          // Tier Down filter: give a high-end starter at the position, receive a lower starter
          // at that same position, with adders to balance. Both players must be within the
          // quality thresholds — no scrub-for-scrub or garbage-player-plus-picks trades.
          if (!finderTierDownPos) return true;
          const pos = finderTierDownPos;
          const posRanking = tierDownPosRankings[pos] ?? [];
          const giveRankCap    = TIER_DOWN_GIVE_RANK[pos];
          const receiveRankCap = TIER_DOWN_RECEIVE_RANK[pos];

          // Keep deals compact — 1-for-2, 1-for-3, 2-for-2 style only. No mega packages.
          if (r.give.length > 2 || r.receive.length > 3) return false;

          const givenAtPos    = r.give.filter((p: any) => p.position === pos);
          const receivedAtPos = r.receive.filter((p: any) => p.position === pos);
          if (givenAtPos.length === 0 || receivedAtPos.length === 0) return false;

          const maxGivenVal    = Math.max(...givenAtPos.map((p: any) => p.value));
          const maxReceivedVal = Math.max(...receivedAtPos.map((p: any) => p.value));
          if (maxReceivedVal >= maxGivenVal) return false;

          // Best given player must rank within the give cap (e.g. top-14 QB)
          const bestGiven   = givenAtPos.reduce((a: any, b: any) => b.value > a.value ? b : a);
          const giveRank    = posRanking.indexOf(bestGiven.player_id) + 1; // 1-indexed, 0 = not found
          if (giveRank === 0 || giveRank > giveRankCap) return false;

          // Best received player must rank within the receive cap (e.g. top-24 QB) — no scrubs
          const bestReceived  = receivedAtPos.reduce((a: any, b: any) => b.value > a.value ? b : a);
          const receiveRank   = posRanking.indexOf(bestReceived.player_id) + 1;
          if (receiveRank === 0 || receiveRank > receiveRankCap) return false;

          return true;
        });
      // Only apply direction guardrail if at least one result survives it — prevents empty results.
      // Tier Down mode and Tank Mode both bypass the guardrail entirely.
      const hasGuardrailPassing = !finderTierDownPos && !finderTankMode && preGuardrail.some((r) => !failsDirectionGuardrail(r));
      // Adjusted direction profile per opponent (uses tradePartnerRankings which has the fully
      // adjusted bucket: dynasty rank + redraft rank + sim + age all combined).
      const oppProfileByRosterId = new Map(
        tradePartnerRankings.map((p: any) => [Number(p.rosterId), p])
      );

      // ── Roster concentration map ────────────────────────────────────────────
      // For each opponent: topOneShare = top-player value / total position value.
      // High topOneShare (>0.60) = "single star" at that position — they desperately
      // need depth there and will be more receptive to receiving that positional help.
      const rosterConcentrationMap = new Map<number, Record<string, number>>();
      for (const rr of rosters.filter((rr: any) => rr.owner_id !== user?.user_id)) {
        const rPlayers = rosterPlayers(rr);
        const concMap: Record<string, number> = {};
        for (const pos of ["QB", "RB", "WR", "TE"]) {
          const posPlayers = rPlayers
            .filter((p: any) => p.position === pos)
            .sort((a: any, b: any) => b.value - a.value);
          const total = posPlayers.reduce((s: number, p: any) => s + (p.value || 0), 0);
          const top1 = posPlayers[0]?.value ?? 0;
          concMap[pos] = total > 0 ? top1 / total : 0;
        }
        rosterConcentrationMap.set(Number(rr.roster_id), concMap);
      }

      // ── Team window compute helper ──────────────────────────────────────────
      // Returns avg years until positional cliffs across the starting lineup.
      // 0 = window closing; 8+ = decade of contention ahead.
      const computeTeamWindow = (rosterPlayersList: any[]): number => {
        const starters = [
          ...rosterPlayersList.filter((p: any) => p.position === "QB").sort((a: any, b: any) => b.value - a.value).slice(0, 1),
          ...rosterPlayersList.filter((p: any) => p.position === "RB").sort((a: any, b: any) => b.value - a.value).slice(0, 2),
          ...rosterPlayersList.filter((p: any) => p.position === "WR").sort((a: any, b: any) => b.value - a.value).slice(0, 3),
          ...rosterPlayersList.filter((p: any) => p.position === "TE").sort((a: any, b: any) => b.value - a.value).slice(0, 1),
        ];
        if (starters.length === 0) return 3;
        return starters.reduce((s: number, p: any) => s + yearsToCliff(p), 0) / starters.length;
      };
      const myTeamWindow = computeTeamWindow(myPlayers);

      // ── PENDING suppression map ──────────────────────────────────────────────
      // For each opponent, track which player IDs appear in ME-initiated PENDING
      // attempts. Suppress trades that re-ask for the same primary player.
      const pendingGiveByOpp  = new Map<number, Set<string>>(); // players I've OFFERED to this opp
      const pendingRecvByOpp  = new Map<number, Set<string>>(); // players I've REQUESTED from this opp
      tradeAttempts
        .filter((a) =>
          a.league_id === selectedLeague?.league_id &&
          a.status === "PENDING" &&
          a.initiated_by === "ME"
        )
        .forEach((a) => {
          const oppId = Number(a.partner_roster_id);
          if (!pendingGiveByOpp.has(oppId)) pendingGiveByOpp.set(oppId, new Set());
          if (!pendingRecvByOpp.has(oppId)) pendingRecvByOpp.set(oppId, new Set());
          a.give_players.forEach((p) => pendingGiveByOpp.get(oppId)!.add(p.player_id));
          a.receive_players.forEach((p) => pendingRecvByOpp.get(oppId)!.add(p.player_id));
        });

      // ── Format win-rate map from logged FINDER attempts ────────────────────
      // Computes acceptance rate per trade format ("2v1", "1v1", etc.) using
      // resolved attempts. ACCEPTED=1.0, COUNTERED=0.5, DECLINED/NO_RESPONSE=0.
      // Requires ≥2 resolved attempts per format to be meaningful.
      const formatWinRates = (() => {
        const resolved = tradeAttempts.filter(
          (a) => a.source === "FINDER" && a.initiated_by === "ME" && a.status !== "PENDING"
        );
        const scores = new Map<string, { score: number; count: number }>();
        for (const a of resolved) {
          const key = `${a.give_players.length + a.give_picks.length}v${a.receive_players.length + a.receive_picks.length}`;
          const pts = a.status === "ACCEPTED" ? 1.0 : a.status === "COUNTERED" ? 0.5 : 0;
          const entry = scores.get(key) ?? { score: 0, count: 0 };
          scores.set(key, { score: entry.score + pts, count: entry.count + 1 });
        }
        const rates = new Map<string, number>();
        scores.forEach(({ score, count }, key) => {
          if (count >= 2) rates.set(key, score / count);
        });
        return rates;
      })();

      // ── Season timing context (computed once outside the per-trade map) ────
      const nflWeek = nflState?.season_type === "regular"
        ? (nflState?.display_week ?? nflState?.week ?? 0)
        : 0;
      const isTradeDeadlineWindow = nflWeek >= 10 && nflWeek <= 13;
      const isEarlySeason         = nflWeek >= 1  && nflWeek <= 5;
      const isLateSeasonPost      = nflWeek >= 14;

      // ── Standings pressure map (computed once, used in standingsPressureScore) ──
      // For each roster: how many games back are they from the last playoff spot,
      // and how many regular-season weeks remain. Only meaningful during the season.
      const playoffTeamCount   = selectedLeague?.settings?.playoff_teams ?? 6;
      const playoffWeekStart   = selectedLeague?.settings?.playoff_week_start ?? 15;
      const weeksRemaining     = nflWeek > 0 ? Math.max(0, (playoffWeekStart - 1) - nflWeek) : 0;

      // Sort rosters by win total (ties = 0.5) descending
      const sortedStandings = [...rosters]
        .map((rr: any) => ({
          rosterId: Number(rr.roster_id),
          wins: (rr.settings?.wins ?? 0) + (rr.settings?.ties ?? 0) * 0.5,
        }))
        .sort((a, b) => b.wins - a.wins);
      const lastPlayoffSpotWins = sortedStandings[playoffTeamCount - 1]?.wins ?? 0;
      const standingsMap = new Map(sortedStandings.map((s, idx) => [s.rosterId, { ...s, playoffRank: idx + 1 }]));

      // ── Known pick slot value helper ─────────────────────────────────────────
      // A pick with a resolved slot ("1.03") is worth far more than an unresolved "Rd 1".
      // Returns bonus (positive = premium above base pick value, negative = discount).
      const getPickSlotBonus = (pick: any): number => {
        const slot = String(pick?.slot ?? "");
        if (!slot.includes(".")) return 0; // unresolved — no slot bonus
        const slotNum = parseInt(slot.split(".")[1], 10);
        if (isNaN(slotNum) || slotNum < 1) return 0;
        const rd = Number(pick?.round ?? 1);
        if (rd === 1) {
          if (slotNum <= 2)  return 10;  // 1.01-1.02: generational pick premium
          if (slotNum <= 4)  return 7;   // top-4
          if (slotNum <= 6)  return 4;   // top-6
          if (slotNum <= 9)  return 1;   // mid-first
          if (slotNum <= 10) return 0;   // 1.10: roughly average
          return -3;                     // 1.11-1.12: "lottery pick" inverse
        }
        if (rd === 2) {
          if (slotNum <= 3)  return 4;
          if (slotNum <= 6)  return 2;
          return 0;
        }
        return 0; // 3rd+ rounds: slot rarely matters much
      };

      // Seeded shuffle so Refresh button produces a new random set
      const shuffled = preGuardrail
        .filter((r) => !!finderTierDownPos || finderTankMode || !hasGuardrailPassing || !failsDirectionGuardrail(r))
        // ── PENDING trade suppression ─────────────────────────────────────────
        // If there's already a PENDING ME-initiated offer with this opponent that
        // involves the same primary player (give OR receive), skip it — we've
        // already asked. Resumes surfacing once the attempt is resolved.
        .filter((r) => {
          const pendingRecv = pendingRecvByOpp.get(Number(r.oppRosterId));
          const pendingGive = pendingGiveByOpp.get(Number(r.oppRosterId));
          if (!pendingRecv && !pendingGive) return true;
          const topRecv = [...r.receive].sort((a: any, b: any) => b.value - a.value)[0];
          if (topRecv && pendingRecv?.has(topRecv.player_id)) return false;
          const topGive = [...r.give].sort((a: any, b: any) => b.value - a.value)[0];
          if (topGive && pendingGive?.has(topGive.player_id)) return false;
          return true;
        })
        .map((r) => {
          const lineupSafety = getTradeLineupSafety(r);
          const partnerProfile = leagueMateProfileByRosterId.get(Number(r.oppRosterId));
          const bucketPriority = draftCapitalMode && r.receivePicks.length > 0
            ? (finderPreferFuturePicks
                // Prefer future: negate max priority so furthest-year picks sort first (most negative wins)
                ? -(Math.max(...r.receivePicks.map((p: any) => draftYearPriority[p.season] ?? 0)))
                : Math.min(...r.receivePicks.map((p: any) => draftYearPriority[p.season] ?? 999)))
            : 999;
          const partnerFitScore =
            (partnerProfile?.fitScore ?? 0) * 0.65 +
            Math.min(partnerProfile?.tradeCount30d ?? 0, 3) * 1.5 +
            Math.min(partnerProfile?.totalDynastyLeagues ?? 0, 8) * 0.35;
          // Disposition scoring: combines deal-probability weighting with direction-aware bonuses/penalties.
          // Example: "Will Trade but Higher than Market" (sell high) in give side + value-negative trade
          // gets a heavy penalty — the user wants a premium, not a discount.
          // "Buy Low" in receive side + value-negative trade = overpaying for something they wanted cheap.
          const sellScoreMap: Record<string, number> = {
            "Trade at All Costs": 4, "Lower than Market": 2, "Neutral": 1,
            "Will Trade but Higher than Market": -1,
          };
          const buyScoreMap: Record<string, number> = {
            "Buy Over Market": 4, "Buy at Market": 2, "Neutral": 1, "Buy Low": -1,
          };
          const dispositionScore = (() => {
            let ds = 0;
            // Base probability scores
            ds += r.give.reduce((s: number, gp: any) =>
              s + (sellScoreMap[playerDispositions[gp.player_id]?.sell ?? "Neutral"] ?? 0), 0);
            ds += r.receive.reduce((s: number, rp: any) =>
              s + (buyScoreMap[playerDispositions[rp.player_id]?.buy ?? "Neutral"] ?? 0), 0);
            // Direction-aware: disposition tags also mean "only do this deal in the RIGHT direction"
            // "Sell High" given away at a loss contradicts the tag — penalize hard
            const sellHighGiven = r.give.filter((gp: any) =>
              playerDispositions[gp.player_id]?.sell === "Will Trade but Higher than Market"
            ).length;
            if (sellHighGiven > 0 && r.net < -150) ds -= sellHighGiven * 8; // losing value, bad
            if (sellHighGiven > 0 && r.net >= 0)   ds += sellHighGiven * 4;  // gaining value, good
            // "Buy Low" received while overpaying contradicts the tag — penalize hard
            const buyLowReceived = r.receive.filter((rp: any) =>
              playerDispositions[rp.player_id]?.buy === "Buy Low"
            ).length;
            if (buyLowReceived > 0 && r.net < -150) ds -= buyLowReceived * 8; // overpaying, bad
            if (buyLowReceived > 0 && r.net >= 0)   ds += buyLowReceived * 5;  // getting them cheap, perfect
            return ds;
          })();
          // ── Opponent direction score ─────────────────────────────────────
          // Score how well what the opponent RECEIVES fits their actual team direction.
          // Uses the fully adjusted bucket (dynasty rank + redraft + sim + age) from
          // tradePartnerRankings so every direction tier gets proper coverage.
          //
          // From the opponent's perspective:
          //   oppReceivesPlayers/Picks = r.give / r.givePicks  (what we send them)
          //   oppGivesPlayers/Picks    = r.receive / r.receivePicks (what they send us)
          const oppDirectionScore = (() => {
            const oppProfile     = oppProfileByRosterId.get(Number(r.oppRosterId));
            const oppPlayoffOdds = oppProfile?.playoffOdds
              ?? selectedLeagueSimulation?.rowByRosterId?.get(Number(r.oppRosterId))?.playoffOdds
              ?? 50;
            const oppBucket = oppProfile?.directionProfile?.bucket ?? "";

            const oppReceivesPlayers = r.give;
            const oppReceivesPicks   = r.givePicks;
            const oppGivesPlayers    = r.receive;
            const oppGivesPicks      = r.receivePicks;

            // Classify opponent into meaningful tiers using both playoff odds and bucket
            const oppIsHopeless   = oppPlayoffOdds < 30 || ["Blow Up", "Hopeless"].includes(oppBucket);
            const oppIsRebuild    = !oppIsHopeless && (oppPlayoffOdds < 50 || oppBucket === "Rebuilder");
            const oppIsElite      = oppPlayoffOdds >= 78 || ["Elite", "True Contender"].includes(oppBucket);
            const oppIsContender  = !oppIsElite && (oppPlayoffOdds >= 65 || oppBucket === "Almost There");
            const oppIsFading     = !oppIsHopeless && !oppIsRebuild && !oppIsElite && !oppIsContender
                                    && (oppPlayoffOdds >= 50 || oppBucket === "Fading Contender");
            // True middle: 45-65% odds, no extreme bucket

            const oppReceivesRedraft = oppReceivesPlayers.reduce((s: number, p: any) => s + (redraftValues?.[p.player_id] ?? 0), 0);
            const oppGivesRedraft    = oppGivesPlayers.reduce((s: number, p: any) => s + (redraftValues?.[p.player_id] ?? 0), 0);
            const oppReceivesYoung   = oppReceivesPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
            const oppReceivesVets    = oppReceivesPlayers.filter((p: any) => isOldProducerBuy(p)).length;
            const oppGivesVets       = oppGivesPlayers.filter((p: any) => isOldProducerBuy(p)).length;
            const oppGivesYoung      = oppGivesPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;

            // Round-aware pick scoring: 1st rounds are worth far more than 3rds to rebuild/hopeless
            const pickRecvScore = (base1st: number, base2nd: number, baseLate: number) =>
              oppReceivesPicks.reduce((s: number, p: any) => {
                const rd = Number(p.round);
                return s + (rd === 1 ? base1st : rd === 2 ? base2nd : baseLate);
              }, 0);
            const pickGiveScore = (base1st: number, base2nd: number, baseLate: number) =>
              oppGivesPicks.reduce((s: number, p: any) => {
                const rd = Number(p.round);
                return s + (rd === 1 ? base1st : rd === 2 ? base2nd : baseLate);
              }, 0);

            let ods = 0;

            if (oppIsHopeless) {
              // Blow Up / Hopeless: maximise future capital, get out of veteran contracts
              ods += pickRecvScore(16, 10, 6);       // 1st picks are gold to a tanker
              ods += oppReceivesYoung * 9;
              ods -= oppReceivesVets * 10;
              ods += oppGivesVets * 8;
              ods -= pickGiveScore(12, 8, 4);        // giving up a 1st to tank is catastrophic
              ods -= oppGivesYoung * 8;
              // Hard mismatch: sending them only veterans when they're blowing up
              if (oppReceivesVets > 0 && oppReceivesPicks.length === 0 && oppReceivesYoung === 0) ods -= 12;

            } else if (oppIsRebuild) {
              // Rebuilder: wants picks and youth, happy to move floor production
              ods += pickRecvScore(12, 7, 4);        // 1st rounds > 3rds for rebuilders
              ods += oppReceivesYoung * 7;
              ods -= oppReceivesVets * 7;
              ods += oppGivesVets * 5;
              ods -= pickGiveScore(8, 5, 2);
              ods -= oppGivesYoung * 5;
              if (oppReceivesVets > 0 && oppReceivesPicks.length === 0 && oppReceivesYoung === 0) ods -= 9;

            } else if (oppIsElite) {
              // Elite / True Contender: wants production NOW — picks are worthless to them
              const netRedraft = oppReceivesRedraft - oppGivesRedraft;
              ods += Math.min(netRedraft / 40, 12);
              ods -= pickRecvScore(12, 8, 5);        // even 1st picks feel abstract to a contender
              ods -= pickGiveScore(4, 3, 2);
              ods += oppReceivesVets * 5;
              ods -= oppReceivesYoung * 6;
              // Hard mismatch: sending picks to a contender
              if (oppReceivesPlayers.length === 0 && oppReceivesPicks.length > 0) ods -= 14;

            } else if (oppIsContender) {
              // Almost There: wants positional upgrades, tolerates minor pick cost
              const netRedraft = oppReceivesRedraft - oppGivesRedraft;
              ods += Math.min(netRedraft / 50, 8);
              ods -= pickRecvScore(8, 5, 3);
              ods -= oppReceivesYoung * 3;
              ods += oppReceivesVets * 4;
              if (oppReceivesPlayers.length === 0 && oppReceivesPicks.length > 0) ods -= 10;

            } else if (oppIsFading) {
              // Fading Contender: leaning on current production for one more run
              const netRedraft = oppReceivesRedraft - oppGivesRedraft;
              ods += Math.min(netRedraft / 55, 6);
              ods -= pickRecvScore(6, 4, 2);
              ods += oppReceivesVets * 2;
              ods -= oppGivesVets * 3;

            } else {
              // True middle: balanced, mild preference for current production
              const netRedraft = oppReceivesRedraft - oppGivesRedraft;
              ods += Math.min(netRedraft / 70, 4);
              ods -= pickRecvScore(4, 2, 1);
              ods += oppReceivesYoung * 2;
            }

            // Universal bonus: opponent keeps their own picks (less to give up = easier yes)
            if (oppGivesPicks.length === 0 && (oppIsRebuild || oppIsHopeless)) ods += 3;

            // ── Opponent positional need targeting ────────────────────────────
            // Score how well what we're sending them addresses their SPECIFIC
            // roster weaknesses (not just their general direction tier).
            // A contender who is dead-last at WR will jump at a WR deal.
            const oppPosRanks = (oppProfile?.directionProfile?.positionRanks ?? []) as Array<{ pos: string; rank: number }>;
            const oppConc = rosterConcentrationMap.get(Number(r.oppRosterId)) ?? {};
            if (oppPosRanks.length > 0) {
              const oppWeakPos = new Set(
                oppPosRanks
                  .filter((pr: any) => pr.rank >= Math.ceil(numTeams * 0.6))
                  .map((pr: any) => pr.pos)
              );
              const oppStrongPos = new Set(
                oppPosRanks
                  .filter((pr: any) => pr.rank <= Math.ceil(numTeams * 0.3))
                  .map((pr: any) => pr.pos)
              );
              // Sending them a player at their weakest position = they need this.
              // Extra bonus when they have a single-star concentration (top player dominates the group
              // and they desperately need another contributor to not be a one-injury disaster).
              oppReceivesPlayers
                .filter((p: any) => oppWeakPos.has(p.position) && p.value >= 1500)
                .forEach((p: any) => {
                  const conc = oppConc[p.position] ?? 0;
                  ods += 7 + (conc > 0.65 ? 4 : conc > 0.50 ? 2 : 0);
                });
              // Sending them depth at a position they're already stacked at = low interest
              const surplusGiven = oppReceivesPlayers.filter(
                (p: any) => oppStrongPos.has(p.position) && p.value >= 2000
              ).length;
              ods -= surplusGiven * 3;
              // Asking them to give up their strongest position = reluctance
              const demandedStrength = oppGivesPlayers.filter(
                (p: any) => oppStrongPos.has(p.position) && p.value >= 2000
              ).length;
              ods -= demandedStrength * 4;
            }

            // ── SuperFlex QB gap detection ─────────────────────────────────────
            // In SF leagues, QB depth is the most critical positional need.
            // If opponent is bottom-half at QB in a SF league, sending them a QB
            // is a massive deal; asking for their QB (already scarce) is a non-starter.
            if (hasSuperFlex && oppPosRanks.length > 0) {
              const oppQBRank = oppPosRanks.find((pr: any) => pr.pos === "QB")?.rank ?? numTeams;
              if (oppQBRank >= Math.ceil(numTeams * 0.5)) {
                const qbsReceived = oppReceivesPlayers.filter((p: any) => p.position === "QB").length;
                if (qbsReceived > 0) ods += 9;
                const qbsDemanded = oppGivesPlayers.filter((p: any) => p.position === "QB").length;
                if (qbsDemanded > 0) ods -= 8;
              }
            }

            // ── Injury replacement targeting ──────────────────────────────────
            // If the opponent has a meaningful starter on IR/Out, they have an
            // urgent positional hole. Sending a replacement at that exact position
            // is the highest-acceptance scenario — it solves an active, visible crisis.
            {
              const oppRosterForInjury = rosters.find((ros: any) => Number(ros.roster_id) === Number(r.oppRosterId));
              if (oppRosterForInjury) {
                const oppAllPlayers = rosterPlayers(oppRosterForInjury);
                const playersMapLocal = players as Record<string, any>;
                const injStatuses = new Set(["ir", "out", "dnr", "pup"]);
                const injuredPositions = new Set<string>();
                oppAllPlayers.forEach((p: any) => {
                  const inj = (playersMapLocal[p.player_id]?.injury_status ?? "").toLowerCase();
                  // Only flag meaningful starters (value ≥ 2000) — ignore bench/handcuff injuries
                  if (injStatuses.has(inj) && (p.value ?? 0) >= 2000) {
                    injuredPositions.add(p.position);
                  }
                });
                if (injuredPositions.size > 0) {
                  // We're sending a capable replacement to their injured position
                  const emergencyFills = oppReceivesPlayers.filter(
                    (p: any) => injuredPositions.has(p.position) && (p.value ?? 0) >= 1500
                  ).length;
                  ods += emergencyFills * 11;  // emergency fill = strongest possible acceptance signal
                  // Asking them to give away their replacement at an injured position = very reluctant
                  const takingReplacement = oppGivesPlayers.filter(
                    (p: any) => injuredPositions.has(p.position) && (p.value ?? 0) >= 1500
                  ).length;
                  ods -= takingReplacement * 7;
                }
              }
            }

            return ods;
          })();

          // ── Format preference score ───────────────────────────────────────
          // Strongly prefer 1v1, 2v1, 1v2, and 2v2 trades over larger packages.
          // Scores taper off sharply as total piece count rises above 4.
          const formatBonus = (() => {
            const totalGive = r.give.length + r.givePicks.length;
            const totalRecv = r.receive.length + r.receivePicks.length;
            const total = totalGive + totalRecv;
            if (total === 2) return 8;            // 1v1 — cleanest possible trade
            if (total === 3) return 6;            // 2v1 or 1v2
            if (totalGive === 2 && totalRecv === 2) return 5; // 2v2
            if (total === 4) return 3;            // 1v3, 3v1 (less common but passable)
            if (total === 5) return 0;            // 2v3, 3v2
            if (total === 6) return -3;           // 3v3, 2v4
            return -7;                            // 4+ piece mega-trades
          })();

          // ── Handcuff awareness (RB) — depth-chart aware ─────────────────
          // Uses the same nflTeamDepth map as DataHub so starter/HC roles are consistent.
          // Players with dynasty value ≥ 1400 have standalone value and are NOT treated as
          // handcuffs — no bonus or penalty applies to them regardless of depth position.
          // True handcuffs (< 1400) scale by depth: idx 1 = full, idx 2 = half, idx 3+ = quarter.
          const HC_VALUE_THRESHOLD = 1400;
          const handcuffBonus = (() => {
            let hb = 0;
            const oppRosterForHandcuff = rosters.find((ros: any) => ros.roster_id === r.oppRosterId);
            const oppRosterPlayers = oppRosterForHandcuff ? rosterPlayers(oppRosterForHandcuff) : [];

            for (const gp of r.give) {
              if (gp.position !== "RB") continue;
              const gpData = (players as any)?.[gp.player_id];
              if (!gpData?.team) continue;
              const gpIdx = getNFLDepthIdx(gpData.team, "RB", gp.player_id);
              if (gpIdx === null) continue;

              if (gpIdx === 0) {
                // Starter — bonus if opponent also owns the primary backup (symbiotic pair)
                const rb2 = nflTeamDepth.get(gpData.team)?.RB?.[1];
                if (rb2 && oppRosterPlayers.some((op: any) => op.player_id === rb2.player_id)) hb += 4;
              } else if (gp.value < HC_VALUE_THRESHOLD) {
                // True handcuff (no standalone value) — apply owner-match bonus/penalty
                const scale = gpIdx === 1 ? 1.0 : gpIdx === 2 ? 0.5 : 0.25;
                const starter = nflTeamDepth.get(gpData.team)?.RB?.[0];
                const oppOwnsStarter = !!starter && oppRosterPlayers.some((op: any) => op.player_id === starter.player_id);
                if (oppOwnsStarter) {
                  hb += Math.round(6 * scale);  // sending HC to right owner — elevated interest
                } else {
                  hb -= Math.round(30 * scale);  // sending HC to wrong owner — heavily penalised
                }
              }
              // value ≥ 1400 at depth > 0: standalone player, skip HC logic entirely
            }

            for (const rp of r.receive) {
              if (rp.position !== "RB") continue;
              const rpData = (players as any)?.[rp.player_id];
              if (!rpData?.team) continue;
              const rpIdx = getNFLDepthIdx(rpData.team, "RB", rp.player_id);
              if (rpIdx === null || rpIdx === 0) continue; // receiving a starter — no HC bonus
              if (rp.value >= HC_VALUE_THRESHOLD) continue; // standalone value — not a true HC
              // Receiving a true handcuff — bonus if I own the starter, scaled by depth
              const scale = rpIdx === 1 ? 1.0 : rpIdx === 2 ? 0.5 : 0.25;
              const starter = nflTeamDepth.get(rpData.team)?.RB?.[0];
              const iOwnStarter = !!starter && myPlayers.some((mp: any) => mp.player_id === starter.player_id);
              if (iOwnStarter) hb += Math.round(4 * scale);
            }

            return hb;
          })();

          // ── Balance penalty (soft) ────────────────────────────────────────
          // Trades further from even are progressively less desirable.
          // ±150 net = -3, ±300 = ~-8.5, ±450 = ~-15.6, ±600 = ~-24.
          // Not a hard cap — compelling strategic trades can still surface.
          const balancePenalty = -Math.pow(Math.abs(r.net) / 150, 1.5) * 3;

          // ── Future pick bonus (Draft Capital Mode) ────────────────────────
          // When "Prefer Future Picks" is on, reward picks from future years
          // and penalize picks from the current year.
          const futurePickBonus = (() => {
            if (!draftCapitalMode || !finderPreferFuturePicks || r.receivePicks.length === 0) return 0;
            const currentYear = Number(CURRENT_YEAR);
            return r.receivePicks.reduce((s: number, p: any) => {
              const yr = Number(p.season);
              if (yr === currentYear) return s - 4;
              if (yr === currentYear + 1) return s + 5;
              return s + 7; // 2+ years out
            }, 0);
          })();

          // ── Attempt intelligence score ────────────────────────────────────
          // Mines the trade_attempts history for this league/opponent to surface
          // two distinct signals:
          //
          //   THEM-initiated trades  → reveals what they want to SELL (their give_players)
          //                            and what they're TARGETING from my roster (their receive_players).
          //                            A declined-by-me or pending offer from them is strong sell intent —
          //                            it doesn't mean they've given up, just that the value wasn't right.
          //
          //   ME-initiated trades    → reveals which players I'm willing to shop (my give_players)
          //                            and the direction I'm building toward (my receive_players).
          //                            Even if they declined, those are still MY stated intentions.
          //
          // Scoring philosophy:
          //   • Their sell intent on a receive player   → big boost (they want to move it, deal is likely)
          //   • Their buy intent on a give player       → big boost (they've literally asked for this)
          //   • My own shop history on a give player    → small boost (confirms my direction)
          //   • My own target history on a receive      → medium boost (I've been chasing this)
          //   • Receiving a player they're BUYING (not selling) → penalty (they won't part with it)
          //   Recency: attempts within 14 days are full weight; 14–56 days are half weight.
          const attemptIntelScore = (() => {
            if (!selectedLeague?.league_id || tradeAttempts.length === 0) return 0;
            const now = Date.now();
            const FULL_WINDOW  = 14 * 24 * 60 * 60 * 1000; // 14 days → full weight
            const HALF_WINDOW  = 56 * 24 * 60 * 60 * 1000; // 56 days → half weight, beyond = ignore
            const weight = (iso: string) => {
              const age = now - new Date(iso).getTime();
              if (age <= FULL_WINDOW) return 1.0;
              if (age <= HALF_WINDOW) return 0.5;
              return 0;
            };

            const oppAttempts = tradeAttempts.filter(
              (a) => a.league_id === selectedLeague.league_id &&
                     Number(a.partner_roster_id) === Number(r.oppRosterId)
            );
            if (oppAttempts.length === 0) return 0;

            // Weighted signal sets
            const theirSellWeight   = new Map<string, number>(); // they offered → sell intent
            const theirBuyWeight    = new Map<string, number>(); // they wanted from me → buy intent
            const myShopWeight      = new Map<string, number>(); // I offered → my shop intent
            const myTargetWeight    = new Map<string, number>(); // I wanted → my build direction

            for (const a of oppAttempts) {
              const w = weight(a.attempted_at);
              if (w === 0) continue;
              if (a.initiated_by === "THEM") {
                for (const p of a.give_players)    theirSellWeight.set(p.player_id,  (theirSellWeight.get(p.player_id)  ?? 0) + w);
                for (const p of a.receive_players) theirBuyWeight.set(p.player_id,   (theirBuyWeight.get(p.player_id)   ?? 0) + w);
              } else {
                for (const p of a.give_players)    myShopWeight.set(p.player_id,     (myShopWeight.get(p.player_id)     ?? 0) + w);
                for (const p of a.receive_players) myTargetWeight.set(p.player_id,   (myTargetWeight.get(p.player_id)   ?? 0) + w);
              }
            }

            let ais = 0;

            for (const rp of (r.receive ?? [])) {
              const sellW = theirSellWeight.get(rp.player_id) ?? 0;
              const buyW  = theirBuyWeight.get(rp.player_id)  ?? 0;
              if (sellW > 0) ais += 7 * sellW;  // they've been trying to move this → very receptive
              if (buyW  > 0) ais -= 6 * buyW;   // they've been ACQUIRING this → won't part with it
              const targetW = myTargetWeight.get(rp.player_id) ?? 0;
              if (targetW > 0) ais += 5 * targetW; // I've been chasing this player
            }

            for (const gp of (r.give ?? [])) {
              const buyW  = theirBuyWeight.get(gp.player_id)  ?? 0;
              if (buyW  > 0) ais += 9 * buyW;   // they've specifically asked for this from me → strongest signal
              const shopW = myShopWeight.get(gp.player_id)    ?? 0;
              if (shopW > 0) ais += 3 * shopW;  // confirms my own stated sell direction
            }

            return ais;
          })();

          // ── Market intelligence score ─────────────────────────────────────
          // Value trend momentum: reward selling declining assets and buying rising
          // ones. Penalise buying into falling players. Injury awareness: flag IR/Out
          // players as low-acceptance (opponent unlikely to want them) or buy-low
          // targets when receiving from the opponent.
          const marketIntelScore = (() => {
            let mis = 0;
            const playersMap = players as Record<string, any>;
            const injuredStatuses = new Set(["ir", "out", "dnr", "pup", "nfi"]);

            // ── Value trend (give side) ────────────────────────────────────
            for (const gp of r.give) {
              const snapVal = historicalSnapshot?.players?.[gp.player_id]?.value;
              if (snapVal && snapVal > 50 && gp.value > 50) {
                const pct = (gp.value - snapVal) / snapVal;
                if (pct <= -0.08) mis += 5;       // heavy faller — sell now before more decay
                else if (pct <= -0.04) mis += 3;   // mild faller
                else if (pct >= 0.10) mis += 4;    // sell-high: capitalise on peak value
                else if (pct >= 0.06) mis += 2;    // mild sell-high window
              }
              // Injury penalty: opponent less likely to accept IR/Out players
              const inj = (playersMap[gp.player_id]?.injury_status ?? "").toLowerCase();
              if (injuredStatuses.has(inj)) mis -= 4;
              // Years-experience longevity signal: 7+ years = extra decline risk
              const exp = Number(playersMap[gp.player_id]?.years_exp ?? -1);
              if (exp >= 7 && gp.value >= 1500) mis += 2;  // sell before the year 8-9 cliff
              // Amplify urgency for aging high-value assets using continuous curve
              const urgency = getAgeUrgency(gp);
              if (urgency >= 0.70 && gp.value >= 2000) mis += Math.round(urgency * 3);
            }

            // ── Value trend (receive side) ─────────────────────────────────
            for (const rp of r.receive) {
              const snapVal = historicalSnapshot?.players?.[rp.player_id]?.value;
              if (snapVal && snapVal > 50 && rp.value > 50) {
                const pct = (rp.value - snapVal) / snapVal;
                if (pct >= 0.10) mis += 5;         // buying a surging player — catch the upside
                else if (pct >= 0.06) mis += 3;    // steady riser
                else if (pct <= -0.08) mis -= 5;   // heavy faller — catching a falling knife
                else if (pct <= -0.04) mis -= 3;   // mild faller — caution
              }
              // Injury buy-low: receiving an IR player at still-elevated dynasty value
              const inj = (playersMap[rp.player_id]?.injury_status ?? "").toLowerCase();
              if (injuredStatuses.has(inj) && rp.value >= 2500) mis += 3; // buy-low window
              else if (injuredStatuses.has(inj)) mis -= 2; // low-value injured = avoid
            }

            return mis;
          })();

          // ── Archetype win-rate bonus ──────────────────────────────────────
          // Surfaces trade formats you've historically been able to close.
          // Penalises formats that have consistently stalled or been declined.
          // Requires ≥2 resolved FINDER attempts per format to kick in.
          const archetypeWinRateBonus = (() => {
            const key = `${r.give.length + r.givePicks.length}v${r.receive.length + r.receivePicks.length}`;
            const rate = formatWinRates.get(key);
            if (rate === undefined) return 0;
            if (rate >= 0.75) return 5;
            if (rate >= 0.55) return 3;
            if (rate >= 0.35) return 0;
            if (rate >= 0.15) return -3;
            return -5;
          })();

          // ── Season timing bonus ───────────────────────────────────────────
          // Amplifies contender urgency at the trade deadline, rewards buy-low
          // grabs in early season, and pushes rebuilders toward pick-stacking
          // late in the year. No-ops during the off-season (nflWeek === 0).
          const seasonTimingBonus = (() => {
            if (nflWeek === 0) return 0;
            let stb = 0;
            const isContenderish = !iAmTankingFinder && ["Elite", "True Contender", "Almost There", "Fading Contender"].includes(finderDirection);
            const isRebuilder = iAmTankingFinder || ["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection);
            const buyLowSet = new Set(buyLowPlayerIds);

            if (isTradeDeadlineWindow) {
              // Weeks 10-13: contenders are most willing to overpay; rebuilders should capitalise
              if (isContenderish) stb += 4;
              if (isRebuilder) stb += r.give.filter((p: any) => isOldProducerBuy(p)).length * 3;
              // Opponent contenders are desperate too
              const oppBucketDeadline = oppProfileByRosterId.get(Number(r.oppRosterId))?.directionProfile?.bucket ?? "";
              if (["Elite", "True Contender", "Almost There"].includes(oppBucketDeadline)) stb += 3;
            }

            if (isEarlySeason) {
              // Weeks 1-5: buy-low on slow starters before the market reacts
              stb += r.receive.filter((p: any) => buyLowSet.has(p.player_id)).length * 3;
              // Sell early hot-starters before value peaks (up 8%+ since snapshot)
              stb += r.give.filter((p: any) => {
                const snap = historicalSnapshot?.players?.[p.player_id]?.value;
                return snap && snap > 50 && p.value > snap * 1.08;
              }).length * 2;
            }

            if (isLateSeasonPost) {
              // Weeks 14+: rebuilders should stack picks for the off-season haul
              if (isRebuilder) stb += r.receivePicks.length * 2;
              // Giving picks late when tanking is counter-productive
              if (iAmTankingFinder && r.givePicks.length > 0) stb -= r.givePicks.length * 3;
            }

            return stb;
          })();

          // ── Usage signal score ────────────────────────────────────────────
          // Uses rolling snap%, target share, and carry rates from the last 4
          // weeks of Sleeper actuals. Also uses 2-week recent trend vs. baseline
          // to detect collapsing/surging usage before the market reacts.
          // Off-season: always returns 0 (no data available).
          const usageSignalScore = (() => {
            if (!playerStats) return 0;
            let uss = 0;

            for (const gp of r.give) {
              const u = playerStats[gp.player_id];
              if (!u || u.gamesPlayed < 2) continue;
              // Baseline signals (4-week avg)
              if ((gp.position === "WR" || gp.position === "TE") && u.avgTargets >= 8) uss -= 4;
              if ((gp.position === "WR" || gp.position === "TE") && u.avgTargets <= 3 && gp.value >= 2000) uss += 4;
              if (gp.position === "RB" && u.avgCarries >= 15) uss -= 4;
              if (gp.position === "RB" && u.avgCarries <= 5 && gp.value >= 2000) uss += 4;
              if (u.snapPct < 0.20 && gp.value >= 2000) uss += 5;
              else if (u.snapPct < 0.40 && gp.value >= 3000) uss += 3;
              // Trend signals: sell before market catches up to declining usage
              const gpTT = u.targetTrend ?? 0, gpCT = u.carryTrend ?? 0, gpST = u.snapTrend ?? 0;
              if ((gp.position === "WR" || gp.position === "TE") && gpTT <= -3) uss += 4;
              if ((gp.position === "WR" || gp.position === "TE") && gpTT >= 3) uss -= 3;
              if (gp.position === "RB" && gpCT <= -4) uss += 3;
              if (gp.position === "RB" && gpCT >= 4) uss -= 3;
              if (gpST <= -0.15 && gp.value >= 2000) uss += 3;
            }

            for (const rp of r.receive) {
              const u = playerStats[rp.player_id];
              if (!u || u.gamesPlayed < 2) continue;
              // Baseline signals
              if ((rp.position === "WR" || rp.position === "TE") && u.avgTargets >= 8) uss += 4;
              if ((rp.position === "WR" || rp.position === "TE") && u.avgTargets <= 3 && rp.value >= 2000) uss -= 4;
              if (rp.position === "RB" && u.avgCarries >= 15) uss += 4;
              if (rp.position === "RB" && u.avgCarries <= 5 && rp.value >= 2000) uss -= 4;
              if (u.snapPct < 0.20 && rp.value >= 3000) uss += 5;
              // Trend signals: buy surging usage before market reacts
              const rpTT = u.targetTrend ?? 0, rpCT = u.carryTrend ?? 0, rpST = u.snapTrend ?? 0;
              if ((rp.position === "WR" || rp.position === "TE") && rpTT >= 3) uss += 4;
              if ((rp.position === "WR" || rp.position === "TE") && rpTT <= -3) uss -= 3;
              if (rp.position === "RB" && rpCT >= 4) uss += 3;
              if (rp.position === "RB" && rpCT <= -4) uss -= 3;
              if (rpST >= 0.15 && rp.value >= 1500) uss += 3;
            }

            return uss;
          })();

          // ── Team window score ─────────────────────────────────────────────
          // Factors in how many "contending years" each side has left based on
          // average starter age. Short-window teams (cliffs approaching) should
          // be buying current production and selling future picks; long-window
          // teams should be building dynasty assets.
          const teamWindowBonus = (() => {
            let twb = 0;
            const isContenderish = !iAmTankingFinder && ["Elite", "True Contender", "Almost There", "Fading Contender"].includes(finderDirection);
            const isRebuilder = iAmTankingFinder || ["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection);

            // My window signals
            if (myTeamWindow < 2.5) {
              // Imminent cliff — every trade should be maximising NOW
              twb += r.receive.filter((p: any) => isOldProducerBuy(p)).length * 4;
              twb -= r.receive.filter((p: any) => isFutureInsulationAsset(p)).length * 3;
              twb -= r.receivePicks.length * 2;
              twb += r.give.filter((p: any) => getFutureValue(p) >= 0.7).length * 2; // ok to move young pieces
            } else if (myTeamWindow > 5.5 && isRebuilder) {
              // Long window ahead — protect youth and accumulate future picks
              twb += r.receive.filter((p: any) => isFutureInsulationAsset(p)).length * 3;
              twb += r.receivePicks.filter((p: any) => Number(p.round) === 1).length * 3;
              twb -= r.give.filter((p: any) => isFutureInsulationAsset(p)).length * 3;
            } else if (myTeamWindow >= 2.5 && myTeamWindow <= 4.5 && isContenderish) {
              // Sweet spot: peak contention window — reward positional upgrades
              twb += r.receive.filter((p: any) => getAgeUrgency(p) >= 0.40 && getAgeUrgency(p) < 0.80).length * 2;
            }

            // Opponent window alignment bonus
            const oppRosterForWindow = rosters.find((ros: any) => ros.roster_id === r.oppRosterId);
            if (oppRosterForWindow) {
              const oppWin = computeTeamWindow(rosterPlayers(oppRosterForWindow));
              // They have a short window and we're sending them current production = aligns perfectly
              if (oppWin < 2.5 && oppDirectionScore > 0) twb += 2;
              // They have a long window but we're sending them old vets = misaligned
              if (oppWin > 5.5 && r.give.filter((p: any) => isOldProducerBuy(p)).length > 0) twb -= 2;
            }

            return twb;
          })();

          // ── Starter vs bench quality detection ───────────────────────────
          // Rewards trades where you're sending a bench piece and receiving a
          // player who immediately starts on your roster, or upgrades a weak
          // starter slot. Penalises giving away a starter for a bench piece.
          const starterQualityBonus = (() => {
            let sqb = 0;
            for (const gp of r.give) {
              const myPosGroup = myPlayers
                .filter((p: any) => p.position === gp.position)
                .sort((a: any, b: any) => b.value - a.value);
              const giveRank = myPosGroup.findIndex((p: any) => p.player_id === gp.player_id) + 1;
              const slots = starterCounts[gp.position] || 0;
              if (giveRank > 0 && giveRank > slots) sqb += 3;   // giving a bench player = we retain starters
              if (giveRank > 0 && giveRank === 1) sqb -= 3;      // giving away our best at pos = costly
            }
            const myPlayersAfterTrade = buildPostTradePlayers(myRoster, r.give, r.receive);
            for (const rp of r.receive) {
              const posAfterTrade = myPlayersAfterTrade
                .filter((p: any) => p.position === rp.position)
                .sort((a: any, b: any) => b.value - a.value);
              const recvRank = posAfterTrade.findIndex((p: any) => p.player_id === rp.player_id) + 1;
              const slots = starterCounts[rp.position] || 0;
              if (recvRank > 0 && recvRank <= slots) sqb += 4;   // immediate starter on my team
              // Extra if it directly upgrades a weak starter slot (replacing someone ranked bottom-half)
              const displacedPlayer = posAfterTrade[recvRank];  // player bumped out of lineup
              if (displacedPlayer && recvRank > 0 && recvRank <= slots) {
                const myPre = myPlayers.filter((p: any) => p.position === rp.position).sort((a: any, b: any) => b.value - a.value);
                const weakBenchmark = myPre[slots - 1]?.value ?? 0; // current weakest starter
                if (rp.value > weakBenchmark * 1.15) sqb += 2;  // meaningful upgrade, not just lateral
              }
            }
            return sqb;
          })();

          // ── Active trader bonus ───────────────────────────────────────────
          // Opponents who are actively engaged (recent THEM-initiated attempts,
          // or many logged interactions) are more likely to respond and deal.
          // Uses trade_attempts data as an engagement proxy — no new API needed.
          const activeTraderBonus = (() => {
            if (tradeAttempts.length === 0) return 0;
            const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
            const now = Date.now();
            const oppId = Number(r.oppRosterId);
            const oppRecentAttempts = tradeAttempts.filter(
              (a) =>
                a.league_id === selectedLeague?.league_id &&
                Number(a.partner_roster_id) === oppId &&
                now - new Date(a.attempted_at).getTime() < THIRTY_DAYS
            );
            // THEM-initiated attempts = they are actively trying to make deals
            const theirInitiated = oppRecentAttempts.filter((a) => a.initiated_by === "THEM").length;
            // Total engagement (any attempts) = relationship exists, dialogue is open
            const totalEngagement = oppRecentAttempts.length;
            let atb = 0;
            if (theirInitiated >= 2) atb += 5;  // highly active seller/buyer — very likely to engage
            else if (theirInitiated === 1) atb += 3;
            if (totalEngagement >= 3) atb += 2;  // active trade relationship, they respond
            // If they've ACCEPTED a past trade from us, they're a proven deal-maker
            const pastAccepted = oppRecentAttempts.filter((a) => a.status === "ACCEPTED").length;
            if (pastAccepted > 0) atb += 3;
            // If they've DECLINED everything, slight penalty (low deal probability)
            const allDeclined = oppRecentAttempts.length > 0 &&
              oppRecentAttempts.every((a) => a.status === "DECLINED" || a.status === "NO_RESPONSE");
            if (allDeclined && oppRecentAttempts.length >= 2) atb -= 4;
            return atb;
          })();

          // ── Cross-league exposure bonus ───────────────────────────────────
          // Players you own in 3+ leagues represent concentrated portfolio risk.
          // Slightly favors trading them to diversify across your dynasty holdings.
          // Players owned in only 1 league (this one) have no special signal.
          const exposureBonus = (() => {
            if (!crossLeagueExposure) return 0;
            let eb = 0;
            for (const gp of r.give) {
              const count = crossLeagueExposure[gp.player_id]?.count ?? 1;
              if (count >= 4) eb += 4;       // 4+ leagues: high concentration — diversify
              else if (count >= 3) eb += 2;  // 3 leagues: moderate concentration
            }
            for (const rp of r.receive) {
              const count = crossLeagueExposure[rp.player_id]?.count ?? 0;
              if (count === 0) eb += 2;  // acquiring someone you don't own elsewhere = diversification gain
              if (count >= 4) eb -= 3;   // buying someone you're already overexposed to
            }
            return eb;
          })();

          // ── Standings pressure score ──────────────────────────────────────
          // How close the opponent is to the playoff bubble + how much time is
          // left changes their psychology dramatically.
          //   Desperate (1-2 games back, ≤5 weeks left):  win-now trades get big boost
          //   Comfortable (in playoffs by 2+):             less urgency, harder to move
          //   Eliminated (3+ back late season):            flips to rebuild mode
          // Off-season / week 0: always returns 0.
          const standingsPressureScore = (() => {
            if (nflWeek === 0 || weeksRemaining <= 0) return 0;
            const oppStanding = standingsMap.get(Number(r.oppRosterId));
            if (!oppStanding) return 0;
            const gamesBack = Math.max(0, lastPlayoffSpotWins - oppStanding.wins);
            const inPlayoffs = oppStanding.playoffRank <= playoffTeamCount;
            let sps = 0;

            // Opponent in desperation zone: close to bubble with limited time
            const isDesperate = !inPlayoffs && gamesBack <= 2 && weeksRemaining <= 5;
            const isEliminated = !inPlayoffs && (gamesBack > weeksRemaining || gamesBack >= 4);
            const isComfortableLeader = inPlayoffs && (oppStanding.wins - lastPlayoffSpotWins) >= 2;

            if (isDesperate) {
              // They'll overpay for wins — great time to send current production
              const oppReceivesPlayers = r.give;
              const oppReceivesRedraft = oppReceivesPlayers.reduce(
                (s: number, p: any) => s + (redraftValues?.[p.player_id] ?? 0), 0
              );
              sps += Math.min(oppReceivesRedraft / 60, 8);  // the more production we send, the better
              sps += oppReceivesPlayers.filter((p: any) => isOldProducerBuy(p)).length * 3;
              sps -= r.givePicks.length * 2;  // asking for picks in a desperation trade = friction
            } else if (isEliminated) {
              // They've mentally moved to next year — send picks and youth
              sps += r.givePicks.filter((p: any) => Number(p.round) === 1).length * 4;
              sps += r.give.filter((p: any) => isFutureInsulationAsset(p)).length * 3;
              sps -= r.give.filter((p: any) => isOldProducerBuy(p)).length * 4;
            } else if (isComfortableLeader) {
              // Sitting pretty — they don't NEED to deal, slight friction on all trades
              sps -= 2;
            }

            return sps;
          })();

          // ── Pick slot premium score ───────────────────────────────────────
          // A resolved-slot pick (e.g. "1.03") is worth dramatically more than
          // an unresolved "1st round pick." This score amplifies the value gap
          // for both sides: bonus for receiving top slots, penalty for giving them.
          const pickSlotScore = (() => {
            let pss = 0;
            for (const rp of r.receivePicks) pss += getPickSlotBonus(rp);
            for (const gp of r.givePicks)    pss -= getPickSlotBonus(gp);  // cost of giving premium slot
            return pss;
          })();

          // ── Sell-high confirmation window ─────────────────────────────────
          // The clearest sell-high signal: dynasty value is UP from the historical
          // snapshot AND recent usage is TRENDING DOWN. The market still sees the
          // old peak; the on-field reality has already shifted. This combination
          // is stronger than either signal alone — it's the ideal exit window.
          const sellHighConfirmScore = (() => {
            if (!historicalSnapshot || !playerStats) return 0;
            let shc = 0;
            for (const gp of r.give) {
              const snapVal = historicalSnapshot.players?.[gp.player_id]?.value;
              if (!snapVal || snapVal <= 50 || gp.value <= 50) continue;
              const pct = (gp.value - snapVal) / snapVal;
              if (pct < 0.06) continue; // value isn't elevated enough to call a peak
              const u = playerStats[gp.player_id];
              if (!u || u.gamesPlayed < 2) continue;
              const usageFalling =
                ((gp.position === "WR" || gp.position === "TE") && (u.targetTrend ?? 0) <= -2) ||
                (gp.position === "RB" && (u.carryTrend ?? 0) <= -3) ||
                ((u.snapTrend ?? 0) <= -0.12);
              if (pct >= 0.10 && usageFalling) shc += 6;  // peak confirmed: value up 10%+ + falling usage
              else if (pct >= 0.06 && usageFalling) shc += 4;  // good exit window
              else if (pct >= 0.10) shc += 2;  // value up but usage not confirmed falling yet
            }
            // Receive side: penalise buying into the same pattern in reverse
            for (const rp of r.receive) {
              const snapVal = historicalSnapshot.players?.[rp.player_id]?.value;
              if (!snapVal || snapVal <= 50 || rp.value <= 50) continue;
              const pct = (rp.value - snapVal) / snapVal;
              if (pct < 0.06) continue;
              const u = playerStats[rp.player_id];
              if (!u || u.gamesPlayed < 2) continue;
              const usageFalling =
                ((rp.position === "WR" || rp.position === "TE") && (u.targetTrend ?? 0) <= -2) ||
                (rp.position === "RB" && (u.carryTrend ?? 0) <= -3);
              if (pct >= 0.08 && usageFalling) shc -= 5;  // buying someone else's sell-high target
            }
            return shc;
          })();

          const strategyScore = r.score + getDirectionTradeScore(r) + lineupSafety.score + partnerFitScore + dispositionScore + oppDirectionScore + formatBonus + balancePenalty + futurePickBonus + handcuffBonus + attemptIntelScore + marketIntelScore + archetypeWinRateBonus + seasonTimingBonus + usageSignalScore + teamWindowBonus + starterQualityBonus + activeTraderBonus + exposureBonus + standingsPressureScore + pickSlotScore + sellHighConfirmScore;
          return {
            r,
            lineupSafety,
            partnerProfile,
            bucketPriority,
            strategyScore,
            sort: Math.abs(Math.sin(finderSeed * (results.indexOf(r) + 1)) * 10000) % 1,
          };
        })
        .filter(({ lineupSafety }) => finderTankMode
          ? (lineupSafety.myValid && lineupSafety.oppValid)
          : lineupSafety.valid
        )
        .sort((a, b) => {
          if (a.bucketPriority !== b.bucketPriority) return a.bucketPriority - b.bucketPriority;
          if (b.strategyScore !== a.strategyScore) return b.strategyScore - a.strategyScore;
          return a.sort - b.sort;
        })
        .map(({ r }) => r);
      // ── Build the standard top-15 ────────────────────────────────────────
      const buyLowSet = new Set(buyLowPlayerIds);
      const addToSlots = (acc: any[], r: any, allIds: string[], key: string) => {
        seen.add(key);
        allIds.forEach((pid) => { playerCount[pid] = (playerCount[pid] || 0) + 1; });
        oppCount[String(r.oppRosterId)] = (oppCount[String(r.oppRosterId)] || 0) + 1;
        acc.push(r);
      };
      const top15 = shuffled.reduce((acc: any[], r) => {
          if (acc.length >= 15) return acc;
          const allIds = [
            ...r.give.map((p: any) => `player-${p.player_id}`),
            ...r.receive.map((p: any) => `player-${p.player_id}`),
            ...r.givePicks.map((p: any) => `pick-${finderPickKey(p)}`),
            ...r.receivePicks.map((p: any) => `pick-${finderPickKey(p)}`),
          ];
          const key = [...allIds].sort().join(",");
          if (seen.has(key)) return acc;
          if (acc.some((existing: any) => areTradesTooSimilar(existing, r))) return acc;
          const isPlayerPinned = !!finderPinnedPlayerId;
          const isOwnerPinned = !!finderTargetOppRosterId;
          const oppKey = String(r.oppRosterId);
          if (!isPlayerPinned && !isOwnerPinned) {
            if (allIds.some((pid) => pid !== `player-${finderPinnedPlayerId}` && (playerCount[pid] || 0) >= 4)) return acc;
            if ((oppCount[oppKey] || 0) >= 4) return acc;
          }
          addToSlots(acc, r, allIds, key);
          return acc;
        }, []);

      // ── 5 bonus buy-low slots ─────────────────────────────────────────────
      // Trades where you receive a player ranked in the buy-low list.
      // ── Buy-low slots: 1-for-1 only ──────────────────────────────────────
      // You give exactly one asset (a single pick OR a single non-buy-low player)
      // and receive exactly one buy-low target player. No multi-piece packages.
      const buyLowSlots = shuffled.reduce((acc: any[], r) => {
          if (acc.length >= 5) return acc;

          // Strict 1-for-1: one asset given, one player received
          const totalGiven    = r.give.length + r.givePicks.length;
          const totalReceived = r.receive.length + r.receivePicks.length;
          if (totalGiven !== 1 || totalReceived !== 1) return acc;

          // The one received asset must be a buy-low player
          if (r.receive.length !== 1 || !buyLowSet.has(r.receive[0].player_id)) return acc;

          // The one given asset must be either:
          //   a) a single pick, OR
          //   b) a single player who is NOT on the buy-low list
          if (r.give.length === 1 && buyLowSet.has(r.give[0].player_id)) return acc;

          const allIds = [
            ...r.give.map((p: any) => `player-${p.player_id}`),
            ...r.receive.map((p: any) => `player-${p.player_id}`),
            ...r.givePicks.map((p: any) => `pick-${finderPickKey(p)}`),
            ...r.receivePicks.map((p: any) => `pick-${finderPickKey(p)}`),
          ];
          const key = [...allIds].sort().join(",");
          if (seen.has(key)) return acc;
          if (acc.some((existing: any) => areTradesTooSimilar(existing, r))) return acc;
          addToSlots(acc, r, allIds, key);
          return acc;
        }, [])
        .map((r: any) => ({ ...r, isBuyLow: true }));

      const allTrades = [...top15, ...buyLowSlots];

      const TWENTY_EIGHT_DAYS = 28 * 24 * 60 * 60 * 1000;
      const recentFingerprints = new Set(
        tradeAttempts
          .filter((a) => a.league_id === selectedLeague?.league_id && Date.now() - new Date(a.attempted_at).getTime() < TWENTY_EIGHT_DAYS)
          .map((a) => buildTradeFingerprint(
            a.league_id,
            a.partner_roster_id,
            [...a.give_players.map((p) => p.player_id), ...a.give_picks.map((p) => p.key)],
            [...a.receive_players.map((p) => p.player_id), ...a.receive_picks.map((p) => p.key)],
          ))
      );

      return (
        <div className="space-y-4">
          {/* ── Player pin search ── */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
            {loadingCalcValues ? (
              <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3 animate-pulse">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-2">
                    <div className="h-2.5 w-28 rounded bg-gray-700" />
                    <div className="h-4 w-3/4 rounded bg-gray-700" />
                  </div>
                  <div className="h-5 w-20 rounded-full bg-gray-700" />
                </div>
                <div className="mt-3 flex gap-2">
                  <div className="h-6 w-36 rounded-full bg-gray-700" />
                  <div className="h-6 w-44 rounded-full bg-gray-700" />
                  <div className="h-6 w-32 rounded-full bg-gray-700" />
                </div>
              </div>
            ) : finderDirectionProfile ? (
              <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Direction Engine</div>
                      <button
                        type="button"
                        onClick={() => { setDirectionRefreshing(true); onRefreshDirection(); }}
                        disabled={directionRefreshing}
                        title="Reload direction data"
                        className="text-gray-600 hover:text-gray-400 transition disabled:opacity-40"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          className={`w-3 h-3 ${directionRefreshing ? "animate-spin" : ""}`}
                        >
                          <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08 1.196.75.75 0 1 1-1.31-.734 6 6 0 0 1 9.44-1.595l.842.841V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44 1.595l-.842-.841v1.017a.75.75 0 0 1-1.5 0V9.591a.75.75 0 0 1 .75-.75H5.35a.75.75 0 0 1 0 1.5H3.98l.84.841a4.5 4.5 0 0 0 7.08-1.196.75.75 0 0 1 1.025-.009Z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                    <div className="mt-1 text-sm text-gray-200">{finderDirectionProfile.summary}</div>
                  </div>
                  <span className={`inline-flex text-[10px] font-semibold px-2 py-1 rounded-full border self-start ${finderDirectionProfile.bucketColor}`}>
                    {finderDirectionProfile.bucket}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {finderDirectionProfile.actions.map((action: string) => (
                    <span key={action} className="rounded-full border border-blue-800 bg-blue-950/40 px-3 py-1 text-[11px] text-blue-200">
                      {action}
                    </span>
                  ))}
                </div>
                {selectedLeagueMateProfilesView.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Best Partner Targets</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedLeagueMateProfilesView.slice(0, 3).map((mate: any) => (
                        <button
                          key={mate.rosterId}
                          onClick={() => setFinderTargetOppRosterId(Number(mate.rosterId))}
                          className="rounded-full border border-cyan-800 bg-cyan-950/30 px-3 py-1 text-[11px] text-cyan-200 transition hover:border-cyan-500"
                        >
                          {mate.ownerName} • {mate.fitLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Find trades involving a specific player</p>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-800/70 px-3 py-2">
              <div>
                <div className="text-sm font-medium text-white">Draft Capital Mode</div>
                <div className="text-[11px] text-gray-400">
                  Current direction: <span className="text-gray-300">{finderDirection}</span>. {finderDirectionProfile?.shortAction || "When on, Finder can turn roster talent into picks while still respecting opponent fit rules."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFinderDraftCapitalMode((prev) => !prev)}
                aria-pressed={finderDraftCapitalMode}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
                  finderDraftCapitalMode ? "border-blue-500 bg-blue-600/80" : "border-gray-700 bg-gray-700"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white transition ${
                    finderDraftCapitalMode ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {/* ── Prefer Future Picks (Draft Capital Mode only) ── */}
            {finderDraftCapitalMode && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-800/70 px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-white">Prefer Future Picks</div>
                  <div className="text-[11px] text-gray-400">
                    Prioritize {Number(CURRENT_YEAR) + 1}+ picks over {CURRENT_YEAR} picks.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFinderPreferFuturePicks((prev) => !prev)}
                  aria-pressed={finderPreferFuturePicks}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
                    finderPreferFuturePicks ? "border-blue-500 bg-blue-600/80" : "border-gray-700 bg-gray-700"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white transition ${
                      finderPreferFuturePicks ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            )}
            {/* ── Tank Mode ── */}
            <div className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 border ${finderTankMode ? "bg-red-950/30 border-red-700" : "bg-gray-800/70 border-transparent"}`}>
              <div>
                <div className="text-sm font-medium text-white">Tank Mode</div>
                <div className="text-[11px] text-gray-400">
                  {finderTankMode
                    ? "All your-side restrictions removed. Opponent restrictions still apply."
                    : "Remove your QB minimums, package limits, and direction guardrail. Opponent restrictions stay on."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFinderTankMode((prev) => !prev)}
                aria-pressed={finderTankMode}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
                  finderTankMode ? "border-red-500 bg-red-600/80" : "border-gray-700 bg-gray-700"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white transition ${
                    finderTankMode ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {/* ── Tier Down Mode ── */}
            <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-800/70 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">Tier Down</div>
                <div className="text-[11px] text-gray-400">
                  {finderTierDownPos
                    ? `Showing trades where you give a ${finderTierDownPos} and receive a cheaper ${finderTierDownPos} + adders.`
                    : "Trade down at a position and collect picks or extra players as adders."}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => setFinderTierDownPos(finderTierDownPos === pos ? null : pos)}
                    className={`px-2 py-1 rounded text-xs font-bold transition ${
                      finderTierDownPos === pos
                        ? "bg-purple-600 border border-purple-400 text-white"
                        : "bg-gray-700 border border-gray-600 text-gray-300 hover:border-gray-400 hover:text-white"
                    }`}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>
            {pinnedPlayer ? (
              <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium">{pinnedPlayer.full_name}</span>
                  <span className="text-[10px] text-gray-500 uppercase">{pinnedPlayer.position}</span>
                  <span className="text-xs text-gray-500 font-mono">{pinnedPlayer.value.toLocaleString()}</span>
                </div>
                <button
                  onClick={() => { setFinderPinnedPlayerId(null); setFinderPlayerSearch(""); }}
                  className="text-xs text-gray-500 hover:text-red-400 transition ml-3"
                >
                  ✕ Clear
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={finderPlayerSearch}
                  onChange={(e) => { setFinderPlayerSearch(e.target.value); setFinderPinnedPlayerId(null); }}
                  placeholder="Search your roster…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                {searchMatches.length > 0 && (
                  <div className="absolute z-10 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-xl">
                    {searchMatches.map((p: any) => (
                      <button
                        key={p.player_id}
                        onClick={() => { setFinderPinnedPlayerId(p.player_id); setFinderPlayerSearch(""); setFinderSeed(Math.random()); }}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-700 transition text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white">{p.full_name}</span>
                          <span className="text-[10px] text-gray-500 uppercase">{p.position}</span>
                        </div>
                        <span className="text-xs text-gray-400 font-mono">{p.value.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Owner filter dropdown ── */}
            <select
              value={finderTargetOppRosterId ?? ""}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                setFinderTargetOppRosterId(val);
                setFinderTargetPlayerId(null);
                setFinderTargetPlayerSearch("");
                setFinderSeed(Math.random());
              }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Trade with any owner…</option>
              {rosters
                .filter((r: any) => r.owner_id !== user?.user_id)
                .slice()
                .sort((a: any, b: any) =>
                  ((users as any)[a.owner_id] || "").localeCompare((users as any)[b.owner_id] || "")
                )
                .map((r: any) => (
                  <option key={r.roster_id} value={r.roster_id}>
                    {(users as any)[r.owner_id] || `Team ${r.roster_id}`}
                  </option>
                ))}
            </select>

            {/* ── Target player (want to receive) search ── */}
            {targetPinnedPlayer ? (
              <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">Want to receive</span>
                  <span className="text-sm text-white font-medium">{targetPinnedPlayer.full_name}</span>
                  <span className="text-[10px] text-gray-500 uppercase">{targetPinnedPlayer.position}</span>
                  <span className="text-xs text-gray-500 font-mono">{targetPinnedPlayer.value.toLocaleString()}</span>
                </div>
                <button
                  onClick={() => { setFinderTargetPlayerId(null); setFinderTargetPlayerSearch(""); setFinderSeed(Math.random()); }}
                  className="text-xs text-gray-500 hover:text-red-400 transition ml-3"
                >
                  ✕ Clear
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={finderTargetPlayerSearch}
                  onChange={(e) => { setFinderTargetPlayerSearch(e.target.value); setFinderTargetPlayerId(null); }}
                  placeholder={finderTargetOppRosterId ? "Search their roster for a player to receive…" : "Search league for a player you want to receive…"}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                {targetSearchMatches.length > 0 && (
                  <div className="absolute z-10 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-xl">
                    {targetSearchMatches.map((p: any) => (
                      <button
                        key={p.player_id}
                        onClick={() => { setFinderTargetPlayerId(p.player_id); setFinderTargetPlayerSearch(""); setFinderSeed(Math.random()); }}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-700 transition text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white">{p.full_name}</span>
                          <span className="text-[10px] text-gray-500 uppercase">{p.position}</span>
                        </div>
                        <span className="text-xs text-gray-400 font-mono">{p.value.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {pinnedPlayer
                ? <>Trades involving <strong className="text-gray-300">{pinnedPlayer.full_name}</strong> for <strong className="text-gray-300">{selectedLeague.name}</strong>.</>
                : <>Random trade suggestions for <strong className="text-gray-300">{selectedLeague.name}</strong>.</>
              }
              {loadingCalcValues && <span className="ml-2 text-blue-400">Loading values…</span>}
            </p>
            <button
              onClick={() => setFinderSeed(Math.random())}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 border border-blue-700 hover:border-blue-500 rounded-lg px-3 py-1.5 transition shrink-0 ml-3"
            >
              Refresh
            </button>
          </div>
          {ignoredInLeague.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2 text-xs text-gray-500">
              <span className="text-red-500">🚫</span>
              {ignoredInLeague.length === 1
                ? <span><strong className="text-gray-400">{(users as any)[ignoredInLeague[0].owner_id] || "1 owner"}</strong> is on your ignore list and excluded from results.</span>
                : <span><strong className="text-gray-400">{ignoredInLeague.length} owners</strong> on your ignore list are excluded from results.</span>
              }
            </div>
          )}
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
          {(() => {
            const suppressedCount = allTrades.filter((trade: TradeResult) => {
              const fp = buildTradeFingerprint(
                selectedLeague?.league_id ?? "",
                trade.oppRosterId,
                [...trade.give.map((p: any) => p.player_id), ...trade.givePicks.map((p: any) => finderPickKey(p))],
                [...trade.receive.map((p: any) => p.player_id), ...trade.receivePicks.map((p: any) => finderPickKey(p))],
              );
              return recentFingerprints.has(fp);
            }).length;
            return suppressedCount > 0 ? (
              <p className="text-xs text-gray-500 italic">
                {suppressedCount} recently-offered trade{suppressedCount > 1 ? "s" : ""} hidden (28-day window).
              </p>
            ) : null;
          })()}
          {allTrades
            .filter((trade: any) => {
              const fp = buildTradeFingerprint(
                selectedLeague?.league_id ?? "",
                trade.oppRosterId,
                [...trade.give.map((p: any) => p.player_id), ...trade.givePicks.map((p: any) => finderPickKey(p))],
                [...trade.receive.map((p: any) => p.player_id), ...trade.receivePicks.map((p: any) => finderPickKey(p))],
              );
              return !recentFingerprints.has(fp);
            })
            .map((trade: any, idx: number) => {
            const partnerProfile = leagueMateProfileByRosterId.get(Number(trade.oppRosterId));
            const tradeIntent = getTradeIntent(trade);

            // Score breakdown for Trade Reasoning expander
            const scoreFactors = (() => {
              const out = trade.give || [];
              const inc = trade.receive || [];
              const outPicks = trade.givePicks || [];
              const incPicks = trade.receivePicks || [];
              const factors: { label: string; positive: boolean }[] = [];
              const oldSells = out.filter((p: any) => isOldProducerBuy(p)).length;
              const oldBuys = inc.filter((p: any) => isOldProducerBuy(p)).length;
              const agingSells = out.filter((p: any) => isAgingAsset(p)).length;
              const youngBuys = inc.filter((p: any) => isYoungBuildingBlock(p)).length;
              const insulBuys = inc.filter((p: any) => isFutureInsulationAsset(p)).length;
              const futureFirstsIn = incPicks.filter((p: any) => Number(p.round) === 1 && String(p.season) !== CURRENT_YEAR).length;
              const weakAdds = inc.filter((p: any) => weakPositions.has(p.position)).length;
              const weakLosses = out.filter((p: any) => weakPositions.has(p.position)).length;
              const premPicksOut = outPicks.filter((p: any) => isPremiumCurrentPick(p)).length;
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
              if (partnerProfile?.fitLabel) factors.push({ label: `Partner fit: ${partnerProfile.fitLabel}`, positive: partnerProfile.fitScore > 0 });
              // Attempt intel factors — derived from trade history with this owner
              if (selectedLeague?.league_id && tradeAttempts.length > 0) {
                const oppPastAttempts = tradeAttempts.filter(
                  (a) => a.league_id === selectedLeague.league_id && Number(a.partner_roster_id) === Number(trade.oppRosterId)
                );
                if (oppPastAttempts.length > 0) {
                  const theirSellIds = new Set(oppPastAttempts.filter(a => a.initiated_by === "THEM").flatMap(a => a.give_players.map(p => p.player_id)));
                  const theirBuyIds  = new Set(oppPastAttempts.filter(a => a.initiated_by === "THEM").flatMap(a => a.receive_players.map(p => p.player_id)));
                  const myShopIds    = new Set(oppPastAttempts.filter(a => a.initiated_by === "ME").flatMap(a => a.give_players.map(p => p.player_id)));
                  const myTargetIds  = new Set(oppPastAttempts.filter(a => a.initiated_by === "ME").flatMap(a => a.receive_players.map(p => p.player_id)));
                  const receiveMatchesSell   = inc.filter((p: any) => theirSellIds.has(p.player_id));
                  const giveMatchesBuySignal = out.filter((p: any) => theirBuyIds.has(p.player_id));
                  const receiveIsTheirTarget = inc.filter((p: any) => theirBuyIds.has(p.player_id));
                  const giveMatchesMyShop    = out.filter((p: any) => myShopIds.has(p.player_id));
                  const receiveMatchesMyTarget = inc.filter((p: any) => myTargetIds.has(p.player_id));
                  if (receiveMatchesSell.length > 0) factors.push({ label: `${receiveMatchesSell.map((p: any) => p.full_name.split(" ")[1]).join(", ")} — they've tried to sell this`, positive: true });
                  if (giveMatchesBuySignal.length > 0) factors.push({ label: `${giveMatchesBuySignal.map((p: any) => p.full_name.split(" ")[1]).join(", ")} — they've asked for this`, positive: true });
                  if (receiveIsTheirTarget.length > 0) factors.push({ label: `${receiveIsTheirTarget.map((p: any) => p.full_name.split(" ")[1]).join(", ")} — they've been acquiring this`, positive: false });
                  if (giveMatchesMyShop.length > 0) factors.push({ label: `${giveMatchesMyShop.map((p: any) => p.full_name.split(" ")[1]).join(", ")} — aligns with your sell history`, positive: true });
                  if (receiveMatchesMyTarget.length > 0) factors.push({ label: `${receiveMatchesMyTarget.map((p: any) => p.full_name.split(" ")[1]).join(", ")} — you've been targeting this`, positive: true });
                }
              }
              return factors.slice(0, 6);
            })();
            const giveVals = [...trade.give.map((p: any) => p.value), ...trade.givePicks.map((p: any) => p.value)];
            const receiveVals = [...trade.receive.map((p: any) => p.value), ...trade.receivePicks.map((p: any) => p.value)];
            const giveTotal = giveVals.reduce((s: number, v: number) => s + v, 0);
            const receiveTotal = receiveVals.reduce((s: number, v: number) => s + v, 0);
            const giveCount = giveVals.length;
            const recCount = receiveVals.length;
            const cardAdj = giveCount !== recCount
              ? tradeWaiverAdj(giveVals, receiveVals)
              : 0;
            // give>receive → waiver credit added to receive; receive>give → waiver credit added to give
            const adjOnGive = recCount > giveCount ? cardAdj : 0;
            const adjOnReceive = giveCount > recCount ? cardAdj : 0;
            const giveTotalAdj = giveTotal + adjOnGive;
            const receiveTotalAdj = receiveTotal + adjOnReceive;
            const netDisplay = Math.abs(trade.net);
            const isEven = netDisplay <= 100;
            return (
              <div key={idx} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{trade.format}</span>
                    <span className="text-xs text-gray-500">with</span>
                    <span className="text-sm font-semibold text-blue-300">{trade.oppName}</span>
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
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isEven ? "bg-yellow-900 text-yellow-300" : trade.net > 0 ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
                    {isEven ? "EVEN" : trade.net > 0 ? `+${netDisplay.toLocaleString()}` : `-${netDisplay.toLocaleString()}`}
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
                {(partnerProfile?.repeatedPlayers?.length > 0 || partnerProfile?.acquiredPlayers?.length > 0 || partnerProfile?.tradePreferenceLabel) && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {partnerProfile?.tradePreferenceLabel && (
                      <span className="rounded-full border border-amber-800 bg-amber-950/20 px-2 py-0.5 text-[10px] text-amber-200">
                        {partnerProfile.tradePreferenceLabel}
                      </span>
                    )}
                    {(partnerProfile?.repeatedPlayers || []).slice(0, 2).map((player: any) => (
                      <span key={player.playerId} className="rounded-full border border-cyan-800 bg-cyan-950/30 px-2 py-0.5 text-[10px] text-cyan-200">
                        Likes {player.name}
                      </span>
                    ))}
                    {(partnerProfile?.acquiredPlayers || []).slice(0, 1).map((player: any) => (
                      <span key={`recent-${player.playerId}`} className="rounded-full border border-emerald-800 bg-emerald-950/30 px-2 py-0.5 text-[10px] text-emerald-200">
                        Recently Bought {player.name}
                      </span>
                    ))}
                  </div>
                )}
                {/* Trade columns */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-1.5">You Give</div>
                    <div className="space-y-1">
                      {trade.give.map((p: any) => (
                        <div key={p.player_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <button onClick={() => setPlayerProfileId(p.player_id)} className="text-xs text-white hover:text-blue-400 transition truncate text-left">{p.full_name}</button>
                            <span className="text-[10px] text-gray-500 shrink-0">{p.position}{p.team ? ` · ${p.team}` : ""}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 ml-1">
                            {p.age && <span className="text-[10px] text-gray-500">Age {p.age}</span>}
                            <span className="text-xs text-gray-400 font-mono">{p.value.toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                      {trade.givePicks.map((p: any) => (
                        <div key={finderPickKey(p)} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{finderPickLabel(p)}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">PICK</span>
                          </div>
                          <span className="text-xs text-gray-400 font-mono shrink-0 ml-1">{p.value.toLocaleString()}</span>
                        </div>
                      ))}
                      {adjOnGive > 0 && (
                        <div className="flex items-center justify-between px-2 py-1">
                          <span className="text-[10px] text-gray-500 italic">Waiver Adjustment</span>
                          <span className="text-[10px] text-blue-400 font-mono">+{adjOnGive.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="text-[10px] text-gray-600 text-right pr-1">Total: {giveTotalAdj.toLocaleString()}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-green-400 mb-1.5">You Receive</div>
                    <div className="space-y-1">
                      {trade.receive.map((p: any) => (
                        <div key={p.player_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <button onClick={() => setPlayerProfileId(p.player_id)} className="text-xs text-white hover:text-blue-400 transition truncate text-left">{p.full_name}</button>
                            <span className="text-[10px] text-gray-500 shrink-0">{p.position}{p.team ? ` · ${p.team}` : ""}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 ml-1">
                            {p.age && <span className="text-[10px] text-gray-500">Age {p.age}</span>}
                            <span className="text-xs text-gray-400 font-mono">{p.value.toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                      {trade.receivePicks.map((p: any) => (
                        <div key={finderPickKey(p)} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{finderPickLabel(p)}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">PICK</span>
                          </div>
                          <span className="text-xs text-gray-400 font-mono shrink-0 ml-1">{p.value.toLocaleString()}</span>
                        </div>
                      ))}
                      {adjOnReceive > 0 && (
                        <div className="flex items-center justify-between px-2 py-1">
                          <span className="text-[10px] text-gray-500 italic">Waiver Adjustment</span>
                          <span className="text-[10px] text-blue-400 font-mono">+{adjOnReceive.toLocaleString()}</span>
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
                      <span className="group-open:rotate-90 inline-block transition-transform">▶</span>
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
                    onClick={() => {
                      setCalcOpponentRosterId(trade.oppRosterId);
                      setCalcGive(trade.give.map((p: any) => p.player_id));
                      setCalcReceive(trade.receive.map((p: any) => p.player_id));
                      setCalcGivePicks(trade.givePicks.map((p: any) => finderPickKey(p)));
                      setCalcReceivePicks(trade.receivePicks.map((p: any) => finderPickKey(p)));
                      setCalcSearchA("");
                      setCalcSearchB("");
                      setTradeHubSection("CALCULATOR");
                    }}
                    className="flex-1 text-xs text-gray-500 hover:text-blue-400 border border-gray-700 hover:border-blue-500 rounded-lg py-1.5 transition"
                  >
                    Open in Calculator →
                  </button>
                  {selectedLeague && (() => {
                    const fp = buildTradeFingerprint(
                      selectedLeague.league_id,
                      trade.oppRosterId,
                      [...trade.give.map((p: any) => p.player_id), ...trade.givePicks.map((p: any) => finderPickKey(p))],
                      [...trade.receive.map((p: any) => p.player_id), ...trade.receivePicks.map((p: any) => finderPickKey(p))],
                    );
                    const alreadyMarked = sessionMarked.has(fp);
                    return (
                      <button
                        disabled={alreadyMarked}
                        onClick={async () => {
                          await onMarkAttempted({
                            league_id: selectedLeague.league_id,
                            partner_roster_id: trade.oppRosterId,
                            partner_name: trade.oppName,
                            give_players: trade.give.map((p: any) => ({ player_id: p.player_id, name: p.full_name, position: p.position, value: p.value }) as TradeAttemptAsset),
                            give_picks: trade.givePicks.map((p: any) => ({ key: finderPickKey(p), label: finderPickLabel(p), value: p.value }) as TradeAttemptPick),
                            receive_players: trade.receive.map((p: any) => ({ player_id: p.player_id, name: p.full_name, position: p.position, value: p.value }) as TradeAttemptAsset),
                            receive_picks: trade.receivePicks.map((p: any) => ({ key: finderPickKey(p), label: finderPickLabel(p), value: p.value }) as TradeAttemptPick),
                            source: "FINDER",
                            initiated_by: "ME",
                            status: "PENDING",
                            counter_details: null,
                          });
                          setSessionMarked((prev) => new Set([...prev, fp]));
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
          })}
        </div>
      );
    })()}

    {/* ── Trade Log ── */}
    {tradeHubSection === "TRADE_LOG" && (() => {
      const logPickLabel = (p: any) => p.resolvedSlot ?? `${p.season} Rd ${p.round}`;

      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Your Trade Log</div>
            <div className="mt-1 text-sm text-gray-200">
              Your trades from the past 30 days across all dynasty leagues.
            </div>
          </div>

          {loadingTradeHub && (
            <p className="text-sm text-gray-400">Loading your trades…</p>
          )}

          {!loadingTradeHub && tradeHubUserId === user?.user_id && tradeHubData && tradeHubData.length === 0 && (
            <p className="text-sm text-gray-400">No trades found in the past 30 days.</p>
          )}

          {!loadingTradeHub && (!tradeHubData || tradeHubUserId !== user?.user_id) && (
            <button
              onClick={() => { if (user?.user_id) loadUserTrades(user.user_id); }}
              className="w-full rounded-xl border border-blue-700 bg-blue-950/30 py-3 text-sm font-medium text-blue-300 hover:border-blue-500 transition"
            >
              Load My Trades
            </button>
          )}

          {!loadingTradeHub && tradeHubUserId === user?.user_id && (tradeHubData ?? []).map((trade: any, i: number) => {
            const myRosterId = trade.myRosterId;

            const received = Object.entries(trade.adds || {})
              .filter(([, rid]) => rid === myRosterId)
              .map(([pid]) => {
                const p = (players as any)[pid];
                return { player_id: pid, name: p?.full_name || "Unknown", pos: p?.position || "", val: calcFcValues[pid] ?? 0 };
              });

            const given = Object.entries(trade.adds || {})
              .filter(([, rid]) => rid !== myRosterId)
              .map(([pid]) => {
                const p = (players as any)[pid];
                return { player_id: pid, name: p?.full_name || "Unknown", pos: p?.position || "", val: calcFcValues[pid] ?? 0 };
              });

            const logPickVal = (p: any) => {
              // Extract slot like "1.07" from resolvedSlot "2026 1.07" so pickFcValues can do a slot-specific lookup
              const slotPart = p.resolvedSlot?.match(/(\d+\.\d+)$/)?.[1];
              return getStoredPickValue(pickFcValues, slotPart ? { ...p, slot: slotPart } : p);
            };

            const picksReceived = (trade.draft_picks || [])
              .filter((p: any) => p.owner_id === myRosterId)
              .map((p: any) => ({ name: logPickLabel(p), pos: "PICK", val: logPickVal(p) }));

            const picksGiven = (trade.draft_picks || [])
              .filter((p: any) => p.previous_owner_id === myRosterId)
              .map((p: any) => ({ name: logPickLabel(p), pos: "PICK", val: logPickVal(p) }));

            const allReceived = [...received, ...picksReceived];
            const allGiven = [...given, ...picksGiven];

            const giveTotal = allGiven.reduce((s, x) => s + x.val, 0);
            const recvTotal = allReceived.reduce((s, x) => s + x.val, 0);
            const net = recvTotal - giveTotal;

            const partnerRosterIds = new Set<number>();
            Object.values(trade.adds || {}).forEach((rid: any) => {
              if (Number(rid) !== Number(myRosterId)) partnerRosterIds.add(Number(rid));
            });
            (trade.draft_picks || []).forEach((p: any) => {
              if (p.previous_owner_id && Number(p.previous_owner_id) !== Number(myRosterId)) partnerRosterIds.add(Number(p.previous_owner_id));
              if (p.owner_id && Number(p.owner_id) !== Number(myRosterId)) partnerRosterIds.add(Number(p.owner_id));
            });
            const partnerLabel = [...partnerRosterIds]
              .map((rid) => (trade.rosterToName ?? {})[rid] ?? null)
              .filter(Boolean)
              .join(", ") || null;

            return (
              <div key={i} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">{trade.leagueName}</span>
                    {partnerLabel && <span className="text-xs text-gray-400 ml-2">with {partnerLabel}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {giveTotal > 0 && recvTotal > 0 && (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${Math.abs(net) <= 300 ? "bg-yellow-900 text-yellow-300" : net > 0 ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
                        {Math.abs(net) <= 300 ? "EVEN" : net > 0 ? `+${net.toLocaleString()}` : `${net.toLocaleString()}`}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">{formatRelativeDate(trade.created)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-1.5">You Gave</div>
                    <div className="space-y-1">
                      {allGiven.map((item, j) => (
                        <div key={j} className="flex items-center justify-between rounded-lg bg-gray-800 px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{item.name}</span>
                            <span className="text-[10px] text-gray-500 shrink-0 uppercase">{item.pos}</span>
                          </div>
                          {item.val > 0 && <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{item.val.toLocaleString()}</span>}
                        </div>
                      ))}
                      {allGiven.length === 0 && <p className="text-xs text-gray-600">—</p>}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-green-400 mb-1.5">You Received</div>
                    <div className="space-y-1">
                      {allReceived.map((item, j) => (
                        <div key={j} className="flex items-center justify-between rounded-lg bg-gray-800 px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{item.name}</span>
                            <span className="text-[10px] text-gray-500 shrink-0 uppercase">{item.pos}</span>
                          </div>
                          {item.val > 0 && <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{item.val.toLocaleString()}</span>}
                        </div>
                      ))}
                      {allReceived.length === 0 && <p className="text-xs text-gray-600">—</p>}
                    </div>
                  </div>
                </div>
                {/* ── Log as Accepted ── */}
                {(() => {
                  const txKey = trade.transaction_id ? String(trade.transaction_id) : String(i);
                  const alreadyLogged = tradeLogLogged.has(txKey);
                  const firstPartnerRosterId = [...partnerRosterIds][0] ?? 0;
                  return (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        disabled={alreadyLogged}
                        onClick={async () => {
                          await onMarkAttempted({
                            league_id: trade.leagueId,
                            partner_roster_id: firstPartnerRosterId,
                            partner_name: partnerLabel || "Unknown",
                            give_players: given.map((g: any) => ({ player_id: g.player_id, name: g.name, position: g.pos, value: g.val })),
                            give_picks: picksGiven.map((p: any) => ({ key: p.name, label: p.name, value: p.val })),
                            receive_players: received.map((r: any) => ({ player_id: r.player_id, name: r.name, position: r.pos, value: r.val })),
                            receive_picks: picksReceived.map((p: any) => ({ key: p.name, label: p.name, value: p.val })),
                            source: "FINDER",
                            initiated_by: "ME",
                            status: "ACCEPTED",
                            counter_details: null,
                          });
                          setTradeLogLogged((prev) => new Set([...prev, txKey]));
                        }}
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg transition ${
                          alreadyLogged
                            ? "bg-green-900/40 text-green-400 border border-green-700 cursor-default"
                            : "bg-gray-800 text-gray-300 border border-gray-600 hover:border-blue-500 hover:text-blue-300"
                        }`}
                      >
                        {alreadyLogged ? "✓ Logged in Attempts" : "Log in Attempted Trades"}
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      );
    })()}

    {/* ── Attempted Trades ── */}
    {tradeHubSection === "ATTEMPTS" && (() => {
      if (!selectedLeague) return (
        <p className="text-gray-400 text-sm">Select a league from the dropdown above to view attempted trades.</p>
      );

      const statusConfig: Record<string, { label: string; color: string; border: string }> = {
        PENDING:     { label: "Pending",     color: "text-yellow-300", border: "border-yellow-700 bg-yellow-950/20" },
        ACCEPTED:    { label: "Accepted",    color: "text-green-300",  border: "border-green-700 bg-green-950/20"  },
        DECLINED:    { label: "Declined",    color: "text-red-300",    border: "border-red-700 bg-red-950/20"      },
        COUNTERED:   { label: "Countered",   color: "text-orange-300", border: "border-orange-700 bg-orange-950/20"},
        NO_RESPONSE: { label: "No Response", color: "text-gray-400",   border: "border-gray-600 bg-gray-800/40"   },
      };

      const leagueAttempts = tradeAttempts
        .filter((a) => a.league_id === selectedLeague.league_id)
        .filter((a) => !attemptsOwnerSearch.trim() || a.partner_name.toLowerCase().includes(attemptsOwnerSearch.toLowerCase()))
        .sort((a, b) => {
          const aPending = a.status === "PENDING" ? 0 : 1;
          const bPending = b.status === "PENDING" ? 0 : 1;
          if (aPending !== bPending) return aPending - bPending;
          return new Date(b.attempted_at).getTime() - new Date(a.attempted_at).getTime();
        });

      const formatDate = (iso: string | null) => {
        if (!iso) return null;
        return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      };

      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Attempted Trades</div>
            <div className="mt-1 text-sm text-gray-200">
              Track trades you&apos;ve offered in <strong className="text-gray-100">{selectedLeague.name}</strong>. Mark outcomes to suppress duplicate suggestions and build owner profiles.
            </div>
            <div className="mt-3">
              <input
                type="text"
                value={attemptsOwnerSearch}
                onChange={(e) => setAttemptsOwnerSearch(e.target.value)}
                placeholder="Search by owner…"
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {loadingTradeAttempts && <p className="text-sm text-gray-400">Loading…</p>}

          {!loadingTradeAttempts && tradeAttemptsLeagueId !== selectedLeague.league_id && (
            <button
              onClick={() => onLoadTradeAttempts(selectedLeague.league_id)}
              className="w-full rounded-xl border border-orange-700 bg-orange-950/20 py-3 text-sm font-medium text-orange-300 hover:border-orange-500 transition"
            >
              Load Attempted Trades for {selectedLeague.name}
            </button>
          )}

          {!loadingTradeAttempts && tradeAttemptsLeagueId === selectedLeague.league_id && leagueAttempts.length === 0 && (
            <p className="text-sm text-gray-400">No attempted trades recorded for {selectedLeague.name} yet. Use &quot;Mark Attempted&quot; on any trade card in the Finder or Calculator.</p>
          )}

          {!loadingTradeAttempts && leagueAttempts.map((attempt) => {
            const sc = statusConfig[attempt.status] ?? statusConfig.PENDING;
            const isShowingCounter = showCounterInput === attempt.id;

            return (
              <div key={attempt.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
                {/* Header */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="text-sm font-semibold text-blue-300">{attempt.partner_name}</span>
                  <span className="rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-[10px] font-semibold text-gray-400 uppercase">
                    {attempt.source}
                  </span>
                  {attempt.initiated_by === "THEM" ? (
                    <span className="rounded-full border border-indigo-700 bg-indigo-950/30 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                      Sent by Them
                    </span>
                  ) : (
                    <span className="rounded-full border border-orange-800 bg-orange-950/20 px-2 py-0.5 text-[10px] font-semibold text-orange-400">
                      Sent by Me
                    </span>
                  )}
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sc.border} ${sc.color}`}>
                    {sc.label}
                  </span>
                  <div className="ml-auto flex flex-col items-end text-[10px] text-gray-500">
                    <span>{attempt.initiated_by === "THEM" ? "Received" : "Offered"} {formatDate(attempt.attempted_at)}</span>
                    {attempt.resolved_at && attempt.status !== "PENDING" && (
                      <span className={sc.color}>{sc.label} {formatDate(attempt.resolved_at)}</span>
                    )}
                  </div>
                </div>

                {/* Trade columns */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-1.5">You Give</div>
                    <div className="space-y-1">
                      {attempt.give_players.map((p) => (
                        <div key={p.player_id} className="flex items-center justify-between rounded-lg bg-gray-800 px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{p.name}</span>
                            <span className="text-[10px] text-gray-500 shrink-0 uppercase">{p.position}</span>
                          </div>
                          {p.value > 0 && <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{p.value.toLocaleString()}</span>}
                        </div>
                      ))}
                      {attempt.give_picks.map((pk) => (
                        <div key={pk.key} className="flex items-center justify-between rounded-lg bg-gray-800 px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{pk.label}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">PICK</span>
                          </div>
                          {pk.value > 0 && <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{pk.value.toLocaleString()}</span>}
                        </div>
                      ))}
                      {attempt.give_players.length === 0 && attempt.give_picks.length === 0 && <p className="text-xs text-gray-600">—</p>}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-green-400 mb-1.5">You Receive</div>
                    <div className="space-y-1">
                      {attempt.receive_players.map((p) => (
                        <div key={p.player_id} className="flex items-center justify-between rounded-lg bg-gray-800 px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{p.name}</span>
                            <span className="text-[10px] text-gray-500 shrink-0 uppercase">{p.position}</span>
                          </div>
                          {p.value > 0 && <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{p.value.toLocaleString()}</span>}
                        </div>
                      ))}
                      {attempt.receive_picks.map((pk) => (
                        <div key={pk.key} className="flex items-center justify-between rounded-lg bg-gray-800 px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{pk.label}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">PICK</span>
                          </div>
                          {pk.value > 0 && <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{pk.value.toLocaleString()}</span>}
                        </div>
                      ))}
                      {attempt.receive_players.length === 0 && attempt.receive_picks.length === 0 && <p className="text-xs text-gray-600">—</p>}
                    </div>
                  </div>
                </div>

                {/* Counter details display */}
                {attempt.status === "COUNTERED" && attempt.counter_details && !isShowingCounter && (
                  <div className="mb-3 rounded-lg border border-orange-800 bg-orange-950/20 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-400 mb-1">Their Counter</div>
                    <p className="text-xs text-gray-300">{attempt.counter_details}</p>
                    <button onClick={() => { setShowCounterInput(attempt.id); setCounterInputs((prev) => ({ ...prev, [attempt.id]: attempt.counter_details ?? "" })); }} className="mt-1 text-[10px] text-orange-400 hover:text-orange-300 transition">Edit</button>
                  </div>
                )}

                {/* Counter input form */}
                {isShowingCounter && (
                  <div className="mb-3 space-y-2">
                    <textarea
                      value={counterInputs[attempt.id] ?? ""}
                      onChange={(e) => setCounterInputs((prev) => ({ ...prev, [attempt.id]: e.target.value }))}
                      placeholder="Describe what they countered with (e.g. they wanted Player X instead of Player Y)…"
                      rows={3}
                      className="w-full bg-gray-800 border border-orange-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          await onUpdateAttemptStatus(attempt.id, "COUNTERED", counterInputs[attempt.id] ?? "");
                          setShowCounterInput(null);
                        }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-orange-700 text-orange-300 hover:border-orange-500 transition"
                      >
                        Save Counter
                      </button>
                      <button
                        onClick={() => setShowCounterInput(null)}
                        className="text-xs text-gray-500 hover:text-gray-300 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Status buttons */}
                <div className="flex flex-wrap gap-2 mt-1">
                  {(["ACCEPTED", "DECLINED", "COUNTERED", "NO_RESPONSE"] as TradeAttemptStatus[]).map((s) => {
                    const cfg = statusConfig[s];
                    const isActive = attempt.status === s;
                    return (
                      <button
                        key={s}
                        onClick={async () => {
                          if (s === "COUNTERED") {
                            setShowCounterInput(attempt.id);
                            setCounterInputs((prev) => ({ ...prev, [attempt.id]: attempt.counter_details ?? "" }));
                            if (attempt.status !== "COUNTERED") await onUpdateAttemptStatus(attempt.id, "COUNTERED");
                          } else {
                            setShowCounterInput(null);
                            await onUpdateAttemptStatus(attempt.id, s);
                          }
                        }}
                        className={`text-[11px] font-semibold px-3 py-1 rounded-full border transition ${
                          isActive
                            ? `${cfg.border} ${cfg.color} ring-1 ring-current`
                            : "border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
                        }`}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => { if (window.confirm("Delete this trade attempt? This cannot be undone.")) onDeleteAttempt(attempt.id); }}
                    className="ml-auto text-[11px] text-gray-600 hover:text-red-400 transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      );
    })()}

  </div>
    </>
  );
}

export default React.memo(TradeHub);
