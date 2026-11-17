"use strict";

// Adapter that lets the single SequentialWriter use the real Google Sheets v4
// client. It is deliberately narrow: the destination is the fixed TEST target,
// it only exposes readAll/write (no append, no arbitrary range), and the
// factory refuses to build unless the caller explicitly allows writes.
//
// It is NOT wired into routes, the local harness or Cloud Run. The sequential
// consumer still runs only with MockSheetsClient.
const { TEST_TARGET } = require("./durable-queue");
const { parseReadRows } = require("./movimientos-writer");
const { normalized, WIDTH } = require("./sequential-writer");

function assertTestTarget(target) {
  if (!target || target.spreadsheetId !== TEST_TARGET.spreadsheetId || target.sheet !== TEST_TARGET.sheet)
    throw new Error("target_rejected");
}

class SheetsWriterClient {
  constructor({ sheetsClient, allowRealWrites = false } = {}) {
    if (!sheetsClient || typeof sheetsClient.readRange !== "function" || typeof sheetsClient.writeRange !== "function")
      throw new Error("invalid_sheets_client");
    if (allowRealWrites !== true) throw new Error("real_writes_not_allowed");
    this.kind = "sheets";
    this.sheets = sheetsClient;
  }

  // Reads data rows only (A2:AA), matching the mock client contract.
  async readAll(target) {
    assertTestTarget(target);
    const range = `${TEST_TARGET.sheet}!A2:AA`;
    const res = await this.sheets.readRange({ spreadsheetId: TEST_TARGET.spreadsheetId, range });
    const text = res?.result ?? res?.text ?? res;
    return parseReadRows(text).map(row => normalized(row.cells));
  }

  async write(target, offset, rows) {
    assertTestTarget(target);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid_offset");
    if (!Array.isArray(rows) || !rows.length) throw new Error("no_rows");
    if (rows.some(row => !Array.isArray(row) || row.length !== WIDTH)) throw new Error("invalid_row_width");
    const startRow = offset + 2;
    const endRow = startRow + rows.length - 1;
    const range = `${TEST_TARGET.sheet}!A${startRow}:AA${endRow}`;
    await this.sheets.writeRange({
      spreadsheetId: TEST_TARGET.spreadsheetId,
      range,
      values: rows.map(normalized),
      valueInputOption: "RAW",
    });
  }

  describe() { return { kind: "sheets", target: { ...TEST_TARGET } }; }
}

function createSheetsWriterAdapter(opts = {}) {
  const enabled = String(process.env.CONTROL_GASTOS_SHEETS_ADAPTER || "0").toLowerCase();
  if (enabled !== "1" && enabled !== "true") throw new Error("sheets_adapter_disabled");
  const prod = String(process.env.CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED || "false").toLowerCase();
  if (prod === "1" || prod === "true" || prod === "yes") throw new Error("production_write_must_remain_disabled");
  return new SheetsWriterClient(opts);
}

module.exports = { SheetsWriterClient, createSheetsWriterAdapter };
