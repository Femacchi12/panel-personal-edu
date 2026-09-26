(() => {
  'use strict';

  if (window.__PANEL_VIEW_ROOT_EVENTS__) return;
  window.__PANEL_VIEW_ROOT_EVENTS__ = true;

  let sequence = 0;

  function activeView() {
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  function emit(source = 'app') {
    const root = document.getElementById('viewRoot');
    if (!root) return;
    sequence += 1;
    root.dataset.panelRenderSequence = String(sequence);
    document.dispatchEvent(new CustomEvent('panel:view-root-changed', {
      detail: { view: activeView(), root, source, sequence }
    }));
  }

  // app.js es el dueño del render base. Los módulos derivados ya no generan
  // nuevos "cambios de vista" solo por insertar/reordenar contenido.
  window.__PANEL_EMIT_VIEW_ROOT_CHANGED__ = emit;
})();