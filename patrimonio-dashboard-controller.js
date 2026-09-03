(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  const MONTHLY_RANGE = 'Patrimonio_Mensual!A:Y';
  const DETAIL_RANGE = 'Patrimonio_Detalle!A:N';
  const INVESTMENT_RANGE = 'Patrimonio_Inversiones!A:K';

  let active = false;
  let data = { monthly: [], detail: [], investments: [] };
  let charts = [];
  let currency = 'COP';
  let loadToken = 0;
  let restoring = false;
  let restoreFrame = 0;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) s = s.replace(/\./g,'').replace(',','.');
      else s = s.replace(/,/g,'');
    } else if (comma >= 0) {
      const p = s.split(',');
      s = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g,'') + '.' + p[1] : s.replace(/,/g,'');
    } else if (dot >= 0) {
      const p = s.split('.');
      if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g,'');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const header = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(header.map((name,index) => [name || `Col ${index + 1}`, row?.[index] ?? ''])));
  }

  function rowsFromPayload(payload, range) {
    const cached = window.__PANEL_GET_CACHED_ROWS__;
    if (typeof cached === 'function') return cached(payload, financeId, range);
    return parseRows(payload?.sources?.[`${financeId}|${range}`] || []);
  }

  async function load(force = false) {
    const token = ++loadToken;
    const getter = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getter !== 'function') return;
    try {
      const payload = await getter(force);
      if (token !== loadToken) return;
      data = {
        monthly: rowsFromPayload(payload, MONTHLY_RANGE),
        detail: rowsFromPayload(payload, DETAIL_RANGE),
        investments: rowsFromPayload(payload, INVESTMENT_RANGE)
      };
      if (active) render();
    } catch (error) {
      console.warn('Patrimonio: backend no disponible', error);
      if (active && !data.monthly.length) renderLoading('No se pudieron cargar los datos de Patrimonio.');
    }
  }

  function monthKey(row) { return String(row?.Mes || row?.Periodo || '').trim(); }
  function hasValue(value) { return String(value ?? '').trim() !== ''; }
  function currentCurrency() { return document.querySelector('.currency-btn.active')?.dataset.currency || currency || 'COP'; }
  function valueFor(row, prefix, cur = currency) { return row?.[`${prefix} ${cur}`]; }

  function money(value, cur = currency) {
    const digits = cur === 'USD' ? 2 : 0;
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: cur,
      minimumFractionDigits: digits, maximumFractionDigits: digits
    }).format(num(value));
  }

  function signedMoney(value, cur = currency) {
    const n = num(value);
    return `${n > 0 ? '+' : ''}${money(n,cur)}`;
  }

  function destroyCharts() {
    charts.forEach(chart => { try { chart.destroy(); } catch {} });
    charts = [];
  }

  function latestConfirmedByEntity(rows) {
    const latest = new Map();
    (rows || []).filter(row => norm(row.Estado).includes('confirmado')).forEach(row => {
      const entity = String(row.Entidad || '').trim();
      if (!entity) return;
      const previous = latest.get(entity);
      if (!previous || String(row['Fecha corte'] || '').localeCompare(String(previous['Fecha corte'] || '')) > 0) latest.set(entity,row);
    });
    return [...latest.values()].sort((a,b) => String(a.Entidad || '').localeCompare(String(b.Entidad || ''),'es'));
  }

  function kpi(label,value,caption,tone='') {
    return `<div class="kpi-card patrimonio-kpi ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(caption)}</small></div>`;
  }

  function sectionTitle(kicker,title,copy='') {
    return `<div class="section-heading patrimonio-heading"><div><span class="eyebrow">${esc(kicker)}</span><h2>${esc(title)}</h2>${copy ? `<p>${esc(copy)}</p>` : ''}</div></div>`;
  }

  function badge(text,kind='neutral') { return `<span class="patrimonio-badge ${kind}">${esc(text)}</span>`; }

  function ensureChrome() {
    if (!active) return;
    const button = document.querySelector('.nav-item[data-view="patrimonio"]');
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active',item === button));
    const eyebrow = document.getElementById('viewEyebrow');
    const title = document.getElementById('viewTitle');
    const filters = document.getElementById('filterBar');
    const sectionFilters = document.getElementById('sectionFilterBar');
    if (eyebrow) eyebrow.textContent = 'FINANZAS';
    if (title) title.textContent = 'Patrimonio';
    if (filters) filters.hidden = true;
    if (sectionFilters) sectionFilters.hidden = true;
  }

  function renderLoading(message = 'La primera carga puede tardar unos segundos.') {
    const root = document.getElementById('viewRoot');
    if (!root || !active) return;
    ensureChrome();
    root.innerHTML = `<div class="patrimonio-dashboard">${sectionTitle('FINANZAS','Patrimonio','Foto mensual independiente de cuentas, efectivo, deudas e inversiones')}<div class="panel"><div class="empty-state"><strong>Cargando patrimonio…</strong><span>${esc(message)}</span></div></div></div>`;
  }

  function render() {
    if (!active) return;
    currency = currentCurrency();
    const root = document.getElementById('viewRoot');
    if (!root) return;
    ensureChrome();
    destroyCharts();

    if (!data.monthly.length) {
      renderLoading();
      return;
    }

    const monthly = data.monthly.slice().sort((a,b) => monthKey(a).localeCompare(monthKey(b)));
    const latest = monthly.at(-1) || {};
    const latestMonth = monthKey(latest);
    const base = valueFor(latest,'Patrimonio sin ganancia');
    const manual = valueFor(latest,'Patrimonio manual');
    const gain = valueFor(latest,'Ganancia inversiones');
    const withGain = valueFor(latest,'Patrimonio con ganancias');
    const variation = valueFor(latest,'Var patrimonio');
    const hasAdjusted = hasValue(base) && hasValue(withGain);
    const baseValue = hasAdjusted ? base : manual;
    const detailRows = data.detail.filter(row => monthKey(row) === latestMonth);
    const latestInvestments = latestConfirmedByEntity(data.investments);
    const status = latest['Estado inversión'] || 'Sin conciliación de inversiones';

    root.innerHTML = `<div class="patrimonio-dashboard">
      ${sectionTitle('FINANZAS','Patrimonio','Foto mensual independiente: el corte manual es la base sin ganancias; ARQ y Cocos solo aportan su valorización o pérdida confirmada')}
      <div class="patrimonio-status-row">${badge('Datos duros independientes','good')}${badge(`Último corte ${latest['Fecha corte'] || latestMonth}`)}${badge(status,hasAdjusted ? 'good' : 'pending')}</div>
      <div class="kpi-grid patrimonio-kpis">
        ${kpi('Patrimonio base',money(baseValue),'Corte manual · sin ganancias de inversión','blue')}
        ${kpi('Ganancia inversiones',hasAdjusted ? signedMoney(gain) : '—','Valorización neta ARQ + Cocos confirmada',num(gain) >= 0 ? 'green' : 'red')}
        ${kpi('Patrimonio con ganancias',hasAdjusted ? money(withGain) : money(baseValue),'Base + ganancia/pérdida confirmada','green')}
        ${kpi('Variación mensual',signedMoney(variation),'Variación del patrimonio base vs corte anterior',num(variation) >= 0 ? 'green' : 'red')}
      </div>
      <div class="patrimonio-currency-strip">
        <div><span>Saldo neto COP</span><strong>${money(latest['Saldo neto COP'],'COP')}</strong></div>
        <div><span>Saldo neto ARS</span><strong>${money(latest['Saldo neto ARS'],'ARS')}</strong></div>
        <div><span>Saldo neto USD</span><strong>${money(latest['Saldo neto USD'],'USD')}</strong></div>
      </div>
      <div class="panel-grid equal patrimonio-chart-grid">
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Evolución patrimonial</strong><span>Base sin ganancias vs patrimonio con valorización · ${esc(currency)}</span></div></div><div class="patrimonio-chart"><canvas id="patrimonioHistoryChart"></canvas></div></div>
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Composición del último corte</strong><span>Cuentas, efectivo, inversiones y deudas cargadas manualmente · ${esc(currency)}</span></div></div><div class="patrimonio-chart"><canvas id="patrimonioCompositionChart"></canvas></div></div>
      </div>
      <div class="panel patrimonio-investment-panel">
        <div class="panel-header"><div class="panel-title"><strong>Última conciliación de inversiones</strong><span>Capital sin valorización, resultado y valor de mercado del último extracto disponible de cada plataforma</span></div></div>
        ${latestInvestments.length ? `<div class="patrimonio-investment-cards">${latestInvestments.map(investmentCard).join('')}</div>` : '<div class="empty-state"><strong>Sin inversiones conciliadas</strong><span>Se mostrarán cuando exista capital y valor de mercado respaldados.</span></div>'}
      </div>
      <div class="panel table-panel patrimonio-table-panel">
        <div class="panel-header"><div class="panel-title"><strong>Detalle del último corte</strong><span>${esc(latestMonth)} · ${detailRows.length ? `${detailRows.length} posiciones cargadas` : 'detalle pendiente de migrar'}</span></div></div>
        ${detailRows.length ? detailTable(detailRows) : '<div class="empty-state"><strong>Sin detalle para este corte</strong><span>El histórico mensual se conserva igualmente en Patrimonio_Mensual.</span></div>'}
      </div>
      <div class="panel table-panel patrimonio-table-panel">
        <div class="panel-header"><div class="panel-title"><strong>Histórico mensual</strong><span>Los cortes manuales permanecen fijos; la ganancia se toma del último extracto cerrado disponible a cada fecha de corte</span></div></div>
        ${monthlyTable(monthly)}
      </div>
    </div>`;

    restoring = false;
    requestAnimationFrame(() => drawCharts(monthly,detailRows));
  }

  function investmentCard(row) {
    const cur = String(row['Moneda base'] || '').trim() || 'USD';
    const cap = String(row['Capital sin ganancia'] ?? '').trim();
    const market = String(row['Valor mercado'] ?? '').trim();
    const gain = String(row['Ganancia / pérdida'] ?? '').trim();
    const rateRaw = String(row['Rentabilidad %'] ?? '').trim();
    const rate = rateRaw ? (rateRaw.includes('%') ? num(rateRaw) : num(rateRaw) * 100) : null;
    return `<article class="patrimonio-investment-card"><div class="patrimonio-investment-head"><div><span>${esc(row.Entidad || 'Inversión')}</span><strong>Corte ${esc(row['Fecha corte'] || row.Periodo || '')}</strong></div>${badge(row.Estado || '','good')}</div><div class="patrimonio-investment-values"><div><span>Capital sin ganancia</span><strong>${cap ? money(cap,cur) : '—'}</strong></div><div><span>Ganancia / pérdida</span><strong class="${num(gain) >= 0 ? 'positive' : 'negative'}">${gain ? signedMoney(gain,cur) : '—'}${rate !== null ? ` · ${rate.toLocaleString('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2})}%` : ''}</strong></div><div><span>Valor de mercado</span><strong>${market ? money(market,cur) : '—'}</strong></div></div></article>`;
  }

  function detailTable(rows) {
    const sorted = rows.slice().sort((a,b) => Math.abs(num(valueFor(b,'Valor'))) - Math.abs(num(valueFor(a,'Valor'))));
    return `<div class="table-scroll patrimonio-table-scroll"><table class="data-table patrimonio-table"><thead><tr><th>Tipo</th><th>Cuenta / billetera</th><th>Grupo</th><th>Moneda ref.</th><th class="num">Valor ${esc(currency)}</th></tr></thead><tbody>${sorted.map(row => `<tr><td>${badge(row.Tipo || '',norm(row.Tipo) === 'deuda' ? 'negative' : 'neutral')}</td><td>${esc(row['Cuenta / billetera'] || '')}</td><td>${esc(row.Grupo || '')}</td><td>${esc(row['Moneda referencia'] || '')}</td><td class="num ${num(valueFor(row,'Valor')) < 0 ? 'negative' : 'positive'}">${money(valueFor(row,'Valor'))}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function monthlyTable(rows) {
    return `<div class="table-scroll patrimonio-table-scroll"><table class="data-table patrimonio-table"><thead><tr><th>Mes</th><th class="num">Base sin ganancias</th><th class="num">Variación base</th><th class="num">Ganancia inversiones</th><th class="num">Con ganancias</th><th>Extractos usados</th></tr></thead><tbody>${rows.slice().reverse().map(row => {
      const adjusted = hasValue(valueFor(row,'Patrimonio sin ganancia'));
      const baseValue = adjusted ? valueFor(row,'Patrimonio sin ganancia') : valueFor(row,'Patrimonio manual');
      return `<tr><td>${esc(monthKey(row))}</td><td class="num">${money(baseValue)}</td><td class="num ${num(valueFor(row,'Var patrimonio')) >= 0 ? 'positive' : 'negative'}">${signedMoney(valueFor(row,'Var patrimonio'))}</td><td class="num ${adjusted && num(valueFor(row,'Ganancia inversiones')) < 0 ? 'negative' : adjusted ? 'positive' : ''}">${adjusted ? signedMoney(valueFor(row,'Ganancia inversiones')) : '—'}</td><td class="num">${adjusted ? money(valueFor(row,'Patrimonio con ganancias')) : '—'}</td><td>${badge(row['Estado inversión'] || '',adjusted ? 'good' : 'pending')}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function drawCharts(monthly,detailRows) {
    if (!active || typeof Chart === 'undefined') return;
    const history = document.getElementById('patrimonioHistoryChart');
    if (history) {
      const labels = monthly.map(row => monthKey(row));
      const base = monthly.map(row => {
        const adjusted = hasValue(valueFor(row,'Patrimonio sin ganancia'));
        return num(adjusted ? valueFor(row,'Patrimonio sin ganancia') : valueFor(row,'Patrimonio manual'));
      });
      const withGain = monthly.map(row => hasValue(valueFor(row,'Patrimonio con ganancias')) ? num(valueFor(row,'Patrimonio con ganancias')) : null);
      charts.push(new Chart(history,{type:'line',data:{labels,datasets:[{label:'Patrimonio base · sin ganancias',data:base,borderColor:'#73b9ff',backgroundColor:'rgba(115,185,255,.08)',pointRadius:2,tension:.25},{label:'Patrimonio con ganancias',data:withGain,borderColor:'#00f29a',backgroundColor:'rgba(0,242,154,.08)',pointRadius:3,tension:.25,spanGaps:false}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true}},scales:{y:{ticks:{callback:value => compactMoney(value,currency)}}}}}));
    }
    const composition = document.getElementById('patrimonioCompositionChart');
    if (composition && detailRows.length) {
      const top = detailRows.filter(row => Math.abs(num(valueFor(row,'Valor'))) > 0).sort((a,b) => Math.abs(num(valueFor(b,'Valor'))) - Math.abs(num(valueFor(a,'Valor')))).slice(0,10);
      charts.push(new Chart(composition,{type:'bar',data:{labels:top.map(row => row['Cuenta / billetera'] || ''),datasets:[{label:`Valor ${currency}`,data:top.map(row => num(valueFor(row,'Valor'))),backgroundColor:top.map(row => num(valueFor(row,'Valor')) < 0 ? 'rgba(255,117,133,.7)' : 'rgba(0,242,154,.65)'),borderRadius:6}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{callback:value => compactMoney(value,currency)}}}}}));
    }
  }

  function compactMoney(value,cur) {
    const n = Number(value) || 0, abs = Math.abs(n);
    let scale = 1, suffix = '';
    if (abs >= 1e6) { scale = 1e6; suffix = 'M'; }
    else if (abs >= 1e3) { scale = 1e3; suffix = 'K'; }
    return `${cur} ${(n/scale).toLocaleString('es-CO',{maximumFractionDigits:scale === 1 ? 0 : 1})}${suffix}`;
  }

  function scheduleRestore() {
    if (!active || restoreFrame) return;
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = 0;
      if (!active) return;
      ensureChrome();
      const root = document.getElementById('viewRoot');
      if (!root || root.querySelector('.patrimonio-dashboard')) return;
      if (restoring) return;
      restoring = true;
      if (data.monthly.length) render();
      else load(false);
    });
  }

  function activate(event) {
    const button = event.target.closest('.nav-item[data-view="patrimonio"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    active = true;
    currency = currentCurrency();
    ensureChrome();
    if (data.monthly.length) render(); else renderLoading();
    load(false);
    setTimeout(ensureChrome,0);
    setTimeout(ensureChrome,120);
  }

  function leaveIfNeeded(event) {
    const button = event.target.closest('.nav-item[data-view]');
    if (!active || !button || button.dataset.view === 'patrimonio') return;
    active = false;
    restoring = false;
    destroyCharts();
    const filters = document.getElementById('filterBar');
    if (filters) filters.hidden = false;
  }

  function currencyClick(event) {
    const button = event.target.closest('.currency-btn');
    if (!active || !button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    currency = button.dataset.currency || 'COP';
    document.querySelectorAll('.currency-btn').forEach(item => item.classList.toggle('active',item === button));
    render();
  }

  const root = document.getElementById('viewRoot');
  if (root) {
    new MutationObserver(() => {
      if (!active) return;
      ensureChrome();
      if (!root.querySelector('.patrimonio-dashboard')) scheduleRestore();
    }).observe(root,{childList:true,subtree:false});
  }

  document.addEventListener('click',activate,true);
  document.addEventListener('click',leaveIfNeeded,true);
  document.addEventListener('click',currencyClick,true);
  document.addEventListener('panel:view-root-changed',event => {
    if (event.detail?.view === 'patrimonio') {
      active = true;
      ensureChrome();
      if (!event.detail.root?.querySelector('.patrimonio-dashboard')) scheduleRestore();
    } else if (active && document.querySelector('.nav-item.active')?.dataset.view !== 'patrimonio') {
      active = false;
      destroyCharts();
    }
  });
  document.addEventListener('panel:section-filters-ready',event => { if (event.detail?.view === 'patrimonio' || active) setTimeout(ensureChrome,0); });
  document.addEventListener('panel:backend-data-loaded',() => { if (active) setTimeout(() => load(false),0); });
  document.addEventListener('panel:manual-refresh-complete',() => { if (active) setTimeout(() => load(false),0); });
  window.__PANEL_PATRIMONIO_RENDER__ = () => { if (active) load(false); };
})();