"use strict";
// Conciliación de cierres en lectura: los pendientes ya registrados/descartados
// salen del conteo del cierre y los movimientos verificados se suman sin duplicar.
const { test } = require("node:test");
const assert = require("node:assert");
const svc = require("./service.js");

function fakeStore({ pendings, closures }) {
  return {
    async getState(){ return { pendings, closures: closures || {}, corrections: {}, audits: [] }; },
    async saveState(){},
    async getClosures(){ return closures || {}; },
    async getReviews(){ return {}; },
    async getPendings(){ return pendings; },
    async getSyncState(){ return { status: "sincronizado" }; },
    async addAudit(){ return { id: "a1" }; }
  };
}

test("cierre con pendiente ya registrado: sale del conteo y suma su MOV verificado", async () => {
  const pend = {
    id: "3f9a121f-0af", message_key: "chat:AC403B03",
    estado_sincronizacion: "registrado",
    registro: { movId: "MOV-01288", movIds: ["MOV-01288"], verified: true },
    datos_interpretados: { concepto: "OpenCode US credit", fecha_real: "2026-11-17", importe: 10, moneda: null, monto_cop: null, titular: "Edu", cuenta_tarjeta: "ARQ Edu", categoria: "Capacitación/Estudio" }
  };
  const closure = {
    fecha: "2026-11-17",
    totales: { cantidad_movimientos_gasto: 0, total_cop: 0, gastos_registrados_cop: 0, cantidad_pendientes: 1, pendientes_cop_estimado: 0, total_potencial_cop: 0 },
    resumen_gastos: [],
    pendientes_validacion: [ { id: "3f9a121f-0af", origen: "chat:AC403B03", concepto: "OpenCode US credit", importe: 10, moneda: null, monto_cop_estimado: null } ],
    subtotales: {}
  };
  const res = await svc.listClosures(fakeStore({ pendings: [pend], closures: { "2026-11-17": closure } }), { date: "2026-11-17" });
  const c = res.items[0].closure;
  assert.equal(c.pendientes_validacion.length, 0, "pendiente registrado ya no aparece");
  assert.equal(c._reconciliado_en_lectura, true);
  assert.equal(c.totales.cantidad_pendientes, 0);
  assert.equal(c.totales.cantidad_movimientos_gasto, 1, "suma el MOV verificado");
  assert.ok(c.pendientes_reconciliados[0].mov_ids.includes("MOV-01288"));
  // monto COP desconocido (moneda null) NO se inventa: no suma al total
  assert.equal(c.totales.gastos_registrados_cop, 0);
  // pero sí aparece en el resumen con monto null (honesto)
  assert.equal(c.resumen_gastos.length, 1);
  assert.equal(c.resumen_gastos[0].id, "MOV-01288");
});

test("cierre con pendiente registrado con monto COP conocido: suma total sin duplicar", async () => {
  const pend = {
    id: "7fd6e494-4fd", message_key: "chat:ACC6B0C7",
    estado_sincronizacion: "registrado",
    registro: { movId: "MOV-01291", movIds: ["MOV-01291"], verified: true },
    datos_interpretados: { concepto: "Chori parqueadero", fecha_real: "2026-11-14", importe: 8000, moneda: "COP", monto_cop: 8000, titular: "Edu", cuenta_tarjeta: "Nu Edu" }
  };
  const closure = {
    fecha: "2026-11-14",
    totales: { cantidad_movimientos_gasto: 1, total_cop: 32700, gastos_registrados_cop: 32700, cantidad_pendientes: 1, pendientes_cop_estimado: 8000, total_potencial_cop: 40700 },
    resumen_gastos: [ { id: "MOV-01286", comercio: "D", monto_cop: 32700, titular: "Común", categoria: "Supermercado", cuenta: "Efectivo", medio_pago: "Efectivo" } ],
    pendientes_validacion: [ { id: "7fd6e494-4fd", origen: "chat:ACC6B0C7", concepto: "Chori parqueadero", importe: 8000, moneda: "COP", monto_cop_estimado: 8000 } ],
    subtotales: { por_titular_cop: { "Común": 32700 } }
  };
  const res = await svc.listClosures(fakeStore({ pendings: [pend], closures: { "2026-11-14": closure } }), { date: "2026-11-14" });
  const c = res.items[0].closure;
  assert.equal(c.pendientes_validacion.length, 0);
  assert.equal(c.totales.gastos_registrados_cop, 40700, "32700 + 8000");
  assert.equal(c.totales.cantidad_movimientos_gasto, 2);
  assert.equal(c.totales.pendientes_cop_estimado, 0);
  assert.equal(c.totales.total_potencial_cop, 40700);
  assert.equal(c.resumen_gastos.length, 2, "MOV-01291 anexado");
  assert.ok(c.resumen_gastos.some(r=>r.id==="MOV-01291" && r.fila_origen==="chat:ACC6B0C7"));
  // subtotales recalculados
  assert.equal(c.subtotales.por_titular_cop["Edu"], 8000);
});

