"use strict";

// Real Google Sheets adapter for MovimientosWriter.
// Interface: { readRange({spreadsheetId, range}), writeRange({spreadsheetId, range, values, valueInputOption}) }
// readRange returns { result: <text> } in the tabular format parsed by movimientos-writer.js:
//   "Successfully read...\n1\tcolA\tcolB...\n2\t..." (row numbers = sheet row numbers)

function parseA1Range(range) {
  // "Sheet!A1:AA1" or "Sheet!A1:AA"
  const m = /^(?:'([^']+)'|([^!]+))!([A-Z]+)(\d+)(?::([A-Z]+)(\d*))?$/.exec(String(range || ""));
  if (!m) return { sheet: String(range || "").split("!")[0], startRow: 1, endRow: null };
  const sheet = m[1] || m[2];
  const startRow = Number(m[4] || 1);
  const endRow = m[6] ? Number(m[6]) : (m[5] ? null : startRow);
  return { sheet, startRow, endRow };
}

function valuesToText(values, startRow, range) {
  const rows = Array.isArray(values) ? values : [];
  const lines = rows.map((row, i) => {
    const rn = startRow + i;
    const cells = Array.isArray(row) ? row.map(v => (v == null ? "" : String(v))) : [String(row == null ? "" : row)];
    return [rn, ...cells].join("\t");
  });
  return `Successfully read ${rows.length} rows from range '${range}'.\nEach line: sheet row number, then tab-separated cells from column A.\n` + lines.join("\n");
}

async function getToken(auth) {
  if (!auth) throw new Error("sheets_auth_missing");
  if (typeof auth === "string") return auth;
  if (typeof auth.getAccessToken === "function") {
    const t = await auth.getAccessToken();
    return (t && typeof t === "object" && t.token) ? t.token : t;
  }
  if (typeof auth.accessToken === "string") return auth.accessToken;
  if (typeof auth.token === "string") return auth.token;
  throw new Error("unsupported_auth");
}

async function sheetsFetch(fetchImpl, token, url, opts = {}) {
  const doFetch = fetchImpl || fetch;
  const res = await doFetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`sheets_http_${res.status}`);
    err.status = res.status;
    err.body = json;
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
  return json;
}

function encRange(range) {
  // encode sheet name/range for URL path segment
  return encodeURIComponent(String(range));
}

class GoogleSheetsClient {
  constructor({ auth, getAccessToken, fetchImpl } = {}) {
    this.auth = auth || (getAccessToken ? { getAccessToken } : null);
    this._fetch = fetchImpl || fetch;
  }

  async _token() { return getToken(this.auth); }

  async readRange({ spreadsheetId, range }) {
    const token = await this._token();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encRange(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
    const json = await sheetsFetch(this._fetch, token, url, { method: "GET" });
    const values = json && json.values ? json.values : [];
    const { startRow } = parseA1Range(json && json.range ? json.range : range);
    return { result: valuesToText(values, startRow, range), raw: json };
  }

  async writeRange({ spreadsheetId, range, values, valueInputOption = "RAW" }) {
    const token = await this._token();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encRange(range)}?valueInputOption=${encodeURIComponent(valueInputOption)}&includeValuesInResponse=false`;
    const json = await sheetsFetch(this._fetch, token, url, { method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values }) });
    return { result: json, raw: json };
  }
}

function createGoogleSheetsClient(opts = {}) { return new GoogleSheetsClient(opts); }

module.exports = { GoogleSheetsClient, createGoogleSheetsClient, parseA1Range, valuesToText };
