import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {digest,exists,safePath,readBytes,writeExclusive} from './project-data-context-io.ts';
import {StrategyGoalsError} from './strategy-goals-store.ts';

const limit=8*1024*1024;
const filename=(root:string,owner:string,sha:string,create=false)=>safePath(root,'strategy-workbooks/'+owner+'/'+sha+'.xlsx',create);

export async function readWorkbookOriginal(root:string,owner:string,sha:string):Promise<Buffer>{
  let bytes:Buffer;
  try{bytes=await readBytes(await filename(root,owner,sha),limit);}
  catch{throw new StrategyGoalsError('strategy_workbook_source_unavailable',409);}
  if(digest(bytes)!==sha)throw new StrategyGoalsError('strategy_workbook_source_changed',409);
  return bytes;
}
/** Called under the Host mutation queue. Publish complete bytes before a version can refer to them. */
export async function withWorkbookOriginal<T>(root:string,owner:string,sha:string,bytes:Buffer,
  apply:()=>Promise<T>,inUse:()=>Promise<boolean>):Promise<T>{
  if(digest(bytes)!==sha)throw new StrategyGoalsError('strategy_workbook_source_changed',409);
  const file=await filename(root,owner,sha,true);
  if(await exists(file)){await readWorkbookOriginal(root,owner,sha);return apply();}
  const temp=file+'.'+randomUUID()+'.pending';
  let identity:Awaited<ReturnType<typeof fs.stat>>|undefined;
  try{
    await writeExclusive(temp,bytes);
    identity=await fs.stat(temp);
    await fs.rename(temp,file);
    const dir=await fs.open(path.dirname(file),'r');
    try{await dir.sync();}finally{await dir.close();}
    return await apply();
  }catch(error){
    const status=(error as {status?:number}).status;
    if(identity && status!==undefined && status>=400 && status<500 && !/unknown/i.test(String(error))){
      // Preserve a possibly committed version or another publisher's file when readback is uncertain.
      let referenced=true;
      try{referenced=await inUse();}catch{/* retain original */}
      if(!referenced){
        const current=await fs.lstat(file).catch(()=>null);
        if(current?.ino===identity.ino && current.dev===identity.dev)await fs.unlink(file);
      }
    }
    throw error;
  }finally{
    await fs.unlink(temp).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
  }
}
