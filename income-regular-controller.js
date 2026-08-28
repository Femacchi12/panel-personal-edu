(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  let cache = null;
  let cacheAt = 0;
  let timer = null;
  let applying = false;

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const activeCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';
  const selectedYear = () => {
    const years = [...document.querySelectorAll('.multi-filter[data-filter="year"] .multi-filter-option.selected')]
      .map(x => String(x.dataset.value || '')).filter(Boolean);
    return years.length === 1 ? years[0] : String(new Date().getFullYear());
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  async function payload(force = false) {
    if (!force && cache && Date.now() - cacheAt < 55_000) return cache;
    const token = await window.__PANEL_GET_ID_TOKEN__?.(false);
    if (!token) return null;
    const response = await fetch(`${apiBaseUrl}/api/data`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Backend ${response.status}`);
    cache = await response.json();
    cacheAt = Date.now();
    return cache;
  }

  function convertCop(value, currency, model) {
    const n = Number(value) || 0;
    if (currency === 'USD') return n / (model.usdCopReference || 3150);
    if (currency === 'ARS') return n / 2.1;
    return n;
  }

  function formatMoney(value, currency) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      minimumFractionDigits: currency === 'USD' ? 2 : 0,
      maximumFractionDigits: currency === 'USD' ? 2 : 0
    }).format(Number(value) || 0);
  }

  const formatUsd = value => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(Number(value) || 0);

  function scenarioRows(avg, currency, model) {
    return [0.40, 0.30, 0.20, 0.10].map(rate => ({
      rate,
      monthlySavings: convertCop(avg.totalCop * rate, currency, model),
      monthlySpend: convertCop(avg.totalCop * (1 - rate), currency, model),
      annualSavings: convertCop(avg.totalCop * 12 * rate, currency, model),
      annualSpend: convertCop(avg.totalCop * 12 * (1 - rate), currency, model)
    }));
  }

  function baselineHtml(model, avg, year, currency) {
    const now = new Date();
    const limit = year === String(now.getFullYear()) ? now.getMonth() + 1 : 12;
    const yearMonths = [...model.months.values()]
      .filter(month => month.year === year && Number(month.key.slice(5, 7)) <= limit);
    const supported = yearMonths.filter(month => month.complete).length;
    const pending = yearMonths.filter(month => month.missingSupport.length).length;
    const total = convertCop(avg.totalCop, currency, model);
    const salary = convertCop(avg.copRegular, currency, model);
    const usdEquiv = convertCop(avg.usdEquivCop, currency, model);
    const supportText = pending
      ? `${pending} mes(es) con soporte pendiente`
      : 'Base regular soportada para los meses disponibles';

    return `<div class="panel" id="incomeRegularBaselinePanel">
      <div class="panel-header"><div class="panel-title"><strong>Base mensual regular promedio</strong><span>Nómina COP + Fibrazo LLC básico · sin extras</span></div></div>
      <div class="savings-reference-grid">
        <div class="savings-reference-card"><span>Nómina COP promedio</span><strong>${esc(formatMoney(salary, currency))}</strong><small>Solo componente recurrente</small></div>
        <div class="savings-reference-card"><span>Fibrazo LLC básico</span><strong>USD ${esc(formatUsd(avg.usdRegular))}</strong><small>≈ ${esc(formatMoney(usdEquiv, currency))} · base configurable</small></div>
        <div class="savings-reference-card"><span>Ingreso mensual regular promedio</span><strong>${esc(formatMoney(total, currency))}</strong><small>Base única para ahorro y porcentajes</small></div>
        <div class="savings-reference-card"><span>Soportes ${esc(year)}</span><strong>${supported}/${limit}</strong><small>${esc(supportText)}</small></div>
      </div>
      <div class="savings-scenario-note"><strong>Criterio:</strong> si falta soporte de un mes, se mantiene temporalmente la referencia regular disponible y se identifica como pendiente. Al cargar el soporte, la base se recalcula automáticamente. Primas, intereses, bonos, cesantías, devoluciones y demás extras nunca se incorporan.</div>
    </div>`;
  }

  function scenarioHtml(avg, currency, model, year) {
    const monthly = convertCop(avg.totalCop, currency, model);
    const annual = monthly * 12;
    const rows = scenarioRows(avg, currency, model).map(row => `
      <tr>
        <td>${Math.round(row.rate * 100)}%</td>
        <td>${esc(formatMoney(row.monthlySavings, currency))}</td>
        <td>${esc(formatMoney(row.monthlySpend, currency))}</td>
        <td>${esc(formatMoney(row.annualSavings, currency))}</td>
        <td>${esc(formatMoney(row.annualSpend, currency))}</td>
      </tr>`).join('');
    const support = avg.pending
      ? `${avg.pending} mes(es) con soporte pendiente; se usa temporalmente la referencia regular.`
      : 'Todos los meses usados en el promedio tienen base regular disponible.';

    return `<div class="panel savings-scenario-panel" id="savingsScenarioPanel">
      <div class="panel-header"><div class="panel-title"><strong>Escenarios de capacidad de ahorro</strong><span>Base mensual regular promedio · sin extras</span></div></div>
      <div class="savings-reference-grid">
        <div class="savings-reference-card"><span>Ingreso mensual regular promedio</span><strong>${esc(formatMoney(monthly, currency))}</strong><small>Nómina COP + Fibrazo LLC básico</small></div>
        <div class="savings-reference-card"><span>Nómina COP promedio</span><strong>${esc(formatMoney(convertCop(avg.copRegular, currency, model), currency))}</strong><small>Solo componente recurrente</small></div>
        <div class="savings-reference-card"><span>Fibrazo LLC básico promedio</span><strong>${esc(formatMoney(convertCop(avg.usdEquivCop, currency, model), currency))}</strong><small>Base USD ${model.usdBase}</small></div>
        <div class="savings-reference-card"><span>Ingreso anual regular</span><strong>${esc(formatMoney(annual, currency))}</strong><small>12 × promedio mensual regular</small></div>
      </div>
      <div class="table-scroll"><table class="savings-scenario-table"><thead><tr><th>Meta</th><th>Ahorro mensual</th><th>Gasto máximo mensual</th><th>Ahorro anual</th><th>Gasto máximo anual</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="savings-scenario-note"><strong>Criterio ${esc(year)}:</strong> ${esc(support)} Primas, intereses, cesantías, devoluciones, bonos y otros extras quedan excluidos de la base regular.</div>
    </div>`;
  }

  function placePanels(root, baseline, scenario) {
    root.querySelector('#incomeRegularBaselinePanel')?.remove();
    root.querySelector('#savingsScenarioPanel')?.remove();
    const complete = root.querySelector('[data-income-complete]');
    if (!complete) return;
    const chartPanel = complete.querySelector('.panel');
    if (chartPanel) {
      chartPanel.insertAdjacentElement('afterend', baseline);
      baseline.insertAdjacentElement('afterend', scenario);
      return;
    }
    complete.prepend(scenario);
    complete.prepend(baseline);
  }

  async function apply(force = false) {
    if (applying || activeView() !== 'ingresos' || !window.RegularIncomeCore) return;
    const root = document.getElementById('viewRoot');
    if (!root?.querySelector('[data-income-complete]')) return;
    applying = true;
    try {
      const data = await payload(force);
      if (!data) return;
      const model = window.RegularIncomeCore.build(data, financeId);
      window.__PANEL_REGULAR_INCOME_MODEL__ = model;
      const year = selectedYear();
      const avg = model.average(year) || model.average();
      if (!avg) return;
      const currency = activeCurrency();
      const holder = document.createElement('div');
      holder.innerHTML = baselineHtml(model, avg, year, currency) + scenarioHtml(avg, currency, model, year);
      const baseline = holder.children[0];
      const scenario = holder.children[1];
      if (!baseline || !scenario) return;
      placePanels(root, baseline, scenario);
      document.dispatchEvent(new CustomEvent('panel:income-regular-controller-applied'));
    } catch (error) {
      console.error('Controlador de ingreso regular:', error);
    } finally {
      applying = false;
    }
  }

  const schedule = (delay = 160, force = false) => {
    clearTimeout(timer);
    timer = setTimeout(() => apply(force), delay);
  };

  document.addEventListener('panel:income-doc-rendered', () => schedule(20, false));
  document.addEventListener('panel:filters-updated', () => schedule(140, false));
  document.addEventListener('click', event => {
    if (event.target.closest('#refreshBtn')) {
      cache = null;
      cacheAt = 0;
      schedule(600, true);
      return;
    }
    if (event.target.closest('.nav-item')) {
      schedule(320, false);
      return;
    }
    if (event.target.closest('.currency-btn,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters')) {
      schedule(180, false);
    }
  }, true);

  setTimeout(() => apply(false), 800);
})();
