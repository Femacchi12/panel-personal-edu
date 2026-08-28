from pathlib import Path

path = Path("section-data-filters.js")
text = path.read_text()

old_decl = """  let backendCache = null;
  let backendCacheAt = 0;
  let lastView = null;
  let syncing = false;
"""
new_decl = """  let backendCache = null;
  let backendCacheAt = 0;
  const parsedRowsCache = new WeakMap();
  let lastView = null;
  let syncing = false;
"""
if old_decl not in text:
    raise SystemExit("declaration block not found")
text = text.replace(old_decl, new_decl, 1)

old_options = """  async function getOptions(def){
    if(Array.isArray(def.options)){
      return def.options.map(option=>typeof option==='string'?{value:option,label:option}:{value:String(option.value??''),label:String(option.label??option.value??'')});
    }
    const payload=await getBackendData(false),values=new Set();
    def.sources.forEach(source=>{
      parseRows(payload?.sources?.[sourceKey(source)]||[]).forEach(row=>{const value=pick(row,source.fields);if(value)values.add(value);});
    });
    return [...values].sort((a,b)=>a.localeCompare(b,'es',{numeric:true,sensitivity:'base'})).map(value=>({value,label:value}));
  }
"""
new_options = """  function parsedRowsFor(payload,key){
    if(!payload||typeof payload!=='object')return parseRows(payload?.sources?.[key]||[]);
    let cache=parsedRowsCache.get(payload);
    if(!cache){cache=new Map();parsedRowsCache.set(payload,cache);}
    if(!cache.has(key))cache.set(key,parseRows(payload?.sources?.[key]||[]));
    return cache.get(key);
  }

  async function getOptions(def,payload=null){
    if(Array.isArray(def.options)){
      return def.options.map(option=>typeof option==='string'?{value:option,label:option}:{value:String(option.value??''),label:String(option.label??option.value??'')});
    }
    const data=payload||await getBackendData(false),values=new Set();
    def.sources.forEach(source=>{
      parsedRowsFor(data,sourceKey(source)).forEach(row=>{const value=pick(row,source.fields);if(value)values.add(value);});
    });
    return [...values].sort((a,b)=>a.localeCompare(b,'es',{numeric:true,sensitivity:'base'})).map(value=>({value,label:value}));
  }
"""
if old_options not in text:
    raise SystemExit("getOptions block not found")
text = text.replace(old_options, new_options, 1)

old_render = """    // Resolver todas las opciones antes de tocar el DOM evita que los filtros
    // aparezcan uno por uno durante la primera entrada a una sección.
    bar.hidden=true;
    const optionSets=await Promise.all(conf.local.map(def=>getOptions(def).catch(()=>[])));
    if(activeView()!==view)return;
"""
new_render = """    // Resolver todas las opciones antes de tocar el DOM evita que los filtros
    // aparezcan uno por uno durante la primera entrada a una sección. El backend
    // se obtiene una sola vez y cada fuente se parsea una sola vez por payload.
    bar.hidden=true;
    const needsBackend=conf.local.some(def=>!Array.isArray(def.options)&&(def.sources||[]).length);
    const payload=needsBackend?await getBackendData(false):null;
    const optionSets=await Promise.all(conf.local.map(def=>getOptions(def,payload).catch(()=>[])));
    if(activeView()!==view)return;
"""
if old_render not in text:
    raise SystemExit("render option block not found")
text = text.replace(old_render, new_render, 1)

old_apply = """  async function applyLocalChange(view){
    setCurrentFilterState(view);
    if(view==='inversiones'){
      updateLocalControls(view);
      document.getElementById('investmentV2ModeFilter')?.remove();
      document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));
      return;
    }
    await renderSectionFilters(view);
    document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));
    const reload=window.__PANEL_RELOAD_DATA__;
    if(typeof reload==='function')await reload(false);
    else{
      const button=document.getElementById('refreshBtn');
      if(button&&!button.disabled)button.click();
    }
  }
"""
new_apply = """  async function applyLocalChange(view){
    setCurrentFilterState(view);
    updateLocalControls(view);
    document.querySelectorAll('#sectionFilterBar .local-multi-filter.open').forEach(root=>{
      root.classList.remove('open');
      root.querySelector('.local-trigger')?.setAttribute('aria-expanded','false');
    });
    if(view==='inversiones'){
      document.getElementById('investmentV2ModeFilter')?.remove();
      document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));
      return;
    }
    document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));
    const reload=window.__PANEL_RELOAD_DATA__;
    if(typeof reload==='function')await reload(false);
    else{
      const button=document.getElementById('refreshBtn');
      if(button&&!button.disabled)button.click();
    }
  }
"""
if old_apply not in text:
    raise SystemExit("applyLocalChange block not found")
text = text.replace(old_apply, new_apply, 1)

old_clear = """    if(event.target.closest('#clearFilters,#resetCurrentMonth')){
      const view=activeView();
      clearLocal(view);
      setTimeout(()=>{
        setCurrentFilterState(view);
        if(view==='inversiones')updateLocalControls(view);else renderSectionFilters(view);
        document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));
      },80);
    }
"""
new_clear = """    if(event.target.closest('#clearFilters,#resetCurrentMonth')){
      const view=activeView();
      clearLocal(view);
      setCurrentFilterState(view);
      setTimeout(()=>{
        updateLocalControls(view);
        document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));
      },80);
    }
"""
if old_clear not in text:
    raise SystemExit("global clear block not found")
text = text.replace(old_clear, new_clear, 1)

path.write_text(text)
