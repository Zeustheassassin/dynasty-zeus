"use client";
// Data Hub → Contracts (contracts plan, stage 7 follow-up, 2026-11-11): the
// whole league's contract picture for the coming season in one place. The
// user: "a full tab that basically lists likely free agents, possible free
// agents etc." Four views:
//   Free agents to be  deals ending before the season: likely leaves / toss-up / likely back
//   Cut candidates     signed players a release would pay off for: likely cut / cut risk
//   Your calls         every player the user has called stays or goes
//   Rooms              each team's room at a position, by its odds of adding competition
// Data: hooks/useContractSituation.ts (GET /api/nfl/situation + the user's calls).

import React, { useMemo, useState } from "react";
import { useContractSituation } from "../../hooks/useContractSituation";
import { useValues } from "../../lib/ValuesContext";
import {
  callFor, contractChip, contractGroup, overrideFor, roomOpenWith,
  type CallTone, type ContractGroup, type OverrideCall, type PlayerSituation,
} from "../../lib/contractSituation";
import { STARTING_SPOTS } from "../../lib/contractRooms";
import { NFL_TEAMS } from "../../lib/nflDraft";
import { ROOM_POSITIONS, type RoomPos } from "../../lib/nflRooms";
import { LOW_VALUE_FLOOR } from "../tradeHub/FinderScoring";
import { STATUS_CLASSES, ACCENT_CLASSES } from "../../lib/uiTheme";
import type { ShareEntry } from "./dataHubTypes";
import EmptyState from "../ui/EmptyState";

type View = "FREE_AGENTS" | "CUTS" | "CALLS" | "ROOMS";
const VIEWS: { id: View; label: string }[] = [
  { id: "FREE_AGENTS", label: "Free agents to be" },
  { id: "CUTS", label: "Cut candidates" },
  { id: "CALLS", label: "Your calls" },
  { id: "ROOMS", label: "Rooms" },
];
const GROUPS: Record<Exclude<View, "ROOMS">, { group: ContractGroup; title: string; blurb: string }[]> = {
  FREE_AGENTS: [
    { group: "leaves", title: "Likely leaves", blurb: "His deal ends and the model (or you) expects him gone" },
    { group: "toss-up", title: "Toss-up", blurb: "His deal ends; could go either way" },
    { group: "back", title: "Likely back", blurb: "Re-signed, tagged or tendered, by the model or your call" },
  ],
  CUTS: [
    { group: "likely-cut", title: "Likely cut", blurb: "A release saves real money and he no longer earns it" },
    { group: "cut-risk", title: "Cut risk", blurb: "A release pays off; it depends on how he plays" },
    { group: "goes", title: "Goes (your call)", blurb: "Signed, but you expect him gone (cut or traded)" },
    { group: "kept", title: "Stays (your call)", blurb: "A cut risk you expect him to survive" },
  ],
  CALLS: [
    { group: "leaves", title: "Expiring: goes", blurb: "" },
    { group: "back", title: "Expiring: stays", blurb: "" },
    { group: "goes", title: "Signed: goes", blurb: "" },
    { group: "kept", title: "Signed: stays", blurb: "" },
  ],
};
const TONE: Record<CallTone, string> = {
  good: STATUS_CLASSES.good, warn: STATUS_CLASSES.warning, bad: STATUS_CLASSES.critical,
  neutral: "border-slate-700 bg-slate-800/60 text-slate-300",
};
const CHIP = "text-[10px] font-semibold px-1.5 rounded border whitespace-nowrap";
const abbr = (teamId: number) => NFL_TEAMS[teamId]?.abbr[0] ?? "—";
const money = (v: number | null) => (v == null ? "—" : `$${v.toFixed(1)}M`);
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const pill = (on: boolean) => `px-2.5 py-1 text-xs font-semibold rounded-lg transition ${on ? "bg-blue-900/50 text-blue-200" : "text-slate-400 hover:text-white"}`;

