"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabaseclient";
import { logger } from "../../lib/logger";
import { simulateLeague, type PoolPlayer } from "../../lib/helpers/simulation";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import { ROOKIE_YEAR } from "../../hooks/useRookieBoardState";
import type { PlayerUsage } from "../../hooks/usePlayerStats";
import type {
  SleeperLeague, SleeperRoster, SleeperPlayer, SleeperMatchup, SleeperNFLState,
  CommittedSimsByLeague, CachedSimRow, SimRow, SimulationTeamRow, LeagueSimulation,
  ProjectionRow, StandingRow,
} from "../../lib/types";

const log = logger("useSimulatorState");

export interface SimulatorCtx {
  selectedLeague: SleeperLeague | null;
  rosters: SleeperRoster[];
  players: Record<string, SleeperPlayer>;
  nflState: SleeperNFLState | null;
  projectionData: ProjectionRow[];
  projectionWeek: number;
  playerStats: Record<string, PlayerUsage> | null;
  leagueWeeklyMatchups: Record<string, { week: number; matchups: SleeperMatchup[] }[]>;
  standings: StandingRow[];
  users: Record<string, string>;
  leagueAdjustedFcValues: Record<string, number>;
  leagueAdjustedRedraftValues: Record<string, number>;
  projectedRookiesByRoster: Map<number, PoolPlayer[]>;
  supabaseUser: User | null;
  leagues: SleeperLeague[];
  loadRoster: (league: SleeperLeague) => Promise<void>;
}

export interface SimulatorResult {
  selectedLeagueSimulation: LeagueSimulation | null;
  committedSimsByLeague: CommittedSimsByLeague;
  leagueSimCache: Record<string, Record<number, CachedSimRow>>;
  simQueue: string[];
  simProgress: { done: number; total: number } | null;
  simSalt: number;
  readyLeagueId: string | null;
  setReadyLeagueId: React.Dispatch<React.SetStateAction<string | null>>;
  myDraftSlotPicks: Record<string, string>;
  setMyDraftSlotPicks: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  draftSlotEditing: string | null;
  setDraftSlotEditing: React.Dispatch<React.SetStateAction<string | null>>;
  draftSlotSearchQuery: string;
  setDraftSlotSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  saveSimulationToSupabase: (leagueId: string, simRows: SimulationTeamRow[]) => void;
  handleRunAllSims: () => void;
}

