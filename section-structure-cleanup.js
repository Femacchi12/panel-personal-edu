(() => {
  'use strict';
  let timer=null, applying=false;
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  function panelTitle(panel){return norm(panel?.querySelector?.('.panel-title strong')?.textContent||panel?.querySelector?.('strong')?.textContent||'');}
  function hideElement(el){if(!el)return;el.hidden=true;el.style.display='none';}
  function showGrid(el){if(!el)return;el.hidden=false;el.style.display='grid';}
  function cleanCards(root){if(activeView()!=='tarjetas')return;root.querySelectorAll('.panel').forEach(p=>{if(panelTitle(p)==='uso por tarjeta')hideElement(p);});}

  // GASTOS / FLUJO: mantener solamente la última instancia de cada bloque repetido.
  function cleanExpenseFlowDuplicates(root){
    const view=activeView();if(view!=='gastos'&&view!=='flujo')return;
    const wanted=['gastos programados del mes','proyecciones del mes','comparacion mensual de gasto recurrente y variable'];
    wanted.forEach(w=>{
      const matches=[...root.querySelectorAll('.panel')].filter(p=>{const title=panelTitle(p),text=norm(p.textContent).slice(0,220);return title===w||title.includes(w)||text.startsWith(w)||text.includes(w);});
      matches.slice(0,-1).forEach(hideElement);
    });
    [...root.querySelectorAll('.panel')].filter(p=>{const t=panelTitle(p),text=norm(p.textContent).slice(0,220);return t.includes('comparacion mensual de gasto recurrente y variable')||text.includes('comparacion mensual de gasto recurrente y variable');}).forEach(panel=>{
      const table=panel.querySelector('table');if(!table)return;const headers=[...table.querySelectorAll('thead th')],idx=headers.findIndex(th=>norm(th.textContent)==='faltante incluido');if(idx<0)return;headers[idx].style.display='none';table.querySelectorAll('tbody tr').forEach(tr=>{if(tr.cells[idx])tr.cells[idx].style.display='none';});
    });
  }

  function isCorePensionGrid(el){if(!el?.classList?.contains('kpi-grid'))return false;const t=norm(el.textContent);return t.includes('pension')&&t.includes('cesantias')&&t.includes('patrimonio')&&t.includes('variacion');}
  function cleanPension(root){if(activeView()!=='pension')return;const head=root.querySelector('.section-head');if(!head)return;const core=[...root.children].find(isCorePensionGrid),v2=root.querySelector('#pensionV2');if(core){showGrid(core);if(head.nextElementSibling!==core)head.insertAdjacentElement('afterend',core);}if(v2){hideElement(v2.querySelector(':scope > .v2-kpis'));const a=core||head;if(a.nextElementSibling!==v2)a.insertAdjacentElement('afterend',v2);}}

  // INVERSIONES: investment-period-enhancement.js es el único renderer oficial.
  // Aquí solo se esconden restos del renderer base/legacy; nunca se reordenan ni ocultan piezas del renderer oficial.
  function cleanInvestments(root){
    if(activeView()!=='inversiones')return;
    const official=root.querySelector('#investmentPeriodCorrected');
    hideElement(root.querySelector('#investmentCorrected'));
    hideElement(root.querySelector('#investmentV2'));
    [...root.children].forEach(el=>{
      if(el===official||el===root.querySelector('.section-head')||el.id==='investmentCorrected'||el.id==='investmentV2')return;
      if(el.classList?.contains('kpi-grid'))hideElement(el);
      if(el.classList?.contains('panel-grid')){
        const titles=[...el.querySelectorAll('.panel-title strong')].map(x=>norm(x.textContent));
        if(titles.some(t=>t==='por plataforma'||t==='por categoria'))hideElement(el);
      }
      if(el.classList?.contains('table-panel')){
        const t=panelTitle(el);if(t==='posiciones'||t.includes('resumen de inversiones'))hideElement(el);
      }
    });
  }

  function apply(){if(applying)return;applying=true;try{const root=document.getElementById('viewRoot');if(!root)return;cleanCards(root);cleanExpenseFlowDuplicates(root);cleanPension(root);cleanInvestments(root);}finally{applying=false;}}
  function schedule(delay=80){clearTimeout(timer);timer=setTimeout(apply,delay);}
  document.addEventListener('click',e=>{if(e.target.closest?.('.nav-item,.multi-filter-option,.local-option,.currency-btn,#refreshBtn,#clearFilters,#clearSectionFilters'))schedule(180);},true);
  const root=document.getElementById('viewRoot');if(root)new MutationObserver(()=>schedule(120)).observe(root,{childList:true,subtree:true});
  schedule(500);
})();