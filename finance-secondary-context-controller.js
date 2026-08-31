(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const FINANCE_ID=String(cfg.financeSpreadsheetId||'');
  if(!FINANCE_ID)return;

  const RANGES={services:'Servicios!A:O',pension:'Pensiones_Cesantias!A:T',installments:'Cuotas!A:T',cycles:'Pagos_Tarjetas!A:T'};
  const MONTHS={ene:0,enero:0,feb:1,febrero:1,mar:2,marzo:2,abr:3,abril:3,may:4,mayo:4,jun:5,junio:5,jul:6,julio:6,ago:7,agosto:7,sep:8,sept:8,septiembre:8,oct:9,octubre:9,nov:10,noviembre:10,dic:11,diciembre:11};
  let frame=0,version=0,cache=null;
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';

  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const h=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));}
  function num(value){if(typeof value==='number'&&Number.isFinite(value))return value;let s=String(value??'').trim().replace(/[^0-9,.-]/g,'');if(!s)return 0;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(c>=0){const p=s.split(',');s=(p.length===2&&p[1].length<=2)?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}
  function date(value){const s=norm(value);let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);m=s.match(/^(\d{1,2})-(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)-(\d{4})$/);if(m)return new Date(+m[3],MONTHS[m[2]],+m[1]);return null;}
  function today(){const n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate());}
  function daysUntil(d){return Math.ceil((d-today())/86400000);}
  function money(v){return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);}
  function usd(v){return `US$${new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)||0)}`;}
  function number(v,d=1){return new Intl.NumberFormat('es-CO',{minimumFractionDigits:0,maximumFractionDigits:d}).format(Number(v)||0);}
  function dateLabel(d){const x=d instanceof Date?d:date(d);return x?new Intl.DateTimeFormat('es-CO',{day:'2-digit',month:'short',year:'numeric'}).format(x):'—';}

  async function source(range,force=false){const get=window.__PANEL_GET_SOURCE_VALUES__;if(typeof get!=='function')return[];return parseRows(await get(FINANCE_ID,range,force));}
  async function load(force=false){if(cache&&!force)return cache;const [services,pension,installments,cycles]=await Promise.all([source(RANGES.services,force),source(RANGES.pension,force),source(RANGES.installments,force),source(RANGES.cycles,force)]);cache={services,pension,installments,cycles};return cache;}

  function style(){if(document.getElementById('financeSecondaryContextStyles'))return;const s=document.createElement('style');s.id='financeSecondaryContextStyles';s.textContent=`
    .secondary-context{margin:0 0 14px;border:1px solid var(--border-soft);background:linear-gradient(180deg,rgba(15,24,38,.88),rgba(8,14,23,.94));border-radius:13px;padding:12px;display:grid;gap:10px}.secondary-context-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.secondary-context-head>div{display:grid;gap:3px}.secondary-context-head span{font-size:9px;font-weight:800;letter-spacing:.07em;color:#62a0ff}.secondary-context-head strong{font-size:13px;color:#edf4ff}.secondary-context-head small{font-size:10px;color:#71839a;line-height:1.4}.secondary-context-badge{border:1px solid var(--border);border-radius:99px;padding:5px 8px;font-size:9px;font-weight:800;color:#9eb7d8;white-space:nowrap}.secondary-context-badge.good{color:#79e1ab;border-color:rgba(38,208,124,.23);background:rgba(38,208,124,.06)}.secondary-context-badge.warn{color:#ffcb68;border-color:rgba(246,200,68,.24);background:rgba(246,200,68,.06)}.secondary-context-badge.bad{color:#ff8290;border-color:rgba(255,102,122,.24);background:rgba(255,102,122,.06)}
    .secondary-context-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.secondary-context-item{border:1px solid var(--border-soft);background:rgba(255,255,255,.025);border-radius:10px;padding:9px;min-width:0}.secondary-context-item span{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.055em;color:#667b95;font-weight:800}.secondary-context-item strong{display:block;margin-top:4px;font-size:15px;color:#edf5ff;line-height:1.15}.secondary-context-item small{display:block;margin-top:4px;font-size:9px;color:#71839a;line-height:1.4}.secondary-context-item.positive strong{color:#79e1ab}.secondary-context-item.alert strong{color:#ffcb68}.secondary-context-item.negative strong{color:#ff8290}.secondary-context-note{font-size:9px;line-height:1.45;color:#8193aa}.secondary-context-note b{color:#c7d6e8}
    @media(max-width:980px){.secondary-context-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.secondary-context-grid{grid-template-columns:1fr}.secondary-context-head{flex-direction:column}.secondary-context-badge{align-self:flex-start}}
  `;document.head.appendChild(s);}
  function host(){const root=document.getElementById('viewRoot');if(!root)return null;let h=root.querySelector(':scope > .secondary-context');if(!h){h=document.createElement('section');h.className='secondary-context';const head=root.querySelector(':scope > .section-head');head?head.insertAdjacentElement('afterend',h):root.prepend(h);}return h;}
  function item(label,value,meta='',tone=''){return `<div class="secondary-context-item ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`;}

  function renderServices(data){
    const rows=data.services||[],now=today();
    const upcoming=rows.map(r=>({row:r,d:date(r['Próximo vencimiento']),amount:num(r['Pagado mes COP'])})).filter(x=>x.d&&x.d>=now).sort((a,b)=>a.d-b.d);
    const first=upcoming[0],same=first?upcoming.filter(x=>x.d.getTime()===first.d.getTime()):[];
    const nextAmount=same.reduce((s,x)=>s+x.amount,0),within7=upcoming.filter(x=>daysUntil(x.d)<=7),within30=upcoming.filter(x=>daysUntil(x.d)<=30);
    const estimate30=within30.reduce((s,x)=>s+x.amount,0),paid=rows.filter(r=>norm(r['Estado mes']).includes('pagad')).length;
    const h=host();if(!h)return;
    h.innerHTML=`<div class="secondary-context-head"><div><span>CONTROL DE SERVICIOS</span><strong>Próximos pagos y referencias</strong><small>Los importes futuros se estiman con el último valor mensual registrado; no se crean gastos futuros.</small></div><div class="secondary-context-badge ${within7.length?'warn':'good'}">${within7.length?`${within7.length} vencen ≤7 días`:'Sin vencimientos inmediatos'}</div></div><div class="secondary-context-grid">
      ${item('Próximo vencimiento',first?dateLabel(first.d):'—',first?`${same.map(x=>x.row.Servicio).join(' + ')} · estimado ${money(nextAmount)}`:'Sin fecha próxima')}
      ${item('Próximos 7 días',money(within7.reduce((s,x)=>s+x.amount,0)),`${within7.length} servicio(s)`,within7.length?'alert':'')}
      ${item('Próximos 30 días',money(estimate30),`${within30.length} servicio(s) · estimación por último pago`)}
      ${item('Control del mes',`${paid}/${rows.length} pagados`,rows.length&&paid===rows.length?'Mes registrado al día':'Revisar servicios pendientes',rows.length&&paid===rows.length?'positive':'alert')}
    </div><div class="secondary-context-note"><b>Importante:</b> los montos de próximos vencimientos son referencias de planificación basadas en el último pago. El gasto real solo existe cuando se registra en Movimientos.</div>`;
  }

  function patchPensionUsdTable(){
    const root=document.getElementById('viewRoot');if(!root)return;
    const rate=Number(cfg.regularIncome?.usdCopReference)||3150;
    root.querySelectorAll('table').forEach(table=>{
      const headers=[...table.querySelectorAll('thead th')].map(th=>norm(th.textContent));
      const totalCop=headers.indexOf('patrimonio total cop'),varCop=headers.indexOf('variacion total cop'),totalUsd=headers.indexOf('patrimonio total usd'),varUsd=headers.indexOf('variacion total usd');
      if(totalUsd<0&&varUsd<0)return;
      [...table.querySelectorAll('tbody tr')].forEach(tr=>{const cells=[...tr.cells];if(totalUsd>=0&&totalCop>=0&&cells[totalUsd]&&cells[totalCop])cells[totalUsd].textContent=usd(num(cells[totalCop].textContent)/rate);if(varUsd>=0&&varCop>=0&&cells[varUsd]&&cells[varCop])cells[varUsd].textContent=usd(num(cells[varCop].textContent)/rate);});
    });
  }

  function renderPension(data){
    const rows=(data.pension||[]).map(r=>({r,d:date(r.Fecha)})).filter(x=>x.d).sort((a,b)=>a.d-b.d);const last=rows.at(-1)?.r||{},d=rows.at(-1)?.d;
    const total=num(last['Patrimonio total COP']),variation=num(last['Variación total COP']),pension=num(last['Total pensión COP']),ces=num(last['Total cesantías COP']),contribution=num(last['Variación aporte COP']),returnVar=num(last['Variación rendimiento COP']);
    const age=d?Math.max(0,Math.floor((today()-d)/86400000)):null;const badge=age==null?'Sin fecha':age>60?'Dato desactualizado':age>45?'Revisar actualización':'Corte reciente';const badgeTone=age==null||age>60?'bad':age>45?'warn':'good';
    const h=host();if(!h)return;
    h.innerHTML=`<div class="secondary-context-head"><div><span>PENSIÓN Y CESANTÍAS</span><strong>Lectura del último corte</strong><small>${d?`Corte ${dateLabel(d)} · hace ${age} día${age===1?'':'s'}`:'Fecha no disponible'}</small></div><div class="secondary-context-badge ${badgeTone}">${esc(badge)}</div></div><div class="secondary-context-grid">
      ${item('Patrimonio total',money(total),`${money(pension)} pensión + ${money(ces)} cesantías`)}
      ${item('Último cambio',money(variation),'Variación total frente al corte anterior',variation<0?'negative':'positive')}
      ${item('Aporte pensión',money(contribution),'Variación del aporte en el último corte',contribution>0?'positive':'')}
      ${item('Rendimiento pensión',money(returnVar),'Variación del rendimiento en el último corte',returnVar<0?'negative':'positive')}
    </div><div class="secondary-context-note"><b>USD del histórico:</b> el Sheet conserva valores numéricos correctos pero su formato muestra #VALUE!. El panel los presenta calculados desde COP usando la tasa de referencia configurada (${number(Number(cfg.regularIncome?.usdCopReference)||3150,0)} COP/USD).</div>`;
    requestAnimationFrame(patchPensionUsdTable);
  }

  function groupedDebt(rows){
    const groups=new Map();rows.forEach(r=>{const id=String(r['ID compra']||`${r['Fecha compra']}|${r.Comercio}|${r['Total compra']}`);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);});
    const out=[];groups.forEach(group=>{const ordered=group.slice().sort((a,b)=>num(a['Cuota actual'])-num(b['Cuota actual']));const current=ordered.find(r=>!norm(r['Estado detalle']).includes('pagad')&&!norm(r.Estado).includes('pagad'));if(!current)return;const currentValue=num(current['Valor cuota']),future=num(current['Saldo pendiente']),outstanding=currentValue+future;if(outstanding<=0)return;out.push({current,outstanding,currentValue,future,interest:num(current.Intereses)});});return out;
  }

  function dueForDebt(cycles,debts){
    const ids=new Set(debts.map(x=>norm(x.current.Tarjeta)).map(v=>v.includes('nu')?'nu':v.includes('arq')?'arq':'').filter(Boolean));const now=today();
    const rows=(cycles||[]).filter(r=>date(r['Fecha vencimiento'])&&date(r['Fecha vencimiento'])>=now&&!['si','sí','pagado','pago','true','yes'].includes(norm(r.Pagado))).filter(r=>{const t=norm(r.Tarjeta);return [...ids].some(id=>t.includes(id));}).sort((a,b)=>date(a['Fecha vencimiento'])-date(b['Fecha vencimiento']));return rows[0]||null;
  }

  function renderDebt(data){
    const debts=groupedDebt(data.installments||[]),principal=debts.reduce((s,x)=>s+x.outstanding,0),current=debts.reduce((s,x)=>s+x.currentValue,0),future=debts.reduce((s,x)=>s+x.future,0),interest=debts.reduce((s,x)=>s+x.interest,0),due=dueForDebt(data.cycles||[],debts),dueDate=due?date(due['Fecha vencimiento']):null;
    const h=host();if(!h)return;
    h.innerHTML=`<div class="secondary-context-head"><div><span>DEUDAS EN CUOTAS</span><strong>Principal financiado pendiente</strong><small>Esta vista sigue compras en varias cuotas; no representa el saldo total facturado de todas las tarjetas.</small></div><div class="secondary-context-badge ${current?'warn':'good'}">${debts.length} compra${debts.length===1?'':'s'} activa${debts.length===1?'':'s'}</div></div><div class="secondary-context-grid">
      ${item('Principal pendiente',money(principal),`${money(current)} cuota actual + ${money(future)} cuotas futuras`,principal?'alert':'positive')}
      ${item('Cuotas por pagar ahora',money(current),`${debts.length} compra(s) con cuota vigente`)}
      ${item('Capital futuro',money(future),'Principal que queda después de la cuota actual')}
      ${item('Próximo vencimiento tarjeta',dueDate?dateLabel(dueDate):'—',dueDate?`Referencia del ciclo facturado · en ${daysUntil(dueDate)} días`:'Sin vencimiento confirmado')}
    </div><div class="secondary-context-note"><b>No sumar esta cifra nuevamente al saldo de Tarjetas:</b> el principal en cuotas forma parte de la deuda de la tarjeta correspondiente. Esta sección sirve para entender cuánto de ese saldo está financiado a futuro.${interest?` Intereses de la próxima cuota registrados: ${esc(money(interest))}.`:''}</div>`;
  }

  async function run(force=false){const view=activeView();if(!['servicios','pension','deudas'].includes(view)){document.querySelector('#viewRoot > .secondary-context')?.remove();return;}const root=document.getElementById('viewRoot');if(!root)return;const v=++version;try{const data=await load(force);if(v!==version||activeView()!==view||!root.isConnected)return;if(view==='servicios')renderServices(data);else if(view==='pension')renderPension(data);else renderDebt(data);}catch(e){console.error('Finance secondary context:',e);}}
  function schedule(force=false){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;run(force);});}

  style();document.addEventListener('panel:view-root-changed',()=>schedule(false));document.addEventListener('panel:filters-updated',()=>schedule(false));document.addEventListener('panel:backend-refresh-requested',()=>{cache=null;schedule(true);});document.addEventListener('panel:backend-data-loaded',()=>{cache=null;schedule(false);});document.addEventListener('panel:modules-ready',()=>schedule(false));queueMicrotask(()=>schedule(false));
})();