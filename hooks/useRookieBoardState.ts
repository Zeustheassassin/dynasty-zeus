"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseclient";
import { BASE_YEAR, normalizeRookieName } from "../lib/helpers";
import { getFcValuesRaw } from "../lib/fcValuesStore";
import { logger } from "../lib/logger";
import { sleeperApi } from "../lib/sleeperApi";
import type { RookieBoardPlayer } from "../lib/types";

const log = logger("hooks/useRookieBoardState");

// The market pool behind the live draft: the upstream sheet, Sleeper ADP and
// FantasyCalc, in the order the user last dragged it into, else FantasyCalc's.
// Read-only since draft board sync Stage 3 (2026-10-09): the Draft Hub's Rookie
// Big Board lists the user's Scouting prospects in the Big Board's OVR order
// instead (components/draftHub/RookieBigBoard.tsx), so nothing here is dragged,
// added or renamed any more. Orders and overrides saved before then still
// apply. Stage 4 splits the live draft between that board and this pool.

// ── Constants (exported so the logout handler can clear the old local keys) ──
// The rookie-draft class year tracks the CALENDAR (the upcoming/active draft
// class, which rolls Jan 1) — NOT the NFL season year (which holds in Jan/Feb).
export const ROOKIE_YEAR = String(BASE_YEAR);
export const ROOKIE_BOARD_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
export const ROOKIE_BOARD_VERSION = `${ROOKIE_YEAR}_sf_v5`;
export const ROOKIE_BOARD_RESET_KEY = `rookieBoardReset_${ROOKIE_BOARD_VERSION}`;

// Built-in name corrections for upstream sheet typos. Applied as a fallback when the user
// has no override for that name. User overrides (in the rookie_board_overrides
// table) take precedence over this list.
const ROOKIE_NAME_CORRECTIONS: Record<string, string> = {
  "max kalre": "Max Klare",
};

interface RookieAddition {
  name: string;
  position: string;
}

interface UserRookieOverrides {
  added: RookieAddition[];
  nameEdits: Record<string, string>; // normalized old name → corrected name
}

const EMPTY_OVERRIDES: UserRookieOverrides = { added: [], nameEdits: {} };

interface AdpPlayerInfo {
  player_id: string;
  name: string;
  position: string;
  team: string;
  adp: number;
}

// The order the user last saved (rookie_board, signed in), or none: then
// FantasyCalc's.
type OrderSource =
  | { kind: "saved"; names: string[] }
  | { kind: "none" };

// Everything fetched over the network: the sheet, Sleeper ADP, FantasyCalc
// and the saved order.
interface RawBoardData {
  sheetPlayers: { name: string; position: string }[]; // raw sheet names, corrections NOT yet applied
  adpByName: Map<string, AdpPlayerInfo>;
  fcByName: Map<string, number>;
  fcBySleeperId: Map<string, number>;
  orderSource: OrderSource;
}

function buildBoard(raw: RawBoardData, overrides: UserRookieOverrides): RookieBoardPlayer[] {
  const { sheetPlayers, adpByName, fcByName, fcBySleeperId, orderSource } = raw;

  const correctedSheet = sheetPlayers.map((player) => {
    const norm = normalizeRookieName(player.name);
    // User edit takes precedence over the built-in correction list.
    const corrected = overrides.nameEdits[norm] ?? ROOKIE_NAME_CORRECTIONS[norm];
    return { name: corrected ?? player.name, position: player.position };
  });

  // Append user-added rookies that aren't already in the upstream sheet.
  const sheetNameSet = new Set(correctedSheet.map((p) => normalizeRookieName(p.name)));
  for (const added of overrides.added) {
    if (!sheetNameSet.has(normalizeRookieName(added.name))) {
      correctedSheet.push({ name: added.name, position: added.position });
    }
  }

  const canonicalBoard = correctedSheet
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

  if (orderSource.kind === "none") return canonicalBoard;

  const orderMap = new Map(orderSource.names.map((name, i) => [normalizeRookieName(name), i]));
  return [...canonicalBoard].sort((a, b) => {
    const ia = orderMap.get(normalizeRookieName(a.name)) ?? 9999;
    const ib = orderMap.get(normalizeRookieName(b.name)) ?? 9999;
    if (ia !== ib) return ia - ib;
    // New players not in saved order: sort by FC value then ADP
    if (b.fcValue !== a.fcValue) return b.fcValue - a.fcValue;
    return a.adp - b.adp;
  });
}

