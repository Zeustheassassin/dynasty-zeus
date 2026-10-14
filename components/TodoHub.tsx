"use client";
import React, { memo, useEffect, useMemo, useState } from "react";
import type { SleeperLeague, SleeperPlayer, SleeperUser } from "../lib/types";
import type { TodoView } from "../app/hooks/useHubRouting";
import type { TodoDoneMark } from "../app/hooks/useTodoDone";
import {
  getActionState,
  groupActionsByLeague,
  groupActionsByPlayer,
  sleeperLeagueUrl,
  type ActionAppTab,
  type ActionItem,
  type ActionKind,
  type ActionState,
  type DoneRecord,
} from "../lib/helpers/actionQueue";
import { formatDayTime } from "../lib/helpers/formatting";
import { injuryStatusStyle } from "./AlertsPage/alertsPageHelpers";
import { POS_COLOR, STATUS_CLASSES } from "../lib/uiTheme";
import Button from "./ui/Button";
import EmptyState from "./ui/EmptyState";

// ============================================================
// To-Do hub: every move the user's leagues need made in Sleeper, in one list
// (lib/helpers/actionQueue.ts builds it in useAppState). By league is the work
// order — earliest deadline first; By player answers "where do I bench him".
// Done marks are this device only and come back flagged if data fetched after
// the click still has the move.
// ============================================================

interface TodoHubProps {
  user: SleeperUser | null;
  leagues: SleeperLeague[];
  /** Sleeper's raw player map — names, positions and status badges. */
  players: Record<string, SleeperPlayer>;
  items: ActionItem[];
  done: Record<string, DoneRecord>;
  onMarkDone: (marks: TodoDoneMark[]) => void;
  onUndoDone: (key: string) => void;
  view: TodoView;
  setView: (view: TodoView) => void;
  /** Player to scroll to in By player (the Injury Report's "See moves"). */
  focusPlayerId: string | null;
  isInSeason: boolean;
  /** This week's lineup status has computed (projections + schedule loaded). */
  lineupReady: boolean;
  overviewLoaded: boolean;
  loadingOverview: boolean;
  updatedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenInApp: (leagueId: string, tab: ActionAppTab) => void;
}

const VIEWS: { id: TodoView; label: string }[] = [
  { id: "BY_LEAGUE", label: "By league" },
  { id: "BY_PLAYER", label: "By player" },
];

const KIND_TAG: Record<ActionKind, { label: string; cls: string }> = {
  lineup: { label: "Lineup", cls: "border-blue-800 bg-blue-950/40 text-blue-300" },
  pivotRisk: { label: "Late risk", cls: STATUS_CLASSES.warning },
  emptySlot: { label: "Empty slot", cls: STATUS_CLASSES.critical },
  overLimit: { label: "Roster", cls: STATUS_CLASSES.critical },
  irStale: { label: "IR", cls: STATUS_CLASSES.critical },
  irEligible: { label: "IR", cls: STATUS_CLASSES.serious },
};

const DAY_LETTER = { Thu: "T", Fri: "F", Sat: "S" } as const;
const DAY_NAME = { Thu: "Thursday", Fri: "Friday", Sat: "Saturday" } as const;

