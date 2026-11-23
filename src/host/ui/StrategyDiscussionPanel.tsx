import { StrategyAttachmentPicker } from './StrategyAttachmentPicker.tsx';
import { fileBase64,projectAttachmentLibrary } from './runtime-client.ts';
import {StrategyWorkbench} from './StrategyWorkbench.tsx';
import {mapTemplates,type StrategyMapDraft,type StrategyMapRef} from '../strategy-map-types.ts';
import type { ManagementStage } from './ManagementTabs.tsx';
import type { GoalScope } from '../strategy-goals-types.ts';
import { StrategyChoicePanel,type ChoiceHandoff } from './StrategyChoicePanel.tsx';
import { ConversationDrawer } from "./ConversationDrawer.tsx";
import type { ProjectSnapshot } from '../../agent/project-runtime.ts';
import { projectDiscussionSnapshot, projectDiscussionStreaming } from './strategy-discussion-projection.ts';
import { StrategyDiscussionTranscript } from './StrategyDiscussionReply.tsx';
export { StrategyDiscussionTranscript } from './StrategyDiscussionReply.tsx';
import { StrategyDiscussionSourceView } from './StrategyDiscussionSourceView.tsx';
import { resolveNewUsageContext } from '../usage-context-types.ts';
import { isDiscussionSourceExcluded } from '../strategy-discussion-source-scope.ts';
import { useEffect, useId, useRef, useState } from 'react';
import type { GoalRef, GoalVersion, GoalDiscussionSourceRef } from '../strategy-goals-types.ts';
import type { StrategyDiscussion, StrategyDiscussionDetail, StrategyDiscussionSource, StrategyDiscussionSourceScope, StrategyMethodSelection } from '../strategy-discussion-types.ts';
import type { ClientProject, PublicModelConfiguration, NativeMessage } from './project-types.ts';
import * as api from './strategy-discussion-client.ts';
import { readUsageContextSettings } from './usage-context-client.ts';
import type { UsageContext } from './usage-context-client.ts';
import { UsageContextFields, usageKindLabels } from './UsageContextSettingsPage.tsx';

