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
    // Cola operativa real (solo encolado; el consumidor corre localmente):
    const queueEnabled = !localQueue && String(process.env.CONTROL_GASTOS_QUEUE_ENABLED || "") === "1" &&
      storeType === "firestore" && !service.productionWriteEnabled();
    const realQueue = queueEnabled ? new DurableQueue(store.db, process.env.CONTROL_GASTOS_FIRESTORE_PREFIX || "control_gastos") : null;
    // Consumidor TEST (solo preprod): escritor secuencial con ADC de la SA runtime,
    // destino TEST FORZADO por env. Nunca en producción y sin canonical.
    let testConsumer = null;
    const consumerEnabled = String(process.env.CONTROL_GASTOS_TEST_CONSUMER || "") === "1";
    if (consumerEnabled && !service.productionWriteEnabled()) {
      const targetId = process.env.CONTROL_GASTOS_SHEETS_TEST_SPREADSHEET_ID || "";
      const targetSheet = process.env.CONTROL_GASTOS_SHEETS_TEST_SHEET || "Movimientos_Test";
      const enforced = String(process.env.CONTROL_GASTOS_TEST_TARGET_ENFORCED || "0") === "1";
      if (targetId && enforced) {
        try {
          let GoogleAuth;
          try { ({ GoogleAuth } = require("google-auth-library")); } catch (_) { ({ GoogleAuth } = require("googleapis").google.auth); }
          const ga = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
          const auth = { getAccessToken: async () => ga.getAccessToken() };
          const { GoogleSheetsClient } = require("./sheets-google-client");
          const { SheetsWriterClient } = require("./sheets-writer-adapter");
          const { SequentialWriter } = require("./sequential-writer");
          const sheetsClient = new GoogleSheetsClient({ auth });
          const writerClient = new SheetsWriterClient({ sheetsClient, allowRealWrites: true });
          const writer = new SequentialWriter(realQueue || localQueue, writerClient, { markPendingRegistered: true });
          testConsumer = { queue: realQueue || localQueue, writer, target: { spreadsheetId: targetId, sheet: targetSheet } };
          console.log(`Control de gastos: TEST consumer configured (destino ${targetId}/${targetSheet}, lease de exclusividad).`);
        } catch (e) {
          console.error("Control de gastos: TEST consumer NO configurado:", e && e.message);
        }
      } else {
        console.error("Control de gastos: TEST consumer requiere target TEST forzado (TEST_TARGET_ENFORCED=1).");
      }
    }
    // Consumidor CANÓNICO (producción): exige escrituras productivas habilitadas
    // (CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED=true) Y flag explícito
    // (CONTROL_GASTOS_CANONICAL_CONSUMER=1). El destino es Finanzas Edu →
    // Movimientos y el adaptador rechaza cualquier otro. Sin canonical nunca.
    // Autenticación: identidad dedicada por IMPERSONACIÓN desde la SA runtime
    // (tokenCreator a nivel de recurso; sin claves JSON).
    let canonicalConsumer = null;
    const canonicalEnabled = String(process.env.CONTROL_GASTOS_CANONICAL_CONSUMER || "") === "1";
    const canonicalWriterSa = String(process.env.CONTROL_GASTOS_CANONICAL_WRITER_SA || "").trim();
    if (canonicalEnabled && service.productionWriteEnabled() && storeType === "firestore" && canonicalWriterSa) {
      try {
        const { GoogleAuth } = require("google-auth-library");
        // Impersonación diferida (sin await en el montaje): generateAccessToken
        // de la identidad dedicada usando el ADC de la SA runtime.
        const getWriterToken = async () => {
          const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
          const { token } = await client.getAccessToken();
          const res = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(canonicalWriterSa)}:generateAccessToken`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/spreadsheets"], lifetime: "3600s" })
          });
          const j = await res.json();
          if (!j.accessToken) throw new Error(`impersonation_failed (${res.status})`);
          return j.accessToken;
        };
        const { GoogleSheetsClient } = require("./sheets-google-client");
        const { SheetsWriterClient } = require("./sheets-writer-adapter");
        const { SequentialWriter } = require("./sequential-writer");
        const canonicalQueue = new DurableQueue(store.db, process.env.CONTROL_GASTOS_FIRESTORE_PREFIX || "control_gastos", { spreadsheetId: "1ff_dT8kHhiy1THTq1hRHGx2z2VElUQjyq_A4AL_nm4g", sheet: "Movimientos" });
        const sheetsClient = new GoogleSheetsClient({ auth: { getAccessToken: getWriterToken } });
        const writerClient = new SheetsWriterClient({ sheetsClient, allowRealWrites: true, target: { canonical: true } });
        const writer = new SequentialWriter(canonicalQueue, writerClient, { markPendingRegistered: true });
        canonicalConsumer = { queue: canonicalQueue, writer, target: { spreadsheetId: "1ff_dT8kHhiy1THTq1hRHGx2z2VElUQjyq_A4AL_nm4g", sheet: "Movimientos" } };
        console.log(`Control de gastos: CANONICAL consumer configured (Finanzas Edu/Movimientos) como identidad dedicada ${canonicalWriterSa} (lease de exclusividad).`);
      } catch (e) {
        console.error("Control de gastos: CANONICAL consumer NO configurado:", e && e.message);
      }
    }
    const router = createRouter({ store, requireAuthorizedUser, queue: localQueue || realQueue, consumer: canonicalConsumer || testConsumer });
    // Auth enforced per-route inside router (Firebase AR user and/or device sync token with limited scope)
    app.use("/api/control-gastos", router);
    console.log(`Control de gastos API mounted at /api/control-gastos (store=${storeType}, db=${process.env.CONTROL_GASTOS_FIRESTORE_DATABASE || "(default)"}, production_writes=${service.productionWriteEnabled()}).`);
  } catch (e) {
    console.error("Control de gastos mount failed:", e);
  }
}

module.exports = { mountControlGastos, maybeConfigureControlledWriter };
