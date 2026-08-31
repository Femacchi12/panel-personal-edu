const express = require('express');
const admin = require('firebase-admin');
const { google } = require('googleapis');

admin.initializeApp();

const app = express();
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
  { book: 'finance', range: 'Resumen_Inversiones!A:N' },
  { book: 'finance', range: 'Posiciones!A:X' },
  { book: 'finance', range: 'Pensiones_Cesantias!A:T' },
  { book: 'finance', range: 'Cortes_Pension_Cesantias!A:R' },
  { book: 'finance', range: 'Resumen_Ingresos!A:H' },
  { book: 'finance', range: 'Ingresos!A:T' },
  { book: 'finance', range: 'Detalle_Ingresos!A:L' },
  { book: 'finance', range: 'Resumen_Conceptos_Ingresos!A:L' },
  { book: 'finance', range: 'Nomina_Colombia!A:AI' },
  { book: 'finance', range: 'Facturas_USD!A:L' },
  { book: 'finance', range: 'Flujo_Ahorro!A:P' },
  { book: 'finance', range: 'Simulador_TC!A:J' },
  { book: 'finance', range: 'Servicios!A:O' },
  { book: 'finance', range: 'Cuentas!A:T' },
  { book: 'finance', range: 'Patrimonio_Mensual!A:X' },
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

const googleAuth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});
const sheets = google.sheets({ version: 'v4', auth: googleAuth });

let cache = { expiresAt: 0, payload: null };

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === FRONTEND_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

async function requireAuthorizedUser(req, res, next) {
  try {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'missing_token' });
    }
    const idToken = header.slice(7);
    const decoded = await admin.auth().verifyIdToken(idToken);
    const email = normalizeEmail(decoded.email);
    if (!decoded.email_verified || !ALLOWED_EMAILS.has(email)) {
      return res.status(403).json({ error: 'email_not_allowed' });
    }
    req.user = { uid: decoded.uid, email };
    next();
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(401).json({ error: 'invalid_token' });
  }
}

async function readWorkbook(spreadsheetId, sourceList) {
  if (!sourceList.length) return [];
  try {
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: sourceList.map(item => item.range),
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE'
    });
    return response.data.valueRanges || [];
  } catch (batchError) {
    console.warn(`Batch read failed for ${spreadsheetId}; retrying ranges individually:`, batchError?.message || batchError);
    const settled = await Promise.allSettled(sourceList.map(item => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: item.range,
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE'
    })));
    let failures = 0;
    const valueRanges = settled.map((result, index) => {
      if (result.status === 'fulfilled') {
        return {
          range: sourceList[index].range,
          majorDimension: 'ROWS',
          values: result.value.data.values || []
        };
      }
      failures += 1;
      console.warn(`Source unavailable ${spreadsheetId} · ${sourceList[index].range}:`, result.reason?.message || result.reason);
      return {
        range: sourceList[index].range,
        majorDimension: 'ROWS',
        values: []
      };
    });
    if (failures === sourceList.length) throw batchError;
    return valueRanges;
  }
}

async function readRangeUnformatted(spreadsheetId, range) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      majorDimension: 'ROWS',
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    return response.data.values || [];
  } catch (error) {
    console.warn(`Optional unformatted range unavailable ${spreadsheetId} · ${range}:`, error?.message || error);
    return [];
  }
}

function patchPensionUsdColumns(financeSources, financeValues, rawUsdValues) {
  const sourceIndex = financeSources.findIndex(source => source.range === 'Pensiones_Cesantias!A:T');
  const values = sourceIndex >= 0 ? financeValues[sourceIndex]?.values : null;
  if (!Array.isArray(values) || !Array.isArray(rawUsdValues)) return;

  for (let rowIndex = 1; rowIndex < Math.min(values.length, rawUsdValues.length); rowIndex += 1) {
    const row = values[rowIndex];
    const rawRow = rawUsdValues[rowIndex];
    if (!Array.isArray(row) || !Array.isArray(rawRow)) continue;
    while (row.length < 19) row.push('');
    if (rawRow[0] !== '' && rawRow[0] != null) row[17] = rawRow[0];
    if (rawRow[1] !== '' && rawRow[1] != null) row[18] = rawRow[1];
  }
}

async function buildPayload() {
  const now = Date.now();
  if (cache.payload && now < cache.expiresAt) return cache.payload;

  const financeSources = SOURCES.filter(s => s.book === 'finance');
  const documentSources = SOURCES.filter(s => s.book === 'documents');
  const healthSources = SOURCES.filter(s => s.book === 'health');

  const [financeValues, documentValues, healthValues, pensionUsdValues] = await Promise.all([
    readWorkbook(FINANCE_SPREADSHEET_ID, financeSources),
    readWorkbook(DOCUMENTS_SPREADSHEET_ID, documentSources),
    readWorkbook(HEALTH_SPREADSHEET_ID, healthSources),
    readRangeUnformatted(FINANCE_SPREADSHEET_ID, 'Pensiones_Cesantias!R:S')
  ]);

  // Google Sheets conserva valores numéricos correctos en R:S, pero su capa de
  // formato devuelve #VALUE! para estas dos columnas. Sustituimos únicamente
  // esas celdas por los valores numéricos efectivos antes de exponer el payload.
  patchPensionUsdColumns(financeSources, financeValues, pensionUsdValues);

  const sources = {};
  financeSources.forEach((src, index) => {
    sources[`${FINANCE_SPREADSHEET_ID}|${src.range}`] = financeValues[index]?.values || [];
  });
  documentSources.forEach((src, index) => {
    sources[`${DOCUMENTS_SPREADSHEET_ID}|${src.range}`] = documentValues[index]?.values || [];
  });
  healthSources.forEach((src, index) => {
    sources[`${HEALTH_SPREADSHEET_ID}|${src.range}`] = healthValues[index]?.values || [];
  });

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    sources
  };
  cache = { expiresAt: now + 60_000, payload };
  return payload;
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'panel-personal-edu-backend',
    sourceCount: SOURCES.length,
    revision: 'resilient-source-payload-2026-08-31'
  });
});

app.get('/api/data', requireAuthorizedUser, async (req, res) => {
  try {
    const payload = await buildPayload();
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(payload);
  } catch (error) {
    console.error('Sheets error:', error);
    const status = error?.code === 403 ? 403 : 500;
    res.status(status).json({
      error: 'sheets_read_failed',
      message: String(error?.message || error)
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Panel Personal Edu backend listening on ${PORT}`);
});
