(() => {
  'use strict';

  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';

  function injectStyles(){
    if(document.getElementById('servicesTableEnhancementStyles'))return;
    const style=document.createElement('style');style.id='servicesTableEnhancementStyles';style.textContent=`
      #rentalPaymentInfo{display:none!important}
      #viewRoot .services-table-observations-header{min-width:360px!important;width:360px!important}
      #viewRoot .services-table-observations-cell{min-width:360px!important;width:360px!important;max-width:480px!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;line-height:1.5!important;vertical-align:top!important}
      #viewRoot .services-table-observations-cell .rent-observation-line{display:block;white-space:normal}
      #viewRoot .services-table-observations-cell .rent-observation-line + .rent-observation-line{margin-top:4px;color:#aebccd}
      #viewRoot .services-table-observations-cell strong{color:#dce7f6;font-weight:700}
      @media(max-width:720px){#viewRoot .services-table-observations-header,#viewRoot .services-table-observations-cell{min-width:300px!important;width:300px!important;max-width:360px!important}}
    `;document.head.appendChild(style);
  }

  function findServicesTable(root){return[...root.querySelectorAll('table')].find(table=>{const headers=[...table.querySelectorAll('thead th')].map(th=>norm(th.textContent));return headers.includes('servicio')&&headers.includes('observaciones');})||null;}
  function splitRentObservation(text){const parts=String(text||'').trim().split('·').map(x=>x.trim()).filter(Boolean);if(parts.length<2)return null;return{first:parts.slice(0,2).join(' · '),second:parts.slice(2).join(' · ')};}

  async function copyText(value,element){
    const text=String(value||'').trim();if(!text)return;
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);
      else{
        const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';
        document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();
      }
      element?.classList.add('copied');
      element?.setAttribute('title','Copiado');
      setTimeout(()=>{element?.classList.remove('copied');element?.setAttribute('title','Presiona para copiar');},1100);
    }catch(error){console.warn('No se pudo copiar el dato del servicio:',error);}
  }

  function makeCellCopyable(cell){
    if(!cell||cell.dataset.copyEnhanced==='1')return;
    const value=String(cell.textContent||'').trim();
    if(!value||value==='—')return;
    cell.textContent='';
    const control=document.createElement('span');
    control.className='service-table-copy-value';
    control.textContent=value;
    control.tabIndex=0;
    control.setAttribute('role','button');
    control.setAttribute('title','Presiona para copiar');
    control.addEventListener('click',()=>copyText(value,control));
    control.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();copyText(value,control);}
    });
    cell.appendChild(control);
    cell.dataset.copyEnhanced='1';
  }

  function enhanceServicesTable(root=document.getElementById('viewRoot')){
    if(activeView()!=='servicios'||!root)return;
    const table=findServicesTable(root);if(!table)return;
    const headers=[...table.querySelectorAll('thead th')],names=headers.map(th=>norm(th.textContent));
    const serviceIndex=names.indexOf('servicio'),observationsIndex=names.indexOf('observaciones'),statusIndex=names.indexOf('estado mes');if(serviceIndex<0||observationsIndex<0)return;
    const copyIndexes=['numero de referencia','banco','tipo de cuenta','numero de cuenta'].map(name=>names.indexOf(name)).filter(index=>index>=0);
    headers[observationsIndex]?.classList.add('services-table-observations-header');
    headers[statusIndex]?.classList.add('services-status-header');
    table.querySelectorAll('tbody tr').forEach(row=>{
      const cells=[...row.children],serviceCell=cells[serviceIndex],observationsCell=cells[observationsIndex],statusCell=statusIndex>=0?cells[statusIndex]:null;if(!serviceCell||!observationsCell)return;
      copyIndexes.forEach(index=>makeCellCopyable(cells[index]));
      if(statusCell&&statusCell.dataset.statusEnhanced!=='1'){
        const raw=String(statusCell.textContent||'').trim(),key=norm(raw);
        statusCell.textContent='';
        const badge=document.createElement('span');
        badge.className='services-month-status '+(key.includes('pagad')?'paid':key.includes('pend')?'pending':'neutral');
        badge.textContent=raw||'—';
        statusCell.appendChild(badge);
        statusCell.dataset.statusEnhanced='1';
      }
      observationsCell.classList.add('services-table-observations-cell');observationsCell.removeAttribute('title');
      if(norm(serviceCell.textContent)!=='arriendo'||observationsCell.dataset.rentFormatted==='1')return;
      const split=splitRentObservation(observationsCell.textContent);if(!split)return;
      observationsCell.textContent='';const line1=document.createElement('span');line1.className='rent-observation-line';line1.textContent=split.first;const line2=document.createElement('span');line2.className='rent-observation-line';line2.textContent=split.second;observationsCell.append(line1,line2);observationsCell.dataset.rentFormatted='1';
    });
  }

  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{if(event.detail?.view==='servicios')enhanceServicesTable(event.detail.root);});
  queueMicrotask(()=>enhanceServicesTable());
})();
