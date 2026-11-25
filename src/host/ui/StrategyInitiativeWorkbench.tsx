import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { CaseDialog, CaseFormError, useOperationId } from './CaseDialogs.tsx';
import { StrategyDiscussionTranscript } from './StrategyDiscussionReply.tsx';
import { projectDiscussionSnapshot, projectDiscussionStreaming } from './strategy-discussion-projection.ts';
import { fileBase64 } from './runtime-client.ts';
import type { NativeMessage, PublicModelConfiguration } from './project-types.ts';
import type { GoalScope } from '../strategy-goals-types.ts';
import type { CandidateVersion, KickoffAnchor, VerificationSourceRef } from '../strategy-initiative-types.ts';
import { initiativeScopeKey } from '../strategy-initiative-types.ts';
import type { ManagementStage, StrategyStage } from './ManagementTabs.tsx';
import * as api from './strategy-initiative-client.ts';
import type { CandidateDetail, InitiativeFile, InitiativeHistory, InitiativePublication, InitiativeRecord, InitiativeSessionDetail, KickoffReportReadback, KickoffReportVersion, ReportsView } from './strategy-initiative-client.ts';
import { Badge, CandidateBody, InitiativeFilePanel, KickoffBody, LifecyclePlaceholderDialog, candidateLabel, candidateStatus, kickoffPatchTargets, latestBatch, mainSessionPresentation, matchPendingUploadFile, parsePendingUploadLedger, publicationFor, removePendingUpload, upsertPendingUpload } from './strategy-initiative-view.tsx';
import type { PatchTarget, PendingInitiativeUpload, ReportFileEntry } from './strategy-initiative-view.tsx';
import { StrategyCheckPanel, StrategyReleaseReview, StrategyVersionsPanel, LegacyDiscussionReadback, ReportVersionDialog, VersionReceiptDialog, verificationSourceLabels } from './StrategyInitiativeGovernance.tsx';
import type { CandidateRef, LegacyDiscussionAccess } from './StrategyInitiativeGovernance.tsx';
import { listStrategyDiscussions } from './strategy-discussion-client.ts';
import './strategy-initiative.css';

const errorText = api.errorText;
const transcriptMessages = (snapshot: { messages: Record<string, unknown>[] } | null | undefined): NativeMessage[] =>
  (snapshot?.messages ?? []).filter((message): message is NativeMessage => ['user', 'assistant', 'toolResult', 'bashExecution'].includes((message as { role?: string }).role ?? ''));
const draftKey = (id: string, scopeKey: string) => `optracall.strategy-initiative.draft.v1:${id}:${scopeKey}`;
const journalKey = (id: string, scopeKey: string) => `optracall.strategy-initiative.pending.v1:${id}:${scopeKey}`;
const uploadJournalKey = (id: string, scopeKey: string) => `optracall.strategy-initiative.upload-pending.v1:${id}:${scopeKey}`;
const readDraft = (id: string, scopeKey: string): string => { try { return sessionStorage.getItem(draftKey(id, scopeKey)) || ''; } catch { return ''; } };
const saveDraft = (id: string, scopeKey: string, text: string) => { try { sessionStorage.setItem(draftKey(id, scopeKey), text); } catch { /* input stays in memory */ } };
const readPendingUploads = (id: string, scopeKey: string): PendingInitiativeUpload[] => {
  try { return parsePendingUploadLedger(sessionStorage.getItem(uploadJournalKey(id, scopeKey)), id, scopeKey); }
  catch { return []; }
};
const savePendingUploads = (id: string, scopeKey: string, list: PendingInitiativeUpload[]) => {
  try {
    if (list.length > 0) sessionStorage.setItem(uploadJournalKey(id, scopeKey), JSON.stringify(list));
    else sessionStorage.removeItem(uploadJournalKey(id, scopeKey));
  } catch { /* metadata stays in memory */ }
};
const sameRef = (candidate: CandidateVersion, ref: CandidateRef | null) => Boolean(ref && candidate.candidateId === ref.candidateId && candidate.no === ref.no);
type SourcePreview =
  | { kind: 'report'; source: VerificationSourceRef; version: KickoffReportReadback; anchor?: KickoffAnchor }
  | { kind: 'candidate'; source: VerificationSourceRef; candidate: CandidateVersion; anchorReport?: Pick<KickoffReportVersion, 'no' | 'contentSha256'> }
  | { kind: 'file'; source: VerificationSourceRef; name: string; content: string; actualSha256: string }
  | { kind: 'unavailable'; source: VerificationSourceRef; reason: string; actualSha256?: string };

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

