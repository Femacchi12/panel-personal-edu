"use strict";

const CATALOGS = {
  categorias: [
    "Arriendo", "Servicios", "Supermercado", "Salud", "Pia", "Odontología", "Viajes", "Inversión",
    "Comidas/Cenas", "Movilidad", "Apartamento", "Plataformas", "Otros", "Regalos", "Actividades",
    "Entretenimiento", "Financiero", "Capacitación/Estudio", "Ropa"
  ],
  subcategorias_por_categoria: {
    "Supermercado": ["Carnicería / proteína", "Agua", "Verduras", "Aseo", "Otros"],
    "Salud": ["Farmacia", "Cita médica", "Copago", "Plan premium / EPS", "Exámenes"],
    "Pia": ["Fisioterapia", "Accesorios", "Alimento", "Veterinaria", "Medicamentos"],
    "Movilidad": ["Moto", "Combustible", "Mantenimiento vehículo", "Parqueadero", "Uber/Taxi"],
    "Comidas/Cenas": ["Restaurante", "Domicilio", "Cafetería"],
    "Apartamento": ["Tender", "Aseo", "Mantenimiento", "Muebles"],
    "Plataformas": ["Streaming", "Software", "Servicios digitales"],
    "Ropa": ["Calzado", "Vestuario"],
    "Actividades": ["Fútbol", "Deporte", "Ocio"],
    "Odontología": ["Consulta", "Ortodoncia", "Procedimiento"]
  },
  titulares: ["Edu", "Rocío", "Pía", "Común"],
  cuentas: ["Nu Edu", "Nu Ro", "Nequi Edu", "Nequi Ro", "Efectivo", "ARQ Edu", "Mercado Pago Edu Argentina", "Efectivo/Débito"],
  medios_pago: ["Crédito", "Débito", "Transferencia", "Efectivo"],
  modalidades_por_cuenta: {
    "Nu Edu": ["Crédito", "Débito", "Transferencia"],
    "Nu Ro": ["Crédito", "Débito", "Transferencia"],
    "Nequi Edu": ["Transferencia"],
    "Nequi Ro": ["Transferencia"],
    "Efectivo": ["Efectivo"],
    "Efectivo/Débito": ["Efectivo", "Débito"],
    "ARQ Edu": ["Crédito", "Débito", "Transferencia"],
    "Mercado Pago Edu Argentina": ["Crédito", "Débito", "Transferencia"]
  },
  monedas: ["COP", "ARS", "USD"],
  meses_pago: (() => {
    const ab = {1:"ene",2:"feb",3:"mar",4:"abr",5:"may",6:"jun",7:"jul",8:"ago",9:"sep",10:"oct",11:"nov",12:"dic"};
    const now = new Date(); const out=[];
    for (let d=-3; d<=10; d++) { const dt=new Date(now.getFullYear(), now.getMonth()+d, 1); out.push(`${ab[dt.getMonth()+1]}-${dt.getFullYear()}`); }
    return out;
  })()
};

const MOVIMIENTOS_COLUMNS = [
  "ID","Fecha registrada","Fecha real","Mes consumo","Mes pago","Tipo","Naturaleza","Categoría","Subcategoría",
  "Descripción / Comercio","Descripción original","Monto original","Moneda original","Cuenta / Tarjeta","Titular",
  "Cuotas","N° cuota","Es fijo","Estado","Fuente","Fila origen","Observaciones","Monto COP","Monto ARS","Monto USD",
  "Modalidad de pago","Ámbito"
];

const EDITABLE_FIELDS = ["fecha_real","comercio","descripcion","importe","moneda","categoria","subcategoria","titular","cuenta","medio_pago","mes_pago"];

function norm(v){ return v==null ? "" : String(v).trim(); }
function isValidCategory(cat){ return !cat || CATALOGS.categorias.includes(norm(cat)); }
function isValidSubcategory(cat, sub){
  if(!sub) return true;
  const list = CATALOGS.subcategorias_por_categoria[norm(cat)] || [];
  return list.length ? list.includes(norm(sub)) : true; // allow if category has no constrained list
}
function modalitiesFor(cuenta){ return CATALOGS.modalidades_por_cuenta[norm(cuenta)] || CATALOGS.medios_pago; }

