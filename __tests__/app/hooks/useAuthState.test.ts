// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { User } from "@supabase/auth-js";

type AuthCb = (event: string, session: { user: User } | null) => void;
let authCb: AuthCb | null = null;
const getUser = vi.fn();

vi.mock("@/lib/supabaseclient", () => ({
  supabase: {
    auth: {
      getUser: () => getUser(),
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
