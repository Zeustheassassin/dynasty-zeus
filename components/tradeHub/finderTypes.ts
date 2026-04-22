import type { PlayerWithValue, PickWithValue } from "./shared";

export type MarketSignal = "SELL_HIGH" | "BUY_LOW" | "LIQUID" | "NONE";

export type TradeResult = {
  give: PlayerWithValue[]; receive: PlayerWithValue[];
  givePicks: PickWithValue[]; receivePicks: PickWithValue[];
  oppName: string; oppRosterId: number;
  score: number; net: number; format: string;
  draftCapital?: boolean;
  isBuyLow?: boolean;
};
