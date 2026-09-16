(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  const scopeState = window.__FINANCE_SCOPE_FILTER_STATE__ || {};
  scopeState.flujo ||= 'Personal';
  window.__FINANCE_SCOPE_FILTER_STATE__ = scopeState;

  let frame = 0;
  let runVersion = 0;
  let lastDetail = null;

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
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function monthKey(value) {
    if (typeof window.RegularIncomeCore?.monthKey === 'function') return window.RegularIncomeCore.monthKey(value);
    const s = norm(value);
    let m = s.match(/^(20\d{2})-(\d{1,2})/);
    if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}`;
    const map = {ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    m = s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[\s-]+(20\d{2})/);
    return m ? `${m[2]}-${String(map[m[1]]).padStart(2, '0')}` : '';
  }

  const rowMonth = row => monthKey(row['Mes consumo'] || row['Mes pago'] || row['Fecha real'] || row['Fecha registrada']);
  const isActual = row => norm(row.Tipo) === 'gasto' && (window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad|pendiente/.test(norm(row.Estado)));

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
    if (n.includes('nu')) return n.includes(' ro') || holder.includes('rocio') || holder === 'ro' ? 'Nu Ro' : 'Nu Edu';
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
    if (num(row.Cuotas) > 0 && (raw.includes('nu') || raw.includes('arq'))) return 'Crédito';
    return 'Sin especificar';
  }

  function filterState() {
    const payment = window.__PAYMENT_FILTER_STATE__?.view === 'flujo' ? window.__PAYMENT_FILTER_STATE__ : { account: [], method: [] };
    return {
      scope: scopeState.flujo || 'Personal',
      years: new Set(selectedGlobal('year')),
      months: new Set(selectedGlobal('month').map(v => String(Number(v)))),
      categories: new Set(selectedGlobal('category')),
      subcategories: new Set(selectedGlobal('subcategory')),
      accounts: new Set(payment.account || []),
      methods: new Set(payment.method || [])
    };
  }

  function matches(row, state, includePeriod = true) {
    if (!isActual(row)) return false;
    if (state.scope !== 'Todos' && scopeOf(row) !== state.scope) return false;
    const key = rowMonth(row), match = key.match(/^(20\d{2})-(\d{2})$/);
    if (includePeriod && state.years.size && (!match || !state.years.has(match[1]))) return false;
    if (includePeriod && state.months.size && (!match || !state.months.has(String(+match[2])))) return false;
    if (state.categories.size && !state.categories.has(String(row['Categoría'] || ''))) return false;
    if (state.subcategories.size && !state.subcategories.has(String(row['Subcategoría'] || ''))) return false;
    if (state.accounts.size && !state.accounts.has(account(row))) return false;
    if (state.methods.size && !state.methods.has(method(row))) return false;
    return true;
  }

  function amount(row, currency = activeCurrency()) {
    if (currency === 'USD') return num(row['Monto USD']);
    if (currency === 'ARS') return num(row['Monto ARS']);
    return num(row['Monto COP']);
  }

  function money(value, currency = 'COP') {
    const digits = currency === 'USD' ? 2 : 0;
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value) || 0);
  }
  const pct = value => `${new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((Number(value) || 0) * 100)}%`;
  const pctClass = value => { const p = (Number(value) || 0) * 100; return p > 15 ? 'pct-red' : p > 10 ? 'pct-yellow' : p > 5 ? 'pct-green' : 'pct-white'; };

  function ensureStyles() {
    if (document.getElementById('flowScopeStyles')) return;
    const style = document.createElement('style');
    style.id = 'flowScopeStyles';
    style.textContent = `
      .flow-scope-filter{min-width:260px}.flow-scope-buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:3px;border:1px solid #213047;border-radius:9px;background:#0b131e}
      .flow-scope-buttons button{border:0;background:transparent;color:#8496ad;border-radius:6px;padding:7px 8px;font-size:9px;font-weight:800;cursor:pointer}.flow-scope-buttons button.active{background:#17345f;color:#e7f1ff}.flow-scope-buttons button[data-scope="FIBRAZO"].active{background:#493816;color:#ffd66b}
      .flow-scope-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 12px}.flow-scope-summary>div{border:1px solid #1b2a3d;border-radius:10px;padding:10px 12px;background:rgba(255,255,255,.015)}.flow-scope-summary span{display:block;color:#71849d;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.flow-scope-summary strong{display:block;margin-top:5px;font-size:16px;color:#eff5fc}.flow-scope-summary .fibrazo strong{color:#ffd15a}.flow-scope-summary small{display:block;margin-top:3px;color:#667a93;font-size:9px}
      .flow-scope-note{margin-top:6px;color:#7f8ea3;font-size:9px}.flow-scope-note b{color:#b8c8db}
      @media(max-width:700px){.flow-scope-filter{min-width:0}.flow-scope-summary{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function ensureScopeFilter() {
    if (activeView() !== 'flujo') return;
    const bar = document.getElementById('sectionFilterBar');
    const grid = bar?.querySelector('.section-filter-grid');
    if (!bar || bar.hidden || !grid) return;
    grid.querySelector('[data-finance-scope-filter]')?.remove();
    let root = grid.querySelector('[data-flow-scope-filter]');
    if (!root) {
      root = document.createElement('div');
      root.className = 'flow-scope-filter';
      root.dataset.flowScopeFilter = 'true';
      root.innerHTML = `<div class="filter-label-row"><span>Ámbito</span></div><div class="flow-scope-buttons"><button type="button" data-scope="Personal">Personal</button><button type="button" data-scope="FIBRAZO">FIBRAZO</button><button type="button" data-scope="Todos">Todos</button></div>`;
      grid.prepend(root);
      root.addEventListener('click', event => {
        const button = event.target.closest('[data-scope]');
        if (!button) return;
        scopeState.flujo = String(button.dataset.scope || 'Personal');
        window.__FINANCE_SCOPE_FILTER_STATE__ = scopeState;
        updateScopeButtons(root);
        document.dispatchEvent(new CustomEvent('panel:expense-scope-changed', { detail: { view: 'flujo', scope: scopeState.flujo } }));
        schedule();
      });
    }
    updateScopeButtons(root);
  }

  function updateScopeButtons(root) {
    root?.querySelectorAll('[data-scope]').forEach(button => button.classList.toggle('active', button.dataset.scope === (scopeState.flujo || 'Personal')));
  }

  async function getData() {
    const getter = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getter !== 'function') return null;
    const payload = await getter(false);
    const cached = window.__PANEL_GET_CACHED_ROWS__;
    const rows = typeof cached === 'function'
      ? (cached(payload, financeId, 'Movimientos!A:AA').length ? cached(payload, financeId, 'Movimientos!A:AA') : cached(payload, financeId, 'Movimientos!A:Z'))
      : [];
    const model = typeof window.RegularIncomeCore?.build === 'function' ? window.RegularIncomeCore.build(payload, financeId) : null;
    return { payload, rows, model };
  }

  function currencyFactor(rows, currency) {
    if (currency === 'COP') return 1;
    const ratios = [];
    rows.forEach(row => {
      const cop = num(row['Monto COP']);
      const other = num(row[currency === 'USD' ? 'Monto USD' : 'Monto ARS']);
      if (cop > 0 && other > 0) ratios.push(other / cop);
    });
    ratios.sort((a, b) => a - b);
    if (ratios.length) return ratios[Math.floor(ratios.length / 2)];
    return currency === 'USD' ? 1 / Number(cfg.regularIncome?.usdCopReference || 3150) : 1 / 2.1;
  }

  function selectedPeriodKeys(model, rows, state) {
    const current = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
    const keys = new Set();
    if (model?.months instanceof Map) model.months.forEach((_, key) => { if (key <= current) keys.add(key); });
    rows.forEach(row => { if (!isActual(row)) return; const key = rowMonth(row); if (key && key <= current) keys.add(key); });
    return [...keys].filter(key => {
      const [year, month] = key.split('-');
      if (state.years.size && !state.years.has(year)) return false;
      if (state.months.size && !state.months.has(String(+month))) return false;
      return true;
    }).sort();
  }

  function totalsByScope(rows, state, currency) {
    const base = { ...state, scope: 'Todos' };
    const periodRows = rows.filter(row => matches(row, base, true));
    const total = periodRows.reduce((sum, row) => sum + amount(row, currency), 0);
    const personal = periodRows.filter(row => scopeOf(row) === 'Personal').reduce((sum, row) => sum + amount(row, currency), 0);
    const fibrazo = periodRows.filter(row => scopeOf(row) === 'FIBRAZO').reduce((sum, row) => sum + amount(row, currency), 0);
    return { total, personal, fibrazo, count: periodRows.length };
  }

  function patchScopeSummary(rows, state) {
    const root = document.getElementById('viewRoot');
    if (!root) return;
    const primary = [...root.querySelectorAll('.kpi-grid')].find(grid => [...grid.querySelectorAll('.kpi-label')].some(x => norm(x.textContent).includes('ingresos')) && [...grid.querySelectorAll('.kpi-label')].some(x => norm(x.textContent) === 'egresos'));
    if (!primary) return;
    let host = root.querySelector('#flowScopeSummary');
    if (!host) {
      host = document.createElement('div');
      host.id = 'flowScopeSummary';
      host.className = 'flow-scope-summary';
      primary.insertAdjacentElement('afterend', host);
    }
    const currency = activeCurrency();
    const totals = totalsByScope(rows, state, currency);
    host.innerHTML = `<div><span>Gasto personal</span><strong>${esc(money(totals.personal, currency))}</strong><small>Hogar / personal</small></div><div class="fibrazo"><span>Gasto FIBRAZO</span><strong>${esc(money(totals.fibrazo, currency))}</strong><small>Empresarial / reembolsable</small></div><div><span>Gasto total</span><strong>${esc(money(totals.total, currency))}</strong><small>Personal + FIBRAZO</small></div>`;
  }

  function setCard(card, label, value, meta) {
    if (!card) return;
    const l = card.querySelector('.kpi-label'), v = card.querySelector('.kpi-value'), m = card.querySelector('.kpi-meta span');
    if (l) l.textContent = label;
    if (v) v.textContent = value;
    if (m) m.textContent = meta;
  }

  function primaryCards() {
    const root = document.getElementById('viewRoot');
    if (!root) return null;
    const grid = [...root.querySelectorAll('.kpi-grid')].find(candidate => {
      const labels = [...candidate.querySelectorAll('.kpi-label')].map(x => norm(x.textContent));
      return labels.includes('egresos') && labels.some(x => x.includes('ingresos'));
    });
    if (!grid) return null;
    const cards = [...grid.querySelectorAll('.kpi-card')];
    const find = test => cards.find(card => test(norm(card.querySelector('.kpi-label')?.textContent)));
    return { income: find(x => x.includes('ingresos')), expense: find(x => x === 'egresos'), savings: find(x => x === 'ahorro'), rate: find(x => x.includes('tasa de ahorro')) };
  }

  function patchPrimaryKpis(rows, model, state) {
    if (!model) return;
    const cards = primaryCards();
    if (!cards) return;
    const currency = activeCurrency();
    const factor = currencyFactor(rows, currency);
    const keys = selectedPeriodKeys(model, rows, state);
    const period = model.period(keys);
    const filtered = rows.filter(row => matches(row, state, true));
    const expenses = filtered.reduce((sum, row) => sum + amount(row, currency), 0);
    const income = period.totalCop * factor;
    const count = filtered.length;
    const scope = state.scope;
    const incomeMeta = `${keys.length || 0} período${keys.length === 1 ? '' : 's'} · ingreso regular de referencia`;
    setCard(cards.income, keys.length > 1 ? 'Ingresos regulares' : 'Ingresos promedio', money(income, currency), incomeMeta);
    setCard(cards.expense, 'Egresos', money(expenses, currency), `${count} movimientos · ámbito ${scope}`);
    if (scope === 'Personal') {
      const savings = income - expenses;
      setCard(cards.savings, 'Ahorro', money(savings, currency), 'Ingreso regular - egresos personales');
      setCard(cards.rate, 'Tasa de ahorro', pct(income ? savings / income : 0), 'Ahorro personal / ingreso regular');
    } else {
      setCard(cards.savings, 'Ahorro', '—', scope === 'FIBRAZO' ? 'No aplica a gastos empresariales / reembolsables' : 'No se calcula al mezclar Personal + FIBRAZO');
      setCard(cards.rate, 'Tasa de ahorro', '—', 'Disponible únicamente en ámbito Personal');
    }
  }

  function isFinanced(row) {
    if (typeof window.FinancePurchasePolicy?.isFinancedPurchase === 'function') return window.FinancePurchasePolicy.isFinancedPurchase(row);
    return norm(method(row)) === 'credito';
  }
  function installmentCount(row) {
    if (typeof window.FinancePurchasePolicy?.installmentCount === 'function') return window.FinancePurchasePolicy.installmentCount(row);
    return Math.max(1, Math.round(num(row.Cuotas) || 1));
  }

  function patchFinancing(rows, state) {
    const host = document.querySelector('#flowFinancingKpis');
    if (!host) return;
    const currency = activeCurrency();
    const filtered = rows.filter(row => matches(row, state, true) && isFinanced(row));
    let one = 0, multi = 0;
    filtered.forEach(row => { if (installmentCount(row) > 1) multi += amount(row, currency); else one += amount(row, currency); });
    const cards = [...host.querySelectorAll('.kpi-card')];
    if (cards[0]) setCard(cards[0], 'Crédito · 1 pago', money(one, currency), `Ámbito ${state.scope}`);
    if (cards[1]) setCard(cards[1], 'Crédito · en cuotas', money(multi, currency), `Ámbito ${state.scope}`);
    if (cards[2]) setCard(cards[2], 'Compras con crédito', money(one + multi, currency), `${filtered.length} compra${filtered.length === 1 ? '' : 's'} · ámbito ${state.scope}`);
  }

  function monthMaps(rows, state) {
    const map = new Map();
    rows.forEach(row => {
      if (!matches(row, state, false)) return;
      const month = rowMonth(row);
      if (!month) return;
      let item = map.get(month);
      if (!item) { item = { byCat: new Map(), total: 0, fixed: 0, variable: 0, supermarket: 0, financed: 0 }; map.set(month, item); }
      const value = num(row['Monto COP']), cat = norm(row['Categoría']);
      item.byCat.set(cat, (item.byCat.get(cat) || 0) + value);
      item.total += value;
      if (cat === 'supermercado') item.supermarket += value;
      if (/^(si|sí|true|1)$/i.test(String(row['Es fijo'] || ''))) item.fixed += value;
      else item.variable += value;
      if (isFinanced(row)) item.financed += value;
    });
    return map;
  }

  function summaryAmount(item, label) {
    const key = norm(label);
    if (key === 'fijo') return item.fixed;
    if (key === 'fijo + super') return item.fixed + item.supermarket;
    if (key === 'variable') return item.variable;
    if (key === 'variable - super') return Math.max(0, item.variable - item.supermarket);
    if (key === 'egresos efectivos') return item.total - item.financed;
    if (key === 'egresos financiados') return item.financed;
    if (key === 'egresos totales') return item.total;
    return 0;
  }

  function patchMatrix(rows, model, state) {
    const table = document.querySelector('.flow-matrix-advanced');
    if (!table) return;
    const months = [...table.querySelectorAll('thead tr:first-child th[data-sort-month]')].map(th => th.dataset.sortMonth || '');
    const maps = monthMaps(rows, state);
    table.querySelectorAll('tbody tr').forEach(row => {
      const label = row.querySelector('.sticky-cat')?.textContent?.trim() || '';
      months.forEach((month, index) => {
        const item = maps.get(month) || { byCat: new Map(), total: 0, fixed: 0, variable: 0, supermarket: 0, financed: 0 };
        let value;
        if (row.classList.contains('matrix-total-row')) value = item.total;
        else if (row.classList.contains('matrix-summary-row')) value = summaryAmount(item, label);
        else value = item.byCat.get(norm(label)) || 0;
        const amountCell = row.cells?.[2 + index * 2], pctCell = row.cells?.[3 + index * 2];
        if (amountCell) {
          const button = amountCell.querySelector('[data-detail]');
          if (button) button.textContent = money(value, 'COP');
          else amountCell.textContent = money(value, 'COP');
        }
        if (pctCell) {
          const base = model?.months?.get(month)?.totalCop || 0;
          const share = base ? value / base : 0;
          pctCell.innerHTML = base ? `<span class="matrix-pct ${pctClass(share)}">${esc(pct(share))}</span>` : '—';
        }
      });
    });
    const panel = table.closest('.panel');
    const subtitle = panel?.querySelector('.panel-title span');
    if (subtitle) subtitle.textContent = `${subtitle.textContent.replace(/ · Ámbito: .+$/,'')} · Ámbito: ${state.scope}`;
  }

  function patchSavingsTable(rows, model, state) {
    const table = [...document.querySelectorAll('table')].find(candidate => norm(candidate.closest('.panel')?.querySelector('.panel-title strong')?.textContent).includes('flujo y ahorro mensual'));
    if (!table) return;
    const headers = [...table.querySelectorAll('thead th')].map(th => norm(th.textContent));
    const monthIndex = headers.findIndex(h => h === 'mes');
    const incomeIndex = headers.findIndex(h => h.includes('ingresos reales'));
    const expenseIndex = headers.findIndex(h => h.includes('egresos reales'));
    const savingsIndex = headers.findIndex(h => h.includes('ahorro real'));
    const rateIndex = headers.findIndex(h => h.includes('tasa de ahorro'));
    if (monthIndex < 0 || expenseIndex < 0) return;
    const maps = monthMaps(rows, state);
    table.querySelectorAll('tbody tr').forEach(row => {
      const cells = row.cells;
      if (!cells?.length) return;
      const key = monthKey(cells[monthIndex]?.textContent || '');
      if (!key) return;
      const income = model?.months?.get(key)?.totalCop || 0;
      const expenses = maps.get(key)?.total || 0;
      if (incomeIndex >= 0 && income > 0) cells[incomeIndex].textContent = money(income, 'COP');
      cells[expenseIndex].textContent = money(expenses, 'COP');
      if (state.scope === 'Personal') {
        const savings = income - expenses;
        if (savingsIndex >= 0) cells[savingsIndex].textContent = money(savings, 'COP');
        if (rateIndex >= 0) cells[rateIndex].textContent = income ? pct(savings / income) : '—';
      } else {
        if (savingsIndex >= 0) cells[savingsIndex].textContent = '—';
        if (rateIndex >= 0) cells[rateIndex].textContent = '—';
      }
    });
    const subtitle = table.closest('.panel')?.querySelector('.panel-title span');
    if (subtitle) subtitle.textContent = `Egresos según ámbito ${state.scope}${state.scope === 'Personal' ? ' · ahorro personal calculado sobre ingreso regular' : ' · ahorro no aplica en esta vista'}`;
  }

  function patchChart(rows, model, state) {
    const canvas = document.getElementById('flowChart');
    if (!canvas || !window.Chart) return;
    const chart = window.Chart.getChart?.(canvas);
    if (!chart) return;
    const months = selectedPeriodKeys(model, rows, state);
    const maps = monthMaps(rows, state);
    const labels = months.map(key => {
      const [y, m] = key.split('-').map(Number);
      const names = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
      return `${names[m - 1]} ${y}`;
    });
    const income = months.map(key => model?.months?.get(key)?.totalCop || 0);
    const expenses = months.map(key => maps.get(key)?.total || 0);
    const previous = chart.data.datasets || [];
    const template = index => previous[index] || {};
    const datasets = [
      { ...template(0), label: 'Ingresos regulares', data: income },
      { ...template(1), label: `Egresos · ${state.scope}`, data: expenses }
    ];
    if (state.scope === 'Personal') datasets.push({ ...template(2), label: 'Ahorro personal', data: income.map((value, i) => value - expenses[i]) });
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update('none');
    const subtitle = canvas.closest('.panel')?.querySelector('.panel-title span');
    if (subtitle) subtitle.textContent = state.scope === 'Personal' ? 'Ingresos vs egresos personales vs ahorro' : `Ingresos de referencia vs egresos ${state.scope}`;
  }

  function patchDetail(rows, model, state, detailInfo = lastDetail) {
    if (!detailInfo) return;
    const host = document.getElementById('flowMatrixDetailV3');
    if (!host || host.hidden) return;
    const filtered = rows.filter(row => matches(row, state, false) && norm(row['Categoría']) === norm(detailInfo.category) && rowMonth(row) === detailInfo.month)
      .sort((a, b) => String(a['Fecha real'] || '').localeCompare(String(b['Fecha real'] || '')));
    const cols = ['Fecha real','Categoría','Subcategoría','Descripción / Comercio','Cuenta / Tarjeta','Modalidad de pago','Titular','Cuotas','Ámbito','Monto COP'];
    const total = filtered.reduce((sum, row) => sum + num(row['Monto COP']), 0);
    host.innerHTML = `<div class="panel-header"><div class="panel-title"><strong>Detalle · ${esc(detailInfo.category)} · ${esc(detailInfo.month)}</strong><span>${filtered.length} movimientos · ámbito ${esc(state.scope)} · total ${esc(money(total, 'COP'))}</span></div><button type="button" class="text-btn" id="closeFlowDetailV3">Cerrar</button></div>${filtered.length ? `<div class="table-scroll expanded"><table class="date-first-table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${filtered.map(row => `<tr>${cols.map(c => `<td>${esc(c === 'Ámbito' ? scopeOf(row) : row[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody><tfoot data-auto-total><tr>${cols.map((c, i) => `<td>${i === 0 ? 'TOTAL' : c === 'Monto COP' ? esc(money(total, 'COP')) : ''}</td>`).join('')}</tr></tfoot></table></div>` : '<div class="empty-state"><strong>Sin movimientos para este ámbito</strong><span>Cambia el ámbito o los filtros para ver otros movimientos.</span></div>'}`;
    host.querySelector('#closeFlowDetailV3')?.addEventListener('click', () => { lastDetail = null; host.hidden = true; host.innerHTML = ''; });
  }

  async function apply(version) {
    if (activeView() !== 'flujo') return;
    ensureStyles();
    ensureScopeFilter();
    const data = await getData();
    if (!data || version !== runVersion || activeView() !== 'flujo') return;
    const state = filterState();
    patchScopeSummary(data.rows, state);
    patchPrimaryKpis(data.rows, data.model, state);
    patchFinancing(data.rows, state);
    patchMatrix(data.rows, data.model, state);
    patchSavingsTable(data.rows, data.model, state);
    patchChart(data.rows, data.model, state);
    patchDetail(data.rows, data.model, state);
  }

  function schedule() {
    runVersion += 1;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const version = runVersion;
      setTimeout(() => apply(version).catch(error => console.error('Ámbito Flujo mensual:', error)), 28);
    });
  }

  document.addEventListener('panel:finance-scope-bar-ready', event => { if (event.detail?.view === 'flujo') schedule(); });
  document.addEventListener('panel:view-root-changed', event => {
    if (event.detail?.view === 'flujo') schedule();
    else document.querySelector('[data-flow-scope-filter]')?.remove();
  });
  document.addEventListener('panel:section-modules-ready', event => { if (event.detail?.view === 'flujo') schedule(); });
  document.addEventListener('panel:flow-matrix-v3-rendered', schedule);
  document.addEventListener('panel:flow-income-controller-applied', schedule);
  document.addEventListener('panel:payment-filters-changed', event => { if (event.detail?.view === 'flujo') schedule(); });
  document.addEventListener('panel:filters-updated', () => { if (activeView() === 'flujo') schedule(); });
  document.addEventListener('panel:backend-data-loaded', () => { if (activeView() === 'flujo') schedule(); });
  document.addEventListener('click', event => {
    if (activeView() !== 'flujo') return;
    const detail = event.target.closest?.('[data-detail]');
    if (detail) {
      lastDetail = { category: String(detail.dataset.category || ''), month: String(detail.dataset.month || '') };
      setTimeout(schedule, 0);
      return;
    }
    if (event.target.closest?.('[data-sort],[data-sort-month],#flowOriginalOrderV3,.currency-btn')) setTimeout(schedule, 0);
  }, true);

  ensureStyles();
  queueMicrotask(() => { if (activeView() === 'flujo') schedule(); });
})();