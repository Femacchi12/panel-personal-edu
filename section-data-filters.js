(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  if (!apiBaseUrl) return;

  const FINANCE_ID = cfg.financeSpreadsheetId;
  const DOCUMENTS_ID = cfg.documentsSpreadsheetId;
  const HEALTH_ID = cfg.healthSpreadsheetId;
  const localState = {};
  const parsedRowsCache = new WeakMap();
  let lastView = null;
  let syncVersion = 0;

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function src(range, fields, bookId = FINANCE_ID) { return {range, fields, bookId}; }
  function filter(key, label, sources = [], config = {}) { return {key, label, sources, ...config}; }

  const INVESTMENT_VALUE_OPTIONS = [
    {value:'capital', label:'Solo capital'},
    {value:'result', label:'Ganancia / pérdida'},
    {value:'total', label:'Capital + ganancia/pérdida'}
  ];

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
      filter('invSubcategory','Subcategoría',[src('Posiciones!A:X',['Subcategoría'])]),
      filter('investmentValueMode','Valor a mostrar',[],{
        options: INVESTMENT_VALUE_OPTIONS,
        single: true,
        defaultValues: ['total']
      })
    ]},
    pension: { global:['year','month'], local:[] },
    ingresos: { global:['year','month'], local:[] },
    servicios: { global:['year','month'], local:[
      filter('serviceName','Servicio',[src('Servicios!A:O',['Servicio'])]),
      filter('serviceType','Tipo de servicio',[src('Servicios!A:O',['Tipo de servicio'])]),
      filter('serviceStatus','Estado',[src('Servicios!A:O',['Estado mes'])])
    ]},
    cambio: { global:[], local:[] },
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
    documentos: { global:[], local:[
      filter('documentArea','Área',[src('Documentos_Master!A:R',['Área'],DOCUMENTS_ID)]),
      filter('documentCategory','Categoría',[src('Documentos_Master!A:R',['Categoría'],DOCUMENTS_ID)]),
      filter('documentType','Tipo',[src('Documentos_Master!A:R',['Tipo'],DOCUMENTS_ID)]),
      filter('documentHolder','Titular',[src('Documentos_Master!A:R',['Titular'],DOCUMENTS_ID)]),
      filter('documentStatus','Estado',[src('Documentos_Master!A:R',['Estado'],DOCUMENTS_ID)]),
      filter('documentEntity','País / Entidad',[src('Documentos_Master!A:R',['País / Entidad'],DOCUMENTS_ID)])
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
  function localDef(view,key){ return (VIEW_CONFIG[view]?.local||[]).find(def=>def.key===key); }

  async function getBackendData(force=false){
    const getData=window.__PANEL_GET_BACKEND_DATA__;
    if(typeof getData!=='function')throw new Error('Backend central de datos no disponible');
    return getData(force);
  }

  function parsedRowsFor(payload,key){
    if(!payload||typeof payload!=='object')return parseRows(payload?.sources?.[key]||[]);
    let cache=parsedRowsCache.get(payload);
    if(!cache){cache=new Map();parsedRowsCache.set(payload,cache);}
    if(!cache.has(key))cache.set(key,parseRows(payload?.sources?.[key]||[]));
    return cache.get(key);
  }

  async function getOptions(def,payload=null){
    if(Array.isArray(def.options)){
      return def.options.map(option=>typeof option==='string'?{value:option,label:option}:{value:String(option.value??''),label:String(option.label??option.value??'')});
    }
    const data=payload||await getBackendData(false),values=new Set();
    def.sources.forEach(source=>{
      parsedRowsFor(data,sourceKey(source)).forEach(row=>{const value=pick(row,source.fields);if(value)values.add(value);});
    });
    return [...values].sort((a,b)=>a.localeCompare(b,'es',{numeric:true,sensitivity:'base'})).map(value=>({value,label:value}));
  }

  function getSelection(view,key){
    localState[view] ||= {};
    if(!Object.prototype.hasOwnProperty.call(localState[view],key)){
      localState[view][key]=(localDef(view,key)?.defaultValues||[]).slice();
    }
    return localState[view][key];
  }

  function resetSelection(view,def){
    const list=getSelection(view,def.key);
    list.splice(0,list.length,...(def.defaultValues||[]));
  }

  function clearLocal(view){ (VIEW_CONFIG[view]?.local||[]).forEach(def=>resetSelection(view,def)); }

  function setCurrentFilterState(view){
    const conf=VIEW_CONFIG[view]||VIEW_CONFIG.general;
    window.__PANEL_SECTION_FILTERS__={view,rules:conf.local.map(def=>({
      key:def.key,values:getSelection(view,def.key).slice(),ranges:Object.fromEntries((def.sources||[]).map(source=>[source.range,source.fields]))
    }))};
  }

  function updateGlobalFilterVisibility(view){
    const allowed=new Set((VIEW_CONFIG[view]||VIEW_CONFIG.general).global||[]);
    document.querySelectorAll('#globalFilters .multi-filter').forEach(el=>{el.hidden=!allowed.has(el.dataset.filter);});
    const bar=document.getElementById('filterBar'); if(bar)bar.hidden=allowed.size===0;
  }

  function createLocalControl(view,def,options){
    const selected=getSelection(view,def.key),root=document.createElement('div');
    root.className=`multi-filter local-multi-filter${selected.length?' has-selection':''}`;
    root.dataset.localKey=def.key;
    if(def.single)root.dataset.single='true';
    const selectedLabel=value=>options.find(option=>option.value===value)?.label||value;
    const summary=!selected.length?'Todos':selected.length===1?selectedLabel(selected[0]):`${selected.length} seleccionados`;
    root.innerHTML=`<div class="filter-label-row"><span>${esc(def.label)}</span><button type="button" class="filter-clear-one local-clear">Limpiar</button></div><button type="button" class="multi-filter-trigger local-trigger" aria-expanded="false"><span class="local-summary">${esc(summary)}</span><span class="filter-chevron">⌄</span></button><div class="multi-filter-menu local-menu"><input class="multi-filter-search local-search" placeholder="Buscar…" autocomplete="off"><div class="multi-filter-options local-options"></div></div>`;
    const box=root.querySelector('.local-options');
    box.innerHTML=options.length?options.map(option=>{
      const on=selected.includes(option.value);
      return `<button type="button" class="multi-filter-option local-option${on?' selected':''}" data-value="${esc(option.value)}" data-label="${esc(option.label)}" aria-pressed="${on?'true':'false'}"><span class="multi-filter-check">${on?'✓':''}</span><span>${esc(option.label)}</span></button>`;
    }).join(''):'<div class="multi-filter-empty">Sin opciones</div>';

    root.querySelector('.local-trigger')?.addEventListener('click',event=>{
      event.stopPropagation();
      document.querySelectorAll('.local-multi-filter.open').forEach(x=>{if(x!==root)x.classList.remove('open')});
      root.classList.toggle('open');
      root.querySelector('.local-trigger')?.setAttribute('aria-expanded',root.classList.contains('open')?'true':'false');
      if(root.classList.contains('open'))requestAnimationFrame(()=>root.querySelector('.local-search')?.focus());
    });
    root.querySelector('.local-search')?.addEventListener('input',event=>{
      const q=norm(event.target.value);
      root.querySelectorAll('.local-option').forEach(btn=>btn.hidden=!!q&&!norm(btn.dataset.label||btn.dataset.value).includes(q));
    });
    root.querySelector('.local-clear')?.addEventListener('click',event=>{
      event.stopPropagation();
      resetSelection(view,def);
      applyLocalChange(view);
    });
    root.querySelectorAll('.local-option').forEach(btn=>btn.addEventListener('click',event=>{
      event.stopPropagation();
      const list=getSelection(view,def.key),value=String(btn.dataset.value||'');
      if(def.single){
        list.splice(0,list.length,value);
      }else{
        const index=list.indexOf(value);
        if(index>=0)list.splice(index,1);else list.push(value);
      }
      applyLocalChange(view);
    }));
    return root;
  }

  async function renderSectionFilters(view){
    let bar=document.getElementById('sectionFilterBar');
    const main=document.querySelector('.main');
    if(!main)return;
    if(!bar){
      bar=document.createElement('section');
      bar.id='sectionFilterBar';
      bar.className='filter-bar section-filter-bar';
      const global=document.getElementById('filterBar');
      if(global)global.insertAdjacentElement('afterend',bar);else main.prepend(bar);
    }
    const conf=VIEW_CONFIG[view]||VIEW_CONFIG.general;
    if(!conf.local.length){bar.hidden=true;bar.innerHTML='';return;}

    bar.hidden=true;
    const needsBackend=conf.local.some(def=>!Array.isArray(def.options)&&(def.sources||[]).length);
    const payload=needsBackend?await getBackendData(false):null;
    const optionSets=await Promise.all(conf.local.map(def=>getOptions(def,payload).catch(()=>[])));
    if(activeView()!==view)return;

    bar.innerHTML=`<div class="filter-head"><div><span class="eyebrow">FILTROS DE LA SECCIÓN</span><strong>${esc(document.getElementById('viewTitle')?.textContent||'')}</strong></div><div class="filter-actions"><button id="clearSectionFilters" class="text-btn">Borrar filtros de sección</button></div></div><div class="section-filter-grid"></div>`;
    const grid=bar.querySelector('.section-filter-grid');
    const fragment=document.createDocumentFragment();
    conf.local.forEach((def,index)=>fragment.appendChild(createLocalControl(view,def,optionSets[index]||[])));
    grid.appendChild(fragment);
    bar.querySelector('#clearSectionFilters')?.addEventListener('click',()=>{clearLocal(view);applyLocalChange(view);});
    document.getElementById('investmentV2ModeFilter')?.remove();
    bar.hidden=false;
  }

  function updateLocalControls(view){
    const conf=VIEW_CONFIG[view]||VIEW_CONFIG.general;
    conf.local.forEach(def=>{
      const root=document.querySelector(`#sectionFilterBar .local-multi-filter[data-local-key="${def.key}"]`);if(!root)return;
      const selected=getSelection(view,def.key);
      root.classList.toggle('has-selection',selected.length>0);
      const summary=root.querySelector('.local-summary');
      if(summary){
        const labels=[...root.querySelectorAll('.local-option')].filter(btn=>selected.includes(String(btn.dataset.value||''))).map(btn=>String(btn.dataset.label||btn.dataset.value||''));
        summary.textContent=!selected.length?'Todos':selected.length===1?(labels[0]||selected[0]):`${selected.length} seleccionados`;
      }
      root.querySelectorAll('.local-option').forEach(btn=>{
        const on=selected.includes(String(btn.dataset.value||''));
        btn.classList.toggle('selected',on);btn.setAttribute('aria-pressed',on?'true':'false');
        const check=btn.querySelector('.multi-filter-check');if(check)check.textContent=on?'✓':'';
      });
    });
  }

  async function applyLocalChange(view){
    setCurrentFilterState(view);
    updateLocalControls(view);
    document.querySelectorAll('#sectionFilterBar .local-multi-filter.open').forEach(root=>{
      root.classList.remove('open');
      root.querySelector('.local-trigger')?.setAttribute('aria-expanded','false');
    });
    if(view==='inversiones'||view==='documentos'){
      if(view==='inversiones')document.getElementById('investmentV2ModeFilter')?.remove();
      document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));
      return;
    }
    document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));
    const reload=window.__PANEL_RELOAD_DATA__;
    if(typeof reload==='function')await reload(false);
    else{
      const button=document.getElementById('refreshBtn');
      if(button&&!button.disabled)button.click();
    }
  }

  async function syncView(requestedView=activeView()){
    const view=requestedView||activeView();
    const version=++syncVersion;
    updateGlobalFilterVisibility(view);
    setCurrentFilterState(view);
    await renderSectionFilters(view);
    if(version!==syncVersion||activeView()!==view)return;
    lastView=view;
    if(view==='inversiones'){
      setCurrentFilterState(view);
      document.dispatchEvent(new CustomEvent('panel:section-filters-ready',{detail:{view}}));
    }
  }

  document.addEventListener('panel:view-root-changed',event=>{
    const view=String(event.detail?.view||activeView());
    if(view&&view!==lastView)syncView(view).catch(console.error);
  });

  document.addEventListener('click',event=>{
    if(!event.target.closest('.local-multi-filter'))document.querySelectorAll('.local-multi-filter.open').forEach(x=>x.classList.remove('open'));
    if(event.target.closest('#clearFilters,#resetCurrentMonth')){
      const view=activeView();
      clearLocal(view);
      setCurrentFilterState(view);
      queueMicrotask(()=>{
        if(activeView()!==view)return;
        updateLocalControls(view);
        document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));
      });
    }
  },true);

  const start=()=>syncView(activeView()).catch(console.error);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();