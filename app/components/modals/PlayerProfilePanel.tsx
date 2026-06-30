"use client";
import type {
  SleeperPlayer, SleeperLeague, SleeperRoster, LeagueOverviewEntry,
} from "../../../lib/types";
import { useModalBehavior } from "../../../lib/hooks/useModalBehavior";

interface Props {
  playerProfileId: string;
  players: Record<string, SleeperPlayer>;
  calcFcValues: Record<string, number>;
  leagueAdjustedRedraftValues: Record<string, number>;
  playerNotes: Record<string, string>;
  rosters: SleeperRoster[];
  users: Record<string, string>;
  selectedLeague: SleeperLeague | null;
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  leagues: SleeperLeague[];
  savePlayerNote: (playerId: string, text: string) => void;
  onClose: () => void;
}

export function PlayerProfilePanel({
  playerProfileId, players, calcFcValues, leagueAdjustedRedraftValues,
  playerNotes, rosters, users, selectedLeague,
  leagueOverviewData, leagues, savePlayerNote, onClose,
}: Props) {
  useModalBehavior(onClose);
  const p = players[playerProfileId];
  if (!p) return null;

  const dynVal = calcFcValues[playerProfileId] ?? p.value ?? 0;
  const redVal = leagueAdjustedRedraftValues[playerProfileId] ?? 0;
  const injuryStatus = p.injury_status || p.status;
  const injuryNote = [p.injury_body_part, p.injury_notes].filter(Boolean).join(" — ");
  const practiceDesc = p.practice_description || p.practice_participation || "";
  const injuryColor =
    injuryStatus === "IR" || injuryStatus === "PUP" ? "bg-red-900/50 text-red-300 border-red-700" :
    injuryStatus === "Out" ? "bg-red-900/40 text-red-400 border-red-800" :
    injuryStatus === "Doubtful" ? "bg-orange-900/40 text-orange-400 border-orange-700" :
    injuryStatus === "Questionable" ? "bg-yellow-900/40 text-yellow-400 border-yellow-700" :
    "bg-green-900/30 text-green-400 border-green-700";

  const ownersInSelectedLeague = rosters
    .filter((r) => (r.players || []).includes(playerProfileId))
    .map((r) => users[r.owner_id] || `Team ${r.roster_id}`);

  const crossLeagueOwners: { leagueName: string; owner: string }[] = [];
  Object.entries(leagueOverviewData).forEach(([lid, entry]) => {
    const lg = leagues.find((l) => l.league_id === lid);
    if (!lg) return;
    const leagueUserMap: Record<string, string> = (entry as LeagueOverviewEntry & { userMap?: Record<string, string> }).userMap || {};
    (entry.rosters || []).forEach((r) => {
      if ((r.players || []).includes(playerProfileId)) {
        const ownerName = leagueUserMap[r.owner_id] || users[r.owner_id] || `Team ${r.roster_id}`;
        crossLeagueOwners.push({ leagueName: lg.name, owner: ownerName });
      }
    });
  });

  const noteVal = playerNotes[playerProfileId] ?? "";

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-profile-title"
        tabIndex={-1}
        className="fixed top-0 right-0 h-full w-full max-w-sm bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl overflow-y-auto"
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-800">
          <div>
            <h2 id="player-profile-title" className="text-lg font-bold text-white">{p.full_name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-400">{p.position}</span>
              {p.team && <span className="text-xs text-gray-500">· {p.team}</span>}
              {p.age && <span className="text-xs text-gray-500">· Age {p.age}</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close player profile" className="text-gray-500 hover:text-white text-xl leading-none mt-1">✕</button>
        </div>

        <div className="p-5 space-y-5 flex-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Dynasty Value</p>
              <p className="text-xl font-bold text-white">{dynVal > 0 ? dynVal.toLocaleString() : "—"}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Redraft Value</p>
              <p className="text-xl font-bold text-white">{redVal > 0 ? redVal.toLocaleString() : "—"}</p>
            </div>
          </div>

          <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Status</p>
            <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${injuryColor}`}>
              {injuryStatus || "Active"}
            </span>
            {injuryNote && <p className="text-xs text-gray-400 mt-1.5">{injuryNote}</p>}
            {practiceDesc && <p className="text-xs text-gray-500 mt-1">{practiceDesc}</p>}
          </div>

          {ownersInSelectedLeague.length > 0 && (
            <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Owned in {selectedLeague?.name || "Selected League"}
              </p>
              {ownersInSelectedLeague.map((name) => (
                <p key={name} className="text-sm text-white">{name}</p>
              ))}
            </div>
          )}

          {crossLeagueOwners.length > 0 && (
            <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Cross-League Ownership</p>
              <div className="space-y-1">
                {crossLeagueOwners.map((entry) => (
                  <div key={`${entry.owner}-${entry.leagueName}`} className="flex items-baseline justify-between text-xs">
                    <span className="text-white truncate mr-2">{entry.owner}</span>
                    <span className="text-gray-500 shrink-0">{entry.leagueName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ownersInSelectedLeague.length === 0 && crossLeagueOwners.length === 0 && (
            <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Ownership</p>
              <p className="text-xs text-gray-600">Not on any loaded roster.</p>
            </div>
          )}

          <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Your Notes</p>
            <textarea
              value={noteVal}
              onChange={(e) => savePlayerNote(playerProfileId, e.target.value)}
              placeholder={`Jot down thoughts on ${p.first_name || p.full_name}…`}
              className="w-full h-28 bg-gray-800 border border-gray-700 rounded-lg p-2.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
        </div>
      </div>
    </>
  );
}
