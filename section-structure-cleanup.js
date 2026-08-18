(() => {
  'use strict';

  let timer = null;
  let applying = false;

  const norm = value => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function panelTitle(panel) {
    return norm(panel?.querySelector?.('.panel-title strong')?.textContent || panel?.querySelector?.('strong')?.textContent || '');
  }

  function hideElement(el) {
    if (!el) return;
    if (!el.hidden) el.hidden = true;
    if (el.style.display !== 'none') el.style.display = 'none';
  }

  function showGrid(el) {
    if (!el) return;
    el.hidden = false;
    el.style.display = 'grid';
  }

  // TARJETAS: se elimina visualmente el grafico base "Uso por tarjeta".
  // El canvas se conserva en DOM como ancla tecnica para que Evolucion por tarjeta
  // pueda seguir creandose de forma estable en cada render del dashboard.
  function cleanCards(root) {
    if (activeView() !== 'tarjetas') return;
    root.querySelectorAll('.panel').forEach(panel => {
      if (panelTitle(panel) === 'uso por tarjeta') hideElement(panel);
    });
  }

  function isCorePensionGrid(el) {
    if (!el?.classList?.contains('kpi-grid')) return false;
    const text = norm(el.textContent);
    return text.includes('pension') && text.includes('cesantias') && text.includes('patrimonio') && text.includes('variacion');
  }

  // PENSION: resumen general primero; filtros V2 siguen gobernando grafico y tabla.
  function cleanPension(root) {
    if (activeView() !== 'pension') return;
    const head = root.querySelector('.section-head');
    if (!head) return;

    const coreGrid = [...root.children].find(isCorePensionGrid);
    const v2 = root.querySelector('#pensionV2');

    if (coreGrid) {
      showGrid(coreGrid);
      if (head.nextElementSibling !== coreGrid) head.insertAdjacentElement('afterend', coreGrid);
    }

    if (v2) {
      const duplicatedFilteredKpis = v2.querySelector(':scope > .v2-kpis');
      hideElement(duplicatedFilteredKpis);
      const anchor = coreGrid || head;
      if (anchor.nextElementSibling !== v2) anchor.insertAdjacentElement('afterend', v2);
    }
  }

  function tableColumnIndex(table, wanted) {
    const target = norm(wanted);
    return [...(table?.querySelectorAll('thead th') || [])].findIndex(th => norm(th.textContent) === target);
  }

  function rowsInfoFromPeriod(period) {
    const positionsPanel = [...(period?.querySelectorAll('.panel.table-panel') || [])]
      .find(panel => panelTitle(panel).includes('posiciones del periodo'));
    const table = positionsPanel?.querySelector('table');
    const result = {platforms: new Set(), categories: new Set(), dates: []};
    if (!table) return result;

    const platformIndex = tableColumnIndex(table, 'Plataforma / Bróker');
    const categoryIndex = tableColumnIndex(table, 'Categoría');
    const dateIndex = tableColumnIndex(table, 'Fecha');

    table.querySelectorAll('tbody tr').forEach(row => {
      if (platformIndex >= 0) {
        const value = String(row.cells[platformIndex]?.textContent || '').trim();
        if (value) result.platforms.add(value);
      }
      if (categoryIndex >= 0) {
        const value = String(row.cells[categoryIndex]?.textContent || '').trim();
        if (value) result.categories.add(value);
      }
      if (dateIndex >= 0) {
        const value = String(row.cells[dateIndex]?.textContent || '').trim();
        if (value) result.dates.push(value);
      }
    });
    return result;
  }

  function latestDate(values) {
    const parsed = values.map(value => {
      const text = String(value || '').trim();
      let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) return {value: text, time: new Date(+m[1], +m[2] - 1, +m[3]).getTime()};
      m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) return {value: text, time: new Date(+m[3], +m[2] - 1, +m[1]).getTime()};
      const d = new Date(text);
      return Number.isNaN(d.getTime()) ? null : {value: text, time: d.getTime()};
    }).filter(Boolean).sort((a, b) => b.time - a.time);
    return parsed[0]?.value || '—';
  }

  function selectedLocalLabel(key) {
    const values = [...document.querySelectorAll(`.local-multi-filter[data-local-key="${key}"] .local-option.selected`)]
      .map(el => String(el.dataset.label || el.dataset.value || el.textContent || '').trim())
      .filter(Boolean);
    return values.length === 1 ? values[0] : '';
  }

  function buildUnifiedInvestmentKpis(v2, period) {
    const original = v2?.querySelector(':scope > .v2-kpis');
    if (!original) return;
    const cards = [...original.children];
    const main = cards[0];
    if (!main) return;

    const modeLabel = String(main.querySelector('span')?.textContent || 'Portafolio').trim();
    const totalValue = String(main.querySelector('strong')?.textContent || '—').trim();
    const periodInfo = rowsInfoFromPeriod(period);

    const platformSelected = selectedLocalLabel('invPlatform');
    const categorySelected = selectedLocalLabel('invCategory') || selectedLocalLabel('invClass');
    const platformCount = periodInfo.platforms.size || Math.max(0, cards.length - 1);
    const categoryCount = periodInfo.categories.size;
    const cutDate = latestDate(periodInfo.dates);

    let unified = v2.querySelector('#investmentUnifiedKpis');
    if (!unified) {
      unified = document.createElement('div');
      unified.id = 'investmentUnifiedKpis';
      unified.className = 'v2-kpis investment-unified-kpis';
      v2.prepend(unified);
    }

    unified.innerHTML = `
      <div class="v2-kpi"><span>Portafolio</span><strong class="green">${totalValue}</strong><small>${modeLabel} · según filtros</small></div>
      <div class="v2-kpi"><span>Plataformas</span><strong>${platformCount || '—'}</strong><small>${platformSelected || 'Según filtros aplicados'}</small></div>
      <div class="v2-kpi"><span>Categorías</span><strong>${categoryCount || '—'}</strong><small>${categorySelected || 'Según filtros aplicados'}</small></div>
      <div class="v2-kpi"><span>Fecha corte</span><strong>${cutDate}</strong><small>Último corte disponible</small></div>`;

    hideElement(original);
  }

  function cleanInvestments(root) {
    if (activeView() !== 'inversiones') return;
    const head = root.querySelector('.section-head');
    const v2 = root.querySelector('#investmentV2');
    const period = root.querySelector('#investmentPeriodCorrected');
    const legacy = root.querySelector('#investmentCorrected');

    hideElement(legacy);

    if (v2 && head && head.nextElementSibling !== v2) head.insertAdjacentElement('afterend', v2);
    if (period && v2 && v2.nextElementSibling !== period) v2.insertAdjacentElement('afterend', period);

    // Datos de la tabla se leen antes de ocultarla para construir los KPIs unificados.
    if (v2) buildUnifiedInvestmentKpis(v2, period);

    // V2 es la unica fuente del grafico por plataforma, porque respeta Valor a mostrar.
    if (period) {
      const periodKpis = period.querySelector(':scope > .investment-kpis, :scope > .kpi-grid');
      hideElement(periodKpis);

      period.querySelectorAll('.panel').forEach(panel => {
        const title = panelTitle(panel);
        if (title === 'por plataforma' || title.includes('posiciones del periodo')) hideElement(panel);
      });
    }

    // Quitar la tabla Posiciones consolidadas de la capa V2.
    if (v2) {
      v2.querySelectorAll('.panel.table-panel').forEach(panel => {
        const title = panelTitle(panel);
        if (title.includes('posiciones consolidadas')) hideElement(panel);
      });
    }

    // Ocultar elementos base que ya tienen reemplazo consolidado.
    [...root.children].forEach(el => {
      if (el === v2 || el === period || el === head || el.id === 'investmentCorrected') return;
      if (el.classList?.contains('kpi-grid')) hideElement(el);
      if (el.classList?.contains('panel-grid')) {
        const titles = [...el.querySelectorAll('.panel-title strong')].map(x => norm(x.textContent));
        if (titles.some(t => t === 'por plataforma' || t === 'por categoria')) hideElement(el);
      }
      if (el.classList?.contains('table-panel')) {
        const title = panelTitle(el);
        if (title === 'posiciones' || title.includes('resumen de inversiones')) hideElement(el);
      }
    });
  }

  function apply() {
    if (applying) return;
    applying = true;
    try {
      const root = document.getElementById('viewRoot');
      if (!root) return;
      cleanCards(root);
      cleanPension(root);
      cleanInvestments(root);
    } finally {
      applying = false;
    }
  }

  function schedule(delay = 80) {
    clearTimeout(timer);
    timer = setTimeout(apply, delay);
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('.nav-item,.multi-filter-option,.local-option,.currency-btn,#refreshBtn,#clearFilters,#clearSectionFilters')) schedule(160);
  }, true);

  const root = document.getElementById('viewRoot');
  if (root) new MutationObserver(() => schedule(100)).observe(root, {childList: true, subtree: true});

  if (!document.getElementById('sectionStructureCleanupStyles')) {
    const style = document.createElement('style');
    style.id = 'sectionStructureCleanupStyles';
    style.textContent = `
      #investmentUnifiedKpis{margin:0}
      #investmentUnifiedKpis .v2-kpi strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #investmentV2>[hidden],#investmentPeriodCorrected>[hidden]{display:none!important}
      @media(max-width:720px){#investmentUnifiedKpis .v2-kpi strong{white-space:normal}}
    `;
    document.head.appendChild(style);
  }

  schedule(450);
})();