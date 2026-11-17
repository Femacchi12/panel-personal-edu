"use strict";

const crypto = require("crypto");
const { MOVIMIENTOS_COLUMNS, norm } = require("./validation");
const { nowIso, deepClone } = require("./storage");

const FINANCE_SS = "1ff_dT8kHhiy1THTq1hRHGx2z2VElUQjyq_A4AL_nm4g";
const PROD_SHEET = "Movimientos";

function isProdTarget(target) {
  const ss = norm(target?.spreadsheetId || target?.spreadsheet_id);
  const sh = norm(target?.sheet || target?.sheetName || "Movimientos");
  return ss === FINANCE_SS && sh === PROD_SHEET;
}

function productionWriteEnabled() {
  const v = String(process.env.CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED || "false").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function getFixedTestTarget() {
  const enforced = String(process.env.CONTROL_GASTOS_TEST_TARGET_ENFORCED || "0").toLowerCase();
  const id = norm(process.env.CONTROL_GASTOS_FIXED_TEST_SPREADSHEET_ID || process.env.CONTROL_GASTOS_SHEETS_TEST_SPREADSHEET_ID || "");
  const sheet = norm(process.env.CONTROL_GASTOS_FIXED_TEST_SHEET || process.env.CONTROL_GASTOS_SHEETS_TEST_SHEET || "Movimientos_Test");
  if ((enforced === "1" || enforced === "true") && id) return { spreadsheetId: id, sheet };
  return null;
}

function assertTargetAllowed(target, opts = {}) {
  const t = { spreadsheetId: norm(target?.spreadsheetId || target?.spreadsheet_id), sheet: norm(target?.sheet || target?.sheetName || "Movimientos") };
  const prod = isProdTarget(t);
  // Hard block: canonical Finanzas Edu Movimientos can never be written unless global production flag AND explicit per-op allow are both set.
  if (prod && !(productionWriteEnabled() && opts.allowProductionExplicit)) {
    return { ok: false, status: 403, error: "production_write_blocked", message: "Escritura en Finanzas Edu → Movimientos bloqueada (production_write_enabled=false / sin autorización explícita)." };
  }
  if (!t.spreadsheetId || !t.sheet) {
    return { ok: false, status: 400, error: "invalid_target", message: "Target de hoja inválido (spreadsheetId/sheet)." };
  }
  // Preprod/test enforcement: if a fixed TEST target is enforced, ONLY that exact target is allowed (client/env/request cannot substitute).
  const fixed = getFixedTestTarget();
  if (fixed) {
    if (t.spreadsheetId !== fixed.spreadsheetId || t.sheet !== fixed.sheet) {
      return { ok: false, status: 403, error: "target_not_allowed", message: "Destino no permitido en este entorno (solo hoja TEST autorizada)." };
    }
    if (prod) return { ok: false, status: 403, error: "production_write_blocked", message: "Destino canónico no permitido en entorno de prueba." };
  }
  return { ok: true, prod: isProdTarget(t), fixed: !!fixed };
}

function padMovId(n) { return `MOV-${String(n).padStart(5, "0")}`; }

function parseReadRows(readResultText) {
  const text = String(readResultText || "");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    if (/^(Successfully read|No data|Each line|Note:)/.test(line)) continue;
    const parts = line.split("\t");
    const rn = Number(parts[0]);
    if (!Number.isFinite(rn)) continue;
    rows.push({ rowNum: rn, cells: parts.slice(1) });
  }
  return rows;
}

function extractExistingState(rows) {
  let maxId = 0;
  const ids = new Set();
  const filaOrigen = new Set();
  for (const r of rows) {
    const c = r.cells;
    const id = norm(c[0]);
    const fo = norm(c[20]);
    if (id) ids.add(id);
    if (fo) filaOrigen.add(fo);
    const m = /^MOV-(\d+)$/.exec(id);
    if (m) maxId = Math.max(maxId, Number(m[1]));
  }
  return { maxId, ids, filaOrigen, dataRowCount: rows.length };
}

function toCell(col, value) {
  if (value == null || value === "") return "";
  if (["Monto original", "Monto COP", "Monto ARS", "Monto USD", "Cuotas", "N° cuota"].includes(col)) {
    const n = Number(value);
    if (Number.isFinite(n)) return String(n);
  }
  return String(value);
}

