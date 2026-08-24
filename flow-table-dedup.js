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

    // El suite superior conserva Cierre estimado y KPIs, pero no debe repetir
    // las tablas que ya existen al final de Gastos diarios / Flujo mensual.
    suite.querySelectorAll('.monthly-programmed-panel, .monthly-comparison-panel').forEach(hide);
  }

  function cleanComparisonColumnEverywhere(root) {
    // No dependemos de clases ni del origen de la tabla: buscamos el encabezado real.
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

  // Varias capas del dashboard terminan de inyectarse de forma asíncrona.
  // Repetimos la limpieza en ventanas cortas para cubrir el render inicial sin loops permanentes.
  [350, 700, 1200, 2200].forEach(ms => setTimeout(apply, ms));
})();