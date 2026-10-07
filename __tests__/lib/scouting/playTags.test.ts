import { describe, it, expect } from "vitest";
import { isTaggedPlay, tagColumns, type TagPosition } from "@/lib/scouting/playEra";
import {
  carriedStickyValues, defaultTagValues, forcedTagPayload, missingTags, tagBadges, tagDefault, tagForced,
  tagPayload, tagSpecs, tagValuesFromPlay, visibleTags, type PlayFacts,
} from "@/lib/scouting/playTags";

const POSITIONS: TagPosition[] = ["QB", "RB", "WR", "TE"];
const cols = (specs: { column: string }[]) => specs.map((s) => s.column);

// A typical play per position, as the boards describe it.
const QB_THROW: PlayFacts = { dropback: true, throw: true };
const QB_SACK: PlayFacts = { dropback: true, sack: true };
const QB_SCRAMBLE: PlayFacts = { dropback: true, run: true };
const QB_RUN: PlayFacts = { run: true };
const RB_CARRY: PlayFacts = { run: true };
const WR_ROUTE: PlayFacts = {};
const TE_BLOCK: PlayFacts = { block: true };

describe("defaults", () => {
  it("fills exception tags off, presets on, and leaves only required tags empty", () => {
    expect(defaultTagValues("QB")).toEqual({
      red_zone: false, third_fourth_down: false, short_yardage: false, garbage_time: false,
      play_action: false, tight_window: false, release_timing: "on_time", better_option_missed: false,
      sack_fault: "line", run_success: null, run_broken_tackle: false, run_explosive: false,
    });
    expect(defaultTagValues("TE").blocked_defender).toBe("dl");
    expect(defaultTagValues("WR").press_release).toBeNull();
    expect(defaultTagValues("RB").pass_pro_loss).toBeNull();
  });

  it("never pre-selects a rare good outcome", () => {
    for (const pos of POSITIONS) {
      for (const spec of tagSpecs(pos)) {
        if (spec.values || spec.required) continue;
        // Every on/off tag starts off: broken tackles, explosives, won reps are never assumed.
        expect(tagDefault(spec), spec.column).toBe(false);
      }
    }
  });

  it("covers every 062 column, situation tags first", () => {
    for (const pos of POSITIONS) expect(cols([...tagSpecs(pos)])).toEqual(tagColumns(pos));
  });
});

