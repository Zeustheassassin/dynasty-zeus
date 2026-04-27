// /api/recruiting/[year]
//   GET   → returns the cached recruits + meta for that year (no CFD call)
//   POST  → fetches the full year from CFD, replaces the cached rows in Supabase,
//           updates meta. Use sparingly — counts against CFD's 1000 calls/month tier.
//
// The CFD key never leaves the server. Writes to Supabase happen with the caller's
// auth token (RLS allows any authenticated user to write — recruits is shared cache).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { apiError, parseIntParam } from "../../../../lib/apiHelpers";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { fetchCfdRecruits, toRecruitRow, type RecruitRow } from "../../../../lib/recruiting/cfd";

export const maxDuration = 60;

const YEAR_MIN = 2017;
const YEAR_MAX = new Date().getFullYear() + 1;

function getAuthedClient(accessToken: string) {
  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Supabase env vars missing");
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });
}

function parseYear(raw: string): number | null {
  return parseIntParam(raw, YEAR_MIN, YEAR_MAX);
}

// ── GET: cached recruits for a year ──────────────────────────────────────────
export async function GET(req: NextRequest, ctx: { params: Promise<{ year: string }> }) {
  const rl = await checkRateLimit(req, 60, 60_000, "recruiting-read");
  if (!rl.allowed) return rl.response;

  const { year: yearStr } = await ctx.params;
  const year = parseYear(yearStr);
  if (year == null) return apiError(`Year must be ${YEAR_MIN}-${YEAR_MAX}`, 400, "INVALID_YEAR");

  const accessToken = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!accessToken) return apiError("Missing auth token", 401, "NO_AUTH");

  const supabase = getAuthedClient(accessToken);
  const [recruitsRes, metaRes] = await Promise.all([
    supabase
      .from("recruits")
      .select("*")
      .eq("year", year)
      .order("ranking", { ascending: true, nullsFirst: false }),
    supabase
      .from("recruits_meta")
      .select("*")
      .eq("year", year)
      .maybeSingle(),
  ]);

  if (recruitsRes.error) return apiError(recruitsRes.error.message, 500, "DB_ERROR");
  if (metaRes.error)     return apiError(metaRes.error.message, 500, "DB_ERROR");

  return NextResponse.json({
    year,
    recruits: recruitsRes.data ?? [],
    meta:     metaRes.data ?? null,
  });
}

// ── POST: refresh from CFD, replace cached rows ──────────────────────────────
export async function POST(req: NextRequest, ctx: { params: Promise<{ year: string }> }) {
  // Tighter limit on writes — protects the CFD monthly quota
  const rl = await checkRateLimit(req, 10, 60_000, "recruiting-refresh");
  if (!rl.allowed) return rl.response;

  const { year: yearStr } = await ctx.params;
  const year = parseYear(yearStr);
  if (year == null) return apiError(`Year must be ${YEAR_MIN}-${YEAR_MAX}`, 400, "INVALID_YEAR");

  const accessToken = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!accessToken) return apiError("Missing auth token", 401, "NO_AUTH");

  const cfdKey = process.env.CFD_API_KEY;
  if (!cfdKey) return apiError("CFD_API_KEY not configured", 500, "MISSING_CFD_KEY");

  // 1. Fetch from CFD
  let cfdRecruits;
  try {
    cfdRecruits = await fetchCfdRecruits(year, cfdKey);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "CFD fetch failed", 502, "CFD_ERROR");
  }

  // 2. Normalize → row shape (drop entries missing id or name)
  const rows: RecruitRow[] = cfdRecruits.map(toRecruitRow).filter((r): r is RecruitRow => r !== null);
  if (rows.length === 0) {
    return apiError("CFD returned 0 valid records for this year", 502, "CFD_EMPTY");
  }

  // 3. Replace this year's cache (delete + insert in batches under one auth context)
  const supabase = getAuthedClient(accessToken);

  const { error: deleteErr } = await supabase.from("recruits").delete().eq("year", year);
  if (deleteErr) return apiError(`Failed to clear ${year} cache: ${deleteErr.message}`, 500, "DB_ERROR");

  // Supabase has a payload size ceiling — batch in 500-row chunks
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error: insertErr } = await supabase.from("recruits").insert(batch);
    if (insertErr) {
      return apiError(`Insert failed at batch ${i}: ${insertErr.message}`, 500, "DB_ERROR");
    }
  }

  // 4. Update meta
  const { data: { user } } = await supabase.auth.getUser();
  const { data: metaRow, error: metaErr } = await supabase
    .from("recruits_meta")
    .upsert({
      year,
      last_refreshed_at: new Date().toISOString(),
      total_records:     rows.length,
      refreshed_by:      user?.id ?? null,
    }, { onConflict: "year" })
    .select()
    .single();

  if (metaErr) return apiError(`Meta upsert failed: ${metaErr.message}`, 500, "DB_ERROR");

  return NextResponse.json({ year, total_records: rows.length, meta: metaRow });
}
