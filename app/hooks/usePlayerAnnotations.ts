"use client";
import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import type { User as SupabaseUser } from "@supabase/auth-js";
import { supabase } from "../../lib/supabaseclient";
import { logger } from "../../lib/logger";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import { addDays, TRADE_DISCARD_DAYS } from "@/lib/helpers/dispositions";
import type { AssetDisposition, LeagueAssetDispositions, LeagueExpiringBlocks } from "@/lib/types";

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
  // Time-boxed Trade Finder suppressions (finder_temp_blocks table, kind-discriminated).
  // See LeagueExpiringBlocks in lib/types.ts: leagueId -> block key -> ISO expires_at.
  const [noInterestPlayers, setNoInterestPlayers] = useState<LeagueExpiringBlocks>(() =>
    getLocalStorageItem<LeagueExpiringBlocks>("noInterestPlayers_v1", {})
  );
  const [discardedTrades, setDiscardedTrades] = useState<LeagueExpiringBlocks>(() =>
    getLocalStorageItem<LeagueExpiringBlocks>("discardedFinderTrades_v1", {})
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

  // Shared write path for both finder_temp_blocks kinds: updates the given local-state
  // map (+ its localStorage mirror) and fires the matching Supabase upsert/delete.
  // expiresAt === null clears the block entirely.
  const setFinderTempBlock = useCallback((
    kind: "PLAYER_NO_INTEREST" | "TRADE_DISCARD",
    storageKey: string,
    setMap: Dispatch<SetStateAction<LeagueExpiringBlocks>>,
    leagueId: string,
    blockKey: string,
    expiresAt: string | null,
  ) => {
    const sbUser = supabaseUserRef.current;
    setMap((prev) => {
      const leagueMap = prev[leagueId] ?? {};
      const updatedLeague = { ...leagueMap };
      if (expiresAt === null) delete updatedLeague[blockKey];
      else updatedLeague[blockKey] = expiresAt;
      const updated = { ...prev, [leagueId]: updatedLeague };
      setLocalStorageItem(storageKey, updated);
      if (sbUser) {
        if (expiresAt === null) {
          supabase.from("finder_temp_blocks").delete()
            .eq("user_id", sbUser.id).eq("league_id", leagueId).eq("kind", kind).eq("block_key", blockKey)
            .then(() => {}, (err: unknown) => log.error("finder_temp_blocks delete failed", { err: String(err) }));
        } else {
          supabase.from("finder_temp_blocks")
            .upsert({ user_id: sbUser.id, league_id: leagueId, kind, block_key: blockKey, expires_at: expiresAt },
                    { onConflict: "user_id,league_id,kind,block_key" })
            .then(() => {}, (err: unknown) => log.error("finder_temp_blocks upsert failed", { err: String(err) }));
        }
      }
      return updated;
    });
  }, []);

  // Marks (or clears, when days is null) an opposing player as personally uninteresting —
  // independent of the opponent's own SELL_NO/SELL_OK willingness tag. Not roster-scoped:
  // the block follows the player_id even if he later changes teams.
  const setNoInterest = useCallback((leagueId: string, playerId: string, days: number | null) => {
    setFinderTempBlock(
      "PLAYER_NO_INTEREST", "noInterestPlayers_v1", setNoInterestPlayers,
      leagueId, playerId, days === null ? null : addDays(days),
    );
  }, [setFinderTempBlock]);

  // Dismisses one specific Finder-suggested trade (exact give/receive/opponent
  // combination, keyed by its fingerprint) for a fixed window — not user-configurable.
  const discardFinderTrade = useCallback((leagueId: string, fingerprint: string) => {
    setFinderTempBlock(
      "TRADE_DISCARD", "discardedFinderTrades_v1", setDiscardedTrades,
      leagueId, fingerprint, addDays(TRADE_DISCARD_DAYS),
    );
  }, [setFinderTempBlock]);

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
    noInterestPlayers,
    setNoInterestPlayers,
    setNoInterest,
    discardedTrades,
    setDiscardedTrades,
    discardFinderTrade,
    saveLeagueNote,
    savePlayerNote,
    handleSetAssetDisposition,
  };
}
