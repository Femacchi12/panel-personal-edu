"use strict";

// Test fixtures (isolated). Source shapes aligned with finanzas_pilot queue/closures/corrections.
// The 5 pending movements MUST keep original state (no changes applied). No writes to Finanzas Edu.

const FIVE_PENDING = [
  {
    id: "02722a5d-dc63-477b-9b55-42cf149899c8",
    created_at: "2026-11-14T08:24:48.925762-05:00",
    updated_at: "2026-11-14T08:24:48.925762-05:00",
    message_key: "120363422102546755@g.us:AC11A959BF60C55D1A75665DF00E9009",
    message_id: "AC11A959BF60C55D1A75665DF00E9009",
    chat_id: "120363422102546755@g.us",
    sender_name: "Eduardo Macchi",
    message_ts_iso: null,
    texto_relevante: "[owner reply] D1\n$32.700\nEfectivo",
    datos_interpretados: {
      concepto: "[owner reply] D", importe: 32700.0, moneda: "COP", moneda_fuente: "symbol:$",
      medio_pago_texto: "Efectivo/Débito", persona: null, tipo: "Gasto", naturaleza: "Gasto",
      categoria: null, subcategoria: null, es_fijo: null, fecha_real: "2026-11-14",
      mes_consumo: "2026-11", mes_pago: "2026-11", ambito: "Personal", modalidad_pago: null,
      cuenta_tarjeta: "Efectivo/Débito", titular: null, cuotas: null, n_cuota: null,
      confianza: 0.7, estado_validacion: "pendiente_revision",
      ambiguedades: ["No se identificó persona (Edu/Rocío/Pía)", "Categoría/subcategoría no determinada por reglas oficiales conocidas (requiere revisión)"],
      texto_original: "[owner reply] D1\n$32.700\nEfectivo", monto_cop: 32700.0, monto_ars: 15571.43, monto_usd: 10.38
    },
    fila_simulada: { ID: "SIM-WA-AC11A959BF60C55D1A75665DF00E9009", "Fecha real": "2026-11-14", "Mes consumo": "2026-11", "Mes pago": "2026-11", Tipo: "Gasto", Naturaleza: "Gasto", "Categoría": "", "Subcategoría": "", "Descripción / Comercio": "[owner reply] D", "Descripción original": "[owner reply] D1\n$32.700\nEfectivo", "Monto original": 32700.0, "Moneda original": "COP", "Cuenta / Tarjeta": "Efectivo/Débito", Titular: "", Cuotas: "", "N° cuota": "", "Es fijo": "", Estado: "Pendiente de revisión", Fuente: "WhatsApp/Hermes (piloto, simulado)", "Fila origen": "AC11A959BF60C55D1A75665DF00E9009", "Monto COP": 32700.0, "Monto ARS": 15571.43, "Monto USD": 10.38, "Modalidad de pago": "", "Ámbito": "Personal" },
    estado_validacion: "pendiente_revision",
    motivo_ambiguedad: ["No se identificó persona (Edu/Rocío/Pía)", "Categoría/subcategoría no determinada por reglas oficiales conocidas (requiere revisión)"],
    estado_sincronizacion: "simulado", sync_attempts: [], last_error: null, production_blocked: true
  },
  {
    id: "7fd6e494-4fd1-4cef-872d-6ff0111f6747",
    created_at: "2026-11-14T10:24:59.107478-05:00",
    updated_at: "2026-11-14T10:24:59.107478-05:00",
    message_key: "120363422102546755@g.us:ACC6B0C7D182051256704B2BC2C441FB",
    message_id: "ACC6B0C7D182051256704B2BC2C441FB",
    chat_id: "120363422102546755@g.us",
    sender_name: "Eduardo Macchi",
    texto_relevante: "[owner reply] Chori parqueadero \n$8.000\nTranferencia Nu Edu",
    datos_interpretados: {
      concepto: "[owner reply] Chori parqueadero Tranferencia", importe: 8000.0, moneda: "COP", moneda_fuente: "symbol:$",
      medio_pago_texto: "Nu Edu", persona: "Edu", tipo: "Gasto", naturaleza: "Gasto",
      categoria: null, subcategoria: null, es_fijo: null, fecha_real: "2026-11-14",
      mes_consumo: "2026-11", mes_pago: "2026-11", ambito: "Personal", modalidad_pago: null,
      cuenta_tarjeta: "Nu Edu", titular: "Edu", cuotas: null, n_cuota: null,
      confianza: 0.8, estado_validacion: "pendiente_revision",
      ambiguedades: ["Categoría/subcategoría no determinada por reglas oficiales conocidas (requiere revisión)"],
      texto_original: "[owner reply] Chori parqueadero \n$8.000\nTranferencia Nu Edu", monto_cop: 8000.0, monto_ars: 3809.52, monto_usd: 2.54
    },
    fila_simulada: { ID: "SIM-WA-ACC6B0C7D182051256704B2BC2C441FB", "Fecha real": "2026-11-14", "Mes consumo": "2026-11", "Mes pago": "2026-11", Tipo: "Gasto", Naturaleza: "Gasto", "Categoría": "", "Subcategoría": "", "Descripción / Comercio": "[owner reply] Chori parqueadero Tranferencia", "Descripción original": "[owner reply] Chori parqueadero \n$8.000\nTranferencia Nu Edu", "Monto original": 8000.0, "Moneda original": "COP", "Cuenta / Tarjeta": "Nu Edu", Titular: "Edu", Cuotas: "", "N° cuota": "", "Es fijo": "", Estado: "Pendiente de revisión", Fuente: "WhatsApp/Hermes (piloto, simulado)", "Fila origen": "ACC6B0C7D182051256704B2BC2C441FB", "Monto COP": 8000.0, "Monto ARS": 3809.52, "Monto USD": 2.54, "Modalidad de pago": "", "Ámbito": "Personal" },
    estado_validacion: "pendiente_revision",
    motivo_ambiguedad: ["Categoría/subcategoría no determinada por reglas oficiales conocidas (requiere revisión)"],
    estado_sincronizacion: "simulado", sync_attempts: [], last_error: null, production_blocked: true
  },
  {
    id: "84565b08-5dca-4fc1-a375-871e1a46c231",
    created_at: "2026-11-14T16:30:00-05:00",
    updated_at: "2026-11-14T16:30:00-05:00",
    message_key: "WAHIST:chat(3).txt:L55:2026-11-06T19:12:33:Puca Col",
    message_id: "WAHIST-L55",
    chat_id: "120363422102546755@g.us",
    sender_name: "Rocío",
    texto_relevante: "Saldo zapatillas Ro: $35.000 (transferencia Nu Ro)",
    datos_interpretados: {
      concepto: "Saldo zapatillas Ro", importe: 35000.0, moneda: "COP", medio_pago_texto: "Nu Ro transferencia",
      persona: "Rocío", tipo: "Gasto", naturaleza: "Gasto", categoria: "Ropa", subcategoria: "Calzado",
      es_fijo: "No", fecha_real: "2026-11-06", mes_consumo: "2026-11", mes_pago: "2026-11", ambito: "Personal",
      modalidad_pago: "Transferencia", cuenta_tarjeta: "Nu Ro", titular: "Rocío",
      monto_cop: 35000.0, monto_ars: 16666.67, monto_usd: 11.11, estado_validacion: "pendiente_revision",
      ambiguedades: ["Posible pago/saldo de compra previamente contabilizada (posible duplicado/parcial); requiere confirmación antes de registrar."],
      texto_original: "Saldo zapatillas Ro: $35.000 (transferencia Nu Ro)"
    },
    fila_simulada: { ID: "", "Fecha real": "2026-11-06", "Mes consumo": "2026-11", "Mes pago": "2026-11", Tipo: "Gasto", Naturaleza: "Gasto", "Categoría": "Ropa", "Subcategoría": "Calzado", "Descripción / Comercio": "Saldo zapatillas Ro", "Descripción original": "Saldo zapatillas Ro: $35.000 (transferencia Nu Ro)", "Monto original": 35000.0, "Moneda original": "COP", "Cuenta / Tarjeta": "Nu Ro", Titular: "Rocío", Cuotas: "", "N° cuota": "", "Es fijo": "No", Estado: "Pendiente de revisión", Fuente: "WhatsApp/Export histórico", "Fila origen": "WAHIST:chat(3).txt:L55:2026-11-06T19:12:33:Puca Col", "Monto COP": 35000.0, "Monto ARS": 16666.67, "Monto USD": 11.11, "Modalidad de pago": "Transferencia", "Ámbito": "Personal" },
    estado_validacion: "pendiente_revision",
    motivo_ambiguedad: ["Posible pago/saldo de compra previamente contabilizada (posible duplicado/parcial); requiere confirmación antes de registrar."],
    estado_sincronizacion: "pendiente_validacion", sync_attempts: [], last_error: null, production_blocked: true,
    campos_pendientes: [], notas_revision: "Confirmar si es pago/saldo de compra ya contabilizada (posible duplicado/parcial) o compra nueva; clasificación final."
  },
  {
    id: "498c3e73-eb84-4a56-9e28-9a0680cde831",
    created_at: "2026-11-14T16:30:00-05:00",
    updated_at: "2026-11-14T16:30:00-05:00",
    message_key: "WAHIST:chat(3).txt:L64:2026-11-08T10:49:47:Tú",
    message_id: "WAHIST-L64",
    chat_id: "120363422102546755@g.us",
    sender_name: "Eduardo",
    texto_relevante: "2 mojarras, 1kg Yuca, 1 Palta\n$28.000\nNu transferencia de",
    datos_interpretados: {
      concepto: "2 mojarras, 1kg yuca, 1 palta", importe: 28000.0, moneda: "COP", medio_pago_texto: "Nu transferencia",
      persona: null, tipo: "Gasto", naturaleza: "Gasto", categoria: "Supermercado", subcategoria: null,
      es_fijo: "No", fecha_real: "2026-11-08", mes_consumo: "2026-11", mes_pago: "2026-11", ambito: "Personal",
      modalidad_pago: "Transferencia", cuenta_tarjeta: null, titular: null,
      monto_cop: 28000.0, monto_ars: 13333.33, monto_usd: 8.89, estado_validacion: "pendiente_revision",
      ambiguedades: ["Titular y cuenta Nu específica no identificados (texto: 'Nu transferencia de')."],
      texto_original: "2 mojarras, 1kg Yuca, 1 Palta\n$28.000\nNu transferencia de"
    },
    fila_simulada: { ID: "", "Fecha real": "2026-11-08", "Mes consumo": "2026-11", "Mes pago": "2026-11", Tipo: "Gasto", Naturaleza: "Gasto", "Categoría": "Supermercado", "Subcategoría": "", "Descripción / Comercio": "2 mojarras, 1kg yuca, 1 palta", "Descripción original": "2 mojarras, 1kg Yuca, 1 Palta\n$28.000\nNu transferencia de", "Monto original": 28000.0, "Moneda original": "COP", "Cuenta / Tarjeta": "", Titular: "", Cuotas: "", "N° cuota": "", "Es fijo": "No", Estado: "Pendiente de revisión", Fuente: "WhatsApp/Export histórico", "Fila origen": "WAHIST:chat(3).txt:L64:2026-11-08T10:49:47:Tú", "Monto COP": 28000.0, "Monto ARS": 13333.33, "Monto USD": 8.89, "Modalidad de pago": "Transferencia", "Ámbito": "Personal" },
    estado_validacion: "pendiente_revision",
    motivo_ambiguedad: ["Titular y cuenta Nu específica no identificados (texto: 'Nu transferencia de')."],
    estado_sincronizacion: "pendiente_validacion", sync_attempts: [], last_error: null, production_blocked: true,
    campos_pendientes: ["titular", "cuenta_tarjeta"], notas_revision: "Confirmar titular y cuenta Nu específica (Edu/Rocío, Nu Edu/Nu Ro)."
  },
  {
    id: "d54ed2f6-83d4-4c1b-9f8d-9f0f0b1e5c21",
    created_at: "2026-11-14T16:30:00-05:00",
    updated_at: "2026-11-14T16:30:00-05:00",
    message_key: "WAHIST:chat(3).txt:L87:2026-11-12T13:16:06:Tú",
    message_id: "WAHIST-L87",
    chat_id: "120363422102546755@g.us",
    sender_name: "Eduardo",
    texto_relevante: "Revisión cubiertas del auto \n$9.000\nEfectivo",
    datos_interpretados: {
      concepto: "Revisión cubiertas del auto", importe: 9000.0, moneda: "COP", medio_pago_texto: "Efectivo",
      persona: "Edu", tipo: "Gasto", naturaleza: "Gasto", categoria: null, subcategoria: null,
      es_fijo: "No", fecha_real: "2026-11-12", mes_consumo: "2026-11", mes_pago: "2026-11", ambito: "Personal",
      modalidad_pago: "Efectivo", cuenta_tarjeta: "Efectivo", titular: "Edu",
      monto_cop: 9000.0, monto_ars: 4285.71, monto_usd: 2.86, estado_validacion: "pendiente_revision",
      ambiguedades: ["Categoría oficial a confirmar según Manual/Matriz."],
      texto_original: "Revisión cubiertas del auto \n$9.000\nEfectivo"
    },
    fila_simulada: { ID: "", "Fecha real": "2026-11-12", "Mes consumo": "2026-11", "Mes pago": "2026-11", Tipo: "Gasto", Naturaleza: "Gasto", "Categoría": "", "Subcategoría": "", "Descripción / Comercio": "Revisión cubiertas del auto", "Descripción original": "Revisión cubiertas del auto \n$9.000\nEfectivo", "Monto original": 9000.0, "Moneda original": "COP", "Cuenta / Tarjeta": "Efectivo", Titular: "Edu", Cuotas: "", "N° cuota": "", "Es fijo": "No", Estado: "Pendiente de revisión", Fuente: "WhatsApp/Export histórico", "Fila origen": "WAHIST:chat(3).txt:L87:2026-11-12T13:16:06:Tú", "Monto COP": 9000.0, "Monto ARS": 4285.71, "Monto USD": 2.86, "Modalidad de pago": "Efectivo", "Ámbito": "Personal" },
    estado_validacion: "pendiente_revision",
    motivo_ambiguedad: ["Categoría oficial a confirmar según Manual/Matriz."],
    estado_sincronizacion: "pendiente_validacion", sync_attempts: [], last_error: null, production_blocked: true,
    campos_pendientes: ["categoria"], notas_revision: "Categoría oficial según Manual/Matriz."
  }
];

