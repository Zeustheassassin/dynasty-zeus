"use client";
import React, { createContext, useContext } from "react";
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
  return (
    <AuthContext.Provider value={{ supabaseUser, isLoggedIn: supabaseUser !== null }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Returns the current Supabase auth context.
 *  Must be used inside an `<AuthProvider>`. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
