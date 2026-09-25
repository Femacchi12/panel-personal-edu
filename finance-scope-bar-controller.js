(() => {
  'use strict';

  const META = Object.freeze({
    gastos: 'Gastos diarios',
    flujo: 'Flujo mensual'
  });
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const core = () => window.FinanceScopeCore || null;

  function ensureStyles(){
    if(document.getElementById('sharedFinanceScopeBarStyles')) return;
    const style=document.createElement('style');
    style.id='sharedFinanceScopeBarStyles';
    style.textContent=`
      .section-scope-filter{min-width:260px}
      .section-scope-buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:3px;border:1px solid #213047;border-radius:9px;background:#0b131e}
      .section-scope-buttons button{border:0;background:transparent;color:#8496ad;border-radius:6px;padding:7px 8px;font-size:9px;font-weight:800;cursor:pointer}
      .section-scope-buttons button.active{background:#17345f;color:#e7f1ff}
      .section-scope-buttons button[data-scope="FIBRAZO"].active{background:#493816;color:#ffd66b}
      @media(max-width:700px){.section-scope-filter{min-width:0}}
    `;
    document.head.appendChild(style);
  }

  function currentScope(view){
    return core()?.getScope?.(view) || window.__FINANCE_SCOPE_FILTER_STATE__?.[view] || 'Personal';
  }

  function setScope(view,scope){
    if(core()?.setScope) return core().setScope(view,scope,{emit:true,source:'finance-scope-bar'});
    const state=window.__FINANCE_SCOPE_FILTER_STATE__||{};
    if(state[view]===scope) return scope;
    state[view]=scope;
    window.__FINANCE_SCOPE_FILTER_STATE__=state;
    document.dispatchEvent(new CustomEvent('panel:expense-scope-changed',{detail:{view,scope,source:'finance-scope-bar'}}));
    return scope;
  }

  function renderScopeControl(grid,view){
    let root=grid.querySelector('[data-section-scope-filter]');
    if(!root){
      root=document.createElement('div');
      root.className='section-scope-filter finance-scope-filter flow-scope-filter';
      root.dataset.sectionScopeFilter='true';
      root.dataset.financeScopeFilter='true';
      root.dataset.flowScopeFilter='true';
      root.innerHTML=`<div class="filter-label-row"><span>Ámbito</span></div><div class="section-scope-buttons"><button type="button" data-scope="Personal">Personal</button><button type="button" data-scope="FIBRAZO">FIBRAZO</button><button type="button" data-scope="Todos">Todos</button></div>`;
      grid.prepend(root);
    }
    root.dataset.scopeView=view;
    const selected=currentScope(view);
    root.querySelectorAll('[data-scope]').forEach(button=>{
      const active=button.dataset.scope===selected;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',active?'true':'false');
    });
    return root;
  }

  function ensure(requestedView = activeView()){
    ensureStyles();
    const view=META[requestedView]?requestedView:activeView();
    const main=document.querySelector('.main');
    if(!main) return;

    let bar=document.getElementById('sectionFilterBar');
    if(!META[view]){
      if(bar) bar.hidden=true;
      return;
    }

    if(!bar){
      bar=document.createElement('section');
      bar.id='sectionFilterBar';
      bar.className='filter-bar section-filter-bar';
      const global=document.getElementById('filterBar');
      if(global) global.insertAdjacentElement('afterend',bar);
      else main.prepend(bar);
    }

    if(!bar.dataset.scopeDelegated){
      bar.dataset.scopeDelegated='1';
      bar.addEventListener('click',event=>{
        const button=event.target.closest?.('[data-section-scope-filter] [data-scope]');
        if(!button) return;
        const root=button.closest('[data-section-scope-filter]');
        const targetView=root?.dataset.scopeView || bar.dataset.view || activeView();
        if(!META[targetView]) return;
        const next=String(button.dataset.scope||'Personal');
        setScope(targetView,next);
        renderScopeControl(bar.querySelector('.section-filter-grid'),targetView);
      });
    }

    if(bar.dataset.view!==view || !bar.querySelector('.section-filter-grid')){
      bar.dataset.view=view;
      bar.innerHTML=`<div class="filter-head"><div><span class="eyebrow">FILTROS DE LA SECCIÓN</span><strong>${META[view]}</strong></div></div><div class="section-filter-grid"></div>`;
    }

    const grid=bar.querySelector('.section-filter-grid');
    if(grid) renderScopeControl(grid,view);
    bar.hidden=false;
    document.dispatchEvent(new CustomEvent('panel:finance-scope-bar-ready',{detail:{view,scope:currentScope(view)}}));
  }

  window.__PANEL_ENSURE_FINANCE_SCOPE_BAR__=ensure;

  document.addEventListener('panel:expense-scope-changed',event=>{
    const view=event.detail?.view;
    if(view===activeView() && META[view]) requestAnimationFrame(()=>ensure(view));
  });
  document.addEventListener('panel:view-root-changed',event=>requestAnimationFrame(()=>ensure(event.detail?.view||activeView())));
  document.addEventListener('panel:section-modules-ready',event=>requestAnimationFrame(()=>ensure(event.detail?.view||activeView())));
  document.addEventListener('click',event=>{
    const nav=event.target.closest?.('.nav-item[data-view]');
    if(nav) setTimeout(()=>ensure(nav.dataset.view||activeView()),0);
  },true);
  queueMicrotask(()=>requestAnimationFrame(()=>ensure()));
})();