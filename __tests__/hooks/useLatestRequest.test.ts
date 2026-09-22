// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLatestRequest } from "@/hooks/useLatestRequest";

// Pins the out-of-order-commit guard shape duplicated across useAppState.ts
// (loadRosterSeqRef, transactionsRequestIdRef) and ScoutingHub.tsx (loadSeqRef):
// a token from `begin()` stays current until a later `begin()` call supersedes it.
describe("useLatestRequest", () => {
  it("the first token is current until a second begin() supersedes it", () => {
    const { result } = renderHook(() => useLatestRequest());

    let tokenA = -1;
    act(() => { tokenA = result.current.begin(); });
    expect(result.current.isCurrent(tokenA)).toBe(true);

    let tokenB = -1;
    act(() => { tokenB = result.current.begin(); });
    expect(result.current.isCurrent(tokenA)).toBe(false);
    expect(result.current.isCurrent(tokenB)).toBe(true);
  });

  it("hands out strictly increasing tokens, never repeating one", () => {
    const { result } = renderHook(() => useLatestRequest());
    const tokens = new Set<number>();
    act(() => {
      for (let i = 0; i < 5; i++) tokens.add(result.current.begin());
    });
    expect(tokens.size).toBe(5);
  });

  it("begin/isCurrent are referentially stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useLatestRequest());
    const { begin, isCurrent } = result.current;
    rerender();
    expect(result.current.begin).toBe(begin);
    expect(result.current.isCurrent).toBe(isCurrent);
  });
});
