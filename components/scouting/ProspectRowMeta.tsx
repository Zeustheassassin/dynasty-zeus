import { displayConference, isRedConference } from "../../lib/scouting/schoolConferences";

/**
 * A Prospects-list row's conference, after the school. Big Ten, Big 12,
 * Independents and FCS are red (isRedConference). Shown from sm up only (with
 * the school); phones are too tight for it. Renders nothing when neither the
 * prospect nor his school gives one.
 */
export function ProspectConference({ conference, school }: { conference?: string | null; school?: string | null }) {
  const conf = displayConference({ conference, school });
  if (!conf) return null;
  return (
    <span className={`text-xs whitespace-nowrap flex-shrink-0 hidden sm:block ${isRedConference(conf) ? "text-red-400 font-medium" : "text-slate-500"}`}>
      {conf}
    </span>
  );
}

/**
 * A Prospects-list row's games: "6/8G" = 6 charted of 8 logged. The charted
 * part shows from sm up only (phones keep the plain "8G") and is amber while
 * some logged games have no plays yet (the Unwatched tab lists them).
 * `charted` null = unknown (the play counts didn't load): logged only.
 * `className` is the list's own color for the games count.
 */
export function ChartedGamesCount({ logged, charted, className = "" }: { logged: number; charted: number | null; className?: string }) {
  if (logged <= 0) return null;
  const c = charted == null ? null : Math.min(charted, logged);
  const title = c == null
    ? `${logged} logged game${logged === 1 ? "" : "s"}`
    : `${c} of ${logged} logged game${logged === 1 ? "" : "s"} charted${c < logged ? ` (${logged - c} unwatched)` : ""}`;
  return (
    <span className={`text-xs whitespace-nowrap ${className}`} title={title}>
      {c != null && <span className={`hidden sm:inline ${c < logged ? "text-amber-400" : ""}`}>{c}/</span>}
      {logged}G
    </span>
  );
}
