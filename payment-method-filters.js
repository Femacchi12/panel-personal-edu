(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = cfg.financeSpreadsheetId;
  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  let rows = [];
  let loadedAt = 0;
  const state = { gastos:{account:'',method:'',payment:''}, flujo:{account:'',method:'',payment:''} };

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
    if(a==='Efectivo'&&m==='Efectivo') return 'Efectivo';
    if(a==='Sin especificar') return m;
    if(m==='Sin especificar') return a;
    return `${a} · ${m}`;
  }

  async function load(){
    if(rows.length && Date.now()-loadedAt<60000)return rows;
    if(!FINANCE_ID)return [];
    const getIdToken=window.__PANEL_GET_ID_TOKEN__;
    const backend=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
    if(backend && typeof getIdToken==='function'){
      try{
        const token=await getIdToken(false);
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
  function supported(){return ['gastos','flujo'].includes(activeView());}
  function globalSelected(key){return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>x.dataset.value);}
  function parseDate(s){const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?new Date(+m[1],+m[2]-1,+m[3]):null;}

  function periodMatch(row){
    const d=parseDate(row['Fecha real']||row['Fecha registrada']); if(!d)return false;
    const ys=globalSelected('year'), ms=globalSelected('month'), cs=globalSelected('category');
    if(ys.length&&!ys.includes(String(d.getFullYear())))return false;
    if(ms.length&&!ms.includes(String(d.getMonth()+1)))return false;
    if(cs.length&&!cs.includes(row['Categoría']||''))return false;
    return true;
  }

  function ensureStyle(){
    if(document.getElementById('paymentFilterCompactStyle'))return;
    const style=document.createElement('style'); style.id='paymentFilterCompactStyle';
    style.textContent=`
      #filterBar.payment-filters-active #globalFilters{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .payment-native-filter{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:11px;color:#8fa0b7}
      .payment-native-filter>span{font-size:10px;text-transform:uppercase;letter-spacing:.06em}
      .payment-native-filter select{width:100%;min-height:38px;border-radius:9px;border:1px solid #1b293a;background:#09111d;color:#dce6f3;padding:0 10px;font:inherit}
      .payment-filter-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;grid-column:1/-1;border-top:1px solid #172233;padding-top:10px;margin-top:2px}
      @media(max-width:720px){#filterBar.payment-filters-active #globalFilters{grid-template-columns:repeat(3,minmax(0,1fr))}.payment-filter-row{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.payment-native-filter select{font-size:11px;padding:0 7px}}
    `; document.head.appendChild(style);
  }

  function ensureUI(){
    const view=activeView();
    const global=document.getElementById('filterBar');
    const grid=document.getElementById('globalFilters');
    if(!supported()){
      document.getElementById('paymentFilterRow')?.remove();
      global?.classList.remove('payment-filters-active');
      return;
    }
    ensureStyle(); global?.classList.add('payment-filters-active');
    document.querySelector('.multi-filter[data-filter="subcategory"]')?.setAttribute('hidden','');
    if(document.getElementById('paymentFilterRow'))return;
    const row=document.createElement('div'); row.id='paymentFilterRow'; row.className='payment-filter-row';
    row.innerHTML=`
      <label class="payment-native-filter"><span>Cuenta / medio</span><select data-pay-account><option value="">Todos</option></select></label>
      <label class="payment-native-filter"><span>Modalidad</span><select data-pay-method><option value="">Todas</option></select></label>
      <label class="payment-native-filter"><span>Medio de pago</span><select data-pay-payment><option value="">Todos</option></select></label>`;
    grid?.appendChild(row);
    row.querySelector('[data-pay-account]').addEventListener('change',e=>{state[view].account=e.target.value;apply();});
    row.querySelector('[data-pay-method]').addEventListener('change',e=>{state[view].method=e.target.value;apply();});
    row.querySelector('[data-pay-payment]').addEventListener('change',e=>{state[view].payment=e.target.value;apply();});
    populate();
  }

  async function populate(){
    const view=activeView(); if(!supported())return;
    const data=await load(); if(activeView()!==view)return;
    const st=state[view];
    const a=document.querySelector('[data-pay-account]'),m=document.querySelector('[data-pay-method]'),p=document.querySelector('[data-pay-payment]'); if(!a||!m||!p)return;
    const filtered=data.filter(periodMatch);
    const accounts=[...new Set(filtered.map(account).filter(Boolean))].sort((x,y)=>x.localeCompare(y,'es'));
    const methods=[...new Set(filtered.map(method).filter(Boolean))].sort((x,y)=>x.localeCompare(y,'es'));
    const payments=[...new Set(filtered.map(payment).filter(Boolean))].sort((x,y)=>x.localeCompare(y,'es'));
    a.innerHTML='<option value="">Todos</option>'+accounts.map(v=>`<option value="${esc(v)}"${v===st.account?' selected':''}>${esc(v)}</option>`).join('');
    m.innerHTML='<option value="">Todas</option>'+methods.map(v=>`<option value="${esc(v)}"${v===st.method?' selected':''}>${esc(v)}</option>`).join('');
    p.innerHTML='<option value="">Todos</option>'+payments.map(v=>`<option value="${esc(v)}"${v===st.payment?' selected':''}>${esc(v)}</option>`).join('');
  }

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function apply(){
    const view=activeView(); if(!supported())return;
    const st=state[view];
    const data=(await load()).filter(r=>periodMatch(r)&&(!st.account||account(r)===st.account)&&(!st.method||method(r)===st.method)&&(!st.payment||payment(r)===st.payment));
    window.__PAYMENT_FILTERED_MOVEMENTS__=data;
    if(view==='gastos'){
      const panels=[...document.querySelectorAll('#viewRoot .panel')];
      const panel=panels.find(p=>p.querySelector('.panel-title strong')?.textContent?.trim()==='Movimientos');
      const table=panel?.querySelector('table'); if(!table)return;
      const headers=['Fecha real','Tipo','Categoría','Descripción / Comercio','Monto original','Moneda original','Cuenta / Tarjeta','Titular','Modalidad de pago','Cuotas','N° cuota','Estado','Monto COP','Monto ARS','Monto USD'];
      table.querySelector('thead').innerHTML='<tr>'+headers.map(h=>`<th>${esc(h)}</th>`).join('')+'</tr>';
      table.querySelector('tbody').innerHTML=data.map(r=>'<tr>'+headers.map(h=>`<td>${esc(h==='Modalidad de pago'?method(r):(r[h]??''))}</td>`).join('')+'</tr>').join('');
      const subtitle=panel.querySelector('.panel-title span'); if(subtitle)subtitle.textContent=`${data.length} movimientos según filtros de pago`;
    }
  }

  async function sync(){ensureUI(); if(supported()){await populate();setTimeout(apply,100);}}
  document.addEventListener('click',e=>{if(e.target.closest('.nav-item')||e.target.closest('.multi-filter-option')||e.target.closest('#resetCurrentMonth')||e.target.closest('#clearFilters'))setTimeout(sync,180);});
  const root=document.getElementById('viewRoot'); if(root)new MutationObserver(()=>setTimeout(sync,100)).observe(root,{childList:true,subtree:false});
  const start=()=>setTimeout(sync,700); if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
