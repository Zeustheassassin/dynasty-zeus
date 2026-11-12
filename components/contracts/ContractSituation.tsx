"use client";
// NFL contract situation surfaces (contracts plan, stage 7): the chips beside a
// player's name, the Player profile's "Contract & situation" card (with the
// user's own stays / goes call), and the room line on Data Hub → Depth Charts.
// Data: hooks/useContractSituation.ts; the words: lib/contractSituation.ts.

import React from "react";
import { useContractSituation } from "../../hooks/useContractSituation";
import {
  callFor, contractChip, contractNote, overrideFor, roomOpenWith,
  type CallTone, type ContractSituationResponse, type OverrideCall, type PlayerSituation, type RoomSituation,
} from "../../lib/contractSituation";
import { STARTING_SPOTS } from "../../lib/contractRooms";
import { nflTeamId } from "../../lib/nflDraft";
import type { RoomPos } from "../../lib/nflRooms";
import { STATUS_CLASSES } from "../../lib/uiTheme";

const TONE: Record<CallTone, string> = {
  good: STATUS_CLASSES.good,
  warn: STATUS_CLASSES.warning,
  bad: STATUS_CLASSES.critical,
  neutral: "border-slate-700 bg-slate-800/60 text-slate-300",
};
const CHIP = "text-[9px] font-semibold px-1 rounded border shrink-0 whitespace-nowrap";
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const money = (v: number | null | undefined) => (v == null ? "—" : `$${v.toFixed(1)}M`);
const isRoomPos = (p: string | undefined): p is RoomPos => p === "QB" || p === "RB" || p === "WR" || p === "TE";

function playerFor(s: ContractSituationResponse | null, sleeperId: string): PlayerSituation | null {
  const otc = s?.bySleeper[sleeperId];
  return otc != null ? s?.players[otc] ?? null : null;
}

/** "thru '29 · gtd '27" plus the coming season's call, for one Sleeper player. Renders nothing without a deal.
 *  `compact` drops the guarantee from the deal chip (it stays in the tooltip) for narrow roster cards. */
