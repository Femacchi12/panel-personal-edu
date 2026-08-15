(() => {
  'use strict';

  const originalObserve = MutationObserver.prototype.observe;
  MutationObserver.prototype.observe = function(target, options) {
    if (target?.id === 'viewRoot' && options?.subtree) {
      return originalObserve.call(this, target, { ...options, subtree: false });
    }
    return originalObserve.call(this, target, options);
  };

  // La vista de Inversiones se complementa después del render principal.
  // Evitamos que ese complemento elimine y vuelva a insertar su contenedor
  // en #viewRoot, porque esa mutación vuelve a disparar el observador de la
  // propia sección y genera un ciclo de redibujado de Chart.js.
  const originalRemove = Element.prototype.remove;
  const originalInsertAdjacentElement = Element.prototype.insertAdjacentElement;
  const pendingAttribute = 'data-investment-replace-pending';

  Element.prototype.remove = function() {
    if (this.id === 'investmentCorrected' && this.parentElement?.id === 'viewRoot') {
      this.setAttribute(pendingAttribute, '1');
      return;
    }
    return originalRemove.call(this);
  };

  Element.prototype.insertAdjacentElement = function(position, element) {
    if (element?.id === 'investmentCorrected' && this.parentElement?.id === 'viewRoot') {
      const existing = this.parentElement.querySelector('#investmentCorrected');
      if (existing && existing !== element && existing.getAttribute(pendingAttribute) === '1') {
        existing.className = element.className;
        existing.innerHTML = element.innerHTML;
        existing.removeAttribute(pendingAttribute);
        return existing;
      }
    }
    return originalInsertAdjacentElement.call(this, position, element);
  };
})();
