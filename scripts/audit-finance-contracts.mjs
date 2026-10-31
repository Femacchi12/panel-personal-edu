import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const backend=read('backend/server.js');
const source=/\{\s*book:\s*'(?:finance|documents|health)',\s*range:\s*'([^']+)'\s*\}/g;
const backendRanges=new Set([...backend.matchAll(source)].map(match=>match[1]));
const requested=new Map();
const retiredModules=new Set(['investment-period-enhancement.js','investment-freshness-controller.js']);
for(const name of fs.readdirSync(root).filter(name=>name.endsWith('.js')&&!retiredModules.has(name))){
  const text=read(name);
  for(const match of text.matchAll(/["']([A-Za-z_ÁÉÍÓÚáéíóúñÑ]+![A-Z]+:[A-Z]+)["']/g)){
    const range=match[1];
    if(!requested.has(range))requested.set(range,new Set());
    requested.get(range).add(name);
  }
}

const columnNumber=letters=>[...letters].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0);
const parts=range=>{const [sheet,grid]=range.split('!');const [,end]=grid.split(':');return {sheet,end:columnNumber(end)}};
const missing=[];
for(const [range,files] of requested){
  const need=parts(range);
  const compatible=[...backendRanges].some(candidate=>{
    const have=parts(candidate);
    return have.sheet===need.sheet&&have.end>=need.end;
  });
  if(!compatible)missing.push({range,files:[...files].sort()});
}

const expected=[
  'Movimientos!A:AA','Tarjetas!A:T','Cuotas!A:AB','Pagos_Tarjetas!A:T',
  'Resumen_Financiero!A:W','Credito_Mensual!A:L'
];
for(const range of expected){
  if(!backendRanges.has(range))missing.push({range,files:['canonical contract']});
}

if(missing.length){
  console.error('Finance source contract failures:');
  for(const issue of missing)console.error(`- ${issue.range}: ${issue.files.join(', ')}`);
  process.exit(1);
}
console.log(`Finance source contract OK (${backendRanges.size} backend ranges; ${requested.size} frontend ranges checked).`);
