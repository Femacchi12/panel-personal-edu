(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!financeId)return;
  const MONTHLY='Patrimonio_Mensual!A:AF';
  const DETAIL='Patrimonio_Detalle!A:N';
  let debtMode='include',frame=0,seq=0,lastSignature='';

  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const view=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  const currency=()=>document.querySelector('.currency-btn.active')?.dataset.currency||'COP';
  function num(v){if(typeof v==='number')return Number.isFinite(v)?v:0;let s=String(v??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0)s=c>d?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=6?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'')}else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'')}const n=Number(s);return Number.isFinite(n)?n:0}
  function money(v,cur){const digits=cur==='USD'?2:0;return new Intl.NumberFormat('es-CO',{style:'currency',currency:cur,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(num(v))}
  function signed(v,cur){const n=num(v);return`${n>0?'+':''}${money(n,cur)}`}
  function rows(payload,range){const cached=window.__PANEL_GET_CACHED_ROWS__;if(typeof cached==='function')return cached(payload,financeId,range);const values=payload?.sources?.[`${financeId}|${range}`]||[];if(values.length<2)return[];const h=(values[0]||[]).map(x=>String(x??'').trim());return values.slice(1).filter(r=>r?.some(x=>String(x??'').trim())).map(r=>Object.fromEntries(h.map((x,i)=>[x,r?.[i]??''])))}
  function monthKey(r){return String(r?.Mes||r?.Periodo||'').trim()}
  function yearMonthState(){return{year:document.querySelector('[data-p-filter="year"]')?.value||'all',month:document.querySelector('[data-p-filter="month"]')?.value||'all'}}
  function periodMatch(key){const s=yearMonthState(),m=String(key||'').match(/^(\d{4})-(\d{2})$/);if(!m)return false;if(s.year!=='all'&&m[1]!==s.year)return false;if(s.month!=='all'&&m[2]!==s.month)return false;return true}
  function visibleMonthly(all){const filtered=all.filter(r=>periodMatch(monthKey(r))).sort((a,b)=>monthKey(a).localeCompare(monthKey(b)));return filtered.length?filtered:all.slice().sort((a,b)=>monthKey(a).localeCompare(monthKey(b)))}
  function latestMonthly(all){const sorted=all.slice().sort((a,b)=>monthKey(a).localeCompare(monthKey(b))),match=sorted.filter(r=>periodMatch(monthKey(r)));if(match.length)return match.at(-1);const s=yearMonthState();if(s.year==='all')return sorted.at(-1)||{};const cap=`${s.year}-${s.month==='all'?'12':s.month}`;return sorted.filter(r=>monthKey(r)<=cap).at(-1)||sorted.at(-1)||{}}
  function excludeDebt(){return debtMode==='exclude'}
  function debtNative(row,cur){return Math.abs(num(row?.[`Deuda nativa ${cur}`]))}
  function debtEquivalent(row,cur){return Math.abs(num(row?.[`Deuda equivalente ${cur}`]))}
  function appliedDebt(row,cur){return excludeDebt()?0:debtEquivalent(row,cur)}
  function nativeHolding(row,cur){return num(row?.[`Saldo neto ${cur}`])+(excludeDebt()?debtNative(row,cur):0)}
  function baseValue(row,cur){const base=String(row?.[`Patrimonio sin ganancia ${cur}`]??'').trim()!==''?num(row[`Patrimonio sin ganancia ${cur}`]):num(row?.[`Patrimonio manual ${cur}`]);return base+(excludeDebt()?debtEquivalent(row,cur):0)}
  function gainValue(row,cur){return num(row?.[`Ganancia inversiones ${cur}`])}
  function withGainValue(row,cur){return baseValue(row,cur)+gainValue(row,cur)}
  function previousRow(all,row){const sorted=all.slice().sort((a,b)=>monthKey(a).localeCompare(monthKey(b))),i=sorted.findIndex(x=>monthKey(x)===monthKey(row));return i>0?sorted[i-1]:null}
  function variation(all,row,cur){const prev=previousRow(all,row);return prev?baseValue(row,cur)-baseValue(prev,cur):null}

  function ensureStyles(){if(document.getElementById('patrimonioNativeCurrencyStyles'))return;const s=document.createElement('style');s.id='patrimonioNativeCurrencyStyles';s.textContent=`
    #viewRoot .patrimonio-filter-panel.has-debt-toggle{grid-template-columns:repeat(5,minmax(0,1fr))}
    #viewRoot .patrimonio-native-history{min-width:1320px}
    #viewRoot .patrimonio-native-history th.num,#viewRoot .patrimonio-native-history td.num{text-align:right;white-space:nowrap}
    #viewRoot .patrimonio-debt-note{grid-column:1/-1;display:flex;gap:7px;align-items:flex-start;padding:7px 9px;border:1px solid rgba(87,128,178,.16);border-radius:9px;background:rgba(46,100,170,.035);font-size:8px;color:#748aa5;line-height:1.4}
    @media(max-width:1200px){#viewRoot .patrimonio-filter-panel.has-debt-toggle{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:760px){#viewRoot .patrimonio-filter-panel.has-debt-toggle{grid-template-columns:1fr}}
  `;document.head.appendChild(s)}

  function injectDebtFilter(){const panel=document.querySelector('#viewRoot .patrimonio-filter-panel');if(!panel)return;panel.classList.add('has-debt-toggle');let field=panel.querySelector('[data-p-debt-field]');if(!field){field=document.createElement('label');field.className='patrimonio-filter-field';field.dataset.pDebtField='1';field.innerHTML=`<span>Deudas</span><select data-p-debt-mode><option value="include">Incluir deudas · neto</option><option value="exclude">Excluir deudas · bruto</option></select>`;const note=panel.querySelector('.patrimonio-filter-note');note?panel.insertBefore(field,note):panel.appendChild(field)}const select=field.querySelector('[data-p-debt-mode]');if(select&&select.value!==debtMode)select.value=debtMode;let note=panel.querySelector('.patrimonio-debt-note');if(!note){note=document.createElement('div');note.className='patrimonio-debt-note';note.innerHTML='<strong>Tenencia real por moneda:</strong><span>COP, ARS y USD muestran los saldos efectivamente existentes en su moneda original. Al excluir deudas se suman nuevamente solo las filas históricas clasificadas explícitamente como deuda.</span>';panel.appendChild(note)}}

  function updateStatus(){const row=document.querySelector('#viewRoot .patrimonio-status-row');if(!row)return;let pill=row.querySelector('[data-debt-pill]');if(!pill){pill=document.createElement('span');pill.className='patrimonio-pill';pill.dataset.debtPill='1';row.appendChild(pill)}pill.textContent=excludeDebt()?'Deudas excluidas del cálculo':'Deudas incluidas en el cálculo';pill.classList.toggle('good',excludeDebt())}

  function updateCurrencyStrip(latest){const strip=document.querySelector('#viewRoot .patrimonio-currency-strip');if(!strip)return;['COP','ARS','USD'].forEach((cur,i)=>{const box=strip.children[i];if(!box)return;const label=box.querySelector('span'),value=box.querySelector('strong');if(label)label.textContent=`Tenencia real ${cur} · ${excludeDebt()?'sin deudas':'neta'}`;if(value)value.textContent=money(nativeHolding(latest,cur),cur)})}

  function updateTotalKpis(all,latest){const component=document.querySelector('[data-p-filter="component"]')?.value||'total';if(component!=='total')return;const cur=currency(),cards=[...document.querySelectorAll('#viewRoot .patrimonio-focus-kpis article')];if(cards.length<4)return;const base=baseValue(latest,cur),gain=gainValue(latest,cur),total=base+gain,diff=variation(all,latest,cur);const set=(card,label,value,meta,tone='')=>{const l=card.querySelector('span'),v=card.querySelector('strong'),m=card.querySelector('small');if(l)l.textContent=label;if(v){v.textContent=value;v.classList.remove('positive','negative');if(tone)v.classList.add(tone)}if(m)m.textContent=meta};set(cards[0],'Patrimonio base',money(base,cur),excludeDebt()?'Sin ganancias · deudas excluidas':'Sin ganancias · deudas incluidas');set(cards[1],'Ganancia inversiones',signed(gain,cur),'ARQ + Cocos conciliado',gain>=0?'positive':'negative');set(cards[2],'Patrimonio con ganancias',money(total,cur),excludeDebt()?'Base sin deudas + valorización':'Base neta + valorización','positive');set(cards[3],'Variación mensual',diff==null?'—':signed(diff,cur),excludeDebt()?'Base sin deudas vs corte anterior':'Base neta vs corte anterior',diff==null?'':diff>=0?'positive':'negative')}

  function historyTable(all,visible){const cur=currency();return`<div class="table-scroll patrimonio-table-scroll"><table class="data-table patrimonio-native-history"><thead><tr><th>Mes</th><th class="num">COP real</th><th class="num">ARS real</th><th class="num">USD real</th><th class="num">Deuda aplicada ${esc(cur)}</th><th class="num">Base ${esc(cur)}</th><th class="num">Variación base</th><th class="num">Ganancia inversiones</th><th class="num">Con ganancias</th></tr></thead><tbody>${visible.slice().reverse().map(r=>{const diff=variation(all,r,cur),gain=gainValue(r,cur);return`<tr><td>${esc(monthKey(r))}</td><td class="num">${esc(money(nativeHolding(r,'COP'),'COP'))}</td><td class="num">${esc(money(nativeHolding(r,'ARS'),'ARS'))}</td><td class="num">${esc(money(nativeHolding(r,'USD'),'USD'))}</td><td class="num ${appliedDebt(r,cur)>0?'negative':'neutral'}">${appliedDebt(r,cur)>0?`-${esc(money(appliedDebt(r,cur),cur))}`:esc(money(0,cur))}</td><td class="num">${esc(money(baseValue(r,cur),cur))}</td><td class="num ${diff==null?'neutral':diff>=0?'positive':'negative'}">${diff==null?'—':esc(signed(diff,cur))}</td><td class="num ${gain>=0?'positive':'negative'}">${esc(signed(gain,cur))}</td><td class="num">${esc(money(withGainValue(r,cur),cur))}</td></tr>`}).join('')}</tbody></table></div>`}

  function updateHistory(all,visible){const panels=[...document.querySelectorAll('#viewRoot .panel')],panel=panels.find(p=>norm(p.querySelector('.panel-title strong')?.textContent)==='historico patrimonial');if(!panel)return;const title=panel.querySelector('.panel-title strong'),sub=panel.querySelector('.panel-title span');if(title)title.textContent='Histórico patrimonial · saldos reales por moneda';if(sub)sub.textContent=`${visible.length} cortes · ${excludeDebt()?'deudas excluidas · deuda aplicada = 0':'deudas incluidas · deuda aplicada descontada'}`;panel.querySelector('.patrimonio-table-scroll')?.remove();panel.insertAdjacentHTML('beforeend',historyTable(all,visible))}

  function updateHistoryChart(visible){if(typeof Chart==='undefined')return;const canvas=document.getElementById('patrimonioV2History'),chart=canvas?Chart.getChart(canvas):null;if(!chart||chart.data.datasets.length<2)return;const cur=currency();chart.data.labels=visible.map(monthKey);chart.data.datasets[0].label=excludeDebt()?'Patrimonio base · sin deudas':'Patrimonio base · neto';chart.data.datasets[0].data=visible.map(r=>baseValue(r,cur));chart.data.datasets[1].label=excludeDebt()?'Con ganancias · sin deudas':'Con ganancias · neto';chart.data.datasets[1].data=visible.map(r=>withGainValue(r,cur));chart.update('none')}

  function updateComposition(detail,latest){if(typeof Chart==='undefined')return;const canvas=document.getElementById('patrimonioV2Composition'),chart=canvas?Chart.getChart(canvas):null;if(!chart)return;let list=detail.filter(r=>monthKey(r)===monthKey(latest));if(excludeDebt())list=list.filter(r=>norm(r.Tipo)!=='deuda');const cur=currency(),field=`Valor ${cur}`,top=list.filter(r=>Math.abs(num(r[field]))>0).sort((a,b)=>Math.abs(num(b[field]))-Math.abs(num(a[field]))).slice(0,12);chart.data.labels=top.map(r=>r['Cuenta / billetera']||'');chart.data.datasets[0].data=top.map(r=>num(r[field]));chart.data.datasets[0].backgroundColor=top.map(r=>num(r[field])<0?'rgba(255,117,133,.7)':'rgba(0,217,144,.65)');chart.update('none')}

  async function run(){if(view()!=='patrimonio')return;const root=document.querySelector('#viewRoot .patrimonio-v2');if(!root)return;const token=++seq,get=window.__PANEL_GET_BACKEND_DATA__;if(typeof get!=='function')return;const payload=await get(false).catch(()=>null);if(!payload||token!==seq||view()!=='patrimonio')return;const all=rows(payload,MONTHLY).sort((a,b)=>monthKey(a).localeCompare(monthKey(b))),detail=rows(payload,DETAIL);if(!all.length)return;const visible=visibleMonthly(all),latest=latestMonthly(all),s=yearMonthState(),sig=[debtMode,currency(),s.year,s.month,document.querySelector('[data-p-filter="component"]')?.value||'total',monthKey(latest),all.length].join('|');const complete=root.querySelector('[data-p-debt-mode]')&&root.querySelector('.patrimonio-native-history');if(sig===lastSignature&&complete)return;lastSignature=sig;ensureStyles();injectDebtFilter();updateStatus();updateCurrencyStrip(latest);updateTotalKpis(all,latest);updateHistory(all,visible);requestAnimationFrame(()=>{updateHistoryChart(visible);updateComposition(detail,latest)})}
  function schedule(){if(frame)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=0;setTimeout(run,0)})}

  document.addEventListener('change',e=>{if(e.target.matches('[data-p-debt-mode]')){debtMode=e.target.value||'include';lastSignature='';schedule();return}if(e.target.matches('[data-p-filter]')){lastSignature='';schedule()}},true);
  document.addEventListener('click',e=>{if(e.target.closest('.currency-btn')){lastSignature='';setTimeout(schedule,0)}},true);
  document.addEventListener('panel:view-root-changed',()=>{lastSignature='';schedule()});
  document.addEventListener('panel:backend-data-loaded',()=>{lastSignature='';schedule()});
  document.addEventListener('panel:manual-refresh-complete',()=>{lastSignature='';schedule()});
  const root=document.getElementById('viewRoot');if(root)new MutationObserver(()=>{if(view()==='patrimonio')schedule()}).observe(root,{childList:true,subtree:true});
  queueMicrotask(schedule);
})();