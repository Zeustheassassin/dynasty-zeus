import { useState } from "react";
import type { DashboardAlert, LeagueTransaction, InjuryReportPlayer } from "../alertsPageHelpers";

type FeedTabKey = "alerts" | "transactions" | "waivers" | "injury";

type Params = {
  leagueTransactions: LeagueTransaction[];
  injuryReportPlayers: InjuryReportPlayer[];
  currentNFLWeek: number;
  alerts: DashboardAlert[];
};

export function useAlertsState({
  leagueTransactions,
  injuryReportPlayers,
  currentNFLWeek,
  alerts,
}: Params) {
  const [feedTab, setFeedTab] = useState<FeedTabKey>("transactions");
  const [expandedInjuryId, setExpandedInjuryId] = useState<string | null>(null);

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
    { key: "transactions" as const, label: `Trades${tradeActivity.length > 0 ? ` (${tradeActivity.length})` : ""}` },
    { key: "waivers" as const, label: `Waivers${waiverActivity.length > 0 ? ` (${waiverActivity.length})` : ""}` },
    { key: "injury" as const, label: `Injury Report${injuredCount > 0 ? ` (${injuredCount})` : ""}` },
    { key: "alerts" as const, label: `Alerts${alerts.length > 0 ? ` (${alerts.length})` : ""}` },
  ];

  return {
    feedTab,
    setFeedTab,
    expandedInjuryId,
    setExpandedInjuryId,
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
