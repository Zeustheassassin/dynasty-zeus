import { describe, it, expect } from "vitest";
import {
  normalizeDisposition,
  pickDispositionKey,
  opponentAssetKey,
  MY_DISPOSITIONS,
  OPPONENT_DISPOSITIONS,
  NO_INTEREST_DURATIONS,
  TRADE_DISCARD_DAYS,
  addDays,
  isBlockActive,
} from "@/lib/helpers/dispositions";

describe("normalizeDisposition", () => {
  it("collapses the legacy WANT_TO_TRADE value onto SHOPPING", () => {
    expect(normalizeDisposition("WANT_TO_TRADE")).toBe("SHOPPING");
  });

  it("leaves modern values unchanged", () => {
    expect(normalizeDisposition("CORE")).toBe("CORE");
    expect(normalizeDisposition("PRICEY")).toBe("PRICEY");
    expect(normalizeDisposition("SHOPPING")).toBe("SHOPPING");
    expect(normalizeDisposition("OFFLOAD")).toBe("OFFLOAD");
    expect(normalizeDisposition("SELL_NO")).toBe("SELL_NO");
    expect(normalizeDisposition("SELL_OK")).toBe("SELL_OK");
  });

  it("passes through undefined", () => {
    expect(normalizeDisposition(undefined)).toBeUndefined();
  });
});

describe("pickDispositionKey", () => {
  it("matches the finderPickKey format (season-round-roster_id)", () => {
    expect(pickDispositionKey({ season: "2027", round: 1, roster_id: 4 })).toBe("2027-1-4");
  });
});

describe("opponentAssetKey", () => {
  it("scopes an asset id to a specific opponent roster", () => {
    expect(opponentAssetKey("4046", 2)).toBe("4046::2");
  });

  it("produces distinct keys for the same asset under different rosters", () => {
    expect(opponentAssetKey("4046", 2)).not.toBe(opponentAssetKey("4046", 3));
  });

  it("composes with pickDispositionKey for opponent-tagged picks", () => {
    const pickKey = pickDispositionKey({ season: "2027", round: 1, roster_id: 4 });
    expect(opponentAssetKey(pickKey, 7)).toBe("2027-1-4::7");
  });
});

describe("MY_DISPOSITIONS / OPPONENT_DISPOSITIONS", () => {
  it("keeps the two vocabularies disjoint", () => {
    const myValues = MY_DISPOSITIONS.map((d) => d.value);
    const oppValues = OPPONENT_DISPOSITIONS.map((d) => d.value);
    expect(myValues.some((v) => (oppValues as string[]).includes(v))).toBe(false);
  });

  it("has 4 self dispositions and 2 opponent dispositions", () => {
    expect(MY_DISPOSITIONS).toHaveLength(4);
    expect(OPPONENT_DISPOSITIONS).toHaveLength(2);
  });
});

describe("addDays / isBlockActive (finder_temp_blocks expiry)", () => {
  it("addDays produces a future ISO timestamp isBlockActive treats as active", () => {
    const expiresAt = addDays(7);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    expect(isBlockActive(expiresAt)).toBe(true);
  });

  it("isBlockActive is false for a past timestamp", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isBlockActive(past)).toBe(false);
  });

  it("isBlockActive is false for undefined (no block set)", () => {
    expect(isBlockActive(undefined)).toBe(false);
  });

  it("NO_INTEREST_DURATIONS offers exactly the 4 documented choices", () => {
    expect(NO_INTEREST_DURATIONS.map((d) => d.days)).toEqual([7, 30, 90, 182]);
  });

  it("TRADE_DISCARD_DAYS is the fixed 2-week window", () => {
    expect(TRADE_DISCARD_DAYS).toBe(14);
  });
});
