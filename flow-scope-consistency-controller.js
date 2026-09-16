(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  let frame = 0;
  let runVersion = 0;
  let observer = null;
  let observedRoot = null;

  const MONTH_NAMES = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

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
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  const money = value => new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(Number(value) || 0);

  function monthKey(value) {
    if (typeof window.RegularIncomeCore?.monthKey === 'function') return window.RegularIncomeCore.monthKey(value);
    const s = norm(value);
    let m = s.match(/^(20\d{2})-(\d{1,2})/);
    if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}`;
    const map = {ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    m = s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[\s-]+(20\d{2})/);
    return m ? `${m[2]}-${String(map[m[1]]).padStart(2, '0')}` : '';
  }

  const currentMonthKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const rowMonth = row => monthKey(row['Mes consumo'] || row['Mes pago'] || row['Fecha real'] || row['Fecha registrada']);
  const previousMonth = key => {
    const m = String(key).match(/^(20\d{2})-(\d{2})$/);
    if (!m) return '';
    const d = new Date(+m[1], +m[2] - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const monthLabel = key => {
    const m = String(key).match(/^(20\d{2})-(\d{2})$/);
    return m ? `${MONTH_NAMES[+m[2] - 1]} ${m[1]}` : key;
  };

  function parseDate(value) {
    const s = String(value ?? '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const dateLabel = row => {
    const d = parseDate(row['Fecha real'] || row['Fecha registrada']);
    return d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : '—';
  };

  const selectedGlobal = key => [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
    .map(el => String(el.dataset.value || '').trim()).filter(Boolean);

  function account(row) {
    const raw = String(row['Cuenta / Tarjeta'] || '').trim(), n = norm(raw), holder = norm(row.Titular);
    if (n.includes('efectivo')) return 'Efectivo';
    if (n.includes('nequi')) return holder.includes('ro') ? 'Nequi Ro' : 'Nequi Edu';
    if (n.includes('arq')) return 'ARQ Edu';
    if (n.includes('nu')) return n.includes(' ro') || holder.includes('rocio') || holder === 'ro' ? 'Nu Ro' : 'Nu Edu';
    return raw || 'Sin especificar';
  }

  function method(row) {
    if (typeof window.FinancePurchasePolicy?.method === 'function') return window.FinancePurchasePolicy.method(row);
    const explicit = String(row['Modalidad de pago'] || '').trim();
    if (explicit) return explicit;
    const n = norm(row['Cuenta / Tarjeta']);
    if (n.includes('credito')) return 'Crédito';
    if (n.includes('transferencia')) return 'Transferencia';
    if (n.includes('debito')) return 'Débito';
    if (n.includes('efectivo')) return 'Efectivo';
    return num(row.Cuotas) > 0 && (n.includes('nu') || n.includes('arq')) ? 'Crédito' : 'Sin especificar';
  }

  function scopeOf(row) {
    const explicit = norm(row['Ámbito'] || row.Ambito);
    if (explicit.includes('fibrazo')) return 'FIBRAZO';
    if (explicit.includes('personal')) return 'Personal';
    const fallback = norm([row['Descripción / Comercio'], row['Descripción original'], row.Observaciones, row.Fuente].filter(Boolean).join(' '));
    return fallback.includes('fibrazo') ? 'FIBRAZO' : 'Personal';
  }

  function filterState() {
    const payment = window.__PAYMENT_FILTER_STATE__?.view === 'flujo' ? window.__PAYMENT_FILTER_STATE__ : { account:[], method:[] };
    return {
      scope: window.__FINANCE_SCOPE_FILTER_STATE__?.flujo || 'Personal',
      years: selectedGlobal('year'),
      months: selectedGlobal('month').map(Number).filter(n => n >= 1 && n <= 12),
      categories: selectedGlobal('category'),
      subcategories: selectedGlobal('subcategory'),
      accounts: Array.isArray(payment.account) ? payment.account : [],
      methods: Array.isArray(payment.method) ? payment.method : []
    };
  }

  function matchesDimensions(row, state) {
    if (state.scope !== 'Todos' && scopeOf(row) !== state.scope) return false;
    if (state.categories.length && !state.categories.includes(String(row['Categoría'] || ''))) return false;
    if (state.subcategories.length && !state.subcategories.includes(String(row['Subcategoría'] || ''))) return false;
    if (state.accounts.length && !state.accounts.includes(account(row))) return false;
    if (state.methods.length && !state.methods.includes(method(row))) return false;
    return true;
  }

  const isActual = row => norm(row.Tipo) === 'gasto' && (window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad/.test(norm(row.Estado)));
  const isProjection = row => norm(row.Tipo) === 'gasto' && (window.MovementStatusCore?.isProjection(row.Estado) ?? /proyecc|proyect|programad/.test(norm(row.Estado)));
  const isFixed = row => /^(si|sí|true|1)$/i.test(String(row['Es fijo'] || '').trim());
  const isSuper = row => norm(row['Categoría']) === 'supermercado';
  const sum = rows => rows.reduce((total, row) => total + num(row['Monto COP']), 0);

  function targetMonth(rows, state) {
    const current = currentMonthKey();
    const keys = [...new Set(rows.map(rowMonth).filter(key => key && key <= current))].sort();
    if (state.years.length === 1 && state.months.length === 1) return `${state.years[0]}-${String(state.months[0]).padStart(2,'0')}`;
    if (state.months.length === 1) {
      const suffix = `-${String(state.months[0]).padStart(2,'0')}`;
      const match = keys.filter(key => key.endsWith(suffix) && (!state.years.length || state.years.includes(key.slice(0,4))));
      if (match.length) return match.at(-1);
    }
    if (state.years.length === 1) {
      const match = keys.filter(key => key.startsWith(`${state.years[0]}-`));
      if (match.length) return match.at(-1);
    }
    return current;
  }

  function groupTotals(actual, previous, projections) {
    const out = { super:{current:0,previous:0,projection:0}, fixed:{current:0,previous:0,projection:0}, variable:{current:0,previous:0,projection:0} };
    const add = (bucket, row) => {
      const amount = num(row['Monto COP']);
      if (isSuper(row)) out.super[bucket] += amount;
      if (isFixed(row)) out.fixed[bucket] += amount;
      if (!isFixed(row) && !isSuper(row)) out.variable[bucket] += amount;
    };
    actual.forEach(row => add('current', row));
    previous.forEach(row => add('previous', row));
    projections.forEach(row => add('projection', row));
    return out;
  }

  function monthlyStats(rows, key, state) {
    const prev = previousMonth(key), current = key === currentMonthKey();
    const actual = [], previous = [], projections = [];
    rows.forEach(row => {
      if (!matchesDimensions(row, state)) return;
      const mk = rowMonth(row);
      if (mk === key) {
        if (isActual(row)) actual.push(row);
        else if (isProjection(row)) projections.push(row);
      } else if (mk === prev && isActual(row)) previous.push(row);
    });
    projections.sort((a,b) => (parseDate(a['Fecha real'] || a['Fecha registrada'])?.getTime() || 0) - (parseDate(b['Fecha real'] || b['Fecha registrada'])?.getTime() || 0));
    const groups = groupTotals(actual, previous, projections);
    groups.super.remaining = current ? Math.max(0, groups.super.previous - groups.super.current - groups.super.projection) : 0;
    groups.fixed.remaining = current ? Math.max(0, groups.fixed.previous - groups.fixed.current - groups.fixed.projection) : 0;
    groups.variable.remaining = 0;
    const realTotal = sum(actual);
    const projectionTotal = current ? sum(projections) : 0;
    const recurringGap = current ? groups.super.remaining + groups.fixed.remaining : 0;
    return { key, prev, current, actual, previous, projections, groups, realTotal, projectionTotal, recurringGap, projectedTotal:realTotal + projectionTotal + recurringGap };
  }

  function differenceCell(current, previous) {
    const diff = current - previous;
    if (Math.abs(diff) < .5) return '<span class="monthly-diff neutral">Igual al mes pasado</span>';
    return diff < 0 ? `<span class="monthly-diff under">Faltan ${esc(money(Math.abs(diff)))}</span>` : `<span class="monthly-diff over">Supera ${esc(money(diff))}</span>`;
  }

  function projectionStatus(row) {
    const d = parseDate(row['Fecha real'] || row['Fecha registrada']);
    if (!d) return 'Proyección';
    const now = new Date(); now.setHours(0,0,0,0);
    const normalized = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (normalized.getTime() === now.getTime()) return 'Proyección hoy';
    if (normalized < now) return 'Proyección vencida';
    return 'Proyección';
  }

  function projectionEnabled(stats) {
    if (!stats.current) return false;
    const toggle = document.getElementById('monthlyProjectionToggle');
    return toggle ? Boolean(toggle.checked) : Boolean(window.__PANEL_INCLUDE_MONTHLY_PROJECTION__);
  }

  function patchMonthlyClose(root, stats, state) {
    const panel = root.querySelector('#monthlyProjectionSuite .monthly-close-panel');
    if (!panel) return;
    const on = projectionEnabled(stats);
    const considered = on ? stats.projectedTotal : stats.realTotal;
    const subtitle = panel.querySelector('.panel-title span');
    if (subtitle) subtitle.textContent = stats.current
      ? `Separa gasto real de lo que todavía falta o está proyectado · Ámbito ${state.scope}.`
      : `Mes histórico cerrado · Ámbito ${state.scope}.`;
    const cards = [...panel.querySelectorAll('.monthly-kpis > div')];
    const set = (index, label, value, meta) => {
      const card = cards[index]; if (!card) return;
      const l = card.querySelector('span'), v = card.querySelector('strong'), m = card.querySelector('small');
      if (l) l.textContent = label;
      if (v) v.textContent = money(value);
      if (m) m.textContent = meta;
    };
    set(0, stats.current ? 'Real hasta hoy' : 'Gasto real', stats.realTotal, `Solo movimientos realizados · ${state.scope}`);
    set(1, 'Proyección pendiente', stats.current ? stats.projectionTotal : 0, stats.current ? `${stats.projections.length} gasto${stats.projections.length === 1 ? '' : 's'} · ${state.scope}` : 'No aplica a meses cerrados');
    set(2, 'Faltante recurrente', stats.recurringGap, stats.current ? `Supermercado + fijos/servicios · ${state.scope}` : 'No aplica a meses cerrados');
    set(3, 'Total considerado', considered, on ? `Real + cierre estimado · ${state.scope}` : `Solo gasto real · ${state.scope}`);
  }

  function patchProgrammed(root, stats, state) {
    const panel = root.querySelector('.monthly-programmed-panel');
    if (!panel) return;
    const title = panel.querySelector('.panel-title span');
    if (title) title.textContent = stats.current ? `Pendientes conocidos para ${monthLabel(stats.key)} · Ámbito ${state.scope}.` : `Mes histórico · Ámbito ${state.scope}.`;
    const body = stats.projections.length
      ? `<div class="table-scroll"><table class="monthly-planning-table"><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Medio de pago</th><th>Ámbito</th><th>Monto</th><th>Estado</th></tr></thead><tbody>${stats.projections.map(row => `<tr><td>${esc(dateLabel(row))}</td><td>${esc(row['Categoría'] || '—')}</td><td>${esc(row['Descripción / Comercio'] || '—')}</td><td>${esc(row['Cuenta / Tarjeta'] || '—')}</td><td>${esc(scopeOf(row))}</td><td>${esc(money(num(row['Monto COP'])))}</td><td><span class="monthly-status">${esc(projectionStatus(row))}</span></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty-state"><strong>Sin proyecciones pendientes</strong><span>No hay movimientos con estado Proyección para este mes, ámbito y filtros.</span></div>';
    [...panel.children].filter(child => !child.classList.contains('panel-header')).forEach(child => child.remove());
    panel.insertAdjacentHTML('beforeend', body);
  }

  function patchComparison(root, stats, state) {
    const panel = root.querySelector('.monthly-comparison-panel');
    if (!panel) return;
    const subtitle = panel.querySelector('.panel-title span');
    if (subtitle) subtitle.textContent = `${monthLabel(stats.key)} vs ${monthLabel(stats.prev)} · Ámbito ${state.scope}.`;
    const tbody = panel.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = [
      ['Supermercado', stats.groups.super],
      ['Gastos fijos / servicios', stats.groups.fixed],
      ['Variables sin supermercado', stats.groups.variable]
    ].map(([label, g]) => `<tr><td><strong>${esc(label)}</strong></td><td>${esc(money(g.current))}</td><td>${esc(money(g.previous))}</td><td>${differenceCell(g.current, g.previous)}</td></tr>`).join('');
  }

  function contextItem(label, value, meta = '', tone = '') {
    return `<div class="finance-context-item ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`;
  }

  function patchFlowContext(root, flowRows, model, stats, state) {
    const host = root.querySelector(':scope > .finance-context');
    if (!host) return;
    const row = (flowRows || []).find(item => monthKey(item.Mes) === stats.key) || {};
    const status = String(row.Estado || (stats.current ? 'En curso' : 'Cerrado'));
    const regularIncome = model?.months?.get(stats.key)?.totalCop || num(row['Ingreso regular base COP']) || num(row['Ingresos proyectados COP']);
    const actualIncome = num(row['Ingresos reales COP']);
    const projectedIncome = num(row['Ingresos proyectados COP']) || regularIncome;
    const targetRate = num(String(row['Meta de ahorro'] || '30').replace('%','')) / 100 || .30;
    const on = projectionEnabled(stats);
    const consideredSpend = on ? stats.projectedTotal : stats.realTotal;
    const title = stats.current ? 'Mes en curso: separa lo parcial del cierre esperado' : 'Mes cerrado: resultado definitivo';
    const tone = stats.current ? 'warn' : 'good';

    if (state.scope === 'Personal') {
      const baseIncome = stats.current ? projectedIncome : (actualIncome || regularIncome);
      const consideredSaving = baseIncome - consideredSpend;
      const target = baseIncome * targetRate;
      const gap = consideredSaving - target;
      const actualSavingConfirmed = actualIncome - stats.realTotal;
      const referenceSaving = regularIncome - stats.realTotal;
      host.innerHTML = `<div class="finance-context-head"><div><span>LECTURA DEL FLUJO · ${esc(monthLabel(stats.key))}</span><strong>${esc(title)}</strong><small>Ámbito Personal · FIBRAZO queda excluido del ahorro y de la meta personal.</small></div><div class="finance-context-state ${tone}">${esc(status)}</div></div><div class="finance-context-grid">
        ${contextItem(stats.current ? 'Ingreso registrado' : 'Ingreso del mes', money(actualIncome), stats.current ? `Ingreso regular de referencia ${money(regularIncome)}` : '')}
        ${contextItem('Egreso registrado', money(stats.realTotal), on ? `Cierre considerado ${money(consideredSpend)}` : 'Solo gasto personal realizado')}
        ${contextItem(on ? 'Ahorro al cierre proyectado' : 'Ahorro sobre gasto real', money(consideredSaving), `Ingreso de referencia - ${on ? 'cierre estimado' : 'gasto realizado'}`, consideredSaving < 0 ? 'critical' : 'positive')}
        ${contextItem(`Brecha vs meta ${Math.round(targetRate * 100)}%`, money(gap), `Meta ${money(target)}`, gap < 0 ? 'alert' : 'positive')}
      </div><div class="finance-context-note"><b>Control:</b> gasto personal real ${esc(money(stats.realTotal))}; gasto FIBRAZO no entra en este ahorro. ${actualIncome <= 0 ? `El ingreso todavía no está confirmado: saldo con ingreso confirmado ${esc(money(actualSavingConfirmed))}; referencia sobre ingreso regular ${esc(money(referenceSaving))}.` : ''} ${on ? `La proyección está activa e incorpora ${esc(money(stats.projectionTotal + stats.recurringGap))} pendiente/recurrente.` : 'La proyección está apagada; el ahorro usa únicamente gasto realizado.'}</div>`;
    } else {
      const scopeLabel = state.scope === 'FIBRAZO' ? 'FIBRAZO' : 'Personal + FIBRAZO';
      host.innerHTML = `<div class="finance-context-head"><div><span>LECTURA DEL FLUJO · ${esc(monthLabel(stats.key))}</span><strong>${esc(title)}</strong><small>Ámbito ${esc(scopeLabel)} · el ahorro personal no se calcula en esta vista.</small></div><div class="finance-context-state ${tone}">${esc(status)}</div></div><div class="finance-context-grid">
        ${contextItem('Ingreso personal', '—', 'No se mezcla con gasto empresarial/reembolsable')}
        ${contextItem(state.scope === 'FIBRAZO' ? 'Egreso FIBRAZO registrado' : 'Egreso total registrado', money(stats.realTotal), on ? `Cierre considerado ${money(consideredSpend)}` : `Solo gasto realizado · ${scopeLabel}`)}
        ${contextItem('Ahorro personal', '—', 'Disponible únicamente en ámbito Personal')}
        ${contextItem(`Brecha vs meta ${Math.round(targetRate * 100)}%`, '—', 'Disponible únicamente en ámbito Personal')}
      </div><div class="finance-context-note"><b>Control:</b> los gastos FIBRAZO sí cuentan como salida de dinero y uso de tarjeta cuando fueron pagados por ti, pero son empresariales/reembolsables y no reducen tu ahorro personal.</div>`;
    }
  }

  async function getData() {
    const getter = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getter !== 'function') return null;
    const payload = await getter(false);
    const cached = window.__PANEL_GET_CACHED_ROWS__;
    const rowsAA = typeof cached === 'function' ? cached(payload, financeId, 'Movimientos!A:AA') : [];
    const rows = rowsAA.length ? rowsAA : (typeof cached === 'function' ? cached(payload, financeId, 'Movimientos!A:Z') : []);
    const flowRows = typeof cached === 'function' ? cached(payload, financeId, 'Flujo_Ahorro!A:W') : [];
    const model = typeof window.RegularIncomeCore?.build === 'function' ? window.RegularIncomeCore.build(payload, financeId) : null;
    return { rows, flowRows, model };
  }

  async function apply(version) {
    if (activeView() !== 'flujo') return;
    const root = document.getElementById('viewRoot');
    if (!root) return;
    observe(root);
    const data = await getData();
    if (!data || version !== runVersion || activeView() !== 'flujo' || !root.isConnected) return;
    const state = filterState();
    const key = targetMonth(data.rows, state);
    const stats = monthlyStats(data.rows, key, state);
    window.__PANEL_FLOW_SCOPE_AUDIT__ = Object.freeze({
      key,
      scope: state.scope,
      realTotal: stats.realTotal,
      projectionTotal: stats.projectionTotal,
      recurringGap: stats.recurringGap,
      projectedTotal: stats.projectedTotal,
      personalOnly: state.scope === 'Personal'
    });
    patchMonthlyClose(root, stats, state);
    patchProgrammed(root, stats, state);
    patchComparison(root, stats, state);
    patchFlowContext(root, data.flowRows, data.model, stats, state);
  }

  function observe(root) {
    if (observedRoot === root) return;
    observer?.disconnect();
    observedRoot = root;
    // Solo observamos inserciones/reordenamientos de bloques principales. Las actualizaciones
    // internas se atienden por eventos y no deben provocar un ciclo de render continuo.
    observer = new MutationObserver(() => schedule());
    observer.observe(root, { childList:true, subtree:false });
  }

  function schedule() {
    runVersion += 1;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const version = runVersion;
      setTimeout(() => apply(version).catch(error => console.error('Consistencia de ámbito en Flujo mensual:', error)), 36);
    });
  }

  [
    'panel:view-root-changed',
    'panel:section-modules-ready',
    'panel:filters-updated',
    'panel:payment-filters-changed',
    'panel:expense-scope-changed',
    'panel:monthly-projection-change',
    'panel:backend-data-loaded',
    'panel:flow-income-controller-applied',
    'panel:flow-matrix-v3-rendered'
  ].forEach(name => document.addEventListener(name, () => { if (activeView() === 'flujo') schedule(); }));

  queueMicrotask(() => { if (activeView() === 'flujo') schedule(); });
})();