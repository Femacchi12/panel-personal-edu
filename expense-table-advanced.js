(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  let cache = null;
  let cacheAt = 0;
  let timer = null;
  let sort = {col:'Fecha real',dir:'desc'};
  let query = '';
  let expanded = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function activeView(){return document.querySelector('.nav-item.active')?.dataset.view || '';}

  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return[];
    const headers=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(row=>row?.some(v=>String(v??'').trim()!==''))
      .map(row=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,row?.[i]??''])));
  }

  function parseNumber(value){
    if(typeof value==='number')return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');
    if(!s)return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0){if(comma>dot)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
    else if(comma>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(dot>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function parseDate(value){
    const s=String(value??'').trim();if(!s)return null;
    let m=s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);if(m)return new Date(+m[1],+m[2]-1,+(m[3]||1));
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    const d=new Date(s);return Number.isNaN(d.getTime())?null:d;
  }

  function effectiveDate(row){
    const desc=[row['Descripción original'],row['Descripción / Comercio']].filter(Boolean).join(' ');
    let m=desc.match(/\((\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\)/i);
    if(m)return new Date(+m[3],+m[2]-1,+m[1]);

    const baseMonth=String(row['Mes pago']||row['Mes consumo']||'').match(/^(20\d{2})-(\d{1,2})/);
    const fallback=parseDate(row['Fecha real']||row['Fecha registrada']);
    m=desc.match(/\(\s*d[ií]a\s*(\d{1,2})\s*\)/i);
    if(m){
      const day=+m[1];
      if(baseMonth)return new Date(+baseMonth[1],+baseMonth[2]-1,day);
      if(fallback)return new Date(fallback.getFullYear(),fallback.getMonth(),day);
    }
    return fallback;
  }

  function dateKey(row){return effectiveDate(row)?.getTime()||0;}
  function dateLabel(row){const d=effectiveDate(row);return d?`${d.getFullYear()} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')}`:'—';}
  function expenseType(row){return /^(si|sí|true|1)$/i.test(String(row['Es fijo']||'').trim())?'Fijo':'Variable';}
  function isRealExpense(row){
    if(norm(row.Tipo)!=='gasto' && row.Tipo)return false;
    return window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad/.test(norm(row.Estado));
  }

  function selectedGlobal(key){
    return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
      .map(el=>String(el.dataset.value||'').trim()).filter(Boolean);
  }

  function filteredRows(rows){
    const years=selectedGlobal('year');
    const months=selectedGlobal('month').map(Number);
    const cats=selectedGlobal('category');
    const subs=selectedGlobal('subcategory');
    return rows.filter(row=>{
      if(!isRealExpense(row))return false;
      const d=effectiveDate(row);
      if(years.length&&(!d||!years.includes(String(d.getFullYear()))))return false;
      if(months.length&&(!d||!months.includes(d.getMonth()+1)))return false;
      if(cats.length&&!cats.includes(String(row['Categoría']||'')))return false;
      if(subs.length&&!subs.includes(String(row['Subcategoría']||'')))return false;
      return true;
    });
  }

  async function payload(force=false){
    if(!force&&cache&&Date.now()-cacheAt<55_000)return cache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false);if(!token)throw new Error('Sesión no disponible');
    const response=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if(!response.ok)throw new Error(`Backend ${response.status}`);
    cache=await response.json();cacheAt=Date.now();return cache;
  }

  function valueFor(row,col){
    if(col==='Fecha real')return dateLabel(row);
    if(col==='Tipo de gasto')return expenseType(row);
    return row[col]??'';
  }

  function compare(a,b,col){
    if(col==='Fecha real')return dateKey(a)-dateKey(b);
    if(['Monto original','Monto COP','Monto ARS','Monto USD','Cuotas','N° cuota'].includes(col))return parseNumber(a[col])-parseNumber(b[col]);
    return String(valueFor(a,col)).localeCompare(String(valueFor(b,col)),'es',{numeric:true,sensitivity:'base'});
  }

  const columns=['Fecha real','Tipo de gasto','Tipo','Categoría','Subcategoría','Descripción / Comercio','Monto original','Moneda original','Cuenta / Tarjeta','Modalidad de pago','Titular','Cuotas','N° cuota','Estado','Monto COP','Monto ARS','Monto USD'];

  function renderTable(host,rows){
    let data=rows.slice();
    if(query){const q=norm(query);data=data.filter(r=>norm(columns.map(c=>valueFor(r,c)).join(' ')).includes(q));}
    data.sort((a,b)=>compare(a,b,sort.col)*(sort.dir==='desc'?-1:1));
    const visible=expanded?data:data.slice(0,15);
    host.innerHTML=`
      <div class="panel-header"><div class="panel-title"><strong>Movimientos</strong><span>${data.length} de ${rows.length} gastos realizados · fuente Movimientos A:Z</span></div>
        <div class="table-toolbar"><input id="expenseAdvancedSearch" class="search-input" placeholder="Buscar en la tabla…" value="${esc(query)}"></div></div>
      <div class="table-scroll${expanded?' expanded':''}"><table class="date-first-table expense-advanced-table"><thead><tr>${columns.map(c=>`<th data-expense-sort="${esc(c)}">${esc(c)}${sort.col===c?(sort.dir==='asc'?' ↑':' ↓'):''}</th>`).join('')}</tr></thead>
      <tbody>${visible.map(r=>`<tr>${columns.map(c=>`<td data-date-sort="${c==='Fecha real'?dateKey(r):''}">${esc(valueFor(r,c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${data.length>15?`<button type="button" class="show-more" id="expenseAdvancedMore">${expanded?'Ver menos':`Ver más (${data.length-15})`}</button>`:''}`;

    host.querySelectorAll('[data-expense-sort]').forEach(th=>th.addEventListener('click',()=>{
      const col=th.dataset.expenseSort;
      if(sort.col===col)sort.dir=sort.dir==='asc'?'desc':'asc';else sort={col,dir:'asc'};
      renderTable(host,rows);
    }));
    host.querySelector('#expenseAdvancedSearch')?.addEventListener('input',event=>{
      query=event.target.value;expanded=false;renderTable(host,rows);
      requestAnimationFrame(()=>{const input=host.querySelector('#expenseAdvancedSearch');if(input){input.focus();input.setSelectionRange(query.length,query.length);}});
    });
    host.querySelector('#expenseAdvancedMore')?.addEventListener('click',()=>{expanded=!expanded;renderTable(host,rows);});
  }

  async function run(force=false){
    if(activeView()!=='gastos')return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const original=[...root.querySelectorAll(':scope > .panel')].find(panel=>panel.querySelector('.panel-title strong')?.textContent?.trim()==='Movimientos');
    if(!original)return;
    original.style.display='none';
    let host=root.querySelector('#expenseAdvancedPanel');
    if(!host){host=document.createElement('div');host.id='expenseAdvancedPanel';host.className='panel table-panel';original.insertAdjacentElement('afterend',host);}
    const p=await payload(force).catch(error=>{console.error('Tabla avanzada de gastos:',error);return null;});if(!p)return;
    const rows=parseRows(p.sources?.[`${financeId}|Movimientos!A:Z`]||[]);
    renderTable(host,filteredRows(rows));
  }

  function schedule(force=false,delay=120){clearTimeout(timer);timer=setTimeout(()=>run(force),delay);}
  document.addEventListener('click',event=>{
    if(event.target.closest('.nav-item,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters'))schedule(false,180);
    if(event.target.closest('#refreshBtn')){cache=null;cacheAt=0;schedule(true,500);}
  });
  const root=document.getElementById('viewRoot');if(root)new MutationObserver(()=>schedule(false,100)).observe(root,{childList:true,subtree:false});
  schedule(false,250);
})();