const TITULAR_COMUN = "Común";
const isCashPayment = input => norm(input.cuenta) === "Efectivo" || norm(input.medio_pago) === "Efectivo";

function validatePendingResolution(input){
  // REGLA DEFINITIVA (2026-11-18): en pagos en EFECTIVO no se exige identificar
  // si el dinero corresponde a Edu o Rocío; se registra titular "Común".
  // Para tarjetas/cuentas identificadas el titular sigue siendo obligatorio.
  if (isCashPayment(input) && !norm(input.titular)) input.titular = TITULAR_COMUN;
  const errors = []; const warnings = [];
  const required = ["fecha_real","concepto","importe","moneda","titular","categoria","cuenta","medio_pago"];
  for (const f of required) { if (!norm(input[f])) errors.push(`Falta campo obligatorio: ${f}`); }
  if (norm(input.titular) && !CATALOGS.titulares.includes(norm(input.titular))) errors.push("Titular no válido (debe ser Edu, Rocío, Pía o Común)");
  if (!isValidCategory(input.categoria)) errors.push("Categoría no oficial");
  if (!isValidSubcategory(input.categoria, input.subcategoria)) warnings.push("Subcategoría no corresponde a la categoría seleccionada (verificar Manual/Matriz)");
  if (norm(input.cuenta) && !CATALOGS.cuentas.includes(norm(input.cuenta))) warnings.push("Cuenta/tarjeta no está en catálogo conocido (verificar)");
  const mods = modalitiesFor(input.cuenta);
  if (norm(input.medio_pago) && mods.length && !mods.includes(norm(input.medio_pago))) errors.push("Modalidad de pago incompatible con la cuenta seleccionada");
  const amt = Number(input.importe);
  if (!(amt > 0)) errors.push("Importe debe ser mayor a 0");
  if (norm(input.moneda) && !CATALOGS.monedas.includes(norm(input.moneda).toUpperCase())) errors.push("Moneda no válida");
  return { ok: errors.length === 0, errors, warnings };
}

function validateCorrection(changes, before){
  const errors = []; const warnings = [];
  if (!changes || typeof changes !== "object" || !Object.keys(changes).length) errors.push("No hay cambios para aplicar");
  for (const k of Object.keys(changes||{})) { if (!EDITABLE_FIELDS.includes(k)) errors.push(`Campo no editable: ${k}`); }
  if ("titular" in changes && norm(changes.titular) && !CATALOGS.titulares.includes(norm(changes.titular))) errors.push("Titular no válido");
  if ("categoria" in changes && !isValidCategory(changes.categoria)) errors.push("Categoría no oficial");
  const cat = ("categoria" in changes ? changes.categoria : before?.categoria);
  if ("subcategoria" in changes && !isValidSubcategory(cat, changes.subcategoria)) warnings.push("Subcategoría no corresponde a la categoría");
  const cuenta = ("cuenta" in changes ? changes.cuenta : before?.cuenta);
  const mods = modalitiesFor(cuenta);
  if ("medio_pago" in changes && norm(changes.medio_pago) && mods.length && !mods.includes(norm(changes.medio_pago))) errors.push("Modalidad incompatible con cuenta");
  if ("importe" in changes && !(Number(changes.importe) > 0)) errors.push("Importe debe ser mayor a 0");
  if ("moneda" in changes && norm(changes.moneda) && !CATALOGS.monedas.includes(norm(changes.moneda).toUpperCase())) errors.push("Moneda no válida");
  return { ok: errors.length === 0, errors, warnings };
}

function buildBeforeAfter(before, after){
  const fields = EDITABLE_FIELDS; const diff = {};
  for (const f of fields) { const b = before?.[f]; const a = after?.[f]; if (String(b??"") !== String(a??"")) diff[f] = { antes: b ?? "", despues: a ?? "" }; }
  return { fields, before, after, diff, hasChanges: Object.keys(diff).length > 0 };
}

module.exports = { CATALOGS, MOVIMIENTOS_COLUMNS, EDITABLE_FIELDS, validatePendingResolution, validateCorrection, buildBeforeAfter, modalitiesFor, norm };