const coCreationQuestions = [
  ['复盘上期','对照上期战略、实际行动与结果。哪些选择值得延续，哪些仍缺观察？'],
  ['看看行业变化','行业和竞品的哪些变化影响这次选择？请说明资料来源和适用范围。'],
  ['找机会与风险','结合我们已有的优势、短板、机会与威胁，有哪些可供比较的行动？'],
  ['看看竞争压力','从客户、供应商、竞争者、替代品和新进入者看，哪些压力会改变这次战略取舍？'],
] as const;
const references = [
  ['playing-to-win', '战略选择框架 / Playing to Win'], ['rumelt', 'Rumelt 战略内核'], ['mckinsey', '麦肯锡战略构建要素'], ['bcg', 'BCG 战略调色板'], ['bain', '贝恩核心业务与相邻增长'], ['bsc', 'BSC／战略地图'],
] as const;
const same = (first: unknown, second: unknown): boolean => JSON.stringify(first) === JSON.stringify(second);
const errorText = (fault: unknown) => fault instanceof Error ? fault.message : '讨论操作未完成，原输入与记录保留。';
const mentionsLocalFilePath = (text: string): boolean => {
  const withoutUrls = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ');
  return /(?:[A-Za-z]:[\\/]|~\/|\/)[^\s]*\.(?:md|markdown|txt|pdf|docx?|xlsx?|pptx?|csv|tsv|json|html?|png|jpe?g|gif|webp)(?![A-Za-z0-9])/i.test(withoutUrls);
};
const draftKey = (id?: string) => `optracall.strategy-discussion.draft.v1:${id || 'new'}`;
const readDraft = (id?: string): string => { try { return sessionStorage.getItem(draftKey(id)) || ''; } catch { return ''; } };
const saveDraft = (text: string, id?: string) => { sessionStorage.setItem(draftKey(id), text); };
const attachmentDraftKey=(id:string)=>'optracall.strategy-discussion.files.v1:'+id;
function readAttachmentDraft(id:string){
  try{const ids:unknown=JSON.parse(sessionStorage.getItem(attachmentDraftKey(id))??'[]');return Array.isArray(ids)?ids.filter((s):s is string=>typeof s==='string'):[];}catch{return [];}
}
const replacementKey = (id: string) => `optracall.strategy-discussion.replace.v1:${id}`;
const readReplacement = (id?: string): string | undefined => { try { return id ? sessionStorage.getItem(replacementKey(id)) || undefined : undefined; } catch { return undefined; } };
const goalPurpose = (goal: GoalVersion): UsageContext => resolveNewUsageContext({ goal })!;
export function StrategyDiscussionRecoveryActions({ pending, detail, busy, onRecover, onPrepare }: { pending: api.DiscussionPending; detail?: StrategyDiscussionDetail; busy: boolean; onRecover(): void; onPrepare(): void }) {
  return <div className="sg-unknown"><p>原操作结果待核，输入、选择与原编号保持；未重发模型或另建讨论。</p><button type="button" className="secondary-button" disabled={busy} onClick={onRecover}>核对原操作结果</button>{pending.kind === 'message' && api.canPrepareDiscussionReplacement(detail, pending.input) && <button type="button" className="text-button" disabled={busy} onClick={onPrepare}>保留输入，准备新的请求</button>}</div>;
}
export function StrategyDiscussionCandidates({ goals, discussionId, locked, onReview }: { goals: GoalVersion[]; discussionId: string; locked: boolean; onReview(goal: GoalVersion, discussionId: string): void }) {
  return <>{goals.map(candidate => {
    const pending=api.hasPendingDiscussionAdoption(discussionId,candidate);
    return <section className="strategy-discussion-candidate" key={`${candidate.goalId}:${candidate.version}`}><span className={`sg-badge ${candidate.status === 'candidate' ? 'pending' : ''}`}>{candidate.status === 'candidate' ? '原目标候选 · 待采用' : '原目标 · 已采用'} · v{candidate.version}</span><h3>{candidate.title}</h3><details><summary>原版目标正文</summary><p>{candidate.outcome}</p></details><details><summary>策略、依据与待核前提</summary>{candidate.strategyContext?.summary && <p>{candidate.strategyContext.summary}</p>}<p>{candidate.strategies?.join('；')}</p><p>{candidate.necessaryConditions?.join('；')}</p><p>基线：{candidate.baseline.description}</p><p className="sg-muted">逻辑、依据、目标采用和真实效果分别核对。</p></details>{(candidate.status === 'candidate' || pending) && <button type="button" className="primary-button" disabled={locked} onClick={() => onReview(candidate, discussionId)}>{pending && candidate.status!=='candidate' ? '核对原采用结果' : '核对并采用'}</button>}</section>})}</>;
}
export interface StrategyDiscussionBackgroundSelection {
  projectId: string; sources: StrategyDiscussionSource[]; sourceScope?: StrategyDiscussionSourceScope;
}
export function StrategyDiscussionBackground({ id, selection, projects, availableSources, locked, isExistingDiscussion, onChange, onList }: {
  id: string; selection: StrategyDiscussionBackgroundSelection; projects: ClientProject[]; availableSources?: StrategyDiscussionSource[]; locked: boolean; isExistingDiscussion?: boolean;
  onChange(value: StrategyDiscussionBackgroundSelection): void; onList(): void;
}) {
  const mode = selection.sourceScope?.mode ?? 'selected-only';
  const excludedSources = selection.sourceScope?.excludedSources ?? [];
  const isExcluded = (source: StrategyDiscussionSource, exclusions = excludedSources) => isDiscussionSourceExcluded({ sourceScope: { mode, excludedSources: exclusions } }, source);
  const rows = [...(availableSources ?? [])];
  // Saved choices remain visible even if current discovery no longer lists them.
  // They are references to recheck, never a claim of current read permission.
  for (const source of [...selection.sources, ...excludedSources]) {
    if (!rows.some(item => item.id === source.id && item.sha256 === source.sha256) && (!excludedSources.includes(source) || !rows.some(item => isExcluded(item, [source])))) rows.push(source);
  }
  return <>
    <div className="field"><label htmlFor={`${id}-project`}>资料所在项目（可选）</label><select id={`${id}-project`} disabled={locked} value={selection.projectId} onChange={event => onChange({ ...selection, projectId: event.target.value, sources: [], sourceScope: { ...selection.sourceScope, mode: event.target.value ? selection.sourceScope?.mode ?? (isExistingDiscussion ? 'selected-only' : 'project-background') : 'selected-only' } })}><option value="">无项目，直接围绕已知背景讨论</option>{projects.map(project => <option value={project.id} key={project.id}>{project.name}{project.archivedAt ? ' · 已归档' : ''}</option>)}</select></div>
    <div className="field"><label htmlFor={`${id}-source-mode`}>本次背景使用范围</label><select id={`${id}-source-mode`} aria-describedby={`${id}-source-help`} value={mode} disabled={!selection.projectId || locked} onChange={event => onChange({ ...selection, sourceScope: { ...selection.sourceScope, mode: event.target.value as StrategyDiscussionSourceScope['mode'] } })}><option value="project-background">在本项目获准背景内自主查找</option><option value="selected-only">仅使用我手选的资料</option></select><p id={`${id}-source-help`} className="case-help">{!selection.projectId ? '尚未明确资料项目：不开放项目背景，仍可围绕当前说明与准确目标讨论。' : mode === 'project-background' ? 'Agent 可在本次明确的项目背景与原权限内发现并按需读取。手选是优先参考或补充，不是逐项读取审批。' : '仅限下方明确手选的资料；空清单表示本次不使用项目背景，不自动转为项目范围。'}</p></div>
    {isExistingDiscussion && !selection.sourceScope && <p className="case-help">原讨论保持原手选范围；只有你明确调整本次范围后，后续请求才采用新选择。旧消息与来源不改写。</p>}
    <button type="button" className="secondary-button" disabled={!selection.projectId || locked} onClick={onList}>查看可选背景资料</button><p className="case-help">目录可见不代表正文已读；这里只提供原资格内的清单、已有说明与背景文档，不会试连活库、读取业务明细或增加资料权限。需要数据执行的工作仍走原项目方案。</p>
    <ul className="sg-history">{rows.map((source, index) => {
      const excluded = isExcluded(source), listed = availableSources?.some(item => item.id === source.id && item.sha256 === source.sha256);
      return <li key={`${source.id}:${source.sha256}`}><div className="sg-row-between"><div><strong>{source.title}</strong><p className="sg-muted">准确版 {source.version} · {listed ? '目录项，尚不代表已读取' : '原保存引用，当前目录尚未列出；资格仍须核对'}</p></div><div className="sg-row">
        <label className="strategy-source-option"><input id={`${id}-use-${index}`} type="checkbox" aria-label={`${source.title} · v${source.version} · ${mode === 'selected-only' ? '本次使用' : '优先参考'}`} disabled={locked || excluded} checked={!excluded && selection.sources.some(item => item.id === source.id && item.sha256 === source.sha256)} onChange={event => onChange({ ...selection, sources: event.target.checked ? [...selection.sources, source] : selection.sources.filter(item => item.id !== source.id || item.sha256 !== source.sha256) })} />{mode === 'selected-only' ? '本次使用' : '优先参考'}</label>
        <label className="strategy-source-option"><input id={`${id}-exclude-${index}`} type="checkbox" aria-label={`${source.title} · v${source.version} · 排除`} disabled={locked} checked={excluded} onChange={event => onChange({ ...selection, sources: event.target.checked ? selection.sources.filter(item => !isExcluded(item, [source])) : selection.sources, sourceScope: { mode, excludedSources: event.target.checked ? [...excludedSources.filter(item => !isExcluded(item, [source])), source] : excludedSources.filter(item => !isExcluded(item, [source])) } })} />排除</label>
      </div></div></li>;
    })}</ul>
    {availableSources?.length === 0 && <p className="sg-muted" role="status">当前项目没有可用的背景目录项；可继续围绕已有说明与准确目标讨论。</p>}
    <p className="sg-muted">{mode === 'selected-only' ? `本次仅限 ${selection.sources.length} 份手选背景。` : `手选优先参考 ${selection.sources.length} 份；未手选不等于排除。`}明确排除 {excludedSources.length} 项，同一资料后续换版仍保持排除。发送前及实际读取时仍核当前资格与准确版本。</p>
  </>;
}
export interface StrategyDiscussionPanelProps {
  stage?:ManagementStage; onStage?:(stage:ManagementStage)=>void; scopes?:GoalScope[]; getGoalScope?:(goal:GoalRef)=>GoalScope|undefined; onHandoff?:(v:ChoiceHandoff)=>void;
  active: boolean; focusRequest?: { source: GoalDiscussionSourceRef; id: string }; selectedGoal?: GoalVersion; projects: ClientProject[]; configurations: PublicModelConfiguration[]; selectedConfigurationId?: string | null;
  onReviewCandidate: (goal: GoalVersion, discussionId: string, reload: () => Promise<void>) => void; onGoalsChanged: (goals?:GoalVersion[]) => Promise<void>; onSettings: () => void;
}
export function StrategyDiscussionPanel({ stage='direction',onStage,scopes=[],getGoalScope,onHandoff,active, focusRequest, selectedGoal, projects, configurations, selectedConfigurationId, onReviewCandidate, onGoalsChanged, onSettings }: StrategyDiscussionPanelProps) {
  const id = useId(), live = useRef(true), owner = useRef<string | undefined>(undefined), dirtyPurpose = useRef(false), epoch = useRef(0), presentedSnapshot = useRef<ProjectSnapshot | undefined>(undefined);
  const [directory, setDirectory] = useState<StrategyDiscussion[]>([]), [detail, setDetail] = useState<StrategyDiscussionDetail>(), [text, setText] = useState(() => readDraft()), [streaming, setStreaming] = useState(''), [activity, setActivity] = useState('');
  const detailRef = useRef(detail); detailRef.current = detail;
  const [attachmentIds,setAttachmentIds]=useState<string[]>([]);
  function saveAttachmentDraft(id:string,ids:string[]){
    if(ids.length)sessionStorage.setItem(attachmentDraftKey(id),JSON.stringify(ids));
    else sessionStorage.removeItem(attachmentDraftKey(id));
    setAttachmentIds(ids);
  }
  const [configurationId, setConfigurationId] = useState(selectedConfigurationId || ''), [purpose, setPurpose] = useState<UsageContext | null | undefined>(), [methods, setMethods] = useState<StrategyMethodSelection[]>([]), [customMethod, setCustomMethod] = useState('');
  const [mapContext,setMapContext]=useState<(StrategyMapRef & {edgeId?:string})>();
  const [mapTemplate,setMapTemplate]=useState<keyof typeof mapTemplates>();
  const [sentMapRequest,setSentMapRequest]=useState<string>();
  const [workspaceEpoch,setWorkspaceEpoch]=useState(0);
  const [focusedSource, setFocusedSource] = useState<GoalDiscussionSourceRef>();
  const [goal, setGoal] = useState<GoalRef>(), [projectId, setProjectId] = useState(''), [sources, setSources] = useState<StrategyDiscussionSource[]>([]), [sourceScope, setSourceScope] = useState<StrategyDiscussionSourceScope>(), [availableSources, setAvailableSources] = useState<StrategyDiscussionSource[]>();
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState<api.DiscussionPending>(), [connection, setConnection] = useState(0), [replacementRequestId, setReplacementRequestId] = useState<string>();
  const [refreshFeedback, setRefreshFeedback] = useState<{ role: 'status' | 'alert'; text: string }>();
  const refreshRequest = useRef<AbortController | undefined>(undefined);
  const refreshReconnect = useRef<{ discussionId: string; afterEpoch: number } | undefined>(undefined);
  const [journal] = useState(() => { try { return { value: api.discussionJournal(window.sessionStorage), error: '' }; } catch { return { value: undefined, error: '无法保留原讨论请求编号，请核对浏览器存储权限。' }; } });
  const restoreMessageContext=(discussionId:string,input:api.StrategyDiscussionMessage)=>{
    setMapContext(input.mapRef);setMapTemplate(input.mapTemplate);
    saveAttachmentDraft(discussionId,input.attachmentIds??[]);
  };
  const apply = (next: StrategyDiscussionDetail, choices = false) => {
    const previousSnapshot = presentedSnapshot.current; presentedSnapshot.current = next.snapshot; setStreaming(old => projectDiscussionStreaming(old, { type: 'snapshot', snapshot: next.snapshot }, previousSnapshot));
    if (!next.busy) setActivity('');
    const loopDiagnostic = next.snapshot?.lastRun?.diagnostic;
    if (!next.busy && loopDiagnostic?.code === 'strategy_action_loop') setError(loopDiagnostic.message);
    owner.current = next.discussion.id; setDetail(next); setReplacementRequestId(readReplacement(next.discussion.id));
    const original = journal.value?.read();
    if (original?.kind === 'message' && original.discussionId === next.discussion.id && api.canSettleDiscussionMessage(next, original.input)) {
      journal.value!.settle(original); setPending(undefined); sessionStorage.removeItem(replacementKey(next.discussion.id)); setReplacementRequestId(undefined);
      const sentAttachments = original.input.attachmentIds;
      if (sentAttachments?.length) {
        saveAttachmentDraft(next.discussion.id, readAttachmentDraft(next.discussion.id).filter(id => !sentAttachments.includes(id)));
      }
      const savedDraft = readDraft(next.discussion.id);
      const remainingDraft = !original.input.importMode && savedDraft.trim() === original.input.text.trim() ? '' : savedDraft;
      saveDraft(remainingDraft, next.discussion.id);
      setText(remainingDraft);
    } else if (!original && next.discussion.pendingInput && !api.canSettleDiscussionMessage(next, next.discussion.pendingInput) && readReplacement(next.discussion.id) !== next.discussion.pendingInput.requestId) {
      const restored: api.DiscussionPending = { kind: 'message', discussionId: next.discussion.id, input: next.discussion.pendingInput };
      journal.value?.remember(restored); setPending(restored);
      if (!restored.input.importMode && !readDraft(next.discussion.id)) {
        saveDraft(restored.input.text, next.discussion.id);
        setText(restored.input.text);
      }
    }

    if (choices) { const discussion = next.discussion; setAttachmentIds(readAttachmentDraft(discussion.id)); setPurpose(discussion.usageContext); dirtyPurpose.current = false; setMethods(discussion.methods); setGoal(discussion.goal); setConfigurationId(discussion.configurationId); setProjectId(discussion.projectId || ''); setSources(discussion.sources); setSourceScope(discussion.sourceScope); setAvailableSources(undefined); }
    if(choices && next.discussion.pendingInput && readReplacement(next.discussion.id)===next.discussion.pendingInput.requestId){
      restoreMessageContext(next.discussion.id,next.discussion.pendingInput);
    }
  };
  const readSeq = useRef(0);
  const list = async () => { const result = await api.listStrategyDiscussions(); if (live.current) setDirectory(result.discussions); };
  const read = async (discussionId = owner.current, choices = false, signal?: AbortSignal) => {
    if (!discussionId) return;
    const seq = ++readSeq.current;
    const next = await api.readStrategyDiscussion(discussionId, signal);
    if (!live.current || signal?.aborted || owner.current !== discussionId) return;
    if (seq !== readSeq.current) {
      const latest = detailRef.current;
      return latest?.discussion.id === discussionId ? latest : undefined;
    }
    apply(next, choices);
    return next;
  };
  const cancelRefresh = () => {
    refreshRequest.current?.abort();
    refreshRequest.current = undefined;
    refreshReconnect.current = undefined;
    setRefreshing(false);
    setRefreshFeedback(undefined);
  };
  const refreshDiscussion = async () => {
    const discussionId = owner.current;
    if (!discussionId || busy || refreshRequest.current) return;
    const request = new AbortController();
    refreshRequest.current = request;
    refreshReconnect.current = undefined;
    setRefreshing(true);
    setRefreshFeedback(undefined);
    try {
      const next = await read(discussionId, false, request.signal);
      if (!next) {
        if (live.current && !request.signal.aborted && owner.current === discussionId) {
          setRefreshFeedback({ role: 'status', text: '讨论状态正在更新，可稍后再试「刷新讨论记录」。' });
        }
        return;
      }
      refreshReconnect.current = { discussionId, afterEpoch: epoch.current };
      setRefreshFeedback({ role: 'status', text: next.busy ? '已刷新讨论记录，正在接回本轮实时回复…' : '已刷新讨论记录，消息与状态已同步。' });
      setConnection(value => value + 1);
    } catch (fault) {
      if (live.current && !request.signal.aborted && owner.current === discussionId) {
        setRefreshFeedback({ role: 'alert', text: `刷新讨论记录未完成，原输入与记录保留；未重发消息。${errorText(fault)}` });
      }
    } finally {
      if (live.current && refreshRequest.current === request) {
        refreshRequest.current = undefined;
        setRefreshing(false);
      }
    }
  };
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; refreshRequest.current?.abort(); epoch.current++; };
  }, []);
  useEffect(() => { if (!active) return; void list().catch(fault => { if (live.current) setError(errorText(fault)); }); if (owner.current) void read().catch(fault => { if (live.current) setError(errorText(fault)); }); }, [active]);
  useEffect(() => {
    const refreshDefault = () => { if (owner.current || dirtyPurpose.current || goal) return; void readUsageContextSettings().then(value => { if (live.current && !owner.current && !dirtyPurpose.current) setPurpose(value.context); }).catch(fault => { if (live.current) setNotice(`默认用途暂不可读取，可直接讨论或明确本次背景。${errorText(fault)}`); }); };
    refreshDefault(); window.addEventListener('optracall-usage-context', refreshDefault); return () => window.removeEventListener('optracall-usage-context', refreshDefault);
  }, [goal?.goalId, goal?.version]);
  useEffect(() => { if (!configurationId && selectedConfigurationId && !owner.current) setConfigurationId(selectedConfigurationId); }, [selectedConfigurationId]);
  useEffect(() => {
    try { const original = journal.value?.read(); if (!original) return; setPending(original);
      const discussionId = original.kind === 'create' ? original.input.operationId : original.discussionId;
      owner.current = discussionId; if (original.kind === 'message') setText(readDraft(discussionId) || (original.input.importMode ? '' : original.input.text));
      if (original.kind === 'create') { setProjectId(original.input.projectId || ''); setSources(original.input.sources || []); setSourceScope(original.input.sourceScope); }
      void read(discussionId, true).then(result => { if (original.kind === 'update' && result) { const input = original.input; if (input.usageContext !== undefined) setPurpose(input.usageContext); if (input.methods) setMethods(input.methods); if (input.goal !== undefined) setGoal(input.goal || undefined); if (input.projectId !== undefined) setProjectId(input.projectId || ''); if (input.sources) setSources(input.sources); if (input.sourceScope) setSourceScope(input.sourceScope); if (input.configurationId) setConfigurationId(input.configurationId); } }).catch(() => setError('原操作尚未核对，输入与编号保留。'));
    } catch (fault) { setError(errorText(fault)); }
  }, []);

  useEffect(() => {
    if (!active || !detail?.discussion.id) return; const discussionId = detail.discussion.id, ticket = ++epoch.current, controller = new AbortController();
    let observedRunning = false;
    const isCurrent = () => live.current && !controller.signal.aborted && owner.current === discussionId && ticket === epoch.current;
    const onStreamFailure = (fault?: unknown) => {
      if (!isCurrent()) return;
      const refresh = refreshReconnect.current;
      const errorSuffix = fault === undefined ? '' : errorText(fault);
      if (refresh?.discussionId === discussionId) {
        if (ticket <= refresh.afterEpoch) return;
        refreshReconnect.current = undefined;
        setRefreshFeedback({ role: 'alert', text: `已读取最新讨论记录，但实时回复连接尚未恢复；未重发消息，可稍后再试「刷新讨论记录」。${errorSuffix}` });
      } else if (fault !== undefined || observedRunning) {
        setRefreshFeedback({ role: 'alert', text: `实时连接未能核对，可刷新讨论记录；没有重发消息。${errorSuffix}` });
      }
    };
    void api.watchStrategyDiscussion(discussionId, event => {
      if (!isCurrent()) return;
      const previousSnapshot = presentedSnapshot.current;
      if (event.type === 'snapshot') {
        observedRunning = event.snapshot.status === 'running';
        presentedSnapshot.current = event.snapshot;
        const refresh = refreshReconnect.current;
        if (refresh?.discussionId === discussionId && ticket > refresh.afterEpoch) {
          refreshReconnect.current = undefined;
          setRefreshFeedback({ role: 'status', text: event.snapshot.status === 'running' ? '已刷新讨论记录，并接回本轮实时回复。' : '已刷新讨论记录，消息与状态已同步。' });
        }
      }
      setStreaming(old => projectDiscussionStreaming(old, event, previousSnapshot));
      if (event.type === 'snapshot' || event.type === 'native' && event.event.type === 'message_end') {
        const prev = detailRef.current;
        const shouldReconcile = event.type === 'snapshot' && event.snapshot.status !== 'running' && prev?.discussion.id === discussionId && (prev.busy || prev.discussion.lastRun?.status === 'accepted');
        setDetail(old => old && old.discussion.id === discussionId ? { ...old, snapshot: projectDiscussionSnapshot(old.snapshot, event), ...(event.type === 'snapshot' ? { busy: event.snapshot.status === 'running' } : {}) } : old);
        if (shouldReconcile) {
          setStreaming(''); setActivity('');
          void read(discussionId).then(() => onGoalsChanged()).catch(fault => { if (live.current) setError(errorText(fault)); });
          void list().catch(() => {});
        }
      }
      if (event.type === 'native' && event.event.type === 'tool_execution_start') setActivity(`正在使用 ${event.event.toolName || '已获准工具'}`);
      if (event.type === 'native' && event.event.type === 'tool_execution_end') setActivity('');
      if (event.type === 'run.settled') { observedRunning = false; setStreaming(''); setActivity(''); if (event.outcome === 'failed') setError(event.error || '本轮讨论未完成，已保存的记录保留。'); else if (event.diagnostic?.code === 'strategy_action_loop') setError(event.diagnostic.message); void read(discussionId).then(() => onGoalsChanged()).catch(fault => { if (live.current) setError(errorText(fault)); }); void list().catch(() => {}); }
    }, controller.signal).then(() => onStreamFailure(), onStreamFailure);
    return () => { controller.abort(); ++epoch.current; };
  }, [active, detail?.discussion.id, connection]);
  const locked = busy || refreshing || Boolean(detail?.busy) || Boolean(pending);
  const ensure = async (): Promise<StrategyDiscussion> => {
    if (owner.current) return detail?.discussion.id === owner.current ? detail.discussion : (await api.readStrategyDiscussion(owner.current)).discussion;
    if (!journal.value) throw new Error(journal.error);
    const input = { operationId: crypto.randomUUID(), title: text.trim().slice(0, 100) || '战略讨论', ...(configurationId ? { configurationId } : {}), ...(purpose !== undefined ? { usageContext: purpose } : {}), methods, ...(goal ? { goal } : {}), ...(projectId ? { projectId } : {}), sources, sourceScope: sourceScope ?? { mode: 'selected-only' as const } };
    const original: api.DiscussionPending = { kind: 'create', input }; journal.value.remember(original); setPending(original);
    const result = await api.createStrategyDiscussion(input); saveDraft(text, result.discussion.id); sessionStorage.removeItem(draftKey()); owner.current = result.discussion.id; journal.value.settle(original); setPending(undefined); apply(await api.readStrategyDiscussion(result.discussion.id)); await list(); return result.discussion;
  };
  const update = async (discussion: StrategyDiscussion, selectedSources=sources) => {
    const fields = { configurationId: configurationId || discussion.configurationId, usageContext: purpose ?? null, methods, goal: goal || null, projectId: projectId || null, sources:selectedSources, sourceScope: sourceScope ?? discussion.sourceScope };
    const current = { configurationId: discussion.configurationId, usageContext: discussion.usageContext ?? null, methods: discussion.methods, goal: discussion.goal || null, projectId: discussion.projectId || null, sources: discussion.sources, sourceScope: discussion.sourceScope };
    if (same(fields, current)) return discussion;
    const input = { expectedRevision: discussion.revision, ...fields };
    if (!journal.value) throw new Error(journal.error);
    const original: api.DiscussionPending = { kind: 'update', discussionId: discussion.id, input }; journal.value.remember(original); setPending(original);
    try { const result = await api.updateStrategyDiscussion(discussion.id, input); journal.value.settle(original); setPending(undefined); setDetail(old => old && old.discussion.id === discussion.id ? { ...old, discussion: result.discussion } : old); return result.discussion; }
    catch (fault) { if (fault instanceof api.StrategyDiscussionRequestError && !fault.uncertain) { journal.value.settle(original); setPending(undefined); } throw fault; }
  };
  const attach = async (files:File[],selected:StrategyDiscussionSource[]) => {
    if(locked)throw new Error('请等本轮讨论结束后添加资料。');
    setBusy(true);
    try{
      const discussion=await update(await ensure());
      const additions=[...selected];
      for(const file of files){
        const result=await api.strategyAttachmentRequest<{source:StrategyDiscussionSource}>(discussion.id,'','POST',{name:file.name,content:await fileBase64(file),expectedRevision:discussion.revision});
        additions.push(result.source);
      }
      const merged=[...new Map([...sources,...additions].map(item=>[item.id,item])).values()];
      await update(discussion,merged);
      setSources(merged);
      saveAttachmentDraft(discussion.id,[...new Set([...attachmentIds,...additions.map(s=>s.id)])]);
    }finally{if(live.current)setBusy(false);}
  };
  async function removeAttachment(id:string){
    if(!detail||locked)return;
    setBusy(true);
    try{
      const remaining=sources.filter(s=>s.id!==id);
      await update(detail.discussion,remaining);setSources(remaining);
      saveAttachmentDraft(detail.discussion.id,attachmentIds.filter(s=>s!==id));
    } catch(fault){setError(errorText(fault));}finally{setBusy(false);}
  }
  const chosenAttachments=sources.filter(s=>attachmentIds.includes(s.id)&&!isDiscussionSourceExcluded({sourceScope},s));
  const showPathHint = chosenAttachments.length === 0 && mentionsLocalFilePath(text);
  const send = async () => {
    if ((!text.trim()&&!chosenAttachments.length) || locked) return; setBusy(true); setError(''); setNotice('');
    try {
      let discussion = await ensure(); discussion = await update(discussion);
      const input = { requestId: crypto.randomUUID(), expectedRevision: discussion.revision, text: text.trim(), ...(attachmentIds.length&&{attachmentIds}), ...(mapContext?{mapRef:mapContext}:{}), ...(mapTemplate?{mapTemplate}:{}), ...(replacementRequestId ? { replacePendingRequestId: replacementRequestId } : {}) }, original: api.DiscussionPending = { kind: 'message', discussionId: discussion.id, input };
      journal.value!.remember(original); setPending(original);setSentMapRequest(input.requestId); await api.sendStrategyDiscussionMessage(discussion.id, input); setStreaming(''); apply(await api.readStrategyDiscussion(discussion.id)); setConnection(value => value + 1);
    } catch (fault) { if (fault instanceof api.StrategyDiscussionRequestError && !fault.uncertain) { const original = journal.value?.read(); if (original && original.kind !== 'message') { journal.value?.settle(original); setPending(undefined); } } setError(errorText(fault)); }
    finally { if (live.current) setBusy(false); }
  };
  const recover = async () => {
    if (busy) return; setBusy(true); setError('');
    try {

      const original = journal.value?.read(); if (!original) return;
      const discussionId = original.kind === 'create' ? original.input.operationId : original.discussionId;
      const result = await api.readStrategyDiscussion(discussionId);
      if (original.kind === 'update') { const input = original.input, actual = result.discussion; const matches = actual.revision === input.expectedRevision + 1 && Object.entries(input).filter(([key]) => key !== 'expectedRevision').every(([key, value]) => same((actual as unknown as Record<string, unknown>)[key] ?? null, value)); if (!matches) throw new Error('原背景更新尚不能按内容与版本核对，选择保持；未派发模型。'); }
      if (original.kind === 'message' && !api.canSettleDiscussionMessage(result, original.input)) { apply(result); throw new Error('尚未核对到原话已写入原生会话；输入与原编号保留，未自动重发。'); }
      if (original.kind === 'message') {
        apply(result);
      } else {
        journal.value!.settle(original); setPending(undefined);
        apply(result, original.kind === 'create');
      }
      setConnection(value => value + 1); setNotice('已核对原讨论请求，历史与当前状态已重读。'); await list();
    } catch (fault) { setError(errorText(fault)); } finally { setBusy(false); }
  };
  const prepareNewRequest = () => {
    if (busy || pending?.kind !== 'message' || !api.canPrepareDiscussionReplacement(detail, pending.input)) return;
    restoreMessageContext(pending.discussionId,pending.input);saveDraft(pending.input.text, pending.discussionId); sessionStorage.setItem(replacementKey(pending.discussionId), pending.input.requestId); setReplacementRequestId(pending.input.requestId); setText(pending.input.text); journal.value?.settle(pending); setPending(undefined); setNotice('原请求已停止或失败，且未核对到原生原话；输入已保留。下次明确发送会使用新请求编号；不会自动重发。');
  };
  const choose = async (discussionId: string) => {
    if (busy || pending) return;
    ++readSeq.current;
    cancelRefresh();
    setSentMapRequest(undefined);setWorkspaceEpoch(n=>n+1);setMapContext(undefined);setMapTemplate(undefined);saveDraft(text, owner.current); setError(''); setNotice(''); setText(readDraft(discussionId || undefined));setAttachmentIds(discussionId?readAttachmentDraft(discussionId):[]); setStreaming(''); setFocusedSource(undefined); setDetail(undefined); presentedSnapshot.current = undefined; owner.current = discussionId || undefined; setReplacementRequestId(readReplacement(discussionId));
    if (!discussionId) { setDetail(undefined); setGoal(undefined); setMethods([]); setSources([]); setSourceScope(undefined); setAvailableSources(undefined); setProjectId(''); dirtyPurpose.current = false; setConfigurationId(selectedConfigurationId || ''); setPurpose((await readUsageContextSettings()).context); return; }
    setBusy(true); try { apply(await api.readStrategyDiscussion(discussionId), true); } catch (fault) { setError(errorText(fault)); } finally { setBusy(false); }
  };
  const sourceList = async () => { if (!projectId || locked) return; setBusy(true); setError(''); try { const discussion = await update(await ensure()); setAvailableSources((await api.readStrategyDiscussionSources(discussion.id, projectId)).sources); } catch (fault) { if (fault instanceof api.StrategyDiscussionRequestError && !fault.uncertain) { const original = journal.value?.read(); if (original) journal.value?.settle(original); setPending(undefined); } setError(errorText(fault)); } finally { setBusy(false); } };
  const control = async (action: 'stop' | 'close') => { if (!detail || busy) return; cancelRefresh(); setBusy(true); try { if (action === 'stop') await api.stopStrategyDiscussion(detail.discussion.id, detail.discussion.lastRun?.id); else await api.closeStrategyDiscussion(detail.discussion.id); await read(); setNotice(action === 'stop' ? '已请求停止，已保存记录保留；实际收尾以当前状态为准。' : '会话资源已关闭，原生历史保留，可从原讨论续接。'); } catch (fault) { setError(errorText(fault)); } finally { setBusy(false); } };
  useEffect(() => { if (!focusRequest) return; if (busy || pending) { setNotice('当前请求尚待核对，原讨论与定位保持；处理后可再从准确来源打开。'); return; } void choose(focusRequest.source.id).then(() => { if (owner.current === focusRequest.source.id) setFocusedSource(focusRequest.source); }).catch(fault => setError(errorText(fault))); }, [focusRequest?.id]);
  const [mapImportOpen,setMapImportOpen]=useState(false);
  const dispatchMapImport = async (opts: { prompt: string; importSourceIds: string[]; selectedImportPages?: Record<string, number[]>; importMode?: 'review-draft'; supersedesDraftEntryId?: string; workingMapDraft?: StrategyMapDraft; mapTemplate?: keyof typeof mapTemplates; mapRef?: StrategyMapRef }) => {
    if (locked) { const msg = '请等本轮讨论结束后再发起导入或重读。'; setError(msg); throw new Error(msg); }
    setBusy(true); setError(''); setNotice('');
    try {
      let discussion = await ensure(); discussion = await update(discussion);
      const input: api.StrategyDiscussionMessage = {
        requestId: crypto.randomUUID(),
        expectedRevision: discussion.revision,
        text: opts.prompt,
        importSourceIds: opts.importSourceIds,
        ...(opts.selectedImportPages ? { selectedImportPages: opts.selectedImportPages } : {}),
        ...(opts.importMode ? { importMode: opts.importMode } : {}),
        ...(opts.supersedesDraftEntryId ? { supersedesDraftEntryId: opts.supersedesDraftEntryId } : {}),
        ...(opts.workingMapDraft ? { workingMapDraft: opts.workingMapDraft } : {}),
        ...(opts.mapTemplate ? { mapTemplate: opts.mapTemplate } : {}),
        ...(opts.mapRef ? { mapRef: opts.mapRef } : {}),
      };
      const original: api.DiscussionPending = { kind: 'message', discussionId: discussion.id, input };
      journal.value!.remember(original); setPending(original); setSentMapRequest(input.requestId);
      await api.sendStrategyDiscussionMessage(discussion.id, input);
      setStreaming('');
      await read(discussion.id);
      setConnection(value => value + 1);
      onStage?.('compare');
      setNotice('已交给原战略 Agent 生成待核草稿（尚未落盘正式版本），完成后请在战略地图对照原稿核对并一次保存。');
    } catch (fault) {
      if (fault instanceof api.StrategyDiscussionRequestError && !fault.uncertain) {
        const original = journal.value?.read();
        if (original && original.kind !== 'message') { journal.value?.settle(original); setPending(undefined); }
      }
      setError(errorText(fault));
      throw fault;
    } finally { if (live.current) setBusy(false); }
  };
  const messages = detail?.snapshot.messages.filter((message): message is NativeMessage => ['user', 'assistant', 'toolResult', 'bashExecution'].includes(message.role)) || [];
  return <section className="sg-panel strategy-discussion" aria-labelledby={`${id}-title`}><div className="sg-row-between"><h2 id={`${id}-title`}>战略选择 Agent</h2><div className="sg-row"><label>原讨论 <select className="sg-select" disabled={busy || Boolean(pending)} value={detail?.discussion.id || ''} onChange={event => { void choose(event.target.value).catch(fault => setError(errorText(fault))); }}><option value="">新的战略讨论</option>{directory.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{detail && <><button type="button" className="secondary-button" disabled={busy || refreshing} onClick={() => { void refreshDiscussion(); }}>刷新讨论记录</button><span className="sg-muted">读取当前讨论的消息和状态，并尝试接回实时回复</span></>}</div></div>
    {refreshFeedback && <p className={refreshFeedback.role === 'alert' ? 'case-error' : 'case-notice'} role={refreshFeedback.role}>{refreshFeedback.text}</p>}
    <p className="sg-muted">说说你正在考虑的战略问题。可以从比较两个方向开始。</p>
    {onStage && <StrategyWorkbench key={workspaceEpoch} detail={detail} active={active} stage={stage} scopes={scopes} sentRequest={sentMapRequest} onReconciled={()=>setSentMapRequest(undefined)} onSelectContext={v=>{setMapContext({mapId:v.mapId,version:v.version});setMapTemplate(undefined);}} onStage={onStage} onGoalsChanged={onGoalsChanged} ensureDiscussionId={async()=>(await ensure()).id} importDialogOpen={mapImportOpen} onImportDialogOpenChange={setMapImportOpen} onRefreshDiscussion={async()=>{await read().catch(()=>{});}} onExtractMapImport={async req=>{await dispatchMapImport({prompt:req.prompt,importSourceIds:[req.sourceId],selectedImportPages:{[req.sourceId]:req.selectedPages},importMode:'review-draft',mapTemplate:req.template});}} onRereadMap={req=>{const refNote=req.baseRef?`（关联地图 v${req.baseRef.version}，mapId=${req.baseRef.mapId}，expectedVersion=${req.baseRef.version}）`:'（新建独立待核草稿，不要关联已有地图的 mapId）';void dispatchMapImport({prompt:`请严格以随本轮传入的 workingMapDraft 为用户当前已编辑草稿${refNote}，仅在授权原稿与选页范围内调用 read-import-source 局部重读：${req.prompt}。必须保留用户未提及的全部手工修改，并调用 propose-map-draft 返回修订后的待核草稿（不要直接调用 save-map）。`,importSourceIds:req.importSourceIds,selectedImportPages:req.selectedImportPages,importMode:'review-draft',supersedesDraftEntryId:req.supersedesDraftEntryId,workingMapDraft:req.currentDraft,mapRef:req.baseRef}).catch(()=>{});}} onDiscuss={(ref,edgeId,source)=>{
      setMapContext(ref?{mapId:ref.mapId,version:ref.version,...(edgeId?{edgeId}:{})}:undefined);
      setFocusedSource(source);onStage('direction');requestAnimationFrame(()=>document.getElementById(id+'-text')?.focus());
    }}/>}
    <div hidden={stage!=='direction'}>
    <details className="wb-methods"><summary>提问示例</summary><p className="case-help">点选后加入输入框，可编辑后发送。</p><div className="sg-row">{coCreationQuestions.map(([title,prompt])=><button key={title} type="button" className="text-button" disabled={locked} onClick={()=>{const next=text.trim()?text+'\n'+prompt:prompt;setText(next);saveDraft(next,owner.current);document.getElementById(id+'-text')?.focus();}}>{title}</button>)}</div></details>
    <ConversationDrawer title="战略选择 Agent" className="workspace-strategy-conversation">
    {focusedSource && <StrategyDiscussionSourceView source={focusedSource} />}{(messages.length > 0 || Boolean(streaming)) && <StrategyDiscussionTranscript messages={messages} streaming={streaming} discussionId={detail?.discussion.id} references={detail?.attachmentReferences} conversationKey={`discussion:${detail?.discussion.id ?? 'draft'}`} modelLabel={configurations.find(item => detail ? item.id === detail.discussion.configurationId && item.revision === detail.discussion.configurationRevision : item.id === configurationId)?.model ?? '模型待核对'} />}{detail?.busy && <p className="sg-muted" role="status">{activity || 'Agent 正在讨论与核对…'}</p>}
    {(selectedGoal || goal || mapContext) && <div className="sg-row strategy-discussion-context-bar">{selectedGoal && <span className="sg-row"><span className="sg-muted">当前浏览目标：{selectedGoal.title} · v{selectedGoal.version}</span><button type="button" className="text-button" disabled={locked} onClick={() => { setGoal({ goalId: selectedGoal.goalId, version: selectedGoal.version }); if (!detail && !dirtyPurpose.current) setPurpose(goalPurpose(selectedGoal)); setNotice('已选择准确目标；原目标与历史未改写，本轮范围将随下次消息保存。'); }}>围绕此目标讨论</button></span>}{goal && <span className="sg-badge">已绑定目标：目标准确版 v{goal.version}</span>}{mapContext && <span className="sg-row"><span>围绕地图 v{mapContext.version}{mapContext.edgeId?' · 连线 '+mapContext.edgeId:''}</span><button type="button" className="text-button" onClick={()=>setMapContext(undefined)}>回到当前版本</button></span>}</div>}
    <form className="strategy-discussion-composer" onSubmit={event => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor={`${id}-text`}>战略讨论问题</label><textarea id={`${id}-text`} rows={3} value={text} disabled={busy || Boolean(pending)} onChange={event => { setText(event.target.value); try { saveDraft(event.target.value, owner.current); } catch { setError('当前草稿暂未保存到浏览器，请保留输入后核对存储权限。'); } }} placeholder="下季度该优先拓新客，还是提高复购？" />{showPathHint && <p className="case-help" role="note">检测到本地文件路径：路径文本不会上传或授权读取。如需使用电脑文件，请点「＋ 添加资料」；已添加的资料按来源读取。</p>}{attachmentIds.length>chosenAttachments.length && detail && <p role="status">所选资料中有来源当前不可读。<button className="text-button" type="button" onClick={()=>saveAttachmentDraft(detail.discussion.id,chosenAttachments.map(s=>s.id))}>从本轮移除失读资料</button></p>}{chosenAttachments.length>0&&<div className="sg-row" aria-label="本轮所选资料">{chosenAttachments.map(s=><span key={s.id} className="sg-badge" title={s.sha256}>{s.title} · 待发送<button type="button" className="text-button" aria-label={'移除 '+s.title} disabled={locked} onClick={()=>void removeAttachment(s.id)}>×</button></span>)}</div>}<div className="sg-row-between"><div className="sg-row"><StrategyAttachmentPicker locked={locked} projectId={projectId} onList={async()=>((await projectAttachmentLibrary(projectId)).sources).filter(s=>!isDiscussionSourceExcluded({sourceScope,projectAttachmentLineages:detail?.discussion.projectAttachmentLineages},s))} onAdd={attach}/>{onStage&&<button type="button" className="secondary-button" disabled={locked} onClick={()=>setMapImportOpen(true)}>导入战略图</button>}</div>{detail?.busy ? <button type="button" className="secondary-button" disabled={busy} onClick={() => { void control('stop'); }}>停止本轮讨论</button> : <button type="submit" className="primary-button" disabled={(!text.trim()&&!chosenAttachments.length) || locked}>发送讨论</button>}</div></form>
    {pending && <StrategyDiscussionRecoveryActions pending={pending} detail={detail} busy={busy || refreshing} onRecover={() => { void recover(); }} onPrepare={prepareNewRequest} />}{notice && <p className="case-notice" role="status">{notice}</p>}{error && <p className="case-error" role="alert">{error}</p>}
    </ConversationDrawer>
    <details className="strategy-discussion-options"><summary>讨论设置（选填）{purpose ? ` · 已设用途：${usageKindLabels[purpose.kind]}` : ''}</summary>
      <section className="strategy-settings-group"><h3 id={`${id}-purpose-title`}>讨论用途（选填）</h3><p className="case-help">说明组织、部门／业务模块、个人和可选背景，供当前讨论的后续回复参考，可直接留空。只更新本次讨论的后续背景，不修改全局默认、旧目标或已确认方案，不增加资料权限。</p><UsageContextFields id={`${id}-usage`} value={purpose || null} disabled={locked} onChange={value => { dirtyPurpose.current = true; setPurpose(value); }} /></section>
      <section className="strategy-settings-group"><h3 id={`${id}-map-format-title`}>地图输出格式（选填）</h3><p className="case-help">格式是后续发送时的地图整理偏好。可以在对话中请 Agent 整理，完成后到「战略地图」查看。</p><div className="field"><label htmlFor={`${id}-map-template`}>地图输出格式（选填）</label><select id={`${id}-map-template`} value={mapTemplate || ''} disabled={locked} onChange={e => setMapTemplate(e.target.value as keyof typeof mapTemplates || undefined)}><option value="">自动（沿用当前地图或由 Agent 整理）</option>{Object.entries(mapTemplates).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></div></section>
      <section className="strategy-settings-group"><h3 id={`${id}-methods-title`}>指定参考方法（选填） · {methods.length ? methods.map(method => method.name).join(' ＋ ') : '优先参考战略选择框架'}</h3><p className="case-help">指定参考方法是分析偏好，不代表已安装或测评的 Skill。默认优先参考战略选择框架；换选、组合或补充会保留原消息、资料和目标准确版，Agent 根据问题实质使用并说明限制。</p><div className="strategy-methods">{references.map(([key, name]) => <label key={key}><input type="checkbox" disabled={locked} checked={methods.some(method => method.id === key)} onChange={event => setMethods(old => event.target.checked ? [...old, { id: key, name }] : old.filter(method => method.id !== key))} />{name}</label>)}</div><div className="sg-row"><label className="sr-only" htmlFor={`${id}-custom`}>其他参考方法</label><input className="sg-select" id={`${id}-custom`} value={customMethod} disabled={locked} maxLength={300} placeholder="可补充其他方法" onChange={event => setCustomMethod(event.target.value)} /><button type="button" className="text-button" disabled={locked || !customMethod.trim()} onClick={() => { setMethods(old => [...old, { id: `custom-${crypto.randomUUID()}`, name: customMethod.trim() }]); setCustomMethod(''); }}>加入本次参考</button></div>{methods.filter(method => !references.some(([key]) => key === method.id)).map(method => <p className="sg-muted" key={method.id}>{method.name}<button type="button" className="text-button" disabled={locked} onClick={() => setMethods(old => old.filter(item => item.id !== method.id))}>移除本次参考</button></p>)}</section>
      <section className="strategy-settings-group"><h3 id={`${id}-model-sources-title`}>模型与资料范围</h3><div className="field"><label htmlFor={`${id}-model`}>本次模型</label><select id={`${id}-model`} value={configurationId} disabled={locked} onChange={event => setConfigurationId(event.target.value)}><option value="">沿已选择模型</option>{configurations.map(item => <option key={item.id} value={item.id}>{item.name}{item.hasApiKey ? '' : ' · 待配置'}</option>)}</select><button type="button" className="text-button" onClick={onSettings}>前往模型设置</button></div><StrategyDiscussionBackground id={id} selection={{ projectId, sources, sourceScope }} projects={projects} availableSources={availableSources} locked={locked} isExistingDiscussion={Boolean(owner.current)} onChange={value => { setProjectId(value.projectId); setSources(value.sources); setSourceScope(value.sourceScope); if (value.projectId !== projectId) setAvailableSources(undefined); }} onList={() => { void sourceList(); }} />{detail && <button type="button" className="text-button" disabled={locked} onClick={() => { void control('close'); }}>关闭会话，保留历史</button>}</section>
    </details>
    </div>
    {detail && onStage && onHandoff && stage==='strategy-versions' &&
      <StrategyChoicePanel key={detail.discussion.id} detail={detail} scopes={scopes} boundScope={detail.discussion.goal && getGoalScope?.(detail.discussion.goal)} onRefresh={async()=>{await read(detail.discussion.id);}} onHandoff={onHandoff}/>}
    {detail && stage==='direction' && <StrategyDiscussionCandidates goals={detail.goals} discussionId={detail.discussion.id} locked={locked} onReview={(candidate, discussionId) => onReviewCandidate(candidate, discussionId, async () => { const next = await api.reloadDiscussionAfterGoalChange(discussionId, onGoalsChanged); if (live.current && owner.current === discussionId) apply(next); })} />}

  </section>;
}
