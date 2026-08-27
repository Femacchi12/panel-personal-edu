(() => {
  'use strict';

  let aliasAll = false;
  let timer = null;

  function activeView(){ return document.querySelector('.nav-item.active')?.dataset.view || ''; }

  function ensureAllOption(){
    if(activeView()!=='inversiones') return;
    const root=document.getElementById('investmentV2ModeFilter');
    if(!root) return;
    const box=root.querySelector('.local-options');
    if(!box) return;

    let all=box.querySelector('[data-investment-mode-all]');
    if(!all){
      all=document.createElement('button');
      all.type='button';
      all.className='multi-filter-option local-option';
      all.dataset.investmentModeAll='1';
      all.dataset.value='__all__';
      all.dataset.label='Todos';
      all.innerHTML='<span class="multi-filter-check"></span><span>Todos</span>';
      box.prepend(all);
    }

    if(aliasAll){
      box.querySelectorAll('.local-option').forEach(btn=>{
        const on=btn===all;
        btn.classList.toggle('selected',on);
        btn.setAttribute('aria-pressed',on?'true':'false');
        const check=btn.querySelector('.multi-filter-check'); if(check)check.textContent=on?'✓':'';
      });
      const summary=root.querySelector('.local-summary'); if(summary)summary.textContent='Todos';
      root.classList.remove('has-selection');
    }
  }

  function schedule(delay=120){ clearTimeout(timer); timer=setTimeout(ensureAllOption,delay); }

  document.addEventListener('click',event=>{
    const all=event.target.closest?.('[data-investment-mode-all]');
    if(all){
      event.preventDefault(); event.stopPropagation();
      const root=all.closest('#investmentV2ModeFilter');
      const total=root?.querySelector('.local-option[data-value="total"]');
      aliasAll=true;
      if(total) total.click();
      schedule(80); schedule(260);
      return;
    }
    if(event.target.closest?.('#investmentV2ModeFilter .local-option')){
      aliasAll=false;
      schedule(120);
      return;
    }
    if(event.target.closest?.('.nav-item,.multi-filter-option,#clearFilters,#resetCurrentMonth,#clearSectionFilters,#refreshBtn')) schedule(220);
  },true);

  [350,900,1600].forEach(ms=>setTimeout(ensureAllOption,ms));
})();