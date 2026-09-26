(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  const COLORS = ['#1769ff','#f6c844','#26d07c','#ff667a','#ffad42','#7a8ba5'];
  let frame = 0;
  let settleTimer = 0;
  let dataFrame = 0;
  let pendingDataSync = false;
  let sourcePayload = null;
  let sourceCache = null;
  let sourcePromise = null;
  let paymentsExpanded = false;
  let observedPaymentsHost = null;
  let paymentsObserver = null;
  const dateCache = new WeakMap();

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const activeCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const pick = (row, keys) => { for (const key of keys) if (row?.[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim(); return ''; };

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let text = String(value ?? '').trim().replace(/[^\d,.\-]/g, '');
    if (!text) return 0;
    const comma = text.lastIndexOf(','), dot = text.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    else if (comma >= 0) { const p = text.split(','); text = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g, '') + '.' + p[1] : text.replace(/,/g, ''); }
    else if (dot >= 0) { const p = text.split('.'); if (p.length > 2 || (p.length === 2 && p[1].length === 3)) text = text.replace(/\./g, ''); }
    const out = Number(text);
    return Number.isFinite(out) ? out : 0;
  }

  function parseDate(value) {
    if(typeof value==='number'&&Number.isFinite(value)&&value>20000&&value<80000){const utc=new Date(Math.round((value-25569)*86400000));return new Date(utc.getUTCFullYear(),utc.getUTCMonth(),utc.getUTCDate());}
    const text = String(value ?? '').trim();
    if (!text) return null;
    let match = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (match) return new Date(+match[1], +match[2] - 1, +(match[3] || 1));
    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) return new Date(+match[3], +match[2] - 1, +match[1]);
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(value => String(value ?? '').trim());
    return values.slice(1).filter(row => row?.some(value => String(value ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((header, index) => [header || `Col ${index + 1}`, row?.[index] ?? ''])));
  }

  function rowsFromPayload(payload, range) {
    const cached = window.__PANEL_GET_CACHED_ROWS__;
    if (typeof cached === 'function') return cached(payload, financeId, range);
    return parseRows(payload?.sources?.[`${financeId}|${range}`] || []);
  }

  async function loadSources(force = false) {
    if (force) { sourcePayload = null; sourceCache = null; sourcePromise = null; }
    if (sourcePromise) return sourcePromise;
    sourcePromise = (async () => {
      const getData = window.__PANEL_GET_BACKEND_DATA__;
      if (typeof getData !== 'function') return { movements: [], cards: [] };
      const payload = await getData(force);
      if (payload === sourcePayload && sourceCache) return sourceCache;
      const wide = rowsFromPayload(payload, 'Movimientos!A:AA');
      const legacy = rowsFromPayload(payload, 'Movimientos!A:Z');
      sourcePayload = payload;
      sourceCache = {
        movements: window.FinanceScopeCore?.movementRows ? window.FinanceScopeCore.movementRows(payload,financeId) : (wide.length ? wide : legacy),
        cards: rowsFromPayload(payload, 'Tarjetas!A:T')
      };
      return sourceCache;
    })();
    try { return await sourcePromise; }
    finally { sourcePromise = null; }
  }

  function direct(root, selector) {
    return [...root.children].find(node => node.matches?.(selector)) || null;
  }

  function panelFor(root, selector) {
    const node = root.querySelector(selector);
    const panel = node?.closest('.panel');
    return panel && panel.parentElement === root ? panel : null;
  }

  function selectedGlobal(key) {
    return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
      .map(element => String(element.dataset.value || '').trim()).filter(Boolean);
  }

  function rowDate(row) {
    if (dateCache.has(row)) return dateCache.get(row);
    const date = parseDate(pick(row, ['Fecha real','Fecha registrada','Fecha','Mes consumo']));
    dateCache.set(row, date);
    return date;
  }

  function scopeOf(row) {
    if (window.FinanceScopeCore?.scopeOf) return window.FinanceScopeCore.scopeOf(row);
    const explicit = norm(row['Ámbito'] || row.Ambito);
    if (explicit.includes('fibrazo')) return 'FIBRAZO';
    if (explicit.includes('personal')) return 'Personal';
    const marker = norm(row.Observaciones);
    return marker.includes('ambito explicito: fibrazo') ? 'FIBRAZO' : 'Personal';
  }

  function isActualExpense(row) {
    const type = norm(pick(row, ['Tipo','Naturaleza']));
    if (type && !type.includes('gasto') && !type.includes('egreso') && !type.includes('compra')) return false;
    const status = norm(row.Estado);
    if (/proyecc|proyect|programad|pendiente/.test(status)) return false;
    return window.MovementStatusCore?.isActual ? window.MovementStatusCore.isActual(row.Estado) : true;
  }

  function isCreditPurchase(row) {
    if (!isActualExpense(row)) return false;
    if (typeof window.FinancePurchasePolicy?.isCreditPurchase === 'function') return window.FinancePurchasePolicy.isCreditPurchase(row);
    const explicit = norm(row['Modalidad de pago']);
    const account = norm(row['Cuenta / Tarjeta']);
    const installments = parseNumber(row.Cuotas);
    const credit = explicit ? explicit.includes('credito') : account.includes('arq') || account.includes('nu edu') || account.includes('nu ro') || (installments > 0 && (account.includes('nu') || account.includes('arq')));
    if (!credit) return false;
    const description = norm([row['Subcategoría'], row['Descripción / Comercio'], row['Descripción original']].filter(Boolean).join(' '));
    return !/cuota de manejo|interes|pago de tarjeta|pago tarjeta/.test(description);
  }

  function ownerNick(value) {
    const text = norm(value);
    if (text.includes('rocio')) return 'rocio';
    if (text.includes('edu') || text.includes('fernando')) return 'edu';
    return text.split(/\s+/)[0] || '';
  }

  function rowMatchesCard(row, card) {
    const issuer = norm(card?.Emisor), owner = ownerNick(card?.Titular), account = norm(row['Cuenta / Tarjeta']), holder = ownerNick(row.Titular);
    if (issuer.includes('arq') && !account.includes('arq')) return false;
    if (issuer.includes('nu') && !account.includes('nu')) return false;
    if (owner === 'rocio') return holder === 'rocio' || account.includes('nu ro') || account.includes('rocio');
    if (owner === 'edu') return holder === 'edu' || account.includes('nu edu') || account.includes('arq') || account.includes('edu');
    return true;
  }

  function cardId(card) { return String(card?.['ID tarjeta'] || '').trim(); }
  function cardLabel(card) { return `${String(card?.Emisor || 'Tarjeta').trim()}${card?.Titular ? ` · ${String(card.Titular).trim()}` : ''}`; }
  function cardLimit(card) { return parseNumber(pick(card, ['Cupo total actual','Cupo total','Límite real','Límite','Limite','Cupo'])); }
  function cardControlLimit(card) { const configured=parseNumber(pick(card,['Límite personal de gasto','Límite de control'])); return configured>0?configured:cardLimit(card); }
  function cardReferenceLimit(card) { return String(window.__PANEL_CARD_LIMIT_MODE__||'control')==='real'?cardLimit(card):cardControlLimit(card); }
  function cutDay(card) { const day = parseInt(pick(card, ['Día corte','Dia corte','Corte']), 10); return Number.isFinite(day) && day >= 1 && day <= 31 ? day : 1; }

  function filteredCreditRows(rows) {
    const years = new Set(selectedGlobal('year'));
    const months = new Set(selectedGlobal('month'));
    const categories = new Set(selectedGlobal('category'));
    const subcategories = new Set(selectedGlobal('subcategory'));
    const scope = window.__FINANCE_SCOPE_FILTER_STATE__?.tarjetas || 'Todos';
    return (rows || []).filter(row => {
      if (!isCreditPurchase(row)) return false;
      const date = rowDate(row);
      if (!date) return false;
      if (years.size && !years.has(String(date.getFullYear()))) return false;
      if (months.size && !months.has(String(date.getMonth() + 1))) return false;
      if (categories.size && !categories.has(String(row['Categoría'] || ''))) return false;
      if (subcategories.size && !subcategories.has(String(row['Subcategoría'] || ''))) return false;
      if (scope !== 'Todos' && scopeOf(row) !== scope) return false;
      return true;
    });
  }

  function displayAmount(row, currency) {
    if (currency === 'USD') return parseNumber(row['Monto USD']);
    if (currency === 'ARS') return parseNumber(row['Monto ARS']);
    return parseNumber(row['Monto COP']);
  }

  function periodLabel(date, daily) {
    return daily ? `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}` : `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  }

  function cycleKey(date, cut) {
    const year = date.getFullYear(), month = date.getMonth(), endMonth = date.getDate() <= cut ? month : month + 1;
    const last = new Date(year, endMonth + 1, 0).getDate();
    const end = new Date(year, endMonth, Math.min(cut, last));
    return `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
  }

  function buildTrendSeries(rows, cards, metric, currency) {
    const activeId = String(window.__PANEL_ACTIVE_CARD_ID__ || '').trim();
    if (activeId) cards = cards.filter(card => cardId(card) === activeId);
    const daily = selectedGlobal('month').length === 1;
    const dated = rows.map(row => ({ row, date: rowDate(row) })).filter(item => item.date).sort((a,b) => a.date - b.date);
    const labels = [...new Set(dated.map(item => periodLabel(item.date, daily)))];
    const datasets = cards.map((card, index) => {
      let data;
      if (metric === 'limit') {
        const cut = cutDay(card), limit = cardReferenceLimit(card), running = new Map(), points = new Map();
        dated.forEach(item => {
          if (!rowMatchesCard(item.row, card)) return;
          const cycle = cycleKey(item.date, cut);
          const next = (running.get(cycle) || 0) + displayAmount(item.row, 'COP');
          running.set(cycle, next);
          points.set(periodLabel(item.date, daily), limit ? next / limit * 100 : 0);
        });
        let last = null;
        data = labels.map(label => { if (points.has(label)) last = points.get(label); return last; });
      } else {
        const totals = new Map();
        dated.forEach(item => {
          if (!rowMatchesCard(item.row, card)) return;
          const label = periodLabel(item.date, daily);
          totals.set(label, (totals.get(label) || 0) + displayAmount(item.row, currency));
        });
        data = labels.map(label => totals.get(label) || 0);
      }
      return { label: cardLabel(card), data, borderColor: COLORS[index % COLORS.length], backgroundColor: COLORS[index % COLORS.length], borderWidth: 2, tension: .25, pointRadius: 2, pointHoverRadius: 5, spanGaps: true };
    }).filter(dataset => dataset.data.some(value => value != null && Number(value) !== 0));
    return { labels, datasets };
  }

  function money(value, currency = activeCurrency()) {
    let amount = Number(value) || 0;
    if (currency === 'USD') amount /= Number(cfg.regularIncome?.usdCopReference || 3150);
    else if (currency === 'ARS') amount = amount / Number(cfg.regularIncome?.usdCopReference || 3150) * 1500;
    return new Intl.NumberFormat('es-CO', { style:'currency', currency, maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format(amount);
  }

  async function syncTrendChart() {
    if (activeView() !== 'tarjetas' || !window.Chart) return;
    const canvas = document.getElementById('cardTrendChart');
    const chart = canvas ? Chart.getChart(canvas) : null;
    if (!chart) return;
    const { movements, cards } = await loadSources(false);
    if (activeView() !== 'tarjetas' || !canvas.isConnected) return;
    const metric = document.querySelector('[data-card-line-mode].active')?.dataset.cardLineMode || 'spend';
    const built = buildTrendSeries(filteredCreditRows(movements), cards, metric, activeCurrency());
    chart.data.labels = built.labels;
    chart.data.datasets = built.datasets;
    chart.update('none');
    const scope = window.__FINANCE_SCOPE_FILTER_STATE__?.tarjetas || 'Todos';
    const subtitle = canvas.closest('.panel')?.querySelector('.panel-title span');
    if (subtitle) { const ref=String(window.__PANEL_CARD_LIMIT_MODE__||'control')==='real'?'límite real':'límite de control'; subtitle.textContent = `Compras con crédito · ${scope} · ${metric === 'limit' ? `porcentaje del ${ref} utilizado` : 'gasto del período'}`; }
  }

  async function syncCardSummary() {
    if (activeView() !== 'tarjetas') return;
    const { cards } = await loadSources(false);
    if (activeView() !== 'tarjetas') return;
    const activeId = String(window.__PANEL_ACTIVE_CARD_ID__ || '').trim();
    const visible = activeId ? cards.filter(card => cardId(card) === activeId) : cards;
    const total = visible.reduce((sum, card) => sum + cardLimit(card), 0);
    const used = visible.reduce((sum, card) => sum + parseNumber(pick(card, ['Cupo usado','Utilizado','Saldo usado'])), 0);
    const nextPayment = visible.reduce((sum, card) => sum + parseNumber(pick(card, ['Pago total próximo','Pago mínimo próximo'])), 0);
    const grid = direct(document.getElementById('viewRoot'), '.kpi-grid');
    if (grid) {
      const byLabel = new Map([...grid.querySelectorAll('.kpi-card')].map(card => [norm(card.querySelector('.kpi-label')?.textContent), card]));
      const set = (label, value, meta) => {
        const card = byLabel.get(norm(label)); if (!card) return;
        const valueNode = card.querySelector('.kpi-value'), metaNode = card.querySelector('.kpi-meta span');
        if (valueNode) valueNode.textContent = value;
        if (metaNode) metaNode.textContent = meta;
      };
      set('Cupo total', money(total), `${visible.length} tarjeta${visible.length === 1 ? '' : 's'}${activeId ? ' seleccionada' : ''}`);
      set('Cupo usado', money(used), total ? `${new Intl.NumberFormat('es-CO',{maximumFractionDigits:1}).format(used / total * 100)}% consolidado` : '—');
      set('Disponible', money(Math.max(0, total - used)), 'Cupo bancario actual');
      set('Pago próximo', money(nextPayment), 'Suma registrada');
    }

    document.querySelectorAll('#viewRoot .credit-card').forEach(node => {
      const brand = norm(node.querySelector('.credit-brand')?.textContent), owner = norm(node.querySelector('.credit-owner')?.textContent);
      let id = '';
      if (brand.includes('arq')) id = 'TC-ARQ-EDU';
      else if (brand.includes('nu') && owner.includes('rocio')) id = 'TC-NU-RO';
      else if (brand.includes('nu')) id = 'TC-NU-EDU';
      node.dataset.cardId = id;
      node.hidden = Boolean(activeId && id && id !== activeId);
      node.classList.toggle('card-brand-arq', brand.includes('arq'));
      node.classList.toggle('card-brand-nu', brand.includes('nu'));
    });
  }

  function injectStyles() {
    if (document.getElementById('cardSectionPolishStyles')) return;
    const style = document.createElement('style');
    style.id = 'cardSectionPolishStyles';
    style.textContent = `
      #viewRoot .credit-card .credit-top{align-items:flex-start;gap:10px}
      #viewRoot .credit-card .credit-brand{display:inline-flex;align-items:center;min-height:34px;padding:7px 10px;border:1px solid #2a3d58;border-radius:10px;background:rgba(23,105,255,.10);font-size:14px;line-height:1.2;color:#f4f8ff;font-weight:800;text-transform:none;letter-spacing:-.015em;box-shadow:inset 0 0 0 1px rgba(255,255,255,.02)}
      #viewRoot .credit-card.card-brand-arq .credit-brand{border-color:rgba(38,208,124,.34);background:rgba(38,208,124,.08)}
      #viewRoot .credit-card .credit-owner{display:inline-flex;align-items:center;min-height:26px;padding:5px 8px;border:1px solid #24354c;border-radius:999px;background:#101a28;color:#9eb0c7;font-size:9px;font-weight:800;white-space:nowrap}
      #filterBar .filter-grid,#sectionFilterBar .section-filter-grid{column-gap:11px;row-gap:14px;align-items:start}
      #filterBar .filter-label-row,#sectionFilterBar .filter-label-row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:18px;margin-bottom:6px;line-height:1.2}
      #filterBar .filter-label-row>span,#sectionFilterBar .filter-label-row>span{display:block;min-width:0;line-height:1.2}
      #sectionFilterBar:not([hidden]):has([data-card-specific-filter]){padding-top:14px!important;padding-bottom:14px!important}
      #sectionFilterBar:not([hidden]):has([data-card-specific-filter]) .section-filter-grid{grid-template-columns:repeat(2,minmax(260px,1fr));gap:12px}
      #sectionFilterBar .card-specific-filter,#sectionFilterBar .finance-scope-filter{min-width:0!important;align-self:start}
      #sectionFilterBar .finance-scope-buttons{min-height:39px}
      .card-payments-accordion>.panel-header{margin-bottom:0;cursor:pointer;align-items:center;border-radius:10px;padding:4px 2px}
      .card-payments-accordion>.panel-header:hover{background:rgba(255,255,255,.02)}
      .card-payments-toggle{display:inline-grid;place-items:center;flex:0 0 auto;width:31px;height:31px;border:1px solid var(--border);border-radius:9px;background:#101925;color:#9bb4d4;font-size:17px;cursor:pointer}
      .card-payments-accordion.is-open>.panel-header{margin-bottom:15px}
      @media(max-width:760px){#sectionFilterBar:not([hidden]):has([data-card-specific-filter]) .section-filter-grid{grid-template-columns:1fr}#filterBar .filter-head{align-items:flex-start;gap:10px;flex-wrap:wrap}#filterBar .filter-actions{flex-wrap:wrap}}
    `;
    document.head.appendChild(style);
  }

  function removeRedundant(root, linePanel) {
    if (linePanel) {
      const usage = panelFor(root, '#cardsChart');
      if (usage) {
        const chart = window.Chart ? Chart.getChart(usage.querySelector('#cardsChart')) : null;
        try { chart?.destroy(); } catch (_) {}
        usage.remove();
      }
    }
    direct(root, '.credit-spend-panel')?.remove();
    [...root.children].forEach(node => {
      if (!node.classList?.contains('table-panel')) return;
      const title = norm(node.querySelector('.panel-title strong')?.textContent);
      if (title === 'detalle de tarjetas') node.remove();
    });
  }

  function applyPaymentsAccordion(host) {
    if (!host) return;
    const paymentPanel = [...host.querySelectorAll(':scope > .panel')].find(panel => norm(panel.querySelector('.panel-title strong')?.textContent) === 'pagos realizados');
    if (!paymentPanel) return;
    if (paymentPanel !== host.lastElementChild) host.appendChild(paymentPanel);
    paymentPanel.classList.add('card-payments-accordion');
    const header = paymentPanel.querySelector(':scope > .panel-header');
    const body = paymentPanel.querySelector(':scope > .table-scroll');
    if (!header || !body) return;
    let toggle = header.querySelector('.card-payments-toggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'card-payments-toggle';
      toggle.setAttribute('aria-label','Mostrar u ocultar pagos realizados');
      header.appendChild(toggle);
    }
    const apply = () => {
      body.hidden = !paymentsExpanded;
      paymentPanel.classList.toggle('is-open', paymentsExpanded);
      toggle.textContent = paymentsExpanded ? '⌃' : '⌄';
      toggle.setAttribute('aria-expanded', paymentsExpanded ? 'true' : 'false');
    };
    if (header.dataset.paymentsAccordionWired !== '1') {
      header.dataset.paymentsAccordionWired = '1';
      header.setAttribute('role','button');
      header.tabIndex = 0;
      const flip = event => {
        if (event?.target?.closest('a,input,select')) return;
        if (event?.type === 'keydown' && !['Enter',' '].includes(event.key)) return;
        if (event?.type === 'keydown') event.preventDefault();
        paymentsExpanded = !paymentsExpanded;
        apply();
      };
      header.addEventListener('click', flip);
      header.addEventListener('keydown', flip);
    }
    apply();
  }

  function observePayments(host) {
    if (host === observedPaymentsHost) return;
    paymentsObserver?.disconnect();
    observedPaymentsHost = host || null;
    if (!host) return;
    paymentsObserver = new MutationObserver(() => schedule(false));
    paymentsObserver.observe(host, { childList:true, subtree:false });
  }

  function applyStableOrder(root, desired) {
    let cursor = root.firstElementChild;
    let changed = false;
    desired.forEach(node => {
      if (!node || node.parentElement !== root) return;
      if (node === cursor) { cursor = cursor.nextElementSibling; return; }
      root.insertBefore(node, cursor);
      changed = true;
    });
    return changed;
  }

  function reorder(syncData = true) {
    if (activeView() !== 'tarjetas') return;
    const root = document.getElementById('viewRoot');
    if (!root) return;
    injectStyles();

    const sectionHead = direct(root, '.section-head');
    const financeContext = direct(root, '.finance-context');
    const kpis = direct(root, '.kpi-grid');
    const linePanel = direct(root, '[data-card-line-panel]');
    const creditGrid = direct(root, '.credit-grid');
    const expensePanel = direct(root, '#cardExpenseScopePanel');
    const paymentsHost = direct(root, '#cardPaymentsInstallments');

    removeRedundant(root, linePanel);
    applyPaymentsAccordion(paymentsHost);
    observePayments(paymentsHost);

    const priority = [sectionHead, financeContext, kpis, linePanel, creditGrid, expensePanel].filter(Boolean);
    const prioritySet = new Set([...priority, paymentsHost].filter(Boolean));
    const rest = [...root.children].filter(node => !prioritySet.has(node));
    const desired = [...priority, ...rest, ...[paymentsHost].filter(Boolean)];
    const changed = applyStableOrder(root, desired);
    root.dataset.cardSectionOrder = 'filters-summary-line-cards-expenses-rest-payments';

    if (changed) requestAnimationFrame(() => {
      const canvas = document.getElementById('cardTrendChart');
      const chart = canvas && window.Chart ? Chart.getChart(canvas) : null;
      try { chart?.resize(); chart?.update('none'); } catch (_) {}
    });
    if (syncData) scheduleDataSync();
  }

  function scheduleDataSync() {
    if (activeView() !== 'tarjetas' || dataFrame) return;
    dataFrame = requestAnimationFrame(() => {
      dataFrame = 0;
      Promise.resolve(syncCardSummary()).catch(error => console.error('Control de Tarjetas:', error));
    });
  }

  function schedule(syncData = true) {
    if (activeView() !== 'tarjetas') return;
    pendingDataSync = pendingDataSync || Boolean(syncData);
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      const shouldSync = pendingDataSync;
      pendingDataSync = false;
      reorder(shouldSync);
    });
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { if (activeView() === 'tarjetas') reorder(false); }, 140);
  }

  function resetCustomFilters() {
    if (activeView() !== 'tarjetas') return;
    const clearCard = document.querySelector('#sectionFilterBar .card-specific-clear');
    if (window.__PANEL_ACTIVE_CARD_ID__) {
      if (clearCard) clearCard.click();
      else window.__PANEL_ACTIVE_CARD_ID__ = '';
    }
    const scopeRoot = document.querySelector('#sectionFilterBar [data-finance-scope-filter]');
    const all = scopeRoot?.querySelector('[data-scope="Todos"]');
    if (all && !all.classList.contains('active')) all.click();
    else if (window.__FINANCE_SCOPE_FILTER_STATE__) window.__FINANCE_SCOPE_FILTER_STATE__.tarjetas = 'Todos';
    schedule();
  }

  document.addEventListener('click', event => {
    if (event.target.closest('#clearFilters,#resetCurrentMonth,#clearSectionFilters')) setTimeout(resetCustomFilters, 0);
  });
  document.addEventListener('panel:view-root-changed', event => { if (event.detail?.view === 'tarjetas') schedule(); });
  document.addEventListener('panel:card-trend-rendered', () => schedule(false));
  document.addEventListener('panel:card-limit-mode-changed', () => schedule(false));
  document.addEventListener('panel:card-filter-changed', schedule);
  document.addEventListener('panel:filters-updated', schedule);
  document.addEventListener('panel:section-filters-changed', event => { if (event.detail?.view === 'tarjetas') schedule(); });
  document.addEventListener('panel:expense-scope-changed', event => { if (event.detail?.view === 'tarjetas') schedule(); });
  document.addEventListener('panel:backend-refresh-requested', () => { sourcePayload = null; sourceCache = null; sourcePromise = null; });
  document.addEventListener('panel:app-data-ready', () => { sourcePayload = null; sourceCache = null; sourcePromise = null; });

  injectStyles();
  queueMicrotask(schedule);
})();