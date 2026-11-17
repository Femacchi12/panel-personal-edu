"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
process.env.CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED = "false";
process.env.CONTROL_GASTOS_TEST_TARGET_ENFORCED = "1";
process.env.CONTROL_GASTOS_SHEETS_TEST_SPREADSHEET_ID = "isolated-test";
process.env.CONTROL_GASTOS_SHEETS_TEST_SHEET = "Movimientos_Test";
const { assertTargetAllowed, FINANCE_SS } = require("./movimientos-writer");

test("fixed test destination rejects canonical and alternate destinations", () => {
  assert.equal(assertTargetAllowed({ spreadsheetId: "isolated-test", sheet: "Movimientos_Test" }).ok, true);
  assert.equal(assertTargetAllowed({ spreadsheetId: FINANCE_SS, sheet: "Movimientos" }, { allowProductionExplicit: true }).ok, false);
  assert.equal(assertTargetAllowed({ spreadsheetId: "isolated-test", sheet: "Movimientos" }).ok, false);
  assert.equal(assertTargetAllowed({ spreadsheetId: "other", sheet: "Movimientos_Test" }).ok, false);
});
