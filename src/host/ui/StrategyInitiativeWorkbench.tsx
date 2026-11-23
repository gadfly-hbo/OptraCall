import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { CaseDialog, CaseFormError, useOperationId } from './CaseDialogs.tsx';
import { StrategyDiscussionTranscript } from './StrategyDiscussionReply.tsx';
import { projectDiscussionSnapshot, projectDiscussionStreaming } from './strategy-discussion-projection.ts';
import { fileBase64 } from './runtime-client.ts';
import type { NativeMessage, PublicModelConfiguration } from './project-types.ts';
import type { GoalScope } from '../strategy-goals-types.ts';
import type { CandidateVersion } from '../strategy-initiative-types.ts';
import { initiativeScopeKey } from '../strategy-initiative-types.ts';
import type { ManagementStage, StrategyStage } from './ManagementTabs.tsx';
import * as api from './strategy-initiative-client.ts';
import type { CandidateDetail, InitiativeFile, InitiativeHistory, InitiativePublication, InitiativeRecord, InitiativeSessionDetail, ReportsView } from './strategy-initiative-client.ts';
import { Badge, CandidateBody, InitiativeFilePanel, KickoffBody, LifecyclePlaceholderDialog, candidateLabel, candidateStatus, kickoffPatchTargets, latestBatch, publicationFor } from './strategy-initiative-view.tsx';
import type { PatchTarget, ReportFileEntry } from './strategy-initiative-view.tsx';
import { StrategyCheckPanel, StrategyReleaseReview, StrategyVersionsPanel, LegacyDiscussionReadback } from './StrategyInitiativeGovernance.tsx';
import type { CandidateRef, LegacyDiscussionAccess } from './StrategyInitiativeGovernance.tsx';
import { listStrategyDiscussions } from './strategy-discussion-client.ts';
import './strategy-initiative.css';

const errorText = api.errorText;
const transcriptMessages = (snapshot: { messages: Record<string, unknown>[] } | null | undefined): NativeMessage[] =>
  (snapshot?.messages ?? []).filter((message): message is NativeMessage => ['user', 'assistant', 'toolResult', 'bashExecution'].includes((message as { role?: string }).role ?? ''));
const draftKey = (id: string, scopeKey: string) => `optracall.strategy-initiative.draft.v1:${id}:${scopeKey}`;
const journalKey = (id: string, scopeKey: string) => `optracall.strategy-initiative.pending.v1:${id}:${scopeKey}`;
const readDraft = (id: string, scopeKey: string): string => { try { return sessionStorage.getItem(draftKey(id, scopeKey)) || ''; } catch { return ''; } };
const saveDraft = (id: string, scopeKey: string, text: string) => { try { sessionStorage.setItem(draftKey(id, scopeKey), text); } catch { /* input stays in memory */ } };
const sameRef = (candidate: CandidateVersion, ref: CandidateRef | null) => Boolean(ref && candidate.candidateId === ref.candidateId && candidate.no === ref.no);

export interface StrategyInitiativeWorkbenchProps {
  stage: StrategyStage; onStage: (stage: ManagementStage) => void; active: boolean;
  access: LegacyDiscussionAccess; legacyFocus?: { source: import('../strategy-goals-types.ts').GoalDiscussionSourceRef; id: string };
  configurations: PublicModelConfiguration[]; selectedConfigurationId?: string | null; onSettings: () => void;
}
export function StrategyInitiativeWorkbench({ stage, onStage, active, access, legacyFocus, configurations, selectedConfigurationId, onSettings }: StrategyInitiativeWorkbenchProps) {
  const [initiatives, setInitiatives] = useState<InitiativeRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [scopeKeys, setScopeKeys] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null);
  const [placeholder, setPlaceholder] = useState<'战略复盘' | '战略重构' | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refreshList = async () => {
    try { const result = await api.listInitiatives(); if (!alive.current) return; setInitiatives(result.initiatives); setSelectedId(old => result.initiatives.some(item => item.id === old) ? old : result.initiatives[0]?.id ?? ''); setError(''); }
    catch (fault) { if (alive.current) setError(errorText(fault)); }
    finally { if (alive.current) setLoading(false); }
  };
  useEffect(() => { if (active) void refreshList(); }, [active]);
  const initiative = initiatives.find(item => item.id === selectedId);
  const scopeKey = initiative ? scopeKeys[initiative.id] ?? (initiative.scopes[0] ? initiativeScopeKey(initiative.scopes[0]) : '') : '';
  const scope = initiative?.scopes.find(item => initiativeScopeKey(item) === scopeKey);
  return <div className="si-workbench">
    <div className="si-topbar">
      <label className="si-inline-picker">战略事项<select aria-label="战略事项" disabled={loading} value={selectedId} onChange={event => setSelectedId(event.target.value)}>
        {!initiatives.length && <option value="">尚无事项</option>}
        {initiatives.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      <button type="button" className="secondary-button" onClick={() => setEditor('create')}>＋ 新建事项</button>
      {initiative && <button type="button" className="text-button" onClick={() => setEditor('edit')}>编辑事项与范围</button>}
      {initiative && initiative.scopes.length > 0 && <label className="si-inline-picker">适用范围<select aria-label="适用范围" value={scopeKey} onChange={event => setScopeKeys(old => ({ ...old, [initiative.id]: event.target.value }))}>
        {initiative.scopes.map(item => <option key={initiativeScopeKey(item)} value={initiativeScopeKey(item)}>{item.name}</option>)}
      </select></label>}
      <span className="si-lifecycle-placeholders">
        <button type="button" className="text-button" onClick={() => setPlaceholder('战略复盘')}>战略复盘 · 占位</button>
        <button type="button" className="text-button" onClick={() => setPlaceholder('战略重构')}>战略重构 · 占位</button>
      </span>
    </div>
    <CaseFormError error={error} />
    {loading ? <p className="si-muted" role="status">正在读取战略事项…</p> : !initiative || !scope ? <>
      <div className="sg-panel si-empty">
        <h2>从一个战略事项开始</h2><p>事项承载开题、候选、检验与发布；范围区分组织／业务归属，各自保留应用指针、访谈与资料。</p>
        <button type="button" className="primary-button" onClick={() => setEditor('create')}>新建战略事项</button>
      </div>
      {stage === 'strategy-versions' && <LegacyWithoutInitiative access={access} legacyFocus={legacyFocus} />}
    </> : <InitiativeScopeWorkspace
      key={`${initiative.id}:${scopeKey}`}
      initiative={initiative} scope={scope} stage={stage} active={active} onStage={onStage}
      access={access} legacyFocus={legacyFocus}
      configurations={configurations} selectedConfigurationId={selectedConfigurationId} onSettings={onSettings}
      onInitiativeChanged={async () => { await refreshList(); }}
    />}
    {editor && <InitiativeEditorDialog initial={editor === 'edit' ? initiative : undefined} onClose={() => setEditor(null)} onSaved={async record => { setEditor(null); await refreshList(); setSelectedId(record.id); }} />}
    {placeholder && <LifecyclePlaceholderDialog module={placeholder} onClose={() => setPlaceholder(null)} />}
  </div>;
}

