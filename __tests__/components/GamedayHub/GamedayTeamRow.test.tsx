// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import GamedayTeamRow from "@/components/GamedayHub/GamedayTeamRow";
import type { GamedayTeamView } from "@/lib/types";

afterEach(cleanup);

const team: GamedayTeamView = {
  rosterId: 1,
  ownerId: "me",
  ownerName: "Me",
  actualPoints: 50,
  remainingProjection: 40,
  projectedFinal: 90,
  remainingStdDev: 10,
  finishedStarters: 2,
  liveStarters: 3,
  upcomingStarters: 4,
  noGameStarters: 0,
  totalStarters: 9,
  starterRows: [],
  benchRows: [],
  taxiRows: [],
  benchRegret: { points: 0, optimalPoints: 50, swaps: [] },
};

const outline = (resultStatus: ComponentProps<typeof GamedayTeamRow>["resultStatus"]) => {
  const { container } = render(<GamedayTeamRow team={team} resultStatus={resultStatus} />);
  return (container.firstElementChild as HTMLElement).className;
};

// The Gameday Dashboard's "my team" outline: four colors while players are still active,
// then the solid green / red fill once the matchup is final.
describe("GamedayTeamRow outline", () => {
  it("is green / yellow / orange / red while in progress, by projected margin", () => {
    expect(outline({ status: "win", final: false, close: false })).toContain("border-green-500");
    expect(outline({ status: "win", final: false, close: true })).toContain("border-yellow-400");
    expect(outline({ status: "loss", final: false, close: true })).toContain("border-orange-500");
    expect(outline({ status: "loss", final: false, close: false })).toContain("border-red-500");
  });

  it("goes to solid green or red once final", () => {
    expect(outline({ status: "win", final: true, close: false })).toContain("bg-green-900/30");
    expect(outline({ status: "loss", final: true, close: false })).toContain("bg-red-900/30");
  });

  it("stays plain for a projected tie or when no result is passed", () => {
    expect(outline({ status: "tie", final: false, close: true })).toContain("border-gray-800");
    expect(outline(undefined)).toContain("border-gray-800");
  });
});
