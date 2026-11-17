"use strict";

// Adaptador que permite al escritor secuencial usar el cliente real de Google
// Sheets v4. Deliberadamente estrecho: expone solo readAll/write y valida que
// el destino de cada operación sea EXACTAMENTE el destino configurado en el
// constructor (TEST por defecto; canónico solo con target explícito y
// escrituras productivas habilitadas por env).
//
// No se conecta a rutas HTTP: el consumidor secuencial es el único que lo usa,
// con lease de exclusividad. La fábrica (createSheetsWriterAdapter) exige
// habilitación explícita por env y está pensada solo para entornos controlados.
const { TEST_TARGET } = require("./durable-queue");
const { parseReadRows } = require("./movimientos-writer");
const { normalized, WIDTH } = require("./sequential-writer");
const { FINANCE_SS, PROD_SHEET } = require("./movimientos-writer");

const CANONICAL_TARGET = Object.freeze({ spreadsheetId: FINANCE_SS, sheet: PROD_SHEET });

function makeAssertTarget(configured) {
  return target => {
    if (!target || target.spreadsheetId !== configured.spreadsheetId || target.sheet !== configured.sheet)
      throw new Error("target_rejected");
  };
}

class SheetsWriterClient {
  constructor({ sheetsClient, allowRealWrites = false, target = null } = {}) {
    if (!sheetsClient || typeof sheetsClient.readRange !== "function" || typeof sheetsClient.writeRange !== "function")
      throw new Error("invalid_sheets_client");
    if (allowRealWrites !== true) throw new Error("real_writes_not_allowed");
    // Destino único por instancia del adaptador: TEST (default) o canónico
    // explícito. Nunca ambos; cada operación se valida contra este destino.
    const isCanonical = String(process.env.CONTROL_GASTOS_CANONICAL_CONSUMER || "") === "1" &&
      String(process.env.CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED || "").toLowerCase() === "true";
    if (target && target.canonical === true) {
      if (!isCanonical) throw new Error("canonical_consumer_disabled");
      this.target = CANONICAL_TARGET;
    } else {
      this.target = { ...TEST_TARGET };
    }
    this.assertTarget = makeAssertTarget(this.target);
    this.kind = "sheets";
    this.sheets = sheetsClient;
  }

  // Reads data rows only (A2:AA), matching the mock client contract.
  async readAll(target) {
    this.assertTarget(target);
    const range = `${this.target.sheet}!A2:AA`;
    const res = await this.sheets.readRange({ spreadsheetId: this.target.spreadsheetId, range });
    const text = res?.result ?? res?.text ?? res;
    return parseReadRows(text).map(row => normalized(row.cells));
  }

  async write(target, offset, rows) {
    this.assertTarget(target);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid_offset");
    if (!Array.isArray(rows) || !rows.length) throw new Error("no_rows");
    if (rows.some(row => !Array.isArray(row) || row.length !== WIDTH)) throw new Error("invalid_row_width");
    const startRow = offset + 2;
    const endRow = startRow + rows.length - 1;
    const range = `${this.target.sheet}!A${startRow}:AA${endRow}`;
    await this.sheets.writeRange({
      spreadsheetId: this.target.spreadsheetId,
      range,
      values: rows.map(normalized),
      valueInputOption: "RAW",
    });
  }

  describe() { return { kind: "sheets", target: { ...this.target } }; }
}

function createSheetsWriterAdapter(opts = {}) {
  const enabled = String(process.env.CONTROL_GASTOS_SHEETS_ADAPTER || "0").toLowerCase();
  if (enabled !== "1" && enabled !== "true") throw new Error("sheets_adapter_disabled");
  const prod = String(process.env.CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED || "false").toLowerCase();
  if (prod === "1" || prod === "true" || prod === "yes") throw new Error("production_write_must_remain_disabled");
  return new SheetsWriterClient(opts);
}

module.exports = { SheetsWriterClient, createSheetsWriterAdapter, CANONICAL_TARGET };
