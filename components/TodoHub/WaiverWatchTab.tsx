"use client";
import { useMemo } from "react";
import type { LeagueOverviewEntry, SleeperLeague, SleeperPlayer, SleeperUser } from "../../lib/types";
import type { ActionAppTab } from "../../lib/helpers/actionQueue";
import { buildWaiverWatch, type DropCandidate, type WaiverRiser } from "../../lib/helpers/waiverWatch";
import { useWeeklyValueRisers } from "../../hooks/useWeeklyValueRisers";
import { POS_COLOR, STATUS_CLASSES } from "../../lib/uiTheme";
import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import SleeperLink from "./SleeperLink";

// ============================================================
// To-Do hub → Waiver Watch: one card per league, the two free agents whose
// value rose most this week beside the user's two lowest-value players
// (lib/helpers/waiverWatch.ts). A pickup worth more than the lowest player is
// highlighted, and those leagues come first. Read-only — no Done marks.
// ============================================================

interface WaiverWatchTabProps {
  user: SleeperUser;
  leagues: SleeperLeague[];
  players: Record<string, SleeperPlayer>;
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  overviewLoaded: boolean;
  onOpenInApp: (leagueId: string, tab: ActionAppTab) => void;
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function PlayerLabel({ player, id }: { player: SleeperPlayer | undefined; id: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      {player && <span className={`text-[10px] font-bold ${POS_COLOR[player.position] ?? "text-slate-400"}`}>{player.position}</span>}
      <span className="truncate text-sm text-slate-100">{player?.full_name ?? id}</span>
      <span className="shrink-0 text-[11px] text-slate-500">{player?.team || "FA"}</span>
    </span>
  );
}

function RiserRow({ riser, player, lowestName }: { riser: WaiverRiser; player: SleeperPlayer | undefined; lowestName: string | null }) {
  return (
    <li className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${riser.beatsLowest ? "border border-emerald-800/80 bg-emerald-950/30" : ""}`}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <PlayerLabel player={player} id={riser.playerId} />
        {riser.beatsLowest && lowestName && (
          <div className="text-[11px] font-semibold text-emerald-300">Worth more than {lowestName}</div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-xs text-slate-200">{riser.value.toLocaleString()}</div>
        <div className="font-mono text-[11px] font-semibold text-emerald-400" title={`${riser.from.toLocaleString()} → ${riser.to.toLocaleString()}`}>
          +{riser.gain.toLocaleString()}
        </div>
      </div>
    </li>
  );
}

function LowestRow({ candidate, player }: { candidate: DropCandidate; player: SleeperPlayer | undefined }) {
  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <PlayerLabel player={player} id={candidate.playerId} />
        {candidate.onIr && (
          <span
            className={`shrink-0 text-[10px] font-semibold border rounded px-1.5 py-px ${STATUS_CLASSES.serious}`}
            title="On IR, but you have more IR-eligible players than IR slots"
          >
            IR
          </span>
        )}
      </div>
      <div
        className="shrink-0 font-mono text-xs text-slate-300"
        title={candidate.value > 0 ? undefined : "Not on FantasyCalc's list"}
      >
        {candidate.value > 0 ? candidate.value.toLocaleString() : "—"}
      </div>
    </li>
  );
}

export default function WaiverWatchTab({
  user, leagues, players, leagueOverviewData, overviewLoaded, onOpenInApp,
}: WaiverWatchTabProps) {
  const { data, error, loading, retry } = useWeeklyValueRisers(true);

  const rows = useMemo(
    () => (overviewLoaded
      ? buildWaiverWatch({ leagues, leagueOverviewData, userId: user.user_id, players, risers: data?.risers ?? [] })
      : []),
    [overviewLoaded, leagues, leagueOverviewData, user.user_id, players, data]
  );
  const upgrades = rows.filter((r) => r.upgrade != null).length;
  const nameOf = (id: string) => players[id]?.full_name ?? id;

  if (!overviewLoaded) return <p className="text-sm text-blue-400">Loading your leagues…</p>;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {data && (
          <p className="text-xs text-slate-300">
            {upgrades > 0
              ? `${plural(upgrades, "league")} ${upgrades === 1 ? "has" : "have"} a rising free agent worth more than your lowest player.`
              : "No rising free agent is worth more than your lowest player right now."}
          </p>
        )}
        <p className="text-[11px] text-slate-500">
          {data
            ? `Rising: biggest FantasyCalc value gain ${shortDate(data.baseDate)} → ${shortDate(data.latestDate)} among players no one in the league rosters. `
            : ""}
          Your lowest leaves out taxi, K/DEF and IR — IR players count when you have more IR-eligible players than IR slots.
          Values are FantasyCalc superflex, so QBs read high in 1QB leagues.
        </p>
      </div>

      {loading && <p className="text-[11px] text-blue-400">Loading this week&apos;s value changes…</p>}
      {error && (
        <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${STATUS_CLASSES.warning}`}>
          <span>Couldn&apos;t load this week&apos;s value changes — rising free agents are missing.</span>
          <Button variant="link" size="none" className="text-xs" onClick={retry}>Retry</Button>
        </div>
      )}
      {!loading && !error && !data && (
        <p className="text-[11px] text-slate-500">Rising free agents need a week of value history — check back once it has built up.</p>
      )}

      {rows.length === 0 ? (
        <EmptyState>No rosters loaded yet.</EmptyState>
      ) : (
        rows.map((row) => {
          const id = row.league.league_id;
          const lowestName = row.lowest[0] ? nameOf(row.lowest[0].playerId) : null;
          return (
            <section
              key={id}
              aria-label={row.league.name}
              className={`rounded-xl border bg-slate-900 ${row.upgrade != null ? "border-emerald-800/80" : "border-slate-800"}`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-slate-800 px-3 py-2">
                <h3 className="min-w-0 basis-full truncate text-sm font-semibold text-slate-100 sm:basis-0 sm:flex-1">
                  {row.league.name}
                </h3>
                {row.upgrade != null && (
                  <span className={`mr-auto text-[10px] font-semibold border rounded px-1.5 py-px sm:mr-0 ${STATUS_CLASSES.good}`}>
                    Upgrade +{row.upgrade.toLocaleString()}
                  </span>
                )}
                <SleeperLink leagueId={id} />
                <Button variant="ghost" size="sm" onClick={() => onOpenInApp(id, "ROSTERS")}>
                  Open in app
                </Button>
              </div>
              <div className="grid divide-y divide-slate-800 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="px-1.5 py-2">
                  <h4 className="px-2 pb-1 text-[10px] uppercase tracking-wide text-slate-500">Rising free agents</h4>
                  {row.risers.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-slate-500">{data ? "None rising this week" : "—"}</p>
                  ) : (
                    <ul className="space-y-1">
                      {row.risers.map((riser) => (
                        <RiserRow key={riser.playerId} riser={riser} player={players[riser.playerId]} lowestName={lowestName} />
                      ))}
                    </ul>
                  )}
                </div>
                <div className="px-1.5 py-2">
                  <h4 className="px-2 pb-1 text-[10px] uppercase tracking-wide text-slate-500">Your lowest</h4>
                  {row.lowest.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-slate-500">No one to drop</p>
                  ) : (
                    <ul className="space-y-1">
                      {row.lowest.map((c) => (
                        <LowestRow key={c.playerId} candidate={c} player={players[c.playerId]} />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