interface Props {
  shares: Record<string, ShareEntry>;
  setPlayerProfileId: (id: string | null) => void;
}

function ContractsTab({ shares, setPlayerProfileId }: Props) {
  const { situation, overrides, loading, error, setOverride, retry } = useContractSituation();
  // A cross-league list: FantasyCalc's raw values, which don't change with the selected league (league-adjusted
  // values are empty until a league is picked); the league's when raw ones aren't there (spy mode).
  const { rawFcValues, leagueAdjustedFcValues } = useValues();
  const values = Object.keys(rawFcValues).length ? rawFcValues : leagueAdjustedFcValues;
  // Until values load (or if they fail), the value filter steps aside rather than hiding everyone.
  const haveValues = Object.keys(values).length > 0;
  const [view, setView] = useState<View>("FREE_AGENTS");
  const [pos, setPos] = useState<RoomPos | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [relevantOnly, setRelevantOnly] = useState(true);

  const season = situation?.season ?? null;
  const rows = useMemo(() => {
    if (!situation || season == null) return [];
    const q = search.trim().toLowerCase();
    return Object.values(situation.players).flatMap((p) => {
      if (pos !== "ALL" && p.pos !== pos) return [];
      if (q && !p.name.toLowerCase().includes(q) && !abbr(p.teamId).toLowerCase().includes(q)) return [];
      const value = p.sleeperId ? values[p.sleeperId] ?? 0 : 0;
      const mine = p.sleeperId ? shares[p.sleeperId]?.count ?? 0 : 0;
      if (mineOnly && mine === 0) return [];
      if (relevantOnly && haveValues && value < LOW_VALUE_FLOOR) return [];
      const call = overrideFor(overrides, p.otcId, season);
      const group = contractGroup(p, call);
      return group ? [{ p, value, mine, call, group }] : [];
    }).sort((a, b) => b.value - a.value || a.p.name.localeCompare(b.p.name));
  }, [situation, season, pos, search, mineOnly, relevantOnly, haveValues, values, shares, overrides]);

  if (!situation || season == null) {
    return error
      ? <EmptyState>Couldn&apos;t load contracts ({error}). <button className={ACCENT_CLASSES.text} onClick={retry}>Retry</button></EmptyState>
      : <EmptyState>{loading ? "Loading contracts… (the first load of the day reads every source, about 15 seconds)" : "—"}</EmptyState>;
  }

  return (
    <div className="space-y-4">
      <div className="text-center space-y-1">
        <h2 className="text-lg font-bold text-white">NFL contracts for {season}</h2>
        <p className="text-xs text-slate-500">
          OverTheCap via nflverse{situation.contractsUpdatedAt ? ` (updated ${situation.contractsUpdatedAt.slice(0, 10)})` : ""}
          {situation.pffSeasons ? ` · importance from PFF ${situation.pffSeasons.current} and ${situation.pffSeasons.prior}` : ""}
          {" · "}cut risk weighs the release math, importance, age, team direction and cap; re-sign odds weigh importance, age, team and cap.
          Your calls (Stays / Goes) win for {season}.
        </p>
        {situation.notes.length > 0 && <p className="text-xs text-amber-400">{situation.notes.join(" · ")}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1" role="tablist" aria-label="Contract views">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)} className={pill(view === v.id)}>{v.label}</button>
          ))}
        </div>
        <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1" aria-label="Position">
          {(["ALL", ...ROOM_POSITIONS] as const).map((p) => (
            <button key={p} onClick={() => setPos(p)} aria-pressed={pos === p} className={pill(pos === p)}>{p === "ALL" ? "All" : p}</button>
          ))}
        </div>
        {view !== "ROOMS" && (
          <>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Player or team…" aria-label="Search players"
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-40" />
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> On my teams
            </label>
            <label className={`flex items-center gap-1.5 text-xs ${haveValues ? "text-slate-400" : "text-slate-600"}`}
              title={haveValues ? `Dynasty value ${LOW_VALUE_FLOOR}+ (below that a player rarely matters in a trade)` : "Dynasty values are still loading"}>
              <input type="checkbox" checked={relevantOnly} disabled={!haveValues} onChange={(e) => setRelevantOnly(e.target.checked)} /> Value {LOW_VALUE_FLOOR}+
            </label>
          </>
        )}
      </div>

      {view === "ROOMS" ? (
        <RoomsTable pos={pos} />
      ) : (
        GROUPS[view].map(({ group, title, blurb }) => {
          const list = rows.filter((r) => r.group === group && (view !== "CALLS" || r.call));
          if (view === "CALLS" && !list.length) return null;
          return (
            <section key={group} aria-label={title} className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-800 flex flex-wrap items-baseline gap-2">
                <h3 className="text-sm font-bold text-white">{title} <span className="text-slate-500 font-normal">({list.length})</span></h3>
                {blurb && <span className="text-[11px] text-slate-500">{blurb}</span>}
              </div>
              {list.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-600">None with these filters.</p>
              ) : (
                <PlayerTable rows={list} season={season} onProfile={setPlayerProfileId} onCall={setOverride} />
              )}
            </section>
          );
        })
      )}
      {view === "CALLS" && !rows.some((r) => r.call) && (
        <EmptyState>No calls yet. Set one with Stays / Goes on any row, or in a player&apos;s profile.</EmptyState>
      )}
    </div>
  );
}

