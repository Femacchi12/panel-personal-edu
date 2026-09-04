(() => {
  'use strict';

  const selected = new Set(['payroll','usd','extras']);

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .trim();

  const isIncomeView = () => norm(document.getElementById('viewTitle')?.textContent) === 'ingresos y ahorro';
  const allSelected = () => selected.size === 3;

  function typeForKpi(label) {
    const text = norm(label);
    if (text.includes('nomina colombia')) return 'payroll';
    if (text.includes('ingresos usd')) return 'usd';
    if (text.includes('extras / otros')) return 'extras';
    if (text.includes('total consolidado')) return 'total';
    return null;
  }

  function typeForPanel(title) {
    const text = norm(title);
    if (text === 'nomina colombia') return 'payroll';
    if (text === 'pagos recibidos en usd' || text === 'facturacion en usd') return 'usd';
    if (text === 'detalle de ingresos y extras') return 'extras';
    return null;
  }

  function panelByTitle(root,title) {
    const target = norm(title);
    return [...root.querySelectorAll('.panel')].find(panel =>
      norm(panel.querySelector('.panel-title strong')?.textContent) === target
    ) || null;
  }

  function ensureFilter(root) {
    const complete = root.querySelector('[data-income-complete]');
    if (!complete) return;
    let filter = document.getElementById('incomeTypeFilter');
    if (filter) {
      filter.hidden = false;
      return;
    }
    const host = document.getElementById('filterBar');
    if (!host) return;

    filter = document.createElement('div');
    filter.id = 'incomeTypeFilter';
    filter.className = 'income-type-filter';
    filter.innerHTML = `
      <div class="income-type-filter-head">
        <div>
          <span class="eyebrow">FILTRO DE INGRESOS</span>
          <strong>Qué ingresos quieres ver</strong>
          <small>Puedes seleccionar uno o combinar varios tipos.</small>
        </div>
        <button type="button" class="income-type-all" data-income-all>Ver todos</button>
      </div>
      <div class="income-type-options">
        <button type="button" class="income-type-option" data-income-type="payroll"><span class="income-type-check">✓</span><span><strong>Nómina COP</strong><small>Ingresos de nómina Colombia</small></span></button>
        <button type="button" class="income-type-option" data-income-type="usd"><span class="income-type-check">✓</span><span><strong>Fibrazo LLC · USD</strong><small>Pagos recibidos en dólares</small></span></button>
        <button type="button" class="income-type-option" data-income-type="extras"><span class="income-type-check">✓</span><span><strong>Extras</strong><small>Prima, devoluciones y otros ingresos</small></span></button>
      </div>`;
    host.appendChild(filter);

    filter.addEventListener('click',event => {
      if (event.target.closest('[data-income-all]')) {
        selected.clear();
        ['payroll','usd','extras'].forEach(type => selected.add(type));
        apply();
        return;
      }
      const button = event.target.closest('[data-income-type]');
      if (!button) return;
      const type = button.dataset.incomeType;
      if (selected.has(type)) {
        if (selected.size === 1) return;
        selected.delete(type);
      } else selected.add(type);
      apply();
    });
  }

  function updateButtons(root) {
    const filter = document.getElementById('incomeTypeFilter');
    if (!filter) return;
    filter.querySelectorAll('[data-income-type]').forEach(button => {
      const active = selected.has(button.dataset.incomeType);
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
      const check = button.querySelector('.income-type-check');
      if (check) check.textContent = active ? '✓' : '';
    });
    filter.querySelector('[data-income-all]')?.classList.toggle('active',allSelected());
  }

  function updateKpis(root) {
    root.querySelectorAll('[data-income-complete] .kpi-card').forEach(card => {
      const type = typeForKpi(card.querySelector('.kpi-label')?.textContent);
      if (!type) return;
      card.hidden = type === 'total' ? !allSelected() : !selected.has(type);
    });
  }

  function updatePanels(root) {
    root.querySelectorAll('[data-income-complete] .panel').forEach(panel => {
      if (panel.id === 'incomeTypeFilter') return;
      const type = typeForPanel(panel.querySelector('.panel-title strong')?.textContent);
      if (type) panel.hidden = !selected.has(type);
    });
  }

  function updateConceptColumns(root) {
    const table = panelByTitle(root,'Conceptos consolidados')?.querySelector('table');
    if (!table) return;
    const headers = [...table.querySelectorAll('thead th')];
    const rows = [...table.querySelectorAll('tbody tr')];
    headers.forEach((header,index) => {
      const text = norm(header.textContent);
      let visible = text === 'mes';
      if (text.includes('sueldo cop')) visible = selected.has('payroll');
      else if (text.includes('sueldo usd')) visible = selected.has('usd');
      else if (text.includes('total consolidado')) visible = allSelected();
      else if (text !== 'mes') visible = selected.has('extras');
      header.hidden = !visible;
      rows.forEach(row => { if (row.cells[index]) row.cells[index].hidden = !visible; });
    });
  }

  function updateExtrasRows(root) {
    const table = panelByTitle(root,'Detalle de ingresos y extras')?.querySelector('table');
    if (!table) return;
    const headers = [...table.querySelectorAll('thead th')].map(th => norm(th.textContent));
    const conceptIndex = headers.indexOf('concepto');
    const typeIndex = headers.indexOf('tipo');
    table.querySelectorAll('tbody tr').forEach(row => {
      const concept = conceptIndex >= 0 ? norm(row.cells[conceptIndex]?.textContent) : '';
      const type = typeIndex >= 0 ? norm(row.cells[typeIndex]?.textContent) : '';
      row.hidden = type.includes('ingreso laboral') || concept.includes('sueldo componente');
    });
  }

  function updateUsdRows(root) {
    const table = panelByTitle(root,'Pagos recibidos en USD')?.querySelector('table');
    if (!table) return;
    const headers = [...table.querySelectorAll('thead th')].map(th => norm(th.textContent));
    const originIndex = headers.indexOf('origen');
    if (originIndex < 0) return;
    table.querySelectorAll('tbody tr').forEach(row => {
      const origin = norm(row.cells[originIndex]?.textContent);
      row.hidden = Boolean(origin && !origin.includes('fibrazo llc'));
    });
  }

  function syncChart(root) {
    const canvas = root.querySelector('#incomeCompleteChart');
    if (!canvas || !window.Chart) return false;
    const chart = Chart.getChart?.(canvas);
    if (!chart) return false;
    chart.data.datasets.forEach(dataset => {
      const label = norm(dataset.label);
      if (label.includes('sueldo cop')) dataset.hidden = !selected.has('payroll');
      else if (label.includes('sueldo usd')) dataset.hidden = !selected.has('usd');
      else if (label.includes('extras / otros')) dataset.hidden = !selected.has('extras');
      else if (label.includes('total consolidado')) dataset.hidden = !allSelected();
    });
    chart.update('none');
    return true;
  }

  function updateChart(root,retry=0) {
    if (syncChart(root) || retry >= 3) return;
    requestAnimationFrame(() => {
      if (root.isConnected && isIncomeView()) updateChart(root,retry+1);
    });
  }

  function apply(root=document.getElementById('viewRoot')) {
    if (!root || !isIncomeView() || !root.querySelector('[data-income-complete]')) return;
    ensureFilter(root);
    updateButtons(root);
    updateKpis(root);
    updatePanels(root);
    updateConceptColumns(root);
    updateExtrasRows(root);
    updateUsdRows(root);
    updateChart(root);
  }

  function injectStyles() {
    if (document.getElementById('incomeTypeFilterStyles')) return;
    const style = document.createElement('style');
    style.id = 'incomeTypeFilterStyles';
    style.textContent = `
      .income-type-filter{margin-top:10px;padding-top:10px;border-top:1px solid var(--border-soft)}.income-type-filter[hidden]{display:none!important}.income-type-filter-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:11px}.income-type-filter-head>div{display:flex;flex-direction:column;gap:4px}.income-type-filter-head strong{font-size:12px;color:#e5edf7}.income-type-filter-head small{font-size:10px;color:#718098}.income-type-all{border:1px solid var(--border);background:#0e1621;color:#91a1b5;border-radius:9px;padding:7px 10px;font-size:10px;font-weight:700;cursor:pointer}.income-type-all.active{border-color:#285ca9;background:rgba(23,105,255,.14);color:#9abaff}.income-type-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.income-type-option{min-width:0;border:1px solid var(--border);background:#0e1520;border-radius:11px;padding:10px 11px;color:#9aa8ba;cursor:pointer;display:flex;align-items:center;gap:9px;text-align:left}.income-type-option.active{border-color:#285ca9;background:rgba(23,105,255,.11);color:#e4edfa;box-shadow:inset 2px 0 0 var(--blue)}.income-type-option>span:last-child{min-width:0;display:flex;flex-direction:column;gap:3px}.income-type-option strong{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.income-type-option small{font-size:9px;color:#6f8199;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.income-type-check{width:17px;min-width:17px;height:17px;border:1px solid #28415f;border-radius:5px;display:grid;place-items:center;color:#8eb5ff;font-size:11px;font-weight:800}.income-type-option.active .income-type-check{background:rgba(23,105,255,.16);border-color:#3567ad}@media(max-width:900px){.income-type-options{grid-template-columns:1fr}}@media(max-width:520px){.income-type-filter-head{align-items:flex-start;flex-direction:column}.income-type-all{width:100%}}`;
    document.head.appendChild(style);
  }

  injectStyles();
  document.addEventListener('panel:income-doc-rendered', () => apply());
  document.addEventListener('panel:income-regular-controller-applied', () => apply());
  document.addEventListener('panel:view-root-changed', () => {
    const filter = document.getElementById('incomeTypeFilter');
    if (filter) filter.hidden = !isIncomeView();
    if (isIncomeView()) queueMicrotask(() => apply());
  });
  queueMicrotask(() => apply());
})();
