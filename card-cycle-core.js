(() => {
  'use strict';

  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function num(value){
    if(typeof value==='number') return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');
    if(!s) return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0) s=comma>dot?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
    else if(comma>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(dot>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function parseDate(value){
    if(typeof value==='number'&&Number.isFinite(value)&&value>20000&&value<80000){
      const utc=new Date(Math.round((value-25569)*86400000));
      return new Date(utc.getUTCFullYear(),utc.getUTCMonth(),utc.getUTCDate());
    }
    const s=String(value??'').trim();
    if(!s) return null;
    let m=s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if(m)return new Date(+m[1],+m[2]-1,+(m[3]||1));
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    const d=new Date(s);return Number.isNaN(d.getTime())?null:d;
  }

  function rowDate(row){
    return parseDate(row?.['Fecha real']||row?.['Fecha registrada']||row?.['Fecha']||row?.['Mes consumo']);
  }

  function ownerNick(value){
    const text=norm(value);
    if(text.includes('rocio')) return 'rocio';
    if(text.includes('edu')||text.includes('fernando')) return 'edu';
    return text;
  }

  function cardId(card){
    return String(card?.['ID tarjeta']||'').trim();
  }

  function movementCardId(row){
    const account=norm(row?.['Cuenta / Tarjeta']);
    const holder=ownerNick(row?.Titular);
    if(account.includes('mercado pago')||account.includes('mercadolibre')){
      if(account.includes('argentina')||String(row?.['Moneda original']||'').toUpperCase()==='ARS') return 'TC-MP-EDU-ARG';
    }
    if(account.includes('arq')) return 'TC-ARQ-EDU';
    if(account.includes('nu')&&(account.includes('nu ro')||account.includes('rocio')||holder==='rocio')) return 'TC-NU-RO';
    if(account.includes('nu')) return 'TC-NU-EDU';
    return '';
  }

  function matchesCard(row,card){
    if(!card) return true;
    const exact=movementCardId(row);
    if(exact) return exact===cardId(card);
    const issuer=norm(card?.Emisor),account=norm(row?.['Cuenta / Tarjeta']);
    const holder=ownerNick(row?.Titular),owner=ownerNick(card?.Titular);
    if(issuer&&!account.includes(issuer)) return false;
    return !owner||!holder||owner===holder;
  }

  function scopeOf(row){
    if(window.FinanceScopeCore?.scopeOf) return window.FinanceScopeCore.scopeOf(row);
    const explicit=norm(row?.['Ámbito']||row?.Ambito);
    if(explicit.includes('fibrazo')) return 'FIBRAZO';
    if(explicit.includes('personal')) return 'Personal';
    return norm(row?.Observaciones).includes('ambito explicito: fibrazo')?'FIBRAZO':'Personal';
  }

  function isActual(row){
    const status=norm(row?.Estado);
    if(/proyecc|proyect|programad|pendiente/.test(status)) return false;
    const type=norm(row?.Tipo||row?.Naturaleza||'gasto');
    return !type||type.includes('gasto')||type.includes('egreso')||type.includes('compra');
  }

  function isCreditPurchase(row){
    if(!isActual(row)) return false;
    if(typeof window.FinancePurchasePolicy?.isFinancedPurchase==='function') return window.FinancePurchasePolicy.isFinancedPurchase(row);
    const explicit=norm(row?.['Modalidad de pago']);
    const account=norm(row?.['Cuenta / Tarjeta']);
    const installments=num(row?.Cuotas);
    const credit=explicit?explicit==='credito':account.includes('arq')||account.includes('nu edu')||account.includes('nu ro')||(installments>0&&(account.includes('nu')||account.includes('arq')));
    if(!credit) return false;
    const description=norm(`${row?.['Subcategoría']??''} ${row?.['Descripción / Comercio']??''} ${row?.['Descripción original']??''}`);
    return !/cuota de manejo|interes|pago de tarjeta|pago tarjeta/.test(description);
  }

  function safeDate(year,monthIndex,day){
    const last=new Date(year,monthIndex+1,0).getDate();
    return new Date(year,monthIndex,Math.min(Math.max(1,day),last));
  }

  function registeredCycleRows(card,cycles=[]){
    const id=cardId(card);
    return (cycles||[]).filter(row=>String(row?.Tarjeta||'').trim()===id)
      .map(row=>({row,start:parseDate(row?.['Inicio ciclo']),cut:parseDate(row?.['Fecha corte'])}))
      .filter(x=>x.start&&x.cut)
      .sort((a,b)=>a.start-b.start||a.cut-b.cut);
  }

  function derivedCycleForDate(card,date=new Date()){
    const ref=date instanceof Date?new Date(date.getFullYear(),date.getMonth(),date.getDate()):parseDate(date);
    if(!ref) return null;
    const cutDay=Math.max(1,Math.min(31,Math.round(num(card?.['Día corte']||card?.['Dia corte']||card?.Corte)||1)));
    const cut=ref.getDate()<=cutDay
      ? safeDate(ref.getFullYear(),ref.getMonth(),cutDay)
      : safeDate(ref.getFullYear(),ref.getMonth()+1,cutDay);
    const prevCut=safeDate(cut.getFullYear(),cut.getMonth()-1,cutDay);
    const start=new Date(prevCut);start.setDate(start.getDate()+1);
    return {start,end:new Date(cut),cut,source:'derived',cycle:null};
  }

  function cycleForDate(card,cycles=[],date=new Date()){
    const d=date instanceof Date?new Date(date.getFullYear(),date.getMonth(),date.getDate()):parseDate(date);
    if(!d) return null;
    const exact=registeredCycleRows(card,cycles)
      .filter(x=>d>=x.start&&d<=x.cut)
      .sort((a,b)=>b.start-a.start||b.cut-a.cut)[0];
    if(exact) return {start:exact.start,end:new Date(exact.cut),cut:exact.cut,source:'registered',cycle:exact.row};
    return derivedCycleForDate(card,d);
  }

  function cycleBounds(card,cycles=[],now=new Date()){
    const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const matching=registeredCycleRows(card,cycles);
    const current=matching
      .filter(x=>today>=x.start&&today<=x.cut)
      .sort((a,b)=>b.start-a.start||b.cut-a.cut)[0];
    if(current) return {start:current.start,end:new Date(current.cut),cut:current.cut,source:'registered',cycle:current.row};
    const future=matching.find(x=>x.start>today);
    if(future) return {start:future.start,end:new Date(future.cut),cut:future.cut,source:'registered',cycle:future.row};
    return derivedCycleForDate(card,today);
  }

  function inCycle(row,card,cycles=[],now=new Date()){
    const d=rowDate(row),bounds=cycleBounds(card,cycles,now);
    if(!d||!bounds?.start||!bounds?.end) return false;
    return d>=bounds.start&&d<=bounds.end&&matchesCard(row,card);
  }

  function cycleRows(rows,card,cycles=[],now=new Date(),{creditOnly=true}={}){
    return (rows||[]).filter(row=>(!creditOnly||isCreditPurchase(row))&&inCycle(row,card,cycles,now));
  }

  function rowCopAmount(row){
    const direct=num(row?.['Monto COP']);
    if(direct) return direct;
    const original=num(row?.['Monto original']);
    const currency=String(row?.['Moneda original']||'COP').trim().toUpperCase();
    const cfg=window.PANEL_CONFIG||{},usdCop=Number(cfg.regularIncome?.usdCopReference||3150),usdArs=Number(cfg.regularIncome?.usdArsReference||1500);
    if(currency==='USD') return original*usdCop;
    if(currency==='ARS') return usdArs?original*usdCop/usdArs:original;
    return original;
  }

  function cardUsedCop(card){
    const used=num(card?.['Cupo usado']||card?.Utilizado||card?.['Saldo usado']);
    const currency=String(card?.Moneda||'COP').trim().toUpperCase();
    const cfg=window.PANEL_CONFIG||{},usdCop=Number(cfg.regularIncome?.usdCopReference||3150),usdArs=Number(cfg.regularIncome?.usdArsReference||1500);
    if(currency==='USD') return used*usdCop;
    if(currency==='ARS') return usdArs?used*usdCop/usdArs:used;
    return used;
  }

  function reconciledCycleRows(rows,card,cycles=[],now=new Date()){
    const strict=cycleRows(rows,card,cycles,now,{creditOnly:true});
    const issuer=norm(card?.Emisor);
    const bounds=cycleBounds(card,cycles,now);
    const target=cardUsedCop(card);
    const strictTotal=strict.reduce((sum,row)=>sum+rowCopAmount(row),0);
    const cycle=bounds?.cycle||null;
    const cycleCurrency=String(cycle?.Moneda||card?.Moneda||'COP').trim().toUpperCase();
    const cfg=window.PANEL_CONFIG||{},usdCop=Number(cfg.regularIncome?.usdCopReference||3150),usdArs=Number(cfg.regularIncome?.usdArsReference||1500);
    const componentToCop=value=>{
      const amount=num(value);
      if(cycleCurrency==='USD') return amount*usdCop;
      if(cycleCurrency==='ARS') return usdArs?amount*usdCop/usdArs:amount;
      return amount;
    };
    const supportsBankReconciliation=issuer.includes('arq')||issuer.includes('nu');
    const adjustments=supportsBankReconciliation&&cycle
      ? componentToCop(cycle['Cuotas del mes']) + componentToCop(cycle.Intereses) + componentToCop(cycle['Cuota manejo']) - componentToCop(cycle.Devoluciones)
      : 0;
    const baseTotal=strictTotal+adjustments;
    const initialDifference=target-baseTotal;
    if(!supportsBankReconciliation||!bounds?.start||target<=0||initialDifference<=1){
      return {rows:strict,strictRows:strict,carryRows:[],target,strictTotal,adjustments,total:strictTotal,obligationTotal:baseTotal,difference:target-baseTotal};
    }

    const from=new Date(bounds.start);from.setDate(from.getDate()-3);
    const to=new Date(bounds.start);to.setDate(to.getDate()-1);
    const candidates=(rows||[]).filter(row=>{
      if(!isCreditPurchase(row)||!matchesCard(row,card)) return false;
      const d=rowDate(row);
      return d&&d>=from&&d<=to;
    }).sort((a,b)=>(rowDate(b)?.getTime()||0)-(rowDate(a)?.getTime()||0));

    const solutions=[];
    candidates.forEach(row=>{
      if(Math.abs(rowCopAmount(row)-initialDifference)<=1) solutions.push([row]);
    });
    for(let i=0;i<candidates.length;i++){
      for(let j=i+1;j<candidates.length;j++){
        if(Math.abs(rowCopAmount(candidates[i])+rowCopAmount(candidates[j])-initialDifference)<=1){
          solutions.push([candidates[i],candidates[j]]);
        }
      }
    }

    const unique=new Map();
    solutions.forEach(solution=>{
      const key=solution.map(row=>String(row?.ID||row?.['Descripción / Comercio']||rowDate(row)?.getTime()||'')).sort().join('|');
      unique.set(key,solution);
    });
    const chosen=unique.size===1?[...unique.values()][0]:[];
    const merged=[...strict,...chosen].sort((a,b)=>(rowDate(a)?.getTime()||0)-(rowDate(b)?.getTime()||0));
    const total=merged.reduce((sum,row)=>sum+rowCopAmount(row),0);
    const obligationTotal=total+adjustments;
    return {
      rows:merged,strictRows:strict,carryRows:chosen,target,strictTotal,adjustments,total,obligationTotal,
      difference:target-obligationTotal,
      reconciliationStatus:chosen.length?'exact-late-posting':(unique.size>1?'ambiguous':'unmatched')
    };
  }

  function dateLabel(value){
    const d=value instanceof Date?value:parseDate(value);
    return d?`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`:'—';
  }

  window.CardCycleCore=Object.freeze({
    norm,num,parseDate,rowDate,ownerNick,cardId,movementCardId,matchesCard,scopeOf,isActual,isCreditPurchase,cycleForDate,cycleBounds,inCycle,cycleRows,rowCopAmount,cardUsedCop,reconciledCycleRows,dateLabel
  });
})();