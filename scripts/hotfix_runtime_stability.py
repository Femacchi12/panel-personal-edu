from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise AssertionError(f'No se encontró bloque: {label}')
    return text.replace(old, new, 1)

# 1) Monthly projection: single host, central cache, no root DOM churn.
p = Path('monthly-projection-control.js')
text = p.read_text(encoding='utf-8')
text = replace_once(text, "  let cache=null,cacheAt=0,timer=null;", "  let timer=null;", 'monthly cache vars')
old = "  async function payload(force=false){if(!force&&cache&&Date.now()-cacheAt<50000)return cache;const token=await window.__PANEL_GET_ID_TOKEN__?.(false);if(!token)return null;const r=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!r.ok)return null;cache=await r.json();cacheAt=Date.now();return cache;}"
new = "  async function payload(force=false){const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')return null;return getData(force);}"
text = replace_once(text, old, new, 'monthly payload')
pattern = re.compile(r"  async function run\(force=false\)\{.*?\n  schedule\(false,500\);\n", re.S)
replacement = r'''  async function run(force=false){
    const view=activeView();if(view!=='gastos'&&view!=='flujo')return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const p=await payload(force);if(!p||activeView()!==view)return;
    const rows=parseRows(p.sources?.[`${financeId}|Movimientos!A:Z`]||[]);
    const stats=monthlyStats(rows,targetMonth(rows));
    let host=root.querySelector('#monthlyProjectionSuite');
    if(!host){
      host=document.createElement('section');host.id='monthlyProjectionSuite';
      const head=root.querySelector(':scope > .section-head');
      if(head)head.insertAdjacentElement('afterend',host);else root.prepend(host);
    }
    renderSuite(host,stats);
  }
  function schedule(force=false,delay=70){clearTimeout(timer);timer=setTimeout(()=>run(force).catch(console.error),delay);}
  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{
    const view=event.detail?.view;
    if(view==='gastos'||view==='flujo')schedule(false,20);
  });
  document.addEventListener('panel:payment-filters-changed',event=>{
    const view=activeView();if(event.detail?.view===view&&(view==='gastos'||view==='flujo'))schedule(false,35);
  });
  document.addEventListener('panel:filters-updated',()=>{const view=activeView();if(view==='gastos'||view==='flujo')schedule(false,35);});
  document.addEventListener('click',event=>{if(event.target.closest('#refreshBtn'))schedule(true,260);},true);
  queueMicrotask(()=>schedule(false,80));
'''
text, count = pattern.subn(replacement, text, count=1)
assert count == 1, f'Esperaba reemplazar tail monthly una vez, obtuve {count}'
p.write_text(text, encoding='utf-8')

# 2) Expense table: format original amount at source, not by DOM post-processor.
p = Path('expense-table-advanced.js')
text = p.read_text(encoding='utf-8')
needle = "  function parseDate(value){const s=String(value??'').trim();if(!s)return null;let m=s.match(/^(\\d{4})-(\\d{1,2})(?:-(\\d{1,2}))?/);if(m)return new Date(+m[1],+m[2]-1,+(m[3]||1));m=s.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);const d=new Date(s);return Number.isNaN(d.getTime())?null:d;}"
insert = "  function formatOriginal(row){const raw=row['Monto original'];const value=parseNumber(raw);const source=String(raw??'').trim();const decimalMatch=source.match(/[,.](\\d{1,2})$/);const decimals=decimalMatch?decimalMatch[1].length:0;return `$${value.toLocaleString('es-CO',{minimumFractionDigits:decimals,maximumFractionDigits:decimals})}`;}\n" + needle
text = replace_once(text, needle, insert, 'expense format helper')
old = "  function valueFor(row,col){if(col==='Fecha real')return dateLabel(row);if(col==='Tipo de gasto')return expenseType(row);if(col==='Modalidad de pago')return method(row);return row[col]??'';}"
new = "  function valueFor(row,col){if(col==='Fecha real')return dateLabel(row);if(col==='Tipo de gasto')return expenseType(row);if(col==='Monto original')return formatOriginal(row);if(col==='Modalidad de pago')return method(row);return row[col]??'';}"
text = replace_once(text, old, new, 'expense valueFor')
p.write_text(text, encoding='utf-8')

