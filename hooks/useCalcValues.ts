"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { logger } from "../lib/logger";

const log = logger("hooks/useCalcValues");

export function useCalcValues() {
  const [calcFcValues, setCalcFcValues] = useState<Record<string, number>>({});
  const [calcValuesLeagueId, setCalcValuesLeagueId] = useState<string | null>(null);
  const [loadingCalcValues, setLoadingCalcValues] = useState(false);
  const [calcValuesError, setCalcValuesError] = useState<string | null>(null);
  const [redraftValues, setRedraftValues] = useState<Record<string, number>>({});
  const [loadingRedraft, setLoadingRedraft] = useState(false);
  const [redraftLoaded, setRedraftLoaded] = useState(false);
  const [redraftError, setRedraftError] = useState<string | null>(null);

  // Refs so useCallback can read current values without stale closures
  const calcValuesLeagueIdRef = useRef(calcValuesLeagueId);
  const redraftLoadedRef = useRef(redraftLoaded);
  useEffect(() => { calcValuesLeagueIdRef.current = calcValuesLeagueId; }, [calcValuesLeagueId]);
  useEffect(() => { redraftLoadedRef.current = redraftLoaded; }, [redraftLoaded]);
  // Monotonic guard so a slow fetch for one league can't overwrite a newer league's values.
  const calcSeq = useRef(0);

  const loadCalcValues = useCallback(async (leagueId: string) => {
    if (calcValuesLeagueIdRef.current === leagueId) return;
    const seq = ++calcSeq.current;
    setLoadingCalcValues(true);
    setCalcValuesError(null);
    try {
      const res = await fetch(
        `https://api.fantasycalc.com/values/current?leagueId=${leagueId}&site=sleeper`
      );
      if (!res.ok) throw new Error(`FantasyCalc ${res.status}`);
      const data = await res.json();
      const vals: Record<string, number> = {};
      (data as { player?: { sleeperId?: string }; value: number }[]).forEach((entry) => {
        const sleeperId = entry.player?.sleeperId;
        if (sleeperId) vals[String(sleeperId)] = entry.value;
      });
      if (seq !== calcSeq.current) return; // a newer league load started — discard
      setCalcFcValues(vals);
      setCalcValuesLeagueId(leagueId);
    } catch (err) {
      log.error("loadCalcValues failed", { err: String(err) });
      if (seq === calcSeq.current) setCalcValuesError("Couldn't load player values from FantasyCalc.");
    } finally {
      if (seq === calcSeq.current) setLoadingCalcValues(false);
    }
  }, []);

  const loadRedraftValues = useCallback(async () => {
    if (redraftLoadedRef.current) return;
    setLoadingRedraft(true);
    setRedraftError(null);
    try {
      const res = await fetch(
        `https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=2`
      );
      if (!res.ok) throw new Error(`FantasyCalc ${res.status}`);
      const data = await res.json();
      const vals: Record<string, number> = {};
      (data as { player?: { sleeperId?: string }; value: number }[]).forEach((entry) => {
        const sleeperId = entry.player?.sleeperId;
        if (sleeperId) vals[String(sleeperId)] = entry.value;
      });
      setRedraftValues(vals);
      setRedraftLoaded(true);
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
