(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const FINANCE_ID = String(cfg.financeSpreadsheetId || '');
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  let cache=null, cacheAt=0, timer=null;

  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function num(value){
    if(typeof value==='number')return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
    else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }
  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const h=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));}
  async function payload(){if(cache&&Date.now()-cacheAt<45000)return cache;const getIdToken=window.__PANEL_GET_ID_TOKEN__;if(!apiBaseUrl||!FINANCE_ID||typeof getIdToken!=='function')return null;const token=await getIdToken(false);if(!token)return null;const r=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!r.ok)return null;cache=await r.json();cacheAt=Date.now();return cache;}
  function rows(data,range){return parseRows(data?.sources?.[`${FINANCE_ID}|${range}`]||[]);}
  function selected(key){return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||'').trim()).filter(Boolean);}
  function parseDate(value){const s=String(value||'').trim();let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);return null;}
  function account(row){const raw=String(row['Cuenta / Tarjeta']||'').trim(),n=norm(raw),h=norm(row.Titular);if(n.includes('efectivo'))return'Efectivo';if(n.includes('nequi'))return h.includes('ro')?'Nequi Ro':'Nequi Edu';if(n.includes('arq'))return'ARQ Edu';if(n.includes('nu')){if(n.includes(' ro')||n.endsWith('ro')||h==='ro'||h.includes('rocio'))return'Nu Ro';if(n.includes('edu')||h.includes('edu'))return'Nu Edu';return'Nu';}return raw||'Sin especificar';}
  function method(row){const e=String(row['Modalidad de pago']||'').trim();if(e)return e;const n=norm(row['Cuenta / Tarjeta']);if(n.includes('credito'))return'Crédito';if(n.includes('transferencia'))return'Transferencia';if(n.includes('debito'))return'Débito';if(n.includes('efectivo'))return'Efectivo';if(num(row.Cuotas)>0&&(n.includes('nu')||n.includes('arq')))return'Crédito';return'Sin especificar';}
  function filterRow(row){const d=parseDate(row['Fecha real']||row['Fecha registrada']);const ys=selected('year'),ms=selected('month'),cs=selected('category'),ss=selected('subcategory');if(ys.length&&(!d||!ys.includes(String(d.getFullYear()))))return false;if(ms.length&&(!d||!ms.includes(String(d.getMonth()+1))))return false;if(cs.length&&!cs.includes(String(row['Categoría']||'')))return false;if(ss.length&&!ss.includes(String(row['Subcategoría']||'')))return false;const st=window.__PAYMENT_FILTER_STATE__;if(st?.view==='gastos'){if(st.account?.length&&!st.account.includes(account(row)))return false;if(st.method?.length&&!st.method.includes(method(row)))return false;}return true;}
  function money(v){return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);}
  function activeFilters(){const st=window.__PAYMENT_FILTER_STATE__;return selected('category').length||selected('subcategory').length||(st?.view==='gastos'&&(st.account?.length||st.method?.length));}
  function setKpi(panel,label,value,meta){const card=[...panel.querySelectorAll('.monthly-kpis>div')].find(x=>x.querySelector('span')?.textContent.trim()===label);if(!card)return;const strong=card.querySelector('strong'),small=card.querySelector('small');if(strong)strong.textContent=money(value);if(small&&meta)small.textContent=meta;}
  async function apply(){if(document.querySelector('.nav-item.active')?.dataset.view!=='gastos')return;const panel=document.querySelector('#monthlyProjectionSuite .monthly-close-panel');if(!panel)return;const data=await payload();if(!data)return;const ext=rows(data,'Movimientos!A:Z'),all=ext.length?ext:rows(data,'Movimientos!A:Y');const filtered=all.filter(filterRow);const actual=filtered.filter(r=>{const s=norm(r.Estado);return norm(r.Tipo)==='gasto'&&s!=='programado'&&s!=='proyeccion';});const programmed=filtered.filter(r=>norm(r.Tipo)==='gasto'&&norm(r.Estado)==='programado');const real=actual.reduce((a,r)=>a+num(r['Monto COP']),0);const prog=programmed.reduce((a,r)=>a+num(r['Monto COP']),0);const narrowed=Boolean(activeFilters());let recurring=0;if(!narrowed){const recurringCard=[...panel.querySelectorAll('.monthly-kpis>div')].find(x=>x.querySelector('span')?.textContent.trim()==='Faltante recurrente');recurring=num(recurringCard?.querySelector('strong')?.textContent||0);}const toggle=document.getElementById('monthlyProjectionToggle');const total=toggle?.checked===false?real:real+prog+recurring;setKpi(panel,'Real hasta hoy',real,`${actual.length} movimiento${actual.length===1?'':'s'} registrado${actual.length===1?'':'s'}`);setKpi(panel,'Programado pendiente',prog,`${programmed.length} gasto${programmed.length===1?'':'s'}`);if(narrowed)setKpi(panel,'Faltante recurrente',0,'No se proyecta con filtros específicos');setKpi(panel,'Total considerado',total,toggle?.checked===false?'Solo gasto real':'Real + cierre estimado');}
  function schedule(delay=130){clearTimeout(timer);timer=setTimeout(()=>apply().catch(console.error),delay);}
  document.addEventListener('panel:payment-filters-changed',()=>schedule(40));
  document.addEventListener('click',e=>{if(e.target.closest('.multi-filter-option')||e.target.closest('#resetCurrentMonth')||e.target.closest('#clearFilters')||e.target.closest('#monthlyProjectionToggle')||e.target.closest('.nav-item'))schedule(220);},true);
  const root=document.getElementById('viewRoot');if(root)new MutationObserver(()=>schedule(180)).observe(root,{childList:true,subtree:false});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(900),{once:true});else schedule(900);
})();