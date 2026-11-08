"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabaseclient";
import type { User as SupabaseUser } from "@supabase/auth-js";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";

export interface Note { id: string; user_id: string; title: string; body: string; updated_at: string; }
export const LAST_LOGIN_EMAIL_KEY = "lastLoginEmail";

/**
 * auth-js re-emits SIGNED_IN (with a fresh user object) on every tab refocus.
 * Consumers key ~15 effects on the supabaseUser object, so keep the previous
 * reference unless something the app reads actually changed.
 */
export function sameAuthUser(a: SupabaseUser | null, b: SupabaseUser | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.updated_at === b.updated_at && a.email === b.email;
}

export function useAuthState() {
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [, setNotes] = useState<Note[]>([]);
  const [supabaseError, setSupabaseError] = useState("");
  const [supabaseMessage, setSupabaseMessage] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  useEffect(() => {
    const rememberedEmail = getLocalStorageItem(LAST_LOGIN_EMAIL_KEY, "");
    if (rememberedEmail) setLoginEmail(rememberedEmail);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setSupabaseUser((prev) => (sameAuthUser(prev, data.user) ? prev : data.user));
      if (!data.user) setNotes([]);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      // Use session directly — avoids a second async getUser() call that races with signOut state
      const next = session?.user ?? null;
      setSupabaseUser((prev) => (sameAuthUser(prev, next) ? prev : next));
      if (!session?.user) setNotes([]);
    });
    return () => subscription?.subscription?.unsubscribe?.();
  }, []);

  const loadNotes = useCallback(async () => {
    if (!supabaseUser) { setNotes([]); return; }
    const { data, error } = await supabase
      .from("notes")
      .select("*")
      .eq("user_id", supabaseUser.id)
      .order("updated_at", { ascending: false });
    if (error) setSupabaseError(error.message);
    else setNotes(data ?? []);
  }, [supabaseUser]);

  // Invite-only: Supabase's public sign-up is off, so accounts are made by /api/signup, which checks
  // the owner's invite code server-side. The account comes back already confirmed (the project never
  // required email confirmation), so this signs straight in.
  const signUp = async (inviteCode: string) => {
    setSupabaseError("");
    setSupabaseMessage("");
    setLoginLoading(true);
    try {
      const email = loginEmail.trim();
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: loginPassword, inviteCode }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setSupabaseError(body?.error || "Couldn't create the account. Try again in a minute.");
        return;
      }
      setLocalStorageItem(LAST_LOGIN_EMAIL_KEY, email);
      const { error } = await supabase.auth.signInWithPassword({ email, password: loginPassword });
      if (error) {
        setSupabaseMessage("Account created. Sign in with your email and password.");
        return;
      }
      // onAuthStateChange sets supabaseUser, which closes the sign-in screen.
      setShowLoginPassword(false);
      setLoginPassword("");
    } catch {
      setSupabaseError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoginLoading(false);
    }
  };

  const signIn = async () => {
    setSupabaseError("");
    setSupabaseMessage("");
    setLoginLoading(true);
    try {
      const email = loginEmail.trim();
      const signInPromise = supabase.auth.signInWithPassword({
        email,
        password: loginPassword,
      });
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Request timed out — check your internet or Supabase project status.")),
          10000
        );
      });
      const result = await Promise.race([
        signInPromise.then((r) => { clearTimeout(timeoutId); return r; }),
        timeoutPromise,
      ]);
      const { data, error } = result;
      if (error) {
        setSupabaseError(error.message || error.name || "Sign-in failed. Check your credentials.");
        return;
      }
      if (data?.user) {
        setLocalStorageItem(LAST_LOGIN_EMAIL_KEY, email);
        setSupabaseMessage(`Welcome back, ${data.user.email || email}.`);
        // Don't manually set supabaseUser here — onAuthStateChange fires and sets it,
        // and the useEffect([supabaseUser]) will load all persisted data once state updates.
        setShowLoginPassword(false);
        setLoginPassword("");
      } else {
        setSupabaseError("Sign-in failed — no user returned. Check your credentials or confirm your email.");
      }
    } catch (err: unknown) {
      setSupabaseError((err as { message?: string })?.message || "Unexpected error — check your internet connection.");
    } finally {
      setLoginLoading(false);
    }
  };

  const resetPassword = async () => {
    setSupabaseError("");
    setSupabaseMessage("");
    const email = loginEmail.trim();
    if (!email) {
      setSupabaseError("Enter your email first, then use reset password.");
      return;
    }
    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/`,
      });
      if (error) {
        setSupabaseError(error.message);
        return;
      }
      setLocalStorageItem(LAST_LOGIN_EMAIL_KEY, email);
      setSupabaseMessage("Password reset email sent. Check your inbox and spam folder.");
    } finally {
      setResetLoading(false);
    }
  };

  return {
    supabaseUser,
    setSupabaseUser,
    loginEmail, setLoginEmail,
    loginPassword, setLoginPassword,
    setNotes,
    supabaseError, setSupabaseError,
    supabaseMessage, setSupabaseMessage,
    loginLoading, setLoginLoading,
    resetLoading, setResetLoading,
    showLoginPassword, setShowLoginPassword,
    loadNotes,
    signUp, signIn, resetPassword,
  };
}
