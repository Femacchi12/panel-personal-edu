(() => {
  'use strict';
  if (window.__PANEL_RELIABILITY_GUARD__) return;
  window.__PANEL_RELIABILITY_GUARD__ = true;

  // Evita que el footer TOTAL se elimine y vuelva a crear en cada MutationObserver.
  const originalRemove = Element.prototype.remove;
  Element.prototype.remove = function(...args) {
    if (this?.matches?.('tfoot[data-auto-total]') && this.closest?.('#flowMatrixDetail')) return;
    return originalRemove.apply(this,args);
  };

  const originalAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function(child) {
    if (child?.nodeType === 1 && child.tagName === 'TFOOT' && child.dataset?.autoTotal === '1' && this?.nodeType === 1 && this.tagName === 'TABLE' && this.closest?.('#flowMatrixDetail')) {
      const existing=this.querySelector?.('tfoot[data-auto-total]');
      if (existing) return existing;
    }
    return originalAppendChild.call(this,child);
  };

  // El backend solo permite Authorization y Content-Type en CORS.
  // Ignoramos Cache-Control si algún módulo XHR intenta añadirlo.
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(name,value) {
    if (String(name||'').toLowerCase() === 'cache-control') return;
    return originalSetRequestHeader.call(this,name,value);
  };

  // Garantiza que Programados y Comparación permanezcan realmente al final
  // aunque otros módulos agreguen paneles después de la primera renderización.
  let endTimer=null;
  function enforceMonthlyPanelsAtEnd() {
    const view=document.querySelector('.nav-item.active')?.dataset.view||'';
    if(!['gastos','flujo'].includes(view))return;
    const root=document.getElementById('viewRoot');
    if(!root)return;
    const programmed=[...root.children].find(el=>el.classList?.contains('monthly-programmed-panel'));
    const comparison=[...root.children].find(el=>el.classList?.contains('monthly-comparison-panel'));
    if(!programmed||!comparison)return;
    const children=[...root.children];
    if(children.at(-2)===programmed && children.at(-1)===comparison)return;
    root.appendChild(programmed);
    root.appendChild(comparison);
  }
  function scheduleEnd(){clearTimeout(endTimer);endTimer=setTimeout(enforceMonthlyPanelsAtEnd,120);}
  const root=document.getElementById('viewRoot');
  if(root)new MutationObserver(scheduleEnd).observe(root,{childList:true});
  document.addEventListener('click',event=>{if(event.target.closest?.('.nav-item,#refreshBtn,#monthlyProjectionToggle'))scheduleEnd();},true);
})();
