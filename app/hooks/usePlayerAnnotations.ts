"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { User as SupabaseUser } from "@supabase/auth-js";
import { supabase } from "../../lib/supabaseclient";
import { logger } from "../../lib/logger";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";

const log = logger("app/hooks/usePlayerAnnotations");

export function usePlayerAnnotations(supabaseUser: SupabaseUser | null) {
  const [leagueNotes, setLeagueNotes] = useState<Record<string, string>>({});
  const [playerProfileId, setPlayerProfileId] = useState<string | null>(null);
  const [playerNotes, setPlayerNotes] = useState<Record<string, string>>(() =>
    getLocalStorageItem<Record<string, string>>("playerNotes_v1", {})
  );
  const [playerDispositions, setPlayerDispositions] = useState<Record<string, { sell: string; buy: string }>>(() =>
    getLocalStorageItem<Record<string, { sell: string; buy: string }>>("playerDispositions_v1", {})
  );
  const [leaguePlayerTags, setLeaguePlayerTags] = useState<Record<string, Record<string, "CORE" | "WANT_TO_TRADE">>>(() =>
    getLocalStorageItem<Record<string, Record<string, "CORE" | "WANT_TO_TRADE">>>("leaguePlayerTags_v1", {})
  );
  const [ignoredOwnerIds, setIgnoredOwnerIds] = useState<string[]>(() =>
    getLocalStorageItem<string[]>("ignoredOwnerIds", [])
  );

  // Ref so useCallback closures always read the latest supabaseUser without stale captures
  const supabaseUserRef = useRef<SupabaseUser | null>(null);
  useEffect(() => { supabaseUserRef.current = supabaseUser; }, [supabaseUser]);

  // Load league notes from localStorage on mount; Supabase overrides on login (via setLeagueNotes)
  useEffect(() => {
    const saved = getLocalStorageItem<Record<string, string> | null>("leagueNotes", null);
    if (saved) setLeagueNotes(saved);
  }, []);

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

  const savePlayerDisposition = useCallback(async (playerId: string, sell: string, buy: string) => {
    setPlayerDispositions((prev) => {
      const updated = { ...prev, [playerId]: { sell, buy } };
      setLocalStorageItem("playerDispositions_v1", updated);
      return updated;
    });
    const sbUser = supabaseUserRef.current;
    if (sbUser) {
      supabase.from("player_dispositions").upsert(
        { user_id: sbUser.id, player_id: playerId, sell, buy, updated_at: new Date().toISOString() },
        { onConflict: "user_id,player_id" }
      ).then(() => {}, (err: unknown) => log.error("player_dispositions upsert failed", { err: String(err) }));
    }
  }, []); // reads supabaseUser via ref; uses functional setState — no deps needed

  // Toggle a per-league player tag. Cycling: untagged → CORE → WANT_TO_TRADE → untagged.
  // Passing a specific tag forces that tag (or removes it if already set).
  const handleToggleLeaguePlayerTag = useCallback((
    leagueId: string,
    playerId: string,
    forceTag?: "CORE" | "WANT_TO_TRADE"
  ) => {
    const sbUser = supabaseUserRef.current;
    setLeaguePlayerTags((prev) => {
      const leagueTags = prev[leagueId] ?? {};
      const current = leagueTags[playerId];
      let next: "CORE" | "WANT_TO_TRADE" | undefined;
      if (forceTag !== undefined) {
        next = current === forceTag ? undefined : forceTag;
      } else {
        next = current === undefined ? "CORE" : current === "CORE" ? "WANT_TO_TRADE" : undefined;
      }
      const updatedLeague = { ...leagueTags };
      if (next === undefined) delete updatedLeague[playerId];
      else updatedLeague[playerId] = next;
      const updated = { ...prev, [leagueId]: updatedLeague };
      setLocalStorageItem("leaguePlayerTags_v1", updated);
      if (sbUser) {
        if (next === undefined) {
          supabase.from("league_player_tags").delete()
            .eq("user_id", sbUser.id).eq("league_id", leagueId).eq("player_id", playerId)
            .then(() => {}, (err: unknown) => log.error("league_player_tags delete failed", { err: String(err) }));
        } else {
          supabase.from("league_player_tags")
            .upsert({ user_id: sbUser.id, league_id: leagueId, player_id: playerId, tag: next },
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
    playerDispositions,
    setPlayerDispositions,
    leaguePlayerTags,
    setLeaguePlayerTags,
    ignoredOwnerIds,
    toggleIgnoredOwner,
    saveLeagueNote,
    savePlayerNote,
    savePlayerDisposition,
    handleToggleLeaguePlayerTag,
  };
}
