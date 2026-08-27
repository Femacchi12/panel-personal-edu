(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const apiBaseUrl=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!apiBaseUrl||!financeId)return;

  let lookupPromise=null;
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function num(v){let s=String(v??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}return Number(s)||0;}
  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const h=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((x,i)=>[x||`Col ${i+1}`,r?.[i]??''])));}
  function key(desc,account,holder,amount){return`${norm(desc)}|${norm(account)}|${norm(holder)}|${Math.round(num(amount))}`;}

  async function lookup(){
    if(lookupPromise)return lookupPromise;
    lookupPromise=(async()=>{
      const token=await window.__PANEL_GET_ID_TOKEN__?.(false);if(!token)return new Map();
      const r=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!r.ok)return new Map();
      const p=await r.json(),rows=parseRows(p?.sources?.[`${financeId}|Movimientos!A:Z`]||[]),map=new Map();
      rows.filter(row=>(!row.Tipo||norm(row.Tipo)==='gasto')&&(window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad/.test(norm(row.Estado)))).forEach(row=>{
        const value=/^(si|sí|true|1)$/i.test(String(row['Es fijo']||''))?'Fijo':'Variable';
        const k=key(row['Descripción / Comercio'],row['Cuenta / Tarjeta'],row.Titular,row['Monto COP']);
        if(!map.has(k))map.set(k,value);
      });
      return map;
    })();
    return lookupPromise;
  }

  async function enhance(table){
    if(!(table instanceof HTMLTableElement)||table.dataset.movementTypeDone==='1')return;
    const headers=[...table.querySelectorAll('thead th')].map(th=>norm(th.textContent.replace(/[↑↓]/g,'')));
    const descIndex=headers.findIndex(h=>h==='descripcion / comercio'||h==='descripción / comercio');
    const amountIndex=headers.findIndex(h=>h==='monto cop');
    if(descIndex<0||amountIndex<0)return;
    if(headers.includes('tipo de gasto')){table.dataset.movementTypeDone='1';return;}
    const accountIndex=headers.findIndex(h=>h==='cuenta / tarjeta');
    const holderIndex=headers.findIndex(h=>h==='titular');
    const typeIndex=Math.min(descIndex+1,headers.length);
    const map=await lookup();
    if(!table.isConnected)return;
    const header=table.querySelector('thead tr');if(!header)return;
    const th=document.createElement('th');th.textContent='Tipo de gasto';
    const ref=header.children[typeIndex]||null;header.insertBefore(th,ref);
    table.querySelectorAll('tbody tr').forEach(tr=>{
      const cells=[...tr.cells];
      const desc=cells[descIndex]?.textContent||'';
      const amount=cells[amountIndex]?.textContent||'';
      const account=accountIndex>=0?cells[accountIndex]?.textContent||'':'';
      const holder=holderIndex>=0?cells[holderIndex]?.textContent||'':'';
      const value=map.get(key(desc,account,holder,amount))||'Variable';
      const td=document.createElement('td');td.textContent=value;td.className=value==='Fijo'?'movement-fixed':'movement-variable';
      tr.insertBefore(td,tr.children[typeIndex]||null);
    });
    table.dataset.movementTypeDone='1';
  }

  function scan(root=document){root.querySelectorAll?.('table').forEach(t=>enhance(t));}
  const style=document.createElement('style');style.textContent='.movement-fixed{color:#26d07c;font-weight:700}.movement-variable{color:#a8b5c7}';document.head.appendChild(style);
  scan();const root=document.getElementById('viewRoot')||document.body;new MutationObserver(m=>m.forEach(x=>x.addedNodes.forEach(n=>{if(n instanceof Element){if(n.matches?.('table'))enhance(n);scan(n);}}))).observe(root,{childList:true,subtree:false});
})();
