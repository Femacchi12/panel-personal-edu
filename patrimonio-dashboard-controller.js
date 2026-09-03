(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const financeId=String(cfg.financeSpreadsheetId||'');
  const MONTHLY_RANGE='Patrimonio_Mensual!A:X';
  const DETAIL_RANGE='Patrimonio_Detalle!A:N';
  const INVESTMENT_RANGE='Patrimonio_Inversiones!A:U';
  let active=false;
  let payload=null;
  let data={monthly:[],detail:[],investments:[]};
  let charts=[];
  let currency='COP';
  let loadToken=0;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const num=value=>{
    if(typeof value==='number')return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');
    if(!s)return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0){if(comma>dot)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
    else if(comma>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(dot>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  };

  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return[];
    const header=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(row=>row?.some(v=>String(v??'').trim()!=='')).map(row=>Object.fromEntries(header.map((name,index)=>[name||`Col ${index+1}`,row?.[index]??''])));
  }
  async function sourceRows(range){
    const getter=window.__PANEL_GET_SOURCE_VALUES__;
    if(typeof getter==='function'){
      try{return parseRows(await getter(financeId,range,false));}catch(error){console.warn(`Patrimonio: ${range} no disponible`,error);return[];}
    }
    return[];
  }
  async function load(){
    const token=++loadToken;
    const getBackend=window.__PANEL_GET_BACKEND_DATA__;
    if(typeof getBackend==='function'){
      try{payload=await getBackend(false);}catch(error){console.warn('Patrimonio: backend no disponible',error);}
    }
    const [monthly,detail,investments]=await Promise.all([sourceRows(MONTHLY_RANGE),sourceRows(DETAIL_RANGE),sourceRows(INVESTMENT_RANGE)]);
    if(token!==loadToken)return;
    data={monthly,detail,investments};
    if(active)render();
  }

  function monthKey(row){return String(row?.Mes||row?.Periodo||'').trim();}
  function money(value,cur=currency){
    const n=num(value),digits=cur==='USD'?2:0;
    return new Intl.NumberFormat('es-CO',{style:'currency',currency:cur,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n);
  }
  function signedMoney(value,cur=currency){const n=num(value);return `${n>0?'+':''}${money(n,cur)}`;}
  function valueFor(row,prefix,cur=currency){return row?.[`${prefix} ${cur}`];}
  function currentCurrency(){return document.querySelector('.currency-btn.active')?.dataset.currency||currency||'COP';}
  function destroyCharts(){charts.forEach(chart=>{try{chart.destroy();}catch{}});charts=[];}
  function latestMonthly(){return data.monthly.slice().sort((a,b)=>monthKey(a).localeCompare(monthKey(b))).at(-1)||{};}

  function kpi(label,value,caption,tone=''){
    return `<div class="kpi-card patrimonio-kpi ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(caption)}</small></div>`;
  }
  function sectionTitle(kicker,title,copy=''){
    return `<div class="section-heading patrimonio-heading"><div><span class="eyebrow">${esc(kicker)}</span><h2>${esc(title)}</h2>${copy?`<p>${esc(copy)}</p>`:''}</div></div>`;
  }
  function badge(text,kind='neutral'){return `<span class="patrimonio-badge ${kind}">${esc(text)}</span>`;}

  function render(){
    if(!active)return;
    currency=currentCurrency();
    const root=document.getElementById('viewRoot');if(!root)return;
    destroyCharts();
    if(!data.monthly.length){
      root.innerHTML=`${sectionTitle('FINANZAS','Patrimonio','Foto mensual independiente de cuentas, efectivo, deudas e inversiones')}<div class="panel"><div class="empty-state"><strong>Cargando patrimonio…</strong><span>La primera carga puede tardar unos segundos después de publicar las nuevas fuentes.</span></div></div>`;
      return;
    }
    const monthly=data.monthly.slice().sort((a,b)=>monthKey(a).localeCompare(monthKey(b)));
    const latest=monthly.at(-1)||{};
    const latestMonth=monthKey(latest);
    const manual=valueFor(latest,'Patrimonio manual');
    const without=valueFor(latest,'Patrimonio sin ganancia');
    const gain=valueFor(latest,'Ganancia inversiones');
    const withGain=valueFor(latest,'Patrimonio con ganancias');
    const hasAdjusted=String(without??'').trim()!==''&&String(withGain??'').trim()!=='';
    const detailRows=data.detail.filter(row=>monthKey(row)===latestMonth);
    const confirmed=data.investments.filter(row=>norm(row.Estado).includes('confirmado')).sort((a,b)=>String(a['Fecha corte']||'').localeCompare(String(b['Fecha corte']||'')));
    const status=latest['Estado inversión']||'Sin ajuste de inversión';

    root.innerHTML=`
      ${sectionTitle('FINANZAS','Patrimonio','Foto mensual neta · cuentas, efectivo, deudas e inversiones, sin relación con gastos o ingresos del resto del dashboard')}
      <div class="patrimonio-status-row">${badge('Datos duros independientes','good')}${badge(`Último corte ${latest['Fecha corte']||latestMonth}`)}${badge(status,hasAdjusted?'good':'pending')}</div>
      <div class="kpi-grid patrimonio-kpis">
        ${kpi('Patrimonio manual',money(manual),'Foto original consolidada del corte')}
        ${kpi('Sin ganancias',hasAdjusted?money(without):'—','Capital ajustado a extractos disponibles','blue')}
        ${kpi('Ganancia inversiones',hasAdjusted?signedMoney(gain):'—','Resultado ARQ + Cocos confirmado','gold')}
        ${kpi('Con ganancias',hasAdjusted?money(withGain):'—','Capital + ganancia/pérdida confirmada','green')}
      </div>
      <div class="patrimonio-currency-strip">
        <div><span>Saldo neto COP</span><strong>${money(latest['Saldo neto COP'],'COP')}</strong></div>
        <div><span>Saldo neto ARS</span><strong>${money(latest['Saldo neto ARS'],'ARS')}</strong></div>
        <div><span>Saldo neto USD</span><strong>${money(latest['Saldo neto USD'],'USD')}</strong></div>
      </div>
      <div class="panel-grid equal patrimonio-chart-grid">
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Evolución patrimonial</strong><span>Foto mensual en ${esc(currency)} · histórico manual y ajustes confirmados</span></div></div><div class="patrimonio-chart"><canvas id="patrimonioHistoryChart"></canvas></div></div>
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Composición del último corte</strong><span>Principales cuentas, efectivo, inversiones y deudas · ${esc(currency)}</span></div></div><div class="patrimonio-chart"><canvas id="patrimonioCompositionChart"></canvas></div></div>
      </div>
      <div class="panel patrimonio-investment-panel">
        <div class="panel-header"><div class="panel-title"><strong>Inversiones conciliadas</strong><span>Capital, ganancia/pérdida y valor actual tomados únicamente de registros duros de Patrimonio</span></div></div>
        ${confirmed.length?`<div class="patrimonio-investment-cards">${confirmed.map(investmentCard).join('')}</div>`:'<div class="empty-state"><strong>Sin inversiones conciliadas</strong><span>Se mostrarán cuando exista capital y valor de mercado respaldados.</span></div>'}
      </div>
      <div class="panel table-panel patrimonio-table-panel">
        <div class="panel-header"><div class="panel-title"><strong>Detalle del último corte</strong><span>${esc(latestMonth)} · ${detailRows.length?`${detailRows.length} posiciones cargadas`:'detalle pendiente de migrar'}</span></div></div>
        ${detailRows.length?detailTable(detailRows):'<div class="empty-state"><strong>Sin detalle para este corte</strong><span>El histórico mensual se conserva igualmente en Patrimonio_Mensual.</span></div>'}
      </div>
      <div class="panel table-panel patrimonio-table-panel">
        <div class="panel-header"><div class="panel-title"><strong>Histórico mensual</strong><span>Los cortes originales no se recalculan retroactivamente</span></div></div>
        ${monthlyTable(monthly)}
      </div>`;
    requestAnimationFrame(()=>drawCharts(monthly,detailRows));
  }

  function investmentCard(row){
    const cur=String(row['Moneda base']||'').trim()||'USD';
    const cap=String(row['Capital aportado']??'').trim();
    const market=String(row['Valor mercado']??'').trim();
    const gain=String(row['Ganancia / pérdida']??'').trim();
    return `<article class="patrimonio-investment-card"><div class="patrimonio-investment-head"><div><span>${esc(row.Entidad||'Inversión')}</span><strong>${esc(row['Fecha corte']||row.Periodo||'')}</strong></div>${badge(row.Estado||'','good')}</div><div class="patrimonio-investment-values"><div><span>Capital</span><strong>${cap?money(cap,cur):'—'}</strong></div><div><span>Ganancia / pérdida</span><strong class="${num(gain)>=0?'positive':'negative'}">${gain?signedMoney(gain,cur):'—'}</strong></div><div><span>Valor actual</span><strong>${market?money(market,cur):'—'}</strong></div></div></article>`;
  }

  function detailTable(rows){
    const sorted=rows.slice().sort((a,b)=>Math.abs(num(valueFor(b,'Valor')))-Math.abs(num(valueFor(a,'Valor'))));
    return `<div class="table-scroll patrimonio-table-scroll"><table class="data-table patrimonio-table"><thead><tr><th>Tipo</th><th>Cuenta / billetera</th><th>Grupo</th><th>Moneda ref.</th><th class="num">Valor ${esc(currency)}</th></tr></thead><tbody>${sorted.map(row=>`<tr><td>${badge(row.Tipo||'',norm(row.Tipo)==='deuda'?'negative':'neutral')}</td><td>${esc(row['Cuenta / billetera']||'')}</td><td>${esc(row.Grupo||'')}</td><td>${esc(row['Moneda referencia']||'')}</td><td class="num ${num(valueFor(row,'Valor'))<0?'negative':'positive'}">${money(valueFor(row,'Valor'))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function monthlyTable(rows){
    return `<div class="table-scroll patrimonio-table-scroll"><table class="data-table patrimonio-table"><thead><tr><th>Mes</th><th class="num">Manual ${esc(currency)}</th><th class="num">Variación</th><th class="num">Sin ganancias</th><th class="num">Ganancia inversiones</th><th class="num">Con ganancias</th><th>Estado</th></tr></thead><tbody>${rows.slice().reverse().map(row=>{const adjusted=String(valueFor(row,'Patrimonio sin ganancia')??'').trim()!=='';return `<tr><td>${esc(monthKey(row))}</td><td class="num">${money(valueFor(row,'Patrimonio manual'))}</td><td class="num ${num(valueFor(row,'Var patrimonio'))>=0?'positive':'negative'}">${signedMoney(valueFor(row,'Var patrimonio'))}</td><td class="num">${adjusted?money(valueFor(row,'Patrimonio sin ganancia')):'—'}</td><td class="num">${adjusted?signedMoney(valueFor(row,'Ganancia inversiones')):'—'}</td><td class="num">${adjusted?money(valueFor(row,'Patrimonio con ganancias')):'—'}</td><td>${badge(row['Estado inversión']||'',adjusted?'good':'pending')}</td></tr>`;}).join('')}</tbody></table></div>`;
  }

  function drawCharts(monthly,detailRows){
    if(!active||typeof Chart==='undefined')return;
    const history=document.getElementById('patrimonioHistoryChart');
    if(history){
      const labels=monthly.map(row=>monthKey(row));
      const manual=monthly.map(row=>num(valueFor(row,'Patrimonio manual')));
      const without=monthly.map(row=>String(valueFor(row,'Patrimonio sin ganancia')??'').trim()===''?null:num(valueFor(row,'Patrimonio sin ganancia')));
      const withGain=monthly.map(row=>String(valueFor(row,'Patrimonio con ganancias')??'').trim()===''?null:num(valueFor(row,'Patrimonio con ganancias')));
      charts.push(new Chart(history,{type:'line',data:{labels,datasets:[{label:'Patrimonio manual',data:manual,borderColor:'#73b9ff',backgroundColor:'rgba(115,185,255,.08)',pointRadius:2,tension:.25},{label:'Sin ganancias confirmado',data:without,borderColor:'#f5d547',backgroundColor:'rgba(245,213,71,.08)',pointRadius:4,spanGaps:false},{label:'Con ganancias confirmado',data:withGain,borderColor:'#00f29a',backgroundColor:'rgba(0,242,154,.08)',pointRadius:4,spanGaps:false}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true}},scales:{y:{ticks:{callback:value=>compactMoney(value,currency)}}}}}));
    }
    const composition=document.getElementById('patrimonioCompositionChart');
    if(composition&&detailRows.length){
      const top=detailRows.filter(row=>Math.abs(num(valueFor(row,'Valor')))>0).sort((a,b)=>Math.abs(num(valueFor(b,'Valor')))-Math.abs(num(valueFor(a,'Valor')))).slice(0,10);
      charts.push(new Chart(composition,{type:'bar',data:{labels:top.map(row=>row['Cuenta / billetera']||''),datasets:[{label:`Valor ${currency}`,data:top.map(row=>num(valueFor(row,'Valor'))),backgroundColor:top.map(row=>num(valueFor(row,'Valor'))<0?'rgba(255,117,133,.7)':'rgba(0,242,154,.65)',borderRadius:6}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{callback:value=>compactMoney(value,currency)}}}}}));
    }
  }
  function compactMoney(value,cur){
    const n=Number(value)||0,abs=Math.abs(n);let scale=1,suffix='';
    if(abs>=1e6){scale=1e6;suffix='M';}else if(abs>=1e3){scale=1e3;suffix='K';}
    const digits=scale===1?0:1;
    return `${cur} ${(n/scale).toLocaleString('es-CO',{maximumFractionDigits:digits})}${suffix}`;
  }

  function activate(event){
    const button=event.target.closest('.nav-item[data-view="patrimonio"]');if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    active=true;currency=currentCurrency();
    document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item===button));
    const eyebrow=document.getElementById('viewEyebrow'),title=document.getElementById('viewTitle'),filters=document.getElementById('filterBar');
    if(eyebrow)eyebrow.textContent='FINANZAS';if(title)title.textContent='Patrimonio';if(filters)filters.hidden=true;
    render();load();
  }
  function leaveIfNeeded(event){
    const button=event.target.closest('.nav-item');if(!active||!button||button.dataset.view==='patrimonio')return;
    active=false;destroyCharts();
    const filters=document.getElementById('filterBar');if(filters)filters.hidden=false;
  }
  function currencyClick(event){
    const button=event.target.closest('.currency-btn');if(!active||!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    currency=button.dataset.currency||'COP';
    document.querySelectorAll('.currency-btn').forEach(item=>item.classList.toggle('active',item===button));
    render();
  }

  document.addEventListener('click',activate,true);
  document.addEventListener('click',leaveIfNeeded,true);
  document.addEventListener('click',currencyClick,true);
  document.addEventListener('panel:backend-data-loaded',()=>{if(active)setTimeout(load,0);});
  document.addEventListener('panel:manual-refresh-complete',()=>{if(active)setTimeout(load,0);});
  window.__PANEL_PATRIMONIO_RENDER__=()=>{if(active)load();};
})();