function buildRowValues(rowObj) {
  return MOVIMIENTOS_COLUMNS.map((c) => toCell(c, rowObj[c]));
}

function normalizeMesPago(v) {
  const s = norm(v);
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const ab = { "01":"ene","02":"feb","03":"mar","04":"abr","05":"may","06":"jun","07":"jul","08":"ago","09":"sep","10":"oct","11":"nov","12":"dic" };
    return `${ab[m[2]] || m[2]}-${m[1]}`;
  }
  return s;
}

function buildMovimientoRow(input, ctx = {}) {
  // ctx: { id, fecha_registrada, fila_origen, fuente, estado, observaciones_extra }
  const moneda = String(input.moneda || input.moneda_original || "COP").toUpperCase();
  const amounts = ctx.amounts || { monto_cop: input.monto_cop, monto_ars: input.monto_ars, monto_usd: input.monto_usd };
  const mesPago = normalizeMesPago(input.mes_pago || input.mes_consumo || "");
  const row = {
    "ID": norm(ctx.id),
    "Fecha registrada": norm(ctx.fecha_registrada || new Date().toISOString().slice(0,10)),
    "Fecha real": norm(input.fecha_real),
    "Mes consumo": norm(input.mes_consumo || (input.fecha_real ? String(input.fecha_real).slice(0,7) : "")),
    "Mes pago": mesPago,
    "Tipo": norm(input.tipo || "Gasto"),
    "Naturaleza": norm(input.naturaleza || "Gasto"),
    "Categoría": norm(input.categoria),
    "Subcategoría": norm(input.subcategoria),
    "Descripción / Comercio": norm(input.comercio || input.concepto),
    "Descripción original": norm(input.descripcion || input.descripcion_original || input.texto_original),
    "Monto original": input.importe,
    "Moneda original": moneda,
    "Cuenta / Tarjeta": norm(input.cuenta || input.cuenta_tarjeta),
    "Titular": norm(input.titular),
    "Cuotas": input.cuotas || "",
    "N° cuota": input.n_cuota || "",
    "Es fijo": input.es_fijo || "No",
    "Estado": norm(ctx.estado || "Registrado"),
    "Fuente": norm(ctx.fuente || "Dashboard Personal / Control de gastos"),
    "Fila origen": norm(ctx.fila_origen),
    "Observaciones": norm([input.notas, input.observaciones, ctx.observaciones_extra].filter(Boolean).join(" | ")),
    "Monto COP": amounts.monto_cop ?? "",
    "Monto ARS": amounts.monto_ars ?? "",
    "Monto USD": amounts.monto_usd ?? "",
    "Modalidad de pago": norm(input.medio_pago || input.modalidad_pago),
    "Ámbito": norm(input.ambito || "Personal"),
  };
  return row;
}

class MovimientosWriter {
  constructor({ sheetsClient, store, lockTtlMs = 120000 } = {}) {
    // sheetsClient: async { readRange({spreadsheetId, range}), writeRange({spreadsheetId, range, values, valueInputOption}), append? }
    this.sheets = sheetsClient;
    this.store = store;
    this.lockTtlMs = lockTtlMs;
  }

  async _acquireLock(targetKey) {
    // Coordination lock. Prefer store-atomic acquire when available (Firestore transaction) for multi-instance Cloud Run safety.
    if (!this.store) return { ok: true, lockId: "nolock" };
    const lockKey = `sheet_lock:${targetKey}`;
    if (typeof this.store.acquireIdempotencyLock === "function") {
      const r = await this.store.acquireIdempotencyLock(lockKey, { ttlMs: this.lockTtlMs, holder: "movimientos-writer" });
      if (!r.ok) return { ...r, message: r.message || "Otra operación de escritura está en curso (lock activo). Reintenta." };
      return { ok: true, lockKey, lock: r.lock };
    }
    const now = Date.now();
    const existing = await this.store.getIdempotency(lockKey);
    if (existing && existing.expiresAt && now < existing.expiresAt) {
      return { ok: false, status: 409, error: "concurrency_locked", message: "Otra operación de escritura está en curso (lock activo). Reintenta.", lock: existing };
    }
    const lock = { lockId: crypto.randomUUID(), at: nowIso(), expiresAt: now + this.lockTtlMs, holder: "movimientos-writer" };
    await this.store.setIdempotency(lockKey, lock);
    return { ok: true, lockKey, lock };
  }

