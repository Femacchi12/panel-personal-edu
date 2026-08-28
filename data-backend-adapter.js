(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  if (!apiBaseUrl) return;

  const originalFetch = window.fetch.bind(window);
  let dataPromise = null;
  let cacheUntil = 0;

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  function resetBackendCache() {
    dataPromise = null;
    cacheUntil = 0;
  }

  async function getBackendData(force = false) {
    const now = Date.now();
    if (force) resetBackendCache();
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
      resetBackendCache();
      throw error;
    }
  }

  window.__PANEL_GET_BACKEND_DATA__ = getBackendData;
  window.__PANEL_RESET_BACKEND_DATA__ = resetBackendCache;

  function jsonResponse(payload, status = 200, statusText = 'OK') {
    return new Response(JSON.stringify(payload), {
      status,
      statusText,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function applyMovementStateFilter(values, range) {
    if (range !== 'Movimientos!A:Z' || !Array.isArray(values) || values.length < 2) return values;
    const header = (values[0] || []).map(v => String(v ?? '').trim());
    const statusIndex = header.map(norm).indexOf('estado');
    if (statusIndex < 0) return values;

    const body = values.slice(1).filter(row => {
      const status = row?.[statusIndex];
      return window.MovementStatusCore?.isActual(status) ?? !/proyecc|proyect|programad/.test(norm(status));
    });
    return [values[0], ...body];
  }

  function applySectionFilters(values, range) {
    const filterState = window.__PANEL_SECTION_FILTERS__;
    const rules = Array.isArray(filterState?.rules) ? filterState.rules : [];
    const activeRules = rules.filter(rule => Array.isArray(rule?.values) && rule.values.length && rule?.ranges?.[range]);
    if (!activeRules.length || !Array.isArray(values) || values.length < 2) return values;

    const header = (values[0] || []).map(v => String(v ?? '').trim());
    const headerNorm = header.map(norm);

    const compiled = activeRules.map(rule => {
      const fields = Array.isArray(rule.ranges[range]) ? rule.ranges[range] : [];
      const indexes = fields
        .map(field => headerNorm.indexOf(norm(field)))
        .filter(index => index >= 0);
      return {
        indexes,
        selected: new Set(rule.values.map(norm))
      };
    }).filter(rule => rule.indexes.length);

    if (!compiled.length) return values;

    const body = values.slice(1).filter(row => compiled.every(rule => {
      return rule.indexes.some(index => rule.selected.has(norm(row?.[index])));
    }));

    return [values[0], ...body];
  }

  window.fetch = async function(input, init) {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    const normalizedUrl = String(rawUrl || '').replace(/\/$/, '');

    if (normalizedUrl === `${apiBaseUrl}/api/data` && method === 'GET') {
      try {
        const payload = await getBackendData(false);
        return jsonResponse(payload);
      } catch (error) {
        return jsonResponse({ error: { message: String(error?.message || error) } }, 502, 'Backend Error');
      }
    }

    if (!rawUrl || !rawUrl.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')) {
      return originalFetch(input, init);
    }

    const url = new URL(rawUrl);
    const match = url.pathname.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/);
    if (!match) return originalFetch(input, init);

    const spreadsheetId = decodeURIComponent(match[1]);
    const range = decodeURIComponent(match[2]);

    try {
      const payload = await getBackendData();
      const sourceValues = payload?.sources?.[`${spreadsheetId}|${range}`];
      if (!Array.isArray(sourceValues)) {
        return jsonResponse({ error: { message: `Fuente no permitida: ${range}` } }, 404, 'Not Found');
      }

      const actualValues = applyMovementStateFilter(sourceValues, range);
      const values = applySectionFilters(actualValues, range);
      return jsonResponse({
        range,
        majorDimension: 'ROWS',
        values
      });
    } catch (error) {
      return jsonResponse({ error: { message: String(error?.message || error) } }, 502, 'Backend Error');
    }
  };

  document.addEventListener('click', event => {
    if (event.target.closest?.('#refreshBtn')) resetBackendCache();
  }, true);
})();