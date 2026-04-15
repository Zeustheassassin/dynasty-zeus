"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
// Small hubs — loaded synchronously (minimal bundle cost)
import Dashboard from "../components/Dashboard";
import AlertsPage from "../components/AlertsPage";
import ManagementHub from "../components/ManagementHub";
import GamedayHub from "../components/GamedayHub";
import ErrorBoundary from "../components/ErrorBoundary";
// ── Hub loading skeleton ───────────────────────────────────────────────────
// Shown while the code-split chunk downloads. Keeps the layout stable and
// avoids the blank-flash that would otherwise appear on first navigation.
function HubSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4 animate-pulse">
      <div className="h-16 rounded-2xl bg-gray-800/60" />
      <div className="h-10 rounded-xl bg-gray-800/40 w-1/3" />
      <div className="h-64 rounded-2xl bg-gray-800/30" />
    </div>
  );
}

// Large hubs — code-split so they only load when the user navigates to them
const DraftHub = dynamic(() => import("../components/DraftHub"), { ssr: false, loading: HubSkeleton });
const DataHub = dynamic(() => import("../components/DataHub"), { ssr: false, loading: HubSkeleton });
const LeagueHub = dynamic(() => import("../components/LeagueHub"), { ssr: false, loading: HubSkeleton });
const TradeHub = dynamic(() => import("../components/TradeHub"), { ssr: false, loading: HubSkeleton });
import { LEAGUE_HUB_GROUPS } from "../lib/leagueHubGroups";
import { supabase } from "../lib/supabaseclient";
import type { User as SupabaseUser } from "@supabase/auth-js";
import {
  CURRENT_YEAR, YEARS, ROUNDS,
  getStoredPickValue, getDraftRoundSlot,
  getBucketColor, getAdjustedDirectionBucket,
  average, sum, logisticWinProb,
  createSeededRandom, randomNormal, buildRoundRobinSchedule,
  percentileFromCounts,
  getProjectionKickoffAt, getKickoffState,
  formatKickoffTime,
  getRosterDirectionProfile, getProfilePosBuckets,
  getLeagueMateMotivation, getTradePartnerFitLabel, getTradePartnerFit,
  getCrossLeaguePreferenceFit, getCrossLeagueTradeBehaviorFit,
  fetchFantasyCalcValues, formatRelativeDate,
} from "../lib/helpers";
import { useProjections } from "../hooks/useProjections";
import { useSleeperUser } from "../hooks/useSleeperUser";
import { usePlayerStats } from "../hooks/usePlayerStats";
import { useManagementState } from "../hooks/useManagementState";
import { useRookieBoardState, ROOKIE_YEAR, ROOKIE_BOARD_VERSION, ROOKIE_BOARD_RESET_KEY } from "../hooks/useRookieBoardState";
import { useAlerts } from "../hooks/useAlerts";
import { useUserExposure } from "../hooks/useUserExposure";
import { useUserTrades } from "../hooks/useUserTrades";
import { useCrossLeagueMateIntel } from "../hooks/useCrossLeagueMateIntel";
import { PlayersProvider } from "../lib/PlayersContext";
import { AuthProvider } from "../lib/AuthContext";
import { LeagueProvider } from "../lib/LeagueContext";
import { RosterProvider } from "../lib/RosterContext";
import { fetchSleeperUser } from "../lib/sleeperUserCache";
import type {
  LeagueHubTab, AlertsCenterItem, TradeAttempt, TradeAttemptStatus,
  SleeperPlayer, SleeperLeague, SleeperRoster, SleeperTradedPick,
  SleeperDraft, SleeperDraftPick, SleeperNFLState, SleeperTransaction, GamedayMatchup, GamedayTeamView,
  CommittedSimsByLeague, CachedSimRow, SleeperMatchup,
  AugmentedPick, LeagueOverviewEntry, LeagueMateStatEntry,
  HistoricalSnapshot, LeagueMateView, LeagueSimulation, SimulationTeamRow,
  RosterDirectionProfile,
} from "../lib/types";

// -------------------------
// MODULE-LEVEL CONSTANTS (page-specific)
// -------------------------
// ROOKIE_YEAR, ROOKIE_BOARD_VERSION, ROOKIE_BOARD_RESET_KEY imported from useRookieBoardState

// Module-level in-memory player map cache — avoids re-fetching/re-parsing the 6MB Sleeper player
// payload if loadPlayers is called more than once in the same browser session (e.g. strict-mode
// double-invoke in dev, or a Sleeper reconnect event).
let _playersInMemory: Record<string, SleeperPlayer> | null = null;

// fetchSleeperUser imported from lib/sleeperUserCache (shared with useLeagues)

// ── Page-local interfaces (shapes that don't warrant a lib/types entry) ──────
interface Note { id: string; user_id: string; title: string; body: string; updated_at: string; }
interface StandingRow { roster_id: number; wins: number; losses: number; ties: number; fpts: number; max_pf: number; owner_id: string; }
interface DraftScoutPick { round: number; player: SleeperPlayer | null; playerName: string | null; position: string | null; }
interface DraftScoutLeague { leagueName: string; picks: DraftScoutPick[]; }
// AugmentedPick is now exported from lib/types.ts
type AnnotatedTransaction = SleeperTransaction & { leagueName: string; leagueId: string; rosterOwnerMap: Record<number, string>; };
interface TradeIntelEntry { tradeCount30d: number; bought: Record<string, number>; picksIn: number; picksOut: number; lastTradeAt: string | null; }

// Static — never changes, defined at module level so it's a stable reference in useMemo dep arrays
const ROLE_PRIORITY: Record<string, number> = { starter: 0, bench: 1, taxi: 2 };
const LAST_LOGIN_EMAIL_KEY = "lastLoginEmail";

export default function Home() {

  // -------------------------
  // CORE STATE
  // -------------------------
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [, setNotes] = useState<Note[]>([]);
  const [supabaseError, setSupabaseError] = useState("");
  const [supabaseMessage, setSupabaseMessage] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState<SleeperLeague | null>(null);
  const [roster, setRoster] = useState<SleeperRoster | null>(null);
  const [rosters, setRosters] = useState<SleeperRoster[]>([]);
  const [players, setPlayers] = useState<Record<string, SleeperPlayer>>({});
  const [activeTab, setActiveTab] = useState("QB");
  const [search, setSearch] = useState("");
  const [leagueSearch, setLeagueSearch] = useState("");

  const [picks, setPicks] = useState<AugmentedPick[]>([]);
  const [allPicks, setAllPicks] = useState<AugmentedPick[]>([]);
  const [, setDraftId] = useState<string | null>(null);
const [draftPicks, setDraftPicks] = useState<SleeperDraftPick[]>([]);
const [draftOrder, setDraftOrder] = useState<Record<string, number>>({});
const [draftSettings, setDraftSettings] = useState<SleeperDraft | null>(null);
const [draftScoutUserId, setDraftScoutUserId] = useState<string | null>(null);
const [draftScoutData, setDraftScoutData] = useState<DraftScoutLeague[] | null>(null);
const [loadingDraftScout, setLoadingDraftScout] = useState(false);
const draftScoutPatterns = useMemo(() => {
  if (!draftScoutData?.length) return null;
  const leaguesWithPicks = draftScoutData.filter((l) => l.picks.length > 0);
  if (!leaguesWithPicks.length) return null;

  const allPicksFlat = leaguesWithPicks.flatMap((l) => l.picks);
  const total = allPicksFlat.length;
  const n = leaguesWithPicks.length;

  const posCounts: Record<string, number> = {};
  allPicksFlat.forEach((p) => {
    const pos = p.position || "?";
    posCounts[pos] = (posCounts[pos] || 0) + 1;
  });
  const sortedPos = Object.entries(posCounts).sort((a, b) => b[1] - a[1]);

  const roundBreakdown: Record<number, Record<string, number>> = {};
  allPicksFlat.forEach((p) => {
    if (!roundBreakdown[p.round]) roundBreakdown[p.round] = {};
    const pos = p.position || "?";
    roundBreakdown[p.round][pos] = (roundBreakdown[p.round][pos] || 0) + 1;
  });

  const firstPicks = leaguesWithPicks.map((l) => l.picks[0]).filter(Boolean);
  const firstPickPos: Record<string, number> = {};
  firstPicks.forEach((p) => {
    const pos = p.position || "?";
    firstPickPos[pos] = (firstPickPos[pos] || 0) + 1;
  });
  const topFirstPos = Object.entries(firstPickPos).sort((a, b) => b[1] - a[1])[0];

  const tendencies: string[] = [];

  if (topFirstPos && firstPicks.length >= 2) {
    tendencies.push(`Opens with ${topFirstPos[0]} in ${topFirstPos[1]}/${firstPicks.length} leagues`);
  }
  if (sortedPos[0] && sortedPos[0][1] / total >= 0.4) {
    tendencies.push(`${sortedPos[0][0]}-heavy drafter — ${Math.round(sortedPos[0][1] / total * 100)}% of all picks`);
  }
  const r1 = roundBreakdown[1];
  if (r1) {
    const r1Total = Object.values(r1).reduce((s: number, v: number) => s + v, 0);
    const r1Top = Object.entries(r1).sort((a, b) => b[1] - a[1])[0];
    if (r1Top && r1Top[1] >= 2) {
      tendencies.push(`Favors ${r1Top[0]} in Round 1 (${r1Top[1]}/${r1Total})`);
    }
  }
  const r1QB = roundBreakdown[1]?.QB || 0;
  const r2QB = roundBreakdown[2]?.QB || 0;
  if (r1QB > 0) tendencies.push(`QB in Round 1 (${r1QB} league${r1QB > 1 ? "s" : ""})`);
  else if (r2QB > 0) tendencies.push(`Early QB — Round 2 (${r2QB} league${r2QB > 1 ? "s" : ""})`);
  const r1TE = roundBreakdown[1]?.TE || 0;
  const r2TE = roundBreakdown[2]?.TE || 0;
  const r3TE = roundBreakdown[3]?.TE || 0;
  if (r1TE > 0) tendencies.push(`TE aggressive — Round 1 (${r1TE} league${r1TE > 1 ? "s" : ""})`);
  else if (r2TE > 0) tendencies.push(`TE in Round 2 (${r2TE} league${r2TE > 1 ? "s" : ""})`);
  else if (!r3TE && posCounts.TE) tendencies.push(`TE devaluer — waits until Round 4+`);

  return { sortedPos, roundBreakdown, tendencies, total, n };
}, [draftScoutData]);
const [loadingDraftRefresh, setLoadingDraftRefresh] = useState(false);
const [selectedLeagueDraftHasOccurred, setSelectedLeagueDraftHasOccurred] = useState(false);
const {
  tradeHubUserId, setTradeHubUserId,
  tradeHubData, setTradeHubData,
  loadingTradeHub,
  loadUserTrades,
} = useUserTrades();
const [tradeAttempts, setTradeAttempts] = useState<TradeAttempt[]>([]);
const [tradeAttemptsLeagueId, setTradeAttemptsLeagueId] = useState<string | null>(null);
const [loadingTradeAttempts, setLoadingTradeAttempts] = useState(false);
const [allTradeAttempts, setAllTradeAttempts] = useState<TradeAttempt[]>([]);
const [tradeHubSection, setTradeHubSection] = useState<"CALCULATOR" | "FINDER" | "RECOMMENDATIONS" | "TRADE_LOG" | "ATTEMPTS">("CALCULATOR");
const [finderSeed, setFinderSeed] = useState(() => Math.random());
const [leagueHubTab, setLeagueHubTab] = useState<LeagueHubTab>("OVERVIEW");
const [leagueOverviewData, setLeagueOverviewData] = useState<Record<string, LeagueOverviewEntry>>({});
const [loadingLeagueOverview, setLoadingLeagueOverview] = useState(false);
const [leagueOverviewLoaded, setLeagueOverviewLoaded] = useState(false);
const [leagueSimCache, setLeagueSimCache] = useState<Record<string, Record<number, CachedSimRow>>>({});
const [readyLeagueId, setReadyLeagueId] = useState<string | null>(null);
const [simQueue, setSimQueue] = useState<string[]>([]);
const [simProgress, setSimProgress] = useState<{ done: number; total: number } | null>(null);
// Random salt included in the sim seed so each Run All Sims call produces slightly different results.
const [simSalt, setSimSalt] = useState<number>(() => Math.floor(Math.random() * 1_000_000));
// Frozen sim rows committed at button-click time — keyed league_id → rosterId → sim row.
// Persisted in localStorage so values survive page reloads without re-running sims.
const [committedSimsByLeague, setCommittedSimsByLeague] = useState<CommittedSimsByLeague>(() => {
  try { return JSON.parse(localStorage.getItem("committedSimRows_v2") || "{}"); } catch { return {}; }
});
const [myDraftSlotPicks, setMyDraftSlotPicks] = useState<Record<string, string>>({}); // slot → player_id override
const [draftSlotEditing, setDraftSlotEditing] = useState<string | null>(null); // slot currently open for edit
const [draftSlotSearchQuery, setDraftSlotSearchQuery] = useState("");
// userId → { QB: 0.15, RB: 0.30, WR: 0.45, TE: 0.10 } — historical pick tendencies per owner
const [ownerDraftTendencies, setOwnerDraftTendencies] = useState<Record<string, Record<string, number>>>({});
const [leagueMateTradeIntel, setLeagueMateTradeIntel] = useState<Record<string, TradeIntelEntry>>({});
const [loadingLeagueMateIntel, setLoadingLeagueMateIntel] = useState(false);
const [leagueMateProfileCache, setLeagueMateProfileCache] = useState<Record<string, LeagueMateView[]>>({});
const [leagueNotes, setLeagueNotes] = useState<Record<string, string>>({});
const [nflState, setNflState] = useState<SleeperNFLState | null>(null);
const [gamedayMatchups, setGamedayMatchups] = useState<SleeperMatchup[]>([]);
const [loadingGamedayMatchups, setLoadingGamedayMatchups] = useState(false);
const [selectedGamedayMatchupId, setSelectedGamedayMatchupId] = useState<number | null>(null);
const [playerProfileId, setPlayerProfileId] = useState<string | null>(null);
const [playerNotes, setPlayerNotes] = useState<Record<string, string>>(() => {
  try { return JSON.parse(localStorage.getItem("playerNotes_v1") || "{}"); } catch { return {}; }
});
const [playerDispositions, setPlayerDispositions] = useState<Record<string, { sell: string; buy: string }>>(() => {
  try { return JSON.parse(localStorage.getItem("playerDispositions_v1") || "{}"); } catch { return {}; }
});
// Per-league player tags: CORE = Do Not Sell, WANT_TO_TRADE = actively shopping
// Shape: Record<leagueId, Record<playerId, "CORE" | "WANT_TO_TRADE">>
const [leaguePlayerTags, setLeaguePlayerTags] = useState<Record<string, Record<string, "CORE" | "WANT_TO_TRADE">>>(() => {
  try { return JSON.parse(localStorage.getItem("leaguePlayerTags_v1") || "{}"); } catch { return {}; }
});
const [activityTransactions, setActivityTransactions] = useState<AnnotatedTransaction[]>([]);
const [loadingActivity, setLoadingActivity] = useState(false);
const [leagueWeeklyMatchups, setLeagueWeeklyMatchups] = useState<Record<string, { week: number; matchups: SleeperMatchup[] }[]>>({});
const [loadingLeagueWeeklyMatchups, setLoadingLeagueWeeklyMatchups] = useState(false);
const [dataHubTab, setDataHubTab] = useState<"RANKINGS" | "VALUE_TRENDS" | "PROJECTIONS" | "PICK_VALUES" | "LEAGUEMATES" | "DEPTH_CHARTS" | "BUY_LOW">("RANKINGS");
const [leagueMateStats, setLeagueMateStats] = useState<LeagueMateStatEntry[]>([]);
const [leagueMateStatsLoaded, setLeagueMateStatsLoaded] = useState(false);
const [loadingLeagueMateStats, setLoadingLeagueMateStats] = useState(false);
const [leagueMateSort, setLeagueMateSort] = useState<"name" | "total" | "bestball" | "shared">("total");
const [leagueMateSearch, setLeagueMateSearch] = useState("");
const [dynastyRankPos, setDynastyRankPos] = useState("ALL");
const [redraftValues, setRedraftValues] = useState<Record<string, number>>({});
const [loadingRedraft, setLoadingRedraft] = useState(false);
const [redraftLoaded, setRedraftLoaded] = useState(false);
const {
  projectionData, setProjectionData,
  loadingProjections,
  projectionWeek, setProjectionWeek,
  projectionSeasonYear,
  projectionPosFilter, setProjectionPosFilter,
  projectionSourceStatus,
  projectionLoaded, setProjectionLoaded,
  projectionUsesSeasonFallback,
  loadProjections,
} = useProjections(players);

// Rolling snap% / target / carry stats from the last 4 weeks of Sleeper actuals.
// Returns null during the off-season — TradeHub degrades gracefully when null.
const nflStatsSeason = nflState?.season_type === "regular" ? (nflState?.season ?? null) : null;
const nflStatsWeek   = nflState?.season_type === "regular" ? (nflState?.display_week ?? nflState?.week ?? null) : null;
const { playerStats } = usePlayerStats(nflStatsSeason, nflStatsWeek);

const [finderPinnedPlayerId, setFinderPinnedPlayerId] = useState<string | null>(null);
const [finderTargetOppRosterId, setFinderTargetOppRosterId] = useState<number | null>(null);
const [finderTargetPlayerId, setFinderTargetPlayerId] = useState<string | null>(null);

const [draftHubSection, setDraftHubSection] = useState<"BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES">("BOARD");
const [prSortKey, setPrSortKey] = useState<"dynTotal"|"redTotal"|"qbTotal"|"rbTotal"|"wrTotal"|"teTotal">("dynTotal");
const [prSortAsc, setPrSortAsc] = useState(false);
const [prPopup, setPrPopup] = useState<{ rosterId: number; col: "dyn"|"red"|"QB"|"RB"|"WR"|"TE" } | null>(null);
const [prMode, setPrMode] = useState<"full"|"starters"|"bench">("full");
const [ignoredOwnerIds, setIgnoredOwnerIds] = useState<string[]>(() => {
  try { return JSON.parse(localStorage.getItem("ignoredOwnerIds") || "[]"); } catch { return []; }
});
const toggleIgnoredOwner = (ownerId: string) => {
  setIgnoredOwnerIds(prev => {
    const next = prev.includes(ownerId) ? prev.filter(id => id !== ownerId) : [...prev, ownerId];
    localStorage.setItem("ignoredOwnerIds", JSON.stringify(next));
    return next;
  });
};
const [pickFcValues, setPickFcValues] = useState<Record<string, number>>({});
const [calcFcValues, setCalcFcValues] = useState<Record<string, number>>({});
const [loadingCalcValues, setLoadingCalcValues] = useState(false);
const [calcValuesLeagueId, setCalcValuesLeagueId] = useState<string | null>(null);
const [calcOpponentRosterId, setCalcOpponentRosterId] = useState<number | null>(null);
const [calcGive, setCalcGive] = useState<string[]>([]);
const [calcReceive, setCalcReceive] = useState<string[]>([]);
const [calcGivePicks, setCalcGivePicks] = useState<string[]>([]);
const [calcReceivePicks, setCalcReceivePicks] = useState<string[]>([]);
const [calcSearchA, setCalcSearchA] = useState("");
const [calcSearchB, setCalcSearchB] = useState("");
const [users, setUsers] = useState<Record<string, string>>({});
const [standings, setStandings] = useState<StandingRow[]>([]);

  const [mainTab, setMainTab] = useState("DASHBOARD");

  const {
    username, setUsername,
    user,
    leagues,
    connectLoading,
    connectError,
    connectSuccess,
    connectSleeper,
    disconnectSleeper,
  } = useSleeperUser({
    onDisconnect: () => {
      setSelectedLeague(null);
      setRoster(null);
      setRosters([]);
      setPicks([]);
      setMainTab("DASHBOARD");
    },
  });

  const [allLeagueData, setAllLeagueData] = useState<{ leagueName: string; roster: SleeperRoster | null }[]>([]);
  const [loadingAllLeagueData, setLoadingAllLeagueData] = useState(false);
  const [shareSearch, setShareSearch] = useState("");
  const [sharePosition, setSharePosition] = useState("ALL");
  const [freeAgents, setFreeAgents] = useState<SleeperPlayer[]>([]);
const {
  selectedUserId, setSelectedUserId,
  externalShares,
  loadingShares,
  loadUserExposure,
} = useUserExposure();
// ── ALERTS / WATCHLIST ─────────────────────────────────────────
const {
  dashboardAlerts, setDashboardAlerts,
  dismissedAlertIds, setDismissedAlertIds,
  watchlistEntries, setWatchlistEntries,
  mergeDashboardAlerts,
  dismissAlert: dismissDashboardAlert,
  alertStoreScope,
  watchlistStorageKey,
  alertStorageKey,
  dismissedAlertStorageKey,
} = useAlerts({ supabaseUser, players });
const { crossLeagueMateIntel, loadingCrossLeagueMateIntel } = useCrossLeagueMateIntel({
  leagueId: selectedLeague?.league_id,
  rosters,
  userId: user?.user_id,
  players,
  mainTab,
  leagueHubTab,
  tradeHubSection,
});
const [loadingExternalAlerts, setLoadingExternalAlerts] = useState(false);
const [leagueTransactions, setLeagueTransactions] = useState<AnnotatedTransaction[]>([]);
const [loadingTransactions, setLoadingTransactions] = useState(false);

// ── MANAGEMENT HUB ────────────────────────────────────────────
const {
  mgmtHubTab, setMgmtHubTab,
  leagueMgmtData, setLeagueMgmtData,
  commPaymentsData, setCommPaymentsData,
  commToolsLeagueId, setCommToolsLeagueId,
  commToolsRosters, setCommToolsRosters,
  commToolsUsers, setCommToolsUsers,
  loadingCommToolsRosters, setLoadingCommToolsRosters,
} = useManagementState(supabaseUser);

// ── ROOKIE BOARD ───────────────────────────────────────────────
const {
  rookies, setRookies,
  dragIndex, setDragIndex,
  rookieSearch, setRookieSearch,
  tempRanks, setTempRanks,
  fcNameValues,
  handleRankChange,
} = useRookieBoardState(supabaseUser);

const [oppRosterTab, setOppRosterTab] = useState("QB");
const [oppRosterOwnerId, setOppRosterOwnerId] = useState<string>("");
const [oppRosterSearch, setOppRosterSearch] = useState("");


// Stable ref so alert save effects can read the current user without
// declaring supabaseUser as a dependency (avoids unintended re-fires on login).
const supabaseUserRef = useRef<typeof supabaseUser>(null);
useEffect(() => { supabaseUserRef.current = supabaseUser; }, [supabaseUser]);
// alertSnapshotStorageKey is separate from the useAlerts hook — it tracks the daily
// player value baseline used for gaining/falling alerts, not the alert list itself.
const alertSnapshotStorageKey = `alertSnapshots_v1_${alertStoreScope}`;
const alertBootstrapRef = useRef(false);
// Stable daily baseline for value-change alerts — loaded from Supabase, NOT localStorage.
const historicalSnapshotRef = useRef<HistoricalSnapshot | null>(null);
const [historicalSnapshot, setHistoricalSnapshot] = useState<HistoricalSnapshot | null>(null);
const latestAlertsRef = useRef<AlertsCenterItem[]>([]);

useEffect(() => { latestAlertsRef.current = dashboardAlerts; }, [dashboardAlerts]);

useEffect(() => {
  try {
    const rememberedEmail = localStorage.getItem(LAST_LOGIN_EMAIL_KEY);
    if (rememberedEmail) setLoginEmail(rememberedEmail);
  } catch {}
}, []);

const refreshSupabaseUser = async () => {
  const { data } = await supabase.auth.getUser();
  setSupabaseUser(data.user);
  if (!data.user) {
    setNotes([]);
  }
};

useEffect(() => {
  refreshSupabaseUser();
  const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
    // Use session directly — avoids a second async getUser() call that races with signOut state
    setSupabaseUser(session?.user ?? null);
    if (!session?.user) setNotes([]);
  });
  return () => subscription?.subscription?.unsubscribe?.();
}, []);

const loadNotes = async () => {
  if (!supabaseUser) { setNotes([]); return; }
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("user_id", supabaseUser.id)
    .order("updated_at", { ascending: false });
  if (error) setSupabaseError(error.message);
  else setNotes(data ?? []);
};

// Load all Supabase-persisted user data whenever the logged-in user changes
useEffect(() => {
  if (!supabaseUser) return;
  setSupabaseMessage("");
  try {
    if (supabaseUser.email) localStorage.setItem(LAST_LOGIN_EMAIL_KEY, supabaseUser.email);
  } catch {}
  // 1. Title/body note cards
  loadNotes();
  // 2. League notes (per-league textarea)
  supabase
    .from("league_notes")
    .select("league_id, content")
    .eq("user_id", supabaseUser.id)
    .then(({ data }) => {
      if (data && data.length > 0) {
        const map: Record<string, string> = {};
        data.forEach((row: { league_id: string; content: string }) => { map[row.league_id] = row.content; });
        setLeagueNotes(map);
        localStorage.setItem("leagueNotes", JSON.stringify(map));
      }
    });
  // Rookie board is handled by the loadRookieBoard effect (depends on supabaseUser)
  // 3. League management + commissioner payments are loaded by useManagementState hook
  // 4. Watchlists + alerts are loaded by the useAlerts hook (depends on supabaseUser)
  // 7. Daily player value snapshot — stable baseline for climbing/falling alerts
  supabase
    .from("player_value_snapshots")
    .select("snapshot, recorded_at")
    .eq("user_id", supabaseUser.id)
    .single()
    .then(({ data }) => {
      if (data?.snapshot) {
        const snap = { players: data.snapshot, recorded_at: data.recorded_at };
        historicalSnapshotRef.current = snap;
        setHistoricalSnapshot(snap);
      }
    });
  // 8. Player notes (Supabase overrides localStorage)
  supabase
    .from("player_notes")
    .select("player_id, note")
    .eq("user_id", supabaseUser.id)
    .then(({ data }) => {
      if (data && data.length > 0) {
        const map: Record<string, string> = {};
        data.forEach((row: { player_id: string; note: string }) => { map[String(row.player_id)] = row.note; });
        setPlayerNotes((prev) => {
          const merged = { ...prev, ...map };
          try { localStorage.setItem("playerNotes_v1", JSON.stringify(merged)); } catch {}
          return merged;
        });
      }
    });
  // 8. Player dispositions
  supabase
    .from("player_dispositions")
    .select("player_id, sell, buy")
    .eq("user_id", supabaseUser.id)
    .then(({ data }) => {
      if (data && data.length > 0) {
        const map: Record<string, { sell: string; buy: string }> = {};
        data.forEach((row: { player_id: string; sell: string; buy: string }) => { map[String(row.player_id)] = { sell: row.sell, buy: row.buy }; });
        setPlayerDispositions((prev) => {
          const merged = { ...prev, ...map };
          try { localStorage.setItem("playerDispositions_v1", JSON.stringify(merged)); } catch {}
          return merged;
        });
      }
    });
  // 9. Per-league player tags (CORE = Do Not Sell, WANT_TO_TRADE = actively shopping)
  supabase
    .from("league_player_tags")
    .select("league_id, player_id, tag")
    .eq("user_id", supabaseUser.id)
    .then(({ data }) => {
      if (data && data.length > 0) {
        const map: Record<string, Record<string, "CORE" | "WANT_TO_TRADE">> = {};
        data.forEach((row: { league_id: string; player_id: string; tag: string }) => {
          const lid = String(row.league_id);
          if (!map[lid]) map[lid] = {};
          map[lid][String(row.player_id)] = row.tag as "CORE" | "WANT_TO_TRADE";
        });
        setLeaguePlayerTags((prev) => {
          const merged: Record<string, Record<string, "CORE" | "WANT_TO_TRADE">> = {};
          for (const lid of new Set([...Object.keys(prev), ...Object.keys(map)])) {
            merged[lid] = { ...(prev[lid] ?? {}), ...(map[lid] ?? {}) };
          }
          try { localStorage.setItem("leaguePlayerTags_v1", JSON.stringify(merged)); } catch {}
          return merged;
        });
      }
    });
}, [supabaseUser]);

useEffect(() => {
  if (!supabaseUser) { setAllTradeAttempts([]); return; }
  supabase
    .from("trade_attempts")
    .select("id, league_id, status")
    .eq("user_id", supabaseUser.id)
    .then(({ data }) => { if (data) setAllTradeAttempts(data as TradeAttempt[]); });
}, [supabaseUser?.id]);

const signUp = async () => {
  setSupabaseError("");
  setSupabaseMessage("");
  setLoginLoading(true);
  try {
    const email = loginEmail.trim();
    const { error } = await supabase.auth.signUp({ email, password: loginPassword });
    if (error) {
      setSupabaseError(error.message);
      return;
    }
    try { localStorage.setItem(LAST_LOGIN_EMAIL_KEY, email); } catch {}
    setSupabaseMessage("Account created. Check your email for a confirmation link, then sign in.");
  } finally {
    setLoginLoading(false);
  }
};

const signIn = async () => {
  setSupabaseError("");
  setSupabaseMessage("");
  setLoginLoading(true);
  try {
    const email = loginEmail.trim();
    const signInPromise = supabase.auth.signInWithPassword({
      email,
      password: loginPassword,
    });
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Request timed out — check your internet or Supabase project status.")),
        10000
      );
    });
    const result = await Promise.race([
      signInPromise.then((r) => { clearTimeout(timeoutId); return r; }),
      timeoutPromise,
    ]);
    const { data, error } = result;
    if (error) {
      setSupabaseError(error.message || error.name || "Sign-in failed. Check your credentials.");
      return;
    }
    if (data?.user) {
      try { localStorage.setItem(LAST_LOGIN_EMAIL_KEY, email); } catch {}
      setSupabaseMessage(`Welcome back, ${data.user.email || email}.`);
      // Don't manually set supabaseUser here — onAuthStateChange fires and sets it,
      // and the useEffect([supabaseUser]) will load all persisted data once state updates.
      setShowLoginPassword(false);
      setLoginPassword("");
    } else {
      setSupabaseError("Sign-in failed — no user returned. Check your credentials or confirm your email.");
    }
  } catch (err: unknown) {
    setSupabaseError((err as { message?: string })?.message || "Unexpected error — check your internet connection.");
  } finally {
    setLoginLoading(false);
  }
};

const resetPassword = async () => {
  setSupabaseError("");
  setSupabaseMessage("");
  const email = loginEmail.trim();
  if (!email) {
    setSupabaseError("Enter your email first, then use reset password.");
    return;
  }
  setResetLoading(true);
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    });
    if (error) {
      setSupabaseError(error.message);
      return;
    }
    try { localStorage.setItem(LAST_LOGIN_EMAIL_KEY, email); } catch {}
    setSupabaseMessage("Password reset email sent. Check your inbox and spam folder.");
  } finally {
    setResetLoading(false);
  }
};

