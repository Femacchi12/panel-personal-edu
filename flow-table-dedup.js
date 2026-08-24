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

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function panelTitle(panel) {
    return norm(
      panel?.querySelector?.('.panel-title strong')?.textContent ||
      panel?.querySelector?.('.panel-title')?.textContent ||
      panel?.querySelector?.('strong')?.textContent || ''
    );
  }

  function hide(el) {
    if (!el) return;
    el.hidden = true;
    el.style.display = 'none';
  }

  function show(el) {
    if (!el) return;
    el.hidden = false;
    el.style.removeProperty('display');
  }

  function matchingPanels(root, wantedTitle) {
    const wanted = norm(wantedTitle);
    return [...root.querySelectorAll('.panel')].filter(panel => panelTitle(panel) === wanted);
  }

  function keepOnlyLast(root, title) {
    const panels = matchingPanels(root, title);
    if (!panels.length) return;
    panels.forEach((panel, index) => {
      if (index === panels.length - 1) show(panel);
      else hide(panel);
    });
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

  function cleanComparisonColumns(root) {
    matchingPanels(root, 'Comparación mensual de gasto recurrente y variable').forEach(panel => {
      removeColumnFromTable(panel.querySelector('table'), 'Faltante incluido');
    });
  }

  function apply() {
    if (applying) return;
    const view = activeView();
    if (view !== 'gastos' && view !== 'flujo') return;

    applying = true;
    try {
      const root = document.getElementById('viewRoot');
      if (!root) return;

      // Ambas tablas pueden ser inyectadas más de una vez por capas distintas del dashboard.
      // Conservamos únicamente la última aparición de cada una, que es la versión final de la sección.
      keepOnlyLast(root, 'Comparación mensual de gasto recurrente y variable');
      keepOnlyLast(root, 'Gastos programados del mes');

      // "Faltante incluido" repite la información ya expresada por "Comparación".
      cleanComparisonColumns(root);
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
      schedule(140);
    }
  }, true);

  const root = document.getElementById('viewRoot');
  if (root) {
    new MutationObserver(() => schedule(90)).observe(root, { childList: true, subtree: true });
  }

  schedule(450);
})();
