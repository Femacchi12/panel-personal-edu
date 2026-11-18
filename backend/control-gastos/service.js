"use strict";

const crypto = require("crypto");
const { nowIso, deepClone, idemKey, hashPayload } = require("./storage");
const { buildSeed } = require("./fixtures");
const { CATALOGS, validatePendingResolution, validateCorrection, buildBeforeAfter, norm, EDITABLE_FIELDS } = require("./validation");
const { MovimientosWriter, buildMovimientoRow, buildRowValues, assertTargetAllowed, isProdTarget, productionWriteEnabled, FINANCE_SS, PROD_SHEET } = require("./movimientos-writer");

const TC = { USD_COP: 3150.0, USD_ARS: 1500.0, ARS_COP: 2.1 };
const AR_ALLOWED_EMAIL = "fernandoemacchi@gmail.com";

let _configuredWriter = null;
let _configuredWriteTarget = null;
function configureControlledWrites({ writer, target } = {}) {
  _configuredWriter = writer || null;
  _configuredWriteTarget = target || null;
  return { ok: true, configured: !!writer, target: _configuredWriteTarget, production_write_enabled: productionWriteEnabled() };
}
function getControlledWriter() { return _configuredWriter; }
function getFixedTestTarget() {
  const enforced = String(process.env.CONTROL_GASTOS_TEST_TARGET_ENFORCED || "0").toLowerCase();
  const id = norm(process.env.CONTROL_GASTOS_FIXED_TEST_SPREADSHEET_ID || process.env.CONTROL_GASTOS_SHEETS_TEST_SPREADSHEET_ID || "");
  const sheet = norm(process.env.CONTROL_GASTOS_FIXED_TEST_SHEET || process.env.CONTROL_GASTOS_SHEETS_TEST_SHEET || "Movimientos_Test");
  if ((enforced === "1" || enforced === "true") && id) return { spreadsheetId: id, sheet };
  return null;
}
function getWriteTarget(override) {
  // If fixed TEST target is enforced (preprod), ignore client/request/env overrides and always use the fixed TEST target.
  const fixed = getFixedTestTarget();
  if (fixed) return fixed;
  const t = _configuredWriteTarget || null; // server-configured only (never trust client-supplied target)
  if (t && t.spreadsheetId && t.sheet) return t;
  return { spreadsheetId: FINANCE_SS, sheet: PROD_SHEET }; // canonical (blocked by guards when production disabled)
}

function recalcAmounts(moneda, importe){
  const m = String(moneda||"").toUpperCase(); const amt = Number(importe);
  if (!(amt>0)) return { monto_cop:null,monto_ars:null,monto_usd:null };
  if (m==="COP") return { monto_cop: amt, monto_ars: +(amt/TC.ARS_COP).toFixed(2), monto_usd: +(amt/TC.USD_COP).toFixed(2) };
  if (m==="USD") return { monto_cop: +(amt*TC.USD_COP).toFixed(2), monto_ars: +(amt*TC.USD_ARS).toFixed(2), monto_usd: amt };
  if (m==="ARS") return { monto_cop: +(amt*TC.ARS_COP).toFixed(2), monto_ars: amt, monto_usd: +(amt/TC.USD_ARS).toFixed(2) };
  return { monto_cop:null,monto_ars:null,monto_usd:null };
}

function isWriteAuthorized(user){
  return norm(user?.email).toLowerCase() === AR_ALLOWED_EMAIL; // AR personal only
}

function fixturesEnabled(storeType){
  // Fixtures (5 históricos + cierres de prueba) solo en entornos explícitos de
  // desarrollo/prueba. En Cloud Run/preprod/prod (firestore o proyecto real)
  // quedan deshabilitados: el módulo muestra estados vacíos identificados.
  if (String(process.env.CONTROL_GASTOS_FIXTURES || "").toLowerCase() === "0") return false;
  const type = storeType || String(process.env.CONTROL_GASTOS_STORE || "memory").toLowerCase();
  if (type === "firestore") return String(process.env.CONTROL_GASTOS_SEED_TEST || "") === "1"; // solo explícito
  const project = String(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "");
  return !project || project === "demo-control-gastos-local";
}

function ensureTestSeed(store){
  // idempotent seed for isolated/dev stores only. Do NOT auto-seed in firestore unless explicitly enabled.
  return (async()=>{
    const storeType = String(process.env.CONTROL_GASTOS_STORE || "memory").toLowerCase();
    if (!fixturesEnabled(storeType)) return;
    const st = await store.getState();
    if ((st.pendings||[]).length===0 && Object.keys(st.closures||{}).length===0) {
      await store.saveState({ ...st, ...buildSeed() });
    }
  })();
}

async function listPendings(store){
  await ensureTestSeed(store);
  const items = await store.getPendings();
  // return originals (5 must keep original state); annotate test/non-applied
  return items.map(p=>({ ...p, _ui: { readonly_original_preserved: true } }));
}

async function getPending(store, id){
  await ensureTestSeed(store);
  return store.getPendingById(id);
}

function normalizeResolutionInput(body){
  const f = body || {};
  return {
    fecha_real: norm(f.fecha_real),
    // The resolution form edits "concepto", so it wins over any stale
    // "comercio" the browser may still hold from the original parse.
    concepto: norm(f.concepto || f.comercio),
    comercio: norm(f.concepto || f.comercio),
    descripcion: norm(f.descripcion || f.descripcion_original),
    importe: f.importe,
    moneda: norm(f.moneda || 'COP').toUpperCase(),
    titular: norm(f.titular),
    categoria: norm(f.categoria),
    subcategoria: norm(f.subcategoria),
    cuenta: norm(f.cuenta || f.cuenta_tarjeta),
    medio_pago: norm(f.medio_pago || f.modalidad_pago),
    mes_pago: norm(f.mes_pago),
    notas: norm(f.notas || f.aclaracion),
    resolucion: norm(f.resolucion || f.accion), // es_nuevo | ya_registrado | necesita_revision | saldo_parcial | compra_dividida
    duplicado_de: f.duplicado_de || null,
    vinculacion: f.vinculacion || null,
    partes_divididas: Array.isArray(f.partes_divididas) ? f.partes_divididas : null
  };
}

