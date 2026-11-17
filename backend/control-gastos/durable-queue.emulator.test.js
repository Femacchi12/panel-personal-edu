"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const { DurableQueue } = require("./durable-queue");
const { FirestoreStore } = require("./storage");
const auth = require("./device-auth");
const { MockSheetsClient, MockSequentialWorker } = require("./mock-sequential-worker");
const express = require("express");
const { createRouter } = require("./routes");
const { MemoryStore } = require("./storage");
const { GoogleSheetsClient } = require("./sheets-google-client");
const { SheetsWriterClient, createSheetsWriterAdapter } = require("./sheets-writer-adapter");
const { SequentialWriter } = require("./sequential-writer");

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing to run without Firestore emulator");
admin.initializeApp({ projectId:"demo-control-gastos-local" });
const db = getFirestore();

test("private KV store contract is identical in Memory and Firestore stores", async () => {
  const prefix = `test_${crypto.randomBytes(6).toString("hex")}`;
  const payload = { pendings: [{ id: "p1", message_key: "k1", datos_interpretados: { importe: 100 } }], status: "sincronizado" };
  // MemoryStore
  const mem = new MemoryStore({});
  await mem.setPrivate("initial_sync", payload);
  assert.deepEqual(await mem.getPrivate("initial_sync"), payload);
  // FirestoreStore contra el emulador (mismo codigo que produccion)
  const fsStore = new FirestoreStore({ prefix, databaseId: "(default)" });
  await fsStore.setPrivate("initial_sync", payload);
  assert.deepEqual(await fsStore.getPrivate("initial_sync"), payload);
  assert.equal(await fsStore.getPrivate("inexistente"), null);
  // El documento queda envuelto { value, updated_at } (compatible con la siembra REST)
  const raw = await fsStore.doc("private", "initial_sync").get();
  assert.ok(raw.data().value && raw.data().updated_at);
});

test("persistent queue orders, deduplicates and never steals a claim", async () => {
  const q = new DurableQueue(db, `test_${crypto.randomBytes(6).toString("hex")}`);
  const row = Array(27).fill("");
  const op = { operationKey:"a", filaOrigen:"origin-a", type:"insert", rows:[row], confirmed:true };
  const [a, b] = await Promise.all([q.enqueue(op), q.enqueue({ ...op, operationKey:"b", filaOrigen:"origin-b" })]);
  assert.deepEqual([a.sequence,b.sequence].sort(), [1,2]);
  assert.equal((await q.enqueue(op)).duplicate, true);
  const sameOrigin = await q.enqueue({ ...op, operationKey:"different-key" });
  assert.equal(sameOrigin.reason, "fila_origen_exists");
  assert.equal(sameOrigin.id, a.id);
  await assert.rejects(q.enqueue({ ...op, filaOrigen:"different" }), /idempotency_conflict/);
  await assert.rejects(q.enqueue({ ...op, operationKey:"bad", rows:[Array(26)] }), /invalid_confirmed_operation/);
  const claims = await Promise.all([q.claim(), q.claim()]);
  assert.equal(claims.filter(x=>x.ok).length, 1);
  const claimed = claims.find(x=>x.ok);
  assert.equal(claimed.operation.sequence, 1);
  await assert.rejects(q.markUncertain(claimed.operation.id, "old-claim", "timeout"), /stale_claim/);
  await assert.rejects(q.markUncertain(claimed.operation.id, claimed.claimId, ""), /evidence_required/);
  assert.equal((await q.markUncertain(claimed.operation.id, claimed.claimId, "synthetic ambiguous result")).status, "MANUAL_REVIEW");
  assert.equal((await q.getOperation(claimed.operation.id)).status, "MANUAL_REVIEW");
  const restarted = new DurableQueue(db, q.root.parent.id.replace(/_writeDestinations$/, ""));
  assert.equal((await restarted.claim()).reason, "manual_review_required");
});

test("transactional refresh allows only one concurrent use", async () => {
  const store = new FirestoreStore({ prefix:`test_${crypto.randomBytes(6).toString("hex")}` });
  const reg = await auth.registerDevice(store, { label:"test", createdBy:auth.AR_EMAIL });
  const attempts = await Promise.all(Array.from({length:4}, () => auth.refreshDeviceToken(store, reg.credentials)));
  assert.equal(attempts.filter(x=>x.ok).length, 1);
  const winner = attempts.find(x=>x.ok);
  assert.equal((await auth.revokeDevice(store, {deviceId:reg.device.id, by:auth.AR_EMAIL})).ok, true);
  assert.equal((await auth.refreshDeviceToken(store, {deviceId:reg.device.id, refreshToken:winner.refreshToken})).error, "device_revoked_or_inactive");
});

