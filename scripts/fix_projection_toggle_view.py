from pathlib import Path

p = Path('monthly-projection-control.js')
text = p.read_text(encoding='utf-8')

old_handler = "    host.querySelector('#monthlyProjectionToggle')?.addEventListener('change',e=>{setProjection(e.target.checked);renderSuite(host,stats);});"
new_handler = "    host.querySelector('#monthlyProjectionToggle')?.addEventListener('change',e=>{setProjection(e.target.checked);schedule(false,0);});"
assert old_handler in text, 'No se encontró el handler esperado del toggle mensual'
text = text.replace(old_handler, new_handler, 1)

old_layout = """    renderSuite(host,stats);
    const programmed=host.querySelector('.monthly-programmed-panel');
    const comparison=host.querySelector('.monthly-comparison-panel');
    if(programmed)programmedHost.replaceChildren(programmed);else programmedHost.replaceChildren();
    if(comparison)comparisonHost.replaceChildren(comparison);else comparisonHost.replaceChildren();
"""
new_layout = """    renderSuite(host,stats);
    const programmed=host.querySelector('.monthly-programmed-panel');
    const comparison=host.querySelector('.monthly-comparison-panel');
    const projectionOn=stats.current&&includeProjection();
    if(projectionOn){
      programmedHost.replaceChildren();
      comparisonHost.replaceChildren();
    }else{
      if(programmed)programmedHost.replaceChildren(programmed);else programmedHost.replaceChildren();
      if(comparison)comparisonHost.replaceChildren(comparison);else comparisonHost.replaceChildren();
    }
"""
assert old_layout in text, 'No se encontró el bloque de distribución mensual esperado'
text = text.replace(old_layout, new_layout, 1)

p.write_text(text, encoding='utf-8')
