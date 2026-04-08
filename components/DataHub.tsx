"use client";
import React from "react";

// ── Module-level constants (mirrors page.tsx) ──────────────────────────────
const CURRENT_YEAR = String(new Date().getFullYear());

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

// ── Props ──────────────────────────────────────────────────────────────────
type DataHubTabId = "OWNERSHIP" | "DYNASTY" | "VALUE_TRENDS" | "REDRAFT" | "PROJECTIONS" | "PICK_VALUES" | "LEAGUEMATES";

interface DataHubProps {
  // Navigation
  dataHubTab: DataHubTabId;
  setDataHubTab: (tab: DataHubTabId) => void;

  // Ownership tab
  shareSearch: string;
  setShareSearch: (s: string) => void;
  sharePosition: string;
  setSharePosition: (pos: string) => void;
  shares: Record<string, any>;
  totalLeagues: number;
  players: any;

  // Dynasty/Redraft rankings
  calcFcValues: Record<string, number>;
  dynastyRankPos: string;
  setDynastyRankPos: (pos: string) => void;
  loadingCalcValues: boolean;
  playerDispositions: Record<string, { sell: string; buy: string }>;
  savePlayerDisposition: (playerId: string, sell: string, buy: string) => void;
  setPlayerProfileId: (id: string | null) => void;
  redraftValues: Record<string, number>;
  redraftRankPos: string;
  setRedraftRankPos: (pos: string) => void;
  loadingRedraft: boolean;

  // Projections tab
  projectionData: any[];
  setProjectionData: React.Dispatch<React.SetStateAction<any[]>>;
  projectionPosFilter: string;
  setProjectionPosFilter: (pos: string) => void;
  projectionWeek: number;
  setProjectionWeek: (week: number) => void;
  setProjectionLoaded: (loaded: boolean) => void;
  loadProjections: (week: number | "season") => void;
  projectionSeasonYear: number | null;
  projectionSourceStatus: Record<string, boolean>;
  loadingProjections: boolean;
  projectionUsesSeasonFallback: boolean;

  // Pick values tab
  allPicks: any[];
  selectedLeague: any;
  rosters: any[];
  users: any;
  selectedLeagueDynamicPickValues: Record<string, any>;

  // League mate stats tab
  leagues: any[];
  user: any;
  leagueMateStats: any[];
  setLeagueMateStats: (stats: any[]) => void;
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
  externalShares: any;
  loadingShares: boolean;

