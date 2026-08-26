(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  let cache = null;
  let cacheAt = 0;

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const money = v => new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(Number(v) || 0);

  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c >= 0 && d >= 0) {
      if (c > d) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (c >= 0) {
      const p = s.split(',');
      s = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g, '') + '.' + p[1] : s.replace(/,/g, '');
    } else if (d >= 0) {
      const p = s.split('.');
      if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const h = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(r => r?.some(v => String(v ?? '').trim() !== ''))
      .map(r => Object.fromEntries(h.map((k, i) => [k || `Col ${i + 1}`, r?.[i] ?? ''])));
  }

  function monthKey(value) {
    const s = norm(value);
    let m = s.match(/^(20\d{2})-(\d{1,2})/);
    if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}`;
    const map = {ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    m = s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);
    return m ? `${m[2]}-${String(map[m[1]]).padStart(2, '0')}` : '';
  }

  function monthLabel(key) {
    const names = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
    const m = String(key).match(/^(20\d{2})-(\d{2})$/);
    return m ? `${names[+m[2] - 1]} ${m[1]}` : key;
  }

  function isReal(row) {
    if (norm(row.Tipo) !== 'gasto') return false;
    return !/proyecc|programad|proyectad/.test(norm(row.Estado));
  }

  function account(row) {
    const raw = String(row['Cuenta / Tarjeta'] || '').trim();
    const n = norm(raw), holder = norm(row.Titular);
    if (n.includes('efectivo')) return 'Efectivo';
    if (n.includes('nequi')) return holder.includes('ro') ? 'Nequi Ro' : 'Nequi Edu';
    if (n.includes('arq')) return 'ARQ Edu';
    if (n.includes('nu')) {
      if (n.includes(' ro') || holder.includes('rocio') || holder === 'ro') return 'Nu Ro';
      return 'Nu Edu';
    }
    return raw || 'Sin especificar';
  }

  function method(row) {
    const explicit = String(row['Modalidad de pago'] || '').trim();
    if (explicit) return explicit;
    const raw = norm(row['Cuenta / Tarjeta']);
    if (raw.includes('credito')) return 'Crédito';
    if (raw.includes('transferencia')) return 'Transferencia';
    if (raw.includes('debito')) return 'Débito';
    if (raw.includes('efectivo')) return 'Efectivo';
    if (num(row.Cuotas) > 0 && (raw.includes('nu') || raw.includes('arq'))) return 'Crédito';
    return 'Sin especificar';
  }

  function selectedGlobal(key) {
    return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
      .map(x => String(x.dataset.value || '').trim())
      .filter(Boolean);
  }

  function filterSnapshot() {
    const cats = selectedGlobal('category');
    const state = window.__PAYMENT_FILTER_STATE__?.view === 'flujo'
      ? window.__PAYMENT_FILTER_STATE__
      : { account: [], method: [] };
    return {
      categories: [...cats],
      accounts: [...(state.account || [])],
      methods: [...(state.method || [])]
    };
  }

  function matchesSnapshot(row, snap) {
    if (!isReal(row)) return false;
    if (snap.categories.length && !snap.categories.includes(String(row['Categoría'] || ''))) return false;
    if (snap.accounts.length && !snap.accounts.includes(account(row))) return false;
    if (snap.methods.length && !snap.methods.includes(method(row))) return false;
    return true;
  }

  async function payload() {
    if (cache && Date.now() - cacheAt < 55000) return cache;
    const token = await window.__PANEL_GET_ID_TOKEN__?.(false);
    if (!token) return null;
    const r = await fetch(`${apiBaseUrl}/api/data`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    if (!r.ok) throw new Error(`Backend ${r.status}`);
    cache = await r.json();
    cacheAt = Date.now();
    return cache;
  }

  function rowsFor(data, range) {
    return parseRows(data?.sources?.[`${financeId}|${range}`] || []);
  }

  function effectiveDate(row) {
    const raw = String(row['Fecha real'] || row['Fecha registrada'] || '');
    const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function ensureHost() {
    const root = document.getElementById('viewRoot');
    if (!root) return null;
    let detail = root.querySelector('#flowMatrixDetailV3');
    if (detail) return detail;
    const matrix = root.querySelector('#flowMatrixV3');
    if (!matrix) return null;
    detail = document.createElement('div');
    detail.id = 'flowMatrixDetailV3';
    detail.className = 'panel table-panel';
    detail.hidden = true;
    matrix.insertAdjacentElement('afterend', detail);
    return detail;
  }

  function filterSummary(snap) {
    const parts = [];
    if (snap.accounts.length) parts.push(`Cuenta: ${snap.accounts.join(' / ')}`);
    if (snap.methods.length) parts.push(`Modalidad: ${snap.methods.join(' / ')}`);
    return parts.length ? ` · ${parts.join(' · ')}` : '';
  }

  function renderDetail(host, rows, cat, key, snap) {
    const total = rows.reduce((s, r) => s + num(r['Monto COP']), 0);
    const cols = ['Fecha real','Categoría','Subcategoría','Descripción / Comercio','Monto original','Moneda original','Cuenta / Tarjeta','Modalidad de pago','Titular','Cuotas','Estado','Monto COP'];
    host.innerHTML = `<div class="panel-header"><div class="panel-title"><strong>Detalle · ${esc(cat)} · ${esc(monthLabel(key))}</strong><span>${rows.length} movimientos realizados · total ${esc(money(total))}${esc(filterSummary(snap))}</span></div><button type="button" class="text-btn" data-close-flow-detail>Cerrar</button></div>${rows.length ? `<div class="table-scroll expanded"><table class="date-first-table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><div><strong>Sin movimientos realizados</strong><span>No hay movimientos para esta categoría, mes y filtros.</span></div></div>'}`;
    host.hidden = false;
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  document.addEventListener('click', async e => {
    const close = e.target.closest('[data-close-flow-detail]');
    if (close) {
      const host = close.closest('#flowMatrixDetailV3');
      if (host) {
        host.hidden = true;
        host.innerHTML = '';
      }
      return;
    }

    const btn = e.target.closest('#flowMatrixV3 .matrix-amount-btn[data-detail]');
    if (!btn) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const cat = String(btn.dataset.category || '').trim();
    const key = String(btn.dataset.month || '').trim();
    if (!cat || !key) return;

    try {
      const snap = filterSnapshot();
      const p = await payload();
      if (!p) return;
      const z = rowsFor(p, 'Movimientos!A:Z');
      const movements = z.length ? z : rowsFor(p, 'Movimientos!A:Y');
      const rows = movements
        .filter(r => matchesSnapshot(r, snap) && norm(r['Categoría']) === norm(cat) && monthKey(r['Mes consumo']) === key)
        .sort((a, b) => (effectiveDate(a)?.getTime() || 0) - (effectiveDate(b)?.getTime() || 0));
      const host = ensureHost();
      if (host) renderDetail(host, rows, cat, key, snap);
    } catch (err) {
      console.error('Detalle matriz Flujo:', err);
    }
  }, true);

  document.addEventListener('click', e => {
    if (e.target.closest('#refreshBtn')) {
      cache = null;
      cacheAt = 0;
    }
  }, true);
})();
