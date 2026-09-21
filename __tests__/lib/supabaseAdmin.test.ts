import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The shared cache tables are SELECT-only for anon (RLS, migrations 026/053), so their writes must use
// the service role on the server. This pins the client's behavior and — because the key would be a
// full-database credential — the boundary that keeps the module out of client code.

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: h.createClient }));

const URL_ = "https://test.supabase.co";

async function load() {
  vi.resetModules(); // the client + missing-key warning are module-level state
  return import("@/lib/supabaseAdmin");
}
const rls = { message: 'new row violates row-level security policy for table "fc_values_cache"', code: "42501" };

beforeEach(() => {
  vi.clearAllMocks();
  h.createClient.mockImplementation(() => ({ from: h.from }));
  h.from.mockImplementation(() => ({ upsert: h.upsert }));
  h.upsert.mockImplementation(async () => ({ error: null }));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getSupabaseAdmin", () => {
  it("builds a service-role client that never persists a session, and reuses it", async () => {
    const { getSupabaseAdmin } = await load();
    const a = getSupabaseAdmin();
    const b = getSupabaseAdmin();
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(h.createClient).toHaveBeenCalledTimes(1);
    expect(h.createClient).toHaveBeenCalledWith(URL_, "service-role-key", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it("returns null (and warns once) when the service key is not configured", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
    const { getSupabaseAdmin } = await load();
    expect(getSupabaseAdmin()).toBeNull();
    expect(getSupabaseAdmin()).toBeNull();
    expect(h.createClient).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("returns null when the Supabase URL is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    const { getSupabaseAdmin } = await load();
    expect(getSupabaseAdmin()).toBeNull();
  });
});

describe("upsertCacheRow", () => {
  it("upserts the row into the named table with the service role and resolves true", async () => {
    const { upsertCacheRow } = await load();
    const row = { num_qbs: 2, data: [{ value: 1 }], cached_at: "2026-09-21T00:00:00.000Z" };
    await expect(upsertCacheRow("fc_values_cache", row)).resolves.toBe(true);
    expect(h.from).toHaveBeenCalledWith("fc_values_cache");
    expect(h.upsert).toHaveBeenCalledWith(row);
  });

  it("skips the write and resolves false when there is no service key", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
    const { upsertCacheRow } = await load();
    await expect(upsertCacheRow("fc_values_cache", { num_qbs: 2 })).resolves.toBe(false);
    expect(h.from).not.toHaveBeenCalled();
  });

  it("retries a transient failure and resolves true once an attempt succeeds", async () => {
    vi.useFakeTimers();
    h.upsert
      .mockResolvedValueOnce({ error: { message: "connection reset" } })
      .mockResolvedValueOnce({ error: { message: "connection reset" } })
      .mockResolvedValueOnce({ error: null });
    const { upsertCacheRow } = await load();
    const result = upsertCacheRow("sleeper_stats_cache", { season: "v2-2026", week: 3 });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toBe(true);
    expect(h.upsert).toHaveBeenCalledTimes(3);
  });

  it("never throws: logs the real PostgREST message and code and resolves false after the last retry", async () => {
    vi.useFakeTimers();
    h.upsert.mockResolvedValue({ error: rls });
    const { upsertCacheRow } = await load();
    const result = upsertCacheRow("fc_values_cache", { num_qbs: 2 });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toBe(false);
    expect(h.upsert).toHaveBeenCalledTimes(3);
    // PostgrestError is a plain object — String(err) would have logged "[object Object]".
    expect(console.error).toHaveBeenCalledWith(
      "[lib/supabaseAdmin]",
      "cache write failed after retries",
      { table: "fc_values_cache", err: rls.message, code: "42501" }
    );
  });
});

// The service-role key is a full-database credential. Non-NEXT_PUBLIC_ env vars are `undefined` in a
// browser bundle, so a stray client import couldn't leak it — but it would silently stop caching, and
// the module has no business anywhere but the server. Keep the import boundary explicit.
describe("supabaseAdmin import boundary", () => {
  const ROOT = process.cwd();
  const SKIP = new Set(["node_modules", ".next", ".git"]);
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  const files = ["app", "lib", "hooks", "components"]
    .flatMap((d) => walk(path.join(ROOT, d)))
    .map((full) => ({ rel: path.relative(ROOT, full).split(path.sep).join("/"), src: fs.readFileSync(full, "utf8") }));
  const importers = files.filter((f) => f.rel !== "lib/supabaseAdmin.ts" && /supabaseAdmin/.test(f.src));

  it("is imported by at least one server route (so this guard isn't vacuous)", () => {
    expect(importers.length).toBeGreaterThan(0);
  });

  it("is only imported from route handlers or lib/server", () => {
    const offenders = importers.filter((f) => !f.rel.startsWith("app/api/") && !f.rel.startsWith("lib/server/"));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it("is never imported by a 'use client' module", () => {
    const offenders = importers.filter((f) => /^\s*(['"])use client\1/.test(f.src));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });
});
