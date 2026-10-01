(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function num(value){
    if(typeof value==='number') return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');
    if(!s) return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0) s=comma>dot?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
    else if(comma>=0){const p=s.split(',');s=p.length===2&&p[1].length<=4?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
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
    if(m) return new Date(+m[1],+m[2]-1,+(m[3]||1));
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(m) return new Date(+m[3],+m[2]-1,+m[1]);
    m=norm(s).match(/^([a-z]+)[\s\-\/]+(\d{4})$/);
    if(m){
      const token=m[1].replace('set','sept');
      const idx=MONTHS.findIndex(x=>token.startsWith(x));
      if(idx>=0) return new Date(+m[2],idx,1);
    }
    const d=new Date(s);
    return Number.isNaN(d.getTime())?null:d;
  }

  function monthStart(value){
    const d=value instanceof Date?value:parseDate(value);
    return d?new Date(d.getFullYear(),d.getMonth(),1):null;
  }
  function addMonths(date,n){ return new Date(date.getFullYear(),date.getMonth()+n,1); }
  function monthKey(value){
    const d=monthStart(value);
    return d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`:'';
  }
  function monthLabel(value){
    const d=monthStart(value);
    return d?`${MONTHS[d.getMonth()]} ${d.getFullYear()}`:'—';
  }

  const usdCop=Number(cfg.regularIncome?.usdCopReference||3150);
  const usdArs=Number(cfg.regularIncome?.usdArsReference||1500);
  function normalizeCurrency(value){
    const raw=String(value||'COP').trim().toUpperCase();
    if(raw.includes('ARS')) return 'ARS';
    if(raw.includes('USD')) return 'USD';
    return 'COP';
  }
  function nativeToCop(value,currency='COP'){
    const amount=num(value),code=normalizeCurrency(currency);
    if(code==='USD') return amount*usdCop;
    if(code==='ARS') return usdArs?amount*usdCop/usdArs:amount;
    return amount;
  }
  function amountSetFromCop(cop,nativeValue=null,nativeCurrency='COP'){
    const code=normalizeCurrency(nativeCurrency),native=nativeValue==null?null:num(nativeValue);
    const usd=usdCop?cop/usdCop:cop;
    const ars=usd*usdArs;
    return {
      'Monto COP':cop,
      'Monto USD':code==='USD'&&native!=null?native:usd,
      'Monto ARS':code==='ARS'&&native!=null?native:ars
    };
  }

  function cardIdFromInstallment(row){
    const exact=String(row?.['ID tarjeta canónica']||'').trim();
    if(exact) return exact;
    const raw=String(row?.Tarjeta||'').trim();
    if(raw.startsWith('TC-')) return raw;
    const s=norm(`${raw} ${row?.Titular||''}`);
    if(s.includes('mercado pago')||s.includes('mastercard')) return 'TC-MP-EDU-ARG';
    if(s.includes('arq')) return 'TC-ARQ-EDU';
    if(s.includes('nu')&&(s.includes('rocio')||/\bro\b/.test(s))) return 'TC-NU-RO';
    if(s.includes('nu')) return 'TC-NU-EDU';
    return '';
  }

  function movementCardId(row){
    return window.CardCycleCore?.movementCardId?.(row)||'';
  }

  function movementDate(row){
    return window.CardCycleCore?.rowDate?.(row)
      || parseDate(row?.['Fecha real']||row?.['Fecha registrada']||row?.Fecha||row?.['Mes consumo']);
  }

  function movementCop(row){
    const direct=num(row?.['Monto COP']);
    if(direct) return direct;
    return nativeToCop(row?.['Monto original'],row?.['Moneda original']);
  }

  function scopeOf(row){
    const explicit=norm(row?.['Ámbito']||row?.Ambito);
    if(explicit.includes('fibrazo')) return 'FIBRAZO';
    if(explicit.includes('personal')) return 'Personal';
    return window.CardCycleCore?.scopeOf?.(row)||'Personal';
  }

  function isCredit(row){
    return window.CardCycleCore?.isCreditPurchase?.(row) || false;
  }

  function installmentsCount(row){ return Math.max(0,Math.round(num(row?.Cuotas))); }
  function installmentNumber(row){
    const explicit=Math.round(num(row?.['N° cuota']||row?.['Nº cuota']||row?.['Cuota actual']));
    if(explicit>0) return explicit;
    const text=String(row?.['Descripción / Comercio']||row?.Descripción||'');
    const m=text.match(/(?:^|\s|-)(\d+)\s*\/\s*(\d+)(?:\s|$|-)/);
    return m?+m[1]:0;
  }

  function quotaAllocationMonth(row){
    const helper=monthStart(row?.['Mes imputación']);
    if(helper) return helper;
    const first=monthStart(row?.['Fecha primera cuota']);
    const current=Math.max(1,Math.round(num(row?.['Cuota actual']))||1);
    return first?addMonths(first,current-1):null;
  }

  function quotaCop(row){
    const helper=num(row?.['Monto cuota COP']);
    return helper||nativeToCop(row?.['Valor cuota'],row?.Moneda);
  }

  function uniqueMovementCandidate(movements,predicate){
    const found=(movements||[]).filter(predicate);
    return found.length===1?found[0]:null;
  }

  function sameDay(a,b){
    return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
  }

  function findOriginalMovement(group,movements){
    const first=group[0]||{};
    const purchaseDate=parseDate(first['Fecha compra']);
    const cardId=cardIdFromInstallment(first);
    const totalNative=num(first['Total compra']);
    const currency=normalizeCurrency(first.Moneda);
    const totalCop=nativeToCop(totalNative,currency);
    if(!purchaseDate||!cardId||!totalNative) return null;
    return uniqueMovementCandidate(movements,row=>{
      const d=movementDate(row);
      if(!sameDay(d,purchaseDate)||movementCardId(row)!==cardId) return false;
      const original=num(row?.['Monto original']);
      const cop=movementCop(row);
      return Math.abs(original-totalNative)<=1 || Math.abs(cop-totalCop)<=1;
    });
  }

  function findLinkedMovement(row,movements,byId,original){
    const linked=String(row?.['Movimiento vinculado']||'').trim();
    if(linked&&byId.has(linked)) return byId.get(linked);
    const month=quotaAllocationMonth(row),cardId=cardIdFromInstallment(row),target=quotaCop(row);
    if(!month||!cardId||!target) return original||null;
    const unique=uniqueMovementCandidate(movements,m=>{
      const d=movementDate(m);
      if(!d||d.getFullYear()!==month.getFullYear()||d.getMonth()!==month.getMonth()) return false;
      if(movementCardId(m)!==cardId) return false;
      return Math.abs(movementCop(m)-target)<=Math.max(1,Math.abs(target)*0.00002);
    });
    return unique||original||null;
  }

  function cardRowById(cards,id){ return (cards||[]).find(card=>String(card?.['ID tarjeta']||'').trim()===id)||null; }

  function scheduledAllocation(row,meta,original){
    const month=quotaAllocationMonth(row);
    if(!month) return null;
    const cardId=cardIdFromInstallment(row);
    const cop=quotaCop(row);
    const native=num(row?.['Valor cuota']);
    const currency=normalizeCurrency(row?.Moneda);
    const scope=scopeOf(row);
    const current=Math.max(1,Math.round(num(row?.['Cuota actual']))||1);
    const count=Math.max(current,Math.round(num(row?.['N° cuotas']))||current);
    const category=String(row?.Categoría||meta?.['Categoría']||original?.['Categoría']||'Sin clasificar').trim()||'Sin clasificar';
    const subcategory=String(row?.Subcategoría||meta?.['Subcategoría']||original?.['Subcategoría']||'').trim();
    const description=String(row?.Descripción||row?.Comercio||meta?.['Descripción / Comercio']||original?.['Descripción / Comercio']||'Compra en cuotas').trim();
    const purchaseDate=parseDate(row?.['Fecha compra'])||movementDate(original)||movementDate(meta);
    return {
      ID:`ALLOC-${String(row?.['ID compra']||cardId)}-${current}`,
      'Fecha real':month,
      'Fecha registrada':month,
      'Mes consumo':monthKey(month),
      'Fecha compra original':purchaseDate||'',
      Tipo:'Gasto',Naturaleza:'Gasto',
      'Categoría':category,'Subcategoría':subcategory,
      'Descripción / Comercio':description,
      'Descripción original':String(meta?.['Descripción original']||original?.['Descripción original']||description),
      'Monto original':native,
      'Moneda original':currency,
      'Cuenta / Tarjeta':String(meta?.['Cuenta / Tarjeta']||original?.['Cuenta / Tarjeta']||row?.Tarjeta||cardId),
      Titular:String(row?.Titular||meta?.Titular||original?.Titular||''),
      Cuotas:count,'N° cuota':current,
      Estado:'Registrado',
      'Modalidad de pago':'Crédito',
      'Ámbito':scope,
      ...amountSetFromCop(cop,native,currency),
      __cardId:cardId,
      __allocationType:'installment',
      __allocationMonth:month,
      __purchaseDate:purchaseDate,
      __allocationLabel:`Cuota ${current}/${count}`,
      __allocationStatus:String(row?.['Estado detalle']||row?.Estado||'').trim(),
      __installmentId:String(row?.['ID compra']||''),
      __sourceMovementId:String(meta?.ID||original?.ID||'')
    };
  }

  function onePayAllocation(row){
    const date=movementDate(row);
    if(!date) return null;
    const cop=movementCop(row),currency=normalizeCurrency(row?.['Moneda original']);
    return {
      ...row,
      'Fecha real':date,
      'Mes consumo':monthKey(date),
      'Ámbito':scopeOf(row),
      ...amountSetFromCop(cop,num(row?.['Monto original']),currency),
      __cardId:movementCardId(row),
      __allocationType:'one-pay',
      __allocationMonth:monthStart(date),
      __purchaseDate:date,
      __allocationLabel:'1 pago',
      __allocationStatus:'Registrado',
      __sourceMovementId:String(row?.ID||'')
    };
  }

  function movementInstallmentAllocation(row){
    const date=movementDate(row);
    if(!date) return null;
    const count=Math.max(1,installmentsCount(row));
    const current=Math.max(1,installmentNumber(row)||1);
    const out=onePayAllocation(row);
    if(!out) return null;
    out.__allocationType='installment-fallback';
    out.__allocationLabel=`Cuota ${current}/${count}`;
    out.Cuotas=count;out['N° cuota']=current;
    return out;
  }

  function projectedInstallments(row,cards,cycles){
    const count=installmentsCount(row);
    const date=movementDate(row);
    const cardId=movementCardId(row);
    const card=cardRowById(cards,cardId);
    if(count<=1||!date||!cardId) return [];
    const bounds=window.CardCycleCore?.cycleForDate?.(card,cycles,date);
    const first=monthStart(bounds?.cut||date);
    const total=movementCop(row);
    const base=Math.round(total/count*100)/100;
    let allocated=0;
    return Array.from({length:count},(_,index)=>{
      const value=index===count-1?Math.round((total-allocated)*100)/100:base;
      allocated+=value;
      const month=addMonths(first,index);
      const copy=onePayAllocation(row);
      copy['Fecha real']=month;
      copy['Mes consumo']=monthKey(month);
      Object.assign(copy,amountSetFromCop(value,null,'COP'));
      copy['Monto original']=value;
      copy['Moneda original']='COP';
      copy['N° cuota']=index+1;
      copy.__allocationType='installment-projection';
      copy.__allocationMonth=month;
      copy.__allocationLabel=`Cuota estimada ${index+1}/${count}`;
      copy.__allocationStatus='Proyección';
      copy.__purchaseDate=date;
      copy.ID=`ALLOC-PROJ-${String(row?.ID||cardId)}-${index+1}`;
      return copy;
    });
  }

  function build({movements=[],installments=[],cards=[],cycles=[]}={}){
    const rawCredit=(movements||[]).filter(isCredit);
    const byId=new Map((movements||[]).map(row=>[String(row?.ID||'').trim(),row]).filter(([id])=>id));
    const groups=new Map();
    (installments||[]).forEach(row=>{
      const id=String(row?.['ID compra']||'').trim();
      if(!id) return;
      if(!groups.has(id)) groups.set(id,[]);
      groups.get(id).push(row);
    });

    const excludedMovementIds=new Set();
    const allocations=[];

    groups.forEach(group=>{
      const original=findOriginalMovement(group,rawCredit);
      if(original?.ID) excludedMovementIds.add(String(original.ID));
      group.forEach(row=>{
        const linked=findLinkedMovement(row,rawCredit,byId,original);
        if(linked?.ID) excludedMovementIds.add(String(linked.ID));
        const allocation=scheduledAllocation(row,linked,original);
        if(allocation) allocations.push(allocation);
      });
    });

    rawCredit.forEach(row=>{
      const id=String(row?.ID||'');
      if(id&&excludedMovementIds.has(id)) return;
      const count=installmentsCount(row);
      const current=installmentNumber(row);
      if(count>1){
        if(current>0) {
          const allocation=movementInstallmentAllocation(row);
          if(allocation) allocations.push(allocation);
        } else {
          allocations.push(...projectedInstallments(row,cards,cycles));
        }
        return;
      }
      const allocation=onePayAllocation(row);
      if(allocation) allocations.push(allocation);
    });

    return allocations.sort((a,b)=>{
      const ma=a.__allocationMonth?.getTime?.()||0,mb=b.__allocationMonth?.getTime?.()||0;
      if(ma!==mb) return ma-mb;
      const pa=a.__purchaseDate?.getTime?.()||0,pb=b.__purchaseDate?.getTime?.()||0;
      return pa-pb;
    });
  }

  window.CardMonthlyAllocationCore=Object.freeze({
    num,parseDate,monthStart,monthKey,monthLabel,nativeToCop,movementDate,scopeOf,
    cardIdFromInstallment,quotaAllocationMonth,quotaCop,build
  });
})();