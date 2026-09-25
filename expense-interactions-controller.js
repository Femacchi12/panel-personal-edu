(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  const MONTH_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const MONTH_MAP = {ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};

  let orderFrame = 0;
  let observedRoot = null;
  let observer = null;
  let selectedKey = '';
  let selectedGranularity = '';
  let detailVersion = 0;
  let lastPayload = null;
  let rawRows = [];

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const activeCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';
  const selectedGlobal = key => [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
    .map(el => String(el.dataset.value || '').trim()).filter(Boolean);

  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c >= 0 && d >= 0) s = c > d ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'');
    else if (c >= 0) {
      const p = s.split(',');
      s = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g,'') + '.' + p[1] : s.replace(/,/g,'');
    } else if (d >= 0) {
      const p = s.split('.');
      if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g,'');
    }
    const out = Number(s);
    return Number.isFinite(out) ? out : 0;
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((key,index) => [key || `Col ${index + 1}`,row?.[index] ?? ''])));
  }

  function parseDate(value) {
    const s = String(value || '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1],+m[2]-1,+m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? new Date(+m[3],+m[2]-1,+m[1]) : null;
  }

  function periodKey(value) {
    const s = norm(value);
    let m = s.match(/^(20\d{2})-(\d{1,2})/);
    if (m) return `${m[1]}-${String(+m[2]).padStart(2,'0')}`;
    m = s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[\s-]+(20\d{2})/);
    return m ? `${m[2]}-${String(MONTH_MAP[m[1]]).padStart(2,'0')}` : '';
  }

  function rowPeriod(row) {
    const explicit = periodKey(row['Mes consumo'] || row['Mes pago']);
    if (explicit) return explicit;
    const d = parseDate(row['Fecha real'] || row['Fecha registrada']);
    return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` : '';
  }

  function rowDateInPeriod(row, period) {
    const real = parseDate(row['Fecha real']);
    if (real) {
      const key = `${real.getFullYear()}-${String(real.getMonth()+1).padStart(2,'0')}`;
      return key === period ? real : null;
    }
    const registered = parseDate(row['Fecha registrada']);
    if (registered) {
      const key = `${registered.getFullYear()}-${String(registered.getMonth()+1).padStart(2,'0')}`;
      return key === period ? registered : null;
    }
    return null;
  }

  function scopeOf(row) {
    if (window.FinanceScopeCore?.scopeOf) return window.FinanceScopeCore.scopeOf(row);
    const explicit = norm(row['Ámbito'] || row.Ambito);
    if (explicit.includes('fibrazo')) return 'FIBRAZO';
    if (explicit.includes('personal')) return 'Personal';
    const marker = norm(row.Observaciones);
    return marker.includes('ambito explicito: fibrazo') ? 'FIBRAZO' : 'Personal';
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
    const payment = window.__PAYMENT_FILTER_STATE__?.view === 'gastos' ? window.__PAYMENT_FILTER_STATE__ : {account:[],method:[]};
    return {
      years:new Set(selectedGlobal('year')),
      months:new Set(selectedGlobal('month').map(v => String(Number(v)))),
      categories:new Set(selectedGlobal('category')),
      subcategories:new Set(selectedGlobal('subcategory')),
      accounts:new Set(payment.account || []),
      methods:new Set(payment.method || []),
      scope:window.FinanceScopeCore?.getScope?.('gastos') || window.__FINANCE_SCOPE_FILTER_STATE__?.gastos || 'Personal'
    };
  }

  function matches(row,ctx) {
    if (!isActualExpense(row)) return false;
    if (ctx.scope !== 'Todos' && scopeOf(row) !== ctx.scope) return false;
    const period = rowPeriod(row), pm = period.match(/^(20\d{2})-(\d{2})$/);
    if (ctx.years.size && (!pm || !ctx.years.has(pm[1]))) return false;
    if (ctx.months.size && (!pm || !ctx.months.has(String(+pm[2])))) return false;
    if (ctx.categories.size && !ctx.categories.has(String(row['Categoría'] || ''))) return false;
    if (ctx.subcategories.size && !ctx.subcategories.has(String(row['Subcategoría'] || ''))) return false;
    if (ctx.accounts.size && !ctx.accounts.has(account(row))) return false;
    if (ctx.methods.size && !ctx.methods.has(method(row))) return false;
    return true;
  }

  function amount(row,currency = activeCurrency()) {
    if (currency === 'USD') return num(row['Monto USD']);
    if (currency === 'ARS') return num(row['Monto ARS']);
    return num(row['Monto COP']);
  }

  function money(value,currency = activeCurrency()) {
    const digits = currency === 'USD' ? 2 : 0;
    return new Intl.NumberFormat('es-CO',{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value) || 0);
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
      #spendDayDetail table{width:100%;border-collapse:collapse;min-width:900px}
      #spendDayDetail th{padding:8px 9px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.04em;color:#71849d;background:#0b131e}
      #spendDayDetail td{padding:8px 9px;border-top:1px solid #142033;font-size:9px;color:#a8b7ca}
      #spendDayDetail td:last-child{text-align:right;color:#eef5ff}
      #spendDayDetail .scope-badge{display:inline-flex;padding:3px 6px;border-radius:99px;border:1px solid #26384e;font-size:8px;font-weight:800}
      #spendDayDetail .scope-badge.fibrazo{color:#ffd66b;border-color:#5a461d;background:rgba(246,200,68,.08)}
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
    const wanted = ['total gastado','mayor gasto','supermercado','servicios'];
    const map = new Map(cards.map(card => [keyOf(card),card]));
    const ordered = wanted.map(key => map.get(key)).filter(Boolean);
    if (ordered.length !== wanted.length) return;
    const current = cards.slice(0,ordered.length);
    if (current.every((card,index) => card === ordered[index])) return;
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
    observer = new MutationObserver(mutations => {
      if (mutations.some(m => m.type === 'childList')) scheduleCardOrder();
    });
    observer.observe(root,{childList:true,subtree:true});
  }

  function closeDetail() {
    selectedKey = '';
    selectedGranularity = '';
    detailVersion++;
    document.getElementById('spendDayDetail')?.remove();
  }

  async function loadRows() {
    const getData = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getData !== 'function') return [];
    const payload = await getData(false);
    if (payload !== lastPayload) {
      lastPayload = payload;
      const cached = window.__PANEL_GET_CACHED_ROWS__;
      if(window.FinanceScopeCore?.movementRows) rawRows=window.FinanceScopeCore.movementRows(payload,financeId);
      else if (typeof cached === 'function') {
        const wide = cached(payload,financeId,'Movimientos!A:AA');
        rawRows = wide.length ? wide : cached(payload,financeId,'Movimientos!A:Z');
      } else {
        rawRows = parseRows(payload?.sources?.[`${financeId}|Movimientos!A:AA`] || payload?.sources?.[`${financeId}|Movimientos!A:Z`] || []);
      }
    }
    return rawRows;
  }

  function monthLabel(key) {
    const m = String(key).match(/^(20\d{2})-(\d{2})$/);
    return m ? `${MONTH_LABELS[+m[2]-1]} ${m[1]}` : key;
  }

  function dayLabel(key) {
    const m = String(key).match(/^(20\d{2})-(\d{2})-(\d{2})$/);
    if (!m) return key;
    return new Intl.DateTimeFormat('es-CO',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(+m[1],+m[2]-1,+m[3]));
  }

  function rowsForKey(rows,key,granularity) {
    if (granularity === 'month') return rows.filter(row => rowPeriod(row) === key);
    if (String(key).endsWith('|undated')) {
      const period = String(key).split('|')[0];
      return rows.filter(row => rowPeriod(row) === period && !rowDateInPeriod(row,period));
    }
    const period = String(key).slice(0,7);
    return rows.filter(row => {
      if (rowPeriod(row) !== period) return false;
      const d = rowDateInPeriod(row,period);
      if (!d) return false;
      const dateKey = `${period}-${String(d.getDate()).padStart(2,'0')}`;
      return dateKey === key;
    });
  }

  function detailTitle(key,granularity) {
    if (granularity === 'month') return {eye:'DETALLE DEL PERÍODO',title:monthLabel(key)};
    if (String(key).endsWith('|undated')) return {eye:'DETALLE DEL DÍA',title:`Sin fecha exacta · ${monthLabel(String(key).split('|')[0])}`};
    return {eye:'DETALLE DEL DÍA',title:dayLabel(key)};
  }

  function renderDetail(rows,key,granularity,currency,version) {
    if (version !== detailVersion || selectedKey !== key || selectedGranularity !== granularity) return;
    const canvas = document.getElementById('spendChart');
    const panel = canvas?.closest('.panel');
    if (!panel) return;

    const data = rowsForKey(rows,key,granularity).slice().sort((a,b) => amount(b,currency) - amount(a,currency));
    const total = data.reduce((sum,row) => sum + amount(row,currency),0);
    const labels = detailTitle(key,granularity);

    let host = panel.querySelector('#spendDayDetail');
    if (!host) {
      host = document.createElement('div');
      host.id = 'spendDayDetail';
      panel.appendChild(host);
    }

    host.innerHTML = `<div class="spend-day-detail-head"><div class="spend-day-detail-title"><span>${esc(labels.eye)}</span><strong>${esc(labels.title)}</strong><small>${data.length} movimiento${data.length === 1 ? '' : 's'} · Total ${esc(money(total,currency))}</small></div><button type="button" class="spend-day-detail-close" data-close-spend-day>Cerrar</button></div><div class="spend-day-detail-scroll"><table><thead><tr><th>Fecha</th><th>Categoría</th><th>Subcategoría</th><th>Descripción</th><th>Cuenta / Tarjeta</th><th>Modalidad</th><th>Titular</th><th>Ámbito</th><th>Monto ${esc(currency)}</th></tr></thead><tbody>${data.map(row => {
      const scope = scopeOf(row);
      const period = rowPeriod(row);
      const d = rowDateInPeriod(row,period);
      const dateText = d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : '—';
      return `<tr><td>${esc(dateText)}</td><td>${esc(row['Categoría'] || '—')}</td><td>${esc(row['Subcategoría'] || '—')}</td><td>${esc(row['Descripción / Comercio'] || '—')}</td><td>${esc(row['Cuenta / Tarjeta'] || '—')}</td><td>${esc(method(row))}</td><td>${esc(row.Titular || '—')}</td><td><span class="scope-badge ${scope === 'FIBRAZO' ? 'fibrazo' : 'personal'}">${esc(scope)}</span></td><td><strong>${esc(money(amount(row,currency),currency))}</strong></td></tr>`;
    }).join('') || '<tr><td colspan="9">Sin movimientos para este punto y filtros.</td></tr>'}</tbody></table></div>`;

    host.querySelector('[data-close-spend-day]')?.addEventListener('click',closeDetail);
    host.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  async function openKey(key,granularity) {
    if (selectedKey === key && selectedGranularity === granularity) {
      closeDetail();
      return;
    }
    selectedKey = key;
    selectedGranularity = granularity;
    const version = ++detailVersion;
    const rows = await loadRows();
    if (version !== detailVersion || selectedKey !== key || selectedGranularity !== granularity) return;
    const filtered = rows.filter(row => matches(row,filterContext()));
    renderDetail(filtered,key,granularity,activeCurrency(),version);
  }

  function handleChartClick(event) {
    if (activeView() !== 'gastos' || event.target?.id !== 'spendChart' || !window.Chart) return;
    const chart = Chart.getChart(event.target);
    if (!chart) return;
    const elements = chart.getElementsAtEventForMode(event,'nearest',{intersect:true},true);
    const index = elements?.[0]?.index;
    if (!Number.isInteger(index)) return;

    let keys = [];
    try { keys = JSON.parse(event.target.dataset.spendKeys || '[]'); } catch (_) { keys = []; }
    const key = keys[index];
    const granularity = event.target.dataset.spendGranularity || 'month';
    if (!key) return;
    openKey(String(key),String(granularity)).catch(error => console.error('Detalle del gráfico de gastos:',error));
  }

  function resetOnContextChange() {
    closeDetail();
    scheduleCardOrder();
  }

  injectStyles();
  document.addEventListener('click',handleChartClick);
  document.addEventListener('click',event => {
    if (event.target.closest?.('[data-spend-mode]')) closeDetail();
  },true);
  document.addEventListener('panel:view-root-changed',event => {
    if (event.detail?.view === 'gastos') scheduleCardOrder();
    else closeDetail();
  });
  document.addEventListener('panel:section-modules-ready',event => { if (event.detail?.view === 'gastos') scheduleCardOrder(); });
  document.addEventListener('panel:filters-updated',() => { if (activeView() === 'gastos') resetOnContextChange(); });
  document.addEventListener('panel:payment-filters-changed',event => { if (event.detail?.view === 'gastos') resetOnContextChange(); });
  document.addEventListener('panel:expense-scope-changed',event => { if (event.detail?.view === 'gastos') resetOnContextChange(); });
  document.addEventListener('panel:backend-data-loaded',() => {
    lastPayload = null;
    rawRows = [];
    if (activeView() === 'gastos') resetOnContextChange();
  });
  document.addEventListener('click',event => {
    if (event.target.closest?.('.currency-btn') && activeView() === 'gastos') closeDetail();
  },true);
  queueMicrotask(scheduleCardOrder);
})();