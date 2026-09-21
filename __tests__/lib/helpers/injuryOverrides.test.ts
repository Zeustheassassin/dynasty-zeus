import { describe, it, expect } from "vitest";
import { applyInjuryOverrides, mapEspnInjuryStatus, type EspnInjuryEntry } from "@/lib/helpers/injuryOverrides";
import type { SleeperPlayer } from "@/lib/types";

const mk = (id: string, name: string, position: string, team: string, injury: string | null = null): SleeperPlayer =>
  ({ player_id: id, full_name: name, position, team, injury_status: injury } as SleeperPlayer);

const entry = (over: Partial<EspnInjuryEntry>): EspnInjuryEntry =>
  ({ name: "Some Runner", position: "RB", team: "ARI", status: "Out", date: null, ...over });

describe("mapEspnInjuryStatus", () => {
  it("maps ESPN's vocabulary onto Sleeper's", () => {
    expect(mapEspnInjuryStatus("Out")).toBe("Out");
    expect(mapEspnInjuryStatus("Injured Reserve")).toBe("IR");
    expect(mapEspnInjuryStatus("Doubtful")).toBe("Doubtful");
    expect(mapEspnInjuryStatus("Questionable")).toBe("Questionable");
  });
  it("treats Active as healthy (null, to clear a stale tag) and unknown statuses as no override", () => {
    expect(mapEspnInjuryStatus("Active")).toBeNull();
    expect(mapEspnInjuryStatus("Suspension")).toBeUndefined();
  });
});

describe("applyInjuryOverrides", () => {
  const players = {
    "1": mk("1", "Some Runner", "RB", "ARI"),
    "2": mk("2", "Stale Out Guy", "WR", "DAL", "Out"),
    "3": mk("3", "Other Person", "WR", "SF"),
  };

  it("applies a fresher Out status", () => {
    const out = applyInjuryOverrides(players, [entry({})]);
    expect(out["1"].injury_status).toBe("Out");
    expect(out["3"]).toBe(players["3"]); // untouched players keep their reference
  });

  it("does not mutate the original map", () => {
    applyInjuryOverrides(players, [entry({})]);
    expect(players["1"].injury_status).toBeNull();
  });

  it("clears a stale Sleeper Out when ESPN now lists the player Active", () => {
    const out = applyInjuryOverrides(players, [entry({ name: "Stale Out Guy", position: "WR", team: "DAL", status: "Active" })]);
    expect(out["2"].injury_status).toBeNull();
  });

  it("matches names loosely (punctuation, suffixes, case) using the same normalizer as projections", () => {
    const p = { "9": mk("9", "Marvin Harrison Jr.", "WR", "ARI") };
    const out = applyInjuryOverrides(p, [entry({ name: "marvin harrison jr", position: "WR", status: "Doubtful" })]);
    expect(out["9"].injury_status).toBe("Doubtful");
  });

  it("requires the position to agree, so a same-named player at another position isn't hit", () => {
    const out = applyInjuryOverrides(players, [entry({ position: "WR" })]);
    expect(out).toBe(players);
  });

  it("uses the team to break a same-name tie, and refuses to guess when still ambiguous", () => {
    const twins = {
      a: mk("a", "Common Name", "WR", "ARI"),
      b: mk("b", "Common Name", "WR", "DAL"),
    };
    const byTeam = applyInjuryOverrides(twins, [entry({ name: "Common Name", position: "WR", team: "DAL", status: "Out" })]);
    expect(byTeam.b.injury_status).toBe("Out");
    expect(byTeam.a.injury_status).toBeNull();

    const ambiguous = applyInjuryOverrides(twins, [entry({ name: "Common Name", position: "WR", team: "", status: "Out" })]);
    expect(ambiguous).toBe(twins);
  });

  it("accepts Sleeper's WAS for ESPN's WSH", () => {
    const p = { w: mk("w", "Wash Player", "TE", "WAS") };
    const out = applyInjuryOverrides(p, [entry({ name: "Wash Player", position: "TE", team: "WSH", status: "Out" })]);
    expect(out.w.injury_status).toBe("Out");
  });

  it("returns the same reference when there is nothing to change", () => {
    expect(applyInjuryOverrides(players, [])).toBe(players);
    expect(applyInjuryOverrides(players, [entry({ status: "Suspension" })])).toBe(players);
    expect(applyInjuryOverrides(players, [entry({ name: "Nobody Known" })])).toBe(players);
    const already = { "1": mk("1", "Some Runner", "RB", "ARI", "Out") };
    expect(applyInjuryOverrides(already, [entry({})])).toBe(already);
  });
});
