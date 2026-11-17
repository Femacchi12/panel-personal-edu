"use strict";
// Control de gastos (Hermes) - estado operativo aislado por defecto, sin escrituras productivas.
// Store: CONTROL_GASTOS_STORE=memory|file|firestore. Escritura Movimientos controlada: deshabilitada en producción por defecto.
const { createRouter } = require("./routes");
const { createStore } = require("./storage");
const { buildSeed } = require("./fixtures");
const service = require("./service");
const { MovimientosWriter } = require("./movimientos-writer");
const { createGoogleSheetsClient } = require("./sheets-google-client");
const { DurableQueue } = require("./durable-queue");

function maybeConfigureControlledWriter(store) {
  // Production writes remain disabled unless explicitly enabled AND explicitly allowed per operation.
  // A real Sheets client/target can be injected for isolated tests/preprod only. ADC supported for Cloud Run (SA runtime).
  // Hard guard: with CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED=false no Sheets client
  // is configured at all; there is no writable path to configure.
  if (!service.productionWriteEnabled()) {
    service.configureControlledWrites({ writer: null, target: null });
    console.log("Control de gastos: production writes disabled; no Sheets writer configured (consumer disabled).");
    return;
  }
  const mode = String(process.env.CONTROL_GASTOS_SHEETS_MODE || "").toLowerCase(); // "google"
  const testTargetId = process.env.CONTROL_GASTOS_SHEETS_TEST_SPREADSHEET_ID || "";
  const testTargetSheet = process.env.CONTROL_GASTOS_SHEETS_TEST_SHEET || "Movimientos_Test";
  const token = process.env.GOOGLE_SHEETS_ACCESS_TOKEN || ""; // short-lived / injected in controlled env only
  const useAdc = String(process.env.CONTROL_GASTOS_SHEETS_ADC || "0").toLowerCase() === "1" || (mode === "google" && testTargetId && !token);
  if (mode === "google" && testTargetId && (token || useAdc)) {
    let auth = token;
    if (!token && useAdc) {
      // Application Default Credentials (Cloud Run runtime SA).
      try {
        let GoogleAuth;
        try { ({ GoogleAuth } = require("google-auth-library")); } catch (_) { ({ GoogleAuth } = require("googleapis").google.auth); }
        const ga = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
        auth = { getAccessToken: async () => ga.getAccessToken() };
      } catch (e) {
        console.error("Control de gastos: ADC auth unavailable", e && e.message);
        auth = null;
      }
    }
    if (auth) {
      const sheetsClient = createGoogleSheetsClient({ auth });
      const writer = new MovimientosWriter({ sheetsClient, store });
      service.configureControlledWrites({ writer, target: { spreadsheetId: testTargetId, sheet: testTargetSheet } });
      console.log(`Control de gastos: controlled Sheets writer configured (isolated target ${testTargetId}/${testTargetSheet}, adc=${!token}, production_writes=${service.productionWriteEnabled()}).`);
    } else {
      service.configureControlledWrites({ writer: null, target: null });
    }
  } else {
    service.configureControlledWrites({ writer: null, target: null });
  }
}

function mountControlGastos(app, requireAuthorizedUser) {
  try {
    const storeType = String(process.env.CONTROL_GASTOS_STORE || "memory").toLowerCase();
    const seed = (storeType !== "firestore" && service.fixturesEnabled(storeType)) ? buildSeed() : null;
    const store = createStore({
      type: storeType,
      seed,
      prefix: process.env.CONTROL_GASTOS_FIRESTORE_PREFIX || "control_gastos",
      databaseId: process.env.CONTROL_GASTOS_FIRESTORE_DATABASE || "(default)",
    });
    maybeConfigureControlledWriter(store);
    const localQueue = process.env.CONTROL_GASTOS_LOCAL_QUEUE === "1" &&
      process.env.GCLOUD_PROJECT === "demo-control-gastos-local" &&
      /^(127\.0\.0\.1|localhost):\d+$/.test(String(process.env.FIRESTORE_EMULATOR_HOST || "")) &&
      storeType === "firestore" && !service.productionWriteEnabled()
      ? new DurableQueue(store.db, "cg_local_test") : null;
    const router = createRouter({ store, requireAuthorizedUser, queue:localQueue });
    // Auth enforced per-route inside router (Firebase AR user and/or device sync token with limited scope)
    app.use("/api/control-gastos", router);
    console.log(`Control de gastos API mounted at /api/control-gastos (store=${storeType}, db=${process.env.CONTROL_GASTOS_FIRESTORE_DATABASE || "(default)"}, production_writes=${service.productionWriteEnabled()}).`);
  } catch (e) {
    console.error("Control de gastos mount failed:", e);
  }
}

module.exports = { mountControlGastos, maybeConfigureControlledWriter };
