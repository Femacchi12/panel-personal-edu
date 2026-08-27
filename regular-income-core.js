(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const DEFAULT_USD_BASE = Number(cfg.regularIncome?.fibrazoLlcUsdBase || 1300);
  const DEFAULT_USD_COP = Number(cfg.regularIncome?.usdCopReference || 3150);

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const num = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,''); if (!s) return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0){ if(c>d)s=s.replace(/\./g,'').replace(',','.'); else s=s.replace(/,/g,''); }
    else if(c>=0){ const p=s.split(','); s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,''); }
    else if(d>=0){ const p=s.split('.'); if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,''); }
    const n=Number(s); return Number.isFinite(n)?n:0;
  };
  const parseRows = values => {
    if(!Array.isArray(values)||values.length<2)return[];
    const h=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));
  };
  const monthKey = value => {
    const s=norm(value); let m=s.match(/^(20\d{2})-(\d{1,2})/); if(m)return`${m[1]}-${String(+m[2]).padStart(2,'0')}`;
    const map={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);
    return m?`${m[2]}-${String(map[m[1]]).padStart(2,'0')}`:'';
  };
  const median = arr => { const a=(arr||[]).map(Number).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b); if(!a.length)return 0; const i=Math.floor(a.length/2); return a.length%2?a[i]:(a[i-1]+a[i])/2; };

  function rowsFor(payload, financeId, range){
    return parseRows(payload?.sources?.[`${financeId}|${range}`] || []);
  }

  function build(payload, financeId){
    const concepts = rowsFor(payload,financeId,'Resumen_Conceptos_Ingresos!A:L');
    const details = rowsFor(payload,financeId,'Detalle_Ingresos!A:L');
    const conceptByMonth = new Map();
    const salaryByYear = new Map();
    const usdActualByMonth = new Map();
    const keys = new Set();

    concepts.forEach(row=>{
      const key=monthKey(row.Mes); if(!key)return; keys.add(key); conceptByMonth.set(key,row);
      const salary=num(row['Sueldo COP']); if(salary>0){const y=key.slice(0,4); if(!salaryByYear.has(y))salaryByYear.set(y,[]); salaryByYear.get(y).push(salary);}
    });
    details.forEach(row=>{
      const key=monthKey(row.Mes); if(!key)return; keys.add(key);
      if(norm(row.Tipo)==='ingreso laboral' && norm(row['Moneda original'])==='usd') usdActualByMonth.set(key,(usdActualByMonth.get(key)||0)+num(row['Valor original']));
    });

    const allSalary=[...salaryByYear.values()].flat();
    const months = new Map();
    [...keys].sort().forEach(key=>{
      const year=key.slice(0,4), row=conceptByMonth.get(key)||{};
      const copActual=num(row['Sueldo COP']);
      const copReference=median(salaryByYear.get(year)||[])||median(allSalary);
      const copRegular=copActual>0?copActual:copReference;

      const usdActual=usdActualByMonth.get(key)||0;
      const usdRegular=usdActual>0?Math.min(usdActual,DEFAULT_USD_BASE):DEFAULT_USD_BASE;
      const usdExtra=Math.max(0,usdActual-DEFAULT_USD_BASE);
      const explicitUsdEquiv=num(row['Sueldo USD (equiv. COP)']);
      const usdEquivCop=explicitUsdEquiv>0?Math.min(explicitUsdEquiv,usdRegular*DEFAULT_USD_COP):usdRegular*DEFAULT_USD_COP;
      const missing=[];
      if(!(copActual>0) && copRegular>0) missing.push('Nómina COP');
      if(!(usdActual>0)) missing.push('Fibrazo LLC');

      months.set(key,{
        key,year,
        copRegular,usdRegular,usdEquivCop,totalCop:copRegular+usdEquivCop,
        usdExtra,usdExtraCop:usdExtra*DEFAULT_USD_COP,
        copConfirmed:copActual>0,usdConfirmed:usdActual>0,
        complete:copActual>0&&usdActual>0,
        missingSupport:missing,
        usable:copRegular>0&&usdRegular>0
      });
    });

    const current=new Date();
    const currentKey=`${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}`;
    if(!months.has(currentKey)){
      const year=String(current.getFullYear()),copReference=median(salaryByYear.get(year)||[])||median(allSalary);
      if(copReference>0) months.set(currentKey,{key:currentKey,year,copRegular:copReference,usdRegular:DEFAULT_USD_BASE,usdEquivCop:DEFAULT_USD_BASE*DEFAULT_USD_COP,totalCop:copReference+DEFAULT_USD_BASE*DEFAULT_USD_COP,usdExtra:0,usdExtraCop:0,copConfirmed:false,usdConfirmed:false,complete:false,missingSupport:['Nómina COP','Fibrazo LLC'],usable:true});
    }

    function period(keys){
      const selected=(keys||[]).map(k=>months.get(k)).filter(Boolean);
      return {totalCop:selected.reduce((s,m)=>s+m.totalCop,0),months:selected,missing:selected.filter(m=>m.missingSupport.length)};
    }
    function average(year){
      const selected=[...months.values()].filter(m=>(!year||m.year===String(year))&&m.usable);
      if(!selected.length)return null;
      return {
        copRegular: selected.reduce((s,m)=>s+m.copRegular,0)/selected.length,
        usdRegular: selected.reduce((s,m)=>s+m.usdRegular,0)/selected.length,
        usdEquivCop: selected.reduce((s,m)=>s+m.usdEquivCop,0)/selected.length,
        totalCop: selected.reduce((s,m)=>s+m.totalCop,0)/selected.length,
        months:selected.length,
        pending:selected.filter(m=>m.missingSupport.length).length
      };
    }

    return {months,period,average,usdBase:DEFAULT_USD_BASE,usdCopReference:DEFAULT_USD_COP};
  }

  window.RegularIncomeCore = { build, monthKey, parseRows, num };
})();
