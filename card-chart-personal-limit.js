(() => {
  'use strict';

  let timer = null;
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

  const money = value => new Intl.NumberFormat('es-CO',{
    style:'currency',currency:'COP',maximumFractionDigits:0
  }).format(Number(value)||0);

  function headerIndex(headers,tests){
    return headers.findIndex(h=>tests.some(test=>h.includes(test)));
  }

  function readCardTable(){
    const tables=[...document.querySelectorAll('#viewRoot table')];
    for(const table of tables){
      const headerCells=[...table.querySelectorAll('thead th')];
      if(!headerCells.length) continue;
      const headers=headerCells.map(th=>norm(th.textContent));
      const ix={
        issuer:headerIndex(headers,['emisor']),
        owner:headerIndex(headers,['titular']),
        real:headerIndex(headers,['cupo total actual','cupo total','limite real']),
        used:headerIndex(headers,['cupo usado','utilizado','saldo usado']),
        control:headerIndex(headers,['limite personal de gasto','limite de control']),
        controlPct:headerIndex(headers,['% uso limite personal','% uso limite de control'])
      };
      if(ix.issuer<0||ix.owner<0||ix.real<0||ix.used<0||ix.control<0) continue;

      if(headerCells[ix.control]) headerCells[ix.control].textContent='Límite de control';
      if(ix.controlPct>=0&&headerCells[ix.controlPct]) headerCells[ix.controlPct].textContent='% uso límite de control';

      return [...table.querySelectorAll('tbody tr')].map(row=>{
        const cells=[...row.cells];
        const issuer=String(cells[ix.issuer]?.textContent||'').trim();
        const owner=String(cells[ix.owner]?.textContent||'').trim();
        const real=parseNumber(cells[ix.real]?.textContent);
        const used=parseNumber(cells[ix.used]?.textContent);
        const configured=parseNumber(cells[ix.control]?.textContent);
        const control=configured>0?configured:real;
        return {issuer,owner,real,used,control,key:norm(`${issuer} ${owner}`)};
      }).filter(card=>card.issuer&&card.real>0);
    }
    return [];
  }

  function matchCard(label,cards){
    const text=norm(label);
    return cards.find(card=>text.includes(norm(card.issuer))&&text.includes(norm(card.owner)))
      || cards.find(card=>text.includes(norm(card.issuer)))
      || null;
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
      let selector=header.querySelector('.card-limit-reference');
      if(!selector){
        selector=document.createElement('div');
        selector.className='card-limit-reference';
        selector.innerHTML=`
          <span>Referencia</span>
          <button type="button" data-card-limit-mode="control">Límite de control</button>
          <button type="button" data-card-limit-mode="real">Límite real</button>`;
        header.appendChild(selector);
        selector.querySelectorAll('[data-card-limit-mode]').forEach(button=>{
          button.addEventListener('click',event=>{
            event.stopPropagation();
            const next=String(button.dataset.cardLimitMode||'control');
            if(!['control','real'].includes(next)||next===limitMode) return;
            limitMode=next;
            window.__PANEL_CARD_LIMIT_MODE__=limitMode;
            syncSelectorState();
            applyAll(true);
          });
        });
      }
    });
    syncSelectorState();
  }

  function syncSelectorState(){
    document.querySelectorAll('[data-card-limit-mode]').forEach(button=>{
      const active=button.dataset.cardLimitMode===limitMode;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',active?'true':'false');
    });
  }

  function applyCardsChart(cards,force=false){
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
    if(changed||force) chart.update('none');

    const panel=canvas.closest('.panel');
    const subtitle=panel?.querySelector('.panel-title span');
    if(subtitle) subtitle.textContent=limitMode==='real'
      ? 'Cupo usado vs disponible sobre el límite real'
      : 'Cupo usado vs margen sobre el límite de control';
  }

  function enhanceCards(cards){
    document.querySelectorAll('#viewRoot .credit-card').forEach(cardEl=>{
      const label=`${cardEl.querySelector('.credit-brand')?.textContent||''} ${cardEl.querySelector('.credit-owner')?.textContent||''}`;
      const card=matchCard(label,cards);
      if(!card||!card.control) return;
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

  function applyTrendChart(cards,force=false){
    const canvas=document.getElementById('cardTrendChart');
    const chart=canvas&&window.Chart?Chart.getChart(canvas):null;
    if(!chart) return;
    const metric=document.querySelector('[data-card-line-mode].active')?.dataset.cardLineMode||'spend';
    if(metric!=='limit') return;

    let changed=false;
    (chart.data.datasets||[]).forEach(ds=>{
      const card=matchCard(ds.label,cards);
      if(!card||!card.real||!card.control) return;
      const currentSig=JSON.stringify(ds.data||[]);
      if(!Array.isArray(ds.__panelControlData)||currentSig!==ds.__panelRenderedSig){
        ds.__panelControlData=(ds.data||[]).map(v=>v==null?null:Number(v));
      }
      const factor=limitMode==='real' ? card.control/card.real : 1;
      const next=ds.__panelControlData.map(v=>v==null?null:Number(v)*factor);
      const nextSig=JSON.stringify(next);
      if(currentSig!==nextSig){ds.data=next;changed=true;}
      ds.__panelRenderedSig=nextSig;
    });
    if(changed||force) chart.update('none');
  }

  function applyAll(force=false){
    if(activeView()!=='tarjetas'||!window.Chart) return;
    const cards=readCardTable();
    if(!cards.length) return;
    ensureSelectors();
    enhanceCards(cards);
    applyCardsChart(cards,force);
    applyTrendChart(cards,force);
  }

  function schedule(delay=120,force=false){
    clearTimeout(timer);
    timer=setTimeout(()=>applyAll(force),delay);
  }

  document.addEventListener('click',event=>{
    if(event.target.closest('.nav-item,#refreshBtn,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters,.card-specific-option,.card-specific-clear,[data-card-line-mode],.currency-btn')){
      setTimeout(()=>schedule(140,false),40);
      setTimeout(()=>schedule(420,false),180);
    }
  },true);

  const root=document.getElementById('viewRoot');
  if(root) new MutationObserver(()=>schedule(100,false)).observe(root,{childList:true,subtree:false});

  if(!document.getElementById('cardLimitControlStyles')){
    const style=document.createElement('style');
    style.id='cardLimitControlStyles';
    style.textContent=`
      .card-limit-reference{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto;font-size:11px;color:#8fa0b6}
      .card-limit-reference>span{margin-right:2px}
      .card-limit-reference button{border:1px solid #2b3a4d;background:#111b28;color:#aeb9c8;border-radius:999px;padding:5px 9px;font:inherit;cursor:pointer}
      .card-limit-reference button.active{border-color:#26d07c;color:#e8fff3;background:#143225}
      .card-control-limit{margin:12px 0 4px;padding:10px 11px;border:1px solid #263548;border-radius:10px;background:#0d1622}
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

  schedule(260,true);
})();
