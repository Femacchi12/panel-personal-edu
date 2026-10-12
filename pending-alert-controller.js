(() => {
  'use strict';

  const PREFIX = 'Dashboard pendiente ';
  const MATRIX_URL = 'https://docs.google.com/spreadsheets/d/1v9zs6FuLWBhQnbB2rXJpIVIqwEPg-x0ypD0SywlkOWY/edit';

  const byId = id => document.getElementById(id);
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  function configValue(row, names) {
    for (const name of names) {
      if (row && Object.prototype.hasOwnProperty.call(row, name)) return row[name];
    }
    return '';
  }

  function parseItem(row) {
    const parameter = String(configValue(row, ['Parámetro','Parametro']) || '').trim();
    if (!parameter.startsWith(PREFIX)) return null;

    const status = String(configValue(row, ['Valor']) || '').trim();
    if (norm(status) !== 'pendiente') return null;

    const fallbackId = parameter.slice(PREFIX.length).trim();
    const raw = String(configValue(row, ['Descripción','Descripcion']) || '').trim();
    let detail = {};
    try { detail = raw ? JSON.parse(raw) : {}; } catch (_) { detail = { pendiente: raw }; }

    return {
      id: String(detail.id || fallbackId || 'Pendiente').trim(),
      area: String(detail.area || 'General').trim(),
      title: String(detail.pendiente || detail.titulo || fallbackId || 'Pendiente').trim(),
      when: String(detail.cuando || '').trim(),
      action: String(detail.accion || '').trim(),
      notes: String(detail.notas || '').trim()
    };
  }

  function activeItems() {
    const rows = window.__PANEL_APP_DATA__?.configFinanzas;
    if (!Array.isArray(rows)) return [];
    return rows.map(parseItem).filter(Boolean).sort((a,b) => a.id.localeCompare(b.id,'es',{numeric:true}));
  }

  function itemHtml(item) {
    const when = item.when ? `<div class="pending-alert-meta"><span>Cuándo</span><strong>${esc(item.when)}</strong></div>` : '';
    const action = item.action ? `<div class="pending-alert-action"><span>Acción</span><p>${esc(item.action)}</p></div>` : '';
    const notes = item.notes ? `<p class="pending-alert-notes">${esc(item.notes)}</p>` : '';
    return `<article class="pending-alert-item">
      <div class="pending-alert-item-head">
        <span class="pending-alert-id">${esc(item.id)}</span>
        <span class="pending-alert-area">${esc(item.area)}</span>
      </div>
      <strong class="pending-alert-title">${esc(item.title)}</strong>
      ${when}
      ${action}
      ${notes}
    </article>`;
  }

  function render() {
    const items = activeItems();
    const button = byId('pendingAlertButton');
    const count = byId('pendingAlertCount');
    const summary = byId('pendingAlertSummary');
    const list = byId('pendingAlertList');
    if (!button || !count || !summary || !list) return;

    const total = items.length;
    count.textContent = String(total);
    button.classList.toggle('has-pending', total > 0);
    button.classList.toggle('is-clear', total === 0);
    button.setAttribute('aria-label', total ? `Abrir ${total} pendiente${total === 1 ? '' : 's'}` : 'Abrir pendientes: ninguno activo');
    button.title = total ? `${total} pendiente${total === 1 ? '' : 's'} activo${total === 1 ? '' : 's'}` : 'Sin pendientes activos';

    summary.textContent = total
      ? `${total} pendiente${total === 1 ? '' : 's'} activo${total === 1 ? '' : 's'}`
      : 'Sin pendientes activos';

    list.innerHTML = total
      ? items.map(itemHtml).join('')
      : '<div class="pending-alert-empty"><span>✓</span><strong>Todo al día</strong><p>No hay pendientes activos en este momento.</p></div>';
  }

  function setOpen(open) {
    const button = byId('pendingAlertButton');
    const panel = byId('pendingAlertPanel');
    const backdrop = byId('pendingAlertBackdrop');
    if (!button || !panel || !backdrop) return;

    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    backdrop.hidden = !open;
    document.body.classList.toggle('pending-alert-open', open);
    if (open) {
      render();
      requestAnimationFrame(() => byId('pendingAlertClose')?.focus({preventScroll:true}));
    }
  }

  function bind() {
    const button = byId('pendingAlertButton');
    const close = byId('pendingAlertClose');
    const backdrop = byId('pendingAlertBackdrop');
    const openMatrix = byId('pendingAlertOpenMatrix');

    button?.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
    close?.addEventListener('click', () => setOpen(false));
    backdrop?.addEventListener('click', () => setOpen(false));
    openMatrix?.addEventListener('click', () => window.open(MATRIX_URL, '_blank', 'noopener,noreferrer'));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });
  }

  function init() {
    bind();
    render();
    document.addEventListener('panel:app-data-ready', render);
    document.addEventListener('panel:app-data-checked', render);
    document.addEventListener('panel:modules-ready', render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();

  window.__PANEL_REFRESH_PENDING_ALERT__ = render;
})();