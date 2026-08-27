(() => {
  'use strict';

  // La evolución y la tabla de Inversiones se renderizan únicamente en
  // investment-period-enhancement.js. Este archivo queda como puente de
  // sincronización para los filtros locales de sección.
  if (!window.__PANEL_INVESTMENT_PERIOD_ENHANCED__) return;

  let timer = null;
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function scheduleSync(delay = 120) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (activeView() !== 'inversiones') return;
      // investment-period-enhancement escucha cambios de moneda para recalcular
      // usando el estado de filtros ya consolidado. Se dispara sobre la moneda
      // activa, por lo que no cambia la selección ni hace fetch global.
      const activeCurrency = document.querySelector('.currency-btn.active');
      if (activeCurrency) activeCurrency.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, delay);
  }

  document.addEventListener('panel:section-filters-changed', event => {
    if (event?.detail?.view === 'inversiones') scheduleSync(140);
  });
})();