test("mock worker processes ordered inserts, split and correction with readback", async () => {
  const prefix = `test_${crypto.randomBytes(6).toString("hex")}`;
  const q = new DurableQueue(db, prefix), sheets = new MockSheetsClient(), worker = new MockSequentialWorker(q, sheets);
  const row = origin => { const r = Array(27).fill(""); r[20]=origin; r[9]="synthetic"; return r; };
  const add = (key, origin, type, rows, extra={}) => q.enqueue({operationKey:key, filaOrigen:origin, type, rows, confirmed:true, ...extra});
  const first = await add("one","one","insert",[row("one")]);
  await add("two","two","insert",[row("two")]);
  await add("split","split","split",[row("split#1"),row("split#2")]);
  assert.equal((await worker.runOne()).status,"COMMITTED");
  assert.equal((await worker.runOne()).status,"COMMITTED");
  assert.equal((await worker.runOne()).status,"COMMITTED");
  assert.deepEqual(sheets.rows.map(r=>r[0]), ["MOV-00001","MOV-00002","MOV-00003","MOV-00004"]);
  assert.ok(sheets.rows.every(r=>r.length===27));
  assert.equal((await add("different","one","insert",[row("one")])).id,first.id);
  const before = [...sheets.rows[0]], after = [...before]; after[9]="corrected";
  await add("correct","one","correction",[after],{rowNum:2,before});
  const corrected = await worker.runOne();
  assert.equal(corrected.status,"COMMITTED");
  assert.deepEqual(corrected.result.backup,before);
  assert.equal(sheets.rows[0][9],"corrected");
  assert.equal((await q.getOperation(first.id)).status,"COMMITTED");
  await add("restart","restart","insert",[row("restart")]);
  const restarted = new MockSequentialWorker(new DurableQueue(db,prefix), sheets);
  assert.equal((await restarted.runOne()).status,"COMMITTED");
});

test("ambiguous accepted write permanently blocks following operations", async () => {
  const q = new DurableQueue(db, `test_${crypto.randomBytes(6).toString("hex")}`);
  class AmbiguousMock extends MockSheetsClient {
    async write(...args) { await super.write(...args); throw new Error("timeout"); }
  }
  const sheets = new AmbiguousMock(), worker = new MockSequentialWorker(q,sheets);
  const row = origin => { const r=Array(27).fill(""); r[20]=origin; return r; };
  await q.enqueue({operationKey:"a",filaOrigen:"a",type:"insert",rows:[row("a")],confirmed:true});
  await q.enqueue({operationKey:"b",filaOrigen:"b",type:"insert",rows:[row("b")],confirmed:true});
  const result = await worker.runOne();
  assert.equal(result.status,"UNCERTAIN");
  assert.equal(sheets.rows.length,1);
  assert.equal((await q.recordManualReview(result.id,"synthetic evidence","test reviewer")).destinationBlocked,true);
  assert.equal((await worker.runOne()).reason,"manual_review_required");
});

test("pre-send read failure is confirmed and cannot write", async () => {
  const q = new DurableQueue(db, `test_${crypto.randomBytes(6).toString("hex")}`);
  class OfflineMock extends MockSheetsClient { async readAll() { throw new Error("timeout"); } }
  const sheets = new OfflineMock(), row=Array(27).fill(""); row[20]="offline";
  await q.enqueue({operationKey:"offline",filaOrigen:"offline",type:"insert",rows:[row],confirmed:true});
  const result = await new MockSequentialWorker(q,sheets).runOne();
  assert.equal(result.status,"CONFIRMED_FAILED");
  assert.equal(sheets.rows.length,0);
});

test("two consumers cannot both process a queued item", async () => {
  const q = new DurableQueue(db, `test_${crypto.randomBytes(6).toString("hex")}`);
  const sheets = new MockSheetsClient(), row=Array(27).fill(""); row[20]="concurrent";
  await q.enqueue({operationKey:"concurrent",filaOrigen:"concurrent",type:"insert",rows:[row],confirmed:true});
  const results = await Promise.all([new MockSequentialWorker(q,sheets).runOne(), new MockSequentialWorker(q,sheets).runOne()]);
  assert.equal(results.filter(r=>r.status==="COMMITTED").length,1);
  assert.equal(sheets.rows.length,1);
});

