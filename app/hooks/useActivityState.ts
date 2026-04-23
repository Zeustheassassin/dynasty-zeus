"use client";
import { useState, useCallback } from "react";
import { supabase } from "../../lib/supabaseclient";
import { logger } from "../../lib/logger";
import { ROOKIE_YEAR } from "../../hooks/useRookieBoardState";
import type {
  SleeperRoster, SleeperUser, SleeperMatchup, SleeperDraft, SleeperDraftPick,
  AnnotatedTransaction,
} from "../../lib/types";

const log = logger("app/hooks/useActivityState");

export function useActivityState(
  rosters: SleeperRoster[],
  user: SleeperUser | null,
) {
  const [activityTransactions, setActivityTransactions] = useState<AnnotatedTransaction[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [leagueWeeklyMatchups, setLeagueWeeklyMatchups] = useState<Record<string, { week: number; matchups: SleeperMatchup[] }[]>>({});
  const [loadingLeagueWeeklyMatchups, setLoadingLeagueWeeklyMatchups] = useState(false);
  const [ownerDraftTendencies, setOwnerDraftTendencies] = useState<Record<string, Record<string, number>>>({});

  const loadActivity = useCallback(async (leagueId: string) => {
    if (!leagueId) return;
    setLoadingActivity(true);
    try {
      const weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
      const results = await Promise.all(
        weeks.map(w =>
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${w}`)
            .then(r => r.json())
            .catch(() => [])
        )
      );
      const all = results.flat().filter((t) => t && t.status === "complete");
      all.sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
      setActivityTransactions(all.slice(0, 150) as AnnotatedTransaction[]);
    } catch (err) {
      log.error('loadActivity failed', { err: String(err) });
    } finally { setLoadingActivity(false); }
  }, []);

  // Prefers current ROOKIE_YEAR completed drafts; falls back to prior year if none exist yet.
  // Automatically uses the right year once current-year drafts start completing.
  const loadOwnerTendencies = useCallback(async () => {
    if (!rosters.length) return;
    const PREV_YEAR = String(Number(ROOKIE_YEAR) - 1);
    const ownerUserIds: string[] = rosters
      .map((r) => r.owner_id)
      .filter((uid) => uid && uid !== user?.user_id);
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
    (cached ?? []).forEach((row) => {
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
    const newRows: Array<{ owner_user_id: string; season: string; rates: Record<string, number>; pick_count: number; updated_at: string }> = [];

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
          await Promise.all(leagues.map(async (league) => {
            try {
              const draftsRes = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`);
              const drafts = (await draftsRes.json()) as SleeperDraft[];
              const rookieDraft = drafts.find(
                (d) =>
                  d.season === year &&
                  d.status === "complete" &&
                  (d.settings?.rounds ?? 99) <= 5
              );
              if (!rookieDraft) return;
              const picksRes = await fetch(`https://api.sleeper.app/v1/draft/${rookieDraft.draft_id}/picks`);
              const picks = (await picksRes.json()) as SleeperDraftPick[];
              picks
                .filter((p) => p.picked_by === userId && p.metadata?.position)
                .forEach((p) => {
                  collected.push({ round: Number(p.round), position: String(p.metadata.position) });
                });
            } catch (err) {
              log.warn('loadDraftScout draft picks fetch error', { err: String(err) });
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
        log.warn('loadDraftScout owner tendencies error', { userId, err: String(err) });
      }
    }));

    // ── 3. Persist newly fetched data so next load hits cache ────────────────
    if (newRows.length) {
      supabase.from("owner_tendencies")
        .upsert(newRows, { onConflict: "owner_user_id,season" })
        .then(() => {}, (err: unknown) => log.error("owner_tendencies upsert failed", { err: String(err) }));
    }

    setOwnerDraftTendencies(tendencies);
  }, [rosters, user]);

  return {
    activityTransactions,
    setActivityTransactions,
    loadingActivity,
    leagueWeeklyMatchups,
    setLeagueWeeklyMatchups,
    loadingLeagueWeeklyMatchups,
    setLoadingLeagueWeeklyMatchups,
    ownerDraftTendencies,
    loadActivity,
    loadOwnerTendencies,
  };
}