export function InitiativeEditorDialog({ initial, onClose, onSaved }: { initial?: InitiativeRecord; onClose: () => void; onSaved: (record: InitiativeRecord) => Promise<void> }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [rows, setRows] = useState<GoalScope[]>(initial?.scopes.length ? initial.scopes.map(scope => ({ ...scope })) : [{ kind: 'department', id: '', name: '' }]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [invalidField, setInvalidField] = useState<string | null>(null);
  const operationId = useOperationId();
  const change = (index: number, patch: Partial<GoalScope>) => {
    setRows(old => old.map((row, at) => at === index ? { ...row, ...patch } : row));
    setInvalidField(null);
  };
  const focusField = (fieldId: string, message: string) => {
    setInvalidField(fieldId);
    setError(message);
    if (typeof document !== 'undefined') document.getElementById(fieldId)?.focus();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = title.trim();
    if (!cleaned) { focusField('si-initiative-title', '请填写事项名称（必填），并至少保留一个标识与名称齐全的范围。'); return; }
    for (const [index, row] of rows.entries()) {
      const name = row.name.trim(), id = row.id.trim();
      if (!name && !id) {
        if (rows.length === 1) { focusField('si-scope-name-0', '请填写事项名称，并至少保留一个标识与名称齐全的范围（范围 1 缺少必填的「范围名称」与「归属标识」）。'); return; }
        continue;
      }
      if (!name) { focusField(`si-scope-name-${index}`, `范围 ${index + 1} 缺少必填的「范围名称」，请补全后再保存。`); return; }
      if (!id) { focusField(`si-scope-id-${index}`, `范围 ${index + 1} 缺少必填的「归属标识」（稳定组织／业务标识），请补全后再保存。`); return; }
    }
    const scopes = rows.map(row => ({ kind: row.kind, id: row.id.trim(), name: row.name.trim(), ...(row.kind === 'department' && row.enterpriseId?.trim() ? { enterpriseId: row.enterpriseId.trim() } : {}) })).filter(row => row.id && row.name);
    if (!scopes.length) { focusField('si-scope-id-0', '请填写事项名称，并至少保留一个标识与名称齐全的范围。'); return; }
    if (new Set(scopes.map(scope => initiativeScopeKey(scope))).size !== scopes.length) { focusField('si-scope-id-0', '范围归属标识重复，请核对后再保存。'); return; }
    setBusy(true); setError(''); setInvalidField(null);
    const action = initial
      ? api.updateInitiative(initial.id, { expectedRevision: initial.revision, title: cleaned, scopes })
      : api.createInitiative({ operationId: operationId({ title: cleaned, scopes }), title: cleaned, scopes });
    void action.then(result => onSaved(result.initiative)).catch(fault => setError(errorText(fault))).finally(() => setBusy(false));
  };
  return <CaseDialog title={initial ? '编辑战略事项' : '新建战略事项'} subtitle="范围持有实际组织／业务归属；切换范围保留各自的应用指针、访谈与资料。" busy={busy} onClose={onClose}>
    <form onSubmit={submit} noValidate>
      <div className="case-field"><label htmlFor="si-initiative-title">事项名称 <span>必填</span></label><input id="si-initiative-title" required aria-required="true" aria-invalid={invalidField === 'si-initiative-title' || undefined} maxLength={200} disabled={busy} value={title} onChange={event => { setTitle(event.target.value); setInvalidField(null); }} placeholder="例如：华东门店增长战略" /></div>
      {rows.map((row, index) => <fieldset className="si-scope-row" key={index}>
        <legend>范围 {index + 1}</legend>
        <div className="case-form-row">
          <div className="case-field"><label htmlFor={`si-scope-kind-${index}`}>层级</label><select id={`si-scope-kind-${index}`} disabled={busy} value={row.kind} onChange={event => change(index, { kind: event.target.value as GoalScope['kind'] })}><option value="enterprise">企业</option><option value="department">部门／业务</option><option value="personal">个人</option></select></div>
          <div className="case-field"><label htmlFor={`si-scope-name-${index}`}>范围名称 <span>必填</span></label><input id={`si-scope-name-${index}`} required aria-required="true" aria-invalid={invalidField === `si-scope-name-${index}` || undefined} maxLength={200} disabled={busy} value={row.name} onChange={event => change(index, { name: event.target.value })} placeholder="例如：华东零售事业部" /></div>
        </div>
        <div className="case-form-row">
          <div className="case-field"><label htmlFor={`si-scope-id-${index}`}>归属标识 <span>必填</span></label><input id={`si-scope-id-${index}`} required aria-required="true" aria-invalid={invalidField === `si-scope-id-${index}` || undefined} maxLength={200} disabled={busy} value={row.id} onChange={event => change(index, { id: event.target.value })} placeholder="必填，如 east-retail；改名不另开范围" /></div>
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
  const pendingRef = useRef<typeof pending>(null), terminalRequestId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false), [connection, setConnection] = useState(0);
  const [dispatching, setDispatching] = useState(false), [observationDisconnected, setObservationDisconnected] = useState(false);
  const [dialog, setDialog] = useState<'new-candidate' | 'new-candidate-from-parent' | 'lock-report' | 'lock-candidate' | 'revise-report' | 'revise-candidate' | 'candidate-session' | 'main-discussion' | null>(null);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [sourcePreview, setSourcePreview] = useState<SourcePreview | null>(null);
  const [fileBusy, setFileBusy] = useState(false), [fileError, setFileError] = useState('');
  const [pendingUploads, setPendingUploads] = useState<PendingInitiativeUpload[]>(() => readPendingUploads(id, scopeKey));
  const pendingUploadsRef = useRef<PendingInitiativeUpload[]>(pendingUploads);
  const pendingUploadPayloadsRef = useRef<Map<string, string>>(new Map());
  const [pendingUploadPayloadIds, setPendingUploadPayloadIds] = useState<ReadonlySet<string>>(() => new Set());
  const [legacyId, setLegacyId] = useState('');
  const alive = useRef(true), presentedSnapshot = useRef<InitiativeSessionDetail['snapshot']>(null);
  const syncPendingUploadPayloadIds = () => { setPendingUploadPayloadIds(new Set(pendingUploadPayloadsRef.current.keys())); };
  const updatePendingUploads = (updater: (current: PendingInitiativeUpload[]) => PendingInitiativeUpload[]) => {
    const next = updater(pendingUploadsRef.current);
    pendingUploadsRef.current = next;
    setPendingUploads(next);
    savePendingUploads(id, scopeKey, next);
    const activeIds = new Set(next.map(item => item.operationId));
    let pruned = false;
    for (const key of pendingUploadPayloadsRef.current.keys()) {
      if (!activeIds.has(key)) { pendingUploadPayloadsRef.current.delete(key); pruned = true; }
    }
    if (pruned) syncPendingUploadPayloadIds();
  };
  const rememberPending = (value: typeof pending) => {
    pendingRef.current = value;
    setPending(value);
    try { if (value) sessionStorage.setItem(journalKey(id, scopeKey), JSON.stringify(value)); else sessionStorage.removeItem(journalKey(id, scopeKey)); } catch { /* keep in memory */ }
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    try { const raw = sessionStorage.getItem(journalKey(id, scopeKey)); if (raw) { const value = JSON.parse(raw) as { requestId: string; text: string }; if (value?.requestId) { rememberPending(value); if (!readDraft(id, scopeKey)) setDraft(value.text); } } } catch { /* journal unreadable: keep inputs in memory */ }
  }, [id, scopeKey]);
  useEffect(() => { if (legacyFocus) setLegacyId(legacyFocus.source.id); }, [legacyFocus?.id]);

  const applySession = (next: InitiativeSessionDetail | null, updateReports = true) => {
    const previous = presentedSnapshot.current; presentedSnapshot.current = next?.snapshot ?? null;
    setStreaming(old => next ? projectDiscussionStreaming(old, { type: 'snapshot', snapshot: next.snapshot ?? { sessionId: '', messages: [], tools: [], status: 'idle', sdkVersion: '', capabilities: {} } }, previous ?? undefined) : '');
    if (!next?.busy) setActivity('');
    const hostPending = next?.session.pendingInput;
    const currentPending = pendingRef.current;
    const lastRun = next?.session.lastRun;
    const replaced = next?.session.replacedRequests?.find(request => request.requestId === currentPending?.requestId);
    if (replaced) {
      terminalRequestId.current = replaced.requestId;
      rememberPending(hostPending ? { requestId: hostPending.requestId, text: hostPending.text } : null);
      const outcome = replaced.status === 'failed' ? '失败' : replaced.status === 'cancelled' ? '取消' : '结果未知';
      setNotice(`原请求${outcome}，已由显式操作替换，原回执保留。`);
    } else if (hostPending && !currentPending && hostPending.requestId !== terminalRequestId.current) {
      rememberPending({ requestId: hostPending.requestId, text: hostPending.text });
    } else if (!hostPending && lastRun && lastRun.status !== 'accepted') {
      terminalRequestId.current = lastRun.id;
      if (currentPending?.requestId === lastRun.id) rememberPending(null);
    }
    if (next && updateReports) setReports(next.reports);
    setSession(next);
  };
  const refresh = async () => {
    const [reportResult, sessionResult, fileResult, candidateResult, publicationResult, historyResult] = await Promise.allSettled([
      api.readKickoffReports(id, scopeKey),
      api.readInitiativeSession(id, scopeKey).catch(fault => { if (fault instanceof api.StrategyInitiativeRequestError && fault.status === 404) return null; throw fault; }),
      api.listInitiativeFiles(id, scopeKey),
      api.listCandidates(id, scopeKey),
      api.listPublications(id, scopeKey),
      api.readInitiativeHistory(id, scopeKey),
    ]);
    if (!alive.current) return;
    if (reportResult.status === 'fulfilled') setReports(reportResult.value);
    if (sessionResult.status === 'fulfilled') applySession(sessionResult.value, reportResult.status !== 'fulfilled');
    if (fileResult.status === 'fulfilled') {
      setFiles(fileResult.value.files);
      const matchedItems = pendingUploadsRef.current
        .filter(item => item.status !== 'uploading')
        .map(item => ({ item, match: matchPendingUploadFile(item, fileResult.value.files) }))
        .filter((entry): entry is { item: PendingInitiativeUpload; match: { kind: 'matched'; file: InitiativeFile } } => entry.match.kind === 'matched');
      if (matchedItems.length > 0) {
        const matchedIds = new Set(matchedItems.map(entry => entry.item.operationId));
        updatePendingUploads(list => list.filter(item => !matchedIds.has(item.operationId)));
        setFileError('');
        const first = matchedItems[0]!;
        setNotice(matchedItems.length === 1
          ? `已核对原上传操作（${first.item.operationId.slice(0, 8)}）：文件「${first.match.file.name}」已保存于 ${first.match.file.directory}，未重复上传。`
          : `已核对 ${matchedItems.length} 条原上传操作，原文件均已保存且未重复上传。`);
      }
    }
    if (candidateResult.status === 'fulfilled') setCandidates(candidateResult.value.candidates);
    if (publicationResult.status === 'fulfilled') setPublications(publicationResult.value.publications);
    if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
    const faults = [reportResult, sessionResult, fileResult, candidateResult, publicationResult, historyResult].filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    setError(faults.length ? errorText(faults[0]!.reason) : '');
    setLoading(false);
  };
  useEffect(() => { if (active) void refresh(); }, [active, id, scopeKey]);
  useEffect(() => {
    if (!active || !pending) return;
    const controller = new AbortController();
    let reading = false;
    const timer = setInterval(() => {
      if (reading || pendingRef.current?.requestId !== pending.requestId) return;
      reading = true;
      void api.readInitiativeSession(id, scopeKey, controller.signal).then(next => {
        if (!controller.signal.aborted && pendingRef.current?.requestId === pending.requestId) applySession(next);
      }).catch(() => { /* the existing recovery action can recheck an unavailable connection */ }).finally(() => { reading = false; });
    }, 2000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [active, id, scopeKey, pending?.requestId]);
  const running = candidates.some(candidate => candidate.lastRun?.status === 'accepted') || Boolean(history?.verifications.some(batch => batch.state === 'running'));
  useEffect(() => {
    if (!active || !running) return;
    const timer = setInterval(() => {
      void Promise.allSettled([api.listCandidates(id, scopeKey), api.readInitiativeHistory(id, scopeKey), api.listPublications(id, scopeKey)]).then(([candidateResult, historyResult, publicationResult]) => {
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
    setObservationDisconnected(false);
    void api.watchInitiativeEvents(id, scopeKey, event => {
      if (controller.signal.aborted || !alive.current) return;
      setObservationDisconnected(false);
      const previous = presentedSnapshot.current;
      if (event.type === 'snapshot' && event.snapshot) { presentedSnapshot.current = event.snapshot; setSession(old => old ? { ...old, snapshot: event.snapshot, busy: event.snapshot.status === 'running' } : old); }
      setStreaming(old => projectDiscussionStreaming(old, event.type === 'snapshot' ? { ...event, snapshot: event.snapshot ?? { sessionId: '', messages: [], tools: [], status: 'idle', sdkVersion: '', capabilities: {} } } as any : event, previous ?? undefined));
      if (event.type === 'native' && event.event.type === 'tool_execution_start') setActivity(`正在使用 ${event.event.toolName || '已获准工具'}`);
      if (event.type === 'native' && event.event.type === 'tool_execution_end') setActivity('');
      if (event.type === 'run.settled') {
        setStreaming(''); setActivity('');
        if (event.outcome === 'failed') setError(event.error || '本轮讨论未完成，已保存的记录保留。');
        void refresh();
      }
    }, controller.signal).then(() => { if (!controller.signal.aborted && alive.current) { setObservationDisconnected(true); setNotice('实时观察流已结束，可刷新讨论记录；未重发消息。'); } }).catch(() => { if (!controller.signal.aborted && alive.current) { setObservationDisconnected(true); setNotice('实时连接暂不可用，可刷新讨论记录；未重发消息。'); } });
    return () => controller.abort();
  }, [active, stage, session?.session.scopeKey, connection]);

  const scopedVersions = reports.versions.filter(api.isReadableKickoffReport);
  const anchor = reports.anchors[scopeKey];
  const report = scopedVersions.find(version => version.no === reportNo) ?? scopedVersions.at(-1);
  const current = candidates.find(candidate => sameRef(candidate, selectedCandidate)) ?? candidates.at(-1);
  const sessionBusy = Boolean(session?.busy || session?.snapshot?.status === 'running');
  const mainPresentation = mainSessionPresentation({
    dispatching, pending, lastRun: session?.session.lastRun,
    busy: session?.busy ?? false, live: session?.live ?? false,
    snapshotRunning: session?.snapshot?.status === 'running', disconnected: observationDisconnected,
  });
  const locked = busy || Boolean(pending) || sessionBusy;
  const modelLabel = configurations.find(item => session ? item.id === session.session.configurationId && item.revision === session.session.configurationRevision : item.id === selectedConfigurationId)?.model ?? '模型待核对';

  const sendMain = async (text: string, replacePendingRequestId?: string) => {
    const priorPending = pendingRef.current;
    if (busy || sessionBusy || priorPending?.requestId !== replacePendingRequestId || !text.trim()) return;
    setBusy(true); setDispatching(true); setError(''); setNotice('');
    let requestId: string | undefined;
    let accepted = false;
    try {
      let detail = session;
      if (!detail) {
        await api.createInitiativeSession(id, { operationId: crypto.randomUUID(), scope, ...(selectedConfigurationId ? { configurationId: selectedConfigurationId } : {}) });
        detail = await api.readInitiativeSession(id, scopeKey);
        applySession(detail);
      }
      requestId = crypto.randomUUID();
      const input = { requestId, text: text.trim(), expectedRevision: detail.session.revision, ...(replacePendingRequestId ? { replacePendingRequestId } : {}) };
      rememberPending(input);
      await api.sendInitiativeMessage(id, scopeKey, input);
      accepted = true;
      setDraft(''); saveDraft(id, scopeKey, ''); setStreaming('');
      setConnection(value => value + 1);
      applySession(await api.readInitiativeSession(id, scopeKey));
    } catch (fault) {
      if (accepted) setNotice('本轮已受理，正在核对运行状态。');
      else {
        if (requestId && fault instanceof api.StrategyInitiativeRequestError && !fault.uncertain) {
          const checked = await api.readInitiativeSession(id, scopeKey).catch(() => null);
          if (checked) {
            if (checked.session.lastRun?.id !== requestId && checked.session.pendingInput?.requestId !== requestId) rememberPending(priorPending);
            applySession(checked);
          }
        }
        setError(errorText(fault));
      }
    } finally { if (alive.current) { setBusy(false); setDispatching(false); } }
  };
  const recover = async () => {
    if (!pending || busy) return;
    setBusy(true); setError('');
    try {
      const detail = await api.readInitiativeSession(id, scopeKey).catch(fault => { if (fault instanceof api.StrategyInitiativeRequestError && fault.status === 404) return null; throw fault; });
      const replaced = detail?.session.replacedRequests?.some(request => request.requestId === pending.requestId);
      if (detail && (replaced || detail.session.lastRun?.id === pending.requestId || detail.session.pendingInput?.requestId === pending.requestId)) {
        applySession(detail); setConnection(value => value + 1);
        if (!replaced) setNotice('已核对原请求，历史与当前状态已重读。');
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
  const executeUpload = async (record: PendingInitiativeUpload, contentBase64: string) => {
    setFileBusy(true); setFileError('');
    pendingUploadPayloadsRef.current.set(record.operationId, contentBase64);
    syncPendingUploadPayloadIds();
    updatePendingUploads(list => upsertPendingUpload(list, { ...record, status: 'uploading', errorCode: undefined, errorMessage: undefined, unreachable: false }));
    try {
      const uploaded = await api.uploadInitiativeFile(id, {
        operationId: record.operationId, directory: record.directory, name: record.name, contentBase64,
        ...(record.scopeKey ? { scopeKey: record.scopeKey } : {}),
      });
      if (!alive.current) return;
      updatePendingUploads(list => removePendingUpload(list, record.operationId));
      try {
        const result = await api.listInitiativeFiles(id, scopeKey);
        if (alive.current) setFiles(result.files);
      } catch {
        if (alive.current) setFiles(old => old.some(item => item.fileId === uploaded.file.fileId) ? old : [...old, uploaded.file]);
      }
      if (alive.current) setNotice('资料已加入当前事项；上传本身不调用模型。');
    } catch (fault) {
      if (!alive.current) return;
      const isReqErr = fault instanceof api.StrategyInitiativeRequestError;
      const uncertain = !isReqErr || fault.uncertain || fault.status === 0 || fault.status >= 500 || fault.code === 'strategy_file_operation_conflict';
      const msg = errorText(fault);
      if (uncertain) {
        updatePendingUploads(list => upsertPendingUpload(list, {
          ...record,
          status: 'unknown',
          unreachable: isReqErr && fault.status === 0,
          errorCode: isReqErr ? fault.code : undefined,
          errorMessage: msg,
        }));
      } else {
        updatePendingUploads(list => removePendingUpload(list, record.operationId));
      }
      setFileError(msg);
    } finally { if (alive.current) setFileBusy(false); }
  };
  const upload = async (directory: '010_draw' | '020_clean', file: File, scopeExclusive: boolean) => {
    if (fileBusy) return;
    if (file.size > 50 * 1024 * 1024) { setFileError('单文件不超过 50 MiB。'); return; }
    setFileBusy(true); setFileError('');
    try {
      const [buffer, contentBase64] = await Promise.all([file.arrayBuffer(), fileBase64(file)]);
      const sha256 = await api.sha256Buffer(buffer);
      const record: PendingInitiativeUpload = {
        operationId: crypto.randomUUID(),
        initiativeId: id,
        workspaceScopeKey: scopeKey,
        ...(scopeExclusive ? { scopeKey } : {}),
        directory,
        name: file.name,
        size: file.size,
        sha256,
        status: 'uploading',
        createdAt: new Date().toISOString(),
      };
      await executeUpload(record, contentBase64);
    } catch (fault) {
      if (alive.current) { setFileError(errorText(fault)); setFileBusy(false); }
    }
  };
  const checkPendingUpload = async (operationId: string) => {
    const currentPending = pendingUploadsRef.current.find(item => item.operationId === operationId);
    if (!currentPending || fileBusy) return;
    setFileBusy(true); setFileError('');
    try {
      const result = await api.listInitiativeFiles(id, scopeKey);
      if (!alive.current) return;
      setFiles(result.files);
      const matched = matchPendingUploadFile(currentPending, result.files);
      if (matched.kind === 'matched') {
        updatePendingUploads(list => removePendingUpload(list, currentPending.operationId));
        setNotice(`已核对原上传操作（${currentPending.operationId.slice(0, 8)}）：文件「${matched.file.name}」已保存于 ${matched.file.directory}（fileId ${matched.file.fileId.slice(0, 8)}），未重复上传。`);
      } else if (matched.kind === 'conflict') {
        setFileError(`原操作编号 ${currentPending.operationId.slice(0, 8)} 已对应不同文件「${matched.file.name}」；未覆盖或重复上传。`);
      } else {
        updatePendingUploads(list => upsertPendingUpload(list, { ...currentPending, status: 'not-found', unreachable: false, errorMessage: undefined, checkedAt: new Date().toISOString() }));
        setNotice(`已只读核对当前事项文件列表，尚未发现原上传操作（${currentPending.operationId.slice(0, 8)}）的已保存记录。`);
      }
    } catch (fault) {
      if (!alive.current) return;
      const isReqErr = fault instanceof api.StrategyInitiativeRequestError;
      const msg = errorText(fault);
      updatePendingUploads(list => upsertPendingUpload(list, {
        ...currentPending,
        status: 'unknown',
        unreachable: isReqErr && fault.status === 0,
        errorCode: isReqErr ? fault.code : undefined,
        errorMessage: msg,
        checkedAt: new Date().toISOString(),
      }));
      setFileError(msg);
    } finally { if (alive.current) setFileBusy(false); }
  };
  const retryPendingUpload = async (operationId: string) => {
    const currentPending = pendingUploadsRef.current.find(item => item.operationId === operationId);
    const contentBase64 = pendingUploadPayloadsRef.current.get(operationId);
    if (!currentPending || fileBusy || !contentBase64) return;
    await executeUpload(currentPending, contentBase64);
  };
  const reselectPendingUpload = async (operationId: string, file: File) => {
    const currentPending = pendingUploadsRef.current.find(item => item.operationId === operationId);
    if (!currentPending || fileBusy) return;
    if (file.size > 50 * 1024 * 1024) { setFileError('单文件不超过 50 MiB。'); return; }
    setFileBusy(true); setFileError('');
    try {
      const buffer = await file.arrayBuffer();
      const sha256 = await api.sha256Buffer(buffer);
      if (file.name !== currentPending.name || file.size !== currentPending.size || sha256 !== currentPending.sha256) {
        setFileError(`重选文件「${file.name}」与待核记录「${currentPending.name}」的文件名或 SHA-256 指纹不一致，未沿原操作编号上传；请重选原文件，或放弃待核记录后发起新上传。`);
        setFileBusy(false);
        return;
      }
      const contentBase64 = await fileBase64(file);
      await executeUpload(currentPending, contentBase64);
    } catch (fault) {
      if (alive.current) { setFileError(errorText(fault)); setFileBusy(false); }
    }
  };
  const dismissPendingUpload = (operationId: string) => {
    if (fileBusy) return;
    updatePendingUploads(list => removePendingUpload(list, operationId));
    setFileError('');
    setNotice('已放弃本地待核上传记录；服务端已有文件不受影响。');
  };
  const decodeFilePreview = (name: string, contentBase64: string) => {
    const bytes = Uint8Array.from(atob(contentBase64), char => char.charCodeAt(0));
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return { title: name, content: '二进制原件暂不支持文本预览；请按元数据引用，需要正文时提供文本版本。' }; }
    if (bytes.includes(0)) return { title: name, content: '二进制原件暂不支持文本预览；请按元数据引用。' };
    return { title: name, content: text };
  };
  const openFile = async (file: InitiativeFile) => {
    setFileError('');
    try {
      const result = await api.readInitiativeFile(id, file.fileId, file.scopeKey ?? scopeKey);
      setPreview(decodeFilePreview(file.name, result.contentBase64));
    } catch (fault) { setFileError(errorText(fault)); }
  };
  const openSource = async (source: VerificationSourceRef) => {
    setSourcePreview(null);
    const unavailable = (reason: string, actualSha256?: string) => setSourcePreview({ kind: 'unavailable', source, reason, ...(actualSha256 ? { actualSha256 } : {}) });
    try {
      if (source.kind === 'kickoff') {
        if (!/^[1-9]\d*$/.test(source.ref)) return unavailable('开题引用不是准确正整数版本号；未替换为当前版本。');
        const view = await api.readKickoffReports(id, scopeKey);
        const version = view.versions.find(item => item.no === Number(source.ref));
        if (!version) return unavailable('所引用开题版本不存在或已不可读；未替换为当前版本。');
        if (!api.isReadableKickoffReport(version)) return unavailable('所引用开题版本不在当前可读范围；仅保留身份和指纹。', version.contentSha256);
        if (source.sha256 && source.sha256 !== version.contentSha256) return unavailable('开题版本内容指纹与检验引用不符；未展示可能已变化的正文。', version.contentSha256);
        setSourcePreview({ kind: 'report', source, version, anchor: view.anchors[scopeKey] });
      } else if (source.kind === 'candidate') {
        const match = source.ref.match(/^([a-f0-9-]{36}):([1-9]\d*)$/);
        if (!match) return unavailable('候选引用不是准确的 candidateId:no；未替换为最新版本。');
        const result = await api.listCandidates(id, scopeKey);
        const candidate = result.candidates.find(item => item.candidateId === match[1] && item.no === Number(match[2]) && item.scopeKey === scopeKey);
        if (!candidate) return unavailable('所引用候选版本不存在或当前范围不可读；未替换为最新版本。');
        if (source.sha256 && source.sha256 !== candidate.contentSha256) return unavailable('候选版本内容指纹与检验引用不符；未展示可能已变化的正文。', candidate.contentSha256);
        const anchorReport = reports.versions.find(item => item.no === candidate.anchor.reportNo);
        setSourcePreview({ kind: 'candidate', source, candidate, anchorReport });
      } else if (source.kind === 'file') {
        if (!source.fileId) return unavailable('检验引用缺少准确 fileId，未按名称猜测文件。');
        const result = await api.readInitiativeFile(id, source.fileId, scopeKey);
        if (source.sha256 && source.sha256 !== result.file.sha256) return unavailable('文件实际内容指纹与检验引用不符；未展示可能已变化的正文。', result.file.sha256);
        const preview = decodeFilePreview(result.file.name, result.contentBase64);
        setSourcePreview({ kind: 'file', source, name: result.file.name, content: preview.content, actualSha256: result.file.sha256 });
      } else {
        unavailable('公开来源仅保留原引用，未留存可证明一致的准确快照；不访问当前网页替代历史依据。');
      }
    } catch (fault) { unavailable(errorText(fault)); }
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
    {mainPresentation.kind !== 'idle' && !(mainPresentation.kind === 'running' && !pending) && <div className={mainPresentation.tone === 'positive' ? 'si-notice si-notice-positive' : mainPresentation.tone === 'warning' || mainPresentation.tone === 'error' ? 'si-notice si-notice-warning' : 'si-notice'} role="status">
      <p><strong>{mainPresentation.label}</strong> · {mainPresentation.detail}</p>
      {pending && mainPresentation.canRecover && <button type="button" className="secondary-button" disabled={busy} onClick={() => { void recover(); }}>核对原请求</button>}
      {pending && mainPresentation.canReplace && <button type="button" className="secondary-button" disabled={busy || !(draft || pending.text).trim()} onClick={() => { void sendMain(draft || pending.text, pending.requestId); }}>替换原请求并发送</button>}
      {pending && <details><summary>原请求编号</summary><code>{pending.requestId}</code></details>}
    </div>}
    {!session && !loading && <p className="si-muted">首次发送将为本范围创建主会话；模型沿当前选择。<button type="button" className="text-button" onClick={onSettings}>前往模型设置</button></p>}
  </section>;

  const kickoff = <section className="sg-panel si-panel" aria-label="开题报告">
    <div className="si-panel-head"><div><p className="si-eyebrow">战略启动 · 诊断锚定</p><h2>开题报告{report ? ` v${report.no}` : ''}</h2></div>{report && <Badge tone={report.lock ? (anchor?.reportNo === report.no ? 'positive' : 'accent') : 'neutral'}>{report.lock ? (anchor?.reportNo === report.no ? '已应用为方案输入' : '已锁定') : '草稿'}</Badge>}</div>
    {scopedVersions.length > 1 && <label className="si-inline-picker">报告版本<select aria-label="报告版本" value={report?.no ?? ''} onChange={event => setReportNo(Number(event.target.value))}>{scopedVersions.slice().reverse().map(version => <option key={version.no} value={version.no}>开题报告 v{version.no}</option>)}</select></label>}
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
      onLock={() => setDialog('lock-candidate')} onRevise={() => setDialog('revise-candidate')} onSession={() => setDialog('candidate-session')} onNewFromParent={() => setDialog('new-candidate-from-parent')} onStage={onStage} />}
    {comparable.length > 1
      ? conversation('主会话 · 候选比较', `围绕开题报告 v${anchor.reportNo}，比较 ${comparable.length} 个候选方向。`, '例如：预算固定时，两种方案的主要取舍是什么？')
      : session && <section className="sg-panel si-panel" aria-label="主会话原讨论">
          <div className="si-panel-head"><div><h3>主会话原讨论</h3><p className="si-muted">单候选方案页也可随时查看主会话的开题、比较与限定修改讨论记录。</p></div><button type="button" className="secondary-button" onClick={() => setDialog('main-discussion')}>查看主会话讨论</button></div>
        </section>}
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
      {stage === 'strategy-check' && <StrategyCheckPanel initiativeId={id} candidates={candidates} batches={history?.verifications ?? []} selected={selectedCandidate} onSelect={setSelectedCandidate} onStage={onStage} onRevise={candidate => { setSelectedCandidate({ candidateId: candidate.candidateId, no: candidate.no }); setDialog('revise-candidate'); }} onRefresh={refresh} onOpenSource={source => { void openSource(source); }} />}
      {stage === 'strategy-release' && <StrategyReleaseReview initiativeId={id} scope={scope} scopes={access.scopes} candidates={candidates} batches={history?.verifications ?? []} publications={publications} selected={selectedCandidate} onSelect={setSelectedCandidate} onStage={onStage} onRefresh={refresh} onGoalsChanged={async () => { await access.onGoalsChanged(); }} />}
      {stage === 'strategy-versions' && <StrategyVersionsPanel initiativeId={id} scopeKey={scopeKey} history={history} access={access} legacyId={legacyId} onLegacySelect={setLegacyId} legacyFocus={legacyFocus} onOpenSession={ref => { setSelectedCandidate(ref); setDialog('candidate-session'); }} />}
    </div>
    <div className="si-side">
      <CaseFormError error={fileError} />
      <InitiativeFilePanel files={files} reports={scopedVersions} candidates={candidates} batches={history?.verifications ?? []} scopeKey={scopeKey} busy={fileBusy}
        pendingUploads={pendingUploads}
        pendingUploadPayloadIds={pendingUploadPayloadIds}
        onUpload={(directory, file, scopeExclusive) => { void upload(directory, file, scopeExclusive); }}
        onOpenFile={file => { void openFile(file); }}
        onOpenReport={(entry: ReportFileEntry) => setPreview({ title: entry.name, content: entry.content })}
        onCheckPendingUpload={opId => { void checkPendingUpload(opId); }}
        onRetryPendingUpload={opId => { void retryPendingUpload(opId); }}
        onReselectPendingUpload={(opId, file) => { void reselectPendingUpload(opId, file); }}
        onDismissPendingUpload={dismissPendingUpload} />
    </div>
    {dialog === 'new-candidate' && <NewCandidateDialog initiativeId={id} scope={scope} anchorNo={anchor?.reportNo} onClose={() => setDialog(null)} onCreated={async candidate => { setDialog(null); await refresh(); setSelectedCandidate({ candidateId: candidate.candidateId, no: candidate.no }); setNotice('候选独立会话已启动；完成后回到主窗口核对。'); }} />}
    {dialog === 'new-candidate-from-parent' && current && <NewCandidateDialog initiativeId={id} scope={scope} anchorNo={current.anchor.reportNo} parent={current} onClose={() => setDialog(null)} onCreated={async candidate => { setDialog(null); await refresh(); setSelectedCandidate({ candidateId: candidate.candidateId, no: candidate.no }); setNotice(`已基于父版 ${candidateLabel(current)} 启动新候选 v${candidate.no} 的独立会话；新版须重新锁定与检验。`); }} />}
    {dialog === 'lock-report' && report && <LockConfirmDialog title="锁定开题报告" subtitle={`确认开题报告 v${report.no} 的战略命题、资料依据和待核项。锁定后可将此准确版本用作方案输入。`} body={<KickoffBody version={report} />} busy={busy}
      onConfirm={operationId => api.lockKickoffReport(id, report.no, { operationId, sha256: report.contentSha256 }, scopeKey)}
      onDone={async () => { setDialog(null); await refresh(); setNotice(`已锁定开题报告 v${report.no}。`); }} onClose={() => setDialog(null)} />}
    {dialog === 'lock-candidate' && current && <LockConfirmDialog title="锁定战略候选" subtitle={`确认 ${candidateLabel(current)} 的完整方案及开题报告 v${current.anchor.reportNo}。锁定后可以开始战略检验。`}
      preface={current.goals.length === 0
        ? <p className="si-notice si-notice-warning" role="status">可承接目标：0 个。锁定后此版不可原位修改；仍可完成检验并作为战略记录正式发布，但发布后无法「带入目标管理」。如需补齐可承接目标，请先返回候选会话补充后再锁定。</p>
        : <p className="si-notice si-notice-positive" role="status">可承接目标：{current.goals.length} 个（锁定并通过双检验发布后，可按需带入目标管理）。</p>}
      secondaryAction={current.goals.length === 0 ? { label: '先回候选会话补充目标', onClick: () => setDialog('candidate-session') } : undefined}
      body={<CandidateBody candidate={current} />} busy={busy}
      onConfirm={operationId => api.lockCandidate(id, current.candidateId, current.no, { operationId, sha256: current.contentSha256 })}
      onDone={async () => { setDialog(null); await refresh(); setNotice('已锁定，可以开始因果检验。'); onStage('strategy-check'); }} onClose={() => setDialog(null)} />}
    {dialog === 'revise-report' && report && <ReviseDialog title="限定修改开题报告" baseLabel={`开题报告 · v${report.no}`} baseSha256={report.contentSha256} targets={kickoffPatchTargets(report.fields)} maxText={8000}
      propose={input => api.proposeReportRevision(id, report.no, scopeKey, input)} readProposal={pid => api.readProposal(id, pid, scopeKey)}
      readMainDiscussion={() => api.readInitiativeSession(id, scopeKey).catch(fault => { if (fault instanceof api.StrategyInitiativeRequestError && fault.status === 404) return null; throw fault; })}
      modelLabel={modelLabel}
      onSubmit={input => api.reviseKickoffReport(id, report.no, input, scopeKey)}
      onDone={async result => { setDialog(null); await refresh(); setReportNo(result.version.no); setPhase('kickoff'); setNotice(`已另存开题草稿 v${result.version.no}；修订版仍须重新锁定并明确应用。`); }} onClose={() => setDialog(null)} />}
    {dialog === 'revise-candidate' && current && <ReviseDialog title="限定修改战略候选" baseLabel={candidateLabel(current)} baseSha256={current.contentSha256} targets={current.blocks.map(block => ({ blockId: block.id, label: block.label, text: block.text }))} maxText={20000}
      propose={input => api.proposeCandidateRevision(id, current.candidateId, current.no, input)} readProposal={pid => api.readProposal(id, pid, scopeKey)}
      readMainDiscussion={() => api.readInitiativeSession(id, scopeKey).catch(fault => { if (fault instanceof api.StrategyInitiativeRequestError && fault.status === 404) return null; throw fault; })}
      modelLabel={modelLabel}
      onSubmit={input => api.reviseCandidate(id, current.candidateId, current.no, input)}
      onDone={async result => { setDialog(null); await refresh(); setSelectedCandidate({ candidateId: result.candidate.candidateId, no: result.candidate.no }); setNotice(`已另存新候选 v${result.candidate.no}；每版使用新的独立会话，重新进入候选态。`); }} onClose={() => setDialog(null)} />}
    {dialog === 'candidate-session' && current && <CandidateSessionDialog initiativeId={id} candidateRef={{ candidateId: current.candidateId, no: current.no }} onClose={() => setDialog(null)} onChanged={refresh} modelLabel={modelLabel} />}
    {dialog === 'main-discussion' && <CaseDialog title="主会话原讨论" subtitle={`${initiative.title} · ${scope.name}`} onClose={() => setDialog(null)} className="si-version-dialog">
      <div className="si-dialog-scroll">
        {transcriptMessages(session?.snapshot).length > 0
          ? <StrategyDiscussionTranscript messages={transcriptMessages(session?.snapshot)} conversationKey={`initiative-readback:${id}:${scopeKey}`} modelLabel={modelLabel} label="主会话原讨论记录" />
          : <p className="si-muted">主会话尚无已保存讨论记录。</p>}
      </div>
      <div className="case-dialog-actions"><button type="button" className="secondary-button" onClick={() => setDialog(null)}>关闭</button></div>
    </CaseDialog>}
    {sourcePreview?.kind === 'report' && <ReportVersionDialog version={sourcePreview.version} anchor={sourcePreview.anchor} onClose={() => setSourcePreview(null)} />}
    {sourcePreview?.kind === 'candidate' && <VersionReceiptDialog candidate={sourcePreview.candidate} anchorReport={sourcePreview.anchorReport} batch={latestBatch(history?.verifications ?? [], sourcePreview.candidate)} publication={publicationFor(publications, sourcePreview.candidate)} onClose={() => setSourcePreview(null)} />}
    {sourcePreview?.kind === 'file' && <CaseDialog title={`检验依据 · ${sourcePreview.name}`} subtitle={`准确文件 · ${sourcePreview.source.fileId}`} onClose={() => setSourcePreview(null)} className="si-version-dialog">
      <div className="si-dialog-scroll"><p className="si-muted">引用指纹 <code>{sourcePreview.source.sha256 ?? '未记录'}</code></p><p className="si-muted">实际指纹 <code>{sourcePreview.actualSha256}</code></p><p className="si-file-preview">{sourcePreview.content}</p></div>
      <div className="case-dialog-actions"><button type="button" className="secondary-button" onClick={() => setSourcePreview(null)}>关闭</button></div>
    </CaseDialog>}
    {sourcePreview?.kind === 'unavailable' && <CaseDialog title={`核对依据 · ${verificationSourceLabels[sourcePreview.source.kind]}`} subtitle={sourcePreview.source.ref} onClose={() => setSourcePreview(null)} className="si-version-dialog">
      <div className="si-dialog-scroll"><p className="si-notice si-notice-warning" role="status">{sourcePreview.reason}</p>{sourcePreview.source.fileId && <p className="si-muted">文件身份 <code>{sourcePreview.source.fileId}</code></p>}<p className="si-muted">引用指纹 <code>{sourcePreview.source.sha256 ?? '未记录'}</code></p>{sourcePreview.actualSha256 && <p className="si-muted">实际指纹 <code>{sourcePreview.actualSha256}</code></p>}</div>
      <div className="case-dialog-actions"><button type="button" className="secondary-button" onClick={() => setSourcePreview(null)}>关闭</button></div>
    </CaseDialog>}
    {preview && <CaseDialog title={preview.title} subtitle="资料预览 · 原字节保留" onClose={() => setPreview(null)} className="si-version-dialog"><div className="si-dialog-scroll"><p className="si-file-preview">{preview.content}</p></div><div className="case-dialog-actions"><button type="button" className="secondary-button" onClick={() => setPreview(null)}>关闭</button></div></CaseDialog>}
  </div>;
}

function CandidateDetailPanel({ candidate, batch, publication, busy, onLock, onRevise, onSession, onNewFromParent, onStage }: {
  candidate: CandidateVersion; batch?: import('../strategy-initiative-types.ts').VerificationBatch; publication?: InitiativePublication; busy: boolean;
  onLock: () => void; onRevise: () => void; onSession: () => void; onNewFromParent: () => void; onStage: (stage: ManagementStage) => void;
}) {
  const status = candidateStatus(candidate, { batch, publication });
  const generating = candidate.lastRun?.status === 'accepted';
  return <section className="sg-panel si-panel" aria-label="候选详情">
    <div className="si-panel-head"><div><p className="si-eyebrow">方案正文</p><h2>{candidateLabel(candidate)}</h2><p className="si-muted">候选会话 {candidate.candidateId.slice(0, 8)} · 锚定开题报告 v{candidate.anchor.reportNo}{candidate.parent ? ` · 修订自 v${candidate.parent.no}` : ''}</p></div><Badge tone={status.tone}>{status.label}</Badge></div>
    {candidate.returned && <p className="si-notice si-notice-warning" role="status">检验意见已留档。修订会生成新候选，并从因果检验重走。</p>}
    {!generating && candidate.blocks.length > 0 && !candidate.lock && !publication && candidate.goals.length === 0 && <p className="si-notice si-notice-warning" role="status">当前可承接目标 0 个：可以直接锁定并作为战略记录发布，但发布后无法「带入目标管理」。如需补齐可承接目标，可先在原候选会话中用自然语言让 Agent 读回正文并补充目标。</p>}
    {candidate.lock && candidate.goals.length === 0 && <p className="si-muted" role="status">此锁定版可承接目标 0 个且不可原位修改；如需补充可承接目标，可基于此版新建候选版本（新独立会话与新指纹，须重新锁定与检验）。</p>}
    {generating && !candidate.blocks.length ? <p className="si-muted" role="status">候选会话正在整理获准资料和方案。可继续查看其他候选，或打开会话入口回看。</p> : <CandidateBody candidate={candidate} />}
    <div className="si-actions">
      {publication ? <button type="button" className="secondary-button" onClick={() => onStage('strategy-release')}>查看发布记录</button>
        : candidate.returned ? <button type="button" className="primary-button" disabled={busy} onClick={onRevise}>按检验意见修订</button>
        : candidate.lock ? <button type="button" className="primary-button" onClick={() => onStage('strategy-check')}>前往战略检验</button>
        : !generating && candidate.blocks.length > 0 && <button type="button" className="primary-button" disabled={busy} onClick={onLock}>审核并锁定</button>}
      {!generating && candidate.blocks.length > 0 && !candidate.lock && !publication && candidate.goals.length === 0 && <button type="button" className="secondary-button" disabled={busy} onClick={onSession}>在候选会话补充目标</button>}
      {!generating && candidate.blocks.length > 0 && !candidate.lock && !publication && <button type="button" className="secondary-button" disabled={busy} onClick={onRevise}>限定修改</button>}
      {candidate.lock && batch?.state !== 'running' && <button type="button" className="secondary-button" disabled={busy} onClick={onRevise}>从此版修订</button>}
      {candidate.lock && batch?.state !== 'running' && <button type="button" className="secondary-button" disabled={busy} onClick={onNewFromParent}>基于此版新建候选补充目标</button>}
      <button type="button" className="secondary-button" onClick={onSession}>查看候选会话</button>
    </div>
  </section>;
}

function NewCandidateDialog({ initiativeId, scope, anchorNo, parent, onClose, onCreated }: { initiativeId: string; scope: GoalScope; anchorNo?: number; parent?: CandidateVersion; onClose: () => void; onCreated: (candidate: CandidateVersion) => Promise<void> }) {
  const [title, setTitle] = useState(parent?.title ?? ''), [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operationId = useOperationId();
  return <CaseDialog title={parent ? `基于 ${candidateLabel(parent)} 新建候选` : '新建候选会话'} subtitle={parent ? `将作为父版 ${candidateLabel(parent)} 的后续新版本建立独立会话与新指纹；原锁定版、检验与发布凭证保留且不复用，新版须重新锁定与检验。` : anchorNo ? `沿用开题报告 v${anchorNo} 和当前范围的获准资料；每个候选版本独立使用一个可持久重开的会话。` : '请先应用开题报告。'} busy={busy} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault();
      if (!title.trim() || !instruction.trim() || busy || !anchorNo) return;
      const parentRef = parent ? { candidateId: parent.candidateId, no: parent.no } : undefined;
      const id = operationId({ title: title.trim(), instruction: instruction.trim(), scopeKey: initiativeScopeKey(scope), parent: parentRef ?? null });
      setBusy(true); setError('');
      void api.createCandidate(initiativeId, { operationId: id, scope, title: title.trim(), instruction: instruction.trim(), ...(parentRef ? { parent: parentRef } : {}) })
        .then(result => onCreated(result.candidate)).catch(fault => setError(errorText(fault))).finally(() => setBusy(false));
    }}>
      <div className="case-field"><label htmlFor="si-candidate-title">方向标题</label><input id="si-candidate-title" required maxLength={200} disabled={busy} value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：会员复购优先" /></div>
      <div className="case-field"><label htmlFor="si-candidate-instruction">方向要求</label><textarea id="si-candidate-instruction" required rows={4} maxLength={20000} disabled={busy} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={parent ? '例如：保留父版正文，补充 2–3 条可量化承接的战略目标…' : '说明该方向的增长逻辑、取舍与需要核对的假设…'} /></div>
      <CaseFormError error={error} />
      <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy || !anchorNo}>{busy ? '正在启动…' : '启动独立会话'}</button></div>
    </form>
  </CaseDialog>;
}

function LockConfirmDialog({ title, subtitle, preface, body, busy, secondaryAction, onConfirm, onDone, onClose }: { title: string; subtitle: string; preface?: ReactNode; body: ReactNode; busy: boolean; secondaryAction?: { label: string; onClick: () => void }; onConfirm: (operationId: string) => Promise<unknown>; onDone: () => Promise<void>; onClose: () => void }) {
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const operationId = useOperationId();
  return <CaseDialog title={title} subtitle={subtitle} busy={busy || saving} onClose={onClose} className="si-version-dialog">
    <div className="si-dialog-scroll">{preface}{body}</div>
    <CaseFormError error={error} />
    <div className="case-dialog-actions">
      <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>取消</button>
      {secondaryAction && <button type="button" className="secondary-button" disabled={saving || busy} onClick={secondaryAction.onClick}>{secondaryAction.label}</button>}
      <button type="button" className="primary-button" disabled={saving || busy} onClick={() => {
        if (saving) return; setSaving(true); setError('');
        void onConfirm(operationId({ title })).then(async () => { await onDone(); }).catch(fault => setError(errorText(fault))).finally(() => setSaving(false));
      }}>{saving ? '正在锁定…' : '确认锁定'}</button>
    </div>
  </CaseDialog>;
}

export interface ReviseFeedbackSummary {
  proposalId: string;
  requestId?: string;
  blockId: string;
  blockLabel: string;
  status: 'ended' | 'failed';
  feedback?: api.RevisionProposalFeedback;
}

export interface SubmittedProposalSnapshot {
  proposalId: string;
  requestId?: string;
  baseLabel: string;
  baseSha256: string;
  blockId: string;
  blockLabel: string;
  baselineText: string;
  request: string;
}

export function ReviseDialog<T>({
  title, baseLabel, baseSha256, targets, maxText, propose, readProposal, onSubmit, onDone, onClose,
  readMainDiscussion, modelLabel, initialFeedback = null,
  initialBusy = false, initialStep = 'intent', initialSubmitted = null, initialProposedText = '',
}: {
  title: string; baseLabel: string; baseSha256: string; targets: PatchTarget[]; maxText: number;
  propose: (input: { operationId: string; blockId: string; request: string }) => Promise<{ proposal: { proposalId: string }; requestId?: string }>;
  readProposal: (proposalId: string) => Promise<{ proposal: { status: string; newText?: string; requestId?: string; feedback?: api.RevisionProposalFeedback } }>;
  onSubmit: (input: { operationId: string; baseSha256: string; request: string; patches: { blockId: string; expectedOldSha256: string; newText: string }[]; proposalId: string }) => Promise<T>;
  onDone: (result: T) => Promise<void>; onClose: () => void;
  readMainDiscussion?: () => Promise<InitiativeSessionDetail | null>;
  modelLabel?: string;
  initialFeedback?: ReviseFeedbackSummary | null;
  initialBusy?: boolean;
  initialStep?: 'intent' | 'waiting' | 'diff';
  initialSubmitted?: SubmittedProposalSnapshot | null;
  initialProposedText?: string;
}) {
  const [blockId, setBlockId] = useState(targets[0]?.blockId ?? '');
  const target = targets.find(item => item.blockId === blockId) ?? targets[0];
  const [request, setRequest] = useState('');
  const [step, setStep] = useState<'intent' | 'waiting' | 'diff'>(initialStep);
  const [submitted, setSubmitted] = useState<SubmittedProposalSnapshot | null>(initialSubmitted);
  const [proposedText, setProposedText] = useState(initialProposedText);
  const [attemptCount, setAttemptCount] = useState(0);
  const [lastFeedback, setLastFeedback] = useState<ReviseFeedbackSummary | null>(initialFeedback);
  const [showDiscussion, setShowDiscussion] = useState(false);
  const [discussionDetail, setDiscussionDetail] = useState<InitiativeSessionDetail | null>(null);
  const [discussionLoading, setDiscussionLoading] = useState(false);
  const [discussionError, setDiscussionError] = useState('');
  const [busy, setBusy] = useState(initialBusy), [error, setError] = useState('');
  const operationId = useOperationId();
  const alive = useRef(true);
  const activeProposalRef = useRef(initialSubmitted?.proposalId ?? '');
  const submissionSeqRef = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; submissionSeqRef.current += 1; activeProposalRef.current = ''; }; }, []);
  useEffect(() => {
    if (step !== 'waiting' || !submitted) return;
    let cancelled = false;
    activeProposalRef.current = submitted.proposalId;
    const watched = submitted;
    const poll = () => {
      void readProposal(watched.proposalId).then(result => {
        if (cancelled || !alive.current || activeProposalRef.current !== watched.proposalId) return;
        const p = result.proposal;
        if (p.status === 'proposed' && p.newText) {
          setProposedText(p.newText);
          setLastFeedback(null);
          setStep('diff');
        } else if (p.status === 'ended' || p.status === 'failed') {
          activeProposalRef.current = '';
          setSubmitted(null);
          setAttemptCount(value => value + 1);
          setLastFeedback({
            proposalId: watched.proposalId,
            requestId: p.feedback?.requestId ?? p.requestId ?? watched.requestId,
            blockId: watched.blockId,
            blockLabel: watched.blockLabel,
            status: p.status,
            feedback: p.feedback,
          });
          setStep('intent');
        }
      }).catch(fault => {
        if (!cancelled && alive.current && activeProposalRef.current === watched.proposalId) {
          activeProposalRef.current = '';
          setSubmitted(null);
          setAttemptCount(value => value + 1);
          setError(errorText(fault));
          setStep('intent');
        }
      });
    };
    const timer = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [step, submitted]);
  const openDiscussion = async () => {
    if (!readMainDiscussion) return;
    if (showDiscussion) { setShowDiscussion(false); return; }
    setShowDiscussion(true); setDiscussionLoading(true); setDiscussionError('');
    try {
      const next = await readMainDiscussion();
      if (alive.current) setDiscussionDetail(next);
    } catch (fault) {
      if (alive.current) setDiscussionError(errorText(fault));
    } finally {
      if (alive.current) setDiscussionLoading(false);
    }
  };
  const closeDialog = () => {
    submissionSeqRef.current += 1;
    activeProposalRef.current = '';
    onClose();
  };
  const startProposal = async (event: FormEvent) => {
    event.preventDefault();
    const cleanedRequest = request.trim();
    if (!cleanedRequest || !target || busy) return;
    const snapshotBase = {
      baseLabel,
      baseSha256,
      blockId: target.blockId,
      blockLabel: target.label,
      baselineText: target.text,
      request: cleanedRequest,
    };
    const seq = ++submissionSeqRef.current;
    setBusy(true); setError(''); setLastFeedback(null); setShowDiscussion(false);
    try {
      const id = operationId({ baseSha256: snapshotBase.baseSha256, blockId: snapshotBase.blockId, request: snapshotBase.request, attempt: attemptCount });
      const result = await propose({ operationId: id, blockId: snapshotBase.blockId, request: snapshotBase.request });
      if (!alive.current || submissionSeqRef.current !== seq) return;
      const nextSubmitted: SubmittedProposalSnapshot = {
        ...snapshotBase,
        proposalId: result.proposal.proposalId,
        requestId: result.requestId,
      };
      activeProposalRef.current = nextSubmitted.proposalId;
      setSubmitted(nextSubmitted);
      setProposedText('');
      setStep('waiting');
    } catch (fault) { if (alive.current && submissionSeqRef.current === seq) setError(errorText(fault)); }
    finally { if (alive.current && submissionSeqRef.current === seq) setBusy(false); }
  };
  const noActualChange = Boolean(submitted && proposedText === submitted.baselineText);
  const liveSubmittedTarget = submitted ? targets.find(item => item.blockId === submitted.blockId) : undefined;
  const liveBaselineChanged = Boolean(submitted && (baseSha256 !== submitted.baseSha256 || !liveSubmittedTarget || liveSubmittedTarget.text !== submitted.baselineText));
  const adopt = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !submitted || !proposedText.trim() || noActualChange) return;
    const active = submitted;
    setBusy(true); setError('');
    try {
      const expectedOldSha256 = await sha256Of(active.baselineText);
      const id = operationId({ baseSha256: active.baseSha256, blockId: active.blockId, request: active.request, newText: proposedText, proposalId: active.proposalId });
      const result = await onSubmit({
        operationId: id,
        baseSha256: active.baseSha256,
        request: active.request,
        patches: [{ blockId: active.blockId, expectedOldSha256, newText: proposedText }],
        proposalId: active.proposalId,
      });
      await onDone(result);
    } catch (fault) { if (alive.current) setError(errorText(fault)); }
    finally { if (alive.current) setBusy(false); }
  };
  const returnToIntent = () => {
    submissionSeqRef.current += 1;
    activeProposalRef.current = '';
    setSubmitted(null);
    setProposedText('');
    setError('');
    setAttemptCount(value => value + 1);
    setStep('intent');
  };
  const subtitleLabel = submitted ? submitted.baseLabel : baseLabel;
  const subtitleSha = submitted ? submitted.baseSha256 : baseSha256;
  return <CaseDialog title={title} subtitle={`基于 ${subtitleLabel}（指纹 ${subtitleSha.slice(0, 12)}…）。描述修改意图，由 Agent 严格在所选块内拟改；核对差异后采纳另存，其他章节保留原文。`} busy={busy} onClose={closeDialog} className="si-version-dialog">
    {step === 'intent' && <form onSubmit={startProposal}>
      <div className="si-dialog-scroll">
        <div className="case-field"><label htmlFor="si-revise-block">修改位置（单块限定）</label><select id="si-revise-block" disabled={busy} value={blockId} onChange={event => setBlockId(event.target.value)}>{targets.map(item => <option key={item.blockId} value={item.blockId}>{item.label}（{item.blockId}）</option>)}</select></div>
        {target && <div className="si-revise-baseline" aria-label="当前所选块原文">
          <strong>当前修改对象：{baseLabel} · 「{target.label}」（{target.blockId}）</strong>
          <p>{target.text || '（该块当前正文为空）'}</p>
        </div>}
        <div className="case-field"><label htmlFor="si-revise-request">修改意图</label><textarea id="si-revise-request" required disabled={busy} rows={3} maxLength={2000} value={request} onChange={event => setRequest(event.target.value)} placeholder="例如：将三店试点调整为两店，先核对导购工时。" /></div>
        {lastFeedback && <div className={`si-proposal-feedback si-notice ${lastFeedback.status === 'failed' ? 'si-notice-warning' : ''}`} role="status" aria-label="本轮拟改反馈">
          {lastFeedback.status === 'ended' ? (
            lastFeedback.feedback?.replyText ? <>
              <p><strong>Agent 本轮回复（针对「{lastFeedback.blockLabel}」· 未提出补丁，原稿未改动）</strong></p>
              <p className="si-proposal-reply">{lastFeedback.feedback.replyText}</p>
              <p className="si-muted">请根据 Agent 说明确认或改选上方「修改位置」与「修改意图」后再提交；变更仍限定在获准单个块内。</p>
            </> : <>
              <p><strong>Agent 本轮已结束且未提出补丁（针对「{lastFeedback.blockLabel}」· 原稿未改动）</strong></p>
              <p className="si-muted">本轮未返回文字说明。可查看主会话原讨论核对，或改选修改位置／调整意图后继续拟改。</p>
            </>
          ) : <>
            <p><strong>{lastFeedback.feedback?.outcome === 'cancelled' ? '本轮拟改已取消（原稿未改动）' : lastFeedback.feedback?.outcome === 'unknown' ? '本轮拟改结果未知（原稿未改动）' : '本轮拟改技术失败（原稿未改动）'}</strong></p>
            <p>{lastFeedback.feedback?.failureDetail || '请核对主会话原讨论，确认状态后再决定是否重新拟改。'}</p>
            {lastFeedback.feedback?.failureCode && <p className="si-muted">错误分类：<code>{lastFeedback.feedback.failureCode}</code></p>}
          </>}
          <details><summary>本次拟改回执</summary><p className="si-muted">proposalId <code>{lastFeedback.proposalId}</code>{lastFeedback.requestId ? <> · requestId <code>{lastFeedback.requestId}</code></> : null}</p></details>
          {readMainDiscussion && <div className="si-actions"><button type="button" className="secondary-button" onClick={() => { void openDiscussion(); }}>{showDiscussion ? '收起主会话原讨论' : '查看主会话原讨论'}</button></div>}
        </div>}
        {showDiscussion && <div className="si-content-block" aria-label="主会话原讨论只读回看">
          <h4>主会话原讨论</h4>
          {discussionLoading ? <p className="si-muted" role="status">正在读取主会话原讨论…</p>
            : discussionError ? <CaseFormError error={discussionError} />
            : transcriptMessages(discussionDetail?.snapshot).length > 0
              ? <StrategyDiscussionTranscript messages={transcriptMessages(discussionDetail?.snapshot)} conversationKey={`proposal-readback:${lastFeedback?.proposalId ?? 'current'}`} modelLabel={modelLabel} label="主会话原讨论记录" />
              : <p className="si-muted">主会话尚无已保存讨论记录。</p>}
        </div>}
      </div>
      <CaseFormError error={error} />
      <div className="case-dialog-actions"><button type="button" className="secondary-button" onClick={closeDialog}>取消</button><button type="submit" className="primary-button" disabled={!request.trim() || busy}>{busy ? '正在提交…' : '请 Agent 拟改'}</button></div>
    </form>}
    {step === 'waiting' && submitted && <div className="si-dialog-scroll">
      <p className="si-muted" role="status">Agent 正在基于准确基线拟改「{submitted.blockLabel}」（{submitted.blockId}）；完成后在此核对差异或查看 Agent 澄清回复。未采纳前不另存版本。</p>
      <div className="si-revise-baseline"><strong>本轮修改意图（{submitted.baseLabel} · 「{submitted.blockLabel}」）</strong><p>{submitted.request}</p></div>
      <CaseFormError error={error} />
      <div className="case-dialog-actions"><button type="button" className="secondary-button" onClick={closeDialog}>取消</button></div>
    </div>}
    {step === 'diff' && submitted && <form onSubmit={adopt}>
      <div className="si-dialog-scroll">
        <p>{submitted.baseLabel} · 仅修改「{submitted.blockLabel}」（{submitted.blockId}）。其他章节以原字节和顺序复用。</p>
        {liveBaselineChanged && <p className="si-notice si-notice-warning" role="status">提示：当前正文已发生变化，本提案仍绑定提交时基线；如需基于最新正文修改，请返回重新拟改。</p>}
        {noActualChange && <p className="si-notice si-notice-warning" role="status">Agent 拟改内容与当前原文完全一致（无实际变化），无需另存新版本；可返回调整修改意图或改选修改位置。</p>}
        <div className="si-diff"><div className="si-diff-before"><strong>原文</strong><p>{submitted.baselineText}</p></div><div className="si-diff-after"><strong>Agent 拟改</strong><p>{proposedText}</p></div></div>
      </div>
      <CaseFormError error={error} />
      <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={returnToIntent}>返回修改意图</button><button type="submit" className="primary-button" disabled={busy || noActualChange}>{busy ? '正在另存…' : '采纳并另存新版本'}</button></div>
    </form>}
  </CaseDialog>;
}
const sha256Of = api.sha256Text;

function CandidateSessionDialog({ initiativeId, candidateRef, onClose, onChanged, modelLabel }: { initiativeId: string; candidateRef: CandidateRef; onClose: () => void; onChanged: () => Promise<void>; modelLabel: string }) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const lastUpdatedRef = useRef('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = async () => {
    try {
      const next = await api.readCandidate(initiativeId, candidateRef.candidateId, candidateRef.no);
      if (alive.current) {
        setDetail(next);
        setError('');
        if (lastUpdatedRef.current && next.candidate.updatedAt !== lastUpdatedRef.current) void onChanged();
        lastUpdatedRef.current = next.candidate.updatedAt;
      }
    }
    catch (fault) { if (alive.current) setError(errorText(fault)); }
    finally { if (alive.current) setLoading(false); }
  };
  useEffect(() => { lastUpdatedRef.current = ''; void load(); }, [initiativeId, candidateRef.candidateId, candidateRef.no]);
  const running = Boolean(detail?.busy || detail?.candidate.lastRun?.status === 'accepted');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void load(); }, 1500);
    return () => clearInterval(timer);
  }, [running, initiativeId, candidateRef.candidateId, candidateRef.no]);
  const candidate = detail?.candidate;
  const locked = Boolean(candidate?.lock);
  const act = async (action: () => Promise<unknown>) => { if (busy) return; setBusy(true); setError(''); try { await action(); await load(); await onChanged(); } catch (fault) { setError(errorText(fault)); } finally { if (alive.current) setBusy(false); } };
  return <CaseDialog title={`候选会话 ${candidateRef.candidateId.slice(0, 8)}`} subtitle={candidate ? `${candidateLabel(candidate)} · 开题报告 v${candidate.anchor.reportNo}` : '正在读取候选会话…'} busy={busy} onClose={onClose} className="si-version-dialog">
    <div className="si-dialog-scroll">
      {loading ? <p className="si-muted" role="status">正在读取候选会话…</p> : <>
        {candidate && !locked && <div className="si-content-block">
          <p className="si-muted">当前草稿：{candidate.blocks.length} 个章节 · 可承接目标 {candidate.goals.length} 个</p>
          {candidate.goals.length > 0
            ? <ul>{candidate.goals.map((goal, index) => <li key={index}>G{index + 1} · {goal}</li>)}</ul>
            : <p className="si-muted">当前可承接目标 0 个；可直接用自然语言说明希望补充的目标方向，Agent 会读回当前正文并保存可承接目标清单。</p>}
        </div>}
        {running && <p className="si-muted" role="status">候选会话正在整理获准资料和方案…</p>}
        <StrategyDiscussionTranscript messages={transcriptMessages(detail?.snapshot)} conversationKey={`initiative-candidate:${initiativeId}:${candidateRef.candidateId}:${candidateRef.no}`} modelLabel={modelLabel} label="候选会话记录" />
        {locked && <p className="si-muted">此版已锁定，正文作为检验基线保留；如需修改或补充目标，请基于此版新建候选版本。</p>}
        {!locked && <form className="si-composer" onSubmit={event => {
          event.preventDefault();
          if (!text.trim() || !candidate || busy || running) return;
          void act(async () => { await api.sendCandidateMessage(initiativeId, candidateRef.candidateId, candidateRef.no, { requestId: crypto.randomUUID(), text: text.trim(), expectedRevision: candidate.revision, ...(candidate.pendingInput && (['failed', 'cancelled'].includes(candidate.lastRun?.status ?? '') || (candidate.lastRun?.status === 'accepted' && !detail?.busy)) ? { replacePendingRequestId: candidate.pendingInput.requestId } : {}) }); setText(''); });
        }}>
          <label className="sr-only" htmlFor="si-candidate-text">候选会话输入</label>
          <textarea id="si-candidate-text" rows={3} maxLength={20000} value={text} disabled={busy || running} placeholder="继续补充该方向的要求、依据或可承接战略目标…" onChange={event => setText(event.target.value)} />
          <div className="si-actions">
            {running ? <button type="button" className="secondary-button" disabled={busy} onClick={() => { void act(() => api.stopCandidate(initiativeId, candidateRef.candidateId, candidateRef.no, candidate?.lastRun?.id)); }}>停止本轮生成</button> : <button type="submit" className="primary-button" disabled={!text.trim() || busy}>发送</button>}
            <button type="button" className="text-button" disabled={busy} onClick={() => { void act(() => api.closeCandidate(initiativeId, candidateRef.candidateId, candidateRef.no)); }}>关闭会话，保留历史</button>
          </div>
        </form>}
      </>}
      <CaseFormError error={error} />
    </div>
    <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>关闭</button></div>
  </CaseDialog>;
}
