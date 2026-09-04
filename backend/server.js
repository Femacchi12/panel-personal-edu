const express = require('express');
const admin = require('firebase-admin');
const { google } = require('googleapis');

admin.initializeApp();

const app = express();
app.use(express.json({ limit: '16kb' }));
const PORT = Number(process.env.PORT || 8080);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://femacchi12.github.io';
const FINANCE_SPREADSHEET_ID = process.env.FINANCE_SPREADSHEET_ID || '1ff_dT8kHhiy1THTq1hRHGx2z2VElUQjyq_A4AL_nm4g';
const DOCUMENTS_SPREADSHEET_ID = process.env.DOCUMENTS_SPREADSHEET_ID || '1P8_zNStHg9v5Xm1loYvT_95TgfRWVUCOY341tyJXDV0';
const HEALTH_SPREADSHEET_ID = process.env.HEALTH_SPREADSHEET_ID || '1I7Z93rrr6J-0-sP9QuBtZrMuu_t1As3lik0_WK8xqMk';

const ALLOWED_EMAILS = new Set([
  'fernandoemacchi@gmail.com',
  'eduardo@fibrazo.com'
]);

const SOURCES = [
  { book: 'finance', range: 'Movimientos!A:Z' },
  { book: 'finance', range: 'Flujo_Mensual!A:J' },
  { book: 'finance', range: 'Tarjetas!A:T' },
  { book: 'finance', range: 'Cuotas!A:T' },
  { book: 'finance', range: 'Pagos_Tarjetas!A:T' },
  { book: 'finance', range: 'Posiciones!A:O' },
  { book: 'finance', range: 'Pensiones_Cesantias!A:T' },
  { book: 'finance', range: 'Resumen_Ingresos!A:H' },
  { book: 'finance', range: 'Ingresos!A:T' },
  { book: 'finance', range: 'Detalle_Ingresos!A:L' },
  { book: 'finance', range: 'Resumen_Conceptos_Ingresos!A:L' },
  { book: 'finance', range: 'Nomina_Colombia!A:AI' },
  { book: 'finance', range: 'Facturas_USD!A:L' },
  { book: 'finance', range: 'Flujo_Ahorro!A:W' },
  { book: 'finance', range: 'Flujo_Inversiones!A:M' },
  { book: 'finance', range: 'Config!A:C' },
  { book: 'finance', range: 'Tipos_Cambio!A:F' },
  { book: 'finance', range: 'Simulador_TC!A:J' },
  { book: 'finance', range: 'Servicios!A:O' },
  { book: 'finance', range: 'Referencias_Personales!A:N' },
  { book: 'finance', range: 'Cuentas!A:T' },
  { book: 'finance', range: 'Patrimonio_Mensual!A:AF' },
  { book: 'finance', range: 'Patrimonio_Detalle!A:N' },
  { book: 'finance', range: 'Patrimonio_Inversiones!A:K' },
  { book: 'finance', range: 'Vacaciones_Viajes!A:T' },
  { book: 'finance', range: 'Beneficios_Laborales!A:O' },
  { book: 'documents', range: 'Documentos_Master!A:R' },
  { book: 'health', range: 'Pacientes!A:X' },
  { book: 'health', range: 'Citas_Medicas!A:N' },
  { book: 'health', range: 'Tratamientos!A:X' },
  { book: 'health', range: 'Estudios_Resultados!A:X' },
  { book: 'health', range: 'Eventos_Salud!A:X' },
  { book: 'health', range: 'Mediciones!A:X' },
  { book: 'health', range: 'Documentos!A:X' }
];

const googleAuth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth: googleAuth });

let cache = { expiresAt: 0, payload: null };
let buildPromise = null;

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function errorMessage(error) { return String(error?.message || error || 'Error de lectura'); }

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === FRONTEND_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

async function requireAuthorizedUser(req, res, next) {
  try {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'missing_token' });
    const decoded = await admin.auth().verifyIdToken(header.slice(7));
    const email = normalizeEmail(decoded.email);
    if (!decoded.email_verified || !ALLOWED_EMAILS.has(email)) return res.status(403).json({ error: 'email_not_allowed' });
    req.user = { uid: decoded.uid, email };
    next();
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(401).json({ error: 'invalid_token' });
  }
}

async function readWorkbook(spreadsheetId, sourceList) {
  if (!sourceList.length) return { valueRanges: [], errors: [] };
  try {
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: sourceList.map(item => item.range),
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE'
    });
    return { valueRanges: response.data.valueRanges || [], errors: [] };
  } catch (batchError) {
    console.warn(`Batch read failed for ${spreadsheetId}; retrying ranges individually:`, errorMessage(batchError));
    const settled = await Promise.allSettled(sourceList.map(item => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: item.range,
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE'
    })));
    let failures = 0;
    const errors = [];
    const valueRanges = settled.map((result, index) => {
      const range = sourceList[index].range;
      if (result.status === 'fulfilled') return { range, majorDimension: 'ROWS', values: result.value.data.values || [] };
      failures += 1;
      const message = errorMessage(result.reason);
      errors.push({ range, message });
      console.warn(`Source unavailable ${spreadsheetId} · ${range}:`, message);
      return { range, majorDimension: 'ROWS', values: [] };
    });
    if (failures === sourceList.length) throw batchError;
    return { valueRanges, errors };
  }
}