interface SleeperAdpEntry {
  player_id?: string | number;
  player?: { first_name?: string; last_name?: string; position?: string; team?: string };
  stats?: { adp_dynasty_2qb?: number };
}

export interface UseRookieBoardStateReturn {
  /** The market pool, in the saved order (else FantasyCalc's). */
  rookies: RookieBoardPlayer[];
}

export function useRookieBoardState(supabaseUser: { id: string } | null): UseRookieBoardStateReturn {
  const [rookies, setRookies] = useState<RookieBoardPlayer[]>([]);
  const userId = supabaseUser?.id ?? null;

  // Fetch the sheet, Sleeper ADP, FantasyCalc values and, signed in, the saved
  // order and overrides. Runs on mount and on login / logout.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    const load = async () => {
      // 1. Sheet, Sleeper ADP (for metadata) and FC Superflex (2QB) raw data in parallel
      const [sheetText, adpResponse, fcRaw] = await Promise.all([
        fetch('/api/rookie-board-sheet', { signal }).then((res) => res.text()),
        sleeperApi.getRookieBoardADP(ROOKIE_YEAR).catch(() => []),
        getFcValuesRaw(2, true).catch(() => []),
      ]);
      if (cancelled) return;

      // Name → FC value and sleeperId → FC value
      const fcByName = new Map<string, number>();
      const fcBySleeperId = new Map<string, number>();
      if (Array.isArray(fcRaw)) {
        (fcRaw as { player?: { position?: string; name?: string; firstName?: string; lastName?: string; sleeperId?: string | number }; value?: number }[]).forEach((entry) => {
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
      }

      // Raw sheet names — corrections are applied later by buildBoard, not here.
      const sheetPlayers = sheetText
        .split("\n")
        .slice(1)
        .map((row) => {
          const cols = row.split(",");
          return {
            name: cols[0]?.replace(/"/g, "").trim() ?? "",
            position: cols[1]?.replace(/"/g, "").trim(),
          };
        })
        .filter((player) => player.name && player.name !== "Player Invalid");

      // Sleeper ADP only used for player_id, position, team metadata — NOT for sort order
      const adpByName = new Map<string, AdpPlayerInfo>();
      (adpResponse as unknown as SleeperAdpEntry[])
        .filter((entry) =>
          entry?.player &&
          entry?.stats &&
          entry.player.first_name !== "Player" &&
          ROOKIE_BOARD_POSITIONS.has(entry.player.position ?? "") &&
          typeof entry.stats.adp_dynasty_2qb === "number"
        )
        .forEach((entry) => {
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

      // 2. Signed in: the saved order and overrides. A failed read falls back
      //    to FantasyCalc's order and no overrides.
      let orderSource: OrderSource = { kind: "none" };
      let overrides: UserRookieOverrides = EMPTY_OVERRIDES;
      if (userId) {
        const [order, saved] = await Promise.all([
          supabase
            .from("rookie_board")
            .select("players")
            .eq("user_id", userId)
            .eq("year", ROOKIE_BOARD_VERSION)
            .maybeSingle(),
          supabase
            .from("rookie_board_overrides")
            .select("added,name_edits")
            .eq("user_id", userId)
            .eq("year", ROOKIE_BOARD_VERSION)
            .maybeSingle(),
        ]);
        if (order.error) {
          log.warn("rookie_board load failed", { err: order.error.message });
        } else if (Array.isArray(order.data?.players) && order.data.players.length > 0) {
          orderSource = { kind: "saved", names: order.data.players as string[] };
        }
        if (saved.error) {
          log.warn("rookie_board_overrides load failed", { err: saved.error.message });
        } else if (saved.data) {
          overrides = {
            added: Array.isArray(saved.data.added) ? (saved.data.added as RookieAddition[]) : [],
            nameEdits: (saved.data.name_edits && typeof saved.data.name_edits === "object")
              ? (saved.data.name_edits as Record<string, string>) : {},
          };
        }
      }

      if (cancelled) return;
      setRookies(buildBoard({ sheetPlayers, adpByName, fcByName, fcBySleeperId, orderSource }, overrides));
    };

    load().catch((e: unknown) => {
      if (!cancelled) log.warn("rookie pool load failed", { err: String(e) });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [userId]);

  return { rookies };
}
