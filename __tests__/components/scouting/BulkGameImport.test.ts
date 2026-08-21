import { describe, it, expect } from "vitest";
import { parseInput } from "@/components/scouting/BulkGameImport";

// Regression coverage for the "silent SAE corruption" bug: the play-by-play
// bulk importer used to have no Coverage/Open columns at all, so every
// imported route saved was_open=false/coverage='' — which, once has_charted_
// open_data flips true from a real targeted+success play, gets counted as
// real "not open, no coverage" signal rather than being excluded. Coverage
// and Open are now columns 4 and 5 (0-indexed 3 and 4).

describe("BulkGameImport parseInput — Coverage/Open columns", () => {
  it("captures coverage and was_open when present", () => {
    // Route | Alignment | On Line | Coverage | Open | Targeted | Success | Yards | Notes
    const [play] = parseInput("curl\tR\tY\tM\tY\tY\tY\t12");
    expect(play.coverage).toBe("man");
    expect(play.was_open).toBe(true);
    expect(play.targeted).toBe(true);
    expect(play.success).toBe(true);
    expect(play.yards).toBe(12);
    expect(play.valid).toBe(true);
  });

  it("supports all four coverage shorthand codes", () => {
    const rows = parseInput(
      ["dig\tS\tY\tM\tN\tN", "post\tL\tY\tZ\tN\tN", "out\tR\tY\tP\tN\tN", "corner\tR\tY\tD\tN\tN"].join("\n")
    );
    expect(rows.map((r) => r.coverage)).toEqual(["man", "zone", "press", "double"]);
  });

  it("defaults to not-open/no-coverage (not an error) when the columns are left blank — still visible to the caller for the preview UI", () => {
    const [play] = parseInput("curl\tR\tY\t\t\tY\tY\t12");
    expect(play.coverage).toBe("");
    expect(play.was_open).toBe(false);
    expect(play.valid).toBe(true); // blank Open/Coverage doesn't invalidate the row
  });

  it("does not misparse Coverage/Open as the old Targeted/Success columns (the exact regression)", () => {
    // Under the OLD 7-column format this row would have parsed as
    // targeted=true (old col 3), success=true (old col 4). Under the new
    // 9-column format, columns 3/4 are Coverage/Open, so targeted must be
    // read from column 5 (here: blank -> false).
    const [play] = parseInput("curl\tR\tY\tM\tY\t\t\t12");
    expect(play.coverage).toBe("man");
    expect(play.was_open).toBe(true);
    expect(play.targeted).toBe(false);
    expect(play.success).toBeNull();
  });

  it("NRR (no-route-run) rows still find Notes as the last column and force coverage/open to their non-applicable defaults", () => {
    const [play] = parseInput("nrr\tL\tY\t\t\t\t\t\tRun play aligned left");
    expect(play.no_route_run).toBe(true);
    expect(play.coverage).toBe("");
    expect(play.was_open).toBe(false);
    expect(play.play_notes).toBe("Run play aligned left");
    expect(play.valid).toBe(true);
  });

  it("Notes lands correctly on a full route row too", () => {
    const [play] = parseInput("slant\tR\tY\tZ\tY\tY\tY\t8\tGood separation");
    expect(play.play_notes).toBe("Good separation");
    expect(play.coverage).toBe("zone");
    expect(play.was_open).toBe(true);
  });

  it("unknown coverage shorthand falls back to blank rather than throwing or guessing", () => {
    const [play] = parseInput("curl\tR\tY\tXYZ\tY\tY\tY\t12");
    expect(play.coverage).toBe("");
    expect(play.valid).toBe(true);
  });
});
