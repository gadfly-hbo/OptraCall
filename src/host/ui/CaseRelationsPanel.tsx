import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { CaseDecisionRef } from '../case-decision-types.ts';
import type { CaseRecord } from '../case-types.ts';
import { CaseDialog, CaseFormError, caseDate, caseError } from './CaseDialogs.tsx';
import { settledCaseRelation } from './case-star-map-recovery.ts';
import { SourceBody } from './CaseDecisionsPanel.tsx';
import { readCaseDecisions } from './case-decisions-client.ts';
import * as api from './case-relations-client.ts';
import type { CaseRelationRevision, CaseRelationWrite, CaseRelationSource, CaseRelationExact, CaseRelationSourceOption } from './case-relations-client.ts';

export type CaseRelationDraft = { toCaseId: string; relationId?: string; input: CaseRelationWrite };
type PendingRelation = CaseRelationDraft & { reason: 'unknown' | 'conflict'; queried: boolean };
export type CaseRelationUiState = { selected: { toCaseId: string; relationId: string } | null; draft: CaseRelationDraft | null; editorOpen: boolean; pending: PendingRelation | null };
export const initialCaseRelationUi = (): CaseRelationUiState => ({ selected: null, draft: null, editorOpen: false, pending: null });
export const caseRelationName = (kind: string) => kind === 'supports' ? '支持' : '前后续';
const sourceKey = (source: CaseRelationSource) => JSON.stringify(source);
const sourceIdentity = (source: CaseRelationSource | CaseDecisionRef) => source.type === 'case-decision' ? `Case ${source.caseId} / ${source.recordId} / v${source.revision}` : source.type === 'case-choice' ? `Case ${source.caseId} / 取舍 ${source.choiceId}` : `Case ${source.caseId} / 产物 ${source.artifactId} / SHA-256 ${source.observedSha256 ?? '观察版本未知'}`;
export function createCaseRelationDraft(caseStoreId: string, cases: CaseRecord[], toCaseId?: string): CaseRelationDraft {
  const owner = cases.find(record => record.id === toCaseId && record.status !== 'closed') ?? cases.find(record => record.status !== 'closed');
  return { toCaseId: owner?.id ?? '', input: { operationId: crypto.randomUUID(), caseStoreId, fromCaseId: (cases.find(record => record.id === toCaseId && record.id !== owner?.id) ?? cases.find(record => record.id !== owner?.id))?.id ?? '', kind: 'follows_up', expectedRelationRevision: 0, explanation: '', targetScope: '', targetRef: null, sources: [], assertionNature: 'explicit', changeReason: null } };
}
const draftFrom = (revision: CaseRelationRevision): CaseRelationDraft => ({ toCaseId: revision.toCaseId, relationId: revision.relationId, input: { operationId: crypto.randomUUID(), caseStoreId: revision.caseStoreId, fromCaseId: revision.fromCaseId, kind: revision.kind, expectedRelationRevision: revision.revision, explanation: revision.explanation, targetScope: revision.targetScope, targetRef: revision.targetRef, sources: revision.sources, assertionNature: revision.assertionNature, changeReason: null } });