async function previewPendingResolution(store, id, body){
  await ensureTestSeed(store);
  const item = await store.getPendingById(id);
  if (!item) return { ok:false, status:404, error:"pending_not_found" };
  const input = normalizeResolutionInput(body);
  const parsed = item.datos_interpretados || {};
  const before = {
    fecha_real: parsed.fecha_real || "", comercio: parsed.concepto || "", descripcion: parsed.texto_original || "",
    importe: parsed.importe ?? "", moneda: parsed.moneda || "", categoria: parsed.categoria || "", subcategoria: parsed.subcategoria || "",
    titular: parsed.titular || "", cuenta: parsed.cuenta_tarjeta || "", medio_pago: parsed.modalidad_pago || "", mes_pago: parsed.mes_pago || ""
  };
  const after = { ...before, ...input };
  const v = validatePendingResolution({ ...after, concepto: after.concepto || after.comercio });
  // duplicate detection hint (simple heuristic vs existing known ids/refs; in full impl query Movimientos)
  const duplicateHints = [];
  if (item.motivo_ambiguedad?.some(m=>/duplic|parcial|saldo/i.test(m))) duplicateHints.push({ reason: "Marcado como posible duplicado/saldo parcial en origen", action_required: true });
  const amounts = recalcAmounts(after.moneda, after.importe);
  const comparison = buildBeforeAfter(before, { ...after, importe: after.importe });
  const operacion = input.resolucion === 'ya_registrado' ? 'descartar_duplicado' : (input.resolucion === 'necesita_revision' ? 'mantener_pendiente' : 'registrar_nuevo');
  // Compra dividida: partes con concepto e importe propios (cada una una fila).
  const partes = Array.isArray(input.partes_divididas) ? input.partes_divididas.filter(p => p && typeof p === "object") : [];
  const partesValidas = partes.map(p => ({ concepto: norm(p.concepto || p.comercio), importe: Number(p.importe) }));
  const partesOk = partesValidas.length >= 2 && partesValidas.every(p => p.concepto && p.importe > 0);
  const partesResumen = partesValidas.map(p => ({ ...p, montos: recalcAmounts(after.moneda, p.importe) }));
  const sumaPartes = partesValidas.reduce((s, p) => s + (p.importe > 0 ? p.importe : 0), 0);
  let canApply = v.ok && input.resolucion !== 'necesita_revision' && !duplicateHints.some(d=>d.action_required && !input.resolucion);
  if (input.resolucion === 'compra_dividida' && !partesOk) canApply = false;
  return {
    ok:true,
    pending: item,
    input,
    validation: v,
    duplicateHints,
    amounts,
    comparison,
    operacion_propuesta: operacion,
    compra_dividida: input.resolucion === 'compra_dividida',
    partes: partesResumen,
    partes_ok: partesOk,
    suma_partes: sumaPartes,
    confirmation_required: true,
    canApply,
    note: "Preview aislado. Ninguna escritura en Finanzas Edu Movimientos durante esta etapa."
  };
}

async function applyPendingResolution(store, id, body, user, req){
  await ensureTestSeed(store);
  if (!isWriteAuthorized(user)) return { ok:false, status:403, error:"forbidden", message:"Solo la cuenta personal autorizada (AR) puede ejecutar escrituras financieras." };
  const key = idemKey(req, body) || `apply:${id}:${hashPayload(body)}`;
  const existing = await store.getIdempotency(key);
  if (existing) return { ok:true, idempotent:true, result: existing.result };
  const preview = await previewPendingResolution(store, id, body);
  if (!preview.ok) return preview;
  if (!preview.canApply) return { ok:false, status:400, error:"invalid_or_blocked", validation: preview.validation, preview };
  const approved = !!body.approved || !!body.confirm;
  if (!approved) return { ok:false, status:400, error:"confirmation_required", preview };
  const item = await store.getPendingById(id);

  const writer = getControlledWriter();
  const target = getWriteTarget(); // fixed/server-configured only; client cannot select target
  const allowProductionExplicit = !!body?.allow_production_explicit && productionWriteEnabled();
  const guard = assertTargetAllowed(target, { allowProductionExplicit });

  if (writer && guard.ok) {
    const op = preview.operacion_propuesta;
    let writeResult = null;
    if (op === "registrar_nuevo" || op === "saldo_parcial") {
      const inp = preview.input;
      const foBase = item.message_key || item.message_id || item.id || String(id);
      let rowsToInsert = [];
      if (inp.resolucion === "compra_dividida" && Array.isArray(inp.partes_divididas) && inp.partes_divididas.length) {
        rowsToInsert = inp.partes_divididas.map((p, i) => {
          const pin = { ...inp, ...p, descripcion: p.descripcion || inp.descripcion, comercio: p.comercio || p.concepto || inp.comercio, concepto: p.concepto || p.comercio || inp.concepto };
          const am = recalcAmounts(pin.moneda || inp.moneda, pin.importe);
          return buildMovimientoRow(pin, { fila_origen: `${foBase}#${i+1}`, fuente: "Dashboard Personal / Control de gastos", estado: "Registrado", amounts: am, observaciones_extra: "Compra dividida (partes vinculadas)" });
        });
      } else {
        rowsToInsert = [buildMovimientoRow({ ...inp, concepto: inp.concepto || inp.comercio }, { fila_origen: foBase, fuente: "Dashboard Personal / Control de gastos", estado: op === "saldo_parcial" ? "Registrado (parcial)" : "Registrado", amounts: preview.amounts })];
      }
      writeResult = await writer.appendMovimientos({ target, rows: rowsToInsert, allowProductionExplicit, dedupeByFilaOrigen: true });
      if (!writeResult.ok) {
        const fail = { ok:false, status: writeResult.status || 500, error: writeResult.error || "write_failed", write: writeResult, note: "Escritura controlada falló o no verificada por lectura posterior. No se marcó como aplicado." };
        await store.addAudit({ type:"pending_apply_write_failed", pending_id:item.id, by:user?.email, result: fail });
        return fail;
      }
    } else if (op === "descartar_duplicado") {
      writeResult = { ok:true, appended:0, skipped:[{reason:"descartado_duplicado_sin_escritura"}], verified:true, applied_to_production:false, note:"Duplicado confirmado: no se inserta fila en Movimientos." };
    }
    const applied = {
      action: op,
      applied_to_production: !!(writeResult && writeResult.applied_to_production),
      production_write_enabled: productionWriteEnabled(),
      target: { spreadsheetId: target.spreadsheetId, sheet: target.sheet },
      pending_id: item.id,
      message_key: item.message_key,
      input: preview.input,
      amounts: preview.amounts,
      comparison: preview.comparison,
      write: writeResult,
      verified_readback: writeResult?.readback?.verified ?? writeResult?.verified ?? null,
      at: nowIso(),
      by: user?.email || null
    };
    const updated = deepClone(item);
    updated.estado_sincronizacion = op === 'descartar_duplicado' ? 'descartado_duplicado' : (applied.applied_to_production ? 'registrado' : 'registrado_en_prueba');
    updated.estado_validacion = 'validado';
    updated.resolution_preview = preview;
    updated.applied_result = applied;
    updated.updated_at = nowIso();
    updated._original_preserved = item._original_preserved || { estado_sincronizacion: item.estado_sincronizacion, estado_validacion: item.estado_validacion, motivo_ambiguedad: item.motivo_ambiguedad, datos_interpretados: item.datos_interpretados };
    await store.upsertPending(updated);
    const audit = await store.addAudit({ type: applied.applied_to_production ? "pending_apply_production" : "pending_apply_test_write", pending_id:item.id, message_key:item.message_key, by:user?.email, result: applied });
    const result = { ok:true, applied, pending: updated, audit_id: audit.id, note: applied.applied_to_production ? "Movimiento aplicado en Movimientos con verificación por lectura posterior." : "Aplicación controlada ejecutada en destino de prueba aislado (o descartado). Finanzas Edu producción NO modificado." };
    await store.setIdempotency(key, { at: nowIso(), hash: hashPayload(body), result });
    return result;
  }

  const simulated = {
    action: preview.operacion_propuesta,
    applied_to_production: false,
    production_write_enabled: productionWriteEnabled(),
    target_sheet: `${FINANCE_SS}/Movimientos`,
    pending_id: item.id,
    message_key: item.message_key,
    input: preview.input,
    amounts: preview.amounts,
    comparison: preview.comparison,
    verified_readback: null,
    at: nowIso(),
    by: user?.email || null
  };
  const updated = deepClone(item);
  updated.estado_sincronizacion = preview.operacion_propuesta === 'descartar_duplicado' ? 'descartado_duplicado_test' : 'resuelto_en_prueba';
  updated.estado_validacion = 'validado_en_prueba';
  updated.resolution_preview = preview;
  updated.simulated_apply = simulated;
  updated.updated_at = nowIso();
  updated._original_preserved = item._original_preserved || { estado_sincronizacion: item.estado_sincronizacion, estado_validacion: item.estado_validacion, motivo_ambiguedad: item.motivo_ambiguedad, datos_interpretados: item.datos_interpretados };
  await store.upsertPending(updated);
  const audit = await store.addAudit({ type:"pending_apply_test", pending_id:item.id, message_key:item.message_key, by:user?.email, result: simulated });
  const result = { ok:true, simulated, pending: updated, audit_id: audit.id, note:"Aplicación simulada (sin writer/target de prueba). Finanzas Edu Movimientos NO modificado." };
  await store.setIdempotency(key, { at: nowIso(), hash: hashPayload(body), result });
  return result;
}

