import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POSITION_TAGS, type TagPosition } from "@/lib/scouting/playEra";

// Each tag is asked beside the field it goes with (its `step`, the user's
// charting order 2026-10-23). A step no board renders would hide its tags,
// and a required one (release vs press, pass-pro loss, run result) would
// then block Log Play with nothing to click, so every board must render
// every step its tags use, plus the Tags row for any tag with no step.
const BOARDS: Record<TagPosition, string> = {
  QB: "components/scouting/qb/QBChartingBoard.tsx",
  RB: "components/scouting/rb/RBChartingBoard.tsx",
  WR: "components/scouting/wr/PlayerChartingBoard.tsx",
  TE: "components/scouting/te/TEChartingBoard.tsx",
};

describe("charting boards show every tag step", () => {
  for (const [pos, file] of Object.entries(BOARDS) as [TagPosition, string][]) {
    it(pos, () => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      const controls = [...src.matchAll(/<PlayTagControls\b[^>]*\/>/g)].map((m) => m[0]);
      const rendered = new Set(controls.map((c) => c.match(/\bstep="(\w+)"/)?.[1] ?? null));
      for (const spec of POSITION_TAGS[pos]) {
        expect(rendered.has(spec.step ?? null), `${pos} ${spec.column} (step ${spec.step ?? "none"})`).toBe(true);
      }
      expect(controls.some((c) => c.includes('part="situation"'))).toBe(true);
      // The Tags row (no step) stays as the catch-all for a tag given no step.
      expect(controls.some((c) => c.includes('part="play"') && !c.includes("step="))).toBe(true);
    });
  }
});
