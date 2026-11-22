"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../../../lib/supabaseclient";
import { logger } from "../../../../lib/logger";
import { BASE_YEAR } from "../../../../lib/helpers/season";
import type { Prospect, ScoutingGame } from "../../../../lib/types";
import { preGradeIsMirrored } from "../../../../lib/scouting/preGradeMirror";
import { unrankUpdates } from "../../../../lib/scouting/rankReorder";
import { FORTY_WEIGHT_MAX, FORTY_WEIGHT_MIN } from "../../../../lib/scouting/speedFloor";
import { useDeferredDataChanged } from "./useDeferredDataChanged";

const log = logger("scouting/shared/useChartingState");

// Board tabs that render data derived from the hub's own load: the report's Overview, and
// Breakdown (the AE Score pieces and the radar charts, plus WR's Core SAE / open % by
// alignment). Production reads PFF over the charted games, which charting doesn't change.
const DEFAULT_FRESH_DATA_TABS: readonly string[] = ["overview", "breakdown"];

interface Options {
  /** The hub's reload. Boards should call the returned `markDataDirty()` instead of this directly. */
  onDataChanged: () => void;
  onDeleteGamePlays?: (gameId: string) => void;
  /**
   * Tabs that read hub-derived data and so need a reload when writes are pending. Must be a
   * stable reference (module constant). Default: overview + breakdown.
   */
  freshDataTabs?: readonly string[];
  /**
   * Open on Chart Game with this game picked (Scouting → Unwatched). Read once,
   * at mount; a game that isn't his (deleted since) falls back to his first.
   */
  initialGameId?: string | null;
}

