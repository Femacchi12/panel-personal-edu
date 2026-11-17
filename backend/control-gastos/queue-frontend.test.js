"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

test("frontend distinguishes pending from verified committed", () => {
  const dom=new JSDOM('<div class="nav-item active" data-view="control-gastos"></div><div id="viewRoot"></div>',{runScripts:"outside-only"});
  const w=dom.window;
  w.eval(fs.readFileSync(path.join(__dirname,"../../control-gastos-controller.js"),"utf8"));
  const state=w.__CONTROL_GASTOS__.state;
  Object.assign(state,{loaded:true,tab:"pendientes",selectedPendingId:"cgtest_ui",status:{},catalogs:{},
    pendings:[{id:"cgtest_ui",datos_interpretados:{},motivo_ambiguedad:[]}],
    operation:{operationId:"synthetic-operation",status:"PENDING"}});
  w.document.dispatchEvent(new w.CustomEvent("panel:view-root-changed",{detail:{view:"control-gastos"}}));
  let text=w.document.getElementById("viewRoot").textContent;
  assert.match(text,/Pendiente de procesamiento/);
  assert.doesNotMatch(text,/Registrado correctamente/);
  assert.equal(w.document.querySelector('[data-cg-action="apply-pending"]').disabled, true);
  state.operation.status="COMMITTED";
  w.document.dispatchEvent(new w.CustomEvent("panel:view-root-changed",{detail:{view:"control-gastos"}}));
  text=w.document.getElementById("viewRoot").textContent;
  assert.match(text,/Registrado correctamente \(verificado\)/);
  dom.window.close();
});

test("frontend shows UNCERTAIN, reason and blocked destination without claiming success", () => {
  const dom=new JSDOM('<div class="nav-item active" data-view="control-gastos"></div><div id="viewRoot"></div>',{runScripts:"outside-only"});
  const w=dom.window;
  w.eval(fs.readFileSync(path.join(__dirname,"../../control-gastos-controller.js"),"utf8"));
  const state=w.__CONTROL_GASTOS__.state;
  Object.assign(state,{loaded:true,tab:"pendientes",selectedPendingId:"cgtest_ui",status:{},catalogs:{},
    pendings:[{id:"cgtest_ui",datos_interpretados:{},motivo_ambiguedad:[]}],
    operation:{operationId:"synthetic-uncertain",status:"UNCERTAIN",reason:"partial_split",destinationBlocked:true}});
  w.document.dispatchEvent(new w.CustomEvent("panel:view-root-changed",{detail:{view:"control-gastos"}}));
  const text=w.document.getElementById("viewRoot").textContent;
  assert.match(text,/Resultado incierto, requiere revisión/);
  assert.match(text,/Compra dividida aplicada parcialmente/);
  assert.match(text,/Destino bloqueado hasta revisión manual/);
  assert.doesNotMatch(text,/Registrado correctamente/);
  assert.equal(w.document.querySelector('[data-cg-action="apply-pending"]').disabled, true);
  dom.window.close();
});

test("frontend shows correction operations and needs-information state", () => {
  const dom=new JSDOM('<div class="nav-item active" data-view="control-gastos"></div><div id="viewRoot"></div>',{runScripts:"outside-only"});
  const w=dom.window;
  w.eval(fs.readFileSync(path.join(__dirname,"../../control-gastos-controller.js"),"utf8"));
  const state=w.__CONTROL_GASTOS__.state;
  Object.assign(state,{loaded:true,tab:"historial",status:{},catalogs:{},
    corrections:{proposals:[{id:"prop-ui",status:"en_cola",payload:{row_num:2,mov_id:"MOV-00001",changes:{comercio:"x"}},operation_id:"synthetic-correction"}],applied:[]},
    correctionOperation:{operationId:"synthetic-correction",status:"NEEDS_INFORMATION",type:"correction",reason:"correction_mismatch"}});
  w.document.dispatchEvent(new w.CustomEvent("panel:view-root-changed",{detail:{view:"control-gastos"}}));
  const text=w.document.getElementById("viewRoot").textContent;
  assert.match(text,/Operación de corrección synthetic-correction/);
  assert.match(text,/Requiere información/);
  assert.match(text,/La fila cambió desde la propuesta/);
  assert.doesNotMatch(text,/Registrado correctamente/);
  dom.window.close();
});
