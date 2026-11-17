"use strict";

// Dry-run aislado de la sincronizacion operativa inicial (Hermes -> Firestore).
// Emulador loopback, prefijo propio, sin seed: replica el camino productivo
// (FirestoreStore + createRouter + POST /sync) sin tocar preprod ni prod.
const crypto = require("crypto");
const express = require("express");
const admin = require("firebase-admin");
const { FirestoreStore } = require("../storage");
const { createRouter } = require("../routes");

const PREFIX = process.env.DRYRUN_PREFIX || `cg_dryrun_${crypto.randomBytes(4).toString("hex")}`;
const payload = JSON.parse(require("fs").readFileSync("C:/Users/Eduardo/AppData/Local/Temp/opencode/cg-sync-payload.json", "utf8"));

function loopbackAuth(req, res, next) {
  const remote = String(req.socket?.remoteAddress || "");
  if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(remote)) return res.status(403).json({ ok:false, error:"loopback_only" });
  if (String(req.headers.authorization || "") !== "Bearer dryrun-local") return res.status(401).json({ ok:false, error:"local_token_required" });
  req.user = { email: "fernandoemacchi@gmail.com", authType: "dryrun" };
  next();
}

async function main() {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(String(process.env.FIRESTORE_EMULATOR_HOST || ""))) throw new Error("solo emulador loopback");
  if (String(process.env.GCLOUD_PROJECT || "") !== "demo-control-gastos-local") throw new Error("proyecto demo requerido");
  admin.initializeApp({ projectId: "demo-control-gastos-local" });
  const store = new FirestoreStore({ prefix: PREFIX, databaseId: "(default)" });
  const app = express(); app.use(express.json({ limit: "256kb" }));
  app.use("/api/control-gastos", createRouter({ store, requireAuthorizedUser: loopbackAuth }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/control-gastos`;
  const H = { "content-type": "application/json", authorization: "Bearer dryrun-local" };
  const out = { prefix: PREFIX };
  try {
    // Estado inicial: vacio, sin seed, sin sinteticos
    const st0 = await (await fetch(`${base}/status`, { headers: H })).json();
    out.inicial = { pendings: st0.counts.pendings, fixtures: st0.fixtures, sync: st0.sync.status };
    // POST /sync (1ra vez)
    const s1 = await (await fetch(`${base}/sync`, { method: "POST", headers: H, body: JSON.stringify(payload) })).json();
    out.sync1 = { ok: s1.ok, status: s1.syncState?.status, source: s1.syncState?.source, lastSyncAt: s1.syncState?.lastSyncAt };
    // POST /sync (2da vez, idempotencia por message_key)
    const s2 = await (await fetch(`${base}/sync`, { method: "POST", headers: H, body: JSON.stringify(payload) })).json();
    out.sync2 = { ok: s2.ok, status: s2.syncState?.status };
    // Lectura posterior
    const p = await (await fetch(`${base}/pendings`, { headers: H })).json();
    out.pendings = (p.items || []).map(i => ({ key: i.message_key, fecha: i.datos_interpretados?.fecha_real, concepto: i.datos_interpretados?.concepto, importe: i.datos_interpretados?.importe, moneda: i.datos_interpretados?.moneda, estado: i.estado_sincronizacion }));
    out.total = (p.items || []).length;
    out.sin_sinteticos = !(p.items || []).some(i => String(i.id || "").startsWith("cgtest_"));
    const aud = await (await fetch(`${base}/audits?limit=5`, { headers: H })).json();
    out.audits = (aud.items || []).filter(a => a.type === "sync_ingest").map(a => ({ type: a.type, by: a.by, counts: a.counts }));
    // GET /operations y apply siguen bloqueados (no cola)
    const ap = await fetch(`${base}/pendings/${encodeURIComponent(out.pendings[0].key)}/apply`, { method: "POST", headers: H, body: JSON.stringify({ approved: true, confirm: true }) });
    out.apply_status = ap.status;
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => { console.error("dryrun_error:", e && e.message); process.exit(1); });
