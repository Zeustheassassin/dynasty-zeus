import { describe, it, expect } from "vitest";
import {
  decodeEntities, fortyChanges, fortyPatches, matchFortyRows, parseCombineCsv, parseWalterFootballPage, sameSchool, schoolKey,
  PROJECTED_FROM, type FortyFillProspect, type FortyRow,
} from "@/lib/scouting/fortyFill";

// A WalterFootball panel, trimmed from the real RBRankings2027.php markup
// (2026-11-15): a scouting-report link or a plain name, "*" for an underclassman.
const panel = (slot: number, nameHtml: string, school: string, extra: string) => `
  <div class="panel" id="prpSlot_${slot}">
    <div class="panel-header-wrap"><div class="panel-heading">
      <span class="pick-number">${slot}.</span>
      <img decoding="async" src="https://walterfootball.com/college/x_logo.gif" alt="${school} image" />
      <b>
        ${nameHtml}, RB, ${school}                     <br>


${extra}
      </b> <br>
    </div></div>
    <div class="panel-body"><p><i> 11/4/26:</i> Notes about the player.</p></div>
  </div>`;

const WF_PAGE = `<html><body><div>nav</div>
  ${panel(1, `<a href="https://walterfootball.com/scoutingreports2027jbaugh.php" title="Jadan Baugh Scouting Report">Jadan Baugh*</a>`, "Florida",
    "Height: 6-0. Weight: 228.<br>Projected 40 Time: 4.50.<br>Projected Round (2027):     1-2.")}
  ${panel(2, "Caden Durham*", "LSU", "Height: 5-9. Weight: 205.<br>Projected 40 Time: 4.51.<br>Projected Round (2027):     7-FA.")}
  ${panel(3, "Ju&#8217;Juan Johnson", "Syracuse", "Height: 6-0. Weight: 215.<br>Projected Round (2027):     5-6.")}
  ${panel(4, `<a href="x">T.J. Smith</a>`, "Texas A&amp;M", "Height: 5-11. Weight: 201.<br>Projected 40 Time: 4.4.<br>")}
</body></html>`;

describe("parseWalterFootballPage", () => {
  it("reads each ranked player's name, school, projected 40 and listed weight", () => {
    expect(parseWalterFootballPage(WF_PAGE, "RB")).toEqual([
      { name: "Jadan Baugh", school: "Florida", position: "RB", forty: 4.5, weight: 228 },
      { name: "Caden Durham", school: "LSU", position: "RB", forty: 4.51, weight: 205 },
      // Ju'Juan Johnson has no projected 40: left out.
      { name: "T.J. Smith", school: "Texas A&M", position: "RB", forty: 4.4, weight: 201 },
    ]);
  });

  it("finds nothing on a page without ranking panels", () => {
    expect(parseWalterFootballPage("<html><body>Not found</body></html>", "WR")).toEqual([]);
  });
});

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("Trey&#39;Dez &amp; Ju&#x2019;Juan &quot;Q&quot;")).toBe("Trey'Dez & Ju’Juan \"Q\"");
    expect(decodeEntities("&bogus; stays")).toBe("&bogus; stays");
  });
});

const CSV = [
  "season,draft_year,draft_team,draft_round,draft_ovr,pfr_id,cfb_id,player_name,pos,school,ht,wt,forty,bench,vertical,broad_jump,cone,shuttle",
  "2026,,,,,AlleKa01,kaytron-allen-1,Kaytron Allen,RB,Penn St.,5-11,216,,,,,,",
  "2026,,,,,LoveJe00,jeremiyah-love-1,Jeremiyah Love,RB,Notre Dame,6-0,212,4.36,,,,,",
  "2026,,,,,X,y,\"Smith, Jr., Robert\",WR,\"Miami (FL)\",6-1,195,4.41,,,,,",
  "2026,,,,,Z,z,Big Guy,OT,Iowa,6-6,320,5.05,,,,,",
  "2025,,,,,W,w,Old Back,RB,Iowa,5-10,205,4.50,,,,,",
].join("\n");

