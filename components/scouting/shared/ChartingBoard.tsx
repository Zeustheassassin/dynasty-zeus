"use client";
import { useState } from "react";
import type { Prospect, ScoutingGame, ChartingDecision } from "../../../lib/types";
import { GAME_TYPES, CHARTING_DECISIONS } from "./chartingConstants";

export interface ChartingBoardConfig {
  positionLabel: string;
  accentColor: "blue" | "green";
  nflRoles: string[];
}

export interface ChartingBoardProps {
  prospect: Prospect;
  config: ChartingBoardConfig;
  tabs: { key: string; label: string }[];
  // Shared UI state
  tab: string;
  games: ScoutingGame[];
  selectedGameId: string | null;
  loading: boolean;
  gamePlayCounts: Record<string, number>;
  showAddGame: boolean;
  newGame: { year: number; opponent: string; type: string };
  savingGame: boolean;
  gameError: string | null;
  editBio: boolean;
  bio: Partial<Prospect>;
  savingBio: boolean;
  // Shared handlers
  onBack: () => void;
  onTabChange: (tab: string) => void;
  onSelectGame: (id: string) => void;
  onToggleAddGame: () => void;
  onNewGameChange: (update: Partial<{ year: number; opponent: string; type: string }>) => void;
  onAddGame: () => void;
  onDeleteGame: (id: string) => void;
  onUpdateGame: (id: string, updates: Partial<{ opponent: string; season_year: number; game_type: string }>) => void | Promise<void>;
  onToggleEditBio: () => void;
  onBioChange: (update: Partial<Prospect>) => void;
  onSaveBio: () => void;
  // Position-specific content
  renderHeaderStats?: () => React.ReactNode;
  renderOverview: () => React.ReactNode;
  renderGameBadge?: (game: ScoutingGame) => React.ReactNode;
  renderPlayLogger: (selectedGame: ScoutingGame | null) => React.ReactNode;
  renderGamesTable: () => React.ReactNode;
  renderExtraTab?: (tabKey: string) => React.ReactNode;
}

const ACCENT = {
  blue: {
    tabActive:    "border-blue-500 text-blue-400",
    addBtn:       "bg-blue-700 hover:bg-blue-600",
    gameSelected: "bg-blue-900/30 border-blue-700",
    playCount:    "text-blue-400",
    saveBtn:      "bg-blue-700 hover:bg-blue-600",
    focusBorder:  "focus:border-blue-500",
    classYear:    "text-blue-400",
  },
  green: {
    tabActive:    "border-green-500 text-green-400",
    addBtn:       "bg-green-700 hover:bg-green-600",
    gameSelected: "bg-green-900/30 border-green-700",
    playCount:    "text-green-400",
    saveBtn:      "bg-green-700 hover:bg-green-600",
    focusBorder:  "focus:border-green-500",
    classYear:    "text-green-400",
  },
} as const;

