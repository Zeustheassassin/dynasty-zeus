"use client";
import React from "react";
import type { User as SupabaseUser } from "@supabase/auth-js";

interface AuthSectionProps {
  supabaseUser: SupabaseUser | null;
  loginEmail: string;
  setLoginEmail: (v: string) => void;
  loginPassword: string;
  setLoginPassword: (v: string) => void;
  supabaseError: string;
  setSupabaseError: (v: string) => void;
  supabaseMessage: string;
  loginLoading: boolean;
  resetLoading: boolean;
  showLoginPassword: boolean;
  setShowLoginPassword: React.Dispatch<React.SetStateAction<boolean>>;
  signIn: () => void;
  signUp: () => void;
  resetPassword: () => void;
}

export function AuthSection({
  supabaseUser,
  loginEmail, setLoginEmail,
  loginPassword, setLoginPassword,
  supabaseError, setSupabaseError,
  supabaseMessage,
  loginLoading,
  resetLoading,
  showLoginPassword, setShowLoginPassword,
  signIn, signUp, resetPassword,
}: AuthSectionProps) {
  if (supabaseUser) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-full max-w-sm shadow-2xl" style={{ position: "relative", zIndex: 10000 }}>
        <h2 className="text-xl font-bold mb-1 text-center">DynastyZeus</h2>
        <p className="text-sm text-gray-400 text-center mb-6">Sign in to your account</p>
        {supabaseError && <div className="text-red-400 text-sm mb-3">{supabaseError}</div>}
        {supabaseMessage && <div className="text-emerald-400 text-sm mb-3">{supabaseMessage}</div>}
        <form
          className="space-y-3"
          autoComplete="on"
          onSubmit={(e) => {
            e.preventDefault();
            signIn();
          }}
        >
          <input
            id="email"
            name="email"
            className="w-full p-2.5 rounded-lg bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:border-blue-500"
            placeholder="Email"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={loginEmail}
            onChange={(e) => {
              setLoginEmail(e.target.value);
              if (supabaseError) setSupabaseError("");
            }}
          />
          <div className="relative">
            <input
              id="password"
              name="password"
              className="w-full p-2.5 pr-20 rounded-lg bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:border-blue-500"
              type={showLoginPassword ? "text" : "password"}
              placeholder="Password"
              autoComplete="current-password"
              value={loginPassword}
              onChange={(e) => {
                setLoginPassword(e.target.value);
                if (supabaseError) setSupabaseError("");
              }}
            />
            <button
              type="button"
              onClick={() => setShowLoginPassword((prev) => !prev)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-white transition"
            >
              {showLoginPassword ? "Hide" : "Show"}
            </button>
          </div>
          <button
            type="submit"
            disabled={loginLoading}
            className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-lg text-sm font-semibold transition"
          >
            {loginLoading ? "Signing in…" : "Sign In"}
          </button>
          <button
            type="button"
            disabled={resetLoading || loginLoading}
            className="w-full py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-60 rounded-lg text-sm font-semibold transition"
            onClick={(e) => { e.stopPropagation(); resetPassword(); }}
          >
            {resetLoading ? "Sending reset email..." : "Reset Password"}
          </button>
          <button
            type="button"
            disabled={loginLoading}
            className="w-full py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-60 rounded-lg text-sm font-semibold transition"
            onClick={(e) => { e.stopPropagation(); signUp(); }}
          >
            {loginLoading ? "Working..." : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
