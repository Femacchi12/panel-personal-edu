(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  let orderFrame = 0;
  let observedRoot = null;
  let observer = null;
  let selectedDayKey = '';
  let detailVersion = 0;
  let lastPayload = null;
  let rawRows = [];

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const activeCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';
  const selectedGlobal = key => [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
    .map(el => String(el.dataset.value || '').trim()).filter(Boolean);

  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c >= 0 && d >= 0) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (c >= 0) {
      const p = s.split(',');
      s = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g, '') + '.' + p[1] : s.replace(/,/g, '');
    } else if (d >= 0) {
      const p = s.split('.');
      if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g, '');
    }
    const out = Number(s);
    return Number.isFinite(out) ? out : 0;
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((key, index) => [key || `Col ${index + 1}`, row?.[index] ?? ''])));
  }

  function parseDate(value) {
    const s = String(value || '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }

  const rowDate = row => parseDate(row['Fecha real'] || row['Fecha registrada']);
  const rowDateKey = row => {
    const d = rowDate(row);
    return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  };

  function scopeOf(row) {
    const explicit = norm(row['Ámbito'] || row.Ambito);
    if (explicit.includes('fibrazo')) return 'FIBRAZO';
    if (explicit.includes('personal')) return 'Personal';
    const fallback = norm([row['Descripción / Comercio'], row['Descripción original'], row.Observaciones, row.Fuente].filter(Boolean).join(' '));
    return fallback.includes('fibrazo') ? 'FIBRAZO' : 'Personal';
  }

  function account(row) {
    const raw = String(row['Cuenta / Tarjeta'] || '').trim(), n = norm(raw), holder = norm(row.Titular);
    if (n.includes('efectivo')) return 'Efectivo';
    if (n.includes('nequi')) return holder.includes('ro') ? 'Nequi Ro' : 'Nequi Edu';
    if (n.includes('arq')) return 'ARQ Edu';
    if (n.includes('nu')) return (n.includes(' ro') || n.endsWith('ro') || holder === 'ro' || holder.includes('rocio')) ? 'Nu Ro' : 'Nu Edu';
    return raw || 'Sin especificar';
  }

  function method(row) {
    if (typeof window.FinancePurchasePolicy?.method === 'function') return window.FinancePurchasePolicy.method(row);
    const explicit = String(row['Modalidad de pago'] || '').trim();
    if (explicit) return explicit;
    const raw = norm(row['Cuenta / Tarjeta']);
    if (raw.includes('credito')) return 'Crédito';
    if (raw.includes('transferencia')) return 'Transferencia';
    if (raw.includes('debito')) return 'Débito';
    if (raw.includes('efectivo')) return 'Efectivo';
    return num(row.Cuotas) > 0 && (raw.includes('nu') || raw.includes('arq')) ? 'Crédito' : 'Sin especificar';
  }

  function isActualExpense(row) {
    const actual = window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad|pendiente/.test(norm(row.Estado));
    if (!actual) return false;
    const type = norm(row.Tipo || row.Naturaleza || 'gasto');
    return type.includes('gasto') || type.includes('egreso') || type.includes('compra') || !String(row.Tipo || '').trim();
  }

  function filterContext() {
    const payment = window.__PAYMENT_FILTER_STATE__?.view === 'gastos' ? window.__PAYMENT_FILTER_STATE__ : { account: [], method: [] };
    return {
      years: new Set(selectedGlobal('year')),
      months: new Set(selectedGlobal('month')),
      categories: new Set(selectedGlobal('category')),
      subcategories: new Set(selectedGlobal('subcategory')),
      accounts: new Set(payment.account || []),
      methods: new Set(payment.method || []),
      scope: window.__FINANCE_SCOPE_FILTER_STATE__?.gastos || 'Personal'
    };
  }

  function matches(row, ctx) {
    if (!isActualExpense(row)) return false;
    if (ctx.scope !== 'Todos' && scopeOf(row) !== ctx.scope) return false;
    const d = rowDate(row);
    if (ctx.years.size && (!d || !ctx.years.has(String(d.getFullYear())))) return false;
    if (ctx.months.size && (!d || !ctx.months.has(String(d.getMonth() + 1)))) return false;
    if (ctx.categories.size && !ctx.categories.has(String(row['Categoría'] || ''))) return false;
    if (ctx.subcategories.size && !ctx.subcategories.has(String(row['Subcategoría'] || ''))) return false;
    if (ctx.accounts.size && !ctx.accounts.has(account(row))) return false;
    if (ctx.methods.size && !ctx.methods.has(method(row))) return false;
    return true;
  }

  function amount(row, currency = activeCurrency()) {
    if (currency === 'USD') return num(row['Monto USD']);
    if (currency === 'ARS') return num(row['Monto ARS']);
    return num(row['Monto COP']);
  }

  function money(value, currency = activeCurrency()) {
    const digits = currency === 'USD' ? 2 : 0;
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value) || 0);
  }

  function injectStyles() {
    if (document.getElementById('expenseInteractionsStyles')) return;
    const style = document.createElement('style');
    style.id = 'expenseInteractionsStyles';
    style.textContent = `
      #spendDayDetail{margin:14px 0 0;border-top:1px solid #172437;padding-top:12px}
      #spendDayDetail .spend-day-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
      #spendDayDetail .spend-day-detail-title{display:grid;gap:3px}
      #spendDayDetail .spend-day-detail-title span{font-size:9px;font-weight:800;letter-spacing:.06em;color:#63a1ff;text-transform:uppercase}
      #spendDayDetail .spend-day-detail-title strong{font-size:13px;color:#eef5ff}
      #spendDayDetail .spend-day-detail-title small{font-size:9px;color:#788aa2}
      #spendDayDetail .spend-day-detail-close{border:1px solid #26384e;background:#0c1622;color:#9fb4cf;border-radius:8px;padding:6px 9px;font-size:9px;font-weight:800;cursor:pointer}
      #spendDayDetail .spend-day-detail-close:hover{border-color:#3d5f87;color:#dcecff}
      #spendDayDetail .spend-day-detail-scroll{overflow:auto;border:1px solid #172437;border-radius:10px}
      #spendDayDetail table{width:100%;border-collapse:collapse;font-size:10px;min-width:860px}
      #spendDayDetail th,#spendDayDetail td{padding:8px 9px;border-bottom:1px solid #132033;text-align:left;white-space:nowrap}
      #spendDayDetail th{font-size:8px;text-transform:uppercase;letter-spacing:.05em;color:#7890ad;background:#0d1622}
      #spendDayDetail td{color:#c7d3e2}
      #spendDayDetail td:last-child,#spendDayDetail th:last-child{text-align:right}
      #spendDayDetail tbody tr:last-child td{border-bottom:0}
      #spendDayDetail .scope-badge{display:inline-flex;padding:3px 7px;border-radius:999px;border:1px solid #25364b;font-size:8px;font-weight:800}
      #spendDayDetail .scope-badge.fibrazo{color:#ffd66b;border-color:#594719;background:rgba(246,200,68,.08)}
      #spendDayDetail .scope-badge.personal{color:#83d7ff;border-color:#214e67;background:rgba(34,211,238,.06)}
      @media(max-width:700px){#spendDayDetail .spend-day-detail-head{flex-direction:column}#spendDayDetail .spend-day-detail-close{align-self:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function applyCardOrder() {
    if (activeView() !== 'gastos') return;
    const grid = document.querySelector('#viewRoot > .finance-context .finance-context-grid');
    if (!grid) return;
    const cards = [...grid.children].filter(node => node.matches?.('.finance-context-item'));
    const keyOf = card => norm(card.querySelector('span')?.textContent);
    const wanted = ['total gastado', 'mayor gasto', 'supermercado', 'servicios'];
    const map = new Map(cards.map(card => [keyOf(card), card]));
    const ordered = wanted.map(key => map.get(key)).filter(Boolean);
    if (ordered.length !== wanted.length) return;
    const current = cards.slice(0, ordered.length);
    if (current.every((card, index) => card === ordered[index])) return;
    ordered.forEach(card => grid.appendChild(card));
  }

  function scheduleCardOrder() {
    if (orderFrame) return;
    orderFrame = requestAnimationFrame(() => {
      orderFrame = 0;
      applyCardOrder();
      ensureObserver();
    });
  }

  function ensureObserver() {
    const root = document.getElementById('viewRoot');
    if (!root || root === observedRoot) return;
    observer?.disconnect();
    observedRoot = root;
    observer = new MutationObserver(() => scheduleCardOrder());
    observer.observe(root, { childList: true, subtree: true });
  }

  function closeDayDetail() {
    selectedDayKey = '';
    detailVersion++;
    document.getElementById('spendDayDetail')?.remove();
  }

  function dailyModeActive() {
    return activeView() === 'gastos' && document.querySelector('[data-spend-mode="daily"]')?.classList.contains('active');
  }

  async function loadRows() {
    const getData = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getData !== 'function') return [];
    const payload = await getData(false);
    if (payload !== lastPayload) {
      lastPayload = payload;
      const cached = window.__PANEL_GET_CACHED_ROWS__;
      if (typeof cached === 'function') {
        const wide = cached(payload, financeId, 'Movimientos!A:AA');
        rawRows = wide.length ? wide : cached(payload, financeId, 'Movimientos!A:Z');
      } else {
        rawRows = parseRows(payload?.sources?.[`${financeId}|Movimientos!A:AA`] || payload?.sources?.[`${financeId}|Movimientos!A:Z`] || []);
      }
    }
    return rawRows;
  }

  function dayLabel(year, month, day) {
    return new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day));
  }

  function renderDayDetail(rows, year, month, day, currency, version) {
    if (version !== detailVersion || !dailyModeActive()) return;
    const canvas = document.getElementById('spendChart');
    const panel = canvas?.closest('.panel');
    if (!panel) return;
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (key !== selectedDayKey) return;
    const data = rows
      .filter(row => rowDateKey(row) === key)
      .slice()
      .sort((a, b) => amount(b, currency) - amount(a, currency));
    const total = data.reduce((sum, row) => sum + amount(row, currency), 0);
    let host = panel.querySelector('#spendDayDetail');
    if (!host) {
      host = document.createElement('div');
      host.id = 'spendDayDetail';
      panel.appendChild(host);
    }
    host.innerHTML = `<div class="spend-day-detail-head"><div class="spend-day-detail-title"><span>DETALLE DEL DÍA</span><strong>${esc(dayLabel(year, month, day))}</strong><small>${data.length} movimiento${data.length === 1 ? '' : 's'} · Total ${esc(money(total, currency))}</small></div><button type="button" class="spend-day-detail-close" data-close-spend-day>Cerrar</button></div><div class="spend-day-detail-scroll"><table><thead><tr><th>Categoría</th><th>Subcategoría</th><th>Descripción</th><th>Cuenta / Tarjeta</th><th>Modalidad</th><th>Titular</th><th>Ámbito</th><th>Monto ${esc(currency)}</th></tr></thead><tbody>${data.map(row => {
      const scope = scopeOf(row);
      return `<tr><td>${esc(row['Categoría'] || '—')}</td><td>${esc(row['Subcategoría'] || '—')}</td><td>${esc(row['Descripción / Comercio'] || '—')}</td><td>${esc(row['Cuenta / Tarjeta'] || '—')}</td><td>${esc(method(row))}</td><td>${esc(row.Titular || '—')}</td><td><span class="scope-badge ${scope === 'FIBRAZO' ? 'fibrazo' : 'personal'}">${esc(scope)}</span></td><td><strong>${esc(money(amount(row, currency), currency))}</strong></td></tr>`;
    }).join('') || '<tr><td colspan="8">Sin movimientos para este día y filtros.</td></tr>'}</tbody></table></div>`;
    host.querySelector('[data-close-spend-day]')?.addEventListener('click', closeDayDetail);
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function openDay(year, month, day) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (selectedDayKey === key) {
      closeDayDetail();
      return;
    }
    selectedDayKey = key;
    const version = ++detailVersion;
    const rows = await loadRows();
    if (version !== detailVersion || selectedDayKey !== key) return;
    const filtered = rows.filter(row => matches(row, filterContext()));
    renderDayDetail(filtered, year, month, day, activeCurrency(), version);
  }

  function handleChartClick(event) {
    if (!dailyModeActive() || event.target?.id !== 'spendChart' || !window.Chart) return;
    const years = selectedGlobal('year'), months = selectedGlobal('month');
    if (years.length !== 1 || months.length !== 1) return;
    const chart = Chart.getChart(event.target);
    if (!chart || chart.config.type !== 'bar') return;
    const elements = chart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, true);
    const index = elements?.[0]?.index;
    if (!Number.isInteger(index)) return;
    openDay(Number(years[0]), Number(months[0]), index + 1).catch(error => console.error('Detalle diario de gastos:', error));
  }

  function handleModeClick(event) {
    const button = event.target.closest?.('[data-spend-mode]');
    if (!button) return;
    if (button.dataset.spendMode !== 'daily') closeDayDetail();
  }

  function resetOnContextChange() {
    closeDayDetail();
    scheduleCardOrder();
  }

  injectStyles();
  document.addEventListener('click', handleChartClick);
  document.addEventListener('click', handleModeClick, true);
  document.addEventListener('panel:view-root-changed', event => {
    if (event.detail?.view === 'gastos') scheduleCardOrder();
    else closeDayDetail();
  });
  document.addEventListener('panel:section-modules-ready', event => { if (event.detail?.view === 'gastos') scheduleCardOrder(); });
  document.addEventListener('panel:filters-updated', () => { if (activeView() === 'gastos') resetOnContextChange(); });
  document.addEventListener('panel:payment-filters-changed', event => { if (event.detail?.view === 'gastos') resetOnContextChange(); });
  document.addEventListener('panel:expense-scope-changed', event => { if (event.detail?.view === 'gastos') resetOnContextChange(); });
  document.addEventListener('panel:backend-data-loaded', () => { lastPayload = null; rawRows = []; if (activeView() === 'gastos') resetOnContextChange(); });
  document.addEventListener('click', event => { if (event.target.closest?.('.currency-btn') && activeView() === 'gastos') closeDayDetail(); }, true);
  queueMicrotask(scheduleCardOrder);
})();