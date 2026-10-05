"use client";
// Data + actions for Scouting → PFF Links: the PFF link of every prospect and
// charted game (migration 062), batch matching through /api/pff/match, and
// the user's confirms and overrides (written straight to Supabase, under the
// owner-only RLS; "confirmed" / "none" are never overwritten by the matcher).
// Loads its own rows: nothing else in the hub reads the PFF columns yet.

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../../lib/logger";
import { PFF_MATCH_BATCH, type PffCandidate, type PffGameOption, type PffMatchResponse } from "../../../lib/pff/api";
import { fetchAllRows } from "../../../lib/scouting/fetchPlays";
import { supabase } from "../../../lib/supabaseclient";
import type { PffGameMatchStatus, PffPlayerMatchStatus } from "../../../lib/types";

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

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${session.access_token}` };
}

async function fetchRows(): Promise<{ prospects: LinkProspect[]; games: LinkGame[] }> {
  const [prospects, games] = await Promise.all([
    fetchAllRows<LinkProspect>((from, to) => supabase.from("prospects").select(PROSPECT_COLS).order("name").range(from, to)),
    fetchAllRows<LinkGame>((from, to) => supabase.from("scouting_games").select(GAME_COLS).order("id").range(from, to)),
  ]);
  return { prospects, games };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function usePffLinks() {
  const [prospects, setProspects] = useState<LinkProspect[]>([]);
  const [games, setGames] = useState<LinkGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<MatchProgress | null>(null);
  const cancelRef = useRef(false);

  const reload = useCallback(async () => {
    try {
      const rows = await fetchRows();
      setProspects(rows.prospects);
      setGames(rows.games);
      setError(null);
    } catch (err) {
      const msg = String(err);
      log.error("PFF links load failed", { err: msg });
      setError(/pff_|column/i.test(msg) ? MIGRATION_HINT : `Couldn't load: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchRows().then(
      (rows) => { if (!cancelled) { setProspects(rows.prospects); setGames(rows.games); setLoading(false); } },
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

  /** Match these prospects in batches, then reload. Stops early on cancel. */
  const runMatch = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    cancelRef.current = false;
    let done = 0;
    let failed = 0;
    setProgress({ done, total: ids.length, failed, note: null });
    try {
      const queue = [...ids];
      while (queue.length > 0 && !cancelRef.current) {
        const batch = queue.splice(0, PFF_MATCH_BATCH);
        const res = await fetch("/api/pff/match", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
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
      setError(`Matching stopped: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProgress(null);
      await reload();
    }
  }, [reload]);

  const cancel = useCallback(() => { cancelRef.current = true; }, []);

  async function updateProspect(id: string, patch: Partial<LinkProspect>, rematch: boolean) {
    const { error: err } = await supabase.from("prospects").update(patch).eq("id", id);
    if (err) { log.error("prospect PFF link update failed", { err: err.message }); setError(`Couldn't save: ${err.message}`); return; }
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    if (rematch) await runMatch([id]);
  }

  async function updateGame(id: string, patch: Partial<LinkGame>) {
    const { error: err } = await supabase.from("scouting_games").update(patch).eq("id", id);
    if (err) { log.error("game PFF link update failed", { err: err.message }); setError(`Couldn't save: ${err.message}`); return; }
    setGames((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
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
    updateGame(g.id, { pff_match_status: "confirmed", pff_match_note: `Confirmed by you. ${g.pff_match_note ?? ""}`.trim() });

  const chooseGame = (g: LinkGame, o: PffGameOption) =>
    updateGame(g.id, { pff_game_id: o.pffGameId, pff_match_status: "confirmed", pff_match_note: `Picked by you: week ${o.week} vs ${o.opponent}` });

  const markGameNone = (g: LinkGame) =>
    updateGame(g.id, { pff_game_id: null, pff_match_status: "none", pff_match_note: "Marked by you: no PFF game" });

  const resetGame = (g: LinkGame) =>
    updateGame(g.id, { pff_game_id: null, pff_match_status: null, pff_match_note: null });

  return {
    prospects, games, loading, error, progress,
    runMatch, cancel, reload,
    confirmPlayer, choosePlayer, markPlayerNone, resetPlayer,
    confirmGame, chooseGame, markGameNone, resetGame,
  };
}

export async function searchPffPlayers(name: string): Promise<PffCandidate[]> {
  const res = await fetch(`/api/pff/players?name=${encodeURIComponent(name)}`, { headers: await authHeader() });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body.players as PffCandidate[];
}

export async function fetchPffGames(playerId: number, season: number): Promise<PffGameOption[]> {
  const res = await fetch(`/api/pff/games?playerId=${playerId}&season=${season}`, { headers: await authHeader() });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body.games as PffGameOption[];
}
