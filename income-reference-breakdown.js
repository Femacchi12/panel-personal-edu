(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  const MONTHS = {
    ene:1, enero:1, feb:2, febrero:2, mar:3, marzo:3, abr:4, abril:4,
    may:5, mayo:5, jun:6, junio:6, jul:7, julio:7, ago:8, agosto:8,
    sep:9, sept:9, septiembre:9, oct:10, octubre:10, nov:11, noviembre:11,
    dic:12, diciembre:12
  };

  let cache = null;
  let cacheAt = 0;
  let timer = null;
  let applying = false;

  const norm = value => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (comma >= 0) {
      const p = s.split(',');
      s = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g, '') + '.' + p[1] : s.replace(/,/g, '');
    } else if (dot >= 0) {
      const p = s.split('.');
      if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function monthKey(value) {
    const s = norm(value);
    let m = s.match(/^(20\d{2})-(\d{1,2})/);
    if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}`;
    m = s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);
    if (!m) return '';
    return `${m[2]}-${String(MONTHS[m[1]]).padStart(2, '0')}`;
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((h, i) => [h || `Col ${i + 1}`, row?.[i] ?? ''])));
  }

  const cop = value => new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0
  }).format(Number(value) || 0);

  const usd = value => new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: Number(value) % 1 ? 2 : 0,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);

  async function payload(force = false) {
    if (!force && cache && Date.now() - cacheAt < 55_000) return cache;
    const token = await window.__PANEL_GET_ID_TOKEN__?.(false);
    if (!token) return null;
    const response = await fetch(`${apiBaseUrl}/api/data`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Backend ${response.status}`);
    cache = await response.json();
    cacheAt = Date.now();
    return cache;
  }

  function buildBases(data) {
    const conceptRows = parseRows(data?.sources?.[`${financeId}|Resumen_Conceptos_Ingresos!A:L`] || []);
    const detailRows = parseRows(data?.sources?.[`${financeId}|Detalle_Ingresos!A:L`] || []);
    const bases = new Map();

    conceptRows.forEach(row => {
      const key = monthKey(row.Mes);
      if (!key) return;
      const copRegular = num(row['Sueldo COP']);
      const usdEquiv = num(row['Sueldo USD (equiv. COP)']);
      const usdRegular = detailRows
        .filter(detail => monthKey(detail.Mes) === key && norm(detail.Tipo) === 'ingreso laboral' && norm(detail['Moneda original']) === 'usd')
        .reduce((sum, detail) => sum + num(detail['Valor original']), 0);
      bases.set(key, {
        copRegular,
        usdRegular,
        usdEquiv,
        total: copRegular + usdEquiv,
        complete: copRegular > 0 && usdRegular > 0 && usdEquiv > 0
      });
    });
    return bases;
  }

  function blankIncompletePercentages(grid, cards, bases) {
    const incompleteIndexes = cards
      .map((card, index) => ({ index, key: monthKey(card.querySelector('span')?.textContent) }))
      .filter(item => item.key && bases.has(item.key) && !bases.get(item.key).complete)
      .map(item => item.index);

    if (!incompleteIndexes.length) return;
    const table = document.querySelector('.flow-matrix-advanced');
    if (!table) return;
    table.querySelectorAll('tbody tr').forEach(row => {
      incompleteIndexes.forEach(monthIndex => {
        const pctCell = row.cells?.[3 + monthIndex * 2];
        if (pctCell) pctCell.innerHTML = '<span class="matrix-pct pct-white">—</span>';
      });
    });
  }

  function renderCards(bases) {
    const grid = document.querySelector('.salary-reference-grid');
    if (!grid) return false;
    const cards = [...grid.children];
    let incomplete = 0;

    cards.forEach(card => {
      const label = card.querySelector('span')?.textContent || '';
      const key = monthKey(label);
      const base = bases.get(key);
      if (!base) return;

      if (base.complete) {
        card.dataset.incomeBaseComplete = '1';
        card.innerHTML = `
          <span>${esc(label)}</span>
          <strong>${esc(cop(base.total))}</strong>
          <small class="income-base-breakdown">Nómina COP ${esc(cop(base.copRegular))}</small>
          <small class="income-base-breakdown">Fibrazo LLC USD ${esc(usd(base.usdRegular))} · ≈ ${esc(cop(base.usdEquiv))}</small>
          <small class="income-base-status income-base-ok">Base regular confirmada</small>`;
      } else {
        incomplete += 1;
        card.dataset.incomeBaseComplete = '0';
        card.innerHTML = `
          <span>${esc(label)}</span>
          <strong>Base incompleta</strong>
          <small class="income-base-breakdown">Nómina COP ${base.copRegular > 0 ? esc(cop(base.copRegular)) : '· soporte pendiente'}</small>
          <small class="income-base-breakdown">Fibrazo LLC USD ${base.usdRegular > 0 ? esc(usd(base.usdRegular)) : '· pendiente'}${base.usdEquiv > 0 ? ` · ≈ ${esc(cop(base.usdEquiv))}` : ''}</small>
          <small class="income-base-status income-base-pending">No se usa para calcular % hasta completar</small>`;
      }
    });

    blankIncompletePercentages(grid, cards, bases);
    const reference = grid.closest('.salary-reference');
    let note = reference?.querySelector('.income-base-note');
    if (reference) {
      if (!note) {
        note = document.createElement('div');
        note.className = 'income-base-note';
        reference.appendChild(note);
      }
      note.textContent = incomplete
        ? 'Los meses con base incompleta quedan sin porcentaje hasta contar con ambos componentes regulares.'
        : 'Base regular = nómina COP + Fibrazo LLC USD regular. Extras, primas, cesantías y devoluciones no se incluyen en estos porcentajes.';
    }
    return true;
  }

  async function apply(force = false) {
    if (applying || document.querySelector('.nav-item.active')?.dataset.view !== 'flujo') return;
    if (!document.querySelector('.salary-reference-grid')) return;
    applying = true;
    try {
      const data = await payload(force);
      if (!data) return;
      renderCards(buildBases(data));
    } catch (error) {
      console.error('Detalle de ingreso regular:', error);
    } finally {
      applying = false;
    }
  }

  function schedule(force = false, delay = 220) {
    clearTimeout(timer);
    timer = setTimeout(() => apply(force), delay);
  }

  function injectStyles() {
    if (document.getElementById('incomeReferenceBreakdownStyles')) return;
    const style = document.createElement('style');
    style.id = 'incomeReferenceBreakdownStyles';
    style.textContent = `
      .salary-reference-grid>div{min-width:205px!important}
      .income-base-breakdown{display:block;line-height:1.35;color:#94a3b8!important}
      .income-base-status{display:block;margin-top:3px;font-weight:700}
      .income-base-ok{color:#26d07c!important}
      .income-base-pending{color:#f6c844!important}
      .income-base-note{margin-top:10px;padding-top:9px;border-top:1px solid #162236;color:#8291a6;font-size:10px;line-height:1.4}
    `;
    document.head.appendChild(style);
  }

  injectStyles();
  document.addEventListener('click', event => {
    if (event.target.closest('[data-view="flujo"],#refreshBtn')) {
      if (event.target.closest('#refreshBtn')) { cache = null; cacheAt = 0; }
      schedule(Boolean(event.target.closest('#refreshBtn')), 450);
    }
  });

  const root = document.getElementById('viewRoot');
  if (root) new MutationObserver(() => schedule(false, 260)).observe(root, { childList: true, subtree: true });
  schedule(false, 500);
})();