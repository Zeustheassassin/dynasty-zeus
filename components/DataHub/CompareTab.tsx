"use client";
import { useMemo, useState, type ReactNode } from "react";
import { usePlayers } from "../../lib/PlayersContext";
import { useValues } from "../../lib/ValuesContext";
import type { SleeperPlayer } from "../../lib/types";
import { POS_COLOR, ageColor, injuryBadge, injuryRiskTier } from "./dataHubHelpers";

interface Props {
  setPlayerProfileId: (id: string | null) => void;
}

function PlayerPicker({
  label, player, onSelect, players, excludeId,
}: {
  label: string;
  player: SleeperPlayer | null;
  onSelect: (p: SleeperPlayer) => void;
  players: Record<string, SleeperPlayer>;
  excludeId?: string;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return Object.values(players)
      .filter((p) => p.player_id !== excludeId && p.full_name?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, players, excludeId]);

  if (player) {
    return (
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
          <p className="text-sm font-semibold text-white truncate">{player.full_name}</p>
        </div>
        <button
          onClick={() => onSelect(null as unknown as SleeperPlayer)}
          className="text-xs text-slate-500 hover:text-white shrink-0"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">{label}</p>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search player..."
        className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
        aria-label={`Search for ${label.toLowerCase()}`}
      />
      {results.length > 0 && (
        <ul className="mt-1.5 divide-y divide-slate-800 border border-slate-800 rounded overflow-hidden">
          {results.map((p) => (
            <li key={p.player_id}>
              <button
                onClick={() => { onSelect(p); setQuery(""); }}
                className="w-full text-left px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-800 flex items-center gap-2"
              >
                <span className={`font-bold ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</span>
                <span className="truncate">{p.full_name}</span>
                {p.team && <span className="text-slate-500 shrink-0">{p.team}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface CompareRow {
  label: string;
  render: (p: SleeperPlayer) => ReactNode;
  betterId?: (a: SleeperPlayer, b: SleeperPlayer) => string | null; // player_id of the "better" side, for highlighting
}

export default function CompareTab({ setPlayerProfileId }: Props) {
  const players = usePlayers();
  const { leagueAdjustedFcValues, leagueAdjustedRedraftValues } = useValues();
  const [playerA, setPlayerA] = useState<SleeperPlayer | null>(null);
  const [playerB, setPlayerB] = useState<SleeperPlayer | null>(null);

  // Restrict comparison search to players FantasyCalc actually ranks (QB/RB/WR/TE
  // with a dynasty value) — the full Sleeper player pool includes IDP (DB/LB/etc.)
  // and other noise nobody wants to compare here.
  const rankedPlayers = useMemo(() => {
    const out: Record<string, SleeperPlayer> = {};
    Object.values(players).forEach((p) => {
      if ((leagueAdjustedFcValues[p.player_id] ?? 0) > 0) out[p.player_id] = p;
    });
    return out;
  }, [players, leagueAdjustedFcValues]);

  const rows: CompareRow[] = [
    { label: "Position", render: (p) => <span className={POS_COLOR[p.position] ?? "text-slate-400"}>{p.position}</span> },
    { label: "Team", render: (p) => p.team || "—" },
    {
      label: "Age",
      render: (p) => <span className={ageColor(p.age ?? undefined, p.position)}>{p.age ?? "—"}</span>,
    },
    {
      label: "Status",
      render: (p) => (p.injury_status ? <>{p.injury_status} {injuryBadge(p.injury_status)}</> : "Active"),
    },
    {
      label: "Injury Risk",
      render: (p) => {
        const tier = injuryRiskTier(p.age, p.position, p.injury_status);
        return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${tier.cls}`}>{tier.label}</span>;
      },
      betterId: (a, b) => {
        const ta = injuryRiskTier(a.age, a.position, a.injury_status).score;
        const tb = injuryRiskTier(b.age, b.position, b.injury_status).score;
        if (ta === tb) return null;
        return ta < tb ? a.player_id : b.player_id;
      },
    },
    {
      label: "Dynasty Value",
      render: (p) => (leagueAdjustedFcValues[p.player_id] ?? 0).toLocaleString(),
      betterId: (a, b) => {
        const va = leagueAdjustedFcValues[a.player_id] ?? 0;
        const vb = leagueAdjustedFcValues[b.player_id] ?? 0;
        if (va === vb) return null;
        return va > vb ? a.player_id : b.player_id;
      },
    },
    {
      label: "Redraft Value",
      render: (p) => (leagueAdjustedRedraftValues[p.player_id] ?? 0).toLocaleString(),
      betterId: (a, b) => {
        const va = leagueAdjustedRedraftValues[a.player_id] ?? 0;
        const vb = leagueAdjustedRedraftValues[b.player_id] ?? 0;
        if (va === vb) return null;
        return va > vb ? a.player_id : b.player_id;
      },
    },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <PlayerPicker label="Player A" player={playerA} onSelect={setPlayerA} players={rankedPlayers} excludeId={playerB?.player_id} />
        <PlayerPicker label="Player B" player={playerB} onSelect={setPlayerB} players={rankedPlayers} excludeId={playerA?.player_id} />
      </div>

      {playerA && playerB && (
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-slate-800 bg-slate-950/60 p-3">
            <button onClick={() => setPlayerProfileId(playerA.player_id)} className="text-left text-sm font-bold text-white hover:text-blue-400 truncate">
              {playerA.full_name}
            </button>
            <span className="text-xs text-slate-600 px-3">vs</span>
            <button onClick={() => setPlayerProfileId(playerB.player_id)} className="text-right text-sm font-bold text-white hover:text-blue-400 truncate">
              {playerB.full_name}
            </button>
          </div>
          <div className="divide-y divide-slate-800/60">
            {rows.map((row) => {
              const better = row.betterId?.(playerA, playerB) ?? null;
              return (
                <div key={row.label} className="grid grid-cols-[1fr_auto_1fr] items-center px-3 py-2 text-sm">
                  <div className={`text-left ${better === playerA.player_id ? "font-bold text-emerald-400" : "text-slate-200"}`}>
                    {row.render(playerA)}
                  </div>
                  <div className="text-[10px] text-slate-600 uppercase tracking-wider px-3 text-center">{row.label}</div>
                  <div className={`text-right ${better === playerB.player_id ? "font-bold text-emerald-400" : "text-slate-200"}`}>
                    {row.render(playerB)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(!playerA || !playerB) && (
        <p className="text-center text-xs text-slate-600 py-8">Search and select two players above to compare them.</p>
      )}
    </div>
  );
}
