(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  const MONTH_NAMES = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const ORIGINAL_ORDER = ['Servicios','Salud','Odontología','Capacitación/Estudio','Supermercado','Apartamento','Pia','Actividades','Tarjeta Col','Ropa','Plataformas','Entretenimiento','Comidas/Cenas','Viajes','Regalos','Gastos ARG','Movilidad','Otros'];
  const SUMMARY_ORDER = ['Fijo','Fijo + Super','Variable','Variable - Super','Egresos efectivos','Egresos Financiados','Egresos TOTALES'];
  const MIGRATION_START = '2026-01';

  let selectedDetail = null, applying = false, rerunRequested = false, renderFrame = 0, pendingForce = false;
  let sortState = { type: 'id', dir: 'asc', month: null };

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const money = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);
  const pct = v => `${new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1}).format((Number(v)||0)*100)}%`;

  function num(value){
    if(typeof value==='number') return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,''); if(!s)return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0){ if(c>d)s=s.replace(/\./g,'').replace(',','.'); else s=s.replace(/,/g,''); }
    else if(c>=0){ const p=s.split(','); s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,''); }
    else if(d>=0){ const p=s.split('.'); if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,''); }
    const n=Number(s); return Number.isFinite(n)?n:0;
  }
  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return[];
    const h=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));
  }
  function monthKey(value){
    const s=norm(value); let m=s.match(/^(20\d{2})-(\d{1,2})/); if(m)return`${m[1]}-${String(+m[2]).padStart(2,'0')}`;
    const map={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);
    return m?`${m[2]}-${String(map[m[1]]).padStart(2,'0')}`:'';
  }
  function monthLabel(key){ const m=String(key).match(/^(20\d{2})-(\d{2})$/); return m?`${MONTH_NAMES[+m[2]-1]} ${m[1]}`:key; }
  function currentMonthKey(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
  function selectedGlobal(key){ return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||'').trim()).filter(Boolean); }
  function selectedYear(){ const y=selectedGlobal('year'); return y.length===1?y[0]:String(new Date().getFullYear()); }
  function monthList(year){ return Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`); }

  function isReal(row){
    if(norm(row.Tipo)!=='gasto')return false;
    return window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad/.test(norm(row.Estado));
  }
  function account(row){
    const raw=String(row['Cuenta / Tarjeta']||'').trim(),n=norm(raw),holder=norm(row.Titular);
    if(n.includes('efectivo'))return'Efectivo';
    if(n.includes('nequi'))return holder.includes('ro')?'Nequi Ro':'Nequi Edu';
    if(n.includes('arq'))return'ARQ Edu';
    if(n.includes('nu')){if(n.includes(' ro')||holder.includes('rocio')||holder==='ro')return'Nu Ro';return'Nu Edu';}
    return raw||'Sin especificar';
  }
  function method(row){
    if(typeof window.FinancePurchasePolicy?.method==='function')return window.FinancePurchasePolicy.method(row);
    const explicit=String(row['Modalidad de pago']||'').trim(); if(explicit)return explicit;
    const raw=norm(row['Cuenta / Tarjeta']);
    if(raw.includes('credito'))return'Crédito';
    if(raw.includes('transferencia'))return'Transferencia';
    if(raw.includes('debito'))return'Débito';
    if(raw.includes('efectivo'))return'Efectivo';
    const q=num(row.Cuotas); if(q>0&&(raw.includes('nu')||raw.includes('arq')))return'Crédito';
    return'Sin especificar';
  }
  function matchesActiveFilters(row){
    if(!isReal(row))return false;
    const cats=selectedGlobal('category'); if(cats.length&&!cats.includes(String(row['Categoría']||'')))return false;
    const st=window.__PAYMENT_FILTER_STATE__?.view==='flujo'?window.__PAYMENT_FILTER_STATE__:{account:[],method:[]};
    if(st.account?.length&&!st.account.includes(account(row)))return false;
    if(st.method?.length&&!st.method.includes(method(row)))return false;
    return true;
  }
  function filterSummary(){
    const st=window.__PAYMENT_FILTER_STATE__?.view==='flujo'?window.__PAYMENT_FILTER_STATE__:{account:[],method:[]};
    const parts=[];
    if(st.account?.length)parts.push(`Cuenta: ${st.account.join(' / ')}`);
    if(st.method?.length)parts.push(`Modalidad: ${st.method.join(' / ')}`);
    return parts.length?` · ${parts.join(' · ')}`:'';
  }
  function isCreditPurchase(row){
    if(typeof window.FinancePurchasePolicy?.isFinancedPurchase==='function')return window.FinancePurchasePolicy.isFinancedPurchase(row);
    if(norm(method(row))!=='credito')return false;
    if(norm(row['Categoría'])==='tarjeta col')return false;
    const desc=norm(`${row['Descripción / Comercio']||''} ${row['Descripción original']||''}`);
    if(/cuota de manejo|interes|interés/.test(desc))return false;
    return true;
  }

  async function payload(force=false){
    const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')return null;
    return getData(force);
  }
  const rowsFor=(data,range)=>parseRows(data?.sources?.[`${financeId}|${range}`]||[]);

  function historicalMap(flowRows){ const map=new Map(); flowRows.forEach(r=>{const k=monthKey(r.Mes); if(k)map.set(`${k}|${norm(r.Concepto)}`,num(r['Total COP']));}); return map; }
  function categoryList(flowRows,movements,year){
    const set=new Set(flowRows.filter(r=>norm(r.Tipo)==='categoria'&&monthKey(r.Mes).startsWith(year+'-')).map(r=>String(r.Concepto||'').trim()).filter(Boolean));
    movements.filter(r=>isReal(r)&&monthKey(r['Mes consumo']).startsWith(year+'-')).forEach(r=>{if(r['Categoría'])set.add(String(r['Categoría']).trim());});
    const selected=selectedGlobal('category'); if(selected.length)return [...set].filter(x=>selected.includes(x));
    const known=ORIGINAL_ORDER.filter(x=>[...set].some(y=>norm(y)===norm(x)));
    const extra=[...set].filter(x=>!known.some(y=>norm(y)===norm(x))).sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
    return [...known,...extra];
  }

  function salaryMap(concepts,regularIncome){
    if(regularIncome?.months instanceof Map){
      const map=new Map(),source=new Map();
      regularIncome.months.forEach((base,key)=>{
        if(!base?.usable||!(base.totalCop>0))return;
        map.set(key,base.totalCop);
        source.set(key,base.complete?'Base regular confirmada':'Base regular estimada · soporte pendiente');
      });
      return {map,source};
    }
    const map=new Map(),source=new Map(),byYear=new Map(),rowsByMonth=new Map();
    concepts.forEach(r=>{
      const k=monthKey(r.Mes); if(!k)return;
      const cop=num(r['Sueldo COP']),usd=num(r['Sueldo USD (equiv. COP)']),year=k.slice(0,4);
      rowsByMonth.set(k,{cop,usd});
      if(cop>0){if(!byYear.has(year))byYear.set(year,[]);byYear.get(year).push({month:k,cop});}
      if(cop>0){map.set(k,cop+usd);source.set(k,'Nómina COP + Fibrazo LLC USD');}
      else if(usd>0){map.set(k,usd);source.set(k,'Fibrazo LLC USD · nómina COP pendiente');}
    });
    const fallbackCop=month=>{
      const history=(byYear.get(month.slice(0,4))||[]).slice().sort((a,b)=>a.month.localeCompare(b.month));
      let value=0;
      history.forEach(item=>{if(item.month<=month)value=item.cop;});
      return value||history[0]?.cop||0;
    };
    monthList(selectedYear()).forEach(k=>{
      const row=rowsByMonth.get(k)||{cop:0,usd:0};
      if(row.cop>0)return;
      const regularCop=fallbackCop(k);
      if(row.usd>0&&regularCop>0){map.set(k,regularCop+row.usd);source.set(k,'Nómina COP de referencia + Fibrazo LLC USD');}
    });
    return {map,source};
  }
  function pctClass(v){const p=(Number(v)||0)*100;return p>15?'pct-red':p>10?'pct-yellow':p>5?'pct-green':'pct-white';}

  function movementMonthValues(movements,month){
    const rows=movements.filter(r=>matchesActiveFilters(r)&&monthKey(r['Mes consumo'])===month);
    const byCat=new Map(); rows.forEach(r=>byCat.set(norm(r['Categoría']),(byCat.get(norm(r['Categoría']))||0)+num(r['Monto COP'])));
    const supermarket=rows.filter(r=>norm(r['Categoría'])==='supermercado').reduce((s,r)=>s+num(r['Monto COP']),0);
    const fixed=rows.filter(r=>/^(si|sí|true|1)$/i.test(String(r['Es fijo']||''))).reduce((s,r)=>s+num(r['Monto COP']),0);
    const variable=rows.filter(r=>!/^(si|sí|true|1)$/i.test(String(r['Es fijo']||''))).reduce((s,r)=>s+num(r['Monto COP']),0);
    const financed=rows.filter(isCreditPurchase).reduce((s,r)=>s+num(r['Monto COP']),0);
    const total=rows.reduce((s,r)=>s+num(r['Monto COP']),0);
    const summary=new Map([
      ['fijo',fixed],['fijo + super',fixed+supermarket],['variable',variable],['variable - super',Math.max(0,variable-supermarket)],
      ['egresos efectivos',total-financed],['egresos financiados',financed],['egresos totales',total]
    ]);
    return {byCat,summary,total};
  }
  function shouldUseMovements(month,current){ return month>=MIGRATION_START && month<=current; }

  function effectiveDate(row){ const raw=String(row['Fecha real']||row['Fecha registrada']||''); const m=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m?new Date(+m[1],+m[2]-1,+m[3]):null; }
  function renderDetail(host,movements,cat,key){
    const rows=movements.filter(r=>matchesActiveFilters(r)&&norm(r['Categoría'])===norm(cat)&&monthKey(r['Mes consumo'])===key).sort((a,b)=>(effectiveDate(a)?.getTime()||0)-(effectiveDate(b)?.getTime()||0));
    const cols=['Fecha real','Categoría','Subcategoría','Descripción / Comercio','Monto original','Moneda original','Cuenta / Tarjeta','Modalidad de pago','Titular','Cuotas','Estado','Monto COP'];
    const total=rows.reduce((s,r)=>s+num(r['Monto COP']),0);
    const footer=cols.map((col,index)=>`<td>${index===0?'TOTAL':col==='Monto COP'?esc(money(total)):''}</td>`).join('');
    host.innerHTML=`<div class="panel-header"><div class="panel-title"><strong>Detalle · ${esc(cat)} · ${esc(monthLabel(key))}</strong><span>${rows.length} movimientos realizados según filtros · total ${esc(money(total))}${esc(filterSummary())}</span></div><button type="button" class="text-btn" id="closeFlowDetailV3">Cerrar</button></div>${rows.length?`<div class="table-scroll expanded"><table class="date-first-table"><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(r[c]??'')}</td>`).join('')}</tr>`).join('')}</tbody><tfoot data-auto-total><tr class="flow-detail-total-row">${footer}</tr></tfoot></table></div>`:'<div class="empty-state"><div><strong>Sin movimientos realizados</strong><span>No hay movimientos para esta categoría, mes y filtros.</span></div></div>'}`;
    host.hidden=false; host.querySelector('#closeFlowDetailV3')?.addEventListener('click',()=>{selectedDetail=null;host.hidden=true;host.innerHTML='';}); host.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function injectStyles(){
    if(document.getElementById('flowMatrixV3Styles'))return;
    const style=document.createElement('style');style.id='flowMatrixV3Styles';style.textContent=`#flowMatrixV3{margin-top:0}.flow-matrix-scroll{overflow:auto;max-width:100%;border:1px solid var(--line,#172335);border-radius:12px}.flow-matrix-advanced{border-collapse:separate;border-spacing:0;min-width:max-content;width:100%;font-size:11px}.flow-matrix-advanced th,.flow-matrix-advanced td{white-space:nowrap;padding:9px 10px;border-bottom:1px solid #142031;border-right:1px solid #101b29;text-align:right}.flow-matrix-advanced th{background:#0d1520;color:#76a9ff;font-size:9px;text-transform:uppercase;letter-spacing:.05em;cursor:pointer;position:sticky;top:0;z-index:4}.flow-matrix-advanced thead tr:nth-child(2) th{top:32px}.flow-matrix-advanced thead tr:first-child th[colspan="2"]{text-align:center}.flow-matrix-advanced .sticky-id{position:sticky;left:0;z-index:7!important;background:#0b131e!important;text-align:center;min-width:42px}.flow-matrix-advanced .sticky-cat{position:sticky;left:42px;z-index:6!important;background:#0b131e!important;text-align:left;min-width:150px;box-shadow:8px 0 14px rgba(0,0,0,.16)}.matrix-amount-btn{border:0;background:transparent;color:#e6edf7;font:inherit;font-weight:600;cursor:pointer;padding:0}.matrix-amount-btn:hover{color:#4f91ff;text-decoration:underline}.matrix-pct{font-weight:800;padding:2px 5px;border-radius:5px}.matrix-pct.pct-white{color:#f4f7fb}.matrix-pct.pct-green{color:#26d07c}.matrix-pct.pct-yellow{color:#f6c844}.matrix-pct.pct-red{color:#ff667a}.matrix-total-row td{font-weight:800;background:#0d1a2b}.matrix-summary-row td{font-weight:700;background:#0a121c}.salary-reference{margin-top:16px;border:1px solid var(--line,#172335);border-radius:12px;padding:14px}.salary-reference-grid{display:flex;gap:8px;overflow-x:auto;margin-top:10px}.salary-reference-grid>div{min-width:145px;padding:9px 10px;border-radius:9px;background:#0a121c;display:flex;flex-direction:column;gap:3px}.salary-reference-grid span,.salary-reference-grid small{font-size:10px;color:#7f8ea3}.matrix-color-legend{display:flex;gap:15px;flex-wrap:wrap;margin-top:10px;color:#8998ac;font-size:10px}#flowMatrixDetailV3 tfoot[data-auto-total] td{font-weight:800;color:#f4f7fb;border-top:2px solid #2a3a50;background:#0d1622;white-space:nowrap}#flowMatrixDetailV3 tfoot[data-auto-total] td:first-child{color:#26d07c;letter-spacing:.06em}`;document.head.appendChild(style);
  }

  function sortedCategories(categories,values){const rows=categories.map((cat,index)=>({cat,id:index+1}));const dir=sortState.dir==='desc'?-1:1;if(sortState.type==='category')rows.sort((a,b)=>a.cat.localeCompare(b.cat,'es',{numeric:true,sensitivity:'base'})*dir);else if(sortState.type==='month'&&sortState.month)rows.sort((a,b)=>((values.get(`${sortState.month}|${norm(a.cat)}`)||0)-(values.get(`${sortState.month}|${norm(b.cat)}`)||0))*dir||a.id-b.id);else rows.sort((a,b)=>(a.id-b.id)*dir);return rows;}

  function render(host,detail,data){
    const year=selectedYear(),months=monthList(year),current=currentMonthKey(),historical=historicalMap(data.flowRows),salary=salaryMap(data.concepts,data.regularIncome),categories=categoryList(data.flowRows,data.movements,year);
    const movementCache=new Map();
    const mdata=m=>{if(!movementCache.has(m))movementCache.set(m,movementMonthValues(data.movements,m));return movementCache.get(m);};
    const values=new Map(historical);
    months.forEach(m=>{if(shouldUseMovements(m,current))categories.forEach(cat=>values.set(`${m}|${norm(cat)}`,mdata(m).byCat.get(norm(cat))||0));});
    const ordered=sortedCategories(categories,values),arrow=(type,month=null)=>sortState.type===type&&(type!=='month'||sortState.month===month)?(sortState.dir==='asc'?' ↑':' ↓'):'';
    host.innerHTML=`<div class="panel-header"><div class="panel-title"><strong>Matriz mensual por categoría</strong><span>${esc(year)} desde Movimientos · histórico anterior como respaldo · monto + % sobre ingreso regular</span></div><button type="button" class="text-btn" id="flowOriginalOrderV3">Orden original</button></div><div class="flow-matrix-scroll"><table class="flow-matrix-advanced"><thead><tr><th class="sticky-id" rowspan="2" data-sort="id">ID${arrow('id')}</th><th class="sticky-cat" rowspan="2" data-sort="category">Categoría${arrow('category')}</th>${months.map(m=>`<th colspan="2" data-sort-month="${m}">${esc(monthLabel(m))}${arrow('month',m)}</th>`).join('')}</tr><tr>${months.map(()=>'<th>Monto</th><th>% ingreso</th>').join('')}</tr></thead><tbody>${ordered.map(({cat,id})=>`<tr><td class="sticky-id">${id}</td><td class="sticky-cat">${esc(cat)}</td>${months.map(m=>{const amount=values.get(`${m}|${norm(cat)}`)||0,base=salary.map.get(m)||0,share=base?amount/base:0;return`<td><button type="button" class="matrix-amount-btn" data-detail data-category="${esc(cat)}" data-month="${m}">${esc(money(amount))}</button></td><td><span class="matrix-pct ${pctClass(share)}">${base?esc(pct(share)):'—'}</span></td>`;}).join('')}</tr>`).join('')}<tr class="matrix-total-row"><td class="sticky-id"></td><td class="sticky-cat">Total gastado por categorías</td>${months.map(m=>{const total=shouldUseMovements(m,current)?mdata(m).total:categories.reduce((s,c)=>s+(values.get(`${m}|${norm(c)}`)||0),0),base=salary.map.get(m)||0,share=base?total/base:0;return`<td>${esc(money(total))}</td><td><span class="matrix-pct ${pctClass(share)}">${base?esc(pct(share)):'—'}</span></td>`;}).join('')}</tr>${SUMMARY_ORDER.map(label=>`<tr class="matrix-summary-row"><td class="sticky-id"></td><td class="sticky-cat">${esc(label)}</td>${months.map(m=>{const amount=shouldUseMovements(m,current)?(mdata(m).summary.get(norm(label))||0):(historical.get(`${m}|${norm(label)}`)||0),base=salary.map.get(m)||0,share=base?amount/base:0;return`<td>${esc(money(amount))}</td><td><span class="matrix-pct ${pctClass(share)}">${base?esc(pct(share)):'—'}</span></td>`;}).join('')}</tr>`).join('')}</tbody></table></div><div class="salary-reference"><strong>Salario / ingreso regular usado para los porcentajes</strong><div class="salary-reference-grid">${months.map(m=>`<div><span>${esc(monthLabel(m))}</span><strong>${salary.map.has(m)?esc(money(salary.map.get(m))):'—'}</strong><small>${esc(salary.source.get(m)||'Sin base disponible')}</small></div>`).join('')}</div></div><div class="matrix-color-legend"><span>0–5% blanco</span><span>6–10% verde</span><span>11–15% amarillo</span><span>&gt;15% rojo</span></div>`;
    host.querySelector('#flowOriginalOrderV3')?.addEventListener('click',()=>{sortState={type:'id',dir:'asc',month:null};render(host,detail,data);});
    host.querySelector('[data-sort="id"]')?.addEventListener('click',()=>{sortState={type:'id',dir:sortState.type==='id'&&sortState.dir==='asc'?'desc':'asc',month:null};render(host,detail,data);});
    host.querySelector('[data-sort="category"]')?.addEventListener('click',()=>{sortState={type:'category',dir:sortState.type==='category'&&sortState.dir==='asc'?'desc':'asc',month:null};render(host,detail,data);});
    host.querySelectorAll('[data-sort-month]').forEach(th=>th.addEventListener('click',()=>{const m=th.dataset.sortMonth;sortState={type:'month',month:m,dir:sortState.type==='month'&&sortState.month===m&&sortState.dir==='asc'?'desc':'asc'};render(host,detail,data);}));
    host.querySelectorAll('[data-detail]').forEach(btn=>btn.addEventListener('click',()=>{selectedDetail={cat:btn.dataset.category,month:btn.dataset.month};renderDetail(detail,data.movements,selectedDetail.cat,selectedDetail.month);}));
    if(selectedDetail)renderDetail(detail,data.movements,selectedDetail.cat,selectedDetail.month);
  }

  function ensureHosts(root){
    let host=root.querySelector('#flowMatrixV3'),detail=root.querySelector('#flowMatrixDetailV3');
    if(host&&detail)return{host,detail};
    if(!host){
      host=document.createElement('div');host.id='flowMatrixV3';host.className='panel table-panel';
      const evolution=[...root.querySelectorAll('.panel')].find(p=>norm(p.querySelector('.panel-title strong')?.textContent||'')==='evolucion mensual');
      const savings=[...root.querySelectorAll('.panel')].find(p=>norm(p.querySelector('.panel-title strong')?.textContent||'').includes('flujo y ahorro mensual'));
      if(evolution)evolution.insertAdjacentElement('afterend',host);
      else if(savings)savings.insertAdjacentElement('beforebegin',host);
      else root.appendChild(host);
    }
    if(!detail){detail=document.createElement('div');detail.id='flowMatrixDetailV3';detail.className='panel table-panel';detail.hidden=true;host.insertAdjacentElement('afterend',detail);}
    return{host,detail};
  }

  async function run(force=false){
    if(activeView()!=='flujo')return;
    if(applying){rerunRequested=true;pendingForce=pendingForce||force;return;}
    applying=true;
    try{
      const p=await payload(force); if(!p||activeView()!=='flujo')return;
      const root=document.getElementById('viewRoot'); if(!root)return;
      const {host,detail}=ensureHosts(root);
      const movements=rowsFor(p,'Movimientos!A:Z');
      const regularIncome=typeof window.RegularIncomeCore?.build==='function'?window.RegularIncomeCore.build(p,financeId):null;
      const data={flowRows:rowsFor(p,'Flujo_Mensual!A:J'),movements,concepts:rowsFor(p,'Resumen_Conceptos_Ingresos!A:L'),regularIncome};
      render(host,detail,data);
      document.dispatchEvent(new CustomEvent('panel:flow-matrix-v3-rendered'));
    }catch(e){console.error('Matriz Flujo v3:',e);}finally{
      applying=false;
      if(rerunRequested&&activeView()==='flujo'){rerunRequested=false;schedule(false);}
    }
  }
  function schedule(force=false){
    pendingForce=pendingForce||force;
    if(renderFrame)return;
    renderFrame=requestAnimationFrame(()=>{
      renderFrame=0;
      const useForce=pendingForce;
      pendingForce=false;
      run(useForce);
    });
  }

  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{
    if(event.detail?.view==='flujo'&&!document.getElementById('flowMatrixV3'))schedule(false);
  });
  document.addEventListener('panel:payment-filters-changed',event=>{if(event.detail?.view==='flujo')schedule(false);});
  document.addEventListener('panel:filters-updated',()=>{if(activeView()==='flujo')schedule(false);});
  queueMicrotask(()=>{if(activeView()==='flujo')schedule(false);});
})();