describe("parseCombineCsv", () => {
  it("keeps the year's QB / RB / WR / TE who ran, with the weigh-in; quoted fields read whole", () => {
    const { rows, inYear } = parseCombineCsv(CSV, 2026);
    expect(inYear).toBe(4);
    expect(rows).toEqual([
      { name: "Jeremiyah Love", school: "Notre Dame", position: "RB", forty: 4.36, weight: 212 },
      { name: "Smith, Jr., Robert", school: "Miami (FL)", position: "WR", forty: 4.41, weight: 195 },
    ]);
  });

  it("says a year isn't in the file yet with inYear 0", () => {
    expect(parseCombineCsv(CSV, 2027)).toEqual({ rows: [], inYear: 0 });
  });

  it("throws when the columns it needs are gone", () => {
    expect(() => parseCombineCsv("a,b,c\n1,2,3", 2026)).toThrow(/missing/);
  });
});

describe("schoolKey / sameSchool", () => {
  it("matches the spellings the sources use", () => {
    expect(schoolKey("Penn St.")).toBe(schoolKey("Penn State"));
    expect(schoolKey("Ole Miss")).toBe(schoolKey("Mississippi"));
    expect(schoolKey("Miami (FL)")).toBe(schoolKey("Miami"));
    expect(schoolKey("Texas A&M")).toBe(schoolKey("Texas A & M"));
    expect(sameSchool("USC", "Southern California")).toBe(true);
  });

  it("keeps different schools apart, and agrees when one side doesn't say", () => {
    expect(sameSchool("Texas", "Texas State")).toBe(false);
    expect(sameSchool("Florida", "Florida State")).toBe(false);
    expect(sameSchool(null, "Iowa")).toBe(true);
  });
});

const row = (name: string, school: string | null, forty: number, weight: number | null = null, position: FortyRow["position"] = "RB"): FortyRow =>
  ({ name, school, position, forty, weight });
const prospect = (id: string, name: string, school: string, extra: Partial<FortyFillProspect> = {}): FortyFillProspect =>
  ({ id, name, school, position: "RB", draft_class_year: 2027, ...extra });

describe("matchFortyRows", () => {
  it("matches by name within the class and position, dropping suffixes and punctuation", () => {
    const m = matchFortyRows(
      [prospect("a", "LJ Martin", "BYU"), prospect("b", "Mark Fletcher", "Miami"), prospect("c", "Other Year", "X", { draft_class_year: 2028 })],
      [row("L.J. Martin", "BYU", 4.54), row("Mark Fletcher Jr.", "Miami", 4.51), row("Other Year", "X", 4.6)],
      2027,
    );
    expect(m.get("a")).toEqual({ row: row("L.J. Martin", "BYU", 4.54), schoolDiffers: false });
    expect(m.get("b")!.row.forty).toBe(4.51);
    expect(m.has("c")).toBe(false); // his class is 2028
  });

  it("breaks a shared name by school, and flags a lone match from another school", () => {
    const rows = [row("Malik Washington", "Virginia", 4.7), row("Malik Washington", "Northwestern", 4.6), row("Makhi Hughes", "Oregon", 4.5)];
    const m = matchFortyRows([prospect("a", "Malik Washington", "Northwestern"), prospect("b", "Makhi Hughes", "Tulane")], rows, 2027);
    expect(m.get("a")!.row.school).toBe("Northwestern");
    expect(m.get("b")).toEqual({ row: rows[2], schoolDiffers: true });
  });

  it("gives a row to nobody when two prospects claim it, and needs the same position", () => {
    const rows = [row("Sam Jones", "Iowa", 4.5)];
    expect(matchFortyRows([prospect("a", "Sam Jones", "Iowa"), prospect("b", "Sam Jones", "")], rows, 2027).size).toBe(0);
    expect(matchFortyRows([prospect("a", "Sam Jones", "Iowa", { position: "WR" })], rows, 2027).size).toBe(0);
  });
});

