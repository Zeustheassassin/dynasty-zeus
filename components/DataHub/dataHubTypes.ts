export interface ShareEntry { count: number; leagues: string[]; starters: string[] }
export interface ExposureEntry { playerId: string; count: number; percent: number }
export interface ExposureData { players: ExposureEntry[]; leagueCount: number }
export interface FetchedRoster { owner_id?: string | null; roster_id?: number; players?: string[]; taxi?: string[] }
export interface FetchedUser { user_id?: string; display_name?: string }
