(() => {
  'use strict';

  // The previous version of this file overrode MutationObserver globally for
  // Flujo. That stopped a loop, but it also prevented some later Flow modules
  // from completing their normal render sequence. The real loop source was the
  // payment filter observer on #viewRoot and that observer has already been
  // removed. Native MutationObserver behavior is therefore left untouched here.

  let timer = null;
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function normalizeFlowFilters() {
    if (activeView() !== 'flujo') return;

    const filterBar = document.getElementById('filterBar');
    const category = document.querySelector('#globalFilters .multi-filter[data-filter="category"]');
    const subcategory = document.querySelector('#globalFilters .multi-filter[data-filter="subcategory"]');
    const paymentBar = document.getElementById('paymentMethodFilterBar');

    if (filterBar) filterBar.hidden = false;

    // Exact Flow filter set requested: Año, Mes, Categoría, Cuenta/medio, Modalidad.
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
    // payment-method-filters.js listens to this explicit event. No DOM observer is
    // needed, which keeps the filter bar stable.
    document.dispatchEvent(new CustomEvent('panel:filters-updated', {detail:{view:'flujo'}}));
  }

  function repair(delay = 180) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (activeView() !== 'flujo') return;
      normalizeFlowFilters();
      requestPaymentFilters();
      // The payment options are loaded asynchronously; normalize once more after
      // they have been inserted.
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
