// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRouteVariant } from "@/components/scouting/shared/hooks/useRouteVariant";

describe("useRouteVariant", () => {
  it("starts a new route on its default and keeps a pick when the same route is clicked again", () => {
    const { result } = renderHook(() => useRouteVariant("curl"));
    expect(result.current.value).toBe("short");

    act(() => result.current.set("deep"));
    act(() => result.current.pickRoute("curl", "curl"));
    expect(result.current.value).toBe("deep");

    act(() => result.current.pickRoute("dig", "curl"));
    expect(result.current.value).toBe("intermediate");
    expect(result.current.missing("dig")).toBe(false);
  });

  it("makes Other wait for a pick", () => {
    const { result } = renderHook(() => useRouteVariant(null));
    expect(result.current.value).toBeNull();
    act(() => result.current.pickRoute("other", null));
    expect(result.current.missing("other")).toBe(true);
    act(() => result.current.set("wheel"));
    expect(result.current.missing("other")).toBe(false);

    // After the log, back to the route's default: Other is empty again.
    act(() => result.current.reset("other"));
    expect(result.current.value).toBeNull();
  });

  it("lets an old route be edited without a sub-route, until its route changes", () => {
    const { result } = renderHook(() => useRouteVariant("curl"));
    act(() => result.current.startEdit(null));
    expect(result.current.legacy).toBe(true);
    expect(result.current.missing("other")).toBe(false);

    act(() => result.current.pickRoute("other", "curl"));
    expect(result.current.legacy).toBe(false);
    expect(result.current.missing("other")).toBe(true);

    act(() => result.current.startEdit("seam"));
    expect(result.current.value).toBe("seam");
    expect(result.current.legacy).toBe(false);
  });
});
