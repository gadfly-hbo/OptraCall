import path from 'node:path';
import { constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { StrategyDiscussion, StrategyDiscussionCreate, StrategyDiscussionUpdate } from './strategy-discussion-types.ts';
export class StrategyDiscussionFault extends Error { readonly code:string; readonly status:number; constructor(code:string,status=409){super(code);this.code=code;this.status=status;} }
const canonical=(x:unknown):unknown=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):x;
export const discussionHash=(x:unknown):string=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(canonical(x))).digest('hex');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function discussionId(x:unknown):string{if(typeof x!=='string'||!uuid.test(x))throw new StrategyDiscussionFault('invalid_strategy_discussion_id',400);return x;}
export class StrategyDiscussionStore {
 readonly root:string;
 constructor(dataRoot:string){this.root=path.join(path.resolve(dataRoot),'strategy-discussions');}
 directory(id:string){return path.join(this.root,discussionId(id));}
 nativeDirectory(id:string){return path.join(this.directory(id),'native');}
 workspace(id:string){return path.join(this.directory(id),'workspace');}
 private safe(create=false){
  if(!existsSync(this.root)){if(!create)return false;mkdirSync(this.root,{recursive:true,mode:0o700});}
  let dir=this.root;while(true){const s=lstatSync(dir);if(!(s.isSymbolicLink()&&process.platform==='darwin'&&dir==='/var')&&(!s.isDirectory()||s.isSymbolicLink()))throw new StrategyDiscussionFault('strategy_discussion_unsafe_path');const p=path.dirname(dir);if(p===dir)break;dir=p;}return true;
 }
 get(id:string):StrategyDiscussion & {createFingerprint:string}{
  discussionId(id);if(!this.safe())throw new StrategyDiscussionFault('strategy_discussion_not_found',404);
  const ownerDir=this.directory(id);if(existsSync(ownerDir)&&(!lstatSync(ownerDir).isDirectory()||lstatSync(ownerDir).isSymbolicLink()))throw new StrategyDiscussionFault('strategy_discussion_unsafe_path');
  const file=path.join(ownerDir,'owner.json');
  if(!existsSync(file))throw new StrategyDiscussionFault('strategy_discussion_not_found',404);
  const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>2*1024*1024)throw new StrategyDiscussionFault('strategy_discussion_unsafe_file');
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);let x:any;try{x=JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}
  if(x.formatVersion!==1||x.id!==id||!Number.isSafeInteger(x.revision)||x.revision<1||!Array.isArray(x.methods)||!Array.isArray(x.sources))throw new StrategyDiscussionFault('strategy_discussion_corrupt');
  return x;
 }
 list():StrategyDiscussion[]{if(!this.safe())return [];return readdirSync(this.root).filter(x=>uuid.test(x)).map(x=>this.get(x)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 write(value:StrategyDiscussion & {createFingerprint:string}):void{
  this.safe(true);const dir=this.directory(value.id);mkdirSync(dir,{recursive:true,mode:0o700});if(lstatSync(dir).isSymbolicLink())throw new StrategyDiscussionFault('strategy_discussion_unsafe_path');
  const file=path.join(dir,'owner.json'),temp=path.join(dir,'.'+randomUUID()+'.tmp');let renamed=false;
  try{const fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,JSON.stringify({formatVersion:1,...value})+'\n');fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,file);renamed=true;const d=openSync(dir,'r');try{fsyncSync(d);}finally{closeSync(d);}}catch(e){if(!renamed)try{unlinkSync(temp);}catch{}throw new StrategyDiscussionFault(renamed?'strategy_discussion_write_unknown':'strategy_discussion_write_failed',503);}
 }
 create(input:StrategyDiscussionCreate,configuration:{id:string;revision:number}):StrategyDiscussion{
  const id=discussionId(input.operationId),fingerprint=discussionHash(input);
  try{const existing=this.get(id);if(existing.createFingerprint!==fingerprint)throw new StrategyDiscussionFault('strategy_discussion_operation_conflict');return existing;}catch(e){if(!(e instanceof StrategyDiscussionFault)||e.status!==404)throw e;}
  const now=new Date().toISOString();const value={id,title:input.title?.trim()||'战略讨论',revision:1,configurationId:configuration.id,configurationRevision:configuration.revision,...(input.usageContext===undefined?{}:{usageContext:input.usageContext}),methods:input.methods??[{id:'playing-to-win',name:'Playing to Win'}],...(input.goal?{goal:input.goal}:{}),...(input.projectId?{projectId:input.projectId}:{}),sources:input.sources??[],sourceScope:input.sourceScope??{mode:input.projectId&&!input.sources?.length?'project-background':'selected-only'},createdAt:now,updatedAt:now,createFingerprint:fingerprint};
  this.write(value);return structuredClone(value);
 }
 update(id:string,input:StrategyDiscussionUpdate,configuration?:{id:string;revision:number}):StrategyDiscussion{
  const old=this.get(id);if(old.revision!==input.expectedRevision)throw new StrategyDiscussionFault('strategy_discussion_context_changed');
  const {expectedRevision,configurationId,...patch}=input;const value={...old,...patch,goal:patch.goal===null?undefined:patch.goal??old.goal,projectId:patch.projectId===null?undefined:patch.projectId??old.projectId,...(configuration?{configurationId:configuration.id,configurationRevision:configuration.revision}:{}),revision:old.revision+1,updatedAt:new Date().toISOString()};this.write(value);return structuredClone(value);
 }
}
