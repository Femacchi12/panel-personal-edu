(() => {
  'use strict';
  let timer=null, applying=false;
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  function panelTitle(panel){return norm(panel?.querySelector?.('.panel-title strong')?.textContent||panel?.querySelector?.('strong')?.textContent||'');}
  function hideElement(el){if(!el)return;if(!el.hidden)el.hidden=true;if(el.style.display!=='none')el.style.display='none';}
  function showGrid(el){if(!el)return;el.hidden=false;el.style.display='grid';}
  function cleanCards(root){if(activeView()!=='tarjetas')return;root.querySelectorAll('.panel').forEach(p=>{if(panelTitle(p)==='uso por tarjeta')hideElement(p);});}

  function parseMoney(text){
    let s=String(text??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
    else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }
  const money=v=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);

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

  // Una sola fórmula para la tarjeta Total considerado en Gastos y Flujo.
  // Con proyección activa: Real + Proyección pendiente + Faltante recurrente.
  // Sin proyección o en mes histórico: solo Real.
  function syncMonthlyConsidered(root){
    const view=activeView();if(view!=='gastos'&&view!=='flujo')return;
    const panel=root.querySelector('#monthlyProjectionSuite .monthly-close-panel');if(!panel)return;
    const cards=[...panel.querySelectorAll('.monthly-kpis > div')];if(cards.length<4)return;
    const real=parseMoney(cards[0].querySelector('strong')?.textContent);
    const projection=parseMoney(cards[1].querySelector('strong')?.textContent);
    const gap=parseMoney(cards[2].querySelector('strong')?.textContent);
    const toggle=panel.querySelector('#monthlyProjectionToggle');
    const on=Boolean(toggle&&toggle.checked);
    const expected=on?real+projection+gap:real;
    const total=cards[3],strong=total.querySelector('strong'),small=total.querySelector('small');
    if(strong&&Math.abs(parseMoney(strong.textContent)-expected)>=.5)strong.textContent=money(expected);
    total.classList.toggle('projected',on);total.classList.toggle('actual',!on);
    if(small){const text=on?'Real + proyección + faltante recurrente':'Solo gasto real';if(small.textContent!==text)small.textContent=text;}
  }

  function isCorePensionGrid(el){if(!el?.classList?.contains('kpi-grid'))return false;const t=norm(el.textContent);return t.includes('pension')&&t.includes('cesantias')&&t.includes('patrimonio')&&t.includes('variacion');}
  function cleanPension(root){if(activeView()!=='pension')return;const head=root.querySelector('.section-head');if(!head)return;const core=[...root.children].find(isCorePensionGrid),v2=root.querySelector('#pensionV2');if(core){showGrid(core);if(head.nextElementSibling!==core)head.insertAdjacentElement('afterend',core);}if(v2){hideElement(v2.querySelector(':scope > .v2-kpis'));const a=core||head;if(a.nextElementSibling!==v2)a.insertAdjacentElement('afterend',v2);}}

  // INVERSIONES: investment-period-enhancement.js es el único renderer oficial.
  // Aquí solo se eliminan/esconden restos del renderer base/legacy.
  function cleanInvestments(root){
    if(activeView()!=='inversiones')return;
    document.querySelectorAll('#investmentV2ModeFilter').forEach(el=>el.remove());
    const official=root.querySelector('#investmentPeriodCorrected');
    hideElement(root.querySelector('#investmentCorrected'));
    hideElement(root.querySelector('#investmentV2'));
    [...root.children].forEach(el=>{
      if(el===official||el===root.querySelector('.section-head')||el.id==='investmentSummaryOverview'||el.id==='investmentCorrected'||el.id==='investmentV2')return;
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

  function injectInvestmentGuard(){
    if(document.getElementById('investmentImmediateLegacyGuard'))return;
    const style=document.createElement('style');style.id='investmentImmediateLegacyGuard';style.textContent=`
      body:has(.nav-item.active[data-view="inversiones"]) #viewRoot > #investmentCorrected,
      body:has(.nav-item.active[data-view="inversiones"]) #viewRoot > #investmentV2{display:none!important}
      body:has(.nav-item.active[data-view="inversiones"]) #viewRoot > .kpi-grid{display:none!important}
      body:has(.nav-item.active[data-view="inversiones"]) #viewRoot > .panel-grid{display:none!important}
      body:has(.nav-item.active[data-view="inversiones"]) #viewRoot > .table-panel{display:none!important}
      body:has(.nav-item.active[data-view="inversiones"]) #viewRoot > #investmentPeriodCorrected,
      body:has(.nav-item.active[data-view="inversiones"]) #viewRoot > #investmentSummaryOverview{display:grid!important}
    `;document.head.appendChild(style);
  }

  function apply(){if(applying)return;applying=true;try{const root=document.getElementById('viewRoot');if(!root)return;cleanCards(root);cleanExpenseFlowDuplicates(root);syncMonthlyConsidered(root);cleanPension(root);cleanInvestments(root);}finally{applying=false;}}
  function schedule(delay=80){clearTimeout(timer);timer=setTimeout(apply,delay);}
  document.addEventListener('click',e=>{if(e.target.closest?.('.nav-item,.multi-filter-option,.local-option,.currency-btn,#refreshBtn,#clearFilters,#clearSectionFilters,#monthlyProjectionToggle'))schedule(180);},true);
  const root=document.getElementById('viewRoot');if(root)new MutationObserver(()=>schedule(90)).observe(root,{childList:true,subtree:true});
  const sectionFilters=document.getElementById('sectionFilterBar');if(sectionFilters)new MutationObserver(()=>schedule(30)).observe(sectionFilters,{childList:true,subtree:true});
  injectInvestmentGuard();schedule(500);
})();