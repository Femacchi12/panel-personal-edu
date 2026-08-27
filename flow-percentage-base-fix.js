(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  let cache = null, cacheAt = 0, timer = null, applying = false;
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const money = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);
  const usd = v => new Intl.NumberFormat('es-CO',{maximumFractionDigits:2}).format(Number(v)||0);
  const pct = v => `${new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1}).format((Number(v)||0)*100)}%`;
  const pctClass = v => { const p=(Number(v)||0)*100; return p>15?'pct-red':p>10?'pct-yellow':p>5?'pct-green':'pct-white'; };
  const num = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,''); if(!s)return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
    else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  };

  async function payload(force=false){
    if(!force&&cache&&Date.now()-cacheAt<55000)return cache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false); if(!token)return null;
    const r=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'}); if(!r.ok)throw new Error(`Backend ${r.status}`);
    cache=await r.json(); cacheAt=Date.now(); return cache;
  }

  function updateCards(model){
    document.querySelectorAll('.salary-reference-grid > div').forEach(card=>{
      const label=card.querySelector('span')?.textContent||'';
      const key=window.RegularIncomeCore?.monthKey(label);
      const base=key?model.months.get(key):null;
      if(!base||!base.usable)return;
      card.innerHTML=`
        <span>${label}</span>
        <strong>${money(base.totalCop)}</strong>
        <small class="income-base-breakdown">Nómina COP ${money(base.copRegular)}${base.copConfirmed?'':' · pendiente soporte'}</small>
        <small class="income-base-breakdown">Fibrazo LLC USD ${usd(base.usdRegular)} · ≈ ${money(base.usdEquivCop)}${base.usdConfirmed?'':' · pendiente soporte'}</small>
        <small class="income-base-status ${base.complete?'income-base-ok':'income-base-estimated'}">${base.complete?'Base regular confirmada':'Base regular estimada · usada para calcular %'}</small>`;
    });
  }

  function updateMatrix(model){
    const table=document.querySelector('.flow-matrix-advanced'); if(!table)return;
    const months=[...table.querySelectorAll('thead tr:first-child th[data-flow-sort-month]')].map(th=>th.dataset.flowSortMonth||'');
    table.querySelectorAll('tbody tr').forEach(row=>months.forEach((key,i)=>{
      const base=model.months.get(key)?.totalCop; if(!(base>0))return;
      const amountCell=row.cells?.[2+i*2], pctCell=row.cells?.[3+i*2]; if(!amountCell||!pctCell)return;
      const share=num(amountCell.textContent)/base;
      let span=pctCell.querySelector('.matrix-pct'); if(!span){pctCell.textContent='';span=document.createElement('span');pctCell.appendChild(span);}
      span.textContent=pct(share); span.className=`matrix-pct ${pctClass(share)}`;
    }));
  }

  function setTextIfChanged(cell,value){
    if(cell&&cell.textContent!==value)cell.textContent=value;
  }

  function updateSavingsTable(model){
    const table=[...document.querySelectorAll('table')].find(t=>{
      const title=norm(t.closest('.panel')?.querySelector('.panel-title strong')?.textContent);
      return title.includes('flujo y ahorro mensual');
    });
    if(!table)return;

    const headers=[...table.querySelectorAll('thead th')].map(th=>norm(th.textContent));
    const monthIndex=headers.findIndex(h=>h==='mes');
    const incomeIndex=headers.findIndex(h=>h.includes('ingresos reales'));
    const expenseIndex=headers.findIndex(h=>h.includes('egresos reales'));
    const savingsIndex=headers.findIndex(h=>h.includes('ahorro real'));
    const rateIndex=headers.findIndex(h=>h.includes('tasa de ahorro'));
    if(monthIndex<0||expenseIndex<0||rateIndex<0)return;

    table.querySelectorAll('tbody tr').forEach(row=>{
      const cells=row.cells;if(!cells?.length)return;
      const key=window.RegularIncomeCore?.monthKey(cells[monthIndex]?.textContent||'');
      const base=key?model.months.get(key)?.totalCop:0;
      if(!(base>0))return;
      const expenses=num(cells[expenseIndex]?.textContent);
      const savings=base-expenses;
      if(incomeIndex>=0)setTextIfChanged(cells[incomeIndex],money(base));
      if(savingsIndex>=0)setTextIfChanged(cells[savingsIndex],money(savings));
      setTextIfChanged(cells[rateIndex],pct(savings/base));
    });
  }

  function updateNote(model){
    const reference=document.querySelector('.salary-reference'); if(!reference)return;
    let note=reference.querySelector('.income-base-note'); if(!note){note=document.createElement('div');note.className='income-base-note';reference.appendChild(note);}
    const pending=[...model.months.values()].filter(m=>m.missingSupport.length).length;
    note.textContent=`Base regular única = nómina COP regular + Fibrazo LLC básico USD ${model.usdBase}. Primas, intereses, cesantías, devoluciones y extras no se incluyen.${pending?` Hay ${pending} mes(es) con soporte pendiente y se usa temporalmente la referencia regular.`:''}`;
  }

  async function apply(force=false){
    if(applying||document.querySelector('.nav-item.active')?.dataset.view!=='flujo')return;
    if(!document.querySelector('.flow-matrix-advanced'))return;
    applying=true;
    try{
      const data=await payload(force); if(!data||!window.RegularIncomeCore)return;
      const model=window.RegularIncomeCore.build(data,financeId);
      window.__PANEL_REGULAR_INCOME_MODEL__=model;
      updateCards(model);
      updateMatrix(model);
      updateSavingsTable(model);
      updateNote(model);
      document.dispatchEvent(new CustomEvent('panel:regular-income-base-applied'));
    }catch(error){console.error('Base regular unificada:',error);}finally{applying=false;}
  }

  const schedule=(force=false,delay=180)=>{clearTimeout(timer);timer=setTimeout(()=>apply(force),delay);};
  document.addEventListener('panel:flow-matrix-v3-rendered',()=>schedule(false,80));
  document.addEventListener('panel:payment-filters-changed',()=>schedule(false,160));
  document.addEventListener('panel:filters-updated',()=>schedule(false,160));
  document.addEventListener('click',event=>{
    if(event.target.closest('#refreshBtn')){cache=null;cacheAt=0;schedule(true,500);}
    else if(event.target.closest('.nav-item,.multi-filter-option,.currency-btn,#resetCurrentMonth,#clearFilters,[data-clear-filter]'))schedule(false,260);
  },true);
  schedule(false,700);
})();
