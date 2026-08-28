(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = String(cfg.financeSpreadsheetId || '');
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  if (!FINANCE_ID || !apiBaseUrl) return;

  const COLORS = ['#1769ff','#f6c844','#26d07c','#ff667a','#ffad42','#7a8ba5','#8b5cf6','#22d3ee','#f472b6','#a3e635'];
  const MONTH_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  let cache = null;
  let cacheAt = 0;
  let timer = null;

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const activeCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';
  const selectedGlobal = key => [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
    .map(x => String(x.dataset.value || '').trim()).filter(Boolean);

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c >= 0 && d >= 0) {
      if (c > d) s = s.replace(/\./g,'').replace(',','.');
      else s = s.replace(/,/g,'');
    } else if (c >= 0) {
      const p = s.split(',');
      s = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g,'') + '.' + p[1] : s.replace(/,/g,'');
    } else if (d >= 0) {
      const p = s.split('.');
      if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g,'');
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
    if (!force && cache && Date.now() - cacheAt < 45_000) return cache;
    const token = await window.__PANEL_GET_ID_TOKEN__?.(false);
    if (!token) return null;
    const response = await fetch(`${apiBaseUrl}/api/data`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    if (!response.ok) return null;
    cache = await response.json();
    cacheAt = Date.now();
    return cache;
  }

  const sourceRows = data => parseRows(data?.sources?.[`${FINANCE_ID}|Movimientos!A:Z`] || []);

  function parseDate(value) {
    const s = String(value || '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }

  function account(row) {
    const raw = String(row['Cuenta / Tarjeta'] || '').trim();
    const n = norm(raw), holder = norm(row.Titular);
    if (n.includes('efectivo')) return 'Efectivo';
    if (n.includes('nequi')) return holder.includes('ro') ? 'Nequi Ro' : 'Nequi Edu';
    if (n.includes('arq')) return 'ARQ Edu';
    if (n.includes('nu')) {
      if (n.includes(' ro') || n.endsWith('ro') || holder === 'ro' || holder.includes('rocio')) return 'Nu Ro';
      if (n.includes('edu') || holder.includes('edu')) return 'Nu Edu';
      return 'Nu';
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
    if (parseNumber(row.Cuotas) > 0 && (raw.includes('nu') || raw.includes('arq'))) return 'Crédito';
    return 'Sin especificar';
  }

  function matches(row) {
    if (!(window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad/.test(norm(row.Estado)))) return false;
    const d = parseDate(row['Fecha real'] || row['Fecha registrada']);
    const years = selectedGlobal('year');
    const months = selectedGlobal('month');
    const categories = selectedGlobal('category');
    const subcategories = selectedGlobal('subcategory');
    if (years.length && (!d || !years.includes(String(d.getFullYear())))) return false;
    if (months.length && (!d || !months.includes(String(d.getMonth() + 1)))) return false;
    if (categories.length && !categories.includes(String(row['Categoría'] || ''))) return false;
    if (subcategories.length && !subcategories.includes(String(row['Subcategoría'] || ''))) return false;
    const payment = window.__PAYMENT_FILTER_STATE__?.view === 'gastos'
      ? window.__PAYMENT_FILTER_STATE__
      : { account: [], method: [] };
    if (payment.account?.length && !payment.account.includes(account(row))) return false;
    if (payment.method?.length && !payment.method.includes(method(row))) return false;
    const type = norm(row.Tipo || row.Naturaleza || 'gasto');
    return type.includes('gasto') || norm(row.Naturaleza).includes('egreso') || !String(row.Tipo || '').trim();
  }

  function amount(row, currency) {
    if (currency === 'USD') return parseNumber(row['Monto USD']);
    if (currency === 'ARS') return parseNumber(row['Monto ARS']);
    return parseNumber(row['Monto COP']);
  }

  function redraw(rows) {
    if (activeView() !== 'gastos' || !window.Chart) return;
    const canvas = document.getElementById('spendChart');
    if (!canvas) return;
    Chart.getChart(canvas)?.destroy();
    const currency = activeCurrency();
    const periods = [...new Set(rows.map(row => {
      const d = parseDate(row['Fecha real'] || row['Fecha registrada']);
      return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}` : '';
    }).filter(Boolean))].sort();
    const series = [...new Set(rows.map(row => String(row['Categoría'] || 'Total')).filter(Boolean))].slice(0,10);
    const datasets = series.map((seriesName, i) => ({
      label: seriesName,
      data: periods.map(period => rows.filter(row => {
        const d = parseDate(row['Fecha real'] || row['Fecha registrada']);
        return d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}` === period && String(row['Categoría'] || 'Total') === seriesName;
      }).reduce((sum, row) => sum + amount(row, currency), 0)),
      borderColor: COLORS[i % COLORS.length],
      backgroundColor: COLORS[i % COLORS.length],
      borderWidth: 2,
      tension: .25
    }));
    const labels = periods.map(period => {
      const [year, month] = period.split('-').map(Number);
      return `${MONTH_LABELS[month - 1]} ${year}`;
    });
    new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { color:'#9aa8ba', boxWidth:10, usePointStyle:true } } },
        scales: {
          x: { ticks:{color:'#718098'}, grid:{color:'#121c29'} },
          y: { beginAtZero:true, ticks:{color:'#718098'}, grid:{color:'#121c29'} }
        }
      }
    });
  }

  async function apply(force = false) {
    if (activeView() !== 'gastos') return;
    const data = await payload(force);
    if (!data) return;
    redraw(sourceRows(data).filter(matches));
  }

  const schedule = (delay = 180, force = false) => {
    clearTimeout(timer);
    timer = setTimeout(() => apply(force).catch(console.error), delay);
  };

  document.addEventListener('panel:payment-filters-changed', () => schedule(100, false));
  document.addEventListener('panel:filters-updated', () => schedule(140, false));
  document.addEventListener('click', event => {
    if (event.target.closest('#refreshBtn')) {
      cache = null;
      cacheAt = 0;
      schedule(500, true);
      return;
    }
    if (event.target.closest('.multi-filter-option,.nav-item,.currency-btn,#resetCurrentMonth,#clearFilters,[data-clear-filter]')) schedule(220, false);
  }, true);
  setTimeout(() => apply(false), 700);
})();
