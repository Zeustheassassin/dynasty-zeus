"use client";
// The Big Board's Post-Draft tab, the one place for post-draft inputs: load a
// class's NFL draft results (every pick, CollegeFootballData via POST
// /api/scouting/nfl-draft, cached in cfd_draft_picks by migration 090), review
// what changes for the prospects on the board, and apply it (round, overall
// pick, team); then set each drafted player's Will Play (Post), the role
// bucket he'll play. Dynasty+ counts rookie competition and role standing
// (lib/scouting/landingSpot.ts, roleStanding.ts). Then load every team's room
// from PFF (POST /api/scouting/nfl-rooms: the live depth chart with the prior
// season's grades), save each drafted player's own room on his row
// (prospects.landing_inputs, migration 091), and enter or accept his team
// inputs: vets ahead, QB, offense and path by year 2 (teamLanding.ts).
// Classes from LANDING_FIRST_CLASS only: the 2026 class is left out (the
// user's call).

import { useMemo, useState } from "react";
import { UNDRAFTED_ROUND, draftRoundLabel, nflDraftSlotLabel } from "../../lib/draftRound";
import { logger } from "../../lib/logger";
import {
  draftChanges, draftSkillPosition, isCompleteDraft, matchDraftPicks,
  type DraftPickRow, type DraftResultUpdate, type NflDraftResponse,
} from "../../lib/nflDraft";
import { LANDING_FIRST_CLASS, type DynastyBreakdown, type DynastyWeights } from "../../lib/scouting/dynastyScore";
import { nflTeamId } from "../../lib/nflDraft";
import type { NflRoomsResponse, RoomPos } from "../../lib/nflRooms";
import { competitionLine, standingPoolText } from "../../lib/scouting/landingSpot";
import { roleInfo, type RoleFit, type RolePos } from "../../lib/scouting/roleFit";
import { poolRankText, rolePlayed, roleStandingText, type RoleStanding } from "../../lib/scouting/roleStanding";
import {
  ONE_STARTER, OFFENSE_LABEL, OFFENSE_LEANS, PATH_CALLS, PATH_LABEL, offenseLine, pathLine, patchedLandingInputs, qbLine, resolveTeamLanding,
  snapPlayerText, suggestedOffense, suggestedPath, suggestedVetsAhead, teamSnapshotFor, vetsAheadLabel, vetsAheadLine, vetsAheadMax,
  type LandingSaved, type TeamLanding, type TeamSnapshot,
} from "../../lib/scouting/teamLanding";
import type { Prospect } from "../../lib/types";
import { WillPlayPostSelect } from "./shared/RoleFields";
import { ContractOutlookSection } from "./ContractOutlookSection";

const log = logger("PostDraftTab");
const SKILL = new Set(["QB", "RB", "WR", "TE"]);

interface Props {
  prospects: readonly Prospect[];
  /** Stored picks from LANDING_FIRST_CLASS's draft on. */
  draftPicks: readonly DraftPickRow[];
  dynasty: ReadonlyMap<string, DynastyBreakdown>;
  weights: DynastyWeights;
  roleFits: ReadonlyMap<string, RoleFit>;
  /** Role standing per 2027+ prospect with a role (roleStandings). */
  standings: ReadonlyMap<string, RoleStanding>;
  onReloadDraftPicks?: () => void;
  onApplyDraftResults?: (updates: readonly DraftResultUpdate[]) => Promise<number>;
  onUpdateWillPlayPost?: (id: string, value: string) => Promise<boolean>;
  /** Save prospects' team inputs (whole new values); resolves with how many failed. */
  onSaveLandingInputs?: (updates: readonly { id: string; next: LandingSaved | null }[]) => Promise<number>;
}

const slot = (round: number | null, pick: number | null, team: string | null) =>
  nflDraftSlotLabel({ team, round, pick }) ?? "—";

const sgn2 = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
const isRoomPos = (pos: string): pos is RoomPos => pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE";
const dateOf = (iso: string) => iso.slice(0, 10);
const SELECT_CLS = "bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs px-1 py-0.5 focus:outline-none focus:border-teal-500 disabled:opacity-50";

