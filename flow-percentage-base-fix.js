(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  const MONTHS = {ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
  let cache=null, cacheAt=0, timer=null, applying=false;
  const retryTimers=[];

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
  function median(values){const list=values.map(Number).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);if(!list.length)return 0;const i=Math.floor(list.length/2);return list.length%2?list[i]:(list[i-1]+list[i])/2;}
  function monthKey(value){const s=norm(value);let m=s.match(/^(20\d{2})-(\d{1,2})/);if(m)return`${m[1]}-${String(+m[2]).padStart(2,'0')}`;m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);return m?`${m[2]}-${String(MONTHS[m[1]]).padStart(2,'0')}`:'';}
  const yearOf=key=>String(key||'').slice(0,4);
  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const h=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));}
  const money=v=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);
  const usd=v=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:2}).format(Number(v)||0);
  const pct=v=>`${new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1}).format((Number(v)||0)*100)}%`;
  function pctClass(v){const p=(Number(v)||0)*100;return p>15?'pct-red':p>10?'pct-yellow':p>5?'pct-green':'pct-white';}

  async function getPayload(force=false){
    if(!force&&cache&&Date.now()-cacheAt<55000)return cache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false);if(!token)return null;
    const r=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!r.ok)throw new Error(`Backend ${r.status}`);
    cache=await r.json();cacheAt=Date.now();return cache;
  }

  function buildBases(data){
    const concepts=parseRows(data?.sources?.[`${financeId}|Resumen_Conceptos_Ingresos!A:L`]||[]);
    const details=parseRows(data?.sources?.[`${financeId}|Detalle_Ingresos!A:L`]||[]);
    const conceptByMonth=new Map(),keys=new Set(),salariesByYear=new Map(),usdAmountsByYear=new Map(),ratesByYear=new Map();
    concepts.forEach(row=>{const key=monthKey(row.Mes);if(!key)return;keys.add(key);conceptByMonth.set(key,row);const salary=num(row['Sueldo COP']);if(salary>0){const y=yearOf(key);if(!salariesByYear.has(y))salariesByYear.set(y,[]);salariesByYear.get(y).push(salary);}});
    const usdByMonth=new Map();
    details.forEach(row=>{const key=monthKey(row.Mes);if(!key)return;keys.add(key);if(norm(row.Tipo)!=='ingreso laboral'||norm(row['Moneda original'])!=='usd')return;usdByMonth.set(key,(usdByMonth.get(key)||0)+num(row['Valor original']));});
    usdByMonth.forEach((amount,key)=>{if(!(amount>0))return;const y=yearOf(key);if(!usdAmountsByYear.has(y))usdAmountsByYear.set(y,[]);usdAmountsByYear.get(y).push(amount);const equiv=num(conceptByMonth.get(key)?.['Sueldo USD (equiv. COP)']);if(equiv>0){if(!ratesByYear.has(y))ratesByYear.set(y,[]);ratesByYear.get(y).push(equiv/amount);}});
    const allSalary=[...salariesByYear.values()].flat(),allUsd=[...usdAmountsByYear.values()].flat(),allRates=[...ratesByYear.values()].flat(),bases=new Map();
    keys.forEach(key=>{
      const y=yearOf(key),concept=conceptByMonth.get(key)||{};
      const copActual=num(concept['Sueldo COP']),usdActual=usdByMonth.get(key)||0,usdEquivActual=num(concept['Sueldo USD (equiv. COP)']);
      const copEstimate=median(salariesByYear.get(y)||[])||median(allSalary);
      const usdEstimate=median(usdAmountsByYear.get(y)||[])||median(allUsd)||1300;
      const rateEstimate=median(ratesByYear.get(y)||[])||median(allRates)||3150;
      const copRegular=copActual>0?copActual:copEstimate;
      const usdRegular=usdActual>0?usdActual:usdEstimate;
      const usdEquiv=usdEquivActual>0?usdEquivActual:usdRegular*rateEstimate;
      const copEstimated=!(copActual>0)&&copRegular>0;
      const usdEstimated=!(usdActual>0&&usdEquivActual>0)&&usdRegular>0&&usdEquiv>0;
      const total=copRegular+usdEquiv;
      if(total>0)bases.set(key,{total,copRegular,usdRegular,usdEquiv,copEstimated,usdEstimated,complete:!copEstimated&&!usdEstimated});
    });
    return bases;
  }

  function updateCards(bases){
    document.querySelectorAll('.salary-reference-grid > div').forEach(card=>{
      const key=monthKey(card.querySelector('span')?.textContent||''),base=bases.get(key);if(!base)return;
      const strong=card.querySelector('strong'),total=money(base.total);if(strong&&strong.textContent!==total)strong.textContent=total;
      card.querySelectorAll('small').forEach(el=>el.remove());
      const s1=document.createElement('small');s1.className='income-base-breakdown';s1.textContent=`Nómina COP ${money(base.copRegular)}${base.copEstimated?' · pendiente soporte':''}`;
      const s2=document.createElement('small');s2.className='income-base-breakdown';s2.textContent=`Fibrazo LLC USD ${usd(base.usdRegular)} · ≈ ${money(base.usdEquiv)}${base.usdEstimated?' · pendiente soporte':''}`;
      const status=document.createElement('small');status.className=`income-base-status ${base.complete?'income-base-ok':'income-base-estimated'}`;status.textContent=base.complete?'Base regular confirmada':'Base estimada · usada para calcular %';
      card.append(s1,s2,status);
    });
  }

  function updateMatrix(bases){
    const table=document.querySelector('.flow-matrix-advanced');if(!table)return;
    const monthKeys=[...table.querySelectorAll('thead tr:first-child th[data-flow-sort-month]')].map(th=>th.dataset.flowSortMonth||monthKey(th.textContent));
    table.querySelectorAll('tbody tr').forEach(row=>monthKeys.forEach((key,i)=>{
      const base=bases.get(key)?.total;if(!(base>0))return;
      const amountCell=row.cells?.[2+i*2],pctCell=row.cells?.[3+i*2];if(!amountCell||!pctCell)return;
      const share=num(amountCell.textContent)/base,next=pct(share),cls=`matrix-pct ${pctClass(share)}`;
      let span=pctCell.querySelector('.matrix-pct');if(!span){pctCell.textContent='';span=document.createElement('span');pctCell.appendChild(span);}
      if(span.textContent!==next)span.textContent=next;if(span.className!==cls)span.className=cls;
    }));
  }

  function updateNote(){
    const reference=document.querySelector('.salary-reference');if(!reference)return;
    let note=reference.querySelector('.income-base-note');if(!note){note=document.createElement('div');note.className='income-base-note';reference.appendChild(note);}
    const text='Base de porcentaje = nómina COP regular + Fibrazo LLC regular. Si falta un soporte, se estima temporalmente con el histórico regular del mismo año. Primas, cesantías, devoluciones y extras no se incluyen.';
    if(note.textContent!==text)note.textContent=text;
  }

  async function apply(force=false){
    if(applying||document.querySelector('.nav-item.active')?.dataset.view!=='flujo')return;
    if(!document.querySelector('.flow-matrix-advanced')||!document.querySelector('.salary-reference-grid'))return;
    applying=true;
    try{
      const data=await getPayload(force);if(!data)return;
      const bases=buildBases(data);
      window.__PANEL_REGULAR_INCOME_BASES__=bases;
      updateCards(bases);updateMatrix(bases);updateNote();
      document.dispatchEvent(new CustomEvent('panel:regular-income-base-applied'));
    }catch(error){console.error('Base regular unificada:',error);}finally{applying=false;}
  }

  function schedule(force=false,delay=220){clearTimeout(timer);timer=setTimeout(()=>apply(force),delay);}
  function reconcileSeries(force=false){
    retryTimers.splice(0).forEach(clearTimeout);
    [350,900,1700,3000,4800,7000,10000].forEach((ms,index)=>{
      retryTimers.push(setTimeout(()=>apply(force&&index===0),ms));
    });
  }

  // Sin MutationObserver: reconciliación acotada tras acciones reales para que la
  // matriz no vuelva a sobrescribir agosto con solo Fibrazo LLC después del render.
  document.addEventListener('click',event=>{
    if(event.target.closest('#refreshBtn')){cache=null;cacheAt=0;reconcileSeries(true);return;}
    if(event.target.closest('.nav-item,.multi-filter-option,.currency-btn,#resetCurrentMonth,#clearFilters,[data-clear-filter]'))reconcileSeries(false);
  },true);
  document.addEventListener('panel:payment-filters-changed',()=>reconcileSeries(false));
  document.addEventListener('panel:monthly-projection-change',()=>reconcileSeries(false));
  reconcileSeries(false);
})();