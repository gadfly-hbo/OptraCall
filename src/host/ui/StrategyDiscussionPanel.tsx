import { StrategyAttachmentPicker } from './StrategyAttachmentPicker.tsx';
import { fileBase64,projectAttachmentLibrary } from './runtime-client.ts';
import {StrategyWorkbench} from './StrategyWorkbench.tsx';
import {mapTemplates,type StrategyMapRef} from '../strategy-map-types.ts';
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
  ['上期复盘','对照上期战略、实际行动与结果。哪些选择值得延续，哪些仍缺观察？'],
  ['行业与竞品','行业和竞品的哪些变化影响这次选择？请说明资料来源和适用范围。'],
  ['SWOT 分析','结合我们已有的优势、短板、机会与威胁，有哪些可供比较的行动？'],
  ['五力分析','从客户、供应商、竞争者、替代品和新进入者看，哪些压力会改变这次战略取舍？'],
] as const;
const references = [
  ['playing-to-win', '战略选择框架 / Playing to Win'], ['rumelt', 'Rumelt 战略内核'], ['mckinsey', '麦肯锡战略构建要素'], ['bcg', 'BCG 战略调色板'], ['bain', '贝恩核心业务与相邻增长'], ['bsc', 'BSC／战略地图'],
] as const;
const same = (first: unknown, second: unknown): boolean => JSON.stringify(first) === JSON.stringify(second);
const errorText = (fault: unknown) => fault instanceof Error ? fault.message : '讨论操作未完成，原输入与记录保留。';
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
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState<api.DiscussionPending>(), [connection, setConnection] = useState(0), [replacementRequestId, setReplacementRequestId] = useState<string>();
  const [journal] = useState(() => { try { return { value: api.discussionJournal(window.sessionStorage), error: '' }; } catch { return { value: undefined, error: '无法保留原讨论请求编号，请核对浏览器存储权限。' }; } });
  const restoreMessageContext=(discussionId:string,input:api.StrategyDiscussionMessage)=>{
    setMapContext(input.mapRef);setMapTemplate(input.mapTemplate);
    saveAttachmentDraft(discussionId,input.attachmentIds??[]);
  };
  const apply = (next: StrategyDiscussionDetail, choices = false) => {
    const previousSnapshot = presentedSnapshot.current; presentedSnapshot.current = next.snapshot; setStreaming(old => projectDiscussionStreaming(old, { type: 'snapshot', snapshot: next.snapshot }, previousSnapshot));
    owner.current = next.discussion.id; setDetail(next); setReplacementRequestId(readReplacement(next.discussion.id));
    const original = journal.value?.read();
    if (original?.kind === 'message' && original.discussionId === next.discussion.id && api.canSettleDiscussionMessage(next, original.input)) {
      journal.value!.settle(original); setPending(undefined); saveDraft('', next.discussion.id); saveAttachmentDraft(next.discussion.id,[]); sessionStorage.removeItem(draftKey()); sessionStorage.removeItem(replacementKey(next.discussion.id)); setReplacementRequestId(undefined); setText('');
    } else if (!original && next.discussion.pendingInput && readReplacement(next.discussion.id) !== next.discussion.pendingInput.requestId) {
      const restored: api.DiscussionPending = { kind: 'message', discussionId: next.discussion.id, input: next.discussion.pendingInput };
      journal.value?.remember(restored); setPending(restored); saveDraft(restored.input.text, next.discussion.id); setText(restored.input.text);
    }

    if (choices) { const discussion = next.discussion; setAttachmentIds(readAttachmentDraft(discussion.id)); setPurpose(discussion.usageContext); dirtyPurpose.current = false; setMethods(discussion.methods); setGoal(discussion.goal); setConfigurationId(discussion.configurationId); setProjectId(discussion.projectId || ''); setSources(discussion.sources); setSourceScope(discussion.sourceScope); setAvailableSources(undefined); }
    if(choices && next.discussion.pendingInput && readReplacement(next.discussion.id)===next.discussion.pendingInput.requestId){
      restoreMessageContext(next.discussion.id,next.discussion.pendingInput);
    }
  };
  const list = async () => { const result = await api.listStrategyDiscussions(); if (live.current) setDirectory(result.discussions); };
  const read = async (discussionId = owner.current, choices = false) => { if (!discussionId) return; const next = await api.readStrategyDiscussion(discussionId); if (live.current && (!owner.current || owner.current === discussionId)) apply(next, choices); return next; };
  useEffect(() => { live.current = true; return () => { live.current = false; epoch.current++; }; }, []);
  useEffect(() => { if (!active) return; void list().catch(fault => { if (live.current) setError(errorText(fault)); }); if (owner.current) void read().catch(fault => { if (live.current) setError(errorText(fault)); }); }, [active]);
  useEffect(() => {
    const refreshDefault = () => { if (owner.current || dirtyPurpose.current || goal) return; void readUsageContextSettings().then(value => { if (live.current && !owner.current && !dirtyPurpose.current) setPurpose(value.context); }).catch(fault => { if (live.current) setNotice(`默认用途暂不可读取，可直接讨论或明确本次背景。${errorText(fault)}`); }); };
    refreshDefault(); window.addEventListener('optracall-usage-context', refreshDefault); return () => window.removeEventListener('optracall-usage-context', refreshDefault);
  }, [goal?.goalId, goal?.version]);
  useEffect(() => { if (!configurationId && selectedConfigurationId && !owner.current) setConfigurationId(selectedConfigurationId); }, [selectedConfigurationId]);
  useEffect(() => {
    try { const original = journal.value?.read(); if (!original) return; setPending(original);
      const discussionId = original.kind === 'create' ? original.input.operationId : original.discussionId;
      owner.current = discussionId; if (original.kind === 'message') setText(original.input.text);
      if (original.kind === 'create') { setProjectId(original.input.projectId || ''); setSources(original.input.sources || []); setSourceScope(original.input.sourceScope); }
      void read(discussionId, true).then(result => { if (original.kind === 'update' && result) { const input = original.input; if (input.usageContext !== undefined) setPurpose(input.usageContext); if (input.methods) setMethods(input.methods); if (input.goal !== undefined) setGoal(input.goal || undefined); if (input.projectId !== undefined) setProjectId(input.projectId || ''); if (input.sources) setSources(input.sources); if (input.sourceScope) setSourceScope(input.sourceScope); if (input.configurationId) setConfigurationId(input.configurationId); } }).catch(() => setError('原操作尚未核对，输入与编号保留。'));
    } catch (fault) { setError(errorText(fault)); }
  }, []);

  useEffect(() => {
    if (!active || !detail?.discussion.id) return; const discussionId = detail.discussion.id, ticket = ++epoch.current, controller = new AbortController();
    void api.watchStrategyDiscussion(discussionId, event => {
      if (!live.current || controller.signal.aborted || owner.current !== discussionId || ticket !== epoch.current) return;
      const previousSnapshot = presentedSnapshot.current; if (event.type === 'snapshot') presentedSnapshot.current = event.snapshot;
      setStreaming(old => projectDiscussionStreaming(old, event, previousSnapshot));
      if (event.type === 'snapshot' || event.type === 'native' && event.event.type === 'message_end') setDetail(old => old && old.discussion.id === discussionId ? { ...old, snapshot: projectDiscussionSnapshot(old.snapshot, event), ...(event.type === 'snapshot' ? { busy: event.snapshot.status === 'running' } : {}) } : old);
      if (event.type === 'native' && event.event.type === 'tool_execution_start') setActivity(`正在使用 ${event.event.toolName || '已获准工具'}`);
      if (event.type === 'native' && event.event.type === 'tool_execution_end') setActivity('');
      if (event.type === 'run.settled') { setStreaming(''); setActivity(''); if (event.outcome === 'failed') setError(event.error || '本轮讨论未完成，已保存的记录保留。'); void read(discussionId).then(() => onGoalsChanged()).catch(fault => { if (live.current) setError(errorText(fault)); }); void list().catch(() => {}); }
    }, controller.signal).catch(fault => { if (!controller.signal.aborted && live.current && owner.current === discussionId) setError(`实时连接未能核对，可重读原讨论；没有重发消息。${errorText(fault)}`); });
    return () => { controller.abort(); ++epoch.current; };
  }, [active, detail?.discussion.id, connection]);
  const locked = busy || Boolean(detail?.busy) || Boolean(pending);
  const ensure = async (): Promise<StrategyDiscussion> => {
    if (owner.current) return detail?.discussion.id === owner.current ? detail.discussion : (await api.readStrategyDiscussion(owner.current)).discussion;
    if (!journal.value) throw new Error(journal.error);
    const input = { operationId: crypto.randomUUID(), title: text.trim().slice(0, 100) || '战略讨论', ...(configurationId ? { configurationId } : {}), ...(purpose !== undefined ? { usageContext: purpose } : {}), methods, ...(goal ? { goal } : {}), ...(projectId ? { projectId } : {}), sources, sourceScope: sourceScope ?? { mode: 'selected-only' as const } };
    const original: api.DiscussionPending = { kind: 'create', input }; journal.value.remember(original); setPending(original);
    const result = await api.createStrategyDiscussion(input); saveDraft(text, result.discussion.id); owner.current = result.discussion.id; journal.value.settle(original); setPending(undefined); apply(await api.readStrategyDiscussion(result.discussion.id)); await list(); return result.discussion;
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
      journal.value!.settle(original); setPending(undefined); apply(result, original.kind === 'create'); if (original.kind === 'message') { saveDraft('', discussionId); saveAttachmentDraft(discussionId,[]); sessionStorage.removeItem(replacementKey(discussionId)); setReplacementRequestId(undefined); setText(''); } setConnection(value => value + 1); setNotice('已核对原讨论请求，历史与当前状态已重读。'); await list();
    } catch (fault) { setError(errorText(fault)); } finally { setBusy(false); }
  };
  const prepareNewRequest = () => {
    if (busy || pending?.kind !== 'message' || !api.canPrepareDiscussionReplacement(detail, pending.input)) return;
    restoreMessageContext(pending.discussionId,pending.input);saveDraft(pending.input.text, pending.discussionId); sessionStorage.setItem(replacementKey(pending.discussionId), pending.input.requestId); setReplacementRequestId(pending.input.requestId); setText(pending.input.text); journal.value?.settle(pending); setPending(undefined); setNotice('原请求已停止或失败，且未核对到原生原话；输入已保留。下次明确发送会使用新请求编号；不会自动重发。');
  };
  const choose = async (discussionId: string) => {
    if (busy || pending) return; setSentMapRequest(undefined);setWorkspaceEpoch(n=>n+1);setMapContext(undefined);setMapTemplate(undefined);saveDraft(text, owner.current); setError(''); setNotice(''); setText(readDraft(discussionId || undefined));setAttachmentIds(discussionId?readAttachmentDraft(discussionId):[]); setStreaming(''); setFocusedSource(undefined); setDetail(undefined); presentedSnapshot.current = undefined; owner.current = discussionId || undefined; setReplacementRequestId(readReplacement(discussionId));
    if (!discussionId) { setDetail(undefined); setGoal(undefined); setMethods([]); setSources([]); setSourceScope(undefined); setAvailableSources(undefined); setProjectId(''); dirtyPurpose.current = false; setConfigurationId(selectedConfigurationId || ''); setPurpose((await readUsageContextSettings()).context); return; }
    setBusy(true); try { apply(await api.readStrategyDiscussion(discussionId), true); } catch (fault) { setError(errorText(fault)); } finally { setBusy(false); }
  };
  const sourceList = async () => { if (!projectId || locked) return; setBusy(true); setError(''); try { const discussion = await update(await ensure()); setAvailableSources((await api.readStrategyDiscussionSources(discussion.id, projectId)).sources); } catch (fault) { if (fault instanceof api.StrategyDiscussionRequestError && !fault.uncertain) { const original = journal.value?.read(); if (original) journal.value?.settle(original); setPending(undefined); } setError(errorText(fault)); } finally { setBusy(false); } };
  const control = async (action: 'stop' | 'close') => { if (!detail || busy) return; setBusy(true); try { if (action === 'stop') await api.stopStrategyDiscussion(detail.discussion.id, detail.discussion.lastRun?.id); else await api.closeStrategyDiscussion(detail.discussion.id); await read(); setNotice(action === 'stop' ? '已请求停止，已保存记录保留；实际收尾以当前状态为准。' : '会话资源已关闭，原生历史保留，可从原讨论续接。'); } catch (fault) { setError(errorText(fault)); } finally { setBusy(false); } };
  useEffect(() => { if (!focusRequest) return; if (busy || pending) { setNotice('当前请求尚待核对，原讨论与定位保持；处理后可再从准确来源打开。'); return; } void choose(focusRequest.source.id).then(() => { if (owner.current === focusRequest.source.id) setFocusedSource(focusRequest.source); }).catch(fault => setError(errorText(fault))); }, [focusRequest?.id]);
  const messages = detail?.snapshot.messages.filter((message): message is NativeMessage => message.role === 'user' || message.role === 'assistant') || [];
  return <section className="sg-panel strategy-discussion" aria-labelledby={`${id}-title`}><div className="sg-row-between"><h2 id={`${id}-title`}>战略选择 Agent</h2><label>原讨论 <select className="sg-select" disabled={busy || Boolean(pending)} value={detail?.discussion.id || ''} onChange={event => { void choose(event.target.value).catch(fault => setError(errorText(fault))); }}><option value="">新的战略讨论</option>{directory.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div><p className="sg-muted">直接说明问题，已有战略与 GSA 可以沿用；重要选择集中确认，普通讨论与补证由 Agent 推进。</p><div className="sg-row"><span className="sg-muted">本次：{purpose ? usageKindLabels[purpose.kind] : '未设置，仍可工作'}{detail?.discussion.lastRun ? ' · 沿原讨论背景' : ''}{goal ? ` · 目标准确版 v${goal.version}` : ''}</span>{detail && <button type="button" className="text-button" disabled={busy} onClick={() => { void read().then(() => setConnection(value => value + 1)).catch(fault => setError(errorText(fault))); }}>重读原讨论</button>}</div>
    {selectedGoal && <div className="sg-row"><span className="sg-muted">当前浏览目标：{selectedGoal.title} · v{selectedGoal.version}</span><button type="button" className="text-button" disabled={locked} onClick={() => { setGoal({ goalId: selectedGoal.goalId, version: selectedGoal.version }); if (!detail && !dirtyPurpose.current) setPurpose(goalPurpose(selectedGoal)); setNotice('已选择准确目标；原目标与历史未改写，本轮范围将随下次消息保存。'); }}>围绕此目标讨论</button></div>}
    {onStage && <StrategyWorkbench key={workspaceEpoch} detail={detail} active={active} stage={stage} scopes={scopes} sentRequest={sentMapRequest} onReconciled={()=>setSentMapRequest(undefined)} onSelectContext={v=>{setMapContext({mapId:v.mapId,version:v.version});setMapTemplate(undefined);}} onStage={onStage} onGoalsChanged={onGoalsChanged} ensureDiscussionId={async()=>(await ensure()).id} onDiscuss={(ref,edgeId,source)=>{
      setMapContext(ref?{mapId:ref.mapId,version:ref.version,...(edgeId?{edgeId}:{})}:undefined);
      setFocusedSource(source);onStage('direction');requestAnimationFrame(()=>document.getElementById(id+'-text')?.focus());
    }}/>}
    <div hidden={stage!=='direction'}>
    <details className="wb-methods"><summary>复盘、调研与诊断</summary><div className="sg-row">{coCreationQuestions.map(([title,prompt])=><button key={title} type="button" className="text-button" disabled={locked} onClick={()=>{const next=text.trim()?text+'\n'+prompt:prompt;setText(next);saveDraft(next,owner.current);document.getElementById(id+'-text')?.focus();}}>{title}</button>)}</div></details>
    <div className="sg-row wb-methods"><label>地图模板 <select value={mapTemplate||''} onChange={e=>setMapTemplate(e.target.value as keyof typeof mapTemplates || undefined)}><option value="">沿用当前地图或由 Agent 整理</option>{Object.entries(mapTemplates).map(([key,title])=><option key={key} value={key}>{title}</option>)}</select></label>{mapContext && <span>围绕地图 v{mapContext.version}{mapContext.edgeId?' · 连线 '+mapContext.edgeId:''} <button className="text-button" onClick={()=>setMapContext(undefined)}>回到当前版本</button></span>}</div>
    <ConversationDrawer title="战略选择 Agent" className="workspace-strategy-conversation">
    {focusedSource && <StrategyDiscussionSourceView source={focusedSource} />}{(messages.length > 0 || Boolean(streaming)) && <StrategyDiscussionTranscript messages={messages} streaming={streaming} discussionId={detail?.discussion.id} references={detail?.attachmentReferences}/>}{detail?.busy && <p className="sg-muted" role="status">{activity || 'Agent 正在讨论与核对…'}</p>}
    <form className="strategy-discussion-composer" onSubmit={event => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor={`${id}-text`}>战略讨论问题</label><textarea id={`${id}-text`} rows={3} value={text} disabled={busy || Boolean(pending)} onChange={event => { setText(event.target.value); try { saveDraft(event.target.value, owner.current); } catch { setError('当前草稿暂未保存到浏览器，请保留输入后核对存储权限。'); } }} placeholder="可以说：下一阶段应聚焦什么方向？希望比较选择与关键前提。" />{attachmentIds.length>chosenAttachments.length && detail && <p role="status">所选资料中有来源当前不可读。<button className="text-button" type="button" onClick={()=>saveAttachmentDraft(detail.discussion.id,chosenAttachments.map(s=>s.id))}>从本轮移除失读资料</button></p>}{chosenAttachments.length>0&&<div className="sg-row" aria-label="本轮所选资料">{chosenAttachments.map(s=><span key={s.id} className="sg-badge" title={s.sha256}>{s.title} · 待发送<button type="button" className="text-button" aria-label={'移除 '+s.title} disabled={locked} onClick={()=>void removeAttachment(s.id)}>×</button></span>)}</div>}<div className="sg-row-between"><StrategyAttachmentPicker locked={locked} projectId={projectId} onList={async()=>((await projectAttachmentLibrary(projectId)).sources).filter(s=>!isDiscussionSourceExcluded({sourceScope,projectAttachmentLineages:detail?.discussion.projectAttachmentLineages},s))} onAdd={attach}/>{detail?.busy ? <button type="button" className="secondary-button" disabled={busy} onClick={() => { void control('stop'); }}>停止本轮讨论</button> : <button type="submit" className="primary-button" disabled={(!text.trim()&&!chosenAttachments.length) || locked}>发送讨论</button>}</div></form>
    {pending && <StrategyDiscussionRecoveryActions pending={pending} detail={detail} busy={busy} onRecover={() => { void recover(); }} onPrepare={prepareNewRequest} />}{notice && <p className="case-notice" role="status">{notice}</p>}{error && <p className="case-error" role="alert">{error}</p>}
    </ConversationDrawer>
    <details className="strategy-discussion-options"><summary>调整本次背景、模型与资料（按需）</summary><UsageContextFields id={`${id}-usage`} value={purpose || null} disabled={locked} onChange={value => { dirtyPurpose.current = true; setPurpose(value); }} /><p className="case-help">只更新本次讨论的后续背景，不修改全局默认、旧目标或已确认方案，不增加资料权限。</p><div className="field"><label htmlFor={`${id}-model`}>本次模型</label><select id={`${id}-model`} value={configurationId} disabled={locked} onChange={event => setConfigurationId(event.target.value)}><option value="">沿已选择模型</option>{configurations.map(item => <option key={item.id} value={item.id}>{item.name}{item.hasApiKey ? '' : ' · 待配置'}</option>)}</select><button type="button" className="text-button" onClick={onSettings}>前往模型设置</button></div><StrategyDiscussionBackground id={id} selection={{ projectId, sources, sourceScope }} projects={projects} availableSources={availableSources} locked={locked} isExistingDiscussion={Boolean(owner.current)} onChange={value => { setProjectId(value.projectId); setSources(value.sources); setSourceScope(value.sourceScope); if (value.projectId !== projectId) setAvailableSources(undefined); }} onList={() => { void sourceList(); }} />{detail && <button type="button" className="text-button" disabled={locked} onClick={() => { void control('close'); }}>关闭会话，保留历史</button>}</details>
    <details className="strategy-discussion-options"><summary>参考方法（可选） · {methods.length ? methods.map(method => method.name).join(' ＋ ') : '优先参考战略选择框架'}</summary><p className="case-help">参考方法不代表已安装或测评的 Skill。换选、组合或补充会保留原消息、资料和目标准确版；Agent 根据问题实质使用并说明限制。</p><div className="strategy-methods">{references.map(([key, name]) => <label key={key}><input type="checkbox" disabled={locked} checked={methods.some(method => method.id === key)} onChange={event => setMethods(old => event.target.checked ? [...old, { id: key, name }] : old.filter(method => method.id !== key))} />{name}</label>)}</div><div className="sg-row"><label className="sr-only" htmlFor={`${id}-custom`}>其他参考方法</label><input className="sg-select" id={`${id}-custom`} value={customMethod} disabled={locked} maxLength={300} placeholder="可补充其他方法" onChange={event => setCustomMethod(event.target.value)} /><button type="button" className="text-button" disabled={locked || !customMethod.trim()} onClick={() => { setMethods(old => [...old, { id: `custom-${crypto.randomUUID()}`, name: customMethod.trim() }]); setCustomMethod(''); }}>加入本次参考</button></div>{methods.filter(method => !references.some(([key]) => key === method.id)).map(method => <p className="sg-muted" key={method.id}>{method.name}<button type="button" className="text-button" disabled={locked} onClick={() => setMethods(old => old.filter(item => item.id !== method.id))}>移除本次参考</button></p>)}</details>
    </div>
    {detail && onStage && onHandoff && stage==='strategy-versions' &&
      <StrategyChoicePanel key={detail.discussion.id} detail={detail} scopes={scopes} boundScope={detail.discussion.goal && getGoalScope?.(detail.discussion.goal)} onRefresh={async()=>{await read(detail.discussion.id);}} onHandoff={onHandoff}/>}
    {detail && stage==='direction' && <StrategyDiscussionCandidates goals={detail.goals} discussionId={detail.discussion.id} locked={locked} onReview={(candidate, discussionId) => onReviewCandidate(candidate, discussionId, async () => { const next = await api.reloadDiscussionAfterGoalChange(discussionId, onGoalsChanged); if (live.current && owner.current === discussionId) apply(next); })} />}

  </section>;
}
