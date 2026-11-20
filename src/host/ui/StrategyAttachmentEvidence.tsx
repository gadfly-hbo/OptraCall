import { useRef, useState } from 'react';
import type { StrategyAttachmentCitation } from '../strategy-attachment-types.ts';
import { PersonalDialog } from './PersonalDialog.tsx';
import { strategyAttachmentRequest } from './strategy-discussion-client.ts';

export function StrategyAttachmentEvidence({discussionId,citation}:{discussionId:string;citation:StrategyAttachmentCitation}){
  const trigger=useRef<HTMLButtonElement>(null),request=useRef(0);
  const [open,setOpen]=useState(false),[text,setText]=useState(''),[next,setNext]=useState<number|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function read(offset:number){
    const ticket=++request.current;
    setOpen(true);setBusy(true);setError('');
    if(!offset){setText('');setNext(null);}
    try{
      const page=await strategyAttachmentRequest<{text:string;nextOffset:number|null}>(discussionId,'/excerpt','POST',{citation,offset});
      if(ticket===request.current){setText(old=>offset?old+page.text:page.text);setNext(page.nextOffset);}
    }catch(fault){if(ticket===request.current){setText('');setNext(null);setError(fault instanceof Error?fault.message:'原资料暂不可读。');}}
    finally{if(ticket===request.current)setBusy(false);}
  }
  return <><button ref={trigger} type="button" className="text-button" onClick={()=>void read(0)}>{citation.source.title} · {citation.locator}</button>{open&&<PersonalDialog title={citation.source.title} subtitle={citation.locator} returnFocus={trigger.current} onClose={()=>{++request.current;setOpen(false);}}>
    <p className="sg-muted">内容指纹 {citation.source.sha256.slice(0,12)}</p>{busy&&<p role="status">正在核对原版本…</p>}{error&&<p className="case-error" role="alert">{error}</p>}{text&&<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{text}</p>}
    {next!==null&&<button type="button" className="text-button" disabled={busy} onClick={()=>void read(next)}>继续读取本位置</button>}</PersonalDialog>}</>;
}
