from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    matches = text.count(old)
    if matches != 1:
        raise SystemExit(f"{label}: expected 1 exact match, got {matches}")
    return text.replace(old, new, 1)


# app.js: only the official investments renderer should build the investment UI.
path = "app.js"
text = read(path)
text, count = re.subn(
    r"  function renderInversiones\(\) \{.*?\n  function renderPension",
    "  function renderInversiones() {return sectionHead('FINANZAS','Inversiones','Posiciones, plataformas y composición del portafolio');}\n  function renderPension",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"app.js renderInversiones: expected 1 replacement, got {count}")

text = replace_once(
    text,
    "chartPanel('Uso por tarjeta','Cupo usado vs disponible','cardsChart',760)",
    "chartPanel('Uso por tarjeta','Cupo usado vs disponible','cardsChart',760,true)",
    "app.js cards base chart",
)
text = replace_once(
    text,
    '  function chartPanel(title,subtitle,id,width=760) {return `<div class="panel">',
    '  function chartPanel(title,subtitle,id,width=760,hidden=false) {return `<div class="panel"${hidden?\' hidden\':\'\'}>',
    "app.js chartPanel signature",
)
text = replace_once(text, "inversiones:drawInvestmentCharts,", "", "app.js investment chart map")
text, count = re.subn(
    r"  function drawInvestmentCharts\(\)\{.*?\}\n  function drawPensionChart",
    "  function drawPensionChart",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"app.js drawInvestmentCharts: expected 1 replacement, got {count}")
write(path, text)


# investment-period-enhancement.js: no more cleanup of DOM that the base renderer no longer creates.
path = "investment-period-enhancement.js"
text = read(path)
text = replace_once(
    text,
    "      root.querySelector('#investmentCorrected')?.classList.add('investment-period-hidden');root.querySelector('#investmentV2')?.remove();\n",
    "",
    "investment legacy DOM cleanup",
)
text, count = re.subn(
    r"  function injectStyles\(\)\{.*?\n  function schedule",
    "  function injectStyles(){if(document.getElementById('investmentPeriodStyles'))return;const style=document.createElement('style');style.id='investmentPeriodStyles';style.textContent=`#investmentPeriodCorrected{display:grid;gap:16px}#investmentPeriodCorrected .table-scroll{max-height:520px}.investment-truth-note{color:#8b9ab0;font-size:10px;line-height:1.55;padding:10px 12px;border:1px solid var(--border-soft);border-radius:10px;background:rgba(255,255,255,.015)}`;document.head.appendChild(style);}\n  function schedule",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"investment injectStyles: expected 1 replacement, got {count}")
write(path, text)


# monthly-projection-control.js: it owns placement of its planning/comparison panels.
path = "monthly-projection-control.js"
text = read(path)
old = "    let host=root.querySelector('#monthlyProjectionSuite');if(!host){host=document.createElement('section');host.id='monthlyProjectionSuite';const head=root.querySelector(':scope > .section-head');if(head)head.insertAdjacentElement('afterend',host);else root.prepend(host);}renderSuite(host,stats);"
new = "    let host=root.querySelector('#monthlyProjectionSuite');if(!host){host=document.createElement('section');host.id='monthlyProjectionSuite';const head=root.querySelector(':scope > .section-head');if(head)head.insertAdjacentElement('afterend',host);else root.prepend(host);}\n    root.querySelectorAll(':scope > .monthly-programmed-panel,:scope > .monthly-comparison-panel').forEach(el=>el.remove());\n    renderSuite(host,stats);\n    ['.monthly-programmed-panel','.monthly-comparison-panel'].forEach(selector=>{const panel=host.querySelector(selector);if(panel)root.appendChild(panel);});"
text = replace_once(text, old, new, "monthly panel ownership")
write(path, text)