export function useSimulatorState(ctx: SimulatorCtx): SimulatorResult {
  const {
    selectedLeague, rosters, players, nflState,
    projectionData, projectionWeek, playerStats,
    leagueWeeklyMatchups, standings, users,
    leagueAdjustedFcValues, leagueAdjustedRedraftValues,
    projectedRookiesByRoster, supabaseUser, leagues, loadRoster,
  } = ctx;

  const [leagueSimCache, setLeagueSimCache] = useState<Record<string, Record<number, CachedSimRow>>>({});
  const [readyLeagueId, setReadyLeagueId] = useState<string | null>(null);
  const [simQueue, setSimQueue] = useState<string[]>([]);
  const [simProgress, setSimProgress] = useState<{ done: number; total: number } | null>(null);
  const [simSalt, setSimSalt] = useState<number>(() => Math.floor(Math.random() * 1_000_000));
  const [committedSimsByLeague, setCommittedSimsByLeague] = useState<CommittedSimsByLeague>(() =>
    getLocalStorageItem<CommittedSimsByLeague>("committedSimRows_v2", {})
  );
  const [myDraftSlotPicks, setMyDraftSlotPicks] = useState<Record<string, string>>({});
  const [draftSlotEditing, setDraftSlotEditing] = useState<string | null>(null);
  const [draftSlotSearchQuery, setDraftSlotSearchQuery] = useState("");
  // Always reflects the current league — read in save effect via ref so league switches don't trigger saves with stale picks
  const draftLeagueRef = useRef(selectedLeague?.league_id);
  // Tracks the last value loaded from (or saved to) Supabase, keyed by league_id. Save effect
  // skips when current state matches the synced value — this prevents legacy localStorage data
  // from being re-uploaded to Supabase on every page load (which kept undoing user resets).
  const lastSyncedDraftPicksRef = useRef<string>("");
  // Sync ref inside an effect (not during render) — must be declared before load/save effects
  // so React runs it first and the save effect always sees the current league ID.
  useEffect(() => {
    draftLeagueRef.current = selectedLeague?.league_id;
  }, [selectedLeague?.league_id]);

  // Load persisted sim results from Supabase on login; keep in-memory values if newer
  useEffect(() => {
    if (!supabaseUser) return;
    supabase
      .from("league_simulations")
      .select("league_id,roster_id,playoff_odds,title_odds,expected_wins,avg_finish,finish_range,computed_at")
      .eq("user_id", supabaseUser.id)
      .then(({ data }) => {
        if (!data?.length) return;
        const byLeague: Record<string, Record<number, CachedSimRow>> = {};
        data.forEach((row) => {
          if (!byLeague[row.league_id]) byLeague[row.league_id] = {};
          byLeague[row.league_id][Number(row.roster_id)] = row as CachedSimRow;
        });
        setLeagueSimCache(prev => {
          const merged: Record<string, Record<number, CachedSimRow>> = { ...byLeague };
          Object.entries(prev).forEach(([lid, rosterMap]) => {
            Object.entries(rosterMap as Record<string, CachedSimRow>).forEach(([rid, memRow]) => {
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
  }, [supabaseUser]);

  // Load saved draft slot picks — localStorage paint instantly, then Supabase is the source of truth.
  // The Supabase result always overwrites local state and localStorage, even when empty, so a reset
  // on one device propagates correctly. lastSyncedDraftPicksRef is set to the loaded value so the
  // save effect can tell user-edits apart from system-loads.
  useEffect(() => {
    if (!selectedLeague?.league_id) return;
    let cancelled = false;
    const lsKey = `draftPicks_${selectedLeague.league_id}_${ROOKIE_YEAR}`;
    const saved = getLocalStorageItem<Record<string, string> | null>(lsKey, null) ?? {};
    lastSyncedDraftPicksRef.current = JSON.stringify(saved);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading external localStorage source for this league; async Supabase overwrites below
    setMyDraftSlotPicks(saved);
    if (!supabaseUser) return;
    supabase
      .from("draft_board_picks")
      .select("pick_slot,player_id")
      .eq("user_id", supabaseUser.id)
      .eq("league_id", selectedLeague.league_id)
      .eq("season", ROOKIE_YEAR)
      .then(({ data }) => {
        if (cancelled) return;
        const picks: Record<string, string> = {};
        (data ?? []).forEach((row) => { picks[row.pick_slot] = row.player_id; });
        lastSyncedDraftPicksRef.current = JSON.stringify(picks);
        setMyDraftSlotPicks(picks);
        setLocalStorageItem(lsKey, picks);
      });
    return () => { cancelled = true; };
  }, [supabaseUser, selectedLeague?.league_id]);

  // Save draft slot picks — localStorage + Supabase, only on actual user edits.
  // - Uses draftLeagueRef (not selectedLeague in deps) so a league switch doesn't trigger a save
  //   with the outgoing league's picks written under the incoming league's ID.
  // - Skips when current state equals lastSyncedDraftPicksRef — that means the change came from a
  //   load (LS or Supabase), not a user edit. This stops legacy localStorage data from being
  //   re-uploaded to Supabase on every page open, which was undoing user resets.
  // - Diffs against the synced state to detect removed slots and deletes their Supabase rows,
  //   so cleanup (e.g. placeholder dropped because the slot was actually drafted) persists.
  useEffect(() => {
    const leagueId = draftLeagueRef.current;
    if (!leagueId) return;
    const currentJson = JSON.stringify(myDraftSlotPicks);
    if (currentJson === lastSyncedDraftPicksRef.current) return;
    const lsKey = `draftPicks_${leagueId}_${ROOKIE_YEAR}`;
    setLocalStorageItem(lsKey, myDraftSlotPicks);
    const previousPicks = JSON.parse(lastSyncedDraftPicksRef.current || "{}") as Record<string, string>;
    const removedSlots = Object.keys(previousPicks).filter((slot) => !(slot in myDraftSlotPicks));
    lastSyncedDraftPicksRef.current = currentJson;
    if (!supabaseUser) return;
    if (removedSlots.length > 0) {
      supabase
        .from("draft_board_picks")
        .delete()
        .eq("user_id", supabaseUser.id)
        .eq("league_id", leagueId)
        .eq("season", ROOKIE_YEAR)
        .in("pick_slot", removedSlots)
        .then(() => {}, (err: unknown) => log.error("draft_board_picks delete failed", { err: String(err) }));
    }
    if (Object.keys(myDraftSlotPicks).length > 0) {
      const rows = Object.entries(myDraftSlotPicks).map(([pick_slot, player_id]) => ({
        user_id: supabaseUser.id,
        league_id: leagueId,
        season: ROOKIE_YEAR,
        pick_slot,
        player_id,
        updated_at: new Date().toISOString(),
      }));
      supabase
        .from("draft_board_picks")
        .upsert(rows, { onConflict: "user_id,league_id,season,pick_slot" })
        .then(() => {}, (err: unknown) => log.error("draft_board_picks upsert failed", { err: String(err) }));
    }
  }, [supabaseUser, myDraftSlotPicks]);

  const selectedLeagueSimulation = useMemo(
    (): LeagueSimulation | null =>
      simulateLeague({
        selectedLeague,
        rosters,
        players,
        nflState,
        projectionData,
        projectionWeek,
        playerStats,
        leagueWeeklyMatchups,
        standings,
        users,
        leagueAdjustedFcValues,
        leagueAdjustedRedraftValues,
        projectedRookiesByRoster,
        simSalt,
      }),
    [
      selectedLeague,
      rosters,
      nflState,
      projectionData,
      projectionWeek,
      players,
      playerStats,
      leagueAdjustedRedraftValues,
      leagueAdjustedFcValues,
      leagueWeeklyMatchups,
      standings,
      users,
      simSalt,
      projectedRookiesByRoster,
    ]
  );

  const saveSimulationToSupabase = useCallback((leagueId: string, simRows: SimulationTeamRow[]) => {
    const now = new Date().toISOString();
    const newEntries = Object.fromEntries(
      simRows.map((row) => [row.rosterId, {
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
    const frozenRows: Record<number, SimRow> = Object.fromEntries(
      simRows.map((row) => [row.rosterId, {
        rosterId: row.rosterId,
        wins: row.actualWins ?? 0,
        losses: row.actualLosses ?? 0,
        ties: 0,
        pointsFor: row.pointsFor ?? 0,
        playoffOdds: row.playoffOdds ?? 0,
      }])
    );
    setCommittedSimsByLeague((prev) => {
      const next = { ...prev, [leagueId]: frozenRows };
      setLocalStorageItem("committedSimRows_v2", next);
      return next;
    });
    if (supabaseUser) {
      const rows = simRows.map((row) => ({
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
        .then(() => {}, (err: unknown) => log.error("league_simulations upsert failed", { err: String(err) }));
    }
  }, [supabaseUser]);

  // Queue state machine: when the front of the queue is ready (loadRoster finished),
  // save the sim, advance the queue, and start loading the next league.
  useEffect(() => {
    if (!simQueue.length) return;
    if (readyLeagueId !== simQueue[0]) return;

    const leagueId = simQueue[0];
    if (
      selectedLeagueSimulation?.rows?.length &&
      selectedLeague?.league_id === leagueId
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- state machine: sim result must be committed synchronously before queue advances
      saveSimulationToSupabase(leagueId, selectedLeagueSimulation.rows);
    }

    const remaining = simQueue.slice(1);
    setSimQueue(remaining);
    setSimProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : null);

    if (remaining.length > 0) {
      const nextLeague = leagues.find((l) => l.league_id === remaining[0]);
      if (nextLeague) loadRoster(nextLeague);
    }
  }, [simQueue, readyLeagueId, selectedLeagueSimulation, selectedLeague?.league_id, leagues, saveSimulationToSupabase, loadRoster]);

  const handleRunAllSims = useCallback(() => {
    if (!leagues.length) return;
    const leagueIds = leagues.map((l) => l.league_id);
    setSimProgress({ done: 0, total: leagueIds.length });
    setReadyLeagueId(null);
    setSimSalt(Math.floor(Math.random() * 1_000_000));
    setSimQueue(leagueIds);
    const first = leagues.find((l) => l.league_id === leagueIds[0]);
    if (first) loadRoster(first);
  }, [leagues, loadRoster]);

  return {
    selectedLeagueSimulation,
    committedSimsByLeague,
    leagueSimCache,
    simQueue,
    simProgress,
    simSalt,
    readyLeagueId,
    setReadyLeagueId,
    myDraftSlotPicks,
    setMyDraftSlotPicks,
    draftSlotEditing,
    setDraftSlotEditing,
    draftSlotSearchQuery,
    setDraftSlotSearchQuery,
    saveSimulationToSupabase,
    handleRunAllSims,
  };
}