const signOut = async () => {
  await supabase.auth.signOut();
  // onAuthStateChange will fire and set supabaseUser to null, but also set it
  // explicitly here so the UI updates immediately without waiting for the event
  setSupabaseUser(null);
  setNotes([]);
  setLeagueNotes({});
  setLeagueMgmtData({});
  setCommPaymentsData({});
  setWatchlistEntries([]);
  setDashboardAlerts([]);
  setDismissedAlertIds([]);
  setCommToolsLeagueId("");
  setCommToolsRosters([]);
  setCommToolsUsers({});
  try {
    const rememberedEmail = localStorage.getItem(LAST_LOGIN_EMAIL_KEY) || "";
    setLoginEmail(rememberedEmail);
  } catch {
    setLoginEmail("");
  }
  setLoginPassword("");
  setLoginLoading(false);
  setResetLoading(false);
  setShowLoginPassword(false);
  setSupabaseError("");
  setSupabaseMessage("");
  // Clear localStorage user-specific data so next user starts fresh
  localStorage.removeItem("leagueNotes");
  localStorage.removeItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`);
  localStorage.removeItem(ROOKIE_BOARD_RESET_KEY);
  localStorage.removeItem(watchlistStorageKey);
  localStorage.removeItem(alertStorageKey);
  localStorage.removeItem(alertSnapshotStorageKey);
  localStorage.removeItem(dismissedAlertStorageKey);
  // Disconnect Sleeper so the app returns fully to the logged-out state
  disconnectSleeper();
};

// -------------------------
// LOAD PLAYERS
// -------------------------
useEffect(() => {
  const controller = new AbortController();
  const { signal } = controller;

  const loadPlayers = async () => {
    // Fast path: already loaded this session — skip localStorage and network entirely
    if (_playersInMemory) {
      setPlayers(_playersInMemory);
      // nflState is React state and resets on remount — reload it from the cached route
      fetch('/api/nfl-state', { signal })
        .then(r => r.json()).then((s) => { if (!signal.aborted) setNflState(s); }).catch(() => {});
      return;
    }

    let cached: string | null = null;
    let cachedAt: string | null = null;
    try {
      cached = localStorage.getItem("playersCache");
      cachedAt = localStorage.getItem("playersCacheAt");
    } catch { /* private browsing or quota — skip cache */ }
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (cached && cachedAt && Date.now() - Number(cachedAt) < ONE_DAY) {
      let parsedCache: Record<string, SleeperPlayer>;
      try { parsedCache = JSON.parse(cached); } catch { parsedCache = {}; }
      const cacheSample = Object.values(parsedCache).find((player) => player && typeof player === "object") as Record<string, unknown> | undefined;
      const hasRookieFields =
        cacheSample &&
        "years_exp" in cacheSample &&
        "search_rank" in cacheSample &&
        "fantasy_positions" in cacheSample;

      if (hasRookieFields) {
        _playersInMemory = parsedCache;
        setPlayers(parsedCache);
        // Still load pick values and nflState even when players come from cache
        fetchFantasyCalcValues(2).then(({ pickValues }) => { if (!signal.aborted) setPickFcValues(pickValues); }).catch(() => {});
        fetch('/api/nfl-state', { signal })
          .then(r => r.json()).then((s) => { if (!signal.aborted) setNflState(s); }).catch(() => {});
        return;
      }
    }

    // /api/players returns pre-slimmed players + nflState, both server-cached
    const res = await fetch("/api/players", { signal });
    if (signal.aborted) return;
    const { players: data, nflState: fetchedNflState } = await res.json();
    setNflState(fetchedNflState);

    const { playerValues: fcValues, pickValues } = await fetchFantasyCalcValues(2);
    setPickFcValues(pickValues);

    // Merge FC dynasty values into the player map
    Object.keys(data).forEach((id) => {
      if (fcValues[id]) data[id].value = fcValues[id];
    });

    try {
      localStorage.setItem("playersCache", JSON.stringify(data));
      localStorage.setItem("playersCacheAt", String(Date.now()));
    } catch {
      // localStorage full — skip caching, app still works fine
    }
    _playersInMemory = data;
    setPlayers(data);
  };

  loadPlayers().catch((err) => { if (!controller.signal.aborted) console.error('[loadPlayers]', err); });
  return () => controller.abort();
}, []);

// Load league-specific FC values and redraft values as soon as Trade Hub is opened.
// redraftValues powers the redraft-rank half of the direction bucket — if it's empty
// when the direction memo fires it produces a garbage bucket (usually "Purgatory").
useEffect(() => {
  if (mainTab === "TRADE_HUB" && selectedLeague?.league_id) {
    loadCalcValues(selectedLeague.league_id);
    loadRedraftValues();
  }
}, [mainTab, selectedLeague?.league_id]);

// Also reload if the user switches sub-tabs within Trade Hub (redundant but keeps the guard intact)
useEffect(() => {
  if ((tradeHubSection === "CALCULATOR" || tradeHubSection === "FINDER" || tradeHubSection === "RECOMMENDATIONS") && selectedLeague?.league_id) {
    loadCalcValues(selectedLeague.league_id);
  }
  // Auto-load attempts when switching to ATTEMPTS tab
  if (tradeHubSection === "ATTEMPTS" && selectedLeague?.league_id && supabaseUser && tradeAttemptsLeagueId !== selectedLeague.league_id) {
    loadTradeAttempts(selectedLeague.league_id);
  }
}, [tradeHubSection, selectedLeague?.league_id]);

useEffect(() => {
  if (mainTab === "DATA_HUB" && dataHubTab === "RANKINGS" && selectedLeague?.league_id) {
    loadCalcValues(selectedLeague.league_id);
  }
}, [mainTab, dataHubTab, selectedLeague?.league_id]);

useEffect(() => {
  if (mainTab === "DATA_HUB" && dataHubTab === "RANKINGS") {
    loadRedraftValues();
  }
}, [mainTab, dataHubTab]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "OVERVIEW" && !leagueOverviewLoaded) {
    loadLeagueOverview();
    loadNflState();
    loadRedraftValues();
  }
  // leagueOverviewLoaded guards against duplicate calls; leagues.length triggers when leagues first load
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [mainTab, leagueHubTab, leagueOverviewLoaded, leagues.length]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "STARTERS") {
    loadNflState();
    if (selectedLeague?.league_id) loadCalcValues(selectedLeague.league_id);
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "POWER_RANKINGS" && selectedLeague?.league_id) {
    loadCalcValues(selectedLeague.league_id);
    loadRedraftValues();
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "ACTIVITY" && selectedLeague?.league_id) {
    setActivityTransactions([]);
    loadActivity(selectedLeague.league_id);
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "DRAFT_BOARD" && selectedLeague?.league_id) {
    refreshDraftBoard();
    // Load owner tendencies in the background — non-blocking
    if (rosters.length) loadOwnerTendencies();
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id, rosters.length]);

// Stable counts for dep arrays — Object.keys() creates a new array on every render,
// which defeats useMemo/useEffect deps. These are plain numbers and safe to compare.
const usersCount   = useMemo(() => Object.keys(users).length,   [users]);
const playersCount = useMemo(() => Object.keys(players).length, [players]);

// Load leaguemate trade alerts once rosters + user display names + players are ready.
// players must be loaded so player IDs in trade.adds can be resolved to full_name.
useEffect(() => {
  if (!rosters.length || !usersCount || !user?.user_id || !playersCount) return;
  loadLeaguemateTradeAlerts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [rosters.length, usersCount, playersCount]);

// Auto-load data needed by the player profile panel whenever it opens
useEffect(() => {
  if (!playerProfileId) return;
  if (Object.keys(redraftValues).length === 0) loadRedraftValues();
  if (!leagueOverviewLoaded && leagues.length > 0 && user) loadLeagueOverview();
}, [playerProfileId, leagues.length, user?.user_id]);

useEffect(() => {
  if (mainTab === "LEAGUES" && (leagueHubTab === "SIMULATOR" || leagueHubTab === "OVERVIEW")) {
    loadNflState();
    loadRedraftValues();
    const isRegularSeason = nflState?.season_type === "regular" && (nflState?.week ?? 0) > 0;
    const simulatorProjectionWeek = isRegularSeason ? Number(nflState?.week) : 0;
    if (projectionWeek !== simulatorProjectionWeek) {
      setProjectionWeek(simulatorProjectionWeek);
      setProjectionLoaded(false);
      loadProjections(simulatorProjectionWeek === 0 ? "season" : simulatorProjectionWeek);
    } else if (!projectionLoaded) {
      loadProjections(simulatorProjectionWeek === 0 ? "season" : simulatorProjectionWeek);
    }
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id, nflState?.week, nflState?.season_type]);

useEffect(() => {
  if (mainTab !== "GAMEDAY_HUB") return;
  loadNflState();
}, [mainTab]);

useEffect(() => {
  const isRegularSeason = nflState?.season_type === "regular" && Number(nflState?.week || 0) > 0;
  const currentWeek = isRegularSeason ? Number(nflState?.week) : 0;

  if (mainTab !== "GAMEDAY_HUB" || !selectedLeague?.league_id || !currentWeek) {
    if (mainTab === "GAMEDAY_HUB" && !currentWeek) {
      setGamedayMatchups([]);
      setSelectedGamedayMatchupId(null);
    }
    return;
  }

  if (projectionWeek !== currentWeek) {
    setProjectionWeek(currentWeek);
    setProjectionLoaded(false);
    loadProjections(currentWeek);
  } else if (!projectionLoaded) {
    loadProjections(currentWeek);
  }

  loadGamedayMatchups(selectedLeague.league_id, currentWeek);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // projectionWeek/projectionLoaded omitted intentionally: adding them would
  // create a reload loop (effect sets projectionWeek → dep changes → re-runs).
  // loadProjections/loadGamedayMatchups omitted because they are not useCallback-
  // wrapped; adding them would re-run on every render. The nflState deps above
  // are sufficient to trigger this effect at the right times.
}, [mainTab, selectedLeague?.league_id, nflState?.week, nflState?.season_type]);

useEffect(() => {
  const leagueId = selectedLeague?.league_id;
  if (mainTab !== "LEAGUES" || leagueHubTab !== "SIMULATOR" || !leagueId) return;
  const isRegularSeason = nflState?.season_type === "regular" && (nflState?.week ?? 0) > 0;
  if (!isRegularSeason) return;
  if (leagueWeeklyMatchups[leagueId]) return;

  let cancelled = false;

  const loadLeagueWeeklyHistory = async () => {
    const regularSeasonWeeks = Math.max(1, Number(selectedLeague?.settings?.playoff_week_start || 15) - 1);
    if (regularSeasonWeeks <= 0) return;

    setLoadingLeagueWeeklyMatchups(true);
    try {
      const weeks = Array.from({ length: regularSeasonWeeks }, (_, idx) => idx + 1);
      const results = await Promise.all(
        weeks.map(async (week) => {
          const data = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`)
            .then((r) => r.json())
            .catch(() => []);
          return {
            week,
            matchups: Array.isArray(data) ? data : [],
          };
        })
      );
      if (!cancelled) {
        setLeagueWeeklyMatchups((prev) => ({
          ...prev,
          [leagueId]: results,
        }));
      }
    } finally {
      if (!cancelled) setLoadingLeagueWeeklyMatchups(false);
    }
  };

  loadLeagueWeeklyHistory();
  return () => { cancelled = true; };
}, [mainTab, leagueHubTab, selectedLeague?.league_id, selectedLeague?.settings?.playoff_week_start, nflState?.week, nflState?.season_type, leagueWeeklyMatchups]);

useEffect(() => {
  if (!selectedLeague?.league_id || !rosters.length || !Object.keys(players || {}).length) {
    setLeagueMateTradeIntel({});
    return;
  }

  let cancelled = false;

  const loadLeagueMateIntel = async () => {
    setLoadingLeagueMateIntel(true);
    try {
      const [t1, t2] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${selectedLeague.league_id}/transactions/1`).then((r) => r.json()).catch(() => []),
        fetch(`https://api.sleeper.app/v1/league/${selectedLeague.league_id}/transactions/2`).then((r) => r.json()).catch(() => []),
      ]);

      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const rosterStats: Record<string, any> = {};
      const ensureRoster = (rosterId: number | string) => {
        const key = String(rosterId);
        if (!rosterStats[key]) {
          rosterStats[key] = {
            tradeCount30d: 0,
            bought: { QB: 0, RB: 0, WR: 0, TE: 0 },
            picksIn: 0,
            picksOut: 0,
            lastTradeAt: null,
          };
        }
        return rosterStats[key];
      };

      [...(Array.isArray(t1) ? t1 : []), ...(Array.isArray(t2) ? t2 : [])]
        .filter((trade: any) => trade?.type === "trade" && trade?.status === "complete" && Number(trade?.created || 0) >= thirtyDaysAgo)
        .forEach((trade: any) => {
          (trade.roster_ids || []).forEach((rosterId: number) => {
            const entry = ensureRoster(rosterId);
            entry.tradeCount30d += 1;
            entry.lastTradeAt = Math.max(entry.lastTradeAt || 0, Number(trade.created || 0));
          });

          Object.entries(trade.adds || {}).forEach(([playerId, rosterId]: any) => {
            const pos = players[playerId]?.position;
            if (!["QB", "RB", "WR", "TE"].includes(pos)) return;
            const entry = ensureRoster(rosterId);
            entry.bought[pos] = (entry.bought[pos] || 0) + 1;
          });

          (trade.draft_picks || []).forEach((pick: any) => {
            if (pick?.owner_id != null) ensureRoster(pick.owner_id).picksIn += 1;
            if (pick?.previous_owner_id != null) ensureRoster(pick.previous_owner_id).picksOut += 1;
          });
        });

      if (!cancelled) setLeagueMateTradeIntel(rosterStats);
    } finally {
      if (!cancelled) setLoadingLeagueMateIntel(false);
    }
  };

  loadLeagueMateIntel();
  return () => { cancelled = true; };
}, [selectedLeague?.league_id, rosters, players]);

useEffect(() => {
  if (!supabaseUser || !selectedLeague?.league_id) return;
  supabase
    .from("leaguemate_profiles")
    .select("profiles")
    .eq("user_id", supabaseUser.id)
    .eq("league_id", selectedLeague.league_id)
    .single()
    .then(({ data, error }) => {
      if (error || !data?.profiles || !Array.isArray(data.profiles)) return;
      setLeagueMateProfileCache((prev) => ({
        ...prev,
        [selectedLeague.league_id]: data.profiles,
      }));
    });
}, [supabaseUser?.id, selectedLeague?.league_id]);

// Load cached simulation results from Supabase for the League Overview playoff% column.
// Uses a MERGE strategy: if in-memory data has a newer computed_at than the DB row,
// keep the in-memory value. This prevents Supabase token refreshes from overwriting
// freshly-run sim results that haven't landed in the DB yet.
useEffect(() => {
  if (!supabaseUser) return;
  supabase
    .from("league_simulations")
    .select("league_id,roster_id,playoff_odds,title_odds,expected_wins,avg_finish,finish_range,computed_at")
    .eq("user_id", supabaseUser.id)
    .then(({ data }) => {
      if (!data?.length) return;
      const byLeague: Record<string, Record<number, any>> = {};
      data.forEach((row: any) => {
        if (!byLeague[row.league_id]) byLeague[row.league_id] = {};
        byLeague[row.league_id][Number(row.roster_id)] = row;
      });
      setLeagueSimCache(prev => {
        const merged: Record<string, Record<number, any>> = { ...byLeague };
        // For any entry already in memory with a newer timestamp, keep the in-memory value.
        Object.entries(prev).forEach(([lid, rosterMap]) => {
          Object.entries(rosterMap as Record<string, any>).forEach(([rid, memRow]: [string, any]) => {
            const dbRow = merged[lid]?.[Number(rid)];
            const memTime = memRow?.computed_at ? new Date(memRow.computed_at).getTime() : 0;
            const dbTime = dbRow?.computed_at ? new Date(dbRow.computed_at).getTime() : 0;
            if (memTime > dbTime) {
              if (!merged[lid]) merged[lid] = {};
              merged[lid][Number(rid)] = memRow;
            }
          });
        });
        return merged;
      });
    });
}, [supabaseUser?.id]);

// Load saved draft slot picks — localStorage first (instant), Supabase as source-of-truth if available
useEffect(() => {
  if (!selectedLeague?.league_id) return;
  // Always clear picks when switching leagues — each league has its own set
  setMyDraftSlotPicks({});
  const lsKey = `draftPicks_${selectedLeague.league_id}_${ROOKIE_YEAR}`;
  // Restore this league's picks from localStorage immediately
  const saved = localStorage.getItem(lsKey);
  if (saved) {
    try { setMyDraftSlotPicks(JSON.parse(saved)); } catch {}
  }
  // Then try Supabase as authoritative source (overwrites localStorage if data exists)
  if (!supabaseUser) return;
  supabase
    .from("draft_board_picks")
    .select("pick_slot,player_id")
    .eq("user_id", supabaseUser.id)
    .eq("league_id", selectedLeague.league_id)
    .eq("season", ROOKIE_YEAR)
    .then(({ data }) => {
      if (!data?.length) return;
      const picks: Record<string, string> = {};
      data.forEach((row: any) => { picks[row.pick_slot] = row.player_id; });
      setMyDraftSlotPicks(picks);
      localStorage.setItem(lsKey, JSON.stringify(picks));
    });
}, [supabaseUser?.id, selectedLeague?.league_id]);

// Save draft slot picks — localStorage immediately, Supabase async (best-effort)
useEffect(() => {
  if (!selectedLeague?.league_id || !Object.keys(myDraftSlotPicks).length) return;
  const lsKey = `draftPicks_${selectedLeague.league_id}_${ROOKIE_YEAR}`;
  localStorage.setItem(lsKey, JSON.stringify(myDraftSlotPicks));
  if (!supabaseUser) return;
  const rows = Object.entries(myDraftSlotPicks).map(([pick_slot, player_id]) => ({
    user_id: supabaseUser.id,
    league_id: selectedLeague.league_id,
    season: ROOKIE_YEAR,
    pick_slot,
    player_id,
    updated_at: new Date().toISOString(),
  }));
  supabase
    .from("draft_board_picks")
    .upsert(rows, { onConflict: "user_id,league_id,season,pick_slot" })
    .then(() => {}); // table may not exist yet — localStorage handles persistence
}, [supabaseUser?.id, selectedLeague?.league_id, myDraftSlotPicks]);


// League notes — load from localStorage on mount (fast), then override with Supabase on login
useEffect(() => {
  const saved = localStorage.getItem("leagueNotes");
  if (saved) setLeagueNotes(JSON.parse(saved));
}, []);

const saveLeagueNote = async (leagueId: string, text: string) => {
  const updated = { ...leagueNotes, [leagueId]: text };
  setLeagueNotes(updated);
  localStorage.setItem("leagueNotes", JSON.stringify(updated));
  if (supabaseUser) {
    await supabase.from("league_notes").upsert(
      { user_id: supabaseUser.id, league_id: leagueId, content: text, updated_at: new Date().toISOString() },
      { onConflict: "user_id,league_id" }
    );
  }
};

useEffect(() => {
  if (mainTab === "DATA_HUB" && dataHubTab === "PROJECTIONS" && !projectionLoaded) {
    loadProjections(projectionWeek === 0 ? 'season' : projectionWeek);
  }
}, [mainTab, dataHubTab]);

// Rookie board save + load effects live in useRookieBoardState (extracted hook).
const refreshDraftBoard = async () => {
  if (!selectedLeague) return;
  setLoadingDraftRefresh(true);
  try {
    const draftsRes = await fetch(
      `https://api.sleeper.app/v1/league/${selectedLeague.league_id}/drafts`
    );
    const drafts = await draftsRes.json();
    const currentDraft = drafts[0];
    if (!currentDraft) return;
    setDraftId(currentDraft.draft_id);
    setDraftOrder(currentDraft.draft_order || currentDraft.slot_to_roster_id || {});
    setDraftSettings(currentDraft); // full object — consistent with useLeagues.ts
    setSelectedLeagueDraftHasOccurred(currentDraft.status !== "pre_draft");
    const picksRes = await fetch(
      `https://api.sleeper.app/v1/draft/${currentDraft.draft_id}/picks`
    );
    const picks = await picksRes.json();
    setDraftPicks(picks);
  } catch (err) {
    console.warn("Draft refresh failed");
  } finally {
    setLoadingDraftRefresh(false);
  }
};

useEffect(() => {
  if (!selectedLeague || mainTab !== "DRAFT" || draftHubSection !== "BOARD") return;
  refreshDraftBoard();
}, [selectedLeague, mainTab, draftHubSection]);

// Load historical rookie draft tendencies for every owner in the current league.
// Uses the PREVIOUS year's completed rookie drafts (≤5 rounds) so data is available
// Prefers current ROOKIE_YEAR completed drafts; falls back to prior year if none exist yet.
// Automatically uses the right year once current-year drafts start completing.
const loadOwnerTendencies = async () => {
  if (!rosters.length) return;
  const PREV_YEAR = String(Number(ROOKIE_YEAR) - 1);
  const ownerUserIds: string[] = rosters
    .map((r: any) => r.owner_id)
    .filter((uid: string) => uid && uid !== user?.user_id);
  if (!ownerUserIds.length) return;

  const tendencies: Record<string, Record<string, number>> = {};

  // ── 1. Pull everything we already have from Supabase cache ──────────────
  const { data: cached } = await supabase
    .from("owner_tendencies")
    .select("owner_user_id, season, rates, updated_at")
    .in("owner_user_id", ownerUserIds)
    .in("season", [ROOKIE_YEAR, PREV_YEAR]);

  // Build a map: userId → best cached row
  // Prefer ROOKIE_YEAR over PREV_YEAR; within same season prefer most recent
  const cacheMap: Record<string, { rates: Record<string, number>; updated_at: string; season: string }> = {};
  (cached ?? []).forEach((row: any) => {
    const existing = cacheMap[row.owner_user_id];
    const rowBetter =
      !existing ||
      (row.season === ROOKIE_YEAR && existing.season !== ROOKIE_YEAR) ||
      (row.season === existing.season && row.updated_at > existing.updated_at);
    if (rowBetter) cacheMap[row.owner_user_id] = { rates: row.rates, updated_at: row.updated_at, season: row.season };
  });

  // Prior-year cache never expires (those drafts are done).
  // Current-year cache is good for 24 h while drafts are still rolling in.
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const needsFetch: string[] = [];
  ownerUserIds.forEach((userId) => {
    const c = cacheMap[userId];
    if (c) {
      const fresh = c.season === PREV_YEAR || (now - new Date(c.updated_at).getTime()) < CACHE_TTL_MS;
      if (fresh) { tendencies[userId] = c.rates; return; }
    }
    needsFetch.push(userId);
  });

  if (!needsFetch.length) { setOwnerDraftTendencies(tendencies); return; }

  // ── 2. Fetch from Sleeper for owners without a fresh cache entry ─────────
  const newRows: any[] = [];

  await Promise.all(needsFetch.map(async (userId: string) => {
    try {
      const yearsToTry = [ROOKIE_YEAR, PREV_YEAR];
      const collected: { round: number; position: string }[] = [];
      let foundSeason = PREV_YEAR;

      for (const year of yearsToTry) {
        const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${year}`);
        const leagues = await leaguesRes.json();
        if (!Array.isArray(leagues)) continue;

        // No cap — scan all leagues for the most accurate picture
        await Promise.all(leagues.map(async (league: any) => {
          try {
            const draftsRes = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`);
            const drafts = await draftsRes.json();
            const rookieDraft = (drafts as any[]).find(
              (d: any) =>
                d.season === year &&
                d.status === "complete" &&
                (d.settings?.rounds ?? 99) <= 5
            );
            if (!rookieDraft) return;
            const picksRes = await fetch(`https://api.sleeper.app/v1/draft/${rookieDraft.draft_id}/picks`);
            const picks = await picksRes.json();
            (picks as any[])
              .filter((p: any) => p.picked_by === userId && p.metadata?.position)
              .forEach((p: any) => {
                collected.push({ round: Number(p.round), position: String(p.metadata.position) });
              });
          } catch (err) {
            console.warn('[loadDraftScout] draft picks fetch error:', err);
          }
        }));

        if (collected.length >= 3) { foundSeason = year; break; }
      }

      if (collected.length < 3) return; // not enough history to be meaningful

      // Weight: R1 = 3×, R2 = 2×, later = 1× (early picks are most deliberate)
      const weighted: Record<string, number> = {};
      let totalWeight = 0;
      collected.forEach(({ round, position }) => {
        const w = round === 1 ? 3 : round === 2 ? 2 : 1;
        weighted[position] = (weighted[position] || 0) + w;
        totalWeight += w;
      });

      const rates: Record<string, number> = {};
      Object.keys(weighted).forEach((pos) => { rates[pos] = weighted[pos] / totalWeight; });

      tendencies[userId] = rates;
      newRows.push({
        owner_user_id: userId,
        season: foundSeason,
        rates,
        pick_count: collected.length,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[loadDraftScout] owner tendencies error for', userId, err);
    }
  }));

  // ── 3. Persist newly fetched data so next load hits cache ────────────────
  if (newRows.length) {
    supabase.from("owner_tendencies")
      .upsert(newRows, { onConflict: "owner_user_id,season" })
      .then(() => {});
  }

  setOwnerDraftTendencies(tendencies);
};

  // -------------------------
  // LOAD ALL LEAGUES FOR SHARES
  // -------------------------
  useEffect(() => {
    const loadAll = async () => {
      if (!user || !leagues.length) return;

      setLoadingAllLeagueData(true);
      try {
        const results = await Promise.all(
          leagues.map(async (league) => {
            const { roster } = await fetch(
              `/api/cross-league-rosters?sleeper_user_id=${encodeURIComponent(user.user_id)}&league_id=${encodeURIComponent(league.league_id)}`
            ).then((r) => r.json()).catch(() => ({ roster: null }));

            return {
              leagueName: league.name,
              roster,
            };
          })
        );

        setAllLeagueData(results);

        const savedLeague = localStorage.getItem("selectedLeague");
        if (savedLeague) {
          try {
            const parsedLeague = JSON.parse(savedLeague);
            const match = leagues.find((l: any) => l.league_id === parsedLeague.league_id);
            if (match) loadRoster(match);
          } catch { /* ignore corrupt localStorage */ }
        }
      } finally {
        setLoadingAllLeagueData(false);
      }
    };

    loadAll();
  }, [user, leagues]);

  // -------------------------
  // SHARES
  // -------------------------
  const totalLeagues = allLeagueData.length || 1;

  const shares = useMemo(() => {
    const map: Record<string, { count: number; leagues: string[]; starters: string[] }> = {};
    allLeagueData.forEach((entry) => {
      const roster = entry.roster;
      if (!roster) return;
      roster.players?.forEach((playerId: string) => {
        if (!map[playerId]) map[playerId] = { count: 0, leagues: [], starters: [] };
        map[playerId].count++;
        map[playerId].leagues.push(entry.leagueName);
        if (roster.starters?.includes(playerId)) map[playerId].starters.push(entry.leagueName);
      });
    });
    return map;
  }, [allLeagueData]);

  // -------------------------
// LOAD LEAGUE 
// -------------------------
const loadRoster = async (league: SleeperLeague) => {

  // ── Save recent league ───────────────────────────────────────────────────
  const stored = localStorage.getItem("recentLeagues");
  let recents: { league_id: string; name: string }[] = stored ? JSON.parse(stored) : [];
  recents = recents.filter((l) => l.league_id !== league.league_id);
  recents.unshift({ league_id: league.league_id, name: league.name });
  localStorage.setItem("recentLeagues", JSON.stringify(recents.slice(0, 5)));

  setSelectedLeague(league);

  // ── Step 1: Rosters, traded picks, and drafts — from cache or network ────
  // Cache key is per-league; TTL is 2 hours (short enough to stay fresh during
  // trade season, long enough to avoid redundant fetches when switching leagues)
  const LEAGUE_CACHE_TTL = 2 * 60 * 60 * 1000;
  const leagueCacheKey = `leagueData_${league.league_id}`;
  let cacheHit = false;
  let allRosters: SleeperRoster[] = [];
  let tradedPicksData: SleeperTradedPick[] = [];
  let draftsData: SleeperDraft[] = [];
  const leagueCached = localStorage.getItem(leagueCacheKey);
  if (leagueCached) {
    try {
      const { data, cachedAt } = JSON.parse(leagueCached);
      if (Date.now() - cachedAt < LEAGUE_CACHE_TTL) {
        allRosters     = data.allRosters;
        tradedPicksData = data.tradedPicksData;
        draftsData      = data.draftsData;
        cacheHit = true;
      }
    } catch { /* invalid cache — fall through to network */ }
  }
  if (!cacheHit) {
    [allRosters, tradedPicksData, draftsData] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).then((r) => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/traded_picks`).then((r) => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`).then((r) => r.json()).catch(() => []),
    ]);
    try {
      localStorage.setItem(leagueCacheKey, JSON.stringify({ data: { allRosters, tradedPicksData, draftsData }, cachedAt: Date.now() }));
    } catch { /* localStorage quota exceeded — skip caching */ }
  }
  setRosters(allRosters);

  // ── Step 2: Synchronous work derived from rosters ────────────────────────
  const rosteredIds = new Set<string>();
  allRosters.forEach((r: any) => {
    (r.players || []).forEach((p: string) => rosteredIds.add(p));
  });

  const rosterToUser: any = {};
  allRosters.forEach((r: any) => { rosterToUser[r.roster_id] = r.owner_id; });

  const myRoster = allRosters.find((r: any) => r.owner_id === user?.user_id);
  if (!myRoster) { setReadyLeagueId(league.league_id); return; }
  setRoster(myRoster);

  setFreeAgents(
    Object.values(players || {})
      .filter((p: any) => p && !rosteredIds.has(String(p.player_id)))
      .sort((a: any, b: any) => (b.value || 0) - (a.value || 0))
      .slice(0, 20)
  );

  const MAX_SUPPORTED_ROUNDS = 6;
  const ALL_ROUNDS = Array.from({ length: MAX_SUPPORTED_ROUNDS }, (_, i) => i + 1);
  let tempPicks: any[] = [];
  YEARS.forEach((year) => {
    allRosters.forEach((r: any) => {
      ALL_ROUNDS.forEach((round) => {
        tempPicks.push({ season: year, round, roster_id: r.roster_id, owner_id: r.roster_id });
      });
    });
  });

  // ── Step 3: User names — fetchSleeperUser has its own module-level cache ──
  const userResults = await Promise.all(allRosters.map((r: any) => fetchSleeperUser(r.owner_id)));

  // ── Step 4: Apply traded picks ───────────────────────────────────────────
  tradedPicksData.forEach((tp: any) => {
    const match = tempPicks.find(
      (p) => p.season === tp.season && p.round === tp.round && p.roster_id === tp.roster_id
    );
    if (match) match.owner_id = tp.owner_id;
  });

  // ── Step 6: Assign draft slots ───────────────────────────────────────────
  const currentDraft = draftsData.find((d: any) => d.season === CURRENT_YEAR);

  // Trim to the league's actual round count (check both settings.rounds and top-level rounds)
  const settingsRounds = Number(currentDraft?.settings?.rounds ?? currentDraft?.rounds) || 0;
  const tradedMaxRound = tradedPicksData.reduce(
    (max, tp) => Math.max(max, Number(tp.round) || 0), 0
  );
  const leagueRounds: number = Math.max(settingsRounds, tradedMaxRound, ROUNDS.length);
  tempPicks = tempPicks.filter((p: any) => Number(p.round) <= leagueRounds);

  // ── Step 5: My picks (after trades applied and rounds trimmed) ───────────
  const myPicks = tempPicks.filter((p) => p.owner_id === myRoster.roster_id);
  const order = currentDraft?.draft_order || {};
  setSelectedLeagueDraftHasOccurred(currentDraft?.status !== "pre_draft");
  const totalDraftTeams = allRosters.length || Number(currentDraft?.settings?.teams) || 0;

  tempPicks.forEach((pick: any) => {
    if (pick.season === CURRENT_YEAR) {
      const userId = rosterToUser[pick.roster_id];
      const baseSlot = Number(order[String(userId)] || 0);
      const slot = getDraftRoundSlot(currentDraft ?? {}, Number(pick.round), baseSlot, totalDraftTeams);
      pick.slot = slot
        ? `${pick.round}.${String(slot).padStart(2, "0")}`
        : `${pick.round}.${String(pick.roster_id).padStart(2, "0")}`;
    } else {
      pick.slot = `${pick.round}`;
    }
  });

  setAllPicks(tempPicks);
  setPicks(
    myPicks.sort((a: any, b: any) => {
      if (a.season !== b.season) return a.season - b.season;
      if (a.round !== b.round) return a.round - b.round;
      const aSlot = parseInt(a.slot?.split(".")[1] || 0);
      const bSlot = parseInt(b.slot?.split(".")[1] || 0);
      return aSlot - bSlot;
    })
  );

  // ── Step 7: Apply user names ─────────────────────────────────────────────
  const userMap: any = {};
  allRosters.forEach((r: any, i: number) => {
    const u = userResults[i];
    if (u) {
      userMap[r.roster_id] = u.display_name;
      userMap[r.owner_id] = u.display_name;
    }
  });
  setUsers(userMap);

  // ── Step 8: Standings ────────────────────────────────────────────────────
  setStandings(
    allRosters
      .map((r: any) => ({
        roster_id: r.roster_id,
        wins: r.settings?.wins || 0,
        losses: r.settings?.losses || 0,
        ties: r.settings?.ties || 0,
        fpts: r.settings?.fpts || 0,
        max_pf: r.settings?.fpts_max || 0,
        owner_id: r.owner_id,
      }))
      .sort((a: any, b: any) =>
        b.wins !== a.wins ? b.wins - a.wins : b.fpts - a.fpts
      )
  );
  setReadyLeagueId(league.league_id);
};

