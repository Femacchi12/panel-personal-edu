(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const state = {
    investmentMode: 'total',
    pensionBucket: 'all',
    pensionMode: 'total',
    incomeTypes: new Set(['payroll','usd','prima','extras'])
  };
  let cache = null;
  let cacheAt = 0;
  let timer = null;
  let debtChart = null;
  let investmentChart = null;
  let pensionChart = null;

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));

  function activeView(){ return document.querySelector('.nav-item.active')?.dataset.view || ''; }

  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return[];
    const headers=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!==''))
      .map(r=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,r?.[i]??''])));
  }

  function parseNumber(value){
    if(typeof value==='number') return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');
    if(!s)return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0){ if(c>d)s=s.replace(/\./g,'').replace(',','.'); else s=s.replace(/,/g,''); }
    else if(c>=0){ const p=s.split(','); s=p.length===2&&p[1].length<=4?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,''); }
    else if(d>=0){ const p=s.split('.'); if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,''); }
    const n=Number(s); return Number.isFinite(n)?n:0;
  }

  function parseDate(value){
    const s=String(value||'').trim(); if(!s)return null;
    let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(m)return new Date(+m[1],+m[2]-1,+m[3]);
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    m=s.match(/^(\d{1,2})[-\s](ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*[-\s](\d{4})/i);
    if(m){const idx=MONTHS.findIndex(x=>norm(m[2]).startsWith(x));if(idx>=0)return new Date(+m[3],idx,+m[1]);}
    const d=new Date(s); return Number.isNaN(d.getTime())?null:d;
  }

  function parseMonth(value){
    const s=norm(value); if(!s)return null;
    let m=s.match(/^(\d{4})[-\/]([01]?\d)/); if(m)return new Date(+m[1],+m[2]-1,1);
    m=s.match(/(ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*[\s\-\/]+(\d{4})/);
    if(m){const idx=MONTHS.findIndex(x=>m[1].startsWith(x));if(idx>=0)return new Date(+m[2],idx,1);}
    const d=parseDate(value); return d?new Date(d.getFullYear(),d.getMonth(),1):null;
  }

  const monthKey = d => d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`:'';
  const monthLabel = d => d?`${MONTHS[d.getMonth()]} ${d.getFullYear()}`:'—';
  const dateLabel = value => {const d=value instanceof Date?value:parseDate(value);return d?`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`:'—';};
  const addMonths = (d,n)=>new Date(d.getFullYear(),d.getMonth()+n,1);
  const moneyCop = value=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value)||0);
  function currentCurrency(){return document.querySelector('.currency-btn.active')?.dataset.currency||'COP';}
  function money(value,currency=currentCurrency()){
    return new Intl.NumberFormat('es-CO',{style:'currency',currency,minimumFractionDigits:currency==='USD'?2:0,maximumFractionDigits:currency==='USD'?2:0}).format(Number(value)||0);
  }

  async function payload(force=false){
    if(!force&&cache&&Date.now()-cacheAt<55_000)return cache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false); if(!token)throw new Error('Sesión Firebase no disponible');
    const r=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if(!r.ok)throw new Error(`Backend ${r.status}`);
    cache=await r.json(); cacheAt=Date.now(); return cache;
  }
  function source(p,range){return parseRows(p?.sources?.[`${financeId}|${range}`]||[]);}

  function injectStyles(){
    if(document.getElementById('dashboardV2EnhancementStyles'))return;
    const style=document.createElement('style');
    style.id='dashboardV2EnhancementStyles';
    style.textContent=`
      .filter-clear-one,.local-clear{display:none!important}
      .topbar{position:fixed!important;top:0!important;left:var(--sidebar)!important;right:0!important;width:auto!important;z-index:500!important}
      .sidebar.collapsed~.app-shell .topbar{left:var(--sidebar-collapsed)!important}
      .main{padding-top:calc(var(--topbar) + 22px)!important}
      @media(min-width:980px){
        .credit-grid .credit-card{display:grid!important;grid-template-columns:minmax(300px,.72fr) minmax(560px,1.28fr)!important;column-gap:18px!important;align-items:start!important;padding:15px 17px!important}
        .credit-card>.credit-top,.credit-card>.credit-amount,.credit-card>.credit-sub,.credit-card>.usage-track,.credit-card>.credit-bottom{grid-column:1!important}
        .credit-card>.credit-top{grid-row:1}.credit-card>.credit-amount{grid-row:2;margin:11px 0 4px!important}.credit-card>.credit-sub{grid-row:3}.credit-card>.usage-track{grid-row:4;margin:11px 0 7px!important}.credit-card>.credit-bottom{grid-row:5;margin-top:7px!important}
        .credit-card>.card-payment-control{grid-column:2!important;grid-row:1/span 5!important;margin:0!important;padding:0 0 0 18px!important;border-top:0!important;border-left:1px solid var(--border-soft)!important;align-self:stretch}
        .credit-card .card-cycle-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:6px!important}
        .credit-card .card-cycle-item.wide{grid-column:span 2!important}
        .credit-card .card-cycle-item{padding:7px 8px!important}
        .credit-card .card-payment-control{gap:7px!important}
        .credit-card .card-limit-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:6px!important}
        .credit-card .card-limit-grid>div{padding:7px 8px!important}
      }
      #debtV2,#investmentV2,#pensionV2{display:grid;gap:12px}
      .v2-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      .v2-kpi{background:linear-gradient(180deg,#0d131d,#090e15);border:1px solid var(--border-soft);border-radius:13px;padding:13px 14px;min-width:0}
      .v2-kpi span{display:block;color:#718198;font-size:8px;text-transform:uppercase;letter-spacing:.06em;font-weight:800}
      .v2-kpi strong{display:block;margin-top:7px;font-size:20px;line-height:1.15;color:#edf3fb;white-space:normal}
      .v2-kpi small{display:block;margin-top:5px;color:#6f8095;font-size:9px;line-height:1.4}
      .v2-projection{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
      .v2-projection>div{background:#0d1520;border:1px solid var(--border-soft);border-radius:10px;padding:10px}
      .v2-projection span{display:block;font-size:8px;color:#718198;text-transform:uppercase;font-weight:800}.v2-projection strong{display:block;font-size:13px;margin-top:5px}.v2-projection small{display:block;color:#64758c;font-size:9px;margin-top:4px}
      .v2-status{display:inline-flex;padding:4px 7px;border-radius:99px;font-size:9px;font-weight:800;border:1px solid var(--border)}
      .v2-status.pending{color:#ffcb68;background:rgba(246,200,68,.08);border-color:rgba(246,200,68,.2)}
      .v2-status.future{color:#8ab2ff;background:rgba(23,105,255,.08);border-color:rgba(23,105,255,.2)}
      .v2-status.good{color:#7ee6af;background:rgba(38,208,124,.08);border-color:rgba(38,208,124,.2)}
      .v2-note{color:#718198;font-size:10px;line-height:1.55;padding:10px 12px;border:1px solid var(--border-soft);border-radius:10px;background:rgba(255,255,255,.015)}
      .v2-table{min-width:980px!important}.v2-table td{white-space:normal!important;line-height:1.4;vertical-align:top}.v2-table .money-cell{white-space:nowrap!important;text-align:right}
      .v2-chart{height:280px;position:relative}
      .v2-filter-menu{z-index:260!important}
      #incomeTypeFilter{display:none!important}
      #incomeV2TypeFilter .multi-filter-check,#investmentV2ModeFilter .multi-filter-check{flex:0 0 auto}
      .services-merged-local{min-width:0}
      #globalFilters.services-unified-grid{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))!important}
      [data-income-complete] .table-scroll{max-height:500px!important;overflow:auto!important}
      [data-income-complete] .table-scroll.expanded{max-height:500px!important}
      [data-income-complete] th{position:sticky!important;top:0!important;z-index:5!important}
      @media(max-width:980px){.v2-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:720px){.topbar{left:0!important}.sidebar.collapsed~.app-shell .topbar{left:0!important}.v2-kpis{grid-template-columns:1fr 1fr}}
      @media(max-width:520px){.v2-kpis{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function selectedLocal(key){
    return [...document.querySelectorAll(`.local-multi-filter[data-local-key="${key}"] .local-option.selected`)].map(x=>String(x.dataset.value||'')).filter(Boolean);
  }
  function selectedGlobal(key){
    return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||'')).filter(Boolean);
  }

  function createMultiFilter({id,label,options,selected,onChange,single=false}){
    const root=document.createElement('div');
    root.id=id; root.className='multi-filter local-multi-filter v2-static-filter';
    root.dataset.localKey=id;
    const selectedValues=()=>single?[selected()].filter(Boolean):selected();
    const summary=()=>{const vals=selectedValues();return !vals.length?'Todos':vals.length===1?(options.find(o=>o.value===vals[0])?.label||vals[0]):`${vals.length} seleccionados`;};
    root.innerHTML=`<div class="filter-label-row"><span>${esc(label)}</span></div><button type="button" class="multi-filter-trigger local-trigger" aria-expanded="false"><span class="local-summary">${esc(summary())}</span><span class="filter-chevron">⌄</span></button><div class="multi-filter-menu local-menu v2-filter-menu"><input class="multi-filter-search local-search" placeholder="Buscar…" autocomplete="off"><div class="multi-filter-options local-options"></div></div>`;
    const box=root.querySelector('.local-options');
    const renderOptions=()=>{
      const vals=selectedValues();
      box.innerHTML=options.map(o=>`<button type="button" class="multi-filter-option local-option${vals.includes(o.value)?' selected':''}" data-value="${esc(o.value)}" data-label="${esc(o.label)}"><span class="multi-filter-check">${vals.includes(o.value)?'✓':''}</span><span>${esc(o.label)}</span></button>`).join('');
      root.querySelector('.local-summary').textContent=summary();
      box.querySelectorAll('.local-option').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();onChange(btn.dataset.value);renderOptions();}));
    };
    root.querySelector('.local-trigger').addEventListener('click',e=>{e.stopPropagation();document.querySelectorAll('.local-multi-filter.open').forEach(x=>{if(x!==root)x.classList.remove('open')});root.classList.toggle('open');root.querySelector('.local-trigger').setAttribute('aria-expanded',root.classList.contains('open')?'true':'false');if(root.classList.contains('open'))setTimeout(()=>root.querySelector('.local-search')?.focus(),0);});
    root.querySelector('.local-search').addEventListener('input',e=>{const q=norm(e.target.value);box.querySelectorAll('.local-option').forEach(btn=>btn.hidden=!!q&&!norm(btn.dataset.label).includes(q));});
    renderOptions(); return root;
  }

  function unifyServicesFilters(){
    const grid=document.getElementById('globalFilters');
    if(!grid)return;
    grid.querySelectorAll('.services-merged-local').forEach(el=>{if(activeView()!=='servicios')el.remove();});
    grid.classList.toggle('services-unified-grid',activeView()==='servicios');
    if(activeView()!=='servicios')return;
    const sectionBar=document.getElementById('sectionFilterBar');
    if(!sectionBar)return;
    const locals=[...sectionBar.querySelectorAll('.local-multi-filter')];
    if(locals.length){
      grid.querySelectorAll('.services-merged-local').forEach(el=>el.remove());
      locals.forEach(el=>{el.classList.add('services-merged-local');grid.appendChild(el);});
    }
    sectionBar.hidden=true;
  }

  function cardId(value,titular=''){
    const s=norm(`${value} ${titular}`);
    if(s.includes('arq'))return'TC-ARQ-EDU';
    if(s.includes('nu')&&(s.includes('rocio')||s.includes('ro')||s.includes('rocío')))return'TC-NU-RO';
    if(s.includes('nu'))return'TC-NU-EDU';
    return String(value||'').startsWith('TC-')?String(value):'';
  }
  function cardLabel(id){return id==='TC-NU-EDU'?'Nu · Edu':id==='TC-NU-RO'?'Nu · Rocío':id==='TC-ARQ-EDU'?'ARQ · Edu':id||'Tarjeta';}
  function isPaidCycle(row){const p=norm(row?.Pagado);return['si','sí','pagado','pago','yes','true'].includes(p)||!!parseDate(row?.['Fecha pago'])||parseNumber(row?.['Monto pagado real'])>0;}
  function latestClosedCycle(cycles,id,now){return cycles.filter(r=>cardId(r.Tarjeta,r.Titular)===id).map(r=>({r,d:parseDate(r['Fecha corte'])})).filter(x=>x.d&&x.d<=now).sort((a,b)=>b.d-a.d)[0]?.r||null;}
  function pendingInstallment(row,cycles,now){
    const first=parseMonth(row['Fecha primera cuota']); if(!first)return null;
    const installment=Math.max(1,Math.round(parseNumber(row['Cuota actual']))||1);
    const scheduled=addMonths(first,installment-1),id=cardId(row.Tarjeta,row.Titular),cycle=latestClosedCycle(cycles,id,now),currentMonth=new Date(now.getFullYear(),now.getMonth(),1);
    if(!cycle)return{pending:scheduled>=currentMonth,scheduled,id};
    const cut=parseDate(cycle['Fecha corte']); if(!cut)return{pending:scheduled>=currentMonth,scheduled,id};
    const cutMonth=new Date(cut.getFullYear(),cut.getMonth(),1),cmp=scheduled-cutMonth;
    return{pending:cmp>0||(cmp===0&&!isPaidCycle(cycle)),scheduled,id};
  }
  function debtPurchases(rows,cycles,now){
    const holders=selectedLocal('debtHolder'),cards=selectedLocal('debtCard');
    const filtered=rows.filter(r=>(!holders.length||holders.includes(String(r.Titular||'')))&&(!cards.length||cards.includes(String(r.Tarjeta||''))));
    const groups=new Map();
    filtered.forEach(row=>{
      const id=cardId(row.Tarjeta,row.Titular),total=parseNumber(row['Total compra']),key=[id,row['Fecha compra'],norm(row.Descripción||row.Comercio),total].join('|');
      if(!groups.has(key))groups.set(key,{id,fecha:row['Fecha compra'],comercio:row.Comercio||'',descripcion:row.Descripción||'',titular:row.Titular||'',total,n:Math.max(1,Math.round(parseNumber(row['N° cuotas']))||1),rows:[]});
      const info=pendingInstallment(row,cycles,now);
      groups.get(key).rows.push({...row,__info:info,__cuota:Math.max(1,Math.round(parseNumber(row['Cuota actual']))||1),__valor:parseNumber(row['Valor cuota'])});
    });
    return[...groups.values()].map(g=>{g.rows.sort((a,b)=>a.__cuota-b.__cuota);g.pending=g.rows.filter(r=>r.__info?.pending).sort((a,b)=>a.__info.scheduled-b.__info.scheduled);g.pendingTotal=g.pending.reduce((s,r)=>s+r.__valor,0);g.paidCount=Math.max(0,g.n-g.pending.length);g.next=g.pending[0]||null;return g;}).sort((a,b)=>(parseDate(b.fecha)?.getTime()||0)-(parseDate(a.fecha)?.getTime()||0));
  }
  function renderDebt(p){
    if(activeView()!=='deudas')return;
    const root=document.getElementById('viewRoot'); if(!root)return;
    root.closest('.main')?.querySelector('.local-multi-filter[data-local-key="debtStatus"]')?.setAttribute('hidden','');
    const purchases=debtPurchases(source(p,'Cuotas!A:T'),source(p,'Pagos_Tarjetas!A:T'),new Date());
    const active=purchases.filter(x=>x.pending.length),total=active.reduce((s,x)=>s+x.pendingTotal,0),currentKey=monthKey(new Date(new Date().getFullYear(),new Date().getMonth(),1));
    const projection=new Map(); active.forEach(g=>g.pending.forEach(r=>{const k=monthKey(r.__info.scheduled),e=projection.get(k)||{date:r.__info.scheduled,total:0,count:0};e.total+=r.__valor;e.count++;projection.set(k,e);}));
    const proj=[...projection.values()].sort((a,b)=>a.date-b.date),current=proj.find(x=>monthKey(x.date)===currentKey)?.total||0,future=Math.max(0,total-current);
    root.querySelectorAll(':scope > .kpi-grid').forEach(el=>el.style.display='none');
    root.querySelectorAll(':scope > .panel').forEach(panel=>{const t=norm(panel.querySelector('.panel-title strong')?.textContent);if(t.includes('saldo pendiente por compra')||t.includes('cuotas pendientes'))panel.style.display='none';});
    let host=root.querySelector('#debtV2'); if(!host){host=document.createElement('section');host.id='debtV2';const head=root.querySelector('.section-head');head?.insertAdjacentElement('afterend',host);}
    host.innerHTML=`<div class="v2-kpis">
      <div class="v2-kpi"><span>Deuda pendiente en cuotas</span><strong>${esc(moneyCop(total))}</strong><small>${active.length} compras financiadas activas</small></div>
      <div class="v2-kpi"><span>En el corte / mes actual</span><strong>${esc(moneyCop(current))}</strong><small>Cuotas que todavía están pendientes de este mes</small></div>
      <div class="v2-kpi"><span>Próximos meses</span><strong>${esc(moneyCop(future))}</strong><small>Compromiso futuro ya adquirido</small></div>
      <div class="v2-kpi"><span>Último mes comprometido</span><strong>${esc(proj.length?monthLabel(proj[proj.length-1].date):'—')}</strong><small>Si no agregas nuevas compras en cuotas</small></div>
    </div>
    <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Calendario de deuda futura</strong><span>Cuánto ya está comprometido en cada mes</span></div></div>${proj.length?`<div class="v2-projection">${proj.map(x=>`<div><span>${esc(monthLabel(x.date))}</span><strong>${esc(moneyCop(x.total))}</strong><small>${x.count} cuota${x.count===1?'':'s'}</small></div>`).join('')}</div>`:'<div class="empty-state"><strong>Sin deuda futura</strong><span>No hay cuotas pendientes según los cortes registrados.</span></div>'}</div>
    <div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>Compras financiadas activas</strong><span>Lectura consolidada por compra, no una fila repetida por cada cuota</span></div></div><div class="table-scroll"><table class="v2-table"><thead><tr><th>Compra</th><th>Tarjeta</th><th>Total compra</th><th>Cuotas pagadas</th><th>Cuotas pendientes</th><th>Próxima cuota</th><th>Próximo mes</th><th>Saldo pendiente</th><th>Estado</th></tr></thead><tbody>${active.map(g=>{const inCurrent=g.next&&monthKey(g.next.__info.scheduled)===currentKey;return`<tr><td><strong>${esc(g.descripcion||g.comercio||'Compra')}</strong><br><small>${esc(dateLabel(g.fecha))} · ${esc(g.comercio)}</small></td><td>${esc(cardLabel(g.id))}</td><td class="money-cell">${esc(moneyCop(g.total))}</td><td>${g.paidCount}/${g.n}</td><td>${g.pending.length}</td><td class="money-cell">${esc(g.next?moneyCop(g.next.__valor):'—')}</td><td>${esc(g.next?monthLabel(g.next.__info.scheduled):'—')}</td><td class="money-cell"><strong>${esc(moneyCop(g.pendingTotal))}</strong></td><td><span class="v2-status ${inCurrent?'pending':'future'}">${inCurrent?'En corte pendiente':'Próximas cuotas'}</span></td></tr>`;}).join('')}</tbody></table></div></div>`;
  }

  function latestPerPlatform(rows){const g=new Map();rows.forEach(r=>{const k=r['Plataforma / Bróker']||'Sin plataforma';if(!g.has(k))g.set(k,[]);g.get(k).push(r);});const out=[];g.forEach(arr=>{const dates=arr.map(r=>parseDate(r.Fecha)).filter(Boolean);if(!dates.length){out.push(...arr);return;}const max=Math.max(...dates.map(d=>d.getTime()));out.push(...arr.filter(r=>parseDate(r.Fecha)?.getTime()===max));});return out;}
  function investmentRates(rows){
    const usable=rows.filter(r=>parseNumber(r['Valor USD'])>0&&parseNumber(r['Valor COP'])>0);let usdCop=3150,usdArs=1500;
    if(usable.length){const usd=usable.reduce((s,r)=>s+parseNumber(r['Valor USD']),0),cop=usable.reduce((s,r)=>s+parseNumber(r['Valor COP']),0),ars=usable.reduce((s,r)=>s+parseNumber(r['Valor ARS']),0);if(usd>0){usdCop=cop/usd;usdArs=ars/usd;}}
    return{usdCop,usdArs};
  }
  function convertBase(value,base,currency,rates){const v=Number(value)||0;if(base===currency)return v;if(base==='USD'&&currency==='COP')return v*rates.usdCop;if(base==='USD'&&currency==='ARS')return v*rates.usdArs;if(base==='COP'&&currency==='USD')return v/rates.usdCop;if(base==='COP'&&currency==='ARS')return v/rates.usdCop*rates.usdArs;if(base==='ARS'&&currency==='USD')return v/rates.usdArs;if(base==='ARS'&&currency==='COP')return v/rates.usdArs*rates.usdCop;return v;}
  function positionFiltered(rows){const filters=[['invPlatform','Plataforma / Bróker'],['invClass','Clase de activo'],['invCategory','Categoría'],['invSubcategory','Subcategoría']];return rows.filter(r=>filters.every(([k,f])=>{const s=selectedLocal(k);return!s.length||s.includes(String(r[f]||''));}));}
  function ensureInvestmentModeFilter(){
    if(activeView()!=='inversiones')return;
    const grid=document.querySelector('#sectionFilterBar .section-filter-grid');if(!grid||grid.querySelector('#investmentV2ModeFilter'))return;
    const options=[{value:'capital',label:'Solo capital'},{value:'result',label:'Ganancia / pérdida'},{value:'total',label:'Capital + ganancia/pérdida'}];
    grid.appendChild(createMultiFilter({id:'investmentV2ModeFilter',label:'Valor a mostrar',options,single:true,selected:()=>state.investmentMode,onChange:value=>{state.investmentMode=value;run(false,30);}}));
  }
  function renderInvestment(p){
    if(activeView()!=='inversiones')return; ensureInvestmentModeFilter();
    const root=document.getElementById('viewRoot');if(!root)return;
    const rawPos=source(p,'Posiciones!A:X'),pos=latestPerPlatform(positionFiltered(rawPos)),summary=source(p,'Resumen_Inversiones!A:N'),currency=currentCurrency(),rates=investmentRates(rawPos),platformSel=selectedLocal('invPlatform');
    const summaryFiltered=summary.filter(r=>!platformSel.length||platformSel.some(v=>norm(v).includes(norm(r.Entidad))||norm(r.Entidad).includes(norm(v).split('/')[0].trim())));
    const mode=state.investmentMode;
    const byPlatform=new Map();
    if(mode==='total'){
      pos.forEach(r=>{const k=r['Plataforma / Bróker']||'Sin plataforma',v=parseNumber(r[`Valor ${currency}`]);byPlatform.set(k,(byPlatform.get(k)||0)+v);});
    }else{
      summaryFiltered.forEach(r=>{const market=parseNumber(r['Valor mercado']),capital=parseNumber(r['Aportes/Incrementos']),result=String(r.Resultado||'').trim()?parseNumber(r.Resultado):market-capital;const base=r['Moneda base']||'COP';const raw=mode==='capital'?capital:result;const key=norm(r.Entidad).includes('arq')?'ARQ / Alpaca':r.Entidad||'Sin plataforma';byPlatform.set(key,convertBase(raw,base,currency,rates));});
    }
    const total=[...byPlatform.values()].reduce((a,b)=>a+b,0),modeLabel=mode==='capital'?'Capital aportado':mode==='result'?'Ganancia / pérdida':'Capital + ganancia/pérdida';
    root.querySelector('#investmentCorrected')?.classList.add('investment-base-hidden');
    let host=root.querySelector('#investmentV2');if(!host){host=document.createElement('section');host.id='investmentV2';const head=root.querySelector('.section-head');head?.insertAdjacentElement('afterend',host);}
    const categoryFilters=selectedLocal('invClass').length||selectedLocal('invCategory').length||selectedLocal('invSubcategory').length;
    host.innerHTML=`<div class="v2-kpis"><div class="v2-kpi"><span>${esc(modeLabel)}</span><strong>${esc(money(total,currency))}</strong><small>${mode==='total'?`${pos.length} posiciones en último corte por plataforma`:'Según Resumen_Inversiones'}</small></div>${[...byPlatform.entries()].map(([k,v])=>`<div class="v2-kpi"><span>${esc(k)}</span><strong>${esc(money(v,currency))}</strong><small>${esc(modeLabel)}</small></div>`).join('')}</div>
    ${mode!=='total'&&categoryFilters?'<div class="v2-note">Los filtros de clase, categoría y subcategoría se aplican a las posiciones de mercado. El capital y la ganancia/pérdida están consolidados por plataforma en el Sheet, por lo que esos tres filtros no pueden repartirlos por instrumento sin inventar una distribución.</div>':''}
    <div class="panel"><div class="panel-header"><div class="panel-title"><strong>${esc(modeLabel)} por plataforma</strong><span>Vista según el filtro seleccionado</span></div></div><div class="v2-chart"><canvas id="investmentV2Chart"></canvas></div></div>
    ${mode==='total'?`<div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>Posiciones consolidadas</strong><span>${pos.length} posiciones · último corte disponible de cada plataforma</span></div></div><div class="table-scroll"><table class="v2-table"><thead><tr><th>Fecha</th><th>Plataforma</th><th>Símbolo</th><th>Instrumento</th><th>Clase</th><th>Categoría</th><th>Subcategoría</th><th>Valor ${esc(currency)}</th></tr></thead><tbody>${pos.map(r=>`<tr><td>${esc(r.Fecha)}</td><td>${esc(r['Plataforma / Bróker'])}</td><td>${esc(r.Símbolo)}</td><td>${esc(r.Instrumento)}</td><td>${esc(r['Clase de activo'])}</td><td>${esc(r.Categoría)}</td><td>${esc(r.Subcategoría)}</td><td class="money-cell">${esc(money(parseNumber(r[`Valor ${currency}`]),currency))}</td></tr>`).join('')}</tbody></table></div></div>`:`<div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>Capital y resultado por plataforma</strong><span>El resultado negativo se muestra como pérdida</span></div></div><div class="table-scroll"><table class="v2-table"><thead><tr><th>Plataforma</th><th>Fecha corte</th><th>Capital</th><th>Ganancia / pérdida</th><th>Total</th></tr></thead><tbody>${summaryFiltered.map(r=>{const market=parseNumber(r['Valor mercado']),capital=parseNumber(r['Aportes/Incrementos']),result=String(r.Resultado||'').trim()?parseNumber(r.Resultado):market-capital,base=r['Moneda base']||'COP';return`<tr><td>${esc(r.Entidad)}</td><td>${esc(r['Fecha corte'])}</td><td class="money-cell">${esc(money(convertBase(capital,base,currency,rates),currency))}</td><td class="money-cell">${esc(money(convertBase(result,base,currency,rates),currency))}</td><td class="money-cell">${esc(money(convertBase(market,base,currency,rates),currency))}</td></tr>`;}).join('')}</tbody></table></div></div>`}`;
    if(window.Chart){try{investmentChart?.destroy()}catch(_){};const canvas=document.getElementById('investmentV2Chart');if(canvas)investmentChart=new Chart(canvas,{type:'bar',data:{labels:[...byPlatform.keys()],datasets:[{label:modeLabel,data:[...byPlatform.values()]}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa8ba'}}},scales:{x:{ticks:{color:'#718098'},grid:{color:'#121c29'}},y:{beginAtZero:mode!=='result',ticks:{color:'#718098'},grid:{color:'#121c29'}}}}});}
  }

  function ensurePensionFilters(){
    if(activeView()!=='pension')return;
    let bar=document.getElementById('pensionV2FilterBar');
    const global=document.getElementById('filterBar');
    if(!bar){bar=document.createElement('section');bar.id='pensionV2FilterBar';bar.className='filter-bar section-filter-bar';bar.innerHTML='<div class="filter-head"><div><span class="eyebrow">FILTROS DE LA SECCIÓN</span><strong>Pensión y cesantías</strong></div></div><div class="section-filter-grid"></div>';global?.insertAdjacentElement('afterend',bar);}
    const grid=bar.querySelector('.section-filter-grid');if(!grid)return;
    if(!grid.querySelector('#pensionBucketFilter'))grid.appendChild(createMultiFilter({id:'pensionBucketFilter',label:'Componente',options:[{value:'pension',label:'Pensión'},{value:'cesantias',label:'Cesantías'},{value:'all',label:'Pensión + cesantías'}],single:true,selected:()=>state.pensionBucket,onChange:v=>{state.pensionBucket=v;run(false,30);}}));
    if(!grid.querySelector('#pensionModeFilter'))grid.appendChild(createMultiFilter({id:'pensionModeFilter',label:'Valor a mostrar',options:[{value:'capital',label:'Solo capital'},{value:'result',label:'Ganancia / pérdida'},{value:'total',label:'Capital + ganancia/pérdida'}],single:true,selected:()=>state.pensionMode,onChange:v=>{state.pensionMode=v;run(false,30);}}));
  }
  function pensionFiltered(rows){const years=selectedGlobal('year'),months=selectedGlobal('month').map(Number);return rows.filter(r=>{const d=parseDate(r.Fecha);return(!years.length||years.includes(String(r.Año||d?.getFullYear()||'')))&&(!months.length||months.includes(Number(d?.getMonth()+1)||0));});}
  function pensionValue(row,bucket,mode){
    const pCap=parseNumber(row['Aporte pensión COP']),pRes=parseNumber(row['Rendimiento pensión COP']),pTot=parseNumber(row['Total pensión COP']),cTot=parseNumber(row['Total cesantías COP']);
    if(bucket==='pension')return mode==='capital'?pCap:mode==='result'?pRes:pTot;
    if(bucket==='cesantias')return mode==='result'?null:cTot;
    if(mode==='capital')return pCap+cTot;if(mode==='result')return pRes;return parseNumber(row['Patrimonio total COP'])||pTot+cTot;
  }
  function renderPension(p){
    if(activeView()!=='pension'){document.getElementById('pensionV2FilterBar')?.setAttribute('hidden','');return;}
    ensurePensionFilters();document.getElementById('pensionV2FilterBar')?.removeAttribute('hidden');
    const root=document.getElementById('viewRoot');if(!root)return;const all=source(p,'Pensiones_Cesantias!A:T'),filtered=pensionFiltered(all),rows=filtered.length?filtered:all,last=rows[rows.length-1]||{},prev=rows[rows.length-2]||{},bucket=state.pensionBucket,mode=state.pensionMode;
    const labelBucket=bucket==='pension'?'Pensión':bucket==='cesantias'?'Cesantías':'Pensión + cesantías',labelMode=mode==='capital'?'Capital':mode==='result'?'Ganancia / pérdida':'Capital + ganancia/pérdida',value=pensionValue(last,bucket,mode),prevValue=pensionValue(prev,bucket,mode),variation=value==null||prevValue==null?null:value-prevValue;
    root.querySelectorAll(':scope > .kpi-grid').forEach(el=>el.style.display='none');root.querySelectorAll(':scope > .panel').forEach(panel=>{const t=norm(panel.querySelector('.panel-title strong')?.textContent);if(t.includes('evolucion patrimonial')||t.includes('historico de pension'))panel.style.display='none';});
    let host=root.querySelector('#pensionV2');if(!host){host=document.createElement('section');host.id='pensionV2';root.querySelector('.section-head')?.insertAdjacentElement('afterend',host);}
    const noCesResult=bucket==='cesantias'&&mode==='result';
    host.innerHTML=`${noCesResult?'<div class="v2-note">El Sheet actual no separa capital y rendimiento dentro de cesantías. Por eso no se inventa una ganancia/pérdida para ese componente. En la vista combinada, la ganancia/pérdida disponible corresponde al rendimiento de pensión.</div>':''}<div class="v2-kpis"><div class="v2-kpi"><span>${esc(labelBucket)} · ${esc(labelMode)}</span><strong>${value==null?'—':esc(moneyCop(value))}</strong><small>Último registro ${esc(last.Fecha||'—')}</small></div><div class="v2-kpi"><span>Variación vs registro anterior</span><strong>${variation==null?'—':esc(moneyCop(variation))}</strong><small>${variation==null?'Sin base comparable':variation>=0?'Aumento':'Disminución'}</small></div><div class="v2-kpi"><span>Capital pensión</span><strong>${esc(moneyCop(parseNumber(last['Aporte pensión COP'])))}</strong><small>Aportes acumulados</small></div><div class="v2-kpi"><span>Rendimiento pensión</span><strong>${esc(moneyCop(parseNumber(last['Rendimiento pensión COP'])))}</strong><small>Ganancia/pérdida acumulada disponible</small></div></div>
      <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Evolución · ${esc(labelBucket)} · ${esc(labelMode)}</strong><span>Histórico según año/mes y filtros de la sección</span></div></div><div class="v2-chart"><canvas id="pensionV2Chart"></canvas></div></div>
      <div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>Histórico detallado</strong><span>Capital, rendimiento y total disponibles en la fuente</span></div></div><div class="table-scroll"><table class="v2-table"><thead><tr><th>Fecha</th><th>Capital pensión</th><th>Rendimiento pensión</th><th>Total pensión</th><th>Total cesantías</th><th>Patrimonio total</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.Fecha)}</td><td class="money-cell">${esc(r['Aporte pensión COP'])}</td><td class="money-cell">${esc(r['Rendimiento pensión COP'])}</td><td class="money-cell">${esc(r['Total pensión COP'])}</td><td class="money-cell">${esc(r['Total cesantías COP'])}</td><td class="money-cell">${esc(r['Patrimonio total COP'])}</td></tr>`).join('')}</tbody></table></div></div>`;
    if(window.Chart){try{pensionChart?.destroy()}catch(_){};const canvas=document.getElementById('pensionV2Chart');if(canvas)pensionChart=new Chart(canvas,{type:'line',data:{labels:rows.map(r=>r.Fecha),datasets:[{label:`${labelBucket} · ${labelMode}`,data:rows.map(r=>pensionValue(r,bucket,mode))}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa8ba'}}},scales:{x:{ticks:{color:'#718098'},grid:{color:'#121c29'}},y:{ticks:{color:'#718098'},grid:{color:'#121c29'}}}}});}
  }

  function incomeAll(){return state.incomeTypes.size===4;}
  function ensureIncomeFilter(){
    const grid=document.getElementById('globalFilters');if(activeView()!=='ingresos'){grid?.querySelector('#incomeV2TypeFilter')?.remove();return;}if(!grid||grid.querySelector('#incomeV2TypeFilter'))return;
    const options=[{value:'payroll',label:'Nómina COP'},{value:'usd',label:'Fibrazo LLC · USD'},{value:'prima',label:'Primas'},{value:'extras',label:'Extras'}];
    grid.appendChild(createMultiFilter({id:'incomeV2TypeFilter',label:'Tipo de ingreso',options,selected:()=>[...state.incomeTypes],onChange:value=>{if(state.incomeTypes.has(value)){if(state.incomeTypes.size>1)state.incomeTypes.delete(value);}else state.incomeTypes.add(value);run(false,30);}}));
  }
  function incomeConceptRows(p){
    const rows=source(p,'Resumen_Conceptos_Ingresos!A:L'),years=selectedGlobal('year'),months=selectedGlobal('month').map(Number);
    return rows.filter(r=>{const d=parseMonth(r.Mes);return(!years.length||years.includes(String(d?.getFullYear()||'')))&&(!months.length||months.includes(d?.getMonth()+1));});
  }
  function incomeRowType(row){const concept=norm(row.Concepto),type=norm(row.Tipo),mon=norm(row['Moneda original']);if(concept.includes('prima'))return'prima';if(type.includes('ingreso laboral')&&(mon==='usd'||concept.includes('usd')||concept.includes('fibrazo')))return'usd';if(type.includes('ingreso laboral')||concept.includes('sueldo componente cop'))return'payroll';return'extras';}
  function renderIncome(p){
    if(activeView()!=='ingresos')return;ensureIncomeFilter();
    const root=document.getElementById('viewRoot');if(!root)return;root.querySelector('#incomeTypeFilter')?.setAttribute('hidden','');
    const selected=state.incomeTypes,concepts=incomeConceptRows(p),details=source(p,'Detalle_Ingresos!A:L');
    const payroll=concepts.reduce((s,r)=>s+parseNumber(r['Sueldo COP']),0),usd=concepts.reduce((s,r)=>s+parseNumber(r['Sueldo USD (equiv. COP)']),0),prima=concepts.reduce((s,r)=>s+parseNumber(r['Prima COP'])+parseNumber(r['Prima USD (equiv. COP)']),0),tot=concepts.reduce((s,r)=>s+parseNumber(r['Total consolidado']),0),extras=Math.max(0,tot-payroll-usd-prima);
    const cards=[...root.querySelectorAll('[data-income-complete] .kpi-card')];
    const byLabel=txt=>cards.find(c=>norm(c.querySelector('.kpi-label')?.textContent).includes(txt));
    const payCard=byLabel('nomina colombia'),usdCard=byLabel('ingresos usd'),extraCard=byLabel('extras / otros'),totalCard=byLabel('total consolidado');
    if(payCard)payCard.hidden=!selected.has('payroll');if(usdCard)usdCard.hidden=!selected.has('usd');
    if(extraCard){const show=selected.has('prima')||selected.has('extras');extraCard.hidden=!show;const label=extraCard.querySelector('.kpi-label'),value=extraCard.querySelector('.kpi-value');if(label)label.textContent=selected.has('prima')&&selected.has('extras')?'Primas + extras':selected.has('prima')?'Primas':'Extras';if(value)value.textContent=moneyCop((selected.has('prima')?prima:0)+(selected.has('extras')?extras:0));}
    if(totalCard)totalCard.hidden=!incomeAll();

    const panels=[...root.querySelectorAll('[data-income-complete] .panel')];
    panels.forEach(panel=>{const t=norm(panel.querySelector('.panel-title strong')?.textContent);if(t==='nomina colombia')panel.hidden=!selected.has('payroll');else if(t==='pagos recibidos en usd'||t==='facturacion en usd')panel.hidden=!selected.has('usd');else if(t==='detalle de ingresos y extras')panel.hidden=!(selected.has('prima')||selected.has('extras'));});

    const detailPanel=panels.find(x=>norm(x.querySelector('.panel-title strong')?.textContent)==='detalle de ingresos y extras');
    const detailTable=detailPanel?.querySelector('table');if(detailTable){const heads=[...detailTable.querySelectorAll('th')].map(x=>norm(x.textContent)),conceptIdx=heads.indexOf('concepto'),typeIdx=heads.indexOf('tipo'),monIdx=heads.indexOf('moneda original');detailTable.querySelectorAll('tbody tr').forEach(tr=>{const fake={Concepto:tr.cells[conceptIdx]?.textContent||'',Tipo:tr.cells[typeIdx]?.textContent||'','Moneda original':tr.cells[monIdx]?.textContent||''};tr.hidden=!selected.has(incomeRowType(fake));});}

    const conceptPanel=panels.find(x=>norm(x.querySelector('.panel-title strong')?.textContent)==='conceptos consolidados');const table=conceptPanel?.querySelector('table');if(table){const heads=[...table.querySelectorAll('thead th')];heads.forEach((th,i)=>{const h=norm(th.textContent);let visible=h==='mes';if(h.includes('sueldo cop'))visible=selected.has('payroll');else if(h.includes('sueldo usd'))visible=selected.has('usd');else if(h.includes('prima'))visible=selected.has('prima');else if(h.includes('total consolidado'))visible=incomeAll();else if(h!=='mes')visible=selected.has('extras');th.hidden=!visible;table.querySelectorAll('tbody tr').forEach(tr=>{if(tr.cells[i])tr.cells[i].hidden=!visible;});});}

    if(window.Chart){const canvas=root.querySelector('#incomeCompleteChart'),chart=canvas&&Chart.getChart?.(canvas);if(chart&&concepts.length){const labels=concepts.map(r=>r.Mes),p=concepts.map(r=>parseNumber(r['Sueldo COP'])),u=concepts.map(r=>parseNumber(r['Sueldo USD (equiv. COP)'])),pr=concepts.map(r=>parseNumber(r['Prima COP'])+parseNumber(r['Prima USD (equiv. COP)'])),tt=concepts.map(r=>parseNumber(r['Total consolidado'])),ex=tt.map((v,i)=>Math.max(0,v-p[i]-u[i]-pr[i]));chart.data.labels=labels;chart.data.datasets=[{label:'Nómina COP',data:p,hidden:!selected.has('payroll'),borderWidth:2,tension:.25},{label:'Fibrazo LLC · USD',data:u,hidden:!selected.has('usd'),borderWidth:2,tension:.25},{label:'Primas',data:pr,hidden:!selected.has('prima'),borderWidth:2,tension:.25},{label:'Extras',data:ex,hidden:!selected.has('extras'),borderWidth:2,tension:.25},{label:'Total consolidado',data:tt,hidden:!incomeAll(),borderWidth:3,tension:.25}];chart.update('none');}}
  }

  async function run(force=false,delay=0){
    clearTimeout(timer);timer=setTimeout(async()=>{
      injectStyles();unifyServicesFilters();ensureIncomeFilter();
      const view=activeView();
      if(view!=='pension')document.getElementById('pensionV2FilterBar')?.setAttribute('hidden','');
      if(!['deudas','inversiones','pension','ingresos'].includes(view))return;
      const p=await payload(force).catch(e=>{console.error('Dashboard V2:',e);return null;});if(!p)return;
      if(view==='deudas')renderDebt(p);if(view==='inversiones')renderInvestment(p);if(view==='pension')renderPension(p);if(view==='ingresos')renderIncome(p);
    },delay);
  }

  injectStyles();
  document.addEventListener('click',e=>{
    if(e.target.closest('.nav-item,.currency-btn,.multi-filter-option,#resetCurrentMonth,#clearFilters,#refreshBtn')){
      if(e.target.closest('#clearFilters')&&activeView()==='servicios')setTimeout(()=>document.querySelectorAll('.services-merged-local .local-clear').forEach(btn=>btn.click()),20);
      if(e.target.closest('#refreshBtn')){cache=null;cacheAt=0;run(true,650);}else run(false,180);
    }
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.local-multi-filter'))document.querySelectorAll('.v2-static-filter.open').forEach(x=>x.classList.remove('open'));});
  const root=document.getElementById('viewRoot');if(root)new MutationObserver(()=>run(false,100)).observe(root,{childList:true,subtree:false});
  const main=document.querySelector('.main');if(main)new MutationObserver(()=>{unifyServicesFilters();ensureIncomeFilter();ensureInvestmentModeFilter();}).observe(main,{childList:true,subtree:false});
  run(false,300);
})();
