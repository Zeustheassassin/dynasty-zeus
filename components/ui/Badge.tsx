import type { ReactNode } from "react";
import { STATUS_CLASSES } from "../../lib/uiTheme";

type Tone = keyof typeof STATUS_CLASSES | "neutral";

const NEUTRAL = "border-slate-700 bg-slate-800/70 text-slate-300";

interface BadgeProps {
  children: ReactNode;
  /** Omit when the caller already has its own established color logic
   *  (e.g. direction-bucket colors) and just wants the pill shape/sizing —
   *  pass those colors via `className` instead. */
  tone?: Tone;
  className?: string;
}

/** Shared status/tag pill — replaces the hand-written `rounded-full` spans
 *  duplicated across trade, alert, and roster-tag UI. */
export default function Badge({ children, tone, className = "" }: BadgeProps) {
  const toneClass = tone ? (tone === "neutral" ? NEUTRAL : STATUS_CLASSES[tone]) : "";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${toneClass} ${className}`}
    >
      {children}
    </span>
  );
}
