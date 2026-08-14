(() => {
  'use strict';

  const viewRoot = document.getElementById('viewRoot');
  if (!viewRoot) return;

  const pad = n => String(n).padStart(2, '0');
  const formatDate = d => `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;

  function safeDate(year, monthIndex, day) {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return new Date(year, monthIndex, Math.min(day, lastDay));
  }

  function currentCycle(cutDay, now = new Date()) {
    let end;
    if (now.getDate() <= cutDay) {
      end = safeDate(now.getFullYear(), now.getMonth(), cutDay);
    } else {
      end = safeDate(now.getFullYear(), now.getMonth() + 1, cutDay);
    }
    const previousCut = safeDate(end.getFullYear(), end.getMonth() - 1, cutDay);
    const start = new Date(previousCut.getFullYear(), previousCut.getMonth(), previousCut.getDate() + 1);
    return { start, end };
  }

  function readCutDay(card) {
    const stats = [...card.querySelectorAll('.credit-stat')];
    for (const stat of stats) {
      const label = (stat.querySelector('span')?.textContent || '').trim().toLowerCase();
      if (label.includes('corte')) {
        const value = stat.querySelector('strong')?.textContent || stat.textContent || '';
        const match = value.match(/\b([1-9]|[12]\d|3[01])\b/);
        if (match) return Number(match[1]);
      }
    }

    const title = (card.querySelector('.credit-brand')?.textContent || card.textContent || '').toLowerCase();
    if (title.includes('arq')) return 6;
    if (title.includes('nu')) return 15;
    return null;
  }

  function enhanceCard(card) {
    if (card.querySelector('.billing-cycle')) return;
    const cutDay = readCutDay(card);
    if (!cutDay) return;

    const { start, end } = currentCycle(cutDay);
    const block = document.createElement('div');
    block.className = 'billing-cycle';
    block.innerHTML = `
      <div>
        <span>Inicio del período</span>
        <strong>${formatDate(start)}</strong>
      </div>
      <div class="billing-period">
        <span>Corte del período</span>
        <strong>${formatDate(end)}</strong>
      </div>`;

    const bottom = card.querySelector('.credit-bottom');
    if (bottom) card.insertBefore(block, bottom);
    else card.appendChild(block);
  }

  function enhanceAll() {
    viewRoot.querySelectorAll('.credit-card').forEach(enhanceCard);
  }

  const observer = new MutationObserver(() => requestAnimationFrame(enhanceAll));
  observer.observe(viewRoot, { childList: true, subtree: true });
  enhanceAll();
})();