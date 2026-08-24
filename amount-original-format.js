(() => {
  'use strict';

  const HEADER = 'monto original';

  function normalize(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function parseAmount(raw) {
    let s = String(raw ?? '').trim();
    if (!s || s.includes('$')) return null;

    s = s.replace(/\s+/g, '').replace(/[^0-9,.-]/g, '');
    if (!s) return null;

    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');

    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
      const decimals = s.length - lastDot - 1;
      if (decimals === 3 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      else s = s.replace(/,/g, '');
    } else {
      s = s.replace(/[.,]/g, '');
    }

    const value = Number(s);
    return Number.isFinite(value) ? value : null;
  }

  function formatAmount(raw) {
    const value = parseAmount(raw);
    if (value === null) return raw;

    const source = String(raw ?? '').trim();
    const hasDecimals = /[,.]\d{1,2}$/.test(source);
    const decimals = hasDecimals ? Math.min(2, (source.match(/[,.](\d{1,2})$/)?.[1] || '').length) : 0;

    return `$${value.toLocaleString('es-CO', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    })}`;
  }

  function applyToTable(table) {
    const headers = [...table.querySelectorAll('thead th')];
    const index = headers.findIndex(th => normalize(th.textContent) === HEADER);
    if (index < 0) return;

    table.querySelectorAll('tbody tr').forEach(row => {
      const cell = row.children[index];
      if (!cell || cell.dataset.amountOriginalFormatted === '1') return;
      const formatted = formatAmount(cell.textContent);
      if (formatted !== cell.textContent) cell.textContent = formatted;
      cell.dataset.amountOriginalFormatted = '1';
    });
  }

  function apply() {
    document.querySelectorAll('table').forEach(applyToTable);
  }

  const observer = new MutationObserver(() => requestAnimationFrame(apply));

  function init() {
    apply();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
