(() => {
  'use strict';

  let frame = 0;
  let settleTimer = 0;
  const expandedCards = new Set();

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function cardNodeId(node) {
    const stored = String(node?.dataset?.cardId || '').trim();
    if (stored) return stored;
    const brand = norm(node?.querySelector('.credit-brand')?.textContent);
    const owner = norm(node?.querySelector('.credit-owner')?.textContent);
    if (brand.includes('arq')) return 'TC-ARQ-EDU';
    if (brand.includes('nu') && owner.includes('rocio')) return 'TC-NU-RO';
    if (brand.includes('nu')) return 'TC-NU-EDU';
    return '';
  }

  function selectedCardId() {
    return String(window.__PANEL_ACTIVE_CARD_ID__ || '').trim();
  }

  function applyCardVisibility(selectedId = selectedCardId()) {
    if (activeView() !== 'tarjetas') return;
    const grid = document.querySelector('#viewRoot .credit-grid');
    if (!grid) return;
    const nodes = [...grid.querySelectorAll(':scope > .credit-card')];
    nodes.forEach(node => {
      const id = cardNodeId(node);
      if (id) node.dataset.cardId = id;
      node.hidden = Boolean(selectedId && id && id !== selectedId);
    });
    grid.classList.toggle('card-filter-active', Boolean(selectedId));
  }

  function setAccordionState(node, id) {
    const open = Boolean(id && expandedCards.has(id));
    node.classList.add('card-details-accordion');
    node.classList.toggle('card-details-collapsed', !open);
    node.classList.toggle('card-details-expanded', open);

    const button = node.querySelector('.credit-card-details-toggle');
    if (!button) return;
    button.textContent = open ? '⌃' : '⌄';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.setAttribute('aria-label', open ? 'Contraer detalle de la tarjeta' : 'Desplegar detalle de la tarjeta');
    button.title = open ? 'Contraer detalle' : 'Ver más detalle';
  }

  function wireCardAccordion(node) {
    const id = cardNodeId(node);
    if (id) node.dataset.cardId = id;
    const top = node.querySelector('.credit-top');
    if (!top) return;

    let button = top.querySelector('.credit-card-details-toggle');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'credit-card-details-toggle';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const currentId = cardNodeId(node);
        if (!currentId) return;
        if (expandedCards.has(currentId)) expandedCards.delete(currentId);
        else expandedCards.add(currentId);
        setAccordionState(node, currentId);
      });
      button.addEventListener('keydown', event => {
        event.stopPropagation();
      });
      top.appendChild(button);
    }
    setAccordionState(node, id);
  }

  function ensureAllCardsOption() {
    if (activeView() !== 'tarjetas') return;
    const root = document.querySelector('#sectionFilterBar [data-card-specific-filter]');
    const box = root?.querySelector('.card-specific-options');
    if (!root || !box) return;

    let option = box.querySelector('[data-card-all-option]');
    if (!option) {
      option = document.createElement('button');
      option.type = 'button';
      option.className = 'multi-filter-option card-specific-all-option';
      option.dataset.cardAllOption = 'true';
      option.dataset.label = 'Todas las tarjetas';
      option.innerHTML = '<span class="multi-filter-check"></span><span>Todas las tarjetas</span>';
      option.addEventListener('click', event => {
        event.stopPropagation();
        const clear = root.querySelector('.card-specific-clear');
        if (selectedCardId() && clear) clear.click();
        else {
          window.__PANEL_ACTIVE_CARD_ID__ = '';
          document.dispatchEvent(new CustomEvent('panel:card-filter-changed', { detail: { cardId: '' } }));
        }
        root.classList.remove('open');
        root.querySelector('.card-specific-trigger')?.setAttribute('aria-expanded', 'false');
        requestAnimationFrame(() => applyCardVisibility(''));
      });
      box.insertBefore(option, box.firstChild);
    }

    const selected = !selectedCardId();
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-pressed', selected ? 'true' : 'false');
    const check = option.querySelector('.multi-filter-check');
    if (check) check.textContent = selected ? '✓' : '';
  }

  function sync() {
    if (activeView() !== 'tarjetas') return;
    const cards = [...document.querySelectorAll('#viewRoot .credit-card')];
    cards.forEach(wireCardAccordion);
    applyCardVisibility();
    ensureAllCardsOption();
  }

  function schedule() {
    if (activeView() !== 'tarjetas') return;
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (activeView() === 'tarjetas') sync();
    }, 180);
  }

  function injectStyles() {
    if (document.getElementById('cardDetailAccordionStyles')) return;
    const style = document.createElement('style');
    style.id = 'cardDetailAccordionStyles';
    style.textContent = `
      #viewRoot .credit-card.card-details-accordion>.credit-top{
        display:grid!important;
        grid-template-columns:minmax(0,1fr) auto auto;
        align-items:center!important;
        gap:9px!important;
      }
      #viewRoot .credit-card.card-details-accordion>.credit-top>.credit-owner{margin-left:0}
      #viewRoot .credit-card.card-details-collapsed>:not(.credit-top):not(.credit-amount):not(.credit-sub):not(.usage-track){display:none!important}
      #viewRoot .credit-card .credit-card-details-toggle{
        position:relative;
        z-index:4;
        display:inline-grid;
        place-items:center;
        width:29px;
        height:29px;
        padding:0;
        border:1px solid #2a3b51;
        border-radius:9px;
        background:#101925;
        color:#9eb7d7;
        font-size:17px;
        line-height:1;
        cursor:pointer;
        transition:background .15s ease,border-color .15s ease,color .15s ease;
      }
      #viewRoot .credit-card .credit-card-details-toggle:hover,
      #viewRoot .credit-card .credit-card-details-toggle:focus-visible{
        background:#152338;
        border-color:#36577f;
        color:#dceaff;
        outline:none;
      }
      #viewRoot .credit-card.card-details-collapsed{min-height:0}
      #viewRoot .credit-card.card-details-expanded .credit-bottom,
      #viewRoot .credit-card.card-details-expanded .credit-card-scope-meta,
      #viewRoot .credit-card.card-details-expanded .card-payment-control{display:flex}
      #viewRoot .credit-card.card-details-expanded .credit-card-scope-meta,
      #viewRoot .credit-card.card-details-expanded .card-payment-control{display:grid}
      #viewRoot .credit-grid.card-filter-active>.credit-card:not([hidden]){grid-column:1/-1}
      #sectionFilterBar .card-specific-all-option{border-bottom:1px solid #172438;margin-bottom:4px;padding-bottom:9px}
      @media(max-width:560px){
        #viewRoot .credit-card.card-details-accordion>.credit-top{grid-template-columns:minmax(0,1fr) auto}
        #viewRoot .credit-card.card-details-accordion>.credit-top>.credit-owner{grid-column:1/2;justify-self:start;margin-top:4px}
        #viewRoot .credit-card.card-details-accordion>.credit-top>.credit-card-details-toggle{grid-column:2/3;grid-row:1/3}
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('panel:view-root-changed', event => {
    if (event.detail?.view === 'tarjetas') schedule();
  });
  document.addEventListener('panel:card-filter-changed', event => {
    if (activeView() !== 'tarjetas') return;
    const id = String(event.detail?.cardId || '').trim();
    window.__PANEL_ACTIVE_CARD_ID__ = id;
    applyCardVisibility(id);
    schedule();
  });
  document.addEventListener('panel:filters-updated', schedule);
  document.addEventListener('panel:section-filters-changed', event => {
    if (event.detail?.view === 'tarjetas') schedule();
  });
  document.addEventListener('panel:expense-scope-changed', event => {
    if (event.detail?.view === 'tarjetas') schedule();
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#clearFilters,#resetCurrentMonth,#clearSectionFilters,.card-specific-clear')) return;
    setTimeout(() => {
      if (!selectedCardId()) applyCardVisibility('');
      schedule();
    }, 0);
  }, true);

  injectStyles();
  queueMicrotask(schedule);
})();
