(() => {
  'use strict';

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  function activeView() {
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  function injectStyles() {
    if (document.getElementById('servicesTableEnhancementStyles')) return;
    const style = document.createElement('style');
    style.id = 'servicesTableEnhancementStyles';
    style.textContent = `
      /* El arriendo se consulta únicamente dentro de la tabla de Servicios. */
      #rentalPaymentInfo{display:none!important}

      #viewRoot .services-table-observations-header{
        min-width:360px!important;
        width:360px!important;
      }
      #viewRoot .services-table-observations-cell{
        min-width:360px!important;
        width:360px!important;
        max-width:480px!important;
        white-space:normal!important;
        overflow:visible!important;
        text-overflow:clip!important;
        line-height:1.5!important;
        vertical-align:top!important;
      }
      #viewRoot .services-table-observations-cell .rent-observation-line{
        display:block;
        white-space:normal;
      }
      #viewRoot .services-table-observations-cell .rent-observation-line + .rent-observation-line{
        margin-top:4px;
        color:#aebccd;
      }
      #viewRoot .services-table-observations-cell strong{
        color:#dce7f6;
        font-weight:700;
      }
      @media(max-width:720px){
        #viewRoot .services-table-observations-header,
        #viewRoot .services-table-observations-cell{
          min-width:300px!important;
          width:300px!important;
          max-width:360px!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function findServicesTable(root) {
    const tables = [...root.querySelectorAll('table')];
    return tables.find(table => {
      const headers = [...table.querySelectorAll('thead th')].map(th => norm(th.textContent));
      return headers.includes('servicio') && headers.includes('observaciones');
    }) || null;
  }

  function splitRentObservation(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const parts = raw.split('·').map(x => x.trim()).filter(Boolean);
    if (parts.length < 2) return null;

    const first = parts.slice(0, 2).join(' · ');
    const second = parts.slice(2).join(' · ');
    return { first, second };
  }

  function enhanceServicesTable() {
    injectStyles();
    if (activeView() !== 'servicios') return;

    const root = document.getElementById('viewRoot');
    if (!root) return;

    const table = findServicesTable(root);
    if (!table) return;

    const headers = [...table.querySelectorAll('thead th')];
    const headerNames = headers.map(th => norm(th.textContent));
    const serviceIndex = headerNames.indexOf('servicio');
    const observationsIndex = headerNames.indexOf('observaciones');
    if (serviceIndex < 0 || observationsIndex < 0) return;

    headers[observationsIndex]?.classList.add('services-table-observations-header');

    table.querySelectorAll('tbody tr').forEach(row => {
      const cells = [...row.children];
      const serviceCell = cells[serviceIndex];
      const observationsCell = cells[observationsIndex];
      if (!serviceCell || !observationsCell) return;

      observationsCell.classList.add('services-table-observations-cell');
      observationsCell.removeAttribute('title');

      if (norm(serviceCell.textContent) !== 'arriendo') return;
      if (observationsCell.dataset.rentFormatted === '1') return;

      const split = splitRentObservation(observationsCell.textContent);
      if (!split) return;

      observationsCell.textContent = '';
      const line1 = document.createElement('span');
      line1.className = 'rent-observation-line';
      line1.textContent = split.first;
      const line2 = document.createElement('span');
      line2.className = 'rent-observation-line';
      line2.textContent = split.second;
      observationsCell.append(line1, line2);
      observationsCell.dataset.rentFormatted = '1';
    });
  }

  function loadDashboardV2Enhancements() {
    if (document.querySelector('script[data-dashboard-v2]')) return;
    const script = document.createElement('script');
    script.src = `dashboard-v2-enhancements.js?v=${Date.now()}`;
    script.async = false;
    script.dataset.dashboardV2 = '1';
    script.onerror = error => console.error('No fue posible cargar dashboard-v2-enhancements.js', error);
    document.body.appendChild(script);
  }

  let timer = null;
  function schedule(delay = 60) {
    clearTimeout(timer);
    timer = setTimeout(enhanceServicesTable, delay);
  }

  document.addEventListener('click', event => {
    if (event.target.closest('.nav-item,.currency-btn,.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters,#refreshBtn')) {
      setTimeout(() => schedule(80), 40);
    }
  });

  const root = document.getElementById('viewRoot');
  if (root) {
    new MutationObserver(() => schedule(70)).observe(root, { childList: true, subtree:false });
  }

  loadDashboardV2Enhancements();
  schedule(0);
})();
