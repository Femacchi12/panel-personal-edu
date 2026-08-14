(() => {
  "use strict";

  const cfg = window.PANEL_CONFIG || {};
  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  const MONTH_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const state = {
    view: 'general',
    currency: cfg.primaryCurrency || 'COP',
    token: window.__PANEL_GOOGLE_ACCESS_TOKEN__ || null,
    data: emptyData(),
    filters: { year: [], month: [], category: [], subcategory: [], currency: [] },
    charts: [],
    expandedTables: new Set(),
    searches: {}
  };

  const viewMeta = {
    general:['PANEL PERSONAL','Visión general'],
    gastos:['FINANZAS','Gastos diarios'],
    flujo:['FINANZAS','Flujo mensual'],
    tarjetas:['FINANZAS','Tarjetas de crédito'],
    deudas:['FINANZAS','Deudas'],
    inversiones:['FINANZAS','Inversiones'],
    pension:['FINANZAS','Pensión y cesantías'],
    ingresos:['FINANZAS','Ingresos y ahorro'],
    servicios:['FINANZAS','Servicios y referencias'],
    salud:['SALUD','Resumen de salud'],
    citas:['SALUD','Citas médicas'],
    tratamientos:['SALUD','Tratamientos'],
    documentos:['VIDA','Documentos'],
    viajes:['VIDA','Vacaciones y viajes']
  };

  const ranges = {
    finance: [
      'Movimientos!A:Y',
      'Flujo_Mensual!A:Z',
      'Tarjetas!A:Z',
      'Cuotas!A:Z',
      'Resumen_Inversiones!A:Z',
      'Pensiones_Cesantias!A:Z',
      'Resumen_Ingresos!A:Z',
      'Flujo_Ahorro!A:Z',
      'Servicios!A:Z',
      'Documentos_Identidad!A:Z',
      'Documentos_Laborales!A:Z',
      'Documentos_Tributarios!A:Z',
      'Vacaciones_Viajes!A:Z'
    ],
    health: [
      'Pacientes!A:Z',
      'Citas_Medicas!A:Z',
      'Tratamientos!A:Z',
      'Estudios_Resultados!A:Z',
      'Eventos_Salud!A:Z',
      'Mediciones!A:Z',
      'Documentos!A:Z'
    ]
  };

  const filterOptions = {
    year: [],
    month: MONTH_LABELS.map((label, i) => ({ value: String(i + 1), label })),
    category: [],
    subcategory: [],
    currency: ['COP','USD','ARS'].map(x => ({value:x,label:x}))
  };

  init();

  async function init() {
    try {
      bindUI();
      resetCurrentMonth(false);
      renderFilterOptions();
      render();
      if (!state.token) {
        setSync('demo','Sesión sin token de Sheets');
        return;
      }
      await loadLiveData();
      const minutes = Math.max(1, Number(cfg.autoRefreshMinutes || 5));
      window.__PANEL_DATA_TIMER__ = window.setInterval(() => loadLiveData(false), minutes * 60 * 1000);
    } catch (error) {
      showFatal(error);
    }
  }

  function bindUI() {
    byId('sidebarToggle')?.addEventListener('click', () => byId('sidebar')?.classList.toggle('collapsed'));

    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        state.view = btn.dataset.view || 'general';
        document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x === btn));
        render();
      });
    });

    document.querySelectorAll('.currency-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.currency = btn.dataset.currency || 'COP';
        document.querySelectorAll('.currency-btn').forEach(x => x.classList.toggle('active', x === btn));
        render();
      });
    });

    document.querySelectorAll('[data-filter-trigger]').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        const key = btn.dataset.filterTrigger;
        const root = document.querySelector(`.multi-filter[data-filter="${key}"]`);
        const opening = !root?.classList.contains('open');
        closeFilterMenus();
        if (root && opening) {
          root.classList.add('open');
          btn.setAttribute('aria-expanded','true');
          const search = root.querySelector('[data-filter-search]');
          if (search) {
            search.value = '';
            filterFilterOptions(key, '');
            setTimeout(() => search.focus(), 0);
          }
        }
      });
    });

    document.querySelectorAll('[data-filter-search]').forEach(input => {
      input.addEventListener('input', () => filterFilterOptions(input.dataset.filterSearch, input.value));
      input.addEventListener('click', e => e.stopPropagation());
    });

    document.querySelectorAll('[data-clear-filter]').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        const key = btn.dataset.clearFilter;
        state.filters[key] = [];
        updateFilterControl(key);
        render();
      });
    });

    byId('resetCurrentMonth')?.addEventListener('click', () => resetCurrentMonth(true));
    byId('clearFilters')?.addEventListener('click', () => {
      Object.keys(state.filters).forEach(k => state.filters[k] = []);
      updateAllFilterControls();
      render();
    });
    byId('refreshBtn')?.addEventListener('click', () => loadLiveData(true));
    document.addEventListener('click', event => {
      if (!event.target.closest('.multi-filter')) closeFilterMenus();
    });
  }

  async function loadLiveData(showAlerts = true) {
    if (!state.token) {
      setSync('demo','Sin autorización de Google Sheets');
      return;
    }
    const refresh = byId('refreshBtn');
    if (refresh) refresh.disabled = true;
    setSync('loading','Actualizando Sheets…');

    try {
      const [finance, health] = await Promise.all([
        batchGet(cfg.financeSpreadsheetId, ranges.finance),
        batchGet(cfg.healthSpreadsheetId, ranges.health)
      ]);
      state.data = normalizeLive(finance, health);
      hydrateFilterOptions();
      setSync('ok', `Sincronizado · ${new Intl.DateTimeFormat('es-CO',{hour:'2-digit',minute:'2-digit'}).format(new Date())}`);
      render();
    } catch (error) {
      console.error('Error leyendo Sheets:', error);
      setSync('demo','Error de sincronización');
      if (showAlerts) alert('No pude leer los Sheets. Verifica que la cuenta tenga acceso a Finanzas Edu y Salud - Familia.');
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  async function batchGet(id, sheetRanges) {
    if (!id) throw new Error('Falta spreadsheet ID');
    const q = sheetRanges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values:batchGet?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&${q}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    return response.json();
  }

  function normalizeLive(finance, health) {
    const f = mapRanges(finance);
    const h = mapRanges(health);
    return {
      movimientos: parseRows(f.Movimientos),
      flujo: parseRowsSmart(f.Flujo_Mensual),
      tarjetas: parseRowsSmart(f.Tarjetas),
      cuotas: parseRowsSmart(f.Cuotas),
      inversiones: parseRowsSmart(f.Resumen_Inversiones),
      pension: parseRowsSmart(f.Pensiones_Cesantias),
      ingresos: parseRowsSmart(f.Resumen_Ingresos),
      ahorro: parseRowsSmart(f.Flujo_Ahorro),
      servicios: parseRowsSmart(f.Servicios),
      documentos: [
        ...parseRowsSmart(f.Documentos_Identidad),
        ...parseRowsSmart(f.Documentos_Laborales),
        ...parseRowsSmart(f.Documentos_Tributarios),
        ...parseRowsSmart(h.Documentos)
      ],
      viajes: parseRowsSmart(f.Vacaciones_Viajes),
      pacientes: parseRowsSmart(h.Pacientes),
      citas: parseRowsSmart(h.Citas_Medicas),
      tratamientos: parseRowsSmart(h.Tratamientos),
      estudios: parseRowsSmart(h.Estudios_Resultados),
      eventosSalud: parseRowsSmart(h.Eventos_Salud),
      mediciones: parseRowsSmart(h.Mediciones)
    };
  }

  function mapRanges(payload) {
    const out = {};
    (payload?.valueRanges || []).forEach(item => {
      const name = String(item.range || '').split('!')[0].replaceAll("'",'');
      out[name] = item.values || [];
    });
    return out;
  }

  function parseRows(values, headerIndex = 0) {
    if (!Array.isArray(values) || !values.length || !values[headerIndex]) return [];
    const headers = values[headerIndex].map(v => String(v || '').trim());
    if (!headers.some(Boolean)) return [];
    return values.slice(headerIndex + 1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((h, i) => [h || `Col ${i+1}`, row?.[i] ?? ''])));
  }

  function parseRowsSmart(values) {
    if (!Array.isArray(values) || !values.length) return [];
    let bestIndex = 0;
    let bestScore = -1;
    for (let i = 0; i < Math.min(values.length, 12); i++) {
      const row = values[i] || [];
      const nonEmpty = row.filter(v => String(v ?? '').trim() !== '').length;
      const textual = row.filter(v => typeof v === 'string' && /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(v)).length;
      const score = nonEmpty * 2 + textual;
      if (nonEmpty >= 2 && score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return parseRows(values, bestIndex);
  }

  function hydrateFilterOptions() {
    const mov = state.data.movimientos || [];
    const years = new Set();
    const cats = new Set();
    const subs = new Set();

    mov.forEach(row => {
      const d = movementDate(row);
      if (d) years.add(String(d.getFullYear()));
      const c = pick(row,['Categoría','Categoria']);
      const s = pick(row,['Subcategoría','Subcategoria']);
      if (c) cats.add(c);
      if (s) subs.add(s);
    });

    years.add(String(new Date().getFullYear()));
    filterOptions.year = [...years].sort((a,b)=>Number(b)-Number(a)).map(v => ({value:v,label:v}));
    filterOptions.category = [...cats].sort(localeSort).map(v => ({value:v,label:v}));
    filterOptions.subcategory = [...subs].sort(localeSort).map(v => ({value:v,label:v}));
    renderFilterOptions();
  }

  function renderFilterOptions() {
    Object.keys(filterOptions).forEach(key => {
      const box = document.querySelector(`[data-filter-options="${key}"]`);
      if (!box) return;
      const items = filterOptions[key] || [];
      box.innerHTML = items.length ? items.map(item => {
        const selected = state.filters[key]?.includes(String(item.value));
        return `<button type="button" class="multi-filter-option${selected?' selected':''}" data-value="${esc(item.value)}" data-label="${esc(item.label)}" aria-pressed="${selected}">
          <span class="multi-filter-check">${selected?'✓':''}</span><span>${esc(item.label)}</span>
        </button>`;
      }).join('') : '<div class="multi-filter-empty">Sin opciones</div>';

      box.querySelectorAll('.multi-filter-option').forEach(btn => {
        btn.addEventListener('click', event => {
          event.stopPropagation();
          toggleFilterValue(key, btn.dataset.value);
        });
      });
      updateFilterControl(key);
    });
  }

  function toggleFilterValue(key, value) {
    const list = state.filters[key] || [];
    const idx = list.indexOf(value);
    if (idx >= 0) list.splice(idx,1);
    else list.push(value);
    state.filters[key] = list;
    renderFilterOptionsForKey(key);
    render();
  }

  function renderFilterOptionsForKey(key) {
    const box = document.querySelector(`[data-filter-options="${key}"]`);
    if (!box) return;
    box.querySelectorAll('.multi-filter-option').forEach(btn => {
      const selected = state.filters[key]?.includes(btn.dataset.value);
      btn.classList.toggle('selected', !!selected);
      btn.setAttribute('aria-pressed', String(!!selected));
      const check = btn.querySelector('.multi-filter-check');
      if (check) check.textContent = selected ? '✓' : '';
    });
    updateFilterControl(key);
  }

  function updateAllFilterControls() {
    Object.keys(filterOptions).forEach(updateFilterControl);
    renderFilterOptions();
  }

  function updateFilterControl(key) {
    const selected = state.filters[key] || [];
    const summary = document.querySelector(`[data-filter-summary="${key}"]`);
    const root = document.querySelector(`.multi-filter[data-filter="${key}"]`);
    if (root) root.classList.toggle('has-selection', selected.length > 0);
    if (!summary) return;
    if (!selected.length) {
      summary.textContent = ['category','subcategory','currency'].includes(key) ? 'Todas' : 'Todos';
    } else if (selected.length === 1) {
      summary.textContent = filterLabel(key, selected[0]);
    } else {
      summary.textContent = `${selected.length} seleccionados`;
    }
  }

  function filterLabel(key, value) {
    const item = (filterOptions[key] || []).find(x => String(x.value) === String(value));
    return item?.label || value;
  }

  function filterFilterOptions(key, query) {
    const q = norm(query);
    document.querySelectorAll(`[data-filter-options="${key}"] .multi-filter-option`).forEach(btn => {
      btn.hidden = !!q && !norm(btn.dataset.label || btn.dataset.value).includes(q);
    });
  }

  function closeFilterMenus() {
    document.querySelectorAll('.multi-filter.open').forEach(root => {
      root.classList.remove('open');
      root.querySelector('[data-filter-trigger]')?.setAttribute('aria-expanded','false');
    });
  }

  function resetCurrentMonth(doRender = true) {
    const now = new Date();
    state.filters.year = [String(now.getFullYear())];
    state.filters.month = [String(now.getMonth() + 1)];
    state.filters.category = [];
    state.filters.subcategory = [];
    state.filters.currency = [];
    updateAllFilterControls();
    if (doRender) render();
  }

  function render() {
    destroyCharts();
    const [eye,title] = viewMeta[state.view] || viewMeta.general;
    if (byId('viewEyebrow')) byId('viewEyebrow').textContent = eye;
    if (byId('viewTitle')) byId('viewTitle').textContent = title;

    const root = byId('viewRoot');
    if (!root) return;
    const fn = {
      general: renderGeneral,
      gastos: renderGastos,
      flujo: renderFlujo,
      tarjetas: renderTarjetas,
      deudas: renderDeudas,
      inversiones: renderInversiones,
      pension: renderPension,
      ingresos: renderIngresos,
      servicios: renderServicios,
      salud: renderSalud,
      citas: renderCitas,
      tratamientos: renderTratamientos,
      documentos: renderDocumentos,
      viajes: renderViajes
    }[state.view] || renderGeneral;

    root.innerHTML = fn();
    bindDynamic();
  }

  function renderGeneral() {
    const mov = filteredMovements();
    const expenses = mov.filter(isExpense);
    const total = expenses.reduce((sum,row) => sum + movementAmount(row), 0);
    const paid = expenses.filter(row => !isFinanced(row)).reduce((sum,row) => sum + movementAmount(row), 0);
    const debt = expenses.filter(isFinanced).reduce((sum,row) => sum + movementAmount(row), 0);
    const income = selectedIncome();

    const byCategory = aggregate(expenses, row => pick(row,['Categoría','Categoria']) || 'Sin categoría', movementAmount);
    const topCats = [...byCategory.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
    const max = topCats[0]?.[1] || 1;

    return `${sectionHead('RESUMEN','Tu mes en una sola vista','Información calculada con los filtros globales aplicados')}
      <div class="kpi-grid">
        ${kpi('Total gastado', money(total), `${expenses.length} movimientos`)}
        ${kpi('Pagado', money(paid), 'Efectivo/débito y no financiado','green')}
        ${kpi('En deuda', money(debt), 'Tarjetas y compras financiadas','gold')}
        ${kpi('Ingresos', money(income), 'Período seleccionado','blue')}
      </div>
      <div class="panel-grid">
        <div class="panel">
          <div class="panel-header"><div class="panel-title"><strong>Gastos por categoría</strong><span>Top del período seleccionado</span></div></div>
          <div class="progress-list">
            ${topCats.length ? topCats.map(([label,value]) => progress(label,value,max)).join('') : empty('Sin gastos para los filtros seleccionados')}
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><div class="panel-title"><strong>Últimos movimientos</strong><span>Registros más recientes del período</span></div></div>
          <div class="card-list">${latestMovementCards(expenses.slice().sort((a,b)=>dateValue(b)-dateValue(a)).slice(0,6))}</div>
        </div>
      </div>`;
  }

  function renderGastos() {
    const rows = filteredMovements().filter(isExpense);
    return `${sectionHead('FINANZAS','Detalle de gastos','Filtros globales aplicados a movimientos y gráficos')}
      <div class="panel">
        <div class="panel-header"><div class="panel-title"><strong>Evolución de gastos</strong><span>Comparación por categoría/subcategoría</span></div></div>
        ${chartShell('spendChart', Math.max(760, periodCount(rows)*90))}
      </div>
      ${tablePanel('Movimientos', rows, [
        'Fecha real','Tipo','Categoría','Subcategoría','Descripción / Comercio','Monto original','Moneda original','Cuenta / Tarjeta','Titular','Cuotas','N° cuota','Estado','Monto COP','Monto ARS','Monto USD'
      ])}`;
  }

  function renderFlujo() {
    const rows = filterRowsByPeriod(state.data.ahorro?.length ? state.data.ahorro : state.data.flujo);
    return `${sectionHead('FINANZAS','Flujo mensual','Ingresos, egresos y ahorro por período')}
      <div class="panel">
        <div class="panel-header"><div class="panel-title"><strong>Evolución mensual</strong><span>Ingresos vs egresos vs ahorro</span></div></div>
        ${chartShell('flowChart', Math.max(760, rows.length*90))}
      </div>
      ${tablePanel('Detalle mensual', rows)}`;
  }

  function renderTarjetas() {
    const rows = state.data.tarjetas || [];
    return `${sectionHead('FINANZAS','Tarjetas de crédito','Cupo, uso, período de facturación y próximo pago')}
      <div class="credit-grid">${rows.length ? rows.map(creditCard).join('') : empty('No hay tarjetas registradas')}</div>
      ${tablePanel('Detalle de tarjetas', rows)}`;
  }

  function renderDeudas() {
    const rows = (state.data.cuotas || []).filter(row => !/pagad[ao]/i.test(pick(row,['Estado']) || ''));
    const total = rows.reduce((sum,row) => sum + num(pick(row,['Saldo pendiente','Saldo Pendiente','Saldo','Valor pendiente'])), 0);
    return `${sectionHead('FINANZAS','Deudas y cuotas','Compras financiadas pendientes')}
      <div class="kpi-grid">
        ${kpi('Saldo pendiente', money(total), 'Total registrado')}
        ${kpi('Compras activas', String(rows.length), 'Registros pendientes')}
      </div>
      ${tablePanel('Cuotas pendientes', rows)}`;
  }

  function renderInversiones() {
    const rows = filterRowsByPeriod(state.data.inversiones || []);
    const total = rows.reduce((sum,row) => sum + num(pick(row,['Valor mercado','Valor Mercado','Saldo','Valor','Total'])), 0);
    return `${sectionHead('FINANZAS','Inversiones','Posiciones consolidadas por plataforma')}
      <div class="kpi-grid">${kpi('Valor consolidado', money(total), `${rows.length} posiciones`)}</div>
      ${tablePanel('Detalle de inversiones', rows)}`;
  }

  function renderPension() {
    const rows = filterRowsByPeriod(state.data.pension || []);
    return `${sectionHead('FINANZAS','Pensión y cesantías','Evolución de saldos y aportes')}
      <div class="panel">
        <div class="panel-header"><div class="panel-title"><strong>Evolución</strong><span>Saldos históricos</span></div></div>
        ${chartShell('pensionChart', Math.max(760, rows.length*90))}
      </div>
      ${tablePanel('Histórico', rows)}`;
  }

  function renderIngresos() {
    const rows = filterRowsByPeriod(state.data.ingresos || []);
    const ahorro = filterRowsByPeriod(state.data.ahorro || []);
    const total = rows.reduce((sum,row) => sum + incomeAmount(row), 0);
    const last = ahorro[ahorro.length-1] || {};
    return `${sectionHead('FINANZAS','Ingresos y ahorro','Histórico, tasa de ahorro y cumplimiento')}
      <div class="kpi-grid">
        ${kpi('Ingresos seleccionados', money(total), `${rows.length} períodos`,'green')}
        ${kpi('Ahorro acumulado', money(num(pick(last,['Ahorro acumulado COP','Ahorro acumulado','Ahorro real COP']))), 'Último período')}
        ${kpi('Tasa de ahorro', pick(last,['Tasa de ahorro real','Tasa ahorro','% ahorro']) || '—', 'Último período','gold')}
        ${kpi('Meta', pick(last,['Meta de ahorro','Meta']) || '—', 'Objetivo')}
      </div>
      <div class="panel">
        <div class="panel-header"><div class="panel-title"><strong>Evolución de ingresos</strong><span>Períodos disponibles</span></div></div>
        ${chartShell('incomeChart', Math.max(760, rows.length*90))}
      </div>
      ${tablePanel('Resumen de ingresos', rows)}`;
  }

  function renderServicios() {
    const rows = filterRowsByPeriod(state.data.servicios || []);
    return `${sectionHead('FINANZAS','Servicios y referencias','Estado mensual y próximos vencimientos')}
      ${tablePanel('Servicios', rows)}`;
  }

  function renderSalud() {
    const d = state.data;
    const citas = filterRowsByPeriod(d.citas || []);
    const estudios = filterRowsByPeriod(d.estudios || []);
    return `${sectionHead('SALUD','Resumen de salud','Familia, citas, tratamientos y estudios')}
      <div class="kpi-grid">
        ${kpi('Pacientes', String((d.pacientes||[]).length), 'Perfiles registrados')}
        ${kpi('Citas', String(citas.length), 'Según filtros de período')}
        ${kpi('Tratamientos', String((d.tratamientos||[]).length), 'Registros')}
        ${kpi('Estudios', String(estudios.length), 'Resultados')}
      </div>
      <div class="panel-grid equal">
        <div class="panel">
          <div class="panel-header"><div class="panel-title"><strong>Pacientes</strong><span>Personas y mascotas</span></div></div>
          <div class="card-list">${patientCards(d.pacientes||[])}</div>
        </div>
        <div class="panel">
          <div class="panel-header"><div class="panel-title"><strong>Últimos estudios</strong><span>Resultados registrados</span></div></div>
          <div class="card-list">${studyCards(estudios.slice().sort((a,b)=>rowDateValue(b)-rowDateValue(a)).slice(0,6))}</div>
        </div>
      </div>`;
  }

  function renderCitas() {
    return `${sectionHead('SALUD','Citas médicas','Histórico y próximas citas')}${tablePanel('Citas', filterRowsByPeriod(state.data.citas || []))}`;
  }

  function renderTratamientos() {
    return `${sectionHead('SALUD','Tratamientos','Medicamentos, indicaciones y seguimiento')}${tablePanel('Tratamientos', filterRowsByPeriod(state.data.tratamientos || []))}`;
  }

  function renderDocumentos() {
    return `${sectionHead('VIDA','Documentos','Financieros, laborales, identidad y salud')}${tablePanel('Índice documental', filterRowsByPeriod(state.data.documentos || []))}`;
  }

  function renderViajes() {
    return `${sectionHead('VIDA','Vacaciones y viajes','Planificación, presupuesto y seguimiento')}${tablePanel('Viajes', filterRowsByPeriod(state.data.viajes || []))}`;
  }

  function bindDynamic() {
    document.querySelectorAll('[data-search-table]').forEach(input => {
      input.addEventListener('input', () => {
        const id = input.dataset.searchTable;
        state.searches[id] = input.value || '';
        applyTableSearch(id);
      });
    });

    document.querySelectorAll('[data-toggle-table]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.toggleTable;
        if (state.expandedTables.has(id)) state.expandedTables.delete(id);
        else state.expandedTables.add(id);
        const body = byId(id)?.querySelector('tbody');
        if (body) updateTableVisibility(id);
        btn.textContent = state.expandedTables.has(id) ? 'Ver menos' : 'Ver más';
      });
    });

    if (state.view === 'gastos') drawSpendChart();
    if (state.view === 'flujo') drawFlowChart();
    if (state.view === 'pension') drawPensionChart();
    if (state.view === 'ingresos') drawIncomeChart();
  }

  function drawSpendChart() {
    const rows = filteredMovements().filter(isExpense).slice().sort((a,b)=>dateValue(a)-dateValue(b));
    const canvas = byId('spendChart');
    if (!canvas || !window.Chart) return;

    const groupKey = state.filters.subcategory.length ? 'subcategory' : 'category';
    const selectedGroups = groupKey === 'subcategory' ? state.filters.subcategory : state.filters.category;
    const periods = unique(rows.map(row => periodKey(movementDate(row))).filter(Boolean)).sort();
    let groups = selectedGroups.length ? selectedGroups.slice() : [...new Set(rows.map(row => groupKey === 'subcategory'
      ? pick(row,['Subcategoría','Subcategoria']) || 'Sin subcategoría'
      : pick(row,['Categoría','Categoria']) || 'Sin categoría'
    ))].slice(0,8);

    if (!groups.length) groups = ['Total'];
    const datasets = groups.map(group => ({
      label: group,
      data: periods.map(period => rows
        .filter(row => periodKey(movementDate(row)) === period)
        .filter(row => group === 'Total' || (groupKey === 'subcategory'
          ? (pick(row,['Subcategoría','Subcategoria']) || 'Sin subcategoría') === group
          : (pick(row,['Categoría','Categoria']) || 'Sin categoría') === group))
        .reduce((sum,row)=>sum+movementAmount(row),0)
      ),
      borderWidth: 2,
      tension: .25,
      pointRadius: 2,
      pointHoverRadius: 6
    }));

    if (datasets.length > 1) {
      datasets.push({
        label:'Total seleccionado',
        data: periods.map(period => rows.filter(row => periodKey(movementDate(row)) === period).reduce((s,r)=>s+movementAmount(r),0)),
        borderWidth:3,
        tension:.25,
        pointRadius:2,
        pointHoverRadius:6
      });
    }

    createLineChart(canvas, periods.map(prettyPeriod), datasets);
  }

  function drawFlowChart() {
    const rows = filterRowsByPeriod(state.data.ahorro?.length ? state.data.ahorro : state.data.flujo);
    const canvas = byId('flowChart');
    if (!canvas || !window.Chart) return;
    const labels = rows.map(row => pick(row,['Mes','Periodo','Período','Fecha']) || '');
    const datasets = [
      {label:'Ingresos', data: rows.map(row => num(pick(row,['Ingresos reales COP','Ingresos COP','Ingresos','Total ingresos']))), borderWidth:2, tension:.25},
      {label:'Egresos', data: rows.map(row => num(pick(row,['Egresos reales COP','Egresos COP','Egresos','Total egresos']))), borderWidth:2, tension:.25},
      {label:'Ahorro', data: rows.map(row => num(pick(row,['Ahorro real COP','Ahorro COP','Ahorro']))), borderWidth:2, tension:.25}
    ];
    createLineChart(canvas, labels, datasets);
  }

  function drawPensionChart() {
    const rows = filterRowsByPeriod(state.data.pension || []);
    const canvas = byId('pensionChart');
    if (!canvas || !window.Chart) return;
    const labels = rows.map(row => pick(row,['Mes','Fecha','Periodo','Período']) || '');
    const values = rows.map(row => num(pick(row,['Saldo','Valor','Saldo total','Total'])));
    createLineChart(canvas, labels, [{label:'Saldo',data:values,borderWidth:2,tension:.25}]);
  }

  function drawIncomeChart() {
    const rows = filterRowsByPeriod(state.data.ingresos || []);
    const canvas = byId('incomeChart');
    if (!canvas || !window.Chart) return;
    const labels = rows.map(row => pick(row,['Mes','Periodo','Período','Fecha']) || '');
    const data = rows.map(incomeAmount);
    createLineChart(canvas, labels, [{label:`Ingresos ${state.currency}`,data,borderWidth:2,tension:.25}]);
  }

  function createLineChart(canvas, labels, datasets) {
    const chart = new Chart(canvas, {
      type:'line',
      data:{labels,datasets},
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'nearest',intersect:false},
        plugins:{
          legend:{display:true,labels:{color:'#9aa8ba',boxWidth:10,usePointStyle:true}},
          tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${money(ctx.parsed.y)}`}}
        },
        scales:{
          x:{ticks:{color:'#718098',maxRotation:0,autoSkip:true},grid:{color:'#121c29'}},
          y:{beginAtZero:true,ticks:{color:'#718098',callback:value=>shortMoney(value)},grid:{color:'#121c29'}}
        }
      }
    });
    state.charts.push(chart);
    requestAnimationFrame(() => {
      const scroller = canvas.closest('.chart-scroll');
      if (scroller) scroller.scrollLeft = scroller.scrollWidth;
    });
  }

  function chartShell(id, width) {
    return `<div class="chart-scroll"><div class="chart-inner" style="width:${Math.max(760,width)}px;min-width:100%;height:330px"><canvas id="${id}"></canvas></div></div>`;
  }

  function tablePanel(title, rows, preferredColumns = null) {
    if (!rows?.length) return `<div class="panel">${empty('Sin información para mostrar')}</div>`;
    const id = `tbl-${hash(title + JSON.stringify(rows.slice(0,2)))}`;
    const columns = preferredColumns?.filter(c => rows.some(row => Object.prototype.hasOwnProperty.call(row,c))) || tableColumns(rows);
    const visibleRows = rows.slice(0, 2000);

    return `<div class="panel table-panel">
      <div class="panel-header">
        <div class="panel-title"><strong>${esc(title)}</strong><span>${rows.length} registros</span></div>
        <div class="table-toolbar"><input class="search-input" data-search-table="${id}" placeholder="Buscar en la tabla…" value="${esc(state.searches[id]||'')}"></div>
      </div>
      <div class="table-scroll">
        <table id="${id}">
          <thead><tr>${columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${visibleRows.map((row, index) => `<tr data-row-index="${index}">${columns.map(c=>`<td>${formatCell(row[c])}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
      ${visibleRows.length > 15 ? `<div class="table-more"><button type="button" class="btn btn-secondary" data-toggle-table="${id}">${state.expandedTables.has(id)?'Ver menos':'Ver más'}</button></div>` : ''}
    </div>`;
  }

  function applyTableSearch(id) {
    const q = norm(state.searches[id] || '');
    const table = byId(id);
    if (!table) return;
    table.querySelectorAll('tbody tr').forEach(tr => {
      tr.dataset.matches = (!q || norm(tr.textContent).includes(q)) ? '1' : '0';
    });
    updateTableVisibility(id);
  }

  function updateTableVisibility(id) {
    const table = byId(id);
    if (!table) return;
    const expanded = state.expandedTables.has(id);
    let shown = 0;
    table.querySelectorAll('tbody tr').forEach(tr => {
      const matches = tr.dataset.matches !== '0';
      if (!matches) { tr.style.display='none'; return; }
      shown++;
      tr.style.display = expanded || shown <= 15 ? '' : 'none';
    });
  }

  function filteredMovements() {
    return (state.data.movimientos || []).filter(row => {
      const d = movementDate(row);
      if (state.filters.year.length && (!d || !state.filters.year.includes(String(d.getFullYear())))) return false;
      if (state.filters.month.length && (!d || !state.filters.month.includes(String(d.getMonth()+1)))) return false;

      const category = pick(row,['Categoría','Categoria']);
      const subcategory = pick(row,['Subcategoría','Subcategoria']);
      const currency = pick(row,['Moneda original','Moneda','Currency']);

      if (state.filters.category.length && !state.filters.category.includes(category)) return false;
      if (state.filters.subcategory.length && !state.filters.subcategory.includes(subcategory)) return false;
      if (state.filters.currency.length && !state.filters.currency.includes(String(currency).toUpperCase())) return false;
      return true;
    });
  }

  function filterRowsByPeriod(rows) {
    return (rows || []).filter(row => {
      const d = rowDate(row);
      if (state.filters.year.length && d && !state.filters.year.includes(String(d.getFullYear()))) return false;
      if (state.filters.month.length && d && !state.filters.month.includes(String(d.getMonth()+1))) return false;
      return true;
    });
  }

  function isExpense(row) {
    const type = norm(pick(row,['Tipo','Naturaleza']));
    return !type || type.includes('gasto') || type.includes('egreso') || type.includes('compra');
  }

  function isFinanced(row) {
    const account = norm(pick(row,['Cuenta / Tarjeta','Medio de Pago','Pago']));
    const installments = num(pick(row,['Cuotas','N° cuotas','Numero cuotas']));
    return account.includes('credito') || account.includes('tarjeta') || account.includes('nu') || account.includes('arq') || installments > 1;
  }

  function movementDate(row) {
    return parseDate(pick(row,['Fecha real','Fecha','Fecha registrada','Mes consumo']));
  }

  function movementAmount(row) {
    if (state.currency === 'USD') return num(pick(row,['Monto USD','$US','USD']));
    if (state.currency === 'ARS') return num(pick(row,['Monto ARS','$AR','ARS']));
    return num(pick(row,['Monto COP','$CO','COP']));
  }

  function incomeAmount(row) {
    if (state.currency === 'USD') return num(pick(row,['Ingresos USD','USD','Ingreso USD']));
    if (state.currency === 'ARS') return num(pick(row,['Ingresos ARS','ARS','Ingreso ARS']));
    return num(pick(row,['Ingresos COP','COP','Ingreso COP','Ingresos reales COP']));
  }

  function selectedIncome() {
    const rows = filterRowsByPeriod(state.data.ingresos || []);
    return rows.reduce((sum,row)=>sum+incomeAmount(row),0);
  }

  function rowDate(row) {
    for (const key of ['Fecha','Fecha real','Fecha inicio','Fecha de inicio','Fecha corte','Mes','Periodo','Período','Mes control','Fecha Ida']) {
      if (row?.[key]) {
        const d = parseDate(row[key]);
        if (d) return d;
      }
    }
    return null;
  }

  function rowDateValue(row) {
    return rowDate(row)?.getTime() || 0;
  }

  function dateValue(row) {
    return movementDate(row)?.getTime() || 0;
  }

  function periodKey(date) {
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  }

  function prettyPeriod(value) {
    const m = String(value).match(/^(\d{4})-(\d{2})$/);
    if (!m) return value;
    return `${MONTH_LABELS[Number(m[2])-1]} ${m[1]}`;
  }

  function periodCount(rows) {
    return new Set(rows.map(r=>periodKey(movementDate(r))).filter(Boolean)).size;
  }

  function creditCard(row) {
    const total = num(pick(row,['Cupo total actual','Cupo total','Límite','Limite','Cupo']));
    const used = num(pick(row,['Cupo usado','Utilizado','Saldo usado']));
    const available = num(pick(row,['Cupo disponible','Disponible'])) || Math.max(0,total-used);
    const pct = total ? used/total*100 : num(pick(row,['% utilización','Utilización','Utilizacion']));
    const cls = pct >= 85 ? 'critical' : pct >= 70 ? 'high' : '';
    const period = pick(row,['Periodo de facturación','Período de facturación','Periodo facturación','Ciclo','Día corte']);
    const due = pick(row,['Fecha límite de pago','Fecha limite de pago','Día vencimiento','Fecha vencimiento']);

    return `<div class="credit-card">
      <div class="credit-top"><span class="credit-brand">${esc(pick(row,['Emisor','Tarjeta','Producto']) || 'Tarjeta')}</span><span class="credit-owner">${esc(pick(row,['Titular']) || '')}</span></div>
      <div class="credit-amount">${money(used)}</div>
      <div class="credit-sub">Usado de ${money(total)} · Disponible ${money(available)}</div>
      <div class="usage-track"><div class="usage-fill ${cls}" style="width:${Math.max(0,Math.min(100,pct))}%"></div></div>
      <div class="credit-bottom">
        <div class="credit-stat"><span>Utilización</span><strong>${formatNumber(pct,1)}%</strong></div>
        <div class="credit-stat"><span>Facturación</span><strong>${esc(period || '—')}</strong></div>
        <div class="credit-stat"><span>Pago</span><strong>${esc(due || '—')}</strong></div>
      </div>
    </div>`;
  }

  function latestMovementCards(rows) {
    if (!rows.length) return empty('Sin movimientos');
    return rows.map(row => `<div class="list-card">
      <div><strong>${esc(pick(row,['Descripción / Comercio','Descripción','Comercio']) || 'Movimiento')}</strong>
      <small>${esc(pick(row,['Fecha real','Fecha']) || '')} · ${esc(pick(row,['Categoría','Categoria']) || '')}</small></div>
      <strong>${money(movementAmount(row))}</strong>
    </div>`).join('');
  }

  function patientCards(rows) {
    if (!rows.length) return empty('Sin pacientes');
    return rows.map(row => `<div class="list-card"><div><strong>${esc(pick(row,['Nombre','Paciente']) || 'Paciente')}</strong><small>${esc(pick(row,['Tipo','Relación','Relacion']) || '')}</small></div></div>`).join('');
  }

  function studyCards(rows) {
    if (!rows.length) return empty('Sin estudios');
    return rows.map(row => `<div class="list-card"><div><strong>${esc(pick(row,['Estudio','Tipo','Nombre','Descripción','Descripcion']) || 'Estudio')}</strong><small>${esc(pick(row,['Paciente','Fecha']) || '')}</small></div></div>`).join('');
  }

  function sectionHead(eye,title,sub) {
    return `<div class="section-head"><div><span class="eyebrow">${esc(eye)}</span><h2>${esc(title)}</h2></div><p>${esc(sub||'')}</p></div>`;
  }

  function kpi(label,value,meta,color='') {
    return `<div class="kpi-card"><span class="kpi-label">${esc(label)}</span><strong class="kpi-value ${esc(color)}">${esc(value)}</strong><div class="kpi-meta"><span>${esc(meta||'')}</span></div></div>`;
  }

  function progress(label,value,max) {
    const pct = max ? Math.max(0,Math.min(100,value/max*100)) : 0;
    return `<div class="progress-row"><span class="progress-label">${esc(label)}</span><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><strong class="progress-value">${esc(money(value))}</strong></div>`;
  }

  function empty(message='Sin información para mostrar') {
    return `<div class="empty-state"><div><strong>${esc(message)}</strong><span>Los datos aparecerán cuando estén disponibles para los filtros seleccionados.</span></div></div>`;
  }

  function tableColumns(rows) {
    const keys = [];
    const seen = new Set();
    rows.slice(0,50).forEach(row => Object.keys(row || {}).forEach(key => {
      if (!seen.has(key) && key.trim()) { seen.add(key); keys.push(key); }
    }));
    return keys.slice(0,18);
  }

  function formatCell(value) {
    const s = String(value ?? '');
    if (/^https?:\/\//i.test(s)) return `<a href="${esc(s)}" target="_blank" rel="noopener" class="blue">Abrir</a>`;
    return esc(s);
  }

  function money(value) {
    const digits = state.currency === 'COP' || state.currency === 'ARS' ? 0 : 2;
    try {
      return new Intl.NumberFormat('es-CO',{style:'currency',currency:state.currency,maximumFractionDigits:digits,minimumFractionDigits:digits}).format(Number(value)||0);
    } catch (_) {
      return `${state.currency} ${formatNumber(value,digits)}`;
    }
  }

  function shortMoney(value) {
    const n = Number(value) || 0;
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${(n/1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(n/1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(n/1e3).toFixed(0)}K`;
    return String(Math.round(n));
  }

  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim();
    if (!s) return 0;
    s = s.replace(/[^\d,.\-]/g,'');
    if (!s) return 0;

    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    if (hasComma && hasDot) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g,'').replace(',','.');
      else s = s.replace(/,/g,'');
    } else if (hasComma) {
      const parts = s.split(',');
      if (parts.length === 2 && parts[1].length <= 2) s = parts[0].replace(/\./g,'') + '.' + parts[1];
      else s = s.replace(/,/g,'');
    } else if (hasDot) {
      const parts = s.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = s.replace(/\./g,'');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parseDate(value) {
    const s = String(value ?? '').trim();
    if (!s) return null;

    let m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (m) return validDate(+m[1], +m[2]-1, +(m[3]||1));

    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return validDate(+m[3], +m[2]-1, +m[1]);

    m = norm(s).match(/^(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)[\s\-\/]+(\d{4})$/);
    if (m) {
      const key = m[1] === 'sep' ? 'sept' : m[1];
      return validDate(+m[2], MONTHS.indexOf(key), 1);
    }

    m = norm(s).match(/^(\d{1,2})[\s\-\/]+(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)[\s\-\/]+(\d{4})$/);
    if (m) {
      const key = m[2] === 'sep' ? 'sept' : m[2];
      return validDate(+m[3], MONTHS.indexOf(key), +m[1]);
    }

    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function validDate(year, month, day) {
    if (month < 0 || month > 11) return null;
    const d = new Date(year,month,day);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function aggregate(rows,keyFn,valueFn) {
    const map = new Map();
    rows.forEach(row => {
      const key = keyFn(row);
      map.set(key,(map.get(key)||0)+(valueFn(row)||0));
    });
    return map;
  }

  function pick(obj, keys) {
    for (const key of keys) {
      if (obj && obj[key] != null && String(obj[key]).trim() !== '') return String(obj[key]).trim();
    }
    return '';
  }

  function localeSort(a,b) {
    return String(a).localeCompare(String(b),'es',{sensitivity:'base'});
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function norm(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function formatNumber(value,digits=0) {
    return new Intl.NumberFormat('es-CO',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value)||0);
  }

  function hash(value) {
    let h = 0;
    for (let i=0;i<value.length;i++) h = ((h<<5)-h)+value.charCodeAt(i)|0;
    return Math.abs(h).toString(36);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setSync(kind,text) {
    const dot = byId('syncDot');
    if (dot) dot.className = `sync-dot${kind==='ok'?' ok':kind==='loading'?' loading':''}`;
    if (byId('syncText')) byId('syncText').textContent = text;
  }

  function destroyCharts() {
    state.charts.forEach(chart => { try { chart.destroy(); } catch (_) {} });
    state.charts = [];
  }

  function emptyData() {
    return {
      movimientos:[], flujo:[], tarjetas:[], cuotas:[], inversiones:[], pension:[], ingresos:[], ahorro:[], servicios:[],
      documentos:[], viajes:[], pacientes:[], citas:[], tratamientos:[], estudios:[], eventosSalud:[], mediciones:[]
    };
  }

  function showFatal(error) {
    console.error('Panel Personal Edu: error de inicio', error);
    setSync('demo','Error de inicio');
    const root = byId('viewRoot');
    if (root) {
      root.innerHTML = `<div class="panel"><div class="empty-state"><div><strong>No se pudo iniciar el dashboard</strong><span>${esc(error?.message || String(error))}</span></div></div></div>`;
    }
  }
})();