// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import ConsensusPanel from "@/components/scouting/consensus/ConsensusPanel";
import { DEFAULT_DYNASTY_WEIGHTS, projectedCapital, type DynastyBreakdown } from "@/lib/scouting/dynastyScore";
import type { ProspectWithStats } from "@/lib/types";

// Big Board → Consensus board (stage 6 of the 2026-11-26 scouting plan):
// upload, review, save.

afterEach(cleanup);

const prospect = (id: string, name: string, position: string, school: string, extra: Partial<ProspectWithStats> = {}) =>
  ({ id, name, position, school, draft_class_year: 2027, draft_round: null, ...extra }) as ProspectWithStats;

const PROSPECTS = [
  prospect("cole", "Cam Coleman", "WR", "Texas"),
  prospect("garcia", "Jake Garcia", "QB", "Furman"),
  prospect("none", "Not Listed", "TE", "Iowa"),
  prospect("lopez", "Gio Lopez", "QB", "Wake Forest", { draft_class_year: 2028 }),
];
const CSV = [
  "Rank,Player Name,Position,College",
  "3,Colin Simmons,EDGE,Texas",
  "19,Cam Coleman,WR,Texas",
  "279,Gio Lopez,QB,Wake Forest",
  "1111,Jake Garcia,QB,Michigan",
  "211,Luke Lindenmeyer,TE,Nebraska",
].join("\n");

const dyn = (dynasty: number): DynastyBreakdown =>
  ({ aeScore: dynasty, rookieAge: null, window: null, flags: [], speed: null, lightInside: null, rushing: null, qbDiscount: null, dynasty, draftCapital: null, projected: null, plus: null });

function renderPanel(onSave = vi.fn(async () => null as string | null)) {
  render(
    <ConsensusPanel prospects={PROSPECTS} years={[2026, 2027, 2028]} defaultYear={null}
      dynasty={new Map([["cole", dyn(0.5)]])} weights={DEFAULT_DYNASTY_WEIGHTS} onSave={onSave} onClose={vi.fn()} />,
  );
  return onSave;
}

async function upload(text = CSV, name = "consensus-big-board-2027-20261127.csv") {
  fireEvent.change(screen.getByLabelText("Consensus big board CSV"), { target: { files: [new File([text], name, { type: "text/csv" })] } });
  await screen.findByText(/players read/);
}

describe("ConsensusPanel", () => {
  it("reads the CSV for the file's class and lays out what matched", async () => {
    renderPanel();
    await upload();
    expect((screen.getByLabelText("Class") as HTMLSelectElement).value).toBe("2027");
    expect(screen.getByText(/5 players read \(4 QB \/ RB \/ WR \/ TE\)/)).toBeTruthy();
    // The different-school Jake Garcia comes in unticked, to check.
    expect(screen.getByText(/To check \(1\)/)).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Save Jake Garcia at consensus #1111" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Save Cam Coleman at consensus #19" }) as HTMLInputElement).checked).toBe(true);
    // Cam Coleman's row: picks 15–23, capital and his Dynasty+ once saved at 2×.
    const row = screen.getByRole("checkbox", { name: "Save Cam Coleman at consensus #19" }).closest("tr")!;
    const cap = 2 * projectedCapital(19, "WR");
    expect(within(row).getByText("15–23")).toBeTruthy();
    expect(within(row).getByText(`+${cap.toFixed(2)}`)).toBeTruthy();
    expect(within(row).getByText(`+${(0.5 + cap).toFixed(2)}`)).toBeTruthy();
    expect(screen.getByText(/#279 Gio Lopez \(2028\)/)).toBeTruthy();
    expect(screen.getByText(/#211 Luke Lindenmeyer \(TE, Nebraska\)/)).toBeTruthy();
    expect(screen.getByText(/Not Listed \(TE\)/)).toBeTruthy();
  });

  it("saves the ticked ranks for the class", async () => {
    const onSave = renderPanel();
    await upload();
    fireEvent.click(screen.getByRole("checkbox", { name: "Save Jake Garcia at consensus #1111" }));
    fireEvent.click(screen.getByRole("button", { name: "Save the 2027 consensus: 2 ranked, 1 not on it" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [year, ranks] = onSave.mock.calls[0] as unknown as [number, Map<string, number>];
    expect(year).toBe(2027);
    expect([...ranks].sort()).toEqual([["cole", 19], ["garcia", 1111]]);
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Saved the 2027 consensus: 2 ranked (Dynasty+ projects their picks), 1 not on it.");
  });

  it("says why a save failed and keeps the review", async () => {
    renderPanel(vi.fn(async () => "Couldn't save: is migration 109 applied? Nothing changed."));
    await upload();
    fireEvent.click(screen.getByRole("button", { name: /Save the 2027 consensus/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save: is migration 109 applied? Nothing changed.");
    expect(screen.getByText(/players read/)).toBeTruthy();
  });

  it("refuses a file without the columns", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Consensus big board CSV"), { target: { files: [new File(["a,b\n1,2"], "x.csv")] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/Rank, Player Name, Position, College/);
  });
});
