"use client";
// Post-Draft tab: each drafted rookie's year-2 path read from his NFL team's
// contracts (lib/contractSituation.ts contractPathHint), saved on his row as
// landing_inputs.contract, which Dynasty+'s Path by year 2 suggestion reads
// (teamLanding.ts). Inputs only: Dynasty+'s weights are untouched, and the
// user's own Path entry always wins.

import { useMemo } from "react";
import { useContractSituation } from "../../hooks/useContractSituation";
import { contractPathHint, sameName, type ContractPathHint, type PlayerSituation } from "../../lib/contractSituation";
import { nflTeamId } from "../../lib/nflDraft";
import type { RoomPos } from "../../lib/nflRooms";
import { PATH_LABEL, contractHint, type LandingSaved, type TeamLanding } from "../../lib/scouting/teamLanding";
import type { Prospect } from "../../lib/types";

const isRoomPos = (pos: string): pos is RoomPos => pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE";
const same = (a: ContractPathHint | null, b: ContractPathHint | null) => (a?.call ?? null) === (b?.call ?? null) && (a?.why ?? null) === (b?.why ?? null);

export function ContractOutlookSection({ classYear, drafted, team, busy, onSave }: {
  classYear: number;
  drafted: readonly Prospect[];
  team: ReadonlyMap<string, TeamLanding | null>;
  busy: boolean;
  onSave?: (rows: readonly { p: Prospect; patch: Partial<LandingSaved> }[], what: string) => void;
}) {
  const { situation, overrides, loading, error } = useContractSituation();
  const year2 = classYear + 1;

  const rows = useMemo(() => {
    if (!situation || situation.season !== year2) return [];
    return drafted.flatMap((p) => {
      const teamId = nflTeamId(p.draft_team);
      const t = team.get(p.id);
      if (teamId == null || !isRoomPos(p.position)) return [];
      const room = situation.teams.find((x) => x.teamId === teamId)?.rooms[p.position];
      const roomPlayers = (room?.players ?? []).map((id) => situation.players[id]).filter((x): x is PlayerSituation => !!x);
      // His vets ahead as the saved PFF room has them, found in his team's contracts by name.
      const ahead = (t?.vetsAhead?.ahead ?? []).flatMap((v) => roomPlayers.filter((c) => sameName(c.name, v.name)));
      const hint = contractPathHint({ classYear, pos: p.position, teamId, ahead, situation, overrides });
      const saved = contractHint(p.landing_inputs?.contract, classYear);
      return [{ p, hint, saved, changed: !same(hint, saved) }];
    });
  }, [situation, overrides, drafted, team, classYear, year2]);

  const changed = rows.filter((r) => r.changed);
  const header = <h3 id="pd-contracts" className="font-semibold text-slate-200">Contract outlook for {year2} (year 2)</h3>;

  if (!situation) {
    return (
      <section aria-labelledby="pd-contracts" className="border border-slate-800 rounded p-3 text-xs">
        {header}
        <p className="text-slate-500 mt-1">{error ? `Contracts didn't load: ${error}` : loading ? "Loading contracts…" : "—"}</p>
      </section>
    );
  }
  if (situation.season !== year2) {
    return (
      <section aria-labelledby="pd-contracts" className="border border-slate-800 rounded p-3 text-xs">
        {header}
        <p className="text-slate-500 mt-1">
          The contract outlook looks at the {situation.season} season right now; it reaches {year2} once the {classYear} draft is done (May {classYear}).
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="pd-contracts" className="border border-slate-800 rounded p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        {header}
        <button onClick={() => onSave?.(changed.map(({ p, hint }) => ({ p, patch: { contract: hint } })), "Contract outlooks")}
          disabled={busy || !onSave || changed.length === 0}
          className="px-3 py-1 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40">
          Save contract outlooks ({changed.length})
        </button>
      </div>
      <p className="text-slate-500 mb-1">
        Path by year 2 from his team&apos;s contracts: a vet ahead who&apos;s a likely cut or likely gone opens it; a team in the top quarter
        of the league for adding a day 1–2 pick or an invested veteran at his position closes it. A suggestion only: your Path entry wins.
      </p>
      <ul className="space-y-0.5">
        {rows.map(({ p, hint, saved, changed: c }) => (
          <li key={p.id} className="flex flex-wrap gap-x-2">
            <span className="text-slate-200">{p.name}</span>
            <span className="text-slate-500">{p.position} · {p.draft_team}</span>
            <span className={hint ? "text-slate-300" : "text-slate-500"}>{hint ? `${PATH_LABEL[hint.call]}: ${hint.why}` : "no contract signal"}</span>
            {c && saved && <span className="text-amber-400">(saved: {PATH_LABEL[saved.call]})</span>}
            {!c && saved && <span className="text-slate-500">(saved)</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
