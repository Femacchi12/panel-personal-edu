from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing exact block: {label}')
    return text.replace(old, new, 1)

# app.js
path = Path('app.js')
text = path.read_text(encoding='utf-8')
old_sources = """    {key:'docsFinancieros', book:'documents', range:'Documentos_Financieros!A:L', parser:'smart'},\n    {key:'docsIdentidad', book:'documents', range:'Documentos_Identidad!A:N', parser:'smart'},\n    {key:'docsLaborales', book:'documents', range:'Documentos_Laborales!A:L', parser:'smart'},\n    {key:'docsTributarios', book:'documents', range:'Documentos_Tributarios!A:L', parser:'smart'},\n    {key:'docsPensionCesantias', book:'documents', range:'Documentos_Pension_Cesantias!A:L', parser:'smart'},\n    {key:'docsPersonales', book:'documents', range:'Documentos_Personales!A:L', parser:'smart'},\n"""
new_sources = "    {key:'documentos', book:'documents', range:'Documentos_Master!A:R', parser:'smart'},\n"
text = replace_once(text, old_sources, new_sources, 'app document sources')
old_merge = """      next.documentos = [\n        ...(next.docsFinancieros||[]),\n        ...(next.docsIdentidad||[]),\n        ...(next.docsLaborales||[]),\n        ...(next.docsTributarios||[]),\n        ...(next.docsPensionCesantias||[]),\n        ...(next.docsPersonales||[]),\n        ...(next.docsSalud||[])\n      ];\n"""
text = replace_once(text, old_merge, '', 'app document merge')
pattern = re.compile(r"  function renderDocumentos\(\) \{.*?\}\n  function renderViajes\(\)", re.S)
replacement = """  function renderDocumentos() {return `${sectionHead('VIDA','Documentos','Índice documental, datos copiables y control de vigencias')}<div id=\"documentsMasterHost\"></div>`;}\n  function renderViajes()"""
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit('renderDocumentos replacement failed')
text = text.replace('tratamientos:drawTreatmentsChart,documentos:drawDocumentsChart,viajes:drawTravelChart', 'tratamientos:drawTreatmentsChart,viajes:drawTravelChart', 1)
path.write_text(text, encoding='utf-8')

# backend/server.js
path = Path('backend/server.js')
text = path.read_text(encoding='utf-8')
old_backend = """  { book: 'documents', range: 'Documentos_Financieros!A:L' },\n  { book: 'documents', range: 'Documentos_Identidad!A:N' },\n  { book: 'documents', range: 'Documentos_Laborales!A:L' },\n  { book: 'documents', range: 'Documentos_Tributarios!A:L' },\n  { book: 'documents', range: 'Documentos_Pension_Cesantias!A:L' },\n  { book: 'documents', range: 'Documentos_Personales!A:L' },\n"""
text = replace_once(text, old_backend, "  { book: 'documents', range: 'Documentos_Master!A:R' },\n", 'backend document sources')
text = text.replace("revision: 'single-nu-installment-master-2026-08-28'", "revision: 'documents-master-2026-08-29'", 1)
path.write_text(text, encoding='utf-8')

# section-data-filters.js
path = Path('section-data-filters.js')
text = path.read_text(encoding='utf-8')
pattern = re.compile(r"    documentos: \{ global:\['year','month'\], local:\[.*?\n    \]\},\n    viajes:", re.S)
replacement = """    documentos: { global:[], local:[\n      filter('documentArea','Área',[src('Documentos_Master!A:R',['Área'],DOCUMENTS_ID)]),\n      filter('documentHolder','Titular',[src('Documentos_Master!A:R',['Titular'],DOCUMENTS_ID)]),\n      filter('documentCategory','Categoría / tipo',[src('Documentos_Master!A:R',['Categoría','Tipo'],DOCUMENTS_ID)]),\n      filter('documentStatus','Estado',[src('Documentos_Master!A:R',['Estado'],DOCUMENTS_ID)]),\n      filter('documentEntity','País / Entidad',[src('Documentos_Master!A:R',['País / Entidad'],DOCUMENTS_ID)])\n    ]},\n    viajes:"""
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit('documents filter config replacement failed')
old_apply = """  async function applyLocalChange(view){\n    setCurrentFilterState(view);\n    updateLocalControls(view);\n    document.querySelectorAll('#sectionFilterBar .local-multi-filter.open').forEach(root=>{\n      root.classList.remove('open');\n      root.querySelector('.local-trigger')?.setAttribute('aria-expanded','false');\n    });\n    if(view==='inversiones'){\n      document.getElementById('investmentV2ModeFilter')?.remove();\n      document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));\n      return;\n    }\n"""
new_apply = """  async function applyLocalChange(view){\n    setCurrentFilterState(view);\n    updateLocalControls(view);\n    document.querySelectorAll('#sectionFilterBar .local-multi-filter.open').forEach(root=>{\n      root.classList.remove('open');\n      root.querySelector('.local-trigger')?.setAttribute('aria-expanded','false');\n    });\n    if(view==='inversiones'||view==='documentos'){\n      if(view==='inversiones')document.getElementById('investmentV2ModeFilter')?.remove();\n      document.dispatchEvent(new CustomEvent('panel:section-filters-changed',{detail:{view}}));\n      return;\n    }\n"""
text = replace_once(text, old_apply, new_apply, 'documents local filter fast path')
path.write_text(text, encoding='utf-8')

# auth.js
path = Path('auth.js')
text = path.read_text(encoding='utf-8')
text = replace_once(text, '      "income-doc-enhancements.js",\n', '      "income-doc-enhancements.js",\n      "documents-master-controller.js",\n', 'auth controller module')
path.write_text(text, encoding='utf-8')

# index.html
path = Path('index.html')
text = path.read_text(encoding='utf-8')
text = replace_once(text, '  <link rel="stylesheet" href="chart-fixed-axis.css?v=20260828-1819" />\n', '  <link rel="stylesheet" href="chart-fixed-axis.css?v=20260828-1819" />\n  <link rel="stylesheet" href="documents-master.css?v=20260829-1300" />\n', 'documents css link')
path.write_text(text, encoding='utf-8')

print('documents master migration patched successfully')
