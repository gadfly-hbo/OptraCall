import { useEffect, useRef, useState } from 'react';
import type { GoalDiscussionSourceRef } from '../strategy-goals-types.ts';
import type { StrategyDiscussionSourceDetail } from '../strategy-discussion-types.ts';
import { readStrategyDiscussionSource } from './strategy-discussion-client.ts';
export function StrategyDiscussionSourceBody({ detail }: { detail: StrategyDiscussionSourceDetail }) {
  return <><p className="sg-muted">准确原生载体 · {detail.role} · entry {String(detail.source.version)}。工具调用参数可能以 JSON 显示；这不是补写的 Agent 报告。</p><pre className="task-usage-context-text">{detail.body}</pre><p className="sg-muted">原文范围 {detail.range.start}–{detail.range.end} / {detail.range.total} · SHA-256 {detail.source.sha256}</p></>;
}
export function StrategyDiscussionSourceView({ source }: { source: GoalDiscussionSourceRef }) {
  const [detail, setDetail] = useState<StrategyDiscussionSourceDetail>(), [error, setError] = useState(''), [busy, setBusy] = useState(true), ticket = useRef(0);
  const load = async (offset = 0) => {
    const current = ++ticket.current; setBusy(true); setError('');
    try { const next = await readStrategyDiscussionSource(source, offset); if (current === ticket.current) setDetail(next); }
    catch (fault) { if (current === ticket.current) setError(fault instanceof Error ? fault.message : '准确原生来源暂不可读取，未替换为其他消息。'); }
    finally { if (current === ticket.current) setBusy(false); }
  };
  useEffect(() => { setDetail(undefined); void load(); return () => { ++ticket.current; }; }, [source.id, source.version, source.sessionId, source.sha256, source.entryType]);
  return <section className="strategy-discussion-candidate" aria-label="目标准确战略来源"><h3>目标准确战略来源</h3>{busy && <p role="status">正在核对原生条目与正文哈希…</p>}{detail && <StrategyDiscussionSourceBody detail={detail} />}{detail && !detail.complete && <button type="button" className="text-button" disabled={busy} onClick={() => { void load(detail.range.end); }}>查看下一段原文</button>}{error && <p className="case-error" role="status">{error}</p>}</section>;
}
