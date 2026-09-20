(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = String(cfg.financeSpreadsheetId || '');
  if (!FINANCE_ID) return;

  const COLORS = ['#1769ff','#f6c844','#26d07c','#ff667a','#ffad42','#7a8ba5','#8b5cf6','#22d3ee','#f472b6','#a3e635'];
  const MONTH_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const MONTH_MAP = {ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};

  let renderFrame = 0;
  let loadVersion = 0;
  let chartMode = 'cumulative';
  let rawRows = [];
  let lastPayload = null;

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
    if (c >= 0 && d >= 0) s = c > d ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'');
    else if (c >= 0) {
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
      .map(row => Object.fromEntries(headers.map((key,i) => [key || `Col ${i + 1}`, row?.[i] ?? ''])));
  }

  function parseDate(value) {
    const s = String(value || '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
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
    return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}` : '';
  }

  function rowDateInPeriod(row, period) {
    const real = parseDate(row['Fecha real']);
    if (real) {
      const key = `${real.getFullYear()}-${String(real.getMonth() + 1).padStart(2,'0')}`;
      return key === period ? real : null;
    }
    const registered = parseDate(row['Fecha registrada']);
    if (registered) {
      const key = `${registered.getFullYear()}-${String(registered.getMonth() + 1).padStart(2,'0')}`;
      return key === period ? registered : null;
    }
    return null;
  }

  function scopeOf(row) {
    const explicit = norm(row['Ámbito'] || row.Ambito);
    if (explicit.includes('fibrazo')) return 'FIBRAZO';
    if (explicit.includes('personal')) return 'Personal';
    const fallback = norm([row['Descripción / Comercio'],row['Descripción original'],row.Observaciones,row.Fuente].filter(Boolean).join(' '));
    return fallback.includes('fibrazo') ? 'FIBRAZO' : 'Personal';
  }

  function activeScope() {
    return window.__FINANCE_SCOPE_FILTER_STATE__?.gastos || 'Personal';
  }

  function account(row) {
    const raw = String(row['Cuenta / Tarjeta'] || '').trim(), n = norm(raw), holder = norm(row.Titular);
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
    const policy = window.FinancePurchasePolicy;
    if (typeof policy?.method === 'function') return policy.method(row);
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

  function isActualExpense(row) {
    const actual = window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad|pendiente/.test(norm(row.Estado));
    if (!actual) return false;
    const type = norm(row.Tipo || row.Naturaleza || 'gasto');
    return type.includes('gasto') || type.includes('egreso') || type.includes('compra') || !String(row.Tipo || '').trim();
  }

  function filterContext() {
    const payment = window.__PAYMENT_FILTER_STATE__?.view === 'gastos' ? window.__PAYMENT_FILTER_STATE__ : {account:[],method:[]};
    return {
      years: new Set(selectedGlobal('year')),
      months: new Set(selectedGlobal('month').map(v => String(Number(v)))),
      categories: new Set(selectedGlobal('category')),
      subcategories: new Set(selectedGlobal('subcategory')),
      accounts: new Set(payment.account || []),
      methods: new Set(payment.method || []),
      scope: activeScope()
    };
  }

  function matches(row, ctx) {
    if (!isActualExpense(row)) return false;
    if (ctx.scope !== 'Todos' && scopeOf(row) !== ctx.scope) return false;
    const period = rowPeriod(row);
    const pm = period.match(/^(20\d{2})-(\d{2})$/);
    if (ctx.years.size && (!pm || !ctx.years.has(pm[1]))) return false;
    if (ctx.months.size && (!pm || !ctx.months.has(String(+pm[2])))) return false;
    if (ctx.categories.size && !ctx.categories.has(String(row['Categoría'] || ''))) return false;
    if (ctx.subcategories.size && !ctx.subcategories.has(String(row['Subcategoría'] || ''))) return false;
    if (ctx.accounts.size && !ctx.accounts.has(account(row))) return false;
    if (ctx.methods.size && !ctx.methods.has(method(row))) return false;
    return true;
  }

  function amount(row, currency) {
    if (currency === 'USD') return parseNumber(row['Monto USD']);
    if (currency === 'ARS') return parseNumber(row['Monto ARS']);
    return parseNumber(row['Monto COP']);
  }

  function formatMoney(value, currency) {
    return new Intl.NumberFormat('es-CO',{style:'currency',currency,maximumFractionDigits:currency === 'USD' ? 2 : 0}).format(Number(value) || 0);
  }

  function injectStyles() {
    if (document.getElementById('spendChartModeStyles')) return;
    const style = document.createElement('style');
    style.id = 'spendChartModeStyles';
    style.textContent = `
      .spend-chart-mode{display:flex;align-items:center;gap:5px;margin-left:auto;padding:3px;border:1px solid #263548;border-radius:9px;background:#0b131e}
      .spend-chart-mode button{border:0;background:transparent;color:#8393a8;border-radius:6px;padding:6px 9px;font-size:10px;font-weight:700;cursor:pointer}
      .spend-chart-mode button.active{background:#17345f;color:#dbeaff}
      .spend-chart-mode[hidden]{display:none!important}
      #spendChart{cursor:pointer}
    `;
    document.head.appendChild(style);
  }

  function ensureModeControl(canvas, singlePeriod) {
    const panel = canvas.closest('.panel'), header = panel?.querySelector('.panel-header');
    if (!panel || !header) return;
    let control = header.querySelector('[data-spend-chart-mode]');
    if (!control) {
      control = document.createElement('div');
      control.className = 'spend-chart-mode';
      control.dataset.spendChartMode = 'true';
      control.innerHTML = '<button type="button" data-spend-mode="cumulative">Acumulado</button><button type="button" data-spend-mode="daily">Por día</button>';
      control.addEventListener('click', event => {
        const btn = event.target.closest('[data-spend-mode]');
        if (!btn) return;
        const next = String(btn.dataset.spendMode || 'cumulative');
        if (next === chartMode) return;
        chartMode = next;
        renderCurrent();
      });
      header.appendChild(control);
    }
    control.hidden = !singlePeriod;
    control.querySelectorAll('[data-spend-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.spendMode === chartMode));
    const subtitle = panel.querySelector('.panel-title span');
    if (subtitle) subtitle.textContent = `Ámbito: ${activeScope()} · ${singlePeriod ? (chartMode === 'daily' ? 'gasto realizado en cada día' : 'acumulado de gasto real día a día') : 'total real por período seleccionado'}`;
  }

  function chartOptions(currency) {
    return {
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'nearest',intersect:true},
      onHover:(event,elements) => {
        const target = event?.native?.target;
        if (target) target.style.cursor = elements?.length ? 'pointer' : 'default';
      },
      plugins:{
        legend:{display:true,labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}},
        tooltip:{callbacks:{label:ctx => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y,currency)}`}}
      },
      scales:{
        x:{ticks:{color:'#718098',maxRotation:0,autoSkip:true},grid:{color:'#121c29'}},
        y:{beginAtZero:true,ticks:{color:'#718098'},grid:{color:'#121c29'}}
      }
    };
  }

  function drawChart(canvas, type, labels, dataset, currency, keys, granularity) {
    canvas.dataset.spendKeys = JSON.stringify(keys || []);
    canvas.dataset.spendGranularity = granularity || 'month';

    const existing = Chart.getChart(canvas);
    if (existing && existing.config.type === type) {
      existing.data.labels = labels;
      existing.data.datasets = [dataset];
      existing.options.plugins.tooltip.callbacks.label = ctx => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y,currency)}`;
      existing.update('none');
      return;
    }
    existing?.destroy();
    new Chart(canvas,{type,data:{labels,datasets:[dataset]},options:chartOptions(currency)});
  }

  function preferredSinglePeriod(rows, ctx) {
    const periods = [...new Set(rows.map(rowPeriod).filter(Boolean))].sort();
    if (periods.length === 1) return periods[0];
    if (!periods.length && ctx.years.size === 1 && ctx.months.size === 1) {
      return `${[...ctx.years][0]}-${String(+[...ctx.months][0]).padStart(2,'0')}`;
    }
    return '';
  }

  function redraw(rows, ctx) {
    if (activeView() !== 'gastos' || !window.Chart) return;
    const canvas = document.getElementById('spendChart');
    if (!canvas) return;

    const currency = activeCurrency();
    const singlePeriod = preferredSinglePeriod(rows, ctx);
    ensureModeControl(canvas, Boolean(singlePeriod));

    let labels = [], values = [], keys = [], type = 'line', seriesLabel = 'Total del período', granularity = 'month';

    if (singlePeriod) {
      const [year,month] = singlePeriod.split('-').map(Number);
      const now = new Date();
      const endDay = year === now.getFullYear() && month === now.getMonth() + 1
        ? now.getDate()
        : new Date(year, month, 0).getDate();

      const daily = new Map();
      let undated = 0;
      rows.forEach(row => {
        if (rowPeriod(row) !== singlePeriod) return;
        const d = rowDateInPeriod(row, singlePeriod);
        if (!d) {
          undated += amount(row,currency);
          return;
        }
        daily.set(d.getDate(), (daily.get(d.getDate()) || 0) + amount(row,currency));
      });

      let running = 0;
      for (let day = 1; day <= endDay; day++) {
        const value = daily.get(day) || 0;
        running += value;
        labels.push(`${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}`);
        keys.push(`${singlePeriod}-${String(day).padStart(2,'0')}`);
        values.push(chartMode === 'daily' ? value : running);
      }
      if (Math.abs(undated) > 0.0001) {
        labels.push('Sin fecha');
        keys.push(`${singlePeriod}|undated`);
        values.push(chartMode === 'daily' ? undated : running + undated);
      }

      granularity = 'day';
      if (chartMode === 'daily') {
        type = 'bar';
        seriesLabel = 'Gasto del día';
      } else {
        type = 'line';
        seriesLabel = 'Gasto acumulado';
      }
    } else {
      const totals = new Map();
      rows.forEach(row => {
        const key = rowPeriod(row);
        if (!key) return;
        totals.set(key,(totals.get(key) || 0) + amount(row,currency));
      });
      keys = [...totals.keys()].sort();
      labels = keys.map(period => {
        const [year,month] = period.split('-').map(Number);
        return `${MONTH_LABELS[month - 1]} ${year}`;
      });
      values = keys.map(period => totals.get(period) || 0);
      seriesLabel = 'Total del período';
      granularity = 'month';
    }

    const onePoint = values.length === 1;
    const dataset = {
      label:seriesLabel,
      data:values,
      borderColor:COLORS[0],
      backgroundColor:COLORS[0],
      borderWidth:2,
      tension:type === 'line' ? .22 : 0,
      pointRadius:type === 'line' ? (onePoint ? 6 : 3) : 0,
      pointHoverRadius:type === 'line' ? (onePoint ? 8 : 6) : 0,
      pointHitRadius:type === 'line' ? 12 : 0,
      spanGaps:true,
      borderRadius:type === 'bar' ? 4 : 0,
      minBarLength:type === 'bar' ? 2 : undefined
    };

    drawChart(canvas,type,labels,dataset,currency,keys,granularity);
  }

  function renderCurrent() {
    if (!lastPayload || activeView() !== 'gastos') return;
    const ctx = filterContext();
    redraw(rawRows.filter(row => matches(row,ctx)),ctx);
  }

  async function load() {
    if (activeView() !== 'gastos') return;
    const getData = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getData !== 'function') return;
    const version = ++loadVersion;
    const data = await getData(false);
    if (version !== loadVersion || activeView() !== 'gastos') return;

    if (data !== lastPayload) {
      lastPayload = data;
      const cached = window.__PANEL_GET_CACHED_ROWS__;
      if (typeof cached === 'function') {
        const wide = cached(data,FINANCE_ID,'Movimientos!A:AA');
        rawRows = wide.length ? wide : cached(data,FINANCE_ID,'Movimientos!A:Z');
      } else {
        rawRows = parseRows(data?.sources?.[`${FINANCE_ID}|Movimientos!A:AA`] || data?.sources?.[`${FINANCE_ID}|Movimientos!A:Z`] || []);
      }
    }
    renderCurrent();
  }

  function schedule() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      load().catch(error => console.error('Gráfico de gastos:',error));
    });
  }

  injectStyles();
  document.addEventListener('panel:view-root-changed', event => {
    if (event.detail?.view === 'gastos') schedule();
    else loadVersion++;
  });
  document.addEventListener('panel:payment-filters-changed', event => { if (event.detail?.view === 'gastos') schedule(); });
  document.addEventListener('panel:expense-scope-changed', event => { if (event.detail?.view === 'gastos') schedule(); });
  document.addEventListener('panel:filters-updated', () => { if (activeView() === 'gastos') schedule(); });
  document.addEventListener('panel:backend-data-loaded', () => {
    lastPayload = null;
    rawRows = [];
    if (activeView() === 'gastos') schedule();
  });
  document.addEventListener('click', event => {
    if (event.target.closest?.('.currency-btn') && activeView() === 'gastos') setTimeout(schedule,0);
  },true);
  queueMicrotask(schedule);
})();