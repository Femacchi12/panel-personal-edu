(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const DOCUMENTS_ID = String(cfg.documentsSpreadsheetId || '');
  const RANGE = 'Documentos_Master!A:R';
  if (!DOCUMENTS_ID) return;

  let query = '';
  let expiryMode = 'all';
  let periodFilter = 'all';
  let expanded = false;
  let frame = 0;
  let renderVersion = 0;
  const derivedCache = new WeakMap();

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(value => String(value ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(value => String(value ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((header, index) => [header || `Col ${index + 1}`, row?.[index] ?? ''])));
  }

  function rowsFromPayload(payload) {
    const cached = window.__PANEL_GET_CACHED_ROWS__;
    if (typeof cached === 'function') return cached(payload, DOCUMENTS_ID, RANGE);
    return parseRows(payload?.sources?.[`${DOCUMENTS_ID}|${RANGE}`] || []);
  }

  function parseDate(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateLabel(value) {
    const date = parseDate(value);
    if (!date) return String(value || '—');
    return new Intl.DateTimeFormat('es-CO', {day:'2-digit', month:'2-digit', year:'numeric'}).format(date);
  }

  function currentDayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function searchText(row) {
    return [
      row['Área'], row['Categoría'], row['Tipo'], row['Documento'], row['Titular'], row['País / Entidad'],
      row['N.º / Identificación'], row['Dato copiable 2'], row['Fecha documento'], row['Fecha expedición'],
      row['Fecha vencimiento'], row['Período'], row['Estado'], row['Prioridad'], row['Observaciones']
    ].join(' ');
  }

  function areaRank(value) {
    const key = norm(value);
    if (key === 'identidad') return 0;
    if (key === 'personal') return 1;
    if (key === 'laboral') return 2;
    if (key === 'tributario') return 3;
    if (key.includes('pension')) return 4;
    if (key === 'financiero') return 5;
    return 6;
  }

  function computeExpiry(row) {
    const date = parseDate(row['Fecha vencimiento']);
    if (!date) return {kind:'none', days:null};
    const status = norm(row?.Estado);
    if (status.includes('histor') || status.includes('archivo historico')) return {kind:'historical', days:null};
    const today = new Date();
    today.setHours(0,0,0,0);
    date.setHours(0,0,0,0);
    const days = Math.ceil((date - today) / 86400000);
    if (days < 0) return {kind:'expired', days};
    if (days <= 90) return {kind:'soon', days};
    if (days <= 180) return {kind:'watch', days};
    return {kind:'ok', days};
  }

  function derived(row) {
    const day = currentDayKey();
    const previous = derivedCache.get(row);
    if (previous?.day === day) return previous;
    const status = norm(row?.Estado);
    const statusAttention = status === 'por revisar' || status === 'pendiente' || status.includes('pendiente') || status.includes('revisar');
    const expiry = computeExpiry(row);
    const period = String(row['Período'] || '').match(/^(20\d{2})-(\d{2})/);
    const dateRank = parseDate(row['Fecha vencimiento'])?.getTime()
      || parseDate(row['Fecha expedición'])?.getTime()
      || parseDate(row['Fecha documento'])?.getTime()
      || (period ? new Date(Number(period[1]), Number(period[2]) - 1, 1).getTime() : 0);
    const value = {
      day,
      expiry,
      statusAttention,
      attention: statusAttention || ['expired','soon','watch'].includes(expiry.kind),
      areaRank: areaRank(row['Área']),
      dateRank,
      searchable: norm(searchText(row))
    };
    derivedCache.set(row, value);
    return value;
  }

  const expiryState = row => derived(row).expiry;
  const statusNeedsAttention = row => derived(row).statusAttention;
  const isAttention = row => derived(row).attention;

  function sectionFilterState() {
    const state = window.__PANEL_SECTION_FILTERS__;
    const rules = state?.view === 'documentos' ? (state.rules || []) : [];
    const selected = key => new Set((rules.find(rule => rule.key === key)?.values || []).map(norm).filter(Boolean));
    return {
      area:selected('documentArea'),
      category:selected('documentCategory'),
      type:selected('documentType'),
      holder:selected('documentHolder'),
      status:selected('documentStatus'),
      entity:selected('documentEntity')
    };
  }

  function fieldMatches(value, selected) {
    return !selected.size || selected.has(norm(value));
  }

  function matchesSectionFilters(row, state) {
    return fieldMatches(row['Área'], state.area)
      && fieldMatches(row['Categoría'], state.category)
      && fieldMatches(row['Tipo'], state.type)
      && fieldMatches(row['Titular'], state.holder)
      && fieldMatches(row['Estado'], state.status)
      && fieldMatches(row['País / Entidad'], state.entity);
  }

  function sortRows(rows) {
    return rows.slice().sort((a, b) => {
      const priorityA = norm(a.Prioridad) === 'alta' ? 0 : 1;
      const priorityB = norm(b.Prioridad) === 'alta' ? 0 : 1;
      if (priorityA !== priorityB) return priorityA - priorityB;
      const da = derived(a), db = derived(b);
      const attentionA = da.attention ? 0 : 1;
      const attentionB = db.attention ? 0 : 1;
      if (attentionA !== attentionB) return attentionA - attentionB;
      const area = da.areaRank - db.areaRank;
      if (area) return area;
      const date = db.dateRank - da.dateRank;
      if (date) return date;
      return String(a.Documento || '').localeCompare(String(b.Documento || ''), 'es', {numeric:true, sensitivity:'base'});
    });
  }

  function periodOptions(rows) {
    return [...new Set(rows.map(row => String(row['Período'] || '').trim()).filter(Boolean))]
      .sort((a, b) => b.localeCompare(a, 'es', {numeric:true, sensitivity:'base'}));
  }

  function copyMarkup(value, label) {
    const text = String(value || '').trim();
    if (!text) return '<span class="doc-empty">—</span>';
    return `<div class="doc-copy-cell"><span>${esc(text)}</span><button type="button" class="doc-copy-btn" data-copy="${esc(text)}" aria-label="Copiar ${esc(label)}">Copiar</button></div>`;
  }

  function expirationMarkup(row) {
    const value = String(row['Fecha vencimiento'] || '').trim();
    if (!value) return '<span class="doc-empty">—</span>';
    const state = expiryState(row);
    let detail = '';
    if (state.kind === 'historical') detail = 'Histórico';
    else if (state.kind === 'expired') detail = 'Vencido';
    else if (state.kind === 'soon' || state.kind === 'watch') detail = `${state.days} días`;
    return `<div class="doc-expiry ${state.kind}"><span>${esc(dateLabel(value))}</span>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;
  }

  function rowMarkup(row) {
    const url = String(row['URL directa'] || '').trim();
    const meta = [row['Categoría'], row['Tipo']].filter(Boolean).join(' · ');
    const priority = String(row['Prioridad'] || '').trim();
    const statusClass = statusNeedsAttention(row) ? ' attention' : '';
    return `<tr>
      <td><div class="doc-name"><div><span class="doc-area">${esc(row['Área'] || '—')}</span>${priority ? `<span class="doc-area">${esc(priority)}</span>` : ''}</div><strong>${esc(row['Documento'] || row['Tipo'] || 'Documento')}</strong><span>${esc(meta)}</span></div></td>
      <td>${esc(row['Titular'] || '—')}</td>
      <td>${esc(row['País / Entidad'] || '—')}</td>
      <td>${copyMarkup(row['N.º / Identificación'], 'identificación')}</td>
      <td>${copyMarkup(row['Dato copiable 2'], 'dato')}</td>
      <td>${esc(dateLabel(row['Fecha documento']))}</td>
      <td>${esc(dateLabel(row['Fecha expedición']))}</td>
      <td>${expirationMarkup(row)}</td>
      <td>${esc(row['Período'] || '—')}</td>
      <td><span class="doc-status${statusClass}">${esc(row['Estado'] || '—')}</span></td>
      <td>${url ? `<a class="doc-open-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir</a>` : '<span class="doc-empty">—</span>'}</td>
    </tr>`;
  }

  function applyLocalFilters(sourceRows) {
    const q = norm(query);
    const rows = sourceRows.filter(row => {
      if (q && !derived(row).searchable.includes(q)) return false;
      if (periodFilter !== 'all' && String(row['Período'] || '').trim() !== periodFilter) return false;
      if (expiryMode === 'dated' && !String(row['Fecha vencimiento'] || '').trim()) return false;
      if (expiryMode === 'attention' && !isAttention(row)) return false;
      return true;
    });
    return sortRows(rows);
  }

  function summaryMarkup(sectionRows, totalRows) {
    let withId=0, withExpiry=0, alertCount=0;
    sectionRows.forEach(row => {
      if (String(row['N.º / Identificación'] || '').trim()) withId++;
      if (String(row['Fecha vencimiento'] || '').trim()) withExpiry++;
      if (isAttention(row)) alertCount++;
    });
    const scope = sectionRows.length === totalRows ? 'documentos' : `filtrados de ${totalRows}`;
    return `<div class="documents-summary" aria-label="Resumen documental">
      <span><strong>${sectionRows.length}</strong> ${scope}</span>
      <span><strong>${withId}</strong> con ID</span>
      <span><strong>${withExpiry}</strong> con vencimiento</span>
      <span class="${alertCount ? 'attention' : ''}"><strong>${alertCount}</strong> por revisar</span>
    </div>`;
  }

  function renderHost(host, sourceRows) {
    const state = sectionFilterState();
    const sectionRows = sourceRows.filter(row => matchesSectionFilters(row, state));
    const periods = periodOptions(sectionRows);
    if (periodFilter !== 'all' && !periods.includes(periodFilter)) periodFilter = 'all';
    const rows = applyLocalFilters(sectionRows);
    const visible = expanded ? rows : rows.slice(0, 30);
    const totalSuffix = sectionRows.length === sourceRows.length ? '' : ` · ${sourceRows.length} total`;

    host.innerHTML = `
      ${summaryMarkup(sectionRows, sourceRows.length)}
      <div class="panel table-panel documents-master-panel">
        <div class="panel-header documents-toolbar">
          <div class="panel-title"><strong>Índice de documentos</strong><span id="documentsMasterCount">${rows.length} visibles de ${sectionRows.length}${totalSuffix}</span></div>
          <div class="documents-actions">
            <label class="documents-search"><span>Buscar</span><input id="documentsMasterSearch" class="search-input" type="search" placeholder="Documento, número, titular, entidad…" value="${esc(query)}"></label>
            <label class="documents-scope"><span>Período</span><select id="documentsPeriodFilter"><option value="all" ${periodFilter === 'all' ? 'selected' : ''}>Todos</option>${periods.map(period => `<option value="${esc(period)}" ${periodFilter === period ? 'selected' : ''}>${esc(period)}</option>`).join('')}</select></label>
            <label class="documents-scope"><span>Vigencia / atención</span><select id="documentsExpiryMode"><option value="all" ${expiryMode === 'all' ? 'selected' : ''}>Todos</option><option value="dated" ${expiryMode === 'dated' ? 'selected' : ''}>Con vencimiento</option><option value="attention" ${expiryMode === 'attention' ? 'selected' : ''}>Por revisar</option></select></label>
          </div>
        </div>
        <div class="table-scroll expanded documents-table-scroll">
          <table class="documents-master-table">
            <thead><tr><th>Documento</th><th>Titular</th><th>País / Entidad</th><th>N.º / ID</th><th>Dato 2</th><th>Fecha doc.</th><th>Expedición</th><th>Vencimiento</th><th>Período</th><th>Estado</th><th>Archivo</th></tr></thead>
            <tbody>${visible.length ? visible.map(rowMarkup).join('') : '<tr><td colspan="11"><div class="empty-state"><strong>Sin documentos para mostrar</strong><span>Ajusta la búsqueda o los filtros de la sección.</span></div></td></tr>'}</tbody>
          </table>
        </div>
        ${rows.length > 30 ? `<button type="button" class="show-more" id="documentsMasterMore">${expanded ? 'Ver menos' : `Ver más (${rows.length - 30})`}</button>` : ''}
      </div>`;

    host.querySelector('#documentsMasterSearch')?.addEventListener('input', event => {
      query = event.target.value;
      expanded = false;
      renderHost(host, sourceRows);
      requestAnimationFrame(() => {
        const input = host.querySelector('#documentsMasterSearch');
        if (input) {
          input.focus();
          input.setSelectionRange(query.length, query.length);
        }
      });
    });
    host.querySelector('#documentsPeriodFilter')?.addEventListener('change', event => {
      periodFilter = String(event.target.value || 'all');
      expanded = false;
      renderHost(host, sourceRows);
    });
    host.querySelector('#documentsExpiryMode')?.addEventListener('change', event => {
      expiryMode = String(event.target.value || 'all');
      expanded = false;
      renderHost(host, sourceRows);
    });
    host.querySelector('#documentsMasterMore')?.addEventListener('click', () => {
      expanded = !expanded;
      renderHost(host, sourceRows);
    });
    host.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
      const value = String(button.dataset.copy || '');
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        const previous = button.textContent;
        button.textContent = 'Copiado';
        button.classList.add('copied');
        setTimeout(() => {
          if (!button.isConnected) return;
          button.textContent = previous;
          button.classList.remove('copied');
        }, 1100);
      } catch (error) {
        console.error('No se pudo copiar el dato documental:', error);
      }
    }));
  }

  async function run() {
    if (activeView() !== 'documentos') return;
    const host = document.getElementById('documentsMasterHost');
    if (!host) return;
    const version = ++renderVersion;
    const getData = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getData !== 'function') {
      host.innerHTML = '<div class="empty-state"><strong>Fuente documental no disponible</strong><span>Actualiza el dashboard para volver a cargar la base documental.</span></div>';
      return;
    }
    try {
      const payload = await getData(false);
      if (version !== renderVersion || activeView() !== 'documentos' || !host.isConnected) return;
      renderHost(host, rowsFromPayload(payload));
    } catch (error) {
      console.error('Documentos_Master:', error);
      if (version !== renderVersion || !host.isConnected) return;
      host.innerHTML = `<div class="empty-state"><strong>No se pudo cargar Documentos_Master</strong><span>${esc(error?.message || error)}</span></div>`;
    }
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      run();
    });
  }

  document.addEventListener('panel:view-root-changed', event => { if (event.detail?.view === 'documentos') schedule(); });
  document.addEventListener('panel:section-filters-changed', event => { if (event.detail?.view === 'documentos') schedule(); });
  document.addEventListener('panel:backend-data-loaded', () => { if (activeView() === 'documentos') schedule(); });
  document.addEventListener('panel:modules-ready', () => { if (activeView() === 'documentos') schedule(); });
  queueMicrotask(schedule);
})();