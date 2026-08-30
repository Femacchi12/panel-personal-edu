(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const HEALTH_ID = String(cfg.healthSpreadsheetId || '');
  if (!HEALTH_ID) return;

  const RANGES = {
    patients: 'Pacientes!A:K',
    docs: 'Documentos!A:R',
    appointments: 'Citas_Medicas!A:N',
    treatments: 'Tratamientos!A:T',
    studies: 'Estudios_Resultados!A:M',
    events: 'Eventos_Salud!A:Q'
  };

  const FILTER_KEYS = {
    salud: { patient: 'healthPatient', area: 'healthArea' },
    citas: { patient: 'appointmentPatient', area: 'appointmentSpecialty' },
    tratamientos: { patient: 'treatmentPatient', area: 'treatmentArea' }
  };

  let frame = 0;
  let version = 0;

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return[];
    const headers=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!==''))
      .map(r=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,r?.[i]??''])));
  }

  function parseDate(value){
    const text=String(value||'').trim();
    if(!text)return null;
    let m=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(m)return new Date(+m[1],+m[2]-1,+m[3]);
    m=text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    const d=new Date(text);return Number.isNaN(d.getTime())?null:d;
  }

  function dateLabel(value){
    const d=parseDate(value); if(!d)return String(value||'—');
    return new Intl.DateTimeFormat('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
  }

  function today(){const d=new Date();d.setHours(0,0,0,0);return d;}
  function addDays(date,days){const d=new Date(date);d.setDate(d.getDate()+days);return d;}
  function patientNames(rows){return Object.fromEntries(rows.map(r=>[String(r['ID paciente']||''),String(r.Nombre||r['ID paciente']||'')]).filter(x=>x[0]));}
  function patientLabel(value,map){return map[String(value||'')]||String(value||'—').replace(/^PAC-/,'');}

  function selected(key){
    const state=window.__PANEL_SECTION_FILTERS__;
    return (state?.rules||[]).find(r=>r.key===key)?.values||[];
  }

  function rowArea(row){
    return row['Área']||row['Especialidad / Área']||row['Especialidad/Servicio']||row['Especialidad']||'';
  }

  function matchesViewFilters(row,view='salud'){
    const keys=FILTER_KEYS[view]||FILTER_KEYS.salud;
    const patients=selected(keys.patient);
    const areas=selected(keys.area);
    if(patients.length&&!patients.includes(String(row.Paciente||'')))return false;
    if(areas.length){
      const area=norm(rowArea(row));
      if(!areas.some(a=>area.includes(norm(a))||norm(a).includes(area)))return false;
    }
    return true;
  }

  function filtered(rows,view='salud'){
    return rows.filter(r=>matchesViewFilters(r,view));
  }

  function staleAppointments(rows,view='salud'){
    const t=today();
    return filtered(rows,view).filter(r=>{
      const d=parseDate(r.Fecha); const s=norm(r.Estado);
      return d&&d<t&&s.includes('programad');
    });
  }

  function isOpenTreatment(row){
    const status=norm(row.Estado);
    return status.includes('activ')||status.includes('seguimiento')||status.includes('mantenimiento')||status.includes('renovad');
  }

  function overdueTreatments(rows,view='salud'){
    const t=today();
    return filtered(rows,view).filter(r=>{
      const planned=parseDate(r['Fecha fin prevista']);
      const real=String(r['Fecha fin real']||'').trim();
      return planned&&planned<t&&!real&&isOpenTreatment(r);
    });
  }

  function upcomingTreatmentEnds(rows,view='salud',days=45){
    const t=today(),limit=addDays(t,days);
    return filtered(rows,view).filter(r=>{
      const planned=parseDate(r['Fecha fin prevista']);
      const real=String(r['Fecha fin real']||'').trim();
      return planned&&planned>=t&&planned<=limit&&!real&&isOpenTreatment(r);
    }).sort((a,b)=>(parseDate(a['Fecha fin prevista'])?.getTime()||0)-(parseDate(b['Fecha fin prevista'])?.getTime()||0));
  }

  function pendingStudies(rows){return filtered(rows,'salud').filter(r=>norm(r.Estado).includes('pend'));}
  function pendingDocs(rows){return filtered(rows,'salud').filter(r=>{const s=norm(r.Estado);return s&&s!=='vinculado';});}

  function latestDocs(rows){
    return filtered(rows,'salud').slice().sort((a,b)=>(parseDate(b['Fecha documento'])?.getTime()||0)-(parseDate(a['Fecha documento'])?.getTime()||0));
  }

  function latestEvents(rows){
    return filtered(rows,'salud').slice().sort((a,b)=>(parseDate(b['Fecha inicio'])?.getTime()||0)-(parseDate(a['Fecha inicio'])?.getTime()||0));
  }

  function docUrlMap(rows){
    const map=new Map();
    rows.forEach(r=>{
      const name=norm(r['Nombre archivo']);
      const url=String(r['URL directa']||'').trim();
      if(name&&url&&!map.has(name))map.set(name,url);
    });
    return map;
  }

  function docRows(rows,map){
    return rows.slice(0,12).map(r=>{
      const url=String(r['URL directa']||'').trim();
      const status=String(r.Estado||'Vinculado');
      return `<tr><td>${esc(dateLabel(r['Fecha documento']))}</td><td>${esc(patientLabel(r.Paciente,map))}</td><td>${esc(r['Área']||'—')}</td><td><strong>${esc(r['Nombre archivo']||'Documento')}</strong>${r['Grupo / Serie']?`<small>${esc(r['Grupo / Serie'])}</small>`:''}</td><td><span class="health-doc-status ${norm(status)==='vinculado'?'ok':'attention'}">${esc(status)}</span></td><td>${url?`<a class="doc-open-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir</a>`:'—'}</td></tr>`;
    }).join('');
  }

  function eventCards(rows,map,urls){
    return rows.slice(0,6).map(r=>{
      const doc=String(r.Documento||'').trim();
      const url=urls.get(norm(doc))||'';
      const diagnosis=String(r['Diagnóstico / Impresión']||r['Motivo / Síntoma']||'Sin detalle').trim();
      return `<div class="health-brief-item">
        <div class="health-brief-meta"><span>${esc(dateLabel(r['Fecha inicio']))}</span><span>${esc(patientLabel(r.Paciente,map))}</span><span>${esc(rowArea(r)||'General')}</span></div>
        <strong>${esc(r['Tipo evento']||'Evento de salud')}</strong>
        <small>${esc(diagnosis)}</small>
        <div class="health-brief-foot"><span>${esc(r.Estado||'—')}</span>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir soporte</a>`:''}</div>
      </div>`;
    }).join('');
  }

  function treatmentEndCards(rows,map){
    return rows.slice(0,6).map(r=>`<div class="health-brief-item">
      <div class="health-brief-meta"><span>${esc(dateLabel(r['Fecha fin prevista']))}</span><span>${esc(patientLabel(r.Paciente,map))}</span><span>${esc(r['Área']||'General')}</span></div>
      <strong>${esc(r['Medicamento / Intervención']||'Tratamiento')}</strong>
      <small>${esc(r['Indicación']||r['Respuesta / Cambios']||'Revisar continuidad.')}</small>
      <div class="health-brief-foot"><span>${esc(r.Estado||'—')}</span>${r.Documento?`<span>${esc(String(r.Documento))}</span>`:''}</div>
    </div>`).join('');
  }

  function attentionItems(data,map){
    const items=[];
    staleAppointments(data.appointments,'salud').forEach(r=>items.push({type:'Cita por confirmar',patient:patientLabel(r.Paciente,map),title:`${r['Especialidad/Servicio']||'Cita'} · ${dateLabel(r.Fecha)}`,detail:'La fecha ya pasó y el registro continúa como Programada.'}));
    overdueTreatments(data.treatments,'salud').forEach(r=>items.push({type:'Tratamiento por revisar',patient:patientLabel(r.Paciente,map),title:r['Medicamento / Intervención']||'Tratamiento',detail:`Fin previsto ${dateLabel(r['Fecha fin prevista'])}; continúa abierto en la fuente.`}));
    pendingStudies(data.studies).forEach(r=>items.push({type:'Estudio pendiente',patient:patientLabel(r.Paciente,map),title:r['Tipo de estudio']||'Estudio',detail:r.Observaciones||r['Resultado / Conclusión']||'Requiere validación.'}));
    pendingDocs(data.docs).forEach(r=>items.push({type:'Documento por revisar',patient:patientLabel(r.Paciente,map),title:r['Nombre archivo']||'Documento',detail:r['Control auditoría']||r.Estado}));
    return items;
  }

  function healthSummaryMarkup(data,map){
    const docs=latestDocs(data.docs);
    const pending=pendingDocs(data.docs);
    const stale=staleAppointments(data.appointments,'salud');
    const overdue=overdueTreatments(data.treatments,'salud');
    const upcoming=upcomingTreatmentEnds(data.treatments,'salud',45);
    const events=latestEvents(data.events);
    const urls=docUrlMap(data.docs);
    const attention=attentionItems(data,map);
    return `<section class="health-enhancement" aria-label="Control documental de salud">
      <div class="health-ops-strip">
        <div><strong>${docs.length}</strong><span>archivos indexados</span></div>
        <div><strong>${pending.length}</strong><span>documentos por revisar</span></div>
        <div><strong>${events.length}</strong><span>eventos clínicos</span></div>
        <div><strong>${stale.length}</strong><span>citas por confirmar</span></div>
        <div><strong>${overdue.length+upcoming.length}</strong><span>tratamientos a revisar / vencer</span></div>
      </div>
      <div class="health-enhance-grid">
        <div class="panel health-doc-panel"><div class="panel-header"><div class="panel-title"><strong>Archivos recientes de salud</strong><span>Fuente canónica: Documentos · últimos 12</span></div></div>
          <div class="table-scroll expanded"><table class="health-doc-table"><thead><tr><th>Fecha</th><th>Paciente</th><th>Área</th><th>Documento</th><th>Estado</th><th>Archivo</th></tr></thead><tbody>${docs.length?docRows(docs,map):'<tr><td colspan="6">Sin archivos para los filtros aplicados.</td></tr>'}</tbody></table></div>
        </div>
        <div class="panel health-attention-panel"><div class="panel-header"><div class="panel-title"><strong>Control de datos</strong><span>Alertas derivadas; no modifican el registro clínico</span></div></div>
          <div class="health-attention-list">${attention.length?attention.slice(0,8).map(i=>`<div class="health-attention-item"><span>${esc(i.type)}</span><strong>${esc(i.title)}</strong><small>${esc(i.patient)} · ${esc(i.detail)}</small></div>`).join(''):'<div class="health-empty-good">Sin controles pendientes detectados.</div>'}</div>
        </div>
      </div>
      <div class="health-brief-grid">
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Eventos clínicos recientes</strong><span>Últimos eventos según los filtros de Salud</span></div></div>
          <div class="health-brief-list">${events.length?eventCards(events,map,urls):'<div class="health-empty-good">Sin eventos para los filtros aplicados.</div>'}</div>
        </div>
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Próximos cierres de tratamiento</strong><span>Fechas previstas dentro de los próximos 45 días</span></div></div>
          <div class="health-brief-list">${upcoming.length?treatmentEndCards(upcoming,map):'<div class="health-empty-good">Sin tratamientos con cierre previsto en los próximos 45 días.</div>'}</div>
        </div>
      </div>
    </section>`;
  }

  function viewNoticeMarkup(kind,rows,map){
    if(!rows.length)return '';
    const label=kind==='citas'?'Citas con estado por confirmar':'Tratamientos con fecha de fin a revisar';
    const text=kind==='citas'?'La fecha ya pasó, pero la fuente todavía los marca como Programada.':'La fecha fin prevista ya pasó, no hay fecha fin real y el tratamiento continúa abierto.';
    return `<section class="health-derived-notice"><div><span>CONTROL DE DATOS</span><strong>${rows.length} ${label.toLowerCase()}</strong><small>${esc(text)}</small></div><div class="health-derived-tags">${rows.slice(0,5).map(r=>`<span>${esc(patientLabel(r.Paciente,map))} · ${esc(kind==='citas'?(r['Especialidad/Servicio']||dateLabel(r.Fecha)):(r['Medicamento / Intervención']||dateLabel(r['Fecha fin prevista'])))}</span>`).join('')}</div></section>`;
  }

  async function loadData(){
    const get=window.__PANEL_GET_SOURCE_VALUES__; if(typeof get!=='function')return null;
    const [patients,docs,appointments,treatments,studies,events]=await Promise.all([
      get(HEALTH_ID,RANGES.patients,false),get(HEALTH_ID,RANGES.docs,false),get(HEALTH_ID,RANGES.appointments,false),get(HEALTH_ID,RANGES.treatments,false),get(HEALTH_ID,RANGES.studies,false),get(HEALTH_ID,RANGES.events,false)
    ]);
    return {patients:parseRows(patients),docs:parseRows(docs),appointments:parseRows(appointments),treatments:parseRows(treatments),studies:parseRows(studies),events:parseRows(events)};
  }

  async function run(){
    const view=activeView(); if(!['salud','citas','tratamientos'].includes(view))return;
    const root=document.getElementById('viewRoot'); if(!root)return;
    const v=++version;
    try{
      const data=await loadData(); if(!data||v!==version||activeView()!==view||!root.isConnected)return;
      root.querySelectorAll('.health-enhancement,.health-derived-notice').forEach(x=>x.remove());
      const map=patientNames(data.patients);
      if(view==='salud'){
        const anchor=root.querySelector('.kpi-grid');
        const wrap=document.createElement('div'); wrap.innerHTML=healthSummaryMarkup(data,map);
        const node=wrap.firstElementChild; if(anchor)anchor.insertAdjacentElement('afterend',node); else root.appendChild(node);
      }else{
        const rows=view==='citas'?staleAppointments(data.appointments,'citas'):overdueTreatments(data.treatments,'tratamientos');
        if(rows.length){const wrap=document.createElement('div');wrap.innerHTML=viewNoticeMarkup(view,rows,map);const node=wrap.firstElementChild;const head=root.querySelector('.section-head');if(head)head.insertAdjacentElement('afterend',node);else root.prepend(node);}
      }
    }catch(error){console.error('Health dashboard enhancement:',error);}
  }

  function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;run();});}
  document.addEventListener('panel:view-root-changed',schedule);
  document.addEventListener('panel:section-filters-changed',e=>{if(['salud','citas','tratamientos'].includes(e.detail?.view))schedule();});
  document.addEventListener('panel:backend-data-loaded',schedule);
  document.addEventListener('panel:modules-ready',schedule);
  queueMicrotask(schedule);
})();
