(() => {
  'use strict';

  let frame = 0;
  let observer = null;
  let observedRoot = null;

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function removeCardContext() {
    if (activeView() !== 'tarjetas') return;
    const root = document.getElementById('viewRoot');
    if (!root) return;
    root.querySelectorAll(':scope > .finance-context').forEach(node => node.remove());
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
      const addedContext = mutations.some(mutation => [...mutation.addedNodes].some(node => node?.nodeType === 1 && (node.matches?.('.finance-context') || node.querySelector?.('.finance-context'))));
      if (addedContext) schedule();
    });
    observer.observe(root, { childList: true });
  }

  function sync() {
    if (activeView() !== 'tarjetas') {
      observeRoot();
      return;
    }
    removeCardContext();
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

  queueMicrotask(schedule);
})();
