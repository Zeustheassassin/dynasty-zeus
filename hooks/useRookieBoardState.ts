"use client";
import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { supabase } from "../lib/supabaseclient";
import { CURRENT_YEAR, normalizeRookieName } from "../lib/helpers";
import { logger } from "../lib/logger";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import type { RookieBoardPlayer } from "../lib/types";

const log = logger("hooks/useRookieBoardState");

// ── Constants (exported so page.tsx logout handler can clear the right keys) ──
export const ROOKIE_YEAR = CURRENT_YEAR;
export const ROOKIE_BOARD_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
export const ROOKIE_BOARD_VERSION = `${ROOKIE_YEAR}_sf_v5`;
export const ROOKIE_BOARD_RESET_KEY = `rookieBoardReset_${ROOKIE_BOARD_VERSION}`;

// Built-in name corrections for upstream sheet typos. Applied as a fallback when the user
// hasn't set their own override for that name. User overrides (in rookie_board_overrides
// table) take precedence over this list.
const ROOKIE_NAME_CORRECTIONS: Record<string, string> = {
  "max kalre": "Max Klare",
};

const ROOKIE_OVERRIDES_LS_KEY = `rookieBoardOverrides_${ROOKIE_BOARD_VERSION}`;

export interface RookieAddition {
  name: string;
  position: string;
}

export interface UserRookieOverrides {
  added: RookieAddition[];
  nameEdits: Record<string, string>; // normalized old name → corrected name
}

const EMPTY_OVERRIDES: UserRookieOverrides = { added: [], nameEdits: {} };
const ROOKIE_BOARD_ADP_URL =
  `https://api.sleeper.app/projections/nfl/${ROOKIE_YEAR}?season_type=regular` +
  `&position=QB&position=RB&position=WR&position=TE&order_by=adp_dynasty_2qb`;

export interface UseRookieBoardStateReturn {
  rookies: RookieBoardPlayer[];
  setRookies: Dispatch<SetStateAction<RookieBoardPlayer[]>>;
  fcNameValues: Record<string, number>;
  handleRankChange: (currentIndex: number, newRank: string) => void;
  addRookie: (name: string, position: string) => void;
  editRookieName: (originalName: string, newName: string) => void;
  removeAddedRookie: (name: string) => void;
  clearNameEdit: (originalName: string) => void;
  rookieOverrides: UserRookieOverrides;
}

