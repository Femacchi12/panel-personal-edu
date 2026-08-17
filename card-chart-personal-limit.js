(() => {
  'use strict';
  const ARQ_PERSONAL_LIMIT = 3000000;
  let timer = null;

  function activeView(){ return document.querySelector('.nav-item.active')?.dataset.view || ''; }

  function run(){
    if(activeView() !== 'tarjetas' || !window.Chart) return;
    const canvas = document.getElementById('cardsChart');
    if(!canvas) return;
    const chart = Chart.getChart(canvas);
    if(!chart) return;
    const labels = chart.data?.labels || [];
    const index = labels.findIndex(label => String(label || '').toLowerCase().includes('arq'));
    if(index < 0) return;
    const usedDs = (chart.data.datasets || []).find(ds => String(ds.label || '').toLowerCase().includes('usado'));
    const availableDs = (chart.data.datasets || []).find(ds => String(ds.label || '').toLowerCase().includes('disponible'));
    if(!usedDs || !availableDs) return;
    const used = Number(usedDs.data?.[index] || 0);
    availableDs.data[index] = Math.max(0, ARQ_PERSONAL_LIMIT - used);
    availableDs.label = 'Disponible / margen de control';
    chart.update('none');
  }

  function schedule(delay=180){ clearTimeout(timer); timer=setTimeout(run,delay); }
  document.addEventListener('click',e=>{
    if(e.target.closest('.nav-item,#refreshBtn,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters')) setTimeout(()=>schedule(220),50);
  });
  const root=document.getElementById('viewRoot');
  if(root) new MutationObserver(()=>schedule()).observe(root,{childList:true,subtree:false});
  schedule(300);
})();
