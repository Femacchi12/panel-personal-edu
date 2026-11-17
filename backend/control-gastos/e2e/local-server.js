"use strict";

// Isolated browser E2E harness. Binds only to 127.0.0.1, accepts only a
// synthetic bearer token from a loopback socket, uses Firestore Emulator for
// operational state and the durable queue, and never configures a Sheets
// writer. Firebase auth in the real server is untouched.
const path = require("path");
const express = require("express");
const admin = require("firebase-admin");
const { createRouter } = require("../routes");
const { FirestoreStore } = require("../storage");
const { DurableQueue } = require("../durable-queue");
const { buildSeed } = require("../fixtures");
const { productionWriteEnabled } = require("../movimientos-writer");

const HOST = "127.0.0.1";
const PORT = Number(process.env.CONTROL_GASTOS_LOCAL_PORT || 8099);
const ROOT = path.resolve(__dirname, "../../..");
const PREFIX = String(process.env.CONTROL_GASTOS_LOCAL_PREFIX || "cg_e2e");

function truthy(value) { return ["1", "true", "yes"].includes(String(value || "").toLowerCase()); }

function assertLocalOnly() {
  const emulator = String(process.env.FIRESTORE_EMULATOR_HOST || "");
  if (!truthy(process.env.CONTROL_GASTOS_LOCAL_E2E)) throw new Error("CONTROL_GASTOS_LOCAL_E2E=1 required");
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulator)) throw new Error("loopback FIRESTORE_EMULATOR_HOST required");
  if (String(process.env.GCLOUD_PROJECT || "") !== "demo-control-gastos-local") throw new Error("demo project required");
  if (productionWriteEnabled()) throw new Error("production writes must remain disabled");
  if (String(process.env.CONTROL_GASTOS_SHEETS_MODE || "").toLowerCase() === "google")
    throw new Error("google sheets mode is not allowed in the local harness");
}

function syntheticPendings() {
  const base = {
    created_at: "2026-11-17T09:00:00.000-05:00",
    estado_sincronizacion: "pendiente_validacion",
    estado_validacion: "pendiente",
    motivo_ambiguedad: ["Dato sintético del harness E2E (no es un pendiente histórico real)."],
    texto_relevante: "[E2E sintético]",
  };
  return [
    {
      ...base,
      id: "cgtest_ui_001",
      message_key: "CGTEST:E2E:UI:001",
      message_id: "CGTEST-UI-001",
      chat_id: "local-e2e",
      texto_relevante: "[E2E sintético] Supermercado barrio $45.900 Efectivo Edu",
      datos_interpretados: {
        fecha_real: "2026-11-16", concepto: "Supermercado barrio", texto_original: "[E2E sintético] Supermercado barrio $45.900 Efectivo Edu",
        importe: 45900, moneda: "COP", titular: "Edu", categoria: "Supermercado", subcategoria: "Otros",
        cuenta_tarjeta: "Efectivo", modalidad_pago: "Efectivo", mes_pago: "nov-2026"
      }
    },
    {
      ...base,
      id: "cgtest_ui_002",
      message_key: "CGTEST:E2E:UI:002",
      message_id: "CGTEST-UI-002",
      chat_id: "local-e2e",
      texto_relevante: "[E2E sintético] Farmacia $12.500 Débito Edu",
      datos_interpretados: {
        fecha_real: "2026-11-16", concepto: "Farmacia", texto_original: "[E2E sintético] Farmacia $12.500 Débito Edu",
        importe: 12500, moneda: "COP", titular: "Edu", categoria: "Salud", subcategoria: "Farmacia",
        cuenta_tarjeta: "Efectivo/Débito", modalidad_pago: "Débito", mes_pago: "nov-2026"
      }
    },
    {
      ...base,
      id: "cgtest_ui_003",
      message_key: "CGTEST:E2E:UI:003",
      message_id: "CGTEST-UI-003",
      chat_id: "local-e2e",
      texto_relevante: "[E2E sintético] Café $9.800 Efectivo Edu",
      datos_interpretados: {
        fecha_real: "2026-11-16", concepto: "Café", texto_original: "[E2E sintético] Café $9.800 Efectivo Edu",
        importe: 9800, moneda: "COP", titular: "Edu", categoria: "Comidas/Cenas", subcategoria: "Cafetería",
        cuenta_tarjeta: "Efectivo", modalidad_pago: "Efectivo", mes_pago: "nov-2026"
      }
    }
  ].map(item => ({ ...item, _ui: { readonly_original_preserved: false, synthetic: true } }));
}

function localOnlyAuth(req, res, next) {
  const remote = String(req.socket?.remoteAddress || "");
  if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(remote)) return res.status(403).json({ ok:false, error:"loopback_only" });
  if (req.headers["x-forwarded-for"] || req.headers["forwarded"]) return res.status(403).json({ ok:false, error:"proxy_headers_rejected" });
  if (String(req.headers.authorization || "") !== "Bearer local-e2e") return res.status(401).json({ ok:false, error:"local_token_required" });
  req.user = { email: "fernandoemacchi@gmail.com", authType: "local_e2e" };
  next();
}

async function seedIsolatedState(store) {
  const pendings = await store.getPendings();
  if (pendings.some(p => String(p.id || "").startsWith("cgtest_ui_"))) return { seeded:false };
  const seed = buildSeed();
  seed.pendings = [...seed.pendings, ...syntheticPendings()];
  await store.saveState(seed);
  return { seeded:true, pendings:seed.pendings.length, closures:Object.keys(seed.closures).length };
}

async function main() {
  assertLocalOnly();
  admin.initializeApp({ projectId: "demo-control-gastos-local" });
  const store = new FirestoreStore({ prefix: PREFIX });
  const queue = new DurableQueue(store.db, PREFIX);
  const seeded = await seedIsolatedState(store);

  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.get("/health", (req, res) => res.json({ ok:true, mode:"local_e2e", host:HOST, port:PORT, seeded }));
  app.get("/local-e2e", (req, res) => res.sendFile(path.join(__dirname, "local-e2e.html")));
  app.use("/api/control-gastos", createRouter({ store, queue, requireAuthorizedUser: localOnlyAuth }));
  app.use(express.static(ROOT, { index:false, dotfiles:"deny" }));

  const server = app.listen(PORT, HOST, () => {
    console.log(JSON.stringify({ ok:true, listening:`http://${HOST}:${PORT}/local-e2e`, prefix:PREFIX, seeded, production_write_enabled:productionWriteEnabled() }));
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(error => { console.error("local_e2e_start_failed:", error && error.message); process.exit(1); });
