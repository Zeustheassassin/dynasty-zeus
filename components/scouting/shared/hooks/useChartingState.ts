"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../../../lib/supabaseclient";
import { logger } from "../../../../lib/logger";
import { BASE_YEAR } from "../../../../lib/helpers/season";
import type { Prospect, ScoutingGame } from "../../../../lib/types";

const log = logger("scouting/shared/useChartingState");

interface Options {
  onDataChanged: () => void;
  onDeleteGamePlays?: (gameId: string) => void;
}

export function useChartingState(prospect: Prospect, options: Options) {
  const { onDataChanged, onDeleteGamePlays } = options;

  const [tab, setTab]                         = useState<string>("overview");
  const [games, setGames]                     = useState<ScoutingGame[]>([]);
  const [selectedGameId, setSelectedGameId]   = useState<string | null>(null);
  const [loading, setLoading]                 = useState(true);
  const [showAddGame, setShowAddGame]         = useState(false);
  const [newGame, setNewGame]                 = useState({ year: BASE_YEAR, opponent: "", type: "regular" });
  const [savingGame, setSavingGame]           = useState(false);
  const [gameError, setGameError]             = useState<string | null>(null);
  const [editBio, setEditBio]                 = useState(false);
  const [bio, setBio]                         = useState<Partial<Prospect>>({});
  const [savingBio, setSavingBio]             = useState(false);

  const loadGames = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("scouting_games")
      .select("*")
      .eq("prospect_id", prospect.id)
      .order("season_year", { ascending: false })
      .order("game_slot");
    if (error) { log.error("scouting_games load failed", { err: error.message }); }
    else { setGames((data ?? []) as ScoutingGame[]); }
    setLoading(false);
  }, [prospect.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGames();
    setBio({
      name: prospect.name,
      school: prospect.school,
      height: prospect.height, weight: prospect.weight, birthday: prospect.birthday,
      draft_class_year: prospect.draft_class_year, personal_rank: prospect.personal_rank,
      should_play: prospect.should_play, will_play_pre: prospect.will_play_pre,
      will_play_post: prospect.will_play_post, charting_decision: prospect.charting_decision,
      charting_notes: prospect.charting_notes,
      draft_round: prospect.draft_round, draft_pick: prospect.draft_pick, draft_team: prospect.draft_team,
    });
  }, [loadGames, prospect.id, prospect.name, prospect.school, prospect.height, prospect.weight, prospect.birthday,
    prospect.draft_class_year, prospect.personal_rank,
    prospect.should_play, prospect.will_play_pre, prospect.will_play_post,
    prospect.charting_decision, prospect.charting_notes,
    prospect.draft_round, prospect.draft_pick, prospect.draft_team]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedGameId && games.length > 0) setSelectedGameId(games[0].id);
  }, [games, selectedGameId]);

  async function addGame() {
    if (!newGame.opponent.trim()) return;
    setGameError(null);
    setSavingGame(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setGameError("Not logged in."); setSavingGame(false); return; }
    const slot = games.filter((g) => g.season_year === newGame.year).length + 1;
    const { data, error } = await supabase.from("scouting_games").insert({
      user_id: user.id, prospect_id: prospect.id,
      season_year: newGame.year, opponent: newGame.opponent.trim(),
      game_slot: slot, game_type: newGame.type,
    }).select().single();
    if (error) { setGameError(error.message); }
    else if (data) {
      setGames((prev) => [...prev, data as ScoutingGame]);
      setSelectedGameId(data.id as string);
      setNewGame((n) => ({ ...n, opponent: "" }));
      setShowAddGame(false);
      onDataChanged();
    }
    setSavingGame(false);
  }

  async function deleteGame(id: string) {
    // Check the error BEFORE mutating local state — otherwise a failed delete
    // still removes the game (and its plays) from the UI while they live on in
    // the DB (phantom success), and the user thinks their data is gone.
    const { error } = await supabase.from("scouting_games").delete().eq("id", id);
    if (error) {
      log.error("scouting_games delete failed", { err: error.message });
      setGameError("Couldn't delete that game — please try again.");
      return;
    }
    setGames((prev) => prev.filter((g) => g.id !== id));
    onDeleteGamePlays?.(id);
    if (selectedGameId === id) setSelectedGameId(games.find((g) => g.id !== id)?.id ?? null);
    onDataChanged();
  }

  async function updateGame(id: string, updates: Partial<Pick<ScoutingGame, "opponent" | "season_year" | "game_type">>) {
    const cleaned: Partial<ScoutingGame> = {};
    if (updates.opponent !== undefined) cleaned.opponent = updates.opponent.trim();
    if (updates.season_year !== undefined) cleaned.season_year = updates.season_year;
    if (updates.game_type !== undefined) cleaned.game_type = updates.game_type;
    if (Object.keys(cleaned).length === 0) return;
    const { error } = await supabase.from("scouting_games").update(cleaned).eq("id", id);
    if (error) { log.error("scouting_games update failed", { err: error.message }); return; }
    setGames((prev) => prev.map((g) => g.id === id ? { ...g, ...cleaned } as ScoutingGame : g));
    onDataChanged();
  }

  async function saveBio() {
    setSavingBio(true);
    setGameError(null);
    const { error } = await supabase
      .from("prospects")
      .update({ ...bio, updated_at: new Date().toISOString() })
      .eq("id", prospect.id);
    setSavingBio(false);
    if (error) {
      // Keep the edit form open so the user's unsaved changes aren't lost and
      // they can see it didn't save, rather than silently closing on failure.
      log.error("prospects bio update failed", { err: error.message });
      setGameError("Couldn't save changes — please try again.");
      return;
    }
    setEditBio(false);
    onDataChanged();
  }

  const selectedGame = games.find((g) => g.id === selectedGameId) ?? null;

  return {
    // State
    tab, games, selectedGameId, selectedGame, loading,
    showAddGame, newGame, savingGame, gameError,
    editBio, bio, savingBio,
    // Raw setters (for boards that need fine-grained control)
    setTab, setSelectedGameId, setGames, setBio,
    // Helpers
    loadGames,
    // ChartingBoard-compatible handler props
    onTabChange:      (t: string) => setTab(t),
    onSelectGame:     (id: string) => setSelectedGameId(id),
    onToggleAddGame:  () => setShowAddGame((s) => !s),
    onNewGameChange:  (update: Partial<{ year: number; opponent: string; type: string }>) =>
                        setNewGame((n) => ({ ...n, ...update })),
    onAddGame:        addGame,
    onDeleteGame:     deleteGame,
    onUpdateGame:     updateGame,
    onToggleEditBio:  () => setEditBio((e) => !e),
    onBioChange:      (update: Partial<Prospect>) => setBio((b) => ({ ...b, ...update })),
    onSaveBio:        saveBio,
  };
}
