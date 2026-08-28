from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)


# app.js: stop loading/rendering investment/unused base data now owned elsewhere.
path = 'app.js'
text = read(path)
for line, label in [
    ("    {key:'inversiones', book:'finance', range:'Resumen_Inversiones!A:N', parser:'smart'},\n", 'source inversiones'),
    ("    {key:'posiciones', book:'finance', range:'Posiciones!A:X', parser:'smart'},\n", 'source posiciones'),
    ("    {key:'plan', book:'finance', range:'Plan_Mensual!A:O', parser:'smart'},\n", 'source plan'),
    ("    {key:'patrimonio', book:'finance', range:'Patrimonio_Mensual!A:X', parser:'smart'},\n", 'source patrimonio'),
]:
    text = replace_once(text, line, '', label)

old_render = re.search(r"  function renderGastos\(\) \{.*?\n  function renderFlujo", text, flags=re.S)
if not old_render:
    raise SystemExit('renderGastos block not found')
new_render = "  function renderGastos() {const rows=filteredMovements().filter(isExpense);return `${sectionHead('FINANZAS','Detalle de gastos','Histórico de consumos, comparación y base detallada')}${chartPanel('Evolución de gastos','Series por categoría / selección','spendChart',Math.max(760,periodCount(rows)*100))}<div class=\"panel table-panel\" hidden><div class=\"panel-header\"><div class=\"panel-title\"><strong>Movimientos</strong><span>Base sustituida por la tabla avanzada</span></div></div></div>`;}\n  function renderFlujo"
text = text[:old_render.start()] + new_render + text[old_render.end():]

# Dead helpers left behind after legacy investment renderer removal.
text, count = re.subn(r"  function latestSnapshot\(rows,dateKey='Fecha'\)\{.*?\}\n", '', text, count=1)
if count != 1:
    raise SystemExit(f'latestSnapshot removal: {count}')
text, count = re.subn(r"  function positionAmount\(row\)\{.*?\}\n", '', text, count=1)
if count != 1:
    raise SystemExit(f'positionAmount removal: {count}')
text = replace_once(
    text,
    "function latestDateLabel(rows,key){const snap=latestSnapshot(rows,key);return snap[0]?pick(snap[0],[key])||dateLabel(rowDate(snap[0])):''}",
    '',
    'latestDateLabel removal',
)
write(path, text)


# flow-financing-filter-fix.js: base expense KPIs are no longer rendered, so remove cleanup work.
path = 'flow-financing-filter-fix.js'
text = read(path)
text, count = re.subn(r"  function removeExpenseKpis\(\)\{.*?\n  \}\n", '', text, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f'removeExpenseKpis removal: {count}')
text = replace_once(
    text,
    "    if(view==='gastos'){removeExpenseKpis();redrawSpendChart(filtered);}else renderFinancing(filtered);",
    "    if(view==='gastos')redrawSpendChart(filtered);else renderFinancing(filtered);",
    'removeExpenseKpis call',
)
write(path, text)


# Assertions.
app = read('app.js')
flow = read('flow-financing-filter-fix.js')
for token in ["key:'inversiones'", "key:'posiciones'", "key:'plan'", "key:'patrimonio'", 'positionAmount(', 'latestSnapshot(', 'latestDateLabel(']:
    if token in app:
        raise SystemExit(f'app.js still contains {token}')
if 'removeExpenseKpis' in flow:
    raise SystemExit('flow-financing-filter-fix still contains removeExpenseKpis')
if 'Base sustituida por la tabla avanzada' not in app:
    raise SystemExit('advanced expense table anchor missing')
