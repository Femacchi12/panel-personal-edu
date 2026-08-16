(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const COLORS = ['#1769ff','#26d07c','#f6c844','#ff667a','#8b5cf6','#22d3ee'];
  const FILTER_FIELDS = {
    invPlatform:['Plataforma / Bróker'],
    invClass:['Clase de activo'],
    invCategory:['Categoría'],
    invSubcategory:['Subcategoría']
  };

  let cache = null;
  let cacheAt = 0;
  let chart = null;
  let timer = null;
  let observer = null;

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function activeView() {
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  function currentCurrency() {
    return document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((header,index) => [header || `Col ${index+1}`,row?.[index] ?? ''])));
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
      const parts = s.split(',');
      s = parts.length === 2 && parts[1].length <= 2 ? parts[0].replace(/\./g,'') + '.' + parts[1] : s.replace(/,/g,'');
    } else if (dot >= 0) {
      const parts = s.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = s.replace(/\./g,'');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parseDate(value) {
    const s = String(value || '').trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]));
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function dateLabel(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')}`;
  }

  function money(value,currency) {
    const digits = currency === 'USD' ? 2 : 0;
    return new Intl.NumberFormat('es-CO',{
      style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits
    }).format(Number(value)||0);
  }

  function selectedValues(key) {
    return [...document.querySelectorAll(`.local-multi-filter[data-local-key="${key}"] .local-option.selected`)]
      .map(el => String(el.dataset.value || '').trim())
      .filter(Boolean);
  }

  function filteredRows(rows) {
    return rows.filter(row => Object.entries(FILTER_FIELDS).every(([key,fields]) => {
      const selected = selectedValues(key);
      if (!selected.length) return true;
      const value = fields.map(field => String(row?.[field] ?? '').trim()).find(Boolean) || '';
      return selected.includes(value);
    }));
  }

  async function getPayload(force = false) {
    if (!force && cache && Date.now() - cacheAt < 55_000) return cache;
    const getToken = window.__PANEL_GET_ID_TOKEN__;
    if (typeof getToken !== 'function') throw new Error('Sesión Firebase no disponible');
    const token = await getToken(false);
    if (!token) throw new Error('Sesión Firebase no disponible');
    const response = await fetch(`${apiBaseUrl}/api/data`,{
      headers:{Authorization:`Bearer ${token}`},cache:'no-store'
    });
    if (!response.ok) throw new Error(`Backend ${response.status}`);
    cache = await response.json();
    cacheAt = Date.now();
    return cache;
  }

  function buildTimeline(rows,currency) {
    const dated = rows.map(row => {
      const date = parseDate(row.Fecha);
      const platform = String(row['Plataforma / Bróker'] || 'Sin plataforma').trim();
      return date ? {row,date:date.getTime(),platform,value:parseNumber(row[`Valor ${currency}`])} : null;
    }).filter(Boolean);

    const dates = [...new Set(dated.map(item => item.date))].sort((a,b)=>a-b);
    const platforms = [...new Set(dated.map(item => item.platform))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true,sensitivity:'base'}));
    const snapshots = new Map();

    platforms.forEach(platform => snapshots.set(platform,new Map()));
    dated.forEach(item => {
      const map = snapshots.get(item.platform);
      map.set(item.date,(map.get(item.date)||0)+item.value);
    });

    function valueAt(platform,date) {
      const map = snapshots.get(platform);
      if (!map) return null;
      let latestDate = null;
      let latestValue = null;
      for (const [snapshotDate,value] of map.entries()) {
        if (snapshotDate <= date && (latestDate === null || snapshotDate > latestDate)) {
          latestDate = snapshotDate;
          latestValue = value;
        }
      }
      return latestValue;
    }

    const datasets = [];
    if (platforms.length > 1) {
      datasets.push({
        label:'Portafolio consolidado',
        data:dates.map(date => platforms.reduce((total,platform)=>total+(valueAt(platform,date)||0),0)),
        borderWidth:3,
        tension:.22,
        spanGaps:true
      });
    }

    platforms.forEach((platform,index) => {
      datasets.push({
        label:platform,
        data:dates.map(date => valueAt(platform,date)),
        borderColor:COLORS[index % COLORS.length],
        backgroundColor:COLORS[index % COLORS.length],
        borderWidth:2,
        tension:.22,
        spanGaps:true
      });
    });

    return {dates,platforms,datasets};
  }

  function chartOptions(currency) {
    return {
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'nearest',intersect:false},
      animation:false,
      plugins:{
        legend:{labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}},
        tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${money(ctx.parsed.y,currency)}`}}
      },
      scales:{
        x:{ticks:{color:'#718098',maxRotation:0,autoSkip:true},grid:{color:'#121c29'}},
        y:{beginAtZero:true,ticks:{color:'#718098',callback:value=>new Intl.NumberFormat('es-CO',{notation:'compact',maximumFractionDigits:1}).format(value)},grid:{color:'#121c29'}}
      }
    };
  }

  async function render(force = false) {
    if (activeView() !== 'inversiones') return;
    const host = document.getElementById('investmentCorrected');
    if (!host || host.querySelector('#investmentTimelinePanel')) return;

    const payload = await getPayload(force).catch(error => {
      console.error('No se pudo cargar la evolución de inversiones:',error);
      return null;
    });
    if (!payload || activeView() !== 'inversiones') return;

    const raw = parseRows(payload?.sources?.[`${financeId}|Posiciones!A:X`] || []);
    const rows = filteredRows(raw);
    const currency = currentCurrency();
    const timeline = buildTimeline(rows,currency);

    const panel = document.createElement('div');
    panel.id = 'investmentTimelinePanel';
    panel.className = 'panel';

    if (!timeline.dates.length) {
      panel.innerHTML = `<div class="panel-header"><div class="panel-title"><strong>Evolución del portafolio</strong><span>Histórico según los filtros aplicados</span></div></div><div class="empty-state"><div><strong>Sin histórico para mostrar</strong><span>No hay cortes de posiciones que coincidan con los filtros seleccionados.</span></div></div>`;
    } else {
      const width = Math.max(760,timeline.dates.length*115);
      panel.innerHTML = `<div class="panel-header"><div class="panel-title"><strong>Evolución del portafolio</strong><span>Histórico según filtros · el consolidado usa el último valor conocido de cada plataforma entre sus fechas de corte</span></div></div><div class="chart-scroll"><div class="chart-inner" style="width:${width}px;min-width:100%;height:340px"><canvas id="investmentTimelineChart"></canvas></div></div>`;
    }

    const grid = host.querySelector('.panel-grid.equal');
    if (grid) grid.insertAdjacentElement('afterend',panel);
    else host.appendChild(panel);

    if (!timeline.dates.length || !window.Chart) return;
    chart?.destroy();
    const canvas = document.getElementById('investmentTimelineChart');
    if (!canvas) return;
    chart = new Chart(canvas,{
      type:'line',
      data:{labels:timeline.dates.map(dateLabel),datasets:timeline.datasets},
      options:chartOptions(currency)
    });
  }

  function schedule(force = false,delay = 120) {
    clearTimeout(timer);
    timer = setTimeout(()=>render(force),delay);
  }

  document.addEventListener('click',event => {
    if (event.target.closest('.nav-item')) schedule(false,180);
    if (event.target.closest('.currency-btn')) schedule(false,220);
    if (event.target.closest('.local-option,.local-clear,#clearSectionFilters')) schedule(false,320);
    if (event.target.closest('#refreshBtn')) {
      cache = null;
      cacheAt = 0;
      schedule(true,500);
    }
  });

  const root = document.getElementById('viewRoot');
  if (root) {
    observer = new MutationObserver(()=>schedule(false,140));
    observer.observe(root,{childList:true,subtree:true});
  }

  schedule(false,250);
})();
