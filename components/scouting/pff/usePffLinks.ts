"use client";
// Data + actions for Scouting → PFF Links: the PFF link of every prospect and
// charted game (migration 062), batch matching through /api/pff/match, the
// user's confirms and overrides (written straight to Supabase, under the
// owner-only RLS; "confirmed" / "none" are never overwritten by the matcher),
// and PFF's stats for the linked games (migration 063, /api/pff/import).
// Newly matched games are imported right after a match run, and a prospect is
// re-imported whenever one of his game links changes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logger } from "../../../lib/logger";
import { PFF_MATCH_BATCH, type PffCandidate, type PffGameOption, type PffMatchResponse } from "../../../lib/pff/api";
import { buildPffTotals, currentGameRow, type PffTotals } from "../../../lib/pff/totals";
import { fetchAllRows } from "../../../lib/scouting/fetchPlays";
import { supabase } from "../../../lib/supabaseclient";
import type { PffGameMatchStatus, PffPlayerMatchStatus } from "../../../lib/types";
import {
  fetchPffRows, isMissingPffTables, PFF_STATS_MIGRATION_HINT, pffAuthHeader, runPffImport,
  type PffImportProgress, type PffRows,
} from "./pffClient";

const log = logger("scouting/pff/usePffLinks");

export interface LinkProspect {
  id: string;
  name: string;
  position: string;
  school: string;
  draft_class_year: number;
  pff_player_id: number | null;
  pff_match_status: PffPlayerMatchStatus | null;
  pff_match_note: string | null;
}

export interface LinkGame {
  id: string;
  prospect_id: string;
  season_year: number;
  opponent: string;
  game_type: string;
  game_slot: number;
  pff_game_id: number | null;
  pff_match_status: PffGameMatchStatus | null;
  pff_match_note: string | null;
}

export interface MatchProgress {
  done: number;
  total: number;
  failed: number;
  note: string | null;
}

const PROSPECT_COLS = "id,name,position,school,draft_class_year,pff_player_id,pff_match_status,pff_match_note";
const GAME_COLS = "id,prospect_id,season_year,opponent,game_type,game_slot,pff_game_id,pff_match_status,pff_match_note";
const MIGRATION_HINT = "The PFF columns aren't in the database yet. Apply migration 062 (supabase/migrations/062_play_tags_and_pff_links.sql), then reload.";
const EMPTY_PFF: PffRows = { games: [], seasons: [] };

interface LinkRows { prospects: LinkProspect[]; games: LinkGame[] }