// Emulator-only adapter by default. No Sheets calls and no mutation of the pending item.
// With allowReal (CONTROL_GASTOS_QUEUE_ENABLED=1 y escrituras productivas
// deshabilitadas), pendientes REALES pueden encolarse: la operacion queda
// PENDING y solo la consume el escritor secuencial local autorizado.
async function enqueuePendingResolution(store, queue, id, body, user, req, opts = {}) {
  if (!isWriteAuthorized(user)) return {ok:false,status:403,error:"forbidden"};
  if (!queue) return {ok:false,status:503,error:"isolated_queue_unavailable"};
  const allowReal = opts.allowReal === true;
  if (!String(id).startsWith("cgtest_") && !allowReal) return {ok:false,status:403,error:"synthetic_pending_required"};
  if (body?.approved !== true || body?.confirm !== true) return {ok:false,status:400,error:"confirmation_required"};
  const preview = await previewPendingResolution(store,id,body);
  if (!preview.ok) return preview;
  if (!preview.canApply || preview.operacion_propuesta !== "registrar_nuevo")
    return {ok:false,status:400,error:"invalid_or_unsupported_resolution"};
  const inp=preview.input, item=await store.getPendingById(id);
  const origin = String(item.message_key || item.id || id);
  if (!allowReal && !origin.startsWith("CGTEST:")) return {ok:false,status:403,error:"synthetic_origin_required"};
  const parts = inp.resolucion === "compra_dividida" ? inp.partes_divididas : null;
  if (inp.resolucion === "compra_dividida" && (!parts || parts.length < 2 || parts.length > 20))
    return {ok:false,status:400,error:"invalid_split"};
  const inputs = parts ? parts.map(p=>({...inp,...p, concepto:p.concepto || p.comercio || inp.concepto})) : [inp];
  if (inputs.some(p=>!validatePendingResolution(p).ok || !CATALOGS.cuentas.includes(p.cuenta) ||
      (p.subcategoria && !(CATALOGS.subcategorias_por_categoria[p.categoria]||[]).includes(p.subcategoria))))
    return {ok:false,status:400,error:"invalid_catalog_or_fields"};
  const rows = inputs.map((p,i)=>buildRowValues(buildMovimientoRow(p,{
    fila_origen:parts ? `${origin}#${i+1}` : origin,
    fuente:"TEST aislado", amounts:recalcAmounts(p.moneda,p.importe)
  })));
  const key = idemKey(req || {headers:{}}, body) || `pending:${id}:${hashPayload(body)}`;
  try {
    const queued = await queue.enqueue({operationKey:key, filaOrigen:origin, type:parts ? "split" : "insert", rows, confirmed:true});
    const operation = await queue.getOperation(queued.id);
    return {ok:true,status:202,operationId:queued.id,operationStatus:operation.status,duplicate:queued.duplicate};
  } catch (e) {
    if (e.message === "idempotency_conflict") return {ok:false,status:409,error:"idempotency_conflict"};
    return {ok:false,status:503,error:"isolated_queue_unavailable"};
  }
}

async function listClosures(store, opts={}){
  await ensureTestSeed(store);
  const closures = await store.getClosures();
  const reviews = await store.getReviews();
  let dates = Object.keys(closures).sort();
  if (opts.date) dates = dates.filter(d=>d===opts.date);
  const items = dates.map(d=>({ date:d, closure: closures[d], review: reviews[d] || { state: (reviews[d]?.reviewed?"revisado":"pendiente_revision"), label: (reviews[d]?.reviewed?"Revisado":"Pendiente de revisión") } }));
  return { items, sync: await store.getSyncState() };
}

async function markClosureReviewed(store, date, body, user){
  if (!isWriteAuthorized(user)) return { ok:false, status:403, error:"forbidden" };
  await ensureTestSeed(store);
  const reviewed = body?.reviewed !== false;
  const review = { reviewed, status: reviewed?"revisado":"pendiente_revision", at: nowIso(), note: norm(body?.note), by: user?.email };
  await store.setReview(date, review);
  await store.addAudit({ type:"closure_review", date, review, by:user?.email });
  return { ok:true, date, review };
}

async function refreshClosure(store, date, user){
  // no live Sheets recompute in isolated stage; return existing + stale marker unless synced
  await ensureTestSeed(store);
  const closures = await store.getClosures();
  const c = closures[date];
  if (!c) return { ok:false, status:404, error:"closure_not_found", note:"No existe cierre local; se requiere sync/generación desde servicio operativo con acceso a Sheets." };
  c._refreshed_at_test = nowIso();
  await store.upsertClosure(date, c);
  return { ok:true, date, closure: c, note:"Actualización en entorno de prueba (sin regenerar desde Sheets productivo)." };
}

async function listCorrections(store){
  await ensureTestSeed(store);
  return store.getCorrections();
}

