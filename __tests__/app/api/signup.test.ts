// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async (): Promise<unknown> => ({ allowed: true, remaining: 4 })),
  createUser: vi.fn(),
  admin: { current: null as unknown },
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => h.admin.current }));

import { POST } from "@/app/api/signup/route";
import { inviteCodeMatches, configuredInviteCode } from "@/lib/server/inviteCode";

const CODE = "zeus-friends-only-2026";

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

const good = { email: "  pal@example.com ", password: "hunter22", inviteCode: CODE };

beforeEach(() => {
  vi.stubEnv("SIGNUP_INVITE_CODE", CODE);
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
  h.createUser.mockReset();
  h.createUser.mockResolvedValue({ data: { user: { id: "new" } }, error: null });
  h.admin.current = { auth: { admin: { createUser: h.createUser } } };
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/signup", () => {
  it("creates a confirmed account with the right code", async () => {
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.createUser).toHaveBeenCalledWith({ email: "pal@example.com", password: "hunter22", email_confirm: true });
  });

  it("is closed when no invite code is configured", async () => {
    vi.stubEnv("SIGNUP_INVITE_CODE", "");
    const res = await post(good);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/closed/);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("refuses a wrong or missing code before looking at anything else", async () => {
    for (const inviteCode of ["nope", "", undefined, 123, CODE.toUpperCase()]) {
      const res = await post({ email: "not-an-email", password: "x", inviteCode });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/invite code/);
    }
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("accepts the code with stray spaces around it", async () => {
    const res = await post({ ...good, inviteCode: `  ${CODE} ` });
    expect(res.status).toBe(200);
  });

  it("checks email and password once the code is right", async () => {
    expect((await post({ ...good, email: "pal" })).status).toBe(400);
    expect((await post({ ...good, password: "12345" })).status).toBe(400);
    expect((await post({ ...good, password: "x".repeat(73) })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("passes Supabase's own input errors through (email already registered)", async () => {
    h.createUser.mockResolvedValue({
      data: { user: null },
      error: { status: 422, message: "A user with this email address has already been registered" },
    });
    const res = await post(good);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/already been registered/);
  });

  it("hides server-side failures behind a generic message", async () => {
    h.createUser.mockResolvedValue({ data: { user: null }, error: { status: 500, message: "db exploded" } });
    const res = await post(good);
    expect(res.status).toBe(502);
    expect((await res.json()).error).not.toMatch(/db exploded/);

    h.createUser.mockRejectedValue(new Error("network"));
    expect((await post(good)).status).toBe(502);
  });

  it("answers 503 when the service role isn't configured", async () => {
    h.admin.current = null;
    expect((await post(good)).status).toBe(503);
  });

  it("returns the rate limiter's response when over the limit", async () => {
    const { NextResponse } = await import("next/server");
    h.checkRateLimit.mockResolvedValue({ allowed: false, response: NextResponse.json({ error: "slow down" }, { status: 429 }) });
    expect((await post(good)).status).toBe(429);
    expect(h.createUser).not.toHaveBeenCalled();
  });
});

describe("inviteCodeMatches / configuredInviteCode", () => {
  it("matches only the exact code (case-sensitive, trimmed)", () => {
    expect(inviteCodeMatches(CODE, CODE)).toBe(true);
    expect(inviteCodeMatches(` ${CODE}\n`, CODE)).toBe(true);
    expect(inviteCodeMatches(CODE.toUpperCase(), CODE)).toBe(false);
    expect(inviteCodeMatches(CODE.slice(0, -1), CODE)).toBe(false);
    expect(inviteCodeMatches("", CODE)).toBe(false);
    expect(inviteCodeMatches(null, CODE)).toBe(false);
    expect(inviteCodeMatches(CODE, "")).toBe(false);
  });

  it("reads the env var, treating blank as no code", () => {
    vi.stubEnv("SIGNUP_INVITE_CODE", `  ${CODE}  `);
    expect(configuredInviteCode()).toBe(CODE);
    vi.stubEnv("SIGNUP_INVITE_CODE", "   ");
    expect(configuredInviteCode()).toBeNull();
  });
});
