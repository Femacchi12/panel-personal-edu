(() => {
  'use strict';

  const STORAGE_KEY = 'panel-personal-edu.include-monthly-projection';
  let frame = 0;
  let observer = null;
  let observedRoot = null;

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const activeCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';

  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c >= 0 && d >= 0) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (c >= 0) {
      const p = s.split(',');
      s = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g, '') + '.' + p[1] : s.replace(/,/g, '');
    } else if (d >= 0) {
      const p = s.split('.');
      if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function money(value, currency = activeCurrency()) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'USD' ? 2 : 0
    }).format(Number(value) || 0);
  }

  function percent(value) {
    return `${new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((Number(value) || 0) * 100)}%`;
  }

  function monthLabel(key) {
    const names = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
    const m = String(key || '').match(/^(20\d{2})-(\d{2})$/);
    return m ? `${names[+m[2] - 1]} ${m[1]}` : String(key || '');
  }

  function primaryGrid(root) {
    return [...root.querySelectorAll(':scope > .kpi-grid')].find(grid => {
      const labels = [...grid.querySelectorAll('.kpi-label')].map(el => norm(el.textContent));
      return labels.includes('egresos') && labels.some(label => label.includes('ingresos'));
    }) || null;
  }

  function cardByLabel(grid, test) {
    if (!grid) return null;
    return [...grid.querySelectorAll('.kpi-card')].find(card => test(norm(card.querySelector('.kpi-label')?.textContent))) || null;
  }

  function projectionOn() {
    const original = document.getElementById('monthlyProjectionToggle');
    if (original) return Boolean(original.checked);
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? Boolean(window.__PANEL_INCLUDE_MONTHLY_PROJECTION__) : stored === '1';
  }

  function setProjection(value) {
    const original = document.getElementById('monthlyProjectionToggle');
    if (original) {
      original.checked = Boolean(value);
      original.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    window.__PANEL_INCLUDE_MONTHLY_PROJECTION__ = Boolean(value);
    document.dispatchEvent(new CustomEvent('panel:monthly-projection-change', { detail: { enabled: Boolean(value) } }));
  }

  function hideDuplicateBlocks(root) {
    const primary = primaryGrid(root);
    if (primary) primary.hidden = true;
    const scope = root.querySelector(':scope > #flowScopeSummary');
    if (scope) scope.hidden = true;
    const financing = root.querySelector(':scope > #flowFinancingKpis');
    if (financing) financing.hidden = true;

    const originalSwitch = root.querySelector('#monthlyProjectionSuite .monthly-switch');
    if (originalSwitch) originalSwitch.style.display = 'none';
  }

  function readPrimary(root) {
    const grid = primaryGrid(root);
    const incomeCard = cardByLabel(grid, label => label.includes('ingresos'));
    const expenseCard = cardByLabel(grid, label => label === 'egresos');
    return {
      income: num(incomeCard?.querySelector('.kpi-value')?.textContent),
      incomeMeta: incomeCard?.querySelector('.kpi-meta span')?.textContent?.trim() || 'Ingreso regular de referencia',
      realExpense: num(expenseCard?.querySelector('.kpi-value')?.textContent)
    };
  }

  function toneFor(value, positive = true) {
    if (!Number.isFinite(value)) return '';
    if (positive) return value >= 0 ? 'positive' : 'critical';
    return value > 0 ? 'alert' : 'positive';
  }

  function item(label, value, meta = '', tone = '') {
    return `<div class="finance-context-item ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`;
  }

  function render(root) {
    if (activeView() !== 'flujo') return;
    const host = root.querySelector(':scope > .finance-context');
    const audit = window.__PANEL_FLOW_SCOPE_AUDIT__;
    if (!host || !audit?.key) return;

    hideDuplicateBlocks(root);

    const primary = readPrimary(root);
    const currency = activeCurrency();
    const on = projectionOn();
    const scope = audit.scope || 'Personal';
    const isPersonal = scope === 'Personal';
    const realExpense = primary.realExpense;
    const factor = audit.realTotal > 0 && realExpense > 0 ? realExpense / audit.realTotal : 1;
    const projectedExpense = audit.projectedTotal * factor;
    const expense = on ? projectedExpense : realExpense;
    const income = primary.income;
    const savings = isPersonal ? income - expense : NaN;
    const savingsRate = isPersonal && income ? savings / income : NaN;
    const target = income * 0.30;
    const gap = isPersonal ? savings - target : NaN;
    const label = monthLabel(audit.key);

    const previousState = host.querySelector('.finance-context-state')?.textContent?.trim() || (audit.key === (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })() ? 'En curso' : 'Cerrado');
    const stateTone = norm(previousState).includes('curso') ? 'warn' : '';

    host.dataset.unifiedFlowSummary = '1';
    host.innerHTML = `
      <div class="finance-context-head" data-unified-flow-summary>
        <div>
          <span>LECTURA DEL FLUJO · ${esc(label)}</span>
          <strong>${on ? 'Cierre esperado con proyección' : 'Seguimiento sobre gasto real'}</strong>
          <small>Ámbito ${esc(scope)}${scope === 'Personal' ? ' · FIBRAZO queda excluido del ahorro y de la meta personal.' : ' · ahorro y meta personal no aplican en este ámbito.'}</small>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end">
          <label class="monthly-switch" id="flowUnifiedProjectionSwitch">
            <input type="checkbox" id="flowUnifiedProjectionToggle" ${on ? 'checked' : ''}>
            <span></span><b>Incluir proyección al cierre</b>
          </label>
          <div class="finance-context-state ${stateTone}">${esc(previousState)}</div>
        </div>
      </div>
      <div class="finance-context-grid">
        ${item('Ingresos promedio', money(income, currency), `${primary.incomeMeta}${on ? ' · base del cierre proyectado' : ' · base del gasto real'}`, 'positive')}
        ${item('Egresos', money(expense, currency), on ? `Real + proyección pendiente + faltante recurrente · ${scope}` : `Solo gasto realizado · ${scope}`)}
        ${item(on ? 'Ahorro sobre gasto proyectado' : 'Ahorro sobre gasto real', isPersonal ? money(savings, currency) : '—', isPersonal ? `${percent(savingsRate)} del ingreso regular` : 'Disponible únicamente en ámbito Personal', isPersonal ? toneFor(savings, true) : '')}
        ${item('Brecha vs meta 30%', isPersonal ? money(gap, currency) : '—', isPersonal ? `Meta ${money(target, currency)} · ${on ? 'sobre cierre proyectado' : 'sobre gasto real'}` : 'La meta de ahorro aplica únicamente al ámbito Personal', isPersonal ? toneFor(gap, true) : '')}
      </div>`;

    host.querySelector('#flowUnifiedProjectionToggle')?.addEventListener('change', event => setProjection(event.target.checked));
  }

  function schedule() {
    if (activeView() !== 'flujo' || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const root = document.getElementById('viewRoot');
      if (!root || activeView() !== 'flujo') return;
      setTimeout(() => render(root), 70);
      observe(root);
    });
  }

  function observe(root) {
    if (root === observedRoot) return;
    observer?.disconnect();
    observedRoot = root;
    observer = new MutationObserver(mutations => {
      if (activeView() !== 'flujo') return;
      const needsRepair = mutations.some(mutation => {
        const target = mutation.target;
        if (!(target instanceof Element)) return false;
        if (target.matches('.finance-context')) return !target.querySelector('[data-unified-flow-summary]');
        return mutation.addedNodes && [...mutation.addedNodes].some(node => node instanceof Element && (node.matches?.('.finance-context,.kpi-grid,#flowScopeSummary,#flowFinancingKpis,#monthlyProjectionSuite') || node.querySelector?.('.finance-context,.kpi-grid,#flowScopeSummary,#flowFinancingKpis,#monthlyProjectionSuite')));
      });
      if (needsRepair) schedule();
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  [
    'panel:view-root-changed',
    'panel:section-modules-ready',
    'panel:filters-updated',
    'panel:payment-filters-changed',
    'panel:expense-scope-changed',
    'panel:monthly-projection-change',
    'panel:backend-data-loaded',
    'panel:flow-income-controller-applied',
    'panel:flow-matrix-v3-rendered'
  ].forEach(name => document.addEventListener(name, () => { if (activeView() === 'flujo') schedule(); }));

  document.addEventListener('click', event => {
    if (event.target.closest?.('.currency-btn')) setTimeout(schedule, 0);
  }, true);

  queueMicrotask(schedule);
})();