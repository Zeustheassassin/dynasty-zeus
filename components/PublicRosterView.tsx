"use client";
import { useEffect, useState } from "react";
import { sleeperApi } from "../lib/sleeperApi";
import { getFcValuesRaw } from "../lib/fcValuesStore";
import { getLeagueNumQbs } from "../lib/helpers/scoring";
import { withFantasyPositions } from "../lib/helpers/playerPosition";
import {
  buildPublicRoster, fcValuesBySleeperId,
  type PublicRosterView as RosterView, type PublicRosterPlayerInfo,
} from "../lib/helpers/publicRoster";
import { logger } from "../lib/logger";
import type { SleeperLeague } from "../lib/types";
import { ShareLinkButton } from "./shared/ShareLinkButton";

const log = logger("components/PublicRosterView");

type LoadState =
  | { status: "loading" }
  | { status: "ready"; view: RosterView }
  | { status: "missing" }
  | { status: "error" };

type SlimPlayer = PublicRosterPlayerInfo & { position: string; fantasy_positions?: string[] | null };

/** The slim player map from the shared, CDN-cached /api/players proxy (the same one the app loads). */
async function loadPlayers(): Promise<Record<string, SlimPlayer>> {
  const res = await fetch("/api/players");
  if (!res.ok) throw new Error(`players ${res.status}`);
  const body: { players?: Record<string, SlimPlayer> } = await res.json();
  if (!body?.players || Object.keys(body.players).length === 0) throw new Error("players response was empty");
  return withFantasyPositions(body.players);
}

interface PublicRosterViewProps {
  leagueId: string;
  rosterId: number;
}

/** Read-only roster anyone can open from a shared link — no login, nothing personal. Everything
 *  loads through the app's public proxies (/api/sleeper/*, /api/players, /api/fc-values). */