const loadDraftScout = async (userId: string) => {
  setDraftScoutUserId(userId);
  setDraftScoutData(null);
  setLoadingDraftScout(true);

  try {
    // 1. All 2026 leagues for this user
    const leaguesRes = await fetch(
      `https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${CURRENT_YEAR}`
    );
    const leagues = await leaguesRes.json();

    // 2. For each league, fetch drafts + picks in parallel
    const results = await Promise.all(
      leagues.map(async (league: any) => {
        const draftsRes = await fetch(
          `https://api.sleeper.app/v1/league/${league.league_id}/drafts`
        );
        const drafts = await draftsRes.json();

        // Find a rookie-only draft: current year, started, and ≤5 rounds
        // Startup drafts cover full rosters (15–25+ rounds) so this reliably excludes them
        const rookieDraft = drafts.find(
          (d: any) =>
            d.season === CURRENT_YEAR &&
            d.status !== "pre_draft" &&
            (d.settings?.rounds ?? 99) <= 5
        );
        if (!rookieDraft) return null;

        const picksRes = await fetch(
          `https://api.sleeper.app/v1/draft/${rookieDraft.draft_id}/picks`
        );
        const allPicks = await picksRes.json();

        // Only this user's picks
        const myPicks = allPicks
          .filter((p: any) => p.picked_by === userId)
          .sort((a: any, b: any) => a.pick_no - b.pick_no)
          .map((p: any) => ({
            slot: `${p.round}.${String(p.draft_slot).padStart(2, "0")}`,
            round: p.round,
            player: players[p.player_id] || null,
            playerName: p.metadata?.first_name
              ? `${p.metadata.first_name} ${p.metadata.last_name}`
              : null,
            position: p.metadata?.position || null,
          }));

        return { leagueName: league.name, picks: myPicks };
      })
    );

    setDraftScoutData(results.filter(Boolean));
  } catch (err) {
    console.error("Draft scout error:", err);
  } finally {
    setLoadingDraftScout(false);
  }
};

const loadCalcValues = async (leagueId: string) => {
  if (calcValuesLeagueId === leagueId) return; // already loaded for this league
  setLoadingCalcValues(true);
  try {
    const res = await fetch(
      `https://api.fantasycalc.com/values/current?leagueId=${leagueId}&site=sleeper`
    );
    const data = await res.json();
    const vals: Record<string, number> = {};
    data.forEach((entry: any) => {
      const sleeperId = entry.player?.sleeperId;
      if (sleeperId) vals[String(sleeperId)] = entry.value;
    });
    setCalcFcValues(vals);
    setCalcValuesLeagueId(leagueId);
  } catch (err) {
    console.error('[loadCalcValues] failed:', err);
  } finally {
    setLoadingCalcValues(false);
  }
};

const loadNflState = async () => {
  if (nflState) return;
  try {
    const data = await fetch('/api/nfl-state').then(r => r.json());
    setNflState(data);
  } catch (err) {
    console.error('[loadNflState] failed:', err);
  }
};

const loadGamedayMatchups = async (leagueId: string, week: number) => {
  if (!leagueId || !week) return;
  setLoadingGamedayMatchups(true);
  try {
    const data = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`)
      .then((r) => r.json())
      .catch(() => []);
    setGamedayMatchups(Array.isArray(data) ? data : []);
  } finally {
    setLoadingGamedayMatchups(false);
  }
};

// ── Leaguemate trade alerts ──────────────────────────────────────────────────
// Scans every dynasty league each leaguemate is in (not just shared leagues)
// and surfaces trades from the last 14 days as feed alerts.
// Seen trade IDs are cached in Supabase so repeat loads don't re-alert.
const tradeAlertLoadedRef = useRef(false);
const loadLeaguemateTradeAlerts = async () => {
  if (tradeAlertLoadedRef.current) return; // once per session
  if (!rosters.length || !user?.user_id || !Object.keys(players).length) return;
  tradeAlertLoadedRef.current = true;

  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

  // Get already-known trade alert IDs so we don't duplicate
  const existingIds = new Set(latestAlertsRef.current.map((a) => a.id));
  // Also check Supabase for IDs the user has already seen / dismissed
  let seenFromDb = new Set<string>();
  if (supabaseUser) {
    const { data } = await supabase
      .from("alerts")
      .select("alert_id")
      .eq("user_id", supabaseUser.id)
      .like("alert_id", "trade-%");
    (data ?? []).forEach((row: any) => seenFromDb.add(row.alert_id));
  }

  const leaguemateOwnerIds = rosters
    .map((r: any) => r.owner_id)
    .filter((uid: string) => uid && uid !== user.user_id);
  if (!leaguemateOwnerIds.length) return;

  const tradeAlerts: AlertsCenterItem[] = [];

  await Promise.all(leaguemateOwnerIds.map(async (ownerId: string) => {
    const ownerName = users[ownerId] || "Leaguemate";
    try {
      const leaguesRes = await fetch(
        `https://api.sleeper.app/v1/user/${ownerId}/leagues/nfl/${CURRENT_YEAR}`
      );
      const ownerLeagues = await leaguesRes.json();
      if (!Array.isArray(ownerLeagues)) return;

      const dynastyLeagues = ownerLeagues.filter((league: any) =>
        ((league.settings?.taxi_slots ?? 0) > 0 || (league.roster_positions?.length ?? 0) > 20) &&
        (league.settings?.best_ball ?? 0) === 0
      );

      await Promise.all(dynastyLeagues.map(async (league: any) => {
        try {
          // Fetch rosters + recent transactions (weeks 0-2 cover all offseason activity) + drafts for slot resolution
          const [leagueRosters, txn0, txn1, txn2, draftsData] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`)
              .then((r) => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/0`)
              .then((r) => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/1`)
              .then((r) => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/2`)
              .then((r) => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`)
              .then((r) => r.json()).catch(() => []),
          ]);

          const ownerRoster = (Array.isArray(leagueRosters) ? leagueRosters : [])
            .find((r: any) => String(r.owner_id) === ownerId);
          if (!ownerRoster) return;

          // Build slot resolver for this league's current-year draft
          const currentDraftForAlert = (Array.isArray(draftsData) ? draftsData : [])
            .find((d: any) => String(d.season) === CURRENT_YEAR);
          const alertDraftOrder: Record<string, number> = currentDraftForAlert?.draft_order ?? {};
          const alertNumTeams: number = (Array.isArray(leagueRosters) ? leagueRosters : []).length || 0;
          const alertRosterToOwner: Record<number, string> = {};
          (Array.isArray(leagueRosters) ? leagueRosters : []).forEach((r: any) => {
            alertRosterToOwner[r.roster_id] = r.owner_id;
          });
          const labelPick = (p: any) => {
            if (String(p.season) === CURRENT_YEAR && currentDraftForAlert) {
              const userId = alertRosterToOwner[p.roster_id];
              const baseSlot = Number(alertDraftOrder[String(userId)] ?? 0);
              const s = getDraftRoundSlot(currentDraftForAlert, Number(p.round), baseSlot, alertNumTeams);
              if (s) return `${p.season} ${p.round}.${String(s).padStart(2, "0")}`;
            }
            return `${p.season} Rd ${p.round}`;
          };

          const allTxns = [
            ...(Array.isArray(txn0) ? txn0 : []),
            ...(Array.isArray(txn1) ? txn1 : []),
            ...(Array.isArray(txn2) ? txn2 : []),
          ];

          const recentTrades = allTxns.filter((t: any) =>
            t.type === "trade" &&
            t.status === "complete" &&
            (t.status_updated || t.created || 0) > fourteenDaysAgo &&
            (t.roster_ids || []).includes(ownerRoster.roster_id)
          );

          recentTrades.forEach((trade: any) => {
            const alertId = `trade-${trade.transaction_id}-${ownerId}`;
            if (existingIds.has(alertId) || seenFromDb.has(alertId)) return;

            // What did this owner receive?
            const acquired = Object.entries(trade.adds || {})
              .filter(([, rid]) => rid === ownerRoster.roster_id)
              .map(([pid]) => players[pid]?.full_name || pid)
              .filter(Boolean);

            // What did this owner send?
            const sent = Object.entries(trade.adds || {})
              .filter(([, rid]) => rid !== ownerRoster.roster_id)
              .map(([pid]) => players[pid]?.full_name || pid)
              .filter(Boolean);
            const picksReceived = (trade.draft_picks || [])
              .filter((p: any) => p.owner_id === ownerRoster.roster_id)
              .map(labelPick);
            const picksSent = (trade.draft_picks || [])
              .filter((p: any) => p.previous_owner_id === ownerRoster.roster_id)
              .map(labelPick);

            if (!acquired.length && !sent.length && !picksReceived.length && !picksSent.length) return;

            const acquiredAll = [...acquired, ...picksReceived];
            const sentAll = [...sent, ...picksSent];

            // skip if truly nothing meaningful (e.g. waiver-budget only)
            if (!acquiredAll.length && !sentAll.length) return;

            const leagueName = league.name || `League`;
            const tradeTs = trade.status_updated || trade.created || Date.now();

            tradeAlerts.push({
              id: alertId,
              category: "league" as const,
              source: "internal" as const,
              severity: "medium" as const,
              title: `${ownerName} made a trade — ${leagueName}`,
              detail: acquiredAll.length
                ? `${ownerName} received ${acquiredAll.join(", ")}${sentAll.length ? `, sent ${sentAll.join(", ")}` : ""} in ${leagueName}.`
                : `${ownerName} sent ${sentAll.join(", ")} in ${leagueName}.`,
              actionable: true,
              timestamp: tradeTs,
              leagueId: league.league_id,
              payload: { ownerId, ownerName, leagueName, acquired: acquiredAll, sent: sentAll },
            });
          });
        } catch (err) {
          console.warn('[loadTradeAlerts] league processing error:', err);
        }
      }));
    } catch (err) {
      console.warn('[loadTradeAlerts] transaction fetch error:', err);
    }
  }));

  if (tradeAlerts.length) {
    mergeDashboardAlerts(tradeAlerts);
  }
};

const loadActivity = async (leagueId: string) => {
  if (!leagueId) return;
  setLoadingActivity(true);
  try {
    // Fetch the last 6 weeks of transactions in parallel
    const weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    const results = await Promise.all(
      weeks.map(w =>
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${w}`)
          .then(r => r.json())
          .catch(() => [])
      )
    );
    const all = results.flat().filter((t: any) => t && t.status === "complete");
    all.sort((a: any, b: any) => (b.status_updated || b.created || 0) - (a.status_updated || a.created || 0));
    setActivityTransactions(all.slice(0, 150));
  } catch (err) {
    console.error('[loadUserTrades/activity] failed:', err);
  } finally { setLoadingActivity(false); }
};

