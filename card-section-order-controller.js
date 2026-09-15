(() => {
  'use strict';

  let frame = 0;
  let settleTimer = 0;

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function direct(root, selector) {
    return [...root.children].find(node => node.matches?.(selector)) || null;
  }

  function panelFor(root, selector) {
    const node = root.querySelector(selector);
    const panel = node?.closest('.panel');
    return panel && panel.parentElement === root ? panel : null;
  }

  function removeUsageBar(root, linePanel) {
    // El gráfico de línea se crea originalmente usando el panel de barras como
    // ancla. Esperamos a que exista antes de retirar definitivamente la barra.
    if (!linePanel) return false;
    const panel = panelFor(root, '#cardsChart');
    if (!panel) return false;
    const canvas = panel.querySelector('#cardsChart');
    const chart = canvas && window.Chart ? Chart.getChart(canvas) : null;
    try { chart?.destroy(); } catch (_) {}
    panel.remove();
    return true;
  }

  function applyStableOrder(root, desired) {
    let changed = false;
    let cursor = root.firstElementChild;

    desired.forEach(node => {
      if (!node || node.parentElement !== root) return;
      if (node === cursor) {
        cursor = cursor.nextElementSibling;
        return;
      }
      root.insertBefore(node, cursor);
      changed = true;
    });

    return changed;
  }

  function refreshTrendChart() {
    requestAnimationFrame(() => {
      const canvas = document.getElementById('cardTrendChart');
      const chart = canvas && window.Chart ? Chart.getChart(canvas) : null;
      try { chart?.resize(); chart?.update('none'); } catch (_) {}
    });
  }

  function reorder() {
    if (activeView() !== 'tarjetas') return;
    const root = document.getElementById('viewRoot');
    if (!root) return;

    const sectionHead = direct(root, '.section-head');
    const linePanel = direct(root, '[data-card-line-panel]');
    const financeContext = direct(root, '.finance-context');
    const kpis = direct(root, '.kpi-grid');
    const creditGrid = direct(root, '.credit-grid');
    const expensePanel = direct(root, '#cardExpenseScopePanel');

    const removedBar = removeUsageBar(root, linePanel);

    // Los filtros viven fuera de viewRoot. Dentro de la sección, el orden queda:
    // título -> gráfico de línea -> resumen -> tarjetas -> gastos con tarjeta -> resto.
    const priority = [
      sectionHead,
      linePanel,
      financeContext,
      kpis,
      creditGrid,
      expensePanel
    ].filter(Boolean);

    const prioritySet = new Set(priority);
    const rest = [...root.children].filter(node => !prioritySet.has(node));
    const desired = [...priority, ...rest];
    const changed = applyStableOrder(root, desired);

    root.dataset.cardSectionOrder = 'filters-line-summary-cards-expenses-rest';
    if (changed || removedBar) refreshTrendChart();
  }

  function schedule() {
    if (activeView() !== 'tarjetas') return;
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        reorder();
      });
    }

    // Una única pasada tardía absorbe módulos que terminan de montar después.
    // Se reemplaza en cada evento para evitar temporizadores acumulados.
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (activeView() === 'tarjetas') reorder();
    }, 140);
  }

  document.addEventListener('panel:view-root-changed', event => {
    if (event.detail?.view === 'tarjetas') schedule();
  });
  document.addEventListener('panel:section-modules-ready', event => {
    if (event.detail?.view === 'tarjetas') schedule();
  });
  document.addEventListener('panel:card-trend-rendered', schedule);
  document.addEventListener('panel:card-filter-changed', schedule);
  document.addEventListener('panel:filters-updated', schedule);
  document.addEventListener('panel:expense-scope-changed', event => {
    if (event.detail?.view === 'tarjetas') schedule();
  });
  document.addEventListener('panel:backend-data-loaded', schedule);

  queueMicrotask(schedule);
})();
