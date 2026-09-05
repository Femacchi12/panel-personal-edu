(() => {
  "use strict";

  const cfg = window.PANEL_CONFIG || {};
  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const MONTH_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const COLORS = ['#1769ff','#f6c844','#26d07c','#ff667a','#ffad42','#7a8ba5','#8b5cf6','#22d3ee','#f472b6','#a3e635'];

  const state = {
    view: 'general',
    currency: cfg.primaryCurrency || 'COP',
    token: window.__PANEL_GOOGLE_ACCESS_TOKEN__ || null,
    data: emptyData(),
    filters: {year:[], month:[], category:[], subcategory:[], currency:[]},
    charts: [],
    expandedTables: new Set(),
    searches: {},
    sorts: {},
    loadErrors: [],
    loadedSources: 0,
    totalSources: 0,
    lastSync: null
  };

  const viewMeta = {
    general:['PANEL PERSONAL','Visión general'],
    resumen:['FINANZAS','Resumen financiero'],
    gastos:['FINANZAS','Gastos diarios'],
    flujo:['FINANZAS','Flujo mensual'],
    tarjetas:['FINANZAS','Tarjetas de crédito'],
    deudas:['FINANZAS','Deudas'],
    inversiones:['FINANZAS','Inversiones'],
    pension:['FINANZAS','Pensión y cesantías'],
    ingresos:['FINANZAS','Ingresos y ahorro'],
    servicios:['FINANZAS','Servicios y referencias'],
    salud:['SALUD','Resumen de salud'],
    citas:['SALUD','Citas médicas'],
    tratamientos:['SALUD','Tratamientos'],
    documentos:['VIDA','Documentos'],
    viajes:['VIDA','Vacaciones y viajes']
  };

  const SOURCES = [
    {key:'movimientos', book:'finance', range:'Movimientos!A:Z', parser:'rows'},
    {key:'flujo', book:'finance', range:'Flujo_Mensual!A:J', parser:'smart'},
    {key:'tarjetas', book:'finance', range:'Tarjetas!A:T', parser:'smart'},
    {key:'cuotas', book:'finance', range:'Cuotas!A:T', parser:'smart'},
    {key:'pension', book:'finance', range:'Pensiones_Cesantias!A:T', parser:'smart'},
    {key:'ingresos', book:'finance', range:'Resumen_Ingresos!A:H', parser:'smart'},
    {key:'ingresosConceptos', book:'finance', range:'Resumen_Conceptos_Ingresos!A:L', parser:'smart'},
    {key:'ahorro', book:'finance', range:'Flujo_Ahorro!A:W', parser:'smart'},
    {key:'configFinanzas', book:'finance', range:'Config!A:C', parser:'smart'},
    {key:'servicios', book:'finance', range:'Servicios!A:O', parser:'smart'},
    {key:'referenciasPersonales', book:'finance', range:'Referencias_Personales!A:N', parser:'smart'},
    {key:'cuentas', book:'finance', range:'Cuentas!A:T', parser:'smart'},
    {key:'documentos', book:'documents', range:'Documentos_Master!A:R', parser:'smart'},
    {key:'viajes', book:'finance', range:'Vacaciones_Viajes!A:T', parser:'smart'},
    {key:'pacientes', book:'health', range:'Pacientes!A:X', parser:'smart'},
    {key:'citas', book:'health', range:'Citas_Medicas!A:N', parser:'smart'},
    {key:'tratamientos', book:'health', range:'Tratamientos!A:X', parser:'smart'},
    {key:'estudios', book:'health', range:'Estudios_Resultados!A:X', parser:'smart'},
    {key:'eventosSalud', book:'health', range:'Eventos_Salud!A:X', parser:'smart'},
    {key:'mediciones', book:'health', range:'Mediciones!A:X', parser:'smart'},
    {key:'docsSalud', book:'health', range:'Documentos!A:X', parser:'smart'}
  ];

  const filterOptions = {
    year: [],
    month: MONTH_LABELS.map((label,i)=>({value:String(i+1),label})),
    category: [],
    subcategory: [],
    currency: ['COP','USD','ARS'].map(v=>({value:v,label:v}))
  };

  init();

  async function init() {
    try {
      bindUI();
      resetCurrentMonth(false);
      renderFilterOptions();
      render();
      if (!state.token) {
        setSync('demo','Sesión sin acceso a Sheets');
        return;
      }
      await loadLiveData(false);
      const minutes = Math.max(1, Number(cfg.autoRefreshMinutes || 5));
      clearInterval(window.__PANEL_DATA_TIMER__);
      window.__PANEL_DATA_TIMER__ = setInterval(()=>loadLiveData(false), minutes * 60 * 1000);
    } catch (error) {
      showFatal(error);
    }
  }

  function bindUI() {
    byId('sidebarToggle')?.addEventListener('click',()=>byId('sidebar')?.classList.toggle('collapsed'));
    document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click',()=>{
      state.view = btn.dataset.view || 'general';
      document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x===btn));
      closeFilterMenus();
      render();
    }));
    document.querySelectorAll('.currency-btn').forEach(btn => btn.addEventListener('click',()=>{
      state.currency = btn.dataset.currency || 'COP';
      document.querySelectorAll('.currency-btn').forEach(x=>x.classList.toggle('active',x===btn));
      render();
    }));
    document.querySelectorAll('[data-filter-trigger]').forEach(btn => btn.addEventListener('click',event=>{
      event.stopPropagation();
      const key = btn.dataset.filterTrigger;
      const root = document.querySelector(`.multi-filter[data-filter="${key}"]`);
      const opening = !root?.classList.contains('open');
      closeFilterMenus();
      if (root && opening) {
        root.classList.add('open');
        btn.setAttribute('aria-expanded','true');
        const input = root.querySelector('[data-filter-search]');
        if (input) {
          input.value = '';
          filterFilterOptions(key,'');
          setTimeout(()=>input.focus(),0);
        }
      }
    }));
    document.querySelectorAll('[data-filter-search]').forEach(input=>{
      input.addEventListener('input',()=>filterFilterOptions(input.dataset.filterSearch,input.value));
      input.addEventListener('click',e=>e.stopPropagation());
    });
    document.querySelectorAll('[data-clear-filter]').forEach(btn=>btn.addEventListener('click',e=>{
      e.stopPropagation();
      state.filters[btn.dataset.clearFilter] = [];
      renderFilterOptions();
      render();
      document.dispatchEvent(new CustomEvent('panel:filters-updated',{detail:{view:state.view,filters:state.filters}}));
    }));
    byId('resetCurrentMonth')?.addEventListener('click',()=>resetCurrentMonth(true));
    byId('clearFilters')?.addEventListener('click',()=>{
      Object.keys(state.filters).forEach(k=>state.filters[k]=[]);
      renderFilterOptions();
      render();
      document.dispatchEvent(new CustomEvent('panel:filters-updated',{detail:{view:state.view,filters:state.filters}}));
    });
    byId('refreshBtn')?.addEventListener('click',()=>loadLiveData(true));
    document.addEventListener('click',e=>{ if (!e.target.closest('.multi-filter')) closeFilterMenus(); });
  }

  async function loadLiveData(showAlert = false) {
    if (!state.token) return;
    const refresh = byId('refreshBtn');
    if (refresh) refresh.disabled = true;
    setSync('loading','Actualizando datos…');
    state.loadErrors = [];
    state.loadedSources = 0;
    state.totalSources = SOURCES.length;
    const results = await Promise.allSettled(SOURCES.map(fetchSource));
    const next = emptyData();
    results.forEach((result,index)=>{
      const src = SOURCES[index];
      if (result.status === 'fulfilled') {
        next[src.key] = result.value;
        state.loadedSources++;
      } else {
        state.loadErrors.push({source:src.range,error:String(result.reason?.message || result.reason)});
      }
    });
    if (state.loadedSources > 0) {
      state.data = next;
      window.__PANEL_APP_DATA__ = state.data;
      state.lastSync = new Date();
      hydrateFilterOptions();
      const warning = state.loadErrors.length ? ` · ${state.loadErrors.length} fuente(s) con error` : '';
      setSync('ok',`Sincronizado ${state.loadedSources}/${state.totalSources}${warning}`);
      render();
      document.dispatchEvent(new CustomEvent('panel:app-data-ready',{detail:{loadedSources:state.loadedSources,totalSources:state.totalSources,lastSync:state.lastSync}}));
    } else {
      state.data = next;
      window.__PANEL_APP_DATA__ = state.data;
      const err = state.loadErrors[0]?.error || 'Google no devolvió datos';
      setSync('demo','No se pudieron leer los Sheets');
      render();
      if (showAlert) alert(`No se pudieron leer los Sheets.\n\n${shortError(err)}\n\nPulsa "Salir" y vuelve a ingresar con Google. Si continúa, revisaremos la habilitación de Google Sheets API.`);
    }
    if (refresh) refresh.disabled = false;
  }

  async function fetchSource(src) {
    const ids = {
      finance: cfg.financeSpreadsheetId,
      documents: cfg.documentsSpreadsheetId,
      health: cfg.healthSpreadsheetId
    };
    const id = ids[src.book];
    if (!id) throw new Error('Falta ID del Sheet ' + src.book);

    let values;
    const getSourceValues = window.__PANEL_GET_SOURCE_VALUES__;
    if (typeof getSourceValues === 'function') {
      values = await getSourceValues(id, src.range, false);
    } else {
      const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id) + '/values/' + encodeURIComponent(src.range) + '?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE';
      const response = await fetch(url,{headers:{Authorization:'Bearer ' + state.token}});
      if (!response.ok) {
        const body = await response.text();
        throw new Error(response.status + ' ' + response.statusText + ': ' + body);
      }
      values = (await response.json()).values || [];
    }
    return src.parser === 'rows' ? parseRows(values||[]) : parseRowsSmart(values||[]);
  }

  window.__PANEL_RELOAD_DATA__ = loadLiveData;

  function parseRows(values, headerIndex=0) {
    if (!Array.isArray(values) || !values.length || !values[headerIndex]) return [];
    const headers = values[headerIndex].map(v=>String(v||'').trim());
    if (!headers.some(Boolean)) return [];
    return values.slice(headerIndex+1)
      .filter(row=>row?.some(v=>String(v??'').trim()!==''))
      .map(row=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,row?.[i]??''])));
  }

  function parseRowsSmart(values) {
    if (!Array.isArray(values) || !values.length) return [];
    let best=0, score=-1;
    for (let i=0;i<Math.min(values.length,12);i++) {
      const row = values[i] || [];
      const nonEmpty = row.filter(v=>String(v??'').trim()!=='').length;
      const textual = row.filter(v=>typeof v==='string' && /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(v)).length;
      const s = nonEmpty*2 + textual;
      if (nonEmpty>=2 && s>score) { score=s; best=i; }
    }
    return parseRows(values,best);
  }

  function hydrateFilterOptions() {
    const mov = state.data.movimientos || [];
    const years = new Set(), cats = new Set(), subs = new Set();
    mov.forEach(row=>{
      const d=movementDate(row);
      if (d) years.add(String(d.getFullYear()));
      const c=pick(row,['Categoría','Categoria']);
      const s=pick(row,['Subcategoría','Subcategoria']);
      if(c)cats.add(c);
      if(s)subs.add(s);
    });
    years.add(String(new Date().getFullYear()));
    filterOptions.year=[...years].sort((a,b)=>Number(b)-Number(a)).map(v=>({value:v,label:v}));
    filterOptions.category=[...cats].sort(localeSort).map(v=>({value:v,label:v}));
    filterOptions.subcategory=[...subs].sort(localeSort).map(v=>({value:v,label:v}));
    renderFilterOptions();
  }

  function renderFilterOptions() {
    Object.keys(filterOptions).forEach(key=>{
      const box=document.querySelector(`[data-filter-options="${key}"]`);
      if(!box)return;
      const items=filterOptions[key]||[];
      box.innerHTML = items.length ? items.map(item=>{
        const selected=state.filters[key]?.includes(String(item.value));
        return `<button type="button" class="multi-filter-option${selected?' selected':''}" data-value="${esc(item.value)}" data-label="${esc(item.label)}" aria-pressed="${selected}"><span class="multi-filter-check">${selected?'✓':''}</span><span>${esc(item.label)}</span></button>`;
      }).join('') : '<div class="multi-filter-empty">Sin opciones</div>';
      box.querySelectorAll('.multi-filter-option').forEach(btn=>btn.addEventListener('click',e=>{
        e.stopPropagation();
        const list=state.filters[key]||[],value=btn.dataset.value,i=list.indexOf(value);
        if(i>=0)list.splice(i,1); else list.push(value);
        state.filters[key]=list;
        renderFilterOptions();
        render();
        document.dispatchEvent(new CustomEvent('panel:filters-updated',{detail:{view:state.view,filters:state.filters}}));
      }));
      updateFilterControl(key);
    });
  }

  function updateFilterControl(key) {
    const selected=state.filters[key]||[];
    const summary=document.querySelector(`[data-filter-summary="${key}"]`);
    const root=document.querySelector(`.multi-filter[data-filter="${key}"]`);
    root?.classList.toggle('has-selection',selected.length>0);
    if(!summary)return;
    if(!selected.length) summary.textContent=['category','subcategory','currency'].includes(key)?'Todas':'Todos';
    else if(selected.length===1) summary.textContent=filterLabel(key,selected[0]);
    else summary.textContent=`${selected.length} seleccionados`;
  }
  function filterLabel(key,value) { return (filterOptions[key]||[]).find(x=>String(x.value)===String(value))?.label || value; }
  function filterFilterOptions(key,query) {
    const q=norm(query);
    document.querySelectorAll(`[data-filter-options="${key}"] .multi-filter-option`).forEach(btn=>{btn.hidden=!!q && !norm(btn.dataset.label||btn.dataset.value).includes(q);});
  }
  function closeFilterMenus() {
    document.querySelectorAll('.multi-filter.open').forEach(root=>{root.classList.remove('open');root.querySelector('[data-filter-trigger]')?.setAttribute('aria-expanded','false');});
  }
  function resetCurrentMonth(doRender=true) {
    const now=new Date();
    state.filters.year=[String(now.getFullYear())];
    state.filters.month=[String(now.getMonth()+1)];
    state.filters.category=[];state.filters.subcategory=[];state.filters.currency=[];
    renderFilterOptions();
    if(doRender)render();
  }

  function render() {
    destroyCharts();
    const [eye,title]=viewMeta[state.view]||viewMeta.general;
    if(byId('viewEyebrow'))byId('viewEyebrow').textContent=eye;
    if(byId('viewTitle'))byId('viewTitle').textContent=title;
    const root=byId('viewRoot');
    if(!root)return;
    if(state.loadedSources===0 && state.token && state.loadErrors.length) {root.innerHTML=renderLoadError();bindDynamic();return;}
    const fn={general:renderGeneral,resumen:renderResumen,gastos:renderGastos,flujo:renderFlujo,tarjetas:renderTarjetas,deudas:renderDeudas,inversiones:renderInversiones,pension:renderPension,ingresos:renderIngresos,servicios:renderServicios,salud:renderSalud,citas:renderCitas,tratamientos:renderTratamientos,documentos:renderDocumentos,viajes:renderViajes}[state.view]||renderGeneral;
    root.innerHTML=fn();bindDynamic();requestAnimationFrame(drawViewCharts);
  }

  function renderLoadError() {
    const first=state.loadErrors[0]?.error||'No fue posible leer Google Sheets.';
    return `${sectionHead('SINCRONIZACIÓN','No se pudieron cargar los datos','La navegación funciona; falta recuperar los datos privados desde Google Sheets.')}<div class="panel"><div class="empty-state"><div><strong>Google Sheets rechazó la lectura</strong><span>${esc(shortError(first))}</span><span style="display:block;margin-top:10px">Pulsa <b>Salir</b>, vuelve a ingresar con una de tus cuentas autorizadas y acepta el permiso de lectura de Google Sheets.</span></div></div></div>`;
  }

  function renderGeneral() {
    const mov=filteredMovements();const expenses=mov.filter(isExpense);const total=sum(expenses,movementAmount);const paid=sum(expenses.filter(r=>!isFinanced(r)),movementAmount);const debt=sum(expenses.filter(isFinanced),movementAmount);const savings=latestAhorroValue();const topCats=[...aggregate(expenses,r=>pick(r,['Categoría','Categoria'])||'Sin categoría',movementAmount).entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);const max=topCats[0]?.[1]||1;const latest=expenses.slice().sort((a,b)=>dateValue(b)-dateValue(a));
    return `${sectionHead('RESUMEN','Tu mes en una sola vista','Finanzas, movimientos y evolución con los filtros globales aplicados')}<div class="kpi-grid">${kpi('Total gastado',money(total),`${expenses.length} movimientos`)}${kpi('Pagado',money(paid),'Efectivo/débito y no financiado','green')}${kpi('En deuda',money(debt),'Tarjetas y compras financiadas','gold')}${kpi('Ahorro',money(savings),'Último período disponible','blue')}</div><div class="panel-grid equal">${chartPanel('Gasto por día','Evolución dentro del período','generalDailyChart',Math.max(760,dayCount(expenses)*52))}${chartPanel('Gastos por categoría','Comparación del período','generalCategoryChart',760)}</div><div class="panel-grid"><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Top categorías</strong><span>Rubros con mayor gasto</span></div></div><div class="progress-list">${topCats.length?topCats.map(([l,v])=>progress(l,v,max)).join(''):empty('Sin gastos para los filtros')}</div></div><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Últimos movimientos</strong><span>Más recientes del período</span></div></div><div class="card-list">${latestMovementCards(latest.slice(0,6))}</div></div></div>${tablePanel('Movimientos recientes',latest,['Fecha real','Categoría','Subcategoría','Descripción / Comercio','Cuenta / Tarjeta','Titular','Monto COP','Monto ARS','Monto USD'])}`;
  }
  function registeredExpense(row){
    const status=norm(pick(row,['Estado']));
    if(status&&(status.includes('proyecc')||status.includes('programad')||status.includes('pendiente')))return false;
    return isExpense(row);
  }

  function isCreditPurchase(row){
    if(!registeredExpense(row))return false;
    const method=norm(pick(row,['Modalidad de pago','Modalidad','Medio de pago']));
    const account=norm(pick(row,['Cuenta / Tarjeta','Medio de Pago','Pago']));
    const installments=num(pick(row,['Cuotas','N° cuotas','Numero cuotas']));
    const credit=method.includes('credito')||account.includes('arq')||account.includes('nu ')||account==='nu'||(installments>0&&(account.includes('nu')||account.includes('arq')));
    if(!credit)return false;
    if(norm(pick(row,['Categoría','Categoria']))==='tarjeta col')return false;
    const description=norm(`${pick(row,['Descripción / Comercio','Descripción','Comercio'])} ${pick(row,['Descripción original'])}`);
    return !/cuota de manejo|interes|pago de tarjeta|pago tarjeta/.test(description);
  }

  function configFinanceValue(label,fallback=0){
    const key=norm(label);
    const row=(state.data.configFinanzas||[]).find(r=>norm(pick(r,['Parámetro','Parametro']))===key);
    return num(pick(row,['Valor']))||fallback;
  }
  function copToDisplay(value){
    const cop=Number(value)||0;
    if(state.currency==='COP')return cop;
    const usdCop=configFinanceValue('Tasa actual USD/COP',3150);
    const usdArs=configFinanceValue('Tasa actual USD/ARS',1500);
    if(state.currency==='USD')return usdCop?cop/usdCop:cop;
    if(state.currency==='ARS')return usdCop?cop/usdCop*usdArs:cop;
    return cop;
  }
  function summaryMoneyCop(value){return money(copToDisplay(value));}

  function incomeConceptTotals(rows){
    const salaryCop=sum(rows,r=>num(pick(r,['Sueldo COP'])));
    const llc=sum(rows,r=>num(pick(r,['Sueldo USD (equiv. COP)'])));
    const total=sum(rows,r=>num(pick(r,['Total consolidado'])));
    return{salaryCop,llc,other:total-salaryCop-llc,total};
  }

  function cardSpendLabel(card){
    const issuer=String(pick(card,['Emisor'])||'Tarjeta').trim();
    const owner=String(pick(card,['Titular'])||'').trim();
    if(norm(issuer).includes('nu')&&norm(owner).includes('rocio'))return'Nu Ro';
    if(norm(issuer).includes('nu')&&norm(owner).includes('edu'))return'Nu Edu';
    if(norm(issuer).includes('arq'))return'ARQ Edu';
    return`${issuer} ${owner}`.trim();
  }
  function movementMatchesCard(row,card){
    const account=norm(pick(row,['Cuenta / Tarjeta']));
    const issuer=norm(pick(card,['Emisor'])),owner=norm(pick(card,['Titular']));
    if(issuer.includes('arq'))return account.includes('arq');
    if(issuer.includes('nu')&&owner.includes('rocio'))return account.includes('nu ro');
    if(issuer.includes('nu')&&owner.includes('edu'))return account.includes('nu edu');
    return account.includes(issuer)&&(!owner||account.includes(owner.split(' ')[0]));
  }
  function creditSpendRows(){return filteredMovements().filter(isCreditPurchase);}
  function creditSpendPanel(cards){
    const rows=creditSpendRows(),total=sum(rows,movementAmount);
    const cells=(cards||[]).map(card=>{
      const amount=sum(rows.filter(row=>movementMatchesCard(row,card)),movementAmount);
      const share=total?amount/total*100:0;
      return`<div class="credit-spend-item"><span>${esc(cardSpendLabel(card))}</span><strong>${money(amount)}</strong><small>${formatNumber(share,1)}% del gasto en crédito</small></div>`;
    }).join('');
    return`<div class="panel credit-spend-panel"><div class="panel-header"><div class="panel-title"><strong>Gasto con crédito en el período</strong><span>Compras reales según los filtros; excluye pagos de tarjeta, manejo e intereses.</span></div><div class="credit-spend-total"><span>Total</span><strong>${money(total)}</strong></div></div><div class="credit-spend-grid">${cells||empty('Sin compras con crédito para los filtros')}</div></div>`;
  }

  function breakdownRows(entries,total){
    const sorted=[...entries].sort((a,b)=>b[1]-a[1]).slice(0,12);
    if(!sorted.length)return empty('Sin datos para los filtros seleccionados');
    return`<div class="summary-breakdown-list">${sorted.map(([label,value])=>`<div><span>${esc(label||'Sin categoría')}</span><strong>${money(value)}</strong><small>${total?formatNumber(value/total*100,1):'0,0'}%</small></div>`).join('')}</div>`;
  }

  function renderResumen(){
    const incomeRows=filterByPeriod(state.data.ingresosConceptos||[]);
    const expenseRows=filteredMovements().filter(registeredExpense);
    const creditRows=expenseRows.filter(isCreditPurchase);
    const incomeParts=incomeConceptTotals(incomeRows);
    const income= copToDisplay(incomeParts.total);
    const expenses=sum(expenseRows,movementAmount);
    const credit=sum(creditRows,movementAmount);
    const balance=income-expenses;
    const expenseByCat=aggregate(expenseRows,r=>pick(r,['Categoría','Categoria'])||'Sin categoría',movementAmount);
    const creditByCard=aggregate(creditRows,r=>pick(r,['Cuenta / Tarjeta'])||'Sin tarjeta',movementAmount);
    const incomeEntries=[
      ['Nómina COP',copToDisplay(incomeParts.salaryCop)],
      ['Fibrazo LLC',copToDisplay(incomeParts.llc)],
      ['Otros ingresos',copToDisplay(incomeParts.other)]
    ];

    const yearSet=new Set();
    incomeRows.forEach(r=>{const d=rowDate(r);if(d)yearSet.add(d.getFullYear())});
    expenseRows.forEach(r=>{const d=movementDate(r);if(d)yearSet.add(d.getFullYear())});
    const years=[...yearSet].sort((a,b)=>b-a);
    const yearTable=years.map(year=>{
      const incRows=incomeRows.filter(r=>rowDate(r)?.getFullYear()===year);
      const expRows=expenseRows.filter(r=>movementDate(r)?.getFullYear()===year);
      const crRows=creditRows.filter(r=>movementDate(r)?.getFullYear()===year);
      const parts=incomeConceptTotals(incRows),inc=copToDisplay(parts.total),exp=sum(expRows,movementAmount),cr=sum(crRows,movementAmount);
      return{year,parts,inc,exp,cr,balance:inc-exp};
    });

    return`${sectionHead('FINANZAS','Resumen financiero','Ingresos, gastos, uso de crédito y evolución histórica en una sola pantalla')}
      <div class="kpi-grid">
        ${kpi('Ingresos totales',money(income),`${incomeRows.length} períodos con ingresos`,'green')}
        ${kpi('Gastos totales',money(expenses),`${expenseRows.length} movimientos`)}
        ${kpi('Gastos con crédito',money(credit),expenses?`${formatNumber(credit/expenses*100,1)}% de los gastos`:'—','gold')}
        ${kpi('Balance ingreso - gasto',money(balance),'Antes de inversiones',balance>=0?'blue':'red')}
      </div>
      <div class="financial-summary-breakdowns">
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Ingresos desagregados</strong><span>Composición del período seleccionado</span></div></div>${breakdownRows(incomeEntries,income)}</div>
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Gastos desagregados</strong><span>Por categoría</span></div></div>${breakdownRows(expenseByCat,expenses)}</div>
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Crédito desagregado</strong><span>Por tarjeta / cuenta</span></div></div>${breakdownRows(creditByCard,credit)}</div>
      </div>
      ${chartPanel('Evolución financiera','Ingresos, gastos, crédito y balance por mes','financialSummaryChart',Math.max(760,12*90))}
      <div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>Resumen por año</strong><span>Totales del período filtrado agrupados por año</span></div></div><div class="table-scroll expanded"><table><thead><tr><th>Año</th><th>Nómina COP</th><th>Fibrazo LLC</th><th>Otros ingresos</th><th>Ingresos totales</th><th>Gastos totales</th><th>Gasto con crédito</th><th>Balance</th></tr></thead><tbody>${yearTable.map(x=>`<tr><td><strong>${x.year}</strong></td><td>${summaryMoneyCop(x.parts.salaryCop)}</td><td>${summaryMoneyCop(x.parts.llc)}</td><td>${summaryMoneyCop(x.parts.other)}</td><td><strong>${money(x.inc)}</strong></td><td>${money(x.exp)}</td><td>${money(x.cr)}</td><td class="${x.balance>=0?'positive':'negative'}"><strong>${money(x.balance)}</strong></td></tr>`).join('')}</tbody></table></div></div>`;
  }

  function renderGastos() {const rows=filteredMovements().filter(isExpense);return `${sectionHead('FINANZAS','Detalle de gastos','Histórico de consumos, comparación y base detallada')}${chartPanel('Evolución de gastos','Series por categoría / selección','spendChart',Math.max(760,periodCount(rows)*100))}<div class="panel table-panel" hidden><div class="panel-header"><div class="panel-title"><strong>Movimientos</strong><span>Base sustituida por la tabla avanzada</span></div></div></div>`;}
  function renderFlujo() {const rows=filterByPeriod(state.data.ahorro?.length?state.data.ahorro:state.data.flujo);const allRows=state.data.ahorro?.length?state.data.ahorro:state.data.flujo;const display=rows.length?rows:latestPeriodRows(allRows);const last=display[display.length-1]||{};return `${sectionHead('FINANZAS','Flujo mensual','Ingresos, egresos, ahorro y cumplimiento de metas')}<div class="kpi-grid">${kpi('Ingresos',money(num(pick(last,['Ingresos reales COP','Ingresos COP','Ingresos']))),'Último período visible','green')}${kpi('Egresos',money(num(pick(last,['Egresos reales COP','Egresos COP','Egresos']))),'Último período visible')}${kpi('Ahorro',money(num(pick(last,['Ahorro real COP','Ahorro COP','Ahorro']))),'Resultado del período','blue')}${kpi('Tasa de ahorro',pick(last,['Tasa de ahorro real','Tasa de ahorro','% ahorro'])||'—','Objetivo vs realidad','gold')}</div>${chartPanel('Evolución mensual','Ingresos vs egresos vs ahorro','flowChart',Math.max(760,display.length*105))}${tablePanel('Flujo y ahorro mensual',display)}`;}
  function renderTarjetas() {const rows=state.data.tarjetas||[];const used=sum(rows,r=>num(pick(r,['Cupo usado','Utilizado','Saldo usado'])));const total=sum(rows,r=>num(pick(r,['Cupo total actual','Cupo total','Límite','Limite','Cupo'])));return `${sectionHead('FINANZAS','Tarjetas de crédito','Uso, cupo, facturación, pagos y nivel de utilización')}<div class="kpi-grid">${kpi('Cupo total',money(total),`${rows.length} tarjetas`)}${kpi('Cupo usado',money(used),total?`${formatNumber(used/total*100,1)}% consolidado`:'—','gold')}${kpi('Disponible',money(Math.max(0,total-used)),'Cupo consolidado','green')}${kpi('Pago próximo',money(sum(rows,r=>num(pick(r,['Pago total próximo','Pago mínimo próximo'])))),'Suma registrada')}</div>${creditSpendPanel(rows)}<div class="credit-grid">${rows.length?rows.map(creditCard).join(''):empty('No hay tarjetas registradas')}</div>${chartPanel('Uso por tarjeta','Cupo usado vs disponible','cardsChart',760,true)}${tablePanel('Detalle de tarjetas',rows,['Emisor','Producto','Titular','Moneda','Cupo total actual','Cupo usado','Cupo disponible','% utilización','Día corte','Día vencimiento','Pago mínimo próximo','Pago total próximo','Fecha actualización','Observaciones','Límite personal de gasto','% uso límite personal'])}`;}
  function canonicalDebtPurchases(rows) {
    const groups = new Map();
    (rows || []).forEach(row => {
      const id = pick(row,['ID compra']) || [pick(row,['Fecha compra']),pick(row,['Tarjeta']),pick(row,['Descripción','Comercio']),pick(row,['Total compra'])].join('|');
      if (!groups.has(id)) groups.set(id,[]);
      groups.get(id).push(row);
    });
    return [...groups.entries()].map(([id,group]) => {
      const ordered = group.slice().sort((a,b)=>num(pick(a,['Cuota actual']))-num(pick(b,['Cuota actual'])));
      const pendingRows = ordered.filter(row => {
        const detail = norm(pick(row,['Estado detalle']));
        const status = norm(pick(row,['Estado']));
        return !(detail.includes('pagad') || status.includes('pagad'));
      });
      const current = pendingRows[0] || null;
      const outstanding = current ? num(pick(current,['Valor cuota','Cuota'])) + num(pick(current,['Saldo pendiente','Saldo','Valor pendiente'])) : 0;
      return {
        id,
        rows: ordered,
        pendingRows,
        current,
        outstanding,
        installment: current ? num(pick(current,['Valor cuota','Cuota'])) : 0,
        interest: current ? num(pick(current,['Intereses'])) : 0,
        label: pick(ordered[0]||{},['Descripción','Comercio']) || id
      };
    }).filter(group => group.current && group.outstanding > 0);
  }
  function debtPurchaseCards(purchases){
    if(!purchases.length)return empty('No hay compras financiadas pendientes');
    return purchases.map(p=>{
      const row=p.current||p.rows?.[0]||{},first=p.rows?.[0]||row,total=num(pick(first,['Total compra'])),paid=Math.max(0,total-p.outstanding),progress=total?Math.max(0,Math.min(100,paid/total*100)):0;
      const detail=norm(pick(row,['Estado detalle'])),scheduled=detail.includes('programad');
      const next=money(p.installment),remaining=money(p.outstanding);
      return `<div class="debt-active-card"><div class="debt-active-head"><div><strong>${esc(p.label)}</strong><small>${esc([pick(first,['Tarjeta']),pick(first,['Titular'])].filter(Boolean).join(' · '))}</small></div><span class="badge ${scheduled?'':'warn'}">${scheduled?'Próxima cuota':'Por pagar'}</span></div><div class="debt-active-values"><div><span>Saldo pendiente</span><strong>${remaining}</strong></div><div><span>${scheduled?'Próxima cuota':'Cuota exigible'}</span><strong>${next}</strong></div></div><div class="debt-progress"><span style="width:${progress}%"></span></div><small class="debt-active-meta">Pagado aprox. ${formatNumber(progress,1)}% del principal · cuota ${esc(pick(row,['Cuota actual'])||'—')} de ${esc(pick(first,['N° cuotas'])||'—')}</small></div>`;
    }).join('');
  }
  function renderDeudas() {const purchases=canonicalDebtPurchases(state.data.cuotas||[]);const rows=purchases.flatMap(p=>p.pendingRows);const pending=sum(purchases,p=>p.outstanding);const installment=sum(purchases,p=>p.installment);const interest=sum(purchases,p=>p.interest);const chart=`<div class="panel debt-chart-panel"><div class="panel-header"><div class="panel-title"><strong>Saldo pendiente por compra</strong><span>Principal aún no pagado · máximo 12 compras</span></div></div>${chartShell('debtChart',Math.max(620,purchases.length*150))}</div>`;return `${sectionHead('FINANZAS','Deudas y cuotas','Principal financiado pendiente, próximas cuotas y avance por compra')}<div class="kpi-grid">${kpi('Saldo financiado pendiente',money(pending),`${purchases.length} compras activas`,'gold')}${kpi('Próximas cuotas',money(installment),'Primera cuota aún no pagada por compra')}${kpi('Intereses próximos',money(interest),'Solo intereses registrados','red')}${kpi('Compras activas',String(purchases.length),'Con principal pendiente')}</div><div class="debt-overview-grid">${chart}<div class="panel debt-active-panel"><div class="panel-header"><div class="panel-title"><strong>Detalle rápido</strong><span>Saldo y próxima cuota por compra</span></div></div><div class="debt-active-list">${debtPurchaseCards(purchases)}</div></div></div>${tablePanel('Cuotas pendientes',rows,['Fecha compra','Comercio','Descripción','Tarjeta','Titular','Total compra','N° cuotas','Cuota actual','Valor cuota','Saldo pendiente','Intereses','Fecha última cuota','Estado','Estado detalle'])}`;}
  function renderInversiones() {return sectionHead('FINANZAS','Inversiones','Posiciones, plataformas y composición del portafolio');}
  function renderPension() {const all=state.data.pension||[];const rows=filterByPeriod(all);const display=rows.length?rows:all;const last=display[display.length-1]||{};return `${sectionHead('FINANZAS','Pensión y cesantías','Aportes, rendimientos, cesantías y patrimonio')}<div class="kpi-grid">${kpi('Pensión',money(num(pick(last,['Total pensión COP','Total pensión','Pensión']))),'Último registro','blue')}${kpi('Cesantías',money(num(pick(last,['Total cesantías COP','Total cesantías','Cesantías']))),'Último registro','gold')}${kpi('Patrimonio',money(num(pick(last,['Patrimonio total COP','Patrimonio total','Total']))),'Pensión + cesantías','green')}${kpi('Variación',money(num(pick(last,['Variación total COP','Variación total']))),'Último cambio')}</div>${chartPanel('Evolución patrimonial','Pensión, cesantías y total','pensionChart',Math.max(760,display.length*95))}${tablePanel('Histórico de pensión y cesantías',display)}`;}
  function renderIngresos() {const incomeRows=filterByPeriod(state.data.ingresos||[]);const flowRows=filterByPeriod(state.data.ahorro||[]);const rows=incomeRows.length?incomeRows:state.data.ingresos||[];const flow=flowRows.length?flowRows:state.data.ahorro||[];const last=flow[flow.length-1]||{};const income=rows.reduce((a,r)=>a+incomeAmount(r),0);return `${sectionHead('FINANZAS','Ingresos y ahorro','Evolución de ingresos, ahorro y cumplimiento de la meta')}<div class="kpi-grid">${kpi('Ingresos',money(income),`${rows.length} períodos`,'green')}${kpi('Ahorro acumulado',money(num(pick(last,['Ahorro acumulado COP','Ahorro acumulado']))),'Último período','blue')}${kpi('Tasa de ahorro',pick(last,['Tasa de ahorro real','Tasa de ahorro'])||'—','Último período','gold')}${kpi('Cumplimiento',pick(last,['Cumplimiento de meta'])||'—','Meta de ahorro')}</div>${chartPanel('Ingresos y ahorro','Histórico disponible','incomeChart',Math.max(760,Math.max(rows.length,flow.length)*95))}${tablePanel('Resumen de ingresos',rows)}${tablePanel('Plan de ahorro',flow)}`;}
  function serviceReferenceField(label,value,wide=false){
    const text=String(value??'').trim();
    if(!text)return'';
    return `<div class="service-reference-field ${wide?'wide':''}"><div><span>${esc(label)}</span><strong class="service-copy-value" data-copy-value="${esc(text)}" role="button" tabindex="0" title="Presiona para copiar" aria-label="Copiar ${esc(label)}: ${esc(text)}">${esc(text)}</strong></div></div>`;
  }

  function serviceReferenceCards(rows){
    if(!rows?.length)return'';
    return `<div class="service-reference-grid">${rows.filter(r=>!pick(r,['Estado'])||norm(pick(r,['Estado'])).includes('activ')).map(r=>{
      const maps=pick(r,['Google Maps']),photo=pick(r,['Foto URL']),address=pick(r,['Dirección']),coords=pick(r,['Coordenadas']);
      return `<article class="service-reference-card">
        <div class="service-reference-head"><div><span>${esc(pick(r,['Tipo referencia'])||'Referencia')}</span><strong>${esc(pick(r,['Nombre'])||'Ubicación')}</strong></div><span class="badge">Actual</span></div>
        <div class="service-reference-fields">
          ${serviceReferenceField('Ciudad',pick(r,['Ciudad']))}
          ${serviceReferenceField('Barrio',pick(r,['Barrio']))}
          ${serviceReferenceField('Código postal',pick(r,['Código postal']))}
          ${serviceReferenceField('Dirección',address,true)}
          ${serviceReferenceField('Coordenadas',coords)}
          ${serviceReferenceField('Referencia',pick(r,['Referencia']),true)}
          ${serviceReferenceField('Link Google Maps',maps)}
        </div>
        <div class="service-reference-actions">
          ${maps?`<a class="button secondary" href="${esc(maps)}" target="_blank" rel="noopener noreferrer">Abrir en Maps</a>`:''}
          ${photo?`<a class="button secondary" href="${esc(photo)}" target="_blank" rel="noopener noreferrer">Ver foto</a>`:''}
        </div>
      </article>`;
    }).join('')}</div>`;
  }
  function renderServicios() {const all=state.data.servicios||[];const rows=filterByPeriod(all);const display=rows.length?rows:all;const paid=display.filter(r=>norm(pick(r,['Estado mes','Estado'])).includes('pagad'));const pending=display.filter(r=>norm(pick(r,['Estado mes','Estado'])).includes('pend'));const references=state.data.referenciasPersonales||[];return `${sectionHead('FINANZAS','Servicios y referencias','Pagos mensuales, vencimientos y datos de referencia')}<div class="kpi-grid">${kpi('Servicios',String(display.length),'Servicios registrados')}${kpi('Pagados',String(paid.length),'Mes visible','green')}${kpi('Pendientes',String(pending.length),'Mes visible','gold')}${kpi('Pagado mes',money(sum(display,r=>num(pick(r,['Pagado mes COP','Monto COP','Valor'])))),'Total registrado')}</div>${serviceReferenceCards(references)}${tablePanel('Servicios',display,['Estado mes','Servicio','Tipo de servicio','Tipo de referencia','Número de referencia','Banco','Tipo de cuenta','Número de cuenta','Dirección / ubicación','Día de pago','Mes control','Pagado mes COP','Próximo vencimiento','Observaciones'])}${tablePanel('Cuentas y plataformas',state.data.cuentas||[])}`;}
  function renderSalud() {const d=state.data;const citas=filterByPeriod(d.citas||[]);const estudios=filterByPeriod(d.estudios||[]);const events=filterByPeriod(d.eventosSalud||[]);const studiesDisplay=estudios.length?estudios:latestN(d.estudios||[],12);return `${sectionHead('SALUD','Resumen de salud','Pacientes, eventos, estudios, mediciones y tratamientos')}<div class="kpi-grid">${kpi('Pacientes',String((d.pacientes||[]).length),'Perfiles registrados')}${kpi('Citas',String(citas.length),'Período seleccionado')}${kpi('Tratamientos activos',String((d.tratamientos||[]).filter(isActiveTreatment).length),'En seguimiento','green')}${kpi('Estudios',String((d.estudios||[]).length),'Histórico consolidado','blue')}</div><div class="panel-grid equal">${chartPanel('Estudios por área','Distribución del historial','healthAreaChart',760)}${chartPanel('Evolución de mediciones','Valores numéricos por fecha','measurementsChart',Math.max(760,(d.mediciones||[]).length*90))}</div><div class="panel-grid equal"><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Pacientes</strong><span>Personas y mascotas</span></div></div><div class="card-list">${patientCards(d.pacientes||[])}</div></div><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Últimos estudios</strong><span>Resultados disponibles</span></div></div><div class="card-list">${studyCards(studiesDisplay.slice(0,7))}</div></div></div>${tablePanel('Eventos de salud',events.length?events:(d.eventosSalud||[]),['Paciente','Fecha inicio','Tipo evento','Especialidad / Área','Motivo / Síntoma','Diagnóstico / Impresión','Tratamiento asociado','Estado','Severidad','Evolución','Documento'])}${tablePanel('Estudios y resultados',studiesDisplay,['Paciente','Fecha','Tipo de estudio','Área','Institución','Motivo','Resultado / Conclusión','Hallazgos clave','Estado','Documento'])}`;}
  function renderCitas() {const all=state.data.citas||[];const rows=filterByPeriod(all);const display=rows.length?rows:all;const upcoming=display.filter(r=>{const d=rowDate(r);return d&&d.getTime()>=startOfToday().getTime();});return `${sectionHead('SALUD','Citas médicas','Histórico, próximas citas y especialidades')}<div class="kpi-grid">${kpi('Citas visibles',String(display.length),'Registros')}${kpi('Próximas',String(upcoming.length),'Desde hoy','green')}${kpi('Especialidades',String(unique(display.map(r=>pick(r,['Especialidad/Servicio','Especialidad','Servicio'])).filter(Boolean)).length),'Diferentes')}${kpi('Centros',String(unique(display.map(r=>pick(r,['Centro','Institución'])).filter(Boolean)).length),'Prestadores')}</div>${chartPanel('Citas por especialidad','Cantidad de citas registradas','appointmentsChart',Math.max(760,display.length*70))}${tablePanel('Citas médicas',display,['Paciente','Fecha','Hora','Especialidad/Servicio','Centro','Dirección','Estado','Fuente','Enlace correo','Observaciones'])}`;}
  function renderTratamientos() {const all=state.data.tratamientos||[];const rows=filterByPeriod(all);const display=rows.length?rows:all;const active=display.filter(isActiveTreatment);return `${sectionHead('SALUD','Tratamientos','Medicamentos, intervenciones, estado y seguimiento')}<div class="kpi-grid">${kpi('Tratamientos',String(display.length),'Registros visibles')}${kpi('Activos',String(active.length),'En curso / seguimiento','green')}${kpi('Áreas',String(unique(display.map(r=>pick(r,['Área','Especialidad'])).filter(Boolean)).length),'Especialidades')}${kpi('Pacientes',String(unique(display.map(r=>pick(r,['Paciente'])).filter(Boolean)).length),'Con tratamiento')}</div>${chartPanel('Tratamientos por área','Distribución del historial','treatmentsChart',760)}${tablePanel('Tratamientos',display,['Paciente','Área','Medicamento / Intervención','Presentación','Dosis','Unidad dosis','Frecuencia','Vía','Fecha inicio','Fecha fin prevista','Fecha fin real','Indicación','Estado','Respuesta / Cambios','Profesional','Documento','Observaciones'])}`;}
  function renderDocumentos() {return `${sectionHead('VIDA','Documentos','Índice documental, datos copiables y control de vigencias')}<div id="documentsMasterHost"></div>`;}
  function renderViajes() {const rows=state.data.viajes||[];const filtered=filterByPeriod(rows);const display=filtered.length?filtered:rows;const days=sum(display,r=>num(pick(r,['Días calendario','Días','Duración'])));return `${sectionHead('VIDA','Vacaciones y viajes','Histórico de vacaciones, desplazamientos y financiación')}<div class="kpi-grid">${kpi('Registros',String(display.length),'Viajes y vacaciones')}${kpi('Días calendario',formatNumber(days,0),'Total registrado')}${kpi('Destinos',String(unique(display.map(r=>pick(r,['Destino'])).filter(Boolean)).length),'Diferentes')}${kpi('Vacaciones',String(display.filter(r=>norm(pick(r,['Tipo de registro'])).includes('vacacion')).length),'Registros de vacaciones','gold')}</div>${chartPanel('Duración por viaje','Días calendario registrados','travelChart',Math.max(760,display.length*95))}${tablePanel('Vacaciones y viajes',display,['Tipo de registro','Titular/Pasajero','Financiación','Origen','Destino','Fecha salida','Fecha regreso','Días calendario','Días hábiles','Período laboral','Estado','Fuente','Observaciones'])}`;}

  function chartPanel(title,subtitle,id,width=760,hidden=false) {return `<div class="panel"${hidden?' hidden':''}><div class="panel-header"><div class="panel-title"><strong>${esc(title)}</strong><span>${esc(subtitle)}</span></div></div>${chartShell(id,width)}</div>`;}
  function drawViewCharts() {try{const map={general:drawGeneralCharts,resumen:drawFinancialSummaryChart,gastos:drawSpendChart,flujo:drawFlowChart,tarjetas:drawCardsChart,deudas:drawDebtChart,pension:drawPensionChart,ingresos:drawIncomeChart,salud:drawHealthCharts,citas:drawAppointmentsChart,tratamientos:drawTreatmentsChart,viajes:drawTravelChart};map[state.view]?.();}catch(error){console.error('Error dibujando gráficos:',error);}}
  function drawGeneralCharts(){const rows=filteredMovements().filter(isExpense);const daily=aggregate(rows,r=>{const d=movementDate(r);return d?`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`:'Sin fecha';},movementAmount);makeBar('generalDailyChart',[...daily.keys()],[{label:`Gasto ${state.currency}`,data:[...daily.values()]}]);const cats=[...aggregate(rows,r=>pick(r,['Categoría','Categoria'])||'Sin categoría',movementAmount).entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);makeBar('generalCategoryChart',cats.map(x=>x[0]),[{label:`Total ${state.currency}`,data:cats.map(x=>x[1])}],true);}
  function drawFinancialSummaryChart(){
    const incomeRows=filterByPeriod(state.data.ingresosConceptos||[]);
    const expenseRows=filteredMovements().filter(registeredExpense);
    const creditRows=expenseRows.filter(isCreditPurchase);
    const periods=unique([
      ...incomeRows.map(r=>periodKey(rowDate(r))).filter(Boolean),
      ...expenseRows.map(r=>periodKey(movementDate(r))).filter(Boolean)
    ]).sort();
    const incomeData=periods.map(p=>copToDisplay(sum(incomeRows.filter(r=>periodKey(rowDate(r))===p),r=>num(pick(r,['Total consolidado'])))));
    const expenseData=periods.map(p=>sum(expenseRows.filter(r=>periodKey(movementDate(r))===p),movementAmount));
    const creditData=periods.map(p=>sum(creditRows.filter(r=>periodKey(movementDate(r))===p),movementAmount));
    const balanceData=periods.map((p,i)=>incomeData[i]-expenseData[i]);
    makeLine('financialSummaryChart',periods.map(prettyPeriod),[
      ds('Ingresos',incomeData,2),
      ds('Gastos',expenseData,3),
      ds('Crédito',creditData,1),
      ds('Balance',balanceData,0)
    ]);
  }
  function drawSpendChart(){const rows=filteredMovements().filter(isExpense);const groupKey=state.filters.subcategory.length?r=>pick(r,['Subcategoría','Subcategoria'])||'Sin subcategoría':r=>pick(r,['Categoría','Categoria'])||'Total';const periods=unique(rows.map(r=>periodKey(movementDate(r))).filter(Boolean)).sort();const series=unique(rows.map(groupKey).filter(Boolean)).slice(0,10);const datasets=series.map((s,i)=>({label:s,data:periods.map(p=>sum(rows.filter(r=>periodKey(movementDate(r))===p&&groupKey(r)===s),movementAmount)),borderColor:COLORS[i%COLORS.length],backgroundColor:COLORS[i%COLORS.length],borderWidth:2,tension:.25}));if(datasets.length>1)datasets.push({label:'Total seleccionado',data:periods.map(p=>sum(rows.filter(r=>periodKey(movementDate(r))===p),movementAmount)),borderColor:'#f6f8fb',backgroundColor:'#f6f8fb',borderWidth:2,borderDash:[5,4],tension:.25});makeLine('spendChart',periods.map(prettyPeriod),datasets);}
  function drawFlowChart(){const rows0=filterByPeriod(state.data.ahorro?.length?state.data.ahorro:state.data.flujo);const rows=rows0.length?rows0:(state.data.ahorro?.length?state.data.ahorro:state.data.flujo);makeLine('flowChart',rows.map(r=>pick(r,['Mes','Periodo','Período','Fecha'])||''),[ds('Ingresos',rows.map(r=>num(pick(r,['Ingresos reales COP','Ingresos COP','Ingresos']))),0),ds('Egresos',rows.map(r=>num(pick(r,['Egresos reales COP','Egresos COP','Egresos']))),3),ds('Ahorro',rows.map(r=>num(pick(r,['Ahorro real COP','Ahorro COP','Ahorro']))),2)]);}
  function drawCardsChart(){const rows=state.data.tarjetas||[];const labels=rows.map(r=>`${pick(r,['Emisor'])||'Tarjeta'} ${pick(r,['Titular'])||''}`.trim());makeBar('cardsChart',labels,[{label:'Usado',data:rows.map(r=>num(pick(r,['Cupo usado']))),backgroundColor:COLORS[0]},{label:'Disponible',data:rows.map(r=>num(pick(r,['Cupo disponible']))),backgroundColor:COLORS[2]}],true);}
  function drawDebtChart(){const canvas=byId('debtChart');if(!canvas||!window.Chart)return;const purchases=canonicalDebtPurchases(state.data.cuotas||[]).sort((a,b)=>b.outstanding-a.outstanding).slice(0,12);const chart=new Chart(canvas,{type:'bar',data:{labels:purchases.map(p=>p.label),datasets:[{label:'Principal pendiente',data:purchases.map(p=>p.outstanding),backgroundColor:COLORS[1],borderRadius:5,barThickness:purchases.length<=4?18:14}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',interaction:{mode:'nearest',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`Saldo pendiente: ${money(ctx.parsed.x)}`}}},scales:{x:{beginAtZero:true,ticks:{color:'#718098',callback:v=>shortMoney(v),maxTicksLimit:6},grid:{color:'#121c29'}},y:{ticks:{color:'#b8c5d6',font:{size:10},autoSkip:false},grid:{display:false}}}}});state.charts.push(chart);}
  function drawPensionChart(){const rows0=filterByPeriod(state.data.pension||[]);const rows=rows0.length?rows0:(state.data.pension||[]);makeLine('pensionChart',rows.map(r=>pick(r,['Fecha','Mes'])||''),[ds('Pensión',rows.map(r=>num(pick(r,['Total pensión COP','Total pensión']))),0),ds('Cesantías',rows.map(r=>num(pick(r,['Total cesantías COP','Total cesantías']))),1),ds('Patrimonio',rows.map(r=>num(pick(r,['Patrimonio total COP','Patrimonio total']))),2)]);}
  function drawIncomeChart(){const flow0=filterByPeriod(state.data.ahorro||[]);const flow=flow0.length?flow0:(state.data.ahorro||[]);makeLine('incomeChart',flow.map(r=>pick(r,['Mes','Periodo','Período'])||''),[ds('Ingresos',flow.map(r=>num(pick(r,['Ingresos reales COP','Ingresos COP']))),2),ds('Ahorro',flow.map(r=>num(pick(r,['Ahorro real COP','Ahorro COP']))),0),ds('Meta',flow.map(r=>num(pick(r,['Meta mensual COP','Meta de ahorro']))),1)]);}
  function drawServicesChart(){const rows0=filterByPeriod(state.data.servicios||[]);const rows=rows0.length?rows0:(state.data.servicios||[]);makeBar('servicesChart',rows.map(r=>pick(r,['Servicio'])||'Servicio'),[{label:'Pagado mes COP',data:rows.map(r=>num(pick(r,['Pagado mes COP']))),backgroundColor:COLORS[0]}],true);}
  function drawHealthCharts(){const studies=state.data.estudios||[];const byArea=[...aggregate(studies,r=>pick(r,['Área'])||'Sin área',()=>1).entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);makeBar('healthAreaChart',byArea.map(x=>x[0]),[{label:'Estudios',data:byArea.map(x=>x[1]),backgroundColor:COLORS[0]}],true);const measurements=(state.data.mediciones||[]).filter(r=>Number.isFinite(parseNumericMaybe(pick(r,['Valor']))));const grouped=new Map();measurements.forEach(r=>{const name=pick(r,['Medición / Analito','Medición','Analito'])||'Medición';if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push(r);});const labels=unique(measurements.map(r=>dateLabel(rowDate(r))).filter(Boolean)).sort();const datasets=[...grouped.entries()].slice(0,6).map(([name,rs],i)=>({label:name,data:labels.map(l=>{const hit=rs.find(r=>dateLabel(rowDate(r))===l);return hit?num(pick(hit,['Valor'])):null;}),borderColor:COLORS[i],backgroundColor:COLORS[i],borderWidth:2,tension:.25,spanGaps:true}));makeLine('measurementsChart',labels,datasets);}
  function drawAppointmentsChart(){const rows0=filterByPeriod(state.data.citas||[]);const rows=rows0.length?rows0:(state.data.citas||[]);const agg=[...aggregate(rows,r=>pick(r,['Especialidad/Servicio','Especialidad','Servicio'])||'Sin especialidad',()=>1).entries()].sort((a,b)=>b[1]-a[1]).slice(0,14);makeBar('appointmentsChart',agg.map(x=>x[0]),[{label:'Citas',data:agg.map(x=>x[1]),backgroundColor:COLORS[0]}],true);}
  function drawTreatmentsChart(){const rows=state.data.tratamientos||[];const agg=[...aggregate(rows,r=>pick(r,['Área'])||'Sin área',()=>1).entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);makeBar('treatmentsChart',agg.map(x=>x[0]),[{label:'Tratamientos',data:agg.map(x=>x[1]),backgroundColor:COLORS[2]}],true);}
  function drawDocumentsChart(){const rows=state.data.documentos||[];const agg=[...aggregate(rows,r=>pick(r,['Área','Tipo','Categoría','Producto'])||'Otros',()=>1).entries()].sort((a,b)=>b[1]-a[1]).slice(0,14);makeBar('documentsChart',agg.map(x=>x[0]),[{label:'Documentos',data:agg.map(x=>x[1]),backgroundColor:COLORS[0]}],true);}
  function drawTravelChart(){const rows=state.data.viajes||[];makeBar('travelChart',rows.map(r=>`${pick(r,['Destino'])||'Viaje'} · ${pick(r,['Fecha salida'])||''}`),[{label:'Días calendario',data:rows.map(r=>num(pick(r,['Días calendario','Días']))),backgroundColor:COLORS[1]}],true);}
  function makeLine(id,labels,datasets){const canvas=byId(id);if(!canvas||!window.Chart)return;const chart=new Chart(canvas,{type:'line',data:{labels,datasets},options:chartOptions(false)});state.charts.push(chart);scrollChartEnd(canvas);}
  function makeBar(id,labels,datasets,horizontal=false){const canvas=byId(id);if(!canvas||!window.Chart)return;const chart=new Chart(canvas,{type:'bar',data:{labels,datasets},options:chartOptions(horizontal)});state.charts.push(chart);scrollChartEnd(canvas);}
  function chartOptions(horizontal=false){return{responsive:true,maintainAspectRatio:false,indexAxis:horizontal?'y':'x',interaction:{mode:'nearest',intersect:false},plugins:{legend:{display:true,labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}},tooltip:{callbacks:{label:ctx=>{const v=horizontal?ctx.parsed.x:ctx.parsed.y;return`${ctx.dataset.label}: ${isMoneyDataset(ctx.dataset.label)?money(v):formatNumber(v,Number.isInteger(v)?0:1)}`;}}}},scales:{x:{ticks:{color:'#718098',maxRotation:0,autoSkip:true},grid:{color:'#121c29'}},y:{beginAtZero:true,ticks:{color:'#718098',callback:v=>horizontal?String(v):shortMoney(v)},grid:{color:'#121c29'}}}};}
  function isMoneyDataset(label){return/gasto|total|valor|saldo|ingreso|egreso|ahorro|pensión|pension|cesant|patrimonio|pagado|usado|disponible|meta/i.test(label||'');}
  function ds(label,data,colorIndex=0){return{label,data,borderColor:COLORS[colorIndex%COLORS.length],backgroundColor:COLORS[colorIndex%COLORS.length],borderWidth:2,tension:.25,spanGaps:true};}
  function scrollChartEnd(canvas){requestAnimationFrame(()=>{const scroller=canvas.closest('.chart-scroll');if(scroller)scroller.scrollLeft=scroller.scrollWidth;});}
  function chartShell(id,width=760){return`<div class="chart-scroll"><div class="chart-inner" style="width:${Math.max(760,width)}px;min-width:100%;height:330px"><canvas id="${id}"></canvas></div></div>`;}
  function tablePanel(title,rows,preferred=null){const safeRows=rows||[];if(!safeRows.length)return`<div class="panel">${empty('Sin información para mostrar')}</div>`;const id=`tbl-${hash(title)}`;let columns=(preferred||[]).filter(c=>safeRows.some(r=>Object.prototype.hasOwnProperty.call(r,c)));if(!columns.length)columns=tableColumns(safeRows);const q=norm(state.searches[id]||'');let filtered=q?safeRows.filter(r=>norm(columns.map(c=>r[c]).join(' ')).includes(q)):safeRows.slice();const sort=state.sorts[id];if(sort?.col)filtered.sort((a,b)=>compareCells(a[sort.col],b[sort.col])*(sort.dir==='desc'?-1:1));const expanded=state.expandedTables.has(id);const visible=expanded?filtered:filtered.slice(0,15);return`<div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>${esc(title)}</strong><span>${filtered.length} de ${safeRows.length} registros</span></div><div class="table-toolbar"><input class="search-input" data-search-table="${id}" placeholder="Buscar en la tabla…" value="${esc(state.searches[id]||'')}"></div></div><div class="table-scroll${expanded?' expanded':''}"><table id="${id}"><thead><tr>${columns.map(c=>`<th data-sort-table="${id}" data-sort-col="${esc(c)}">${esc(c)}${sort?.col===c?(sort.dir==='asc'?' ↑':' ↓'):''}</th>`).join('')}</tr></thead><tbody>${visible.map(r=>`<tr>${columns.map(c=>`<td>${formatCell(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${filtered.length>15?`<div class="table-footer"><span>${expanded?`Mostrando ${filtered.length}`:`Mostrando 15 de ${filtered.length}`}</span><button class="table-more" data-toggle-table="${id}">${expanded?'Ver menos':'Ver más'}</button></div>`:''}</div>`;}
  function bindDynamic(){
    document.querySelectorAll('[data-search-table]').forEach(input=>input.addEventListener('input',()=>{
      state.searches[input.dataset.searchTable]=input.value;
      render();
      const next=document.querySelector(`[data-search-table="${input.dataset.searchTable}"]`);
      next?.focus();next?.setSelectionRange(next.value.length,next.value.length);
    }));
    document.querySelectorAll('[data-toggle-table]').forEach(btn=>btn.addEventListener('click',()=>{
      const id=btn.dataset.toggleTable;
      if(state.expandedTables.has(id))state.expandedTables.delete(id);else state.expandedTables.add(id);
      render();
    }));
    document.querySelectorAll('[data-sort-table]').forEach(th=>th.addEventListener('click',()=>{
      const id=th.dataset.sortTable,col=th.dataset.sortCol,prev=state.sorts[id];
      state.sorts[id]={col,dir:prev?.col===col&&prev.dir==='asc'?'desc':'asc'};
      render();
    }));
    const copyValue=async el=>{
      const value=String(el.dataset.copyValue||'');
      if(!value)return;
      try{
        if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
        else {
          const area=document.createElement('textarea');
          area.value=value;area.style.position='fixed';area.style.opacity='0';
          document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();
        }
        el.classList.add('copied');
        el.setAttribute('title','Copiado');
        setTimeout(()=>{el.classList.remove('copied');el.setAttribute('title','Presiona para copiar');},1200);
      }catch(error){
        console.warn('No se pudo copiar el dato:',error);
      }
    };
    document.querySelectorAll('[data-copy-value]').forEach(el=>{
      el.addEventListener('click',()=>copyValue(el));
      el.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){
          event.preventDefault();
          copyValue(el);
        }
      });
    });
  }
  function filteredMovements(){return(state.data.movimientos||[]).filter(row=>{const d=movementDate(row);if(state.filters.year.length&&(!d||!state.filters.year.includes(String(d.getFullYear()))))return false;if(state.filters.month.length&&(!d||!state.filters.month.includes(String(d.getMonth()+1))))return false;const c=pick(row,['Categoría','Categoria']);const s=pick(row,['Subcategoría','Subcategoria']);const cur=String(pick(row,['Moneda original','Moneda'])).toUpperCase();if(state.filters.category.length&&!state.filters.category.includes(c))return false;if(state.filters.subcategory.length&&!state.filters.subcategory.includes(s))return false;if(state.filters.currency.length&&!state.filters.currency.includes(cur))return false;return true;});}
  function filterByPeriod(rows){return(rows||[]).filter(row=>{const d=rowDate(row);if(state.filters.year.length&&(!d||!state.filters.year.includes(String(d.getFullYear()))))return false;if(state.filters.month.length&&(!d||!state.filters.month.includes(String(d.getMonth()+1))))return false;return true;});}
  function latestPeriodRows(rows){if(!rows?.length)return[];const dated=rows.map(r=>({r,d:rowDate(r)})).filter(x=>x.d);if(!dated.length)return rows;const max=Math.max(...dated.map(x=>x.d.getTime()));const md=new Date(max);return dated.filter(x=>x.d.getFullYear()===md.getFullYear()&&x.d.getMonth()===md.getMonth()).map(x=>x.r);}
  function latestN(rows,n){return(rows||[]).slice().sort((a,b)=>rowDateValue(b)-rowDateValue(a)).slice(0,n);}
  function isExpense(row){const t=norm(pick(row,['Tipo','Naturaleza']));return!t||t.includes('gasto')||t.includes('egreso')||t.includes('compra');}
  function isFinanced(row){const a=norm(pick(row,['Cuenta / Tarjeta','Medio de Pago','Pago']));const q=num(pick(row,['Cuotas','N° cuotas','Numero cuotas']));return a.includes('credito')||a.includes('crédito')||a.includes('tarjeta')||a.includes('nu')||a.includes('arq')||q>1;}
  function isActiveTreatment(row){const s=norm(pick(row,['Estado']));return s.includes('activo')||s.includes('seguimiento')||s.includes('mantenimiento')||s.includes('curso');}
  function movementDate(row){return parseDate(pick(row,['Fecha real','Fecha registrada','Fecha','Mes consumo']));}
  function movementAmount(row){if(state.currency==='USD')return num(pick(row,['Monto USD','USD']));if(state.currency==='ARS')return num(pick(row,['Monto ARS','ARS']));return num(pick(row,['Monto COP','COP']));}
  function incomeAmount(row){if(state.currency==='USD')return num(pick(row,['Ingresos USD','USD','Ingreso USD']));if(state.currency==='ARS')return num(pick(row,['Ingresos ARS','ARS','Ingreso ARS']));return num(pick(row,['Ingresos COP','COP','Ingreso COP','Ingresos reales COP']));}
  function latestAhorroValue(){const rows=state.data.ahorro||[];const filtered=filterByPeriod(rows);const r=(filtered.length?filtered:rows).slice(-1)[0]||{};return num(pick(r,['Ahorro real COP','Ahorro COP','Ahorro']));}
  function rowDate(row){for(const key of ['Fecha','Fecha real','Fecha inicio','Fecha documento','Fecha corte','Fecha salida','Fecha Ida','Mes','Periodo','Período','Periodo/Fecha','Mes control','Fecha compra']){if(row?.[key]){const d=parseDate(row[key]);if(d)return d;}}const y=pick(row,['Año','Año gravable']),m=pick(row,['Mes']);if(y&&m){const d=parseDate(`${m} ${y}`);if(d)return d;}return null;}
  function rowDateValue(row){return rowDate(row)?.getTime()||0}function dateValue(row){return movementDate(row)?.getTime()||0}function periodKey(date){return date?`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`:''}function prettyPeriod(v){const m=String(v).match(/^(\d{4})-(\d{2})$/);return m?`${MONTH_LABELS[Number(m[2])-1]} ${m[1]}`:v}function dateLabel(d){return d?`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`:''}function dayCount(rows){return unique(rows.map(r=>dateLabel(movementDate(r))).filter(Boolean)).length}function periodCount(rows){return unique(rows.map(r=>periodKey(movementDate(r))).filter(Boolean)).length}
  function creditCard(row){const total=num(pick(row,['Cupo total actual','Cupo total','Límite','Limite','Cupo']));const used=num(pick(row,['Cupo usado','Utilizado','Saldo usado']));const available=num(pick(row,['Cupo disponible','Disponible']))||Math.max(0,total-used);let pct=num(pick(row,['% utilización','% uso límite personal','Utilización']));if(total&&(!pct||pct>10000))pct=used/total*100;const cls=pct>=85?'critical':pct>=70?'high':'';const period=pick(row,['Periodo de facturación','Período de facturación','Ciclo','Día corte']);const due=pick(row,['Fecha límite de pago','Fecha limite de pago','Día vencimiento','Fecha vencimiento']);return`<div class="credit-card"><div class="credit-top"><span class="credit-brand">${esc(`${pick(row,['Emisor'])||''} ${pick(row,['Producto'])||''}`.trim()||'Tarjeta')}</span><span class="credit-owner">${esc(pick(row,['Titular']))}</span></div><div class="credit-amount">${money(used)}</div><div class="credit-sub">Usado de ${money(total)} · Disponible ${money(available)}</div><div class="usage-track"><div class="usage-fill ${cls}" style="width:${Math.max(0,Math.min(100,pct))}%"></div></div><div class="credit-bottom"><div class="credit-stat"><span>Utilización</span><strong>${formatNumber(pct,1)}%</strong></div><div class="credit-stat"><span>Corte</span><strong>${esc(period||'—')}</strong></div><div class="credit-stat"><span>Pago</span><strong>${esc(due||'—')}</strong></div></div></div>`;}
  function patientCards(rows){if(!rows.length)return empty('Sin pacientes');return rows.map(r=>`<div class="list-card"><div><strong>${esc(pick(r,['Nombre','Paciente'])||'Paciente')}</strong><small>${esc([pick(r,['Tipo']),pick(r,['Relación','Relacion']),pick(r,['Raza'])].filter(Boolean).join(' · '))}</small></div></div>`).join('');}
  function studyCards(rows){if(!rows.length)return empty('Sin estudios');return rows.map(r=>`<div class="list-card"><div><strong>${esc(pick(r,['Tipo de estudio','Estudio','Tipo','Nombre'])||'Estudio')}</strong><small>${esc([pick(r,['Paciente']),pick(r,['Fecha']),pick(r,['Área'])].filter(Boolean).join(' · '))}</small></div><span class="badge">${esc(pick(r,['Estado'])||'')}</span></div>`).join('');}
  function latestMovementCards(rows){if(!rows.length)return empty('Sin movimientos');return rows.map(r=>`<div class="list-card"><div><strong>${esc(pick(r,['Descripción / Comercio','Descripción','Comercio'])||'Movimiento')}</strong><small>${esc([pick(r,['Fecha real','Fecha']),pick(r,['Categoría','Categoria'])].filter(Boolean).join(' · '))}</small></div><strong>${money(movementAmount(r))}</strong></div>`).join('');}
  function sectionHead(eye,title,sub){return`<div class="section-head"><div><span class="eyebrow">${esc(eye)}</span><h2>${esc(title)}</h2></div><p>${esc(sub||'')}</p></div>`}function kpi(label,value,meta,color=''){return`<div class="kpi-card"><span class="kpi-label">${esc(label)}</span><strong class="kpi-value ${esc(color)}">${esc(value)}</strong><div class="kpi-meta"><span>${esc(meta||'')}</span></div></div>`}function progress(label,value,max){const pct=max?Math.max(0,Math.min(100,value/max*100)):0;return`<div class="progress-row"><span class="progress-label">${esc(label)}</span><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><strong class="progress-value">${esc(money(value))}</strong></div>`}function empty(message='Sin información para mostrar'){return`<div class="empty-state"><div><strong>${esc(message)}</strong><span>Los datos aparecerán cuando estén disponibles para los filtros seleccionados.</span></div></div>`}
  function tableColumns(rows){const out=[],seen=new Set();rows.slice(0,50).forEach(r=>Object.keys(r||{}).forEach(k=>{if(k.trim()&&!seen.has(k)){seen.add(k);out.push(k)}}));return out.slice(0,18);}
  function formatCell(value){const s=String(value??'');if(/^https?:\/\//i.test(s))return`<a href="${esc(s)}" target="_blank" rel="noopener" class="blue">Abrir</a>`;if(/^abrir/i.test(s))return`<span class="blue">${esc(s)}</span>`;return esc(s);}
  function compareCells(a,b){const na=numMaybe(a),nb=numMaybe(b);if(na!==null&&nb!==null)return na-nb;const da=parseDate(a),db=parseDate(b);if(da&&db)return da-db;return String(a??'').localeCompare(String(b??''),'es',{numeric:true,sensitivity:'base'});}
  function sum(rows,fn){return(rows||[]).reduce((a,r)=>a+(Number(fn(r))||0),0)}function aggregate(rows,keyFn,valueFn){const m=new Map();(rows||[]).forEach(r=>{const k=keyFn(r);m.set(k,(m.get(k)||0)+(Number(valueFn(r))||0))});return m}function unique(v){return[...new Set(v)]}function pick(obj,keys){for(const k of keys){if(obj&&obj[k]!=null&&String(obj[k]).trim()!=='')return String(obj[k]).trim()}return''}function localeSort(a,b){return String(a).localeCompare(String(b),'es',{sensitivity:'base'})}function norm(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function byId(id){return document.getElementById(id)}function formatNumber(v,d=0){return new Intl.NumberFormat('es-CO',{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(v)||0)}
  function num(value){if(typeof value==='number')return Number.isFinite(value)?value:0;let s=String(value??'').trim();if(!s||/value|n\/a|----/i.test(s))return 0;s=s.replace(/[^\d,.\-]/g,'');if(!s)return 0;const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');if(comma>=0&&dot>=0){if(comma>dot)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(comma>=0){const parts=s.split(',');if(parts.length===2&&parts[1].length<=2)s=parts[0].replace(/\./g,'')+'.'+parts[1];else s=s.replace(/,/g,'');}else if(dot>=0){const parts=s.split('.');if(parts.length>2||(parts.length===2&&parts[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}
  function numMaybe(v){const s=String(v??'').trim();if(!s||!/\d/.test(s))return null;const n=num(s);return Number.isFinite(n)?n:null}function parseNumericMaybe(v){const n=numMaybe(v);return n===null?NaN:n}
  function parseDate(value){const s=String(value??'').trim();if(!s)return null;let m=s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);if(m)return validDate(+m[1],+m[2]-1,+(m[3]||1));m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return validDate(+m[3],+m[2]-1,+m[1]);m=norm(s).match(/^(\d{1,2})[-\s](ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)[-\s](\d{4})$/);if(m){const k=m[2]==='sep'?'sept':m[2];return validDate(+m[3],MONTHS.indexOf(k),+m[1])}m=norm(s).match(/^(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)[\s\-\/]+(\d{4})$/);if(m){const k=m[1]==='sep'?'sept':m[1];return validDate(+m[2],MONTHS.indexOf(k),1)}const d=new Date(s);return Number.isNaN(d.getTime())?null:d;}
  function validDate(y,m,d){if(m<0||m>11)return null;const x=new Date(y,m,d);return Number.isNaN(x.getTime())?null:x}function startOfToday(){const d=new Date();d.setHours(0,0,0,0);return d}
  function money(value){const digits=state.currency==='USD'?2:0;try{return new Intl.NumberFormat('es-CO',{style:'currency',currency:state.currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value)||0)}catch(_){return`${state.currency} ${formatNumber(value,digits)}`}}function shortMoney(value){const n=Number(value)||0,a=Math.abs(n);if(a>=1e9)return`${(n/1e9).toFixed(1)}B`;if(a>=1e6)return`${(n/1e6).toFixed(1)}M`;if(a>=1e3)return`${(n/1e3).toFixed(0)}K`;return String(Math.round(n))}function hash(v){let h=0;v=String(v);for(let i=0;i<v.length;i++)h=((h<<5)-h)+v.charCodeAt(i)|0;return Math.abs(h).toString(36)}function shortError(v){const s=String(v||'');return s.length>420?s.slice(0,420)+'…':s}
  function setSync(kind,text){const dot=byId('syncDot');if(dot)dot.className=`sync-dot${kind==='ok'?' ok':kind==='loading'?' loading':''}`;if(byId('syncText'))byId('syncText').textContent=text;}function destroyCharts(){state.charts.forEach(c=>{try{c.destroy()}catch(_){}});state.charts=[]}
  function emptyData(){return{movimientos:[],flujo:[],tarjetas:[],cuotas:[],inversiones:[],posiciones:[],pension:[],ingresos:[],ingresosConceptos:[],ahorro:[],configFinanzas:[],servicios:[],referenciasPersonales:[],cuentas:[],plan:[],patrimonio:[],docsFinancieros:[],docsIdentidad:[],docsLaborales:[],docsTributarios:[],docsPensionCesantias:[],docsPersonales:[],viajes:[],pacientes:[],citas:[],tratamientos:[],estudios:[],eventosSalud:[],mediciones:[],docsSalud:[],documentos:[]};}
  function showFatal(error){console.error('Panel Personal Edu: error de inicio',error);setSync('demo','Error de inicio');const root=byId('viewRoot');if(root)root.innerHTML=`<div class="panel"><div class="empty-state"><div><strong>No se pudo iniciar el dashboard</strong><span>${esc(error?.message||String(error))}</span></div></div></div>`;}
})();
