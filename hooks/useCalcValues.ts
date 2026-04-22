"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { logger } from "../lib/logger";

const log = logger("hooks/useCalcValues");

export function useCalcValues() {
  const [calcFcValues, setCalcFcValues] = useState<Record<string, number>>({});
  const [calcValuesLeagueId, setCalcValuesLeagueId] = useState<string | null>(null);
  const [loadingCalcValues, setLoadingCalcValues] = useState(false);
  const [redraftValues, setRedraftValues] = useState<Record<string, number>>({});
  const [loadingRedraft, setLoadingRedraft] = useState(false);
  const [redraftLoaded, setRedraftLoaded] = useState(false);

  // Refs so useCallback can read current values without stale closures
  const calcValuesLeagueIdRef = useRef(calcValuesLeagueId);
  const redraftLoadedRef = useRef(redraftLoaded);
  useEffect(() => { calcValuesLeagueIdRef.current = calcValuesLeagueId; }, [calcValuesLeagueId]);
  useEffect(() => { redraftLoadedRef.current = redraftLoaded; }, [redraftLoaded]);

  const loadCalcValues = useCallback(async (leagueId: string) => {
    if (calcValuesLeagueIdRef.current === leagueId) return;
    setLoadingCalcValues(true);
    try {
      const res = await fetch(
        `https://api.fantasycalc.com/values/current?leagueId=${leagueId}&site=sleeper`
      );
      const data = await res.json();
      const vals: Record<string, number> = {};
      (data as { player?: { sleeperId?: string }; value: number }[]).forEach((entry) => {
        const sleeperId = entry.player?.sleeperId;
        if (sleeperId) vals[String(sleeperId)] = entry.value;
      });
      setCalcFcValues(vals);
      setCalcValuesLeagueId(leagueId);
    } catch (err) {
      log.error("loadCalcValues failed", { err: String(err) });
    } finally {
      setLoadingCalcValues(false);
    }
  }, []);

  const loadRedraftValues = useCallback(async () => {
    if (redraftLoadedRef.current) return;
    setLoadingRedraft(true);
    try {
      const res = await fetch(
        `https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=2`
      );
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
    } finally {
      setLoadingRedraft(false);
    }
  }, []);

  return {
    calcFcValues,
    loadingCalcValues,
    redraftValues,
    loadingRedraft,
    loadCalcValues,
    loadRedraftValues,
  };
}
