(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  if (!apiBaseUrl) return;

  let refreshing = false;
  let boundButton = null;

  async function refreshFromSource(event) {
    const button = event.currentTarget;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (refreshing) return;

    refreshing = true;
    const previousDisabled = Boolean(button.disabled);
    button.disabled = true;
    button.classList.add('is-refreshing');

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
      button.classList.remove('is-refreshing');
      button.disabled = previousDisabled;
    }
  }

  function bind() {
    const button = document.getElementById('refreshBtn');
    if (!button || button === boundButton) return;
    if (boundButton) boundButton.removeEventListener('click', refreshFromSource, true);
    boundButton = button;
    button.addEventListener('click', refreshFromSource, true);
  }

  bind();
  document.addEventListener('panel:modules-ready', bind);
  document.addEventListener('panel:view-root-changed', bind);
})();
