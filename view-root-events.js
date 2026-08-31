(() => {
  'use strict';

  const root = document.getElementById('viewRoot');
  if (!root || window.__PANEL_VIEW_ROOT_EVENTS__) return;
  window.__PANEL_VIEW_ROOT_EVENTS__ = true;

  let frame = 0;
  function emit() {
    frame = 0;
    const view = document.querySelector('.nav-item.active')?.dataset.view || '';

    // General y Viajes reemplazan el contenido de viewRoot con módulos propios.
    // Ignorar sus mutaciones internas evita recargas recursivas y lecturas
    // innecesarias de Sheets mientras esos módulos están cargando/renderizando.
    if (view === 'viajes' && (root.querySelector('.travel-dashboard') || root.querySelector('.travel-loading'))) return;
    if (view === 'general' && (root.querySelector('[data-general-dashboard]') || root.querySelector('.general-loading'))) return;

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
