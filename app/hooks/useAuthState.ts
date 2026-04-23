"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabaseclient";
import type { User as SupabaseUser } from "@supabase/auth-js";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";

export interface Note { id: string; user_id: string; title: string; body: string; updated_at: string; }
export const LAST_LOGIN_EMAIL_KEY = "lastLoginEmail";

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
      setSupabaseUser(data.user);
      if (!data.user) setNotes([]);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      // Use session directly — avoids a second async getUser() call that races with signOut state
      setSupabaseUser(session?.user ?? null);
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

  const signUp = async () => {
    setSupabaseError("");
    setSupabaseMessage("");
    setLoginLoading(true);
    try {
      const email = loginEmail.trim();
      const { error } = await supabase.auth.signUp({ email, password: loginPassword });
      if (error) {
        setSupabaseError(error.message);
        return;
      }
      setLocalStorageItem(LAST_LOGIN_EMAIL_KEY, email);
      setSupabaseMessage("Account created. Check your email for a confirmation link, then sign in.");
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