interface Row { p: PlayerSituation; value: number; mine: number; call: OverrideCall | null }

function PlayerTable({ rows, season, onProfile, onCall }: {
  rows: readonly Row[];
  season: number;
  onProfile: (id: string | null) => void;
  onCall: (otcId: number, call: OverrideCall | null) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-slate-500">
          <tr>
            <th scope="col" className="text-left px-3 py-1.5">Player</th>
            <th scope="col" className="text-left px-2 py-1.5">Team</th>
            <th scope="col" className="text-right px-2 py-1.5">Age</th>
            <th scope="col" className="text-left px-2 py-1.5">Deal</th>
            <th scope="col" className="text-right px-2 py-1.5">APY</th>
            <th scope="col" className="text-left px-2 py-1.5">{season}</th>
            <th scope="col" className="text-right px-2 py-1.5">Value</th>
            <th scope="col" className="text-center px-2 py-1.5" title="How many of your teams roster him">Mine</th>
            <th scope="col" className="text-left px-2 py-1.5">Your call</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {rows.map(({ p, value, mine, call }) => {
            const label = callFor(p, call);
            return (
              <tr key={p.otcId} className={mine ? "bg-blue-950/20" : ""}>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {p.sleeperId
                    ? <button onClick={() => onProfile(p.sleeperId)} className="font-medium text-white hover:text-blue-400 text-left">{p.name}</button>
                    : <span className="font-medium text-slate-300">{p.name}</span>}
                  <span className="ml-1.5 text-[10px] text-slate-500">{p.pos}</span>
                </td>
                <td className="px-2 py-1.5 text-slate-400">{abbr(p.teamId)}</td>
                <td className="px-2 py-1.5 text-right text-slate-400">{p.age != null ? Math.floor(p.age) : "—"}</td>
                <td className="px-2 py-1.5"><span className={`${CHIP} ${TONE.neutral}`}>{contractChip(p, season)}</span></td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-400">{money(p.apy)}</td>
                <td className="px-2 py-1.5">
                  {label && (
                    <span className={`${CHIP} ${TONE[label.tone]}`} title={label.reasons.join("\n")}>
                      {label.label}{label.source === "yours" ? " ✓" : ""}
                    </span>
                  )}
                  {p.cut?.savings != null && !call && (
                    <span className="ml-1.5 text-[10px] text-slate-500" title="What a release before the season saves, and the dead money it leaves">
                      saves {money(p.cut.savings)} / {money(p.cut.deadMoney)} dead
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-300">{value > 0 ? value.toLocaleString() : "—"}</td>
                <td className="px-2 py-1.5 text-center text-blue-300">{mine || ""}</td>
                <td className="px-2 py-1.5">
                  <select value={call ?? ""} onChange={(e) => onCall(p.otcId, (e.target.value || null) as OverrideCall | null)}
                    aria-label={`Your call on ${p.name} for ${season}`}
                    className="bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs px-1 py-0.5 focus:outline-none focus:border-blue-500">
                    <option value="">Model</option>
                    <option value="stays">Stays</option>
                    <option value="goes">Goes</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RoomsTable({ pos }: { pos: RoomPos | "ALL" }) {
  const { situation, overrides } = useContractSituation();
  const rows = useMemo(() => {
    if (!situation) return [];
    return situation.teams.flatMap((t) => ROOM_POSITIONS
      .filter((p) => pos === "ALL" || p === pos)
      .map((p) => ({ t, room: t.rooms[p], open: roomOpenWith(t.rooms[p], situation.players, overrides, situation.season) })))
      .sort((a, b) => (b.room.pressure.day12 ?? 0) - (a.room.pressure.day12 ?? 0) || b.room.pressure.veteran - a.room.pressure.veteran);
  }, [situation, overrides, pos]);
  if (!situation) return null;
  const season = situation.season;
  return (
    <section aria-label="Rooms" className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-800 text-[11px] text-slate-500">
        Each team&apos;s room at a position for {season}, most likely to add competition first. Odds measured on the 2016–2026 drafts
        from rooms like these (open spots on contracts, the team&apos;s picks, where its 1st is likely to land).
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="text-left px-3 py-1.5">Team</th>
              <th scope="col" className="text-right px-2 py-1.5" title="Players signed for the season">Signed</th>
              <th scope="col" className="text-right px-2 py-1.5" title="Starting spots with no invested player signed for the season">Open (deals)</th>
              <th scope="col" className="text-right px-2 py-1.5" title="Open once likely cuts, likely re-signings and your calls count">Open (expected)</th>
              <th scope="col" className="text-right px-2 py-1.5">Round 1</th>
              <th scope="col" className="text-right px-2 py-1.5">Day 1–2</th>
              <th scope="col" className="text-right px-2 py-1.5">Day 3</th>
              <th scope="col" className="text-right px-2 py-1.5" title="Adds a veteran the team invests in (signing or trade)">Veteran</th>
              <th scope="col" className="text-right px-2 py-1.5" title={`${season} picks by draft day`}>Picks 1/2/3</th>
              <th scope="col" className="text-right px-2 py-1.5" title="Cap space for the season; reads high by dead money from earlier releases">Cap space</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {rows.map(({ t, room, open }) => (
              <tr key={`${t.teamId}-${room.pos}`}>
                <td className="px-3 py-1.5 whitespace-nowrap text-white font-medium">{abbr(t.teamId)} <span className="text-slate-500 font-normal">{room.pos}</span></td>
                <td className="px-2 py-1.5 text-right text-slate-400">{room.outlook[0]?.underContract ?? 0}</td>
                <td className="px-2 py-1.5 text-right text-slate-300">{room.outlook[0]?.openSpots ?? 0}/{STARTING_SPOTS[room.pos]}</td>
                <td className="px-2 py-1.5 text-right text-slate-200 font-semibold">{open.openSpots}/{STARTING_SPOTS[room.pos]}</td>
                <td className="px-2 py-1.5 text-right text-slate-300">{pct(room.pressure.round1)}</td>
                <td className="px-2 py-1.5 text-right text-white font-semibold">{pct(room.pressure.day12)}</td>
                <td className="px-2 py-1.5 text-right text-slate-400">{pct(room.pressure.day3)}</td>
                <td className="px-2 py-1.5 text-right text-slate-300">{pct(room.pressure.veteran)}</td>
                <td className="px-2 py-1.5 text-right text-slate-400">{room.pressure.picks ? room.pressure.picks.join("/") : "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-400">{money(t.cap[0]?.space ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default React.memo(ContractsTab);
