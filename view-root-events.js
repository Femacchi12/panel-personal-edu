(() => {
  'use strict';

  if (window.__PANEL_VIEW_ROOT_EVENTS__) return;
  window.__PANEL_VIEW_ROOT_EVENTS__ = true;

  let sequence = 0;
  let settleObserver = null;
  let quietTimer = 0;
  let maxTimer = 0;
  let settleToken = 0;

  function activeView() {
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  function clearSettleTimers() {
    if (quietTimer) clearTimeout(quietTimer);
    if (maxTimer) clearTimeout(maxTimer);
    quietTimer = 0;
    maxTimer = 0;
    settleObserver?.disconnect();
    settleObserver = null;
  }

  function reveal(root, token) {
    if (!root || token !== settleToken) return;
    clearSettleTimers();
    root.classList.remove('panel-view-settling');
    root.style.removeProperty('min-height');
    root.dataset.panelSettled = '1';
    document.dispatchEvent(new CustomEvent('panel:view-settled', {
      detail: { view: activeView(), root, sequence: Number(root.dataset.panelRenderSequence || 0) }
    }));
  }

  function settle(root) {
    if (!root || !root.classList.contains('panel-view-settling')) return;
    clearSettleTimers();
    const token = ++settleToken;
    root.dataset.panelSettled = '0';

    const view=activeView();
    const moduleState=window.__PANEL_SECTION_MODULE_STATE__;
    if(moduleState?.hasView?.(view) && !moduleState?.isLoaded?.(view)){
      maxTimer=setTimeout(()=>reveal(root,token),1400);
      return;
    }

    const scheduleQuietReveal = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => reveal(root, token), 120);
    };

    settleObserver = new MutationObserver(mutations => {
      if (token !== settleToken) return;
      if (mutations.some(m => m.type === 'childList')) scheduleQuietReveal();
    });
    settleObserver.observe(root, { childList: true, subtree: true });

    scheduleQuietReveal();
    maxTimer = setTimeout(() => reveal(root, token), 760);
  }

  function emit(source = 'app') {
    const root = document.getElementById('viewRoot');
    if (!root) return;
    sequence += 1;
    root.dataset.panelRenderSequence = String(sequence);
    document.dispatchEvent(new CustomEvent('panel:view-root-changed', {
      detail: { view: activeView(), root, source, sequence }
    }));
    if (root.classList.contains('panel-view-settling')) {
      requestAnimationFrame(() => settle(root));
    }
  }

  document.addEventListener('panel:section-modules-ready',event=>{
    if(event.detail?.view===activeView()){
      const root=document.getElementById('viewRoot');
      if(root?.classList.contains('panel-view-settling')) requestAnimationFrame(()=>settle(root));
    }
  });

  window.__PANEL_EMIT_VIEW_ROOT_CHANGED__ = emit;
  window.__PANEL_SETTLE_VIEW_ROOT__ = settle;
  window.__PANEL_REVEAL_VIEW_ROOT__ = root => reveal(root || document.getElementById('viewRoot'), settleToken);
})();