const SEED_CLOSURES = {
  "2026-11-13": {
    fecha: "2026-11-13", generated_at: "2026-11-14T16:35:22.635717+00:00", trigger: "scheduled_or_manual",
    fuente: "1ff_dT8kHhiy1THTq1hRHGx2z2VElUQjyq_A4AL_nm4g/Movimientos", moneda_base_subtotales: "COP",
    resumen_gastos: [
      { id: "MOV-01265", fecha_real: "2026-11-13", comercio: "Ara", descripcion: "[owner reply] Ara $72.371 Edu credito nu", categoria: "Supermercado", subcategoria: "", titular: "Edu", cuenta: "Nu Edu", medio_pago: "Crédito", mes_pago: "dic-2026", importe: 72371.0, moneda: "COP", monto_cop: 72371.0, estado_sheets: "Registrado", fila: 1562, fila_origen: "120363422102546755@g.us:AC58912ABA660E5E0EF136B32C469EBA", grupo: "registrado" },
      { id: "MOV-01284", fecha_real: "2026-11-13", comercio: "Carne", descripcion: "[WAHIST Puca Col 2026-11-13 08:48:22] Carne: $80.000 (transferencia Ro Nu)", categoria: "Supermercado", subcategoria: "Carnicería / proteína", titular: "Rocío", cuenta: "Nu Ro", medio_pago: "Transferencia", mes_pago: "2026-11", importe: 80000.0, moneda: "COP", monto_cop: 80000.0, estado_sheets: "Registrado", fila: 1581, fila_origen: "WAHIST:chat(3).txt:L97:2026-11-13T08:48:22:Puca Col", grupo: "registrado" }
    ],
    totales: { cantidad_movimientos_gasto: 2, total_cop: 152371.0, gastos_registrados_cop: 152371.0, cantidad_pendientes: 0, pendientes_cop_estimado: 0, total_potencial_cop: 152371.0, nota_total_potencial: "Registrados + pendientes conocidos (sin doble conteo)." },
    subtotales: { por_titular_cop: { "Rocío": 80000.0, "Edu": 72371.0 }, por_categoria_cop: { "Supermercado": 152371.0 }, por_cuenta_tarjeta_cop: { "Nu Ro": 80000.0, "Nu Edu": 72371.0 }, por_modalidad_pago_cop: { "Transferencia": 80000.0, "Crédito": 72371.0 } },
    compras_divididas: [], pendientes_validacion: [], errores_sincronizacion: [],
    estado_movimientos_sheets: { registrados_en_sheets: 2, conteo_por_estado: { "Registrado": 2 } },
    notas: ["Cierre calculado desde Finanzas Edu → Movimientos (fuente oficial)."]
  },
  "2026-11-14": {
    fecha: "2026-11-14", generated_at: "2026-11-14T16:35:23.082588+00:00", trigger: "scheduled_or_manual",
    fuente: "1ff_dT8kHhiy1THTq1hRHGx2z2VElUQjyq_A4AL_nm4g/Movimientos", moneda_base_subtotales: "COP",
    resumen_gastos: [
      { id: "MOV-01266", fecha_real: "2026-11-14", comercio: "Ara", descripcion: "Supermercado (parte 1/2, total 239.647)", categoria: "Supermercado", subcategoria: "", titular: "Edu", cuenta: "Nu Edu", medio_pago: "Crédito", mes_pago: "dic-2026", importe: 181647.0, moneda: "COP", monto_cop: 181647.0, estado_sheets: "Registrado", fila: 1563, fila_origen: "120363422102546755@g.us:AC79452F1EE71D82074828A391ED627B#1", grupo: "registrado" },
      { id: "MOV-01267", fecha_real: "2026-11-14", comercio: "Ara - Tender", descripcion: "Apartamento tender (parte 2/2, total 239.647)", categoria: "Apartamento", subcategoria: "", titular: "Edu", cuenta: "Nu Edu", medio_pago: "Crédito", mes_pago: "dic-2026", importe: 58000.0, moneda: "COP", monto_cop: 58000.0, estado_sheets: "Registrado", fila: 1564, fila_origen: "120363422102546755@g.us:AC79452F1EE71D82074828A391ED627B#2", grupo: "registrado" },
      { id: "MOV-01268", fecha_real: "2026-11-14", comercio: "Ara", descripcion: "[owner reply] Ara $39.990 Nu credito edu", categoria: "Supermercado", subcategoria: "", titular: "Edu", cuenta: "Nu Edu", medio_pago: "Crédito", mes_pago: "dic-2026", importe: 39990.0, moneda: "COP", monto_cop: 39990.0, estado_sheets: "Registrado", fila: 1565, fila_origen: "120363422102546755@g.us:ACE964B3B1C4396831F45D40EDA080A8", grupo: "registrado" },
      { id: "MOV-01285", fecha_real: "2026-11-14", comercio: "Farmacia", descripcion: "[WAHIST Puca Col 2026-11-14 08:36:17] Farmacia: $108.000 (Nu Cred Ro)", categoria: "Salud", subcategoria: "Farmacia", titular: "Rocío", cuenta: "Nu Ro", medio_pago: "Crédito", mes_pago: "dic-2026", importe: 108000.0, moneda: "COP", monto_cop: 108000.0, estado_sheets: "Registrado", fila: 1582, fila_origen: "WAHIST:chat(3).txt:L126:2026-11-14T08:36:17:Puca Col", grupo: "registrado" }
    ],
    totales: { cantidad_movimientos_gasto: 4, total_cop: 387637.0, gastos_registrados_cop: 387637.0, cantidad_pendientes: 2, pendientes_cop_estimado: 40700.0, total_potencial_cop: 428337.0, nota_total_potencial: "Registrados + pendientes conocidos (sin doble conteo)." },
    subtotales: { por_titular_cop: { "Edu": 279637.0, "Rocío": 108000.0 }, por_categoria_cop: { "Supermercado": 221637.0, "Apartamento": 58000.0, "Salud": 108000.0 }, por_cuenta_tarjeta_cop: { "Nu Edu": 279637.0, "Nu Ro": 108000.0 }, por_modalidad_pago_cop: { "Crédito": 387637.0 } },
    compras_divididas: [{ grupo: "120363422102546755@g.us:AC79452F1EE71D82074828A391ED627B#split", cantidad_partes: 2, ids: ["MOV-01266", "MOV-01267"], importe_total_cop: 239647.0, nota: "Compra dividida identificada: importes por parte; no duplicar total." }],
    pendientes_validacion: [
      { id: "02722a5d-dc63-477b-9b55-42cf149899c8", fecha: "2026-11-14", concepto: "[owner reply] D", importe: 32700.0, moneda: "COP", cuenta: "Efectivo/Débito", monto_cop_estimado: 32700.0, motivos: ["No se identificó persona (Edu/Rocío/Pía)", "Categoría/subcategoría no determinada"] },
      { id: "7fd6e494-4fd1-4cef-872d-6ff0111f6747", fecha: "2026-11-14", concepto: "[owner reply] Chori parqueadero Tranferencia", importe: 8000.0, moneda: "COP", titular: "Edu", cuenta: "Nu Edu", monto_cop_estimado: 8000.0, motivos: ["Categoría/subcategoría no determinada"] }
    ],
    errores_sincronizacion: [],
    estado_movimientos_sheets: { registrados_en_sheets: 4, conteo_por_estado: { "Registrado": 4 } },
    notas: ["Cierre calculado desde Finanzas Edu → Movimientos (fuente oficial)."]
  }
};

