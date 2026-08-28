(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!apiBaseUrl || !financeId) return;

  let payloadPromise = null;
  let cacheUntil = 0;
  let timer = null;

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((h,i) => [h || `Col ${i+1}`, row?.[i] ?? ''])));
  }

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim().replace(/[^\d,.\-]/g,'');
    if (!s) return 0;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) s = s.replace(/\./g,'').replace(',','.');
      else s = s.replace(/,/g,'');
    } else if (comma >= 0) {
      const p = s.split(',');
      s = p.length === 2 && p[1].length <= 4 ? p[0].replace(/\./g,'') + '.' + p[1] : s.replace(/,/g,'');
    } else if (dot >= 0) {
      const p = s.split('.');
      if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g,'');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parseDate(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function dateLabel(value) {
    const d = value instanceof Date ? value : parseDate(value);
    if (!d) return '—';
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }

  function money(value) {
    return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value)||0);
  }

  async function getPayload(force=false) {
    if (typeof window.__PANEL_GET_BACKEND_DATA__ === 'function') return window.__PANEL_GET_BACKEND_DATA__(force);
    if (!force && payloadPromise && Date.now() < cacheUntil) return payloadPromise;
    payloadPromise = (async()=>{
      const getIdToken = window.__PANEL_GET_ID_TOKEN__;
      if (typeof getIdToken !== 'function') throw new Error('Sesión Firebase no disponible');
      const token = await getIdToken(false);
      const response = await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if (!response.ok) throw new Error(`Backend ${response.status}`);
      return response.json();
    })();
    cacheUntil = Date.now() + 55_000;
    try { return await payloadPromise; }
    catch (error) { payloadPromise=null; cacheUntil=0; throw error; }
  }

  function matrix(payload, range) {
    return payload?.sources?.[`${financeId}|${range}`] || [];
  }

  function cardIdFromDom(card) {
    const brand = norm(card.querySelector('.credit-brand')?.textContent);
    const owner = norm(card.querySelector('.credit-owner')?.textContent);
    if (brand.includes('arq')) return 'TC-ARQ-EDU';
    if (brand.includes('nu') && (owner.includes('rocio') || owner.includes('rocío'))) return 'TC-NU-RO';
    if (brand.includes('nu')) return 'TC-NU-EDU';
    return '';
  }

  function cycleCutDate(row) { return parseDate(row?.['Fecha corte']); }
  function cardCycles(cycles,id) { return cycles.filter(r => String(r.Tarjeta || '').trim() === id); }

  function latestClosedCycle(cycles,id,now) {
    return cardCycles(cycles,id)
      .filter(r => cycleCutDate(r) && cycleCutDate(r) <= now)
      .sort((a,b)=>cycleCutDate(b)-cycleCutDate(a))[0] || null;
  }

  function openCycle(cycles,id,now) {
    return cardCycles(cycles,id)
      .filter(r => cycleCutDate(r) && cycleCutDate(r) > now)
      .sort((a,b)=>cycleCutDate(a)-cycleCutDate(b))[0] || null;
  }

  function deriveCurrentPeriod(cardRow,lastClosed,nextOpen,now) {
    const id = String(cardRow?.['ID tarjeta'] || '');
    if (nextOpen) {
      const start = parseDate(nextOpen['Inicio ciclo']);
      const cut = parseDate(nextOpen['Fecha corte']);
      return {start, end:cut, cut, source:'registered'};
    }

    const cutDay = Number(cardRow?.['Día corte'] || 0);
    if (!cutDay) return null;

    if (id.startsWith('TC-NU-')) {
      let nextCut;
      if (now.getDate() < cutDay) nextCut = new Date(now.getFullYear(),now.getMonth(),cutDay);
      else nextCut = new Date(now.getFullYear(),now.getMonth()+1,cutDay);
      const start = new Date(nextCut.getFullYear(),nextCut.getMonth()-1,cutDay);
      const end = new Date(nextCut); end.setDate(end.getDate()-1);
      return {start,end,cut:nextCut,source:'derived'};
    }

    if (lastClosed) {
      const start = parseDate(lastClosed['Fecha corte']);
      const nextCut = new Date(start.getFullYear(),start.getMonth()+1,cutDay);
      return {start,end:nextCut,cut:nextCut,source:'derived'};
    }
    return null;
  }

  function billedPeriod(cycle,id) {
    if (!cycle) return '—';
    const start = parseDate(cycle['Inicio ciclo']);
    const cut = parseDate(cycle['Fecha corte']);
    if (!start || !cut) return '—';
    let end = new Date(cut);
    if (id.startsWith('TC-NU-')) end.setDate(end.getDate()-1);
    return `${dateLabel(start)} – ${dateLabel(end)}`;
  }

  function currentPeriodLabel(period,id) {
    if (!period?.start || !period?.end) return '—';
    let end = new Date(period.end);
    if (period.source === 'registered' && id.startsWith('TC-NU-')) end.setDate(end.getDate()-1);
    return `${dateLabel(period.start)} – ${dateLabel(end)}`;
  }

  function paymentState(cycle) {
    if (!cycle) return {key:'open',label:'Sin corte cerrado'};
    const paid = norm(cycle.Pagado);
    if (['si','sí','pagado','pago','yes','true'].includes(paid)) return {key:'paid',label:'Pagado'};
    return {key:'pending',label:'Pendiente'};
  }

  function injectStyles() {
    if (document.getElementById('cardPaymentControlStyles')) return;
    const style = document.createElement('style');
    style.id = 'cardPaymentControlStyles';
    style.textContent = `
      .credit-card .billing-cycle{display:none!important}
      .card-payment-control{margin-top:14px;padding-top:13px;border-top:1px solid var(--border-soft);display:grid;gap:10px;position:relative;z-index:2}
      .card-payment-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
      .card-payment-head strong{font-size:10px;color:#b9c7da;text-transform:uppercase;letter-spacing:.05em}
      .payment-state{display:inline-flex;align-items:center;gap:6px;border-radius:99px;padding:5px 8px;font-size:9px;font-weight:800;border:1px solid var(--border)}
      .payment-state:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
      .payment-state.pending{color:#ffcb68;background:rgba(246,200,68,.08);border-color:rgba(246,200,68,.22)}
      .payment-state.paid{color:#7ee6af;background:rgba(38,208,124,.08);border-color:rgba(38,208,124,.22)}
      .payment-state.open{color:#8ab2ff;background:rgba(23,105,255,.08);border-color:rgba(23,105,255,.22)}
      .card-cycle-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
      .card-cycle-item{background:rgba(255,255,255,.025);border:1px solid var(--border-soft);border-radius:9px;padding:8px 9px;min-width:0}
      .card-cycle-item span{display:block;color:#667a94;font-size:8px;text-transform:uppercase;letter-spacing:.05em;font-weight:700}
      .card-cycle-item strong{display:block;margin-top:4px;color:#dce6f3;font-size:10px;white-space:normal;line-height:1.35}
      .card-cycle-item.wide{grid-column:1/-1}
      .card-real-limit{margin-top:7px;color:#697b93;font-size:9px;line-height:1.45}
      .card-limit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:2px}
      .card-limit-grid>div{padding:7px 9px;border-radius:9px;background:rgba(23,105,255,.045);border:1px solid rgba(23,105,255,.12)}
      .card-limit-grid span{display:block;font-size:8px;color:#7087a5;text-transform:uppercase;font-weight:700}
      .card-limit-grid strong{display:block;margin-top:4px;font-size:10px;color:#dce7f6}
      .credit-card.personal-limit-card .credit-sub{white-space:normal;line-height:1.45}
      @media(max-width:720px){.card-cycle-grid,.card-limit-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function enhanceCard(card,cardRow,cycles,now) {
    const id = String(cardRow['ID tarjeta'] || '');
    const realLimit = parseNumber(cardRow['Cupo total actual']);
    const used = parseNumber(cardRow['Cupo usado']);
    const personalLimit = parseNumber(cardRow['Límite personal de gasto']);
    const usePersonal = id === 'TC-ARQ-EDU' && personalLimit > 0;
    const controlLimit = usePersonal ? personalLimit : realLimit;
    const controlAvailable = controlLimit - used;
    const realAvailable = realLimit - used;
    const pct = controlLimit > 0 ? used/controlLimit*100 : 0;

    card.classList.toggle('personal-limit-card',usePersonal);
    const amount = card.querySelector('.credit-amount');
    const sub = card.querySelector('.credit-sub');
    const fill = card.querySelector('.usage-fill');
    const stats = [...card.querySelectorAll('.credit-stat')];

    if (amount) amount.textContent = money(used);
    if (sub) {
      sub.innerHTML = usePersonal
        ? `Usado de <strong>${esc(money(personalLimit))}</strong> límite personal · Margen ${esc(money(Math.max(0,controlAvailable)))}<div class="card-real-limit">Cupo bancario real ${esc(money(realLimit))} · Disponible real ${esc(money(Math.max(0,realAvailable)))}</div>`
        : `Usado de ${esc(money(realLimit))} · Disponible ${esc(money(Math.max(0,realAvailable)))}`;
    }
    if (fill) {
      fill.style.width = `${Math.max(0,Math.min(100,pct))}%`;
      fill.classList.toggle('high',pct>=70 && pct<85);
      fill.classList.toggle('critical',pct>=85);
    }
    if (stats[0]) {
      const label = stats[0].querySelector('span');
      const value = stats[0].querySelector('strong');
      if (label) label.textContent = usePersonal ? 'Uso límite personal' : 'Utilización';
      if (value) value.textContent = `${pct.toLocaleString('es-CO',{maximumFractionDigits:1,minimumFractionDigits:pct%1?1:0})}%`;
    }

    const closed = latestClosedCycle(cycles,id,now);
    const open = openCycle(cycles,id,now);
    const current = deriveCurrentPeriod(cardRow,closed,open,now);
    const state = paymentState(closed);

    if (stats[1]) {
      const value = stats[1].querySelector('strong');
      if (value) value.textContent = closed ? dateLabel(closed['Fecha corte']) : (current?.cut ? dateLabel(current.cut) : '—');
    }
    if (stats[2]) {
      const label = stats[2].querySelector('span');
      const value = stats[2].querySelector('strong');
      if (label) label.textContent = 'Vencimiento';
      if (value) value.textContent = closed?.['Fecha vencimiento'] ? dateLabel(closed['Fecha vencimiento']) : 'Por confirmar';
    }

    card.querySelector('.card-payment-control')?.remove();
    const block = document.createElement('div');
    block.className = 'card-payment-control';

    const paymentDate = closed?.['Fecha pago'] ? dateLabel(closed['Fecha pago']) : '—';
    const totalDue = closed ? parseNumber(closed['Pago total']) : 0;
    const minDue = closed ? parseNumber(closed['Pago mínimo']) : 0;
    block.innerHTML = `
      <div class="card-payment-head"><strong>Control del último corte</strong><span class="payment-state ${state.key}">${esc(state.label)}</span></div>
      <div class="card-cycle-grid">
        <div class="card-cycle-item wide"><span>Período actual</span><strong>${esc(currentPeriodLabel(current,id))}</strong></div>
        <div class="card-cycle-item wide"><span>Último período facturado</span><strong>${esc(billedPeriod(closed,id))}</strong></div>
        <div class="card-cycle-item"><span>Fecha de corte</span><strong>${esc(closed ? dateLabel(closed['Fecha corte']) : (current?.cut ? dateLabel(current.cut) : '—'))}</strong></div>
        <div class="card-cycle-item"><span>Fecha límite de pago</span><strong>${esc(closed?.['Fecha vencimiento'] ? dateLabel(closed['Fecha vencimiento']) : 'Pendiente de confirmar')}</strong></div>
        <div class="card-cycle-item"><span>Pago mínimo</span><strong>${closed ? esc(money(minDue)) : '—'}</strong></div>
        <div class="card-cycle-item"><span>Pago total corte</span><strong>${closed ? esc(money(totalDue)) : '—'}</strong></div>
        ${state.key==='paid' ? `<div class="card-cycle-item wide"><span>Fecha de pago</span><strong>${esc(paymentDate)}</strong></div>` : ''}
      </div>
      ${usePersonal ? `<div class="card-limit-grid">
        <div><span>Límite personal</span><strong>${esc(money(personalLimit))}</strong></div>
        <div><span>Margen personal</span><strong>${esc(money(Math.max(0,controlAvailable)))}</strong></div>
        <div><span>Cupo real</span><strong>${esc(money(realLimit))}</strong></div>
        <div><span>Disponible real</span><strong>${esc(money(Math.max(0,realAvailable)))}</strong></div>
      </div>` : ''}`;
    card.appendChild(block);
  }

  async function run() {
    const active = document.querySelector('.nav-item.active')?.dataset.view;
    if (active !== 'tarjetas') return;
    const cards = [...document.querySelectorAll('#viewRoot .credit-card')];
    if (!cards.length) return;
    try {
      const payload = await getPayload();
      if (document.querySelector('.nav-item.active')?.dataset.view !== 'tarjetas') return;
      const cardRows = parseRows(matrix(payload,'Tarjetas!A:T'));
      const cycles = parseRows(matrix(payload,'Pagos_Tarjetas!A:T'));
      const now = new Date();
      cards.forEach(card=>{
        const id = cardIdFromDom(card);
        const row = cardRows.find(r=>String(r['ID tarjeta']||'').trim()===id);
        if (row) enhanceCard(card,row,cycles,now);
      });
    } catch (error) {
      console.error('No se pudo cargar el control de pagos de tarjetas:',error);
    }
  }

  function schedule(delay=90){ clearTimeout(timer); timer=setTimeout(run,delay); }

  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{
    if(event.detail?.view==='tarjetas')schedule(30);
  });
  document.addEventListener('panel:card-filter-changed',()=>schedule(40));
  document.addEventListener('panel:section-filters-changed',event=>{
    if(event.detail?.view==='tarjetas')schedule(40);
  });
  schedule();
})();
