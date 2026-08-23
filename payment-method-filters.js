(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = cfg.financeSpreadsheetId;
  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  let rows = [];
  let loadedAt = 0;
  const state = { account:'', method:'' };

  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return [];
    const headers=(values[0]||[]).map(v=>String(v||'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!==''))
      .map(r=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,r?.[i]??''])));
  }

  function account(row){
    const raw=norm(row['Cuenta / Tarjeta']);
    const holder=norm(row.Titular);
    if(raw.includes('efectivo')) return 'Efectivo';
    if(raw.includes('nequi')) return holder.includes('ro')?'Nequi Ro':'Nequi Edu';
    if(raw.includes('arq')) return 'ARQ Edu';
    if(raw.includes('nu')) {
      if(raw.includes(' ro')||raw.endsWith('ro')||holder.includes('rocio')) return 'Nu Ro';
      if(raw.includes('edu')||holder.includes('edu')) return 'Nu Edu';
      return 'Nu';
    }
    if(raw.includes('transferencia')) return 'Transferencia (sin cuenta)';
    if(raw.includes('debito')||raw.includes('débito')) return 'Débito (sin cuenta)';
    return row['Cuenta / Tarjeta'] || 'Sin especificar';
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
    const token=window.__PANEL_GOOGLE_ACCESS_TOKEN__;
    if(!token||!FINANCE_ID)return [];
    const range='Movimientos!A:Z';
    const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(FINANCE_ID)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
    const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if(!res.ok)return [];
    const data=await res.json();
    rows=parseRows(data.values||[]); loadedAt=Date.now(); return rows;
  }

  function activeView(){return document.querySelector('.nav-item.active')?.dataset.view||'';}
  function globalSelected(key){return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>x.dataset.value);}
  function parseDate(s){const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?new Date(+m[1],+m[2]-1,+m[3]):null;}

  function periodMatch(row){
    const d=parseDate(row['Fecha real']||row['Fecha registrada']); if(!d)return false;
    const ys=globalSelected('year'), ms=globalSelected('month'), cs=globalSelected('category'), ss=globalSelected('subcategory');
    if(ys.length&&!ys.includes(String(d.getFullYear())))return false;
    if(ms.length&&!ms.includes(String(d.getMonth()+1)))return false;
    if(cs.length&&!cs.includes(row['Categoría']||''))return false;
    if(ss.length&&!ss.includes(row['Subcategoría']||''))return false;
    return true;
  }

  function ensureUI(){
    if(activeView()!=='gastos'){document.getElementById('paymentMethodFilterBar')?.remove();return;}
    if(document.getElementById('paymentMethodFilterBar'))return;
    const global=document.getElementById('filterBar'); if(!global)return;
    const bar=document.createElement('section');
    bar.id='paymentMethodFilterBar'; bar.className='filter-bar section-filter-bar';
    bar.innerHTML=`<div class="filter-head"><div><span class="eyebrow">MEDIO DE PAGO</span><strong>Cuenta y modalidad</strong></div><div class="filter-actions"><button type="button" class="text-btn" data-pay-clear>Borrar filtros</button></div></div><div class="section-filter-grid"><label class="payment-native-filter"><span>Cuenta / medio</span><select data-pay-account><option value="">Todos</option></select></label><label class="payment-native-filter"><span>Modalidad</span><select data-pay-method><option value="">Todas</option></select></label></div>`;
    global.insertAdjacentElement('afterend',bar);
    const style=document.createElement('style'); style.textContent='.payment-native-filter{display:flex;flex-direction:column;gap:7px;font-size:12px;color:#8fa0b7}.payment-native-filter select{min-height:38px;border-radius:9px;border:1px solid #1b293a;background:#09111d;color:#dce6f3;padding:0 10px;font:inherit}'; document.head.appendChild(style);
    bar.querySelector('[data-pay-account]').addEventListener('change',e=>{state.account=e.target.value;apply();});
    bar.querySelector('[data-pay-method]').addEventListener('change',e=>{state.method=e.target.value;apply();});
    bar.querySelector('[data-pay-clear]').addEventListener('click',()=>{state.account='';state.method='';populate();apply();});
    populate();
  }

  async function populate(){
    const data=await load(); if(activeView()!=='gastos')return;
    const a=document.querySelector('[data-pay-account]'),m=document.querySelector('[data-pay-method]'); if(!a||!m)return;
    const accounts=[...new Set(data.map(account).filter(Boolean))].sort((x,y)=>x.localeCompare(y,'es'));
    const methods=[...new Set(data.map(method).filter(Boolean))].sort((x,y)=>x.localeCompare(y,'es'));
    a.innerHTML='<option value="">Todos</option>'+accounts.map(v=>`<option${v===state.account?' selected':''}>${v}</option>`).join('');
    m.innerHTML='<option value="">Todas</option>'+methods.map(v=>`<option${v===state.method?' selected':''}>${v}</option>`).join('');
  }

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function apply(){
    if(activeView()!=='gastos')return;
    const data=(await load()).filter(r=>periodMatch(r)&&(!state.account||account(r)===state.account)&&(!state.method||method(r)===state.method));
    const panels=[...document.querySelectorAll('#viewRoot .panel')];
    const panel=panels.find(p=>p.querySelector('.panel-title strong')?.textContent?.trim()==='Movimientos');
    const table=panel?.querySelector('table'); if(!table)return;
    const headers=['Fecha real','Tipo','Categoría','Subcategoría','Descripción / Comercio','Monto original','Moneda original','Cuenta / Tarjeta','Titular','Modalidad de pago','Cuotas','N° cuota','Estado','Monto COP','Monto ARS','Monto USD'];
    table.querySelector('thead').innerHTML='<tr>'+headers.map(h=>`<th>${esc(h)}</th>`).join('')+'</tr>';
    table.querySelector('tbody').innerHTML=data.map(r=>'<tr>'+headers.map(h=>`<td>${esc(h==='Modalidad de pago'?method(r):(r[h]??''))}</td>`).join('')+'</tr>').join('');
    const subtitle=panel.querySelector('.panel-title span'); if(subtitle)subtitle.textContent=`${data.length} movimientos según filtros de cuenta/modalidad`;
  }

  async function sync(){ensureUI(); if(activeView()==='gastos'){await populate();setTimeout(apply,100);}}
  document.addEventListener('click',e=>{if(e.target.closest('.nav-item')||e.target.closest('.multi-filter-option')||e.target.closest('#resetCurrentMonth')||e.target.closest('#clearFilters'))setTimeout(sync,180);});
  const root=document.getElementById('viewRoot'); if(root)new MutationObserver(()=>setTimeout(sync,100)).observe(root,{childList:true,subtree:false});
  const start=()=>setTimeout(sync,700); if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
