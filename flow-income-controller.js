(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = String(cfg.financeSpreadsheetId || '');
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  if (!FINANCE_ID || !apiBaseUrl) return;

  let renderFrame = 0;
  let applying = false;
  let rerunRequested = false;
  let pendingForce = false;

  const norm = value => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const activeCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';
  const selectedGlobal = key => [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
    .map(x => String(x.dataset.value || '').trim()).filter(Boolean);

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c >= 0 && d >= 0) {
      if (c > d) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (c >= 0) {
      const p = s.split(',');
      s = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g, '') + '.' + p[1] : s.replace(/,/g, '');
    } else if (d >= 0) {
      const p = s.split('.');
      if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((key, i) => [key || `Col ${i + 1}`, row?.[i] ?? ''])));
  }

  async function payload(force = false) {
    const getData = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getData !== 'function') return null;
    return getData(force);
  }

  const sourceRows = (data, range) => parseRows(data?.sources?.[`${FINANCE_ID}|${range}`] || []);

  function ensureFilters() {
    if (activeView() !== 'flujo') return;
    const filterBar = document.getElementById('filterBar');
    const category = document.querySelector('#globalFilters .multi-filter[data-filter="category"]');
    const subcategory = document.querySelector('#globalFilters .multi-filter[data-filter="subcategory"]');
    const paymentBar = document.getElementById('paymentMethodFilterBar');
    if (filterBar) { filterBar.hidden = false; filterBar.style.display = ''; }
    if (category) { category.hidden = false; category.style.display = ''; }
    if (subcategory) { subcategory.hidden = true; subcategory.style.display = 'none'; }
    if (paymentBar) {
      paymentBar.hidden = false;
      paymentBar.style.display = '';
      const grid = paymentBar.querySelector('.section-filter-grid');
      if (grid) grid.style.gridTemplateColumns = 'repeat(2,minmax(0,1fr))';
    }
  }

  const monthKey = value => window.RegularIncomeCore?.monthKey(value) || '';
  const rowMonth = row => monthKey(row['Mes consumo'] || row['Mes pago'] || row['Fecha real'] || row['Fecha registrada']);
  const isActual = row => norm(row.Tipo) === 'gasto' &&
    (window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad/.test(norm(row.Estado)));

  function account(row) {
    const raw = String(row['Cuenta / Tarjeta'] || '').trim();
    const n = norm(raw), holder = norm(row.Titular);
    if (n.includes('efectivo')) return 'Efectivo';
    if (n.includes('nequi')) return holder.includes('ro') ? 'Nequi Ro' : 'Nequi Edu';
    if (n.includes('arq')) return 'ARQ Edu';
    if (n.includes('nu')) {
      if (n.includes(' ro') || n.endsWith('ro') || holder === 'ro' || holder.includes('rocio')) return 'Nu Ro';
      return 'Nu Edu';
    }
    return raw || 'Sin especificar';
  }

  function method(row) {
    const explicit = String(row['Modalidad de pago'] || '').trim();
    if (explicit) return explicit;
    const raw = norm(row['Cuenta / Tarjeta']);
    if (raw.includes('credito')) return 'Crédito';
    if (raw.includes('transferencia')) return 'Transferencia';
    if (raw.includes('debito')) return 'Débito';
    if (raw.includes('efectivo')) return 'Efectivo';
    const installments = parseNumber(row.Cuotas);
    if (installments > 0 && (raw.includes('nu') || raw.includes('arq'))) return 'Crédito';
    return 'Sin especificar';
  }

  function movementMatches(row) {
    if (!isActual(row)) return false;
    const years = selectedGlobal('year');
    const months = selectedGlobal('month');
    const categories = selectedGlobal('category');
    const mk = rowMonth(row);
    const ym = mk.match(/^(20\d{2})-(\d{2})$/);
    if (years.length && (!ym || !years.includes(ym[1]))) return false;
    if (months.length && (!ym || !months.includes(String(+ym[2])))) return false;
    if (categories.length && !categories.includes(String(row['Categoría'] || ''))) return false;
    const payment = window.__PAYMENT_FILTER_STATE__?.view === 'flujo'
      ? window.__PAYMENT_FILTER_STATE__
      : { account: [], method: [] };
    if (payment.account?.length && !payment.account.includes(account(row))) return false;
    if (payment.method?.length && !payment.method.includes(method(row))) return false;
    return true;
  }

  function selectedPeriodKeys(model, movements) {
    const years = selectedGlobal('year');
    const months = selectedGlobal('month');
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const keys = new Set([...model.months.keys()].filter(key => key <= current));
    movements.filter(isActual).forEach(row => {
      const key = rowMonth(row);
      if (key && key <= current) keys.add(key);
    });
    return [...keys].filter(key => {
      const [year, month] = key.split('-');
      if (years.length && !years.includes(year)) return false;
      if (months.length && !months.includes(String(+month))) return false;
      return true;
    }).sort();
  }

  function currencyFactor(rows, currency) {
    if (currency === 'COP') return 1;
    const ratios = rows.map(row => {
      const cop = parseNumber(row['Monto COP']);
      const other = parseNumber(row[currency === 'USD' ? 'Monto USD' : 'Monto ARS']);
      return cop > 0 && other > 0 ? other / cop : 0;
    }).filter(v => v > 0).sort((a, b) => a - b);
    if (ratios.length) return ratios[Math.floor(ratios.length / 2)];
    return currency === 'USD' ? 1 / (cfg.regularIncome?.usdCopReference || 3150) : 1 / 2.1;
  }

  function formatMoney(value, currency = 'COP') {
    const digits = currency === 'USD' ? 2 : 0;
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency,
      minimumFractionDigits: digits, maximumFractionDigits: digits
    }).format(Number(value) || 0);
  }

  const formatUsd = value => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(Number(value) || 0);
  const formatPct = value => `${new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((Number(value) || 0) * 100)}%`;
  const pctClass = value => {
    const p = (Number(value) || 0) * 100;
    return p > 15 ? 'pct-red' : p > 10 ? 'pct-yellow' : p > 5 ? 'pct-green' : 'pct-white';
  };

  function setCard(card, label, value, meta) {
    if (!card) return;
    const labelEl = card.querySelector('.kpi-label');
    const valueEl = card.querySelector('.kpi-value');
    const metaEl = card.querySelector('.kpi-meta span');
    if (labelEl) labelEl.textContent = label;
    if (valueEl) valueEl.textContent = value;
    if (metaEl) metaEl.textContent = meta;
  }

  function primaryCards() {
    const root = document.getElementById('viewRoot');
    if (!root) return null;
    const grid = [...root.querySelectorAll('.kpi-grid')].find(candidate => {
      const labels = [...candidate.querySelectorAll('.kpi-label')].map(x => x.textContent.trim());
      return labels.some(x => x === 'Ingresos' || x === 'Ingresos promedio' || x === 'Ingresos regulares') &&
        labels.includes('Egresos') && labels.includes('Ahorro');
    });
    if (!grid) return null;
    const cards = [...grid.querySelectorAll('.kpi-card')];
    const byLabel = label => cards.find(card => card.querySelector('.kpi-label')?.textContent.trim() === label);
    return {
      income: cards.find(card => ['Ingresos','Ingresos promedio','Ingresos regulares'].includes(card.querySelector('.kpi-label')?.textContent.trim())),
      expense: byLabel('Egresos'),
      savings: byLabel('Ahorro'),
      rate: cards.find(card => norm(card.querySelector('.kpi-label')?.textContent).includes('tasa de ahorro'))
    };
  }

  function movementAmount(row, currency) {
    if (currency === 'USD') return parseNumber(row['Monto USD']);
    if (currency === 'ARS') return parseNumber(row['Monto ARS']);
    return parseNumber(row['Monto COP']);
  }

  function renderFinancing(rows, currency) {
    const root = document.getElementById('viewRoot');
    if (!root || activeView() !== 'flujo') return;
    const primary = [...root.querySelectorAll('.kpi-grid')].find(grid => {
      const labels = [...grid.querySelectorAll('.kpi-label')].map(x => x.textContent.trim());
      return labels.includes('Egresos') && labels.includes('Ahorro') &&
        labels.some(x => x === 'Ingresos' || x === 'Ingresos promedio' || x === 'Ingresos regulares');
    });
    if (!primary) return;
    let one = 0, multi = 0;
    rows.forEach(row => {
      if (norm(method(row)) !== 'credito') return;
      const installments = Math.max(1, Math.round(parseNumber(row.Cuotas) || 1));
      const value = movementAmount(row, currency);
      if (installments > 1) multi += value;
      else one += value;
    });
    let host = root.querySelector('#flowFinancingKpis');
    if (!host) {
      host = document.createElement('div');
      host.id = 'flowFinancingKpis';
      host.className = 'kpi-grid flow-financing-kpis';
      host.style.gridTemplateColumns = 'repeat(3,minmax(0,1fr))';
      primary.insertAdjacentElement('afterend', host);
    }
    const total = one + multi;
    const html = `<div class="kpi-card"><span class="kpi-label">Financiado · 1 cuota</span><strong class="kpi-value">${formatMoney(one, currency)}</strong><div class="kpi-meta"><span>Compras a crédito en una sola cuota</span></div></div><div class="kpi-card"><span class="kpi-label">Financiado · más de 1 cuota</span><strong class="kpi-value gold">${formatMoney(multi, currency)}</strong><div class="kpi-meta"><span>Compras a crédito en 2 o más cuotas</span></div></div><div class="kpi-card"><span class="kpi-label">Financiado total</span><strong class="kpi-value gold">${formatMoney(total, currency)}</strong><div class="kpi-meta"><span>Total comprado a crédito</span></div></div>`;
    if (host.innerHTML !== html) host.innerHTML = html;
  }

  function updatePrimaryKpis(model, movements) {
    const keys = selectedPeriodKeys(model, movements);
    const period = model.period(keys);
    const filtered = movements.filter(movementMatches);
    const currency = activeCurrency();
    const factor = currencyFactor(movements, currency);
    const amountField = currency === 'COP' ? 'Monto COP' : currency === 'USD' ? 'Monto USD' : 'Monto ARS';
    const income = period.totalCop * factor;
    const expenses = filtered.reduce((sum, row) => sum + parseNumber(row[amountField]), 0);
    const savings = income - expenses;
    const rate = income ? savings / income : 0;
    const missing = period.missing.length;
    const meta = keys.length === 1
      ? (missing ? `Ingreso regular del mes · soporte pendiente: ${period.missing[0].missingSupport.join(' + ')}` : 'Ingreso regular del mes')
      : `${keys.length} meses · ingreso regular acumulado${missing ? ` · ${missing} con soporte pendiente` : ''}`;
    const cards = primaryCards();
    if (!cards) return;
    setCard(cards.income, keys.length > 1 ? 'Ingresos regulares' : 'Ingresos promedio', formatMoney(income, currency), meta);
    setCard(cards.expense, 'Egresos', formatMoney(expenses, currency), `${filtered.length} movimientos realizados según filtros`);
    setCard(cards.savings, 'Ahorro', formatMoney(savings, currency), 'Ingreso regular - egresos');
    setCard(cards.rate, 'Tasa de ahorro', formatPct(rate), 'Ahorro / ingreso regular');
    renderFinancing(filtered, currency);
  }

  function updateReferenceCards(model) {
    document.querySelectorAll('.salary-reference-grid > div').forEach(card => {
      const label = card.querySelector('span')?.textContent || '';
      const key = monthKey(label);
      const base = key ? model.months.get(key) : null;
      if (!base?.usable) return;
      card.innerHTML = `
        <span>${label}</span>
        <strong>${formatMoney(base.totalCop, 'COP')}</strong>
        <small class="income-base-breakdown">Nómina COP ${formatMoney(base.copRegular, 'COP')}${base.copConfirmed ? '' : ' · pendiente soporte'}</small>
        <small class="income-base-breakdown">Fibrazo LLC USD ${formatUsd(base.usdRegular)} · ≈ ${formatMoney(base.usdEquivCop, 'COP')}${base.usdConfirmed ? '' : ' · pendiente soporte'}</small>
        <small class="income-base-status ${base.complete ? 'income-base-ok' : 'income-base-estimated'}">${base.complete ? 'Base regular confirmada' : 'Base regular estimada · usada para calcular %'}</small>`;
    });
  }

  function updateMatrix(model) {
    const table = document.querySelector('.flow-matrix-advanced');
    if (!table) return;
    const months = [...table.querySelectorAll('thead tr:first-child th[data-sort-month]')]
      .map(th => th.dataset.sortMonth || '');
    table.querySelectorAll('tbody tr').forEach(row => months.forEach((key, i) => {
      const base = model.months.get(key)?.totalCop;
      if (!(base > 0)) return;
      const amountCell = row.cells?.[2 + i * 2];
      const pctCell = row.cells?.[3 + i * 2];
      if (!amountCell || !pctCell) return;
      const share = parseNumber(amountCell.textContent) / base;
      let span = pctCell.querySelector('.matrix-pct');
      if (!span) {
        pctCell.textContent = '';
        span = document.createElement('span');
        pctCell.appendChild(span);
      }
      span.textContent = formatPct(share);
      span.className = `matrix-pct ${pctClass(share)}`;
    }));
  }

  function setTextIfChanged(cell, value) {
    if (cell && cell.textContent !== value) cell.textContent = value;
  }

  function updateSavingsTable(model) {
    const table = [...document.querySelectorAll('table')].find(candidate => {
      const title = norm(candidate.closest('.panel')?.querySelector('.panel-title strong')?.textContent);
      return title.includes('flujo y ahorro mensual');
    });
    if (!table) return;
    const headers = [...table.querySelectorAll('thead th')].map(th => norm(th.textContent));
    const monthIndex = headers.findIndex(h => h === 'mes');
    const incomeIndex = headers.findIndex(h => h.includes('ingresos reales'));
    const expenseIndex = headers.findIndex(h => h.includes('egresos reales'));
    const savingsIndex = headers.findIndex(h => h.includes('ahorro real'));
    const rateIndex = headers.findIndex(h => h.includes('tasa de ahorro'));
    if (monthIndex < 0 || expenseIndex < 0 || rateIndex < 0) return;

    table.querySelectorAll('tbody tr').forEach(row => {
      const cells = row.cells;
      if (!cells?.length) return;
      const key = monthKey(cells[monthIndex]?.textContent || '');
      const base = key ? model.months.get(key)?.totalCop : 0;
      if (!(base > 0)) return;
      const expenses = parseNumber(cells[expenseIndex]?.textContent);
      const savings = base - expenses;
      if (incomeIndex >= 0) setTextIfChanged(cells[incomeIndex], formatMoney(base, 'COP'));
      if (savingsIndex >= 0) setTextIfChanged(cells[savingsIndex], formatMoney(savings, 'COP'));
      setTextIfChanged(cells[rateIndex], formatPct(savings / base));
    });
  }

  function updateNote(model) {
    const reference = document.querySelector('.salary-reference');
    if (!reference) return;
    let note = reference.querySelector('.income-base-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'income-base-note';
      reference.appendChild(note);
    }
    const pending = [...model.months.values()].filter(month => month.missingSupport.length).length;
    note.textContent = `Base regular única = nómina COP regular + Fibrazo LLC básico USD ${model.usdBase}. Primas, intereses, cesantías, devoluciones y extras no se incluyen.${pending ? ` Hay ${pending} mes(es) con soporte pendiente y se usa temporalmente la referencia regular.` : ''}`;
  }

  async function apply(force = false) {
    if (activeView() !== 'flujo' || !window.RegularIncomeCore) return;
    if (applying) {
      rerunRequested = true;
      pendingForce = pendingForce || force;
      return;
    }
    applying = true;
    try {
      const data = await payload(force);
      if (!data || activeView() !== 'flujo') return;
      ensureFilters();
      const model = window.RegularIncomeCore.build(data, FINANCE_ID);
      const movements = sourceRows(data, 'Movimientos!A:Z');
      window.__PANEL_REGULAR_INCOME_MODEL__ = model;
      updateReferenceCards(model);
      updateMatrix(model);
      updateSavingsTable(model);
      updateNote(model);
      updatePrimaryKpis(model, movements);
      document.dispatchEvent(new CustomEvent('panel:regular-income-base-applied'));
      document.dispatchEvent(new CustomEvent('panel:flow-income-controller-applied'));
    } catch (error) {
      console.error('Controlador de ingresos y ahorro de Flujo:', error);
    } finally {
      applying = false;
      if (rerunRequested && activeView() === 'flujo') {
        rerunRequested = false;
        schedule(false);
      }
    }
  }

  const schedule = (force = false) => {
    pendingForce = pendingForce || force;
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      const useForce = pendingForce;
      pendingForce = false;
      apply(useForce);
    });
  };

  document.addEventListener('panel:flow-matrix-v3-rendered', () => schedule(false));
  document.addEventListener('panel:view-root-changed', event => { if (event.detail?.view === 'flujo') schedule(false); });
  document.addEventListener('panel:payment-filters-changed', event => { if (event.detail?.view === 'flujo') schedule(false); });
  document.addEventListener('panel:filters-updated', () => { if (activeView() === 'flujo') schedule(false); });
  queueMicrotask(() => { if (activeView() === 'flujo') schedule(false); });
})();
