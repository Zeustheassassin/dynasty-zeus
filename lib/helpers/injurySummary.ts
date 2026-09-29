// ============================================================
// Plain-English injury summaries for the Alert Hub's Injury Report — built
// from structured fields with templates, no AI. "Based on reports, Jordyn
// Tyson is on injured reserve (designated to return) with a right hamstring
// strain." + "Projected return: Oct 11 (about 2 weeks)".
//
// Also classifies statuses that aren't injuries: Sleeper tags a healthy
// scratch as Out with injury_body_part "Coach's Decision" (45 of 77 skill
// players listed Out on 2026-09-29 were scratches), plus "Personal" and
// suspension tags. They stay on the report (a scratched "Out" can be
// IR-eligible) but get their own badge and aren't counted as injured.
// ============================================================
import type { InjuryDetail } from "./espnInjuryDetail";

export type NonInjuryReason = "scratch" | "personal" | "suspension";

interface SleeperInjuryFields {
  injury_status?: string | null;
  injury_body_part?: string | null;
  injury_notes?: string | null;
}

/**
 * Why a player is listed without being hurt, or null when it's an injury (or
 * nothing is known). IR and PUP keep their own meaning even when the tag says
 * otherwise — Sleeper has a PUP player tagged "Personal".
 */
export function nonInjuryReason(p: SleeperInjuryFields): NonInjuryReason | null {
  const status = (p.injury_status ?? "").toLowerCase();
  if (status === "ir" || status === "pup") return null;
  const tag = `${p.injury_body_part ?? ""} ${p.injury_notes ?? ""}`.toLowerCase();
  if (/coach'?s decision/.test(tag)) return "scratch";
  if (status === "sus" || /suspen/.test(tag)) return "suspension";
  if (/personal|not injury related/.test(tag)) return "personal";
  return null;
}

// "Knee - ACL" → "knee (ACL)"; keeps acronyms, lowercases words.
function injuryName(type: string): string {
  const [base, ...rest] = type.split(/\s+-\s+/);
  const word = (w: string) => (w === w.toUpperCase() && w.length <= 4 ? w : w.toLowerCase());
  const sub = rest.join(" - ");
  return sub ? `${base.toLowerCase()} (${word(sub)})` : base.toLowerCase();
}

const article = (phrase: string) => (/^[aeiou]/i.test(phrase) ? "an" : "a");

/** "a right hamstring strain", "a left knee (ACL) injury that required surgery",
 *  "a concussion", "an undisclosed injury". Null when there's nothing to say. */
export function describeInjury(type?: string | null, side?: string | null, detail?: string | null): string | null {
  if (!type) return null;
  const t = type.trim();
  if (/^undisclosed$/i.test(t)) return "an undisclosed injury";
  if (/^illness$/i.test(t)) return "an illness";
  if (/^concussion$/i.test(t)) return "a concussion";
  const s = side && /^(left|right)$/i.test(side) ? `${side.toLowerCase()} ` : "";
  const name = injuryName(t);
  const d = detail?.trim();
  let phrase: string;
  if (!d) phrase = `${s}${name} injury`;
  else if (/^surgery$/i.test(d)) phrase = `${s}${name} injury that required surgery`;
  else if (d.toLowerCase() === t.toLowerCase()) phrase = `${s}${name}`;
  else phrase = `${s}${name} ${d.toLowerCase()}`;
  return `${article(phrase)} ${phrase}`;
}

/** Status words after "is". Sleeper and ESPN spell them differently. */
function statusPhrase(status: string | null | undefined, fantasyStatus?: string | null): string | null {
  const s = (status ?? "").trim().toLowerCase();
  const f = (fantasyStatus ?? "").toUpperCase();
  if (f.startsWith("PUP") || s === "pup") return "on the PUP list";
  if (s === "injured reserve" || s === "ir") {
    return f === "IR-R" ? "on injured reserve (designated to return)" : "on injured reserve";
  }
  if (s === "out") return "out";
  if (s === "doubtful") return "doubtful";
  if (s === "questionable") return "questionable";
  if (s === "day-to-day") return "day-to-day";
  if (s === "suspension" || s === "sus") return "suspended";
  if (s === "" || s === "active" || s === "na") return null;
  return s;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function formatDate(iso: string, today: Date): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const md = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === today.getUTCFullYear() ? md : `${md}, ${d.getUTCFullYear()}`;
}

/**
 * "Projected return: Oct 25 (about 4 weeks)". Past the regular season (Week 18
 * wraps up around Jan 10) it says so instead of counting weeks; a date that
 * has already gone by is flagged rather than read as "any day now".
 */
export function describeReturn(returnDate: string | null | undefined, season: number | undefined, today: Date): string | null {
  if (!returnDate || !/^\d{4}-\d{2}-\d{2}/.test(returnDate)) return null;
  const ret = Date.parse(`${returnDate.slice(0, 10)}T00:00:00Z`);
  const when = formatDate(returnDate, today);
  const days = Math.round((ret - utcDay(today)) / DAY_MS);
  if (days <= 0) return `Projected return was ${when} — no newer timeline reported`;
  if (season && ret > Date.UTC(season + 1, 0, 11)) return `Projected return: ${when} — likely out for the rest of the regular season`;
  if (days < 7) return `Projected return: ${when} (within a week)`;
  const weeks = Math.round(days / 7);
  return `Projected return: ${when} (about ${weeks} week${weeks === 1 ? "" : "s"})`;
}

export interface InjurySummary {
  /** The one-sentence summary. */
  headline: string;
  /** Projected-return line, when a date is known. */
  returnLine: string | null;
  /** Where the facts came from — "ESPN" (with its report date) or "Sleeper". */
  source: "ESPN" | "Sleeper";
  /** ESPN's report date, formatted ("Sep 28"). */
  reportedOn: string | null;
  latestNews: string | null;
  moreNews: string | null;
}

/**
 * The summary for one player. ESPN's record (when found) supplies the injury,
 * timeline and news; Sleeper's fields cover everyone ESPN doesn't. A scratch,
 * personal absence or suspension is said plainly — never dressed up as an
 * injury.
 */
export function buildInjurySummary(
  name: string,
  sleeper: SleeperInjuryFields,
  espn: InjuryDetail | null,
  today: Date = new Date(),
): InjurySummary {
  const hasEspn = !!espn?.found;
  const reason =
    nonInjuryReason(sleeper) ??
    (hasEspn && /coach'?s decision/i.test(`${espn!.type ?? ""} ${espn!.shortComment ?? ""}`) ? "scratch" : null);
  // ESPN's status is fresher, but "Active" there just means its record is stale.
  const espnStatus = hasEspn && !/^active$/i.test(espn!.status ?? "") ? espn!.status : null;
  const status = statusPhrase(espnStatus ?? sleeper.injury_status, hasEspn ? espn!.fantasyStatus : null);

  let headline: string;
  if (reason === "scratch") {
    headline = `Based on reports, ${name} was a healthy scratch (coach's decision) — not injured.`;
  } else if (reason === "personal") {
    headline = `Based on reports, ${name} is ${status ?? "out"} for personal reasons — not an injury.`;
  } else if (reason === "suspension") {
    headline = `Based on reports, ${name} is suspended — not an injury.`;
  } else {
    const injury =
      (hasEspn ? describeInjury(espn!.type, espn!.side, espn!.detail) : null) ??
      describeInjury(sleeper.injury_body_part, null, sleeper.injury_notes);
    const lead = hasEspn ? "Based on reports" : "Based on Sleeper's injury feed";
    if (status && injury) headline = `${lead}, ${name} is ${status} with ${injury}.`;
    else if (status) headline = `${lead}, ${name} is ${status}; the injury hasn't been specified.`;
    else if (injury) headline = `${lead}, ${name} is dealing with ${injury}.`;
    else headline = `No injury details have been reported for ${name}.`;
  }

  return {
    headline,
    returnLine: reason ? null : describeReturn(hasEspn ? espn!.returnDate : null, espn?.season, today),
    source: hasEspn ? "ESPN" : "Sleeper",
    reportedOn: hasEspn && espn!.date ? formatDate(espn!.date, today) : null,
    latestNews: hasEspn ? espn!.shortComment ?? null : null,
    moreNews: hasEspn ? espn!.longComment ?? null : null,
  };
}
