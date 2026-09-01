(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  const root = document.getElementById('viewRoot');
  if (!root) return;

  let renderFrame = 0;
  let requestVersion = 0;
  let pendingForce = false;

  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function activeView(){ return document.querySelector('.nav-item.active')?.dataset.view || 'general'; }

  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return [];
    const headers=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!==''))
      .map(r=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,r?.[i]??''])));
  }

  function rowsFromPayload(payload,range){
    const cached=window.__PANEL_GET_CACHED_ROWS__;
    if(typeof cached==='function')return cached(payload,financeId,range);
    return parseRows(payload?.sources?.[`${financeId}|${range}`]||[]);
  }

  async function loadSources(force=false){
    const getData=window.__PANEL_GET_BACKEND_DATA__;
    if(typeof getData!=='function')return {cycles:[],installments:[]};
    const payload=await getData(force);
    return {
      cycles:rowsFromPayload(payload,'Pagos_Tarjetas!A:T'),
      installments:rowsFromPayload(payload,'Cuotas!A:T')
    };
  }

  function parseNumber(value){
    if(typeof value==='number')return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');
    if(!s)return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0){if(comma>dot)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
    else if(comma>=0){const p=s.split(',');s=p.length===2&&p[1].length<=4?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(dot>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function parseDate(value){
    const s=String(value||'').trim();
    if(!s)return null;
    let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(m)return new Date(+m[1],+m[2]-1,+m[3]);
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    const d=new Date(s);return Number.isNaN(d.getTime())?null:d;
  }

  function parseMonth(value){
    const s=norm(value);
    if(!s)return null;
    let m=s.match(/^(\d{4})[-\/]([01]?\d)/);
    if(m)return new Date(+m[1],+m[2]-1,1);
    m=s.match(/([a-z]+)[\s\-\/]+(\d{4})/);
    if(m){
      const token=m[1].replace('set','sept');
      const idx=MONTHS.findIndex(x=>token.startsWith(x));
      if(idx>=0)return new Date(+m[2],idx,1);
    }
    const d=parseDate(value);return d?new Date(d.getFullYear(),d.getMonth(),1):null;
  }

  function addMonths(date,n){ return new Date(date.getFullYear(),date.getMonth()+n,1); }
  function monthKey(date){ return date?`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`:''; }
  function monthLabel(date){ return date?`${MONTHS[date.getMonth()]} ${date.getFullYear()}`:'—'; }
  function dateLabel(value){const d=value instanceof Date?value:parseDate(value);return d?`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`:'—';}
  function money(value){return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value)||0);}

  function cardId(value,titular=''){
    const s=norm(`${value} ${titular}`);
    if(s.includes('arq'))return 'TC-ARQ-EDU';
    if(s.includes('nu')&&(s.includes('rocio')||s.includes('rocío')||/\bro\b/.test(s)))return 'TC-NU-RO';
    if(s.includes('nu'))return 'TC-NU-EDU';
    return String(value||'').startsWith('TC-')?String(value):'';
  }

  function cardLabel(id){
    if(id==='TC-NU-EDU')return 'Nu · Edu';
    if(id==='TC-NU-RO')return 'Nu · Rocío';
    if(id==='TC-ARQ-EDU')return 'ARQ · Edu';
    return id||'Tarjeta';
  }

  function isPaid(row){
    const p=norm(row?.Pagado);
    return ['si','sí','pagado','pago','yes','true'].includes(p)||!!parseDate(row?.['Fecha pago'])||parseNumber(row?.['Monto pagado real'])>0;
  }

  function latestClosedCycleMap(cycles,now){
    const map=new Map();
    (cycles||[]).forEach(row=>{
      const id=cardId(row.Tarjeta,row.Titular),cut=parseDate(row['Fecha corte']);
      if(!id||!cut||cut>now)return;
      const previous=map.get(id);
      if(!previous||cut>previous.cut)map.set(id,{row,cut});
    });
    return map;
  }

  function pendingInstallment(row,cycleMap,now){
    const first=parseMonth(row['Fecha primera cuota']);
    const installment=Math.max(1,Math.round(parseNumber(row['Cuota actual']))||1);
    if(!first)return null;
    const scheduled=addMonths(first,installment-1);
    const id=cardId(row.Tarjeta,row.Titular);
    const detail=norm(row['Estado detalle']);
    const status=norm(row.Estado);
    if(detail.includes('pagad')||status.includes('pagad'))return {pending:false,scheduled,id};
    if(detail==='por pagar'||detail.includes('programad')||detail.includes('pend'))return {pending:true,scheduled,id};
    const cycle=cycleMap.get(id)?.row||null;
    const currentMonth=new Date(now.getFullYear(),now.getMonth(),1);
    if(!cycle)return {pending:scheduled>=currentMonth,scheduled,id};
    const cut=parseDate(cycle['Fecha corte']);
    if(!cut)return {pending:scheduled>=currentMonth,scheduled,id};
    const cutMonth=new Date(cut.getFullYear(),cut.getMonth(),1);
    const cmp=scheduled-cutMonth;
    return {pending:cmp>0||(cmp===0&&!isPaid(cycle)),scheduled,id};
  }

  function groupPurchases(rows,cycles,now){
    const groups=new Map(),cycleMap=latestClosedCycleMap(cycles,now);
    rows.forEach(row=>{
      const id=cardId(row.Tarjeta,row.Titular);
      const total=parseNumber(row['Total compra']);
      const key=String(row['ID compra']||'').trim()||[id,row['Fecha compra'],norm(row.Descripción||row.Comercio),total].join('|');
      if(!groups.has(key))groups.set(key,{id,fecha:row['Fecha compra'],comercio:row.Comercio||'',descripcion:row.Descripción||'',titular:row.Titular||'',total,moneda:row.Moneda||'COP',rows:[]});
      const pendingInfo=pendingInstallment(row,cycleMap,now);
      groups.get(key).rows.push({...row,__pendingInfo:pendingInfo,__n:Math.max(1,Math.round(parseNumber(row['N° cuotas']))||1),__cuota:Math.max(1,Math.round(parseNumber(row['Cuota actual']))||1),__valor:parseNumber(row['Valor cuota'])});
    });
    return [...groups.values()].map(g=>{
      g.rows.sort((a,b)=>a.__cuota-b.__cuota);
      const n=Math.max(...g.rows.map(r=>r.__n),1);
      const pending=g.rows.filter(r=>r.__pendingInfo?.pending).sort((a,b)=>a.__pendingInfo.scheduled-b.__pendingInfo.scheduled||a.__cuota-b.__cuota);
      const pendingTotal=pending.reduce((s,r)=>s+r.__valor,0);
      const paidCount=Math.max(0,n-pending.length);
      return {...g,n,pending,pendingTotal,paidCount,next:pending[0]||null,last:g.rows[g.rows.length-1]||null};
    }).sort((a,b)=>(parseDate(b.fecha)?.getTime()||0)-(parseDate(a.fecha)?.getTime()||0));
  }

  function installmentProjection(purchases){
    const map=new Map();
    purchases.forEach(p=>p.pending.forEach(r=>{
      const key=monthKey(r.__pendingInfo.scheduled);
      if(!key)return;
      const entry=map.get(key)||{date:r.__pendingInfo.scheduled,total:0,count:0};
      entry.total+=r.__valor;entry.count+=1;map.set(key,entry);
    }));
    return [...map.values()].sort((a,b)=>a.date-b.date);
  }

  function injectStyles(){
    if(document.getElementById('cardDebtTablesStyles'))return;
    const style=document.createElement('style');style.id='cardDebtTablesStyles';style.textContent=`
      .card-debt-stack{display:grid;gap:16px;margin-top:16px}
      .card-debt-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      .card-debt-kpi{border:1px solid var(--border-soft);background:#0e1520;border-radius:12px;padding:13px;min-width:0}
      .card-debt-kpi span{display:block;color:#6f8199;font-size:9px;text-transform:uppercase;letter-spacing:.05em;font-weight:700}
      .card-debt-kpi strong{display:block;color:#edf4ff;font-size:19px;margin-top:7px;white-space:normal;line-height:1.25}
      .card-debt-kpi small{display:block;color:#64758c;font-size:9px;margin-top:5px;line-height:1.4}
      .card-debt-table{min-width:1120px!important}
      .card-debt-table th,.card-debt-table td{white-space:normal!important;vertical-align:top;line-height:1.45}
      .card-debt-table .money-cell{white-space:nowrap!important;text-align:right;font-variant-numeric:tabular-nums}
      .card-debt-status{display:inline-flex;border-radius:99px;padding:4px 7px;font-size:9px;font-weight:800;border:1px solid var(--border)}
      .card-debt-status.pending{color:#ffcb68;border-color:rgba(246,200,68,.22);background:rgba(246,200,68,.08)}
      .card-debt-status.paid{color:#7ee6af;border-color:rgba(38,208,124,.22);background:rgba(38,208,124,.08)}
      .card-debt-empty{padding:22px;color:#718098;font-size:11px;line-height:1.55;text-align:center}
      .card-projection-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;padding:0 14px 14px}
      .card-projection-item{border:1px solid var(--border-soft);border-radius:10px;background:rgba(255,255,255,.02);padding:10px}
      .card-projection-item span{display:block;color:#70819a;font-size:9px;text-transform:uppercase;font-weight:700}
      .card-projection-item strong{display:block;margin-top:5px;color:#dce8f7;font-size:13px}
      .card-projection-item small{display:block;margin-top:4px;color:#63758d;font-size:9px}
      @media(max-width:900px){.card-debt-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:560px){.card-debt-kpis{grid-template-columns:1fr}}
    `;document.head.appendChild(style);
  }

  function selectedCard(){return String(window.__PANEL_ACTIVE_CARD_ID__||'').trim();}

  function renderPayments(cycles,selected){
    const rows=cycles.filter(r=>isPaid(r)&&(!selected||cardId(r.Tarjeta,r.Titular)===selected))
      .sort((a,b)=>(parseDate(b['Fecha pago'])||parseDate(b['Fecha corte'])||0)-(parseDate(a['Fecha pago'])||parseDate(a['Fecha corte'])||0));
    const body=rows.length?rows.map(r=>{
      const id=cardId(r.Tarjeta,r.Titular);
      const amount=parseNumber(r['Monto pagado real'])||parseNumber(r['Pago total']);
      const doc=String(r.Documento||'').trim();
      return `<tr><td>${esc(dateLabel(r['Fecha pago']))}</td><td>${esc(cardLabel(id))}</td><td>${esc(r.Titular||'—')}</td><td>${esc(dateLabel(r['Fecha corte']))}</td><td class="money-cell">${esc(money(amount))}</td><td class="money-cell">${esc(money(parseNumber(r['Pago total'])))}</td><td>${doc?`<a href="${esc(doc)}" target="_blank" rel="noopener">Ver soporte</a>`:'—'}</td><td>${esc(r['Observaciones pago']||'—')}</td></tr>`;
    }).join(''):`<tr><td colspan="8"><div class="card-debt-empty">Todavía no hay pagos con fecha confirmada en el maestro. Desde el próximo pago que registremos por chat, aparecerá aquí automáticamente. Los ciclos históricos sin fecha de pago no se marcan como pagados por inferencia.</div></td></tr>`;
    return `<div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>Pagos realizados</strong><span>Historial de pagos efectivamente confirmados · ${selected?esc(cardLabel(selected)):'todas las tarjetas'}</span></div></div><div class="table-scroll"><table class="card-debt-table"><thead><tr><th>Fecha pago</th><th>Tarjeta</th><th>Titular</th><th>Corte</th><th>Monto pagado</th><th>Total del corte</th><th>Soporte</th><th>Observaciones</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  function renderInstallments(purchases,projection,selected){
    const visible=purchases.filter(p=>!selected||p.id===selected);
    const pending=visible.filter(p=>p.pending.length);
    const pendingTotal=pending.reduce((s,p)=>s+p.pendingTotal,0);
    const pendingCount=pending.reduce((s,p)=>s+p.pending.length,0);
    const currentMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
    const currentTotal=projection.find(x=>monthKey(x.date)===monthKey(currentMonth))?.total||0;
    const futureTotal=Math.max(0,pendingTotal-currentTotal);
    const lastMonth=pending.flatMap(p=>p.pending.map(r=>r.__pendingInfo.scheduled)).sort((a,b)=>b-a)[0]||null;

    const rows=visible.map(p=>{
      const pendingText=p.pending.length?p.pending.map(r=>`${r.__cuota}/${p.n} · ${monthLabel(r.__pendingInfo.scheduled)}`).join('<br>'):'—';
      const next=p.next;
      return `<tr><td>${esc(dateLabel(p.fecha))}</td><td>${esc(cardLabel(p.id))}</td><td>${esc(p.descripcion||p.comercio||'—')}</td><td class="money-cell">${esc(money(p.total))}</td><td>${p.n}</td><td>${p.paidCount}</td><td>${p.pending.length}</td><td>${pendingText}</td><td class="money-cell">${next?esc(money(next.__valor)):'—'}</td><td class="money-cell">${esc(money(p.pendingTotal))}</td><td>${esc(next?monthLabel(next.__pendingInfo.scheduled):'—')}</td><td><span class="card-debt-status ${p.pending.length?'pending':'paid'}">${p.pending.length?'Pendiente':'Pagada'}</span></td></tr>`;
    }).join('')||`<tr><td colspan="12"><div class="card-debt-empty">No hay compras en cuotas para la tarjeta seleccionada.</div></td></tr>`;

    const projVisible=installmentProjection(visible);
    const proj=projVisible.length?`<div class="card-projection-grid">${projVisible.map(x=>`<div class="card-projection-item"><span>${esc(monthLabel(x.date))}</span><strong>${esc(money(x.total))}</strong><small>${x.count} cuota${x.count===1?'':'s'} comprometida${x.count===1?'':'s'}</small></div>`).join('')}</div>`:'<div class="card-debt-empty">Sin cuotas comprometidas en meses futuros.</div>';

    return `<div class="card-debt-kpis">
      <div class="card-debt-kpi"><span>Deuda pendiente en cuotas</span><strong>${esc(money(pendingTotal))}</strong><small>Cuotas del corte actual pendientes + meses futuros</small></div>
      <div class="card-debt-kpi"><span>Cuotas pendientes</span><strong>${pendingCount}</strong><small>${pending.length} compra${pending.length===1?'':'s'} con saldo</small></div>
      <div class="card-debt-kpi"><span>Después del corte actual</span><strong>${esc(money(futureTotal))}</strong><small>Crédito ya comprometido en meses siguientes</small></div>
      <div class="card-debt-kpi"><span>Última cuota prevista</span><strong>${esc(lastMonth?monthLabel(lastMonth):'Sin deuda')}</strong><small>Fin del compromiso vigente</small></div>
    </div>
    <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Compromiso de cuotas por mes</strong><span>Lo que ya está reservado en crédito antes de nuevas compras</span></div></div>${proj}</div>
    <div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>Compras en cuotas</strong><span>Histórico completo y saldo pendiente por compra · ${selected?esc(cardLabel(selected)):'todas las tarjetas'}</span></div></div><div class="table-scroll"><table class="card-debt-table"><thead><tr><th>Fecha compra</th><th>Tarjeta</th><th>Compra</th><th>Total compra</th><th>Cuotas</th><th>Pagadas</th><th>Pendientes</th><th>Cuotas pendientes</th><th>Próxima cuota</th><th>Saldo pendiente</th><th>Próximo mes</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  async function render(force=false){
    if(activeView()!=='tarjetas')return;
    const version=++requestVersion;
    injectStyles();
    const {cycles,installments}=await loadSources(force).catch(()=>({cycles:null,installments:null}));
    if(version!==requestVersion||!cycles||!installments||activeView()!=='tarjetas')return;
    const now=new Date();
    const purchases=groupPurchases(installments,cycles,now);
    const selected=selectedCard();
    const visible=purchases.filter(p=>!selected||p.id===selected);
    const projection=installmentProjection(visible);

    let host=root.querySelector('#cardPaymentsInstallments');
    if(!host){host=document.createElement('div');host.id='cardPaymentsInstallments';host.className='card-debt-stack';root.appendChild(host);}
    host.innerHTML=`${renderPayments(cycles,selected)}${renderInstallments(purchases,projection,selected)}`;
  }

  function scheduleRender(force=false){
    pendingForce=pendingForce||force;
    if(renderFrame)return;
    renderFrame=requestAnimationFrame(()=>{
      renderFrame=0;
      const useForce=pendingForce;
      pendingForce=false;
      render(useForce).catch(console.error);
    });
  }
  document.addEventListener('panel:view-root-changed',event=>{
    if(event.detail?.view==='tarjetas')scheduleRender(false);else requestVersion++;
  });
  document.addEventListener('panel:card-filter-changed',()=>scheduleRender(false));
  document.addEventListener('panel:section-filters-changed',event=>{
    if(event.detail?.view==='tarjetas')scheduleRender(false);
  });

  queueMicrotask(()=>scheduleRender(false));
})();
