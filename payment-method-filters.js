(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = cfg.financeSpreadsheetId;
  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let rows = [], loadedAt = 0, syncing = false;
  const state = {
    gastos:{account:[],method:[],payment:[]},
    flujo:{account:[],method:[],payment:[]}
  };

  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return [];
    const headers=(values[0]||[]).map(v=>String(v||'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!==''))
      .map(r=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,r?.[i]??''])));
  }

  function account(row){
    const raw=String(row['Cuenta / Tarjeta']||'').trim();
    const n=norm(raw), holder=norm(row.Titular);
    if(n.includes('efectivo')) return 'Efectivo';
    if(n.includes('nequi')) return holder.includes('ro')?'Nequi Ro':'Nequi Edu';
    if(n.includes('arq')) return 'ARQ Edu';
    if(n.includes('nu')) {
      if(n.includes(' ro')||n.endsWith('ro')||holder.includes('rocio')) return 'Nu Ro';
      if(n.includes('edu')||holder.includes('edu')) return 'Nu Edu';
      return 'Nu';
    }
    if(n.includes('transferencia')) return 'Transferencia sin cuenta';
    if(n.includes('debito')||n.includes('débito')) return 'Débito sin cuenta';
    return raw || 'Sin especificar';
  }

  function method(row){
    const explicit=String(row['Modalidad de pago']||'').trim();
    if(explicit)return explicit;
    const raw=norm(row['Cuenta / Tarjeta']);
    if(raw.includes('credito')||raw.includes('crédito'))return 'Crédito';
    if(raw.includes('transferencia'))return 'Transferencia';
    if(raw.includes('debito')||raw.includes('débito'))return 'Débito';
    if(raw.includes('efectivo'))return 'Efectivo';
    const q=Number(String(row.Cuotas||'').replace(/[^\d]/g,''));
    if(q>0&&(raw.includes('nu')||raw.includes('arq')))return 'Crédito';
    return 'Sin especificar';
  }

  function payment(row){
    const a=account(row), m=method(row);
    if(a==='Efectivo'&&m==='Efectivo')return 'Efectivo';
    if(a==='Sin especificar')return m;
    if(m==='Sin especificar')return a;
    return `${a} · ${m}`;
  }

  async function load(){
    if(rows.length && Date.now()-loadedAt<60000)return rows;
    if(!FINANCE_ID)return [];
    const backend=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
    if(backend && typeof window.__PANEL_GET_ID_TOKEN__==='function'){
      try{
        const token=await window.__PANEL_GET_ID_TOKEN__(false);
        const res=await fetch(`${backend}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
        if(res.ok){
          const data=await res.json();
          const matrix=data?.sources?.[`${FINANCE_ID}|Movimientos!A:Z`] || data?.sources?.[`${FINANCE_ID}|Movimientos!A:Y`];
          if(matrix){rows=parseRows(matrix);loadedAt=Date.now();return rows;}
        }
      }catch(_){ }
    }
    const token=window.__PANEL_GOOGLE_ACCESS_TOKEN__;
    if(!token||token==='backend')return [];
    const range='Movimientos!A:Z';
    const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(FINANCE_ID)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
    const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if(!res.ok)return [];
    const data=await res.json(); rows=parseRows(data.values||[]); loadedAt=Date.now(); return rows;
  }

  function activeView(){return document.querySelector('.nav-item.active')?.dataset.view||'';}
  function supported(view=activeView()){return view==='gastos'||view==='flujo';}
  function globalSelected(key){return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||''));}
  function parseDate(s){
    const v=String(s||'').trim();
    let m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(m)return new Date(+m[1],+m[2]-1,+m[3]);
    m=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    return null;
  }

  function periodMatch(row){
    const d=parseDate(row['Fecha real']||row['Fecha registrada']); if(!d)return false;
    const ys=globalSelected('year'), ms=globalSelected('month'), cs=globalSelected('category');
    if(ys.length&&!ys.includes(String(d.getFullYear())))return false;
    if(ms.length&&!ms.includes(String(d.getMonth()+1)))return false;
    if(cs.length&&!cs.includes(String(row['Categoría']||'')))return false;
    return true;
  }

  function ensureStyle(){
    if(document.getElementById('paymentFilterCompactStyle'))return;
    const style=document.createElement('style'); style.id='paymentFilterCompactStyle';
    style.textContent=`
      #filterBar.payment-filters-active #globalFilters{grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
      #paymentFilterRow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;grid-column:1/-1;border-top:1px solid #172233;padding-top:9px;margin-top:1px}
      #paymentFilterRow .multi-filter{min-width:0}
      #paymentFilterRow .multi-filter-menu{z-index:80}
      #paymentFilterRow .multi-filter-option span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      @media(max-width:720px){#filterBar.payment-filters-active #globalFilters,#paymentFilterRow{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}#paymentFilterRow .multi-filter-trigger{padding-left:8px;padding-right:8px}.filter-label-row span{font-size:9px}}
    `; document.head.appendChild(style);
  }

  function forceGlobalLayout(view){
    const global=document.getElementById('filterBar');
    if(!global)return;
    if(!supported(view)){global.classList.remove('payment-filters-active');return;}
    global.classList.add('payment-filters-active');
    const cat=document.querySelector('#globalFilters .multi-filter[data-filter="category"]');
    const sub=document.querySelector('#globalFilters .multi-filter[data-filter="subcategory"]');
    if(cat){cat.hidden=false;cat.removeAttribute('hidden');cat.style.display='';}
    if(sub){sub.hidden=true;sub.setAttribute('hidden','');sub.style.display='none';}
  }

  function makeFilter(key,label,allLabel){
    return `<div class="multi-filter payment-multi-filter" data-pay-filter="${key}">
      <div class="filter-label-row"><span>${esc(label)}</span></div>
      <button type="button" class="multi-filter-trigger" data-pay-trigger aria-expanded="false"><span data-pay-summary>${esc(allLabel)}</span><span class="filter-chevron">⌄</span></button>
      <div class="multi-filter-menu"><input class="multi-filter-search" data-pay-search placeholder="Buscar…" autocomplete="off"><div class="multi-filter-options" data-pay-options></div></div>
    </div>`;
  }

  function ensureUI(){
    const view=activeView(), grid=document.getElementById('globalFilters');
    if(!supported(view)){
      document.getElementById('paymentFilterRow')?.remove();
      forceGlobalLayout(view);
      return;
    }
    ensureStyle(); forceGlobalLayout(view);
    let row=document.getElementById('paymentFilterRow');
    if(!row){
      row=document.createElement('div'); row.id='paymentFilterRow';
      row.innerHTML=makeFilter('account','Cuenta / medio','Todos')+makeFilter('method','Modalidad','Todas')+makeFilter('payment','Medio de pago','Todos');
      grid?.appendChild(row);
      bindPaymentUI(row);
    }
    row.dataset.view=view;
  }

  function bindPaymentUI(row){
    row.querySelectorAll('[data-pay-filter]').forEach(root=>{
      root.querySelector('[data-pay-trigger]')?.addEventListener('click',e=>{
        e.stopPropagation();
        const opening=!root.classList.contains('open');
        row.querySelectorAll('.payment-multi-filter.open').forEach(x=>{x.classList.remove('open');x.querySelector('[data-pay-trigger]')?.setAttribute('aria-expanded','false');});
        if(opening){root.classList.add('open');root.querySelector('[data-pay-trigger]')?.setAttribute('aria-expanded','true');const input=root.querySelector('[data-pay-search]');if(input){input.value='';filterOptions(root,'');setTimeout(()=>input.focus(),0);}}
      });
      root.querySelector('[data-pay-search]')?.addEventListener('input',e=>filterOptions(root,e.target.value));
      root.querySelector('[data-pay-search]')?.addEventListener('click',e=>e.stopPropagation());
    });
  }

  function filterOptions(root,q){
    const query=norm(q);
    root.querySelectorAll('.multi-filter-option').forEach(btn=>btn.hidden=!!query&&!norm(btn.dataset.label||btn.dataset.value).includes(query));
  }

  function valuesFor(key,data){
    const fn=key==='account'?account:key==='method'?method:payment;
    return [...new Set(data.map(fn).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true,sensitivity:'base'}));
  }

  function renderOne(root,key,options,view){
    const selected=state[view][key];
    const box=root.querySelector('[data-pay-options]');
    box.innerHTML=options.length?options.map(value=>{
      const on=selected.includes(value);
      return `<button type="button" class="multi-filter-option${on?' selected':''}" data-value="${esc(value)}" data-label="${esc(value)}" aria-pressed="${on}"><span class="multi-filter-check">${on?'✓':''}</span><span>${esc(value)}</span></button>`;
    }).join(''):'<div class="multi-filter-empty">Sin opciones</div>';
    box.querySelectorAll('.multi-filter-option').forEach(btn=>btn.addEventListener('click',e=>{
      e.stopPropagation();
      const list=state[view][key], value=btn.dataset.value, i=list.indexOf(value);
      if(i>=0)list.splice(i,1); else list.push(value);
      renderOne(root,key,options,view);
      apply();
    }));
    const summary=root.querySelector('[data-pay-summary]');
    const allLabel=key==='method'?'Todas':'Todos';
    summary.textContent=!selected.length?allLabel:selected.length===1?selected[0]:`${selected.length} seleccionados`;
    root.classList.toggle('has-selection',selected.length>0);
  }

  async function populate(){
    const view=activeView(); if(!supported(view))return;
    const data=await load(); if(activeView()!==view)return;
    const filtered=data.filter(periodMatch);
    document.querySelectorAll('#paymentFilterRow [data-pay-filter]').forEach(root=>{
      const key=root.dataset.payFilter;
      renderOne(root,key,valuesFor(key,filtered),view);
    });
  }

  function matchesSelections(row,view){
    const st=state[view];
    return (!st.account.length||st.account.includes(account(row)))&&(!st.method.length||st.method.includes(method(row)))&&(!st.payment.length||st.payment.includes(payment(row)));
  }

  function formatAmountOriginal(v){
    const s=String(v??'').trim(); if(!s)return '';
    let n=Number(s.replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,''));
    if(!Number.isFinite(n))return s;
    return '$'+new Intl.NumberFormat('es-CO',{maximumFractionDigits:2}).format(n);
  }

  async function apply(){
    const view=activeView(); if(!supported(view))return;
    const data=(await load()).filter(r=>periodMatch(r)&&matchesSelections(r,view));
    window.__PAYMENT_FILTERED_MOVEMENTS__=data;
    window.__PAYMENT_FILTER_STATE__={view,account:[...state[view].account],method:[...state[view].method],payment:[...state[view].payment]};
    window.dispatchEvent(new CustomEvent('panel:payment-filters-change',{detail:window.__PAYMENT_FILTER_STATE__}));

    if(view==='gastos'){
      const panel=[...document.querySelectorAll('#viewRoot .panel')].find(p=>p.querySelector('.panel-title strong')?.textContent?.trim()==='Movimientos');
      const table=panel?.querySelector('table'); if(!table)return;
      const headers=['Fecha real','Tipo','Categoría','Descripción / Comercio','Monto original','Moneda original','Cuenta / Tarjeta','Titular','Modalidad de pago','Cuotas','N° cuota','Estado','Monto COP','Monto ARS','Monto USD'];
      table.querySelector('thead').innerHTML='<tr>'+headers.map(h=>`<th>${esc(h)}</th>`).join('')+'</tr>';
      table.querySelector('tbody').innerHTML=data.map(r=>'<tr>'+headers.map(h=>`<td>${h==='Monto original'?esc(formatAmountOriginal(r[h])):esc(h==='Modalidad de pago'?method(r):(r[h]??''))}</td>`).join('')+'</tr>').join('');
      const subtitle=panel.querySelector('.panel-title span'); if(subtitle)subtitle.textContent=`${data.length} movimientos según filtros`;
    }
  }

  function clearCustom(){
    ['gastos','flujo'].forEach(v=>{state[v].account=[];state[v].method=[];state[v].payment=[];});
  }

  async function sync(){
    if(syncing)return; syncing=true;
    try{ensureUI();if(supported()){await populate();await apply();}}finally{syncing=false;}
  }

  document.addEventListener('click',e=>{
    if(!e.target.closest('#paymentFilterRow .payment-multi-filter'))document.querySelectorAll('#paymentFilterRow .payment-multi-filter.open').forEach(x=>{x.classList.remove('open');x.querySelector('[data-pay-trigger]')?.setAttribute('aria-expanded','false');});
    if(e.target.closest('.nav-item')||e.target.closest('.multi-filter-option')||e.target.closest('#resetCurrentMonth'))setTimeout(sync,160);
    if(e.target.closest('#clearFilters')){clearCustom();setTimeout(sync,160);}
  },true);

  const root=document.getElementById('viewRoot');
  if(root)new MutationObserver(()=>setTimeout(sync,100)).observe(root,{childList:true,subtree:false});
  const start=()=>setTimeout(sync,650);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
