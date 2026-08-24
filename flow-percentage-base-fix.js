(() => {
  'use strict';
  let timer=null, applying=false;
  const MONTHS={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function monthKey(v){const s=norm(v);let m=s.match(/^(20\d{2})-(\d{1,2})/);if(m)return `${m[1]}-${String(+m[2]).padStart(2,'0')}`;m=s.match(/^(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(20\d{2})/);return m?`${m[2]}-${String(MONTHS[m[1]]).padStart(2,'0')}`:'';}
  function num(v){if(typeof v==='number')return Number.isFinite(v)?v:0;let s=String(v??'').trim().replace(/[^\d,.\-]/g,'');if(!s)return 0;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(c>=0){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0].replace(/\./g,'')+'.'+p[1]:s.replace(/,/g,'');}else if(d>=0){const p=s.split('.');if(p.length>2||(p.length===2&&p[1].length===3))s=s.replace(/\./g,'');}const n=Number(s);return Number.isFinite(n)?n:0;}
  const pct=v=>`${new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1}).format((Number(v)||0)*100)}%`;
  function cls(v){const p=(Number(v)||0)*100;return p>15?'pct-red':p>10?'pct-yellow':p>5?'pct-green':'pct-white';}
  function active(){return document.querySelector('.nav-item.active')?.dataset.view==='flujo';}
  function recalc(){
    if(applying||!active())return;
    const table=document.querySelector('.flow-matrix-advanced'); if(!table)return;
    const baseByMonth=new Map();
    document.querySelectorAll('.salary-reference-grid > div').forEach(card=>{const key=monthKey(card.querySelector('span')?.textContent||'');const base=num(card.querySelector('strong')?.textContent);if(key&&base>0)baseByMonth.set(key,base);});
    if(!baseByMonth.size)return;
    const monthHeaders=[...table.querySelectorAll('thead tr:first-child th[data-flow-sort-month]')];
    const monthKeys=monthHeaders.map(th=>th.dataset.flowSortMonth||monthKey(th.textContent));
    applying=true;
    try{
      table.querySelectorAll('tbody tr').forEach(row=>{
        monthKeys.forEach((key,i)=>{
          const base=baseByMonth.get(key); if(!(base>0))return;
          const amountCell=row.cells?.[2+i*2], pctCell=row.cells?.[3+i*2]; if(!amountCell||!pctCell)return;
          const share=num(amountCell.textContent)/base;
          let span=pctCell.querySelector('.matrix-pct'); if(!span){span=document.createElement('span');span.className='matrix-pct';pctCell.textContent='';pctCell.appendChild(span);}
          span.textContent=pct(share); span.classList.remove('pct-white','pct-green','pct-yellow','pct-red'); span.classList.add(cls(share));
        });
      });
    }finally{applying=false;}
  }
  function schedule(delay=120){clearTimeout(timer);timer=setTimeout(recalc,delay);}
  document.addEventListener('click',e=>{if(e.target.closest?.('.nav-item,.multi-filter-option,.currency-btn,#refreshBtn,#resetCurrentMonth,#clearFilters'))[150,450,900,1600].forEach(ms=>setTimeout(recalc,ms));},true);
  const root=document.getElementById('viewRoot');if(root)new MutationObserver(ms=>{if(!applying&&ms.some(m=>m.type==='childList'||m.type==='characterData'))schedule();}).observe(root,{childList:true,subtree:true,characterData:true});
  [600,1200,2200,4000].forEach(ms=>setTimeout(recalc,ms));
})();