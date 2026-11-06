import fs from 'node:fs/promises';
import path from 'node:path';
export function modelManifest(version=1, name='synthetic-model') {
  return {formatVersion:1,model:{name,version,stage:'Production'},goal:'Synthetic deterministic fixture',data:{fingerprint:{sha256:'a'.repeat(64),rows:4,columns:['x','prediction']}},metrics:{mae:0.25,'mae:prediction':0.25},training:{splitSeed:42,task:'regression',targets:['prediction'],trainedAt:'2026-01-01T00:00:00Z',sessionRef:'synthetic-session'},usage:{inputs:['x'],outputs:['prediction'],form:'predict(rows) -> rows'}};
}
export async function writeModelPack(root:string, version=1, source='export function predict(rows) { return rows.map(row => ({...row, prediction:Number(row.x)*2})); }', name='synthetic-model') {
  const directory=path.join(root,`${name}-v${version}`); await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(modelManifest(version,name)));
  await fs.writeFile(path.join(directory,'predict.mjs'),source); await fs.writeFile(path.join(directory,'README.md'),'Synthetic fixture, no business data.'); return directory;
}
