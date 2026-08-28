(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!financeId)return;

  const STORAGE_KEY='panel-personal-edu.include-monthly-projection';
  const MONTHS=['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  let frame=0,pendingForce=false,requestVersion=0,lastPayload=null,lastRows=[];
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function parseNumber(value){
    if(typeof value==='number')return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
    else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }
  const money=v=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);
  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const h=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));}
  function monthKey(value){
    const s=norm(value);let m=s.match(/^(20\d{2})-(\d{1,2})/);if(m)return`${m[1]}-${String(+m[2]).padStart(2,'0')}`;
    const map={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[\s-]+(20\d{2})/);
    return m?`${m[2]}-${String(map[m[1]]).padStart(2,'0')}`:'';
  }
  function previousMonth(key){const m=String(key).match(/^(20\d{2})-(\d{2})$/);if(!m)return'';const d=new Date(+m[1],+m[2]-2,1);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
  function monthLabel(key){const m=String(key).match(/^(20\d{2})-(\d{2})$/);return m?`${MONTHS[+m[2]-1]} ${m[1]}`:key;}
  function currentMonthKey(){const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
  function parseDate(value){const s=String(value||'').trim();let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);const d=new Date(s);return Number.isNaN(d.getTime())?null:d;}
  function dateLabel(row){const d=parseDate(row['Fecha real']||row['Fecha registrada']);return d?`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`:'—';}
  function selectedGlobal(key){return[...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(el=>String(el.dataset.value||'').trim()).filter(Boolean);}
  function activeView(){return document.querySelector('.nav-item.active')?.dataset.view||'';}
  function rowMonth(row){return monthKey(row['Mes consumo']||row['Mes pago']||row['Fecha real']||row['Fecha registrada']);}
  function filterContext(view=activeView()){
    const rawState=window.__PAYMENT_FILTER_STATE__;
    const payment=rawState&&rawState.view===view?rawState:{account:[],method:[]};
    return{
      years:selectedGlobal('year'),
      months:selectedGlobal('month').map(Number).filter(n=>n>=1&&n<=12),
      categories:selectedGlobal('category'),
      account:Array.isArray(payment.account)?payment.account:[],
      method:Array.isArray(payment.method)?payment.method:[]
    };
  }

  function targetMonth(rows,ctx){
    const years=ctx.years,months=ctx.months,current=currentMonthKey();
    const keys=[...new Set(rows.map(rowMonth).filter(k=>k&&k<=current))].sort();
    if(years.length===1&&months.length===1)return`${years[0]}-${String(months[0]).padStart(2,'0')}`;
    if(months.length===1){const suffix=`-${String(months[0]).padStart(2,'0')}`;const match=keys.filter(k=>k.endsWith(suffix)&&(!years.length||years.includes(k.slice(0,4))));if(match.length)return match[match.length-1];}
    if(years.length===1){const match=keys.filter(k=>k.startsWith(`${years[0]}-`));if(match.length)return match[match.length-1];}
    return current;
  }

  function status(row){return norm(row.Estado);}
  function isActual(row){return norm(row.Tipo)==='gasto'&&(window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad/.test(status(row)));}
  function isProjection(row){return norm(row.Tipo)==='gasto'&&(window.MovementStatusCore?.isProjection(row.Estado) ?? /proyecc|proyect|programad/.test(status(row)));}
  function isFixed(row){return/^(si|sí|true|1)$/i.test(String(row['Es fijo']||'').trim());}
  function isSuper(row){return norm(row['Categoría'])==='supermercado';}
  function account(row){const raw=String(row['Cuenta / Tarjeta']||'').trim(),n=norm(raw),holder=norm(row.Titular);if(n.includes('efectivo'))return'Efectivo';if(n.includes('nequi'))return holder.includes('ro')?'Nequi Ro':'Nequi Edu';if(n.includes('arq'))return'ARQ Edu';if(n.includes('nu'))return(n.includes(' ro')||holder.includes('rocio')||holder==='ro')?'Nu Ro':'Nu Edu';return raw||'Sin especificar';}
  function method(row){const explicit=String(row['Modalidad de pago']||'').trim();if(explicit)return explicit;const raw=norm(row['Cuenta / Tarjeta']);if(raw.includes('credito')||raw.includes('crédito'))return'Crédito';if(raw.includes('transferencia'))return'Transferencia';if(raw.includes('debito')||raw.includes('débito'))return'Débito';if(raw.includes('efectivo'))return'Efectivo';const q=parseNumber(row.Cuotas);if(q>0&&(raw.includes('nu')||raw.includes('arq')))return'Crédito';return'Sin especificar';}
  function matchesExtraFilters(row,ctx){
    if(ctx.categories.length&&!ctx.categories.includes(String(row['Categoría']||'')))return false;
    if(ctx.account.length&&!ctx.account.includes(account(row)))return false;
    if(ctx.method.length&&!ctx.method.includes(method(row)))return false;
    return true;
  }

  async function payload(force=false){const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')return null;return getData(force);}
  function sum(rows){return rows.reduce((a,r)=>a+parseNumber(r['Monto COP']),0);}
  function groupTotals(actual,previous,projections){
    const out={super:{current:0,previous:0,projection:0},fixed:{current:0,previous:0,projection:0},variable:{current:0,previous:0,projection:0}};
    const add=(bucket,row,amount)=>{if(isSuper(row))out.super[bucket]+=amount;if(isFixed(row))out.fixed[bucket]+=amount;if(!isFixed(row)&&!isSuper(row))out.variable[bucket]+=amount;};
    actual.forEach(row=>add('current',row,parseNumber(row['Monto COP'])));
    previous.forEach(row=>add('previous',row,parseNumber(row['Monto COP'])));
    projections.forEach(row=>{const amount=parseNumber(row['Monto COP']);if(isSuper(row))out.super.projection+=amount;if(isFixed(row))out.fixed.projection+=amount;});
    return out;
  }

  function monthlyStats(rows,key,ctx){
    const prev=previousMonth(key),current=key===currentMonthKey(),actual=[],previous=[],projections=[];
    for(const row of rows){
      if(!matchesExtraFilters(row,ctx))continue;
      const month=rowMonth(row);
      if(month===key){if(isActual(row))actual.push(row);else if(isProjection(row))projections.push(row);}
      else if(month===prev&&isActual(row))previous.push(row);
    }
    projections.sort((a,b)=>(parseDate(a['Fecha real']||a['Fecha registrada'])?.getTime()||0)-(parseDate(b['Fecha real']||b['Fecha registrada'])?.getTime()||0));
    const groups=groupTotals(actual,previous,projections);
    groups.super.remaining=current?Math.max(0,groups.super.previous-groups.super.current-groups.super.projection):0;
    groups.fixed.remaining=current?Math.max(0,groups.fixed.previous-groups.fixed.current-groups.fixed.projection):0;
    groups.variable.remaining=0;
    const realTotal=sum(actual),projectionTotal=current?sum(projections):0,recurringGap=current?groups.super.remaining+groups.fixed.remaining:0;
    return{key,prev,current,actual,previous,projections,groups,realTotal,projectionTotal,recurringGap,projectedTotal:realTotal+projectionTotal+recurringGap};
  }

  function includeProjection(){const stored=localStorage.getItem(STORAGE_KEY);return stored===null?true:stored==='1';}
  function setProjection(value){localStorage.setItem(STORAGE_KEY,value?'1':'0');window.__PANEL_INCLUDE_MONTHLY_PROJECTION__=Boolean(value);document.dispatchEvent(new CustomEvent('panel:monthly-projection-change',{detail:{enabled:Boolean(value)}}));}
  function differenceCell(current,previous){const diff=current-previous;if(Math.abs(diff)<.5)return'<span class="monthly-diff neutral">Igual al mes pasado</span>';return diff<0?`<span class="monthly-diff under">Faltan ${esc(money(Math.abs(diff)))}</span>`:`<span class="monthly-diff over">Supera ${esc(money(diff))}</span>`;}
  function projectionStatus(row){const d=parseDate(row['Fecha real']||row['Fecha registrada']);if(!d)return'Proyección';const now=new Date();now.setHours(0,0,0,0);d.setHours(0,0,0,0);if(d.getTime()===now.getTime())return'Proyección hoy';if(d<now)return'Proyección vencida';return'Proyección';}
  function comparisonRows(stats){return[['Supermercado',stats.groups.super],['Gastos fijos / servicios',stats.groups.fixed],['Variables sin supermercado',stats.groups.variable]].map(([label,g])=>`<tr><td><strong>${esc(label)}</strong></td><td>${esc(money(g.current))}</td><td>${esc(money(g.previous))}</td><td>${differenceCell(g.current,g.previous)}</td></tr>`).join('');}

  function renderSuite(host,stats){
    const on=stats.current&&includeProjection();window.__PANEL_INCLUDE_MONTHLY_PROJECTION__=on;
    const considered=on?stats.projectedTotal:stats.realTotal;
    const title=stats.current?`Cierre estimado · ${monthLabel(stats.key)}`:`Cierre real · ${monthLabel(stats.key)}`;
    const subtitle=stats.current?'Separa gasto real de lo que todavía falta o está proyectado.':'Mes histórico cerrado: se muestra únicamente gasto realizado.';
    host.innerHTML=`<div class="panel monthly-close-panel"><div class="panel-header monthly-close-head"><div class="panel-title"><strong>${esc(title)}</strong><span>${esc(subtitle)}</span></div>${stats.current?`<label class="monthly-switch"><input type="checkbox" id="monthlyProjectionToggle" ${on?'checked':''}><span></span><b>Incluir proyección de cierre</b></label>`:''}</div><div class="monthly-kpis"><div><span>${stats.current?'Real hasta hoy':'Gasto real'}</span><strong>${esc(money(stats.realTotal))}</strong><small>Solo movimientos realizados</small></div><div><span>Proyección pendiente</span><strong>${esc(money(stats.current?stats.projectionTotal:0))}</strong><small>${stats.current?`${stats.projections.length} gasto${stats.projections.length===1?'':'s'}`:'No aplica a meses cerrados'}</small></div><div><span>Faltante recurrente</span><strong>${esc(money(stats.recurringGap))}</strong><small>${stats.current?'Supermercado + fijos/servicios':'No aplica a meses cerrados'}</small></div><div class="monthly-considered ${on?'projected':'actual'}"><span>Total considerado</span><strong>${esc(money(considered))}</strong><small>${on?'Real + cierre estimado':'Solo gasto real'}</small></div></div></div>
    <div class="panel table-panel monthly-programmed-panel"><div class="panel-header"><div class="panel-title"><strong>Proyecciones del mes</strong><span>${stats.current?`Pendientes conocidos para ${esc(monthLabel(stats.key))}.`:`Mes histórico: las proyecciones no se suman al cierre real.`}</span></div></div>${stats.projections.length?`<div class="table-scroll"><table class="monthly-planning-table"><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Medio de pago</th><th>Monto</th><th>Estado</th></tr></thead><tbody>${stats.projections.map(r=>`<tr><td>${esc(dateLabel(r))}</td><td>${esc(r['Categoría']||'—')}</td><td>${esc(r['Descripción / Comercio']||'—')}</td><td>${esc(r['Cuenta / Tarjeta']||'—')}</td><td>${esc(money(parseNumber(r['Monto COP'])))}</td><td><span class="monthly-status">${esc(projectionStatus(r))}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><strong>Sin proyecciones pendientes</strong><span>No hay movimientos con estado Proyección para este mes y filtros.</span></div>'}</div>
    <div class="panel table-panel monthly-comparison-panel"><div class="panel-header"><div class="panel-title"><strong>Comparación mensual de gasto recurrente y variable</strong><span>${esc(monthLabel(stats.key))} vs ${esc(monthLabel(stats.prev))}.</span></div></div><div class="table-scroll"><table class="monthly-planning-table"><thead><tr><th>Grupo</th><th>Este mes</th><th>Mes anterior</th><th>Comparación</th></tr></thead><tbody>${comparisonRows(stats)}</tbody></table></div></div>`;
    host.querySelector('#monthlyProjectionToggle')?.addEventListener('change',e=>{setProjection(e.target.checked);schedule(false);});
  }

  function injectStyles(){if(document.getElementById('monthlyProjectionStylesV2'))return;const style=document.createElement('style');style.id='monthlyProjectionStylesV2';style.textContent=`#monthlyProjectionSuite{display:grid;gap:12px;margin:0 0 4px}.monthly-detached-host{display:contents}.monthly-close-head{align-items:center}.monthly-switch{display:flex;align-items:center;gap:8px;color:#aebbd0;font-size:10px;cursor:pointer;user-select:none}.monthly-switch input{display:none}.monthly-switch span{width:34px;height:18px;border-radius:99px;background:#172334;border:1px solid #24344b;position:relative}.monthly-switch span:after{content:"";position:absolute;width:12px;height:12px;border-radius:50%;top:2px;left:3px;background:#718198}.monthly-switch input:checked+span{background:rgba(23,105,255,.25);border-color:#2c67c4}.monthly-switch input:checked+span:after{left:17px;background:#6fa1ff}.monthly-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.monthly-kpis>div{background:#0c1420;border:1px solid var(--border-soft);border-radius:11px;padding:11px}.monthly-kpis span{display:block;color:#718198;text-transform:uppercase;font-size:8px;font-weight:800;letter-spacing:.05em}.monthly-kpis strong{display:block;font-size:18px;margin-top:7px}.monthly-kpis small{display:block;color:#718198;font-size:9px;margin-top:5px}.monthly-kpis .monthly-considered.projected{border-color:rgba(23,105,255,.35);background:rgba(23,105,255,.07)}.monthly-planning-table{min-width:760px}.monthly-planning-table td{white-space:normal;vertical-align:top}.monthly-diff{display:inline-flex;padding:4px 7px;border-radius:99px;font-size:9px;font-weight:800}.monthly-diff.under{color:#f6c844;background:rgba(246,200,68,.08)}.monthly-diff.over{color:#ff8797;background:rgba(255,102,122,.08)}.monthly-diff.neutral{color:#7ee6af;background:rgba(38,208,124,.08)}.monthly-status{font-size:9px;color:#8db2f2;font-weight:700}@media(max-width:900px){.monthly-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.monthly-close-head{align-items:flex-start;flex-direction:column}}`;document.head.appendChild(style);}

  async function run(force=false,version=requestVersion){
    const view=activeView();if(view!=='gastos'&&view!=='flujo')return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const p=await payload(force);if(!p||version!==requestVersion||activeView()!==view||!root.isConnected)return;
    if(p!==lastPayload){lastPayload=p;lastRows=parseRows(p.sources?.[`${financeId}|Movimientos!A:Z`]||[]);}
    const ctx=filterContext(view),stats=monthlyStats(lastRows,targetMonth(lastRows,ctx),ctx);
    let host=root.querySelector('#monthlyProjectionSuite');
    if(!host){
      host=document.createElement('section');host.id='monthlyProjectionSuite';
      const head=root.querySelector(':scope > .section-head');
      if(head)head.insertAdjacentElement('afterend',host);else root.prepend(host);
    }
    let programmedHost=root.querySelector('#monthlyProgrammedHost');
    if(!programmedHost){programmedHost=document.createElement('section');programmedHost.id='monthlyProgrammedHost';programmedHost.className='monthly-detached-host';root.appendChild(programmedHost);}
    let comparisonHost=root.querySelector('#monthlyComparisonHost');
    if(!comparisonHost){comparisonHost=document.createElement('section');comparisonHost.id='monthlyComparisonHost';comparisonHost.className='monthly-detached-host';root.appendChild(comparisonHost);}
    renderSuite(host,stats);
    const programmed=host.querySelector('.monthly-programmed-panel');
    const comparison=host.querySelector('.monthly-comparison-panel');
    const projectionOn=stats.current&&includeProjection();
    if(projectionOn){
      programmedHost.replaceChildren();
      comparisonHost.replaceChildren();
    }else{
      if(programmed)programmedHost.replaceChildren(programmed);else programmedHost.replaceChildren();
      if(comparison)comparisonHost.replaceChildren(comparison);else comparisonHost.replaceChildren();
    }
  }
  function schedule(force=false){
    pendingForce=pendingForce||force;
    requestVersion++;
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      const version=requestVersion,useForce=pendingForce;
      pendingForce=false;
      run(useForce,version).catch(console.error);
    });
  }
  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{
    const view=event.detail?.view;
    if(view==='gastos'||view==='flujo')schedule(false);else requestVersion++;
  });
  document.addEventListener('panel:payment-filters-changed',event=>{
    const view=activeView();if(event.detail?.view===view&&(view==='gastos'||view==='flujo'))schedule(false);
  });
  document.addEventListener('panel:filters-updated',()=>{const view=activeView();if(view==='gastos'||view==='flujo')schedule(false);});
  document.addEventListener('panel:backend-refresh-requested',()=>{lastPayload=null;lastRows=[];});
  queueMicrotask(()=>schedule(false));
})();
