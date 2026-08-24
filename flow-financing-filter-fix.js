(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = String(cfg.financeSpreadsheetId || '');
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const MONTH_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const COLORS = ['#1769ff','#f6c844','#26d07c','#ff667a','#ffad42','#7a8ba5','#8b5cf6','#22d3ee','#f472b6','#a3e635'];

  let payloadCache = null;
  let payloadAt = 0;
  let timer = null;
  let applying = false;

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) s = s.replace(/\./g,'').replace(',','.');
      else s = s.replace(/,/g,'');
    } else if (comma >= 0) {
      const p = s.split(',');
      s = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g,'') + '.' + p[1] : s.replace(/,/g,'');
    } else if (dot >= 0) {
      const p = s.split('.');
      if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g,'');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v=>String(v ?? '').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!==''))
      .map(r=>Object.fromEntries(headers.map((h,i)=>[h || `Col ${i+1}`,r?.[i] ?? ''])));
  }

  async function payload() {
    if (payloadCache && Date.now() - payloadAt < 45000) return payloadCache;
    if (!apiBaseUrl || !FINANCE_ID) return null;
    const getIdToken = window.__PANEL_GET_ID_TOKEN__;
    if (typeof getIdToken !== 'function') return null;
    const token = await getIdToken(false);
    if (!token) return null;
    const res = await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if (!res.ok) return null;
    payloadCache = await res.json();
    payloadAt = Date.now();
    return payloadCache;
  }

  function sourceRows(data, range) {
    return parseRows(data?.sources?.[`${FINANCE_ID}|${range}`] || []);
  }

  function activeView(){return document.querySelector('.nav-item.active')?.dataset.view || '';}
  function activeCurrency(){return document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';}
  function selectedGlobal(key){return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||'').trim()).filter(Boolean);}

  function parseDate(value) {
    const s = String(value || '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return new Date(+m[1],+m[2]-1,+m[3]);
    m = s.match(/^(\d{4})-(\d{1,2})$/); if (m) return new Date(+m[1],+m[2]-1,1);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return new Date(+m[3],+m[2]-1,+m[1]);
    const months = {ene:0,feb:1,mar:2,abr:3,may:4,jun:5,jul:6,ago:7,sep:8,sept:8,oct:9,nov:10,dic:11};
    m = norm(s).match(/^(ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)\s+(\d{4})$/);
    if (m) return new Date(+m[2],months[m[1]],1);
    return null;
  }

  function account(row) {
    const raw = String(row['Cuenta / Tarjeta'] || '').trim();
    const n = norm(raw), holder = norm(row.Titular);
    if (n.includes('efectivo')) return 'Efectivo';
    if (n.includes('nequi')) return holder.includes('ro') ? 'Nequi Ro' : 'Nequi Edu';
    if (n.includes('arq')) return 'ARQ Edu';
    if (n.includes('nu')) {
      if (n.includes(' ro') || n.endsWith('ro') || holder === 'ro' || holder.includes('rocio')) return 'Nu Ro';
      if (n.includes('edu') || holder.includes('edu')) return 'Nu Edu';
      return 'Nu';
    }
    return raw || 'Sin especificar';
  }

  function method(row) {
    const explicit = String(row['Modalidad de pago'] || '').trim();
    if (explicit) return explicit;
    const raw = norm(row['Cuenta / Tarjeta']);
    if (raw.includes('credito') || raw.includes('crédito')) return 'Crédito';
    if (raw.includes('transferencia')) return 'Transferencia';
    if (raw.includes('debito') || raw.includes('débito')) return 'Débito';
    if (raw.includes('efectivo')) return 'Efectivo';
    const q = parseNumber(row.Cuotas);
    if (q > 0 && (raw.includes('nu') || raw.includes('arq'))) return 'Crédito';
    return 'Sin especificar';
  }

  function paymentStateFor(view) {
    const st = window.__PAYMENT_FILTER_STATE__;
    return st?.view === view ? st : {account:[],method:[],payment:[]};
  }

  function movementMatches(row, view) {
    const d = parseDate(row['Fecha real'] || row['Fecha registrada']);
    const years = selectedGlobal('year'), months = selectedGlobal('month'), cats = selectedGlobal('category'), subs = selectedGlobal('subcategory');
    if (years.length && (!d || !years.includes(String(d.getFullYear())))) return false;
    if (months.length && (!d || !months.includes(String(d.getMonth()+1)))) return false;
    if (cats.length && !cats.includes(String(row['Categoría'] || ''))) return false;
    if (subs.length && !subs.includes(String(row['Subcategoría'] || ''))) return false;
    const st = paymentStateFor(view);
    if (st.account?.length && !st.account.includes(account(row))) return false;
    if (st.method?.length && !st.method.includes(method(row))) return false;
    return norm(row.Tipo || row.Naturaleza || 'gasto').includes('gasto') || norm(row.Naturaleza).includes('egreso') || !String(row.Tipo||'').trim();
  }

  function amount(row,currency) {
    if (currency === 'USD') return parseNumber(row['Monto USD']);
    if (currency === 'ARS') return parseNumber(row['Monto ARS']);
    return parseNumber(row['Monto COP']);
  }

  function money(value,currency=activeCurrency()) {
    const digits = currency === 'USD' ? 2 : 0;
    return new Intl.NumberFormat('es-CO',{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value)||0);
  }

  function periodKey(row) {
    const d = parseDate(row['Fecha real'] || row['Fecha registrada']);
    return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` : '';
  }

  function removeExpenseKpis() {
    if (activeView() !== 'gastos') return;
    const root = document.getElementById('viewRoot');
    if (!root) return;
    [...root.querySelectorAll('.kpi-grid')].forEach(grid=>{
      const labels = [...grid.querySelectorAll('.kpi-label')].map(x=>x.textContent.trim());
      if (labels.includes('Gasto seleccionado') || labels.includes('Ticket promedio') || labels.includes('Categorías') || labels.includes('Financiado')) grid.remove();
    });
  }

  function redrawSpendChart(rows) {
    if (activeView() !== 'gastos' || !window.Chart) return;
    const canvas = document.getElementById('spendChart');
    if (!canvas) return;
    const current = Chart.getChart(canvas); if (current) current.destroy();
    const currency = activeCurrency();
    const subs = selectedGlobal('subcategory');
    const groupKey = subs.length ? r=>String(r['Subcategoría']||'Sin subcategoría') : r=>String(r['Categoría']||'Total');
    const periods = [...new Set(rows.map(periodKey).filter(Boolean))].sort();
    const series = [...new Set(rows.map(groupKey).filter(Boolean))].slice(0,10);
    const datasets = series.map((s,i)=>({label:s,data:periods.map(p=>rows.filter(r=>periodKey(r)===p && groupKey(r)===s).reduce((a,r)=>a+amount(r,currency),0)),borderColor:COLORS[i%COLORS.length],backgroundColor:COLORS[i%COLORS.length],borderWidth:2,tension:.25}));
    if (datasets.length > 1) datasets.push({label:'Total seleccionado',data:periods.map(p=>rows.filter(r=>periodKey(r)===p).reduce((a,r)=>a+amount(r,currency),0)),borderColor:'#f6f8fb',backgroundColor:'#f6f8fb',borderWidth:2,borderDash:[5,4],tension:.25});
    const labels = periods.map(p=>{const [y,m]=p.split('-').map(Number);return `${MONTH_LABELS[m-1]} ${y}`;});
    new Chart(canvas,{type:'line',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'nearest',intersect:false},plugins:{legend:{display:true,labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${money(ctx.parsed.y,currency)}`}}},scales:{x:{ticks:{color:'#718098',maxRotation:0,autoSkip:true},grid:{color:'#121c29'}},y:{beginAtZero:true,ticks:{color:'#718098',callback:v=>{const a=Math.abs(v);return a>=1e6?`${(v/1e6).toFixed(1)}M`:a>=1e3?`${(v/1e3).toFixed(0)}K`:v;}},grid:{color:'#121c29'}}}}});
  }

  function average(values) {
    const nums = values.map(parseNumber).filter(v=>v>0);
    return nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : 0;
  }

  function incomeReference(concepts) {
    const avgCop = average(concepts.map(r=>r['Sueldo COP']));
    const avgUsd = average(concepts.map(r=>r['Sueldo USD (equiv. COP)']));
    const ys = selectedGlobal('year'), ms = selectedGlobal('month');
    let selected = null;
    if (ys.length === 1 && ms.length === 1) {
      selected = concepts.find(r=>{
        const d = parseDate(r.Mes);
        return d && String(d.getFullYear())===ys[0] && String(d.getMonth()+1)===ms[0];
      }) || null;
    }
    if (!selected) return {value:avgCop+avgUsd,meta:'Promedio regular · Nómina COP + Fibrazo LLC'};
    const actualCop = parseNumber(selected['Sueldo COP']);
    const actualUsd = parseNumber(selected['Sueldo USD (equiv. COP)']);
    const missing = [];
    if (!actualCop) missing.push('Nómina COP');
    if (!actualUsd) missing.push('Fibrazo LLC');
    return {
      value:(actualCop || avgCop) + (actualUsd || avgUsd),
      meta:missing.length ? `Promedio regular · falta soporte: ${missing.join(' + ')}` : 'Nómina COP + Fibrazo LLC · soportado'
    };
  }

  function updateIncomeCard(concepts) {
    if (activeView() !== 'flujo') return;
    const root = document.getElementById('viewRoot'); if (!root) return;
    const card = [...root.querySelectorAll('.kpi-card')].find(c=>c.querySelector('.kpi-label')?.textContent.trim()==='Ingresos');
    if (!card) return;
    const ref = incomeReference(concepts);
    const label = card.querySelector('.kpi-label'), value = card.querySelector('.kpi-value'), meta = card.querySelector('.kpi-meta span');
    if (label) label.textContent='Ingresos promedio';
    if (value) value.textContent=money(ref.value,'COP');
    if (meta) meta.textContent=ref.meta;
  }

  function financingTotals(rows,currency) {
    let one=0,multi=0;
    rows.forEach(row=>{
      if (norm(method(row)) !== 'credito') return;
      const q = Math.max(1,Math.round(parseNumber(row.Cuotas) || 1));
      const v = amount(row,currency);
      if (q > 1) multi += v; else one += v;
    });
    return {one,multi,total:one+multi};
  }

  function insertFlowFinancing(rows) {
    if (activeView() !== 'flujo') return;
    const root = document.getElementById('viewRoot'); if (!root) return;
    const primary = [...root.querySelectorAll('.kpi-grid')].find(grid=>{
      const labels=[...grid.querySelectorAll('.kpi-label')].map(x=>x.textContent.trim());
      return labels.includes('Egresos') && labels.includes('Ahorro') && labels.some(x=>x==='Ingresos' || x==='Ingresos promedio');
    });
    if (!primary) return;
    root.querySelector('#flowFinancingKpis')?.remove();
    const currency = activeCurrency();
    const totals = financingTotals(rows,currency);
    const host = document.createElement('div');
    host.id='flowFinancingKpis';
    host.className='kpi-grid flow-financing-kpis';
    host.style.gridTemplateColumns='repeat(3,minmax(0,1fr))';
    host.innerHTML=`
      <div class="kpi-card"><span class="kpi-label">Financiado · 1 cuota</span><strong class="kpi-value">${esc(money(totals.one,currency))}</strong><div class="kpi-meta"><span>Compras a crédito en una sola cuota</span></div></div>
      <div class="kpi-card"><span class="kpi-label">Financiado · más de 1 cuota</span><strong class="kpi-value gold">${esc(money(totals.multi,currency))}</strong><div class="kpi-meta"><span>Compras a crédito en 2 o más cuotas</span></div></div>
      <div class="kpi-card"><span class="kpi-label">Financiado total</span><strong class="kpi-value gold">${esc(money(totals.total,currency))}</strong><div class="kpi-meta"><span>Total comprado a crédito</span></div></div>`;
    primary.insertAdjacentElement('afterend',host);
  }

  function tidyPaymentFilters() {
    const view = activeView();
    const bar = document.getElementById('paymentMethodFilterBar');
    const payment = bar?.querySelector('[data-pay-key="payment"]');
    if (payment) payment.style.display='none';
    if (bar) {
      const grid=bar.querySelector('.section-filter-grid');
      if (grid) grid.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';
    }
    if (view === 'flujo') {
      if (bar) bar.hidden=true;
      const category=document.querySelector('#globalFilters .multi-filter[data-filter="category"]');
      const sub=document.querySelector('#globalFilters .multi-filter[data-filter="subcategory"]');
      if(category)category.hidden=true;
      if(sub)sub.hidden=true;
    }
  }

  async function applyAll() {
    if (applying) return;
    applying = true;
    try {
      const view=activeView();
      if (view!=='gastos' && view!=='flujo') return;
      tidyPaymentFilters();
      const data=await payload(); if(!data)return;
      const mov = sourceRows(data,'Movimientos!A:Z').length ? sourceRows(data,'Movimientos!A:Z') : sourceRows(data,'Movimientos!A:Y');
      const filtered=mov.filter(r=>movementMatches(r,view));
      if(view==='gastos'){
        removeExpenseKpis();
        redrawSpendChart(filtered);
      } else {
        const concepts=sourceRows(data,'Resumen_Conceptos_Ingresos!A:L');
        updateIncomeCard(concepts);
        insertFlowFinancing(filtered);
      }
    } finally { applying=false; }
  }

  function schedule(delay=100){clearTimeout(timer);timer=setTimeout(()=>applyAll().catch(console.error),delay);}

  document.addEventListener('panel:payment-filters-changed',()=>schedule(30));
  document.addEventListener('click',e=>{
    if(e.target.closest('.multi-filter-option') || e.target.closest('.nav-item') || e.target.closest('.currency-btn') || e.target.closest('#resetCurrentMonth') || e.target.closest('#clearFilters')) schedule(180);
  },true);
  const root=document.getElementById('viewRoot');
  if(root)new MutationObserver(()=>schedule(140)).observe(root,{childList:true,subtree:false});
  const start=()=>schedule(700);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
