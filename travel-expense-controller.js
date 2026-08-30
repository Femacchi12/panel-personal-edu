(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = String(cfg.financeSpreadsheetId || '');
  if (!FINANCE_ID) return;

  const RANGE = 'Movimientos!A:Z';
  let frame = 0;
  let version = 0;

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

  function money(value){
    return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(value)||0);
  }

  function marker(row){
    const m=String(row.Observaciones||'').match(/\[VIAJE:([^\]]+)\]/i);
    return m?m[1].trim():'';
  }

  function tripMeta(row,key){
    const text=String(row.Observaciones||'');
    const m=text.match(/Viaje\s+(.+?)\s+(\d{4}-\d{2}-\d{2})\s+a\s+(\d{4}-\d{2}-\d{2})/i);
    return {key,name:m?.[1]||key.replace(/-\d{4}-\d{2}-\d{2}$/,'').replace(/-/g,' '),start:m?.[2]||'',end:m?.[3]||''};
  }

  function dateLabel(value){
    const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m?`${m[3]}/${m[2]}/${m[1]}`:String(value||'—');
  }

  function isActual(row){
    const s=norm(row.Estado);
    return s.includes('registrad')||s.includes('realiz')||s.includes('conciliad');
  }

  function groupTrips(rows){
    const groups=new Map();
    rows.filter(r=>marker(r)&&isActual(r)).forEach(row=>{
      const key=marker(row);
      if(!groups.has(key))groups.set(key,{meta:tripMeta(row,key),rows:[]});
      groups.get(key).rows.push(row);
    });
    return [...groups.values()].map(group=>{
      const rows=group.rows.slice().sort((a,b)=>String(b['Fecha real']||'').localeCompare(String(a['Fecha real']||'')));
      const total=rows.reduce((s,r)=>s+num(r['Monto COP']||r['Monto original']),0);
      const days=new Set(rows.map(r=>String(r['Fecha real']||'')).filter(Boolean));
      const categories=new Map(),payments=new Map();
      rows.forEach(r=>{
        const cat=String(r['Categoría']||'Sin categoría');categories.set(cat,(categories.get(cat)||0)+num(r['Monto COP']||r['Monto original']));
        const pay=String(r['Modalidad de pago']||r['Cuenta / Tarjeta']||'Sin medio');payments.set(pay,(payments.get(pay)||0)+num(r['Monto COP']||r['Monto original']));
      });
      return {...group,rows,total,days:days.size,categories,payments};
    }).sort((a,b)=>String(b.meta.start||'').localeCompare(String(a.meta.start||'')));
  }

  function breakdown(map){
    return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,7)
      .map(([label,value])=>`<div class="trip-break-row"><span>${esc(label)}</span><strong>${esc(money(value))}</strong></div>`).join('');
  }

  function detailRows(rows){
    return rows.slice(0,14).map(r=>`<tr><td>${esc(dateLabel(r['Fecha real']))}</td><td>${esc(r['Descripción / Comercio']||'—')}</td><td>${esc(r['Categoría']||'—')}</td><td>${esc(r['Cuenta / Tarjeta']||'—')}</td><td>${esc(r['Modalidad de pago']||'—')}</td><td class="trip-money">${esc(money(num(r['Monto COP']||r['Monto original'])))}</td></tr>`).join('');
  }

  function markup(trip){
    const period=trip.meta.start&&trip.meta.end?`${dateLabel(trip.meta.start)} → ${dateLabel(trip.meta.end)}`:'Período identificado por etiqueta de viaje';
    const avg=trip.days?trip.total/trip.days:0;
    return `<section class="trip-expense-module" aria-label="Gastos durante la estadía">
      <div class="trip-expense-head"><div><span>GASTOS DURANTE LA ESTADÍA</span><strong>${esc(trip.meta.name)}</strong><small>${esc(period)} · gastos realizados desde la llegada · fuente exclusiva: Finanzas Edu / Movimientos</small></div><span class="trip-source-badge">${trip.rows.length} movimientos</span></div>
      <div class="trip-kpis"><div><span>Gastado en destino</span><strong>${esc(money(trip.total))}</strong></div><div><span>Días con gastos</span><strong>${trip.days}</strong></div><div><span>Promedio por día</span><strong>${esc(money(avg))}</strong></div><div><span>Categorías</span><strong>${trip.categories.size}</strong></div></div>
      <div class="trip-grid"><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Por categoría</strong><span>Distribución del gasto realizado en destino</span></div></div><div class="trip-break-list">${breakdown(trip.categories)}</div></div><div class="panel"><div class="panel-header"><div class="panel-title"><strong>Por medio de pago</strong><span>Cómo se financiaron los gastos en destino</span></div></div><div class="trip-break-list">${breakdown(trip.payments)}</div></div></div>
      <div class="panel trip-detail-panel"><div class="panel-header"><div class="panel-title"><strong>Detalle de gastos de la estadía</strong><span>Últimos ${Math.min(14,trip.rows.length)} movimientos</span></div></div><div class="table-scroll expanded"><table class="trip-expense-table"><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Cuenta</th><th>Modalidad</th><th>Monto COP</th></tr></thead><tbody>${detailRows(trip.rows)}</tbody></table></div></div>
    </section>`;
  }

  async function run(){
    if(activeView()!=='viajes')return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const get=window.__PANEL_GET_SOURCE_VALUES__;if(typeof get!=='function')return;
    const v=++version;
    try{
      const values=await get(FINANCE_ID,RANGE,false);
      if(v!==version||activeView()!=='viajes'||!root.isConnected)return;
      const trips=groupTrips(parseRows(values));
      root.querySelectorAll('.trip-expense-module').forEach(x=>x.remove());
      if(!trips.length)return;
      const wrap=document.createElement('div');wrap.innerHTML=markup(trips[0]);
      const node=wrap.firstElementChild;
      const anchor=root.querySelector('.kpi-grid');
      if(anchor)anchor.insertAdjacentElement('afterend',node);else root.prepend(node);
    }catch(error){console.error('Travel expense enhancement:',error);}
  }

  function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;run();});}
  document.addEventListener('panel:view-root-changed',schedule);
  document.addEventListener('panel:backend-data-loaded',schedule);
  document.addEventListener('panel:section-filters-changed',e=>{if(e.detail?.view==='viajes')schedule();});
  document.addEventListener('panel:modules-ready',schedule);
  queueMicrotask(schedule);
})();
