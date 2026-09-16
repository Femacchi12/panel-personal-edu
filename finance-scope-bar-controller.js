(() => {
  'use strict';

  const META = Object.freeze({
    gastos: 'Gastos diarios',
    flujo: 'Flujo mensual'
  });
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function ensure(requestedView = activeView()) {
    const view = META[requestedView] ? requestedView : activeView();
    const main = document.querySelector('.main');
    if (!main) return;

    let bar = document.getElementById('sectionFilterBar');
    if (!META[view]) {
      if (bar) bar.hidden = true;
      return;
    }

    if (!bar) {
      bar = document.createElement('section');
      bar.id = 'sectionFilterBar';
      bar.className = 'filter-bar section-filter-bar';
      const global = document.getElementById('filterBar');
      if (global) global.insertAdjacentElement('afterend', bar);
      else main.prepend(bar);
    }

    if (bar.dataset.view !== view || !bar.querySelector('.section-filter-grid')) {
      bar.dataset.view = view;
      bar.innerHTML = `<div class="filter-head"><div><span class="eyebrow">FILTROS DE LA SECCIÓN</span><strong>${META[view]}</strong></div></div><div class="section-filter-grid"></div>`;
    }

    bar.hidden = false;
    document.dispatchEvent(new CustomEvent('panel:finance-scope-bar-ready', { detail: { view } }));
  }

  document.addEventListener('panel:view-root-changed', event => requestAnimationFrame(() => ensure(event.detail?.view || activeView())));
  document.addEventListener('panel:section-modules-ready', event => requestAnimationFrame(() => ensure(event.detail?.view || activeView())));
  document.addEventListener('click', event => {
    const nav = event.target.closest?.('.nav-item[data-view]');
    if (nav) setTimeout(() => ensure(nav.dataset.view || activeView()), 0);
  }, true);
  queueMicrotask(() => requestAnimationFrame(() => ensure()));
})();