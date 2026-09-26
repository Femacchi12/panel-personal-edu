(() => {
  'use strict';

  let frame = 0;
  let observer = null;
  let observedHost = null;
  let smallExpanded = false;

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const COLLAPSED_ROWS = 10;
  const EXPANDED_ROWS = 20;

  function injectStyles() {
    if (document.getElementById('expenseTablePolishStyles')) return;
    const style = document.createElement('style');
    style.id = 'expenseTablePolishStyles';
    style.textContent = `
      #expenseAdvancedPanel .expense-advanced-scroll-polished{
        overflow-x:auto!important;
        scrollbar-gutter:auto;
      }
      #expenseAdvancedPanel.expense-polish-collapsed .expense-advanced-scroll-polished{
        max-height:none!important;
        overflow-y:hidden!important;
      }
      #expenseAdvancedPanel.expense-polish-collapsed:not(.expense-polish-small-expanded) .expense-advanced-table tbody tr:nth-child(n+11){
        display:none!important;
      }
      #expenseAdvancedPanel.expense-polish-expanded .expense-advanced-scroll-polished{
        max-height:820px!important;
        overflow-y:auto!important;
        scrollbar-gutter:stable;
      }
      #expenseAdvancedPanel .expense-advanced-footer{
        display:flex;
        justify-content:center;
        align-items:center;
        padding:13px 12px 2px;
      }
      #expenseAdvancedPanel .expense-advanced-more{
        display:inline-flex!important;
        align-items:center;
        justify-content:center;
        gap:7px;
        min-width:210px;
        margin:0!important;
        border:1px solid #2b5f9e!important;
        background:linear-gradient(180deg,#17345f,#102744)!important;
        color:#e9f3ff!important;
        border-radius:999px!important;
        padding:9px 16px!important;
        font-size:10px!important;
        font-weight:800!important;
        cursor:pointer;
        box-shadow:0 6px 18px rgba(23,105,255,.12);
        transition:transform .15s ease,border-color .15s ease,background .15s ease;
      }
      #expenseAdvancedPanel .expense-advanced-more:hover,
      #expenseAdvancedPanel .expense-advanced-more:focus-visible{
        transform:translateY(-1px);
        border-color:#4f8fe0!important;
        background:linear-gradient(180deg,#1d4278,#15315a)!important;
        outline:none;
      }
      #expenseAdvancedPanel .expense-advanced-more .rows-hidden{
        color:#9fc7ff;
        font-weight:700;
      }
      #expenseAdvancedPanel .expense-advanced-table th[data-expense-sort]{
        cursor:pointer;
        user-select:none;
      }
      @media(max-width:560px){
        #expenseAdvancedPanel .expense-advanced-more{width:100%;min-width:0}
      }
    `;
    document.head.appendChild(style);
  }

  function filteredTotal(host, rowCount, expanded, button) {
    const subtitle = host.querySelector('.panel-title span')?.textContent || '';
    const titleMatch = subtitle.match(/^\s*(\d+)\s+de\s+\d+/i);
    if (titleMatch) return Number(titleMatch[1]) || rowCount;
    if (!expanded && button) {
      const moreMatch = button.textContent.match(/\((\d+)\)/);
      if (moreMatch) return rowCount + (Number(moreMatch[1]) || 0);
    }
    return rowCount;
  }

  function ensureFooter(host, button) {
    let footer = host.querySelector(':scope > .expense-advanced-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'expense-advanced-footer';
      host.appendChild(footer);
    }
    if (button && button.parentElement !== footer) footer.appendChild(button);
    return footer;
  }

  function sync() {
    if (activeView() !== 'gastos') return;
    injectStyles();
    const host = document.getElementById('expenseAdvancedPanel');
    if (!host) return;

    const scroll = host.querySelector(':scope > .table-scroll');
    const tbody = host.querySelector('.expense-advanced-table tbody');
    if (!scroll || !tbody) return;
    scroll.classList.add('expense-advanced-scroll-polished');

    let button = host.querySelector('#expenseAdvancedMore');
    const originalExpanded = scroll.classList.contains('expanded');
    const rowCount = tbody.querySelectorAll(':scope > tr').length;
    const total = filteredTotal(host, rowCount, originalExpanded, button);
    const hiddenCount = Math.max(0, total - COLLAPSED_ROWS);
    const effectiveExpanded = originalExpanded || smallExpanded;

    host.classList.toggle('expense-polish-expanded', effectiveExpanded);
    host.classList.toggle('expense-polish-collapsed', !effectiveExpanded);
    host.classList.toggle('expense-polish-small-expanded', smallExpanded && !originalExpanded);

    if (total <= COLLAPSED_ROWS) {
      host.querySelector(':scope > .expense-advanced-footer')?.remove();
      return;
    }

    if (!button && total <= 15) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = 'expenseAdvancedMorePolish';
      button.addEventListener('click', () => {
        smallExpanded = !smallExpanded;
        schedule();
      });
    }
    if (!button) return;

    button.classList.add('expense-advanced-more');
    const footer = ensureFooter(host, button);
    const desired = effectiveExpanded
      ? `Ver menos <span class="rows-hidden">· ocultar ${hiddenCount} fila${hiddenCount === 1 ? '' : 's'}</span> ⌃`
      : `Ver ${hiddenCount} fila${hiddenCount === 1 ? '' : 's'} más <span class="rows-hidden">(${total} total)</span> ⌄`;
    if (button.innerHTML !== desired) button.innerHTML = desired;
    button.setAttribute('aria-expanded', effectiveExpanded ? 'true' : 'false');
    footer.hidden = false;
  }

  function schedule() {
    if (activeView() !== 'gastos') return;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  }

  document.addEventListener('panel:view-root-changed', event => {
    if (event.detail?.view === 'gastos') { smallExpanded = false; schedule(); }
  });
  document.addEventListener('panel:section-modules-ready', event => {
    if (event.detail?.view === 'gastos') schedule();
  });
  document.addEventListener('panel:expense-table-rendered', () => {
    if (activeView() === 'gastos') schedule();
  });
  document.addEventListener('panel:filters-updated', () => { smallExpanded = false; schedule(); });
  document.addEventListener('panel:payment-filters-changed', event => {
    if (event.detail?.view === 'gastos') { smallExpanded = false; schedule(); }
  });
  document.addEventListener('panel:expense-scope-changed', event => {
    if (event.detail?.view === 'gastos') { smallExpanded = false; schedule(); }
  });

  injectStyles();
  queueMicrotask(schedule);
})();