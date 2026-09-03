(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const apiBaseUrl=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!apiBaseUrl)return;

  const originalFetch=window.fetch.bind(window);
  let dataPromise=null,cacheUntil=0,forcedReuseUntil=0;
  const parsedRowsCache=new WeakMap();
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  const EXPENSE_POLICY=Object.freeze({
    authoritativeRange:'Movimientos!A:Z',
    summaryRanges:Object.freeze(['Flujo_Ahorro!A:P','Flujo_Mensual!A:J']),
    reconciliationStart:'2026-01',
    toleranceCop:1,
    autoImport:false,
    rule:'Los egresos reales se toman únicamente de Movimientos. Los resúmenes sirven para conciliar y nunca crean gastos automáticamente.'
  });

  function resetBackendCache(){dataPromise=null;cacheUntil=0;forcedReuseUntil=0;}
  function requestBackend(forceRoute=false){
    return (async()=>{
      const getIdToken=window.__PANEL_GET_ID_TOKEN__;
      if(typeof getIdToken!=='function')throw new Error('No hay sesión Firebase disponible');
      const idToken=await getIdToken(false);
      if(!idToken)throw new Error('No se pudo obtener el token de sesión');
      const url=`${apiBaseUrl}/api/data${forceRoute?'?refresh=1':''}`;
      const response=await originalFetch(url,{method:'GET',headers:{Authorization:`Bearer ${idToken}`},cache:'no-store'});
      if(!response.ok){const body=await response.text();throw new Error(`${response.status} ${response.statusText}: ${body}`);}
      const payload=await response.json();
      document.dispatchEvent(new CustomEvent('panel:backend-data-loaded',{detail:{generatedAt:payload?.generatedAt||'',sourceErrors:payload?.sourceErrors||{}}}));
      return payload;
    })();
  }
  async function startBackendRequest(forceRoute=false){
    const now=Date.now();
    dataPromise=requestBackend(forceRoute);
    cacheUntil=now+55_000;
    try{return await dataPromise;}catch(error){resetBackendCache();throw error;}
  }
  async function getBackendData(force=false){
    const now=Date.now();
    if(force&&dataPromise&&now<cacheUntil&&now<forcedReuseUntil)return dataPromise;
    if(force)resetBackendCache();
    if(dataPromise&&now<cacheUntil)return dataPromise;
    return startBackendRequest(force);
  }
  async function forceBackendRefresh(){
    resetBackendCache();
    forcedReuseUntil=Number.POSITIVE_INFINITY;
    try{
      const payload=await startBackendRequest(true);
      forcedReuseUntil=Date.now()+5_000;
      return payload;
    }catch(error){forcedReuseUntil=0;throw error;}
  }
  window.__PANEL_GET_BACKEND_DATA__=getBackendData;
  window.__PANEL_FORCE_BACKEND_REFRESH__=forceBackendRefresh;
  window.__PANEL_RESET_BACKEND_DATA__=resetBackendCache;

  function jsonResponse(payload,status=200,statusText='OK'){return new Response(JSON.stringify(payload),{status,statusText,headers:{'Content-Type':'application/json'}});}
  function parseRowsAt(values,headerIndex=0){
    if(!Array.isArray(values)||!values.length||!Array.isArray(values[headerIndex]))return[];
    const header=(values[headerIndex]||[]).map(v=>String(v??'').trim());
    if(!header.some(Boolean))return[];
    return values.slice(headerIndex+1).filter(row=>row?.some(v=>String(v??'').trim()!=='')).map(row=>Object.fromEntries(header.map((name,index)=>[name||`Col ${index+1}`,row?.[index]??''])));
  }
  function parseRows(values){return parseRowsAt(values,0);}
  function parseRowsSmart(values){
    if(!Array.isArray(values)||!values.length)return[];
    let best=0,score=-1;
    for(let i=0;i<Math.min(values.length,12);i++){
      const row=values[i]||[];
      const nonEmpty=row.filter(v=>String(v??'').trim()!=='').length;
      const textual=row.filter(v=>typeof v==='string'&&/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(v)).length;
      const next=nonEmpty*2+textual;
      if(nonEmpty>=2&&next>score){score=next;best=i;}
    }
    return parseRowsAt(values,best);
  }
  function rowsToMatrix(header,rows){return[header,...rows.map(row=>header.map(name=>row[name]??''))];}
  function payloadSourceKey(spreadsheetId,range){return `${spreadsheetId}|${range}`;}
  function sourceKey(range){return payloadSourceKey(financeId,range);}
  function payloadRowCache(payload){
    if(!payload||typeof payload!=='object')return null;
    let cache=parsedRowsCache.get(payload);
    if(!cache){cache=new Map();parsedRowsCache.set(payload,cache);}
    return cache;
  }
  function cachedRows(payload,range,spreadsheetId=financeId){
    const key=payloadSourceKey(spreadsheetId,range),cache=payloadRowCache(payload);
    const resolved=resolveSource(payload,spreadsheetId,range);
    if(!cache)return parseRows(resolved?.values||[]);
    const cacheKey=`rows|${key}`;
    if(!cache.has(cacheKey))cache.set(cacheKey,parseRows(resolved?.values||[]));
    return cache.get(cacheKey);
  }
  function cachedSmartRows(payload,range,spreadsheetId=financeId){
    const key=payloadSourceKey(spreadsheetId,range),cache=payloadRowCache(payload);
    const resolved=resolveSource(payload,spreadsheetId,range);
    if(!cache)return parseRowsSmart(resolved?.values||[]);
    const cacheKey=`smart|${key}`;
    if(!cache.has(cacheKey))cache.set(cacheKey,parseRowsSmart(resolved?.values||[]));
    return cache.get(cacheKey);
  }
  window.__PANEL_GET_CACHED_ROWS__=(payload,spreadsheetId,range)=>cachedRows(payload,range,spreadsheetId);
  window.__PANEL_GET_CACHED_SMART_ROWS__=(payload,spreadsheetId,range)=>cachedSmartRows(payload,range,spreadsheetId);
  function parseNumber(value){
    if(typeof value==='number')return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');
    if(!s)return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0){if(comma>dot)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
    else if(comma>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(dot>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }
  function monthKey(value){
    const s=norm(value);
    let match=s.match(/^(20\d{2})[-\/]([01]?\d)/);
    if(match)return `${match[1]}-${String(+match[2]).padStart(2,'0')}`;
    match=s.match(/^(\d{1,2})[-\/]([01]?\d)[-\/](20\d{2})/);
    if(match)return `${match[3]}-${String(+match[2]).padStart(2,'0')}`;
    const months={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,dic:12,diciembre:12,noviembre:11,octubre:10};
    match=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[\s\-\/]+(20\d{2})/);
    return match?`${match[2]}-${String(months[match[1]]).padStart(2,'0')}`:'';
  }
  function movementMonth(row){return monthKey(row?.['Mes consumo']||row?.['Fecha real']||row?.['Fecha registrada']||row?.['Mes pago']);}
  function summaryMonth(row){return monthKey(row?.Mes||row?.Periodo||row?.['Período']||row?.Fecha);}
  function isActualStatus(value){return window.MovementStatusCore?.isActual(value)??!/proyecc|proyect|programad/.test(norm(value));}
  function isExpenseRow(row){const type=norm(row?.Tipo||row?.Naturaleza);return(!type||type.includes('gasto')||type.includes('egreso')||type.includes('compra'))&&isActualStatus(row?.Estado);}
  function canonicalExpenseTotals(payload){
    const totals=new Map();
    cachedRows(payload,EXPENSE_POLICY.authoritativeRange).forEach(row=>{
      if(!isExpenseRow(row))return;
      const month=movementMonth(row);if(!month)return;
      totals.set(month,(totals.get(month)||0)+parseNumber(row?.['Monto COP']));
    });
    return totals;
  }
  function pickNumber(row,names){for(const name of names){if(row?.[name]!=null&&String(row[name]).trim()!=='')return parseNumber(row[name]);}return 0;}
  function setExisting(row,names,value){for(const name of names){if(Object.prototype.hasOwnProperty.call(row,name)){row[name]=value;return true;}}return false;}
  function summaryExpense(row){return pickNumber(row,['Egresos reales COP','Egresos COP','Egresos','Total egresos COP','Total egresos']);}
  function summaryIncome(row){return pickNumber(row,['Ingresos reales COP','Ingresos COP','Ingresos','Total ingresos COP','Total ingresos']);}
  function canonicalizeExpenseSummary(values,range,payload){
    if(!EXPENSE_POLICY.summaryRanges.includes(range)||!Array.isArray(values)||values.length<2||!payload)return values;
    const header=(values[0]||[]).map(v=>String(v??'').trim());
    const totals=canonicalExpenseTotals(payload);
    const rows=parseRows(values).map(original=>{
      const row={...original};
      const month=summaryMonth(row);
      if(!month||month<EXPENSE_POLICY.reconciliationStart)return row;
      const expense=totals.get(month)||0;
      setExisting(row,['Egresos reales COP','Egresos COP','Egresos','Total egresos COP','Total egresos'],expense);
      const income=summaryIncome(row);
      if(income||Object.keys(row).some(key=>['Ingresos reales COP','Ingresos COP','Ingresos','Total ingresos COP','Total ingresos'].includes(key))){
        const savings=income-expense;
        setExisting(row,['Ahorro real COP','Ahorro COP','Ahorro'],savings);
        const rate=income?savings/income:0;
        setExisting(row,['Tasa de ahorro real','Tasa de ahorro','% ahorro'],`${(rate*100).toLocaleString('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1})}%`);
      }
      return row;
    });
    return rowsToMatrix(header,rows);
  }
  function reconcileExpenses(payload){
    const totals=canonicalExpenseTotals(payload);
    const now=new Date();
    const current=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const byMonth=new Map();
    for(const range of EXPENSE_POLICY.summaryRanges){
      for(const row of cachedRows(payload,range)){
        const month=summaryMonth(row);
        if(!month||month<EXPENSE_POLICY.reconciliationStart||month>current||byMonth.has(month))continue;
        const raw=summaryExpense(row);
        if(raw||totals.has(month))byMonth.set(month,{month,summaryCop:raw,canonicalCop:totals.get(month)||0,source:range.split('!')[0]});
      }
    }
    for(const [month,canonicalCop] of totals){
      if(month<EXPENSE_POLICY.reconciliationStart||month>current||byMonth.has(month))continue;
      byMonth.set(month,{month,summaryCop:0,canonicalCop,source:'Sin resumen'});
    }
    const mismatches=[...byMonth.values()].map(item=>({...item,differenceCop:item.summaryCop-item.canonicalCop})).filter(item=>Math.abs(item.differenceCop)>EXPENSE_POLICY.toleranceCop).sort((a,b)=>b.month.localeCompare(a.month));
    return {ok:mismatches.length===0,mismatches,checkedMonths:byMonth.size,policy:EXPENSE_POLICY};
  }
  window.__PANEL_EXPENSE_SOURCE_POLICY__=Object.freeze({
    ...EXPENSE_POLICY,
    isExpenseRow,
    monthKey,
    canonicalExpenseTotals,
    reconcile:reconcileExpenses
  });

  function applyMovementStateFilter(values,range){
    if(range!==EXPENSE_POLICY.authoritativeRange||!Array.isArray(values)||values.length<2)return values;
    const header=(values[0]||[]).map(v=>String(v??'').trim()),statusIndex=header.map(norm).indexOf('estado');if(statusIndex<0)return values;
    return[values[0],...values.slice(1).filter(row=>isActualStatus(row?.[statusIndex]))];
  }

  function applySectionFilters(values,range){
    const rules=Array.isArray(window.__PANEL_SECTION_FILTERS__?.rules)?window.__PANEL_SECTION_FILTERS__.rules:[];
    const activeRules=rules.filter(rule=>Array.isArray(rule?.values)&&rule.values.length&&rule?.ranges?.[range]);
    if(!activeRules.length||!Array.isArray(values)||values.length<2)return values;
    const header=(values[0]||[]).map(v=>String(v??'').trim()),headerNorm=header.map(norm);
    const compiled=activeRules.map(rule=>({indexes:(Array.isArray(rule.ranges[range])?rule.ranges[range]:[]).map(field=>headerNorm.indexOf(norm(field))).filter(index=>index>=0),selected:new Set(rule.values.map(norm))})).filter(rule=>rule.indexes.length);
    if(!compiled.length)return values;
    return[values[0],...values.slice(1).filter(row=>compiled.every(rule=>rule.indexes.some(index=>rule.selected.has(norm(row?.[index])))))];
  }

  function ownerNick(owner){const value=norm(owner);if(value.includes('rocio'))return'rocio';if(value.includes('edu')||value.includes('fernando'))return'edu';return value.split(/\s+/)[0]||'';}
  function activeCard(payload){
    const id=String(window.__PANEL_ACTIVE_CARD_ID__||'').trim();
    if(!id||document.querySelector('.nav-item.active')?.dataset.view!=='tarjetas'||!financeId)return null;
    return cachedRows(payload,'Tarjetas!A:T').find(row=>String(row['ID tarjeta']||'').trim()===id)||null;
  }
  function rowMatchesCard(row,card,range){
    if(!card)return true;const id=String(card['ID tarjeta']||'').trim();if(range==='Tarjetas!A:T')return String(row?.['ID tarjeta']||'').trim()===id;
    const issuer=norm(card.Emisor),owner=norm(card.Titular),nick=ownerNick(owner),source=norm([row?.['Cuenta / Tarjeta'],row?.['Cuenta/Tarjeta'],row?.Tarjeta,row?.['Medio de Pago'],row?.Pago].filter(Boolean).join(' ')),rowOwner=norm(row?.Titular);
    if(issuer&&!source.includes(issuer))return false;
    if(nick==='rocio')return rowOwner.includes('rocio')||/(^|\s|-)ro($|\s|-)/.test(source)||source.includes('rocio');
    if(nick==='edu')return rowOwner.includes('edu')||rowOwner.includes('fernando')||source.includes('edu')||source.includes('fernando');
    if(owner)return rowOwner.includes(owner)||source.includes(owner);
    return Boolean(issuer&&source.includes(issuer));
  }
  function applyCardFilter(values,range,payload){
    if(!['Tarjetas!A:T',EXPENSE_POLICY.authoritativeRange,'Cuotas!A:T'].includes(range)||!Array.isArray(values)||values.length<2)return values;
    const card=activeCard(payload);if(!card)return values;
    const header=(values[0]||[]).map(v=>String(v??'').trim());return rowsToMatrix(header,parseRows(values).filter(row=>rowMatchesCard(row,card,range)));
  }
  function filteredBackendPayload(payload){
    if(!payload?.sources)return payload;
    const card=activeCard(payload),next={...payload,sources:{...payload.sources}};
    EXPENSE_POLICY.summaryRanges.forEach(range=>{const key=sourceKey(range);if(Array.isArray(next.sources[key]))next.sources[key]=canonicalizeExpenseSummary(next.sources[key],range,payload);});
    if(card){
      ['Tarjetas!A:T',EXPENSE_POLICY.authoritativeRange,'Cuotas!A:T'].forEach(range=>{const key=sourceKey(range);if(Array.isArray(next.sources[key])){const header=(next.sources[key][0]||[]).map(v=>String(v??'').trim());next.sources[key]=rowsToMatrix(header,parseRows(next.sources[key]).filter(row=>rowMatchesCard(row,card,range)));}});
    }
    return next;
  }

  function columnIndex(label){
    const text=String(label||'').toUpperCase();let value=0;
    for(const char of text){const code=char.charCodeAt(0)-64;if(code<1||code>26)return-1;value=value*26+code;}
    return value-1;
  }
  function parseColumnRange(range){
    const match=String(range||'').match(/^([^!]+)!([A-Z]+):([A-Z]+)$/i);
    if(!match)return null;
    const start=columnIndex(match[2]),end=columnIndex(match[3]);
    if(start<0||end<start)return null;
    return {sheet:match[1],start,end};
  }
  function resolveSource(payload,spreadsheetId,range){
    const exactKey=`${spreadsheetId}|${range}`;
    const exact=payload?.sources?.[exactKey];
    if(Array.isArray(exact))return{key:exactKey,values:exact};
    const wanted=parseColumnRange(range);if(!wanted)return null;
    const prefix=`${spreadsheetId}|`;
    for(const [key,values] of Object.entries(payload?.sources||{})){
      if(!key.startsWith(prefix)||!Array.isArray(values))continue;
      const candidate=parseColumnRange(key.slice(prefix.length));
      if(!candidate||candidate.sheet!==wanted.sheet||candidate.start>wanted.start||candidate.end<wanted.end)continue;
      const offset=wanted.start-candidate.start,width=wanted.end-wanted.start+1;
      return{key,values:values.map(row=>Array.isArray(row)?row.slice(offset,offset+width):[])};
    }
    return null;
  }
  function sourceValuesFromPayload(payload,spreadsheetId,range){
    const exactKey=`${spreadsheetId}|${range}`;
    const resolved=resolveSource(payload,spreadsheetId,range);
    const sourceError=payload?.sourceErrors?.[resolved?.key||exactKey];
    if(sourceError)throw new Error(`Fuente no disponible: ${range} · ${sourceError}`);
    if(!resolved)throw new Error(`Fuente no permitida: ${range}`);
    const sourceValues=resolved.values;
    const canonicalValues=spreadsheetId===financeId?canonicalizeExpenseSummary(sourceValues,range,payload):sourceValues;
    const actualValues=applyMovementStateFilter(canonicalValues,range),sectionValues=applySectionFilters(actualValues,range);
    return spreadsheetId===financeId?applyCardFilter(sectionValues,range,payload):sectionValues;
  }
  async function getSourceValues(spreadsheetId,range,force=false){return sourceValuesFromPayload(await getBackendData(force),spreadsheetId,range);}
  window.__PANEL_GET_SOURCE_VALUES__=getSourceValues;

  window.fetch=async function(input,init){
    const rawUrl=typeof input==='string'?input:input?.url,method=String(init?.method||input?.method||'GET').toUpperCase(),normalizedUrl=String(rawUrl||'').replace(/\/$/,'');
    if(normalizedUrl===`${apiBaseUrl}/api/data`&&method==='GET'){
      try{return jsonResponse(filteredBackendPayload(await getBackendData(false)));}catch(error){return jsonResponse({error:{message:String(error?.message||error)}},502,'Backend Error');}
    }
    if(!rawUrl||!rawUrl.startsWith('https://sheets.googleapis.com/v4/spreadsheets/'))return originalFetch(input,init);
    const url=new URL(rawUrl),match=url.pathname.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/);if(!match)return originalFetch(input,init);
    const spreadsheetId=decodeURIComponent(match[1]),range=decodeURIComponent(match[2]);
    try{return jsonResponse({range,majorDimension:'ROWS',values:await getSourceValues(spreadsheetId,range,false)});}catch(error){return jsonResponse({error:{message:String(error?.message||error)}},502,'Backend Error');}
  };
})();