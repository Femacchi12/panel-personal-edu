(() => {
  'use strict';

  let frame = 0;
  let observer = null;
  let observedRoot = null;

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  function injectStyles() {
    if (document.getElementById('cardFinalCleanupStyles')) return;
    const style = document.createElement('style');
    style.id = 'cardFinalCleanupStyles';
    style.textContent = `
      #viewRoot [data-card-line-mode]{
        appearance:none!important;
        -webkit-appearance:none!important;
        border:1px solid #24364e!important;
        background:#0f1825!important;
        color:#8fa3bd!important;
        min-height:30px!important;
        padding:6px 11px!important;
        margin:0 3px 0 0!important;
        border-radius:8px!important;
        font:inherit!important;
        font-size:10px!important;
        line-height:1!important;
        font-weight:800!important;
        cursor:pointer!important;
        box-shadow:none!important;
        transition:background .15s ease,border-color .15s ease,color .15s ease!important;
      }
      #viewRoot [data-card-line-mode]:hover{
        border-color:#365a86!important;
        background:#13243a!important;
        color:#d6e6fa!important;
      }
      #viewRoot [data-card-line-mode].active,
      #viewRoot [data-card-line-mode][aria-pressed="true"]{
        border-color:#2d69b7!important;
        background:#173963!important;
        color:#f2f7ff!important;
        box-shadow:inset 0 0 0 1px rgba(110,170,255,.08)!important;
      }
      #viewRoot .card-expense-summary{grid-template-columns:repeat(3,minmax(0,1fr))!important}
      @media(max-width:760px){
        #viewRoot .card-expense-summary{grid-template-columns:1fr!important}
        #viewRoot [data-card-line-mode]{padding:6px 9px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function removeCardContext() {
    if (activeView() !== 'tarjetas') return;
    const root = document.getElementById('viewRoot');
    if (!root) return;
    root.querySelectorAll(':scope > .finance-context').forEach(node => node.remove());
  }

  function removeDuplicateFibrazoKpi() {
    if (activeView() !== 'tarjetas') return;
    const summary = document.querySelector('#viewRoot #cardExpenseScopePanel .card-expense-summary');
    if (!summary) return;
    [...summary.children].forEach(card => {
      const label = norm(card.querySelector('span')?.textContent);
      if (label === 'por recuperar de fibrazo') card.remove();
    });
  }

  function observeRoot() {
    if (activeView() !== 'tarjetas') {
      observer?.disconnect();
      observer = null;
      observedRoot = null;
      return;
    }
    const root = document.getElementById('viewRoot');
    if (!root || root === observedRoot) return;
    observer?.disconnect();
    observedRoot = root;
    observer = new MutationObserver(mutations => {
      if (activeView() !== 'tarjetas') return;
      const relevant = mutations.some(mutation => [...mutation.addedNodes].some(node => {
        if (node?.nodeType !== 1) return false;
        return node.matches?.('.finance-context,.card-expense-summary,#cardExpenseScopePanel') ||
          node.querySelector?.('.finance-context,.card-expense-summary,#cardExpenseScopePanel');
      }));
      if (relevant) schedule();
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function sync() {
    injectStyles();
    if (activeView() !== 'tarjetas') {
      observeRoot();
      return;
    }
    removeCardContext();
    removeDuplicateFibrazoKpi();
    observeRoot();
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  }

  document.addEventListener('panel:view-root-changed', schedule);
  document.addEventListener('panel:section-modules-ready', schedule);
  document.addEventListener('panel:filters-updated', schedule);
  document.addEventListener('panel:section-filters-changed', schedule);
  document.addEventListener('panel:card-filter-changed', schedule);
  document.addEventListener('panel:backend-data-loaded', schedule);
  document.addEventListener('panel:expense-scope-changed', schedule);

  injectStyles();
  queueMicrotask(schedule);
})();
