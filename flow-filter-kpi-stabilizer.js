(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = String(cfg.financeSpreadsheetId || '');
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  if (!FINANCE_ID || !apiBaseUrl) return;

  let cache=null,cacheAt=0,timer=null,applying=false;
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  const activeCurrency=()=>document.querySelector('.currency-btn.active')?.dataset.currency||'COP';
  const selectedGlobal=key=>[...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||'').trim()).filter(Boolean);
  const parseNumber=value=>{if(typeof value==='number')return Number.isFinite(value)?value:0;let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;};
  const parseRows=values=>{if(!Array.isArray(values)||values.length<2)return[];const h=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));};

  async function payload(force=false){if(!force&&cache&&Date.now()-cacheAt<45000)return cache;const token=await window.__PANEL_GET_ID_TOKEN__?.(false);if(!token)return null;const res=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!res.ok)return null;cache=await res.json();cacheAt=Date.now();return cache;}
  const sourceRows=(data,range)=>parseRows(data?.sources?.[`${FINANCE_ID}|${range}`]||[]);

  function ensureFilters(){
    if(activeView()!=='flujo')return;
    const filterBar=document.getElementById('filterBar'),category=document.querySelector('#globalFilters .multi-filter[data-filter="category"]'),sub=document.querySelector('#globalFilters .multi-filter[data-filter="subcategory"]'),paymentBar=document.getElementById('paymentMethodFilterBar');
    if(filterBar){filterBar.hidden=false;filterBar.style.display='';}
    if(category){category.hidden=false;category.style.display='';}
    if(sub){sub.hidden=true;sub.style.display='none';}
    if(paymentBar){paymentBar.hidden=false;paymentBar.style.display='';const grid=paymentBar.querySelector('.section-filter-grid');if(grid)grid.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';}
  }

  const monthKey=value=>window.RegularIncomeCore?.monthKey(value)||'';
  function rowMonth(row){return monthKey(row['Mes consumo']||row['Mes pago']||row['Fecha real']||row['Fecha registrada']);}
  function isActual(row){return norm(row.Tipo)==='gasto'&&(window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad/.test(norm(row.Estado)));}
  function account(row){const raw=String(row['Cuenta / Tarjeta']||'').trim(),n=norm(raw),holder=norm(row.Titular);if(n.includes('efectivo'))return'Efectivo';if(n.includes('nequi'))return holder.includes('ro')?'Nequi Ro':'Nequi Edu';if(n.includes('arq'))return'ARQ Edu';if(n.includes('nu')){if(n.includes(' ro')||n.endsWith('ro')||holder==='ro'||holder.includes('rocio'))return'Nu Ro';return'Nu Edu';}return raw||'Sin especificar';}
  function method(row){const explicit=String(row['Modalidad de pago']||'').trim();if(explicit)return explicit;const raw=norm(row['Cuenta / Tarjeta']);if(raw.includes('credito'))return'Crédito';if(raw.includes('transferencia'))return'Transferencia';if(raw.includes('debito'))return'Débito';if(raw.includes('efectivo'))return'Efectivo';const q=parseNumber(row.Cuotas);if(q>0&&(raw.includes('nu')||raw.includes('arq')))return'Crédito';return'Sin especificar';}
  function movementMatches(row){
    if(!isActual(row))return false;
    const years=selectedGlobal('year'),months=selectedGlobal('month'),cats=selectedGlobal('category'),mk=rowMonth(row),ym=mk.match(/^(20\d{2})-(\d{2})$/);
    if(years.length&&(!ym||!years.includes(ym[1])))return false;
    if(months.length&&(!ym||!months.includes(String(+ym[2]))))return false;
    if(cats.length&&!cats.includes(String(row['Categoría']||'')))return false;
    const st=window.__PAYMENT_FILTER_STATE__?.view==='flujo'?window.__PAYMENT_FILTER_STATE__:{account:[],method:[]};
    if(st.account?.length&&!st.account.includes(account(row)))return false;
    if(st.method?.length&&!st.method.includes(method(row)))return false;
    return true;
  }

  function selectedPeriodKeys(model,movements){
    const years=selectedGlobal('year'),months=selectedGlobal('month');
    const current=(()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;})();
    const keys=new Set([...model.months.keys()].filter(k=>k<=current));
    movements.filter(isActual).forEach(r=>{const k=rowMonth(r);if(k&&k<=current)keys.add(k);});
    return [...keys].filter(k=>{const[y,m]=k.split('-');if(years.length&&!years.includes(y))return false;if(months.length&&!months.includes(String(+m)))return false;return true;}).sort();
  }

  function currencyFactor(rows,currency){if(currency==='COP')return 1;const ratios=rows.map(r=>{const cop=parseNumber(r['Monto COP']);const other=parseNumber(r[currency==='USD'?'Monto USD':'Monto ARS']);return cop>0&&other>0?other/cop:0;}).filter(v=>v>0);if(ratios.length){ratios.sort((a,b)=>a-b);return ratios[Math.floor(ratios.length/2)];}return currency==='USD'?1/(cfg.regularIncome?.usdCopReference||3150):1/2.1;}
  function formatMoney(value,currency){const digits=currency==='USD'?2:0;return new Intl.NumberFormat('es-CO',{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value)||0);}
  function setCard(card,label,value,meta){if(!card)return;const l=card.querySelector('.kpi-label'),v=card.querySelector('.kpi-value'),m=card.querySelector('.kpi-meta span');if(l)l.textContent=label;if(v)v.textContent=value;if(m)m.textContent=meta;}
  function primaryCards(){const root=document.getElementById('viewRoot');if(!root)return null;const grid=[...root.querySelectorAll('.kpi-grid')].find(g=>{const labels=[...g.querySelectorAll('.kpi-label')].map(x=>x.textContent.trim());return labels.some(x=>x==='Ingresos'||x==='Ingresos promedio'||x==='Ingresos regulares')&&labels.includes('Egresos')&&labels.includes('Ahorro');});if(!grid)return null;const cards=[...grid.querySelectorAll('.kpi-card')];return{income:cards.find(c=>['Ingresos','Ingresos promedio','Ingresos regulares'].includes(c.querySelector('.kpi-label')?.textContent.trim())),expense:cards.find(c=>c.querySelector('.kpi-label')?.textContent.trim()==='Egresos'),savings:cards.find(c=>c.querySelector('.kpi-label')?.textContent.trim()==='Ahorro'),rate:cards.find(c=>norm(c.querySelector('.kpi-label')?.textContent).includes('tasa de ahorro'))};}

  async function apply(force=false){
    if(applying||activeView()!=='flujo'||!window.RegularIncomeCore)return;applying=true;
    try{
      const data=await payload(force);if(!data)return;ensureFilters();
      const movements=sourceRows(data,'Movimientos!A:Z');
      const model=window.RegularIncomeCore.build(data,FINANCE_ID);
      window.__PANEL_REGULAR_INCOME_MODEL__=model;
      const keys=selectedPeriodKeys(model,movements),period=model.period(keys),filtered=movements.filter(movementMatches),currency=activeCurrency(),factor=currencyFactor(movements,currency);
      const income=period.totalCop*factor,amountField=currency==='COP'?'Monto COP':currency==='USD'?'Monto USD':'Monto ARS',expenses=filtered.reduce((s,r)=>s+parseNumber(r[amountField]),0),savings=income-expenses,rate=income?savings/income:0;
      const missing=period.missing.length;
      const meta=keys.length===1?(missing?`Ingreso regular del mes · soporte pendiente: ${period.missing[0].missingSupport.join(' + ')}`:'Ingreso regular del mes'):`${keys.length} meses · ingreso regular acumulado${missing?` · ${missing} con soporte pendiente`:''}`;
      const cards=primaryCards();
      if(cards){setCard(cards.income,keys.length>1?'Ingresos regulares':'Ingresos promedio',formatMoney(income,currency),meta);setCard(cards.expense,'Egresos',formatMoney(expenses,currency),`${filtered.length} movimientos realizados según filtros`);setCard(cards.savings,'Ahorro',formatMoney(savings,currency),'Ingreso regular - egresos');setCard(cards.rate,'Tasa de ahorro',`${new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1}).format(rate*100)}%`,'Ahorro / ingreso regular');}
    }catch(error){console.error('Estabilizador Flujo:',error);}finally{applying=false;}
  }

  const schedule=(force=false,delay=220)=>{clearTimeout(timer);timer=setTimeout(()=>apply(force),delay);};
  document.addEventListener('click',event=>{if(event.target.closest('.nav-item')){setTimeout(()=>apply(false),550);return;}if(event.target.closest('.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters,.currency-btn'))schedule(false,240);if(event.target.closest('#refreshBtn')){cache=null;cacheAt=0;schedule(true,550);}},true);
  document.addEventListener('panel:payment-filters-changed',()=>schedule(false,160));
  document.addEventListener('panel:filters-updated',()=>schedule(false,180));
  document.addEventListener('panel:regular-income-base-applied',()=>schedule(false,80));
  setTimeout(()=>apply(false),750);
})();
