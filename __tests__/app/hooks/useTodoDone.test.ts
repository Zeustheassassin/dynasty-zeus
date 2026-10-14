// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTodoDone, todoDoneStorageKey } from "@/app/hooks/useTodoDone";

// To-Do Done marks: this device only, per Supabase account, current NFL week only.

beforeEach(() => localStorage.clear());

const stored = (account: string) => JSON.parse(localStorage.getItem(todoDoneStorageKey(account)) ?? "null");

describe("useTodoDone", () => {
  it("saves marks per account and week, and reads them back on the next mount", () => {
    const first = renderHook(() => useTodoDone("acct", "2026:7"));
    act(() => first.result.current.markDone([{ key: "a" }, { key: "b", final: true }]));
    expect(first.result.current.done.a.final).toBeUndefined();
    expect(first.result.current.done.b.final).toBe(true);
    expect(stored("acct").week).toBe("2026:7");

    const again = renderHook(() => useTodoDone("acct", "2026:7"));
    expect(Object.keys(again.result.current.done).sort()).toEqual(["a", "b"]);
    // Another account on the same device sees none of them.
    expect(renderHook(() => useTodoDone("other", "2026:7")).result.current.done).toEqual({});
  });

  it("starts each week empty and drops the old week on the next mark", () => {
    const { result, rerender } = renderHook(({ week }) => useTodoDone("acct", week), { initialProps: { week: "2026:7" } });
    act(() => result.current.markDone([{ key: "a" }]));

    rerender({ week: "2026:8" });
    expect(result.current.done).toEqual({});
    act(() => result.current.markDone([{ key: "c" }]));
    expect(stored("acct")).toMatchObject({ week: "2026:8" });
    expect(Object.keys(stored("acct").items)).toEqual(["c"]);
  });

  it("picks up the account once it arrives after mount", () => {
    localStorage.setItem(todoDoneStorageKey("acct"), JSON.stringify({ week: "2026:7", items: { a: { at: 1 } } }));
    const { result, rerender } = renderHook(({ account }) => useTodoDone(account, "2026:7"), {
      initialProps: { account: null as string | null },
    });
    expect(result.current.done).toEqual({});
    rerender({ account: "acct" });
    expect(result.current.done).toEqual({ a: { at: 1 } });
  });

  it("undoes a mark", () => {
    const { result } = renderHook(() => useTodoDone("acct", "2026:7"));
    act(() => result.current.markDone([{ key: "a" }, { key: "b" }]));
    act(() => result.current.undoDone("a"));
    expect(Object.keys(result.current.done)).toEqual(["b"]);
    expect(Object.keys(stored("acct").items)).toEqual(["b"]);
  });

  it("does nothing until the week is known", () => {
    const { result } = renderHook(() => useTodoDone("acct", null));
    act(() => result.current.markDone([{ key: "a" }]));
    expect(result.current.done).toEqual({});
    expect(stored("acct")).toBeNull();
  });
});