  async _releaseLock(acq) {
    if (!this.store || !acq?.lockKey) return;
    // Never release with a non-atomic read/write: a newer holder may have
    // acquired the expired lease between those operations.
    if (typeof this.store.releaseIdempotencyLock === "function")
      await this.store.releaseIdempotencyLock(acq.lockKey, acq.lock.lockId);
  }

  async _reserveFilaOrigen(targetKey, filaOrigen, opKey) {
    // Pre-write reservation to prevent duplicates and support reconciliation after ambiguous outcomes.
    if (!this.store || !filaOrigen) return { ok: true, reserved: false };
    const k = `fo_reservation:${targetKey}:${filaOrigen}`;
    if (typeof this.store.reserveIdempotencyKey === "function") {
      const r = await this.store.reserveIdempotencyKey(k, { ttlMs: this.lockTtlMs, opKey, meta: { filaOrigen } });
      return { ...r, key: k };
    }
    const existing = await this.store.getIdempotency(k);
    if (existing && existing.status === "committed") {
      return { ok: false, error: "duplicate_fila_origen_reserved", status: "committed", reservation: existing };
    }
    if (existing && existing.status === "reserved" && existing.expiresAt && Date.now() < existing.expiresAt && existing.opKey !== opKey) {
      return { ok: false, error: "fila_origen_inflight", reservation: existing };
    }
    const rec = { status: "reserved", filaOrigen, opKey, at: nowIso(), expiresAt: Date.now() + this.lockTtlMs };
    await this.store.setIdempotency(k, rec);
    return { ok: true, reserved: true, key: k, reservation: rec };
  }

  async _commitFilaOrigen(targetKey, filaOrigen, extra = {}) {
    if (!this.store || !filaOrigen) return;
    const k = `fo_reservation:${targetKey}:${filaOrigen}`;
    await this.store.setIdempotency(k, { status: "committed", filaOrigen, at: nowIso(), ...extra });
  }

  async readExisting(target) {
    const range = `${target.sheet}!A1:AA`;
    const res = await this.sheets.readRange({ spreadsheetId: target.spreadsheetId, range });
    const text = res?.result ?? res?.text ?? res;
    const rows = parseReadRows(text);
    const header = rows.length ? rows[0] : null;
    const dataRows = rows.length > 1 ? rows.slice(1) : [];
    return { header, dataRows, state: extractExistingState(dataRows), raw: text };
  }

