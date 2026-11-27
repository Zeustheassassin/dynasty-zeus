import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyConsensusSave,
  classConsensusAt,
  classFromFileName,
  consensusRankOf,
  consensusSaveRanks,
  consensusStatus,
  latestConsensusAt,
  notOnConsensusTitle,
  parseConsensusCsv,
  projectedCapitalLabel,
  reviewConsensus,
  skillPosition,
  type ConsensusProspect,
  type ConsensusRow,
} from "../../../lib/scouting/consensusBoard";

// Stage 6 of the 2026-11-26 scouting plan: the consensus big board CSV, matched
// to the class by the 11/5 dedupe rules; each rank a projected pick for Dynasty+.

const row = (rank: number, name: string, position: string, school: string | null = null): ConsensusRow => ({ rank, name, position, school });
let n = 0;
const pr = (name: string, position: string, school: string | null, extra: Partial<ConsensusProspect> = {}): ConsensusProspect =>
  ({ id: `p${++n}`, name, position, school, draft_class_year: 2027, ...extra });

describe("parseConsensusCsv", () => {
  it("reads the Nov 5 / Nov 27 file's columns", () => {
    const csv = "﻿Rank,Player Name,Position,College\r\n1,Jeremiah Smith,WR,Ohio State\r\n14,Ellis Robinson IV,CB,Georgia\r\n223,J’Mond Tapp,EDGE,Memphis\r\n";
    const { rows, skipped } = parseConsensusCsv(csv);
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      row(1, "Jeremiah Smith", "WR", "Ohio State"),
      row(14, "Ellis Robinson IV", "CB", "Georgia"),
      row(223, "J’Mond Tapp", "EDGE", "Memphis"),
    ]);
  });

  it("takes the columns in any order, quoted fields, and skips lines without a rank or a name", () => {
    const csv = 'School,Pos,Name,Rank\n"Miami (FL)",qb,"Mensah, Darian",10\nTexas,WR,,11\nTexas,WR,Ryan Wingo,x\n';
    const { rows, skipped } = parseConsensusCsv(csv);
    expect(rows).toEqual([row(10, "Mensah, Darian", "QB", "Miami (FL)")]);
    expect(skipped).toBe(2);
  });

  it("refuses a file without rank / name / position columns", () => {
    expect(() => parseConsensusCsv("Player,College\nA,B\n")).toThrow(/Rank, Player Name, Position/);
  });
});

describe("small readers", () => {
  it("skill positions map to the board's", () => {
    expect(["QB", "RB", "HB", "FB", "WR", "TE", "EDGE", "ath"].map(skillPosition)).toEqual(["QB", "RB", "RB", "RB", "WR", "TE", null, null]);
  });

  it("the class from a file name, when it's on the board", () => {
    expect(classFromFileName("consensus-big-board-2027-20261127.csv", [2026, 2027, 2028])).toBe(2027);
    expect(classFromFileName("consensus-big-board-2027-20261127.csv", [2028])).toBeNull();
    expect(classFromFileName("board.csv", [2027])).toBeNull();
  });
});

