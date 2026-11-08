// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { User } from "@supabase/auth-js";

type AuthCb = (event: string, session: { user: User } | null) => void;
let authCb: AuthCb | null = null;
const getUser = vi.fn();
const signInWithPassword = vi.fn();

vi.mock("@/lib/supabaseclient", () => ({
  supabase: {
    auth: {
      getUser: () => getUser(),
      signInWithPassword: (creds: unknown) => signInWithPassword(creds),
      onAuthStateChange: (cb: AuthCb) => {
        authCb = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));

import { useAuthState, sameAuthUser } from "@/app/hooks/useAuthState";

const mkUser = (over: Partial<User> = {}): User =>
  ({ id: "u1", email: "a@b.com", updated_at: "2026-01-01T00:00:00Z", ...over }) as User;

beforeEach(() => {
  authCb = null;
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
});

describe("sameAuthUser", () => {
  it("treats equal id/updated_at/email as the same user", () => {
    expect(sameAuthUser(mkUser(), mkUser())).toBe(true);
    expect(sameAuthUser(null, null)).toBe(true);
  });
  it("detects a different user, changed profile, or sign in/out", () => {
    expect(sameAuthUser(mkUser(), mkUser({ id: "u2" }))).toBe(false);
    expect(sameAuthUser(mkUser(), mkUser({ updated_at: "2026-02-01T00:00:00Z" }))).toBe(false);
    expect(sameAuthUser(mkUser(), mkUser({ email: "c@d.com" }))).toBe(false);
    expect(sameAuthUser(null, mkUser())).toBe(false);
    expect(sameAuthUser(mkUser(), null)).toBe(false);
  });
});

describe("useAuthState supabaseUser identity", () => {
  it("keeps the same object when auth re-emits an equivalent user (tab refocus)", async () => {
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(authCb).not.toBeNull());

    act(() => authCb!("SIGNED_IN", { user: mkUser() }));
    const first = result.current.supabaseUser;
    expect(first?.id).toBe("u1");

    act(() => authCb!("SIGNED_IN", { user: mkUser() }));
    expect(result.current.supabaseUser).toBe(first);
  });

  it("updates on a real change and clears on sign-out", async () => {
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(authCb).not.toBeNull());

    act(() => authCb!("SIGNED_IN", { user: mkUser() }));
    const first = result.current.supabaseUser;

    act(() => authCb!("USER_UPDATED", { user: mkUser({ updated_at: "2026-03-01T00:00:00Z" }) }));
    expect(result.current.supabaseUser).not.toBe(first);

    act(() => authCb!("SIGNED_OUT", null));
    expect(result.current.supabaseUser).toBeNull();
  });
});

describe("useAuthState signUp (invite-only)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    signInWithPassword.mockReset();
    signInWithPassword.mockResolvedValue({ data: { user: mkUser() }, error: null });
    vi.stubGlobal("fetch", fetchMock);
  });

  const setUp = async () => {
    const hook = renderHook(() => useAuthState());
    await waitFor(() => expect(authCb).not.toBeNull());
    act(() => { hook.result.current.setLoginEmail(" pal@example.com "); hook.result.current.setLoginPassword("hunter22"); });
    return hook;
  };

  it("sends email, password and code to /api/signup, then signs in", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = await setUp();
    await act(() => result.current.signUp("the-code"));

    expect(fetchMock).toHaveBeenCalledWith("/api/signup", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: "pal@example.com", password: "hunter22", inviteCode: "the-code" });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "pal@example.com", password: "hunter22" });
    expect(result.current.supabaseError).toBe("");
    expect(result.current.loginPassword).toBe("");
  });

  it("shows the server's error and does not sign in", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "That invite code isn't right." }), { status: 403 }));
    const { result } = await setUp();
    await act(() => result.current.signUp("wrong"));

    expect(result.current.supabaseError).toBe("That invite code isn't right.");
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(result.current.loginLoading).toBe(false);
  });

  it("reports a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = await setUp();
    await act(() => result.current.signUp("the-code"));
    expect(result.current.supabaseError).toMatch(/Couldn't reach the server/);
  });
});
