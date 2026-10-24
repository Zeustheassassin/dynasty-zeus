"use client";
import { useState, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";
import { useDebouncedKeyedEffect } from "../lib/hooks/useDebouncedKeyedEffect";
import { getPaymentYears } from "../lib/constants";
import { getLeagueSafeCarryForward, resolveLeagueSafeLinks } from "../lib/helpers/leagueSafe";
import type { LeagueMgmtData, CommPaymentsData, LeagueCommitmentStatus, LeagueSafeLinks, SleeperLeague, SleeperRoster, SleeperUser } from "../lib/types";

const COMMITMENT_STATUSES: LeagueCommitmentStatus[] = ["", "staying", "on_fence", "leaving"];

// LeagueSafe links cover the same four calendar years as the Paid columns.
const LEAGUESAFE_YEARS = getPaymentYears();

const log = logger("hooks/useManagementState");

export type MgmtHubTab = "LEAGUE_MGMT" | "LEAGUESAFE" | "COMMISSIONER_TOOLS" | "BYLAWS";

export interface UseManagementStateReturn {
  mgmtHubTab: MgmtHubTab;
  setMgmtHubTab: Dispatch<SetStateAction<MgmtHubTab>>;
  leagueMgmtData: LeagueMgmtData;
  setLeagueMgmtData: Dispatch<SetStateAction<LeagueMgmtData>>;
  commPaymentsData: CommPaymentsData;
  setCommPaymentsData: Dispatch<SetStateAction<CommPaymentsData>>;
  commToolsLeagueId: string;
  setCommToolsLeagueId: Dispatch<SetStateAction<string>>;
  commToolsRosters: SleeperRoster[];
  setCommToolsRosters: Dispatch<SetStateAction<SleeperRoster[]>>;
  commToolsUsers: Record<string, SleeperUser>;
  setCommToolsUsers: Dispatch<SetStateAction<Record<string, SleeperUser>>>;
  loadingCommToolsRosters: boolean;
  setLoadingCommToolsRosters: Dispatch<SetStateAction<boolean>>;
  leagueBylaws: Record<string, string>;
  saveLeagueBylaws: (leagueId: string, text: string) => void;
  /** Each current league's LeagueSafe links by season, read through previous_league_id. */
  leagueSafeLinks: LeagueSafeLinks;
  /** Saves one season's link ("" clears it). Resolves false when the save failed (the edit is undone). */
  saveLeagueSafeLink: (leagueId: string, season: number, url: string) => Promise<boolean>;
}

export function useManagementState(
  supabaseUser: { id: string } | null,
  leagues: SleeperLeague[],
): UseManagementStateReturn {
  const [mgmtHubTab, setMgmtHubTab] = useState<MgmtHubTab>("LEAGUE_MGMT");
  const [leagueMgmtData, setLeagueMgmtData] = useState<LeagueMgmtData>({});
  const [commPaymentsData, setCommPaymentsData] = useState<CommPaymentsData>({});
  const [commToolsLeagueId, setCommToolsLeagueId] = useState<string>("");
  const [commToolsRosters, setCommToolsRosters] = useState<SleeperRoster[]>([]);
  const [commToolsUsers, setCommToolsUsers] = useState<Record<string, SleeperUser>>({});
  const [loadingCommToolsRosters, setLoadingCommToolsRosters] = useState(false);
  const [leagueBylaws, setLeagueBylaws] = useState<Record<string, string>>({});
  // Rows as saved, keyed by the league_id they were saved under. Tagged with
  // the account that loaded them so a sign-out or account switch never shows
  // (or copies forward) another account's links.
  const [leagueSafeStore, setLeagueSafeStore] = useState<{ userId: string; links: LeagueSafeLinks } | null>(null);
  const storedLeagueSafeLinks =
    leagueSafeStore && leagueSafeStore.userId === supabaseUser?.id ? leagueSafeStore.links : null;
  // Debounces the bylaws Supabase write so rapid typing collapses to one
  // upsert of the final text per league, instead of one per keystroke.
  const scheduleWrite = useDebouncedKeyedEffect();

  useEffect(() => {
    if (!supabaseUser?.id) return;

    let cancelled = false;

    // League management checkboxes
    supabase
      .from("league_management")
      .select("*")
      .eq("user_id", supabaseUser.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          log.error("league_management load failed", { err: error.message });
          return;
        }
        if (data && data.length > 0) {
          const map: LeagueMgmtData = {};
          data.forEach((row: Record<string, unknown>) => {
            // Read all paid_YYYY keys dynamically so new year columns
            // added via migration are picked up without code changes.
            const paymentFields: Record<`paid_${number}`, boolean> = {};
            Object.keys(row).forEach((k) => {
              if (k.startsWith("paid_")) {
                (paymentFields as Record<string, boolean>)[k] = Boolean(row[k]);
              }
            });
            const leagueId = String(row.league_id);
            const commitmentStatus = COMMITMENT_STATUSES.includes(row.commitment_status as LeagueCommitmentStatus)
              ? (row.commitment_status as LeagueCommitmentStatus)
              : "";
            map[leagueId] = {
              ...paymentFields,
              commissioner: Boolean(row.commissioner),
              year_in_advance: Boolean(row.year_in_advance),
              picks_traded: Boolean(row.picks_traded),
              offseason_budget: Boolean(row.offseason_budget),
              amount: typeof row.amount === "string" ? row.amount : "",
              commitment_status: commitmentStatus,
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
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          log.error("commissioner_payments load failed", { err: error.message });
          return;
        }
        if (data && data.length > 0) {
          const map: CommPaymentsData = {};
          data.forEach((row: Record<string, unknown>) => {
            const leagueId = String(row.league_id);
            const ownerId = String(row.owner_id);
            if (!map[leagueId]) map[leagueId] = {};
            // Read all paid_YYYY keys dynamically — matches ManagementHub's approach.
            const payments: Record<string, boolean> = {};
            Object.keys(row).forEach((k) => {
              if (k.startsWith("paid_")) payments[k] = Boolean(row[k]);
            });
            map[leagueId][ownerId] = payments;
          });
          setCommPaymentsData(map);
        }
      });

    // League bylaws/constitution text (Phase I, I3)
    supabase
      .from("league_bylaws")
      .select("league_id, content")
      .eq("user_id", supabaseUser.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          log.error("league_bylaws load failed", { err: error.message });
          return;
        }
        if (data && data.length > 0) {
          const map: Record<string, string> = {};
          data.forEach((row: { league_id: string; content: string }) => { map[row.league_id] = row.content; });
          setLeagueBylaws(map);
        }
      });

    // LeagueSafe links, one row per league per season (migration 081)
    const userId = supabaseUser.id;
    supabase
      .from("leaguesafe_links")
      .select("league_id, season, url")
      .eq("user_id", userId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          log.error("leaguesafe_links load failed", { err: error.message });
          return;
        }
        const links: LeagueSafeLinks = {};
        (data ?? []).forEach((row: { league_id: string; season: number; url: string | null }) => {
          (links[row.league_id] ??= {})[row.season] = row.url ?? "";
        });
        setLeagueSafeStore({ userId, links });
      });

    return () => { cancelled = true; };
  }, [supabaseUser?.id]);

  // Copy links saved under a league's previous season onto the renewed
  // league, so next year's renewal still finds them one hop back. Insert-only
  // (ignoreDuplicates): never overwrites a row saved under the new league.
  useEffect(() => {
    if (!supabaseUser?.id || !storedLeagueSafeLinks) return;
    const rows = getLeagueSafeCarryForward(leagues, storedLeagueSafeLinks, LEAGUESAFE_YEARS);
    if (rows.length === 0) return;
    let cancelled = false;
    const userId = supabaseUser.id;
    const updatedAt = new Date().toISOString();
    supabase
      .from("leaguesafe_links")
      .upsert(
        rows.map((row) => ({ user_id: userId, ...row, updated_at: updatedAt })),
        { onConflict: "user_id,league_id,season", ignoreDuplicates: true },
      )
      .then(({ error }) => {
        if (cancelled) return;
        if (error) {
          log.error("leaguesafe_links carry-forward failed", { err: error.message, rows: rows.length });
          return;
        }
        setLeagueSafeStore((prev) => {
          if (!prev || prev.userId !== userId) return prev;
          const links = { ...prev.links };
          rows.forEach(({ league_id, season, url }) => {
            if (links[league_id]?.[season] === undefined) links[league_id] = { ...(links[league_id] ?? {}), [season]: url };
          });
          return { userId, links };
        });
      });
    return () => { cancelled = true; };
  }, [supabaseUser?.id, leagues, storedLeagueSafeLinks]);

  const leagueSafeLinks = useMemo(() => {
    const resolved: LeagueSafeLinks = {};
    if (!storedLeagueSafeLinks) return resolved;
    leagues.forEach((league) => {
      resolved[league.league_id] = resolveLeagueSafeLinks(league, storedLeagueSafeLinks);
    });
    return resolved;
  }, [leagues, storedLeagueSafeLinks]);

  const saveLeagueSafeLink = async (leagueId: string, season: number, url: string): Promise<boolean> => {
    if (!supabaseUser) return false;
    const userId = supabaseUser.id;
    const setSeason = (value: string | undefined) =>
      setLeagueSafeStore((prev) => {
        const links = prev && prev.userId === userId ? { ...prev.links } : {};
        const seasons = { ...(links[leagueId] ?? {}) };
        if (value === undefined) delete seasons[season];
        else seasons[season] = value;
        links[leagueId] = seasons;
        return { userId, links };
      });
    const previous = storedLeagueSafeLinks?.[leagueId]?.[season];
    setSeason(url);
    const { error } = await supabase.from("leaguesafe_links").upsert(
      { user_id: userId, league_id: leagueId, season, url, updated_at: new Date().toISOString() },
      { onConflict: "user_id,league_id,season" },
    );
    if (error) {
      log.error("leaguesafe_links upsert failed", { err: error.message });
      setSeason(previous);
      return false;
    }
    return true;
  };

  const saveLeagueBylaws = (leagueId: string, text: string) => {
    setLeagueBylaws((prev) => ({ ...prev, [leagueId]: text }));
    if (!supabaseUser) return;
    scheduleWrite(`league_bylaws:${supabaseUser.id}:${leagueId}`, () => {
      supabase.from("league_bylaws").upsert(
        { user_id: supabaseUser.id, league_id: leagueId, content: text, updated_at: new Date().toISOString() },
        { onConflict: "user_id,league_id" }
      ).then(({ error }) => {
        if (error) log.error("league_bylaws upsert failed", { err: error.message });
      });
    });
  };

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
    leagueBylaws,
    saveLeagueBylaws,
    leagueSafeLinks,
    saveLeagueSafeLink,
  };
}