/** A room in a line: "vets ahead 2 (Smith 90.5 (88%), …) · QB Hurts 78.2 · pass-heavy". */
function snapshotSummary(snap: TeamSnapshot, pos: RoomPos, classYear: number): string {
  const ahead = suggestedVetsAhead(snap, pos);
  const parts = [`vets ahead ${vetsAheadLabel(pos, ahead.length)}${ahead.length ? ` (${ahead.map(snapPlayerText).join(", ")})` : ""}`];
  const path = suggestedPath(pos, classYear, snap, ahead);
  if (path.call === "opens") parts.push(`path opens (${path.why})`);
  if (pos !== "QB") parts.push(snap.qb ? `QB ${snap.qb.name}${snap.qb.rookie ? " (rookie)" : snap.qb.grade != null ? ` ${snap.qb.grade.toFixed(1)}` : " (no grade)"}` : "no QB listed");
  const lean = suggestedOffense(snap.passOe);
  if (lean) parts.push(OFFENSE_LABEL[lean].toLowerCase());
  return parts.join(" · ");
}

/** The QB grade box: blank shows the suggestion; Enter or leaving it saves, Escape cancels. */
function QbGradeInput({ value, suggested, onSave, label, disabled }: {
  value: number | null;
  suggested: number | null;
  onSave: (v: number | null) => void;
  label: string;
  disabled?: boolean;
}) {
  const shown = value != null ? String(value) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? shown;
  function commit() {
    const t = text.trim();
    setDraft(null);
    const v = t === "" ? null : Math.round(Number(t) * 10) / 10;
    if (v != null && (!Number.isFinite(v) || v < 0 || v > 100)) return;
    if (v !== value) onSave(v);
  }
  return (
    <input type="text" inputMode="decimal" value={text} disabled={disabled} aria-label={label}
      placeholder={suggested != null ? suggested.toFixed(1) : "—"}
      title="His starting QB's passing grade (0–100). Blank = the suggestion from the saved room."
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setDraft(shown); (e.target as HTMLInputElement).blur(); }
      }}
      className={`w-14 ${SELECT_CLS} placeholder:text-slate-500`} />
  );
}

