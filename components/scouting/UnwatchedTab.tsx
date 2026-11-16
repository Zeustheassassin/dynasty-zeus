"use client";
// Scouting → Unwatched: every logged game with no charted plays yet, by
// prospect (lib/scouting/unwatchedGames.ts). Clicking a game opens his board on
// Chart Game with that game picked. Each game's Tape field records where its
// tape is (scouting_games.tape_source, migration 101).

import { useId, useMemo, useState } from "react";
import type { Prospect, ScoutingGame } from "../../lib/types";
import { POS_COLOR } from "../../lib/uiTheme";
import {
  TAPE_SOURCE_MAX,
  countUnwatched,
  normalizeTapeSource,
  tapeLink,
  type UnwatchedGroup,
} from "../../lib/scouting/unwatchedGames";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

const GAME_TYPE_LABEL: Record<string, string> = { bowl: "Bowl", playoff: "Playoff" };

interface Props {
  /** Prospects with an unwatched game, already grouped and sorted (ScoutingHub). */
  groups: UnwatchedGroup<Prospect>[];
  /** Every class on the board, for the Class filter. */
  years: number[];
  loading: boolean;
  /** The per-game play counts didn't load: nothing can be called unwatched. */
  failed: boolean;
  draftYearFilter: number | null;
  setDraftYearFilter: (y: number | null) => void;
  onOpenGame: (prospect: Prospect, gameId: string) => void;
  /** Where a game's tape is: saved this session, else as loaded. */
  tapeSourceOf: (game: ScoutingGame) => string | null;
  /** Sources already used, for the Tape field's suggestions. */
  tapeSuggestions: string[];
  /** Saves a game's tape source (null clears it); resolves to an error message, or null. */
  onSaveTapeSource: (gameId: string, source: string | null) => Promise<string | null>;
}

