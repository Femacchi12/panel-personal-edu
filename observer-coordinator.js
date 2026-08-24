(() => {
  'use strict';

  if (window.__PANEL_OBSERVER_COORDINATOR__) return;
  window.__PANEL_OBSERVER_COORDINATOR__ = true;

  const NativeMutationObserver = window.MutationObserver;
  const rootObservers = new Set();
  let rootNativeObserver = null;
  let rootTarget = null;
  let pendingRecords = [];
  let dispatchTimer = null;
  let suppressUntil = 0;

  function cleanupDuplicateFlowPanels() {
    const root = document.getElementById('viewRoot');
    if (!root) return;

    const advanced = root.querySelector('.flow-matrix-advanced');
    if (advanced) {
      const legacy = root.querySelector('.flow-matrix-table');
      const legacyPanel = legacy?.closest('.panel');
      if (legacyPanel) legacyPanel.remove();
    }

    const financing = root.querySelectorAll('#flowFinancingKpis');
    financing.forEach((node,index)=>{ if(index>0) node.remove(); });
  }

  function dispatchRootObservers() {
    dispatchTimer = null;
    if (!rootObservers.size || !pendingRecords.length) return;
    if (Date.now() < suppressUntil) {
      pendingRecords = [];
      return;
    }

    const records = pendingRecords.splice(0);
    suppressUntil = Date.now() + 650;

    for (const entry of [...rootObservers]) {
      if (!entry.connected) continue;
      try {
        entry.callback(records, entry.instance);
      } catch (error) {
        console.error('Observer coordinado:', error);
      }
    }

    setTimeout(cleanupDuplicateFlowPanels, 180);
  }

  function ensureRootObserver(target) {
    if (rootNativeObserver && rootTarget === target) return;
    rootNativeObserver?.disconnect();
    rootTarget = target;
    rootNativeObserver = new NativeMutationObserver(records => {
      if (Date.now() < suppressUntil) return;
      pendingRecords.push(...records);
      clearTimeout(dispatchTimer);
      dispatchTimer = setTimeout(dispatchRootObservers, 90);
    });
    rootNativeObserver.observe(target,{childList:true,subtree:false});
  }

  class CoordinatedMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.native = null;
      this.rootEntry = null;
    }

    observe(target, options = {}) {
      if (target?.id === 'viewRoot' && options?.childList) {
        if (this.rootEntry) rootObservers.delete(this.rootEntry);
        this.rootEntry = {instance:this,callback:this.callback,connected:true};
        rootObservers.add(this.rootEntry);
        ensureRootObserver(target);
        return;
      }
      if (!this.native) this.native = new NativeMutationObserver(this.callback);
      this.native.observe(target,options);
    }

    disconnect() {
      if (this.rootEntry) {
        this.rootEntry.connected = false;
        rootObservers.delete(this.rootEntry);
        this.rootEntry = null;
      }
      this.native?.disconnect();
    }

    takeRecords() {
      return this.native?.takeRecords() || [];
    }
  }

  window.MutationObserver = CoordinatedMutationObserver;

  document.addEventListener('click',event=>{
    if (event.target.closest('#refreshBtn')) suppressUntil = 0;
  },true);

  const start = () => setTimeout(cleanupDuplicateFlowPanels,800);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
