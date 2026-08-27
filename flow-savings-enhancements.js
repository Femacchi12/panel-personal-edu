(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  let cache=null,cacheAt=0,timer=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  const activeCurrency=()=>document.querySelector('.currency-btn.active')?.dataset.currency||'COP';
  const formatMoney=(value,currency)=>new Intl.NumberFormat('es-CO',{style:'currency',currency,minimumFractionDigits:currency==='USD'?2:0,maximumFractionDigits:currency==='USD'?2:0}).format(Number(value)||0);

  async function payload(force=false){
    if(!force&&cache&&Date.now()-cacheAt<55000)return cache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false);if(!token)return null;
    const r=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!r.ok)throw new Error(`Backend ${r.status}`);
    cache=await r.json();cacheAt=Date.now();return cache;
  }

  function convertCop(value,currency,model){
    const n=Number(value)||0;
    if(currency==='USD')return n/(model.usdCopReference||3150);
    if(currency==='ARS')return n/2.1;
    return n;
  }

  function scenarioRows(avg,currency,model){
    return [0.40,0.30,0.20,0.10].map(rate=>({
      rate,
      monthlySavings:convertCop(avg.totalCop*rate,currency,model),
      monthlySpend:convertCop(avg.totalCop*(1-rate),currency,model),
      annualSavings:convertCop(avg.totalCop*12*rate,currency,model),
      annualSpend:convertCop(avg.totalCop*12*(1-rate),currency,model)
    }));
  }

  function panelHtml(avg,currency,model,year){
    const monthly=convertCop(avg.totalCop,currency,model),annual=monthly*12;
    const rows=scenarioRows(avg,currency,model).map(r=>`<tr><td>${Math.round(r.rate*100)}%</td><td>${esc(formatMoney(r.monthlySavings,currency))}</td><td>${esc(formatMoney(r.monthlySpend,currency))}</td><td>${esc(formatMoney(r.annualSavings,currency))}</td><td>${esc(formatMoney(r.annualSpend,currency))}</td></tr>`).join('');
    const support=avg.pending?`${avg.pending} mes(es) con soporte pendiente; se usa temporalmente la referencia regular.`:`Todos los meses usados en el promedio tienen base regular disponible.`;
    return `<div class="panel savings-scenario-panel" id="savingsScenarioPanel">
      <div class="panel-header"><div class="panel-title"><strong>Escenarios de capacidad de ahorro</strong><span>Base mensual regular promedio · sin extras</span></div></div>
      <div class="savings-reference-grid">
        <div class="savings-reference-card"><span>Ingreso mensual regular promedio</span><strong>${esc(formatMoney(monthly,currency))}</strong><small>Nómina COP + Fibrazo LLC básico</small></div>
        <div class="savings-reference-card"><span>Nómina COP promedio</span><strong>${esc(formatMoney(convertCop(avg.copRegular,currency,model),currency))}</strong><small>Solo componente recurrente</small></div>
        <div class="savings-reference-card"><span>Fibrazo LLC básico promedio</span><strong>${esc(formatMoney(convertCop(avg.usdEquivCop,currency,model),currency))}</strong><small>Base USD ${model.usdBase}</small></div>
        <div class="savings-reference-card"><span>Ingreso anual regular</span><strong>${esc(formatMoney(annual,currency))}</strong><small>12 × promedio mensual regular</small></div>
      </div>
      <div class="table-scroll"><table class="savings-scenario-table"><thead><tr><th>Meta</th><th>Ahorro mensual</th><th>Gasto máximo mensual</th><th>Ahorro anual</th><th>Gasto máximo anual</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="savings-scenario-note"><strong>Criterio ${year}:</strong> ${esc(support)} Primas, intereses, cesantías, devoluciones, bonos y otros extras quedan excluidos de la base regular.</div>
    </div>`;
  }

  async function enhanceSavings(force=false){
    if(activeView()!=='ingresos'||!window.RegularIncomeCore)return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const incomeComplete=root.querySelector('[data-income-complete]');if(!incomeComplete)return;
    try{
      const data=await payload(force);if(!data)return;
      const model=window.RegularIncomeCore.build(data,financeId);
      window.__PANEL_REGULAR_INCOME_MODEL__=model;
      const selectedYears=[...document.querySelectorAll('.multi-filter[data-filter="year"] .multi-filter-option.selected')].map(x=>String(x.dataset.value||'')).filter(Boolean);
      const year=selectedYears.length===1?selectedYears[0]:String(new Date().getFullYear());
      const avg=model.average(year)||model.average();if(!avg)return;
      const currency=activeCurrency();root.querySelector('#savingsScenarioPanel')?.remove();
      const temp=document.createElement('div');temp.innerHTML=panelHtml(avg,currency,model,year);const panel=temp.firstElementChild;
      const chartPanel=incomeComplete.querySelector('.panel');if(chartPanel)chartPanel.insertAdjacentElement('afterend',panel);else incomeComplete.prepend(panel);
    }catch(error){console.error('Escenarios de ahorro:',error);}
  }

  const schedule=(delay=140,force=false)=>{clearTimeout(timer);timer=setTimeout(()=>enhanceSavings(force),delay);};
  document.addEventListener('click',event=>{
    if(event.target.closest('.nav-item'))schedule(250,false);
    if(event.target.closest('.currency-btn,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters'))schedule(180,false);
    if(event.target.closest('#refreshBtn')){cache=null;cacheAt=0;schedule(600,true);}
  },true);
  setTimeout(()=>enhanceSavings(false),650);
})();
