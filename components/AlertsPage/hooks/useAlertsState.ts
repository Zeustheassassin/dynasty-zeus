import { useState } from "react";
import type { AlertsFeedTab } from "../../../app/hooks/useHubRouting";
import type { DashboardAlert, LeagueTransaction, InjuryReportPlayer } from "../alertsPageHelpers";
import { getInjuredCount, getMarketMovers } from "../alertsPageHelpers";

type Params = {
  feedTab: AlertsFeedTab;
  setFeedTab: (tab: AlertsFeedTab) => void;
  leagueTransactions: LeagueTransaction[];
  injuryReportPlayers: InjuryReportPlayer[];
  currentNFLWeek: number;
  alerts: DashboardAlert[];
};

export function useAlertsState({
  feedTab,
  setFeedTab,
  leagueTransactions,
  injuryReportPlayers,
  currentNFLWeek,
  alerts,
}: Params) {
  const [expandedInjuryId, setExpandedInjuryId] = useState<string | null>(null);

  const tradeActivity = leagueTransactions.filter((tx) => tx.type === "trade");
  const waiverActivity = leagueTransactions.filter(
    (tx) => tx.type === "free_agent" || tx.type === "waiver"
  );

  const injuredCount = getInjuredCount(injuryReportPlayers);

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

  const { marketAlerts, gainers, fallers } = getMarketMovers(alerts);

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
