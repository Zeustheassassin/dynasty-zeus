import { describe, it, expect } from "vitest";
import { getLeagueDirectionBucket, getBucketColor } from "@/lib/helpers/direction/bucket";

describe("getLeagueDirectionBucket", () => {
  it("returns Elite when both ranks are in top-20% of a 12-team league", () => {
    // top20 = ceil(12 * 0.20) = 3; both rank 1 and rank 2 qualify
    const { bucket } = getLeagueDirectionBucket(1, 1, 12);
    expect(bucket).toBe("Elite");
  });

  it("returns True Contender when both ranks are in top-33% but not both top-20%", () => {
    // top20 = 3, top33 = ceil(12*0.33) = 4; rank 4 is in top33 but not top20
    const { bucket } = getLeagueDirectionBucket(4, 4, 12);
    expect(bucket).toBe("True Contender");
  });

  it("returns Almost There for top-third dynasty but mid-third redraft", () => {
    // dynRank=2 (top33), redRank=6 (mid-third: top33=4, bot33=ceil(12*0.67)=9)
    const { bucket } = getLeagueDirectionBucket(2, 6, 12);
    expect(bucket).toBe("Almost There");
  });

  it("returns Rebuilder for top-third dynasty but bottom-third redraft", () => {
    // dynRank=1, redRank=11 (> bot33=8)
    const { bucket } = getLeagueDirectionBucket(1, 11, 12);
    expect(bucket).toBe("Rebuilder");
  });

  it("returns Fading Contender for mid-third dynasty and top-third redraft", () => {
    const { bucket } = getLeagueDirectionBucket(6, 2, 12);
    expect(bucket).toBe("Fading Contender");
  });

  it("returns Purgatory for mid-third dynasty and mid-third redraft", () => {
    const { bucket } = getLeagueDirectionBucket(6, 6, 12);
    expect(bucket).toBe("Purgatory");
  });

  it("returns Stranded for mid-third dynasty and bottom-third redraft", () => {
    const { bucket } = getLeagueDirectionBucket(6, 11, 12);
    expect(bucket).toBe("Stranded");
  });

  it("returns Window Closing for bottom-third dynasty and top-third redraft", () => {
    const { bucket } = getLeagueDirectionBucket(11, 2, 12);
    expect(bucket).toBe("Window Closing");
  });

  it("returns Fading Out for bottom-third dynasty and mid-third redraft", () => {
    const { bucket } = getLeagueDirectionBucket(11, 6, 12);
    expect(bucket).toBe("Fading Out");
  });

  it("returns Hopeless for bottom-third dynasty and bottom-third redraft", () => {
    const { bucket } = getLeagueDirectionBucket(11, 11, 12);
    expect(bucket).toBe("Hopeless");
  });

  it("scales correctly for an 8-team league", () => {
    // top20 = ceil(8*0.20) = 2; top33 = ceil(8*0.33) = 3
    const { bucket: elite } = getLeagueDirectionBucket(1, 1, 8);
    expect(elite).toBe("Elite");
    const { bucket: hopeless } = getLeagueDirectionBucket(8, 8, 8);
    expect(hopeless).toBe("Hopeless");
  });

  it("returns a non-empty bucketColor string for every bucket", () => {
    const cases: [number, number][] = [
      [1, 1], [4, 4], [2, 6], [1, 11], [6, 2], [6, 6], [6, 11], [11, 2], [11, 6], [11, 11],
    ];
    for (const [d, r] of cases) {
      const { bucketColor } = getLeagueDirectionBucket(d, r, 12);
      expect(bucketColor.length).toBeGreaterThan(0);
    }
  });
});

describe("getBucketColor", () => {
  it("returns a color string for every known bucket", () => {
    const buckets = [
      "Elite", "True Contender", "Almost There", "Rebuilder",
      "Fading Contender", "Window Closing", "Purgatory",
      "Stranded", "Fading Out", "Hopeless",
    ];
    for (const b of buckets) {
      const color = getBucketColor(b);
      expect(color).not.toBe("text-gray-300 bg-gray-800 border-gray-600");
    }
  });

  it("returns fallback gray for unknown bucket", () => {
    expect(getBucketColor("Unknown")).toBe("text-gray-300 bg-gray-800 border-gray-600");
  });

  it("color for each bucket matches the one returned by getLeagueDirectionBucket", () => {
    const cases: [number, number, string][] = [
      [1, 1, "Elite"], [4, 4, "True Contender"], [2, 6, "Almost There"],
      [1, 11, "Rebuilder"], [6, 2, "Fading Contender"], [6, 6, "Purgatory"],
      [6, 11, "Stranded"], [11, 2, "Window Closing"], [11, 6, "Fading Out"], [11, 11, "Hopeless"],
    ];
    for (const [d, r, expectedBucket] of cases) {
      const { bucket, bucketColor } = getLeagueDirectionBucket(d, r, 12);
      expect(bucket).toBe(expectedBucket);
      expect(getBucketColor(bucket)).toBe(bucketColor);
    }
  });
});