export function useRookieBoardState(supabaseUser: { id: string } | null): UseRookieBoardStateReturn {
  const [rookies, setRookies] = useState<RookieBoardPlayer[]>([]);
  const [fcNameValues, setFcNameValues] = useState<Record<string, number>>({});
  const [rookieOverrides, setRookieOverrides] = useState<UserRookieOverrides>(() =>
    getLocalStorageItem<UserRookieOverrides>(ROOKIE_OVERRIDES_LS_KEY, EMPTY_OVERRIDES)
  );

  // Stable ref so the save-effect can read the current user without declaring
  // supabaseUser as a dependency (which would overwrite Supabase data on login).
  const supabaseUserRef = useRef<{ id: string } | null>(null);
  useEffect(() => { supabaseUserRef.current = supabaseUser; }, [supabaseUser]);

  // Load user overrides (additions + name edits) from Supabase on login.
  useEffect(() => {
    if (!supabaseUser?.id) return;
    supabase
      .from("rookie_board_overrides")
      .select("added,name_edits")
      .eq("user_id", supabaseUser.id)
      .eq("year", ROOKIE_BOARD_VERSION)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) { log.error("rookie_board_overrides load failed", { err: error.message }); return; }
        if (!data) return;
        const next: UserRookieOverrides = {
          added: Array.isArray(data.added) ? (data.added as RookieAddition[]) : [],
          nameEdits: (data.name_edits && typeof data.name_edits === "object")
            ? (data.name_edits as Record<string, string>) : {},
        };
        setRookieOverrides(next);
        setLocalStorageItem(ROOKIE_OVERRIDES_LS_KEY, next);
      });
  }, [supabaseUser?.id]);

  // Persist override changes to localStorage + Supabase.
  const saveOverrides = (next: UserRookieOverrides) => {
    setRookieOverrides(next);
    setLocalStorageItem(ROOKIE_OVERRIDES_LS_KEY, next);
    const user = supabaseUserRef.current;
    if (user) {
      supabase.from("rookie_board_overrides").upsert(
        {
          user_id: user.id,
          year: ROOKIE_BOARD_VERSION,
          added: next.added,
          name_edits: next.nameEdits,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,year" }
      ).then(({ error }) => {
        if (error) log.error("rookie_board_overrides save failed", { err: error.message });
      });
    }
  };

  const addRookie = (name: string, position: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const norm = normalizeRookieName(trimmed);
    if (rookieOverrides.added.some((a) => normalizeRookieName(a.name) === norm)) return;
    saveOverrides({ ...rookieOverrides, added: [...rookieOverrides.added, { name: trimmed, position }] });
  };

  const editRookieName = (originalName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const normOld = normalizeRookieName(originalName);
    if (normalizeRookieName(trimmed) === normOld) return; // no-op
    saveOverrides({ ...rookieOverrides, nameEdits: { ...rookieOverrides.nameEdits, [normOld]: trimmed } });
  };

  const removeAddedRookie = (name: string) => {
    const norm = normalizeRookieName(name);
    saveOverrides({ ...rookieOverrides, added: rookieOverrides.added.filter((a) => normalizeRookieName(a.name) !== norm) });
  };

  const clearNameEdit = (originalName: string) => {
    const norm = normalizeRookieName(originalName);
    if (!(norm in rookieOverrides.nameEdits)) return;
    const next = { ...rookieOverrides.nameEdits };
    delete next[norm];
    saveOverrides({ ...rookieOverrides, nameEdits: next });
  };

  /** Moves a rookie to a new rank position by dragging or typing. */
  const handleRankChange = (currentIndex: number, newRank: string) => {
    const rank = parseInt(newRank, 10);
    if (!rank || rank < 1 || rank > rookies.length) return;
    const updated: RookieBoardPlayer[] = [...rookies];
    const [moved] = updated.splice(currentIndex, 1);
    updated.splice(rank - 1, 0, moved);
    setRookies(updated);
  };

  // Save to localStorage + Supabase whenever the board changes.
  // Uses ref for supabaseUser to avoid triggering on login.
  useEffect(() => {
    if (rookies.length > 0) {
      setLocalStorageItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, rookies);
      const user = supabaseUserRef.current;
      if (user) {
        const orderedNames = rookies.map((r) => r.name);
        supabase.from("rookie_board").upsert(
          { user_id: user.id, year: ROOKIE_BOARD_VERSION, players: orderedNames, updated_at: new Date().toISOString() },
          { onConflict: "user_id,year" }
        ).then(({ error }: { error: { message: string; code?: string } | null }) => {
          if (error) log.error("rookie_board save failed", { err: error.message, code: error.code });
        });
      }
    }
  }, [rookies]); // intentionally omits supabaseUser — use ref to avoid overwriting Supabase on login

  // Load the rookie board.
  // Runs on mount AND whenever supabaseUser.id changes (login / logout).
  // Priority: Supabase (if logged in) > localStorage > FC default.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const loadRookieBoard = async () => {
      // 1. Fetch sheet, Sleeper ADP (for metadata), and FC Superflex (2QB) raw data in parallel
      const [sheetText, adpResponse, fcRaw] = await Promise.all([
        fetch('/api/rookie-board-sheet', { signal }).then((res) => res.text()),
        fetch(ROOKIE_BOARD_ADP_URL, { signal }).then((res) => res.json()).catch(() => []),
        fetch(`https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1`, { signal })
          .then((res) => res.json()).catch(() => []),
      ]);

      // Build name → FC value map and sleeperId → FC value map
      const fcByName = new Map<string, number>();
      const fcBySleeperId = new Map<string, number>();

      if (Array.isArray(fcRaw)) {
        fcRaw.forEach((entry: { player?: { position?: string; name?: string; firstName?: string; lastName?: string; sleeperId?: string | number }; value?: number }) => {
          if (entry.player?.position === "PICK") return;
          const fullName = entry.player?.name || `${entry.player?.firstName || ""} ${entry.player?.lastName || ""}`.trim();
          if (fullName && typeof entry.value === "number") {
            fcByName.set(normalizeRookieName(fullName), entry.value);
          }
          const sid = entry.player?.sleeperId;
          if (sid && typeof entry.value === "number") {
            fcBySleeperId.set(String(sid), entry.value);
          }
        });
        setFcNameValues(Object.fromEntries(fcByName));
      }

      const sheetPlayers = sheetText
        .split("\n")
        .slice(1)
        .map((row) => {
          const cols = row.split(",");
          const rawName = cols[0]?.replace(/"/g, "").trim() ?? "";
          const norm = normalizeRookieName(rawName);
          // User edit takes precedence over the built-in correction list.
          const corrected = rookieOverrides.nameEdits[norm] ?? ROOKIE_NAME_CORRECTIONS[norm];
          return {
            name: corrected ?? rawName,
            position: cols[1]?.replace(/"/g, "").trim(),
          };
        })
        .filter((player) => player.name && player.name !== "Player Invalid");

      // Append user-added rookies that aren't already in the upstream sheet.
      const sheetNameSet = new Set(sheetPlayers.map((p) => normalizeRookieName(p.name)));
      for (const added of rookieOverrides.added) {
        if (!sheetNameSet.has(normalizeRookieName(added.name))) {
          sheetPlayers.push({ name: added.name, position: added.position });
        }
      }

      interface SleeperAdpEntry {
        player_id?: string | number;
        player?: { first_name?: string; last_name?: string; position?: string; team?: string };
        stats?: { adp_dynasty_2qb?: number };
      }
      interface AdpPlayerInfo {
        player_id: string;
        name: string;
        position: string;
        team: string;
        adp: number;
      }
      // Sleeper ADP only used for player_id, position, team metadata — NOT for sort order
      const adpByName = new Map<string, AdpPlayerInfo>();
      adpResponse
        .filter((entry: SleeperAdpEntry) =>
          entry?.player &&
          entry?.stats &&
          entry.player.first_name !== "Player" &&
          ROOKIE_BOARD_POSITIONS.has(entry.player.position ?? "") &&
          typeof entry.stats.adp_dynasty_2qb === "number"
        )
        .forEach((entry: SleeperAdpEntry) => {
          if (!entry.player || !entry.stats) return;
          const playerName = `${entry.player.first_name ?? ""} ${entry.player.last_name ?? ""}`.trim();
          const normalizedName = normalizeRookieName(playerName);
          if (!normalizedName || adpByName.has(normalizedName)) return;
          adpByName.set(normalizedName, {
            player_id: String(entry.player_id),
            name: playerName,
            position: entry.player.position ?? "",
            team: entry.player.team ?? "",
            adp: entry.stats.adp_dynasty_2qb ?? 0,
          });
        });

      const canonicalBoard = sheetPlayers
        .map((player) => {
          const norm = normalizeRookieName(player.name);
          const adpPlayer = adpByName.get(norm);
          return {
            player_id: adpPlayer?.player_id || null,
            name: adpPlayer?.name || player.name,
            position: adpPlayer?.position || player.position,
            team: adpPlayer?.team || "",
            adp: typeof adpPlayer?.adp === "number" ? adpPlayer.adp : Number.MAX_SAFE_INTEGER,
            // Match FC value: name first, then Sleeper ID fallback
            fcValue: fcByName.get(norm)
              ?? fcByName.get(normalizeRookieName(adpPlayer?.name || ""))
              ?? (adpPlayer?.player_id ? (fcBySleeperId.get(adpPlayer.player_id) ?? 0) : 0),
          };
        })
        // Sort by FantasyCalc Superflex dynasty value (descending). Falls back to Sleeper ADP then name.
        .sort((a, b) => {
          if (b.fcValue !== a.fcValue) return b.fcValue - a.fcValue;
          if (a.adp !== b.adp) return a.adp - b.adp;
          return a.name.localeCompare(b.name);
        });

      // 2. Try Supabase for saved order (if logged in) — isolated try/catch so a network
      //    error here doesn't abort the whole function and leave rookies state stale.
      const currentUser = supabaseUserRef.current;
      if (currentUser) {
        try {
          const { data, error } = await supabase
            .from("rookie_board")
            .select("players")
            .eq("user_id", currentUser.id)
            .eq("year", ROOKIE_BOARD_VERSION)
            .single();
          if (!error && data?.players && Array.isArray(data.players) && data.players.length > 0) {
            const orderMap = new Map<string, number>(
              (data.players as string[]).map((name, i) => [normalizeRookieName(name), i])
            );
            const ordered = [...canonicalBoard].sort((a, b) => {
              const ia = orderMap.get(normalizeRookieName(a.name)) ?? 9999;
              const ib = orderMap.get(normalizeRookieName(b.name)) ?? 9999;
              if (ia !== ib) return ia - ib;
              if (b.fcValue !== a.fcValue) return b.fcValue - a.fcValue;
              return a.adp - b.adp;
            });
            setLocalStorageItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, ordered);
            setRookies(ordered);
            return;
          }
        } catch {
          // Supabase unreachable — fall through to localStorage / FC default
        }
      }

      // 3. Fall back to localStorage order
      const saved = getLocalStorageItem<RookieBoardPlayer[] | null>(`rookieBoard_${ROOKIE_BOARD_VERSION}`, null);
      const hasReset = getLocalStorageItem<boolean>(ROOKIE_BOARD_RESET_KEY, false);

      if (!hasReset || !saved) {
        setRookies(canonicalBoard);
        setLocalStorageItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, canonicalBoard);
        setLocalStorageItem(ROOKIE_BOARD_RESET_KEY, true);
        return;
      }

      const savedNames: string[] = saved.map((p: RookieBoardPlayer | string) =>
        typeof p === "string" ? p : p.name
      );
      const canonicalNames = new Set(canonicalBoard.map((p) => normalizeRookieName(p.name)));
      const validSaved = savedNames.filter((n) => canonicalNames.has(normalizeRookieName(n)));
      const orderMap = new Map(validSaved.map((name, i) => [normalizeRookieName(name), i]));
      const merged = [...canonicalBoard].sort((a, b) => {
        const ia = orderMap.get(normalizeRookieName(a.name)) ?? 9999;
        const ib = orderMap.get(normalizeRookieName(b.name)) ?? 9999;
        if (ia !== ib) return ia - ib;
        // New players not in saved order: sort by FC value then ADP
        if (b.fcValue !== a.fcValue) return b.fcValue - a.fcValue;
        return a.adp - b.adp;
      });

      setLocalStorageItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, merged);
      setRookies(merged);
    };

    loadRookieBoard().catch(() => {});
    return () => { controller.abort(); };
  }, [supabaseUser?.id, rookieOverrides]);

  return {
    rookies,
    setRookies,
    fcNameValues,
    handleRankChange,
    addRookie,
    editRookieName,
    removeAddedRookie,
    clearNameEdit,
    rookieOverrides,
  };
}
