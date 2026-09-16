(() => {
  'use strict';

  let frame = 0;
  let observer = null;
  let observedRoot = null;

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function direct(root, selector) {
    return [...root.children].find(node => node.matches?.(selector)) || null;
  }

  function titledPanel(root, title, excludeId = '') {
    return [...root.children].find(node => {
      if (!node.matches?.('.panel')) return false;
      if (excludeId && node.id === excludeId) return false;
      return norm(node.querySelector('.panel-title strong')?.textContent) === norm(title);
    }) || null;
  }

  function moveAfter(anchor, node) {
    if (!anchor || !node || anchor === node || anchor.parentElement !== node.parentElement) return anchor;
    if (node.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', node);
    return node;
  }

  function orderNodes(root, nodes) {
    let anchor = null;
    nodes.filter(Boolean).forEach(node => {
      if (!anchor) {
        anchor = node;
        return;
      }
      anchor = moveAfter(anchor, node);
    });
  }

  function primaryFlowKpis(root) {
    return [...root.children].find(node => {
      if (!node.matches?.('.kpi-grid') || node.id === 'flowFinancingKpis') return false;
      const labels = [...node.querySelectorAll('.kpi-label')].map(x => norm(x.textContent));
      return labels.includes('egresos') && labels.includes('ahorro') && labels.some(x => x.includes('ingresos'));
    }) || null;
  }

  function stabilizeGastos(root) {
    const head = direct(root, '.section-head');
    const monthly = direct(root, '#monthlyProjectionSuite');
    const context = direct(root, '.finance-context');
    const chart = document.getElementById('spendChart')?.closest('.panel') || null;
    const advanced = direct(root, '#expenseAdvancedPanel');

    // La tabla avanzada de movimientos siempre debe estar visible. El panel base oculto
    // de app.js es solo un ancla y no debe trasladar su estado visual al panel avanzado.
    if (advanced) {
      advanced.hidden = false;
      if (advanced.style.display === 'none') advanced.style.removeProperty('display');
    }

    // Solo fijamos los bloques superiores. Movimientos y sus paneles auxiliares conservan
    // exactamente la posición nativa que les asigna expense-table-advanced.js.
    orderNodes(root, [head, monthly, context, chart]);
  }

  function stabilizeFlujo(root) {
    const head = direct(root, '.section-head');
    const monthly = direct(root, '#monthlyProjectionSuite');
    const context = direct(root, '.finance-context');
    const primary = primaryFlowKpis(root);
    const scope = direct(root, '#flowScopeSummary');
    const financing = direct(root, '#flowFinancingKpis');
    const evolution = document.getElementById('flowChart')?.closest('.panel') || null;
    const matrix = direct(root, '#flowMatrixV3');
    const detail = direct(root, '#flowMatrixDetailV3');
    const savings = titledPanel(root, 'Flujo y ahorro mensual');
    const programmed = direct(root, '#monthlyProgrammedHost');
    const comparison = direct(root, '#monthlyComparisonHost');

    orderNodes(root, [head, monthly, context, primary, scope, financing, evolution, matrix, detail, savings, programmed, comparison]);
  }

  function stabilize() {
    const view = activeView();
    if (view !== 'gastos' && view !== 'flujo') return;
    const root = document.getElementById('viewRoot');
    if (!root) return;
    if (view === 'gastos') stabilizeGastos(root);
    else stabilizeFlujo(root);
    observe(root);
  }

  function observe(root) {
    if (root === observedRoot) return;
    observer?.disconnect();
    observedRoot = root;
    observer = new MutationObserver(() => schedule());
    observer.observe(root, { childList: true });
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      stabilize();
    });
  }

  ['panel:view-root-changed','panel:section-modules-ready','panel:filters-updated','panel:payment-filters-changed','panel:expense-scope-changed','panel:backend-data-loaded','panel:monthly-projection-change','panel:flow-income-controller-applied'].forEach(name => document.addEventListener(name, schedule));
  queueMicrotask(schedule);
})();