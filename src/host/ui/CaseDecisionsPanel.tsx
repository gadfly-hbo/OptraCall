import { useEffect, useId, useRef, useState } from 'react';
import type { CaseRecord } from '../case-types.ts';
import type { CaseDecisionList, CaseDecisionRevision, CaseDecisionReference, CaseHypothesisPayload, CaseStrategyPayload, CaseStrategyChoice, CaseStrategyChoiceValue, CaseStrategyChoiceInput } from '../case-decision-types.ts';
import type { CaseDecisionSourceView } from '../case-decision-service.ts';
import { readCaseDecisions, readCaseDecisionRevision, readCaseDecisionSource, readCaseDecisionLinks, saveCaseDecisionGovernance, saveCaseStrategyChoice } from './case-decisions-client.ts';
import type { CaseDecisionExact, CaseDecisionLinks, GovernanceRequest } from './case-decisions-client.ts';
import { CaseDialog, caseDate, caseError } from './CaseDialogs.tsx';
import { CaseRequestError, operation } from './case-client.ts';
import './case-decisions.css';

const assessmentLabels: Record<CaseHypothesisPayload['assessment'], string> = { unresolved: '待核', supported: '当前作者认为有支持', weakened: '当前作者认为被削弱', refuted: '当前作者撤回／反驳' };
const choiceLabels: Record<CaseStrategyChoiceValue, string> = { trial: '小范围试行', gather_evidence: '先补证', defer: '暂缓', reject: '不采用', no_action: '不行动／维持现状', continue: '继续', adjust: '调整', stop_considering: '不再考虑' };
type ChoiceRequest = Omit<CaseStrategyChoiceInput, 'caseId'>;
type PendingChoice = { input: ChoiceRequest; record: CaseDecisionRevision; error: string; uncertain: boolean; queried?: boolean; refreshed?: boolean };
type PendingGovernance = { record: CaseDecisionRevision; input: GovernanceRequest; error: string; uncertain: boolean; queried?: boolean };
export type CaseDecisionUiState = { pendingChoices: Record<string, PendingChoice>; choiceDrafts: Record<string, PendingChoice>; pendingGovernance: Record<string, PendingGovernance> };
export const emptyCaseDecisionUiState: CaseDecisionUiState = { pendingChoices: {}, choiceDrafts: {}, pendingGovernance: {} };
export type CaseDecisionUiUpdate = (previous: CaseDecisionUiState) => CaseDecisionUiState;
function DecisionSummary({ record, choice, disabled, readOnly, onChoice, pending, querying, onQuery, onMore, hasDraft, onDetail, onLink, governance, onGovernanceQuery, onRetry, onGovernanceRetry }: { record: CaseDecisionRevision; choice?: CaseStrategyChoice; disabled?: boolean; readOnly?: boolean; onChoice?: (value: CaseStrategyChoiceValue) => void; pending?: PendingChoice; querying?: boolean; onQuery?: () => void; onMore?: () => void; hasDraft?: boolean; onDetail?: () => void; onLink?: () => void; governance?: PendingGovernance; onGovernanceQuery?: () => void; onRetry?: () => void; onGovernanceRetry?: () => void }) {
  const hypothesis = record.kind === 'hypothesis' ? record.payload as CaseHypothesisPayload : null;
  const strategy = record.kind === 'strategy' ? record.payload as CaseStrategyPayload : null;
  return <article className="cd-record" data-record-id={record.recordId} data-revision={record.revision}>
    <div className="cd-record-meta"><span className="cd-version">{record.kind === 'hypothesis' ? '判断' : '方案'} · v{record.revision}{record.lifecycle === 'archived' ? ' · 已归档' : ''}</span><span>{record.origin.actorKind === 'agent' ? '作者：Agent · Case 草案' : '本次操作人：你 · 正文沿引用原稿'}</span></div>
    <h4>{record.payload.title}</h4><p className="cd-prose">{hypothesis?.statement ?? strategy?.proposal}</p>
    <p className="cd-meta">{hypothesis ? `${record.origin.actorKind === 'user' ? '沿原稿判断：' : ''}${assessmentLabels[hypothesis.assessment]}` : record.origin.actorKind === 'agent' ? 'Agent 方案草案' : '正文沿原方案稿（本次为人操作）'} · 不等于事实确认或人的选择</p>
    {(record.changeReason || record.revision > 1) && <p className="cd-change">变更说明：{record.changeReason || '作者未说明'}</p>}
    {strategy && <div className="cd-choice"><p>{choice ? `你的最近选择：${choiceLabels[choice.choice]} · v${choice.strategyRef.revision}` : '你的选择：尚未选择。未选择不等于拒绝。'}</p>{choice && choice.strategyRef.revision !== record.revision && <p>选择绑定旧版；当前版未选择。只提示版本不同，不判断原选择失效，也不要求重新选择。</p>}{choice?.reason && <p>理由：{choice.reason}</p>}</div>}
    {strategy && onChoice && <div className="cd-actions"><button type="button" className="primary-button" disabled={disabled} onClick={() => onChoice('trial')}>小范围试行</button><button type="button" className="secondary-button" disabled={disabled} onClick={() => onChoice('gather_evidence')}>先补证</button><button type="button" className="secondary-button" disabled={readOnly || querying} onClick={onMore}>更多选择</button>{hasDraft && <button type="button" className="text-button" onClick={onMore}>查看保留的取舍草稿</button>}</div>}
    {pending && !querying && <div className="case-message case-error" role="alert"><strong>取舍草稿已保留</strong><p>{choiceLabels[pending.input.choice]} · v{pending.input.strategyRef.revision}；{pending.error}</p><button type="button" className="secondary-button" disabled={querying} onClick={onQuery}>查询原保存结果</button>{pending.queried && <button type="button" className="secondary-button" disabled={querying || readOnly} onClick={onRetry}>重试原保存</button>}<details><summary>原操作记录</summary><p>{pending.input.operationId}</p></details></div>}
    {record.references.some(ref => ref.relation === 'action' || ref.relation === 'feedback') && <p className="cd-meta">保留原行动／准确反馈关系；原处当前状态另读，不以关联表示已执行或有效。</p>}
    {onDetail && <div className="cd-actions"><button type="button" className="secondary-button" onClick={onDetail}>来源与版本</button>{strategy && onLink && <button type="button" className="secondary-button" disabled={readOnly || querying || Boolean(governance?.uncertain)} onClick={onLink}>关联已有行动／反馈</button>}</div>}
    {governance && !querying && <div className="case-message case-error" role="alert"><strong>整理操作原意图已保留 · v{governance.input.expectedRevision}</strong><p>{governance.error}</p><button type="button" className="secondary-button" disabled={querying} onClick={onGovernanceQuery}>查询原整理结果</button>{governance.queried && <button type="button" className="secondary-button" disabled={querying || readOnly} onClick={onGovernanceRetry}>重试原整理</button>}<details><summary>原操作记录</summary><p>{governance.input.operationId}</p></details></div>}
    <p className="cd-meta">保存于 {caseDate(record.createdAt)}</p>
  </article>;
}
const relationLabels: Record<CaseDecisionReference['relation'], string> = { supports: '支持', opposes: '反对', background: '背景', limits: '限制', derived_from: '来源／沿用稿', depends_on: '依赖的判断', action: '原行动', feedback: '准确反馈' };
function sourceDescription(reference: CaseDecisionReference) {
  const target = reference.target;
  const identity = target.type === 'case-decision' ? `Case 记录 v${target.revision}` : target.type === 'rap' ? `RAP 发布 v${target.version}` : target.type === 'board-task' ? '原看板行动' : target.type === 'feedback' ? '指定反馈修订' : target.type === 'personal' ? '准确个人资料／候选' : '准确原资料';
  return `${relationLabels[reference.relation]} · ${identity}`;
}
function sourceObject(text: string | null): Record<string, unknown> | null { try { const value: unknown = JSON.parse(text ?? ''); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; } }
function ObservationScope({ observation }: { observation: Record<string, unknown> | null }) {
  return <section aria-label="原交接范围与材料性质"><h4>原交接范围与材料性质</h4><dl className="cd-data"><div><dt>材料性质</dt><dd>{observation?.sourceNature === 'synthetic' ? '合成／推演资料（原交接声明）' : observation?.sourceNature === 'actual' ? '实际业务资料（原交接声明）' : '未说明／未知'}</dd></div>{([['观察期', 'observationPeriod'], ['适用范围', 'applicability'], ['局限', 'limitations']] as const).map(([label, field]) => <div key={field}><dt>{label}</dt><dd>{typeof observation?.[field] === 'string' && observation[field] ? String(observation[field]) : '未记录／未知'}</dd></div>)}</dl><p className="case-help">这些字段来自指定原交接记录，不等于Host确认真实、适用或因果成立；未关联交接时保持未记录，不从反馈补造。</p></section>;
}
function SourceBody({ value }: { value: CaseDecisionSourceView }) {
  const parsed = sourceObject(value.text), payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload as Record<string, unknown> : null;
  const feedback = parsed?.feedback && typeof parsed.feedback === 'object' ? parsed.feedback as Record<string, unknown> : null;
  const task = parsed?.currentTask && typeof parsed.currentTask === 'object' ? parsed.currentTask as Record<string, unknown> : null;
  const observation = value.observation ?? (parsed?.observation && typeof parsed.observation === 'object' ? parsed.observation as Record<string, unknown> : null);
  const scope = value.target.type === 'feedback' ? <ObservationScope observation={observation} /> : null;
  if (value.text === null) return <>{scope}<p>准确正文暂不可读／UNKNOWN。保留原引用，不换用最新稿，也不据此推翻主张。</p></>;
  const fragment = value.partial || Boolean(value.range && (value.range.start > 0 || value.range.end < value.range.total));
  if (!fragment && payload && typeof payload.title === 'string') return <div><h4>{payload.title}</h4><p className="cd-prose">{typeof payload.statement === 'string' ? payload.statement : typeof payload.proposal === 'string' ? payload.proposal : '该记录正文格式未识别，请查看准确记录。'}</p></div>;
  if (!fragment && feedback) return <><dl className="cd-data"><div><dt>执行陈述</dt><dd>{feedback.adopted === true ? '记录为已按建议执行' : feedback.adopted === false ? '记录为未按建议执行' : '未知'}</dd></div><div><dt>实际观察</dt><dd>{typeof feedback.outcome === 'string' ? feedback.outcome : '未记录'}</dd></div><div><dt>指标变化</dt><dd>{typeof feedback.metricDelta === 'string' ? feedback.metricDelta : '未记录'}</dd></div><div><dt>复盘说明</dt><dd>{typeof feedback.review === 'string' ? feedback.review : '未记录'}</dd></div><div><dt>效果陈述</dt><dd>{feedback.effect === 'positive' ? '原反馈记录为正向，不等于因果成立' : feedback.effect === 'negative' ? '原反馈记录为负向，不等于因果成立' : feedback.effect === 'none' ? '原反馈记录为无变化' : '未知'}</dd></div></dl>{scope}</>;
  if (!fragment && task) return <dl className="cd-data"><div><dt>原处当前行动</dt><dd>{String(task.title ?? '未记录')}</dd></div><div><dt>当前状态</dt><dd>{task.status === 'done' ? '已完成' : task.status === 'doing' ? '进行中' : task.status === 'todo' ? '待开始' : '未知'}</dd></div><div><dt>原处责任人</dt><dd>{typeof task.owner === 'string' && task.owner ? task.owner : '未记录'}</dd></div><div><dt>原处时间</dt><dd>{typeof task.dueDate === 'string' && task.dueDate ? task.dueDate : '未记录'}</dd></div><div><dt>原处说明</dt><dd>{typeof task.note === 'string' && task.note ? task.note : '未记录'}</dd></div></dl>;
  return <>{scope}<pre className="cd-source-text">{value.text}</pre></>;
}
function DecisionDetails({ value, loading, error, readOnly, onClose, onHistory, onHistoricalChoice, busy, governance, onGovernance, onGovernanceQuery, onGovernanceRetry, onCurrent, onBoard }: { value: CaseDecisionExact; loading: boolean; error: string; readOnly: boolean; onClose: () => void; onHistory?: () => void; onHistoricalChoice: () => void; busy?: boolean; governance?: PendingGovernance; onGovernance: (action: GovernanceRequest['action'], reference?: CaseDecisionReference) => void; onGovernanceQuery: () => void; onGovernanceRetry: () => void; onCurrent: () => void; onBoard?: () => void }) {
  const [source, setSource] = useState<CaseDecisionSourceView | null>(null), [sourceLoading, setSourceLoading] = useState(false), [sourceError, setSourceError] = useState('');
  const epoch = useRef(0), alive = useRef(true);
  const sourceReference = useRef<CaseDecisionReference | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  const item = value.revision, proposal = item.kind === 'strategy' ? item.payload as CaseStrategyPayload : null;
  const readSource = async (reference: CaseDecisionReference, continuation?: string | null) => {
    const current = ++epoch.current; sourceReference.current = reference; setSourceLoading(true); setSourceError(''); if (!continuation) setSource(null);
    try { const result = await readCaseDecisionSource(item.caseId, reference.target, continuation); if (alive.current && epoch.current === current) setSource(result); }
    catch (caught) { if (alive.current && epoch.current === current) setSourceError(caseError(caught)); }
    finally { if (alive.current && epoch.current === current) setSourceLoading(false); }
  };
  const sourceCurrent = source?.current && typeof source.current === 'object' ? source.current as Record<string, unknown> : null;
  const exactCurrent = item.revision === value.current.revision;
  return <CaseDialog title="来源与版本" subtitle={`${item.payload.title} · v${item.revision}`} busy={busy} onClose={onClose}>
    {loading && <p className="case-help" role="status">正在核对这份准确修订与当前状态…</p>}{error && <p className="case-message case-error" role="alert">{error} 保留上次读取稿，不替换为最新。</p>}
    <p className="cd-meta">{item.origin.actorKind === 'agent' ? '正文作者：Agent' : '本次操作人：你；正文沿引用原稿，原作者可按准确来源回看。'}</p>
    <h3>{item.payload.title}</h3><p className="cd-prose">{item.kind === 'hypothesis' ? (item.payload as CaseHypothesisPayload).statement : proposal?.proposal}</p>
    <p className="case-help">查看的是 v{item.revision}；原处当前为 v{value.current.revision}{value.current.lifecycle === 'archived' ? '（已归档）' : ''}。版本变化不等于旧判断或选择失效。</p>
    <details className="cd-optional"><summary>{item.kind === 'strategy' ? '计划、条件与复核信息 · 可渐进补充' : '判断范围与未知'}</summary><dl className="cd-data">{Object.entries(proposal ? { 目标: proposal.goal, 机制: proposal.mechanism, 条件: proposal.conditions, 局限: proposal.limitations, '责任／授权范围': proposal.plan?.scopeAndAuthority, '实施／补证时间': proposal.plan?.implementationOrEvidenceTiming, '复核／提前条件': proposal.plan?.reviewAndTriggers, '预期观察／比较': proposal.plan?.expectedObservationsAndComparison, '风险／退出': proposal.plan?.risksAndExit } : { 范围: (item.payload as CaseHypothesisPayload).scope, 机制: (item.payload as CaseHypothesisPayload).mechanism, 未知: (item.payload as CaseHypothesisPayload).unknowns, '什么观察会改变判断': (item.payload as CaseHypothesisPayload).whatWouldChangeJudgement, 判断理由: (item.payload as CaseHypothesisPayload).assessmentReason }).map(([title, text]) => <div key={title}><dt>{title}</dt><dd>{text || '尚未记录／未知'}</dd></div>)}</dl><p className="case-help">计划是拟议说明，原行动的责任、时间和状态仍在原看板；日期不创建自动提醒。</p></details>
    {(item.changeReason || item.revision > 1) && <p className="cd-change">变更说明：{item.changeReason || '作者未说明'}</p>}
    {item.impactNotes.length > 0 && <section><h3>作者明确说明的影响</h3>{item.impactNotes.map((note, index) => <p className="cd-prose" key={index}>指向准确稿 v{note.target.revision}：{note.explanation}</p>)}</section>}
    <section className="cd-source-list"><h3>依据与准确关系</h3><p className="case-help">关系由作者声明；来源存在、当前可读与专业核验分别表达，不自动推断因果。</p>{item.references.length ? <ol>{item.references.map((reference, index) => <li key={index}><strong>{sourceDescription(reference)}</strong>{reference.note && <p>{reference.note}</p>}{reference.target.type === 'board-task' && reference.target.observation && <p>关联时：{reference.target.observation.title} · {reference.target.observation.status === 'doing' ? '进行中' : reference.target.observation.status === 'done' ? '已完成' : '待开始'}；当前状态另读。</p>}<div className="cd-actions"><button type="button" className="secondary-button" disabled={sourceLoading} onClick={() => { void readSource(reference); }}>读取准确来源 {index + 1}</button>{(reference.relation === 'action' || reference.relation === 'feedback') && <button type="button" className="text-button" disabled={readOnly || busy || !exactCurrent || value.current.lifecycle === 'archived' || Boolean(governance?.uncertain)} onClick={() => onGovernance('remove_reference', reference)}>解除这条关系</button>}</div><details><summary>准确引用身份</summary><pre className="cd-source-text">{JSON.stringify(reference.target, null, 2)}</pre></details></li>)}</ol> : <p className="case-help">本稿尚无来源关系，仍可保留有边界草案；没有引用不表示主张已被否定。</p>}</section>
    {sourceLoading && <p role="status" className="case-help">正在按准确引用读取…</p>}{sourceError && <p className="case-message case-error" role="alert">{sourceError} 保留原引用，未换用latest。</p>}
    {source && <section className="cd-source-body" aria-label="准确来源内容"><h3>{source.title}</h3><p className="case-help">{source.status === 'unknown' ? '当前准确正文未知／UNKNOWN' : source.status === 'disabled' ? '原资料当前已停用，准确内容与治理状态分开' : source.status === 'metadata' ? '当前仅有定位信息' : '准确来源可读'}</p>{source.range && <p className="case-help">本次范围 UTF-16 [{source.range.start}, {source.range.end}) / {source.range.total}{source.partial || source.range.start > 0 || source.range.end < source.range.total ? ' · 片段，未提供全文' : ''}</p>}<SourceBody value={source} />{source.target.type === 'feedback' && typeof sourceCurrent?.latestFeedbackRevisionId === 'string' && sourceCurrent.latestFeedbackRevisionId !== source.target.feedbackRevisionId && <p className="case-message">原处当前另有新反馈；本页仍保留所引用的准确反馈版，不自动替换。</p>}{source.limitations.map((text, index) => <p className="case-help" key={index}>{text}</p>)}{source.continuation && <button type="button" className="secondary-button" disabled={sourceLoading} onClick={() => { const ref = sourceReference.current; if (ref) void readSource(ref, source.continuation); }}>继续读取同一准确来源</button>}</section>}
    <div className="cd-actions">{onHistory && <button type="button" className="secondary-button" onClick={onHistory}>查看判断与方案历史</button>}{item.kind === 'strategy' && <button type="button" className="secondary-button" disabled={loading || Boolean(error) || readOnly || value.current.lifecycle === 'archived'} onClick={onHistoricalChoice}>{item.revision !== value.current.revision ? '按这版历史记录取舍' : '对这版方案作选择'}</button>}</div>
    <p className="case-help">正文纠正继续在原任务提问，由 Agent 自主另存；完整人工正文编辑器本期不增加。</p>
    <details className="cd-optional"><summary>整理这条记录</summary><p className="case-help">只有人明确归档／恢复；每次另存新修订，原正文、选择和行动保留，不判主张真假。当前只读不提供新写权限。</p>{!exactCurrent && <p className="case-help">正在看历史稿，整理须先核对当前准确稿。</p>}<div className="cd-actions">{!exactCurrent && <button type="button" className="secondary-button" disabled={busy || loading} onClick={onCurrent}>查看当前准确稿</button>}<button type="button" className="secondary-button" disabled={readOnly || busy || loading || Boolean(error) || !exactCurrent || Boolean(governance?.uncertain)} onClick={() => onGovernance(value.current.lifecycle === 'archived' ? 'restore' : 'archive')}>{value.current.lifecycle === 'archived' ? '恢复记录' : '归档记录'}</button></div></details>
    {governance && <div className="case-message case-error" role="alert"><strong>原整理操作保留</strong><p>{governance.error}</p><button type="button" className="secondary-button" disabled={busy} onClick={onGovernanceQuery}>查询原整理结果</button>{governance.queried && <button type="button" className="secondary-button" disabled={busy || readOnly} onClick={onGovernanceRetry}>重试原整理</button>}</div>}
    {onBoard && item.references.some(ref => ref.relation === 'action' || ref.relation === 'feedback') && <button type="button" className="text-button" onClick={onBoard}>去原看板查看／回录</button>}
  </CaseDialog>;
}
function LinkDialog({ target, onClose, onSave, busy, failure, onQuery, onRetry, readOnly, onBoard }: { target: CaseDecisionRevision; onClose: () => void; onSave: (reference: CaseDecisionReference) => void; busy: boolean; failure?: PendingGovernance; onQuery: () => void; onRetry: () => void; readOnly: boolean; onBoard?: () => void }) {
  const [data, setData] = useState<CaseDecisionLinks | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const epoch = useRef(0), id = useId();
  const load = async () => { const current = ++epoch.current; setLoading(true); setError(''); try { const value = await readCaseDecisionLinks(target.caseId); if (current === epoch.current) setData(value); } catch (caught) { if (current === epoch.current) setError(caseError(caught)); } finally { if (current === epoch.current) setLoading(false); } };
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [target.caseId]);
  return <CaseDialog title="关联原行动或反馈" subtitle={`${target.payload.title} · v${target.revision}`} busy={busy} onClose={onClose}><p className="case-help">只给这条方案追加准确关系的新稿；正文沿原稿，原看板的责任、时间、状态和反馈不改变。相同关系不重复加版。</p>{loading && <p className="case-help" role="status">正在读取原看板候选…</p>}{error && <div className="case-message case-error" role="alert"><p>{error} 读取失败不代表没有行动。</p><button type="button" className="secondary-button" onClick={() => { void load(); }}>重新读取原看板</button></div>}{data?.actions.map(action => <article className="cd-link-option" key={action.target.taskId}><h3>{action.title}</h3><p className="case-help">{action.projectName} · {action.itemTitle} · {action.status === 'doing' ? '进行中' : action.status === 'done' ? '已完成' : '待开始'}{action.projectArchived ? ' · 原项目已归档，只读' : ''}</p><p className="cd-meta">原责任人：{action.owner || '未记录'}；原时间：{action.dueDate || '未记录'}</p><button type="button" className="secondary-button" disabled={busy || readOnly || action.projectArchived || Boolean(failure?.uncertain)} onClick={() => onSave({ relation: 'action', target: action.target, note: null })} aria-label={`关联此行动 ${action.title}`}>关联此行动</button>{action.feedbackRevisions.length ? <details className="cd-optional"><summary>选择准确反馈修订 · {action.feedbackRevisions.length}版</summary><div className="cd-actions">{action.feedbackRevisions.map(feedback => <button type="button" className="secondary-button" disabled={busy || readOnly || action.projectArchived || Boolean(failure?.uncertain)} key={feedback.revisionId} onClick={() => onSave({ relation: 'feedback', target: { type: 'feedback', sourceProjectId: action.target.projectId, boardTaskId: action.target.taskId, feedbackRevisionId: feedback.revisionId }, note: null })}>关联反馈 v{feedback.revisionNumber}</button>)}</div><p className="case-help">原处最新为v{action.feedbackRevisions.at(-1)?.revisionNumber}。本次显式选择准确版本；未取得handoff时观察期／来源性质／适用范围仍未记录，不能从反馈补造。</p></details> : <p className="case-help">尚无原反馈，执行与效果不能据此判断。</p>}</article>)}{data && !loading && !error && !data.actions.length && <p className="case-help">当前关联项目尚无可关联的原行动；可以继续分析，无需先建行动。</p>}{failure && <div className="case-message case-error" role="alert"><p>{failure.error} 原目标v{failure.input.expectedRevision}及操作身份保留。</p><button type="button" className="secondary-button" disabled={busy} onClick={onQuery}>查询原整理结果</button>{failure.queried && <button type="button" className="secondary-button" disabled={busy || readOnly} onClick={onRetry}>重试原整理</button>}</div>}{onBoard && <button type="button" className="text-button" onClick={onBoard}>去原看板查看／回录</button>}<span id={id} className="case-help"> 本页关联不代表人的采纳、实际执行或因果成立。</span></CaseDialog>;
}
function ChoiceEditor({ draft, busy, current, onChange, onSave, onRefresh, onUseLatest, onQuery, onRetry, onClose, readOnly }: { draft: PendingChoice; busy: boolean; current?: CaseDecisionRevision; onChange: (field: 'choice' | 'reason', value: string) => void; onSave: () => void; onRefresh: () => void; onUseLatest: () => void; onQuery: () => void; onRetry: () => void; onClose: () => void; readOnly: boolean }) {
  return <CaseDialog title="对这版方案作选择" subtitle={`${draft.record.payload.title} · v${draft.input.strategyRef.revision}`} busy={busy} onClose={onClose}>
    <p className="cd-prose">{(draft.record.payload as CaseStrategyPayload).proposal}</p><p className="case-help">取舍绑定 v{draft.input.strategyRef.revision}，不自动改用当前稿；不修改原行动、反馈或派发经营动作。</p>
    <form onSubmit={event => { event.preventDefault(); onSave(); }}><div className="case-field"><label htmlFor="cd-choice-value">你的取舍</label><select id="cd-choice-value" value={draft.input.choice} disabled={busy || draft.uncertain} onChange={event => onChange('choice', event.target.value)}>{Object.entries(choiceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="case-field"><label htmlFor="cd-choice-reason">理由（可选）</label><textarea id="cd-choice-reason" rows={4} maxLength={4000} value={draft.input.reason ?? ''} disabled={busy || draft.uncertain} aria-describedby={draft.error ? 'cd-choice-error' : 'cd-choice-help'} onChange={event => onChange('reason', event.target.value)} /><p className="case-help" id="cd-choice-help">可以不填；未选择不等于拒绝，停止考虑不表示原行动已经停止。</p></div>
      {draft.error && <p className="case-message case-error" role="alert" id="cd-choice-error">{draft.error} 当前准确版本、取舍与理由保留。</p>}
      {readOnly && <p className="case-message">当前 Case／记录只读；可查看、复制保留的草稿和查询原操作，不能新增选择。</p>}
      {draft.uncertain && <p className="case-message">原操作结果尚未确认，先查询原保存结果；不会用新操作盲目重发。</p>}
      {draft.error && <div className="cd-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onRefresh}>保留草稿刷新记录</button><button type="button" className="secondary-button" disabled={busy} onClick={onQuery}>查询原保存结果</button>{draft.queried && <button type="button" className="secondary-button" disabled={busy || readOnly} onClick={onRetry}>重试原保存</button>}{draft.refreshed && current && current.lifecycle !== 'archived' && !draft.uncertain && <button type="button" className="text-button" disabled={busy || readOnly} onClick={onUseLatest}>按已查看的当前版另作选择</button>}</div>}
      {draft.refreshed && current && <p className="case-help">当前记录为 v{current.revision}{current.lifecycle === 'archived' ? '，已归档' : ''}；原取舍仍指 v{draft.input.strategyRef.revision}。只提示变化，不判旧选择失效。</p>}
      <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>保留草稿关闭</button><button type="submit" className="primary-button" disabled={busy || readOnly || draft.uncertain}>{busy ? '正在保存…' : '保存这版取舍'}</button></div>
    </form>
  </CaseDialog>;
}
export function CaseDecisionsPanel({ record, recovery, onRecoveryChange, view = 'current', refreshKey = 0, onChange, onHistory, onBoard }: { record: CaseRecord; recovery: CaseDecisionUiState; onRecoveryChange: (update: CaseDecisionUiUpdate) => void; view?: 'current' | 'history'; refreshKey?: number; onChange?: () => void; onHistory?: () => void; onBoard?: () => void }) {
  const [data, setData] = useState<(CaseDecisionList & { writingEnabled?: boolean }) | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  // Unfinished human input belongs to the existing Case UI owner, so closing a drawer does not lose the original operation.
  const pending = recovery.pendingChoices, drafts = recovery.choiceDrafts, pendingGovernance = recovery.pendingGovernance;
  const setPending = (update: (previous: typeof pending) => typeof pending) => onRecoveryChange(previous => ({ ...previous, pendingChoices: update(previous.pendingChoices) }));
  const setDrafts = (update: (previous: typeof drafts) => typeof drafts) => onRecoveryChange(previous => ({ ...previous, choiceDrafts: update(previous.choiceDrafts) }));
  const setPendingGovernance = (update: (previous: typeof pendingGovernance) => typeof pendingGovernance) => onRecoveryChange(previous => ({ ...previous, pendingGovernance: update(previous.pendingGovernance) }));
  const [busy, setBusy] = useState<Record<string, boolean>>({}), [notice, setNotice] = useState('');
  const [choiceEditor, setChoiceEditor] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ value: CaseDecisionExact; loading: boolean; error: string } | null>(null), detailEpoch = useRef(0);
  const [knownHeads, setKnownHeads] = useState<Record<string, CaseDecisionExact['current']>>({});
  const [linkTarget, setLinkTarget] = useState<CaseDecisionRevision | null>(null);
  const owner = useRef(record.id); owner.current = record.id;
  const epoch = useRef(0);
  const alive = useRef(true);
  const load = async (continuation?: string) => {
    const current = ++epoch.current, caseId = record.id;
    setLoading(true); setError('');
    try {
      const value = await readCaseDecisions(caseId, { history: view === 'history', continuation });
      if (owner.current !== caseId || epoch.current !== current) return false;
      if (view !== 'history') setKnownHeads(old => ({ ...old, ...Object.fromEntries(value.items.map(item => [item.recordId, { revision: item.revision, lifecycle: item.lifecycle }])) }));
      setData(previous => {
        if (!continuation || !previous) return value;
        const items = new Map([...previous.items, ...value.items].map(item => [`${item.recordId}/${item.revision}`, item]));
        const choices = new Map([...previous.choices, ...value.choices].map(choice => [choice.choiceId, choice]));
        return { ...value, items: [...items.values()], choices: [...choices.values()] };
      });
      return true;
    }
    catch (caught) { if (owner.current === caseId && epoch.current === current) setError(caseError(caught)); return false; }
    finally { if (owner.current === caseId && epoch.current === current) setLoading(false); }
  };
  useEffect(() => { alive.current = true; void load(); return () => { epoch.current++; alive.current = false; }; }, [record.id, view, refreshKey]);
  useEffect(() => () => { detailEpoch.current++; }, [record.id, view]);
  const readOnly = record.status === 'closed' || data?.writingEnabled === false || loading || Boolean(error) || !data;
  const makeInput = (target: CaseDecisionRevision, value: CaseStrategyChoiceValue): ChoiceRequest => ({ operationId: crypto.randomUUID(), caseStoreId: target.caseStoreId, strategyRef: { type: 'case-decision', caseStoreId: target.caseStoreId, caseId: record.id, recordId: target.recordId, revision: target.revision }, choice: value, reason: null, expectedPreviousChoiceId: data?.choices.filter(choice => choice.strategyRef.recordId === target.recordId).at(-1)?.choiceId ?? null });
  const commitChoice = async (target: CaseDecisionRevision, input: ChoiceRequest) => {
    if (busy[target.recordId] || readOnly) return;
    const caseId = record.id;
    const submitted: PendingChoice = { input, record: target, error: '原保存请求已发出，结果尚未确认。', uncertain: true };
    setPending(old => ({ ...old, [target.recordId]: submitted })); setDrafts(old => ({ ...old, [target.recordId]: submitted }));
    setBusy(old => ({ ...old, [target.recordId]: true })); setNotice('');
    try {
      const result = await saveCaseStrategyChoice(caseId, input);
      if (!alive.current || owner.current !== caseId) return;
      setData(old => old ? { ...old, choices: [...old.choices.filter(choice => choice.choiceId !== result.choice.choiceId), result.choice] } : old);
      setPending(old => { const next = { ...old }; delete next[target.recordId]; return next; }); setDrafts(old => { const next = { ...old }; delete next[target.recordId]; return next; }); setChoiceEditor(old => old === target.recordId ? null : old);
      setNotice('人的选择已保存，绑定准确策略版；未改原行动、反馈或自动派发。'); onChange?.();
    } catch (caught) {
      if (!alive.current || owner.current !== caseId) return;
      const failure: PendingChoice = { input, record: target, error: caseError(caught), uncertain: !(caught instanceof CaseRequestError && caught.status >= 400 && caught.status < 500) };
      setPending(old => ({ ...old, [target.recordId]: failure })); setDrafts(old => ({ ...old, [target.recordId]: failure }));
    }
    finally { if (alive.current && owner.current === caseId) setBusy(old => ({ ...old, [target.recordId]: false })); }
  };
  const choose = (target: CaseDecisionRevision, value: CaseStrategyChoiceValue) => { if (!pending[target.recordId]) void commitChoice(target, makeInput(target, value)); };
  const openMore = (target: CaseDecisionRevision) => { setDrafts(old => ({ ...old, [target.recordId]: old[target.recordId] ?? pending[target.recordId] ?? { record: target, input: makeInput(target, 'gather_evidence'), error: '', uncertain: false } })); setChoiceEditor(target.recordId); };
  const openDetail = async (target: CaseDecisionRevision) => {
    const current = ++detailEpoch.current, caseId = record.id;
    setDetail({ value: { revision: target, current: { revision: target.revision, lifecycle: target.lifecycle } }, loading: true, error: '' });
    try { const value = await readCaseDecisionRevision(caseId, target.recordId, target.revision); if (alive.current && owner.current === caseId && detailEpoch.current === current) { setKnownHeads(old => ({ ...old, [target.recordId]: value.current })); setDetail({ value, loading: false, error: '' }); } }
    catch (caught) { if (alive.current && owner.current === caseId && detailEpoch.current === current) setDetail(old => old ? { ...old, loading: false, error: caseError(caught) } : old); }
  };
  const govern = async (target: CaseDecisionRevision, action: GovernanceRequest['action'], reference?: CaseDecisionReference, original?: GovernanceRequest) => {
    if (busy[target.recordId] || readOnly || pendingGovernance[target.recordId]?.uncertain && !original) return;
    const caseId = record.id, input: GovernanceRequest = original ?? { operationId: crypto.randomUUID(), caseStoreId: target.caseStoreId, expectedRevision: target.revision, action, ...(reference ? { reference } : {}) };
    setPendingGovernance(old => ({ ...old, [target.recordId]: { record: target, input, error: '原整理请求已发出，结果尚未确认。', uncertain: true } }));
    setBusy(old => ({ ...old, [target.recordId]: true })); setNotice('');
    try {
      const result = await saveCaseDecisionGovernance(caseId, target.recordId, input);
      if (!alive.current || owner.current !== caseId) return;
      setData(old => old ? { ...old, decisionUpdatedAt: result.revision.createdAt, items: view === 'history' ? [...old.items.filter(item => item.recordId !== result.revision.recordId || item.revision !== result.revision.revision), result.revision] : [...old.items.filter(item => item.recordId !== result.revision.recordId), result.revision] } : old);
      setPendingGovernance(old => { const next = { ...old }; delete next[target.recordId]; return next; }); setLinkTarget(null); detailEpoch.current++; setDetail(null);
      setNotice('人的整理操作已保存为准确新修订；旧版、旧选择、原行动与反馈保留。'); onChange?.();
    } catch (caught) {
      if (!alive.current || owner.current !== caseId) return;
      setPendingGovernance(old => ({ ...old, [target.recordId]: { record: target, input, error: caseError(caught), uncertain: !(caught instanceof CaseRequestError && caught.status >= 400 && caught.status < 500) } })); onChange?.();
    } finally { if (alive.current && owner.current === caseId) setBusy(old => ({ ...old, [target.recordId]: false })); }
  };
  const queryGovernance = async (targetId: string) => {
    const draft = pendingGovernance[targetId], caseId = record.id; if (!draft || busy[targetId]) return;
    setBusy(old => ({ ...old, [targetId]: true }));
    try {
      const result = await operation(draft.input.operationId);
      if (!alive.current || owner.current !== caseId) return;
      if (result.operation?.phase === 'completed') { setPendingGovernance(old => { const next = { ...old }; delete next[targetId]; return next; }); setLinkTarget(null); detailEpoch.current++; setDetail(null); setNotice('已查回原整理操作完成结果；未追加重复修订、改原行动或重跑模型。'); await load(); if (alive.current && owner.current === caseId) onChange?.(); }
      else { setPendingGovernance(old => old[targetId] ? { ...old, [targetId]: { ...old[targetId], queried: true } } : old); setNotice('原整理操作尚未查到完成结果，原目标、关系和操作身份保留；没有自动重放。'); }
    } catch (caught) { if (alive.current && owner.current === caseId) setNotice(`原整理结果仍未确认：${caseError(caught)} 准确原意图保留。`); }
    finally { if (alive.current && owner.current === caseId) setBusy(old => ({ ...old, [targetId]: false })); }
  };
  const queryChoice = async (targetId: string) => {
    const draft = pending[targetId], caseId = record.id; if (!draft || busy[targetId]) return;
    setBusy(old => ({ ...old, [targetId]: true }));
    try {
      const result = await operation(draft.input.operationId);
      if (!alive.current || owner.current !== caseId) return;
      if (result.operation?.phase === 'completed') { setPending(old => { const next = { ...old }; delete next[targetId]; return next; }); setDrafts(old => { const next = { ...old }; delete next[targetId]; return next; }); setChoiceEditor(old => old === targetId ? null : old); setNotice('已查回原操作完成结果；没有重新保存、改用新版或重跑模型。'); await load(); if (alive.current && owner.current === caseId) onChange?.(); }
      else { setPending(old => old[targetId] ? { ...old, [targetId]: { ...old[targetId], queried: true } } : old); setDrafts(old => old[targetId] ? { ...old, [targetId]: { ...old[targetId], queried: true } } : old); setNotice('尚未查到原操作的完成结果，准确选择草稿与原操作身份保留；没有自动重放。'); }
    } catch (caught) { if (alive.current && owner.current === caseId) setNotice(`原结果仍未能确认：${caseError(caught)} 原选择草稿保留。`); }
    finally { if (alive.current && owner.current === caseId) setBusy(old => ({ ...old, [targetId]: false })); }
  };
  const retryChoice = (id: string) => { const original = pending[id]; if (original?.queried) void commitChoice(original.record, original.input); };
  const retryGovernance = (id: string) => { const original = pendingGovernance[id]; if (original?.queried) void govern(original.record, original.input.action, original.input.reference, original.input); };
  const items = data?.items.filter(item => view === 'history' || item.lifecycle !== 'archived') ?? [];
  const editor = choiceEditor ? drafts[choiceEditor] : null;
  const editorHead = editor ? knownHeads[editor.record.recordId] : undefined;
  const editorCurrent = editor ? data?.items.filter(item => item.recordId === editor.record.recordId && (!editorHead || item.revision === editorHead.revision)).reduce<CaseDecisionRevision | undefined>((head, item) => !head || item.revision > head.revision ? item : head, undefined) : undefined;
  return <section className="cd-panel" aria-label="Case 决策记录" aria-busy={loading || undefined}>
    <header className="cd-heading"><div><h3>{view === 'history' ? '判断与方案历史' : 'Case 决策记录'}</h3><p>Agent 按需要整理和修订；人的取舍、原行动和反馈分别保留。</p></div><button type="button" className="text-button" disabled={loading} onClick={() => { void load(); }}>刷新决策记录</button></header>
    {loading && <p className="case-help" role="status">正在读取准确记录…</p>}
    {error && <div className="case-message case-error" role="alert"><p>{error}</p><p>当前读取未确认，不把失读显示成没有记录。</p></div>}
    {notice && <p className="case-notice" role="status">{notice}</p>}
    {record.status === 'closed' && <p className="case-message">Case 已结束，判断、选择与历史只读；原项目任务仍可按其权限独立分析。</p>}
    {data?.writingEnabled === false && <p className="case-message">当前版本已关闭 M5 写入，已有记录、选择和历史完整保留，只读查看。</p>}
    {view === 'history' ? <><section aria-label="人的选择历史"><h3>人的选择历史</h3>{data?.choices.length ? <ol className="cd-choice-history">{[...data.choices].reverse().map(choice => <li key={choice.choiceId}><strong>{choiceLabels[choice.choice]} · 策略准确版 v{choice.strategyRef.revision}</strong><p>{items.find(item => item.recordId === choice.strategyRef.recordId && item.revision === choice.strategyRef.revision)?.payload.title ?? '准确策略稿可按来源回读'}</p><p>人记录于 {caseDate(choice.occurredAt)}；理由：{choice.reason || '未填写（可选）'}</p><p className="case-help">选择、原行动执行与效果分开，不自动改写任何一方。</p></li>)}</ol> : <p className="case-help">已载入记录尚无人的选择；未选择不等于拒绝。</p>}</section><div className="cd-record-list">{items.map(item => <DecisionSummary key={`${item.recordId}/${item.revision}`} record={item} choice={data?.choices.filter(choice => choice.strategyRef.recordId === item.recordId && choice.strategyRef.revision === item.revision).at(-1)} readOnly={readOnly} pending={pending[item.recordId]?.record.revision === item.revision ? pending[item.recordId] : undefined} querying={busy[item.recordId]} onQuery={() => { void queryChoice(item.recordId); }} onDetail={() => { void openDetail(item); }} onLink={() => setLinkTarget(item)} governance={pendingGovernance[item.recordId]} onGovernanceQuery={() => { void queryGovernance(item.recordId); }} onRetry={() => retryChoice(item.recordId)} onGovernanceRetry={() => retryGovernance(item.recordId)} />)}</div></> : <>
      <section className="cd-group" aria-label="当前判断"><h3>当前判断与未知</h3><p className="cd-help">作者的判断，不等于事实确认。</p>{items.filter(item => item.kind === 'hypothesis').map(item => <DecisionSummary key={item.recordId} record={item} readOnly={readOnly} querying={busy[item.recordId]} onDetail={() => { void openDetail(item); }} onLink={() => setLinkTarget(item)} governance={pendingGovernance[item.recordId]} onGovernanceQuery={() => { void queryGovernance(item.recordId); }} onRetry={() => retryChoice(item.recordId)} onGovernanceRetry={() => retryGovernance(item.recordId)} />)}</section>
      <section className="cd-group" aria-label="策略备选"><h3>方案备选与人的选择</h3><p className="cd-help">允许不行动，不自动派发。</p>{items.filter(item => item.kind === 'strategy').map(item => <DecisionSummary key={item.recordId} record={item} choice={data?.choices.filter(choice => choice.strategyRef.recordId === item.recordId).at(-1)} readOnly={readOnly} disabled={readOnly || Boolean(busy[item.recordId] || pending[item.recordId])} onChoice={value => choose(item, value)} onMore={() => openMore(item)} hasDraft={Boolean(drafts[item.recordId])} pending={pending[item.recordId]} querying={busy[item.recordId]} onQuery={() => { void queryChoice(item.recordId); }} onDetail={() => { void openDetail(item); }} onLink={() => setLinkTarget(item)} governance={pendingGovernance[item.recordId]} onGovernanceQuery={() => { void queryGovernance(item.recordId); }} onRetry={() => retryChoice(item.recordId)} onGovernanceRetry={() => retryGovernance(item.recordId)} />)}</section>
    </>}
    {data && !loading && !error && !items.length && <div className="cd-empty"><strong>{data.continuation ? '本页尚无活动记录，仍有更多记录未载入' : `当前没有${view === 'history' ? '已保存的历史' : '活动判断或方案'}`}</strong><p>可以直接继续分析；无需先创建记录、收藏资料或填满计划表。</p></div>}
    {data?.continuation && <div><p className="cd-help">尚有更多记录未载入，当前页面不是完整历史。</p><button type="button" className="secondary-button" disabled={loading} onClick={() => { void load(data.continuation ?? undefined); }}>加载更多准确记录</button></div>}
    {editor && choiceEditor && <ChoiceEditor draft={editor} current={editorCurrent} busy={Boolean(busy[choiceEditor])} readOnly={readOnly || editorHead?.lifecycle === 'archived' || editorCurrent?.lifecycle === 'archived'} onClose={() => setChoiceEditor(null)} onChange={(field, value) => setDrafts(old => { const prior = old[choiceEditor]; if (!prior) return old; const input = { ...prior.input, operationId: pending[choiceEditor]?.input.operationId === prior.input.operationId ? crypto.randomUUID() : prior.input.operationId, ...(field === 'choice' ? { choice: value as CaseStrategyChoiceValue } : { reason: value || null }) }; return { ...old, [choiceEditor]: { ...prior, input } }; })} onSave={() => { void commitChoice(editor.record, editor.input); }} onQuery={() => { void queryChoice(choiceEditor); }} onRetry={() => retryChoice(choiceEditor)} onRefresh={() => { const caseId = record.id; void load().then(loaded => { if (loaded && alive.current && owner.current === caseId) { setDrafts(old => old[choiceEditor] ? { ...old, [choiceEditor]: { ...old[choiceEditor], refreshed: true } } : old); onChange?.(); } }); }} onUseLatest={() => { if (!editorCurrent || readOnly) return; const input = { ...makeInput(editorCurrent, editor.input.choice), reason: editor.input.reason }; setDrafts(old => ({ ...old, [choiceEditor]: { input, record: editorCurrent, error: '', uncertain: false } })); }} />}
    {linkTarget && <LinkDialog key={`${linkTarget.recordId}/${linkTarget.revision}`} target={linkTarget} busy={Boolean(busy[linkTarget.recordId])} failure={pendingGovernance[linkTarget.recordId]} readOnly={readOnly} onClose={() => setLinkTarget(null)} onSave={reference => { void govern(linkTarget, 'add_reference', reference); }} onQuery={() => { void queryGovernance(linkTarget.recordId); }} onRetry={() => retryGovernance(linkTarget.recordId)} onBoard={onBoard} />}
    {detail && <DecisionDetails key={`${detail.value.revision.recordId}/${detail.value.revision.revision}`} value={detail.value} loading={detail.loading} error={detail.error} readOnly={readOnly} onClose={() => { detailEpoch.current++; setDetail(null); }} onHistory={onHistory ? () => { detailEpoch.current++; setDetail(null); onHistory(); } : undefined} busy={Boolean(busy[detail.value.revision.recordId])} governance={pendingGovernance[detail.value.revision.recordId]} onGovernance={(action, reference) => { void govern(detail.value.revision, action, reference); }} onGovernanceQuery={() => { void queryGovernance(detail.value.revision.recordId); }} onGovernanceRetry={() => retryGovernance(detail.value.revision.recordId)} onCurrent={() => { const target = detail.value.revision; void openDetail({ ...target, revision: detail.value.current.revision }); }} onBoard={onBoard} onHistoricalChoice={() => { const target = detail.value.revision, historical = target.revision !== detail.value.current.revision; const input = { ...makeInput(target, 'gather_evidence'), ...(historical ? { allowHistorical: true } : {}) }; setDrafts(old => ({ ...old, [target.recordId]: { record: target, input, error: '', uncertain: false } })); detailEpoch.current++; setDetail(null); setChoiceEditor(target.recordId); }} />}
  </section>;
}
