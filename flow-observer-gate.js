(() => {
  'use strict';

  if (window.__PANEL_FLOW_OBSERVER_GATE__) return;
  window.__PANEL_FLOW_OBSERVER_GATE__ = true;

  const BaseObserver = window.MutationObserver;
  if (typeof BaseObserver !== 'function') return;

  let generation = 0;
  let lastInteractionAt = Date.now();

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const bump = () => {
    generation += 1;
    lastInteractionAt = Date.now();
  };

  function ensureFlowFiltersVisible() {
    if (activeView() !== 'flujo') return;
    const filterBar = document.getElementById('filterBar');
    const category = document.querySelector('#globalFilters .multi-filter[data-filter="category"]');
    const subcategory = document.querySelector('#globalFilters .multi-filter[data-filter="subcategory"]');
    if (filterBar) filterBar.hidden = false;
    if (category) category.hidden = false;
    if (subcategory) subcategory.hidden = true;
  }

  function ensurePaymentFilterModule() {
    if (document.querySelector('script[data-payment-method-filters]')) return;
    const script = document.createElement('script');
    script.src = 'payment-method-filters.js?v=20260824-2235';
    script.dataset.paymentMethodFilters = '1';
    document.head.appendChild(script);
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('.nav-item,.multi-filter-option,[data-clear-filter],.currency-btn,#refreshBtn,#clearFilters,#resetCurrentMonth,#monthlyProjectionToggle,.local-option')) {
      bump();
    }
    if (event.target.closest?.('.nav-item')) {
      setTimeout(ensureFlowFiltersVisible, 80);
      setTimeout(ensureFlowFiltersVisible, 260);
    }
  }, true);
  document.addEventListener('change', event => {
    if (event.target.closest?.('#monthlyProjectionToggle,select,input')) bump();
  }, true);
  document.addEventListener('panel:payment-filters-changed', bump, true);
  document.addEventListener('panel:monthly-projection-change', bump, true);
  document.addEventListener('panel:filters-updated', () => setTimeout(ensureFlowFiltersVisible, 50), true);

  class FlowStableMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observer = null;
      this.isRootObserver = false;
      this.lastGeneration = -1;
      this.lastRunAt = 0;
    }

    observe(target, options = {}) {
      this.isRootObserver = target?.id === 'viewRoot' && Boolean(options?.childList);
      const wrapped = (records, nativeObserver) => {
        if (!this.isRootObserver || activeView() !== 'flujo') {
          this.callback(records, this);
          return;
        }

        const now = Date.now();
        const currentGeneration = generation;
        const initialGrace = this.lastGeneration < 0 && now - lastInteractionAt < 2500;
        if (!initialGrace && this.lastGeneration === currentGeneration) return;
        if (now - this.lastRunAt < 80) return;
        this.lastGeneration = currentGeneration;
        this.lastRunAt = now;
        this.callback(records, this);
      };

      this.observer?.disconnect();
      this.observer = new BaseObserver(wrapped);
      this.observer.observe(target, options);
    }

    disconnect() { this.observer?.disconnect(); }
    takeRecords() { return this.observer?.takeRecords() || []; }
  }

  window.MutationObserver = FlowStableMutationObserver;

  const start = () => {
    ensurePaymentFilterModule();
    setTimeout(ensureFlowFiltersVisible, 700);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
