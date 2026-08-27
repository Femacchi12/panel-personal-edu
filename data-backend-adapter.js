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

  function isMovementsRange(range) {
    return range === 'Movimientos!A:Z' || range === 'Movimientos!A:Y';
  }

  function applyMovementStateFilter(values, range) {
    if (!isMovementsRange(range) || !Array.isArray(values) || values.length < 2) return values;
    const header = (values[0] || []).map(v => String(v ?? '').trim());
    const statusIndex = header.map(norm).indexOf('estado');
    if (statusIndex < 0) return values;

    const body = values.slice(1).filter(row => {
      const status = norm(row?.[statusIndex]);
      // Real views only. “Programado” remains accepted here solely as legacy compatibility
      // while the canonical future-expense label is now “Proyección”.
      return status !== 'programado' && status !== 'proyeccion';
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

  function resolveSourceValues(payload, spreadsheetId, range) {
    const sources = payload?.sources || {};
    const direct = sources[`${spreadsheetId}|${range}`];
    if (Array.isArray(direct)) return direct;

    // Migration bridge: A:Z is the only canonical Movimientos payload.
    // Legacy modules may still request A:Y, but they now receive the complete A:Z matrix
    // so the extra canonical column is available without maintaining a second data source.
    if (range === 'Movimientos!A:Y') {
      const canonical = sources[`${spreadsheetId}|Movimientos!A:Z`];
      if (Array.isArray(canonical)) return canonical;
    }
    return null;
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

    try {
      const payload = await getBackendData();
      const sourceValues = resolveSourceValues(payload, spreadsheetId, range);
      if (!Array.isArray(sourceValues)) {
        return new Response(JSON.stringify({ error: { message: `Fuente no permitida: ${range}` } }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const actualValues = applyMovementStateFilter(sourceValues, range);
      const values = applySectionFilters(actualValues, range);
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
