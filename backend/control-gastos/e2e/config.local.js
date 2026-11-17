"use strict";

window.PANEL_CONFIG = {
  // Same origin as the isolated local harness. Never the Cloud Run URL.
  apiBaseUrl: "",
  authProvider: "local-e2e-isolated",
  allowedEmails: ["fernandoemacchi@gmail.com"],
  financeSpreadsheetId: "",
  documentsSpreadsheetId: "",
  healthSpreadsheetId: "",
  autoRefreshMinutes: 0,
  timezone: "America/Bogota",
  primaryCurrency: "COP"
};
window.__PANEL_LOCAL_E2E__ = true;
// Synthetic bearer token understood only by the loopback harness server.
window.__PANEL_GET_ID_TOKEN__ = async () => "local-e2e";
