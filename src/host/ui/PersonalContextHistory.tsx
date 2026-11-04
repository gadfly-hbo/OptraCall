import { useEffect, useRef, useState } from 'react';
import { PersonalDialog } from './PersonalDialog.tsx';
import { readPersonalContextHistory, type PersonalContextHistoryEntry, type PersonalContextHistoryResult } from './personal-context-client.ts';
import { personalRetentionError } from './personal-retention-client.ts';
const label = (entry: PersonalContextHistoryEntry) => entry.action === 'find' ? '查看当时目录' : entry.evidence === 'nested-unknown' ? '查看嵌套记录' : '查看当时提供';
export function PersonalContextHistory({ projectId, taskId, requestId, completionKey }: { projectId: string; taskId: string; requestId?: string; completionKey?: string }) {
 const [result, setResult] = useState<PersonalContextHistoryResult>(), [error, setError] = useState(''), [detail, setDetail] = useState<PersonalContextHistoryEntry>();
 const trigger = useRef<HTMLElement | null>(null), detailEpoch = useRef(0), owner = useRef(`${projectId}/${taskId}`); owner.current = `${projectId}/${taskId}`;
 const [opening, setOpening] = useState(false);
 useEffect(() => () => { ++detailEpoch.current; }, [projectId, taskId]);
 async function openEntry(entry: PersonalContextHistoryEntry, button: HTMLButtonElement) {
  const epoch = ++detailEpoch.current, expectedOwner = `${projectId}/${taskId}`; trigger.current = button; setOpening(true); setDetail(undefined); setError('');
  try {
   const latest = await readPersonalContextHistory(projectId, taskId);
   if (epoch !== detailEpoch.current || owner.current !== expectedOwner) return;
   setResult(latest);
   const exact = latest.entries.find(value => value.sessionId === entry.sessionId && value.entryId === entry.entryId && value.toolCallId === entry.toolCallId && value.action === entry.action);
   if (!exact) { setError('本次未能回读所选准确原生记录，历史正文与今天状态均为 UNKNOWN；没有用缓存补齐。'); return; }
   setDetail(exact);
  } catch (error) { if (epoch === detailEpoch.current && owner.current === expectedOwner) setError(`本次历史读取未能核对，今天状态为 UNKNOWN；没有用缓存正文或旧状态补齐。${personalRetentionError(error)}`); }
  finally { if (epoch === detailEpoch.current && owner.current === expectedOwner) setOpening(false); }
 }
 useEffect(() => { let alive = true; setResult(undefined); setError(''); setDetail(undefined); void readPersonalContextHistory(projectId, taskId).then(value => { if(alive) setResult(value); }, error => { if(alive) setError(personalRetentionError(error)); }); return () => { alive = false; }; }, [projectId, taskId, requestId, completionKey]);
 if (!result?.entries.length && !error && !result?.issues.length) return null;
 return <section className="pr-note pc-selection" aria-label="个人资料来源历史" aria-busy={opening || undefined}>
  <strong>个人资料来源历史</strong><p className="pr-footnote">目录、实际提供的内容与作者回复中的说明分别保留；提供不代表采用或事实已证实。</p>
  {opening && <p className="pr-footnote" role="status">正在核对所选原生记录与今天的状态…</p>}
  {error && <p className="pr-caution" role="status">历史未能核对：{error} 原记录保持。</p>}
  {result?.partial && <p className="pr-caution">部分历史未能核对，不用今天的正文补齐。</p>}
  {result?.issues.map((issue,index)=><p className="pr-caution" key={index}>{issue.code}{issue.file ? ` · ${issue.file}` : ''}</p>)}
  {result?.entries.map((entry,index)=><div className="pr-row" key={`${entry.sessionId}/${entry.entryId}/${index}`}><span>{entry.action === 'find' ? '目录信息' : entry.evidence === 'nested-unknown' ? '嵌套调用 · 子正文 UNKNOWN' : entry.details?.items.map(item=>item.title).join('、') || '当时提供的准确内容'}</span><button className="text-button" type="button" disabled={opening} onClick={event=>{void openEntry(entry,event.currentTarget);}}>{label(entry)}</button></div>)}
  {detail && <PersonalDialog drawer title={detail.evidence === 'nested-unknown' ? '嵌套读取记录' : detail.action === 'find' ? '当时目录信息' : '当时提供的个人资料'} returnFocus={trigger.current} onClose={()=>setDetail(undefined)}>
   {detail.evidence === 'nested-unknown' ? <p className="pr-note pr-warning">Pi 原生仅保存父调用或嵌套元信息；子正文未单独记录，UNKNOWN。这不表示读取未发生，也不要求 Agent 重读补证。</p> : <><h3>{detail.action === 'find' ? '当时目录信息，不是正文' : '当时实际保存的模型可见内容'}</h3>{detail.text === null ? <p className="pr-caution">当时正文未记录 · UNKNOWN。不会用当前内容替代。</p> : <pre className="pr-paper">{detail.text}</pre>}{detail.details?.items.map((item,index)=><section className="pr-section" key={index}><h3>{item.title}</h3><p>{item.extent === 'fragment' ? `准确片段 [${item.range?.start ?? '?'}, ${item.range?.end ?? '?'})，不代表全文` : item.extent === 'full' ? '当时准确全文' : '当时目录信息'}</p><p>当时局限：{item.caution || '未说明'}{item.limitations.length ? ` · ${item.limitations.join('；')}` : ''}</p><p>当时治理：{item.governance.archived ? '人工资料已归档' : '未归档'} · {item.governance.enterpriseEnabled === null ? '原资料启用状态未知' : item.governance.enterpriseEnabled ? '原资料另行启用' : '原资料未启用／已停用'}{item.governance.latestCorrectionOperationId ? ' · 当时记录了独立纠正标识，正文以原生记录为准' : ''}</p><details><summary>当时准确身份与治理快照</summary><pre>{JSON.stringify(item,null,2)}</pre></details></section>)}</>}
   <section className="pr-section"><h3>今天的状态</h3><p className="pr-footnote">今天的排除、归档或失读不会改写上面的历史提供，也不证明作者采用。</p>{detail.current.length ? detail.current.map((status,index)=><div className="pr-note" key={index}><strong>{status.state === 'excluded' ? '今天已排除' : status.state === 'available' ? '今天准确来源可读' : '今天来源未能核对 · UNKNOWN'}</strong>{status.issue && <p>{status.issue}</p>}{status.governance?.archived && <p>今天人工资料已归档</p>}{status.governance?.sourceProjectArchived && <p>今天来源项目已归档，只读。</p>}</div>) : <p>当前来源状态未能独立核对 · UNKNOWN</p>}</section>
   <p className="pr-footnote">原生会话 {detail.sessionId} · 记录 {detail.entryId}{detail.toolCallId ? ` · 调用 ${detail.toolCallId}` : ''}</p>
  </PersonalDialog>}
 </section>;
}