  async appendMovimientos({ target, rows, allowProductionExplicit = false, dedupeByFilaOrigen = true, idPrefix = "MOV" }) {
    const guard = assertTargetAllowed(target, { allowProductionExplicit });
    if (!guard.ok) return guard;
    // Sheets cannot fence a delayed request after a lease expires. Until the
    // durable single-writer protocol is implemented, fail closed for all targets.
    return { ok: false, status: 503, error: "serialized_writer_not_ready", message: "Escrituras suspendidas hasta completar la serialización segura por destino." };
    /* Legacy implementation retained for migration; not a safe failover protocol.
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, status: 400, error: "no_rows" };

    const targetKey = `${target.spreadsheetId}:${target.sheet}`;
    const lock = await this._acquireLock(targetKey);
    if (!lock.ok) return lock;
    try {
      const existing = await this.readExisting(target);
      const prepared = [];
      const skipped = [];
      let nextIdNum = existing.state.maxId;
      const opKey = crypto.randomUUID();
      for (const r of rows) {
        const fo = norm(r["Fila origen"]);
        if (!fo) { skipped.push({ reason: "missing_fila_origen", row: r }); continue; }
        if (dedupeByFilaOrigen && existing.state.filaOrigen.has(fo)) {
          skipped.push({ reason: "duplicate_fila_origen", fila_origen: fo, id: r.ID || null });
          continue;
        }
        if (dedupeByFilaOrigen) {
          const resv = await this._reserveFilaOrigen(targetKey, fo, opKey);
          if (!resv.ok) { skipped.push({ reason: resv.error || "duplicate_or_inflight", fila_origen: fo }); continue; }
        }
        let id = norm(r.ID);
        if (!id) {
          nextIdNum += 1;
          id = padMovId(nextIdNum);
        } else {
          const m = /^MOV-(\d+)$/.exec(id);
          if (m) nextIdNum = Math.max(nextIdNum, Number(m[1]));
        }
        if (existing.state.ids.has(id)) {
          nextIdNum += 1;
          id = padMovId(nextIdNum);
        }
        const rowObj = { ...r, ID: id, "Fila origen": fo };
        prepared.push(rowObj);
        existing.state.ids.add(id);
        existing.state.filaOrigen.add(fo);
      }

      if (prepared.length === 0) {
        return { ok: true, status: 200, appended: 0, skipped, verified: true, idempotent: skipped.length > 0, rows: [], note: "Nada que insertar (dedupe/idempotencia)." };
      }

      // Append at end based on current read. Lock+reservation reduce race; readback and Fila-origen reconciliation protect against ambiguity.
      const nextRowNum = 1 + existing.dataRows.length + 1;
      const endRowNum = nextRowNum + prepared.length - 1;
      const range = `${target.sheet}!A${nextRowNum}:AA${endRowNum}`;
      const values = prepared.map(buildRowValues);
      let writeRes = null, writeErr = null;
      try {
        writeRes = await this.sheets.writeRange({ spreadsheetId: target.spreadsheetId, range, values, valueInputOption: "RAW" });
      } catch (e) {
        writeErr = e;
      }

      // Mandatory readback/verification (also reconciliation path for ambiguous failures)
      let rbRows = [], rbText = "";
      try {
        const rb = await this.sheets.readRange({ spreadsheetId: target.spreadsheetId, range });
        rbText = rb?.result ?? rb?.text ?? rb;
        rbRows = parseReadRows(rbText);
      } catch (_) {}

      let verified = rbRows.length === prepared.length && rbRows.every((rr, i) => norm(rr.cells[0]) === norm(prepared[i].ID) && norm(rr.cells[20]) === norm(prepared[i]["Fila origen"]));

      // Ambiguous/error case: if write errored or readback not matching, reconcile by searching for Fila origen in sheet (handles "accepted but client failed before confirm")
      if (!verified && dedupeByFilaOrigen) {
        try {
          const all = await this.readExisting(target);
          const foundFO = new Set(prepared.map(p => norm(p["Fila origen"])));
          const present = (all.dataRows || []).filter(r => foundFO.has(norm((r.cells || [])[20]))).map(r => ({ rowNum: r.rowNum, ID: (r.cells||[])[0], "Fila origen": (r.cells||[])[20] }));
          if (present.length === prepared.length) {
            verified = true; // reconciled as committed (avoid duplicate retry)
            writeErr = null;
          }
        } catch (_) {}
      }

      if (verified) {
        for (const p of prepared) await this._commitFilaOrigen(targetKey, norm(p["Fila origen"]), { opKey, id: p.ID, range });
      }

      const result = {
        ok: verified,
        status: verified ? 200 : 500,
        target: { spreadsheetId: target.spreadsheetId, sheet: target.sheet, range },
        appended: prepared.length,
        skipped,
        rows: prepared.map(r => ({ ID: r.ID, "Fila origen": r["Fila origen"], "Fecha real": r["Fecha real"], "Descripción / Comercio": r["Descripción / Comercio"], "Monto original": r["Monto original"], "Moneda original": r["Moneda original"] })),
        write_result: writeRes,
        write_error: writeErr ? String(writeErr && (writeErr.message || writeErr)) : null,
        readback: { count: rbRows.length, verified },
        production_target: guard.prod,
        applied_to_production: guard.prod && verified,
      };
      if (!verified) result.error = writeErr ? "write_or_network_error_unverified" : "readback_verification_failed";
      return result;
    } finally {
      await this._releaseLock(lock);
    }
    */
  }

