(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  let frame = 0;
  let requestVersion = 0;

  const policy = () => window.FinancePurchasePolicy;
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const activeCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';
  const selectedGlobal = key => [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
    .map(el => String(el.dataset.value || '').trim()).filter(Boolean);

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(value => String(value ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(value => String(value ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((key, index) => [key || `Col ${index + 1}`, row?.[index] ?? ''])));
  }

  function monthKey(row) {
    const explicit = String(row?.['Mes consumo'] || '').trim();
    if (/^20\d{2}-\d{2}$/.test(explicit)) return explicit;
    const raw = String(row?.['Fecha real'] || row?.['Fecha registrada'] || '').trim();
    const match = raw.match(/^(20\d{2})-(\d{1,2})/);
    return match ? `${match[1]}-${String(+match[2]).padStart(2, '0')}` : '';
  }

  function isActual(row) {
    if (policy()?.norm(row?.Tipo) !== 'gasto') return false;
    return window.MovementStatusCore?.isActual(row?.Estado) ?? !/proyecc|proyect|programad/.test(policy()?.norm(row?.Estado) || '');
  }

  function account(row) {
    const raw = String(row?.['Cuenta / Tarjeta'] || '').trim();
    const normalized = policy()?.norm(raw) || '';
    const holder = policy()?.norm(row?.Titular) || '';
    if (normalized.includes('efectivo')) return 'Efectivo';
    if (normalized.includes('nequi')) return holder.includes('ro') ? 'Nequi Ro' : 'Nequi Edu';
    if (normalized.includes('arq')) return 'ARQ Edu';
    if (normalized.includes('nu')) return normalized.includes(' ro') || holder.includes('rocio') || holder === 'ro' ? 'Nu Ro' : 'Nu Edu';
    return raw || 'Sin especificar';
  }

  function matchesFilters(row) {
    if (!isActual(row)) return false;
    const key = monthKey(row), [year, month] = key.split('-');
    const years = selectedGlobal('year'), months = selectedGlobal('month'), categories = selectedGlobal('category');
    if (years.length && (!year || !years.includes(year))) return false;
    if (months.length && (!month || !months.includes(String(+month)))) return false;
    if (categories.length && !categories.includes(String(row?.['Categoría'] || ''))) return false;
    const payment = window.__PAYMENT_FILTER_STATE__?.view === 'flujo'
      ? window.__PAYMENT_FILTER_STATE__
      : { account: [], method: [] };
    if (payment.account?.length && !payment.account.includes(account(row))) return false;
    if (payment.method?.length && !payment.method.includes(policy()?.method(row))) return false;
    return true;
  }

  function amount(row, currency) {
    const p = policy();
    if (currency === 'USD') return p?.num(row?.['Monto USD']) || 0;
    if (currency === 'ARS') return p?.num(row?.['Monto ARS']) || 0;
    return p?.num(row?.['Monto COP']) || 0;
  }

  function money(value, currency) {
    const digits = currency === 'USD' ? 2 : 0;
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(Number(value) || 0);
  }

  function paint(rows) {
    if (activeView() !== 'flujo' || !policy()) return;
    const host = document.getElementById('flowFinancingKpis');
    if (!host) return;
    const currency = activeCurrency();
    let one = 0, multi = 0, count = 0;
    rows.filter(matchesFilters).forEach(row => {
      if (!policy().isFinancedPurchase(row)) return;
      const value = amount(row, currency);
      if (policy().installmentCount(row) > 1) multi += value;
      else one += value;
      count += 1;
    });
    const total = one + multi;
    const html = `<div class="kpi-card"><span class="kpi-label">Financiado · 1 cuota</span><strong class="kpi-value">${money(one, currency)}</strong><div class="kpi-meta"><span>Compras financiadas válidas en una sola cuota</span></div></div><div class="kpi-card"><span class="kpi-label">Financiado · más de 1 cuota</span><strong class="kpi-value gold">${money(multi, currency)}</strong><div class="kpi-meta"><span>Compras financiadas válidas en 2 o más cuotas</span></div></div><div class="kpi-card"><span class="kpi-label">Financiado total</span><strong class="kpi-value gold">${money(total, currency)}</strong><div class="kpi-meta"><span>${count} compra${count === 1 ? '' : 's'} · excluye pago de tarjeta, manejo e intereses</span></div></div>`;
    if (host.innerHTML !== html) host.innerHTML = html;
    host.dataset.financingPolicy = 'canonical';
  }

  async function run() {
    if (activeView() !== 'flujo' || !policy()) return;
    const version = ++requestVersion;
    const getData = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getData !== 'function') return;
    try {
      const data = await getData(false);
      if (version !== requestVersion || activeView() !== 'flujo') return;
      paint(parseRows(data?.sources?.[`${financeId}|Movimientos!A:Z`] || []));
    } catch (error) {
      console.error('Consistencia de financiación:', error);
    }
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; run(); });
  }

  document.addEventListener('panel:flow-income-controller-applied', schedule);
  document.addEventListener('panel:flow-matrix-v3-rendered', schedule);
  document.addEventListener('panel:payment-filters-changed', event => { if (event.detail?.view === 'flujo') schedule(); });
  document.addEventListener('panel:filters-updated', () => { if (activeView() === 'flujo') schedule(); });
  document.addEventListener('panel:view-root-changed', event => { if (event.detail?.view === 'flujo') schedule(); });
  document.addEventListener('click', event => { if (event.target.closest('.currency-btn') && activeView() === 'flujo') setTimeout(schedule, 0); });
})();