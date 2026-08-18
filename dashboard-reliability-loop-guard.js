(() => {
  'use strict';
  if (window.__PANEL_FLOW_TOTAL_GUARD__) return;
  window.__PANEL_FLOW_TOTAL_GUARD__ = true;

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
})();
