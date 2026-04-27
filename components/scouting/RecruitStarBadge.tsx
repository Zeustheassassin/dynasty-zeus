"use client";
import type { RecruitRow } from "../../lib/recruiting/cfd";

const STAR_TEXT: Record<number, string> = {
  5: "text-yellow-400",
  4: "text-amber-300",
  3: "text-gray-400",
  2: "text-gray-500",
};

const STAR_BG: Record<number, string> = {
  5: "border-yellow-500/60 bg-yellow-500/10",
  4: "border-amber-400/50 bg-amber-400/10",
  3: "border-gray-500/40 bg-gray-500/10",
  2: "border-gray-600/40 bg-gray-600/10",
};

/** Inline pill showing the matched recruit's star rating + 247 Composite overall rank.
 *  Renders nothing if no match. */
export default function RecruitStarBadge({ recruit }: { recruit: RecruitRow | null }) {
  if (!recruit || !recruit.stars) return null;
  const stars = recruit.stars;
  const tooltip = [
    recruit.ranking ? `247 Composite #${recruit.ranking}` : null,
    recruit.school ? `HS: ${recruit.school}` : null,
    recruit.committed_to ? `Committed: ${recruit.committed_to}` : null,
    `Class: ${recruit.year}`,
  ].filter(Boolean).join(" · ");
  return (
    <span
      title={tooltip}
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 whitespace-nowrap ${STAR_TEXT[stars] ?? "text-gray-400"} ${STAR_BG[stars] ?? "border-gray-700"}`}
    >
      {stars}★{recruit.ranking ? <> <span className="text-gray-400 font-normal">#{recruit.ranking}</span></> : null}
    </span>
  );
}