export function useChartingState(prospect: Prospect, options: Options) {
  const { onDataChanged, onDeleteGamePlays, freshDataTabs = DEFAULT_FRESH_DATA_TABS, initialGameId } = options;

  const [tab, setTab]                         = useState<string>(initialGameId ? "chart" : "overview");
  // Deferred hub reload (see useDeferredDataChanged): every write below calls markDataDirty().
  const { markDirty: markDataDirty }          = useDeferredDataChanged(onDataChanged, tab, freshDataTabs);
  const [games, setGames]                     = useState<ScoutingGame[]>([]);
  const [selectedGameId, setSelectedGameId]   = useState<string | null>(initialGameId ?? null);
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
      forty_time: prospect.forty_time ?? null, forty_source: prospect.forty_source ?? null, forty_weight: prospect.forty_weight ?? null,
      draft_class_year: prospect.draft_class_year, personal_rank: prospect.personal_rank,
      should_play: prospect.should_play, will_play_pre: prospect.will_play_pre,
      will_play_post: prospect.will_play_post, charting_decision: prospect.charting_decision,
      charting_notes: prospect.charting_notes,
      draft_round: prospect.draft_round, draft_pick: prospect.draft_pick, draft_team: prospect.draft_team,
      pre_draft_grade: prospect.pre_draft_grade, post_draft_grade: prospect.post_draft_grade,
    });
  }, [loadGames, prospect.id, prospect.name, prospect.school, prospect.height, prospect.weight, prospect.birthday,
    prospect.forty_time, prospect.forty_source, prospect.forty_weight,
    prospect.draft_class_year, prospect.personal_rank,
    prospect.should_play, prospect.will_play_pre, prospect.will_play_post,
    prospect.charting_decision, prospect.charting_notes,
    prospect.draft_round, prospect.draft_pick, prospect.draft_team,
    prospect.pre_draft_grade, prospect.post_draft_grade]);

  useEffect(() => {
    if (games.length === 0) return;
    // No game picked yet, or the picked one isn't among his (an Unwatched link to
    // a game deleted since): his first game.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedGameId || !games.some((g) => g.id === selectedGameId)) setSelectedGameId(games[0].id);
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
      markDataDirty();
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
    markDataDirty();
  }

  async function updateGame(id: string, updates: Partial<Pick<ScoutingGame, "opponent" | "season_year" | "game_type">>) {
    const cleaned: Partial<ScoutingGame> = {};
    if (updates.opponent !== undefined) cleaned.opponent = updates.opponent.trim();
    if (updates.season_year !== undefined) cleaned.season_year = updates.season_year;
    if (updates.game_type !== undefined) cleaned.game_type = updates.game_type;
    if (Object.keys(cleaned).length === 0) return;
    const before = games.find((g) => g.id === id);
    const movedGame = before != null && (
      (cleaned.opponent !== undefined && cleaned.opponent !== before.opponent)
      || (cleaned.season_year !== undefined && cleaned.season_year !== before.season_year));
    const { error } = await supabase.from("scouting_games").update(cleaned).eq("id", id);
    if (error) { log.error("scouting_games update failed", { err: error.message }); return; }
    setGames((prev) => prev.map((g) => g.id === id ? { ...g, ...cleaned } as ScoutingGame : g));
    markDataDirty();
    // A new season or opponent makes the game's PFF match stale (migration
    // 062): clear it so the next PFF Links run matches it again. Its own
    // request, so a database without 062 only logs a warning here.
    if (movedGame) {
      const { error: pffErr } = await supabase.from("scouting_games")
        .update({ pff_game_id: null, pff_match_status: null, pff_match_note: null }).eq("id", id);
      if (pffErr) log.warn("scouting_games PFF link reset failed", { err: pffErr.message });
    }
  }

  // Blank or 0 in Personal Rank: off the position rank, and the rest of his
  // position + class ladder moves up one (unrankUpdates), in one
  // set_prospect_ranks call (migration 098). Null on success.
  async function unrankOnServer(): Promise<string | null> {
    const { data, error } = await supabase
      .from("prospects")
      .select("id, position, draft_class_year, personal_rank")
      .eq("position", prospect.position)
      .eq("draft_class_year", prospect.draft_class_year)
      .not("personal_rank", "is", null);
    if (error) {
      log.error("rank ladder load failed", { err: error.message });
      return "Couldn't remove his rank — please try again.";
    }
    const ladder = (data ?? []) as Pick<Prospect, "id" | "position" | "draft_class_year" | "personal_rank">[];
    const updates = unrankUpdates(ladder, prospect.id, "personal_rank");
    if (updates.size === 0) return null;
    const { error: rpcErr } = await supabase.rpc("set_prospect_ranks", { p_ranks: Object.fromEntries(updates) });
    if (rpcErr) {
      log.error("unrank failed (needs migration 098)", { err: rpcErr.message, code: rpcErr.code });
      return "Couldn't remove his rank — please try again.";
    }
    return null;
  }

  async function saveBio() {
    setSavingBio(true);
    setGameError(null);
    // A Pre grade that mirrors the Dynasty Score is the Big Board's to write:
    // left out, so a Bio save can't put back an older value.
    // The 40 (migration 099) goes in its own request, and only when it changed,
    // so a database without 099 can't fail the rest of the bio.
    const { forty_time, forty_source, forty_weight, ...fields } = bio;
    const time = forty_time ?? null;
    const source = time == null ? null : forty_source ?? "combine";
    const weighIn = time == null ? null : forty_weight ?? null;
    if (weighIn != null && (weighIn < FORTY_WEIGHT_MIN || weighIn > FORTY_WEIGHT_MAX)) {
      setSavingBio(false);
      setGameError(`Weighed must be ${FORTY_WEIGHT_MIN}–${FORTY_WEIGHT_MAX} lbs, or blank for his bio weight.`);
      return;
    }
    if (preGradeIsMirrored(prospect, new Date())) delete fields.pre_draft_grade;
    // Blank or 0 = no rank. Taking a ranked prospect off goes first, on the
    // class ladder he's ranked in now (before a class change below lands).
    if ("personal_rank" in fields && !fields.personal_rank) {
      if (prospect.personal_rank != null) {
        const err = await unrankOnServer();
        if (err) {
          setSavingBio(false);
          setGameError(err);
          return;
        }
        delete fields.personal_rank; // written just above
        markDataDirty();
      } else {
        fields.personal_rank = null;
      }
    }
    const { error } = await supabase
      .from("prospects")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", prospect.id);
    if (error) {
      // Keep the edit form open so the user's unsaved changes aren't lost and
      // they can see it didn't save, rather than silently closing on failure.
      setSavingBio(false);
      log.error("prospects bio update failed", { err: error.message });
      setGameError("Couldn't save changes — please try again.");
      return;
    }
    const stored = prospect.forty_time ?? null;
    const changed = time !== stored
      || source !== (stored == null ? null : prospect.forty_source ?? "combine")
      || weighIn !== (stored == null ? null : prospect.forty_weight ?? null);
    if (changed) {
      const { error: fortyErr } = await supabase
        .from("prospects").update({ forty_time: time, forty_source: source, forty_weight: weighIn }).eq("id", prospect.id);
      if (fortyErr) {
        setSavingBio(false);
        log.error("prospects 40 time update failed", { err: fortyErr.message });
        setGameError("Saved, except the 40 time (is migration 099 applied?) — please try again.");
        markDataDirty();
        return;
      }
    }
    setSavingBio(false);
    setEditBio(false);
    markDataDirty();
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
    /** Record a write; the hub reload is deferred (see useDeferredDataChanged). */
    markDataDirty,
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
