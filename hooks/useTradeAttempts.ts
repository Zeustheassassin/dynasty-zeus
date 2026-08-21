"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import type { User as SupabaseUser } from "@supabase/auth-js";
import { supabase } from "../lib/supabaseclient";
import type { TradeAttempt, TradeAttemptStatus } from "../lib/types";

export function useTradeAttempts(supabaseUser: SupabaseUser | null) {
  const [tradeAttempts, setTradeAttempts] = useState<TradeAttempt[]>([]);
  const [tradeAttemptsLeagueId, setTradeAttemptsLeagueId] = useState<string | null>(null);
  const [loadingTradeAttempts, setLoadingTradeAttempts] = useState(false);
  const [tradeAttemptsError, setTradeAttemptsError] = useState<string | null>(null);
  const [allTradeAttempts, setAllTradeAttempts] = useState<TradeAttempt[]>([]);

  // Stable ref so useCallback functions can read current user without declaring it as a dep
  const userRef = useRef(supabaseUser);
  useEffect(() => { userRef.current = supabaseUser; }, [supabaseUser]);

  useEffect(() => {
    if (!supabaseUser?.id) { setAllTradeAttempts([]); return; }
    let cancelled = false;
    supabase
      .from("trade_attempts")
      .select("*")
      .eq("user_id", supabaseUser.id)
      .order("attempted_at", { ascending: false })
      .then(({ data }) => { if (!cancelled && data) setAllTradeAttempts(data as TradeAttempt[]); });
    return () => { cancelled = true; };
  }, [supabaseUser?.id]);

  // Guards against a slow league switch landing after a faster one — without
  // this, fast-switching leagues in Trade Hub could show one league's trade
  // attempts under a different league's label.
  const loadSeq = useRef(0);

  const loadTradeAttempts = useCallback(async (leagueId: string) => {
    const user = userRef.current;
    if (!user) return;
    const seq = ++loadSeq.current;
    setLoadingTradeAttempts(true);
    setTradeAttemptsError(null);
    setTradeAttemptsLeagueId(leagueId);
    try {
      const { data, error } = await supabase
        .from("trade_attempts")
        .select("*")
        .eq("user_id", user.id)
        .eq("league_id", leagueId)
        .order("attempted_at", { ascending: false });
      if (seq !== loadSeq.current) return; // a newer league switch happened — discard
      if (error) {
        setTradeAttemptsError("Couldn't load trade attempts — try again.");
        return;
      }
      if (data) setTradeAttempts(data as TradeAttempt[]);
    } finally {
      if (seq === loadSeq.current) setLoadingTradeAttempts(false);
    }
  }, []);

  const markTradeAttempted = useCallback(async (
    attempt: Omit<TradeAttempt, "id" | "user_id" | "attempted_at" | "resolved_at">
  ) => {
    const user = userRef.current;
    if (!user) return;
    const { data, error } = await supabase
      .from("trade_attempts")
      .insert({ ...attempt, user_id: user.id })
      .select()
      .single();
    if (!error && data) {
      setTradeAttempts((prev) => [data as TradeAttempt, ...prev]);
      setAllTradeAttempts((prev) => [data as TradeAttempt, ...prev]);
    }
  }, []);

  const updateAttemptStatus = useCallback(async (
    id: string,
    status: TradeAttemptStatus,
    counterDetails?: string
  ) => {
    const user = userRef.current;
    if (!user) return;
    const update: Record<string, unknown> = {
      status,
      resolved_at: status !== "PENDING" ? new Date().toISOString() : null,
    };
    if (counterDetails !== undefined) update.counter_details = counterDetails;
    const { error } = await supabase
      .from("trade_attempts")
      .update(update)
      .eq("id", id)
      .eq("user_id", user.id);
    if (!error) {
      setTradeAttempts((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                status,
                counter_details: counterDetails ?? a.counter_details,
                resolved_at: update.resolved_at as string | null,
              }
            : a
        )
      );
      setAllTradeAttempts((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                status,
                counter_details: counterDetails ?? a.counter_details,
                resolved_at: update.resolved_at as string | null,
              }
            : a
        )
      );
    }
  }, []);

  const deleteAttempt = useCallback(async (id: string) => {
    const user = userRef.current;
    if (!user) return;
    const { error } = await supabase
      .from("trade_attempts")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (!error) {
      setTradeAttempts((prev) => prev.filter((a) => a.id !== id));
      setAllTradeAttempts((prev) => prev.filter((a) => a.id !== id));
    }
  }, []);

  return {
    tradeAttempts,
    tradeAttemptsLeagueId,
    loadingTradeAttempts,
    tradeAttemptsError,
    allTradeAttempts,
    loadTradeAttempts,
    markTradeAttempted,
    updateAttemptStatus,
    deleteAttempt,
  };
}
