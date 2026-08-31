(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const FINANCE_ID=String(cfg.financeSpreadsheetId||'');
  if(!FINANCE_ID)return;

  let frame=0,cache=null;
  const MONTHS=['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);
  const pct=v=>`${new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1}).format((Number(v)||0)*100)}%`;
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';

  function num(value){if(typeof value==='number')return Number.isFinite(value)?value:0;let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}
  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const h=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));}
  function monthKey(value){const s=norm(value);let m=s.match(/^(20\d{2})-(\d{1,2})/);if(m)return`${m[1]}-${String(+m[2]).padStart(2,'0')}`;const map={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);return m?`${m[2]}-${String(map[m[1]]).padStart(2,'0')}`:'';}
  function selectedYear(){const values=[...document.querySelectorAll('.multi-filter[data-filter="year"] .multi-filter-option.selected')].map(x=>String(x.dataset.value||'')).filter(Boolean);return values.length===1?values[0]:String(new Date().getFullYear());}

  async function rows(force=false){
    if(cache&&!force)return cache;
    const get=window.__PANEL_GET_SOURCE_VALUES__;if(typeof get!=='function')return[];
    cache=parseRows(await get(FINANCE_ID,'Flujo_Ahorro!A:P',force));return cache;
  }

  function ensureStyle(){if(document.getElementById('incomeSavingsContextStyle'))return;const s=document.createElement('style');s.id='incomeSavingsContextStyle';s.textContent=`.income-year-plan{display:grid;gap:10px}.income-year-plan-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.income-year-plan-head strong{font-size:13px}.income-year-plan-head span{display:block;color:#71839a;font-size:10px;margin-top:4px}.income-year-plan-state{font-size:9px;font-weight:800;border:1px solid var(--border);border-radius:99px;padding:5px 8px;color:#8fb4ea;white-space:nowrap}.income-year-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.income-year-card{background:#0d1520;border:1px solid var(--border-soft);border-radius:11px;padding:10px;min-width:0}.income-year-card span{display:block;color:#6d7f96;font-size:8px;text-transform:uppercase;letter-spacing:.055em;font-weight:800}.income-year-card strong{display:block;margin-top:5px;font-size:16px;color:#eef5ff}.income-year-card small{display:block;margin-top:4px;color:#71839a;font-size:9px;line-height:1.35}.income-year-card.warn strong{color:#ffcb68}.income-year-card.bad strong{color:#ff8290}.income-year-card.good strong{color:#79e1ab}.income-year-note{color:#7d8fa7;font-size:9px;line-height:1.45}.income-year-note b{color:#bfd0e6}@media(max-width:1100px){.income-year-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:720px){.income-year-grid{grid-template-columns:1fr 1fr}.income-year-plan-head{align-items:flex-start;flex-direction:column}}@media(max-width:480px){.income-year-grid{grid-template-columns:1fr}}`;document.head.appendChild(s);}

  function render(data){
    if(activeView()!=='ingresos')return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const year=selectedYear();
    const yearRows=data.map(r=>({...r,key:monthKey(r.Mes)})).filter(r=>r.key.startsWith(year+'-')).sort((a,b)=>a.key.localeCompare(b.key));
    if(!yearRows.length)return;
    const actual=yearRows.filter(r=>!norm(r.Estado).includes('proyecc'));
    const latest=actual.at(-1)||yearRows[0];
    const december=yearRows.find(r=>r.key===`${year}-12`)||yearRows.at(-1);
    const monthNo=Number(latest.key.slice(5,7))||1;
    const remaining=Math.max(0,12-monthNo);
    const saved=num(latest['Ahorro acumulado COP']);
    const annualTarget=num(december['Meta acumulada COP']);
    const gap=Math.max(0,annualTarget-saved);
    const required=remaining?gap/remaining:gap;
    const projectedIncome=num(latest['Ingresos proyectados COP'])||num(december['Ingresos proyectados COP']);
    const requiredRate=projectedIncome?required/projectedIncome:0;
    const spendCap=Math.max(0,projectedIncome-required);
    const completion=annualTarget?saved/annualTarget:0;
    const tone=completion>=monthNo/12?'good':requiredRate>.6?'bad':'warn';
    let host=root.querySelector('#incomeYearSavingsContext');
    if(!host){host=document.createElement('div');host.id='incomeYearSavingsContext';host.className='panel income-year-plan';const anchor=root.querySelector('#incomeRegularBaselinePanel')||root.querySelector('[data-income-complete]');if(anchor)anchor.insertAdjacentElement('beforebegin',host);else root.prepend(host);}
    host.innerHTML=`<div class="income-year-plan-head"><div><strong>Plan anual de ahorro · ${esc(year)}</strong><span>Avance real y esfuerzo necesario para llegar a la meta acumulada.</span></div><div class="income-year-plan-state">${Math.round(completion*100)}% de la meta anual</div></div><div class="income-year-grid"><div class="income-year-card ${tone}"><span>Ahorro acumulado</span><strong>${esc(money(saved))}</strong><small>Hasta ${esc(MONTHS[monthNo-1]||'mes')} ${esc(year)}</small></div><div class="income-year-card"><span>Meta anual</span><strong>${esc(money(annualTarget))}</strong><small>Meta acumulada a diciembre</small></div><div class="income-year-card ${gap>0?'warn':'good'}"><span>Brecha restante</span><strong>${esc(money(gap))}</strong><small>${remaining} mes(es) por delante</small></div><div class="income-year-card ${requiredRate>.6?'bad':requiredRate>.4?'warn':'good'}"><span>Ahorro mensual requerido</span><strong>${esc(money(required))}</strong><small>${esc(pct(requiredRate))} del ingreso mensual proyectado</small></div><div class="income-year-card"><span>Gasto máximo sugerido</span><strong>${esc(money(spendCap))}</strong><small>Ingreso proyectado - ahorro requerido</small></div></div><div class="income-year-note"><b>Lectura:</b> este bloque no crea ingresos ni gastos. Resume la meta de <code>Flujo_Ahorro</code> y se recalcula automáticamente cuando cambien los cierres mensuales.</div>`;
  }

  async function run(force=false){const data=await rows(force).catch(e=>{console.error('Plan anual de ahorro:',e);return[];});render(data);}
  function schedule(force=false){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;run(force);});}
  ensureStyle();
  document.addEventListener('panel:income-regular-controller-applied',()=>schedule(false));
  document.addEventListener('panel:filters-updated',()=>{if(activeView()==='ingresos')schedule(false);});
  document.addEventListener('panel:backend-refresh-requested',()=>{cache=null;if(activeView()==='ingresos')schedule(true);});
})();
