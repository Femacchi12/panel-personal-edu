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
