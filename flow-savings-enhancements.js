(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  const MONTH_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sept','Oct','Nov','Dic'];
  const SUMMARY_ROWS = [
    ['Total gastado por categorías','__CATEGORY_TOTAL__','flow-total-row'],
    ['Gasto fijo','Fijo','flow-summary-row'],
    ['Gasto fijo + supermercado','Fijo + Super','flow-summary-row'],
    ['Gasto variable','Variable','flow-summary-row'],
    ['Gasto variable - supermercado','Variable - Super','flow-summary-row'],
    ['Pagado / egresos efectivos','Egresos efectivos','flow-summary-row'],
    ['Financiado en cuotas','Egresos Financiados','flow-summary-row flow-financed-row'],
    ['Total real del mes (pagado + financiado)','Egresos TOTALES','flow-summary-row flow-real-row']
  ];

  let payloadPromise = null;
  let cacheUntil = 0;
  let timer = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) s = s.replace(/\./g,'').replace(',','.');
      else s = s.replace(/,/g,'');
    } else if (comma >= 0) {
      const parts = s.split(',');
      if (parts.length === 2 && parts[1].length <= 4) s = parts[0].replace(/\./g,'') + '.' + parts[1];
      else s = s.replace(/,/g,'');
    } else if (dot >= 0) {
      const parts = s.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = s.replace(/\./g,'');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((header,index) => [header || `Col ${index+1}`, row?.[index] ?? ''])));
  }

  async function getPayload(force = false) {
    if (!force && payloadPromise && Date.now() < cacheUntil) return payloadPromise;
    payloadPromise = (async () => {
      const getIdToken = window.__PANEL_GET_ID_TOKEN__;
      if (typeof getIdToken !== 'function') throw new Error('Sesión Firebase no disponible');
      const token = await getIdToken(false);
      if (!token) throw new Error('Sesión Firebase no disponible');
      const response = await fetch(`${apiBaseUrl}/api/data`, {
        headers:{Authorization:`Bearer ${token}`},
        cache:'no-store'
      });
      if (!response.ok) throw new Error(`Backend ${response.status}`);
      return response.json();
    })();
    cacheUntil = Date.now() + 55_000;
    try {
      return await payloadPromise;
    } catch (error) {
      payloadPromise = null;
      cacheUntil = 0;
      throw error;
    }
  }

  function matrix(payload, range) {
    return payload?.sources?.[`${financeId}|${range}`] || [];
  }

  function rows(payload, range) {
    return parseRows(matrix(payload,range));
  }

  function selectedValues(key) {
    return [...document.querySelectorAll(`.multi-filter[data-filter="${key}"] .multi-filter-option.selected`)]
      .map(el => String(el.dataset.value || '').trim())
      .filter(Boolean);
  }

  function activeView() {
    return document.querySelector('.nav-item.active')?.dataset.view || '';
  }

  function activeCurrency() {
    return document.querySelector('.currency-btn.active')?.dataset.currency || 'COP';
  }

  function monthParts(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{1,2})$/);
    return match ? {year:Number(match[1]), month:Number(match[2])} : null;
  }

  function monthLabel(value) {
    const p = monthParts(value);
    return p ? `${MONTH_LABELS[p.month-1]} ${p.year}` : String(value || '—');
  }

  function median(values) {
    const sorted = values.filter(v=>Number.isFinite(v) && v>0).sort((a,b)=>a-b);
    if (!sorted.length) return 0;
    const mid = Math.floor(sorted.length/2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
  }

  function scenarioReference(payload) {
    const helper = matrix(payload,'Escenarios_Ahorro!A:X');
    if (helper.length >= 7) {
      const regularCop = parseNumber(helper?.[2]?.[1]);
      const annualBonus = parseNumber(helper?.[4]?.[1]);
      const usdCop = parseNumber(helper?.[5]?.[1]);
      const arsCop = parseNumber(helper?.[6]?.[1]);
      if (regularCop > 0) {
        return {
          regularCop,
          annualBonus,
          usdCop:usdCop || 3150,
          arsCop:arsCop || 2.1
        };
      }
    }

    const concepts = rows(payload,'Resumen_Conceptos_Ingresos!A:L');
    const salaryCop = median(concepts.map(r=>parseNumber(r['Sueldo COP'])));
    const salaryUsdCop = median(concepts.map(r=>parseNumber(r['Sueldo USD (equiv. COP)'])));
    const semesterBonus = Math.max(0,...concepts.map(r=>parseNumber(r['Prima COP']))) + Math.max(0,...concepts.map(r=>parseNumber(r['Prima USD (equiv. COP)'])));
    return {regularCop:salaryCop+salaryUsdCop,annualBonus:semesterBonus*2,usdCop:3150,arsCop:2.1};
  }

  function convertCop(value,currency,ref) {
    const n = Number(value) || 0;
    if (currency === 'USD') return ref.usdCop ? n/ref.usdCop : 0;
    if (currency === 'ARS') return ref.arsCop ? n/ref.arsCop : 0;
    return n;
  }

  function formatMoney(value,currency) {
    const digits = currency === 'USD' ? 2 : 0;
    return new Intl.NumberFormat('es-CO',{
      style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits
    }).format(Number(value)||0);
  }

  function periodFilteredCategoryRows(flowRows) {
    const years = selectedValues('year');
    const months = selectedValues('month');
    return flowRows.filter(row => {
      if (norm(row.Tipo) !== 'categoria') return false;
      const parts = monthParts(row.Mes);
      if (!parts) return false;
      if (years.length && !years.includes(String(parts.year))) return false;
      if (months.length && !months.includes(String(parts.month))) return false;
      return true;
    }).sort((a,b)=>String(a.Mes).localeCompare(String(b.Mes)) || String(a.Concepto).localeCompare(String(b.Concepto),'es'));
  }

  function matrixYear(flowRows) {
    const yearsSelected = selectedValues('year').map(Number).filter(Number.isFinite);
    if (yearsSelected.length) return Math.max(...yearsSelected);
    const years = flowRows.map(r=>monthParts(r.Mes)?.year).filter(Number.isFinite);
    return years.length ? Math.max(...years) : new Date().getFullYear();
  }

  function flowValueMap(flowRows,year) {
    const map = new Map();
    flowRows.forEach(row => {
      const parts = monthParts(row.Mes);
      if (!parts || parts.year !== year) return;
      map.set(`${parts.month}|${row.Concepto}`,parseNumber(row['Total COP']));
    });
    return map;
  }

  function categoryOrder(flowRows,year) {
    const seen = new Set(), out = [];
    flowRows.forEach(row => {
      const parts = monthParts(row.Mes);
      if (!parts || parts.year !== year || norm(row.Tipo) !== 'categoria') return;
      const category = String(row.Concepto || '').trim();
      if (category && !seen.has(category)) { seen.add(category); out.push(category); }
    });
    return out;
  }

  function renderFlowTableOne(categoryRows,ref,currency) {
    const body = categoryRows.map(row => `
      <tr>
        <td>${esc(monthLabel(row.Mes))}</td>
        <td>${esc(row.Concepto)}</td>
        <td class="money">${esc(formatMoney(convertCop(parseNumber(row['Total COP']),currency,ref),currency))}</td>
      </tr>`).join('');
    return `<div class="panel flow-extra-panel">
      <div class="panel-header"><div class="panel-title"><strong>Gasto mensual por categoría</strong><span>Mes · categoría · total gastado, respetando los filtros de período</span></div></div>
      <div class="table-scroll"><table class="flow-detail-table"><thead><tr><th>Mes</th><th>Categoría</th><th>Total gastado ${esc(currency)}</th></tr></thead><tbody>${body || '<tr><td colspan="3">Sin datos para el período seleccionado</td></tr>'}</tbody></table></div>
    </div>`;
  }

  function renderFlowMatrix(flowRows,ref,currency) {
    const year = matrixYear(flowRows);
    const categories = categoryOrder(flowRows,year);
    const valueMap = flowValueMap(flowRows,year);
    const monthHeaders = MONTH_LABELS.map((label,index)=>`<th>${label} ${year}</th>`).join('');
    const categoryBody = categories.map(category => {
      const cells = Array.from({length:12},(_,index)=>{
        const cop = valueMap.get(`${index+1}|${category}`) || 0;
        return `<td>${esc(formatMoney(convertCop(cop,currency,ref),currency))}</td>`;
      }).join('');
      return `<tr><td>${esc(category)}</td>${cells}</tr>`;
    }).join('');

    const summaryBody = SUMMARY_ROWS.map(([label,key,className]) => {
      const cells = Array.from({length:12},(_,index)=>{
        let cop;
        if (key === '__CATEGORY_TOTAL__') {
          cop = categories.reduce((sum,category)=>sum+(valueMap.get(`${index+1}|${category}`)||0),0);
        } else {
          cop = valueMap.get(`${index+1}|${key}`) || 0;
        }
        return `<td>${esc(formatMoney(convertCop(cop,currency,ref),currency))}</td>`;
      }).join('');
      return `<tr class="${className}"><td>${esc(label)}</td>${cells}</tr>`;
    }).join('');

    return `<div class="panel flow-extra-panel">
      <div class="panel-header"><div class="panel-title"><strong>Matriz mensual por categoría</strong><span>Año ${year} · la primera columna queda fija al desplazarte horizontalmente</span></div></div>
      <div class="flow-matrix-scroll"><table class="flow-matrix-table"><thead><tr><th>Categoría</th>${monthHeaders}</tr></thead><tbody>${categoryBody}${summaryBody}</tbody></table></div>
    </div>`;
  }

  async function enhanceFlow() {
    if (activeView() !== 'flujo') return;
    const root = document.getElementById('viewRoot');
    if (!root || root.querySelector('#flowExtraBoards') || root.dataset.flowExtraLoading === '1') return;
    root.dataset.flowExtraLoading = '1';
    try {
      const payload = await getPayload();
      if (activeView() !== 'flujo') return;
      const flowRows = rows(payload,'Flujo_Mensual!A:J');
      const ref = scenarioReference(payload);
      const currency = activeCurrency();
      const filtered = periodFilteredCategoryRows(flowRows);
      const host = document.createElement('div');
      host.id = 'flowExtraBoards';
      host.className = 'flow-extra-stack';
      host.innerHTML = renderFlowTableOne(filtered,ref,currency) + renderFlowMatrix(flowRows,ref,currency);

      const existingTable = [...root.querySelectorAll('.panel')].find(panel => norm(panel.querySelector('.panel-title strong')?.textContent).includes('flujo y ahorro mensual'));
      if (existingTable) existingTable.insertAdjacentElement('beforebegin',host);
      else root.appendChild(host);
    } catch (error) {
      console.error('No se pudieron cargar los tableros adicionales de Flujo mensual:',error);
    } finally {
      delete root.dataset.flowExtraLoading;
    }
  }

  function scenarioRows(ref,currency) {
    return [0.40,0.30,0.20,0.10].map(rate => {
      const monthlySavings = ref.regularCop * rate;
      const monthlySpend = ref.regularCop * (1-rate);
      const annualSavings = ref.regularCop * 12 * rate;
      const annualSpend = ref.regularCop * 12 * (1-rate);
      const annualWithBonus = annualSavings + ref.annualBonus;
      return {
        rate,
        monthlySavings:convertCop(monthlySavings,currency,ref),
        monthlySpend:convertCop(monthlySpend,currency,ref),
        annualSavings:convertCop(annualSavings,currency,ref),
        annualSpend:convertCop(annualSpend,currency,ref),
        annualWithBonus:convertCop(annualWithBonus,currency,ref)
      };
    });
  }

  function savingsPanelHtml(ref,currency) {
    const monthly = convertCop(ref.regularCop,currency,ref);
    const annual = convertCop(ref.regularCop*12,currency,ref);
    const bonus = convertCop(ref.annualBonus,currency,ref);
    const annualPlus = annual + bonus;
    const rowsHtml = scenarioRows(ref,currency).map(row=>`<tr>
      <td>${Math.round(row.rate*100)}%</td>
      <td>${esc(formatMoney(row.monthlySavings,currency))}</td>
      <td>${esc(formatMoney(row.monthlySpend,currency))}</td>
      <td>${esc(formatMoney(row.annualSavings,currency))}</td>
      <td>${esc(formatMoney(row.annualSpend,currency))}</td>
      <td>${esc(formatMoney(row.annualWithBonus,currency))}</td>
    </tr>`).join('');

    return `<div class="panel savings-scenario-panel" id="savingsScenarioPanel">
      <div class="panel-header"><div class="panel-title"><strong>Escenarios de capacidad de ahorro</strong><span>Metas de ahorro mensual y anual con referencia de prima / aguinaldo</span></div></div>
      <div class="savings-reference-grid">
        <div class="savings-reference-card"><span>Ingreso mensual regular</span><strong>${esc(formatMoney(monthly,currency))}</strong><small>Base recurrente sin extras</small></div>
        <div class="savings-reference-card"><span>Prima / aguinaldo anual estimado</span><strong>${esc(formatMoney(bonus,currency))}</strong><small>2 × última prima semestral registrada</small></div>
        <div class="savings-reference-card"><span>Ingreso anual regular</span><strong>${esc(formatMoney(annual,currency))}</strong><small>12 meses de ingreso regular</small></div>
        <div class="savings-reference-card"><span>Ingreso anual + prima</span><strong>${esc(formatMoney(annualPlus,currency))}</strong><small>Referencia anual completa</small></div>
      </div>
      <div class="table-scroll"><table class="savings-scenario-table"><thead><tr>
        <th>Meta</th><th>Ahorro mensual</th><th>Gasto máximo mensual</th><th>Ahorro anual</th><th>Gasto máximo anual</th><th>Ahorro anual + prima</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table></div>
      <div class="savings-scenario-note"><strong>Criterio:</strong> “Ahorro anual + prima” supone destinar el 100% de la prima/aguinaldo anual estimado al ahorro. Los valores cambian con el selector superior COP / USD / ARS.</div>
    </div>`;
  }

  async function enhanceSavings() {
    if (activeView() !== 'ingresos') return;
    const root = document.getElementById('viewRoot');
    if (!root || root.querySelector('#savingsScenarioPanel') || root.dataset.savingsScenarioLoading === '1') return;
    const incomeComplete = root.querySelector('[data-income-complete]');
    if (!incomeComplete) return;
    root.dataset.savingsScenarioLoading = '1';
    try {
      const payload = await getPayload();
      if (activeView() !== 'ingresos') return;
      const ref = scenarioReference(payload);
      if (!ref.regularCop) return;
      const currency = activeCurrency();
      const temp = document.createElement('div');
      temp.innerHTML = savingsPanelHtml(ref,currency);
      const panel = temp.firstElementChild;
      const chartPanel = incomeComplete.querySelector('.panel');
      if (chartPanel) chartPanel.insertAdjacentElement('afterend',panel);
      else incomeComplete.prepend(panel);
    } catch (error) {
      console.error('No se pudieron cargar los escenarios de ahorro:',error);
    } finally {
      delete root.dataset.savingsScenarioLoading;
    }
  }

  function removeAndRerenderForCurrentView() {
    const root = document.getElementById('viewRoot');
    if (!root) return;
    if (activeView() === 'flujo') root.querySelector('#flowExtraBoards')?.remove();
    if (activeView() === 'ingresos') root.querySelector('#savingsScenarioPanel')?.remove();
    schedule();
  }

  function run() {
    if (activeView() === 'flujo') enhanceFlow();
    if (activeView() === 'ingresos') enhanceSavings();
  }

  function schedule(delay=70) {
    clearTimeout(timer);
    timer = setTimeout(run,delay);
  }

  document.addEventListener('click',event=>{
    if (event.target.closest('.nav-item')) setTimeout(()=>schedule(100),30);
    if (event.target.closest('.currency-btn')) setTimeout(removeAndRerenderForCurrentView,80);
    if (event.target.closest('.multi-filter-option,[data-clear-filter],#resetCurrentMonth,#clearFilters')) setTimeout(removeAndRerenderForCurrentView,100);
  });

  const root = document.getElementById('viewRoot');
  if (root) new MutationObserver(()=>schedule(90)).observe(root,{childList:true,subtree:false});
  schedule();
})();
