"use client";
import { useState, useEffect } from "react";
import type { AlertsCenterItem, WatchlistEntry, SleeperPlayer, SleeperTransaction, SleeperTradedPick, GmBriefing } from "../lib/types";

// Canonical alert type — shared with page.tsx via lib/types.ts
type DashboardAlert = AlertsCenterItem;

type LeagueTransaction = SleeperTransaction & {
  leagueName: string;
  leagueId: string;
  rosterOwnerMap: Record<number, string>;
};

interface NewsItem {
  id: string;
  title: string;
  summary?: string;
  link?: string;
  published?: string;
  playerNames?: string[];
}

interface BeatItem {
  id: string;
  title: string;
  summary?: string;
  link?: string;
  published?: string;
  playerNames?: string[];
  author?: string;
  source?: string;
  sourceLabel?: string;
  impact?: boolean;
}

type InjuryReportPlayer = {
  player: SleeperPlayer;
  playerId: string;
  leagues: string[];
  startingLeagues: string[];
  isWatchlisted: boolean;
};

type AlertsPageProps = {
  alerts: DashboardAlert[];
  actionableAlerts: DashboardAlert[];
  watchlistEntries: WatchlistEntry[];
  onDismissAlert: (alertId: string) => void;
  loadingExternalAlerts: boolean;
  leagueTransactions: LeagueTransaction[];
  loadingTransactions: boolean;
  players: Record<string, SleeperPlayer>;
  injuryReportPlayers: InjuryReportPlayer[];
  currentNFLWeek: number;
  allTradeAttempts: { id: string; league_id: string; status: string }[];
  allLeagues: { league_id: string; name: string }[];
  rosterBriefings?: GmBriefing[];
  onRefreshBriefing?: (rosterId: number, leagueId: string, recentNews: { title: string; playerNames?: string[] }[]) => Promise<void>;
  onNavigateToAttempts: (leagueId: string) => void;
};

const severityStyles = {
  high: "border-red-700/70 bg-red-950/40 text-red-200",
  medium: "border-amber-700/70 bg-amber-950/40 text-amber-200",
  low: "border-slate-700 bg-slate-900 text-slate-200",
};

const POS_COLOR: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-green-400",
  WR: "text-blue-400",
  TE: "text-yellow-400",
};

// Replaces any bare numeric Sleeper player IDs remaining in a detail string
// with the player's full_name from the players dictionary.
// This is a safety net for alerts generated before the players dictionary was loaded.
function resolvePlayerIdsInDetail(detail: string, players: Record<string, SleeperPlayer>): string {
  // Sleeper player IDs are numeric strings, 1–5 digits, that appear as standalone tokens
  return detail.replace(/\b(\d{1,5})\b/g, (match) => {
    const p = players[match];
    return p?.full_name ?? match;
  });
}

function injuryStatusStyle(player: SleeperPlayer) {
  const s = (player.injury_status || player.status || "").toLowerCase();
  if (/ir|pup/.test(s))
    return { cls: "bg-red-900/60 text-red-300 border-red-700", label: player.injury_status || player.status };
  if (/out|suspended|inactive/.test(s))
    return { cls: "bg-red-900/40 text-red-400 border-red-800", label: player.injury_status || player.status };
  if (/doubtful/.test(s))
    return { cls: "bg-orange-900/40 text-orange-400 border-orange-700", label: "Doubtful" };
  if (/questionable/.test(s))
    return { cls: "bg-yellow-900/40 text-yellow-400 border-yellow-700", label: "Questionable" };
  return { cls: "bg-slate-800/40 text-slate-400 border-slate-700", label: "Active" };
}

