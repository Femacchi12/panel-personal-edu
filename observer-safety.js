(() => {
  'use strict';
  const originalObserve = MutationObserver.prototype.observe;
  MutationObserver.prototype.observe = function(target, options) {
    if (target?.id === 'viewRoot' && options?.subtree) {
      return originalObserve.call(this, target, { ...options, subtree: false });
    }
    return originalObserve.call(this, target, options);
  };
})();
