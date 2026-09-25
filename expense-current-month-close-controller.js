(() => {
  'use strict';

  const cfg=window.PANEL_CONFIG||{};
  const financeId=String(cfg.financeSpreadsheetId||'');
  if(!financeId)return;

  const MONTHS=['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  let frame=0,version=0,observer=null,observedRoot=null;

  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const activeView=()=>document.querySelector('.nav-item.active')?.dataset.view||'';
  const money=v=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0);

  function num(value){
    if(typeof value==='number')return Number.isFinite(value)?value:0;
    let s=String(value??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0)s=c>d?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
    else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}
    else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function monthKey(value){
    const s=norm(value);let m=s.match(/^(20\d{2})-(\d{1,2})/);if(m)return`${m[1]}-${String(+m[2]).padStart(2,'0')}`;
    const map={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)[\s-]+(20\d{2})/);
    return m?`${m[2]}-${String(map[m[1]]).padStart(2,'0')}`:'';
  }
  function rowMonth(row){return monthKey(row['Mes consumo']||row['Mes pago']||row['Fecha real']||row['Fecha registrada']);}
  function currentMonthKey(){const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
  function previousMonth(key){const [y,m]=String(key).split('-').map(Number);const d=new Date(y,m-2,1);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
  function monthLabel(key){const [y,m]=String(key).split('-').map(Number);return Number.isFinite(y)&&Number.isFinite(m)?`${MONTHS[m-1]} ${y}`:key;}
  function scopeOf(row) {
    const explicit = norm(row['Ámbito'] || row.Ambito);
    return explicit.includes('fibrazo') ? 'FIBRAZO' : 'Personal';
  }
  function status(row){return norm(row.Estado);}
  function isActual(row){return norm(row.Tipo)==='gasto'&&(window.MovementStatusCore?.isActual(row.Estado)??!/proyecc|proyect|programad/.test(status(row)));}
  function isProjection(row){return norm(row.Tipo)==='gasto'&&(window.MovementStatusCore?.isProjection(row.Estado)??/proyecc|proyect|programad/.test(status(row)));}
  function isFixed(row){return/^(si|sí|true|1)$/i.test(String(row['Es fijo']||'').trim());}
  function isSuper(row){return norm(row['Categoría'])==='supermercado';}
  function sum(rows){return rows.reduce((s,row)=>s+num(row['Monto COP']),0);}

  function parseRows(values){if(!Array.isArray(values)||values.length<2)return[];const h=(values[0]||[]).map(v=>String(v??'').trim());return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k||`Col ${i+1}`,r?.[i]??''])));}

  async function rows(){
    const getData=window.__PANEL_GET_BACKEND_DATA__;if(typeof getData!=='function')return[];
    const payload=await getData(false),cached=window.__PANEL_GET_CACHED_ROWS__;
    if(typeof cached==='function'){
      const wide=cached(payload,financeId,'Movimientos!A:AA');
      return wide.length?wide:cached(payload,financeId,'Movimientos!A:Z');
    }
    return parseRows(payload?.sources?.[`${financeId}|Movimientos!A:AA`]||payload?.sources?.[`${financeId}|Movimientos!A:Z`]||[]);
  }

  function activeScope(){
    return window.__FINANCE_SCOPE_FILTER_STATE__?.gastos || 'Personal';
  }

  function stats(source,scope=activeScope()){
    const key=currentMonthKey(),prev=previousMonth(key);
    const scoped=scope==='Todos'?source:source.filter(row=>scopeOf(row)===scope);
    const actual=scoped.filter(row=>rowMonth(row)===key&&isActual(row));
    const previous=scoped.filter(row=>rowMonth(row)===prev&&isActual(row));
    const projections=scoped.filter(row=>rowMonth(row)===key&&isProjection(row));
    const groups={super:{current:0,previous:0,projection:0},fixed:{current:0,previous:0,projection:0}};
    actual.forEach(row=>{const value=num(row['Monto COP']);if(isSuper(row))groups.super.current+=value;if(isFixed(row))groups.fixed.current+=value;});
    previous.forEach(row=>{const value=num(row['Monto COP']);if(isSuper(row))groups.super.previous+=value;if(isFixed(row))groups.fixed.previous+=value;});
    projections.forEach(row=>{const value=num(row['Monto COP']);if(isSuper(row))groups.super.projection+=value;if(isFixed(row))groups.fixed.projection+=value;});
    const supermarketGap=Math.max(0,groups.super.previous-groups.super.current-groups.super.projection);
    const fixedGap=Math.max(0,groups.fixed.previous-groups.fixed.current-groups.fixed.projection);
    const realTotal=sum(actual),projectionTotal=sum(projections),recurringGap=supermarketGap+fixedGap;
    return{key,scope,realTotal,projectionTotal,recurringGap,projectedTotal:realTotal+projectionTotal+recurringGap,projections};
  }

  function setText(node,value){if(node&&node.textContent!==value)node.textContent=value;}
  function stabilize(root){
    const head=[...root.children].find(node=>node.matches?.('.section-head'))||null;
    const monthly=[...root.children].find(node=>node.id==='monthlyProjectionSuite')||null;
    const context=[...root.children].find(node=>node.matches?.('.finance-context'))||null;
    if(monthly&&head&&monthly.previousElementSibling!==head)head.insertAdjacentElement('afterend',monthly);
    const anchor=monthly||head;
    if(context&&anchor&&context.previousElementSibling!==anchor)anchor.insertAdjacentElement('afterend',context);
  }

  function patchClose(root,data){
    const suite=root.querySelector(':scope > #monthlyProjectionSuite');
    const panel=suite?.querySelector('.monthly-close-panel');
    if(!panel)return false;
    const title=panel.querySelector('.panel-title strong');
    const subtitle=panel.querySelector('.panel-title span');
    setText(title,`Cierre estimado mes actual · ${monthLabel(data.key)}`);
    setText(subtitle,`Mes actual fijo · responde al ámbito ${data.scope}; los demás filtros no modifican este bloque.`);

    const items=[...panel.querySelectorAll('.monthly-kpis > div')];
    if(items.length>=4){
      const projectionOn=Boolean(panel.querySelector('#monthlyProjectionToggle')?.checked);
      const considered=projectionOn?data.projectedTotal:data.realTotal;
      setText(items[0].querySelector('span'),'Real hasta hoy');
      setText(items[0].querySelector('strong'),money(data.realTotal));
      setText(items[0].querySelector('small'),`Movimientos realizados · ${data.scope}`);
      setText(items[1].querySelector('span'),'Proyección pendiente');
      setText(items[1].querySelector('strong'),money(data.projectionTotal));
      setText(items[1].querySelector('small'),`${data.projections.length} gasto${data.projections.length===1?'':'s'} · ${data.scope}`);
      setText(items[2].querySelector('span'),'Faltante recurrente');
      setText(items[2].querySelector('strong'),money(data.recurringGap));
      setText(items[2].querySelector('small'),`Supermercado + fijos/servicios · ${data.scope}`);
      setText(items[3].querySelector('span'),'Total considerado');
      setText(items[3].querySelector('strong'),money(considered));
      setText(items[3].querySelector('small'),projectionOn?`Real + cierre estimado · ${data.scope}`:`Solo gasto real · ${data.scope}`);
      items[3].classList.toggle('projected',projectionOn);
      items[3].classList.toggle('actual',!projectionOn);
    }
    panel.dataset.currentMonthFixed=data.key;
    return true;
  }

  async function apply(runVersion){
    if(activeView()!=='gastos')return;
    const root=document.getElementById('viewRoot');if(!root)return;
    const source=await rows();
    if(runVersion!==version||activeView()!=='gastos'||!root.isConnected)return;
    stabilize(root);
    patchClose(root,stats(source,activeScope()));
    stabilize(root);
    observe(root);
  }

  function observe(root){
    if(root===observedRoot)return;
    observer?.disconnect();observedRoot=root;
    observer=new MutationObserver(mutations=>{
      if(activeView()!=='gastos')return;
      if(mutations.some(m=>m.type==='childList'))schedule();
    });
    observer.observe(root,{childList:true,subtree:true});
  }

  function schedule(){
    if(activeView()!=='gastos')return;
    version++;
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      const runVersion=version;
      setTimeout(()=>apply(runVersion).catch(error=>console.error('Cierre mes actual:',error)),36);
    });
  }

  ['panel:view-root-changed','panel:section-modules-ready','panel:filters-updated','panel:payment-filters-changed','panel:expense-scope-changed','panel:backend-data-loaded','panel:monthly-projection-change'].forEach(name=>document.addEventListener(name,schedule));
  queueMicrotask(schedule);
})();