from pathlib import Path


def replace_once(path, old, new):
    text = path.read_text(encoding='utf-8')
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'No se encontró bloque esperado en {path}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')

# 1) Card payment control: share backend cache and use the central view-root event.
path = Path('card-payment-control.js')
old = '''  async function getPayload(force=false) {
    if (!force && payloadPromise && Date.now() < cacheUntil) return payloadPromise;
    payloadPromise = (async()=>{
      const getIdToken = window.__PANEL_GET_ID_TOKEN__;
      if (typeof getIdToken !== 'function') throw new Error('Sesión Firebase no disponible');
      const token = await getIdToken(false);
      const response = await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if (!response.ok) throw new Error(`Backend ${response.status}`);
      return response.json();
    })();
    cacheUntil = Date.now() + 55_000;
    try { return await payloadPromise; }
    catch (error) { payloadPromise=null; cacheUntil=0; throw error; }
  }
'''
new = '''  async function getPayload(force=false) {
    if (typeof window.__PANEL_GET_BACKEND_DATA__ === 'function') return window.__PANEL_GET_BACKEND_DATA__(force);
    if (!force && payloadPromise && Date.now() < cacheUntil) return payloadPromise;
    payloadPromise = (async()=>{
      const getIdToken = window.__PANEL_GET_ID_TOKEN__;
      if (typeof getIdToken !== 'function') throw new Error('Sesión Firebase no disponible');
      const token = await getIdToken(false);
      const response = await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if (!response.ok) throw new Error(`Backend ${response.status}`);
      return response.json();
    })();
    cacheUntil = Date.now() + 55_000;
    try { return await payloadPromise; }
    catch (error) { payloadPromise=null; cacheUntil=0; throw error; }
  }
'''
replace_once(path, old, new)
old = '''  injectStyles();
  document.addEventListener('click',event=>{
    if (event.target.closest('.nav-item,.currency-btn,#refreshBtn,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters')) {
      if (event.target.closest('#refreshBtn')) { payloadPromise=null; cacheUntil=0; }
      setTimeout(()=>schedule(120),40);
    }
  });
  const root=document.getElementById('viewRoot');
  if(root) new MutationObserver(()=>schedule(100)).observe(root,{childList:true,subtree:false});
  schedule();
})();
'''
new = '''  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{
    if(event.detail?.view==='tarjetas')schedule(30);
  });
  document.addEventListener('panel:card-filter-changed',()=>schedule(40));
  document.addEventListener('panel:section-filters-changed',event=>{
    if(event.detail?.view==='tarjetas')schedule(40);
  });
  schedule();
})();
'''
replace_once(path, old, new)

