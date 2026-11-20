import type { StrategyAttachmentCitation, StrategyAttachmentReplyReferences } from './strategy-attachment-types.ts';
import { strategyAttachmentKind } from './strategy-attachment-types.ts';
import type { StrategyDiscussionSource } from './strategy-discussion-types.ts';
import { discussionHash } from './strategy-discussion-store.ts';

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function nativeAttachmentEvidence(entries:readonly unknown[],requestFilter?:string,throughEntryId?:string){
  let requestId='',reads=new Map<string,StrategyAttachmentCitation>();
  const all=new Map<string,StrategyAttachmentCitation>(),calls=new Map<string,string>();
  const references:StrategyAttachmentReplyReferences[]=[];
  for(const entry of entries){
    if(!record(entry))continue;
    if(entry.type==='custom'&&entry.customType==='optracall.run'&&record(entry.data)&&entry.data.phase==='started'){
      requestId=typeof entry.data.requestId==='string'?entry.data.requestId:'';
      reads=new Map();calls.clear();
    }
    const message=entry.message;
    if(requestId&&(!requestFilter||requestId===requestFilter)&&entry.type==='message'&&record(message)){
      const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.filter(p=>p.type==='text').map(p=>p.text).join(''):'';
      if(message.role==='assistant'){
        if(Array.isArray(message.content))for(const part of message.content)if(part.type==='toolCall'&&part.name==='strategy_goals'&&part.arguments?.action==='read-source')calls.set(part.id,part.arguments.sourceId);
        const citations=[...reads.values()].filter(c=>text.includes('[[资料:'+c.token+']]'));
        if(citations.length&&typeof entry.id==='string')references.push({requestId,entryId:entry.id,citations});
      }else if(message.role==='toolResult'&&message.toolName==='strategy_goals'&&typeof message.toolCallId==='string'){
        const sourceId=calls.get(message.toolCallId);calls.delete(message.toolCallId);
        if(sourceId&&!message.isError){
          let value;try{value=JSON.parse(text);}catch{continue;}
          const s=value?.source as StrategyDiscussionSource,r=value?.read;
          if(value.claim!=='provided-not-used-or-verified'||!s||s.id!==sourceId||s.target?.kind!==strategyAttachmentKind||r?.source?.id!==s.id||!Array.isArray(r.locations))continue;
          for(const c of r.locations)if(c&&typeof c.locator==='string'&&c.source?.id===s.id&&discussionHash(c.source)===discussionHash(s)&&c.token===discussionHash([s.id,c.locator]).slice(0,24)){
            const citation={source:s,locator:c.locator,token:c.token};reads.set(c.token,citation);all.set(c.token,citation);
          }
        }
      }
    }
    if(throughEntryId&&entry.id===throughEntryId)break;
  }
  return {reads:[...all.values()],references};
}
export function discussionAttachmentReads(entries:readonly unknown[],requestId:string){return nativeAttachmentEvidence(entries,requestId).reads;}
export function discussionAttachmentCitations(entries:readonly unknown[],requestId?:string,throughEntryId?:string){return nativeAttachmentEvidence(entries,requestId,throughEntryId).references;}
