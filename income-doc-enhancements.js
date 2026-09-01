(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  const MONTHS = {
    ene:1, enero:1, feb:2, febrero:2, mar:3, marzo:3, abr:4, abril:4,
    may:5, mayo:5, jun:6, junio:6, jul:7, julio:7, ago:8, agosto:8,
    sep:9, sept:9, septiembre:9, oct:10, octubre:10, nov:11, noviembre:11,
    dic:12, diciembre:12
  };

  let chart = null;
  let frame = 0;
  let renderVersion = 0;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim();
    if (!s || /#VALUE|#N\/A|----/i.test(s)) return 0;
    s = s.replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) s = s.replace(/\./g,'').replace(',','.');
      else s = s.replace(/,/g,'');
    } else if (comma >= 0) {
      const parts = s.split(',');
      if (parts.length === 2 && parts[1].length <= 2) s = parts[0].replace(/\./g,'') + '.' + parts[1];
      else s = s.replace(/,/g,'');
    } else if (dot >= 0) {
      const parts = s.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = s.replace(/\./g,'');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  const cop = value => new Intl.NumberFormat('es-CO', {
    style:'currency', currency:'COP', maximumFractionDigits:0
  }).format(Number(value) || 0);
  const usd = value => new Intl.NumberFormat('es-CO', {
    style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:2
  }).format(Number(value) || 0);

  function parseRows(values) {
    if (!Array.isArray(values) || !values.length) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((h,i) => [h || `Col ${i+1}`, row?.[i] ?? ''])));
  }

  function selectedValues(key) {
    return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
      .map(el => String(el.dataset.value || '').trim())
      .filter(Boolean);
  }

  function currentPeriodState() {
    return {
      years: new Set(selectedValues('year')),
      months: new Set(selectedValues('month').map(Number))
    };
  }

  function monthNumber(value) {
    const raw = norm(value);
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      return n >= 1 && n <= 12 ? n : null;
    }
    return MONTHS[raw.split(/[\s\-\/]+/)[0]] || null;
  }

  function rowPeriod(row) {
    let year = Number(String(row['Año'] || '').match(/\d{4}/)?.[0] || 0) || null;
    let month = monthNumber(row['Mes']);
    const mesText = String(row['Mes'] || '');
    if (!year) year = Number(mesText.match(/\b(20\d{2})\b/)?.[1] || 0) || null;
    if (!year || !month) {
      for (const key of ['Fecha devengo','Fecha pago','Fecha','Periodo','Período','Fecha inicio']) {
        const value = String(row[key] || '').trim();
        if (!value) continue;
        let m = value.match(/^(\d{4})-(\d{1,2})/);
        if (m) return {year:Number(m[1]), month:Number(m[2])};
        m = norm(value).match(/^(ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[\s\-/]+(20\d{2})/);
        if (m) return {year:Number(m[2]), month:MONTHS[m[1]]};
      }
    }
    return {year, month};
  }

  function filterPeriod(rows, state) {
    return (rows || []).filter(row => {
      const p = rowPeriod(row);
      if (state.years.size && (!p.year || !state.years.has(String(p.year)))) return false;
      if (state.months.size && (!p.month || !state.months.has(Number(p.month)))) return false;
      return true;
    });
  }

  async function getPayload(force = false) {
    const getData = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getData !== 'function') throw new Error('Backend central de datos no disponible');
    return getData(force);
  }

  function rowsFromPayload(payload, range, spreadsheetId = financeId) {
    const key = `${spreadsheetId}|${range}`;
    if (payload?.sourceErrors?.[key]) return [];
    const cached = window.__PANEL_GET_CACHED_ROWS__;
    if (typeof cached === 'function') return cached(payload, spreadsheetId, range);
    return parseRows(payload?.sources?.[key] || []);
  }

  function linkCell(value) {
    const s = String(value ?? '').trim();
    if (/^https?:\/\//i.test(s)) return `<a class="blue" href="${esc(s)}" target="_blank" rel="noopener">Abrir</a>`;
    return esc(s || '—');
  }

  function table(title, subtitle, rows, columns) {
    const safe = rows || [];
    if (!safe.length) {
      return `<div class="panel"><div class="panel-header"><div class="panel-title"><strong>${esc(title)}</strong><span>${esc(subtitle || '')}</span></div></div><div class="empty-state"><div><strong>Sin registros para el filtro</strong><span>Prueba otro período o borra los filtros.</span></div></div></div>`;
    }
    const cols = columns.filter(c => safe.some(r => Object.prototype.hasOwnProperty.call(r,c)));
    return `<div class="panel table-panel">
      <div class="panel-header"><div class="panel-title"><strong>${esc(title)}</strong><span>${esc(subtitle || `${safe.length} registros`)}</span></div></div>
      <div class="table-scroll expanded"><table><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${safe.map(row=>`<tr>${cols.map(c=>`<td>${linkCell(row[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    </div>`;
  }

  function kpi(label, value, meta, cls='') {
    return `<div class="kpi-card"><span class="kpi-label">${esc(label)}</span><strong class="kpi-value ${esc(cls)}">${esc(value)}</strong><div class="kpi-meta"><span>${esc(meta || '')}</span></div></div>`;
  }

  function injectStyles() {
    if (document.getElementById('incomeDocEnhancementStyles')) return;
    const style = document.createElement('style');
    style.id = 'incomeDocEnhancementStyles';
    style.textContent = `.income-source-note{font-size:11px;color:var(--muted,#8190a5);margin-top:8px}`;
    document.head.appendChild(style);
  }

  function drawIncomeChart(concepts) {
    if (!window.Chart || activeView() !== 'ingresos') return;
    chart?.destroy();
    const canvas = document.getElementById('incomeCompleteChart');
    if (!canvas || !concepts.length) return;
    const labels = [], salaryCop = [], salaryUsd = [], totals = [], extras = [];
    concepts.forEach(row => {
      const salary = parseNumber(row['Sueldo COP']);
      const usdSalary = parseNumber(row['Sueldo USD (equiv. COP)']);
      const total = parseNumber(row['Total consolidado']);
      labels.push(row['Mes'] || '');
      salaryCop.push(salary);
      salaryUsd.push(usdSalary);
      totals.push(total);
      extras.push(Math.max(0, total - salary - usdSalary));
    });
    chart = new Chart(canvas, {
      type:'line',
      data:{labels,datasets:[
        {label:'Sueldo COP',data:salaryCop,borderWidth:2,tension:.25},
        {label:'Sueldo USD (equiv. COP)',data:salaryUsd,borderWidth:2,tension:.25},
        {label:'Extras / otros',data:extras,borderWidth:2,tension:.25},
        {label:'Total consolidado',data:totals,borderWidth:3,tension:.25}
      ]},
      options:{
        responsive:true,maintainAspectRatio:false,interaction:{mode:'nearest',intersect:false},
        plugins:{legend:{labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${cop(ctx.parsed.y)}`}}},
        scales:{x:{ticks:{color:'#718098',maxRotation:0},grid:{color:'#121c29'}},y:{beginAtZero:true,ticks:{color:'#718098',callback:v=>new Intl.NumberFormat('es-CO',{notation:'compact',maximumFractionDigits:1}).format(v)},grid:{color:'#121c29'}}}
      }
    });
  }

  async function enhanceIncome(root, version) {
    if (!root || root.querySelector('[data-income-complete]') || root.dataset.incomeLoading === '1') return;
    root.dataset.incomeLoading = '1';
    try {
      const payload = await getPayload(false);
      if (version !== renderVersion || activeView() !== 'ingresos' || !root.isConnected) return;

      const period = currentPeriodState();
      const nomina = filterPeriod(rowsFromPayload(payload,'Nomina_Colombia!A:AI'), period);
      const usdRows = filterPeriod(rowsFromPayload(payload,'Ingresos!A:T'), period);
      const details = filterPeriod(rowsFromPayload(payload,'Detalle_Ingresos!A:L'), period);
      const concepts = filterPeriod(rowsFromPayload(payload,'Resumen_Conceptos_Ingresos!A:L'), period);
      const invoices = filterPeriod(rowsFromPayload(payload,'Facturas_USD!A:L'), period);
      const saving = filterPeriod(rowsFromPayload(payload,'Flujo_Ahorro!A:P'), period);

      let payrollNet = 0, usdNet = 0, extras = 0, extraCount = 0, consolidated = 0;
      nomina.forEach(row => { payrollNet += parseNumber(row['Neto pagado']); });
      usdRows.forEach(row => { usdNet += parseNumber(row['Valor neto']); });
      details.forEach(row => {
        const type = norm(row['Tipo']);
        const concept = norm(row['Concepto']);
        if (!type.includes('ingreso laboral')) extraCount += 1;
        if (!type.includes('ingreso laboral') && !concept.includes('sueldo componente')) extras += parseNumber(row['Equivalente COP']);
      });
      concepts.forEach(row => { consolidated += parseNumber(row['Total consolidado']); });

      const head = root.querySelector('.section-head')?.outerHTML || '';
      root.innerHTML = `${head}<div data-income-complete>
        <div class="kpi-grid">
          ${kpi('Nómina Colombia neta',cop(payrollNet),`${nomina.length} período(s) con el filtro`,'green')}
          ${kpi('Ingresos USD recibidos',usd(usdNet),`${usdRows.length} pago(s) registrados`,'blue')}
          ${kpi('Extras / otros ingresos',cop(extras),`${extraCount} concepto(s)`,'gold')}
          ${kpi('Total consolidado',concepts.length?cop(consolidated):'—',concepts.length?'Según Resumen_Conceptos_Ingresos':'Disponible para los períodos consolidados de 2026')}
        </div>
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Composición mensual de ingresos</strong><span>Sueldo COP, componente USD, extras y total consolidado</span></div></div><div class="chart-scroll"><div class="chart-inner" style="min-width:100%;height:330px"><canvas id="incomeCompleteChart"></canvas></div></div></div>
        ${table('Conceptos consolidados','Resumen mensual de todos los componentes',concepts,['Mes','Sueldo COP','Sueldo USD (equiv. COP)','Intereses y auxilios','Devoluciones','Transferencias familiares','Entrevistas / extras USD','Prima COP','Pago a Ro','Prima USD (equiv. COP)','Otros ingresos','Total consolidado'])}
        ${table('Detalle de ingresos y extras','Detalle de ingresos y extras registrados',details,['Mes','Concepto','Tipo','Moneda original','Valor original','Equivalente COP','Estado conciliación','Fuente','Observaciones trasladadas','Diferencia / alerta'])}
        ${table('Nómina Colombia','Histórico de comprobantes y conceptos de nómina',nomina,['Periodo','Cargo','Sueldo','Ingreso no salarial','Prima','Cesantías','Intereses cesantías','Otros devengados','Total ingresos','Total deducciones','Neto pagado','Estado revisión','URL soporte directo','Observaciones'])}
        ${table('Pagos recibidos en USD','Ingresos efectivamente acreditados en ARQ / DolarApp',usdRows,['Fecha devengo','Fecha pago','Origen','Tipo','Valor bruto','Deducciones','Valor neto','Cuenta destino','Documento','Fuente','Observaciones'])}
        ${table('Facturación en USD','Facturas de servicios prestados y estado de pago',invoices,['Año','Mes','Documento','Moneda','Importe facturado','Estado pago','Fecha pago','Fuente','URL directa','Observaciones'])}
        ${table('Plan de ahorro','Conserva la vista de ahorro y metas vinculada a ingresos',saving,Object.keys(saving[0] || {}).slice(0,16))}
        <div class="income-source-note">Fuentes: Nómina Colombia, Ingresos, Detalle_Ingresos, Resumen_Conceptos_Ingresos, Facturas_USD y Flujo_Ahorro de Finanzas Edu.</div>
      </div>`;
      requestAnimationFrame(()=>{if(version===renderVersion)drawIncomeChart(concepts);});
      document.dispatchEvent(new CustomEvent('panel:income-doc-rendered'));
    } catch (error) {
      console.error('No se pudo completar la vista de ingresos:', error);
    } finally {
      delete root.dataset.incomeLoading;
    }
  }

  function run(version) {
    const root = document.getElementById('viewRoot');
    if (!root || version !== renderVersion || activeView() !== 'ingresos') return;
    enhanceIncome(root, version);
  }

  function schedule() {
    renderVersion++;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      run(renderVersion);
    });
  }

  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{
    if(event.detail?.view==='ingresos')schedule();
    else renderVersion++;
  });
  queueMicrotask(schedule);
})();