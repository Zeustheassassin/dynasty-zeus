import { describe, it, expect } from "vitest";
import {
  draftRounds, isRookieLengthDraft, isOpenDraft, isHistoryRookieDraft, trimDraftPicks,
} from "@/lib/draft/rookieDrafts";
import { ROOKIE_DRAFT_MAX_ROUNDS } from "@/lib/helpers/season";

const d = (status: string, season = "2026", rounds = 4) => ({ draft_id: "1", season, status, settings: { rounds } });

describe("rookie draft rules", () => {
  it("reads rounds from settings, then the top level, else treats the draft as long", () => {
    expect(draftRounds(d("complete"))).toBe(4);
    expect(draftRounds({ draft_id: "1", season: "2026", status: "complete", rounds: 5 })).toBe(5);
    expect(draftRounds({ draft_id: "1", season: "2026", status: "complete" })).toBe(99);
    expect(isRookieLengthDraft(d("complete", "2026", ROOKIE_DRAFT_MAX_ROUNDS))).toBe(true);
    expect(isRookieLengthDraft(d("complete", "2026", ROOKIE_DRAFT_MAX_ROUNDS + 1))).toBe(false);
  });

  it("calls pre_draft / drafting / paused open", () => {
    expect(["pre_draft", "drafting", "paused"].every((s) => isOpenDraft(d(s)))).toBe(true);
    expect(isOpenDraft(d("complete"))).toBe(false);
  });

  it("History: past classes once complete; this class also while drafting or paused", () => {
    expect(isHistoryRookieDraft(d("complete", "2025"), "2026")).toBe(true);
    expect(isHistoryRookieDraft(d("drafting", "2025"), "2026")).toBe(false);
    expect(isHistoryRookieDraft(d("drafting", "2026"), "2026")).toBe(true);
    expect(isHistoryRookieDraft(d("paused", "2026"), "2026")).toBe(true);
    expect(isHistoryRookieDraft(d("pre_draft", "2026"), "2026")).toBe(false);
    expect(isHistoryRookieDraft(d("complete", "2026", 25), "2026")).toBe(false);
  });
});

describe("trimDraftPicks", () => {
  it("is null for a body that isn't a list", () => {
    expect(trimDraftPicks(null)).toBeNull();
    expect(trimDraftPicks({ error: "x" })).toBeNull();
  });

  it("keeps only the fields the app reads", () => {
    const out = trimDraftPicks([{
      draft_id: "9", pick_no: 3, round: 1, draft_slot: 3, player_id: 4046, picked_by: "", roster_id: 2, is_keeper: null,
      reactions: { u: "x" },
      metadata: { first_name: "A", last_name: "B", position: "QB", team: "BUF", years_exp: "0", injury_status: "Out", number: "17" },
    }]);
    expect(out).toEqual([{
      pick_no: 3, round: 1, draft_slot: 3, player_id: "4046", picked_by: null,
      metadata: { first_name: "A", last_name: "B", position: "QB", team: "BUF", years_exp: "0" },
    }]);
  });

  it("skips a pick without a numeric pick_no and tolerates missing metadata", () => {
    expect(trimDraftPicks([{ round: 1 }, null, { pick_no: "2", player_id: "7", picked_by: "u" }])).toEqual([
      { pick_no: 2, round: 0, draft_slot: 0, player_id: "7", picked_by: "u", metadata: {} },
    ]);
  });
});
