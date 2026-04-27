"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";
import type { RecruitRow } from "../lib/recruiting/cfd";

const log = logger("hooks/useRecruits");

export interface RecruitsMeta {
  year: number;
  last_refreshed_at: string;
  total_records: number;
  refreshed_by: string | null;
}

export interface UseRecruitsReturn {
  recruits: RecruitRow[];
  meta: RecruitsMeta | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Loads cached recruits from `/api/recruiting/[year]` and exposes a `refresh()`
 * action that pulls a fresh class from CFD via the same route's POST handler.
 *
 * Keyed by `year` — switching years re-fetches the cache for the new year.
 * Stale-while-revalidate: existing data stays visible while a refresh runs.
 */
export function useRecruits(year: number | null): UseRecruitsReturn {
  const [recruits, setRecruits]     = useState<RecruitRow[]>([]);
  const [meta, setMeta]             = useState<RecruitsMeta | null>(null);
  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // Keeps the latest year for the refresh callback so it always uses the current selection.
  const yearRef = useRef(year);
  useEffect(() => { yearRef.current = year; }, [year]);

  // Load cache on year change.
  useEffect(() => {
    if (year == null) {
      setRecruits([]);
      setMeta(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Not signed in");
        const res = await fetch(`/api/recruiting/${year}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        if (cancelled) return;
        setRecruits(json.recruits ?? []);
        setMeta(json.meta ?? null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        log.error("recruits load failed", { year, err: String(e) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [year]);

  const refresh = useCallback(async () => {
    const y = yearRef.current;
    if (y == null) return;
    setRefreshing(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const res = await fetch(`/api/recruiting/${y}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      // Refresh succeeded — re-pull the cached rows for display.
      const reload = await fetch(`/api/recruiting/${y}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (reload.ok) {
        const json = await reload.json();
        setRecruits(json.recruits ?? []);
        setMeta(json.meta ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      log.error("recruits refresh failed", { year: y, err: String(e) });
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { recruits, meta, loading, refreshing, error, refresh };
}
