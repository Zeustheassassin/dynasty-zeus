"use client";
// Prospect Data sheet → Fill 40s: for each class shown, POST
// /api/scouting/forty-times reads the combine's official 40s (once that
// combine is out) and NFL Draft Buzz's projections at the sheet's position;
// lib/scouting/fortyFill.ts matches them to the prospects and lists what would
// change. Nothing is saved until the user applies the ticked changes, written
// straight to Supabase under their own RLS.

import { useCallback, useEffect, useRef, useState } from "react";
import { withConcurrency } from "../../../lib/concurrency";
import { logger } from "../../../lib/logger";
import {
  fortyChanges, fortyPatches, matchFortyRows, type FortyChange, type FortyFillProspect, type FortyPos, type FortyTimesResponse,
} from "../../../lib/scouting/fortyFill";
import { supabase } from "../../../lib/supabaseclient";
import { pffAuthHeader } from "../pff/pffClient";

const log = logger("scouting/forty/useFortyFill");

export type FortyFillPhase = "idle" | "reading" | "review" | "saving" | "done";

export interface FortyFillYear {
  year: number;
  /** Combine 40s found for this class at the position; null when its combine isn't out (or failed). */
  combine: number | null;
  combineError?: string;
  projected: number;
  projectedError?: string;
}

export interface FortyFillSummary {
  years: FortyFillYear[];
  /** Prospects neither source had (not ranked by WalterFootball, didn't run at the combine, or a name spelled differently). */
  notFound: { id: string; name: string; year: number }[];
  /** Changes Apply saved. */
  saved: number;
}

export interface UseFortyFillReturn {
  phase: FortyFillPhase;
  /** "2027 (1 of 2)" while reading. */
  progress: string | null;
  changes: FortyChange[];
  selected: ReadonlySet<string>;
  summary: FortyFillSummary | null;
  error: string | null;
  start: (prospects: readonly FortyFillProspect[], position: FortyPos) => Promise<void>;
  toggle: (key: string) => void;
  setAll: (on: boolean) => void;
  apply: () => Promise<void>;
  cancel: () => void;
  close: () => void;
}

/** At most this many classes per run (the sheet's All filter shows every class). */
export const FORTY_FILL_MAX_YEARS = 5;

async function readYear(year: number, position: FortyPos): Promise<FortyTimesResponse> {
  const res = await fetch("/api/scouting/forty-times", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await pffAuthHeader()) },
    body: JSON.stringify({ year, position }),
  });
  const body = (await res.json().catch(() => null)) as (FortyTimesResponse & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

/** `onDataChanged`: the hub reloads its prospects after saving. */
export function useFortyFill(onDataChanged?: () => void): UseFortyFillReturn {
  const [phase, setPhase] = useState<FortyFillPhase>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [changes, setChanges] = useState<FortyChange[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [summary, setSummary] = useState<FortyFillSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // Leaving the sheet stops a run before its next class.
  useEffect(() => () => { cancelRef.current = true; }, []);

  const start = useCallback(async (prospects: readonly FortyFillProspect[], position: FortyPos) => {
    cancelRef.current = false;
    setError(null);
    setSummary(null);
    setChanges([]);
    setSelected(new Set());
    const pool = prospects.filter((p) => p.position === position && p.draft_class_year != null);
    const years = [...new Set(pool.map((p) => p.draft_class_year!))].sort((a, b) => a - b).slice(-FORTY_FILL_MAX_YEARS);
    setPhase("reading");
    try {
      const all: FortyChange[] = [];
      const perYear: FortyFillYear[] = [];
      const notFound: FortyFillSummary["notFound"] = [];
      for (const [i, year] of years.entries()) {
        if (cancelRef.current) { setPhase("idle"); return; }
        setProgress(`${year}${years.length > 1 ? ` (${i + 1} of ${years.length})` : ""}`);
        const r = await readYear(year, position);
        const cls = pool.filter((p) => p.draft_class_year === year);
        const combine = matchFortyRows(cls, r.combine ?? [], year);
        const projected = matchFortyRows(cls, r.projected, year);
        all.push(...fortyChanges(cls, combine, projected));
        perYear.push({
          year, combine: r.combine ? combine.size : null, projected: projected.size,
          ...(r.combineError ? { combineError: r.combineError } : {}),
          ...(r.projectedError ? { projectedError: r.projectedError } : {}),
        });
        for (const p of cls) if (!combine.has(p.id) && !projected.has(p.id)) notFound.push({ id: p.id, name: p.name, year });
      }
      if (cancelRef.current) { setPhase("idle"); return; }
      setChanges(all);
      setSelected(new Set(all.filter((c) => c.on).map((c) => c.key)));
      setSummary({ years: perYear, notFound, saved: 0 });
      setPhase("review");
    } catch (err) {
      log.error("Fill 40s failed", { err: String(err) });
      setError(`Fill 40s stopped: ${err instanceof Error ? err.message : String(err)}`);
      setPhase("idle");
    } finally {
      setProgress(null);
    }
  }, []);

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
    const countBy = new Map<string, number>();
    for (const c of chosen) countBy.set(c.prospectId, (countBy.get(c.prospectId) ?? 0) + 1);
    try {
      await withConcurrency([...fortyPatches(chosen)], async ([id, patch]) => {
        const { error: err } = await supabase.from("prospects")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (err) failures.push(err.message);
        else saved += countBy.get(id) ?? 0;
      }, 6);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
    if (failures.length > 0) {
      log.error("Fill 40s save failed", { failed: failures.length, first: failures[0] });
      const hint = /forty_projected/.test(failures[0]) ? " (is migration 100 applied?)" : "";
      setError(`Couldn't save ${failures.length} prospect(s): ${failures[0]}${hint}`);
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
