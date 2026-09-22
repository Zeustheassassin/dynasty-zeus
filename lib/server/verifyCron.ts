import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import type { logger } from "@/lib/logger";

/** Verifies a cron request's `Authorization: Bearer ${CRON_SECRET}` header.
 *  Returns a NextResponse to return immediately on failure (500 if CRON_SECRET
 *  isn't configured, 401 on a bad/missing token), or null when authorized. */
export function verifyCron(req: NextRequest, log: ReturnType<typeof logger>): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error("CRON_SECRET env var is not set — refusing to run");
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  }
  // Constant-time comparison so a timing side-channel can't reveal the secret.
  // timingSafeEqual throws on length mismatch, so guard the length first.
  const authBuf = Buffer.from(req.headers.get("authorization") ?? "");
  const expectedBuf = Buffer.from(`Bearer ${expected}`);
  if (authBuf.length !== expectedBuf.length || !timingSafeEqual(authBuf, expectedBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
