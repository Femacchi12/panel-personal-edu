(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  const COLORS = ['#1769ff','#f6c844','#26d07c','#ff667a','#ffad42','#7a8ba5','#8b5cf6','#22d3ee','#f472b6','#a3e635'];
  let timer = null;
  let rawCache = null;
  let rawCacheAt = 0;
  let rawPromise = null;

  const norm = value => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0){if(comma>dot)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
    else if(comma>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(dot>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(row=>row?.some(v=>String(v??'').trim()!==''))
      .map(row=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,row?.[i]??''])));
  }

  function pick(row, keys) {
    for (const key of keys) if (row?.[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
    return '';
  }

  function activeView() {
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  // 1) Search inside every filter: author CSS was overriding the HTML hidden attribute.
  function applyFilterSearch(input) {
    const root=input?.closest('.multi-filter');
    if (!root) return;
    const q=norm(input.value);
    root.querySelectorAll('.multi-filter-option').forEach(option=>{
      const label=option.dataset.value || option.dataset.label || option.textContent || '';
      const visible=!q || norm(label).includes(q);
      option.hidden=!visible;
      if (visible) option.style.removeProperty('display');
      else option.style.setProperty('display','none','important');
    });
  }

  document.addEventListener('input',event=>{
    const input=event.target.closest?.('.multi-filter-search');
    if (input) applyFilterSearch(input);
  },true);

  // 2) Move monthly planning/comparison panels to the end of Gastos/Flujo.
  function moveMonthlyPanels() {
    const view=activeView();
    if (!['gastos','flujo'].includes(view)) return;
    const root=document.getElementById('viewRoot');
    const suite=document.getElementById('monthlyProjectionSuite');
    if (!root || !suite) return;
    const programmed=suite.querySelector('.monthly-programmed-panel');
    const comparison=suite.querySelector('.monthly-comparison-panel');
    if (!programmed && !comparison) return;

    [...root.children].forEach(el=>{
      if ((el.classList?.contains('monthly-programmed-panel') || el.classList?.contains('monthly-comparison-panel')) && el!==programmed && el!==comparison) el.remove();
    });
    if (programmed) root.appendChild(programmed);
    if (comparison) root.appendChild(comparison);
  }

  // 3) Automatic total footer in the detail opened from the monthly matrix.
  const formatMoney=(value,currency)=>new Intl.NumberFormat('es-CO',{
    style:'currency',currency,maximumFractionDigits:currency==='USD'?2:0
  }).format(Number(value)||0);

  function addFlowDetailTotal() {
    const table=document.querySelector('#flowMatrixDetail table');
    if (!table) return;
    table.querySelector('tfoot[data-auto-total]')?.remove();
    const headers=[...table.querySelectorAll('thead th')].map(th=>norm(th.textContent));
    const indexes={cop:headers.indexOf('monto cop'),ars:headers.indexOf('monto ars'),usd:headers.indexOf('monto usd')};
    if (indexes.cop<0) return;
    const rows=[...table.querySelectorAll('tbody tr')];
    const sums={cop:0,ars:0,usd:0};
    rows.forEach(row=>{
      if(indexes.cop>=0)sums.cop+=parseNumber(row.cells[indexes.cop]?.textContent);
      if(indexes.ars>=0)sums.ars+=parseNumber(row.cells[indexes.ars]?.textContent);
      if(indexes.usd>=0)sums.usd+=parseNumber(row.cells[indexes.usd]?.textContent);
    });
    const foot=document.createElement('tfoot');
    foot.dataset.autoTotal='1';
    const tr=document.createElement('tr');
    tr.className='flow-detail-total-row';
    headers.forEach((_,index)=>{
      const td=document.createElement('td');
      if(index===0)td.textContent='TOTAL';
      if(index===indexes.cop)td.textContent=formatMoney(sums.cop,'COP');
      if(index===indexes.ars)td.textContent=formatMoney(sums.ars,'ARS');
      if(index===indexes.usd)td.textContent=formatMoney(sums.usd,'USD');
      tr.appendChild(td);
    });
    foot.appendChild(tr);
    table.appendChild(foot);
  }

  // 4) Raw backend reader through XHR, bypassing the card-specific window.fetch wrapper.
  function rawPayload(force=false) {
    if (!apiBaseUrl || !financeId) return Promise.resolve(null);
    if (!force && rawCache && Date.now()-rawCacheAt<50_000) return Promise.resolve(rawCache);
    if (!force && rawPromise) return rawPromise;
    rawPromise=(async()=>{
      const token=await window.__PANEL_GET_ID_TOKEN__?.(false);
      if(!token) return null;
      return await new Promise((resolve,reject)=>{
        const xhr=new XMLHttpRequest();
        xhr.open('GET',`${apiBaseUrl}/api/data`,true);
        xhr.setRequestHeader('Authorization',`Bearer ${token}`);
        xhr.setRequestHeader('Cache-Control','no-cache');
        xhr.onreadystatechange=()=>{
          if(xhr.readyState!==4)return;
          if(xhr.status>=200&&xhr.status<300){
            try{rawCache=JSON.parse(xhr.responseText);rawCacheAt=Date.now();resolve(rawCache);}catch(error){reject(error);}
          }else reject(new Error(`Backend ${xhr.status}`));
        };
        xhr.onerror=()=>reject(new Error('No fue posible cargar el histórico de tarjetas'));
        xhr.send();
      });
    })();
    return rawPromise.finally(()=>{rawPromise=null;});
  }

  function source(payload,range){return parseRows(payload?.sources?.[`${financeId}|${range}`]||[]);}
  function selectedGlobal(key){return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||'').trim()).filter(Boolean);}
  function parseDate(value){
    const s=String(value??'').trim();if(!s)return null;
    let m=s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);if(m)return new Date(+m[1],+m[2]-1,+(m[3]||1));
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    const d=new Date(s);return Number.isNaN(d.getTime())?null:d;
  }
  function isExpense(row){const t=norm(pick(row,['Tipo','Naturaleza']));return !t||t.includes('gasto')||t.includes('egreso')||t.includes('compra');}
  function filteredMovements(rows){
    const years=selectedGlobal('year'),months=selectedGlobal('month'),cats=selectedGlobal('category'),subs=selectedGlobal('subcategory');
    return rows.filter(row=>{
      if(!isExpense(row))return false;
      const d=parseDate(pick(row,['Fecha real','Fecha registrada','Fecha','Mes consumo']));
      if(!d)return false;
      if(years.length&&!years.includes(String(d.getFullYear())))return false;
      if(months.length&&!months.includes(String(d.getMonth()+1)))return false;
      if(cats.length&&!cats.includes(pick(row,['Categoría','Categoria'])))return false;
      if(subs.length&&!subs.includes(pick(row,['Subcategoría','Subcategoria'])))return false;
      return true;
    });
  }
  function ownerNick(value){const n=norm(value);if(n.includes('rocio'))return'rocio';if(n.includes('edu')||n.includes('fernando'))return'edu';return n.split(/\s+/)[0]||'';}
  function cardId(card){return String(card?.['ID tarjeta']||'').trim();}
  function cardLabel(card){const issuer=pick(card,['Emisor'])||'Tarjeta',owner=pick(card,['Titular']);return`${issuer}${owner?` · ${owner}`:''}`;}
  function matchesCard(row,card,cards){
    const sourceText=norm([pick(row,['Cuenta / Tarjeta','Cuenta/Tarjeta','Tarjeta','Medio de Pago','Pago']),pick(row,['Titular'])].filter(Boolean).join(' '));
    if(!sourceText)return false;
    const issuer=norm(pick(card,['Emisor'])),owner=norm(pick(card,['Titular'])),nick=ownerNick(owner);
    const sameIssuer=cards.filter(c=>norm(pick(c,['Emisor']))===issuer).length;
    if(issuer&&!sourceText.includes(issuer))return false;
    if(nick==='rocio')return sourceText.includes('rocio')||/(^|\s|-)ro($|\s|-)/.test(sourceText);
    if(nick==='edu')return sourceText.includes('edu')||sourceText.includes('fernando')||sameIssuer===1;
    return owner?sourceText.includes(owner):Boolean(issuer&&sourceText.includes(issuer));
  }
  function moneyAmount(row,currency){if(currency==='USD')return parseNumber(row['Monto USD']);if(currency==='ARS')return parseNumber(row['Monto ARS']);return parseNumber(row['Monto COP']);}
  function cutDay(card){const n=parseInt(pick(card,['Día corte','Dia corte','Corte']),10);return Number.isFinite(n)&&n>=1&&n<=31?n:1;}
  function controlLimit(card){return parseNumber(pick(card,['Límite personal de gasto','Limite personal de gasto']))||parseNumber(pick(card,['Cupo total actual','Cupo total','Límite','Limite','Cupo']));}
  function cycleKey(date,cut){const y=date.getFullYear(),m=date.getMonth(),day=date.getDate(),endMonth=day<=cut?m:m+1,end=new Date(y,endMonth,Math.min(cut,new Date(y,endMonth+1,0).getDate()));return`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;}
  function periodLabel(date,daily){return daily?`${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;}

  function buildCardSeries(movements,allCards,visibleCards,metric,currency){
    const daily=selectedGlobal('month').length===1;
    const dated=movements.map(row=>({row,date:parseDate(pick(row,['Fecha real','Fecha registrada','Fecha','Mes consumo']))})).filter(x=>x.date&&visibleCards.some(card=>matchesCard(x.row,card,allCards))).sort((a,b)=>a.date-b.date);
    const labels=[...new Set(dated.map(x=>periodLabel(x.date,daily)))];
    const datasets=visibleCards.map(card=>{
      const matched=dated.filter(x=>matchesCard(x.row,card,allCards));
      const index=Math.max(0,allCards.findIndex(c=>cardId(c)===cardId(card)));
      let data;
      if(metric==='limit'){
        const cut=cutDay(card),limit=controlLimit(card),running=new Map(),points=new Map();
        matched.forEach(x=>{const cycle=cycleKey(x.date,cut),next=(running.get(cycle)||0)+moneyAmount(x.row,'COP');running.set(cycle,next);points.set(periodLabel(x.date,daily),limit?next/limit*100:0);});
        let last=null;data=labels.map(label=>{if(points.has(label))last=points.get(label);return last;});
      }else data=labels.map(label=>matched.filter(x=>periodLabel(x.date,daily)===label).reduce((sum,x)=>sum+moneyAmount(x.row,currency),0));
      return{label:cardLabel(card),data,borderColor:COLORS[index%COLORS.length],backgroundColor:COLORS[index%COLORS.length],borderWidth:2,tension:.25,pointRadius:2,pointHoverRadius:5,spanGaps:true};
    }).filter(ds=>ds.data.some(v=>v!=null&&Number(v)!==0));
    return{labels,datasets,daily};
  }

  async function syncCardTrend(force=false){
    if(activeView()!=='tarjetas'||!window.Chart)return;
    const canvas=document.getElementById('cardTrendChart');if(!canvas)return;
    const chart=Chart.getChart(canvas);if(!chart)return;
    try{
      const payload=await rawPayload(force);if(!payload)return;
      const allCards=source(payload,'Tarjetas!A:T').filter(c=>cardId(c)&&norm(c.Activa||'sí')!=='no');
      const selectedId=String(window.__PANEL_ACTIVE_CARD_ID__||'');
      const visibleCards=selectedId?allCards.filter(c=>cardId(c)===selectedId):allCards;
      const movements=filteredMovements(source(payload,'Movimientos!A:Z'));
      const metric=document.querySelector('[data-card-line-mode].active')?.dataset.cardLineMode||'spend';
      const currency=document.querySelector('.currency-btn.active')?.dataset.currency||'COP';
      const built=buildCardSeries(movements,allCards,visibleCards,metric,currency);
      chart.data.labels=built.labels;
      chart.data.datasets=built.datasets;
      if(chart.options?.scales?.y){chart.options.scales.y.beginAtZero=true;chart.options.scales.y.suggestedMax=metric==='limit'?100:undefined;}
      chart.update('none');
      const panel=canvas.closest('[data-card-line-panel]');
      const status=panel?.querySelector('[data-card-line-status]');
      const scroll=panel?.querySelector('.card-line-scroll');
      if(status){status.hidden=Boolean(built.labels.length&&built.datasets.length);if(!status.hidden)status.textContent='No hay movimientos de tarjeta para los filtros seleccionados.';}
      if(scroll){scroll.hidden=!(built.labels.length&&built.datasets.length);const inner=panel.querySelector('.card-line-inner');if(inner)inner.style.width=`${Math.max(760,built.labels.length*(built.daily?58:90))}px`;}
    }catch(error){console.error('Filtro estable de Evolución por tarjeta:',error);}
  }

  function runFixes(){
    moveMonthlyPanels();
    addFlowDetailTotal();
    document.querySelectorAll('.multi-filter-search').forEach(input=>{if(input.value)applyFilterSearch(input);});
    if(activeView()==='tarjetas')syncCardTrend(false);
  }
  function schedule(delay=80){clearTimeout(timer);timer=setTimeout(runFixes,delay);}

  document.addEventListener('click',event=>{
    const target=event.target;
    if(target.closest?.('#refreshBtn')){rawCache=null;rawCacheAt=0;setTimeout(()=>syncCardTrend(true),260);}
    if(target.closest?.('.card-specific-option,.card-specific-clear,#clearSectionFilters,[data-card-line-mode],.currency-btn,.multi-filter-option,#clearFilters,#resetCurrentMonth')) schedule(70);
    if(target.closest?.('[data-flow-detail]')) schedule(120);
    if(target.closest?.('.nav-item')) schedule(220);
  },true);

  const root=document.getElementById('viewRoot');
  if(root)new MutationObserver(()=>schedule(90)).observe(root,{childList:true,subtree:true});

  if(!document.getElementById('dashboardReliabilityFixStyles')){
    const style=document.createElement('style');style.id='dashboardReliabilityFixStyles';style.textContent=`
      #flowMatrixDetail tfoot[data-auto-total] td{font-weight:800;color:#f4f7fb;border-top:2px solid #2a3a50;background:#0d1622;white-space:nowrap}
      #flowMatrixDetail tfoot[data-auto-total] td:first-child{color:#26d07c;letter-spacing:.06em}
    `;document.head.appendChild(style);
  }

  schedule(400);
})();
