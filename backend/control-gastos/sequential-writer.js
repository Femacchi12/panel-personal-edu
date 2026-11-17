"use strict";

// Single sequential writer for one fixed destination.
//
// The writer owns every Sheets write for the destination: inserts, splits and
// corrections. It accepts only an injected client that implements
// readAll(target)/write(target, offset, rows). There is no HTTP write path and
// no fallback client: if the client is not explicitly provided, nothing writes.
const { TEST_TARGET, STATUS } = require("./durable-queue");
const { MOVIMIENTOS_COLUMNS, normalizeMesPago } = require("./movimientos-writer");

const WIDTH = MOVIMIENTOS_COLUMNS.length; // 27 columns
const COLUMN_INDEX = Object.freeze(Object.fromEntries(MOVIMIENTOS_COLUMNS.map((name, i) => [name, i])));
const normalized = row => Array.from({ length: WIDTH }, (_, i) => String(row[i] ?? ""));
const equal = (a, b) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));

// UI field => Movimientos column. Restricted on purpose: a correction cannot
// rewrite ID, Fila origen or any accounting reference outside this map.
const PATCH_COLUMNS = Object.freeze({
  fecha_real: "Fecha real",
  concepto: "Descripción / Comercio",
  comercio: "Descripción / Comercio",
  descripcion: "Descripción original",
  importe: "Monto original",
  moneda: "Moneda original",
  categoria: "Categoría",
  subcategoria: "Subcategoría",
  titular: "Titular",
  cuenta: "Cuenta / Tarjeta",
  medio_pago: "Modalidad de pago",
  mes_pago: "Mes pago",
});
const AMOUNT_COLUMNS = Object.freeze({ monto_cop: "Monto COP", monto_ars: "Monto ARS", monto_usd: "Monto USD" });

function applyPatch(backupRow, patch) {
  const cells = normalized(backupRow);
  if (!patch || typeof patch !== "object") throw new Error("patch_required");
  for (const [key, value] of Object.entries(patch)) {
    if (key === "amounts") {
      if (!value || typeof value !== "object") throw new Error("invalid_patch_amounts");
      for (const [amountKey, amountValue] of Object.entries(value)) {
        const column = AMOUNT_COLUMNS[amountKey];
        if (!column) throw new Error("invalid_patch_field");
        cells[COLUMN_INDEX[column]] = String(amountValue ?? "");
      }
      continue;
    }
    const column = PATCH_COLUMNS[key];
    if (!column) throw new Error("invalid_patch_field");
    cells[COLUMN_INDEX[column]] = String(value ?? "");
  }
  if (patch.mes_pago) cells[COLUMN_INDEX["Mes pago"]] = normalizeMesPago(patch.mes_pago);
  if (!cells[COLUMN_INDEX["Estado"]]) cells[COLUMN_INDEX["Estado"]] = "Corregido";
  // Never let a patch rewrite identity columns; they come from the read row.
  cells[COLUMN_INDEX["ID"]] = normalized(backupRow)[COLUMN_INDEX["ID"]];
  cells[COLUMN_INDEX["Fila origen"]] = normalized(backupRow)[COLUMN_INDEX["Fila origen"]];
  return cells;
}

class SequentialWriter {
  constructor(queue, client) {
    if (!queue || typeof queue.claim !== "function") throw new Error("queue_required");
    if (!client || typeof client.readAll !== "function" || typeof client.write !== "function")
      throw new Error("writer_client_required");
    // Only the two known local client families are accepted. Sheets writes stay
    // behind SheetsWriterClient; nothing accepts an arbitrary object.
    if (client.kind !== "mock" && client.kind !== "sheets") throw new Error("unsupported_writer_client");
    this.queue = queue;
    this.sheets = client;
  }

