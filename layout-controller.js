(() => {
  'use strict';

  const STORAGE_KEY='panel-personal-edu.sidebar-collapsed';
  const sidebar=()=>document.getElementById('sidebar');
  const button=()=>document.getElementById('sidebarToggle');

  function storedState(){
    try{
      const raw=localStorage.getItem(STORAGE_KEY);
      if(raw==='1')return true;
      if(raw==='0')return false;
    }catch(_){}
    return window.matchMedia?.('(max-width: 820px)').matches||false;
  }

  function persist(collapsed){
    try{localStorage.setItem(STORAGE_KEY,collapsed?'1':'0');}catch(_){}
  }

  function sync(collapsed,persistState=true){
    const bar=sidebar(),btn=button();
    if(!bar)return;
    bar.classList.toggle('collapsed',Boolean(collapsed));
    bar.setAttribute('aria-expanded',collapsed?'false':'true');
    document.body.classList.toggle('sidebar-collapsed',Boolean(collapsed));
    if(btn){
      btn.setAttribute('aria-label',collapsed?'Expandir menú':'Contraer menú');
      btn.setAttribute('title',collapsed?'Expandir menú':'Contraer menú');
      btn.textContent='‹';
    }
    if(persistState)persist(Boolean(collapsed));
    requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
  }

  function toggle(){
    const bar=sidebar();if(!bar)return;
    sync(!bar.classList.contains('collapsed'),true);
  }

  /* Capture the click before app.js' legacy bubble listener so the sidebar
     changes exactly once. This keeps backward compatibility without editing
     the large core file. */
  document.addEventListener('click',event=>{
    const btn=event.target.closest?.('#sidebarToggle');
    if(!btn)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    toggle();
  },true);

  document.addEventListener('keydown',event=>{
    if((event.key==='Enter'||event.key===' ')&&event.target?.id==='sidebarToggle'){
      event.preventDefault();event.stopPropagation();toggle();
    }
  },true);

  function boot(){sync(storedState(),false);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();

  window.__PANEL_SET_SIDEBAR_COLLAPSED__=value=>sync(Boolean(value),true);
})();
