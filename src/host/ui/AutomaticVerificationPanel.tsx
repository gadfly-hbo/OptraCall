import { useEffect, useId, useRef, useState } from 'react';
import type { AutomaticSettings, AutomaticSettingsInput, AutomaticVersion } from '../automatic-verification-types.ts';
import type { BrowserUIResponse, ClientProject, ClientTask, FileNode, PublicModelConfiguration } from './project-types.ts';
import type { RequirementContextSelection } from './requirement-types.ts';
import { projectFiles } from './runtime-client.ts';
import { readVerification, verificationFiles, type VerificationRecord } from './verification-client.ts';
import {
  AutomaticVerificationRequestError, AutomaticVerificationUncertain, automaticChainRunning, automaticChainLabel, automaticCleanupConfirmed, automaticCleanupRetryable,
  automaticPhaseLabel, automaticReasonLabel, automaticSettingsDraft, automaticSettingsIssue,
  listAutomaticChains, mergeAutomaticChains, readAutomaticCapabilities, readAutomaticChain,
  automaticReportBlob, automaticReportPreview, readAutomaticReport, readAutomaticSettings, readAutomaticStatus, respondAutomaticUI, saveAutomaticSettings, stopAutomaticChain,
  type AutomaticCapabilities, type AutomaticChainView, type AutomaticReport, type AutomaticStatus, type AutomaticUIRequest,
} from './automatic-verification-client.ts';
import './automatic-verification.css';

type Props = {
  project: ClientProject; task: ClientTask; configurations: PublicModelConfiguration[];
  taskBusy: boolean; filesRevision: number;
  requirementContext?: RequirementContextSelection;
  caseContext?: { id: string; title: string; description: string; revision: number };
  onFilesChanged?: () => void;
};
const errorText = (error: unknown) => error instanceof AutomaticVerificationRequestError || error instanceof AutomaticVerificationUncertain
  ? error.message : '暂未读回自动核算记录。可以只读重新查询，不会自动重发。';
const dateText = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : value ?? '未记录';
const freshSettings = (projectId: string, taskId: string): AutomaticSettings => ({ formatVersion: 1, projectId, taskId, revision: 0, enabled: false, dataFiles: [], processFiles: [], maxAuthorTurns: 2 });
const targetKey = (value: AutomaticUIRequest) => `${value.domain}/${value.verificationId ?? ''}/${value.request.id}`;

function AutomaticQuestion({ target, disabled, onAnswer }: { target: AutomaticUIRequest; disabled: boolean; onAnswer(answer: BrowserUIResponse): Promise<void> }) {
  const uid = useId(), request = target.request;
  const [value, setValue] = useState(request.prefill ?? ''), [selection, setSelection] = useState(''), [working, setWorking] = useState(false), [error, setError] = useState('');
  const answer = async (response: Omit<BrowserUIResponse, 'id'>) => {
    if (working || disabled) return;
    setWorking(true); setError('');
    try { await onAnswer({ id: request.id, ...response }); }
    catch (error) { setError(errorText(error)); }
    finally { setWorking(false); }
  };
  return <section className="automatic-question" aria-labelledby={`${uid}-title`} aria-busy={working}>
    <h4 id={`${uid}-title`}>{target.domain === 'project-tasks' ? '原主Agent' : '独立核算Agent'}等待回应：{request.title}</h4>
    {request.message && <p>{request.message}</p>}
    <form onSubmit={event => { event.preventDefault(); void answer({ value: request.method === 'select' ? selection : value }); }}>
      {request.method === 'select' && <fieldset disabled={disabled || working}><legend className="sr-only">{request.title}</legend>{(request.options ?? []).map((option, index) => <label className="verification-checkbox" key={`${index}:${option}`}><input type="radio" name={uid} value={option} checked={selection === option} required onChange={() => setSelection(option)} /><span>{option}</span></label>)}</fieldset>}
      {(request.method === 'input' || request.method === 'editor') && <div className="verification-field"><label htmlFor={`${uid}-answer`}>回应内容</label>{request.method === 'editor' ? <textarea id={`${uid}-answer`} rows={4} value={value} disabled={disabled || working} onChange={event => setValue(event.target.value)} /> : <input id={`${uid}-answer`} value={value} placeholder={request.placeholder} disabled={disabled || working} onChange={event => setValue(event.target.value)} />}</div>}
      {error && <p className="verification-error" role="alert">{error}</p>}
      <div className="verification-actions">{request.method === 'confirm' ? <><button type="button" className="secondary-button" disabled={disabled || working} onClick={() => { void answer({ value: false }); }}>不继续</button><button type="button" className="primary-button" disabled={disabled || working} onClick={() => { void answer({ value: true }); }}>确认继续</button></> : <><button type="button" className="secondary-button" disabled={disabled || working} onClick={() => { void answer({ cancelled: true }); }}>取消此回应</button><button type="submit" className="primary-button" disabled={disabled || working || (request.method === 'select' && !selection)}>提交回应</button></>}</div>
    </form><p className="verification-hint">只回应当前请求，不重新发起分析、核算或修订。</p>
  </section>;
}

