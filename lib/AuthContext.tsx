"use client";
import React, { createContext, useContext, useMemo } from "react";
import type { User as SupabaseUser } from "@supabase/auth-js";

interface AuthContextValue {
  /** The currently authenticated Supabase user, or null when logged out. */
  supabaseUser: SupabaseUser | null;
  /** Convenience boolean — true when a user is logged in. */
  isLoggedIn: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  supabaseUser: null,
  isLoggedIn: false,
});

export function AuthProvider({
  supabaseUser,
  children,
}: {
  supabaseUser: SupabaseUser | null;
  children: React.ReactNode;
}) {
  // Memoise so consumers don't re-render every time an unrelated piece of
  // top-level state changes (a keystroke, a sim re-run, a projection refresh).
  const value = useMemo<AuthContextValue>(
    () => ({ supabaseUser, isLoggedIn: supabaseUser !== null }),
    [supabaseUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Returns the current Supabase auth context.
 *  Must be used inside an `<AuthProvider>`. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
