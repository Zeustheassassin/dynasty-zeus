// ============================================================
// PFF Premium Stats API client — SERVER-ONLY.
// ============================================================
// The key (PFF_API_KEY, never NEXT_PUBLIC_) authorizes the user's own PFF Pro
// account; PFF says it must never reach a browser, so only API routes and
// scripts import lib/pff. Base https://api.pff.com, `Authorization: Bearer`.
//
// Budget: PFF meters reads per account per minute (100 on 2026-10-04) and
// reports it on every counted response as x-ratelimit-limit / -remaining /
// -reset (epoch seconds). Requests from one client run one at a time; when
// the remaining reads hit the reserve, the next request waits for the reset
// instead of drawing a 429. A 429 or 503 is retried after its Retry-After; a
// 5xx, timeout or network failure is retried with back-off. Every read is
// safe to repeat.
//
// `restricted`: a view-only entitlement answers 200 with the withheld columns
// listed under `restricted` (at the top level or inside the report object).
// None were seen on 2026-10-04 (tier pro, NCAA 2008–2026); any that appear
// are logged once per path so a silently thinner response gets noticed.
// ============================================================

import { logger } from "../logger";

const log = logger("lib/pff/client");

export const PFF_BASE_URL = "https://api.pff.com";

export class PffError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** PFF's stable `error.code` ("rate_limited", "not_found", …), when given. */
    readonly code: string | null = null,
    /** How long PFF asked us to wait, when it said. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "PffError";
  }
}

export type PffParams = Record<string, string | number | boolean | undefined | null>;

export interface PffClient {
  get<T>(path: string, params?: PffParams): Promise<T>;
}

export interface PffClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Reads left in the window before we pause for its reset. */
  reserve?: number;
  /** Longest single wait (budget reset or Retry-After) before failing instead. */
  maxWaitMs?: number;
  /** Retries after the first attempt. */
  retries?: number;
  timeoutMs?: number;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Seconds or an HTTP date → ms from now; null when absent or unreadable. */
function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** The `restricted` list on a response, at the top level or one report down. */
export function findRestricted(body: unknown): unknown | null {
  if (!body || typeof body !== "object") return null;
  const nonEmpty = (v: unknown) =>
    Array.isArray(v) ? v.length > 0 : v && typeof v === "object" ? Object.keys(v).length > 0 : Boolean(v);
  const top = (body as Record<string, unknown>).restricted;
  if (nonEmpty(top)) return top;
  for (const v of Object.values(body as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = (v as Record<string, unknown>).restricted;
      if (nonEmpty(inner)) return inner;
    }
  }
  return null;
}

const loggedRestricted = new Set<string>();

export function createPffClient(opts: PffClientOptions): PffClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const reserve = opts.reserve ?? 2;
  const maxWaitMs = opts.maxWaitMs ?? 65_000;
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  let remaining: number | null = null;
  let resetAt: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function noteBudget(res: Response) {
    const rem = Number(res.headers.get("x-ratelimit-remaining"));
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    if (res.headers.has("x-ratelimit-remaining") && Number.isFinite(rem)) remaining = rem;
    if (res.headers.has("x-ratelimit-reset") && Number.isFinite(reset)) resetAt = reset * 1000;
  }

  async function waitForBudget() {
    if (remaining == null || resetAt == null || remaining > reserve) return;
    const wait = resetAt - now() + 250;
    if (wait <= 0) { remaining = null; return; }
    if (wait > maxWaitMs) throw new PffError("PFF read budget exhausted", 429, "rate_limited", wait);
    log.info("PFF budget low, waiting for reset", { remaining, waitMs: wait });
    await sleep(wait);
    remaining = null;
  }

  async function request<T>(path: string, params?: PffParams): Promise<T> {
    const url = new URL(path, PFF_BASE_URL);
    for (const [k, v] of Object.entries(params ?? {})) if (v != null) url.searchParams.set(k, String(v));

    for (let attempt = 0; ; attempt++) {
      await waitForBudget();
      let res: Response;
      try {
        res = await fetchImpl(url.toString(), {
          headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (attempt >= retries) throw new PffError(`PFF request failed: ${String(err)}`, 0, "network_error");
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      noteBudget(res);

      if (res.ok) {
        const body = (await res.json()) as T;
        const restricted = findRestricted(body);
        if (restricted) {
          const key = `${path} ${JSON.stringify(restricted)}`;
          if (!loggedRestricted.has(key)) {
            loggedRestricted.add(key);
            log.warn("PFF withheld columns", { path, restricted });
          }
        }
        return body;
      }

      const errBody = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const code = errBody?.error?.code ?? null;
      const message = errBody?.error?.message ?? `PFF ${res.status}`;
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"), now());

      if (RETRY_STATUSES.has(res.status) && attempt < retries) {
        const wait = retryAfter
          ?? (res.status === 429 && resetAt != null ? Math.max(0, resetAt - now()) + 250 : 1000 * 2 ** attempt);
        if (wait <= maxWaitMs) {
          log.warn("PFF request retrying", { path, status: res.status, code, waitMs: wait });
          await sleep(wait);
          continue;
        }
      }
      throw new PffError(message, res.status, code, retryAfter);
    }
  }

  return {
    get<T>(path: string, params?: PffParams): Promise<T> {
      // One request at a time per client, so the budget headers stay current.
      const run = queue.then(() => request<T>(path, params));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

let shared: PffClient | null = null;

/** The app's client, built from PFF_API_KEY; null when the key isn't set. */
export function getPffClient(): PffClient | null {
  if (typeof window !== "undefined") throw new Error("lib/pff is server-only");
  const apiKey = process.env.PFF_API_KEY;
  if (!apiKey) return null;
  shared ??= createPffClient({ apiKey });
  return shared;
}
