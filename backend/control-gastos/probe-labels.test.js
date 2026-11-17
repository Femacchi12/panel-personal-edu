"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

process.env.CONTROL_GASTOS_TEST_TARGET_ENFORCED = "1";
process.env.CONTROL_GASTOS_SHEETS_TEST_SPREADSHEET_ID = "isolated-test";
process.env.CONTROL_GASTOS_SHEETS_TEST_SHEET = "Movimientos_Test";

const service = require("./service");

test("Sheets probe reports the actual concept and original amount columns", async () => {
  const cells = Array(27).fill("");
  cells[0] = "MOV-90001";
  cells[9] = "Concepto correcto";
  cells[11] = "1234";
  cells[20] = "CGTEST:cgtest_labels:append:1";
  service.configureControlledWrites({
    target: { spreadsheetId: "isolated-test", sheet: "Movimientos_Test" },
    writer: {
      appendMovimientos: async () => ({ ok: true }),
      readExisting: async () => ({ dataRows: [{ rowNum: 2, cells }] }),
    },
  });
  const result = await service.runTestProbe({}, { namespace: "cgtest_labels", action: "sheets_append" });
  assert.equal(result.readback.concepto, "Concepto correcto");
  assert.equal(result.readback.importe, "1234");
});
