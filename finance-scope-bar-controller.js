(() => {
  'use strict';

  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';

  function ensure(){
    if(activeView()!=='gastos')return;
    const main=document.querySelector('.main');if(!main)return;
    let bar=document.getElementById('sectionFilterBar');
    if(!bar){
      bar=document.createElement('section');
      bar.id='sectionFilterBar';
      bar.className='filter-bar section-filter-bar';
      const global=document.getElementById('filterBar');
      if(global)global.insertAdjacentElement('afterend',bar);else main.prepend(bar);
    }
    if(!bar.querySelector('.section-filter-grid')){
      bar.innerHTML='<div class="filter-head"><div><span class="eyebrow">FILTROS DE LA SECCIÓN</span><strong>Gastos diarios</strong></div></div><div class="section-filter-grid"></div>';
    }
    bar.hidden=false;
    document.dispatchEvent(new CustomEvent('panel:finance-scope-bar-ready',{detail:{view:'gastos'}}));
  }

  document.addEventListener('panel:view-root-changed',event=>{if(event.detail?.view==='gastos')requestAnimationFrame(ensure);});
  document.addEventListener('panel:section-modules-ready',event=>{if(event.detail?.view==='gastos')requestAnimationFrame(ensure);});
  queueMicrotask(()=>requestAnimationFrame(ensure));
})();