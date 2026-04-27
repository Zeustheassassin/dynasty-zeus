"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";
import type { RecruitRow } from "../lib/recruiting/cfd";
import { buildRecruitIndex, findRecruitMatch, type MatchableProspect } from "../lib/recruiting/match";

const log = logger("hooks/useRecruitIndex");

export interface UseRecruitIndexReturn {
  loaded: boolean;
  matchProspect: (p: MatchableProspect) => RecruitRow | null;
  recruitCount: number;
}

/**
 * Loads the minimal recruit fields needed for prospect→recruit matching from Supabase
 * once per page mount, builds an in-memory name index, and exposes a `matchProspect()`
 * function. The index is rebuilt whenever the underlying data changes (rare).
 *
 * Only pulls fields actually used for matching/display: name, position, year, stars,
 * school. Keeps the payload tiny (~30 bytes/row × 30k rows ≈ 1MB worst case).
 */
export function useRecruitIndex(): UseRecruitIndexReturn {
  const [recruits, setRecruits] = useState<RecruitRow[]>([]);
  const [loaded, setLoaded]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Supabase enforces PostgREST `max-rows` (default 1000) regardless of `.range()`.
      // Paginate in 1000-row chunks until a short page indicates the end. For a typical
      // 10-year cache (~30k rows) this is ~30 round trips, all small.
      const PAGE = 1000;
      const all: RecruitRow[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("recruits")
          .select("id,name,position,year,stars,school,ranking,committed_to")
          .range(from, from + PAGE - 1);
        if (cancelled) return;
        if (error) {
          log.error("recruit index load failed", { err: error.message, page: from / PAGE });
          break;
        }
        const batch = data ?? [];
        all.push(...(batch as unknown as RecruitRow[]));
        if (batch.length < PAGE) break; // partial page = last page
        from += PAGE;
      }
      if (cancelled) return;
      setRecruits(all);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const index = useMemo(() => buildRecruitIndex(recruits), [recruits]);

  const matchProspect = useCallback(
    (p: MatchableProspect) => findRecruitMatch(p, index),
    [index]
  );

  return { loaded, matchProspect, recruitCount: recruits.length };
}
