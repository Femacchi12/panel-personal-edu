(() => {
  'use strict';

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function injectStyles() {
    if (document.getElementById('servicesTableEnhancementStyles')) return;
    const style = document.createElement('style');
    style.id = 'servicesTableEnhancementStyles';
    style.textContent = `
      #rentalPaymentInfo{display:none!important}
      #viewRoot .services-table-observations-header{min-width:360px!important;width:360px!important}
      #viewRoot .services-table-observations-cell{min-width:360px!important;width:360px!important;max-width:480px!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;line-height:1.5!important;vertical-align:top!important}
      #viewRoot .services-table-observations-cell .rent-observation-line{display:block;white-space:normal}
      #viewRoot .services-table-observations-cell .rent-observation-line + .rent-observation-line{margin-top:4px;color:#aebccd}
      #viewRoot .services-table-observations-cell strong{color:#dce7f6;font-weight:700}
      @media(max-width:720px){#viewRoot .services-table-observations-header,#viewRoot .services-table-observations-cell{min-width:300px!important;width:300px!important;max-width:360px!important}}
    `;
    document.head.appendChild(style);
  }

  function findServicesTable(root) {
    return [...root.querySelectorAll('table')].find(table => {
      const headers = [...table.querySelectorAll('thead th')].map(th => norm(th.textContent));
      return headers.includes('servicio') && headers.includes('observaciones');
    }) || null;
  }

  function splitRentObservation(text) {
    const parts = String(text || '').trim().split('·').map(x => x.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    return { first: parts.slice(0, 2).join(' · '), second: parts.slice(2).join(' · ') };
  }

  function enhanceServicesTable() {
    if (activeView() !== 'servicios') return;
    const root = document.getElementById('viewRoot');
    const table = root && findServicesTable(root);
    if (!table) return;

    const headers = [...table.querySelectorAll('thead th')];
    const names = headers.map(th => norm(th.textContent));
    const serviceIndex = names.indexOf('servicio');
    const observationsIndex = names.indexOf('observaciones');
    if (serviceIndex < 0 || observationsIndex < 0) return;
    headers[observationsIndex]?.classList.add('services-table-observations-header');

    table.querySelectorAll('tbody tr').forEach(row => {
      const cells = [...row.children];
      const serviceCell = cells[serviceIndex];
      const observationsCell = cells[observationsIndex];
      if (!serviceCell || !observationsCell) return;
      observationsCell.classList.add('services-table-observations-cell');
      observationsCell.removeAttribute('title');
      if (norm(serviceCell.textContent) !== 'arriendo' || observationsCell.dataset.rentFormatted === '1') return;
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

  let timer = null;
  const schedule = (delay = 60) => {
    clearTimeout(timer);
    timer = setTimeout(enhanceServicesTable, delay);
  };

  injectStyles();
  const root = document.getElementById('viewRoot');
  if (root) new MutationObserver(() => schedule(50)).observe(root, { childList: true });
  schedule(0);
})();
