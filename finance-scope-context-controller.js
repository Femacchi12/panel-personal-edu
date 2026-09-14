(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!financeId)return;
  let frame=0;

  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const selected=key=>[...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||'').trim()).filter(Boolean);
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';

  function num(value){if(typeof value==='number')return Number.isFinite(value)?value:0;let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0)s=c>d?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}
  function parseDate(value){const s=String(value??'').trim();let m=s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);if(m)return new Date(+m[1],+m[2]-1,+(m[3]||1));m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);return null;}
  function scopeOf(row){const value=norm(row['Ámbito']||row.Ambito);if(value.includes('fibrazo'))return'FIBRAZO';if(value.includes('personal'))return'Personal';return norm([row['Descripción / Comercio'],row['Descripción original'],row.Observaciones,row.Fuente].filter(Boolean).join(' ')).includes('fibrazo')?'FIBRAZO':'Personal';}
  function isExpense(row){const status=norm(row.Estado),type=norm(row.Tipo||row.Naturaleza||'gasto');return !/proyecc|proyect|programad|pendiente/.test(status)&&(!type||type.includes('gasto')||type.includes('egreso')||type.includes('compra'));}
  function method(row){if(typeof window.FinancePurchasePolicy?.method==='function')return window.FinancePurchasePolicy.method(row);return String(row['Modalidad de pago']||'').trim();}
  function account(row){const raw=String(row['Cuenta / Tarjeta']||'').trim(),n=norm(raw),holder=norm(row.Titular);if(n.includes('efectivo'))return'Efectivo';if(n.includes('nequi'))return holder.includes('ro')?'Nequi Ro':'Nequi Edu';if(n.includes('arq'))return'ARQ Edu';if(n.includes('nu'))return n.includes(' ro')||holder.includes('rocio')?'Nu Ro':'Nu Edu';return raw||'Sin especificar';}
  function money(v){return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);}
  function pct(v){return new Intl.NumberFormat('es-CO',{minimumFractionDigits:0,maximumFractionDigits:1}).format(Number(v)||0);}

  async function rows(){const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')return[];const data=await getData(false),cached=window.__PANEL_GET_CACHED_ROWS__;if(typeof cached==='function'){const wide=cached(data,financeId,'Movimientos!A:AA');if(wide.length)return wide;return cached(data,financeId,'Movimientos!A:Z');}return[];}

  function filtered(source){
    const years=new Set(selected('year')),months=new Set(selected('month')),cats=new Set(selected('category')),subs=new Set(selected('subcategory'));
    const pay=window.__PAYMENT_FILTER_STATE__?.view==='gastos'?window.__PAYMENT_FILTER_STATE__:{account:[],method:[]};
    const accounts=new Set(pay.account||[]),methods=new Set(pay.method||[]),scope=window.__FINANCE_SCOPE_FILTER_STATE__?.gastos||'Personal';
    return source.filter(row=>{if(!isExpense(row))return false;if(scope!=='Todos'&&scopeOf(row)!==scope)return false;const d=parseDate(row['Fecha real']||row['Fecha registrada']);if(years.size&&(!d||!years.has(String(d.getFullYear()))))return false;if(months.size&&(!d||!months.has(String(d.getMonth()+1))))return false;if(cats.size&&!cats.has(String(row['Categoría']||'')))return false;if(subs.size&&!subs.has(String(row['Subcategoría']||'')))return false;if(accounts.size&&!accounts.has(account(row)))return false;if(methods.size&&!methods.has(method(row)))return false;return true;});
  }

  async function render(){
    if(activeView()!=='gastos')return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const data=filtered(await rows());if(activeView()!=='gastos')return;
    const total=data.reduce((s,r)=>s+num(r['Monto COP']),0),fixed=data.filter(r=>/^(si|sí|true|1)$/i.test(String(r['Es fijo']||''))).reduce((s,r)=>s+num(r['Monto COP']),0),credit=data.filter(r=>norm(method(r))==='credito').reduce((s,r)=>s+num(r['Monto COP']),0);
    const days=new Set(data.map(r=>String(r['Fecha real']||'')).filter(Boolean));
    const biggest=data.slice().sort((a,b)=>num(b['Monto COP'])-num(a['Monto COP']))[0]||null;
    const scope=window.__FINANCE_SCOPE_FILTER_STATE__?.gastos||'Personal';
    let host=root.querySelector(':scope > .finance-context');
    if(!host){host=document.createElement('section');host.className='finance-context';const head=root.querySelector(':scope > .section-head');if(head)head.insertAdjacentElement('afterend',host);else root.prepend(host);}
    host.innerHTML=`<div class="finance-context-head"><div><span>LECTURA DEL GASTO</span><strong>Resumen del período filtrado</strong><small>Ámbito: ${esc(scope)} · los gastos FIBRAZO no entran en Personal.</small></div><div class="finance-context-state">${data.length} movimientos</div></div><div class="finance-context-grid"><div class="finance-context-item"><span>Total gastado</span><strong>${esc(money(total))}</strong><small>${esc(scope)}</small></div><div class="finance-context-item"><span>Promedio por día</span><strong>${esc(money(days.size?total/days.size:0))}</strong><small>${days.size} día(s) con gasto</small></div><div class="finance-context-item"><span>Mayor gasto</span><strong>${biggest?esc(money(num(biggest['Monto COP']))):'—'}</strong><small>${esc(biggest?.['Descripción / Comercio']||'Sin movimientos')}</small></div><div class="finance-context-item"><span>Composición</span><strong>${pct(total?fixed/total*100:0)}% fijo</strong><small>${pct(total?credit/total*100:0)}% del gasto fue a crédito</small></div></div>`;
  }

  function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;setTimeout(()=>render().catch(console.error),20);});}
  ['panel:view-root-changed','panel:filters-updated','panel:payment-filters-changed','panel:expense-scope-changed','panel:backend-data-loaded'].forEach(name=>document.addEventListener(name,()=>schedule()));
  queueMicrotask(schedule);
})();