"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { User as SupabaseUser } from "@supabase/auth-js";
import { supabase } from "../../lib/supabaseclient";
import { logger } from "../../lib/logger";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";

const log = logger("app/hooks/usePersonalRankings");

export const PERSONAL_RANKINGS_KEY = "personalRankings_v1";

/**
 * The user's own ordered player board — a single global ranking of Sleeper
 * player_ids (array index = rank). The gap between this and the market-consensus
 * board is what drives the Trade Finder buy/sell signal, replacing the old manual
 * player_dispositions dropdowns.
 *
 * This hook is *persistence only*. Seeding from consensus, reconciling against the
 * live player universe, and deriving the buy/sell signal are pure functions in
 * lib/helpers/personalRankings.ts, applied at the point of consumption where the
 * consensus order is available.
 *
 * Dual-persist, mirroring usePlayerAnnotations: localStorage is written
 * synchronously for instant reload; the Supabase `personal_rankings` table (one
 * jsonb row per user) is the cross-device source of truth, hydrated by useAppState
 * on login via setPersonalOrdering.
 */
export function usePersonalRankings(supabaseUser: SupabaseUser | null) {
  const [personalOrdering, setPersonalOrdering] = useState<string[]>(() =>
    getLocalStorageItem<string[]>(PERSONAL_RANKINGS_KEY, [])
  );

  // Ref so the save closure always reads the latest supabaseUser without a stale capture.
  const supabaseUserRef = useRef<SupabaseUser | null>(null);
  useEffect(() => { supabaseUserRef.current = supabaseUser; }, [supabaseUser]);

  const savePersonalOrdering = useCallback((next: string[]) => {
    setPersonalOrdering(next);
    setLocalStorageItem(PERSONAL_RANKINGS_KEY, next);
    const sbUser = supabaseUserRef.current;
    if (sbUser) {
      supabase.from("personal_rankings").upsert(
        { user_id: sbUser.id, ordering: next, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      ).then(() => {}, (err: unknown) => log.error("personal_rankings upsert failed", { err: String(err) }));
    }
  }, []); // reads supabaseUser via ref; replaces state wholesale — no deps needed

  return { personalOrdering, setPersonalOrdering, savePersonalOrdering };
}
