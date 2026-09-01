(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = String(cfg.financeSpreadsheetId || '');
  const DOCUMENTS_ID = String(cfg.documentsSpreadsheetId || '');
  const HEALTH_ID = String(cfg.healthSpreadsheetId || '');
  if (!FINANCE_ID || !DOCUMENTS_ID || !HEALTH_ID) return;

  const RANGES = {
    movimientos: [FINANCE_ID,'Movimientos!A:Z'],
    tarjetas: [FINANCE_ID,'Tarjetas!A:T'],
    patrimonio: [FINANCE_ID,'Patrimonio_Mensual!A:X'],
    servicios: [FINANCE_ID,'Servicios!A:O'],
    beneficios: [FINANCE_ID,'Beneficios_Laborales!A:O'],
    viajes: [FINANCE_ID,'Vacaciones_Viajes!A:T'],
    documentos: [DOCUMENTS_ID,'Documentos_Master!A:R'],
    citas: [HEALTH_ID,'Citas_Medicas!A:N'],
    tratamientos: [HEALTH_ID,'Tratamientos!A:X']
  };

  let frame = 0;
  let version = 0;
  let cache = null;

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return[];
    const headers=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!==''))
      .map(r=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,r?.[i]??''])));
  }
  function rowsFromPayload(payload,id,range){
    const cached=window.__PANEL_GET_CACHED_ROWS__;
    if(typeof cached==='function')return cached(payload,id,range);
    return parseRows(payload?.sources?.[`${id}|${range}`]||[]);
  }

  function num(value){
    if(typeof value==='number'&&Number.isFinite(value))return value;
    let s=String(value??'').trim().replace(/[^0-9,.-]/g,'');
    if(!s)return 0;
    const hasComma=s.includes(','), hasDot=s.includes('.');
    if(hasComma&&hasDot){
      if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');
      else s=s.replace(/,/g,'');
    } else if(hasComma) {
      const parts=s.split(',');
      s=(parts.length===2&&parts[1].length<=2)?parts[0].replace(/\./g,'')+'.'+parts[1]:s.replace(/,/g,'');
    }
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function pct(value){
    const n=num(String(value??'').replace('%',''));
    return Number.isFinite(n)?n:0;
  }

  function money(value){
    return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(value)||0);
  }
  function number(value,digits=1){return new Intl.NumberFormat('es-CO',{minimumFractionDigits:0,maximumFractionDigits:digits}).format(Number(value)||0);}

  function date(value){
    const s=String(value??'').trim();
    let m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(m)return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
    m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(m)return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]));
    return null;
  }
  function startToday(){const n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate());}
  function dateLabel(value){const d=date(value);return d?new Intl.DateTimeFormat('es-CO',{day:'2-digit',month:'short'}).format(d):String(value||'—');}
  function fullDateLabel(value){const d=date(value);return d?new Intl.DateTimeFormat('es-CO',{day:'2-digit',month:'short',year:'numeric'}).format(d):String(value||'—');}
  function monthKey(d){return d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`:'';}
  function previousMonthKey(d){const p=new Date(d.getFullYear(),d.getMonth()-1,1);return monthKey(p);}

  function isExpense(r){return norm(r.Tipo).includes('gasto')||norm(r.Naturaleza).includes('gasto');}
  function isActual(r){const s=norm(r.Estado);return s.includes('registrad')||s.includes('realiz')||s.includes('conciliad');}
  function amountCOP(r){return num(r['Monto COP']||r['Monto original']);}

  function currentBenefit(rows,name){
    const now=startToday();
    const list=rows.filter(r=>norm(r.Beneficio)===norm(name)&&!norm(r['Período']).includes('total'));
    return list.find(r=>{const a=date(r.Inicio),b=date(r.Fin);return a&&b&&now>=a&&now<=new Date(b.getFullYear(),b.getMonth(),b.getDate(),23,59,59);})||list[list.length-1]||{};
  }
  function totalBenefit(rows,name){return rows.find(r=>norm(r.Beneficio)===norm(name)&&norm(r['Período']).includes('total'))||{};}

  function daysUntil(d){return Math.ceil((d-startToday())/86400000);}
  function nextDayOfMonth(day){
    const n=startToday(); let d=new Date(n.getFullYear(),n.getMonth(),Number(day)||1);
    if(d<n)d=new Date(n.getFullYear(),n.getMonth()+1,Number(day)||1);
    return d;
  }

  function documentNeedsReview(r){
    const state=norm(r.Estado); if(state==='pendiente'||state==='por revisar')return true;
    if(state.includes('histor')||state.includes('archiv'))return false;
    const exp=date(r['Fecha vencimiento']); if(!exp)return false;
    return daysUntil(exp)<=180;
  }

  function activeTreatment(r){
    const s=norm(r.Estado); return s.includes('activo')||s.includes('curso')||s.includes('seguimiento')||s.includes('vigente');
  }

  function summarize(data){
    const now=startToday(), currentMonth=monthKey(now), prevMonth=previousMonthKey(now);
    let spend=0,prevSpend=0;
    const current=[],categories=new Map();
    (data.movimientos||[]).forEach(r=>{
      if(!isExpense(r)||!isActual(r))return;
      const mk=String(r['Mes consumo']||'')||monthKey(date(r['Fecha real']));
      const amount=amountCOP(r);
      if(mk===currentMonth){
        spend+=amount;current.push(r);
        const k=String(r['Categoría']||'Sin categoría');categories.set(k,(categories.get(k)||0)+amount);
      }else if(mk===prevMonth)prevSpend+=amount;
    });
    const spendDelta=prevSpend?((spend-prevSpend)/prevSpend)*100:null;
    const topCats=[...categories.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
    const topExpenses=current.slice().sort((a,b)=>amountCOP(b)-amountCOP(a)).slice(0,5);

    let latestPat={};
    (data.patrimonio||[]).forEach(r=>{const d=date(r.Fecha),currentDate=date(latestPat.Fecha);if(d&&(!currentDate||d>currentDate))latestPat=r;});
    const patrimonioCOP=num(latestPat['Patrimonio base COP']);
    const patrimonioVar=num(latestPat['Var. patrimonio COP']);

    const cards=[];let cardUsed=0,cardLimit=0,critical={};
    (data.tarjetas||[]).forEach(r=>{
      if(norm(r.Activa).includes('no'))return;
      cards.push(r);cardUsed+=num(r['Cupo usado']);cardLimit+=num(r['Cupo total actual']);
      if(!critical.Emisor||pct(r['% utilización'])>pct(critical['% utilización']))critical=r;
    });

    const airfareTotal=totalBenefit(data.beneficios||[],'Pasajes Argentina');
    const airfareCurrent=currentBenefit(data.beneficios||[],'Pasajes Argentina');
    const vacationTotal=totalBenefit(data.beneficios||[],'Vacaciones');

    const docs=data.documentos||[],docsReview=[];let nextExpiry={};
    docs.forEach(r=>{
      if(documentNeedsReview(r))docsReview.push(r);
      const e=date(r['Fecha vencimiento']),state=norm(r.Estado);
      if(!e||e<now||state.includes('histor')||state.includes('archiv'))return;
      const currentNext=date(nextExpiry['Fecha vencimiento']);if(!currentNext||e<currentNext)nextExpiry=r;
    });

    const staleAppointments=[],upcomingAppointments=[];
    (data.citas||[]).forEach(r=>{
      if(!norm(r.Estado).includes('program'))return;const d=date(r.Fecha);if(!d)return;
      if(d<now)staleAppointments.push(r);else upcomingAppointments.push(r);
    });
    upcomingAppointments.sort((a,b)=>date(a.Fecha)-date(b.Fecha));

    const activeTreatments=[],endingTreatments=[];
    (data.tratamientos||[]).forEach(r=>{
      if(!activeTreatment(r))return;activeTreatments.push(r);
      const d=date(r['Fecha fin prevista']);if(!d)return;const x=daysUntil(d);if(x>=0&&x<=45)endingTreatments.push(r);
    });
    endingTreatments.sort((a,b)=>date(a['Fecha fin prevista'])-date(b['Fecha fin prevista']));

    const currentTrip=(data.viajes||[]).find(r=>norm(r.Estado).includes('curso'))||{};

    const commitments=[];
    (data.servicios||[]).forEach(r=>{
      const d=date(r['Próximo vencimiento']); if(!d||d<now||daysUntil(d)>45)return;
      commitments.push({date:d,type:'Servicio',label:r.Servicio||r['Tipo de servicio']||'Servicio',amount:num(r['Pagado mes COP']),view:'servicios'});
    });
    cards.forEach(r=>{
      const day=num(r['Día vencimiento']); if(!day)return;
      const d=nextDayOfMonth(day); if(daysUntil(d)>45)return;
      commitments.push({date:d,type:'Tarjeta',label:`${r.Emisor||''} ${r.Titular||''}`.trim(),amount:num(r['Pago total próximo']||r['Pago mínimo próximo']),view:'tarjetas'});
    });
    commitments.sort((a,b)=>a.date-b.date);

    const alerts=[];
    cards.filter(r=>pct(r['% utilización'])>=90).sort((a,b)=>pct(b['% utilización'])-pct(a['% utilización'])).forEach(r=>alerts.push({tone:'high',title:`Tarjeta ${r.Emisor||''} ${r.Titular||''}: ${number(pct(r['% utilización']),1)}% de uso`,text:`Cupo disponible ${money(num(r['Cupo disponible']))}.`,view:'tarjetas'}));
    if(staleAppointments.length)alerts.push({tone:'medium',title:`${staleAppointments.length} cita(s) pasada(s) siguen “Programada”`,text:'Conviene actualizar su estado para mantener Salud consistente.',view:'citas'});
    if(docsReview.length)alerts.push({tone:'medium',title:`${docsReview.length} documento(s) requieren revisión`,text:nextExpiry['Fecha vencimiento']?`Próximo vencimiento: ${fullDateLabel(nextExpiry['Fecha vencimiento'])}.`:'Revisa pendientes o metadatos.',view:'documentos'});
    const soonCommit=commitments.filter(x=>daysUntil(x.date)<=7); if(soonCommit.length)alerts.push({tone:'info',title:`${soonCommit.length} pago(s) en los próximos 7 días`,text:soonCommit.slice(0,2).map(x=>`${x.label} · ${dateLabel(x.date.toISOString().slice(0,10))}`).join(' · '),view:'servicios'});
    if(endingTreatments.length)alerts.push({tone:'info',title:`${endingTreatments.length} tratamiento(s) cierran en ≤45 días`,text:endingTreatments.slice(0,2).map(r=>r['Medicamento / Intervención']||r.Medicamento||'Tratamiento').join(' · '),view:'tratamientos'});

    return {now,currentMonth,spend,prevSpend,spendDelta,topCats,topExpenses,latestPat,patrimonioCOP,patrimonioVar,cards,cardUsed,cardLimit,critical,airfareTotal,airfareCurrent,vacationTotal,docs,docsReview,nextExpiry,staleAppointments,upcomingAppointments,activeTreatments,endingTreatments,currentTrip,commitments,alerts};
  }

  function kpi(label,value,sub,tone=''){
    return `<div class="general-kpi ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`;
  }
  function quick(view,label,meta){return `<button type="button" class="general-quick" data-general-goto="${esc(view)}"><strong>${esc(label)}</strong><span>${esc(meta)}</span><b>→</b></button>`;}

  function alertsMarkup(items){
    if(!items.length)return '<div class="general-empty">Sin alertas importantes en este momento.</div>';
    return items.slice(0,6).map(a=>`<button type="button" class="general-alert ${a.tone}" data-general-goto="${esc(a.view)}"><span></span><div><strong>${esc(a.title)}</strong><small>${esc(a.text)}</small></div><b>→</b></button>`).join('');
  }

  function commitmentsMarkup(items){
    if(!items.length)return '<div class="general-empty">No hay vencimientos próximos registrados.</div>';
    return items.slice(0,7).map(x=>`<button type="button" class="general-row" data-general-goto="${esc(x.view)}"><time>${esc(dateLabel(x.date.toISOString().slice(0,10)))}</time><div><strong>${esc(x.label)}</strong><span>${esc(x.type)}</span></div><b>${x.amount?esc(money(x.amount)):'—'}</b></button>`).join('');
  }

  function categoryMarkup(items,total){
    if(!items.length)return '<div class="general-empty">Sin gastos registrados este mes.</div>';
    return items.map(([label,value])=>{const p=total?Math.min(100,(value/total)*100):0;return `<div class="general-break"><div><span>${esc(label)}</span><strong>${esc(money(value))}</strong></div><i><b style="width:${p.toFixed(1)}%"></b></i></div>`;}).join('');
  }

  function expenseMarkup(items){
    if(!items.length)return '<div class="general-empty">Sin movimientos para mostrar.</div>';
    return items.map(r=>`<div class="general-expense"><time>${esc(dateLabel(r['Fecha real']))}</time><div><strong>${esc(r['Descripción / Comercio']||'—')}</strong><span>${esc(r['Categoría']||'Sin categoría')}</span></div><b>${esc(money(amountCOP(r)))}</b></div>`).join('');
  }

  function render(data){
    const s=summarize(data);
    const spendSub=s.spendDelta===null?'Sin comparación previa':`${s.spendDelta>=0?'+':''}${number(s.spendDelta,1)}% vs. mes anterior`;
    const cardPct=s.cardLimit?(s.cardUsed/s.cardLimit)*100:0;
    const currentTripText=s.currentTrip.Destino?`${s.currentTrip.Origen||''} → ${s.currentTrip.Destino}`:'Sin viaje en curso';
    const currentTripMeta=s.currentTrip.Destino?`${fullDateLabel(s.currentTrip['Fecha salida'])} – ${fullDateLabel(s.currentTrip['Fecha regreso'])}`:'Vacaciones y viajes al día';
    const upcoming=s.upcomingAppointments[0];
    const healthMeta=upcoming?`${upcoming['Especialidad/Servicio']||'Cita'} · ${fullDateLabel(upcoming.Fecha)}`:`${s.activeTreatments.length} tratamiento(s) activo(s)`;

    return `<div class="general-dashboard" data-general-dashboard="true">
      <section class="general-hero"><div><span>RESUMEN PERSONAL</span><h2>Lo importante hoy</h2><p>${esc(new Intl.DateTimeFormat('es-CO',{weekday:'long',day:'numeric',month:'long'}).format(s.now))} · datos consolidados de Finanzas, Salud, Documentos y Viajes</p></div><button type="button" class="general-refresh" data-general-refresh>↻ Actualizar</button></section>

      <div class="general-kpi-grid">
        ${kpi('Gasto del mes',money(s.spend),spendSub,'blue')}
        ${kpi('Patrimonio base',money(s.patrimonioCOP),s.patrimonioVar?`${s.patrimonioVar>=0?'+':''}${money(s.patrimonioVar)} vs. corte anterior`:`Corte ${fullDateLabel(s.latestPat.Fecha)}`,'green')}
        ${kpi('Uso de tarjetas',`${number(cardPct,1)}%`,`${money(s.cardUsed)} usados de ${money(s.cardLimit)}`,'gold')}
        ${kpi('Pasajes Fibrazo',`${number(num(s.airfareTotal.Saldo),0)} disponibles`,`${number(num(s.airfareCurrent.Saldo),0)} del período actual`,'purple')}
        ${kpi('Vacaciones pendientes',`${number(num(s.vacationTotal.Saldo),2)} días`,`Estimado al ${fullDateLabel(s.vacationTotal.Fin)}`,'teal')}
        ${kpi('Documentos por revisar',String(s.docsReview.length),s.nextExpiry['Fecha vencimiento']?`Próximo venc.: ${fullDateLabel(s.nextExpiry['Fecha vencimiento'])}`:`${s.docs.length} canónicos`,'red')}
      </div>

      <div class="general-main-grid">
        <section class="general-card priority-card"><div class="general-card-head"><div><span>PRIORIDADES</span><strong>Qué necesita atención</strong></div><small>${s.alerts.length} alertas</small></div><div class="general-alert-list">${alertsMarkup(s.alerts)}</div></section>
        <section class="general-card"><div class="general-card-head"><div><span>PRÓXIMOS COMPROMISOS</span><strong>Pagos y vencimientos</strong></div><small>45 días</small></div><div class="general-list">${commitmentsMarkup(s.commitments)}</div></section>
      </div>

      <div class="general-main-grid">
        <section class="general-card"><div class="general-card-head"><div><span>FINANZAS DEL MES</span><strong>Gasto por categoría</strong></div><button data-general-goto="gastos">Ver gastos →</button></div><div class="general-break-list">${categoryMarkup(s.topCats,s.spend)}</div></section>
        <section class="general-card"><div class="general-card-head"><div><span>MOVIMIENTOS</span><strong>Gastos más grandes</strong></div><button data-general-goto="gastos">Detalle →</button></div><div class="general-expense-list">${expenseMarkup(s.topExpenses)}</div></section>
      </div>

      <section class="general-card"><div class="general-card-head"><div><span>ESTADO PERSONAL</span><strong>Accesos rápidos</strong></div><small>Resumen transversal</small></div><div class="general-quick-grid">
        ${quick('viajes','Viaje en curso',currentTripText+' · '+currentTripMeta)}
        ${quick('salud','Salud',healthMeta)}
        ${quick('documentos','Documentos',`${s.docs.length} canónicos · ${s.docsReview.length} por revisar`)}
        ${quick('tarjetas','Tarjetas',`${s.cards.length} activas · más exigida ${s.critical.Emisor||'—'} ${s.critical.Titular||''} ${number(pct(s.critical['% utilización']),1)}%`)}
        ${quick('inversiones','Inversiones',`Patrimonio base ${money(s.patrimonioCOP)}`)}
        ${quick('servicios','Servicios',`${s.commitments.filter(x=>x.type==='Servicio').length} próximos vencimientos`)}
      </div></section>
    </div>`;
  }

  function bind(root){
    root.querySelectorAll('[data-general-goto]').forEach(btn=>btn.addEventListener('click',()=>{
      const view=btn.dataset.generalGoto; document.querySelector(`.nav-item[data-view="${CSS.escape(view)}"]`)?.click();
    }));
    root.querySelector('[data-general-refresh]')?.addEventListener('click',()=>run(true));
  }

  function manageFilterBar(){
    const bar=document.getElementById('filterBar'); if(!bar)return;
    const v=activeView(); bar.hidden=(v==='general'||v==='viajes');
  }

  async function load(force=false){
    const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')throw new Error('Backend central no disponible');
    const payload=await getData(force);
    return Object.fromEntries(Object.entries(RANGES).map(([key,[id,range]])=>[key,rowsFromPayload(payload,id,range)]));
  }

  async function run(force=false){
    manageFilterBar();
    if(activeView()!=='general')return;
    const root=document.getElementById('viewRoot'); if(!root)return;
    if(!force&&root.querySelector('[data-general-dashboard]')&&cache)return;
    const v=++version;
    if(cache&&!force){root.innerHTML=render(cache);bind(root);return;}
    root.innerHTML='<div class="general-loading">Actualizando resumen personal…</div>';
    try{
      const data=await load(force); if(v!==version||activeView()!=='general'||!root.isConnected)return;
      cache=data; root.innerHTML=render(data); bind(root);
    }catch(error){console.error('General dashboard:',error);root.innerHTML='<div class="general-loading error">No se pudo cargar el resumen. Pulsa Actualizar para reintentar.</div>';}
  }

  function schedule(force=false){if(frame&&!force)return; if(frame)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=0;run(force);});}
  document.addEventListener('panel:view-root-changed',()=>{if(activeView()==='general'&&!document.querySelector('#viewRoot [data-general-dashboard]'))schedule(false);else manageFilterBar();});
  document.addEventListener('panel:backend-data-loaded',()=>{cache=null;schedule(false);});
  document.addEventListener('panel:modules-ready',()=>schedule(false));
  document.addEventListener('click',e=>{if(e.target.closest('.nav-item'))setTimeout(()=>schedule(false),0);});
  queueMicrotask(()=>schedule(false));
})();