const SEED_REVIEWS = {
  "2026-11-13": { reviewed: true, status: "revisado", at: "2026-11-14T16:40:00-05:00", note: "Validado en retrospectivo." }
};

const SEED_CORRECTIONS = {
  proposals: [
    {
      id: "prop-seed-001",
      date: "2026-11-14",
      created_at: "2026-11-14T17:00:00-05:00",
      status: "propuesta",
      payload: {
        mode: "simple_fields",
        row_num: 1565,
        mov_id: "MOV-01268",
        reason: "Ejemplo (datos aislados): ajustar descripción por claridad",
        changes: { descripcion: "Ara - ajuste de ejemplo (no aplicado)", comercio: "Ara" },
        comparison: { antes: { descripcion: "[owner reply] Ara $39.990 Nu credito edu" }, despues: { descripcion: "Ara - ajuste de ejemplo (no aplicado)" } }
      },
      history: [{ at: "2026-11-14T17:00:00-05:00", action: "propuesta" }]
    }
  ],
  applied: []
};

function buildSeed() {
  return {
    pendings: JSON.parse(JSON.stringify(FIVE_PENDING)),
    closures: JSON.parse(JSON.stringify(SEED_CLOSURES)),
    reviews: JSON.parse(JSON.stringify(SEED_REVIEWS)),
    corrections: JSON.parse(JSON.stringify(SEED_CORRECTIONS)),
    audits: [],
    idempotency: {},
    syncState: { lastSyncAt: "2026-11-14T16:35:23.082588+00:00", pendingSyncCount: 0, status: "sincronizado", source: "seed_test", note: "Datos de prueba aislados (5 pendientes conservados sin aplicar)." }
  };
}

module.exports = { FIVE_PENDING, SEED_CLOSURES, SEED_REVIEWS, SEED_CORRECTIONS, buildSeed };
