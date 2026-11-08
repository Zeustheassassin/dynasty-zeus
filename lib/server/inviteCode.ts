// ============================================================
// Invite-code check for account creation — SERVER-ONLY.
// ============================================================
// The app is personal: new accounts need the owner's invite code (SIGNUP_INVITE_CODE, a Vercel env
// var only the owner sets). See app/api/signup/route.ts and HANDOFF §6 "Invite-only sign-up".
// ============================================================

import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** The configured invite code, or null when none is set — which means sign-ups are closed. */
export function configuredInviteCode(): string | null {
  const code = process.env.SIGNUP_INVITE_CODE?.trim();
  return code ? code : null;
}

/** True when `given` is the invite code. Both sides are hashed first so the buffers are always the
 *  same length (timingSafeEqual throws otherwise) and the comparison takes the same time whatever
 *  was typed. Surrounding spaces are ignored; case is not. */
export function inviteCodeMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || !expected) return false;
  const trimmed = given.trim();
  if (!trimmed) return false;
  return timingSafeEqual(digest(trimmed), digest(expected));
}
