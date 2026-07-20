import type { PlayerWithValue, PickWithValue } from "./shared";

export type MarketSignal = "SELL_HIGH" | "BUY_LOW" | "LIQUID" | "NONE";

// AUTO = today's direction-engine-driven behavior. TANK/CONTEND are manual overrides that
// force the finder into a full sell-everything-for-picks/youth or buy-everything-for-vets
// posture, regardless of what the direction engine actually computed for this team.
export type FinderStrategyOverride = "AUTO" | "TANK" | "CONTEND";

export type TradeResult = {
  give: PlayerWithValue[]; receive: PlayerWithValue[];
  givePicks: PickWithValue[]; receivePicks: PickWithValue[];
  oppName: string; oppRosterId: number;
  score: number; net: number; format: string;
  draftCapital?: boolean;
  isBuyLow?: boolean;
  // A sub-700 goodwill piece appended to the give side BECAUSE this opponent already rosters
  // that exact player on ≥2 of their other dynasty leagues. It is value-neutral — excluded
  // from all value math (isBalanced, net, badge) — and only nudges acceptance scoring.
  sweetenerPlayerId?: string;
};

// The give side with any value-neutral sweetener stripped out. EVERY scoring term that reads
// give-side value, direction-fit, disposition, or acceptance must use this (not raw trade.give)
// so the sweetener stays a pure +4 acceptance nudge and never leaks into the rest of scoring.
// (Roster-mechanics like lineup safety intentionally keep the raw give — the piece really moves.)
export const valueBearingGive = (trade: TradeResult): PlayerWithValue[] =>
  trade.sweetenerPlayerId
    ? trade.give.filter((p) => p.player_id !== trade.sweetenerPlayerId)
    : trade.give;
