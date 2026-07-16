"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { logger } from "../lib/logger";

const log = logger("hooks/useCalcValues");

export function useCalcValues() {
  const [calcFcValues, setCalcFcValues] = useState<Record<string, number>>({});
  const [calcValuesNumQbs, setCalcValuesNumQbs] = useState<number | null>(null);
  const [loadingCalcValues, setLoadingCalcValues] = useState(false);
  const [calcValuesError, setCalcValuesError] = useState<string | null>(null);
  const [redraftValues, setRedraftValues] = useState<Record<string, number>>({});
  const [loadingRedraft, setLoadingRedraft] = useState(false);
  const [redraftLoaded, setRedraftLoaded] = useState(false);
  const [redraftError, setRedraftError] = useState<string | null>(null);

  // Refs so useCallback can read current values without stale closures
  const calcValuesNumQbsRef = useRef(calcValuesNumQbs);
  const redraftLoadedRef = useRef(redraftLoaded);
  useEffect(() => { calcValuesNumQbsRef.current = calcValuesNumQbs; }, [calcValuesNumQbs]);
  useEffect(() => { redraftLoadedRef.current = redraftLoaded; }, [redraftLoaded]);
  // Monotonic guard so a slow fetch for one format can't overwrite a newer one.
  const calcSeq = useRef(0);
  // Track which num_qbs format the redraft values were loaded for, so a league
  // switch between superflex (2) and single-QB (1) refetches instead of serving
  // the wrong-format values. Superflex stays at 2 (unchanged behaviour).
  const redraftNumQbsRef = useRef<number>(2);

  // Both loadCalcValues and loadRedraftValues go through the shared /api/fc-values
  // proxy (24h Supabase cache) instead of hitting FantasyCalc directly — see
  // Phase A stage A3 (S3 fetch consolidation).
  const loadCalcValues = useCallback(async (numQbs: number) => {
    if (calcValuesNumQbsRef.current === numQbs) return;
    const seq = ++calcSeq.current;
    setLoadingCalcValues(true);
    setCalcValuesError(null);
    try {
      const res = await fetch(`/api/fc-values?numQbs=${numQbs}`);
      if (!res.ok) throw new Error(`fc-values ${res.status}`);
      const data = await res.json();
      const vals: Record<string, number> = {};
      (data as { player?: { sleeperId?: string }; value: number }[]).forEach((entry) => {
        const sleeperId = entry.player?.sleeperId;
        if (sleeperId) vals[String(sleeperId)] = entry.value;
      });
      if (seq !== calcSeq.current) return; // a newer load started — discard
      setCalcFcValues(vals);
      setCalcValuesNumQbs(numQbs);
    } catch (err) {
      log.error("loadCalcValues failed", { err: String(err) });
      if (seq === calcSeq.current) setCalcValuesError("Couldn't load player values from FantasyCalc.");
    } finally {
      if (seq === calcSeq.current) setLoadingCalcValues(false);
    }
  }, []);

  const loadRedraftValues = useCallback(async (numQbs: number = redraftNumQbsRef.current) => {
    // Already loaded for this format → nothing to do (no-arg refresh callers reuse
    // the last-loaded format, so they don't thrash).
    if (redraftLoadedRef.current && redraftNumQbsRef.current === numQbs) return;
    setLoadingRedraft(true);
    setRedraftError(null);
    try {
      const res = await fetch(`/api/fc-values?numQbs=${numQbs}&isDynasty=false`);
      if (!res.ok) throw new Error(`fc-values ${res.status}`);
      const data = await res.json();
      const vals: Record<string, number> = {};
      (data as { player?: { sleeperId?: string }; value: number }[]).forEach((entry) => {
        const sleeperId = entry.player?.sleeperId;
        if (sleeperId) vals[String(sleeperId)] = entry.value;
      });
      setRedraftValues(vals);
      setRedraftLoaded(true);
      redraftNumQbsRef.current = numQbs;
    } catch (err) {
      log.error("loadRedraftValues failed", { err: String(err) });
      setRedraftError("Couldn't load redraft values from FantasyCalc.");
    } finally {
      setLoadingRedraft(false);
    }
  }, []);

  return {
    calcFcValues,
    loadingCalcValues,
    calcValuesError,
    redraftValues,
    loadingRedraft,
    redraftError,
    loadCalcValues,
    loadRedraftValues,
  };
}
