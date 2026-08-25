(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = cfg.financeSpreadsheetId;
  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let rows = [];
  let loadedAt = 0;
  let reconcileTimer = null;
  const state = {
    gastos:{account:[],method:[]},
    flujo:{account:[],method:[]}
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
      if(n.includes(' ro')||n.endsWith('ro')||holder.includes('rocio')||holder==='ro') return 'Nu Ro';
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

  async function load(){
    if(rows.length && Date.now()-loadedAt<60000)return rows;
    if(!FINANCE_ID)return [];
    const backend=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
    const getIdToken=window.__PANEL_GET_ID_TOKEN__;
    if(backend&&typeof getIdToken==='function'){
      try{
        const token=await getIdToken(false);
        const res=await fetch(`${backend}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
        if(res.ok){
          const data=await res.json();
          const matrix=data?.sources?.[`${FINANCE_ID}|Movimientos!A:Z`]||data?.sources?.[`${FINANCE_ID}|Movimientos!A:Y`];
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
    const data=await res.json(); rows=parseRows(data.values||[]);loadedAt=Date.now();return rows;
  }

  function activeView(){return document.querySelector('.nav-item.active')?.dataset.view||'';}
  function supported(view=activeView()){return view==='gastos'||view==='flujo';}
  function globalSelected(key){return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||'').trim()).filter(Boolean);}
  function parseDate(s){
    const v=String(s||'').trim();
    let m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);
    m=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    return null;
  }

  function periodMatch(row){
    const d=parseDate(row['Fecha real']||row['Fecha registrada']);if(!d)return false;
    const ys=globalSelected('year'),ms=globalSelected('month'),cs=globalSelected('category');
    if(ys.length&&!ys.includes(String(d.getFullYear())))return false;
    if(ms.length&&!ms.includes(String(d.getMonth()+1)))return false;
    if(cs.length&&!cs.includes(String(row['Categoría']||'')))return false;
    return true;
  }

  function ensureStyle(){
    if(document.getElementById('stablePaymentFilterStyles'))return;
    const style=document.createElement('style');style.id='stablePaymentFilterStyles';
    style.textContent=`
      #paymentMethodFilterBar{margin-top:-1px!important;border-top:0!important;border-top-left-radius:0!important;border-top-right-radius:0!important;padding-top:0!important}
      #paymentMethodFilterBar>.filter-head{display:none!important}
      #paymentMethodFilterBar::before{content:"";display:block;height:1px;background:var(--border-soft);margin:0 0 10px}
      #paymentMethodFilterBar .section-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
      #paymentMethodFilterBar .multi-filter{min-width:0}
      .main>#filterBar:not([hidden]):has(+ #paymentMethodFilterBar:not([hidden])){margin-bottom:0!important;border-bottom-left-radius:0!important;border-bottom-right-radius:0!important;border-bottom-color:transparent!important;padding-bottom:10px!important}
      #paymentMethodFilterBar[hidden]{display:none!important}
      @media(max-width:720px){#paymentMethodFilterBar .section-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}#paymentMethodFilterBar .multi-filter-trigger{padding-left:8px;padding-right:8px;font-size:11px}.multi-filter-menu{min-width:180px}}
    `;document.head.appendChild(style);
  }

  function ensureBar(){
    let bar=document.getElementById('paymentMethodFilterBar');
    if(bar)return bar;
    const filterBar=document.getElementById('filterBar');
    if(!filterBar)return null;
    bar=document.createElement('section');
    bar.id='paymentMethodFilterBar';
    bar.className='filter-bar section-filter-bar';
    bar.hidden=true;
    bar.innerHTML='<div class="section-filter-grid"></div>';
    filterBar.insertAdjacentElement('afterend',bar);
    return bar;
  }

  function filterDef(key,label,getter){return {key,label,getter};}
  const defs=[filterDef('account','Cuenta / medio',account),filterDef('method','Modalidad',method)];
  function selected(view,key){return state[view]?.[key]||[];}

  function renderFilter(def,options,view){
    const values=selected(view,def.key);
    const summary=!values.length?'Todos':values.length===1?values[0]:`${values.length} seleccionados`;
    const root=document.createElement('div');
    root.className=`multi-filter stable-payment-filter${values.length?' has-selection':''}`;
    root.dataset.payKey=def.key;
    root.innerHTML=`<div class="filter-label-row"><span>${esc(def.label)}</span></div>
      <button type="button" class="multi-filter-trigger pay-trigger" aria-expanded="false"><span class="pay-summary">${esc(summary)}</span><span class="filter-chevron">⌄</span></button>
      <div class="multi-filter-menu pay-menu"><input class="multi-filter-search pay-search" placeholder="Buscar…" autocomplete="off"><div class="multi-filter-options pay-options"></div></div>`;
    const box=root.querySelector('.pay-options');
    box.innerHTML=options.length?options.map(value=>{
      const on=values.includes(value);
      return `<button type="button" class="multi-filter-option pay-option${on?' selected':''}" data-value="${esc(value)}" aria-pressed="${on}"><span class="multi-filter-check">${on?'✓':''}</span><span>${esc(value)}</span></button>`;
    }).join(''):'<div class="multi-filter-empty">Sin opciones</div>';

    root.querySelector('.pay-trigger')?.addEventListener('click',event=>{
      event.stopPropagation();
      document.querySelectorAll('.stable-payment-filter.open').forEach(x=>{if(x!==root){x.classList.remove('open');x.querySelector('.pay-trigger')?.setAttribute('aria-expanded','false')}});
      root.classList.toggle('open');
      root.querySelector('.pay-trigger')?.setAttribute('aria-expanded',root.classList.contains('open')?'true':'false');
      if(root.classList.contains('open'))setTimeout(()=>root.querySelector('.pay-search')?.focus(),0);
    });
    root.querySelector('.pay-search')?.addEventListener('input',event=>{
      const q=norm(event.target.value);
      root.querySelectorAll('.pay-option').forEach(btn=>{
        const show=!q||norm(btn.dataset.value).includes(q);
        btn.hidden=!show;
        btn.style.display=show?'':'none';
      });
    });
    root.querySelectorAll('.pay-option').forEach(btn=>btn.addEventListener('click',event=>{
      event.stopPropagation();
      const value=btn.dataset.value;
      const list=selected(view,def.key);
      const i=list.indexOf(value);if(i>=0)list.splice(i,1);else list.push(value);
      state[view][def.key]=list;
      reconcile(true);
    }));
    return root;
  }

  async function renderBar(view){
    const bar=ensureBar();if(!bar)return;
    if(!supported(view)){bar.hidden=true;return;}
    bar.hidden=false;
    const data=(await load()).filter(periodMatch);
    if(activeView()!==view)return;
    const grid=bar.querySelector('.section-filter-grid');
    grid.innerHTML='';
    defs.forEach(def=>{
      const options=[...new Set(data.map(def.getter).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true,sensitivity:'base'}));
      grid.appendChild(renderFilter(def,options,view));
    });
  }

  function alignGlobalFilters(view){
    const filterBar=document.getElementById('filterBar');
    if(!filterBar)return;
    const sub=document.querySelector('#globalFilters .multi-filter[data-filter="subcategory"]');
    const cat=document.querySelector('#globalFilters .multi-filter[data-filter="category"]');
    if(supported(view)){
      if(sub)sub.hidden=true;
      if(cat)cat.hidden=false;
      filterBar.hidden=false;
    }
  }

  function rowMatchesPayment(row,view){
    const st=state[view];
    return (!st.account.length||st.account.includes(account(row)))&&(!st.method.length||st.method.includes(method(row)));
  }

  async function apply(view){
    if(!supported(view))return;
    const data=(await load()).filter(r=>periodMatch(r)&&rowMatchesPayment(r,view));
    window.__PAYMENT_FILTER_STATE__={view,account:[...state[view].account],method:[...state[view].method]};
    window.__PAYMENT_FILTERED_MOVEMENTS__=data;

    if(view==='gastos'){
      const panels=[...document.querySelectorAll('#viewRoot .panel')];
      const panel=panels.find(p=>p.querySelector('.panel-title strong')?.textContent?.trim()==='Movimientos');
      const table=panel?.querySelector('table');
      if(table){
        const headers=['Fecha real','Tipo','Categoría','Descripción / Comercio','Monto original','Moneda original','Cuenta / Tarjeta','Titular','Modalidad de pago','Cuotas','N° cuota','Estado','Monto COP','Monto ARS','Monto USD'];
        table.querySelector('thead').innerHTML='<tr>'+headers.map(h=>`<th>${esc(h)}</th>`).join('')+'</tr>';
        table.querySelector('tbody').innerHTML=data.map(r=>'<tr>'+headers.map(h=>`<td>${esc(h==='Modalidad de pago'?method(r):(r[h]??''))}</td>`).join('')+'</tr>').join('');
        const subtitle=panel.querySelector('.panel-title span');if(subtitle)subtitle.textContent=`${data.length} movimientos según filtros`;
      }
    }
    document.dispatchEvent(new CustomEvent('panel:payment-filters-changed',{detail:window.__PAYMENT_FILTER_STATE__}));
  }

  async function reconcile(forceApply=false){
    clearTimeout(reconcileTimer);
    const view=activeView();
    ensureStyle();ensureBar();alignGlobalFilters(view);
    await renderBar(view);
    if(forceApply||supported(view))setTimeout(()=>apply(view),60);
  }

  function schedule(delay=80,force=false){clearTimeout(reconcileTimer);reconcileTimer=setTimeout(()=>reconcile(force),delay);}

  document.addEventListener('click',event=>{
    if(!event.target.closest('.stable-payment-filter'))document.querySelectorAll('.stable-payment-filter.open').forEach(x=>{x.classList.remove('open');x.querySelector('.pay-trigger')?.setAttribute('aria-expanded','false')});
    if(event.target.closest('.nav-item'))schedule(140,true);
    if(event.target.closest('.multi-filter-option')||event.target.closest('#resetCurrentMonth')||event.target.closest('#clearFilters'))schedule(140,true);
  },true);

  document.addEventListener('panel:filters-updated',()=>schedule(100,true));

  const start=()=>{ensureStyle();ensureBar();schedule(500,true);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
