"use strict";

// Production-safety regression: no fixtures, no Sheets writer and no financial
// write path may exist when running against a real project (preprod/prod).
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const service = require("./service");
const { maybeConfigureControlledWriter } = require("./index");
const { createRouter } = require("./routes");
const { MemoryStore } = require("./storage");
const auth = require("./device-auth");

function withEnv(env, fn) {
  const saved = { ...env }; // copy of entries we touch
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

test("regla de efectivo: titular Común por defecto, obligatorio en tarjetas", async () => {
  await withEnv({ GCLOUD_PROJECT: "demo-control-gastos-local" }, async () => {
    const validation = require("./validation");
    const cash = validation.validatePendingResolution({ fecha_real: "2026-11-18", concepto: "Gasto efectivo", importe: 5000, moneda: "COP", categoria: "Supermercado", cuenta: "Efectivo", medio_pago: "Efectivo" });
    assert.equal(cash.ok, true, "efectivo sin titular es válido (Común)");
    assert.ok((cash.input ? cash.input.titular : null) !== "Edu", "no infiere Edu");
    const card = validation.validatePendingResolution({ fecha_real: "2026-11-18", concepto: "Gasto tarjeta", importe: 5000, moneda: "COP", categoria: "Supermercado", cuenta: "Nu Edu", medio_pago: "Crédito" });
    assert.equal(card.ok, false, "tarjeta sin titular sigue siendo obligatorio");
    assert.ok(card.errors.some(e => e.includes("titular")));
    const cardOk = validation.validatePendingResolution({ fecha_real: "2026-11-18", concepto: "Gasto tarjeta", importe: 5000, moneda: "COP", titular: "Rocío", categoria: "Supermercado", cuenta: "Nu Ro", medio_pago: "Débito" });
    assert.equal(cardOk.ok, true);
  });
});

test("fixtures stay off for real projects, on only for explicit local contexts", async () => {
  await withEnv({ GCLOUD_PROJECT: "panel-personal-cg-preprod" }, async () => {
    assert.equal(service.fixturesEnabled("memory"), false);
    assert.equal(service.fixturesEnabled("firestore"), false);
  });
  await withEnv({ GCLOUD_PROJECT: "demo-control-gastos-local" }, async () => {
    assert.equal(service.fixturesEnabled("memory"), true);
    assert.equal(service.fixturesEnabled("firestore"), false);
    process.env.CONTROL_GASTOS_SEED_TEST = "1";
    assert.equal(service.fixturesEnabled("firestore"), true);
    delete process.env.CONTROL_GASTOS_SEED_TEST;
    process.env.CONTROL_GASTOS_FIXTURES = "0";
    assert.equal(service.fixturesEnabled("memory"), false);
    delete process.env.CONTROL_GASTOS_FIXTURES;
  });
});

test("production status reports apply disabled and identified empty state", async () => {
  await withEnv({ GCLOUD_PROJECT: "panel-personal-cg-preprod", CONTROL_GASTOS_STORE: "firestore", CONTROL_GASTOS_SEED_TEST: "0" }, async () => {
    const store = new MemoryStore({ syncState: { lastSyncAt: null, pendingSyncCount: 0, status: "unknown", source: "firestore" } });
    const status = await service.getStatus(store);
    assert.equal(status.fixtures, false);
    assert.equal(status.apply_financiero_enabled, false);
    assert.equal(status.production_write_enabled, false);
    assert.equal(status.counts.pendings, 0);
    assert.equal(status.sync.status, "sin_sincronizacion");
    const text = status.notes.join(" ");
    assert.match(text, /Aplicar financiero deshabilitado/);
    assert.match(text, /estado vacío identificado/);
    assert.doesNotMatch(text, /Los 5 pendientes/);
  });
});

test("no Sheets writer is configured while production writes are disabled", async () => {
  await withEnv({
    GCLOUD_PROJECT: "panel-personal-cg-preprod",
    CONTROL_GASTOS_SHEETS_MODE: "google",
    CONTROL_GASTOS_SHEETS_TEST_SPREADSHEET_ID: "1nB7Qc8hBnipTemceTEQeNZqteRhRULAZJwM9Js01GUY",
    CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED: "false"
  }, async () => {
    let captured = null;
    const original = service.configureControlledWrites;
    service.configureControlledWrites = (opts) => { captured = opts; return original(opts); };
    try {
      maybeConfigureControlledWriter(new MemoryStore({}));
    } finally { service.configureControlledWrites = original; }
    assert.equal(captured?.writer ?? null, null);
    assert.equal(captured?.target ?? null, null);
  });
});

test("pending financial apply fails closed without the isolated queue", async () => {
  const store = new MemoryStore({ pendings: [{ id: "cgtest_prod", message_key: "CGTEST:prod", datos_interpretados: {}, motivo_ambiguedad: [] }] });
  const app = express(); app.use(express.json());
  const authUser = (req, res, next) => { if (req.headers.authorization !== "Bearer synthetic") return res.sendStatus(401); req.user = { email: auth.AR_EMAIL }; next(); };
  app.use("/api/control-gastos", createRouter({ store, queue: null, requireAuthorizedUser: authUser }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/control-gastos/pendings/cgtest_prod/apply`,
      { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer synthetic" }, body: JSON.stringify({ approved: true, confirm: true }) });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "isolated_queue_unavailable");
    // The pending item is never mutated by a failed apply.
    assert.equal((await store.getPendings())[0].estado_sincronizacion, undefined);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("daily sync merge preserves dashboard review decisions", async () => {
  await withEnv({ GCLOUD_PROJECT: "demo-control-gastos-local" }, async () => {
    const store = new MemoryStore({});
    const base = { id: "pend_rev_1", message_key: "KEY:rev1", estado_sincronizacion: "pendiente_validacion", estado_validacion: "pendiente", datos_interpretados: { concepto: "D" } };
    await store.upsertPending({ ...base, revision: { input: { titular: "Edu" }, estado_validacion: "en_revision", registrada: false }, estado_validacion: "en_revision" });
    const incoming = { pendings: [{ ...base, estado_sincronizacion: "pendiente_validacion", estado_validacion: "clasificado_preliminar", datos_interpretados: { concepto: "D", importe: 32700, moneda: "COP" } }] };
    const r = await service.ingestSync(store, incoming, { email: auth.AR_EMAIL }, { authType: "device_sync" });
    assert.equal(r.ok, true);
    const saved = (await store.getPendings()).find(p => p.message_key === "KEY:rev1");
    assert.equal(saved.revision.input.titular, "Edu", "la revision guardada sobrevive a la sync diaria");
    assert.equal(saved.estado_validacion, "en_revision");
    assert.equal(saved.datos_interpretados.importe, 32700, "los datos nuevos del mensaje se conservan");
    assert.equal(saved.estado_sincronizacion, "pendiente_validacion");
  });
});

test("initial sync payload is AR-only, private-sourced, served once and maps pilot states", async () => {
  await withEnv({ GCLOUD_PROJECT: "panel-personal-cg-preprod", CONTROL_GASTOS_STORE: "firestore", CONTROL_GASTOS_SEED_TEST: "0" }, async () => {
    const store = new MemoryStore({ syncState: { status: "sin_sincronizacion" } });
    const app = express(); app.use(express.json());
    const authUser = (req, res, next) => { if (req.headers.authorization !== "Bearer synthetic") return res.sendStatus(401); req.user = { email: auth.AR_EMAIL }; next(); };
    app.use("/api/control-gastos", createRouter({ store, requireAuthorizedUser: authUser }));
    const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    try {
      const get = path => fetch(`http://127.0.0.1:${server.address().port}/api/control-gastos${path}`, { headers: { authorization: "Bearer synthetic" } });
      // Sin payload sembrado en el espacio privado: 404 (no se usa el repositorio publico)
      const unseeded = await get("/sync/initial-payload");
      assert.equal(unseeded.status, 404);
      // Siembra privada (replica lo que se escribio en Firestore con identidad autorizada)
      const { FIVE_PENDING } = require("./fixtures");
      const stagedPendings = FIVE_PENDING.map(x => ({ ...x, estado_sincronizacion: "pendiente_validacion", estado_piloto_original: x.estado_sincronizacion }));
      await store.setPrivate("initial_sync", { pendings: stagedPendings, status: "sincronizado", source: "hermes_local_initial", pendingSyncCount: 0 });
      const prep = await (await get("/sync/initial-payload")).json();
      assert.equal(prep.ok, true);
      assert.equal(prep.payload.pendings.length, 5);
      assert.equal(new Set(prep.payload.pendings.map(p => p.id)).size, 5, "ids únicos");
      assert.equal(new Set(prep.payload.pendings.map(p => p.message_key)).size, 5);
      prep.payload.pendings.forEach(p => {
        assert.equal(p.estado_sincronizacion, "pendiente_validacion", "los 5 se presentan como pendientes de validación");
        assert.ok(["simulado", "pendiente_validacion"].includes(p.estado_piloto_original), "estado del piloto preservado");
      });
      // Doble ejecución: con pendientes existentes el endpoint niega (409)
      await store.saveState({ ...await store.getState(), pendings: prep.payload.pendings, syncState: { status: "sincronizado" } });
      const again = await get("/sync/initial-payload");
      assert.equal(again.status, 409);
      // Sin usuario AR: prohibido
      const noAr = await fetch(`http://127.0.0.1:${server.address().port}/api/control-gastos/sync/initial-payload`, { headers: { authorization: "Bearer synthetic-noar" } });
      assert.equal(noAr.status, 401);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});

test("saved review keeps originals intact, validates catalogs, audits and never registers", async () => {
  await withEnv({ GCLOUD_PROJECT: "panel-personal-cg-preprod", CONTROL_GASTOS_STORE: "firestore", CONTROL_GASTOS_SEED_TEST: "0" }, async () => {
    const pend = { id: "pend_rev_1", message_key: "KEY:rev1", estado_sincronizacion: "pendiente_validacion", estado_validacion: "pendiente",
      datos_interpretados: { fecha_real: "2026-11-14", concepto: "[owner reply] D", texto_original: "D1 $32.700", importe: 32700, moneda: "COP" },
      motivo_ambiguedad: ["No se identificó persona (Edu/Rocío/Pía)"] };
    const store = new MemoryStore({ pendings: [pend] });
    const app = express(); app.use(express.json());
    const authUser = (req, res, next) => { if (req.headers.authorization !== "Bearer synthetic") return res.sendStatus(401); req.user = { email: auth.AR_EMAIL }; next(); };
    app.use("/api/control-gastos", createRouter({ store, requireAuthorizedUser: authUser }));
    const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    try {
      const call = (path, body) => fetch(`http://127.0.0.1:${server.address().port}/api/control-gastos${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer synthetic" }, body: JSON.stringify(body || {}) });
      // Campos inválidos: rechaza sin mutar
      const bad = await (await call("/pendings/pend_rev_1/review", { categoria: "No existe" })).json();
      assert.equal(bad.error, "invalid");
      // Guardado correcto
      const ok = await (await call("/pendings/pend_rev_1/review", { titular: "Edu", categoria: "Supermercado", subcategoria: "Otros", cuenta: "Efectivo", medio_pago: "Efectivo", concepto: "D (compra supermercado)", notas: "Confirmado por WhatsApp" })).json();
      assert.equal(ok.ok, true);
      const saved = (await store.getPendings())[0];
      // Originales intactos
      assert.equal(saved.datos_interpretados.concepto, "[owner reply] D");
      assert.equal(saved.datos_interpretados.importe, 32700);
      assert.equal(saved.estado_sincronizacion, "pendiente_validacion");
      // Decision guardada como revision con Antes/Despues
      assert.equal(saved.estado_validacion, "en_revision");
      assert.equal(saved.revision.registrada, false);
      assert.equal(saved.revision.input.titular, "Edu");
      assert.equal(saved.revision.comparison.diff.titular.despues, "Edu");
      const audits = await store.listAudits(5);
      assert.ok(audits.some(a => a.type === "pending_review_saved"));
      // Importe invalido: rechazado
      const badAmount = await (await call("/pendings/pend_rev_1/review", { importe: -5 })).json();
      assert.equal(badAmount.error, "invalid");
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});

test("mountControlGastos boots safely with production-like env (memory store, no writer, no fixtures)", async () => {
  await withEnv({ GCLOUD_PROJECT: "panel-personal-cg-preprod", CONTROL_GASTOS_STORE: "memory", CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED: "false" }, async () => {
    const { mountControlGastos } = require("./index");
    const app = express(); app.use(express.json());
    const authUser = (req, res, next) => { req.user = { email: auth.AR_EMAIL }; next(); };
    mountControlGastos(app, authUser);
    const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/control-gastos/status`);
      const status = await res.json();
      assert.equal(res.status, 200);
      assert.equal(status.fixtures, false);
      assert.equal(status.production_write_enabled, false);
      assert.equal(status.apply_financiero_enabled, false);
      assert.equal(status.counts.pendings, 0, "no synthetic data in a production-like boot");
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});
