(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = cfg.financeSpreadsheetId;
  if (!apiBaseUrl || !financeId) return;

  const baseFetch = window.fetch.bind(window);
  let cards = [];
  let cardsPromise = null;
  let activeCardId = '';
  let uiObserver = null;
  let uiTimer = null;
  let trendTimers = [];

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  function activeView() {
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((header,index) => [header || `Col ${index+1}`, row?.[index] ?? ''])));
  }

  function rowsToMatrix(header, rows) {
    return [header, ...rows.map(row => header.map(name => row[name] ?? ''))];
  }

  function cardId(card) {
    return String(card?.['ID tarjeta'] || '').trim();
  }

  function cardLabel(card) {
    const issuer = String(card?.Emisor || 'Tarjeta').trim();
    const owner = String(card?.Titular || '').trim();
    const base = owner ? `${issuer} · ${owner}` : issuer;
    const duplicates = cards.filter(item => norm(item?.Emisor) === norm(card?.Emisor) && norm(item?.Titular) === norm(card?.Titular));
    if (duplicates.length > 1 && card?.Producto) return `${base} · ${String(card.Producto).trim()}`;
    return base;
  }

  function selectedCard() {
    return cards.find(card => cardId(card) === activeCardId) || null;
  }

  async function loadCards(force = false) {
    if (!force && cards.length) return cards;
    if (!force && cardsPromise) return cardsPromise;
    cardsPromise = (async () => {
      const getIdToken = window.__PANEL_GET_ID_TOKEN__;
      if (typeof getIdToken !== 'function') return [];
      const token = await getIdToken(false);
      if (!token) return [];
      const response = await baseFetch(`${apiBaseUrl}/api/data`, {
        headers:{Authorization:`Bearer ${token}`},
        cache:'no-store'
      });
      if (!response.ok) throw new Error(`Backend ${response.status}`);
      const payload = await response.json();
      cards = parseRows(payload?.sources?.[`${financeId}|Tarjetas!A:T`] || [])
        .filter(card => cardId(card) && norm(card?.Activa || 'sí') !== 'no');
      return cards;
    })();
    try {
      return await cardsPromise;
    } finally {
      cardsPromise = null;
    }
  }

  function ownerNick(owner) {
    const value = norm(owner);
    if (value.includes('rocio')) return 'rocio';
    if (value.includes('edu') || value.includes('fernando')) return 'edu';
    return value.split(/\s+/)[0] || '';
  }

  function rowMatchesCard(row, card, range) {
    if (!card) return true;
    const id = cardId(card);
    if (range === 'Tarjetas!A:T') return String(row?.['ID tarjeta'] || '').trim() === id;

    const issuer = norm(card?.Emisor);
    const owner = norm(card?.Titular);
    const nick = ownerNick(owner);
    const source = norm([
      row?.['Cuenta / Tarjeta'], row?.['Cuenta/Tarjeta'], row?.Tarjeta,
      row?.['Medio de Pago'], row?.Pago
    ].filter(Boolean).join(' '));
    const rowOwner = norm(row?.Titular);

    if (issuer && !source.includes(issuer)) return false;

    if (nick === 'rocio') {
      return rowOwner.includes('rocio') || /(^|\s|-)ro($|\s|-)/.test(source) || source.includes('rocio');
    }
    if (nick === 'edu') {
      return rowOwner.includes('edu') || rowOwner.includes('fernando') || source.includes('edu') || source.includes('fernando');
    }
    if (owner) return rowOwner.includes(owner) || source.includes(owner);
    return Boolean(issuer && source.includes(issuer));
  }

  function filterMatrix(values, range) {
    const card = selectedCard();
    if (!card || !Array.isArray(values) || values.length < 2) return values;
    const header = (values[0] || []).map(v => String(v ?? '').trim());
    const rows = parseRows(values).filter(row => rowMatchesCard(row, card, range));
    return rowsToMatrix(header, rows);
  }

  function sheetsRangeFromUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      const match = url.pathname.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/);
      if (!match || decodeURIComponent(match[1]) !== financeId) return '';
      return decodeURIComponent(match[2]);
    } catch (_) {
      return '';
    }
  }

  function isBackendDataUrl(rawUrl) {
    try {
      const target = new URL(rawUrl, location.href);
      const expected = new URL(`${apiBaseUrl}/api/data`, location.href);
      return target.origin === expected.origin && target.pathname === expected.pathname;
    } catch (_) {
      return false;
    }
  }

  function filteredBackendPayload(payload) {
    if (!payload?.sources || !activeCardId || activeView() !== 'tarjetas') return payload;
    const next = {...payload, sources:{...payload.sources}};
    ['Tarjetas!A:T','Movimientos!A:Y','Cuotas!A:T'].forEach(range => {
      const key = `${financeId}|${range}`;
      if (Array.isArray(next.sources[key])) next.sources[key] = filterMatrix(next.sources[key], range);
    });
    return next;
  }

  window.fetch = async function(input, init) {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    const response = await baseFetch(input, init);
    if (!activeCardId || activeView() !== 'tarjetas' || !rawUrl || !response.ok) return response;

    const range = sheetsRangeFromUrl(rawUrl);
    if (['Tarjetas!A:T','Movimientos!A:Y','Cuotas!A:T'].includes(range)) {
      try {
        const payload = await response.clone().json();
        payload.values = filterMatrix(payload.values || [], range);
        return new Response(JSON.stringify(payload), {
          status:response.status,
          statusText:response.statusText,
          headers:{'Content-Type':'application/json'}
        });
      } catch (_) {
        return response;
      }
    }

    if (isBackendDataUrl(rawUrl)) {
      try {
        const payload = filteredBackendPayload(await response.clone().json());
        return new Response(JSON.stringify(payload), {
          status:response.status,
          statusText:response.statusText,
          headers:{'Content-Type':'application/json'}
        });
      } catch (_) {
        return response;
      }
    }

    return response;
  };

  function refreshCardsView(attempt = 0) {
    if (activeView() !== 'tarjetas') return;
    const button = document.getElementById('refreshBtn');
    if (button && !button.disabled) {
      button.click();
      scheduleTrendFilter();
      return;
    }
    if (attempt < 6) setTimeout(() => refreshCardsView(attempt + 1), 220);
  }

  function renderOptions(root) {
    const signature = `${activeCardId}|${cards.map(card => `${cardId(card)}:${cardLabel(card)}`).join('|')}`;
    if (root.dataset.signature === signature) return;
    root.dataset.signature = signature;

    const selected = selectedCard();
    const summary = root.querySelector('.card-specific-summary');
    if (summary) summary.textContent = selected ? cardLabel(selected) : 'Todas';
    root.classList.toggle('has-selection',Boolean(selected));

    const box = root.querySelector('.card-specific-options');
    if (!box) return;
    box.innerHTML = cards.length ? cards.map(card => {
      const id = cardId(card);
      const label = cardLabel(card);
      const on = id === activeCardId;
      return `<button type="button" class="multi-filter-option card-specific-option${on?' selected':''}" data-card-id="${esc(id)}" data-label="${esc(label)}" aria-pressed="${on}"><span class="multi-filter-check">${on?'✓':''}</span><span>${esc(label)}</span></button>`;
    }).join('') : '<div class="multi-filter-empty">Sin tarjetas registradas</div>';

    box.querySelectorAll('.card-specific-option').forEach(button => button.addEventListener('click',event => {
      event.stopPropagation();
      const id = String(button.dataset.cardId || '');
      activeCardId = activeCardId === id ? '' : id;
      window.__PANEL_ACTIVE_CARD_ID__ = activeCardId;
      root.dataset.signature = '';
      renderOptions(root);
      root.classList.remove('open');
      root.querySelector('.card-specific-trigger')?.setAttribute('aria-expanded','false');
      refreshCardsView();
    }));
  }

  function wireSectionClear(bar) {
    const button = bar.querySelector('#clearSectionFilters');
    if (!button || button.dataset.cardSpecificWired === '1') return;
    button.dataset.cardSpecificWired = '1';
    button.addEventListener('click',() => {
      activeCardId = '';
      window.__PANEL_ACTIVE_CARD_ID__ = '';
      const root = bar.querySelector('[data-card-specific-filter]');
      if (root) {
        root.dataset.signature = '';
        renderOptions(root);
      }
    }, true);
  }

  function ensureCardFilterUI() {
    if (activeView() !== 'tarjetas') return;
    const bar = document.getElementById('sectionFilterBar');
    if (!bar || bar.hidden) return;
    const grid = bar.querySelector('.section-filter-grid');
    if (!grid) return;

    const oldHolder = grid.querySelector('[data-local-key="cardHolder"]');
    if (oldHolder) oldHolder.hidden = true;

    let root = grid.querySelector('[data-card-specific-filter]');
    if (!root) {
      root = document.createElement('div');
      root.className = 'multi-filter local-multi-filter card-specific-filter';
      root.dataset.cardSpecificFilter = 'true';
      root.innerHTML = `
        <div class="filter-label-row"><span>Tarjeta de crédito</span><button type="button" class="filter-clear-one card-specific-clear">Limpiar</button></div>
        <button type="button" class="multi-filter-trigger card-specific-trigger" aria-expanded="false"><span class="card-specific-summary">Todas</span><span class="filter-chevron">⌄</span></button>
        <div class="multi-filter-menu card-specific-menu"><input class="multi-filter-search card-specific-search" placeholder="Buscar tarjeta…" autocomplete="off"><div class="multi-filter-options card-specific-options"></div></div>`;
      grid.prepend(root);

      root.querySelector('.card-specific-trigger')?.addEventListener('click',event => {
        event.stopPropagation();
        root.classList.toggle('open');
        root.querySelector('.card-specific-trigger')?.setAttribute('aria-expanded',root.classList.contains('open') ? 'true' : 'false');
        if (root.classList.contains('open')) setTimeout(() => root.querySelector('.card-specific-search')?.focus(),0);
      });
      root.querySelector('.card-specific-search')?.addEventListener('input',event => {
        const query = norm(event.target.value);
        root.querySelectorAll('.card-specific-option').forEach(button => {
          button.hidden = Boolean(query && !norm(button.dataset.label).includes(query));
        });
      });
      root.querySelector('.card-specific-clear')?.addEventListener('click',event => {
        event.stopPropagation();
        if (!activeCardId) return;
        activeCardId = '';
        window.__PANEL_ACTIVE_CARD_ID__ = '';
        root.dataset.signature = '';
        renderOptions(root);
        refreshCardsView();
      });
    }

    renderOptions(root);
    wireSectionClear(bar);
  }

  function filterTrendChart() {
    if (!activeCardId || activeView() !== 'tarjetas' || !window.Chart) return;
    const canvas = document.getElementById('cardTrendChart');
    if (!canvas) return;
    const chart = Chart.getChart(canvas);
    const card = selectedCard();
    if (!chart || !card) return;
    const wanted = norm(cardLabel(card));
    const matching = chart.data.datasets.filter(dataset => norm(dataset.label) === wanted);
    if (!matching.length) return;
    if (chart.data.datasets.length !== matching.length || chart.data.datasets.some((dataset,index) => dataset !== matching[index])) {
      chart.data.datasets = matching;
      chart.update('none');
    }
  }

  function scheduleTrendFilter() {
    trendTimers.forEach(clearTimeout);
    trendTimers = [0,120,350,800].map(delay => setTimeout(filterTrendChart,delay));
  }

  function scheduleUI() {
    clearTimeout(uiTimer);
    uiTimer = setTimeout(() => {
      ensureCardFilterUI();
      scheduleTrendFilter();
    },60);
  }

  function startObserver() {
    if (uiObserver) return;
    const main = document.querySelector('.main');
    if (!main) return;
    uiObserver = new MutationObserver(scheduleUI);
    uiObserver.observe(main,{childList:true,subtree:true});
  }

  document.addEventListener('click',event => {
    if (!event.target.closest('[data-card-specific-filter]')) {
      document.querySelector('[data-card-specific-filter].open')?.classList.remove('open');
    }
    if (event.target.closest('.nav-item')) setTimeout(scheduleUI,20);
    if (event.target.closest('[data-card-line-mode]')) scheduleTrendFilter();
    if (event.target.closest('.currency-btn') && activeView() === 'tarjetas') scheduleTrendFilter();
  });

  window.__PANEL_ACTIVE_CARD_ID__ = '';
  loadCards()
    .then(() => {
      ensureCardFilterUI();
      scheduleTrendFilter();
    })
    .catch(error => console.error('No fue posible cargar el filtro de tarjetas:',error));
  startObserver();
  scheduleUI();
})();
