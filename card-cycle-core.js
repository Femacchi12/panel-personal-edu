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

  function cycleBounds(card,cycles=[],now=new Date()){
    const id=cardId(card);
    const matching=(cycles||[]).filter(row=>String(row?.Tarjeta||'').trim()===id)
      .map(row=>({row,start:parseDate(row?.['Inicio ciclo']),cut:parseDate(row?.['Fecha corte'])}))
      .filter(x=>x.cut)
      .sort((a,b)=>a.cut-b.cut);
    const open=matching.find(x=>x.cut>=new Date(now.getFullYear(),now.getMonth(),now.getDate()));
    if(open){
      return {start:open.start||null,end:open.cut,cut:open.cut,source:'registered',cycle:open.row};
    }
    const cutDay=Math.max(1,Math.min(31,Math.round(num(card?.['Día corte']||card?.['Dia corte']||card?.Corte)||1)));
    let end=now.getDate()<=cutDay?safeDate(now.getFullYear(),now.getMonth(),cutDay):safeDate(now.getFullYear(),now.getMonth()+1,cutDay);
    const issuer=norm(card?.Emisor);
    let start=safeDate(end.getFullYear(),end.getMonth()-1,cutDay);
    if(issuer.includes('nu')) start=new Date(start.getFullYear(),start.getMonth(),start.getDate()+1);
    return {start,end,cut:end,source:'derived',cycle:null};
  }

  function inCycle(row,card,cycles=[],now=new Date()){
    const d=rowDate(row),bounds=cycleBounds(card,cycles,now);
    if(!d||!bounds?.start||!bounds?.end) return false;
    return d>=bounds.start&&d<=bounds.end&&matchesCard(row,card);
  }

  function cycleRows(rows,card,cycles=[],now=new Date(),{creditOnly=true}={}){
    return (rows||[]).filter(row=>(!creditOnly||isCreditPurchase(row))&&inCycle(row,card,cycles,now));
  }

  function dateLabel(value){
    const d=value instanceof Date?value:parseDate(value);
    return d?`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`:'—';
  }

  window.CardCycleCore=Object.freeze({
    norm,num,parseDate,rowDate,ownerNick,cardId,movementCardId,matchesCard,scopeOf,isActual,isCreditPurchase,cycleBounds,inCycle,cycleRows,dateLabel
  });
})();