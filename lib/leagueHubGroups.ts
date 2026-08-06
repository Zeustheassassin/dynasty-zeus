import type { LeagueHubTab } from "./types";

export const LEAGUE_HUB_GROUPS: Array<{
  id: string;
  label: string;
  tabs: Array<{ id: LeagueHubTab; label: string }>;
}> = [
  {
    id: "SUMMARY",
    label: "Summary",
    tabs: [
      { id: "OVERVIEW", label: "League Overview" },
      { id: "SIMULATOR", label: "Season Simulator" },
      { id: "POWER_RANKINGS", label: "Power Rankings" },
      { id: "STANDINGS", label: "Standings" },
      { id: "RECAP", label: "Season Recap" },
    ],
  },
  {
    id: "ROSTERS",
    label: "Rosters",
    tabs: [
      { id: "ROSTERS", label: "Rosters & Rules" },
      { id: "ROSTER_OVERVIEW", label: "Roster Overview" },
      { id: "OPP_ROSTERS", label: "Opponent Rosters" },
      { id: "STARTERS", label: "Suggested Starters" },
      { id: "ROSTER_TOOLS", label: "Team Tools" },
    ],
  },
  {
    id: "NOTES",
    label: "Notes",
    tabs: [
      { id: "NOTES", label: "League Notes" },
      { id: "ACTIVITY", label: "Activity Feed" },
    ],
  },
];
