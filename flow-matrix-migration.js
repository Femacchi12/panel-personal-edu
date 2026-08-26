(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  let cache = null;
  let cacheAt = 0;
  let timer = null;
  let lastRows = [];

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (comma >= 0) {
      const parts = s.split(',');
      s = parts.length === 2 && parts[1].length <= 2 ? parts[0].replace(/\./g, '') + '.' + parts[1] : s.replace(/,/g, '');
    } else if (dot >= 0) {
      const parts = s.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  const money = value => new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0
  }).format(Number(value) || 0);

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((h, i) => [h || `Col ${i + 1}`, row?.[i] ?? ''])));
  }

  function activeView() {
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  function monthKey(value) {
    const s = norm(value);
    let m = s.match(/^(20\d{2})-(\d{1,2})/);
    if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}`;
    m = s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);
    if (!m) return '';
    const map = {ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    return `${m[2]}-${String(map[m[1]]).padStart(2, '0')}`;
  }

  function monthLabel(key) {
    const names = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
    const m = String(key).match(/^(20\d{2})-(\d{2})$/);
    return m ? `${names[+m[2] - 1]} ${m[1]}` : key;
  }

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function isReal(row) {
    if (norm(row.Tipo) !== 'gasto') return false;
    const state = norm(row.Estado);
    if (/proyecc|programad|proyectad/.test(state)) return false;
    return true;
  }

  async function payload(force = false) {
    if (!force && cache && Date.now() - cacheAt < 55_000) return cache;
    const token = await window.__PANEL_GET_ID_TOKEN__?.(false);
    if (!token) throw new Error('Sesión no disponible');
    const response = await fetch(`${apiBaseUrl}/api/data`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Backend ${response.status}`);
    cache = await response.json();
    cacheAt = Date.now();
    return cache;
  }

  function movementRowsFromPayload(p) {
    return parseRows(
      p.sources?.[`${financeId}|Movimientos!A:Z`] ||
      p.sources?.[`${financeId}|Movimientos!A:Y`] ||
      []
    );
  }

  function sumCategory(rows, category, month) {
    return rows
      .filter(r => isReal(r) && norm(r['Categoría']) === norm(category) && monthKey(r['Mes consumo']) === month)
      .reduce((sum, r) => sum + num(r['Monto COP']), 0);
  }

  function rowsForDetail(rows, category, month) {
    return rows
      .filter(r => isReal(r) && norm(r['Categoría']) === norm(category) && monthKey(r['Mes consumo']) === month)
      .sort((a, b) => String(a['Fecha real'] || a['Fecha registrada'] || '').localeCompare(String(b['Fecha real'] || b['Fecha registrada'] || '')));
  }

  function ensureDetailPanel(matrixPanel) {
    let detail = document.getElementById('flowMatrixMigrationDetail');
    if (!detail) {
      detail = document.createElement('div');
      detail.id = 'flowMatrixMigrationDetail';
      detail.className = 'panel table-panel';
      detail.hidden = true;
      matrixPanel.insertAdjacentElement('afterend', detail);
    }
    return detail;
  }

  function renderDetail(matrixPanel, category, month) {
    const rows = rowsForDetail(lastRows, category, month);
    const detail = ensureDetailPanel(matrixPanel);
    const total = rows.reduce((sum, r) => sum + num(r['Monto COP']), 0);
    const columns = ['Fecha real','Categoría','Subcategoría','Descripción / Comercio','Monto original','Moneda original','Cuenta / Tarjeta','Modalidad de pago','Titular','Cuotas','Estado','Monto COP'];
    detail.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">
          <strong>Detalle · ${esc(category)} · ${esc(monthLabel(month))}</strong>
          <span>${rows.length} movimientos realizados · total ${esc(money(total))}</span>
        </div>
        <button type="button" class="text-btn" id="closeFlowMigrationDetail">Cerrar</button>
      </div>
      ${rows.length ? `<div class="table-scroll expanded"><table class="date-first-table"><thead><tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${columns.map(c => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><div><strong>Sin movimientos realizados</strong><span>No hay movimientos realizados para esta categoría y mes.</span></div></div>'}`;
    detail.hidden = false;
    detail.querySelector('#closeFlowMigrationDetail')?.addEventListener('click', () => {
      detail.hidden = true;
      detail.innerHTML = '';
    });
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function findMatrixPanel() {
    const root = document.getElementById('viewRoot');
    if (!root) return null;
    const advanced = root.querySelector('#flowMatrixAdvanced');
    if (advanced && advanced.offsetParent !== null) return advanced;
    return [...root.querySelectorAll('.panel')].find(panel => {
      const title = panel.querySelector('.panel-title strong')?.textContent || panel.querySelector('strong')?.textContent || '';
      return norm(title) === norm('Matriz mensual por categoría');
    }) || null;
  }

  function enhanceAdvanced(panel, rows) {
    const table = panel.querySelector('.flow-matrix-advanced');
    if (!table) return false;
    const current = currentMonthKey();
    panel.querySelectorAll('[data-flow-detail]').forEach(btn => {
      const category = btn.dataset.category || '';
      const month = btn.dataset.month || '';
      if (month === current) btn.textContent = money(sumCategory(rows, category, month));
      btn.dataset.flowMigrationDetail = '1';
    });
    const totalRow = [...table.querySelectorAll('tbody tr')].find(tr => norm(tr.querySelector('.sticky-cat')?.textContent) === norm('Total gastado por categorías'));
    if (totalRow) {
      const monthHeaders = [...table.querySelectorAll('thead tr:first-child th[data-flow-sort-month]')].map(th => th.dataset.flowSortMonth);
      const currentIndex = monthHeaders.indexOf(current);
      if (currentIndex >= 0) {
        const cells = [...totalRow.querySelectorAll('td')];
        const amountCell = cells[2 + currentIndex * 2];
        if (amountCell) amountCell.textContent = money(rows.filter(r => isReal(r) && monthKey(r['Mes consumo']) === current).reduce((s, r) => s + num(r['Monto COP']), 0));
      }
    }
    return true;
  }

  function enhanceBasic(panel, rows) {
    const table = panel.querySelector('table');
    if (!table) return false;
    const headerCells = [...table.querySelectorAll('thead th')];
    if (headerCells.length < 2) return false;
    const monthByIndex = headerCells.map((th, index) => index === 0 ? '' : monthKey(th.textContent));
    const current = currentMonthKey();
    const bodyRows = [...table.querySelectorAll('tbody tr')];
    bodyRows.forEach(tr => {
      const cells = [...tr.querySelectorAll('td')];
      if (cells.length < 2) return;
      const category = cells[0].textContent.trim();
      if (!category || /^total/i.test(category)) return;
      for (let i = 1; i < cells.length && i < monthByIndex.length; i++) {
        const month = monthByIndex[i];
        if (!month) continue;
        const cell = cells[i];
        if (month === current) cell.textContent = money(sumCategory(rows, category, month));
        cell.dataset.flowMigrationDetail = '1';
        cell.dataset.category = category;
        cell.dataset.month = month;
        cell.setAttribute('role', 'button');
        cell.setAttribute('tabindex', '0');
        cell.title = `Ver movimientos de ${category} · ${monthLabel(month)}`;
        cell.style.cursor = 'pointer';
      }
    });
    return true;
  }

  async function run(force = false) {
    if (activeView() !== 'flujo') return;
    const panel = findMatrixPanel();
    if (!panel) return;
    const p = await payload(force).catch(error => {
      console.error('Migración matriz Flujo:', error);
      return null;
    });
    if (!p) return;
    lastRows = movementRowsFromPayload(p);
    if (!enhanceAdvanced(panel, lastRows)) enhanceBasic(panel, lastRows);
  }

  function schedule(force = false, delay = 220) {
    clearTimeout(timer);
    timer = setTimeout(() => run(force), delay);
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-flow-migration-detail], [data-flow-detail]');
    if (target && activeView() === 'flujo') {
      const panel = findMatrixPanel();
      const category = target.dataset.category || '';
      const month = target.dataset.month || '';
      if (panel && category && month) {
        event.preventDefault();
        event.stopPropagation();
        renderDetail(panel, category, month);
        return;
      }
    }
    if (event.target.closest('.nav-item')) schedule(false, 350);
    if (event.target.closest('#refreshBtn')) {
      cache = null; cacheAt = 0;
      schedule(true, 650);
    }
    if (event.target.closest('.currency-btn,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters')) schedule(false, 350);
  }, true);

  document.addEventListener('keydown', event => {
    const target = event.target.closest('[data-flow-migration-detail]');
    if (!target || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    target.click();
  });

  document.addEventListener('panel:filters-updated', () => schedule(false, 300));
  [450, 1000, 1800, 3000].forEach(delay => setTimeout(() => run(false), delay));
})();