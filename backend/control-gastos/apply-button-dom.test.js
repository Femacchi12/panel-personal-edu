"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

// El botón Aplicar debe SIEMPRE dar feedback visible: nunca fallar en silencio.
// Regresión del defecto real: el handler hacía referencia a una variable fuera
// de alcance (applyReady) y el clic moría sin confirmación ni error.
function setup(applyEnabled) {
  const dom = new JSDOM('<div class="nav-item active" data-view="control-gastos"></div><div id="viewRoot"></div>', { runScripts: "outside-only" });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, "../../control-gastos-controller.js"), "utf8"));
  const alerts = [];
  w.alert = msg => alerts.push(String(msg));
  w.confirm = msg => { alerts.push(String(msg)); return true; };
  w.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const state = w.__CONTROL_GASTOS__.state;
  state.loaded = true; state.tab = "pendientes";
  state.status = { apply_financiero_enabled: applyEnabled, catalogs: {
    titulares: ["Edu"], categorias: ["Supermercado"], subcategorias_por_categoria: { Supermercado: ["Otros"] },
    cuentas: ["Efectivo"], medios_pago: ["Efectivo"], modalidades_por_cuenta: { Efectivo: ["Efectivo"] },
    monedas: ["COP", "ARS", "USD"], meses_pago: ["nov-2026"]
  }, sync: {} };
  state.catalogs = state.status.catalogs;
  state.pendings = [{ id: "p1", message_key: "MK:1", datos_interpretados: { concepto: "Gasto X", importe: 1000, moneda: "COP", fecha_real: "2026-11-17" }, motivo_ambiguedad: [] }];
  state.selectedPendingId = "p1";
  w.document.dispatchEvent(new w.CustomEvent("panel:view-root-changed", { detail: { view: "control-gastos" } }));
  return { w, state, alerts };
}

test("sin escritor: botón deshabilitado + banner visible (nunca silencio)", () => {
  const { w, alerts } = setup(false);
  const btn = w.document.querySelector('[data-cg-action="apply-pending"]');
  assert.equal(btn.disabled, true, "botón deshabilitado sin escritor");
  const text = w.document.getElementById("viewRoot").textContent || "";
  assert.ok(text.includes("Aplicar financiero: deshabilitado"), "banner de modo seguro visible");
  btn.click({ preventDefault() {} });
  assert.ok(alerts.length === 0 || !alerts.some(a => a.includes("Confirmar registro")), "sin confirmación de registro real");
});

function fillForm(w) {
  // El formulario real toma sus valores de state.form (initFormFromPending +
  // edición del usuario). Simular eso: poblar state.form y re-renderizar.
  const state = w.__CONTROL_GASTOS__.state;
  Object.assign(state.form, {
    fecha_real: "2026-11-17", concepto: "Gasto X", comercio: "Gasto X",
    descripcion: "origen", importe: "1000", moneda: "COP", titular: "Edu",
    categoria: "Supermercado", subcategoria: "Otros", cuenta: "Efectivo",
    medio_pago: "Efectivo", resolucion: "es_nuevo"
  });
  w.document.dispatchEvent(new w.CustomEvent("panel:view-root-changed", { detail: { view: "control-gastos" } }));
}

test("con escritor: click sin previsualización → botón deshabilitado con explicación", () => {
  const { w, alerts } = setup(true);
  fillForm(w);
  const btn = w.document.querySelector('[data-cg-action="apply-pending"]');
  assert.equal(btn.disabled, true, "sin preview el botón se deshabilita");
  const text = w.document.getElementById("viewRoot").textContent || "";
  assert.ok(text.includes("Aplica solo con validación OK y confirmación"), "explicación visible junto al botón");
  btn.click({ preventDefault() {} });
  assert.equal(alerts.some(a => a.includes("Confirmar registro en FINANZAS EDU")), false, "sin confirmación de escritura real");
});

test("con escritor y preview válida: el confirm aparece (flujo real alcanzable)", () => {
  const { w, alerts } = setup(true);
  fillForm(w);
  const state = w.__CONTROL_GASTOS__.state;
  state.preview = { canApply: true, operacion_propuesta: "registrar_nuevo", comparison: { diff: { importe: { antes: 1000, despues: 1000 } } }, validation: { ok: true, errors: [] } };
  w.document.dispatchEvent(new w.CustomEvent("panel:view-root-changed", { detail: { view: "control-gastos" } }));
  const btn = w.document.querySelector('[data-cg-action="apply-pending"]');
  assert.equal(btn.disabled, false, "botón habilitado con preview válida");
  btn.click({ preventDefault() {} });
  assert.ok(alerts.some(a => a.includes("Confirmar registro en FINANZAS EDU")), "el confirm del flujo real aparece");
});

test("con escritor y API caída: error visible (nunca silencio)", async () => {
  const { w, alerts } = setup(true);
  fillForm(w);
  const state = w.__CONTROL_GASTOS__.state;
  state.preview = { canApply: true, operacion_propuesta: "registrar_nuevo", comparison: { diff: {} }, validation: { ok: true, errors: [] } };
  w.document.dispatchEvent(new w.CustomEvent("panel:view-root-changed", { detail: { view: "control-gastos" } }));
  w.document.querySelector('[data-cg-action="apply-pending"]').click();
  await new Promise(r => setTimeout(r, 80));
  assert.ok(alerts.some(a => a.includes("No se pudo aplicar")), "alerta de error de API");
  const notice = w.document.querySelector(".cg-notice.err");
  assert.ok(notice, "aviso de error en la ficha");
});
