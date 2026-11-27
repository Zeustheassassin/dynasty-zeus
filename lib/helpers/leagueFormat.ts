// ============================================================
// League format survey (stage 9 of the 2026-11-26 scouting plan)
// ============================================================
// Each of the user's leagues' format, read off the league list the app
// already loads (Sleeper's user-leagues call: roster_positions, settings,
// scoring_settings), so the survey adds no Sleeper calls and stores nothing
// (the user's question 11/26 was whether to save it in the DB with a monthly
// recheck; no: it saves no calls and settings can change before rookie
// drafts). The point is positional value per league on the Draft Hub (the
// scouting board stays tape-only); this is the survey that decision reads.
// Pure.
// ============================================================

import type { SleeperLeague } from "../types";

export type QbFormat = "SF" | "2QB" | "1QB";
export type LeagueKind = "Dynasty" | "Keeper" | "Redraft";

export interface LeagueFormat {
  leagueId: string;
  name: string;
  kind: LeagueKind;
  bestBall: boolean;
  teams: number;
  qb: QbFormat;
  /** Starting slots (everything but bench, IR and taxi). */
  starters: number;
  /** Each starting slot type's count, in Sleeper's names (QB, RB, WR, TE, FLEX, SUPER_FLEX, REC_FLEX, WRRB_FLEX, K, DEF, IDP…). */
  slots: Record<string, number>;
  wr: number;
  rb: number;
  te: number;
  /** Non-superflex flex slots: FLEX + WR/TE (REC_FLEX) + WR/RB (WRRB_FLEX). */
  flex: number;
  /** Points per reception. */
  ppr: number;
  /** TE premium: points per TE reception on top of PPR. */
  tep: number;
  passTd: number;
  /** Points per carry (rush_att). */
  ppc: number;
  /** Points per first down (rushing / receiving), when the league scores them. */
  firstDown: number;
  bench: number;
  taxi: number;
  rookieRounds: number | null;
}

const NOT_STARTING = new Set(["BN", "IR", "TAXI"]);
const FLEX_SLOTS = ["FLEX", "REC_FLEX", "WRRB_FLEX"];

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const kindOf = (type: number | undefined): LeagueKind => (type === 2 ? "Dynasty" : type === 1 ? "Keeper" : "Redraft");

/** One league's format. A missing scoring key counts as 0, as Sleeper scores it. */
export function leagueFormat(l: SleeperLeague): LeagueFormat {
  const positions = l.roster_positions ?? [];
  const slots: Record<string, number> = {};
  let bench = 0;
  for (const p of positions) {
    if (p === "BN") bench++;
    if (NOT_STARTING.has(p)) continue;
    slots[p] = (slots[p] ?? 0) + 1;
  }
  const s = l.scoring_settings ?? {};
  const qbSlots = slots.QB ?? 0;
  return {
    leagueId: l.league_id,
    name: l.name,
    kind: kindOf(l.settings?.type),
    bestBall: l.settings?.best_ball === 1,
    teams: l.total_rosters || l.settings?.num_teams || 0,
    qb: (slots.SUPER_FLEX ?? 0) > 0 ? "SF" : qbSlots >= 2 ? "2QB" : "1QB",
    starters: Object.values(slots).reduce((a, b) => a + b, 0),
    slots,
    wr: slots.WR ?? 0,
    rb: slots.RB ?? 0,
    te: slots.TE ?? 0,
    flex: FLEX_SLOTS.reduce((a, k) => a + (slots[k] ?? 0), 0),
    ppr: n(s.rec),
    tep: n(s.bonus_rec_te),
    passTd: n(s.pass_td),
    ppc: n(s.rush_att),
    firstDown: Math.max(n(s.rush_fd), n(s.rec_fd)),
    bench,
    taxi: n(l.settings?.taxi_slots),
    rookieRounds: l.settings?.draft_rounds ?? null,
  };
}

/** The survey's columns, in order: what the summary counts and the table compares to the most common value. */
export const FORMAT_FIELDS = [
  { key: "teams", label: "Teams" },
  { key: "qb", label: "QB" },
  { key: "starters", label: "Starters" },
  { key: "wr", label: "WR" },
  { key: "flex", label: "Flex" },
  { key: "ppr", label: "PPR" },
  { key: "tep", label: "TEP" },
  { key: "passTd", label: "Pass TD" },
  { key: "ppc", label: "PPC" },
  { key: "firstDown", label: "1st down" },
  { key: "rookieRounds", label: "Rookie rds" },
] as const satisfies readonly { key: keyof LeagueFormat; label: string }[];
export type FormatField = (typeof FORMAT_FIELDS)[number]["key"];

/** A field's value as shown: "SF", "0.5", "6", "—" for none. */
export function formatValue(f: LeagueFormat, key: FormatField): string {
  const v = f[key];
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
  return v;
}

export interface FieldCount { value: string; leagues: number }

/** Per field, how many leagues have each value, most common first (ties: the lower value first). */
export function formatSummary(formats: readonly LeagueFormat[]): Record<FormatField, FieldCount[]> {
  const out = {} as Record<FormatField, FieldCount[]>;
  for (const { key } of FORMAT_FIELDS) {
    const counts = new Map<string, number>();
    for (const f of formats) {
      const v = formatValue(f, key);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    out[key] = [...counts].map(([value, leagues]) => ({ value, leagues }))
      .sort((a, b) => b.leagues - a.leagues || a.value.localeCompare(b.value, undefined, { numeric: true }));
  }
  return out;
}

/** The most common value per field, which the table's other values stand out against. */
export function usualFormat(summary: Record<FormatField, FieldCount[]>): Record<FormatField, string | null> {
  const out = {} as Record<FormatField, string | null>;
  for (const { key } of FORMAT_FIELDS) out[key] = summary[key][0]?.value ?? null;
  return out;
}

/** The starting lineup in a line: "QB 1 · RB 2 · WR 3 · TE 1 · FLEX 2 · SF 1". */
export function lineupText(f: LeagueFormat): string {
  const order = ["QB", "RB", "WR", "TE", "FLEX", "WRRB_FLEX", "REC_FLEX", "SUPER_FLEX"];
  const label: Record<string, string> = { SUPER_FLEX: "SF", WRRB_FLEX: "W/R", REC_FLEX: "W/T" };
  const rest = Object.keys(f.slots).filter((k) => !order.includes(k)).sort();
  return [...order, ...rest].filter((k) => f.slots[k]).map((k) => `${label[k] ?? k} ${f.slots[k]}`).join(" · ");
}
