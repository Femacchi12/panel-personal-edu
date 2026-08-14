# Panel Personal Edu

Dashboard personal web para consolidar **Finanzas**, **Salud** y **Vida**.

## Fuentes maestras

- Finanzas Edu: `1ff_dT8kHhiy1THTq1hRHGx2z2VElUQjyq_A4AL_nm4g`
- Salud - Familia: `1I7Z93rrr6J-0-sP9QuBtZrMuu_t1As3lik0_WK8xqMk`

## Privacidad

El repositorio no necesita guardar los datos personales. La aplicación usa Google OAuth en el navegador y consulta Google Sheets API con permisos de solo lectura. Los Sheets pueden permanecer privados.

## Configuración de Google OAuth

1. Crear o usar un proyecto en Google Cloud.
2. Habilitar **Google Sheets API**.
3. Configurar la pantalla de consentimiento OAuth.
4. Crear un **OAuth Client ID** de tipo Web application.
5. Agregar como origen autorizado la URL de GitHub Pages del repositorio.
6. Pegar el Client ID en `config.js` en `googleClientId`.

## Publicación

Cuando el repositorio esté listo, habilitar GitHub Pages desde la rama `main` / raíz.

> Importante: el sitio puede ser público, pero los datos de los Sheets permanecen protegidos por Google porque solo se descargan después de que el usuario inicia sesión con una cuenta que tenga acceso a esos archivos.
