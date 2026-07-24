"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { User as SupabaseUser } from "@supabase/auth-js";
import { supabase } from "../../lib/supabaseclient";
import { logger } from "../../lib/logger";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import type { AssetDisposition, LeagueAssetDispositions } from "@/lib/types";

const log = logger("app/hooks/usePlayerAnnotations");

export function usePlayerAnnotations(supabaseUser: SupabaseUser | null) {
  const [leagueNotes, setLeagueNotes] = useState<Record<string, string>>(
    () => getLocalStorageItem<Record<string, string> | null>("leagueNotes", null) ?? {}
  );
  const [playerProfileId, setPlayerProfileId] = useState<string | null>(null);
  const [playerNotes, setPlayerNotes] = useState<Record<string, string>>(() =>
    getLocalStorageItem<Record<string, string>>("playerNotes_v1", {})
  );
  const [leaguePlayerTags, setLeaguePlayerTags] = useState<LeagueAssetDispositions>(() =>
    getLocalStorageItem<LeagueAssetDispositions>("leaguePlayerTags_v1", {})
  );
  const [ignoredOwnerIds, setIgnoredOwnerIds] = useState<string[]>(() =>
    getLocalStorageItem<string[]>("ignoredOwnerIds", [])
  );

  // Ref so useCallback closures always read the latest supabaseUser without stale captures
  const supabaseUserRef = useRef<SupabaseUser | null>(null);
  useEffect(() => { supabaseUserRef.current = supabaseUser; }, [supabaseUser]);

  const toggleIgnoredOwner = useCallback((ownerId: string) => {
    setIgnoredOwnerIds(prev => {
      const next = prev.includes(ownerId) ? prev.filter(id => id !== ownerId) : [...prev, ownerId];
      setLocalStorageItem("ignoredOwnerIds", next);
      return next;
    });
  }, []);

  const saveLeagueNote = useCallback(async (leagueId: string, text: string) => {
    setLeagueNotes(prev => {
      const updated = { ...prev, [leagueId]: text };
      setLocalStorageItem("leagueNotes", updated);
      return updated;
    });
    const sbUser = supabaseUserRef.current;
    if (sbUser) {
      try {
        await supabase.from("league_notes").upsert(
          { user_id: sbUser.id, league_id: leagueId, content: text, updated_at: new Date().toISOString() },
          { onConflict: "user_id,league_id" }
        );
      } catch (err: unknown) {
        log.error("league_notes upsert failed", { err: String(err) });
      }
    }
  }, []);

  const savePlayerNote = useCallback(async (playerId: string, note: string) => {
    setPlayerNotes((prev) => {
      const updated = { ...prev, [playerId]: note };
      setLocalStorageItem("playerNotes_v1", updated);
      return updated;
    });
    const sbUser = supabaseUserRef.current;
    if (sbUser) {
      supabase.from("player_notes").upsert(
        { user_id: sbUser.id, player_id: playerId, note, updated_at: new Date().toISOString() },
        { onConflict: "user_id,player_id" }
      ).then(() => {}, (err: unknown) => log.error("player_notes upsert failed", { err: String(err) }));
    }
  }, []); // reads supabaseUser via ref; uses functional setState — no deps needed

  // Sets (or clears, when disposition is null) a per-league disposition for a player_id
  // or pick key (finderPickKey format). Clicking the already-active option in a picker
  // clears it back to Neutral — callers pass null in that case rather than relying on
  // any cycling behavior.
  const handleSetAssetDisposition = useCallback((
    leagueId: string,
    assetId: string,
    disposition: AssetDisposition | null
  ) => {
    const sbUser = supabaseUserRef.current;
    setLeaguePlayerTags((prev) => {
      const leagueTags = prev[leagueId] ?? {};
      const updatedLeague = { ...leagueTags };
      if (disposition === null) delete updatedLeague[assetId];
      else updatedLeague[assetId] = disposition;
      const updated = { ...prev, [leagueId]: updatedLeague };
      setLocalStorageItem("leaguePlayerTags_v1", updated);
      if (sbUser) {
        if (disposition === null) {
          supabase.from("league_player_tags").delete()
            .eq("user_id", sbUser.id).eq("league_id", leagueId).eq("player_id", assetId)
            .then(() => {}, (err: unknown) => log.error("league_player_tags delete failed", { err: String(err) }));
        } else {
          supabase.from("league_player_tags")
            .upsert({ user_id: sbUser.id, league_id: leagueId, player_id: assetId, tag: disposition },
                    { onConflict: "user_id,league_id,player_id" })
            .then(() => {}, (err: unknown) => log.error("league_player_tags upsert failed", { err: String(err) }));
        }
      }
      return updated;
    });
  }, []);

  return {
    leagueNotes,
    setLeagueNotes,
    playerProfileId,
    setPlayerProfileId,
    playerNotes,
    setPlayerNotes,
    leaguePlayerTags,
    setLeaguePlayerTags,
    ignoredOwnerIds,
    toggleIgnoredOwner,
    saveLeagueNote,
    savePlayerNote,
    handleSetAssetDisposition,
  };
}
