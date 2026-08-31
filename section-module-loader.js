(() => {
  'use strict';

  const ASSET_VERSION = String(document.lastModified || 'panel').replace(/\D/g, '') || 'panel';
  const scripts = new Map();
  const loadedViews = new Set();
  const loadingViews = new Map();

  const GROUPS = Object.freeze({
    gastos: [
      ['payment-method-filters.js'],
      ['expense-table-advanced.js','monthly-projection-control.js','movement-type-columns.js','spend-chart-controller.js','finance-context-controller.js']
    ],
    flujo: [
      ['payment-method-filters.js','flow-matrix-v3.js'],
      ['monthly-projection-control.js','flow-income-controller.js','finance-context-controller.js']
    ],
    tarjetas: [
      ['card-specific-filter.js'],
      ['card-payment-control.js','card-chart-personal-limit.js','card-payments-installments.js','finance-context-controller.js']
    ],
    deudas: [
      ['finance-secondary-context-controller.js']
    ],
    inversiones: [
      ['investment-freshness-controller.js']
    ],
    pension: [
      ['finance-secondary-context-controller.js']
    ],
    ingresos: [
      ['income-doc-enhancements.js','income-regular-controller.js','income-type-filter.js','income-savings-context-controller.js']
    ],
    servicios: [
      ['services-table-enhancement.js','finance-secondary-context-controller.js']
    ],
    cambio: [
      ['exchange-simulator.js'],
      ['fx-sensitivity-controller.js']
    ],
    documentos: [
      ['documents-master-controller.js']
    ]
  });

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || 'general';

  function loadOne(src) {
    if (scripts.has(src)) return scripts.get(src);
    const existing = [...document.scripts].find(script => script.dataset?.panelSectionModule === src);
    if (existing?.dataset.loaded === '1') return Promise.resolve();

    const promise = new Promise((resolve, reject) => {
      const script = existing || document.createElement('script');
      if (!existing) {
        script.src = `${src}?v=${encodeURIComponent(ASSET_VERSION)}`;
        script.async = false;
        script.dataset.panelSectionModule = src;
        document.body.appendChild(script);
      }
      const done = () => { script.dataset.loaded = '1'; resolve(); };
      const fail = () => reject(new Error(`No se pudo cargar ${src}`));
      if (script.dataset.loaded === '1') done();
      else {
        script.addEventListener('load', done, { once: true });
        script.addEventListener('error', fail, { once: true });
      }
    }).catch(error => {
      scripts.delete(src);
      throw error;
    });

    scripts.set(src, promise);
    return promise;
  }

  async function loadView(view) {
    const stages = GROUPS[view];
    if (!stages || loadedViews.has(view)) return false;
    if (loadingViews.has(view)) return loadingViews.get(view);

    const task = (async () => {
      for (const stage of stages) await Promise.all(stage.map(loadOne));
      loadedViews.add(view);
      if (activeView() === view) {
        const root = document.getElementById('viewRoot');
        document.dispatchEvent(new CustomEvent('panel:section-modules-ready', { detail: { view, root } }));
        document.dispatchEvent(new CustomEvent('panel:view-root-changed', { detail: { view, root, source: 'section-module-loader' } }));
      }
      return true;
    })();

    loadingViews.set(view, task);
    try { return await task; }
    catch (error) {
      console.error(`Módulos de sección ${view}:`, error);
      throw error;
    } finally {
      loadingViews.delete(view);
    }
  }

  function schedule(view) {
    if (!GROUPS[view] || loadedViews.has(view)) return;
    loadView(view).catch(() => {});
  }

  document.addEventListener('click', event => {
    const nav = event.target.closest?.('.nav-item[data-view]');
    if (nav) schedule(nav.dataset.view || '');
  }, true);

  document.addEventListener('panel:view-root-changed', event => schedule(event.detail?.view || activeView()));
  document.addEventListener('panel:modules-ready', () => schedule(activeView()));
  queueMicrotask(() => schedule(activeView()));

  window.__PANEL_LOAD_SECTION_MODULES__ = loadView;
  window.__PANEL_SECTION_MODULE_STATE__ = Object.freeze({
    isLoaded: view => loadedViews.has(view),
    loadedViews
  });
})();