function relTime(ts: number): string {
  const ms = Date.now() - ts;
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function TxCard({ tx, players }: { tx: LeagueTransaction; players: Record<string, SleeperPlayer> }) {
  const type: string = tx.type;
  const isTrade = type === "trade";
  const adds: Record<string, number> = tx.adds ?? {};
  const drops: Record<string, number> = tx.drops ?? {};
  const picks: SleeperTradedPick[] = tx.draft_picks ?? [];
  const rosterOwnerMap: Record<number, string> = tx.rosterOwnerMap ?? {};

  const hasAdds = Object.keys(adds).length > 0;
  const hasDrops = Object.keys(drops).length > 0;

  const cardCls = isTrade
    ? "border-violet-800/40 bg-violet-950/10"
    : hasAdds && hasDrops
    ? "border-blue-800/40 bg-blue-950/10"
    : hasAdds
    ? "border-emerald-800/40 bg-emerald-950/10"
    : "border-red-800/40 bg-red-950/10";

  const typeLabel = isTrade
    ? "Trade"
    : hasAdds && hasDrops
    ? "Waiver"
    : hasAdds
    ? "Add"
    : "Drop";

  const typeLabelCls = isTrade
    ? "bg-violet-900/50 text-violet-300"
    : hasAdds && hasDrops
    ? "bg-blue-900/50 text-blue-300"
    : hasAdds
    ? "bg-emerald-900/50 text-emerald-300"
    : "bg-red-900/50 text-red-300";

  const PlayerPill = ({ playerId }: { playerId: string }) => {
    const p = players[playerId];
    if (!p) return <span className="text-xs text-slate-400">{playerId}</span>;
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5">
        <span className={`text-[10px] font-bold ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</span>
        <span className="text-xs text-white">{p.full_name}</span>
        {p.team && <span className="text-[10px] text-slate-500">{p.team}</span>}
      </span>
    );
  };

  const PickPill = ({ pick }: { pick: SleeperTradedPick }) => {
    const slotLabel = pick.slot && String(pick.slot).includes(".")
      ? `${pick.season} ${pick.slot}`
      : `${pick.season} Rd ${pick.round}`;
    const viaName = pick.roster_id !== pick.owner_id
      ? (rosterOwnerMap[pick.roster_id] ?? null)
      : null;
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5">
        <span className="text-[10px] font-bold text-amber-400">PICK</span>
        <span className="text-xs text-white">{slotLabel}</span>
        {viaName && <span className="text-[10px] text-slate-500">via {viaName}</span>}
      </span>
    );
  };

  if (isTrade) {
    const sides: Record<number, { players: string[]; picks: SleeperTradedPick[] }> = {};
    Object.entries(adds).forEach(([playerId, rosterId]) => {
      if (!sides[rosterId]) sides[rosterId] = { players: [], picks: [] };
      sides[rosterId].players.push(playerId);
    });
    picks.forEach((pick) => {
      const rosterId = pick.owner_id;
      if (!sides[rosterId]) sides[rosterId] = { players: [], picks: [] };
      sides[rosterId].picks.push(pick);
    });

    return (
      <div className={`rounded-2xl border p-4 ${cardCls}`}>
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${typeLabelCls}`}>{typeLabel}</span>
          <span className="text-xs font-semibold text-slate-300">{tx.leagueName}</span>
          <span className="ml-auto text-[11px] text-slate-500 shrink-0">{relTime(tx.created)}</span>
        </div>
        <div className="space-y-2">
          {Object.entries(sides).map(([rosterIdStr, side]) => {
            const rosterId = Number(rosterIdStr);
            const ownerName = rosterOwnerMap[rosterId] ?? `Team ${rosterId}`;
            return (
              <div key={rosterId}>
                <div className="text-[10px] font-semibold text-slate-400 mb-1">{ownerName} receives</div>
                <div className="flex flex-wrap gap-1.5">
                  {side.players.map((pid) => <PlayerPill key={pid} playerId={pid} />)}
                  {side.picks.map((pick) => <PickPill key={`${pick.season}-${pick.round}-${pick.roster_id}-${pick.owner_id}`} pick={pick} />)}
                </div>
              </div>
            );
          })}
          {Object.keys(sides).length === 0 && (
            <p className="text-xs text-slate-500">Pick-only trade — no player assets.</p>
          )}
        </div>
      </div>
    );
  }

  const rosterId = tx.roster_ids?.[0];
  const ownerName = rosterOwnerMap[rosterId] ?? `Team ${rosterId ?? "?"}`;

  return (
    <div className={`rounded-2xl border p-4 ${cardCls}`}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${typeLabelCls}`}>{typeLabel}</span>
        <span className="text-xs font-semibold text-slate-300">{tx.leagueName}</span>
        <span className="ml-auto text-[11px] text-slate-500 shrink-0">{relTime(tx.created)}</span>
      </div>
      <div className="text-xs font-semibold text-slate-400 mb-2">{ownerName}</div>
      {hasAdds && (
        <div className="mb-1.5">
          <span className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold mr-2">Added</span>
          <span className="inline-flex flex-wrap gap-1.5">
            {Object.keys(adds).map((pid) => <PlayerPill key={pid} playerId={pid} />)}
          </span>
        </div>
      )}
      {hasDrops && (
        <div>
          <span className="text-[10px] uppercase tracking-wide text-red-400 font-semibold mr-2">Dropped</span>
          <span className="inline-flex flex-wrap gap-1.5">
            {Object.keys(drops).map((pid) => <PlayerPill key={pid} playerId={pid} />)}
          </span>
        </div>
      )}
    </div>
  );
}

export default function AlertsPage({
  alerts,
  actionableAlerts,
  watchlistEntries: _watchlistEntries,
  onDismissAlert,
  loadingExternalAlerts,
  leagueTransactions,
  loadingTransactions,
  players,
  injuryReportPlayers,
  currentNFLWeek,
  allTradeAttempts,
  allLeagues,
  rosterBriefings,
  onRefreshBriefing,
  onNavigateToAttempts,
}: AlertsPageProps) {
  const [feedTab, setFeedTab] = useState<"alerts" | "transactions" | "waivers" | "injury" | "news" | "beat" | "wire" | "briefing">("briefing");
  const [expandedInjuryId, setExpandedInjuryId] = useState<string | null>(null);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [beatItems, setBeatItems] = useState<BeatItem[]>([]);
  const [loadingBeat, setLoadingBeat] = useState(false);
  const [wireItems, setWireItems] = useState<BeatItem[]>([]);
  const [loadingWire, setLoadingWire] = useState(false);
  const [refreshingBriefingKey, setRefreshingBriefingKey] = useState<string | null>(null);

  useEffect(() => {
    if (feedTab !== "news") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingNews(true);
    fetch("/api/alerts/news")
      .then((r) => r.json())
      .then((data) => setNewsItems(data.items ?? []))
      .catch(() => setNewsItems([]))
      .finally(() => setLoadingNews(false));
  }, [feedTab]);

  useEffect(() => {
    if (feedTab !== "beat") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingBeat(true);
    const ownedNames = Object.values(players)
      .filter((p) => p?.full_name)
      .map((p) => p.full_name)
      .slice(0, 100);
    const q = ownedNames.join("|");
    fetch(`/api/alerts/beat-reports${q ? `?players=${encodeURIComponent(q)}` : ""}`)
      .then((r) => r.json())
      .then((data) => setBeatItems(data.items ?? []))
      .catch(() => setBeatItems([]))
      .finally(() => setLoadingBeat(false));
  }, [feedTab, players]);

  useEffect(() => {
    if (feedTab !== "wire") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingWire(true);
    fetch("/api/alerts/beat-reports?filter=transactions")
      .then((r) => r.json())
      .then((data) => setWireItems(data.items ?? []))
      .catch(() => setWireItems([]))
      .finally(() => setLoadingWire(false));
  }, [feedTab]);

  const tradeActivity = leagueTransactions.filter((tx) => tx.type === "trade");
  const waiverActivity = leagueTransactions.filter(
    (tx) => tx.type === "free_agent" || tx.type === "waiver"
  );

  const injuredCount = injuryReportPlayers.filter((r) => {
    const s = (r.player.injury_status || r.player.status || "").toLowerCase();
    return /ir|pup|out|doubtful|questionable|suspended|inactive/.test(s);
  }).length;

  // ── Bye week grouping ─────────────────────────────────────────
  const byeGroups: Record<number, InjuryReportPlayer[]> = {};
  if (currentNFLWeek > 0) {
    injuryReportPlayers.forEach((entry) => {
      const bye = Number(entry.player.bye_week || 0);
      if (bye >= currentNFLWeek && bye <= currentNFLWeek + 2) {
        if (!byeGroups[bye]) byeGroups[bye] = [];
        byeGroups[bye].push(entry);
      }
    });
  }
  const byeWeekNumbers = Object.keys(byeGroups)
    .map(Number)
    .sort((a, b) => a - b);

  const marketAlerts = alerts.filter(
    (a) => (a.category === "market" || a.category === "watchlist") && a.payload?.["direction"]
  );
  const gainers = [...marketAlerts]
    .filter((a) => a.payload?.["direction"] === "up")
    .sort((a, b) => ((b.payload?.["delta"] as number ?? 0) - (a.payload?.["delta"] as number ?? 0)));
  const fallers = [...marketAlerts]
    .filter((a) => a.payload?.["direction"] === "down")
    .sort((a, b) => ((a.payload?.["delta"] as number ?? 0) - (b.payload?.["delta"] as number ?? 0)));

  const TABS = [
    { key: "briefing", label: `GM Briefing${rosterBriefings && rosterBriefings.length > 0 ? ` (${rosterBriefings.length})` : ""}` },
    { key: "transactions", label: `Trades${tradeActivity.length > 0 ? ` (${tradeActivity.length})` : ""}` },
    { key: "waivers", label: `Waivers${waiverActivity.length > 0 ? ` (${waiverActivity.length})` : ""}` },
    { key: "injury", label: `Injury Report${injuredCount > 0 ? ` (${injuredCount})` : ""}` },
    { key: "alerts", label: `Alerts${alerts.length > 0 ? ` (${alerts.length})` : ""}` },
    { key: "news", label: "NFL News" },
    { key: "beat", label: "Beat Reports" },
    { key: "wire", label: "Transaction Wire" },
  ] as const;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Alerts Center
            </div>
            <h1 className="mt-2 text-3xl font-semibold text-white">Actionable today</h1>
            <p className="mt-1 text-sm text-slate-400">
              Internal changes, watchlist triggers, and matched news in one place.
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <div className="rounded-2xl border border-blue-800/60 bg-blue-950/40 px-3 py-2 text-right">
              <div className="text-[11px] uppercase tracking-[0.18em] text-blue-300">Alerts</div>
              <div className="mt-1 text-lg font-semibold text-white">{alerts.length}</div>
              <div className="text-xs text-slate-400">
                {loadingExternalAlerts ? "Refreshing news..." : `${actionableAlerts.length} actionable now`}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-right">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Trades</div>
              <div className="mt-1 text-lg font-semibold text-white">{tradeActivity.length}</div>
              <div className="text-xs text-slate-500">
                {loadingTransactions ? "Loading…" : `${waiverActivity.length} waiver moves`}
              </div>
            </div>
            {injuredCount > 0 && (
              <div className="rounded-2xl border border-red-800/60 bg-red-950/30 px-3 py-2 text-right">
                <div className="text-[11px] uppercase tracking-[0.18em] text-red-400">Injured</div>
                <div className="mt-1 text-lg font-semibold text-white">{injuredCount}</div>
                <div className="text-xs text-slate-500">tracked players</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {(() => {
        const openByLeague = allLeagues
          .map((lg) => ({
            leagueId: lg.league_id,
            name: lg.name,
            count: allTradeAttempts.filter(
              (a) => a.league_id === lg.league_id && a.status === "PENDING"
            ).length,
          }))
          .filter((entry) => entry.count > 0)
          .sort((a, b) => b.count - a.count);
        if (openByLeague.length === 0) return null;
        return (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Open Trades</div>
            <h2 className="mt-1 text-lg font-semibold text-white">Pending across all leagues</h2>
            <div className="mt-3 divide-y divide-slate-800">
              {openByLeague.map((entry) => (
                <button
                  key={entry.leagueId}
                  onClick={() => onNavigateToAttempts(entry.leagueId)}
                  className="w-full flex items-center justify-between py-2 text-left group hover:bg-slate-800/40 rounded-lg px-2 -mx-2 transition"
                >
                  <span className="text-sm text-slate-200 group-hover:text-white transition">{entry.name}</span>
                  <span className="rounded-full border border-yellow-700 bg-yellow-950/30 px-2.5 py-0.5 text-xs font-semibold text-yellow-300 group-hover:border-yellow-500 transition">
                    {entry.count} open →
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      <div>
        {/* ── Feed tabs ── */}
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
          {/* Tab toggle */}
          <div className="flex flex-wrap gap-1 bg-slate-800/60 rounded-xl p-1 mb-4">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFeedTab(tab.key)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
                  feedTab === tab.key
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Alerts tab ── */}
          {feedTab === "alerts" && (
            <div className="grid gap-3">
              {loadingExternalAlerts && (
                <p className="text-xs text-blue-400 -mb-1">Refreshing alerts...</p>
              )}
              {alerts.length > 1 && (
                <div className="flex justify-end -mb-1">
                  <button
                    type="button"
                    onClick={() => alerts.forEach((a) => onDismissAlert(a.id))}
                    className="text-xs text-slate-500 hover:text-red-300 transition"
                  >
                    Dismiss all
                  </button>
                </div>
              )}
              {(actionableAlerts.length > 0 ? actionableAlerts : alerts).slice(0, 20).map((alert) => (
                <div
                  key={alert.id}
                  className={`rounded-2xl border p-4 ${severityStyles[alert.severity] || severityStyles.low}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]">
                          {alert.category}
                        </span>
                        <span className="text-[11px] uppercase tracking-[0.16em] text-slate-300/80">
                          {alert.source}
                        </span>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-white">{alert.title}</div>
                      <div className="mt-1 text-sm text-slate-300">
                        {alert.category === "league" && alert.source !== "internal"
                          ? resolvePlayerIdsInDetail(alert.detail, players)
                          : alert.detail}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDismissAlert(alert.id)}
                      className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-slate-200 transition hover:border-white/25"
                    >
                      Dismiss
                    </button>
                  </div>

                  {(alert.link || alert.teamLabel) && (
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-300">
                      {alert.teamLabel && <span>{alert.teamLabel}</span>}
                      {alert.link && (
                        <a
                          href={alert.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-300 transition hover:text-blue-200"
                        >
                          Open source
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {alerts.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
                  Once values move, statuses change, or watchlist/news triggers hit, alerts will land here.
                </div>
              )}
            </div>
          )}

          {/* ── Trades tab ── */}
          {feedTab === "transactions" && (
            <div>
              {loadingTransactions ? (
                <p className="text-sm text-blue-400 py-4">Loading trades across all leagues…</p>
              ) : tradeActivity.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
                  No recent trades found. Make sure your leagues are loaded.
                </div>
              ) : (
                <div className="space-y-3">
                  {tradeActivity.map((tx) => (
                    <TxCard key={`${tx.leagueId}-${tx.transaction_id}`} tx={tx} players={players} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Waivers tab ── */}
          {feedTab === "waivers" && (
            <div>
              {loadingTransactions ? (
                <p className="text-sm text-blue-400 py-4">Loading waiver activity…</p>
              ) : waiverActivity.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
                  No recent waiver or free agent moves found across your leagues.
                </div>
              ) : (
                <div className="space-y-3">
                  {waiverActivity.map((tx) => (
                    <TxCard key={`${tx.leagueId}-${tx.transaction_id}`} tx={tx} players={players} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── NFL News tab ── */}
          {feedTab === "news" && (
            <div>
              {loadingNews ? (
                <p className="text-sm text-blue-400 py-4">Loading NFL news…</p>
              ) : newsItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
                  No news articles available right now. Check back soon.
                </div>
              ) : (
                <div className="space-y-3">
                  {newsItems.map((item) => {
                    const pub = item.published ? new Date(item.published) : null;
                    const timeAgo = pub ? relTime(pub.getTime()) : null;
                    return (
                      <div
                        key={item.id}
                        className={`rounded-2xl border p-4 ${item.playerNames && item.playerNames.length > 0 ? "border-blue-800/50 bg-blue-950/10" : "border-slate-800 bg-slate-900/40"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            {item.playerNames && item.playerNames.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {item.playerNames.map((name: string) => (
                                  <span key={name} className="text-[10px] font-semibold bg-blue-900/50 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded-lg">
                                    {name}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="text-sm font-semibold text-white leading-snug">{item.title}</div>
                            {item.summary && (
                              <div className="mt-1 text-xs text-slate-400 line-clamp-2">{item.summary}</div>
                            )}
                          </div>
                          {timeAgo && (
                            <span className="text-[11px] text-slate-500 shrink-0">{timeAgo}</span>
                          )}
                        </div>
                        {item.link && (
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-xs text-blue-400 hover:text-blue-300 transition"
                          >
                            Read full article →
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Beat Reports tab ── */}
          {feedTab === "beat" && (
            <div>
              {loadingBeat ? (
                <p className="text-sm text-blue-400 py-4">Loading beat writer reports…</p>
              ) : beatItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
                  No beat writer reports available right now. Sources: Pro Football Talk, CBS Sports.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Source legend */}
                  <div className="flex items-center gap-3 text-[10px] text-slate-500 flex-wrap pb-1">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                      Pro Football Talk
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                      CBS Sports
                    </span>
                    <span className="ml-auto italic">Owned players highlighted</span>
                  </div>

                  {beatItems.map((item) => {
                    const pub = item.published ? new Date(item.published) : null;
                    const timeAgo = pub && !isNaN(pub.getTime()) ? relTime(pub.getTime()) : null;
                    const isPFT = item.source === "pft";
                    const borderCls = item.impact
                      ? "border-amber-700/50 bg-amber-950/10"
                      : "border-slate-800 bg-slate-900/40";
                    const sourceDot = isPFT
                      ? "bg-orange-500"
                      : "bg-blue-500";
                    return (
                      <div key={item.id} className={`rounded-2xl border p-4 ${borderCls}`}>
                        <div className="flex items-start gap-3">
                          <span className={`mt-1.5 shrink-0 inline-block w-2 h-2 rounded-full ${sourceDot}`} title={item.sourceLabel} />
                          <div className="min-w-0 flex-1">
                            {/* Owned player badges */}
                            {item.playerNames && item.playerNames.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1.5">
                                {item.playerNames.map((name: string) => (
                                  <span key={name} className="text-[10px] font-semibold bg-amber-900/50 text-amber-300 border border-amber-700/50 px-2 py-0.5 rounded-lg">
                                    {name}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="text-sm font-semibold text-white leading-snug">{item.title}</div>
                            {item.summary && (
                              <div className="mt-1 text-xs text-slate-400 line-clamp-3">{item.summary}</div>
                            )}
                            <div className="mt-2 flex items-center gap-3 flex-wrap">
                              {item.author && (
                                <span className="text-[10px] font-semibold text-slate-400">{item.author}</span>
                              )}
                              <span className="text-[10px] text-slate-600">{item.sourceLabel}</span>
                              {timeAgo && (
                                <span className="text-[10px] text-slate-600 ml-auto">{timeAgo}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {item.link && (
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 ml-5 inline-block text-xs text-blue-400 hover:text-blue-300 transition"
                          >
                            Read full article →
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Transaction Wire tab ── */}
          {feedTab === "wire" && (
            <div>
              <p className="text-[11px] text-slate-500 mb-3">
                Real NFL moves — cuts, signings, IR designations, extensions, and suspensions — filtered from beat writer feeds.
              </p>
              {loadingWire ? (
                <p className="text-sm text-blue-400 py-4">Loading transaction wire…</p>
              ) : wireItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
                  No transactions detected right now. Check back during the season when roster moves are frequent.
                </div>
              ) : (
                <div className="space-y-2">
                  {wireItems.map((item) => {
                    const pub = item.published ? new Date(item.published) : null;
                    const timeAgo = pub && !isNaN(pub.getTime()) ? relTime(pub.getTime()) : null;
                    const isPFT = item.source === "pft";
                    return (
                      <div key={item.id} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3.5">
                        <div className="flex items-start gap-2.5">
                          <span
                            className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${isPFT ? "bg-orange-500" : "bg-blue-500"}`}
                            title={item.sourceLabel}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-white leading-snug">{item.title}</div>
                            {item.summary && (
                              <div className="mt-0.5 text-xs text-slate-400 line-clamp-2">{item.summary}</div>
                            )}
                            <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                              {item.author && (
                                <span className="text-[10px] font-semibold text-slate-400">{item.author}</span>
                              )}
                              <span className="text-[10px] text-slate-600">{item.sourceLabel}</span>
                              {timeAgo && <span className="text-[10px] text-slate-600 ml-auto">{timeAgo}</span>}
                            </div>
                          </div>
                        </div>
                        {item.link && (
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1.5 ml-[18px] inline-block text-xs text-blue-400 hover:text-blue-300 transition"
                          >
                            Full story →
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Bye Watch tab (removed from nav, kept for potential future use) ── */}
          {(feedTab as string) === "byes" && (
            <div>
              {currentNFLWeek === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
                  Bye watch is active during the regular season. Check back in September.
                </div>
              ) : byeWeekNumbers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
                  No owned players on bye in the next 3 weeks. You&apos;re in the clear.
                </div>
              ) : (
                <div className="space-y-5">
                  {byeWeekNumbers.map((week) => {
                    const offset = week - currentNFLWeek;
                    const label =
                      offset === 0 ? "This Week" :
                      offset === 1 ? "Next Week" :
                      "2 Weeks Out";
                    const urgency =
                      offset === 0 ? "border-red-700/60 bg-red-950/10 text-red-300" :
                      offset === 1 ? "border-amber-700/60 bg-amber-950/10 text-amber-300" :
                      "border-slate-700 bg-slate-900/40 text-slate-400";
                    const players = byeGroups[week];
                    // Group players by position for quick scanning
                    const byPos: Record<string, InjuryReportPlayer[]> = {};
                    players.forEach((entry) => {
                      const pos = entry.player.position || "?";
                      if (!byPos[pos]) byPos[pos] = [];
                      byPos[pos].push(entry);
                    });
                    return (
                      <div key={week} className={`rounded-2xl border p-4 ${urgency.split(" ").slice(0, 2).join(" ")}`}>
                        <div className="flex items-center gap-3 mb-3">
                          <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${urgency.split(" ")[2]}`}>
                            {label}
                          </span>
                          <span className="text-sm font-semibold text-white">Week {week} Bye</span>
                          <span className="ml-auto text-[11px] text-slate-500">{players.length} player{players.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="space-y-2">
                          {(["QB", "RB", "WR", "TE"] as const)
                            .filter((pos) => byPos[pos]?.length > 0)
                            .map((pos) => (
                              <div key={pos} className="flex items-start gap-2">
                                <span className={`text-[10px] font-bold w-7 shrink-0 pt-0.5 ${POS_COLOR[pos] ?? "text-slate-400"}`}>{pos}</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {byPos[pos].map(({ player, playerId, leagues, startingLeagues }) => (
                                    <span
                                      key={playerId}
                                      className={`text-xs px-2.5 py-1 rounded-xl border ${
                                        startingLeagues.length > 0
                                          ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-200"
                                          : "border-slate-700 bg-slate-800/50 text-slate-300"
                                      }`}
                                      title={`${leagues.length} league${leagues.length !== 1 ? "s" : ""}${startingLeagues.length > 0 ? ` — starting in ${startingLeagues.length}` : ""}`}
                                    >
                                      {player.full_name}
                                      {startingLeagues.length > 0 && (
                                        <span className="ml-1 text-[9px] text-emerald-400">★{startingLeagues.length}</span>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-[11px] text-slate-600 text-center">
                    Green highlight = currently in a starting lineup · ★ = number of leagues starting
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Value Movers tab (removed from nav, kept for potential future use) ── */}
          {(feedTab as string) === "movers" && (
            <div>
              {marketAlerts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
                  No significant value movement detected yet. Value movers appear once players cross your threshold in either direction.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Gainers */}
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400 mb-2">
                      Gaining Value ({gainers.length})
                    </div>
                    <div className="space-y-2">
                      {gainers.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
                          No gainers detected.
                        </div>
                      ) : gainers.map((alert) => {
                        const delta = (alert.payload?.["delta"] as number | undefined) ?? 0;
                        return (
                          <div key={alert.id} className="rounded-2xl border border-emerald-800/40 bg-emerald-950/10 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-white truncate">{alert.title.replace(" is climbing", "")}</div>
                                {alert.teamLabel && (
                                  <div className="text-[10px] text-slate-500">{alert.teamLabel}</div>
                                )}
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-sm font-bold text-emerald-400">+{delta.toLocaleString()}</div>
                                <div className="text-[10px] text-slate-500">dynasty pts</div>
                              </div>
                            </div>
                            {alert.severity === "high" && (
                              <div className="mt-1.5 text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">Major spike</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Fallers */}
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400 mb-2">
                      Losing Value ({fallers.length})
                    </div>
                    <div className="space-y-2">
                      {fallers.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
                          No fallers detected.
                        </div>
                      ) : fallers.map((alert) => {
                        const delta = Math.abs((alert.payload?.["delta"] as number | undefined) ?? 0);
                        return (
                          <div key={alert.id} className="rounded-2xl border border-red-800/40 bg-red-950/10 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-white truncate">{alert.title.replace(" is falling", "")}</div>
                                {alert.teamLabel && (
                                  <div className="text-[10px] text-slate-500">{alert.teamLabel}</div>
                                )}
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-sm font-bold text-red-400">-{delta.toLocaleString()}</div>
                                <div className="text-[10px] text-slate-500">dynasty pts</div>
                              </div>
                            </div>
                            {alert.severity === "high" && (
                              <div className="mt-1.5 text-[10px] font-semibold text-red-300 uppercase tracking-wider">Major drop</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── GM Briefing tab ── */}
          {feedTab === "briefing" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">AI-powered briefings — click ↻ on any team to refresh</span>
              </div>
              {!rosterBriefings || rosterBriefings.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-500">
                  Load your leagues to see your GM briefings across all leagues.
                </div>
              ) : (
                <>
                {rosterBriefings.map((b) => {
                  const cardKey = `${b.leagueId}-${b.rosterId}`;
                  const isRefreshing = refreshingBriefingKey === cardKey;

                  const urgencyStyle =
                    b.urgency === "critical" ? "border-red-700/60 bg-red-950/30" :
                    b.urgency === "high"     ? "border-amber-700/60 bg-amber-950/20" :
                    b.urgency === "medium"   ? "border-slate-700 bg-slate-900/60" :
                                              "border-slate-800 bg-slate-950/40";

                  const urgencyBadge =
                    b.urgency === "critical" ? "border-red-700 bg-red-900/50 text-red-300" :
                    b.urgency === "high"     ? "border-amber-700 bg-amber-900/40 text-amber-300" :
                    b.urgency === "medium"   ? "border-slate-600 bg-slate-800/60 text-slate-300" :
                                              "border-slate-700 bg-slate-900/40 text-slate-400";

                  const timestampLabel = b.generatedAt
                    ? (() => {
                        const diffMs = Date.now() - new Date(b.generatedAt).getTime();
                        const diffMin = Math.floor(diffMs / 60000);
                        const diffHr  = Math.floor(diffMin / 60);
                        const diffDay = Math.floor(diffHr / 24);
                        if (diffMin < 2)  return "just now";
                        if (diffMin < 60) return `${diffMin}m ago`;
                        if (diffHr  < 24) return `${diffHr}h ago`;
                        return `${diffDay}d ago`;
                      })()
                    : null;

                  return (
                    <div key={cardKey} className={`rounded-2xl border px-4 py-3.5 space-y-2.5 ${urgencyStyle}`}>
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="text-sm font-semibold text-white truncate">{b.leagueName}</span>
                          <span className={`text-[10px] font-semibold border px-2 py-0.5 rounded-lg shrink-0 ${b.bucketColor}`}>
                            {b.bucket}
                          </span>
                          {b.isAi && (
                            <span className="text-[10px] font-medium border border-violet-700/50 bg-violet-950/40 text-violet-300 px-1.5 py-0.5 rounded-md shrink-0">AI</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-[10px] font-bold uppercase tracking-wider border px-2.5 py-1 rounded-xl ${urgencyBadge}`}>
                            {b.urgencyLabel}
                          </span>
                          {onRefreshBriefing && (
                            <button
                              onClick={async () => {
                                setRefreshingBriefingKey(cardKey);
                                const newsPool = [...newsItems, ...beatItems, ...wireItems]
                                  .map((n) => ({ title: n.title, playerNames: n.playerNames }));
                                try { await onRefreshBriefing(b.rosterId, b.leagueId, newsPool); }
                                finally { setRefreshingBriefingKey(null); }
                              }}
                              disabled={isRefreshing}
                              title="Refresh AI briefing"
                              className="flex items-center justify-center w-6 h-6 rounded-lg border border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-500 hover:bg-slate-700/60 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Headline */}
                      <p className="text-sm font-medium text-white leading-snug">{b.headline}</p>

                      {/* Writeup */}
                      <p className="text-xs text-slate-300 leading-relaxed">{b.writeup}</p>

                      {/* Action bullets */}
                      {b.bullets.length > 0 && (
                        <ul className="space-y-1">
                          {b.bullets.map((bullet) => (
                            <li key={bullet} className="flex items-start gap-2 text-xs text-slate-400">
                              <span className="mt-0.5 shrink-0 text-slate-600">•</span>
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Player trend pills */}
                      {(b.fallingPlayers.length > 0 || b.risingPlayers.length > 0) && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {b.fallingPlayers.map((p) => (
                            <span
                              key={p.name}
                              className="inline-flex items-center gap-1 border border-red-800/60 bg-red-950/40 text-red-300 text-[10px] font-medium px-2 py-0.5 rounded-lg"
                            >
                              <span className="text-red-500">↓</span>
                              <span>{p.name}</span>
                              <span className="text-red-500/70">{p.delta.toLocaleString()}</span>
                            </span>
                          ))}
                          {b.risingPlayers.map((p) => (
                            <span
                              key={p.name}
                              className="inline-flex items-center gap-1 border border-emerald-800/60 bg-emerald-950/40 text-emerald-300 text-[10px] font-medium px-2 py-0.5 rounded-lg"
                            >
                              <span className="text-emerald-500">↑</span>
                              <span>{p.name}</span>
                              <span className="text-emerald-500/70">+{p.delta.toLocaleString()}</span>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Timestamp */}
                      {timestampLabel && (
                        <div className="text-[10px] text-slate-600 pt-0.5">Updated {timestampLabel}</div>
                      )}
                    </div>
                  );
                })}

                {/* League last-updated footer */}
                <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 mb-2">Last updated by league</div>
                  <div className="divide-y divide-slate-800/60">
                    {rosterBriefings.map((b) => {
                      const ts = b.generatedAt ? new Date(b.generatedAt) : null;
                      let label = "Never";
                      if (ts && !isNaN(ts.getTime())) {
                        const diffMs = Date.now() - ts.getTime();
                        const diffMin = Math.floor(diffMs / 60000);
                        const diffHr  = Math.floor(diffMin / 60);
                        const diffDay = Math.floor(diffHr / 24);
                        if (diffMin < 2)  label = "just now";
                        else if (diffMin < 60) label = `${diffMin}m ago`;
                        else if (diffHr < 24)  label = `${diffHr}h ago`;
                        else label = `${diffDay}d ago`;
                      }
                      return (
                        <div key={`${b.leagueId}-${b.rosterId}`} className="flex items-center justify-between py-1.5 gap-3">
                          <span className="text-xs text-slate-300 truncate">{b.leagueName}</span>
                          <span className={`text-[11px] shrink-0 ${b.generatedAt ? "text-slate-500" : "text-slate-700"}`}>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                </>
              )}
            </div>
          )}

          {/* ── Injury Report tab ── */}
          {feedTab === "injury" && (
            <div>
              {injuryReportPlayers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
                  Add players to your watchlist or load your leagues to see injury statuses here.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {injuryReportPlayers.map(({ player, playerId, leagues, startingLeagues, isWatchlisted }) => {
                    const { cls: statusCls, label: statusLabel } = injuryStatusStyle(player);
                    const byeWeek = Number(player.bye_week || 0);
                    const byeWeeksOut = currentNFLWeek && byeWeek ? byeWeek - currentNFLWeek : null;
                    const showBye = byeWeeksOut === 1 || byeWeeksOut === 2;
                    const isExpanded = expandedInjuryId === playerId;

                    return (
                      <div key={playerId} className="rounded-2xl border border-slate-800 overflow-hidden">
                        {/* Clickable nameplate row */}
                        <button
                          type="button"
                          onClick={() => setExpandedInjuryId(isExpanded ? null : playerId)}
                          className="w-full text-left bg-slate-950/40 px-3 py-2.5 flex items-center gap-3 hover:bg-slate-800/40 transition"
                        >
                          <span className={`text-[10px] font-bold shrink-0 ${POS_COLOR[player.position] ?? "text-slate-400"}`}>
                            {player.position}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-white truncate">{player.full_name}</div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-slate-400">{player.team || "FA"}</span>
                              {startingLeagues.length > 0 && (
                                <span className="text-[10px] text-emerald-500">
                                  Starting in {startingLeagues.length} {startingLeagues.length === 1 ? "league" : "leagues"}
                                </span>
                              )}
                              {isWatchlisted && leagues.length === 0 && (
                                <span className="text-[10px] text-amber-500">Watchlist only</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {showBye && (
                              <span className="text-[10px] font-semibold border border-purple-700 bg-purple-900/30 text-purple-300 px-2 py-0.5 rounded-lg">
                                Bye Wk {byeWeek}
                              </span>
                            )}
                            {leagues.length > 0 && (
                              <span className="text-[10px] font-semibold border border-slate-600 bg-slate-800/60 text-slate-300 px-2 py-0.5 rounded-lg whitespace-nowrap">
                                {startingLeagues.length > 0
                                  ? `Starting ${startingLeagues.length}/${leagues.length}`
                                  : `Owned ${leagues.length}`}
                              </span>
                            )}
                            <span className={`text-[10px] font-semibold border px-2 py-0.5 rounded-lg ${statusCls}`}>
                              {statusLabel}
                            </span>
                            <span className={`inline-block transition-transform duration-150 text-slate-600 text-xs ${isExpanded ? "rotate-180" : ""}`}>▼</span>
                          </div>
                        </button>

                        {/* Expanded: starting lineup detail */}
                        {isExpanded && (
                          <div className="border-t border-slate-800 bg-slate-900/60 px-4 py-3">
                            {startingLeagues.length > 0 ? (
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-500 mb-2">
                                  In starting lineup
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {startingLeagues.map((name) => (
                                    <span
                                      key={name}
                                      className="text-xs border border-emerald-800/60 bg-emerald-950/40 text-emerald-300 px-2.5 py-1 rounded-xl"
                                    >
                                      {name}
                                    </span>
                                  ))}
                                </div>
                                {leagues.length > startingLeagues.length && (
                                  <div className="mt-2.5">
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1.5">
                                      On bench
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {leagues
                                        .filter((l) => !startingLeagues.includes(l))
                                        .map((name) => (
                                          <span
                                            key={name}
                                            className="text-xs border border-slate-700 bg-slate-800/40 text-slate-400 px-2.5 py-1 rounded-xl"
                                          >
                                            {name}
                                          </span>
                                        ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : leagues.length > 0 ? (
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1.5">
                                  On bench in all leagues
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {leagues.map((name) => (
                                    <span
                                      key={name}
                                      className="text-xs border border-slate-700 bg-slate-800/40 text-slate-400 px-2.5 py-1 rounded-xl"
                                    >
                                      {name}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-500">Not on any of your rosters — watchlist only.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