# 3) Spend chart: one canonical total series; daily cumulative for a single month.
p = Path('spend-chart-controller.js')
text = p.read_text(encoding='utf-8')
pattern = re.compile(r"  function redraw\(rows\)\{.*?\n  \}\n\n  async function apply", re.S)
replacement = r'''  function redraw(rows){
    if(activeView()!=='gastos'||!window.Chart)return;
    const canvas=document.getElementById('spendChart');if(!canvas)return;
    Chart.getChart(canvas)?.destroy();
    const currency=activeCurrency(),years=selectedGlobal('year'),months=selectedGlobal('month');
    const singleMonth=years.length===1&&months.length===1;
    let labels=[],values=[];
    if(singleMonth){
      const year=Number(years[0]),monthIndex=Number(months[0])-1,now=new Date();
      const endDay=year===now.getFullYear()&&monthIndex===now.getMonth()?now.getDate():new Date(year,monthIndex+1,0).getDate();
      const daily=new Map();
      rows.forEach(row=>{const d=parseDate(row['Fecha real']||row['Fecha registrada']);if(!d||d.getFullYear()!==year||d.getMonth()!==monthIndex)return;daily.set(d.getDate(),(daily.get(d.getDate())||0)+amount(row,currency));});
      let running=0;
      for(let day=1;day<=endDay;day++){running+=daily.get(day)||0;labels.push(`${String(day).padStart(2,'0')}/${String(monthIndex+1).padStart(2,'0')}`);values.push(running);}
    }else{
      const totals=new Map();
      rows.forEach(row=>{const d=parseDate(row['Fecha real']||row['Fecha registrada']);if(!d)return;const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;totals.set(key,(totals.get(key)||0)+amount(row,currency));});
      const periods=[...totals.keys()].sort();
      labels=periods.map(period=>{const[year,month]=period.split('-').map(Number);return`${MONTH_LABELS[month-1]} ${year}`;});
      values=periods.map(period=>totals.get(period)||0);
    }
    new Chart(canvas,{type:'line',data:{labels,datasets:[{label:'Total seleccionado',data:values,borderColor:COLORS[0],backgroundColor:COLORS[0],borderWidth:2,tension:.22,pointRadius:2,pointHoverRadius:5,spanGaps:true}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'nearest',intersect:false},plugins:{legend:{display:true,labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}}},scales:{x:{ticks:{color:'#718098',maxRotation:0,autoSkip:true},grid:{color:'#121c29'}},y:{beginAtZero:true,ticks:{color:'#718098'},grid:{color:'#121c29'}}}}});
  }

  async function apply'''
text, count = pattern.subn(replacement, text, count=1)
assert count == 1, f'Esperaba reemplazar redraw una vez, obtuve {count}'
p.write_text(text, encoding='utf-8')

# 4) Flow matrix: shared backend cache + event driven instead of observer/delayed retries.
p = Path('flow-matrix-v3.js')
text = p.read_text(encoding='utf-8')
text = replace_once(text, "  let cache = null, cacheAt = 0, timer = null, selectedDetail = null, applying = false;", "  let timer = null, selectedDetail = null, applying = false;", 'flow matrix cache vars')
old = "  async function payload(force=false){\n    if(!force&&cache&&Date.now()-cacheAt<55000)return cache;\n    const token=await window.__PANEL_GET_ID_TOKEN__?.(false); if(!token)return null;\n    const r=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'}); if(!r.ok)throw new Error(`Backend ${r.status}`);\n    cache=await r.json(); cacheAt=Date.now(); return cache;\n  }"
new = "  async function payload(force=false){\n    const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')return null;\n    return getData(force);\n  }"
text = replace_once(text, old, new, 'flow matrix payload')
text = text.replace("<span>2026 desde Movimientos · histórico anterior como respaldo · monto + % sobre ingreso regular</span>", "<span>${esc(year)} desde Movimientos · histórico anterior como respaldo · monto + % sobre ingreso regular</span>", 1)
pattern = re.compile(r"  function schedule\(force=false,delay=260\).*?\n  \[500,1100\]\.forEach\(ms=>setTimeout\(\(\)=>run\(false\),ms\)\);\n", re.S)
replacement = r'''  function schedule(force=false,delay=55){clearTimeout(timer);timer=setTimeout(()=>run(force),delay);}

  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{
    if(event.detail?.view==='flujo'&&!document.getElementById('flowMatrixV3'))schedule(false,20);
  });
  document.addEventListener('panel:payment-filters-changed',event=>{if(event.detail?.view==='flujo')schedule(false,35);});
  document.addEventListener('panel:filters-updated',()=>{if(activeView()==='flujo')schedule(false,35);});
  document.addEventListener('click',event=>{if(event.target.closest('#refreshBtn')&&activeView()==='flujo')schedule(true,280);},true);
  queueMicrotask(()=>{if(activeView()==='flujo')schedule(false,80);});
'''
text, count = pattern.subn(replacement, text, count=1)
assert count == 1, f'Esperaba reemplazar tail flow matrix una vez, obtuve {count}'
p.write_text(text, encoding='utf-8')

