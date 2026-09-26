(() => {
  'use strict';

  const ASSET_VERSION = String(document.lastModified || 'panel').replace(/\D/g, '') || 'panel';
  const scripts = new Map();
  const loadedViews = new Set();
  const loadingViews = new Map();
  const HOVER_PREFETCH_DELAY_MS = 140;
  let hoverTimer = 0;
  let hoverView = '';

  const GROUPS = Object.freeze({
    general: [
      ['general-dashboard-controller.js']
    ],
    gastos: [
      ['finance-scope-core.js'],
      ['finance-scope-bar-controller.js','finance-scope-card-controller.js','payment-method-filters.js'],
      ['expense-table-advanced.js','monthly-projection-control.js','movement-type-columns.js','spend-chart-controller.js'],
      ['finance-scope-context-controller.js'],
      ['expense-table-polish.js'],
      ['expense-current-month-close-controller.js'],
      ['expense-interactions-controller.js'],
      ['finance-section-order-controller.js']
    ],
    flujo: [
      ['finance-scope-core.js'],
      ['finance-scope-bar-controller.js','payment-method-filters.js','flow-matrix-v3.js'],
      ['flow-matrix-polish.js'],
      ['flow-scope-controller.js'],
      ['flow-section-controller-v3.js'],
      ['finance-section-order-controller.js']
    ],
    tarjetas: [
      ['finance-scope-core.js'],
      ['dashboard-enhancements.js','finance-scope-bar-controller.js'],
      ['card-specific-filter.js','finance-scope-card-controller.js'],
      ['card-payment-control.js','card-chart-personal-limit.js','card-payments-installments.js'],
      ['card-section-order-controller.js'],
      ['card-detail-accordion-controller.js']
    ],
    deudas: [
      ['finance-secondary-context-controller.js']
    ],
    patrimonio: [
      ['patrimonio-dashboard-v2.js'],
      ['patrimonio-native-currency.js']
    ],
    inversiones: [
      ['investment-dashboard-v2.js']
    ],
    pension: [
      ['pension-dashboard-controller.js']
    ],
    ingresos: [
      ['income-savings-dashboard.js']
    ],
    servicios: [
      ['services-table-enhancement.js','finance-secondary-context-controller.js','account-statement-status-controller.js']
    ],
    cambio: [
      ['exchange-simulator.js'],
      ['fx-sensitivity-controller.js']
    ],
    salud: [
      ['health-dashboard-controller.js']
    ],
    citas: [
      ['health-dashboard-controller.js']
    ],
    tratamientos: [
      ['health-dashboard-controller.js']
    ],
    documentos: [
      ['documents-master-controller.js']
    ],
    viajes: [
      ['travel-expense-controller.js']
    ]
  });

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || 'general';

  function loadOne(src) {
    if (scripts.has(src)) return scripts.get(src);
    const existing = [...document.scripts].find(script => script.dataset?.panelSectionModule === src);
    if (existing?.dataset.loaded === '1') return Promise.resolve();

    const promise = new Promise((resolve, reject) => {
      const script = existing || document.createElement('script');
      const done = () => {
        script.dataset.loaded = '1';
        resolve();
      };
      const fail = () => reject(new Error(`No se pudo cargar ${src}`));

      if (script.dataset.loaded === '1') {
        done();
        return;
      }

      script.addEventListener('load', done, { once: true });
      script.addEventListener('error', fail, { once: true });

      if (!existing) {
        script.src = `${src}?v=${encodeURIComponent(ASSET_VERSION)}`;
        script.async = false;
        script.dataset.panelSectionModule = src;
        document.body.appendChild(script);
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
        requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>{
          if(activeView()===view&&root){
            root.classList.remove('panel-view-settling');
            root.style.removeProperty('min-height');
          }
        },50)));
      }
      return true;
    })();

    loadingViews.set(view, task);
    try { return await task; }
    catch (error) {
      console.error(`Módulos de sección ${view}:`, error);
      if(activeView()===view){
        const root=document.getElementById('viewRoot');
        root?.classList.remove('panel-view-settling');
        root?.style.removeProperty('min-height');
      }
      throw error;
    } finally {
      loadingViews.delete(view);
    }
  }

  function schedule(view) {
    if (!GROUPS[view] || loadedViews.has(view)) return;
    loadView(view).catch(() => {});
  }

  function cancelHoverPrefetch(view = '') {
    if (view && hoverView && view !== hoverView) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = 0;
    hoverView = '';
  }

  function scheduleHoverPrefetch(view) {
    if (!GROUPS[view] || loadedViews.has(view) || loadingViews.has(view)) return;
    cancelHoverPrefetch();
    hoverView = view;
    hoverTimer = setTimeout(() => {
      const target = hoverView;
      hoverTimer = 0;
      hoverView = '';
      if (target) schedule(target);
    }, HOVER_PREFETCH_DELAY_MS);
  }

  function navView(event) {
    return event.target.closest?.('.nav-item[data-view]')?.dataset.view || '';
  }

  document.addEventListener('pointerover', event => {
    const view = navView(event);
    if (view) scheduleHoverPrefetch(view);
  }, { passive: true });

  document.addEventListener('pointerout', event => {
    const item = event.target.closest?.('.nav-item[data-view]');
    if (!item) return;
    const next = event.relatedTarget;
    if (next && item.contains(next)) return;
    cancelHoverPrefetch(item.dataset.view || '');
  }, { passive: true });

  document.addEventListener('focusin', event => {
    const view = navView(event);
    if (view) {
      cancelHoverPrefetch();
      schedule(view);
    }
  });

  document.addEventListener('click', event => {
    const view = navView(event);
    if (view) {
      cancelHoverPrefetch();
      schedule(view);
    }
  }, true);

  document.addEventListener('panel:view-root-changed', event => {
    if(window.__PANEL_APP_DATA_READY__) schedule(event.detail?.view || activeView());
  });
  document.addEventListener('panel:app-data-ready', () => schedule(activeView()));
  document.addEventListener('panel:modules-ready', () => {
    if(window.__PANEL_APP_DATA_READY__) schedule(activeView());
  });
  queueMicrotask(() => { if(window.__PANEL_APP_DATA_READY__) schedule(activeView()); });

  window.__PANEL_LOAD_SECTION_MODULES__ = loadView;
  window.__PANEL_SECTION_MODULE_STATE__ = Object.freeze({
    isLoaded: view => loadedViews.has(view),
    hasView: view => Object.prototype.hasOwnProperty.call(GROUPS,view),
    loadedViews
  });
})();