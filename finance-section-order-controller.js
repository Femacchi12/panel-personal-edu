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

  function primaryFlowKpis(root) {
    return [...root.children].find(node => {
      if (!node.matches?.('.kpi-grid') || node.id === 'flowFinancingKpis') return false;
      const labels = [...node.querySelectorAll('.kpi-label')].map(x => norm(x.textContent));
      return labels.includes('egresos') && labels.includes('ahorro') && labels.some(x => x.includes('ingresos'));
    }) || null;
  }

  function ensureDetachedHost(root, id) {
    let host = direct(root, `#${id}`);
    if (!host) {
      host = document.createElement('section');
      host.id = id;
      host.className = 'monthly-detached-host';
      root.appendChild(host);
    }
    return host;
  }

  function detachMonthlyPanels(root) {
    const programmedHost = ensureDetachedHost(root, 'monthlyProgrammedHost');
    const comparisonHost = ensureDetachedHost(root, 'monthlyComparisonHost');
    const programmed = root.querySelector('.monthly-programmed-panel');
    const comparison = root.querySelector('.monthly-comparison-panel');

    if (programmed && programmed.parentElement !== programmedHost) programmedHost.replaceChildren(programmed);
    if (comparison && comparison.parentElement !== comparisonHost) comparisonHost.replaceChildren(comparison);

    return { programmedHost, comparisonHost };
  }

  function applyPriorityOrder(root, priorityNodes) {
    const priority = [];
    const seen = new Set();
    priorityNodes.forEach(node => {
      if (!node || node.parentElement !== root || seen.has(node)) return;
      seen.add(node);
      priority.push(node);
    });

    const current = [...root.children];
    const rest = current.filter(node => !seen.has(node));
    const desired = [...priority, ...rest];
    if (desired.length !== current.length || desired.every((node, index) => node === current[index])) return;

    desired.forEach(node => root.appendChild(node));
  }

  function baseMovementsPanel(root) {
    return [...root.children].find(node => {
      if (!node.matches?.('.panel') || node.id === 'expenseAdvancedPanel') return false;
      return norm(node.querySelector('.panel-title strong')?.textContent) === 'movimientos';
    }) || null;
  }

  function stabilizeGastos(root) {
    const { programmedHost, comparisonHost } = detachMonthlyPanels(root);
    const head = direct(root, '.section-head');
    const monthly = direct(root, '#monthlyProjectionSuite');
    const context = direct(root, '.finance-context');
    const evolution = document.getElementById('spendChart')?.closest('.panel') || null;
    const baseMovements = baseMovementsPanel(root);
    const advanced = direct(root, '#expenseAdvancedPanel');

    if (baseMovements) {
      baseMovements.hidden = true;
      baseMovements.style.display = 'none';
    }
    if (advanced) {
      advanced.hidden = false;
      if (advanced.style.display === 'none') advanced.style.removeProperty('display');
    }

    applyPriorityOrder(root, [
      head,
      monthly,
      context,
      evolution,
      baseMovements,
      advanced,
      programmedHost,
      comparisonHost
    ]);
  }

  function stabilizeFlujo(root) {
    const { programmedHost, comparisonHost } = detachMonthlyPanels(root);
    const head = direct(root, '.section-head');
    const monthly = direct(root, '#monthlyProjectionSuite');
    const context = direct(root, '.finance-context');
    const primary = primaryFlowKpis(root);
    const scope = direct(root, '#flowScopeSummary');
    const financing = direct(root, '#flowFinancingKpis');
    const evolution = document.getElementById('flowChart')?.closest('.panel') || null;
    const matrix = direct(root, '#flowMatrixV3');
    const savings = titledPanel(root, 'Flujo y ahorro mensual');

    // Flujo mensual → Cierre estimado → Lectura del flujo → tarjetas de la lectura
    // (Ingresos/Egresos/Ahorro/Tasa → Personal/FIBRAZO/Total → Crédito)
    // → Evolución → Matriz → Flujo y ahorro → Proyecciones → Comparación.
    applyPriorityOrder(root, [
      head,
      monthly,
      context,
      primary,
      scope,
      financing,
      evolution,
      matrix,
      savings,
      programmedHost,
      comparisonHost
    ]);
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
    observer.observe(root, { childList: true, subtree: true });
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      stabilize();
    });
  }

  [
    'panel:view-root-changed',
    'panel:section-modules-ready',
    'panel:filters-updated',
    'panel:payment-filters-changed',
    'panel:expense-scope-changed',
    'panel:backend-data-loaded',
    'panel:monthly-projection-change',
    'panel:flow-income-controller-applied'
  ].forEach(name => document.addEventListener(name, schedule));

  queueMicrotask(schedule);
})();