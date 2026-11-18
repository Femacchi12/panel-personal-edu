"use strict";

const express = require("express");
const { getStore } = require("./storage");
const service = require("./service");
const deviceAuth = require("./device-auth");

function createRouter(opts = {}) {
  const router = express.Router();
  const store = opts.store || getStore(opts.storeOpts);
  const emulator = /^(127\.0\.0\.1|localhost):\d+$/.test(String(process.env.FIRESTORE_EMULATOR_HOST || ""));
  const localQueue = emulator && process.env.GCLOUD_PROJECT === "demo-control-gastos-local" &&
    process.env.CONTROL_GASTOS_LOCAL_QUEUE === "1" && !service.productionWriteEnabled();
  // Cola operativa en entornos reales: SOLO encolado (PENDING). El consumidor
  // secuencial corre en un endpoint con lease de exclusividad (una ejecución
  // del escritor por destino a la vez), autenticado: TEST forzado en preprod,
  // canónico en producción solo con escrituras productivas habilitadas.
  const testConsumer = String(process.env.CONTROL_GASTOS_TEST_CONSUMER || "") === "1";
  const canonicalConsumer = String(process.env.CONTROL_GASTOS_CANONICAL_CONSUMER || "") === "1" &&
    service.productionWriteEnabled();
  const consumerReady = !!(testConsumer || canonicalConsumer) && !!opts.consumer;
  const queueEnabled = (!localQueue && String(process.env.CONTROL_GASTOS_QUEUE_ENABLED || "") === "1") || consumerReady;
  const queue = localQueue || queueEnabled ? opts.queue : null;
  const consumer = consumerReady ? opts.consumer : null;
  const requireAuthorizedUser = opts.requireAuthorizedUser; // Firebase auth middleware (dashboard allowlist)

  const asyncH = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);

  function requireFirebaseUser(req,res,next){
    if (typeof requireAuthorizedUser === "function") return requireAuthorizedUser(req,res,next);
    return res.status(401).json({ ok:false, error:"auth_not_configured" });
  }
  function requireArWrite(req,res,next){
    if (!service.isWriteAuthorized(req.user)) return res.status(403).json({ ok:false, error:"forbidden", message:"Acceso financiero restringido al usuario personal autorizado (AR)." });
    next();
  }
  // Sync operativo: acepta Firebase AR o token de dispositivo (scope sync_operational). Nunca otorga permisos contables.
  async function requireSyncAuth(req,res,next){
    // Try device token first
    const dev = await deviceAuth.authenticateDeviceAccess(store, req);
    if (dev && dev.ok) { req.syncAuth = dev; req.user = { email: deviceAuth.AR_EMAIL, deviceId: dev.device.id, authType: "device_sync" }; return next(); }
    if (dev && dev.ok === false) return res.status(dev.status || 401).json({ ok:false, error: dev.error || "unauthorized" });
    // Fallback Firebase AR
    return requireFirebaseUser(req, res, (err)=>{ if (err) return next(err); return requireArWrite(req,res,next); });
  }

  // --- Device auth (sync operativo, sin credenciales en navegador) ---
  router.post("/devices/register", requireFirebaseUser, requireArWrite, asyncH(async (req,res)=>{
    const r = await deviceAuth.registerDevice(store, { label: req.body?.label, createdBy: req.user?.email });
    res.status(r.status||200).json(r);
  }));
  router.get("/devices", requireFirebaseUser, requireArWrite, asyncH(async (req,res)=>{
    const devices = await store.listDevices();
    // no exponer secretos
    res.json({ ok:true, devices: devices.map(d=>({ id:d.id, label:d.label, status:d.status, createdAt:d.createdAt, lastSeenAt:d.lastSeenAt, scope:d.scope })) });
  }));
  router.post("/devices/:id/revoke", requireFirebaseUser, requireArWrite, asyncH(async (req,res)=>{
    const r = await deviceAuth.revokeDevice(store, { deviceId: req.params.id, by: req.user?.email });
    res.status(r.status||200).json(r);
  }));
  // Token endpoint: autenticado por credencial de dispositivo (refresh) - sin Firebase. Protegido por verificacion hash/rotacion/revocacion.
  router.post("/devices/token", asyncH(async (req,res)=>{
    const r = await deviceAuth.refreshDeviceToken(store, { deviceId: req.body?.deviceId, refreshToken: req.body?.refreshToken }, { ip: req.ip });
    res.status(r.status||200).json(r);
  }));

  // Read endpoints (dashboard) - Firebase authorized user
  router.get("/status", requireFirebaseUser, asyncH(async (req,res)=> res.json(await service.getStatus(store))));
  router.get("/catalogs", requireFirebaseUser, (req,res)=> res.json({ ok:true, catalogs: service.CATALOGS }));
  router.get("/pendings", requireFirebaseUser, asyncH(async (req,res)=> res.json({ ok:true, items: await service.listPendings(store) })));
  router.get("/pendings/:id", requireFirebaseUser, asyncH(async (req,res)=>{ const item=await service.getPending(store, req.params.id); if(!item) return res.status(404).json({ok:false,error:"not_found"}); res.json({ok:true,item}); }));
  router.post("/pendings/:id/preview", requireFirebaseUser, requireArWrite, asyncH(async (req,res)=>{ const r=await service.previewPendingResolution(store, req.params.id, req.body||{}); res.status(r.status||200).json(r); }));
  // Fail closed until the durable queue is integrated end-to-end. Do not fall
  // back to the legacy simulated-apply path, which can mutate pending state.
  router.post("/pendings/:id/apply", requireFirebaseUser, requireArWrite, asyncH(async (req,res)=>{
    // Aplicar solo encola cuando hay cola Y consumidor con destino configurado
    // (writer disponible); si no, falla cerrado antes de crear operaciones.
    const r=await service.enqueuePendingResolution(store, queue, req.params.id, req.body||{}, req.user, req, { allowReal: consumerReady });
    res.status(r.status||200).json(r);
  }));
  router.get("/operations/:id", requireFirebaseUser, requireArWrite, asyncH(async (req,res)=>{
    if (!queue) return res.status(503).json({ok:false,error:"isolated_queue_unavailable"});
    if (!/^[a-zA-Z0-9]{20}$/.test(req.params.id)) return res.status(404).json({ok:false,error:"not_found"});
    const op=await queue.getOperation(req.params.id);
    if (!op) return res.status(404).json({ok:false,error:"not_found"});
    const audit=op.audit || [];
    const destination=await queue.getDestinationState().catch(()=>null);
    const withResult=["COMMITTED","ALREADY_REGISTERED","NEEDS_INFORMATION","CONFIRMED_FAILED"].includes(op.status);
    res.json({ok:true,operationId:op.id,type:op.type,status:op.status,createdAt:op.createdAt,
      updatedAt:audit.length ? audit[audit.length-1].at : op.createdAt,
      result:withResult ? (op.result || null) : null,
      reason:op.result?.reason || (["UNCERTAIN","MANUAL_REVIEW"].includes(op.status) ? "review_required" : null),
      destinationBlocked:destination ? !!destination.blocked : null});
  }));

  router.get("/closures", requireFirebaseUser, asyncH(async (req,res)=> res.json({ ok:true, ...(await service.listClosures(store, { date: req.query.date })) })));
  router.post("/closures/:date/review", requireFirebaseUser, requireArWrite, asyncH(async (req,res)=>{ const r=await service.markClosureReviewed(store, req.params.date, req.body||{}, req.user); res.status(r.status||200).json(r); }));
  router.post("/closures/:date/refresh", requireFirebaseUser, requireArWrite, asyncH(async (req,res)=>{ const r=await service.refreshClosure(store, req.params.date, req.user); res.status(r.status||200).json(r); }));

  router.get("/corrections", requireFirebaseUser, asyncH(async (req,res)=> res.json({ ok:true, corrections: await service.listCorrections(store) })));
  router.post("/corrections/propose", requireFirebaseUser, requireArWrite, asyncH(async (req,res)=>{ const r=await service.proposeCorrection(store, req.body||{}, req.user); res.status(r.status||200).json(r); }));
  router.post("/corrections/:id/apply", requireFirebaseUser, requireArWrite, asyncH(async (req,res)=>{
    if (!queue) return res.status(503).json({ok:false,error:"serialized_writer_not_ready",message:"Correcciones bloqueadas: el escritor serializado no está disponible en este entorno."});
    const r=await service.enqueueCorrection(store, queue, req.params.id, req.body||{}, req.user, req);
    res.status(r.status||200).json(r);
  }));

  // Sync ingest (Hermes local -> cloud operational state). Alcance: solo operativo. Acepta Firebase AR o device access token sync.
  router.post("/sync", requireSyncAuth, asyncH(async (req,res)=>{ const r=await service.ingestSync(store, req.body||{}, req.user, { authType: req.syncAuth ? "device_sync" : "firebase_user" }); res.status(r.status||200).json(r); }));

  // Consumidor secuencial del destino TEST (preprod). Exclusividad por lease
  // transaccional: dos ejecuciones simultaneas -> una queda fuera. Auth: sync
  // (Firebase AR o token de dispositivo). Solo corre si CONTROL_GASTOS_TEST_CONSUMER=1
  // y el escritor se configuro con destino TEST forzado; nunca toca el canónico.
  router.post("/consumer/run", requireSyncAuth, asyncH(async (req,res)=>{
    if (!consumer) return res.status(503).json({ ok:false, error:"consumer_not_configured" });
    // Holder POR EJECUCIÓN (no por dispositivo): dos ejecuciones simultáneas
    // (aunque sean del mismo dispositivo) no comparten lease.
    const who = (req.syncAuth && req.user?.deviceId) ? `device:${req.user.deviceId}` : `fb:${req.user?.email}`;
    const holder = `${who}:${crypto.randomUUID()}`;
    const lease = await consumer.queue.acquireConsumerLease(holder, Number(process.env.CONTROL_GASTOS_CONSUMER_LEASE_MS || 120000));
    if (!lease.ok) return res.status(409).json({ ok:false, error:"consumer_busy", reason: lease.reason, holder: lease.holder });
    const maxOps = Math.min(Number(req.body?.maxOps) || 20, 20);
    const results = [];
    try {
      for (let i = 0; i < maxOps; i++) {
        const r = await consumer.writer.runOne();
        results.push(r);
        // Cortar al agotar la cola o cuando el destino está ocupado/bloqueado
        // (otro consumidor procesando): no girar en falso.
        if (r.reason === "empty" || r.reason === "manual_review_required" || r.reason === "unexpected_state") break;
      }
    } finally {
      await consumer.queue.releaseConsumerLease(holder).catch(()=>{});
    }
    let lastRows = null;
    try {
      const rows = await consumer.writer.sheets.readAll(consumer.writer.target);
      const filled = rows.filter(r => r[0]);
      lastRows = filled.slice(-8).map(r => ({ id: r[0], concepto: r[9], filaOrigen: r[20], estado: r[18] }));
      // Fila completa de la última escritura (diagnóstico de reconciliación)
      const last = filled[filled.length - 1];
      if (last) {
        const { MOVIMIENTOS_COLUMNS } = require("./movimientos-writer");
        const full = {};
        MOVIMIENTOS_COLUMNS.forEach((c, i) => { full[c] = last[i]; });
        lastRows.diagnostico_ultima_fila = { filaHoja: filled.indexOf(last) + 2, columnas: full };
      }
    } catch (_) { /* diagnostico best-effort */ }
    const blocked = await consumer.queue.getDestinationState().catch(()=>null);
    res.json({ ok:true, holder, processed: results.length, results, destinationBlocked: blocked ? !!blocked.blocked : null, lastRows });
  }));
  // Guarda la decision de revision (estado operativo, sin registro contable). AR-only.
  router.post("/pendings/:id/review", requireFirebaseUser, requireArWrite, asyncH(async (req,res)=>{
    const r=await service.savePendingReview(store, req.params.id, req.body||{}, req.user);
    res.status(r.status||200).json(r);
  }));
  // Payload de la sincronizacion operativa inicial (5 historicos; solo lectura).
  // AR-only. Niega doble ejecucion si ya existen pendientes en el store.
  router.get("/sync/initial-payload", requireFirebaseUser, requireArWrite, asyncH(async (req,res)=>{
    const st=await store.getState();
    const r=await service.buildInitialSyncPayload(st, store);
    res.status(r.status||200).json(r);
  }));

  // Audits (read, authorized user)
  router.get("/audits", requireFirebaseUser, asyncH(async (req,res)=> res.json({ ok:true, items: await store.listAudits(Number(req.query.limit||200)) })));

  // Temporary test probe (isolated validation only). Enabled only with explicit env + shared secret. No secrets exposed.
  router.post("/_test/probe", asyncH(async (req,res)=>{
    if (String(process.env.CONTROL_GASTOS_TEST_PROBE||"0") !== "1") return res.status(404).json({ok:false,error:"not_found"});
    const secret = String(process.env.CONTROL_GASTOS_TEST_PROBE_SECRET || "");
    if (!secret || String(req.headers["x-test-probe-secret"] || "") !== secret) return res.status(403).json({ok:false,error:"forbidden"});
    const ns = String(req.body?.namespace || "zz_test_probe_tmp");
    const r = await service.runTestProbe(store, { namespace: ns, action: req.body?.action, payload: req.body?.payload });
    res.status(r.status||200).json(r);
  }));

  return router;
}

module.exports = { createRouter };
