"use client";
// The NFL contract situation (GET /api/nfl/situation, lib/contractSituation.ts)
// and the user's own stays / goes calls (nfl_contract_overrides, migration 097),
// shared by every component that shows them (Player profile, Data Hub → Depth
// Charts, the Post-Draft tab): one module-level store, loaded the first time
// any of them mounts, so a call made in one place shows everywhere at once.
//
// The situation is ~0.5 MB and the server caches it for 6 hours, so it is kept
// in memory for the session only (not localStorage). The calls are mirrored to
// localStorage for an instant first paint, with Supabase as the cross-device
// source of truth; until migration 097 is applied the Supabase read / write
// fails quietly (logged) and the calls stay in this browser.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { logger } from "../lib/logger";
import { getLocalStorageItem, setLocalStorageItem } from "../lib/hooks/useLocalStorage";
import type { ContractOverrides, ContractSituationResponse, OverrideCall } from "../lib/contractSituation";

const log = logger("hooks/useContractSituation");

/** The Supabase client, loaded on first use (importing it opens the client, which needs the env vars; the Big
 *  Board's tests render the Post-Draft tab without them). */
const db = async () => (await import("../lib/supabaseclient")).supabase;

export const CONTRACT_OVERRIDES_KEY = "nflContractOverrides_v1";

interface State {
  situation: ContractSituationResponse | null;
  loading: boolean;
  error: string | null;
  overrides: ContractOverrides;
}

/** Keeps only well-formed calls (a stale or hand-edited localStorage value can't break a render). */
export function cleanOverrides(raw: unknown): ContractOverrides {
  const out: ContractOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = v as { call?: unknown; season?: unknown } | null;
    if (!/^\d+$/.test(k) || !o) continue;
    if ((o.call === "stays" || o.call === "goes") && typeof o.season === "number" && Number.isInteger(o.season)) {
      out[k] = { call: o.call, season: o.season };
    }
  }
  return out;
}

let state: State = { situation: null, loading: false, error: null, overrides: {} };
let started = false;
let overridesLoaded = false;
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

async function loadSituation(force = false) {
  if (state.loading || (state.situation && !force)) return;
  set({ loading: true, error: null });
  try {
    const { data: { session } } = await (await db()).auth.getSession();
    if (!session?.access_token) throw new Error("Sign in to see NFL contract outlooks");
    const res = await fetch("/api/nfl/situation", { headers: { Authorization: `Bearer ${session.access_token}` } });
    const body = (await res.json().catch(() => null)) as (ContractSituationResponse & { error?: string }) | null;
    if (!res.ok || !body || !body.players) throw new Error(body?.error ?? `HTTP ${res.status}`);
    set({ situation: body, loading: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("contract situation load failed", { msg });
    set({ loading: false, error: msg });
  }
}

async function loadOverrides() {
  if (overridesLoaded) return;
  overridesLoaded = true;
  set({ overrides: cleanOverrides(getLocalStorageItem<unknown>(CONTRACT_OVERRIDES_KEY, {})) });
  try {
    const { data: { session } } = await (await db()).auth.getSession();
    if (!session?.user) return;
    const { data, error } = await (await db()).from("nfl_contract_overrides").select("overrides").eq("user_id", session.user.id).maybeSingle();
    if (error) { log.warn("nfl_contract_overrides load failed (is migration 097 applied?)", { err: error.message }); return; }
    if (data) {
      const overrides = cleanOverrides((data as { overrides?: unknown }).overrides);
      setLocalStorageItem(CONTRACT_OVERRIDES_KEY, overrides);
      set({ overrides });
    }
  } catch (e) {
    log.warn("nfl_contract_overrides load failed", { err: String(e) });
  }
}

/** Sets (or, with null, clears) the user's call on one player for one season. */
async function saveOverride(otcId: number, call: OverrideCall | null, season: number) {
  const next = { ...state.overrides };
  if (call) next[String(otcId)] = { call, season };
  else delete next[String(otcId)];
  set({ overrides: next });
  setLocalStorageItem(CONTRACT_OVERRIDES_KEY, next);
  try {
    const { data: { session } } = await (await db()).auth.getSession();
    if (!session?.user) return;
    const { error } = await (await db()).from("nfl_contract_overrides").upsert(
      { user_id: session.user.id, overrides: next, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) log.error("nfl_contract_overrides save failed (is migration 097 applied?)", { err: error.message });
  } catch (e) {
    log.error("nfl_contract_overrides save failed", { err: String(e) });
  }
}

const getSnapshot = () => state;

/** The situation and the user's calls; loads both on first use. */
export function useContractSituation() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (started) return;
    started = true;
    void loadSituation();
    void loadOverrides();
  }, []);
  const setOverride = useCallback((otcId: number, call: OverrideCall | null) => {
    if (state.situation) void saveOverride(otcId, call, state.situation.season);
  }, []);
  const retry = useCallback(() => { void loadSituation(true); }, []);
  return { ...s, setOverride, retry };
}

/** Test hook: back to a fresh store. */
export function resetContractSituationStore() {
  state = { situation: null, loading: false, error: null, overrides: {} };
  started = false;
  overridesLoaded = false;
}
