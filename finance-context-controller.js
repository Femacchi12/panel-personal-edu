(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = String(cfg.financeSpreadsheetId || '');
  if (!FINANCE_ID) return;

  const RANGES = {
    cards: 'Tarjetas!A:T',
    cycles: 'Pagos_Tarjetas!A:T',
    flow: 'Flujo_Ahorro!A:P',
    movements: 'Movimientos!A:Z'
  };

  const MONTHS = {ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
  let frame = 0;
  let version = 0;
  let cache = null;

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return[];
    const h=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!==''))
      .map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));
  }

  function num(value){
    if(typeof value==='number'&&Number.isFinite(value))return value;
    let s=String(value??'').trim().replace(/[^0-9,.-]/g,'');
    if(!s)return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
    else if(c>=0){const p=s.split(',');s=(p.length===2&&p[1].length<=2)?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function date(value){
    const s=String(value??'').trim();
    let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(m)return new Date(+m[1],+m[2]-1,+m[3]);
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    return null;
  }

  function today(){const n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate());}
  function money(v){return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);}
  function number(v,d=1){return new Intl.NumberFormat('es-CO',{minimumFractionDigits:0,maximumFractionDigits:d}).format(Number(v)||0);}
  function dateLabel(d){const x=d instanceof Date?d:date(d);return x?new Intl.DateTimeFormat('es-CO',{day:'2-digit',month:'short'}).format(x):'—';}
  function daysUntil(d){return Math.ceil((d-today())/86400000);}

  function selectedGlobal(key){return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||'').trim()).filter(Boolean);}

  function monthKeyFromText(value){
    const s=norm(value);
    let m=s.match(/^(20\d{2})-(\d{1,2})/); if(m)return `${m[1]}-${String(+m[2]).padStart(2,'0')}`;
    m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);
    return m?`${m[2]}-${String(MONTHS[m[1]]).padStart(2,'0')}`:'';
  }

  function rowMonth(row){
    const explicit=String(row['Mes consumo']||'').trim();
    if(/^20\d{2}-\d{2}$/.test(explicit))return explicit;
    const d=date(row['Fecha real']||row['Fecha registrada']);
    return d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`:'';
  }

  function isActualExpense(row){
    if(norm(row.Tipo)!=='gasto'&&norm(row.Naturaleza)!=='gasto')return false;
    return window.MovementStatusCore?.isActual ? window.MovementStatusCore.isActual(row.Estado) : !/proyecc|proyect|programad/.test(norm(row.Estado));
  }

  function account(row){
    const raw=String(row['Cuenta / Tarjeta']||'').trim(),n=norm(raw),holder=norm(row.Titular);
    if(n.includes('efectivo'))return 'Efectivo';
    if(n.includes('nequi'))return holder.includes('ro')?'Nequi Ro':'Nequi Edu';
    if(n.includes('arq'))return 'ARQ Edu';
    if(n.includes('nu'))return (n.includes(' ro')||holder.includes('rocio')||holder==='ro')?'Nu Ro':'Nu Edu';
    return raw||'Sin especificar';
  }

  function method(row){
    const explicit=String(row['Modalidad de pago']||'').trim();if(explicit)return explicit;
    const n=norm(row['Cuenta / Tarjeta']);
    if(n.includes('credito'))return 'Crédito';if(n.includes('transferencia'))return 'Transferencia';if(n.includes('debito'))return 'Débito';if(n.includes('efectivo'))return 'Efectivo';
    return num(row.Cuotas)>0&&(n.includes('nu')||n.includes('arq'))?'Crédito':'Sin especificar';
  }

  function movementMatches(row,overrideMonth=null){
    if(!isActualExpense(row))return false;
    const years=selectedGlobal('year'),months=selectedGlobal('month'),cats=selectedGlobal('category'),subs=selectedGlobal('subcategory');
    const mk=rowMonth(row),parts=mk.split('-');
    if(overrideMonth){if(mk!==overrideMonth)return false;}
    else {
      if(years.length&&(!parts[0]||!years.includes(parts[0])))return false;
      if(months.length&&(!parts[1]||!months.includes(String(+parts[1]))))return false;
    }
    if(cats.length&&!cats.includes(String(row['Categoría']||'')))return false;
    if(subs.length&&!subs.includes(String(row['Subcategoría']||'')))return false;
    const pay=window.__PAYMENT_FILTER_STATE__;
    if(pay?.view===activeView()){
      if(pay.account?.length&&!pay.account.includes(account(row)))return false;
      if(pay.method?.length&&!pay.method.includes(method(row)))return false;
    }
    return true;
  }

  async function source(range,force=false){
    const get=window.__PANEL_GET_SOURCE_VALUES__;
    if(typeof get!=='function')return[];
    return parseRows(await get(FINANCE_ID,range,force));
  }

  async function load(force=false){
    if(cache&&!force)return cache;
    const [cards,cycles,flow,movements]=await Promise.all([
      source(RANGES.cards,force),source(RANGES.cycles,force),source(RANGES.flow,force),source(RANGES.movements,force)
    ]);
    cache={cards,cycles,flow,movements};return cache;
  }

  function injectStyle(){
    if(document.getElementById('financeContextStyles'))return;
    const style=document.createElement('style');style.id='financeContextStyles';style.textContent=`
      .finance-context{margin:0 0 14px;border:1px solid var(--border-soft);background:linear-gradient(180deg,rgba(16,25,39,.86),rgba(8,14,23,.92));border-radius:13px;padding:12px;display:grid;gap:10px}
      .finance-context-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.finance-context-head>div{display:grid;gap:3px}.finance-context-head span{font-size:9px;font-weight:800;letter-spacing:.07em;color:#63a1ff}.finance-context-head strong{font-size:13px;color:#edf4ff}.finance-context-head small{font-size:10px;color:#71839a;line-height:1.4}.finance-context-state{border:1px solid var(--border);border-radius:99px;padding:5px 8px;font-size:9px;font-weight:800;color:#9db7d8;white-space:nowrap}.finance-context-state.warn{color:#ffcc6d;border-color:rgba(246,200,68,.24);background:rgba(246,200,68,.06)}.finance-context-state.bad{color:#ff8290;border-color:rgba(255,102,122,.25);background:rgba(255,102,122,.06)}.finance-context-state.good{color:#79e1ab;border-color:rgba(38,208,124,.23);background:rgba(38,208,124,.06)}
      .finance-context-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.finance-context-item{border:1px solid var(--border-soft);background:rgba(255,255,255,.025);border-radius:10px;padding:9px;min-width:0}.finance-context-item span{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.055em;color:#667b95;font-weight:800}.finance-context-item strong{display:block;margin-top:4px;font-size:15px;color:#eef5ff;line-height:1.15}.finance-context-item small{display:block;margin-top:4px;font-size:9px;color:#71839a;line-height:1.35}.finance-context-item.alert strong{color:#ffcb68}.finance-context-item.critical strong{color:#ff8290}.finance-context-item.positive strong{color:#79e1ab}
      .finance-context-note{font-size:9px;line-height:1.45;color:#8193aa;padding-top:1px}.finance-context-note b{color:#c5d4e7}
      @media(max-width:980px){.finance-context-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.finance-context-grid{grid-template-columns:1fr}.finance-context-head{align-items:stretch;flex-direction:column}.finance-context-state{align-self:flex-start}}
    `;document.head.appendChild(style);
  }

  function host(){
    const root=document.getElementById('viewRoot');if(!root)return null;
    let h=root.querySelector(':scope > .finance-context');
    if(!h){h=document.createElement('section');h.className='finance-context';const head=root.querySelector(':scope > .section-head');if(head)head.insertAdjacentElement('afterend',h);else root.prepend(h);}
    return h;
  }

  function item(label,value,meta='',tone=''){return `<div class="finance-context-item ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`;}

  function nextDateForDay(day){
    const n=today(),d=Number(day)||0;if(!d)return null;
    const safe=(y,m,dd)=>new Date(y,m,Math.min(dd,new Date(y,m+1,0).getDate()));
    let out=safe(n.getFullYear(),n.getMonth(),d);if(out<n)out=safe(n.getFullYear(),n.getMonth()+1,d);return out;
  }

  function latestClosedCycle(cycles,id){
    const n=today();return cycles.filter(r=>String(r.Tarjeta||'')===id&&date(r['Fecha corte'])&&date(r['Fecha corte'])<=n).sort((a,b)=>date(b['Fecha corte'])-date(a['Fecha corte']))[0]||null;
  }

  function renderCards(data){
    const activeId=String(window.__PANEL_ACTIVE_CARD_ID__||'');
    const cards=(data.cards||[]).filter(r=>!activeId||String(r['ID tarjeta']||'')===activeId);
    const used=cards.reduce((s,r)=>s+num(r['Cupo usado']),0);
    const real=cards.reduce((s,r)=>s+num(r['Cupo total actual']),0);
    const controls=cards.map(r=>({row:r,limit:num(r['Límite personal de gasto'])||num(r['Cupo total actual']),used:num(r['Cupo usado'])}));
    const worst=controls.slice().sort((a,b)=>(b.limit?b.used/b.limit:0)-(a.limit?a.used/a.limit:0))[0];
    const worstPct=worst?.limit?worst.used/worst.limit*100:0;
    const alertCount=controls.filter(x=>x.limit&&x.used/x.limit>=.85).length;

    const dues=[];
    cards.forEach(r=>{const id=String(r['ID tarjeta']||'');const c=latestClosedCycle(data.cycles||[],id);const due=c&&date(c['Fecha vencimiento']);const paid=norm(c?.Pagado);if(due&&due>=today()&&!['si','sí','pagado','pago','true','yes'].includes(paid)){dues.push({date:due,amount:num(c['Pago total']||c['Pago mínimo']),label:`${r.Emisor||'Tarjeta'} ${r.Titular||''}`.trim()});}});
    dues.sort((a,b)=>a.date-b.date);
    const firstDue=dues[0];
    const sameDue=firstDue?dues.filter(x=>x.date.getTime()===firstDue.date.getTime()):[];
    const dueTotal=sameDue.reduce((s,x)=>s+x.amount,0);

    const cuts=cards.map(r=>({date:nextDateForDay(r['Día corte']),label:`${r.Emisor||'Tarjeta'} ${r.Titular||''}`.trim()})).filter(x=>x.date).sort((a,b)=>a.date-b.date);
    const cut=cuts[0];
    const state=alertCount?`${alertCount} en alerta`:'Controlado';
    const stateTone=worstPct>=100?'bad':worstPct>=85?'warn':'good';
    const h=host();if(!h)return;
    h.innerHTML=`<div class="finance-context-head"><div><span>CONTROL DE TARJETAS</span><strong>${activeId?'Resumen de la tarjeta seleccionada':'Qué requiere atención ahora'}</strong><small>Combina cupo actual, límites personales y último corte registrado.</small></div><div class="finance-context-state ${stateTone}">${esc(state)}</div></div><div class="finance-context-grid">
      ${item('Exposición actual',money(used),`${number(real?used/real*100:0,1)}% del cupo real consolidado`,worstPct>=100?'critical':'')}
      ${item('Mayor uso de control',`${number(worstPct,1)}%`,worst?`${worst.row.Emisor||''} · ${worst.row.Titular||''}`:'Sin datos',worstPct>=100?'critical':worstPct>=85?'alert':'')}
      ${item('Próximo pago',firstDue?money(dueTotal):'Sin pago registrado',firstDue?`${dateLabel(firstDue.date)} · ${sameDue.length} tarjeta(s) · en ${daysUntil(firstDue.date)} días`:'No hay vencimiento pendiente confirmado',firstDue&&daysUntil(firstDue.date)<=7?'alert':'')}
      ${item('Próximo corte',cut?dateLabel(cut.date):'—',cut?`${cut.label} · en ${daysUntil(cut.date)} días`:'Sin día de corte configurado')}
    </div><div class="finance-context-note"><b>Límite de control</b> = tope personal que elegiste para administrar el gasto; puede ser menor que el cupo real del emisor.</div>`;
  }

  function selectedFlowKey(flow){
    const years=selectedGlobal('year'),months=selectedGlobal('month');
    if(years.length===1&&months.length===1)return `${years[0]}-${String(+months[0]).padStart(2,'0')}`;
    const now=today(),current=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    if(flow.some(r=>monthKeyFromText(r.Mes)===current))return current;
    return flow.map(r=>monthKeyFromText(r.Mes)).filter(Boolean).sort().at(-1)||'';
  }

  function renderFlow(data){
    const key=selectedFlowKey(data.flow||[]),row=(data.flow||[]).find(r=>monthKeyFromText(r.Mes)===key)||{};
    const status=String(row.Estado||'Sin estado'),n=norm(status);
    const realIncome=num(row['Ingresos reales COP']),realSpend=num(row['Egresos reales COP']),realSaving=num(row['Ahorro real COP']);
    const projIncome=num(row['Ingresos proyectados COP']),projSpend=num(row['Egresos proyectados COP']),projSaving=num(row['Ahorro proyectado COP']);
    const targetRate=num(String(row['Meta de ahorro']||'').replace('%',''))/100;
    const projectedTarget=projIncome*targetRate;
    const projectedGap=projSaving-projectedTarget;
    const isCurrent=n.includes('curso'),isProjection=n.includes('proyecc'),isClosed=n.includes('cerrad');
    const tone=isCurrent?'warn':isProjection?'':'good';
    const h=host();if(!h)return;
    const title=isCurrent?'Mes en curso: separa lo parcial del cierre esperado':isProjection?'Mes proyectado':'Mes cerrado: resultado definitivo';
    h.innerHTML=`<div class="finance-context-head"><div><span>LECTURA DEL FLUJO · ${esc(row.Mes||key)}</span><strong>${esc(title)}</strong><small>Evita interpretar un mes incompleto como si ya estuviera cerrado.</small></div><div class="finance-context-state ${tone}">${esc(status||'—')}</div></div><div class="finance-context-grid">
      ${item(isProjection?'Ingreso proyectado':'Ingreso registrado',money(isProjection?projIncome:realIncome),isCurrent&&projIncome?`Proyección de cierre ${money(projIncome)}`:'')}
      ${item(isProjection?'Egreso proyectado':'Egreso registrado',money(isProjection?projSpend:realSpend),isCurrent&&projSpend?`Proyección de cierre ${money(projSpend)}`:'')}
      ${item(isCurrent||isProjection?'Ahorro al cierre proyectado':'Ahorro del mes',money(isCurrent||isProjection?projSaving:realSaving),isCurrent?`Saldo parcial hoy ${money(realSaving)}`:`Tasa ${row['Tasa de ahorro real']||'—'}`,(isCurrent||isProjection?projSaving:realSaving)<0?'critical':'positive')}
      ${item('Brecha vs meta 30%',money(isCurrent||isProjection?projectedGap:num(row['Brecha vs meta COP'])),isCurrent||isProjection?`Meta proyectada ${money(projectedTarget)}`:`Cumplimiento ${row['Cumplimiento de meta']||'—'}`,(isCurrent||isProjection?projectedGap:num(row['Brecha vs meta COP']))<0?'alert':'positive')}
    </div>${isCurrent?`<div class="finance-context-note"><b>Importante:</b> el ahorro real de ${esc(money(realSaving))} es parcial. Para decidir sobre el mes conviene mirar el cierre proyectado de ${esc(money(projSaving))}, no tratar el saldo de hoy como resultado definitivo.</div>`:''}`;
  }

  function comparablePreviousKey(){
    const years=selectedGlobal('year'),months=selectedGlobal('month');
    const n=today();let y=n.getFullYear(),m=n.getMonth()+1;
    if(years.length===1&&months.length===1){y=+years[0];m=+months[0];}
    const d=new Date(y,m-2,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }

  function currentSelectedKey(){
    const years=selectedGlobal('year'),months=selectedGlobal('month');
    if(years.length===1&&months.length===1)return `${years[0]}-${String(+months[0]).padStart(2,'0')}`;
    return '';
  }

  function renderExpenses(data){
    const rows=(data.movements||[]).filter(r=>movementMatches(r));
    const total=rows.reduce((s,r)=>s+num(r['Monto COP']||r['Monto original']),0);
    const days=new Set(rows.map(r=>String(r['Fecha real']||'')).filter(Boolean)).size;
    const biggest=rows.slice().sort((a,b)=>num(b['Monto COP'])-num(a['Monto COP']))[0]||{};
    const fixed=rows.filter(r=>/^(si|sí|true|1)$/i.test(String(r['Es fijo']||''))).reduce((s,r)=>s+num(r['Monto COP']),0);
    const credit=rows.filter(r=>norm(method(r))==='credito').reduce((s,r)=>s+num(r['Monto COP']),0);

    let compare='Sin comparación automática',compareTone='';
    const selectedKey=currentSelectedKey();
    if(selectedKey){
      const prevKey=comparablePreviousKey(),selectedDate=selectedKey===`${today().getFullYear()}-${String(today().getMonth()+1).padStart(2,'0')}`?today().getDate():31;
      const prev=(data.movements||[]).filter(r=>movementMatches(r,prevKey)).filter(r=>{const d=date(r['Fecha real']||r['Fecha registrada']);return d&&d.getDate()<=selectedDate;});
      const prevTotal=prev.reduce((s,r)=>s+num(r['Monto COP']||r['Monto original']),0);
      if(prevTotal){const delta=(total-prevTotal)/prevTotal*100;compare=`${delta>=0?'+':''}${number(delta,1)}% vs. mes anterior a igual día`;compareTone=delta>10?'alert':delta<0?'positive':'';}
    }

    const h=host();if(!h)return;
    h.innerHTML=`<div class="finance-context-head"><div><span>LECTURA DEL GASTO</span><strong>Resumen del período filtrado</strong><small>Los cálculos usan únicamente movimientos reales del maestro oficial.</small></div><div class="finance-context-state">${esc(`${rows.length} movimientos`)}</div></div><div class="finance-context-grid">
      ${item('Total gastado',money(total),compare,compareTone)}
      ${item('Promedio por día',days?money(total/days):money(0),`${days} día(s) con gasto`)}
      ${item('Mayor gasto',biggest['Monto COP']?money(num(biggest['Monto COP'])):'—',biggest['Descripción / Comercio']||'Sin movimientos')}
      ${item('Composición',`${number(total?fixed/total*100:0,1)}% fijo`,`${number(total?credit/total*100:0,1)}% del gasto fue a crédito`,credit/Math.max(total,1)>.5?'alert':'')}
    </div>`;
  }

  async function run(force=false){
    const view=activeView();if(!['tarjetas','flujo','gastos'].includes(view)){document.querySelector('#viewRoot > .finance-context')?.remove();return;}
    const root=document.getElementById('viewRoot');if(!root)return;
    const v=++version;
    try{
      const data=await load(force);if(v!==version||activeView()!==view||!root.isConnected)return;
      if(view==='tarjetas')renderCards(data);else if(view==='flujo')renderFlow(data);else renderExpenses(data);
    }catch(error){console.error('Finance context:',error);}
  }

  function schedule(force=false){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;run(force);});}

  injectStyle();
  document.addEventListener('panel:view-root-changed',()=>schedule(false));
  document.addEventListener('panel:filters-updated',()=>schedule(false));
  document.addEventListener('panel:section-filters-changed',()=>schedule(false));
  document.addEventListener('panel:payment-filters-changed',()=>schedule(false));
  document.addEventListener('panel:card-filter-changed',()=>schedule(false));
  document.addEventListener('panel:backend-refresh-requested',()=>{cache=null;schedule(true);});
  document.addEventListener('panel:backend-data-loaded',()=>{cache=null;schedule(false);});
  queueMicrotask(()=>schedule(false));
})();