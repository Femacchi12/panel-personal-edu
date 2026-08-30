(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = String(cfg.financeSpreadsheetId || '');
  if (!FINANCE_ID) return;

  const RANGES = {
    trips: 'Vacaciones_Viajes!A:T',
    benefits: 'Beneficios_Laborales!A:O',
    movements: 'Movimientos!A:Z'
  };

  const local = { period:'', type:'', funding:'', status:'', search:'' };
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

  function num(value){
    if(typeof value==='number'&&Number.isFinite(value))return value;
    let s=String(value??'').trim().replace(/[^0-9,.-]/g,'');
    if(!s)return 0;
    if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');
    else if(s.includes(','))s=s.replace(',','.');
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function number(value, digits=2){
    return new Intl.NumberFormat('es-CO',{minimumFractionDigits:0,maximumFractionDigits:digits}).format(Number(value)||0);
  }

  function money(value){
    return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(value)||0);
  }

  function date(value){
    const s=String(value??'').trim();
    let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(m)return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]));
    m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(m)return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
    return null;
  }

  function dateLabel(value){
    const d=date(value); if(!d)return String(value||'—');
    return new Intl.DateTimeFormat('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
  }

  function inRange(row, now=new Date()){
    const a=date(row.Inicio), b=date(row.Fin);
    return !!(a&&b&&now>=a&&now<=new Date(b.getFullYear(),b.getMonth(),b.getDate(),23,59,59));
  }

  function marker(row){
    const m=String(row.Observaciones||'').match(/\[VIAJE:([^\]]+)\]/i);
    return m?m[1].trim():'';
  }

  function isActualMovement(row){
    const s=norm(row.Estado);
    return s.includes('registrad')||s.includes('realiz')||s.includes('conciliad');
  }

  function currentBenefit(rows, benefit){
    const candidates=rows.filter(r=>norm(r.Beneficio)===norm(benefit)&&!norm(r['Período']).includes('total'));
    return candidates.find(r=>inRange(r)) || candidates[candidates.length-1] || {};
  }

  function totalBenefit(rows, benefit){
    return rows.find(r=>norm(r.Beneficio)===norm(benefit)&&norm(r['Período']).includes('total')) || {};
  }

  function tripRowsOnly(rows){ return rows.filter(r=>norm(r['Tipo de registro']).includes('viaje')); }
  function vacationRowsOnly(rows){ return rows.filter(r=>norm(r['Tipo de registro']).includes('vacacion')); }

  function expenseSummary(trip, movements){
    const key=marker(trip); if(!key)return null;
    const rows=movements.filter(r=>marker(r)===key&&isActualMovement(r));
    if(!rows.length)return null;
    const categories=new Map(), payments=new Map();
    let total=0;
    rows.forEach(r=>{
      const amount=num(r['Monto COP']||r['Monto original']); total+=amount;
      const cat=String(r['Categoría']||'Sin categoría'); categories.set(cat,(categories.get(cat)||0)+amount);
      const pay=String(r['Modalidad de pago']||r['Cuenta / Tarjeta']||'Sin medio'); payments.set(pay,(payments.get(pay)||0)+amount);
    });
    const days=new Set(rows.map(r=>String(r['Fecha real']||'')).filter(Boolean)).size;
    return {rows:rows.sort((a,b)=>String(b['Fecha real']||'').localeCompare(String(a['Fecha real']||''))),total,categories,payments,days};
  }

  function options(values, selected, allLabel){
    const unique=[...new Set(values.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'es'));
    return `<option value="">${esc(allLabel)}</option>${unique.map(v=>`<option value="${esc(v)}"${String(v)===String(selected)?' selected':''}>${esc(v)}</option>`).join('')}`;
  }

  function filterTrips(rows){
    const q=norm(local.search);
    return rows.filter(r=>{
      if(local.period&&String(r['Período laboral'])!==local.period)return false;
      if(local.type&&String(r['Tipo de registro'])!==local.type)return false;
      if(local.funding&&String(r['Financiación'])!==local.funding)return false;
      if(local.status&&String(r.Estado)!==local.status)return false;
      if(q&&!norm(Object.values(r).join(' ')).includes(q))return false;
      return true;
    });
  }

  function kpi(label,value,sub,tone=''){
    return `<div class="travel-kpi ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`;
  }

  function progress(used,total){
    const p=total>0?Math.max(0,Math.min(100,(used/total)*100)):0;
    return `<div class="travel-progress"><span style="width:${p.toFixed(1)}%"></span></div>`;
  }

  function benefitTimeline(rows, benefit){
    const now=new Date();
    return rows.filter(r=>norm(r.Beneficio)===norm(benefit)&&!norm(r['Período']).includes('total')).map(r=>{
      const assigned=num(r['Causado / asignado']), used=num(r.Usado), balance=num(r.Saldo), current=inRange(r,now);
      return `<div class="benefit-period${current?' current':''}">
        <div class="benefit-period-top"><div><strong>${esc(r['Período']||'—')}</strong><span>${esc(dateLabel(r.Inicio))} → ${esc(dateLabel(r.Fin))}</span></div><span class="travel-chip ${current?'active':''}">${current?'Actual':esc(r['Regla / estado']||'Histórico')}</span></div>
        ${progress(used,assigned)}
        <div class="benefit-period-values"><span><b>${number(assigned)}</b> asignados</span><span><b>${number(used)}</b> usados</span><span><b>${number(balance)}</b> disponibles</span></div>
      </div>`;
    }).join('');
  }

  function travelFilters(rows){
    return `<div class="travel-filters">
      <div><label>Período laboral</label><select data-travel-filter="period">${options(rows.map(r=>r['Período laboral']),local.period,'Todos')}</select></div>
      <div><label>Tipo</label><select data-travel-filter="type">${options(rows.map(r=>r['Tipo de registro']),local.type,'Todos')}</select></div>
      <div><label>Financiación</label><select data-travel-filter="funding">${options(rows.map(r=>r['Financiación']),local.funding,'Todas')}</select></div>
      <div><label>Estado</label><select data-travel-filter="status">${options(rows.map(r=>r.Estado),local.status,'Todos')}</select></div>
      <div class="travel-search"><label>Buscar</label><input data-travel-search value="${esc(local.search)}" placeholder="Destino, pasajero, origen…"></div>
      <button type="button" class="travel-reset" data-travel-reset>Limpiar</button>
    </div>`;
  }

  function historyTable(rows){
    const sorted=rows.slice().sort((a,b)=>(date(b['Fecha salida'])?.getTime()||0)-(date(a['Fecha salida'])?.getTime()||0));
    if(!sorted.length)return '<div class="travel-empty">No hay registros con estos filtros.</div>';
    return `<div class="travel-table-wrap"><table class="travel-table"><thead><tr><th>Salida</th><th>Tipo</th><th>Pasajero</th><th>Ruta</th><th>Financiación</th><th>Período</th><th>Días</th><th>Estado</th><th>Beneficio Fibrazo</th></tr></thead><tbody>${sorted.map(r=>{
      const contractual=norm(r['Financiación']).includes('contractual');
      const route=[r.Origen,r.Destino].filter(Boolean).join(' → ');
      const days=r['Días hábiles']||r['Días calendario']||'—';
      return `<tr><td>${esc(dateLabel(r['Fecha salida']))}</td><td>${esc(r['Tipo de registro']||'—')}</td><td>${esc(r['Titular/Pasajero']||'—')}</td><td>${esc(route||'—')}</td><td>${esc(r['Financiación']||'—')}</td><td>${esc(r['Período laboral']||'—')}</td><td>${esc(days)}</td><td><span class="travel-status">${esc(r.Estado||'—')}</span></td><td>${contractual?'<span class="travel-yes">Sí</span>':'—'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function breakdown(map){
    return [...map.entries()].sort((a,b)=>b[1]-a[1]).map(([label,value])=>`<div class="trip-break-row"><span>${esc(label)}</span><strong>${esc(money(value))}</strong></div>`).join('');
  }

  function expenseDetails(exp){
    if(!exp)return '';
    return `<section class="travel-card current-expenses">
      <div class="travel-card-head"><div><span>VIAJE EN CURSO · GASTOS EN DESTINO</span><strong>${money(exp.total)}</strong><small>${exp.rows.length} movimientos · ${exp.days} días con gastos</small></div></div>
      <div class="trip-grid"><div><h4>Por categoría</h4>${breakdown(exp.categories)}</div><div><h4>Por medio de pago</h4>${breakdown(exp.payments)}</div></div>
      <details class="travel-details"><summary>Ver detalle de gastos (${exp.rows.length})</summary><div class="travel-table-wrap"><table class="travel-table expense"><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Cuenta</th><th>Modalidad</th><th>Monto</th></tr></thead><tbody>${exp.rows.map(r=>`<tr><td>${esc(dateLabel(r['Fecha real']))}</td><td>${esc(r['Descripción / Comercio']||'—')}</td><td>${esc(r['Categoría']||'—')}</td><td>${esc(r['Cuenta / Tarjeta']||'—')}</td><td>${esc(r['Modalidad de pago']||'—')}</td><td class="trip-money">${esc(money(num(r['Monto COP']||r['Monto original'])))}</td></tr>`).join('')}</tbody></table></div></details>
    </section>`;
  }

  function render(data){
    const {trips,benefits,movements}=data;
    const airfareCurrent=currentBenefit(benefits,'Pasajes Argentina');
    const airfareTotal=totalBenefit(benefits,'Pasajes Argentina');
    const vacationTotal=totalBenefit(benefits,'Vacaciones');
    const annualAssigned=num(airfareCurrent['Causado / asignado']);
    const annualUsed=num(airfareCurrent.Usado);
    const annualBalance=num(airfareCurrent.Saldo);
    const accumulatedBalance=num(airfareTotal.Saldo);
    const vacationRows=vacationRowsOnly(trips);
    const vacationTaken=vacationRows.reduce((s,r)=>s+num(r['Días hábiles']),0);
    const vacationAccrued=num(vacationTotal['Causado / asignado']);
    const vacationBalance=num(vacationTotal.Saldo)||Math.max(0,vacationAccrued-vacationTaken);
    const needsVacationReview=vacationRows.some(r=>/revis|valid/i.test(String(r.Observaciones||'')));
    const currentTrip=tripRowsOnly(trips).find(r=>norm(r.Estado).includes('curso')) || tripRowsOnly(trips).slice().sort((a,b)=>(date(b['Fecha salida'])?.getTime()||0)-(date(a['Fecha salida'])?.getTime()||0))[0];
    const exp=currentTrip?expenseSummary(currentTrip,movements):null;
    const filtered=filterTrips(trips);

    return `<div class="travel-dashboard">
      <section class="travel-hero">
        <div><span class="travel-eyebrow">BENEFICIO CONTRACTUAL Y VACACIONES</span><h2>Tu situación actual</h2><p>Resumen simple del beneficio de pasajes, vacaciones y viajes registrados.</p></div>
        <span class="travel-period-badge">Período actual: ${esc(airfareCurrent['Período']||'—')}</span>
      </section>

      <div class="travel-kpi-grid">
        ${kpi('Pasajes del período',`${number(annualBalance,0)} disponibles`,`${number(annualUsed,0)} usados de ${number(annualAssigned,0)} asignados`,'blue')}
        ${kpi('Pasajes acumulados',`${number(accumulatedBalance,0)} disponibles`,`${number(num(airfareTotal.Usado),0)} usados de ${number(num(airfareTotal['Causado / asignado']),0)} asignados`,'green')}
        ${kpi('Vacaciones tomadas',`${number(vacationTaken)} días`,`Registrados en ${vacationRows.length} período(s)`,'gold')}
        ${kpi('Vacaciones pendientes',`${number(vacationBalance)} días`,`Saldo estimado al 30/08/2026`,'purple')}
      </div>

      <div class="travel-note"><strong>Regla contractual:</strong> 2 billetes aéreos a Argentina, ida y regreso, durante cada año de vinculación con Fibrazo. <span>El saldo acumulado de períodos anteriores se muestra según la conciliación interna del dashboard; el anexo no detalla expresamente qué ocurre con cupos no usados.</span></div>

      <div class="travel-main-grid">
        <section class="travel-card">
          <div class="travel-card-head"><div><span>PASAJES FIBRAZO</span><strong>Uso por período laboral</strong><small>Asignados, usados y disponibles</small></div></div>
          <div class="benefit-timeline">${benefitTimeline(benefits,'Pasajes Argentina')}</div>
        </section>
        <section class="travel-card vacation-card">
          <div class="travel-card-head"><div><span>VACACIONES</span><strong>${number(vacationBalance)} días pendientes</strong><small>${number(vacationAccrued)} causados estimados · ${number(vacationTaken)} registrados como tomados</small></div></div>
          ${progress(vacationTaken,vacationAccrued)}
          <div class="vacation-stat-row"><span><b>${number(vacationAccrued)}</b>Causados</span><span><b>${number(vacationTaken)}</b>Tomados</span><span><b>${number(vacationBalance)}</b>Pendientes</span></div>
          ${needsVacationReview?'<div class="travel-warning">El bloque dic-2023/ene-2024 figura con 15 días hábiles en el histórico, pero está marcado para validación final con RR. HH. El saldo se muestra conciliado contra ese registro.</div>':''}
        </section>
      </div>

      ${expenseDetails(exp)}

      <section class="travel-card history-card">
        <div class="travel-card-head history-head"><div><span>HISTORIAL</span><strong>Vacaciones y viajes</strong><small>${filtered.length} de ${trips.length} registros visibles</small></div></div>
        ${travelFilters(trips)}
        ${historyTable(filtered)}
      </section>
    </div>`;
  }

  function bind(host){
    host.querySelectorAll('[data-travel-filter]').forEach(el=>el.addEventListener('change',()=>{
      local[el.dataset.travelFilter]=el.value; rerender();
    }));
    const search=host.querySelector('[data-travel-search]');
    if(search)search.addEventListener('input',()=>{local.search=search.value; rerender(true);});
    host.querySelector('[data-travel-reset]')?.addEventListener('click',()=>{
      local.period='';local.type='';local.funding='';local.status='';local.search='';rerender();
    });
  }

  function rerender(preserveFocus=false){
    if(activeView()!=='viajes'||!cache)return;
    const root=document.getElementById('viewRoot'); if(!root)return;
    const scrollY=window.scrollY;
    const hadFocus=preserveFocus&&document.activeElement?.matches?.('[data-travel-search]');
    root.innerHTML=render(cache); bind(root);
    if(hadFocus){const input=root.querySelector('[data-travel-search]');input?.focus();input?.setSelectionRange(local.search.length,local.search.length);window.scrollTo({top:scrollY});}
  }

  async function run(){
    const globalFilters=document.getElementById('filterBar');
    if(activeView()!=='viajes'){ if(globalFilters)globalFilters.hidden=false; return; }
    if(globalFilters)globalFilters.hidden=true;
    const root=document.getElementById('viewRoot'); if(!root)return;
    const get=window.__PANEL_GET_SOURCE_VALUES__; if(typeof get!=='function')return;
    const v=++version;
    root.innerHTML='<div class="travel-loading">Actualizando vacaciones y viajes…</div>';
    try{
      const [tripValues,benefitValues,movementValues]=await Promise.all([
        get(FINANCE_ID,RANGES.trips,false),
        get(FINANCE_ID,RANGES.benefits,false),
        get(FINANCE_ID,RANGES.movements,false)
      ]);
      if(v!==version||activeView()!=='viajes'||!root.isConnected)return;
      cache={trips:parseRows(tripValues),benefits:parseRows(benefitValues),movements:parseRows(movementValues)};
      root.innerHTML=render(cache); bind(root);
    }catch(error){
      console.error('Travel dashboard:',error);
      root.innerHTML='<div class="travel-loading error">No se pudo cargar la información de viajes. Pulsa Actualizar para reintentar.</div>';
    }
  }

  function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;run();});}
  document.addEventListener('panel:view-root-changed',schedule);
  document.addEventListener('panel:backend-data-loaded',schedule);
  document.addEventListener('panel:modules-ready',schedule);
  document.addEventListener('click',e=>{if(e.target.closest('.nav-item'))setTimeout(schedule,0);});
  queueMicrotask(schedule);
})();
