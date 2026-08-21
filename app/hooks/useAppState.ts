"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { LEAGUE_HUB_GROUPS } from "../../lib/leagueHubGroups";
import { supabase } from "../../lib/supabaseclient";
import { logger } from "../../lib/logger";

const log = logger("app/page");
import { useAuthState, LAST_LOGIN_EMAIL_KEY } from "./useAuthState";
import { useHubRouting } from "./useHubRouting";
import { normalizeRookieName } from "../../components/draftHub/shared";
import {
  CURRENT_YEAR, YEARS, ROUNDS,
  getStoredPickValue, getDraftRoundSlot,
  getBucketColor, getAdjustedDirectionBucket, classifyOppDirection,
  sum,
  getProjectionKickoffAt, getKickoffState,
  formatKickoffTime,
  getRosterDirectionProfile, getProfilePosBuckets,
  getLeagueMateMotivation, getTradePartnerFitLabel, getTradePartnerFit,
  getCrossLeaguePreferenceFit, getCrossLeagueTradeBehaviorFit,
  fetchFantasyCalcValues,
  computeScoringMultipliers,
  getLeagueNumQbs,
} from "../../lib/helpers";
import { projectRookiesByRoster } from "../../lib/helpers/rookieProjection";
import { useProjections } from "../../hooks/useProjections";
import { useSleeperUser } from "../../hooks/useSleeperUser";
import { usePlayerStats } from "../../hooks/usePlayerStats";
import { useManagementState } from "../../hooks/useManagementState";
import { useRookieBoardState, ROOKIE_BOARD_VERSION, ROOKIE_BOARD_RESET_KEY } from "../../hooks/useRookieBoardState";
import { useAlerts } from "../../hooks/useAlerts";
import { useUserExposure } from "../../hooks/useUserExposure";
import { useUserTrades } from "../../hooks/useUserTrades";
import { useCrossLeagueMateIntel } from "../../hooks/useCrossLeagueMateIntel";
import { useTradeAttempts } from "../../hooks/useTradeAttempts";
import { useCalcValues } from "../../hooks/useCalcValues";
import { useLeagueMateIntel } from "../../hooks/useLeagueMateIntel";
import { useDraftScout } from "../../hooks/useDraftScout";
import { useLeagueOverview } from "../../hooks/useLeagueOverview";
import { useNflState } from "./useNflState";
import { useGamedayState } from "./useGamedayState";
import { useActivityState } from "./useActivityState";
import { usePlayerAnnotations } from "./usePlayerAnnotations";
import { usePersonalRankings } from "./usePersonalRankings";
import { buildConsensusOrder, buildPersonalDispositions, buildPersonalSignals, buildPersonalRankGaps } from "../../lib/helpers/personalRankings";
import { MY_DISPOSITIONS, pickDispositionKey, normalizeDisposition } from "../../lib/helpers/dispositions";
import type { PersonalSignal } from "../../lib/helpers/personalRankings";
import { useSimulatorState } from "./useSimulatorState";
import { fetchSleeperUser } from "../../lib/sleeperUserCache";
import { sleeperApi } from "../../lib/sleeperApi";
import { getLocalStorageItem, setLocalStorageItem, removeLocalStorageItem, removeLocalStorageItemsByPrefix } from "@/lib/hooks/useLocalStorage";
import type {
  AlertsCenterItem,
  SleeperPlayer, SleeperLeague, SleeperRoster, SleeperTradedPick,
  SleeperDraft, SleeperDraftPick, GamedayMatchup, GamedayTeamView,
  SleeperMatchup, AnnotatedTransaction,
  AugmentedPick,
  HistoricalSnapshot, LeagueMateView, SimulationTeamRow,
  RosterDirectionProfile, DynamicPickValue, RookieBoardPlayer, FcTrendEntry,
  StandingRow,
  AssetDisposition, LeagueAssetDispositions, LeagueExpiringBlocks,
} from "../../lib/types";

// -------------------------
// MODULE-LEVEL CONSTANTS (page-specific)
// -------------------------
// ROOKIE_YEAR, ROOKIE_BOARD_VERSION, ROOKIE_BOARD_RESET_KEY imported from useRookieBoardState

// Module-level in-memory player map cache â€” avoids re-fetching/re-parsing the 6MB Sleeper player
// payload if loadPlayers is called more than once in the same browser session (e.g. strict-mode
// double-invoke in dev, or a Sleeper reconnect event).
let _playersInMemory: Record<string, SleeperPlayer> | null = null;

// fetchSleeperUser imported from lib/sleeperUserCache (shared with useLeagues)

// â”€â”€ Page-local interfaces (shapes that don't warrant a lib/types entry) â”€â”€â”€â”€â”€â”€
// AugmentedPick, AnnotatedTransaction, StandingRow are exported from lib/types.ts
interface OwnedPlayerEntry { player_id: string; player?: SleeperPlayer; leagues: string[]; shareCount: number; }
interface AllLeagueDataEntry { leagueId?: string; leagueName?: string; roster: import("../../lib/types").SleeperRoster | null; }
interface PlayerSnapshot { full_name: string; status: string; team: string; value: number; active: boolean; shareCount: number; }

export function useAppState() {

  // -------------------------
  // AUTH STATE
  // -------------------------
  const {
    supabaseUser, setSupabaseUser,
    loginEmail, setLoginEmail,
    loginPassword, setLoginPassword,
    setNotes,
    supabaseError, setSupabaseError,
    supabaseMessage, setSupabaseMessage,
    loginLoading, setLoginLoading,
    resetLoading, setResetLoading,
    showLoginPassword, setShowLoginPassword,
    loadNotes,
    signUp, signIn, resetPassword,
  } = useAuthState();

  const {
    leagueNotes, setLeagueNotes,
    playerProfileId, setPlayerProfileId,
    playerNotes, setPlayerNotes,
    leaguePlayerTags, setLeaguePlayerTags,
    ignoredOwnerIds,
    toggleIgnoredOwner,
    noInterestPlayers, setNoInterestPlayers, setNoInterest,
    discardedTrades, setDiscardedTrades, discardFinderTrade,
    saveLeagueNote,
    savePlayerNote,
    handleSetAssetDisposition,
  } = usePlayerAnnotations(supabaseUser);
  const { personalOrdering, setPersonalOrdering, savePersonalOrdering } = usePersonalRankings(supabaseUser);

  // Ref so loadRoster's useCallback (deps: [user, players]) always reads the latest tags
  // without needing leaguePlayerTags in its own deps — mirrors supabaseUserRef in usePlayerAnnotations.ts
  const leaguePlayerTagsRef = useRef(leaguePlayerTags);
  useEffect(() => { leaguePlayerTagsRef.current = leaguePlayerTags; }, [leaguePlayerTags]);

  // -------------------------
  // HUB ROUTING STATE
  // -------------------------
  const {
    mainTab, setMainTab,
    tradeHubSection, setTradeHubSection,
    leagueHubTab, setLeagueHubTab,
    dataHubTab, setDataHubTab,
    draftHubSection, setDraftHubSection,
    alertsFeedTab, setAlertsFeedTab,
  } = useHubRouting();
  const [showAllOpenTrades, setShowAllOpenTrades] = useState(false);

  // -------------------------
  // CORE STATE
  // -------------------------
  const [selectedLeague, setSelectedLeague] = useState<SleeperLeague | null>(null);
  const [roster, setRoster] = useState<SleeperRoster | null>(null);
  const [rosters, setRosters] = useState<SleeperRoster[]>([]);
  const [players, setPlayers] = useState<Record<string, SleeperPlayer>>({});

  const [picks, setPicks] = useState<AugmentedPick[]>([]);
  const [allPicks, setAllPicks] = useState<AugmentedPick[]>([]);
  const [, setDraftId] = useState<string | null>(null);
const [draftPicks, setDraftPicks] = useState<SleeperDraftPick[]>([]);
const [draftOrder, setDraftOrder] = useState<Record<string, number>>({});
const [draftSettings, setDraftSettings] = useState<SleeperDraft | null>(null);
const {
  draftScoutUserId,
  draftScoutData,
  loadingDraftScout,
  draftScoutPatterns,
  loadDraftScout,
  clearDraftScout,
} = useDraftScout(players);
const [loadingDraftRefresh, setLoadingDraftRefresh] = useState(false);
const [selectedLeagueDraftHasOccurred, setSelectedLeagueDraftHasOccurred] = useState(false);
const {
  tradeHubUserId, setTradeHubUserId,
  tradeHubData, setTradeHubData,
  loadingTradeHub,
  tradeHubError,
  loadUserTrades,
} = useUserTrades();
const {
  tradeAttempts, tradeAttemptsLeagueId, loadingTradeAttempts, allTradeAttempts,
  loadTradeAttempts, markTradeAttempted, updateAttemptStatus, deleteAttempt,
} = useTradeAttempts(supabaseUser);
const { leagueMateTradeIntel } = useLeagueMateIntel(selectedLeague, rosters, players);
const [leagueMateProfileCache, setLeagueMateProfileCache] = useState<Record<string, LeagueMateView[]>>({});
const { nflState, setNflState, loadNflState } = useNflState();
const {
  gamedayMatchups, setGamedayMatchups,
  loadingGamedayMatchups,
  selectedGamedayMatchupId, setSelectedGamedayMatchupId,
  loadGamedayMatchups,
} = useGamedayState();
const {
  calcFcValues,
  loadingCalcValues,
  calcValuesError,
  redraftValues,
  loadingRedraft,
  redraftError,
  loadCalcValues,
  loadRedraftValues,
} = useCalcValues();
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
  enabledExtraSources,
  toggleExtraSource,
} = useProjections(players, selectedLeague?.scoring_settings ?? null);

// Rolling snap% / target / carry stats from the last 4 weeks of Sleeper actuals.
// Returns null during the off-season â€” TradeHub degrades gracefully when null.
const nflStatsSeason = nflState?.season_type === "regular" ? (nflState?.season ?? null) : null;
const nflStatsWeek   = nflState?.season_type === "regular" ? (nflState?.display_week ?? nflState?.week ?? null) : null;
const { playerStats } = usePlayerStats(nflStatsSeason, nflStatsWeek);

const [pickFcValues, setPickFcValues] = useState<Record<string, number>>({});
const [fcTrendData, setFcTrendData] = useState<FcTrendEntry[]>([]);
const [loadingFcTrends, setLoadingFcTrends] = useState(false);

// Network consensus draft data for the current rookie draft year.
// Used by predictedDraftPicks to override FC-value ordering once the user has
// compiled enough drafts (CONSENSUS_MIN_DRAFTS) for the current year.
const [consensusCurrentYear, setConsensusCurrentYear] = useState<{
  rows: Array<{ player_name: string; avg_pick_no: number }>;
  draftCount: number;
} | null>(null);
const [calcOpponentRosterId, setCalcOpponentRosterId] = useState<number | null>(null);
const [users, setUsers] = useState<Record<string, string>>({});
const [standings, setStandings] = useState<StandingRow[]>([]);

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

  const {
    leagueOverviewData,
    loadingLeagueOverview,
    leagueOverviewLoaded,
    leagueOverviewError,
    loadLeagueOverview,
  } = useLeagueOverview(leagues, user);

  const {
    activityTransactions, setActivityTransactions,
    loadingActivity,
    leagueWeeklyMatchups, setLeagueWeeklyMatchups,
    loadingLeagueWeeklyMatchups, setLoadingLeagueWeeklyMatchups,
    ownerDraftTendencies,
    loadActivity,
  } = useActivityState();

  const leaguesRef2 = useRef(leagues);
  const selectedLeagueRef = useRef(selectedLeague);
  useEffect(() => { leaguesRef2.current = leagues; }, [leagues]);
  useEffect(() => { selectedLeagueRef.current = selectedLeague; }, [selectedLeague]);

  const [allLeagueData, setAllLeagueData] = useState<{ leagueId: string; leagueName: string; roster: SleeperRoster | null }[]>([]);
  const [loadingAllLeagueData, setLoadingAllLeagueData] = useState(false);
  const [shareSearch, setShareSearch] = useState("");
  const [sharePosition, setSharePosition] = useState("ALL");
  const [freeAgents, setFreeAgents] = useState<SleeperPlayer[]>([]);
const {
  selectedUserId, setSelectedUserId,
  externalShares,
  loadingShares,
  exposureError,
  loadUserExposure,
} = useUserExposure();
// â”€â”€ ALERTS / WATCHLIST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const {
  dashboardAlerts, setDashboardAlerts,
  dismissedAlertIds, setDismissedAlertIds,
  watchlistEntries, setWatchlistEntries,
  mergeDashboardAlerts,
  dismissAlert: dismissDashboardAlert,
  persistedAlertIdsRef,
  alertStoreScope,
  watchlistStorageKey,
  alertStorageKey,
  dismissedAlertStorageKey,
} = useAlerts({ supabaseUser, players });
const { crossLeagueMateIntel } = useCrossLeagueMateIntel({
  leagueId: selectedLeague?.league_id,
  rosters,
  userId: user?.user_id,
  players,
  mainTab,
  tradeHubSection,
});
const [leagueTransactions, setLeagueTransactions] = useState<AnnotatedTransaction[]>([]);
const [loadingTransactions, setLoadingTransactions] = useState(false);

