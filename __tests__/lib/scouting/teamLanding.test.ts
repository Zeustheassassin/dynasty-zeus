import { describe, it, expect } from "vitest";
import type { NflRoomsResponse, NflTeamRoom, RoomPlayer } from "@/lib/nflRooms";
import {
  ONE_STARTER, OFFENSE_VALUE, PATH_VALUE, PECKING_VALUE, PROE_EDGE, QB_CAP, ROLE_PASS_SHARE,
  ageOnSept1, isEstablished, passShare, patchedLandingInputs, peckingValue, qbValue, resolveTeamLanding, roomStarters, savedEntries,
  suggestedOffense, suggestedPath, suggestedVetsAhead, teamLandingLines, teamLandingTotal, teamSnapshotFor, vetsAheadLabel,
  type SnapPlayer, type TeamSnapshot,
} from "@/lib/scouting/teamLanding";

const bar = { regular: 60, star: 75 };
const vet = (name: string, grade: number | null, share: number | null, birthDate: string | null = "1998-06-01", depth = 1): SnapPlayer => ({
  name, depth, grade, share, birthDate,
});
const snap = (extra: Partial<TeamSnapshot> = {}): TeamSnapshot => ({
  asOf: "2027-05-01T00:00:00.000Z", season: 2026, team: "Philadelphia Eagles", teamId: 21,
  room: [], qb: { name: "Starter", grade: 82, rookie: false }, bar, passOe: 0.045, passPct: 0.62, targetShare: 0.55, ...extra,
});

describe("isEstablished", () => {
  it("counts a regular above the bottom quarter, or a star on a short season", () => {
    expect(isEstablished({ grade: 60, share: 0.4 }, bar)).toBe(true);
    expect(isEstablished({ grade: 59.9, share: 0.9 }, bar)).toBe(false);
    expect(isEstablished({ grade: 70, share: 0.39 }, bar)).toBe(false);
    expect(isEstablished({ grade: 75, share: 0.15 }, bar)).toBe(true);
    expect(isEstablished({ grade: 75, share: 0.14 }, bar)).toBe(false);
    expect(isEstablished({ grade: null, share: 0.9 }, bar)).toBe(false);
    expect(isEstablished({ grade: 90, share: 0.9 }, null)).toBe(false);
  });
});

describe("the values", () => {
  it("reads the vets-ahead table, capping at its last option", () => {
    expect(peckingValue("WR", 0)).toBe(0.2);
    expect(peckingValue("WR", 2)).toBe(0);
    expect(peckingValue("WR", 9)).toBe(PECKING_VALUE.WR[4]);
    expect(peckingValue("QB", 1)).toBe(-0.1);
    expect(vetsAheadLabel("TE", 3)).toBe("3+");
    expect(vetsAheadLabel("TE", 2)).toBe("2");
    expect(vetsAheadLabel("RB", 5)).toBe("2+");
  });

  it("values a QB grade around a typical starter's, capped, half for an RB, nothing for a QB", () => {
    expect(qbValue("WR", 90)).toBeCloseTo(0.18, 12);
    expect(qbValue("TE", 60)).toBeCloseTo(-0.12, 12);
    expect(qbValue("WR", 100)).toBe(QB_CAP);
    expect(qbValue("WR", 30)).toBe(-QB_CAP);
    expect(qbValue("RB", 90)).toBeCloseTo(0.09, 12);
    expect(qbValue("QB", 90)).toBe(0);
  });
});

