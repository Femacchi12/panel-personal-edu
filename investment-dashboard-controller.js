(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  const POS_RANGE = 'Posiciones!A:X';
  const SUMMARY_RANGE = 'Patrimonio_Inversiones!A:K';
  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const COLORS = ['#1769ff','#26d07c','#f6c844','#ff667a','#8b5cf6','#22d3ee'];
  let frame = 0;
  let version = 0;
  let charts = [];

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const currentCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const header = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(header.map((name, index) => [name || `Col ${index + 1}`, row?.[index] ?? ''])));
  }

  function rowsFromPayload(payload, range) {
    const cached = window.__PANEL_GET_CACHED_ROWS__;
    if (typeof cached === 'function') return cached(payload, financeId, range);
    return parseRows(payload?.sources?.[`${financeId}|${range}`] || []);
  }

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) s = s.replace(/\./g,'').replace(',','.');
      else s = s.replace(/,/g,'');
    } else if (comma >= 0) {
      const p = s.split(',');
      s = p.length === 2 && p[1].length <= 4 ? p[0].replace(/\./g,'') + '.' + p[1] : s.replace(/,/g,'');
    } else if (dot >= 0) {
      const p = s.split('.');
      if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g,'');
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

  function dateLabel(value) {
    const d = value instanceof Date ? value : parseDate(value);
    return d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : '—';
  }

  function money(value, currency = currentCurrency()) {
    const digits = currency === 'USD' ? 2 : 0;
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency,
      minimumFractionDigits: digits, maximumFractionDigits: digits
    }).format(Number(value) || 0);
  }

  function pct(value) {
    const raw = String(value ?? '').trim();
    const rate = parseNumber(raw);
    const percent = raw.includes('%') ? rate : rate * 100;
    return `${percent.toLocaleString('es-CO', {minimumFractionDigits:2, maximumFractionDigits:2})}%`;
  }

  function selectedGlobal(key) {
    return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
      .map(el => String(el.dataset.value || '').trim()).filter(Boolean);
  }

  function selectedLocal(key) {
    return [...document.querySelectorAll(`.local-multi-filter[data-local-key="${key}"] .local-option.selected`)]
      .map(el => String(el.dataset.value || '').trim()).filter(Boolean);
  }

  function captureFilters() {
    return {
      years: selectedGlobal('year').map(Number).filter(Boolean),
      months: selectedGlobal('month').map(Number).filter(n => n >= 1 && n <= 12),
      platforms: selectedLocal('invPlatform'),
      classes: new Set(selectedLocal('invClass')),
      categories: new Set(selectedLocal('invCategory')),
      subcategories: new Set(selectedLocal('invSubcategory')),
      mode: selectedLocal('investmentValueMode')[0] || 'total'
    };
  }

  function forcePeriodFilters() {
    if (activeView() !== 'inversiones') return;
    const bar = document.getElementById('filterBar');
    if (bar?.hidden) bar.hidden = false;
    document.querySelectorAll('#globalFilters .multi-filter').forEach(el => {
      el.hidden = !['year','month'].includes(el.dataset.filter);
    });
  }

  function periodBounds(state) {
    const {years, months} = state;
    if (!years.length && !months.length) return {start:null, end:null, label:'Todo el histórico'};
    const ys = years.length ? years : [new Date().getFullYear()];
    let start, end;
    if (months.length) {
      const dates = [];
      ys.forEach(y => months.forEach(m => dates.push(new Date(y,m-1,1))));
      dates.sort((a,b) => a-b);
      start = dates[0];
      const last = dates.at(-1);
      end = new Date(last.getFullYear(), last.getMonth()+1, 0, 23, 59, 59, 999);
    } else {
      start = new Date(Math.min(...ys),0,1);
      end = new Date(Math.max(...ys),11,31,23,59,59,999);
    }
    const label = years.length === 1 && months.length === 1
      ? `${MONTHS[months[0]-1]} ${years[0]}`
      : years.length === 1 && !months.length
        ? String(years[0])
        : `${dateLabel(start)} – ${dateLabel(end)}`;
    return {start,end,label};
  }

  function rates() {
    return {
      usdCop: Number(cfg?.regularIncome?.usdCopReference) || 3150,
      usdArs: Number(cfg?.regularIncome?.usdArsReference) || 1500
    };
  }

  function convert(value, base, target, fx = rates()) {
    const v = Number(value) || 0;
    base = String(base || '').toUpperCase();
    target = String(target || '').toUpperCase();
    if (!base || base === target) return v;
    if (base === 'USD' && target === 'COP') return v * fx.usdCop;
    if (base === 'USD' && target === 'ARS') return v * fx.usdArs;
    if (base === 'COP' && target === 'USD') return v / fx.usdCop;
    if (base === 'COP' && target === 'ARS') return v / fx.usdCop * fx.usdArs;
    if (base === 'ARS' && target === 'USD') return v / fx.usdArs;
    if (base === 'ARS' && target === 'COP') return v / fx.usdArs * fx.usdCop;
    return v;
  }

  function canonicalEntity(platform) {
    const p = norm(platform);
    if (p.includes('arq') || p.includes('alpaca')) return 'ARQ';
    if (p.includes('cocos')) return 'Cocos Capital';
    return String(platform || '').trim();
  }

  function platformAllowed(entity, state) {
    if (!state.platforms.length) return true;
    const target = norm(entity);
    return state.platforms.some(platform => {
      const candidate = norm(canonicalEntity(platform));
      return candidate === target || candidate.includes(target) || target.includes(candidate);
    });
  }

  function applyPositionFilters(rows, state) {
    return rows.filter(row => {
      if (state.platforms.length && !platformAllowed(canonicalEntity(row['Plataforma / Bróker']), state)) return false;
      if (state.classes.size && !state.classes.has(String(row['Clase de activo'] || '').trim())) return false;
      if (state.categories.size && !state.categories.has(String(row.Categoría || '').trim())) return false;
      if (state.subcategories.size && !state.subcategories.has(String(row.Subcategoría || '').trim())) return false;
      return true;
    });
  }

  function latestSummaryAsOf(rows, end, state) {
    const groups = new Map();
    const endTime = end?.getTime() ?? Infinity;
    rows.forEach(row => {
      if (!platformAllowed(row.Entidad, state)) return;
      const d = parseDate(row['Fecha corte']); if (!d || d.getTime() > endTime) return;
      const key = String(row.Entidad || '').trim();
      const current = groups.get(key);
      if (!current || d > current.date) groups.set(key, {date:d, row});
    });
    return [...groups.values()].map(item => item.row).sort((a,b) => String(a.Entidad).localeCompare(String(b.Entidad),'es'));
  }

  function latestPositionsAsOf(rows, end) {
    const groups = new Map();
    const endTime = end?.getTime() ?? Infinity;
    rows.forEach(row => {
      const d = parseDate(row.Fecha); if (!d || d.getTime() > endTime) return;
      const platform = String(row['Plataforma / Bróker'] || 'Sin plataforma').trim();
      const current = groups.get(platform);
      if (!current || d > current.date) groups.set(platform, {date:d, rows:[row]});
      else if (d.getTime() === current.date.getTime()) current.rows.push(row);
    });
    return [...groups.values()].flatMap(item => item.rows);
  }

  function positionValue(row, currency, fx) {
    return convert(parseNumber(row['Valor original']), row['Moneda de valoración'], currency, fx);
  }

  function summaryValue(row, field, currency, fx) {
    return convert(parseNumber(row[field]), row['Moneda base'], currency, fx);
  }

  function aggregate(rows, keyFn, valueFn) {
    const map = new Map();
    rows.forEach(row => {
      const key = keyFn(row);
      map.set(key, (map.get(key) || 0) + (Number(valueFn(row)) || 0));
    });
    return map;
  }

  function currentLatest(rows) {
    const emptyState = {platforms:[]};
    const groups = new Map();
    rows.forEach(row => {
      if (!norm(row.Estado).includes('confirmado')) return;
      const d = parseDate(row['Fecha corte']); if (!d) return;
      const key = String(row.Entidad || '').trim();
      const cur = groups.get(key);
      if (!cur || d > cur.date) groups.set(key, {date:d,row});
    });
    emptyState.platforms = [...groups.values()].sort((a,b) => String(a.row.Entidad).localeCompare(String(b.row.Entidad),'es'));
    return emptyState;
  }

  function ageDays(d) {
    if (!d) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const day = new Date(d.getFullYear(),d.getMonth(),d.getDate());
    return Math.max(0, Math.floor((today-day)/86400000));
  }

  function freshnessHtml(summaryRows) {
    const {platforms} = currentLatest(summaryRows);
    let latest = null;
    const items = platforms.map(({date,row}) => {
      const days = ageDays(date);
      if (!latest || date > latest) latest = date;
      let label = 'Al día', tone = '';
      if (days == null) {label='Sin fecha';tone='bad';}
      else if (days > 60) {label='Desactualizado';tone='bad';}
      else if (days > 45) {label='Revisar';tone='warn';}
      return `<div class="investment-freshness-item"><div><strong>${esc(row.Entidad)}</strong><small>${esc(dateLabel(date))}${days==null?'':` · hace ${days} día${days===1?'':'s'}`} · ${esc(row.Estado||'')}</small></div><span class="investment-freshness-badge ${tone}">${label}</span></div>`;
    }).join('');
    return `<div class="investment-freshness"><div class="investment-freshness-head"><strong>Actualización de datos</strong><span>Último corte disponible: ${esc(dateLabel(latest))}</span></div><div class="investment-freshness-grid">${items}</div></div>`;
  }

  function buildSummaryTimeline(rows, currency, bounds, state, fx) {
    const start = bounds.start?.getTime() ?? -Infinity;
    const end = bounds.end?.getTime() ?? Infinity;
    const byEntity = new Map(), dates = new Set();
    rows.forEach(row => {
      if (!platformAllowed(row.Entidad, state)) return;
      const d = parseDate(row['Fecha corte']); if (!d) return;
      const t = d.getTime();
      if (!byEntity.has(row.Entidad)) byEntity.set(row.Entidad, []);
      byEntity.get(row.Entidad).push({t, value:summaryValue(row,'Valor mercado',currency,fx)});
      if (t >= start && t <= end) dates.add(t);
    });
    const entities = [...byEntity.keys()].sort((a,b) => a.localeCompare(b,'es'));
    byEntity.forEach(points => points.sort((a,b) => a.t-b.t));
    const timeline = [...dates].sort((a,b) => a-b);
    if (!timeline.length) return {labels:[],datasets:[]};
    const series = new Map();
    entities.forEach(entity => {
      const points = byEntity.get(entity) || [];
      let idx = 0, current = null;
      const data = timeline.map(t => {
        while (idx < points.length && points[idx].t <= t) {current = points[idx].value; idx++;}
        return current;
      });
      series.set(entity,data);
    });
    const datasets = [];
    if (entities.length > 1) {
      datasets.push({label:'Portafolio consolidado',data:timeline.map((_,i)=>entities.reduce((sum,e)=>sum+(series.get(e)?.[i]||0),0)),borderColor:COLORS[0],backgroundColor:COLORS[0],borderWidth:3,tension:.22,spanGaps:true});
    }
    entities.forEach((entity,i)=>datasets.push({label:entity,data:series.get(entity),borderColor:COLORS[(i+1)%COLORS.length],backgroundColor:COLORS[(i+1)%COLORS.length],borderWidth:2,tension:.22,spanGaps:true}));
    return {labels:timeline.map(t=>dateLabel(new Date(t))),datasets};
  }

  function destroyCharts() {charts.forEach(chart=>{try{chart.destroy();}catch{}});charts=[];}

  function chartOptions(horizontal=false, allowNegative=false) {
    const currency = currentCurrency();
    return {
      responsive:true, maintainAspectRatio:false, animation:false, indexAxis:horizontal?'y':'x',
      interaction:{mode:'nearest',intersect:false},
      plugins:{legend:{labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${money(horizontal?ctx.parsed.x:ctx.parsed.y,currency)}`}}},
      scales:{x:{ticks:{color:'#718098',maxRotation:0},grid:{color:'#121c29'}},y:{beginAtZero:!allowNegative,ticks:{color:'#718098'},grid:{color:'#121c29'}}}
    };
  }

  function injectStyles() {
    if (document.getElementById('investmentCanonicalStyles')) return;
    const style = document.createElement('style');
    style.id = 'investmentCanonicalStyles';
    style.textContent = `
      #investmentCanonical{display:grid;gap:14px}
      #investmentCanonical .table-scroll{max-height:520px}
      .investment-consolidated-overview{border:1px solid var(--border-soft);border-radius:12px;padding:12px;background:rgba(255,255,255,.015)}
      .investment-summary-title{display:flex;justify-content:space-between;align-items:end;gap:12px;margin-bottom:10px}.investment-summary-title strong{font-size:12px;color:#eef5ff}.investment-summary-title span{font-size:9px;color:#71839a}
      .investment-summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.investment-summary-card{border:1px solid var(--border-soft);border-radius:10px;padding:10px;display:grid;gap:4px;background:rgba(255,255,255,.018)}.investment-summary-card span{font-size:9px;color:#7d8ca1}.investment-summary-card strong{font-size:17px;color:#eaf2fd}.investment-summary-card small{font-size:8px;color:#68788e}.investment-summary-card.result-positive strong{color:#26d07c}.investment-summary-card.result-negative strong{color:#ff667a}
      .investment-freshness{display:grid;gap:8px}.investment-freshness-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.investment-freshness-head strong{font-size:10px;color:#cbd8e9;text-transform:uppercase;letter-spacing:.05em}.investment-freshness-head span{font-size:9px;color:#71839a}.investment-freshness-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:7px}.investment-freshness-item{border:1px solid var(--border-soft);border-radius:9px;padding:8px 9px;background:rgba(255,255,255,.025);display:flex;justify-content:space-between;gap:8px;align-items:center}.investment-freshness-item>div{display:grid;gap:2px;min-width:0}.investment-freshness-item strong{font-size:10px;color:#e2ecf8}.investment-freshness-item small{font-size:9px;color:#71839a}.investment-freshness-badge{font-size:8px;font-weight:800;border:1px solid var(--border);border-radius:99px;padding:4px 6px;color:#77dfaa;background:rgba(38,208,124,.06);white-space:nowrap}.investment-freshness-badge.warn{color:#ffcb68;background:rgba(246,200,68,.06);border-color:rgba(246,200,68,.25)}.investment-freshness-badge.bad{color:#ff8290;background:rgba(255,102,122,.06);border-color:rgba(255,102,122,.25)}
      .investment-truth-note{color:#8b9ab0;font-size:10px;line-height:1.55;padding:10px 12px;border:1px solid var(--border-soft);border-radius:10px;background:rgba(255,255,255,.015)}
      @media(max-width:760px){.investment-summary-grid{grid-template-columns:1fr}.investment-summary-title{align-items:start;flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  async function render(force=false, localVersion=version) {
    if (activeView() !== 'inversiones') return;
    forcePeriodFilters();
    const root = document.getElementById('viewRoot'); if (!root) return;
    const getter = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getter !== 'function') return;
    const payload = await getter(force).catch(error => {console.error('Inversiones:', error);return null;});
    if (!payload || localVersion !== version || activeView() !== 'inversiones') return;

    const state = captureFilters();
    const bounds = periodBounds(state);
    const currency = currentCurrency();
    const fx = rates();
    const summaryAll = rowsFromPayload(payload,SUMMARY_RANGE).filter(row=>norm(row.Estado).includes('confirmado'));
    const positionAll = applyPositionFilters(rowsFromPayload(payload,POS_RANGE),state);
    const summary = latestSummaryAsOf(summaryAll,bounds.end,state);
    const snapshot = latestPositionsAsOf(positionAll,bounds.end);
    const timeline = buildSummaryTimeline(summaryAll,currency,bounds,state,fx);

    const consolidated = summary.reduce((acc,row)=>{
      acc.capital += summaryValue(row,'Capital sin ganancia',currency,fx);
      acc.result += summaryValue(row,'Ganancia / pérdida',currency,fx);
      acc.market += summaryValue(row,'Valor mercado',currency,fx);
      return acc;
    },{capital:0,result:0,market:0});

    const mode = state.mode;
    const modeLabel = mode==='capital'?'Capital sin ganancia':mode==='result'?'Ganancia / pérdida':'Valor de mercado';
    const modeField = mode==='capital'?'Capital sin ganancia':mode==='result'?'Ganancia / pérdida':'Valor mercado';
    const byPlatform = new Map(summary.map(row=>[canonicalEntity(row.Entidad),summaryValue(row,modeField,currency,fx)]));
    const total = [...byPlatform.values()].reduce((a,b)=>a+b,0);
    const byCategory = aggregate(snapshot,row=>row.Categoría||row['Clase de activo']||'Sin categoría',row=>positionValue(row,currency,fx));
    const categoryFilters = state.classes.size || state.categories.size || state.subcategories.size;

    const resultClass = consolidated.result > 0 ? 'result-positive' : consolidated.result < 0 ? 'result-negative' : '';
    const summaryHtml = `<div class="investment-consolidated-overview"><div class="investment-summary-title"><strong>Resumen consolidado</strong><span>${summary.length} plataforma${summary.length===1?'':'s'} · ${esc(bounds.label)}</span></div><div class="investment-summary-grid"><div class="investment-summary-card"><span>Capital sin ganancia</span><strong>${esc(money(consolidated.capital,currency))}</strong><small>Costo base confirmado por extracto</small></div><div class="investment-summary-card ${resultClass}"><span>Ganancia / pérdida</span><strong>${esc(money(consolidated.result,currency))}</strong><small>Valorización neta frente al capital</small></div><div class="investment-summary-card"><span>Valor de mercado</span><strong>${esc(money(consolidated.market,currency))}</strong><small>Capital + ganancia/pérdida</small></div></div></div>`;

    let rowsHtml, tableTitle, tableSub;
    if (mode === 'total') {
      tableTitle = 'Posiciones del último corte';
      tableSub = `${snapshot.length} posiciones · composición por activo`;
      rowsHtml = `<table><thead><tr><th>Fecha</th><th>Plataforma</th><th>Símbolo</th><th>Instrumento</th><th>Clase</th><th>Categoría</th><th>Subcategoría</th><th>Cantidad</th><th>Valor ${esc(currency)}</th></tr></thead><tbody>${snapshot.slice().sort((a,b)=>String(a['Plataforma / Bróker']).localeCompare(String(b['Plataforma / Bróker']))||Math.abs(positionValue(b,currency,fx))-Math.abs(positionValue(a,currency,fx))).map(row=>`<tr><td>${esc(row.Fecha)}</td><td>${esc(row['Plataforma / Bróker'])}</td><td>${esc(row.Símbolo)}</td><td>${esc(row.Instrumento)}</td><td>${esc(row['Clase de activo'])}</td><td>${esc(row.Categoría)}</td><td>${esc(row.Subcategoría)}</td><td>${esc(row.Cantidad)}</td><td>${esc(money(positionValue(row,currency,fx),currency))}</td></tr>`).join('')}</tbody></table>`;
    } else {
      tableTitle = 'Capital y resultado por plataforma';
      tableSub = 'Fuente canónica: Patrimonio_Inversiones';
      rowsHtml = `<table><thead><tr><th>Plataforma</th><th>Fecha corte</th><th>Moneda base</th><th>Capital sin ganancia</th><th>Ganancia / pérdida</th><th>Rentabilidad</th><th>Valor de mercado</th></tr></thead><tbody>${summary.map(row=>`<tr><td>${esc(row.Entidad)}</td><td>${esc(row['Fecha corte'])}</td><td>${esc(row['Moneda base'])}</td><td>${esc(money(summaryValue(row,'Capital sin ganancia',currency,fx),currency))}</td><td>${esc(money(summaryValue(row,'Ganancia / pérdida',currency,fx),currency))}</td><td>${esc(pct(row['Rentabilidad %']))}</td><td>${esc(money(summaryValue(row,'Valor mercado',currency,fx),currency))}</td></tr>`).join('')}</tbody></table>`;
    }

    const head = root.querySelector('.section-head');
    let host = root.querySelector('#investmentCanonical');
    if (!host) {
      host = document.createElement('div');
      host.id = 'investmentCanonical';
      if (head) head.insertAdjacentElement('afterend',host); else root.prepend(host);
    }
    const note = mode !== 'total' && categoryFilters
      ? '<div class="investment-truth-note">Clase, Categoría y Subcategoría filtran únicamente la composición por activo. Capital y ganancia/pérdida son datos consolidados por plataforma y no se reparten artificialmente entre instrumentos.</div>'
      : '';

    host.innerHTML = `${freshnessHtml(summaryAll)}${summaryHtml}<div class="kpi-grid investment-kpis"><div class="kpi-card"><span class="kpi-label">${esc(modeLabel)}</span><strong class="kpi-value ${mode==='result'&&total<0?'red':'green'}">${esc(money(total,currency))}</strong><div class="kpi-meta"><span>Fuente canónica consolidada</span></div></div><div class="kpi-card"><span class="kpi-label">Plataformas</span><strong class="kpi-value">${byPlatform.size}</strong><div class="kpi-meta"><span>Según filtros aplicados</span></div></div><div class="kpi-card"><span class="kpi-label">Posiciones</span><strong class="kpi-value">${snapshot.length}</strong><div class="kpi-meta"><span>Último corte por plataforma</span></div></div><div class="kpi-card"><span class="kpi-label">Período</span><strong class="kpi-value">${esc(bounds.label)}</strong><div class="kpi-meta"><span>Año / mes seleccionado</span></div></div></div>${note}<div class="panel"><div class="panel-header"><div class="panel-title"><strong>${esc(modeLabel)} por plataforma</strong><span>Capital y resultado tomados de Patrimonio_Inversiones</span></div></div><div class="chart-wrap tall"><canvas id="investmentCanonicalPlatformChart"></canvas></div></div>${mode==='total'?`<div class="panel-grid equal"><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Por categoría</strong><span>Composición del último corte disponible</span></div></div><div class="chart-wrap tall"><canvas id="investmentCanonicalCategoryChart"></canvas></div></div><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Evolución del portafolio</strong><span>Histórico mensual consolidado por plataforma</span></div></div><div class="chart-scroll"><div class="chart-inner" style="min-width:100%;width:${Math.max(760,timeline.labels.length*100)}px;height:340px"><canvas id="investmentCanonicalTimelineChart"></canvas></div></div></div></div>`:''}<div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>${esc(tableTitle)}</strong><span>${esc(tableSub)}</span></div></div><div class="table-scroll">${rowsHtml}</div></div>`;

    destroyCharts();
    if (!window.Chart) return;
    const platformChart = document.getElementById('investmentCanonicalPlatformChart');
    if (platformChart) charts.push(new Chart(platformChart,{type:'bar',data:{labels:[...byPlatform.keys()],datasets:[{label:modeLabel,data:[...byPlatform.values()]}]},options:chartOptions(false,mode==='result')}));
    if (mode === 'total') {
      const cats = [...byCategory.entries()].sort((a,b)=>b[1]-a[1]).slice(0,14);
      const categoryChart = document.getElementById('investmentCanonicalCategoryChart');
      if (categoryChart) charts.push(new Chart(categoryChart,{type:'bar',data:{labels:cats.map(x=>x[0]),datasets:[{label:`Valor ${currency}`,data:cats.map(x=>x[1])}]},options:chartOptions(true)}));
      const timelineChart = document.getElementById('investmentCanonicalTimelineChart');
      if (timelineChart && timeline.labels.length) charts.push(new Chart(timelineChart,{type:'line',data:{labels:timeline.labels,datasets:timeline.datasets},options:chartOptions(false)}));
    }
  }

  function schedule(force=false) {
    version++;
    if (frame) cancelAnimationFrame(frame);
    const localVersion = version;
    frame = requestAnimationFrame(()=>{
      frame = 0;
      render(force,localVersion).catch(console.error);
    });
  }

  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{if(event.detail?.view==='inversiones')schedule(false);else{version++;destroyCharts();}});
  document.addEventListener('panel:section-filters-changed',event=>{if(event.detail?.view==='inversiones')schedule(false);});
  document.addEventListener('panel:section-filters-ready',event=>{if(event.detail?.view==='inversiones')schedule(false);});
  document.addEventListener('panel:backend-refresh-requested',()=>{if(activeView()==='inversiones')schedule(true);});
  document.addEventListener('panel:backend-data-loaded',()=>{if(activeView()==='inversiones')schedule(false);});
  queueMicrotask(()=>{if(activeView()==='inversiones')schedule(false);});
})();