// â”€â”€ MANAGEMENT HUB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const {
  mgmtHubTab, setMgmtHubTab,
  leagueMgmtData, setLeagueMgmtData,
  commPaymentsData, setCommPaymentsData,
  commToolsLeagueId, setCommToolsLeagueId,
  commToolsRosters, setCommToolsRosters,
  commToolsUsers, setCommToolsUsers,
  loadingCommToolsRosters, setLoadingCommToolsRosters,
  leagueBylaws, saveLeagueBylaws,
} = useManagementState(supabaseUser);

// â”€â”€ ROOKIE BOARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const {
  rookies, setRookies,
  fcNameValues,
  handleRankChange,
  addRookie, editRookieName, removeAddedRookie, clearNameEdit,
  rookieOverrides,
} = useRookieBoardState(supabaseUser);



// alertSnapshotStorageKey is separate from the useAlerts hook â€” it tracks the daily
// player value baseline used for gaining/falling alerts, not the alert list itself.
const alertSnapshotStorageKey = `alertSnapshots_v1_${alertStoreScope}`;
const alertBootstrapRef = useRef(false);
// Stable daily baseline for value-change alerts â€” loaded from Supabase, NOT localStorage.
const historicalSnapshotRef = useRef<HistoricalSnapshot | null>(null);
const [historicalSnapshot, setHistoricalSnapshot] = useState<HistoricalSnapshot | null>(null);
// Refs for useCallback functions defined later in the file â€” avoids TDZ in dep arrays.
const loadRosterRef = useRef<((league: SleeperLeague) => Promise<void>) | null>(null);