export function ContractChips({ sleeperId, compact = false }: { sleeperId: string; compact?: boolean }) {
  const { situation, overrides } = useContractSituation();
  const p = playerFor(situation, sleeperId);
  if (!situation || !p) return null;
  const call = callFor(p, overrideFor(overrides, p.otcId, situation.season));
  const full = contractChip(p, situation.season);
  const deal = compact ? full.replace(/ · gtd '\d\d$/, "") : full;
  return (
    <>
      <span className={`${CHIP} ${TONE.neutral}`} title={dealTitle(p, situation.season)}>{deal}</span>
      {call && (
        <span className={`${CHIP} ${TONE[call.tone]}`} title={`${situation.season}: ${call.label}${call.source === "yours" ? " (your call)" : ""}\n${call.reasons.join("\n")}`}>
          {call.label}{call.source === "yours" ? " ✓" : ""}
        </span>
      )}
    </>
  );
}

function dealTitle(p: PlayerSituation, season: number): string {
  const lines = [
    p.endYear == null ? "No current deal" : `Signed through ${p.endYear}${p.freeAgency ? `, then ${p.freeAgency}` : ""}`,
    `APY ${money(p.apy)}${p.capHit != null ? ` · ${season} cap hit ${money(p.capHit)}${p.capHitEstimated ? " (est.)" : ""}` : ""}`,
  ];
  if (p.guaranteedThrough != null) lines.push(`Guaranteed through ${p.guaranteedThrough}${p.futureGuaranteed ? ` (${money(p.futureGuaranteed)} still to come)` : ""}`);
  if (p.fifthYearOption) lines.push(`5th-year option: ${p.fifthYearOption}`);
  if (p.invested) lines.push("The team has invested in him (a round 1–3 rookie deal or a big veteran deal)");
  return lines.join("\n");
}

function OddsRow({ room, season }: { room: RoomSituation; season: number }) {
  const pr = room.pressure;
  return (
    <p className="text-[11px] text-gray-400" title={`Measured on 2016–2026 drafts: how often a room like this added competition. ${pr.reasons.join("; ")}`}>
      {season} competition: round 1 <b className="text-gray-200">{pct(pr.round1)}</b> · day 1–2 <b className="text-gray-200">{pct(pr.day12)}</b> · day 3 {pct(pr.day3)} · veteran {pct(pr.veteran)}
    </p>
  );
}

/** The Player profile's card: his deal, the coming season's call (and the user's), and his room. */
export function ContractSituationCard({ sleeperId, position }: { sleeperId: string; position: string | undefined }) {
  const { situation, overrides, loading, error, setOverride, retry } = useContractSituation();
  if (!isRoomPos(position)) return null;
  const shell = (body: React.ReactNode) => (
    <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Contract &amp; situation</p>
      {body}
    </div>
  );
  if (!situation) {
    return shell(error
      ? <p className="text-xs text-gray-500">Couldn&apos;t load contracts ({error}). <button className="text-blue-400 hover:text-blue-300" onClick={retry}>Retry</button></p>
      : <p className="text-xs text-gray-500">{loading ? "Loading contracts…" : "—"}</p>);
  }
  const p = playerFor(situation, sleeperId);
  if (!p) return shell(<p className="text-xs text-gray-500">No current NFL deal on file (OverTheCap), or he isn&apos;t matched to Sleeper.</p>);

  const season = situation.season;
  const mine = overrideFor(overrides, p.otcId, season);
  const call = callFor(p, mine);
  const model = callFor(p, null);
  const team = situation.teams.find((t) => t.teamId === p.teamId);
  const room = team?.rooms[p.pos];
  const withCalls = room ? roomOpenWith(room, situation.players, overrides, season) : null;
  const choose = (c: OverrideCall | null) => setOverride(p.otcId, c);
  const btn = (active: boolean) => `px-2 py-0.5 rounded border text-[11px] ${active ? "border-blue-600 bg-blue-900/40 text-blue-200" : "border-gray-700 text-gray-400 hover:text-white"}`;

  return shell(
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${CHIP} ${TONE.neutral} text-[10px]`}>{contractChip(p, season)}</span>
        {call && <span className={`${CHIP} ${TONE[call.tone]} text-[10px]`}>{season}: {call.label}{call.source === "yours" ? " (your call)" : ""}</span>}
        <span className="text-[11px] text-gray-500">{p.importance}{p.age != null ? ` · ${Math.floor(p.age)} in ${season}` : ""}</span>
      </div>
      <p className="text-xs text-gray-300 whitespace-pre-line">{dealTitle(p, season)}</p>
      {p.cut?.savings != null && (
        <p className="text-[11px] text-gray-400">Released before {season}: saves {money(p.cut.savings)}, leaves {money(p.cut.deadMoney)} dead.</p>
      )}
      {model && (
        <ul className="text-[11px] text-gray-400 list-disc pl-4">
          {model.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      <div className="flex items-center gap-1.5" role="group" aria-label={`Your call on ${p.name} for ${season}`}>
        <span className="text-[11px] text-gray-500">Your call for {season}:</span>
        <button className={btn(mine == null)} onClick={() => choose(null)} aria-pressed={mine == null}>Model</button>
        <button className={btn(mine === "stays")} onClick={() => choose("stays")} aria-pressed={mine === "stays"}>Stays</button>
        <button className={btn(mine === "goes")} onClick={() => choose("goes")} aria-pressed={mine === "goes"}>Goes</button>
      </div>
      {room && withCalls && (
        <div className="border-t border-gray-800 pt-2 space-y-1">
          <p className="text-[11px] text-gray-400">
            {p.pos} room in {season}: {room.outlook[0]?.openSpots ?? 0} of {STARTING_SPOTS[p.pos]} starting spots open on contracts,{" "}
            <b className="text-gray-200">{withCalls.openSpots}</b> once likely cuts and re-signings{Object.keys(overrides).length ? " (and your calls)" : ""} count.
          </p>
          <OddsRow room={room} season={season} />
          {team && <p className="text-[11px] text-gray-500">{teamLine(team, season)}</p>}
        </div>
      )}
    </div>
  );
}

function teamLine(team: ContractSituationResponse["teams"][number], season: number): string {
  const picks = team.picks.map((pk) => `${pk.year} picks ${pk.byDay.join("/")} (day 1/2/3)${pk.conditional ? `, ${pk.conditional} conditional` : ""}`).join(" · ");
  const cap = team.cap[0];
  const space = cap?.space != null ? `${season} cap space ~${money(cap.space)}` : "";
  return [picks, space].filter(Boolean).join(" · ");
}

/** Trade Finder cards and the calculator: the contract warnings on both sides of a trade, always visible (the
 *  user, 2026-11-11: noted, not scored, "so I am aware while making trades"). Renders nothing when there's none. */
export function TradeContractNote({ give, receive }: { give: readonly string[]; receive: readonly string[] }) {
  const { situation, overrides } = useContractSituation();
  if (!situation) return null;
  const notes = (ids: readonly string[]) => ids.flatMap((id) => {
    const p = playerFor(situation, id);
    const note = p ? contractNote(p, overrideFor(overrides, p.otcId, situation.season), situation.season) : null;
    return p && note ? [{ p, note }] : [];
  });
  const sides = [
    { label: "You'd get", items: notes(receive) },
    { label: "You'd give", items: notes(give) },
  ].filter((s) => s.items.length);
  if (!sides.length) return null;
  return (
    <div className="mt-2 text-[10px] text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-semibold uppercase tracking-wider text-slate-500">Contracts</span>
      {sides.map((s) => (
        <span key={s.label} className="flex flex-wrap items-center gap-1">
          <span className="text-slate-500">{s.label}:</span>
          {s.items.map(({ p, note }) => {
            const why = callFor(p, overrideFor(overrides, p.otcId, situation.season))?.reasons ?? [];
            return (
              <span key={p.otcId} className={`${CHIP} ${TONE[note.tone]}`} title={why.join("\n")}>
                {p.name.split(" ").slice(-1)[0]}: {note.text}
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
}

/** Data Hub → Depth Charts: one line under a team's header for the shown position. */
export function RoomLine({ teamAbbr, pos }: { teamAbbr: string; pos: RoomPos }) {
  const { situation, overrides } = useContractSituation();
  const teamId = nflTeamId(teamAbbr);
  const team = situation?.teams.find((t) => t.teamId === teamId);
  if (!situation || !team) return null;
  const room = team.rooms[pos];
  const open = roomOpenWith(room, situation.players, overrides, situation.season);
  const pr = room.pressure;
  const title = [
    `${situation.season}: ${room.outlook[0]?.openSpots ?? 0} of ${STARTING_SPOTS[pos]} starting ${pos} spots open on contracts; ${open.openSpots} once likely cuts, re-signings and your calls count.`,
    `Odds of new competition (measured on 2016–2026): round 1 ${pct(pr.round1)}, day 1–2 ${pct(pr.day12)}, day 3 ${pct(pr.day3)}, an invested veteran ${pct(pr.veteran)}.`,
    teamLine(team, situation.season),
  ].join("\n");
  return (
    <div className="px-3 py-1 border-b border-slate-800/60 text-[10px] text-slate-400 flex flex-wrap gap-x-2" title={title}>
      <span>{situation.season}: <b className="text-slate-200">{open.openSpots}</b> open</span>
      <span>day 1–2 {pos} <b className="text-slate-200">{pct(pr.day12)}</b></span>
      <span>vet {pct(pr.veteran)}</span>
    </div>
  );
}