  async runOne() {
    const claim = await this.queue.claim();
    if (!claim.ok) return claim;
    const { operation: op, claimId } = claim;
    let sheet;
    try { sheet = await this.sheets.readAll(TEST_TARGET); }
    catch (_) { return this.queue.finish(op.id, claimId, STATUS.CONFIRMED_FAILED, { reason: "read_failed_before_send" }); }
    const queuedRows = (op.rows || []).map(r => normalized(r.cells));
    const origins = queuedRows.map(r => r[20]);
    if (op.type !== "correction") {
      if (origins.some(x => !x) || new Set(origins).size !== origins.length ||
          (op.type === "insert" && origins[0] !== op.filaOrigen) ||
          (op.type === "split" && (queuedRows.length < 2 || origins.some((v, i) => v !== `${op.filaOrigen}#${i + 1}`)))) {
        return this.queue.finish(op.id, claimId, STATUS.NEEDS_INFORMATION, { reason: "invalid_origins" });
      }
    }
    let offset, backup = null, rows = queuedRows;
    if (op.type === "correction") {
      offset = op.rowNum - 2; // client rows are data rows only
      backup = sheet[offset] || null;
      if (!backup) return this.queue.finish(op.id, claimId, STATUS.NEEDS_INFORMATION, { reason: "correction_row_missing" });
      if (op.movId && normalized(backup)[0] !== String(op.movId))
        return this.queue.finish(op.id, claimId, STATUS.NEEDS_INFORMATION, { reason: "correction_mov_id_mismatch", backup });
      if (op.before && !equal(backup, op.before))
        return this.queue.finish(op.id, claimId, STATUS.NEEDS_INFORMATION, { reason: "correction_mismatch", backup });
      let after;
      if (op.patch) {
        try { after = applyPatch(backup, op.patch); }
        catch (e) { return this.queue.finish(op.id, claimId, STATUS.NEEDS_INFORMATION, { reason: e.message || "invalid_patch", backup }); }
      } else if (queuedRows.length === 1) {
        after = [...queuedRows[0]];
        if (!after[0] || after[0] !== normalized(backup)[0] || after[20] !== normalized(backup)[20])
          return this.queue.finish(op.id, claimId, STATUS.NEEDS_INFORMATION, { reason: "correction_mismatch", backup });
      } else {
        return this.queue.finish(op.id, claimId, STATUS.NEEDS_INFORMATION, { reason: "invalid_correction", backup });
      }
      rows = [normalized(after)];
    } else {
      const found = origins.filter(origin => sheet.some(r => r[20] === origin));
      if (found.length === origins.length)
        return this.queue.finish(op.id, claimId, STATUS.ALREADY_REGISTERED, { origins });
      if (found.length)
        return this.queue.finish(op.id, claimId, STATUS.UNCERTAIN, { reason: "partial_split", found });
      offset = sheet.length;
    }
    const maxId = sheet.reduce((n, row) => {
      const m = /^MOV-(\d+)$/.exec(row[0]);
      return m ? Math.max(n, Number(m[1])) : n;
    }, 0);
    let ids;
    try { ids = await this.queue.prepare(op.id, claimId, maxId, op.type === "correction" ? 0 : rows.length, { offset, rows, backup }); }
    catch (_) { return { ok: false, error: "prepare_failed_destination_blocked" }; }
    if (op.type !== "correction") rows.forEach((row, i) => { row[0] = ids[i]; });
    // Once intent is durable, any failure (including a failed readback) is
    // ambiguous and permanently blocks the destination. Never retry here.
    try {
      await this.sheets.write(TEST_TARGET, offset, rows);
      const readback = await this.sheets.readAll(TEST_TARGET);
      if (!rows.every((row, i) => readback[offset + i] && equal(row, readback[offset + i])))
        return this.queue.finish(op.id, claimId, STATUS.UNCERTAIN, { reason: "readback_mismatch", backup });
      return this.queue.finish(op.id, claimId, STATUS.COMMITTED,
        { ids: rows.map(r => r[0]), backup, verifiedColumns: WIDTH });
    } catch (_) {
      return this.queue.finish(op.id, claimId, STATUS.UNCERTAIN, { reason: "write_or_readback_ambiguous", backup });
    }
  }
}

module.exports = { SequentialWriter, applyPatch, normalized, equal, WIDTH };
