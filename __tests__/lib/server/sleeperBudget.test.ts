import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as C from "@/lib/constants";

// The global Sleeper call budget (call-budget Stage 4): a Supabase RPC counts each call in a shared
// 10s window — interactive callers up to WINDOW_CAP, background jobs up to BACKGROUND_CAP — with an
// in-process window of the same shape when Supabase can't be reached.

const h = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: h.getSupabaseAdmin }));

type RpcResult = { data: unknown; error: unknown };
/** A service-role client whose take_sleeper_call_slot answers come from `answer`, one per call. */
function fakeClient(answer: (limit: number) => RpcResult | Promise<RpcResult>) {
  const rpc = vi.fn((name: string, args: { p_limit: number }) => ({
    abortSignal: vi.fn((signal: AbortSignal) => {
      expect(name).toBe("take_sleeper_call_slot");
      expect(signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(answer(args.p_limit));
    }),
  }));
  return { rpc };
}
const row = (granted: boolean, ms = 4_000) => ({
  data: [{ granted, window_calls: granted ? 1 : 100, ms_to_next_window: ms }],
  error: null,
});

/** A fresh module each test: the fallback window and the down-until clock are module state. */
async function load() {
  vi.resetModules();
  return import("@/lib/server/sleeperBudget");
}

/** Settles `p` while running timers, so a wait inside it can't hang the test. */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  const tracked = p.finally(() => { done = true; });
  while (!done) await vi.advanceTimersByTimeAsync(50);
  return tracked;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 10, 12, 0, 0)); // on a 10s window boundary
  vi.spyOn(Math, "random").mockReturnValue(0); // no retry jitter
  h.getSupabaseAdmin.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("waitForSleeperSlot — shared Supabase window", () => {
  it("asks for a slot under WINDOW_CAP for interactive calls and BACKGROUND_CAP for background", async () => {
    const client = fakeClient(() => row(true));
    h.getSupabaseAdmin.mockReturnValue(client);
    const { waitForSleeperSlot } = await load();

    await waitForSleeperSlot("interactive");
    await waitForSleeperSlot("background");

    expect(client.rpc.mock.calls.map((c) => c[1])).toEqual([
      { p_limit: C.SLEEPER_BUDGET_WINDOW_CAP },
      { p_limit: C.SLEEPER_BUDGET_BACKGROUND_CAP },
    ]);
    expect(C.SLEEPER_BUDGET_BACKGROUND_CAP).toBeLessThan(C.SLEEPER_BUDGET_WINDOW_CAP);
  });

  it("waits for the next window when the current one is full, then takes a slot", async () => {
    const answers = [row(false, 3_000), row(true)];
    const client = fakeClient(() => answers.shift()!);
    h.getSupabaseAdmin.mockReturnValue(client);
    const { waitForSleeperSlot } = await load();

    const started = Date.now();
    await settle(waitForSleeperSlot("interactive"));
    expect(client.rpc).toHaveBeenCalledTimes(2);
    // Slept until the window the database said was next (no jitter here).
    expect(Date.now() - started).toBeGreaterThanOrEqual(3_000);
    expect(Date.now() - started).toBeLessThan(3_100);
  });

  it("an interactive call still facing a full window after the max wait goes anyway, never fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = fakeClient(() => row(false, C.SLEEPER_BUDGET_WINDOW_MS));
    h.getSupabaseAdmin.mockReturnValue(client);
    const { waitForSleeperSlot } = await load();

    const started = Date.now();
    await expect(settle(waitForSleeperSlot("interactive"))).resolves.toBeUndefined();
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(C.SLEEPER_BUDGET_INTERACTIVE_MAX_WAIT_MS);
    expect(waited).toBeLessThan(C.SLEEPER_BUDGET_INTERACTIVE_MAX_WAIT_MS + 200);
    expect(warn.mock.calls.some((c) => c.some((arg) => String(arg).includes("still full")))).toBe(true);
  });

  it("a background call keeps waiting past the interactive limit while the window stays full", async () => {
    let calls = 0;
    const client = fakeClient(() => (++calls < 4 ? row(false, C.SLEEPER_BUDGET_WINDOW_MS) : row(true)));
    h.getSupabaseAdmin.mockReturnValue(client);
    const { waitForSleeperSlot } = await load();

    const started = Date.now();
    await settle(waitForSleeperSlot("background"));
    expect(calls).toBe(4);
    expect(Date.now() - started).toBeGreaterThanOrEqual(3 * C.SLEEPER_BUDGET_WINDOW_MS);
  });

  it("a background call throws SleeperBudgetTimeoutError once its deadline passes without a slot", async () => {
    const client = fakeClient(() => row(false, C.SLEEPER_BUDGET_WINDOW_MS));
    h.getSupabaseAdmin.mockReturnValue(client);
    const { waitForSleeperSlot, SleeperBudgetTimeoutError } = await load();

    const deadlineAt = Date.now() + 25_000;
    const result = settle(waitForSleeperSlot("background", { deadlineAt }).then(() => "ok", (e) => e));
    const err = await result;
    expect(err).toBeInstanceOf(SleeperBudgetTimeoutError);
    // It gave up at the deadline, not a whole window later.
    expect(Date.now()).toBeGreaterThanOrEqual(deadlineAt);
    expect(Date.now()).toBeLessThan(deadlineAt + 200);
  });
});

