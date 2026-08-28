(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const FINANCE_ID=String(cfg.financeSpreadsheetId||'');
  if(!FINANCE_ID)return;

  const COLORS=['#1769ff','#f6c844','#26d07c','#ff667a','#ffad42','#7a8ba5','#8b5cf6','#22d3ee','#f472b6','#a3e635'];
  const MONTH_LABELS=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  let renderFrame=0,loadVersion=0,chartMode='cumulative',rawRows=[],lastPayload=null;

  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  const activeCurrency=()=>document.querySelector('.currency-btn.active')?.dataset.currency||'COP';
  const selectedGlobal=key=>[...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(x=>String(x.dataset.value||'').trim()).filter(Boolean);

  function parseNumber(value){if(typeof value==='number')return Number.isFinite(value)?value:0;let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}
  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const headers=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(row=>row?.some(v=>String(v??'').trim()!=='')).map(row=>Object.fromEntries(headers.map((key,i)=>[key||`Col ${i+1}`,row?.[i]??''])));}
  function parseDate(value){const s=String(value||'').trim();let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);return m?new Date(+m[3],+m[2]-1,+m[1]):null;}
  function account(row){const raw=String(row['Cuenta / Tarjeta']||'').trim(),n=norm(raw),holder=norm(row.Titular);if(n.includes('efectivo'))return'Efectivo';if(n.includes('nequi'))return holder.includes('ro')?'Nequi Ro':'Nequi Edu';if(n.includes('arq'))return'ARQ Edu';if(n.includes('nu')){if(n.includes(' ro')||n.endsWith('ro')||holder==='ro'||holder.includes('rocio'))return'Nu Ro';if(n.includes('edu')||holder.includes('edu'))return'Nu Edu';return'Nu';}return raw||'Sin especificar';}
  function method(row){const explicit=String(row['Modalidad de pago']||'').trim();if(explicit)return explicit;const raw=norm(row['Cuenta / Tarjeta']);if(raw.includes('credito'))return'Crédito';if(raw.includes('transferencia'))return'Transferencia';if(raw.includes('debito'))return'Débito';if(raw.includes('efectivo'))return'Efectivo';if(parseNumber(row.Cuotas)>0&&(raw.includes('nu')||raw.includes('arq')))return'Crédito';return'Sin especificar';}

  function filterContext(){
    const payment=window.__PAYMENT_FILTER_STATE__?.view==='gastos'?window.__PAYMENT_FILTER_STATE__:{account:[],method:[]};
    return{
      years:new Set(selectedGlobal('year')),
      months:new Set(selectedGlobal('month')),
      categories:new Set(selectedGlobal('category')),
      subcategories:new Set(selectedGlobal('subcategory')),
      accounts:new Set(payment.account||[]),
      methods:new Set(payment.method||[])
    };
  }

  function matches(row,ctx){
    if(!(window.MovementStatusCore?.isActual(row.Estado)??!/proyecc|proyect|programad/.test(norm(row.Estado))))return false;
    const d=parseDate(row['Fecha real']||row['Fecha registrada']);
    if(ctx.years.size&&(!d||!ctx.years.has(String(d.getFullYear()))))return false;
    if(ctx.months.size&&(!d||!ctx.months.has(String(d.getMonth()+1))))return false;
    if(ctx.categories.size&&!ctx.categories.has(String(row['Categoría']||'')))return false;
    if(ctx.subcategories.size&&!ctx.subcategories.has(String(row['Subcategoría']||'')))return false;
    if(ctx.accounts.size&&!ctx.accounts.has(account(row)))return false;
    if(ctx.methods.size&&!ctx.methods.has(method(row)))return false;
    const type=norm(row.Tipo||row.Naturaleza||'gasto');
    return type.includes('gasto')||norm(row.Naturaleza).includes('egreso')||!String(row.Tipo||'').trim();
  }

  function amount(row,currency){if(currency==='USD')return parseNumber(row['Monto USD']);if(currency==='ARS')return parseNumber(row['Monto ARS']);return parseNumber(row['Monto COP']);}
  function formatMoney(value,currency){return new Intl.NumberFormat('es-CO',{style:'currency',currency,maximumFractionDigits:currency==='USD'?2:0}).format(Number(value)||0);}

  function injectStyles(){
    if(document.getElementById('spendChartModeStyles'))return;
    const style=document.createElement('style');style.id='spendChartModeStyles';style.textContent=`
      .spend-chart-mode{display:flex;align-items:center;gap:5px;margin-left:auto;padding:3px;border:1px solid #263548;border-radius:9px;background:#0b131e}
      .spend-chart-mode button{border:0;background:transparent;color:#8393a8;border-radius:6px;padding:6px 9px;font-size:10px;font-weight:700;cursor:pointer}
      .spend-chart-mode button.active{background:#17345f;color:#dbeaff}
      .spend-chart-mode[hidden]{display:none!important}
    `;document.head.appendChild(style);
  }

  function ensureModeControl(canvas,singleMonth){
    const panel=canvas.closest('.panel'),header=panel?.querySelector('.panel-header');
    if(!panel||!header)return;
    let control=header.querySelector('[data-spend-chart-mode]');
    if(!control){
      control=document.createElement('div');control.className='spend-chart-mode';control.dataset.spendChartMode='true';
      control.innerHTML='<button type="button" data-spend-mode="cumulative">Acumulado</button><button type="button" data-spend-mode="daily">Por día</button>';
      control.addEventListener('click',event=>{const btn=event.target.closest('[data-spend-mode]');if(!btn)return;const next=String(btn.dataset.spendMode||'cumulative');if(next===chartMode)return;chartMode=next;renderCurrent();});
      header.appendChild(control);
    }
    control.hidden=!singleMonth;
    control.querySelectorAll('[data-spend-mode]').forEach(btn=>btn.classList.toggle('active',btn.dataset.spendMode===chartMode));
    const subtitle=panel.querySelector('.panel-title span');
    if(subtitle)subtitle.textContent=singleMonth?(chartMode==='daily'?'Gasto realizado en cada día':'Acumulado de gasto real día a día'):'Total real por período seleccionado';
  }

  function chartOptions(currency){return{responsive:true,maintainAspectRatio:false,interaction:{mode:'nearest',intersect:false},plugins:{legend:{display:true,labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${formatMoney(ctx.parsed.y,currency)}`}}},scales:{x:{ticks:{color:'#718098',maxRotation:0,autoSkip:true},grid:{color:'#121c29'}},y:{beginAtZero:true,ticks:{color:'#718098'},grid:{color:'#121c29'}}}};}

  function drawChart(canvas,type,labels,dataset,currency){
    const existing=Chart.getChart(canvas);
    if(existing&&existing.config.type===type){
      existing.data.labels=labels;
      existing.data.datasets=[dataset];
      existing.options.plugins.tooltip.callbacks.label=ctx=>`${ctx.dataset.label}: ${formatMoney(ctx.parsed.y,currency)}`;
      existing.update('none');
      return;
    }
    existing?.destroy();
    new Chart(canvas,{type,data:{labels,datasets:[dataset]},options:chartOptions(currency)});
  }

  function redraw(rows){
    if(activeView()!=='gastos'||!window.Chart)return;
    const canvas=document.getElementById('spendChart');if(!canvas)return;
    const currency=activeCurrency(),years=selectedGlobal('year'),months=selectedGlobal('month');
    const singleMonth=years.length===1&&months.length===1;
    ensureModeControl(canvas,singleMonth);

    let labels=[],values=[],type='line',seriesLabel='Total seleccionado';
    if(singleMonth){
      const year=Number(years[0]),monthIndex=Number(months[0])-1,now=new Date();
      const endDay=year===now.getFullYear()&&monthIndex===now.getMonth()?now.getDate():new Date(year,monthIndex+1,0).getDate();
      const daily=new Map();
      rows.forEach(row=>{const d=parseDate(row['Fecha real']||row['Fecha registrada']);if(!d||d.getFullYear()!==year||d.getMonth()!==monthIndex)return;daily.set(d.getDate(),(daily.get(d.getDate())||0)+amount(row,currency));});
      let running=0;
      for(let day=1;day<=endDay;day++){
        const dayValue=daily.get(day)||0;running+=dayValue;
        labels.push(`${String(day).padStart(2,'0')}/${String(monthIndex+1).padStart(2,'0')}`);
        values.push(chartMode==='daily'?dayValue:running);
      }
      if(chartMode==='daily'){type='bar';seriesLabel='Gasto del día';}
      else seriesLabel='Gasto acumulado';
    }else{
      const totals=new Map();
      rows.forEach(row=>{const d=parseDate(row['Fecha real']||row['Fecha registrada']);if(!d)return;const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;totals.set(key,(totals.get(key)||0)+amount(row,currency));});
      const periods=[...totals.keys()].sort();
      labels=periods.map(period=>{const[year,month]=period.split('-').map(Number);return`${MONTH_LABELS[month-1]} ${year}`;});
      values=periods.map(period=>totals.get(period)||0);seriesLabel='Total del período';
    }

    const dataset={label:seriesLabel,data:values,borderColor:COLORS[0],backgroundColor:COLORS[0],borderWidth:2,tension:type==='line'?.22:0,pointRadius:type==='line'?2:0,pointHoverRadius:type==='line'?5:0,spanGaps:true,borderRadius:type==='bar'?4:0};
    drawChart(canvas,type,labels,dataset,currency);
  }

  function renderCurrent(){if(!lastPayload||activeView()!=='gastos')return;const ctx=filterContext();redraw(rawRows.filter(row=>matches(row,ctx)));}

  async function load(){
    if(activeView()!=='gastos')return;
    const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')return;
    const version=++loadVersion;
    const data=await getData(false);
    if(version!==loadVersion||activeView()!=='gastos')return;
    if(data!==lastPayload){lastPayload=data;rawRows=parseRows(data?.sources?.[`${FINANCE_ID}|Movimientos!A:Z`]||[]);}
    renderCurrent();
  }

  function schedule(){
    if(renderFrame)return;
    renderFrame=requestAnimationFrame(()=>{renderFrame=0;load().catch(console.error);});
  }

  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{if(event.detail?.view==='gastos')schedule();else loadVersion++;});
  document.addEventListener('panel:payment-filters-changed',event=>{if(event.detail?.view==='gastos')schedule();});
  document.addEventListener('panel:filters-updated',()=>{if(activeView()==='gastos')schedule();});
  queueMicrotask(schedule);
})();
