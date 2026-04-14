"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseclient";

export type MgmtHubTab = "LEAGUE_MGMT" | "COMMISSIONER_TOOLS";

export function useManagementState(supabaseUser: any) {
  const [mgmtHubTab, setMgmtHubTab] = useState<MgmtHubTab>("LEAGUE_MGMT");
  // { [leagueId]: { paid_YYYY: boolean, commissioner, year_in_advance, picks_traded, amount } }
  const [leagueMgmtData, setLeagueMgmtData] = useState<Record<string, Record<string, any>>>({});
  // { [leagueId]: { [ownerId]: { paid_YYYY: boolean } } }
  const [commPaymentsData, setCommPaymentsData] = useState<Record<string, Record<string, Record<string, boolean>>>>({});
  const [commToolsLeagueId, setCommToolsLeagueId] = useState<string>("");
  const [commToolsRosters, setCommToolsRosters] = useState<any[]>([]);
  const [commToolsUsers, setCommToolsUsers] = useState<Record<string, any>>({});
  const [loadingCommToolsRosters, setLoadingCommToolsRosters] = useState(false);

  useEffect(() => {
    if (!supabaseUser) return;

    // League management checkboxes
    supabase
      .from("league_management")
      .select("*")
      .eq("user_id", supabaseUser.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const map: Record<string, Record<string, any>> = {};
          data.forEach((row: any) => {
            // Read all paid_YYYY keys dynamically so new year columns
            // added via migration are picked up without code changes.
            const paymentFields: Record<string, boolean> = {};
            Object.keys(row).forEach((k) => {
              if (k.startsWith("paid_")) paymentFields[k] = row[k];
            });
            map[row.league_id] = {
              ...paymentFields,
              commissioner: row.commissioner,
              year_in_advance: row.year_in_advance,
              picks_traded: row.picks_traded,
              amount: row.amount ?? "",
            };
          });
          setLeagueMgmtData(map);
        }
      });

    // Commissioner payments
    supabase
      .from("commissioner_payments")
      .select("*")
      .eq("user_id", supabaseUser.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const map: Record<string, Record<string, Record<string, boolean>>> = {};
          data.forEach((row: any) => {
            if (!map[row.league_id]) map[row.league_id] = {};
            // Read all paid_YYYY keys dynamically — matches ManagementHub's approach.
            const payments: Record<string, boolean> = {};
            Object.keys(row).forEach((k) => {
              if (k.startsWith("paid_")) payments[k] = row[k];
            });
            map[row.league_id][row.owner_id] = payments;
          });
          setCommPaymentsData(map);
        }
      });
  }, [supabaseUser]);

  return {
    mgmtHubTab,
    setMgmtHubTab,
    leagueMgmtData,
    setLeagueMgmtData,
    commPaymentsData,
    setCommPaymentsData,
    commToolsLeagueId,
    setCommToolsLeagueId,
    commToolsRosters,
    setCommToolsRosters,
    commToolsUsers,
    setCommToolsUsers,
    loadingCommToolsRosters,
    setLoadingCommToolsRosters,
  };
}
