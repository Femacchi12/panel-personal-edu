(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!financeId)return;

  const STORAGE_KEY='panel-personal-edu.fx-simulations.v1';
  let renderVersion=0,frame=0,pendingForce=false;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';

  function num(v){if(typeof v==='number')return Number.isFinite(v)?v:0;let s=String(v??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}
  const fmt=(v,c)=>new Intl.NumberFormat('es-CO',{style:'currency',currency:c,minimumFractionDigits:c==='USD'?2:0,maximumFractionDigits:c==='USD'?2:0}).format(Number(v)||0);

  async function payload(force=false){
    const getData=window.__PANEL_GET_BACKEND_DATA__;
    if(typeof getData!=='function')throw new Error('Backend central de datos no disponible');
    return getData(force);
  }
  function ratesFromMatrix(matrix){return{usdCop:num(matrix?.[3]?.[1])||3150,usdArs:num(matrix?.[4]?.[1])||1500};}
  function convert(amount,from,to,r){if(from===to)return amount;if(from==='USD'&&to==='COP')return amount*r.usdCop;if(from==='USD'&&to==='ARS')return amount*r.usdArs;if(from==='COP'&&to==='USD')return amount/r.usdCop;if(from==='ARS'&&to==='USD')return amount/r.usdArs;if(from==='ARS'&&to==='COP')return amount*(r.usdCop/r.usdArs);if(from==='COP'&&to==='ARS')return amount*(r.usdArs/r.usdCop);return 0;}
  function history(){try{const v=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');return Array.isArray(v)?v.slice(0,10):[];}catch(_){return[];}}
  function saveHistory(item){const next=[item,...history()].slice(0,10);localStorage.setItem(STORAGE_KEY,JSON.stringify(next));return next;}

  function setChrome(){
    const eyebrow=document.getElementById('viewEyebrow'),title=document.getElementById('viewTitle');
    if(eyebrow)eyebrow.textContent='FINANZAS';if(title)title.textContent='Tipo de cambio';
    const f=document.getElementById('filterBar');if(f)f.hidden=true;
    const s=document.getElementById('sectionFilterBar');if(s)s.hidden=true;
    const p=document.getElementById('paymentMethodFilterBar');if(p)p.hidden=true;
  }

  function historyHtml(items){if(!items.length)return'<div class="empty-state"><div><strong>Sin simulaciones todavía</strong><span>Al calcular una conversión aparecerá aquí. Se conservan solo las últimas 10.</span></div></div>';return`<div class="table-scroll expanded"><table><thead><tr><th>Fecha</th><th>Origen</th><th>Monto</th><th>Destino</th><th>Resultado</th><th>USD→COP</th><th>USD→ARS</th></tr></thead><tbody>${items.map(x=>`<tr><td>${esc(x.at)}</td><td>${esc(x.from)}</td><td>${esc(fmt(x.amount,x.from))}</td><td>${esc(x.to)}</td><td>${esc(fmt(x.result,x.to))}</td><td>${esc(new Intl.NumberFormat('es-CO',{maximumFractionDigits:2}).format(x.usdCop))}</td><td>${esc(new Intl.NumberFormat('es-CO',{maximumFractionDigits:2}).format(x.usdArs))}</td></tr>`).join('')}</tbody></table></div>`;}

  function paint(root,rates,items){
    setChrome();
    root.innerHTML=`<div class="section-head" data-fx-view><div><span class="eyebrow">FINANZAS</span><h2>Simulador de tipo de cambio</h2></div><p>Prueba escenarios COP / USD / ARS sin modificar los movimientos históricos.</p></div>
      <div class="panel fx-panel"><div class="panel-header"><div class="panel-title"><strong>Tasas para la simulación</strong><span>Se cargan desde Simulador_TC; puedes cambiarlas solo para esta prueba.</span></div><a class="btn btn-secondary" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/${financeId}/edit#gid=1900000001">Abrir hoja</a></div>
        <div class="fx-rate-grid"><label>1 USD = COP<input id="fxUsdCop" type="number" step="0.01" value="${rates.usdCop}"></label><label>1 USD = ARS<input id="fxUsdArs" type="number" step="0.01" value="${rates.usdArs}"></label><div><span>1 ARS = COP</span><strong id="fxArsCop">${new Intl.NumberFormat('es-CO',{maximumFractionDigits:4}).format(rates.usdCop/rates.usdArs)}</strong></div><div><span>1 COP = ARS</span><strong id="fxCopArs">${new Intl.NumberFormat('es-CO',{maximumFractionDigits:4}).format(rates.usdArs/rates.usdCop)}</strong></div></div>
      </div>
      <div class="panel fx-panel"><div class="panel-header"><div class="panel-title"><strong>Nueva simulación</strong><span>El resultado no modifica tus datos financieros.</span></div></div><div class="fx-converter"><select id="fxFrom"><option>COP</option><option>USD</option><option>ARS</option></select><input id="fxAmount" type="number" step="0.01" value="150000"><span>→</span><select id="fxTo"><option>USD</option><option>COP</option><option>ARS</option></select><button id="fxCalculate" class="btn btn-primary">Calcular</button></div><div class="fx-result" id="fxResult">—</div></div>
      <div class="panel table-panel"><div class="panel-header"><div class="panel-title"><strong>Últimas 10 simulaciones</strong><span>Historial local de este dispositivo; al superar 10 se elimina automáticamente la más antigua.</span></div><button id="fxClearHistory" class="text-btn">Borrar historial</button></div><div id="fxHistory">${historyHtml(items)}</div></div>`;

    const updateCross=()=>{const a=num(root.querySelector('#fxUsdCop')?.value),b=num(root.querySelector('#fxUsdArs')?.value);const arsCop=root.querySelector('#fxArsCop'),copArs=root.querySelector('#fxCopArs');if(arsCop)arsCop.textContent=b?new Intl.NumberFormat('es-CO',{maximumFractionDigits:4}).format(a/b):'—';if(copArs)copArs.textContent=a?new Intl.NumberFormat('es-CO',{maximumFractionDigits:4}).format(b/a):'—';};
    root.querySelector('#fxUsdCop')?.addEventListener('input',updateCross);root.querySelector('#fxUsdArs')?.addEventListener('input',updateCross);
    root.querySelector('#fxCalculate')?.addEventListener('click',()=>{const usdCop=num(root.querySelector('#fxUsdCop')?.value),usdArs=num(root.querySelector('#fxUsdArs')?.value),amount=num(root.querySelector('#fxAmount')?.value),from=root.querySelector('#fxFrom')?.value,to=root.querySelector('#fxTo')?.value,resultBox=root.querySelector('#fxResult');if(!usdCop||!usdArs||!amount||!from||!to){if(resultBox)resultBox.textContent='Completa tasas y monto';return;}const result=convert(amount,from,to,{usdCop,usdArs});if(resultBox)resultBox.textContent=`${fmt(amount,from)} = ${fmt(result,to)}`;const at=new Intl.DateTimeFormat('es-CO',{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date());const next=saveHistory({at,from,to,amount,result,usdCop,usdArs});const historyBox=root.querySelector('#fxHistory');if(historyBox)historyBox.innerHTML=historyHtml(next);});
    root.querySelector('#fxClearHistory')?.addEventListener('click',()=>{localStorage.removeItem(STORAGE_KEY);const historyBox=root.querySelector('#fxHistory');if(historyBox)historyBox.innerHTML=historyHtml([]);});
  }

  async function render(force=false){
    if(activeView()!=='cambio')return;
    const version=++renderVersion,root=document.getElementById('viewRoot');if(!root)return;
    setChrome();
    const p=await payload(force).catch(e=>{console.error('Simulador TC:',e);return null;});
    if(version!==renderVersion||activeView()!=='cambio'||!p||!root.isConnected)return;
    const matrix=p?.sources?.[`${financeId}|Simulador_TC!A:J`]||[];
    paint(root,ratesFromMatrix(matrix),history());
  }

  function schedule(force=false){
    pendingForce=pendingForce||force;
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      const useForce=pendingForce;pendingForce=false;
      render(useForce).catch(error=>console.error('Simulador TC:',error));
    });
  }

  function injectStyles(){if(document.getElementById('fxSimulatorStyles'))return;const s=document.createElement('style');s.id='fxSimulatorStyles';s.textContent=`.fx-rate-grid{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:12px}.fx-rate-grid label,.fx-rate-grid>div{background:#0a121c;border:1px solid #172335;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:7px}.fx-rate-grid span,.fx-rate-grid label{font-size:11px;color:#8190a5}.fx-rate-grid input,.fx-converter input,.fx-converter select{background:#0b1420;color:#e9f0fa;border:1px solid #1b2a3e;border-radius:9px;padding:10px;font:inherit}.fx-converter{display:grid;grid-template-columns:140px minmax(160px,1fr) 30px 140px auto;gap:10px;align-items:center}.fx-result{margin-top:14px;font-size:25px;font-weight:800;color:#26d07c}.fx-panel{margin-bottom:14px}@media(max-width:800px){.fx-rate-grid{grid-template-columns:1fr 1fr}.fx-converter{grid-template-columns:1fr 1fr}.fx-converter span{display:none}.fx-converter .btn{grid-column:1/-1}.fx-result{font-size:20px}}`;document.head.appendChild(s);}

  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{
    if(event.detail?.view==='cambio'){
      if(!event.detail?.root?.querySelector('[data-fx-view]'))schedule(false);
    }else renderVersion++;
  });
  document.addEventListener('panel:backend-data-loaded',()=>{if(activeView()==='cambio')schedule(false);});
})();