describe("suggestions", () => {
  it("counts the established veterans in his room", () => {
    const s = snap({ room: [vet("Star", 90, 0.88), vet("Hurt Star", 80, 0.2), vet("Fringe", 55, 0.6), vet("Spot", 70, 0.1)] });
    expect(suggestedVetsAhead(s, "WR").map((v) => v.name)).toEqual(["Star", "Hurt Star"]);
  });

  it("counts a QB's or RB's starter on a regular's snaps whatever his grade", () => {
    const weak = vet("Weak Starter", 41.7, 0.88, "1998-03-10", 1);
    const backup = vet("Backup", 50, 0.5, "1999-01-01", 2);
    const s = snap({ room: [weak, backup] });
    expect(roomStarters(s.room, "QB").map((v) => v.name)).toEqual(["Weak Starter"]);
    expect(suggestedVetsAhead(s, "QB").map((v) => v.name)).toEqual(["Weak Starter"]);
    expect(suggestedVetsAhead(s, "RB").map((v) => v.name)).toEqual(["Weak Starter"]);
    // More than one starting spot: a WR or TE is expected to pass a regular under the bar.
    expect(suggestedVetsAhead(s, "WR")).toEqual([]);
    expect(suggestedVetsAhead(s, "TE")).toEqual([]);
    expect(ONE_STARTER).toEqual({ QB: true, RB: true, WR: false, TE: false });
    // A first-on-the-chart fill-in short of a regular's share isn't the starter.
    expect(suggestedVetsAhead(snap({ room: [vet("Fill-in", 61, 0.31, null, 1), backup] }), "QB")).toEqual([]);
    expect(roomStarters([], "QB")).toEqual([]);
  });

  it("reads pass-heavy and run-heavy off pass rate over expectation", () => {
    expect(suggestedOffense(PROE_EDGE)).toBe("pass");
    expect(suggestedOffense(0.029)).toBe("balanced");
    expect(suggestedOffense(-PROE_EDGE)).toBe("run");
    expect(suggestedOffense(null)).toBeNull();
  });

  it("ages on Sept 1", () => {
    expect(ageOnSept1("1998-09-01", 2028)).toBeCloseTo(30, 2);
    expect(Math.floor(ageOnSept1("1998-09-02", 2028)!)).toBe(29);
    expect(ageOnSept1(null, 2028)).toBeNull();
    expect(ageOnSept1("junk", 2028)).toBeNull();
  });

  it("opens the path when a veteran ahead is past his prime by year 2", () => {
    const old = vet("Old", 80, 0.8, "1998-01-01"); // 30 in Sept 2028: a WR's prime ends at 30
    const young = vet("Young", 80, 0.8, "2001-01-01");
    expect(suggestedPath("WR", 2027, snap(), [young, old])).toEqual({ call: "opens", why: "Old is 30 in 2028" });
    expect(suggestedPath("WR", 2027, snap(), [young])).toEqual({ call: "same", why: null });
    expect(suggestedPath("TE", 2027, snap(), [old])).toEqual({ call: "same", why: null }); // a TE's ends at 31
    expect(suggestedPath("WR", 2027, snap(), [])).toEqual({ call: "same", why: null });
  });

  it("opens a QB's path behind a bridge (under the median regular)", () => {
    const s = snap({ bar: { regular: 60, star: 80 } });
    expect(suggestedPath("QB", 2027, s, [vet("Bridge", 65, 0.9, "2000-01-01")])).toEqual({ call: "opens", why: "Bridge 65.0: graded like a bridge (under 70.0)" });
    expect(suggestedPath("QB", 2027, s, [vet("Starter", 75, 0.9, "2000-01-01")]).call).toBe("same");
  });

  it("opens an RB's path behind a weak starter (under the bar)", () => {
    const weak = vet("Weak", 59.9, 0.7, "2003-01-01");
    expect(suggestedPath("RB", 2027, snap(), [weak])).toEqual({ call: "opens", why: "Weak 59.9: a weak starter (under 60.0)" });
    expect(suggestedPath("RB", 2027, snap(), [vet("Solid", 60, 0.7, "2003-01-01")]).call).toBe("same");
    expect(suggestedPath("RB", 2027, snap(), [weak, vet("Solid", 70, 0.5, "2003-01-01")]).call).toBe("same");
    // At WR a weak regular isn't counted ahead in the first place.
    expect(suggestedPath("WR", 2027, snap(), [weak]).call).toBe("same");
  });
});

describe("teamSnapshotFor", () => {
  const p = (name: string, pos: RoomPlayer["pos"], depth: number, extra: Partial<RoomPlayer> = {}): RoomPlayer => ({
    pffId: depth, name, pos, depth, rookie: false, grade: 70, passGrade: null, share: 0.5, birthDate: null, ...extra,
  });
  const room: NflTeamRoom = {
    teamId: 21, name: "Philadelphia Eagles", passOe: 0.01, passPct: 0.6, targetShare: { RB: 0.2, WR: 0.6, TE: 0.2 },
    players: [p("Backup QB", "QB", 2, { passGrade: 60 }), p("Rookie QB", "QB", 1, { rookie: true }), p("Wide", "WR", 1), p("Rookie Wide", "WR", 2, { rookie: true }), p("Tight", "TE", 1)],
  };
  const rooms: Pick<NflRoomsResponse, "asOf" | "season" | "bars"> = {
    asOf: "2027-05-01T00:00:00.000Z", season: 2026, bars: { QB: null, RB: null, WR: bar, TE: null },
  };

  it("keeps his position's veterans, the first QB (a rookie too) and his target share", () => {
    const s = teamSnapshotFor(rooms, room, "WR");
    expect(s.room.map((v) => v.name)).toEqual(["Wide"]);
    expect(s.qb).toEqual({ name: "Rookie QB", grade: null, rookie: true });
    expect(s).toMatchObject({ team: "Philadelphia Eagles", teamId: 21, season: 2026, bar, passOe: 0.01, targetShare: 0.6 });
    expect(teamSnapshotFor(rooms, room, "QB")).toMatchObject({ targetShare: null, bar: null });
    expect(teamSnapshotFor(rooms, room, "QB").room.map((v) => v.name)).toEqual(["Backup QB"]);
  });
});