async function fetchRows(): Promise<LinkRows> {
  const [prospects, games] = await Promise.all([
    fetchAllRows<LinkProspect>((from, to) => supabase.from("prospects").select(PROSPECT_COLS).order("name").range(from, to)),
    fetchAllRows<LinkGame>((from, to) => supabase.from("scouting_games").select(GAME_COLS).order("id").range(from, to)),
  ]);
  return { prospects, games };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const playerLinked = (p: LinkProspect) =>
  p.pff_player_id != null && (p.pff_match_status === "auto" || p.pff_match_status === "confirmed");

/** A linked prospect whose linked games aren't all imported, or whose season aggregate is stale. */
export function needsImport(p: LinkProspect, t: PffTotals | undefined): boolean {
  return playerLinked(p) && t != null && (t.games < t.linked || t.seasonsCurrent < t.seasons);
}

/** `onStatsChanged`: the hub reloads its PFF columns after an import. */
/** `onImported`: the prospects an import just covered (the game context fills them next). */
export function usePffLinks(onStatsChanged?: () => void, onImported?: (ids: string[]) => void) {
  const [prospects, setProspects] = useState<LinkProspect[]>([]);
  const [games, setGames] = useState<LinkGame[]>([]);
  const [pffRows, setPffRows] = useState<PffRows>(EMPTY_PFF);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<MatchProgress | null>(null);
  const [importProgress, setImportProgress] = useState<PffImportProgress | null>(null);
  /** Why PFF had no stats for a game, from this session's imports. */
  const [missing, setMissing] = useState<Map<string, string>>(new Map());
  const cancelRef = useRef(false);

  const loadStats = useCallback(async (): Promise<PffRows> => {
    try {
      const rows = await fetchPffRows();
      setPffRows(rows);
      setStatsError(null);
      return rows;
    } catch (err) {
      if (isMissingPffTables(err)) setStatsError(PFF_STATS_MIGRATION_HINT);
      else { log.error("PFF stats load failed", { err: String(err) }); setStatsError(`Couldn't load PFF stats: ${String(err)}`); }
      return EMPTY_PFF;
    }
  }, []);

  /** Reloads links and stats; returns them (null on a failed link load). */
  const reload = useCallback(async (): Promise<(LinkRows & { pff: PffRows }) | null> => {
    try {
      const [rows, pff] = await Promise.all([fetchRows(), loadStats()]);
      setProspects(rows.prospects);
      setGames(rows.games);
      setError(null);
      return { ...rows, pff };
    } catch (err) {
      const msg = String(err);
      log.error("PFF links load failed", { err: msg });
      setError(/pff_|column/i.test(msg) ? MIGRATION_HINT : `Couldn't load: ${msg}`);
      return null;
    } finally {
      setLoading(false);
    }
  }, [loadStats]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchRows(), fetchPffRows().catch((err: unknown) => err)]).then(
      ([rows, pff]) => {
        if (cancelled) return;
        setProspects(rows.prospects);
        setGames(rows.games);
        if (pff instanceof Error || !(pff && typeof pff === "object" && "games" in pff)) {
          setStatsError(isMissingPffTables(pff) ? PFF_STATS_MIGRATION_HINT : `Couldn't load PFF stats: ${String(pff)}`);
        } else {
          setPffRows(pff as PffRows);
        }
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        const msg = String(err);
        log.error("PFF links load failed", { err: msg });
        setError(/pff_|column/i.test(msg) ? MIGRATION_HINT : `Couldn't load: ${msg}`);
        setLoading(false);
      },
    );
    return () => { cancelled = true; };
  }, []);

  const totals = useMemo(() => buildPffTotals(games, pffRows.games, pffRows.seasons), [games, pffRows]);
  /** Charted games with PFF stats for the PFF game they're linked to now. */
  const importedGameIds = useMemo(() => {
    const byGame = new Map(pffRows.games.map((r) => [r.game_id, r]));
    return new Set(games.filter((g) => currentGameRow(g, byGame.get(g.id))).map((g) => g.id));
  }, [games, pffRows]);

  /** Import PFF stats for these prospects in batches, then reload. Stops early on cancel. */
  const runImport = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    cancelRef.current = false;
    let failure: string | null = null;
    try {
      const out = await runPffImport(ids, { onProgress: setImportProgress, isCancelled: () => cancelRef.current });
      setMissing((prev) => new Map([...prev, ...out.missing]));
      const errors = [...out.errors.values()];
      if (errors.length) failure = `PFF import: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`;
    } catch (err) {
      log.error("PFF import run failed", { err: String(err) });
      failure = `Import stopped: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      setImportProgress(null);
    }
    await reload();
    // After the reload, which clears the error on success.
    if (failure) setError(failure);
    onStatsChanged?.();
    onImported?.(ids);
  }, [reload, onStatsChanged, onImported]);

  /** After links change: import whichever of these prospects now need it. */
  const importIfNeeded = useCallback(async (ids: string[], fresh: (LinkRows & { pff: PffRows }) | null) => {
    if (!fresh || cancelRef.current) return;
    const t = buildPffTotals(fresh.games, fresh.pff.games, fresh.pff.seasons);
    const byId = new Map(fresh.prospects.map((p) => [p.id, p]));
    const todo = ids.filter((id) => { const p = byId.get(id); return p != null && needsImport(p, t.get(id)); });
    if (todo.length) await runImport(todo);
  }, [runImport]);

  /** Match these prospects in batches, then import their newly matched games. Stops early on cancel. */
  const runMatch = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    cancelRef.current = false;
    let done = 0;
    let failed = 0;
    setProgress({ done, total: ids.length, failed, note: null });
    let failure: string | null = null;
    try {
      const queue = [...ids];
      while (queue.length > 0 && !cancelRef.current) {
        const batch = queue.splice(0, PFF_MATCH_BATCH);
        const res = await fetch("/api/pff/match", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await pffAuthHeader()) },
          body: JSON.stringify({ prospectIds: batch }),
        });
        const body = (await res.json().catch(() => null)) as (PffMatchResponse & { error?: string }) | null;
        if (!res.ok || !body) {
          if (res.status === 429) {
            queue.unshift(...batch);
            setProgress({ done, total: ids.length, failed, note: "Rate limited, waiting a minute…" });
            await sleep(60_000);
            continue;
          }
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        const unreached = body.results.filter((r) => r.error?.startsWith("Not reached")).map((r) => r.prospectId);
        failed += body.results.filter((r) => r.error && !r.error.startsWith("Not reached")).length;
        done += batch.length - unreached.length;
        queue.unshift(...unreached);
        const wait = body.retryAfterMs;
        setProgress({ done, total: ids.length, failed, note: wait ? "PFF read budget used up, waiting for it to reset…" : null });
        if (wait) await sleep(Math.min(wait, 65_000));
      }
    } catch (err) {
      log.error("PFF match run failed", { err: String(err) });
      failure = `Matching stopped: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      setProgress(null);
    }
    const fresh = await reload();
    // After the reload, which clears the error on success.
    if (failure) { setError(failure); return; }
    await importIfNeeded(ids, fresh);
  }, [reload, importIfNeeded]);

  const cancel = useCallback(() => { cancelRef.current = true; }, []);

  async function updateProspect(id: string, patch: Partial<LinkProspect>, rematch: boolean) {
    const { error: err } = await supabase.from("prospects").update(patch).eq("id", id);
    if (err) { log.error("prospect PFF link update failed", { err: err.message }); setError(`Couldn't save: ${err.message}`); return; }
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    if (rematch) await runMatch([id]);
  }

  async function updateGame(g: LinkGame, patch: Partial<LinkGame>) {
    const { error: err } = await supabase.from("scouting_games").update(patch).eq("id", g.id);
    if (err) { log.error("game PFF link update failed", { err: err.message }); setError(`Couldn't save: ${err.message}`); return; }
    setGames((prev) => prev.map((x) => (x.id === g.id ? { ...x, ...patch } : x)));
    // A new or removed link changes his numbers: re-import him if it's needed.
    cancelRef.current = false;
    await importIfNeeded([g.prospect_id], await reload());
  }

  /** Keep the matcher's pick as the user's call, then match his games. */
  const confirmPlayer = (p: LinkProspect) =>
    updateProspect(p.id, { pff_match_status: "confirmed", pff_match_note: `Confirmed by you. ${p.pff_match_note ?? ""}`.trim() }, true);

  const choosePlayer = (p: LinkProspect, c: PffCandidate) =>
    updateProspect(p.id, {
      pff_player_id: c.id, pff_match_status: "confirmed",
      pff_match_note: `Picked by you: ${c.name} · ${c.position}${c.team ? ` · ${c.team}` : ""} (PFF ${c.id})`,
    }, true);

  const markPlayerNone = (p: LinkProspect) =>
    updateProspect(p.id, { pff_player_id: null, pff_match_status: "none", pff_match_note: "Marked by you: not in PFF" }, true);

  /** Drop the user's call so the matcher decides again. */
  const resetPlayer = (p: LinkProspect) =>
    updateProspect(p.id, { pff_player_id: null, pff_match_status: null, pff_match_note: null }, true);

  const confirmGame = (g: LinkGame) =>
    updateGame(g, { pff_match_status: "confirmed", pff_match_note: `Confirmed by you. ${g.pff_match_note ?? ""}`.trim() });

  const chooseGame = (g: LinkGame, o: PffGameOption) =>
    updateGame(g, { pff_game_id: o.pffGameId, pff_match_status: "confirmed", pff_match_note: `Picked by you: week ${o.week} vs ${o.opponent}` });

  const markGameNone = (g: LinkGame) =>
    updateGame(g, { pff_game_id: null, pff_match_status: "none", pff_match_note: "Marked by you: no PFF game" });

  const resetGame = (g: LinkGame) =>
    updateGame(g, { pff_game_id: null, pff_match_status: null, pff_match_note: null });

  return {
    prospects, games, loading, error, progress,
    totals, importedGameIds, statsError, importProgress, missing,
    runMatch, runImport, cancel, reload,
    confirmPlayer, choosePlayer, markPlayerNone, resetPlayer,
    confirmGame, chooseGame, markGameNone, resetGame,
  };
}

export async function searchPffPlayers(name: string): Promise<PffCandidate[]> {
  const res = await fetch(`/api/pff/players?name=${encodeURIComponent(name)}`, { headers: await pffAuthHeader() });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body.players as PffCandidate[];
}

export async function fetchPffGames(playerId: number, season: number): Promise<PffGameOption[]> {
  const res = await fetch(`/api/pff/games?playerId=${playerId}&season=${season}`, { headers: await pffAuthHeader() });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body.games as PffGameOption[];
}