  // Value trends
  historicalSnapshot: { players: Record<string, any>; recorded_at: string } | null;
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
export default function DataHub({
  dataHubTab, setDataHubTab,
  shareSearch, setShareSearch, sharePosition, setSharePosition, shares, totalLeagues,
  players,
  calcFcValues, dynastyRankPos, setDynastyRankPos, loadingCalcValues,
  playerDispositions, savePlayerDisposition, setPlayerProfileId,
  redraftValues, redraftRankPos, setRedraftRankPos, loadingRedraft,
  projectionData, setProjectionData, projectionPosFilter, setProjectionPosFilter,
  projectionWeek, setProjectionWeek, setProjectionLoaded, loadProjections,
  projectionSeasonYear, projectionSourceStatus, loadingProjections, projectionUsesSeasonFallback,
  allPicks, selectedLeague, rosters, users, selectedLeagueDynamicPickValues,
  leagues, user,
  leagueMateStats, setLeagueMateStats, leagueMateStatsLoaded, setLeagueMateStatsLoaded,
  loadingLeagueMateStats, setLoadingLeagueMateStats,
  leagueMateSearch, setLeagueMateSearch, leagueMateSort, setLeagueMateSort,
  loadUserExposure, selectedUserId, externalShares, loadingShares,
  historicalSnapshot,
}: DataHubProps) {

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [rankView, setRankView] = React.useState<"DYNASTY" | "COMPARE">("DYNASTY");
  const [expandedMateId, setExpandedMateId] = React.useState<string | null>(null);
  const [trendThreshold, setTrendThreshold] = React.useState(10);
  const [trendPos, setTrendPos] = React.useState("ALL");

  // ── League Mate Stats loader (inline because it sets local state via props) ──
  const loadLeagueMateStats = async () => {
    if (!user || !leagues.length) return;
    setLoadingLeagueMateStats(true);
    try {
      const myLeagueData = await Promise.all(
        leagues.map(async (league: any) => {
          const [rostersRes, leagueUsersRes] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).then(r => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`).then(r => r.json()).catch(() => []),
          ]);
          return { league, rosters: rostersRes, leagueUsers: leagueUsersRes };
        })
      );

      const displayNameMap: Record<string, string> = {};
      const sharedLeaguesCount: Record<string, number> = {};
      const allOwnerIds = new Set<string>();

      myLeagueData.forEach(({ rosters: lr, leagueUsers }) => {
        (leagueUsers as any[]).forEach((u: any) => {
          if (u?.user_id && u?.display_name) displayNameMap[u.user_id] = u.display_name;
        });
        (lr as any[]).forEach((r: any) => {
          if (!r.owner_id || r.owner_id === user.user_id) return;
          allOwnerIds.add(r.owner_id);
          sharedLeaguesCount[r.owner_id] = (sharedLeaguesCount[r.owner_id] || 0) + 1;
        });
      });

      const ownerStats = await Promise.all([...allOwnerIds].map(async (ownerId) => {
        const theirLeagues: any[] = await fetch(`https://api.sleeper.app/v1/user/${ownerId}/leagues/nfl/${CURRENT_YEAR}`)
          .then(r => r.json())
          .then(d => Array.isArray(d) ? d : [])
          .catch(() => []);

        return {
          userId: ownerId,
          displayName: displayNameMap[ownerId] || users[ownerId] || ownerId,
          totalLeagues: theirLeagues.filter((l: any) => (l.settings?.best_ball ?? 0) === 0).length,
          bestBallLeagues: theirLeagues.filter((l: any) => (l.settings?.best_ball ?? 0) !== 0).length,
          sharedLeagues: sharedLeaguesCount[ownerId] || 0,
        };
      }));

      setLeagueMateStats(ownerStats);
      setLeagueMateStatsLoaded(true);
    } finally {
      setLoadingLeagueMateStats(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Sub-tab nav */}
      <div className="flex justify-center border-b border-gray-800 mb-6 overflow-x-auto">
        <div className="flex justify-center gap-6 text-center">
          {(["OWNERSHIP", "DYNASTY", "VALUE_TRENDS", "REDRAFT", "PROJECTIONS", "PICK_VALUES", "LEAGUEMATES"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setDataHubTab(tab)}
              className={`pb-2 px-1 text-sm font-semibold transition ${
                dataHubTab === tab
                  ? "border-b-2 border-blue-400 text-blue-400"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {tab === "OWNERSHIP" ? "Player Ownership" :
               tab === "DYNASTY" ? "Dynasty Rankings" :
               tab === "VALUE_TRENDS" ? "Value Trends" :
               tab === "REDRAFT" ? "Redraft Rankings" :
               tab === "PROJECTIONS" ? "Player Projections" :
               tab === "PICK_VALUES" ? "Pick Values" :
               "League Mate Stats"}
            </button>
          ))}
        </div>
      </div>

      {/* ── PLAYER OWNERSHIP ── */}
      {dataHubTab === "OWNERSHIP" && (
        <>
          <input
            className="w-full p-2 mb-4 rounded bg-gray-800"
            placeholder="Search player shares..."
            value={shareSearch}
            onChange={(e) => setShareSearch(e.target.value)}
          />
          <div className="flex gap-2 mb-4">
            {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
              <button
                key={pos}
                onClick={() => setSharePosition(pos)}
                className={`px-3 py-1 rounded ${sharePosition === pos ? "bg-blue-600" : "bg-gray-800"}`}
              >
                {pos}
              </button>
            ))}
          </div>
          {Object.entries(shares)
            .filter(([playerId]) => {
              const p = players[playerId];
              if (!p) return false;
              const matchesSearch = p.full_name?.toLowerCase().includes(shareSearch.toLowerCase());
              const matchesPosition = sharePosition === "ALL" || p.position === sharePosition;
              return matchesSearch && matchesPosition;
            })
            .sort((a: any, b: any) => b[1].count - a[1].count)
            .map(([playerId, data]: any) => {
              const p = players[playerId];
              if (!p) return null;
              return (
                <div key={playerId} className="bg-gray-800 p-3 rounded mb-3">
                  <div className="font-medium">
                    {p.full_name} ({data.count} shares •{" "}
                    {Math.round((data.count / totalLeagues) * 100)}%)
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    Owned or
                    <span className="ml-2 text-green-400">(Starting)</span>
                    {[...data.leagues]
                      .sort((a: string, b: string) => {
                        const aStarter = data.starters.includes(a);
                        const bStarter = data.starters.includes(b);
                        if (aStarter && !bStarter) return -1;
                        if (!aStarter && bStarter) return 1;
                        return 0;
                      })
                      .map((l: string, i: number) => {
                        const isStarter = data.starters.includes(l);
                        return (
                          <div key={i} className={isStarter ? "text-green-400 font-medium" : ""}>
                            • {l} {isStarter && "🔥"}
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })}
        </>
      )}

      {/* ── DYNASTY RANKINGS ── */}
      {dataHubTab === "DYNASTY" && (() => {
        const fcVal = (id: string) => calcFcValues[id] ?? (players as any)[id]?.value ?? 0;
        const redVal = (id: string) => redraftValues[id] ?? 0;
        const ranked = Object.values(players as Record<string, any>)
          .filter((p: any) => ["QB", "RB", "WR", "TE"].includes(p.position) && fcVal(p.player_id) > 0)
          .filter((p: any) => dynastyRankPos === "ALL" || p.position === dynastyRankPos)
          .sort((a: any, b: any) => fcVal(b.player_id) - fcVal(a.player_id));

        return (
          <>
            {loadingCalcValues && <p className="text-sm text-blue-400 mb-4">Loading values…</p>}
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
                {(["DYNASTY", "COMPARE"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setRankView(v)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition ${rankView === v ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
                  >
                    {v === "DYNASTY" ? "Dynasty" : "Compare ↔ Redraft"}
                  </button>
                ))}
              </div>
            </div>
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
            <div className="space-y-0.5">
              {ranked.map((p: any, idx: number) => {
                const disp = playerDispositions[p.player_id] ?? { sell: "Neutral", buy: "Neutral" };
                const dyn = fcVal(p.player_id);
                const red = redVal(p.player_id);
                const gap = dyn - red;
                return (
                  <div key={p.player_id} className="flex items-center gap-2 bg-gray-800/70 hover:bg-gray-800 rounded-lg px-2 py-1.5 transition">
                    <span className="text-[10px] text-gray-600 w-5 text-right shrink-0">{idx + 1}</span>
                    <span className={`text-[10px] font-bold w-6 shrink-0 ${POS_COLOR[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                    <span className="text-xs text-white flex-1 truncate min-w-0 flex items-center gap-1">
                      {p.full_name}{injuryBadge(p.injury_status)}
                    </span>
                    <span className={`text-[10px] font-mono w-7 text-center shrink-0 ${ageColor(p.age, p.position)}`}>{p.age || "—"}</span>
                    {rankView === "COMPARE" ? (
                      <>
                        <span className="text-[10px] text-gray-300 font-mono w-14 text-right shrink-0">{dyn.toLocaleString()}</span>
                        <span className="text-[10px] text-gray-500 font-mono w-14 text-right shrink-0">{red > 0 ? red.toLocaleString() : "—"}</span>
                        <span className={`text-[10px] font-mono w-12 text-right shrink-0 ${gap > 800 ? "text-green-400" : gap < -200 ? "text-red-400" : "text-gray-500"}`}>
                          {red > 0 ? `${gap > 0 ? "+" : ""}${gap.toLocaleString()}` : "—"}
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] text-gray-400 font-mono w-14 text-right shrink-0">{dyn.toLocaleString()}</span>
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
              {ranked.length === 0 && !loadingCalcValues && (
                <p className="text-gray-400 text-sm">No data yet. Select a league to load values.</p>
              )}
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

        type TrendRow = {
          playerId: string;
          full_name: string;
          position: string;
          age?: number;
          injury_status?: string;
          team?: string;
          currentVal: number;
          snapVal: number;
          delta: number;
          pct: number;
          owned: number;
        };

        const allTrends: TrendRow[] = [];
        Object.entries(snap.players).forEach(([playerId, snapData]: [string, any]) => {
          const currentVal = calcFcValues[playerId] ?? 0;
          const snapVal = Number(snapData.value ?? 0);
          if (snapVal <= 0 || currentVal <= 0) return;
          const delta = currentVal - snapVal;
          const pct = (delta / snapVal) * 100;
          const p = (players as Record<string, any>)[playerId];
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
            owned: (shares as Record<string, any>)[playerId]?.count ?? 0,
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
            <span className={`text-[10px] font-mono w-7 text-center shrink-0 ${ageColor(row.age, row.position)}`}>{row.age || "—"}</span>
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
        Object.entries(snap.players).forEach(([pid, snapData]: [string, any]) => {
          const cv = calcFcValues[pid] ?? 0;
          const sv = Number(snapData.value ?? 0);
          if (sv > 0 && cv > 0) trendMap.set(pid, ((cv - sv) / sv) * 100);
        });

        const myRoster = (rosters as any[]).find((r: any) => r.owner_id === user?.user_id);
        const myPlayerSet = new Set<string>(myRoster?.players ?? []);
        const partnerRosters = (rosters as any[]).filter(
          (r: any) => r.owner_id && r.owner_id !== user?.user_id
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
                const myP = (players as any)[mine.id];
                const theirP = (players as any)[theirs.id];
                if (!myP || !theirP) continue;
                usedGiveA.add(mine.id);
                usedRecvA.add(theirs.id);
                sellWindowTrades.push({
                  type: "sell-window",
                  giveId: mine.id, receiveId: theirs.id,
                  giveVal: mine.val, receiveVal: theirs.val,
                  givePct: mine.pct, receivePct: theirs.pct,
                  partnerName: (users as any)[partnerRoster.owner_id] || `Team ${partnerRoster.roster_id}`,
                  givePos: myP.position, receivePos: theirP.position,
                  giveAge: myP.age, receiveAge: theirP.age,
                  giveTeam: myP.team, receiveTeam: theirP.team,
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
              const myP = (players as any)[giveCand.id];
              const theirP = (players as any)[theirs.id];
              if (!myP || !theirP) continue;
              usedGiveB.add(giveCand.id);
              usedRecvB.add(theirs.id);
              buyWindowTrades.push({
                type: "buy-window",
                giveId: giveCand.id, receiveId: theirs.id,
                giveVal: giveCand.val, receiveVal: theirs.val,
                givePct: giveCand.pct, receivePct: theirs.pct,
                partnerName: (users as any)[partnerRoster.owner_id] || `Team ${partnerRoster.roster_id}`,
                givePos: myP.position, receivePos: theirP.position,
                giveAge: myP.age, receiveAge: theirP.age,
                giveTeam: myP.team, receiveTeam: theirP.team,
              });
            }
          }
        }

        const TradeSuggCard = ({ t }: { t: TradeSugg }) => {
          const isSell = t.type === "sell-window";
          const giveP = (players as any)[t.giveId];
          const receiveP = (players as any)[t.receiveId];
          const lastName = (full: string | undefined) => full?.split(" ").slice(1).join(" ") || full || "";
          return (
            <div className={`rounded-2xl border px-4 py-3 transition ${isSell ? "bg-red-950/10 border-red-900/30 hover:bg-red-950/20" : "bg-green-950/10 border-green-900/30 hover:bg-green-950/20"}`}>
              <div className="flex items-center gap-2 mb-2.5">
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md ${isSell ? "bg-red-900/50 text-red-300" : "bg-green-900/50 text-green-300"}`}>
                  {isSell ? "📉 Sell Window Trade" : "📈 Buy Window Trade"}
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
                    <span className="text-[11px] font-bold text-green-400">+{t.receivePct.toFixed(1)}%</span>
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
            <div className="flex items-center gap-2 mb-5 rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-2.5">
              <span className="text-[11px] text-gray-500">Comparing current values against snapshot from</span>
              <span className="text-[11px] font-semibold text-gray-300">{ageLabel}</span>
              <span className="text-[11px] text-gray-600">({snapshotDate.toLocaleDateString()})</span>
              <span className="ml-auto text-[10px] text-gray-600">{Object.keys(snap.players).length} players tracked</span>
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
                    <span className="text-[11px] text-gray-500">Give your −5%+ fallers · receive partners&apos; +20%+ risers</span>
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
                    <span className="text-[11px] text-gray-500">Give your +20%+ peaked assets · receive partners&apos; +5%+ early risers</span>
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

      {/* ── REDRAFT RANKINGS ── */}
      {dataHubTab === "REDRAFT" && (() => {
        const ranked = Object.values(players as Record<string, any>)
          .filter((p: any) => ["QB", "RB", "WR", "TE"].includes(p.position) && (redraftValues[p.player_id] ?? 0) > 0)
          .filter((p: any) => redraftRankPos === "ALL" || p.position === redraftRankPos)
          .sort((a: any, b: any) => (redraftValues[b.player_id] ?? 0) - (redraftValues[a.player_id] ?? 0));

        return (
          <>
            {loadingRedraft && <p className="text-sm text-blue-400 mb-4">Loading values…</p>}
            <div className="flex gap-2 mb-3">
              {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
                <button
                  key={pos}
                  onClick={() => setRedraftRankPos(pos)}
                  className={`px-3 py-1 rounded text-sm font-medium transition ${redraftRankPos === pos ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
                >
                  {pos}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 px-2 mb-1">
              <span className="w-5 shrink-0" />
              <span className="w-6 shrink-0" />
              <span className="flex-1 text-[10px] text-gray-600 uppercase tracking-wider">Player</span>
              <span className="w-7 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Age</span>
              <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Value</span>
              <span className="w-20 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Sell</span>
              <span className="w-20 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Buy</span>
              <span className="w-4 shrink-0" />
            </div>
            <div className="space-y-0.5">
              {ranked.map((p: any, idx: number) => {
                const disp = playerDispositions[p.player_id] ?? { sell: "Neutral", buy: "Neutral" };
                return (
                  <div key={p.player_id} className="flex items-center gap-2 bg-gray-800/70 hover:bg-gray-800 rounded-lg px-2 py-1.5 transition">
                    <span className="text-[10px] text-gray-600 w-5 text-right shrink-0">{idx + 1}</span>
                    <span className={`text-[10px] font-bold w-6 shrink-0 ${POS_COLOR[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                    <span className="text-xs text-white flex-1 truncate min-w-0 flex items-center gap-1">
                      {p.full_name}{injuryBadge(p.injury_status)}
                    </span>
                    <span className={`text-[10px] font-mono w-7 text-center shrink-0 ${ageColor(p.age, p.position)}`}>{p.age || "—"}</span>
                    <span className="text-[10px] text-gray-400 font-mono w-14 text-right shrink-0">{(redraftValues[p.player_id] ?? 0).toLocaleString()}</span>
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
              {ranked.length === 0 && !loadingRedraft && (
                <p className="text-gray-400 text-sm">No redraft data available.</p>
              )}
            </div>
          </>
        );
      })()}

      {/* ── PLAYER PROJECTIONS ── */}
      {dataHubTab === "PROJECTIONS" && (() => {
        const visible = projectionData.filter(
          (p) => projectionPosFilter === "ALL" || p.position === projectionPosFilter
        );

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
                    loadProjections(w === 0 ? "season" : w);
                  }}
                  className="bg-gray-800 border border-gray-700 text-sm text-white rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500"
                >
                  <option value={0}>Full Season</option>
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
                onClick={() => {
                  setProjectionLoaded(false);
                  setProjectionData([]);
                  loadProjections(projectionWeek === 0 ? "season" : projectionWeek);
                }}
                className="ml-auto text-xs font-semibold text-blue-400 hover:text-blue-300 border border-blue-700 hover:border-blue-500 rounded-lg px-3 py-1.5 transition"
              >
                Refresh
              </button>
            </div>

            {/* Source status pills */}
            <div className="flex gap-2 mb-4 flex-wrap">
              {PROJ_SOURCES.map((src) => {
                const ok = projectionSourceStatus[src.id];
                const pct = Math.round(src.weight * 100);
                return (
                  <span
                    key={src.id}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ok === undefined ? "bg-gray-800 text-gray-500" : ok ? "bg-green-900 text-green-300" : "bg-red-900 text-red-400"}`}
                  >
                    {src.label} {ok !== undefined && `(${pct}%)`}{ok === false && " ✕"}
                  </span>
                );
              })}
              {loadingProjections && <span className="text-[10px] text-blue-400">Loading…</span>}
            </div>

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
                  <span className="w-10 text-right shrink-0 pr-1">Srcs</span>
                </div>
                <div className="space-y-1">
                  {visible.map((p, idx) => (
                    <div key={p.sleeperId} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2">
                      <span className="text-xs text-gray-500 w-6 text-right shrink-0">{idx + 1}</span>
                      <span className={`text-[10px] font-bold w-7 shrink-0 ${POS_COLOR[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                      <span className="text-sm text-white flex-1 truncate">{p.full_name}</span>
                      {p.team && <span className="text-[10px] text-gray-500 shrink-0">{p.team}</span>}
                      <span className="text-xs text-gray-300 font-mono w-10 text-right shrink-0">{p.fpts.toFixed(1)}</span>
                      <span className="text-[10px] text-gray-600 w-10 text-right shrink-0 pr-1">
                        {p.sources.length}/{PROJ_SOURCES.length}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        );
      })()}

      {/* ── PICK VALUES ── */}
      {dataHubTab === "PICK_VALUES" && (() => {
        if (!selectedLeague || !rosters.length) {
          return <p className="text-sm text-gray-500">Select a league first so pick value ranges can be tied to projected finish.</p>;
        }

        const pickRows = (allPicks as any[])
          .map((pick: any) => {
            const key = `${pick.season}-${pick.round}-${pick.roster_id}`;
            const dynamic = selectedLeagueDynamicPickValues[key];
            const ownerName = users[pick.owner_id] || `Team ${pick.owner_id}`;
            const issuerName = users[pick.roster_id] || `Team ${pick.roster_id}`;
            const pickLabel = pick.slot && String(pick.slot).includes(".")
              ? `${pick.season} ${pick.slot}`
              : `${pick.season} Rd ${pick.round}`;
            return { ...pick, key, ownerName, issuerName, pickLabel, dynamic };
          })
          .sort((a: any, b: any) => (b.dynamic?.expectedValue ?? 0) - (a.dynamic?.expectedValue ?? 0));

        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Dynamic Pick Valuation</div>
              <div className="mt-1 text-sm text-gray-200">
                Each pick now uses simulated finish distributions, expected slot outcomes, and team-specific playoff odds instead of one flat round value.
              </div>
            </div>

            <div className="space-y-2">
              {pickRows.map((pick: any) => {
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
                            ? dynamic.likelySlots.map((slotRow: any) => `${slotRow.slot} (${Math.round((slotRow.probability || 0) * 100)}%)`).join(" | ")
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
                          const ownerExposure = isExpanded ? (externalShares ?? {}) : null;
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
                                    ) : ownerExposure?.players?.length > 0 ? (
                                      <div>
                                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                                          Top Owned Players · {ownerExposure.leagueCount} league{ownerExposure.leagueCount !== 1 ? "s" : ""}
                                        </p>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                                          {(ownerExposure.players as Array<{ playerId: string; count: number; percent: number }>).map((entry) => {
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
    </>
  );
}
