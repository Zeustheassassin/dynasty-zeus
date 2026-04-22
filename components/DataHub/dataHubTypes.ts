export interface ShareEntry { count: number; leagues: string[]; starters: string[] }
export interface ExposureEntry { playerId: string; count: number; percent: number }
export interface ExposureData { players: ExposureEntry[]; leagueCount: number }
export interface CrossLeaguePick { season: string; round: number; roster_id: number; owner_id: number }
export interface FetchedRoster { owner_id?: string | null; roster_id?: number; players?: string[]; taxi?: string[] }
export interface FetchedUser { user_id?: string; display_name?: string }
export interface ExternalLeague { settings?: { best_ball?: number } }
