(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const financeId=String(cfg.financeSpreadsheetId||'');
  let frame=0,requestVersion=0;
  const DISPLAY_TOLERANCE_COP=5;
  const money=value=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(value)||0);
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const monthLabel=value=>{const m=String(value||'').match(/^(20\d{2})-(\d{2})$/);if(!m)return value||'—';const names=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];return `${names[Number(m[2])-1]} ${m[1]}`;};

  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const headers=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(row=>row?.some(v=>String(v??'').trim()!=='')).map(row=>Object.fromEntries(headers.map((name,index)=>[name||`Col ${index+1}`,row?.[index]??''])));}
  function parseNumber(value){if(typeof value==='number')return Number.isFinite(value)?value:0;let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}

  function categoryReconciliation(payload,policy){
    if(!financeId||!payload?.sources)return[];
    const movementRows=parseRows(payload.sources[`${financeId}|Movimientos!A:Z`]||[]);
    const summaryRows=parseRows(payload.sources[`${financeId}|Flujo_Mensual!A:J`]||[]);
    const now=new Date(),current=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const start=String(policy?.reconciliationStart||'2026-01');
    const canonical=new Map(),summary=new Map(),labels=new Map();

    movementRows.forEach(row=>{
      if(typeof policy?.isExpenseRow==='function'&&!policy.isExpenseRow(row))return;
      const month=policy?.monthKey?.(row['Mes consumo']||row['Fecha real']||row['Fecha registrada'])||'';
      if(!month||month<start||month>current)return;
      const label=String(row['Categoría']||row.Categoria||'Sin categoría').trim()||'Sin categoría';
      const key=`${month}|${norm(label)}`;
      canonical.set(key,(canonical.get(key)||0)+parseNumber(row['Monto COP']));
      labels.set(key,label);
    });

    summaryRows.forEach(row=>{
      if(norm(row.Tipo)!=='categoria')return;
      const month=policy?.monthKey?.(row.Mes)||'';
      if(!month||month<start||month>current)return;
      const label=String(row.Concepto||'Sin categoría').trim()||'Sin categoría';
      const key=`${month}|${norm(label)}`;
      summary.set(key,parseNumber(row['Total COP']));
      labels.set(key,label);
    });

    const keys=new Set([...canonical.keys(),...summary.keys()]);
    return [...keys].map(key=>{
      const [month]=key.split('|'),canonicalCop=canonical.get(key)||0,summaryCop=summary.get(key)||0;
      return {kind:'category',month,category:labels.get(key)||'Sin categoría',canonicalCop,summaryCop,differenceCop:summaryCop-canonicalCop,source:'Flujo_Mensual'};
    }).filter(item=>Math.abs(item.differenceCop)>DISPLAY_TOLERANCE_COP).sort((a,b)=>b.month.localeCompare(a.month)||Math.abs(b.differenceCop)-Math.abs(a.differenceCop));
  }

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
      .expense-reconciliation-row{display:grid;grid-template-columns:minmax(100px,1.2fr) 1fr 1fr 1fr;gap:8px;align-items:center;color:#91a1b5}
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

  function paint(result,categoryIssues=[]){
    const raw=Array.isArray(result?.mismatches)?result.mismatches:[];
    const monthly=raw.filter(item=>Math.abs(Number(item?.differenceCop)||0)>DISPLAY_TOLERANCE_COP).map(item=>({...item,kind:'month'}));
    const issues=[...monthly,...categoryIssues];
    const normalized={...result,ok:issues.length===0,mismatches:monthly,categoryMismatches:categoryIssues,issues,displayToleranceCop:DISPLAY_TOLERANCE_COP};
    window.__PANEL_EXPENSE_RECONCILIATION__=normalized;
    const host=ensureHost();if(!host)return;
    if(!issues.length){host.hidden=true;host.innerHTML='';return;}
    const latest=issues.slice().sort((a,b)=>b.month.localeCompare(a.month)||Math.abs(b.differenceCop)-Math.abs(a.differenceCop))[0];
    const monthlyCount=monthly.length,categoryCount=categoryIssues.length;
    const summary=[monthlyCount?`${monthlyCount} total${monthlyCount===1?'':'es'} mensual${monthlyCount===1?'':'es'}`:'',categoryCount?`${categoryCount} categoría${categoryCount===1?'':'s'}`:''].filter(Boolean).join(' y ');
    const latestLabel=latest.kind==='category'?`${monthLabel(latest.month)} · ${latest.category}`:monthLabel(latest.month);
    host.hidden=false;
    host.innerHTML=`<div class="expense-reconciliation-head"><div><strong>Conciliación de gastos pendiente</strong><span>Detecté diferencias en ${summary}. El dashboard usa exclusivamente Movimientos como fuente oficial de gasto real y no incorporó ninguna diferencia automáticamente. Última: ${latestLabel} · diferencia ${money(latest.differenceCop)}.</span></div><button type="button" class="expense-reconciliation-toggle">Ver detalle</button></div><div class="expense-reconciliation-detail" hidden>${issues.slice().sort((a,b)=>b.month.localeCompare(a.month)||String(a.category||'').localeCompare(String(b.category||''),'es')).slice(0,20).map(item=>`<div class="expense-reconciliation-row"><strong>${monthLabel(item.month)}${item.kind==='category'?` · ${item.category}`:''}</strong><span>Movimientos: ${money(item.canonicalCop)}</span><span>${item.source}: ${money(item.summaryCop)}</span><span>Diferencia: ${money(item.differenceCop)}</span></div>`).join('')}</div>`;
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
      paint(policy.reconcile(payload),categoryReconciliation(payload,policy));
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
