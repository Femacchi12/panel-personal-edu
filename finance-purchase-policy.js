(() => {
  'use strict';

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (comma >= 0) {
      const parts = s.split(',');
      s = parts.length === 2 && parts[1].length <= 2
        ? parts[0].replace(/\./g, '') + '.' + parts[1]
        : s.replace(/,/g, '');
    } else if (dot >= 0) {
      const parts = s.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = s.replace(/\./g, '');
    }
    const result = Number(s);
    return Number.isFinite(result) ? result : 0;
  }

  function method(row) {
    const explicit = String(row?.['Modalidad de pago'] ?? '').trim();
    if (explicit) return explicit;
    const account = norm(row?.['Cuenta / Tarjeta']);
    if (account.includes('credito')) return 'Crédito';
    if (account.includes('transferencia')) return 'Transferencia';
    if (account.includes('debito')) return 'Débito';
    if (account.includes('efectivo')) return 'Efectivo';
    const installments = num(row?.Cuotas);
    if (installments > 0 && (account.includes('nu') || account.includes('arq'))) return 'Crédito';
    return 'Sin especificar';
  }

  function isFinancedPurchase(row) {
    if (norm(method(row)) !== 'credito') return false;
    if (norm(row?.['Categoría']) === 'tarjeta col') return false;
    const description = norm(`${row?.['Descripción / Comercio'] ?? ''} ${row?.['Descripción original'] ?? ''}`);
    if (/cuota de manejo|interes|interés/.test(description)) return false;
    return true;
  }

  function installmentCount(row) {
    return Math.max(1, Math.round(num(row?.Cuotas) || 1));
  }

  window.FinancePurchasePolicy = Object.freeze({
    norm,
    num,
    method,
    isFinancedPurchase,
    installmentCount
  });
})();