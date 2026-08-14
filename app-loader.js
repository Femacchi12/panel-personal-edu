(async () => {
  try {
    const files = [1,2,3,4,5,6].map(n => `app/chunk-${String(n).padStart(2,'0')}.b64`);
    const encoded = await Promise.all(files.map(async file => {
      const response = await fetch(file, { cache: 'no-store' });
      if (!response.ok) throw new Error(`No se pudo cargar ${file}: ${response.status}`);
      return (await response.text()).trim();
    }));

    const parts = encoded.map(text => Uint8Array.from(atob(text), c => c.charCodeAt(0)));
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    parts.forEach(part => { merged.set(part, offset); offset += part.length; });

    let source = new TextDecoder('utf-8').decode(merged);

    // El runtime original registra init en DOMContentLoaded. Como este loader es
    // asíncrono, normalmente ese evento ya ocurrió cuando termina de bajar los
    // chunks. También inyectamos el token OAuth obtenido por Firebase para que
    // el botón Actualizar pueda consultar los Sheets privados.
    source = source.replace(
      /accessToken:\s*null,/, 
      'accessToken: window.__PANEL_GOOGLE_ACCESS_TOKEN__ || null,'
    );

    new Function(source)();

    // Si DOMContentLoaded ya ocurrió, se dispara una vez de forma sintética para
    // inicializar navegación, filtros, tablas y gráficos.
    if (document.readyState !== 'loading') {
      document.dispatchEvent(new Event('DOMContentLoaded'));
    }

    const refreshLiveData = () => {
      if (!window.__PANEL_GOOGLE_ACCESS_TOKEN__) return;
      const btn = document.getElementById('refreshBtn');
      if (btn && !btn.disabled) btn.click();
    };

    // Cargar los datos reales inmediatamente después de inicializar la UI.
    setTimeout(refreshLiveData, 50);

    // Mantener sincronización periódica con los Sheets mientras la sesión viva.
    const minutes = Number(window.PANEL_CONFIG?.autoRefreshMinutes || 5);
    window.__PANEL_REFRESH_TIMER__ = window.setInterval(refreshLiveData, Math.max(1, minutes) * 60 * 1000);
  } catch (error) {
    console.error('Error cargando Panel Personal Edu:', error);
    const root = document.getElementById('viewRoot');
    if (root) root.innerHTML = '<div class="empty-state"><div><strong>No se pudo iniciar el dashboard</strong><span>Actualiza la página en unos segundos. Si continúa, revisaremos el despliegue.</span></div></div>';
  }
})();
