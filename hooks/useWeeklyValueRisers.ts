"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";
import {
  computeValueRisers,
  isoDaysBefore,
  WAIVER_RISE_DAYS,
  type ValueRiser,
  type ValueSnapshotRow,
} from "../lib/helpers/waiverWatch";

// ============================================================
// useWeeklyValueRisers — the To-Do hub Waiver Watch's 7-day value risers,
// from the daily player_value_history snapshots (migration 047; shared,
// public-read). Compares the latest snapshot with the newest one at least
// WAIVER_RISE_DAYS older, so a day the cron skipped never shortens the window.
// Supabase only — no Sleeper calls.
//
// Four small reads: the latest date, the base date, then both dates' rows in
// parallel. One date is ~400 rows (one per FantasyCalc player, checked 10/14),
// so each read sits well under PostgREST's 1000-row answer cap — reading both
// dates in one request (~800) would leave little room as the list grows.
// ============================================================

const log = logger("hooks/useWeeklyValueRisers");

/** PostgREST's max rows per answer; a read that returns this many may have been cut short. */
const POSTGREST_MAX_ROWS = 1000;
/** The cron writes one snapshot a day (08:00 UTC), so re-reading within the hour buys nothing. */
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface WeeklyValueRisers {
  risers: ValueRiser[];
  /** Latest snapshot date (YYYY-MM-DD). */
  latestDate: string;
  /** The snapshot the rise is measured from. */
  baseDate: string;
}

async function newestSnapshotDate(onOrBefore?: string): Promise<string | null> {
  let query = supabase.from("player_value_history").select("snapshot_date");
  if (onOrBefore) query = query.lte("snapshot_date", onOrBefore);
  const { data, error } = await query.order("snapshot_date", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0]?.snapshot_date as string | undefined) ?? null;
}

async function readSnapshot(date: string): Promise<ValueSnapshotRow[]> {
  const { data, error } = await supabase
    .from("player_value_history")
    .select("player_id,value")
    .eq("snapshot_date", date);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ValueSnapshotRow[];
  if (rows.length >= POSTGREST_MAX_ROWS) {
    log.warn("value snapshot read hit PostgREST's row cap — risers may be missing players", { date, rows: rows.length });
  }
  return rows;
}

/** Null = under a week of history, so there's nothing to compare yet. Throws on a read error. */
export async function fetchWeeklyValueRisers(): Promise<WeeklyValueRisers | null> {
  const latestDate = await newestSnapshotDate();
  if (!latestDate) return null;
  const baseDate = await newestSnapshotDate(isoDaysBefore(latestDate, WAIVER_RISE_DAYS));
  if (!baseDate) return null;
  const [latest, base] = await Promise.all([readSnapshot(latestDate), readSnapshot(baseDate)]);
  return { risers: computeValueRisers(latest, base), latestDate, baseDate };
}

// Module-level so leaving and re-opening the tab (or a second mount) reuses one answer.
let cache: { at: number; data: WeeklyValueRisers | null } | null = null;
let inflight: Promise<WeeklyValueRisers | null> | null = null;

const freshCache = () => (cache && Date.now() - cache.at < CACHE_TTL_MS ? cache : null);

/** Cached for CACHE_TTL_MS and de-duplicated while in flight; a failed read isn't cached. */
export function loadWeeklyValueRisers(): Promise<WeeklyValueRisers | null> {
  const hit = freshCache();
  if (hit) return Promise.resolve(hit.data);
  if (!inflight) {
    inflight = fetchWeeklyValueRisers()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Tests only — the cache is module state. */
export function resetWeeklyValueRisersCache(): void {
  cache = null;
  inflight = null;
}

interface RisersResult {
  data: WeeklyValueRisers | null;
  error: string | null;
}

/** Loads while `enabled` (the Waiver Watch tab is open). `loading` until the first answer;
 *  `data` null with no error = not enough history yet. */
export function useWeeklyValueRisers(enabled: boolean) {
  const [result, setResult] = useState<RisersResult | null>(() => {
    const hit = freshCache();
    return hit ? { data: hit.data, error: null } : null;
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadWeeklyValueRisers()
      .then((data) => {
        if (!cancelled) setResult({ data, error: null });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        log.error("player_value_history read failed", { err: message });
        if (!cancelled) setResult({ data: null, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setResult(null);
    setAttempt((n) => n + 1);
  }, []);

  return {
    data: result?.data ?? null,
    error: result?.error ?? null,
    loading: enabled && result == null,
    retry,
  };
}
