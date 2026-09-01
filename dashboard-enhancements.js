(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!financeId)return;

  const COLORS=['#1769ff','#f6c844','#26d07c','#ff667a','#ffad42','#7a8ba5','#8b5cf6','#22d3ee','#f472b6','#a3e635'];
  let cardMetric='spend',cardChart=null,drawFrame=0,drawVersion=0,lastPayload=null,lastSources=null;
  const dateCache=new WeakMap();
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const pick=(row,keys)=>{for(const key of keys){if(row?.[key]!=null&&String(row[key]).trim()!=='')return String(row[key]).trim();}return'';};
  const selectedFilter=key=>[...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(el=>String(el.dataset.value||'').trim()).filter(Boolean);
  const activeCurrency=()=>document.querySelector('.currency-btn.active')?.dataset.currency||'COP';
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';

  function parseNumber(value){if(typeof value==='number')return Number.isFinite(value)?value:0;let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');if(comma>=0&&dot>=0){if(comma>dot)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(comma>=0){const parts=s.split(',');s=parts.length===2&&parts[1].length<=2?parts[0].replace(/\./g,'')+'.'+parts[1]:s.replace(/,/g,'');}else if(dot>=0){const parts=s.split('.');if(parts.length>2||(parts.length===2&&parts[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}
  function parseDate(value){const s=String(value??'').trim();if(!s)return null;let m=s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);if(m)return new Date(+m[1],+m[2]-1,+(m[3]||1));m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);const d=new Date(s);return Number.isNaN(d.getTime())?null:d;}
  function rowDate(row){if(dateCache.has(row))return dateCache.get(row);const d=parseDate(pick(row,['Fecha real','Fecha registrada','Fecha','Mes consumo']));dateCache.set(row,d);return d;}
  function rowsFromValues(values){if(!Array.isArray(values)||!values.length)return[];const headers=(values[0]||[]).map(v=>String(v||'').trim());return values.slice(1).filter(row=>row?.some(v=>String(v??'').trim()!=='')).map(row=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,row?.[i]??''])));}
  function moneyAmount(row,currency){if(currency==='USD')return parseNumber(pick(row,['Monto USD','USD']));if(currency==='ARS')return parseNumber(pick(row,['Monto ARS','ARS']));return parseNumber(pick(row,['Monto COP','COP']));}
  function isExpense(row){const type=norm(pick(row,['Tipo','Naturaleza']));return!type||type.includes('gasto')||type.includes('egreso')||type.includes('compra');}

  function rowsFromPayload(payload,range){
    const cached=window.__PANEL_GET_CACHED_ROWS__;
    if(typeof cached==='function')return cached(payload,financeId,range);
    return rowsFromValues(payload?.sources?.[`${financeId}|${range}`]||[]);
  }
  async function cardSources(force=false){
    const getData=window.__PANEL_GET_BACKEND_DATA__;
    if(typeof getData==='function'){
      const payload=await getData(force);
      if(payload===lastPayload&&lastSources)return lastSources;
      lastPayload=payload;
      lastSources={movements:rowsFromPayload(payload,'Movimientos!A:Z'),cards:rowsFromPayload(payload,'Tarjetas!A:T')};
      return lastSources;
    }
    const direct=window.__PANEL_GET_SOURCE_VALUES__;
    if(typeof direct!=='function')throw new Error('Backend no disponible');
    const [movementValues,cardValues]=await Promise.all([direct(financeId,'Movimientos!A:Z',force),direct(financeId,'Tarjetas!A:T',force)]);
    return{movements:rowsFromValues(movementValues),cards:rowsFromValues(cardValues)};
  }

  function currentFilteredMovements(rows){
    const years=new Set(selectedFilter('year')),months=new Set(selectedFilter('month')),categories=new Set(selectedFilter('category')),subcategories=new Set(selectedFilter('subcategory'));
    return rows.filter(row=>{if(!isExpense(row)||(window.MovementStatusCore&&!window.MovementStatusCore.isActual(row.Estado)))return false;const d=rowDate(row);if(years.size&&(!d||!years.has(String(d.getFullYear()))))return false;if(months.size&&(!d||!months.has(String(d.getMonth()+1))))return false;if(categories.size&&!categories.has(pick(row,['Categoría','Categoria'])))return false;if(subcategories.size&&!subcategories.has(pick(row,['Subcategoría','Subcategoria'])))return false;return Boolean(d);});
  }

  function nickname(owner){const n=norm(owner);if(n.includes('eduardo')||n.includes('fernando'))return'edu';if(n.includes('rocio'))return'rocio';return n.split(/\s+/)[0]||'';}
  const cardLabel=card=>`${pick(card,['Emisor'])||'Tarjeta'}${pick(card,['Titular'])?` · ${pick(card,['Titular'])}`:''}`;
  function issuerCounts(cards){const map=new Map();cards.forEach(card=>{const issuer=norm(pick(card,['Emisor']));if(issuer)map.set(issuer,(map.get(issuer)||0)+1);});return map;}
  function matchCardMovement(row,card,counts){const source=norm([pick(row,['Cuenta / Tarjeta','Cuenta/Tarjeta','Tarjeta','Medio de Pago','Pago']),pick(row,['Titular'])].filter(Boolean).join(' '));if(!source)return false;const issuer=norm(pick(card,['Emisor'])),product=norm(pick(card,['Producto'])),owner=norm(pick(card,['Titular'])),nick=nickname(owner),sameIssuer=counts.get(issuer)||0;if(nick&&source.includes(nick)&&(!issuer||source.includes(issuer)||!sameIssuer))return true;if(owner&&source.includes(owner))return true;if(sameIssuer===1&&issuer&&source.includes(issuer))return true;if(product&&source.includes(product)&&(sameIssuer===1||!nick||source.includes(nick)))return true;return false;}
  const cutDay=card=>{const raw=parseInt(pick(card,['Día corte','Dia corte','Corte']),10);return Number.isFinite(raw)&&raw>=1&&raw<=31?raw:1;};
  const cardLimit=card=>parseNumber(pick(card,['Cupo total actual','Cupo total','Límite','Limite','Cupo']));
  function cycleKey(date,cut){const y=date.getFullYear(),m=date.getMonth(),day=date.getDate(),endMonth=day<=cut?m:m+1,end=new Date(y,endMonth,Math.min(cut,new Date(y,endMonth+1,0).getDate()));return`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;}
  const periodLabel=(date,daily)=>daily?`${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;

  function buildCardSeries(movements,cards,metric,currency){
    const daily=selectedFilter('month').length===1;
    const dated=movements.map(row=>({row,date:rowDate(row)})).filter(x=>x.date).sort((a,b)=>a.date-b.date);
    const labels=[...new Set(dated.map(x=>periodLabel(x.date,daily)))];
    const activeId=String(window.__PANEL_ACTIVE_CARD_ID__||'').trim();if(activeId)cards=cards.filter(card=>String(card['ID tarjeta']||'').trim()===activeId);
    const counts=issuerCounts(cards);
    const datasets=cards.map((card,index)=>{
      let data;
      if(metric==='limit'){
        const cut=cutDay(card),limit=cardLimit(card),running=new Map(),points=new Map();
        dated.forEach(x=>{
          if(!matchCardMovement(x.row,card,counts))return;
          const cycle=cycleKey(x.date,cut),next=(running.get(cycle)||0)+moneyAmount(x.row,'COP');
          running.set(cycle,next);points.set(periodLabel(x.date,daily),limit?next/limit*100:0);
        });
        let last=null;data=labels.map(label=>{if(points.has(label))last=points.get(label);return last;});
      }else{
        const totals=new Map();
        dated.forEach(x=>{if(!matchCardMovement(x.row,card,counts))return;const label=periodLabel(x.date,daily);totals.set(label,(totals.get(label)||0)+moneyAmount(x.row,currency));});
        data=labels.map(label=>totals.get(label)||0);
      }
      return{label:cardLabel(card),data,borderColor:COLORS[index%COLORS.length],backgroundColor:COLORS[index%COLORS.length],borderWidth:2,tension:.25,pointRadius:2,pointHoverRadius:5,spanGaps:true};
    }).filter(ds=>ds.data.some(v=>v!=null&&Number(v)!==0));
    return{labels,datasets,daily};
  }

  function renderCardPanelSkeleton(){if(activeView()!=='tarjetas')return null;const existing=document.querySelector('[data-card-line-panel]');if(existing)return existing;const anchor=document.getElementById('cardsChart')?.closest('.panel');if(!anchor)return null;const panel=document.createElement('div');panel.className='panel card-line-panel';panel.dataset.cardLinePanel='true';panel.innerHTML=`<div class="panel-header card-line-header"><div class="panel-title"><strong>Evolución por tarjeta</strong><span>Consulta gastos o porcentaje del límite utilizado</span></div><div class="chart-mode-switch" role="group" aria-label="Métrica del gráfico"><button type="button" class="chart-mode-btn${cardMetric==='spend'?' active':''}" data-card-line-mode="spend">Gastos</button><button type="button" class="chart-mode-btn${cardMetric==='limit'?' active':''}" data-card-line-mode="limit">Límite utilizado</button></div></div><div class="card-line-status" data-card-line-status>Cargando histórico…</div><div class="chart-scroll card-line-scroll" hidden><div class="chart-inner card-line-inner" style="width:760px;min-width:100%;height:330px"><canvas id="cardTrendChart"></canvas></div></div>`;anchor.insertAdjacentElement('afterend',panel);panel.querySelectorAll('[data-card-line-mode]').forEach(btn=>btn.addEventListener('click',()=>{cardMetric=btn.dataset.cardLineMode||'spend';panel.querySelectorAll('[data-card-line-mode]').forEach(x=>x.classList.toggle('active',x===btn));schedule();}));return panel;}

  async function drawCardTrend(panel=renderCardPanelSkeleton()){
    if(!panel||!window.Chart||activeView()!=='tarjetas')return;
    const version=++drawVersion,status=panel.querySelector('[data-card-line-status]'),scroll=panel.querySelector('.card-line-scroll');
    if(!status||!scroll)return;
    try{
      status.textContent='Cargando histórico…';status.hidden=false;scroll.hidden=true;
      const sources=await cardSources(false);
      if(version!==drawVersion||activeView()!=='tarjetas'||!panel.isConnected)return;
      const movements=currentFilteredMovements(sources.movements),currency=activeCurrency(),built=buildCardSeries(movements,sources.cards,cardMetric,currency);
      if(!built.labels.length||!built.datasets.length){cardChart?.destroy();cardChart=null;status.textContent='No hay movimientos de tarjeta para los filtros seleccionados.';return;}
      const inner=panel.querySelector('.card-line-inner'),canvas=panel.querySelector('#cardTrendChart');if(!inner||!canvas)return;
      inner.style.width=`${Math.max(760,built.labels.length*(built.daily?58:90))}px`;scroll.hidden=false;status.hidden=true;
      cardChart?.destroy();
      cardChart=new Chart(canvas,{type:'line',data:{labels:built.labels,datasets:built.datasets},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'nearest',intersect:false},plugins:{legend:{display:true,labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}},tooltip:{callbacks:{label:ctx=>cardMetric==='limit'?`${ctx.dataset.label}: ${Number(ctx.parsed.y||0).toFixed(1)}%`:`${ctx.dataset.label}: ${new Intl.NumberFormat('es-CO',{style:'currency',currency,maximumFractionDigits:currency==='USD'?2:0}).format(Number(ctx.parsed.y)||0)}`}}},scales:{x:{ticks:{color:'#718098',maxRotation:0,autoSkip:true},grid:{color:'#121c29'}},y:{beginAtZero:true,suggestedMax:cardMetric==='limit'?100:undefined,ticks:{color:'#718098',callback:v=>cardMetric==='limit'?`${v}%`:compactNumber(v)},grid:{color:'#121c29'}}}}});
      document.dispatchEvent(new CustomEvent('panel:card-trend-rendered',{detail:{metric:cardMetric}}));
      requestAnimationFrame(()=>{if(panel.isConnected)scroll.scrollLeft=scroll.scrollWidth;});
    }catch(error){if(version!==drawVersion||!panel.isConnected)return;console.error('Error en gráfico histórico de tarjetas:',error);status.hidden=false;status.textContent='No fue posible cargar el histórico de tarjetas.';scroll.hidden=true;}
  }

  function compactNumber(value){const n=Number(value)||0,a=Math.abs(n);if(a>=1e9)return`${(n/1e9).toFixed(1)}B`;if(a>=1e6)return`${(n/1e6).toFixed(1)}M`;if(a>=1e3)return`${(n/1e3).toFixed(0)}K`;return String(Math.round(n));}
  function formatAxisLabel(scale,tick,index){if(scale.type==='category')return String(scale.getLabelForValue(tick.value)??'');const cb=scale.options?.ticks?.callback;if(typeof cb==='function'){try{return String(cb.call(scale,tick.value,index,scale.ticks)??'');}catch(_){}}return compactNumber(tick.value);}
  function drawFixedYAxis(chart){const scroller=chart?.canvas?.closest('.chart-scroll'),scale=chart?.scales?.y;if(!scroller||!scale)return;let axis=scroller.querySelector(':scope > .fixed-y-axis');if(!axis){axis=document.createElement('div');axis.className='fixed-y-axis';scroller.prepend(axis);}axis.style.height=`${chart.height}px`;axis.innerHTML='';(scale.ticks||[]).forEach((tick,index)=>{const y=scale.getPixelForTick(index);if(!Number.isFinite(y))return;const item=document.createElement('span');item.className='fixed-y-tick';item.style.top=`${y}px`;const label=formatAxisLabel(scale,tick,index);item.textContent=label.length>18?`${label.slice(0,17)}…`:label;item.title=label;axis.appendChild(item);});}
  if(window.Chart&&!window.__PANEL_FIXED_AXIS_REGISTERED__){window.__PANEL_FIXED_AXIS_REGISTERED__=true;window.Chart.register({id:'panelFixedYAxis',afterRender(chart){drawFixedYAxis(chart);},resize(chart){requestAnimationFrame(()=>drawFixedYAxis(chart));}});}

  function schedule(){
    if(activeView()!=='tarjetas')return;
    if(drawFrame)return;
    drawFrame=requestAnimationFrame(()=>{
      drawFrame=0;
      const panel=renderCardPanelSkeleton();
      if(panel)drawCardTrend(panel);
    });
  }
  document.addEventListener('panel:view-root-changed',event=>{if(event.detail?.view==='tarjetas')schedule();else{drawVersion++;cardChart?.destroy();cardChart=null;}});
  document.addEventListener('panel:card-filter-changed',schedule);
  document.addEventListener('panel:filters-updated',()=>{if(activeView()==='tarjetas')schedule();});
  document.addEventListener('panel:backend-refresh-requested',()=>{lastPayload=null;lastSources=null;});
  window.addEventListener('resize',()=>{if(cardChart)requestAnimationFrame(()=>drawFixedYAxis(cardChart));});
  queueMicrotask(schedule);
})();
