"use client";
import { useEffect, useRef, useState } from "react";

interface ShareLinkButtonProps {
  /** Same-origin path to share, e.g. "/roster/123/8". */
  path: string;
  /** Title handed to the phone's share sheet. */
  title?: string;
  label?: string;
  className?: string;
}

/** Shares a link to a page of this app. On a phone it opens the native share sheet (Messages,
 *  etc.); on a desktop it copies the link, since there the system share dialog is more in the way
 *  than helpful. If the clipboard is blocked it falls back to a prompt showing the link to copy. */
export function ShareLinkButton({ path, title, label = "Share", className = "" }: ShareLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  const share = async () => {
    const url = new URL(path, window.location.origin).toString();
    const isPhone = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    if (isPhone && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        // Closing the share sheet rejects with AbortError — that's the user's choice, not a failure.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:border-slate-600 transition ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M13 4.5a2.5 2.5 0 1 1 .7 1.74L7.94 9.12a2.52 2.52 0 0 1 0 1.76l5.76 2.88a2.5 2.5 0 1 1-.67 1.34l-5.76-2.88a2.5 2.5 0 1 1 0-4.44l5.76-2.88A2.5 2.5 0 0 1 13 4.5Z" />
      </svg>
      <span aria-live="polite">{copied ? "Link copied" : label}</span>
    </button>
  );
}