export default function PublicRosterView({ leagueId, rosterId }: PublicRosterViewProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // What the league call settled to, readable from the catch below (undefined = not settled).
    const leagueResult: { value?: SleeperLeague | null } = {};
    (async () => {
      try {
        const leagueP = sleeperApi.getLeagueInfo(leagueId).then((l) => (leagueResult.value = l));
        // Values depend on the league's QB format, so they start as soon as the league is in.
        const fcP = leagueP.then((l) => (l ? getFcValuesRaw(getLeagueNumQbs(l) === 1 ? 1 : 2, true) : null));
        const [league, rosters, users, tradedPicks, drafts, players, fcRaw] = await Promise.all([
          leagueP,
          sleeperApi.getLeagueRosters(leagueId),
          sleeperApi.getLeagueUsers(leagueId),
          sleeperApi.getLeagueTradedPicks(leagueId),
          sleeperApi.getLeagueDrafts(leagueId),
          loadPlayers(),
          fcP,
        ]);
        if (cancelled) return;
        if (!league || !fcRaw) { setState({ status: "missing" }); return; }
        const view = buildPublicRoster({
          league, rosters, users, tradedPicks, drafts, players,
          fcValues: fcValuesBySleeperId(fcRaw),
          rosterId,
        });
        setState(view ? { status: "ready", view } : { status: "missing" });
      } catch (err) {
        if (cancelled) return;
        // Sleeper answers an unknown league id with null, so the league call settling to null means
        // a bad link, not an outage.
        if (leagueResult.value === null) { setState({ status: "missing" }); return; }
        log.warn("public roster load failed", { leagueId, rosterId, err: String(err) });
        setState({ status: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId, rosterId, attempt]);

  return (
    <main className="min-h-screen bg-slate-950 text-white px-4 py-6 sm:px-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
      <div className="max-w-[1400px] mx-auto">
        {state.status === "loading" && <LoadingSkeleton />}
        {state.status === "missing" && (
          <Notice title="Roster not found" body="This link doesn't point to a team on Sleeper. Ask whoever sent it for a fresh link." />
        )}
        {state.status === "error" && (
          <Notice title="Couldn't load this roster" body="Sleeper or the player values didn't answer. Give it a moment and try again.">
            <button
              type="button"
              onClick={() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }}
              className="mt-3 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              Try again
            </button>
          </Notice>
        )}
        {state.status === "ready" && <Roster view={state.view} leagueId={leagueId} rosterId={rosterId} />}
      </div>
    </main>
  );
}

function Roster({ view, leagueId, rosterId }: { view: RosterView; leagueId: string; rosterId: number }) {
  const subtitle = [view.ownerName !== view.teamName ? view.ownerName : "", view.leagueName].filter(Boolean).join(" · ");
  return (
    <>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold break-words">{view.teamName}</h1>
          <div className="text-xs text-slate-400">{subtitle}</div>
          {view.lineup && <div className="text-xs text-blue-400 mt-1">{view.lineup}</div>}
        </div>
        <ShareLinkButton path={`/roster/${leagueId}/${rosterId}`} title={`${view.teamName} · ${view.leagueName}`} />
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {view.columns.map((col) => (
          <section key={col.pos} aria-label={`${col.pos} room`} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
            <div className="border-b border-slate-800 pb-2 mb-2">
              <div className="text-xs text-slate-400">
                {col.pos} Rank: <span className="font-semibold text-emerald-400">{col.rank || "—"}</span>
                {col.rank > 0 && <span className="text-slate-500"> of {view.teamCount}</span>}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Value: <span className="text-slate-200 font-medium">{col.totalValue.toLocaleString()}</span>
                {col.avgAge != null && (
                  <> {" | "}Age: <span className="text-slate-200 font-medium">{col.avgAge.toFixed(1)}</span></>
                )}
              </div>
            </div>
            {col.players.length === 0 ? (
              <div className="text-[11px] text-slate-600 italic">No players</div>
            ) : (
              <ol className="space-y-1">
                {col.players.map((p) => (
                  <li key={p.id} className="text-xs py-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex-1 min-w-0 truncate text-slate-200">{p.name}</span>
                      <span className="text-emerald-400 font-medium whitespace-nowrap">{p.value.toLocaleString()}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{p.role}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}

        <section aria-label="Draft picks" className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="border-b border-slate-800 pb-2 mb-2">
            <div className="text-xs text-slate-400">
              Picks: <span className="font-semibold text-emerald-400">{view.pickCount}</span>
            </div>
          </div>
          {view.picksByYear.length === 0 ? (
            <div className="text-[11px] text-slate-600 italic">No picks</div>
          ) : (
            <div className="space-y-2">
              {view.picksByYear.map(({ year, picks }) => (
                <div key={year}>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{year}</div>
                  <ul className="space-y-0.5">
                    {picks.map((pick) => (
                      <li key={pick.key} className="flex items-center justify-between gap-2 text-xs py-0.5">
                        <span className="text-slate-200 font-medium whitespace-nowrap">{pick.label}</span>
                        <span className="text-[10px] text-slate-500 truncate">
                          {pick.fromName ? `via ${pick.fromName}` : "Own"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="mt-6 text-[11px] text-slate-500">
        Roster live from Sleeper. Values are FantasyCalc dynasty values adjusted for this league&apos;s scoring.
        <span className="text-slate-600"> · DynastyZeus</span>
      </footer>
    </>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto mt-16 bg-slate-900 border border-slate-800 rounded-xl p-5 text-center">
      <h1 className="text-base font-semibold text-slate-200">{title}</h1>
      <p className="mt-1 text-xs text-slate-400">{body}</p>
      {children}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading roster">
      <div className="mb-4 space-y-2">
        <div className="h-5 w-48 rounded bg-slate-800 animate-pulse" />
        <div className="h-3 w-64 rounded bg-slate-800/70 animate-pulse" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-72 rounded-xl border border-slate-800 bg-slate-900 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