function ChainMaterials({ chain, initial, reading, error, onRead }: { chain: AutomaticChainView; initial?: VerificationRecord; reading: boolean; error: string; onRead(): void }) {
  const snapshot = chain.settingsSnapshot, evidence = initial?.contextEvidence;
  return <details className="automatic-materials"><summary>本链材料与实际交付记录</summary>
    <section><h4>固定可用的材料</h4><p className="verification-hint">以下使用本链当时的设置与固定身份，不用当前设置重建。材料可用不代表已读取或理解。</p><p>源数据：{snapshot.dataFiles.join('、') || '未记录'}</p><p>待核报告：{snapshot.reportPath ?? '未记录'}</p><p>作者过程件：{snapshot.processFiles.join('、') || '未选择'}</p><p>{snapshot.requirementContext ? `RAP ${snapshot.requirementContext.instanceId} · ${snapshot.requirementContext.version ?? '当时选择的已确认快照'}` : '未选择RAP'}；{snapshot.caseId ? `Case ${snapshot.caseId} · 修订${snapshot.caseRevision ?? '未记录'}` : '未选择Case'}；{snapshot.useCurrentSap ? '当时明确选择SAP' : '未选择SAP'}</p>{snapshot.businessContext && <pre>{snapshot.businessContext}</pre>}{chain.semantics && <details><summary>当时固定的业务语义</summary><pre>{chain.semantics.text}</pre><p className="automatic-path">SHA-256：{chain.semantics.sha256}</p></details>}
      {chain.materials.length ? <ul className="automatic-material-list">{chain.materials.map((file, index) => <li key={`${file.kind}:${file.relativePath}:${index}`}><strong>{file.relativePath}</strong><span>{file.kind === 'data' ? '源材料' : file.kind === 'semantics' ? '事前语义' : '作者材料'} · {file.bytes.toLocaleString()} B</span><code>{file.sha256}</code><span>固定副本：{file.snapshotPath}</span></li>)}</ul> : <p className="verification-hint">本链尚未提供可回读的固定材料身份。</p>}
    </section>
    <section><h4>当时主动提供的文字</h4>{evidence ? <><p className="verification-hint">以下仅为首次核算的实际请求回读，后续返修/复查不由它推定。</p><p>{evidence.provided.note}</p>{evidence.provided.status === 'recorded' ? evidence.provided.fragments.map(file => <details key={file.relativePath}><summary>{file.relativePath}</summary><p>{file.start === null || file.end === null || file.totalLength === null ? '主动文字范围未知。' : `主动范围[${file.start}, ${file.end}) / ${file.totalLength} UTF-16；固定全文可用不等于主动全文交付。`}</p><p className="automatic-path">{file.fixedPath} · {file.sha256}</p>{file.text && <pre>{file.text}</pre>}</details>) : <p className="verification-hint">当时的逐文件主动范围未记录。</p>}</> : <p className="verification-hint">尚未回读实际请求片段，不能从当前文件推断曾提供全文。</p>}</section>
    <section><h4>有限读取线索</h4>{evidence ? <><p>{evidence.reads.note}</p>{evidence.reads.items.length ? <ul className="automatic-material-list">{evidence.reads.items.map((item, index) => <li key={`${item.requestId}:${index}`}><strong>{item.relativePath}</strong><span>{item.toolName} · {item.outcome === 'completed' ? '捕获完成事件' : item.outcome === 'failed' ? '捕获失败事件' : '捕获开始事件'}</span><span>{item.note}</span></li>)}</ul> : <p className="verification-hint">没有可展示的线索，保持未知；不能据此判定未读。</p>}</> : <p className="verification-hint">尚无可回读的工具线索，不把一次read或文件可用当作全文覆盖。</p>}</section>
    <section><h4>Agent原文说明</h4><p className="verification-hint">各步骤原文在下方保留，范围、依据和分歧由Agent自行说明；系统不将意见改写为正确性结论。</p>{initial?.coldResult && <details><summary>首次独立依据 · 原核算记录</summary><pre>{initial.coldResult.text}</pre></details>}{initial?.comparisonResult && <details><summary>首次对照意见 · 原核算记录</summary><pre>{initial.comparisonResult.text}</pre></details>}</section>
    {chain.firstVerification && <button type="button" className="secondary-button" disabled={reading} onClick={onRead}>{reading ? '正在读取…' : '只读回看首次核算材料与原文'}</button>}{error && <p className="verification-error" role="alert">{error}</p>}
  </details>;
}

/** A keyed reader belongs to exactly one owner, chain, version and SHA. A late
 * response from another reader never replaces the currently displayed draft. */
