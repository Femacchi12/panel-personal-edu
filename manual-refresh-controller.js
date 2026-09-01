(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  if (!apiBaseUrl) return;

  let refreshing = false;

  function refreshButtons() {
    return [...document.querySelectorAll('#refreshBtn, [data-general-refresh]')];
  }

  function setRefreshingState(active) {
    refreshButtons().forEach(button => {
      if (active) {
        if (!button.dataset.refreshPreviousText) button.dataset.refreshPreviousText = button.textContent || '';
        button.disabled = true;
        button.classList.add('is-refreshing');
        button.textContent = '↻ Actualizando…';
      } else {
        button.disabled = false;
        button.classList.remove('is-refreshing');
        if (button.dataset.refreshPreviousText) {
          button.textContent = button.dataset.refreshPreviousText;
          delete button.dataset.refreshPreviousText;
        }
      }
    });
  }

  async function refreshFromSource(event) {
    const trigger = event.target?.closest?.('#refreshBtn, [data-general-refresh]');
    if (!trigger) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (refreshing) return;

    refreshing = true;
    setRefreshingState(true);

    try {
      window.__PANEL_RESET_BACKEND_DATA__?.();
      const getIdToken = window.__PANEL_GET_ID_TOKEN__;
      if (typeof getIdToken !== 'function') throw new Error('Sesión no disponible para actualizar');
      const token = await getIdToken(false);
      if (!token) throw new Error('No se pudo validar la sesión');

      const response = await window.fetch(`${apiBaseUrl}/api/data?refresh=1`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${response.status} ${response.statusText}: ${body}`);
      }
      await response.json();

      window.__PANEL_RESET_BACKEND_DATA__?.();
      document.dispatchEvent(new CustomEvent('panel:backend-refresh-requested', { detail: { forced: true } }));
      if (typeof window.__PANEL_RELOAD_DATA__ === 'function') await window.__PANEL_RELOAD_DATA__(false);
      document.dispatchEvent(new CustomEvent('panel:manual-refresh-complete'));
    } catch (error) {
      console.error('Actualización manual forzada:', error);
      window.__PANEL_RESET_BACKEND_DATA__?.();
      document.dispatchEvent(new CustomEvent('panel:backend-refresh-requested', { detail: { forced: false, fallback: true } }));
      if (typeof window.__PANEL_RELOAD_DATA__ === 'function') await window.__PANEL_RELOAD_DATA__(true);
    } finally {
      refreshing = false;
      setRefreshingState(false);
    }
  }

  document.addEventListener('click', refreshFromSource, true);
})();