describe("resolveTeamLanding", () => {
  const room = [vet("Star", 90, 0.88, "2000-01-01"), vet("Two", 70, 0.6, "1997-01-01")];
  const wr = (landing_inputs: unknown, draft_team = "Eagles") =>
    resolveTeamLanding({ position: "WR", draft_class_year: 2027, draft_team, landing_inputs: landing_inputs as never });

  it("suggests every input from the saved room", () => {
    const t = wr({ pff: snap({ room }) })!;
    expect(t.vetsAhead).toMatchObject({ n: 2, source: "pff" });
    expect(t.path).toEqual({ call: "opens", why: "Two is 31 in 2028", source: "pff" });
    expect(t.qb).toEqual({ grade: 82, source: "pff", name: "Starter" });
    expect(t.offense).toEqual({ lean: "pass", source: "pff", passOe: 0.045 });
    expect(t.values.pecking).toBe(PECKING_VALUE.WR[2]);
    expect(t.values.path).toBe(PATH_VALUE.opens);
    expect(t.values.qb).toBeCloseTo(0.1, 12);
    expect(t.values.offense).toBe(OFFENSE_VALUE.WR.pass);
  });

  it("lets every entry of the user's win", () => {
    const t = wr({ pff: snap({ room }), vetsAhead: 0, qbGrade: 60, offense: "run", path: "closes" })!;
    expect(t.vetsAhead).toMatchObject({ n: 0, source: "yours" });
    expect(t.qb).toEqual({ grade: 60, source: "yours", name: "Starter" });
    expect(t.offense).toMatchObject({ lean: "run", source: "yours" });
    expect(t.path).toEqual({ call: "closes", source: "yours", why: null });
    expect(t.values).toEqual({ pecking: 0.2, path: -0.1, qb: expect.closeTo(-0.12, 12), offense: -0.1 });
  });

  it("counts nothing without a room or an entry, and ignores a room saved for another team", () => {
    const none = wr(null)!;
    expect(none).toMatchObject({ snapshot: null, stale: false, vetsAhead: null, qb: null, offense: null, path: null });
    expect(none.values).toEqual({ pecking: 0, path: 0, qb: 0, offense: 0 });
    const moved = wr({ pff: snap({ room }), offense: "pass" }, "Chiefs")!;
    expect(moved).toMatchObject({ snapshot: null, stale: true, vetsAhead: null, qb: null, path: null });
    expect(moved.offense).toMatchObject({ lean: "pass", source: "yours", passOe: null });
  });

  it("leaves the QB out for a QB, and for a rookie or ungraded starter", () => {
    const qb = resolveTeamLanding({ position: "QB", draft_class_year: 2027, draft_team: "Eagles", landing_inputs: { pff: snap(), qbGrade: 90 } })!;
    expect(qb.qb).toBeNull();
    expect(qb.values.qb).toBe(0);
    expect(wr({ pff: snap({ qb: { name: "Kid", grade: null, rookie: true } }) })!.qb).toBeNull();
    expect(wr({ pff: snap({ qb: { name: "Kid", grade: 70, rookie: true } }) })!.qb).toBeNull();
    expect(wr({ pff: snap({ qb: null }) })!.qb).toBeNull();
  });

  it("is null off the four positions", () => {
    expect(resolveTeamLanding({ position: "OT", draft_class_year: 2027, draft_team: "Eagles" })).toBeNull();
  });

  it("halves a Blocking TE's QB and offense values, and only his", () => {
    const te = (role: "blocking" | "move" | null) =>
      resolveTeamLanding({ position: "TE", draft_class_year: 2027, draft_team: "Eagles", landing_inputs: { pff: snap({ room }) } }, role)!;
    const full = te(null);
    expect(full).toMatchObject({ role: null, passShare: 1 });
    expect(full.values.qb).toBeCloseTo(0.1, 12);
    expect(full.values.offense).toBe(OFFENSE_VALUE.TE.pass);
    expect(te("move").values).toEqual(full.values);
    const blocking = te("blocking");
    expect(blocking).toMatchObject({ role: "blocking", passShare: ROLE_PASS_SHARE.blocking });
    expect(blocking.values).toEqual({ ...full.values, qb: expect.closeTo(0.05, 12), offense: OFFENSE_VALUE.TE.pass / 2 });
    expect(passShare("blocking")).toBe(0.5);
    expect(passShare(undefined)).toBe(1);
    const lines = teamLandingLines(blocking, { landing: 1, offense: 1 });
    expect(lines[2]).toBe("QB: Starter 82.0 passing grade, suggested (half for a Blocking TE) → +0.05");
    expect(lines[3]).toBe("Offense: pass-heavy, suggested (pass rate over expectation +4.5% in 2026) (half for a Blocking TE) → +0.05");
  });
});

