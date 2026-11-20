import { useEffect, useRef, useState } from 'react';
import { attachmentExtensions, strategyAttachmentLimit } from '../strategy-attachment-types.ts';
import type { StrategyDiscussionSource } from '../strategy-discussion-types.ts';
import { PersonalDialog } from './PersonalDialog.tsx';

export function StrategyAttachmentPicker({locked,projectId,onList,onAdd}:{locked:boolean;projectId:string;onList():Promise<StrategyDiscussionSource[]>;onAdd(files:File[],sources:StrategyDiscussionSource[]):Promise<void>}){
  const trigger=useRef<HTMLButtonElement>(null),ticket=useRef(0);
  const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [available,setAvailable]=useState<StrategyDiscussionSource[]>([]),[selected,setSelected]=useState<StrategyDiscussionSource[]>([]),[files,setFiles]=useState<File[]>([]);
  useEffect(()=>()=>{++ticket.current;},[]);
  async function show(){
    setOpen(true);setFiles([]);setSelected([]);setAvailable([]);setError('');
    if(!projectId)return;
    const epoch=++ticket.current;setLoading(true);
    try{const rows=await onList();if(epoch===ticket.current)setAvailable(rows);}
    catch(fault){if(epoch===ticket.current)setError(fault instanceof Error?fault.message:'项目资料暂不可读。');}
    finally{if(epoch===ticket.current)setLoading(false);}
  }
  async function confirm(){
    setSaving(true);setError('');
    try{await onAdd(files,selected);setOpen(false);}
    catch(fault){setError(fault instanceof Error?fault.message:'添加资料未完成。');}
    finally{setSaving(false);}
  }
  return <><button type="button" ref={trigger} className="text-button" disabled={locked} onClick={()=>void show()}>＋ 添加资料</button>
    {open&&<PersonalDialog title="添加讨论资料" returnFocus={trigger.current} busy={saving} onClose={()=>{++ticket.current;setOpen(false);setLoading(false);}} footer={<>
      <button type="button" className="secondary-button" disabled={saving} onClick={()=>{++ticket.current;setOpen(false);setLoading(false);}}>取消</button>
      <button type="button" className="primary-button" disabled={saving||(!files.length&&!selected.length)} onClick={()=>void confirm()}>{saving?'保存中…':'加入本次讨论'}</button></>}>
      {projectId&&<fieldset><legend>项目分析资料与成果</legend>{loading&&<p role="status">正在读取项目目录…</p>}
        {!loading&&!available.length&&<p className="sg-muted">当前项目没有可选的资料。</p>}
        {available.map(source=><label className="sg-row" key={source.id}><input type="checkbox" disabled={saving} checked={selected.some(s=>s.id===source.id)} onChange={event=>setSelected(items=>event.target.checked?[...items,source]:items.filter(s=>s.id!==source.id))}/>{source.title} · {source.sha256.slice(0,8)}</label>)}</fieldset>}
      <div className="field"><label>从电脑添加<input type="file" multiple accept={attachmentExtensions.join(',')} disabled={saving} onChange={event=>{
        const picked=Array.from(event.target.files??[]);event.target.value='';
        if(picked.some(file=>file.size>strategyAttachmentLimit)){setError('每份讨论附件最多 8 MiB。');return;}
        setError('');setFiles(old=>[...old,...picked]);
      }}/></label><p className="sg-muted">{projectId?'文件将保存到本项目的 020_clean。':'文件将保存在本机的当前讨论目录。'}</p></div>
      {files.map((file,i)=><div key={i} className="sg-row">{file.name}<button type="button" className="text-button" disabled={saving} onClick={()=>setFiles(old=>old.filter((_,j)=>j!==i))}>移除</button></div>)}
      {error&&<p role="alert" className="case-error">{error}</p>}
    </PersonalDialog>}</>;
}
