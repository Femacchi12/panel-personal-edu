from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)


path = Path('flow-income-controller.js')
text = path.read_text(encoding='utf-8')
anchor = "  function updatePrimaryKpis(model, movements) {\n"
helper = '''  function movementAmount(row, currency) {
    if (currency === 'USD') return parseNumber(row['Monto USD']);
    if (currency === 'ARS') return parseNumber(row['Monto ARS']);
    return parseNumber(row['Monto COP']);
  }

  function renderFinancing(rows, currency) {
    const root = document.getElementById('viewRoot');
    if (!root || activeView() !== 'flujo') return;
    const primary = [...root.querySelectorAll('.kpi-grid')].find(grid => {
      const labels = [...grid.querySelectorAll('.kpi-label')].map(x => x.textContent.trim());
      return labels.includes('Egresos') && labels.includes('Ahorro') &&
        labels.some(x => x === 'Ingresos' || x === 'Ingresos promedio' || x === 'Ingresos regulares');
    });
    if (!primary) return;
    let one = 0, multi = 0;
    rows.forEach(row => {
      if (norm(method(row)) !== 'credito') return;
      const installments = Math.max(1, Math.round(parseNumber(row.Cuotas) || 1));
      const value = movementAmount(row, currency);
      if (installments > 1) multi += value;
      else one += value;
    });
    let host = root.querySelector('#flowFinancingKpis');
    if (!host) {
      host = document.createElement('div');
      host.id = 'flowFinancingKpis';
      host.className = 'kpi-grid flow-financing-kpis';
      host.style.gridTemplateColumns = 'repeat(3,minmax(0,1fr))';
      primary.insertAdjacentElement('afterend', host);
    }
    const total = one + multi;
    const html = `<div class="kpi-card"><span class="kpi-label">Financiado · 1 cuota</span><strong class="kpi-value">${formatMoney(one, currency)}</strong><div class="kpi-meta"><span>Compras a crédito en una sola cuota</span></div></div><div class="kpi-card"><span class="kpi-label">Financiado · más de 1 cuota</span><strong class="kpi-value gold">${formatMoney(multi, currency)}</strong><div class="kpi-meta"><span>Compras a crédito en 2 o más cuotas</span></div></div><div class="kpi-card"><span class="kpi-label">Financiado total</span><strong class="kpi-value gold">${formatMoney(total, currency)}</strong><div class="kpi-meta"><span>Total comprado a crédito</span></div></div>`;
    if (host.innerHTML !== html) host.innerHTML = html;
  }

'''
text = replace_once(text, anchor, helper + anchor, 'financing helper anchor')
call_anchor = "    setCard(cards.rate, 'Tasa de ahorro', formatPct(rate), 'Ahorro / ingreso regular');\n"
text = replace_once(text, call_anchor, call_anchor + "    renderFinancing(filtered, currency);\n", 'financing render call')
path.write_text(text, encoding='utf-8')

auth = Path('auth.js')
auth_text = auth.read_text(encoding='utf-8')
auth_text = replace_once(
    auth_text,
    '    await loadScript("flow-financing-filter-fix.js");',
    '    await loadScript("spend-chart-controller.js");',
    'auth spend loader',
)
auth.write_text(auth_text, encoding='utf-8')

legacy = Path('flow-financing-filter-fix.js')
if not legacy.exists():
    raise SystemExit('legacy financing file missing')
legacy.unlink()
