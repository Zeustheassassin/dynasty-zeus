"use client";
import React from "react";
import { AuthProvider } from "../../lib/AuthContext";
import { PlayersProvider } from "../../lib/PlayersContext";
import { LeagueProvider } from "../../lib/LeagueContext";
import { ValuesProvider } from "../../lib/ValuesContext";
import { RosterProvider } from "../../lib/RosterContext";
import type { User as SupabaseUser } from "@supabase/auth-js";
import type {
  SleeperPlayer, SleeperLeague, SleeperRoster,
  RosterDirectionProfile, LeagueSimulation, DynamicPickValue,
} from "../../lib/types";

interface AppProvidersProps {
  supabaseUser: SupabaseUser | null;
  players: Record<string, SleeperPlayer>;
  selectedLeague: SleeperLeague | null;
  rosters: SleeperRoster[];
  users: Record<string, string>;
  leagueAdjustedFcValues: Record<string, number>;
  leagueAdjustedRedraftValues: Record<string, number>;
  pickFcValues: Record<string, number>;
  fcNameValues: Record<string, number>;
  selectedLeagueDirection: RosterDirectionProfile | null;
  selectedLeagueDirectionAdjusted: RosterDirectionProfile | null;
  selectedLeagueSimulation: LeagueSimulation | null;
  selectedLeagueDynamicPickValues: Record<string, DynamicPickValue>;
  myRoster: SleeperRoster | null;
  children: React.ReactNode;
}

export function AppProviders({
  supabaseUser,
  players,
  selectedLeague,
  rosters,
  users,
  leagueAdjustedFcValues,
  leagueAdjustedRedraftValues,
  pickFcValues,
  fcNameValues,
  selectedLeagueDirection,
  selectedLeagueDirectionAdjusted,
  selectedLeagueSimulation,
  selectedLeagueDynamicPickValues,
  myRoster,
  children,
}: AppProvidersProps) {
  return (
    <AuthProvider supabaseUser={supabaseUser}>
    <PlayersProvider players={players}>
    <LeagueProvider selectedLeague={selectedLeague} rosters={rosters} users={users}>
    <ValuesProvider
      leagueAdjustedFcValues={leagueAdjustedFcValues}
      leagueAdjustedRedraftValues={leagueAdjustedRedraftValues}
      pickFcValues={pickFcValues}
      fcNameValues={fcNameValues}
      selectedLeagueDirection={selectedLeagueDirection}
      selectedLeagueDirectionAdjusted={selectedLeagueDirectionAdjusted}
      selectedLeagueSimulation={selectedLeagueSimulation}
      selectedLeagueDynamicPickValues={selectedLeagueDynamicPickValues}
    >
    <RosterProvider myRoster={myRoster}>
      {children}
    </RosterProvider>
    </ValuesProvider>
    </LeagueProvider>
    </PlayersProvider>
    </AuthProvider>
  );
}