# 5) Flow income controller: shared backend cache, fix matrix selector, event driven.
p = Path('flow-income-controller.js')
text = p.read_text(encoding='utf-8')
text = replace_once(text, "  let cache = null;\n  let cacheAt = 0;\n  let timer = null;", "  let timer = null;", 'flow income cache vars')
pattern = re.compile(r"  async function payload\(force = false\) \{.*?\n  \}\n\n  const sourceRows", re.S)
replacement = r'''  async function payload(force = false) {
    const getData = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getData !== 'function') return null;
    return getData(force);
  }

  const sourceRows'''
text, count = pattern.subn(replacement, text, count=1)
assert count == 1, f'Esperaba reemplazar payload flow income una vez, obtuve {count}'
text = text.replace("thead tr:first-child th[data-flow-sort-month]", "thead tr:first-child th[data-sort-month]", 1)
text = text.replace("th.dataset.flowSortMonth || ''", "th.dataset.sortMonth || ''", 1)
pattern = re.compile(r"  const schedule = \(force = false, delay = 180\) => \{.*?\n  setTimeout\(\(\) => apply\(false\), 700\);\n", re.S)
replacement = r'''  const schedule = (force = false, delay = 70) => {
    clearTimeout(timer);
    timer = setTimeout(() => apply(force), delay);
  };

  document.addEventListener('panel:flow-matrix-v3-rendered', () => schedule(false, 15));
  document.addEventListener('panel:view-root-changed', event => { if (event.detail?.view === 'flujo') schedule(false, 45); });
  document.addEventListener('panel:payment-filters-changed', event => { if (event.detail?.view === 'flujo') schedule(false, 35); });
  document.addEventListener('panel:filters-updated', () => { if (activeView() === 'flujo') schedule(false, 35); });
  document.addEventListener('click', event => { if (event.target.closest('#refreshBtn') && activeView() === 'flujo') schedule(true, 300); }, true);
  queueMicrotask(() => { if (activeView() === 'flujo') schedule(false, 90); });
'''
text, count = pattern.subn(replacement, text, count=1)
assert count == 1, f'Esperaba reemplazar tail flow income una vez, obtuve {count}'
p.write_text(text, encoding='utf-8')

# 6) Detail delegate also reuses central backend payload.
p = Path('flow-matrix-detail-delegate.js')
text = p.read_text(encoding='utf-8')
text = replace_once(text, "  let cache = null;\n  let cacheAt = 0;\n\n", "", 'detail cache vars')
pattern = re.compile(r"  async function payload\(\) \{.*?\n  \}\n\n  function rowsFor", re.S)
replacement = r'''  async function payload() {
    const getData = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getData !== 'function') return null;
    return getData(false);
  }

  function rowsFor'''
text, count = pattern.subn(replacement, text, count=1)
assert count == 1, f'Esperaba reemplazar payload detail una vez, obtuve {count}'
text = re.sub(r"\n  document\.addEventListener\('click', e => \{\n    if \(e\.target\.closest\('#refreshBtn'\)\) \{\n      cache = null;\n      cacheAt = 0;\n    \}\n  \}, true\);", "", text, count=1)
p.write_text(text, encoding='utf-8')

# 7) Remove post-render chart/amount mutators from the HTML loader.
p = Path('index.html')
text = p.read_text(encoding='utf-8')
text = text.replace('  <script src="chart-filter-behavior.js"></script>\n', '', 1)
text = text.replace('  <script src="amount-original-format.js?v=20260823-1939"></script>\n', '', 1)
p.write_text(text, encoding='utf-8')