const loadLeagueOverview = async () => {
  if (!leagues.length || !user) return;
  setLoadingLeagueOverview(true);
  try {
    // Fetch all rosters, traded picks, and drafts for every league in parallel
    const results = await Promise.all(
      leagues.map(async (league: any) => {
        try {
          const [rostersData, tradedPicksData, draftsData, usersData] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).then(r => r.json()),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/traded_picks`).then(r => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`).then(r => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`).then(r => r.json()).catch(() => []),
          ]);
          // Build userId → display_name map for this league
          const leagueUserMap: Record<string, string> = {};
          (usersData || []).forEach((u: any) => {
            leagueUserMap[u.user_id] = u.display_name || u.username || u.metadata?.team_name || `Team`;
          });

          const tempPicks: any[] = [];
          const rosterToUser: Record<string, string> = {};
          rostersData.forEach((r: any) => {
            rosterToUser[String(r.roster_id)] = r.owner_id;
            YEARS.forEach((year) => {
              ROUNDS.forEach((round) => {
                tempPicks.push({
                  season: year,
                  round,
                  roster_id: r.roster_id,
                  owner_id: r.roster_id,
                });
              });
            });
          });

          tradedPicksData.forEach((tp: any) => {
            const match = tempPicks.find(
              (p) => p.season === tp.season && p.round === tp.round && p.roster_id === tp.roster_id
            );
            if (match) match.owner_id = tp.owner_id;
          });

          const currentDraft = draftsData.find((d: any) => d.season === CURRENT_YEAR);
          const order = currentDraft?.draft_order || {};
          const totalDraftTeams = rostersData.length || Number(currentDraft?.settings?.teams) || 0;
          tempPicks.forEach((pick: any) => {
            if (pick.season === CURRENT_YEAR) {
              const userId = rosterToUser[String(pick.roster_id)];
              const baseSlot = Number(order[String(userId)] || 0);
              const slot = getDraftRoundSlot(currentDraft ?? {}, Number(pick.round), baseSlot, totalDraftTeams);
              pick.slot = slot
                ? `${pick.round}.${String(slot).padStart(2, "0")}`
                : `${pick.round}`;
            }
          });

          return { league, rosters: rostersData, picks: tempPicks, userMap: leagueUserMap };
        } catch (err) {
          console.warn('[loadLeagueOverview] league fetch error:', err);
          return null;
        }
      })
    );
    const byLeague: Record<string, any> = {};
    results.filter(Boolean).forEach(({ league, rosters: lr, picks, userMap }: any) => {
      byLeague[league.league_id] = { league, rosters: lr, picks, userMap };
    });
    setLeagueOverviewData(byLeague);
    setLeagueOverviewLoaded(true);
  } catch (err) {
    console.error('[loadLeagueOverview] failed:', err);
  } finally {
    setLoadingLeagueOverview(false);
  }
};

const loadRedraftValues = async () => {
  if (redraftLoaded) return;
  setLoadingRedraft(true);
  try {
    const res = await fetch(
      `https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=2`
    );
    const data = await res.json();
    const vals: Record<string, number> = {};
    data.forEach((entry: any) => {
      const sleeperId = entry.player?.sleeperId;
      if (sleeperId) vals[String(sleeperId)] = entry.value;
    });
    setRedraftValues(vals);
    setRedraftLoaded(true);
  } catch (err) {
    console.error('[loadRedraftValues] failed:', err);
  } finally {
    setLoadingRedraft(false);
  }
};

const savePlayerNote = useCallback(async (playerId: string, note: string) => {
  setPlayerNotes((prev) => {
    const updated = { ...prev, [playerId]: note };
    try { localStorage.setItem("playerNotes_v1", JSON.stringify(updated)); } catch {}
    return updated;
  });
  const sbUser = supabaseUserRef.current;
  if (sbUser) {
    supabase.from("player_notes").upsert(
      { user_id: sbUser.id, player_id: playerId, note, updated_at: new Date().toISOString() },
      { onConflict: "user_id,player_id" }
    ).then(() => {});
  }
}, []); // reads supabaseUser via ref; uses functional setState — no deps needed

// Manual snapshot save — callable from the Data Hub button.
// Builds from the current calcFcValues + players state and upserts to Supabase.
const saveSnapshotNow = async () => {
  if (!supabaseUser) return;
  const snap: Record<string, any> = {};
  Object.entries(calcFcValues as Record<string, number>).forEach(([playerId, value]) => {
    if (value <= 0) return;
    const p = players[playerId];
    if (!p || !["QB", "RB", "WR", "TE"].includes(p.position)) return;
    snap[playerId] = { full_name: p.full_name, value, team: p.team || "" };
  });
  if (Object.keys(snap).length === 0) return; // values not loaded yet
  const recordedAt = new Date().toISOString();
  await supabase
    .from("player_value_snapshots")
    .upsert(
      { user_id: supabaseUser.id, snapshot: snap, recorded_at: recordedAt },
      { onConflict: "user_id" }
    );
  const newSnap = { players: snap, recorded_at: recordedAt };
  historicalSnapshotRef.current = newSnap;
  setHistoricalSnapshot(newSnap);
};

const savePlayerDisposition = useCallback(async (playerId: string, sell: string, buy: string) => {
  setPlayerDispositions((prev) => {
    const updated = { ...prev, [playerId]: { sell, buy } };
    try { localStorage.setItem("playerDispositions_v1", JSON.stringify(updated)); } catch {}
    return updated;
  });
  const sbUser = supabaseUserRef.current;
  if (sbUser) {
    supabase.from("player_dispositions").upsert(
      { user_id: sbUser.id, player_id: playerId, sell, buy, updated_at: new Date().toISOString() },
      { onConflict: "user_id,player_id" }
    ).then(() => {});
  }
}, []); // reads supabaseUser via ref; uses functional setState — no deps needed

// Toggle a per-league player tag. Cycling: untagged → CORE → WANT_TO_TRADE → untagged.
// Passing a specific tag forces that tag (or removes it if already set).
const handleToggleLeaguePlayerTag = useCallback((
  leagueId: string,
  playerId: string,
  forceTag?: "CORE" | "WANT_TO_TRADE"
) => {
  const sbUser = supabaseUserRef.current;
  setLeaguePlayerTags((prev) => {
    const leagueTags = prev[leagueId] ?? {};
    const current = leagueTags[playerId];
    let next: "CORE" | "WANT_TO_TRADE" | undefined;
    if (forceTag !== undefined) {
      next = current === forceTag ? undefined : forceTag;
    } else {
      next = current === undefined ? "CORE" : current === "CORE" ? "WANT_TO_TRADE" : undefined;
    }
    const updatedLeague = { ...leagueTags };
    if (next === undefined) delete updatedLeague[playerId];
    else updatedLeague[playerId] = next;
    const updated = { ...prev, [leagueId]: updatedLeague };
    try { localStorage.setItem("leaguePlayerTags_v1", JSON.stringify(updated)); } catch {}
    // Supabase sync
    if (sbUser) {
      if (next === undefined) {
        supabase.from("league_player_tags").delete()
          .eq("user_id", sbUser.id).eq("league_id", leagueId).eq("player_id", playerId)
          .then(() => {});
      } else {
        supabase.from("league_player_tags")
          .upsert({ user_id: sbUser.id, league_id: leagueId, player_id: playerId, tag: next },
                  { onConflict: "user_id,league_id,player_id" })
          .then(() => {});
      }
    }
    return updated;
  });
}, []);


const loadTradeAttempts = async (leagueId: string) => {
  if (!supabaseUser) return;
  setLoadingTradeAttempts(true);
  setTradeAttemptsLeagueId(leagueId);
  try {
    const { data, error } = await supabase
      .from("trade_attempts")
      .select("*")
      .eq("user_id", supabaseUser.id)
      .eq("league_id", leagueId)
      .order("attempted_at", { ascending: false });
    if (!error && data) setTradeAttempts(data as TradeAttempt[]);
  } finally {
    setLoadingTradeAttempts(false);
  }
};

const markTradeAttempted = async (attempt: Omit<TradeAttempt, "id" | "user_id" | "attempted_at" | "resolved_at">) => {
  if (!supabaseUser) return;
  const { data, error } = await supabase
    .from("trade_attempts")
    .insert({ ...attempt, user_id: supabaseUser.id })
    .select()
    .single();
  if (!error && data) {
    setTradeAttempts((prev) => [data as TradeAttempt, ...prev]);
    setAllTradeAttempts((prev) => [{ id: (data as TradeAttempt).id, league_id: (data as TradeAttempt).league_id, status: (data as TradeAttempt).status } as TradeAttempt, ...prev]);
  }
};

const updateAttemptStatus = async (id: string, status: TradeAttemptStatus, counterDetails?: string) => {
  if (!supabaseUser) return;
  const update: Record<string, unknown> = {
    status,
    resolved_at: status !== "PENDING" ? new Date().toISOString() : null,
  };
  if (counterDetails !== undefined) update.counter_details = counterDetails;
  const { error } = await supabase
    .from("trade_attempts")
    .update(update)
    .eq("id", id)
    .eq("user_id", supabaseUser.id);
  if (!error) {
    setTradeAttempts((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, status, counter_details: counterDetails ?? a.counter_details, resolved_at: update.resolved_at as string | null }
          : a
      )
    );
    setAllTradeAttempts((prev) =>
      prev.map((a) => a.id === id ? { ...a, status } : a)
    );
  }
};

const deleteAttempt = async (id: string) => {
  if (!supabaseUser) return;
  const { error } = await supabase
    .from("trade_attempts")
    .delete()
    .eq("id", id)
    .eq("user_id", supabaseUser.id);
  if (!error) {
    setTradeAttempts((prev) => prev.filter((a) => a.id !== id));
    setAllTradeAttempts((prev) => prev.filter((a) => a.id !== id));
  }
};

  // -------------------------
  // PLAYER LOGIC
  // -------------------------
  const getPlayerRole = (id: string) => {
    if (roster?.starters?.includes(id)) return "starter";
    if (roster?.taxi?.includes(id)) return "taxi";
    return "bench";
  };

  const groupPlayers = () => {
    if (!roster || !players) return {};
    const grouped: any = { QB: [], RB: [], WR: [], TE: [] };

    roster.players?.forEach((id: string) => {
      const p = players[id];
      if (!p) return;

      grouped[p.position]?.push({
        ...p,
        role: getPlayerRole(id),
      });
    });

    Object.keys(grouped).forEach((pos) => {
      grouped[pos].sort(
        (a: any, b: any) =>
          ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]
      );
    });

    return grouped;
  };

  const grouped = useMemo(() => groupPlayers(), [roster, players]);

  const filteredPlayers = useMemo(() =>
    (grouped[activeTab] || [])
      .filter((p: any) => p.full_name?.toLowerCase().includes(search.toLowerCase()))
      .sort((a: any, b: any) => {
        const roleDiff = ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
        if (roleDiff !== 0) return roleDiff;
        return (b.value || 0) - (a.value || 0);
      }),
    [grouped, activeTab, search]
  );

const getTeamSummary = () => {
  if (!roster || !players) return null;

  const summary: any = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    TAXI: roster?.taxi?.length || 0,
  };

  roster.players?.forEach((id: string) => {
    const p = players[id];
    if (!p) return;

    if (summary[p.position] !== undefined) {
      summary[p.position]++;
    }
  });

  const pickSummary = YEARS.reduce((acc: Record<string, number>, year) => {
    acc[year] = 0;
    return acc;
  }, {});

  picks.forEach((p: any) => {
    if (pickSummary[p.season] !== undefined) {
      pickSummary[p.season]++;
    }
  });

  return { summary, pickSummary };
};

  const teamSummary = useMemo(() => getTeamSummary(), [roster, players, picks]);
  const gamedayWeek = useMemo(() => {
    const rawWeek = Number(nflState?.week || 0);
    return nflState?.season_type === "regular" && rawWeek > 0 ? rawWeek : 0;
  }, [nflState?.week, nflState?.season_type]);
  const gamedayMatchupCards = useMemo((): GamedayMatchup[] => {
    if (!selectedLeague || !rosters.length || !gamedayWeek) return [];

    const starterSlots = (selectedLeague?.roster_positions || []).filter(
      (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
    );
    const rosterMap = new Map(rosters.map((entry: any) => [Number(entry.roster_id), entry]));
    const projectionByPlayerId = new Map(
      projectionData.map((row: any) => [String(row.sleeperId), row])
    );
    const matchupMap = new Map<number, any[]>();

    gamedayMatchups.forEach((entry: any) => {
      const matchupId = Number(entry?.matchup_id || 0);
      if (!matchupId) return;
      if (!matchupMap.has(matchupId)) matchupMap.set(matchupId, []);
      matchupMap.get(matchupId)?.push(entry);
    });

    const buildTeamView = (entry: any) => {
      const rosterId = Number(entry?.roster_id || 0);
      const rosterEntry = rosterMap.get(rosterId);
      const starterIds = Array.isArray(entry?.starters) && entry.starters.length > 0
        ? entry.starters.map((id: any) => String(id || ""))
        : (rosterEntry?.starters || []).map((id: any) => String(id || ""));
      const playerPoints = entry?.players_points || {};
      const starterRows = starterSlots.map((slot: string, index: number) => {
        const playerId = starterIds[index] ? String(starterIds[index]) : "";
        const player = playerId ? players[playerId] : null;
        const projection = playerId ? projectionByPlayerId.get(playerId) : null;
        const kickoffAt = getProjectionKickoffAt(projection);
        const actualPoints = Number(playerId ? playerPoints[playerId] ?? entry?.starters_points?.[index] ?? 0 : 0);
        const gameState = getKickoffState(kickoffAt);
        const remainingProjection = gameState === "Upcoming"
          ? Number(projection?.fpts || 0)
          : gameState === "Live"
          ? Math.max(Number(projection?.fpts || 0) - actualPoints, 0)
          : 0;

        return {
          slot,
          playerId,
          player,
          actualPoints,
          remainingProjection,
          kickoffAt,
          kickoffLabel: formatKickoffTime(kickoffAt),
          gameState,
        };
      });

      const starterIdSet = new Set(starterRows.map((row: any) => row.playerId).filter(Boolean));
      const taxiIdSet = new Set((rosterEntry?.taxi || []).map((id: any) => String(id)));
      const buildReserveRow = (playerId: string) => {
        const player = players[playerId];
        const projection = projectionByPlayerId.get(String(playerId));
        const kickoffAt = getProjectionKickoffAt(projection);
        const actualPoints = Number(playerPoints[playerId] ?? 0);
        const gameState = getKickoffState(kickoffAt);
        const remainingProjection = gameState === "Upcoming"
          ? Number(projection?.fpts || 0)
          : gameState === "Live"
          ? Math.max(Number(projection?.fpts || 0) - actualPoints, 0)
          : 0;
        return {
          playerId,
          player,
          actualPoints,
          remainingProjection,
          kickoffAt,
          kickoffLabel: formatKickoffTime(kickoffAt),
          gameState,
        };
      };

      const benchRows = (rosterEntry?.players || [])
        .map((id: any) => String(id))
        .filter((playerId: string) => !starterIdSet.has(playerId) && !taxiIdSet.has(playerId))
        .map(buildReserveRow)
        .filter((row: any) => row.player)
        .sort((a: any, b: any) => (b.remainingProjection + b.actualPoints) - (a.remainingProjection + a.actualPoints));

      const taxiRows = (rosterEntry?.taxi || [])
        .map((id: any) => String(id))
        .map(buildReserveRow)
        .filter((row: any) => row.player)
        .sort((a: any, b: any) => (b.remainingProjection + b.actualPoints) - (a.remainingProjection + a.actualPoints));

      return {
        rosterId,
        ownerId: rosterEntry?.owner_id,
        ownerName: users[rosterEntry?.owner_id] || users[rosterId] || `Team ${rosterId}`,
        actualPoints: Number(entry?.points || 0),
        remainingProjection: Math.round(sum(starterRows.map((row: any) => row.remainingProjection)) * 10) / 10,
        projectedFinal: Math.round((Number(entry?.points || 0) + sum(starterRows.map((row: any) => row.remainingProjection))) * 10) / 10,
        finishedStarters: starterRows.filter((row: any) => row.gameState === "Final" && row.playerId).length,
        liveStarters: starterRows.filter((row: any) => row.gameState === "Live" && row.playerId).length,
        upcomingStarters: starterRows.filter((row: any) => row.gameState === "Upcoming" && row.playerId).length,
        totalStarters: starterRows.filter((row: any) => row.playerId).length,
        starterRows,
        benchRows,
        taxiRows,
      };
    };

    return [...matchupMap.entries()]
      .map(([matchupId, entries]) => {
        const teams = entries
          .map((entry) => buildTeamView(entry))
          .sort((a: any, b: any) => b.actualPoints - a.actualPoints);
        const sortKickoff = teams
          .flatMap((team: any) => team.starterRows.map((row: any) => row.kickoffAt).filter(Boolean))
          .sort((a: number, b: number) => a - b)[0] || Number.MAX_SAFE_INTEGER;

        return {
          matchupId,
          teams: teams as GamedayTeamView[],
          sortKickoff,
        };
      })
      .sort((a, b) => {
        if (a.sortKickoff !== b.sortKickoff) return a.sortKickoff - b.sortKickoff;
        return a.matchupId - b.matchupId;
      });
  }, [selectedLeague?.league_id, selectedLeague?.roster_positions, rosters, gamedayMatchups, gamedayWeek, players, projectionData, users]);
  const selectedGamedayMatchup = useMemo(
    () => gamedayMatchupCards.find((card: any) => card.matchupId === selectedGamedayMatchupId) || gamedayMatchupCards[0] || null,
    [gamedayMatchupCards, selectedGamedayMatchupId]
  );
  useEffect(() => {
    if (!gamedayMatchupCards.length) {
      setSelectedGamedayMatchupId(null);
      return;
    }
    if (!gamedayMatchupCards.some((card: any) => card.matchupId === selectedGamedayMatchupId)) {
      setSelectedGamedayMatchupId(gamedayMatchupCards[0].matchupId);
    }
  }, [gamedayMatchupCards, selectedGamedayMatchupId]);
  const selectedLeagueDirection = useMemo((): RosterDirectionProfile | null => {
    if (!selectedLeague || !rosters.length || !user?.user_id) return null;
    const myRosterId = rosters.find((r: any) => r.owner_id === user.user_id)?.roster_id;
    if (!myRosterId) return null;

    // Guard: allPicks updates after rosters on league switch — if any picks exist but none
    // belong to the current league's rosters, data is mid-update; return null and wait.
    const leagueRosterIds = new Set(rosters.map((r: any) => Number(r.roster_id)));
    if (allPicks.length > 0 && !allPicks.some((p: any) => leagueRosterIds.has(Number(p.roster_id)))) return null;

    // Guard: both value maps must be loaded before profile is meaningful.
    // An empty map produces nonsense direction output — redraftValues drives the
    // redraft-rank half of the bucket; calcFcValues drives the dynasty-rank half.
    if (!Object.keys(calcFcValues).length) return null;
    if (!Object.keys(redraftValues).length) return null;

    return getRosterDirectionProfile({
      rosterId: myRosterId,
      rosters,
      ownedPicks: allPicks,
      players,
      pickValues: pickFcValues,
      redraftValues,
      dynastyValueForPlayer: (id: string) => calcFcValues[id] ?? players[id]?.value ?? 0,
    });
  }, [selectedLeague?.league_id, rosters, allPicks, players, pickFcValues, redraftValues, calcFcValues, user?.user_id]);
  const selectedLeagueSimulation = useMemo((): LeagueSimulation | null => {
    if (!selectedLeague || !rosters.length) return null;

    const leagueId = selectedLeague.league_id;
    const nflWeek = Number(nflState?.week || 0);
    const isRegularSeason = nflState?.season_type === "regular" && nflWeek > 0;
    const currentWeek = isRegularSeason ? nflWeek : 0;
    const simulationMode = (currentWeek > 0 ? "in_season" : "offseason") as "in_season" | "offseason";
    const regularSeasonWeeks = Math.max(1, Number(selectedLeague?.settings?.playoff_week_start || 15) - 1);
    const playoffTeams = Number(selectedLeague?.settings?.playoff_teams || Math.ceil(rosters.length / 2));
    const byeTeams = playoffTeams >= 6 ? 2 : playoffTeams === 5 ? 1 : 0;
    const simCount = simulationMode === "offseason" ? 350 : 250;
    const weeklyHistory = (leagueWeeklyMatchups[leagueId] || []) as Array<{ week: number; matchups: any[] }>;
    const projectionMap = new Map(
      ((projectionWeek === 0 || projectionWeek === currentWeek) ? projectionData : []).map((row: any) => [String(row.sleeperId), Number(row.fpts || 0)])
    );
    const lineupSlots = (selectedLeague?.roster_positions || []).filter(
      (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
    );
    const weeksPlayed = currentWeek > 0
      ? weeklyHistory.filter((week) => week.week < currentWeek).length
      : 0;
    const projectionIsSeason = projectionWeek === 0;

    const scorePlayer = (playerId: string) => {
      const projected = projectionMap.get(String(playerId));
      if (typeof projected === "number" && projected > 0) return projected;
      return (redraftValues[playerId] ?? 0) / 250;
    };

    const buildLineupStrength = (rosterEntry: any) => {
      const available = (rosterEntry?.players || [])
        .map((id: string) => players[id])
        .filter((player: any) => player && ["QB", "RB", "WR", "TE"].includes(player.position))
        .map((player: any) => ({
          ...player,
          score: scorePlayer(player.player_id),
        }))
        .sort((a: any, b: any) => b.score - a.score);

      const used = new Set<string>();
      const lineup: any[] = [];
      const claimBest = (eligible: string[], slot: string) => {
        const next = available.find((player: any) => !used.has(player.player_id) && eligible.includes(player.position));
        if (!next) {
          lineup.push({ slot, player: null, score: 0 });
          return;
        }
        used.add(next.player_id);
        lineup.push({ slot, player: next, score: next.score });
      };

      lineupSlots.forEach((slot: string) => {
        if (slot === "FLEX") return claimBest(["RB", "WR", "TE"], slot);
        if (slot === "SUPER_FLEX") return claimBest(["QB", "RB", "WR", "TE"], slot);
        return claimBest([slot], slot);
      });

      const bench = available.filter((player: any) => !used.has(player.player_id));
      const rawLineupScore = sum(lineup.map((slot) => slot.score || 0));
      const rawBenchDepth = sum(bench.slice(0, 5).map((player: any) => player.score || 0));
      const weeklyLineupScore = rawLineupScore / (projectionIsSeason ? regularSeasonWeeks : 1);
      const weeklyBenchDepth = rawBenchDepth / (projectionIsSeason ? regularSeasonWeeks : 1);
      const seasonProjection = projectionIsSeason
        ? rawLineupScore
        : Number(rosterEntry?.settings?.fpts_max || 0) + (Math.max(regularSeasonWeeks - Math.max(currentWeek - 1, 0), 0) * rawLineupScore);

      // ── Player-level boom/bust volatility multiplier ───────────────────────
      // Aggregates per-player variance signals across the starting lineup to
      // produce a team-level stdDev multiplier. Two signals are used:
      //
      //  1. Dynasty-to-redraft value ratio — a player with dynasty >> redraft is
      //     an upside/youth asset (volatile). A veteran whose redraft ≈ dynasty is
      //     a consistent floor producer. Captures boom-bust BEFORE the season starts.
      //
      //  2. In-season target/carry share (from playerStats, if available) —
      //     primary signal once the season is underway. A WR with 9 tgt/game in
      //     his current role reads consistent regardless of career history.
      //     Automatically adapts to new environments, OC changes, role shifts, etc.
      //
      // The multiplier is clamped to [0.75, 1.35] to prevent extreme values.
      // Once the historical calibration block accumulates 6+ weeks of real scores,
      // it replaces this stdDev entirely — so this primarily matters early season
      // and offseason when no observed variance is yet available.
      const startingPlayers = lineup.filter((s: any) => s.player).map((s: any) => s.player);
      const teamVolatilityMultiplier = (() => {
        if (startingPlayers.length === 0) return 1.0;
        const posBase: Record<string, number> = { QB: 0.75, RB: 0.88, WR: 1.05, TE: 0.90 };
        let wVolSum = 0;
        let wSum = 0;
        startingPlayers.forEach((player: any) => {
          const dynVal = calcFcValues[player.player_id] ?? players[player.player_id]?.value ?? 0;
          const redVal = redraftValues[player.player_id] ?? 0;
          const base = posBase[player.position] ?? 1.0;

          // Ratio signal: dynasty >> redraft → upside/youth → boom-bust
          const ratio = redVal > 100 ? dynVal / redVal : 1.0;
          const ratioMod = ratio > 2.5 ? 1.22 : ratio > 1.8 ? 1.12 : ratio > 1.3 ? 1.05 : ratio < 0.7 ? 0.90 : 1.0;

          // Usage signal: high volume = consistent floor, low volume = boom-bust
          // Reads from current-season playerStats so it reflects actual current role
          const stats = playerStats?.[player.player_id];
          let usageMod = 1.0;
          if (stats && (stats.gamesPlayed ?? 0) >= 2) {
            const pos = player.position;
            if (pos === "WR" || pos === "TE") {
              const tgt = stats.avgTargets ?? 0;
              usageMod = tgt >= 8 ? 0.87 : tgt >= 5 ? 0.94 : tgt >= 3 ? 1.05 : 1.18;
            } else if (pos === "RB") {
              const touch = (stats.avgCarries ?? 0) + (stats.avgTargets ?? 0);
              usageMod = touch >= 15 ? 0.82 : touch >= 10 ? 0.91 : touch >= 6 ? 1.0 : 1.14;
            }
          }

          const vol = base * ratioMod * usageMod;
          const weight = Math.max(dynVal, 200); // weight by dynasty value; floor prevents zeros
          wVolSum += vol * weight;
          wSum += weight;
        });
        const raw = wSum > 0 ? wVolSum / wSum : 1.0;
        return Math.max(0.75, Math.min(1.35, raw));
      })();

      return {
        lineupScore: weeklyLineupScore,
        benchDepth: weeklyBenchDepth,
        projectedMaxPf: Math.round(seasonProjection * 10) / 10,
        powerScore: Math.round((weeklyLineupScore + weeklyBenchDepth * 0.35) * 10) / 10,
        weeklyStdDev: Math.max(8, (weeklyLineupScore * 0.16 + weeklyBenchDepth * 0.08) * teamVolatilityMultiplier),
      };
    };

    const rows: any[] = rosters.map((rosterEntry: any) => {
      const strength = buildLineupStrength(rosterEntry);
      const standing = standings.find((entry: any) => Number(entry.roster_id) === Number(rosterEntry.roster_id));
      const ownerName = users[rosterEntry.owner_id] || `Team ${rosterEntry.roster_id}`;
      return {
        rosterId: Number(rosterEntry.roster_id),
        ownerId: rosterEntry.owner_id,
        ownerName,
        actualWins: Number(standing?.wins || rosterEntry.settings?.wins || 0),
        actualLosses: Number(standing?.losses || rosterEntry.settings?.losses || 0),
        pointsFor: Number(standing?.fpts || rosterEntry.settings?.fpts || 0),
        maxPf: Number(standing?.max_pf || rosterEntry.settings?.fpts_max || 0),
        ...strength,
      };
    });

    const rowByRosterId = new Map(rows.map((row) => [row.rosterId, row]));
    const rosterIds = rows.map((row) => row.rosterId).sort((a, b) => a - b);
    const generatedSchedule = buildRoundRobinSchedule(rosterIds, regularSeasonWeeks);
    const actualScheduleByWeek = new Map<number, Array<[number, number]>>();
    weeklyHistory.forEach((week) => {
      const grouped = new Map<number, number[]>();
      (week.matchups || [])
        .filter((entry: any) => entry?.matchup_id && entry?.roster_id)
        .forEach((entry: any) => {
          const matchupId = Number(entry.matchup_id);
          if (!grouped.has(matchupId)) grouped.set(matchupId, []);
          grouped.get(matchupId)?.push(Number(entry.roster_id));
        });
      const pairs = [...grouped.values()]
        .filter((pair) => pair.length === 2)
        .map((pair) => [pair[0], pair[1]] as [number, number]);
      if (pairs.length > 0) actualScheduleByWeek.set(Number(week.week), pairs);
    });

    const scheduleByWeek = Array.from({ length: regularSeasonWeeks }, (_, idx) => {
      const week = idx + 1;
      const actualPairs = actualScheduleByWeek.get(week) || [];
      return {
        week,
        source: actualPairs.length > 0 ? "scheduled" : "generated",
        pairs: actualPairs.length > 0 ? actualPairs : generatedSchedule[idx] || [],
      };
    });

    // ── Historical scoring calibration ────────────────────────────────────────
    // Three upgrades over the baseline projection-only model:
    //
    //  1. Blend actual recent average into lineupScore — corrects for rosters that
    //     systematically over/under-perform their projections (injuries, breakouts).
    //     Recent weeks (last 4) are weighted 2× to capture current roster health.
    //
    //  2. Replace the fixed-formula weeklyStdDev with observed score variance —
    //     some teams are consistent, others boom/bust; actual history knows which.
    //
    //  3. Calibrate score floor to the league's real 10th-percentile weekly score
    //     instead of the hardcoded 40 pts.
    //
    // All three gracefully fall back to the existing formula when in-season data
    // is unavailable (offseason / fewer than 2 weeks played).

    const teamActualScores = new Map<number, number[]>();
    if (currentWeek > 0) {
      weeklyHistory
        .filter((w) => w.week < currentWeek)
        .forEach((w) => {
          (w.matchups || []).forEach((entry: any) => {
            const pts = Number(entry?.points ?? 0);
            if (!entry?.roster_id || pts === 0) return;
            const rid = Number(entry.roster_id);
            if (!teamActualScores.has(rid)) teamActualScores.set(rid, []);
            teamActualScores.get(rid)!.push(pts);
          });
        });

      // rowByRosterId holds references to the same row objects — mutating them here
      // propagates automatically into the map, so playMatch sees the updated values.
      rows.forEach((row) => {
        const scores = teamActualScores.get(row.rosterId);
        if (!scores || scores.length < 2) return;

        // Weight last 4 weeks 2× to reflect recent roster health / usage trends
        const recentN = Math.min(4, scores.length);
        const weights = scores.map((_, i) => (i >= scores.length - recentN ? 2 : 1));
        const totalWeight = weights.reduce((s, w) => s + w, 0);
        const weightedMean = scores.reduce((s, v, i) => s + v * weights[i], 0) / totalWeight;
        const wVariance = scores.reduce((s, v, i) => s + weights[i] * (v - weightedMean) ** 2, 0) / totalWeight;
        const historicalStdDev = Math.max(6, Math.sqrt(wVariance));

        // Blend actual average into lineupScore (rises 40%→65% as sample grows).
        // Keeps projections dominant early, defers to reality as the season matures.
        if (scores.length >= 4) {
          const histWeight = Math.min(0.65, 0.40 + (scores.length - 4) * 0.0625);
          row.lineupScore = row.lineupScore * (1 - histWeight) + weightedMean * histWeight;
        }

        // Replace formula stdDev with observed variance; blend conservatively for small samples.
        // 3 weeks → 25% historical, 4 → 50%, 5 → 75%, 6+ → 100% historical.
        const formulaStdDev = row.weeklyStdDev;
        if (scores.length >= 6) {
          row.weeklyStdDev = historicalStdDev;
        } else if (scores.length >= 3) {
          const blend = (scores.length - 2) / 4;
          row.weeklyStdDev = formulaStdDev * (1 - blend) + historicalStdDev * blend;
        }

        // Recalculate powerScore so rankings reflect the updated lineupScore
        row.powerScore = Math.round((row.lineupScore + row.benchDepth * 0.35) * 10) / 10;
      });
    }

    // Score floor: league 10th-percentile actual score replaces the hardcoded 40.
    // Prevents the sim from generating scores that no team in this league actually hits.
    let scoreFloor = 40;
    if (currentWeek > 0) {
      const allActual = [...teamActualScores.values()].flat().sort((a, b) => a - b);
      if (allActual.length >= 10) {
        scoreFloor = Math.max(30, Math.round(allActual[Math.floor(allActual.length * 0.10)]));
      }
    }

    const playMatch = (aRosterId: number, bRosterId: number, rng: () => number) => {
      const aRow = rowByRosterId.get(aRosterId);
      const bRow = rowByRosterId.get(bRosterId);
      if (!aRow || !bRow) return { winner: aRosterId, loser: bRosterId, aPoints: 0, bPoints: 0 };
      const aPoints = Math.max(scoreFloor, aRow.lineupScore + randomNormal(rng) * aRow.weeklyStdDev);
      const bPoints = Math.max(scoreFloor, bRow.lineupScore + randomNormal(rng) * bRow.weeklyStdDev);
      if (aPoints === bPoints) {
        return rng() < 0.5
          ? { winner: aRosterId, loser: bRosterId, aPoints, bPoints }
          : { winner: bRosterId, loser: aRosterId, aPoints, bPoints };
      }
      return aPoints > bPoints
        ? { winner: aRosterId, loser: bRosterId, aPoints, bPoints }
        : { winner: bRosterId, loser: aRosterId, aPoints, bPoints };
    };

    const seededIndex = (seededIds: number[], rosterId: number) => seededIds.indexOf(rosterId);
    const simulatePlayoffs = (seededIds: number[], rng: () => number) => {
      if (seededIds.length === 0) return null;
      if (seededIds.length === 1) return seededIds[0];

      let roundTeams = [...seededIds];
      if (byeTeams > 0 && roundTeams.length > byeTeams) {
        const byes = roundTeams.slice(0, byeTeams);
        const openingRound = roundTeams.slice(byeTeams);
        const winners: number[] = [];
        while (openingRound.length >= 2) {
          const high = openingRound.shift()!;
          const low = openingRound.pop()!;
          winners.push(playMatch(high, low, rng).winner);
        }
        roundTeams = [...byes, ...winners].sort((a, b) => seededIndex(seededIds, a) - seededIndex(seededIds, b));
      }

      while (roundTeams.length > 1) {
        const roundSeeds = [...roundTeams].sort((a, b) => seededIndex(seededIds, a) - seededIndex(seededIds, b));
        const winners: number[] = [];
        while (roundSeeds.length >= 2) {
          const high = roundSeeds.shift()!;
          const low = roundSeeds.pop()!;
          winners.push(playMatch(high, low, rng).winner);
        }
        roundTeams = winners.sort((a, b) => seededIndex(seededIds, a) - seededIndex(seededIds, b));
      }
      return roundTeams[0];
    };

    rows.forEach((row) => {
      const others = rows.filter((other) => other.rosterId !== row.rosterId);
      row.avgWinProb = others.length
        ? average(others.map((other) => logisticWinProb(row.powerScore, other.powerScore, 14) * 100)) / 100
        : 0.5;
      row.currentWeekWinProb = row.avgWinProb;
      row.currentOpponent = null;
      row.allPlayWins = 0;
      row.allPlayLosses = 0;
      row.upcomingSchedule = [] as any[];
    });

    if (currentWeek > 0) {
      weeklyHistory
        .filter((week) => week.week < currentWeek)
        .forEach((week) => {
          const scored = (week.matchups || []).filter((matchup: any) => matchup?.roster_id);
          scored.forEach((entry: any) => {
            const row = rowByRosterId.get(Number(entry.roster_id));
            if (!row) return;
            const wins = scored.filter((other: any) => Number(other.roster_id) !== Number(entry.roster_id) && Number(entry.points || 0) > Number(other.points || 0)).length;
            const losses = scored.filter((other: any) => Number(other.roster_id) !== Number(entry.roster_id) && Number(entry.points || 0) < Number(other.points || 0)).length;
            row.allPlayWins += wins;
            row.allPlayLosses += losses;
          });
        });
    }

    const displayWeeks = scheduleByWeek
      .filter((week) => week.week >= (currentWeek || 1))
      .slice(0, 4)
      .map((week) => {
        const matchups = week.pairs.map(([aRosterId, bRosterId]) => {
          const aRow = rowByRosterId.get(aRosterId);
          const bRow = rowByRosterId.get(bRosterId);
          if (!aRow || !bRow) return null;
          const aProb = logisticWinProb(aRow.powerScore, bRow.powerScore, 14);
          const bProb = 1 - aProb;
          const matchup = {
            week: week.week,
            source: week.source,
            aRosterId,
            aName: aRow.ownerName,
            aWinProb: aProb,
            aProjected: Math.round(aRow.lineupScore * 10) / 10,
            bRosterId,
            bName: bRow.ownerName,
            bWinProb: bProb,
            bProjected: Math.round(bRow.lineupScore * 10) / 10,
          };
          aRow.upcomingSchedule.push({
            week: week.week,
            opponentRosterId: bRosterId,
            opponentName: bRow.ownerName,
            winProb: aProb,
            projectedPoints: matchup.aProjected,
            source: week.source,
          });
          bRow.upcomingSchedule.push({
            week: week.week,
            opponentRosterId: aRosterId,
            opponentName: aRow.ownerName,
            winProb: bProb,
            projectedPoints: matchup.bProjected,
            source: week.source,
          });
          if (week.week === currentWeek) {
            aRow.currentWeekWinProb = aProb;
            bRow.currentWeekWinProb = bProb;
            aRow.currentOpponent = bRow.ownerName;
            bRow.currentOpponent = aRow.ownerName;
          }
          return matchup;
        }).filter((m): m is NonNullable<typeof m> => m !== null);
        return { week: week.week, source: week.source, matchups };
      });

    const simulationStats = Object.fromEntries(
      rows.map((row) => [row.rosterId, {
        winsSum: 0,
        finishCounts: Array.from({ length: rosters.length + 1 }, () => 0),
        slotCounts: Array.from({ length: rosters.length + 1 }, () => 0),
        playoffCount: 0,
        byeCount: 0,
        titleCount: 0,
      }])
    ) as Record<number, any>;

    const leagueSeed = String(leagueId).split("").reduce((acc, char, idx) => acc + char.charCodeAt(0) * (idx + 1), 0) + simSalt;
    const simStartWeek = currentWeek > 0 ? currentWeek : 1;
    for (let sim = 0; sim < simCount; sim++) {
      const rng = createSeededRandom(leagueSeed + sim * 7919 + regularSeasonWeeks * 17);
      const winMap = new Map<number, number>(rows.map((row) => [row.rosterId, row.actualWins]));
      const pointMap = new Map<number, number>(rows.map((row) => [row.rosterId, row.pointsFor]));

      scheduleByWeek
        .filter((week) => week.week >= simStartWeek)
        .forEach((week) => {
          week.pairs.forEach(([aRosterId, bRosterId]) => {
            const result = playMatch(aRosterId, bRosterId, rng);
            pointMap.set(aRosterId, (pointMap.get(aRosterId) || 0) + result.aPoints);
            pointMap.set(bRosterId, (pointMap.get(bRosterId) || 0) + result.bPoints);
            winMap.set(result.winner, (winMap.get(result.winner) || 0) + 1);
          });
        });

      const simStandings = rows
        .map((row) => ({
          rosterId: row.rosterId,
          wins: winMap.get(row.rosterId) || 0,
          points: pointMap.get(row.rosterId) || 0,
          powerScore: row.powerScore,
          projectedMaxPf: row.projectedMaxPf,
        }))
        .sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.points !== a.points) return b.points - a.points;
          if (b.powerScore !== a.powerScore) return b.powerScore - a.powerScore;
          return b.projectedMaxPf - a.projectedMaxPf;
        });

      const seededIds = simStandings.map((entry) => entry.rosterId);
      seededIds.forEach((rosterId, index) => {
        const stats = simulationStats[rosterId];
        stats.winsSum += winMap.get(rosterId) || 0;
        stats.finishCounts[index + 1] += 1;
        stats.slotCounts[rosters.length - index] += 1;
      });
      seededIds.slice(0, playoffTeams).forEach((rosterId, index) => {
        simulationStats[rosterId].playoffCount += 1;
        if (index < byeTeams) simulationStats[rosterId].byeCount += 1;
      });
      const championRosterId = simulatePlayoffs(seededIds.slice(0, playoffTeams), rng);
      if (championRosterId != null) simulationStats[championRosterId].titleCount += 1;
    }

    rows.forEach((row) => {
      const stats = simulationStats[row.rosterId];
      const finishCounts = stats.finishCounts as number[];
      const slotCounts = stats.slotCounts as number[];
      const expectedFinish = finishCounts.reduce((total, count, finish) => total + finish * count, 0) / simCount;
      const likelyFinish = finishCounts.reduce((bestIdx, count, idx, arr) => count > arr[bestIdx] ? idx : bestIdx, 1);
      const floorFinish = percentileFromCounts(finishCounts, 0.2);
      const ceilingFinish = percentileFromCounts(finishCounts, 0.8);

      row.expectedWins = Math.round((stats.winsSum / simCount) * 10) / 10;
      row.avgFinish = Math.round(expectedFinish * 10) / 10;
      row.projectedFinish = likelyFinish;
      row.finishRange = `${floorFinish || likelyFinish}-${ceilingFinish || likelyFinish}`;
      row.playoffOdds = Math.round((stats.playoffCount / simCount) * 1000) / 10;
      row.byeOdds = Math.round((stats.byeCount / simCount) * 1000) / 10;
      row.titleOdds = Math.round((stats.titleCount / simCount) * 1000) / 10;
      row.finishProbabilities = finishCounts.map((count) => count / simCount);
      row.slotProbabilities = slotCounts.map((count) => count / simCount);
      row.allPlayExpectedWins = weeksPlayed > 0 ? Math.round((row.allPlayWins / Math.max(rosters.length - 1, 1)) * 10) / 10 : 0;
      row.luckScore = weeksPlayed > 0 ? Math.round((row.actualWins - row.allPlayExpectedWins) * 10) / 10 : 0;
      row.oneOhOneOdds = Math.round(((slotCounts[1] || 0) / simCount) * 1000) / 10;
      row.upcomingSchedule = row.upcomingSchedule.slice(0, 4);
    });

    const ranked = [...rows].sort((a: any, b: any) => {
      if (b.playoffOdds !== a.playoffOdds) return b.playoffOdds - a.playoffOdds;
      if (b.titleOdds !== a.titleOdds) return b.titleOdds - a.titleOdds;
      if (b.expectedWins !== a.expectedWins) return b.expectedWins - a.expectedWins;
      return b.powerScore - a.powerScore;
    });

    return {
      currentWeek,
      simulationMode,
      regularSeasonWeeks,
      playoffTeams,
      byeTeams,
      weeksPlayed,
      simCount,
      rows: ranked,
      weeklyMatchups: displayWeeks,
      rowByRosterId: new Map(ranked.map((row) => [row.rosterId, row])),
    };
  }, [
    selectedLeague?.league_id,
    selectedLeague?.settings?.playoff_week_start,
    selectedLeague?.settings?.playoff_teams,
    selectedLeague?.roster_positions,
    rosters,
    nflState?.week,
    nflState?.season_type,
    projectionData,
    projectionWeek,
    players,
    redraftValues,
    calcFcValues,
    leagueWeeklyMatchups,
    standings,
    users,
    simSalt,
  ]);

  // Combines dynasty rank, redraft rank, simulation playoff odds, and core age into one profile.
  // This is the authoritative direction — use this everywhere instead of raw selectedLeagueDirection.
  // Returns null while waiting for consistent data — consumers must show a loading state.
  const selectedLeagueDirectionAdjusted = useMemo(() => {
    if (!selectedLeagueDirection || !selectedLeague?.league_id) return null;
    const myRosterId = rosters.find((r: any) => r.owner_id === user?.user_id)?.roster_id;
    if (!myRosterId) return null;

    // PRIORITY: use the committed (user-saved) sim — it's what the League Hub displays
    // and is stable across renders. The live sim recomputes with a random seed each session
    // and can diverge significantly (e.g. 1.7% committed → 40% live), causing wrong direction.
    const committedRows = committedSimsByLeague[selectedLeague.league_id];
    const committedMyRow = committedRows ? committedRows[Number(myRosterId)] : null;

    if (committedMyRow) {
      // We have a stable committed sim — use it unconditionally.
      const playoffOdds = Number(committedMyRow.playoffOdds ?? 50);
      const adjustedBucket = getAdjustedDirectionBucket(selectedLeagueDirection.bucket, selectedLeagueDirection, playoffOdds, true);
      return {
        ...selectedLeagueDirection,
        bucket: adjustedBucket,
        bucketColor: getBucketColor(adjustedBucket),
        rawBucket: selectedLeagueDirection.bucket,
        playoffOdds,
        hasSimData: true,
      };
    }

    // No committed sim yet — fall back to the live sim but guard carefully:
    // live sim recomputes every render and may not match the current league yet.
    if (!selectedLeagueSimulation) return null;

    const allCurrentIds = rosters.map((r: any) => Number(r.roster_id));
    const simMatchesLeague = allCurrentIds.every(
      (id) => selectedLeagueSimulation.rowByRosterId?.has(id)
    );
    if (!simMatchesLeague) return null;

    const mySimRow = selectedLeagueSimulation.rowByRosterId.get(Number(myRosterId));
    if (!mySimRow) return null;

    const playoffOdds = Number(mySimRow.playoffOdds);
    const adjustedBucket = getAdjustedDirectionBucket(selectedLeagueDirection.bucket, selectedLeagueDirection, playoffOdds, true);
    return {
      ...selectedLeagueDirection,
      bucket: adjustedBucket,
      bucketColor: getBucketColor(adjustedBucket),
      rawBucket: selectedLeagueDirection.bucket,
      playoffOdds,
      hasSimData: true,
    };
  }, [selectedLeague?.league_id, selectedLeagueDirection, selectedLeagueSimulation, committedSimsByLeague, rosters, user?.user_id]);

  const selectedLeagueDynamicPickValues = useMemo(() => {
    const leagueId = selectedLeague?.league_id;
    if (!leagueId || !selectedLeagueSimulation) return {} as Record<string, any>;
    // Always prefer the live sim for the currently selected league — it's always current.
    // Fall back to the frozen committed snapshot only when the live sim lacks the row
    // (shouldn't happen for the selected league, but keeps the fallback path safe).
    const getProjection = (rosterId: number): SimulationTeamRow | undefined =>
      selectedLeagueSimulation.rowByRosterId.get(rosterId);

    const totalTeams = rosters.length || 12;
    const slots = Array.from({ length: totalTeams }, (_, idx) => idx + 1);

    // Rank-based slot assignment: sort all rosters by their mean expected slot
    // (worst team = lowest mean slot = gets slot 1, best = slot N).
    const rosterRankSlot = (() => {
      const entries = rosters.map((r: any) => {
        const proj = getProjection(Number(r.roster_id));
        const rawSlots = slots.map((slot: number) => proj?.slotProbabilities?.[slot] ?? (1 / totalTeams));
        const slotTotal = sum(rawSlots) || 1;
        const normSlots = rawSlots.map((p: number) => p / slotTotal);
        const meanSlot = normSlots.reduce((t: number, p: number, idx: number) => t + p * (idx + 1), 0);
        return { rosterId: Number(r.roster_id), meanSlot };
      }).sort((a, b) => a.meanSlot - b.meanSlot); // ascending: lowest mean slot = worst team
      return new Map(entries.map((e, idx) => [e.rosterId, idx + 1]));
    })();

    const bucketForSlot = (slot: number) => {
      const earlyCut = Math.ceil(totalTeams / 3);
      const midCut = Math.ceil((totalTeams * 2) / 3);
      if (slot <= earlyCut) return "early";
      if (slot <= midCut) return "mid";
      return "late";
    };
    const currentRoundValue = (round: number) => pickFcValues[`${CURRENT_YEAR}-${round}`] || 0;
    const getBandValue = (season: string, round: number, bucket: "early" | "mid" | "late") => {
      const bucketSlots = slots.filter((slot) => bucketForSlot(slot) === bucket);
      const baseSlots = bucketSlots
        .map((slot) => pickFcValues[`${CURRENT_YEAR}-${round}.${String(slot).padStart(2, "0")}`])
        .filter(Boolean);
      const baseBandValue = baseSlots.length > 0
        ? Math.round(sum(baseSlots as number[]) / baseSlots.length)
        : Math.round((currentRoundValue(round) || 0) * (bucket === "early" ? 1.2 : bucket === "mid" ? 1 : 0.8));
      const seasonRoundValue = pickFcValues[`${season}-${round}`] || currentRoundValue(round) || baseBandValue;
      const currentRoundBase = currentRoundValue(round) || baseBandValue || 1;
      return Math.round(baseBandValue * (seasonRoundValue / currentRoundBase));
    };

    return Object.fromEntries(
      allPicks.map((pick: any) => {
        const key = `${pick.season}-${pick.round}-${pick.roster_id}`;
        const rosterProjection = getProjection(Number(pick.roster_id));
        const fallback = getStoredPickValue(pickFcValues, pick);
        if (!rosterProjection) {
          const midFallback = fallback;
          const floorValue = Math.round(midFallback * 0.85);
          const ceilingValue = Math.round(midFallback * 1.15);
          return [key, {
            bucket: "mid",
            label: "Mid outcome most likely",
            expectedValue: midFallback,
            expectedSlot: Math.round((totalTeams + 1) / 2),
            floorValue,
            ceilingValue,
            probabilities: { early: 0.2, mid: 0.6, late: 0.2 },
            likelySlots: [],
          }];
        }

        if (String(pick.season) === CURRENT_YEAR && String(pick.slot || "").includes(".")) {
          const slot = Number(String(pick.slot).split(".")[1] || 0);
          const bucket = bucketForSlot(slot) as "early" | "mid" | "late";
          const exactValue = getStoredPickValue(pickFcValues, pick);
          return [key, {
            bucket,
            label: `${bucket[0].toUpperCase()}${bucket.slice(1)} slot locked in`,
            expectedValue: exactValue,
            expectedSlot: slot,
            floorValue: exactValue,
            ceilingValue: exactValue,
            probabilities: {
              early: bucket === "early" ? 1 : 0,
              mid: bucket === "mid" ? 1 : 0,
              late: bucket === "late" ? 1 : 0,
            },
            slotProbabilities: slots.map((currentSlot) => currentSlot === slot ? 1 : 0),
            likelySlots: [{ slot, probability: 1 }],
          }];
        }

        const rawSlotProbabilities = slots.map((slot) => rosterProjection.slotProbabilities?.[slot] ?? (1 / totalTeams));
        const slotTotal = sum(rawSlotProbabilities) || 1;
        const slotProbabilities = rawSlotProbabilities.map((probability) => probability / slotTotal);
        const slotValues = slots.map((slot) => {
          const bucket = bucketForSlot(slot) as "early" | "mid" | "late";
          const currentSlotValue = pickFcValues[`${CURRENT_YEAR}-${pick.round}.${String(slot).padStart(2, "0")}`];
          if (currentSlotValue) {
            const seasonRoundValue = pickFcValues[`${pick.season}-${pick.round}`] || currentRoundValue(Number(pick.round)) || 1;
            const currentBase = currentRoundValue(Number(pick.round)) || 1;
            return Math.round((currentSlotValue as number) * (seasonRoundValue / currentBase));
          }
          return getBandValue(String(pick.season), Number(pick.round), bucket);
        });
        const bucketProbabilities = slotProbabilities.reduce((acc: Record<string, number>, probability, idx) => {
          const bucket = bucketForSlot(idx + 1);
          acc[bucket] = (acc[bucket] || 0) + probability;
          return acc;
        }, { early: 0, mid: 0, late: 0 });
        // Rank-based slot: integer 1–N where 1 = worst team in league (picks first).
        const expectedSlot = rosterRankSlot.get(Number(pick.roster_id)) ?? Math.round((totalTeams + 1) / 2);
        // Linear interpolation between the floor and ceiling slot values.
        // FantasyCalc has a huge slot-1 premium that makes raw per-slot values non-linear —
        // users expect slot 2 to be close to the range top, not halfway down. Interpolating
        // gives a fair expected value that scales evenly from worst team (slot 1 = ceiling)
        // to best team (slot N = floor).
        const ceilingValue = Math.max(...slotValues);
        const floorValue = Math.min(...slotValues);
        const expectedValue = totalTeams <= 1
          ? ceilingValue
          : Math.round(ceilingValue - (ceilingValue - floorValue) * (expectedSlot - 1) / (totalTeams - 1));
        const likelySlots = slotProbabilities
          .map((probability, idx) => ({ slot: idx + 1, probability }))
          .sort((a, b) => b.probability - a.probability)
          .slice(0, 3);
        const bestBucket = (Object.entries(bucketProbabilities).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || "mid") as "early" | "mid" | "late";
        // Derive finish range directly from slotProbabilities so it is always
        // consistent with expectedSlot and expectedValue — never stale.
        // slot k+1 is given to the team finishing (totalTeams - k)th, so
        // P(finish j) = slotProbabilities[totalTeams - j] (0-based).
        let cumFinish = 0;
        let floorFinishPos = totalTeams;
        let ceilFinishPos = totalTeams;
        let floorFound = false;
        for (let finishPos = 1; finishPos <= totalTeams; finishPos++) {
          cumFinish += slotProbabilities[totalTeams - finishPos] || 0;
          if (!floorFound && cumFinish >= 0.2) { floorFinishPos = finishPos; floorFound = true; }
          if (cumFinish >= 0.8) { ceilFinishPos = finishPos; break; }
        }
        const derivedFinishRange = `${floorFinishPos}-${ceilFinishPos}`;
        return [key, {
          bucket: bestBucket,
          label: `${bestBucket[0].toUpperCase()}${bestBucket.slice(1)} most likely`,
          expectedValue,
          expectedSlot,
          floorValue: Math.min(...slotValues),
          ceilingValue: Math.max(...slotValues),
          probabilities: {
            early: Math.round((bucketProbabilities.early || 0) * 100) / 100,
            mid: Math.round((bucketProbabilities.mid || 0) * 100) / 100,
            late: Math.round((bucketProbabilities.late || 0) * 100) / 100,
          },
          bandValues: {
            early: getBandValue(String(pick.season), Number(pick.round), "early"),
            mid: getBandValue(String(pick.season), Number(pick.round), "mid"),
            late: getBandValue(String(pick.season), Number(pick.round), "late"),
          },
          slotProbabilities,
          likelySlots,
          projectedFinish: rosterProjection.projectedFinish,
          finishRange: derivedFinishRange,
          issuerName: rosterProjection.ownerName,
          issuerPlayoffOdds: (() => {
            const playoffTeamCount = Number(selectedLeague?.settings?.playoff_teams || Math.ceil(totalTeams / 2));
            return Math.round(slotProbabilities.slice(totalTeams - playoffTeamCount).reduce((s, p) => s + p, 0) * 100);
          })(),
        }];
      })
    ) as Record<string, any>;
  }, [selectedLeague?.league_id, committedSimsByLeague, selectedLeagueSimulation, allPicks, pickFcValues, rosters.length]);
  const selectedLeagueMateProfiles = useMemo((): LeagueMateView[] => {
    if (!selectedLeague || !rosters.length || !user?.user_id) return [];

    const dynastyValueForPlayer = (id: string) => calcFcValues[id] ?? players[id]?.value ?? 0;
    const myRoster = rosters.find((r: any) => r.owner_id === user.user_id);
    if (!myRoster) return [];

    const myProfile = getRosterDirectionProfile({
      rosterId: myRoster.roster_id,
      rosters,
      ownedPicks: allPicks,
      players,
      pickValues: pickFcValues,
      redraftValues,
      dynastyValueForPlayer,
    });

    return rosters
      .filter((r: any) => r.owner_id && r.owner_id !== user.user_id)
      .map((r: any) => {
        const directionProfile = getRosterDirectionProfile({
          rosterId: r.roster_id,
          rosters,
          ownedPicks: allPicks,
          players,
          pickValues: pickFcValues,
          redraftValues,
          dynastyValueForPlayer,
        });
        if (!directionProfile) return null;

        const rosterPlayers = (r.players || [])
          .map((id: string) => {
            const player = players[id];
            return player
              ? {
                  ...player,
                  dynValue: dynastyValueForPlayer(id),
                }
              : null;
          })
          .filter(Boolean)
          .filter((player: any) => ["QB", "RB", "WR", "TE"].includes(player.position));

        const posValueTotals = ["QB", "RB", "WR", "TE"].map((pos) => ({
          pos,
          total: rosterPlayers
            .filter((player: any) => player.position === pos)
            .reduce((sum: number, player: any) => sum + (player.dynValue || 0), 0),
        })).sort((a, b) => b.total - a.total);

        const tradeIntel = leagueMateTradeIntel[String(r.roster_id)] || {
          tradeCount30d: 0,
          bought: { QB: 0, RB: 0, WR: 0, TE: 0 },
          picksIn: 0,
          picksOut: 0,
          lastTradeAt: null,
        };
        const recentBuy = Object.entries(tradeIntel.bought || {}) as Array<[string, number]>;
        const recentBuyTop = [...recentBuy]
          .sort((a: any, b: any) => b[1] - a[1])[0];
        const fit = getTradePartnerFit({
          myProfile,
          oppProfile: directionProfile,
          tradeCount30d: tradeIntel.tradeCount30d,
        });
        const ownerCrossLeagueIntel = crossLeagueMateIntel[String(r.owner_id)] || null;
        const crossLeaguePreferenceFit = getCrossLeaguePreferenceFit({
          myProfile,
          crossLeagueIntel: ownerCrossLeagueIntel,
        });
        const crossLeagueTradeFit = getCrossLeagueTradeBehaviorFit({
          myProfile,
          crossLeagueIntel: ownerCrossLeagueIntel,
        });
        const totalFitScore = fit.fitScore + crossLeaguePreferenceFit.fitScore + crossLeagueTradeFit.fitScore;
        const combinedFitReasons = [
          ...fit.fitReasons,
          ...crossLeaguePreferenceFit.fitReasons,
          ...crossLeagueTradeFit.fitReasons,
        ].slice(0, 4);

        return {
          rosterId: r.roster_id,
          ownerId: r.owner_id,
          ownerName: users[r.owner_id] || `Team ${r.roster_id}`,
          directionProfile,
          tradeCount30d: tradeIntel.tradeCount30d || 0,
          picksIn30d: tradeIntel.picksIn || 0,
          picksOut30d: tradeIntel.picksOut || 0,
          lastTradeAt: tradeIntel.lastTradeAt,
          recentBuyLabel: recentBuyTop && recentBuyTop[1] > 0 ? `Recently bought ${recentBuyTop[0]}` : "No strong recent buy signal",
          buildBiasLabel: posValueTotals[0]?.total > 0 ? `${posValueTotals[0].pos}-heavy build` : "Balanced build",
          strongestPos: posValueTotals[0]?.pos || "-",
          secondPos: posValueTotals[1]?.pos || "-",
          motivation: getLeagueMateMotivation(directionProfile, tradeIntel.tradeCount30d || 0),
          fitScore: totalFitScore,
          fitLabel: getTradePartnerFitLabel(totalFitScore),
          fitReasons: combinedFitReasons,
          baseFitReasons: fit.fitReasons,
          crossLeagueFitReasons: [...crossLeaguePreferenceFit.fitReasons, ...crossLeagueTradeFit.fitReasons],
          crossLeagueSummary: ownerCrossLeagueIntel?.crossLeagueSummary || "Cross-league tendencies still loading.",
          crossLeagueTradeSummary: ownerCrossLeagueIntel?.crossLeagueTradeSummary || "Cross-league trade behavior still loading.",
          preferenceLabel: ownerCrossLeagueIntel?.preferenceLabel || "League-specific read only",
          tradePreferenceLabel: ownerCrossLeagueIntel?.tradePreferenceLabel || "Trade behavior still loading",
          preferredPositions: ownerCrossLeagueIntel?.preferredPositions || [],
          tradePreferredPositions: ownerCrossLeagueIntel?.tradePreferredPositions || [],
          repeatedPlayers: ownerCrossLeagueIntel?.repeatedPlayers || [],
          acquiredPlayers: ownerCrossLeagueIntel?.acquiredPlayers || [],
          totalDynastyLeagues: ownerCrossLeagueIntel?.totalDynastyLeagues || 0,
          averageAgeAllLeagues: ownerCrossLeagueIntel?.averageAgeAllLeagues || 0,
          crossLeagueTradeCount30d: ownerCrossLeagueIntel?.crossLeagueTradeCount30d || 0,
        };
      })
      .filter((v) => v !== null)
      .sort((a: any, b: any) => {
        if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
        if (b.tradeCount30d !== a.tradeCount30d) return b.tradeCount30d - a.tradeCount30d;
        return a.ownerName.localeCompare(b.ownerName);
      }) as LeagueMateView[];
  }, [selectedLeague?.league_id, rosters, user?.user_id, allPicks, players, pickFcValues, redraftValues, calcFcValues, leagueMateTradeIntel, users, crossLeagueMateIntel]);
  const selectedLeagueMateProfilesView =
    selectedLeagueMateProfiles.length > 0
      ? selectedLeagueMateProfiles
      : (selectedLeague?.league_id ? leagueMateProfileCache[selectedLeague.league_id] || [] : []);
  const activeLeagueHubGroup = useMemo(
    () => LEAGUE_HUB_GROUPS.find((group) => group.tabs.some((tab) => tab.id === leagueHubTab)) || LEAGUE_HUB_GROUPS[0],
    [leagueHubTab]
  );
  const leagueMateProfileByRosterId = useMemo(
    () => new Map(selectedLeagueMateProfilesView.map((profile: any) => [Number(profile.rosterId), profile])),
    [selectedLeagueMateProfilesView]
  );
  // ── Buy Low player IDs (shared with Trade Finder) ─────────────────────────
  // Same formula as DataHub Buy Low tab. Top 30 IDs ordered by score descending,
  // only players with real projection data (not redraft fallback).
  const buyLowPlayerIds = useMemo<string[]>(() => {
    if (!players || Object.keys(calcFcValues).length === 0) return [];
    const projById = new Map<string, number>(
      projectionData.map((r: any) => [String(r.sleeperId), Number(r.fpts || 0)])
    );
    const MIN_DYN_VAL: Record<string, number> = { QB: 500, RB: 350, WR: 350, TE: 350 };
    const getAgeMult = (age: number, pos: string): number => {
      if (!age) return 0.8;
      if (pos === "QB") return age <= 25 ? 1.5 : age <= 28 ? 1.2 : age <= 31 ? 0.85 : 0.5;
      if (pos === "RB") return age <= 22 ? 1.6 : age <= 24 ? 1.3 : age <= 26 ? 0.9 : 0.4;
      if (pos === "WR") return age <= 24 ? 1.5 : age <= 27 ? 1.2 : age <= 30 ? 0.85 : 0.5;
      return age <= 25 ? 1.5 : age <= 27 ? 1.2 : age <= 30 ? 0.85 : 0.5;
    };
    const rows: { player_id: string; score: number }[] = [];
    for (const pos of ["QB", "RB", "WR", "TE"] as const) {
      const minVal = MIN_DYN_VAL[pos];
      const pool = Object.values(players as Record<string, any>)
        .filter((p: any) => p.position === pos && (calcFcValues[p.player_id] ?? 0) >= minVal && projById.has(p.player_id))
        .map((p: any) => ({ player_id: p.player_id, age: Number(p.age || 0), dynVal: calcFcValues[p.player_id] ?? 0, projFpts: projById.get(p.player_id)! }));
      if (pool.length < 2) continue;
      const dynSorted  = [...pool].sort((a, b) => b.dynVal - a.dynVal);
      const projSorted = [...pool].sort((a, b) => b.projFpts - a.projFpts);
      const dynRankMap  = new Map(dynSorted.map((p, i) => [p.player_id, i + 1]));
      const projRankMap = new Map(projSorted.map((p, i) => [p.player_id, i + 1]));
      const n = pool.length;
      for (const p of pool) {
        const dynRank = dynRankMap.get(p.player_id)!;
        const projRank = projRankMap.get(p.player_id)!;
        const gap = dynRank - projRank;
        if (gap <= 0) continue;
        const projPctile = (n - projRank) / Math.max(n - 1, 1);
        rows.push({ player_id: p.player_id, score: (gap / n) * getAgeMult(p.age, pos) * (0.55 + 0.45 * projPctile) });
      }
    }
    const maxRaw = Math.max(...rows.map(r => r.score), 0.001);
    return rows
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .filter(r => r.score / maxRaw >= 0.15) // only meaningful buy lows (≥15% of top score)
      .map(r => r.player_id);
  }, [players, calcFcValues, redraftValues, projectionData]);

  const tradePartnerRankings = useMemo(() => {
    if (!selectedLeague || !rosters.length || !user?.user_id || !selectedLeagueSimulation || !selectedLeagueDirection) return [];

    const myRoster = rosters.find((entry: any) => entry.owner_id === user.user_id);
    if (!myRoster) return [];

    const mySimRow = selectedLeagueSimulation.rowByRosterId.get(Number(myRoster.roster_id));
    // Use the fully adjusted profile (dynasty + redraft + sim + age) as the source of truth
    const myEffectiveProfile = selectedLeagueDirectionAdjusted ?? selectedLeagueDirection;
    const myBuckets = getProfilePosBuckets(myEffectiveProfile);
    const strongPos = myBuckets.strong[0] || myEffectiveProfile.positionRanks?.sort((a: any, b: any) => a.rank - b.rank)?.[0]?.pos || "WR";
    const weakPos = myBuckets.weak[0] || myEffectiveProfile.positionRanks?.sort((a: any, b: any) => b.rank - a.rank)?.[0]?.pos || "RB";

    return selectedLeagueMateProfilesView
      .map((partner: any) => {
        const simRow = selectedLeagueSimulation.rowByRosterId.get(Number(partner.rosterId));
        const partnerPlayoffOdds = simRow?.playoffOdds ?? 0;
        // Apply the same three-factor adjustment to each partner's bucket
        const partnerAdjustedBucket = getAdjustedDirectionBucket(
          partner.directionProfile?.bucket,
          partner.directionProfile,
          partnerPlayoffOdds,
          !!simRow
        );
        const partnerAdjustedProfile = { ...partner.directionProfile, bucket: partnerAdjustedBucket };
        const partnerBuckets = getProfilePosBuckets(partnerAdjustedProfile);
        const isSeller = partnerPlayoffOdds < 50 || ["Rebuilder", "Stranded", "Fading Out", "Hopeless"].includes(partnerAdjustedBucket);
        const isBuyer = partnerPlayoffOdds >= 55 || ["Elite", "True Contender", "Almost There", "Window Closing"].includes(partnerAdjustedBucket);
        const bestApproach =
          isSeller ? `Buy ${weakPos}` :
          isBuyer && partnerBuckets.weak.includes(strongPos) ? `Sell ${strongPos}` :
          partnerBuckets.strong.includes(weakPos) ? `Tier up at ${weakPos}` :
          `Explore 2-for-1`;
        const rankScore = Math.round(
          partner.fitScore +
          (isSeller ? 8 : 0) +
          (isBuyer ? 6 : 0) +
          (partnerBuckets.weak.includes(strongPos) ? 6 : 0) +
          (partnerBuckets.strong.includes(weakPos) ? 5 : 0) +
          Math.max(0, 12 - Math.abs((mySimRow?.playoffOdds ?? 50) - (simRow?.playoffOdds ?? 50)) / 6)
        );
        const negotiationNotes = [
          partner.motivation,
          partner.recentBuyLabel,
          partner.tradeCount30d >= 2 ? "Lead with a direct, actionable first offer." : "You may need a cleaner first offer and a clearer why-now pitch.",
        ].filter(Boolean).slice(0, 3);

        return {
          ...partner,
          // Override directionProfile with the adjusted version so downstream consumers
          // (recommendation cards, guardrails, etc.) all see the same bucket
          directionProfile: { ...partnerAdjustedProfile, bucketColor: getBucketColor(partnerAdjustedBucket) },
          playoffOdds: simRow?.playoffOdds ?? 0,
          titleOdds: simRow?.titleOdds ?? 0,
          finishRange: simRow?.finishRange || "-",
          oneOhOneOdds: simRow?.oneOhOneOdds ?? 0,
          bestApproach,
          rankScore,
          negotiationNotes,
          isSeller,
          isBuyer,
        };
      })
      .sort((a: any, b: any) => {
        if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
        if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
        return a.ownerName.localeCompare(b.ownerName);
      });
  }, [selectedLeague?.league_id, rosters, user?.user_id, selectedLeagueSimulation, selectedLeagueDirection, selectedLeagueMateProfilesView]);

  const tradeRecommendationCards = useMemo(() => {
    if (!selectedLeague || !rosters.length || !user?.user_id || !selectedLeagueDirection) return [];

    const myRoster = rosters.find((entry: any) => entry.owner_id === user.user_id);
    if (!myRoster) return [];

    // Use the fully adjusted profile — dynasty rank + redraft rank + sim + age all combined
    const myProfile = selectedLeagueDirectionAdjusted ?? selectedLeagueDirection;
    const myPlayoffOdds = myProfile?.playoffOdds ?? (selectedLeagueSimulation?.rowByRosterId?.get(Number(myRoster.roster_id))?.playoffOdds ?? 0);
    // A team below 50% to make playoffs should NEVER be buying points.
    // Winning 2 extra games moves you from 1.02 to 1.05 pick without any championship upside.
    // The only valid strategy is accumulating draft capital and young upside shots.
    const iAmTanking = myPlayoffOdds < 50;
    const iAmContending = myPlayoffOdds >= 50;
    const dynValueForPlayer = (id: string) => calcFcValues[id] ?? players[id]?.value ?? 0;
    const playerListForRoster = (rosterId: number) => {
      const rosterEntry = rosters.find((entry: any) => Number(entry.roster_id) === Number(rosterId));
      return (rosterEntry?.players || [])
        .map((id: string) => {
          const player = players[id];
          return player ? {
            ...player,
            dynValue: dynValueForPlayer(id),
            redValue: redraftValues[id] ?? 0,
          } : null;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .filter((player) => ["QB", "RB", "WR", "TE"].includes(player.position));
    };
    const myPlayersDetailed = playerListForRoster(myRoster.roster_id);
    const myPicksDetailed = allPicks
      .filter((pick: any) => Number(pick.owner_id) === Number(myRoster.roster_id))
      .map((pick: any) => {
        const key = `${pick.season}-${pick.round}-${pick.roster_id}`;
        const dynamic = selectedLeagueDynamicPickValues[key];
        return {
          ...pick,
          expectedValue: dynamic?.expectedValue ?? getStoredPickValue(pickFcValues, pick),
          dynamic,
          label: dynamic?.label || "Flat value",
          expectedSlot: dynamic?.expectedSlot ?? null,
        };
      })
      .sort((a: any, b: any) => b.expectedValue - a.expectedValue);

    const teamCount = rosters.length || 12;
    const weakPositions = new Set(
      (myProfile?.positionRanks || [])
        .filter((entry: any) => entry.rank >= Math.max(4, teamCount - 2))
        .map((entry: any) => entry.pos)
    );
    const strongPositions = new Set(
      (myProfile?.positionRanks || [])
        .filter((entry: any) => entry.rank <= Math.max(2, Math.ceil(teamCount / 3)))
        .map((entry: any) => entry.pos)
    );
    const recommendations: any[] = [];
    const sortedPartners = [...tradePartnerRankings];
    const isBlockedSellDisposition = (playerId?: string | null) =>
      !!playerId && playerDispositions[playerId]?.sell === "Not Willing to Trade";
    const isBlockedBuyDisposition = (playerId?: string | null) =>
      !!playerId && ["Zero Interest", "Skip"].includes(playerDispositions[playerId]?.buy || "");
    const assetValue = (asset: any) => asset?.expectedValue ?? asset?.dynValue ?? asset?.value ?? 0;
    const meaningfulPlayerThreshold = 350;
    const fairDeltaLimit = (total: number) => Math.max(250, Math.min(900, Math.round(total * 0.16)));
    // Waiver credit: same formula as trade calculator & trade finder (0.42× extra asset value, capped)
    const calcWaiverCredit = (extras: number[]) =>
      extras.reduce((s, v, i) => s + Math.min(Math.round(v * 0.42), i === 0 ? 550 : 750), 0);
    const isFairPackage = (give: any[], receive: any[]) => {
      const giveVals = give.map((a: any) => assetValue(a)).sort((a, b) => b - a);
      const receiveVals = receive.map((a: any) => assetValue(a)).sort((a, b) => b - a);
      const rawGive = Math.round(giveVals.reduce((s, v) => s + v, 0));
      const rawReceive = Math.round(receiveVals.reduce((s, v) => s + v, 0));
      if (rawGive <= 0 || rawReceive <= 0) return false;
      // Apply waiver credit to the side with fewer assets (same as calculator/finder)
      const assetDiff = giveVals.length - receiveVals.length;
      const waiverAdj = assetDiff > 0
        ? calcWaiverCredit(giveVals.slice(receiveVals.length))
        : assetDiff < 0
        ? calcWaiverCredit(receiveVals.slice(giveVals.length))
        : 0;
      const giveAdj = rawGive + (assetDiff < 0 ? waiverAdj : 0);
      const receiveAdj = rawReceive + (assetDiff > 0 ? waiverAdj : 0);
      const delta = Math.abs(receiveAdj - giveAdj);
      const ratio = receiveAdj / Math.max(giveAdj, 1);
      return delta <= fairDeltaLimit(Math.max(giveAdj, receiveAdj)) && ratio >= 0.78 && ratio <= 1.22;
    };
    const chooseClosestPackage = (packages: any[][], targetValue: number, opts?: { minValue?: number; maxValue?: number }) => {
      const minValue = opts?.minValue ?? Math.max(400, Math.round(targetValue * 0.78));
      const maxValue = opts?.maxValue ?? Math.round(targetValue * 1.22);
      return packages
        .map((pkg) => ({
          assets: pkg,
          total: Math.round(sum(pkg.map((asset: any) => assetValue(asset)))),
        }))
        .filter((entry) => entry.total >= minValue && entry.total <= maxValue)
        .sort((a, b) => Math.abs(a.total - targetValue) - Math.abs(b.total - targetValue))[0] || null;
    };
    const twoAssetCombos = (assets: any[]) => {
      const combos: any[][] = [];
      for (let i = 0; i < assets.length; i++) {
        for (let j = i + 1; j < assets.length; j++) {
          combos.push([assets[i], assets[j]]);
        }
      }
      return combos;
    };
    const buildCard = ({
      archetype,
      partner,
      give,
      receive,
      whyYou,
      whyThem,
      summary,
    }: any) => {
      const giveValsAdj = give.map((a: any) => assetValue(a)).sort((a: number, b: number) => b - a);
      const receiveValsAdj = receive.map((a: any) => assetValue(a)).sort((a: number, b: number) => b - a);
      const giveTotal = Math.round(giveValsAdj.reduce((s: number, v: number) => s + v, 0));
      const receiveTotal = Math.round(receiveValsAdj.reduce((s: number, v: number) => s + v, 0));
      const assetDiffCard = giveValsAdj.length - receiveValsAdj.length;
      const waiverAdjCard = assetDiffCard > 0
        ? calcWaiverCredit(giveValsAdj.slice(receiveValsAdj.length))
        : assetDiffCard < 0
        ? calcWaiverCredit(receiveValsAdj.slice(giveValsAdj.length))
        : 0;
      const giveTotalAdj = giveTotal + (assetDiffCard < 0 ? waiverAdjCard : 0);
      const receiveTotalAdj = receiveTotal + (assetDiffCard > 0 ? waiverAdjCard : 0);
      const packageDelta = receiveTotalAdj - giveTotalAdj;
      if (give.some((asset: any) => !asset?.season && isBlockedSellDisposition(asset?.player_id))) return null;
      if (receive.some((asset: any) => !asset?.season && isBlockedBuyDisposition(asset?.player_id))) return null;
      if (!isFairPackage(give, receive)) return null;
      if (give.some((asset: any) => asset?.dynValue != null && asset.dynValue < meaningfulPlayerThreshold && !asset?.season)) return null;
      if (receive.some((asset: any) => asset?.dynValue != null && asset.dynValue < meaningfulPlayerThreshold && !asset?.season)) return null;
      const archetypeBonus = archetype === "Draft Capital" ? 5 : archetype === "Tier Up" ? 4 : archetype === "Buy Low" ? 3 : 2;
      const recommendationScore = Math.round(
        partner.rankScore +
        Math.max(0, 16 - Math.abs(packageDelta) / 140) +
        archetypeBonus
      );
      return {
        archetype,
        partnerName: partner.ownerName,
        fitLabel: partner.fitLabel,
        partnerOwnerId: partner.ownerId,
        partnerRosterId: partner.rosterId,
        give,
        receive,
        whyYou,
        whyThem,
        summary,
        partnerPlayoffOdds: partner.playoffOdds,
        partnerTitleOdds: partner.titleOdds,
        partnerRankScore: partner.rankScore,
        recommendationScore,
        giveTotal,
        receiveTotal,
        packageDelta,
        bestApproach: partner.bestApproach,
        negotiationNotes: partner.negotiationNotes,
        openingOffer: `Open with the clean version first: ${archetype.toLowerCase()} framed around ${partner.bestApproach.toLowerCase()}.`,
      };
    };

    const isAgingAsset = (player: any) =>
      (player.position === "RB" && Number(player.age || 0) >= 25) ||
      (player.position === "QB" && Number(player.age || 0) >= 29) ||
      (["WR", "TE"].includes(player.position) && Number(player.age || 0) >= 28);
    const isYoungInsulation = (player: any) =>
      (["QB", "WR"].includes(player.position) && Number(player.age || 99) <= 25) ||
      (player.position === "TE" && Number(player.age || 99) <= 25) ||
      (player.position === "RB" && Number(player.age || 99) <= 23);
    // A floor filler wins you games now but adds no dynasty upside — dangerous for tanking teams
    // because it moves you from 1.02 to 1.05 pick without any realistic championship path.
    const isFloorFiller = (player: any) =>
      (player.position === "RB" && Number(player.age || 0) >= 24) ||
      (player.position === "QB" && Number(player.age || 0) >= 28) ||
      (["WR", "TE"].includes(player.position) && Number(player.age || 0) >= 27);
    const getPickPackage = (rosterId: number) =>
      allPicks
        .filter((pick: any) => Number(pick.owner_id) === Number(rosterId))
        .map((pick: any) => {
          const dynKey = `${pick.season}-${pick.round}-${pick.roster_id}`;
          const dyn = selectedLeagueDynamicPickValues[dynKey];
          return {
            ...pick,
            expectedValue: dyn?.expectedValue ?? getStoredPickValue(pickFcValues, pick),
            label: dyn?.label || "Flat value",
            expectedSlot: dyn?.expectedSlot ?? null,
          };
        })
        .filter((pick: any) => pick.expectedValue > 0)
        .sort((a: any, b: any) => b.expectedValue - a.expectedValue)
        .slice(0, 6);
    const comboPackages = (assets: any[], maxItems = 2) => {
      const singles = assets.map((asset: any) => [asset]);
      if (maxItems <= 1) return singles;
      return [...singles, ...twoAssetCombos(assets)];
    };
    const classifyArchetype = (give: any[], receive: any[], partner: any) => {
      const givePlayers = give.filter((asset: any) => !asset?.season);
      const receivePlayers = receive.filter((asset: any) => !asset?.season);
      const givePicks = give.filter((asset: any) => !!asset?.season);
      const receivePicks = receive.filter((asset: any) => !!asset?.season);
      if (receivePicks.length > 0 && givePlayers.some((player: any) => isAgingAsset(player))) return "Sell High";
      // Tanking teams trading floor fillers for picks = Draft Capital accumulation
      if (iAmTanking && receivePicks.length > 0 && givePlayers.some((player: any) => isFloorFiller(player))) return "Draft Capital";
      if (givePicks.length > 0 && receivePlayers.some((player: any) => weakPositions.has(player.position))) return "Buy Low";
      if (give.length > receive.length && receivePlayers.length === 1) return "2-for-1";
      if (give.length >= 2 && receivePlayers.length === 1 && receivePlayers[0]?.dynValue > Math.max(...givePlayers.map((player: any) => player.dynValue || 0), 0)) return "Tier Up";
      if (partner?.isSeller) return "Insulation Buy";
      return "Value Rebalance";
    };
    const scoreRecommendationFit = (give: any[], receive: any[], partner: any) => {
      const givePlayers = give.filter((asset: any) => !asset?.season);
      const receivePlayers = receive.filter((asset: any) => !asset?.season);
      const givePicks = give.filter((asset: any) => !!asset?.season);
      const receivePicks = receive.filter((asset: any) => !!asset?.season);
      const partnerBuckets = getProfilePosBuckets(partner.directionProfile);
      let myScore = 0;
      let theirScore = 0;

      if (["Rebuilder", "Stranded", "Fading Out", "Hopeless"].includes(myProfile.bucket)) {
        myScore += givePlayers.filter((player: any) => isAgingAsset(player)).length * 8;
        myScore += givePlayers.filter((player: any) => isFloorFiller(player) && !isAgingAsset(player)).length * 5;
        myScore += receivePlayers.filter((player: any) => isYoungInsulation(player)).length * 8;
        myScore += receivePicks.length * 7;
        myScore -= receivePlayers.filter((player: any) => isAgingAsset(player)).length * 16;
        myScore -= receivePlayers.filter((player: any) => isFloorFiller(player) && !isAgingAsset(player)).length * 10;
      } else if (["Elite", "True Contender", "Almost There", "Window Closing"].includes(myProfile.bucket)) {
        myScore += receivePlayers.filter((player: any) => weakPositions.has(player.position)).length * 8;
        myScore += receivePlayers.reduce((sum: number, player: any) => sum + (player.redValue || 0), 0) / 350;
        myScore -= receivePicks.length * 3;
        // RBs injure at the highest rate and are hardest to replace off waivers.
        // Contending teams should value RB depth even when RB is already a "strong" position.
        myScore += receivePlayers.filter((player: any) =>
          player.position === "RB" && Number(player.age || 0) >= 22 && Number(player.age || 0) <= 26
        ).length * 5;
      } else if (iAmTanking) {
        // Purgatory/Fading teams below 50% playoff odds — buying points is COUNTERPRODUCTIVE.
        // Going from 4-9 to 6-7 moves the 1.02 to 1.05 without any playoff upside.
        // Only valid moves: sell floor fillers, accumulate picks, target young upside shots.
        myScore += givePlayers.filter((player: any) => isFloorFiller(player)).length * 7;
        myScore += givePlayers.filter((player: any) => isAgingAsset(player)).length * 8;
        myScore += receivePlayers.filter((player: any) => isYoungInsulation(player)).length * 9;
        myScore += receivePicks.length * 10;
        myScore -= receivePlayers.filter((player: any) => isFloorFiller(player)).length * 16;
        myScore -= receivePlayers.filter((player: any) => isAgingAsset(player)).length * 20;
        // Filling a weak position with a floor player is exactly wrong — hurts draft slot
        myScore -= receivePlayers.filter((player: any) => weakPositions.has(player.position) && isFloorFiller(player)).length * 8;
      } else {
        // True middle — realistic playoff path, balanced approach
        myScore += receivePlayers.filter((player: any) => weakPositions.has(player.position)).length * 6;
        myScore += receivePlayers.filter((player: any) => isYoungInsulation(player)).length * 4;
        myScore += receivePicks.length * 3;
      }

      if (partner.isBuyer) {
        theirScore += givePlayers.filter((player: any) => partnerBuckets.weak.includes(player.position)).length * 8;
        theirScore += givePlayers.reduce((sum: number, player: any) => sum + (player.redValue || 0), 0) / 350;
        theirScore -= receivePicks.length * 2;
      } else if (partner.isSeller) {
        theirScore += givePicks.length * 7;
        theirScore += givePlayers.filter((player: any) => isYoungInsulation(player)).length * 7;
        theirScore += receivePlayers.filter((player: any) => isAgingAsset(player)).length * 6;
        theirScore -= givePlayers.filter((player: any) => isAgingAsset(player)).length * 6;
      } else {
        theirScore += givePlayers.filter((player: any) => partnerBuckets.weak.includes(player.position)).length * 5;
        theirScore += givePicks.length * 3;
      }

      return { myScore, theirScore };
    };
    const passesRecommendationGuard = (give: any[], receive: any[], partner: any) => {
      const givePlayers = give.filter((asset: any) => !asset?.season);
      const receivePlayers = receive.filter((asset: any) => !asset?.season);
      const givePicks = give.filter((asset: any) => !!asset?.season);
      const receivePicks = receive.filter((asset: any) => !!asset?.season);
      const partnerBuckets = getProfilePosBuckets(partner.directionProfile);
      const incomingAging = receivePlayers.filter((player: any) => isAgingAsset(player)).length;
      const incomingYoung = receivePlayers.filter((player: any) => isYoungInsulation(player)).length;
      const outgoingAging = givePlayers.filter((player: any) => isAgingAsset(player)).length;
      const givesPremiumCurrentPick = givePicks.some((pick: any) => String(pick.season) === CURRENT_YEAR && Number(pick.round) === 1);
      const receivesPremiumCurrentPick = receivePicks.some((pick: any) => String(pick.season) === CURRENT_YEAR && Number(pick.round) === 1);

      if (["Rebuilder", "Stranded", "Fading Out", "Hopeless"].includes(myProfile.bucket)) {
        if (incomingAging > 0) return false;
        if (givesPremiumCurrentPick && incomingYoung === 0 && receivePicks.length === 0) return false;
        if (receivePlayers.some((player: any) => player.position === "RB" && Number(player.age || 99) >= 24)) return false;
      }

      // Tanking teams (below 50% playoff odds) in non-rebuild buckets must follow the same discipline.
      // Buying points is actively harmful — it ruins your draft slot without adding championship upside.
      // The ONLY valid acquisitions are: young upside shots, future picks, draft capital.
      if (iAmTanking && !["Rebuilder", "Stranded", "Fading Out", "Hopeless"].includes(myProfile.bucket)) {
        // Never take on aging assets regardless of position need
        if (incomingAging > 0) return false;
        // Never take on floor fillers unless also getting picks — you'd just win extra games
        if (receivePlayers.some((p: any) => isFloorFiller(p)) && receivePicks.length === 0 && incomingYoung === 0) return false;
        // Must receive picks or young upside — point fillers without future capital are vetoed
        if (receivePlayers.length > 0 && receivePlayers.every((p: any) => !isYoungInsulation(p)) && receivePicks.length === 0) return false;
        // Guard premium current picks — should only move them for meaningful future capital
        if (givesPremiumCurrentPick && incomingYoung === 0 && receivePicks.length === 0) return false;
        // Older RBs are the most dangerous floor-fillers: they win games now, crater fast
        if (receivePlayers.some((p: any) => p.position === "RB" && Number(p.age || 99) >= 24)) return false;
      }

      if (["Elite", "True Contender", "Almost There", "Window Closing"].includes(myProfile.bucket)) {
        if (receive.length > 0 && receivePlayers.length === 0) return false;
        if (receivePlayers.length > 0 && receivePlayers.every((player: any) => isYoungInsulation(player)) && receivePicks.length > 0 && givePlayers.length > 0) {
          return false;
        }
      }

      if (partner.isBuyer) {
        const pointsComingToPartner = givePlayers.reduce((sum: number, player: any) => sum + (player.redValue || 0), 0);
        if (pointsComingToPartner <= 0 && givePicks.length > 0) return false;
        if (partnerBuckets.weak.length > 0 && !givePlayers.some((player: any) => partnerBuckets.weak.includes(player.position)) && pointsComingToPartner < 1000) {
          return false;
        }
      }

      if (partner.isSeller) {
        if (outgoingAging > 0 && givePicks.length === 0 && givePlayers.filter((player: any) => isYoungInsulation(player)).length === 0) return false;
        if (receivesPremiumCurrentPick && partner.playoffOdds > 55) return false;
      }

      return true;
    };
    const getCandidateText = (archetype: string, partner: any, _give: any[], receive: any[]) => {
      const receivePlayers = receive.filter((asset: any) => !asset?.season);
      const receivePicks = receive.filter((asset: any) => !!asset?.season);
      if (archetype === "Draft Capital") {
        return {
          whyYou: `At ${Math.round(myPlayoffOdds)}% to make the playoffs, buying points is counterproductive — getting marginally better moves you from a 1.02 to a 1.05 without any realistic championship path. Converting this floor player into picks preserves your draft slot and maximizes the only real lever you have.`,
          whyThem: `${partner.ownerName} gets production that matches a buying window. The floor player helps them now; the picks help you long-term.`,
          summary: "A draft capital accumulation trade that protects your rebuild trajectory without surrendering cornerstone pieces.",
        };
      }
      if (archetype === "Sell High") {
        return {
          whyYou: "Moves present production into future insulation without waiting for the market to cool.",
          whyThem: `${partner.ownerName} gets immediate points that better match a buying profile.`,
          summary: "A fair veteran-for-future package that aligns with both roster timelines.",
        };
      }
      if (archetype === "Buy Low" || archetype === "Insulation Buy") {
        return {
          whyYou: "Targets younger insulation without paying a reckless premium.",
          whyThem: `${partner.ownerName} gets the kind of future value a seller should actually consider.`,
          summary: "A future-facing package built around a player they can realistically move.",
        };
      }
      if (archetype === "2-for-1" || archetype === "Tier Up") {
        return {
          whyYou: `Converts extra depth into one stronger piece at a weaker spot without blowing past fair value.`,
          whyThem: `${partner.ownerName} gets multiple assets that better fit their roster shape.`,
          summary: "A balanced consolidation deal that should make sense to both sides.",
        };
      }
      return {
        whyYou: `Improves roster shape with a package that stays inside a realistic value band.`,
        whyThem: `${partner.ownerName} gets assets that better match their profile and current incentives.`,
        summary: receivePicks.length > 0
          ? "A fair rebalance that includes future insulation."
          : `A fair rebalance centered on ${receivePlayers[0]?.position || "roster"} value.`,
      };
    };

    sortedPartners.forEach((partner: any) => {
      const partnerPlayers = playerListForRoster(Number(partner.rosterId));
      const partnerPicks = getPickPackage(Number(partner.rosterId));
      const partnerBuckets = getProfilePosBuckets(partner.directionProfile);

      const myOfferPlayers = myPlayersDetailed
        .filter((player: any) => {
          const disp = playerDispositions[player.player_id];
          if (isBlockedSellDisposition(player.player_id)) return false;
          // Never offer players I've explicitly tagged as "buy" — I want them
          if (disp?.buy) return false;
          // Always include players I've tagged as "sell" (lower threshold: just needs some real value)
          if (disp?.sell) return player.dynValue >= 150;
          // Default criteria: strong positions, aging assets, or partner's weak spots
          return (
            player.dynValue >= meaningfulPlayerThreshold &&
            (
              strongPositions.has(player.position) ||
              isAgingAsset(player) ||
              (iAmTanking && isFloorFiller(player)) ||
              partnerBuckets.weak.includes(player.position)
            )
          );
        })
        .sort((a: any, b: any) => {
          // Sell-tagged players sort first so they're prioritized in combo generation
          const aIsSell = playerDispositions[a.player_id]?.sell ? 1 : 0;
          const bIsSell = playerDispositions[b.player_id]?.sell ? 1 : 0;
          if (bIsSell !== aIsSell) return bIsSell - aIsSell;
          return a.dynValue - b.dynValue;
        })
        .slice(0, 12);
      const myOfferPicks = myPicksDetailed.slice(0, 5);

      const partnerTradeablePlayers = partnerPlayers
        .filter((player: any) =>
          !isBlockedBuyDisposition(player.player_id) &&
          player.dynValue >= meaningfulPlayerThreshold &&
          (
            // Always target players I've explicitly flagged as buy interest, regardless of profile
            !!playerDispositions[player.player_id]?.buy ||
            // Contending teams target positional needs; tanking teams target youth/upside only
            (iAmContending && weakPositions.has(player.position)) ||
            (iAmTanking && isYoungInsulation(player)) ||
            (partner.isSeller && (isAgingAsset(player) || isYoungInsulation(player))) ||
            (partner.isBuyer && partnerBuckets.strong.includes(player.position))
          )
        )
        .sort((a: any, b: any) => {
          // Buy-tagged players sort first
          const aIsBuy = playerDispositions[a.player_id]?.buy ? 1 : 0;
          const bIsBuy = playerDispositions[b.player_id]?.buy ? 1 : 0;
          if (bIsBuy !== aIsBuy) return bIsBuy - aIsBuy;
          return b.dynValue - a.dynValue;
        })
        .slice(0, 12);

      const givePackages = comboPackages([...myOfferPlayers, ...myOfferPicks], 2).slice(0, 45);
      const receivePackages = comboPackages([...partnerTradeablePlayers, ...partnerPicks], 2).slice(0, 45);
      const candidateCards: any[] = [];
      const tryBuildCandidates = (minimumFit: number, bandFloor: number, bandCeil: number) => {
        givePackages.forEach((givePkg: any[]) => {
          const giveTotal = Math.round(sum(givePkg.map((asset: any) => assetValue(asset))));
          if (giveTotal < meaningfulPlayerThreshold) return;
          const matchedReceive = chooseClosestPackage(receivePackages, giveTotal, {
            minValue: Math.round(giveTotal * bandFloor),
            maxValue: Math.round(giveTotal * bandCeil),
          });
          if (!matchedReceive) return;
          const receivePkg = matchedReceive.assets;
          if (!passesRecommendationGuard(givePkg, receivePkg, partner)) return;
          const fit = scoreRecommendationFit(givePkg, receivePkg, partner);
          if (fit.myScore < minimumFit || fit.theirScore < minimumFit) return;

          const archetype = classifyArchetype(givePkg, receivePkg, partner);
          const text = getCandidateText(archetype, partner, givePkg, receivePkg);
          const card = buildCard({
            archetype,
            partner,
            give: givePkg,
            receive: receivePkg,
            whyYou: text.whyYou,
            whyThem: text.whyThem,
            summary: text.summary,
          });
          if (!card) return;
          candidateCards.push({
            ...card,
            recommendationScore: card.recommendationScore + fit.myScore + fit.theirScore,
          });
        });
      };

      tryBuildCandidates(6, 0.82, 1.12);
      if (candidateCards.length === 0) tryBuildCandidates(4, 0.86, 1.14);
      if (candidateCards.length === 0) tryBuildCandidates(3, 0.9, 1.1);

      // ── Per-partner lottery ticket candidates ─────────────────────────────
      // "Outside top 150" = dynValue < 700 but still has real upside potential.
      // These compete with regular cards so the single best deal per partner wins.
      // Dispositions: skip "Zero Interest" receive targets; boost "Buy Low" targets.
      const LOTTERY_CEILING = 700;
      const roundOrd = (r: number) => r === 1 ? "1st" : r === 2 ? "2nd" : r === 3 ? "3rd" : `${r}th`;
      const myLotteryPicks = myPicksDetailed.filter((p: any) => Number(p.round) >= 3 && assetValue(p) > 0);
      if (myLotteryPicks.length > 0) {
        partnerPlayers
          .filter((p: any) => {
            if (playerDispositions[p.player_id]?.buy === "Zero Interest") return false;
            const age = Number(p.age || 99);
            const val = Number(p.dynValue || 0);
            if (val < 60 || val >= LOTTERY_CEILING) return false;
            if (p.position === "RB" && age > 23) return false;
            if (p.position === "QB" && age > 26) return false;
            if (["WR", "TE"].includes(p.position) && age > 27) return false;
            return true;
          })
          .sort((a: any, b: any) => b.dynValue - a.dynValue)
          .slice(0, 3)
          .forEach((target: any) => {
            const targetVal = Number(target.dynValue || 0);
            const bestPick = myLotteryPicks
              .filter((p: any) => {
                const pv = assetValue(p);
                const ratio = targetVal / Math.max(pv, 1);
                return ratio >= 0.35 && ratio <= 1.6;
              })
              .map((p: any) => ({ ...p, diff: Math.abs(assetValue(p) - targetVal) }))
              .sort((a: any, b: any) => a.diff - b.diff)[0];
            if (!bestPick) return;
            const pickVal = assetValue(bestPick);
            if (pickVal <= 0 || targetVal <= 0) return;
            const dispBonus = playerDispositions[target.player_id]?.buy === "Buy Low" ? 3
              : playerDispositions[target.player_id]?.buy === "Buy at Market" ? 1 : 0;
            candidateCards.push({
              archetype: "Lottery Ticket",
              partnerName: partner.ownerName,
              fitLabel: partner.fitLabel,
              give: [bestPick],
              receive: [target],
              whyYou: `${target.full_name} is priced outside the top 150 right now but has the age and upside to break into starter value. Worst case: a late pick you were unlikely to hit on. Best case: a future contributor at almost nothing.`,
              whyThem: `${partner.ownerName} converts a developmental player into a guaranteed future pick.`,
              summary: `Low-stakes upside bet: a ${roundOrd(Number(bestPick.round))}-round pick for a young player with breakout potential.`,
              partnerPlayoffOdds: partner.playoffOdds,
              partnerTitleOdds: partner.titleOdds,
              partnerRankScore: partner.rankScore,
              recommendationScore: Math.round(partner.rankScore * 0.4 + 8 + dispBonus),
              giveTotal: Math.round(pickVal),
              receiveTotal: Math.round(targetVal),
              packageDelta: Math.round(targetVal - pickVal),
              bestApproach: partner.bestApproach,
              negotiationNotes: partner.negotiationNotes || [],
              openingOffer: `Keep it casual — "I like ${target.full_name}, would you do him for my ${bestPick.season} ${roundOrd(Number(bestPick.round))}?"`,
              isLottery: true,
            });
          });
      }

      // ── Fallback: guarantee a card for every partner ─────────────────────
      // When the filtered pools produce nothing, find the closest fair 1-for-1
      // from the full rosters (no position/age/profile restrictions).
      if (candidateCards.length === 0) {
        const fallbackMine = myPlayersDetailed
          .filter((p: any) => p.dynValue >= 500 && !isBlockedSellDisposition(p.player_id));
        const fallbackTheirs = partnerPlayers
          .filter((p: any) => p.dynValue >= 500 && !isBlockedBuyDisposition(p.player_id));
        let bestPair: { mine: any; theirs: any; diff: number } | null = null;
        for (const mine of fallbackMine) {
          for (const theirs of fallbackTheirs) {
            const ratio = mine.dynValue / Math.max(theirs.dynValue, 1);
            if (ratio < 0.78 || ratio > 1.28) continue;
            const diff = Math.abs(mine.dynValue - theirs.dynValue);
            if (!bestPair || diff < bestPair.diff) bestPair = { mine, theirs, diff };
          }
        }
        if (bestPair) {
          const give = [bestPair.mine];
          const receive = [bestPair.theirs];
          const giveTotal = Math.round(assetValue(bestPair.mine));
          const receiveTotal = Math.round(assetValue(bestPair.theirs));
          const text = getCandidateText("Value Rebalance", partner, give, receive);
          candidateCards.push({
            archetype: "Value Rebalance",
            partnerName: partner.ownerName,
            fitLabel: partner.fitLabel,
            give,
            receive,
            whyYou: text.whyYou,
            whyThem: text.whyThem,
            summary: text.summary,
            partnerPlayoffOdds: partner.playoffOdds,
            partnerTitleOdds: partner.titleOdds,
            partnerRankScore: partner.rankScore,
            recommendationScore: Math.round(partner.rankScore * 0.3 + 2),
            giveTotal,
            receiveTotal,
            packageDelta: receiveTotal - giveTotal,
            bestApproach: partner.bestApproach,
            negotiationNotes: partner.negotiationNotes || [],
            openingOffer: `A simple swap — test the waters with a casual offer to see if they're open to a roster rebalance.`,
          });
        }
      }

      const bestCard = candidateCards
        .sort((a: any, b: any) => b.recommendationScore - a.recommendationScore)[0];
      if (bestCard) recommendations.push(bestCard);
    });

    const base = recommendations
      .filter(Boolean)
      .filter((card: any) =>
        !card.give.some((asset: any) => !asset?.season && isBlockedSellDisposition(asset?.player_id)) &&
        !card.receive.some((asset: any) => !asset?.season && isBlockedBuyDisposition(asset?.player_id))
      )
      .filter((card: any) =>
        !card.give.some((asset: any) => asset?.season && String(asset.season) > CURRENT_YEAR)
      )
      .sort((a: any, b: any) => b.recommendationScore - a.recommendationScore);

    const lowImpact = base.filter((card: any) =>
      card.giveTotal >= 500 && card.giveTotal <= 4000 &&
      card.receiveTotal >= 500 && card.receiveTotal <= 4000
    );

    return (lowImpact.length > 0 ? lowImpact : base).slice(0, sortedPartners.length || 12);
  }, [
    selectedLeague?.league_id,
    rosters,
    user?.user_id,
    selectedLeagueDirection,
    selectedLeagueDirectionAdjusted,
    selectedLeagueSimulation,
    calcFcValues,
    players,
    redraftValues,
    allPicks,
    selectedLeagueDynamicPickValues,
    pickFcValues,
    tradePartnerRankings,
    playerDispositions,
  ]);
  useEffect(() => {
    if (!supabaseUser || !selectedLeague?.league_id || selectedLeagueMateProfiles.length === 0) return;
    supabase.from("leaguemate_profiles").upsert(
      {
        user_id: supabaseUser.id,
        league_id: selectedLeague.league_id,
        profiles: selectedLeagueMateProfiles,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,league_id" }
    ).then(() => {});
  }, [supabaseUser?.id, selectedLeague?.league_id, selectedLeagueMateProfiles]);

  // Save simulation results to Supabase on demand and freeze a local snapshot for
  // pick valuations. The frozen snapshot (localStorage + state) is the source of truth
  // for pick values — it never drifts between sim runs.
  const saveSimulationToSupabase = (leagueId: string, simRows: any[]) => {
    const now = new Date().toISOString();
    // Always update local state and localStorage — these are the source of truth
    // for pick valuations and must work even when Supabase auth is unavailable.
    const newEntries = Object.fromEntries(
      simRows.map((row: any) => [row.rosterId, {
        league_id: leagueId,
        roster_id: row.rosterId,
        playoff_odds: row.playoffOdds ?? 0,
        title_odds: row.titleOdds ?? 0,
        expected_wins: row.expectedWins ?? 0,
        avg_finish: row.avgFinish ?? 0,
        finish_range: row.finishRange ?? "",
        computed_at: now,
      }])
    );
    setLeagueSimCache((prev) => ({ ...prev, [leagueId]: newEntries }));
    const frozenRows = Object.fromEntries(
      simRows.map((row: any) => [row.rosterId, {
        slotProbabilities: row.slotProbabilities ?? [],
        projectedFinish: row.projectedFinish ?? 0,
        finishRange: row.finishRange ?? "",
        ownerName: row.ownerName ?? "",
        playoffOdds: row.playoffOdds ?? 0,
        computed_at: now,
      }])
    );
    setCommittedSimsByLeague((prev) => {
      const next = { ...prev, [leagueId]: frozenRows };
      try { localStorage.setItem("committedSimRows_v2", JSON.stringify(next)); } catch {}
      return next;
    });
    // Write to Supabase only when authenticated.
    if (supabaseUser) {
      const rows = simRows.map((row: any) => ({
        user_id: supabaseUser.id,
        league_id: leagueId,
        roster_id: row.rosterId,
        playoff_odds: row.playoffOdds ?? 0,
        title_odds: row.titleOdds ?? 0,
        expected_wins: row.expectedWins ?? 0,
        avg_finish: row.avgFinish ?? 0,
        finish_range: row.finishRange ?? "",
        computed_at: now,
      }));
      supabase
        .from("league_simulations")
        .upsert(rows, { onConflict: "user_id,league_id,roster_id" })
        .then(() => {});
    }
  };

  // Queue state machine: when the front of the queue is ready (loadRoster finished),
  // save the sim, advance the queue, and start loading the next league.
  useEffect(() => {
    if (!simQueue.length) return;
    if (readyLeagueId !== simQueue[0]) return;

    const leagueId = simQueue[0];
    // Only save if the live sim is actually for this league — guards against a stale
    // selectedLeagueSimulation computed for a different selectedLeague.
    if (
      selectedLeagueSimulation?.rows?.length &&
      selectedLeague?.league_id === leagueId
    ) {
      saveSimulationToSupabase(leagueId, selectedLeagueSimulation.rows);
    }

    const remaining = simQueue.slice(1);
    setSimQueue(remaining);
    setSimProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : null);

    if (remaining.length > 0) {
      const nextLeague = leagues.find((l: any) => l.league_id === remaining[0]);
      if (nextLeague) loadRoster(nextLeague);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simQueue, readyLeagueId, selectedLeagueSimulation, selectedLeague?.league_id]);

  const handleRunAllSims = () => {
    if (!leagues.length) return;
    const leagueIds = leagues.map((l: any) => l.league_id);
    setSimProgress({ done: 0, total: leagueIds.length });
    setReadyLeagueId(null); // clear so the effect can't fire with stale data
    setSimSalt(Math.floor(Math.random() * 1_000_000)); // new salt → different sim results each run
    setSimQueue(leagueIds);
    const first = leagues.find((l: any) => l.league_id === leagueIds[0]);
    if (first) loadRoster(first); // always reload to guarantee fresh data
  };
  const draftedPlayerIds = useMemo(
    () => new Set(draftPicks.map((pick: any) => String(pick.player_id)).filter(Boolean)),
    [draftPicks]
  );

  // ── Draft board prediction engine ─────────────────────────────────────────
  // Key design decisions:
  // - Actual picks detected by pick_no (overall pick number), not by roster matching
  // - Non-user slots: ranked by Sleeper ADP position (relative rookie rank, not absolute value)
  // - User's slots: ranked by their personal big board
  // - Need multiplier capped at 1.20 — tiebreaker only, never overrides ADP tier
  // - allPicks.owner_id = current owner after trades (used for slot ownership)
  const predictedDraftPicks = useMemo(() => {
    if (!draftSettings || !rosters.length || !rookies.length || !selectedLeague) return {};

    const numTeams = rosters.length;
    const numRounds: number = draftSettings?.settings?.rounds ?? draftSettings?.rounds ?? 4;
    const isSnake = ((draftSettings?.settings?.type ?? draftSettings?.type) || "snake") !== "linear";
    const myRosterId = rosters.find((r: any) => r.owner_id === user?.user_id)?.roster_id;

    // Strip Jr./Sr./II/III suffixes before collapsing to alpha-only so names from
    // Sleeper ("Omar Cooper") and FantasyCalc ("Omar Cooper Jr.") still match.
    const normName = (n: string) =>
      (n || "").toLowerCase()
        .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "")
        .replace(/[^a-z]/g, "");

    // rosterId → userId map — needed to look up owner tendencies
    const rosterToUserId: Record<number, string> = {};
    rosters.forEach((r: any) => { rosterToUserId[Number(r.roster_id)] = r.owner_id; });

    // Average positional distribution across all dynasty rookie drafts (baseline)
    const leagueAvgRate: Record<string, number> = { QB: 0.12, RB: 0.28, WR: 0.48, TE: 0.12 };

    // Per-owner tendency multiplier: how much more/less likely vs. league average
    // Capped at 0.75× – 1.30× so it influences without overriding dynasty value
    const tendencyMult = (rosterId: number | null, pos: string): number => {
      if (!rosterId) return 1;
      const userId = rosterToUserId[rosterId];
      if (!userId) return 1;
      const rates = ownerDraftTendencies[userId];
      if (!rates) return 1;
      const ownerRate = rates[pos] ?? (leagueAvgRate[pos] ?? 0.25);
      const avgRate = leagueAvgRate[pos] ?? 0.25;
      const ratio = ownerRate / avgRate;
      return Math.max(0.75, Math.min(1.30, ratio));
    };

    // Build name→dynasty value map from Sleeper players dict + FC values
    // Needed because rookies use FC player_ids which may differ from Sleeper player_ids
    const valueByNormName: Record<string, number> = {};
    Object.entries(players).forEach(([id, p]: [string, any]) => {
      const val = calcFcValues[id] ?? (p as any).value ?? 0;
      if (val > 0 && (p as any).full_name) {
        const key = normName((p as any).full_name);
        if (!valueByNormName[key] || val > valueByNormName[key]) valueByNormName[key] = val;
      }
    });
    const getRookieValue = (r: any): number =>
      (r.player_id ? (calcFcValues[r.player_id] ?? 0) : 0) || valueByNormName[normName(r.name)] || 0;

    // Unified player pool for non-user picks.
    // Sort key uses BOTH dynasty value (FC) and ADP so the right signal always wins:
    //   - Players with FC dynasty value → sort by value descending (higher = earlier pick)
    //   - Players with ADP but no value → ADP ascending interpolated into value scale
    //   - Players with neither → board rank tiebreaker at the very end
    // This prevents ADP name-matching failures (e.g. Love at MAX_SAFE_INTEGER adp)
    // from burying high-value players — their FC value pulls them back to the top.
    const fullPool = [...rookies]
      .map((r: any, boardIdx: number) => {
        const dynVal = getRookieValue(r);
        const hasAdp = typeof r.adp === "number" && r.adp < 9999;
        let sortKey: number;
        if (dynVal > 0) {
          // FC value is authoritative — higher value = lower sort key (earlier pick)
          // Adjust by ADP within same value tier for fine-grained ordering
          const adpAdj = hasAdp ? r.adp * 0.01 : 0;
          sortKey = -dynVal + adpAdj;           // e.g. Love: -8000+0.19 = -7999.81 → top
        } else if (hasAdp) {
          // No FC value, but has ADP → insert after value-ranked players
          sortKey = 50000 + r.adp;             // e.g. WR ADP=50 → 50050, below FC players
        } else {
          // No data at all — board rank tiebreaker
          sortKey = 200000 + boardIdx;
        }
        return { ...r, _sortKey: sortKey };
      })
      .sort((a: any, b: any) => a._sortKey - b._sortKey);

    // User's personal board order for their own slots
    const boardSorted = [...rookies];

    // slot → current owner_id (after trades), from allPicks
    const slotOwnerMap = new Map<string, number>();
    allPicks.forEach((p: any) => {
      if (p.slot && p.owner_id) slotOwnerMap.set(String(p.slot), Number(p.owner_id));
    });

    // Detect actual picks by pick_no — reliable regardless of slot/roster resolution
    const filledPickNos = new Set<number>(
      draftPicks.map((dp: any) => Number(dp.pick_no)).filter(Boolean)
    );
    const pickByNo = new Map<number, any>();
    draftPicks.forEach((dp: any) => { if (dp.pick_no) pickByNo.set(Number(dp.pick_no), dp); });

    // My slots across all rounds
    const mySlots = new Set<string>(
      allPicks
        .filter((p: any) => String(p.owner_id) === String(myRosterId) && p.slot)
        .map((p: any) => String(p.slot))
    );

    // League starter targets for positional need calculation
    const rp: string[] = selectedLeague.roster_positions || [];
    const starterSlots: Record<string, number> = {};
    rp.forEach((p: string) => { if (!["BN","IR","TAXI"].includes(p)) starterSlots[p] = (starterSlots[p] || 0) + 1; });
    const flex = starterSlots["FLEX"] || 0;
    const sflex = starterSlots["SUPER_FLEX"] || 0;
    const posTarget: Record<string, number> = {
      QB: (starterSlots["QB"] || 0) + sflex * 0.5,
      RB: (starterSlots["RB"] || 0) + flex * 0.40,
      WR: (starterSlots["WR"] || 0) + flex * 0.35,
      TE: (starterSlots["TE"] || 0),
    };

    // Position need multiplier — round-aware so early picks stay true to value tiers
    // while later rounds allow realistic need-based swings:
    //   Round 1: cap 1.08  → barely 1-2 spot drift  (Love stays 1.01)
    //   Round 2: cap 1.20  → moderate 2-3 spot swings
    //   Round 3: cap 1.38  → 3-5 spot swings reasonable
    //   Round 4: cap 1.55  → large swings fine (deep picks, less certain)
    // Surplus penalty also scales — aggressive in round 4 to stop double-stacking one pos.
    const needMult = (rosterId: number | null, pos: string, simCounts: Record<number, Record<string, number>>, round: number): number => {
      if (!rosterId) return 1;
      const needCap     = round === 1 ? 1.08 : round === 2 ? 1.22 : round === 3 ? 1.38 : 1.55;
      const surplusMult = round === 1 ? 0.95 : round === 2 ? 0.88 : round === 3 ? 0.82 : 0.75;
      const roster = rosters.find((r: any) => Number(r.roster_id) === rosterId);
      const existing = ((roster?.players || []) as string[])
        .map((id: string) => players[id]).filter(Boolean)
        .filter((p: any) => p.position === pos).length;
      const target = posTarget[pos] ?? 1;
      const simmed = (simCounts[rosterId] || {})[pos] || 0;
      const deficit = target - existing - simmed;
      if (deficit <= -2) return surplusMult; // surplus: discourage stacking same position
      if (deficit <= 0) return 1.00;
      return Math.min(needCap, 1 + deficit * 0.14);
    };

    // Used tracking: by player_id AND normalized name (covers ID-less rookies)
    const usedIds = new Set<string>([
      ...Array.from(draftedPlayerIds),
      ...Object.values(myDraftSlotPicks),
    ]);
    const usedNames = new Set<string>();
    draftPicks.forEach((dp: any) => {
      const p = players[dp.player_id];
      if (p?.full_name) usedNames.add(normName(p.full_name));
    });
    Object.values(myDraftSlotPicks).forEach((pid) => {
      const r = rookies.find((rk: any) => rk.player_id === pid || rk.name === pid);
      if (r?.name) usedNames.add(normName(r.name));
    });

    const isUsed = (r: any) => {
      if (r.player_id && usedIds.has(String(r.player_id))) return true;
      if (r.name && usedNames.has(normName(r.name))) return true;
      return false;
    };
    const markUsed = (r: any) => {
      if (r.player_id) usedIds.add(String(r.player_id));
      if (r.name) usedNames.add(normName(r.name));
    };

    const simCounts: Record<number, Record<string, number>> = {};
    rosters.forEach((r: any) => { simCounts[Number(r.roster_id)] = {}; });

    const predictions: Record<string, { name: string; position: string; team: string; adp: number; player_id: string | null; boardRank: number; poolRank: number }> = {};

    for (let round = 1; round <= numRounds; round++) {
      // Iterate in pick ORDER (snake reverses even rounds)
      const slotOrder = isSnake && round % 2 === 0
        ? Array.from({ length: numTeams }, (_, i) => numTeams - i)
        : Array.from({ length: numTeams }, (_, i) => i + 1);

      for (let pickIdx = 0; pickIdx < numTeams; pickIdx++) {
        const slotNum = slotOrder[pickIdx];
        const slotStr = `${round}.${String(slotNum).padStart(2, "0")}`;
        const overallPick = (round - 1) * numTeams + pickIdx + 1;
        const rosterId = slotOwnerMap.get(slotStr) ?? null;

        // Actual pick detected by pick_no — doesn't require rosterId resolution
        if (filledPickNos.has(overallPick)) {
          const dp = pickByNo.get(overallPick);
          if (dp?.player_id) {
            usedIds.add(String(dp.player_id));
            const ap = players[dp.player_id];
            if (ap?.full_name) usedNames.add(normName(ap.full_name));
            if (ap?.position && rosterId) {
              simCounts[rosterId] = simCounts[rosterId] || {};
              simCounts[rosterId][ap.position] = (simCounts[rosterId][ap.position] || 0) + 1;
            }
          }
          continue;
        }

        // User override for their own picks
        if (myDraftSlotPicks[slotStr]) {
          const oid = myDraftSlotPicks[slotStr];
          const ov = rookies.find((r: any) => r.player_id === oid || r.name === oid);
          if (ov) {
            predictions[slotStr] = { name: ov.name, position: ov.position, team: ov.team || "", adp: ov.adp ?? 999, player_id: ov.player_id, boardRank: rookies.indexOf(ov) + 1, poolRank: 0 };
            if (rosterId) { simCounts[rosterId] = simCounts[rosterId] || {}; simCounts[rosterId][ov.position] = (simCounts[rosterId][ov.position] || 0) + 1; }
          }
          continue;
        }

        const isMySlot = mySlots.has(slotStr);
        // User's own unfilled slots: scored by their personal board order
        // Other teams: scored by dynasty-ADP rank + positional need + dynasty value tier
        const rankSource = isMySlot ? boardSorted : fullPool;

        const best = rankSource
          .filter((r: any) => !isUsed(r))
          .map((r: any, rankIdx: number) => {
            const baseScore = 1000 / (rankIdx + 1);
            const nm = needMult(rosterId, r.position, simCounts, round);
            // Dynasty value bonus: FC value differences within same ADP tier
            const dynVal = getRookieValue(r);
            const valBonus = dynVal > 0 ? Math.min(0.20, dynVal / 50000) : 0;
            // Owner tendency: how much this owner historically drafts this position
            // Only applied to non-user slots; user's own slots use personal board order
            const tm = isMySlot ? 1 : tendencyMult(rosterId, r.position);
            return { ...r, score: baseScore * nm * tm * (1 + valBonus) };
          })
          .sort((a: any, b: any) => b.score - a.score)[0];

        if (best) {
          const boardRank = rookies.findIndex((r: any) => (r.player_id && r.player_id === best.player_id) || normName(r.name) === normName(best.name)) + 1;
          // poolRank = player's position in consensus dynasty-value pool (1 = most valuable).
          // Used to flag REACH/VALUE on user's predicted slots:
          //   overallPick << poolRank → reaching ahead of consensus
          //   overallPick >> poolRank → getting value relative to consensus
          const poolRank = fullPool.findIndex((r: any) => (r.player_id && r.player_id === best.player_id) || normName(r.name) === normName(best.name)) + 1 || 999;
          predictions[slotStr] = { name: best.name, position: best.position, team: best.team || "", adp: best.adp ?? 999, player_id: best.player_id, boardRank, poolRank };
          markUsed(best);
          if (rosterId) { simCounts[rosterId] = simCounts[rosterId] || {}; simCounts[rosterId][best.position] = (simCounts[rosterId][best.position] || 0) + 1; }
        }
      }
    }

    return predictions;
  }, [draftSettings, rosters, rookies, draftPicks, draftedPlayerIds, myDraftSlotPicks, allPicks, selectedLeague, players, calcFcValues, ownerDraftTendencies, user?.user_id]);

  const topAvailableRookies = useMemo(
    () =>
      rookies
        .map((player, index) => ({
          ...player,
          boardRank: index + 1,
        }))
        .filter((player: any) => !draftedPlayerIds.has(String(player.player_id)))
        .slice(0, 10),
    [rookies, draftedPlayerIds]
  );
  const dashboardOwnedPlayers = useMemo(() => {
    const map = new Map<string, any>();
    allLeagueData.forEach((entry: any) => {
      (entry?.roster?.players || []).forEach((playerId: string) => {
        const player = players[playerId];
        if (!player?.full_name) return;
        const existing = map.get(String(playerId)) || {
          player_id: String(playerId),
          leagues: [],
          shareCount: 0,
        };
        existing.player = player;
        existing.shareCount += 1;
        if (entry?.leagueName && !existing.leagues.includes(entry.leagueName)) {
          existing.leagues.push(entry.leagueName);
        }
        map.set(String(playerId), existing);
      });
    });
    return [...map.values()].sort((a, b) => {
      const aValue = Number(players[a.player_id]?.value || 0);
      const bValue = Number(players[b.player_id]?.value || 0);
      return bValue - aValue;
    });
  }, [allLeagueData, players]);


  // Injury report: all owned + watchlisted players, sorted worst status first
  const injuryReportPlayers = useMemo(() => {
    // Build starting lineup map: playerId -> league names where they're a starter
    const startingMap = new Map<string, string[]>();
    allLeagueData.forEach((entry: any) => {
      (entry?.roster?.starters || []).forEach((playerId: string) => {
        if (!playerId || playerId === "0") return;
        const existing = startingMap.get(String(playerId)) || [];
        if (entry?.leagueName && !existing.includes(entry.leagueName)) {
          existing.push(entry.leagueName);
        }
        startingMap.set(String(playerId), existing);
      });
    });

    const seen = new Set<string>();
    const result: Array<{ player: any; playerId: string; leagues: string[]; startingLeagues: string[]; isWatchlisted: boolean }> = [];

    dashboardOwnedPlayers.forEach((entry: any) => {
      if (seen.has(entry.player_id)) return;
      const player = players[entry.player_id];
      if (!player?.full_name || !["QB", "RB", "WR", "TE"].includes(player.position)) return;
      seen.add(entry.player_id);
      result.push({
        player,
        playerId: entry.player_id,
        leagues: entry.leagues || [],
        startingLeagues: startingMap.get(entry.player_id) || [],
        isWatchlisted: watchlistEntries.some((w) => w.player_id === entry.player_id),
      });
    });

    watchlistEntries.forEach((entry) => {
      if (seen.has(entry.player_id)) return;
      const player = players[entry.player_id];
      if (!player?.full_name) return;
      seen.add(entry.player_id);
      result.push({
        player,
        playerId: entry.player_id,
        leagues: [],
        startingLeagues: startingMap.get(entry.player_id) || [],
        isWatchlisted: true,
      });
    });

    const severityOrder = (p: any) => {
      const s = (p.injury_status || p.status || "").toLowerCase();
      if (/ir|pup/.test(s)) return 0;
      if (/out|suspended|inactive/.test(s)) return 1;
      if (/doubtful/.test(s)) return 2;
      if (/questionable/.test(s)) return 3;
      return 4;
    };

    return result.sort((a, b) => severityOrder(a.player) - severityOrder(b.player));
  }, [allLeagueData, dashboardOwnedPlayers, watchlistEntries, players]);

  // ── League transactions feed ──────────────────────────────────────────────
  useEffect(() => {
    if (!leagues.length || !user?.user_id) return;
    setLoadingTransactions(true);
    const run = async () => {
      try {
        // Get current NFL week/leg to know which weeks to fetch (nflState loaded on mount)
        const curWeek = Math.max(1, Math.min(18, nflState?.leg ?? nflState?.week ?? 1));
        const weeks = [curWeek, curWeek - 1, curWeek - 2, curWeek - 3].filter((w) => w >= 1);

        const results = await Promise.all(
          leagues.map(async (league: any) => {
            const [txArrays, usersData, rostersData, draftsData] = await Promise.all([
              Promise.all(
                weeks.map((w) =>
                  fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/${w}`)
                    .then((r) => r.json())
                    .catch(() => [])
                )
              ),
              fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`)
                .then((r) => r.json())
                .catch(() => []),
              fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`)
                .then((r) => r.json())
                .catch(() => []),
              fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`)
                .then((r) => r.json())
                .catch(() => []),
            ]);

            // Build roster_id → display_name map for this league
            const rosterOwnerMap: Record<number, string> = {};
            // Build roster_id → user_id map for slot computation
            const rosterToUser: Record<number, string> = {};
            (rostersData as any[]).forEach((r: any) => {
              const u = (usersData as any[]).find((u: any) => u.user_id === r.owner_id);
              rosterOwnerMap[r.roster_id] = u?.display_name || u?.username || `Team ${r.roster_id}`;
              if (r.owner_id) rosterToUser[r.roster_id] = String(r.owner_id);
            });

            // Draft order for slot computation (current year only)
            const currentDraft = (Array.isArray(draftsData) ? draftsData : [])
              .find((d: any) => d.season === CURRENT_YEAR);
            const draftOrder: Record<string, number> = currentDraft?.draft_order ?? {};
            const totalTeams: number = (rostersData as any[]).length || 0;

            // Annotate each pick in every transaction with its computed slot string
            const annotatedTxs = (txArrays.flat() as any[])
              .filter((tx: any) => tx.status === "complete" && tx.type !== "waiver_failed")
              .map((tx: any) => ({
                ...tx,
                leagueName: league.name,
                leagueId: league.league_id,
                rosterOwnerMap,
                draft_picks: (tx.draft_picks ?? []).map((pick: any) => {
                  if (pick.season === CURRENT_YEAR) {
                    const userId = rosterToUser[pick.roster_id];
                    const baseSlot = Number(draftOrder[String(userId)] ?? 0);
                    const slot = getDraftRoundSlot(currentDraft ?? {}, Number(pick.round), baseSlot, totalTeams);
                    return {
                      ...pick,
                      slot: slot
                        ? `${pick.round}.${String(slot).padStart(2, "0")}`
                        : `${pick.round}.${String(pick.roster_id).padStart(2, "0")}`,
                    };
                  }
                  return { ...pick, slot: String(pick.round) };
                }),
              }));

            return annotatedTxs;
          })
        );

        setLeagueTransactions(
          results
            .flat()
            .sort((a: any, b: any) => (b.created || 0) - (a.created || 0))
            .slice(0, 200)
        );
      } finally {
        setLoadingTransactions(false);
      }
    };
    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagues.length, user?.user_id]);

  useEffect(() => {
    if (!supabaseUser || !dashboardAlerts.length) return;
    const payload = dashboardAlerts.slice(0, 80).map((alert) => ({
      user_id: supabaseUser.id,
      alert_id: alert.id,
      category: alert.category,
      source: alert.source,
      severity: alert.severity,
      title: alert.title,
      detail: alert.detail,
      actionable: alert.actionable,
      dismissed: dismissedAlertIds.includes(alert.id) || !!alert.dismissed,
      league_id: alert.leagueId || null,
      player_id: alert.playerId || null,
      payload: {
        ...(alert.payload || {}),
        link: alert.link || null,
        teamLabel: alert.teamLabel || null,
      },
      updated_at: new Date(alert.timestamp || Date.now()).toISOString(),
    }));
    supabase.from("alerts").upsert(payload, { onConflict: "user_id,alert_id" }).then(() => {});
  }, [supabaseUser?.id, dashboardAlerts, dismissedAlertIds]);

  useEffect(() => {
    const trackedPlayers = [
      ...dashboardOwnedPlayers.map((entry: any) => ({
        playerId: String(entry.player_id),
        player: players[entry.player_id],
        watch: watchlistEntries.find((watch) => watch.player_id === String(entry.player_id)) || null,
        shareCount: entry.shareCount || 0,
        leagues: entry.leagues || [],
      })),
      ...watchlistEntries
        .filter((entry) => !dashboardOwnedPlayers.some((owned: any) => owned.player_id === entry.player_id))
        .map((entry) => ({
          playerId: entry.player_id,
          player: players[entry.player_id],
          watch: entry,
          shareCount: 0,
          leagues: [],
        })),
    ].filter((entry) => entry.player?.full_name);

    if (!trackedPlayers.length) return;

    let savedSnapshots: any = {};
    try {
      savedSnapshots = JSON.parse(localStorage.getItem(alertSnapshotStorageKey) || "{}");
    } catch {
      savedSnapshots = {};
    }

    const nextPlayerSnapshot = Object.fromEntries(
      trackedPlayers.map((entry) => {
        const player = entry.player;
        const value = Number(calcFcValues[entry.playerId] ?? player?.value ?? 0);
        return [entry.playerId, {
          full_name: player.full_name,
          status: String(player.status || ""),
          team: String(player.team || ""),
          value,
          active: player.active !== false,
          shareCount: entry.shareCount || 0,
        }];
      })
    );

    const incomingAlerts: AlertsCenterItem[] = [];

    // Value-change alerts use the Supabase daily baseline (historicalSnapshotRef), NOT localStorage.
    // This prevents false "Bo Nix gained 2,274" fires caused by FC API inconsistencies across sessions.
    // Guards: baseline must be ≥ 12h old AND previous.value must be > 0 (avoids 0→value false positives).
    const historicalBase = historicalSnapshotRef.current;
    const baselineAge = historicalBase ? Date.now() - new Date(historicalBase.recorded_at).getTime() : 0;
    const baselineReady = !!historicalBase && baselineAge >= 12 * 60 * 60 * 1000;

    Object.entries(nextPlayerSnapshot).forEach(([playerId, snapshot]: any) => {
      if (baselineReady) {
        const historical = historicalBase!.players[playerId];
        if (historical && historical.value > 0) {
          const delta = Number(snapshot.value || 0) - Number(historical.value || 0);
          const watch = watchlistEntries.find((entry) => entry.player_id === playerId);
          const upThreshold = Number(watch?.threshold_up || 250);
          const downThreshold = Number(watch?.threshold_down || 250);
          if (delta >= upThreshold) {
            incomingAlerts.push({
              id: `market-up-${playerId}-${snapshot.value}`,
              category: watch ? "watchlist" : "market",
              source: watch ? "watchlist" : "internal",
              severity: delta >= upThreshold * 1.8 ? "high" : "medium",
              title: `${snapshot.full_name} is climbing`,
              detail: `${snapshot.full_name} gained ${delta.toLocaleString()} in value${snapshot.shareCount ? ` across ${snapshot.shareCount} roster${snapshot.shareCount === 1 ? "" : "s"}` : ""}.`,
              actionable: true,
              timestamp: Date.now(),
              playerId,
              teamLabel: snapshot.team || null,
              payload: { delta, direction: "up" },
            });
          } else if (delta <= -downThreshold) {
            incomingAlerts.push({
              id: `market-down-${playerId}-${snapshot.value}`,
              category: watch ? "watchlist" : "market",
              source: watch ? "watchlist" : "internal",
              severity: delta <= -downThreshold * 1.8 ? "high" : "medium",
              title: `${snapshot.full_name} is falling`,
              detail: `${snapshot.full_name} dropped ${Math.abs(delta).toLocaleString()} in value${snapshot.shareCount ? ` across ${snapshot.shareCount} roster${snapshot.shareCount === 1 ? "" : "s"}` : ""}.`,
              actionable: true,
              timestamp: Date.now(),
              playerId,
              teamLabel: snapshot.team || null,
              payload: { delta, direction: "down" },
            });
          }
        }
      }

      // Status/team alerts use localStorage (most-recent state) — these need immediate detection,
      // not a daily gate. A player going on IR should alert right away.
      const previous = savedSnapshots?.players?.[playerId];
      if (!previous) return;

      if (snapshot.status !== previous.status) {
        const nextStatus = snapshot.status || (snapshot.active ? "active" : "inactive");
        incomingAlerts.push({
          id: `status-${playerId}-${nextStatus}`,
          category: "status",
          source: "internal",
          severity: /out|doubtful|suspended|inactive/i.test(nextStatus) ? "high" : "medium",
          title: `${snapshot.full_name} status changed`,
          detail: `${snapshot.full_name} moved from ${previous.status || "active"} to ${nextStatus}.`,
          actionable: true,
          timestamp: Date.now(),
          playerId,
          teamLabel: snapshot.team || null,
          payload: { previousStatus: previous.status || "", nextStatus },
        });

        // Opportunity alert: when a tracked player goes out, surface their backup
        if (/out|doubtful|ir|suspended|inactive/i.test(nextStatus)) {
          const injuredPlayer = players[playerId];
          if (injuredPlayer?.team && injuredPlayer?.position) {
            const backups = Object.entries(players as Record<string, any>)
              .filter(([pid, p]: [string, any]) =>
                pid !== playerId &&
                p?.team === injuredPlayer.team &&
                p?.position === injuredPlayer.position &&
                p?.depth_chart_position != null &&
                !/out|ir|suspended|inactive/i.test((p.injury_status || p.status || "").toLowerCase())
              )
              .sort(([, a]: any, [, b]: any) => (a.depth_chart_position ?? 99) - (b.depth_chart_position ?? 99));

            if (backups.length > 0) {
              const [backupId, backup]: any = backups[0];
              incomingAlerts.push({
                id: `opp-${playerId}-${backupId}`,
                category: "market",
                source: "internal",
                severity: "medium",
                title: `${backup.full_name} opportunity`,
                detail: `With ${snapshot.full_name} now ${nextStatus.toLowerCase()}, ${backup.full_name} (${backup.team || injuredPlayer.team}) moves into an expanded role.`,
                actionable: true,
                timestamp: Date.now(),
                playerId: String(backupId),
                teamLabel: backup.team || null,
                payload: { injuredPlayerId: playerId, injuredName: snapshot.full_name, triggerStatus: nextStatus },
              });
            }
          }
        }
      }

      if (snapshot.team && previous.team && snapshot.team !== previous.team) {
        incomingAlerts.push({
          id: `team-${playerId}-${snapshot.team}`,
          category: "status",
          source: "internal",
          severity: "medium",
          title: `${snapshot.full_name} changed teams`,
          detail: `${snapshot.full_name} moved from ${previous.team} to ${snapshot.team}.`,
          actionable: true,
          timestamp: Date.now(),
          playerId,
          teamLabel: snapshot.team,
          payload: { previousTeam: previous.team, nextTeam: snapshot.team },
        });
      }
    });

    const nextSnapshots = {
      players: nextPlayerSnapshot,
    };

    localStorage.setItem(alertSnapshotStorageKey, JSON.stringify(nextSnapshots));

    // Build a comprehensive snapshot: all QB/RB/WR/TE with calcFcValues, merged with owned-player data.
    // This is used for Value Trends so it covers the full player universe, not just owned players.
    const buildFullSnapshot = () => {
      const snap: Record<string, any> = { ...nextPlayerSnapshot };
      const calcEntries = Object.entries(calcFcValues as Record<string, number>).filter(([, v]) => v > 0);
      if (calcEntries.length > 50) {
        calcEntries.forEach(([playerId, value]) => {
          const p = players[playerId];
          if (!p || !["QB", "RB", "WR", "TE"].includes(p.position)) return;
          if (!snap[playerId]) {
            snap[playerId] = { full_name: p.full_name, value, team: p.team || "" };
          }
        });
      }
      return snap;
    };

    if (!alertBootstrapRef.current) {
      alertBootstrapRef.current = true;
      // Auto-save snapshot to Supabase if it's missing or > 6 days old.
      // FC values don't shift meaningfully day-to-day; 6-day cadence gives a useful trend window.
      // Users can also manually take a snapshot from the Data Hub → Value Trends tab.
      const snapshotAge = historicalSnapshotRef.current
        ? Date.now() - new Date(historicalSnapshotRef.current.recorded_at).getTime()
        : Infinity;
      if (supabaseUser && snapshotAge > 6 * 24 * 60 * 60 * 1000) {
        const recordedAt = new Date().toISOString();
        const fullSnap = buildFullSnapshot();
        supabase
          .from("player_value_snapshots")
          .upsert(
            { user_id: supabaseUser.id, snapshot: fullSnap, recorded_at: recordedAt },
            { onConflict: "user_id" }
          )
          .then(() => {
            const snap = { players: fullSnap, recorded_at: recordedAt };
            historicalSnapshotRef.current = snap;
            setHistoricalSnapshot(snap);
          });
      }
      return;
    }

    // Post-bootstrap: if calcFcValues just loaded and the saved snapshot is too small, expand it.
    // This handles the case where the snapshot was taken before dynasty values were loaded.
    // IMPORTANT: preserve the original recorded_at so this expansion never resets the 6-day clock.
    if (supabaseUser && historicalSnapshotRef.current) {
      const existingCount = Object.keys(historicalSnapshotRef.current.players ?? {}).length;
      const calcCount = Object.values(calcFcValues as Record<string, number>).filter(v => v > 0).length;
      if (calcCount > 100 && calcCount > existingCount + 50) {
        const originalRecordedAt = historicalSnapshotRef.current.recorded_at;
        const fullSnap = buildFullSnapshot();
        supabase
          .from("player_value_snapshots")
          .upsert(
            { user_id: supabaseUser.id, snapshot: fullSnap, recorded_at: originalRecordedAt },
            { onConflict: "user_id" }
          )
          .then(() => {
            const snap = { players: fullSnap, recorded_at: originalRecordedAt };
            historicalSnapshotRef.current = snap;
            setHistoricalSnapshot(snap);
          });
      }
    }

    mergeDashboardAlerts(incomingAlerts);
  }, [
    dashboardOwnedPlayers,
    watchlistEntries,
    players,
    calcFcValues,
    selectedLeague?.league_id,
    selectedLeagueMateProfilesView,
    alertSnapshotStorageKey,
  ]);

  useEffect(() => {
    const trackedNames = [
      ...dashboardOwnedPlayers.slice(0, 8).map((entry: any) => players[entry.player_id]?.full_name),
      ...watchlistEntries.slice(0, 8).map((entry) => entry.label),
    ].filter(Boolean);
    const uniqueNames = Array.from(new Set(trackedNames)).slice(0, 10);
    if (uniqueNames.length === 0) return;

    let cancelled = false;
    setLoadingExternalAlerts(true);
    fetch(`/api/alerts/news?players=${encodeURIComponent(uniqueNames.join("|"))}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data?.items)) return;
        const items = data.items.slice(0, 8).map((item: any) => ({
          id: `news-${String(item.id || item.link || item.title).replace(/[^a-zA-Z0-9_-]/g, "")}`,
          category: "news" as const,
          source: "external" as const,
          severity: (item.impact || item.playerNames?.length > 0) ? "medium" as const : "low" as const,
          title: item.title || "Player news",
          detail: item.summary || item.playerNames?.join(", ") || "External update matched one of your tracked names.",
          actionable: !!item.playerNames?.length,
          timestamp: Number(new Date(item.published || Date.now())),
          link: item.link || null,
          payload: item,
        }));
        mergeDashboardAlerts(items);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingExternalAlerts(false);
      });

    return () => { cancelled = true; };
  }, [dashboardOwnedPlayers, watchlistEntries, players]);

  // ── Bye week alerts ───────────────────────────────────────────────────────
  useEffect(() => {
    if (nflState?.season_type !== "regular") return;
    const currentWeek = Number(nflState?.week || 0);
    if (!currentWeek) return;
    if (!dashboardOwnedPlayers.length && !watchlistEntries.length) return;

    const seen = new Set<string>();
    const alerts: AlertsCenterItem[] = [];

    [...dashboardOwnedPlayers.map((e: any) => String(e.player_id)), ...watchlistEntries.map((e) => e.player_id)]
      .forEach((playerId) => {
        if (seen.has(playerId)) return;
        seen.add(playerId);
        const player = players[playerId];
        if (!player?.full_name) return;
        const byeWeek = Number(player.bye_week || 0);
        if (!byeWeek) return;
        const weeksOut = byeWeek - currentWeek;
        if (weeksOut !== 1 && weeksOut !== 2) return;
        alerts.push({
          id: `bye-${playerId}-wk${byeWeek}-${nflState.season}`,
          category: "status",
          source: "internal",
          severity: weeksOut === 1 ? "medium" : "low",
          title: `${player.full_name} bye ${weeksOut === 1 ? "next week" : "in 2 weeks"}`,
          detail: `${player.full_name} (${player.team || "?"}) is on bye in Week ${byeWeek}. Plan your lineup.`,
          actionable: weeksOut === 1,
          timestamp: Date.now(),
          playerId,
          teamLabel: player.team || null,
          payload: { byeWeek, currentWeek },
        });
      });

    if (alerts.length) mergeDashboardAlerts(alerts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nflState?.week, nflState?.season_type, dashboardOwnedPlayers, watchlistEntries, players]);

  // ── Available player alerts (watchlist player recently dropped) ──────────
  useEffect(() => {
    if (!watchlistEntries.length || !leagueTransactions.length) return;
    const watchlistSet = new Set(watchlistEntries.map((e) => e.player_id));
    const alerts: AlertsCenterItem[] = [];
    const seen = new Set<string>();

    leagueTransactions
      .filter((tx) => tx.type === "free_agent" || tx.type === "waiver")
      .forEach((tx) => {
        Object.keys(tx.drops || {}).forEach((pid) => {
          const key = `${pid}-${tx.leagueId}`;
          if (!watchlistSet.has(pid) || seen.has(key)) return;
          seen.add(key);
          const player = players[pid];
          alerts.push({
            id: `available-${pid}-${tx.leagueId}-${tx.transaction_id}`,
            category: "watchlist",
            source: "watchlist",
            severity: "high",
            title: `${player?.full_name || pid} is available`,
            detail: `A player on your watchlist was recently dropped in ${tx.leagueName}. They may be free to add.`,
            actionable: true,
            timestamp: tx.created || Date.now(),
            playerId: pid,
            leagueId: tx.leagueId,
            teamLabel: player?.team || null,
            payload: { transactionId: tx.transaction_id, leagueName: tx.leagueName },
          });
        });
      });

    if (alerts.length) mergeDashboardAlerts(alerts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueTransactions, watchlistEntries]);

  const visibleDashboardAlerts = useMemo(
    () =>
      dashboardAlerts
        .filter((alert) => !dismissedAlertIds.includes(alert.id) && !alert.dismissed)
        .sort((a, b) => b.timestamp - a.timestamp),
    [dashboardAlerts, dismissedAlertIds]
  );

  const actionableDashboardAlerts = useMemo(
    () => visibleDashboardAlerts.filter((alert) => alert.actionable).slice(0, 6),
    [visibleDashboardAlerts]
  );
  // -------------------------
  // UI
  // -------------------------
  const movePlayer = (fromIndex: number, toIndex: number) => {
  const updated = [...rookies];
  const [moved] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, moved);
  setRookies(updated);
};
// -------------------------
// MY CURRENT LEAGUE PLAYER SET
// -------------------------
const myPlayerSet = new Set<string>(roster?.players || []);
  return (
    <AuthProvider supabaseUser={supabaseUser}>
    <PlayersProvider players={players}>
    <LeagueProvider selectedLeague={selectedLeague} rosters={rosters} users={users}>
    <RosterProvider myRoster={roster}>
      {/* Login overlay — lives outside <main> so no stacking context interferes */}
      {!supabaseUser && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        >
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-full max-w-sm shadow-2xl" style={{ position: "relative", zIndex: 10000 }}>
            <h2 className="text-xl font-bold mb-1 text-center">DynastyZeus</h2>
            <p className="text-sm text-gray-400 text-center mb-6">Sign in to your account</p>
            {supabaseError && <div className="text-red-400 text-sm mb-3">{supabaseError}</div>}
            {supabaseMessage && <div className="text-emerald-400 text-sm mb-3">{supabaseMessage}</div>}
            <form
              className="space-y-3"
              autoComplete="on"
              onSubmit={(e) => {
                e.preventDefault();
                signIn();
              }}
            >
              <input
                id="email"
                name="email"
                className="w-full p-2.5 rounded-lg bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:border-blue-500"
                placeholder="Email"
                type="email"
                autoComplete="username"
                inputMode="email"
                value={loginEmail}
                onChange={(e) => {
                  setLoginEmail(e.target.value);
                  if (supabaseError) setSupabaseError("");
                }}
              />
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  className="w-full p-2.5 pr-20 rounded-lg bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:border-blue-500"
                  type={showLoginPassword ? "text" : "password"}
                  placeholder="Password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => {
                    setLoginPassword(e.target.value);
                    if (supabaseError) setSupabaseError("");
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-white transition"
                >
                  {showLoginPassword ? "Hide" : "Show"}
                </button>
              </div>
              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-lg text-sm font-semibold transition"
              >
                {loginLoading ? "Signing in…" : "Sign In"}
              </button>
              <button
                type="button"
                disabled={resetLoading || loginLoading}
                className="w-full py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-60 rounded-lg text-sm font-semibold transition"
                onClick={(e) => { e.stopPropagation(); resetPassword(); }}
              >
                {resetLoading ? "Sending reset email..." : "Reset Password"}
              </button>
              <button
                type="button"
                disabled={loginLoading}
                className="w-full py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-60 rounded-lg text-sm font-semibold transition"
                onClick={(e) => { e.stopPropagation(); signUp(); }}
              >
                {loginLoading ? "Working..." : "Create Account"}
              </button>
            </form>
          </div>
        </div>
      )}
    <main className="min-h-screen bg-gray-950 text-white">
      {/* App content — always rendered but non-interactive when not signed in */}
      <div className={!supabaseUser ? "pointer-events-none select-none opacity-40" : ""}>
      <>
      {/* HEADER */}
      <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700">
        {/* Top bar */}
        <div className="flex overflow-x-auto scrollbar-none md:justify-center">
          <div className="flex items-center px-3 py-2 gap-4 shrink-0">
          <h1 className="text-base font-bold shrink-0">DynastyZeus</h1>
          <div className="flex items-center gap-2 min-w-0">
            {/* Unified auth status — shows both Supabase account and Sleeper connection */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs">
              {/* DynastyZeus account */}
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${supabaseUser ? "bg-green-400" : "bg-red-500"}`}
                title={supabaseUser ? `Signed in as ${supabaseUser.email}` : "Not signed in"}
              />
              {/* Sleeper connection */}
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${user ? "bg-blue-400" : "bg-gray-600"}`}
                title={user ? `Sleeper: ${user.display_name}` : "Sleeper not connected"}
              />
              {user && (
                <span className="text-gray-400 truncate max-w-[80px]">{user.display_name}</span>
              )}
            </div>
            {user && (
              <button onClick={disconnectSleeper} className="px-2 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600 shrink-0">
                Disconnect
              </button>
            )}
            {leagues.length > 0 && (
              <select
                value={selectedLeague?.league_id || ""}
                onChange={(e) => {
                  const league = leagues.find((l: any) => l.league_id === e.target.value);
                  if (league) {
                    loadRoster(league);
                    if (mainTab === "DASHBOARD") setMainTab("LEAGUES");
                    localStorage.setItem("selectedLeague", JSON.stringify(league));
                  }
                }}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs max-w-[120px] truncate"
              >
                <option value="">Select League</option>
                {leagues.map((l: any) => (
                  <option key={l.league_id} value={l.league_id}>{l.name}</option>
                ))}
              </select>
            )}
            {supabaseUser && (
              <button onClick={signOut} className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 rounded transition shrink-0">
                Log Out
              </button>
            )}
          </div>
          </div>
        </div>
        {/* NAV */}
        <div className="border-t border-gray-800">
          <div className="mx-auto max-w-7xl overflow-x-auto scrollbar-none">
            <div className="flex min-w-max justify-start px-2 md:justify-center">
              {[
                { id: "DASHBOARD", label: "Dashboard" },
                { id: "LEAGUES", label: "League Hub" },
                { id: "DATA_HUB", label: "Data Hub" },
                { id: "DRAFT", label: "Draft Hub" },
                { id: "TRADE_HUB", label: "Trade Hub" },
                { id: "GAMEDAY_HUB", label: "Gameday Hub" },
                { id: "ALERTS", label: "Alert Hub" },
                { id: "MANAGEMENT_HUB", label: "Management Hub" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setMainTab(tab.id)}
                  disabled={!user && tab.id !== "DASHBOARD"}
                  className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition md:px-5 ${
                    mainTab === tab.id
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-gray-400 hover:text-white"
                  } ${!user && tab.id !== "DASHBOARD" ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={
        mainTab === "DRAFT" || mainTab === "TRADE_HUB" || mainTab === "MANAGEMENT_HUB" || mainTab === "LEAGUES" || mainTab === "ALERTS" || mainTab === "GAMEDAY_HUB"
          ? ""
          : (mainTab === "DATA_HUB" && dataHubTab === "DEPTH_CHARTS")
            ? "w-full px-6 py-6"
            : "max-w-3xl mx-auto p-6"
      }>
{mainTab === "DASHBOARD" && (
  <>
    <>
  {!user && (
    <div className="mb-6">
      <div className="flex gap-2">
        <input
          className="p-2 rounded bg-gray-800 w-full"
          placeholder="Enter Sleeper username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !connectLoading) connectSleeper();
          }}
        />
        <button
          onClick={connectSleeper}
          disabled={connectLoading}
          className="bg-blue-600 px-4 rounded disabled:opacity-60"
        >
          {connectLoading ? "Connecting..." : "Connect"}
        </button>
      </div>
      {connectError && <div className="mt-2 text-sm text-red-400">{connectError}</div>}
      {!connectError && connectSuccess && <div className="mt-2 text-sm text-emerald-400">{connectSuccess}</div>}
    </div>
  )}

  <Dashboard
    username={user?.display_name || ""}
    onNavigate={setMainTab}
  />
</>
  </>
)}
        {mainTab === "ALERTS" && (
          <AlertsPage
            alerts={visibleDashboardAlerts}
            actionableAlerts={actionableDashboardAlerts}
            watchlistEntries={watchlistEntries}
            onDismissAlert={dismissDashboardAlert}
            loadingExternalAlerts={loadingExternalAlerts}
            leagueTransactions={leagueTransactions}
            loadingTransactions={loadingTransactions}
            players={players}
            injuryReportPlayers={injuryReportPlayers}
            currentNFLWeek={nflState?.season_type === "regular" ? Number(nflState?.week || 0) : 0}
            allTradeAttempts={allTradeAttempts}
            allLeagues={leagues}
            onNavigateToAttempts={(leagueId) => {
              const league = leagues.find((l: any) => l.league_id === leagueId);
              if (league) {
                loadRoster(league);
                setTradeHubSection("ATTEMPTS");
                setMainTab("TRADE_HUB");
                loadTradeAttempts(leagueId);
              }
            }}
          />
        )}
        {/* LEAGUE HUB */}
        {mainTab === "LEAGUES" && (
          <ErrorBoundary label="League Hub">
          <LeagueHub
            leagueHubTab={leagueHubTab}
            setLeagueHubTab={setLeagueHubTab}
            activeLeagueHubGroup={activeLeagueHubGroup}
            leagues={leagues}
            user={user}
            standings={standings}
            setSelectedLeague={setSelectedLeague}
            picks={picks}
            allPicks={allPicks}
            pickFcValues={pickFcValues}
            calcFcValues={calcFcValues}
            redraftValues={redraftValues}
            committedSimsByLeague={committedSimsByLeague}
            leagueSimCache={leagueSimCache}
            simQueue={simQueue}
            simProgress={simProgress}
            loadingLeagueMateIntel={loadingLeagueMateIntel}
            loadingCrossLeagueMateIntel={loadingCrossLeagueMateIntel}
            loadingActivity={loadingActivity}
            loadingLeagueWeeklyMatchups={loadingLeagueWeeklyMatchups}
            leagueNotes={leagueNotes}
            activityTransactions={activityTransactions}
            leagueOverviewData={leagueOverviewData}
            loadingLeagueOverview={loadingLeagueOverview}
            leagueOverviewLoaded={leagueOverviewLoaded}
            teamSummary={teamSummary}
            selectedLeagueDirection={selectedLeagueDirection}
            selectedLeagueDirectionAdjusted={selectedLeagueDirectionAdjusted}
            selectedLeagueSimulation={selectedLeagueSimulation}
            selectedLeagueMateProfilesView={selectedLeagueMateProfilesView}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            search={search}
            setSearch={setSearch}
            oppRosterTab={oppRosterTab}
            setOppRosterTab={setOppRosterTab}
            oppRosterOwnerId={oppRosterOwnerId}
            setOppRosterOwnerId={setOppRosterOwnerId}
            oppRosterSearch={oppRosterSearch}
            setOppRosterSearch={setOppRosterSearch}
            prSortKey={prSortKey}
            setPrSortKey={setPrSortKey}
            prSortAsc={prSortAsc}
            setPrSortAsc={setPrSortAsc}
            prPopup={prPopup}
            setPrPopup={setPrPopup}
            prMode={prMode}
            setPrMode={setPrMode}
            ignoredOwnerIds={ignoredOwnerIds}
            toggleIgnoredOwner={toggleIgnoredOwner}
            projectionData={projectionData}
            draftPicks={draftPicks}
            draftOrder={draftOrder}
            draftSettings={draftSettings}
            myDraftSlotPicks={myDraftSlotPicks}
            setMyDraftSlotPicks={setMyDraftSlotPicks}
            draftSlotEditing={draftSlotEditing}
            setDraftSlotEditing={setDraftSlotEditing}
            draftSlotSearchQuery={draftSlotSearchQuery}
            setDraftSlotSearchQuery={setDraftSlotSearchQuery}
            draftHubSection={draftHubSection}
            nflState={nflState}
            leagueSearch={leagueSearch}
            setLeagueSearch={setLeagueSearch}
            filteredPlayers={filteredPlayers}
            freeAgents={freeAgents}
            loadingCalcValues={loadingCalcValues}
            predictedDraftPicks={predictedDraftPicks}
            loadingDraftRefresh={loadingDraftRefresh}
            rookies={rookies}
            draftedPlayerIds={draftedPlayerIds}
            loadRoster={loadRoster}
            loadLeagueOverview={loadLeagueOverview}
            loadRedraftValues={loadRedraftValues}
            loadUserTrades={loadUserTrades}
            loadUserExposure={loadUserExposure}
            loadDraftScout={loadDraftScout}
            saveLeagueNote={saveLeagueNote}
            onSaveSim={saveSimulationToSupabase}
            handleRunAllSims={handleRunAllSims}
            refreshDraftBoard={refreshDraftBoard}
            setPlayerProfileId={setPlayerProfileId}
            setCalcOpponentRosterId={setCalcOpponentRosterId}
            setMainTab={setMainTab}
            setTradeHubSection={setTradeHubSection}
          />
          </ErrorBoundary>
        )}

        {mainTab === "GAMEDAY_HUB" && (
          <ErrorBoundary label="Gameday Hub">
          <GamedayHub
            leagues={leagues}
            loadRoster={loadRoster}
            gamedayWeek={gamedayWeek}
            gamedayMatchupCards={gamedayMatchupCards}
            loadingGamedayMatchups={loadingGamedayMatchups}
            selectedGamedayMatchup={selectedGamedayMatchup}
            setSelectedGamedayMatchupId={setSelectedGamedayMatchupId}
            loadGamedayMatchups={loadGamedayMatchups}
            setProjectionWeek={setProjectionWeek}
            setProjectionLoaded={setProjectionLoaded}
            loadProjections={loadProjections}
            setPlayerProfileId={setPlayerProfileId}
            shares={shares}
            totalLeagues={totalLeagues}
            loadingShares={loadingAllLeagueData}
            shareSearch={shareSearch}
            setShareSearch={setShareSearch}
            sharePosition={sharePosition}
            setSharePosition={setSharePosition}
            players={players}
          />
          </ErrorBoundary>
        )}


        {/* DATA HUB TAB */}
        {mainTab === "DATA_HUB" && (
          <ErrorBoundary label="Data Hub">
          <DataHub
            dataHubTab={dataHubTab}
            setDataHubTab={setDataHubTab}
            shares={shares}
            calcFcValues={calcFcValues}
            dynastyRankPos={dynastyRankPos}
            setDynastyRankPos={setDynastyRankPos}
            loadingCalcValues={loadingCalcValues}
            playerDispositions={playerDispositions}
            savePlayerDisposition={savePlayerDisposition}
            setPlayerProfileId={setPlayerProfileId}
            redraftValues={redraftValues}
            loadingRedraft={loadingRedraft}
            projectionData={projectionData}
            setProjectionData={setProjectionData}
            projectionPosFilter={projectionPosFilter}
            setProjectionPosFilter={setProjectionPosFilter}
            projectionWeek={projectionWeek}
            setProjectionWeek={setProjectionWeek}
            setProjectionLoaded={setProjectionLoaded}
            loadProjections={loadProjections}
            projectionSeasonYear={projectionSeasonYear}
            projectionSourceStatus={projectionSourceStatus}
            loadingProjections={loadingProjections}
            projectionUsesSeasonFallback={projectionUsesSeasonFallback}
            allPicks={allPicks}
            selectedLeagueDynamicPickValues={selectedLeagueDynamicPickValues}
            leagues={leagues}
            user={user}
            leagueMateStats={leagueMateStats}
            setLeagueMateStats={setLeagueMateStats}
            leagueMateStatsLoaded={leagueMateStatsLoaded}
            setLeagueMateStatsLoaded={setLeagueMateStatsLoaded}
            loadingLeagueMateStats={loadingLeagueMateStats}
            setLoadingLeagueMateStats={setLoadingLeagueMateStats}
            leagueMateSearch={leagueMateSearch}
            setLeagueMateSearch={setLeagueMateSearch}
            leagueMateSort={leagueMateSort}
            setLeagueMateSort={setLeagueMateSort}
            loadUserExposure={loadUserExposure}
            selectedUserId={selectedUserId}
            externalShares={externalShares}
            loadingShares={loadingShares}
            historicalSnapshot={historicalSnapshot}
            onSaveSnapshot={saveSnapshotNow}
          />
          </ErrorBoundary>
        )}
{mainTab === "DRAFT" && (
  <ErrorBoundary label="Draft Hub">
  <DraftHub
    draftHubSection={draftHubSection}
    setDraftHubSection={setDraftHubSection}
    myDraftSlotPicks={myDraftSlotPicks}
    setMyDraftSlotPicks={setMyDraftSlotPicks}
    draftSlotEditing={draftSlotEditing}
    setDraftSlotEditing={setDraftSlotEditing}
    draftSlotSearchQuery={draftSlotSearchQuery}
    setDraftSlotSearchQuery={setDraftSlotSearchQuery}
    user={user}
    draftSettings={draftSettings}
    draftPicks={draftPicks}
    draftOrder={draftOrder}
    allPicks={allPicks}
    rookies={rookies}
    rookieSearch={rookieSearch}
    setRookieSearch={setRookieSearch}
    dragIndex={dragIndex}
    setDragIndex={setDragIndex}
    tempRanks={tempRanks}
    setTempRanks={setTempRanks}
    draftedPlayerIds={draftedPlayerIds}
    predictedDraftPicks={predictedDraftPicks}
    topAvailableRookies={topAvailableRookies}
    refreshDraftBoard={refreshDraftBoard}
    loadDraftScout={loadDraftScout}
    movePlayer={movePlayer}
    handleRankChange={handleRankChange}
    loadingDraftRefresh={loadingDraftRefresh}
    leagues={leagues}
    calcFcValues={calcFcValues}
    pickFcValues={pickFcValues}
    fcNameValues={fcNameValues}
  />
  </ErrorBoundary>
)}

      </div>
{/* ── TRADE HUB TAB ────────────────────────────────────────────────── */}
{mainTab === "TRADE_HUB" && (
  <ErrorBoundary label="Trade Hub">
  <TradeHub
    tradeHubSection={tradeHubSection}
    setTradeHubSection={setTradeHubSection}
    leagues={leagues}
    user={user}
    allPicks={allPicks}
    pickFcValues={pickFcValues}
    calcFcValues={calcFcValues}
    redraftValues={redraftValues}
    selectedLeagueDynamicPickValues={selectedLeagueDynamicPickValues}
    selectedLeagueDirection={selectedLeagueDirection}
    selectedLeagueDirectionAdjusted={selectedLeagueDirectionAdjusted}
    selectedLeagueSimulation={selectedLeagueSimulation}
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
    finderSeed={finderSeed}
    setFinderSeed={setFinderSeed}
    finderPinnedPlayerId={finderPinnedPlayerId}
    setFinderPinnedPlayerId={setFinderPinnedPlayerId}
    finderTargetOppRosterId={finderTargetOppRosterId}
    setFinderTargetOppRosterId={setFinderTargetOppRosterId}
    finderTargetPlayerId={finderTargetPlayerId}
    setFinderTargetPlayerId={setFinderTargetPlayerId}
    selectedLeagueDraftHasOccurred={selectedLeagueDraftHasOccurred}
    loadingCalcValues={loadingCalcValues}
    calcSearchA={calcSearchA}
    setCalcSearchA={setCalcSearchA}
    calcSearchB={calcSearchB}
    setCalcSearchB={setCalcSearchB}
    playerDispositions={playerDispositions}
    leaguePlayerTags={leaguePlayerTags}
    onToggleLeaguePlayerTag={handleToggleLeaguePlayerTag}
    leagueMateProfileByRosterId={leagueMateProfileByRosterId}
    selectedLeagueMateProfilesView={selectedLeagueMateProfilesView}
    tradeRecommendationCards={tradeRecommendationCards}
    tradePartnerRankings={tradePartnerRankings}
    setPlayerProfileId={setPlayerProfileId}
    loadUserExposure={loadUserExposure}
    loadUserTrades={loadUserTrades}
    historicalSnapshot={historicalSnapshot}
    tradeHubData={tradeHubData}
    loadingTradeHub={loadingTradeHub}
    tradeHubUserId={tradeHubUserId}
    tradeAttempts={tradeAttempts}
    loadingTradeAttempts={loadingTradeAttempts}
    tradeAttemptsLeagueId={tradeAttemptsLeagueId}
    onMarkAttempted={markTradeAttempted}
    onUpdateAttemptStatus={updateAttemptStatus}
    onDeleteAttempt={deleteAttempt}
    onLoadTradeAttempts={loadTradeAttempts}
    onRefreshDirection={() => { if (selectedLeague) { loadRedraftValues(); loadRoster(selectedLeague); } }}
    buyLowPlayerIds={buyLowPlayerIds}
    ignoredOwnerIds={ignoredOwnerIds}
    toggleIgnoredOwner={toggleIgnoredOwner}
    nflState={nflState}
    playerStats={playerStats}
    crossLeagueExposure={shares}
  />
  </ErrorBoundary>
)}

      {selectedUserId && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
    <div className="bg-gray-900 p-6 rounded w-96">

      <div className="text-lg font-bold mb-4">
        {users[selectedUserId]}'s Top Owned Players
      </div>

      {loadingShares ? (
        <div className="text-sm text-gray-400">
          Loading exposure...
        </div>
      ) : (
        externalShares?.players?.map((entry: any) => {
  const p = players[entry.playerId];
  if (!p) return null;

  const isMine = myPlayerSet.has(entry.playerId);

  return (
  <div
    key={entry.playerId}
    className={`flex items-center justify-between text-sm py-1 px-2 ${
      isMine ? "bg-green-900/30 border border-green-700 rounded" : ""
    }`}
  >
    <div className="truncate">
      {p.full_name}
      {isMine && (
        <span className="ml-2 text-green-400 text-xs">
          🔥
        </span>
      )}
    </div>

    <div className="text-gray-400 text-xs whitespace-nowrap ml-2">
      {entry.count} • {entry.percent}%
    </div>
  </div>
);
})
      )}

      <button
        onClick={() => setSelectedUserId(null)}
        className="mt-4 w-full bg-blue-600 p-2 rounded"
      >
        Close
      </button>
    </div>
  </div>
)}

{/* ── MANAGEMENT HUB TAB ──────────────────────────────────────────── */}
{mainTab === "MANAGEMENT_HUB" && (
  <ErrorBoundary label="Management Hub">
  <ManagementHub
    mgmtHubTab={mgmtHubTab}
    setMgmtHubTab={setMgmtHubTab}
    leagues={leagues}
    leagueMgmtData={leagueMgmtData}
    setLeagueMgmtData={setLeagueMgmtData}
    commPaymentsData={commPaymentsData}
    setCommPaymentsData={setCommPaymentsData}
    commToolsLeagueId={commToolsLeagueId}
    setCommToolsLeagueId={setCommToolsLeagueId}
    commToolsRosters={commToolsRosters}
    setCommToolsRosters={setCommToolsRosters}
    commToolsUsers={commToolsUsers}
    setCommToolsUsers={setCommToolsUsers}
    loadingCommToolsRosters={loadingCommToolsRosters}
    setLoadingCommToolsRosters={setLoadingCommToolsRosters}
  />
  </ErrorBoundary>
)}

{/* DRAFT SCOUT MODAL */}
{draftScoutUserId && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
    <div className="bg-gray-900 p-6 rounded-xl w-[560px] max-h-[85vh] overflow-y-auto">

      <div className="text-lg font-bold mb-1">
        {users[draftScoutUserId]}'s {ROOKIE_YEAR} Rookie Drafts
      </div>
      <div className="text-xs text-gray-500 mb-4">
        All leagues — patterns based on completed/in-progress picks
      </div>

      {loadingDraftScout ? (
        <div className="text-sm text-gray-400">Loading draft history...</div>
      ) : !draftScoutData?.length ? (
        <div className="text-sm text-gray-400">No {ROOKIE_YEAR} drafts started yet.</div>
      ) : (() => {
        const posColor = (pos: string) =>
          pos === "WR" ? "text-sky-300 bg-sky-900/40" :
          pos === "RB" ? "text-green-300 bg-green-900/40" :
          pos === "QB" ? "text-red-300 bg-red-900/40" :
          pos === "TE" ? "text-yellow-300 bg-yellow-900/40" :
          "text-gray-300 bg-gray-700/40";
        const posText = (pos: string) =>
          pos === "WR" ? "text-sky-300" :
          pos === "RB" ? "text-green-300" :
          pos === "QB" ? "text-red-300" :
          pos === "TE" ? "text-yellow-300" :
          "text-gray-400";
        return (
          <>
            {/* Pattern Analysis Card */}
            {draftScoutPatterns && (
              <div className="bg-gray-800/70 rounded-lg p-4 mb-5 border border-gray-700">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Draft Tendencies — {draftScoutPatterns.n} league{draftScoutPatterns.n !== 1 ? "s" : ""} · {draftScoutPatterns.total} picks
                </div>

                {draftScoutPatterns.tendencies.length > 0 && (
                  <ul className="mb-4 space-y-1">
                    {draftScoutPatterns.tendencies.map((t: string, i: number) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-gray-200">
                        <span className="text-blue-400 mt-0.5 shrink-0">•</span>
                        {t}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mb-3">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Overall Position Mix</div>
                  <div className="flex flex-wrap gap-1.5">
                    {draftScoutPatterns.sortedPos.map(([pos, count]: [string, number]) => (
                      <span key={pos} className={`text-[11px] px-2 py-0.5 rounded font-semibold ${posColor(pos)}`}>
                        {pos} {count} ({Math.round(count / draftScoutPatterns.total * 100)}%)
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Round-by-Round</div>
                  <div className="space-y-1.5">
                    {Object.entries(draftScoutPatterns.roundBreakdown)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([round, counts]: [string, any]) => (
                        <div key={round} className="flex items-center gap-2">
                          <span className={`text-[10px] w-10 text-center px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                            round === "1" ? "bg-yellow-900/50 text-yellow-300" :
                            round === "2" ? "bg-green-900/50 text-green-300" :
                            round === "3" ? "bg-blue-900/50 text-blue-300" :
                                            "bg-orange-900/50 text-orange-300"
                          }`}>Rd {round}</span>
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(counts)
                              .sort(([, a]: any, [, b]: any) => b - a)
                              .map(([pos, cnt]: [string, any]) => (
                                <span key={pos} className={`text-[10px] px-1.5 py-0.5 rounded ${posColor(pos)}`}>
                                  {pos} ×{cnt}
                                </span>
                              ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* Per-league picks */}
            {draftScoutData.map((league: any, i: number) => (
              <div key={i} className="mb-5">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  {league.leagueName}
                </div>
                {league.picks.length === 0 ? (
                  <div className="text-xs text-gray-500 italic">No picks made yet</div>
                ) : (
                  league.picks.map((pick: any, j: number) => {
                    const name = pick.player?.full_name || pick.playerName || "Unknown";
                    const pos = pick.player?.position || pick.position || "—";
                    return (
                      <div
                        key={j}
                        className="flex items-center justify-between bg-gray-800 rounded px-3 py-1.5 mb-1 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                            pick.round === 1 ? "bg-yellow-900/50 text-yellow-300" :
                            pick.round === 2 ? "bg-green-900/50 text-green-300" :
                            pick.round === 3 ? "bg-blue-900/50 text-blue-300" :
                                              "bg-orange-900/50 text-orange-300"
                          }`}>
                            {pick.slot}
                          </span>
                          <span className="font-medium">{name}</span>
                        </div>
                        <span className={`text-xs font-semibold ${posText(pos)}`}>{pos}</span>
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </>
        );
      })()}

      <button
        onClick={() => { setDraftScoutUserId(null); setDraftScoutData(null); }}
        className="mt-2 w-full bg-blue-600 p-2 rounded text-sm"
      >
        Close
      </button>
    </div>
  </div>
)}

