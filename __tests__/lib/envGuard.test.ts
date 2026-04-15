/**
 * envGuard.test.ts
 *
 * Verifies that the Supabase client module throws a clear error when the
 * required environment variables are absent, and does NOT throw when they
 * are present.  Uses vi.resetModules() so each test gets a fresh module
 * evaluation (module-level code in supabaseclient.ts runs at import time).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const FAKE_URL = "https://test.supabase.co";
const FAKE_KEY = "anon.test.key";

describe("supabaseclient env guard", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env so other tests aren't affected
    if (originalUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    }
    if (originalKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    }
  });

  it("throws when both env vars are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    await expect(import("@/lib/supabaseclient")).rejects.toThrow(
      /Missing Supabase environment variables/
    );
  });

  it("throws when only the URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = FAKE_KEY;

    await expect(import("@/lib/supabaseclient")).rejects.toThrow(
      /Missing Supabase environment variables/
    );
  });

  it("throws when only the anon key is missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    await expect(import("@/lib/supabaseclient")).rejects.toThrow(
      /Missing Supabase environment variables/
    );
  });

  it("exports a supabase client when both vars are present", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = FAKE_KEY;

    const mod = await import("@/lib/supabaseclient");
    expect(mod.supabase).toBeDefined();
    expect(typeof mod.supabase.from).toBe("function");
  });
});
