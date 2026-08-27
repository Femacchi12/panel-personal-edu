(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  window.__PANEL_INVESTMENT_PERIOD_ENHANCED__ = true;

  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const COLORS = ['#1769ff','#26d07c','#f6c844','#ff667a','#8b5cf6','#22d3ee'];
  let cache = null;
  let cacheAt = 0;
  let timer = null;
  let rendering = false;
  let charts = [];

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const currentCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';

  function parseRows(values){
    if(!Array.isArray(values) || values.length < 2) return [];
    const headers=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!==''))
      .map(r=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,r?.[i]??''])));
  }

  function parseNumber(value){
    if(typeof value==='number') return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');
    if(!s) return 0;
    const c=s.lastIndexOf(','), d=s.lastIndexOf('.');
    if(c>=0&&d>=0){ if(c>d)s=s.replace(/\./g,'').replace(',','.'); else s=s.replace(/,/g,''); }
    else if(c>=0){ const p=s.split(','); s=p.length===2&&p[1].length<=4?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,''); }
    else if(d>=0){ const p=s.split('.'); if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,''); }
    const n=Number(s); return Number.isFinite(n)?n:0;
  }

  function parseDate(value){
    const s=String(value||'').trim(); if(!s) return null;
    let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(m) return new Date(+m[1],+m[2]-1,+m[3]);
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if(m) return new Date(+m[3],+m[2]-1,+m[1]);
    const d=new Date(s); return Number.isNaN(d.getTime())?null:d;
  }

  function dateLabel(value){
    const d=value instanceof Date?value:parseDate(value);
    return d?`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`:'—';
  }

  function money(value,currency=currentCurrency()){
    const digits=currency==='USD'?2:0;
    return new Intl.NumberFormat('es-CO',{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value)||0);
  }

  function selectedGlobal(key){
    return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
      .map(el=>String(el.dataset.value||'').trim()).filter(Boolean);
  }
  function selectedLocal(key){
    return [...document.querySelectorAll(`.local-multi-filter[data-local-key="${key}"] .local-option.selected`)]
      .map(el=>String(el.dataset.value||'').trim()).filter(Boolean);
  }

  function forcePeriodFilters(){
    if(activeView()!=='inversiones') return;
    const bar=document.getElementById('filterBar');
    if(bar?.hidden) bar.hidden=false;
    document.querySelectorAll('#globalFilters .multi-filter').forEach(el=>{
      const shouldHide=!['year','month'].includes(el.dataset.filter);
      if(el.hidden!==shouldHide) el.hidden=shouldHide;
    });
  }

  function periodBounds(){
    const years=selectedGlobal('year').map(Number).filter(Boolean);
    const months=selectedGlobal('month').map(Number).filter(n=>n>=1&&n<=12);
    if(!years.length&&!months.length) return {start:null,end:null,label:'Todo el histórico'};
    const ys=years.length?years:[new Date().getFullYear()];
    let start,end;
    if(months.length){
      const dates=[]; ys.forEach(y=>months.forEach(m=>dates.push(new Date(y,m-1,1)))); dates.sort((a,b)=>a-b);
      start=dates[0]; const last=dates[dates.length-1]; end=new Date(last.getFullYear(),last.getMonth()+1,0,23,59,59,999);
    }else{
      start=new Date(Math.min(...ys),0,1); end=new Date(Math.max(...ys),11,31,23,59,59,999);
    }
    const label=years.length===1&&months.length===1?`${MONTHS[months[0]-1]} ${years[0]}`:years.length===1&&!months.length?String(years[0]):`${dateLabel(start)} – ${dateLabel(end)}`;
    return {start,end,label};
  }

  function applyLocalFilters(rows){
    const rules={invPlatform:'Plataforma / Bróker',invClass:'Clase de activo',invCategory:'Categoría',invSubcategory:'Subcategoría'};
    return rows.filter(row=>Object.entries(rules).every(([key,field])=>{
      const selected=selectedLocal(key); return !selected.length||selected.includes(String(row[field]||'').trim());
    }));
  }

  function latestPerPlatformAsOf(rows,end){
    const groups=new Map();
    rows.forEach(row=>{
      const d=parseDate(row.Fecha); if(!d||(end&&d>end)) return;
      const p=String(row['Plataforma / Bróker']||'Sin plataforma').trim();
      if(!groups.has(p)) groups.set(p,[]); groups.get(p).push(row);
    });
    const out=[];
    groups.forEach(group=>{
      const max=Math.max(...group.map(r=>parseDate(r.Fecha)?.getTime()||0));
      out.push(...group.filter(r=>(parseDate(r.Fecha)?.getTime()||0)===max));
    });
    return out;
  }

  function aggregate(rows,keyFn,valueFn){
    const map=new Map(); rows.forEach(r=>{const k=keyFn(r);map.set(k,(map.get(k)||0)+(Number(valueFn(r))||0));}); return map;
  }

  function buildTimeline(rows,currency,bounds){
    const items=rows.map(row=>{const d=parseDate(row.Fecha);return d?{date:d.getTime(),platform:String(row['Plataforma / Bróker']||'Sin plataforma').trim(),value:parseNumber(row[`Valor ${currency}`])}:null;}).filter(Boolean);
    if(!items.length) return {labels:[],datasets:[]};
    const platforms=[...new Set(items.map(x=>x.platform))].sort((a,b)=>a.localeCompare(b,'es'));
    const maps=new Map(platforms.map(p=>[p,new Map()]));
    items.forEach(x=>{const m=maps.get(x.platform);m.set(x.date,(m.get(x.date)||0)+x.value);});
    const minAll=Math.min(...items.map(x=>x.date)), maxAll=Math.max(...items.map(x=>x.date));
    const start=bounds.start?.getTime()??minAll, end=bounds.end?.getTime()??maxAll;
    const dates=[...new Set(items.map(x=>x.date).filter(t=>t>=start&&t<=end))].sort((a,b)=>a-b);
    if(bounds.start&&items.some(x=>x.date<start)&&!dates.includes(start)) dates.unshift(start);
    const valueAt=(platform,date)=>{let best=-Infinity,value=null;maps.get(platform)?.forEach((v,t)=>{if(t<=date&&t>best){best=t;value=v;}});return value;};
    const datasets=[];
    if(platforms.length>1) datasets.push({label:'Portafolio consolidado',data:dates.map(d=>platforms.reduce((s,p)=>s+(valueAt(p,d)||0),0)),borderColor:COLORS[0],backgroundColor:COLORS[0],borderWidth:3,tension:.22,spanGaps:true});
    platforms.forEach((p,i)=>datasets.push({label:p,data:dates.map(d=>valueAt(p,d)),borderColor:COLORS[(i+1)%COLORS.length],backgroundColor:COLORS[(i+1)%COLORS.length],borderWidth:2,tension:.22,spanGaps:true}));
    return {labels:dates.map(t=>dateLabel(new Date(t))),datasets};
  }

  async function getPayload(force=false){
    if(!force&&cache&&Date.now()-cacheAt<55_000) return cache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false); if(!token) throw new Error('Sesión Firebase no disponible');
    const r=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'}); if(!r.ok) throw new Error(`Backend ${r.status}`);
    cache=await r.json(); cacheAt=Date.now(); return cache;
  }

  function destroyCharts(){charts.forEach(c=>{try{c.destroy();}catch(_){}});charts=[];}
  function chartOptions(horizontal=false){
    const currency=currentCurrency();
    return {responsive:true,maintainAspectRatio:false,animation:false,indexAxis:horizontal?'y':'x',interaction:{mode:'nearest',intersect:false},plugins:{legend:{labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${money(horizontal?ctx.parsed.x:ctx.parsed.y,currency)}`}}},scales:{x:{ticks:{color:'#718098',maxRotation:0},grid:{color:'#121c29'}},y:{beginAtZero:true,ticks:{color:'#718098'},grid:{color:'#121c29'}}}};
  }

  async function render(force=false){
    if(activeView()!=='inversiones'||rendering) return;
    rendering=true;
    try{
      forcePeriodFilters();
      const root=document.getElementById('viewRoot'); if(!root) return;
      const p=await getPayload(force).catch(e=>{console.error('Inversiones periodo:',e);return null;});
      if(!p||activeView()!=='inversiones') return;
      const raw=applyLocalFilters(parseRows(p?.sources?.[`${financeId}|Posiciones!A:X`]||[]));
      const bounds=periodBounds();
      const snapshot=latestPerPlatformAsOf(raw,bounds.end);
      const currency=currentCurrency();
      const total=snapshot.reduce((s,r)=>s+parseNumber(r[`Valor ${currency}`]),0);
      const byPlatform=aggregate(snapshot,r=>r['Plataforma / Bróker']||'Sin plataforma',r=>parseNumber(r[`Valor ${currency}`]));
      const byCategory=aggregate(snapshot,r=>r.Categoría||r['Clase de activo']||'Sin categoría',r=>parseNumber(r[`Valor ${currency}`]));
      const timeline=buildTimeline(raw,currency,bounds);
      const rows=snapshot.slice().sort((a,b)=>String(a['Plataforma / Bróker']).localeCompare(String(b['Plataforma / Bróker']))||String(a.Símbolo||'').localeCompare(String(b.Símbolo||'')));

      root.querySelector('#investmentCorrected')?.classList.add('investment-period-hidden');
      let host=root.querySelector('#investmentPeriodCorrected');
      if(!host){host=document.createElement('div');host.id='investmentPeriodCorrected';host.className='investment-corrected';const head=root.querySelector('.section-head');if(head)head.insertAdjacentElement('afterend',host);else root.prepend(host);}
      destroyCharts();
      host.innerHTML=`
        <div class="kpi-grid investment-kpis">
          <div class="kpi-card"><span class="kpi-label">Portafolio</span><strong class="kpi-value green">${esc(money(total,currency))}</strong><div class="kpi-meta"><span>Al cierre de ${esc(bounds.label)}</span></div></div>
          <div class="kpi-card"><span class="kpi-label">Plataformas</span><strong class="kpi-value">${byPlatform.size}</strong><div class="kpi-meta"><span>Último corte disponible</span></div></div>
          <div class="kpi-card"><span class="kpi-label">Posiciones</span><strong class="kpi-value">${rows.length}</strong><div class="kpi-meta"><span>Según filtros aplicados</span></div></div>
          <div class="kpi-card"><span class="kpi-label">Período</span><strong class="kpi-value">${esc(bounds.label)}</strong><div class="kpi-meta"><span>Año / mes seleccionado</span></div></div>
        </div>
        <div class="panel-grid equal">
          <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Por plataforma</strong><span>Valor al período seleccionado</span></div></div><div class="chart-wrap tall"><canvas id="investmentPeriodPlatformChart"></canvas></div></div>
          <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Por categoría</strong><span>Composición al período seleccionado</span></div></div><div class="chart-wrap tall"><canvas id="investmentPeriodCategoryChart"></canvas></div></div>
        </div>
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Evolución del portafolio</strong><span>Histórico según Año, Mes y filtros de inversión</span></div></div><div class="chart-scroll"><div class="chart-inner" style="min-width:100%;width:${Math.max(760,timeline.labels.length*115)}px;height:340px"><canvas id="investmentPeriodTimelineChart"></canvas></div></div></div>
        <div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>Posiciones del período</strong><span>${rows.length} posiciones · último corte disponible por plataforma</span></div></div><div class="table-scroll"><table><thead><tr><th>Fecha</th><th>Plataforma / Bróker</th><th>Símbolo</th><th>Instrumento</th><th>Clase de activo</th><th>Categoría</th><th>Subcategoría</th><th>Cantidad</th><th>Valor USD</th><th>Valor COP</th><th>Valor ARS</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.Fecha)}</td><td>${esc(r['Plataforma / Bróker'])}</td><td>${esc(r.Símbolo)}</td><td>${esc(r.Instrumento)}</td><td>${esc(r['Clase de activo'])}</td><td>${esc(r.Categoría)}</td><td>${esc(r.Subcategoría)}</td><td>${esc(r.Cantidad)}</td><td>${esc(r['Valor USD'])}</td><td>${esc(r['Valor COP'])}</td><td>${esc(r['Valor ARS'])}</td></tr>`).join('')}</tbody></table></div></div>`;

      if(!window.Chart) return;
      const pc=document.getElementById('investmentPeriodPlatformChart'); if(pc) charts.push(new Chart(pc,{type:'bar',data:{labels:[...byPlatform.keys()],datasets:[{label:`Valor ${currency}`,data:[...byPlatform.values()]}]},options:chartOptions(false)}));
      const cats=[...byCategory.entries()].sort((a,b)=>b[1]-a[1]).slice(0,14);
      const cc=document.getElementById('investmentPeriodCategoryChart'); if(cc) charts.push(new Chart(cc,{type:'bar',data:{labels:cats.map(x=>x[0]),datasets:[{label:`Valor ${currency}`,data:cats.map(x=>x[1])}]},options:chartOptions(true)}));
      const lc=document.getElementById('investmentPeriodTimelineChart'); if(lc&&timeline.labels.length) charts.push(new Chart(lc,{type:'line',data:{labels:timeline.labels,datasets:timeline.datasets},options:chartOptions(false)}));
    }finally{rendering=false;}
  }

  function injectStyles(){
    if(document.getElementById('investmentPeriodStyles')) return;
    const style=document.createElement('style'); style.id='investmentPeriodStyles';
    style.textContent=`#investmentCorrected.investment-period-hidden{display:none!important}#investmentTimelinePanel{display:none!important}#investmentPeriodCorrected{display:grid;gap:16px}#investmentPeriodCorrected .table-scroll{max-height:520px}`;
    document.head.appendChild(style);
  }
  function schedule(force=false,delay=180){clearTimeout(timer);timer=setTimeout(()=>render(force),delay);}

  injectStyles();
  document.addEventListener('click',event=>{
    if(event.target.closest('.nav-item')) setTimeout(()=>{forcePeriodFilters();schedule(false,280);},100);
    if(event.target.closest('.currency-btn,.multi-filter-option,#clearFilters,#resetCurrentMonth')) schedule(false,280);
    if(event.target.closest('#refreshBtn')){cache=null;cacheAt=0;schedule(true,520);}
  });
  document.addEventListener('panel:section-filters-changed',event=>{
    if(event?.detail?.view==='inversiones') schedule(false,120);
  });

  // Mantener un único guard: solo repone este mismo renderer si app.js reconstruye viewRoot
  // por una recarga de datos. No crea una segunda versión de Inversiones.
  const root=document.getElementById('viewRoot');
  if(root) new MutationObserver(()=>{
    if(activeView()==='inversiones'&&!root.querySelector('#investmentPeriodCorrected')) schedule(false,220);
  }).observe(root,{childList:true,subtree:false});

  setTimeout(()=>{forcePeriodFilters();schedule(false,320);},320);
})();