# flow-matrix-detail-delegate.js: own the total footer in the official detail renderer.
path = "flow-matrix-detail-delegate.js"
text = read(path)
text = replace_once(
    text,
    "      #flowMatrixV3 .flow-matrix-advanced thead tr:first-child th[data-sort-month]{text-align:center!important}\n",
    "      #flowMatrixV3 .flow-matrix-advanced thead tr:first-child th[data-sort-month]{text-align:center!important}\n      #flowMatrixDetailV3 tfoot[data-auto-total] td{font-weight:800;color:#f4f7fb;border-top:2px solid #2a3a50;background:#0d1622;white-space:nowrap}\n      #flowMatrixDetailV3 tfoot[data-auto-total] td:first-child{color:#26d07c;letter-spacing:.06em}\n",
    "flow detail total styles",
)
replacement = r'''  function renderDetail(host, rows, cat, key, snap) {
    const total = rows.reduce((s, r) => s + num(r['Monto COP']), 0);
    const cols = ['Fecha real','Categoría','Subcategoría','Descripción / Comercio','Monto original','Moneda original','Cuenta / Tarjeta','Modalidad de pago','Titular','Cuotas','Estado','Monto COP'];
    const footer = cols.map((col,index) => `<td>${index===0?'TOTAL':col==='Monto COP'?esc(money(total)):''}</td>`).join('');
    host.innerHTML = `<div class="panel-header"><div class="panel-title"><strong>Detalle · ${esc(cat)} · ${esc(monthLabel(key))}</strong><span>${rows.length} movimientos realizados · total ${esc(money(total))}${esc(filterSummary(snap))}</span></div><button type="button" class="text-btn" data-close-flow-detail>Cerrar</button></div>${rows.length ? `<div class="table-scroll expanded"><table class="date-first-table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody><tfoot data-auto-total><tr class="flow-detail-total-row">${footer}</tr></tfoot></table></div>` : '<div class="empty-state"><div><strong>Sin movimientos realizados</strong><span>No hay movimientos para esta categoría, mes y filtros.</span></div></div>'}`;
    host.hidden = false;
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  ensureStyle'''
text, count = re.subn(
    r"  function renderDetail\(host, rows, cat, key, snap\) \{.*?\n  \}\n\n  ensureStyle",
    replacement,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"flow renderDetail: expected 1 replacement, got {count}")
write(path, text)


# CSS: native hidden must win over option display declarations.
path = "section-data-filters.css"
text = read(path)
rule = ".multi-filter-option[hidden]{display:none!important}"
if rule not in text:
    text = text.rstrip() + "\n" + rule + "\n"
write(path, text)


# index.html: remove obsolete guard modules and refresh cache versions.
path = "index.html"
text = read(path)
text = replace_once(text, "section-data-filters.css?v=20260817-2243", "section-data-filters.css?v=20260828-0010", "index filter css cache")
text = replace_once(text, "investment-period-enhancement.js?v=20260827-1600", "investment-period-enhancement.js?v=20260828-0010", "index investment cache")
for line, label in [
    ('  <script src="dashboard-reliability-fixes.js?v=20260827-1720"></script>\n', "index reliability script"),
    ('  <script src="section-structure-cleanup.js?v=20260827-2242"></script>\n', "index structure script"),
]:
    text = replace_once(text, line, "", label)
write(path, text)


# Remove modules whose responsibilities are now owned by official renderers.
for obsolete in ["dashboard-reliability-fixes.js", "section-structure-cleanup.js"]:
    target = Path(obsolete)
    if not target.exists():
        raise SystemExit(f"missing obsolete file before delete: {obsolete}")
    target.unlink()


# Architecture assertions.
app = read("app.js")
inv = read("investment-period-enhancement.js")
idx = read("index.html")
if "drawInvestmentCharts" in app:
    raise SystemExit("drawInvestmentCharts still present")
if any(token in inv for token in ["investmentCorrected", "investmentV2", "investmentTimelinePanel"]):
    raise SystemExit("legacy investment selectors still present in official renderer")
if any(token in idx for token in ["dashboard-reliability-fixes.js", "section-structure-cleanup.js"]):
    raise SystemExit("obsolete scripts still referenced in index")
