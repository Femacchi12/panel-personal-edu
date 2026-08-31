(() => {
  'use strict';

  const degraded = new Map();
  let delegate = null;

  function activeView(){
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  function sourceKey(spreadsheetId, range){
    return `${spreadsheetId}|${range}`;
  }

  function notify(){
    document.dispatchEvent(new CustomEvent('panel:source-resilience-changed',{
      detail:{sources:[...degraded.entries()].map(([key,error])=>({key,error}))}
    }));
  }

  async function resilientGet(spreadsheetId, range, force=false){
    if(typeof delegate!=='function')throw new Error('Adaptador central no disponible');
    try{
      const values=await delegate(spreadsheetId, range, force);
      if(degraded.delete(sourceKey(spreadsheetId,range)))notify();
      return values;
    }catch(error){
      if(activeView()!=='general')throw error;
      const key=sourceKey(spreadsheetId,range);
      degraded.set(key,String(error?.message||error));
      console.warn('Visión general cargada con fuente parcial:',range,error);
      notify();
      return [];
    }
  }

  function installProperty(){
    const existing=window.__PANEL_GET_SOURCE_VALUES__;
    if(typeof existing==='function')delegate=existing;
    try{
      Object.defineProperty(window,'__PANEL_GET_SOURCE_VALUES__',{
        configurable:true,
        enumerable:true,
        get(){return resilientGet;},
        set(fn){if(fn!==resilientGet)delegate=fn;}
      });
    }catch(_){
      if(typeof existing==='function')window.__PANEL_GET_SOURCE_VALUES__=resilientGet;
    }
  }

  function labelFromKey(key){
    const range=String(key).split('|').pop()||key;
    return range.split('!')[0];
  }

  function paintWarning(){
    const root=document.getElementById('viewRoot');
    if(activeView()!=='general'||!root)return;
    root.querySelector('#generalSourceWarning')?.remove();
    if(!degraded.size)return;
    const box=document.createElement('div');
    box.id='generalSourceWarning';
    box.className='general-source-warning';
    const labels=[...degraded.keys()].map(labelFromKey);
    box.innerHTML=`<strong>Resumen cargado con datos parciales</strong><span>No estuvieron disponibles: ${labels.join(', ')}. El resto del panel sigue operativo y se completará al actualizar la fuente.</span>`;
    const dashboard=root.querySelector('[data-general-dashboard]');
    if(dashboard)dashboard.prepend(box);else root.prepend(box);
  }

  function ensureStyle(){
    if(document.getElementById('generalSourceWarningStyle'))return;
    const style=document.createElement('style');
    style.id='generalSourceWarningStyle';
    style.textContent='.general-source-warning{border:1px solid rgba(246,200,68,.28);background:rgba(246,200,68,.055);border-radius:12px;padding:10px 12px;display:grid;gap:3px;margin-bottom:12px}.general-source-warning strong{font-size:10px;color:#ffd36d}.general-source-warning span{font-size:9px;color:#9da9b8;line-height:1.45}';
    document.head.appendChild(style);
  }

  installProperty();
  ensureStyle();
  document.addEventListener('panel:source-resilience-changed',()=>requestAnimationFrame(paintWarning));
  document.addEventListener('panel:view-root-changed',()=>requestAnimationFrame(paintWarning));
})();