describe("waitForSleeperSlot — in-process fallback", () => {
  it("counts in this instance's own window when there's no service-role client", async () => {
    h.getSupabaseAdmin.mockReturnValue(null);
    const { waitForSleeperSlot } = await load();

    for (let i = 0; i < C.SLEEPER_BUDGET_WINDOW_CAP; i++) await waitForSleeperSlot("interactive");
    // The window is full: the next call waits for the next one.
    const started = Date.now();
    await settle(waitForSleeperSlot("interactive"));
    expect(Date.now() - started).toBeGreaterThanOrEqual(C.SLEEPER_BUDGET_WINDOW_MS);
  });

  it("holds background calls to BACKGROUND_CAP of the local window too", async () => {
    h.getSupabaseAdmin.mockReturnValue(null);
    const { waitForSleeperSlot } = await load();

    for (let i = 0; i < C.SLEEPER_BUDGET_BACKGROUND_CAP; i++) await waitForSleeperSlot("background");
    const started = Date.now();
    await settle(waitForSleeperSlot("background"));
    expect(Date.now() - started).toBeGreaterThanOrEqual(C.SLEEPER_BUDGET_WINDOW_MS);
    // Interactive calls still get the rest of a window background has filled to its cap.
    await waitForSleeperSlot("interactive");
  });

  it("an RPC error falls back for the cooldown, then tries Supabase again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const answers: RpcResult[] = [{ data: null, error: { message: "function not found", code: "PGRST202" } }];
    const client = fakeClient(() => answers.shift() ?? row(true));
    h.getSupabaseAdmin.mockReturnValue(client);
    const { waitForSleeperSlot } = await load();

    await waitForSleeperSlot("interactive"); // error → local window
    await waitForSleeperSlot("interactive"); // inside the cooldown → local, no RPC
    expect(client.rpc).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + C.SLEEPER_BUDGET_FALLBACK_COOLDOWN_MS + 1);
    await waitForSleeperSlot("interactive");
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it("a malformed RPC answer or a thrown client falls back instead of failing the call", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h.getSupabaseAdmin.mockReturnValue(fakeClient(() => ({ data: [{ nope: 1 }], error: null })));
    let mod = await load();
    await expect(mod.waitForSleeperSlot("interactive")).resolves.toBeUndefined();

    h.getSupabaseAdmin.mockImplementation(() => { throw new Error("Invalid supabaseUrl"); });
    mod = await load();
    await expect(mod.waitForSleeperSlot("background")).resolves.toBeUndefined();
  });
});
