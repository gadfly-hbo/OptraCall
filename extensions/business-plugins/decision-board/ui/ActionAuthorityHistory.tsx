import { useEffect, useRef, useState } from 'react';
import type { BoardActionAuthorization, BoardTaskView } from '../types.ts';
import type { CaseStrategyChoice, CaseDecisionRevision } from '../../../../src/host/case-decision-types.ts';
import { authorizationHistory } from './decision-board-client.ts';
import { readCaseDecisionRevision } from '../../../../src/host/ui/case-decisions-client.ts';
const choiceLabel = { trial: '先试点', gather_evidence: '先补证', defer: '暂缓', reject: '不采用', no_action: '暂不行动', continue: '继续', adjust: '调整', stop_considering: '停止考虑' };

/** Read-only projection of the original authorities, separate from execution controls. */
export function ActionAuthorityHistory({ task, initialHistory }: { task: BoardTaskView; initialHistory?: BoardActionAuthorization[] }) {
  const [history, setHistory] = useState(initialHistory), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [source, setSource] = useState<{ authorizationId: string; choice: CaseStrategyChoice; revision: CaseDecisionRevision }>();
  const alive = useRef(true), request = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  useEffect(() => { request.current++; setHistory(initialHistory); setSource(undefined); setError(''); }, [task.id, initialHistory]);
  const latest = history !== undefined ? history.at(-1) : task.authorization;
  const load = async () => {
    if (history || busy) return;
    const serial = ++request.current; setBusy(true); setError('');
    try { const value = await authorizationHistory(task.id); if (alive.current && serial === request.current) setHistory(value.authorizations); }
    catch (fault) { if (alive.current && serial === request.current) setError(fault instanceof Error ? fault.message : '授权记录未能读取，状态保持未知。'); }
    finally { if (alive.current && serial === request.current) setBusy(false); }
  };
  const viewSource = async (entry: BoardActionAuthorization) => {
    const serial = ++request.current; setError('');
    try {
      const ref = entry.source.strategyRef;
      const [response, original] = await Promise.all([
        fetch(`/api/cases/${encodeURIComponent(ref.caseId)}/decisions/choices/${encodeURIComponent(entry.source.choiceId)}`, { credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'x-optracall-client': '1' } }),
        readCaseDecisionRevision(ref.caseId, ref.recordId, ref.revision),
      ]);
      if (!response.ok) throw new Error('原Case选择当前不可读取；未替换其他版本。');
      const value = await response.json() as { choice: CaseStrategyChoice };
      if (value.choice.choiceId !== entry.source.choiceId || value.choice.strategyRef.caseId !== ref.caseId || value.choice.strategyRef.caseStoreId !== ref.caseStoreId || value.choice.strategyRef.recordId !== ref.recordId || value.choice.strategyRef.revision !== ref.revision) throw new Error('原Case选择身份未能核对。');
      if (alive.current && serial === request.current) setSource({ authorizationId: entry.authorizationId, choice: value.choice, revision: original.revision });
    } catch (fault) { if (alive.current && serial === request.current) setError(fault instanceof Error ? fault.message : '原方案与选择暂不可读。'); }
  };
  return <details className="board-action-authority" onToggle={event => { if (event.currentTarget.open) void load(); }}>
    <summary>选择、授权与反馈</summary>
    <p className="board-context-note">方案选择：{latest ? `参见原Case选择 ${latest.source.choiceId}` : '尚未关联原Case选择'}。看板采纳不代表行动授权。</p>
    <p className="board-context-note">行动授权：{latest ? latest.decision === 'authorize' ? `已记录明确授权 · ${latest.scope}` : '已记录撤回授权' : history || task.authorization === null ? '未记录明确行动授权' : '待查询，不能从采纳或任务状态推定'}。</p>
    <p className="board-context-note">用户报告发生：{task.feedback ? task.feedback.adopted ? task.feedback.outcome || '已回录按建议执行' : '已回录未按原建议执行' : '尚未回录'}。</p>
    <p className="board-context-note">效果验证：未独立验证。用户反馈的效果与主观评分保留原义，不能从授权或任务完成推定效果。</p>
    {busy && <p role="status">正在读取原授权记录…</p>}{error && <p role="alert">{error}</p>}
    {history && [...history].reverse().map(entry => <article className="feedback-history-item" key={entry.authorizationId}>
      <h4>{entry.decision === 'authorize' ? '明确行动授权' : '撤回行动授权'} · 第{entry.revision}次记录</h4>
      <p>{entry.scope}</p><blockquote>{entry.quoteProvenance.quote.text}</blockquote>
      <p className="board-context-note">原方案 v{entry.source.strategyRef.revision} · {entry.createdAt}</p>
      <button type="button" className="text-button" onClick={() => void viewSource(entry)}>查看原方案与选择</button>
      {source?.authorizationId === entry.authorizationId && <div className="board-task-feedback"><h4>{source.revision.payload.title} · v{source.revision.revision}</h4><p>{'proposal' in source.revision.payload ? source.revision.payload.proposal : ''}</p><p>原选择：{choiceLabel[source.choice.choice]} · {source.choice.reason || '未另填理由'}</p>{source.choice.quoteProvenance && <blockquote>{source.choice.quoteProvenance.quote.text}</blockquote>}</div>}
      <details><summary>准确版本与来源</summary><p>Case {entry.source.caseId} · 选择 {entry.source.choiceId}</p><p>原行动：{entry.taskSnapshot.title} · {entry.taskSnapshot.status}</p><p>建议版本：<code>{entry.itemVersion}</code><br />任务版本：<code>{entry.taskVersion}</code></p><p>原请求 {entry.quoteProvenance.requestId}<br />原会话 {entry.quoteProvenance.sessionId}<br />原调用 {entry.quoteProvenance.toolCallId}<br />原话范围 [{entry.quoteProvenance.quote.start}, {entry.quoteProvenance.quote.end})<br />原文摘要 <code>{entry.quoteProvenance.originalUserTextSha256}</code></p></details>
    </article>)}
  </details>;
}
