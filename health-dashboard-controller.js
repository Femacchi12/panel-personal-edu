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
  let running = false;
  let rerun = false;

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeView = () => document.querySelector('.nav-item.active')?.dataset.view || '';

  function parseRows(values){
    if(!Array.isArray(values)||values.length<2)return[];
    const headers=(values[0]||[]).map(v=>String(v??'').trim());
    return values.slice(1).filter(r=>r?.some(v=>String(v??'').trim()!==''))
      .map(r=>Object.fromEntries(headers.map((h,i)=>[h||`Col ${i+1}`,r?.[i]??''])));
  }

  function rowsFromPayload(payload,range){
    const cached=window.__PANEL_GET_CACHED_ROWS__;
    if(typeof cached==='function')return cached(payload,HEALTH_ID,range);
    return parseRows(payload?.sources?.[`${HEALTH_ID}|${range}`]||[]);
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

  function filterState(view='salud'){
    const keys=FILTER_KEYS[view]||FILTER_KEYS.salud;
    const rules=window.__PANEL_SECTION_FILTERS__?.rules||[];
    const values=key=>(rules.find(r=>r.key===key)?.values||[]).map(v=>String(v||'').trim()).filter(Boolean);
    return {
      patients:new Set(values(keys.patient)),
      areas:values(keys.area).map(norm).filter(Boolean)
    };
  }

  function rowArea(row){
    return row['Área']||row['Especialidad / Área']||row['Especialidad/Servicio']||row['Especialidad']||'';
  }

  function matchesFilters(row,state){
    if(state.patients.size&&!state.patients.has(String(row.Paciente||'')))return false;
    if(state.areas.length){
      const area=norm(rowArea(row));
      if(!state.areas.some(a=>area.includes(a)||a.includes(area)))return false;
    }
    return true;
  }

  function filterRows(rows,state){return (rows||[]).filter(r=>matchesFilters(r,state));}

  function staleAppointments(rows,t=today()){
    return rows.filter(r=>{
      const d=parseDate(r.Fecha),s=norm(r.Estado);
      return d&&d<t&&s.includes('programad');
    });
  }

  function isOpenTreatment(row){
    const status=norm(row.Estado);
    return status.includes('activ')||status.includes('seguimiento')||status.includes('mantenimiento')||status.includes('renovad');
  }

  function overdueTreatments(rows,t=today()){
    return rows.filter(r=>{
      const planned=parseDate(r['Fecha fin prevista']);
      const real=String(r['Fecha fin real']||'').trim();
      return planned&&planned<t&&!real&&isOpenTreatment(r);
    });
  }

  function upcomingTreatmentEnds(rows,days=45,t=today()){
    const limit=addDays(t,days),out=[];
    rows.forEach(r=>{
      const planned=parseDate(r['Fecha fin prevista']);
      const real=String(r['Fecha fin real']||'').trim();
      if(planned&&planned>=t&&planned<=limit&&!real&&isOpenTreatment(r))out.push({row:r,time:planned.getTime()});
    });
    return out.sort((a,b)=>a.time-b.time).map(x=>x.row);
  }

  function pendingStudies(rows){return rows.filter(r=>norm(r.Estado).includes('pend'));}
  function pendingDocs(rows){return rows.filter(r=>{const s=norm(r.Estado);return s&&s!=='vinculado';});}

  function latestByDate(rows,field){
    return rows.map(r=>({row:r,time:parseDate(r[field])?.getTime()||0})).sort((a,b)=>b.time-a.time).map(x=>x.row);
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

  function attentionItems(derived,map){
    const items=[];
    derived.stale.forEach(r=>items.push({type:'Cita por confirmar',patient:patientLabel(r.Paciente,map),title:`${r['Especialidad/Servicio']||'Cita'} · ${dateLabel(r.Fecha)}`,detail:'La fecha ya pasó y el registro continúa como Programada.'}));
    derived.overdue.forEach(r=>items.push({type:'Tratamiento por revisar',patient:patientLabel(r.Paciente,map),title:r['Medicamento / Intervención']||'Tratamiento',detail:`Fin previsto ${dateLabel(r['Fecha fin prevista'])}; continúa abierto en la fuente.`}));
    derived.pendingStudies.forEach(r=>items.push({type:'Estudio pendiente',patient:patientLabel(r.Paciente,map),title:r['Tipo de estudio']||'Estudio',detail:r.Observaciones||r['Resultado / Conclusión']||'Requiere validación.'}));
    derived.pendingDocs.forEach(r=>items.push({type:'Documento por revisar',patient:patientLabel(r.Paciente,map),title:r['Nombre archivo']||'Documento',detail:r['Control auditoría']||r.Estado}));
    return items;
  }

  function deriveHealth(data){
    const state=filterState('salud'),t=today();
    const docs=filterRows(data.docs,state);
    const appointments=filterRows(data.appointments,state);
    const treatments=filterRows(data.treatments,state);
    const studies=filterRows(data.studies,state);
    const events=filterRows(data.events,state);
    return {
      docs:latestByDate(docs,'Fecha documento'),
      pendingDocs:pendingDocs(docs),
      stale:staleAppointments(appointments,t),
      overdue:overdueTreatments(treatments,t),
      upcoming:upcomingTreatmentEnds(treatments,45,t),
      events:latestByDate(events,'Fecha inicio'),
      pendingStudies:pendingStudies(studies),
      urls:docUrlMap(docs)
    };
  }

  function healthSummaryMarkup(data,map){
    const derived=deriveHealth(data);
    const attention=attentionItems(derived,map);
    return `<section class="health-enhancement" aria-label="Control documental de salud">
      <div class="health-ops-strip">
        <div><strong>${derived.docs.length}</strong><span>archivos indexados</span></div>
        <div><strong>${derived.pendingDocs.length}</strong><span>documentos por revisar</span></div>
        <div><strong>${derived.events.length}</strong><span>eventos clínicos</span></div>
        <div><strong>${derived.stale.length}</strong><span>citas por confirmar</span></div>
        <div><strong>${derived.overdue.length+derived.upcoming.length}</strong><span>tratamientos a revisar / vencer</span></div>
      </div>
      <div class="health-enhance-grid">
        <div class="panel health-doc-panel"><div class="panel-header"><div class="panel-title"><strong>Archivos recientes de salud</strong><span>Fuente canónica: Documentos · últimos 12</span></div></div>
          <div class="table-scroll expanded"><table class="health-doc-table"><thead><tr><th>Fecha</th><th>Paciente</th><th>Área</th><th>Documento</th><th>Estado</th><th>Archivo</th></tr></thead><tbody>${derived.docs.length?docRows(derived.docs,map):'<tr><td colspan="6">Sin archivos para los filtros aplicados.</td></tr>'}</tbody></table></div>
        </div>
        <div class="panel health-attention-panel"><div class="panel-header"><div class="panel-title"><strong>Control de datos</strong><span>Alertas derivadas; no modifican el registro clínico</span></div></div>
          <div class="health-attention-list">${attention.length?attention.slice(0,8).map(i=>`<div class="health-attention-item"><span>${esc(i.type)}</span><strong>${esc(i.title)}</strong><small>${esc(i.patient)} · ${esc(i.detail)}</small></div>`).join(''):'<div class="health-empty-good">Sin controles pendientes detectados.</div>'}</div>
        </div>
      </div>
      <div class="health-brief-grid">
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Eventos clínicos recientes</strong><span>Últimos eventos según los filtros de Salud</span></div></div>
          <div class="health-brief-list">${derived.events.length?eventCards(derived.events,map,derived.urls):'<div class="health-empty-good">Sin eventos para los filtros aplicados.</div>'}</div>
        </div>
        <div class="panel"><div class="panel-header"><div class="panel-title"><strong>Próximos cierres de tratamiento</strong><span>Fechas previstas dentro de los próximos 45 días</span></div></div>
          <div class="health-brief-list">${derived.upcoming.length?treatmentEndCards(derived.upcoming,map):'<div class="health-empty-good">Sin tratamientos con cierre previsto en los próximos 45 días.</div>'}</div>
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

  async function loadData(force=false){
    const appData=window.__PANEL_APP_DATA__;
    if(appData&&typeof appData==='object'&&Array.isArray(appData.pacientes)){
      return {
        patients:appData.pacientes||[],
        docs:appData.docsSalud||[],
        appointments:appData.citas||[],
        treatments:appData.tratamientos||[],
        studies:appData.estudios||[],
        events:appData.eventosSalud||[]
      };
    }
    const getData=window.__PANEL_GET_BACKEND_DATA__; if(typeof getData!=='function')return null;
    const payload=await getData(force);
    return {
      patients:rowsFromPayload(payload,RANGES.patients),
      docs:rowsFromPayload(payload,RANGES.docs),
      appointments:rowsFromPayload(payload,RANGES.appointments),
      treatments:rowsFromPayload(payload,RANGES.treatments),
      studies:rowsFromPayload(payload,RANGES.studies),
      events:rowsFromPayload(payload,RANGES.events)
    };
  }

  async function run(){
    const view=activeView(); if(!['salud','citas','tratamientos'].includes(view))return;
    const root=document.getElementById('viewRoot'); if(!root)return;
    if(running){rerun=true;return;}
    running=true;
    const v=++version;
    try{
      const data=await loadData(false); if(!data||v!==version||activeView()!==view||!root.isConnected)return;
      root.querySelectorAll('.health-enhancement,.health-derived-notice').forEach(x=>x.remove());
      const map=patientNames(data.patients);
      if(view==='salud'){
        const anchor=root.querySelector('.kpi-grid');
        const wrap=document.createElement('div'); wrap.innerHTML=healthSummaryMarkup(data,map);
        const node=wrap.firstElementChild; if(anchor)anchor.insertAdjacentElement('afterend',node); else root.appendChild(node);
      }else{
        const state=filterState(view),t=today();
        const source=view==='citas'?filterRows(data.appointments,state):filterRows(data.treatments,state);
        const rows=view==='citas'?staleAppointments(source,t):overdueTreatments(source,t);
        if(rows.length){const wrap=document.createElement('div');wrap.innerHTML=viewNoticeMarkup(view,rows,map);const node=wrap.firstElementChild;const head=root.querySelector('.section-head');if(head)head.insertAdjacentElement('afterend',node);else root.prepend(node);}
      }
    }catch(error){console.error('Health dashboard enhancement:',error);}
    finally{
      running=false;
      if(rerun){rerun=false;schedule();}
    }
  }

  function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;run();});}
  document.addEventListener('panel:view-root-changed',schedule);
  document.addEventListener('panel:section-filters-changed',e=>{if(['salud','citas','tratamientos'].includes(e.detail?.view))schedule();});
  document.addEventListener('panel:app-data-ready',schedule);
  document.addEventListener('panel:manual-refresh-complete',schedule);
  document.addEventListener('panel:modules-ready',schedule);
  queueMicrotask(schedule);
})();