// Corrections go through the same durable queue and single writer as inserts.
// The API never writes a sheet and never updates a proposal as applied: the
// proposal only records that an operation was enqueued.
async function enqueueCorrection(store, queue, proposalId, body, user, req){
  if (!isWriteAuthorized(user)) return { ok:false, status:403, error:"forbidden" };
  if (!queue) return { ok:false, status:503, error:"isolated_queue_unavailable" };
  if (body?.approved !== true || body?.confirm !== true) return { ok:false, status:400, error:"confirmation_required" };
  const corr = await store.getCorrections();
  const prop = (corr.proposals || []).find(p => String(p.id) === String(proposalId));
  if (!prop) return { ok:false, status:404, error:"proposal_not_found" };
  if (prop.status === "en_cola" && prop.operation_id) {
    const existing = await queue.getOperation(prop.operation_id).catch(()=>null);
    return { ok:true, status:202, operationId:prop.operation_id, operationStatus:existing?.status || "PENDING", duplicate:true };
  }
  if (prop.status !== "propuesta") return { ok:false, status:409, error:"proposal_not_open", status_detail:prop.status };
  const payload = prop.payload || {};
  const rowNum = Number(payload.row_num || payload.row);
  if (!Number.isInteger(rowNum) || rowNum < 2) return { ok:false, status:400, error:"invalid_row_reference" };
  const movId = norm(payload.mov_id);
  if (!/^MOV-\d{5}$/.test(movId)) return { ok:false, status:400, error:"invalid_mov_id_reference" };
  const changes = payload.changes || {};
  const before = payload.comparison?.before || payload.before || {};
  const validation = validateCorrection(changes, before);
  if (!validation.ok) return { ok:false, status:400, error:"invalid", validation };
  const patch = { ...changes };
  if ("importe" in changes || "moneda" in changes) {
    const moneda = norm(changes.moneda || before.moneda || "COP").toUpperCase();
    const importe = changes.importe ?? before.importe;
    const amounts = recalcAmounts(moneda, importe);
    if (amounts.monto_cop == null) return { ok:false, status:400, error:"invalid_amount_or_currency", validation };
    patch.amounts = amounts;
  }
  const key = idemKey(req || { headers:{} }, body) ||
    `correction:${proposalId}:${hashPayload({ rowNum, movId, patch })}`;
  try {
    const queued = await queue.enqueue({ operationKey:key, filaOrigen:payload.fila_origen || `correction:${movId}`,
      type:"correction", rowNum, movId, patch, rows:[], confirmed:true });
    const operation = await queue.getOperation(queued.id);
    if (!queued.duplicate) {
      prop.status = "en_cola";
      prop.operation_id = queued.id;
      prop.history = prop.history || [];
      prop.history.push({ at: nowIso(), action:"en_cola", by:user?.email, operation_id:queued.id });
      await store.setCorrections(corr);
      await store.addAudit({ type:"correction_enqueued", proposal_id:proposalId, operation_id:queued.id, by:user?.email });
    }
    return { ok:true, status:202, operationId:queued.id, operationStatus:operation.status, duplicate:queued.duplicate };
  } catch (e) {
    if (e.message === "idempotency_conflict") return { ok:false, status:409, error:"idempotency_conflict" };
    return { ok:false, status:503, error:"isolated_queue_unavailable" };
  }
}

async function proposeCorrection(store, body, user){
  if (!isWriteAuthorized(user)) return { ok:false, status:403, error:"forbidden" };
  await ensureTestSeed(store);
  const payload = body?.payload || body;
  const row = payload.row_num || payload.row;
  const changes = payload.changes || {};
  const before = payload.before || {};
  const comparison = buildBeforeAfter(before, { ...before, ...changes });
  if (!comparison.hasChanges) return { ok:false, status:400, error:"no_changes" };
  const v = validateCorrection(changes, before);
  if (!v.ok) return { ok:false, status:400, error:"invalid", validation:v };
  const prop = { id: crypto.randomUUID(), date: norm(payload.date)||null, created_at: nowIso(), status:"propuesta", payload:{ mode:"simple_fields", row_num: row, mov_id: payload.mov_id||null, reason: norm(payload.reason), changes, comparison, validation:v }, history:[{at:nowIso(), action:"propuesta", by:user?.email}] };
  const corr = await store.getCorrections();
  corr.proposals = corr.proposals || []; corr.proposals.push(prop);
  await store.setCorrections(corr);
  await store.addAudit({ type:"correction_proposed", proposal_id: prop.id, by:user?.email, payload: prop.payload });
  return { ok:true, proposal: prop };
}

async function applyCorrection(store, proposalId, body, user, req){
  if (!isWriteAuthorized(user)) return { ok:false, status:403, error:"forbidden" };
  await ensureTestSeed(store);
  const key = idemKey(req, body) || `corr:${proposalId}:${hashPayload(body)}`;
  const existing = await store.getIdempotency(key);
  if (existing) return { ok:true, idempotent:true, result: existing.result };
  const approved = !!body?.approved || !!body?.confirm;
  if (!approved) return { ok:false, status:400, error:"confirmation_required" };
  const corr = await store.getCorrections();
  const prop = (corr.proposals||[]).find(p=>p.id===proposalId);
  if (!prop) return { ok:false, status:404, error:"proposal_not_found" };

  const writer = getControlledWriter();
  const target = getWriteTarget(); // fixed/server-configured only
  const allowProductionExplicit = !!body?.allow_production_explicit && productionWriteEnabled();
  const guard = assertTargetAllowed(target, { allowProductionExplicit });
  const rowNum = Number(prop.payload?.row_num || prop.payload?.row);

  if (writer && guard.ok && Number.isFinite(rowNum)) {
    const write = await writer.applyCorrectionWrite({ target, rowNum, changes: prop.payload?.changes || {}, before: prop.payload?.comparison?.before || prop.payload?.before || {}, allowProductionExplicit });
    if (!write.ok) {
      const fail = { ok:false, status: write.status || 500, error: write.error || "correction_write_failed", write, note:"Corrección no aplicada/verificada. Se conserva respaldo (si se obtuvo)." };
      await store.addAudit({ type:"correction_apply_write_failed", proposal_id: proposalId, by:user?.email, result: fail });
      return fail;
    }
    const record = { id: crypto.randomUUID(), proposal_id: proposalId, applied_at: nowIso(), by:user?.email, range: write.target?.range || (rowNum ? `Movimientos!A${rowNum}:AA${rowNum}` : null), backup: write.backup, write_result: write.write_result, readback: write.readback, verified: !!write.readback?.verified, applied_to_production: !!write.applied_to_production, note: write.applied_to_production ? "Corrección aplicada en producción con respaldo y verificación." : "Corrección aplicada en destino de prueba aislado con respaldo y verificación." };
    corr.applied = corr.applied || []; corr.applied.push(record);
    prop.status = write.applied_to_production ? "aplicada" : "aplicada_en_prueba"; prop.applied_record_id = record.id; prop.history = prop.history||[]; prop.history.push({at:record.applied_at, action: prop.status, by:user?.email, record_id: record.id, verified: record.verified});
    await store.setCorrections(corr);
    await store.addAudit({ type: write.applied_to_production ? "correction_applied" : "correction_applied_test_write", proposal_id: proposalId, by:user?.email, record });
    const result = { ok:true, applied: record, proposal: prop };
    await store.setIdempotency(key, { at: nowIso(), hash: hashPayload(body), result });
    return result;
  }

  const record = { id: crypto.randomUUID(), proposal_id: proposalId, applied_at: nowIso(), by:user?.email, range: prop.payload?.row_num ? `Movimientos!A${prop.payload.row_num}:AA${rowNum}` : null, backup: null, write_result: null, readback: null, verified: false, applied_to_production: false, note:"Aplicación simulada (sin escritura en Finanzas Edu). Writer/target de prueba no configurado o destino bloqueado." };
  corr.applied = corr.applied || []; corr.applied.push(record);
  prop.status = "aplicada_en_prueba"; prop.applied_record_id = record.id; prop.history = prop.history||[]; prop.history.push({at:record.applied_at, action:"aplicada_en_prueba", by:user?.email, record_id: record.id});
  await store.setCorrections(corr);
  await store.addAudit({ type:"correction_applied_test", proposal_id: proposalId, by:user?.email, record });
  const result = { ok:true, simulated:true, applied: record, proposal: prop };
  await store.setIdempotency(key, { at: nowIso(), hash: hashPayload(body), result });
  return result;
}

