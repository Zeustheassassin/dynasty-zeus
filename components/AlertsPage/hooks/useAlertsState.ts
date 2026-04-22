import { useState, useEffect } from "react";
import type { SleeperPlayer, GmBriefing } from "../../../lib/types";
import type { DashboardAlert, LeagueTransaction, InjuryReportPlayer, NewsItem, BeatItem } from "../alertsPageHelpers";

type FeedTabKey = "alerts" | "transactions" | "waivers" | "injury" | "news" | "beat" | "wire" | "briefing";

type Params = {
  leagueTransactions: LeagueTransaction[];
  injuryReportPlayers: InjuryReportPlayer[];
  currentNFLWeek: number;
  alerts: DashboardAlert[];
  rosterBriefings?: GmBriefing[];
  players: Record<string, SleeperPlayer>;
};

export function useAlertsState({
  leagueTransactions,
  injuryReportPlayers,
  currentNFLWeek,
  alerts,
  rosterBriefings,
  players,
}: Params) {
  const [feedTab, setFeedTab] = useState<FeedTabKey>("briefing");
  const [expandedInjuryId, setExpandedInjuryId] = useState<string | null>(null);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [beatItems, setBeatItems] = useState<BeatItem[]>([]);
  const [loadingBeat, setLoadingBeat] = useState(false);
  const [wireItems, setWireItems] = useState<BeatItem[]>([]);
  const [loadingWire, setLoadingWire] = useState(false);

  useEffect(() => {
    if (feedTab !== "news") return;
    setLoadingNews(true);
    fetch("/api/alerts/news")
      .then((r) => r.json())
      .then((data) => setNewsItems(data.items ?? []))
      .catch(() => setNewsItems([]))
      .finally(() => setLoadingNews(false));
  }, [feedTab]);

  useEffect(() => {
    if (feedTab !== "beat") return;
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
    { key: "briefing" as const, label: `GM Briefing${rosterBriefings && rosterBriefings.length > 0 ? ` (${rosterBriefings.length})` : ""}` },
    { key: "transactions" as const, label: `Trades${tradeActivity.length > 0 ? ` (${tradeActivity.length})` : ""}` },
    { key: "waivers" as const, label: `Waivers${waiverActivity.length > 0 ? ` (${waiverActivity.length})` : ""}` },
    { key: "injury" as const, label: `Injury Report${injuredCount > 0 ? ` (${injuredCount})` : ""}` },
    { key: "alerts" as const, label: `Alerts${alerts.length > 0 ? ` (${alerts.length})` : ""}` },
    { key: "news" as const, label: "NFL News" },
    { key: "beat" as const, label: "Beat Reports" },
    { key: "wire" as const, label: "Transaction Wire" },
  ];

  return {
    feedTab,
    setFeedTab,
    expandedInjuryId,
    setExpandedInjuryId,
    newsItems,
    loadingNews,
    beatItems,
    loadingBeat,
    wireItems,
    loadingWire,
    tradeActivity,
    waiverActivity,
    injuredCount,
    byeGroups,
    byeWeekNumbers,
    marketAlerts,
    gainers,
    fallers,
    TABS,
  };
}
