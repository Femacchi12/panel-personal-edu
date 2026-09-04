(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const FINANCE_ID=String(cfg.financeSpreadsheetId||'');
  if(!FINANCE_ID)return;

  const RANGES={
    flow:'Flujo_Ahorro!A:W',
    flowLegacy:'Flujo_Ahorro!A:P',
    summary:'Resumen_Conceptos_Ingresos!A:L',
    detail:'Detalle_Ingresos!A:L',
    incomes:'Ingresos!A:T',
    investments:'Flujo_Inversiones!A:M',
    patrimonio:'Patrimonio_Inversiones!A:K',
    config:'Config!A:C'
  };
  const TARGET_KEY='panel:savings-target-percent';
  let frame=0,version=0,cache=null,charts=[];

  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  const activeCurrency=()=>document.querySelector('.currency-btn.active')?.dataset.currency||'COP';

  function num(value){
    if(typeof value==='number')return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0)s=c>d?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
    else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=4?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }
  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return[];
    const h=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));
  }
  function rowsFrom(payload,range){
    const cached=window.__PANEL_GET_CACHED_ROWS__;
    if(typeof cached==='function')return cached(payload,FINANCE_ID,range);
    return parseRows(payload?.sources?.[`${FINANCE_ID}|${range}`]||[]);
  }
  function monthKey(value){
    const s=norm(value);let m=s.match(/^(20\d{2})-(\d{1,2})/);if(m)return`${m[1]}-${String(+m[2]).padStart(2,'0')}`;
    const map={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[\s\-/]+(20\d{2})/);
    return m?`${m[2]}-${String(map[m[1]]).padStart(2,'0')}`:'';
  }
  const monthLabel=key=>{const names=['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];const [y,m]=String(key||'').split('-');return y&&m?`${names[+m-1]||m} ${y}`:key||'—';};
  function selected(key){return[...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||'')).filter(Boolean);}

  function rates(data){
    const cfgRows=data.config||[];
    const map=Object.fromEntries(cfgRows.map(r=>[norm(r.Parámetro),num(r.Valor)]));
    const usdCop=map['tasa actual usd/cop']||Number(cfg.regularIncome?.usdCopReference)||3150;
    const usdArs=map['tasa actual usd/ars']||Number(cfg.regularIncome?.usdArsReference)||1500;
    return{usdCop,usdArs};
  }
  function convertCop(v,cur,r){v=Number(v)||0;if(cur==='USD')return v/r.usdCop;if(cur==='ARS')return v/r.usdCop*r.usdArs;return v;}
  function nativeMoney(v,cur){const digits=cur==='USD'?2:0;return new Intl.NumberFormat('es-CO',{style:'currency',currency:cur,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(v)||0);}
  function money(v,cur,r){return nativeMoney(convertCop(v,cur,r),cur);}
  function pct(v){if(v===null||v===undefined||!Number.isFinite(Number(v)))return'—';return`${new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1}).format(Number(v)*100)}%`;}
  function shortNative(v){return new Intl.NumberFormat('es-CO',{notation:'compact',maximumFractionDigits:1}).format(Number(v)||0);}

  function targetDefault(data){
    const row=(data.config||[]).find(r=>norm(r.Parámetro)==='meta ahorro mensual %');
    const value=num(row?.Valor);return value>0&&value<1?value:.30;
  }
  function targetRate(data){
    const raw=localStorage.getItem(TARGET_KEY),stored=raw===null?NaN:Number(raw);
    return Number.isFinite(stored)&&stored>=0&&stored<=.9?stored:targetDefault(data);
  }
  function destroyCharts(){charts.forEach(c=>{try{c.destroy()}catch{}});charts=[];}

  async function load(force=false){
    if(cache&&!force)return cache;
    const get=window.__PANEL_GET_BACKEND_DATA__;if(typeof get!=='function')return null;
    const payload=await get(force);
    let flow=rowsFrom(payload,RANGES.flow);
    if(!flow.length)flow=rowsFrom(payload,RANGES.flowLegacy);
    if(!flow.length&&Array.isArray(window.__PANEL_APP_DATA__?.ahorro))flow=window.__PANEL_APP_DATA__.ahorro;
    cache={
      payload,flow,
      summary:rowsFrom(payload,RANGES.summary),
      detail:rowsFrom(payload,RANGES.detail),
      incomes:rowsFrom(payload,RANGES.incomes),
      investments:rowsFrom(payload,RANGES.investments),
      patrimonio:rowsFrom(payload,RANGES.patrimonio),
      config:rowsFrom(payload,RANGES.config)
    };
    return cache;
  }

  function adjustmentMaps(data,ratesNow){
    const nonLiquid=new Map(),fees=new Map();
    (data.detail||[]).forEach(row=>{
      const key=monthKey(row.Mes);if(!key)return;
      if(norm(row.Tipo)==='cesantias') nonLiquid.set(key,(nonLiquid.get(key)||0)+num(row['Equivalente COP']));
    });
    (data.incomes||[]).forEach(row=>{
      const key=monthKey(row['Fecha pago']||row['Fecha devengo']);if(!key)return;
      const deduction=num(row.Deducciones);if(!(deduction>0))return;
      const cur=norm(row.Moneda);
      let cop=deduction;
      if(cur==='usd')cop=deduction*ratesNow.usdCop;
      else if(cur==='ars')cop=deduction/ratesNow.usdArs*ratesNow.usdCop;
      fees.set(key,(fees.get(key)||0)+cop);
    });
    return{nonLiquid,fees};
  }

  function investmentMap(data,ratesNow){
    const direct=new Map();
    (data.investments||[]).forEach(row=>{
      const key=monthKey(row.Mes);if(!key)return;
      const value=num(row['Aportes netos COP']);
      if(value||String(row['Aportes netos COP']||'').trim())direct.set(key,value);
    });
    if(direct.size)return direct;

    const grouped=new Map();
    (data.patrimonio||[]).forEach(row=>{
      const key=monthKey(row.Periodo),entity=String(row.Entidad||'').trim();
      if(!key||!entity||!norm(row.Estado).includes('confirmado'))return;
      if(!grouped.has(entity))grouped.set(entity,[]);
      grouped.get(entity).push({key,row});
    });
    const result=new Map();
    grouped.forEach(list=>{
      list.sort((a,b)=>a.key.localeCompare(b.key));
      let previous=null;
      list.forEach(({key,row})=>{
        const capital=num(row['Capital sin ganancia']);
        if(previous!==null&&previous>0&&capital>0){
          const delta=capital-previous,base=norm(row['Moneda base']);
          let cop=delta;
          if(base==='usd')cop=delta*ratesNow.usdCop;
          else if(base==='ars')cop=delta/ratesNow.usdArs*ratesNow.usdCop;
          result.set(key,(result.get(key)||0)+cop);
        }
        if(capital>0)previous=capital;
      });
    });
    return result;
  }

  function normalized(data){
    const summaryMap=new Map((data.summary||[]).map(row=>[monthKey(row.Mes),row]).filter(x=>x[0]));
    const ratesNow=rates(data),adjust=adjustmentMaps(data,ratesNow),investments=investmentMap(data,ratesNow);
    const salaryHistory=[...summaryMap].map(([key,row])=>({key,value:num(row['Sueldo COP'])})).filter(x=>x.value>0).sort((a,b)=>a.key.localeCompare(b.key));
    const salaryReference=key=>{
      let value=0;
      salaryHistory.forEach(item=>{if(item.key<=key)value=item.value;});
      return value||salaryHistory.at(-1)?.value||0;
    };
    const llcReference=(Number(cfg.regularIncome?.fibrazoLlcUsdBase)||1300)*ratesNow.usdCop;
    const current=new Date(),currentKey=`${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}`;

    return (data.flow||[]).map(row=>{
      const key=monthKey(row.Mes);if(!key)return null;
      const s=summaryMap.get(key)||{};
      const salaryCop=num(s['Sueldo COP']),salaryUsd=num(s['Sueldo USD (equiv. COP)']);
      const total=num(s['Total consolidado'])||num(row['Ingresos totales consolidados COP'])||num(row['Ingresos reales COP']);
      const deduction=(adjust.nonLiquid.get(key)||0)+(adjust.fees.get(key)||0);
      const liquid=total>0?Math.max(0,total-deduction):0;
      const expenses=num(row['Egresos reales COP']);
      const saving=liquid-expenses;
      const regularComplete=salaryCop>0&&salaryUsd>0;
      const regular=regularComplete?salaryCop+salaryUsd:(salaryReference(key)+llcReference);
      const invested=investments.has(key)?investments.get(key):num(row['Aportes netos inversiones COP']);
      const post=saving-invested;
      let state=String(row.Estado||'');
      if(key>currentKey)state='Proyección';
      else if(key===currentKey)state='En curso';
      else if(!regularComplete)state='Pendiente soporte';
      else state='Cerrado';
      let quality=String(row['Estado ingreso / soporte']||'');
      if(key>currentKey)quality='Proyección';
      else if(total<=0)quality='Sin ingresos confirmados';
      else if(!regularComplete)quality='Parcial · falta ingreso regular';
      else if(deduction>0)quality='Ajustado · no líquido/comisiones';
      else quality='Consolidado';

      return{
        key,year:key.slice(0,4),month:+key.slice(5,7),state,quality,
        total,liquid,expenses,saving,regular,invested,post,
        salaryCop,salaryUsd,extras:Math.max(0,total-salaryCop-salaryUsd)
      };
    }).filter(Boolean).sort((a,b)=>a.key.localeCompare(b.key));
  }

  function viewState(rows){
    const ys=selected('year'),ms=selected('month').map(Number).filter(Boolean);
    const currentYear=String(new Date().getFullYear());
    const year=ys.length===1?ys[0]:(rows.some(r=>r.year===currentYear)?currentYear:(rows.at(-1)?.year||''));
    const yearRows=rows.filter(r=>!year||r.year===year);
    const focus=ms.length?yearRows.filter(r=>ms.includes(r.month)):yearRows.filter(r=>!norm(r.state).includes('proyecc')).slice(-1);
    return{year,months:ms,yearRows,focus:focus.length?focus:yearRows.slice(-1)};
  }

  function card(label,value,meta,tone=''){
    return`<div class="income-flow-card ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta||'')}</small></div>`;
  }
  function qualityBadge(row){
    const q=norm(row.quality||row.state);
    const cls=q.includes('consolid')?'good':q.includes('parcial')||q.includes('pendiente')?'warn':q.includes('proyecc')?'muted':'neutral';
    return`<span class="income-quality ${cls}">${esc(row.quality||row.state||'—')}</span>`;
  }
  function sum(rows,field){return rows.reduce((s,r)=>s+(Number(r[field])||0),0);}

  function render(data){
    if(activeView()!=='ingresos')return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const rows=normalized(data),state=viewState(rows),cur=activeCurrency(),r=rates(data),target=targetRate(data);
    const focus=state.focus.filter(x=>!norm(x.state).includes('proyecc'));
    const allActual=state.yearRows.filter(x=>!norm(x.state).includes('proyecc'));
    const total=sum(focus,'total'),liquid=sum(focus,'liquid'),expenses=sum(focus,'expenses'),saving=liquid-expenses,invested=sum(focus,'invested'),totalOut=expenses+invested,post=liquid-totalOut;
    const savingRate=liquid?saving/liquid:null,postRate=liquid?post/liquid:null;
    const targetAmount=focus.reduce((s,x)=>s+x.regular*target,0);
    const gap=saving-targetAmount;
    const closed=allActual.filter(x=>norm(x.state).includes('cerrado'));
    const met=closed.filter(x=>x.liquid>0&&x.saving>=x.regular*target).length;
    const focusLabel=state.months.length?state.focus.map(x=>monthLabel(x.key)).join(', '):`Último período con datos · ${monthLabel(state.focus.at(-1)?.key)}`;

    root.innerHTML=`<section class="income-savings-dashboard">
      <div class="section-head"><div><span class="eyebrow">FINANZAS</span><h2>Ingresos y ahorro</h2><p>Composición de ingresos, gastos, inversiones y cumplimiento de la meta de ahorro.</p></div><div class="income-focus-label">${esc(focusLabel)}</div></div>

      <div class="income-flow-grid">
        ${card('Ingresos totales',money(total,cur,r),'Incluye componentes líquidos y no líquidos','blue')}
        ${card('Ingresos líquidos',money(liquid,cur,r),'Base usada para flujo de caja','green')}
        ${card('Gastos',money(expenses,cur,r),'Consumos y gastos reales registrados')}
        ${card('Aportes netos a inversiones',money(invested,cur,r),'Capital colocado neto; sin valorización','gold')}
        ${card('Egresos totales',money(totalOut,cur,r),'Gastos + aportes netos a inversiones')}
        ${card('Ahorro antes de invertir',money(saving,cur,r),liquid?`Tasa ${pct(savingRate)}`:'Sin ingreso confirmado',saving>=0?'green':'bad')}
        ${card('Saldo después de invertir',money(post,cur,r),liquid?`${pct(postRate)} del ingreso líquido`:'Sin ingreso confirmado',post>=0?'blue':'bad')}
      </div>

      <div class="income-target-panel">
        <div class="income-target-copy"><span>META DE AHORRO</span><strong>${pct(target)} mensual</strong><small>La meta se calcula sobre el ingreso regular base. El ahorro real usa ingresos líquidos menos gastos.</small></div>
        <label class="income-target-control"><span>Objetivo</span><div><input id="savingsTargetInput" type="number" min="0" max="90" step="1" value="${Math.round(target*100)}"><b>%</b></div><small>Editable; se guarda en este navegador.</small></label>
        <div class="income-target-stats">
          ${card('Meta del período',money(targetAmount,cur,r),`Base regular × ${pct(target)}`)}
          ${card('Brecha vs meta',money(gap,cur,r),gap>=0?'Meta superada':'Falta para llegar a la meta',gap>=0?'green':'bad')}
          ${card('Meses que cumplen',`${met}/${closed.length}`,'Solo meses cerrados del año',met===closed.length&&closed.length?'green':'')}
        </div>
      </div>

      <div class="income-chart-grid">
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Composición mensual de ingresos</strong><span>Nómina COP, Fibrazo LLC y extras / otros</span></div></div><div class="income-chart-box"><canvas id="incomeCompositionChart"></canvas></div></div>
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Flujo antes y después de inversiones</strong><span>Ingreso líquido, gastos, ahorro generado y aportes netos</span></div></div><div class="income-chart-box"><canvas id="incomeCashflowChart"></canvas></div></div>
      </div>
      <div class="panel income-target-chart-panel"><div class="panel-header"><div class="panel-title"><strong>Meta de ahorro mes a mes</strong><span>Tasa real sobre ingreso líquido vs objetivo configurable</span></div></div><div class="income-chart-box target"><canvas id="incomeTargetChart"></canvas></div></div>

      <div class="panel table-panel income-monthly-panel">
        <div class="panel-header"><div class="panel-title"><strong>Consolidado mensual · ${esc(state.year)}</strong><span>Los documentos de soporte se consultan desde la sección Documentos.</span></div></div>
        <div class="table-scroll expanded"><table class="income-monthly-table"><thead><tr><th>Mes</th><th>Estado</th><th class="num">Ingreso total</th><th class="num">Ingreso líquido</th><th class="num">Gastos</th><th class="num">Ahorro pre inversión</th><th class="num">% ahorro</th><th class="num">Meta</th><th class="num">Brecha</th><th class="num">Inversiones</th><th class="num">Egresos totales</th><th class="num">Post inversión</th><th class="num">% post inv.</th><th>Calidad</th></tr></thead><tbody>
          ${state.yearRows.map(x=>{const targetMonth=x.regular*target,g=x.saving-targetMonth,rate=x.liquid?x.saving/x.liquid:null;return`<tr class="${norm(x.state).includes('proyecc')?'projection':''}"><td><strong>${esc(monthLabel(x.key))}</strong></td><td>${esc(x.state)}</td><td class="num">${esc(money(x.total,cur,r))}</td><td class="num">${esc(money(x.liquid,cur,r))}</td><td class="num">${esc(money(x.expenses,cur,r))}</td><td class="num ${x.saving>=0?'positive':'negative'}">${esc(money(x.saving,cur,r))}</td><td class="num ${rate!=null&&rate>=target?'positive':rate!=null?'negative':''}">${rate==null?'—':esc(pct(rate))}</td><td class="num">${esc(money(targetMonth,cur,r))} · ${esc(pct(target))}</td><td class="num ${g>=0?'positive':'negative'}">${esc(money(g,cur,r))}</td><td class="num">${esc(money(x.invested,cur,r))}</td><td class="num">${esc(money(x.expenses+x.invested,cur,r))}</td><td class="num ${x.post>=0?'positive':'negative'}">${esc(money(x.post,cur,r))}</td><td class="num ${x.post>=0?'positive':'negative'}">${x.liquid?esc(pct(x.post/x.liquid)):'—'}</td><td>${qualityBadge(x)}</td></tr>`;}).join('')}
        </tbody></table></div>
      </div>
      <div class="income-method-note"><strong>Criterio consolidado:</strong> ingreso total = todos los conceptos registrados; ingreso líquido excluye cesantías no líquidas y descuenta comisiones bancarias USD registradas. Ahorro = ingreso líquido − gastos. Inversiones = cambio neto del capital base de ARQ/Cocos, sin mezclar valorización. Saldo post inversión = ahorro − aportes netos.</div>
    </section>`;

    root.querySelector('#savingsTargetInput')?.addEventListener('change',e=>{
      const n=Math.max(0,Math.min(90,Number(e.target.value)||0))/100;
      localStorage.setItem(TARGET_KEY,String(n));render(data);
    });
    requestAnimationFrame(()=>drawCharts(state.yearRows,target,cur,r));
  }

  function drawCharts(rows,target,cur,r){
    destroyCharts();if(!window.Chart||activeView()!=='ingresos')return;
    const labels=rows.map(x=>monthLabel(x.key));
    const common={responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#8fa0b6',boxWidth:9,usePointStyle:true}},tooltip:{callbacks:{label:ctx=>ctx.dataset.yAxisID==='pct'?`${ctx.dataset.label}: ${pct(ctx.parsed.y)}`:`${ctx.dataset.label}: ${nativeMoney(ctx.parsed.y,cur)}`}}}};
    const axis={ticks:{color:'#718098',callback:v=>shortNative(v)},grid:{color:'#121c29'}};

    const c1=document.getElementById('incomeCompositionChart');
    if(c1)charts.push(new Chart(c1,{type:'bar',data:{labels,datasets:[
      {label:'Nómina COP',data:rows.map(x=>convertCop(x.salaryCop,cur,r)),stack:'income'},
      {label:'Fibrazo LLC',data:rows.map(x=>convertCop(x.salaryUsd,cur,r)),stack:'income'},
      {label:'Extras / otros',data:rows.map(x=>convertCop(x.extras,cur,r)),stack:'income'}
    ]},options:{...common,scales:{x:{stacked:true,ticks:{color:'#718098'},grid:{display:false}},y:{...axis,stacked:true}}}}));

    const c2=document.getElementById('incomeCashflowChart');
    if(c2)charts.push(new Chart(c2,{data:{labels,datasets:[
      {type:'bar',label:'Ingreso líquido',data:rows.map(x=>convertCop(x.liquid,cur,r))},
      {type:'bar',label:'Gastos',data:rows.map(x=>convertCop(x.expenses,cur,r))},
      {type:'bar',label:'Aportes inversiones',data:rows.map(x=>convertCop(x.invested,cur,r))},
      {type:'line',label:'Ahorro pre inversión',data:rows.map(x=>convertCop(x.saving,cur,r)),borderWidth:2,tension:.25},
      {type:'line',label:'Saldo post inversión',data:rows.map(x=>convertCop(x.post,cur,r)),borderWidth:2,tension:.25}
    ]},options:{...common,scales:{x:{ticks:{color:'#718098'},grid:{display:false}},y:axis}}}));

    const c3=document.getElementById('incomeTargetChart');
    if(c3)charts.push(new Chart(c3,{data:{labels,datasets:[
      {type:'bar',label:'Tasa de ahorro',data:rows.map(x=>x.liquid?x.saving/x.liquid:null),yAxisID:'pct'},
      {type:'line',label:'Meta',data:rows.map(()=>target),yAxisID:'pct',borderWidth:2,tension:0,pointRadius:0}
    ]},options:{...common,scales:{x:{ticks:{color:'#718098'},grid:{display:false}},pct:{ticks:{color:'#718098',callback:v=>pct(v)},grid:{color:'#121c29'}}}}}));
  }

  function style(){
    if(document.getElementById('incomeSavingsDashboardStyles'))return;
    const s=document.createElement('style');s.id='incomeSavingsDashboardStyles';s.textContent=`
      .income-savings-dashboard{display:grid;gap:12px}.income-focus-label{align-self:end;color:#7890ae;font-size:10px}.income-flow-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.income-flow-card{border:1px solid var(--border-soft);background:linear-gradient(180deg,#0d1623,#0a111b);border-radius:12px;padding:11px;min-width:0}.income-flow-card>span{display:block;color:#6e83a0;font-size:8px;text-transform:uppercase;letter-spacing:.055em;font-weight:800}.income-flow-card>strong{display:block;margin-top:5px;color:#f0f5fc;font-size:18px;line-height:1.05}.income-flow-card>small{display:block;margin-top:5px;color:#718098;font-size:9px;line-height:1.35}.income-flow-card.green>strong{color:#6ce3a7}.income-flow-card.blue>strong{color:#67a6ff}.income-flow-card.gold>strong{color:#ffd15a}.income-flow-card.bad>strong{color:#ff7d8a}.income-target-panel{display:grid;grid-template-columns:minmax(220px,.85fr) 180px minmax(0,2fr);gap:10px;align-items:stretch;border:1px solid var(--border-soft);background:#09111b;border-radius:13px;padding:11px}.income-target-copy{padding:4px 6px}.income-target-copy>span{font-size:8px;font-weight:800;color:#5f9cff;letter-spacing:.07em}.income-target-copy>strong{display:block;margin-top:5px;font-size:20px;color:#eef5ff}.income-target-copy>small{display:block;margin-top:5px;font-size:9px;line-height:1.4;color:#718098}.income-target-control{border:1px solid var(--border-soft);border-radius:10px;padding:8px 10px;background:rgba(255,255,255,.02)}.income-target-control>span{display:block;font-size:8px;color:#6d819c;text-transform:uppercase;font-weight:800}.income-target-control>div{display:flex;align-items:center;gap:5px;margin-top:5px}.income-target-control input{width:70px;background:#0b1420;border:1px solid #26374c;color:#eef5ff;border-radius:8px;padding:6px 8px;font:700 14px Inter}.income-target-control b{font-size:13px;color:#8fa1b8}.income-target-control small{display:block;margin-top:5px;font-size:8px;color:#677b94}.income-target-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.income-target-stats .income-flow-card{padding:9px}.income-target-stats .income-flow-card>strong{font-size:14px}.income-chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.income-chart-box{height:270px;padding:4px 8px 8px}.income-chart-box.target{height:230px}.income-monthly-table th,.income-monthly-table td{white-space:nowrap}.income-monthly-table td.num,.income-monthly-table th.num{text-align:right}.income-monthly-table tr.projection{opacity:.58}.income-quality{display:inline-flex;border:1px solid var(--border);border-radius:99px;padding:4px 7px;font-size:8px;font-weight:700;color:#94a5ba}.income-quality.good{color:#73dfaa;border-color:rgba(38,208,124,.22);background:rgba(38,208,124,.05)}.income-quality.warn{color:#ffcb68;border-color:rgba(246,200,68,.22);background:rgba(246,200,68,.05)}.income-quality.muted{color:#66788e}.income-method-note{border:1px solid var(--border-soft);background:#081019;border-radius:10px;padding:9px 11px;color:#73859b;font-size:9px;line-height:1.45}.income-method-note strong{color:#b6c7dc}.income-monthly-table .positive{color:#6ce3a7}.income-monthly-table .negative{color:#ff8390}@media(max-width:1300px){.income-flow-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.income-target-panel{grid-template-columns:1fr 170px}.income-target-stats{grid-column:1/-1}}@media(max-width:900px){.income-chart-grid{grid-template-columns:1fr}.income-flow-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){.income-flow-grid{grid-template-columns:1fr}.income-target-panel{grid-template-columns:1fr}.income-target-stats{grid-template-columns:1fr}.income-focus-label{display:none}}`;
    document.head.appendChild(s);
  }

  async function run(force=false){
    if(activeView()!=='ingresos')return;
    const v=++version;
    try{const data=await load(force);if(!data||v!==version||activeView()!=='ingresos')return;render(data);}catch(e){console.error('Ingresos y ahorro consolidado:',e);}
  }
  function schedule(force=false){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;run(force);});}

  style();
  document.addEventListener('panel:view-root-changed',e=>{if(e.detail?.view==='ingresos')schedule(false);});
  document.addEventListener('panel:filters-updated',()=>{if(activeView()==='ingresos')schedule(false);});
  document.addEventListener('panel:backend-refresh-requested',()=>{cache=null;if(activeView()==='ingresos')schedule(true);});
  document.addEventListener('panel:app-data-ready',()=>{cache=null;if(activeView()==='ingresos')schedule(false);});
  document.addEventListener('click',e=>{if(e.target.closest('.currency-btn')&&activeView()==='ingresos')setTimeout(()=>schedule(false),0);});
  queueMicrotask(()=>schedule(false));
})();