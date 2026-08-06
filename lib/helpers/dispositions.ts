// ============================================================
// Per-league, per-asset (player or draft pick) manual disposition helpers.
// See AssetDisposition in lib/types.ts for the value vocabulary.
// ============================================================
import type { AssetDisposition } from "../types";

/** Collapses the legacy WANT_TO_TRADE value onto its modern equivalent (SHOPPING). */
export const normalizeDisposition = (
  d: AssetDisposition | undefined
): Exclude<AssetDisposition, "WANT_TO_TRADE"> | undefined =>
  d === "WANT_TO_TRADE" ? "SHOPPING" : d;

/** Dispositions valid for assets on the user's own roster. */
export const MY_DISPOSITIONS: { value: Exclude<AssetDisposition, "WANT_TO_TRADE" | "SELL_NO" | "SELL_OK">; label: string; hint: string }[] = [
  { value: "CORE", label: "Core", hint: "Do not sell" },
  { value: "PRICEY", label: "Pricey", hint: "Most likely not going to sell" },
  { value: "SHOPPING", label: "Shopping", hint: "Small interest in selling" },
  { value: "OFFLOAD", label: "Offload", hint: "Get off my roster ASAP" },
];

/** Dispositions valid for assets on another owner's roster. */
export const OPPONENT_DISPOSITIONS: { value: Extract<AssetDisposition, "SELL_NO" | "SELL_OK">; label: string; hint: string }[] = [
  { value: "SELL_NO", label: "Not Willing", hint: "Won't trade this away" },
  { value: "SELL_OK", label: "Open to Sell", hint: "Willing to move this" },
];

/** Minimal pick shape needed to build a stable disposition key for a draft pick.
 *  Same format as components/tradeHub/finderUtils.ts's finderPickKey — that
 *  function delegates here so the two never drift apart. */
interface PickKeyLike {
  season: string | number;
  round: number;
  roster_id: number;
}
export const pickDispositionKey = (p: PickKeyLike): string =>
  `${p.season}-${p.round}-${p.roster_id}`;

/** Composite key for opponent-side dispositions (SELL_NO/SELL_OK) — scopes a tag to the
 *  specific roster it was set against, so a trade to a new team never inherits the old
 *  team's tag. roster_id (not owner_id): always present, and already in scope at every
 *  call site (OppRostersTab's oppRoster, TradeFinder's oppRoster, finderPipeline's r.oppRosterId). */
export const opponentAssetKey = (assetId: string, oppRosterId: number | string): string =>
  `${assetId}::${oppRosterId}`;