describe("saved values", () => {
  it("reads only well-formed entries", () => {
    expect(savedEntries({ vetsAhead: 2, qbGrade: 81.5, offense: "pass", path: "opens" })).toEqual({ vetsAhead: 2, qbGrade: 81.5, offense: "pass", path: "opens" });
    expect(savedEntries({ vetsAhead: 1.5, qbGrade: 101, offense: "air" as never, path: "maybe" as never }))
      .toEqual({ vetsAhead: null, qbGrade: null, offense: null, path: null });
    expect(savedEntries(null)).toEqual({ vetsAhead: null, qbGrade: null, offense: null, path: null });
  });

  it("patches drop cleared entries, and nothing left is null", () => {
    expect(patchedLandingInputs(null, { vetsAhead: 1 })).toEqual({ vetsAhead: 1 });
    expect(patchedLandingInputs({ vetsAhead: 1, offense: "run" }, { vetsAhead: null })).toEqual({ offense: "run" });
    expect(patchedLandingInputs({ vetsAhead: 1 }, { vetsAhead: null })).toBeNull();
    const s = snap();
    expect(patchedLandingInputs({ path: "opens" }, { pff: s })).toEqual({ path: "opens", pff: s });
  });
});

describe("words and totals", () => {
  it("weights vets ahead and path by Landing, QB and offense by Offense", () => {
    const t = resolveTeamLanding({ position: "WR", draft_class_year: 2027, draft_team: "Eagles", landing_inputs: { pff: snap({ room: [vet("Star", 90, 0.88, "2000-01-01")] }) } })!;
    // vets 1 → +0.10, path same, QB 82 → +0.10, pass → +0.10
    expect(teamLandingTotal(t, { landing: 2, offense: 0.5 })).toBeCloseTo(2 * 0.1 + 0.5 * (0.1 + 0.1), 12);
    expect(teamLandingTotal(null, { landing: 1, offense: 1 })).toBe(0);
    expect(teamLandingLines(t, { landing: 1, offense: 1 })).toEqual([
      "Vets ahead: 1, suggested (Star 90.0 (88%)) → +0.10",
      "Path by year 2: same, suggested → +0.00",
      "QB: Starter 82.0 passing grade, suggested → +0.10",
      "Offense: pass-heavy, suggested (pass rate over expectation +4.5% in 2026) → +0.10",
    ]);
  });

  it("says what's missing", () => {
    const none = resolveTeamLanding({ position: "RB", draft_class_year: 2027, draft_team: "Eagles", landing_inputs: null })!;
    expect(teamLandingLines(none, { landing: 1, offense: 1 })).toEqual([
      "Vets ahead: not set (save the rooms on the Post-Draft tab, or enter it) → +0.00",
      "Path by year 2: not set (save the rooms on the Post-Draft tab, or enter it) → +0.00",
      "QB: not set (save the rooms on the Post-Draft tab, or enter it) → +0.00",
      "Offense: not set (save the rooms on the Post-Draft tab, or enter it) → +0.00",
    ]);
    const rookieQb = resolveTeamLanding({ position: "TE", draft_class_year: 2027, draft_team: "Eagles", landing_inputs: { pff: snap({ qb: { name: "Kid", grade: null, rookie: true } }) } })!;
    expect(teamLandingLines(rookieQb, { landing: 1, offense: 1 })[2]).toBe("QB: Kid is a rookie: enter a guess → +0.00");
    const qb = resolveTeamLanding({ position: "QB", draft_class_year: 2027, draft_team: "Eagles", landing_inputs: { pff: snap() } })!;
    expect(teamLandingLines(qb, { landing: 1, offense: 1 })).toHaveLength(3);
  });
});
