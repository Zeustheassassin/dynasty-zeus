"use client";
import React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePlayers } from "../lib/PlayersContext";
import { useLeague } from "../lib/LeagueContext";
import { useValues } from "../lib/ValuesContext";
import type {
  SleeperLeague, SleeperUser, SleeperPlayer, AugmentedPick, ProjectionRow, LeagueMateStatEntry, HistoricalSnapshot, PlayerValueSnapshotEntry,
} from "../lib/types";

// ── Module-level constants (mirrors page.tsx) ──────────────────────────────
const CURRENT_YEAR = String(new Date().getFullYear());

const PICK_YEARS = Array.from({ length: 3 }, (_, i) => String(new Date().getFullYear() + i));
const PICK_ROUNDS = [1, 2, 3, 4];
const STANDARD_PICK_VALUES: Record<string, number> = {
  "1-0": 8500, "2-0": 4500, "3-0": 2200, "4-0": 1200,
  "1-1": 6500, "2-1": 3500, "3-1": 2000, "4-1": 1100,
  "1-2": 5000, "2-2": 2800, "3-2": 1600, "4-2": 900,
};

const PROJ_SOURCES = [
  { id: "fantasypros" as const, label: "FantasyPros",       tier: 1 as const, weight: 0.45 },
  { id: "numberfire"  as const, label: "numberFire",         tier: 1 as const, weight: 0.35 },
  { id: "sleeper"     as const, label: "RotoWire/Sleeper",   tier: 2 as const, weight: 0.20 },
];

const POS_COLOR: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-green-400",
  WR: "text-blue-400",
  TE: "text-yellow-400",
};

// ── Local types ─────────────────────────────────────────────────────────────

interface ShareEntry { count: number; leagues: string[]; starters: string[] }

interface ExposureEntry { playerId: string; count: number; percent: number }
interface ExposureData { players: ExposureEntry[]; leagueCount: number }

interface CrossLeaguePick { season: string; round: number; roster_id: number; owner_id: number }
interface FetchedRoster { owner_id?: string | null; roster_id?: number; players?: string[]; taxi?: string[] }
interface FetchedUser { user_id?: string; display_name?: string }
interface ExternalLeague { settings?: { best_ball?: number } }

// ── Props ──────────────────────────────────────────────────────────────────
type DataHubTabId = "RANKINGS" | "VALUE_TRENDS" | "PROJECTIONS" | "PICK_VALUES" | "LEAGUEMATES" | "DEPTH_CHARTS" | "BUY_LOW";

interface DataHubProps {
  // Navigation
  dataHubTab: DataHubTabId;
  setDataHubTab: (tab: DataHubTabId) => void;

  shares: Record<string, ShareEntry>;

  // Dynasty/Redraft rankings
  dynastyRankPos: string;
  setDynastyRankPos: (pos: string) => void;
  loadingCalcValues: boolean;
  playerDispositions: Record<string, { sell: string; buy: string }>;
  savePlayerDisposition: (playerId: string, sell: string, buy: string) => void;
  setPlayerProfileId: (id: string | null) => void;
  loadingRedraft: boolean;

  // Projections tab
  projectionData: ProjectionRow[];
  setProjectionData: React.Dispatch<React.SetStateAction<ProjectionRow[]>>;
  projectionPosFilter: string;
  setProjectionPosFilter: (pos: string) => void;
  projectionWeek: number;
  setProjectionWeek: (week: number) => void;
  setProjectionLoaded: (loaded: boolean) => void;
  loadProjections: (week: number | "season", extraSources?: string[]) => void;
  projectionSeasonYear: number | null;
  projectionSourceStatus: Record<string, boolean>;
  loadingProjections: boolean;
  projectionUsesSeasonFallback: boolean;

  // Pick values tab
  allPicks: AugmentedPick[];

  // League mate stats tab
  leagues: SleeperLeague[];
  user: SleeperUser | null;
  leagueMateStats: LeagueMateStatEntry[];
  setLeagueMateStats: (stats: LeagueMateStatEntry[]) => void;
  leagueMateStatsLoaded: boolean;
  setLeagueMateStatsLoaded: (loaded: boolean) => void;
  loadingLeagueMateStats: boolean;
  setLoadingLeagueMateStats: (loading: boolean) => void;
  leagueMateSearch: string;
  setLeagueMateSearch: (s: string) => void;
  leagueMateSort: "name" | "total" | "bestball" | "shared";
  setLeagueMateSort: (sort: "name" | "total" | "bestball" | "shared") => void;
  // League mate exposure drill-down
  loadUserExposure: (userId: string) => void;
  selectedUserId: string | null;
  externalShares: ExposureData | null;
  loadingShares: boolean;

  // Value trends
  historicalSnapshot: HistoricalSnapshot | null;
  onSaveSnapshot: () => Promise<void>;
}

// ── Disposition colour helpers ─────────────────────────────────────────────
const sellColor = (v: string) =>
  v === "Trade at All Costs" ? "text-green-400" :
  v === "Lower than Market"  ? "text-green-600" :
  v === "Not Willing to Trade" ? "text-red-400" :
  v === "Will Trade but Higher than Market" ? "text-yellow-400" : "text-gray-500";

const buyColor = (v: string) =>
  v === "Buy Over Market" ? "text-green-400" :
  v === "Buy at Market"   ? "text-green-600" :
  v === "Zero Interest"   ? "text-red-400" :
  v === "Buy Low"         ? "text-yellow-400" : "text-gray-500";

const INJURY_CLS: Record<string, string> = {
  IR: "bg-red-900/70 text-red-300",
  O:  "bg-red-900/70 text-red-300",
  D:  "bg-orange-900/70 text-orange-300",
  Q:  "bg-yellow-900/70 text-yellow-300",
};
const injuryBadge = (status: string | null | undefined) => {
  if (!status) return null;
  const s = status.toUpperCase();
  const cls = INJURY_CLS[s];
  if (!cls) return null;
  return <span className={`ml-1 rounded px-1 py-0.5 text-[9px] font-bold ${cls}`}>{s}</span>;
};

const ageColor = (age: number | undefined, pos: string) => {
  if (!age) return "text-gray-600";
  if (pos === "RB") return age <= 23 ? "text-green-400" : age <= 26 ? "text-yellow-400" : "text-red-400";
  return age <= 24 ? "text-green-400" : age <= 27 ? "text-yellow-400" : "text-red-400";
};

