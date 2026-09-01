(() => {
  'use strict';

  function applyChartDefaults(){
    const Chart=window.Chart;
    if(!Chart?.defaults)return;
    Chart.defaults.font.family='Inter, system-ui, sans-serif';
    Chart.defaults.font.size=10;
    Chart.defaults.color='#8796aa';
    Chart.defaults.animation=false;
    Chart.defaults.responsive=true;
    Chart.defaults.maintainAspectRatio=false;
    Chart.defaults.elements.line.borderWidth=2;
    Chart.defaults.elements.line.tension=.22;
    Chart.defaults.elements.point.radius=2;
    Chart.defaults.elements.point.hoverRadius=4;
    Chart.defaults.plugins.legend.labels.boxWidth=9;
    Chart.defaults.plugins.legend.labels.usePointStyle=true;
    Chart.defaults.plugins.legend.labels.padding=12;
    Chart.defaults.plugins.tooltip.titleFont={family:'Inter, system-ui, sans-serif',size:10,weight:'600'};
    Chart.defaults.plugins.tooltip.bodyFont={family:'Inter, system-ui, sans-serif',size:10};
  }

  function syncView(){
    document.body.dataset.panelView=document.querySelector('.nav-item.active')?.dataset.view||'general';
  }

  applyChartDefaults();
  syncView();
  document.addEventListener('panel:view-root-changed',syncView);
  document.addEventListener('click',event=>{
    if(event.target.closest('.nav-item[data-view]'))queueMicrotask(syncView);
  },true);
})();
