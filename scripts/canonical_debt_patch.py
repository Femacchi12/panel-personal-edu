from pathlib import Path
import re

app = Path('app.js')
text = app.read_text(encoding='utf-8')

canonical = r'''  function canonicalDebtPurchases(rows) {
    const groups = new Map();
    (rows || []).forEach(row => {
      const id = pick(row,['ID compra']) || [pick(row,['Fecha compra']),pick(row,['Tarjeta']),pick(row,['Descripción','Comercio']),pick(row,['Total compra'])].join('|');
      if (!groups.has(id)) groups.set(id,[]);
      groups.get(id).push(row);
    });
    return [...groups.entries()].map(([id,group]) => {
      const ordered = group.slice().sort((a,b)=>num(pick(a,['Cuota actual']))-num(pick(b,['Cuota actual'])));
      const pendingRows = ordered.filter(row => {
        const detail = norm(pick(row,['Estado detalle']));
        const status = norm(pick(row,['Estado']));
        return !(detail.includes('pagad') || status.includes('pagad'));
      });
      const current = pendingRows[0] || null;
      const outstanding = current ? num(pick(current,['Valor cuota','Cuota'])) + num(pick(current,['Saldo pendiente','Saldo','Valor pendiente'])) : 0;
      return {
        id,
        rows: ordered,
        pendingRows,
        current,
        outstanding,
        installment: current ? num(pick(current,['Valor cuota','Cuota'])) : 0,
        interest: current ? num(pick(current,['Intereses'])) : 0,
        label: pick(ordered[0]||{},['Descripción','Comercio']) || id
      };
    }).filter(group => group.current && group.outstanding > 0);
  }
  function renderDeudas() {const purchases=canonicalDebtPurchases(state.data.cuotas||[]);const rows=purchases.flatMap(p=>p.pendingRows);const pending=sum(purchases,p=>p.outstanding);const installment=sum(purchases,p=>p.installment);const interest=sum(purchases,p=>p.interest);return `${sectionHead('FINANZAS','Deudas y cuotas','Compras financiadas, cuotas e intereses pendientes')}<div class="kpi-grid">${kpi('Saldo financiado pendiente',money(pending),`${purchases.length} compras activas`,'gold')}${kpi('Próximas cuotas',money(installment),'Primera cuota aún no pagada por compra')}${kpi('Intereses',money(interest),'Intereses de la próxima cuota','red')}${kpi('Compras',String(purchases.length),'Compras con principal pendiente')}</div>${chartPanel('Saldo pendiente por compra','Principal aún no pagado','debtChart',Math.max(760,purchases.length*110))}${tablePanel('Cuotas pendientes',rows,['Fecha compra','Comercio','Descripción','Tarjeta','Titular','Total compra','N° cuotas','Cuota actual','Valor cuota','Saldo pendiente','Intereses','Fecha última cuota','Estado','Estado detalle'])}`;}
'''
pattern = re.compile(r"  function renderDeudas\(\) \{.*?\n  function renderInversiones", re.S)
text, count = pattern.subn(canonical + "  function renderInversiones", text, count=1)
if count != 1:
    raise SystemExit(f'Esperaba reemplazar renderDeudas una vez, obtuve {count}')

chart = r'''  function drawDebtChart(){const purchases=canonicalDebtPurchases(state.data.cuotas||[]);const top=purchases.map(p=>[p.label,p.outstanding]).sort((a,b)=>b[1]-a[1]).slice(0,12);makeBar('debtChart',top.map(x=>x[0]),[{label:'Principal pendiente',data:top.map(x=>x[1]),backgroundColor:COLORS[1]}],true);}
'''
pattern = re.compile(r"  function drawDebtChart\(\)\{.*?\n  function drawPensionChart", re.S)
text, count = pattern.subn(chart + "  function drawPensionChart", text, count=1)
if count != 1:
    raise SystemExit(f'Esperaba reemplazar drawDebtChart una vez, obtuve {count}')

app.write_text(text, encoding='utf-8')

card = Path('card-payments-installments.js')
ctext = card.read_text(encoding='utf-8')

shared_payload = r'''  async function getPayload(force=false){
    if(typeof window.__PANEL_GET_BACKEND_DATA__==='function')return window.__PANEL_GET_BACKEND_DATA__(force);
    if(!force&&cache&&Date.now()-cacheAt<55_000)return cache;
    const getIdToken=window.__PANEL_GET_ID_TOKEN__;
    if(typeof getIdToken!=='function')throw new Error('Sesión Firebase no disponible');
    const token=await getIdToken(false);
    const res=await fetch(`${apiBaseUrl}/api/data`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if(!res.ok)throw new Error(`Backend ${res.status}`);
    cache=await res.json();cacheAt=Date.now();return cache;
  }
'''
pattern = re.compile(r"  async function getPayload\(force=false\)\{.*?\n  \}\n\n  function source", re.S)
ctext, count = pattern.subn(shared_payload + "\n  function source", ctext, count=1)
if count != 1:
    raise SystemExit(f'Esperaba reemplazar getPayload una vez, obtuve {count}')

pending = r'''  function pendingInstallment(row,cycles,now){
    const first=parseMonth(row['Fecha primera cuota']);
    const installment=Math.max(1,Math.round(parseNumber(row['Cuota actual']))||1);
    if(!first)return null;
    const scheduled=addMonths(first,installment-1);
    const id=cardId(row.Tarjeta,row.Titular);
    const detail=norm(row['Estado detalle']);
    const status=norm(row.Estado);
    if(detail.includes('pagad')||status.includes('pagad'))return {pending:false,scheduled,id};
    if(detail==='por pagar'||detail.includes('programad')||detail.includes('pend'))return {pending:true,scheduled,id};
    const cycle=latestClosedCycle(cycles,id,now);
    const currentMonth=new Date(now.getFullYear(),now.getMonth(),1);
    if(!cycle)return {pending:scheduled>=currentMonth,scheduled,id};
    const cut=parseDate(cycle['Fecha corte']);
    if(!cut)return {pending:scheduled>=currentMonth,scheduled,id};
    const cutMonth=new Date(cut.getFullYear(),cut.getMonth(),1);
    const cmp=scheduled-cutMonth;
    return {pending:cmp>0||(cmp===0&&!isPaid(cycle)),scheduled,id};
  }
'''
pattern = re.compile(r"  function pendingInstallment\(row,cycles,now\)\{.*?\n  \}\n\n  function groupPurchases", re.S)
ctext, count = pattern.subn(pending + "\n  function groupPurchases", ctext, count=1)
if count != 1:
    raise SystemExit(f'Esperaba reemplazar pendingInstallment una vez, obtuve {count}')

old_key = "      const key=[id,row['Fecha compra'],norm(row.Descripción||row.Comercio),total].join('|');"
new_key = "      const key=String(row['ID compra']||'').trim()||[id,row['Fecha compra'],norm(row.Descripción||row.Comercio),total].join('|');"
if new_key not in ctext:
    if old_key not in ctext:
        raise SystemExit('No se encontró la clave de agrupación de cuotas')
    ctext = ctext.replace(old_key,new_key,1)

card.write_text(ctext, encoding='utf-8')