async function readRangeUnformatted(spreadsheetId, range) {
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range, majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE' });
    return response.data.values || [];
  } catch (error) {
    console.warn(`Optional unformatted range unavailable ${spreadsheetId} · ${range}:`, errorMessage(error));
    return [];
  }
}

function patchPensionUsdColumns(financeSources, financeValues, rawUsdValues) {
  const sourceIndex = financeSources.findIndex(source => source.range === 'Pensiones_Cesantias!A:T');
  const values = sourceIndex >= 0 ? financeValues[sourceIndex]?.values : null;
  if (!Array.isArray(values) || !Array.isArray(rawUsdValues)) return;
  for (let rowIndex = 1; rowIndex < Math.min(values.length, rawUsdValues.length); rowIndex += 1) {
    const row = values[rowIndex], rawRow = rawUsdValues[rowIndex];
    if (!Array.isArray(row) || !Array.isArray(rawRow)) continue;
    while (row.length < 19) row.push('');
    if (rawRow[0] !== '' && rawRow[0] != null) row[17] = rawRow[0];
    if (rawRow[1] !== '' && rawRow[1] != null) row[18] = rawRow[1];
  }
}

function attachSourceErrors(target, spreadsheetId, result) {
  (result?.errors || []).forEach(item => {
    target[`${spreadsheetId}|${item.range}`] = item.message;
  });
}

async function buildPayload(force = false) {
  const now = Date.now();
  if (!force && cache.payload && now < cache.expiresAt) return cache.payload;
  if (buildPromise) return buildPromise;

  buildPromise = (async () => {
    const financeSources = SOURCES.filter(s => s.book === 'finance');
    const documentSources = SOURCES.filter(s => s.book === 'documents');
    const healthSources = SOURCES.filter(s => s.book === 'health');
    const [financeResult, documentResult, healthResult, pensionUsdValues] = await Promise.all([
      readWorkbook(FINANCE_SPREADSHEET_ID, financeSources),
      readWorkbook(DOCUMENTS_SPREADSHEET_ID, documentSources),
      readWorkbook(HEALTH_SPREADSHEET_ID, healthSources),
      readRangeUnformatted(FINANCE_SPREADSHEET_ID, 'Pensiones_Cesantias!R:S')
    ]);
    const financeValues = financeResult.valueRanges;
    const documentValues = documentResult.valueRanges;
    const healthValues = healthResult.valueRanges;
    patchPensionUsdColumns(financeSources, financeValues, pensionUsdValues);

    const sources = {};
    financeSources.forEach((src, index) => { sources[`${FINANCE_SPREADSHEET_ID}|${src.range}`] = financeValues[index]?.values || []; });
    documentSources.forEach((src, index) => { sources[`${DOCUMENTS_SPREADSHEET_ID}|${src.range}`] = documentValues[index]?.values || []; });
    healthSources.forEach((src, index) => { sources[`${HEALTH_SPREADSHEET_ID}|${src.range}`] = healthValues[index]?.values || []; });

    const sourceErrors = {};
    attachSourceErrors(sourceErrors, FINANCE_SPREADSHEET_ID, financeResult);
    attachSourceErrors(sourceErrors, DOCUMENTS_SPREADSHEET_ID, documentResult);
    attachSourceErrors(sourceErrors, HEALTH_SPREADSHEET_ID, healthResult);

    const payload = { ok: true, generatedAt: new Date().toISOString(), sources, sourceErrors };
    cache = { expiresAt: Date.now() + 60_000, payload };
    return payload;
  })();

  try {
    return await buildPromise;
  } finally {
    buildPromise = null;
  }
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'panel-personal-edu-backend', sourceCount: SOURCES.length, revision: 'income-savings-consolidation-2026-09-04' });
});

app.get('/api/data', requireAuthorizedUser, async (req, res) => {
  try {
    const payload = await buildPayload(String(req.query.refresh || '') === '1');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(payload);
  } catch (error) {
    console.error('Sheets error:', error);
    const status = error?.code === 403 ? 403 : 500;
    res.status(status).json({ error: 'sheets_read_failed', message: errorMessage(error) });
  }
});

app.post('/api/settings/savings-target', requireAuthorizedUser, async (req, res) => {
  const value = Number(req.body?.value);
  if (!Number.isFinite(value) || value < 0 || value > 0.9) {
    return res.status(400).json({ error: 'invalid_savings_target', message: 'La meta debe estar entre 0 y 0,9.' });
  }
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: FINANCE_SPREADSHEET_ID,
      range: 'Config!B17',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[value]] }
    });
    cache = { expiresAt: 0, payload: null };
    return res.json({ ok: true, value });
  } catch (error) {
    console.error('Savings target update error:', error);
    const status = error?.code === 403 ? 403 : 500;
    return res.status(status).json({ error: 'savings_target_write_failed', message: errorMessage(error) });
  }
});

app.listen(PORT, '0.0.0.0', () => { console.log(`Panel Personal Edu backend listening on ${PORT}`); });