// ============================================================
// POST /api/signup — invite-only account creation
// ============================================================
// The only way a new account gets made. Public sign-up is turned OFF in Supabase (Authentication →
// "Allow new users to sign up"), so the anon key in the browser can't create users; this route
// checks the owner's invite code (SIGNUP_INVITE_CODE) and then creates the user with the service
// role, whose admin API that setting doesn't block. No code configured = sign-ups closed.
//
// Accounts are created already confirmed, matching the project's existing setting (Supabase had
// "Confirm email" off — mailer_autoconfirm — before this route existed), so the browser signs
// straight in afterwards. Existing accounts are never read or touched here.
//
// The code is checked before anything else, so without it the route says nothing about which
// emails exist. Rate limited per IP to slow guessing (5/min — per warm instance in production,
// see lib/rateLimit.ts), so the code should be long enough that guessing is hopeless anyway.
// ============================================================

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { configuredInviteCode, inviteCodeMatches } from "@/lib/server/inviteCode";
import { logger } from "@/lib/logger";

const log = logger("api/signup");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Supabase's default minimum. bcrypt ignores everything past 72 bytes, so longer is refused. */
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 72;

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 5, 60_000, "signup");
  if (!rl.allowed) return rl.response;

  const expected = configuredInviteCode();
  if (!expected) return fail("New accounts are closed right now.", 403);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object") return fail("Bad request.", 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return fail("Bad request.", 400);
  }

  if (!inviteCodeMatches(body.inviteCode, expected)) {
    return fail("That invite code isn't right.", 403);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email) || email.length > 254) return fail("Enter a valid email address.", 400);
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD) return fail(`Password must be at least ${MIN_PASSWORD} characters.`, 400);
  if (password.length > MAX_PASSWORD) return fail(`Password must be at most ${MAX_PASSWORD} characters.`, 400);

  const admin = getSupabaseAdmin();
  if (!admin) {
    log.error("sign-up attempted with a valid code but SUPABASE_SERVICE_ROLE_KEY is not configured");
    return fail("Account creation isn't available right now.", 503);
  }

  try {
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) {
      const status = typeof error.status === "number" ? error.status : 500;
      // A 4xx from Supabase is about the input (email already registered, weak password) — say so.
      if (status >= 400 && status < 500) return fail(error.message, status);
      log.error("createUser failed", { status, err: error.message });
      return fail("Couldn't create the account. Try again in a minute.", 502);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("createUser threw", { err: String(err) });
    return fail("Couldn't create the account. Try again in a minute.", 502);
  }
}
