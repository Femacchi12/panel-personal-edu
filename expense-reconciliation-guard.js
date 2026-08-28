(() => {
  'use strict';

  let frame=0,requestVersion=0;
  const DISPLAY_TOLERANCE_COP=5;
  const money=value=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(value)||0);
  const monthLabel=value=>{const m=String(value||'').match(/^(20\d{2})-(\d{2})$/);if(!m)return value||'—';const names=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];return `${names[Number(m[2])-1]} ${m[1]}`;};

  function ensureStyles(){
    if(document.getElementById('expenseReconciliationStyles'))return;
    const style=document.createElement('style');
    style.id='expenseReconciliationStyles';
    style.textContent=`
      .expense-reconciliation-alert{margin:0 0 12px;padding:11px 13px;border:1px solid rgba(246,200,68,.28);border-radius:11px;background:rgba(246,200,68,.07);color:#dce6f3;font-size:10px;line-height:1.45}
      .expense-reconciliation-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      .expense-reconciliation-head strong{display:block;color:#f6c844;font-size:11px;margin-bottom:3px}
      .expense-reconciliation-head span{color:#8fa0b6}
      .expense-reconciliation-toggle{border:1px solid #5f5125;background:#17160f;color:#f6c844;border-radius:8px;padding:6px 8px;font-size:9px;font-weight:700;cursor:pointer;white-space:nowrap}
      .expense-reconciliation-detail{display:grid;gap:5px;margin-top:9px;padding-top:8px;border-top:1px solid rgba(246,200,68,.16)}
      .expense-reconciliation-row{display:grid;grid-template-columns:90px 1fr 1fr 1fr;gap:8px;align-items:center;color:#91a1b5}
      .expense-reconciliation-row strong{color:#e6edf7;font-size:10px}
      @media(max-width:720px){.expense-reconciliation-row{grid-template-columns:1fr 1fr}.expense-reconciliation-head{flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function ensureHost(){
    const root=document.getElementById('viewRoot');
    if(!root?.parentElement)return null;
    let host=document.getElementById('expenseReconciliationAlert');
    if(!host){
      host=document.createElement('section');
      host.id='expenseReconciliationAlert';
      host.className='expense-reconciliation-alert';
      host.hidden=true;
      root.parentElement.insertBefore(host,root);
    }
    return host;
  }

  function paint(result){
    const raw=Array.isArray(result?.mismatches)?result.mismatches:[];
    const mismatches=raw.filter(item=>Math.abs(Number(item?.differenceCop)||0)>DISPLAY_TOLERANCE_COP);
    const normalized={...result,ok:mismatches.length===0,mismatches,displayToleranceCop:DISPLAY_TOLERANCE_COP};
    window.__PANEL_EXPENSE_RECONCILIATION__=normalized;
    const host=ensureHost();if(!host)return;
    if(!mismatches.length){host.hidden=true;host.innerHTML='';return;}
    const latest=mismatches[0],count=mismatches.length;
    host.hidden=false;
    host.innerHTML=`<div class="expense-reconciliation-head"><div><strong>Conciliación de gastos pendiente</strong><span>${count} período${count===1?'':'s'} con diferencia entre el resumen y Movimientos. El dashboard usa Movimientos como fuente oficial y no incorporó ninguna diferencia automáticamente. Última: ${monthLabel(latest.month)} · diferencia ${money(latest.differenceCop)}.</span></div><button type="button" class="expense-reconciliation-toggle">Ver detalle</button></div><div class="expense-reconciliation-detail" hidden>${mismatches.slice(0,12).map(item=>`<div class="expense-reconciliation-row"><strong>${monthLabel(item.month)}</strong><span>Movimientos: ${money(item.canonicalCop)}</span><span>${item.source}: ${money(item.summaryCop)}</span><span>Diferencia: ${money(item.differenceCop)}</span></div>`).join('')}</div>`;
    const button=host.querySelector('.expense-reconciliation-toggle'),detail=host.querySelector('.expense-reconciliation-detail');
    button?.addEventListener('click',()=>{const open=detail?.hidden!==false;if(detail)detail.hidden=!open;if(button)button.textContent=open?'Ocultar detalle':'Ver detalle';});
  }

  async function run(){
    const version=++requestVersion;
    const policy=window.__PANEL_EXPENSE_SOURCE_POLICY__,getData=window.__PANEL_GET_BACKEND_DATA__;
    if(!policy||typeof policy.reconcile!=='function'||typeof getData!=='function')return;
    try{
      const payload=await getData(false);
      if(version!==requestVersion)return;
      paint(policy.reconcile(payload));
    }catch(error){console.error('Conciliación de gastos:',error);}
  }

  function schedule(){
    if(frame)return;
    frame=requestAnimationFrame(()=>{frame=0;run();});
  }

  ensureStyles();
  document.addEventListener('panel:backend-data-loaded',schedule);
  document.addEventListener('panel:view-root-changed',schedule);
  document.addEventListener('panel:filters-updated',schedule);
  queueMicrotask(schedule);
})();