# 2) ARQ/limit controller: consume the shared payload and remove its private observer.
path = Path('card-chart-personal-limit.js')
old = '''    debtPromise=(async()=>{
      const getIdToken=window.__PANEL_GET_ID_TOKEN__;
      if(typeof getIdToken!=='function') return null;
      const token=await getIdToken(false);
      if(!token) return null;
      const response=await fetch(`${apiBaseUrl}/api/data`,{
        headers:{Authorization:`Bearer ${token}`},cache:'no-store'
      });
      if(!response.ok) return null;
      const payload=await response.json();
      const rows=parseRows(payload?.sources?.[`${financeId}|Movimientos!A:Z`]||[]);
'''
new = '''    debtPromise=(async()=>{
      let payload=null;
      if(typeof window.__PANEL_GET_BACKEND_DATA__==='function'){
        payload=await window.__PANEL_GET_BACKEND_DATA__(force);
      }else{
        const getIdToken=window.__PANEL_GET_ID_TOKEN__;
        if(typeof getIdToken!=='function') return null;
        const token=await getIdToken(false);
        if(!token) return null;
        const response=await fetch(`${apiBaseUrl}/api/data`,{
          headers:{Authorization:`Bearer ${token}`},cache:'no-store'
        });
        if(!response.ok) return null;
        payload=await response.json();
      }
      const rows=parseRows(payload?.sources?.[`${financeId}|Movimientos!A:Z`]||[]);
'''
replace_once(path, old, new)
old = '''  document.addEventListener('click',event=>{
    if(event.target.closest('.nav-item,#refreshBtn,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters,.card-specific-option,.card-specific-clear,[data-card-line-mode],.currency-btn')){
      const force=Boolean(event.target.closest('#refreshBtn'));
      setTimeout(()=>schedule(140,force),40);
      setTimeout(()=>schedule(420,force),180);
    }
  },true);

  const root=document.getElementById('viewRoot');
  if(root) new MutationObserver(()=>schedule(100,false)).observe(root,{childList:true,subtree:false});
'''
new = '''  document.addEventListener('panel:view-root-changed',event=>{
    if(event.detail?.view==='tarjetas'){
      schedule(40,false);
      setTimeout(()=>schedule(180,false),80);
    }
  });
  document.addEventListener('panel:card-filter-changed',()=>schedule(50,false));
  document.addEventListener('panel:section-filters-changed',event=>{
    if(event.detail?.view==='tarjetas')schedule(50,false);
  });
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-card-line-mode]'))schedule(60,false);
  },true);
'''
replace_once(path, old, new)

# 3) Installment/payout panel: central render event replaces observer + generic click/change listeners.
path = Path('card-payments-installments.js')
old = '''  document.addEventListener('click',event=>{
    if(event.target.closest('.nav-item,.local-option,.local-clear,#clearSectionFilters,#refreshBtn')){
      clearTimeout(timer);timer=setTimeout(()=>render(!!event.target.closest('#refreshBtn')),180);
    }
  });
  document.addEventListener('change',()=>{clearTimeout(timer);timer=setTimeout(()=>render(false),150);});
  new MutationObserver(()=>{
    if(activeView()!=='tarjetas'||root.querySelector('#cardPaymentsInstallments'))return;
    clearTimeout(timer);timer=setTimeout(()=>render(false),120);
  }).observe(root,{childList:true,subtree:false});

  render(false).catch(console.error);
})();
'''
new = '''  function scheduleRender(delay=80,force=false){
    clearTimeout(timer);
    timer=setTimeout(()=>render(force).catch(console.error),delay);
  }
  document.addEventListener('panel:view-root-changed',event=>{
    if(event.detail?.view==='tarjetas')scheduleRender(60,false);
  });
  document.addEventListener('panel:card-filter-changed',()=>scheduleRender(70,false));
  document.addEventListener('panel:section-filters-changed',event=>{
    if(event.detail?.view==='tarjetas')scheduleRender(70,false);
  });

  render(false).catch(console.error);
})();
'''
replace_once(path, old, new)

# 4) Section filters: reuse the same backend promise rather than maintaining another API call/cache.
path = Path('section-data-filters.js')
old = '''  async function getBackendData(force=false){
    if(!force&&backendCache&&Date.now()-backendCacheAt<55_000)return backendCache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false); if(!token)throw new Error('Sesión Firebase no disponible');
    const response=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if(!response.ok)throw new Error(`Backend ${response.status}`);
    backendCache=await response.json(); backendCacheAt=Date.now(); return backendCache;
  }
'''
new = '''  async function getBackendData(force=false){
    if(typeof window.__PANEL_GET_BACKEND_DATA__==='function')return window.__PANEL_GET_BACKEND_DATA__(force);
    if(!force&&backendCache&&Date.now()-backendCacheAt<55_000)return backendCache;
    const token=await window.__PANEL_GET_ID_TOKEN__?.(false); if(!token)throw new Error('Sesión Firebase no disponible');
    const response=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if(!response.ok)throw new Error(`Backend ${response.status}`);
    backendCache=await response.json(); backendCacheAt=Date.now(); return backendCache;
  }
'''
replace_once(path, old, new)
