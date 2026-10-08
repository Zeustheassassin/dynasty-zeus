// The opponent names a user taught by linking charted games to PFF
// (learnOpponents in opponentTier.ts), read as the caller under the
// owner-only RLS. The server's PFF matcher and game-context fill use them, so
// a game typed like one matched by hand before is read without another pick.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./fetchPlays";
import { learnOpponents, type LearnedNames } from "./opponentTier";

interface LinkedGameRow { id: string; opponent: string; pff_game_id: number | null; pff_match_status: string | null }
interface ContextOpponentRow { game_id: string; opponent_school: string | null }

export async function fetchLearnedOpponentNames(supabase: SupabaseClient): Promise<LearnedNames> {
  const [games, rows] = await Promise.all([
    fetchAllRows<LinkedGameRow>((from, to) => supabase.from("scouting_games")
      .select("id,opponent,pff_game_id,pff_match_status").in("pff_match_status", ["auto", "confirmed"]).order("id").range(from, to)),
    fetchAllRows<ContextOpponentRow>((from, to) => supabase.from("scouting_game_context")
      .select("game_id,opponent_school").not("opponent_school", "is", null).order("game_id").range(from, to)),
  ]);
  return learnOpponents(games, rows).byName;
}
