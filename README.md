# Panel Personal Edu

Dashboard personal para consolidar **Finanzas**, **Salud** y **Vida** en una sola interfaz.

## Arquitectura actual

```text
Google Sheets privados
  ├─ Finanzas Edu
  ├─ Documentos
  └─ Salud - Familia
          ↓ solo lectura
Cloud Run · backend privado/autenticado
          ↓ payload central + caché corta
GitHub Pages · frontend
          ↓
Controladores globales + carga diferida por sección
```

El frontend usa **Firebase Authentication con Google**. El backend valida el ID token y solo responde a las cuentas autorizadas.

Los datos personales no se guardan dentro del repositorio.

## Fuentes maestras

- **Finanzas Edu**: `1ff_dT8kHhiy1THTq1hRHGx2z2VElUQjyq_A4AL_nm4g`
- **Documentos**: `1P8_zNStHg9v5Xm1loYvT_95TgfRWVUCOY341tyJXDV0`
- **Salud - Familia**: `1I7Z93rrr6J-0-sP9QuBtZrMuu_t1As3lik0_WK8xqMk`

### Regla financiera crítica

`Finanzas Edu → Movimientos!A:AA` es la **única fuente oficial de gastos reales**. La columna `Ámbito` distingue `Personal` y `FIBRAZO`.

- Resúmenes, extractos, tarjetas y proyecciones pueden servir para conciliación.
- Ninguna de esas fuentes debe crear automáticamente un gasto real.
- Si un resumen difiere de `Movimientos`, se corrige o concilia el resumen; `Movimientos` conserva autoridad.
- Los movimientos `Ámbito = FIBRAZO` sí afectan el uso y el pago real de la tarjeta personal cuando fueron pagados con ella.
- Los movimientos `Ámbito = FIBRAZO` no forman parte del gasto personal del hogar.
- En **Gastos diarios**, el ámbito predeterminado es `Personal`; el usuario puede alternar `Personal | FIBRAZO | Todos`.
- En **Tarjetas de crédito**, el ámbito predeterminado es `Todos`, porque el saldo bancario debe incluir consumos personales y de FIBRAZO. El panel muestra el desglose por ámbito y el monto por recuperar de FIBRAZO.
- Un reintegro de la empresa debe registrarse como `Reembolso FIBRAZO`, no como ingreso personal.

## Backend

Archivo principal: `backend/server.js`.

Responsabilidades:

- validar sesión Firebase;
- permitir solo cuentas autorizadas;
- leer los Sheets;
- entregar un payload central al frontend;
- mantener una caché corta para reducir lecturas repetidas;
- permitir actualización manual forzada con `GET /api/data?refresh=1`;
- aislar fallos de una fuente individual cuando es posible y exponer `sourceErrors` sin derribar todo el panel;
- corregir en el payload las columnas USD de Pensión/Cesantías cuyo formato de Sheets puede devolver `#VALUE!` aunque el valor numérico interno sea válido.

Endpoint de control:

- `GET /health`

El repositorio **no tiene actualmente un workflow de GitHub Actions para desplegar Cloud Run**. Los cambios en `backend/` quedan versionados en `main`, pero el despliegue del servicio debe resolverse mediante la configuración externa de Google Cloud que esté activa para este proyecto.

## Frontend

Publicación: GitHub Pages desde `main` / raíz.

Componentes principales:

- `app.js`: navegación, filtros y render base;
- `data-backend-adapter.js`: adaptador único hacia el payload central;
- `regular-income-core.js`: definición central del ingreso regular;
- `finance-purchase-policy.js`: definición central de compra financiada;
- `finance-scope-card-controller.js`: ámbito Personal/FIBRAZO, desglose de crédito, tabla de compras con tarjeta y selección directa de tarjeta;
- `section-module-loader.js`: carga los controladores especializados solo la primera vez que se visita cada sección;
- controladores especializados para General, Gastos, Flujo, Tarjetas, Inversiones, Salud, Documentos y Viajes.

### Carga de módulos

La primera carga mantiene solo los componentes globales necesarios. Los módulos de Gastos, Flujo, Tarjetas, Deudas, Inversiones, Pensión, Ingresos, Servicios, Tipo de cambio y Documentos se descargan bajo demanda al entrar por primera vez a la sección correspondiente.

El cargador:

- evita descargar el mismo script dos veces aunque sea compartido por varias secciones;
- respeta dependencias por etapas cuando un módulo necesita que otro exista primero;
- vuelve a emitir el evento de vista después de cargar una sección para que los controladores recién incorporados se inicialicen correctamente;
- conserva los módulos en memoria para las siguientes visitas durante la misma sesión.

### Sincronización

- La actualización automática puede reutilizar caché para evitar lecturas innecesarias.
- El botón **Actualizar** fuerza una lectura nueva desde Google Sheets de punta a punta.
- El indicador lateral informa hora de última sincronización y distingue sincronización total de parcial.

## Privacidad

- Los Sheets permanecen privados.
- El backend autentica al usuario antes de exponer los datos del panel.
- El navegador no necesita almacenar los datos personales en el repositorio.
- Las cuentas autorizadas se validan tanto en Firebase como en el backend.

## Mantenimiento

Al agregar una nueva fuente o sección al dashboard:

1. agregar el rango al backend solo si realmente será consumido;
2. consumirlo desde el adaptador central, evitando una conexión paralela a Sheets;
3. manejar el caso de fuente vacía o temporalmente no disponible;
4. evitar duplicar reglas financieras o de negocio en varios controladores;
5. asignar los controladores especializados a `section-module-loader.js` cuando no necesiten estar activos desde el inicio;
6. mantener explícito el orden de dependencias si una sección requiere más de una etapa de carga;
7. actualizar esta documentación si cambia la arquitectura.
