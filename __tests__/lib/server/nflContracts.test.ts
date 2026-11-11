// @vitest-environment node
// contractsFromParquet against a real (tiny) parquet file written with
// parquet-wasm itself, shaped like nflverse's historical_contracts.parquet:
// the flat columns plus the two nested List<Struct> columns. Guards the
// Arrow → plain-object conversion (an apache-arrow or parquet-wasm bump that
// changes how list / struct cells read would fail here, not in the cron).

import { describe, it, expect } from "vitest";
import { Table, tableToIPC, vectorFromArray, Field, List, Struct, Utf8, Float64, Int32, Bool } from "apache-arrow";
import { Table as WasmTable, writeParquet } from "parquet-wasm/node";
import { contractsFromParquet } from "@/lib/server/nflContracts";

const utf8 = (v: (string | null)[]) => vectorFromArray(v, new Utf8());
const f64 = (v: (number | null)[]) => vectorFromArray(v, new Float64());
const i32 = (v: (number | null)[]) => vectorFromArray(v, new Int32());

const seasonType = new Struct([
  new Field("year", new Utf8(), true), new Field("team", new Utf8(), true),
  new Field("base_salary", new Float64(), true), new Field("cap_number", new Float64(), true),
]);
const historyType = new Struct([
  new Field("team", new Utf8(), true), new Field("contract_type", new Utf8(), true),
  new Field("status", new Utf8(), true), new Field("year_signed", new Int32(), true),
]);

/** Three contract rows: Chase's expired rookie deal, his active extension, Mendoza's rookie deal. */
function parquetBytes(): Uint8Array {
  const table = new Table({
    player: utf8(["Ja'Marr Chase", "Ja'Marr Chase", "Fernando Mendoza"]),
    position: utf8(["WR", "WR", "QB"]),
    team: utf8(["Bengals", "Bengals", "Raiders"]),
    is_active: vectorFromArray([false, true, true], new Bool()),
    year_signed: i32([2021, 2025, 2026]),
    years: i32([4, 4, 4]),
    value: f64([30.8, 161, 57.3]),
    apy: f64([7.7, 40.25, 14.3]),
    guaranteed: f64([30.8, 73.9, 57.3]),
    apy_cap_pct: f64([0.04, 0.144, 0.048]),
    otc_id: i32([9469, 9469, 13145]),
    gsis_id: utf8(["00-0036900", "00-0036900", "00-0041562"]),
    draft_year: i32([2021, 2021, 2026]),
    draft_round: i32([1, 1, null]),
    draft_overall: i32([5, 5, 1]),
    season_history: vectorFromArray([
      [{ year: "2021", team: "Bengals", base_salary: 0.66, cap_number: 5.6 }, { year: "Total", team: "Total", base_salary: 0.66, cap_number: 5.6 }],
      [
        { year: "2025", team: "Bengals", base_salary: 8.07, cap_number: 23.1 },
        { year: "2026", team: "Bengals", base_salary: 17.73, cap_number: 26.2 },
        { year: "Total", team: "Total", base_salary: 25.8, cap_number: 49.3 },
      ],
      null,
    ], new List(new Field("element", seasonType, true))),
    contract_history: vectorFromArray([
      [{ team: "Bengals", contract_type: "Drafted", status: "Expired", year_signed: 2021 }],
      [
        { team: "Bengals", contract_type: "Drafted", status: "Expired", year_signed: 2021 },
        { team: "Bengals", contract_type: "Extension", status: "Active", year_signed: 2025 },
      ],
      [{ team: "Raiders", contract_type: "Drafted", status: "Active", year_signed: 2026 }],
    ], new List(new Field("element", historyType, true))),
  });
  return writeParquet(WasmTable.fromIPCStream(tableToIPC(table, "stream")));
}

describe("contractsFromParquet", () => {
  it("keeps each player's latest contract and turns the nested lists into plain objects", () => {
    const { contracts, activeInFile } = contractsFromParquet(parquetBytes());
    expect(activeInFile).toBe(2);
    expect(contracts).toHaveLength(2);

    const chase = contracts.find((c) => c.otc_id === 9469)!;
    expect(chase).toMatchObject({
      player: "Ja'Marr Chase", is_active: true, year_signed: 2025, apy: 40.25, gsis_id: "00-0036900",
      draft_round: 1, draft_overall: 5,
    });
    expect(chase.season_history?.map((s) => s.year)).toEqual(["2025", "2026", "Total"]);
    expect(chase.season_history?.[1]).toMatchObject({ team: "Bengals", base_salary: 17.73, cap_number: 26.2 });
    expect(chase.contract_history?.map((h) => h.contract_type)).toEqual(["Drafted", "Extension"]);
    expect(chase.contract_history?.[1].year_signed).toBe(2025);

    const mendoza = contracts.find((c) => c.otc_id === 13145)!;
    expect(mendoza).toMatchObject({ is_active: true, draft_round: null, season_history: null });
    expect(mendoza.contract_history?.[0].contract_type).toBe("Drafted");
  });
});