function LegacyWithoutInitiative({ access, legacyFocus }: { access: LegacyDiscussionAccess; legacyFocus?: { source: import('../strategy-goals-types.ts').GoalDiscussionSourceRef; id: string } }) {
  const [discussions, setDiscussions] = useState<{ id: string; title: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!access.active) return;
    let alive = true;
    void listStrategyDiscussions().then(result => { if (alive) setDiscussions(result.discussions.map(item => ({ id: item.id, title: item.title }))); }).catch(fault => { if (alive) setError(errorText(fault)); });
    return () => { alive = false; };
  }, [access.active]);
  useEffect(() => { if (legacyFocus) setSelected(legacyFocus.source.id); }, [legacyFocus?.id]);
  return <section className="sg-panel si-panel" aria-label="原战略讨论">
    <h2>原战略讨论</h2>
    <p className="si-muted">尚未建立战略事项；旧讨论仍可按原准确引用回读。新建事项后，版本管理将集中展示开题、候选、检验与发布台账。</p>
    <CaseFormError error={error} />
    {discussions.length ? <label className="si-inline-picker">选择旧讨论<select aria-label="选择旧讨论" value={selected} onChange={event => setSelected(event.target.value)}><option value="">不回读</option>{discussions.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label> : <p className="si-muted">尚无旧讨论记录。</p>}
    {selected && <LegacyDiscussionReadback key={selected} discussionId={selected} access={access} focusRequest={legacyFocus} />}
  </section>;
}

function InitiativeEditorDialog({ initial, onClose, onSaved }: { initial?: InitiativeRecord; onClose: () => void; onSaved: (record: InitiativeRecord) => Promise<void> }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [rows, setRows] = useState<GoalScope[]>(initial?.scopes.length ? initial.scopes.map(scope => ({ ...scope })) : [{ kind: 'department', id: '', name: '' }]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operationId = useOperationId();
  const change = (index: number, patch: Partial<GoalScope>) => setRows(old => old.map((row, at) => at === index ? { ...row, ...patch } : row));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = title.trim();
    const scopes = rows.map(row => ({ kind: row.kind, id: row.id.trim(), name: row.name.trim(), ...(row.kind === 'department' && row.enterpriseId?.trim() ? { enterpriseId: row.enterpriseId.trim() } : {}) })).filter(row => row.id && row.name);
    if (!cleaned || !scopes.length) { setError('请填写事项名称，并至少保留一个标识与名称齐全的范围。'); return; }
    if (new Set(scopes.map(scope => initiativeScopeKey(scope))).size !== scopes.length) { setError('范围归属标识重复，请核对后再保存。'); return; }
    setBusy(true); setError('');
    const action = initial
      ? api.updateInitiative(initial.id, { expectedRevision: initial.revision, title: cleaned, scopes })
      : api.createInitiative({ operationId: operationId({ title: cleaned, scopes }), title: cleaned, scopes });
    void action.then(result => onSaved(result.initiative)).catch(fault => setError(errorText(fault))).finally(() => setBusy(false));
  };
  return <CaseDialog title={initial ? '编辑战略事项' : '新建战略事项'} subtitle="范围持有实际组织／业务归属；切换范围保留各自的应用指针、访谈与资料。" busy={busy} onClose={onClose}>
    <form onSubmit={submit}>
      <div className="case-field"><label htmlFor="si-initiative-title">事项名称</label><input id="si-initiative-title" required maxLength={200} disabled={busy} value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：华东门店增长战略" /></div>
      {rows.map((row, index) => <fieldset className="si-scope-row" key={index}>
        <legend>范围 {index + 1}</legend>
        <div className="case-form-row">
          <div className="case-field"><label htmlFor={`si-scope-kind-${index}`}>层级</label><select id={`si-scope-kind-${index}`} disabled={busy} value={row.kind} onChange={event => change(index, { kind: event.target.value as GoalScope['kind'] })}><option value="enterprise">企业</option><option value="department">部门／业务</option><option value="personal">个人</option></select></div>
          <div className="case-field"><label htmlFor={`si-scope-name-${index}`}>范围名称</label><input id={`si-scope-name-${index}`} maxLength={200} disabled={busy} value={row.name} onChange={event => change(index, { name: event.target.value })} placeholder="例如：华东零售事业部" /></div>
        </div>
        <div className="case-form-row">
          <div className="case-field"><label htmlFor={`si-scope-id-${index}`}>归属标识</label><input id={`si-scope-id-${index}`} maxLength={200} disabled={busy} value={row.id} onChange={event => change(index, { id: event.target.value })} placeholder="稳定标识，改名不另开范围" /></div>
          {row.kind === 'department' && <div className="case-field"><label htmlFor={`si-scope-enterprise-${index}`}>上层企业标识（可选）</label><input id={`si-scope-enterprise-${index}`} maxLength={200} disabled={busy} value={row.enterpriseId ?? ''} onChange={event => change(index, { enterpriseId: event.target.value })} /></div>}
        </div>
        {rows.length > 1 && <button type="button" className="text-button" disabled={busy} onClick={() => setRows(old => old.filter((_, at) => at !== index))}>移除此范围</button>}
      </fieldset>)}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => setRows(old => [...old, { kind: 'department', id: '', name: '' }])}>＋ 添加范围</button>
      <CaseFormError error={error} />
      <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy}>{busy ? '正在保存…' : initial ? '保存事项' : '创建事项'}</button></div>
    </form>
  </CaseDialog>;
}

