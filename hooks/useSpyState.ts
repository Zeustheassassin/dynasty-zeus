"use client";
// ============================================================
// useSpyState — read-only "User Scout" data layer
// ============================================================
// Loads ANY Sleeper user's leagues + per-league rosters/picks/values
// and reproduces the connected-user derivations (direction, standings,
// season sim) WITHOUT any side effects on the logged-in account:
//   - never calls connectSleeper / setLocalStorageItem('sleeperUser')
//   - never upserts user_sleeper_links or any Supabase table
//   - never triggers the league-transactions cron
//   - never writes the committedSimRows_v2 / leagueData_* caches
// Everything is fetched through lib/sleeperApi read-only proxies and
// FantasyCalc, and held in local React state only. See
// [project_spy_username_switching] in memory for why this matters.
// ============================================================
import { useState, useRef, useCallback, useEffect } from "react";
import { getLocalStorageItem, setLocalStorageItem } from "../lib/hooks/useLocalStorage";
import { logger } from "../lib/logger";
import { sleeperApi } from "../lib/sleeperApi";
import { FANTASYCALC_BASE_URL } from "../lib/constants";
import {
  CURRENT_YEAR, YEARS, ROUNDS, getDraftRoundSlot,
  computeScoringMultipliers, getRosterDirectionProfile,
  getAdjustedDirectionBucket, getBucketColor, fetchFantasyCalcValues,
} from "../lib/helpers";
import { simulateLeague } from "../lib/helpers/simulation";
import { projectRookiesByRoster } from "../lib/helpers/rookieProjection";
import { useLeagueOverview } from "./useLeagueOverview";
import type { PlayerUsage } from "./usePlayerStats";
import type {
  SleeperUser, SleeperLeague, SleeperRoster, SleeperPlayer, SleeperNFLState,
  SleeperDraft, SleeperTradedPick, AugmentedPick, StandingRow,
  RosterDirectionProfile, LeagueSimulation, RookieBoardPlayer, ProjectionRow,
} from "../lib/types";

const log = logger("hooks/useSpyState");