// Payload de la sincronizacion operativa inicial: los 5 pendientes historicos
// reales de Hermes. Fuente PRIVADA: documento sembrado en el propio store
// operativo (control_gastos_prod_private) desde la cola local del piloto;
// nunca en el repositorio publico. Ejecucion unica: se niega si ya hay
// pendientes o si la sincronizacion ya se concreto.
async function buildInitialSyncPayload(st, store){
  if ((st.pendings || []).length > 0) return { ok:false, status:409, error:"pendings_already_present" };
  if (st.syncState?.status === "sincronizado") return { ok:false, status:409, error:"already_synced" };
  const staged = await store.getPrivate("initial_sync").catch(() => null);
  if (!staged?.pendings?.length) return { ok:false, status:404, error:"initial_payload_not_seeded" };
  const pendings = staged.pendings.map(x => ({
    ...x,
    estado_sincronizacion: "pendiente_validacion",
    estado_piloto_original: x.estado_piloto_original || x.estado_sincronizacion,
    estado_validacion: "pendiente"
  }));
  const ids = pendings.map(p => p.id), keys = pendings.map(p => p.message_key);
  if (new Set(ids).size !== pendings.length || new Set(keys).size !== pendings.length)
    return { ok:false, status:409, error:"duplicate_payload" };
  return {
    ok: true,
    payload: {
      pendings,
      status: staged.status || "sincronizado",
      source: staged.source || "hermes_local_initial",
      note: staged.note || "Sincronizacion operativa inicial (Hermes): 5 pendientes historicos, sin escritura contable.",
      pendingSyncCount: Number(staged.pendingSyncCount ?? 0)
    }
  };
}

// Guarda la decision de revision de un pendiente como estado operativo
// (sin registrar movimientos financieros). Valida contra los catalogos
// oficiales, calcula Antes/Despues y deja auditoria. Los datos originales
// del pendiente se conservan intactos en `datos_interpretados`; la decision
// vive en `revision` y prefiere el frontend al abrir la ficha.
async function savePendingReview(store, id, body, user){
  if (!isWriteAuthorized(user)) return { ok:false, status:403, error:"forbidden" };
  const item = await store.getPendingById(id);
  if (!item) return { ok:false, status:404, error:"not_found" };
  const d = item.datos_interpretados || {};
  const before = {
    fecha_real: d.fecha_real || "", concepto: d.concepto || "", descripcion: d.texto_original || "",
    importe: d.importe ?? "", moneda: d.moneda || "", categoria: d.categoria || "", subcategoria: d.subcategoria || "",
    titular: d.titular || "", cuenta: d.cuenta_tarjeta || "", medio_pago: d.modalidad_pago || "", mes_pago: d.mes_pago || ""
  };
  const input = normalizeResolutionInput(body);
  const fields = ["fecha_real","concepto","descripcion","importe","moneda","titular","categoria","subcategoria","cuenta","medio_pago","mes_pago","notas"];
  const cleaned = {};
  fields.forEach(f => { const val = input[f]; if (val !== undefined && val !== null && String(val).trim() !== "") cleaned[f] = val; });
  const merged = { ...before, ...cleaned };
  const v = validatePendingResolution({ ...merged, concepto: merged.concepto || merged.comercio });
  if (!v.ok) return { ok:false, status:400, error:"invalid", validation:v };
  if (cleaned.importe != null) {
    const amounts = recalcAmounts(merged.moneda || "COP", merged.importe);
    if (amounts.monto_cop == null) return { ok:false, status:400, error:"invalid_amount_or_currency" };
  }
  const comparison = buildBeforeAfter(before, merged);
  const revision = {
    at: nowIso(),
    by: user?.email || null,
    input: cleaned,
    amounts: recalcAmounts(merged.moneda || "COP", merged.importe),
    comparison,
    aclaracion: norm(input.notas) || null,
    estado_validacion: "en_revision",
    registrada: false // nunca se registro en Movimientos; solo decision de revision
  };
  await store.upsertPending({ id: item.id, message_key: item.message_key, revision, estado_validacion: "en_revision", updated_at: nowIso() });
  await store.addAudit({ type:"pending_review_saved", pending_id:item.id, message_key:item.message_key, by:user?.email, fields:Object.keys(cleaned) });
  return { ok:true, revision, pending: await store.getPendingById(id) };
}

async function splitPending(store, id, body, user){
  if (!isWriteAuthorized(user)) return { ok:false, status:403, error:"forbidden" };
  const item = await store.getPendingById(id);
  if (!item) return { ok:false, status:404, error:"not_found" };
  // Idempotente: si ya existe el hermano, devolverlo sin crear otro (jamás duplicar gasto).
  if (item.split_sibling_id) {
    const sibling = await store.getPendingById(item.split_sibling_id);
    return { ok:true, already_split:true, original_id:item.id, sibling_id:item.split_sibling_id, sibling:sibling || null };
  }
  if (item.split_from) return { ok:false, status:409, error:"pending_is_split_part" };
  const estado = String(item.estado_validacion || "");
  if (!["pendiente_revision","en_revision"].includes(estado)) {
    return { ok:false, status:409, error:"split_not_allowed_for_state", estado };
  }
  const text = String(item.texto_relevante || "");
  // Parseo conservador: línea de concepto seguida de importe con AR$/US$/símbolo o número.
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(AR\$|US\$)?\s?([\d.,]+)$/.exec(lines[i]);
    if (!m) continue;
    const raw = m[2].replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    const simbolo = m[1] || null;
    let moneda = null;
    if (simbolo === "AR$") moneda = "ARS";
    else if (simbolo === "US$") moneda = "USD";
    // El concepto es la línea previa no-numérica más cercana.
    let concepto = null;
    for (let j = i - 1; j >= 0; j--) {
      if (/^(AR\$|US\$)?\s?[\d.,]+$/.test(lines[j])) continue;
      concepto = lines[j].replace(/^\[owner reply\]\s*/, "");
      break;
    }
    found.push({ concepto, importe: n, moneda, simbolo });
  }
  // Dedup por importe repetido en el texto (mismo concepto repetido).
  const distinct = [];
  for (const f of found) {
    if (!distinct.some(d => d.importe === f.importe && d.moneda === f.moneda)) distinct.push(f);
  }
  if (distinct.length < 2) {
    return { ok:false, status:409, error:"split_requires_two_amounts", found: distinct.length };
  }
  // Parte A = primera; Parte B (hermano nuevo) = segunda. Ambas quedan para validación del formulario.
  const partA = distinct[0], partB = distinct[1];
  const crypto = require("crypto");
  const siblingId = crypto.randomUUID();
  const now = nowIso();
  const clone = deepClone(item);
  delete clone._merged_at; delete clone.split_sibling_id;
  const origenBase = String((clone.fila_simulada || {})["Fila origen"] || clone.message_key);
  const filaB = { ...(clone.fila_simulada || {}) };
  filaB["ID"] = (filaB["ID"] ? String(filaB["ID"]) + "-b" : siblingId);
  filaB["Monto original"] = partB.importe;
  filaB["Moneda original"] = partB.moneda || filaB["Moneda original"] || "";
  filaB["Descripción / Comercio"] = partB.concepto || (filaB["Descripción / Comercio"] ? String(filaB["Descripción / Comercio"]) + " (B)" : "Concepto B");
  filaB["Descripción original"] = text;
  filaB["Fila origen"] = origenBase + ":b";
  filaB["Observaciones"] = "División controlada del pendiente " + item.id + " (parte B): ambos conceptos requieren validación en formulario. No registrado en Movimientos.";
  filaB["Estado"] = "Pendiente de revisión";
  const di = { ...(clone.datos_interpretados || {}) };
  di.importe = partB.importe; di.moneda = partB.moneda || null; di.moneda_fuente = partB.moneda ? ("explicit:" + partB.moneda) : null;
  di.concepto = partB.concepto || di.concepto || null;
  di.split_from = item.id; di.split_part = "B";
  const conv = recalcAmounts(partB.moneda || "ARS", partB.importe);
  di.monto_cop = conv.monto_cop ?? null; di.monto_ars = conv.monto_ars ?? null; di.monto_usd = conv.monto_usd ?? null;
  const sibling = {
    ...clone,
    id: siblingId,
    fila_simulada: filaB,
    datos_interpretados: di,
    estado_validacion: "pendiente_revision",
    revision: null,
    notas_revision: null,
    motivo_ambiguedad: ["Pendiente dividido en dos conceptos (parte B): confirmar categoría/moneda/medio en el formulario"],
    split_from: item.id,
    split_part: "B",
    created_at: now,
    updated_at: now,
  };
  const convA = recalcAmounts(partA.moneda || "ARS", partA.importe);
  const diA = { ...(item.datos_interpretados || {}) };
  diA.split_from = item.id; diA.split_part = "A"; diA.split_sibling_id = siblingId;
  await store.upsertPending(sibling);
  await store.upsertPending({
    id: item.id,
    message_key: item.message_key,
    datos_interpretados: diA,
    split_sibling_id: siblingId,
    split_part: "A",
    estado_validacion: item.estado_validacion === "en_revision" ? "en_revision" : "pendiente_revision",
    updated_at: now,
  });
  await store.addAudit({ type:"pending_split", original_id:item.id, sibling_id:siblingId, message_key:item.message_key,
    by:user?.email || null, partA:{ concepto:partA.concepto, importe:partA.importe, moneda:partA.moneda, monto_cop:convA.monto_cop },
    partB:{ concepto:partB.concepto, importe:partB.importe, moneda:partB.moneda, monto_cop:conv.monto_cop } });
  return { ok:true, split:true, original_id:item.id, sibling_id:siblingId,
    parts:[ { part:"A", ...partA }, { part:"B", ...partB } ],
    original: await store.getPendingById(item.id), sibling: await store.getPendingById(siblingId) };
}

