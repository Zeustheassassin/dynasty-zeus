// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChartedGamesCount, ProspectConference } from "@/components/scouting/ProspectRowMeta";

// 2026-11-19: the Prospects lists show the conference after the school (Big Ten,
// Big 12, Independents and FCS in red) and "6/8G" = charted / logged games. Both
// extras are for sm screens up; phones keep the plain "8G" and no conference.

afterEach(cleanup);

describe("ChartedGamesCount", () => {
  it("shows charted / logged, the charted part amber while games are uncharted, from sm up", () => {
    const { container } = render(<ChartedGamesCount logged={8} charted={6} className="text-green-400" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.textContent).toBe("6/8G");
    expect(badge.className).toContain("text-green-400");
    expect(badge.title).toBe("6 of 8 logged games charted (2 unwatched)");
    const chartedPart = badge.firstElementChild as HTMLElement;
    expect(chartedPart.textContent).toBe("6/");
    expect(chartedPart.className).toContain("hidden sm:inline");
    expect(chartedPart.className).toContain("text-amber-400");
  });

  it("isn't amber once every logged game is charted", () => {
    const { container } = render(<ChartedGamesCount logged={10} charted={10} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.textContent).toBe("10/10G");
    expect(badge.title).toBe("10 of 10 logged games charted");
    expect((badge.firstElementChild as HTMLElement).className).not.toContain("text-amber-400");
  });

  it("shows only the logged count when the charted count is unknown", () => {
    const { container } = render(<ChartedGamesCount logged={1} charted={null} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.textContent).toBe("1G");
    expect(badge.title).toBe("1 logged game");
  });

  it("renders nothing with no logged games", () => {
    const { container } = render(<ChartedGamesCount logged={0} charted={0} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("ProspectConference", () => {
  it("is red for Big Ten / Big 12 / Independents / FCS and muted otherwise, sm up only", () => {
    const { container, rerender } = render(<ProspectConference conference="BIG 10" school="Ohio State" />);
    let el = container.firstElementChild as HTMLElement;
    expect(el.textContent).toBe("BIG 10");
    expect(el.className).toContain("text-red-400");
    expect(el.className).toContain("hidden sm:block");

    rerender(<ProspectConference conference="ACC" school="Louisville" />);
    el = container.firstElementChild as HTMLElement;
    expect(el.textContent).toBe("ACC");
    expect(el.className).not.toContain("text-red-400");

    rerender(<ProspectConference conference="" school="Notre Dame" />);
    el = container.firstElementChild as HTMLElement;
    expect(el.textContent).toBe("Independents");
    expect(el.className).toContain("text-red-400");
  });

  it("renders nothing when neither the prospect nor his school gives a conference", () => {
    const { container } = render(<ProspectConference conference="" school="Manual Check University" />);
    expect(container.firstChild).toBeNull();
  });
});