interface WorkspaceProps {
  initiative: InitiativeRecord; scope: GoalScope; stage: StrategyStage; active: boolean; onStage: (stage: ManagementStage) => void;
  access: LegacyDiscussionAccess; legacyFocus?: { source: import('../strategy-goals-types.ts').GoalDiscussionSourceRef; id: string };
  configurations: PublicModelConfiguration[]; selectedConfigurationId?: string | null; onSettings: () => void;
  onInitiativeChanged: () => Promise<void>;
}
export function InitiativeScopeWorkspace({ initiative, scope, stage, active, onStage, access, legacyFocus, configurations, selectedConfigurationId, onSettings }: WorkspaceProps) {
  const id = initiative.id, scopeKey = initiativeScopeKey(scope);
  const [reports, setReports] = useState<ReportsView>({ versions: [], anchors: {} });
  const [session, setSession] = useState<InitiativeSessionDetail | null>(null);
  const [files, setFiles] = useState<InitiativeFile[]>([]);
  const [candidates, setCandidates] = useState<CandidateVersion[]>([]);
  const [publications, setPublications] = useState<InitiativePublication[]>([]);
  const [history, setHistory] = useState<InitiativeHistory | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [phase, setPhase] = useState<'kickoff' | 'plans'>('kickoff');
  const [reportNo, setReportNo] = useState<number | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateRef | null>(null);
  const [draft, setDraft] = useState(() => readDraft(id, scopeKey));
  const [streaming, setStreaming] = useState(''), [activity, setActivity] = useState('');
  const [pending, setPending] = useState<{ requestId: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false), [connection, setConnection] = useState(0);
  const [dialog, setDialog] = useState<'new-candidate' | 'lock-report' | 'lock-candidate' | 'revise-report' | 'revise-candidate' | 'candidate-session' | null>(null);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [fileBusy, setFileBusy] = useState(false), [fileError, setFileError] = useState('');
  const [legacyId, setLegacyId] = useState('');
  const alive = useRef(true), presentedSnapshot = useRef<InitiativeSessionDetail['snapshot']>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    try { const raw = sessionStorage.getItem(journalKey(id, scopeKey)); if (raw) { const value = JSON.parse(raw) as { requestId: string; text: string }; if (value?.requestId) { setPending(value); if (!readDraft(id, scopeKey)) setDraft(value.text); } } } catch { /* journal unreadable: keep inputs in memory */ }
  }, [id, scopeKey]);
  useEffect(() => { if (legacyFocus) setLegacyId(legacyFocus.source.id); }, [legacyFocus?.id]);

  const applySession = (next: InitiativeSessionDetail | null) => {
    const previous = presentedSnapshot.current; presentedSnapshot.current = next?.snapshot ?? null;
    setStreaming(old => next ? projectDiscussionStreaming(old, { type: 'snapshot', snapshot: next.snapshot ?? { sessionId: '', messages: [], tools: [], status: 'idle', sdkVersion: '', capabilities: {} } }, previous ?? undefined) : '');
    if (!next?.busy) setActivity('');
    setSession(next);
  };
  const refresh = async () => {
    const [reportResult, sessionResult, fileResult, candidateResult, publicationResult, historyResult] = await Promise.allSettled([
      api.readKickoffReports(id),
      api.readInitiativeSession(id, scopeKey).catch(fault => { if (fault instanceof api.StrategyInitiativeRequestError && fault.status === 404) return null; throw fault; }),
      api.listInitiativeFiles(id, scopeKey),
      api.listCandidates(id, scopeKey),
      api.listPublications(id, scopeKey),
      api.readInitiativeHistory(id),
    ]);
    if (!alive.current) return;
    if (reportResult.status === 'fulfilled') setReports(reportResult.value);
    if (sessionResult.status === 'fulfilled') applySession(sessionResult.value);
    if (fileResult.status === 'fulfilled') setFiles(fileResult.value.files);
    if (candidateResult.status === 'fulfilled') setCandidates(candidateResult.value.candidates);
    if (publicationResult.status === 'fulfilled') setPublications(publicationResult.value.publications);
    if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
    const faults = [reportResult, sessionResult, fileResult, candidateResult, publicationResult, historyResult].filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    setError(faults.length ? errorText(faults[0]!.reason) : '');
    setLoading(false);
  };
  useEffect(() => { if (active) void refresh(); }, [active, id, scopeKey]);
  const running = candidates.some(candidate => candidate.lastRun?.status === 'accepted') || Boolean(history?.verifications.some(batch => batch.state === 'running'));
  useEffect(() => {
    if (!active || !running) return;
    const timer = setInterval(() => {
      void Promise.allSettled([api.listCandidates(id, scopeKey), api.readInitiativeHistory(id), api.listPublications(id, scopeKey)]).then(([candidateResult, historyResult, publicationResult]) => {
        if (!alive.current) return;
        if (candidateResult.status === 'fulfilled') setCandidates(candidateResult.value.candidates);
        if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
        if (publicationResult.status === 'fulfilled') setPublications(publicationResult.value.publications);
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [active, running, id, scopeKey]);
  useEffect(() => {
    if (!active || stage !== 'co-create' || !session) return;
    const controller = new AbortController();
    void api.watchInitiativeEvents(id, scopeKey, event => {
      if (controller.signal.aborted || !alive.current) return;
      const previous = presentedSnapshot.current;
      if (event.type === 'snapshot') { presentedSnapshot.current = event.snapshot; setSession(old => old ? { ...old, snapshot: event.snapshot, busy: event.snapshot.status === 'running' } : old); }
      setStreaming(old => projectDiscussionStreaming(old, event, previous ?? undefined));
      if (event.type === 'native' && event.event.type === 'tool_execution_start') setActivity(`正在使用 ${event.event.toolName || '已获准工具'}`);
      if (event.type === 'native' && event.event.type === 'tool_execution_end') setActivity('');
      if (event.type === 'run.settled') { setStreaming(''); setActivity(''); if (event.outcome === 'failed') setError(event.error || '本轮讨论未完成，已保存的记录保留。'); void refresh(); }
    }, controller.signal).catch(() => { if (!controller.signal.aborted && alive.current) setNotice('实时连接暂不可用，可刷新讨论记录；未重发消息。'); });
    return () => controller.abort();
  }, [active, stage, session?.session.scopeKey, connection]);

  const anchor = reports.anchors[scopeKey];
  const report = reports.versions.find(version => version.no === reportNo) ?? reports.versions.at(-1);
  const current = candidates.find(candidate => sameRef(candidate, selectedCandidate)) ?? candidates.at(-1);
  const sessionBusy = Boolean(session?.busy || session?.snapshot?.status === 'running');
  const locked = busy || Boolean(pending) || sessionBusy;
  const modelLabel = configurations.find(item => session ? item.id === session.session.configurationId && item.revision === session.session.configurationRevision : item.id === selectedConfigurationId)?.model ?? '模型待核对';

  const rememberPending = (value: { requestId: string; text: string } | null) => {
    setPending(value);
    try { if (value) sessionStorage.setItem(journalKey(id, scopeKey), JSON.stringify(value)); else sessionStorage.removeItem(journalKey(id, scopeKey)); } catch { /* keep in memory */ }
  };
  const sendMain = async (text: string, replacePendingRequestId?: string) => {
    if (locked || !text.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      let detail = session;
      if (!detail) {
        await api.createInitiativeSession(id, { operationId: crypto.randomUUID(), scope, ...(selectedConfigurationId ? { configurationId: selectedConfigurationId } : {}) });
        detail = await api.readInitiativeSession(id, scopeKey);
      }
      const input = { requestId: crypto.randomUUID(), text: text.trim(), expectedRevision: detail.session.revision, ...(replacePendingRequestId ? { replacePendingRequestId } : {}) };
      rememberPending(input);
      await api.sendInitiativeMessage(id, scopeKey, input);
      rememberPending(null);
      setDraft(''); saveDraft(id, scopeKey, ''); setStreaming('');
      applySession(await api.readInitiativeSession(id, scopeKey));
      setConnection(value => value + 1);
    } catch (fault) {
      if (fault instanceof api.StrategyInitiativeRequestError && !fault.uncertain) rememberPending(null);
      setError(errorText(fault));
    } finally { if (alive.current) setBusy(false); }
  };
  const recover = async () => {
    if (!pending || busy) return;
    setBusy(true); setError('');
    try {
      const detail = await api.readInitiativeSession(id, scopeKey).catch(fault => { if (fault instanceof api.StrategyInitiativeRequestError && fault.status === 404) return null; throw fault; });
      if (detail && (detail.session.lastRun?.id === pending.requestId || detail.session.pendingInput?.requestId === pending.requestId)) {
        rememberPending(null); applySession(detail); setConnection(value => value + 1); setNotice('已核对原请求，历史与当前状态已重读。');
      } else setError('尚未核对到原请求已受理；输入与原编号保留，未自动重发。');
    } catch (fault) { setError(errorText(fault)); } finally { if (alive.current) setBusy(false); }
  };
  const control = async (action: 'stop' | 'close' | 'refresh') => {
    if (busy) return; setBusy(true); setError('');
    try {
      if (action === 'stop') { await api.stopInitiativeSession(id, scopeKey, session?.session.lastRun?.id); setNotice('已请求停止，已保存记录保留；实际收尾以当前状态为准。'); }
      else if (action === 'close') { await api.closeInitiativeSession(id, scopeKey); setNotice('会话资源已关闭，原生历史保留，可继续对话重开。'); }
      applySession(await api.readInitiativeSession(id, scopeKey).catch(fault => { if (fault instanceof api.StrategyInitiativeRequestError && fault.status === 404) return null; throw fault; }));
      setConnection(value => value + 1);
      if (action === 'refresh') setNotice('已刷新讨论记录，消息与状态已同步。');
    } catch (fault) { setError(errorText(fault)); } finally { if (alive.current) setBusy(false); }
  };
  const upload = async (directory: '010_draw' | '020_clean', file: File, scopeExclusive: boolean) => {
    if (fileBusy) return;
    if (file.size > 50 * 1024 * 1024) { setFileError('单文件不超过 50 MiB。'); return; }
    setFileBusy(true); setFileError('');
    try {
      const contentBase64 = await fileBase64(file);
      await api.uploadInitiativeFile(id, { operationId: crypto.randomUUID(), directory, name: file.name, contentBase64, ...(scopeExclusive ? { scopeKey } : {}) });
      const result = await api.listInitiativeFiles(id, scopeKey);
      if (alive.current) { setFiles(result.files); setNotice('资料已加入当前事项；上传本身不调用模型。'); }
    } catch (fault) { if (alive.current) setFileError(errorText(fault)); } finally { if (alive.current) setFileBusy(false); }
  };
  const openFile = async (file: InitiativeFile) => {
    setFileError('');
    try {
      const result = await api.readInitiativeFile(id, file.fileId, file.scopeKey ?? scopeKey);
      const bytes = Uint8Array.from(atob(result.contentBase64), char => char.charCodeAt(0));
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { setPreview({ title: file.name, content: '二进制原件暂不支持文本预览；请按元数据引用，需要正文时提供文本版本。' }); return; }
      if (bytes.includes(0)) { setPreview({ title: file.name, content: '二进制原件暂不支持文本预览；请按元数据引用。' }); return; }
      setPreview({ title: file.name, content: text });
    } catch (fault) { setFileError(errorText(fault)); }
  };

  const comparable = (() => {
    if (!anchor) return [];
    const rows = candidates.filter(candidate => candidate.anchor.reportNo === anchor.reportNo && candidate.blocks.length > 0);
    return rows.filter(candidate => !rows.some(newer => newer.candidateId === candidate.candidateId && newer.no > candidate.no));
  })();
  const conversation = (heading: string, hint: string, placeholder: string) => <section className="sg-panel si-panel si-conversation" aria-label={heading}>
    <div className="si-panel-head"><div><h2>{heading}</h2><p className="si-muted">{hint}</p></div><Badge tone="accent">主会话</Badge></div>
    {(transcriptMessages(session?.snapshot).length > 0 || Boolean(streaming)) && <StrategyDiscussionTranscript messages={transcriptMessages(session?.snapshot)} streaming={streaming} conversationKey={`initiative:${id}:${scopeKey}`} modelLabel={modelLabel} label={heading} />}
    {sessionBusy && <p className="si-muted" role="status">{activity || 'Agent 正在讨论与核对…'}</p>}
    <form className="si-composer" onSubmit={event => { event.preventDefault(); void sendMain(draft); }}>
      <label className="sr-only" htmlFor="si-main-text">{heading}输入</label>
      <textarea id="si-main-text" rows={3} maxLength={20000} value={draft} disabled={busy || Boolean(pending)} placeholder={placeholder} onChange={event => { setDraft(event.target.value); saveDraft(id, scopeKey, event.target.value); }} />
      <div className="si-actions">
        {session && <button type="button" className="text-button" disabled={busy} onClick={() => { void control('refresh'); }}>刷新讨论记录</button>}
        {session && <button type="button" className="text-button" disabled={busy} onClick={() => { void control('close'); }}>关闭会话，保留历史</button>}
        {sessionBusy ? <button type="button" className="secondary-button" disabled={busy} onClick={() => { void control('stop'); }}>停止本轮讨论</button> : <button type="submit" className="primary-button" disabled={!draft.trim() || locked}>发送讨论</button>}
      </div>
    </form>
    {pending && <div className="sg-unknown"><p>原请求结果待核，输入与原编号保留；未重发模型。</p><button type="button" className="secondary-button" disabled={busy} onClick={() => { void recover(); }}>核对原请求</button>{['failed', 'cancelled'].includes(session?.session.lastRun?.status ?? '') && <button type="button" className="secondary-button" disabled={busy || !(draft || pending.text).trim()} onClick={() => { void sendMain(draft || pending.text, pending.requestId); }}>替换原请求并发送</button>}<details><summary>原请求编号</summary><code>{pending.requestId}</code></details></div>}
    {!session && !loading && <p className="si-muted">首次发送将为本范围创建主会话；模型沿当前选择。<button type="button" className="text-button" onClick={onSettings}>前往模型设置</button></p>}
  </section>;

  const kickoff = <section className="sg-panel si-panel" aria-label="开题报告">
    <div className="si-panel-head"><div><p className="si-eyebrow">战略启动 · 诊断锚定</p><h2>开题报告{report ? ` v${report.no}` : ''}</h2></div>{report && <Badge tone={report.lock ? (anchor?.reportNo === report.no ? 'positive' : 'accent') : 'neutral'}>{report.lock ? (anchor?.reportNo === report.no ? '已应用为方案输入' : '已锁定') : '草稿'}</Badge>}</div>
    {reports.versions.length > 1 && <label className="si-inline-picker">报告版本<select aria-label="报告版本" value={report?.no ?? ''} onChange={event => setReportNo(Number(event.target.value))}>{reports.versions.slice().reverse().map(version => <option key={version.no} value={version.no}>开题报告 v{version.no}</option>)}</select></label>}
    {loading ? <p className="si-muted" role="status">正在读取开题报告…</p> : !report ? <div className="si-empty"><p>围绕战略命题与主 Agent 多轮访谈；Agent 保存草稿后在此核对、锁定并应用。资料不足时允许沿用公开资料与明确假设开题。</p></div> : <>
      <KickoffBody version={report} />
      <p className="si-validation">{report.fields.propositions.length >= 3 && report.fields.propositions.length <= 5 && report.fields.horizon.trim() && report.fields.diagnosis.trim() ? '✓ Schema 校验通过' : '⚠ Schema 待补全'} · {report.lock ? '已完成报告审核' : '待人工审核'}</p>
      <div className="si-actions">
        {!report.lock && <button type="button" className="primary-button" disabled={busy} onClick={() => setDialog('lock-report')}>核对并锁定</button>}
        {report.lock && anchor?.reportNo !== report.no && <button type="button" className="primary-button" disabled={busy} onClick={() => {
          if (busy) return; setBusy(true); setError(''); setNotice('');
          void api.applyKickoffReport(id, report.no, { operationId: crypto.randomUUID(), sha256: report.contentSha256, scope })
            .then(async () => { await refresh(); setNotice(`已应用开题报告 v${report.no} 作为本范围方案输入。`); setPhase('plans'); })
            .catch(fault => setError(errorText(fault))).finally(() => { if (alive.current) setBusy(false); });
        }}>用作方案输入</button>}
        {anchor?.reportNo === report.no && <button type="button" className="primary-button" onClick={() => setPhase('plans')}>进入方案成型</button>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setDialog('revise-report')}>限定修改</button>
      </div>
    </>}
  </section>;

  const plans = !anchor ? <section className="sg-panel si-empty"><h2>先确定开题报告</h2><p>锁定开题报告并用作方案输入，即可开始形成候选。</p><button type="button" className="primary-button" onClick={() => setPhase('kickoff')}>回到开题报告</button></section> : <>
    <section className="sg-panel si-panel" aria-label="战略候选">
      <div className="si-panel-head"><div><p className="si-eyebrow">战略规划 · 方案成型</p><h2>战略候选</h2><p className="si-muted">方案输入 <strong>开题报告 v{anchor.reportNo}</strong> · {scope.name}</p></div><button type="button" className="primary-button" disabled={busy} onClick={() => setDialog('new-candidate')}>＋ 新建候选</button></div>
      {candidates.length ? <div className="si-candidate-grid">{candidates.slice().reverse().map(candidate => {
        const status = candidateStatus(candidate, { batch: latestBatch(history?.verifications ?? [], candidate), publication: publicationFor(publications, candidate) });
        return <button type="button" key={`${candidate.candidateId}:${candidate.no}`} className={`si-candidate-card${current && sameRef(candidate, { candidateId: current.candidateId, no: current.no }) ? ' is-selected' : ''}`} aria-pressed={Boolean(current && sameRef(candidate, { candidateId: current.candidateId, no: current.no }))} onClick={() => setSelectedCandidate({ candidateId: candidate.candidateId, no: candidate.no })}>
          <strong>{candidateLabel(candidate)}</strong>
          <span className="si-muted">候选会话 {candidate.candidateId.slice(0, 8)} · 开题 v{candidate.anchor.reportNo}{candidate.parent ? ` · 修订自 v${candidate.parent.no}` : ''}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
        </button>;
      })}</div> : <div className="si-empty"><p>为一个备选方向创建独立会话。完成后，候选将回到这里供核对。</p></div>}
    </section>
    {current && <CandidateDetailPanel candidate={current} batch={latestBatch(history?.verifications ?? [], current)} publication={publicationFor(publications, current)} busy={busy}
      onLock={() => setDialog('lock-candidate')} onRevise={() => setDialog('revise-candidate')} onSession={() => setDialog('candidate-session')} onStage={onStage} />}
    {comparable.length > 1 && conversation('主会话 · 候选比较', `围绕开题报告 v${anchor.reportNo}，比较 ${comparable.length} 个候选方向。`, '例如：预算固定时，两种方案的主要取舍是什么？')}
  </>;

  return <div className="si-layout">
    <div className="si-main">
      {notice && <p className="case-notice" role="status">{notice}</p>}
      <CaseFormError error={error} />
      {stage === 'co-create' && <>
        <div className="si-phase-tabs" role="group" aria-label="共创阶段">
          <button type="button" className="si-phase-btn" aria-pressed={phase === 'kickoff'} onClick={() => setPhase('kickoff')}>启动 · 开题报告</button>
          <button type="button" className="si-phase-btn" aria-pressed={phase === 'plans'} onClick={() => setPhase('plans')}>方案成型 · 战略候选</button>
        </div>
        {phase === 'kickoff' ? <>{kickoff}{conversation('访谈与研究', '围绕战略命题继续追问，或补充依据。', '补充一个事实，或继续追问一个战略命题…')}</> : plans}
      </>}
      {stage === 'strategy-check' && <StrategyCheckPanel initiativeId={id} candidates={candidates} batches={history?.verifications ?? []} selected={selectedCandidate} onSelect={setSelectedCandidate} onStage={onStage} onRevise={candidate => { setSelectedCandidate({ candidateId: candidate.candidateId, no: candidate.no }); setDialog('revise-candidate'); }} onRefresh={refresh} />}
      {stage === 'strategy-release' && <StrategyReleaseReview initiativeId={id} scope={scope} scopes={access.scopes} candidates={candidates} batches={history?.verifications ?? []} publications={publications} selected={selectedCandidate} onSelect={setSelectedCandidate} onStage={onStage} onRefresh={refresh} onGoalsChanged={async () => { await access.onGoalsChanged(); }} />}
      {stage === 'strategy-versions' && <StrategyVersionsPanel initiativeId={id} scopeKey={scopeKey} history={history} access={access} legacyId={legacyId} onLegacySelect={setLegacyId} legacyFocus={legacyFocus} />}
    </div>
    <div className="si-side">
      <CaseFormError error={fileError} />
      <InitiativeFilePanel files={files} reports={reports.versions} candidates={candidates} batches={history?.verifications ?? []} scopeKey={scopeKey} busy={fileBusy}
        onUpload={(directory, file, scopeExclusive) => { void upload(directory, file, scopeExclusive); }}
        onOpenFile={file => { void openFile(file); }}
        onOpenReport={(entry: ReportFileEntry) => setPreview({ title: entry.name, content: entry.content })} />
    </div>
    {dialog === 'new-candidate' && <NewCandidateDialog initiativeId={id} scope={scope} anchorNo={anchor?.reportNo} onClose={() => setDialog(null)} onCreated={async candidate => { setDialog(null); await refresh(); setSelectedCandidate({ candidateId: candidate.candidateId, no: candidate.no }); setNotice('候选独立会话已启动；完成后回到主窗口核对。'); }} />}
    {dialog === 'lock-report' && report && <LockConfirmDialog title="锁定开题报告" subtitle={`确认开题报告 v${report.no} 的战略命题、资料依据和待核项。锁定后可将此准确版本用作方案输入。`} body={<KickoffBody version={report} />} busy={busy}
      onConfirm={operationId => api.lockKickoffReport(id, report.no, { operationId, sha256: report.contentSha256 })}
      onDone={async () => { setDialog(null); await refresh(); setNotice(`已锁定开题报告 v${report.no}。`); }} onClose={() => setDialog(null)} />}
    {dialog === 'lock-candidate' && current && <LockConfirmDialog title="锁定战略候选" subtitle={`确认 ${candidateLabel(current)} 的完整方案及开题报告 v${current.anchor.reportNo}。锁定后可以开始战略检验。`} body={<CandidateBody candidate={current} />} busy={busy}
      onConfirm={operationId => api.lockCandidate(id, current.candidateId, current.no, { operationId, sha256: current.contentSha256 })}
      onDone={async () => { setDialog(null); await refresh(); setNotice('已锁定，可以开始因果检验。'); onStage('strategy-check'); }} onClose={() => setDialog(null)} />}
    {dialog === 'revise-report' && report && <ReviseDialog title="限定修改开题报告" baseLabel={`开题报告 · v${report.no}`} baseSha256={report.contentSha256} targets={kickoffPatchTargets(report.fields)} maxText={8000}
      onSubmit={input => api.reviseKickoffReport(id, report.no, input)}
      onDone={async result => { setDialog(null); await refresh(); setReportNo(result.version.no); setPhase('kickoff'); setNotice(`已另存开题草稿 v${result.version.no}；修订版仍须重新锁定并明确应用。`); }} onClose={() => setDialog(null)} />}
    {dialog === 'revise-candidate' && current && <ReviseDialog title="限定修改战略候选" baseLabel={candidateLabel(current)} baseSha256={current.contentSha256} targets={current.blocks.map(block => ({ blockId: block.id, label: block.label, text: block.text }))} maxText={20000}
      onSubmit={input => api.reviseCandidate(id, current.candidateId, current.no, input)}
      onDone={async result => { setDialog(null); await refresh(); setSelectedCandidate({ candidateId: result.candidate.candidateId, no: result.candidate.no }); setNotice(`已另存新候选 v${result.candidate.no}；每版使用新的独立会话，重新进入候选态。`); }} onClose={() => setDialog(null)} />}
    {dialog === 'candidate-session' && current && <CandidateSessionDialog initiativeId={id} candidateRef={{ candidateId: current.candidateId, no: current.no }} onClose={() => setDialog(null)} onChanged={refresh} modelLabel={modelLabel} />}
    {preview && <CaseDialog title={preview.title} subtitle="资料预览 · 原字节保留" onClose={() => setPreview(null)} className="si-version-dialog"><div className="si-dialog-scroll"><p className="si-file-preview">{preview.content}</p></div><div className="case-dialog-actions"><button type="button" className="secondary-button" onClick={() => setPreview(null)}>关闭</button></div></CaseDialog>}
  </div>;
}

function CandidateDetailPanel({ candidate, batch, publication, busy, onLock, onRevise, onSession, onStage }: {
  candidate: CandidateVersion; batch?: import('../strategy-initiative-types.ts').VerificationBatch; publication?: InitiativePublication; busy: boolean;
  onLock: () => void; onRevise: () => void; onSession: () => void; onStage: (stage: ManagementStage) => void;
}) {
  const status = candidateStatus(candidate, { batch, publication });
  const generating = candidate.lastRun?.status === 'accepted';
  return <section className="sg-panel si-panel" aria-label="候选详情">
    <div className="si-panel-head"><div><p className="si-eyebrow">方案正文</p><h2>{candidateLabel(candidate)}</h2><p className="si-muted">候选会话 {candidate.candidateId.slice(0, 8)} · 锚定开题报告 v{candidate.anchor.reportNo}{candidate.parent ? ` · 修订自 v${candidate.parent.no}` : ''}</p></div><Badge tone={status.tone}>{status.label}</Badge></div>
    {candidate.returned && <p className="si-notice si-notice-warning" role="status">检验意见已留档。修订会生成新候选，并从因果检验重走。</p>}
    {generating && !candidate.blocks.length ? <p className="si-muted" role="status">候选会话正在整理获准资料和方案。可继续查看其他候选，或打开会话入口回看。</p> : <CandidateBody candidate={candidate} />}
    <div className="si-actions">
      {publication ? <button type="button" className="secondary-button" onClick={() => onStage('strategy-release')}>查看发布记录</button>
        : candidate.returned ? <button type="button" className="primary-button" disabled={busy} onClick={onRevise}>按检验意见修订</button>
        : candidate.lock ? <button type="button" className="primary-button" onClick={() => onStage('strategy-check')}>前往战略检验</button>
        : !generating && candidate.blocks.length > 0 && <button type="button" className="primary-button" disabled={busy} onClick={onLock}>审核并锁定</button>}
      {!generating && candidate.blocks.length > 0 && !candidate.lock && !publication && <button type="button" className="secondary-button" disabled={busy} onClick={onRevise}>限定修改</button>}
      {candidate.lock && !publication && batch?.state !== 'running' && <button type="button" className="secondary-button" disabled={busy} onClick={onRevise}>从此版修订</button>}
      <button type="button" className="secondary-button" onClick={onSession}>查看候选会话</button>
    </div>
  </section>;
}

function NewCandidateDialog({ initiativeId, scope, anchorNo, onClose, onCreated }: { initiativeId: string; scope: GoalScope; anchorNo?: number; onClose: () => void; onCreated: (candidate: CandidateVersion) => Promise<void> }) {
  const [title, setTitle] = useState(''), [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operationId = useOperationId();
  return <CaseDialog title="新建候选会话" subtitle={anchorNo ? `沿用开题报告 v${anchorNo} 和当前范围的获准资料；每个候选版本独立使用一个可持久重开的会话。` : '请先应用开题报告。'} busy={busy} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault();
      if (!title.trim() || !instruction.trim() || busy || !anchorNo) return;
      const id = operationId({ title: title.trim(), instruction: instruction.trim(), scopeKey: initiativeScopeKey(scope) });
      setBusy(true); setError('');
      void api.createCandidate(initiativeId, { operationId: id, scope, title: title.trim(), instruction: instruction.trim() })
        .then(result => onCreated(result.candidate)).catch(fault => setError(errorText(fault))).finally(() => setBusy(false));
    }}>
      <div className="case-field"><label htmlFor="si-candidate-title">方向标题</label><input id="si-candidate-title" required maxLength={200} disabled={busy} value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：会员复购优先" /></div>
      <div className="case-field"><label htmlFor="si-candidate-instruction">方向要求</label><textarea id="si-candidate-instruction" required rows={4} maxLength={20000} disabled={busy} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="说明该方向的增长逻辑、取舍与需要核对的假设…" /></div>
      <CaseFormError error={error} />
      <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy || !anchorNo}>{busy ? '正在启动…' : '启动独立会话'}</button></div>
    </form>
  </CaseDialog>;
}

function LockConfirmDialog({ title, subtitle, body, busy, onConfirm, onDone, onClose }: { title: string; subtitle: string; body: ReactNode; busy: boolean; onConfirm: (operationId: string) => Promise<unknown>; onDone: () => Promise<void>; onClose: () => void }) {
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const operationId = useOperationId();
  return <CaseDialog title={title} subtitle={subtitle} busy={busy || saving} onClose={onClose} className="si-version-dialog">
    <div className="si-dialog-scroll">{body}</div>
    <CaseFormError error={error} />
    <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>取消</button><button type="button" className="primary-button" disabled={saving || busy} onClick={() => {
      if (saving) return; setSaving(true); setError('');
      void onConfirm(operationId({ title })).then(async () => { await onDone(); }).catch(fault => setError(errorText(fault))).finally(() => setSaving(false));
    }}>{saving ? '正在锁定…' : '确认锁定'}</button></div>
  </CaseDialog>;
}

export function ReviseDialog<T>({ title, baseLabel, baseSha256, targets, maxText, onSubmit, onDone, onClose }: {
  title: string; baseLabel: string; baseSha256: string; targets: PatchTarget[]; maxText: number;
  onSubmit: (input: { operationId: string; baseSha256: string; request: string; patches: { blockId: string; expectedOldSha256: string; newText: string }[] }) => Promise<T>;
  onDone: (result: T) => Promise<void>; onClose: () => void;
}) {
  const [blockId, setBlockId] = useState(targets[0]?.blockId ?? '');
  const target = targets.find(item => item.blockId === blockId) ?? targets[0];
  const [request, setRequest] = useState(''), [newText, setNewText] = useState(target?.text ?? '');
  const [step, setStep] = useState<'edit' | 'diff'>('edit');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operationId = useOperationId();
  return <CaseDialog title={title} subtitle={`基于 ${baseLabel}。选定一处，描述修改要求并给出新文本；其他章节保留原文。`} busy={busy} onClose={onClose} className="si-version-dialog">
    {step === 'edit' ? <form onSubmit={event => { event.preventDefault(); if (!request.trim() || !newText.trim() || !target) return; setStep('diff'); }}>
      <div className="case-field"><label htmlFor="si-revise-block">修改位置</label><select id="si-revise-block" value={blockId} onChange={event => { setBlockId(event.target.value); const next = targets.find(item => item.blockId === event.target.value); setNewText(next?.text ?? ''); }}>{targets.map(item => <option key={item.blockId} value={item.blockId}>{item.label}</option>)}</select></div>
      <div className="case-field"><label htmlFor="si-revise-request">修改要求</label><textarea id="si-revise-request" required rows={2} maxLength={2000} value={request} onChange={event => setRequest(event.target.value)} placeholder="例如：将三店试点调整为两店，先核对导购工时。" /></div>
      <div className="case-field"><label htmlFor="si-revise-text">新文本（仅替换所选位置）</label><textarea id="si-revise-text" required rows={6} maxLength={maxText} value={newText} onChange={event => setNewText(event.target.value)} /></div>
      <div className="case-dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={!request.trim() || !newText.trim()}>查看修改差异</button></div>
    </form> : <form onSubmit={event => {
      event.preventDefault();
      if (busy || !target || !newText.trim()) return;
      setBusy(true); setError('');
      void (async () => {
        const expectedOldSha256 = await sha256Of(target.text);
        const id = operationId({ baseSha256, blockId: target.blockId, request: request.trim(), newText });
        const result = await onSubmit({ operationId: id, baseSha256, request: request.trim(), patches: [{ blockId: target.blockId, expectedOldSha256, newText }] });
        await onDone(result);
      })().catch(fault => setError(errorText(fault))).finally(() => setBusy(false));
    }}>
      <div className="si-dialog-scroll">
        <p>{baseLabel} · 仅修改「{target?.label}」。其他章节以原字节和顺序复用。</p>
        <div className="si-diff"><div className="si-diff-before"><strong>原文</strong><p>{target?.text}</p></div><div className="si-diff-after"><strong>新文本</strong><p>{newText}</p></div></div>
      </div>
      <CaseFormError error={error} />
      <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setStep('edit')}>返回修改</button><button type="submit" className="primary-button" disabled={busy}>{busy ? '正在另存…' : '另存新版本'}</button></div>
    </form>}
  </CaseDialog>;
}
const sha256Of = api.sha256Text;

function CandidateSessionDialog({ initiativeId, candidateRef, onClose, onChanged, modelLabel }: { initiativeId: string; candidateRef: CandidateRef; onClose: () => void; onChanged: () => Promise<void>; modelLabel: string }) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = async () => {
    try { const next = await api.readCandidate(initiativeId, candidateRef.candidateId, candidateRef.no); if (alive.current) { setDetail(next); setError(''); } }
    catch (fault) { if (alive.current) setError(errorText(fault)); }
    finally { if (alive.current) setLoading(false); }
  };
  useEffect(() => { void load(); }, [initiativeId, candidateRef.candidateId, candidateRef.no]);
  useEffect(() => {
    if (!detail?.busy) return;
    const timer = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(timer);
  }, [detail?.busy, initiativeId, candidateRef.candidateId, candidateRef.no]);
  const candidate = detail?.candidate;
  const locked = Boolean(candidate?.lock);
  const act = async (action: () => Promise<unknown>) => { if (busy) return; setBusy(true); setError(''); try { await action(); await load(); await onChanged(); } catch (fault) { setError(errorText(fault)); } finally { if (alive.current) setBusy(false); } };
  return <CaseDialog title={`候选会话 ${candidateRef.candidateId.slice(0, 8)}`} subtitle={candidate ? `${candidateLabel(candidate)} · 开题报告 v${candidate.anchor.reportNo}` : '正在读取候选会话…'} busy={busy} onClose={onClose} className="si-version-dialog">
    <div className="si-dialog-scroll">
      {loading ? <p className="si-muted" role="status">正在读取候选会话…</p> : <>
        {detail?.busy && <p className="si-muted" role="status">候选会话正在整理获准资料和方案…</p>}
        <StrategyDiscussionTranscript messages={transcriptMessages(detail?.snapshot)} conversationKey={`initiative-candidate:${initiativeId}:${candidateRef.candidateId}:${candidateRef.no}`} modelLabel={modelLabel} label="候选会话记录" />
        {locked && <p className="si-muted">此版已锁定，正文作为检验基线保留；如需修改请另存新候选版本。</p>}
        {!locked && <form className="si-composer" onSubmit={event => {
          event.preventDefault();
          if (!text.trim() || !candidate || busy || detail?.busy) return;
          void act(async () => { await api.sendCandidateMessage(initiativeId, candidateRef.candidateId, candidateRef.no, { requestId: crypto.randomUUID(), text: text.trim(), expectedRevision: candidate.revision, ...(candidate.pendingInput && ['failed', 'cancelled'].includes(candidate.lastRun?.status ?? '') ? { replacePendingRequestId: candidate.pendingInput.requestId } : {}) }); setText(''); });
        }}>
          <label className="sr-only" htmlFor="si-candidate-text">候选会话输入</label>
          <textarea id="si-candidate-text" rows={3} maxLength={20000} value={text} disabled={busy || Boolean(detail?.busy)} placeholder="继续补充该方向的要求或依据…" onChange={event => setText(event.target.value)} />
          <div className="si-actions">
            {detail?.busy ? <button type="button" className="secondary-button" disabled={busy} onClick={() => { void act(() => api.stopCandidate(initiativeId, candidateRef.candidateId, candidateRef.no, candidate?.lastRun?.id)); }}>停止本轮生成</button> : <button type="submit" className="primary-button" disabled={!text.trim() || busy}>发送</button>}
            <button type="button" className="text-button" disabled={busy} onClick={() => { void act(() => api.closeCandidate(initiativeId, candidateRef.candidateId, candidateRef.no)); }}>关闭会话，保留历史</button>
          </div>
        </form>}
      </>}
      <CaseFormError error={error} />
    </div>
    <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>关闭</button></div>
  </CaseDialog>;
}