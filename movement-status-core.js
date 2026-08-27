(() => {
  'use strict';

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const PROJECTION_ALIASES = new Set([
    'proyeccion',
    'proyectado',
    'proyectada',
    'programado',
    'programada'
  ]);

  const ACTUAL_ALIASES = new Set([
    '',
    'realizado',
    'realizada',
    'real',
    'pagado',
    'pagada',
    'confirmado',
    'confirmada'
  ]);

  function kind(value) {
    const status = norm(value);
    if (PROJECTION_ALIASES.has(status) || status.startsWith('proyecc') || status.startsWith('proyect') || status.startsWith('programad')) return 'projection';
    if (ACTUAL_ALIASES.has(status)) return 'actual';
    // Los estados desconocidos se consideran realizados para no ocultar movimientos
    // históricos por una etiqueta nueva o no contemplada.
    return 'actual';
  }

  function isProjection(value) { return kind(value) === 'projection'; }
  function isActual(value) { return kind(value) === 'actual'; }
  function label(value) { return isProjection(value) ? 'Proyección' : 'Realizado'; }

  window.MovementStatusCore = Object.freeze({
    norm,
    kind,
    isProjection,
    isActual,
    label,
    canonicalActual: 'Realizado',
    canonicalProjection: 'Proyección'
  });
})();
