// ============================================================
// Global Sleeper call budget — SERVER-ONLY.
// ============================================================
// Sleeper asks for under ~1000 calls a minute per IP, and Vercel's egress IPs aren't fixed, so
// every server-side call that actually reaches Sleeper draws on ONE counter in Supabase
// (sleeper_call_budget / take_sleeper_call_slot, migration 069): 10-second windows, at most
// SLEEPER_BUDGET_WINDOW_CAP calls each — 700 in any 60s, 600 sustained.
//
// Two priorities:
//   - "interactive" — someone is waiting on a page (the /api/sleeper/* proxies on a Data Cache
//     miss, /api/players, /api/nfl-state, the stats routes). Takes a slot while the window is under
//     WINDOW_CAP. When it's full, waits for the next window, up to INTERACTIVE_MAX_WAIT_MS, then goes
//     anyway (logged) rather than fail the request. Never throws.
//   - "background" — the transactions and simulation-history crons and the consensus compile. Only
//     while the window is under BACKGROUND_CAP, so they always leave room for people using the app.
//     Waits as long as it takes, up to the job's `deadlineAt`, then throws SleeperBudgetTimeoutError
//     so the job treats that work as cut off — not as Sleeper answering with nothing.
//
// When Supabase is unconfigured (local dev, previews), the migration isn't applied yet, or the RPC
// errors or times out, this lambda instance counts in its own in-process window with the same caps
// for FALLBACK_COOLDOWN_MS before trying Supabase again. Per instance, so looser than the shared
// count; the jobs keep their own createPacer rate either way.
// ============================================================

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { logger } from "@/lib/logger";
import {
  SLEEPER_BUDGET_WINDOW_MS,
  SLEEPER_BUDGET_WINDOW_CAP,
  SLEEPER_BUDGET_BACKGROUND_CAP,
  SLEEPER_BUDGET_INTERACTIVE_MAX_WAIT_MS,
  SLEEPER_BUDGET_RPC_TIMEOUT_MS,
  SLEEPER_BUDGET_FALLBACK_COOLDOWN_MS,
} from "@/lib/constants";

const log = logger("lib/server/sleeperBudget");

export type SleeperCallPriority = "interactive" | "background";

/** A background job's call couldn't get a slot before the job's deadline. */
export class SleeperBudgetTimeoutError extends Error {
  constructor() {
    super("No Sleeper call slot before the job's deadline");
    this.name = "SleeperBudgetTimeoutError";
  }
}

// Callers waiting on a full window spread their retries over this much of the next window's start,
// so a backlog doesn't land on the counter row in the same millisecond.
const RETRY_JITTER_MS = 250;

interface TakeResult {
  granted: boolean;
  msToNextWindow: number;
}

// ── Shared (Supabase) ────────────────────────────────────────

let sharedDownUntil = 0;

async function takeShared(limit: number): Promise<TakeResult | null> {
  if (Date.now() < sharedDownUntil) return null;
  try {
    const client = getSupabaseAdmin();
    if (!client) return null;
    const { data, error } = await client
      .rpc("take_sleeper_call_slot", { p_limit: limit })
      .abortSignal(AbortSignal.timeout(SLEEPER_BUDGET_RPC_TIMEOUT_MS));
    if (error) throw error;
    const row: unknown = Array.isArray(data) ? data[0] : data;
    if (!row || typeof (row as { granted?: unknown }).granted !== "boolean") {
      throw new Error("unexpected take_sleeper_call_slot result");
    }
    const { granted, ms_to_next_window } = row as { granted: boolean; ms_to_next_window: unknown };
    const ms = Number(ms_to_next_window);
    return {
      granted,
      msToNextWindow: Number.isFinite(ms) ? Math.min(Math.max(ms, 1), SLEEPER_BUDGET_WINDOW_MS) : SLEEPER_BUDGET_WINDOW_MS,
    };
  } catch (err) {
    sharedDownUntil = Date.now() + SLEEPER_BUDGET_FALLBACK_COOLDOWN_MS;
    // PostgrestError is a plain object, so String(err) alone would log "[object Object]".
    const message = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
    log.warn("shared Sleeper budget unavailable — counting in this instance until it's back", {
      err: message,
      cooldownMs: SLEEPER_BUDGET_FALLBACK_COOLDOWN_MS,
    });
    return null;
  }
}

// ── In-process fallback ──────────────────────────────────────

const local = { windowId: -1, calls: 0 };

function takeLocal(limit: number): TakeResult {
  const now = Date.now();
  const windowId = Math.floor(now / SLEEPER_BUDGET_WINDOW_MS);
  if (local.windowId !== windowId) {
    local.windowId = windowId;
    local.calls = 0;
  }
  const msToNextWindow = SLEEPER_BUDGET_WINDOW_MS - (now % SLEEPER_BUDGET_WINDOW_MS);
  if (local.calls >= limit) return { granted: false, msToNextWindow };
  local.calls++;
  return { granted: true, msToNextWindow };
}

async function take(limit: number): Promise<TakeResult> {
  return (await takeShared(limit)) ?? takeLocal(limit);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One overflow warning per window is enough to see it happening.
let lastOverflowLogWindow = -1;

/**
 * Resolves when this caller may make ONE Sleeper call, having counted it in the shared window.
 * Call it immediately before the fetch that reaches Sleeper — never in front of a cache hit.
 *
 * interactive: waits at most SLEEPER_BUDGET_INTERACTIVE_MAX_WAIT_MS, then resolves anyway.
 * background: waits until the window is under SLEEPER_BUDGET_BACKGROUND_CAP; throws
 * SleeperBudgetTimeoutError once `deadlineAt` (epoch ms) passes without one.
 */
export async function waitForSleeperSlot(
  priority: SleeperCallPriority,
  opts: { deadlineAt?: number } = {}
): Promise<void> {
  const limit = priority === "interactive" ? SLEEPER_BUDGET_WINDOW_CAP : SLEEPER_BUDGET_BACKGROUND_CAP;
  const giveUpAt =
    priority === "interactive" ? Date.now() + SLEEPER_BUDGET_INTERACTIVE_MAX_WAIT_MS : opts.deadlineAt ?? Infinity;

  for (;;) {
    const { granted, msToNextWindow } = await take(limit);
    if (granted) return;

    const left = giveUpAt - Date.now();
    if (left <= 0) {
      if (priority === "background") throw new SleeperBudgetTimeoutError();
      const windowId = Math.floor(Date.now() / SLEEPER_BUDGET_WINDOW_MS);
      if (windowId !== lastOverflowLogWindow) {
        lastOverflowLogWindow = windowId;
        log.warn("Sleeper call window still full after the wait — calling anyway", {
          waitedMs: SLEEPER_BUDGET_INTERACTIVE_MAX_WAIT_MS,
          cap: limit,
        });
      }
      return;
    }
    await sleep(Math.min(msToNextWindow + Math.random() * RETRY_JITTER_MS, left));
  }
}
