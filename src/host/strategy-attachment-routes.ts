import type { StrategyAttachments } from './strategy-attachments.ts';
import { strategyAttachmentKind, strategyAttachmentLimit } from './strategy-attachment-types.ts';
import { attachmentCitation } from './strategy-attachment-document.ts';
import { StrategyDiscussionFault } from './strategy-discussion-store.ts';
import type { StrategyDiscussion, StrategyDiscussionSource } from './strategy-discussion-types.ts';
import { isDiscussionSourceExcluded, isDiscussionSourceSelected } from './strategy-discussion-source-scope.ts';

interface AttachmentRoutes {
  files:StrategyAttachments;
  owner(id:string):StrategyDiscussion;
  writable(owner:StrategyDiscussion):void;
  verifySource(source:StrategyDiscussionSource,owner:StrategyDiscussion):Promise<void>;
  mutate<T>(action:()=>Promise<T>):Promise<T>;
}
export function strategyAttachmentRoutes(options:AttachmentRoutes){
  return async (match:RegExpExecArray,method:string,body:(limit?:number)=>Promise<Record<string,unknown>>)=>{
    const id=match[1],action=match[2],owner=options.owner(id);
    if(owner.businessOwner)throw new StrategyDiscussionFault('strategy_discussion_not_found',404);
    if(!action&&method==='GET'){
      const sources=(await options.files.library(owner)).filter(s=>!isDiscussionSourceExcluded(owner,s));
      return {sources};
    }
    if(!action&&method==='POST'){
      const input=await body(Math.ceil(strategyAttachmentLimit/3)*4+8192);
      if(typeof input.name!=='string'||typeof input.content!=='string'||!input.content||input.content.length>Math.ceil(strategyAttachmentLimit/3)*4||input.content.length%4!==0)throw new StrategyDiscussionFault('strategy_attachment_invalid_document',422);
      const bytes=Buffer.from(input.content,'base64');
      if(bytes.toString('base64')!==input.content)throw new StrategyDiscussionFault('strategy_attachment_invalid_document',422);
      return options.mutate(async()=>{
        const latest=options.owner(id);
        if(latest.revision!==input.expectedRevision)throw new StrategyDiscussionFault('strategy_discussion_context_changed');
        options.writable(latest);
        const source=await options.files.add(latest,input.name as string,bytes);
        return {source};
      });
    }
    if(action==='excerpt'&&method==='POST'){
      const {citation,offset=0}=await body();
      if(!citation||typeof citation!=='object'||!('source' in citation)||!('token' in citation)||!('locator' in citation)||typeof citation.locator!=='string'||!Number.isSafeInteger(offset)||Number(offset)<0)throw new StrategyDiscussionFault('strategy_attachment_location_unavailable',404);
      const source=citation.source as StrategyDiscussionSource;
      if(source?.target?.kind!==strategyAttachmentKind||isDiscussionSourceExcluded(owner,source)||!isDiscussionSourceSelected(owner,source)||attachmentCitation(source,citation.locator).token!==citation.token)throw new StrategyDiscussionFault('strategy_attachment_not_authorized',403);
      await options.verifySource(source,owner);
      const note=(await options.files.notes(owner,source)).find(note=>note.locator===citation.locator);
      if(!note || Number(offset)>note.text.length)throw new StrategyDiscussionFault('strategy_attachment_location_unavailable',404);
      await options.verifySource(source,owner);
      const end=Math.min(note.text.length,Number(offset)+8192);
      return {source,locator:note.locator,text:note.text.slice(Number(offset),end),nextOffset:end<note.text.length?end:null};
    }
    throw new StrategyDiscussionFault('strategy_attachment_not_found',404);
  };
}