interface VisibleItem {
  item: ActionItem;
  state: ActionState;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function SleeperLink({ leagueId, compact = false }: { leagueId: string; compact?: boolean }) {
  return (
    <a
      href={sleeperLeagueUrl(leagueId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {compact ? "Sleeper" : "Open in Sleeper"}
      <span aria-hidden="true">↗</span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function DeadlineChip({ item, now }: { item: ActionItem; now: number }) {
  if (item.deadline == null) return null;
  // A late-game risk past its last earlier-game swap still matters until inactives.
  const label = now < item.deadline ? `${item.deadlineLabel} ${formatDayTime(item.deadline)}` : `Inactives ${formatDayTime(item.expiresAt)}`;
  return <span className="text-[10px] font-semibold text-slate-300 whitespace-nowrap">{label}</span>;
}

function ActionRow({
  entry, now, leagueLabel, onMarkDone, actions,
}: {
  entry: VisibleItem;
  now: number;
  /** By player shows which league each move is in. */
  leagueLabel?: string;
  onMarkDone: TodoHubProps["onMarkDone"];
  actions?: React.ReactNode;
}) {
  const { item, state } = entry;
  const tag = KIND_TAG[item.kind];
  const stillShowing = state === "stillShowing";
  return (
    <li className="flex items-start gap-2 px-3 py-2.5 border-b border-slate-800/70 last:border-0">
      <div className="min-w-0 flex-1 space-y-1">
        {leagueLabel && <div className="text-[11px] font-semibold text-slate-400 truncate">{leagueLabel}</div>}
        <div className="flex flex-wrap items-center gap-1.5">
          {item.earlyLockDay && (
            <span
              role="img"
              aria-label={`${DAY_NAME[item.earlyLockDay]} game: make this move before kickoff`}
              title={`${DAY_NAME[item.earlyLockDay]} game: make this move before kickoff`}
              className="text-[10px] font-bold leading-none text-sky-400"
            >
              {DAY_LETTER[item.earlyLockDay]}
            </span>
          )}
          <span className={`text-[10px] font-semibold border rounded px-1.5 py-px ${tag.cls}`}>{tag.label}</span>
          <span className="text-sm text-slate-100">{item.title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[11px] text-slate-400">{item.detail}</span>
          <DeadlineChip item={item} now={now} />
        </div>
        {stillShowing && (
          <div className="text-[11px] font-semibold text-amber-300">
            Still showing in Sleeper — Refresh to re-check, or mark it done again to hide it this week.
          </div>
        )}
        {actions && <div className="flex flex-wrap items-center gap-1.5 pt-0.5">{actions}</div>}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0"
        onClick={() => onMarkDone([{ key: item.key, final: stillShowing }])}
        aria-label={`Done: ${item.title}${leagueLabel ? ` (${leagueLabel})` : ""}`}
      >
        Done
      </Button>
    </li>
  );
}

function TodoHub({
  user,
  leagues,
  players,
  items,
  done,
  onMarkDone,
  onUndoDone,
  view,
  setView,
  focusPlayerId,
  isInSeason,
  lineupReady,
  overviewLoaded,
  loadingOverview,
  updatedAt,
  refreshing,
  onRefresh,
  onOpenInApp,
}: TodoHubProps) {
  // Minute tick: deadlines, expired lineup moves and the "Updated" label move with the clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [showDone, setShowDone] = useState(false);

  const { visible, hidden } = useMemo(() => {
    const visibleItems: VisibleItem[] = [];
    const hiddenItems: ActionItem[] = [];
    for (const item of items) {
      if (item.expiresAt != null && now >= item.expiresAt) continue;
      const state = getActionState(item, done[item.key]);
      if (state === "done") hiddenItems.push(item);
      else visibleItems.push({ item, state });
    }
    return { visible: visibleItems, hidden: hiddenItems };
  }, [items, done, now]);

  const stateByKey = useMemo(() => new Map(visible.map((v) => [v.item.key, v])), [visible]);
  const leagueGroups = useMemo(
    () => groupActionsByLeague(visible.map((v) => v.item), leagues),
    [visible, leagues]
  );
  const playerGroups = useMemo(
    () => groupActionsByPlayer(visible.map((v) => v.item), players),
    [visible, players]
  );
  const leagueName = useMemo(() => new Map(leagues.map((l) => [l.league_id, l.name])), [leagues]);

  // "See moves" from the Injury Report: bring that player's card into view.
  useEffect(() => {
    if (view !== "BY_PLAYER" || !focusPlayerId) return;
    document.getElementById(`todo-player-${focusPlayerId}`)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [view, focusPlayerId]);

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return null;
    const minutes = Math.max(0, Math.round((now - updatedAt) / 60_000));
    if (minutes < 1) return "Updated just now";
    if (minutes < 60) return `Updated ${minutes}m ago`;
    return `Updated ${Math.round(minutes / 60)}h ago`;
  }, [updatedAt, now]);

  if (!user || leagues.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <EmptyState>Connect a Sleeper account with leagues to see your To-Do list.</EmptyState>
      </div>
    );
  }

  const row = (v: VisibleItem, opts: { leagueLabel?: string; actions?: React.ReactNode } = {}) => (
    <ActionRow key={v.item.key} entry={v} now={now} onMarkDone={onMarkDone} {...opts} />
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">To-Do</h2>
          <p className="text-xs text-slate-400">
            {!overviewLoaded
              ? "Loading your leagues…"
              : visible.length === 0
                ? "Nothing to do right now."
                : `${plural(visible.length, "move")} in ${plural(leagueGroups.length, "league")}. Make each one in Sleeper, then mark it done.`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing || loadingOverview}
            title="Re-pull every league's rosters and Sleeper's injury designations"
          >
            {refreshing || loadingOverview ? "Refreshing…" : "Refresh"}
          </Button>
          {updatedLabel && <span className="text-[10px] text-slate-500 whitespace-nowrap">{updatedLabel}</span>}
        </div>
      </div>

      <div role="tablist" aria-label="To-Do view" className="flex gap-1 border-b border-slate-800">
        {VIEWS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={view === tab.id}
            onClick={() => setView(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              view === tab.id ? "border-blue-500 text-blue-400" : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!isInSeason && (
        <p className="text-[11px] text-slate-500">Offseason — roster and IR moves only. Lineup moves start in Week 1.</p>
      )}
      {isInSeason && overviewLoaded && !lineupReady && (
        <p className="text-[11px] text-slate-500">Loading this week&apos;s projections — lineup moves will appear shortly.</p>
      )}

      {!overviewLoaded ? (
        <p className="text-sm text-blue-400">Loading your leagues…</p>
      ) : visible.length === 0 ? (
        <EmptyState>Lineups and rosters look set in every league.</EmptyState>
      ) : view === "BY_LEAGUE" ? (
        <div className="space-y-3">
          {leagueGroups.map((group) => {
            const id = group.league.league_id;
            const groupItems = group.items
              .map((item) => stateByKey.get(item.key))
              .filter((v): v is VisibleItem => !!v);
            return (
              <section key={id} aria-label={group.league.name} className="rounded-xl border border-slate-800 bg-slate-900">
                {/* On a phone the league name gets its own line — sharing one with the buttons cut it
                    to a few letters. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-slate-800 px-3 py-2">
                  <h3 className="min-w-0 basis-full truncate text-sm font-semibold text-slate-100 sm:basis-0 sm:flex-1">
                    {group.league.name}
                  </h3>
                  <span className="mr-auto text-[10px] text-slate-500 sm:mr-0">{plural(groupItems.length, "move")}</span>
                  <SleeperLink leagueId={id} />
                  <Button variant="ghost" size="sm" onClick={() => onOpenInApp(id, group.appTab)}>
                    Open in app
                  </Button>
                  {groupItems.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onMarkDone(
                        groupItems.map((v) => ({ key: v.item.key, final: v.state === "stillShowing" }))
                      )}
                      aria-label={`All done in ${group.league.name}`}
                    >
                      All done
                    </Button>
                  )}
                </div>
                <ul>{groupItems.map((v) => row(v))}</ul>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {playerGroups.map((group) => {
            const player = group.playerId ? players[group.playerId] : null;
            const focused = !!group.playerId && group.playerId === focusPlayerId;
            const status = player ? injuryStatusStyle(player) : null;
            return (
              <section
                key={group.playerId ?? "league-wide"}
                id={group.playerId ? `todo-player-${group.playerId}` : undefined}
                aria-label={player?.full_name ?? (group.playerId ? group.playerId : "League-wide")}
                className={`scroll-mt-24 rounded-xl border bg-slate-900 ${focused ? "border-blue-500 ring-1 ring-blue-500/50" : "border-slate-800"}`}
              >
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-2">
                  {player && (
                    <span className={`text-[10px] font-bold ${POS_COLOR[player.position] ?? "text-slate-400"}`}>{player.position}</span>
                  )}
                  <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
                    {group.playerId ? player?.full_name ?? group.playerId : "League-wide"}
                    {player && <span className="ml-1.5 text-xs font-normal text-slate-500">{player.team || "FA"}</span>}
                  </h3>
                  {status && status.label !== "Active" && (
                    <span className={`text-[10px] font-semibold border px-2 py-0.5 rounded-lg ${status.cls}`} title={status.title}>
                      {status.label}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-500">{plural(group.items.length, "move")}</span>
                </div>
                <ul>
                  {group.items.map((item) => {
                    const v = stateByKey.get(item.key);
                    if (!v) return null;
                    return row(v, {
                      leagueLabel: leagueName.get(item.leagueId) ?? item.leagueName,
                      actions: (
                        <>
                          <SleeperLink leagueId={item.leagueId} compact />
                          <Button variant="ghost" size="sm" onClick={() => onOpenInApp(item.leagueId, item.appTab)}>
                            Open in app
                          </Button>
                        </>
                      ),
                    });
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {hidden.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40">
          <button
            type="button"
            onClick={() => setShowDone((open) => !open)}
            aria-expanded={showDone}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-slate-400 hover:text-slate-200"
          >
            <span>Marked done this week ({hidden.length})</span>
            <span aria-hidden="true" className={`transition-transform ${showDone ? "rotate-180" : ""}`}>▼</span>
          </button>
          {showDone && (
            <ul className="border-t border-slate-800">
              {hidden.map((item) => (
                <li key={item.key} className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/70 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-slate-500 truncate">{leagueName.get(item.leagueId) ?? item.leagueName}</div>
                    <div className="text-xs text-slate-300">{item.title}</div>
                  </div>
                  <Button variant="link" size="none" className="text-xs" onClick={() => onUndoDone(item.key)}>
                    Undo
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(TodoHub);