export default function ChartingBoard({
  prospect, config, tabs,
  tab, games, selectedGameId, loading, gamePlayCounts,
  showAddGame, newGame, savingGame, gameError,
  editBio, bio, savingBio,
  onBack, onTabChange, onSelectGame, onToggleAddGame, onNewGameChange,
  onAddGame, onDeleteGame, onUpdateGame, onToggleEditBio, onBioChange, onSaveBio,
  renderGameBadge, renderHeaderStats, renderOverview, renderPlayLogger, renderGamesTable, renderExtraTab,
}: ChartingBoardProps) {
  const a = ACCENT[config.accentColor];
  const selectedGame = games.find((g) => g.id === selectedGameId) ?? null;

  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editGameOpponent, setEditGameOpponent] = useState("");
  const [editGameYear, setEditGameYear] = useState<number>(2025);

  function openGameEdit(g: ScoutingGame) {
    setEditingGameId(g.id);
    setEditGameOpponent(g.opponent);
    setEditGameYear(g.season_year);
  }

  function commitGameEdit(id: string) {
    const opp = editGameOpponent.trim();
    if (!opp) { setEditingGameId(null); return; }
    onUpdateGame(id, { opponent: opp, season_year: editGameYear });
    setEditingGameId(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="mt-0.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition flex-shrink-0">
          ← Back
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-white truncate">{prospect.name}</h2>
            {prospect.draft_round && (
              <span className="px-2 py-0.5 bg-yellow-600/20 border border-yellow-600/40 rounded text-xs font-semibold text-yellow-400">
                Rd {prospect.draft_round}{prospect.draft_pick ? `, Pick ${prospect.draft_pick}` : ""}{prospect.draft_team ? ` · ${prospect.draft_team}` : ""}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400">
            {config.positionLabel} · {prospect.school}
            {prospect.conference && ` · ${prospect.conference}`}
            {" · "}<span className={a.classYear}>{prospect.draft_class_year} Class</span>
          </p>
        </div>
        {renderHeaderStats && (
          <div className="flex-shrink-0 text-right text-xs text-gray-500">
            {renderHeaderStats()}
          </div>
        )}
        <button onClick={onToggleEditBio} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition flex-shrink-0">
          {editBio ? "Close" : "Edit Bio"}
        </button>
      </div>

      {/* Bio edit panel */}
      {editBio && (
        <div className="p-4 bg-gray-900 border border-gray-700 rounded-lg">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            {([
              { label: "School",        key: "school" as const,        type: "text",   placeholder: "Alabama" },
              { label: "Height",        key: "height" as const,        type: "text",   placeholder: '6\'4"' },
              { label: "Weight (lbs)",  key: "weight" as const,        type: "number", placeholder: "220" },
              { label: "Birthday",      key: "birthday" as const,      type: "date",   placeholder: "" },
              { label: "Personal Rank", key: "personal_rank" as const, type: "number", placeholder: "1" },
            ] as const).map((f) => (
              <div key={f.key}>
                <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
                <input type={f.type} placeholder={f.placeholder}
                  className={`w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none ${a.focusBorder}`}
                  value={(bio[f.key] as string | number | null | undefined) ?? ""}
                  onChange={(e) => onBioChange({ [f.key]: f.type === "number" ? (e.target.value ? Number(e.target.value) : null) : (f.key === "school" ? e.target.value : (e.target.value || null)) })}
                />
              </div>
            ))}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Draft Class Year</label>
              <select className={`w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none ${a.focusBorder}`}
                value={bio.draft_class_year ?? 2026} onChange={(e) => onBioChange({ draft_class_year: Number(e.target.value) })}>
                {[2026, 2027, 2028, 2029].map((y) => <option key={y}>{y}</option>)}
              </select>
            </div>
            {(["should_play", "will_play_pre", "will_play_post"] as const).map((k) => (
              <div key={k}>
                <label className="block text-xs text-gray-500 mb-1">
                  {k === "should_play" ? "Should Play" : k === "will_play_pre" ? "Will Play (Pre)" : "Will Play (Post)"}
                </label>
                <select className={`w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none ${a.focusBorder}`}
                  value={bio[k] ?? ""} onChange={(e) => onBioChange({ [k]: e.target.value })}>
                  {config.nflRoles.map((r) => <option key={r} value={r}>{r || "—"}</option>)}
                </select>
              </div>
            ))}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Charting Status</label>
              <select className={`w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none ${a.focusBorder}`}
                value={bio.charting_decision ?? "pending"} onChange={(e) => onBioChange({ charting_decision: e.target.value as ChartingDecision })}>
                {CHARTING_DECISIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Charting Notes</label>
            <textarea rows={2}
              className={`w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none ${a.focusBorder} resize-none`}
              value={bio.charting_notes ?? ""} onChange={(e) => onBioChange({ charting_notes: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Draft Round</label>
              <input type="number" min={1} max={7} placeholder="e.g. 1"
                className={`w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none ${a.focusBorder}`}
                value={bio.draft_round ?? ""}
                onChange={(e) => onBioChange({ draft_round: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Draft Pick #</label>
              <input type="number" min={1} placeholder="e.g. 14"
                className={`w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none ${a.focusBorder}`}
                value={bio.draft_pick ?? ""}
                onChange={(e) => onBioChange({ draft_pick: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Draft Team</label>
              <input type="text" placeholder="e.g. NYG"
                className={`w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none ${a.focusBorder}`}
                value={bio.draft_team ?? ""}
                onChange={(e) => onBioChange({ draft_team: e.target.value || null })} />
            </div>
          </div>
          <button onClick={onSaveBio} disabled={savingBio}
            className={`px-4 py-2 ${a.saveBtn} disabled:opacity-50 text-white text-sm rounded font-medium transition`}>
            {savingBio ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-800">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => onTabChange(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              tab === t.key ? a.tabActive : "border-transparent text-gray-400 hover:text-white"
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === "overview" && renderOverview()}

      {/* Chart Game tab */}
      {tab === "chart" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Game list sidebar */}
          <div className="md:col-span-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-300">Games ({games.length})</span>
              <button onClick={onToggleAddGame} className={`px-2 py-1 ${a.addBtn} text-white text-xs rounded transition`}>+ Add</button>
            </div>
            {showAddGame && (
              <div className="mb-3 p-3 bg-gray-900 border border-gray-700 rounded-lg space-y-2">
                <select className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                  value={newGame.year} onChange={(e) => onNewGameChange({ year: Number(e.target.value) })}>
                  {[2023, 2024, 2025, 2026].map((y) => <option key={y}>{y}</option>)}
                </select>
                <input className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500"
                  placeholder="Opponent" value={newGame.opponent} onChange={(e) => onNewGameChange({ opponent: e.target.value })} />
                <select className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                  value={newGame.type} onChange={(e) => onNewGameChange({ type: e.target.value })}>
                  {GAME_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <div className="flex gap-2">
                  <button onClick={onAddGame} disabled={savingGame || !newGame.opponent.trim()}
                    className={`flex-1 py-1.5 ${a.addBtn} disabled:opacity-50 text-white text-sm rounded transition`}>
                    {savingGame ? "…" : "Add Game"}
                  </button>
                  <button onClick={onToggleAddGame} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition">✕</button>
                </div>
                {gameError && <p className="text-red-400 text-xs">{gameError}</p>}
              </div>
            )}
            <div className="space-y-1">
              {loading ? (
                <div className="text-gray-500 text-xs py-4 text-center">Loading…</div>
              ) : games.length === 0 ? (
                <div className="text-gray-500 text-xs py-4 text-center">No games added yet.</div>
              ) : (
                games.map((g) => (
                  <div key={g.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition ${
                      selectedGameId === g.id ? a.gameSelected : "bg-gray-900 border-gray-800 hover:border-gray-600"
                    }`}
                    onClick={() => editingGameId !== g.id && onSelectGame(g.id)}
                  >
                    <div className="flex-1 min-w-0">
                      {editingGameId === g.id ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="number"
                            min={1900}
                            max={2100}
                            value={editGameYear}
                            onChange={(e) => setEditGameYear(parseInt(e.target.value, 10) || g.season_year)}
                            onKeyDown={(e) => { if (e.key === "Enter") commitGameEdit(g.id); if (e.key === "Escape") setEditingGameId(null); }}
                            className="w-14 px-1 py-0.5 bg-gray-800 border border-blue-500 rounded text-white text-xs focus:outline-none text-center"
                          />
                          <input
                            autoFocus
                            value={editGameOpponent}
                            onChange={(e) => setEditGameOpponent(e.target.value)}
                            onBlur={() => commitGameEdit(g.id)}
                            onKeyDown={(e) => { if (e.key === "Enter") commitGameEdit(g.id); if (e.key === "Escape") setEditingGameId(null); }}
                            className="flex-1 min-w-0 px-1.5 py-0.5 bg-gray-800 border border-blue-500 rounded text-white text-xs focus:outline-none"
                          />
                        </div>
                      ) : (
                        <>
                          <div className="text-xs font-medium text-white truncate">{g.season_year} {g.opponent}</div>
                          <div className="text-xs text-gray-500 capitalize">{g.game_type}</div>
                        </>
                      )}
                    </div>
                    {renderGameBadge
                      ? <div className="flex-shrink-0">{renderGameBadge(g)}</div>
                      : <div className={`text-xs ${a.playCount} flex-shrink-0`}>{gamePlayCounts[g.id] ?? 0}pl</div>
                    }
                    {editingGameId !== g.id && (
                      <button onClick={(e) => { e.stopPropagation(); openGameEdit(g); }}
                        className="text-gray-600 hover:text-blue-400 text-xs px-1 flex-shrink-0" title="Edit game">✎</button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); onDeleteGame(g.id); }}
                      className="text-gray-600 hover:text-red-400 text-xs px-1 flex-shrink-0">✕</button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Position-specific play logger */}
          <div className="md:col-span-2">
            {renderPlayLogger(selectedGame)}
          </div>
        </div>
      )}

      {/* Games tab */}
      {tab === "games" && renderGamesTable()}

      {/* Position-specific extra tabs (e.g., WR "charts") */}
      {tab !== "overview" && tab !== "chart" && tab !== "games" && renderExtraTab?.(tab)}
    </div>
  );
}
