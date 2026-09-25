(() => {
  'use strict';

  const VALID = new Set(['Personal','FIBRAZO','Todos']);
  const DEFAULTS = Object.freeze({ gastos:'Personal', flujo:'Personal', tarjetas:'Todos' });
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function num(value){
    if(typeof value==='number') return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');
    if(!s) return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0) s=c>d?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
    else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s); return Number.isFinite(n)?n:0;
  }

  function ensureState(){
    let state=window.__FINANCE_SCOPE_FILTER_STATE__;
    if(!state || typeof state!=='object' || Array.isArray(state)) state={};
    Object.entries(DEFAULTS).forEach(([view,value])=>{if(!VALID.has(state[view]))state[view]=value;});
    window.__FINANCE_SCOPE_FILTER_STATE__=state;
    return state;
  }

  function getScope(view){
    const state=ensureState();
    return VALID.has(state[view])?state[view]:(DEFAULTS[view]||'Personal');
  }

  function setScope(view,scope,{emit=true,source='finance-scope-core'}={}){
    if(!VALID.has(scope)) scope=DEFAULTS[view]||'Personal';
    const state=ensureState(),changed=state[view]!==scope;
    state[view]=scope;
    window.__FINANCE_SCOPE_FILTER_STATE__=state;
    if(emit && changed){
      document.dispatchEvent(new CustomEvent('panel:expense-scope-changed',{detail:{view,scope,source}}));
    }
    return scope;
  }

  function scopeOf(row){
    const explicit=norm(row?.['Ámbito']||row?.Ambito);
    if(explicit.includes('fibrazo')) return 'FIBRAZO';
    if(explicit.includes('personal')) return 'Personal';
    const marker=norm(row?.Observaciones);
    return marker.includes('ambito explicito: fibrazo')?'FIBRAZO':'Personal';
  }

  function monthKey(value){
    if(typeof window.RegularIncomeCore?.monthKey==='function'){
      const key=window.RegularIncomeCore.monthKey(value);
      if(key) return key;
    }
    const s=norm(value);
    let m=s.match(/^(20\d{2})-(\d{1,2})/);
    if(m) return `${m[1]}-${String(+m[2]).padStart(2,'0')}`;
    const map={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[\s-]+(20\d{2})/);
    return m?`${m[2]}-${String(map[m[1]]).padStart(2,'0')}`:'';
  }

  const rowMonth=row=>monthKey(row?.['Mes consumo']||row?.['Mes pago']||row?.['Fecha real']||row?.['Fecha registrada']);
  const currentMonthKey=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
  function previousMonth(key){const m=String(key||'').match(/^(20\d{2})-(\d{2})$/);if(!m)return'';const d=new Date(+m[1],+m[2]-2,1);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}

  function isActual(row){
    const type=norm(row?.Tipo||row?.Naturaleza);
    if(type && !type.includes('gasto') && !type.includes('egreso') && !type.includes('compra')) return false;
    return window.MovementStatusCore?.isActual
      ? window.MovementStatusCore.isActual(row?.Estado)
      : !/proyecc|proyect|programad|pendiente/.test(norm(row?.Estado));
  }

  function isProjection(row){
    const type=norm(row?.Tipo||row?.Naturaleza);
    if(type && !type.includes('gasto') && !type.includes('egreso') && !type.includes('compra')) return false;
    return window.MovementStatusCore?.isProjection
      ? window.MovementStatusCore.isProjection(row?.Estado)
      : /proyecc|proyect|programad/.test(norm(row?.Estado));
  }

  const isFixed=row=>/^(si|sí|true|1)$/i.test(String(row?.['Es fijo']||'').trim());
  const isSuper=row=>norm(row?.['Categoría'])==='supermercado';

  function amount(row,currency='COP'){
    if(currency==='USD') return num(row?.['Monto USD']);
    if(currency==='ARS') return num(row?.['Monto ARS']);
    return num(row?.['Monto COP']);
  }

  function closeStats(rows,{scope='Personal',currency='COP',key=currentMonthKey()}={}){
    const source=Array.isArray(rows)?rows:[];
    const scoped=scope==='Todos'?source:source.filter(row=>scopeOf(row)===scope);
    const prev=previousMonth(key);
    const actual=scoped.filter(row=>rowMonth(row)===key&&isActual(row));
    const previous=scoped.filter(row=>rowMonth(row)===prev&&isActual(row));
    const projections=scoped.filter(row=>rowMonth(row)===key&&isProjection(row));
    const sum=(list,predicate=()=>true)=>list.filter(predicate).reduce((total,row)=>total+amount(row,currency),0);
    const groups={
      super:{current:sum(actual,isSuper),previous:sum(previous,isSuper),projection:sum(projections,isSuper)},
      fixed:{current:sum(actual,isFixed),previous:sum(previous,isFixed),projection:sum(projections,isFixed)}
    };
    groups.super.remaining=Math.max(0,groups.super.previous-groups.super.current-groups.super.projection);
    groups.fixed.remaining=Math.max(0,groups.fixed.previous-groups.fixed.current-groups.fixed.projection);
    const realTotal=sum(actual),projectionTotal=sum(projections),recurringGap=groups.super.remaining+groups.fixed.remaining;
    return {
      key,prev,scope,currency,actual,previous,projections,groups,
      realTotal,projectionTotal,recurringGap,
      projectedTotal:realTotal+projectionTotal+recurringGap
    };
  }

  window.FinanceScopeCore=Object.freeze({
    validScopes:Object.freeze([...VALID]),
    state:ensureState,
    getScope,
    setScope,
    scopeOf,
    monthKey,
    rowMonth,
    currentMonthKey,
    previousMonth,
    isActual,
    isProjection,
    isFixed,
    isSuper,
    amount,
    closeStats
  });

  ensureState();
})();