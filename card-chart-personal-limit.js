(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  const usdCop = Number(cfg.regularIncome?.usdCopReference || 3150);
  if(!financeId) return;

  let renderFrame = 0;
  let requestVersion = 0;
  let pendingForce = false;
  let limitMode = 'control';
  window.__PANEL_CARD_LIMIT_MODE__ = limitMode;

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[·|]/g,' ')
    .replace(/\s+/g,' ')
    .trim();

  function activeView(){
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  function parseNumber(value){
    if(typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if(!s) return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0){
      if(comma>dot) s=s.replace(/\./g,'').replace(',','.');
      else s=s.replace(/,/g,'');
    } else if(comma>=0){
      const p=s.split(',');
      s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');
    } else if(dot>=0){
      const p=s.split('.');
      if(p.length>2||(p.length===2&&p[1].length===3)) s=s.replace(/\./g,'');
    }
    const n=Number(s);
    return Number.isFinite(n)?n:0;
  }

  function parseRows(values){
    if(!Array.isArray(values)||values.length<2) return [];
    const headers=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1)
      .filter(row=>row?.some(v=>String(v??'').trim()!==''))
      .map(row=>Object.fromEntries(headers.map((header,index)=>[header||`Col ${index+1}`,row?.[index]??''])));
  }

  function rowsFromPayload(payload,range){
    const cached=window.__PANEL_GET_CACHED_ROWS__;
    if(typeof cached==='function') return cached(payload,financeId,range);
    return parseRows(payload?.sources?.[`${financeId}|${range}`]||[]);
  }

  async function loadData(force=false){
    const getData=window.__PANEL_GET_BACKEND_DATA__;
    if(typeof getData!=='function') return {cardRows:[],movements:[]};
    const payload=await getData(force);
    return {
      cardRows:rowsFromPayload(payload,'Tarjetas!A:T'),
      movements:window.FinanceScopeCore?.movementRows?window.FinanceScopeCore.movementRows(payload,financeId):rowsFromPayload(payload,'Movimientos!A:AA')
    };
  }

  function parseDate(value){
    if(typeof value==='number'&&Number.isFinite(value)&&value>20000&&value<80000){const utc=new Date(Math.round((value-25569)*86400000));return new Date(utc.getUTCFullYear(),utc.getUTCMonth(),utc.getUTCDate());}
    const s=String(value??'').trim();
    if(!s) return null;
    let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(m) return new Date(+m[1],+m[2]-1,+m[3]);
    m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(m) return new Date(+m[3],+m[2]-1,+m[1]);
    return null;
  }

  function safeDate(year,monthIndex,day){
    const last=new Date(year,monthIndex+1,0).getDate();
    return new Date(year,monthIndex,Math.min(day,last));
  }

  function currentCycle(cutDay=6,now=new Date()){
    let end;
    if(now.getDate()<=cutDay) end=safeDate(now.getFullYear(),now.getMonth(),cutDay);
    else end=safeDate(now.getFullYear(),now.getMonth()+1,cutDay);
    const previous=safeDate(end.getFullYear(),end.getMonth()-1,cutDay);
    const start=new Date(previous.getFullYear(),previous.getMonth(),previous.getDate());
    return {start,end};
  }

  const money = value => new Intl.NumberFormat('es-CO',{
    style:'currency',currency:'COP',maximumFractionDigits:0
  }).format(Number(value)||0);

  const usdMoney = value => `US$${new Intl.NumberFormat('es-CO',{
    minimumFractionDigits:2,maximumFractionDigits:2
  }).format(Number(value)||0)}`;

  const pad=n=>String(n).padStart(2,'0');
  const shortDate=d=>`${pad(d.getDate())}/${pad(d.getMonth()+1)}`;

  function cardsFromRows(rows){
    return rows.map(row=>{
      const issuer=String(row.Emisor||'').trim();
      const owner=String(row.Titular||'').trim();
      const real=parseNumber(row['Cupo total actual']||row['Cupo total']||row['Límite real']);
      const used=parseNumber(row['Cupo usado']||row.Utilizado||row['Saldo usado']);
      const configured=parseNumber(row['Límite personal de gasto']||row['Límite de control']);
      const control=configured>0?configured:real;
      return {issuer,owner,real,used,control,key:norm(`${issuer} ${owner}`)};
    }).filter(card=>card.issuer&&card.real>0);
  }

  function normalizeCardTableHeaders(){
    document.querySelectorAll('#viewRoot table thead tr').forEach(row=>{
      [...row.cells].forEach(cell=>{
        const text=norm(cell.textContent);
        if(text==='limite personal de gasto') cell.textContent='Límite de control';
        if(text==='% uso limite personal') cell.textContent='% uso límite de control';
      });
    });
  }

  function matchCard(label,cards){
    const text=norm(label);
    return cards.find(card=>text.includes(norm(card.issuer))&&text.includes(norm(card.owner)))
      || cards.find(card=>text.includes(norm(card.issuer)))
      || null;
  }

  function buildArqDebt(rows){
    const {start,end}=currentCycle(6);
    const sums={COP:0,USD:0};

    (rows||[]).forEach(row=>{
      if(norm(row.Tipo)!=='gasto') return;
      if(!norm(row['Cuenta / Tarjeta']).includes('arq')) return;
      const isActual=window.MovementStatusCore?.isActual
        ? window.MovementStatusCore.isActual(row.Estado)
        : !/proyecc|proyect|programad/.test(norm(row.Estado));
      if(!isActual) return;
      const movementDate=parseDate(row['Fecha real']||row['Fecha registrada']);
      if(!movementDate||movementDate<start||movementDate>end) return;
      const currency=String(row['Moneda original']||'').trim().toUpperCase();
      if(currency!=='COP'&&currency!=='USD') return;
      sums[currency]+=parseNumber(row['Monto original']);
    });

    return {
      cop:sums.COP,
      usd:sums.USD,
      equivalent:sums.COP+sums.USD*usdCop,
      start,end
    };
  }

  function currentLimit(card){
    if(!card) return 0;
    return limitMode==='real' ? card.real : card.control;
  }

  function ensureSelectors(){
    ['cardsChart','cardTrendChart'].forEach(id=>{
      const canvas=document.getElementById(id);
      const panel=canvas?.closest('.panel');
      const header=panel?.querySelector('.panel-header');
      if(!header) return;
      const isTrendPanel=Boolean(header.closest('[data-card-line-panel]'));
      let slot=header.querySelector('.card-limit-reference-slot');
      if(isTrendPanel&&!slot){
        let controls=header.querySelector('.card-line-controls');
        const mode=header.querySelector('.chart-mode-switch');
        if(!controls){
          controls=document.createElement('div');
          controls.className='card-line-controls';
          if(mode){header.insertBefore(controls,mode);controls.appendChild(mode);}
          else header.appendChild(controls);
        }
        slot=document.createElement('div');
        slot.className='card-limit-reference-slot';
        controls.appendChild(slot);
      }
      let selector=header.querySelector('.card-limit-reference');
      if(!selector){
        selector=document.createElement('div');
        selector.className='card-limit-reference';
        selector.innerHTML=`
          <span>Referencia</span>
          <button type="button" data-card-limit-mode="control">Límite de control</button>
          <button type="button" data-card-limit-mode="real">Límite real</button>`;
        (slot||header).appendChild(selector);
        selector.querySelectorAll('[data-card-limit-mode]').forEach(button=>{
          button.addEventListener('click',event=>{
            event.stopPropagation();
            const next=String(button.dataset.cardLimitMode||'control');
            if(!['control','real'].includes(next)||next===limitMode) return;
            limitMode=next;
            window.__PANEL_CARD_LIMIT_MODE__=limitMode;
            syncSelectorState();
            document.dispatchEvent(new CustomEvent('panel:card-limit-mode-changed',{detail:{mode:limitMode}}));
            schedule(false);
          });
        });
      } else if(slot&&selector.parentElement!==slot){
        slot.appendChild(selector);
      }
    });
    syncSelectorState();
  }

  function syncSelectorState(){
    const metric=document.querySelector('[data-card-line-mode].active')?.dataset.cardLineMode||'spend';
    document.querySelectorAll('.card-limit-reference').forEach(selector=>{
      const isTrend=Boolean(selector.closest('[data-card-line-panel]'));
      selector.hidden=isTrend&&metric!=='limit';
    });
    document.querySelectorAll('[data-card-limit-mode]').forEach(button=>{
      const active=button.dataset.cardLimitMode===limitMode;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',active?'true':'false');
    });
  }

  function applyCardsChart(cards){
    const canvas=document.getElementById('cardsChart');
    const chart=canvas&&window.Chart?Chart.getChart(canvas):null;
    if(!chart) return;
    const usedDs=(chart.data.datasets||[]).find(ds=>norm(ds.label).includes('usado'));
    const availableDs=(chart.data.datasets||[]).find(ds=>norm(ds.label).includes('disponible'));
    if(!usedDs||!availableDs) return;

    let changed=false;
    (chart.data.labels||[]).forEach((label,index)=>{
      const card=matchCard(label,cards);
      if(!card) return;
      const limit=currentLimit(card);
      const used=card.used;
      const available=Math.max(0,limit-used);
      if(Number(usedDs.data?.[index]||0)!==used){usedDs.data[index]=used;changed=true;}
      if(Number(availableDs.data?.[index]||0)!==available){availableDs.data[index]=available;changed=true;}
    });
    const label=limitMode==='real'?'Disponible según límite real':'Disponible según límite de control';
    if(availableDs.label!==label){availableDs.label=label;changed=true;}
    if(changed) chart.update('none');

    const panel=canvas.closest('.panel');
    const subtitle=panel?.querySelector('.panel-title span');
    if(subtitle) subtitle.textContent=limitMode==='real'
      ? 'Cupo usado vs disponible sobre el límite real'
      : 'Cupo usado vs margen sobre el límite de control';
  }

  function enhanceCards(cards,debt){
    document.querySelectorAll('#viewRoot .credit-card').forEach(cardEl=>{
      const label=`${cardEl.querySelector('.credit-brand')?.textContent||''} ${cardEl.querySelector('.credit-owner')?.textContent||''}`;
      const card=matchCard(label,cards);
      if(!card||!card.control) return;

      const isArq=norm(card.issuer).includes('arq');
      if(isArq&&debt){
        let debtBlock=cardEl.querySelector('.card-currency-debt');
        if(!debtBlock){
          debtBlock=document.createElement('div');
          debtBlock.className='card-currency-debt';
          const bottom=cardEl.querySelector('.credit-bottom');
          if(bottom) cardEl.insertBefore(debtBlock,bottom);
          else cardEl.appendChild(debtBlock);
        }
        debtBlock.innerHTML=`
          <div class="card-debt-title">Movimientos registrados del ciclo ${shortDate(debt.start)}–${shortDate(debt.end)}</div>
          <div class="card-debt-row"><span>Consumos en COP</span><strong>${money(debt.cop)}</strong></div>
          <div class="card-debt-row"><span>Consumos en USD</span><strong>${usdMoney(debt.usd)}</strong></div>
          <div class="card-debt-note">Detalle de Movimientos · el saldo/cupo actual se toma de Tarjetas: ${money(card.used)}</div>`;
      }

      const pct=card.used/card.control*100;
      const available=card.control-card.used;
      let tone='',status='Dentro del límite de control';
      if(pct>=100){tone='critical';status='Límite de control superado';}
      else if(pct>=85){tone='critical';status='Alerta: muy cerca del límite de control';}
      else if(pct>=70){tone='high';status='Atención: uso elevado del límite de control';}

      let block=cardEl.querySelector('.card-control-limit');
      if(!block){
        block=document.createElement('div');
        block.className='card-control-limit';
        const bottom=cardEl.querySelector('.credit-bottom');
        if(bottom) cardEl.insertBefore(block,bottom);
        else cardEl.appendChild(block);
      }
      block.className=`card-control-limit ${tone}`.trim();
      block.innerHTML=`
        <div class="card-control-line"><span>Límite de control</span><strong>${money(card.control)}</strong></div>
        <div class="card-control-meta"><span>${pct.toLocaleString('es-CO',{maximumFractionDigits:1})}% usado</span><span>${available>=0?`${money(available)} disponibles`:`Superado por ${money(Math.abs(available))}`}</span></div>
        <div class="card-control-track"><div class="card-control-fill" style="width:${Math.max(0,Math.min(100,pct))}%"></div></div>
        <div class="card-control-status">${status}</div>`;
    });
  }

  function applyTrendChart(){
    syncSelectorState();
    const canvas=document.getElementById('cardTrendChart');
    const metric=document.querySelector('[data-card-line-mode].active')?.dataset.cardLineMode||'spend';
    if(!canvas||metric!=='limit') return;
    const panel=canvas.closest('.panel');
    const subtitle=panel?.querySelector('.panel-title span');
    const reference=limitMode==='real'?'límite real':'límite de control';
    if(subtitle) subtitle.textContent=`Porcentaje del ${reference} utilizado`;
  }

  async function applyAll(force=false){
    if(activeView()!=='tarjetas'||!window.Chart) return;
    const version=++requestVersion;
    const {cardRows,movements}=await loadData(force);
    if(version!==requestVersion||activeView()!=='tarjetas') return;
    const cards=cardsFromRows(cardRows);
    if(!cards.length) return;
    const debt=buildArqDebt(movements);
    normalizeCardTableHeaders();
    ensureSelectors();
    enhanceCards(cards,debt);
    applyCardsChart(cards);
    applyTrendChart(cards);
  }

  function schedule(force=false){
    pendingForce=pendingForce||force;
    if(renderFrame)return;
    renderFrame=requestAnimationFrame(()=>{
      renderFrame=0;
      const useForce=pendingForce;
      pendingForce=false;
      applyAll(useForce).catch(error=>console.error('Control de límites de tarjeta:',error));
    });
  }

  document.addEventListener('panel:view-root-changed',event=>{
    if(event.detail?.view==='tarjetas')schedule(false);else requestVersion++;
  });
  document.addEventListener('panel:card-filter-changed',()=>schedule(false));
  document.addEventListener('panel:section-filters-changed',event=>{
    if(event.detail?.view==='tarjetas')schedule(false);
  });
  document.addEventListener('panel:card-trend-rendered',()=>{ensureSelectors();syncSelectorState();});
  document.addEventListener('click',event=>{
    if(event.target.closest?.('[data-card-line-mode]')) setTimeout(syncSelectorState,0);
  },true);

  if(!document.getElementById('cardLimitControlStyles')){
    const style=document.createElement('style');
    style.id='cardLimitControlStyles';
    style.textContent=`
      .card-line-header{display:flex;align-items:flex-start;gap:16px}
      .card-line-header .panel-title{min-width:0;flex:1 1 auto}
      .card-line-controls{display:grid;grid-template-columns:286px max-content;align-items:center;gap:10px;margin-left:auto;min-width:max-content}
      .card-line-controls .chart-mode-switch{grid-column:2;grid-row:1;margin:0;justify-self:end}
      .card-limit-reference-slot{grid-column:1;grid-row:1;width:286px;min-width:286px;display:flex;justify-content:flex-end;align-items:center}
      .card-limit-reference{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;margin:0;font-size:11px;color:#8fa0b6;white-space:nowrap}
      .card-limit-reference[hidden]{display:flex!important;visibility:hidden;opacity:0;pointer-events:none}
      @media(max-width:900px){
        .card-line-header{align-items:stretch;flex-direction:column}
        .card-line-controls{grid-template-columns:286px max-content;margin-left:0;align-self:flex-end}
      }
      @media(max-width:620px){
        .card-line-controls{grid-template-columns:1fr;align-self:stretch}
        .card-line-controls .chart-mode-switch{grid-column:1;grid-row:1;justify-self:stretch}
        .card-limit-reference-slot{grid-column:1;grid-row:2;width:100%;min-width:0;justify-content:flex-start}
      }
      .card-limit-reference>span{margin-right:2px}
      .card-limit-reference button{border:1px solid #2b3a4d;background:#111b28;color:#aeb9c8;border-radius:999px;padding:5px 9px;font:inherit;cursor:pointer}
      .card-limit-reference button.active{border-color:#26d07c;color:#e8fff3;background:#143225}
      .card-currency-debt{margin:12px 0 4px;padding:10px 11px;border:1px solid #263548;border-radius:10px;background:#0b131e}
      .card-debt-title{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#7f91a8;margin-bottom:7px}
      .card-debt-row{display:flex;justify-content:space-between;gap:12px;padding:3px 0;font-size:11px;color:#9cacc0}
      .card-debt-row strong{font-size:13px;color:#f2f6fb}
      .card-debt-note{font-size:10px;color:#718399;margin-top:6px}
      .card-control-limit{margin:8px 0 4px;padding:10px 11px;border:1px solid #263548;border-radius:10px;background:#0d1622}
      .card-control-limit.high{border-color:#8f6a1c}
      .card-control-limit.critical{border-color:#8f3e4a}
      .card-control-line,.card-control-meta{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .card-control-line span,.card-control-meta{font-size:11px;color:#8fa0b6}
      .card-control-line strong{font-size:13px;color:#f2f6fb}
      .card-control-track{height:6px;background:#1b2939;border-radius:999px;overflow:hidden;margin:8px 0 6px}
      .card-control-fill{height:100%;background:#26d07c;border-radius:999px}
      .card-control-limit.high .card-control-fill{background:#f6c844}
      .card-control-limit.critical .card-control-fill{background:#ff667a}
      .card-control-status{font-size:10px;color:#7fd9a7}
      .card-control-limit.high .card-control-status{color:#f6c844}
      .card-control-limit.critical .card-control-status{color:#ff8797}
    `;
    document.head.appendChild(style);
  }

  queueMicrotask(()=>schedule(false));
})();