describe("a new play's payload", () => {
  it("writes every tag column of the position, so the play reads as tagged", () => {
    const cases: [TagPosition, PlayFacts][] = [["QB", QB_THROW], ["RB", RB_CARRY], ["WR", WR_ROUTE], ["TE", TE_BLOCK]];
    for (const [pos, facts] of cases) {
      const p = tagPayload(pos, defaultTagValues(pos), facts);
      expect(Object.keys(p).sort()).toEqual([...tagColumns(pos)].sort());
      for (const c of ["red_zone", "third_fourth_down", "short_yardage", "garbage_time"]) expect(p[c]).toBe(false);
      expect(isTaggedPlay(p, pos)).toBe(true);
    }
  });

  it("QB throw: defaults written, sack and run tags NULL", () => {
    const p = tagPayload("QB", defaultTagValues("QB"), QB_THROW);
    expect(p).toMatchObject({
      play_action: false, tight_window: false, release_timing: "on_time", better_option_missed: false,
      sack_fault: null, run_success: null, run_broken_tackle: null, run_explosive: null,
    });
  });

  it("QB sack: fault pre-selected line; throw-only tags NULL", () => {
    const p = tagPayload("QB", defaultTagValues("QB"), QB_SACK);
    expect(p).toMatchObject({ sack_fault: "line", play_action: false, better_option_missed: false, tight_window: null, release_timing: null, run_success: null });
  });

  it("QB designed run: only the run result and situation tags", () => {
    const v = { ...defaultTagValues("QB"), run_success: true, run_explosive: true };
    const p = tagPayload("QB", v, QB_RUN);
    expect(p).toMatchObject({ run_success: true, run_broken_tackle: false, run_explosive: true, play_action: null, better_option_missed: null, release_timing: null, sack_fault: null });
  });

  it("RB: carry tags NULL on a route, loss reason only on a failed pass block", () => {
    const route = tagPayload("RB", defaultTagValues("RB"), {});
    expect(route).toMatchObject({ hit_behind_line: null, missed_read: null, pass_pro_loss: null, broken_tackle_after_catch: null });
    const caught = tagPayload("RB", defaultTagValues("RB"), { catch: true });
    expect(caught.broken_tackle_after_catch).toBe(false);
    const carry = tagPayload("RB", defaultTagValues("RB"), RB_CARRY);
    expect(carry).toMatchObject({ hit_behind_line: false, missed_read: false });
    // Caught from behind was dropped (2026-10-07): new plays leave the column NULL.
    expect("caught_from_behind" in carry).toBe(false);
    const loss = tagPayload("RB", { ...defaultTagValues("RB"), pass_pro_loss: "beaten" }, { passProLoss: true });
    expect(loss.pass_pro_loss).toBe("beaten");
  });

  it("WR / TE: press release only on press routes; TE block target only on blocks", () => {
    expect(tagPayload("WR", { ...defaultTagValues("WR"), press_release: "won" }, {}).press_release).toBeNull();
    expect(tagPayload("WR", { ...defaultTagValues("WR"), press_release: "won" }, { press: true }).press_release).toBe("won");
    const block = tagPayload("TE", defaultTagValues("TE"), TE_BLOCK);
    expect(block).toMatchObject({ blocked_defender: "dl", press_release: null, chipped_before_route: null });
    const route = tagPayload("TE", { ...defaultTagValues("TE"), chipped_before_route: true }, { route: true });
    expect(route).toMatchObject({ blocked_defender: null, chipped_before_route: true, press_release: null });
  });

  it("QB RPO: play action is always on, whatever was clicked", () => {
    const rpoThrow: PlayFacts = { ...QB_THROW, rpo: true };
    expect(tagPayload("QB", defaultTagValues("QB"), rpoThrow).play_action).toBe(true);
    expect(tagPayload("QB", { ...defaultTagValues("QB"), play_action: false }, { ...QB_SACK, rpo: true }).play_action).toBe(true);
    // A pass keeps the charter's own call.
    expect(tagPayload("QB", defaultTagValues("QB"), QB_THROW).play_action).toBe(false);
    const pa = tagSpecs("QB").find((s) => s.column === "play_action")!;
    expect(tagForced(pa, rpoThrow)).toBe(true);
    expect(tagForced(pa, QB_THROW)).toBe(false);
  });

  it("drops a value that doesn't fit the tag, falling back to its default", () => {
    const p = tagPayload("QB", { ...defaultTagValues("QB"), release_timing: "whenever", tight_window: "yes" }, QB_THROW);
    expect(p.release_timing).toBe("on_time");
    expect(p.tight_window).toBe(false);
  });
});

describe("click budget", () => {
  it("a typical play needs no pick at any position", () => {
    expect(missingTags("QB", defaultTagValues("QB"), QB_THROW)).toEqual([]);
    expect(missingTags("QB", defaultTagValues("QB"), QB_SACK)).toEqual([]);
    expect(missingTags("RB", defaultTagValues("RB"), RB_CARRY)).toEqual([]);
    expect(missingTags("RB", defaultTagValues("RB"), { catch: true })).toEqual([]);
    expect(missingTags("WR", defaultTagValues("WR"), WR_ROUTE)).toEqual([]);
    expect(missingTags("WR", defaultTagValues("WR"), { catch: true })).toEqual([]);
    expect(missingTags("TE", defaultTagValues("TE"), TE_BLOCK)).toEqual([]);
    expect(missingTags("TE", defaultTagValues("TE"), { route: true })).toEqual([]);
  });

  it("asks for one pick only where no default exists", () => {
    expect(cols(missingTags("WR", defaultTagValues("WR"), { press: true }))).toEqual(["press_release"]);
    expect(cols(missingTags("TE", defaultTagValues("TE"), { route: true, press: true }))).toEqual(["press_release"]);
    expect(cols(missingTags("RB", defaultTagValues("RB"), { passProLoss: true }))).toEqual(["pass_pro_loss"]);
    expect(cols(missingTags("QB", defaultTagValues("QB"), QB_SCRAMBLE))).toEqual(["run_success"]);
    expect(missingTags("WR", { ...defaultTagValues("WR"), press_release: "lost" }, { press: true })).toEqual([]);
    expect(missingTags("QB", { ...defaultTagValues("QB"), run_success: false }, QB_RUN)).toEqual([]);
  });
});

