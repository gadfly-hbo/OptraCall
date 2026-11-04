import type { PersonalContextSelection } from '../personal-context-types.ts';
import { useEffect, useId, useRef, useState } from 'react';
import type { CandidateControlAction, CandidateControlInput, ExactCandidateRef } from '../agent-candidate-controls.ts';
import type { LearningSourceRef } from '../learning-source-types.ts';
import { agentCandidatesApi, createCandidateOperationJournal, readCandidateAfterOperation } from './agent-candidates-client.ts';
import type { AgentCandidatesApi, CandidateLookupInput, CandidateLookupResult, CandidateParentState, CandidateRow, CandidateView } from './agent-candidates-client.ts';
import { PersonalDialog } from './PersonalDialog.tsx';
import { PersonalRetentionRequestError, personalJsonIdentity, personalRetentionError, personalSourceNames } from './personal-retention-client.ts';

const parentNames: Record<CandidateParentState, string> = { completed: '父任务技术完成', running: '父任务运行中', cancelled: '父任务已取消', failed: '父任务技术失败', unknown: '父任务中断 · UNKNOWN' };
const actionNames: Record<CandidateControlAction, string> = { bookmark: '重点收藏', unbookmark: '取消重点收藏', correct: '追加纠正意见', exclude: '排除此条', restore: '恢复此条' };
const sourceNames = personalSourceNames;
const keyOf = (row: CandidateRow) => row.ref ? personalJsonIdentity(row.ref) : personalJsonIdentity({ reason: row.reason, locations: row.locations });
const when = (value: string) => new Date(value).toLocaleString('zh-CN');
const unavailable = (row: CandidateRow, reason = '原生记录未能精确核对'): CandidateRow => ({ ...row, details: null, status: 'unknown', reason, parentState: 'unknown', locations: [] });
export function candidateActionAvailability(row: CandidateRow, controlsAvailable: boolean) {
  const valid = row.status === 'available' && Boolean(row.details && row.ref);
  const known = row.status === 'unknown' && Boolean(row.ref && row.control && row.control.targetRevision > 0);
  return { bookmark: controlsAvailable && valid, correct: controlsAvailable && valid, unbookmark: controlsAvailable && (valid || known), exclude: controlsAvailable && (valid || known), restore: controlsAvailable && (valid || known) };
}
function CandidateLabels({ row }: { row: CandidateRow }) {
  return <div className="pr-row"><span className="pr-pill pr-purple">{row.status === 'anomaly' ? '异常历史 · 非有效候选' : 'Agent 候选 · 未人工确认'}</span>{row.status === 'available' && row.details ? <><span className="pr-pill">已记录</span><span className="pr-pill">{row.details.content.kind === 'knowledge' ? '知识' : '经验'}</span><span className={`pr-pill ${row.parentState === 'completed' ? '' : 'pr-warn'}`}>{parentNames[row.parentState]}</span>{[...new Set(row.locations.map(value => value.savedPath))].map(path => <span className="pr-pill" key={path}>{path === 'current' ? '任务当前保存路径' : '其它已保存路径'}</span>)}</> : <span className="pr-pill pr-warn">原生不可读／资格未核定 · UNKNOWN</span>}{row.control?.bookmarked && <span className="pr-pill">★ 重点收藏</span>}{row.control?.excluded && <span className="pr-pill">已排除</span>}{Boolean(row.control?.notes.length) && <span className="pr-pill">有人工注记</span>}</div>;
}
export function AgentCandidateResults({ result, onOpen, currentTaskLabel, onUse, onOther }: { result: CandidateLookupResult; onOpen: (row: CandidateRow) => void; currentTaskLabel?: string; onUse?: (row: CandidateRow) => void; onOther?: (row: CandidateRow) => void }) {
  return <>
    {result.partial && <section className="pr-note pr-warning" role="status"><strong>部分结果 · 未能核对完整范围</strong><p>超限、未知或仍有保存路径未读取，不能据此判断资料不存在。</p>{result.issues.length > 0 && <ul>{result.issues.map((issue, index) => <li key={index}><code>{issue.file}</code> · {issue.code}</li>)}</ul>}</section>}
    <section className="pr-panel pr-results" aria-label="Agent 候选结果">{result.rows.length ? result.rows.map((row, index) => <article className="pr-result" key={`${keyOf(row)}:${index}`}><div className="pr-result-main"><CandidateLabels row={row} /><h2><button type="button" className="pr-result-title" onClick={() => onOpen(row)}>{row.status === 'available' && row.details ? row.details.content.title : row.status === 'anomaly' ? '异常原生记录引用' : '已知精确引用 · UNKNOWN'}</button></h2>{row.status === 'available' && row.details ? <><p className="pr-preview">{row.details.content.bodyMd.slice(0, 180)}{row.details.content.bodyMd.length > 180 ? '…' : ''}</p><p className="pr-meta">范围：{row.details.content.scope || '未知／未说明'}{row.details.content.aliases.length ? ` · 别名：${row.details.content.aliases.join('、')}` : ''}</p>{row.details.content.caution && <p className="pr-caution">局限／提醒：{row.details.content.caution}</p>}<p className="pr-meta">生成于 {when(row.details.createdAt)} · 项目 {row.details.origin.projectId} ／ 任务 {row.details.origin.taskId}</p></> : <p className="pr-caution">{row.reason || '原生记录未能核对'}；不从缓存补正文、类别、时间、父状态或保存路径。</p>}</div><div className="pr-row">{row.status === 'available' && row.ref && !row.control?.excluded && <>{currentTaskLabel && onUse && <button type="button" className="primary-button" onClick={() => onUse(row)}>加入当前任务 · {currentTaskLabel}</button>}{onOther && <button type="button" className="secondary-button" onClick={() => onOther(row)}>{currentTaskLabel ? '选择其他任务' : '选择任务并加入'}</button>}</>}<button className="secondary-button" type="button" onClick={() => onOpen(row)}>阅读详情</button></div></article>) : <div className="pr-empty"><h2>{result.partial ? '当前未能核对完整范围' : '当前范围没有匹配资料'}</h2><p>{result.partial ? '请保留错误提示，明确刷新或继续读取；这不是空库结论。' : 'Agent 可以不留下候选；无需写日记或审批，原工作可以继续。可调整关键词或筛选。'}</p></div>}</section>
  </>;
}
export function AgentCandidateContent({ row, onReadSource, onOpenProject }: { row: CandidateRow; onReadSource?: (ref: LearningSourceRef) => void; onOpenProject?: (id: string) => void }) {
  const details = row.status === 'available' ? row.details : null;
  return <>
    <CandidateLabels row={row} />
    {details ? <><p className="pr-note">候选来自 Agent 自主声明，尚未人工确认。重点收藏只表达关注，父任务状态不证明业务结论正确。</p><section className="pr-section"><h3>Agent 原文</h3><div className="pr-paper">{details.content.bodyMd}</div><dl className="pr-metadata"><dt>适用范围</dt><dd>{details.content.scope || '未知／未说明'}</dd><dt>业务时间</dt><dd>未知／未说明；不以生成时间代替</dd><dt>局限／提醒</dt><dd>{details.content.caution || '未说明，不表示无风险'}</dd><dt>生成时间</dt><dd>{when(details.createdAt)} · 技术时间</dd></dl></section><section className="pr-section"><h3>生成依据与准确来源</h3><div className="pr-source-card"><strong>Pi 原生生成记录 · 已精确回读</strong><p className="pr-footnote">证明产生过该声明，不证明业务真实。正文保存在原生任务记录；重点收藏只保存引用。</p>{onOpenProject && <button className="text-button" type="button" onClick={() => onOpenProject(details.origin.projectId)}>回原项目</button>}</div>{details.sourceRefs.length ? details.sourceRefs.map((ref, index) => <div className="pr-source-card" key={index}><strong>{sourceNames[ref.type]}</strong><p className="pr-footnote">业务来源按准确身份读取；可读不证明候选正确。</p>{onReadSource && <button type="button" className="text-button" onClick={() => onReadSource(ref)}>阅读准确业务来源</button>}<details><summary>来源身份</summary><pre>{JSON.stringify(ref, null, 2)}</pre></details></div>) : <p className="pr-note">业务依据尚未补充；只有原生生成记录，不变成已证实结论。</p>}</section></> : <p className="pr-note pr-warning" role="status">{row.reason || '原生记录未能精确回读'}。当前仅显示已知引用与人的既有记录，正文、类别、生成时间、额外业务来源、父任务状态与保存路径均未核定。不用缓存或最新版补齐。</p>}
    <section className="pr-section"><h3>{row.status === 'anomaly' ? '异常记录引用' : '保留的精确引用'}</h3><pre>{JSON.stringify(row.ref, null, 2)}</pre><p className="pr-footnote">哈希核对完整 details 字节，不是防篡改认证；收藏没有候选正文备份承诺。</p></section>
    {row.status !== 'anomaly' && <><section className="pr-section"><h3>人的独立意见</h3>{row.control?.notes.length ? <ol className="pr-history">{row.control.notes.map((note, index) => <li key={note.operationId}><strong>{index === 0 ? '最新意见' : '历史意见'}</strong><p className="pr-meta">同条第 {note.targetRevision} 次操作 · {when(note.createdAt)}</p><div className="pr-paper">{note.note}</div></li>)}</ol> : <p className="pr-footnote">尚未补充。无需为了保存候选而填写意见。</p>}</section><section className="pr-section"><h3>人的控制</h3><dl className="pr-metadata"><dt>重点收藏</dt><dd>{row.control?.bookmarked ? '已收藏 · 仅表达关注' : '未收藏 · 不妨碍有效候选被发现'}</dd><dt>排除状态</dt><dd>{row.control?.excluded ? '已排除此条及其分支副本' : '未排除'}</dd><dt>人工确认</dt><dd>未因收藏、纠正或恢复变成已确认事实</dd><dt>本条版本</dt><dd>{row.control?.targetRevision ?? 0}</dd></dl><p className="pr-footnote">排除只影响这条候选及其分支副本，未来同来源新候选仍可能出现。恢复不清收藏和注记，不改变父状态或保存路径，也不修复原生来源。</p></section></>}
  </>;
}

