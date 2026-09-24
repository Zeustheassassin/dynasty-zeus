/**
 * Draft-outcome tiers — the six-way scale the Draft History boards grade a
 * drafted player on, replacing the old hit / neutral / bust split.
 *
 * The scale answers "what did this pick actually turn into on a dynasty
 * roster", from best to worst:
 *
 *   star     — a positional difference-maker you build around
 *   starter  — an every-week starter, not a centrepiece
 *   flex     — startable in a flex spot / matchup-dependent
 *   bench    — real bench depth, worth a roster spot
 *   clogger  — occupies a roster spot without earning it
 *   cut      — gone; the pick returned nothing
 *
 * Order is meaningful: PLAYER_TIERS is best→worst and every consumer (grade
 * buttons, stacked bars, summary rows) iterates it rather than hand-listing
 * tiers, so adding or reordering a tier is a one-line change here.
 *
 * Stored per user in `consensus_player_grades.tier_grades` (migration 055) as
 * one jsonb blob keyed `"{year}_{player_id}"`.
 */

export const PLAYER_TIERS = ["star", "starter", "flex", "bench", "clogger", "cut"] as const;

export type PlayerTier = (typeof PLAYER_TIERS)[number];

export interface TierMeta {
  /** Full name, used in tooltips, legends and summary rows. */
  label: string;
  /** One character for the compact grade buttons on a dense board row. */
  glyph: string;
  /** Text colour for the tier's own label / value. */
  text: string;
  /** Solid fill for a segment of the per-slot stacked bar. */
  bar: string;
  /** Border+fill+text for the grade button when this tier is the active one. */
  activeBtn: string;
  /** Row tint on the Consensus Board once a player carries this tier. */
  rowBg: string;
}

/**
 * Colour runs gold → emerald → sky → slate → orange → red, so the board reads
 * as one gradient from "built a roster around him" to "cut him". Slate is the
 * neutral midpoint: bench depth is neither a win nor a loss.
 */
export const TIER_META: Record<PlayerTier, TierMeta> = {
  star: {
    label: "Star", glyph: "★",
    text: "text-amber-400", bar: "bg-amber-400",
    activeBtn: "border-amber-500 bg-amber-800/70 text-amber-200",
    rowBg: "bg-amber-950/25",
  },
  starter: {
    label: "Starter", glyph: "S",
    text: "text-emerald-400", bar: "bg-emerald-500",
    activeBtn: "border-emerald-600 bg-emerald-800/70 text-emerald-300",
    rowBg: "bg-emerald-950/25",
  },
  flex: {
    label: "Flex", glyph: "F",
    text: "text-sky-400", bar: "bg-sky-500",
    activeBtn: "border-sky-600 bg-sky-800/70 text-sky-300",
    rowBg: "bg-sky-950/25",
  },
  bench: {
    label: "Bench Depth", glyph: "B",
    text: "text-slate-300", bar: "bg-slate-500",
    activeBtn: "border-slate-500 bg-slate-700 text-slate-200",
    rowBg: "bg-slate-800/30",
  },
  clogger: {
    label: "Roster Clogger", glyph: "R",
    text: "text-orange-400", bar: "bg-orange-500",
    activeBtn: "border-orange-600 bg-orange-800/70 text-orange-300",
    rowBg: "bg-orange-950/25",
  },
  cut: {
    label: "Cut", glyph: "X",
    text: "text-red-400", bar: "bg-red-500",
    activeBtn: "border-red-600 bg-red-800/70 text-red-300",
    rowBg: "bg-red-950/25",
  },
};

/**
 * Narrow an unknown (a jsonb value from Supabase, or a localStorage blob) to a
 * tier. Both stores are plain untyped JSON, and one of them now holds a RETIRED
 * scale — so a stray "hit"/"neutral"/"bust" must be rejected rather than cast.
 */
export function isPlayerTier(value: unknown): value is PlayerTier {
  return typeof value === "string" && (PLAYER_TIERS as readonly string[]).includes(value);
}

/** Drop anything that isn't a known tier from a raw stored blob. */
export function sanitizeTierMap(raw: unknown): Record<string, PlayerTier> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, PlayerTier> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isPlayerTier(value)) out[key] = value;
  }
  return out;
}

// ── Pick-slot report ────────────────────────────────────────────────────────

export type TierCounts = Record<PlayerTier, number>;

export const emptyTierCounts = (): TierCounts =>
  Object.fromEntries(PLAYER_TIERS.map((t) => [t, 0])) as TierCounts;

