(() => {
  'use strict';

  const MONTHS = {
    ene:'ene', enero:'ene',
    feb:'feb', febrero:'feb',
    mar:'mar', marzo:'mar',
    abr:'abr', abril:'abr',
    may:'may', mayo:'may',
    jun:'jun', junio:'jun',
    jul:'jul', julio:'jul',
    ago:'ago', agosto:'ago',
    sep:'sept', sept:'sept', septiembre:'sept',
    oct:'oct', octubre:'oct',
    nov:'nov', noviembre:'nov',
    dic:'dic', diciembre:'dic'
  };

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .trim();

  function monthToken(value) {
    return MONTHS[norm(value)] || null;
  }

  function padDay(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? String(n).padStart(2,'0') : '';
  }

  function formatDateFirst(raw) {
    const original = String(raw ?? '').trim();
    if (!original) return original;
    const s = norm(original);
    let m;

    m = s.match(/^(20\d{2})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (m) {
      const mon = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'][Number(m[2])-1];
      return mon ? `${m[1]} ${mon}${m[3] ? ` ${padDay(m[3])}` : ''}` : original;
    }

    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
    if (m) {
      const mon = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'][Number(m[2])-1];
      return mon ? `${m[3]} ${mon} ${padDay(m[1])}` : original;
    }

    m = s.match(/^(\d{1,2})[-\s](ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[-\s](20\d{2})$/);
    if (m) {
      const mon = monthToken(m[2]);
      return mon ? `${m[3]} ${mon} ${padDay(m[1])}` : original;
    }

    m = s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[\s\-\/]+(20\d{2})$/);
    if (m) {
      const mon = monthToken(m[1]);
      return mon ? `${m[2]} ${mon}` : original;
    }

    m = s.match(/^(20\d{2})[\s\-\/]+(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)(?:[\s\-\/]+(\d{1,2}))?$/);
    if (m) {
      const mon = monthToken(m[2]);
      return mon ? `${m[1]} ${mon}${m[3] ? ` ${padDay(m[3])}` : ''}` : original;
    }

    m = s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);
    if (m) {
      const mon = monthToken(m[1]);
      return mon ? `${m[2]} ${mon}` : original;
    }

    return original;
  }

  function isDateFirstHeader(text) {
    const h = norm(text);
    return /^(fecha(?:\s|$)|mes(?:\s|$)|periodo(?:\s|$)|período(?:\s|$))/.test(h);
  }

  function processTable(table) {
    if (!(table instanceof HTMLTableElement)) return;
    const firstHeader = table.querySelector('thead th:first-child');
    if (!firstHeader || !isDateFirstHeader(firstHeader.textContent)) {
      table.classList.remove('date-first-table');
      return;
    }

    table.classList.add('date-first-table');
    table.querySelectorAll('tbody tr').forEach(row => {
      const cell = row.cells?.[0];
      if (!cell || cell.dataset.dateFirstNormalized === '1') return;
      const link = cell.querySelector('a');
      if (link) return;
      const formatted = formatDateFirst(cell.textContent);
      if (formatted && formatted !== cell.textContent.trim()) cell.textContent = formatted;
      cell.dataset.dateFirstNormalized = '1';
    });
  }

  function processAll(root = document) {
    root.querySelectorAll?.('table').forEach(processTable);
  }

  function injectStyles() {
    if (document.getElementById('dateFirstTableStyles')) return;
    const style = document.createElement('style');
    style.id = 'dateFirstTableStyles';
    style.textContent = `
      .table-scroll:has(.date-first-table){position:relative}
      .date-first-table th:first-child,
      .date-first-table td:first-child{
        position:sticky!important;
        left:0!important;
        min-width:108px;
        z-index:5;
        box-shadow:10px 0 18px rgba(0,0,0,.18);
      }
      .date-first-table th:first-child{
        z-index:9!important;
        background:#0d1520!important;
      }
      .date-first-table td:first-child{
        background:#0b111a!important;
        color:#dce6f4;
        font-variant-numeric:tabular-nums;
      }
      .date-first-table tbody tr:hover td:first-child{background:#0e1723!important}
      @media(max-width:720px){
        .date-first-table th:first-child,.date-first-table td:first-child{min-width:96px}
      }
    `;
    document.head.appendChild(style);
  }

  injectStyles();
  processAll();

  const root = document.getElementById('viewRoot') || document.body;
  new MutationObserver(mutations => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches?.('table')) processTable(node);
        processAll(node);
      });
    }
  }).observe(root,{childList:true,subtree:false});
})();
