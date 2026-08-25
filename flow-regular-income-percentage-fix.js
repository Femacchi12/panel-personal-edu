(() => {
  'use strict';

  let timer = null;
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function parseMoney(value) {
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) s = s.replace(/\./g,'').replace(',','.');
      else s = s.replace(/,/g,'');
    } else if (comma >= 0) {
      const p=s.split(',');
      s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');
    } else if (dot >= 0) {
      const p=s.split('.');
      if (p.length>2 || (p.length===2 && p[1].length===3)) s=s.replace(/\./g,'');
    }
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function pct(value) {
    return `${new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1}).format((Number(value)||0)*100)}%`;
  }

  function pctClass(share) {
    const p=(Number(share)||0)*100;
    if(p>15)return'pct-red';
    if(p>10)return'pct-yellow';
    if(p>5)return'pct-green';
    return'pct-white';
  }

  function regularBases() {
    const cards=[...document.querySelectorAll('.salary-reference-grid>div')];
    return cards.map(card=>parseMoney(card.querySelector('strong')?.textContent));
  }

  function setPctCell(cell, share) {
    const text=pct(share), cls=pctClass(share);
    let span=cell.querySelector('.matrix-pct');
    if(!span){
      cell.textContent='';
      span=document.createElement('span');
      span.className=`matrix-pct ${cls}`;
      span.textContent=text;
      cell.appendChild(span);
      return;
    }
    if(span.textContent!==text) span.textContent=text;
    const next=`matrix-pct ${cls}`;
    if(span.className!==next) span.className=next;
  }

  function fixMatrix() {
    const table=document.querySelector('.flow-matrix-advanced');
    if(!table)return false;
    const bases=regularBases();
    if(!bases.length || !bases.some(v=>v>0))return false;

    table.querySelectorAll('tbody tr').forEach(row=>{
      bases.forEach((base,index)=>{
        const amountCell=row.cells?.[2 + index*2];
        const pctCell=row.cells?.[3 + index*2];
        if(!amountCell || !pctCell || !(base>0))return;
        const amount=parseMoney(amountCell.textContent);
        setPctCell(pctCell,amount/base);
      });
    });
    return true;
  }

  const formatCop=value=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(value);
  function setTextIfChanged(cell,value){if(cell&&cell.textContent!==value)cell.textContent=value;}

  function fixSavingsTable() {
    const table=[...document.querySelectorAll('table')].find(t=>{
      const text=norm(t.closest('.panel')?.querySelector('.panel-title strong')?.textContent);
      return text.includes('flujo y ahorro mensual');
    });
    if(!table)return;
    const cards=[...document.querySelectorAll('.salary-reference-grid>div')];
    const baseByLabel=new Map(cards.map(card=>[norm(card.querySelector('span')?.textContent),parseMoney(card.querySelector('strong')?.textContent)]));
    const headers=[...table.querySelectorAll('thead th')].map(th=>norm(th.textContent));
    const monthIndex=headers.findIndex(h=>h==='mes');
    const incomeIndex=headers.findIndex(h=>h.includes('ingresos reales'));
    const expenseIndex=headers.findIndex(h=>h.includes('egresos reales'));
    const savingsIndex=headers.findIndex(h=>h.includes('ahorro real'));
    const rateIndex=headers.findIndex(h=>h.includes('tasa de ahorro'));
    if(monthIndex<0 || expenseIndex<0 || rateIndex<0)return;

    table.querySelectorAll('tbody tr').forEach(row=>{
      const cells=row.cells;if(!cells?.length)return;
      const label=norm(cells[monthIndex]?.textContent);
      let base=0;
      for(const [key,value] of baseByLabel){
        const parts=key.split(' ');
        if(parts.length>=2 && label.includes(parts[0]) && label.includes(parts[1])){base=value;break;}
      }
      if(!(base>0))return;
      const expenses=parseMoney(cells[expenseIndex]?.textContent);
      const savings=base-expenses;
      if(incomeIndex>=0)setTextIfChanged(cells[incomeIndex],formatCop(base));
      if(savingsIndex>=0)setTextIfChanged(cells[savingsIndex],formatCop(savings));
      setTextIfChanged(cells[rateIndex],pct(savings/base));
    });
  }

  function apply() {
    if(document.querySelector('.nav-item.active')?.dataset.view!=='flujo')return;
    fixMatrix();
    fixSavingsTable();
  }

  function schedule(delay=350){clearTimeout(timer);timer=setTimeout(apply,delay);}

  // Sin MutationObserver: este módulo se ejecuta únicamente ante acciones reales.
  // Observar characterData/subtree hacía que sus propias escrituras reactivaran
  // el módulo indefinidamente.
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-view="flujo"],#refreshBtn,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters,.currency-btn'))schedule(500);
  });
  document.addEventListener('panel:payment-filters-changed',()=>schedule(350));
  [700,1400,2400].forEach(ms=>setTimeout(apply,ms));
})();