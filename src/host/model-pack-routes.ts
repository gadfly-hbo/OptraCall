import type { IncomingMessage } from 'node:http';
import { ModelPackStore, ModelPackError } from './model-pack-store.ts';
export function createModelPackRoutes(options:{store:ModelPackStore;readBody:(request:IncomingMessage)=>Promise<Record<string,unknown>>;mutate:<T>(operation:()=>T|Promise<T>)=>Promise<T>;isClosing:()=>boolean}) {
 return async(request:IncomingMessage,url:URL):Promise<{status:number;body:unknown}|null>=>{
  if(!url.pathname.startsWith('/api/model-pack/'))return null;
  try {
   if(request.method==='GET'&&url.pathname==='/api/model-pack/models')return {status:200,body:{models:options.store.list()}};
   const match=/^\/api\/model-pack\/models\/([^/]+)\/([1-9][0-9]*)(\/promote)?$/.exec(url.pathname);
   if(match){const name=decodeURIComponent(match[1]),version=Number(match[2]);
    if(request.method==='GET'&&!match[3])return {status:200,body:{model:options.store.get(name,version),manifest:options.store.manifest(name,version)}};
    if(request.method==='POST'&&match[3]){await options.readBody(request);if(options.isClosing())throw new ModelPackError('HOST_CLOSING',409);return {status:200,body:await options.mutate(()=>options.store.promote(name,version))};}
   }
   if(request.method==='POST'&&url.pathname==='/api/model-pack/imports'){
    const input=await options.readBody(request);if(typeof input.sourcePath!=='string')throw new ModelPackError('SOURCE_PATH_INVALID');if(options.isClosing())throw new ModelPackError('HOST_CLOSING',409);
    return {status:200,body:{model:await options.mutate(()=>options.store.importPack(input.sourcePath as string))}};
   }
   return {status:404,body:{code:'MODEL_ROUTE_NOT_FOUND',message:'模型包入口不存在',detail:{stage:'request',reason:'入口或请求方法不受支持'}}};
  }catch(error){
   if(error instanceof ModelPackError)return {status:error.status,body:{code:error.code,message:error.message,detail:error.detail}};
   const fault=error as {status?:number;code?:string};if(fault.status&&fault.code)return {status:fault.status,body:{code:fault.code,message:fault.code,detail:{stage:'request',reason:fault.code}}};
   return {status:500,body:{code:'MODEL_REQUEST_FAILED',message:'模型包操作结果未确认，请核对注册表。',detail:{stage:'request',reason:'操作未完成或结果未确认'}}};
  }
 };
}
