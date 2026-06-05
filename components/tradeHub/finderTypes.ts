import type { PlayerWithValue, PickWithValue } from "./shared";

export type MarketSignal = "SELL_HIGH" | "BUY_LOW" | "LIQUID" | "NONE";

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
