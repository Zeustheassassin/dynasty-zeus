// The signed-in caller of an API route: their Supabase user, verified with the
// auth server (never a client-supplied id), and a Supabase client that sends
// their token, so every read and write runs under their own RLS. Routes that
// spend a paid or metered upstream (PFF) call this before any upstream call.

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import { apiError, type ApiErrorBody } from "../apiHelpers";

export type AuthedCaller = { supabase: SupabaseClient; user: User };

/** The caller from `Authorization: Bearer <access token>`, or the error response to return. */
export async function requireUser(req: NextRequest): Promise<AuthedCaller | { response: NextResponse<ApiErrorBody> }> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "").trim();
  if (!token) return { response: apiError("Missing auth token", 401, "NO_AUTH") };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { response: apiError("Server misconfiguration", 500, "SERVER_MISCONFIGURED") };
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { response: apiError("Unauthorized — invalid or expired access token", 401, "UNAUTHORIZED") };
  return { supabase, user };
}