test("partially present split blocks without another write", async () => {
  const q = new DurableQueue(db, `test_${crypto.randomBytes(6).toString("hex")}`);
  const row = origin => { const r=Array(27).fill(""); r[20]=origin; return r; };
  const sheets = new MockSheetsClient([row("split#1")]);
  await q.enqueue({operationKey:"split",filaOrigen:"split",type:"split",rows:[row("split#1"),row("split#2")],confirmed:true});
  const worker = new MockSequentialWorker(q,sheets);
  assert.equal((await worker.runOne()).status,"UNCERTAIN");
  assert.equal(sheets.rows.length,1);
  assert.equal((await worker.runOne()).reason,"manual_review_required");
});

test("externally changed correction is rejected without writing", async () => {
  const q = new DurableQueue(db, `test_${crypto.randomBytes(6).toString("hex")}`);
  const before=Array(27).fill(""); before[0]="MOV-00001"; before[20]="origin";
  const changed=[...before]; changed[9]="external";
  const after=[...before]; after[9]="desired";
  const sheets = new MockSheetsClient([changed]);
  await q.enqueue({operationKey:"corr",filaOrigen:"origin",type:"correction",rowNum:2,before,rows:[after],confirmed:true});
  assert.equal((await new MockSequentialWorker(q,sheets).runOne()).status,"NEEDS_INFORMATION");
  assert.equal(sheets.rows[0][9],"external");
});

test("timeout after dispatch without evidence blocks retry", async () => {
  const q = new DurableQueue(db, `test_${crypto.randomBytes(6).toString("hex")}`);
  class TimeoutMock extends MockSheetsClient { async write() { throw new Error("timeout"); } }
  const sheets = new TimeoutMock(), row=Array(27).fill(""); row[20]="timeout";
  await q.enqueue({operationKey:"timeout",filaOrigen:"timeout",type:"insert",rows:[row],confirmed:true});
  const w = new MockSequentialWorker(q,sheets);
  assert.equal((await w.runOne()).status,"UNCERTAIN");
  assert.equal(sheets.rows.length,0);
  assert.equal((await w.runOne()).reason,"manual_review_required");
});

test("crash after durable intent blocks new consumer and stale claims", async () => {
  const prefix=`test_${crypto.randomBytes(6).toString("hex")}`, q=new DurableQueue(db,prefix);
  const row=Array(27).fill(""); row[20]="crash";
  const op=await q.enqueue({operationKey:"crash",filaOrigen:"crash",type:"insert",rows:[row],confirmed:true});
  const c=await q.claim();
  await q.prepare(op.id,c.claimId,0,1,{offset:0,rows:[row],backup:null});
  await assert.rejects(q.prepare(op.id,c.claimId,0,1,{offset:0,rows:[row],backup:null}),/write_intent_already_recorded/);
  const restarted=new DurableQueue(db,prefix);
  assert.equal((await restarted.claim()).reason,"manual_review_required");
  await assert.rejects(restarted.finish(op.id,"wrong-token","COMMITTED",{}),/stale_claim/);
  assert.equal((await restarted.getOperation(op.id)).status,"PROCESSING");
});

