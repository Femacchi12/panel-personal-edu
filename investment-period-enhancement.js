(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  window.__PANEL_INVESTMENT_PERIOD_ENHANCED__ = true;

  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const COLORS = ['#1769ff','#26d07c','#f6c844','#ff667a','#8b5cf6','#22d3ee'];
  let frame=0,rendering=false,rerunRequested=false,pendingForce=false,requestVersion=0,charts=[];

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const currentCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';

  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const h=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));}
  function rowsFromPayload(payload,range){const cached=window.__PANEL_GET_CACHED_ROWS__;if(typeof cached==='function')return cached(payload,financeId,range);return parseRows(payload?.sources?.[`${financeId}|${range}`]||[]);}
  function parseNumber(value){if(typeof value==='number')return Number.isFinite(value)?value:0;let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=4?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}
  function parseDate(value){const s=String(value||'').trim();if(!s)return null;let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);const d=new Date(s);return Number.isNaN(d.getTime())?null:d;}
  function dateLabel(value){const d=value instanceof Date?value:parseDate(value);return d?`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`:'—';}
  function money(value,currency=currentCurrency()){const digits=currency==='USD'?2:0;return new Intl.NumberFormat('es-CO',{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value)||0);}

  function selectedGlobal(key){return[...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(el=>String(el.dataset.value||'').trim()).filter(Boolean);}
  function selectedLocal(key){return[...document.querySelectorAll(`.local-multi-filter[data-local-key="${key}"] .local-option.selected`)].map(el=>String(el.dataset.value||'').trim()).filter(Boolean);}

  function captureFilters(){
    return {
      years:selectedGlobal('year').map(Number).filter(Boolean),
      months:selectedGlobal('month').map(Number).filter(n=>n>=1&&n<=12),
      platforms:selectedLocal('invPlatform'),
      classes:new Set(selectedLocal('invClass')),
      categories:new Set(selectedLocal('invCategory')),
      subcategories:new Set(selectedLocal('invSubcategory')),
      mode:selectedLocal('investmentValueMode')[0]||'total'
    };
  }

  function forcePeriodFilters(){if(activeView()!=='inversiones')return;const bar=document.getElementById('filterBar');if(bar?.hidden)bar.hidden=false;document.querySelectorAll('#globalFilters .multi-filter').forEach(el=>{const hide=!['year','month'].includes(el.dataset.filter);if(el.hidden!==hide)el.hidden=hide;});}

  function periodBounds(state){const years=state.years,months=state.months;if(!years.length&&!months.length)return{start:null,end:null,label:'Todo el histórico'};const ys=years.length?years:[new Date().getFullYear()];let start,end;if(months.length){const dates=[];ys.forEach(y=>months.forEach(m=>dates.push(new Date(y,m-1,1))));dates.sort((a,b)=>a-b);start=dates[0];const last=dates.at(-1);end=new Date(last.getFullYear(),last.getMonth()+1,0,23,59,59,999);}else{start=new Date(Math.min(...ys),0,1);end=new Date(Math.max(...ys),11,31,23,59,59,999);}const label=years.length===1&&months.length===1?`${MONTHS[months[0]-1]} ${years[0]}`:years.length===1&&!months.length?String(years[0]):`${dateLabel(start)} – ${dateLabel(end)}`;return{start,end,label};}

  function applyLocalFilters(rows,state){
    return rows.filter(row=>{
      if(state.platforms.length&&!state.platforms.includes(String(row['Plataforma / Bróker']||'').trim()))return false;
      if(state.classes.size&&!state.classes.has(String(row['Clase de activo']||'').trim()))return false;
      if(state.categories.size&&!state.categories.has(String(row.Categoría||'').trim()))return false;
      if(state.subcategories.size&&!state.subcategories.has(String(row.Subcategoría||'').trim()))return false;
      return true;
    });
  }

  function latestPerPlatformAsOf(rows,end){
    const groups=new Map(),endTime=end?.getTime()??Infinity;
    rows.forEach(row=>{
      const d=parseDate(row.Fecha);if(!d)return;
      const time=d.getTime();if(time>endTime)return;
      const platform=String(row['Plataforma / Bróker']||'Sin plataforma').trim();
      const current=groups.get(platform);
      if(!current||time>current.time)groups.set(platform,{time,rows:[row]});
      else if(time===current.time)current.rows.push(row);
    });
    return [...groups.values()].flatMap(item=>item.rows);
  }

  function latestSummaryAsOf(rows,end){
    const groups=new Map(),endTime=end?.getTime()??Infinity;
    rows.forEach(row=>{
      const d=parseDate(row['Fecha corte']);if(!d)return;
      const time=d.getTime();if(time>endTime)return;
      const platform=String(row.Entidad||'Sin plataforma').trim();
      const current=groups.get(platform);
      if(!current||time>current.time)groups.set(platform,{time,row});
    });
    return [...groups.values()].map(item=>item.row);
  }

  function aggregate(rows,keyFn,valueFn){const map=new Map();rows.forEach(r=>{const k=keyFn(r);map.set(k,(map.get(k)||0)+(Number(valueFn(r))||0));});return map;}
  function investmentRates(){return{usdCop:Number(cfg?.regularIncome?.usdCopReference)||3150,usdArs:Number(cfg?.regularIncome?.usdArsReference)||1500};}
  function convertBase(value,base,currency,rates){const v=Number(value)||0;if(base===currency)return v;if(base==='USD'&&currency==='COP')return v*rates.usdCop;if(base==='USD'&&currency==='ARS')return v*rates.usdArs;if(base==='COP'&&currency==='USD')return v/rates.usdCop;if(base==='COP'&&currency==='ARS')return v/rates.usdCop*rates.usdArs;if(base==='ARS'&&currency==='USD')return v/rates.usdArs;if(base==='ARS'&&currency==='COP')return v/rates.usdArs*rates.usdCop;return v;}

  function summaryMatchesPlatform(row,state){if(!state.platforms.length)return true;const entity=norm(row.Entidad);return state.platforms.some(v=>norm(v).includes(entity)||entity.includes(norm(v).split('/')[0].trim()));}

  function buildTimeline(rows,currency,bounds){
    const pointMaps=new Map(),platforms=new Set(),allDates=new Set();
    let minAll=Infinity,maxAll=-Infinity,hasBeforeStart=false;
    const start=bounds.start?.getTime()??-Infinity,end=bounds.end?.getTime()??Infinity;
    rows.forEach(row=>{
      const d=parseDate(row.Fecha);if(!d)return;
      const time=d.getTime(),platform=String(row['Plataforma / Bróker']||'Sin plataforma').trim(),value=parseNumber(row[`Valor ${currency}`]);
      minAll=Math.min(minAll,time);maxAll=Math.max(maxAll,time);if(time<start)hasBeforeStart=true;
      platforms.add(platform);
      if(!pointMaps.has(platform))pointMaps.set(platform,new Map());
      const map=pointMaps.get(platform);map.set(time,(map.get(time)||0)+value);
      if(time>=start&&time<=end)allDates.add(time);
    });
    if(!Number.isFinite(minAll))return{labels:[],datasets:[]};
    const effectiveStart=bounds.start?.getTime()??minAll,effectiveEnd=bounds.end?.getTime()??maxAll;
    const dates=[...allDates].filter(t=>t>=effectiveStart&&t<=effectiveEnd).sort((a,b)=>a-b);
    if(bounds.start&&hasBeforeStart&&!dates.includes(effectiveStart))dates.unshift(effectiveStart);
    if(!dates.length)return{labels:[],datasets:[]};
    const platformList=[...platforms].sort((a,b)=>a.localeCompare(b,'es'));
    const platformSeries=new Map();
    platformList.forEach(platform=>{
      const points=[...(pointMaps.get(platform)||new Map()).entries()].sort((a,b)=>a[0]-b[0]);
      let pointer=0,current=null;
      const data=dates.map(target=>{
        while(pointer<points.length&&points[pointer][0]<=target){current=points[pointer][1];pointer++;}
        return current;
      });
      platformSeries.set(platform,data);
    });
    const datasets=[];
    if(platformList.length>1){
      datasets.push({label:'Portafolio consolidado',data:dates.map((_,i)=>platformList.reduce((sum,p)=>sum+(platformSeries.get(p)?.[i]||0),0)),borderColor:COLORS[0],backgroundColor:COLORS[0],borderWidth:3,tension:.22,spanGaps:true});
    }
    platformList.forEach((platform,i)=>datasets.push({label:platform,data:platformSeries.get(platform),borderColor:COLORS[(i+1)%COLORS.length],backgroundColor:COLORS[(i+1)%COLORS.length],borderWidth:2,tension:.22,spanGaps:true}));
    return{labels:dates.map(t=>dateLabel(new Date(t))),datasets};
  }

  async function getPayload(force=false){const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')throw new Error('Backend de datos no disponible');return getData(force);}
  function destroyCharts(){charts.forEach(c=>{try{c.destroy();}catch(_){}});charts=[];}
  function chartOptions(horizontal=false,allowNegative=false){const currency=currentCurrency();return{responsive:true,maintainAspectRatio:false,animation:false,indexAxis:horizontal?'y':'x',interaction:{mode:'nearest',intersect:false},plugins:{legend:{labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${money(horizontal?ctx.parsed.x:ctx.parsed.y,currency)}`}}},scales:{x:{ticks:{color:'#718098',maxRotation:0},grid:{color:'#121c29'}},y:{beginAtZero:!allowNegative,ticks:{color:'#718098'},grid:{color:'#121c29'}}}};}

  async function render(force=false,version=requestVersion){
    if(activeView()!=='inversiones')return;
    if(rendering){rerunRequested=true;pendingForce=pendingForce||force;return;}
    rendering=true;
    try{
      forcePeriodFilters();
      const root=document.getElementById('viewRoot');if(!root)return;
      const payload=await getPayload(force).catch(e=>{console.error('Inversiones periodo:',e);return null;});
      if(!payload||version!==requestVersion||activeView()!=='inversiones'||!root.isConnected)return;
      const state=captureFilters();
      const allPos=rowsFromPayload(payload,'Posiciones!A:X'),raw=applyLocalFilters(allPos,state),summaryAll=rowsFromPayload(payload,'Resumen_Inversiones!A:N');
      const bounds=periodBounds(state),snapshot=latestPerPlatformAsOf(raw,bounds.end),currency=currentCurrency(),rates=investmentRates(),timeline=buildTimeline(raw,currency,bounds);
      const summary=latestSummaryAsOf(summaryAll.filter(row=>summaryMatchesPlatform(row,state)),bounds.end);
      const categoryFilters=state.classes.size||state.categories.size||state.subcategories.size;
      const consolidated=summary.reduce((acc,r)=>{const market=parseNumber(r['Valor mercado']),capital=parseNumber(r['Aportes/Incrementos']),result=String(r.Resultado||'').trim()?parseNumber(r.Resultado):market-capital,base=String(r['Moneda base']||'COP').toUpperCase();acc.capital+=convertBase(capital,base,currency,rates);acc.result+=convertBase(result,base,currency,rates);acc.total+=convertBase(market,base,currency,rates);return acc;},{capital:0,result:0,total:0});
      const resultClass=consolidated.result>0?'result-positive':consolidated.result<0?'result-negative':'';
      const summaryHtml=`<div class="investment-consolidated-overview"><div class="investment-summary-title"><strong>Resumen consolidado de inversiones</strong><span>${summary.length} plataforma${summary.length===1?'':'s'} · último corte disponible</span></div><div class="investment-summary-grid"><div class="investment-summary-card"><span>Capital aportado</span><strong>${esc(money(consolidated.capital,currency))}</strong><small>Aportes / incrementos acumulados</small></div><div class="investment-summary-card ${resultClass}"><span>Ganancia / pérdida</span><strong>${esc(money(consolidated.result,currency))}</strong><small>Resultado acumulado frente al capital</small></div><div class="investment-summary-card"><span>Capital + ganancia/pérdida</span><strong>${esc(money(consolidated.total,currency))}</strong><small>Valor actual consolidado de las inversiones</small></div></div></div>`;
      const effectiveMode=state.mode;
      const modeLabel=effectiveMode==='capital'?'Capital aportado':effectiveMode==='result'?'Ganancia / pérdida':'Capital + ganancia/pérdida';
      let byPlatform,total,rowsHtml,tableTitle,tableSub;
      if(effectiveMode==='total'){
        byPlatform=aggregate(snapshot,r=>r['Plataforma / Bróker']||'Sin plataforma',r=>parseNumber(r[`Valor ${currency}`]));
        total=[...byPlatform.values()].reduce((a,b)=>a+b,0);
        tableTitle='Posiciones del período';tableSub=`${snapshot.length} posiciones · último corte disponible por plataforma`;
        rowsHtml=`<table><thead><tr><th>Fecha</th><th>Plataforma / Bróker</th><th>Símbolo</th><th>Instrumento</th><th>Clase de activo</th><th>Categoría</th><th>Subcategoría</th><th>Cantidad</th><th>Valor USD</th><th>Valor COP</th><th>Valor ARS</th></tr></thead><tbody>${snapshot.slice().sort((a,b)=>String(a['Plataforma / Bróker']).localeCompare(String(b['Plataforma / Bróker']))||String(a.Símbolo||'').localeCompare(String(b.Símbolo||''))).map(r=>`<tr><td>${esc(r.Fecha)}</td><td>${esc(r['Plataforma / Bróker'])}</td><td>${esc(r.Símbolo)}</td><td>${esc(r.Instrumento)}</td><td>${esc(r['Clase de activo'])}</td><td>${esc(r.Categoría)}</td><td>${esc(r.Subcategoría)}</td><td>${esc(r.Cantidad)}</td><td>${esc(r['Valor USD'])}</td><td>${esc(r['Valor COP'])}</td><td>${esc(r['Valor ARS'])}</td></tr>`).join('')}</tbody></table>`;
      }else{
        byPlatform=new Map();summary.forEach(r=>{const market=parseNumber(r['Valor mercado']),capital=parseNumber(r['Aportes/Incrementos']),result=String(r.Resultado||'').trim()?parseNumber(r.Resultado):market-capital,base=String(r['Moneda base']||'COP').toUpperCase(),rawValue=effectiveMode==='capital'?capital:result,key=norm(r.Entidad).includes('arq')?'ARQ / Alpaca':r.Entidad||'Sin plataforma';byPlatform.set(key,convertBase(rawValue,base,currency,rates));});
        total=[...byPlatform.values()].reduce((a,b)=>a+b,0);tableTitle='Capital y resultado por plataforma';tableSub='Datos consolidados desde Resumen_Inversiones';
        rowsHtml=`<table><thead><tr><th>Plataforma</th><th>Fecha corte</th><th>Capital</th><th>Ganancia / pérdida</th><th>Total</th></tr></thead><tbody>${summary.map(r=>{const market=parseNumber(r['Valor mercado']),capital=parseNumber(r['Aportes/Incrementos']),result=String(r.Resultado||'').trim()?parseNumber(r.Resultado):market-capital,base=String(r['Moneda base']||'COP').toUpperCase();return`<tr><td>${esc(r.Entidad)}</td><td>${esc(r['Fecha corte'])}</td><td>${esc(money(convertBase(capital,base,currency,rates),currency))}</td><td>${esc(money(convertBase(result,base,currency,rates),currency))}</td><td>${esc(money(convertBase(market,base,currency,rates),currency))}</td></tr>`;}).join('')}</tbody></table>`;
      }
      const byCategory=aggregate(snapshot,r=>r.Categoría||r['Clase de activo']||'Sin categoría',r=>parseNumber(r[`Valor ${currency}`]));

      if(version!==requestVersion||activeView()!=='inversiones'||!root.isConnected)return;
      let host=root.querySelector('#investmentPeriodCorrected');if(!host){host=document.createElement('div');host.id='investmentPeriodCorrected';host.className='investment-corrected';const head=root.querySelector('.section-head');if(head)head.insertAdjacentElement('afterend',host);else root.prepend(host);}
      destroyCharts();
      const note=effectiveMode!=='total'&&categoryFilters?'<div class="investment-truth-note">Clase, Categoría y Subcategoría filtran las posiciones de mercado. Capital y Ganancia/Pérdida solo existen consolidados por plataforma en el Sheet y no se reparten por instrumento.</div>':'';
      host.innerHTML=`${summaryHtml}<div class="kpi-grid investment-kpis"><div class="kpi-card"><span class="kpi-label">${esc(modeLabel)}</span><strong class="kpi-value green">${esc(money(total,currency))}</strong><div class="kpi-meta"><span>${effectiveMode==='total'?`Al cierre de ${esc(bounds.label)}`:'Según Resumen_Inversiones'}</span></div></div><div class="kpi-card"><span class="kpi-label">Plataformas</span><strong class="kpi-value">${byPlatform.size}</strong><div class="kpi-meta"><span>Según filtros aplicados</span></div></div><div class="kpi-card"><span class="kpi-label">${effectiveMode==='total'?'Posiciones':'Fuente'}</span><strong class="kpi-value">${effectiveMode==='total'?snapshot.length:'Resumen'}</strong><div class="kpi-meta"><span>${effectiveMode==='total'?'Último corte disponible':'Consolidado por plataforma'}</span></div></div><div class="kpi-card"><span class="kpi-label">Período</span><strong class="kpi-value">${esc(bounds.label)}</strong><div class="kpi-meta"><span>Año / mes seleccionado</span></div></div></div>${note}<div class="panel"><div class="panel-header"><div class="panel-title"><strong>${esc(modeLabel)} por plataforma</strong><span>Vista según Valor a mostrar</span></div></div><div class="chart-wrap tall"><canvas id="investmentPeriodPlatformChart"></canvas></div></div>${effectiveMode==='total'?`<div class="panel-grid equal"><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Por categoría</strong><span>Composición al período seleccionado</span></div></div><div class="chart-wrap tall"><canvas id="investmentPeriodCategoryChart"></canvas></div></div><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Evolución del portafolio</strong><span>Histórico de valor de mercado</span></div></div><div class="chart-scroll"><div class="chart-inner" style="min-width:100%;width:${Math.max(760,timeline.labels.length*115)}px;height:340px"><canvas id="investmentPeriodTimelineChart"></canvas></div></div></div></div>`:''}<div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>${esc(tableTitle)}</strong><span>${esc(tableSub)}</span></div></div><div class="table-scroll">${rowsHtml}</div></div>`;

      if(!window.Chart)return;
      const pc=document.getElementById('investmentPeriodPlatformChart');if(pc)charts.push(new Chart(pc,{type:'bar',data:{labels:[...byPlatform.keys()],datasets:[{label:modeLabel,data:[...byPlatform.values()]}]},options:chartOptions(false,effectiveMode==='result')}));
      if(effectiveMode==='total'){const cats=[...byCategory.entries()].sort((a,b)=>b[1]-a[1]).slice(0,14),cc=document.getElementById('investmentPeriodCategoryChart');if(cc)charts.push(new Chart(cc,{type:'bar',data:{labels:cats.map(x=>x[0]),datasets:[{label:`Valor ${currency}`,data:cats.map(x=>x[1])}]},options:chartOptions(true)}));const lc=document.getElementById('investmentPeriodTimelineChart');if(lc&&timeline.labels.length)charts.push(new Chart(lc,{type:'line',data:{labels:timeline.labels,datasets:timeline.datasets},options:chartOptions(false)}));}
    }finally{
      rendering=false;
      if(rerunRequested&&activeView()==='inversiones'){
        rerunRequested=false;
        schedule(false);
      }
    }
  }

  function injectStyles(){if(document.getElementById('investmentPeriodStyles'))return;const style=document.createElement('style');style.id='investmentPeriodStyles';style.textContent=`#investmentPeriodCorrected{display:grid;gap:16px}#investmentPeriodCorrected .table-scroll{max-height:520px}.investment-truth-note{color:#8b9ab0;font-size:10px;line-height:1.55;padding:10px 12px;border:1px solid var(--border-soft);border-radius:10px;background:rgba(255,255,255,.015)}`;document.head.appendChild(style);}
  function schedule(force=false){
    pendingForce=pendingForce||force;
    requestVersion++;
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      const version=requestVersion,useForce=pendingForce;
      pendingForce=false;
      render(useForce,version).catch(console.error);
    });
  }

  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{
    if(event?.detail?.view==='inversiones'){
      if(!event.detail.root?.querySelector('#investmentPeriodCorrected'))schedule(false);
    }else{
      requestVersion++;
      rerunRequested=false;
      destroyCharts();
    }
  });
  document.addEventListener('panel:section-filters-changed',event=>{if(event?.detail?.view==='inversiones')schedule(false);});
  document.addEventListener('panel:section-filters-ready',event=>{if(event?.detail?.view==='inversiones')schedule(false);});
  document.addEventListener('panel:backend-refresh-requested',()=>{if(activeView()==='inversiones')schedule(false);});
  queueMicrotask(()=>{if(activeView()==='inversiones'){forcePeriodFilters();schedule(false);}});
})();