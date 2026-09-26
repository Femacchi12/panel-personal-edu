(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  const STORAGE_KEY = 'panel-personal-edu.include-monthly-projection';
  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  let frame = 0;
  let runVersion = 0;
  let lastSignature = '';

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';
  const activeCurrency = () => document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';
  const currentMonthKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`; };
  const monthLabel = key => { const m = String(key || '').match(/^(20\d{2})-(\d{2})$/); return m ? `${MONTHS[+m[2]-1]} ${m[1]}` : String(key || ''); };

  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c >= 0 && d >= 0) s = c > d ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'');
    else if (c >= 0) { const p = s.split(','); s = p.length === 2 && p[1].length <= 2 ? p[0].replace(/\./g,'') + '.' + p[1] : s.replace(/,/g,''); }
    else if (d >= 0) { const p = s.split('.'); if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g,''); }
    const n = Number(s); return Number.isFinite(n) ? n : 0;
  }

  function money(value, currency = activeCurrency()) {
    const digits = currency === 'USD' ? 2 : 0;
    return new Intl.NumberFormat('es-CO', { style:'currency', currency, minimumFractionDigits:digits, maximumFractionDigits:digits }).format(Number(value) || 0);
  }
  const pct = value => `${new Intl.NumberFormat('es-CO', { minimumFractionDigits:1, maximumFractionDigits:1 }).format((Number(value) || 0) * 100)}%`;

  function monthKey(value) {
    if (typeof window.RegularIncomeCore?.monthKey === 'function') return window.RegularIncomeCore.monthKey(value);
    const s = norm(value);
    let m = s.match(/^(20\d{2})-(\d{1,2})/);
    if (m) return `${m[1]}-${String(+m[2]).padStart(2,'0')}`;
    const map = {ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    m = s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[\s-]+(20\d{2})/);
    return m ? `${m[2]}-${String(map[m[1]]).padStart(2,'0')}` : '';
  }
  const rowMonth = row => monthKey(row['Mes consumo'] || row['Mes pago'] || row['Fecha real'] || row['Fecha registrada']);
  const previousMonth = key => { const m = String(key).match(/^(20\d{2})-(\d{2})$/); if (!m) return ''; const d = new Date(+m[1], +m[2]-2, 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
  const isActual = row => norm(row.Tipo) === 'gasto' && (window.MovementStatusCore?.isActual(row.Estado) ?? !/proyecc|proyect|programad|pendiente/.test(norm(row.Estado)));
  const isProjection = row => norm(row.Tipo) === 'gasto' && (window.MovementStatusCore?.isProjection(row.Estado) ?? /proyecc|proyect|programad/.test(norm(row.Estado)));
  const isFixed = row => /^(si|sí|true|1)$/i.test(String(row['Es fijo'] || '').trim());
  const isSuper = row => norm(row['Categoría']) === 'supermercado';

  function scopeOf(row) {
    if (window.FinanceScopeCore?.scopeOf) return window.FinanceScopeCore.scopeOf(row);
    const explicit = norm(row['Ámbito'] || row.Ambito);
    if (explicit.includes('fibrazo')) return 'FIBRAZO';
    if (explicit.includes('personal')) return 'Personal';
    const marker = norm(row.Observaciones);
    return marker.includes('ambito explicito: fibrazo') ? 'FIBRAZO' : 'Personal';
  }
  function account(row) {
    const raw = String(row['Cuenta / Tarjeta'] || '').trim(), n = norm(raw), holder = norm(row.Titular);
    if (n.includes('efectivo')) return 'Efectivo';
    if (n.includes('nequi')) return holder.includes('ro') ? 'Nequi Ro' : 'Nequi Edu';
    if (n.includes('arq')) return 'ARQ Edu';
    if (n.includes('nu')) return n.includes(' ro') || holder.includes('rocio') || holder === 'ro' ? 'Nu Ro' : 'Nu Edu';
    return raw || 'Sin especificar';
  }
  function method(row) {
    if (typeof window.FinancePurchasePolicy?.method === 'function') return window.FinancePurchasePolicy.method(row);
    const explicit = String(row['Modalidad de pago'] || '').trim();
    if (explicit) return explicit;
    const n = norm(row['Cuenta / Tarjeta']);
    if (n.includes('credito')) return 'Crédito';
    if (n.includes('transferencia')) return 'Transferencia';
    if (n.includes('debito')) return 'Débito';
    if (n.includes('efectivo')) return 'Efectivo';
    return num(row.Cuotas) > 0 && (n.includes('nu') || n.includes('arq')) ? 'Crédito' : 'Sin especificar';
  }

  const selectedGlobal = key => [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)].map(el => String(el.dataset.value || '').trim()).filter(Boolean);
  function filterState() {
    const payment = window.__PAYMENT_FILTER_STATE__?.view === 'flujo' ? window.__PAYMENT_FILTER_STATE__ : { account:[], method:[] };
    return {
      scope: window.FinanceScopeCore?.getScope?.('flujo') || window.__FINANCE_SCOPE_FILTER_STATE__?.flujo || 'Personal',
      years: selectedGlobal('year'),
      months: selectedGlobal('month').map(Number).filter(n => n >= 1 && n <= 12),
      categories: selectedGlobal('category'),
      subcategories: selectedGlobal('subcategory'),
      accounts: Array.isArray(payment.account) ? payment.account : [],
      methods: Array.isArray(payment.method) ? payment.method : []
    };
  }

  function matchesDimensions(row, state, includePeriod = true) {
    if (state.scope !== 'Todos' && scopeOf(row) !== state.scope) return false;
    const mk = rowMonth(row), ym = mk.match(/^(20\d{2})-(\d{2})$/);
    if (includePeriod && state.years.length && (!ym || !state.years.includes(ym[1]))) return false;
    if (includePeriod && state.months.length && (!ym || !state.months.includes(+ym[2]))) return false;
    if (state.categories.length && !state.categories.includes(String(row['Categoría'] || ''))) return false;
    if (state.subcategories.length && !state.subcategories.includes(String(row['Subcategoría'] || ''))) return false;
    if (state.accounts.length && !state.accounts.includes(account(row))) return false;
    if (state.methods.length && !state.methods.includes(method(row))) return false;
    return true;
  }

  function amount(row, currency = activeCurrency()) {
    if (currency === 'USD') return num(row['Monto USD']);
    if (currency === 'ARS') return num(row['Monto ARS']);
    return num(row['Monto COP']);
  }
  const sum = (rows, currency = activeCurrency()) => rows.reduce((total,row) => total + amount(row,currency), 0);

  function currencyFactor(rows, currency) {
    if (currency === 'COP') return 1;
    const ratios = [];
    rows.forEach(row => { const cop = num(row['Monto COP']), other = num(row[currency === 'USD' ? 'Monto USD' : 'Monto ARS']); if (cop > 0 && other > 0) ratios.push(other/cop); });
    ratios.sort((a,b) => a-b);
    if (ratios.length) return ratios[Math.floor(ratios.length/2)];
    return currency === 'USD' ? 1 / Number(cfg.regularIncome?.usdCopReference || 3150) : 1 / 2.1;
  }

  function groupTotals(actual, previous, projections, currency) {
    const out = { super:{current:0,previous:0,projection:0}, fixed:{current:0,previous:0,projection:0}, variable:{current:0,previous:0,projection:0} };
    const add = (bucket,row) => {
      const value = amount(row,currency);
      if (isSuper(row)) out.super[bucket] += value;
      if (isFixed(row)) out.fixed[bucket] += value;
      if (!isFixed(row) && !isSuper(row)) out.variable[bucket] += value;
    };
    actual.forEach(row => add('current',row)); previous.forEach(row => add('previous',row)); projections.forEach(row => add('projection',row));
    return out;
  }

  function monthStats(rows, key, state, currency) {
    const prev = previousMonth(key), actual = [], previous = [], projections = [];
    rows.forEach(row => {
      if (!matchesDimensions(row,state,false)) return;
      const mk = rowMonth(row);
      if (mk === key) { if (isActual(row)) actual.push(row); else if (isProjection(row)) projections.push(row); }
      else if (mk === prev && isActual(row)) previous.push(row);
    });
    const groups = groupTotals(actual, previous, projections, currency);
    groups.super.remaining = Math.max(0, groups.super.previous - groups.super.current - groups.super.projection);
    groups.fixed.remaining = Math.max(0, groups.fixed.previous - groups.fixed.current - groups.fixed.projection);
    groups.variable.remaining = 0;
    const realTotal = sum(actual,currency), projectionTotal = sum(projections,currency), recurringGap = groups.super.remaining + groups.fixed.remaining;
    return { key, prev, actual, previous, projections, groups, realTotal, projectionTotal, recurringGap, projectedTotal:realTotal + projectionTotal + recurringGap };
  }

  function periodKeys(rows, model, state) {
    const current = currentMonthKey();
    const available = new Set();
    if (model?.months instanceof Map) model.months.forEach((_,key) => { if (key <= current) available.add(key); });
    rows.forEach(row => { const key = rowMonth(row); if (key && key <= current && (isActual(row) || isProjection(row))) available.add(key); });
    let keys = [...available].filter(key => {
      const [year,month] = key.split('-');
      if (state.years.length && !state.years.includes(year)) return false;
      if (state.months.length && !state.months.includes(+month)) return false;
      return true;
    }).sort();
    if (!state.years.length && !state.months.length) keys = available.has(current) ? [current] : keys.slice(-1);
    return keys;
  }

  function filteredStats(rows, model, state, currency) {
    const keys = periodKeys(rows,model,state);
    const keySet = new Set(keys);
    const actual = rows.filter(row => keySet.has(rowMonth(row)) && isActual(row) && matchesDimensions(row,state,false));
    const realTotal = sum(actual,currency);
    const current = currentMonthKey();
    let projectionTotal = 0, recurringGap = 0, projections = [];
    if (keySet.has(current)) {
      const currentStats = monthStats(rows,current,state,currency);
      projectionTotal = currentStats.projectionTotal;
      recurringGap = currentStats.recurringGap;
      projections = currentStats.projections;
    }
    const factor = currencyFactor(rows,currency);
    const incomeCop = model && keys.length && typeof model.period === 'function' ? num(model.period(keys).totalCop) : 0;
    return { keys, realTotal, projectionTotal, recurringGap, projectedTotal:realTotal + projectionTotal + recurringGap, projections, income:incomeCop*factor, count:actual.length };
  }

  function projectionOn() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? Boolean(window.__PANEL_INCLUDE_MONTHLY_PROJECTION__) : stored === '1';
  }
  function setProjection(value) {
    localStorage.setItem(STORAGE_KEY,value?'1':'0');
    window.__PANEL_INCLUDE_MONTHLY_PROJECTION__ = Boolean(value);
    document.dispatchEvent(new CustomEvent('panel:monthly-projection-change',{ detail:{ enabled:Boolean(value), source:'flow-v3' } }));
  }

  function ensureStyles() {
    if (document.getElementById('flowV3Styles')) return;
    const style = document.createElement('style');
    style.id = 'flowV3Styles';
    style.textContent = `
      #monthlyProjectionSuite{display:grid;gap:12px;margin:0 0 4px}.monthly-detached-host{display:contents}
      .monthly-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.monthly-kpis>div{background:#0c1420;border:1px solid var(--border-soft);border-radius:11px;padding:11px}.monthly-kpis span{display:block;color:#718198;text-transform:uppercase;font-size:8px;font-weight:800;letter-spacing:.05em}.monthly-kpis strong{display:block;font-size:18px;margin-top:7px}.monthly-kpis small{display:block;color:#718198;font-size:9px;margin-top:5px}.monthly-kpis .monthly-considered.projected{border-color:rgba(23,105,255,.35);background:rgba(23,105,255,.07)}
      .monthly-switch{display:flex;align-items:center;gap:8px;color:#aebbd0;font-size:10px;cursor:pointer;user-select:none}.monthly-switch input{display:none}.monthly-switch span{width:34px;height:18px;border-radius:99px;background:#172334;border:1px solid #24344b;position:relative}.monthly-switch span:after{content:"";position:absolute;width:12px;height:12px;border-radius:50%;top:2px;left:3px;background:#718198}.monthly-switch input:checked+span{background:rgba(23,105,255,.25);border-color:#2c67c4}.monthly-switch input:checked+span:after{left:17px;background:#6fa1ff}
      .finance-context{margin:0 0 14px;border:1px solid var(--border-soft);background:linear-gradient(180deg,rgba(16,25,39,.86),rgba(8,14,23,.92));border-radius:13px;padding:12px;display:grid;gap:10px}.finance-context-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.finance-context-head>div:first-child{display:grid;gap:3px}.finance-context-head span{font-size:9px;font-weight:800;letter-spacing:.07em;color:#63a1ff}.finance-context-head strong{font-size:13px;color:#edf4ff}.finance-context-head small{font-size:10px;color:#71839a;line-height:1.4}.finance-context-state{border:1px solid var(--border);border-radius:99px;padding:5px 8px;font-size:9px;font-weight:800;color:#ffcc6d;border-color:rgba(246,200,68,.24);background:rgba(246,200,68,.06);white-space:nowrap}.finance-context-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.finance-context-item{border:1px solid var(--border-soft);background:rgba(255,255,255,.025);border-radius:10px;padding:9px;min-width:0}.finance-context-item span{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.055em;color:#667b95;font-weight:800}.finance-context-item strong{display:block;margin-top:4px;font-size:15px;color:#eef5ff;line-height:1.15}.finance-context-item small{display:block;margin-top:4px;font-size:9px;color:#71839a;line-height:1.35}.finance-context-item.positive strong{color:#79e1ab}.finance-context-item.alert strong{color:#ffcb68}.finance-context-item.critical strong{color:#ff8290}
      #viewRoot>.kpi-grid[data-flow-legacy-kpis],#viewRoot>#flowScopeSummary,#viewRoot>#flowFinancingKpis{display:none!important}
      .monthly-planning-table{min-width:760px}.monthly-planning-table td{white-space:normal;vertical-align:top}.monthly-diff{display:inline-flex;padding:4px 7px;border-radius:99px;font-size:9px;font-weight:800}.monthly-diff.under{color:#f6c844;background:rgba(246,200,68,.08)}.monthly-diff.over{color:#ff8797;background:rgba(255,102,122,.08)}.monthly-diff.neutral{color:#7ee6af;background:rgba(38,208,124,.08)}
      @media(max-width:980px){.finance-context-grid,.monthly-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.finance-context-grid,.monthly-kpis{grid-template-columns:1fr}.finance-context-head{flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function primaryGrid(root) {
    return [...root.children].find(grid => grid.matches?.('.kpi-grid') && [...grid.querySelectorAll('.kpi-label')].some(x => norm(x.textContent).includes('ingresos')) && [...grid.querySelectorAll('.kpi-label')].some(x => norm(x.textContent) === 'egresos')) || null;
  }
  function hideLegacy(root) {
    const primary = primaryGrid(root);
    if (primary) { primary.dataset.flowLegacyKpis = '1'; primary.hidden = true; }
    const scope = root.querySelector(':scope > #flowScopeSummary'); if (scope) scope.hidden = true;
    const financing = root.querySelector(':scope > #flowFinancingKpis'); if (financing) financing.hidden = true;
  }

  function ensureBlocks(root) {
    let suite = root.querySelector(':scope > #monthlyProjectionSuite');
    if (!suite) { suite = document.createElement('section'); suite.id = 'monthlyProjectionSuite'; const head = root.querySelector(':scope > .section-head'); head ? head.insertAdjacentElement('afterend',suite) : root.prepend(suite); }
    if (!suite.querySelector('.monthly-close-panel')) suite.innerHTML = `<div class="panel monthly-close-panel"><div class="panel-header"><div class="panel-title"><strong data-close-title></strong><span data-close-subtitle></span></div></div><div class="monthly-kpis">${[0,1,2,3].map(i=>`<div data-close-card="${i}"><span></span><strong></strong><small></small></div>`).join('')}</div></div>`;

    let context = root.querySelector(':scope > .finance-context');
    if (!context) { context = document.createElement('section'); context.className = 'finance-context'; suite.insertAdjacentElement('afterend',context); }
    if (!context.dataset.flowV3) {
      context.dataset.flowV3 = '1';
      context.innerHTML = `<div class="finance-context-head"><div><span data-flow-label></span><strong data-flow-title></strong><small data-flow-subtitle></small></div><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end"><label class="monthly-switch"><input type="checkbox" id="flowUnifiedProjectionToggle"><span></span><b>Incluir proyección al cierre</b></label><div class="finance-context-state" data-flow-state>En curso</div></div></div><div class="finance-context-grid">${[0,1,2,3].map(i=>`<div class="finance-context-item" data-flow-card="${i}"><span></span><strong></strong><small></small></div>`).join('')}</div>`;
      context.querySelector('#flowUnifiedProjectionToggle')?.addEventListener('change',event => setProjection(event.target.checked));
    }

    let programmedHost = root.querySelector(':scope > #monthlyProgrammedHost');
    if (!programmedHost) { programmedHost = document.createElement('section'); programmedHost.id='monthlyProgrammedHost'; programmedHost.className='monthly-detached-host'; root.appendChild(programmedHost); }
    let comparisonHost = root.querySelector(':scope > #monthlyComparisonHost');
    if (!comparisonHost) { comparisonHost = document.createElement('section'); comparisonHost.id='monthlyComparisonHost'; comparisonHost.className='monthly-detached-host'; root.appendChild(comparisonHost); }
    return { suite, context, programmedHost, comparisonHost };
  }

  function setCloseCard(panel,index,label,value,meta,projected=false) {
    const card = panel.querySelector(`[data-close-card="${index}"]`); if (!card) return;
    card.querySelector('span').textContent = label; card.querySelector('strong').textContent = value; card.querySelector('small').textContent = meta;
    card.classList.toggle('monthly-considered',index===3); card.classList.toggle('projected',Boolean(projected)); card.classList.toggle('actual',index===3&&!projected);
  }
  function renderClose(blocks, stats, state, on, currency) {
    const panel = blocks.suite.querySelector('.monthly-close-panel');
    panel.querySelector('[data-close-title]').textContent = `Cierre estimado · ${monthLabel(stats.key)}`;
    panel.querySelector('[data-close-subtitle]').textContent = `Mes actual fijo · responde al ámbito ${state.scope}; los demás filtros no modifican este bloque.`;
    setCloseCard(panel,0,'Real hasta hoy',money(stats.realTotal,currency),`Movimientos realizados · ${state.scope}`);
    setCloseCard(panel,1,'Proyección pendiente',money(stats.projectionTotal,currency),`${stats.projections.length} gasto${stats.projections.length===1?'':'s'} · ${state.scope}`);
    setCloseCard(panel,2,'Faltante recurrente',money(stats.recurringGap,currency),`Supermercado + fijos/servicios · ${state.scope}`);
    setCloseCard(panel,3,'Total considerado',money(on?stats.projectedTotal:stats.realTotal,currency),on?`Real + cierre estimado · ${state.scope}`:`Solo gasto real · ${state.scope}`,on);
  }

  function setFlowCard(context,index,label,value,meta,tone='') {
    const card = context.querySelector(`[data-flow-card="${index}"]`); if (!card) return;
    card.className = `finance-context-item ${tone}`.trim();
    card.querySelector('span').textContent = label; card.querySelector('strong').textContent = value; card.querySelector('small').textContent = meta;
  }
  function renderSummary(blocks, stats, state, on, currency) {
    const context = blocks.context, isPersonal = state.scope === 'Personal';
    const expense = on ? stats.projectedTotal : stats.realTotal;
    const savings = isPersonal ? stats.income - expense : NaN;
    const rate = isPersonal && stats.income ? savings / stats.income : NaN;
    const target = stats.income * .30;
    const gap = isPersonal ? savings - target : NaN;
    const gapRate = isPersonal && stats.income ? gap / stats.income : NaN;
    const labels = stats.keys.map(monthLabel);
    const periodLabel = labels.length > 1 ? `${labels[0]} → ${labels.at(-1)}` : (labels[0] || monthLabel(currentMonthKey()));
    context.querySelector('[data-flow-label]').textContent = `LECTURA DEL FLUJO · ${periodLabel}`;
    context.querySelector('[data-flow-title]').textContent = on ? 'Seguimiento con cierre proyectado' : 'Seguimiento sobre gasto real';
    context.querySelector('[data-flow-subtitle]').textContent = `Ámbito ${state.scope} · este bloque sí responde a todos los filtros activos.`;
    context.querySelector('[data-flow-state]').textContent = stats.keys.includes(currentMonthKey()) ? 'En curso' : 'Cerrado';
    const toggle = context.querySelector('#flowUnifiedProjectionToggle'); if (toggle && toggle.checked !== on) toggle.checked = on;
    setFlowCard(context,0,'Ingresos promedio',money(stats.income,currency),stats.keys.length > 1 ? `${stats.keys.length} períodos · ingreso regular acumulado` : '1 período · ingreso regular de referencia','positive');
    setFlowCard(context,1,'Egresos',money(expense,currency),on ? `Real + proyección + faltante recurrente · ${state.scope}` : `${stats.count} movimientos realizados · ${state.scope}`);
    setFlowCard(context,2,on?'Ahorro sobre gasto proyectado':'Ahorro sobre gasto real',isPersonal?money(savings,currency):'—',isPersonal?`${pct(rate)} del ingreso regular`:'Disponible únicamente en ámbito Personal',isPersonal?(savings>=0?'positive':'critical'):'');
    setFlowCard(context,3,'Brecha vs meta 30%',isPersonal?money(gap,currency):'—',isPersonal?`${pct(gapRate)} del ingreso regular · Meta ${money(target,currency)}`:'La meta de ahorro aplica únicamente al ámbito Personal',isPersonal?(gap>=0?'positive':'alert'):'');
  }

  function diffCell(current,previous,currency) { const diff=current-previous; if (Math.abs(diff)<.5) return '<span class="monthly-diff neutral">Igual al mes pasado</span>'; return diff<0?`<span class="monthly-diff under">Faltan ${esc(money(Math.abs(diff),currency))}</span>`:`<span class="monthly-diff over">Supera ${esc(money(diff,currency))}</span>`; }
  function renderPlanning(blocks, rows, state, currency) {
    const current = currentMonthKey();
    const stats = monthStats(rows,current,state,currency);
    const projectionRows = stats.projections;
    const programmed = `<div class="panel table-panel monthly-programmed-panel"><div class="panel-header"><div class="panel-title"><strong>Proyecciones del mes</strong><span>Pendientes conocidos para ${esc(monthLabel(current))} · según filtros activos.</span></div></div>${projectionRows.length?`<div class="table-scroll"><table class="monthly-planning-table"><thead><tr><th>Categoría</th><th>Descripción</th><th>Medio de pago</th><th>Ámbito</th><th>Monto</th></tr></thead><tbody>${projectionRows.map(row=>`<tr><td>${esc(row['Categoría']||'—')}</td><td>${esc(row['Descripción / Comercio']||'—')}</td><td>${esc(row['Cuenta / Tarjeta']||'—')}</td><td>${esc(scopeOf(row))}</td><td>${esc(money(amount(row,currency),currency))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><strong>Sin proyecciones pendientes</strong><span>No hay proyecciones para el mes actual con estos filtros.</span></div>'}</div>`;
    blocks.programmedHost.innerHTML = programmed;
    blocks.comparisonHost.innerHTML = `<div class="panel table-panel monthly-comparison-panel"><div class="panel-header"><div class="panel-title"><strong>Comparación mensual de gasto recurrente y variable</strong><span>${esc(monthLabel(current))} vs ${esc(monthLabel(stats.prev))} · según filtros activos.</span></div></div><div class="table-scroll"><table class="monthly-planning-table"><thead><tr><th>Grupo</th><th>Este mes</th><th>Mes anterior</th><th>Comparación</th></tr></thead><tbody>${[['Supermercado',stats.groups.super],['Gastos fijos / servicios',stats.groups.fixed],['Variables sin supermercado',stats.groups.variable]].map(([label,g])=>`<tr><td><strong>${esc(label)}</strong></td><td>${esc(money(g.current,currency))}</td><td>${esc(money(g.previous,currency))}</td><td>${diffCell(g.current,g.previous,currency)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  async function getData() {
    const getter = window.__PANEL_GET_BACKEND_DATA__;
    if (typeof getter !== 'function') return null;
    const payload = await getter(false);
    const cached = window.__PANEL_GET_CACHED_ROWS__;
    const rows = window.FinanceScopeCore?.movementRows
      ? window.FinanceScopeCore.movementRows(payload,financeId)
      : (()=>{const rowsAA=typeof cached==='function'?cached(payload,financeId,'Movimientos!A:AA'):[];return rowsAA.length?rowsAA:(typeof cached==='function'?cached(payload,financeId,'Movimientos!A:Z'):[]);})();
    const model = typeof window.RegularIncomeCore?.build === 'function' ? window.RegularIncomeCore.build(payload,financeId) : null;
    return { rows, model };
  }

  function signature(state,currency,on,data) {
    return JSON.stringify({view:activeView(),currency,on,scope:state.scope,years:state.years,months:state.months,categories:state.categories,subcategories:state.subcategories,accounts:state.accounts,methods:state.methods,rows:data.rows.length,current:currentMonthKey()});
  }

  async function render(version) {
    if (activeView() !== 'flujo') return;
    const root = document.getElementById('viewRoot'); if (!root) return;
    ensureStyles(); hideLegacy(root);
    const data = await getData();
    if (!data || version !== runVersion || activeView() !== 'flujo' || !root.isConnected) return;
    const state = filterState(), currency = activeCurrency(), on = projectionOn();
    const sig = signature(state,currency,on,data);
    const blocks = ensureBlocks(root);
    hideLegacy(root);
    const closeState = { scope:state.scope, years:[], months:[], categories:[], subcategories:[], accounts:[], methods:[] };
    const closeStats = window.FinanceScopeCore?.closeStats
      ? window.FinanceScopeCore.closeStats(data.rows,{scope:state.scope,currency,key:currentMonthKey()})
      : monthStats(data.rows,currentMonthKey(),closeState,currency);
    const filtered = filteredStats(data.rows,data.model,state,currency);
    renderClose(blocks,closeStats,state,on,currency);
    renderSummary(blocks,filtered,state,on,currency);
    if (sig !== lastSignature) renderPlanning(blocks,data.rows,state,currency);
    lastSignature = sig;
    window.__PANEL_FLOW_SCOPE_AUDIT__ = Object.freeze({ key:filtered.keys.at(-1)||currentMonthKey(), keys:[...filtered.keys], scope:state.scope, realTotal:filtered.realTotal, projectionTotal:filtered.projectionTotal, recurringGap:filtered.recurringGap, projectedTotal:filtered.projectedTotal, personalOnly:state.scope==='Personal' });
  }

  function schedule() {
    if (activeView() !== 'flujo') return;
    runVersion += 1;
    if (frame) return;
    frame = requestAnimationFrame(() => { frame=0; const version=runVersion; render(version).catch(error=>console.error('Flujo mensual v3:',error)); });
  }

  ['panel:view-root-changed','panel:filters-updated','panel:payment-filters-changed','panel:expense-scope-changed','panel:monthly-projection-change'].forEach(name => document.addEventListener(name,event => {
    if (activeView() !== 'flujo') return;
    if ((name === 'panel:payment-filters-changed' || name === 'panel:expense-scope-changed') && event.detail?.view && event.detail.view !== 'flujo') return;
    schedule();
  }));
  queueMicrotask(schedule);
})();