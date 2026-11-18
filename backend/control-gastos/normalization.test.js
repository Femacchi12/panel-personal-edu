"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const admin = require("firebase-admin");
const { DurableQueue } = require("./durable-queue");
const { MockSheetsClient } = require("./mock-sequential-worker");
const { SequentialWriter } = require("./sequential-writer");

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing to run without Firestore emulator");
admin.initializeApp({ projectId: "demo-control-gastos-local" });
const db = admin.firestore();

test("normalización semántica del readback acepta fechas/montos con formato (hoja real)", async () => {
  const q = new DurableQueue(db, `test_${crypto.randomBytes(6).toString("hex")}`);
  const row = origin => { const r = Array(27).fill(""); r[1] = "2026-11-14"; r[2] = "2026-11-14"; r[9] = "concepto"; r[11] = "32700"; r[12] = "COP"; r[20] = origin; return r; };
  await q.enqueue({ operationKey: "norm-1", filaOrigen: "NORM:1", type: "insert", rows: [row("NORM:1")], confirmed: true });
  // Readback que simula UNFORMATTED_VALUE en hoja con formatos: fechas como
  // serial de Sheets y montos como número — el escritor debe igualar semánticamente.
  class FormattedMock extends MockSheetsClient {
    async readAll(target) {
      const rows = await super.readAll(target);
      const serial = d => (/^\d{4}-\d{2}-\d{2}$/.test(d)
        ? String(Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000))
        : d);
      return rows.map(r => { const c = [...r]; c[1] = serial(c[1]); c[2] = serial(c[2]); c[11] = String(Number(c[11])); return c; });
    }
  }
  const result = await new SequentialWriter(q, new FormattedMock()).runOne();
  assert.equal(result.status, "COMMITTED", "la normalización semántica evita el falso UNCERTAIN");
});
