import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabaseclient", () => ({ supabase: {} }));

import { cleanOverrides } from "@/hooks/useContractSituation";

describe("cleanOverrides", () => {
  it("keeps only well-formed stays / goes calls keyed by an OTC id", () => {
    expect(cleanOverrides({
      "123": { call: "stays", season: 2027 },
      "456": { call: "goes", season: 2027 },
      "789": { call: "maybe", season: 2027 },
      "12": { call: "stays", season: "2027" },
      abc: { call: "goes", season: 2027 },
      "34": null,
    })).toEqual({ "123": { call: "stays", season: 2027 }, "456": { call: "goes", season: 2027 } });
    expect(cleanOverrides(null)).toEqual({});
    expect(cleanOverrides("junk")).toEqual({});
  });
});
