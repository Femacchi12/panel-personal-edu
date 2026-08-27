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
  let syncing = false;

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function src(range, fields, bookId = FINANCE_ID) { return {range, fields, bookId}; }
  function filter(key, label, sources) { return {key, label, sources}; }

  const VIEW_CONFIG = {
    general: { global:['year','month','category','subcategory'], local:[] },
    gastos: { global:['year','month','category','subcategory'], local:[] },
    flujo: { global:['year','month'], local:[] },
    tarjetas: { global:['year','month','category','subcategory'], local:[
      filter('cardHolder','Titular',[src('Tarjetas!A:T',['Titular']),src('Movimientos!A:Z',['Titular'])])
    ]},
    deudas: { global:[], local:[
      filter('debtHolder','Titular',[src('Cuotas!A:T',['Titular'])]),
      filter('debtCard','Tarjeta',[src('Cuotas!A:T',['Tarjeta'])]),
      filter('debtStatus','Estado',[src('Cuotas!A:T',['Estado'])])
    ]},
    inversiones: { global:['year','month'], local:[
      filter('invPlatform','Plataforma / Bróker',[src('Posiciones!A:X',['Plataforma / Bróker'])]),
      filter('invClass','Clase de activo',[src('Posiciones!A:X',['Clase de activo'])]),
      filter('invCategory','Categoría',[src('Posiciones!A:X',['Categoría'])]),
      filter('invSubcategory','Subcategoría',[src('Posiciones!A:X',['Subcategoría'])])
    ]},
    pension: { global:['year','month'], local:[] },
    ingresos: { global:['year','month'], local:[] },
    servicios: { global:['year','month'], local:[
      filter('serviceName','Servicio',[src('Servicios!A:O',['Servicio'])]),
      filter('serviceType','Tipo de servicio',[src('Servicios!A:O',['Tipo de servicio'])]),
      filter('serviceStatus','Estado',[src('Servicios!A:O',['Estado mes'])])
    ]},
    salud: { global:['year','month'], local:[
      filter('healthPatient','Paciente',[
        src('Citas_Medicas!A:N',['Paciente'],HEALTH_ID),src('Tratamientos!A:X',['Paciente'],HEALTH_ID),
        src('Estudios_Resultados!A:X',['Paciente'],HEALTH_ID),src('Eventos_Salud!A:X',['Paciente'],HEALTH_ID),
        src('Mediciones!A:X',['Paciente'],HEALTH_ID)
      ]),
      filter('healthArea','Área / Especialidad',[
        src('Tratamientos!A:X',['Área'],HEALTH_ID),src('Estudios_Resultados!A:X',['Área'],HEALTH_ID),
        src('Eventos_Salud!A:X',['Especialidad / Área','Área'],HEALTH_ID),src('Mediciones!A:X',['Área'],HEALTH_ID)
      ])
    ]},
    citas: { global:['year','month'], local:[
      filter('appointmentPatient','Paciente',[src('Citas_Medicas!A:N',['Paciente'],HEALTH_ID)]),
      filter('appointmentSpecialty','Especialidad / Servicio',[src('Citas_Medicas!A:N',['Especialidad/Servicio'],HEALTH_ID)]),
      filter('appointmentStatus','Estado',[src('Citas_Medicas!A:N',['Estado'],HEALTH_ID)])
    ]},
    tratamientos: { global:['year','month'], local:[
      filter('treatmentPatient','Paciente',[src('Tratamientos!A:X',['Paciente'],HEALTH_ID)]),
      filter('treatmentArea','Área',[src('Tratamientos!A:X',['Área'],HEALTH_ID)]),
      filter('treatmentStatus','Estado',[src('Tratamientos!A:X',['Estado'],HEALTH_ID)])
    ]},
    documentos: { global:['year','month'], local:[
      filter('documentArea','Área / Tipo',[
        src('Documentos_Financieros!A:L',['Área','Tipo','Categoría']),src('Documentos_Identidad!A:N',['Área','Tipo','Categoría']),
        src('Documentos_Laborales!A:L',['Área','Tipo','Categoría']),src('Documentos_Tributarios!A:L',['Área','Tipo','Categoría']),
        src('Documentos!A:X',['Área','Tipo','Categoría'],HEALTH_ID)
      ])
    ]},
    viajes: { global:['year','month'], local:[
      filter('travelHolder','Titular / Pasajero',[src('Vacaciones_Viajes!A:T',['Titular/Pasajero'])]),
      filter('travelType','Tipo de registro',[src('Vacaciones_Viajes!A:T',['Tipo de registro'])]),
      filter('travelDestination','Destino',[src('Vacaciones_Viajes!A:T',['Destino'])]),
      filter('travelStatus','Estado',[src('Vacaciones_Viajes!A:T',['Estado'])])
    ]}
  };

  function activeView(){ return document.querySelector('.nav-item.active')?.dataset.view || 'general'; }
  function sourceKey(source){ return `${source.bookId || FINANCE_ID}|${source.range}`; }
  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return[];
    const headers=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(row=>row?.some(v=>String(v??'').trim()!==''))
      .map(row=>Object.fromEntries(headers.map((header,index)=>[header||`Col ${index+1}`,row?.[index]??''])));
  }
  function pick(row,fields){
    for(const field of fields){ if(row?.[field]!=null&&String(row[field]).trim()!=='') return String(row[field]).trim(); }
    return '';
  }
  async function getBackendData(force=false){
    if(!force&&backendCache&&Date.now()-backendCacheAt<55_000)return backendCache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false); if(!token)throw new Error('Sesión Firebase no disponible');
    const response=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if(!response.ok)throw new Error(`Backend ${response.status}`);
    backendCache=await response.json(); backendCacheAt=Date.now(); return backendCache;
  }
  async function getOptions(def){
    const payload=await getBackendData(false),values=new Set();
    def.sources.forEach(source=>{
      parseRows(payload?.sources?.[sourceKey(source)]||[]).forEach(row=>{const value=pick(row,source.fields);if(value)values.add(value);});
    });
    return [...values].sort((a,b)=>a.localeCompare(b,'es',{numeric:true,sensitivity:'base'}));
  }
  function getSelection(view,key){ localState[view] ||= {}; localState[view][key] ||= []; return localState[view][key]; }
  function clearLocal(view){ (VIEW_CONFIG[view]?.local||[]).forEach(def=>{getSelection(view,def.key).splice(0);}); }
  function setCurrentFilterState(view){
    const conf=VIEW_CONFIG[view]||VIEW_CONFIG.general;
    window.__PANEL_SECTION_FILTERS__={view,rules:conf.local.map(def=>({
      key:def.key,values:getSelection(view,def.key).slice(),ranges:Object.fromEntries(def.sources.map(source=>[source.range,source.fields]))
    }))};
  }
  function updateGlobalFilterVisibility(view){
    const allowed=new Set((VIEW_CONFIG[view]||VIEW_CONFIG.general).global||[]);
    document.querySelectorAll('#globalFilters .multi-filter').forEach(el=>{el.hidden=!allowed.has(el.dataset.filter);});
    const bar=document.getElementById('filterBar'); if(bar)bar.hidden=allowed.size===0;
  }

  async function renderSectionFilters(view){
    let bar=document.getElementById('sectionFilterBar'); const main=document.querySelector('.main'); if(!main)return;
    if(!bar){bar=document.createElement('section');bar.id='sectionFilterBar';bar.className='filter-bar section-filter-bar';const global=document.getElementById('filterBar');if(global)global.insertAdjacentElement('afterend',bar);else main.prepend(bar);}
    const conf=VIEW_CONFIG[view]||VIEW_CONFIG.general;
    if(!conf.local.length){bar.hidden=true;bar.innerHTML='';return;}
    bar.hidden=false;
    bar.innerHTML=`<div class="filter-head"><div><span class="eyebrow">FILTROS DE LA SECCIÓN</span><strong>${esc(document.getElementById('viewTitle')?.textContent||'')}</strong></div><div class="filter-actions"><button id="clearSectionFilters" class="text-btn">Borrar filtros de sección</button></div></div><div class="section-filter-grid"></div>`;
    const grid=bar.querySelector('.section-filter-grid');
    for(const def of conf.local){
      const options=await getOptions(def).catch(()=>[]); if(activeView()!==view)return;
      const selected=getSelection(view,def.key),root=document.createElement('div');
      root.className=`multi-filter local-multi-filter${selected.length?' has-selection':''}`;root.dataset.localKey=def.key;
      const summary=!selected.length?'Todos':selected.length===1?selected[0]:`${selected.length} seleccionados`;
      root.innerHTML=`<div class="filter-label-row"><span>${esc(def.label)}</span><button type="button" class="filter-clear-one local-clear">Limpiar</button></div><button type="button" class="multi-filter-trigger local-trigger" aria-expanded="false"><span class="local-summary">${esc(summary)}</span><span class="filter-chevron">⌄</span></button><div class="multi-filter-menu local-menu"><input class="multi-filter-search local-search" placeholder="Buscar…" autocomplete="off"><div class="multi-filter-options local-options"></div></div>`;
      const box=root.querySelector('.local-options');
      box.innerHTML=options.length?options.map(value=>{const on=selected.includes(value);return `<button type="button" class="multi-filter-option local-option${on?' selected':''}" data-value="${esc(value)}"><span class="multi-filter-check">${on?'✓':''}</span><span>${esc(value)}</span></button>`;}).join(''):'<div class="multi-filter-empty">Sin opciones</div>';
      grid.appendChild(root);
      root.querySelector('.local-trigger')?.addEventListener('click',event=>{event.stopPropagation();document.querySelectorAll('.local-multi-filter.open').forEach(x=>{if(x!==root)x.classList.remove('open')});root.classList.toggle('open');root.querySelector('.local-trigger')?.setAttribute('aria-expanded',root.classList.contains('open')?'true':'false');if(root.classList.contains('open'))setTimeout(()=>root.querySelector('.local-search')?.focus(),0);});
      root.querySelector('.local-search')?.addEventListener('input',event=>{const q=norm(event.target.value);root.querySelectorAll('.local-option').forEach(btn=>btn.hidden=!!q&&!norm(btn.dataset.value).includes(q));});
      root.querySelector('.local-clear')?.addEventListener('click',event=>{event.stopPropagation();getSelection(view,def.key).splice(0);applyLocalChange(view);});
      root.querySelectorAll('.local-option').forEach(btn=>btn.addEventListener('click',event=>{event.stopPropagation();const list=getSelection(view,def.key),value=btn.dataset.value,index=list.indexOf(value);if(index>=0)list.splice(index,1);else list.push(value);applyLocalChange(view);}));
    }
    bar.querySelector('#clearSectionFilters')?.addEventListener('click',()=>{clearLocal(view);applyLocalChange(view);});
  }

  async function applyLocalChange(view){
    setCurrentFilterState(view);
    await renderSectionFilters(view);
    document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));
    // Inversiones se recalcula con datos ya cargados. No se pulsa Actualizar ni se
    // reconstruyen todas las fuentes del dashboard por un filtro local.
    if(view!=='inversiones'){
      const button=document.getElementById('refreshBtn');
      if(button&&!button.disabled)button.click();
    }
  }

  async function syncView(){
    if(syncing)return;syncing=true;
    try{
      const view=activeView();updateGlobalFilterVisibility(view);setCurrentFilterState(view);await renderSectionFilters(view);lastView=view;
    }finally{syncing=false;}
  }

  document.addEventListener('click',event=>{
    if(!event.target.closest('.local-multi-filter'))document.querySelectorAll('.local-multi-filter.open').forEach(x=>x.classList.remove('open'));
    if(event.target.closest('.nav-item'))setTimeout(()=>syncView().catch(console.error),30);
    if(event.target.closest('#clearFilters,#resetCurrentMonth')){
      const view=activeView();clearLocal(view);setTimeout(()=>{setCurrentFilterState(view);renderSectionFilters(view);document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));},80);
    }
    if(event.target.closest('#refreshBtn')){backendCache=null;backendCacheAt=0;}
  },true);

  const start=()=>syncView().catch(console.error);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();