async function ingestSync(store, body, user, meta = {}){
  // authenticated sync from local Hermes agent. Ingest operational state only; no direct Movimientos writes here.
  // Accepts AR firebase user OR device sync token (scope sync_operational) - both resolved to authorized context by routes.
  if (!isWriteAuthorized(user)) return { ok:false, status:403, error:"forbidden" };
  await ensureTestSeed(store);
  const incoming = body || {};
  const st = await store.getState();
  // merge strategy (simple, idempotent by ids/keys) - safe for offline catchup
  if (Array.isArray(incoming.pendings)) {
    const byKey = new Map((st.pendings||[]).map(p=>[String(p.id||p.message_key), p]));
    for (const p of incoming.pendings) { const k=String(p.id||p.message_key); if(!k) continue; if(!byKey.has(k)) byKey.set(k,p); else {
      const prev = byKey.get(k);
      const next = { ...prev, ...p };
      // La revision guardada en el Dashboard prevalece sobre el estado local:
      // la sync diaria no debe regresar decisiones ya tomadas por el usuario.
      if (prev?.revision) { next.revision = prev.revision; if (prev.estado_validacion === "en_revision") next.estado_validacion = prev.estado_validacion; }
      // REGLA: estados que el escritor ya confirmó no se revierten por sync.
      if (prev.estado_sincronizacion === "registrado") { next.estado_sincronizacion = "registrado"; next.registro = prev.registro; }
      byKey.set(k, { ...next, _merged_at: nowIso() });
    } }
    st.pendings = Array.from(byKey.values());
  }
  if (incoming.closures && typeof incoming.closures==='object') st.closures = { ...(st.closures||{}), ...incoming.closures };
  if (incoming.reviews && typeof incoming.reviews==='object') st.reviews = { ...(st.reviews||{}), ...incoming.reviews };
  // corrections/proposals from local are operational references; avoid duplicating by id if provided
  if (incoming.corrections) st.corrections = { proposals: [...(st.corrections?.proposals||[]), ...((incoming.corrections.proposals)||[])], applied: [...(st.corrections?.applied||[]), ...((incoming.corrections.applied)||[])] };
  st.syncState = { ...(st.syncState||{}), lastSyncAt: nowIso(), pendingSyncCount: Number(incoming.pendingSyncCount||0), status: incoming.status || 'sincronizado', source: incoming.source || 'hermes_local', authType: meta.authType || user?.authType || 'firebase_user', deviceId: user?.deviceId || null, note: incoming.note || null };
  await store.saveState(st);
  await store.addAudit({ type:"sync_ingest", by:user?.email, deviceId: user?.deviceId || null, authType: meta.authType || user?.authType || null, counts:{ pendings:(incoming.pendings||[]).length, closures:Object.keys(incoming.closures||{}).length } });
  return { ok:true, syncState: st.syncState };
}

