(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = String(cfg.financeSpreadsheetId || '');
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const COLORS = ['#1769ff','#f6c844','#26d07c','#ff667a','#ffad42','#7a8ba5','#8b5cf6','#22d3ee','#f472b6','#a3e635'];
  const MONTH_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  let cache = null;
  let cacheAt = 0;
  let timer = null;

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function parseNumber(value){
    if(typeof value==='number') return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,''); if(!s)return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0){ if(c>d)s=s.replace(/\./g,'').replace(',','.'); else s=s.replace(/,/g,''); }
    else if(c>=0){ const p=s.split(','); s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,''); }
    else if(d>=0){ const p=s.split('.'); if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,''); }
    const n=Number(s); return Number.isFinite(n)?n:0;
  }
  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return[];
    const h=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));
  }
  async function payload(force=false){
    if(!force&&cache&&Date.now()-cacheAt<45000)return cache;
    if(!apiBaseUrl||!FINANCE_ID)return null;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false); if(!token)return null;
    const res=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'}); if(!res.ok)return null;
    cache=await res.json(); cacheAt=Date.now(); return cache;
  }
  function sourceRows(data,range){ return parseRows(data?.sources?.[`${FINANCE_ID}|${range}`]||[]); }
  function activeView(){ return document.querySelector('.nav-item.active')?.dataset.view||''; }
  function activeCurrency(){ return document.querySelector('.currency-btn.active')?.dataset.currency||'COP'; }
  function selectedGlobal(key){ return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||'').trim()).filter(Boolean); }

  function parseDate(value){
    const s=String(value||'').trim();
    let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(m)return new Date(+m[1],+m[2]-1,+m[3]);
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    return null;
  }
  function account(row){
    const raw=String(row['Cuenta / Tarjeta']||'').trim(),n=norm(raw),holder=norm(row.Titular);
    if(n.includes('efectivo'))return'Efectivo';
    if(n.includes('nequi'))return holder.includes('ro')?'Nequi Ro':'Nequi Edu';
    if(n.includes('arq'))return'ARQ Edu';
    if(n.includes('nu')){
      if(n.includes(' ro')||n.endsWith('ro')||holder==='ro'||holder.includes('rocio'))return'Nu Ro';
      if(n.includes('edu')||holder.includes('edu'))return'Nu Edu';
      return'Nu';
    }
    return raw||'Sin especificar';
  }
  function method(row){
    const explicit=String(row['Modalidad de pago']||'').trim(); if(explicit)return explicit;
    const raw=norm(row['Cuenta / Tarjeta']);
    if(raw.includes('credito')||raw.includes('crédito'))return'Crédito';
    if(raw.includes('transferencia'))return'Transferencia';
    if(raw.includes('debito')||raw.includes('débito'))return'Débito';
    if(raw.includes('efectivo'))return'Efectivo';
    const q=parseNumber(row.Cuotas); if(q>0&&(raw.includes('nu')||raw.includes('arq')))return'Crédito';
    return'Sin especificar';
  }
  function movementMatches(row,view){
    if(!(window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad/.test(norm(row.Estado))))return false;
    const d=parseDate(row['Fecha real']||row['Fecha registrada']);
    const years=selectedGlobal('year'),months=selectedGlobal('month'),cats=selectedGlobal('category'),subs=selectedGlobal('subcategory');
    if(years.length&&(!d||!years.includes(String(d.getFullYear()))))return false;
    if(months.length&&(!d||!months.includes(String(d.getMonth()+1))))return false;
    if(cats.length&&!cats.includes(String(row['Categoría']||'')))return false;
    if(subs.length&&!subs.includes(String(row['Subcategoría']||'')))return false;
    const st=window.__PAYMENT_FILTER_STATE__?.view===view?window.__PAYMENT_FILTER_STATE__:{account:[],method:[]};
    if(st.account?.length&&!st.account.includes(account(row)))return false;
    if(st.method?.length&&!st.method.includes(method(row)))return false;
    return norm(row.Tipo||row.Naturaleza||'gasto').includes('gasto')||norm(row.Naturaleza).includes('egreso')||!String(row.Tipo||'').trim();
  }
  function amount(row,currency){
    if(currency==='USD')return parseNumber(row['Monto USD']);
    if(currency==='ARS')return parseNumber(row['Monto ARS']);
    return parseNumber(row['Monto COP']);
  }
  function money(value,currency=activeCurrency()){
    const digits=currency==='USD'?2:0;
    return new Intl.NumberFormat('es-CO',{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value)||0);
  }

  function removeExpenseKpis(){
    if(activeView()!=='gastos')return;
    const root=document.getElementById('viewRoot'); if(!root)return;
    [...root.querySelectorAll('.kpi-grid')].forEach(grid=>{
      const labels=[...grid.querySelectorAll('.kpi-label')].map(x=>x.textContent.trim());
      if(labels.includes('Gasto seleccionado')||labels.includes('Ticket promedio')||labels.includes('Categorías')||labels.includes('Financiado'))grid.remove();
    });
  }
  function redrawSpendChart(rows){
    if(activeView()!=='gastos'||!window.Chart)return;
    const canvas=document.getElementById('spendChart'); if(!canvas)return;
    Chart.getChart(canvas)?.destroy();
    const currency=activeCurrency();
    const periods=[...new Set(rows.map(r=>{const d=parseDate(r['Fecha real']||r['Fecha registrada']);return d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`:'';}).filter(Boolean))].sort();
    const series=[...new Set(rows.map(r=>String(r['Categoría']||'Total')).filter(Boolean))].slice(0,10);
    const datasets=series.map((s,i)=>({label:s,data:periods.map(p=>rows.filter(r=>{const d=parseDate(r['Fecha real']||r['Fecha registrada']);return d&&`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`===p&&String(r['Categoría']||'Total')===s;}).reduce((a,r)=>a+amount(r,currency),0)),borderColor:COLORS[i%COLORS.length],backgroundColor:COLORS[i%COLORS.length],borderWidth:2,tension:.25}));
    const labels=periods.map(p=>{const[y,m]=p.split('-').map(Number);return`${MONTH_LABELS[m-1]} ${y}`;});
    new Chart(canvas,{type:'line',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}}},scales:{x:{ticks:{color:'#718098'},grid:{color:'#121c29'}},y:{beginAtZero:true,ticks:{color:'#718098'},grid:{color:'#121c29'}}}}});
  }

  function financingTotals(rows,currency){
    let one=0,multi=0;
    rows.forEach(row=>{
      if(norm(method(row))!=='credito')return;
      const q=Math.max(1,Math.round(parseNumber(row.Cuotas)||1));
      const v=amount(row,currency); if(q>1)multi+=v;else one+=v;
    });
    return{one,multi,total:one+multi};
  }
  function renderFinancing(rows){
    if(activeView()!=='flujo')return;
    const root=document.getElementById('viewRoot'); if(!root)return;
    const primary=[...root.querySelectorAll('.kpi-grid')].find(grid=>{
      const labels=[...grid.querySelectorAll('.kpi-label')].map(x=>x.textContent.trim());
      return labels.includes('Egresos')&&labels.includes('Ahorro')&&labels.some(x=>x==='Ingresos'||x==='Ingresos promedio');
    });
    if(!primary)return;
    const currency=activeCurrency(),totals=financingTotals(rows,currency);
    let host=root.querySelector('#flowFinancingKpis');
    if(!host){ host=document.createElement('div');host.id='flowFinancingKpis';host.className='kpi-grid flow-financing-kpis';host.style.gridTemplateColumns='repeat(3,minmax(0,1fr))';primary.insertAdjacentElement('afterend',host); }
    const html=`<div class="kpi-card"><span class="kpi-label">Financiado · 1 cuota</span><strong class="kpi-value">${esc(money(totals.one,currency))}</strong><div class="kpi-meta"><span>Compras a crédito en una sola cuota</span></div></div><div class="kpi-card"><span class="kpi-label">Financiado · más de 1 cuota</span><strong class="kpi-value gold">${esc(money(totals.multi,currency))}</strong><div class="kpi-meta"><span>Compras a crédito en 2 o más cuotas</span></div></div><div class="kpi-card"><span class="kpi-label">Financiado total</span><strong class="kpi-value gold">${esc(money(totals.total,currency))}</strong><div class="kpi-meta"><span>Total comprado a crédito</span></div></div>`;
    if(host.innerHTML!==html)host.innerHTML=html;
  }

  async function apply(force=false){
    const view=activeView(); if(view!=='gastos'&&view!=='flujo')return;
    const data=await payload(force); if(!data)return;
    const movements=sourceRows(data,'Movimientos!A:Z');
    const filtered=movements.filter(r=>movementMatches(r,view));
    if(view==='gastos'){removeExpenseKpis();redrawSpendChart(filtered);}else renderFinancing(filtered);
  }
  function schedule(delay=180,force=false){clearTimeout(timer);timer=setTimeout(()=>apply(force).catch(console.error),delay);}

  document.addEventListener('panel:payment-filters-changed',()=>schedule(100,false));
  document.addEventListener('panel:filters-updated',()=>schedule(140,false));
  document.addEventListener('click',e=>{
    if(e.target.closest('#refreshBtn')){cache=null;cacheAt=0;schedule(500,true);return;}
    if(e.target.closest('.multi-filter-option,.nav-item,.currency-btn,#resetCurrentMonth,#clearFilters,[data-clear-filter]'))schedule(220,false);
  },true);
  const start=()=>schedule(700,false);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();