function loggedOn(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

const chip = (on: boolean) =>
  `px-3 py-1 rounded text-xs font-medium transition ${on ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`;

export default function UnwatchedTab({
  groups, years, loading, failed, draftYearFilter, setDraftYearFilter, onOpenGame,
  tapeSourceOf, tapeSuggestions, onSaveTapeSource,
}: Props) {
  const [position, setPosition] = useState<string | null>(null);
  const listId = useId();

  const inClass = useMemo(
    () => (draftYearFilter == null ? groups : groups.filter((g) => g.prospect.draft_class_year === draftYearFilter)),
    [groups, draftYearFilter],
  );
  const shown = position == null ? inClass : inClass.filter((g) => g.prospect.position === position);
  const gamesShown = countUnwatched(shown);
  const byPosition = (pos: string) => countUnwatched(inClass.filter((g) => g.prospect.position === pos));

  return (
    <div className="space-y-3 max-w-4xl mx-auto">
      <p className="text-xs text-slate-400">
        Games you&apos;ve logged that have no charted plays yet. A logged game counts in a prospect&apos;s games
        (the G on his row) as soon as it&apos;s added, so these are the ones that make that number run ahead of what
        you&apos;ve charted. Click a game to open it on Chart Game. Note where each one&apos;s tape is in its Tape box
        (e.g. Dynasty Nerds, or paste a link); it saves when you leave the box or press Enter.
      </p>
      <datalist id={listId}>
        {tapeSuggestions.map((s) => <option key={s} value={s} />)}
      </datalist>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-400">Class:</span>
        <button onClick={() => setDraftYearFilter(null)} aria-pressed={draftYearFilter == null} className={chip(draftYearFilter == null)}>All</button>
        {years.map((y) => (
          <button key={y} onClick={() => setDraftYearFilter(y)} aria-pressed={draftYearFilter === y} className={chip(draftYearFilter === y)}>
            {y}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-400">Pos:</span>
        <button onClick={() => setPosition(null)} aria-pressed={position == null} className={chip(position == null)}>
          All {countUnwatched(inClass)}
        </button>
        {POSITIONS.map((pos) => (
          <button key={pos} onClick={() => setPosition(pos)} aria-pressed={position === pos} className={chip(position === pos)}>
            {pos} {byPosition(pos)}
          </button>
        ))}
      </div>

      {failed ? (
        <div className="rounded border border-red-800 bg-red-900/30 px-3 py-2 text-xs text-red-300">
          Couldn&apos;t load the play counts per game, so unwatched games can&apos;t be told apart. Reload the page to try again.
        </div>
      ) : loading && groups.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500">
          Every logged game{draftYearFilter != null ? ` in the ${draftYearFilter} class` : ""}{position ? ` for ${position}s` : ""} has charted plays.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500" aria-live="polite">
            {gamesShown} {gamesShown === 1 ? "game" : "games"} across {shown.length} {shown.length === 1 ? "prospect" : "prospects"}
          </p>
          <ul className="space-y-2">
            {shown.map(({ prospect: p, games, logged }) => (
              <li key={p.id} className="rounded border border-slate-800 bg-slate-900/40 px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-semibold text-white">{p.name}</span>
                  <span className={`text-xs font-semibold ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</span>
                  <span className="text-xs text-slate-400">{p.school} · {p.draft_class_year}</span>
                  <span className="ml-auto text-xs text-slate-400" title="Games with charted plays, of every game logged for him">
                    Charted <span className="font-semibold text-slate-200">{logged - games.length}</span> of {logged} games
                  </span>
                </div>
                <ul className="mt-1.5 space-y-1.5">
                  {games.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <GameButton game={g} onClick={() => onOpenGame(p, g.id)} />
                      <TapeField game={g} value={tapeSourceOf(g)} listId={listId} onSave={onSaveTapeSource} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function GameButton({ game, onClick }: { game: ScoutingGame; onClick: () => void }) {
  const type = GAME_TYPE_LABEL[game.game_type];
  const logged = loggedOn(game.created_at);
  return (
    <button
      onClick={onClick}
      title="Open on Chart Game"
      className="flex items-baseline gap-1.5 rounded border border-amber-800/60 bg-amber-950/20 px-2 py-1 text-xs text-amber-200 transition hover:border-amber-500 hover:text-white"
    >
      <span className="text-amber-400/80">{game.season_year}</span>
      <span className="font-medium">{game.opponent || "Unknown opponent"}</span>
      {type && <span className="text-[11px] text-amber-400/80">{type}</span>}
      {logged && <span className="text-[11px] text-slate-500">logged {logged}</span>}
      <span aria-hidden="true" className="text-slate-500">→</span>
    </button>
  );
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

/** Where the game's tape is. Saves on leaving the box or Enter; Escape puts back what's saved. */
function TapeField({ game, value, listId, onSave }: {
  game: ScoutingGame;
  value: string | null;
  listId: string;
  onSave: (gameId: string, source: string | null) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const link = tapeLink(value);

  async function commit() {
    const next = normalizeTapeSource(draft);
    if (next === normalizeTapeSource(value)) { setDraft(value ?? ""); return; }
    setState({ kind: "saving" });
    const error = await onSave(game.id, next);
    if (error) { setState({ kind: "error", message: error }); return; }
    setDraft(next ?? "");
    setState({ kind: "saved" });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <label className="flex items-center gap-1.5">
        <span className="text-slate-500">Tape</span>
        <input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); if (state.kind !== "saving") setState({ kind: "idle" }); }}
          onBlur={() => { void commit(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") { setDraft(value ?? ""); setState({ kind: "idle" }); }
          }}
          list={listId}
          maxLength={TAPE_SOURCE_MAX}
          placeholder="Where's the tape?"
          aria-label={`Where the tape is: ${game.season_year} ${game.opponent}`}
          className="w-48 rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
      </label>
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
          Open ↗
        </a>
      )}
      <span aria-live="polite" className="text-[11px]">
        {state.kind === "saving" && <span className="text-slate-400">Saving…</span>}
        {state.kind === "saved" && <span className="text-emerald-400">Saved</span>}
        {state.kind === "error" && <span className="text-red-400">{state.message}</span>}
      </span>
    </div>
  );
}
