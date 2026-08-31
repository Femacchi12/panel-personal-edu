(() => {
  'use strict';

  const root = document.getElementById('viewRoot');
  if (!root || window.__PANEL_VIEW_ROOT_EVENTS__) return;
  window.__PANEL_VIEW_ROOT_EVENTS__ = true;

  let frame = 0;
  function emit() {
    frame = 0;
    const view = document.querySelector('.nav-item.active')?.dataset.view || '';

    // Los módulos especializados de Viajes reemplazan el contenido de viewRoot.
    // Ignorar esas mutaciones internas evita que el propio módulo se dispare
    // nuevamente y genere lecturas repetidas de Sheets.
    if (view === 'viajes' && (root.querySelector('.travel-dashboard') || root.querySelector('.travel-loading'))) return;

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
