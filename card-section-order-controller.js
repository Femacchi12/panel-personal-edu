(() => {
  'use strict';

  let frame = 0;
  let timers = [];

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function direct(root, selector) {
    return [...root.children].find(node => node.matches?.(selector)) || null;
  }

  function panelFor(root, selector) {
    const node = root.querySelector(selector);
    const panel = node?.closest('.panel');
    return panel && panel.parentElement === root ? panel : null;
  }

  function reorder() {
    if (activeView() !== 'tarjetas') return;
    const root = document.getElementById('viewRoot');
    if (!root) return;

    const sectionHead = direct(root, '.section-head');
    const financeContext = direct(root, '.finance-context');
    const kpis = direct(root, '.kpi-grid');
    const creditGrid = direct(root, '.credit-grid');
    const linePanel = direct(root, '[data-card-line-panel]');
    const cardsChartPanel = panelFor(root, '#cardsChart');
    const expensePanel = direct(root, '#cardExpenseScopePanel');

    // La visualización "Uso por tarjeta" forma parte del orden solicitado.
    if (cardsChartPanel) cardsChartPanel.hidden = false;

    const priority = [
      sectionHead,
      financeContext,
      kpis,
      creditGrid,
      linePanel,
      cardsChartPanel,
      expensePanel
    ].filter(Boolean);

    const prioritySet = new Set(priority);
    const rest = [...root.children].filter(node => !prioritySet.has(node));
    const desired = [...priority, ...rest];

    desired.forEach(node => root.appendChild(node));

    root.dataset.cardSectionOrder = 'filters-cards-line-usage-expenses-rest';
  }

  function schedule() {
    if (activeView() !== 'tarjetas') return;
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      reorder();
    });

    timers.forEach(clearTimeout);
    timers = [60, 180, 420].map(delay => setTimeout(() => {
      if (activeView() === 'tarjetas') reorder();
    }, delay));
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
