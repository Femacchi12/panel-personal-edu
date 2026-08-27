(() => {
  'use strict';
  let timer=null, applying=false;
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  function panelTitle(panel){return norm(panel?.querySelector?.('.panel-title strong')?.textContent||panel?.querySelector?.('strong')?.textContent||'');}
  function hideElement(el){if(!el)return;el.hidden=true;el.style.display='none';}
  function showGrid(el){if(!el)return;el.hidden=false;el.style.display='grid';}
  function cleanCards(root){if(activeView()!=='tarjetas')return;root.querySelectorAll('.panel').forEach(p=>{if(panelTitle(p)==='uso por tarjeta')hideElement(p);});}

  // GASTOS / FLUJO: mantener solamente la ultima instancia de cada bloque repetido.
  // Se usa textContent del panel como respaldo porque algunos paneles no usan .panel-title.
  function cleanExpenseFlowDuplicates(root){
    const view=activeView();
    if(view!=='gastos'&&view!=='flujo')return;
    const wanted=['gastos programados del mes','comparacion mensual de gasto recurrente y variable'];
    wanted.forEach(w=>{
      const matches=[...root.querySelectorAll('.panel')].filter(p=>{
        const title=panelTitle(p);
        const text=norm(p.textContent).slice(0,220);
        return title===w||title.includes(w)||text.startsWith(w)||text.includes(w);
      });
      matches.slice(0,-1).forEach(hideElement);
    });

    // Quitar Faltante incluido de la tabla de comparacion conservada.
    [...root.querySelectorAll('.panel')].filter(p=>{
      const t=panelTitle(p), text=norm(p.textContent).slice(0,220);
      return t.includes('comparacion mensual de gasto recurrente y variable')||text.includes('comparacion mensual de gasto recurrente y variable');
    }).forEach(panel=>{
      const table=panel.querySelector('table'); if(!table)return;
      const headers=[...table.querySelectorAll('thead th')];
      const idx=headers.findIndex(th=>norm(th.textContent)==='faltante incluido');
      if(idx<0)return;
      headers[idx].style.display='none';
      table.querySelectorAll('tbody tr').forEach(tr=>{if(tr.cells[idx])tr.cells[idx].style.display='none';});
    });
  }

  function isCorePensionGrid(el){if(!el?.classList?.contains('kpi-grid'))return false;const t=norm(el.textContent);return t.includes('pension')&&t.includes('cesantias')&&t.includes('patrimonio')&&t.includes('variacion');}
  function cleanPension(root){if(activeView()!=='pension')return;const head=root.querySelector('.section-head');if(!head)return;const core=[...root.children].find(isCorePensionGrid),v2=root.querySelector('#pensionV2');if(core){showGrid(core);if(head.nextElementSibling!==core)head.insertAdjacentElement('afterend',core);}if(v2){hideElement(v2.querySelector(':scope > .v2-kpis'));const a=core||head;if(a.nextElementSibling!==v2)a.insertAdjacentElement('afterend',v2);}}
  function tableColumnIndex(table,wanted){const target=norm(wanted);return [...(table?.querySelectorAll('thead th')||[])].findIndex(th=>norm(th.textContent)===target);}
  function rowsInfoFromPeriod(period){const pp=[...(period?.querySelectorAll('.panel.table-panel')||[])].find(p=>panelTitle(p).includes('posiciones del periodo'));const table=pp?.querySelector('table');const r={platforms:new Set(),categories:new Set(),dates:[]};if(!table)return r;const pi=tableColumnIndex(table,'Plataforma / Bróker'),ci=tableColumnIndex(table,'Categoría'),di=tableColumnIndex(table,'Fecha');table.querySelectorAll('tbody tr').forEach(row=>{if(pi>=0){const v=String(row.cells[pi]?.textContent||'').trim();if(v)r.platforms.add(v);}if(ci>=0){const v=String(row.cells[ci]?.textContent||'').trim();if(v)r.categories.add(v);}if(di>=0){const v=String(row.cells[di]?.textContent||'').trim();if(v)r.dates.push(v);}});return r;}
  function latestDate(values){const p=values.map(value=>{const text=String(value||'').trim();let m=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return{value:text,time:new Date(+m[1],+m[2]-1,+m[3]).getTime()};m=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return{value:text,time:new Date(+m[3],+m[2]-1,+m[1]).getTime()};const d=new Date(text);return Number.isNaN(d.getTime())?null:{value:text,time:d.getTime()};}).filter(Boolean).sort((a,b)=>b.time-a.time);return p[0]?.value||'—';}
  function selectedLocalLabel(key){const v=[...document.querySelectorAll(`.local-multi-filter[data-local-key="${key}"] .local-option.selected`)].map(el=>String(el.dataset.label||el.dataset.value||el.textContent||'').trim()).filter(Boolean);return v.length===1?v[0]:'';}
  function buildUnifiedInvestmentKpis(v2,period){const original=v2?.querySelector(':scope > .v2-kpis');if(!original)return;const cards=[...original.children],main=cards[0];if(!main)return;const mode=String(main.querySelector('span')?.textContent||'Portafolio').trim(),total=String(main.querySelector('strong')?.textContent||'—').trim(),info=rowsInfoFromPeriod(period),platform=selectedLocalLabel('invPlatform'),category=selectedLocalLabel('invCategory')||selectedLocalLabel('invClass'),pc=info.platforms.size||Math.max(0,cards.length-1),cc=info.categories.size,cut=latestDate(info.dates);let u=v2.querySelector('#investmentUnifiedKpis');if(!u){u=document.createElement('div');u.id='investmentUnifiedKpis';u.className='v2-kpis investment-unified-kpis';v2.prepend(u);}u.innerHTML=`<div class="v2-kpi"><span>Portafolio</span><strong class="green">${total}</strong><small>${mode} · según filtros</small></div><div class="v2-kpi"><span>Plataformas</span><strong>${pc||'—'}</strong><small>${platform||'Según filtros aplicados'}</small></div><div class="v2-kpi"><span>Categorías</span><strong>${cc||'—'}</strong><small>${category||'Según filtros aplicados'}</small></div><div class="v2-kpi"><span>Fecha corte</span><strong>${cut}</strong><small>Último corte disponible</small></div>`;hideElement(original);}
  function cleanInvestments(root){if(activeView()!=='inversiones')return;const head=root.querySelector('.section-head'),v2=root.querySelector('#investmentV2'),period=root.querySelector('#investmentPeriodCorrected'),legacy=root.querySelector('#investmentCorrected');hideElement(legacy);if(v2&&head&&head.nextElementSibling!==v2)head.insertAdjacentElement('afterend',v2);if(period&&v2&&v2.nextElementSibling!==period)v2.insertAdjacentElement('afterend',period);if(v2)buildUnifiedInvestmentKpis(v2,period);if(period){hideElement(period.querySelector(':scope > .investment-kpis, :scope > .kpi-grid'));period.querySelectorAll('.panel').forEach(p=>{const t=panelTitle(p);if(t==='por plataforma')hideElement(p);});}if(v2)v2.querySelectorAll('.panel.table-panel').forEach(p=>{if(panelTitle(p).includes('posiciones consolidadas'))hideElement(p);});[...root.children].forEach(el=>{if(el===v2||el===period||el===head||el.id==='investmentCorrected')return;if(el.classList?.contains('kpi-grid'))hideElement(el);if(el.classList?.contains('panel-grid')){const ts=[...el.querySelectorAll('.panel-title strong')].map(x=>norm(x.textContent));if(ts.some(t=>t==='por plataforma'||t==='por categoria'))hideElement(el);}if(el.classList?.contains('table-panel')){const t=panelTitle(el);if(t==='posiciones'||t.includes('resumen de inversiones'))hideElement(el);}});}
  function apply(){if(applying)return;applying=true;try{const root=document.getElementById('viewRoot');if(!root)return;cleanCards(root);cleanExpenseFlowDuplicates(root);cleanPension(root);cleanInvestments(root);}finally{applying=false;}}
  function schedule(delay=80){clearTimeout(timer);timer=setTimeout(apply,delay);}
  document.addEventListener('click',e=>{if(e.target.closest?.('.nav-item,.multi-filter-option,.local-option,.currency-btn,#refreshBtn,#clearFilters,#clearSectionFilters'))schedule(180);},true);
  const root=document.getElementById('viewRoot');if(root)new MutationObserver(()=>schedule(120)).observe(root,{childList:true,subtree:true});
  if(!document.getElementById('sectionStructureCleanupStyles')){const style=document.createElement('style');style.id='sectionStructureCleanupStyles';style.textContent=`#investmentUnifiedKpis{margin:0}#investmentUnifiedKpis .v2-kpi strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#investmentV2>[hidden],#investmentPeriodCorrected>[hidden]{display:none!important}@media(max-width:720px){#investmentUnifiedKpis .v2-kpi strong{white-space:normal}}`;document.head.appendChild(style);}
  schedule(500);
})();