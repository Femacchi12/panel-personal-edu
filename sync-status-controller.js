(() => {
  'use strict';

  let frame = 0;
  let observer = null;

  function timeLabel(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  function sourceLabel(key) {
    const range = String(key || '').split('|').pop() || '';
    return range.split('!')[0] || range;
  }

  function writeText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  async function paint() {
    const text = document.getElementById('syncText');
    const dot = document.getElementById('syncDot');
    const getData = window.__PANEL_GET_BACKEND_DATA__;
    if (!text || typeof getData !== 'function') return;

    try {
      const payload = await getData(false);
      const total = Object.keys(payload?.sources || {}).length;
      const sourceErrors = payload?.sourceErrors || {};
      const failedKeys = Object.keys(sourceErrors);
      const failed = failedKeys.length;
      const ok = Math.max(0, total - failed);
      const at = timeLabel(payload?.generatedAt);

      if (failed) {
        writeText(text, `Sincronizado parcial · ${ok}/${total}${at ? ` · ${at}` : ''}`);
        dot?.classList.remove('ok');
        dot?.classList.add('error');
        text.title = `Fuentes pendientes: ${failedKeys.map(sourceLabel).join(', ')}. El resto del payload está disponible.`;
      } else {
        writeText(text, `Sincronizado · ${total} fuentes${at ? ` · ${at}` : ''}`);
        dot?.classList.add('ok');
        dot?.classList.remove('error');
        text.title = 'Última lectura del backend central. La actualización manual fuerza una lectura nueva de Google Sheets.';
      }
    } catch (error) {
      writeText(text, 'Sincronización pendiente');
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

  function watchLegacyWrites() {
    const text = document.getElementById('syncText');
    if (!text || observer) return;
    observer = new MutationObserver(() => schedule());
    observer.observe(text, { childList: true, characterData: true, subtree: true });
  }

  document.addEventListener('panel:backend-data-loaded', schedule);
  document.addEventListener('panel:manual-refresh-complete', schedule);
  document.addEventListener('panel:modules-ready', () => { watchLegacyWrites(); schedule(); });
  document.addEventListener('panel:view-root-changed', schedule);
  queueMicrotask(() => { watchLegacyWrites(); schedule(); });
})();