async function getStatus(store){
  await ensureTestSeed(store);
  const st = await store.getState();
  const storeType = String(process.env.CONTROL_GASTOS_STORE || "memory").toLowerCase();
  const firestoreConfigured = storeType === "firestore";
  const dbId = process.env.CONTROL_GASTOS_FIRESTORE_DATABASE || "(default)";
  const fixtures = fixturesEnabled(storeType);
  const localQueue = String(process.env.CONTROL_GASTOS_LOCAL_QUEUE || "") === "1" &&
    String(process.env.GCLOUD_PROJECT || "") === "demo-control-gastos-local" &&
    /^(127\.0\.0\.1|localhost):\d+$/.test(String(process.env.FIRESTORE_EMULATOR_HOST || "")) &&
    !productionWriteEnabled();
  // Aplicar financiero disponible cuando existe cola + consumidor con destino
  // configurado: local aislado (mock) o canónico (PRODUCTION_WRITE_ENABLED=true
  // + CANONICAL_CONSUMER=1 + identidad dedicada).
  const canonicalReady = String(process.env.CONTROL_GASTOS_CANONICAL_CONSUMER || "") === "1" &&
    productionWriteEnabled() &&
    !!String(process.env.CONTROL_GASTOS_CANONICAL_WRITER_SA || "").trim() &&
    String(process.env.CONTROL_GASTOS_STORE || "") === "firestore";
  const mode = localQueue ? "local_e2e" : (firestoreConfigured ? "operational_preprod" : "test_isolated");
  const fixedTarget = getFixedTestTarget();
  const effectiveTarget = getWriteTarget();
  const emptyRealState = !fixtures && (st.pendings||[]).length===0 && Object.keys(st.closures||{}).length===0;
  const notes = [];
  if (firestoreConfigured) notes.push(`Estado operativo centralizado en Firestore (db=${dbId}).`);
  else notes.push(fixtures ? "Entorno aislado de desarrollo/prueba (fixtures locales)." : "Almacenamiento local sin datos sincronizados.");
  if (emptyRealState) notes.push("Sincronización de pendientes reales desde Hermes aún no habilitada: la vista muestra estado vacío identificado; no se inventan datos.");
  notes.push(fixedTarget ? `Destino de escritura forzado a hoja TEST (${fixedTarget.spreadsheetId}/${fixedTarget.sheet}). Finanzas Edu canónico bloqueado.` : "Sin escrituras en Finanzas Edu Movimientos real. Sync automática permanente NO habilitada.");
  notes.push(localQueue ? "Aplicar financiero disponible SOLO en entorno local aislado (escritor mock)." : "Aplicar financiero deshabilitado en esta etapa: solo lectura, validación y revisión. No se encolan operaciones financieras.");
  if (fixtures) notes.push("Los 5 pendientes históricos se muestran conservando su estado original (entorno de prueba).");
  return {
    ok:true,
    mode,
    production_write_enabled: productionWriteEnabled(),
    firestore_configured: firestoreConfigured,
    firestore_database: firestoreConfigured ? dbId : null,
    firestore_project: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || null,
    store_type: storeType,
    fixtures,
    finance_source: `${FINANCE_SS}/Movimientos`,
    write_target_enforced: !!fixedTarget,
    local_queue_available: localQueue,
    apply_financiero_enabled: localQueue || canonicalReady, // escritor disponible (mock local o canónico)
    canonical_ready: canonicalReady,
    effective_write_target: effectiveTarget ? { spreadsheetId: effectiveTarget.spreadsheetId, sheet: effectiveTarget.sheet } : null,
    canonical_write_route_available: productionWriteEnabled() && !fixedTarget,
    catalogs: CATALOGS,
    sync: emptyRealState && [null, "unknown", ""].includes(st.syncState?.status)
      ? { status: "sin_sincronizacion", note: "Sin pendientes/cierres sincronizados desde Hermes todavía.", lastSyncAt: null, pendingSyncCount: 0 }
      : (st.syncState || {}),
    counts: { pendings:(st.pendings||[]).length, closures:Object.keys(st.closures||{}).length, proposals:(st.corrections?.proposals||[]).length, audits:(st.audits||[]).length },
    notes
  };
}

