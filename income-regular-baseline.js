(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  let cache = null;
  let cacheAt = 0;
  let timer = null;

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function num(value){
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) s = s.replace(/\./g,'').replace(',','.'); else s = s.replace(/,/g,'');
    } else if (comma >= 0) {
      const p = s.split(',');
      s = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g,'') + '.' + p[1] : s.replace(/,/g,'');
    } else if (dot >= 0) {
      const p = s.split('.'); if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g,'');
    }
    const n = Number(s); return Number.isFinite(n) ? n : 0;
  }

  function parseRows(values){
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1).filter(r => r?.some(v => String(v ?? '').trim() !== ''))
      .map(r => Object.fromEntries(headers.map((h,i) => [h || `Col ${i+1}`, r?.[i] ?? ''])));
  }

  function monthKey(value){
    const s = norm(value); let m = s.match(/^(20\d{2})-(\d{1,2})/);
    if (m) return `${m[1]}-${String(+m[2]).padStart(2,'0')}`;
    const map={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);
    return m ? `${m[2]}-${String(map[m[1]]).padStart(2,'0')}` : '';
  }

  function activeView(){ return document.querySelector('.nav-item.active')?.dataset.view || ''; }
  function selectedYear(){
    const selected=[...document.querySelectorAll('.multi-filter[data-filter="year"] .multi-filter-option.selected')].map(x=>String(x.dataset.value||''));
    return selected.length===1 ? selected[0] : String(new Date().getFullYear());
  }
  const avg = arr => { const a=(arr||[]).filter(v=>Number.isFinite(v)&&v>0); return a.length?a.reduce((s,v)=>s+v,0)/a.length:0; };
  const money = value => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(value)||0);
  const usd = value => new Intl.NumberFormat('es-CO',{maximumFractionDigits:2}).format(Number(value)||0);

  async function payload(force=false){
    if(!force&&cache&&Date.now()-cacheAt<55000)return cache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false); if(!token)return null;
    const response=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if(!response.ok)throw new Error(`Backend ${response.status}`);
    cache=await response.json(); cacheAt=Date.now(); return cache;
  }

  function buildReference(data){
    const concepts=parseRows(data?.sources?.[`${financeId}|Resumen_Conceptos_Ingresos!A:L`]||[]);
    const detail=parseRows(data?.sources?.[`${financeId}|Detalle_Ingresos!A:L`]||[]);
    const year=selectedYear();
    const conceptYear=concepts.filter(r=>monthKey(r.Mes).startsWith(year+'-'));

    const salaryValues=conceptYear.map(r=>num(r['Sueldo COP'])).filter(v=>v>0);
    const usdEquivValues=conceptYear.map(r=>num(r['Sueldo USD (equiv. COP)'])).filter(v=>v>0);

    const usdRegularRows=detail.filter(r=>{
      const k=monthKey(r.Mes); if(!k.startsWith(year+'-'))return false;
      if(norm(r['Moneda original'])!=='usd')return false;
      if(norm(r.Tipo)!=='ingreso laboral')return false;
      const text=norm(`${r.Concepto||''} ${r.Descripción||''} ${r['Descripción / Comercio']||''} ${r.Notas||''}`);
      return !/prima|bono|interes|interés|extra|aguinaldo|cesant|vacacion|vacación|devolucion|devolución/.test(text);
    });
    const usdValues=usdRegularRows.map(r=>num(r['Valor original']||r['Monto original']||r.Valor)).filter(v=>v>0);

    // Si el año todavía tiene pocos soportes, se usa historia regular como respaldo,
    // pero nunca columnas de primas, intereses, bonos, cesantías u otros extras.
    const allSalary=concepts.map(r=>num(r['Sueldo COP'])).filter(v=>v>0);
    const allUsdEquiv=concepts.map(r=>num(r['Sueldo USD (equiv. COP)'])).filter(v=>v>0);
    const allUsd=detail.filter(r=>norm(r['Moneda original'])==='usd'&&norm(r.Tipo)==='ingreso laboral')
      .filter(r=>!/prima|bono|interes|interés|extra|aguinaldo|cesant|vacacion|vacación|devolucion|devolución/.test(norm(`${r.Concepto||''} ${r.Descripción||''} ${r.Notas||''}`)))
      .map(r=>num(r['Valor original']||r['Monto original']||r.Valor)).filter(v=>v>0);

    const salaryAvg=avg(salaryValues)||avg(allSalary);
    const usdEquivAvg=avg(usdEquivValues)||avg(allUsdEquiv);
    const usdAvg=avg(usdValues)||avg(allUsd);
    const regularCop=salaryAvg+usdEquivAvg;

    const now=new Date(); const limit=year===String(now.getFullYear())?now.getMonth()+1:12;
    let supported=0, partial=0, missing=0;
    for(let m=1;m<=limit;m++){
      const key=`${year}-${String(m).padStart(2,'0')}`;
      const row=conceptYear.find(r=>monthKey(r.Mes)===key);
      const copOk=num(row?.['Sueldo COP'])>0, usdOk=num(row?.['Sueldo USD (equiv. COP)'])>0;
      if(copOk&&usdOk)supported++; else if(copOk||usdOk)partial++; else missing++;
    }

    return {year,salaryAvg,usdEquivAvg,usdAvg,regularCop,supported,partial,missing,totalExpected:limit,usedHistory:(!salaryValues.length||!usdEquivValues.length)};
  }

  function renderReference(ref){
    const root=document.getElementById('viewRoot'); if(!root||activeView()!=='ingresos')return;
    const anchor=root.querySelector('[data-income-complete]')||root;
    let panel=root.querySelector('#incomeRegularBaselinePanel');
    if(!panel){
      panel=document.createElement('div'); panel.id='incomeRegularBaselinePanel'; panel.className='panel';
      const first=anchor.querySelector('.panel'); if(first)first.insertAdjacentElement('afterend',panel); else anchor.prepend(panel);
    }
    const pending=ref.partial+ref.missing;
    const status=ref.regularCop>0
      ? (pending?`${pending} mes(es) pendientes de soporte completo`:'Soporte completo para el período disponible')
      :'Sin soporte suficiente para calcular la base regular';
    panel.innerHTML=`<div class="panel-header"><div class="panel-title"><strong>Base mensual regular promedio</strong><span>Nómina COP + Fibrazo LLC básico · sin primas, intereses, bonos, cesantías ni otros extras</span></div></div>
      <div class="savings-reference-grid">
        <div class="savings-reference-card"><span>Nómina COP promedio</span><strong>${ref.salaryAvg?esc(money(ref.salaryAvg)):'—'}</strong><small>Solo sueldo regular soportado</small></div>
        <div class="savings-reference-card"><span>Fibrazo LLC promedio</span><strong>${ref.usdAvg?`USD ${esc(usd(ref.usdAvg))}`:'—'}</strong><small>${ref.usdEquivAvg?`≈ ${esc(money(ref.usdEquivAvg))}`:'Equivalencia COP pendiente'}</small></div>
        <div class="savings-reference-card"><span>Ingreso mensual regular promedio</span><strong>${ref.regularCop?esc(money(ref.regularCop)):'—'}</strong><small>Base única para ahorro y porcentajes</small></div>
        <div class="savings-reference-card"><span>Soportes ${esc(ref.year)}</span><strong>${ref.supported}/${ref.totalExpected}</strong><small>${esc(status)}</small></div>
      </div>
      <div class="savings-scenario-note"><strong>Criterio:</strong> cuando falta soporte de un mes se mantiene temporalmente el promedio de los ingresos regulares disponibles y se marca como pendiente. Al cargar el soporte, el promedio se recalcula automáticamente. Nunca se incorporan extras a esta base.</div>`;

    const scenario=root.querySelector('#savingsScenarioPanel');
    if(scenario&&ref.regularCop>0){
      const cards=[...scenario.querySelectorAll('.savings-reference-card')];
      const monthly=ref.regularCop, annual=monthly*12;
      if(cards[0]){cards[0].querySelector('span').textContent='Ingreso mensual regular promedio';cards[0].querySelector('strong').textContent=money(monthly);cards[0].querySelector('small').textContent='Nómina COP + Fibrazo LLC básico, sin extras';}
      if(cards[2]){cards[2].querySelector('strong').textContent=money(annual);cards[2].querySelector('small').textContent='12 × ingreso mensual regular promedio';}
      const tbody=scenario.querySelector('tbody');
      if(tbody){
        tbody.innerHTML=[0.40,0.30,0.20,0.10].map(rate=>`<tr><td>${Math.round(rate*100)}%</td><td>${esc(money(monthly*rate))}</td><td>${esc(money(monthly*(1-rate)))}</td><td>${esc(money(annual*rate))}</td><td>${esc(money(annual*(1-rate)))}</td><td>${esc(money(annual*rate))}</td></tr>`).join('');
      }
      const bonusCard=cards[1]; if(bonusCard){bonusCard.querySelector('strong').textContent='No incluido';bonusCard.querySelector('small').textContent='Prima/aguinaldo es extra y queda fuera de la base regular';}
      const annualPlus=cards[3]; if(annualPlus){annualPlus.querySelector('strong').textContent=money(annual);annualPlus.querySelector('small').textContent='Sin extras incorporados';}
      const note=scenario.querySelector('.savings-scenario-note'); if(note)note.innerHTML='<strong>Criterio:</strong> todos los escenarios usan exclusivamente el ingreso mensual regular promedio. Prima, intereses, bonos y demás extras quedan fuera de esta base.';
    }
  }

  async function apply(force=false){
    if(activeView()!=='ingresos')return;
    try{const data=await payload(force);if(data)renderReference(buildReference(data));}
    catch(error){console.error('Base regular de ingresos:',error);}
  }
  function schedule(delay=220,force=false){clearTimeout(timer);timer=setTimeout(()=>apply(force),delay);}

  document.addEventListener('click',event=>{
    if(event.target.closest('.nav-item,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters,.currency-btn'))schedule(320,false);
    if(event.target.closest('#refreshBtn')){cache=null;cacheAt=0;schedule(700,true);}
  },true);
  const root=document.getElementById('viewRoot'); if(root)new MutationObserver(()=>schedule(180,false)).observe(root,{childList:true,subtree:false});
  schedule(700,false);
})();
