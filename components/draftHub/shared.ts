// Shared constants, pure helpers, and local types for the DraftHub tab components.

// Canonical name normaliser lives in lib/helpers/formatting — re-exported here so the
// many DraftHub importers keep working while there is a single implementation to maintain.
import { normalizeRookieName } from "../../lib/helpers/formatting";
export { normalizeRookieName };

export const posColor: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-green-400",
  WR: "text-blue-400",
  TE: "text-yellow-400",
};

export const posBadge: Record<string, string> = {
  QB: "bg-purple-500/20 text-purple-400",
  RB: "bg-green-500/20 text-green-400",
  WR: "bg-blue-500/20 text-blue-400",
  TE: "bg-orange-500/20 text-orange-400",
};

export const PICK_KEY_RE = /^\d{4}-(\d+)\.(\d+)$/;

// Stable key for a rookie board player — uses player_id when available so that
// pre-draft players (no Sleeper ID yet) don't all collapse onto the same null key.
export const rookieKey = (r: { player_id?: string | null; name: string }): string =>
  r.player_id || `name:${normalizeRookieName(r.name)}`;

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
  if (equivPickNo === 0) return "text-gray-500";
  const diff = equivPickNo - draftedPickNo;
  if (diff <= -12) return "text-emerald-400";
  if (diff <= -4)  return "text-green-400";
  if (diff >= 12)  return "text-red-400";
  if (diff >= 4)   return "text-orange-400";
  return "text-gray-300";
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

export function fuzzyFcLookup(name: string, fcNameValues: Record<string, number>): number {
  const norm = normalizeRookieName(name);
  if (fcNameValues[norm] !== undefined) return fcNameValues[norm];
  const maxDist = norm.length <= 12 ? 1 : 2;
  let bestVal = 0, bestDist = Infinity;
  for (const [key, val] of Object.entries(fcNameValues)) {
    if (val <= 0 || Math.abs(key.length - norm.length) > maxDist) continue;
    const dist = levenshtein(norm, key);
    if (dist <= maxDist && dist < bestDist) { bestDist = dist; bestVal = val; }
  }
  return bestVal;
}

export function toPickSlot(avgPickNo: number, teamSize = 12): string {
  const n = Math.round(avgPickNo);
  const round = Math.floor((n - 1) / teamSize) + 1;
  const slot  = ((n - 1) % teamSize) + 1;
  return `${round}.${String(slot).padStart(2, "0")}`;
}

export function valueGrade(val: number): { label: string; cls: string } {
  if (val >= 6000) return { label: "Elite",      cls: "text-yellow-400 bg-yellow-900/30 border-yellow-700/50" };
  if (val >= 3500) return { label: "Starter",    cls: "text-green-400  bg-green-900/30  border-green-700/50"  };
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

export interface GridPick {
  slot: string;
  owner_id: number | null;
  roster_id: number | null;
}