async function runTestProbe(store, { namespace, action, payload } = {}) {
  // Isolated validation probe (preprod/test only, secret-protected). Fixed TEST target enforced; never canonical.
  const allowedNs = /^cgtest_[a-zA-Z0-9_-]{4,40}$/;
  if (!allowedNs.test(String(namespace || ""))) return { ok:false, status:400, error:"invalid_namespace" };
  const fsStore = store;
  const dbId = fsStore.databaseId || process.env.CONTROL_GASTOS_FIRESTORE_DATABASE || "(default)";
  const prefix = process.env.CONTROL_GASTOS_FIRESTORE_PREFIX || "control_gastos";
  const base = { ok:true, namespace, dbId, prefix, storeType: String(process.env.CONTROL_GASTOS_STORE||"memory"), production_write_enabled: productionWriteEnabled() };
  try {
    if (action === "info") {
      const fixedTarget = getWriteTarget();
      return { ...base, project: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || null, fixed_target: fixedTarget, target_enforced: String(process.env.CONTROL_GASTOS_TEST_TARGET_ENFORCED||"0") === "1" || String(process.env.CONTROL_GASTOS_TEST_TARGET_ENFORCED||"").toLowerCase()==="true", writer_configured: !!getControlledWriter() };
    }
    if (action === "write_read_delete") {
      const docId = `${namespace}_doc`;
      if (typeof fsStore.doc !== "function" || typeof fsStore.col !== "function") {
        return { ...base, skipped: true, reason: "not_firestore_store_instance" };
      }
      const ref = fsStore.doc("probetest", docId);
      const data = { namespace, at: nowIso(), marker: "cg_test_probe", n: 1 };
      await ref.set({ ...data }, { merge: true });
      const got = (await ref.get()).data();
      const idemKeyNs = `${namespace}:idem`;
      const iref = fsStore.doc("idempotency", idemKeyNs);
      const existed = await iref.get();
      if (!existed.exists) await iref.set({ namespace, key: idemKeyNs, at: nowIso() }, { merge: false });
      const existed2 = await iref.get();
      await ref.delete();
      await iref.delete();
      return { ...base, write: true, readBack: got && got.namespace === namespace, idempotencyCreateOnce: existed2.exists === true, cleaned: true, collection: `${prefix}_probetest`, docId };
    }
    if (action === "deny_other_db") {
      let admin, getFirestoreFn;
      try { admin = require("firebase-admin"); } catch { return { ...base, skipped:true, reason:"no_firebase_admin" }; }
      try { ({ getFirestore: getFirestoreFn } = require("firebase-admin/firestore")); } catch { getFirestoreFn = null; }
      const targetDb = String(payload?.db || "(default)");
      try {
        const db2 = getFirestoreFn ? getFirestoreFn(admin.app(), targetDb) : null;
        if (!db2) return { ...base, skipped:true, reason:"no_named_db_api" };
        const ref = db2.collection(`${prefix}_probetest`).doc(`${namespace}_deny`);
        await ref.set({ namespace, at: nowIso() }, { merge: true });
        try { await ref.delete(); } catch {}
        return { ...base, denied:false, targetDb, note:"unexpected_success" };
      } catch (e) {
        const msg = String(e && (e.message || e.code || e));
        const denied = /permission|denied|403|PERMISSION_DENIED/i.test(msg);
        return { ...base, denied, targetDb, error: denied ? "PERMISSION_DENIED" : msg };
      }
    }

    // --- Sheets TEST operations (fixed/enforced target only, never canonical) ---
    if (String(action||"").startsWith("sheets_")) {
      const writer = getControlledWriter();
      const target = getWriteTarget();
      const guard = assertTargetAllowed(target, {});
      if (!writer) return { ...base, ok:false, status:400, error:"writer_not_configured", target };
      if (!guard.ok) return { ...base, ok:false, status:guard.status||403, error:guard.error, message:guard.message, target };
      if (isProdTarget(target)) return { ...base, ok:false, status:403, error:"canonical_target_blocked", target };

      if (action === "sheets_info") {
        const ex = await writer.readExisting(target);
        const header = ex.header ? ex.header.cells : [];
        const MOV_COLS = require("./validation").MOVIMIENTOS_COLUMNS;
        const matches = header.length === MOV_COLS.length && MOV_COLS.every((c,i)=>norm(header[i])===norm(c));
        return { ...base, target, header, headerCols: header.length, expectedCols: MOV_COLS.length, headerMatches: matches, dataRowCount: ex.dataRows.length };
      }

      if (action === "sheets_append") {
        const fo = `CGTEST:${namespace}:append:${(payload&&payload.n)||1}`;
        const row = buildMovimientoRow({ fecha_real:"2026-11-16", concepto:`${namespace} prueba`, descripcion:`${namespace} prueba`, importe:1234, moneda:"COP", titular:"Edu", categoria:"Supermercado", cuenta:"Efectivo/Débito", medio_pago:"Efectivo", mes_pago:"nov-2026", notas:"cgtest" }, { fila_origen: fo, fuente:"TEST preprod Cloud Run", estado:"Registrado", amounts: recalcAmounts("COP",1234), observaciones_extra:"cgtest preprod" });
        const r = await writer.appendMovimientos({ target, rows:[row], dedupeByFilaOrigen:true });
        let readback = null;
        try { const ex = await writer.readExisting(target); const found = ex.dataRows.find(rr=>norm(rr.cells[20])===fo); readback = found ? { rowNum: found.rowNum, id: found.cells[0], fila_origen: found.cells[20], importe: found.cells[11], concepto: found.cells[9] } : null; } catch(e){ readback = { error: String(e&&e.message||e) }; }
        return { ...base, target, fila_origen: fo, append: r, readback };
      }

      if (action === "sheets_dedupe") {
        const fo = `CGTEST:${namespace}:dedupe`;
        const row = buildMovimientoRow({ fecha_real:"2026-11-16", concepto:`${namespace} dedupe`, importe:2000, moneda:"COP", titular:"Edu", categoria:"Supermercado", cuenta:"Efectivo/Débito", medio_pago:"Efectivo", mes_pago:"nov-2026" }, { fila_origen: fo, fuente:"TEST preprod", estado:"Registrado", amounts: recalcAmounts("COP",2000) });
        const r1 = await writer.appendMovimientos({ target, rows:[row], dedupeByFilaOrigen:true });
        const r2 = await writer.appendMovimientos({ target, rows:[row], dedupeByFilaOrigen:true });
        const ex = await writer.readExisting(target);
        const count = ex.dataRows.filter(rr=>norm(rr.cells[20])===fo).length;
        const pass = r1.appended>=1 && r2.appended===0 && count===1;
        return { ...base, target, fila_origen: fo, first: r1, second: r2, sheetCount: count, pass };
      }

      if (action === "sheets_correct") {
        const fo = `CGTEST:${namespace}:corr`;
        const row = buildMovimientoRow({ fecha_real:"2026-11-16", concepto:`${namespace} antes`, descripcion:`${namespace} antes`, importe:3000, moneda:"COP", titular:"Edu", categoria:"Supermercado", cuenta:"Efectivo/Débito", medio_pago:"Efectivo", mes_pago:"nov-2026" }, { fila_origen: fo, fuente:"TEST preprod", estado:"Registrado", amounts: recalcAmounts("COP",3000) });
        const ins = await writer.appendMovimientos({ target, rows:[row], dedupeByFilaOrigen:true });
        if(!ins.ok) return { ...base, ok:false, error:"insert_failed", ins, target };
        const ex = await writer.readExisting(target);
        let found = null;
        for (const rr of ex.dataRows){ if (norm(rr.cells[20])===fo){ found = { rowNum: rr.rowNum, cells: rr.cells.slice() }; break; } }
        if(!found) return { ...base, ok:false, error:"row_not_found_after_insert", ins, target };
        const corr = await writer.applyCorrectionWrite({ target, rowNum: found.rowNum, changes: { concepto: `${namespace} corregido`, categoria: "Supermercado" }, before: { ID: found.cells[0], "Fila origen": fo } });
        return { ...base, target, fila_origen: fo, inserted: { ok: ins.ok, appended: ins.appended, insertedIds: ins.insertedIds }, rowNum: found.rowNum, correction: corr, pass: !!(corr.ok && corr.readback && corr.readback.verified && corr.backup) };
      }

      if (action === "sheets_recovery") {
        // simulate ambiguity/retry: first append, second append same Fila origen must not duplicate (reconciliation/dedupe/idempotency path)
        const fo = `CGTEST:${namespace}:recovery`;
        const row = buildMovimientoRow({ fecha_real:"2026-11-16", concepto:`${namespace} recovery`, importe:4444, moneda:"COP", titular:"Edu", categoria:"Supermercado", cuenta:"Efectivo/Débito", medio_pago:"Efectivo", mes_pago:"nov-2026" }, { fila_origen: fo, fuente:"TEST preprod", estado:"Registrado", amounts: recalcAmounts("COP",4444) });
        const r1 = await writer.appendMovimientos({ target, rows:[row], dedupeByFilaOrigen:true });
        // simulate client retry/ambiguous outcome by calling again
        const r2 = await writer.appendMovimientos({ target, rows:[row], dedupeByFilaOrigen:true });
        const ex = await writer.readExisting(target);
        const matches = ex.dataRows.filter(rr=>norm(rr.cells[20])===fo);
        return { ...base, target, fila_origen: fo, first: r1, retry: r2, sheetCount: matches.length, ids: matches.map(m=>m.cells[0]), pass: matches.length===1 };
      }

      if (action === "sheets_cleanup") {
        return { ...base, ok:false, status:503, error:"serialized_writer_not_ready" };
        /* Disabled: direct Sheets writes bypass destination serialization.
        // Best-effort cleanup: blank rows whose Fila origen starts with CGTEST:<namespace>:
        const ex = await writer.readExisting(target);
        const toClean = ex.dataRows.filter(rr=>String(rr.cells[20]||"").startsWith(`CGTEST:${namespace}:`));
        const results = [];
        for (const rr of toClean) {
          const MOV_COLS = require("./validation").MOVIMIENTOS_COLUMNS;
          const endCol = "AA";
          const range = `${target.sheet}!A${rr.rowNum}:${endCol}${rr.rowNum}`;
          try {
            await writer.sheetsClient.values.update({ spreadsheetId: target.spreadsheetId, range, valueInputOption:"RAW", values:[new Array(MOV_COLS.length).fill("")] });
            results.push({ rowNum: rr.rowNum, cleared:true });
          } catch(e){ results.push({ rowNum: rr.rowNum, cleared:false, error:String(e&&e.message||e) }); }
        }
        // release reservation/idempotency keys for this namespace's fila_origens
        if (typeof store.releaseIdempotencyKey === "function") {
          for (const rr of toClean) {
            const fo = String(rr.cells[20]||"");
            const k = idemKey(["apply", target.spreadsheetId, target.sheet, fo]);
            try { await store.releaseIdempotencyKey(k); } catch(_) {}
          }
        }
        return { ...base, target, cleanedCount: results.filter(r=>r.cleared).length, results };
        */
      }

      return { ...base, ok:false, status:400, error:"unknown_sheets_action" };
    }

    return { ok:false, status:400, error:"unknown_action" };
  } catch (e) {
    const msg = String(e && (e.message || e.code || e));
    const stack = String(e && e.stack || "").slice(0,1200);
    const denied = /permission|denied|403|PERMISSION_DENIED/i.test(msg);
    return { ...base, ok:false, denied, error: msg, stack };
  }
}

module.exports = {
  listPendings, getPending, previewPendingResolution, applyPendingResolution,
  listClosures, markClosureReviewed, refreshClosure,
  listCorrections, proposeCorrection, applyCorrection, enqueueCorrection,
  ingestSync, getStatus, runTestProbe, isWriteAuthorized, CATALOGS, FINANCE_SS,
  configureControlledWrites, getWriteTarget, productionWriteEnabled, buildMovimientoRow, MovimientosWriter, enqueuePendingResolution,
  fixturesEnabled, buildInitialSyncPayload, savePendingReview, splitPending
};