test("authenticated API queues synthetic pending, mock commits, API exposes result", async () => {
  const q=new DurableQueue(db,`test_${crypto.randomBytes(6).toString("hex")}`);
  const store=new MemoryStore({pendings:[{id:"cgtest_api1",message_key:"CGTEST:api1",datos_interpretados:{},motivo_ambiguedad:[]}]});
  const app=express(); app.use(express.json());
  const authUser=(req,res,next)=>{ if(req.headers.authorization!=="Bearer synthetic") return res.sendStatus(401); req.user={email:auth.AR_EMAIL}; next(); };
  app.use("/api/control-gastos",createRouter({store,queue:q,requireAuthorizedUser:authUser}));
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  try {
    const base=`http://127.0.0.1:${server.address().port}/api/control-gastos`;
    const payload={fecha_real:"2026-11-16",concepto:"Synthetic",importe:100,moneda:"COP",titular:"Edu",categoria:"Supermercado",cuenta:"Efectivo",medio_pago:"Efectivo",resolucion:"es_nuevo",approved:true,confirm:true,idempotencyKey:"api-test-1"};
    const post=()=>fetch(`${base}/pendings/cgtest_api1/apply`,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer synthetic"},body:JSON.stringify(payload)});
    assert.equal((await fetch(`${base}/operations/abc`)).status,401);
    const response=await post(), created=await response.json();
    assert.equal(response.status,202); assert.equal(created.operationStatus,"PENDING");
    const get=()=>fetch(`${base}/operations/${created.operationId}`,{headers:{authorization:"Bearer synthetic"}}).then(r=>r.json());
    assert.equal((await get()).status,"PENDING");
    assert.equal((await post()).status,202);
    const sheets=new MockSheetsClient();
    assert.equal((await new MockSequentialWorker(q,sheets).runOne()).status,"COMMITTED");
    const verified=await get();
    assert.equal(verified.status,"COMMITTED"); assert.equal(verified.result.verifiedColumns,27);
    assert.equal(sheets.rows.length,1);
    console.log(`synthetic_emulator_operation_id=${created.operationId}`);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

function fakeSheetsRespond(json) {
  return { ok:true, status:200, text: async () => JSON.stringify(json) };
}
function fakeSheetsFetch(sheet) {
  return async (url, opts = {}) => {
    const decoded = decodeURIComponent(String(url));
    const range = /\/values\/([^?]+)\?/.exec(decoded)?.[1];
    if (!range) throw new Error("unexpected_url");
    const match = /^(?:'([^']+)'|([^!]+))!([A-Z]+)(\d+)(?::([A-Z]+)(\d*))?$/.exec(range);
    const start = Number(match?.[4] || 1);
    const end = match?.[6] ? Number(match[6]) : null;
    if (opts.method === "PUT") {
      const body = JSON.parse(opts.body);
      body.values.forEach((row, i) => { sheet.rows[start - 2 + i] = row.map(v => String(v ?? "")); });
      return fakeSheetsRespond({ updatedRows: body.values.length, updatedRange: range });
    }
    const from = Math.max(0, start - 2);
    const to = end ? end - 2 : sheet.rows.length - 1;
    const values = sheet.rows.slice(from, to + 1);
    return fakeSheetsRespond({ range: `Movimientos_Test!A${start}:AA${end || (start + Math.max(values.length, 1) - 1)}`, values });
  };
}

test("sheets adapter runs the single writer against the Google client interface", async () => {
  const q = new DurableQueue(db, `test_${crypto.randomBytes(6).toString("hex")}`);
  const sheet = { rows: [Array.from({ length:27 }, (_, i) => i === 0 ? "MOV-00009" : i === 20 ? "pre-existing" : "")] };
  const google = new GoogleSheetsClient({ auth:"fake-token", fetchImpl:fakeSheetsFetch(sheet) });
  const adapter = new SheetsWriterClient({ sheetsClient:google, allowRealWrites:true });
  const worker = new SequentialWriter(q, adapter);
  const row = origin => { const r = Array(27).fill(""); r[9] = "synthetic"; r[20] = origin; return r; };
  await q.enqueue({ operationKey:"g1", filaOrigen:"g1", type:"insert", rows:[row("g1")], confirmed:true });
  const committed = await worker.runOne();
  assert.equal(committed.status, "COMMITTED");
  assert.deepEqual(committed.result.ids, ["MOV-00010"]);
  assert.equal(committed.result.verifiedColumns, 27);
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[1][20], "g1");
  // Correction patch through the same writer, with backup of the live row.
  const backup = [...sheet.rows[1]];
  await q.enqueue({ operationKey:"g2", filaOrigen:"correction:MOV-00010", type:"correction",
    rowNum:3, movId:"MOV-00010", patch:{ comercio:"Corregido por cola", importe:2500, moneda:"COP", amounts:{ monto_cop:2500, monto_ars:1190.48, monto_usd:0.79 } }, rows:[], confirmed:true });
  const corrected = await worker.runOne();
  assert.equal(corrected.status, "COMMITTED");
  assert.deepEqual(corrected.result.backup, backup);
  assert.equal(sheet.rows[1][9], "Corregido por cola");
  assert.equal(sheet.rows[1][0], "MOV-00010");
  assert.equal(sheet.rows[1][20], "g1");
  assert.equal(sheet.rows[1][22], "2500");
  await assert.rejects(adapter.readAll({ spreadsheetId:"not-the-test-sheet", sheet:"Movimientos_Test" }), /target_rejected/);
  await assert.rejects(adapter.write({ spreadsheetId:"not-the-test-sheet", sheet:"Movimientos" }, 0, [row("x")]), /target_rejected/);
});

test("sheets adapter factory stays disabled and cannot be pointed at another target", async () => {
  const duck = { readRange:async () => ({ result:"" }), writeRange:async () => ({}) };
  assert.throws(() => createSheetsWriterAdapter({ sheetsClient:duck, allowRealWrites:true }), /sheets_adapter_disabled/);
  process.env.CONTROL_GASTOS_SHEETS_ADAPTER = "1";
  try {
    assert.throws(() => createSheetsWriterAdapter({ sheetsClient:duck, allowRealWrites:false }), /real_writes_not_allowed/);
    const adapter = createSheetsWriterAdapter({ sheetsClient:duck, allowRealWrites:true });
    assert.equal(adapter.kind, "sheets");
    await assert.rejects(adapter.readAll({ spreadsheetId:"other", sheet:"Movimientos" }), /target_rejected/);
    process.env.CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED = "true";
    assert.throws(() => createSheetsWriterAdapter({ sheetsClient:duck, allowRealWrites:true }), /production_write_must_remain_disabled/);
  } finally {
    delete process.env.CONTROL_GASTOS_SHEETS_ADAPTER;
    delete process.env.CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED;
  }
});

test("correction API enqueues once, worker applies with backup, state is queryable", async () => {
  const prefix = `test_${crypto.randomBytes(6).toString("hex")}`;
  const q = new DurableQueue(db, prefix);
  const before = Array(27).fill(""); before[0]="MOV-00001"; before[9]="Original"; before[20]="corr-origin";
  const store = new MemoryStore({ corrections:{ proposals:[{ id:"prop-1", status:"propuesta", date:"2026-11-16",
    payload:{ row_num:2, mov_id:"MOV-00001", reason:"synthetic", changes:{ comercio:"Corregido" },
      comparison:{ before:{ comercio:"Original", moneda:"COP", importe:1000 } } },
    history:[] }], applied:[] } });
  const app = express(); app.use(express.json());
  const authUser = (req,res,next) => { if (req.headers.authorization !== "Bearer synthetic") return res.sendStatus(401); req.user={ email:auth.AR_EMAIL }; next(); };
  app.use("/api/control-gastos", createRouter({ store, queue:q, requireAuthorizedUser:authUser }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/control-gastos`;
    const post = body => fetch(`${base}/corrections/prop-1/apply`, { method:"POST", headers:{ "content-type":"application/json", authorization:"Bearer synthetic" }, body:JSON.stringify(body) });
    assert.equal((await post({ approved:true })).status, 400);
    const created = await (await post({ approved:true, confirm:true })).json();
    assert.equal(created.operationStatus, "PENDING");
    assert.equal((await store.getCorrections()).proposals[0].status, "en_cola");
    const again = await (await post({ approved:true, confirm:true })).json();
    assert.equal(again.operationId, created.operationId);
    assert.equal(again.duplicate, true);
    const sheets = new MockSheetsClient([before]);
    const committed = await new SequentialWriter(q, sheets).runOne();
    assert.equal(committed.status, "COMMITTED");
    assert.deepEqual(committed.result.backup, before);
    assert.equal(sheets.rows[0][9], "Corregido");
    const op = await (await fetch(`${base}/operations/${created.operationId}`, { headers:{ authorization:"Bearer synthetic" } })).json();
    assert.equal(op.status, "COMMITTED");
    assert.equal(op.type, "correction");
    assert.equal(op.result.verifiedColumns, 27);
    assert.equal((await new SequentialWriter(q, sheets).runOne()).reason, "empty");
    assert.equal(sheets.rows.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("correction endpoint stays blocked without the isolated queue", async () => {
  const store = new MemoryStore({ corrections:{ proposals:[{ id:"prop-2", status:"propuesta", payload:{ row_num:2, mov_id:"MOV-00001", changes:{ comercio:"x" } } }], applied:[] } });
  const app = express(); app.use(express.json());
  const authUser = (req,res,next) => { req.user={ email:auth.AR_EMAIL }; next(); };
  app.use("/api/control-gastos", createRouter({ store, queue:null, requireAuthorizedUser:authUser }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/control-gastos/corrections/prop-2/apply`,
      { method:"POST", headers:{ "content-type":"application/json", authorization:"Bearer synthetic" }, body:JSON.stringify({ approved:true, confirm:true }) });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "serialized_writer_not_ready");
    assert.equal((await store.getCorrections()).proposals[0].status, "propuesta");
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("API process restart keeps PENDING and COMMITTED state without a second write", async () => {
  const prefix = `test_${crypto.randomBytes(6).toString("hex")}`;
  const store = new MemoryStore({ pendings:[{ id:"cgtest_restart", message_key:"CGTEST:restart", datos_interpretados:{}, motivo_ambiguedad:[] }] });
  const authUser = (req,res,next) => { if (req.headers.authorization !== "Bearer synthetic") return res.sendStatus(401); req.user={ email:auth.AR_EMAIL }; next(); };
  const payload = { fecha_real:"2026-11-16", concepto:"Restart sintético", importe:100, moneda:"COP", titular:"Edu",
    categoria:"Supermercado", cuenta:"Efectivo", medio_pago:"Efectivo", resolucion:"es_nuevo", approved:true, confirm:true, idempotencyKey:"restart-1" };
  const start = async q => {
    const app = express(); app.use(express.json());
    app.use("/api/control-gastos", createRouter({ store, queue:q, requireAuthorizedUser:authUser }));
    const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    return { server, base:`http://127.0.0.1:${server.address().port}/api/control-gastos` };
  };
  const sheets = new MockSheetsClient();
  const first = await start(new DurableQueue(db, prefix));
  let operationId;
  try {
    const created = await (await fetch(`${first.base}/pendings/cgtest_restart/apply`, { method:"POST", headers:{ "content-type":"application/json", authorization:"Bearer synthetic" }, body:JSON.stringify(payload) })).json();
    operationId = created.operationId;
    assert.equal(created.operationStatus, "PENDING");
  } finally { await new Promise(resolve => first.server.close(resolve)); }
  const second = await start(new DurableQueue(db, prefix));
  try {
    const pending = await (await fetch(`${second.base}/operations/${operationId}`, { headers:{ authorization:"Bearer synthetic" } })).json();
    assert.equal(pending.status, "PENDING");
    assert.equal((await new SequentialWriter(new DurableQueue(db, prefix), sheets).runOne()).status, "COMMITTED");
    const committed = await (await fetch(`${second.base}/operations/${operationId}`, { headers:{ authorization:"Bearer synthetic" } })).json();
    assert.equal(committed.status, "COMMITTED");
    assert.equal(committed.result.verifiedColumns, 27);
    const duplicate = await (await fetch(`${second.base}/pendings/cgtest_restart/apply`, { method:"POST", headers:{ "content-type":"application/json", authorization:"Bearer synthetic" }, body:JSON.stringify(payload) })).json();
    assert.equal(duplicate.operationId, operationId);
    assert.equal((await new SequentialWriter(new DurableQueue(db, prefix), sheets).runOne()).reason, "empty");
    assert.equal(sheets.rows.length, 1);
  } finally { await new Promise(resolve => second.server.close(resolve)); }
});

test("supervised review records evidence without unblocking the destination", async () => {
  const q = new DurableQueue(db, `test_${crypto.randomBytes(6).toString("hex")}`);
  class Ambiguous extends MockSheetsClient { async write(...args) { await super.write(...args); throw new Error("timeout"); } }
  const sheets = new Ambiguous();
  const row = origin => { const r = Array(27).fill(""); r[20] = origin; return r; };
  await q.enqueue({ operationKey:"mr-a", filaOrigen:"mr-a", type:"insert", rows:[row("mr-a")], confirmed:true });
  const result = await new SequentialWriter(q, sheets).runOne();
  assert.equal(result.status, "UNCERTAIN");
  assert.equal((await q.recordManualReview(result.id, "synthetic evidence", "reviewer")).destinationBlocked, true);
  await q.enqueue({ operationKey:"mr-b", filaOrigen:"mr-b", type:"insert", rows:[row("mr-b")], confirmed:true });
  assert.equal((await new SequentialWriter(q, sheets).runOne()).reason, "manual_review_required");
  assert.equal(sheets.rows.length, 1);
  assert.equal((await q.getOperation(result.id)).status, "MANUAL_REVIEW");
});