// FantasyCalc dynasty values for a single league (league-scoped, identity-
// independent). Mirrors useCalcValues.loadCalcValues but returns the map so
// the run-all loop can fetch per-league values without shared state.
async function fetchLeagueCalcValues(leagueId: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${FANTASYCALC_BASE_URL}/values/current?leagueId=${leagueId}&site=sleeper`);
    const data = await res.json();
    const vals: Record<string, number> = {};
    (data as { player?: { sleeperId?: string }; value: number }[]).forEach((entry) => {
      const sleeperId = entry.player?.sleeperId;
      if (sleeperId) vals[String(sleeperId)] = entry.value;
    });
    return vals;
  } catch (err) {
    log.error("fetchLeagueCalcValues failed", { leagueId, err: String(err) });
    return {};
  }
}

function isDynastyLeague(l: SleeperLeague): boolean {
  return (
    ((l.settings?.taxi_slots ?? 0) > 0 || (l.roster_positions?.length ?? 0) > 20) &&
    (l.settings?.best_ball ?? 0) === 0
  );
}

// Core per-league read-only fetch + derivations (no values, no sim). Mirrors
// the data-shaping half of useAppState.loadRoster, resolving the focal roster
// by the TARGET user_id rather than the connected user.
interface SpyLeagueCore {
  rosters: SleeperRoster[];
  users: Record<string, string>;
  allPicks: AugmentedPick[];
  picks: AugmentedPick[];
  standings: StandingRow[];
  myRoster: SleeperRoster | null;
  draftSettings: SleeperDraft | null;
  freeAgents: SleeperPlayer[];
}

async function loadSpyLeagueCore(
  league: SleeperLeague,
  targetUserId: string,
  players: Record<string, SleeperPlayer>
): Promise<SpyLeagueCore> {
  const [allRosters, tradedPicksData, draftsData, usersData] = await Promise.all([
    sleeperApi.getLeagueRosters(league.league_id),
    sleeperApi.getLeagueTradedPicks(league.league_id),
    sleeperApi.getLeagueDrafts(league.league_id),
    sleeperApi.getLeagueUsers(league.league_id),
  ]);

  const rosters = Array.isArray(allRosters) ? allRosters : [];
  const tradedPicks = Array.isArray(tradedPicksData) ? tradedPicksData : [];
  const drafts = Array.isArray(draftsData) ? draftsData : [];

  const users: Record<string, string> = {};
  (usersData || []).forEach((u) => {
    const name = u.display_name || u.username || u.metadata?.team_name || "Team";
    users[u.user_id] = name;
  });
  const rosterToUser: Record<number, string> = {};
  rosters.forEach((r) => {
    rosterToUser[r.roster_id] = r.owner_id;
    if (users[r.owner_id]) users[r.roster_id] = users[r.owner_id];
  });

  const myRoster = rosters.find((r) => r.owner_id === targetUserId) ?? null;

  const rosteredIds = new Set<string>();
  rosters.forEach((r) => (r.players || []).forEach((p: string) => rosteredIds.add(p)));
  const freeAgents = Object.values(players || {})
    .filter((p) => p && !rosteredIds.has(String(p.player_id)))
    .sort((a, b) => (b.value || 0) - (a.value || 0))
    .slice(0, 20);

  // Pick-year window (drop completed-rookie-draft seasons, extend forward)
  const seasonsWithRookieDraft = new Set(
    drafts
      .filter((d) => {
        if (!d?.season) return false;
        const rounds = d.settings?.rounds ?? d.rounds ?? 99;
        return rounds <= 6;
      })
      .map((d) => String(d.season))
  );
  const completedDraftSeasons = new Set<string>();
  drafts.forEach((d) => {
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

  const MAX_SUPPORTED_ROUNDS = 6;
  const ALL_ROUNDS = Array.from({ length: MAX_SUPPORTED_ROUNDS }, (_, i) => i + 1);
  let tempPicks: AugmentedPick[] = [];
  pickYearWindow.forEach((year) => {
    rosters.forEach((r) => {
      ALL_ROUNDS.forEach((round) => {
        tempPicks.push({ season: year, round, roster_id: r.roster_id, owner_id: r.roster_id, previous_owner_id: r.roster_id });
      });
    });
  });

  tradedPicks.forEach((tp: SleeperTradedPick) => {
    const match = tempPicks.find(
      (p) => p.season === tp.season && p.round === tp.round && p.roster_id === tp.roster_id
    );
    if (match) match.owner_id = tp.owner_id;
  });

  const currentDraft = drafts.find((d) => d.season === CURRENT_YEAR) ?? null;
  const settingsRounds = Number(currentDraft?.settings?.rounds ?? currentDraft?.rounds) || 0;
  const tradedMaxRound = tradedPicks.reduce((max: number, tp: SleeperTradedPick) => Math.max(max, Number(tp.round) || 0), 0);
  const leagueRounds = Math.max(settingsRounds, tradedMaxRound, ROUNDS.length);
  tempPicks = tempPicks.filter((p) => Number(p.round) <= leagueRounds);

  const order = currentDraft?.draft_order || {};
  const totalDraftTeams = rosters.length || Number(currentDraft?.settings?.teams) || 0;
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

  const picks = myRoster
    ? tempPicks
        .filter((p) => p.owner_id === myRoster.roster_id)
        .sort((a, b) => {
          if (a.season !== b.season) return Number(a.season) - Number(b.season);
          if (a.round !== b.round) return a.round - b.round;
          const aSlot = parseInt(a.slot?.split(".")[1] ?? "0", 10);
          const bSlot = parseInt(b.slot?.split(".")[1] ?? "0", 10);
          return aSlot - bSlot;
        })
    : [];

  const standings: StandingRow[] = rosters
    .map((r) => ({
      roster_id: r.roster_id,
      wins: r.settings?.wins || 0,
      losses: r.settings?.losses || 0,
      ties: r.settings?.ties || 0,
      fpts: r.settings?.fpts || 0,
      max_pf: r.settings?.fpts_max || 0,
      owner_id: r.owner_id,
    }))
    .sort((a, b) => (b.wins !== a.wins ? b.wins - a.wins : b.fpts - a.fpts));

  return { rosters, users, allPicks: tempPicks, picks, standings, myRoster, draftSettings: currentDraft, freeAgents };
}

// The full prop bundle a drilled-into spy league feeds to AppProviders + tabs.
export interface SpyLeagueBundle {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: Record<string, string>;
  allPicks: AugmentedPick[];
  picks: AugmentedPick[];
  standings: StandingRow[];
  myRoster: SleeperRoster | null;
  freeAgents: SleeperPlayer[];
  leagueAdjustedFcValues: Record<string, number>;
  leagueAdjustedRedraftValues: Record<string, number>;
  selectedLeagueDirection: RosterDirectionProfile | null;
  selectedLeagueDirectionAdjusted: RosterDirectionProfile | null;
  selectedLeagueSimulation: LeagueSimulation | null;
}

interface UseSpyStateArgs {
  players: Record<string, SleeperPlayer>;
  nflState: SleeperNFLState | null;
  projectionData: ProjectionRow[];
  projectionWeek: number;
  playerStats: Record<string, PlayerUsage> | null;
  rookies: RookieBoardPlayer[];
}

export function useSpyState({
  players, nflState, projectionData, projectionWeek, playerStats, rookies,
}: UseSpyStateArgs) {
  const [username, setUsername] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [targetUser, setTargetUser] = useState<SleeperUser | null>(null);
  const [targetLeagues, setTargetLeagues] = useState<SleeperLeague[]>([]);

  // Global value maps (league-independent) — loaded once.
  const [pickFcValues, setPickFcValues] = useState<Record<string, number>>({});
  const [redraftValues, setRedraftValues] = useState<Record<string, number>>({});
  // Shares the same persisted seed as the main Season Simulator (simSalt_v1) so
  // odds are stable across reloads and agree with every other simulateLeague call
  // site — see useSimulatorState.ts for the original fix this mirrors.
  const [simSalt] = useState<number>(() => {
    const stored = getLocalStorageItem<number | null>("simSalt_v1", null);
    if (stored != null) return stored;
    const fresh = Math.floor(Math.random() * 1_000_000);
    setLocalStorageItem("simSalt_v1", fresh);
    return fresh;
  });

  const { leagueOverviewData, loadingLeagueOverview, leagueOverviewLoaded, loadLeagueOverview } =
    useLeagueOverview(targetLeagues, targetUser);

  // Drill-down league
  const [selectedSpyLeague, setSelectedSpyLeague] = useState<SleeperLeague | null>(null);
  const [loadingLeague, setLoadingLeague] = useState(false);
  const [spyLeagueBundle, setSpyLeagueBundle] = useState<SpyLeagueBundle | null>(null);

  // Multi-league sims (Run All Sims) — target's playoff% per league, in memory only.
  const [spyPlayoffByLeague, setSpyPlayoffByLeague] = useState<Record<string, number>>({});
  const [simProgress, setSimProgress] = useState<{ done: number; total: number } | null>(null);
  const [simRunning, setSimRunning] = useState(false);

  const cancelRef = useRef(false);
  useEffect(() => () => { cancelRef.current = true; }, []);

  // Load global pick + redraft values once on mount.
  useEffect(() => {
    let cancelled = false;
    fetchFantasyCalcValues(2)
      .then(({ pickValues }) => { if (!cancelled) setPickFcValues(pickValues); })
      .catch((err) => log.error("pick values load failed", { err: String(err) }));
    fetch(`${FANTASYCALC_BASE_URL}/values/current?isDynasty=false&numQbs=2`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const vals: Record<string, number> = {};
        (data as { player?: { sleeperId?: string }; value: number }[]).forEach((e) => {
          const sid = e.player?.sleeperId;
          if (sid) vals[String(sid)] = e.value;
        });
        setRedraftValues(vals);
      })
      .catch((err) => log.error("redraft values load failed", { err: String(err) }));
    return () => { cancelled = true; };
  }, []);

  const lookup = useCallback(async (rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    setLookupLoading(true);
    setLookupError("");
    setSelectedSpyLeague(null);
    setSpyLeagueBundle(null);
    setSpyPlayoffByLeague({});
    setSimProgress(null);
    try {
      const resolved = await sleeperApi.getUserByUsername(name);
      if (!resolved?.user_id) {
        setTargetUser(null);
        setTargetLeagues([]);
        setLookupError(`No Sleeper user found for "${name}".`);
        return;
      }
      const leaguesData = await sleeperApi.getUserLeagues(resolved.user_id, CURRENT_YEAR);
      const dynasty = (Array.isArray(leaguesData) ? leaguesData : []).filter(isDynastyLeague);
      setTargetUser(resolved);
      setTargetLeagues(dynasty);
      if (!dynasty.length) {
        setLookupError(`${resolved.display_name || name} has no dynasty leagues for ${CURRENT_YEAR}.`);
      }
    } catch (err) {
      log.error("spy lookup failed", { err: String(err) });
      setLookupError("Lookup failed — try again.");
    } finally {
      setLookupLoading(false);
    }
  }, []);

  // Auto-load the multi-league overview once leagues resolve.
  useEffect(() => {
    if (targetLeagues.length && targetUser) loadLeagueOverview();
  }, [targetLeagues, targetUser, loadLeagueOverview]);

  // Compute league-adjusted value maps + direction + sim for a league, given
  // its core data and league-scoped FantasyCalc dynasty values.
  const buildBundle = useCallback((
    league: SleeperLeague,
    core: SpyLeagueCore,
    calcFcValues: Record<string, number>,
  ): SpyLeagueBundle => {
    const scoring = league.scoring_settings;
    const applyMult = (src: Record<string, number>): Record<string, number> => {
      if (!scoring || Object.keys(src).length === 0) return src;
      const multipliers = computeScoringMultipliers(scoring);
      const adjusted: Record<string, number> = {};
      for (const [id, value] of Object.entries(src)) {
        const pos = players[id]?.position ?? "";
        adjusted[id] = Math.round(value * (multipliers[pos] ?? 1));
      }
      return adjusted;
    };
    const leagueAdjustedFcValues = applyMult(calcFcValues);
    const leagueAdjustedRedraftValues = applyMult(redraftValues);

    const myRosterId = core.myRoster?.roster_id;
    let selectedLeagueDirection: RosterDirectionProfile | null = null;
    if (myRosterId != null && Object.keys(leagueAdjustedFcValues).length && Object.keys(leagueAdjustedRedraftValues).length) {
      selectedLeagueDirection = getRosterDirectionProfile({
        rosterId: myRosterId,
        rosters: core.rosters,
        ownedPicks: core.allPicks,
        players,
        pickValues: pickFcValues,
        redraftValues: leagueAdjustedRedraftValues,
        dynastyValueForPlayer: (id: string) => leagueAdjustedFcValues[id] ?? players[id]?.value ?? 0,
      });
    }

    const projectedRookies = projectRookiesByRoster({
      selectedLeague: league,
      nflState,
      draftSettings: core.draftSettings,
      rosters: core.rosters,
      rookies,
      allPicks: core.allPicks,
      players,
      leagueAdjustedFcValues,
    });

    const selectedLeagueSimulation = simulateLeague({
      selectedLeague: league,
      rosters: core.rosters,
      players,
      nflState,
      projectionData,
      projectionWeek,
      playerStats,
      leagueWeeklyMatchups: {},
      standings: core.standings,
      users: core.users,
      leagueAdjustedFcValues,
      leagueAdjustedRedraftValues,
      projectedRookiesByRoster: projectedRookies,
      simSalt,
    });

    let selectedLeagueDirectionAdjusted: RosterDirectionProfile | null = null;
    if (selectedLeagueDirection && myRosterId != null) {
      const simRow = selectedLeagueSimulation?.rowByRosterId.get(Number(myRosterId));
      const hasSim = !!simRow;
      const playoffOdds = Number(simRow?.playoffOdds ?? 0);
      const adjustedBucket = getAdjustedDirectionBucket(selectedLeagueDirection.bucket, selectedLeagueDirection, playoffOdds, hasSim);
      // Extra runtime fields (playoffOdds/hasSimData) mirror useAppState's
      // adjusted profile; cast past the excess-property check like it does.
      selectedLeagueDirectionAdjusted = {
        ...selectedLeagueDirection,
        bucket: adjustedBucket,
        bucketColor: getBucketColor(adjustedBucket),
        rawBucket: selectedLeagueDirection.bucket,
        playoffOdds,
        hasSimData: hasSim,
      } as RosterDirectionProfile;
    }

    return {
      league,
      rosters: core.rosters,
      users: core.users,
      allPicks: core.allPicks,
      picks: core.picks,
      standings: core.standings,
      myRoster: core.myRoster,
      freeAgents: core.freeAgents,
      leagueAdjustedFcValues,
      leagueAdjustedRedraftValues,
      selectedLeagueDirection,
      selectedLeagueDirectionAdjusted,
      selectedLeagueSimulation,
    };
  }, [players, redraftValues, pickFcValues, nflState, rookies, projectionData, projectionWeek, playerStats, simSalt]);

  const selectSpyLeague = useCallback(async (league: SleeperLeague) => {
    if (!targetUser) return;
    setSelectedSpyLeague(league);
    setLoadingLeague(true);
    setSpyLeagueBundle(null);
    try {
      const [core, calcFcValues] = await Promise.all([
        loadSpyLeagueCore(league, targetUser.user_id, players),
        fetchLeagueCalcValues(league.league_id),
      ]);
      const bundle = buildBundle(league, core, calcFcValues);
      setSpyLeagueBundle(bundle);
      // Cache the target's playoff% for the overview table too.
      const myRosterId = core.myRoster?.roster_id;
      const odds = myRosterId != null ? bundle.selectedLeagueSimulation?.rowByRosterId.get(Number(myRosterId))?.playoffOdds : undefined;
      if (odds != null) setSpyPlayoffByLeague((prev) => ({ ...prev, [league.league_id]: odds }));
    } catch (err) {
      log.error("selectSpyLeague failed", { err: String(err) });
    } finally {
      setLoadingLeague(false);
    }
  }, [targetUser, players, buildBundle]);

  const clearSelectedLeague = useCallback(() => {
    setSelectedSpyLeague(null);
    setSpyLeagueBundle(null);
  }, []);

  // Run All Sims — sequential, read-only, persist-nothing. Computes the
  // target's playoff% for every league. Heavy (per-league FantasyCalc fetch +
  // full Monte-Carlo sim); only fires on explicit button press.
  const runAllSpySims = useCallback(async () => {
    if (!targetUser || !targetLeagues.length || simRunning) return;
    setSimRunning(true);
    setSimProgress({ done: 0, total: targetLeagues.length });
    try {
      for (const league of targetLeagues) {
        if (cancelRef.current) break;
        try {
          const [core, calcFcValues] = await Promise.all([
            loadSpyLeagueCore(league, targetUser.user_id, players),
            fetchLeagueCalcValues(league.league_id),
          ]);
          if (core.myRoster) {
            const bundle = buildBundle(league, core, calcFcValues);
            const odds = bundle.selectedLeagueSimulation?.rowByRosterId.get(Number(core.myRoster.roster_id))?.playoffOdds;
            if (odds != null) setSpyPlayoffByLeague((prev) => ({ ...prev, [league.league_id]: odds }));
          }
        } catch (err) {
          log.warn("run-all sim league failed", { league: league.league_id, err: String(err) });
        }
        setSimProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : null));
      }
    } finally {
      setSimRunning(false);
    }
  }, [targetUser, targetLeagues, simRunning, players, buildBundle]);

  const reset = useCallback(() => {
    setUsername("");
    setLookupError("");
    setTargetUser(null);
    setTargetLeagues([]);
    setSelectedSpyLeague(null);
    setSpyLeagueBundle(null);
    setSpyPlayoffByLeague({});
    setSimProgress(null);
  }, []);

  return {
    username, setUsername,
    lookupLoading, lookupError,
    targetUser, targetLeagues,
    lookup, reset,
    // global values
    pickFcValues, redraftValues,
    // overview
    leagueOverviewData, loadingLeagueOverview, leagueOverviewLoaded, loadLeagueOverview,
    spyPlayoffByLeague, simProgress, simRunning, runAllSpySims,
    // drill-down
    selectedSpyLeague, selectSpyLeague, clearSelectedLeague, loadingLeague, spyLeagueBundle,
  };
}

export type UseSpyStateReturn = ReturnType<typeof useSpyState>;
