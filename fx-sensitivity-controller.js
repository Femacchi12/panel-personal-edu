(() => {
  'use strict';

  let frame=0;
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  const money=v=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);
  const number=(v,d=0)=>new Intl.NumberFormat('es-CO',{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(v)||0);
  const num=v=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:0;};

  function ensureStyle(){if(document.getElementById('fxSensitivityStyle'))return;const s=document.createElement('style');s.id='fxSensitivityStyle';s.textContent=`.fx-sensitivity{display:grid;gap:10px}.fx-sensitivity-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-end}.fx-sensitivity-head strong{font-size:13px}.fx-sensitivity-head span{display:block;color:#71839a;font-size:10px;margin-top:4px}.fx-sensitivity-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.fx-sensitivity-card{background:#0d1520;border:1px solid var(--border-soft);border-radius:11px;padding:11px;min-width:0}.fx-sensitivity-card span{display:block;color:#6d7f96;font-size:8px;text-transform:uppercase;letter-spacing:.055em;font-weight:800}.fx-sensitivity-card strong{display:block;margin-top:6px;font-size:17px;color:#eef5ff}.fx-sensitivity-card small{display:block;margin-top:4px;color:#71839a;font-size:9px;line-height:1.35}.fx-sensitivity-card.down strong{color:#ffcb68}.fx-sensitivity-card.up strong{color:#79e1ab}.fx-impact-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fx-impact-box{border:1px solid var(--border-soft);border-radius:10px;padding:9px;background:rgba(255,255,255,.018)}.fx-impact-box span{display:block;color:#6d7f96;font-size:8px;text-transform:uppercase;font-weight:800;letter-spacing:.05em}.fx-impact-box strong{display:block;margin-top:5px;font-size:13px;color:#dfeaf7}.fx-sensitivity-note{font-size:9px;line-height:1.45;color:#7c8ea6}@media(max-width:760px){.fx-sensitivity-grid{grid-template-columns:1fr}.fx-impact-grid{grid-template-columns:1fr}}`;document.head.appendChild(s);}

  function render(){
    if(activeView()!=='cambio')return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const rateInput=root.querySelector('#fxUsdCop');if(!rateInput)return;
    const rate=num(rateInput.value);if(!rate)return;
    const regularUsd=1300,primeUsd=650;
    const low=rate*.95,high=rate*1.05;
    let host=root.querySelector('#fxSensitivityPanel');
    if(!host){
      host=document.createElement('div');host.id='fxSensitivityPanel';host.className='panel fx-sensitivity';
      const panels=[...root.querySelectorAll('.fx-panel')],converter=panels[1]||panels[0];
      if(converter)converter.insertAdjacentElement('afterend',host);else root.appendChild(host);
    }
    host.innerHTML=`<div class="fx-sensitivity-head"><div><strong>Sensibilidad USD → COP</strong><span>Cómo cambia el valor en pesos si la tasa sube o baja 5 %.</span></div><span>Tasa base ${number(rate,0)}</span></div><div class="fx-sensitivity-grid"><div class="fx-sensitivity-card down"><span>Tasa -5 %</span><strong>${number(low,0)} COP/USD</strong><small>Ingreso USD 1.300 → ${money(regularUsd*low)}</small></div><div class="fx-sensitivity-card"><span>Tasa actual simulada</span><strong>${number(rate,0)} COP/USD</strong><small>Ingreso USD 1.300 → ${money(regularUsd*rate)}</small></div><div class="fx-sensitivity-card up"><span>Tasa +5 %</span><strong>${number(high,0)} COP/USD</strong><small>Ingreso USD 1.300 → ${money(regularUsd*high)}</small></div></div><div class="fx-impact-grid"><div class="fx-impact-box"><span>Impacto mensual · USD 1.300</span><strong>± ${money(regularUsd*rate*.05)}</strong></div><div class="fx-impact-box"><span>Impacto prima · USD 650</span><strong>± ${money(primeUsd*rate*.05)}</strong></div></div><div class="fx-sensitivity-note">Es una simulación de sensibilidad: no representa una tasa de mercado en tiempo real y no modifica movimientos, ingresos ni tipos de cambio históricos.</div>`;
    if(rateInput.dataset.fxSensitivityWired!=='1'){rateInput.dataset.fxSensitivityWired='1';rateInput.addEventListener('input',()=>schedule());}
  }

  function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;render();});}
  ensureStyle();
  document.addEventListener('panel:view-root-changed',event=>{if(event.detail?.view==='cambio'){setTimeout(schedule,0);setTimeout(schedule,80);}});
  document.addEventListener('panel:backend-refresh-requested',()=>{if(activeView()==='cambio')setTimeout(schedule,80);});
})();
