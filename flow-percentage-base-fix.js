(() => {
  'use strict';

  let timer = null;
  let applying = false;

  const norm = value => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) s = s.replace(/\./g,'').replace(',','.');
      else s = s.replace(/,/g,'');
    } else if (comma >= 0) {
      const parts = s.split(',');
      s = parts.length === 2 && parts[1].length <= 2 ? parts[0].replace(/\./g,'') + '.' + parts[1] : s.replace(/,/g,'');
    } else if (dot >= 0) {
      const parts = s.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = s.replace(/\./g,'');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function pct(value) {
    return `${new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1}).format((Number(value)||0)*100)}%`;
  }

  function pctClass(value) {
    const p = (Number(value)||0)*100;
    if (p > 15) return 'pct-red';
    if (p > 10) return 'pct-yellow';
    if (p > 5) return 'pct-green';
    return 'pct-white';
  }

  function activeView() {
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  function recalcMatrix() {
    if (applying || activeView() !== 'flujo') return;
    const table = document.querySelector('.flow-matrix-advanced');
    const cards = [...document.querySelectorAll('.salary-reference-grid > div')];
    if (!table || !cards.length) return;

    const bases = cards.map(card => parseNumber(card.querySelector('strong')?.textContent));
    if (!bases.some(v => v > 0)) return;

    applying = true;
    try {
      table.querySelectorAll('tbody tr').forEach(row => {
        bases.forEach((base, monthIndex) => {
          const amountCell = row.cells?.[2 + monthIndex * 2];
          const pctCell = row.cells?.[3 + monthIndex * 2];
          if (!amountCell || !pctCell || !(base > 0)) return;
          const amount = parseNumber(amountCell.textContent);
          const share = amount / base;
          let span = pctCell.querySelector('.matrix-pct');
          if (!span) {
            span = document.createElement('span');
            span.className = 'matrix-pct';
            pctCell.textContent = '';
            pctCell.appendChild(span);
          }
          const next = pct(share);
          if (span.textContent !== next) span.textContent = next;
          span.classList.remove('pct-white','pct-green','pct-yellow','pct-red');
          span.classList.add(pctClass(share));
        });
      });
    } finally {
      applying = false;
    }
  }

  function schedule(delay = 100) {
    clearTimeout(timer);
    timer = setTimeout(recalcMatrix, delay);
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('.nav-item,.multi-filter-option,.currency-btn,#refreshBtn,#resetCurrentMonth,#clearFilters')) {
      [120,350,700,1200].forEach(ms => setTimeout(recalcMatrix, ms));
    }
  }, true);

  const root = document.getElementById('viewRoot');
  if (root) {
    new MutationObserver(mutations => {
      if (applying) return;
      if (mutations.some(m => m.type === 'childList' || m.type === 'characterData')) schedule(120);
    }).observe(root,{childList:true,subtree:true,characterData:true});
  }

  [500,900,1500,2500].forEach(ms => setTimeout(recalcMatrix, ms));
})();