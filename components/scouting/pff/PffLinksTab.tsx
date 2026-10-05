"use client";
// Scouting → PFF Links: which PFF player each prospect is, and which PFF game
// each charted game is (migration 062). The matcher (/api/pff/match) links
// what it's sure of; this is where the user confirms the doubtful ones and
// overrides any it got wrong, and where PFF's numbers for exactly these games are imported
// and refreshed (migration 063). PFF data stays in the user's own rows.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContextFill } from "../context/useContextFill";
import type { PffCandidate, PffGameOption } from "../../../lib/pff/api";
import type { PffTotals } from "../../../lib/pff/totals";
import { POS_COLOR, STATUS_CLASSES } from "../../../lib/uiTheme";
import { fetchPffGames, needsImport, searchPffPlayers, usePffLinks, type LinkGame, type LinkProspect } from "./usePffLinks";

type Badge = { label: string; cls: string; hint: string };
const MUTED = "border-slate-700 bg-slate-900 text-slate-400";
const BLUE = "border-blue-800 bg-blue-950/40 text-blue-300";

const PLAYER_BADGE: Record<string, Badge> = {
  auto:      { label: "Linked",     cls: STATUS_CLASSES.good,     hint: "Linked automatically: he played the charted games" },
  confirmed: { label: "Confirmed",  cls: BLUE,                    hint: "Your call; the matcher won't change it" },
  review:    { label: "Review",     cls: STATUS_CLASSES.warning,  hint: "A doubtful guess, waiting on you" },
  not_found: { label: "Not found",  cls: STATUS_CLASSES.critical, hint: "No fitting PFF player found" },
  none:      { label: "Not in PFF", cls: MUTED,                   hint: "You marked him as not in PFF" },
  "":        { label: "Not run",    cls: MUTED,                   hint: "Not matched yet" },
};

const GAME_BADGE: Record<string, Badge> = {
  auto:        { label: "Matched",     cls: STATUS_CLASSES.good,     hint: "Found in his PFF game log" },
  confirmed:   { label: "Confirmed",   cls: BLUE,                    hint: "Your call; the matcher won't change it" },
  review:      { label: "Review",      cls: STATUS_CLASSES.warning,  hint: "A guess (e.g. two games vs the same team), waiting on you" },
  not_charted: { label: "No PFF row",  cls: STATUS_CLASSES.serious,  hint: "The game is on his team's PFF schedule but PFF has no row for him" },
  no_match:    { label: "No match",    cls: STATUS_CLASSES.critical, hint: "No game vs this opponent in his PFF log or schedule" },
  no_player:   { label: "No player",   cls: MUTED,                   hint: "The prospect isn't linked to a PFF player" },
  none:        { label: "No PFF game", cls: MUTED,                   hint: "You marked it as having no PFF game" },
  "":          { label: "Not run",     cls: MUTED,                   hint: "Not matched yet" },
};

const ATTENTION_PLAYER = new Set(["", "review", "not_found"]);
const ATTENTION_GAME = new Set(["", "review", "not_charted", "no_match"]);

function StatusBadge({ badge }: { badge: Badge }) {
  return (
    <span title={badge.hint} className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
      {badge.label}
    </span>
  );
}

const btn = "rounded border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40";

