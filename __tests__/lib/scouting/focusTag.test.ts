import { describe, it, expect } from "vitest";
import { FOCUS_TAGS, focusTagDef, focusTagOrder, focusSortValue, parseFocusTag } from "../../../lib/scouting/focusTag";

describe("focusTag", () => {
  it("lists the four sheet tags in priority order, with the sheet's wording", () => {
    expect(FOCUS_TAGS.map((d) => d.value)).toEqual(["focus_now", "monitor", "low_priority", "off_board"]);
    expect(FOCUS_TAGS.map((d) => d.label)).toEqual(["Focus now", "Monitor", "Low priority", "Off 2027 board"]);
  });

  it("treats null, empty and unknown values as untagged", () => {
    expect(focusTagDef(null)).toBeNull();
    expect(focusTagDef(undefined)).toBeNull();
    expect(focusTagDef("")).toBeNull();
    expect(focusTagDef("Focus now")).toBeNull(); // the sheet's label is not a stored value
    expect(parseFocusTag("")).toBeNull();
    expect(parseFocusTag("bogus")).toBeNull();
    expect(parseFocusTag("monitor")).toBe("monitor");
  });

  it("orders Focus now first and untagged after every tag", () => {
    expect(focusTagOrder("focus_now")).toBe(0);
    expect(focusTagOrder("off_board")).toBe(3);
    expect(focusTagOrder(null)).toBe(4);
    expect(focusTagOrder("bogus")).toBe(4);
  });

  it("sorts by tag first, then rank within a tag, unranked last", () => {
    const rows = [
      { name: "untagged #1", focus_tag: null, personal_rank: 1 },
      { name: "monitor #2", focus_tag: "monitor", personal_rank: 2 },
      { name: "focus unranked", focus_tag: "focus_now", personal_rank: null },
      { name: "focus #40", focus_tag: "focus_now", personal_rank: 40 },
      { name: "off #3", focus_tag: "off_board", personal_rank: 3 },
      { name: "low #5", focus_tag: "low_priority", personal_rank: 5 },
      { name: "focus #7", focus_tag: "focus_now", personal_rank: 7 },
    ];
    const sorted = [...rows].sort((a, b) => focusSortValue(a) - focusSortValue(b)).map((r) => r.name);
    expect(sorted).toEqual(["focus #7", "focus #40", "focus unranked", "monitor #2", "low #5", "off #3", "untagged #1"]);
  });

  it("never lets a large rank cross into the next tag", () => {
    expect(focusSortValue({ focus_tag: "focus_now", personal_rank: 9999 }))
      .toBeLessThan(focusSortValue({ focus_tag: "monitor", personal_rank: 1 }));
    expect(focusSortValue({ focus_tag: "focus_now", personal_rank: null }))
      .toBeLessThan(focusSortValue({ focus_tag: "monitor", personal_rank: 1 }));
  });
});
