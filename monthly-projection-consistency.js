(() => {
  'use strict';

  let timer = null;
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function parseMoney(text) {
    const raw = String(text ?? '').replace(/[^\d,.-]/g, '').trim();
    if (!raw) return 0;
    let s = raw;
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

  const money = value => new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0
  }).format(Number(value) || 0);

  function sync() {
    const view = activeView();
    if (view !== 'gastos' && view !== 'flujo') return;
    const panel = document.querySelector('#monthlyProjectionSuite .monthly-close-panel');
    if (!panel) return;
    const cards = [...panel.querySelectorAll('.monthly-kpis > div')];
    if (cards.length < 4) return;

    const real = parseMoney(cards[0].querySelector('strong')?.textContent);
    const projection = parseMoney(cards[1].querySelector('strong')?.textContent);
    const gap = parseMoney(cards[2].querySelector('strong')?.textContent);
    const toggle = panel.querySelector('#monthlyProjectionToggle');
    const currentMonth = Boolean(toggle);
    const includeProjection = currentMonth && Boolean(toggle?.checked);
    const expected = includeProjection ? real + projection + gap : real;

    const totalCard = cards[3];
    const strong = totalCard.querySelector('strong');
    const small = totalCard.querySelector('small');
    if (strong && Math.abs(parseMoney(strong.textContent) - expected) >= 0.5) {
      strong.textContent = money(expected);
    }
    totalCard.classList.toggle('projected', includeProjection);
    totalCard.classList.toggle('actual', !includeProjection);
    if (small) small.textContent = includeProjection ? 'Real + proyección + faltante recurrente' : 'Solo gasto real';
  }

  function schedule(delay = 520) {
    clearTimeout(timer);
    timer = setTimeout(sync, delay);
  }

  document.addEventListener('click', event => {
    if (event.target.closest('.nav-item,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters,#monthlyProjectionToggle')) schedule();
    if (event.target.closest('#refreshBtn')) schedule(900);
  }, true);
  document.addEventListener('panel:payment-filters-changed', () => schedule(420));
  document.addEventListener('panel:monthly-projection-change', () => schedule(80));
  document.addEventListener('panel:filters-updated', () => schedule(420));

  setTimeout(sync, 1800);
})();
