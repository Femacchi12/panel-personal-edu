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

  function median(values) {
    const list = values.map(Number).filter(v => Number.isFinite(v) && v > 0).sort((a,b)=>a-b);
    if (!list.length) return 0;
    const middle = Math.floor(list.length / 2);
    return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
  }

  function monthKey(value) {
    const s = norm(value);
    let m = s.match(/^(20\d{2})-(\d{1,2})/);
    if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}`;
    m = s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);
    if (!m) return '';
    return `${m[2]}-${String(MONTHS[m[1]]).padStart(2, '0')}`;
  }

  function yearOf(key) {
    const m = String(key || '').match(/^(20\d{2})-/);
    return m ? m[1] : '';
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
    const keys = new Set();
    conceptRows.forEach(row => { const key = monthKey(row.Mes); if (key) keys.add(key); });
    detailRows.forEach(row => { const key = monthKey(row.Mes); if (key) keys.add(key); });

    const confirmedSalaryByYear = new Map();
    const confirmedUsdByYear = new Map();
    const confirmedRateByYear = new Map();
    const conceptByMonth = new Map();

    conceptRows.forEach(row => {
      const key = monthKey(row.Mes); if (!key) return;
      conceptByMonth.set(key,row);
      const year = yearOf(key);
      const salary = num(row['Sueldo COP']);
      if (salary > 0) {
        if (!confirmedSalaryByYear.has(year)) confirmedSalaryByYear.set(year,[]);
        confirmedSalaryByYear.get(year).push(salary);
      }
    });

    const usdByMonth = new Map();
    detailRows.forEach(row => {
      const key = monthKey(row.Mes); if (!key) return;
      if (norm(row.Tipo) !== 'ingreso laboral' || norm(row['Moneda original']) !== 'usd') return;
      usdByMonth.set(key,(usdByMonth.get(key)||0)+num(row['Valor original']));
    });

    usdByMonth.forEach((amount,key) => {
      if (amount <= 0) return;
      const year = yearOf(key);
      if (!confirmedUsdByYear.has(year)) confirmedUsdByYear.set(year,[]);
      confirmedUsdByYear.get(year).push(amount);
      const equiv = num(conceptByMonth.get(key)?.['Sueldo USD (equiv. COP)']);
      if (equiv > 0) {
        if (!confirmedRateByYear.has(year)) confirmedRateByYear.set(year,[]);
        confirmedRateByYear.get(year).push(equiv / amount);
      }
    });

    const allSalary = [...confirmedSalaryByYear.values()].flat();
    const allUsd = [...confirmedUsdByYear.values()].flat();
    const allRates = [...confirmedRateByYear.values()].flat();
    const bases = new Map();

    keys.forEach(key => {
      const year = yearOf(key);
      const concept = conceptByMonth.get(key) || {};
      const copActual = num(concept['Sueldo COP']);
      const usdActual = usdByMonth.get(key) || 0;
      const usdEquivActual = num(concept['Sueldo USD (equiv. COP)']);

      const salaryEstimate = median(confirmedSalaryByYear.get(year) || []) || median(allSalary);
      const usdEstimate = median(confirmedUsdByYear.get(year) || []) || median(allUsd) || 1300;
      const rateEstimate = median(confirmedRateByYear.get(year) || []) || median(allRates) || 3150;

      const copEffective = copActual > 0 ? copActual : salaryEstimate;
      const usdEffective = usdActual > 0 ? usdActual : usdEstimate;
      const usdEquivEffective = usdEquivActual > 0 ? usdEquivActual : usdEffective * rateEstimate;
      const copEstimated = !(copActual > 0) && copEffective > 0;
      const usdEstimated = !(usdActual > 0 && usdEquivActual > 0) && usdEffective > 0 && usdEquivEffective > 0;

      bases.set(key, {
        copRegular: copEffective,
        usdRegular: usdEffective,
        usdEquiv: usdEquivEffective,
        total: copEffective + usdEquivEffective,
        complete: copActual > 0 && usdActual > 0 && usdEquivActual > 0,
        copEstimated,
        usdEstimated,
        usable: copEffective > 0 && usdEquivEffective > 0
      });
    });
    return bases;
  }

  function renderCards(bases) {
    const grid = document.querySelector('.salary-reference-grid');
    if (!grid) return false;
    const cards = [...grid.children];
    let estimatedCount = 0;

    cards.forEach(card => {
      const label = card.querySelector('span')?.textContent || '';
      const key = monthKey(label);
      const base = bases.get(key);
      if (!base || !base.usable) return;

      if (base.complete) {
        card.dataset.incomeBaseComplete = '1';
        card.dataset.incomeBaseEstimated = '0';
        card.innerHTML = `
          <span>${esc(label)}</span>
          <strong>${esc(cop(base.total))}</strong>
          <small class="income-base-breakdown">Nómina COP ${esc(cop(base.copRegular))}</small>
          <small class="income-base-breakdown">Fibrazo LLC USD ${esc(usd(base.usdRegular))} · ≈ ${esc(cop(base.usdEquiv))}</small>
          <small class="income-base-status income-base-ok">Base regular confirmada</small>`;
      } else {
        estimatedCount += 1;
        card.dataset.incomeBaseComplete = '0';
        card.dataset.incomeBaseEstimated = '1';
        card.innerHTML = `
          <span>${esc(label)}</span>
          <strong>${esc(cop(base.total))}</strong>
          <small class="income-base-breakdown">Nómina COP ${esc(cop(base.copRegular))}${base.copEstimated ? ' · pendiente soporte' : ' · confirmada'}</small>
          <small class="income-base-breakdown">Fibrazo LLC USD ${esc(usd(base.usdRegular))} · ≈ ${esc(cop(base.usdEquiv))}${base.usdEstimated ? ' · pendiente soporte' : ' · confirmado'}</small>
          <small class="income-base-status income-base-estimated">Base estimada · usada para calcular %</small>`;
      }
    });

    const reference = grid.closest('.salary-reference');
    let note = reference?.querySelector('.income-base-note');
    if (reference) {
      if (!note) {
        note = document.createElement('div');
        note.className = 'income-base-note';
        reference.appendChild(note);
      }
      note.textContent = estimatedCount
        ? 'Cuando falta un soporte se usa temporalmente el valor regular histórico del mismo año para calcular los porcentajes. Al ingresar el soporte real, el estimado se reemplaza automáticamente.'
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
      .income-base-estimated{color:#f6c844!important}
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