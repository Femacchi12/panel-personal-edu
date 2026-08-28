(() => {
  'use strict';

  const root = document.getElementById('viewRoot');
  if (!root || window.__PANEL_VIEW_ROOT_EVENTS__) return;
  window.__PANEL_VIEW_ROOT_EVENTS__ = true;

  let frame = 0;
  function emit() {
    frame = 0;
    document.dispatchEvent(new CustomEvent('panel:view-root-changed', {
      detail: {
        view: document.querySelector('.nav-item.active')?.dataset.view || '',
        root
      }
    }));
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(emit);
  }

  new MutationObserver(schedule).observe(root, { childList: true, subtree: false });
  queueMicrotask(schedule);
})();