{/* TRADE HUB MODAL — opponent trades only; own trades shown inline in Trade Log tab */}
{tradeHubUserId && user && tradeHubUserId !== user.user_id && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
    <div className="bg-gray-900 p-6 rounded-xl w-[560px] max-h-[85vh] overflow-y-auto">

      <div className="text-lg font-bold mb-1">
        {users[tradeHubUserId] || "Manager"}'s Recent Trades
      </div>
      <div className="text-xs text-gray-500 mb-5">
        Past 30 days · All dynasty leagues · Up to 15 trades
      </div>

      {loadingTradeHub ? (
        <div className="text-sm text-gray-400">Loading trades...</div>
      ) : !tradeHubData?.length ? (
        <div className="text-sm text-gray-400">No trades found in the past 30 days.</div>
      ) : (
        tradeHubData.map((trade: any, i: number) => {
          const myRosterId = trade.myRosterId;

          // Players received
          const received = Object.entries(trade.adds || {})
            .filter(([, rid]) => rid === myRosterId)
            .map(([pid]) => players[pid]?.full_name || "Unknown Player");

          // Players given
          const given = Object.entries(trade.adds || {})
            .filter(([, rid]) => rid !== myRosterId)
            .map(([pid]) => players[pid]?.full_name || "Unknown Player");

          // Resolve actual draft slot (e.g. "2026 1.04") from allPicks when available
          const pickLabel = (p: any) => {
            if (String(p.season) === CURRENT_YEAR) {
              const match = allPicks.find(
                (ap) =>
                  String(ap.season) === String(p.season) &&
                  Number(ap.round) === Number(p.round) &&
                  Number(ap.roster_id) === Number(p.roster_id)
              );
              if (match?.slot?.includes(".")) return `${p.season} ${match.slot}`;
            }
            return `${p.season} Rd ${p.round}`;
          };

          // Picks received / given
          const picksReceived = (trade.draft_picks || [])
            .filter((p: any) => p.owner_id === myRosterId)
            .map(pickLabel);

          const picksGiven = (trade.draft_picks || [])
            .filter((p: any) => p.previous_owner_id === myRosterId)
            .map(pickLabel);

          const allReceived = [...received, ...picksReceived];
          const allGiven = [...given, ...picksGiven];

          return (
            <div key={i} className="bg-gray-800 rounded-xl p-4 mb-3">

              {/* Header */}
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">
                  {trade.leagueName}
                </span>
                <span className="text-xs text-gray-500">
                  {formatRelativeDate(trade.created)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">

                {/* Received */}
                <div>
                  <div className="text-[10px] text-green-400 font-semibold uppercase mb-1">
                    Received
                  </div>
                  {allReceived.length ? allReceived.map((item, j) => (
                    <div key={j} className="text-sm text-white py-0.5">{item}</div>
                  )) : (
                    <div className="text-xs text-gray-500 italic">Nothing</div>
                  )}
                </div>

                {/* Given */}
                <div>
                  <div className="text-[10px] text-red-400 font-semibold uppercase mb-1">
                    Gave
                  </div>
                  {allGiven.length ? allGiven.map((item, j) => (
                    <div key={j} className="text-sm text-white py-0.5">{item}</div>
                  )) : (
                    <div className="text-xs text-gray-500 italic">Nothing</div>
                  )}
                </div>

              </div>
            </div>
          );
        })
      )}

      <button
        onClick={() => { setTradeHubUserId(null); setTradeHubData(null); }}
        className="mt-2 w-full bg-blue-600 p-2 rounded text-sm"
      >
        Close
      </button>
    </div>
  </div>
)}
      {/* ── Global Player Profile Panel ── */}
      {(() => {
        if (!playerProfileId) return null;
        const p = players[playerProfileId];
        if (!p) return null;
        const dynVal = calcFcValues[playerProfileId] ?? p.value ?? 0;
        const redVal = redraftValues[playerProfileId] ?? 0;
        const injuryStatus = p.injury_status || p.status;
        const injuryNote = [p.injury_body_part, p.injury_notes].filter(Boolean).join(" — ");
        const practiceDesc = p.practice_description || p.practice_participation || "";
        const injuryColor =
          injuryStatus === "IR" || injuryStatus === "PUP" ? "bg-red-900/50 text-red-300 border-red-700" :
          injuryStatus === "Out" ? "bg-red-900/40 text-red-400 border-red-800" :
          injuryStatus === "Doubtful" ? "bg-orange-900/40 text-orange-400 border-orange-700" :
          injuryStatus === "Questionable" ? "bg-yellow-900/40 text-yellow-400 border-yellow-700" :
          "bg-green-900/30 text-green-400 border-green-700";

        // Which leaguemates own this player
        const ownersInSelectedLeague = rosters
          .filter((r: any) => (r.players || []).includes(playerProfileId))
          .map((r: any) => users[r.owner_id] || `Team ${r.roster_id}`);

        // Cross-league ownership from overview data (uses per-league user map fetched during loadLeagueOverview)
        const crossLeagueOwners: { leagueName: string; owner: string }[] = [];
        Object.entries(leagueOverviewData).forEach(([lid, entry]: [string, any]) => {
          const lg = leagues.find((l: any) => l.league_id === lid);
          if (!lg) return;
          const leagueUserMap: Record<string, string> = entry.userMap || {};
          (entry.rosters || []).forEach((r: any) => {
            if ((r.players || []).includes(playerProfileId)) {
              const ownerName = leagueUserMap[r.owner_id] || users[r.owner_id] || `Team ${r.roster_id}`;
              crossLeagueOwners.push({ leagueName: lg.name, owner: ownerName });
            }
          });
        });

        const noteVal = playerNotes[playerProfileId] ?? "";
        const disp = playerDispositions[playerProfileId] ?? { sell: "Neutral", buy: "Neutral" };

        return (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setPlayerProfileId(null)}
            />
            {/* Panel */}
            <div className="fixed top-0 right-0 h-full w-full max-w-sm bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl overflow-y-auto">
              {/* Header */}
              <div className="flex items-start justify-between p-5 border-b border-gray-800">
                <div>
                  <h2 className="text-lg font-bold text-white">{p.full_name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400">{p.position}</span>
                    {p.team && <span className="text-xs text-gray-500">· {p.team}</span>}
                    {p.age && <span className="text-xs text-gray-500">· Age {p.age}</span>}
                  </div>
                </div>
                <button onClick={() => setPlayerProfileId(null)} className="text-gray-500 hover:text-white text-xl leading-none mt-1">✕</button>
              </div>

              <div className="p-5 space-y-5 flex-1">
                {/* Values */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Dynasty Value</p>
                    <p className="text-xl font-bold text-white">{dynVal > 0 ? dynVal.toLocaleString() : "—"}</p>
                  </div>
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Redraft Value</p>
                    <p className="text-xl font-bold text-white">{redVal > 0 ? redVal.toLocaleString() : "—"}</p>
                  </div>
                </div>

                {/* Injury / Status */}
                <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Status</p>
                  <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${injuryColor}`}>
                    {injuryStatus || "Active"}
                  </span>
                  {injuryNote && <p className="text-xs text-gray-400 mt-1.5">{injuryNote}</p>}
                  {practiceDesc && <p className="text-xs text-gray-500 mt-1">{practiceDesc}</p>}
                </div>

                {/* Ownership */}
                {ownersInSelectedLeague.length > 0 && (
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      Owned in {selectedLeague?.name || "Selected League"}
                    </p>
                    {ownersInSelectedLeague.map((name, i) => (
                      <p key={i} className="text-sm text-white">{name}</p>
                    ))}
                  </div>
                )}

                {crossLeagueOwners.length > 0 && (
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Cross-League Ownership</p>
                    <div className="space-y-1">
                      {crossLeagueOwners.map((entry, i) => (
                        <div key={i} className="flex items-baseline justify-between text-xs">
                          <span className="text-white truncate mr-2">{entry.owner}</span>
                          <span className="text-gray-500 shrink-0">{entry.leagueName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {ownersInSelectedLeague.length === 0 && crossLeagueOwners.length === 0 && (
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Ownership</p>
                    <p className="text-xs text-gray-600">Not on any loaded roster.</p>
                  </div>
                )}

                {/* Dispositions */}
                <div className="bg-gray-900 rounded-xl p-3 border border-gray-800 space-y-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Trade Disposition</p>
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1">Trading Away</p>
                    <select
                      value={disp.sell}
                      onChange={(e) => savePlayerDisposition(playerProfileId, e.target.value, disp.buy)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="Not Willing to Trade">Not Willing to Trade</option>
                      <option value="Will Trade but Higher than Market">Will Trade but Higher than Market</option>
                      <option value="Neutral">Neutral</option>
                      <option value="Lower than Market">Lower than Market</option>
                      <option value="Trade at All Costs">Trade at All Costs</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1">Trading For</p>
                    <select
                      value={disp.buy}
                      onChange={(e) => savePlayerDisposition(playerProfileId, disp.sell, e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="Buy Over Market">Buy Over Market</option>
                      <option value="Buy at Market">Buy at Market</option>
                      <option value="Neutral">Neutral</option>
                      <option value="Buy Low">Buy Low</option>
                      <option value="Zero Interest">Zero Interest</option>
                    </select>
                  </div>
                  {(disp.sell !== "Neutral" || disp.buy !== "Neutral") && (
                    <p className="text-[10px] text-blue-400">Trade Finder will factor in these preferences.</p>
                  )}
                </div>

                {/* Notes */}
                <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Your Notes</p>
                  <textarea
                    value={noteVal}
                    onChange={(e) => savePlayerNote(playerProfileId, e.target.value)}
                    placeholder={`Jot down thoughts on ${p.first_name || p.full_name}…`}
                    className="w-full h-28 bg-gray-800 border border-gray-700 rounded-lg p-2.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>
              </div>
            </div>
          </>
        );
      })()}

      </>
      </div>
    </main>
    </RosterProvider>
    </LeagueProvider>
    </PlayersProvider>
    </AuthProvider>
  );
}