type Props = {
  cases: CaseRecord[]; caseStoreId: string; writingEnabled: boolean; ui: CaseRelationUiState;
  onUiChange: (update: (previous: CaseRelationUiState) => CaseRelationUiState) => void;
  onChange: (revision: CaseRelationRevision) => void; onOpenCase: (record: CaseRecord) => void;
};
export function CaseRelationsPanel({ cases, caseStoreId, writingEnabled, ui, onUiChange, onChange, onOpenCase }: Props) {
  const [detail, setDetail] = useState<CaseRelationExact | null>(null), [detailError, setDetailError] = useState(''), [detailLoading, setDetailLoading] = useState(false), [viewRevision, setViewRevision] = useState<number>();
  const [history, setHistory] = useState<CaseRelationRevision[]>([]), [historyCursor, setHistoryCursor] = useState<string | null>(null), [historyOpen, setHistoryOpen] = useState(false), [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState('');
  const [posting, setPosting] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const focusAfterSave = useRef(false), relationHeading = useRef<HTMLParagraphElement>(null);
  const detailEpoch = useRef(0), ownerEpoch = useRef(0), uiRef = useRef(ui); uiRef.current = ui;
  useEffect(() => { if (ui.editorOpen && ui.draft && !ui.draft.relationId && !ui.pending) { setNotice(''); setError(''); } }, [ui.editorOpen]);
  const selectedKey = ui.selected ? `${ui.selected.toCaseId}/${ui.selected.relationId}` : '';
  const readDetail = async (revision?: number) => {
    const selected = uiRef.current.selected; if (!selected) return;
    const epoch = ++detailEpoch.current; setDetailLoading(true); setDetailError('');
    try { const value = await api.readCaseRelation(selected.toCaseId, selected.relationId, revision); if (epoch === detailEpoch.current) { setDetail(value); setViewRevision(revision); } }
    catch (failure) { if (epoch === detailEpoch.current) setDetailError(caseError(failure)); }
    finally { if (epoch === detailEpoch.current) setDetailLoading(false); }
  };
  useEffect(() => { ownerEpoch.current++; setDetail(null); setViewRevision(undefined); setHistory([]); setHistoryCursor(null); setHistoryOpen(false); setHistoryError(''); if (ui.selected) void readDetail(); return () => { detailEpoch.current++; }; }, [selectedKey]);
  const loadHistory = async (continuation?: string | null) => {
    const selected = uiRef.current.selected; if (!selected) return;
    const epoch = ownerEpoch.current; setHistoryLoading(true); setHistoryError('');
    try { const result = await api.readCaseRelationHistory(selected.toCaseId, selected.relationId, continuation); if (epoch === ownerEpoch.current) { setHistory(previous => continuation ? [...previous, ...result.items] : result.items); setHistoryCursor(result.continuation); setHistoryOpen(true); } }
    catch (failure) { if (epoch === ownerEpoch.current) setHistoryError(caseError(failure)); }
    finally { if (epoch === ownerEpoch.current) setHistoryLoading(false); }
  };
  useEffect(() => { if (focusAfterSave.current && ui.selected && !ui.editorOpen && !posting && !detailLoading && detail) { const close = relationHeading.current?.closest('dialog')?.querySelector<HTMLButtonElement>('.case-dialog-heading button'); if (close && !close.disabled) { close.focus({ preventScroll: true }); focusAfterSave.current = false; } } }, [posting, detailLoading, detail, ui.editorOpen, selectedKey]);
  const complete = (revision: CaseRelationRevision, operationId: string) => {
    focusAfterSave.current = true;
    onChange(revision); setNotice('关系已保存；旧修订、原 Case 和成果保留。'); setError('');
    onUiChange(previous => previous.pending?.input.operationId === operationId || previous.draft?.input.operationId === operationId ? { ...previous, pending: null, editorOpen: false, draft: null, selected: { toCaseId: revision.toCaseId, relationId: revision.relationId } } : previous);
    setViewRevision(undefined); if (uiRef.current.selected?.relationId === revision.relationId) void readDetail();
    setHistoryOpen(false); setHistory([]);
  };
  const perform = async (draft: CaseRelationDraft) => {
    if (posting) return; const operationId = draft.input.operationId; setPosting(true); setError(''); setNotice('');
    try { const result = await api.saveCaseRelation(draft.toCaseId, draft.input, draft.relationId); complete(result.revision, operationId); }
    catch (failure) {
      const status = failure instanceof api.CaseRelationRequestError ? failure.status : 0;
      setError(caseError(failure));
      if (status === 0 || status >= 500 || status === 409) onUiChange(previous => ({ ...previous, pending: { ...draft, reason: status === 409 ? 'conflict' : 'unknown', queried: false } }));
    } finally { setPosting(false); }
  };
  const queryOperation = async () => {
    const pending = uiRef.current.pending; if (!pending || posting) return; setPosting(true); setError('');
    try { const result = await api.readCaseRelationOperation(pending.toCaseId, pending.input.operationId), revision = settledCaseRelation(result.operation, pending); if (revision) complete(revision, pending.input.operationId); else { onUiChange(previous => previous.pending?.input.operationId === pending.input.operationId ? { ...previous, pending: { ...previous.pending, queried: true } } : previous); setNotice(result.operation ? '原操作尚未确认完成；保留原意图，不重新发送模型或换操作编号。' : '当前未读到原回执，不等于已证明未提交。保留原操作；可在核对后显式重试同一载荷。'); } }
    catch (failure) { setError(caseError(failure)); }
    finally { setPosting(false); }
  };
  const rebase = async () => {
    const pending = uiRef.current.pending; if (!pending || pending.reason !== 'conflict' || !pending.relationId) return; setPosting(true); setError('');
    try { const value = await api.readCaseRelation(pending.toCaseId, pending.relationId); setDetail(value); if (value.revision.restricted) { setError('关系来源范围已变化，当前只读；原草稿仍保留。'); return; } const input = pending.input.action && pending.input.action !== 'save' ? { ...draftFrom(value.revision).input, action: pending.input.action } : { ...pending.input, operationId: crypto.randomUUID(), expectedRelationRevision: value.current.revision }; onUiChange(previous => ({ ...previous, pending: null, editorOpen: true, draft: { ...pending, input } })); setNotice(`已读取当前 v${value.current.revision}；保留你的草稿。请核对当前内容后再保存，此操作不会自动提交。`); }
    catch (failure) { setError(caseError(failure)); }
    finally { setPosting(false); }
  };
  const current = detail?.revision, targetCase = cases.find(record => record.id === current?.toCaseId), readOnly = !writingEnabled || !targetCase || targetCase.status === 'closed' || Boolean(current?.restricted);
  const closeSelected = () => { if (!posting) onUiChange(previous => ({ ...previous, selected: null })); };
  const edit = () => { if (!current || readOnly || ui.pending) return; onUiChange(previous => ({ ...previous, draft: previous.draft ?? { ...draftFrom(current), input: { ...draftFrom(current).input, assertionNature: 'explicit' } }, editorOpen: true })); if (ui.draft) setNotice('先继续或明确放弃保留的草稿，再发起另一项修改。'); setError(''); };
  const changeLifecycle = (action: 'unlink' | 'restore') => {
    if (!current || readOnly || ui.pending) return; if (ui.draft) { onUiChange(previous => ({ ...previous, editorOpen: true })); setNotice('已有保留的草稿，请先继续或明确放弃，再改变关系状态。'); return; } const draft = draftFrom(current); draft.input.action = action;
    onUiChange(previous => ({ ...previous, draft })); void perform(draft);
  };
  const recovery = <>{error && <CaseFormError error={error} />}{notice && <p className="case-notice" role="status">{notice}</p>}{ui.pending && <section className="csm-draft-recovery" aria-label="待核对的关系保存"><strong>{ui.pending.reason === 'unknown' ? '保存结果未知，原意图已保留' : '关系保存遇到冲突，草稿已保留'}</strong><p className="csm-identity">原操作：{ui.pending.input.operationId}</p><p>不换操作编号盲目重试，不重放模型。先查询原回执。</p><div className="case-inline-actions"><button type="button" className="secondary-button" disabled={posting} onClick={() => { void queryOperation(); }}>核对原操作</button>{ui.pending.reason === 'unknown' && ui.pending.queried && <button type="button" className="text-button" disabled={posting} onClick={() => { void perform(ui.pending!); }}>以原操作和载荷重试</button>}{ui.pending.reason === 'conflict' && <button type="button" className="text-button" disabled={posting} onClick={() => { onUiChange(previous => ({ ...previous, pending: null, draft: null, editorOpen: false })); setError(''); setNotice('已放弃本次未保存草稿；原关系、修订和操作记录仍保留。'); }}>放弃本次未保存草稿</button>}{ui.pending.reason === 'conflict' && ui.pending.relationId && <button type="button" className="text-button" disabled={posting} onClick={() => { void rebase(); }}>读取当前版本并保留草稿</button>}</div></section>}</>;
  return <>
    {!ui.selected && !ui.editorOpen && recovery}
    {ui.draft && !ui.editorOpen && !ui.pending && <section className="csm-draft-recovery"><strong>保留的关系草稿</strong><p>说明与准确来源仍保留，尚未自动保存。</p><button type="button" className="text-button" onClick={() => onUiChange(previous => ({ ...previous, editorOpen: true }))}>继续编辑关系草稿</button><button type="button" className="text-button" onClick={() => onUiChange(previous => ({ ...previous, draft: null }))}>放弃此草稿</button></section>}
    {ui.selected && <CaseDialog title={current ? caseRelationName(current.kind) : 'Case 关系'} subtitle={current ? `${current.lifecycle === 'unlinked' ? '已解除 · 历史保留' : '当前关系'} · v${current.revision}` : undefined} className="csm-relation-dialog" busy={posting} onClose={closeSelected}>
      {detailLoading && <p role="status" className="case-help">正在读取准确关系与来源…</p>}<CaseFormError error={detailError} />{detailError && <button type="button" className="text-button" onClick={() => { void readDetail(viewRevision); }}>重新读取准确关系</button>}
      {!ui.editorOpen && recovery}
      {current && <><p ref={relationHeading} className="csm-inline-scope"><button type="button" className="text-button" onClick={() => { const record = cases.find(record => record.id === current.fromCaseId); if (record) onOpenCase(record); }}>{cases.find(record => record.id === current.fromCaseId)?.title ?? '原 Case 暂不可用'}</button> — {caseRelationName(current.kind)} → <button type="button" className="text-button" onClick={() => { if (targetCase) onOpenCase(targetCase); }}>{targetCase?.title ?? '目标 Case 暂不可用'}</button></p>
        <h3>关系说明</h3><p className="csm-inline-scope">{current.explanation}</p>
        <dl><dt>声明者</dt><dd>{current.origin.actorKind === 'agent' ? 'Agent' : '用户'}</dd><dt>声明性质</dt><dd>{current.assertionNature === 'inferred' ? '推断／待核' : '明确关系声明'}</dd><dt>维护归属</dt><dd>目标 Case：{targetCase?.title ?? current.toCaseId}{readOnly ? ' · 当前只读' : ''}</dd><dt>记录时间</dt><dd>{caseDate(current.createdAt)}（系统留存时间）</dd></dl>
        {detail && current.revision !== detail.current.revision && <p className="case-message">这是一条准确历史修订，当前关系已有 v{detail.current.revision}。<button type="button" className="text-button" onClick={() => { void readDetail(); }}>查看当前关系</button></p>}
        <h3 className="csm-source-title">{current.kind === 'supports' ? '支持目标' : '承接目标'}</h3><div className="csm-source">{current.targetScope || '目标 Case 的后续工作'}{current.targetRef ? <p className="case-help">引用准确版本 v{current.targetRef.revision}</p> : current.kind === 'supports' ? <p className="case-help">尚未绑定具体卡片</p> : null}{detail?.target && <SourceView source={detail.target} />}</div>
        <h3 className="csm-source-title">准确依据</h3>{detail?.sources.map((source, index) => <SourceView source={source} key={`${sourceIdentity(source.ref)}/${index}`} />)}{!current.sources.length && <p className="case-help">依据为声明本身，未附外部资料。准确入口为此关系 v{current.revision} 与原操作；不将说明文字当成独立证据。</p>}
        <details><summary>声明入口与原操作</summary><p className="csm-identity">关系 {current.relationId} / v{current.revision}<br />操作 {current.operationId}<br />来源任务 {current.origin.projectId ?? '未记录'} / {current.origin.taskId ?? '未记录'}<br />请求 {current.origin.requestId ?? '未记录'}<br />会话 {current.origin.sessionId ?? '未记录'} / 工具调用 {current.origin.toolCallId ?? '未记录'}</p></details>
        <p className="case-help">此关系为原作者的声明；关联存在不证明因果、已执行或效果有效。源 Case 结束不要求重开；关系修改由目标 Case 开放状态决定。</p>
        <div className="csm-relation-history-actions"><button type="button" className="text-button" disabled={historyLoading} onClick={() => { if (historyOpen) setHistoryOpen(false); else void loadHistory(); }}>{historyOpen ? '收起关系历史' : '查看关系历史'}</button>{!readOnly && current.revision === detail?.current.revision && !ui.pending && (current.lifecycle === 'active' ? <><button type="button" className="secondary-button" onClick={edit}>纠正关系</button><button type="button" className="text-button" onClick={() => changeLifecycle('unlink')}>解除当前关系</button></> : <button type="button" className="secondary-button" onClick={() => changeLifecycle('restore')}>恢复同一关系</button>)}</div>
        {current.restricted && <p className="case-message">关系来源范围已变化，内容受限；当前记录与历史只读。</p>}{readOnly && <p className="case-help">目标 Case 已结束、不可用或关系写入口关闭；当前关系和历史只读。</p>}
        <CaseFormError error={historyError} />{historyLoading && <p role="status">正在读取关系历史…</p>}{historyOpen && <section aria-label="关系修订历史">{history.map(item => <article className="csm-history-item" key={item.revision}><strong>v{item.revision} · {item.lifecycle === 'unlinked' ? '已解除' : '有效'} · {item.origin.actorKind === 'agent' ? 'Agent' : '用户'} · {item.assertionNature === 'inferred' ? '推断／待核' : '明确声明'}</strong><p>{item.explanation}</p><p>目标：{item.targetScope || '后续工作'}{item.targetRef ? ` / ${sourceIdentity(item.targetRef)}` : item.kind === 'supports' ? '（尚未绑定具体卡片）' : ''}</p>{item.sources.map((source, index) => <p className="csm-identity" key={index}>{sourceIdentity(source)}</p>)}<p className="csm-identity">{caseDate(item.createdAt)} · {item.operationId}</p><button type="button" className="text-button" onClick={() => { void readDetail(item.revision); }}>查看这版准确依据</button></article>)}{historyCursor && <button type="button" className="text-button" disabled={historyLoading} onClick={() => { void loadHistory(historyCursor); }}>加载更多关系历史</button>}</section>}
      </>}
    </CaseDialog>}
    {ui.editorOpen && ui.draft && <RelationEditor cases={cases} caseStoreId={caseStoreId} draft={ui.draft} writingEnabled={writingEnabled} locked={posting || Boolean(ui.pending)} pending={Boolean(ui.pending)} onDraftChange={draft => onUiChange(previous => ({ ...previous, draft }))} onClose={() => { if (!posting) onUiChange(previous => ({ ...previous, editorOpen: false })); }} onSave={() => { if (uiRef.current.draft) void perform(uiRef.current.draft); }} recovery={recovery} />}
  </>;
}

function SourceView({ source }: { source: api.CaseRelationSourceView }) {
  return <div className="csm-source"><strong>{source.title}</strong><SourceBody value={{ text: source.text, target: source.ref }} showTitle={false} /><details><summary>准确引用与原声明入口</summary><p className="csm-identity">{sourceIdentity(source.ref)}</p>{source.ref.type !== 'case-artifact' && source.text && <pre className="cd-source-text">{source.text}</pre>}</details>{source.status !== 'available' && <p className="case-help">来源状态：{source.status === 'changed' ? '已变化' : source.status === 'restricted' ? '当前受限' : '尚未确认'}</p>}{source.currentRevision !== undefined && <p className="case-help">当前来源头版本 v{source.currentRevision}；本关系仍保留所引用的准确版。</p>}{source.limitations.map((limitation, index) => <p className="case-help" key={index}>{limitation}</p>)}</div>;
}

function RelationEditor({ cases, caseStoreId, draft, writingEnabled, locked, pending, onDraftChange, onClose, onSave, recovery }: {
  cases: CaseRecord[]; caseStoreId: string; draft: CaseRelationDraft; writingEnabled: boolean; locked: boolean; pending: boolean;
  onDraftChange: (draft: CaseRelationDraft) => void; onClose: () => void; onSave: () => void; recovery: ReactNode;
}) {
  const id = useId(), [sources, setSources] = useState<CaseRelationSourceOption[]>([]), [sourceCursor, setSourceCursor] = useState<string | null>(null), [sourceLoading, setSourceLoading] = useState(false), [sourceError, setSourceError] = useState('');
  const [targets, setTargets] = useState<{ ref: CaseDecisionRef; title: string }[]>([]), [targetCursor, setTargetCursor] = useState<string | null>(null), [targetError, setTargetError] = useState(''), [targetLoading, setTargetLoading] = useState(false), [validation, setValidation] = useState('');
  const sourceEpoch = useRef(0), targetEpoch = useRef(0), targetClosed = cases.find(record => record.id === draft.toCaseId)?.status === 'closed', input = draft.input;
  const loadSources = async (continuation?: string | null) => {
    if (!input.fromCaseId) return; const epoch = sourceEpoch.current; setSourceLoading(true); setSourceError('');
    try { const result = await api.readCaseRelationSources(input.fromCaseId, continuation); if (epoch === sourceEpoch.current) { setSources(previous => continuation ? [...previous, ...result.items] : result.items); setSourceCursor(result.continuation); } }
    catch (failure) { if (epoch === sourceEpoch.current) setSourceError(caseError(failure)); }
    finally { if (epoch === sourceEpoch.current) setSourceLoading(false); }
  };
  const loadTargets = async (continuation?: string | null) => {
    if (!draft.toCaseId) return; const epoch = targetEpoch.current; setTargetLoading(true); setTargetError('');
    try { const result = await readCaseDecisions(draft.toCaseId, { includeArchived: false, pageSize: 50, continuation }); if (epoch === targetEpoch.current) { const items = result.items.map(record => ({ title: `${record.payload.title} · v${record.revision}`, ref: { type: 'case-decision' as const, caseStoreId: record.caseStoreId, caseId: record.caseId, recordId: record.recordId, revision: record.revision } })); setTargets(previous => continuation ? [...previous, ...items] : items); setTargetCursor(result.continuation); } }
    catch (failure) { if (epoch === targetEpoch.current) setTargetError(caseError(failure)); }
    finally { if (epoch === targetEpoch.current) setTargetLoading(false); }
  };
  useEffect(() => { sourceEpoch.current++; setSources([]); setSourceCursor(null); if (input.fromCaseId) void loadSources(); return () => { sourceEpoch.current++; }; }, [input.fromCaseId]);
  useEffect(() => { targetEpoch.current++; setTargets([]); setTargetCursor(null); if (draft.toCaseId && input.kind === 'supports') void loadTargets(); return () => { targetEpoch.current++; }; }, [draft.toCaseId, input.kind]);
  const changeInput = (patch: Partial<CaseRelationWrite>) => { if (!locked) onDraftChange({ ...draft, input: { ...input, ...patch, operationId: crypto.randomUUID() } }); };
  const lifecycle = input.action === 'unlink' || input.action === 'restore', actionLabel = input.action === 'unlink' ? '解除当前关系' : input.action === 'restore' ? '恢复同一关系' : '保存关系';
  return <CaseDialog title={lifecycle ? actionLabel : draft.relationId ? '纠正关系 · 另存新修订' : '补充 Case 关系'} subtitle="关系由目标 Case 维护；源 Case 的历史可只读引用。" className="csm-relation-dialog" busy={locked && !pending} onClose={onClose}>
    {recovery}<CaseFormError error={validation} /><form className="csm-relation-editor" onSubmit={event => { event.preventDefault(); setValidation(''); if (!draft.toCaseId || !input.fromCaseId || draft.toCaseId === input.fromCaseId) { setValidation('请选择不同的来源与目标 Case。'); return; } if (!input.explanation.trim()) { setValidation('请说明这两个 Case 的具体联系。'); return; } if (input.kind === 'supports' && (!(input.sources?.length) || !input.targetScope.trim())) { setValidation('支持关系需要准确来源和具体的支持目标范围。'); return; } onSave(); }}>
      <label htmlFor={`${id}-from`}>来源 Case<select id={`${id}-from`} value={input.fromCaseId} disabled={locked || Boolean(draft.relationId)} onChange={event => changeInput({ fromCaseId: event.target.value, sources: [] })}><option value="">选择来源 Case</option>{cases.map(record => <option key={record.id} value={record.id}>{record.title}{record.status === 'closed' ? '（已结束，可引用历史）' : ''}</option>)}</select></label>
      <label htmlFor={`${id}-to`}>目标 Case<select id={`${id}-to`} value={draft.toCaseId} disabled={locked || Boolean(draft.relationId)} onChange={event => { if (!locked) onDraftChange({ ...draft, toCaseId: event.target.value, input: { ...input, targetRef: null, operationId: crypto.randomUUID() } }); }}><option value="">选择目标 Case</option>{cases.map(record => <option key={record.id} value={record.id} disabled={record.status === 'closed'}>{record.title}{record.status === 'closed' ? '（已结束，只读）' : ''}</option>)}</select></label>
      <label htmlFor={`${id}-kind`}>关系类型<select id={`${id}-kind`} value={input.kind} disabled={locked || Boolean(draft.relationId)} onChange={event => changeInput({ kind: event.target.value as CaseRelationWrite['kind'], targetRef: null })}><option value="follows_up">前后续 · 来源引出目标</option><option value="supports">支持 · 来源为目标提供依据</option></select></label>
      <label htmlFor={`${id}-explanation`}>关系说明<textarea id={`${id}-explanation`} maxLength={4000} required value={input.explanation} disabled={locked || lifecycle} onChange={event => changeInput({ explanation: event.target.value })} /></label>
      {input.kind === 'supports' && <><label htmlFor={`${id}-scope`}>具体支持范围<textarea id={`${id}-scope`} maxLength={4000} required value={input.targetScope} disabled={locked || lifecycle} onChange={event => changeInput({ targetScope: event.target.value })} /></label><label htmlFor={`${id}-target`}>准确目标卡片（可选）<select id={`${id}-target`} disabled={locked || lifecycle || targetLoading} value={input.targetRef ? JSON.stringify(input.targetRef) : ''} onChange={event => changeInput({ targetRef: event.target.value ? JSON.parse(event.target.value) as CaseDecisionRef : null })}><option value="">尚未绑定具体卡片，按上方范围说明</option>{input.targetRef && !targets.some(target => JSON.stringify(target.ref) === JSON.stringify(input.targetRef)) && <option value={JSON.stringify(input.targetRef)}>{sourceIdentity(input.targetRef)}（原准确引用）</option>}{targets.map(target => <option key={JSON.stringify(target.ref)} value={JSON.stringify(target.ref)}>{target.title}</option>)}</select></label><CaseFormError error={targetError} />{targetError && <button type="button" className="text-button" disabled={locked || lifecycle || targetLoading} onClick={() => { void loadTargets(); }}>重新读取目标卡片</button>}{targetCursor && <button type="button" className="text-button" disabled={locked || lifecycle || targetLoading} onClick={() => { void loadTargets(targetCursor); }}>加载更多准确目标</button>}</>}
      <fieldset disabled={locked || lifecycle}><legend>准确来源{input.kind === 'supports' ? '（至少一项）' : '（可选）'}</legend>{sourceLoading && <p role="status">正在读取来源目录…</p>}<CaseFormError error={sourceError} />{sourceError && <button type="button" className="text-button" onClick={() => { void loadSources(); }}>重新读取来源</button>}{!sourceLoading && !sourceError && !sources.length && <p className="case-help">本页尚无可选来源。前后续可依据这次明确声明；支持需要先取得准确判断或成果引用。</p>}{sources.map((source, index) => <label className="csm-source-choice" key={`${sourceKey(source.ref)}/${index}`}><input type="checkbox" checked={input.sources?.some(item => sourceKey(item) === sourceKey(source.ref)) ?? false} onChange={event => { const selected = input.sources ?? []; changeInput({ sources: event.target.checked ? [...selected, source.ref] : selected.filter(item => sourceKey(item) !== sourceKey(source.ref)) }); }} /><span>{source.title}<small className="csm-identity">{sourceIdentity(source.ref)}{source.status === 'unknown' ? ' · 正文尚未确认' : ''}</small></span></label>)}{input.sources?.filter(source => !sources.some(option => sourceKey(option.ref) === sourceKey(source))).map((source, index) => <label className="csm-source-choice" key={index}><input type="checkbox" checked onChange={() => changeInput({ sources: input.sources?.filter(item => sourceKey(item) !== sourceKey(source)) })} /><span>保留原准确来源<small className="csm-identity">{sourceIdentity(source)}</small></span></label>)}{sourceCursor && <button type="button" className="text-button" disabled={sourceLoading} onClick={() => { void loadSources(sourceCursor); }}>加载更多来源目录</button>}</fieldset>
      <p className="case-help">前后续未附外部资料时，依据为这次声明和原操作。支持关系不证明因果或效果。方向、端点或类型有误时，先解除旧关系，再补新关系，历史保持原位。</p>
      {!writingEnabled && <p className="case-message">当前版本关闭关系写入；已有记录仍可读取。</p>}{targetClosed && <p className="case-message">目标 Case 已结束，当前草稿保留；原重开入口恢复后再核对。</p>}{caseStoreId !== input.caseStoreId && <p className="case-message">本机记录身份已变化，不能把旧草稿写入另一份存储。</p>}
      <div className="csm-editor-actions"><button type="button" className="text-button" onClick={onClose} disabled={locked && !pending}>关闭并保留草稿</button><button type="submit" className="primary-button" disabled={locked || !writingEnabled || targetClosed || caseStoreId !== input.caseStoreId}>{actionLabel}</button></div>
    </form>
  </CaseDialog>;
}