test("cierre ya conciliado (MOV ya en resumen): sin duplicados ni doble conteo", async () => {
  const pend = {
    id: "x1", message_key: "chat:K1",
    estado_sincronizacion: "registrado",
    registro: { movId: "MOV-01299", movIds: ["MOV-01299"], verified: true },
    datos_interpretados: { concepto: "G", fecha_real: "2026-11-15", importe: 5000, moneda: "COP", monto_cop: 5000 }
  };
  const closure = {
    fecha: "2026-11-15",
    totales: { cantidad_movimientos_gasto: 1, total_cop: 5000, gastos_registrados_cop: 5000, cantidad_pendientes: 0, pendientes_cop_estimado: 0 },
    // el snapshot ya fue regenerado post-registro: ya contiene el MOV
    resumen_gastos: [ { id: "MOV-01299", fila_origen: "chat:K1", comercio: "G", monto_cop: 5000 } ],
    pendientes_validacion: [],
    subtotales: {}
  };
  const res = await svc.listClosures(fakeStore({ pendings: [pend], closures: { "2026-11-15": closure } }), { date: "2026-11-15" });
  const c = res.items[0].closure;
  assert.equal(c._reconciliado_en_lectura, undefined, "sin cambios si no hay pendientes en el snapshot");
  assert.equal(c.resumen_gastos.length, 1, "no duplica");
  assert.equal(c.totales.cantidad_movimientos_gasto, 1);
});

test("pendiente sin registro (conciliación manual) sale del conteo sin sumar montos inventados", async () => {
  const pend = {
    id: "x2", message_key: "chat:K2",
    estado_sincronizacion: "registrado",
    registro: null,
    datos_interpretados: { concepto: "Regalo cumple papa", fecha_real: "2026-11-16", importe: 76100, moneda: "ARS", monto_cop: 159810 }
  };
  const closure = {
    fecha: "2026-11-16",
    totales: { cantidad_movimientos_gasto: 0, total_cop: 0, gastos_registrados_cop: 0, cantidad_pendientes: 1, pendientes_cop_estimado: 159810, total_potencial_cop: 159810 },
    resumen_gastos: [],
    pendientes_validacion: [ { id: "x2", origen: "chat:K2", concepto: "Regalo cumple papa", importe: 76100, moneda: "ARS", monto_cop_estimado: 159810 } ],
    subtotales: {}
  };
  const res = await svc.listClosures(fakeStore({ pendings: [pend], closures: { "2026-11-16": closure } }), { date: "2026-11-16" });
  const c = res.items[0].closure;
  assert.equal(c.pendientes_validacion.length, 0, "ya no cuenta como pendiente");
  assert.equal(c.totales.cantidad_pendientes, 0);
  assert.equal(c.totales.gastos_registrados_cop, 0, "sin registro verificado no se suma (no inventar)");
  assert.equal(c.pendientes_reconciliados[0].resultado, "registrado_conciliacion_manual");
});
