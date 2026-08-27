(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  let cache = null;
  let cacheAt = 0;
  let timer = null;
  let rendering = false;

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const currentCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(r => r?.some(v => String(v ?? '').trim() !== ''))
      .map(r => Object.fromEntries(headers.map((h, i) => [h || `Col ${i + 1}`, r?.[i] ?? ''])));
  }

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
      s = p.length === 2 && p[1].length <= 4 ? p[0].replace(/\./g, '') + '.' + p[1] : s.replace(/,/g, '');
    } else if (d >= 0) {
      const p = s.split('.');
      if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parseDate(value) {
    const s = String(value || '').trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function selectedGlobal(key) {
    return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
      .map(el => String(el.dataset.value || '').trim()).filter(Boolean);
  }

  function selectedLocal(key) {
    return [...document.querySelectorAll(`.local-multi-filter[data-local-key="${key}"] .local-option.selected`)]
      .map(el => String(el.dataset.value || '').trim()).filter(Boolean);
  }

  function periodEnd() {
    const years = selectedGlobal('year').map(Number).filter(Boolean);
    const months = selectedGlobal('month').map(Number).filter(n => n >= 1 && n <= 12);
    if (!years.length && !months.length) return null;
    const ys = years.length ? years : [new Date().getFullYear()];
    const y = Math.max(...ys);
    if (!months.length) return new Date(y, 11, 31, 23, 59, 59, 999);
    const m = Math.max(...months);
    return new Date(y, m, 0, 23, 59, 59, 999);
  }

  function latestSummary(rows, end) {
    const groups = new Map();
    rows.forEach(row => {
      const d = parseDate(row['Fecha corte']);
      if (!d || (end && d > end)) return;
      const key = String(row.Entidad || 'Sin plataforma').trim();
      if (!groups.has(key) || d > (parseDate(groups.get(key)['Fecha corte']) || new Date(0))) groups.set(key, row);
    });
    return [...groups.values()];
  }

  function summaryMatchesPlatform(row) {
    const selected = selectedLocal('invPlatform');
    if (!selected.length) return true;
    return selected.some(v => norm(v).includes(norm(row.Entidad)) || norm(row.Entidad).includes(norm(v).split('/')[0].trim()));
  }

  function investmentRates() {
    return {
      usdCop: Number(cfg?.regularIncome?.usdCopReference) || 3150,
      usdArs: Number(cfg?.regularIncome?.usdArsReference) || 1500
    };
  }

  function convert(value, base, currency, rates) {
    const v = Number(value) || 0;
    base = String(base || 'COP').toUpperCase();
    if (base === currency) return v;
    if (base === 'USD' && currency === 'COP') return v * rates.usdCop;
    if (base === 'USD' && currency === 'ARS') return v * rates.usdArs;
    if (base === 'COP' && currency === 'USD') return v / rates.usdCop;
    if (base === 'COP' && currency === 'ARS') return v / rates.usdCop * rates.usdArs;
    if (base === 'ARS' && currency === 'USD') return v / rates.usdArs;
    if (base === 'ARS' && currency === 'COP') return v / rates.usdArs * rates.usdCop;
    return v;
  }

  function money(value, currency) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency,
      minimumFractionDigits: currency === 'USD' ? 2 : 0,
      maximumFractionDigits: currency === 'USD' ? 2 : 0
    }).format(Number(value) || 0);
  }

  async function payload(force = false) {
    if (!force && cache && Date.now() - cacheAt < 55000) return cache;
    const token = await window.__PANEL_GET_ID_TOKEN__?.(false);
    if (!token) throw new Error('Sesión Firebase no disponible');
    const r = await fetch(`${apiBaseUrl}/api/data`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!r.ok) throw new Error(`Backend ${r.status}`);
    cache = await r.json();
    cacheAt = Date.now();
    return cache;
  }

  function injectStyles() {
    if (document.getElementById('investmentSummaryOverviewStyles')) return;
    const style = document.createElement('style');
    style.id = 'investmentSummaryOverviewStyles';
    style.textContent = `
      #investmentSummaryOverview{display:grid;gap:9px;margin-bottom:2px}
      #investmentSummaryOverview .investment-summary-title{display:flex;justify-content:space-between;gap:12px;align-items:end;color:#7f90a8;font-size:9px}
      #investmentSummaryOverview .investment-summary-title strong{color:#eef4fb;font-size:12px}
      #investmentSummaryOverview .investment-summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      #investmentSummaryOverview .investment-summary-card{background:linear-gradient(180deg,#0d1520,#0a1018);border:1px solid var(--border-soft);border-radius:13px;padding:13px 14px;min-width:0}
      #investmentSummaryOverview .investment-summary-card span{display:block;color:#718198;font-size:8px;text-transform:uppercase;letter-spacing:.06em;font-weight:800}
      #investmentSummaryOverview .investment-summary-card strong{display:block;margin-top:7px;font-size:21px;line-height:1.15;color:#edf3fb}
      #investmentSummaryOverview .investment-summary-card small{display:block;margin-top:5px;color:#6f8095;font-size:9px;line-height:1.4}
      #investmentSummaryOverview .investment-summary-card.result-positive strong{color:#26d07c}
      #investmentSummaryOverview .investment-summary-card.result-negative strong{color:#ff667a}
      @media(max-width:760px){#investmentSummaryOverview .investment-summary-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  async function render(force = false) {
    if (activeView() !== 'inversiones' || rendering) return;
    rendering = true;
    try {
      const p = await payload(force).catch(() => null);
      if (!p || activeView() !== 'inversiones') return;
      const summaries = parseRows(p?.sources?.[`${financeId}|Resumen_Inversiones!A:N`] || []);
      const rows = latestSummary(summaries.filter(summaryMatchesPlatform), periodEnd());
      if (!rows.length) return;

      const currency = currentCurrency();
      const rates = investmentRates();
      let capital = 0, result = 0, total = 0;
      rows.forEach(row => {
        const base = String(row['Moneda base'] || 'COP').toUpperCase();
        const market = parseNumber(row['Valor mercado']);
        const contributed = parseNumber(row['Aportes/Incrementos']);
        const gain = String(row.Resultado || '').trim() ? parseNumber(row.Resultado) : market - contributed;
        capital += convert(contributed, base, currency, rates);
        result += convert(gain, base, currency, rates);
        total += convert(market, base, currency, rates);
      });

      const official = document.getElementById('investmentPeriodCorrected');
      const root = document.getElementById('viewRoot');
      if (!root) return;
      let host = document.getElementById('investmentSummaryOverview');
      if (!host) {
        host = document.createElement('div');
        host.id = 'investmentSummaryOverview';
      }
      if (official && official.parentElement === root) root.insertBefore(host, official);
      else if (!host.parentElement) {
        const head = root.querySelector('.section-head');
        if (head) head.insertAdjacentElement('afterend', host); else root.prepend(host);
      }

      const resultClass = result > 0 ? 'result-positive' : result < 0 ? 'result-negative' : '';
      host.innerHTML = `
        <div class="investment-summary-title"><strong>Resumen consolidado de inversiones</strong><span>${rows.length} plataforma${rows.length === 1 ? '' : 's'} · último corte disponible</span></div>
        <div class="investment-summary-grid">
          <div class="investment-summary-card"><span>Capital aportado</span><strong>${money(capital, currency)}</strong><small>Aportes / incrementos acumulados</small></div>
          <div class="investment-summary-card ${resultClass}"><span>Ganancia / pérdida</span><strong>${money(result, currency)}</strong><small>Resultado acumulado frente al capital</small></div>
          <div class="investment-summary-card"><span>Capital + ganancia/pérdida</span><strong>${money(total, currency)}</strong><small>Valor actual consolidado de las inversiones</small></div>
        </div>`;
    } finally {
      rendering = false;
    }
  }

  function schedule(force = false, delay = 160) {
    clearTimeout(timer);
    timer = setTimeout(() => render(force), delay);
  }

  injectStyles();
  document.addEventListener('click', e => {
    if (e.target.closest('.nav-item,.currency-btn,#globalFilters .multi-filter-option,#clearFilters,#resetCurrentMonth,#clearSectionFilters')) schedule(false, 180);
    if (e.target.closest('#refreshBtn')) { cache = null; cacheAt = 0; schedule(true, 500); }
  });
  document.addEventListener('panel:section-filters-changed', e => { if (e?.detail?.view === 'inversiones') schedule(false, 100); });
  schedule(false, 500);
})();