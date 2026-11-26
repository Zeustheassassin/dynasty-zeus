// ============================================================
// /board/{token} — public, shareable Big Board for one draft class
// ============================================================
// No login. The token (migration 105) names one user's board for one class
// year; the rows are the class's All board as of the owner's last Big Board
// visit (lib/scouting/sharedBoard.ts). Read on the server through
// get_shared_big_board, then handed to the client view for sorting.
// ============================================================

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicBigBoardView from "@/components/PublicBigBoardView";
import { loadSharedBoard } from "@/lib/server/sharedBoard";
import { SHARE_TOKEN_RE } from "@/lib/scouting/sharedBoard";

// Always the latest saved rows: the owner's board rewrites them while it's open.
export const dynamic = "force-dynamic";

interface BoardPageProps {
  params: Promise<{ token: string }>;
}

const FALLBACK_TITLE = "Big Board · DynastyZeus";

export async function generateMetadata({ params }: BoardPageProps): Promise<Metadata> {
  // Shared links are for the people they're sent to, not for search engines.
  const base: Metadata = { title: FALLBACK_TITLE, robots: { index: false, follow: false } };
  const { token } = await params;
  if (!SHARE_TOKEN_RE.test(token)) return base;
  const result = await loadSharedBoard(token);
  if (result.status !== "ready") return base;
  const { classYear, rows } = result.board;
  const title = `${classYear} Big Board · DynastyZeus`;
  const description = `${rows.length} prospects in the ${classYear} class, ranked, with how much of each one's tape has been charted.`;
  return { ...base, title, description, openGraph: { title, description, siteName: "DynastyZeus" } };
}

export default async function BoardPage({ params }: BoardPageProps) {
  const { token } = await params;
  if (!SHARE_TOKEN_RE.test(token)) notFound();
  const result = await loadSharedBoard(token);
  return <PublicBigBoardView token={token} result={result} />;
}
