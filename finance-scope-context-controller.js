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
  function monthKey(value){const s=norm(value);let m=s.match(/^(20\d{2})-(\d{1,2})/);if(m)return`${m[1]}-${String(+m[2]).padStart(2,'0')}`;const map={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[\s-]+(20\d{2})/);return m?`${m[2]}-${String(map[m[1]]).padStart(2,'0')}`:'';}
  function rowMonth(row){return monthKey(row['Mes consumo']||row['Mes pago']||row['Fecha real']||row['Fecha registrada']);}
  function scopeOf(row) {
    if (window.FinanceScopeCore?.scopeOf) return window.FinanceScopeCore.scopeOf(row);
    const explicit = norm(row['Ámbito'] || row.Ambito);
    if (explicit.includes('fibrazo')) return 'FIBRAZO';
    if (explicit.includes('personal')) return 'Personal';
    const marker = norm(row.Observaciones);
    return marker.includes('ambito explicito: fibrazo') ? 'FIBRAZO' : 'Personal';
  }
  function isExpense(row){const status=norm(row.Estado),type=norm(row.Tipo||row.Naturaleza||'gasto');return !/proyecc|proyect|programad|pendiente/.test(status)&&(!type||type.includes('gasto')||type.includes('egreso')||type.includes('compra'));}
  function method(row){if(typeof window.FinancePurchasePolicy?.method==='function')return window.FinancePurchasePolicy.method(row);return String(row['Modalidad de pago']||'').trim();}
  function account(row){const raw=String(row['Cuenta / Tarjeta']||'').trim(),n=norm(raw),holder=norm(row.Titular);if(n.includes('efectivo'))return'Efectivo';if(n.includes('nequi'))return holder.includes('ro')?'Nequi Ro':'Nequi Edu';if(n.includes('arq'))return'ARQ Edu';if(n.includes('nu'))return n.includes(' ro')||holder.includes('rocio')?'Nu Ro':'Nu Edu';return raw||'Sin especificar';}
  function money(v){return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);}
  function pct(v){return new Intl.NumberFormat('es-CO',{minimumFractionDigits:0,maximumFractionDigits:1}).format(Number(v)||0);}

  async function source(){
    const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')return{payload:null,rows:[]};
    const payload=await getData(false),cached=window.__PANEL_GET_CACHED_ROWS__;
    if(window.FinanceScopeCore?.movementRows) return{payload,rows:window.FinanceScopeCore.movementRows(payload,financeId)};
    if(typeof cached==='function'){
      const wide=cached(payload,financeId,'Movimientos!A:AA');
      return{payload,rows:wide.length?wide:cached(payload,financeId,'Movimientos!A:Z')};
    }
    return{payload,rows:[]};
  }

  function filtered(sourceRows){
    const years=new Set(selected('year')),months=new Set(selected('month').map(v=>String(Number(v)).padStart(2,'0'))),cats=new Set(selected('category')),subs=new Set(selected('subcategory'));
    const pay=window.__PAYMENT_FILTER_STATE__?.view==='gastos'?window.__PAYMENT_FILTER_STATE__:{account:[],method:[]};
    const accounts=new Set(pay.account||[]),methods=new Set(pay.method||[]),scope=window.FinanceScopeCore?.getScope?.('gastos') || window.__FINANCE_SCOPE_FILTER_STATE__?.gastos || 'Personal';
    return sourceRows.filter(row=>{
      if(!isExpense(row))return false;
      if(scope!=='Todos'&&scopeOf(row)!==scope)return false;
      const key=rowMonth(row),year=key.slice(0,4),month=key.slice(5,7);
      if(years.size&&(!key||!years.has(year)))return false;
      if(months.size&&(!key||!months.has(month)))return false;
      if(cats.size&&!cats.has(String(row['Categoría']||'')))return false;
      if(subs.size&&!subs.has(String(row['Subcategoría']||'')))return false;
      if(accounts.size&&!accounts.has(account(row)))return false;
      if(methods.size&&!methods.has(method(row)))return false;
      return true;
    });
  }

  function regularIncome(payload,data){
    const keys=[...new Set(data.map(rowMonth).filter(Boolean))].sort();
    if(!keys.length){
      const years=selected('year'),months=selected('month');
      if(years.length===1&&months.length===1)keys.push(`${years[0]}-${String(Number(months[0])).padStart(2,'0')}`);
      else{const now=new Date();keys.push(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);}
    }
    if(typeof window.RegularIncomeCore?.build==='function'){
      const model=window.RegularIncomeCore.build(payload,financeId);
      return{total:model.period(keys).totalCop,keys};
    }
    return{total:0,keys};
  }

  function stabilize(root,host){
    const head=[...root.children].find(node=>node.matches?.('.section-head'))||null;
    const monthly=root.querySelector(':scope > #monthlyProjectionSuite');
    if(monthly&&head&&monthly.previousElementSibling!==head)head.insertAdjacentElement('afterend',monthly);
    const anchor=monthly||head;
    if(anchor&&host.previousElementSibling!==anchor)anchor.insertAdjacentElement('afterend',host);
  }

  async function render(){
    if(activeView()!=='gastos')return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const loaded=await source(),data=filtered(loaded.rows);if(activeView()!=='gastos')return;
    const total=data.reduce((s,r)=>s+num(r['Monto COP']),0);
    const supermarket=data.filter(r=>norm(r['Categoría'])==='supermercado').reduce((s,r)=>s+num(r['Monto COP']),0);
    const services=data.filter(r=>norm(r['Categoría'])==='servicios').reduce((s,r)=>s+num(r['Monto COP']),0);
    const biggest=data.slice().sort((a,b)=>num(b['Monto COP'])-num(a['Monto COP']))[0]||null;
    const income=regularIncome(loaded.payload,data),scope=window.FinanceScopeCore?.getScope?.('gastos') || window.__FINANCE_SCOPE_FILTER_STATE__?.gastos || 'Personal';
    let host=root.querySelector(':scope > .finance-context');
    if(!host){host=document.createElement('section');host.className='finance-context';root.appendChild(host);}
    host.innerHTML=`<div class="finance-context-head"><div><span>LECTURA DEL GASTO</span><strong>Resumen del período filtrado</strong><small>Ámbito: ${esc(scope)} · los gastos FIBRAZO no entran en Personal.</small></div><div class="finance-context-state">${data.length} movimientos</div></div><div class="finance-context-grid"><div class="finance-context-item"><span>Total gastado</span><strong>${esc(money(total))}</strong><small>${esc(scope)}</small></div><div class="finance-context-item"><span>Supermercado</span><strong>${esc(money(supermarket))}</strong><small>${income.total>0?`${pct(supermarket/income.total*100)}% del ingreso regular`:'Sin base de ingreso regular'}</small></div><div class="finance-context-item"><span>Mayor gasto</span><strong>${biggest?esc(money(num(biggest['Monto COP']))):'—'}</strong><small>${esc(biggest?.['Descripción / Comercio']||'Sin movimientos')}</small></div><div class="finance-context-item"><span>Servicios</span><strong>${esc(money(services))}</strong><small>${income.total>0?`${pct(services/income.total*100)}% del ingreso regular`:'Sin base de ingreso regular'}</small></div></div>`;
    stabilize(root,host);
  }

  function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;setTimeout(()=>render().catch(console.error),24);});}
  ['panel:view-root-changed','panel:filters-updated','panel:payment-filters-changed','panel:expense-scope-changed','panel:backend-data-loaded','panel:section-modules-ready'].forEach(name=>document.addEventListener(name,()=>schedule()));
  queueMicrotask(schedule);
})();