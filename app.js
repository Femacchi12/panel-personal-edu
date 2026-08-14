(() => {
  const cfg = window.PANEL_CONFIG || {};
  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const state = {
    view: 'general', currency: cfg.primaryCurrency || 'COP', accessToken: null,
    mode: 'demo', data: null, charts: [], filters: {year:'',month:'',category:'',subcategory:'',currency:''}
  };

  const viewMeta = {
    general:['PANEL PERSONAL','Visión general'], gastos:['FINANZAS','Gastos diarios'], flujo:['FINANZAS','Flujo mensual'],
    tarjetas:['FINANZAS','Tarjetas de crédito'], deudas:['FINANZAS','Deudas'], inversiones:['FINANZAS','Inversiones'],
    pension:['FINANZAS','Pensión y cesantías'], ingresos:['FINANZAS','Ingresos y ahorro'], servicios:['FINANZAS','Servicios y referencias'],
    salud:['SALUD','Resumen de salud'], citas:['SALUD','Citas médicas'], tratamientos:['SALUD','Tratamientos'],
    documentos:['VIDA','Documentos'], viajes:['VIDA','Vacaciones y viajes']
  };

  const ranges = {
    finance:['Resumen_Gastos!A1:L200','Movimientos!A1:Y3000','Flujo_Mensual!A1:J1000','Tarjetas!A1:T1000','Cuotas!A1:T1000','Resumen_Inversiones!A1:N1000','Pensiones_Cesantias!A1:T1000','Resumen_Ingresos!A1:H100','Flujo_Ahorro!A1:P200','Servicios!A1:O200','Documentos_Identidad!A1:N1000','Documentos_Laborales!A1:L1000','Documentos_Tributarios!A1:L200','Vacaciones_Viajes!A1:T500'],
    health:['Pacientes!A1:X1500','Citas_Medicas!A1:N1000','Tratamientos!A1:X1500','Estudios_Resultados!A1:X1500','Eventos_Salud!A1:X1500','Mediciones!A1:X1500','Documentos!A1:X1500']
  };

  document.addEventListener('DOMContentLoaded', init);

  function init(){
    state.data = demoData();
    bindUI();
    populatePeriods();
    hydrateFilterOptions();
    render();
    if(cfg.googleClientId){ document.getElementById('authOverlay').classList.remove('hidden'); }
    else setSync('demo','Modo demo · Google pendiente');
  }

  function bindUI(){
    document.getElementById('sidebarToggle').onclick=()=>document.getElementById('sidebar').classList.toggle('collapsed');
    document.querySelectorAll('.nav-item').forEach(btn=>btn.onclick=()=>{
      state.view=btn.dataset.view;
      document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x===btn));
      render();
    });
    document.querySelectorAll('.currency-btn').forEach(btn=>btn.onclick=()=>{
      state.currency=btn.dataset.currency;
      document.querySelectorAll('.currency-btn').forEach(x=>x.classList.toggle('active',x===btn));
      render();
    });
    [['yearFilter','year'],['monthFilter','month'],['categoryFilter','category'],['subcategoryFilter','subcategory'],['currencyFilter','currency']].forEach(([id,key])=>{
      document.getElementById(id).onchange=e=>{state.filters[key]=e.target.value;render();};
    });
    document.getElementById('resetCurrentMonth').onclick=()=>resetCurrentMonth(true);
    document.getElementById('clearFilters').onclick=clearFilters;
    document.getElementById('refreshBtn').onclick=()=>state.accessToken?loadLiveData():render();
    document.getElementById('demoBtn').onclick=()=>{document.getElementById('authOverlay').classList.add('hidden');state.mode='demo';state.data=demoData();setSync('demo','Modo demo');render();};
    document.getElementById('googleLoginBtn').onclick=startGoogleLogin;
  }

  function populatePeriods(){
    const y=document.getElementById('yearFilter'),m=document.getElementById('monthFilter');
    y.innerHTML='<option value="">Todos</option>'+[2023,2024,2025,2026].map(v=>`<option>${v}</option>`).join('');
    m.innerHTML='<option value="">Todos</option>'+MONTHS.map((v,i)=>`<option value="${i+1}">${v}</option>`).join('');
    resetCurrentMonth(false);
  }
  function resetCurrentMonth(doRender){const n=new Date();state.filters.year=String(n.getFullYear());state.filters.month=String(n.getMonth()+1);state.filters.category='';state.filters.subcategory='';state.filters.currency='';syncFilterInputs();if(doRender)render();}
  function clearFilters(){Object.keys(state.filters).forEach(k=>state.filters[k]='');syncFilterInputs();render();}
  function syncFilterInputs(){Object.entries(state.filters).forEach(([k,v])=>{const el=document.getElementById(k+'Filter');if(el)el.value=v;});}

  function startGoogleLogin(){
    if(!cfg.googleClientId || !window.google?.accounts?.oauth2){alert('Todavía falta configurar Google OAuth. El diseño puede revisarse en modo demo.');return;}
    const client=google.accounts.oauth2.initTokenClient({
      client_id:cfg.googleClientId,
      scope:'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/userinfo.email',
      callback:async r=>{if(r.error)return alert('No se pudo iniciar sesión con Google.');state.accessToken=r.access_token;document.getElementById('authOverlay').classList.add('hidden');await loadProfile();await loadLiveData();setInterval(()=>state.accessToken&&loadLiveData(),(cfg.autoRefreshMinutes||5)*60000);}
    });
    client.requestAccessToken({prompt:'consent'});
  }
  async function loadProfile(){try{const r=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:`Bearer ${state.accessToken}`}});const p=await r.json();document.getElementById('accountText').textContent=p.email||'Google conectado';}catch(_){}}
  async function batchGet(id,rs){const q=rs.map(r=>`ranges=${encodeURIComponent(r)}`).join('&');const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&${q}`,{headers:{Authorization:`Bearer ${state.accessToken}`}});if(!res.ok)throw new Error(await res.text());return res.json();}
  async function loadLiveData(){
    setSync('loading','Actualizando Sheets…');document.getElementById('refreshBtn').disabled=true;
    try{const [f,h]=await Promise.all([batchGet(cfg.financeSpreadsheetId,ranges.finance),batchGet(cfg.healthSpreadsheetId,ranges.health)]);state.data=normalizeLive(f,h);state.mode='live';hydrateFilterOptions();setSync('ok',`Sincronizado · ${new Intl.DateTimeFormat('es-CO',{hour:'2-digit',minute:'2-digit'}).format(new Date())}`);render();}
    catch(e){console.error(e);setSync('demo','Error de sincronización');alert('No pude leer los Sheets con esta cuenta.');}
    finally{document.getElementById('refreshBtn').disabled=false;}
  }
  function setSync(kind,text){const d=document.getElementById('syncDot');d.className='sync-dot'+(kind==='ok'?' ok':kind==='loading'?' loading':'');document.getElementById('syncText').textContent=text;}

  function normalizeLive(finance,health){
    const map=o=>Object.fromEntries((o.valueRanges||[]).map(v=>[String(v.range||'').split('!')[0].replaceAll("'",''),v.values||[]]));
    const f=map(finance),h=map(health);
    return {
      summary:parseSummary(f.Resumen_Gastos), movimientos:rows(f.Movimientos), flujo:rows(f.Flujo_Mensual), tarjetas:rows(f.Tarjetas), cuotas:rows(f.Cuotas), inversiones:rows(f.Resumen_Inversiones), pension:rows(f.Pensiones_Cesantias), ingresos:parseIngresos(f.Resumen_Ingresos), ahorro:rows(f.Flujo_Ahorro), servicios:rows(f.Servicios),
      documentos:[...rows(f.Documentos_Identidad),...rows(f.Documentos_Laborales),...rows(f.Documentos_Tributarios),...rows(h.Documentos)], viajes:rows(f.Vacaciones_Viajes), pacientes:rows(h.Pacientes), citas:rows(h.Citas_Medicas), tratamientos:rows(h.Tratamientos), estudios:rows(h.Estudios_Resultados), eventosSalud:rows(h.Eventos_Salud), mediciones:rows(h.Mediciones)
    };
  }
  function rows(v){if(!v?.length)return[];const hd=v[0].map(String);return v.slice(1).filter(r=>r.some(x=>String(x??'').trim())).map(r=>Object.fromEntries(hd.map((h,i)=>[h,r[i]??''])));}
  function parseSummary(v){if(!v?.length)return{month:'',salary:0,rows:[]};const hd=v[3]||[];return{month:v?.[1]?.[1]||'',salary:num(v?.[2]?.[1]),rows:v.slice(4).filter(r=>r.length).map(r=>Object.fromEntries(hd.map((h,i)=>[h,r[i]??''])))};}
  function parseIngresos(v){if(!v?.length)return[];const hd=v[3]||[];return v.slice(4).filter(r=>r.length).map(r=>Object.fromEntries(hd.map((h,i)=>[h,r[i]??''])));}

  function hydrateFilterOptions(){
    const mov=state.data?.movimientos||[];
    fillSelect('categoryFilter',uniq(mov.map(r=>pick(r,['Categoría','Categoria'])).filter(Boolean)),'Todas');
    fillSelect('subcategoryFilter',uniq(mov.map(r=>pick(r,['Subcategoría','Subcategoria'])).filter(Boolean)),'Todas');
    syncFilterInputs();
  }
  function fillSelect(id,vals,label){const el=document.getElementById(id),cur=el.value;el.innerHTML=`<option value="">${label}</option>`+vals.sort().map(v=>`<option>${esc(v)}</option>`).join('');el.value=cur;}

  function render(){
    destroyCharts();
    const [eye,title]=viewMeta[state.view]||viewMeta.general;document.getElementById('viewEyebrow').textContent=eye;document.getElementById('viewTitle').textContent=title;
    const root=document.getElementById('viewRoot');
    const fn={general:renderGeneral,gastos:renderGastos,flujo:renderFlujo,tarjetas:renderTarjetas,deudas:renderDeudas,inversiones:renderInversiones,pension:renderPension,ingresos:renderIngresos,servicios:renderServicios,salud:renderSalud,citas:renderCitas,tratamientos:renderTratamientos,documentos:renderDocumentos,viajes:renderViajes}[state.view]||renderGeneral;
    root.innerHTML=fn();
    bindDynamic();
  }

  function renderGeneral(){
    const d=state.data,s=d.summary?.rows||[];const total=num(findRow(s,'Egresos TOTALES')?.['Mes actual COP']);const cash=num(findRow(s,'Egresos efectivos')?.['Mes actual COP']);const debt=num(findRow(s,'Egresos Financiados')?.['Mes actual COP']);const income=currentIncome();
    const cats=s.filter(r=>r.Tipo==='Categoría').sort((a,b)=>num(b['Mes actual COP'])-num(a['Mes actual COP']));
    return `${sectionHead('RESUMEN','Tu mes en una sola vista','Datos financieros, salud y próximos compromisos')}
      <div class="kpi-grid">${kpi('Total gastado',money(total),'Pagado + financiado')}${kpi('Pagado',money(cash),'Egresos efectivos','green')}${kpi('En deuda',money(debt),'Compras financiadas','gold')}${kpi('Ingresos',money(income),'Período seleccionado','blue')}</div>
      <div class="panel-grid"><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Gastos por categoría</strong><span>Principales rubros del período</span></div></div><div class="progress-list">${cats.slice(0,8).map(r=>progress(r.Concepto,num(r['Mes actual COP']),cats[0]?num(cats[0]['Mes actual COP']):1)).join('')}</div></div>
      <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Próximos compromisos</strong><span>Servicios y citas</span></div></div><div class="card-list">${nextCommitments()}</div></div></div>`;
  }

  function renderGastos(){const r=filterMovements(state.data.movimientos||[]);return `${sectionHead('FINANZAS','Detalle de gastos','Movimientos según los filtros aplicados')}${tablePanel('Movimientos',r,pickColumns(r,['Fecha','Tipo','Categoría','Subcategoría','Descripción / Comercio','$CO','$AR','$US','Medio de Pago','Pago']))}`;}
  function renderFlujo(){const a=state.data.ahorro||[];return `${sectionHead('FINANZAS','Flujo mensual','Ingresos, egresos y ahorro por mes')}<div class="panel"><div class="panel-header"><div class="panel-title"><strong>Evolución mensual</strong><span>Ingresos vs egresos</span></div></div><div class="chart-wrap tall"><canvas id="flowChart"></canvas></div></div>${tablePanel('Detalle mensual',a,pickColumns(a,['Mes','Estado','Ingresos reales COP','Egresos reales COP','Ahorro real COP','Tasa de ahorro real','Meta de ahorro','Cumplimiento de meta']))}`;}
  function renderTarjetas(){const r=state.data.tarjetas||[];return `${sectionHead('FINANZAS','Tarjetas de crédito','Utilización, cupo y próximo pago')}<div class="credit-grid">${r.map(card=>creditCard(card)).join('')||empty()}</div>${tablePanel('Detalle de tarjetas',r,pickColumns(r,['Emisor','Producto','Titular','Cupo total actual','Cupo usado','Cupo disponible','% utilización','Día corte','Día vencimiento','Pago mínimo próximo','Pago total próximo']))}`;}
  function renderDeudas(){const r=(state.data.cuotas||[]).filter(x=>norm(x.Estado)!=='pagada');const total=r.reduce((a,x)=>a+num(x['Saldo pendiente']),0);return `${sectionHead('FINANZAS','Deudas y cuotas','Compras financiadas pendientes')}<div class="kpi-grid">${kpi('Saldo pendiente',money(total),'Todas las cuotas')}${kpi('Compras activas',String(r.length),'Registros pendientes')}</div>${tablePanel('Cuotas pendientes',r,pickColumns(r,['Fecha compra','Comercio','Descripción','Tarjeta','Titular','Total compra','N° cuotas','Cuota actual','Valor cuota','Saldo pendiente','Fecha última cuota','Estado']))}`;}
  function renderInversiones(){const r=state.data.inversiones||[];return `${sectionHead('FINANZAS','Inversiones','Posiciones consolidadas por plataforma')}<div class="panel-grid equal">${r.map(x=>`<div class="panel"><div class="panel-title"><strong>${esc(x.Entidad||'Plataforma')}</strong><span>Corte ${esc(x['Fecha corte']||'')}</span></div><div class="credit-amount">${esc(x['Moneda base']||'')} ${formatNumber(num(x['Valor mercado']),2)}</div><div class="credit-bottom"><div class="credit-stat"><span>Aportes</span><strong>${formatNumber(num(x['Aportes/Incrementos']),2)}</strong></div><div class="credit-stat"><span>Resultado</span><strong>${formatNumber(num(x.Resultado),2)}</strong></div></div></div>`).join('')||empty()}</div>${tablePanel('Detalle de inversiones',r,pickColumns(r,['Entidad','Fecha corte','Moneda base','Valor mercado','Aportes/Incrementos','Resultado','Saldo efectivo','Estado','Notas']))}`;}
  function renderPension(){const r=state.data.pension||[];return `${sectionHead('FINANZAS','Pensión y cesantías','Evolución de saldos y aportes')}${tablePanel('Histórico',r,pickColumns(r,['Fecha','Mes','Entidad','Tipo','Saldo','Valor','Aporte','Rendimiento','Documento']))}`;}
  function renderIngresos(){const a=state.data.ahorro||[],i=state.data.ingresos||[];const last=a[a.length-1]||{};return `${sectionHead('FINANZAS','Ingresos y ahorro','Histórico, tasa de ahorro y cumplimiento')}<div class="kpi-grid">${kpi('Ahorro acumulado',money(num(last['Ahorro acumulado COP'])),'Año actual','green')}${kpi('Tasa de ahorro',last['Tasa de ahorro real']||'—','Mes más reciente')}${kpi('Meta',last['Meta de ahorro']||'30%','Objetivo mensual','gold')}${kpi('Cumplimiento',last['Cumplimiento de meta']||'—','Vs meta')}</div>${tablePanel('Resumen de ingresos',i,pickColumns(i,['Mes','Ingresos USD','Ingresos COP','Ingresos ARS','Cantidad de pagos']))}`;}
  function renderServicios(){const r=state.data.servicios||[];return `${sectionHead('FINANZAS','Servicios y referencias','Estado mensual y próximos vencimientos')}${tablePanel('Servicios',r,pickColumns(r,['Servicio','Tipo de servicio','Tipo de referencia','Número de referencia','Dirección / ubicación','Mes control','Pagado mes COP','Estado mes','Próximo vencimiento','Observaciones']))}`;}
  function renderSalud(){const d=state.data;return `${sectionHead('SALUD','Resumen de salud','Familia, eventos y estudios')}<div class="kpi-grid">${kpi('Pacientes',String((d.pacientes||[]).length),'Perfiles activos')}${kpi('Citas',String((d.citas||[]).length),'Histórico consolidado')}${kpi('Tratamientos',String((d.tratamientos||[]).length),'Registros')}${kpi('Estudios',String((d.estudios||[]).length),'Resultados y análisis')}</div><div class="panel-grid equal"><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Personas y mascotas</strong><span>Perfiles de salud</span></div></div><div class="card-list">${(d.pacientes||[]).map(p=>`<div class="list-card"><div><strong>${esc(p.Nombre)}</strong><small>${esc(p.Tipo||'')} · ${esc(p.Relación||'')}</small></div><span class="badge good">${esc(p.Activa||'Sí')}</span></div>`).join('')}</div></div><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Últimos estudios</strong><span>Resultados registrados</span></div></div><div class="card-list">${(d.estudios||[]).slice(-5).reverse().map(x=>`<div class="list-card"><div><strong>${esc(pick(x,['Estudio','Tipo','Nombre','Descripción']))||'Estudio'}</strong><small>${esc(pick(x,['Paciente','Fecha']))}</small></div></div>`).join('')||empty()}</div></div></div>`;}
  function renderCitas(){const r=state.data.citas||[];return `${sectionHead('SALUD','Citas médicas','Histórico y próximas citas')}${tablePanel('Citas',r,pickColumns(r,['Paciente','Fecha','Hora','Especialidad/Servicio','Centro','Dirección','Estado','Fuente','Observaciones']))}`;}
  function renderTratamientos(){const r=state.data.tratamientos||[];return `${sectionHead('SALUD','Tratamientos','Medicamentos, indicaciones y seguimiento')}${tablePanel('Tratamientos',r,pickColumns(r,['Paciente','Fecha inicio','Fecha fin','Tratamiento','Medicamento','Dosis','Frecuencia','Estado','Profesional','Observaciones']))}`;}
  function renderDocumentos(){const r=state.data.documentos||[];return `${sectionHead('VIDA','Documentos','Financieros, laborales, identidad y salud')}${tablePanel('Índice documental',r,pickColumns(r,['Persona','Paciente','Tipo','Categoría','Documento','Nombre','Fecha','Fecha vencimiento','Estado','Enlace','Observaciones']))}`;}
  function renderViajes(){const r=state.data.viajes||[];return `${sectionHead('VIDA','Vacaciones y viajes','Planificación, presupuesto y seguimiento')}${tablePanel('Viajes',r,pickColumns(r,['Viaje','Destino','Fecha Ida','Fecha vuelta','Estado','Presupuesto','Total','Diferencia','Observaciones']))}`;}

  function bindDynamic(){
    document.querySelectorAll('[data-search-table]').forEach(inp=>inp.oninput=()=>{const id=inp.dataset.searchTable,q=norm(inp.value);document.querySelectorAll(`#${id} tbody tr`).forEach(tr=>tr.style.display=norm(tr.textContent).includes(q)?'':'none');});
    if(state.view==='flujo') drawFlowChart();
  }
  function drawFlowChart(){const el=document.getElementById('flowChart');if(!el||!window.Chart)return;const r=state.data.ahorro||[];state.charts.push(new Chart(el,{type:'line',data:{labels:r.map(x=>x.Mes),datasets:[{label:'Ingresos',data:r.map(x=>num(x['Ingresos reales COP']))},{label:'Egresos',data:r.map(x=>num(x['Egresos reales COP']))},{label:'Ahorro',data:r.map(x=>num(x['Ahorro real COP']))}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa8ba'}}},scales:{x:{ticks:{color:'#718098'},grid:{color:'#121c29'}},y:{ticks:{color:'#718098',callback:v=>shortMoney(v)},grid:{color:'#121c29'}}}}}));}
  function destroyCharts(){state.charts.forEach(c=>{try{c.destroy()}catch(_){}});state.charts=[];}

  function sectionHead(eye,title,sub){return `<div class="section-head"><div><span class="eyebrow">${eye}</span><h2>${title}</h2></div><p>${sub||''}</p></div>`;}
  function kpi(label,value,meta,color=''){return `<div class="kpi-card"><span class="kpi-label">${label}</span><strong class="kpi-value ${color}">${value}</strong><div class="kpi-meta"><span>${meta||''}</span></div></div>`;}
  function progress(label,value,max){const p=Math.max(0,Math.min(100,max?value/max*100:0));return `<div class="progress-row"><span class="progress-label">${esc(label)}</span><div class="progress-track"><div class="progress-fill" style="width:${p}%"></div></div><strong class="progress-value">${money(value)}</strong></div>`;}
  function creditCard(r){const total=num(r['Cupo total actual']),used=num(r['Cupo usado']),pctv=total?used/total*100:num(r['% utilización']);const cls=pctv>=85?'critical':pctv>=70?'high':'';return `<div class="credit-card"><div class="credit-top"><span class="credit-brand">${esc(r.Emisor||'Tarjeta')}</span><span class="credit-owner">${esc(r.Titular||'')}</span></div><div class="credit-amount">${money(used)}</div><div class="credit-sub">Usado de ${money(total)}</div><div class="usage-track"><div class="usage-fill ${cls}" style="width:${Math.min(100,pctv)}%"></div></div><div class="credit-bottom"><div class="credit-stat"><span>Utilización</span><strong>${formatNumber(pctv,1)}%</strong></div><div class="credit-stat"><span>Próximo pago</span><strong>${money(num(r['Pago total próximo']))}</strong></div><div class="credit-stat"><span>Corte</span><strong>Día ${esc(r['Día corte']||'—')}</strong></div></div></div>`;}
  function tablePanel(title,data,cols){if(!data?.length)return `<div class="panel">${empty()}</div>`;const id='tbl'+Math.random().toString(36).slice(2,8);return `<div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>${title}</strong><span>${data.length} registros</span></div><div class="table-toolbar"><input class="search-input" data-search-table="${id}" placeholder="Buscar en la tabla…"></div></div><div class="table-scroll"><table id="${id}"><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${data.map(r=>`<tr>${cols.map(c=>`<td title="${esc(r[c])}">${formatCell(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;}
  function formatCell(v){const s=String(v??'');if(/^https?:\/\//i.test(s))return `<a href="${esc(s)}" target="_blank" rel="noopener" class="blue">Abrir</a>`;return esc(s);}
  function nextCommitments(){const serv=(state.data.servicios||[]).slice(0,4).map(x=>`<div class="list-card"><div><strong>${esc(x.Servicio)}</strong><small>${esc(x['Próximo vencimiento']||'')}</small></div><span class="badge ${norm(x['Estado mes'])==='pagado'?'good':'warn'}">${esc(x['Estado mes']||'Pendiente')}</span></div>`);const citas=(state.data.citas||[]).filter(x=>isFuture(x.Fecha)).slice(0,2).map(x=>`<div class="list-card"><div><strong>${esc(x['Especialidad/Servicio']||'Cita médica')}</strong><small>${esc(x.Paciente||'')} · ${esc(x.Fecha||'')}</small></div><span class="badge good">Cita</span></div>`);return [...serv,...citas].join('')||empty();}

  function filterMovements(r){return r.filter(x=>{const d=parseDate(x.Fecha);if(state.filters.year&&(!d||String(d.getFullYear())!==state.filters.year))return false;if(state.filters.month&&(!d||String(d.getMonth()+1)!==state.filters.month))return false;if(state.filters.category&&pick(x,['Categoría','Categoria'])!==state.filters.category)return false;if(state.filters.subcategory&&pick(x,['Subcategoría','Subcategoria'])!==state.filters.subcategory)return false;return true;});}
  function currentIncome(){const a=state.data.ahorro||[];if(state.filters.year&&state.filters.month){const key=`${MONTHS[+state.filters.month-1]} ${state.filters.year}`;const r=a.find(x=>norm(x.Mes)===norm(key));if(r)return num(r['Ingresos reales COP']);}return num((a[a.length-1]||{})['Ingresos reales COP']);}
  function findRow(r,name){return r.find(x=>norm(x.Concepto)===norm(name));}
  function pickColumns(r,c){if(!r?.length)return c;const ks=new Set(Object.keys(r[0]));return c.filter(x=>ks.has(x));}
  function pick(o,keys){for(const k of keys)if(o&&o[k]!=null&&String(o[k]).trim()!=='')return o[k];return'';}
  function uniq(a){return[...new Set(a)];}
  function empty(){return '<div class="empty-state"><div><strong>Sin información para mostrar</strong><span>Los datos aparecerán cuando estén disponibles.</span></div></div>';}
  function norm(s){return String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
  function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function parseDate(v){const s=String(v??'').trim();if(!s)return null;let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);const d=new Date(s);return isNaN(d)?null:d;}
  function isFuture(v){const d=parseDate(v);if(!d)return false;const t=new Date();t.setHours(0,0,0,0);return d>=t;}
  function num(v){if(typeof v==='number')return v;let s=String(v??'').trim().replace(/[^0-9,.-]/g,'');if(!s)return 0;if(s.includes(',')&&s.includes('.')){if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(s.includes(',')){const p=s.split(',');if(p[p.length-1].length<=2)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else{const dots=(s.match(/\./g)||[]).length;if(dots>1||(dots===1&&s.split('.')[1]?.length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}
  function formatNumber(v,d=0){return new Intl.NumberFormat('es-CO',{maximumFractionDigits:d,minimumFractionDigits:d}).format(v||0);}
  function money(v){const rates={COP:1,USD:1/3150,ARS:1500/3150};return new Intl.NumberFormat('es-CO',{style:'currency',currency:state.currency,maximumFractionDigits:state.currency==='COP'?0:2}).format((v||0)*(rates[state.currency]||1));}
  function shortMoney(v){const a=Math.abs(v||0);if(a>=1e9)return`${(v/1e9).toFixed(1)}B`;if(a>=1e6)return`${(v/1e6).toFixed(1)}M`;if(a>=1e3)return`${(v/1e3).toFixed(0)}k`;return formatNumber(v);}

  function demoData(){return {
    summary:{month:'2026-08',salary:8759350,rows:[{Tipo:'Categoría',Concepto:'Servicios','Mes actual COP':'$1.387.999'},{Tipo:'Categoría',Concepto:'Supermercado','Mes actual COP':'$656.923'},{Tipo:'Categoría',Concepto:'Pia','Mes actual COP':'$1.632.216'},{Tipo:'Categoría',Concepto:'Odontología','Mes actual COP':'$80.000'},{Tipo:'Categoría',Concepto:'Viajes','Mes actual COP':'$1.193.640'},{Tipo:'Categoría',Concepto:'Comidas/Cenas','Mes actual COP':'$132.800'},{Tipo:'Categoría',Concepto:'Plataformas','Mes actual COP':'$55.247'},{Tipo:'Egreso',Concepto:'Egresos efectivos','Mes actual COP':'$3.675.622'},{Tipo:'Egreso',Concepto:'Egresos Financiados','Mes actual COP':'$1.666.974'},{Tipo:'Egreso',Concepto:'Egresos TOTALES','Mes actual COP':'$5.342.596'}]},
    movimientos:[],
    tarjetas:[{Emisor:'Nu',Producto:'Tarjeta de crédito',Titular:'Edu','Cupo total actual':'$1.200.000','Cupo usado':'$912.021','Cupo disponible':'$287.979','% utilización':'76,0%','Día corte':'15','Pago total próximo':'$912.021'},{Emisor:'Nu',Producto:'Tarjeta de crédito',Titular:'Rocío','Cupo total actual':'$1.000.000','Cupo usado':'$868.738','Cupo disponible':'$131.262','% utilización':'86,9%','Día corte':'15','Pago total próximo':'$868.738'},{Emisor:'ARQ',Producto:'Tarjeta / línea de crédito',Titular:'Edu','Cupo total actual':'$14.385.371','Cupo usado':'$578.620','Cupo disponible':'$13.806.751','% utilización':'4,0%','Día corte':'6','Pago total próximo':'$578.620'}],
    cuotas:[],
    inversiones:[{Entidad:'ARQ','Fecha corte':'2026-07-31','Moneda base':'USD','Valor mercado':'13116,1','Aportes/Incrementos':'6253,39',Resultado:'',Estado:'Confirmado'},{Entidad:'Cocos Capital','Fecha corte':'2026-08-13','Moneda base':'COP','Valor mercado':'2550494,59','Aportes/Incrementos':'2690330,12',Resultado:'-139835,53',Estado:'Confirmado'}],
    pension:[], ingresos:[],
    ahorro:[{Mes:'ene 2026',Estado:'Cerrado','Ingresos reales COP':'$9.172.415','Egresos reales COP':'$5.604.273','Ahorro real COP':'$3.568.142','Tasa de ahorro real':'38,9%','Meta de ahorro':'30,0%','Cumplimiento de meta':'129,7%','Ahorro acumulado COP':'$3.568.142'},{Mes:'feb 2026',Estado:'Cerrado','Ingresos reales COP':'$8.759.350','Egresos reales COP':'$6.619.049','Ahorro real COP':'$2.140.301','Tasa de ahorro real':'24,4%','Meta de ahorro':'30,0%','Cumplimiento de meta':'81,4%','Ahorro acumulado COP':'$5.708.443'},{Mes:'mar 2026',Estado:'Cerrado','Ingresos reales COP':'$8.759.350','Egresos reales COP':'$10.014.838','Ahorro real COP':'-$1.255.488','Tasa de ahorro real':'-14,3%','Meta de ahorro':'30,0%','Cumplimiento de meta':'-47,8%','Ahorro acumulado COP':'$4.452.955'},{Mes:'abr 2026',Estado:'Cerrado','Ingresos reales COP':'$8.836.350','Egresos reales COP':'$7.037.716','Ahorro real COP':'$1.798.634','Tasa de ahorro real':'20,4%','Meta de ahorro':'30,0%','Cumplimiento de meta':'67,8%','Ahorro acumulado COP':'$6.251.589'},{Mes:'may 2026',Estado:'Cerrado','Ingresos reales COP':'$8.810.350','Egresos reales COP':'$7.571.268','Ahorro real COP':'$1.239.082','Tasa de ahorro real':'14,1%','Meta de ahorro':'30,0%','Cumplimiento de meta':'46,9%','Ahorro acumulado COP':'$7.490.671'},{Mes:'jun 2026',Estado:'Cerrado','Ingresos reales COP':'$10.903.850','Egresos reales COP':'$8.338.043','Ahorro real COP':'$2.565.807','Tasa de ahorro real':'23,5%','Meta de ahorro':'30,0%','Cumplimiento de meta':'78,4%','Ahorro acumulado COP':'$10.056.478'},{Mes:'jul 2026',Estado:'Cerrado','Ingresos reales COP':'$12.818.409','Egresos reales COP':'$6.347.202','Ahorro real COP':'$6.471.207','Tasa de ahorro real':'50,5%','Meta de ahorro':'30,0%','Cumplimiento de meta':'168,3%','Ahorro acumulado COP':'$16.527.685'},{Mes:'ago 2026',Estado:'En curso','Ingresos reales COP':'$4.095.000','Egresos reales COP':'$5.342.596','Ahorro real COP':'-$1.247.596','Tasa de ahorro real':'-30,5%','Meta de ahorro':'30,0%','Cumplimiento de meta':'-101,6%','Ahorro acumulado COP':'$15.280.089'}],
    servicios:[{Servicio:'Afinia','Tipo de servicio':'Servicio eléctrico','Tipo de referencia':'NIC','Número de referencia':'••••1089','Pagado mes COP':'$20.100','Estado mes':'Pagado','Próximo vencimiento':'25/08/2026'},{Servicio:'Acuacar','Tipo de servicio':'Servicio de agua','Tipo de referencia':'Póliza','Número de referencia':'•••9185','Pagado mes COP':'$241.868','Estado mes':'Pagado','Próximo vencimiento':'28/08/2026'},{Servicio:'TIGO - Hogar','Tipo de servicio':'Internet hogar','Tipo de referencia':'Contrato','Número de referencia':'••••2703','Pagado mes COP':'$101.031','Estado mes':'Pagado','Próximo vencimiento':'26/08/2026'},{Servicio:'Arriendo','Tipo de servicio':'Arriendo vivienda','Tipo de referencia':'Arrendador','Número de referencia':'Datos privados','Pagado mes COP':'$1.000.000','Estado mes':'Pagado','Próximo vencimiento':'01/09/2026'}],
    pacientes:[{Nombre:'Edu',Tipo:'Humano',Relación:'Titular',Activa:'Sí'},{Nombre:'Rocío',Tipo:'Humano',Relación:'Pareja',Activa:'Sí'},{Nombre:'Pia',Tipo:'Mascota',Relación:'Perrita',Activa:'Sí'}],
    citas:[],tratamientos:[],estudios:[],eventosSalud:[],mediciones:[],documentos:[],viajes:[]
  };}
})();
