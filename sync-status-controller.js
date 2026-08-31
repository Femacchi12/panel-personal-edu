(() => {
  'use strict';

  let frame = 0;

  function timeLabel(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  async function paint() {
    const text = document.getElementById('syncText');
    const dot = document.getElementById('syncDot');
    const getData = window.__PANEL_GET_BACKEND_DATA__;
    if (!text || typeof getData !== 'function') return;

    try {
      const payload = await getData(false);
      const count = Object.keys(payload?.sources || {}).length;
      const at = timeLabel(payload?.generatedAt);
      text.textContent = `Sincronizado · ${count} fuentes${at ? ` · ${at}` : ''}`;
      dot?.classList.add('ok');
      dot?.classList.remove('error');
      text.title = 'Última lectura del backend central. La actualización manual fuerza una lectura nueva de Google Sheets.';
    } catch (error) {
      text.textContent = 'Sincronización pendiente';
      dot?.classList.remove('ok');
      dot?.classList.add('error');
      text.title = String(error?.message || error);
    }
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  }

  document.addEventListener('panel:backend-data-loaded', schedule);
  document.addEventListener('panel:manual-refresh-complete', schedule);
  document.addEventListener('panel:modules-ready', schedule);
  queueMicrotask(schedule);
})();
