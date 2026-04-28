import type { SleeperTransaction } from "../../lib/types";

export interface StandingRow {
  roster_id: number;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  max_pf: number;
  owner_id: string;
}

export type AnnotatedTransaction = SleeperTransaction & {
  leagueName: string;
  leagueId: string;
  rosterOwnerMap: Record<number, string>;
};

export interface TeamSummary {
  summary: Record<string, number>;
  pickSummary: Record<string, number>;
}

export interface PredictedPick {
  name: string;
  position: string;
  team: string;
  adp: number;
  player_id: string | null | undefined;
  boardRank: number;
  poolRank: number;
}

export interface DraftPoolRanks {
  byPlayerId: Record<string, number>;
  byName:     Record<string, number>;
}
