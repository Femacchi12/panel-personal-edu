(() => {
  'use strict';

  let timer = null;
  let applying = false;

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  function hide(el) {
    if (!el) return;
    el.hidden = true;
    el.style.display = 'none';
  }

  function isTargetView() {
    const active = document.querySelector('.nav-item.active')?.dataset.view || '';
    const title = norm(document.getElementById('viewTitle')?.textContent || '');
    return active === 'gastos' || active === 'flujo' || title === 'gastos diarios' || title === 'flujo mensual';
  }

  function injectStableComparisonStyles() {
    if (document.getElementById('flowComparisonStableStyles')) return;
    const style = document.createElement('style');
    style.id = 'flowComparisonStableStyles';
    style.textContent = `
      /* “Faltante incluido” fue eliminado del diseño. Se oculta por CSS para que
         los re-renders de monthly-projection-control no puedan hacerlo reaparecer. */
      .monthly-comparison-panel .monthly-planning-table th:nth-child(5),
      .monthly-comparison-panel .monthly-planning-table td:nth-child(5) {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function cleanUpperProjectionSuite(root) {
    const suite = root.querySelector('#monthlyProjectionSuite');
    if (!suite) return;
    suite.querySelectorAll('.monthly-programmed-panel, .monthly-comparison-panel').forEach(hide);
  }

  function apply() {
    if (applying || !isTargetView()) return;
    applying = true;
    try {
      injectStableComparisonStyles();
      const root = document.getElementById('viewRoot');
      if (!root) return;
      cleanUpperProjectionSuite(root);
    } finally {
      applying = false;
    }
  }

  function schedule(delay = 80) {
    clearTimeout(timer);
    timer = setTimeout(apply, delay);
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('.nav-item,.multi-filter-option,.local-option,.currency-btn,#refreshBtn,#clearFilters,#resetCurrentMonth')) {
      schedule(180);
    }
  }, true);

  injectStableComparisonStyles();
  const root = document.getElementById('viewRoot');
  if (root) new MutationObserver(() => schedule(110)).observe(root, { childList: true, subtree:false });
  [350, 700, 1200, 2200].forEach(ms => setTimeout(apply, ms));
})();
