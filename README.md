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
Controladores especializados por sección
```

El frontend usa **Firebase Authentication con Google**. El backend valida el ID token y solo responde a las cuentas autorizadas.

Los datos personales no se guardan dentro del repositorio.

## Fuentes maestras

- **Finanzas Edu**: `1ff_dT8kHhiy1THTq1hRHGx2z2VElUQjyq_A4AL_nm4g`
- **Documentos**: `1P8_zNStHg9v5Xm1loYvT_95TgfRWVUCOY341tyJXDV0`
- **Salud - Familia**: `1I7Z93rrr6J-0-sP9QuBtZrMuu_t1As3lik0_WK8xqMk`

### Regla financiera crítica

`Finanzas Edu → Movimientos!A:Z` es la **única fuente oficial de gastos reales**.

- Resúmenes, extractos, tarjetas y proyecciones pueden servir para conciliación.
- Ninguna de esas fuentes debe crear automáticamente un gasto real.
- Si un resumen difiere de `Movimientos`, se corrige o concilia el resumen; `Movimientos` conserva autoridad.

## Backend

Archivo principal: `backend/server.js`.

Responsabilidades:

- validar sesión Firebase;
- permitir solo cuentas autorizadas;
- leer los Sheets en modo `readonly`;
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
- controladores especializados para General, Gastos, Flujo, Tarjetas, Inversiones, Salud, Documentos y Viajes.

### Sincronización

- La actualización automática puede reutilizar caché para evitar lecturas innecesarias.
- El botón **Actualizar** fuerza una lectura nueva desde Google Sheets de punta a punta.
- El indicador lateral informa hora de última sincronización y distingue sincronización total de parcial.

## Privacidad

- Los Sheets permanecen privados.
- El backend usa permisos de lectura.
- El navegador no necesita almacenar los datos personales en el repositorio.
- Las cuentas autorizadas se validan tanto en Firebase como en el backend.

## Mantenimiento

Al agregar una nueva fuente al dashboard:

1. agregar el rango al backend si realmente será consumido;
2. consumirlo desde el adaptador central, evitando una conexión paralela a Sheets;
3. manejar el caso de fuente vacía o temporalmente no disponible;
4. evitar duplicar reglas financieras o de negocio en varios controladores;
5. actualizar esta documentación si cambia la arquitectura.
