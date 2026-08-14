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
    const source = new TextDecoder('utf-8').decode(merged);
    new Function(source)();
  } catch (error) {
    console.error('Error cargando Panel Personal Edu:', error);
    const root = document.getElementById('viewRoot');
    if (root) root.innerHTML = '<div class="empty-state"><div><strong>No se pudo iniciar el dashboard</strong><span>Actualiza la página en unos segundos. Si continúa, revisaremos el despliegue.</span></div></div>';
  }
})();
