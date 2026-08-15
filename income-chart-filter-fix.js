(() => {
  'use strict';
  let timer = null;

  function parseNumber(value) {
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const comma=s.lastIndexOf(','), dot=s.lastIndexOf('.');
    if (comma>=0 && dot>=0) {
      if (comma>dot) s=s.replace(/\./g,'').replace(',','.');
      else s=s.replace(/,/g,'');
    } else if (comma>=0) {
      const parts=s.split(',');
      if (parts.length===2 && parts[1].length<=2) s=parts[0].replace(/\./g,'')+'.'+parts[1];
      else s=s.replace(/,/g,'');
    } else if (dot>=0) {
      const parts=s.split('.');
      if (parts.length>2 || (parts.length===2 && parts[1].length===3)) s=s.replace(/\./g,'');
    }
    return Number(s) || 0;
  }

  function sync() {
    const canvas=document.getElementById('incomeCompleteChart');
    if (!canvas || !window.Chart) return;
    const chart=Chart.getChart(canvas);
    if (!chart) return;

    const panels=[...document.querySelectorAll('#viewRoot .panel')];
    const panel=panels.find(p=>p.querySelector('.panel-title strong')?.textContent?.trim()==='Conceptos consolidados');
    const table=panel?.querySelector('table');
    if (!table) return;
    const headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    const index=name=>headers.indexOf(name);
    const ixMes=index('Mes'), ixCop=index('Sueldo COP'), ixUsd=index('Sueldo USD (equiv. COP)'), ixTotal=index('Total consolidado');
    if ([ixMes,ixCop,ixUsd,ixTotal].some(i=>i<0)) return;

    const rows=[...table.querySelectorAll('tbody tr')].map(tr=>[...tr.children].map(td=>td.textContent.trim()));
    const labels=rows.map(r=>r[ixMes]);
    const salaryCop=rows.map(r=>parseNumber(r[ixCop]));
    const salaryUsd=rows.map(r=>parseNumber(r[ixUsd]));
    const totals=rows.map(r=>parseNumber(r[ixTotal]));
    const extras=totals.map((v,i)=>Math.max(0,v-salaryCop[i]-salaryUsd[i]));

    chart.data.labels=labels;
    const series=[salaryCop,salaryUsd,extras,totals];
    chart.data.datasets.forEach((ds,i)=>{ if(series[i]) ds.data=series[i]; });
    chart.update();
  }

  function schedule(){clearTimeout(timer);timer=setTimeout(sync,80);}
  const root=document.getElementById('viewRoot');
  if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
  document.addEventListener('click',e=>{
    if(e.target.closest('.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters,.nav-item'))setTimeout(schedule,120);
  });
  schedule();
})();