/** `onStatsChanged`: reload the hub's PFF columns after an import. */
export default function PffLinksTab({ onStatsChanged }: { onStatsChanged?: () => void }) {
  // After every import, its prospects' game context is filled in too.
  const queueRef = useRef<((ids: string[]) => void) | null>(null);
  const afterImport = useCallback((ids: string[]) => queueRef.current?.(ids), []);
  const s = usePffLinks(onStatsChanged, afterImport);
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const running = s.progress != null || s.importProgress != null;
  // Game context (migration 065): fills itself on open and after imports.
  const ctx = useContextFill(s.games, running || s.loading, onStatsChanged);
  useEffect(() => { queueRef.current = ctx.queue; }, [ctx.queue]);
  const statsReady = s.statsError == null;

  const gamesByProspect = useMemo(() => {
    const m = new Map<string, LinkGame[]>();
    for (const g of s.games) m.set(g.prospect_id, [...(m.get(g.prospect_id) ?? []), g]);
    for (const list of m.values()) list.sort((a, b) => a.season_year - b.season_year || a.game_slot - b.game_slot);
    return m;
  }, [s.games]);

  const needsAttention = (p: LinkProspect) =>
    ATTENTION_PLAYER.has(p.pff_match_status ?? "")
    || (gamesByProspect.get(p.id) ?? []).some((g) => ATTENTION_GAME.has(g.pff_match_status ?? ""))
    || (statsReady && needsImport(p, s.totals.get(p.id)));

  // PFF stats: prospects missing some, and every prospect with a linked game.
  const toImport = s.prospects.filter((p) => needsImport(p, s.totals.get(p.id))).map((p) => p.id);
  const withLinkedGames = s.prospects.filter((p) => (s.totals.get(p.id)?.linked ?? 0) > 0).map((p) => p.id);
  const statTotals = [...s.totals.values()].reduce(
    (acc, t) => ({ linked: acc.linked + t.linked, imported: acc.imported + t.games, stale: acc.stale + (t.seasonsCurrent < t.seasons ? 1 : 0) }),
    { linked: 0, imported: 0, stale: 0 },
  );

  const notRun = useMemo(() => s.prospects
    .filter((p) => p.pff_match_status == null || (gamesByProspect.get(p.id) ?? []).some((g) => g.pff_match_status == null))
    .map((p) => p.id), [s.prospects, gamesByProspect]);

  const count = <T,>(rows: T[], key: (r: T) => string | null) =>
    rows.reduce<Record<string, number>>((acc, r) => { const k = key(r) ?? ""; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  const playerCounts = count(s.prospects, (p) => p.pff_match_status);
  const gameCounts = count(s.games, (g) => g.pff_match_status);

  const q = search.trim().toLowerCase();
  const list = s.prospects
    .filter((p) => (filter === "all" || needsAttention(p)) && (!q || `${p.name} ${p.school}`.toLowerCase().includes(q)))
    .sort((a, b) => a.draft_class_year - b.draft_class_year || a.position.localeCompare(b.position) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-3 max-w-5xl mx-auto">
      <p className="text-xs text-slate-400">
        Links each prospect to his PFF player and each charted game to its PFF game, so PFF&apos;s numbers come
        from exactly the games you charted. Sure matches link themselves; confirm or fix the rest here. Newly
        matched games get their PFF stats right away; Import / Refresh re-reads them.
      </p>

      {s.error && <div className="rounded border border-red-800 bg-red-900/30 px-3 py-2 text-xs text-red-300">{s.error}</div>}
      {s.statsError && <div className="rounded border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">{s.statsError}</div>}
      {ctx.error && <div className="rounded border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">{ctx.error}</div>}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
        <Summary title="Players" counts={playerCounts} badges={PLAYER_BADGE} />
        <Summary title="Charted games" counts={gameCounts} badges={GAME_BADGE} />
        <div className="rounded border border-slate-800 bg-slate-900/40 px-3 py-2">
          <div className="mb-1 font-semibold text-slate-300">PFF stats</div>
          <div className="flex flex-wrap gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 ${STATUS_CLASSES.good}`} title="Linked charted games with PFF stats imported">
              Imported {statTotals.imported} / {statTotals.linked} games
            </span>
            {toImport.length > 0 && (
              <span className={`rounded border px-1.5 py-0.5 ${STATUS_CLASSES.warning}`} title="Prospects with a linked game not imported, or grades for a different set of games">
                To import {toImport.length}
              </span>
            )}
            {statTotals.stale > 0 && (
              <span className={`rounded border px-1.5 py-0.5 ${STATUS_CLASSES.serious}`} title="A game link changed since the import: grades and splits are blank until a refresh">
                Out of date {statTotals.stale}
              </span>
            )}
          </div>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/40 px-3 py-2">
          <div className="mb-1 font-semibold text-slate-300">Game context</div>
          <div className="flex flex-wrap gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 ${STATUS_CLASSES.good}`} title="Charted games matched to their CollegeFootballData game (opponent defense SP+, venue, kickoff)">
              Opponent {ctx.coverage.matched} / {ctx.coverage.games}
            </span>
            <span className={`rounded border px-1.5 py-0.5 ${STATUS_CLASSES.good}`} title="Games with game-time weather (domes count; Open-Meteo archive)">
              Weather {ctx.coverage.weather}
            </span>
            <span className={`rounded border px-1.5 py-0.5 ${STATUS_CLASSES.good}`} title="Games with his line's block grades and his QB's grade (PFF)">
              Cast {ctx.coverage.cast}
            </span>
            {ctx.coverage.pending > 0 && (
              <span className={`rounded border px-1.5 py-0.5 ${MUTED}`} title="Recent games: the weather archive runs about five days behind; filled automatically later">
                Weather pending {ctx.coverage.pending}
              </span>
            )}
            {ctx.toFill.length > 0 && (
              <span className={`rounded border px-1.5 py-0.5 ${STATUS_CLASSES.warning}`} title="Prospects with a game the fill would add to">
                To fill {ctx.toFill.length}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => s.runMatch(notRun)}
          disabled={running || s.loading || notRun.length === 0}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Match {notRun.length} not run
        </button>
        <button
          onClick={() => s.runMatch(s.prospects.map((p) => p.id))}
          disabled={running || s.loading || s.prospects.length === 0}
          title="Re-check every prospect (your confirmed calls stay). About 2–3 PFF reads per prospect."
          className={btn + " py-1.5"}
        >
          Re-check all
        </button>
        <button
          onClick={() => s.runImport(toImport)}
          disabled={running || s.loading || !statsReady || toImport.length === 0}
          title="Read PFF's stats for linked games not imported yet (about 5 PFF reads per prospect-season)"
          className="rounded bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
        >
          Import stats for {toImport.length}
        </button>
        <button
          onClick={() => s.runImport(withLinkedGames)}
          disabled={running || s.loading || !statsReady || withLinkedGames.length === 0}
          title="Re-read PFF's stats for every linked game (PFF revises grades during the week)"
          className={btn + " py-1.5"}
        >
          Refresh all stats
        </button>
        <button
          onClick={() => ctx.queue(ctx.toFill)}
          disabled={running || ctx.running || s.loading || ctx.error != null || ctx.toFill.length === 0}
          title="Fill in opponent defense, weather and supporting cast for games that need it (also runs on its own when this tab opens and after imports)"
          className="rounded bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
        >
          Fill context for {ctx.toFill.length}
        </button>
        {ctx.running && (
          <>
            <span className="text-xs text-slate-300" aria-live="polite">
              Game context {ctx.progress!.done} / {ctx.progress!.total}
              {ctx.progress!.failed > 0 && ` · ${ctx.progress!.failed} failed`}
              {ctx.progress!.note && ` · ${ctx.progress!.note}`}
            </span>
            <button onClick={ctx.cancel} className={btn}>Stop</button>
          </>
        )}
        {ctx.cfdRemaining != null && <span className="text-[11px] text-slate-500" title="CollegeFootballData's free tier is ~1,000 calls a month, shared with the Recruits tab">CFD calls left this month: {ctx.cfdRemaining}</span>}
        {running && (
          <>
            <span className="text-xs text-slate-300" aria-live="polite">
              {s.progress ? (
                <>
                  Matching {s.progress.done} / {s.progress.total}
                  {s.progress.failed > 0 && ` · ${s.progress.failed} failed`}
                  {s.progress.note && ` · ${s.progress.note}`}
                </>
              ) : (
                <>
                  Importing PFF stats {s.importProgress!.done} / {s.importProgress!.total}
                  {s.importProgress!.failed > 0 && ` · ${s.importProgress!.failed} failed`}
                  {s.importProgress!.note && ` · ${s.importProgress!.note}`}
                </>
              )}
            </span>
            <button onClick={s.cancel} className={btn}>Stop</button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["attention", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded border px-2.5 py-1 text-[11px] font-bold transition ${filter === f ? "border-blue-500 bg-blue-500/20 text-blue-300" : "border-slate-700 text-slate-400 hover:text-white"}`}
          >
            {f === "attention" ? "Needs a look" : "All"}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or school"
          aria-label="Search prospects"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {s.loading ? (
        <div className="py-10 text-center text-sm text-slate-500">Loading…</div>
      ) : list.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500">
          {filter === "attention" ? "Nothing needs a look." : "No prospects."}
        </div>
      ) : (
        <div className="space-y-1.5">
          {list.map((p) => (
            <ProspectRow
              key={p.id}
              p={p}
              games={gamesByProspect.get(p.id) ?? []}
              open={openId === p.id}
              onToggle={() => setOpenId((id) => (id === p.id ? null : p.id))}
              disabled={running}
              links={s}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Summary({ title, counts, badges }: { title: string; counts: Record<string, number>; badges: Record<string, Badge> }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="mb-1 font-semibold text-slate-300">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(badges).filter(([k]) => counts[k]).map(([k, b]) => (
          <span key={k} title={b.hint} className={`rounded border px-1.5 py-0.5 ${b.cls}`}>{b.label} {counts[k]}</span>
        ))}
      </div>
    </div>
  );
}

type Links = ReturnType<typeof usePffLinks>;

function ProspectRow({ p, games, open, onToggle, disabled, links }: {
  p: LinkProspect; games: LinkGame[]; open: boolean; onToggle: () => void; disabled: boolean; links: Links;
}) {
  const [picking, setPicking] = useState(false);
  const status = p.pff_match_status ?? "";
  const userCall = status === "confirmed" || status === "none";
  const linked = p.pff_player_id != null && (status === "auto" || status === "confirmed");
  const flagged = games.filter((g) => ATTENTION_GAME.has(g.pff_match_status ?? "")).length;
  const totals = links.totals.get(p.id);

  return (
    <div className="rounded border border-slate-800 bg-slate-900/40">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2">
        <button onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 basis-60 text-left">
          <span className="font-medium text-white">{p.name}</span>{" "}
          <span className={`text-xs font-bold ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</span>{" "}
          <span className="text-xs text-slate-500">{p.school} · {p.draft_class_year} · {games.length} game{games.length === 1 ? "" : "s"}</span>
          <span className="block break-words text-xs text-slate-400">{p.pff_match_note ?? "Not matched yet"}</span>
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge badge={PLAYER_BADGE[status] ?? PLAYER_BADGE[""]} />
          {flagged > 0 && <span className="text-[11px] text-amber-300">{flagged} game{flagged === 1 ? "" : "s"} to check</span>}
          {linked && totals && totals.linked > 0 && <StatsBadge t={totals} />}
          {linked && totals && totals.linked > 0 && (
            <button disabled={disabled || links.statsError != null} onClick={() => links.runImport([p.id])} className={btn} title="Re-read his charted games from PFF">
              Refresh stats
            </button>
          )}
          {status === "review" && p.pff_player_id != null && (
            <button disabled={disabled} onClick={() => links.confirmPlayer(p)} className={btn}>Confirm</button>
          )}
          <button disabled={disabled} onClick={() => setPicking((v) => !v)} className={btn} aria-expanded={picking}>
            {linked || status === "review" ? "Change" : "Pick player"}
          </button>
          {status !== "none" && <button disabled={disabled} onClick={() => links.markPlayerNone(p)} className={btn}>Not in PFF</button>}
          {userCall && <button disabled={disabled} onClick={() => links.resetPlayer(p)} className={btn} title="Let the matcher decide again">Reset</button>}
        </div>
      </div>
      {picking && (
        <PlayerPicker
          name={p.name}
          onPick={async (c) => { setPicking(false); await links.choosePlayer(p, c); }}
          disabled={disabled}
        />
      )}
      {open && (
        <div className="border-t border-slate-800 px-3 py-2">
          {games.length === 0 ? (
            <div className="text-xs text-slate-500">No charted games.</div>
          ) : (
            <ul className="space-y-1.5">
              {games.map((g) => (
                <GameRow key={g.id} g={g} playerId={linked ? p.pff_player_id : null} disabled={disabled} links={links} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StatsBadge({ t }: { t: PffTotals }) {
  const stale = t.seasonsCurrent < t.seasons;
  const done = t.games === t.linked && !stale;
  const cls = done ? STATUS_CLASSES.good : t.games === 0 ? MUTED : STATUS_CLASSES.warning;
  const hint = stale
    ? "A game link changed since the import: grades and splits are blank until a refresh"
    : `PFF stats imported for ${t.games} of his ${t.linked} linked charted games`;
  return (
    <span title={hint} className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      Stats {t.games}/{t.linked}{stale ? " · out of date" : ""}
    </span>
  );
}

function PlayerPicker({ name, onPick, disabled }: { name: string; onPick: (c: PffCandidate) => void; disabled: boolean }) {
  const [query, setQuery] = useState(name);
  const [results, setResults] = useState<PffCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try { setResults(await searchPffPlayers(query.trim())); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="border-t border-slate-800 px-3 py-2 space-y-1.5">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="PFF player name"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
        />
        <button type="submit" disabled={busy || query.trim().length < 2} className={btn}>{busy ? "Searching…" : "Search PFF"}</button>
      </form>
      {err && <div className="text-xs text-red-300">{err}</div>}
      {results && results.length === 0 && <div className="text-xs text-slate-500">No PFF players by that name.</div>}
      {results && results.length > 0 && (
        <ul className="space-y-1">
          {results.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <button disabled={disabled} onClick={() => onPick(c)} className={btn}>Use</button>
              <span className="text-white">{c.name}</span>
              <span className="text-slate-400">
                {c.position}{c.team ? ` · ${c.team}` : ""}{c.currentClass ? ` · ${c.currentClass}` : ""}
                {c.height ? ` · ${c.height}` : ""}{c.weight ? ` ${c.weight} lb` : ""}{c.dob ? ` · born ${c.dob}` : ""} · PFF {c.id}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GameRow({ g, playerId, disabled, links }: { g: LinkGame; playerId: number | null; disabled: boolean; links: Links }) {
  const [options, setOptions] = useState<PffGameOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const status = g.pff_match_status ?? "";
  const userCall = status === "confirmed" || status === "none";
  const imported = links.importedGameIds.has(g.id);
  const why = links.missing.get(g.id);

  async function loadOptions() {
    if (playerId == null) return;
    setBusy(true);
    setErr(null);
    try { setOptions(await fetchPffGames(playerId, g.season_year)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <li className="text-xs">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1 basis-56">
          <span className="text-slate-200">{g.season_year} vs {g.opponent || "?"}</span>
          {g.game_type !== "regular" && <span className="text-slate-500"> · {g.game_type}</span>}
          <span className="block break-words text-slate-400">{g.pff_match_note ?? "Not matched yet"}</span>
          {(status === "auto" || status === "confirmed") && (
            <span className={`block ${imported ? "text-emerald-400" : "text-slate-500"}`}>
              {imported ? "PFF stats imported" : why ?? "PFF stats not imported yet"}
            </span>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge badge={GAME_BADGE[status] ?? GAME_BADGE[""]} />
          {status === "review" && g.pff_game_id != null && (
            <button disabled={disabled} onClick={() => links.confirmGame(g)} className={btn}>Confirm</button>
          )}
          {playerId != null && (
            <button disabled={disabled || busy} onClick={loadOptions} className={btn}>{busy ? "Loading…" : "Pick game"}</button>
          )}
          {status !== "none" && <button disabled={disabled} onClick={() => links.markGameNone(g)} className={btn}>No PFF game</button>}
          {userCall && <button disabled={disabled} onClick={() => links.resetGame(g)} className={btn} title="Let the matcher decide again">Reset</button>}
        </div>
      </div>
      {err && <div className="text-red-300">{err}</div>}
      {options && (
        <div className="mt-1">
          {options.length === 0 ? (
            <span className="text-slate-500">PFF has no {g.season_year} games for this player.</span>
          ) : (
            <select
              aria-label={`PFF game for ${g.season_year} vs ${g.opponent}`}
              defaultValue=""
              disabled={disabled}
              onChange={(e) => {
                const o = options.find((x) => String(x.pffGameId) === e.target.value);
                if (o) { setOptions(null); links.chooseGame(g, o); }
              }}
              className="max-w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white"
            >
              <option value="" disabled>Pick his PFF game…</option>
              {options.map((o) => (
                <option key={o.pffGameId} value={o.pffGameId}>
                  Week {o.week}{o.start ? ` (${o.start.slice(0, 10)})` : ""} vs {o.opponent}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </li>
  );
}
