// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import InjuryTab from "@/components/AlertsPage/InjuryTab";
import { getInjuredCount, getListedCount, injuryStatusStyle, type InjuryReportPlayer } from "@/components/AlertsPage/alertsPageHelpers";
import type { SleeperPlayer } from "@/lib/types";

// The Injury Report's plain-English summary panel + the healthy-scratch badge.

afterEach(() => {
  cleanup();
  window.localStorage.clear(); // cachedFetch caches the detail by URL
  vi.restoreAllMocks();
});

const player = (p: Partial<SleeperPlayer>): SleeperPlayer =>
  ({ player_id: "p1", full_name: "Jordyn Tyson", position: "WR", team: "NO", status: "Inactive", bye_week: 0, ...p }) as SleeperPlayer;
const entry = (p: SleeperPlayer): InjuryReportPlayer => ({
  player: p, playerId: p.player_id, leagues: [], startingLeagues: [], irLeagues: [], irEligibleLeagues: [], isWatchlisted: true,
});
const renderExpanded = (p: SleeperPlayer) =>
  render(<InjuryTab injuryReportPlayers={[entry(p)]} currentNFLWeek={4} expandedInjuryId={p.player_id} setExpandedInjuryId={vi.fn()} />);

describe("InjurySummaryPanel", () => {
  it("shows ESPN's summary, timeline and news once the report arrives", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T15:00:00Z"));
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({
      found: true, season: 2026, status: "Injured Reserve", fantasyStatus: "IR-R", date: "2026-08-30T22:30Z",
      type: "Hamstring", side: "Right", detail: "Strain", returnDate: "2026-10-11",
      shortComment: "Tyson (hamstring) was placed on injured reserve.", longComment: "Expected to miss two months.",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    renderExpanded(player({ injury_status: "IR", injury_body_part: "Hamstring", injury_notes: "Strain" }));

    expect(await screen.findByText(
      "Based on reports, Jordyn Tyson is on injured reserve (designated to return) with a right hamstring strain.",
    )).toBeTruthy();
    expect(screen.getByText("Projected return: Oct 11 (about 2 weeks)")).toBeTruthy();
    expect(screen.getByText(/ESPN · updated Aug 30/)).toBeTruthy();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/injuries/detail?name=Jordyn+Tyson&team=NO&pos=WR");
    vi.useRealTimers();
  });

  it("keeps Sleeper's version when ESPN is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    renderExpanded(player({ injury_status: "IR", injury_body_part: "Knee - ACL" }));
    expect(await screen.findByText("Sleeper · no ESPN report found")).toBeTruthy();
    expect(screen.getByText("Based on Sleeper's injury feed, Jordyn Tyson is on injured reserve with a knee (ACL) injury.")).toBeTruthy();
  });
});

describe("healthy scratch badge", () => {
  const scratch = player({ full_name: "Devin Singletary", position: "RB", team: "NYG", status: "Active", injury_status: "Out", injury_body_part: "Coach's Decision" });

  it("gets its own Scratch badge instead of the red Out", () => {
    expect(injuryStatusStyle(scratch)).toMatchObject({ label: "Scratch" });
    expect(injuryStatusStyle(player({ injury_status: "Out", injury_body_part: "Hamstring" }))).toMatchObject({ label: "Out" });
    expect(injuryStatusStyle(player({ injury_status: "Sus", injury_body_part: "Suspension" }))).toMatchObject({ label: "Suspended" });
  });

  it("stays on the report but isn't counted as injured", () => {
    const injured = entry(player({ player_id: "p2", injury_status: "Out", injury_body_part: "Hamstring" }));
    const healthy = entry(player({ player_id: "p3", injury_status: null, status: "Active" }));
    expect(getInjuredCount([entry(scratch), injured, healthy])).toBe(1);
    // The Injury Report tab counts every listed row, scratches included.
    expect(getListedCount([entry(scratch), injured, healthy])).toBe(2);
  });

  it("renders the badge on the row", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    render(<InjuryTab injuryReportPlayers={[entry(scratch)]} currentNFLWeek={4} expandedInjuryId={null} setExpandedInjuryId={vi.fn()} />);
    const badge = screen.getByText("Scratch");
    expect(badge.getAttribute("title")).toMatch(/healthy scratch/i);
  });
});
