(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!financeId)return;

  let cards=[],cardsPromise=null,activeCardId='',uiFrame=0;
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';

  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const headers=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(row=>row?.some(v=>String(v??'').trim()!=='')).map(row=>Object.fromEntries(headers.map((header,index)=>[header||`Col ${index+1}`,row?.[index]??''])));}
  const cardId=card=>String(card?.['ID tarjeta']||'').trim();
  function cardLabel(card){const issuer=String(card?.Emisor||'Tarjeta').trim(),owner=String(card?.Titular||'').trim(),base=owner?`${issuer} · ${owner}`:issuer,duplicates=cards.filter(item=>norm(item?.Emisor)===norm(card?.Emisor)&&norm(item?.Titular)===norm(card?.Titular));return duplicates.length>1&&card?.Producto?`${base} · ${String(card.Producto).trim()}`:base;}
  const selectedCard=()=>cards.find(card=>cardId(card)===activeCardId)||null;

  async function loadCards(force=false){
    if(force){cards=[];cardsPromise=null;}
    if(cards.length)return cards;
    if(cardsPromise)return cardsPromise;
    cardsPromise=(async()=>{
      const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')return[];
      const payload=await getData(force);
      const values=payload?.sources?.[`${financeId}|Tarjetas!A:T`]||[];
      cards=parseRows(values).filter(card=>cardId(card)&&norm(card?.Activa||'sí')!=='no');
      return cards;
    })();
    try{return await cardsPromise;}finally{cardsPromise=null;}
  }

  function refreshCardsView(){
    if(activeView()!=='tarjetas')return;
    const reload=window.__PANEL_RELOAD_DATA__;
    if(typeof reload==='function'){
      Promise.resolve(reload(false)).catch(error=>console.error('No fue posible aplicar el filtro de tarjeta:',error));
      return;
    }
    const button=document.getElementById('refreshBtn');
    if(button&&!button.disabled)button.click();
  }

  function renderOptions(root){
    const signature=`${activeCardId}|${cards.map(card=>`${cardId(card)}:${cardLabel(card)}`).join('|')}`;
    if(root.dataset.signature===signature)return;
    root.dataset.signature=signature;
    const selected=selectedCard(),summary=root.querySelector('.card-specific-summary');
    if(summary)summary.textContent=selected?cardLabel(selected):'Todas';
    root.classList.toggle('has-selection',Boolean(selected));
    const box=root.querySelector('.card-specific-options');if(!box)return;
    box.innerHTML=cards.length?cards.map(card=>{const id=cardId(card),label=cardLabel(card),on=id===activeCardId;return`<button type="button" class="multi-filter-option card-specific-option${on?' selected':''}" data-card-id="${esc(id)}" data-label="${esc(label)}" aria-pressed="${on}"><span class="multi-filter-check">${on?'✓':''}</span><span>${esc(label)}</span></button>`;}).join(''):'<div class="multi-filter-empty">Sin tarjetas registradas</div>';
    box.querySelectorAll('.card-specific-option').forEach(button=>button.addEventListener('click',event=>{
      event.stopPropagation();
      const id=String(button.dataset.cardId||'');
      activeCardId=activeCardId===id?'':id;
      window.__PANEL_ACTIVE_CARD_ID__=activeCardId;
      root.dataset.signature='';
      renderOptions(root);
      root.classList.remove('open');
      root.querySelector('.card-specific-trigger')?.setAttribute('aria-expanded','false');
      document.dispatchEvent(new CustomEvent('panel:card-filter-changed',{detail:{cardId:activeCardId}}));
      refreshCardsView();
    }));
  }

  function wireSectionClear(bar){
    const button=bar.querySelector('#clearSectionFilters');
    if(!button||button.dataset.cardSpecificWired==='1')return;
    button.dataset.cardSpecificWired='1';
    button.addEventListener('click',()=>{
      activeCardId='';
      window.__PANEL_ACTIVE_CARD_ID__='';
      const root=bar.querySelector('[data-card-specific-filter]');
      if(root){root.dataset.signature='';renderOptions(root);}
      document.dispatchEvent(new CustomEvent('panel:card-filter-changed',{detail:{cardId:''}}));
    },true);
  }

  function ensureCardFilterUI(){
    if(activeView()!=='tarjetas')return;
    const bar=document.getElementById('sectionFilterBar');if(!bar||bar.hidden)return;
    const grid=bar.querySelector('.section-filter-grid');if(!grid)return;
    const oldHolder=grid.querySelector('[data-local-key="cardHolder"]');if(oldHolder)oldHolder.hidden=true;
    let root=grid.querySelector('[data-card-specific-filter]');
    if(!root){
      root=document.createElement('div');root.className='multi-filter local-multi-filter card-specific-filter';root.dataset.cardSpecificFilter='true';root.innerHTML=`<div class="filter-label-row"><span>Tarjeta de crédito</span><button type="button" class="filter-clear-one card-specific-clear">Limpiar</button></div><button type="button" class="multi-filter-trigger card-specific-trigger" aria-expanded="false"><span class="card-specific-summary">Todas</span><span class="filter-chevron">⌄</span></button><div class="multi-filter-menu card-specific-menu"><input class="multi-filter-search card-specific-search" placeholder="Buscar tarjeta…" autocomplete="off"><div class="multi-filter-options card-specific-options"></div></div>`;grid.prepend(root);
      root.querySelector('.card-specific-trigger')?.addEventListener('click',event=>{
        event.stopPropagation();
        root.classList.toggle('open');
        root.querySelector('.card-specific-trigger')?.setAttribute('aria-expanded',root.classList.contains('open')?'true':'false');
        if(root.classList.contains('open'))requestAnimationFrame(()=>root.querySelector('.card-specific-search')?.focus());
      });
      root.querySelector('.card-specific-search')?.addEventListener('input',event=>{const query=norm(event.target.value);root.querySelectorAll('.card-specific-option').forEach(button=>button.hidden=Boolean(query&&!norm(button.dataset.label).includes(query)));});
      root.querySelector('.card-specific-clear')?.addEventListener('click',event=>{
        event.stopPropagation();
        if(!activeCardId)return;
        activeCardId='';
        window.__PANEL_ACTIVE_CARD_ID__='';
        root.dataset.signature='';
        renderOptions(root);
        document.dispatchEvent(new CustomEvent('panel:card-filter-changed',{detail:{cardId:''}}));
        refreshCardsView();
      });
    }
    renderOptions(root);
    wireSectionClear(bar);
  }

  function scheduleUI(){
    if(uiFrame)return;
    uiFrame=requestAnimationFrame(()=>{uiFrame=0;ensureCardFilterUI();});
  }

  async function syncUI(){
    try{await loadCards(false);scheduleUI();}
    catch(error){console.error('No fue posible cargar el filtro de tarjetas:',error);}
  }

  document.addEventListener('panel:view-root-changed',event=>{if(event.detail?.view==='tarjetas')syncUI();});
  document.addEventListener('panel:backend-refresh-requested',()=>{cards=[];cardsPromise=null;});

  window.__PANEL_ACTIVE_CARD_ID__='';
  syncUI();
})();
