// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import PublicBigBoardView from "@/components/PublicBigBoardView";
import type { SharedBoardRow } from "@/lib/scouting/sharedBoard";

// The public, read-only Big Board (/board/{token}): the class's All board with
// each player's percent of a full sample, so "an outside viewer understands
// its not complete" (the user, 2026-11-25).

afterEach(cleanup);

const TOKEN = "0123456789abcdef0123456789abcdef";

const row = (name: string, extra: Partial<SharedBoardRow> = {}): SharedBoardRow => ({
  redacted: false, ovr: null, posRank: null, name, pos: "WR", school: "State", age: 21, ageEst: false, ht: "6'1\"", wt: 200,
  pre: null, post: null, games: null, snaps: null, plays: null, sample: null, ...extra,
});

const ROWS: SharedBoardRow[] = [
  row("Jeremiah Smith", { ovr: 1, posRank: 1, pre: 96, games: 10, snaps: 366, plays: 208, sample: { n: 208, full: 160, pct: 100, tier: "full" } }),
  row("Half Way", { ovr: 2, posRank: 2, pos: "RB", pre: 83.8, games: 3, snaps: 120, plays: 66, sample: { n: 66, full: 100, pct: 66, tier: "half" } }),
  row("Est Age", { ovr: null, pos: "TE", age: 20, ageEst: true, sample: { n: 0, full: 140, pct: 0, tier: "low" } }),
];

function renderBoard(rows = ROWS) {
  return render(<PublicBigBoardView token={TOKEN} result={{ status: "ready", board: { classYear: 2027, rows, updatedAt: "2026-11-25T18:00:00Z" } }} />);
}

const names = () => screen.getAllByRole("row").slice(2).map((tr) => within(tr).getAllByRole("cell")[2].textContent);

describe("PublicBigBoardView", () => {
  it("shows the class, every row in OVR order, and each player's sample percent", () => {
    renderBoard();
    expect(screen.getByRole("heading", { name: "2027 Big Board" })).toBeTruthy();
    expect(names()).toEqual(["Jeremiah Smith", "Half Way", "Est Age"]);
    expect(screen.getByText("66%")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getByText("66 of 100 runs charted")).toBeTruthy();
    // An estimated age reads with ~.
    expect(screen.getByText("~20")).toBeTruthy();
    // The grade as the board writes it.
    expect(screen.getByText("96.0")).toBeTruthy();
  });

  it("says plainly that anything under 100% isn't finished", () => {
    renderBoard();
    const note = screen.getByRole("region", { name: "About the Sample column" });
    expect(note.textContent).toContain("Still being charted");
    expect(note.textContent).toContain("QB 180 throws · RB 100 runs · WR 160 routes · TE 140 routes");
    expect(note.textContent).toContain("2 of 3 aren't at a full sample yet");
  });

  it("sorts by a column on click, a blank sinking either way", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Sample" }));
    expect(names()).toEqual(["Jeremiah Smith", "Half Way", "Est Age"]);
    fireEvent.click(screen.getByRole("button", { name: /^Sample/ }));
    expect(names()).toEqual(["Est Age", "Half Way", "Jeremiah Smith"]);
    fireEvent.click(screen.getByRole("button", { name: "OVR" }));
    expect(names()).toEqual(["Jeremiah Smith", "Half Way", "Est Age"]);
    fireEvent.click(screen.getByRole("button", { name: /^OVR/ }));
    // Descending, the unranked still last.
    expect(names()).toEqual(["Half Way", "Jeremiah Smith", "Est Age"]);
  });

  it("a Redacted row keeps its rank and grade, and the note says what Redacted means", () => {
    renderBoard([...ROWS, row("Redacted", { redacted: true, ovr: 4, pos: "RB", pre: 94.8, school: "", age: null, ht: null, wt: null })]);
    const tr = screen.getAllByRole("row").find((r) => within(r).queryByText("Redacted", { selector: "td" }))!;
    expect(within(tr).getByText("#4")).toBeTruthy();
    expect(within(tr).getByText("94.8")).toBeTruthy();
    expect(screen.getByRole("region", { name: "About the Sample column" }).textContent).toContain("one player is hidden on this link");
  });

  it("a bad link says so", () => {
    render(<PublicBigBoardView token={TOKEN} result={{ status: "missing" }} />);
    expect(screen.getByRole("heading", { name: "Board not found" })).toBeTruthy();
  });
});
