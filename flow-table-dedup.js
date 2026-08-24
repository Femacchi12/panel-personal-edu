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

  function removeColumnFromTable(table, wantedHeader) {
    if (!table) return;
    const wanted = norm(wantedHeader);
    const headers = [...table.querySelectorAll('thead th')];
    const index = headers.findIndex(th => norm(th.textContent) === wanted);
    if (index < 0) return;
    headers[index]?.remove();
    table.querySelectorAll('tbody tr').forEach(row => row.cells[index]?.remove());
    table.querySelectorAll('tfoot tr').forEach(row => row.cells[index]?.remove());
  }

  function isTargetView() {
    const active = document.querySelector('.nav-item.active')?.dataset.view || '';
    const title = norm(document.getElementById('viewTitle')?.textContent || '');
    return active === 'gastos' || active === 'flujo' || title === 'gastos diarios' || title === 'flujo mensual';
  }

  function cleanUpperProjectionSuite(root) {
    const suite = root.querySelector('#monthlyProjectionSuite');
    if (!suite) return;
    suite.querySelectorAll('.monthly-programmed-panel, .monthly-comparison-panel').forEach(hide);
  }

  function cleanComparisonColumnEverywhere(root) {
    root.querySelectorAll('table').forEach(table => {
      const headers = [...table.querySelectorAll('thead th')].map(th => norm(th.textContent));
      if (headers.includes('faltante incluido') && headers.includes('comparacion')) {
        removeColumnFromTable(table, 'Faltante incluido');
      }
    });
  }

  function apply() {
    if (applying || !isTargetView()) return;
    applying = true;
    try {
      const root = document.getElementById('viewRoot');
      if (!root) return;
      cleanUpperProjectionSuite(root);
      cleanComparisonColumnEverywhere(root);
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

  const root = document.getElementById('viewRoot');
  if (root) new MutationObserver(() => schedule(110)).observe(root, { childList: true, subtree: true });
  [350, 700, 1200, 2200].forEach(ms => setTimeout(apply, ms));
})();

// Corrección única de porcentajes: siempre usa ingreso mensual regular sin extras/primas.
(() => {
  if (document.querySelector('script[data-regular-income-percentage-fix]')) return;
  const script = document.createElement('script');
  script.src = 'flow-regular-income-percentage-fix.js?v=20260823-2115';
  script.dataset.regularIncomePercentageFix = '1';
  document.head.appendChild(script);
})();