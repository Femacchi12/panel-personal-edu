const express = require('express');
const admin = require('firebase-admin');
const { google } = require('googleapis');

admin.initializeApp();

const app = express();
const PORT = Number(process.env.PORT || 8080);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://femacchi12.github.io';
const FINANCE_SPREADSHEET_ID = process.env.FINANCE_SPREADSHEET_ID || '1ff_dT8kHhiy1THTq1hRHGx2z2VElUQjyq_A4AL_nm4g';
const HEALTH_SPREADSHEET_ID = process.env.HEALTH_SPREADSHEET_ID || '1I7Z93rrr6J-0-sP9QuBtZrMuu_t1As3lik0_WK8xqMk';

const ALLOWED_EMAILS = new Set([
  'fernandoemacchi@gmail.com',
  'eduardo@fibrazo.com'
]);

const SOURCES = [
  { book: 'finance', range: 'Movimientos!A:Y' },
  { book: 'finance', range: 'Flujo_Mensual!A:J' },
  { book: 'finance', range: 'Tarjetas!A:T' },
  { book: 'finance', range: 'Cuotas!A:T' },
  { book: 'finance', range: 'Resumen_Inversiones!A:N' },
  { book: 'finance', range: 'Posiciones!A:X' },
  { book: 'finance', range: 'Pensiones_Cesantias!A:T' },
  { book: 'finance', range: 'Resumen_Ingresos!A:H' },
  { book: 'finance', range: 'Ingresos!A:T' },
  { book: 'finance', range: 'Detalle_Ingresos!A:L' },
  { book: 'finance', range: 'Resumen_Conceptos_Ingresos!A:L' },
  { book: 'finance', range: 'Nomina_Colombia!A:AI' },
  { book: 'finance', range: 'Facturas_USD!A:L' },
  { book: 'finance', range: 'Flujo_Ahorro!A:P' },
  { book: 'finance', range: 'Servicios!A:O' },
  { book: 'finance', range: 'Cuentas!A:T' },
  { book: 'finance', range: 'Plan_Mensual!A:O' },
  { book: 'finance', range: 'Patrimonio_Mensual!A:X' },
  { book: 'finance', range: 'Documentos_Financieros!A:L' },
  { book: 'finance', range: 'Documentos_Identidad!A:N' },
  { book: 'finance', range: 'Documentos_Laborales!A:L' },
  { book: 'finance', range: 'Documentos_Tributarios!A:L' },
  { book: 'finance', range: 'Documentos_Personales!A:L' },
  { book: 'finance', range: 'Vacaciones_Viajes!A:T' },
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
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: sourceList.map(item => item.range),
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE'
  });
  return response.data.valueRanges || [];
}

async function buildPayload() {
  const now = Date.now();
  if (cache.payload && now < cache.expiresAt) return cache.payload;

  const financeSources = SOURCES.filter(s => s.book === 'finance');
  const healthSources = SOURCES.filter(s => s.book === 'health');

  const [financeValues, healthValues] = await Promise.all([
    readWorkbook(FINANCE_SPREADSHEET_ID, financeSources),
    readWorkbook(HEALTH_SPREADSHEET_ID, healthSources)
  ]);

  const sources = {};
  financeSources.forEach((src, index) => {
    sources[`${FINANCE_SPREADSHEET_ID}|${src.range}`] = financeValues[index]?.values || [];
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
    revision: 'income-docs-2026-08-15'
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
  console.log(`Panel Personal backend listening on ${PORT}`);
});
