(() => {
  'use strict';

  const root = document.getElementById('viewRoot');
  if (!root || window.__PANEL_VIEW_ROOT_EVENTS__) return;
  window.__PANEL_VIEW_ROOT_EVENTS__ = true;

  let frame = 0;
  function emit() {
    frame = 0;
    const view = document.querySelector('.nav-item.active')?.dataset.view || '';

    // Módulos que reemplazan por completo viewRoot gestionan sus propias
    // mutaciones. Ignorarlas cuando ya están estables evita recargas
    // recursivas y lecturas innecesarias del payload central.
    if (view === 'viajes' && (root.querySelector('.travel-dashboard') || root.querySelector('.travel-loading'))) return;
    if (view === 'general' && (root.querySelector('[data-general-dashboard]') || root.querySelector('.general-loading'))) return;
    if (view === 'patrimonio' && root.querySelector('.patrimonio-dashboard')) return;

    document.dispatchEvent(new CustomEvent('panel:view-root-changed', {
      detail: { view, root }
    }));
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(emit);
  }

  new MutationObserver(schedule).observe(root, { childList: true, subtree: false });
  queueMicrotask(schedule);
})();