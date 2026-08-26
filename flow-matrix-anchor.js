(() => {
  'use strict';

  let timer = null;
  let repairing = false;

  const norm = value => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function activeView(){
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  function ensureAnchor(){
    if (repairing || activeView() !== 'flujo') return;
    repairing = true;
    try {
      const root = document.getElementById('viewRoot');
      if (!root) return;

      const v3 = root.querySelector('#flowMatrixV3');
      if (v3) return;

      let base = [...root.querySelectorAll('.panel')].find(panel =>
        norm(panel.querySelector('.panel-title strong')?.textContent || panel.querySelector('strong')?.textContent) === 'matriz mensual por categoria'
      );

      if (!base) {
        base = document.createElement('div');
        base.id = 'flowMatrixAnchor';
        base.className = 'panel table-panel';
        base.dataset.flowMatrixAnchor = '1';
        base.style.display = 'none';
        base.innerHTML = '<div class="panel-header"><div class="panel-title"><strong>Matriz mensual por categoría</strong></div></div>';

        const projectionSuite = root.querySelector('#monthlyProjectionSuite');
        const flowSavings = [...root.querySelectorAll('.panel')].find(panel =>
          norm(panel.querySelector('.panel-title strong')?.textContent || '').includes('flujo y ahorro mensual')
        );
        const reference = projectionSuite || flowSavings;
        if (reference) reference.insertAdjacentElement('beforebegin', base);
        else root.appendChild(base);
      }

      // La v3 escucha este evento y vuelve a intentar el render usando el anclaje.
      document.dispatchEvent(new CustomEvent('panel:filters-updated', {detail:{view:'flujo', reason:'matrix-anchor'}}));
    } finally {
      repairing = false;
    }
  }

  function schedule(delay = 120){
    clearTimeout(timer);
    timer = setTimeout(ensureAnchor, delay);
  }

  document.addEventListener('click', event => {
    if (event.target.closest('.nav-item')) schedule(260);
    if (event.target.closest('#refreshBtn')) schedule(700);
  }, true);

  document.addEventListener('panel:flow-matrix-v3-rendered', () => {
    document.getElementById('flowMatrixAnchor')?.style.setProperty('display','none','important');
  });

  const root = document.getElementById('viewRoot');
  if (root) new MutationObserver(() => schedule(120)).observe(root, {childList:true, subtree:false});
  schedule(700);
})();
