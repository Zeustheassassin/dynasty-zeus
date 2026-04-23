// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getLocalStorageItem,
  setLocalStorageItem,
  removeLocalStorageItem,
} from "@/lib/hooks/useLocalStorage";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── getLocalStorageItem ──────────────────────────────────────────────────────

describe("getLocalStorageItem", () => {
  it("returns defaultValue when key does not exist", () => {
    expect(getLocalStorageItem("missing", 42)).toBe(42);
  });

  it("returns the parsed value when key exists", () => {
    localStorage.setItem("obj", JSON.stringify({ x: 1 }));
    expect(getLocalStorageItem("obj", null)).toEqual({ x: 1 });
  });

  it("returns defaultValue on JSON parse error (malformed value)", () => {
    localStorage.setItem("bad", "not{json");
    expect(getLocalStorageItem("bad", "fallback")).toBe("fallback");
  });

  it("returns defaultValue when window is undefined (SSR)", () => {
    vi.stubGlobal("window", undefined);
    expect(getLocalStorageItem("key", "ssr-default")).toBe("ssr-default");
  });

  it("preserves the type of the defaultValue (number)", () => {
    expect(getLocalStorageItem("num", 0)).toBe(0);
  });

  it("preserves the type of the defaultValue (array)", () => {
    expect(getLocalStorageItem("arr", [])).toEqual([]);
  });
});

// ── setLocalStorageItem ──────────────────────────────────────────────────────

describe("setLocalStorageItem", () => {
  it("writes the JSON-serialised value to localStorage", () => {
    setLocalStorageItem("data", { a: 1 });
    expect(localStorage.getItem("data")).toBe('{"a":1}');
  });

  it("overwrites an existing value", () => {
    localStorage.setItem("k", '"old"');
    setLocalStorageItem("k", "new");
    expect(localStorage.getItem("k")).toBe('"new"');
  });

  it("does not throw when localStorage throws QuotaExceededError (logs + skips)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => setLocalStorageItem("k", "v")).not.toThrow();
  });

  it("no-ops when window is undefined (SSR)", () => {
    vi.stubGlobal("window", undefined);
    expect(() => setLocalStorageItem("key", "value")).not.toThrow();
  });
});

// ── removeLocalStorageItem ───────────────────────────────────────────────────

describe("removeLocalStorageItem", () => {
  it("removes an existing item", () => {
    localStorage.setItem("del", "x");
    removeLocalStorageItem("del");
    expect(localStorage.getItem("del")).toBeNull();
  });

  it("no-ops silently for a non-existent key", () => {
    expect(() => removeLocalStorageItem("ghost")).not.toThrow();
  });

  it("no-ops when window is undefined (SSR)", () => {
    vi.stubGlobal("window", undefined);
    expect(() => removeLocalStorageItem("key")).not.toThrow();
  });
});
