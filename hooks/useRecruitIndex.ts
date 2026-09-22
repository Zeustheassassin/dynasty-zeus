"use client";
import { useState, useEffect, useCallback } from "react";
import type { RecruitRow } from "../lib/recruiting/cfd";
import { findRecruitMatch, type MatchableProspect } from "../lib/recruiting/match";
import { loadRecruitSnapshot, peekRecruitSnapshot, type RecruitSnapshot } from "../lib/recruiting/recruitStore";

export interface UseRecruitIndexReturn {
  loaded: boolean;
  matchProspect: (p: MatchableProspect) => RecruitRow | null;
  recruitCount: number;
}

const EMPTY_INDEX: Map<string, RecruitRow[]> = new Map();

/**
 * Exposes `matchProspect()` backed by an in-memory name index of the recruits table.
 *
 * The table (~30k rows) is loaded once and shared by every mount through
 * lib/recruiting/recruitStore — concurrent mounts join one in-flight load and later mounts
 * reuse the cached snapshot (10 min TTL, dropped when Recruits is refreshed from CFD), so a
 * remount renders with `loaded` already true instead of re-paging the table.
 *
 * Only the fields needed for matching/display are pulled: id, name, position, year, stars,
 * school, ranking, committed_to.
 */
export function useRecruitIndex(): UseRecruitIndexReturn {
  const [snapshot, setSnapshot] = useState<RecruitSnapshot | null>(() => peekRecruitSnapshot());

  useEffect(() => {
    let cancelled = false;
    loadRecruitSnapshot().then((s) => { if (!cancelled) setSnapshot(s); });
    return () => { cancelled = true; };
  }, []);

  const index = snapshot?.index ?? EMPTY_INDEX;

  const matchProspect = useCallback(
    (p: MatchableProspect) => findRecruitMatch(p, index),
    [index]
  );

  return { loaded: snapshot !== null, matchProspect, recruitCount: snapshot?.rows.length ?? 0 };
}
