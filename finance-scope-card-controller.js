(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  const scopeState = window.FinanceScopeCore?.state?.() || window.__FINANCE_SCOPE_FILTER_STATE__ || { gastos: 'Personal', tarjetas: 'Todos' };
  scopeState.gastos ||= 'Personal';
  scopeState.tarjetas ||= 'Todos';
  window.__FINANCE_SCOPE_FILTER_STATE__ = scopeState;

  let payload = null;
  let rows = [];
  let cards = [];
  let frame = 0;
  let query = '';
  let expanded = false;
  let sortKey = 'date';
  let sortDirection = 'desc';
  const dateCache = new WeakMap();

  const COLLAPSED_ROWS = 10;
  const EXPANDED_VISIBLE_ROWS = 20;

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const activeCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';
  const selectedGlobal = key => [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(el => String(el.dataset.value || '').trim()).filter(Boolean);

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1).filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((header, index) => [header || `Col ${index + 1}`, row?.[index] ?? ''])));
  }

  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let text = String(value ?? '').trim().replace(/[^\d,.\-]/g, '');
    if (!text) return 0;
    const comma = text.lastIndexOf(','), dot = text.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    else if (comma >= 0) { const p = text.split(','); text = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g, '') + '.' + p[1] : text.replace(/,/g, ''); }
    else if (dot >= 0) { const p = text.split('.'); if (p.length > 2 || (p.length === 2 && p[1].length === 3)) text = text.replace(/\./g, ''); }
    const out = Number(text); return Number.isFinite(out) ? out : 0;
  }

  function parseDate(value) {
    const text = String(value ?? '').trim();
    let match = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (match) return new Date(+match[1], +match[2] - 1, +(match[3] || 1));
    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) return new Date(+match[3], +match[2] - 1, +match[1]);
    const date = new Date(text); return Number.isNaN(date.getTime()) ? null : date;
  }

  function rowDate(row) {
    if (dateCache.has(row)) return dateCache.get(row);
    const date = parseDate(row['Fecha real'] || row['Fecha registrada'] || row['Mes consumo']);
    dateCache.set(row, date); return date;
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
    const status = norm(row.Estado);
    if (status && /proyecc|proyect|programad|pendiente/.test(status)) return false;
    const type = norm(row.Tipo || row.Naturaleza || 'gasto');
    return !type || type.includes('gasto') || type.includes('egreso') || type.includes('compra');
  }

  function isCredit(row) {
    if (!isActualExpense(row)) return false;
    const explicit = String(row['Modalidad de pago'] || '').trim();
    const account = norm(row['Cuenta / Tarjeta']);
    const installments = num(row.Cuotas);
    const credit = explicit
      ? norm(explicit).includes('credito')
      : account.includes('arq') || account.includes('nu edu') || account.includes('nu ro') || (installments > 0 && (account.includes('nu') || account.includes('arq')));
    if (!credit) return false;
    const description = norm([row['Subcategoría'], row['Descripción / Comercio'], row['Descripción original']].filter(Boolean).join(' '));
    return !/cuota de manejo|interes|pago de tarjeta|pago tarjeta/.test(description);
  }

  function cardId(card) { return String(card?.['ID tarjeta'] || '').trim(); }
  function ownerNick(value) { const text = norm(value); if (text.includes('rocio')) return 'rocio'; if (text.includes('edu') || text.includes('fernando')) return 'edu'; return text; }
  function rowMatchesCard(row, card) {
    if (!card) return true;
    const issuer = norm(card.Emisor), owner = ownerNick(card.Titular), account = norm(row['Cuenta / Tarjeta']), holder = ownerNick(row.Titular);
    if (issuer.includes('arq') && !account.includes('arq')) return false;
    if (issuer.includes('nu') && !account.includes('nu')) return false;
    if (owner === 'rocio') return holder === 'rocio' || account.includes('nu ro') || account.includes('rocio');
    if (owner === 'edu') return holder === 'edu' || account.includes('nu edu') || account.includes('arq') || account.includes('edu');
    return true;
  }

  function activeCard() {
    const id = String(window.__PANEL_ACTIVE_CARD_ID__ || '').trim();
    return cards.find(card => cardId(card) === id) || null;
  }

  function amount(row, currency = activeCurrency()) {
    if (currency === 'USD') return num(row['Monto USD']);
    if (currency === 'ARS') return num(row['Monto ARS']);
    return num(row['Monto COP']);
  }

  function money(value, currency = activeCurrency()) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency, minimumFractionDigits: currency === 'USD' ? 2 : 0, maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format(Number(value) || 0);
  }

  function periodRows(sourceRows = rows) {
    const years = new Set(selectedGlobal('year'));
    const months = new Set(selectedGlobal('month'));
    const categories = new Set(selectedGlobal('category'));
    const subcategories = new Set(selectedGlobal('subcategory'));
    const card = activeView() === 'tarjetas' ? activeCard() : null;
    return sourceRows.filter(row => {
      const date = rowDate(row);
      if (years.size && (!date || !years.has(String(date.getFullYear())))) return false;
      if (months.size && (!date || !months.has(String(date.getMonth() + 1)))) return false;
      if (categories.size && !categories.has(String(row['Categoría'] || ''))) return false;
      if (subcategories.size && !subcategories.has(String(row['Subcategoría'] || ''))) return false;
      if (card && !rowMatchesCard(row, card)) return false;
      return true;
    });
  }

  function scopedRows(sourceRows, view = activeView()) {
    const selected = window.FinanceScopeCore?.getScope?.(view) || scopeState[view] || (view === 'gastos' ? 'Personal' : 'Todos');
    return selected === 'Todos' ? sourceRows : sourceRows.filter(row => scopeOf(row) === selected);
  }

  async function loadData(force = false) {
    const getData = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getData !== 'function') return;
    const next = await getData(force);
    if (next === payload && rows.length) return;
    payload = next;
    const cached = window.__PANEL_GET_CACHED_ROWS__;
    if(window.FinanceScopeCore?.movementRows) rows=window.FinanceScopeCore.movementRows(next,financeId);
    else {
      const wide = typeof cached === 'function' ? cached(next, financeId, 'Movimientos!A:AA') : [];
      const legacy = typeof cached === 'function' ? cached(next, financeId, 'Movimientos!A:Z') : parseRows(next?.sources?.[`${financeId}|Movimientos!A:Z`] || []);
      rows = wide.length ? wide : legacy;
    }
    cards = typeof cached === 'function' ? cached(next, financeId, 'Tarjetas!A:T') : parseRows(next?.sources?.[`${financeId}|Tarjetas!A:T`] || []);
  }

  function injectStyles() {
    if (document.getElementById('financeScopeCardStyles')) return;
    const style = document.createElement('style'); style.id = 'financeScopeCardStyles'; style.textContent = `
      .finance-scope-filter{min-width:260px}.finance-scope-buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:3px;border:1px solid #213047;border-radius:9px;background:#0b131e}
      .finance-scope-buttons button{border:0;background:transparent;color:#8496ad;border-radius:6px;padding:7px 8px;font-size:9px;font-weight:800;cursor:pointer}.finance-scope-buttons button.active{background:#17345f;color:#e7f1ff}.finance-scope-buttons button[data-scope="FIBRAZO"].active{background:#493816;color:#ffd66b}
      .card-expense-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 12px 12px}.card-expense-summary>div{border:1px solid #1b2a3d;border-radius:10px;padding:9px;background:rgba(255,255,255,.015)}.card-expense-summary span{display:block;color:#71849d;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.card-expense-summary strong{display:block;margin-top:5px;font-size:15px;color:#eff5fc}.card-expense-summary .fibrazo strong{color:#ffd15a}
      .card-expense-table td .scope-badge{display:inline-flex;padding:3px 7px;border-radius:999px;border:1px solid #25364b;font-size:8px;font-weight:800}.card-expense-table td .scope-badge.fibrazo{color:#ffd66b;border-color:#594719;background:rgba(246,200,68,.08)}.card-expense-table td .scope-badge.personal{color:#83d7ff;border-color:#214e67;background:rgba(34,211,238,.06)}
      .card-select-link{border:0;background:transparent;color:#8bbcff;padding:0;font:inherit;font-weight:800;cursor:pointer;text-align:left}.card-select-link:hover{text-decoration:underline}.credit-card.card-selectable{cursor:pointer;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}.credit-card.card-selectable:hover,.credit-card.card-selectable:focus-visible{transform:translateY(-1px);border-color:#31598b;box-shadow:0 0 0 1px rgba(91,156,255,.12);outline:none}
      .credit-card-scope-meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;margin-top:8px;padding-top:8px;border-top:1px solid #182639}.credit-card-scope-meta span{grid-column:1/-1;color:#667a93;font-size:8px;text-transform:uppercase;font-weight:800;letter-spacing:.04em}.credit-card-scope-meta strong{font-size:9px;color:#b9c8da}.credit-card-scope-meta strong:last-of-type{color:#e8c45a}.credit-card-scope-meta small{grid-column:1/-1;color:#60738b;font-size:8px}
      #cardExpenseScopePanel .card-expense-scroll{max-height:none!important;overflow-x:auto!important;overflow-y:hidden!important;scrollbar-gutter:auto}
      #cardExpenseScopePanel .card-expense-scroll.expanded{max-height:900px!important;overflow-x:auto!important;overflow-y:auto!important;scrollbar-gutter:stable}
      #cardExpenseScopePanel .card-expense-table th[data-expense-sort]{cursor:pointer;user-select:none;transition:background .15s ease,color .15s ease}
      #cardExpenseScopePanel .card-expense-table th[data-expense-sort]:hover{background:#111e2e;color:#a8c9f8}
      #cardExpenseScopePanel .expense-sort-head{display:inline-flex;align-items:center;gap:5px}
      #cardExpenseScopePanel .expense-sort-indicator{min-width:9px;color:#4f6581;font-size:9px}
      #cardExpenseScopePanel .card-expense-table th.sort-active{color:#9fc7ff}
      #cardExpenseScopePanel .card-expense-table th.sort-active .expense-sort-indicator{color:#6ea7ff}
      #cardExpenseScopePanel .card-expense-footer{display:flex;justify-content:center;align-items:center;padding:13px 0 1px}
      #cardExpenseScopePanel .card-expense-more{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:190px;border:1px solid #2b5f9e;background:linear-gradient(180deg,#17345f,#102744);color:#e9f3ff;border-radius:999px;padding:9px 16px;font-size:10px;font-weight:800;cursor:pointer;box-shadow:0 6px 18px rgba(23,105,255,.12);transition:transform .15s ease,border-color .15s ease,background .15s ease}
      #cardExpenseScopePanel .card-expense-more:hover,#cardExpenseScopePanel .card-expense-more:focus-visible{transform:translateY(-1px);border-color:#4f8fe0;background:linear-gradient(180deg,#1d4278,#15315a);outline:none}
      #cardExpenseScopePanel .card-expense-more .rows-hidden{color:#9fc7ff;font-weight:700}
      @media(max-width:900px){.card-expense-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.finance-scope-filter{min-width:0}.card-expense-summary{grid-template-columns:1fr}#cardExpenseScopePanel .card-expense-more{width:100%;min-width:0}}
    `; document.head.appendChild(style);
  }

  function ensureScopeFilter(view) {
    if (!['gastos', 'tarjetas'].includes(view)) return;
    const bar = document.getElementById('sectionFilterBar');
    const grid = bar?.querySelector('.section-filter-grid');
    if (!bar || bar.hidden || !grid) {
      window.__PANEL_ENSURE_FINANCE_SCOPE_BAR__?.(view);
      return;
    }
    let root = grid.querySelector('[data-finance-scope-filter]');
    if (!root) {
      root = document.createElement('div'); root.className = 'finance-scope-filter'; root.dataset.financeScopeFilter = 'true';
      root.innerHTML = `<div class="filter-label-row"><span>Ámbito</span></div><div class="finance-scope-buttons"><button type="button" data-scope="Personal">Personal</button><button type="button" data-scope="FIBRAZO">FIBRAZO</button><button type="button" data-scope="Todos">Todos</button></div>`;
      grid.appendChild(root);
      root.addEventListener('click', event => {
        const button = event.target.closest('[data-scope]'); if (!button) return;
        const next=String(button.dataset.scope || 'Todos');
        if(window.FinanceScopeCore?.setScope) window.FinanceScopeCore.setScope(view,next,{emit:true,source:'finance-scope-card'});
        else {
          scopeState[view]=next;
          window.__FINANCE_SCOPE_FILTER_STATE__=scopeState;
          document.dispatchEvent(new CustomEvent('panel:expense-scope-changed',{detail:{view,scope:next,source:'finance-scope-card'}}));
        }
        updateScopeButtons(root, view);
        schedule();
      });
    }
    updateScopeButtons(root, view);
  }

  function updateScopeButtons(root, view) {
    const selected=window.FinanceScopeCore?.getScope?.(view)||scopeState[view];
    root.querySelectorAll('[data-scope]').forEach(button => button.classList.toggle('active', button.dataset.scope === selected));
  }

  function cardLabel(card) {
    const issuer = String(card?.Emisor || 'Tarjeta').trim(), owner = String(card?.Titular || '').trim();
    return owner ? `${issuer} · ${owner}` : issuer;
  }

  function selectCard(id) {
    if (!id || String(window.__PANEL_ACTIVE_CARD_ID__ || '') === id) return;
    const option = document.querySelector(`.card-specific-option[data-card-id="${CSS.escape(id)}"]`);
    if (option) { option.click(); return; }
    setTimeout(() => document.querySelector(`.card-specific-option[data-card-id="${CSS.escape(id)}"]`)?.click(), 120);
  }

  function wireCreditCards(baseRows) {
    const nodes = [...document.querySelectorAll('#viewRoot .credit-card')];
    nodes.forEach(node => {
      if (node.dataset.scopeCardWired === '1') return;
      const brand = norm(node.querySelector('.credit-brand')?.textContent), owner = norm(node.querySelector('.credit-owner')?.textContent);
      const card = cards.find(item => brand.includes(norm(item.Emisor)) && (!owner || owner.includes(ownerNick(item.Titular)) || ownerNick(item.Titular).includes(owner)));
      if (!card) return;
      node.dataset.scopeCardWired = '1'; node.classList.add('card-selectable'); node.tabIndex = 0; node.title = 'Presiona para filtrar esta tarjeta';
      const activate = () => selectCard(cardId(card));
      node.addEventListener('click', activate);
      node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
      const cardRows = baseRows.filter(row => rowMatchesCard(row, card));
      const personal = cardRows.filter(row => scopeOf(row) === 'Personal').reduce((sum, row) => sum + amount(row), 0);
      const fibrazo = cardRows.filter(row => scopeOf(row) === 'FIBRAZO').reduce((sum, row) => sum + amount(row), 0);
      const meta = document.createElement('div'); meta.className = 'credit-card-scope-meta';
      meta.innerHTML = `<span>Compras del período</span><strong>Personal ${esc(money(personal))}</strong><strong>FIBRAZO ${esc(money(fibrazo))}</strong><small>Presiona la tarjeta para aplicar su filtro</small>`;
      node.appendChild(meta);
    });
  }

  function rowCard(row) {
    return cards.find(card => rowMatchesCard(row, card)) || null;
  }

  function sortValue(row, key, currency) {
    const card = rowCard(row);
    switch (key) {
      case 'date': return rowDate(row)?.getTime() || 0;
      case 'card': return norm(card ? cardLabel(card) : row['Cuenta / Tarjeta'] || '');
      case 'holder': return norm(row.Titular || '');
      case 'scope': return norm(scopeOf(row));
      case 'category': return norm(row['Categoría'] || '');
      case 'subcategory': return norm(row['Subcategoría'] || '');
      case 'description': return norm(row['Descripción / Comercio'] || '');
      case 'method': return norm(row['Modalidad de pago'] || 'Crédito');
      case 'installments': return num(row.Cuotas);
      case 'amount': return amount(row, currency);
      default: return '';
    }
  }

  function sortRows(sourceRows, currency) {
    const numericKeys = new Set(['date','installments','amount']);
    return sourceRows.slice().sort((a, b) => {
      const av = sortValue(a, sortKey, currency);
      const bv = sortValue(b, sortKey, currency);
      let comparison;
      if (numericKeys.has(sortKey)) comparison = Number(av || 0) - Number(bv || 0);
      else comparison = String(av).localeCompare(String(bv), 'es', { sensitivity: 'base', numeric: true });
      if (comparison === 0 && sortKey !== 'date') comparison = (rowDate(b)?.getTime() || 0) - (rowDate(a)?.getTime() || 0);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }

  function sortHeader(label, key) {
    const active = sortKey === key;
    const arrow = active ? (sortDirection === 'asc' ? '▲' : '▼') : '↕';
    const aria = active ? `Ordenado ${sortDirection === 'asc' ? 'ascendente' : 'descendente'}` : 'Sin orden activo';
    return `<th data-expense-sort="${esc(key)}" class="${active ? 'sort-active' : ''}" tabindex="0" aria-sort="${active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}" title="Ordenar por ${esc(label)}"><span class="expense-sort-head">${esc(label)} <span class="expense-sort-indicator" aria-label="${esc(aria)}">${arrow}</span></span></th>`;
  }

  function renderCardExpensePanel() {
    if (activeView() !== 'tarjetas') return;
    const root = document.getElementById('viewRoot'); if (!root) return;
    const creditRows = periodRows(rows.filter(isCredit));
    const visibleRows = scopedRows(creditRows, 'tarjetas');
    const personalRows = creditRows.filter(row => scopeOf(row) === 'Personal');
    const fibrazoRows = creditRows.filter(row => scopeOf(row) === 'FIBRAZO');
    const total = creditRows.reduce((sum, row) => sum + amount(row), 0);
    const personal = personalRows.reduce((sum, row) => sum + amount(row), 0);
    const fibrazo = fibrazoRows.reduce((sum, row) => sum + amount(row), 0);
    const visibleTotal = visibleRows.reduce((sum, row) => sum + amount(row), 0);

    const old = root.querySelector('.credit-spend-panel'); if (old) old.hidden = true;
    let host = root.querySelector('#cardExpenseScopePanel');
    if (!host) {
      host = document.createElement('div'); host.id = 'cardExpenseScopePanel'; host.className = 'panel card-expense-scope-panel';
      const kpis = root.querySelector('.kpi-grid'); if (kpis) kpis.insertAdjacentElement('afterend', host); else root.prepend(host);
    }

    const currency = activeCurrency();
    let tableRows = visibleRows.slice();
    if (query) { const q = norm(query); tableRows = tableRows.filter(row => norm(Object.values(row).join(' ')).includes(q)); }
    tableRows = sortRows(tableRows, currency);
    const shown = expanded ? tableRows : tableRows.slice(0, COLLAPSED_ROWS);
    const hiddenCount = Math.max(0, tableRows.length - COLLAPSED_ROWS);
    const active = activeCard();

    host.innerHTML = `<div class="panel-header"><div class="panel-title"><strong>Gastos realizados con tarjeta de crédito</strong><span>${active ? `Tarjeta: ${esc(cardLabel(active))} · ` : ''}${esc(scopeState.tarjetas)} · ${visibleRows.length} movimientos · ${esc(money(visibleTotal, currency))}</span></div><div class="table-toolbar"><input id="cardExpenseSearch" class="search-input" placeholder="Buscar gasto…" value="${esc(query)}"></div></div>
      <div class="card-expense-summary"><div><span>Total crédito</span><strong>${esc(money(total, currency))}</strong></div><div><span>Personal</span><strong>${esc(money(personal, currency))}</strong></div><div class="fibrazo"><span>FIBRAZO</span><strong>${esc(money(fibrazo, currency))}</strong></div></div>
      <div class="table-scroll card-expense-scroll${expanded ? ' expanded' : ''}" style="--card-expense-expanded-rows:${EXPANDED_VISIBLE_ROWS}"><table class="card-expense-table"><thead><tr>${sortHeader('Fecha','date')}${sortHeader('Tarjeta','card')}${sortHeader('Titular','holder')}${sortHeader('Ámbito','scope')}${sortHeader('Categoría','category')}${sortHeader('Subcategoría','subcategory')}${sortHeader('Descripción','description')}${sortHeader('Modalidad','method')}${sortHeader('Cuotas','installments')}${sortHeader(`Monto ${currency}`,'amount')}</tr></thead><tbody>${shown.map(row => {
        const card = rowCard(row), scope = scopeOf(row), date = rowDate(row), dateText = date ? `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}/${date.getFullYear()}` : '—';
        return `<tr><td>${esc(dateText)}</td><td>${card ? `<button type="button" class="card-select-link" data-card-select="${esc(cardId(card))}">${esc(cardLabel(card))}</button>` : esc(row['Cuenta / Tarjeta'] || '—')}</td><td>${esc(row.Titular || '—')}</td><td><span class="scope-badge ${scope === 'FIBRAZO' ? 'fibrazo' : 'personal'}">${esc(scope)}</span></td><td>${esc(row['Categoría'] || '—')}</td><td>${esc(row['Subcategoría'] || '—')}</td><td>${esc(row['Descripción / Comercio'] || '—')}</td><td>${esc(row['Modalidad de pago'] || 'Crédito')}</td><td>${esc(row.Cuotas || '—')}</td><td><strong>${esc(money(amount(row, currency), currency))}</strong></td></tr>`;
      }).join('') || `<tr><td colspan="10"><div class="empty-state"><strong>Sin gastos con crédito para los filtros</strong></div></td></tr>`}</tbody></table></div>
      ${tableRows.length > COLLAPSED_ROWS ? `<div class="card-expense-footer"><button type="button" class="card-expense-more" id="cardExpenseMore">${expanded ? `Ver menos <span class="rows-hidden">· ocultar ${hiddenCount} fila${hiddenCount === 1 ? '' : 's'}</span> ⌃` : `Ver ${hiddenCount} fila${hiddenCount === 1 ? '' : 's'} más <span class="rows-hidden">(${tableRows.length} total)</span> ⌄`}</button></div>` : ''}`;

    host.querySelector('#cardExpenseSearch')?.addEventListener('input', event => { query = event.target.value; expanded = false; renderCardExpensePanel(); requestAnimationFrame(() => { const input = document.getElementById('cardExpenseSearch'); input?.focus(); input?.setSelectionRange(query.length, query.length); }); });
    host.querySelector('#cardExpenseMore')?.addEventListener('click', () => { expanded = !expanded; renderCardExpensePanel(); });
    host.querySelectorAll('[data-card-select]').forEach(button => button.addEventListener('click', () => selectCard(String(button.dataset.cardSelect || ''))));
    host.querySelectorAll('[data-expense-sort]').forEach(header => {
      const applySort = () => {
        const key = String(header.dataset.expenseSort || 'date');
        if (sortKey === key) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        else {
          sortKey = key;
          sortDirection = ['date','amount','installments'].includes(key) ? 'desc' : 'asc';
        }
        renderCardExpensePanel();
      };
      header.addEventListener('click', applySort);
      header.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); applySort(); } });
    });
    wireCreditCards(creditRows);
  }

  async function run() {
    const view = activeView(); if (!['gastos', 'tarjetas'].includes(view)) return;
    injectStyles(); ensureScopeFilter(view);
    await loadData(false);
    if (activeView() !== view) return;
    ensureScopeFilter(view);
    if (view === 'tarjetas') renderCardExpensePanel();
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; run().catch(error => console.error('Ámbito financiero / tarjetas:', error)); });
  }

  document.addEventListener('panel:view-root-changed', event => { if (['gastos','tarjetas'].includes(event.detail?.view)) schedule(); });
  document.addEventListener('panel:section-modules-ready', event => { if (['gastos','tarjetas'].includes(event.detail?.view)) schedule(); });
  document.addEventListener('panel:filters-updated', () => { if (['gastos','tarjetas'].includes(activeView())) schedule(); });
  document.addEventListener('panel:card-filter-changed', event => { if (activeView() === 'tarjetas') { window.__PANEL_ACTIVE_CARD_ID__ = String(event.detail?.cardId || ''); expanded = false; schedule(); } });
  document.addEventListener('panel:backend-data-loaded', () => { payload = null; rows = []; cards = []; if (['gastos','tarjetas'].includes(activeView())) schedule(); });
  document.addEventListener('panel:expense-scope-changed', event => { if (event.detail?.view === 'tarjetas' && activeView() === 'tarjetas') { expanded = false; schedule(); } });

  injectStyles();
  queueMicrotask(schedule);
})();