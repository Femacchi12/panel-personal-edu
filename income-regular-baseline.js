(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  let cache=null,cacheAt=0,timer=null;
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  const activeCurrency=()=>document.querySelector('.currency-btn.active')?.dataset.currency||'COP';
  const selectedYear=()=>{const y=[...document.querySelectorAll('.multi-filter[data-filter="year"] .multi-filter-option.selected')].map(x=>String(x.dataset.value||'')).filter(Boolean);return y.length===1?y[0]:String(new Date().getFullYear());};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));

  async function payload(force=false){
    if(!force&&cache&&Date.now()-cacheAt<55000)return cache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false);if(!token)return null;
    const r=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!r.ok)throw new Error(`Backend ${r.status}`);
    cache=await r.json();cacheAt=Date.now();return cache;
  }

  function convertCop(value,currency,model){const n=Number(value)||0;if(currency==='USD')return n/(model.usdCopReference||3150);if(currency==='ARS')return n/2.1;return n;}
  function formatMoney(value,currency){return new Intl.NumberFormat('es-CO',{style:'currency',currency,minimumFractionDigits:currency==='USD'?2:0,maximumFractionDigits:currency==='USD'?2:0}).format(Number(value)||0);}
  function formatUsd(value){return new Intl.NumberFormat('es-CO',{maximumFractionDigits:2}).format(Number(value)||0);}

  function render(model,avg,year){
    const root=document.getElementById('viewRoot');if(!root||activeView()!=='ingresos')return;
    const anchor=root.querySelector('[data-income-complete]')||root;
    let panel=root.querySelector('#incomeRegularBaselinePanel');
    if(!panel){panel=document.createElement('div');panel.id='incomeRegularBaselinePanel';panel.className='panel';const first=anchor.querySelector('.panel');if(first)first.insertAdjacentElement('afterend',panel);else anchor.prepend(panel);}

    const now=new Date(),limit=year===String(now.getFullYear())?now.getMonth()+1:12;
    const yearMonths=[...model.months.values()].filter(m=>m.year===year&&Number(m.key.slice(5,7))<=limit);
    const supported=yearMonths.filter(m=>m.complete).length;
    const pending=yearMonths.filter(m=>m.missingSupport.length).length;
    const currency=activeCurrency();
    const total=convertCop(avg.totalCop,currency,model),salary=convertCop(avg.copRegular,currency,model),usdEquiv=convertCop(avg.usdEquivCop,currency,model);
    const supportText=pending?`${pending} mes(es) con soporte pendiente`:'Base regular soportada para los meses disponibles';

    panel.innerHTML=`<div class="panel-header"><div class="panel-title"><strong>Base mensual regular promedio</strong><span>Nómina COP + Fibrazo LLC básico · sin extras</span></div></div>
      <div class="savings-reference-grid">
        <div class="savings-reference-card"><span>Nómina COP promedio</span><strong>${esc(formatMoney(salary,currency))}</strong><small>Solo componente recurrente</small></div>
        <div class="savings-reference-card"><span>Fibrazo LLC básico</span><strong>USD ${esc(formatUsd(avg.usdRegular))}</strong><small>≈ ${esc(formatMoney(usdEquiv,currency))} · base configurable</small></div>
        <div class="savings-reference-card"><span>Ingreso mensual regular promedio</span><strong>${esc(formatMoney(total,currency))}</strong><small>Base única para ahorro y porcentajes</small></div>
        <div class="savings-reference-card"><span>Soportes ${esc(year)}</span><strong>${supported}/${limit}</strong><small>${esc(supportText)}</small></div>
      </div>
      <div class="savings-scenario-note"><strong>Criterio:</strong> si falta soporte de un mes, se mantiene temporalmente la referencia regular disponible y se identifica como pendiente. Al cargar el soporte, la base se recalcula automáticamente. Primas, intereses, bonos, cesantías, devoluciones y demás extras nunca se incorporan.</div>`;
  }

  async function apply(force=false){
    if(activeView()!=='ingresos'||!window.RegularIncomeCore)return;
    try{const data=await payload(force);if(!data)return;const model=window.RegularIncomeCore.build(data,financeId);window.__PANEL_REGULAR_INCOME_MODEL__=model;const year=selectedYear(),avg=model.average(year)||model.average();if(avg)render(model,avg,year);}catch(error){console.error('Base regular de ingresos:',error);}
  }

  const schedule=(delay=180,force=false)=>{clearTimeout(timer);timer=setTimeout(()=>apply(force),delay);};
  document.addEventListener('click',event=>{
    if(event.target.closest('.nav-item'))schedule(280,false);
    if(event.target.closest('.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters,.currency-btn'))schedule(180,false);
    if(event.target.closest('#refreshBtn')){cache=null;cacheAt=0;schedule(600,true);}
  },true);
  setTimeout(()=>apply(false),700);
})();
