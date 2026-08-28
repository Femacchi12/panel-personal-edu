from pathlib import Path

p = Path('monthly-projection-control.js')
text = p.read_text(encoding='utf-8')
old = """    let host=root.querySelector('#monthlyProjectionSuite');
    if(!host){
      host=document.createElement('section');host.id='monthlyProjectionSuite';
      const head=root.querySelector(':scope > .section-head');
      if(head)head.insertAdjacentElement('afterend',host);else root.prepend(host);
    }
    renderSuite(host,stats);
"""
new = """    let host=root.querySelector('#monthlyProjectionSuite');
    if(!host){
      host=document.createElement('section');host.id='monthlyProjectionSuite';
      const head=root.querySelector(':scope > .section-head');
      if(head)head.insertAdjacentElement('afterend',host);else root.prepend(host);
    }
    let programmedHost=root.querySelector('#monthlyProgrammedHost');
    if(!programmedHost){programmedHost=document.createElement('section');programmedHost.id='monthlyProgrammedHost';programmedHost.className='monthly-detached-host';root.appendChild(programmedHost);}
    let comparisonHost=root.querySelector('#monthlyComparisonHost');
    if(!comparisonHost){comparisonHost=document.createElement('section');comparisonHost.id='monthlyComparisonHost';comparisonHost.className='monthly-detached-host';root.appendChild(comparisonHost);}
    renderSuite(host,stats);
    const programmed=host.querySelector('.monthly-programmed-panel');
    const comparison=host.querySelector('.monthly-comparison-panel');
    if(programmed)programmedHost.replaceChildren(programmed);else programmedHost.replaceChildren();
    if(comparison)comparisonHost.replaceChildren(comparison);else comparisonHost.replaceChildren();
"""
assert old in text, 'No se encontró el bloque monthly estable esperado'
text = text.replace(old,new,1)
old_css = "#monthlyProjectionSuite{display:grid;gap:12px;margin:0 0 4px}"
new_css = "#monthlyProjectionSuite{display:grid;gap:12px;margin:0 0 4px}.monthly-detached-host{display:contents}"
assert old_css in text, 'No se encontró CSS monthly suite'
text = text.replace(old_css,new_css,1)
p.write_text(text, encoding='utf-8')
