(() => {
  'use strict';

  // Flujo has several independent enhancement modules. Each already has explicit
  // navigation/filter/currency/refresh listeners and an initial scheduled render.
  // Their additional MutationObservers on #viewRoot are therefore redundant and
  // can wake one another indefinitely as panels are inserted or rewritten.
  // Keep native MutationObserver everywhere else, but suppress callbacks from
  // observers attached directly to #viewRoot while Flujo is the active view.
  if (!window.__PANEL_FLOW_ROOT_OBSERVER_GUARD__) {
    window.__PANEL_FLOW_ROOT_OBSERVER_GUARD__ = true;
    const NativeMutationObserver = window.MutationObserver;
    if (typeof NativeMutationObserver === 'function') {
      class FlowAwareMutationObserver {
        constructor(callback) {
          this.callback = callback;
          this.native = null;
          this.targetIsViewRoot = false;
        }
        observe(target, options) {
          this.targetIsViewRoot = target?.id === 'viewRoot';
          this.native?.disconnect();
          this.native = new NativeMutationObserver((records) => {
            const active = document.querySelector('.nav-item.active')?.dataset.view || '';
            if (this.targetIsViewRoot && active === 'flujo') return;
            this.callback(records, this);
          });
          this.native.observe(target, options);
        }
        disconnect() { this.native?.disconnect(); }
        takeRecords() { return this.native?.takeRecords() || []; }
      }
      window.MutationObserver = FlowAwareMutationObserver;
    }
  }

  let timer = null;
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function normalizeFlowFilters() {
    if (activeView() !== 'flujo') return;

    const filterBar = document.getElementById('filterBar');
    const category = document.querySelector('#globalFilters .multi-filter[data-filter="category"]');
    const subcategory = document.querySelector('#globalFilters .multi-filter[data-filter="subcategory"]');
    const paymentBar = document.getElementById('paymentMethodFilterBar');

    if (filterBar) filterBar.hidden = false;

    if (category) {
      category.hidden = false;
      category.removeAttribute('hidden');
      category.style.display = '';
    }
    if (subcategory) {
      subcategory.hidden = true;
      subcategory.setAttribute('hidden', '');
      subcategory.style.display = 'none';
    }

    if (paymentBar) {
      paymentBar.hidden = false;
      const combined = paymentBar.querySelector('[data-pay-key="payment"]');
      if (combined) combined.remove();
      const grid = paymentBar.querySelector('.section-filter-grid');
      if (grid) grid.style.gridTemplateColumns = 'repeat(2,minmax(0,1fr))';
    }
  }

  function requestPaymentFilters() {
    if (activeView() !== 'flujo') return;
    document.dispatchEvent(new CustomEvent('panel:filters-updated', {detail:{view:'flujo'}}));
  }

  function repair(delay = 180) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (activeView() !== 'flujo') return;
      normalizeFlowFilters();
      requestPaymentFilters();
      setTimeout(normalizeFlowFilters, 320);
    }, delay);
  }

  document.addEventListener('click', event => {
    if (event.target.closest('.nav-item')) repair(220);
    if (event.target.closest('.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters')) repair(180);
  }, true);

  document.addEventListener('panel:payment-filters-changed', () => {
    if (activeView() === 'flujo') setTimeout(normalizeFlowFilters, 40);
  });

  document.addEventListener('panel:filters-updated', () => {
    if (activeView() === 'flujo') setTimeout(normalizeFlowFilters, 80);
  });

  const start = () => repair(900);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