export default function PostDraftTab({
  prospects, draftPicks, dynasty, weights, roleFits, standings, onReloadDraftPicks, onApplyDraftResults, onUpdateWillPlayPost,
  onSaveLandingInputs,
}: Props) {
  const thisYear = new Date().getFullYear();
  const years = useMemo(
    () => [...new Set(prospects.map((p) => p.draft_class_year).filter((y): y is number => y != null && y >= LANDING_FIRST_CLASS))].sort((a, b) => a - b),
    [prospects],
  );
  const [year, setYear] = useState<number | null>(null);
  const shown = year ?? years[0] ?? null;

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every team's room as last loaded from PFF (not saved until "Save rooms").
  const [rooms, setRooms] = useState<NflRoomsResponse | null>(null);

  const yearPicks = useMemo(() => draftPicks.filter((pk) => pk.year === shown), [draftPicks, shown]);
  const complete = isCompleteDraft(yearPicks);
  const changes = useMemo(() => (shown == null ? [] : draftChanges(prospects, draftPicks, shown)), [prospects, draftPicks, shown]);

  const classSkill = useMemo(() => prospects.filter((p) => p.draft_class_year === shown && SKILL.has(p.position)), [prospects, shown]);
  const matchedIds = useMemo(
    () => new Set(shown == null ? [] : matchDraftPicks(classSkill, yearPicks).keys()),
    [classSkill, yearPicks, shown],
  );
  // On the board, not in a finished draft, and not already marked undrafted.
  const notDrafted = useMemo(
    () => (complete ? classSkill.filter((p) => !matchedIds.has(p.id) && p.draft_round !== UNDRAFTED_ROUND) : []),
    [complete, classSkill, matchedIds],
  );
  const drafted = useMemo(
    () => classSkill.filter((p) => p.draft_round != null).sort((a, b) => (a.draft_pick ?? 999) - (b.draft_pick ?? 999) || (a.draft_round! - b.draft_round!)),
    [classSkill],
  );
  const boardPicks = yearPicks.filter((pk) => draftSkillPosition(pk.position) != null).length;

  // His role halves the QB and offense values for a Blocking TE, as in Dynasty+ (landingInputsFrom).
  const team = useMemo(
    () => new Map(drafted.map((p) => [p.id, resolveTeamLanding(p, rolePlayed(p, roleFits.get(p.id))?.role ?? null)])),
    [drafted, roleFits],
  );
  // After a load: each drafted player's room from it, split into rooms not saved
  // yet (or saved for another team) and rooms that would replace a saved one.
  const roomRows = useMemo(() => {
    if (!rooms || rooms.year !== shown) return null;
    const byTeam = new Map(rooms.teams.map((t) => [t.teamId, t]));
    const fresh: { p: Prospect; snap: TeamSnapshot }[] = [];
    const replace: { p: Prospect; snap: TeamSnapshot }[] = [];
    const noTeam: Prospect[] = [];
    for (const p of drafted) {
      const room = byTeam.get(nflTeamId(p.draft_team) ?? -1);
      if (!room || !isRoomPos(p.position)) { noTeam.push(p); continue; }
      const snap = teamSnapshotFor(rooms, room, p.position);
      const saved = p.landing_inputs?.pff;
      (saved && saved.teamId === room.teamId ? replace : fresh).push({ p, snap });
    }
    return { fresh, replace, noTeam };
  }, [rooms, shown, drafted]);
  const inSeason = shown != null && Date.now() >= Date.UTC(shown, 8, 1);

  async function load() {
    if (shown == null) return;
    setBusy(true); setError(null); setStatus(null);
    try {
      // Loaded on click: the client module opens the Supabase client.
      const { pffAuthHeader } = await import("./pff/pffClient");
      const res = await fetch("/api/scouting/nfl-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await pffAuthHeader()) },
        body: JSON.stringify({ year: shown }),
      });
      const body = (await res.json().catch(() => null)) as (NflDraftResponse & { error?: string }) | null;
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
      onReloadDraftPicks?.();
      setStatus(body.picks.length
        ? `${body.picks.length} picks${isCompleteDraft(body.picks) ? "" : " so far (the draft isn't finished)"}${body.fetched && body.remaining != null ? ` · CollegeFootballData calls left this month: ${body.remaining}` : ""}`
        : `CollegeFootballData has no ${shown} picks yet.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("load draft results", { msg });
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function saveWillPlay(p: Prospect, value: string) {
    if (!onUpdateWillPlayPost) return;
    setError(null);
    const ok = await onUpdateWillPlayPost(p.id, value);
    if (!ok) setError(`${p.name}'s Will Play (Post) didn't save; try again.`);
  }

  async function loadRooms() {
    if (shown == null) return;
    setBusy(true); setError(null); setStatus(null);
    try {
      const { pffAuthHeader } = await import("./pff/pffClient");
      const res = await fetch("/api/scouting/nfl-rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await pffAuthHeader()) },
        body: JSON.stringify({ year: shown }),
      });
      const body = (await res.json().catch(() => null)) as (NflRoomsResponse & { error?: string }) | null;
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setRooms(body);
      setStatus(`${body.teams.length} teams' rooms read from PFF${body.missing.length ? ` (not read: ${body.missing.join(", ")})` : ""}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("load NFL rooms", { msg });
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function saveRooms(rows: readonly { p: Prospect; snap: TeamSnapshot }[], what: string) {
    if (!onSaveLandingInputs || rows.length === 0) return;
    setBusy(true); setError(null);
    const failed = await onSaveLandingInputs(rows.map(({ p, snap }) => ({ id: p.id, next: patchedLandingInputs(p.landing_inputs, { pff: snap }) })));
    setBusy(false);
    if (failed) setError(`${failed} of ${rows.length} didn't save; is migration 091 applied?`);
    else setStatus(`${what}: ${rows.length} saved.`);
  }

  async function savePatches(rows: readonly { p: Prospect; patch: Partial<LandingSaved> }[], what: string) {
    if (!onSaveLandingInputs || rows.length === 0) return;
    setBusy(true); setError(null);
    const failed = await onSaveLandingInputs(rows.map(({ p, patch }) => ({ id: p.id, next: patchedLandingInputs(p.landing_inputs, patch) })));
    setBusy(false);
    if (failed) setError(`${failed} of ${rows.length} didn't save; is migration 091 applied?`);
    else setStatus(`${what}: ${rows.length} saved.`);
  }

  async function saveEntry(p: Prospect, patch: Partial<LandingSaved>) {
    if (!onSaveLandingInputs) return;
    setError(null);
    const failed = await onSaveLandingInputs([{ id: p.id, next: patchedLandingInputs(p.landing_inputs, patch) }]);
    if (failed) setError(`${p.name}'s team inputs didn't save; is migration 091 applied?`);
  }

  async function apply(updates: readonly DraftResultUpdate[], what: string) {
    if (!onApplyDraftResults || updates.length === 0) return;
    setBusy(true); setError(null);
    const failed = await onApplyDraftResults(updates);
    setBusy(false);
    if (failed) setError(`${failed} of ${updates.length} didn't save; try again.`);
    else setStatus(`${what}: ${updates.length} saved.`);
  }

  if (shown == null) {
    return <p className="text-sm text-slate-500 text-center py-12">No {LANDING_FIRST_CLASS}+ class on the board yet.</p>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4 text-sm">
      <p className="text-xs text-slate-400 text-center">
        After a draft: load its results, apply them to your prospects (round, pick, team), then set each drafted
        player&apos;s Will Play (Post), the role he&apos;ll play. Dynasty+ counts rookie competition (the players at his position his
        team drafted ahead of him; WRs and Move TEs count against each other) and role standing (his rank among his class&apos;s
        players at that role; blank = his best role bucket). Then load every team&apos;s room from PFF (its depth chart today, with
        last season&apos;s grades) and save each player&apos;s: it suggests his vets ahead, path by year 2, QB and offense, and
        anything you enter wins. Load the rooms soon after the draft; a saved room never changes. The {LANDING_FIRST_CLASS - 1} class is left out.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="text-slate-400">Class:</span>
        {years.map((y) => (
          <button key={y} onClick={() => { setYear(y); setStatus(null); setError(null); }} aria-pressed={y === shown}
            className={`px-3 py-1 rounded text-xs font-medium transition ${y === shown ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
          >{y}</button>
        ))}
        <button onClick={() => { void load(); }} disabled={busy || shown > thisYear}
          className="px-3 py-1 rounded text-xs font-medium bg-teal-700 text-white hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? "Working…" : `Load ${shown} draft results`}
        </button>
        <button onClick={() => { void loadRooms(); }} disabled={busy || shown > thisYear}
          title="Every team's QB / RB / WR / TE room on PFF's depth chart today, with last season's grades and pass rates (about 35 PFF reads)"
          className="px-3 py-1 rounded text-xs font-medium bg-indigo-700 text-white hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed">
          Load NFL rooms (PFF)
        </button>
      </div>

      <p className="text-xs text-center text-slate-500" aria-live="polite">
        {shown > thisYear
          ? `The ${shown} draft is in late April ${shown}.`
          : yearPicks.length
            ? `${yearPicks.length} picks stored (${boardPicks} QB/RB/WR/TE)${complete ? "" : ", not the whole draft yet"}.`
            : `No ${shown} picks stored yet.`}
        {status && <span className="text-teal-400"> {status}</span>}
        {error && <span className="text-red-400"> {error}</span>}
      </p>

      {changes.length > 0 && (
        <section aria-labelledby="pd-changes" className="border border-slate-800 rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 id="pd-changes" className="font-semibold text-slate-200">Changes from the draft ({changes.length})</h3>
            <button onClick={() => { void apply(changes.map((c) => c.update), "Draft results"); }} disabled={busy || !onApplyDraftResults}
              className="px-3 py-1 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40">Apply all</button>
          </div>
          <ul className="space-y-0.5 text-xs">
            {changes.map(({ p, update }) => (
              <li key={p.id} className="flex flex-wrap gap-x-2">
                <span className="text-slate-200">{p.name}</span>
                <span className="text-slate-500">{p.position} · {p.school}</span>
                <span className="text-slate-500">{slot(p.draft_round, p.draft_pick, p.draft_team)} →</span>
                <span className="text-teal-300">{slot(update.draft_round, update.draft_pick, update.draft_team)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notDrafted.length > 0 && (
        <section aria-labelledby="pd-undrafted" className="border border-slate-800 rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 id="pd-undrafted" className="font-semibold text-slate-200">On your board, not found in the draft ({notDrafted.length})</h3>
            <button
              onClick={() => { void apply(notDrafted.map((p) => ({ id: p.id, draft_round: UNDRAFTED_ROUND, draft_pick: null, draft_team: p.draft_team })), "Undrafted"); }}
              disabled={busy || !onApplyDraftResults}
              className="px-3 py-1 rounded text-xs font-medium bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-40">Mark all undrafted</button>
          </div>
          <p className="text-xs text-slate-500 mb-1">{"A name that's spelled differently in the draft shows here too: set his round in the board's Round column instead."}</p>
          <p className="text-xs text-slate-300">{notDrafted.map((p) => `${p.name} (${p.position})`).join(", ")}</p>
        </section>
      )}

      {roomRows && rooms && (
        <section aria-labelledby="pd-rooms" className="border border-slate-800 rounded p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 id="pd-rooms" className="font-semibold text-slate-200">
              Team rooms from PFF <span className="text-slate-500 font-normal">(depth charts {dateOf(rooms.asOf)}, grades from {rooms.season})</span>
            </h3>
            <div className="flex gap-2">
              <button onClick={() => { void saveRooms(roomRows.fresh, "Rooms"); }} disabled={busy || !onSaveLandingInputs || roomRows.fresh.length === 0}
                className="px-3 py-1 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40">Save rooms ({roomRows.fresh.length})</button>
              {roomRows.replace.length > 0 && (
                <button onClick={() => { void saveRooms(roomRows.replace, "Rooms replaced"); }} disabled={busy || !onSaveLandingInputs}
                  title="Replace the rooms already saved for these players with today's"
                  className="px-3 py-1 rounded text-xs font-medium bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-40">Replace saved ({roomRows.replace.length})</button>
              )}
            </div>
          </div>
          {inSeason && (
            <p className="text-xs text-amber-400 mb-1">
              The {shown} season has started: today&apos;s depth charts show how the rookies have played. Replace a saved room only if you mean to.
            </p>
          )}
          <ul className="space-y-0.5 text-xs">
            {[...roomRows.fresh, ...roomRows.replace].map(({ p, snap }) => (
              <li key={p.id} className="flex flex-wrap gap-x-2">
                <span className="text-slate-200">{p.name}</span>
                <span className="text-slate-500">{p.position} · {snap.team}</span>
                <span className="text-slate-300">{snapshotSummary(snap, p.position as RoomPos, p.draft_class_year)}</span>
                {p.landing_inputs?.pff?.teamId === snap.teamId && <span className="text-slate-500">(saved {dateOf(p.landing_inputs.pff.asOf)})</span>}
              </li>
            ))}
          </ul>
          {roomRows.noTeam.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">No room (no NFL team set, or its depth chart wasn&apos;t read): {roomRows.noTeam.map((p) => p.name).join(", ")}</p>
          )}
        </section>
      )}

      {drafted.length > 0 && (
        <ContractOutlookSection classYear={shown} drafted={drafted} team={team} busy={busy}
          onSave={onSaveLandingInputs ? (rows, what) => { void savePatches(rows, what); } : undefined} />
      )}

      <section aria-labelledby="pd-drafted">
        <h3 id="pd-drafted" className="font-semibold text-slate-200 mb-2">Drafted ({drafted.length})</h3>
        {drafted.length === 0 ? (
          <p className="text-xs text-slate-500">Nobody in the {shown} class has a round set yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th scope="col" className="text-left px-2 py-1">Player</th>
                  <th scope="col" className="text-left px-2 py-1">Pos</th>
                  <th scope="col" className="text-left px-2 py-1">Drafted</th>
                  <th scope="col" className="text-left px-2 py-1" title="The role bucket he'll play on his NFL team. Blank = his best role bucket (Should Play).">Will Play (Post)</th>
                  <th scope="col" className="text-left px-2 py-1" title="His rank at that role among his class's players who play it (this counts), and across every 2027+ class (shown only). Weighted by the Role slider.">Role standing</th>
                  <th scope="col" className="text-left px-2 py-1" title="Rookie competition: the players at his position (WRs and Move TEs count against each other) his team drafted ahead of him, and the cost. Landing slider.">Rookies ahead</th>
                  <th scope="col" className="text-left px-2 py-1" title="Established veterans at his position he has to pass: regulars graded above their position's bottom quarter last season. Auto = the count from his saved room. Landing slider.">Vets ahead</th>
                  <th scope="col" className="text-left px-2 py-1" title="Does the way open, stay the same, or close by his second season? Auto opens when a veteran ahead will be past his prime (or, ahead of a QB, is a bridge). Landing slider.">Path Y2</th>
                  <th scope="col" className="text-left px-2 py-1" title="His starting QB's passing grade last season (not for a QB). Blank = the depth chart's first QB, from his saved room. Offense slider.">QB</th>
                  <th scope="col" className="text-left px-2 py-1" title="Pass-heavy / balanced / run-heavy. Auto from last season's pass rate over expectation (±3%). Offense slider.">Offense</th>
                  <th scope="col" className="text-right px-2 py-1">Dynasty+</th>
                </tr>
              </thead>
              <tbody>
                {drafted.map((p) => {
                  const d = dynasty.get(p.id);
                  const comp = d?.landing ? competitionLine(d.landing, weights.landing) : d ? "—" : "needs an AE Score";
                  const competition = d?.landing?.competition ?? null;
                  const st = standings.get(p.id);
                  const fit = roleFits.get(p.id);
                  const t = team.get(p.id) ?? null;
                  return (
                    <tr key={p.id} className="border-t border-slate-800">
                      <td className="px-2 py-1 text-slate-200 whitespace-nowrap">{p.name}</td>
                      <td className="px-2 py-1 text-slate-400">{p.position}</td>
                      <td className="px-2 py-1 text-slate-300 whitespace-nowrap">
                        {p.draft_round === UNDRAFTED_ROUND ? "Undrafted" : `${draftRoundLabel(p.draft_round!)}${p.draft_pick ? ` #${p.draft_pick}` : ""}`}
                        {p.draft_team ? ` · ${p.draft_team}` : ""}
                      </td>
                      <td className="px-2 py-1">
                        <WillPlayPostSelect pos={p.position as RolePos} value={p.will_play_post ?? ""}
                          onChange={(v) => { void saveWillPlay(p, v); }} disabled={!onUpdateWillPlayPost}
                          ariaLabel={`Will Play (Post) for ${p.name}`}
                          className="bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs px-1 py-0.5 focus:outline-none focus:border-teal-500 disabled:opacity-50" />
                        {!p.will_play_post?.trim() && fit && (
                          <span className="block text-[10px] text-slate-500">best: {roleInfo(fit.best).label}</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-slate-300 whitespace-nowrap"
                        title={st ? `${roleStandingText(st, p.draft_class_year)}\n${standingPoolText(st, p.draft_class_year, p.id)}` : "No role fit yet (not enough tape)"}>
                        {st ? (
                          <>
                            {roleInfo(st.role).label} {st.pct}% · {poolRankText(st.inClass)}
                            <span className="text-slate-500"> ({poolRankText(st.allClasses)} all)</span>
                            <span className={`ml-1 font-semibold ${st.value > 0 ? "text-emerald-400" : st.value < 0 ? "text-red-400" : "text-slate-500"}`}>
                              {sgn2(weights.role * st.value)}
                            </span>
                          </>
                        ) : "—"}
                      </td>
                      <td className="px-2 py-1 text-slate-400 whitespace-nowrap" title={comp}>
                        {competition ? `${competition.competitors.length} · ${sgn2(weights.landing * competition.value)}` : "—"}
                      </td>
                      {t ? (
                        <TeamCells p={p} t={t} weights={weights} disabled={!onSaveLandingInputs} onSave={(patch) => { void saveEntry(p, patch); }} />
                      ) : <td colSpan={4} className="px-2 py-1 text-slate-600">—</td>}
                      <td className={`px-2 py-1 text-right font-semibold ${d?.plus == null ? "text-slate-600" : d.plus >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {d?.plus == null ? "—" : `${d.plus >= 0 ? "+" : ""}${d.plus.toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** The four team-input cells: vets ahead and path (Landing), QB and offense (Offense). Blank = the suggestion. */
function TeamCells({ p, t, weights, disabled, onSave }: {
  p: Prospect;
  t: TeamLanding;
  weights: DynastyWeights;
  disabled: boolean;
  onSave: (patch: Partial<LandingSaved>) => void;
}) {
  const pos = t.pos;
  const saved = p.landing_inputs ?? null;
  const snap = t.snapshot;
  const ahead = snap ? suggestedVetsAhead(snap, pos) : [];
  const autoVets = snap ? `Auto: ${vetsAheadLabel(pos, ahead.length)}` : "—";
  const autoPath = snap ? `Auto: ${PATH_LABEL[suggestedPath(pos, p.draft_class_year, snap, ahead).call]}` : "—";
  const pffLean = snap ? suggestedOffense(snap.passOe) : null;
  const autoLean = pffLean ? `Auto: ${OFFENSE_LABEL[pffLean]}` : "—";
  const pffQb = snap?.qb && !snap.qb.rookie ? snap.qb.grade : null;
  const roomTitle = snap
    ? `${snap.team}, depth chart ${dateOf(snap.asOf)}, ${snap.season} grades:\n${snap.room.map(snapPlayerText).join("\n") || "no veterans at his position"}${snap.bar ? `\nEstablished = 40%+ of snaps and ${snap.bar.regular.toFixed(1)}+ (or 15%+ and ${snap.bar.star.toFixed(1)}+).` : ""}${ONE_STARTER[pos] ? "\nThe first on the depth chart counts at 40%+ of snaps whatever his grade (one starting spot)." : ""}`
    : t.stale ? "The saved room is for another team: load the rooms and save his again." : "No room saved yet: load the NFL rooms and save them.";
  const tone = (v: number) => (v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "text-slate-500");
  const val = (v: number) => <span className={`ml-1 ${tone(v)}`}>{sgn2(v)}</span>;
  return (
    <>
      <td className="px-2 py-1 whitespace-nowrap" title={`${vetsAheadLine(t, weights.landing)}\n${roomTitle}`}>
        <select className={SELECT_CLS} value={saved?.vetsAhead ?? ""} disabled={disabled} aria-label={`Vets ahead for ${p.name}`}
          onChange={(e) => onSave({ vetsAhead: e.target.value === "" ? null : Number(e.target.value) })}>
          <option value="">{autoVets}</option>
          {Array.from({ length: vetsAheadMax(pos) + 1 }, (_, n) => <option key={n} value={n}>{vetsAheadLabel(pos, n)}</option>)}
        </select>
        {val(weights.landing * t.values.pecking)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap" title={pathLine(t, weights.landing)}>
        <select className={SELECT_CLS} value={saved?.path ?? ""} disabled={disabled} aria-label={`Path by year 2 for ${p.name}`}
          onChange={(e) => onSave({ path: e.target.value === "" ? null : (e.target.value as LandingSaved["path"]) })}>
          <option value="">{autoPath}</option>
          {PATH_CALLS.map((c) => <option key={c} value={c}>{PATH_LABEL[c]}</option>)}
        </select>
        {val(weights.landing * t.values.path)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap" title={qbLine(t, weights.offense) ?? "Not for a QB: vets ahead and the path say whether he plays."}>
        {pos === "QB" ? <span className="text-slate-600">n/a</span> : (
          <>
            <QbGradeInput value={saved?.qbGrade ?? null} suggested={pffQb} disabled={disabled} label={`QB grade for ${p.name}`}
              onSave={(v) => onSave({ qbGrade: v })} />
            {val(weights.offense * t.values.qb)}
          </>
        )}
      </td>
      <td className="px-2 py-1 whitespace-nowrap" title={offenseLine(t, weights.offense)}>
        <select className={SELECT_CLS} value={saved?.offense ?? ""} disabled={disabled} aria-label={`Offense for ${p.name}`}
          onChange={(e) => onSave({ offense: e.target.value === "" ? null : (e.target.value as LandingSaved["offense"]) })}>
          <option value="">{autoLean}</option>
          {OFFENSE_LEANS.map((l) => <option key={l} value={l}>{OFFENSE_LABEL[l]}</option>)}
        </select>
        {val(weights.offense * t.values.offense)}
      </td>
    </>
  );
}
