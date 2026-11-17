# Control de gastos (Hermes)

Módulo de Finanzas → Control de gastos del Dashboard Personal. Captura/validación
Hermes + Finanzas Edu como fuente contable. **Modo de publicación: lectura,
validación y revisión; sin escrituras contables productivas.**

## Arquitectura

| Pieza | Archivo | Rol |
|---|---|---|
| Montaje Cloud Run | `index.js` | Crea store, router y (opcional) escritor controlado |
| Rutas HTTP | `routes.js` | Auth Firebase + AR-only para escrituras; fail-closed sin cola |
| Lógica de servicio | `service.js` | Pendientes, cierres, correcciones, previsualización Antes/Después, estado |
| Almacenamiento | `storage.js` | `memory` / `file` / `firestore` (operaciones atómicas) |
| Cola durable | `durable-queue.js` | Estados, idempotencia por clave/origen, reserva transaccional de IDs, bloqueo permanente ante ambigüedad |
| Escritor serializado | `sequential-writer.js` | Único escritor del destino: insert/split/corrección (patch), respaldo, readback de 27 columnas, sin reintentos |
| Adaptador Sheets TEST | `sheets-writer-adapter.js` | Cliente inyectable, destino TEST fijo, fábrica deshabilitada por defecto |
| Consumidor mock | `mock-sequential-worker.js` | Solo para `MockSheetsClient` (entorno local) |
| Fixtures | `fixtures.js` | Datos de prueba (5 pendientes históricos + cierres) — solo entornos locales explícitos |

## Modo seguro (publicación)

- `CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED=false`: **no se configura ningún
  escritor de Sheets** (guarda dura en `index.js`). Ningún endpoint escribe en
  Finanzas Edu → Movimientos.
- Sin cola, `POST /pendings/:id/apply` y `POST /corrections/:id/apply` devuelven
  **503** (`isolated_queue_unavailable` / `serialized_writer_not_ready`) y no
  mutan datos. Además, la cola solo acepta pendientes sintéticos `cgtest_*`
  con origen `CGTEST:`.
- Fixtures deshabilitados en proyectos reales: Firestore muestra estados vacíos
  identificados (`sin_sincronizacion`), sin inventar datos.
- Autenticación: verificación de ID token de Firebase + allowlist
  (`fernandoemacchi@gmail.com`, `eduardo@fibrazo.com`) + `email_verified`;
  escrituras solo para el usuario personal autorizado (AR).
- El probe `POST /_test/probe` queda deshabilitado salvo env explícito + secret.
- El harness E2E (`e2e/`) y los tests no se empaquetan en la imagen Docker
  (`.dockerignore`); bind solo en loopback con token sintético.

## Variables de entorno

| Variable | Uso |
|---|---|
| `CONTROL_GASTOS_STORE` | `firestore` en preprod/prod; `memory` solo local |
| `CONTROL_GASTOS_FIRESTORE_DATABASE` | Base nombrada (`panel-personal-control-gastos`) |
| `CONTROL_GASTOS_FIRESTORE_PREFIX` | Prefijo de colecciones (prod debe usar uno propio, p. ej. `control_gastos_prod`, para aislar preprod) |
| `CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED` | Siempre `false` en la publicación segura |
| `CONTROL_GASTOS_FIXTURES` / `CONTROL_GASTOS_SEED_TEST` | Solo para entornos locales de prueba |

**No usar en producción:** `CONTROL_GASTOS_SHEETS_MODE`, `CONTROL_GASTOS_SHEETS_ADC`,
`CONTROL_GASTOS_SHEETS_TEST_*`, `CONTROL_GASTOS_TEST_TARGET_ENFORCED`,
`CONTROL_GASTOS_TEST_PROBE*`, `CONTROL_GASTOS_DEVICE_TOKEN_SECRET` (migrar a
Secret Manager cuando se autorice).

## Pruebas

```powershell
# Emulador
java -jar "$env:USERPROFILE\.cache\firebase\emulators\cloud-firestore-emulator-v1.22.0.jar" `
  --host 127.0.0.1 --port 18989 --project_id demo-control-gastos-local

# Suite (28 pruebas)
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:18989'; $env:GCLOUD_PROJECT='demo-control-gastos-local';
$env:CONTROL_GASTOS_LOCAL_QUEUE='1';
node --test --test-force-exit control-gastos/durable-queue.emulator.test.js `
  control-gastos/queue-frontend.test.js control-gastos/device-auth.test.js `
  control-gastos/target-guard.test.js control-gastos/lock-release.test.js `
  control-gastos/probe-labels.test.js control-gastos/production-safety.test.js
```

Harness E2E de navegador (solo local, loopback):

```powershell
$env:CONTROL_GASTOS_LOCAL_E2E='1'; $env:CONTROL_GASTOS_LOCAL_PORT='8099';
node control-gastos/e2e/local-server.js     # http://127.0.0.1:8099/local-e2e
node control-gastos/e2e/worker-cli.js --prefix cg_e2e --file <ruta>\sheet.json --all
```

## Etapa siguiente (requiere autorización específica)

Consumidor secuencial contra Google Sheets **TEST** (cuenta de servicio propia,
nunca compartida con Finanzas Edu productivo). Sin sync automática contable y
sin escrituras reales en Finanzas Edu.