describe("reviewConsensus", () => {
  it("matches by name at his position (suffixes, periods, curly apostrophes), ticked", () => {
    const a = pr("CJ Baxter", "RB", "Kentucky");
    const b = pr("Jmond Tapp", "WR", "Memphis");
    const c = pr("Kevin Concepcion", "WR", "Texas A&M");
    const r = reviewConsensus([row(347, "C.J. Baxter", "RB", "Kentucky"), row(223, "J’Mond Tapp Jr.", "WR", "Memphis"), row(5, "Nobody", "QB")], [a, b, c], 2027);
    expect(r.matches.map((m) => [m.name, m.row.rank, m.how, m.on])).toEqual([
      ["Jmond Tapp", 223, "name", true],
      ["CJ Baxter", 347, "name", true],
    ]);
    expect(r.missing.map((m) => m.name)).toEqual(["Kevin Concepcion"]);
    expect(r.unmatched).toEqual([row(5, "Nobody", "QB")]);
    expect([r.rows, r.skillRows]).toEqual([3, 3]);
  });

  it("school spellings the user's board uses (Ole Miss, Miami) agree; a different school comes in unticked", () => {
    const a = pr("Kewan Lacy", "RB", "Ole Miss");
    const b = pr("Darian Mensah", "QB", "Miami");
    const c = pr("Jake Garcia", "QB", "Furman");
    const r = reviewConsensus([row(61, "Kewan Lacy", "RB", "Mississippi"), row(10, "Darian Mensah", "QB", "Miami (FL)"), row(1111, "Jake Garcia", "QB", "Michigan")], [a, b, c], 2027);
    const by = new Map(r.matches.map((m) => [m.name, m]));
    expect(by.get("Kewan Lacy")!.on).toBe(true);
    expect(by.get("Darian Mensah")!.on).toBe(true);
    expect(by.get("Jake Garcia")).toMatchObject({ how: "school_differs", on: false, note: "the list has him at Michigan" });
  });

  it("the same position guards a shared name (Jordan Washington TE vs RB)", () => {
    const te = pr("Jordan Washington", "TE", "North Carolina");
    const r = reviewConsensus([row(701, "Jordan Washington", "RB", "Washington")], [te], 2027);
    expect(r.matches).toEqual([]);
    expect(r.unmatched.map((u) => u.rank)).toEqual([701]);
  });

  it("another skill position with the same name and school, unticked", () => {
    const p = pr("Eli Heidenreich", "WR", "Navy");
    const r = reviewConsensus([row(300, "Eli Heidenreich", "RB", "Navy")], [p], 2027);
    expect(r.matches[0]).toMatchObject({ how: "other_position", on: false, note: "the list has him at RB" });
  });

  it("a nickname: same last name, position and school, unticked", () => {
    const p = pr("Boobie Feaster", "RB", "Clemson");
    const r = reviewConsensus([row(400, "Ethan Feaster", "RB", "Clemson"), row(401, "Ethan Feaster", "RB", "Auburn")], [p], 2027);
    expect(r.matches[0]).toMatchObject({ how: "name_differs", on: false, note: "the list says Ethan Feaster", row: { rank: 400 } });
    // Without the school, a shared last name is nobody's.
    const q = pr("Boobie Feaster", "RB", null);
    expect(reviewConsensus([row(400, "Ethan Feaster", "RB", "Clemson")], [q], 2027).matches).toEqual([]);
  });

  it("two rows of his name with neither school his, or a row two prospects share: left unsettled", () => {
    const a = pr("Chris Johnson", "RB", "Clemson");
    const r = reviewConsensus([row(448, "Chris Johnson", "RB", "Toledo"), row(900, "Chris Johnson", "RB", "Ohio")], [a], 2027);
    expect(r.matches).toEqual([]);
    expect(r.unsettled.map((u) => u.name)).toEqual(["Chris Johnson"]);
    expect(r.unmatched).toEqual([]);
    const b = pr("Kam Davis", "RB", null);
    const c = pr("Kam Davis", "RB", null);
    const r2 = reviewConsensus([row(541, "Kam Davis", "RB", "Liberty")], [b, c], 2027);
    expect(r2.matches).toEqual([]);
    expect(r2.unsettled).toHaveLength(2);
  });

  it("someone in another class is listed, not matched; only the class's skill players count", () => {
    const later = pr("Gio Lopez", "QB", "Wake Forest", { draft_class_year: 2028 });
    const r = reviewConsensus([row(279, "Gio Lopez", "QB", "Wake Forest"), row(3, "Colin Simmons", "EDGE", "Texas")], [later], 2027);
    expect(r.matches).toEqual([]);
    expect(r.otherClass).toEqual([{ row: row(279, "Gio Lopez", "QB", "Wake Forest"), prospectId: later.id, name: "Gio Lopez", classYear: 2028 }]);
    expect(r.unmatched).toEqual([]);
    expect(r.skillRows).toBe(1);
    expect(r.missing).toEqual([]);
  });

  it("knows each player's rank on the last upload, and whose round is set", () => {
    const a = pr("Ryan Wingo", "WR", "Texas", { consensus_rank: 75, consensus_class: 2027, consensus_at: "2026-11-05T12:00:00Z", draft_round: 2 });
    const b = pr("Nick Marsh", "WR", "Indiana", { consensus_rank: 20, consensus_class: 2026, consensus_at: "2026-11-05T12:00:00Z" });
    const r = reviewConsensus([row(70, "Ryan Wingo", "WR", "Texas"), row(17, "Nick Marsh", "WR", "Indiana")], [a, b], 2027);
    const by = new Map(r.matches.map((m) => [m.name, m]));
    expect([by.get("Ryan Wingo")!.was, by.get("Ryan Wingo")!.drafted]).toEqual([75, true]);
    expect(by.get("Nick Marsh")!.was).toBeNull(); // that rank was for another class
  });
});

describe("saving", () => {
  it("sends the ticked matches' ranks and leaves the rest of the class unranked", () => {
    const a = pr("Cam Coleman", "WR", "Texas");
    const b = pr("Jake Garcia", "QB", "Furman");
    const c = pr("Not Listed", "TE", "Iowa");
    const k = pr("A Kicker", "K", "Iowa", { consensus_rank: 5, consensus_class: 2027, consensus_at: "x" });
    const other = pr("Gio Lopez", "QB", "Wake Forest", { draft_class_year: 2028 });
    const r = reviewConsensus([row(19, "Cam Coleman", "WR", "Texas"), row(1111, "Jake Garcia", "QB", "Michigan")], [a, b, c, k, other], 2027);
    const ranks = consensusSaveRanks(r, new Set([a.id]));
    expect([...ranks]).toEqual([[a.id, 19]]);
    const after = applyConsensusSave([a, b, c, k, other], 2027, ranks, "2026-11-27T18:00:00Z");
    expect(after.map((p) => [p.name, p.consensus_rank ?? null, p.consensus_class ?? null])).toEqual([
      ["Cam Coleman", 19, 2027], ["Jake Garcia", null, 2027], ["Not Listed", null, 2027], ["A Kicker", 5, 2027], ["Gio Lopez", null, null],
    ]);
  });
});

