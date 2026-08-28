(() => {
  'use strict';

  let timer = null;

  const norm = value => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0){if(comma>dot)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
    else if(comma>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(dot>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function activeView() {
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  // Search inside every filter: some layout CSS can override the native hidden attribute.
  function applyFilterSearch(input) {
    const root=input?.closest('.multi-filter');
    if (!root) return;
    const q=norm(input.value);
    root.querySelectorAll('.multi-filter-option').forEach(option=>{
      const label=option.dataset.value || option.dataset.label || option.textContent || '';
      const visible=!q || norm(label).includes(q);
      option.hidden=!visible;
      if (visible) option.style.removeProperty('display');
      else option.style.setProperty('display','none','important');
    });
  }

  document.addEventListener('input',event=>{
    const input=event.target.closest?.('.multi-filter-search');
    if (input) applyFilterSearch(input);
  },true);

  // Keep monthly planning/comparison after the main Gastos/Flujo content.
  function moveMonthlyPanels() {
    const view=activeView();
    if (!['gastos','flujo'].includes(view)) return;
    const root=document.getElementById('viewRoot');
    const suite=document.getElementById('monthlyProjectionSuite');
    if (!root || !suite) return;
    const programmed=suite.querySelector('.monthly-programmed-panel');
    const comparison=suite.querySelector('.monthly-comparison-panel');
    if (!programmed && !comparison) return;

    [...root.children].forEach(el=>{
      if ((el.classList?.contains('monthly-programmed-panel') || el.classList?.contains('monthly-comparison-panel')) && el!==programmed && el!==comparison) el.remove();
    });

    const target=[programmed,comparison].filter(Boolean);
    const children=[...root.children];
    const alreadyAtEnd=target.every((el,index)=>children[children.length-target.length+index]===el);
    if (alreadyAtEnd) return;
    target.forEach(el=>root.appendChild(el));
  }

  // Automatic total footer in the detail opened from the monthly matrix.
  const formatMoney=(value,currency)=>new Intl.NumberFormat('es-CO',{
    style:'currency',currency,maximumFractionDigits:currency==='USD'?2:0
  }).format(Number(value)||0);

  function addFlowDetailTotal() {
    const table=document.querySelector('#flowMatrixDetail table');
    if (!table) return;
    const headers=[...table.querySelectorAll('thead th')].map(th=>norm(th.textContent));
    const indexes={cop:headers.indexOf('monto cop'),ars:headers.indexOf('monto ars'),usd:headers.indexOf('monto usd')};
    if (indexes.cop<0) return;
    const rows=[...table.querySelectorAll('tbody tr')];
    const sums={cop:0,ars:0,usd:0};
    rows.forEach(row=>{
      if(indexes.cop>=0)sums.cop+=parseNumber(row.cells[indexes.cop]?.textContent);
      if(indexes.ars>=0)sums.ars+=parseNumber(row.cells[indexes.ars]?.textContent);
      if(indexes.usd>=0)sums.usd+=parseNumber(row.cells[indexes.usd]?.textContent);
    });

    let foot=table.querySelector('tfoot[data-auto-total]');
    if(!foot){foot=document.createElement('tfoot');foot.dataset.autoTotal='1';table.appendChild(foot);}
    let tr=foot.querySelector('tr');
    if(!tr){tr=document.createElement('tr');tr.className='flow-detail-total-row';foot.appendChild(tr);}
    while(tr.children.length<headers.length)tr.appendChild(document.createElement('td'));
    while(tr.children.length>headers.length)tr.lastElementChild?.remove();

    headers.forEach((_,index)=>{
      const td=tr.children[index];
      let value='';
      if(index===0)value='TOTAL';
      if(index===indexes.cop)value=formatMoney(sums.cop,'COP');
      if(index===indexes.ars)value=formatMoney(sums.ars,'ARS');
      if(index===indexes.usd)value=formatMoney(sums.usd,'USD');
      if(td&&td.textContent!==value)td.textContent=value;
    });
  }

  function runFixes(){
    moveMonthlyPanels();
    addFlowDetailTotal();
    document.querySelectorAll('.multi-filter-search').forEach(input=>{if(input.value)applyFilterSearch(input);});
  }
  function schedule(delay=80){clearTimeout(timer);timer=setTimeout(runFixes,delay);}

  document.addEventListener('click',event=>{
    const target=event.target;
    if(target.closest?.('.card-specific-option,.card-specific-clear,#clearSectionFilters,[data-card-line-mode],.currency-btn,.multi-filter-option,#clearFilters,#resetCurrentMonth')) schedule(70);
    if(target.closest?.('[data-flow-detail]')) schedule(120);
    if(target.closest?.('.nav-item,#refreshBtn')) schedule(220);
  },true);

  const root=document.getElementById('viewRoot');
  if(root)new MutationObserver(()=>schedule(90)).observe(root,{childList:true,subtree:false});

  if(!document.getElementById('dashboardReliabilityFixStyles')){
    const style=document.createElement('style');style.id='dashboardReliabilityFixStyles';style.textContent=`
      #flowMatrixDetail tfoot[data-auto-total] td{font-weight:800;color:#f4f7fb;border-top:2px solid #2a3a50;background:#0d1622;white-space:nowrap}
      #flowMatrixDetail tfoot[data-auto-total] td:first-child{color:#26d07c;letter-spacing:.06em}
    `;document.head.appendChild(style);
  }

  schedule(400);
})();