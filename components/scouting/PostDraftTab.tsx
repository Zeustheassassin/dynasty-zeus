"use client";
// The Big Board's Post-Draft tab: load a class's NFL draft results (every
// pick, CollegeFootballData via POST /api/scouting/nfl-draft, cached in
// cfd_draft_picks by migration 090), review what changes for the prospects on
// the board, and apply it (round, overall pick, team). Dynasty+ then counts
// rookie competition (lib/scouting/landingSpot.ts). Classes from
// LANDING_FIRST_CLASS only: the 2026 class is left out (the user's call).

import { useMemo, useState } from "react";
import { UNDRAFTED_ROUND, draftRoundLabel, nflDraftSlotLabel } from "../../lib/draftRound";
import { logger } from "../../lib/logger";
import {
  draftChanges, draftSkillPosition, isCompleteDraft, matchDraftPicks,
  type DraftPickRow, type DraftResultUpdate, type NflDraftResponse,
} from "../../lib/nflDraft";
import { LANDING_FIRST_CLASS, type DynastyBreakdown } from "../../lib/scouting/dynastyScore";
import { landingLines } from "../../lib/scouting/landingSpot";
import type { Prospect } from "../../lib/types";

const log = logger("PostDraftTab");
const SKILL = new Set(["QB", "RB", "WR", "TE"]);

interface Props {
  prospects: readonly Prospect[];
  /** Stored picks from LANDING_FIRST_CLASS's draft on. */
  draftPicks: readonly DraftPickRow[];
  dynasty: ReadonlyMap<string, DynastyBreakdown>;
  landingWeight: number;
  onReloadDraftPicks?: () => void;
  onApplyDraftResults?: (updates: readonly DraftResultUpdate[]) => Promise<number>;
}

const slot = (round: number | null, pick: number | null, team: string | null) =>
  nflDraftSlotLabel({ team, round, pick }) ?? "—";

export default function PostDraftTab({ prospects, draftPicks, dynasty, landingWeight, onReloadDraftPicks, onApplyDraftResults }: Props) {
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
    <div className="max-w-4xl mx-auto space-y-4 text-sm">
      <p className="text-xs text-slate-400 text-center">
        After a draft: load its results, apply them to your prospects (round, pick, team), and Dynasty+ counts rookie
        competition (the players at his position his team drafted ahead of him; WRs and Move TEs count against each other). The {LANDING_FIRST_CLASS - 1} class
        is left out.
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
                  <th scope="col" className="text-left px-2 py-1">Rookie competition</th>
                  <th scope="col" className="text-right px-2 py-1">Dynasty+</th>
                </tr>
              </thead>
              <tbody>
                {drafted.map((p) => {
                  const d = dynasty.get(p.id);
                  const comp = d?.landing ? landingLines(d.landing, landingWeight).join(" ") : d ? "—" : "needs an AE Score";
                  return (
                    <tr key={p.id} className="border-t border-slate-800">
                      <td className="px-2 py-1 text-slate-200 whitespace-nowrap">{p.name}</td>
                      <td className="px-2 py-1 text-slate-400">{p.position}</td>
                      <td className="px-2 py-1 text-slate-300 whitespace-nowrap">
                        {p.draft_round === UNDRAFTED_ROUND ? "Undrafted" : `${draftRoundLabel(p.draft_round!)}${p.draft_pick ? ` #${p.draft_pick}` : ""}`}
                        {p.draft_team ? ` · ${p.draft_team}` : ""}
                      </td>
                      <td className="px-2 py-1 text-slate-400">{comp}</td>
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
