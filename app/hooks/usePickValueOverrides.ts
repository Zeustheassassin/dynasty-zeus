"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { User as SupabaseUser } from "@supabase/auth-js";
import { supabase } from "../../lib/supabaseclient";
import { logger } from "../../lib/logger";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import { cleanPickValueOverrides } from "../../lib/helpers/picks";

const log = logger("app/hooks/usePickValueOverrides");

export const PICK_VALUE_OVERRIDES_KEY = "pickValueOverrides_v1";

/**
 * The user's own rookie pick values (Draft Hub → Pick Values), keyed like the pick value map
 * ("2027-1.01", "2028-1"). FantasyCalc fills every key not set here; the merge itself is the
 * pure applyPickValueOverrides in lib/helpers/picks.ts, applied in useAppState.
 *
 * Persistence only, mirroring usePersonalRankings: localStorage is written synchronously for
 * instant reload; the Supabase `pick_value_overrides` table (one jsonb row per user, migration
 * 083) is the cross-device source of truth, hydrated by useAppState on login via
 * setPickValueOverrides.
 */
export function usePickValueOverrides(supabaseUser: SupabaseUser | null) {
  const [pickValueOverrides, setPickValueOverrides] = useState<Record<string, number>>(() =>
    cleanPickValueOverrides(getLocalStorageItem<unknown>(PICK_VALUE_OVERRIDES_KEY, {}))
  );

  // Ref so the save closure always reads the latest supabaseUser without a stale capture.
  const supabaseUserRef = useRef<SupabaseUser | null>(null);
  useEffect(() => { supabaseUserRef.current = supabaseUser; }, [supabaseUser]);

  const savePickValueOverrides = useCallback((next: Record<string, number>) => {
    const cleaned = cleanPickValueOverrides(next);
    setPickValueOverrides(cleaned);
    setLocalStorageItem(PICK_VALUE_OVERRIDES_KEY, cleaned);
    const sbUser = supabaseUserRef.current;
    if (!sbUser) return;
    supabase.from("pick_value_overrides").upsert(
      { user_id: sbUser.id, overrides: cleaned, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    ).then(
      ({ error }) => { if (error) log.error("pick_value_overrides upsert failed", { err: error.message }); },
      (err: unknown) => log.error("pick_value_overrides upsert failed", { err: String(err) }),
    );
  }, []); // reads supabaseUser via ref; replaces state wholesale — no deps needed

  return { pickValueOverrides, setPickValueOverrides, savePickValueOverrides };
}
