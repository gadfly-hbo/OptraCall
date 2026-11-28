import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export const evidenceRoot=path.resolve('.local/ui-conformance');
export const uiRoot=path.join(evidenceRoot,'product-dist');
export async function buildUi(){
 await fs.mkdir(uiRoot,{recursive:true});
 const tracked=execFileSync('git',['ls-files','src','extensions','index.html','package.json','package-lock.json'],{encoding:'utf8'}).trim().split('\n');
 const untracked=execFileSync('git',['ls-files','--others','--exclude-standard','src','extensions'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const source=[];for(const file of [...new Set([...tracked,...untracked])].sort()){try{const bytes=await fs.readFile(file);source.push({path:file,sha256:createHash('sha256').update(bytes).digest('hex')});}catch(e){if(e.code!=='ENOENT')throw e;}}
 const sourceManifestHash=createHash('sha256').update(JSON.stringify(source)).digest('hex');
 const status=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();
 await build({entryPoints:{main:'src/host/ui/main.tsx'},outdir:uiRoot,bundle:true,format:'esm',jsx:'automatic',target:'es2022',loader:{'.svg':'dataurl','.png':'dataurl','.woff2':'dataurl'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
 const sourceAfter=[];for(const file of source.map(row=>row.path)){try{const bytes=await fs.readFile(file);sourceAfter.push({path:file,sha256:createHash('sha256').update(bytes).digest('hex')});}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(createHash('sha256').update(JSON.stringify(sourceAfter)).digest('hex')!==sourceManifestHash)throw Error('Source changed during build; keep the previously running candidate and retry only after authors settle.');
 await fs.copyFile('src/host/ui/favicon.svg',path.join(uiRoot,'favicon.svg'));
 await fs.writeFile(path.join(uiRoot,'index.html'),(await fs.readFile('index.html','utf8')).replace('/src/host/ui/main.tsx','/main.js').replace('/src/host/ui/favicon.svg','/favicon.svg').replace('</head>','<link rel="stylesheet" href="/main.css"></head>'));
 const files=[];for(const name of ['main.js','main.css','favicon.svg','index.html']){const bytes=await fs.readFile(path.join(uiRoot,name));files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
 const identity={schema:1,version:JSON.parse(await fs.readFile('package.json','utf8')).version,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),builtAt:new Date().toISOString(),dirty:!!status,files};
 await fs.writeFile(path.join(uiRoot,'optracall-build.json'),JSON.stringify(identity,null,2));
 await fs.writeFile(path.join(evidenceRoot,'source-manifest.json'),JSON.stringify({identity,sourceManifestHash,status,source},null,2));
 console.log('BUILD',JSON.stringify({commit:identity.commit,dirty:identity.dirty,builtAt:identity.builtAt,sourceManifestHash}));
 return identity;
}
if(process.argv[1]===new URL(import.meta.url).pathname)await buildUi();