function FixedReport({ projectId, taskId, chainId, version }: { projectId: string; taskId: string; chainId: string; version: AutomaticVersion }) {
  const alive = useRef(true), pending = useRef<AbortController | undefined>(undefined);
  const [report, setReport] = useState<AutomaticReport>(), [reading, setReading] = useState(false), [error, setError] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current?.abort(); }; }, []);
  const read = async (download = false) => {
    if (reading) return;
    const controller = new AbortController(); pending.current = controller;
    setReading(true); setError('');
    try {
      const value = download && report ? report : await readAutomaticReport(projectId, taskId, chainId, version, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
      if (!alive.current || controller.signal.aborted) return;
      setReport(value);
      if (download) {
        const url = URL.createObjectURL(automaticReportBlob(value)), link = document.createElement('a');
        link.href = url; link.download = `v${version.version}-${version.relativePath.split('/').at(-1) ?? 'report'}`; link.hidden = true;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (error) {
      if (alive.current && !controller.signal.aborted) setError(error instanceof AutomaticVerificationRequestError ? error.message : '固定稿暂未读回，已读正文继续保留。不会改读当前同名文件或调用模型。');
    } finally { if (alive.current && pending.current === controller) { pending.current = undefined; setReading(false); } }
  };
  const preview = report ? automaticReportPreview(report) : undefined;
  return <details className="automatic-report-reader"><summary>读取固定稿正文与原始文件</summary>
    <p className="verification-hint">只回读本链版本{version.version}的固定副本，不取当前同名文件，不调用模型。</p>
    <div className="verification-actions"><button type="button" className="secondary-button" disabled={reading} aria-label={`读取版本${version.version}固定全文`} onClick={() => { void read(); }}>{reading ? '正在读取固定副本…' : report ? '重新读取固定全文' : '读取固定全文'}</button><button type="button" className="text-button" disabled={reading} aria-label={`下载版本${version.version}原始文件`} onClick={() => { void read(true); }}>下载固定原始文件</button></div>
    {reading && <p className="verification-hint" role="status">正在核对固定版本与字节身份…</p>}{error && <p className="verification-error" role="alert">{error}</p>}
    {preview ? <><p className="verification-hint">{preview.complete ? '已显示固定全文' : '仅显示固定全文片段'}：[ {preview.start}, {preview.end} ) / {preview.totalLength.toLocaleString()} UTF-16。{!preview.complete && '全文可通过原始文件下载回看。'}</p><pre tabIndex={0} aria-label={`版本${version.version}固定稿正文`}>{preview.text}</pre></> : report ? <p className="verification-hint">固定字节不能解码为UTF-8，没有文字预览；仍可下载原始文件。</p> : <p className="verification-hint">正文尚未读取；路径和文件可用不代表已经查看。</p>}
  </details>;
}

export function AutomaticVerificationPanel({ project, task, configurations, taskBusy, filesRevision, requirementContext, caseContext, onFilesChanged }: Props) {
  const uid = useId(), mounted = useRef(true), selectedTarget = useRef<string | undefined>(undefined), requestSerial = useRef(0), changed = useRef(onFilesChanged), seenVersions = useRef(new Map<string, number>());
  changed.current = onFilesChanged;
  const dialog = useRef<HTMLDialogElement>(null), settingsButton = useRef<HTMLButtonElement>(null), dialogHeading = useRef<HTMLHeadingElement>(null), formError = useRef<HTMLParagraphElement>(null);
  const [settings, setSettings] = useState(() => freshSettings(project.id, task.id)), [capabilities, setCapabilities] = useState<AutomaticCapabilities>();
  const [status, setStatus] = useState<AutomaticStatus>();
  const [chains, setChains] = useState<AutomaticChainView[]>([]), [selected, setSelected] = useState<AutomaticChainView>(), [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(false), [posting, setPosting] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [observeVersion, setObserveVersion] = useState(0);
  const [draft, setDraft] = useState<AutomaticSettingsInput>(), [draftRevision, setDraftRevision] = useState(0), [dialogOpen, setDialogOpen] = useState(false), [saveError, setSaveError] = useState(''), [saveUncertain, setSaveUncertain] = useState(false);
  const [files, setFiles] = useState<FileNode[]>([]), [filesError, setFilesError] = useState(''), [filesLoading, setFilesLoading] = useState(false);
  const [uncertainAction, setUncertainAction] = useState<{ chainId: string; operation: 'stop' | 'ui-response'; requestKey?: string }>();
  const [initial, setInitial] = useState<VerificationRecord>(), [initialLoading, setInitialLoading] = useState(false), [initialError, setInitialError] = useState('');
  const archived = Boolean(project.archivedAt), active = chains.some(automaticChainRunning), choices = verificationFiles(files), issue = draft ? automaticSettingsIssue(draft) : undefined;
  const apply = (value: AutomaticChainView) => {
    if (!mounted.current || selectedTarget.current !== value.chainId) return;
    setSelected(old => old?.chainId === value.chainId && old.revision > value.revision ? old : value);
    setChains(old => mergeAutomaticChains(old, [value]));
    const seen = seenVersions.current.get(value.chainId) ?? value.versions.length;
    seenVersions.current.set(value.chainId, value.versions.length);
    if (value.versions.length > seen) changed.current?.();
    setUncertainAction(old => old?.chainId !== value.chainId ? old : old.operation === 'stop'
      ? automaticCleanupConfirmed(value) ? undefined : old
      : value.uiRequests && !value.uiRequests.some(item => targetKey(item) === old.requestKey) ? undefined : old);
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestSerial.current++; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setLoading(true); setError('');
    void Promise.allSettled([readAutomaticSettings(project.id, task.id, controller.signal), listAutomaticChains(project.id, task.id, controller.signal), readAutomaticCapabilities(project.id, task.id, controller.signal), readAutomaticStatus(project.id, task.id, controller.signal)]).then(async ([configuration, history, capability, observed]) => {
      if (!alive) return;
      if (configuration.status === 'fulfilled') setSettings(configuration.value);
      if (capability.status === 'fulfilled') setCapabilities(capability.value);
      if (observed.status === 'fulfilled') setStatus(observed.value);
      if (history.status === 'fulfilled') {
        setChains(old => mergeAutomaticChains(old, history.value));
        const id = selectedTarget.current ?? history.value[0]?.chainId;
        if (id) {
          selectedTarget.current = id; setSelectedId(id);
          try { const value = await readAutomaticChain(project.id, task.id, id, controller.signal); if (alive) apply(value); }
          catch (error) { if (alive && !controller.signal.aborted) setError(errorText(error)); }
        }
      }
      if (alive && [configuration, history, capability, observed].some(item => item.status === 'rejected')) setError('部分设置、环境资格或历史观察尚未读回。请只读重新查询，已有输入不会被替换。');
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [project.id, task.id, observeVersion]);
  useEffect(() => {
    if (!settings.enabled && !active && !taskBusy) return;
    const controller = new AbortController(); let failures = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const observe = async () => {
      try {
        const [values, observed] = await Promise.all([listAutomaticChains(project.id, task.id, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])), readAutomaticStatus(project.id, task.id, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))]);
        if (controller.signal.aborted) return;
        setChains(old => mergeAutomaticChains(old, values)); failures = 0;
        setStatus(observed);
        const id = selectedTarget.current ?? values[0]?.chainId;
        if (id) { selectedTarget.current = id; setSelectedId(id); apply(await readAutomaticChain(project.id, task.id, id, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))); }
      } catch {
        if (controller.signal.aborted) return;
        if (++failures >= 3) { setError('自动处理的观察连接尚未恢复。可以查询原记录，不会重发任何阶段。'); return; }
      }
      if (!controller.signal.aborted) timer = setTimeout(observe, 2500);
    };
    timer = setTimeout(observe, 1500);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [project.id, task.id, settings.enabled, active, taskBusy, filesRevision, observeVersion]);
  useEffect(() => {
    setInitial(undefined); setInitialError(''); setInitialLoading(false);
  }, [selectedId]);
  useEffect(() => {
    if (!dialogOpen) return;
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    const frame = requestAnimationFrame(() => dialogHeading.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [dialogOpen]);
  useEffect(() => {
    if (!dialogOpen) return;
    const controller = new AbortController(); setFilesLoading(true); setFilesError('');
    void projectFiles(project.id).then(value => { if (!controller.signal.aborted) setFiles(value); }, () => { if (!controller.signal.aborted) setFilesError('项目文件暂未读回，原选择保留；可关闭后重新打开设置。'); }).finally(() => { if (!controller.signal.aborted) setFilesLoading(false); });
    return () => controller.abort();
  }, [dialogOpen, project.id, filesRevision]);
  const openSettings = () => {
    if (!draft) { setDraft(automaticSettingsDraft(settings)); setDraftRevision(settings.revision); }
    setSaveError(''); setDialogOpen(true);
  };
  const closeSettings = () => {
    if (posting) return;
    dialog.current?.close(); setDialogOpen(false);
    requestAnimationFrame(() => settingsButton.current?.focus());
  };
  const edit = (input: Partial<AutomaticSettingsInput>) => setDraft(old => ({ ...(old ?? automaticSettingsDraft(settings)), ...input }));
  const rebaseSettings = async () => {
    setPosting(true); setSaveError('');
    try {
      const current = await readAutomaticSettings(project.id, task.id, AbortSignal.timeout(10000));
      if (!mounted.current) return;
      setSettings(current); setDraftRevision(current.revision); setSaveUncertain(false);
      setNotice(`已读取当前设置修订${current.revision}，编辑内容保留。请核对后再明确保存。`);
    } catch (error) { if (mounted.current) setSaveError(errorText(error)); }
    finally { if (mounted.current) setPosting(false); }
  };
  const save = async () => {
    if (!draft || posting || archived || saveUncertain) return;
    const problem = automaticSettingsIssue(draft);
    if (problem || (draft.enabled && !capabilities?.supported)) { setSaveError(problem?.message ?? '当前环境资格尚未满足，不能启用自动处理；可以保存关闭设置。'); requestAnimationFrame(() => formError.current?.focus()); return; }
    const input: AutomaticSettingsInput = { ...draft, ...(draft.question === undefined ? {} : { question: draft.question.trim() }), ...(draft.reportPath === undefined ? {} : { reportPath: draft.reportPath.trim() }) };
    setPosting(true); setSaveError('');
    try {
      const value = await saveAutomaticSettings(project.id, task.id, draftRevision, input, AbortSignal.timeout(30000));
      if (!mounted.current) return;
      setSettings(value); setDraft(undefined); setSaveUncertain(false); dialog.current?.close(); setDialogOpen(false);
      setNotice(value.enabled ? '已启用：从后续普通分析的新报告版本开始自动交接，不回放旧请求。' : '已关闭后续自动交接，历史及普通分析保留。');
      requestAnimationFrame(() => settingsButton.current?.focus());
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof AutomaticVerificationUncertain) setSaveUncertain(true);
      setSaveError(errorText(error)); requestAnimationFrame(() => formError.current?.focus());
    } finally { if (mounted.current) setPosting(false); }
  };
  const selectChain = async (id: string) => {
    const serial = ++requestSerial.current; selectedTarget.current = id; setSelectedId(id); setSelected(chains.find(value => value.chainId === id)); setError('');
    try { const value = await readAutomaticChain(project.id, task.id, id, AbortSignal.timeout(10000)); if (mounted.current && serial === requestSerial.current) apply(value); }
    catch (error) { if (mounted.current && serial === requestSerial.current) setError(errorText(error)); }
  };
  const query = async () => {
    setError(''); setNotice('正在只读查询原记录，不启动模型或重发操作。');
    if (selectedTarget.current) await selectChain(selectedTarget.current);
    if (mounted.current) setObserveVersion(value => value + 1);
  };
  const stop = async () => {
    if (!selected || posting || archived || (uncertainAction?.chainId === selected.chainId && uncertainAction.operation === 'stop' && !automaticCleanupRetryable(selected))) return;
    const id = selected.chainId; setPosting(true); setError('');
    try { const value = await stopAutomaticChain(project.id, task.id, id); if (mounted.current) { apply(value); setNotice(value.state === 'unknown' ? '资源清理已确认；原处理结果仍待确认，历史记录保持不变。' : '执行资源已确认停止，后续阶段不会继续派发。'); } }
    catch (error) { if (mounted.current) { if (error instanceof AutomaticVerificationUncertain) setUncertainAction({ chainId: id, operation: 'stop' }); setError(errorText(error)); } }
    finally { if (mounted.current) setPosting(false); }
  };
  const answer = async (target: AutomaticUIRequest, response: BrowserUIResponse) => {
    if (!selected || uncertainAction?.chainId === selected.chainId) return;
    const id = selected.chainId;
    try { const value = await respondAutomaticUI(project.id, task.id, id, target, response); if (mounted.current) apply(value); }
    catch (error) { if (mounted.current && error instanceof AutomaticVerificationUncertain) setUncertainAction({ chainId: id, operation: 'ui-response', requestKey: targetKey(target) }); throw error; }
  };
  const readInitial = async () => {
    const id = selected?.firstVerification?.verificationId, chainId = selected?.chainId;
    if (!id || !chainId) return;
    setInitialLoading(true); setInitialError('');
    try { const value = await readVerification(project.id, task.id, id, AbortSignal.timeout(10000)); if (mounted.current && selectedTarget.current === chainId) setInitial(value); }
    catch { if (mounted.current && selectedTarget.current === chainId) setInitialError('首次核算记录暂未读回，当前链和已保存结果不变。'); }
    finally { if (mounted.current && selectedTarget.current === chainId) setInitialLoading(false); }
  };
  const fileChoices = (role: 'data' | 'process') => {
    if (!draft) return null;
    const values = role === 'data' ? draft.dataFiles ?? [] : draft.processFiles ?? [], current = role === 'data' ? choices.data : choices.authors;
    const all = [...current, ...values.filter(path => !current.some(file => file.path === path)).map(path => ({ kind: 'file' as const, path, name: path.split('/').at(-1) ?? path }))];
    return <fieldset className="automatic-files" aria-describedby={`${uid}-error ${uid}-${role}-help`} aria-invalid={Boolean(saveError && issue?.field === role)}><legend>{role === 'data' ? '首次独立核算的源数据' : '首次依据保存后开放的作者过程件（可选）'}</legend><p id={`${uid}-${role}-help`} className="verification-hint">{role === 'data' ? '只选择020_clean中的源材料，作者脚本和结果放在另一组。' : '作者过程件和报告在首次依据保存后才开放，不据此替Agent选择方法。'}</p>{all.length ? all.map(file => <label key={file.path}><input type="checkbox" checked={values.includes(file.path)} disabled={posting || (role === 'data' ? (draft.processFiles ?? []).includes(file.path) : (draft.dataFiles ?? []).includes(file.path) || draft.reportPath === file.path)} onChange={event => edit({ [role === 'data' ? 'dataFiles' : 'processFiles']: event.target.checked ? [...values, file.path] : values.filter(value => value !== file.path) })} /><span>{file.path}{!current.some(item => item.path === file.path) && <small>已保存选择，当前目录未列出</small>}</span></label>) : <p className="verification-hint">暂无可选文件；未自动选择或推断相关资料。</p>}</fieldset>;
  };
  const selectedUncertain = Boolean(selected && uncertainAction?.chainId === selected.chainId);
  return <details className="automatic-verification" aria-busy={loading}>
    <summary className="automatic-fold-heading"><strong>自动核算与修订</strong><span className="automatic-badge" role="status">{loading ? '读取中' : selected?.uiRequests?.length ? '等待回应' : selectedUncertain ? '状态待确认' : active ? '正在处理' : error ? '读取异常' : capabilities && !capabilities.supported ? '暂不可用' : settings.enabled ? '已启用' : '未启用'}</span></summary>
    <div className="automatic-fold-content">
    <header className="automatic-heading"><div><h2 id={`${uid}-title`}>自动核算与修订</h2><p>{capabilities && !capabilities.supported ? '自动交接暂不可用；可以回看已有记录或编辑设置草稿。' : settings.enabled ? '指定报告形成新版本后，独立核算意见会自动交回原主Agent。' : '默认关闭。普通分析和原手动核算照常使用。'}</p><span className="automatic-badge">{capabilities && !capabilities.supported ? '暂不可用' : settings.enabled ? '已启用' : '未启用'}</span><span className="automatic-policy">后续请求最多返修{settings.maxAuthorTurns}次</span></div><button ref={settingsButton} type="button" className="secondary-button" disabled={loading || posting || archived} onClick={openSettings}>{capabilities && !capabilities.supported ? '查看设置' : settings.enabled ? '查看或调整设置' : '设置并启用'}</button></header>
    <p className="verification-hint">主Agent自主判断核算意见，可重算、修订或说明不采纳；新稿再核。系统只交材料、执行权限和保存记录，不保证整份报告正确。</p>
    {capabilities && !capabilities.supported && <p className="automatic-warning">{capabilities.reason ?? '当前环境不支持所需的原件保护，自动功能不能启用。'}普通分析和已有记录不受影响。</p>}
    {archived && <p className="verification-hint">项目已归档，只可回看已有记录。</p>}{active && <p className="verification-hint">本任务正在自动处理中；停止并安全收尾后可继续普通分析。</p>}
    {status?.observation && <div className="automatic-observation"><strong>最近一次报告观察</strong><p>{status.observation.reason !== 'none' ? automaticReasonLabel[status.observation.reason] ?? '观察结果尚待确认' : status.observation.chainId ? '指定报告新版本已关联自动处理记录' : status.busy && !status.observation.after ? '等待本次分析完成，再观察指定报告版本' : '已保存技术观察，自动交接以实际链记录为准'}。</p><p className="verification-hint">设置修订{status.observation.settingsSnapshot.revision} · {dateText(status.observation.observedAt ?? status.observation.admittedAt)}。文件版本变化不证明写入者，也不代表已读取或正确。</p></div>}
    {error && <p className="verification-error" role="alert">{error}</p>}{notice && <p className="verification-hint" role="status">{notice}</p>}
    <div className="automatic-record-heading"><h3>报告与意见记录</h3><button type="button" className="text-button" disabled={loading || posting} onClick={() => { void query(); }}>只读查询原记录</button></div>
    {chains.length > 0 ? <div className="verification-field"><label htmlFor={`${uid}-history`}>查看自动处理记录</label><select id={`${uid}-history`} value={selectedId ?? ''} onChange={event => { void selectChain(event.target.value); }}>{chains.map(chain => <option key={chain.chainId} value={chain.chainId}>{dateText(chain.createdAt)} · {automaticChainLabel(chain) ?? '状态待确认'} · {chain.settingsSnapshot.reportPath ?? '报告路径未记录'}</option>)}</select></div> : <p className="automatic-empty">{loading ? '正在读取…' : '还没有自动处理记录。启用后等待后续分析产生指定报告的新版本，不回放旧报告。'}</p>}
    {selected && <article className="automatic-detail" aria-label="自动处理详情"><div className="automatic-record-heading"><h3>{automaticChainLabel(selected) ?? '状态待确认'}</h3><span>{automaticPhaseLabel[selected.phase] ?? '阶段待确认'}</span></div>{selected.reason !== 'none' && <p className="automatic-reason">{automaticReasonLabel[selected.reason] ?? '结束原因尚未识别，保留原记录。'}</p>}<p>{selected.settingsSnapshot.question}</p><p className="verification-hint">本链主Agent：{selected.configuration.name ?? selected.configuration.model} · {selected.configuration.model}；核算：{selected.verificationConfiguration.name ?? selected.verificationConfiguration.model} · {selected.verificationConfiguration.model}</p><dl className="automatic-summary"><div><dt>主Agent已接受意见请求</dt><dd>{selected.authorAccepted} / {selected.settingsSnapshot.maxAuthorTurns}</dd></div><div><dt>已记录报告版本</dt><dd>{selected.versions.length}</dd></div><div><dt>当时设置修订</dt><dd>{selected.settingsSnapshot.revision}</dd></div></dl>
      <p className="verification-hint">次数是原主Agent实际接受意见请求的次数，不是专业评分。结束、一致或未提交新稿都不表示报告已正确。</p>
      {selected.cleanup?.state === 'unknown' && <p className="automatic-warning" role="status">执行资源清理尚未确认。历史结果继续保留，查询不会重发分析。</p>}
      {selected.state === 'unknown' && automaticCleanupConfirmed(selected) && <p className="verification-hint" role="status">资源清理已确认；原处理结果仍待确认，历史记录保持不变。</p>}
      {selectedUncertain && <p className="automatic-warning" role="status">原操作结果尚待核对，不会重发分析。请先查询；若资源清理待确认，可由你明确重试清理。</p>}
      {selected.uiRequests?.map(target => <AutomaticQuestion key={targetKey(target)} target={target} disabled={posting || archived || selectedUncertain || !automaticChainRunning(selected)} onAnswer={response => answer(target, response)} />)}
      <ChainMaterials chain={selected} initial={initial?.id === selected.firstVerification?.verificationId ? initial : undefined} reading={initialLoading} error={initialError} onRead={() => { void readInitial(); }} />
      <section className="automatic-versions"><h4>稿件版本与复查对应</h4>{selected.versions.length ? <ol>{selected.versions.map(version => <li key={version.version}><strong>{version.version === 1 ? '原稿' : `第${version.version - 1}次修订`} · 版本{version.version}</strong><p className="automatic-path">{version.relativePath}</p><details><summary>版本身份与来源</summary><dl className="automatic-identity"><div><dt>SHA-256</dt><dd><code>{version.sha256}</code></dd></div><div><dt>固定副本</dt><dd>{version.snapshotPath}</dd></div><div><dt>字节数</dt><dd>{version.bytes.toLocaleString()} B</dd></div><div><dt>作者请求</dt><dd>{version.requestId ?? '未记录'}</dd></div><div><dt>对应复查请求</dt><dd>{version.recheckRequestId ?? (version.version === 1 ? '原稿沿首次核算对照' : '尚无可确认的复查请求')}</dd></div></dl></details><FixedReport key={`${project.id}/${task.id}/${selected.chainId}/${version.version}/${version.sha256}`} projectId={project.id} taskId={task.id} chainId={selected.chainId} version={version} /></li>)}</ol> : <p className="verification-hint">尚未记录可回读的报告版本。</p>}</section>
      <section className="automatic-steps"><h4>交接与Agent原文</h4>{selected.steps.map(step => <details key={step.stepId}><summary>{automaticPhaseLabel[step.phase]} · {step.status === 'completed' ? '已有终态' : step.status === 'accepted' ? '请求已接受' : step.status === 'planned' ? '尚未证实接受' : step.status === 'unknown' ? '结果待确认' : step.status === 'cancelled' ? '已停止' : '运行失败'}</summary>{step.phase === 'recheck' && <p className="verification-hint">这是已见作者信息后的知情复查，不是新的冷读。</p>}{step.result?.text !== undefined ? <pre>{step.result.text}</pre> : <p className="verification-hint">{step.verificationRef ? '原文由首次核算记录保存，可在本链材料区只读回看。' : '尚未回读原文，不用当前材料补造。'}</p>}<dl className="automatic-identity"><div><dt>实际请求</dt><dd>{step.requestId}</dd></div><div><dt>接受时间</dt><dd>{dateText(step.acceptedAt)}</dd></div><div><dt>对应报告SHA</dt><dd>{step.inputSha256 ?? '未记录'}</dd></div>{step.result && <div><dt>结果SHA</dt><dd>{step.result.sha256}</dd></div>}</dl></details>)}</section>
      <div className="verification-actions"><button type="button" className="secondary-button" disabled={loading || posting} onClick={() => { void query(); }}>重新读取本链</button>{(automaticChainRunning(selected) || automaticCleanupRetryable(selected)) && !archived && <button type="button" className="secondary-button" disabled={posting || (selectedUncertain && uncertainAction?.operation === 'stop' && !automaticCleanupRetryable(selected))} onClick={() => { void stop(); }}>{automaticCleanupRetryable(selected) && !automaticChainRunning(selected) ? '重试资源清理' : '停止本次自动处理'}</button>}</div><p className="verification-hint">旧稿和意见保留。末次意见若未实际交回，不称主Agent已读；采用报告与经营动作仍需显式操作。</p>
    </article>}
    <dialog ref={dialog} className="automatic-dialog" aria-labelledby={`${uid}-dialog-title`} onCancel={event => { event.preventDefault(); closeSettings(); }} onClose={() => { setDialogOpen(false); requestAnimationFrame(() => settingsButton.current?.focus()); }}>
      <header><div><h2 ref={dialogHeading} tabIndex={-1} id={`${uid}-dialog-title`}>自动核算与修订设置</h2><p>只对本任务后续普通请求生效，保存设置不调用模型。</p></div><button type="button" className="text-button" aria-label="关闭设置并保留输入" disabled={posting} onClick={closeSettings}>关闭</button></header>
      {draft && <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={posting || archived} className="automatic-settings-fields"><legend className="sr-only">本任务自动核算设置</legend>
          <label className="verification-checkbox"><input type="checkbox" checked={draft.enabled} disabled={!capabilities?.supported && !draft.enabled} onChange={event => edit({ enabled: event.target.checked })} /><span>启用本任务的自动核算与修订</span></label>
          <p className="verification-hint">开启后，Python/bash可在本次操作内后台或并行运行；执行工具仅访问获准资料和输出目录，暂不支持工具联网、既有或远程MCP、用户执行扩展。分析方法仍由Agent自主决定。</p>
          {!capabilities?.supported && <p className="automatic-warning">{capabilities?.reason ?? '环境资格尚未读回，暂不能启用；可保存关闭状态。'}</p>}
          <div className="verification-field"><label htmlFor={`${uid}-question`}>需要核算的问题</label><textarea id={`${uid}-question`} rows={3} required={draft.enabled} maxLength={4000} value={draft.question ?? ''} aria-describedby={`${uid}-error`} aria-invalid={Boolean(saveError && issue?.field === 'question')} onChange={event => edit({ question: event.target.value })} /></div>
          <div className="verification-field"><label htmlFor={`${uid}-report`}>待核报告路径</label><input id={`${uid}-report`} required={draft.enabled} value={draft.reportPath ?? ''} placeholder="060_reports/你的报告.md" aria-describedby={`${uid}-report-help ${uid}-error`} aria-invalid={Boolean(saveError && issue?.field === 'report')} onChange={event => edit({ reportPath: event.target.value })} /><p id={`${uid}-report-help`} className="verification-hint">可以指定尚未生成的新报告；只观察这个路径，不从目录猜最终稿。</p></div>
          {filesLoading && <p className="verification-hint" role="status">正在读取项目文件…</p>}{filesError && <p className="verification-error" role="alert">{filesError}</p>}<div className="automatic-file-columns">{fileChoices('data')}{fileChoices('process')}</div>
          <details className="automatic-settings-context" open><summary>事前业务依据（可选）</summary>
            {requirementContext ? <label className="verification-checkbox"><input type="checkbox" checked={Boolean(draft.requirementContext)} onChange={event => edit({ requirementContext: event.target.checked ? { instanceId: requirementContext.instanceId, ...(requirementContext.version ? { version: requirementContext.version } : {}) } : undefined })} /><span>附带RAP：{draft.requirementContext && draft.requirementContext.instanceId !== requirementContext.instanceId ? `已保存 ${draft.requirementContext.instanceId}` : requirementContext.title} · {draft.requirementContext ? draft.requirementContext.version ?? '保存时未指定版本' : requirementContext.version ?? '当前已确认快照'}</span></label> : draft.requirementContext ? <label className="verification-checkbox"><input type="checkbox" checked onChange={() => edit({ requirementContext: undefined })} /><span>保留已选RAP：{draft.requirementContext.instanceId} · {draft.requirementContext.version ?? '已确认快照'}</span></label> : <p className="verification-hint">当前未选择RAP。</p>}
            {caseContext || draft.caseId ? <><label className="verification-checkbox"><input type="checkbox" checked={Boolean(draft.caseId)} onChange={event => edit(event.target.checked && caseContext ? { caseId: caseContext.id, caseRevision: caseContext.revision, caseBackgroundIsPrior: false } : { caseId: undefined, caseRevision: undefined, caseBackgroundIsPrior: undefined })} /><span>附带Case：{draft.caseId ? draft.caseId === caseContext?.id ? caseContext.title : draft.caseId : caseContext?.title} · 修订{draft.caseRevision ?? caseContext?.revision}</span></label>{draft.caseId && <div className="verification-case-background"><p>{draft.caseId === caseContext?.id && draft.caseRevision === caseContext.revision ? caseContext.description || '背景尚未填写' : '所存Case版本与当前页面不同，不能用当前背景代表旧选择。可取消后重新选择当前版本。'}</p><label className="verification-checkbox"><input type="checkbox" checked={draft.caseBackgroundIsPrior === true} aria-describedby={`${uid}-error`} aria-invalid={Boolean(saveError && issue?.field === 'case')} onChange={event => edit({ caseBackgroundIsPrior: event.target.checked })} /><span>确认属于事前背景，不含本次待核答案、当前判断、下一步或后验反馈。</span></label></div>}</> : <p className="verification-hint">当前未选择Case。</p>}
            <label className="verification-checkbox"><input type="checkbox" checked={draft.useCurrentSap === true} onChange={event => edit({ useCurrentSap: event.target.checked })} /><span>本次明确选择当前启用的SAP</span></label><p className="verification-hint">不代表原报告历史采用。企业资料可作为已获准的源材料或事前背景，不自动暗带。</p>
            <div className="verification-field"><label htmlFor={`${uid}-context`}>补充事前背景</label><textarea id={`${uid}-context`} rows={3} maxLength={12000} value={draft.businessContext ?? ''} aria-describedby={`${uid}-error`} aria-invalid={Boolean(saveError && issue?.field === 'context')} onChange={event => edit({ businessContext: event.target.value })} /></div>
          </details>
          <div className="verification-field"><label htmlFor={`${uid}-model`}>独立核算配置</label><select id={`${uid}-model`} value={draft.configurationId ?? ''} onChange={event => edit({ configurationId: event.target.value || undefined })}><option value="">沿用原任务：{task.configuration.name} · {task.configuration.model}</option>{draft.configurationId && !configurations.some(item => item.id === draft.configurationId) && <option value={draft.configurationId}>已保存配置 {draft.configurationId} · 当前列表未提供</option>}{configurations.map(model => <option key={model.id} value={model.id} disabled={!model.hasApiKey}>{model.name} · {model.model}{model.hasApiKey ? '' : ' · 未配置'}</option>)}</select><p className="verification-hint">原主Agent仍使用原任务绑定配置；运行时固定版本，不自动换模型。</p></div>
          <div className="verification-field"><label htmlFor={`${uid}-limit`}>最多自动返修</label><select id={`${uid}-limit`} value={draft.maxAuthorTurns ?? 2} aria-describedby={`${uid}-limit-help ${uid}-error`} onChange={event => edit({ maxAuthorTurns: Number(event.target.value) as 1 | 2 | 3 })}>{[1, 2, 3].map(value => <option key={value} value={value}>{value}次{value === 2 ? '（默认）' : ''}</option>)}</select><p id={`${uid}-limit-help`} className="verification-hint">主Agent接受一次意见请求计一次，未改稿也计入；每稿对应的核算/复查不计返修次数。达到上限保留末次意见，不无限循环。</p></div>
        </fieldset>
        <p className="verification-hint">本次编辑基于设置修订{draftRevision}。在途请求不会追溯采用新设置；修改或关闭将停止旧选择的后续交接，已有稿件和意见不变。</p>
        {saveError && <p ref={formError} id={`${uid}-error`} className="verification-error" role="alert" tabIndex={-1}>{saveError}</p>}{!saveError && <span id={`${uid}-error`} />}
        {(saveUncertain || saveError) && <button type="button" className="secondary-button" disabled={posting} onClick={() => { void rebaseSettings(); }}>读取当前设置，保留编辑内容</button>}
        <div className="automatic-dialog-actions"><button type="button" className="secondary-button" disabled={posting} onClick={closeSettings}>取消，保留输入</button><button type="submit" className="primary-button" disabled={posting || archived || saveUncertain || (draft.enabled && !capabilities?.supported)}>{posting ? '正在保存…' : '保存任务设置'}</button></div>
      </form>}
    </dialog>
    </div>
  </details>;
}
