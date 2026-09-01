(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const FINANCE_ID=String(cfg.financeSpreadsheetId||'');
  if(!FINANCE_ID)return;

  let frame=0,version=0,cache=null;
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const h=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));}
  function rowsFromPayload(payload,range){const cached=window.__PANEL_GET_CACHED_ROWS__;if(typeof cached==='function')return cached(payload,FINANCE_ID,range);return parseRows(payload?.sources?.[`${FINANCE_ID}|${range}`]||[]);}
  function date(value){const s=String(value||'').trim();let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);return null;}
  function startToday(){const n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate());}
  function age(d){return d?Math.max(0,Math.floor((startToday()-d)/86400000)):null;}
  function label(d){return d?new Intl.DateTimeFormat('es-CO',{day:'2-digit',month:'short',year:'numeric'}).format(d):'Sin fecha';}

  async function load(force=false){
    if(cache&&!force)return cache;
    const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')return[];
    const payload=await getData(force);
    cache=rowsFromPayload(payload,'Resumen_Inversiones!A:N');
    return cache;
  }

  function style(){
    if(document.getElementById('investmentFreshnessStyles'))return;
    const s=document.createElement('style');s.id='investmentFreshnessStyles';s.textContent=`
      .investment-freshness{margin-top:11px;padding-top:10px;border-top:1px solid var(--border-soft);display:grid;gap:8px}.investment-freshness-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.investment-freshness-head strong{font-size:10px;color:#cbd8e9;text-transform:uppercase;letter-spacing:.05em}.investment-freshness-head span{font-size:9px;color:#71839a}.investment-freshness-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:7px}.investment-freshness-item{border:1px solid var(--border-soft);border-radius:9px;padding:8px 9px;background:rgba(255,255,255,.025);display:flex;justify-content:space-between;gap:8px;align-items:center}.investment-freshness-item>div{display:grid;gap:2px;min-width:0}.investment-freshness-item strong{font-size:10px;color:#e2ecf8}.investment-freshness-item small{font-size:9px;color:#71839a}.investment-freshness-badge{font-size:8px;font-weight:800;border:1px solid var(--border);border-radius:99px;padding:4px 6px;color:#77dfaa;background:rgba(38,208,124,.06);white-space:nowrap}.investment-freshness-badge.warn{color:#ffcb68;background:rgba(246,200,68,.06);border-color:rgba(246,200,68,.25)}.investment-freshness-badge.bad{color:#ff8290;background:rgba(255,102,122,.06);border-color:rgba(255,102,122,.25)}
    `;document.head.appendChild(s);
  }

  function render(rows){
    if(activeView()!=='inversiones')return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const overview=root.querySelector('.investment-consolidated-overview');if(!overview)return;
    let host=overview.querySelector('.investment-freshness');if(!host){host=document.createElement('div');host.className='investment-freshness';overview.appendChild(host);}
    let latest=null;
    const items=rows.filter(r=>r.Entidad).map(r=>{const d=date(r['Fecha corte']),days=age(d),state=norm(r.Estado);if(d&&(!latest||d>latest))latest=d;let text='Al día',tone='';if(days===null){text='Sin fecha';tone='bad';}else if(days>60){text='Desactualizado';tone='bad';}else if(days>45){text='Revisar';tone='warn';}const meta=days===null?'No se pudo validar el corte':`${label(d)} · hace ${days} día${days===1?'':'s'}${state?` · ${r.Estado}`:''}`;return `<div class="investment-freshness-item"><div><strong>${esc(r.Entidad)}</strong><small>${esc(meta)}</small></div><span class="investment-freshness-badge ${tone}">${esc(text)}</span></div>`;});
    host.innerHTML=`<div class="investment-freshness-head"><strong>Actualización de datos</strong><span>Último corte disponible: ${esc(label(latest))}</span></div><div class="investment-freshness-grid">${items.join('')}</div>`;
  }

  async function run(force=false){
    if(activeView()!=='inversiones')return;
    const v=++version;
    try{const rows=await load(force);if(v!==version||activeView()!=='inversiones')return;render(rows);}catch(e){console.error('Investment freshness:',e);}
  }
  function schedule(force=false){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;setTimeout(()=>run(force),40);});}

  style();
  document.addEventListener('panel:view-root-changed',e=>{if(e.detail?.view==='inversiones')schedule(false);else version++;});
  document.addEventListener('panel:section-filters-changed',e=>{if(e.detail?.view==='inversiones')schedule(false);});
  document.addEventListener('panel:backend-refresh-requested',()=>{cache=null;schedule(true);});
  document.addEventListener('panel:backend-data-loaded',()=>{cache=null;schedule(false);});
  document.addEventListener('panel:modules-ready',()=>schedule(false));
  queueMicrotask(()=>schedule(false));
})();