// ── Component ──────────────────────────────────────────────────────────────
function DataHub({
  dataHubTab, setDataHubTab,
  shares,
  dynastyRankPos, setDynastyRankPos, loadingCalcValues,
  playerDispositions, savePlayerDisposition, setPlayerProfileId,
  loadingRedraft,
  projectionData, setProjectionData, projectionPosFilter, setProjectionPosFilter,
  projectionWeek, setProjectionWeek, setProjectionLoaded, loadProjections,
  projectionSeasonYear, projectionSourceStatus, loadingProjections, projectionUsesSeasonFallback,
  allPicks,
  leagues, user,
  leagueMateStats, setLeagueMateStats, leagueMateStatsLoaded, setLeagueMateStatsLoaded,
  loadingLeagueMateStats, setLoadingLeagueMateStats,
  leagueMateSearch, setLeagueMateSearch, leagueMateSort, setLeagueMateSort,
  loadUserExposure, externalShares, loadingShares,
  historicalSnapshot, onSaveSnapshot,
}: DataHubProps) {
  const players = usePlayers();
  const { selectedLeague, rosters, users } = useLeague();
  const {
    leagueAdjustedFcValues: calcFcValues,
    leagueAdjustedRedraftValues: redraftValues,
    selectedLeagueDynamicPickValues,
  } = useValues();

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [rankView, setRankView] = React.useState<"DYNASTY" | "REDRAFT" | "COMPARE">("DYNASTY");
  const [rankSearch, setRankSearch] = React.useState("");
  const [projRosterOnly, setProjRosterOnly] = React.useState(false);
  const [crossLeaguePicks, setCrossLeaguePicks] = React.useState<{leagueName: string; picks: CrossLeaguePick[]}[]>([]);
  const [loadingCrossLeaguePicks, setLoadingCrossLeaguePicks] = React.useState(false);
  const [crossLeaguePicksLoaded, setCrossLeaguePicksLoaded] = React.useState(false);
  const [expandedMateId, setExpandedMateId] = React.useState<string | null>(null);
  const [trendThreshold, setTrendThreshold] = React.useState(10);
  const [trendPos, setTrendPos] = React.useState("ALL");
  const [savingSnapshot, setSavingSnapshot] = React.useState(false);
  const [snapshotSavedAt, setSnapshotSavedAt] = React.useState<number | null>(null);
  const [depthPos, setDepthPos] = React.useState<"QB" | "RB" | "WR" | "TE">("QB");
  const [depthTeamSearch, setDepthTeamSearch] = React.useState("");
  const [depthShowOwnedOnly, setDepthShowOwnedOnly] = React.useState(false);
  const [buyLowPos, setBuyLowPos] = React.useState<"ALL" | "QB" | "RB" | "WR" | "TE">("ALL");
  const [enabledExtraSources, setEnabledExtraSources] = React.useState<Set<string>>(new Set());

  // ── League Mate Stats loader (inline because it sets local state via props) ──
  const loadLeagueMateStats = async () => {
    if (!user || !leagues.length) return;
    setLoadingLeagueMateStats(true);
    try {
      const myLeagueData = await Promise.all(
        leagues.map(async (league) => {
          const [rostersRes, leagueUsersRes] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).then(r => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`).then(r => r.json()).catch(() => []),
          ]);
          return { league, rosters: rostersRes as FetchedRoster[], leagueUsers: leagueUsersRes as FetchedUser[] };
        })
      );

      const displayNameMap: Record<string, string> = {};
      const sharedLeaguesCount: Record<string, number> = {};
      const allOwnerIds = new Set<string>();

      myLeagueData.forEach(({ rosters: lr, leagueUsers }) => {
        leagueUsers.forEach((u) => {
          if (u?.user_id && u?.display_name) displayNameMap[u.user_id] = u.display_name;
        });
        lr.forEach((r) => {
          if (!r.owner_id || r.owner_id === user.user_id) return;
          allOwnerIds.add(r.owner_id);
          sharedLeaguesCount[r.owner_id] = (sharedLeaguesCount[r.owner_id] || 0) + 1;
        });
      });

      const ownerStats = await Promise.all([...allOwnerIds].map(async (ownerId) => {
        const theirLeagues: ExternalLeague[] = await fetch(`https://api.sleeper.app/v1/user/${ownerId}/leagues/nfl/${CURRENT_YEAR}`)
          .then(r => r.json())
          .then(d => Array.isArray(d) ? d : [])
          .catch(() => []);

        return {
          userId: ownerId,
          displayName: displayNameMap[ownerId] || users[ownerId] || ownerId,
          totalLeagues: theirLeagues.filter((l) => (l.settings?.best_ball ?? 0) === 0).length,
          bestBallLeagues: theirLeagues.filter((l) => (l.settings?.best_ball ?? 0) !== 0).length,
          sharedLeagues: sharedLeaguesCount[ownerId] || 0,
        };
      }));

      setLeagueMateStats(ownerStats);
      setLeagueMateStatsLoaded(true);
    } finally {
      setLoadingLeagueMateStats(false);
    }
  };

  // ── Cross-league picks loader ──────────────────────────────────────────────
  const loadCrossLeaguePicks = async () => {
    if (!user || !leagues.length) return;
    setLoadingCrossLeaguePicks(true);
    try {
      const results = await Promise.all(
        leagues.map(async (league) => {
          const [rostersData, tradedPicksData] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).then(r => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/traded_picks`).then(r => r.json()).catch(() => []),
          ]);
          const fetchedRosters = rostersData as FetchedRoster[];
          const myRoster = fetchedRosters.find((r) => r.owner_id === user.user_id);
          if (!myRoster) return null;
          const tempPicks: CrossLeaguePick[] = [];
          PICK_YEARS.forEach((year) => {
            fetchedRosters.forEach((r) => {
              PICK_ROUNDS.forEach((round) => {
                tempPicks.push({ season: year, round, roster_id: r.roster_id ?? 0, owner_id: r.roster_id ?? 0 });
              });
            });
          });
          (tradedPicksData as CrossLeaguePick[]).forEach((tp) => {
            const match = tempPicks.find(p => p.season === tp.season && p.round === tp.round && p.roster_id === tp.roster_id);
            if (match) match.owner_id = tp.owner_id;
          });
          const myPicks = tempPicks.filter(p => p.owner_id === myRoster.roster_id);
          return myPicks.length > 0 ? { leagueName: league.name, picks: myPicks } : null;
        })
      );
      setCrossLeaguePicks(results.filter((r): r is { leagueName: string; picks: CrossLeaguePick[] } => r !== null));
      setCrossLeaguePicksLoaded(true);
    } finally {
      setLoadingCrossLeaguePicks(false);
    }
  };

  // ── Rankings virtualizer ──────────────────────────────────────────────────
  const _fcVal = React.useCallback((id: string) => calcFcValues[id] ?? 0, [calcFcValues]);
  const _rdVal = React.useCallback((id: string) => redraftValues[id] ?? 0, [redraftValues]);

  const ranked = React.useMemo(
    () =>
      Object.values(players)
        .filter((p) => ["QB", "RB", "WR", "TE"].includes(p.position))
        .filter((p) =>
          rankView === "REDRAFT" ? _rdVal(p.player_id) > 0 : _fcVal(p.player_id) > 0
        )
        .filter((p) => dynastyRankPos === "ALL" || p.position === dynastyRankPos)
        .filter(
          (p) =>
            !rankSearch.trim() ||
            p.full_name?.toLowerCase().includes(rankSearch.trim().toLowerCase())
        )
        .sort((a, b) =>
          rankView === "REDRAFT"
            ? _rdVal(b.player_id) - _rdVal(a.player_id)
            : _fcVal(b.player_id) - _fcVal(a.player_id)
        ),
    [players, rankView, dynastyRankPos, rankSearch, _fcVal, _rdVal]
  );

  const ranksParentRef = React.useRef<HTMLDivElement>(null);
  const ranksVirtualizer = useVirtualizer({
    count: ranked.length,
    getScrollElement: () => ranksParentRef.current,
    estimateSize: () => 36,
    overscan: 8,
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Sub-tab nav */}
      <div className="flex justify-center border-b border-gray-800 mb-6">
        <div className="flex justify-center gap-1 sm:gap-3 lg:gap-5 text-center flex-wrap">
          {(["RANKINGS", "VALUE_TRENDS", "PROJECTIONS", "PICK_VALUES", "LEAGUEMATES", "DEPTH_CHARTS", "BUY_LOW"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setDataHubTab(tab)}
              className={`pb-2 px-1 text-xs sm:text-sm font-semibold transition whitespace-nowrap ${
                dataHubTab === tab
                  ? tab === "BUY_LOW"
                    ? "border-b-2 border-green-400 text-green-400"
                    : "border-b-2 border-blue-400 text-blue-400"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {tab === "RANKINGS" ? "Rankings" :
               tab === "VALUE_TRENDS" ? "Value Trends" :
               tab === "PROJECTIONS" ? "Projections" :
               tab === "PICK_VALUES" ? "Pick Values" :
               tab === "LEAGUEMATES" ? "League Mates" :
               tab === "DEPTH_CHARTS" ? "Depth Charts" :
               "Buy Low"}
            </button>
          ))}
        </div>
      </div>

      {/* ── PLAYER RANKINGS ── */}
      {dataHubTab === "RANKINGS" && (() => {
        const fcVal = _fcVal;
        const rdVal = _rdVal;

        return (
          <>
            {(loadingCalcValues || loadingRedraft) && <p className="text-sm text-blue-400 mb-4">Loading values…</p>}
            {/* Pos filter + view toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex gap-2">
                {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setDynastyRankPos(pos)}
                    className={`px-3 py-1 rounded text-sm font-medium transition ${dynastyRankPos === pos ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
                  >
                    {pos}
                  </button>
                ))}
              </div>
              <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
                {(["DYNASTY", "REDRAFT", "COMPARE"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setRankView(v)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition ${rankView === v ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
                  >
                    {v === "DYNASTY" ? "Dynasty" : v === "REDRAFT" ? "Redraft" : "Compare"}
                  </button>
                ))}
              </div>
            </div>
            {/* Player search */}
            <input
              className="w-full p-2 mb-3 rounded bg-gray-800 text-sm placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Search player…"
              value={rankSearch}
              onChange={(e) => setRankSearch(e.target.value)}
            />
            {/* Column headers */}
            <div className="flex items-center gap-2 px-2 mb-1">
              <span className="w-5 shrink-0" />
              <span className="w-6 shrink-0" />
              <span className="flex-1 text-[10px] text-gray-600 uppercase tracking-wider">Player</span>
              <span className="w-7 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Age</span>
              {rankView === "COMPARE" ? (
                <>
                  <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Dyn</span>
                  <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Rdft</span>
                  <span className="w-12 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Gap</span>
                </>
              ) : (
                <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Value</span>
              )}
              <span className="w-20 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Sell</span>
              <span className="w-20 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Buy</span>
              <span className="w-4 shrink-0" />
            </div>
            {ranked.length === 0 && !loadingCalcValues && !loadingRedraft && (
              <p className="text-gray-400 text-sm">
                {Object.keys(calcFcValues).length === 0 ? "Load a league to populate player values." : "No players match your filter."}
              </p>
            )}
            <div
              ref={ranksParentRef}
              className="overflow-y-auto"
              style={{ height: "600px" }}
            >
              <div style={{ height: ranksVirtualizer.getTotalSize(), position: "relative" }}>
                {ranksVirtualizer.getVirtualItems().map((vRow) => {
                  const p = ranked[vRow.index];
                  const idx = vRow.index;
                  const disp = playerDispositions[p.player_id] ?? { sell: "Neutral", buy: "Neutral" };
                  const dyn = fcVal(p.player_id);
                  const red = rdVal(p.player_id);
                  const gap = dyn - red;
                  const gapPct = dyn > 0 ? (gap / dyn) * 100 : 0;
                  const displayVal = rankView === "REDRAFT" ? red : dyn;
                  const isOwned = (shares[p.player_id]?.count ?? 0) > 0;
                  const snapDynVal = rankView === "DYNASTY" ? Number(historicalSnapshot?.players[p.player_id]?.value ?? 0) : 0;
                  const trendPct = snapDynVal > 0 && dyn > 0 ? ((dyn - snapDynVal) / snapDynVal) * 100 : null;
                  return (
                    <div
                      key={p.player_id}
                      style={{
                        position: "absolute",
                        top: vRow.start,
                        left: 0,
                        right: 0,
                        height: vRow.size,
                      }}
                      className="flex items-center gap-2 bg-gray-800/70 hover:bg-gray-800 rounded-lg px-2 py-1.5 transition"
                    >
                      <span className="text-[10px] text-gray-600 w-5 text-right shrink-0">{idx + 1}</span>
                      <span className={`text-[10px] font-bold w-6 shrink-0 ${POS_COLOR[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                      <span className="text-xs flex-1 truncate min-w-0 flex items-center gap-1">
                        {isOwned && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="On your roster" />}
                        <span className={isOwned ? "text-blue-200" : "text-white"}>{p.full_name}</span>
                        {injuryBadge(p.injury_status)}
                      </span>
                      <span className={`text-[10px] font-mono w-7 text-center shrink-0 ${ageColor(p.age ?? undefined, p.position)}`}>{p.age || "—"}</span>
                      {rankView === "COMPARE" ? (
                        <>
                          <span className="text-[10px] text-gray-300 font-mono w-14 text-right shrink-0">{dyn.toLocaleString()}</span>
                          <span className="text-[10px] text-gray-500 font-mono w-14 text-right shrink-0">{red > 0 ? red.toLocaleString() : "—"}</span>
                          <span className={`text-[10px] font-mono w-12 text-right shrink-0 ${gapPct > 15 ? "text-green-400" : gapPct < -10 ? "text-red-400" : "text-gray-500"}`}>
                            {red > 0 ? `${gap > 0 ? "+" : ""}${gap.toLocaleString()}` : "—"}
                          </span>
                        </>
                      ) : (
                        <span className="flex flex-col items-end w-14 shrink-0">
                          <span className="text-[10px] text-gray-400 font-mono">{displayVal.toLocaleString()}</span>
                          {trendPct !== null && (
                            <span className={`text-[8px] font-semibold leading-none ${trendPct > 0 ? "text-green-500" : "text-red-500"}`}>
                              {trendPct > 0 ? "+" : ""}{trendPct.toFixed(1)}%
                            </span>
                          )}
                        </span>
                      )}
                      <select
                        value={disp.sell}
                        onChange={(e) => savePlayerDisposition(p.player_id, e.target.value, disp.buy)}
                        className={`w-20 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] shrink-0 focus:outline-none focus:border-blue-500 ${sellColor(disp.sell)}`}
                      >
                        <option value="Not Willing to Trade">No Trade</option>
                        <option value="Will Trade but Higher than Market">↑ Price</option>
                        <option value="Neutral">Neutral</option>
                        <option value="Lower than Market">↓ Price</option>
                        <option value="Trade at All Costs">Must Go</option>
                      </select>
                      <select
                        value={disp.buy}
                        onChange={(e) => savePlayerDisposition(p.player_id, disp.sell, e.target.value)}
                        className={`w-20 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] shrink-0 focus:outline-none focus:border-blue-500 ${buyColor(disp.buy)}`}
                      >
                        <option value="Buy Over Market">Pay Up</option>
                        <option value="Buy at Market">At Mkt</option>
                        <option value="Neutral">Neutral</option>
                        <option value="Buy Low">Buy Low</option>
                        <option value="Zero Interest">Skip</option>
                      </select>
                      <button onClick={() => setPlayerProfileId(p.player_id)} className="text-gray-600 hover:text-blue-400 text-xs transition shrink-0 w-4" title="View profile">ⓘ</button>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        );
      })()}

      {/* ── VALUE TRENDS ── */}
      {dataHubTab === "VALUE_TRENDS" && (() => {
        // Compute trends from the Supabase daily snapshot vs current FC values
        const snap = historicalSnapshot;
        if (!snap) {
          return (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <div className="text-3xl">📊</div>
              <p className="text-base font-semibold text-white">No baseline snapshot yet</p>
              <p className="text-sm text-gray-400 max-w-sm">
                Load a league to start tracking values. A daily snapshot will be saved automatically once your dynasty values are loaded.
              </p>
            </div>
          );
        }

        const snapshotDate = new Date(snap.recorded_at);
        const ageMs = Date.now() - snapshotDate.getTime();
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        const ageLabel = ageDays >= 2 ? `${ageDays} days ago` : ageDays === 1 ? "yesterday" : `${ageHours}h ago`;
        const isStaleSnapshot = ageDays >= 7;

        type TrendRow = {
          playerId: string;
          full_name: string;
          position: string;
          age?: number | null;
          injury_status?: string | null;
          team?: string;
          currentVal: number;
          snapVal: number;
          delta: number;
          pct: number;
          owned: number;
        };

        const allTrends: TrendRow[] = [];
        Object.entries(snap.players).forEach(([playerId, snapData]: [string, PlayerValueSnapshotEntry]) => {
          const currentVal = players[playerId]?.value ?? 0;
          const snapVal = Number(snapData.value ?? 0);
          if (snapVal <= 0 || currentVal <= 0) return;
          const delta = currentVal - snapVal;
          const pct = (delta / snapVal) * 100;
          const p = players[playerId];
          if (!p || !["QB", "RB", "WR", "TE"].includes(p.position)) return;
          if (trendPos !== "ALL" && p.position !== trendPos) return;
          allTrends.push({
            playerId,
            full_name: p.full_name ?? snapData.full_name,
            position: p.position,
            age: p.age,
            injury_status: p.injury_status,
            team: p.team ?? snapData.team,
            currentVal,
            snapVal,
            delta,
            pct,
            owned: shares[playerId]?.count ?? 0,
          });
        });

        const falling = allTrends
          .filter((r) => r.pct <= -trendThreshold)
          .sort((a, b) => a.pct - b.pct);

        const rising = allTrends
          .filter((r) => r.pct >= trendThreshold)
          .sort((a, b) => b.pct - a.pct);

        const TrendRow = ({ row, direction }: { row: TrendRow; direction: "up" | "down" }) => (
          <div
            className={`flex items-center gap-2 rounded-xl px-3 py-2 border transition ${
              direction === "down"
                ? "bg-red-950/20 border-red-900/40 hover:bg-red-950/30"
                : "bg-green-950/20 border-green-900/40 hover:bg-green-950/30"
            }`}
          >
            <span className={`text-[10px] font-bold w-6 shrink-0 ${POS_COLOR[row.position] ?? "text-gray-400"}`}>{row.position}</span>
            <span className="text-xs text-white flex-1 min-w-0 truncate flex items-center gap-1">
              {row.full_name}{injuryBadge(row.injury_status)}
            </span>
            <span className={`text-[10px] font-mono w-7 text-center shrink-0 ${ageColor(row.age ?? undefined, row.position)}`}>{row.age || "—"}</span>
            {row.team && <span className="hidden md:block text-[10px] text-gray-500 w-8 shrink-0">{row.team}</span>}
            <span className="text-[10px] text-gray-400 font-mono w-14 text-right shrink-0">{row.currentVal.toLocaleString()}</span>
            <span className="text-[10px] text-gray-600 font-mono w-14 text-right shrink-0 hidden sm:block">{row.snapVal.toLocaleString()}</span>
            <span className={`text-xs font-bold font-mono w-14 text-right shrink-0 ${direction === "down" ? "text-red-400" : "text-green-400"}`}>
              {direction === "up" ? "+" : ""}{row.pct.toFixed(1)}%
            </span>
            {row.owned > 0 && (
              <span className="text-[9px] font-semibold text-blue-400 bg-blue-900/30 rounded px-1.5 py-0.5 shrink-0">{row.owned}×</span>
            )}
          </div>
        );

        // ── Trade suggestion computation ──────────────────────────────────────
        // Build an unfiltered trend map (all positions, fixed 5%/20% thresholds)
        const trendMap = new Map<string, number>();
        Object.entries(snap.players).forEach(([pid, snapData]) => {
          const cv = players[pid]?.value ?? 0;
          const sv = Number(snapData.value ?? 0);
          if (sv > 0 && cv > 0) trendMap.set(pid, ((cv - sv) / sv) * 100);
        });

        const myRoster = rosters.find((r) => r.owner_id === user?.user_id);
        const myPlayerSet = new Set<string>(myRoster?.players ?? []);
        const partnerRosters = rosters.filter(
          (r) => r.owner_id && r.owner_id !== user?.user_id
        );

        const MIN_TRADE_VAL = 1500;
        const RATIO_MIN = 0.72;
        const RATIO_MAX = 1.35;

        type TradeSugg = {
          type: "sell-window" | "buy-window";
          giveId: string; receiveId: string;
          giveVal: number; receiveVal: number;
          givePct: number; receivePct: number;
          partnerName: string;
          givePos: string; receivePos: string;
          giveAge?: number; receiveAge?: number;
          giveTeam?: string; receiveTeam?: string;
        };

        const usedGiveA = new Set<string>();
        const usedRecvA = new Set<string>();
        const sellWindowTrades: TradeSugg[] = [];

        if (myRoster) {
          // Sell Window: give my falling players (−5%+); receive ANY fair-value player from the partner
          const mySellCands = [...myPlayerSet]
            .map((id) => ({ id, pct: trendMap.get(id) ?? 0, val: calcFcValues[id] ?? 0 }))
            .filter((x) => x.pct <= -5 && x.val >= MIN_TRADE_VAL)
            .sort((a, b) => a.pct - b.pct); // most-fallen first

          outer1: for (const mine of mySellCands) {
            if (sellWindowTrades.length >= 5) break;
            if (usedGiveA.has(mine.id)) continue;
            for (const partnerRoster of partnerRosters) {
              if (sellWindowTrades.length >= 5) break outer1;
              // Any partner player at fair value — sorted by closest value match, no trend filter
              const partnerCands = ((partnerRoster.players ?? []) as string[])
                .map((id) => ({ id, pct: trendMap.get(id) ?? 0, val: calcFcValues[id] ?? 0 }))
                .filter((x) => x.val >= MIN_TRADE_VAL && !usedRecvA.has(x.id))
                .sort((a, b) => Math.abs(a.val - mine.val) - Math.abs(b.val - mine.val));
              for (const theirs of partnerCands) {
                const ratio = mine.val / theirs.val;
                if (ratio < RATIO_MIN || ratio > RATIO_MAX) continue;
                const myP = players[mine.id];
                const theirP = players[theirs.id];
                if (!myP || !theirP) continue;
                usedGiveA.add(mine.id);
                usedRecvA.add(theirs.id);
                sellWindowTrades.push({
                  type: "sell-window",
                  giveId: mine.id, receiveId: theirs.id,
                  giveVal: mine.val, receiveVal: theirs.val,
                  givePct: mine.pct, receivePct: theirs.pct,
                  partnerName: users[partnerRoster.owner_id] || `Team ${partnerRoster.roster_id}`,
                  givePos: myP.position, receivePos: theirP.position,
                  giveAge: myP.age ?? undefined, receiveAge: theirP.age ?? undefined,
                  giveTeam: myP.team ?? undefined, receiveTeam: theirP.team ?? undefined,
                });
                break;
              }
            }
          }
        }

        const usedGiveB = new Set<string>();
        const usedRecvB = new Set<string>();
        const buyWindowTrades: TradeSugg[] = [];

        if (myRoster) {
          // Buy Window: target partner's rising players (+5%+); give ANY of my fair-value roster players
          // My full roster as give candidates, sorted by value desc for quick closest-match lookup
          const myGiveCands = [...myPlayerSet]
            .map((id) => ({ id, pct: trendMap.get(id) ?? 0, val: calcFcValues[id] ?? 0 }))
            .filter((x) => x.val >= MIN_TRADE_VAL);

          outerBuy: for (const partnerRoster of partnerRosters) {
            if (buyWindowTrades.length >= 5) break;
            const partnerRising = ((partnerRoster.players ?? []) as string[])
              .filter((id) => !myPlayerSet.has(id))
              .map((id) => ({ id, pct: trendMap.get(id) ?? 0, val: calcFcValues[id] ?? 0 }))
              .filter((x) => x.pct >= 5 && x.val >= MIN_TRADE_VAL && !usedRecvB.has(x.id))
              .sort((a, b) => b.pct - a.pct); // highest-rising first

            for (const theirs of partnerRising) {
              if (buyWindowTrades.length >= 5) break outerBuy;
              // Find my closest-value player that hasn't been used yet
              const giveCand = myGiveCands
                .filter((x) => !usedGiveB.has(x.id))
                .sort((a, b) => Math.abs(a.val - theirs.val) - Math.abs(b.val - theirs.val))
                .find((x) => {
                  const ratio = x.val / theirs.val;
                  return ratio >= RATIO_MIN && ratio <= RATIO_MAX;
                });
              if (!giveCand) continue;
              const myP = players[giveCand.id];
              const theirP = players[theirs.id];
              if (!myP || !theirP) continue;
              usedGiveB.add(giveCand.id);
              usedRecvB.add(theirs.id);
              buyWindowTrades.push({
                type: "buy-window",
                giveId: giveCand.id, receiveId: theirs.id,
                giveVal: giveCand.val, receiveVal: theirs.val,
                givePct: giveCand.pct, receivePct: theirs.pct,
                partnerName: users[partnerRoster.owner_id] || `Team ${partnerRoster.roster_id}`,
                givePos: myP.position, receivePos: theirP.position,
                giveAge: myP.age ?? undefined, receiveAge: theirP.age ?? undefined,
                giveTeam: myP.team ?? undefined, receiveTeam: theirP.team ?? undefined,
              });
            }
          }
        }

        const TradeSuggCard = ({ t }: { t: TradeSugg }) => {
          const isSell = t.type === "sell-window";
          const giveP = players[t.giveId];
          const receiveP = players[t.receiveId];
          const lastName = (full: string | undefined) => full?.split(" ").slice(1).join(" ") || full || "";
          return (
            <div className={`rounded-2xl border px-4 py-3 transition ${isSell ? "bg-red-950/10 border-red-900/30 hover:bg-red-950/20" : "bg-green-950/10 border-green-900/30 hover:bg-green-950/20"}`}>
              <div className="flex items-center gap-2 mb-2.5">
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md ${isSell ? "bg-red-900/50 text-red-300" : "bg-green-900/50 text-green-300"}`}>
                  {isSell ? "Sell Window" : "Buy Window"}
                </span>
                <span className="text-[11px] text-gray-500 ml-auto shrink-0">w/ {t.partnerName}</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl bg-gray-900/70 border border-gray-800 px-3 py-2">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 mb-1">You Give</div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-[10px] font-bold shrink-0 ${POS_COLOR[t.givePos] ?? "text-gray-400"}`}>{t.givePos}</span>
                    <span className="text-sm font-semibold text-white truncate">{giveP?.full_name}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{t.giveTeam || "—"} · Age {t.giveAge || "—"}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[11px] text-gray-400 font-mono">{t.giveVal.toLocaleString()}</span>
                    <span className={`text-[11px] font-bold ${t.givePct < 0 ? "text-red-400" : "text-green-400"}`}>
                      {t.givePct > 0 ? "+" : ""}{t.givePct.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="rounded-xl bg-gray-900/70 border border-gray-800 px-3 py-2">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 mb-1">You Receive</div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-[10px] font-bold shrink-0 ${POS_COLOR[t.receivePos] ?? "text-gray-400"}`}>{t.receivePos}</span>
                    <span className="text-sm font-semibold text-white truncate">{receiveP?.full_name}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{t.receiveTeam || "—"} · Age {t.receiveAge || "—"}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[11px] text-gray-400 font-mono">{t.receiveVal.toLocaleString()}</span>
                    <span className={`text-[11px] font-bold ${t.receivePct >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {t.receivePct > 0 ? "+" : ""}{t.receivePct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-2.5 text-[11px] text-gray-400 leading-relaxed">
                {isSell
                  ? `Sell ${lastName(giveP?.full_name)} while the market is down ${Math.abs(t.givePct).toFixed(0)}% and get fair value back in ${lastName(receiveP?.full_name)}${t.receivePct >= 5 ? ` (up ${t.receivePct.toFixed(0)}%)` : ""} before your asset drops further.`
                  : `${lastName(receiveP?.full_name)} is up ${t.receivePct.toFixed(0)}% — buy in now using ${lastName(giveP?.full_name)}${t.givePct >= 10 ? ` (up ${t.givePct.toFixed(0)}%, sell high)` : ""} before the market catches on.`
                }
              </div>
            </div>
          );
        };

        return (
          <>
            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex gap-1.5">
                {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setTrendPos(pos)}
                    className={`px-3 py-1 rounded text-sm font-medium transition ${trendPos === pos ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
                  >
                    {pos}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500 shrink-0">Threshold</span>
                <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
                  {[5, 10, 15, 20].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => setTrendThreshold(pct)}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition ${trendThreshold === pct ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Snapshot age banner */}
            <div className={`flex flex-wrap items-center gap-2 mb-5 rounded-xl border px-4 py-2.5 ${isStaleSnapshot ? "border-amber-700/50 bg-amber-950/20" : "border-gray-800 bg-gray-900/60"}`}>
              <span className={`text-[11px] ${isStaleSnapshot ? "text-amber-400" : "text-gray-500"}`}>Comparing current values against snapshot from</span>
              <span className={`text-[11px] font-semibold ${isStaleSnapshot ? "text-amber-300" : "text-gray-300"}`}>{ageLabel}</span>
              <span className="text-[11px] text-gray-600">({snapshotDate.toLocaleDateString()})</span>
              {isStaleSnapshot && <span className="text-[10px] text-amber-500 font-semibold">· snapshot may be stale</span>}
              <span className="text-[10px] text-gray-600">{Object.keys(snap.players).length} players tracked</span>
              <button
                type="button"
                disabled={savingSnapshot}
                onClick={async () => {
                  setSavingSnapshot(true);
                  await onSaveSnapshot();
                  setSavingSnapshot(false);
                  setSnapshotSavedAt(Date.now());
                }}
                className="ml-auto text-[10px] font-semibold border rounded-lg px-2.5 py-1 transition disabled:opacity-50 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
              >
                {savingSnapshot ? "Saving…" : snapshotSavedAt ? "✓ Snapshot Saved" : "Take Snapshot Now"}
              </button>
            </div>

            {/* Column headers */}
            <div className="flex items-center gap-2 px-3 mb-1">
              <span className="w-6 shrink-0" />
              <span className="flex-1 text-[10px] text-gray-600 uppercase tracking-wider">Player</span>
              <span className="w-7 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Age</span>
              <span className="hidden md:block w-8 shrink-0" />
              <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Now</span>
              <span className="hidden sm:block w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Then</span>
              <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Δ %</span>
              <span className="w-8 shrink-0" />
            </div>

            {/* Sell window */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold text-red-400">Sell Window Open</span>
                <span className="rounded-full bg-red-950/50 border border-red-900/50 px-2 py-0.5 text-[10px] font-semibold text-red-400">{falling.length}</span>
                <span className="text-[11px] text-gray-500">Value fell {trendThreshold}%+ — sell before it drops further</span>
              </div>
              {falling.length === 0 ? (
                <p className="text-sm text-gray-600 px-1">No players down {trendThreshold}%+ from the snapshot.</p>
              ) : (
                <div className="space-y-1">
                  {falling.map((row) => <TrendRow key={row.playerId} row={row} direction="down" />)}
                </div>
              )}
            </div>

            {/* Rising / buy window closing */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold text-green-400">Buy Window Closing</span>
                <span className="rounded-full bg-green-950/50 border border-green-900/50 px-2 py-0.5 text-[10px] font-semibold text-green-400">{rising.length}</span>
                <span className="text-[11px] text-gray-500">Value up {trendThreshold}%+ — buy now or sell at peak</span>
              </div>
              {rising.length === 0 ? (
                <p className="text-sm text-gray-600 px-1">No players up {trendThreshold}%+ from the snapshot.</p>
              ) : (
                <div className="space-y-1">
                  {rising.map((row) => <TrendRow key={row.playerId} row={row} direction="up" />)}
                </div>
              )}
            </div>

            {/* ── Trade suggestions divider ── */}
            <div className="my-8 border-t border-gray-800" />
            <div className="mb-5">
              <h3 className="text-base font-bold text-white">Trend-Based Trade Suggestions</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {!user || !rosters.length
                  ? "Load a league to see trade suggestions based on your roster."
                  : `Up to 5 suggestions per window · fixed thresholds: sell at −5%, buy at +5%, peak at +20%`}
              </p>
            </div>

            {(!user || !rosters.length) ? (
              <p className="text-sm text-gray-600 px-1">No league loaded. Select a league from the League Hub first.</p>
            ) : (
              <>
                {/* Sell Window Trades */}
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm font-bold text-red-400">Sell Window Trades</span>
                    <span className="rounded-full bg-red-950/50 border border-red-900/50 px-2 py-0.5 text-[10px] font-semibold text-red-400">{sellWindowTrades.length}</span>
                    <span className="text-[11px] text-gray-500">Give your −5%+ fallers · receive fair-value assets from league mates</span>
                  </div>
                  {sellWindowTrades.length === 0 ? (
                    <p className="text-sm text-gray-600 px-1">
                      No matches found — either no roster players are down 5%+, no league mates hold players up 20%+, or value gaps are too wide.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {sellWindowTrades.map((t) => <TradeSuggCard key={`${t.giveId}-${t.receiveId}`} t={t} />)}
                    </div>
                  )}
                </div>

                {/* Buy Window Trades */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm font-bold text-green-400">Buy Window Trades</span>
                    <span className="rounded-full bg-green-950/50 border border-green-900/50 px-2 py-0.5 text-[10px] font-semibold text-green-400">{buyWindowTrades.length}</span>
                    <span className="text-[11px] text-gray-500">Target partners&apos; +5%+ early risers · give your closest fair-value asset in return</span>
                  </div>
                  {buyWindowTrades.length === 0 ? (
                    <p className="text-sm text-gray-600 px-1">
                      No matches found — either no roster players are up 20%+, no league mates hold early-rising players, or value gaps are too wide.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {buyWindowTrades.map((t) => <TradeSuggCard key={`${t.giveId}-${t.receiveId}`} t={t} />)}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        );
      })()}

      {/* ── PLAYER PROJECTIONS ── */}
      {dataHubTab === "PROJECTIONS" && (() => {
        const myRoster = rosters.find((r) => r.owner_id === user?.user_id);
        const myPlayerSet = new Set<string>(myRoster?.players ?? []);
        const visible = projectionData
          .filter((p) => projectionPosFilter === "ALL" || p.position === projectionPosFilter)
          .filter((p) => !projRosterOnly || myPlayerSet.has(p.sleeperId));

        return (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 shrink-0">View:</span>
                <select
                  value={projectionWeek}
                  onChange={(e) => {
                    const w = Number(e.target.value);
                    setProjectionWeek(w);
                    setProjectionLoaded(false);
                    setProjectionData([]);
                    loadProjections(w === 0 ? "season" : w, [...enabledExtraSources]);
                  }}
                  className="bg-gray-800 border border-gray-700 text-sm text-white rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500"
                >
                  <option value={0}>Full Season Projection</option>
                  {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                    <option key={w} value={w}>Week {w}</option>
                  ))}
                </select>
              </div>

              {projectionSeasonYear && (
                <span className="rounded-full border border-gray-700 bg-gray-900/70 px-3 py-1 text-[11px] font-medium text-gray-300">
                  {projectionWeek === 0 ? `${projectionSeasonYear} season projections` : `${projectionSeasonYear} projections`}
                </span>
              )}

              <div className="flex gap-2">
                {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setProjectionPosFilter(pos)}
                    className={`px-3 py-1 rounded text-sm font-medium transition ${projectionPosFilter === pos ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
                  >
                    {pos}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setProjRosterOnly((v) => !v)}
                disabled={!myRoster}
                className={`text-xs font-semibold border rounded-lg px-3 py-1.5 transition disabled:opacity-40 ${projRosterOnly ? "bg-blue-600 border-blue-500 text-white" : "border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"}`}
                title={myRoster ? "Toggle to show only your rostered players" : "Load a league to use this filter"}
              >
                My Roster
              </button>
              <button
                onClick={() => {
                  setProjectionLoaded(false);
                  setProjectionData([]);
                  loadProjections(projectionWeek === 0 ? "season" : projectionWeek, [...enabledExtraSources]);
                }}
                className="ml-auto text-xs font-semibold text-blue-400 hover:text-blue-300 border border-blue-700 hover:border-blue-500 rounded-lg px-3 py-1.5 transition"
              >
                Refresh
              </button>
            </div>

            {/* Source pills */}
            <div className="flex gap-2 mb-1 flex-wrap items-center">
              {PROJ_SOURCES.map((src) => {
                const ok = projectionSourceStatus[src.id];
                const isSleeper = src.id === "sleeper";
                const isEnabled = isSleeper || enabledExtraSources.has(src.id);
                const verifyUrl =
                  src.id === "fantasypros"
                    ? `https://www.fantasypros.com/nfl/projections/qb.php?week=${projectionWeek === 0 ? "draft" : projectionWeek}&scoring=PPR`
                    : src.id === "numberfire"
                    ? "https://www.fanduel.com/research/nfl/fantasy/fantasy-football-projections/qb"
                    : `https://api.sleeper.app/projections/nfl/${projectionSeasonYear ?? new Date().getFullYear()}?season_type=regular&position=QB&order_by=pts_ppr`;

                return (
                  <div key={src.id} className="flex items-center gap-1">
                    {isSleeper ? (
                      // Sleeper: always-on status pill (not a toggle)
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ok === true ? "bg-green-900 text-green-300" : ok === false ? "bg-red-900 text-red-400" : "bg-gray-800 text-gray-400"}`}
                      >
                        {src.label} ✓
                      </span>
                    ) : (
                      // FantasyPros / numberFire: toggle button
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(enabledExtraSources);
                          if (next.has(src.id)) {
                            next.delete(src.id);
                          } else {
                            next.add(src.id);
                          }
                          setEnabledExtraSources(next);
                          setProjectionLoaded(false);
                          setProjectionData([]);
                          loadProjections(
                            projectionWeek === 0 ? "season" : projectionWeek,
                            [...next]
                          );
                        }}
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition ${
                          isEnabled
                            ? ok === true
                              ? "bg-green-900 border-green-700 text-green-300"
                              : ok === false
                              ? "bg-red-900 border-red-700 text-red-400"
                              : "bg-blue-900 border-blue-700 text-blue-300"
                            : "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
                        }`}
                        title={isEnabled ? `Disable ${src.label}` : `Enable ${src.label} — verify the link first`}
                      >
                        {src.label} {isEnabled ? (ok === true ? "✓" : ok === false ? "✕" : "…") : "+ Add"}
                      </button>
                    )}
                    {/* Verify link */}
                    <a
                      href={verifyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Open ${src.label} source — verify it shows ${projectionSeasonYear ?? new Date().getFullYear()} data before enabling`}
                      className="text-[10px] text-gray-600 hover:text-blue-400 transition"
                    >
                      ↗
                    </a>
                  </div>
                );
              })}
              {loadingProjections && <span className="text-[10px] text-blue-400 ml-1">Loading…</span>}
            </div>
            <p className="text-[10px] text-gray-600 mb-4">
              Sleeper is always on and year-verified. Click <span className="text-gray-400">↗</span> on FantasyPros or numberFire to check the data year before enabling them — their full-season endpoints don&apos;t publish {new Date().getFullYear()} numbers until closer to training camp.
            </p>

            {projectionUsesSeasonFallback && projectionWeek !== 0 && (
              <div className="mb-4 rounded-lg border border-yellow-700/50 bg-yellow-950/30 px-3 py-2 text-[11px] text-yellow-300">
                Weekly projections not yet available — showing Sleeper full-season projections ÷ 17 as a placeholder. Rankings will automatically switch to the full multi-source consensus once week-by-week projections are published closer to the season.
              </div>
            )}

            {loadingProjections && projectionData.length === 0 ? (
              <p className="text-sm text-blue-400">Fetching consensus projections…</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-gray-500">No projection data. Hit Refresh or check your connection.</p>
            ) : (
              <>
                <div className="flex items-center gap-3 px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                  <span className="w-6 text-right shrink-0">#</span>
                  <span className="w-7 shrink-0">Pos</span>
                  <span className="flex-1">Player</span>
                  <span className="w-10 text-right shrink-0">FPTS</span>
                  <span className="hidden sm:block w-14 text-right shrink-0">Dyn</span>
                  <span className="w-10 text-right shrink-0 pr-1">Srcs</span>
                </div>
                <div className="space-y-1">
                  {visible.map((p, idx) => {
                    const dynVal = calcFcValues[p.sleeperId] ?? 0;
                    return (
                      <div key={p.sleeperId} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2">
                        <span className="text-xs text-gray-500 w-6 text-right shrink-0">{idx + 1}</span>
                        <span className={`text-[10px] font-bold w-7 shrink-0 ${POS_COLOR[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                        <span className="text-sm text-white flex-1 truncate">{p.full_name}</span>
                        {p.team && <span className="text-[10px] text-gray-500 shrink-0">{p.team}</span>}
                        <span className="text-xs text-gray-300 font-mono w-10 text-right shrink-0">{p.fpts.toFixed(1)}</span>
                        <span className={`hidden sm:block text-[10px] font-mono w-14 text-right shrink-0 ${dynVal > 0 ? "text-gray-400" : "text-gray-700"}`}>
                          {dynVal > 0 ? dynVal.toLocaleString() : "—"}
                        </span>
                        <span className="text-[10px] text-gray-600 w-10 text-right shrink-0 pr-1" title={p.sources.join(", ")}>
                          {p.sources.length}/{Object.values(projectionSourceStatus).filter(Boolean).length || PROJ_SOURCES.length}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        );
      })()}

      {/* ── PICK VALUES ── */}
      {dataHubTab === "PICK_VALUES" && (() => {
        const CrossLeagueSection = () => (
          <div className="mt-6 border-t border-gray-800 pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">My Picks Across All Leagues</h3>
              {!crossLeaguePicksLoaded ? (
                <button
                  onClick={loadCrossLeaguePicks}
                  disabled={loadingCrossLeaguePicks || !user || !leagues.length}
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded transition"
                >
                  {loadingCrossLeaguePicks ? "Loading…" : "Load"}
                </button>
              ) : (
                <button
                  onClick={loadCrossLeaguePicks}
                  disabled={loadingCrossLeaguePicks}
                  className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition"
                >
                  {loadingCrossLeaguePicks ? "Refreshing…" : "Refresh"}
                </button>
              )}
            </div>
            {!crossLeaguePicksLoaded && !loadingCrossLeaguePicks && (
              <p className="text-sm text-gray-500">Load to see all draft picks you own across every league.</p>
            )}
            {loadingCrossLeaguePicks && <p className="text-sm text-blue-400">Fetching picks from all leagues…</p>}
            {crossLeaguePicksLoaded && (
              crossLeaguePicks.length === 0 ? (
                <p className="text-sm text-gray-500">No future picks found across your leagues.</p>
              ) : (
                <div className="space-y-3">
                  {crossLeaguePicks.map((entry) => (
                    <div key={entry.leagueName} className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
                      <div className="text-xs font-semibold text-gray-300 mb-2">{entry.leagueName}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {[...entry.picks]
                          .sort((a, b) => a.season !== b.season ? Number(a.season) - Number(b.season) : a.round - b.round)
                          .map((pick) => {
                            const yi = PICK_YEARS.indexOf(String(pick.season));
                            const stdVal = yi >= 0 ? (STANDARD_PICK_VALUES[`${pick.round}-${yi}`] ?? null) : null;
                            return (
                              <span key={`${pick.season}-${pick.round}-${pick.roster_id}`} className="flex flex-col items-center text-center px-2 py-1 rounded-lg bg-blue-900/30 border border-blue-800/50">
                                <span className="text-[10px] font-semibold text-blue-300">{pick.season} R{pick.round}</span>
                                {stdVal && <span className="text-[8px] text-blue-500 font-mono leading-tight">~{stdVal.toLocaleString()}</span>}
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        );

        if (!selectedLeague || !rosters.length) {
          return (
            <>
              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4 mb-4">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Pick Value Benchmarks</div>
                <p className="text-xs text-gray-400 mb-3">Approximate dynasty (SF) consensus values. Load a league for dynamic pick values tied to actual standings and playoff odds.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left py-1.5 px-2 text-[10px] text-gray-500 uppercase tracking-wider">Round</th>
                        {PICK_YEARS.map((year) => (
                          <th key={year} className="text-right py-1.5 px-2 text-[10px] text-gray-500 uppercase tracking-wider">{year}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PICK_ROUNDS.map((round) => (
                        <tr key={round} className="border-b border-gray-800/50">
                          <td className="py-1.5 px-2 text-xs font-semibold text-white">Round {round}</td>
                          {PICK_YEARS.map((_, yi) => (
                            <td key={yi} className="py-1.5 px-2 text-right text-xs text-gray-400 font-mono">
                              {(STANDARD_PICK_VALUES[`${round}-${yi}`] ?? 0).toLocaleString()}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <CrossLeagueSection />
            </>
          );
        }

        const pickRows = allPicks
          .map((pick) => {
            const key = `${pick.season}-${pick.round}-${pick.roster_id}`;
            const dynamic = selectedLeagueDynamicPickValues[key];
            const ownerName = users[pick.owner_id] || `Team ${pick.owner_id}`;
            const issuerName = users[pick.roster_id] || `Team ${pick.roster_id}`;
            const pickLabel = pick.slot && String(pick.slot).includes(".")
              ? `${pick.season} ${pick.slot}`
              : `${pick.season} Rd ${pick.round}`;
            return { ...pick, key, ownerName, issuerName, pickLabel, dynamic };
          })
          .sort((a, b) => (b.dynamic?.expectedValue ?? 0) - (a.dynamic?.expectedValue ?? 0));

        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Dynamic Pick Valuation</div>
              <div className="mt-1 text-sm text-gray-200">
                Each pick now uses simulated finish distributions, expected slot outcomes, and team-specific playoff odds instead of one flat round value.
              </div>
            </div>

            <div className="space-y-2">
              {pickRows.map((pick) => {
                const dynamic = pick.dynamic;
                if (!dynamic) return null;
                return (
                  <div key={pick.key} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">{pick.pickLabel}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            dynamic.bucket === "early" ? "border-red-700 bg-red-950/40 text-red-300" :
                            dynamic.bucket === "late" ? "border-green-700 bg-green-950/40 text-green-300" :
                            "border-yellow-700 bg-yellow-950/40 text-yellow-300"
                          }`}>
                            {dynamic.label}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          Owned by {pick.ownerName} • tied to {pick.issuerName}&apos;s finish
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-blue-300">{(dynamic.expectedValue || 0).toLocaleString()}</div>
                        <div className="text-[11px] text-gray-500">Range {dynamic.floorValue?.toLocaleString()} - {dynamic.ceilingValue?.toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Expected Slot</div>
                        <div className="mt-1 text-sm font-semibold text-white">
                          {typeof dynamic.expectedSlot === "number" ? dynamic.expectedSlot.toFixed(1) : "-"}
                        </div>
                        <div className="text-[11px] text-gray-500">Finish band {dynamic.finishRange || "-"}</div>
                      </div>
                      <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Issuer Outlook</div>
                        <div className="mt-1 text-sm font-semibold text-white">{Math.round(dynamic.issuerPlayoffOdds || 0)}%</div>
                        <div className="text-[11px] text-gray-500">Playoff odds for {dynamic.issuerName || pick.issuerName}</div>
                      </div>
                      <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Most Likely Slots</div>
                        <div className="mt-1 text-xs text-gray-300">
                          {(dynamic.likelySlots || []).length > 0
                            ? dynamic.likelySlots.map((slotRow) => `${slotRow.slot} (${Math.round((slotRow.probability || 0) * 100)}%)`).join(" | ")
                            : "No slot spread"}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      {(["early", "mid", "late"] as const).map((bucket) => (
                        <div key={bucket} className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-gray-500">{bucket}</div>
                          <div className="mt-1 text-sm font-semibold text-white">
                            {Math.round((dynamic.probabilities?.[bucket] || 0) * 100)}%
                          </div>
                          <div className="text-[11px] text-gray-500">
                            {(dynamic.bandValues?.[bucket] ?? dynamic.expectedValue ?? 0).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <CrossLeagueSection />
          </div>
        );
      })()}

      {/* ── LEAGUE MATE STATS ── */}
      {dataHubTab === "LEAGUEMATES" && (() => {
        const filtered = leagueMateStats.filter((o) =>
          o.displayName.toLowerCase().includes(leagueMateSearch.toLowerCase())
        );

        const sorted = [...filtered].sort((a, b) => {
          if (leagueMateSort === "total")    return b.totalLeagues    - a.totalLeagues    || a.displayName.localeCompare(b.displayName);
          if (leagueMateSort === "bestball") return b.bestBallLeagues - a.bestBallLeagues || a.displayName.localeCompare(b.displayName);
          if (leagueMateSort === "shared")  return b.sharedLeagues   - a.sharedLeagues   || a.displayName.localeCompare(b.displayName);
          return a.displayName.localeCompare(b.displayName);
        });

        const thSort = (col: typeof leagueMateSort, label: string) => (
          <button
            onClick={() => setLeagueMateSort(col)}
            className={`flex items-center gap-1 whitespace-nowrap ${leagueMateSort === col ? "text-blue-400" : "text-gray-500 hover:text-gray-300"}`}
          >
            {label}
            <span className="text-[10px]">{leagueMateSort === col ? "▼" : "↕"}</span>
          </button>
        );

        return (
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">League Mate Stats</h2>
              {!leagueMateStatsLoaded ? (
                <button
                  onClick={loadLeagueMateStats}
                  disabled={loadingLeagueMateStats}
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded transition"
                >
                  {loadingLeagueMateStats ? "Loading…" : "Load Stats"}
                </button>
              ) : (
                <button
                  onClick={loadLeagueMateStats}
                  disabled={loadingLeagueMateStats}
                  className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition"
                >
                  {loadingLeagueMateStats ? "Refreshing…" : "Refresh"}
                </button>
              )}
            </div>

            {!leagueMateStatsLoaded && !loadingLeagueMateStats && (
              <p className="text-sm text-gray-500">Click Load Stats to fetch data across all your leagues.</p>
            )}
            {loadingLeagueMateStats && (
              <p className="text-sm text-blue-400">Loading league mate data…</p>
            )}

            {leagueMateStatsLoaded && (
              <>
                <input
                  className="w-full mb-4 p-2.5 rounded bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                  placeholder="Search owner name…"
                  value={leagueMateSearch}
                  onChange={(e) => setLeagueMateSearch(e.target.value)}
                />
                {sorted.length === 0 ? (
                  <p className="text-sm text-gray-500">No owners match your search.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-gray-700">
                          <th className="text-left py-2 px-3">{thSort("name", "Owner")}</th>
                          <th className="text-center py-2 px-3">{thSort("total", "Total Leagues")}</th>
                          <th className="text-center py-2 px-3">{thSort("bestball", "Best Ball")}</th>
                          <th className="text-center py-2 px-3">{thSort("shared", "Shared Leagues")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((owner, i) => {
                          const isExpanded = expandedMateId === owner.userId;
                          const ownerExposure: ExposureData | null = isExpanded ? (externalShares ?? null) : null;
                          return (
                            <React.Fragment key={owner.userId}>
                              <tr
                                className={`cursor-pointer transition ${i % 2 === 0 ? "bg-slate-900" : "bg-slate-950"} hover:bg-slate-800`}
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedMateId(null);
                                  } else {
                                    setExpandedMateId(owner.userId);
                                    loadUserExposure(owner.userId);
                                  }
                                }}
                              >
                                <td className="py-2 px-3 text-white font-medium flex items-center gap-1">
                                  <span className="text-gray-500 text-[10px] mr-1">{isExpanded ? "▼" : "▶"}</span>
                                  {owner.displayName}
                                </td>
                                <td className="py-2 px-3 text-center text-gray-300">{owner.totalLeagues}</td>
                                <td className="py-2 px-3 text-center text-gray-300">{owner.bestBallLeagues}</td>
                                <td className="py-2 px-3 text-center">
                                  <span className="text-blue-400 font-semibold">{owner.sharedLeagues}</span>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className={i % 2 === 0 ? "bg-slate-900" : "bg-slate-950"}>
                                  <td colSpan={4} className="px-4 pb-3 pt-1">
                                    {loadingShares ? (
                                      <p className="text-xs text-blue-400 py-2">Loading exposure…</p>
                                    ) : ownerExposure !== null && ownerExposure.players.length > 0 ? (
                                      <div>
                                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                                          Top Owned Players · {ownerExposure.leagueCount} league{ownerExposure.leagueCount !== 1 ? "s" : ""}
                                        </p>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                                          {ownerExposure.players.map((entry) => {
                                            const p = players[entry.playerId];
                                            if (!p) return null;
                                            return (
                                              <div key={entry.playerId} className="flex items-center gap-1.5 rounded-lg bg-gray-800/60 px-2 py-1">
                                                <span className={`text-[9px] font-bold shrink-0 ${POS_COLOR[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                                                <span className="text-xs text-white truncate flex-1">{p.full_name}</span>
                                                <span className="text-[10px] text-blue-400 font-mono shrink-0">{entry.percent}%</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ) : (
                                      <p className="text-xs text-gray-600 py-1">No shared player data found.</p>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="text-xs text-gray-600 mt-3">Total Leagues = {CURRENT_YEAR} non-best-ball NFL leagues for that owner on Sleeper. Click a row to see shared player exposure.</p>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* ── DEPTH CHARTS ── */}
      {dataHubTab === "DEPTH_CHARTS" && (() => {
        // Build owned player set across all rosters in the selected league (or all leagues)
        const ownedIds = new Set<string>(
          rosters.flatMap((r) => [
            ...(r.players ?? []),
            ...(r.taxi ?? []),
          ])
        );

        // Build team → position → players map from the Sleeper player database.
        // Include every player with a team assignment — never gate on status or
        // depth_chart_order being populated, as Sleeper frequently leaves those null
        // for rostered players (e.g. practice squad, IR, late additions).
        const teamMap = new Map<string, Record<string, SleeperPlayer[]>>();
        Object.values(players).forEach((p) => {
          if (!p.team || !["QB", "RB", "WR", "TE"].includes(p.position)) return;
          // Only skip truly non-roster entries
          const status = (p.status ?? "").toLowerCase();
          if (status === "retired") return;
          if (!teamMap.has(p.team)) teamMap.set(p.team, { QB: [], RB: [], WR: [], TE: [] });
          teamMap.get(p.team)![p.position].push(p);
        });
        // Sort each position group:
        //   1. Explicit depth_chart_order (0 = starter, ascending)
        //   2. Fallback: dynasty value descending (higher value = more likely the starter)
        teamMap.forEach((posMap) => {
          Object.keys(posMap).forEach((pos) => {
            posMap[pos].sort((a, b) => {
              const oa = a.depth_chart_order ?? null;
              const ob = b.depth_chart_order ?? null;
              if (oa !== null && ob !== null) return oa - ob;
              if (oa !== null) return -1;
              if (ob !== null) return 1;
              // Both null — higher dynasty value = higher on the depth chart
              return (calcFcValues[b.player_id] ?? 0) - (calcFcValues[a.player_id] ?? 0);
            });
          });
        });

        // Sorted list of teams, optionally filtered by search
        const allTeams = Array.from(teamMap.keys()).sort();
        const filteredTeams = allTeams.filter((team) => {
          if (depthTeamSearch.trim()) {
            const q = depthTeamSearch.toLowerCase();
            if (!team.toLowerCase().includes(q)) return false;
          }
          if (depthShowOwnedOnly) {
            const posGroup = teamMap.get(team)?.[depthPos] ?? [];
            return posGroup.some((p) => ownedIds.has(p.player_id));
          }
          return true;
        });

        // Returns the depth role label for a player.
        // index 0 = Starter, index 1 = Handcuff — BUT only if value < 1400.
        // At 1400+ the player has standalone dynasty value and is not a true handcuff.
        const HC_VALUE_THRESHOLD = 1400;
        const getDepthRole = (team: string, player: SleeperPlayer): "STARTER" | "HANDCUFF" | null => {
          const group = teamMap.get(team)?.[depthPos] ?? [];
          const idx = group.findIndex((p) => p.player_id === player.player_id);
          if (idx === 0) return "STARTER";
          const val = calcFcValues[player.player_id] ?? 0;
          if (idx === 1 && val < HC_VALUE_THRESHOLD) return "HANDCUFF";
          return null;
        };

        return (
          <div>
            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
              {/* Position filter */}
              <div className="flex gap-1 bg-gray-800/60 rounded-xl p-1">
                {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setDepthPos(pos)}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                      depthPos === pos
                        ? pos === "QB" ? "bg-red-900/60 text-red-300"
                        : pos === "RB" ? "bg-green-900/60 text-green-300"
                        : pos === "WR" ? "bg-blue-900/60 text-blue-300"
                        : "bg-yellow-900/60 text-yellow-300"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {pos}
                  </button>
                ))}
              </div>
              {/* Team search */}
              <input
                type="text"
                value={depthTeamSearch}
                onChange={(e) => setDepthTeamSearch(e.target.value)}
                placeholder="Filter team…"
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 w-36"
              />
              {/* Owned only toggle */}
              <button
                onClick={() => setDepthShowOwnedOnly((v) => !v)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
                  depthShowOwnedOnly
                    ? "border-blue-600 bg-blue-900/30 text-blue-300"
                    : "border-gray-700 text-gray-400 hover:text-white"
                }`}
              >
                Owned Players Only
              </button>
              {/* Legend */}
              <div className="flex items-center gap-3 ml-auto text-[10px] text-gray-500 flex-wrap">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"/> Owned</span>
                <span className="flex items-center gap-1"><span className="rounded px-1 bg-gray-700 text-gray-200 font-bold">Starter</span> Depth #1</span>
                <span className="flex items-center gap-1"><span className="rounded px-1 bg-amber-900/60 text-amber-300 font-bold">HC</span> Depth #2 handcuff</span>
              </div>
            </div>

            {/* Team grid — fills full width; more columns on wider screens */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {filteredTeams.map((team) => {
                const posGroup = teamMap.get(team)?.[depthPos] ?? [];
                if (posGroup.length === 0) return null;
                const hasOwned = posGroup.some((p) => ownedIds.has(p.player_id));
                return (
                  <div
                    key={team}
                    className={`rounded-2xl border bg-gray-900/60 overflow-hidden ${
                      hasOwned ? "border-blue-800/60" : "border-gray-800"
                    }`}
                  >
                    {/* Team header */}
                    <div className={`px-3 py-2 border-b flex items-center justify-between ${
                      hasOwned ? "border-blue-800/40 bg-blue-950/20" : "border-gray-800"
                    }`}>
                      <span className="text-sm font-bold text-white">{team}</span>
                      {hasOwned && <span className="text-[9px] font-bold text-blue-400 uppercase tracking-wide">You own</span>}
                    </div>
                    {/* Player rows */}
                    <div className="divide-y divide-gray-800/40">
                      {posGroup.slice(0, depthPos === "WR" ? 5 : 4).map((p, rowIdx) => {
                        const isOwned = ownedIds.has(p.player_id);
                        const role = getDepthRole(team, p);
                        const val = calcFcValues[p.player_id] ?? 0;
                        return (
                          <div
                            key={p.player_id}
                            className={`flex items-center gap-2 px-3 py-1.5 ${
                              isOwned ? "bg-blue-950/20" : ""
                            }`}
                          >
                            {/* Depth number */}
                            <span className={`text-[10px] font-bold w-4 shrink-0 ${
                              rowIdx === 0 ? "text-white" : "text-gray-600"
                            }`}>{rowIdx + 1}</span>
                            {/* Name + role badge + injury */}
                            <div className="flex-1 min-w-0 flex items-center gap-1 flex-wrap">
                              <span className={`text-xs font-medium ${isOwned ? "text-blue-200" : "text-white"}`}>
                                {p.full_name || `${p.first_name} ${p.last_name}`}
                              </span>
                              {injuryBadge(p.injury_status)}
                              {role === "STARTER"  && <span className="text-[9px] font-bold px-1 rounded bg-gray-700 text-gray-200 shrink-0">Starter</span>}
                              {role === "HANDCUFF" && <span className="text-[9px] font-bold px-1 rounded bg-amber-900/60 text-amber-300 shrink-0">HC</span>}
                            </div>
                            {/* Age */}
                            <span className={`text-[10px] shrink-0 ${ageColor(p.age ?? undefined, p.position)}`}>
                              {p.age ?? "—"}
                            </span>
                            {/* Value */}
                            {val > 0 && (
                              <span className="text-[10px] font-mono text-gray-400 shrink-0 w-12 text-right">
                                {val.toLocaleString()}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {filteredTeams.length === 0 && (
                <div className="col-span-full rounded-xl border border-dashed border-gray-700 bg-gray-900/40 p-6 text-sm text-gray-400">
                  No teams match your filter.
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── BUY LOW RANKINGS ── */}
      {dataHubTab === "BUY_LOW" && (() => {
        // ── Age multiplier by position ──────────────────────────────────────
        // Younger players with depressed production have more recovery runway,
        // so the same rank gap scores higher for a 23-year-old than a 31-year-old.
        const getAgeMult = (age: number, pos: string): number => {
          if (!age) return 0.8;
          if (pos === "QB") {
            if (age <= 25) return 1.5;
            if (age <= 28) return 1.2;
            if (age <= 31) return 0.85;
            return 0.5;
          }
          if (pos === "RB") {
            if (age <= 22) return 1.6;
            if (age <= 24) return 1.3;
            if (age <= 26) return 0.9;
            return 0.4;
          }
          if (pos === "WR") {
            if (age <= 24) return 1.5;
            if (age <= 27) return 1.2;
            if (age <= 30) return 0.85;
            return 0.5;
          }
          // TE
          if (age <= 25) return 1.5;
          if (age <= 27) return 1.2;
          if (age <= 30) return 0.85;
          return 0.5;
        };

        // Minimum dynasty value to be in the qualified pool — filters out stashes
        // and deep bench players that no one is realistically buying.
        const MIN_DYN_VAL: Record<string, number> = { QB: 500, RB: 350, WR: 350, TE: 350 };

        const projBySleeperID = new Map<string, number>(
          projectionData.map((r) => [String(r.sleeperId), Number(r.fpts || 0)])
        );
        const projectionsLoaded = projectionData.length > 0;

        const allBuyLowRows: {
          player_id: string; full_name: string; pos: string; age: number; team: string;
          dynVal: number; dynRank: number; projRank: number; gap: number;
          ageMult: number; score: number; usingFallback: boolean;
        }[] = [];

        for (const pos of ["QB", "RB", "WR", "TE"] as const) {
          const minVal = MIN_DYN_VAL[pos];
          const pool = Object.values(players)
            .filter((p) => p.position === pos && (calcFcValues[p.player_id] ?? 0) >= minVal)
            .map((p) => {
              const hasFpts = projBySleeperID.has(p.player_id);
              const projFpts = hasFpts
                ? projBySleeperID.get(p.player_id)!
                : (redraftValues[p.player_id] ?? 0);
              return {
                player_id: p.player_id,
                full_name: p.full_name,
                pos,
                age: Number(p.age || 0),
                team: p.team || "",
                status: p.injury_status || null,
                dynVal: calcFcValues[p.player_id] ?? 0,
                projFpts,
                usingFallback: !hasFpts,
              };
            });

          const n = pool.length;
          if (n < 2) continue;

          const dynSorted  = [...pool].sort((a, b) => b.dynVal - a.dynVal);
          const projSorted = [...pool].sort((a, b) => b.projFpts - a.projFpts);
          const dynRankMap  = new Map(dynSorted.map((p, i) => [p.player_id, i + 1]));
          const projRankMap = new Map(projSorted.map((p, i) => [p.player_id, i + 1]));

          for (const p of pool) {
            const dynRank  = dynRankMap.get(p.player_id)!;
            const projRank = projRankMap.get(p.player_id)!;
            // Buy low = dynasty rank is WORSE (higher number) than production rank.
            // e.g. dynasty rank 15, proj rank 6 → gap = 15 - 6 = +9 → underpriced, buy them.
            // e.g. dynasty rank 6, proj rank 26 → gap = 6 - 26 = -20 → overpriced, skip.
            const gap = dynRank - projRank;
            const normalizedGap = gap / n;
            const ageMult = getAgeMult(p.age, pos);
            // Boost toward players producing well relative to their price — confirms the
            // buy low thesis isn't just random noise but real, measurable output.
            const projPctile = (n - projRank) / Math.max(n - 1, 1);
            const raw = Math.max(0, normalizedGap) * ageMult * (0.55 + 0.45 * projPctile);
            allBuyLowRows.push({
              ...p, dynRank, projRank, gap, ageMult, score: raw, usingFallback: p.usingFallback,
            });
          }
        }

        // Normalize raw scores to 0–100
        const maxRaw = Math.max(...allBuyLowRows.filter((r) => !r.usingFallback).map((r) => r.score), 0.001);
        const scored = allBuyLowRows
          .map((r) => ({ ...r, score: r.usingFallback ? 0 : Math.round((r.score / maxRaw) * 100) }))
          .filter((r) => r.gap > 0)
          .sort((a, b) => {
            // Players with real projections first, sorted by score desc.
            // Fallback players sorted to the bottom, by gap desc within that group.
            if (a.usingFallback !== b.usingFallback) return a.usingFallback ? 1 : -1;
            if (!a.usingFallback) return b.score - a.score;
            return b.gap - a.gap;
          });

        const visible = buyLowPos === "ALL" ? scored : scored.filter((r) => r.pos === buyLowPos);

        const scoreColor = (s: number) =>
          s >= 70 ? "bg-green-700 text-green-100" :
          s >= 45 ? "bg-yellow-700/80 text-yellow-100" :
          "bg-gray-700 text-gray-300";

        const scoreBorder = (s: number) =>
          s >= 70 ? "border-green-800" :
          s >= 45 ? "border-yellow-800/60" :
          "border-gray-800";

        return (
          <>
            {/* Header */}
            <div className="mb-4 space-y-1">
              <p className="text-xs text-gray-400">
                Players whose <span className="text-white font-medium">projected points rank</span> is better than their <span className="text-white font-medium">dynasty market rank</span> — they produce more than their price tag suggests. High gap + young age = high-conviction buy low.
              </p>
              {!projectionsLoaded && (
                <p className="text-[11px] text-amber-400">
                  Projections not loaded — using redraft consensus as the production proxy.
                  Load projections from the Projections tab for a more accurate read.
                </p>
              )}
            </div>

            {/* Position filter */}
            <div className="flex gap-2 mb-4">
              {(["ALL", "QB", "RB", "WR", "TE"] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => setBuyLowPos(pos)}
                  className={`px-3 py-1 rounded text-sm font-medium transition ${
                    buyLowPos === pos ? "bg-green-700 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>

            {/* Column headers */}
            <div className="flex items-center gap-3 px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
              <span className="w-6 text-right shrink-0">#</span>
              <span className="w-6 shrink-0">Pos</span>
              <span className="flex-1">Player</span>
              <span className="w-8 text-center shrink-0">Age</span>
              <span className="w-14 text-center shrink-0">Dyn Rank</span>
              <span className="w-14 text-center shrink-0">Proj Rank</span>
              <span className="w-10 text-center shrink-0">Gap</span>
              <span className="w-12 text-center shrink-0">Score</span>
            </div>

            {/* Rows */}
            <div className="space-y-1">
              {visible.length === 0 ? (
                <p className="text-sm text-gray-500 px-3 py-4">
                  {Object.keys(calcFcValues).length === 0
                    ? "Load a league to populate dynasty values."
                    : "No buy low candidates found for this filter."}
                </p>
              ) : (
                visible.map((r, idx) => (
                  <div
                    key={r.player_id}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${r.usingFallback ? "border-gray-800 opacity-40" : scoreBorder(r.score)} bg-gray-900/60`}
                  >
                    <span className="text-xs text-gray-600 font-mono w-6 text-right shrink-0">{idx + 1}</span>
                    <span className={`text-[10px] font-bold w-6 shrink-0 ${r.usingFallback ? "text-gray-600" : (POS_COLOR[r.pos] ?? "text-gray-400")}`}>
                      {r.pos}
                    </span>
                    <button
                      className={`flex-1 text-left text-sm truncate transition ${r.usingFallback ? "text-gray-500 cursor-default" : "text-white hover:text-blue-300"}`}
                      onClick={() => !r.usingFallback && setPlayerProfileId(r.player_id)}
                    >
                      {r.full_name}
                      {r.team && (
                        <span className="ml-1.5 text-[10px] text-gray-600 font-normal">{r.team}</span>
                      )}
                    </button>
                    <span className={`text-[10px] font-mono w-8 text-center shrink-0 ${r.usingFallback ? "text-gray-700" : ageColor(r.age, r.pos)}`}>
                      {r.age || "—"}
                    </span>
                    <span className="text-[11px] text-gray-600 font-mono w-14 text-center shrink-0">
                      #{r.dynRank}
                    </span>
                    {r.usingFallback ? (
                      <span className="text-[10px] text-gray-700 italic w-14 text-center shrink-0">no proj</span>
                    ) : (
                      <span className="text-[11px] text-gray-500 font-mono w-14 text-center shrink-0">
                        #{r.projRank}
                      </span>
                    )}
                    <span className="text-[11px] text-gray-700 w-10 text-center shrink-0">
                      {r.usingFallback ? "—" : `+${r.gap}`}
                    </span>
                    <span className={`text-[11px] font-bold w-12 text-center shrink-0 rounded px-1.5 py-0.5 ${r.usingFallback ? "bg-gray-800 text-gray-600" : scoreColor(r.score)}`}>
                      {r.usingFallback ? "—" : r.score}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Legend */}
            {visible.length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-800 flex flex-wrap gap-4 text-[10px] text-gray-500">
                <span><span className="font-bold text-green-400">Green score (70+)</span> — strong conviction buy low</span>
                <span><span className="font-bold text-yellow-400">Yellow (45–69)</span> — moderate opportunity</span>
                <span><span className="font-bold text-gray-400">Gray (&lt;45)</span> — slight dip, less actionable</span>
                <span><span className="text-amber-500">+Gap</span> — how many ranks better their production is vs. their dynasty price</span>
                <span><span className="text-gray-600">Dimmed rows</span> — no projection data yet (rookies/unsigned FAs); sorted to the bottom</span>
              </div>
            )}
          </>
        );
      })()}
    </>
  );
}

export default React.memo(DataHub);
