"use client";
import { useEffect, useRef, useState } from "react";
import { ShareLinkButton } from "../shared/ShareLinkButton";
import { boardSharePath, type BoardShare } from "../../lib/scouting/sharedBoard";

interface BoardShareControlProps {
  /** The Class filter: one year to share, or null for every class. */
  year: number | null;
  /** That year's link, once there is one. */
  share: BoardShare | undefined;
  /** The user's links: still loading, the table isn't there (migration 105), or loaded. */
  status: "loading" | "missing" | "ready";
  /** Every input behind the board's numbers has loaded, so the rows are safe to save. */
  ready: boolean;
  /** Save the year's rows and make its link; resolves with the token, or null if it failed. */
  onCreate: (year: number) => Promise<string | null>;
}

const BTN = "inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:border-slate-600 transition disabled:opacity-40 disabled:cursor-not-allowed";

/** The Big Board's link to a public, read-only copy of one class's All board (/board/{token}). */
export default function BoardShareControl({ year, share, status, ready, onCreate }: BoardShareControlProps) {
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<{ text: string; failed?: boolean } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

  const flash = (text: string, failed = false) => {
    setNote({ text, failed });
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), failed ? 6000 : 4000);
  };

  if (status !== "ready" || year == null) {
    const why = status === "missing" ? "Sharing needs migration 105 (big_board_shares)"
      : status === "loading" ? "Loading your shared links…"
      : "Pick a class year to share its board";
    return (
      <button type="button" disabled className={BTN} title={why}>
        Share board
      </button>
    );
  }

  if (share) {
    return (
      <span className="inline-flex items-center gap-2">
        <ShareLinkButton path={boardSharePath(share.token)} title={`${year} Big Board`} label={`Share ${year} board`} />
        <a href={boardSharePath(share.token)} target="_blank" rel="noopener noreferrer"
          title="Open the shared page as others see it. It updates while this board is open."
          className="text-xs text-slate-400 underline hover:text-white">View</a>
        {note && <span role="status" className={`text-xs ${note.failed ? "text-red-400" : "text-teal-300"}`}>{note.text}</span>}
      </span>
    );
  }

  async function create(y: number) {
    setCreating(true);
    const token = await onCreate(y);
    setCreating(false);
    if (!token) { flash("Couldn't make the link. Try again.", true); return; }
    // The click that made the link is spent by now, so some browsers refuse the
    // copy; the Share button that replaces this one copies on the next click.
    try {
      await navigator.clipboard.writeText(new URL(boardSharePath(token), window.location.origin).toString());
      flash("Link copied");
    } catch {
      flash("Link ready: click Share to copy it");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={!ready || creating} onClick={() => { void create(year); }} className={BTN}
        title={ready
          ? `Make a read-only link to the ${year} class's full board (every position, OVR order). It stays up to date while this board is open.`
          : "Waiting for the board to finish loading"}>
        {creating ? "Making link…" : `Share ${year} board`}
      </button>
      {note && <span role="status" className={`text-xs ${note.failed ? "text-red-400" : "text-teal-300"}`}>{note.text}</span>}
    </span>
  );
}
