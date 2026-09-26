(() => {
  'use strict';

  let frame = 0;

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function injectStyles() {
    if (document.getElementById('flowMatrixPolishStyles')) return;
    const style = document.createElement('style');
    style.id = 'flowMatrixPolishStyles';
    style.textContent = `
      #flowMatrixV3{
        overflow:hidden;
        border:1px solid #1a2b40;
        background:linear-gradient(180deg,rgba(13,22,34,.98),rgba(8,14,23,.98));
        box-shadow:0 12px 34px rgba(0,0,0,.12);
      }
      #flowMatrixV3>.panel-header{
        padding:15px 16px 13px;
        margin:0;
        border-bottom:1px solid #17263a;
        background:linear-gradient(180deg,rgba(17,30,47,.78),rgba(11,20,32,.35));
      }
      #flowMatrixV3>.panel-header .panel-title strong{
        font-size:15px;
        letter-spacing:-.015em;
        color:#f2f7ff;
      }
      #flowMatrixV3>.panel-header .panel-title span{
        margin-top:4px;
        color:#7890ad;
        line-height:1.45;
      }
      #flowMatrixV3 #flowOriginalOrderV3{
        border:1px solid #263c59;
        border-radius:999px;
        padding:7px 11px;
        background:#0e1928;
        color:#8fb9ef;
        font-size:9px;
        font-weight:800;
        transition:background .15s ease,border-color .15s ease,color .15s ease;
      }
      #flowMatrixV3 #flowOriginalOrderV3:hover{
        background:#13243a;
        border-color:#35618e;
        color:#c6ddff;
      }
      #flowMatrixV3 .flow-matrix-scroll{
        border:0!important;
        border-radius:0!important;
        background:#09111b;
      }
      #flowMatrixV3 .flow-matrix-advanced{
        font-size:11px;
      }
      #flowMatrixV3 .flow-matrix-advanced th,
      #flowMatrixV3 .flow-matrix-advanced td{
        padding:10px 12px;
        border-right:1px solid #132033;
        border-bottom:1px solid #152235;
      }
      #flowMatrixV3 .flow-matrix-advanced thead th{
        background:#0d1826!important;
        color:#78aef9;
        font-size:8px;
        font-weight:800;
        letter-spacing:.065em;
      }
      #flowMatrixV3 .flow-matrix-advanced thead tr:first-child th[colspan="2"]{
        background:linear-gradient(180deg,#102038,#0d1928)!important;
        color:#9bc4ff;
        font-size:9px;
        padding-top:11px;
        padding-bottom:11px;
        border-bottom:1px solid #264362;
      }
      #flowMatrixV3 .flow-matrix-advanced thead tr:nth-child(2) th{
        background:#0b1521!important;
        color:#648bbd;
      }
      #flowMatrixV3 .flow-matrix-advanced .sticky-id{
        min-width:50px;
        width:50px;
        color:#667b95;
        background:#0b151f!important;
      }
      #flowMatrixV3 .flow-matrix-advanced .sticky-cat{
        min-width:190px;
        background:#0b151f!important;
        box-shadow:10px 0 18px rgba(0,0,0,.18);
      }
      #flowMatrixV3 .flow-matrix-advanced tbody tr.matrix-category-row td{
        background:#0a131e;
        transition:background .12s ease;
      }
      #flowMatrixV3 .flow-matrix-advanced tbody tr.matrix-category-row:nth-child(even) td{
        background:#0c1622;
      }
      #flowMatrixV3 .flow-matrix-advanced tbody tr.matrix-category-row:hover td{
        background:#101e2e;
      }
      #flowMatrixV3 .flow-matrix-advanced tbody tr.matrix-category-row:hover .sticky-id,
      #flowMatrixV3 .flow-matrix-advanced tbody tr.matrix-category-row:hover .sticky-cat{
        background:#101e2e!important;
      }
      #flowMatrixV3 .matrix-category-row .sticky-id{
        font-size:9px;
        font-weight:700;
      }
      #flowMatrixV3 .matrix-category-row .sticky-cat{
        color:#c6d3e3;
        font-weight:600;
      }
      #flowMatrixV3 .matrix-amount-btn{
        color:#e7eef8;
        font-weight:700;
        border-radius:6px;
        padding:4px 6px;
        margin:-4px -6px;
        transition:background .12s ease,color .12s ease;
      }
      #flowMatrixV3 .matrix-amount-btn:hover,
      #flowMatrixV3 .matrix-amount-btn:focus-visible{
        background:rgba(70,132,217,.12);
        color:#83b9ff;
        text-decoration:none;
        outline:none;
      }
      #flowMatrixV3 .matrix-pct{
        display:inline-flex;
        align-items:center;
        justify-content:flex-end;
        min-width:49px;
        border-radius:999px;
        padding:3px 7px;
        background:rgba(255,255,255,.025);
      }
      #flowMatrixV3 .matrix-pct.pct-green{background:rgba(38,208,124,.08)}
      #flowMatrixV3 .matrix-pct.pct-yellow{background:rgba(246,200,68,.08)}
      #flowMatrixV3 .matrix-pct.pct-red{background:rgba(255,102,122,.08)}
      #flowMatrixV3 .matrix-total-row td{
        background:#10233a!important;
        border-top:2px solid #2d5b8e;
        border-bottom:1px solid #274661;
        color:#eef6ff;
        font-weight:800;
      }
      #flowMatrixV3 .matrix-total-row .sticky-id,
      #flowMatrixV3 .matrix-total-row .sticky-cat{
        background:#10233a!important;
      }
      #flowMatrixV3 .matrix-total-row .sticky-cat{
        color:#9ecaff;
      }
      #flowMatrixV3 .matrix-summary-row td{
        background:#0b1520!important;
        color:#b5c3d4;
      }
      #flowMatrixV3 .matrix-summary-row .sticky-id,
      #flowMatrixV3 .matrix-summary-row .sticky-cat{
        background:#0b1520!important;
      }
      #flowMatrixV3 .matrix-summary-start td{
        border-top:10px solid #08111a;
      }
      #flowMatrixV3 .matrix-summary-row .sticky-cat{
        font-size:10px;
        font-weight:700;
        color:#8296ae;
      }
      #flowMatrixV3 .matrix-summary-total td{
        background:#101f31!important;
        color:#f0f6ff;
        font-weight:800;
        border-top:1px solid #294665;
      }
      #flowMatrixV3 .matrix-summary-total .sticky-id,
      #flowMatrixV3 .matrix-summary-total .sticky-cat{
        background:#101f31!important;
      }
      #flowMatrixV3 .matrix-summary-total .sticky-cat{
        color:#a8cfff;
      }
      #flowMatrixV3 .salary-reference{
        margin:14px 14px 0;
        padding:13px;
        border-color:#1d3047;
        background:#0a141f;
      }
      #flowMatrixV3 .salary-reference>strong{
        color:#dbe7f5;
        font-size:11px;
      }
      #flowMatrixV3 .salary-reference-grid{
        gap:7px;
      }
      #flowMatrixV3 .salary-reference-grid>div{
        border:1px solid #18283b;
        background:#0d1926;
        min-width:155px;
      }
      #flowMatrixV3 .salary-reference-grid>div strong{
        color:#edf4fc;
        font-size:12px;
      }
      #flowMatrixV3 .matrix-color-legend{
        margin:10px 14px 14px;
        gap:7px;
      }
      #flowMatrixV3 .matrix-color-legend span{
        display:inline-flex;
        align-items:center;
        min-height:24px;
        padding:4px 8px;
        border:1px solid #1a2b40;
        border-radius:999px;
        background:#0b1520;
        color:#71859d;
        font-size:9px;
      }
      #flowMatrixDetailV3{
        border-color:#1c3048;
      }
      @media(max-width:760px){
        #flowMatrixV3>.panel-header{align-items:flex-start;gap:10px;flex-wrap:wrap}
        #flowMatrixV3 .flow-matrix-advanced th,#flowMatrixV3 .flow-matrix-advanced td{padding:9px 10px}
        #flowMatrixV3 .flow-matrix-advanced .sticky-cat{min-width:160px}
      }
    `;
    document.head.appendChild(style);
  }

  function syncRows(host) {
    const body = host.querySelector('.flow-matrix-advanced tbody');
    if (!body) return;
    const rows = [...body.querySelectorAll(':scope > tr')];
    let firstSummary = true;
    rows.forEach(row => {
      if (row.classList.contains('matrix-total-row')) return;
      if (row.classList.contains('matrix-summary-row')) {
        row.classList.remove('matrix-summary-start','matrix-summary-total');
        if (firstSummary) {
          row.classList.add('matrix-summary-start');
          firstSummary = false;
        }
        const label = norm(row.querySelector('.sticky-cat')?.textContent);
        if (label === 'egresos totales') row.classList.add('matrix-summary-total');
        return;
      }
      row.classList.add('matrix-category-row');
    });
  }

  function sync() {
    if (activeView() !== 'flujo') return;
    injectStyles();
    const host = document.getElementById('flowMatrixV3');
    if (!host) return;
    syncRows(host);
  }

  function schedule() {
    if (activeView() !== 'flujo' || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  }

  document.addEventListener('panel:view-root-changed', event => {
    if (event.detail?.view === 'flujo') schedule();
  });
  document.addEventListener('panel:section-modules-ready', event => {
    if (event.detail?.view === 'flujo') schedule();
  });
  document.addEventListener('panel:flow-matrix-v3-rendered', schedule);
  document.addEventListener('panel:filters-updated', schedule);
  document.addEventListener('panel:payment-filters-changed', event => {
    if (event.detail?.view === 'flujo') schedule();
  });

  injectStyles();
  queueMicrotask(schedule);
})();