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

  // Una interacción real habilita una nueva ronda de render. Las mutaciones
  // producidas por esa misma ronda no deben iniciar otra cadena de renders.
  document.addEventListener('click', event => {
    if (event.target.closest?.('.nav-item,.multi-filter-option,[data-clear-filter],.currency-btn,#refreshBtn,#clearFilters,#resetCurrentMonth,#monthlyProjectionToggle,.local-option')) {
      bump();
    }
  }, true);
  document.addEventListener('change', event => {
    if (event.target.closest?.('#monthlyProjectionToggle,select,input')) bump();
  }, true);
  document.addEventListener('panel:payment-filters-changed', bump, true);
  document.addEventListener('panel:monthly-projection-change', bump, true);

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

        // Para cada interacción, cada observer de #viewRoot puede ejecutarse una
        // sola vez. Se concede además una ronda inicial al entrar/cargar Flujo.
        const now = Date.now();
        const currentGeneration = generation;
        const initialGrace = this.lastGeneration < 0 && now - lastInteractionAt < 2500;
        if (!initialGrace && this.lastGeneration === currentGeneration) return;

        // Protección adicional ante ráfagas de MutationObserver del mismo frame.
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
})();