  async backupRowRange({ target, rowNum }) {
    const range = `${target.sheet}!A${rowNum}:AA${rowNum}`;
    const res = await this.sheets.readRange({ spreadsheetId: target.spreadsheetId, range });
    const text = res?.result ?? res?.text ?? res;
    const rows = parseReadRows(text);
    const cells = rows.length ? rows[0].cells : [];
    const obj = {};
    MOVIMIENTOS_COLUMNS.forEach((c, i) => { obj[c] = cells[i] ?? ""; });
    return { range, rowNum, row: obj, raw: text, backed_up_at: nowIso() };
  }

  async applyCorrectionWrite({ target, rowNum, changes, before, allowProductionExplicit = false }) {
    const guard = assertTargetAllowed(target, { allowProductionExplicit });
    if (!guard.ok) return guard;
    return { ok: false, status: 503, error: "serialized_writer_not_ready", message: "Correcciones suspendidas hasta completar la serialización segura por destino." };
    /* Legacy implementation retained for migration; not a safe failover protocol.
    if (!Number.isFinite(Number(rowNum)) || Number(rowNum) < 2) return { ok: false, status: 400, error: "invalid_row_num" };

    const targetKey = `${target.spreadsheetId}:${target.sheet}:row:${rowNum}`;
    const lock = await this._acquireLock(targetKey);
    if (!lock.ok) return lock;
    try {
      const backup = await this.backupRowRange({ target, rowNum });
      // safety: if 'before' provided, ensure it matches key fields to avoid wrong-row overwrite
      if (before && typeof before === "object") {
        const mismatch = [];
        for (const k of ["ID", "Fila origen"]) {
          if (norm(before[k]) && norm(backup.row[k]) && norm(before[k]) !== norm(backup.row[k])) mismatch.push(k);
        }
        if (mismatch.length) return { ok: false, status: 409, error: "row_mismatch", mismatch, backup };
      }
      const updated = { ...backup.row };
      // map editable field names from UI to column names
      const map = {
        fecha_real: "Fecha real", concepto: "Descripción / Comercio", comercio: "Descripción / Comercio", descripcion: "Descripción original",
        importe: "Monto original", moneda: "Moneda original", categoria: "Categoría", subcategoria: "Subcategoría", titular: "Titular",
        cuenta: "Cuenta / Tarjeta", medio_pago: "Modalidad de pago", mes_pago: "Mes pago"
      };
      for (const [k, v] of Object.entries(changes || {})) {
        const col = map[k] || k;
        if (MOVIMIENTOS_COLUMNS.includes(col)) updated[col] = v;
      }
      if (changes.mes_pago) updated["Mes pago"] = normalizeMesPago(changes.mes_pago);
      updated["Estado"] = norm(updated["Estado"]) || "Corregido";
      // preserve ID/Fila origen
      updated["ID"] = backup.row["ID"];
      updated["Fila origen"] = backup.row["Fila origen"];

      const range = `${target.sheet}!A${rowNum}:AA${rowNum}`;
      const values = [buildRowValues(updated)];
      const writeRes = await this.sheets.writeRange({ spreadsheetId: target.spreadsheetId, range, values, valueInputOption: "RAW" });
      const rb = await this.sheets.readRange({ spreadsheetId: target.spreadsheetId, range });
      const rbText = rb?.result ?? rb?.text ?? rb;
      const rbRows = parseReadRows(rbText);
      const verified = rbRows.length === 1 && norm(rbRows[0].cells[0]) === norm(updated["ID"]);

      const afterObj = {};
      if (rbRows.length) MOVIMIENTOS_COLUMNS.forEach((c, i) => { afterObj[c] = rbRows[0].cells[i] ?? ""; });
      return {
        ok: verified,
        status: verified ? 200 : 500,
        target: { spreadsheetId: target.spreadsheetId, sheet: target.sheet, range },
        rowNum,
        backup,
        changes,
        write_result: writeRes,
        readback: { verified, row: afterObj },
        applied_to_production: guard.prod && verified,
        error: verified ? null : "readback_verification_failed",
      };
    } finally {
      await this._releaseLock(lock);
    }
    */
  }
}

module.exports = {
  MovimientosWriter,
  buildMovimientoRow,
  buildRowValues,
  assertTargetAllowed,
  isProdTarget,
  productionWriteEnabled,
  FINANCE_SS,
  PROD_SHEET,
  MOVIMIENTOS_COLUMNS,
  parseReadRows,
  extractExistingState,
  normalizeMesPago,
};
