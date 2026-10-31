import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const jsFiles=fs.readdirSync(root).filter(name=>name.endsWith('.js'));
const source=jsFiles.map(name=>fs.readFileSync(path.join(root,name),'utf8')).join('\n');
const canvasIds=[...source.matchAll(/<canvas id=["']([^"'$]+)["']/g)].map(match=>match[1]);
const orphaned=[...new Set(canvasIds)].filter(id=>!source.includes(`getElementById('${id}')`)&&!source.includes(`byId('${id}')`));
if(orphaned.length)throw new Error(`Canvas without chart binding: ${orphaned.join(', ')}`);

const patrimonio=fs.readFileSync(path.join(root,'patrimonio-dashboard-v2.js'),'utf8');
const nativeCurrency=fs.readFileSync(path.join(root,'patrimonio-native-currency.js'),'utf8');
for(const [name,text] of [['patrimonio-dashboard-v2.js',patrimonio],['patrimonio-native-currency.js',nativeCurrency]]){
  if(!text.includes('monthTimeline'))throw new Error(`${name}: missing complete monthly timeline`);
  if(!text.includes('spanGaps=false')&&!text.includes('spanGaps:false'))throw new Error(`${name}: missing explicit gap handling`);
}
if(!patrimonio.includes('autoSkip:false'))throw new Error('Patrimonio history must show every month label, including missing months.');

console.log(`Dashboard visual contracts OK (${new Set(canvasIds).size} chart canvases checked; patrimonio gaps explicit).`);
