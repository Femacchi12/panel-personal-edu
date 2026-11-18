(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const API_BASE = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const state = {
    loaded: false, loading: false, error: null,
    tab: 'cierre',
    status: null, catalogs: null,
    pendings: [], selectedPendingId: null,
    closures: [], selectedDate: null,
    corrections: { proposals: [], applied: [] }, audits: [],
    preview: null, applyResult: null, operation: null, correctionOperation: null, syncInitialResult: null, reviewResult: null,
    form: {}, correctionForm: { row_num: '', mov_id: '', reason: '', changes: {}, before: {} },
    stale: false, offline: false, busy: false
  };

  function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  const stateLabels={ pendiente_validacion:'Pendiente de validación', simulado:'Simulado por el piloto (no registrado)', registrado:'Registrado', pendiente_revision:'Pendiente de revisión', en_revision:'En revisión' };
  // Escritor disponible (mock local o consumidor canónico): calculado SIEMPRE
  // desde state.status para que cualquier handler lo consulte sin depender
  // de variables locales de render.
  function applyReady(){ return (state.status?.apply_financiero_enabled) !== false; }
  const cleanConcept = t => norm(t).replace(/^\[owner reply\]\s*/i, '').replace(/\s{2,}/g, ' ') || 'Movimiento pendiente';
  function simplifyWarning(t){
    const s = norm(t);
    const rules = [
      [/no se identific[oó] persona/i, 'Sin titular identificado: en efectivo se registra como Común; en cuentas, elegir titular'],
      [/categor[ií]a\/subcategor[ií]a no determinada/i, 'Falta definir: categoría y subcategoría oficiales'],
      [/posible pago\/saldo de compra previamente contabilizada/i, 'Posible duplicado o saldo: confirmar antes de registrar'],
      [/titular y cuenta nu espec[ií]fica no identificados/i, 'Falta definir: titular y cuenta (Nu)'],
      [/categor[ií]a oficial a confirmar/i, 'Confirmar categoría oficial según Manual/Matriz'],
      [/requiere confirmaci[oó]n antes de registrar/i, 'Requiere confirmación antes de registrar']
    ];
    for (const [re, msg] of rules) if (re.test(s)) return msg;
    return s;
  }
  function fmtCop(n){ const v=Number(n); if(!Number.isFinite(v)) return '-'; return '$' + v.toLocaleString('es-CO',{maximumFractionDigits:2}); }
  function todayBogota(){ try { return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); } catch { return new Date().toISOString().slice(0,10); } }
  function norm(v){ return v==null?'':String(v).trim(); }
  function stableHash(obj){ const s=JSON.stringify(obj||null); let h=5381; for(let i=0;i<s.length;i++) h=(((h<<5)+h)^s.charCodeAt(i))>>>0; return h.toString(36); }

  async function api(path, opts={}){
    const getToken = window.__PANEL_GET_ID_TOKEN__;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers||{});
    if (typeof getToken === 'function') {
      const token = await getToken(false);
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const url = path.startsWith('http') ? path : (API_BASE + path);
    const res = await fetch(url, { ...opts, headers, cache:'no-store' });
    let data = null; try { data = await res.json(); } catch { data = { ok:false, error:'invalid_json', status: res.status }; }
    if (!res.ok) throw Object.assign(new Error(data?.message || data?.error || ('HTTP '+res.status)), { status: res.status, data });
    return data;
  }

  function setBusy(b){ state.busy = !!b; render(); }
  const operationLabels = { PENDING:'Pendiente de procesamiento', PROCESSING:'En procesamiento',
    COMMITTED:'Registrado correctamente (verificado)', ALREADY_REGISTERED:'Ya estaba registrado',
    NEEDS_INFORMATION:'Requiere información', UNCERTAIN:'Resultado incierto, requiere revisión',
    MANUAL_REVIEW:'Requiere revisión manual', CONFIRMED_FAILED:'Error confirmado' };
  const operationTypeLabels = { insert:'Registro de gasto', split:'Compra dividida', correction:'Corrección' };
  const reasonLabels = { read_failed_before_send:'No se pudo leer la hoja antes de enviar (confirmado, sin escritura)',
    write_or_readback_ambiguous:'Escritura o lectura posterior ambigua: no se reintenta',
    readback_mismatch:'La lectura posterior no coincide con lo enviado',
    partial_split:'Compra dividida aplicada parcialmente', correction_mismatch:'La fila cambió desde la propuesta',
    correction_mov_id_mismatch:'El movimiento de la fila no coincide con la referencia',
    correction_row_missing:'La fila referenciada ya no existe', invalid_origins:'Fila origen inválida',
    invalid_patch:'Campos de corrección no permitidos', review_required:'Revisión manual requerida' };
  async function refreshOperation(which='pending'){
    const key = which === 'correction' ? 'correctionOperation' : 'operation';
    if (!state[key]?.operationId) return;
    const data = await api(`/api/control-gastos/operations/${encodeURIComponent(state[key].operationId)}`);
    state[key] = { ...state[key], ...data };
    render();
  }
  function renderOperation(op, which='pending'){
    if (!op?.operationId) return '';
    const status = op.status || 'PENDING';
    const tone = /^(COMMITTED|ALREADY_REGISTERED)$/.test(status) ? 'ok'
      : /^(UNCERTAIN|MANUAL_REVIEW|CONFIRMED_FAILED)$/.test(status) ? 'err' : 'warn';
    const result = op.result || null;
    const ids = (result?.ids || []).join(', ');
    const reason = reasonLabels[op.reason] || op.reason || '';
    return `<div class="cg-notice ${tone}" style="margin-top:10px">
      <strong>Operación ${which==='correction'?'de corrección':''} ${esc(op.operationId)}</strong>
      <div class="cg-muted" style="margin-top:4px">${esc(operationTypeLabels[op.type] || op.type || 'Operación')}</div>
      <div style="margin-top:6px"><strong>Estado:</strong> ${esc(operationLabels[status] || status)}</div>
      ${op.createdAt ? `<div class="cg-muted">Creada: ${esc(op.createdAt)}${op.updatedAt && op.updatedAt!==op.createdAt ? ` · Actualizada: ${esc(op.updatedAt)}`:''}</div>`:''}
      ${ids ? `<div class="cg-muted">ID(s) verificado(s): ${esc(ids)}</div>`:''}
      ${result?.verifiedColumns ? `<div class="cg-muted">Readback verificado: ${esc(result.verifiedColumns)} columnas</div>`:''}
      ${reason ? `<div><strong>Motivo:</strong> ${esc(reason)}</div>`:''}
      ${op.destinationBlocked ? `<div class="cg-badge err" style="margin-top:6px">Destino bloqueado hasta revisión manual</div>`:''}
      <div class="cg-actions" style="margin-top:8px"><button class="cg-btn" data-cg-action="check-operation" data-cg-op-kind="${which}" ${state.busy?'disabled':''}>Consultar estado</button></div>
    </div>`;
  }

  async function loadAll(force=false){
    if (state.loading) return;
    state.loading = true; state.error = null; render();
    try {
      const [st, pend, clo, corr] = await Promise.all([
        api('/api/control-gastos/status'),
        api('/api/control-gastos/pendings'),
        api('/api/control-gastos/closures'),
        api('/api/control-gastos/corrections').catch(()=>({ok:true, corrections:{proposals:[],applied:[]}}))
      ]);
      state.status = st; state.catalogs = st.catalogs || null;
      state.pendings = (pend.items || []).slice();
      state.closures = (clo.items || []).slice().sort((a,b)=> String(b.date).localeCompare(String(a.date)));
      if (!state.selectedDate) state.selectedDate = state.closures.find(x=>x.date===todayBogota())?.date || state.closures[0]?.date || todayBogota();
      state.corrections = corr.corrections || {proposals:[],applied:[]};
      state.stale = false; state.offline = false; state.loaded = true;
      state.syncInfo = st.sync || {};
      if (state.selectedPendingId && !state.pendings.find(p=>String(p.id)===String(state.selectedPendingId))) state.selectedPendingId = null;
    } catch (e) {
      state.error = e; state.offline = (e.status===0 || /network|failed to fetch/i.test(String(e.message||e)));
      state.stale = state.loaded;
      if (!state.loaded) {
        state.status = { mode:'desconocido', production_write_enabled:false, firestore_configured:false, sync:{status:'sin_conexion', note:'No se pudo contactar el servicio de Control de gastos.'}, notes:['Si el servicio local/central no está disponible, se muestra estado real sin indicar sincronización falsa.'] };
        state.pendings = []; state.closures = []; state.corrections = {proposals:[],applied:[]};
      }
    } finally { state.loading = false; render(); }
  }

  function getSelectedPending(){ return state.pendings.find(p=>String(p.id)===String(state.selectedPendingId)) || null; }
  function getSelectedClosure(){ return state.closures.find(c=>String(c.date)===String(state.selectedDate)) || null; }

  function initFormFromPending(p){
    const d = p?.datos_interpretados || {}; const f = p?.fila_simulada || {}; const rev = p?.revision?.input || {};
    const pick = (a, b, c) => norm(a ?? b ?? c ?? '');
    // El concepto editable se presenta SIN prefijos técnicos ([owner reply]);
    // el mensaje original completo queda preservado en descripción/texto original.
    const conceptoLimpio = pick(d.concepto, f['Descripción / Comercio']).replace(/^\[owner reply\]\s*/i, '').replace(/\s{2,}/g, ' ');
    state.form = {
      fecha_real: pick(rev.fecha_real, d.fecha_real, f['Fecha real']),
      concepto: rev.concepto ?? conceptoLimpio,
      comercio: rev.concepto ?? conceptoLimpio,
      descripcion: pick(rev.descripcion, d.texto_original, f['Descripción original']),
      importe: rev.importe ?? d.importe ?? f['Monto original'] ?? '',
      moneda: pick(rev.moneda, d.moneda, f['Moneda original']) || 'COP',
      titular: pick(rev.titular, d.titular, f['Titular']),
      categoria: pick(rev.categoria, d.categoria, f['Categoría']),
      subcategoria: pick(rev.subcategoria, d.subcategoria, f['Subcategoría']),
      cuenta: pick(rev.cuenta, d.cuenta_tarjeta, f['Cuenta / Tarjeta']),
      medio_pago: pick(rev.medio_pago, d.modalidad_pago, f['Modalidad de pago']),
      mes_pago: pick(rev.mes_pago, d.mes_pago, f['Mes pago']),
      notas: norm(p?.revision?.aclaracion ?? p?.notas_revision ?? ''),
      resolucion: '',
      aclaracion: ''
    };
  }

  function computeValidation(){
    const errs=[]; const warns=[]; const f=state.form; const cats=state.catalogs||{};
    const req = [['fecha_real','Fecha'],['concepto','Comercio/concepto'],['importe','Importe'],['moneda','Moneda'],['titular','Titular'],['categoria','Categoría'],['cuenta','Cuenta/tarjeta'],['medio_pago','Medio de pago']];
    req.forEach(([k,l])=>{ if(!norm(f[k])) errs.push(`Falta ${l}`); });
    // REGLA DEFINITIVA: en pagos en EFECTIVO no se exige identificar titular;
    // se registra "Común". Para tarjetas/cuentas el titular sigue obligatorio.
    const esEfectivo = norm(f.cuenta)==='Efectivo' || norm(f.medio_pago)==='Efectivo';
    if (esEfectivo && !norm(f.titular)) f.titular = 'Común';
    if (norm(f.titular) && !(cats.titulares||[]).includes(norm(f.titular))) errs.push('Titular no válido (Edu, Rocío, Pía o Común)');
    if (norm(f.categoria) && !(cats.categorias||[]).includes(norm(f.categoria))) errs.push('Categoría no oficial');
    const byCat=(cats.subcategorias_por_categoria||{})[norm(f.categoria)]||[];
    if (norm(f.subcategoria) && byCat.length && !byCat.includes(norm(f.subcategoria))) warns.push('Subcategoría no corresponde a la categoría (verificar)');
    const modMap=cats.modalidades_por_cuenta||{}; const allowed=modMap[norm(f.cuenta)] || (cats.medios_pago||[]);
    if (norm(f.medio_pago) && allowed.length && !allowed.includes(norm(f.medio_pago))) errs.push('Modalidad incompatible con la cuenta seleccionada');
    if (!(Number(f.importe)>0)) errs.push('Importe debe ser mayor a 0');
    const p=getSelectedPending();
    if (p && (p.motivo_ambiguedad||[]).some(m=>/duplic|parcial|saldo/i.test(m)) && !f.resolucion) {
      warns.push('Posible duplicado/saldo parcial: elige una resolución explícita antes de aplicar.');
    }
    if (f.resolucion==='compra_dividida') {
      const parts=(f.partes_divididas||[]).filter(x=>norm(x.concepto)&&Number(x.importe)>0);
      if (parts.length<2) warns.push('Compra dividida: define al menos 2 partes con concepto e importe antes de aplicar.');
      else warns.push(`Compra dividida en ${parts.length} partes (suma ${parts.reduce((s,x)=>s+Number(x.importe),0)}). Cada parte será un movimiento separado con el mismo titular/cuenta/categoría y fila origen vinculada.`);
    }
    return { ok: errs.length===0, errs, warns };
  }

  function renderBadges(){
    const st=state.status||{}; const sync=st.sync||state.syncInfo||{}; const parts=[];
    const modeLabels={ operational_preprod:'Modo operativo — solo lectura', local_e2e:'Entorno local aislado (pruebas)', test_isolated:'Entorno aislado de prueba', desconocido:'estado' };
    parts.push(`<span class="cg-badge ${st.mode==='test_isolated'?'warn':'ok'}">${esc(modeLabels[st.mode]||st.mode||'estado')}</span>`);
    parts.push(`<span class="cg-badge ${st.production_write_enabled?'ok':'warn'}">Escritura productiva: ${st.production_write_enabled?'habilitada':'NO habilitada'}</span>`);
    parts.push(`<span class="cg-badge ${st.firestore_configured?'ok':'warn'}">Firestore: ${st.firestore_configured?'configurado':'pendiente'}</span>`);
    parts.push(`<span class="cg-badge ${st.local_queue_available?'ok':'warn'}">Cola local: ${st.local_queue_available?'conectada (mock)':'no disponible'}</span>`);
    const s=String(sync.status||'desconocido');
    const syncLabels={ sin_sincronizacion:'Sin sincronización de Hermes', sincronizado:'Sincronizado con Hermes', sin_conexion:'Sin conexión con el servicio', unknown:'Estado de sincronización desconocido' };
    parts.push(`<span class="cg-badge ${/sincron/i.test(s)?'ok':'warn'}">${esc(syncLabels[s]||s)}</span>`);
    if (state.offline) parts.push('<span class="cg-badge err">Servicio no disponible</span>');
    if (state.stale) parts.push('<span class="cg-badge warn">Mostrando última información conocida</span>');
    return parts.join('');
  }

  function renderTabs(){
    const tabs=[['cierre','Cierre diario'],['pendientes','Pendientes de validación'],['historial','Historial y correcciones']];
    return `<div class="cg-tabs">${tabs.map(([k,l])=>`<button class="cg-tab ${state.tab===k?'active':''}" data-cg-tab="${k}">${l}</button>`).join('')}</div>`;
  }

  function renderClosure(){
    const c=getSelectedClosure(); const closure=c?.closure; const rev=c?.review||{};
    const dates=state.closures.map(x=>x.date);
    const opts = dates.length ? dates.map(d=>`<option value="${esc(d)}" ${d===state.selectedDate?'selected':''}>${esc(d)}</option>`).join('') : `<option value="" selected>Sin fechas sincronizadas</option>`;
    const tot=closure?.totales||{}; const subs=closure?.subtotales||{}; const rows=closure?.resumen_gastos||[]; const splits=closure?.compras_divididas||[];
    const pendientes=(closure?.pendientes_validacion||[]);
    const kpis = closure ? `
      <div class="cg-kpis">
        <div class="cg-kpi"><div class="label">Total registrado (COP)</div><div class="value">${fmtCop(tot.gastos_registrados_cop ?? tot.total_cop)}</div></div>
        <div class="cg-kpi"><div class="label">Pendiente de validación (estimado)</div><div class="value">${fmtCop(tot.pendientes_cop_estimado||0)}</div><div class="cg-muted">${Number(tot.cantidad_pendientes||pendientes.length||0)} ítem(s)</div></div>
        <div class="cg-kpi"><div class="label">Total potencial (sin doble conteo)</div><div class="value">${fmtCop(tot.total_potencial_cop ?? ((tot.total_cop||0)+(tot.pendientes_cop_estimado||0)))}</div></div>
        <div class="cg-kpi"><div class="label">Movimientos</div><div class="value">${esc(tot.cantidad_movimientos_gasto ?? rows.length)}</div></div>
      </div>` : `<div class="cg-empty">Sin cierres diarios sincronizados todavía. ${state.offline? 'Servicio no disponible.':''}<div class="cg-muted" style="margin-top:6px">${state.status?.fixtures ? 'No hay cierre cargado para la fecha seleccionada.' : 'Los cierres aparecerán cuando la sincronización operativa desde Hermes esté habilitada.'}</div></div>`;
    const table = rows.length ? `<div style="overflow:auto"><table class="cg-table"><thead><tr><th></th><th>ID</th><th>Comercio</th><th>Categoría</th><th>Titular</th><th>Cuenta</th><th>Medio</th><th>Mes pago</th><th>Importe</th><th>COP</th><th>Estado</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td><button class="cg-row-btn" data-cg-edit-mov="1" data-row="${esc(r.fila||'')}" data-mov="${esc(r.id||'')}">Editar</button></td><td>${esc(r.id||'')}</td><td>${esc(r.comercio||'')}</td><td>${esc(r.categoria||'')}</td><td>${esc(r.titular||'')}</td><td>${esc(r.cuenta||'')}</td><td>${esc(r.medio_pago||r.medio_modalidad||'')}</td><td>${esc(r.mes_pago||'')}</td><td>${esc(r.importe)} ${esc(r.moneda||'')}</td><td>${fmtCop(r.monto_cop)}</td><td>${esc(r.estado_sheets||'')}</td></tr>`).join('')}
    </tbody></table></div>` : '';
    const sub = closure ? `
      <div class="cg-split">
        <div><h4>Subtotales por titular</h4><div class="cg-code">${esc(JSON.stringify(subs.por_titular_cop||{}, null, 2))}</div></div>
        <div><h4>Subtotales por categoría</h4><div class="cg-code">${esc(JSON.stringify(subs.por_categoria_cop||{}, null, 2))}</div></div>
        <div><h4>Por cuenta/tarjeta</h4><div class="cg-code">${esc(JSON.stringify(subs.por_cuenta_tarjeta_cop||{}, null, 2))}</div></div>
        <div><h4>Por modalidad</h4><div class="cg-code">${esc(JSON.stringify(subs.por_modalidad_pago_cop||{}, null, 2))}</div></div>
      </div>` : '';
    const splitsHtml = splits.length ? `<div class="cg-notice warn"><strong>Compras divididas (sin duplicar):</strong> ${splits.map(s=>esc((s.ids||[]).join(', ') + ' = ' + fmtCop(s.importe_total_cop))).join(' · ')}</div>` : '';
    const reviewLabel = rev.label || rev.status || 'Pendiente de revisión';
    return `
      <div class="cg-card">
        <div class="cg-header"><div>
          <h3>Cierre diario</h3>
          <div class="cg-muted">Fuente oficial: Finanzas Edu → Movimientos. ${esc(closure?.fuente||'')}</div>
        </div>
        <div class="cg-actions">
          <label class="cg-muted">Fecha <select id="cg-date">${opts}</select></label>
          <button class="cg-btn" data-cg-action="refresh-closure" ${state.busy?'disabled':''}>Actualizar cierre</button>
          <button class="cg-btn primary" data-cg-action="mark-reviewed" ${state.busy||!closure?'disabled':''}>Marcar día como revisado</button>
        </div></div>
        <div class="cg-badges" style="margin:8px 0 12px"><span class="cg-badge">${esc(reviewLabel)}</span>${closure?.trigger?`<span class="cg-badge">trigger: ${esc(closure.trigger)}</span>`:''}</div>
        ${kpis}
        ${tot.cantidad_pendientes ? `<div class="cg-notice warn" style="margin-top:10px">Hay ${esc(tot.cantidad_pendientes)} pendiente(s) de validación en esta fecha (estimado ${fmtCop(tot.pendientes_cop_estimado||0)}). El total registrado NO los incluye.</div>`:''}
        ${splitsHtml}
      </div>
      <div class="cg-card"><h3>Movimientos registrados</h3>${table || '<div class="cg-empty">Sin movimientos registrados para la fecha.</div>'}</div>
      <div class="cg-card"><h3>Subtotales</h3>${sub || '<div class="cg-muted">-</div>'}</div>`;
  }

  function renderPendingList(){
    const items=state.pendings||[];
    if(!items.length){
      const st=state.status||{};
      const detail = st.fixtures
        ? 'Sin pendientes en este entorno.'
        : 'Sin pendientes sincronizados: la publicación de movimientos reales desde Hermes (WhatsApp) todavía no está habilitada. Aquí aparecerán solo cuando existan y hayan sido verificados; no se inventan datos.';
      const syncCard = (!st.fixtures && st.sync?.status==='sin_sincronizacion')
        ? `<div class="cg-notice" style="margin-top:10px"><strong>Sincronización operativa inicial (Hermes)</strong>
           <div class="cg-muted" style="margin-top:4px">Publica los 5 pendientes históricos en el estado operativo (Firestore). Solo lectura respecto de Finanzas Edu: no escribe movimientos contables y Aplicar sigue deshabilitado. Ejecución única, con confirmación previa y auditoría.</div>
           <div class="cg-actions" style="margin-top:8px"><button class="cg-btn primary" data-cg-action="sync-initial" ${state.busy?'disabled':''}>Preparar sincronización inicial</button></div>
           ${state.syncInitialResult ? `<div class="cg-notice ${state.syncInitialResult.ok?'ok':'err'}" style="margin-top:8px"><strong>Resultado:</strong> ${esc(state.syncInitialResult.note || state.syncInitialResult.error || 'Sincronizado')}</div>`:''}</div>`
        : '';
      return `<div class="cg-empty">No hay pendientes de validación.<div class="cg-muted" style="margin-top:6px">${esc(detail)}</div></div>${syncCard}`;
    }
    return `<div class="cg-list">${items.map(p=>{
      const d=p.datos_interpretados||{}; const sel=String(p.id)===String(state.selectedPendingId);
      const motivos=(p.motivo_ambiguedad||[]).map(m=>`<span class="cg-pill">${esc(simplifyWarning(m))}</span>`).join('');
      const saved = p.revision?.input ? ' · Revisión guardada' : '';
      const reg = p.registro?.movId ? ` · ${esc(Array.isArray(p.registro.movIds)?p.registro.movIds.join(' + '):p.registro.movId)}` : '';
      return `<div class="cg-item ${sel?'selected':''}" data-cg-pending="${esc(p.id)}">
        <h4>${esc(cleanConcept(d.concepto||p.texto_relevante))}</h4>
        <div class="cg-muted">${esc(d.fecha_real||'')} · ${esc(d.moneda||'')} ${esc(d.importe??'')} · ${esc(d.titular||'(titular pendiente)')} · ${esc(d.cuenta_tarjeta||'(cuenta pendiente)')}${saved}</div>
        <div>${motivos}</div>
        <div class="cg-muted" style="margin-top:6px">Estado: ${esc(stateLabels[p.estado_sincronizacion]||p.estado_sincronizacion||'pendiente')}${reg} · Origen: ${esc(p.message_key||'')}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function selectOptions(values, current, placeholder){
    const opts=[`<option value="">${esc(placeholder||'Seleccionar')}</option>`];
    (values||[]).forEach(v=>{ const s=String(v); opts.push(`<option value="${esc(s)}" ${s===String(current||'')?'selected':''}>${esc(s)}</option>`); });
    return opts.join('');
  }

  function renderPendingForm(){
    const p=getSelectedPending(); if(!p) return '<div class="cg-empty">Selecciona un gasto pendiente para ver la ficha de resolución.</div>';
    const cats=state.catalogs||{}; const f=state.form; const d=p.datos_interpretados||{};
    const byCat=cats.subcategorias_por_categoria||{}; const subs=byCat[norm(f.categoria)]||cats.subcategorias||[];
    const modalities=(cats.modalidades_por_cuenta||{})[norm(f.cuenta)]||cats.medios_pago||[];
    const v=computeValidation(); const preview=state.preview;
    const motivos=(p.motivo_ambiguedad||[]).map(m=>`<li>${esc(simplifyWarning(m))}</li>`).join('');
    const diffRows = preview?.comparison?.diff ? Object.entries(preview.comparison.diff).map(([k,val])=>`<tr><th>${esc(k)}</th><td class="old">${esc(val.antes)}</td><td class="new">${esc(val.despues)}</td></tr>`).join('') : '';
    const canApply = !!preview && preview.canApply && applyReady() && !state.busy && !state.operation;
    return `
      <div class="cg-card">
        <h3>Ficha de resolución</h3>
        <div class="cg-notice ${v.ok?'':'warn'}"><strong>Motivo pendiente:</strong><ul style="margin:6px 0 0 18px">${motivos||'<li>Revisión requerida</li>'}</ul></div>
        <div class="cg-notice" style="margin-top:8px"><strong>Texto original (WhatsApp):</strong><div class="cg-code" style="margin-top:6px">${esc(p.texto_relevante || d.texto_original || '')}</div></div>
        <div class="cg-form" style="margin-top:10px" id="cg-pending-form">
          <div class="cg-split">
            <div class="cg-field"><label>Fecha real</label><input name="fecha_real" type="date" value="${esc(f.fecha_real)}"></div>
            <div class="cg-field"><label>Mes de pago (si corresponde)</label><select name="mes_pago">${selectOptions(cats.meses_pago||[], f.mes_pago, 'Seleccionar mes de pago')}</select></div>
          </div>
          <div class="cg-field"><label>Comercio / concepto</label><input name="concepto" value="${esc(f.concepto)}"></div>
          <div class="cg-field"><label>Descripción / aclaración original</label><textarea name="descripcion" rows="2">${esc(f.descripcion)}</textarea></div>
          <div class="cg-split">
            <div class="cg-field"><label>Importe</label><input name="importe" type="number" step="0.01" value="${esc(f.importe)}"></div>
            <div class="cg-field"><label>Moneda</label><select name="moneda">${selectOptions(cats.monedas||['COP','ARS','USD'], f.moneda, 'Moneda')}</select></div>
          </div>
          <div class="cg-split">
            <div class="cg-field"><label>Titular</label><select name="titular">${selectOptions(cats.titulares||['Edu','Rocío','Pía'], f.titular, 'Seleccionar titular')}</select></div>
            <div class="cg-field"><label>Categoría</label><select name="categoria">${selectOptions(cats.categorias||[], f.categoria, 'Seleccionar categoría')}</select></div>
          </div>
          <div class="cg-split">
            <div class="cg-field"><label>Subcategoría</label><select name="subcategoria">${selectOptions(subs, f.subcategoria, 'Seleccionar subcategoría')}</select></div>
            <div class="cg-field"><label>Cuenta / tarjeta</label><select name="cuenta">${selectOptions(cats.cuentas||[], f.cuenta, 'Seleccionar cuenta/tarjeta')}</select></div>
          </div>
          <div class="cg-split">
            <div class="cg-field"><label>Modalidad de pago</label><select name="medio_pago">${selectOptions(modalities, f.medio_pago, 'Seleccionar modalidad')}</select></div>
            <div class="cg-field"><label>Resolución (duplicados/saldos)</label>
              <select name="resolucion">
                <option value="" ${!f.resolucion?'selected':''}>Seleccionar acción</option>
                <option value="es_nuevo" ${f.resolucion==='es_nuevo'?'selected':''}>Es un gasto nuevo (registrar)</option>
                <option value="compra_dividida" ${f.resolucion==='compra_dividida'?'selected':''}>Compra dividida / varios conceptos (partes separadas)</option>
                <option value="ya_registrado" ${f.resolucion==='ya_registrado'?'selected':''}>Ya está registrado (descartar duplicado)</option>
                <option value="necesita_revision" ${f.resolucion==='necesita_revision'?'selected':''}>Necesita revisión</option>
              </select>
            </div>
          </div>
          <div class="cg-field"><label>Aclaración adicional (opcional)</label><textarea name="aclaracion" rows="2">${esc(f.aclaracion||'')}</textarea></div>
          ${f.resolucion==='compra_dividida' ? `<div class="cg-field"><label>Partes (cada una será un movimiento separado, con su concepto e importe)</label>
            <div id="cg-partes">${(f.partes_divididas||[]).map((p,i)=>`<div class="cg-split" data-cg-parte="${i}"><input name="parte_concepto" value="${esc(p.concepto||'')}" placeholder="Concepto de la parte ${i+1}"><input name="parte_importe" type="number" step="0.01" value="${esc(p.importe??'')}" placeholder="Importe"></div>`).join('')}</div>
            <div class="cg-actions" style="margin-top:6px"><button type="button" class="cg-btn" data-cg-action="add-parte">Agregar parte</button><span class="cg-muted">Mínimo 2 partes. Cada parte conserva la fecha, titular, categoría y cuenta del formulario.</span></div></div>`:''}
        </div>
        ${v.errs.length? `<div class="cg-notice err" style="margin-top:10px"><strong>Faltan datos o hay inconsistencias:</strong><ul style="margin:6px 0 0 18px">${v.errs.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>`:''}
        ${v.warns.length? `<div class="cg-notice warn" style="margin-top:10px"><strong>Revisar:</strong><ul style="margin:6px 0 0 18px">${v.warns.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>`:''}
        <div class="cg-actions" style="margin-top:12px">
          <button class="cg-btn" data-cg-action="preview-pending" ${state.busy?'disabled':''}>Previsualizar Antes/Después</button>
          <button class="cg-btn" data-cg-action="save-review" ${state.busy?'disabled':''}>Guardar revisión (sin registrar)</button>
          <button class="cg-btn primary" data-cg-action="apply-pending" ${(!canApply)?'disabled':''}>Aplicar</button>
          ${!canApply ? `<span class="cg-muted">${applyReady() ? 'Aplica solo con validación OK y confirmación.' : 'Aplicar financiero no disponible: el escritor no está configurado en este entorno.'}</span>` : `<span class="cg-muted">Se pedirá confirmación. Destino: Finanzas Edu → Movimientos.</span>`}
        </div>
        ${p.revision?.at ? `<div class="cg-notice" style="margin-top:10px"><strong>Revisión guardada:</strong> ${esc(p.revision.at)}${p.revision.by?` · ${esc(p.revision.by)}`:''} · Decisiones conservadas como estado de revisión (no registradas en Movimientos).${p.revision.registrada===false?'':''}</div>`:''}
        ${state.reviewResult ? `<div class="cg-notice ${state.reviewResult.ok?'ok':'err'}" style="margin-top:8px"><strong>Guardar revisión:</strong> ${esc(state.reviewResult.note || state.reviewResult.error || 'OK')}</div>`:''}
        ${preview ? `<div style="margin-top:12px"><h4>Antes / Después (propuesta)</h4>
          ${diffRows? `<table class="cg-diff"><thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead><tbody>${diffRows}</tbody></table>` : '<div class="cg-muted">Sin diferencias detectadas.</div>'}
          <div class="cg-notice" style="margin-top:8px"><strong>Operación propuesta:</strong> ${esc(preview.operacion_propuesta||'')} · <strong>Destino:</strong> ${applyReady ? 'Finanzas Edu → Movimientos (registro real, confirmación individual, readback 27 columnas)' : 'sin escritura (etapa de prueba aislada)'} · <strong>Confirmación requerida:</strong> Sí</div>
        </div>`:''}
        ${state.applyResult ? `<div class="cg-notice ${state.applyResult.ok?'ok':'err'}" style="margin-top:10px"><strong>Resultado:</strong> ${esc(state.applyResult.note || state.applyResult.error || 'OK')} ${state.applyResult.simulated?'<span class="cg-badge warn">simulado</span>':''}</div>`:''}
        ${state.operation ? renderOperation(state.operation, 'pending') : ''}
      </div>`;
  }

  function renderPendings(){
    return `<div class="cg-grid"><div>${renderPendingList()}</div><div>${renderPendingForm()}</div></div>`;
  }

  function renderHistorial(){
    const corr=state.corrections||{proposals:[],applied:[]};
    const props=(corr.proposals||[]).slice().reverse();
    const applied=(corr.applied||[]).slice().reverse();
    const cf=state.correctionForm; const cats=state.catalogs||{};
    return `
      <div class="cg-grid">
        <div class="cg-card">
          <h3>Corrección guiada (movimiento registrado)</h3>
          <div class="cg-notice warn">Sin rangos ni JSON. Modifica solo campos necesarios. Antes de aplicar: Antes/Después, confirmación, respaldo y verificación (en etapa productiva). No cambia ID ni referencias canónicas.</div>
          <div class="cg-form" style="margin-top:10px">
            <div class="cg-split">
              <div class="cg-field"><label>Fila en Movimientos (row_num)</label><input id="cg-corr-row" type="number" value="${esc(cf.row_num)}" placeholder="Ej: 1565"></div>
              <div class="cg-field"><label>ID movimiento (opcional)</label><input id="cg-corr-mov" value="${esc(cf.mov_id)}" placeholder="Ej: MOV-01268"></div>
            </div>
            <div class="cg-split">
              <div class="cg-field"><label>Fecha real</label><input id="cg-cf-fecha_real" type="date" value="${esc(cf.changes.fecha_real||'')}"></div>
              <div class="cg-field"><label>Comercio</label><input id="cg-cf-comercio" value="${esc(cf.changes.comercio||'')}"></div>
            </div>
            <div class="cg-field"><label>Descripción</label><input id="cg-cf-descripcion" value="${esc(cf.changes.descripcion||'')}"></div>
            <div class="cg-split">
              <div class="cg-field"><label>Importe</label><input id="cg-cf-importe" type="number" step="0.01" value="${esc(cf.changes.importe||'')}"></div>
              <div class="cg-field"><label>Moneda</label><select id="cg-cf-moneda">${selectOptions(cats.monedas||['COP','ARS','USD'], cf.changes.moneda||'', 'Sin cambio')}</select></div>
            </div>
            <div class="cg-split">
              <div class="cg-field"><label>Categoría</label><select id="cg-cf-categoria">${selectOptions(cats.categorias||[], cf.changes.categoria||'', 'Sin cambio')}</select></div>
              <div class="cg-field"><label>Subcategoría</label><input id="cg-cf-subcategoria" value="${esc(cf.changes.subcategoria||'')}" placeholder="Subcategoría"></div>
            </div>
            <div class="cg-split">
              <div class="cg-field"><label>Titular</label><select id="cg-cf-titular">${selectOptions(cats.titulares||[], cf.changes.titular||'', 'Sin cambio')}</select></div>
              <div class="cg-field"><label>Cuenta/tarjeta</label><select id="cg-cf-cuenta">${selectOptions(cats.cuentas||[], cf.changes.cuenta||'', 'Sin cambio')}</select></div>
            </div>
            <div class="cg-split">
              <div class="cg-field"><label>Medio de pago</label><select id="cg-cf-medio_pago">${selectOptions(cats.medios_pago||[], cf.changes.medio_pago||'', 'Sin cambio')}</select></div>
              <div class="cg-field"><label>Mes de pago</label><select id="cg-cf-mes_pago">${selectOptions(cats.meses_pago||[], cf.changes.mes_pago||'', 'Sin cambio')}</select></div>
            </div>
            <div class="cg-field"><label>Motivo</label><textarea id="cg-corr-reason" rows="2">${esc(cf.reason||'')}</textarea></div>
          </div>
          <div class="cg-actions" style="margin-top:10px">
            <button class="cg-btn primary" data-cg-action="propose-correction" ${state.busy?'disabled':''}>Crear propuesta (Antes/Después)</button>
            <span class="cg-muted">No aplica a Movimientos real en esta etapa (simulado/auditado).</span>
          </div>
        </div>
        <div class="cg-card">
          <h3>Propuestas y aplicaciones</h3>
          <h4>Propuestas</h4>
          ${props.length? props.map(p=>`<div class="cg-notice" style="margin-bottom:8px"><div><strong>${esc(p.id)}</strong> · ${esc(p.status)} · ${esc(p.date||'')}</div><div class="cg-muted">Fila ${esc(p.payload?.row_num)} ${esc(p.payload?.mov_id||'')} — ${esc(p.payload?.reason||'')}</div><div class="cg-code">${esc(JSON.stringify(p.payload?.comparison||p.payload?.changes||{}, null, 2))}</div><div class="cg-actions" style="margin-top:6px"><button class="cg-btn" data-cg-apply-prop="${esc(p.id)}" ${p.status!=='propuesta' || state.busy ? 'disabled':''}>Enviar a la cola con aprobación</button>${p.operation_id?`<span class="cg-muted">Operación: ${esc(p.operation_id)}</span>`:''}</div></div>`).join('') : '<div class="cg-muted">Sin propuestas.</div>'}
          ${state.correctionOperation ? renderOperation(state.correctionOperation, 'correction') : ''}
          <h4 style="margin-top:12px">Historial de aplicaciones</h4>
          ${applied.length? `<div class="cg-code">${esc(JSON.stringify(applied, null, 2))}</div>` : '<div class="cg-muted">Sin aplicaciones registradas.</div>'}
        </div>
      </div>`;
  }

  function render(){
    const root = document.getElementById('viewRoot'); if(!root) return;
    const active = document.querySelector('.nav-item.active')?.dataset.view;
    if (active && active !== 'control-gastos') return;
    const sync = (state.status?.sync)||{};
        const applyBanner = applyReady()
          ? `<div class="cg-notice ok" style="margin-top:8px"><strong>Aplicar financiero: activo.</strong><div class="cg-muted" style="margin-top:4px">Destino real: Finanzas Edu → Movimientos. Registro con confirmación individual, validación de catálogos, readback de 27 columnas y auditoría. El registro automático desde WhatsApp sigue deshabilitado.</div></div>`
          : `<div class="cg-notice" style="margin-top:8px"><strong>Aplicar financiero: deshabilitado en esta etapa.</strong>
         <div class="cg-muted" style="margin-top:4px">El módulo funciona en modo seguro: lectura, validación y revisión. El botón Aplicar no encola operaciones financieras productivas y ninguna escritura alcanza Finanzas Edu → Movimientos.</div></div>`;
    const banner = `<div class="cg-notice ${state.offline?'err':'warn'}" style="margin-bottom:12px">
      <strong>Control de gastos (modo ${esc(state.status?.mode||'operativo')}):</strong> ${esc((state.status?.notes||[])[0] || 'Estado operativo no productivo.')}
      <div class="cg-muted" style="margin-top:4px">Última sync conocida: ${esc(sync.lastSyncAt || 'n/d')} · Sync pendiente: ${esc(sync.pendingSyncCount ?? 'n/d')} · ${esc(sync.note || '')}</div>
      ${applyBanner}
      ${state.error? `<div style="margin-top:6px;color:#feb2b2">Error: ${esc(state.error.message || String(state.error))}</div>`:''}
    </div>`;
    root.innerHTML = `
      <div class="control-gastos">
        ${banner}
        <div class="cg-card">
          <div class="cg-header">
            <div>
              <span class="eyebrow">FINANZAS</span>
              <h2 style="margin:4px 0 0">Control de gastos</h2>
              <div class="cg-muted">Hermes (captura/validación) + Finanzas Edu (fuente contable). Uso cotidiano desde el Dashboard.</div>
            </div>
            <div>
              <div class="cg-badges">${renderBadges()}</div>
              <div class="cg-actions" style="margin-top:8px"><button class="cg-btn" data-cg-action="reload" ${state.busy||state.loading?'disabled':''}>${state.loading?'Cargando…':'Actualizar datos'}</button></div>
            </div>
          </div>
          <div style="margin-top:12px">${renderTabs()}</div>
        </div>
        ${state.tab==='cierre' ? renderClosure() : ''}
        ${state.tab==='pendientes' ? renderPendings() : ''}
        ${state.tab==='historial' ? renderHistorial() : ''}
      </div>`;
    bindEvents(root);
  }

  function readPendingForm(root){
    const f = state.form;
    root.querySelectorAll('#cg-pending-form [name]').forEach(el=>{ f[el.name] = el.value; });
    // The form edits "concepto"; keep "comercio" in sync so a stale parsed
    // value never overrides what the user typed.
    if (norm(f.concepto)) f.comercio = f.concepto;
    // Partes de compra dividida: pares concepto/importe en el DOM
    if (f.resolucion === 'compra_dividida') {
      const partes = [...root.querySelectorAll('#cg-partes [data-cg-parte]')].map(row => ({
        concepto: norm(row.querySelector('[name="parte_concepto"]')?.value),
        importe: Number(row.querySelector('[name="parte_importe"]')?.value) || null
      })).filter(p => p.concepto || p.importe);
      f.partes_divididas = partes;
    } else {
      delete f.partes_divididas;
    }
  }
  function readCorrectionForm(root){
    const g=id=>root.querySelector(id)?.value||'';
    state.correctionForm.row_num = g('#cg-corr-row');
    state.correctionForm.mov_id = g('#cg-corr-mov');
    state.correctionForm.reason = g('#cg-corr-reason');
    const changes={};
    const map={fecha_real:'#cg-cf-fecha_real',comercio:'#cg-cf-comercio',descripcion:'#cg-cf-descripcion',importe:'#cg-cf-importe',moneda:'#cg-cf-moneda',categoria:'#cg-cf-categoria',subcategoria:'#cg-cf-subcategoria',titular:'#cg-cf-titular',cuenta:'#cg-cf-cuenta',medio_pago:'#cg-cf-medio_pago',mes_pago:'#cg-cf-mes_pago'};
    Object.entries(map).forEach(([k,sel])=>{ const v=g(sel); if(norm(v)) changes[k]=v; });
    state.correctionForm.changes = changes;
  }

  function bindEvents(root){
    root.querySelectorAll('[data-cg-tab]').forEach(btn=>btn.addEventListener('click',()=>{ state.tab=btn.dataset.cgTab; render(); }));
    root.querySelector('[data-cg-action="reload"]')?.addEventListener('click', ()=>loadAll(true));
    root.querySelector('#cg-date')?.addEventListener('change', (e)=>{ state.selectedDate = e.target.value; render(); });
    root.querySelector('[data-cg-action="refresh-closure"]')?.addEventListener('click', async ()=>{
      if(!state.selectedDate) return; setBusy(true);
      try { await api(`/api/control-gastos/closures/${encodeURIComponent(state.selectedDate)}/refresh`, {method:'POST', body: JSON.stringify({})}); await loadAll(true); }
      catch(e){ alert('No se pudo actualizar cierre: '+(e.data?.error||e.message)); }
      finally{ setBusy(false); }
    });
    root.querySelector('[data-cg-action="mark-reviewed"]')?.addEventListener('click', async ()=>{
      if(!state.selectedDate) return; if(!confirm('¿Marcar el día como revisado?')) return; setBusy(true);
      try { await api(`/api/control-gastos/closures/${encodeURIComponent(state.selectedDate)}/review`, {method:'POST', body: JSON.stringify({reviewed:true})}); await loadAll(true); }
      catch(e){ alert('No se pudo marcar revisado: '+(e.data?.error||e.message)); }
      finally{ setBusy(false); }
    });
    root.querySelectorAll('[data-cg-pending]').forEach(el=>el.addEventListener('click', ()=>{ state.selectedPendingId = el.dataset.cgPending; state.preview=null; state.applyResult=null; state.operation=null; initFormFromPending(getSelectedPending()); render(); }));
    root.querySelectorAll('#cg-pending-form [name]').forEach(el=>el.addEventListener('change', ()=>{ readPendingForm(root); state.preview=null; state.applyResult=null; state.reviewResult=null;
      const f=state.form;
      if (f.resolucion==='compra_dividida' && !(f.partes_divididas||[]).length) {
        const p=getSelectedPending(); const d=p?.datos_interpretados||{};
        // Sugerencia desde el mensaje (sin inventar): parte 1 con el concepto/importe detectados; el resto los define el usuario.
        f.partes_divididas = [{ concepto: norm(d.concepto||'').replace(/^\[owner reply\]\s*/i,''), importe: d.importe ?? '' }, { concepto: '', importe: '' }];
      }
      render();
    }));
    root.querySelector('[data-cg-action="add-parte"]')?.addEventListener('click', () => {
      readPendingForm(root);
      const f = state.form;
      f.partes_divididas = f.partes_divididas || [];
      f.partes_divididas.push({ concepto: '', importe: '' });
      render();
    });
    root.querySelector('[data-cg-action="preview-pending"]')?.addEventListener('click', async ()=>{
      const p=getSelectedPending(); if(!p) return; readPendingForm(root); setBusy(true);
      try { state.preview = await api(`/api/control-gastos/pendings/${encodeURIComponent(p.id)}/preview`, {method:'POST', body: JSON.stringify(state.form)}); }
      catch(e){ state.preview = e.data || {ok:false, error:e.message}; }
      finally{ setBusy(false); }
    });
    root.querySelector('[data-cg-action="apply-pending"]')?.addEventListener('click', async ()=>{
      if (state.busy) { alert('Hay una operación en curso; esperá unos segundos e intentá de nuevo.'); return; }
      if (state.operation) { alert(`Ya existe una operación en curso para este pendiente (${state.operation.operationId || 'sin id'} — ${state.operation.status || 'en proceso'}). Consultá su estado en el panel de operación.`); return; }
      const p=getSelectedPending(); if(!p) { alert('Seleccioná un gasto pendiente antes de aplicar.'); return; }
      try {
        readPendingForm(root);
        if (!applyReady()) { alert('Aplicar financiero no está disponible en este entorno (sin escritor configurado). No se creó ninguna operación.'); return; }
        const v=computeValidation();
        if(!v.ok){ alert('Faltan datos obligatorios:\n- ' + v.errs.join('\n- ') + (v.warns.length? '\n\nAdvertencias:\n- ' + v.warns.join('\n- ') : '') + '\n\nCorregí los campos y generá nuevamente el Antes/Después.'); return; }
        if(!state.preview || !state.preview.canApply){ alert('Generá la previsualización con "Previsualizar Antes/Después" y revisala antes de aplicar.' + (v.warns.length? '\n\nAdvertencias pendientes:\n- ' + v.warns.join('\n- ') : '')); return; }
        if(!confirm('Confirmar registro en FINANZAS EDU → Movimientos.\n\nDestino real: Finanzas Edu → Movimientos (27 columnas, lectura posterior verificada, auditoría).\nOperación individual: no se registra nada automáticamente.\n¿Continuar?')) return;
        setBusy(true);
        const result = await api(`/api/control-gastos/pendings/${encodeURIComponent(p.id)}/apply`, {method:'POST', body: JSON.stringify({...state.form, approved:true, confirm:true, idempotencyKey: `ui:${p.id}:${stableHash(state.form)}`})});
        state.operation={operationId:result.operationId,status:result.operationStatus,type:'insert'};
        state.applyResult=null;
        render();
        alert(`Operación encolada: ${result.operationId}\nEstado: ${result.operationStatus==='PENDING' ? 'En proceso (PENDING)' : result.operationStatus}\nSe registrará en Finanzas Edu y se verificará por lectura posterior.`);
      } catch(e){
        state.applyResult = e.data || {ok:false, error:e.message};
        render();
        alert('No se pudo aplicar: ' + (e.data?.error || e.message));
      } finally { setBusy(false); }
    });
    root.querySelector('[data-cg-action="save-review"]')?.addEventListener('click', async ()=>{
      if (state.busy) return;
      const p=getSelectedPending(); if(!p) return; readPendingForm(root); setBusy(true);
      try {
        const f=state.form;
        const result = await api(`/api/control-gastos/pendings/${encodeURIComponent(p.id)}/review`, {method:'POST', body: JSON.stringify({
          fecha_real:f.fecha_real, concepto:f.concepto, descripcion:f.descripcion, importe:f.importe, moneda:f.moneda,
          titular:f.titular, categoria:f.categoria, subcategoria:f.subcategoria, cuenta:f.cuenta, medio_pago:f.medio_pago,
          mes_pago:f.mes_pago, notas:f.notas
        })});
        state.reviewResult = { ok:true, note:`Guardado ${result.revision?.at || ''}. Antes/Después calculado y auditado (sin registro contable).` };
        await loadAll(true); render();
      } catch(e){
        state.reviewResult = e.data || { ok:false, error:e.message };
        render();
      } finally { setBusy(false); }
    });
    root.querySelector('[data-cg-action="check-operation"]')?.addEventListener('click', async (e)=>{
      if (state.busy) return; setBusy(true);
      try { await refreshOperation(e.currentTarget.dataset.cgOpKind === 'correction' ? 'correction' : 'pending'); }
      catch(err) { state.error=err; } finally { setBusy(false); }
    });
    root.querySelector('[data-cg-action="propose-correction"]')?.addEventListener('click', async ()=>{
      readCorrectionForm(root); const cf=state.correctionForm; if(!cf.row_num || !Object.keys(cf.changes||{}).length){ alert('Indica fila y al menos un campo a cambiar.'); return; }
      if(!confirm('Crear propuesta de corrección con Antes/Después (prueba, sin escribir en Movimientos real)?')) return;
      setBusy(true);
      try {
        await api('/api/control-gastos/corrections/propose', {method:'POST', body: JSON.stringify({ payload: { row_num: Number(cf.row_num), mov_id: cf.mov_id, reason: cf.reason, changes: cf.changes, before: cf.before||{}, date: state.selectedDate } })});
        state.correctionForm = { row_num:'', mov_id:'', reason:'', changes:{}, before:{} };
        await loadAll(true); state.tab='historial'; render();
      } catch(e){ alert('No se pudo crear propuesta: '+(e.data?.error||e.message)); }
      finally{ setBusy(false); }
    });
    root.querySelectorAll('[data-cg-apply-prop]').forEach(btn=>btn.addEventListener('click', async ()=>{
      if (state.busy) return;
      const id=btn.dataset.cgApplyProp; if(!confirm('Enviar la corrección a la cola con aprobación explícita (sin escritura directa en Sheets)?')) return;
      setBusy(true);
      try {
        const result = await api(`/api/control-gastos/corrections/${encodeURIComponent(id)}/apply`, {method:'POST', body: JSON.stringify({approved:true, confirm:true})});
        state.correctionOperation = {operationId:result.operationId,status:result.operationStatus,type:'correction'};
        await loadAll(true); state.tab='historial'; render();
      }
      catch(e){ alert('No se pudo encolar: '+(e.data?.error||e.message)); }
      finally{ setBusy(false); }
    }));
    root.querySelectorAll('[data-cg-edit-mov]').forEach(btn=>btn.addEventListener('click', ()=>{
      const row = (getSelectedClosure()?.closure?.resumen_gastos||[]).find(r=>String(r.fila)===String(btn.dataset.row) || String(r.id)===String(btn.dataset.mov)) || null;
      state.tab='historial';
      state.correctionForm = { row_num: btn.dataset.row||'', mov_id: btn.dataset.mov||'', reason:'', changes:{},
        before: row ? { fecha_real:row.fecha_real, comercio:row.comercio, descripcion:row.descripcion, importe:row.importe, moneda:row.moneda, categoria:row.categoria, subcategoria:row.subcategoria, titular:row.titular, cuenta:row.cuenta, medio_pago:row.medio_pago, mes_pago:row.mes_pago } : {} };
      render();
    }));
    root.querySelector('[data-cg-action="sync-initial"]')?.addEventListener('click', async ()=>{
      if (state.busy) return; setBusy(true);
      try {
        const prep = await api('/api/control-gastos/sync/initial-payload');
        const items = prep.payload?.pendings || [];
        const resumen = items.map(p=>`- ${p.datos_interpretados?.fecha_real} · ${p.datos_interpretados?.concepto} · ${p.datos_interpretados?.importe} ${p.datos_interpretados?.moneda} · ${p.estado_sincronizacion}`).join('\n');
        if (!items.length) { alert('No hay pendientes históricos para sincronizar.'); return; }
        if (!confirm(`Sincronización operativa inicial (ÚNICA EJECUCIÓN):\n\n${resumen}\n\nSolo escribe estado operativo en Firestore. NO escribe en Finanzas Edu → Movimientos. Aplicar sigue deshabilitado. ¿Continuar?`)) return;
        const result = await api('/api/control-gastos/sync', { method:'POST', body: JSON.stringify(prep.payload) });
        state.syncInitialResult = { ok:true, note:`Sincronizados ${items.length} pendientes (estado: ${result.syncState?.status||'sincronizado'}). Verificá la lista en esta misma pestaña.` };
        await loadAll(true); state.tab='pendientes'; render();
      } catch(e){
        state.syncInitialResult = e.data || { ok:false, error:e.message };
        await loadAll(true); state.tab='pendientes'; render();
      } finally { setBusy(false); }
    });
  }

  function mount(){
    if (!document.querySelector('link[data-cg-css]')) {
      const l=document.createElement('link'); l.rel='stylesheet'; l.href='control-gastos.css?v=dev-cg-1'; l.dataset.cgCss='1'; document.head.appendChild(l);
    }
    if (!state.loaded && !state.loading) loadAll(false); else render();
  }

  document.addEventListener('panel:view-root-changed', (e)=>{ if (e.detail?.view === 'control-gastos') mount(); });
  document.addEventListener('panel:section-modules-ready', (e)=>{ if (e.detail?.view === 'control-gastos') mount(); });
  window.__CONTROL_GASTOS__ = { state, loadAll };
})();
