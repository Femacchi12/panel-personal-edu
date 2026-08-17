(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  const STORAGE_KEY = 'panel-personal-edu.include-monthly-projection';
  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  let cache = null;
  let cacheAt = 0;
  let timer = null;

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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

  const money = value => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(value)||0);

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(row=>row?.some(v=>String(v??'').trim()!==''))
      .map(row=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,row?.[i]??''])));
  }

  function monthKey(value) {
    const s=norm(value);let m=s.match(/^(20\d{2})-(\d{1,2})/);if(m)return`${m[1]}-${String(+m[2]).padStart(2,'0')}`;
    m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[\s-]+(20\d{2})/);
    if(m){const map={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};return`${m[2]}-${String(map[m[1]]).padStart(2,'0')}`;}
    return '';
  }

  function previousMonth(key){const m=String(key).match(/^(20\d{2})-(\d{2})$/);if(!m)return'';const d=new Date(+m[1],+m[2]-2,1);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
  function monthLabel(key){const m=String(key).match(/^(20\d{2})-(\d{2})$/);return m?`${MONTHS[+m[2]-1]} ${m[1]}`:key;}

  function parseDate(value){const s=String(value||'').trim();let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);const d=new Date(s);return Number.isNaN(d.getTime())?null:d;}
  function dateLabel(row){const d=parseDate(row['Fecha real']||row['Fecha registrada']);return d?`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`:'—';}

  function selectedGlobal(key){return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(el=>String(el.dataset.value||'').trim()).filter(Boolean);}
  function activeView(){return document.querySelector('.nav-item.active')?.dataset.view||'';}

  function targetMonth(rows){
    const years=selectedGlobal('year');
    const months=selectedGlobal('month').map(Number).filter(n=>n>=1&&n<=12);
    if(years.length===1&&months.length===1)return`${years[0]}-${String(months[0]).padStart(2,'0')}`;
    const now=new Date();
    if(years.length===1&&!months.length){const keys=[...new Set(rows.map(r=>monthKey(r['Mes consumo']||r['Mes pago'])).filter(k=>k.startsWith(`${years[0]}-`)))].sort();if(keys.length)return keys[keys.length-1];}
    return`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }

  function rowMonth(row){return monthKey(row['Mes consumo']||row['Mes pago']||row['Fecha real']||row['Fecha registrada']);}
  function status(row){return norm(row.Estado);}
  function isActual(row){const s=status(row);return norm(row.Tipo)==='gasto' && s!=='programado' && s!=='proyeccion';}
  function isProgrammed(row){return norm(row.Tipo)==='gasto' && status(row)==='programado';}
  function isFixed(row){return /^(si|sí|true|1)$/i.test(String(row['Es fijo']||'').trim());}
  function isSuper(row){return norm(row['Categoría'])==='supermercado';}

  async function payload(force=false){
    if(!force&&cache&&Date.now()-cacheAt<50_000)return cache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false);if(!token)throw new Error('Sesión no disponible');
    const r=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!r.ok)throw new Error(`Backend ${r.status}`);
    cache=await r.json();cacheAt=Date.now();return cache;
  }

  function sum(rows){return rows.reduce((a,r)=>a+parseNumber(r['Monto COP']),0);}

  function monthlyStats(rows,key){
    const prev=previousMonth(key);
    const actual=rows.filter(r=>isActual(r)&&rowMonth(r)===key);
    const previous=rows.filter(r=>isActual(r)&&rowMonth(r)===prev);
    const programmed=rows.filter(r=>isProgrammed(r)&&rowMonth(r)===key).sort((a,b)=>(parseDate(a['Fecha real']||a['Fecha registrada'])?.getTime()||0)-(parseDate(b['Fecha real']||b['Fecha registrada'])?.getTime()||0));

    const groups={
      super:{current:sum(actual.filter(isSuper)),previous:sum(previous.filter(isSuper)),programmed:sum(programmed.filter(isSuper))},
      fixed:{current:sum(actual.filter(isFixed)),previous:sum(previous.filter(isFixed)),programmed:sum(programmed.filter(isFixed))},
      variable:{current:sum(actual.filter(r=>!isFixed(r)&&!isSuper(r))),previous:sum(previous.filter(r=>!isFixed(r)&&!isSuper(r))),programmed:0}
    };
    groups.super.remaining=Math.max(0,groups.super.previous-groups.super.current-groups.super.programmed);
    groups.fixed.remaining=Math.max(0,groups.fixed.previous-groups.fixed.current-groups.fixed.programmed);
    groups.variable.remaining=0;

    const realTotal=sum(actual);
    const programmedTotal=sum(programmed);
    const recurringGap=groups.super.remaining+groups.fixed.remaining;
    return{key,prev,actual,previous,programmed,groups,realTotal,programmedTotal,recurringGap,projectedTotal:realTotal+programmedTotal+recurringGap};
  }

  function includeProjection(){const stored=localStorage.getItem(STORAGE_KEY);return stored===null?true:stored==='1';}
  function setProjection(value){localStorage.setItem(STORAGE_KEY,value?'1':'0');window.__PANEL_INCLUDE_MONTHLY_PROJECTION__=Boolean(value);document.dispatchEvent(new CustomEvent('panel:monthly-projection-change',{detail:{enabled:Boolean(value)}}));}

  function differenceCell(current,previous){
    const diff=current-previous;
    if(Math.abs(diff)<.5)return'<span class="monthly-diff neutral">Igual al mes pasado</span>';
    return diff<0?`<span class="monthly-diff under">Faltan ${esc(money(Math.abs(diff)))}</span>`:`<span class="monthly-diff over">Supera ${esc(money(diff))}</span>`;
  }

  function programmedStatus(row){const d=parseDate(row['Fecha real']||row['Fecha registrada']);if(!d)return'Programado';const now=new Date();now.setHours(0,0,0,0);d.setHours(0,0,0,0);if(d.getTime()===now.getTime())return'Programado hoy';if(d<now)return'Pendiente / fecha cumplida';return'Programado';}

  function comparisonRows(stats){
    return [
      ['Supermercado',stats.groups.super,true],
      ['Gastos fijos / servicios',stats.groups.fixed,true],
      ['Variables sin supermercado',stats.groups.variable,false]
    ].map(([label,g,project])=>`<tr><td><strong>${esc(label)}</strong>${project?'<small>Referencia recurrente para cierre</small>':'<small>Solo comparación; no se proyecta automáticamente</small>'}</td><td>${esc(money(g.current))}</td><td>${esc(money(g.previous))}</td><td>${differenceCell(g.current,g.previous)}</td><td>${project?esc(money(g.remaining)):'—'}</td></tr>`).join('');
  }

  function renderSuite(host,stats){
    const on=includeProjection();
    window.__PANEL_INCLUDE_MONTHLY_PROJECTION__=on;
    const considered=on?stats.projectedTotal:stats.realTotal;
    const programmed=stats.programmed;
    host.innerHTML=`
      <div class="panel monthly-close-panel">
        <div class="panel-header monthly-close-head"><div class="panel-title"><strong>Cierre estimado · ${esc(monthLabel(stats.key))}</strong><span>Separa gasto real de lo que todavía falta o está programado.</span></div>
          <label class="monthly-switch"><input type="checkbox" id="monthlyProjectionToggle" ${on?'checked':''}><span></span><b>Incluir proyección de cierre</b></label></div>
        <div class="monthly-kpis">
          <div><span>Real hasta hoy</span><strong>${esc(money(stats.realTotal))}</strong><small>Solo movimientos registrados</small></div>
          <div><span>Programado pendiente</span><strong>${esc(money(stats.programmedTotal))}</strong><small>${stats.programmed.length} gasto${stats.programmed.length===1?'':'s'}</small></div>
          <div><span>Faltante recurrente</span><strong>${esc(money(stats.recurringGap))}</strong><small>Supermercado + fijos/servicios</small></div>
          <div class="monthly-considered ${on?'projected':'actual'}"><span>Total considerado</span><strong>${esc(money(considered))}</strong><small>${on?'Real + cierre estimado':'Solo gasto real'}</small></div>
        </div>
        <div class="monthly-explain">${on?`El cálculo suma al gasto real ${esc(money(stats.programmedTotal))} ya programados y ${esc(money(stats.recurringGap))} de faltante recurrente.`:'La proyección está desactivada: los cálculos usan únicamente lo efectivamente registrado.'}</div>
      </div>
      <div class="panel table-panel monthly-programmed-panel"><div class="panel-header"><div class="panel-title"><strong>Gastos programados del mes</strong><span>Pendientes conocidos para ${esc(monthLabel(stats.key))}; al registrarlos dejan de formar parte de esta tabla.</span></div></div>
        ${programmed.length?`<div class="table-scroll"><table class="monthly-planning-table"><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Medio de pago</th><th>Monto</th><th>Estado</th></tr></thead><tbody>${programmed.map(r=>`<tr><td>${esc(dateLabel(r))}</td><td>${esc(r['Categoría']||'—')}</td><td>${esc(r['Descripción / Comercio']||'—')}</td><td>${esc(r['Cuenta / Tarjeta']||'—')}</td><td>${esc(money(parseNumber(r['Monto COP'])))}</td><td><span class="monthly-status">${esc(programmedStatus(r))}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><strong>Sin gastos programados pendientes</strong><span>No hay movimientos con estado Programado para este mes.</span></div>'}
      </div>
      <div class="panel table-panel monthly-comparison-panel"><div class="panel-header"><div class="panel-title"><strong>Comparación mensual de gasto recurrente y variable</strong><span>${esc(monthLabel(stats.key))} vs ${esc(monthLabel(stats.prev))}. El faltante proyectable nunca reduce el gasto si ya superaste el mes anterior.</span></div></div>
        <div class="table-scroll"><table class="monthly-planning-table"><thead><tr><th>Grupo</th><th>Este mes</th><th>Mes anterior</th><th>Comparación</th><th>Faltante incluido</th></tr></thead><tbody>${comparisonRows(stats)}</tbody></table></div>
      </div>`;

    host.querySelector('#monthlyProjectionToggle')?.addEventListener('change',event=>{setProjection(event.target.checked);renderSuite(host,stats);patchFlowMatrix(stats);});
    patchFlowMatrix(stats);
  }

  function patchFlowMatrix(stats){
    if(activeView()!=='flujo')return;
    const table=document.querySelector('.flow-matrix-advanced');if(!table)return;
    const headers=[...table.querySelectorAll('thead [data-flow-sort-month]')];
    const index=headers.findIndex(th=>th.dataset.flowSortMonth===stats.key);if(index<0)return;
    const row=[...table.querySelectorAll('tbody .matrix-summary-row')].find(tr=>norm(tr.querySelector('.sticky-cat')?.textContent)==='egresos totales');if(!row)return;
    const cells=[...row.children];const amountCell=cells[2+index*2];if(!amountCell)return;
    const on=includeProjection();const total=on?stats.projectedTotal:stats.realTotal;
    amountCell.innerHTML=`<span class="monthly-flow-total ${on?'projected':'actual'}">${esc(money(total))}<small>${on?'proy.':'real'}</small></span>`;
    amountCell.title=on?'Total real + programados + faltante recurrente':'Total real efectivamente registrado';
  }

  function injectStyles(){if(document.getElementById('monthlyProjectionStyles'))return;const style=document.createElement('style');style.id='monthlyProjectionStyles';style.textContent=`
    #monthlyProjectionSuite{display:grid;gap:12px;margin:0 0 4px}.monthly-close-head{align-items:center}.monthly-switch{display:flex;align-items:center;gap:8px;color:#aebbd0;font-size:10px;cursor:pointer;user-select:none}.monthly-switch input{display:none}.monthly-switch span{width:34px;height:18px;border-radius:99px;background:#172334;border:1px solid #24344b;position:relative;transition:.2s}.monthly-switch span:after{content:"";position:absolute;width:12px;height:12px;border-radius:50%;top:2px;left:3px;background:#718198;transition:.2s}.monthly-switch input:checked+span{background:rgba(23,105,255,.25);border-color:#2c67c4}.monthly-switch input:checked+span:after{left:17px;background:#6fa1ff}.monthly-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.monthly-kpis>div{background:#0c1420;border:1px solid var(--border-soft);border-radius:11px;padding:11px}.monthly-kpis span{display:block;color:#718198;text-transform:uppercase;font-size:8px;font-weight:800;letter-spacing:.05em}.monthly-kpis strong{display:block;font-size:18px;margin-top:7px}.monthly-kpis small{display:block;color:#718198;font-size:9px;margin-top:5px}.monthly-kpis .monthly-considered.projected{border-color:rgba(23,105,255,.35);background:rgba(23,105,255,.07)}.monthly-kpis .monthly-considered.actual{border-color:rgba(38,208,124,.25)}.monthly-explain{margin-top:10px;color:#8495ab;font-size:10px;line-height:1.5}.monthly-planning-table{min-width:760px}.monthly-planning-table td{white-space:normal;vertical-align:top}.monthly-planning-table td:first-child strong{display:block}.monthly-planning-table td:first-child small{display:block;color:#718198;font-size:9px;margin-top:3px}.monthly-diff{display:inline-flex;padding:4px 7px;border-radius:99px;font-size:9px;font-weight:800}.monthly-diff.under{color:#f6c844;background:rgba(246,200,68,.08)}.monthly-diff.over{color:#ff8797;background:rgba(255,102,122,.08)}.monthly-diff.neutral{color:#7ee6af;background:rgba(38,208,124,.08)}.monthly-status{font-size:9px;color:#8db2f2;font-weight:700}.monthly-flow-total{display:flex;align-items:center;justify-content:flex-end;gap:5px}.monthly-flow-total small{font-size:7px;text-transform:uppercase;padding:2px 4px;border-radius:4px;background:rgba(23,105,255,.14);color:#76a5ff}.monthly-flow-total.actual small{background:rgba(38,208,124,.10);color:#7ee6af}
    @media(max-width:900px){.monthly-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.monthly-close-head{align-items:flex-start;flex-direction:column}.monthly-switch{margin-top:4px}}
    @media(max-width:520px){.monthly-kpis{grid-template-columns:1fr 1fr}.monthly-kpis strong{font-size:15px}.monthly-switch b{font-size:9px}}
  `;document.head.appendChild(style);}

  async function run(force=false){
    const view=activeView();if(view!=='gastos'&&view!=='flujo')return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const p=await payload(force).catch(error=>{console.error('Proyección mensual:',error);return null;});if(!p)return;
    const rows=parseRows(p.sources?.[`${financeId}|Movimientos!A:Y`]||[]);
    const stats=monthlyStats(rows,targetMonth(rows));
    let host=root.querySelector('#monthlyProjectionSuite');
    if(!host){host=document.createElement('section');host.id='monthlyProjectionSuite';const head=root.querySelector(':scope > .section-head');if(head)head.insertAdjacentElement('afterend',host);else root.prepend(host);}
    renderSuite(host,stats);
    setTimeout(()=>patchFlowMatrix(stats),250);
  }

  function schedule(force=false,delay=150){clearTimeout(timer);timer=setTimeout(()=>run(force),delay);}
  injectStyles();
  document.addEventListener('click',event=>{
    if(event.target.closest('.nav-item,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters'))schedule(false,220);
    if(event.target.closest('#refreshBtn')){cache=null;cacheAt=0;schedule(true,650);}
    if(event.target.closest('[data-flow-sort], [data-flow-sort-month], #flowOriginalOrder'))schedule(false,180);
  });
  document.addEventListener('panel:monthly-projection-change',()=>schedule(false,30));
  const root=document.getElementById('viewRoot');if(root)new MutationObserver(()=>schedule(false,130)).observe(root,{childList:true,subtree:false});
  schedule(false,450);
})();