describe("on the board", () => {
  const at1 = "2026-11-05T12:00:00Z";
  const at2 = "2026-11-27T18:00:00Z";
  const ranked = pr("A", "WR", null, { consensus_rank: 40, consensus_class: 2027, consensus_at: at2 });
  const off = pr("B", "WR", null, { consensus_rank: null, consensus_class: 2027, consensus_at: at2 });
  const added = pr("C", "WR", null);
  const stale = pr("D", "WR", null, { consensus_rank: null, consensus_class: 2027, consensus_at: at1 });
  const moved = pr("E", "WR", null, { draft_class_year: 2028, consensus_rank: 300, consensus_class: 2027, consensus_at: at2 });
  const all = [ranked, off, added, stale, moved];

  it("reads a rank only while it's for his class", () => {
    expect(consensusRankOf(ranked)).toBe(40);
    expect(consensusRankOf(moved)).toBeNull();
    expect(consensusRankOf(off)).toBeNull();
  });

  it("each class's last upload, and the newest of all", () => {
    expect([...classConsensusAt(all)]).toEqual([[2027, at2]]);
    expect(latestConsensusAt(all)).toBe(at2);
    expect(latestConsensusAt([added])).toBeNull();
  });

  it("ranked / not on it / not checked / no upload", () => {
    const at = classConsensusAt(all);
    expect(consensusStatus(ranked, at)).toEqual({ kind: "ranked", rank: 40, at: at2 });
    expect(consensusStatus(off, at)).toEqual({ kind: "off", at: at2 });
    expect(consensusStatus(added, at)).toEqual({ kind: "unchecked", at: at2 });
    expect(consensusStatus(stale, at)).toEqual({ kind: "unchecked", at: at2 });
    expect(consensusStatus(moved, at)).toBeNull(); // 2028 has no upload
    expect(notOnConsensusTitle({ kind: "off", at: at2 }, 2027)).toMatch(/^Not on the consensus big board of Nov 2\d, 2026/);
    expect(notOnConsensusTitle({ kind: "unchecked", at: at2 }, 2027)).toMatch(/joined the 2027 class after the upload/);
  });

  it("the projected capital's label", () => {
    expect(projectedCapitalLabel(40, "WR", null)).toBe("consensus #40, picks 30–50 averaged");
    expect(projectedCapitalLabel(1, "QB", null)).toBe("consensus #1, pick 1, on the QB scale");
    expect(projectedCapitalLabel(220, "RB", null)).toBe("consensus #220, picks 165–275 averaged, 258–275 as undrafted, on the RB scale");
    expect(projectedCapitalLabel(400, "TE", null)).toBe("consensus #400, picks 300–500 averaged, all past the last pick (undrafted)");
    expect(projectedCapitalLabel(40, "WR", "2026-11-27T18:00:00Z")).toMatch(/^consensus #40 \(Nov 27, 2026\), picks 30–50 averaged$/);
  });
});

// Migration 109: three nullable columns and one all-or-nothing save, additive.
describe("migration 109 (consensus rank)", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/109_prospect_consensus_rank.sql"), "utf8");
  const body = sql.replace(/--[^\n]*/g, "");

  it("adds the columns and their CHECKs", () => {
    for (const c of ["consensus_rank integer", "consensus_class integer", "consensus_at timestamptz"]) {
      expect(body).toContain(`ADD COLUMN IF NOT EXISTS ${c};`);
    }
    expect(body).toMatch(/consensus_rank IS NULL OR consensus_rank BETWEEN 1 AND 5000/);
    expect(body).toMatch(/\(consensus_class IS NULL\) = \(consensus_at IS NULL\)/);
  });

  it("saves one class's skill prospects as the client does (applyConsensusSave), as the invoker", () => {
    const fn = body.match(/CREATE OR REPLACE FUNCTION public\.save_prospect_consensus\(p_class integer, p_ranks jsonb\)([\s\S]*?)\$fn\$;/)![1];
    expect(fn).toMatch(/SECURITY INVOKER/);
    expect(fn).toMatch(/SET search_path = ''/);
    expect(fn).toMatch(/WHERE p\.user_id = v_user AND p\.draft_class_year = p_class\s+AND p\.position IN \('QB', 'RB', 'WR', 'TE'\);/);
    expect(fn).toMatch(/ELSE NULL END,\s+consensus_class = p_class,\s+consensus_at {4}= now\(\)/);
    expect(fn).toMatch(/IF v_found <> v_keys THEN/);
    expect(fn).not.toMatch(/updated_at/);
    expect(body).toMatch(/REVOKE EXECUTE ON FUNCTION public\.save_prospect_consensus\(integer, jsonb\) FROM PUBLIC, anon;/);
    expect(body).toMatch(/GRANT EXECUTE ON FUNCTION public\.save_prospect_consensus\(integer, jsonb\) TO authenticated, service_role;/);
  });

  it("is additive", () => {
    expect(body).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
    expect(body).toMatch(/'109_prospect_consensus_rank'/);
  });
});