describe("fortyChanges / fortyPatches", () => {
  const combine = (p: FortyFillProspect, r: FortyRow, schoolDiffers = false) => new Map([[p.id, { row: r, schoolDiffers }]]);
  const none = new Map();

  it("fills a blank with the combine's time and weigh-in, ticked", () => {
    const p = prospect("a", "Jeremiyah Love", "Notre Dame", { draft_class_year: 2026 });
    const [c] = fortyChanges([p], combine(p, row("Jeremiyah Love", "Notre Dame", 4.36, 212)), none);
    expect(c).toMatchObject({ kind: "combine", from: "blank", time: 4.36, weight: 212, on: true });
    expect(fortyPatches([c]).get("a")).toEqual({ forty_time: 4.36, forty_source: "combine", forty_weight: 212 });
  });

  it("puts the combine over a pro day, ticked, but leaves a different combine time you typed unticked", () => {
    const pd = prospect("a", "A", "S", { forty_time: 4.45, forty_source: "pro_day" });
    expect(fortyChanges([pd], combine(pd, row("A", "S", 4.5, 200)), none)[0]).toMatchObject({ on: true, from: "4.45 pro day" });
    const typed = prospect("b", "B", "S", { forty_time: 4.48, forty_source: "combine" });
    const [c] = fortyChanges([typed], combine(typed, row("B", "S", 4.5, 200)), none);
    expect(c.on).toBe(false);
    expect(c.note).toMatch(/differs from the combine time you have/);
  });

  it("adds just the weigh-in when the time already matches, and nothing when both do", () => {
    const p = prospect("a", "A", "S", { forty_time: 4.5, forty_source: "combine" });
    expect(fortyChanges([p], combine(p, row("A", "S", 4.5, 205)), none)[0]).toMatchObject({ on: true, weight: 205 });
    const done = { ...p, forty_weight: 205 };
    expect(fortyChanges([done], combine(done, row("A", "S", 4.5, 205)), none)).toEqual([]);
  });

  it("leaves a match from another school unticked, with why", () => {
    const p = prospect("a", "Makhi Hughes", "Tulane");
    const [c] = fortyChanges([p], none, combine(p, row("Makhi Hughes", "Oregon", 4.5), true));
    expect(c).toMatchObject({ kind: "projected", on: false, note: "WalterFootball lists him at Oregon" });
  });

  it("projects only where there's no real 40, and only when it's new or moved", () => {
    const blank = prospect("a", "A", "S");
    const real = prospect("b", "B", "S", { forty_time: 4.6, forty_source: "pro_day" });
    const same = prospect("c", "C", "S", { forty_projected: 4.5, forty_projected_from: PROJECTED_FROM });
    const moved = prospect("d", "D", "S", { forty_projected: 4.55, forty_projected_from: PROJECTED_FROM });
    const proj = new Map([blank, real, same, moved].map((p) => [p.id, { row: row(p.name, "S", 4.5), schoolDiffers: false }]));
    const out = fortyChanges([blank, real, same, moved], none, proj);
    expect(out.map((c) => [c.prospectId, c.from])).toEqual([["a", "blank"], ["d", "~4.55 projected"]]);
    expect(fortyPatches(out).get("d")).toEqual({ forty_projected: 4.5, forty_projected_from: "WalterFootball" });
  });

  it("skips the projection when the combine time is coming in the same run", () => {
    const p = prospect("a", "A", "S", { draft_class_year: 2026 });
    const out = fortyChanges([p], combine(p, row("A", "S", 4.4, 200)), combine(p, row("A", "S", 4.5)));
    expect(out.map((c) => c.kind)).toEqual(["combine"]);
  });
});
