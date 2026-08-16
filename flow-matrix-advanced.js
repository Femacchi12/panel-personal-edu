(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const apiBaseUrl=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!apiBaseUrl||!financeId)return;

  const MONTH_NAMES=['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const ORIGINAL_ORDER=['Servicios','Salud','Odontología','Capacitación/Estudio','Supermercado','Apartamento','Pia','Actividades','Tarjeta Col','Ropa','Plataformas','Entretenimiento','Comidas/Cenas','Viajes','Regalos','Gastos ARG','Movilidad','Otros'];
  const SUMMARY_ORDER=['Fijo','Fijo + Super','Variable','Variable - Super','Egresos efectivos','Egresos Financiados','Egresos TOTALES'];
  let cache=null,cacheAt=0,timer=null;
  let sortState={type:'id',dir:'asc',month:null};
  let selectedDetail=null;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function activeView(){return document.querySelector('.nav-item.active')?.dataset.view||'';}

  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const h=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((x,i)=>[x||`Col ${i+1}`,r?.[i]??''])));}
  function num(value){if(typeof value==='number')return Number.isFinite(value)?value:0;let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}
  const money=v=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);
  const pct=v=>`${new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1}).format((Number(v)||0)*100)}%`;

  function monthKey(value){
    const s=norm(value);let m=s.match(/^(20\d{2})-(\d{1,2})/);if(m)return`${m[1]}-${String(+m[2]).padStart(2,'0')}`;
    m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);
    if(m){const map={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};return`${m[2]}-${String(map[m[1]]).padStart(2,'0')}`;}
    return'';
  }
  function monthLabel(key){const m=String(key).match(/^(20\d{2})-(\d{2})$/);return m?`${MONTH_NAMES[+m[2]-1]} ${m[1]}`:key;}

  async function payload(force=false){
    if(!force&&cache&&Date.now()-cacheAt<55_000)return cache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false);if(!token)throw new Error('Sesión no disponible');
    const r=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!r.ok)throw new Error(`Backend ${r.status}`);
    cache=await r.json();cacheAt=Date.now();return cache;
  }

  function orderedCategories(rows){
    const set=new Set(rows.filter(r=>norm(r.Tipo)==='categoria').map(r=>String(r.Concepto||'').trim()).filter(Boolean));
    const known=ORIGINAL_ORDER.filter(x=>[...set].some(y=>norm(y)===norm(x)));
    const extra=[...set].filter(x=>!known.some(y=>norm(y)===norm(x))).sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
    return [...known,...extra];
  }

  function flowMap(rows){const map=new Map();rows.forEach(r=>{const k=monthKey(r.Mes);if(k)map.set(`${k}|${norm(r.Concepto)}`,num(r['Total COP']));});return map;}
  function months(rows){
    const now=new Date(),limit=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    return [...new Set(rows.filter(r=>norm(r.Tipo)==='categoria').map(r=>monthKey(r.Mes)).filter(k=>k&&k<=limit))].sort();
  }

  function salaryMap(flowRows,conceptRows,payrollRows,incomeSummaryRows){
    const map=new Map(),source=new Map();

    conceptRows.forEach(r=>{
      const k=monthKey(r.Mes);if(!k)return;
      const regular=num(r['Sueldo COP'])+num(r['Sueldo USD (equiv. COP)']);
      if(regular>0){map.set(k,regular);source.set(k,'Nómina COP + Fibrazo LLC USD');}
    });

    const payrollByMonth=new Map();
    payrollRows.forEach(r=>{
      const k=monthKey(r['Fecha inicio']||r.Periodo);if(!k)return;
      const total=num(r['Total ingresos']);
      if(!total)return;
      const regular=Math.max(0,total-num(r.Salud)-num(r['Pensión'])-num(r.Prima)-num(r['Cesantías'])-num(r['Intereses cesantías']));
      if(regular>0)payrollByMonth.set(k,regular);
    });

    const usdByMonth=new Map();
    incomeSummaryRows.forEach(r=>{
      const k=monthKey(r.Mes);if(!k)return;
      usdByMonth.set(k,num(r['Ingresos COP']));
    });

    payrollByMonth.forEach((regularCop,k)=>{
      if(map.has(k))return;
      const regular=regularCop+(usdByMonth.get(k)||0);
      if(regular>0){map.set(k,regular);source.set(k,'Nómina COP regular + Fibrazo LLC USD histórico');}
    });

    const grouped=new Map();
    flowRows.filter(r=>norm(r.Tipo)==='categoria').forEach(r=>{
      const k=monthKey(r.Mes);if(!k||map.has(k))return;
      const amount=num(r['Total COP']);let fraction=num(r['% salario promedio']);
      if(fraction>1)fraction/=100;
      if(amount>0&&fraction>.005){if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(amount/fraction);}
    });
    grouped.forEach((values,k)=>{
      if(!values.length)return;values.sort((a,b)=>a-b);const middle=Math.floor(values.length/2);const median=values.length%2?values[middle]:(values[middle-1]+values[middle])/2;
      map.set(k,median);source.set(k,'Base histórica reconstruida');
    });
    return {map,source};
  }

  function pctClass(value){const p=(Number(value)||0)*100;if(p>15)return'pct-red';if(p>10)return'pct-yellow';if(p>5)return'pct-green';return'pct-white';}

  function sortedCategories(categories,valueMap){
    const rows=categories.map((cat,index)=>({cat,id:index+1}));
    const direction=sortState.dir==='desc'?-1:1;
    if(sortState.type==='category')rows.sort((a,b)=>a.cat.localeCompare(b.cat,'es',{numeric:true,sensitivity:'base'})*direction);
    else if(sortState.type==='month'&&sortState.month)rows.sort((a,b)=>((valueMap.get(`${sortState.month}|${norm(a.cat)}`)||0)-(valueMap.get(`${sortState.month}|${norm(b.cat)}`)||0))*direction||a.id-b.id);
    else rows.sort((a,b)=>(a.id-b.id)*direction);
    return rows;
  }

  function effectiveDate(row){
    const desc=[row['Descripción original'],row['Descripción / Comercio']].filter(Boolean).join(' ');
    let m=desc.match(/\((\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\)/i);if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    const mk=monthKey(row['Mes pago']||row['Mes consumo']);const base=mk?mk.match(/^(\d{4})-(\d{2})$/):null;
    m=desc.match(/\(\s*d[ií]a\s*(\d{1,2})\s*\)/i);if(m&&base)return new Date(+base[1],+base[2]-1,+m[1]);
    const raw=String(row['Fecha real']||row['Fecha registrada']||'');let d=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);return d?new Date(+d[1],+d[2]-1,+d[3]):null;
  }
  function dateLabel(row){const d=effectiveDate(row);return d?`${d.getFullYear()} ${MONTH_NAMES[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')}`:'—';}
  function expenseType(row){return /^(si|sí|true|1)$/i.test(String(row['Es fijo']||''))?'Fijo':'Variable';}

  function renderDetail(host,movements,cat,key){
    const rows=movements.filter(r=>norm(r.Tipo)==='gasto'&&norm(r['Categoría'])===norm(cat)&&monthKey(r['Mes consumo'])===key)
      .sort((a,b)=>(effectiveDate(a)?.getTime()||0)-(effectiveDate(b)?.getTime()||0));
    const columns=['Fecha real','Tipo de gasto','Categoría','Subcategoría','Descripción / Comercio','Monto original','Moneda original','Cuenta / Tarjeta','Titular','Cuotas','N° cuota','Estado','Monto COP','Monto ARS','Monto USD'];
    const value=(r,c)=>c==='Fecha real'?dateLabel(r):c==='Tipo de gasto'?expenseType(r):(r[c]??'');
    host.innerHTML=`<div class="panel-header"><div class="panel-title"><strong>Detalle · ${esc(cat)} · ${esc(monthLabel(key))}</strong><span>${rows.length} movimientos · total ${esc(money(rows.reduce((a,r)=>a+num(r['Monto COP']),0)))}</span></div><button type="button" class="text-btn" id="closeFlowDetail">Cerrar</button></div>
      ${rows.length?`<div class="table-scroll expanded"><table class="date-first-table"><thead><tr>${columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(c=>`<td>${esc(value(r,c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><div><strong>Sin movimientos encontrados</strong><span>El total consolidado existe, pero no se encontraron filas detalladas con esa categoría y mes.</span></div></div>'}`;
    host.querySelector('#closeFlowDetail')?.addEventListener('click',()=>{selectedDetail=null;host.hidden=true;host.innerHTML='';});
    host.hidden=false;host.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function bindMatrix(host,data){
    host.querySelector('#flowOriginalOrder')?.addEventListener('click',()=>{sortState={type:'id',dir:'asc',month:null};renderInto(host,data);});
    host.querySelector('[data-flow-sort="id"]')?.addEventListener('click',()=>{sortState={type:'id',dir:sortState.type==='id'&&sortState.dir==='asc'?'desc':'asc',month:null};renderInto(host,data);});
    host.querySelector('[data-flow-sort="category"]')?.addEventListener('click',()=>{sortState={type:'category',dir:sortState.type==='category'&&sortState.dir==='asc'?'desc':'asc',month:null};renderInto(host,data);});
    host.querySelectorAll('[data-flow-sort-month]').forEach(th=>th.addEventListener('click',()=>{const month=th.dataset.flowSortMonth;sortState={type:'month',month,dir:sortState.type==='month'&&sortState.month===month&&sortState.dir==='asc'?'desc':'asc'};renderInto(host,data);}));
    host.querySelectorAll('[data-flow-detail]').forEach(btn=>btn.addEventListener('click',()=>{selectedDetail={cat:btn.dataset.category,month:btn.dataset.month};const detail=host.parentElement.querySelector('#flowMatrixDetail');if(detail)renderDetail(detail,data.movements,selectedDetail.cat,selectedDetail.month);}));
  }

  function renderInto(host,data){
    const {flowRows,movements,conceptRows,payrollRows,incomeSummaryRows}=data;
    const monthList=months(flowRows),categories=orderedCategories(flowRows),values=flowMap(flowRows),salary=salaryMap(flowRows,conceptRows,payrollRows,incomeSummaryRows);
    const ordered=sortedCategories(categories,values);
    const summaries=SUMMARY_ORDER.map(label=>({label,values:monthList.map(m=>values.get(`${m}|${norm(label)}`)||0)}));
    const arrow=(type,month=null)=>sortState.type===type&&(type!=='month'||sortState.month===month)?(sortState.dir==='asc'?' ↑':' ↓'):'';

    host.innerHTML=`<div class="panel-header"><div class="panel-title"><strong>Matriz mensual por categoría</strong><span>Histórico disponible · monto + porcentaje sobre ingreso regular percibido</span></div><button type="button" class="text-btn" id="flowOriginalOrder">Orden original</button></div>
      <div class="flow-matrix-scroll"><table class="flow-matrix-advanced"><thead>
        <tr><th class="sticky-id" rowspan="2" data-flow-sort="id">ID${arrow('id')}</th><th class="sticky-cat" rowspan="2" data-flow-sort="category">Categoría${arrow('category')}</th>${monthList.map(m=>`<th colspan="2" data-flow-sort-month="${m}">${esc(monthLabel(m))}${arrow('month',m)}</th>`).join('')}</tr>
        <tr>${monthList.map(()=>'<th>Monto</th><th>% ingreso</th>').join('')}</tr></thead><tbody>
        ${ordered.map(({cat,id})=>`<tr><td class="sticky-id">${id}</td><td class="sticky-cat">${esc(cat)}</td>${monthList.map(m=>{const amount=values.get(`${m}|${norm(cat)}`)||0;const base=salary.map.get(m)||0;const share=base?amount/base:0;return`<td class="amount-cell"><button type="button" class="matrix-amount-btn" data-flow-detail data-category="${esc(cat)}" data-month="${m}">${esc(money(amount))}</button></td><td><span class="matrix-pct ${pctClass(share)}">${base?esc(pct(share)):'—'}</span></td>`;}).join('')}</tr>`).join('')}
        <tr class="matrix-total-row"><td class="sticky-id"></td><td class="sticky-cat">Total gastado por categorías</td>${monthList.map(m=>{const total=categories.reduce((a,c)=>a+(values.get(`${m}|${norm(c)}`)||0),0);const base=salary.map.get(m)||0;const share=base?total/base:0;return`<td>${esc(money(total))}</td><td><span class="matrix-pct ${pctClass(share)}">${base?esc(pct(share)):'—'}</span></td>`;}).join('')}</tr>
        ${summaries.map(row=>`<tr class="matrix-summary-row"><td class="sticky-id"></td><td class="sticky-cat">${esc(row.label)}</td>${row.values.map((amount,i)=>{const m=monthList[i],base=salary.map.get(m)||0,share=base?amount/base:0;return`<td>${esc(money(amount))}</td><td><span class="matrix-pct ${pctClass(share)}">${base?esc(pct(share)):'—'}</span></td>`;}).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="salary-reference"><strong>Salario / ingreso regular usado para los porcentajes</strong><div class="salary-reference-grid">${monthList.map(m=>`<div><span>${esc(monthLabel(m))}</span><strong>${salary.map.has(m)?esc(money(salary.map.get(m))):'—'}</strong><small>${esc(salary.source.get(m)||'Sin base disponible')}</small></div>`).join('')}</div></div>
      <div class="matrix-color-legend"><span><i class="pct-white"></i>0–5%</span><span><i class="pct-green"></i>6–10%</span><span><i class="pct-yellow"></i>11–15%</span><span><i class="pct-red"></i>&gt;15%</span></div>`;
    bindMatrix(host,data);
    const detail=host.parentElement.querySelector('#flowMatrixDetail');if(selectedDetail&&detail)renderDetail(detail,movements,selectedDetail.cat,selectedDetail.month);
  }

  function injectStyles(){if(document.getElementById('flowMatrixAdvancedStyles'))return;const style=document.createElement('style');style.id='flowMatrixAdvancedStyles';style.textContent=`
    .flow-matrix-scroll{overflow:auto;max-width:100%;border:1px solid var(--line,#172335);border-radius:12px}.flow-matrix-advanced{border-collapse:separate;border-spacing:0;min-width:max-content;width:100%;font-size:11px}.flow-matrix-advanced th,.flow-matrix-advanced td{white-space:nowrap;padding:9px 10px;border-bottom:1px solid #142031;border-right:1px solid #101b29;text-align:right}.flow-matrix-advanced th{background:#0d1520;color:#76a9ff;font-size:9px;text-transform:uppercase;letter-spacing:.05em;cursor:pointer;position:sticky;top:0;z-index:4}.flow-matrix-advanced thead tr:nth-child(2) th{top:32px}.flow-matrix-advanced .sticky-id{position:sticky;left:0;z-index:7!important;background:#0b131e!important;text-align:center;min-width:42px}.flow-matrix-advanced .sticky-cat{position:sticky;left:42px;z-index:6!important;background:#0b131e!important;text-align:left;min-width:150px;box-shadow:8px 0 14px rgba(0,0,0,.16)}.matrix-amount-btn{border:0;background:transparent;color:#e6edf7;font:inherit;font-weight:600;cursor:pointer;padding:0}.matrix-amount-btn:hover{color:#4f91ff;text-decoration:underline}.matrix-pct{font-weight:800;padding:2px 5px;border-radius:5px}.matrix-pct.pct-white{color:#f4f7fb}.matrix-pct.pct-green{color:#26d07c}.matrix-pct.pct-yellow{color:#f6c844}.matrix-pct.pct-red{color:#ff667a}.matrix-total-row td{font-weight:800;background:#0d1a2b}.matrix-summary-row td{font-weight:700;background:#0a121c}.salary-reference{margin-top:16px;border:1px solid var(--line,#172335);border-radius:12px;padding:14px}.salary-reference>strong{display:block;margin-bottom:10px}.salary-reference-grid{display:flex;gap:8px;overflow-x:auto}.salary-reference-grid>div{min-width:145px;padding:9px 10px;border-radius:9px;background:#0a121c;display:flex;flex-direction:column;gap:3px}.salary-reference-grid span,.salary-reference-grid small{font-size:10px;color:#7f8ea3}.salary-reference-grid strong{font-size:12px}.matrix-color-legend{display:flex;gap:15px;flex-wrap:wrap;margin-top:10px;color:#8998ac;font-size:10px}.matrix-color-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}.matrix-color-legend .pct-white{background:#f4f7fb}.matrix-color-legend .pct-green{background:#26d07c}.matrix-color-legend .pct-yellow{background:#f6c844}.matrix-color-legend .pct-red{background:#ff667a}#flowMatrixDetail{margin-top:14px}
    @media(max-width:720px){.flow-matrix-advanced .sticky-cat{min-width:125px}.flow-matrix-advanced th,.flow-matrix-advanced td{padding:8px 7px}}
  `;document.head.appendChild(style);}

  async function run(force=false){
    if(activeView()!=='flujo')return;const root=document.getElementById('viewRoot');if(!root)return;
    const original=[...root.querySelectorAll('.panel')].find(p=>p.querySelector('.panel-title strong')?.textContent?.trim()==='Matriz mensual por categoría');if(!original)return;
    original.style.display='none';let host=root.querySelector('#flowMatrixAdvanced');if(!host){host=document.createElement('div');host.id='flowMatrixAdvanced';host.className='panel table-panel';original.insertAdjacentElement('afterend',host);const detail=document.createElement('div');detail.id='flowMatrixDetail';detail.className='panel table-panel';detail.hidden=true;host.insertAdjacentElement('afterend',detail);}
    const p=await payload(force).catch(e=>{console.error('Matriz avanzada:',e);return null;});if(!p)return;
    const data={
      flowRows:parseRows(p.sources?.[`${financeId}|Flujo_Mensual!A:J`]||[]),
      movements:parseRows(p.sources?.[`${financeId}|Movimientos!A:Y`]||[]),
      conceptRows:parseRows(p.sources?.[`${financeId}|Resumen_Conceptos_Ingresos!A:L`]||[]),
      payrollRows:parseRows(p.sources?.[`${financeId}|Nomina_Colombia!A:AI`]||[]),
      incomeSummaryRows:parseRows(p.sources?.[`${financeId}|Resumen_Ingresos!A:H`]||[])
    };
    renderInto(host,data);
  }
  function schedule(force=false,delay=150){clearTimeout(timer);timer=setTimeout(()=>run(force),delay);}
  injectStyles();document.addEventListener('click',e=>{if(e.target.closest('.nav-item,.currency-btn,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters'))schedule(false,220);if(e.target.closest('#refreshBtn')){cache=null;cacheAt=0;schedule(true,550);}});const root=document.getElementById('viewRoot');if(root)new MutationObserver(()=>schedule(false,120)).observe(root,{childList:true,subtree:false});schedule(false,300);
})();
