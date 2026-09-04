(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!financeId)return;

  const RANGES={accounts:'Cuentas!A:T',cycles:'Pagos_Tarjetas!A:T',cards:'Tarjetas!A:T'};
  let frame=0,version=0,lastSignature='';

  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function parseDate(value){
    const s=String(value||'').trim();
    let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(m)return new Date(+m[1],+m[2]-1,+m[3]);
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    const d=new Date(s);return Number.isNaN(d.getTime())?null:d;
  }
  function monthKeyFromDate(date){return date?`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`:''}
  function previousCompletedMonth(now=new Date()){return monthKeyFromDate(new Date(now.getFullYear(),now.getMonth()-1,1))}
  function addMonths(key,n){
    const m=String(key||'').match(/^(\d{4})-(\d{2})$/);if(!m)return'';
    return monthKeyFromDate(new Date(+m[1],+m[2]-1+n,1));
  }
  function periodLabel(key){
    const m=String(key||'').match(/^(\d{4})-(\d{2})$/);if(!m)return key||'—';
    const d=new Date(+m[1],+m[2]-1,1);
    return new Intl.DateTimeFormat('es-CO',{month:'short',year:'numeric'}).format(d).replace('.','');
  }
  function dateLabel(value){const d=value instanceof Date?value:parseDate(value);return d?new Intl.DateTimeFormat('es-CO',{day:'2-digit',month:'short',year:'numeric'}).format(d):'—'}
  function rows(payload,range){const cached=window.__PANEL_GET_CACHED_ROWS__;return typeof cached==='function'?cached(payload,financeId,range):[]}

  function accountItems(accounts,now){
    const expected=previousCompletedMonth(now);
    return accounts.filter(r=>norm(r['Control de resumen'])==='mensual').map(r=>{
      const last=String(r['Último período cargado']||'').trim();
      const status=last&&last>=expected?'Al día':'Pendiente';
      return{
        key:String(r['ID cuenta']||''),
        institution:String(r.Institución||''),
        product:String(r['Producto / Cuenta']||''),
        holder:String(r.Titular||''),
        kind:norm(r.Tipo).includes('broker')?'Inversión':'Cuenta',
        last:last||'—',
        expected,
        status,
        next:status==='Pendiente'?(r['Próximo esperado']||`Subir ${periodLabel(expected)}`):`${periodLabel(addMonths(expected,1))} al cierre`,
        document:String(r.Documento||'').trim()
      };
    });
  }

  function cardLabel(id,holder){
    if(id==='TC-NU-EDU')return{institution:'Nu',product:'Tarjeta de crédito',holder:'Edu'};
    if(id==='TC-NU-RO')return{institution:'Nu',product:'Tarjeta de crédito',holder:'Rocío'};
    if(id==='TC-ARQ-EDU')return{institution:'ARQ',product:'Línea de crédito',holder:'Edu'};
    return{institution:'Tarjeta',product:id||'Crédito',holder:holder||''};
  }
  function cardItems(cards,cycles,now){
    return cards.filter(r=>String(r['ID tarjeta']||'').trim()).map(card=>{
      const id=String(card['ID tarjeta']||'').trim();
      const own=cycles.filter(r=>String(r.Tarjeta||'').trim()===id);
      const closed=own.map(r=>({row:r,cut:parseDate(r['Fecha corte'])})).filter(x=>x.cut&&x.cut<=now).sort((a,b)=>b.cut-a.cut)[0]||null;
      const latestDoc=own.filter(r=>String(r.Documento||'').trim()).map(r=>({row:r,cut:parseDate(r['Fecha corte'])})).filter(x=>x.cut).sort((a,b)=>b.cut-a.cut)[0]||null;
      const upcoming=own.map(r=>({row:r,cut:parseDate(r['Fecha corte'])})).filter(x=>x.cut&&x.cut>now).sort((a,b)=>a.cut-b.cut)[0]||null;
      const label=cardLabel(id,card.Titular);
      let status='Pendiente',expected='',next='',last='—',document='';
      if(latestDoc){
        document=String(latestDoc.row.Documento||'').trim();
        const due=parseDate(latestDoc.row['Fecha vencimiento']);
        expected=due?monthKeyFromDate(due):addMonths(monthKeyFromDate(latestDoc.cut),1);
        last=expected||monthKeyFromDate(latestDoc.cut);
      }
      if(upcoming&&(!closed||upcoming.cut>closed.cut)){
        status='Próximo';
        expected=monthKeyFromDate(upcoming.cut);
        next=`Corte previsto ${dateLabel(upcoming.cut)}`;
      }else if(closed){
        const closedDoc=String(closed.row.Documento||'').trim();
        status=closedDoc?'Al día':'Pendiente';
        expected=monthKeyFromDate(closed.cut);
        next=closedDoc?'Esperar próximo corte':`Falta extracto del corte ${dateLabel(closed.cut)}`;
        if(closedDoc){document=closedDoc;last=expected;}
      }
      return{key:id,institution:label.institution,product:label.product,holder:label.holder,kind:'Crédito',last:last||'—',expected:expected||'—',status,next:next||'—',document};
    });
  }

  function tone(status){const n=norm(status);if(n.includes('pend'))return'pending';if(n.includes('proxim'))return'upcoming';return'good'}
  function style(){
    if(document.getElementById('statementStatusStyles'))return;
    const s=document.createElement('style');s.id='statementStatusStyles';s.textContent=`
      #viewRoot .statement-status-panel{margin:0 0 14px}
      #viewRoot .statement-status-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}
      #viewRoot .statement-status-summary>div{padding:9px 10px;border:1px solid var(--border-soft);border-radius:10px;background:rgba(255,255,255,.018);display:grid;gap:3px}
      #viewRoot .statement-status-summary span{font-size:8px;text-transform:uppercase;letter-spacing:.055em;color:#71839a;font-weight:800}
      #viewRoot .statement-status-summary strong{font-size:15px}
      #viewRoot .statement-status-summary .pending strong{color:#ffcb68}
      #viewRoot .statement-status-summary .good strong{color:#79e1ab}
      #viewRoot .statement-status-summary .upcoming strong{color:#8ab2ff}
      #viewRoot .statement-status-table{min-width:920px}
      #viewRoot .statement-status-table td{vertical-align:middle}
      #viewRoot .statement-status-badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border);border-radius:999px;padding:4px 7px;font-size:9px;font-weight:800;white-space:nowrap}
      #viewRoot .statement-status-badge.good{color:#79e1ab;border-color:rgba(38,208,124,.23);background:rgba(38,208,124,.06)}
      #viewRoot .statement-status-badge.pending{color:#ffcb68;border-color:rgba(246,200,68,.24);background:rgba(246,200,68,.06)}
      #viewRoot .statement-status-badge.upcoming{color:#8ab2ff;border-color:rgba(88,142,255,.24);background:rgba(88,142,255,.06)}
      #viewRoot .statement-status-link{color:#8ab2ff;text-decoration:none;font-weight:700}
      #viewRoot .statement-status-link:hover{text-decoration:underline}
      #viewRoot .statement-status-note{margin-top:8px;font-size:9px;line-height:1.45;color:#71839a}
      @media(max-width:720px){#viewRoot .statement-status-summary{grid-template-columns:1fr}}
    `;document.head.appendChild(s);
  }
  function signature(items){return items.map(x=>[x.key,x.last,x.expected,x.status,x.next,x.document].join(':')).join('|')}

  function render(items){
    const root=document.getElementById('viewRoot');if(!root||activeView()!=='servicios')return;
    const sig=signature(items);let host=document.getElementById('accountStatementStatusPanel');
    if(host&&host.dataset.signature===sig)return;
    if(!host){
      host=document.createElement('div');host.id='accountStatementStatusPanel';host.className='panel table-panel statement-status-panel';
      const context=root.querySelector(':scope > .secondary-context');
      if(context)context.insertAdjacentElement('afterend',host);
      else{
        const kpi=root.querySelector(':scope > .kpi-grid');
        kpi?root.insertBefore(host,kpi):root.prepend(host);
      }
    }
    host.dataset.signature=sig;
    const pending=items.filter(x=>x.status==='Pendiente').length,good=items.filter(x=>x.status==='Al día').length,upcoming=items.filter(x=>x.status==='Próximo').length;
    host.innerHTML=`<div class="panel-header"><div class="panel-title"><strong>Control de resúmenes y extractos</strong><span>Qué falta cargar para mantener cuentas, inversiones y tarjetas al día</span></div></div>
      <div class="statement-status-summary"><div class="pending"><span>Pendientes</span><strong>${pending}</strong></div><div class="good"><span>Al día</span><strong>${good}</strong></div><div class="upcoming"><span>Próximos</span><strong>${upcoming}</strong></div></div>
      <div class="table-scroll"><table class="data-table statement-status-table"><thead><tr><th>Institución</th><th>Producto</th><th>Titular</th><th>Tipo</th><th>Último cargado</th><th>Esperado</th><th>Estado</th><th>Próximo / acción</th><th>Documento</th></tr></thead><tbody>
      ${items.map(x=>`<tr><td><strong>${esc(x.institution)}</strong></td><td>${esc(x.product)}</td><td>${esc(x.holder||'—')}</td><td>${esc(x.kind)}</td><td>${esc(periodLabel(x.last))}</td><td>${esc(periodLabel(x.expected))}</td><td><span class="statement-status-badge ${tone(x.status)}">${esc(x.status)}</span></td><td>${esc(x.next||'—')}</td><td>${x.document?`<a class="statement-status-link" href="${esc(x.document)}" target="_blank" rel="noopener">Ver último</a>`:'—'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="statement-status-note">Mercado Pago y Nequi permanecen en Cuentas como plataformas activas, pero no se controlan aquí porque no estamos usando un extracto mensual formal para mantener el dashboard.</div>`;
  }

  async function run(){
    if(activeView()!=='servicios')return;
    const token=++version,get=window.__PANEL_GET_BACKEND_DATA__;if(typeof get!=='function')return;
    const payload=await get(false).catch(()=>null);if(!payload||token!==version||activeView()!=='servicios')return;
    const now=new Date(),items=[
      ...accountItems(rows(payload,RANGES.accounts),now),
      ...cardItems(rows(payload,RANGES.cards),rows(payload,RANGES.cycles),now)
    ].sort((a,b)=>{
      const rank={Pendiente:0,Próximo:1,'Al día':2};
      return (rank[a.status]??9)-(rank[b.status]??9)||a.institution.localeCompare(b.institution,'es')||a.product.localeCompare(b.product,'es');
    });
    render(items);
  }
  function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;run().catch(console.error)})}

  style();
  document.addEventListener('panel:view-root-changed',e=>{if(e.detail?.view==='servicios')schedule();else version++});
  document.addEventListener('panel:backend-data-loaded',()=>{if(activeView()==='servicios')schedule()});
  document.addEventListener('panel:manual-refresh-complete',()=>{if(activeView()==='servicios')schedule()});
  document.addEventListener('panel:section-modules-ready',e=>{if(e.detail?.view==='servicios')schedule()});
  queueMicrotask(()=>{if(activeView()==='servicios')schedule()});
})();