(() => {
  'use strict';

  const cfg = window.PANEL_CONFIG || {};
  const financeId = String(cfg.financeSpreadsheetId || '');
  if (!financeId) return;

  let renderFrame = 0;
  let renderVersion = 0;
  let pendingForce = false;

  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function parseRows(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map(v => String(v ?? '').trim());
    return values.slice(1)
      .filter(row => row?.some(v => String(v ?? '').trim() !== ''))
      .map(row => Object.fromEntries(headers.map((h,i) => [h || `Col ${i+1}`, row?.[i] ?? ''])));
  }

  function rowsFromPayload(payload,range) {
    const cached=window.__PANEL_GET_CACHED_ROWS__;
    if(typeof cached==='function') return cached(payload,financeId,range);
    return parseRows(payload?.sources?.[`${financeId}|${range}`]||[]);
  }

  async function loadSources(force=false) {
    const getData=window.__PANEL_GET_BACKEND_DATA__;
    if(typeof getData!=='function') return {cardRows:[],cycles:[]};
    const payload=await getData(force);
    return {
      cardRows:rowsFromPayload(payload,'Tarjetas!A:T'),
      cycles:rowsFromPayload(payload,'Pagos_Tarjetas!A:T')
    };
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

  function cardIdFromDom(card) {
    const brand = norm(card.querySelector('.credit-brand')?.textContent);
    const owner = norm(card.querySelector('.credit-owner')?.textContent);
    if (brand.includes('arq')) return 'TC-ARQ-EDU';
    if (brand.includes('nu') && (owner.includes('rocio') || owner.includes('rocío'))) return 'TC-NU-RO';
    if (brand.includes('nu')) return 'TC-NU-EDU';
    return '';
  }

  function cycleIndex(cycles,now) {
    const index=new Map();
    (cycles||[]).forEach(row=>{
      const id=String(row.Tarjeta||'').trim(),cut=parseDate(row['Fecha corte']);
      if(!id||!cut)return;
      let item=index.get(id);
      if(!item){item={closed:null,closedCut:null,open:null,openCut:null};index.set(id,item);}
      if(cut<=now){
        if(!item.closedCut||cut>item.closedCut){item.closed=row;item.closedCut=cut;}
      }else if(!item.openCut||cut<item.openCut){item.open=row;item.openCut=cut;}
    });
    return index;
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
      @media(max-width:720px){.card-cycle-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function enhanceCard(card,cardRow,index,now) {
    const id = String(cardRow['ID tarjeta'] || '');
    const indexed=index.get(id)||{};
    const closed = indexed.closed||null;
    const open = indexed.open||null;
    const current = deriveCurrentPeriod(cardRow,closed,open,now);
    const state = paymentState(closed);
    const stats = [...card.querySelectorAll('.credit-stat')];

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
      </div>`;
    card.appendChild(block);
  }

  async function run(force=false) {
    if (document.querySelector('.nav-item.active')?.dataset.view !== 'tarjetas') return;
    const version=++renderVersion;
    const cards = [...document.querySelectorAll('#viewRoot .credit-card')];
    if (!cards.length) return;
    try {
      const {cardRows,cycles}=await loadSources(force);
      if(version!==renderVersion||document.querySelector('.nav-item.active')?.dataset.view !== 'tarjetas') return;
      const now = new Date(),index=cycleIndex(cycles,now),rowById=new Map(cardRows.map(row=>[String(row['ID tarjeta']||'').trim(),row]));
      cards.forEach(card=>{
        if(!card.isConnected)return;
        const id = cardIdFromDom(card);
        const row = rowById.get(id);
        if (row) enhanceCard(card,row,index,now);
      });
    } catch (error) {
      if(version===renderVersion)console.error('No se pudo cargar el control de pagos de tarjetas:',error);
    }
  }

  function schedule(force=false){
    pendingForce=pendingForce||force;
    if(renderFrame)return;
    renderFrame=requestAnimationFrame(()=>{
      renderFrame=0;
      const useForce=pendingForce;
      pendingForce=false;
      run(useForce);
    });
  }

  injectStyles();
  document.addEventListener('panel:view-root-changed',event=>{if(event.detail?.view==='tarjetas')schedule(false);else renderVersion++;});
  document.addEventListener('panel:card-filter-changed',()=>schedule(false));
  document.addEventListener('panel:section-filters-changed',event=>{if(event.detail?.view==='tarjetas')schedule(false);});
  queueMicrotask(()=>schedule(false));
})();
