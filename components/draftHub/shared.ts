// Shared constants, pure helpers, and local types for the DraftHub tab components.

// Canonical name normaliser lives in lib/helpers/formatting — re-exported here so the
// many DraftHub importers keep working while there is a single implementation to maintain.
import { normalizeRookieName } from "../../lib/helpers/formatting";
export { normalizeRookieName };

export { POS_COLOR as posColor, POS_BADGE as posBadge } from "../../lib/uiTheme";

export const PICK_KEY_RE = /^\d{4}-(\d+)\.(\d+)$/;

export function closestPickEquiv(playerValue: number, pickFcValues: Record<string, number>): { label: string; pickNo: number } {
  if (playerValue <= 0 || !Object.keys(pickFcValues).length) return { label: "—", pickNo: 0 };
  let bestKey = "";
  let bestDiff = Infinity;
  for (const [key, val] of Object.entries(pickFcValues)) {
    if (!PICK_KEY_RE.test(key)) continue;
    const diff = Math.abs(val - playerValue);
    if (diff < bestDiff) { bestDiff = diff; bestKey = key; }
  }
  if (!bestKey) return { label: "—", pickNo: 0 };
  const m = bestKey.match(PICK_KEY_RE)!;
  const pickNo = (parseInt(m[1]) - 1) * 12 + parseInt(m[2]);
  const label = `${m[1]}.${m[2].padStart(2, "0")}`;
  return { label, pickNo };
}

export function pickEquivColor(equivPickNo: number, draftedPickNo: number): string {
  if (equivPickNo === 0) return "text-slate-500";
  const diff = equivPickNo - draftedPickNo;
  if (diff <= -12) return "text-emerald-400";
  if (diff <= -4)  return "text-emerald-300";
  if (diff >= 12)  return "text-red-400";
  if (diff >= 4)   return "text-orange-400";
  return "text-slate-300";
}

export function toPickSlot(avgPickNo: number, teamSize = 12): string {
  const n = Math.round(avgPickNo);
  const round = Math.floor((n - 1) / teamSize) + 1;
  const slot  = ((n - 1) % teamSize) + 1;
  return `${round}.${String(slot).padStart(2, "0")}`;
}

export function valueGrade(val: number): { label: string; cls: string } {
  if (val >= 6000) return { label: "Elite",      cls: "text-amber-400 bg-amber-900/30 border-amber-700/50" };
  if (val >= 3500) return { label: "Starter",    cls: "text-emerald-400 bg-emerald-900/30 border-emerald-700/50" };
  if (val >= 1500) return { label: "Developing", cls: "text-blue-400   bg-blue-900/30   border-blue-700/50"   };
  if (val >= 500)  return { label: "Fringe",     cls: "text-orange-400 bg-orange-900/30 border-orange-700/50" };
  return               { label: "Bust",       cls: "text-red-400   bg-red-900/30    border-red-700/50"    };
}

// ── Local draft-history types ──────────────────────────────────────────────

export interface HistoryDraftPick {
  slot: string;
  pickNo: number;
  player_id: string;
  name: string;
  position: string;
  team: string;
  value: number;
  pickedByUserId: string | null;
}

export interface HistoryDraftEntry {
  leagueName: string;
  leagueId: string;
  season: string;
  draftId: string;
  picks: HistoryDraftPick[];
}

export interface SleeperDraftBasic {
  draft_id: string;
  status: string;
  season: string;
  settings?: { rounds?: number };
  rounds?: number;
}

export interface SleeperPickBasic {
  player_id: string;
  round: number;
  draft_slot: number;
  pick_no: number;
  picked_by: string | null;
  metadata?: { first_name?: string; last_name?: string; position?: string; team?: string };
}

export interface ConsensusCacheRow {
  player_id: string;
  player_name: string;
  position: string;
  team: string;
  avg_pick_no: number;
  draft_count: number;
}

export interface ConsensusHistoryPoint {
  avg_pick_no: number;
  snapshotted_at: string;
}

export interface ConsensusMoverEntry {
  player_id: string;
  name: string;
  position: string;
  team: string;
  delta: number; // positive = moved up boards (avg pick no decreased)
}

export interface GridPick {
  slot: string;
  owner_id: number | null;
  roster_id: number | null;
}
