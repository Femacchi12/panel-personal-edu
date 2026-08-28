(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const apiBaseUrl=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!apiBaseUrl)return;

  const originalFetch=window.fetch.bind(window);
  let dataPromise=null,cacheUntil=0;
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function resetBackendCache(){dataPromise=null;cacheUntil=0;}
  async function getBackendData(force=false){
    const now=Date.now();if(force)resetBackendCache();if(dataPromise&&now<cacheUntil)return dataPromise;
    dataPromise=(async()=>{const getIdToken=window.__PANEL_GET_ID_TOKEN__;if(typeof getIdToken!=='function')throw new Error('No hay sesión Firebase disponible');const idToken=await getIdToken(false);if(!idToken)throw new Error('No se pudo obtener el token de sesión');const response=await originalFetch(`${apiBaseUrl}/api/data`,{method:'GET',headers:{Authorization:`Bearer ${idToken}`},cache:'no-store'});if(!response.ok){const body=await response.text();throw new Error(`${response.status} ${response.statusText}: ${body}`);}return response.json();})();
    cacheUntil=now+55_000;try{return await dataPromise;}catch(error){resetBackendCache();throw error;}
  }
  window.__PANEL_GET_BACKEND_DATA__=getBackendData;
  window.__PANEL_RESET_BACKEND_DATA__=resetBackendCache;

  function jsonResponse(payload,status=200,statusText='OK'){return new Response(JSON.stringify(payload),{status,statusText,headers:{'Content-Type':'application/json'}});}
  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const header=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(row=>row?.some(v=>String(v??'').trim()!=='')).map(row=>Object.fromEntries(header.map((name,index)=>[name||`Col ${index+1}`,row?.[index]??''])));}
  function rowsToMatrix(header,rows){return[header,...rows.map(row=>header.map(name=>row[name]??''))];}

  function applyMovementStateFilter(values,range){
    if(range!=='Movimientos!A:Z'||!Array.isArray(values)||values.length<2)return values;
    const header=(values[0]||[]).map(v=>String(v??'').trim()),statusIndex=header.map(norm).indexOf('estado');if(statusIndex<0)return values;
    return[values[0],...values.slice(1).filter(row=>window.MovementStatusCore?.isActual(row?.[statusIndex])??!/proyecc|proyect|programad/.test(norm(row?.[statusIndex])))];
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
    const rows=parseRows(payload?.sources?.[`${financeId}|Tarjetas!A:T`]||[]);
    return rows.find(row=>String(row['ID tarjeta']||'').trim()===id)||null;
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
    if(!['Tarjetas!A:T','Movimientos!A:Z','Cuotas!A:T'].includes(range)||!Array.isArray(values)||values.length<2)return values;
    const card=activeCard(payload);if(!card)return values;
    const header=(values[0]||[]).map(v=>String(v??'').trim());return rowsToMatrix(header,parseRows(values).filter(row=>rowMatchesCard(row,card,range)));
  }
  function filteredBackendPayload(payload){
    const card=activeCard(payload);if(!card||!payload?.sources)return payload;
    const next={...payload,sources:{...payload.sources}};
    ['Tarjetas!A:T','Movimientos!A:Z','Cuotas!A:T'].forEach(range=>{const key=`${financeId}|${range}`;if(Array.isArray(next.sources[key])){const header=(next.sources[key][0]||[]).map(v=>String(v??'').trim());next.sources[key]=rowsToMatrix(header,parseRows(next.sources[key]).filter(row=>rowMatchesCard(row,card,range)));}});
    return next;
  }

  function sourceValuesFromPayload(payload,spreadsheetId,range){
    const sourceValues=payload?.sources?.[`${spreadsheetId}|${range}`];
    if(!Array.isArray(sourceValues))throw new Error(`Fuente no permitida: ${range}`);
    const actualValues=applyMovementStateFilter(sourceValues,range),sectionValues=applySectionFilters(actualValues,range);
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

  document.addEventListener('click',event=>{if(event.isTrusted&&event.target.closest?.('#refreshBtn'))resetBackendCache();},true);
})();
