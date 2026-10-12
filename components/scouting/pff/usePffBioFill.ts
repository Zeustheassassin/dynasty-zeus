"use client";
// Roster sheet → Fill from PFF: height, weight and birthday from PFF for the
// prospects on screen. Prospects never matched are linked first (the PFF
// Links matcher, which links only sure matches; their newly matched games'
// stats are imported right after, as a PFF Links match run does). Then
// /api/pff/bio reads PFF's numbers and lib/scouting/pffBio.ts lists what
// would change. Nothing is saved until the user applies the ticked changes,
// written straight to Supabase under their own RLS.

import { useCallback, useEffect, useRef, useState } from "react";
import { withConcurrency } from "../../../lib/concurrency";
import { logger } from "../../../lib/logger";
import { bioChanges, bioPatches, type BioChange, type BioRow } from "../../../lib/scouting/pffBio";
import { supabase } from "../../../lib/supabaseclient";
import type { PffPlayerMatchStatus } from "../../../lib/types";
import { runPffBio, runPffImport, runPffMatch, type PffBatchProgress } from "./pffClient";

const log = logger("scouting/pff/usePffBioFill");

export type BioFillPhase = "idle" | "linking" | "importing" | "reading" | "review" | "saving" | "done";

export interface BioFillProspect {
  id: string;
  name: string;
  pff_match_status?: PffPlayerMatchStatus | null;
}

export interface BioFillSummary {
  /** Prospects the matcher linked this run. */
  linked: number;
  /** Prospects PFF was read for. */
  read: number;
  /** Prospects PFF wasn't read for, and why. */
  skipped: { id: string; name: string; why: string }[];
  /** No birthday on file and none in PFF: for the user to fill by hand. */
  noBirthday: { id: string; name: string }[];
  /** Fields Apply saved. */
  saved: number;
}

export interface UsePffBioFillReturn {
  phase: BioFillPhase;
  progress: PffBatchProgress | null;
  changes: BioChange[];
  selected: ReadonlySet<string>;
  summary: BioFillSummary | null;
  error: string | null;
  start: (prospects: readonly BioFillProspect[]) => Promise<void>;
  toggle: (key: string) => void;
  setAll: (on: boolean) => void;
  apply: () => Promise<void>;
  cancel: () => void;
  close: () => void;
}

const LINKED = new Set(["auto", "confirmed"]);

/** `onDataChanged`: the hub reloads its prospects (after new links, and after saving). */
export function usePffBioFill(onDataChanged?: () => void): UsePffBioFillReturn {
  const [phase, setPhase] = useState<BioFillPhase>("idle");
  const [progress, setProgress] = useState<PffBatchProgress | null>(null);
  const [changes, setChanges] = useState<BioChange[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [summary, setSummary] = useState<BioFillSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // Leaving the sheet stops a run at its next batch.
  useEffect(() => () => { cancelRef.current = true; }, []);

  const start = useCallback(async (prospects: readonly BioFillProspect[]) => {
    cancelRef.current = false;
    setError(null);
    setSummary(null);
    setChanges([]);
    setSelected(new Set());
    const opts = { onProgress: setProgress, isCancelled: () => cancelRef.current };
    let linked = 0;
    try {
      const notRun = prospects.filter((p) => p.pff_match_status == null).map((p) => p.id);
      if (notRun.length > 0) {
        setPhase("linking");
        const m = await runPffMatch(notRun, opts);
        const nowLinked = [...m.results.values()].filter((r) => LINKED.has(r.playerStatus ?? ""));
        linked = nowLinked.length;
        const withGames = nowLinked
          .filter((r) => (r.games?.auto ?? 0) + (r.games?.confirmed ?? 0) > 0)
          .map((r) => r.prospectId);
        if (withGames.length > 0 && !cancelRef.current) {
          setPhase("importing");
          // Failures are logged per prospect; PFF Links lists what's left to import.
          await runPffImport(withGames, opts);
        }
        // The hub's rows carry the new links, so the next run doesn't match them again.
        if (m.results.size > 0) onDataChanged?.();
      }
      if (cancelRef.current) { setPhase("idle"); return; }

      setPhase("reading");
      const bio = await runPffBio(prospects.map((p) => p.id), opts);
      if (bio.cancelled) { setPhase("idle"); return; }
      // Batches come back in database order; keep the sheet's.
      const order = new Map(prospects.map((p, i) => [p.id, i]));
      const results = [...bio.results].sort((a, b) => (order.get(a.prospectId) ?? 0) - (order.get(b.prospectId) ?? 0));
      const read: BioRow[] = results.flatMap((r) =>
        r.pff ? [{ prospectId: r.prospectId, name: r.name, current: r.current, pff: r.pff }] : []);
      const list = bioChanges(read);
      setChanges(list);
      setSelected(new Set(list.filter((c) => c.on).map((c) => c.key)));
      setSummary({
        linked,
        read: read.length,
        skipped: results.filter((r) => !r.pff).map((r) => ({ id: r.prospectId, name: r.name, why: r.error ?? r.note ?? "Not read" })),
        noBirthday: results.filter((r) => r.current.birthday == null && !r.pff?.dob).map((r) => ({ id: r.prospectId, name: r.name })),
        saved: 0,
      });
      setPhase("review");
    } catch (err) {
      log.error("Fill from PFF failed", { err: String(err) });
      setError(`Fill from PFF stopped: ${err instanceof Error ? err.message : String(err)}`);
      setPhase("idle");
    } finally {
      setProgress(null);
    }
  }, [onDataChanged]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const setAll = useCallback((on: boolean) => {
    setSelected(on ? new Set(changes.map((c) => c.key)) : new Set());
  }, [changes]);

  const apply = useCallback(async () => {
    const chosen = changes.filter((c) => selected.has(c.key));
    if (chosen.length === 0) return;
    setPhase("saving");
    setError(null);
    const failures: string[] = [];
    let saved = 0;
    try {
      await withConcurrency([...bioPatches(chosen)], async ([id, patch]) => {
        const { error: err } = await supabase.from("prospects")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (err) failures.push(err.message);
        else saved += Object.keys(patch).length;
      }, 6);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
    if (failures.length > 0) {
      log.error("Fill from PFF save failed", { failed: failures.length, first: failures[0] });
      setError(`Couldn't save ${failures.length} prospect(s): ${failures[0]}`);
    }
    setSummary((s) => (s ? { ...s, saved } : s));
    setPhase("done");
    onDataChanged?.();
  }, [changes, selected, onDataChanged]);

  const cancel = useCallback(() => { cancelRef.current = true; }, []);

  const close = useCallback(() => {
    setPhase("idle");
    setChanges([]);
    setSelected(new Set());
    setSummary(null);
    setError(null);
  }, []);

  return { phase, progress, changes, selected, summary, error, start, toggle, setAll, apply, cancel, close };
}