export function AgentCandidatesPanel({ active, view, search, api = agentCandidatesApi, onReadSource, onOpenProject, currentTaskLabel, onUse, onOther, onOrganize }: { onOrganize?: (row: CandidateRow) => Promise<void>; currentTaskLabel?: string; onUse?: (selection: PersonalContextSelection, title: string) => void; onOther?: (selection: PersonalContextSelection, title: string) => void; active: boolean; view: CandidateView; search?: { query: string; includeBody: boolean; category: 'all' | 'knowledge' | 'experience' }; api?: AgentCandidatesApi; onReadSource?: (ref: LearningSourceRef) => void; onOpenProject?: (id: string) => void }) {
  const id = useId(), titleRef = useRef<HTMLHeadingElement>(null), detailTrigger = useRef<HTMLElement | null>(null), epoch = useRef(0), detailEpoch = useRef(0), noteRef = useRef<HTMLTextAreaElement>(null), activeRef = useRef(active); activeRef.current = active;
  const [query, setQuery] = useState(''), [filters, setFilters] = useState<CandidateLookupInput>({ query: '', includeBody: false, category: 'all', parentState: 'all', savedPath: 'all', pageSize: 50 });
  const [result, setResult] = useState<CandidateLookupResult | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<CandidateRow | null>(null), [correcting, setCorrecting] = useState(false), [note, setNote] = useState(''), [tried, setTried] = useState(false);
  const [journal] = useState(() => { try { return { value: createCandidateOperationJournal(typeof window === 'undefined' ? undefined : window.sessionStorage), error: '' }; } catch { return { value: createCandidateOperationJournal(), error: '无法保存候选原请求；请核对浏览器存储权限，暂不能新增人的操作。' }; } });
  const [journalError, setJournalError] = useState(journal.error), [pending, setPending] = useState<CandidateControlInput[]>([]), [pendingStates, setPendingStates] = useState<Record<string, 'unknown' | 'not-found' | 'conflict'>>({});
  function updatePending() { try { setPending(journal.value.entries()); } catch (error) { setJournalError(personalRetentionError(error)); } }
  const refresh = async (cursor?: string) => {
    if (!activeRef.current) return;
    const current = ++epoch.current; setLoading(true);
    try { const value = await api.lookup({ ...filters, ...(search ?? {}), view, ...(cursor ? { cursor } : {}) }); if (current === epoch.current) { setResult(value); setError(''); } }
    catch (error) { if (current === epoch.current) { setResult(null); setError(personalRetentionError(error)); } }
    finally { if (current === epoch.current) setLoading(false); }
  };
  const readCurrent = async (row: CandidateRow) => {
    if (!row.ref) return;
    const currentEpoch = ++detailEpoch.current;
    setDetail(unavailable(row, '正在重新核对原生记录'));
    try { const current = await api.read(row.ref); if (activeRef.current && currentEpoch === detailEpoch.current) setDetail(current); }
    catch (error) { if (activeRef.current && currentEpoch === detailEpoch.current) setDetail(unavailable({ ...row, control: null }, personalRetentionError(error))); }
  };
  useEffect(() => {
    if (active) { updatePending(); void refresh(); if (detail) void readCurrent(detail); }
    return () => { ++epoch.current; ++detailEpoch.current; };
  }, [active, api, filters, view, search?.query, search?.includeBody, search?.category]);
  useEffect(() => { if (active && correcting) noteRef.current?.focus(); }, [active, correcting]);
  async function open(row: CandidateRow) {
    detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCorrecting(false); setNote(''); setTried(false); setError(''); setNotice('');
    if (row.status === 'anomaly' || !row.ref) { setDetail(row); return; }
    await readCurrent(row);
  }
  async function useCandidate(row: CandidateRow, other = false) {
    if (!row.ref || busy) return;
    setBusy(true); setError('');
    try { const exact = await api.read(row.ref); if (exact.status !== 'available' || !exact.ref || !exact.details || exact.control?.excluded) throw new Error('准确候选当前不可用或已排除，选择与问题保持。'); (other ? onOther : onUse)?.({ target: { type: 'agent-candidate', candidate: exact.ref } }, exact.details.content.title); }
    catch (error) { setError(personalRetentionError(error)); }
    finally { setBusy(false); }
  }
  async function organizeCandidate() {
    if (!detail?.ref || busy || !onOrganize || result?.experienceLearningAvailable === false) return;
    setBusy(true); setError('');
    try { const exact = await api.read(detail.ref); if (exact.status !== 'available' || !exact.ref || !exact.details || exact.control?.excluded) throw new Error('准确候选当前不可用或已排除；不会使用缓存预填新稿。'); await onOrganize(exact); setDetail(null); }
    catch (error) { setError(personalRetentionError(error)); }
    finally { setBusy(false); }
  }
  const controlsAvailable = Boolean(result?.controlsAvailable) && !journalError;
  async function settleAndRefresh(input: CandidateControlInput) {
    // Query the original operation for CURRENT human state, not the possibly old replay receipt.
    // Native read failures retain that fresh state, never the old drawer flags/revision.
    const sameDetail = detail?.ref && personalJsonIdentity(detail.ref) === personalJsonIdentity(input.target);
    if (sameDetail && detail) {
      setDetail(unavailable(detail, '正在核对最新人的记录与原生来源'));
      const current = await readCandidateAfterOperation(api, detail, input.operationId);
      if (activeRef.current) setDetail(current);
    }
    journal.value.settle(input.operationId); updatePending();
    setPendingStates(previous => { const next = { ...previous }; delete next[input.operationId]; return next; });
    setNotice(`${actionNames[input.action]}已记录；只保存人的意见与引用，Agent 原文保持。`);
    if (input.action === 'correct') { setCorrecting(false); setNote(''); }
    await refresh();
  }
  async function submit(input: CandidateControlInput) {
    if (busy || journalError) return;
    setBusy(true); setError(''); setNotice('');
    try {
      journal.value.remember(input); updatePending();
      await api.control(input);
      // A replayed receipt can be old. Refresh current state instead of applying its historical state.
      await settleAndRefresh(input);
    } catch (error) {
      setPendingStates(previous => ({ ...previous, [input.operationId]: error instanceof PersonalRetentionRequestError && /revision_conflict/.test(error.code) ? 'conflict' : 'unknown' }));
      setError(`${personalRetentionError(error)} 原意图及操作标识保留；请先回查，不自动换 ID 或重放。`);
      if (detail) await readCurrent(detail);
    } finally { setBusy(false); }
  }
  async function act(action: CandidateControlAction) {
    if (!detail?.ref) return;
    if (action === 'correct' && (!note.trim() || note.length > 4000)) { setTried(true); return; }
    const base = { operationId: crypto.randomUUID(), target: detail.ref };
    await submit(action === 'correct' ? { ...base, action, note } : { ...base, action, note: null, expectedTargetRevision: detail.control?.targetRevision ?? 0 });
  }
  async function inspect(input: CandidateControlInput) {
    if (busy) return; setBusy(true); setError('');
    try {
      const read = await api.operation(input.operationId);
      if (read.event) { await settleAndRefresh(input); setNotice('已回读原操作成功回执，并重新读取当前状态；没有重复应用旧操作。'); }
      else { setPendingStates(previous => ({ ...previous, [input.operationId]: 'not-found' })); setNotice('尚无该原操作的成功回执。原意图保留，可明确同请求重试。'); }
    } catch (error) { setError(`原操作结果仍为 UNKNOWN。${personalRetentionError(error)}`); }
    finally { setBusy(false); }
  }
  async function reissue(input: CandidateControlInput) {
    if (!detail?.ref || input.action === 'correct' || !candidateActionAvailability(detail, controlsAvailable)[input.action]) return;
    const next = { ...input, operationId: crypto.randomUUID(), expectedTargetRevision: detail.control?.targetRevision ?? 0 };
    try { journal.value.remember(next); journal.value.settle(input.operationId); updatePending(); await submit(next); }
    catch (error) { setError(personalRetentionError(error)); }
  }
  const operationPanel = (values: CandidateControlInput[]) => values.length > 0 && <section className="pr-note pr-warning" aria-label="待核对候选操作"><h3>原操作待核对</h3>{values.map(input => <div className="ac-pending" key={input.operationId}><strong>{actionNames[input.action]}</strong><p className="pr-footnote"><code>{input.operationId}</code></p><details><summary>原意图与精确目标</summary><pre>{JSON.stringify(input, null, 2)}</pre></details><div className="pr-row"><button type="button" className="secondary-button" disabled={busy} onClick={() => { void inspect(input); }}>回查原操作</button>{pendingStates[input.operationId] === 'not-found' && <button type="button" className="secondary-button" disabled={busy} onClick={() => { void submit(input); }}>明确同请求重试</button>}{pendingStates[input.operationId] === 'conflict' && detail?.ref && personalJsonIdentity(detail.ref) === personalJsonIdentity(input.target) && <button type="button" className="secondary-button" disabled={busy || !candidateActionAvailability(detail, controlsAvailable)[input.action]} onClick={() => { void reissue(input); }}>按当前版本重新发起同一意图</button>}</div></div>)}</section>;
  const availability = detail ? candidateActionAvailability(detail, controlsAvailable) : null;
  const detailPending = detail?.ref ? pending.filter(value => personalJsonIdentity(value.target) === personalJsonIdentity(detail.ref)) : [];
  const actionsDisabled = busy || detailPending.length > 0;
  return <section className="ac-panel" aria-labelledby={`${id}-heading`}>
    <h2 ref={titleRef} tabIndex={-1} id={`${id}-heading`}>Agent 候选</h2>
    <p className="pr-footnote">已保存的有效候选跨父任务状态与保存路径汇总；浏览不自动送入新任务。Agent 可按需自主查读，你也可自愿指定准确资料。</p>
    <section className="pr-panel pr-findbar" aria-label="候选查找">{!search && <form onSubmit={event => { event.preventDefault(); setFilters(previous => ({ ...previous, query })); }}><div className="pr-search-row"><label className="pr-search"><span>查找 Agent 候选</span><input type="search" value={query} maxLength={200} autoComplete="off" placeholder="标题、别名或适用范围关键词" onChange={event => setQuery(event.target.value)} /></label><button type="submit" className="primary-button">查找候选</button><button type="button" className="secondary-button" onClick={() => { setQuery(''); setFilters(previous => ({ ...previous, query: '' })); }}>清空</button></div><div className="pr-filter-row ac-filters"><label className="ac-checkbox"><input type="checkbox" checked={Boolean(filters.includeBody)} onChange={event => setFilters(previous => ({ ...previous, includeBody: event.target.checked }))} />含正文关键词</label><label><span>父任务状态</span><select value={filters.parentState} onChange={event => setFilters(previous => ({ ...previous, parentState: event.target.value as CandidateLookupInput['parentState'] }))}><option value="all">全部状态</option>{Object.entries(parentNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>已保存路径</span><select value={filters.savedPath} onChange={event => setFilters(previous => ({ ...previous, savedPath: event.target.value as CandidateLookupInput['savedPath'] }))}><option value="all">全部保存路径</option><option value="current">任务当前保存路径</option><option value="other">其它已保存路径</option></select></label></div></form>}{search && <div className="pr-filter-row ac-filters"><label><span>父任务状态</span><select value={filters.parentState} onChange={event => setFilters(previous => ({ ...previous, parentState: event.target.value as CandidateLookupInput['parentState'] }))}><option value="all">全部状态</option>{Object.entries(parentNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>已保存路径</span><select value={filters.savedPath} onChange={event => setFilters(previous => ({ ...previous, savedPath: event.target.value as CandidateLookupInput['savedPath'] }))}><option value="all">全部保存路径</option><option value="current">任务当前保存路径</option><option value="other">其它已保存路径</option></select></label></div>}{!search && <div className="pr-tabs" role="group" aria-label="候选类别">{([['all', '全部'], ['knowledge', '知识'], ['experience', '经验']] as const).map(([category, label]) => <button type="button" key={category} aria-pressed={filters.category === category} onClick={() => setFilters(previous => ({ ...previous, category }))}>{label}</button>)}</div>}</section>
    {journalError && <p className="pr-note pr-warning" role="alert">{journalError}</p>}
    {error && <p className="error-notice" role="alert">{error}</p>}{notice && <p className="pr-note" role="status">{notice}</p>}
    {operationPanel(pending)}
    <div className="pr-results-head"><span aria-live="polite">{loading ? '正在精确读取原生候选…' : result ? `本次读取 ${result.rows.length} 条可列引用` : '读取未完成 · UNKNOWN'}</span><button type="button" className="text-button" disabled={busy || loading} onClick={() => { void refresh(); }}>明确刷新候选</button></div>
    <div aria-busy={loading || undefined}>{result && <AgentCandidateResults result={result} onOpen={row => { void open(row); }} currentTaskLabel={currentTaskLabel} onUse={onUse ? row => { void useCandidate(row); } : undefined} onOther={onOther ? row => { void useCandidate(row, true); } : undefined} />}{!result && !loading && <p className="pr-note pr-warning">原生候选未能读取，不能判断为空。原文件与人的记录保持。</p>}{loading && <p role="status" className="pr-footnote">只读核对已保存路径，不启动 Agent 或模型。</p>}</div>
    {result?.nextCursor && <nav className="pr-pagination" aria-label="候选分批读取"><span className="pr-footnote">本次范围尚未读完</span><button type="button" className="secondary-button" disabled={loading} onClick={() => { void refresh(result.nextCursor ?? undefined); }}>继续读取下一批</button></nav>}
    {result && !result.controlsAvailable && <p className="pr-note pr-warning">人的操作记录暂不可用；候选可只读，当前不能新增收藏、注记或排除。</p>}
    {active && detail && <PersonalDialog drawer title={detail.status === 'available' && detail.details ? detail.details.content.title : detail.status === 'anomaly' ? '异常历史引用' : '原生候选 · UNKNOWN'} subtitle="Agent 声明与人的意见分开，保存路径不是实时模型上下文" busy={busy} returnFocus={detailTrigger.current} fallbackFocus={titleRef.current} onClose={() => { ++detailEpoch.current; setDetail(null); }} footer={detail.status !== 'anomaly' && <><div className="pr-row">{detail.status === 'available' && detail.ref && !detail.control?.excluded && <>{currentTaskLabel && onUse && <button type="button" className="primary-button" disabled={busy} onClick={() => { void useCandidate(detail); }}>加入当前任务 · {currentTaskLabel}</button>}{onOther && <button type="button" className="secondary-button" disabled={busy} onClick={() => { void useCandidate(detail, true); }}>{currentTaskLabel ? '选择其他任务' : '选择任务并加入'}</button>}</>}{onOrganize && result?.experienceLearningAvailable !== false && detail.status === 'available' && !detail.control?.excluded && <button type="button" className="secondary-button" disabled={busy} onClick={() => { void organizeCandidate(); }}>整理为个人经验</button>}<button type="button" className="primary-button" disabled={actionsDisabled || !(detail.control?.bookmarked ? availability?.unbookmark : availability?.bookmark)} onClick={() => { void act(detail.control?.bookmarked ? 'unbookmark' : 'bookmark'); }}>{detail.control?.bookmarked ? '取消重点收藏' : '重点收藏'}</button><button type="button" className="secondary-button" disabled={actionsDisabled || !availability?.correct} onClick={() => { setCorrecting(true); setTried(false); }}>补充纠正意见</button><button type="button" className="secondary-button" disabled={actionsDisabled || !(detail.control?.excluded ? availability?.restore : availability?.exclude)} onClick={() => { void act(detail.control?.excluded ? 'restore' : 'exclude'); }}>{detail.control?.excluded ? '恢复此条' : '排除此条'}</button><button type="button" className="text-button" disabled={busy} onClick={() => { void readCurrent(detail); }}>回查原生记录</button></div><p className="pr-footnote">{detail.status === 'unknown' ? detail.control?.targetRevision ? '已有人的准确目标记录，可取消收藏、排除／恢复；原生仍 UNKNOWN，新收藏及纠正不可用。' : '尚无人的有效目标记录，仅能阅读 UNKNOWN 引用，不能新增操作。' : '这些操作不改 Agent 原文，不证明正确，也不自动送给新任务。'}</p></>}>
      {error && <p className="pr-note pr-warning" role="alert">{error}</p>}{notice && <p className="pr-note" role="status">{notice}</p>}{operationPanel(detailPending)}
      <AgentCandidateContent row={detail} onReadSource={onReadSource} onOpenProject={onOpenProject} />
      {correcting && detail.status === 'available' && <form className="pr-section" onSubmit={event => { event.preventDefault(); void act('correct'); }}><h3>补充纠正意见</h3><p className="pr-footnote">独立追加，不覆盖 Agent 原文或旧意见；当前不自动送入新任务。</p><label className="ac-note-label" htmlFor={`${id}-note`}>你的意见</label><textarea ref={noteRef} id={`${id}-note`} value={note} rows={5} maxLength={4000} required aria-invalid={tried && !note.trim() || undefined} aria-describedby={`${id}-note-help`} onChange={event => setNote(event.target.value)} /><p id={`${id}-note-help`} className={tried && !note.trim() ? 'pr-caution' : 'pr-footnote'}>{tried && !note.trim() ? '请填写意见，原输入保持。' : '最多 4,000 个 UTF-16 字符；无需逐条维护候选。'}</p><div className="pr-row"><button type="submit" className="primary-button" disabled={actionsDisabled || !availability?.correct}>追加意见</button><button type="button" className="text-button" disabled={busy} onClick={() => setCorrecting(false)}>收起意见输入</button></div></form>}
    </PersonalDialog>}
  </section>;
}
