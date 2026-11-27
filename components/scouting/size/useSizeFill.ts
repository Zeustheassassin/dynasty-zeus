"use client";
// Prospect Data sheet → Measured sizes (migration 108, stage 5 of the
// 2026-11-26 scouting plan): the combine's heights and weights from nflverse
// (POST /api/scouting/combine-sizes, one request per class shown), or a pasted
// list with its source and day. lib/scouting/measuredSize.ts matches them to
// every QB / RB / WR / TE in the classes shown and lists what would change.
// Nothing is saved until the user applies the ticked changes, written
// straight to Supabase under their own RLS.

import { useCallback, useEffect, useRef, useState } from "react";
import { withConcurrency } from "../../../lib/concurrency";
import { logger } from "../../../lib/logger";
import {
  matchCombineSizes, matchPastedList, sizeChanges,
  type CombineSizesResponse, type PastedList, type SizeChange, type SizeKept, type SizeMatch, type SizeProspect,
} from "../../../lib/scouting/measuredSize";
import { supabase } from "../../../lib/supabaseclient";
import type { SizeSource } from "../../../lib/types";
import { pffAuthHeader } from "../pff/pffClient";

const log = logger("scouting/size/useSizeFill");

export type SizeFillPhase = "idle" | "choose" | "reading" | "review" | "saving" | "done";

export interface SizeFillSummary {
  how: "combine" | "paste";
  /** The combine: each class read, with how many it matched (null = that combine isn't out yet). */
  years?: { year: number; matched: number | null }[];
  /** The combine: prospects in a class it has that it didn't list (not invited, or spelled differently). */
  notFound?: { id: string; name: string; position: string; year: number }[];
  /** A pasted list: what was read, and what didn't land on anyone. */
  pasted?: Omit<PastedList, "matches"> & { source: SizeSource; measuredOn: string };
  /** Matched, but an outranking measurement is on file. */
  kept: SizeKept[];
  /** Matched with the same numbers and source already on file. */
  unchanged: number;
  /** Changes Apply saved. */
  saved: number;
}

export interface UseSizeFillReturn {
  phase: SizeFillPhase;
  /** "2027 (1 of 2)" while reading the combine. */
  progress: string | null;
  changes: SizeChange[];
  selected: ReadonlySet<string>;
  summary: SizeFillSummary | null;
  error: string | null;
  /** Show the two ways in. */
  open: () => void;
  readCombine: (pool: readonly SizeProspect[]) => Promise<void>;
  readPaste: (pool: readonly SizeProspect[], text: string, source: SizeSource, measuredOn: string) => void;
  toggle: (key: string) => void;
  setAll: (on: boolean) => void;
  apply: () => Promise<void>;
  cancel: () => void;
  close: () => void;
}

/** At most this many classes per combine read (the sheet's All filter shows every class). */
export const SIZE_FILL_MAX_YEARS = 5;

async function readYear(year: number): Promise<CombineSizesResponse> {
  const res = await fetch("/api/scouting/combine-sizes", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await pffAuthHeader()) },
    body: JSON.stringify({ year }),
  });
  const body = (await res.json().catch(() => null)) as (CombineSizesResponse & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

/** The columns 108 adds; a save naming one of them before 108 is applied. */
const NEEDS_108 = /size_source|size_measured_on|listed_height|listed_weight/;

/** `onDataChanged`: the hub reloads its prospects after saving. */
export function useSizeFill(onDataChanged?: () => void): UseSizeFillReturn {
  const [phase, setPhase] = useState<SizeFillPhase>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [changes, setChanges] = useState<SizeChange[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [summary, setSummary] = useState<SizeFillSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // Leaving the sheet stops a run before its next class.
  useEffect(() => () => { cancelRef.current = true; }, []);

  const toReview = useCallback((
    pool: readonly SizeProspect[], matches: ReadonlyMap<string, SizeMatch>, rest: Omit<SizeFillSummary, "kept" | "unchanged" | "saved">,
  ) => {
    const { changes: list, kept } = sizeChanges(pool, matches);
    setChanges(list);
    setSelected(new Set(list.filter((c) => c.on).map((c) => c.key)));
    setSummary({ ...rest, kept, unchanged: matches.size - list.length - kept.length, saved: 0 });
    setPhase("review");
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setSummary(null);
    setChanges([]);
    setSelected(new Set());
  }, []);

  const open = useCallback(() => { reset(); setPhase("choose"); }, [reset]);

  const readCombine = useCallback(async (pool: readonly SizeProspect[]) => {
    cancelRef.current = false;
    reset();
    const years = [...new Set(pool.flatMap((p) => (p.draft_class_year != null ? [p.draft_class_year] : [])))]
      .sort((a, b) => a - b).slice(-SIZE_FILL_MAX_YEARS);
    setPhase("reading");
    try {
      const matches = new Map<string, SizeMatch>();
      const perYear: NonNullable<SizeFillSummary["years"]> = [];
      const notFound: NonNullable<SizeFillSummary["notFound"]> = [];
      for (const [i, year] of years.entries()) {
        if (cancelRef.current) { setPhase("choose"); return; }
        setProgress(`${year}${years.length > 1 ? ` (${i + 1} of ${years.length})` : ""}`);
        const r = await readYear(year);
        const cls = pool.filter((p) => p.draft_class_year === year);
        const found = matchCombineSizes(cls, r.rows ?? [], year);
        for (const [id, m] of found) matches.set(id, m);
        perYear.push({ year, matched: r.rows ? found.size : null });
        if (r.rows) for (const p of cls) if (!found.has(p.id)) notFound.push({ id: p.id, name: p.name, position: p.position, year });
      }
      if (cancelRef.current) { setPhase("choose"); return; }
      toReview(pool, matches, { how: "combine", years: perYear, notFound });
    } catch (err) {
      log.error("combine sizes failed", { err: String(err) });
      setError(`Reading the combine stopped: ${err instanceof Error ? err.message : String(err)}`);
      setPhase("choose");
    } finally {
      setProgress(null);
    }
  }, [reset, toReview]);

  const readPaste = useCallback((pool: readonly SizeProspect[], text: string, source: SizeSource, measuredOn: string) => {
    reset();
    const { matches, ...rest } = matchPastedList(text, pool, source, measuredOn);
    toReview(pool, matches, { how: "paste", pasted: { ...rest, source, measuredOn } });
  }, [reset, toReview]);

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
      await withConcurrency(chosen, async (c) => {
        const { error: err } = await supabase.from("prospects")
          .update({ ...c.patch, updated_at: new Date().toISOString() })
          .eq("id", c.prospectId);
        if (err) failures.push(err.message);
        else saved++;
      }, 6);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
    if (failures.length > 0) {
      log.error("measured sizes save failed", { failed: failures.length, first: failures[0] });
      const hint = NEEDS_108.test(failures[0]) ? " (is migration 108 applied?)" : "";
      setError(`Couldn't save ${failures.length} prospect(s): ${failures[0]}${hint}`);
    }
    setSummary((s) => (s ? { ...s, saved } : s));
    setPhase("done");
    if (saved > 0) onDataChanged?.();
  }, [changes, selected, onDataChanged]);

  const cancel = useCallback(() => { cancelRef.current = true; }, []);

  const close = useCallback(() => {
    setPhase("idle");
    reset();
  }, [reset]);

  return { phase, progress, changes, selected, summary, error, open, readCombine, readPaste, toggle, setAll, apply, cancel, close };
}
