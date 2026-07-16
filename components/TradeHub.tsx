"use client";
import React, { useState, useRef, useEffect } from "react";
import type {
  TradeAttempt, TradeAttemptStatus,
  SleeperLeague, SleeperUser,
  AugmentedPick,
  LeagueMateView, TradePartnerRanking, HistoricalSnapshot,
  FcTrendEntry,
} from "../lib/types";
import type { AnnotatedTrade } from "../hooks/useUserTrades";
import type { PersonalSignal } from "../lib/helpers/personalRankings";
import { usePlayers } from "../lib/PlayersContext";
import { useLeague } from "../lib/LeagueContext";
import { useValues } from "../lib/ValuesContext";
import TradeCalculator from "./tradeHub/TradeCalculator";
import TradeFinder from "./tradeHub/TradeFinder";
import TradeLog from "./tradeHub/TradeLog";
import TradeAttempts from "./tradeHub/TradeAttempts";
import type { MainTab } from "../lib/hubs";

// ── Props ──────────────────────────────────────────────────────────────────
interface TradeHubProps {
  tradeHubSection: "CALCULATOR" | "FINDER" | "TRADE_LOG" | "ATTEMPTS";
  setTradeHubSection: (section: "CALCULATOR" | "FINDER" | "TRADE_LOG" | "ATTEMPTS") => void;
  // Cross-link to Data Hub's Value Trends tab, where Market Trends moved (Phase B4/R2)
  setMainTab: (tab: MainTab) => void;
  setDataHubTab: (tab: "RANKINGS" | "VALUE_TRENDS" | "PROJECTIONS" | "LEAGUEMATES" | "DEPTH_CHARTS" | "BUY_LOW" | "MY_SHARES" | "COMPARE") => void;
  leagues: SleeperLeague[];
  user: SleeperUser | null;
  allPicks: AugmentedPick[];
  calcOpponentRosterId: number | null;
  setCalcOpponentRosterId: (id: number | null) => void;
  selectedLeagueDraftHasOccurred: boolean;
  loadingCalcValues: boolean;
  playerDispositions: Record<string, { sell: string; buy: string }>;
  finderSignals: Record<string, PersonalSignal>;
  leaguePlayerTags: Record<string, Record<string, "CORE" | "WANT_TO_TRADE">>;
  onToggleLeaguePlayerTag: (leagueId: string, playerId: string, forceTag?: "CORE" | "WANT_TO_TRADE") => void;
  leagueMateProfileByRosterId: Map<number, LeagueMateView>;
  selectedLeagueMateProfilesView: LeagueMateView[];
  tradePartnerRankings: TradePartnerRanking[];
  setPlayerProfileId: (id: string | null) => void;
  loadUserExposure: (ownerId: string) => void;
  loadUserTrades: (ownerId: string, bypass?: boolean) => void;
  historicalSnapshot: HistoricalSnapshot | null;
  tradeHubData: AnnotatedTrade[] | null;
  loadingTradeHub: boolean;
  tradeHubUserId: string | null;
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
  fcTrendData: FcTrendEntry[];
  nflState?: { week: number; season_type: string; season: string; display_week?: number } | null;
  playerStats?: Record<string, { avgTargets: number; avgCarries: number; snapPct: number; gamesPlayed: number; recentTargets?: number; recentCarries?: number; recentSnapPct?: number; targetTrend?: number; carryTrend?: number; snapTrend?: number }> | null;
  projectionData?: { sleeperId: string; fpts: number }[] | null;
  crossLeagueExposure?: Record<string, { count: number }> | null;
}

