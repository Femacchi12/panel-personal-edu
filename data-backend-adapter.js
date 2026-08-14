(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  if (!apiBaseUrl) return;

  const originalFetch = window.fetch.bind(window);
  let dataPromise = null;
  let cacheUntil = 0;

  async function getBackendData() {
    const now = Date.now();
    if (dataPromise && now < cacheUntil) return dataPromise;

    dataPromise = (async () => {
      const getIdToken = window.__PANEL_GET_ID_TOKEN__;
      if (typeof getIdToken !== 'function') {
        throw new Error('No hay sesión Firebase disponible');
      }
      const idToken = await getIdToken(false);
      if (!idToken) throw new Error('No se pudo obtener el token de sesión');

      const response = await originalFetch(`${apiBaseUrl}/api/data`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${idToken}` },
        cache: 'no-store'
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${response.status} ${response.statusText}: ${body}`);
      }
      return response.json();
    })();

    cacheUntil = now + 55_000;
    try {
      return await dataPromise;
    } catch (error) {
      dataPromise = null;
      cacheUntil = 0;
      throw error;
    }
  }

  window.fetch = async function(input, init) {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    if (!rawUrl || !rawUrl.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')) {
      return originalFetch(input, init);
    }

    const url = new URL(rawUrl);
    const match = url.pathname.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/);
    if (!match) return originalFetch(input, init);

    const spreadsheetId = decodeURIComponent(match[1]);
    const range = decodeURIComponent(match[2]);
    const key = `${spreadsheetId}|${range}`;

    try {
      const payload = await getBackendData();
      const values = payload?.sources?.[key];
      if (!Array.isArray(values)) {
        return new Response(JSON.stringify({ error: { message: `Fuente no permitida: ${range}` } }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({
        range,
        majorDimension: 'ROWS',
        values
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: { message: String(error?.message || error) } }), {
        status: 502,
        statusText: 'Backend Error',
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };
})();
