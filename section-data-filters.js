(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  if (!apiBaseUrl) return;

  const FINANCE_ID = cfg.financeSpreadsheetId;
  const HEALTH_ID = cfg.healthSpreadsheetId;
  const localState = {};
  let backendCache = null;
  let backendCacheAt = 0;
  let lastView = null;
  let investmentCharts = [];
  let syncTimer = null;

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const VIEW_CONFIG = {
    general: { global:['year','month','category','subcategory'], local:[] },
    gastos: { global:['year','month','category','subcategory'], local:[] },
    flujo: { global:['year','month'], local:[] },
    tarjetas: {
      global:['year','month','category','subcategory'],
      local:[
        filter('cardHolder','Titular',[src('Tarjetas!A:T',['Titular']),src('Movimientos!A:Y',['Titular'])])
      ]
    },
    deudas: {
      global:[],
      local:[
        filter('debtHolder','Titular',[src('Cuotas!A:T',['Titular'])]),
        filter('debtCard','Tarjeta',[src('Cuotas!A:T',['Tarjeta'])]),
        filter('debtStatus','Estado',[src('Cuotas!A:T',['Estado'])])
      ]
    },
    inversiones: {
      global:[],
      local:[
        filter('invPlatform','Plataforma / Bróker',[src('Posiciones!A:X',['Plataforma / Bróker'])]),
        filter('invClass','Clase de activo',[src('Posiciones!A:X',['Clase de activo'])]),
        filter('invCategory','Categoría',[src('Posiciones!A:X',['Categoría'])]),
        filter('invSubcategory','Subcategoría',[src('Posiciones!A:X',['Subcategoría'])])
      ]
    },
    pension: { global:['year','month'], local:[] },
    ingresos: { global:['year','month'], local:[] },
    servicios: {
      global:['year','month'],
      local:[
        filter('serviceName','Servicio',[src('Servicios!A:O',['Servicio'])]),
        filter('serviceType','Tipo de servicio',[src('Servicios!A:O',['Tipo de servicio'])]),
        filter('serviceStatus','Estado',[src('Servicios!A:O',['Estado mes'])])
      ]
    },
    salud: {
      global:['year','month'],
      local:[
        filter('healthPatient','Paciente',[
          src('Citas_Medicas!A:N',['Paciente'],HEALTH_ID),src('Tratamientos!A:X',['Paciente'],HEALTH_ID),
          src('Estudios_Resultados!A:X',['Paciente'],HEALTH_ID),src('Eventos_Salud!A:X',['Paciente'],HEALTH_ID),
          src('Mediciones!A:X',['Paciente'],HEALTH_ID)
        ]),
        filter('healthArea','Área / Especialidad',[
          src('Tratamientos!A:X',['Área'],HEALTH_ID),src('Estudios_Resultados!A:X',['Área'],HEALTH_ID),
          src('Eventos_Salud!A:X',['Especialidad / Área','Área'],HEALTH_ID),src('Mediciones!A:X',['Área'],HEALTH_ID)
        ])
      ]
    },
    citas: {
      global:['year','month'],
      local:[
        filter('appointmentPatient','Paciente',[src('Citas_Medicas!A:N',['Paciente'],HEALTH_ID)]),
        filter('appointmentSpecialty','Especialidad / Servicio',[src('Citas_Medicas!A:N',['Especialidad/Servicio'],HEALTH_ID)]),
        filter('appointmentStatus','Estado',[src('Citas_Medicas!A:N',['Estado'],HEALTH_ID)])
      ]
    },
    tratamientos: {
      global:['year','month'],
      local:[
        filter('treatmentPatient','Paciente',[src('Tratamientos!A:X',['Paciente'],HEALTH_ID)]),
        filter('treatmentArea','Área',[src('Tratamientos!A:X',['Área'],HEALTH_ID)]),
        filter('treatmentStatus','Estado',[src('Tratamientos!A:X',['Estado'],HEALTH_ID)])
      ]
    },
    documentos: {
      global:['year','month'],
      local:[
        filter('documentArea','Área / Tipo',[
          src('Documentos_Financieros!A:L',['Área','Tipo','Categoría']),src('Documentos_Identidad!A:N',['Área','Tipo','Categoría']),
          src('Documentos_Laborales!A:L',['Área','Tipo','Categoría']),src('Documentos_Tributarios!A:L',['Área','Tipo','Categoría']),
          src('Documentos!A:X',['Área','Tipo','Categoría'],HEALTH_ID)
        ])
      ]
    },
    viajes: {
      global:['year','month'],
      local:[
        filter('travelHolder','Titular / Pasajero',[src('Vacaciones_Viajes!A:T',['Titular/Pasajero'])]),
        filter('travelType','Tipo de registro',[src('Vacaciones_Viajes!A:T',['Tipo de registro'])]),
        filter('travelDestination','Destino',[src('Vacaciones_Viajes!A:T',['Destino'])]),
        filter('travelStatus','Estado',[src('Vacaciones_Viajes!A:T',['Estado'])])
      ]
    }
  };

  function src(range, fields, bookId = FINANCE_ID) { return {range, fields, bookId}; }
  function filter(key, label, sources) { return {key, label, sources}; }

  function activeView() {
    return document.querySelector('.nav-item.active')?.dataset.view || 'general';
  }

  function sourceKey(source) {
    return `${source.bookId || FINANCE_ID}|${source.range}`;
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1).filter(row => row?.some(v => String(v ?? '').trim() !== '')).map(row =>
      Object.fromEntries(headers.map((header,index) => [header || `Col ${index+1}`, row?.[index] ?? '']))
    );
  }

  function pick(row, fields) {
    for (const field of fields) {
      if (row?.[field] != null && String(row[field]).trim() !== '') return String(row[field]).trim();
    }
    return '';
  }

  async function getBackendData() {
    if (backendCache && Date.now() - backendCacheAt < 55_000) return backendCache;
    const getIdToken = window.__PANEL_GET_ID_TOKEN__;
    if (typeof getIdToken !== 'function') throw new Error('Sesión Firebase no disponible');
    const token = await getIdToken(false);
    if (!token) throw new Error('No se pudo obtener la sesión');
    const response = await fetch(`${apiBaseUrl}/api/data`, {
      headers:{Authorization:`Bearer ${token}`}, cache:'no-store'
    });
    if (!response.ok) throw new Error(`Backend ${response.status}`);
    backendCache = await response.json();
    backendCacheAt = Date.now();
    return backendCache;
  }

  async function getOptions(def) {
    const payload = await getBackendData();
    const values = new Set();
    def.sources.forEach(source => {
      const matrix = payload?.sources?.[sourceKey(source)];
      parseRows(matrix).forEach(row => {
        const value = pick(row, source.fields);
        if (value) values.add(value);
      });
    });
    return [...values].sort((a,b)=>a.localeCompare(b,'es',{numeric:true,sensitivity:'base'}));
  }

  function getSelection(view,key) {
    localState[view] ||= {};
    localState[view][key] ||= [];
    return localState[view][key];
  }

  function setCurrentFilterState(view) {
    const conf = VIEW_CONFIG[view] || VIEW_CONFIG.general;
    window.__PANEL_SECTION_FILTERS__ = {
      view,
      rules: conf.local.map(def => ({
        key:def.key,
        values:getSelection(view,def.key).slice(),
        ranges:Object.fromEntries(def.sources.map(source => [source.range, source.fields]))
      }))
    };
  }

  function updateGlobalFilterVisibility(view) {
    const allowed = new Set((VIEW_CONFIG[view] || VIEW_CONFIG.general).global || []);
    document.querySelectorAll('#globalFilters .multi-filter').forEach(el => {
      el.hidden = !allowed.has(el.dataset.filter);
    });
    const globalBar = document.getElementById('filterBar');
    if (globalBar) globalBar.hidden = allowed.size === 0;
  }

  async function renderSectionFilters(view) {
    let bar = document.getElementById('sectionFilterBar');
    const main = document.querySelector('.main');
    if (!main) return;
    if (!bar) {
      bar = document.createElement('section');
      bar.id = 'sectionFilterBar';
      bar.className = 'filter-bar section-filter-bar';
      const globalBar = document.getElementById('filterBar');
      if (globalBar) globalBar.insertAdjacentElement('afterend',bar);
      else main.prepend(bar);
    }

    const conf = VIEW_CONFIG[view] || VIEW_CONFIG.general;
    if (!conf.local.length) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }

    bar.hidden = false;
    bar.innerHTML = `<div class="filter-head"><div><span class="eyebrow">FILTROS DE LA SECCIÓN</span><strong>${esc(document.getElementById('viewTitle')?.textContent || '')}</strong></div><div class="filter-actions"><button id="clearSectionFilters" class="text-btn">Borrar filtros de sección</button></div></div><div class="section-filter-grid"></div>`;
    const grid = bar.querySelector('.section-filter-grid');

    for (const def of conf.local) {
      const options = await getOptions(def).catch(()=>[]);
      if (activeView() !== view) return;
      const selected = getSelection(view,def.key);
      const root = document.createElement('div');
      root.className = `multi-filter local-multi-filter${selected.length?' has-selection':''}`;
      root.dataset.localKey = def.key;
      const summary = !selected.length ? 'Todos' : selected.length === 1 ? selected[0] : `${selected.length} seleccionados`;
      root.innerHTML = `<div class="filter-label-row"><span>${esc(def.label)}</span><button type="button" class="filter-clear-one local-clear">Limpiar</button></div>
        <button type="button" class="multi-filter-trigger local-trigger" aria-expanded="false"><span class="local-summary">${esc(summary)}</span><span class="filter-chevron">⌄</span></button>
        <div class="multi-filter-menu local-menu"><input class="multi-filter-search local-search" placeholder="Buscar…" autocomplete="off"><div class="multi-filter-options local-options"></div></div>`;
      const optionBox = root.querySelector('.local-options');
      optionBox.innerHTML = options.length ? options.map(value => {
        const on = selected.includes(value);
        return `<button type="button" class="multi-filter-option local-option${on?' selected':''}" data-value="${esc(value)}"><span class="multi-filter-check">${on?'✓':''}</span><span>${esc(value)}</span></button>`;
      }).join('') : '<div class="multi-filter-empty">Sin opciones</div>';
      grid.appendChild(root);

      root.querySelector('.local-trigger')?.addEventListener('click',event=>{
        event.stopPropagation();
        document.querySelectorAll('.local-multi-filter.open').forEach(x=>{if(x!==root)x.classList.remove('open')});
        root.classList.toggle('open');
        root.querySelector('.local-trigger')?.setAttribute('aria-expanded',root.classList.contains('open')?'true':'false');
        if(root.classList.contains('open')) setTimeout(()=>root.querySelector('.local-search')?.focus(),0);
      });
      root.querySelector('.local-search')?.addEventListener('input',event=>{
        const q = norm(event.target.value);
        root.querySelectorAll('.local-option').forEach(btn=>btn.hidden=!!q&&!norm(btn.dataset.value).includes(q));
      });
      root.querySelector('.local-clear')?.addEventListener('click',event=>{
        event.stopPropagation();
        localState[view][def.key]=[];
        applySectionFiltersAndRefresh(view);
      });
      root.querySelectorAll('.local-option').forEach(btn=>btn.addEventListener('click',event=>{
        event.stopPropagation();
        const value=btn.dataset.value;
        const list=getSelection(view,def.key);
        const index=list.indexOf(value);
        if(index>=0)list.splice(index,1); else list.push(value);
        applySectionFiltersAndRefresh(view);
      }));
    }

    bar.querySelector('#clearSectionFilters')?.addEventListener('click',()=>{
      conf.local.forEach(def=>localState[view][def.key]=[]);
      applySectionFiltersAndRefresh(view);
    });
  }

  function refreshCoreData() {
    const button = document.getElementById('refreshBtn');
    if (button && !button.disabled) button.click();
  }

  function applySectionFiltersAndRefresh(view) {
    setCurrentFilterState(view);
    renderSectionFilters(view);
    refreshCoreData();
    setTimeout(()=>enhanceCurrentView(view),180);
  }

  function parseDate(value) {
    const s=String(value||'').trim();
    if(!s)return null;
    let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(m)return new Date(+m[1],+m[2]-1,+m[3]);
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    const d=new Date(s); return Number.isNaN(d.getTime())?null:d;
  }

  function dateLabel(value) {
    const d=parseDate(value); if(!d)return String(value||'—');
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }

  function parseNumber(value) {
    if(typeof value==='number')return value;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');
    if(!s)return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0){if(comma>dot)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
    else if(comma>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(dot>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function currentCurrency() {
    return document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';
  }

  function money(value,currency=currentCurrency()) {
    const digits=currency==='USD'?2:0;
    return new Intl.NumberFormat('es-CO',{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value)||0);
  }

  function investmentValue(row,currency) {
    return parseNumber(row[`Valor ${currency}`]);
  }

  function filteredInvestmentRows(rows) {
    const conf=VIEW_CONFIG.inversiones;
    return rows.filter(row=>conf.local.every(def=>{
      const selected=getSelection('inversiones',def.key);
      if(!selected.length)return true;
      const source=def.sources[0];
      const value=pick(row,source.fields);
      return selected.includes(value);
    }));
  }

  function latestPerPlatform(rows) {
    const groups=new Map();
    rows.forEach(row=>{
      const platform=pick(row,['Plataforma / Bróker'])||'Sin plataforma';
      if(!groups.has(platform))groups.set(platform,[]);
      groups.get(platform).push(row);
    });
    const out=[];
    groups.forEach(group=>{
      const dates=group.map(r=>parseDate(r.Fecha)).filter(Boolean);
      if(!dates.length){out.push(...group);return;}
      const max=Math.max(...dates.map(d=>d.getTime()));
      out.push(...group.filter(r=>parseDate(r.Fecha)?.getTime()===max));
    });
    return out;
  }

  async function renderInvestmentCorrection() {
    if(activeView()!=='inversiones')return;
    const root=document.getElementById('viewRoot');
    if(!root)return;
    const payload=await getBackendData().catch(()=>null);
    if(!payload||activeView()!=='inversiones')return;
    const raw=parseRows(payload.sources?.[`${FINANCE_ID}|Posiciones!A:X`]);
    const rows=latestPerPlatform(filteredInvestmentRows(raw));
    const currency=currentCurrency();
    const value=sum(rows,r=>investmentValue(r,currency));
    const byPlatform=aggregate(rows,r=>pick(r,['Plataforma / Bróker'])||'Sin plataforma',r=>investmentValue(r,currency));
    const byCategory=aggregate(rows,r=>pick(r,['Categoría'])||'Sin categoría',r=>investmentValue(r,currency));

    root.querySelectorAll(':scope > .kpi-grid, :scope > .panel-grid.equal').forEach(el=>el.classList.add('investment-base-hidden'));
    root.querySelectorAll(':scope > .panel').forEach(panel=>{
      const title=panel.querySelector('.panel-title strong')?.textContent?.trim();
      if(title==='Posiciones')panel.classList.add('investment-base-hidden');
    });

    root.querySelector('#investmentCorrected')?.remove();
    destroyInvestmentCharts();
    const sectionHead=root.querySelector('.section-head');
    const host=document.createElement('div');
    host.id='investmentCorrected';
    host.className='investment-corrected';

    const platformCards=[...byPlatform.entries()].map(([platform,total])=>{
      const sample=rows.find(r=>pick(r,['Plataforma / Bróker'])===platform)||{};
      const count=rows.filter(r=>pick(r,['Plataforma / Bróker'])===platform).length;
      return `<div class="kpi-card"><span class="kpi-label">${esc(platform)}</span><strong class="kpi-value">${esc(money(total,currency))}</strong><div class="kpi-meta"><span>${count} posiciones · corte ${esc(dateLabel(sample.Fecha))}</span></div></div>`;
    }).join('');

    const tableRows=rows.slice().sort((a,b)=>String(pick(a,['Plataforma / Bróker'])).localeCompare(String(pick(b,['Plataforma / Bróker'])))||String(a.Símbolo||'').localeCompare(String(b.Símbolo||'')));
    host.innerHTML=`<div class="kpi-grid investment-kpis">
      <div class="kpi-card"><span class="kpi-label">Portafolio consolidado</span><strong class="kpi-value green">${esc(money(value,currency))}</strong><div class="kpi-meta"><span>Último corte disponible de cada plataforma</span></div></div>
      ${platformCards}
      <div class="kpi-card"><span class="kpi-label">Posiciones</span><strong class="kpi-value">${rows.length}</strong><div class="kpi-meta"><span>ARQ + Cocos según filtros</span></div></div>
    </div>
    <div class="panel-grid equal">
      <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Por plataforma</strong><span>Último corte disponible de ARQ y Cocos</span></div></div><div class="chart-wrap tall"><canvas id="investmentFixedPlatformChart"></canvas></div></div>
      <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Por categoría</strong><span>Composición consolidada</span></div></div><div class="chart-wrap tall"><canvas id="investmentFixedCategoryChart"></canvas></div></div>
    </div>
    <div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>Posiciones consolidadas</strong><span>${rows.length} posiciones · cada plataforma en su último corte disponible</span></div></div>
      <div class="table-scroll"><table><thead><tr><th>Fecha</th><th>Plataforma / Bróker</th><th>Símbolo</th><th>Instrumento</th><th>Clase de activo</th><th>Categoría</th><th>Subcategoría</th><th>Cantidad</th><th>Valor USD</th><th>Valor COP</th><th>Valor ARS</th></tr></thead>
      <tbody>${tableRows.map(r=>`<tr><td>${esc(r.Fecha)}</td><td>${esc(r['Plataforma / Bróker'])}</td><td>${esc(r.Símbolo)}</td><td>${esc(r.Instrumento)}</td><td>${esc(r['Clase de activo'])}</td><td>${esc(r.Categoría)}</td><td>${esc(r.Subcategoría)}</td><td>${esc(r.Cantidad)}</td><td>${esc(r['Valor USD'])}</td><td>${esc(r['Valor COP'])}</td><td>${esc(r['Valor ARS'])}</td></tr>`).join('')}</tbody></table></div>
    </div>`;
    if(sectionHead)sectionHead.insertAdjacentElement('afterend',host); else root.prepend(host);

    if(window.Chart){
      investmentCharts.push(new Chart(document.getElementById('investmentFixedPlatformChart'),{type:'bar',data:{labels:[...byPlatform.keys()],datasets:[{label:`Valor ${currency}`,data:[...byPlatform.values()]}]},options:basicChartOptions()}));
      const cats=[...byCategory.entries()].sort((a,b)=>b[1]-a[1]).slice(0,14);
      investmentCharts.push(new Chart(document.getElementById('investmentFixedCategoryChart'),{type:'bar',data:{labels:cats.map(x=>x[0]),datasets:[{label:`Valor ${currency}`,data:cats.map(x=>x[1])}]},options:basicChartOptions(true)}));
    }
  }

  function basicChartOptions(horizontal=false){
    return {responsive:true,maintainAspectRatio:false,indexAxis:horizontal?'y':'x',plugins:{legend:{labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}}},scales:{x:{ticks:{color:'#718098'},grid:{color:'#121c29'}},y:{beginAtZero:true,ticks:{color:'#718098'},grid:{color:'#121c29'}}}};
  }

  function destroyInvestmentCharts(){investmentCharts.forEach(chart=>{try{chart.destroy()}catch(_){}});investmentCharts=[];}
  function sum(rows,fn){return rows.reduce((total,row)=>total+(Number(fn(row))||0),0);}
  function aggregate(rows,keyFn,valueFn){const map=new Map();rows.forEach(row=>{const key=keyFn(row);map.set(key,(map.get(key)||0)+(Number(valueFn(row))||0));});return map;}

  async function renderRentalInfo() {
    if(activeView()!=='servicios')return;
    const root=document.getElementById('viewRoot');
    if(!root||root.querySelector('#rentalPaymentInfo'))return;
    const payload=await getBackendData().catch(()=>null);
    if(!payload||activeView()!=='servicios')return;
    const rows=parseRows(payload.sources?.[`${FINANCE_ID}|Servicios!A:O`]);
    const rent=rows.find(row=>norm(row.Servicio)==='arriendo');
    if(!rent)return;
    const card=document.createElement('div');
    card.id='rentalPaymentInfo';
    card.className='panel rental-info-panel';
    card.innerHTML=`<div class="panel-header"><div class="panel-title"><strong>Datos de pago del arriendo</strong><span>Referencia bancaria para la transferencia mensual</span></div></div>
      <div class="rental-info-grid">
        <div><span>Arrendador</span><strong>${esc(rent['Número de referencia']||'—')}</strong></div>
        <div><span>Banco</span><strong>${esc(rent.Banco||'—')}</strong></div>
        <div><span>Tipo de cuenta</span><strong>${esc(rent['Tipo de cuenta']||'—')}</strong></div>
        <div><span>Número de cuenta</span><strong>${esc(rent['Número de cuenta']||'—')}</strong></div>
        <div><span>Dirección</span><strong>${esc(rent['Dirección / ubicación']||'—')}</strong></div>
        <div><span>Próximo vencimiento</span><strong>${esc(rent['Próximo vencimiento']||'—')}</strong></div>
      </div>`;
    const kpis=root.querySelector('.kpi-grid');
    if(kpis)kpis.insertAdjacentElement('afterend',card); else root.prepend(card);
  }

  async function enhanceCurrentView(view=activeView()) {
    if(view==='inversiones') await renderInvestmentCorrection();
    if(view==='servicios') await renderRentalInfo();
  }

  async function syncView(forceRefresh=false) {
    const view=activeView();
    updateGlobalFilterVisibility(view);
    setCurrentFilterState(view);
    await renderSectionFilters(view);
    await enhanceCurrentView(view);
    if(forceRefresh || (lastView && lastView!==view)) refreshCoreData();
    lastView=view;
  }

  document.addEventListener('click',event=>{
    if(!event.target.closest('.local-multi-filter'))document.querySelectorAll('.local-multi-filter.open').forEach(x=>x.classList.remove('open'));
    if(event.target.closest('.nav-item'))setTimeout(()=>syncView(false),0);
    if(event.target.closest('.currency-btn'))setTimeout(()=>enhanceCurrentView(),80);
  });

  const root=document.getElementById('viewRoot');
  if(root){
    new MutationObserver(()=>{
      clearTimeout(syncTimer);
      syncTimer=setTimeout(()=>enhanceCurrentView(),90);
    }).observe(root,{childList:true,subtree:false});
  }

  const start=()=>syncView(false).catch(console.error);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