function TradeHub({
  tradeHubSection, setTradeHubSection,
  setMainTab, setDataHubTab,
  user, allPicks,
  calcOpponentRosterId, setCalcOpponentRosterId,
  selectedLeagueDraftHasOccurred,
  loadingCalcValues,
  playerDispositions, finderSignals, leaguePlayerTags, onToggleLeaguePlayerTag, projectionData,
  leagueMateProfileByRosterId, selectedLeagueMateProfilesView,
  tradePartnerRankings,
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
  fcTrendData,
}: TradeHubProps) {
  const players = usePlayers();
  const { selectedLeague, rosters, users } = useLeague();
  const { leagueAdjustedFcValues: calcFcValues } = useValues();
  const [calcGive, setCalcGive] = useState<string[]>([]);
  const [calcReceive, setCalcReceive] = useState<string[]>([]);
  const [calcGivePicks, setCalcGivePicks] = useState<string[]>([]);
  const [calcReceivePicks, setCalcReceivePicks] = useState<string[]>([]);
  const [calcSearchA, setCalcSearchA] = useState("");
  const [calcSearchB, setCalcSearchB] = useState("");
  const [calcShowAllPlayers, setCalcShowAllPlayers] = useState(false);
  const [finderSeed, setFinderSeed] = useState(() => Math.random());
  const [finderPinnedPlayerId, setFinderPinnedPlayerId] = useState<string | null>(null);
  const [finderTargetOppRosterId, setFinderTargetOppRosterId] = useState<number | null>(null);
  const [finderTargetPlayerId, setFinderTargetPlayerId] = useState<string | null>(null);

  const [sessionMarked, setSessionMarked] = useState<Set<string>>(new Set());
  const autoMarkedRef = useRef<Set<string>>(new Set());
  const [viewRosterRosterId, setViewRosterRosterId] = useState<number | null>(null);

  // Auto-mark stale PENDING attempts (>2 days old, ME-initiated) as NO_RESPONSE
  useEffect(() => {
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

  const handleSessionMark = (fp: string) =>
    setSessionMarked((prev) => new Set([...prev, fp]));

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
            <button
              onClick={() => {
                if (user?.user_id && tradeHubUserId !== user.user_id) {
                  loadUserTrades(user.user_id);
                }
                setTradeHubSection("TRADE_LOG");
              }}
              className={`pb-2 px-1 text-sm font-semibold transition whitespace-nowrap ${
                tradeHubSection === "TRADE_LOG"
                  ? "border-b-2 border-blue-400 text-blue-400"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Completed Trades
            </button>
          </div>
        </div>

        {/* Market Trends moved into Data Hub's Value Trends tab (Phase B4/R2) */}
        <div className="flex justify-end mb-4">
          <button
            onClick={() => { setMainTab("DATA_HUB"); setDataHubTab("VALUE_TRENDS"); }}
            className="text-[11px] text-gray-500 hover:text-emerald-400 transition"
          >
            Market Trends moved to Data Hub →
          </button>
        </div>

        {/* ── Trade Calculator ── */}
        {tradeHubSection === "CALCULATOR" && (
          <TradeCalculator
            calcOpponentRosterId={calcOpponentRosterId}
            setCalcOpponentRosterId={setCalcOpponentRosterId}
            calcGive={calcGive}
            setCalcGive={setCalcGive}
            calcReceive={calcReceive}
            setCalcReceive={setCalcReceive}
            calcGivePicks={calcGivePicks}
            setCalcGivePicks={setCalcGivePicks}
            calcReceivePicks={calcReceivePicks}
            setCalcReceivePicks={setCalcReceivePicks}
            calcSearchA={calcSearchA}
            setCalcSearchA={setCalcSearchA}
            calcSearchB={calcSearchB}
            setCalcSearchB={setCalcSearchB}
            calcShowAllPlayers={calcShowAllPlayers}
            setCalcShowAllPlayers={setCalcShowAllPlayers}
            loadingCalcValues={loadingCalcValues}
            allPicks={allPicks}
            user={user}
            onMarkAttempted={onMarkAttempted}
            sessionMarked={sessionMarked}
            onSessionMark={handleSessionMark}
            setPlayerProfileId={setPlayerProfileId}
            loadUserExposure={loadUserExposure}
            loadUserTrades={loadUserTrades}
            ignoredOwnerIds={ignoredOwnerIds}
            toggleIgnoredOwner={toggleIgnoredOwner}
          />
        )}

        {/* ── Trade Finder ── */}
        {tradeHubSection === "FINDER" && (
          <TradeFinder
            finderSeed={finderSeed}
            setFinderSeed={setFinderSeed}
            finderPinnedPlayerId={finderPinnedPlayerId}
            setFinderPinnedPlayerId={setFinderPinnedPlayerId}
            finderTargetOppRosterId={finderTargetOppRosterId}
            setFinderTargetOppRosterId={setFinderTargetOppRosterId}
            finderTargetPlayerId={finderTargetPlayerId}
            setFinderTargetPlayerId={setFinderTargetPlayerId}
            allPicks={allPicks}
            user={user}
            selectedLeagueDraftHasOccurred={selectedLeagueDraftHasOccurred}
            loadingCalcValues={loadingCalcValues}
            playerDispositions={playerDispositions}
            finderSignals={finderSignals}
            leaguePlayerTags={leaguePlayerTags}
            onToggleLeaguePlayerTag={onToggleLeaguePlayerTag}
            leagueMateProfileByRosterId={leagueMateProfileByRosterId}
            selectedLeagueMateProfilesView={selectedLeagueMateProfilesView}
            tradePartnerRankings={tradePartnerRankings}
            onRefreshDirection={onRefreshDirection}
            buyLowPlayerIds={buyLowPlayerIds}
            ignoredOwnerIds={ignoredOwnerIds}
            nflState={nflState}
            playerStats={playerStats}
            crossLeagueExposure={crossLeagueExposure}
            historicalSnapshot={historicalSnapshot}
            projectionData={projectionData}
            setPlayerProfileId={setPlayerProfileId}
            tradeAttempts={tradeAttempts}
            onMarkAttempted={onMarkAttempted}
            sessionMarked={sessionMarked}
            onSessionMark={handleSessionMark}
            setViewRosterRosterId={setViewRosterRosterId}
            fcTrendData={fcTrendData}
            setTradeHubSection={setTradeHubSection}
            setCalcOpponentRosterId={setCalcOpponentRosterId}
            setCalcGive={setCalcGive}
            setCalcReceive={setCalcReceive}
            setCalcGivePicks={setCalcGivePicks}
            setCalcReceivePicks={setCalcReceivePicks}
            setCalcSearchA={setCalcSearchA}
            setCalcSearchB={setCalcSearchB}
          />
        )}

        {/* ── Attempted Trades ── */}
        {tradeHubSection === "ATTEMPTS" && (
          <TradeAttempts
            tradeAttempts={tradeAttempts}
            loadingTradeAttempts={loadingTradeAttempts}
            tradeAttemptsLeagueId={tradeAttemptsLeagueId}
            onUpdateAttemptStatus={onUpdateAttemptStatus}
            onDeleteAttempt={onDeleteAttempt}
            onLoadTradeAttempts={onLoadTradeAttempts}
            onMarkAttempted={onMarkAttempted}
            allPicks={allPicks}
            user={user}
          />
        )}

        {/* ── Trade Log ── */}
        {tradeHubSection === "TRADE_LOG" && (
          <TradeLog
            tradeHubData={tradeHubData}
            loadingTradeHub={loadingTradeHub}
            tradeHubUserId={tradeHubUserId}
            user={user}
            loadUserTrades={loadUserTrades}
            onMarkAttempted={onMarkAttempted}
          />
        )}

      </div>

      {/* Roster Preview Modal */}
      {viewRosterRosterId !== null && (() => {
        const roster = rosters.find((r) => r.roster_id === viewRosterRosterId);
        const ownerName = roster ? (users[roster.owner_id] || `Team ${roster.roster_id}`) : `Team ${viewRosterRosterId}`;
        const posOrder: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3 };
        const rosterPlayers = (roster?.players ?? [])
          .map((pid) => ({ pid, p: players[pid], val: (calcFcValues as Record<string, number>)[pid] ?? 0 }))
          .sort((a, b) => {
            const pa = posOrder[a.p?.position ?? ""] ?? 4;
            const pb = posOrder[b.p?.position ?? ""] ?? 4;
            return pa !== pb ? pa - pb : b.val - a.val;
          });
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${ownerName}'s roster`}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => setViewRosterRosterId(null)}
          >
            <div className="absolute inset-0 bg-black/70" aria-hidden="true" />
            <div
              className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                <div>
                  <div className="text-base font-bold text-white">{ownerName}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{rosterPlayers.length} players</div>
                </div>
                <button
                  onClick={() => setViewRosterRosterId(null)}
                  className="text-gray-500 hover:text-white transition text-lg leading-none"
                  aria-label="Close roster"
                >
                  ✕
                </button>
              </div>
              <div className="overflow-y-auto flex-1 px-4 py-3 space-y-1">
                {rosterPlayers.length === 0 && (
                  <p className="text-xs text-gray-500 text-center py-4">No players found</p>
                )}
                {rosterPlayers.map(({ pid, p, val }) => (
                  <div key={pid} className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => setPlayerProfileId(pid)}
                        className="text-sm text-white hover:text-blue-400 transition truncate text-left"
                      >
                        {p?.full_name ?? pid}
                      </button>
                      {p && (
                        <span className="text-[11px] text-gray-500 shrink-0">
                          {p.position}{p.team ? ` · ${p.team}` : ""}
                        </span>
                      )}
                      {p?.age && <span className="text-[11px] text-gray-600 shrink-0">Age {p.age}</span>}
                    </div>
                    <span className="text-xs text-gray-400 font-mono shrink-0 ml-2">
                      {val > 0 ? val.toLocaleString() : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

export default React.memo(TradeHub);
