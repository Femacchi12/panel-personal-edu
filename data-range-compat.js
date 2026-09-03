(() => {
  'use strict';
  const original=window.__PANEL_GET_CACHED_ROWS__;
  if(typeof original!=='function'||window.__PANEL_RANGE_COMPAT_INSTALLED__)return;
  window.__PANEL_RANGE_COMPAT_INSTALLED__=true;
  function col(label){let n=0;for(const ch of String(label||'').toUpperCase()){const c=ch.charCodeAt(0)-64;if(c<1||c>26)return-1;n=n*26+c}return n-1}
  function spec(range){const m=String(range||'').match(/^([^!]+)!([A-Z]+):([A-Z]+)$/i);if(!m)return null;return{sheet:m[1],start:col(m[2]),end:col(m[3])}}
  function parse(values){if(!Array.isArray(values)||values.length<2)return[];const h=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])))}
  window.__PANEL_GET_CACHED_ROWS__=(payload,spreadsheetId,range)=>{
    const direct=original(payload,spreadsheetId,range);
    if(Array.isArray(direct)&&direct.length)return direct;
    const wanted=spec(range);if(!wanted)return direct;
    const prefix=`${spreadsheetId}|`;let best=null;
    for(const [key,values] of Object.entries(payload?.sources||{})){
      if(!key.startsWith(prefix)||!Array.isArray(values))continue;
      const candidate=spec(key.slice(prefix.length));
      if(!candidate||candidate.sheet!==wanted.sheet||candidate.start!==wanted.start||candidate.end>wanted.end)continue;
      if(!best||candidate.end>best.end)best={end:candidate.end,values};
    }
    return best?parse(best.values):direct;
  };
})();