export interface TierReportPlayer {
  name: string;
  position: string;
  year: string;
  tier: PlayerTier;
  avgPickNo: number;
}

export interface TierReportRow {
  /** "1.05" — the pick slot this player's average draft position lands in. */
  slot: string;
  counts: TierCounts;
  /** Share of the slot in each tier, 0–1. Zero for every tier when total is 0. */
  rates: TierCounts;
  total: number;
  players: TierReportPlayer[];
}

/** One graded player, already resolved to a pick slot by the caller. */
export interface TierReportInput extends TierReportPlayer {
  slot: string;
}

/**
 * Group graded players by pick slot and count each slot's tier distribution.
 *
 * Kept free of any slot *derivation* — the caller resolves `slot` — so this
 * stays a pure grouping function with no dependency on the DraftHub's
 * `toPickSlot`, which lives in a component module.
 */
export function buildTierReport(rows: TierReportInput[]): TierReportRow[] {
  const bySlot = new Map<string, { counts: TierCounts; players: TierReportPlayer[] }>();

  for (const row of rows) {
    let entry = bySlot.get(row.slot);
    if (!entry) {
      entry = { counts: emptyTierCounts(), players: [] };
      bySlot.set(row.slot, entry);
    }
    entry.counts[row.tier]++;
    entry.players.push({
      name: row.name, position: row.position, year: row.year,
      tier: row.tier, avgPickNo: row.avgPickNo,
    });
  }

  return Array.from(bySlot.entries())
    .map(([slot, { counts, players }]) => {
      const total = PLAYER_TIERS.reduce((sum, t) => sum + counts[t], 0);
      const rates = Object.fromEntries(
        PLAYER_TIERS.map((t) => [t, total ? counts[t] / total : 0]),
      ) as TierCounts;
      return {
        slot,
        counts,
        rates,
        total,
        players: [...players].sort((a, b) => a.avgPickNo - b.avgPickNo),
      };
    })
    .sort((a, b) => compareSlots(a.slot, b.slot));
}

/** "1.12" sorts before "2.01" — compare round first, then slot, numerically. */
export function compareSlots(a: string, b: string): number {
  const [ar, as_] = a.split(".").map(Number);
  const [br, bs_] = b.split(".").map(Number);
  return (ar - br) || (as_ - bs_);
}

// ── Summary buckets ─────────────────────────────────────────────────────────

export interface SlotGroup {
  label: string;
  round: number;
  min: number;
  max: number;
}

/** The buckets the summary table's columns are rolled up into. */
export const SLOT_GROUPS: readonly SlotGroup[] = [
  { label: "Early 1st", round: 1, min: 1, max: 4 },
  { label: "Mid 1st",   round: 1, min: 5, max: 8 },
  { label: "Late 1st",  round: 1, min: 9, max: 12 },
  { label: "Early 2nd", round: 2, min: 1, max: 4 },
  { label: "Mid 2nd",   round: 2, min: 5, max: 8 },
  { label: "Late 2nd",  round: 2, min: 9, max: 12 },
  { label: "Early 3rd", round: 3, min: 1, max: 4 },
  { label: "Mid 3rd",   round: 3, min: 5, max: 8 },
  { label: "Late 3rd",  round: 3, min: 9, max: 12 },
  { label: "4th Round", round: 4, min: 1, max: 12 },
  { label: "5th+/Waiv", round: 5, min: 1, max: 999 },
];

export interface TierSummaryGroup extends SlotGroup {
  counts: TierCounts;
  total: number;
}

/**
 * Roll a per-slot report up into the SLOT_GROUPS buckets, dropping any bucket
 * nothing has been graded into yet so the summary never renders empty columns.
 *
 * The 5th+ bucket deliberately swallows every round past the 4th, including
 * waiver adds that resolve to a very late slot — the old summary matched it as
 * `round === 5` only, which silently dropped a 6th-round grade out of the
 * totals entirely.
 */
export function summarizeTiersByGroup(report: TierReportRow[]): TierSummaryGroup[] {
  return SLOT_GROUPS.map((group) => {
    const counts = emptyTierCounts();
    let total = 0;
    for (const row of report) {
      const [round, slot] = row.slot.split(".").map(Number);
      const inGroup = group.round === 5
        ? round >= 5
        : round === group.round && slot >= group.min && slot <= group.max;
      if (!inGroup) continue;
      for (const t of PLAYER_TIERS) counts[t] += row.counts[t];
      total += row.total;
    }
    return { ...group, counts, total };
  }).filter((g) => g.total > 0);
}