// Load all Supabase-persisted user data whenever the logged-in user changes
useEffect(() => {
  if (!supabaseUser) return;
  let cancelled = false;
  setSupabaseMessage("");
  try {
    if (supabaseUser.email) setLocalStorageItem(LAST_LOGIN_EMAIL_KEY, supabaseUser.email);
  } catch {}
  // 1. Title/body note cards
  loadNotes();
  // 2. League notes (per-league textarea)
  supabase
    .from("league_notes")
    .select("league_id, content")
    .eq("user_id", supabaseUser.id)
    .then(({ data, error }) => {
      if (cancelled) return;
      if (error) { log.error("league_notes load failed", { err: error.message }); return; }
      if (data && data.length > 0) {
        const map: Record<string, string> = {};
        data.forEach((row: { league_id: string; content: string }) => { map[row.league_id] = row.content; });
        setLeagueNotes(map);
        setLocalStorageItem("leagueNotes", map);
      }
    });
  // Rookie board is handled by the loadRookieBoard effect (depends on supabaseUser)
  // 3. League management + commissioner payments are loaded by useManagementState hook
  // 4. Watchlists + alerts are loaded by the useAlerts hook (depends on supabaseUser)
  // 7. Daily player value snapshot â€” stable baseline for climbing/falling alerts
  supabase
    .from("player_value_snapshots")
    .select("snapshot, recorded_at")
    .eq("user_id", supabaseUser.id)
    .single()
    .then(({ data, error }) => {
      if (cancelled) return;
      if (error) { log.error("player_value_snapshots load failed", { err: error.message }); return; }
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
    .then(({ data, error }) => {
      if (cancelled) return;
      if (error) { log.error("player_notes load failed", { err: error.message }); return; }
      if (data && data.length > 0) {
        const map: Record<string, string> = {};
        data.forEach((row: { player_id: string; note: string }) => { map[String(row.player_id)] = row.note; });
        setPlayerNotes((prev) => {
          const merged = { ...prev, ...map };
          setLocalStorageItem("playerNotes_v1", merged);
          return merged;
        });
      }
    });
  // 8. Per-league asset dispositions (Core/Pricey/Shopping/Offload for own assets,
  // SELL_NO/SELL_OK for opponent assets; WANT_TO_TRADE is a legacy value read as SHOPPING)
  supabase
    .from("league_player_tags")
    .select("league_id, player_id, tag")
    .eq("user_id", supabaseUser.id)
    .then(({ data, error }) => {
      if (cancelled) return;
      if (error) { log.error("league_player_tags load failed", { err: error.message }); return; }
      if (data && data.length > 0) {
        const map: LeagueAssetDispositions = {};
        data.forEach((row: { league_id: string; player_id: string; tag: string }) => {
          const lid = String(row.league_id);
          if (!map[lid]) map[lid] = {};
          map[lid][String(row.player_id)] = row.tag as AssetDisposition;
        });
        setLeaguePlayerTags((prev) => {
          const merged: LeagueAssetDispositions = {};
          for (const lid of new Set([...Object.keys(prev), ...Object.keys(map)])) {
            merged[lid] = { ...(prev[lid] ?? {}), ...(map[lid] ?? {}) };
          }
          setLocalStorageItem("leaguePlayerTags_v1", merged);
          return merged;
        });
      }
    });
  // 9. Time-boxed Trade Finder suppressions (finder_temp_blocks, kind-discriminated:
  // PLAYER_NO_INTEREST -> noInterestPlayers, TRADE_DISCARD -> discardedTrades)
  supabase
    .from("finder_temp_blocks")
    .select("league_id, kind, block_key, expires_at")
    .eq("user_id", supabaseUser.id)
    .then(({ data, error }) => {
      if (cancelled) return;
      if (error) { log.error("finder_temp_blocks load failed", { err: error.message }); return; }
      if (data && data.length > 0) {
        const playerMap: LeagueExpiringBlocks = {};
        const tradeMap: LeagueExpiringBlocks = {};
        data.forEach((row: { league_id: string; kind: string; block_key: string; expires_at: string }) => {
          const lid = String(row.league_id);
          const target = row.kind === "TRADE_DISCARD" ? tradeMap : playerMap;
          if (!target[lid]) target[lid] = {};
          target[lid][String(row.block_key)] = row.expires_at;
        });
        setNoInterestPlayers((prev) => {
          const merged: LeagueExpiringBlocks = {};
          for (const lid of new Set([...Object.keys(prev), ...Object.keys(playerMap)])) {
            merged[lid] = { ...(prev[lid] ?? {}), ...(playerMap[lid] ?? {}) };
          }
          setLocalStorageItem("noInterestPlayers_v1", merged);
          return merged;
        });
        setDiscardedTrades((prev) => {
          const merged: LeagueExpiringBlocks = {};
          for (const lid of new Set([...Object.keys(prev), ...Object.keys(tradeMap)])) {
            merged[lid] = { ...(prev[lid] ?? {}), ...(tradeMap[lid] ?? {}) };
          }
          setLocalStorageItem("discardedFinderTrades_v1", merged);
          return merged;
        });
      }
    });
  // 10. Personal rankings (the user's own ordered board â€” one jsonb row per user)
  supabase
    .from("personal_rankings")
    .select("ordering")
    .eq("user_id", supabaseUser.id)
    .maybeSingle()
    .then(({ data, error }) => {
      if (cancelled) return;
      if (error) { log.error("personal_rankings load failed", { err: error.message }); return; }
      const ordering = (data as { ordering?: unknown } | null)?.ordering;
      if (Array.isArray(ordering) && ordering.length > 0) {
        const ids = ordering.map((id) => String(id));
        setPersonalOrdering(ids);
        setLocalStorageItem("personalRankings_v1", ids);
      }
    });
  return () => { cancelled = true; };
}, [supabaseUser, loadNotes, setSupabaseMessage, setLeagueNotes, setLeaguePlayerTags, setPlayerNotes, setPersonalOrdering, setNoInterestPlayers, setDiscardedTrades]);

// Load network consensus draft data for the current draft year. Drives
// predictedDraftPicks once draftCount >= CONSENSUS_MIN_DRAFTS; until then
// the original FC-value ordering remains authoritative.
useEffect(() => {
  if (!supabaseUser) return;
  let cancelled = false;
  (async () => {
    const { data: meta } = await supabase
      .from("consensus_draft_meta")
      .select("total_drafts")
      .eq("user_id", supabaseUser.id)
      .eq("year", parseInt(CURRENT_YEAR, 10))
      .single();
    if (cancelled || !meta) { setConsensusCurrentYear(null); return; }
    const { data: rows } = await supabase
      .from("consensus_draft_cache")
      .select("player_name, avg_pick_no")
      .eq("user_id", supabaseUser.id)
      .eq("year", parseInt(CURRENT_YEAR, 10))
      .order("avg_pick_no", { ascending: true });
    if (cancelled) return;
    setConsensusCurrentYear({
      rows: (rows ?? []) as Array<{ player_name: string; avg_pick_no: number }>,
      draftCount: meta.total_drafts || 0,
    });
  })();
  return () => { cancelled = true; };
}, [supabaseUser]);

// Persist the (Supabase auth user â†’ Sleeper user_id) mapping so the
// server-side league-transactions cron knows which Sleeper account to scan.
// Re-runs on Sleeper reconnect (user.user_id change) so a re-link is captured.
useEffect(() => {
  if (!supabaseUser || !user?.user_id) return;
  let cancelled = false;
  supabase
    .from("user_sleeper_links")
    .upsert(
      {
        user_id:          supabaseUser.id,
        sleeper_user_id:  user.user_id,
        sleeper_username: user.username || user.display_name || "",
        updated_at:       new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .then(({ error }) => {
      if (cancelled || !error) return;
      log.error("user_sleeper_links upsert failed", { err: error.message });
    });
  return () => { cancelled = true; };
}, [supabaseUser, user?.user_id, user?.username, user?.display_name]);

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
  setLoginEmail(getLocalStorageItem(LAST_LOGIN_EMAIL_KEY, ""));
  setLoginPassword("");
  setLoginLoading(false);
  setResetLoading(false);
  setShowLoginPassword(false);
  setSupabaseError("");
  setSupabaseMessage("");
  // Reset in-memory annotation/ranking state — without this, the next login's
  // Supabase load effect merges the new user's rows onto this user's leftover
  // state ({...prev, ...map}), and if the new user has zero rows for a given
  // table the merge is skipped entirely, leaving this user's data on screen.
  setPlayerNotes({});
  setLeaguePlayerTags({});
  setNoInterestPlayers({});
  setDiscardedTrades({});
  setPersonalOrdering([]);
  // Clear localStorage user-specific data so next user starts fresh (shared-
  // computer sign-out/sign-in must not leak the previous user's tags, notes,
  // rankings, or committed sim state to whoever logs in next).
  removeLocalStorageItem("leagueNotes");
  removeLocalStorageItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`);
  removeLocalStorageItem(ROOKIE_BOARD_RESET_KEY);
  removeLocalStorageItem(`rookieBoardOverrides_${ROOKIE_BOARD_VERSION}`);
  removeLocalStorageItem(watchlistStorageKey);
  removeLocalStorageItem(alertStorageKey);
  removeLocalStorageItem(alertSnapshotStorageKey);
  removeLocalStorageItem(dismissedAlertStorageKey);
  removeLocalStorageItem("playerNotes_v1");
  removeLocalStorageItem("leaguePlayerTags_v1");
  removeLocalStorageItem("noInterestPlayers_v1");
  removeLocalStorageItem("discardedFinderTrades_v1");
  removeLocalStorageItem("ignoredOwnerIds");
  removeLocalStorageItem("personalRankings_v1");
  removeLocalStorageItem("committedSimRows_v2");
  removeLocalStorageItemsByPrefix("draftPicks_");
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
    // Fast path: already loaded this session â€” skip localStorage and network entirely
    if (_playersInMemory) {
      setPlayers(_playersInMemory);
      // nflState is React state and resets on remount â€” reload it from the cached route
      fetch('/api/nfl-state', { signal })
        .then(r => r.json()).then((s) => { if (!signal.aborted) setNflState(s); }).catch(() => {});
      return;
    }

    const cached = getLocalStorageItem<Record<string, SleeperPlayer> | null>("playersCache", null);
    const cachedAt = getLocalStorageItem<number>("playersCacheAt", 0);
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (cached && cachedAt && Date.now() - cachedAt < ONE_DAY) {
      const parsedCache = cached;
      const cacheSample = Object.values(parsedCache).find((player) => player && typeof player === "object") as Record<string, unknown> | undefined;
      const hasRookieFields =
        cacheSample &&
        "years_exp" in cacheSample &&
        "search_rank" in cacheSample &&
        "fantasy_positions" in cacheSample &&
        "injury_status" in cacheSample;

      if (hasRookieFields) {
        _playersInMemory = parsedCache;
        setPlayers(parsedCache);
        // Still load pick values and nflState even when players come from cache
        fetchFantasyCalcValues(2).then(({ pickValues, trendData }) => { if (!signal.aborted) { setPickFcValues(pickValues); setFcTrendData(trendData); } }).catch(() => {});
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

    const { playerValues: fcValues, pickValues, trendData } = await fetchFantasyCalcValues(2);
    setPickFcValues(pickValues);
    setFcTrendData(trendData);

    // Merge FC dynasty values into the player map
    Object.keys(data).forEach((id) => {
      if (fcValues[id]) data[id].value = fcValues[id];
    });

    setLocalStorageItem("playersCache", data);
    setLocalStorageItem("playersCacheAt", Date.now());
    _playersInMemory = data;
    setPlayers(data);
  };

  loadPlayers().catch((err) => { if (!controller.signal.aborted) log.error('loadPlayers failed', { err: String(err) }); });
  return () => controller.abort();
}, [setNflState]);


const refreshDraftBoard = useCallback(async () => {
  if (!selectedLeagueRef.current) return;
  setLoadingDraftRefresh(true);
  try {
    // bypass the drafts cache too so a status flip (drafting â†’ complete) is seen
    // promptly â€” both the manual "Refresh Board" button and the live poll want fresh.
    const drafts = await sleeperApi.getLeagueDrafts(selectedLeagueRef.current.league_id, true);
    const currentDraft = drafts[0];
    if (!currentDraft) return;
    setDraftId(currentDraft.draft_id);
    setDraftOrder(currentDraft.draft_order || currentDraft.slot_to_roster_id || {});
    setDraftSettings(currentDraft); // full object â€” consistent with useLeagues.ts
    setSelectedLeagueDraftHasOccurred(currentDraft.status !== "pre_draft");
    const picks = await sleeperApi.getDraftPicks(currentDraft.draft_id, true);
    setDraftPicks(picks);
  } catch (err) {
    log.warn("draft refresh failed", { err: String(err) });
  } finally {
    setLoadingDraftRefresh(false);
  }
}, []);

// Live-draft auto-refresh. While the Draft Hub BOARD tab is open and the draft
// is in progress, poll every 30s so picks appear without manual clicks. Polling
// pauses when the browser tab is hidden and stops once the draft completes.
// Cost: ~2 Sleeper calls per poll (drafts + picks) = ~4/min per active drafter,
// far under Sleeper's ceiling and only during the rare live-draft window.
useEffect(() => {
  const status = draftSettings?.status;
  const isLive = status === "drafting" || status === "paused";
  const onBoard = mainTab === "DRAFT" && draftHubSection === "BOARD";
  if (!isLive || !onBoard) return;
  if (typeof document === "undefined") return;

  const POLL_MS = 30_000;
  let timer: ReturnType<typeof setInterval> | null = null;
  const startTimer = () => { if (timer === null) timer = setInterval(() => { refreshDraftBoard(); }, POLL_MS); };
  const stopTimer = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") { refreshDraftBoard(); startTimer(); }
    else stopTimer();
  };

  if (document.visibilityState === "visible") startTimer();
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => { stopTimer(); document.removeEventListener("visibilitychange", onVisibilityChange); };
}, [mainTab, draftHubSection, draftSettings?.status, refreshDraftBoard]);

// Keep redraft values matched to the selected league's QB format (superflex=2 vs
// single-QB=1) so the redraft-rank half of the direction bucket is format-correct.
// Superflex leagues resolve to numQbs=2 (unchanged); the load is guarded so this is
// a no-op when the format hasn't changed.
useEffect(() => {
  if (selectedLeague) loadRedraftValues(getLeagueNumQbs(selectedLeague));
}, [selectedLeague, loadRedraftValues]);

// Load league-specific FC values and redraft values as soon as Trade Hub is opened.
// redraftValues powers the redraft-rank half of the direction bucket â€” if it's empty
// when the direction memo fires it produces a garbage bucket (usually "Purgatory").
useEffect(() => {
  if (mainTab === "TRADE_HUB" && selectedLeague?.league_id) {
    loadCalcValues(getLeagueNumQbs(selectedLeague));
    loadRedraftValues(getLeagueNumQbs(selectedLeague));
  }
}, [mainTab, selectedLeague?.league_id, selectedLeague, loadCalcValues, loadRedraftValues]);

// Also reload if the user switches sub-tabs within Trade Hub (redundant but keeps the guard intact)
useEffect(() => {
  if ((tradeHubSection === "CALCULATOR" || tradeHubSection === "FINDER") && selectedLeague?.league_id) {
    loadCalcValues(getLeagueNumQbs(selectedLeague));
  }
  // Auto-load attempts when switching to ATTEMPTS or FINDER (the Finder's decline-memory
  // scoring reads tradeAttempts too, and needs it populated even on a fresh-session visit
  // that skips the Attempts tab entirely).
  if ((tradeHubSection === "ATTEMPTS" || tradeHubSection === "FINDER") && selectedLeague?.league_id && supabaseUser && tradeAttemptsLeagueId !== selectedLeague.league_id) {
    loadTradeAttempts(selectedLeague.league_id);
  }
}, [tradeHubSection, selectedLeague?.league_id, selectedLeague, supabaseUser, tradeAttemptsLeagueId, loadCalcValues, loadTradeAttempts]);

useEffect(() => {
  if (mainTab === "DATA_HUB" && dataHubTab === "RANKINGS" && selectedLeague?.league_id) {
    loadCalcValues(getLeagueNumQbs(selectedLeague));
  }
}, [mainTab, dataHubTab, selectedLeague?.league_id, selectedLeague, loadCalcValues]);

useEffect(() => {
  if (mainTab === "DATA_HUB" && dataHubTab === "RANKINGS") {
    loadRedraftValues();
  }
}, [mainTab, dataHubTab, loadRedraftValues]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "OVERVIEW" && !leagueOverviewLoaded) {
    loadLeagueOverview();
    loadNflState();
    loadRedraftValues();
  }
  // Also load overview when Alerts or the Dashboard opens — Alerts needs it for
  // cross-league data, and the Dashboard's Your Teams grid needs full per-league
  // rosters (not just the user's own) to rank/bucket each team's direction (Phase J).
  if ((mainTab === "ALERTS" || mainTab === "DASHBOARD") && !leagueOverviewLoaded && leagues.length > 0) {
    loadLeagueOverview();
    loadRedraftValues();
  }
  // leagueOverviewLoaded guards against duplicate calls; leagues.length triggers when leagues first load
}, [mainTab, leagueHubTab, leagueOverviewLoaded, leagues.length, loadLeagueOverview, loadNflState, loadRedraftValues]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "STARTERS") {
    loadNflState();
    if (selectedLeague?.league_id) loadCalcValues(getLeagueNumQbs(selectedLeague));
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id, selectedLeague, loadCalcValues, loadNflState]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "POWER_RANKINGS" && selectedLeague?.league_id) {
    loadCalcValues(getLeagueNumQbs(selectedLeague));
    loadRedraftValues();
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id, selectedLeague, loadCalcValues, loadRedraftValues]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "ACTIVITY" && selectedLeague?.league_id) {
    setActivityTransactions([]);
    loadActivity(selectedLeague.league_id);
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id, loadActivity, setActivityTransactions]);

// Auto-load data needed by the player profile panel whenever it opens
useEffect(() => {
  if (!playerProfileId) return;
  if (Object.keys(redraftValues).length === 0) loadRedraftValues();
  if (!leagueOverviewLoaded && leagues.length > 0 && user) loadLeagueOverview();
}, [playerProfileId, leagues.length, user, leagueOverviewLoaded, redraftValues, loadRedraftValues, loadLeagueOverview]);

useEffect(() => {
  if (mainTab === "LEAGUES" && (leagueHubTab === "SIMULATOR" || leagueHubTab === "OVERVIEW")) {
    loadNflState();
    loadRedraftValues();
    const isRegularSeason = nflState?.season_type === "regular" && (nflState?.week ?? 0) > 0;
    const simulatorProjectionWeek = isRegularSeason ? Number(nflState?.week) : 0;
    if (projectionWeek !== simulatorProjectionWeek) {
      setProjectionWeek(simulatorProjectionWeek);
      setProjectionLoaded(false);
      loadProjections(simulatorProjectionWeek === 0 ? "season" : simulatorProjectionWeek, enabledExtraSources);
    } else if (!projectionLoaded) {
      loadProjections(simulatorProjectionWeek === 0 ? "season" : simulatorProjectionWeek, enabledExtraSources);
    }
  }
  // projectionWeek/projectionLoaded are in deps and set inside this effect; the conditional guards prevent loops
}, [mainTab, leagueHubTab, selectedLeague?.league_id, nflState?.week, nflState?.season_type, projectionWeek, projectionLoaded, enabledExtraSources, loadRedraftValues, loadProjections, loadNflState, setProjectionLoaded, setProjectionWeek]);

useEffect(() => {
  if (mainTab !== "GAMEDAY_HUB") return;
  loadNflState();
}, [mainTab, loadNflState]);


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
    loadProjections(currentWeek, enabledExtraSources);
  } else if (!projectionLoaded) {
    loadProjections(currentWeek, enabledExtraSources);
  }

  loadGamedayMatchups(selectedLeague.league_id, currentWeek);
}, [mainTab, selectedLeague?.league_id, nflState?.week, nflState?.season_type, projectionWeek, projectionLoaded, enabledExtraSources, loadProjections, loadGamedayMatchups, setProjectionLoaded, setProjectionWeek, setGamedayMatchups, setSelectedGamedayMatchupId]);

useEffect(() => {
  const leagueId = selectedLeague?.league_id;
  if (mainTab !== "LEAGUES" || leagueHubTab !== "SIMULATOR" || !leagueId) return;
  // Not gated on NFL's season_type: Sleeper generates each league's schedule right
  // after its rookie draft, weeks before the NFL regular season starts. Always try
  // fetching it — simulateLeague already falls back to a generated round-robin for
  // any week Sleeper returns no matchups for, so this is safe pre-draft too.
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
          const data = await sleeperApi.getLeagueMatchups(leagueId, week).catch(() => [] as SleeperMatchup[]);
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
}, [mainTab, leagueHubTab, selectedLeague?.league_id, selectedLeague?.settings?.playoff_week_start, leagueWeeklyMatchups, setLeagueWeeklyMatchups, setLoadingLeagueWeeklyMatchups]);


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
}, [supabaseUser, selectedLeague?.league_id]);




useEffect(() => {
  if (mainTab === "DATA_HUB" && dataHubTab === "PROJECTIONS" && !projectionLoaded) {
    loadProjections(projectionWeek === 0 ? 'season' : projectionWeek, enabledExtraSources);
  }
}, [mainTab, dataHubTab, projectionLoaded, projectionWeek, enabledExtraSources, loadProjections]);

// Rookie board save + load effects live in useRookieBoardState (extracted hook).

useEffect(() => {
  if (!selectedLeague || mainTab !== "DRAFT" || draftHubSection !== "BOARD") return;
  refreshDraftBoard();
}, [selectedLeague, mainTab, draftHubSection, refreshDraftBoard]);

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
              leagueId: league.league_id,
              leagueName: league.name,
              roster,
            };
          })
        );

        setAllLeagueData(results);

        const savedLeague = getLocalStorageItem<{ league_id: string } | null>("selectedLeague", null);
        if (savedLeague) {
          const match = leagues.find((l) => l.league_id === savedLeague.league_id);
          if (match) loadRosterRef.current?.(match);
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
const loadRoster = useCallback(async (league: SleeperLeague) => {

  // â”€â”€ Save recent league â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let recents = getLocalStorageItem<{ league_id: string; name: string }[]>("recentLeagues", []);
  recents = recents.filter((l) => l.league_id !== league.league_id);
  recents.unshift({ league_id: league.league_id, name: league.name });
  setLocalStorageItem("recentLeagues", recents.slice(0, 5));

  setSelectedLeague(league);

  // â”€â”€ Step 1: Rosters, traded picks, and drafts â€” from cache or network â”€â”€â”€â”€
  // Cache key is per-league; TTL is 2 hours (short enough to stay fresh during
  // trade season, long enough to avoid redundant fetches when switching leagues)
  const LEAGUE_CACHE_TTL = 2 * 60 * 60 * 1000;
  const leagueCacheKey = `leagueData_${league.league_id}`;
  let cacheHit = false;
  let allRosters: SleeperRoster[] = [];
  let tradedPicksData: SleeperTradedPick[] = [];
  let draftsData: SleeperDraft[] = [];
  type LeagueCache = { data: { allRosters: SleeperRoster[]; tradedPicksData: SleeperTradedPick[]; draftsData: SleeperDraft[] }; cachedAt: number };
  const leagueCached = getLocalStorageItem<LeagueCache | null>(leagueCacheKey, null);
  if (leagueCached && Date.now() - leagueCached.cachedAt < LEAGUE_CACHE_TTL) {
    allRosters      = leagueCached.data.allRosters;
    tradedPicksData = leagueCached.data.tradedPicksData;
    draftsData      = leagueCached.data.draftsData;
    cacheHit = true;
  }
  if (!cacheHit) {
    [allRosters, tradedPicksData, draftsData] = await Promise.all([
      sleeperApi.getLeagueRosters(league.league_id),
      sleeperApi.getLeagueTradedPicks(league.league_id),
      sleeperApi.getLeagueDrafts(league.league_id),
    ]);
    setLocalStorageItem(leagueCacheKey, { data: { allRosters, tradedPicksData, draftsData }, cachedAt: Date.now() });
  }
  setRosters(allRosters);

  // â”€â”€ Step 2: Synchronous work derived from rosters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const rosteredIds = new Set<string>();
  allRosters.forEach((r) => {
    (r.players || []).forEach((p: string) => rosteredIds.add(p));
  });

  const rosterToUser: Record<number, string> = {};
  allRosters.forEach((r) => { rosterToUser[r.roster_id] = r.owner_id; });

  const myRoster = allRosters.find((r) => r.owner_id === user?.user_id);
  if (!myRoster) { setReadyLeagueId(league.league_id); return; }
  setRoster(myRoster);

  setFreeAgents(
    Object.values(players || {})
      .filter((p) => p && !rosteredIds.has(String(p.player_id)))
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, 20)
  );

  const MAX_SUPPORTED_ROUNDS = 6;
  const ALL_ROUNDS = Array.from({ length: MAX_SUPPORTED_ROUNDS }, (_, i) => i + 1);

  // Skip seasons whose rookie draft is complete (those picks are spent); extend
  // the window forward to keep it 3 years long. A startup-sized draft (>6
  // rounds) also retires that season if no separate rookie-sized draft exists
  // for the same season â€” that pattern means rookies were consumed inside the
  // startup itself and no follow-on rookie draft will fire.
  const seasonsWithRookieDraft = new Set(
    draftsData
      .filter((d) => {
        if (!d?.season) return false;
        const rounds = d.settings?.rounds ?? d.rounds ?? 99;
        return rounds <= 6;
      })
      .map((d) => String(d.season))
  );
  const completedDraftSeasons = new Set<string>();
  draftsData.forEach((d) => {
    if (d?.status !== "complete" || !d?.season) return;
    const rounds = d.settings?.rounds ?? d.rounds ?? 99;
    const season = String(d.season);
    if (rounds <= 6) completedDraftSeasons.add(season);
    else if (!seasonsWithRookieDraft.has(season)) completedDraftSeasons.add(season);
  });
  const baseYearNum = Number(YEARS[0]);
  const pickYearWindow: string[] = [];
  for (let offset = 0; pickYearWindow.length < YEARS.length; offset++) {
    const y = String(baseYearNum + offset);
    if (!completedDraftSeasons.has(y)) pickYearWindow.push(y);
  }

  let tempPicks: AugmentedPick[] = [];
  pickYearWindow.forEach((year) => {
    allRosters.forEach((r) => {
      ALL_ROUNDS.forEach((round) => {
        tempPicks.push({ season: year, round, roster_id: r.roster_id, owner_id: r.roster_id, previous_owner_id: r.roster_id });
      });
    });
  });

  // â”€â”€ Step 3: User names â€” fetchSleeperUser has its own module-level cache â”€â”€
  const userResults = await Promise.all(allRosters.map((r) => fetchSleeperUser(r.owner_id)));

  // â”€â”€ Step 4: Apply traded picks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  tradedPicksData.forEach((tp) => {
    const match = tempPicks.find(
      (p) => p.season === tp.season && p.round === tp.round && p.roster_id === tp.roster_id
    );
    if (match) match.owner_id = tp.owner_id;
  });

  // â”€â”€ Step 6: Assign draft slots â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const currentDraft = draftsData.find((d) => d.season === CURRENT_YEAR);

  // Trim to the league's actual round count (check both settings.rounds and top-level rounds)
  const settingsRounds = Number(currentDraft?.settings?.rounds ?? currentDraft?.rounds) || 0;
  const tradedMaxRound = tradedPicksData.reduce(
    (max, tp) => Math.max(max, Number(tp.round) || 0), 0
  );
  const leagueRounds: number = Math.max(settingsRounds, tradedMaxRound, ROUNDS.length);
  tempPicks = tempPicks.filter((p) => Number(p.round) <= leagueRounds);

  // â”€â”€ Step 5: My picks (after trades applied and rounds trimmed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const myPicks = tempPicks.filter((p) => p.owner_id === myRoster.roster_id);

  // â”€â”€ Reconcile stale own-roster dispositions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // A Core/Pricey/Shopping/Offload tag is only meaningful while the asset is still mine.
  // If it was traded away since the tag was set, clear it here so it can't silently
  // resurface if the same player/pick is ever reacquired. Opponent-side tags (SELL_NO/
  // SELL_OK) don't need this: they're keyed per-roster (opponentAssetKey) and self-correct
  // on any trade without reconciliation.
  {
    const currentAssetIds = new Set<string>([
      ...(myRoster.players ?? []),
      ...myPicks.map((p) => pickDispositionKey(p)),
    ]);
    const myTagsForLeague = leaguePlayerTagsRef.current[league.league_id] ?? {};
    for (const [assetId, rawTag] of Object.entries(myTagsForLeague)) {
      const tag = normalizeDisposition(rawTag);
      if (!tag || !MY_DISPOSITIONS.some((d) => d.value === tag)) continue;
      if (!currentAssetIds.has(assetId)) handleSetAssetDisposition(league.league_id, assetId, null);
    }
  }

  const order = currentDraft?.draft_order || {};
  setSelectedLeagueDraftHasOccurred(currentDraft?.status !== "pre_draft");
  const totalDraftTeams = allRosters.length || Number(currentDraft?.settings?.teams) || 0;

  tempPicks.forEach((pick) => {
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
    myPicks.sort((a, b) => {
      if (a.season !== b.season) return Number(a.season) - Number(b.season);
      if (a.round !== b.round) return a.round - b.round;
      const aSlot = parseInt(a.slot?.split(".")[1] ?? "0", 10);
      const bSlot = parseInt(b.slot?.split(".")[1] ?? "0", 10);
      return aSlot - bSlot;
    })
  );

  // â”€â”€ Step 7: Apply user names â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const userMap: Record<string | number, string> = {};
  allRosters.forEach((r, i: number) => {
    const u = userResults[i];
    if (u) {
      userMap[r.roster_id] = u.display_name;
      userMap[r.owner_id] = u.display_name;
    }
  });
  setUsers(userMap);

  // â”€â”€ Step 8: Standings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setStandings(
    allRosters
      .map((r) => ({
        roster_id: r.roster_id,
        wins: r.settings?.wins || 0,
        losses: r.settings?.losses || 0,
        ties: r.settings?.ties || 0,
        fpts: r.settings?.fpts || 0,
        max_pf: r.settings?.fpts_max || 0,
        owner_id: r.owner_id,
      }))
      .sort((a, b) =>
        b.wins !== a.wins ? b.wins - a.wins : b.fpts - a.fpts
      )
  );
  setReadyLeagueId(league.league_id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setReadyLeagueId is a stable setter; TDZ prevents adding to deps (useSimulatorState is called after this callback)
}, [user, players]);
loadRosterRef.current = loadRoster;

const refreshFcTrends = async () => {
  setLoadingFcTrends(true);
  try {
    const { trendData } = await fetchFantasyCalcValues(2);
    setFcTrendData(trendData);
  } catch (err) {
    log.error('refreshFcTrends failed', { err: String(err) });
  } finally {
    setLoadingFcTrends(false);
  }
};

// Manual snapshot save â€” callable from the Data Hub button.
// Uses generic FC values (players[id].value) rather than league-adjusted calcFcValues so that
// scoring rule changes don't create artificial trend movement.
const saveSnapshotNow = async () => {
  if (!supabaseUser) return;
  const snap: Record<string, { full_name: string; value: number; team: string; status: string; active: boolean; shareCount: number }> = {};
  Object.entries(players).forEach(([playerId, p]) => {
    if (!p || !["QB", "RB", "WR", "TE"].includes(p.position)) return;
    const value = p.value ?? 0;
    if (value <= 0) return;
    snap[playerId] = { full_name: p.full_name, value, team: p.team || "", status: p.status, active: p.active, shareCount: 0 };
  });
  if (Object.keys(snap).length === 0) return; // values not loaded yet
  const recordedAt = new Date().toISOString();
  try {
    await supabase
      .from("player_value_snapshots")
      .upsert(
        { user_id: supabaseUser.id, snapshot: snap, recorded_at: recordedAt },
        { onConflict: "user_id" }
      );
  } catch (err: unknown) {
    log.error("player_value_snapshots upsert failed", { err: String(err) });
  }
  const newSnap = { players: snap, recorded_at: recordedAt };
  historicalSnapshotRef.current = newSnap;
  setHistoricalSnapshot(newSnap);
};




  const gamedayWeek = useMemo(() => {
    const rawWeek = Number(nflState?.week || 0);
    return nflState?.season_type === "regular" && rawWeek > 0 ? rawWeek : 0;
  }, [nflState?.week, nflState?.season_type]);
  const gamedayMatchupCards = useMemo((): GamedayMatchup[] => {
    if (!selectedLeague || !rosters.length || !gamedayWeek) return [];

    const starterSlots = (selectedLeague?.roster_positions || []).filter(
      (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
    );
    const rosterMap = new Map(rosters.map((entry) => [Number(entry.roster_id), entry]));
    const projectionByPlayerId = new Map(
      projectionData.map((row) => [String(row.sleeperId), row])
    );
    const matchupMap = new Map<number, SleeperMatchup[]>();

    gamedayMatchups.forEach((entry) => {
      const matchupId = Number(entry?.matchup_id || 0);
      if (!matchupId) return;
      if (!matchupMap.has(matchupId)) matchupMap.set(matchupId, []);
      matchupMap.get(matchupId)?.push(entry);
    });

    const buildTeamView = (entry: SleeperMatchup) => {
      const rosterId = Number(entry?.roster_id || 0);
      const rosterEntry = rosterMap.get(rosterId);
      const starterIds = Array.isArray(entry?.starters) && entry.starters.length > 0
        ? entry.starters.map((id) => String(id || ""))
        : (rosterEntry?.starters || []).map((id) => String(id || ""));
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

      const starterIdSet = new Set(starterRows.map((row) => row.playerId).filter(Boolean));
      const taxiIdSet = new Set((rosterEntry?.taxi || []).map((id) => String(id)));
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
        .map((id) => String(id))
        .filter((playerId: string) => !starterIdSet.has(playerId) && !taxiIdSet.has(playerId))
        .map(buildReserveRow)
        .filter((row) => row.player)
        .sort((a, b) => (b.remainingProjection + b.actualPoints) - (a.remainingProjection + a.actualPoints));

      const taxiRows = (rosterEntry?.taxi || [])
        .map((id) => String(id))
        .map(buildReserveRow)
        .filter((row) => row.player)
        .sort((a, b) => (b.remainingProjection + b.actualPoints) - (a.remainingProjection + a.actualPoints));

      const ownerId = rosterEntry?.owner_id ?? "";
      return {
        rosterId,
        ownerId,
        ownerName: users[ownerId] || users[rosterId] || `Team ${rosterId}`,
        actualPoints: Number(entry?.points || 0),
        remainingProjection: Math.round(sum(starterRows.map((row) => row.remainingProjection)) * 10) / 10,
        projectedFinal: Math.round((Number(entry?.points || 0) + sum(starterRows.map((row) => row.remainingProjection))) * 10) / 10,
        finishedStarters: starterRows.filter((row) => row.gameState === "Final" && row.playerId).length,
        liveStarters: starterRows.filter((row) => row.gameState === "Live" && row.playerId).length,
        upcomingStarters: starterRows.filter((row) => row.gameState === "Upcoming" && row.playerId).length,
        totalStarters: starterRows.filter((row) => row.playerId).length,
        starterRows,
        benchRows,
        taxiRows,
      };
    };

    return [...matchupMap.entries()]
      .map(([matchupId, entries]) => {
        const teams = entries
          .map((entry) => buildTeamView(entry))
          .sort((a, b) => b.actualPoints - a.actualPoints);
        const sortKickoff = teams
          .flatMap((team) => team.starterRows.map((row) => row.kickoffAt).filter((k): k is number => k !== null))
          .sort((a, b) => a - b)[0] || Number.MAX_SAFE_INTEGER;

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
  }, [selectedLeague, rosters, gamedayMatchups, gamedayWeek, players, projectionData, users]);
  const selectedGamedayMatchup = useMemo(
    () => gamedayMatchupCards.find((card) => card.matchupId === selectedGamedayMatchupId) || gamedayMatchupCards[0] || null,
    [gamedayMatchupCards, selectedGamedayMatchupId]
  );
  useEffect(() => {
    if (!gamedayMatchupCards.length) {
      setSelectedGamedayMatchupId(null);
      return;
    }
    if (!gamedayMatchupCards.some((card) => card.matchupId === selectedGamedayMatchupId)) {
      setSelectedGamedayMatchupId(gamedayMatchupCards[0].matchupId);
    }
  }, [gamedayMatchupCards, selectedGamedayMatchupId, setSelectedGamedayMatchupId]);
  // â”€â”€ League-adjusted FC dynasty values (Tier 3 scoring) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Scales raw FantasyCalc values by per-position multipliers derived from the
  // selected league's scoring settings vs. the FC baseline (full PPR, 4pt TDs,
  // no TEP). Falls back to raw calcFcValues when no league is selected.
  // Used by TradeHub and LeagueHub (absolute dynasty rankings in DataHub and
  // DraftHub always use raw calcFcValues).
  const leagueAdjustedFcValues = useMemo((): Record<string, number> => {
    const scoring = selectedLeague?.scoring_settings;
    if (!scoring || Object.keys(calcFcValues).length === 0) return calcFcValues;
    const multipliers = computeScoringMultipliers(scoring);
    const adjusted: Record<string, number> = {};
    for (const [id, value] of Object.entries(calcFcValues)) {
      const pos = players[id]?.position ?? "";
      const mult = multipliers[pos] ?? 1;
      adjusted[id] = Math.round(value * mult);
    }
    return adjusted;
  }, [selectedLeague?.scoring_settings, calcFcValues, players]);

  // â”€â”€ Personal-ranking buy/sell signal â†’ Trade Finder (Phase 2 swap) â”€â”€â”€â”€â”€â”€â”€
  // Derives the Finder's opinion input from the user's personal board vs. the
  // market consensus (same league-adjusted dynasty universe the DataHub Personal
  // view shows, via the shared buildConsensusOrder). Both maps below are sparse â€”
  // only non-neutral players appear; the Finder defaults the rest to NEUTRAL.
  // This replaces the manual playerDispositions dropdowns as the Finder's opinion
  // source â€” the dropdowns still render until Phase 3 strips them.
  const consensusOrderForFinder = useMemo(
    () => buildConsensusOrder(players, (id) => leagueAdjustedFcValues[id] ?? 0),
    [players, leagueAdjustedFcValues]
  );
  // finderSignals = the raw PersonalSignal map the Finder's block predicates read
  // directly (STRONG_SELL â‡’ never acquire). finderDispositions = the same map
  // adapted to the legacy sell/buy strings the tuned scoring still keys off of.
  const finderSignals = useMemo<Record<string, PersonalSignal>>(
    () => buildPersonalSignals(personalOrdering, consensusOrderForFinder),
    [personalOrdering, consensusOrderForFinder]
  );
  // finderRankGaps = the raw vsMkt rank delta per player (same "+4 / -3" the
  // DataHub Personal view shows), for the Trade Finder cards to display
  // alongside each player instead of just the derived buy/sell signal.
  const finderRankGaps = useMemo<Record<string, number>>(
    () => buildPersonalRankGaps(personalOrdering, consensusOrderForFinder),
    [personalOrdering, consensusOrderForFinder]
  );
  const finderDispositions = useMemo(
    () => buildPersonalDispositions(personalOrdering, consensusOrderForFinder),
    [personalOrdering, consensusOrderForFinder]
  );

  // â”€â”€ League-adjusted redraft values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Applies the same per-position scoring multipliers to raw redraft values
  // so they're consistent with the league-adjusted dynasty values above.
  const leagueAdjustedRedraftValues = useMemo((): Record<string, number> => {
    const scoring = selectedLeague?.scoring_settings;
    if (!scoring || Object.keys(redraftValues).length === 0) return redraftValues;
    const multipliers = computeScoringMultipliers(scoring);
    const adjusted: Record<string, number> = {};
    for (const [id, value] of Object.entries(redraftValues)) {
      const pos = players[id]?.position ?? "";
      const mult = multipliers[pos] ?? 1;
      adjusted[id] = Math.round(value * mult);
    }
    return adjusted;
  }, [selectedLeague?.scoring_settings, redraftValues, players]);

  // â”€â”€ Projected rookies per roster for the season simulator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Runs a simplified BPA draft sim to project which rookie lands on each
  // team. Only active in offseason mode â€” in-season, rookies are already on
  // Sleeper rosters. Every team is covered, not just the user's, so the
  // simulator reflects the full offseason landscape for all owners.
  //
  // Uses the same pool-ordering logic as predictedDraftPicks (dynasty FC value
  // primary, ADP secondary) but without user overrides or tendency multipliers
  // so the projection is neutral across all teams.
  const projectedRookiesByRoster = useMemo(
    () => projectRookiesByRoster({
      selectedLeague,
      nflState,
      draftSettings,
      rosters,
      rookies,
      allPicks,
      players,
      leagueAdjustedFcValues,
    }),
    [
      selectedLeague,
      nflState,
      draftSettings,
      rosters,
      rookies,
      allPicks,
      players,
      leagueAdjustedFcValues,
    ]
  );

  const {
    selectedLeagueSimulation,
    committedSimsByLeague,
    leagueSimCache,
    simQueue,
    simProgress,
    readyLeagueId, setReadyLeagueId,
    myDraftSlotPicks, setMyDraftSlotPicks,
    draftSlotEditing, setDraftSlotEditing,
    draftSlotSearchQuery, setDraftSlotSearchQuery,
    saveSimulationToSupabase,
    handleRunAllSims,
    previewTradeSimulation,
  } = useSimulatorState({
    selectedLeague,
    rosters,
    players,
    nflState,
    projectionData,
    projectionWeek,
    loadingProjections,
    playerStats,
    leagueWeeklyMatchups,
    standings,
    users,
    leagueAdjustedFcValues,
    leagueAdjustedRedraftValues,
    projectedRookiesByRoster,
    supabaseUser,
    leagues,
    loadRoster,
  });

  const selectedLeagueDirection = useMemo((): RosterDirectionProfile | null => {
    if (!selectedLeague || !rosters.length || !user?.user_id) return null;
    // Guard: loadRoster sets selectedLeague synchronously but rosters/allPicks update async.
    // Prevent direction recompute with mismatched state until all data has landed.
    if (readyLeagueId !== selectedLeague.league_id) return null;
    const myRosterId = rosters.find((r) => r.owner_id === user.user_id)?.roster_id;
    if (!myRosterId) return null;

    // Guard: allPicks updates after rosters on league switch â€” if any picks exist but none
    // belong to the current league's rosters, data is mid-update; return null and wait.
    const leagueRosterIds = new Set(rosters.map((r) => Number(r.roster_id)));
    if (allPicks.length > 0 && !allPicks.some((p) => leagueRosterIds.has(Number(p.roster_id)))) return null;

    // Guard: both value maps must be loaded before profile is meaningful.
    // An empty map produces nonsense direction output â€” leagueAdjustedRedraftValues drives the
    // redraft-rank half of the bucket; leagueAdjustedFcValues drives the dynasty-rank half.
    if (!Object.keys(leagueAdjustedFcValues).length) return null;
    if (!Object.keys(leagueAdjustedRedraftValues).length) return null;

    return getRosterDirectionProfile({
      rosterId: myRosterId,
      rosters,
      ownedPicks: allPicks,
      players,
      pickValues: pickFcValues,
      redraftValues: leagueAdjustedRedraftValues,
      dynastyValueForPlayer: (id: string) => leagueAdjustedFcValues[id] ?? players[id]?.value ?? 0,
    });
  }, [selectedLeague, readyLeagueId, rosters, allPicks, players, pickFcValues, leagueAdjustedRedraftValues, leagueAdjustedFcValues, user?.user_id]);

  // Combines dynasty rank, redraft rank, simulation playoff odds, and core age into one profile.
  // This is the authoritative direction â€” use this everywhere instead of raw selectedLeagueDirection.
  // Returns null while waiting for consistent data â€” consumers must show a loading state.
  const selectedLeagueDirectionAdjusted = useMemo(() => {
    if (!selectedLeagueDirection || !selectedLeague?.league_id) return null;
    const myRosterId = rosters.find((r) => r.owner_id === user?.user_id)?.roster_id;
    if (!myRosterId) return null;

    // PRIORITY: use the committed (user-saved) sim â€” it's what the League Hub displays
    // and is stable across renders. The live sim recomputes with a random seed each session
    // and can diverge significantly (e.g. 1.7% committed â†’ 40% live), causing wrong direction.
    const committedRows = committedSimsByLeague[selectedLeague.league_id];
    const committedMyRow = committedRows ? committedRows[Number(myRosterId)] : null;

    if (committedMyRow) {
      // We have a stable committed sim â€” use it unconditionally.
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

    // No committed sim yet â€” fall back to the live sim but guard carefully:
    // live sim recomputes every render and may not match the current league yet.
    if (!selectedLeagueSimulation) return null;

    const allCurrentIds = rosters.map((r) => Number(r.roster_id));
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
    if (!leagueId || !selectedLeagueSimulation) return {} as Record<string, DynamicPickValue>;
    // Always prefer the live sim for the currently selected league â€” it's always current.
    // Fall back to the frozen committed snapshot only when the live sim lacks the row
    // (shouldn't happen for the selected league, but keeps the fallback path safe).
    const getProjection = (rosterId: number): SimulationTeamRow | undefined =>
      selectedLeagueSimulation.rowByRosterId.get(rosterId);

    const totalTeams = rosters.length || 12;
    const slots = Array.from({ length: totalTeams }, (_, idx) => idx + 1);

    // Rank-based slot assignment: sort all rosters by their mean expected slot
    // (worst team = lowest mean slot = gets slot 1, best = slot N).
    const rosterRankSlot = (() => {
      const entries = rosters.map((r) => {
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
      allPicks.map((pick) => {
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
        // Rank-based slot: integer 1â€“N where 1 = worst team in league (picks first).
        const expectedSlot = rosterRankSlot.get(Number(pick.roster_id)) ?? Math.round((totalTeams + 1) / 2);
        // Linear interpolation between the floor and ceiling slot values.
        // FantasyCalc has a huge slot-1 premium that makes raw per-slot values non-linear â€”
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
        const bestBucket = (Object.entries(bucketProbabilities).sort((a, b) => b[1] - a[1])[0]?.[0] || "mid") as "early" | "mid" | "late";
        // Derive finish range directly from slotProbabilities so it is always
        // consistent with expectedSlot and expectedValue â€” never stale.
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
    ) as Record<string, DynamicPickValue>;
  }, [selectedLeague?.league_id, selectedLeague?.settings?.playoff_teams, selectedLeagueSimulation, allPicks, pickFcValues, rosters]);
  const selectedLeagueMateProfiles = useMemo((): LeagueMateView[] => {
    if (!selectedLeague || !rosters.length || !user?.user_id) return [];

    const dynastyValueForPlayer = (id: string) => leagueAdjustedFcValues[id] ?? players[id]?.value ?? 0;
    const myRoster = rosters.find((r) => r.owner_id === user.user_id);
    if (!myRoster) return [];

    const myProfile = getRosterDirectionProfile({
      rosterId: myRoster.roster_id,
      rosters,
      ownedPicks: allPicks,
      players,
      pickValues: pickFcValues,
      redraftValues: leagueAdjustedRedraftValues,
      dynastyValueForPlayer,
    });

    return rosters
      .filter((r) => r.owner_id && r.owner_id !== user.user_id)
      .map((r) => {
        const directionProfile = getRosterDirectionProfile({
          rosterId: r.roster_id,
          rosters,
          ownedPicks: allPicks,
          players,
          pickValues: pickFcValues,
          redraftValues: leagueAdjustedRedraftValues,
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
          .filter((p): p is SleeperPlayer & { dynValue: number } => p !== null)
          .filter((player) => ["QB", "RB", "WR", "TE"].includes(player.position));

        const posValueTotals = ["QB", "RB", "WR", "TE"].map((pos) => ({
          pos,
          total: rosterPlayers
            .filter((player) => player.position === pos)
            .reduce((sum: number, player) => sum + (player.dynValue || 0), 0),
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
          .sort((a, b) => b[1] - a[1])[0];
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
          ownedPlayerCounts: ownerCrossLeagueIntel?.ownedPlayerCounts || {},
          acquiredPlayers: ownerCrossLeagueIntel?.acquiredPlayers || [],
          totalDynastyLeagues: ownerCrossLeagueIntel?.totalDynastyLeagues || 0,
          averageAgeAllLeagues: ownerCrossLeagueIntel?.averageAgeAllLeagues || 0,
          crossLeagueTradeCount30d: ownerCrossLeagueIntel?.crossLeagueTradeCount30d || 0,
        };
      })
      .filter((v) => v !== null)
      .sort((a, b) => {
        if (!a || !b) return 0;
        if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
        if (b.tradeCount30d !== a.tradeCount30d) return b.tradeCount30d - a.tradeCount30d;
        return a.ownerName.localeCompare(b.ownerName);
      }) as LeagueMateView[];
  }, [selectedLeague, rosters, user?.user_id, allPicks, players, pickFcValues, leagueAdjustedRedraftValues, leagueAdjustedFcValues, leagueMateTradeIntel, users, crossLeagueMateIntel]);
  const selectedLeagueMateProfilesView = useMemo(
    () =>
      selectedLeagueMateProfiles.length > 0
        ? selectedLeagueMateProfiles
        : (selectedLeague?.league_id ? leagueMateProfileCache[selectedLeague.league_id] ?? [] : []),
    [selectedLeagueMateProfiles, selectedLeague?.league_id, leagueMateProfileCache]
  );
  const activeLeagueHubGroup = useMemo(
    () => LEAGUE_HUB_GROUPS.find((group) => group.tabs.some((tab) => tab.id === leagueHubTab)) || LEAGUE_HUB_GROUPS[0],
    [leagueHubTab]
  );
  const leagueMateProfileByRosterId = useMemo(
    () => new Map(selectedLeagueMateProfilesView.map((profile) => [Number(profile.rosterId), profile])),
    [selectedLeagueMateProfilesView]
  );
  // â”€â”€ Buy Low player IDs (shared with Trade Finder) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Same formula as DataHub Buy Low tab. Top 30 IDs ordered by score descending,
  // only players with real projection data (not redraft fallback).
  const buyLowPlayerIds = useMemo<string[]>(() => {
    if (!players || Object.keys(leagueAdjustedFcValues).length === 0) return [];
    const projById = new Map<string, number>(
      projectionData.map((r) => [String(r.sleeperId), Number(r.fpts || 0)])
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
      const pool = Object.values(players)
        .filter((p) => p.position === pos && (leagueAdjustedFcValues[p.player_id] ?? 0) >= minVal && projById.has(p.player_id))
        .map((p) => ({ player_id: p.player_id, age: Number(p.age || 0), dynVal: leagueAdjustedFcValues[p.player_id] ?? 0, projFpts: projById.get(p.player_id)! }));
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
      .filter(r => r.score / maxRaw >= 0.15) // only meaningful buy lows (â‰¥15% of top score)
      .map(r => r.player_id);
  }, [players, leagueAdjustedFcValues, projectionData]);

  const tradePartnerRankings = useMemo(() => {
    if (!selectedLeague || !rosters.length || !user?.user_id || !selectedLeagueSimulation || !selectedLeagueDirection) return [];

    const myRoster = rosters.find((entry) => entry.owner_id === user.user_id);
    if (!myRoster) return [];

    const mySimRow = selectedLeagueSimulation.rowByRosterId.get(Number(myRoster.roster_id));
    // Use the fully adjusted profile (dynasty + redraft + sim + age) as the source of truth
    const myEffectiveProfile = selectedLeagueDirectionAdjusted ?? selectedLeagueDirection;
    const myBuckets = getProfilePosBuckets(myEffectiveProfile);
    const strongPos = myBuckets.strong[0] || myEffectiveProfile.positionRanks?.sort((a, b) => a.rank - b.rank)?.[0]?.pos || "WR";
    const weakPos = myBuckets.weak[0] || myEffectiveProfile.positionRanks?.sort((a, b) => b.rank - a.rank)?.[0]?.pos || "RB";

    return selectedLeagueMateProfilesView
      .map((partner) => {
        const simRow = selectedLeagueSimulation.rowByRosterId.get(Number(partner.rosterId));
        // Missing sim â†’ neutral 50 (NOT 0); a 0 default would wrongly read every sim-less
        // partner as a desperate seller and disagree with the finder's pipeline gates.
        const partnerPlayoffOdds = simRow?.playoffOdds ?? 50;
        // Apply the same three-factor adjustment to each partner's bucket
        const partnerAdjustedBucket = getAdjustedDirectionBucket(
          partner.directionProfile?.bucket,
          partner.directionProfile,
          partnerPlayoffOdds,
          !!simRow
        );
        const partnerAdjustedProfile = { ...partner.directionProfile, bucket: partnerAdjustedBucket };
        const partnerBuckets = getProfilePosBuckets(partnerAdjustedProfile);
        // Canonical seller/buyer classification â€” same resolver the trade finder uses.
        const { isSeller, isBuyer } = classifyOppDirection(partnerAdjustedBucket, partnerPlayoffOdds);
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
          // Neutral 50 default so the pipeline reads this partner the same way as the gates.
          playoffOdds: simRow?.playoffOdds ?? 50,
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
      .sort((a, b) => {
        if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
        if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
        return a.ownerName.localeCompare(b.ownerName);
      });
  }, [selectedLeague, rosters, user?.user_id, selectedLeagueSimulation, selectedLeagueDirection, selectedLeagueDirectionAdjusted, selectedLeagueMateProfilesView]);

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
    ).then(() => {}, (err: unknown) => log.error("leaguemate_profiles upsert failed", { err: String(err) }));
  }, [supabaseUser, selectedLeague?.league_id, selectedLeagueMateProfiles]);

  // Drafted players keyed by both Sleeper player_id AND `name:<normalized>` so the rookie
  // board (which often contains name-only entries from FantasyCalc with no player_id)
  // can be filtered by name when the ID match misses.
  const draftedPlayerIds = useMemo(() => {
    const set = new Set<string>();
    for (const pick of draftPicks) {
      if (pick.player_id) set.add(String(pick.player_id));
      const player = players[pick.player_id];
      if (player?.full_name) set.add(`name:${normalizeRookieName(player.full_name)}`);
    }
    return set;
  }, [draftPicks, players]);

  // â”€â”€ Draft board prediction engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Key design decisions:
  // - Actual picks detected by pick_no (overall pick number), not by roster matching
  // - Non-user slots: ranked by Sleeper ADP position (relative rookie rank, not absolute value)
  // - User's slots: ranked by their personal big board
  // - Need multiplier capped at 1.20 â€” tiebreaker only, never overrides ADP tier
  // - allPicks.owner_id = current owner after trades (used for slot ownership)
  const draftPredictionEngine = useMemo<{
    predictions: Record<string, { name: string; position: string; team: string; adp: number; player_id: string | null; boardRank: number; poolRank: number }>;
    poolRankByPlayerId: Record<string, number>;
    poolRankByName: Record<string, number>;
  }>(() => {
    if (!draftSettings || !rosters.length || !rookies.length || !selectedLeague) {
      return { predictions: {}, poolRankByPlayerId: {}, poolRankByName: {} };
    }

    const numTeams = rosters.length;
    const numRounds: number = draftSettings?.settings?.rounds ?? draftSettings?.rounds ?? 4;
    const isSnake = ((draftSettings?.settings?.type ?? draftSettings?.type) || "snake") !== "linear";
    const myRosterId = rosters.find((r) => r.owner_id === user?.user_id)?.roster_id;

    // Name matching uses the shared normalizeRookieName helper (imported above) so
    // Sleeper ("Omar Cooper") and FantasyCalc ("Omar Cooper Jr.") still match, and
    // there is a single normalisation implementation across board/predictor/compiler.

    // rosterId â†’ userId map â€” needed to look up owner tendencies
    const rosterToUserId: Record<number, string> = {};
    rosters.forEach((r) => { rosterToUserId[Number(r.roster_id)] = r.owner_id; });

    // Average positional distribution across all dynasty rookie drafts (baseline)
    const leagueAvgRate: Record<string, number> = { QB: 0.12, RB: 0.28, WR: 0.48, TE: 0.12 };

    // Per-owner tendency multiplier: how much more/less likely vs. league average
    // Capped at 0.75Ã— â€“ 1.30Ã— so it influences without overriding dynasty value
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

    // Build nameâ†’dynasty value map from Sleeper players dict + FC values
    // Needed because rookies use FC player_ids which may differ from Sleeper player_ids
    const valueByNormName: Record<string, number> = {};
    Object.entries(players).forEach(([id, p]: [string, SleeperPlayer]) => {
      const val = leagueAdjustedFcValues[id] ?? p.value ?? 0;
      if (val > 0 && p.full_name) {
        const key = normalizeRookieName(p.full_name);
        if (!valueByNormName[key] || val > valueByNormName[key]) valueByNormName[key] = val;
      }
    });
    const getRookieValue = (r: RookieBoardPlayer): number =>
      (r.player_id ? (leagueAdjustedFcValues[r.player_id] ?? 0) : 0) || valueByNormName[normalizeRookieName(r.name)] || 0;

    // Network consensus override: once the user's compiled rookie-draft sample is
    // large enough (CONSENSUS_MIN_DRAFTS), use it as the primary ordering signal
    // instead of FC values. FC keeps driving the tail past consensus coverage.
    const CONSENSUS_MIN_DRAFTS = 500;
    const consensusByNormName: Record<string, number> = {};
    const consensusActive =
      !!consensusCurrentYear && consensusCurrentYear.draftCount >= CONSENSUS_MIN_DRAFTS;
    if (consensusActive) {
      consensusCurrentYear!.rows.forEach((row) => {
        if (row.player_name && row.avg_pick_no > 0) {
          consensusByNormName[normalizeRookieName(row.player_name)] = row.avg_pick_no;
        }
      });
    }
    const getConsensusPick = (r: RookieBoardPlayer): number | undefined =>
      consensusActive ? consensusByNormName[normalizeRookieName(r.name)] : undefined;

    // Unified player pool for non-user picks.
    // When consensus is active: rank consensus-listed players by avg_pick_no first,
    // then fall back to FC value / ADP / board rank for the tail (rookies past the
    // ~50-pick consensus coverage). When consensus is inactive: pure FC ordering as
    // before (FC value primary, ADP fine-grained tiebreaker, board rank tail).
    const fullPool = [...rookies]
      .map((r: RookieBoardPlayer, boardIdx: number) => {
        const consensusPick = getConsensusPick(r);
        const dynVal = getRookieValue(r);
        const hasAdp = typeof r.adp === "number" && r.adp < 9999;
        let sortKey: number;
        if (consensusActive && consensusPick !== undefined) {
          // Bucket A: consensus-ranked. avg_pick_no is overall pick number (~1â€“60).
          sortKey = consensusPick;
        } else if (consensusActive) {
          // Bucket B: tail fallback when consensus is active. Offset 1000 keeps all
          // tail entries strictly after the consensus bucket.
          if (dynVal > 0) {
            // Higher dynVal â†’ lower sortKey within tail (cap inversion at +999).
            sortKey = 1000 + (10000 - Math.min(dynVal, 9999));
          } else if (hasAdp) {
            sortKey = 20000 + r.adp;
          } else {
            sortKey = 30000 + boardIdx;
          }
        } else if (dynVal > 0) {
          // FC-primary mode (consensus inactive). Higher value = lower sort key.
          const adpAdj = hasAdp ? r.adp * 0.01 : 0;
          sortKey = -dynVal + adpAdj;
        } else if (hasAdp) {
          sortKey = 50000 + r.adp;
        } else {
          sortKey = 200000 + boardIdx;
        }
        return { ...r, _sortKey: sortKey };
      })
      .sort((a, b) => a._sortKey - b._sortKey);

    // User's personal board order for their own slots
    const boardSorted = [...rookies];

    // slot â†’ current owner_id (after trades), from allPicks
    const slotOwnerMap = new Map<string, number>();
    allPicks.forEach((p) => {
      if (p.slot && p.owner_id) slotOwnerMap.set(String(p.slot), Number(p.owner_id));
    });

    // Detect actual picks by pick_no â€” reliable regardless of slot/roster resolution
    const filledPickNos = new Set<number>(
      draftPicks.map((dp) => Number(dp.pick_no)).filter(Boolean)
    );
    const pickByNo = new Map<number, SleeperDraftPick>();
    draftPicks.forEach((dp) => { if (dp.pick_no) pickByNo.set(Number(dp.pick_no), dp); });

    // My slots across all rounds
    const mySlots = new Set<string>(
      allPicks
        .filter((p: AugmentedPick) => String(p.owner_id) === String(myRosterId) && p.slot)
        .map((p: AugmentedPick) => String(p.slot))
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

    // Position need multiplier â€” round-aware so early picks stay true to value tiers
    // while later rounds allow realistic need-based swings:
    //   Round 1: cap 1.08  â†’ barely 1-2 spot drift  (Love stays 1.01)
    //   Round 2: cap 1.20  â†’ moderate 2-3 spot swings
    //   Round 3: cap 1.38  â†’ 3-5 spot swings reasonable
    //   Round 4: cap 1.55  â†’ large swings fine (deep picks, less certain)
    // Surplus penalty also scales â€” aggressive in round 4 to stop double-stacking one pos.
    const needMult = (rosterId: number | null, pos: string, simCounts: Record<number, Record<string, number>>, round: number): number => {
      if (!rosterId) return 1;
      const needCap     = round === 1 ? 1.08 : round === 2 ? 1.22 : round === 3 ? 1.38 : 1.55;
      const surplusMult = round === 1 ? 0.95 : round === 2 ? 0.88 : round === 3 ? 0.82 : 0.75;
      const roster = rosters.find((r) => Number(r.roster_id) === rosterId);
      const existing = ((roster?.players || []) as string[])
        .map((id: string) => players[id]).filter(Boolean)
        .filter((p: SleeperPlayer) => p.position === pos).length;
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
    draftPicks.forEach((dp) => {
      const p = players[dp.player_id];
      if (p?.full_name) usedNames.add(normalizeRookieName(p.full_name));
    });
    Object.values(myDraftSlotPicks).forEach((pid) => {
      const r = rookies.find((rk: RookieBoardPlayer) => rk.player_id === pid || rk.name === pid);
      if (r?.name) usedNames.add(normalizeRookieName(r.name));
    });

    const isUsed = (r: RookieBoardPlayer) => {
      if (r.player_id && usedIds.has(String(r.player_id))) return true;
      if (r.name && usedNames.has(normalizeRookieName(r.name))) return true;
      return false;
    };
    const markUsed = (r: RookieBoardPlayer) => {
      if (r.player_id) usedIds.add(String(r.player_id));
      if (r.name) usedNames.add(normalizeRookieName(r.name));
    };

    const simCounts: Record<number, Record<string, number>> = {};
    rosters.forEach((r) => { simCounts[Number(r.roster_id)] = {}; });

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

        // Actual pick detected by pick_no â€” doesn't require rosterId resolution
        if (filledPickNos.has(overallPick)) {
          const dp = pickByNo.get(overallPick);
          if (dp?.player_id) {
            usedIds.add(String(dp.player_id));
            const ap = players[dp.player_id];
            if (ap?.full_name) usedNames.add(normalizeRookieName(ap.full_name));
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
          const ov = rookies.find((r: RookieBoardPlayer) => r.player_id === oid || r.name === oid);
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
          .filter((r: RookieBoardPlayer) => !isUsed(r))
          .map((r: RookieBoardPlayer, rankIdx: number) => {
            const baseScore = 1000 / (rankIdx + 1);
            const nm = needMult(rosterId, r.position, simCounts, round);
            // Dynasty value bonus: FC value differences within same ADP tier.
            // Skip when consensus is the primary signal for this player â€” the
            // consensus rank already encodes their expected ordering.
            const dynVal = getRookieValue(r);
            const consensusDriven = consensusActive && getConsensusPick(r) !== undefined;
            const valBonus = consensusDriven ? 0 : (dynVal > 0 ? Math.min(0.20, dynVal / 50000) : 0);
            // Owner tendency: how much this owner historically drafts this position
            // Only applied to non-user slots; user's own slots use personal board order
            const tm = isMySlot ? 1 : tendencyMult(rosterId, r.position);
            return { ...r, score: baseScore * nm * tm * (1 + valBonus) };
          })
          .sort((a, b) => b.score - a.score)[0];

        if (best) {
          const boardRank = rookies.findIndex((r: RookieBoardPlayer) => (r.player_id && r.player_id === best.player_id) || normalizeRookieName(r.name) === normalizeRookieName(best.name)) + 1;
          // poolRank = player's position in consensus dynasty-value pool (1 = most valuable).
          // Used to flag REACH/VALUE on user's predicted slots:
          //   overallPick << poolRank â†’ reaching ahead of consensus
          //   overallPick >> poolRank â†’ getting value relative to consensus
          const poolRank = fullPool.findIndex((r: RookieBoardPlayer) => (r.player_id && r.player_id === best.player_id) || normalizeRookieName(r.name) === normalizeRookieName(best.name)) + 1 || 999;
          predictions[slotStr] = { name: best.name, position: best.position, team: best.team || "", adp: best.adp ?? 999, player_id: best.player_id, boardRank, poolRank };
          markUsed(best);
          if (rosterId) { simCounts[rosterId] = simCounts[rosterId] || {}; simCounts[rosterId][best.position] = (simCounts[rosterId][best.position] || 0) + 1; }
        }
      }
    }

    // Pool rank lookups for any rookie in the pool (covers both predicted slots
    // and already-completed picks). REACH/VALUE flagging on actual picks reads
    // poolRankByPlayerId first, falling back to normalized name.
    const poolRankByPlayerId: Record<string, number> = {};
    const poolRankByName: Record<string, number> = {};
    fullPool.forEach((r: RookieBoardPlayer, idx: number) => {
      const rank = idx + 1;
      if (r.player_id) poolRankByPlayerId[String(r.player_id)] = rank;
      if (r.name) poolRankByName[normalizeRookieName(r.name)] = rank;
    });

    return { predictions, poolRankByPlayerId, poolRankByName };
  }, [draftSettings, rosters, rookies, draftPicks, draftedPlayerIds, myDraftSlotPicks, allPicks, selectedLeague, players, leagueAdjustedFcValues, ownerDraftTendencies, user?.user_id, consensusCurrentYear]);

  const predictedDraftPicks = draftPredictionEngine.predictions;
  const draftPoolRanks = useMemo(
    () => ({ byPlayerId: draftPredictionEngine.poolRankByPlayerId, byName: draftPredictionEngine.poolRankByName }),
    [draftPredictionEngine]
  );

  const topAvailableRookies = useMemo(
    () =>
      rookies
        .map((player, index) => ({
          ...player,
          boardRank: index + 1,
        }))
        .filter((player: RookieBoardPlayer & { boardRank: number }) => {
          if (player.player_id && draftedPlayerIds.has(String(player.player_id))) return false;
          if (player.name && draftedPlayerIds.has(`name:${normalizeRookieName(player.name)}`)) return false;
          return true;
        })
        .slice(0, 10),
    [rookies, draftedPlayerIds]
  );
  const dashboardOwnedPlayers = useMemo(() => {
    const map = new Map<string, OwnedPlayerEntry>();
    allLeagueData.forEach((entry: AllLeagueDataEntry) => {
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
    const irMap = new Map<string, string[]>();
    allLeagueData.forEach((entry) => {
      (entry?.roster?.starters || []).forEach((playerId: string) => {
        if (!playerId || playerId === "0") return;
        const existing = startingMap.get(String(playerId)) || [];
        if (entry?.leagueName && !existing.includes(entry.leagueName)) {
          existing.push(entry.leagueName);
        }
        startingMap.set(String(playerId), existing);
      });
      (entry?.roster?.reserve || []).forEach((playerId: string) => {
        if (!playerId || playerId === "0") return;
        const existing = irMap.get(String(playerId)) || [];
        if (entry?.leagueName && !existing.includes(entry.leagueName)) {
          existing.push(entry.leagueName);
        }
        irMap.set(String(playerId), existing);
      });
    });

    const seen = new Set<string>();
    const result: Array<{ player: SleeperPlayer; playerId: string; leagues: string[]; startingLeagues: string[]; irLeagues: string[]; isWatchlisted: boolean }> = [];

    dashboardOwnedPlayers.forEach((entry) => {
      if (seen.has(entry.player_id)) return;
      const player = players[entry.player_id];
      if (!player?.full_name || !["QB", "RB", "WR", "TE"].includes(player.position)) return;
      seen.add(entry.player_id);
      result.push({
        player,
        playerId: entry.player_id,
        leagues: entry.leagues || [],
        startingLeagues: startingMap.get(entry.player_id) || [],
        irLeagues: irMap.get(entry.player_id) || [],
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
        irLeagues: irMap.get(entry.player_id) || [],
        isWatchlisted: true,
      });
    });

    const severityOrder = (p: SleeperPlayer) => {
      const s = (p.injury_status || p.status || "").toLowerCase();
      if (/ir|pup/.test(s)) return 0;
      if (/out|suspended|inactive/.test(s)) return 1;
      if (/doubtful/.test(s)) return 2;
      if (/questionable/.test(s)) return 3;
      return 4;
    };

    return result.sort((a, b) => severityOrder(a.player) - severityOrder(b.player));
  }, [allLeagueData, dashboardOwnedPlayers, watchlistEntries, players]);

  // â”€â”€ League transactions feed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Reads pre-annotated rows from league_transactions_cache. Rows are
  // produced by the server-side cron at app/api/cron/league-transactions
  // every 30 min, eliminating the ~240 Sleeper calls/cold-session this
  // effect used to do client-side.
  useEffect(() => {
    if (!supabaseUser) return;
    let cancelled = false;
    setLoadingTransactions(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("league_transactions_cache")
          .select("payload")
          .eq("user_id", supabaseUser.id)
          .order("created", { ascending: false })
          .limit(200);
        if (cancelled) return;
        if (error) {
          log.error("league_transactions_cache load failed", { err: error.message });
          return;
        }
        const txs = (data ?? []).map(
          (r: { payload: unknown }) => r.payload as AnnotatedTransaction
        );
        setLeagueTransactions(txs);
      } finally {
        if (!cancelled) setLoadingTransactions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabaseUser]);

  useEffect(() => {
    if (!supabaseUser || !dashboardAlerts.length) return;
    // Persist only alerts that aren't already in the DB. Re-upserting loaded
    // alerts would fire the `alerts_set_updated_at` trigger, re-stamping
    // updated_at = now() every session and keeping stale rows perpetually in
    // the 80-row recency window (the source of the "ghost league" alerts).
    // Dismissals are persisted separately by dismissDashboardAlert.
    const toPersist = dashboardAlerts
      .filter((alert) => !persistedAlertIdsRef.current.has(alert.id))
      .slice(0, 80);
    if (!toPersist.length) return;
    const payload = toPersist.map((alert) => ({
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
    supabase.from("alerts").upsert(payload, { onConflict: "user_id,alert_id" }).then(
      () => { toPersist.forEach((alert) => persistedAlertIdsRef.current.add(alert.id)); },
      (err: unknown) => log.error("alerts bulk upsert failed", { err: String(err) })
    );
  }, [supabaseUser, dashboardAlerts, dismissedAlertIds, persistedAlertIdsRef]);

  useEffect(() => {
    let cancelled = false;
    const trackedPlayers = [
      ...dashboardOwnedPlayers.map((entry) => ({
        playerId: String(entry.player_id),
        player: players[entry.player_id],
        watch: watchlistEntries.find((watch) => watch.player_id === String(entry.player_id)) || null,
        shareCount: entry.shareCount || 0,
        leagues: entry.leagues || [],
      })),
      ...watchlistEntries
        .filter((entry) => !dashboardOwnedPlayers.some((owned) => owned.player_id === entry.player_id))
        .map((entry) => ({
          playerId: entry.player_id,
          player: players[entry.player_id],
          watch: entry,
          shareCount: 0,
          leagues: [],
        })),
    ].filter((entry) => entry.player?.full_name);

    if (!trackedPlayers.length) return;

    const savedSnapshots = getLocalStorageItem<{ players?: Record<string, PlayerSnapshot> }>(alertSnapshotStorageKey, {});

    const nextPlayerSnapshot = Object.fromEntries(
      trackedPlayers.map((entry) => {
        const player = entry.player;
        // Use generic FC value (player.value) â€” league-adjusted calcFcValues would create false trends on rule changes.
        const value = Number(player?.value ?? 0);
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
    // Guards: baseline must be â‰¥ 12h old AND previous.value must be > 0 (avoids 0â†’value false positives).
    const historicalBase = historicalSnapshotRef.current;
    const baselineAge = historicalBase ? Date.now() - new Date(historicalBase.recorded_at).getTime() : 0;
    const baselineReady = !!historicalBase && baselineAge >= 12 * 60 * 60 * 1000;

    Object.entries(nextPlayerSnapshot).forEach(([playerId, snapshot]) => {
      if (baselineReady) {
        const historical = historicalBase?.players[playerId];
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

      // Status/team alerts use localStorage (most-recent state) â€” these need immediate detection,
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
            const backups = Object.entries(players)
              .filter(([pid, p]) =>
                pid !== playerId &&
                p?.team === injuredPlayer.team &&
                p?.position === injuredPlayer.position &&
                p?.depth_chart_position != null &&
                !/out|ir|suspended|inactive/i.test((p.injury_status || p.status || "").toLowerCase())
              )
              .sort(([, a], [, b]) => (a.depth_chart_position ?? 99) - (b.depth_chart_position ?? 99));

            if (backups.length > 0) {
              const [backupId, backup] = backups[0];
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

    setLocalStorageItem(alertSnapshotStorageKey, nextSnapshots);

    // Build a comprehensive snapshot: all QB/RB/WR/TE using generic FC values (players[id].value).
    // Generic values are used instead of league-adjusted calcFcValues so scoring rule changes
    // don't create artificial trend movement. calcEntries is still used as a load gate (confirms
    // FC data is available) but the stored value comes from players[id].value.
    const buildFullSnapshot = () => {
      const snap: Record<string, PlayerSnapshot> = { ...nextPlayerSnapshot };
      const calcEntries = Object.entries(calcFcValues as Record<string, number>).filter(([, v]) => v > 0);
      if (calcEntries.length > 50) {
        calcEntries.forEach(([playerId]) => {
          const p = players[playerId];
          if (!p || !["QB", "RB", "WR", "TE"].includes(p.position)) return;
          if (!snap[playerId]) {
            snap[playerId] = { full_name: p.full_name, value: p.value ?? 0, team: p.team || "", status: String(p.status || ""), active: p.active !== false, shareCount: 0 };
          }
        });
      }
      return snap;
    };

    if (!alertBootstrapRef.current) {
      alertBootstrapRef.current = true;
      // Auto-save snapshot to Supabase if it's missing or > 6 days old.
      // FC values don't shift meaningfully day-to-day; 6-day cadence gives a useful trend window.
      // Users can also manually take a snapshot from the Data Hub â†’ Value Trends tab.
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
            if (cancelled) return;
            const snap = { players: fullSnap, recorded_at: recordedAt };
            historicalSnapshotRef.current = snap;
            setHistoricalSnapshot(snap);
          });
      }
      return () => { cancelled = true; };
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
            if (cancelled) return;
            const snap = { players: fullSnap, recorded_at: originalRecordedAt };
            historicalSnapshotRef.current = snap;
            setHistoricalSnapshot(snap);
          });
      }
    }

    mergeDashboardAlerts(incomingAlerts);
    return () => { cancelled = true; };
  }, [
    dashboardOwnedPlayers,
    watchlistEntries,
    players,
    calcFcValues,
    selectedLeague?.league_id,
    selectedLeagueMateProfilesView,
    alertSnapshotStorageKey,
    supabaseUser,
    mergeDashboardAlerts,
  ]);

  // â”€â”€ Bye week alerts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (nflState?.season_type !== "regular") return;
    const currentWeek = Number(nflState?.week || 0);
    if (!currentWeek) return;
    if (!dashboardOwnedPlayers.length && !watchlistEntries.length) return;

    const seen = new Set<string>();
    const alerts: AlertsCenterItem[] = [];

    [...dashboardOwnedPlayers.map((e) => String(e.player_id)), ...watchlistEntries.map((e) => e.player_id)]
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
  }, [nflState?.week, nflState?.season_type, nflState?.season, dashboardOwnedPlayers, watchlistEntries, players, mergeDashboardAlerts]);

  // â”€â”€ Available player alerts (watchlist player recently dropped) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  }, [leagueTransactions, watchlistEntries, players, mergeDashboardAlerts]);

  // â”€â”€ Top-250 drop alerts (any top-250-by-FC-value player dropped in any league) â”€â”€
  // Surfaces potential pickups even if the player isn't on the watchlist. Skips
  // watchlist players â€” they're already handled by the effect above, and we don't
  // want two alerts for the same drop event.
  useEffect(() => {
    if (!leagueTransactions.length) return;
    const ranked = Object.entries(players)
      .filter(([, p]) => (p?.value ?? 0) > 0)
      .sort(([, a], [, b]) => (b.value ?? 0) - (a.value ?? 0));
    if (ranked.length < 1) return;
    const top250 = new Set(ranked.slice(0, 250).map(([id]) => id));
    const watchlistSet = new Set(watchlistEntries.map((e) => e.player_id));

    const alerts: AlertsCenterItem[] = [];
    const seen = new Set<string>();

    leagueTransactions
      .filter((tx) => tx.type === "free_agent" || tx.type === "waiver")
      .forEach((tx) => {
        Object.keys(tx.drops || {}).forEach((pid) => {
          if (!top250.has(pid) || watchlistSet.has(pid)) return;
          const key = `${pid}-${tx.leagueId}-${tx.transaction_id}`;
          if (seen.has(key)) return;
          seen.add(key);
          const player = players[pid];
          alerts.push({
            id: `top250-drop-${pid}-${tx.leagueId}-${tx.transaction_id}`,
            category: "watchlist",
            source: "internal",
            severity: "high",
            title: `${player?.full_name || pid} was dropped`,
            detail: `Top-250 player ${player?.full_name || pid} was dropped in ${tx.leagueName}. They may be free to add.`,
            actionable: true,
            timestamp: tx.created || Date.now(),
            playerId: pid,
            leagueId: tx.leagueId,
            teamLabel: player?.team || null,
            payload: { transactionId: tx.transaction_id, leagueName: tx.leagueName, fcValue: player?.value ?? 0 },
          });
        });
      });

    if (alerts.length) mergeDashboardAlerts(alerts);
  }, [leagueTransactions, players, watchlistEntries, mergeDashboardAlerts]);

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
const onNavigateToAttempts = useCallback((leagueId: string) => {
  const league = leaguesRef2.current.find((l) => l.league_id === leagueId);
  if (league) {
    loadRoster(league);
    setTradeHubSection("ATTEMPTS");
    setMainTab("TRADE_HUB");
    loadTradeAttempts(leagueId);
  }
}, [loadRoster, loadTradeAttempts, setMainTab, setTradeHubSection]);

const onNavigateToLeague = useCallback((leagueId: string) => {
  const league = leaguesRef2.current.find((l) => l.league_id === leagueId);
  if (league) {
    loadRoster(league);
    setLeagueHubTab("OVERVIEW");
    setMainTab("LEAGUES");
  }
}, [loadRoster, setLeagueHubTab, setMainTab]);

// Dashboard stat-tile navigation — each jumps into an existing hub/tab
// rather than introducing a new nav destination.
const onOpenRosterOverview = useCallback(() => {
  setLeagueHubTab("ROSTER_OVERVIEW");
  setMainTab("LEAGUES");
}, [setLeagueHubTab, setMainTab]);

const onOpenCrossLeaguePlayers = useCallback(() => {
  setDataHubTab("MY_SHARES");
  setMainTab("DATA_HUB");
}, [setDataHubTab, setMainTab]);

const onOpenInjuryReport = useCallback(() => {
  setAlertsFeedTab("injury");
  setMainTab("ALERTS");
}, [setAlertsFeedTab, setMainTab]);

const onOpenAllTrades = useCallback(() => {
  setShowAllOpenTrades(true);
}, []);

const onRefreshDirection = useCallback(() => {
  const league = selectedLeagueRef.current;
  if (league) { loadRedraftValues(); loadRoster(league); }
}, [loadRedraftValues, loadRoster]);

// -------------------------
// MY CURRENT LEAGUE PLAYER SET
// -------------------------
const myPlayerSet = new Set<string>(roster?.players || []);

  // â”€â”€ Grouped props for render components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const providerProps = {
    supabaseUser,
    players,
    selectedLeague,
    rosters,
    users,
    leagueAdjustedFcValues,
    leagueAdjustedRedraftValues,
    pickFcValues,
    fcNameValues,
    selectedLeagueDirection,
    selectedLeagueDirectionAdjusted,
    selectedLeagueSimulation,
    selectedLeagueDynamicPickValues,
    myRoster: roster,
    previewTradeSimulation,
  };
  const authSectionProps = {
    supabaseUser,
    loginEmail, setLoginEmail,
    loginPassword, setLoginPassword,
    supabaseError, setSupabaseError,
    supabaseMessage,
    loginLoading,
    resetLoading,
    showLoginPassword, setShowLoginPassword,
    signIn, signUp, resetPassword,
  };
  const mainLayoutProps = {
    supabaseUser,
    user,
    disconnectSleeper,
    signOut,
    leagues,
    selectedLeague,
    loadRoster,
    mainTab, setMainTab,
    nflState,
    players,
    setTradeHubSection,
    setLeagueHubTab,
    setDataHubTab,
    setDraftHubSection,
    setPlayerProfileId,
  };
  const hubRouterProps = {
    mainTab,
    dataHubTab, setDataHubTab,
    setMainTab,
    user,
    username, setUsername,
    leagues,
    players,
    allPicks,
    picks,
    users,
    rosters,
    nflState,
    selectedLeague,
    setSelectedLeague,
    connectLoading, connectError, connectSuccess, connectSleeper,
    visibleDashboardAlerts,
    actionableDashboardAlerts,
    watchlistEntries,
    dismissDashboardAlert,
    leagueTransactions,
    loadingTransactions,
    injuryReportPlayers,
    allTradeAttempts,
    allLeagueData,
    redraftValues,
    loadLeagueOverview,
    loadingLeagueOverview,
    onNavigateToAttempts,
    onNavigateToLeague,
    onOpenRosterOverview,
    onOpenCrossLeaguePlayers,
    onOpenInjuryReport,
    onOpenAllTrades,
    showAllOpenTrades, setShowAllOpenTrades,
    alertsFeedTab, setAlertsFeedTab,
    leagueHubTab, setLeagueHubTab,
    activeLeagueHubGroup,
    standings,
    committedSimsByLeague,
    leagueSimCache,
    simQueue,
    simProgress,
    loadingActivity,
    loadingLeagueWeeklyMatchups,
    leagueNotes,
    activityTransactions,
    leagueOverviewData,
    leagueOverviewLoaded,
    leagueOverviewError,
    selectedLeagueMateProfilesView,
    ignoredOwnerIds,
    toggleIgnoredOwner,
    freeAgents,
    loadingCalcValues,
    calcValuesError,
    loadingDraftRefresh,
    rookies,
    draftedPlayerIds,
    loadRoster,
    loadRedraftValues,
    loadUserTrades,
    loadUserExposure,
    loadDraftScout,
    saveLeagueNote,
    saveSimulationToSupabase,
    handleRunAllSims,
    refreshDraftBoard,
    setPlayerProfileId,
    setCalcOpponentRosterId,
    setTradeHubSection,
    gamedayWeek,
    gamedayMatchupCards,
    loadingGamedayMatchups,
    selectedGamedayMatchup,
    setSelectedGamedayMatchupId,
    loadGamedayMatchups,
    setProjectionWeek,
    setProjectionLoaded,
    loadProjections,
    shares,
    totalLeagues,
    loadingAllLeagueData,
    shareSearch, setShareSearch,
    sharePosition, setSharePosition,
    finderDispositions,
    finderSignals,
    finderRankGaps,
    personalOrdering,
    savePersonalOrdering,
    loadingRedraft,
    redraftError,
    projectionData, setProjectionData,
    projectionPosFilter, setProjectionPosFilter,
    projectionWeek,
    projectionSeasonYear,
    projectionSourceStatus,
    loadingProjections,
    projectionUsesSeasonFallback,
    enabledExtraSources,
    toggleExtraSource,
    selectedUserId, setSelectedUserId,
    externalShares,
    loadingShares,
    exposureError,
    historicalSnapshot,
    saveSnapshotNow,
    draftHubSection, setDraftHubSection,
    myDraftSlotPicks, setMyDraftSlotPicks,
    draftSlotEditing, setDraftSlotEditing,
    draftSlotSearchQuery, setDraftSlotSearchQuery,
    draftSettings,
    draftPicks,
    draftOrder,
    predictedDraftPicks,
    draftPoolRanks,
    topAvailableRookies,
    movePlayer,
    handleRankChange,
    addRookie, editRookieName, removeAddedRookie, clearNameEdit,
    rookieOverrides,
    tradeHubSection,
    calcOpponentRosterId,
    selectedLeagueDraftHasOccurred,
    leaguePlayerTags,
    handleSetAssetDisposition,
    noInterestPlayers,
    setNoInterest,
    discardedTrades,
    discardFinderTrade,
    leagueMateProfileByRosterId,
    tradePartnerRankings,
    tradeHubData,
    loadingTradeHub,
    tradeHubError,
    tradeHubUserId, setTradeHubUserId,
    setTradeHubData,
    tradeAttempts,
    loadingTradeAttempts,
    tradeAttemptsLeagueId,
    markTradeAttempted,
    updateAttemptStatus,
    deleteAttempt,
    loadTradeAttempts,
    onRefreshDirection,
    buyLowPlayerIds,
    playerStats,
    fcTrendData,
    loadingFcTrends,
    refreshFcTrends,
    mgmtHubTab, setMgmtHubTab,
    leagueMgmtData, setLeagueMgmtData,
    commPaymentsData, setCommPaymentsData,
    commToolsLeagueId, setCommToolsLeagueId,
    commToolsRosters, setCommToolsRosters,
    commToolsUsers, setCommToolsUsers,
    loadingCommToolsRosters, setLoadingCommToolsRosters,
    leagueBylaws, saveLeagueBylaws,
    draftScoutUserId,
    clearDraftScout,
    loadingDraftScout,
    draftScoutData,
    draftScoutPatterns,
    playerProfileId,
    calcFcValues,
    leagueAdjustedRedraftValues,
    playerNotes,
    savePlayerNote,
    myPlayerSet,
  };
  return { providerProps, authSectionProps, mainLayoutProps, hubRouterProps };
}
