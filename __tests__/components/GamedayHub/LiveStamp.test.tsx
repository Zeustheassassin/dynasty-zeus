// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import LiveStamp from "@/components/GamedayHub/LiveStamp";

afterEach(cleanup);

// Code-review catch: the age clock's initial state used to read from `updatedAt` instead of
// Date.now(), so remounting with an already-stale updatedAt (e.g. switching Gameday tabs away
// and back) showed "just now" for up to 5s until the first interval tick corrected it.

describe("LiveStamp — initial age reflects reality at mount, not a fresh clock", () => {
  it("shows the real elapsed time immediately for an already-stale updatedAt", () => {
    const threeMinutesAgo = Date.now() - 3 * 60_000;
    render(<LiveStamp updatedAt={threeMinutesAgo} live={false} />);
    expect(screen.getByText(/Updated 3m ago/)).toBeTruthy();
    expect(screen.queryByText(/just now/)).toBeNull();
  });

  it("still shows 'just now' for a genuinely fresh updatedAt", () => {
    render(<LiveStamp updatedAt={Date.now()} live={false} />);
    expect(screen.getByText(/just now/)).toBeTruthy();
  });
});