describe("what shows", () => {
  it("situation row on every play; play tags only where they apply", () => {
    for (const pos of POSITIONS) {
      expect(cols(visibleTags(pos, {}, "situation"))).toEqual(["red_zone", "third_fourth_down", "short_yardage", "garbage_time"]);
    }
    expect(cols(visibleTags("QB", QB_THROW, "play"))).toEqual(["play_action", "tight_window", "release_timing", "better_option_missed"]);
    expect(cols(visibleTags("QB", QB_SCRAMBLE, "play"))).toEqual(["play_action", "better_option_missed", "run_success", "run_broken_tackle", "run_explosive"]);
    expect(cols(visibleTags("WR", WR_ROUTE, "play"))).toEqual([]);
    expect(cols(visibleTags("TE", { route: true }, "play"))).toEqual(["chipped_before_route"]);
  });
});

describe("sticky carry-over", () => {
  it("starts a game with its last charted value, skipping untagged plays", () => {
    const plays = [
      { red_zone: true, garbage_time: false },
      { red_zone: null, garbage_time: null }, // pasted in / charted before tags
    ];
    expect(carriedStickyValues("WR", plays)).toEqual({ red_zone: true, garbage_time: false });
    expect(carriedStickyValues("WR", [...plays, { red_zone: false, garbage_time: true }])).toEqual({ red_zone: false, garbage_time: true });
  });

  it("starts a new or untagged game off", () => {
    expect(carriedStickyValues("QB", [])).toEqual({ red_zone: false, garbage_time: false });
    expect(carriedStickyValues("QB", [{ route_type: "nine" }])).toEqual({ red_zone: false, garbage_time: false });
  });
});

describe("editing a play charted before the tags", () => {
  it("writes only the forced tags, and the play stays untagged", () => {
    const rpo = forcedTagPayload("QB", { ...QB_THROW, rpo: true });
    expect(rpo).toEqual({ play_action: true });
    expect(isTaggedPlay(rpo, "QB")).toBe(false);
    // Turned away from RPO, an old play loses it again.
    expect(forcedTagPayload("QB", QB_THROW)).toEqual({ play_action: null });
    expect(forcedTagPayload("QB", { ...QB_RUN, rpo: false })).toEqual({ play_action: null });
    for (const pos of ["RB", "WR", "TE"] as const) expect(forcedTagPayload(pos, { run: true, route: true })).toEqual({});
  });
});

describe("editing", () => {
  it("loads a tagged play's own values, with defaults for tags that didn't apply", () => {
    const play = { red_zone: true, third_fourth_down: false, short_yardage: false, garbage_time: false, press_release: null, broken_tackle_after_catch: true };
    expect(tagValuesFromPlay(play, "WR")).toEqual({
      red_zone: true, third_fourth_down: false, short_yardage: false, garbage_time: false,
      press_release: null, broken_tackle_after_catch: true,
    });
    expect(tagValuesFromPlay({ red_zone: false, blocked_defender: null }, "TE").blocked_defender).toBe("dl");
  });
});

describe("play-list badges", () => {
  it("shows tags that are on and picks that differ from the preset", () => {
    const qb = { ...tagPayload("QB", defaultTagValues("QB"), QB_THROW), red_zone: true, release_timing: "late", tight_window: true };
    expect(tagBadges(qb, "QB").map((b) => b.text)).toEqual(["RZ", "TW", "Rel Late"]);
    expect(tagBadges(tagPayload("QB", defaultTagValues("QB"), QB_SACK), "QB")).toEqual([]); // Line = preset
    expect(tagBadges({ ...tagPayload("QB", defaultTagValues("QB"), QB_RUN), run_success: false }, "QB").map((b) => b.text)).toEqual(["Run ✗"]);
    expect(tagBadges({ red_zone: false, press_release: "won" }, "WR").map((b) => b.text)).toEqual(["Press Won"]);
    expect(tagBadges({ red_zone: false, blocked_defender: "lb" }, "TE").map((b) => b.text)).toEqual(["Blk LB"]);
  });

  it("shows nothing for an untagged play", () => {
    expect(tagBadges({ route_type: "nine", broken_tackle: true }, "RB")).toEqual([]);
  });
});
