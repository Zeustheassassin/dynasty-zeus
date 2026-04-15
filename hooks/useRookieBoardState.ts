"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseclient";
import { CURRENT_YEAR, normalizeRookieName } from "../lib/helpers";
import type { RookieBoardPlayer } from "../lib/types";

// ── Constants (exported so page.tsx logout handler can clear the right keys) ──
export const ROOKIE_YEAR = CURRENT_YEAR;
export const ROOKIE_BOARD_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
export const ROOKIE_BOARD_VERSION = `${ROOKIE_YEAR}_sf_v5`;
export const ROOKIE_BOARD_RESET_KEY = `rookieBoardReset_${ROOKIE_BOARD_VERSION}`;
const ROOKIE_BOARD_ADP_URL =
  `https://api.sleeper.app/projections/nfl/${ROOKIE_YEAR}?season_type=regular` +
  `&position=QB&position=RB&position=WR&position=TE&order_by=adp_dynasty_2qb`;

export function useRookieBoardState(supabaseUser: { id: string } | null) {
  const [rookies, setRookies] = useState<RookieBoardPlayer[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [rookieSearch, setRookieSearch] = useState("");
  const [tempRanks, setTempRanks] = useState<{ [key: number]: string }>({});
  const [fcNameValues, setFcNameValues] = useState<Record<string, number>>({});

  // Stable ref so the save-effect can read the current user without declaring
  // supabaseUser as a dependency (which would overwrite Supabase data on login).
  const supabaseUserRef = useRef<{ id: string } | null>(null);
  useEffect(() => { supabaseUserRef.current = supabaseUser; }, [supabaseUser]);

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
      localStorage.setItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, JSON.stringify(rookies));
      const user = supabaseUserRef.current;
      if (user) {
        const orderedNames = rookies.map((r) => r.name);
        supabase.from("rookie_board").upsert(
          { user_id: user.id, year: ROOKIE_BOARD_VERSION, players: orderedNames, updated_at: new Date().toISOString() },
          { onConflict: "user_id,year" }
        ).then(({ error }: { error: { message: string; code?: string } | null }) => {
          if (error) console.error("rookie_board save failed:", error.message, error.code);
        });
      }
    }
  }, [rookies]); // intentionally omits supabaseUser — use ref to avoid overwriting Supabase on login

  // Load the rookie board.
  // Runs on mount AND whenever supabaseUser.id changes (login / logout).
  // Priority: Supabase (if logged in) > localStorage > FC default.
  useEffect(() => {
    const loadRookieBoard = async () => {
      // 1. Fetch sheet, Sleeper ADP (for metadata), and FC Superflex (2QB) raw data in parallel
      const [sheetText, adpResponse, fcRaw] = await Promise.all([
        fetch('/api/rookie-board-sheet').then((res) => res.text()),
        fetch(ROOKIE_BOARD_ADP_URL).then((res) => res.json()).catch(() => []),
        fetch(`https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1`)
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
          return {
            name: cols[0]?.replace(/"/g, "").trim(),
            position: cols[1]?.replace(/"/g, "").trim(),
          };
        })
        .filter((player) => player.name && player.name !== "Player Invalid");

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
      if (supabaseUser) {
        try {
          const { data, error } = await supabase
            .from("rookie_board")
            .select("players")
            .eq("user_id", supabaseUser.id)
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
            localStorage.setItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, JSON.stringify(ordered));
            setRookies(ordered);
            return;
          }
        } catch {
          // Supabase unreachable — fall through to localStorage / FC default
        }
      }

      // 3. Fall back to localStorage order
      const saved = localStorage.getItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`);
      const hasReset = localStorage.getItem(ROOKIE_BOARD_RESET_KEY) === "true";

      if (!hasReset || !saved) {
        setRookies(canonicalBoard);
        localStorage.setItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, JSON.stringify(canonicalBoard));
        localStorage.setItem(ROOKIE_BOARD_RESET_KEY, "true");
        return;
      }

      const savedNames: string[] = JSON.parse(saved).map((p: string | { name: string }) =>
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

      localStorage.setItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, JSON.stringify(merged));
      setRookies(merged);
    };

    loadRookieBoard().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseUser?.id]); // intentional: use ID not object — prevents re-runs when auth refreshes recreate the user object

  return {
    rookies,
    setRookies,
    dragIndex,
    setDragIndex,
    rookieSearch,
    setRookieSearch,
    tempRanks,
    setTempRanks,
    fcNameValues,
    handleRankChange,
  };
}
