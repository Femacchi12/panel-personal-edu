(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!financeId)return;

  const MONTHS=['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  let frame=0;
  let scheduledForce=false;
  let sort={col:'Fecha real',dir:'desc'};
  let query='';
  let expanded=false;

  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';

  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const headers=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(row=>row?.some(v=>String(v??'').trim()!=='')).map(row=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,row?.[i]??''])));}
  function parseNumber(value){if(typeof value==='number')return Number.isFinite(value)?value:0;let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');if(comma>=0&&dot>=0){if(comma>dot)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(comma>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}else if(dot>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}
  function formatOriginal(row){const raw=row['Monto original'];const value=parseNumber(raw);const source=String(raw??'').trim();const decimalMatch=source.match(/[,.](\d{1,2})$/);const decimals=decimalMatch?decimalMatch[1].length:0;return `$${value.toLocaleString('es-CO',{minimumFractionDigits:decimals,maximumFractionDigits:decimals})}`;}
  function parseDate(value){const s=String(value??'').trim();if(!s)return null;let m=s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);if(m)return new Date(+m[1],+m[2]-1,+(m[3]||1));m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);const d=new Date(s);return Number.isNaN(d.getTime())?null:d;}

  function effectiveDate(row){
    const desc=[row['Descripción original'],row['Descripción / Comercio']].filter(Boolean).join(' ');let m=desc.match(/\((\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\)/i);if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    const baseMonth=String(row['Mes pago']||row['Mes consumo']||'').match(/^(20\d{2})-(\d{1,2})/);const fallback=parseDate(row['Fecha real']||row['Fecha registrada']);m=desc.match(/\(\s*d[ií]a\s*(\d{1,2})\s*\)/i);if(m){const day=+m[1];if(baseMonth)return new Date(+baseMonth[1],+baseMonth[2]-1,day);if(fallback)return new Date(fallback.getFullYear(),fallback.getMonth(),day);}return fallback;
  }
  const dateKey=row=>effectiveDate(row)?.getTime()||0;
  const dateLabel=row=>{const d=effectiveDate(row);return d?`${d.getFullYear()} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')}`:'—';};
  const expenseType=row=>/^(si|sí|true|1)$/i.test(String(row['Es fijo']||'').trim())?'Fijo':'Variable';
  const isRealExpense=row=>(norm(row.Tipo)==='gasto'||!row.Tipo)&&(window.MovementStatusCore?.isActual(row.Estado)??!/proyecc|proyect|programad/.test(norm(row.Estado)));
  const selectedGlobal=key=>[...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(el=>String(el.dataset.value||'').trim()).filter(Boolean);

  function account(row){const raw=String(row['Cuenta / Tarjeta']||'').trim(),n=norm(raw),holder=norm(row.Titular);if(n.includes('efectivo'))return'Efectivo';if(n.includes('nequi'))return holder.includes('ro')?'Nequi Ro':'Nequi Edu';if(n.includes('arq'))return'ARQ Edu';if(n.includes('nu'))return(n.includes(' ro')||n.endsWith('ro')||holder.includes('rocio')||holder==='ro')?'Nu Ro':'Nu Edu';if(n.includes('transferencia'))return'Transferencia sin cuenta';if(n.includes('debito'))return'Débito sin cuenta';return raw||'Sin especificar';}
  function method(row){const explicit=String(row['Modalidad de pago']||'').trim();if(explicit)return explicit;const raw=norm(row['Cuenta / Tarjeta']);if(raw.includes('credito'))return'Crédito';if(raw.includes('transferencia'))return'Transferencia';if(raw.includes('debito'))return'Débito';if(raw.includes('efectivo'))return'Efectivo';const q=parseNumber(row.Cuotas);if(q>0&&(raw.includes('nu')||raw.includes('arq')))return'Crédito';return'Sin especificar';}

  function filteredRows(rows){
    const years=selectedGlobal('year'),months=selectedGlobal('month').map(Number),cats=selectedGlobal('category'),subs=selectedGlobal('subcategory');
    const payment=window.__PAYMENT_FILTER_STATE__?.view==='gastos'?window.__PAYMENT_FILTER_STATE__:{account:[],method:[]};
    return rows.filter(row=>{
      if(!isRealExpense(row))return false;const d=effectiveDate(row);
      if(years.length&&(!d||!years.includes(String(d.getFullYear()))))return false;
      if(months.length&&(!d||!months.includes(d.getMonth()+1)))return false;
      if(cats.length&&!cats.includes(String(row['Categoría']||'')))return false;
      if(subs.length&&!subs.includes(String(row['Subcategoría']||'')))return false;
      if(payment.account?.length&&!payment.account.includes(account(row)))return false;
      if(payment.method?.length&&!payment.method.includes(method(row)))return false;
      return true;
    });
  }

  async function rows(force=false){
    const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')return[];
    const payload=await getData(force);return parseRows(payload?.sources?.[`${financeId}|Movimientos!A:Z`]||[]);
  }

  function valueFor(row,col){if(col==='Fecha real')return dateLabel(row);if(col==='Tipo de gasto')return expenseType(row);if(col==='Monto original')return formatOriginal(row);if(col==='Modalidad de pago')return method(row);return row[col]??'';}
  function compare(a,b,col){if(col==='Fecha real')return dateKey(a)-dateKey(b);if(['Monto original','Monto COP','Monto ARS','Monto USD','Cuotas','N° cuota'].includes(col))return parseNumber(a[col])-parseNumber(b[col]);return String(valueFor(a,col)).localeCompare(String(valueFor(b,col)),'es',{numeric:true,sensitivity:'base'});}
  const columns=['Fecha real','Tipo de gasto','Tipo','Categoría','Subcategoría','Descripción / Comercio','Monto original','Moneda original','Cuenta / Tarjeta','Modalidad de pago','Titular','Cuotas','N° cuota','Estado','Monto COP','Monto ARS','Monto USD'];

  function renderTable(host,rows){
    let data=rows.slice();if(query){const q=norm(query);data=data.filter(r=>norm(columns.map(c=>valueFor(r,c)).join(' ')).includes(q));}data.sort((a,b)=>compare(a,b,sort.col)*(sort.dir==='desc'?-1:1));const visible=expanded?data:data.slice(0,15);
    host.innerHTML=`<div class="panel-header"><div class="panel-title"><strong>Movimientos</strong><span>${data.length} de ${rows.length} gastos realizados · filtros consolidados</span></div><div class="table-toolbar"><input id="expenseAdvancedSearch" class="search-input" placeholder="Buscar en la tabla…" value="${esc(query)}"></div></div><div class="table-scroll${expanded?' expanded':''}"><table class="date-first-table expense-advanced-table"><thead><tr>${columns.map(c=>`<th data-expense-sort="${esc(c)}">${esc(c)}${sort.col===c?(sort.dir==='asc'?' ↑':' ↓'):''}</th>`).join('')}</tr></thead><tbody>${visible.map(r=>`<tr>${columns.map(c=>`<td data-date-sort="${c==='Fecha real'?dateKey(r):''}">${esc(valueFor(r,c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${data.length>15?`<button type="button" class="show-more" id="expenseAdvancedMore">${expanded?'Ver menos':`Ver más (${data.length-15})`}</button>`:''}`;
    host.querySelectorAll('[data-expense-sort]').forEach(th=>th.addEventListener('click',()=>{const col=th.dataset.expenseSort;if(sort.col===col)sort.dir=sort.dir==='asc'?'desc':'asc';else sort={col,dir:'asc'};renderTable(host,rows);}));
    host.querySelector('#expenseAdvancedSearch')?.addEventListener('input',event=>{query=event.target.value;expanded=false;renderTable(host,rows);requestAnimationFrame(()=>{const input=host.querySelector('#expenseAdvancedSearch');if(input){input.focus();input.setSelectionRange(query.length,query.length);}});});
    host.querySelector('#expenseAdvancedMore')?.addEventListener('click',()=>{expanded=!expanded;renderTable(host,rows);});
  }

  async function run(force=false){
    if(activeView()!=='gastos')return;const root=document.getElementById('viewRoot');if(!root)return;
    const original=[...root.querySelectorAll(':scope > .panel')].find(panel=>panel.querySelector('.panel-title strong')?.textContent?.trim()==='Movimientos');if(!original)return;original.style.display='none';
    let host=root.querySelector('#expenseAdvancedPanel');if(!host){host=document.createElement('div');host.id='expenseAdvancedPanel';host.className='panel table-panel';original.insertAdjacentElement('afterend',host);}
    const data=await rows(force).catch(error=>{console.error('Tabla avanzada de gastos:',error);return[];});
    if(activeView()!=='gastos'||!host.isConnected)return;
    renderTable(host,filteredRows(data));
  }

  function schedule(force=false){
    scheduledForce=scheduledForce||force;
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      const useForce=scheduledForce;
      scheduledForce=false;
      run(useForce).catch(error=>console.error('Tabla avanzada de gastos:',error));
    });
  }
  document.addEventListener('panel:view-root-changed',event=>{if(event.detail?.view==='gastos')schedule(false);});
  document.addEventListener('panel:payment-filters-changed',event=>{if(event.detail?.view==='gastos')schedule(false);});
  queueMicrotask(()=>schedule(false));
})();
