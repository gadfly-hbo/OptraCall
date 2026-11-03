import { useEffect, useId, useRef, useState, type Ref } from 'react';
import type { BrowserUIRequest, BrowserUIResponse, ClientProject, ClientTask, FileNode, PublicModelConfiguration } from './project-types.ts';
import type { RequirementContextSelection } from './requirement-types.ts';
import { downloadFile, projectFiles } from './runtime-client.ts';
import { downloadVerificationAuthorFile, listVerifications, previewVerification, readSapProvision, readVerification, respondVerificationUI, startVerification, verificationAction, verificationFiles, verificationInputError, verificationPhaseLabel, verificationStatusLabel, VerificationRequestError, VerificationSubmissionUnknown, type VerificationFixedMaterial, type VerificationInput, type VerificationMaterialPreview, type VerificationPreview, type VerificationRecord, type VerificationSelection } from './verification-client.ts';
import './verification-panel.css';
import { AutomaticVerificationPanel, type AutomaticSettingsHandle } from './AutomaticVerificationPanel.tsx';

type Props = {
  automaticSettingsRef?: Ref<AutomaticSettingsHandle>;
  project: ClientProject; task: ClientTask; configurations: PublicModelConfiguration[]; taskBusy: boolean; filesRevision: number;
  requirementContext?: RequirementContextSelection; caseContext?: { id: string; title: string; description: string; revision: number };
  semanticContext?: unknown;
  onFilesChanged?: () => void;
};
const pendingKey = (projectId: string, taskId: string) => `optracall.verification-intent:${projectId}/${taskId}`;
function savedPending(key: string): string | undefined { try { return sessionStorage.getItem(key) ?? undefined; } catch { return undefined; } }
function savePending(key: string, id?: string) { try { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); } catch { /* Memory state still retains the intent when storage is unavailable. */ } }
const errorText = (error: unknown) => error instanceof VerificationRequestError || error instanceof VerificationSubmissionUnknown ? error.message : '核算服务暂不可用，请重新读取记录。';
const running = (record?: VerificationRecord) => Boolean(record && (['preparing', 'ready', 'running'].includes(record.status) || record.revision?.status === 'running'));
const dateText = (value: string) => Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString('zh-CN', { hour12: false });
function independenceText(record: VerificationRecord): string {
  const status = record.independence?.status;
  if (status === 'informed' || status === 'contaminated') return '知情复核：已接触作者信息';
  if (status === 'observed') return '捕获范围内未发现直接提前读取；不代表安全隔离';
  return '独立性尚未确认';
}

function MaterialIdentity({ file, fixedPath }: { file: VerificationMaterialPreview | VerificationFixedMaterial; fixedPath?: string }) {
  return <dl className="verification-identity"><div><dt>SHA-256</dt><dd><code>{file.sha256}</code></dd></div><div><dt>字节数</dt><dd>{file.bytes.toLocaleString()} B</dd></div>{file.sourcePath && <div><dt>原来源</dt><dd>{file.sourcePath}</dd></div>}{fixedPath && <div><dt>固定副本</dt><dd>{fixedPath}</dd></div>}</dl>;
}

function PreviewMaterials({ value }: { value: VerificationPreview }) {
  const materials = value.selectedMaterials;
  return <><h4>本次材料范围</h4><p className="verification-hint">源数据先提供；作者报告、脚本及结果表在首次回复保存后才提供。材料范围不规定Agent的分析方法。</p>{materials ? (['dataFiles', 'authorFiles'] as const).map(role => <section className="verification-material-group" key={role}><h5>{role === 'dataFiles' ? '首次核算可用的源材料' : '首次回复保存后才开放的作者产物'}</h5><ul className="verification-material-list">{materials[role].map(file => <li key={file.relativePath}><strong>{file.relativePath}</strong><p className="verification-hint">{file.textStatus === 'not-utf8' ? '可以固定完整字节；无UTF-8文字预览，能否使用其他工具读取由Agent判断。' : `可解码为UTF-8文字${file.totalLength === undefined ? '' : ` · ${file.totalLength.toLocaleString()} UTF-16`}`}</p><MaterialIdentity file={file} /></li>)}</ul></section>) : <p className="verification-hint">此预览没有材料身份记录，不能由当前目录反推；开始时仍会固定实际选材。</p>}<p className="verification-hint">预览尚未创建固定副本，也未调用模型。</p></>;
}

function VerificationMaterials({ record }: { record: VerificationRecord }) {
  const evidence = record.contextEvidence;
  return <details className="verification-materials"><summary>本次材料与读取记录</summary>
    <section><h4>1. 固定可用的材料</h4><p className="verification-hint">可用不等于主动附带全文，也不代表Agent已经读取或理解。首次回复保存记录与作者开放记录分别保留。</p><p className="verification-hint">首次回复：{record.coldResult ? '已有保存结果' : '尚未取得保存结果'}；作者开放时间：{record.authorRevealedAt ? dateText(record.authorRevealedAt) : '未记录，不能据此确认当时开放情况'}。</p>{record.dataFiles && record.authorFiles ? (['dataFiles', 'authorFiles'] as const).map(role => <section className="verification-material-group" key={role}><h5>{role === 'dataFiles' ? '固定源材料' : '固定作者产物'}</h5><ul className="verification-material-list">{record[role]!.map(file => <li key={file.relativePath}><strong>{file.relativePath}</strong><MaterialIdentity file={file} fixedPath={file.snapshotPath} /></li>)}</ul></section>) : <p className="verification-hint">该记录缺少固定材料身份，保持未知，不用当前文件补填。</p>}{record.semantics ? <details><summary>当时固定的业务语义</summary><pre>{record.semantics.text}</pre>{record.semantics.sha256 && <p className="verification-hint">语义SHA-256：{record.semantics.sha256}</p>}</details> : <p className="verification-hint">当时具体业务语义未记录。</p>}</section>
    <section><h4>2. 当时主动附带的文字</h4><p className="verification-hint">下列内容来自本次实际请求证据；完整固定副本可用，不表示请求主动附带全文。</p>{evidence ? <><p className="verification-hint">{evidence.provided.note}</p>{evidence.provided.status === 'recorded' ? <>{evidence.provided.requestId && <p className="verification-hint">请求编号：{evidence.provided.requestId}</p>}{evidence.provided.fragments.map(file => <details key={file.relativePath}><summary>{file.relativePath}</summary><p className="verification-hint">{file.textStatus === 'not-utf8' ? '没有文字摘要；固定字节仍可用。' : file.start === null || file.end === null || file.totalLength === null ? '文字范围未记录。' : file.end === file.start ? `本请求未主动附正文；原文字共${file.totalLength.toLocaleString()} UTF-16。` : `主动范围 [${file.start}, ${file.end}) / ${file.totalLength.toLocaleString()} UTF-16${file.end < file.totalLength ? '，不是全文。' : '。'}`}</p><p className="verification-hint">固定全文：{file.fixedPath}</p><p className="verification-hint">SHA-256：{file.sha256} · {file.bytes.toLocaleString()} B</p>{file.text !== null && file.text !== '' && <pre>{file.text}</pre>}</details>)}{evidence.provided.requestText && <details><summary>实际对照请求原文</summary><pre>{evidence.provided.requestText}</pre></details>}</> : <p className="verification-hint">未取得可确认的逐文件范围；不按当前摘要上限重算旧请求。</p>}</> : <p className="verification-hint">此记录没有主动附带范围的可确认信息，不从当前文件或当前程序推断。</p>}</section>
    <section><h4>3. 可观察的读取线索</h4><p className="verification-hint">只展示捕获范围内的工具事件。一次read不证明读全；未捕获线索也不能证明没读，不能据此判断理解或采用。</p>{evidence ? <><p className="verification-hint">{evidence.reads.note}</p>{evidence.reads.items.length ? <ul className="verification-material-list">{evidence.reads.items.map((item, index) => <li key={`${item.requestId}-${item.toolCallId ?? index}`}><strong>{item.relativePath}</strong><p>{item.toolName} · {item.outcome === 'completed' ? '已捕获完成事件' : item.outcome === 'failed' ? '已捕获失败事件' : '仅捕获开始事件'}</p><p className="verification-hint">请求：{item.requestId}{item.offset === undefined ? '' : ` · offset ${item.offset}`}{item.limit === undefined ? '' : ` · limit ${item.limit}`}</p><p className="verification-hint">{item.note}</p></li>)}</ul> : <p className="verification-hint">没有可展示的读取线索，范围保持未知。</p>}</> : <p className="verification-hint">该记录没有可回读的读取线索。</p>}</section>
    <section><h4>4. Agent的核查说明</h4><p className="verification-hint">以下保留Agent原文，范围与依据由Agent自行说明；Host不将其改写为专业事实或正确性结论。</p>{([['首次依据', record.coldResult], ['对照意见', record.comparisonResult], ['知情复查', record.recheckResult]] as const).map(([label, result]) => result ? <details key={label}><summary>{label} · Agent原文</summary><pre>{result.text}</pre></details> : null)}{!record.coldResult && !record.comparisonResult && !record.recheckResult && <p className="verification-hint">尚未取得Agent说明。</p>}</section>
  </details>;
}

function VerificationQuestion({ request, disabled, onAnswer }: { request: BrowserUIRequest; disabled: boolean; onAnswer: (answer: BrowserUIResponse) => Promise<void> }) {
  const uid = useId(), [value, setValue] = useState(request.prefill ?? ''), [selection, setSelection] = useState(''), [working, setWorking] = useState(false), [error, setError] = useState('');
  const answer = async (response: Omit<BrowserUIResponse, 'id'>) => {
    if (working || disabled) return;
    setWorking(true); setError('');
    try { await onAnswer({ id: request.id, ...response }); }
    catch (error) { setError(errorText(error)); }
    finally { setWorking(false); }
  };
  return <section className="verification-question" aria-labelledby={`${uid}-title`} aria-busy={working}>
    <h4 id={`${uid}-title`}>核算 Agent 等待回应：{request.title}</h4>{request.message && <p>{request.message}</p>}
    <form onSubmit={event => { event.preventDefault(); void answer({ value: request.method === 'select' ? selection : value }); }}>
      {request.method === 'select' && <fieldset disabled={working || disabled}><legend className="sr-only">{request.title}</legend>{(request.options ?? []).map((option, index) => <label className="verification-checkbox" key={`${index}:${option}`}><input type="radio" name={uid} checked={selection === option} required onChange={() => setSelection(option)} /><span>{option}</span></label>)}</fieldset>}
      {(request.method === 'input' || request.method === 'editor') && <div className="verification-field"><label htmlFor={`${uid}-answer`}>回应内容</label>{request.method === 'editor' ? <textarea id={`${uid}-answer`} rows={5} value={value} disabled={working || disabled} onChange={event => setValue(event.target.value)} /> : <input id={`${uid}-answer`} value={value} placeholder={request.placeholder} disabled={working || disabled} onChange={event => setValue(event.target.value)} />}</div>}
      {error && <p className="verification-error" role="alert">{error}</p>}
      <div className="verification-actions">{request.method === 'confirm' ? <><button type="button" className="secondary-button" disabled={working || disabled} onClick={() => { void answer({ value: false }); }}>不继续</button><button type="button" className="primary-button" disabled={working || disabled} onClick={() => { void answer({ value: true }); }}>确认继续</button></> : <><button type="button" className="secondary-button" disabled={working || disabled} onClick={() => { void answer({ cancelled: true }); }}>取消此回应</button><button type="submit" className="primary-button" disabled={working || disabled || (request.method === 'select' && !selection)}>提交回应</button></>}</div>
    </form><p className="verification-hint">回应仅交给本次核算会话，不会重新发送分析或核算请求。</p>
  </section>;
}

export function VerificationPanel({ automaticSettingsRef, project, task, configurations, taskBusy, filesRevision, requirementContext, caseContext, semanticContext, onFilesChanged }: Props) {
  const uid = useId(), mounted = useRef(true), detailRequest = useRef(0), previewRequest = useRef(0), detailTarget = useRef<string | undefined>(undefined), heading = useRef<HTMLHeadingElement>(null), previewButton = useRef<HTMLButtonElement>(null), draftActive = useRef(false);
  const [open, setOpen] = useState(false), [formOpen, setFormOpen] = useState(false), [files, setFiles] = useState<FileNode[]>([]), [records, setRecords] = useState<VerificationRecord[]>([]);
  const [selected, setSelected] = useState<VerificationRecord>(), [loading, setLoading] = useState(false), [posting, setPosting] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [observation, setObservation] = useState(0);
  const [question, setQuestion] = useState(''), [dataFiles, setDataFiles] = useState<string[]>([]), [authorFiles, setAuthorFiles] = useState<string[]>([]), [businessContext, setBusinessContext] = useState('');
  const [relatedFiles, setRelatedFiles] = useState('');
  const [configurationId, setConfigurationId] = useState(''), [useRequirement, setUseRequirement] = useState(Boolean(requirementContext)), [useCase, setUseCase] = useState(Boolean(caseContext)), [priorConfirmed, setPriorConfirmed] = useState(false), [useCurrentSap, setUseCurrentSap] = useState(false), [retryOf, setRetryOf] = useState<string>();
  const storageKey = pendingKey(project.id, task.id), [pendingId, setPendingId] = useState<string | undefined>(() => savedPending(storageKey));
  const [attempt, setAttempt] = useState<VerificationInput>();
  const [preview, setPreview] = useState<{ basis: string; value: VerificationPreview }>(), [previewing, setPreviewing] = useState(false), [previewError, setPreviewError] = useState('');
  const [previewChanged, setPreviewChanged] = useState(false), [previewOpen, setPreviewOpen] = useState(false);
  const choices = verificationFiles(files), locked = posting || Boolean(pendingId), archived = Boolean(project.archivedAt);
  const sapProvision = readSapProvision(semanticContext);
  const formSelection: VerificationSelection = { question: question.trim(), dataFiles, authorFiles,
    ...(businessContext.trim() ? { businessContext: businessContext.trim() } : {}), ...(configurationId ? { configurationId } : {}), ...(retryOf ? { retryOf } : {}),
    ...(useRequirement && requirementContext ? { requirementContext: { instanceId: requirementContext.instanceId, ...(requirementContext.version ? { version: requirementContext.version } : {}) } } : {}),
    ...(useCase && caseContext ? { caseId: caseContext.id, caseRevision: caseContext.revision, caseBackgroundIsPrior: priorConfirmed } : {}), ...(useCurrentSap ? { useCurrentSap: true } : {}) };
  const formBasis = JSON.stringify(formSelection), latestBasis = useRef(formBasis); latestBasis.current = formBasis;
  const previewNeedsRefresh = Boolean(preview && (previewChanged || preview.basis !== formBasis));
  const invalidSelection = verificationInputError(formSelection);
  const setPending = (id?: string) => { savePending(storageKey, id); if (mounted.current) setPendingId(id); };
  const apply = (value: VerificationRecord) => {
    if (!mounted.current) return;
    detailTarget.current = value.id;
    setSelected(value); setRecords(old => [value, ...old.filter(item => item.id !== value.id)]);
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; detailRequest.current++; previewRequest.current++; }; }, []);
  useEffect(() => {
    if (!open) return;
    let alive = true; const controller = new AbortController(); setLoading(true); setError('');
    void Promise.all([projectFiles(project.id), listVerifications(project.id, task.id, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))]).then(([tree, list]) => {
      if (!alive) return;
      setFiles(tree); setRecords(list);
      setSelected(old => { const value = old ? list.find(item => item.id === old.id) ?? old : list[0]; detailTarget.current = value?.id; return value; });
    }, error => { if (alive) setError(errorText(error)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [open, project.id, task.id, filesRevision]);
  useEffect(() => {
    if (!selected || !running(selected)) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined, failures = 0;
    const id = selected.id;
    const observe = async () => {
      try {
        const value = await readVerification(project.id, task.id, id, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
        if (controller.signal.aborted || detailTarget.current !== id) return;
        failures = 0; apply(value);
        if (!running(value)) { onFilesChanged?.(); return; }
      } catch {
        if (controller.signal.aborted) return;
        failures++;
        if (failures >= 3) { setError('核算观察暂未恢复。可以只读重新连接；不会重新发送核算。'); return; }
      }
      if (!controller.signal.aborted) timer = setTimeout(observe, 2000);
    };
    timer = setTimeout(observe, 1500);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [open, project.id, task.id, selected?.id, selected?.status, selected?.revision?.status, observation]);
  const refresh = async (id = pendingId ?? selected?.id) => {
    setError(''); setLoading(true); const serial = ++detailRequest.current;
    if (id) detailTarget.current = id;
    try {
      if (id) {
        const value = await readVerification(project.id, task.id, id, AbortSignal.timeout(10000));
        if (!mounted.current || serial !== detailRequest.current) return;
        apply(value); if (id === pendingId) { setPending(undefined); setAttempt(undefined); setFormOpen(false); draftActive.current = false; }
        setNotice('已只读核对原记录，没有重新发送核算。'); setObservation(value => value + 1);
      } else {
        const list = await listVerifications(project.id, task.id, AbortSignal.timeout(10000));
        if (mounted.current && serial === detailRequest.current) setRecords(list);
      }
    } catch (error) { if (mounted.current && serial === detailRequest.current) setError(pendingId ? '原核算暂未读回，操作编号继续保留。请稍后查询，不会自动重发。' : errorText(error)); }
    finally { if (mounted.current && serial === detailRequest.current) setLoading(false); }
  };
  const begin = async () => {
    if (previewNeedsRefresh) { setError('材料或选择与已看预览不同，请重新查看本次语义与材料；问题和选材继续保留。'); return; }
    const input: VerificationInput = attempt ?? { verificationId: crypto.randomUUID(), ...formSelection };
    const invalid = verificationInputError(input);
    if (invalid) { setError(invalid); return; }
    setPosting(true); setError(''); setNotice(''); setAttempt(input); setPending(input.verificationId);
    try {
      const value = await startVerification(project.id, task.id, input, AbortSignal.timeout(30000), preview?.basis === formBasis ? preview.value.etag : undefined);
      if (!mounted.current) return;
      apply(value); setPending(undefined); setAttempt(undefined); setFormOpen(false); draftActive.current = false;
      setNotice('核算已登记。先提供源材料，首次回复保存后再提供作者产物；怎么查、怎么算由Agent自主决定。原任务和文件保留。');
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof VerificationRequestError && error.status < 500) { setPending(undefined); setAttempt(undefined); }
      if (error instanceof VerificationRequestError && error.code === 'verification_preview_changed') { setPreviewChanged(true); setPreviewOpen(true); }
      setError(errorText(error));
    } finally { if (mounted.current) setPosting(false); }
  };
  const showPreview = async () => {
    const invalid = verificationInputError(formSelection);
    if (invalid) { setPreviewError(invalid); return; }
    const serial = ++previewRequest.current, basis = formBasis;
    setPreviewing(true); setPreviewError('');
    try {
      const value = await previewVerification(project.id, task.id, { verificationId: crypto.randomUUID(), ...formSelection }, AbortSignal.timeout(15000));
      if (mounted.current && serial === previewRequest.current && latestBasis.current === basis) { setPreview({ basis, value }); setPreviewChanged(false); setPreviewOpen(true); }
    } catch (error) { if (mounted.current && serial === previewRequest.current) setPreviewError(errorText(error)); }
    finally { if (mounted.current && serial === previewRequest.current) setPreviewing(false); }
  };
  const action = async (kind: 'stop' | 'author-revision' | 'recheck' | 'export') => {
    if (!selected) return;
    if (kind === 'author-revision' && (selected.revision || selected.revisionCount)) { setNotice('本记录已发起过一次出稿；保留原稿件及对应复查，不再次覆盖。'); return; }
    if (kind === 'recheck' && (selected.recheckResult || selected.recheckCount || selected.phase === 'recheck')) { setNotice('本记录已发起过一次知情复查，保留原结果，不自动再跑。'); return; }
    const id = selected.id; setPosting(true); setError(''); setNotice('');
    try {
      const value = await verificationAction(project.id, task.id, id, kind);
      if (!mounted.current) return;
      apply(value); setNotice(kind === 'export' ? '核算报告已另存到 060_reports，原文件保留。' : kind === 'author-revision' ? '已启动只读出稿，固定材料全文送入独立附属会话；新稿由系统另存，不改原任务历史。' : kind === 'recheck' ? '已发起一次修订后复查；这不是新的冷读核算。' : '停止请求已记录，以读回状态为准。');
      onFilesChanged?.();
    } catch (error) { if (mounted.current) setError(errorText(error)); }
    finally { if (mounted.current) setPosting(false); }
  };
  const answer = async (response: BrowserUIResponse) => {
    if (!selected) return;
    const value = await respondVerificationUI(project.id, task.id, selected.id, response);
    if (mounted.current && detailTarget.current === value.id) { apply(value); setObservation(old => old + 1); }
  };
  const openForm = (previous?: VerificationRecord) => {
    if (pendingId) return;
    if (!previous && draftActive.current) { setError(''); setNotice('已恢复本页尚未提交的核算输入。'); setFormOpen(true); requestAnimationFrame(() => heading.current?.focus()); return; }
    draftActive.current = true;
    setError(''); setNotice(''); setAttempt(undefined); setFormOpen(true); setRetryOf(previous?.id);
    previewRequest.current++; setPreview(undefined); setPreviewing(false); setPreviewError(''); setPreviewChanged(false); setPreviewOpen(false); setRelatedFiles('');
    setQuestion(previous?.selection.question ?? ''); setDataFiles(previous?.selection.dataFiles ?? []); setAuthorFiles(previous?.selection.authorFiles ?? []); setBusinessContext(previous?.selection.businessContext ?? '');
    setConfigurationId(previous?.selection.configurationId ?? ''); setUseCurrentSap(previous?.selection.useCurrentSap ?? false);
    setUseRequirement(Boolean(requirementContext)); setUseCase(Boolean(caseContext)); setPriorConfirmed(false);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const toggleFile = (path: string, role: 'data' | 'author', checked: boolean) => {
    const update = (old: string[]) => checked ? [...old, path] : old.filter(item => item !== path);
    if (role === 'data') setDataFiles(update); else setAuthorFiles(update);
  };
  const fileChoices = (role: 'data' | 'author') => {
    const list = role === 'data' ? choices.data : choices.authors, values = role === 'data' ? dataFiles : authorFiles, other = role === 'data' ? authorFiles : dataFiles;
    return <fieldset className="verification-files"><legend>{role === 'data' ? '源数据 · 020_clean' : '待核算作者产物 · 020_clean / 060_reports'}</legend>{list.length ? list.map(file => <label key={file.path}><input type="checkbox" checked={values.includes(file.path)} disabled={locked || other.includes(file.path)} onChange={event => toggleFile(file.path, role, event.target.checked)} /><span>{file.path}</span>{file.bytes !== undefined && <small>{file.bytes.toLocaleString()} B</small>}</label>) : <p>暂无可选文件，请先放入项目分析区或报告区。</p>}</fieldset>;
  };
  const diagnostic = typeof selected?.diagnostic === 'string' ? selected.diagnostic : selected?.diagnostic?.message;
  const revisionAssociation = selected?.contextEvidence?.revisionAssociation;
  const revisionWasStarted = Boolean(selected?.revision || selected?.revisionCount);
  const recheckWasStarted = Boolean(selected?.recheckResult || selected?.recheckCount || selected?.phase === 'recheck');
  return <section className="verification" aria-label="独立核算">
    <AutomaticVerificationPanel ref={automaticSettingsRef} key={`${project.id}/${task.id}`} project={project} task={task} configurations={configurations} taskBusy={taskBusy} filesRevision={filesRevision} requirementContext={requirementContext} caseContext={caseContext} onFilesChanged={onFilesChanged} />
    <button type="button" className="text-button verification-trigger" aria-expanded={open} aria-controls={`${uid}-panel`} onClick={() => setOpen(value => !value)}>核算关键结论{Boolean(selected?.uiRequests?.length) && <span className="verification-waiting">等待回应</span>}<span aria-hidden="true">{open ? '⌃' : '⌄'}</span></button>
    {open && <div id={`${uid}-panel`} className="verification-panel">
      <header className="verification-heading"><div><h2 ref={heading} tabIndex={-1}>独立核算</h2><p>另一会话自主形成依据，差异与未知分别保留。</p></div><button type="button" className="secondary-button" disabled={archived || taskBusy || locked} onClick={() => openForm()}>发起核算</button></header>
      <p className="verification-scope">材料分两次交付：首次回复保存后才开放作者产物。每次怎么查、怎么算、怎样修正由Agent自主安排；Host只管材料、权限和记录。独立会话不是安全沙箱，完成也不表示整份报告正确。</p>
      <details className="verification-context"><summary>当前会话的 SAP 提供记录</summary><p className="verification-hint">仅展示当前资源或历史回执实际提供的索引，不等于业务采用。</p>{sapProvision ? <><p className="verification-hint">{sapProvision.basis === 'runtime-initialization' ? '来源：当前运行资源初始化' : sapProvision.basis === 'historical-receipt' || sapProvision.basis === 'native-receipt' ? '来源：历史提供回执' : `来源标记：${sapProvision.basis ?? '未记录'}`}</p><pre>{sapProvision.indexText}</pre><p className="verification-hint">指纹：{sapProvision.sha256 ?? '未记录'}</p></> : <p className="verification-hint">当前资源／历史回执没有可确认的 SAP 索引记录；不会用当前项目启用版本补填。需要新 SAP 时请显式新建任务，原会话保留。</p>}</details>
      {archived && <p className="verification-hint">项目已归档，仅可查看已有核算。</p>}{taskBusy && <p className="verification-hint">原任务仍在运行，请等待空闲后发起核算。</p>}
      {pendingId && <div className="verification-pending" role="status"><strong>原提交尚待核对</strong><p>操作编号：<code>{pendingId}</code></p><button type="button" className="secondary-button" disabled={posting || loading} onClick={() => { void refresh(pendingId); }}>查询原核算</button></div>}
      {error && <p className="verification-error" role="alert">{error}</p>}{notice && <p className="verification-hint" role="status">{notice}</p>}
      {formOpen && <form className="verification-form" onSubmit={event => { event.preventDefault(); if (!locked && !archived && !taskBusy) void begin(); }}>
        <div className="verification-field"><label htmlFor={`${uid}-question`}>这次核算什么</label><textarea id={`${uid}-question`} rows={3} required maxLength={4000} value={question} disabled={locked} aria-describedby={`${uid}-question-help ${uid}-start-reason`} placeholder="例如：核对复购率下降幅度，以及报告中的人群结论是否有数据支持。" onChange={event => setQuestion(event.target.value)} /><p id={`${uid}-question-help`} className="verification-hint">方法、工具和呈现由Agent自主选择；条件不足时可以说明未知，不要求得出指定结论。</p></div>
        <div className="verification-file-columns">{fileChoices('data')}{fileChoices('author')}</div>
        <details className="verification-context"><summary>待核对文件清单（可选，用户人工整理）</summary><p className="verification-hint">可手工记下报告提到的文件，再对照选材。本清单仅留在本页，不发送给核算Agent，也不自动判断相关性或勾选。</p><div className="verification-field"><label htmlFor={`${uid}-related-files`}>资料路径，每行一项</label><textarea id={`${uid}-related-files`} rows={3} value={relatedFiles} disabled={locked} onChange={event => setRelatedFiles(event.target.value)} /></div>{relatedFiles.trim() ? <ul className="verification-related-files">{relatedFiles.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map((value, index) => <li key={`${index}:${value}`}><span>{value}</span><small>{authorFiles.includes(value) ? '已选为作者产物' : choices.authors.some(file => file.path === value) ? '尚未选入' : '当前目录未找到'}</small></li>)}</ul> : <p className="verification-hint">未填写不影响发起，也不表示报告没有引用其他资料。</p>}</details>
        <details className="verification-context" open><summary>本次业务依据</summary>
          {requirementContext ? <label className="verification-checkbox"><input type="checkbox" checked={useRequirement} disabled={locked} onChange={event => setUseRequirement(event.target.checked)} /><span>附带 RAP：{requirementContext.title} · {requirementContext.version ? `版本 ${requirementContext.version}` : '当前已确认快照'}</span></label> : <p>未选择 RAP；不会自动继承作者完整对话。</p>}
          {caseContext ? <><label className="verification-checkbox"><input type="checkbox" checked={useCase} disabled={locked} onChange={event => setUseCase(event.target.checked)} /><span>附带 Case：{caseContext.title} · 修订 {caseContext.revision}</span></label>{useCase && <div className="verification-case-background"><p>{caseContext.description || '事前背景尚未填写'}</p><label className="verification-checkbox"><input type="checkbox" checked={priorConfirmed} disabled={locked} onChange={event => setPriorConfirmed(event.target.checked)} /><span>确认以上属于事前背景，不包含本次待核算答案。仅附带此背景，不附带当前判断、下一步或历史。</span></label></div>}</> : <p>未选择 Case；普通项目也可以独立核算。</p>}
          <label className="verification-checkbox"><input type="checkbox" checked={useCurrentSap} disabled={locked} onChange={event => setUseCurrentSap(event.target.checked)} /><span>使用当前项目启用的 SAP 作为本次核算依据</span></label><p className="verification-hint">这不代表原报告当时已采用这些版本。无法还原的历史输入会保留为未知。</p>
          <div className="verification-field"><label htmlFor={`${uid}-context`}>补充业务背景（可选，记为用户提供）</label><textarea id={`${uid}-context`} rows={3} maxLength={12000} value={businessContext} disabled={locked} onChange={event => setBusinessContext(event.target.value)} placeholder="只填解题所需的事实和口径，不粘贴待核算结论。" /></div>
        </details>
        <div className="verification-field"><label htmlFor={`${uid}-model`}>核算模型</label><select id={`${uid}-model`} value={configurationId} disabled={locked} onChange={event => setConfigurationId(event.target.value)}><option value="">沿用原任务：{task.configuration.name} · {task.configuration.model}</option>{configurations.map(model => <option key={model.id} value={model.id} disabled={!model.hasApiKey}>{model.name} · {model.model}{model.hasApiKey ? '' : ' · 未配置'}</option>)}</select><p className="verification-hint">本次运行固定所选配置，不自动换模型。不同模型也不能保证核算正确。</p></div>
        <div className="verification-preview"><button ref={previewButton} type="button" className="secondary-button" disabled={locked || previewing || !question.trim() || !dataFiles.length || !authorFiles.length} onClick={() => { void showPreview(); }}>{previewing ? '正在读取材料与语义…' : '查看本次语义与材料'}</button><p className="verification-hint">只预览，不登记或调用模型。材料身份、路径与字节由Host核对，不判断分析是否充分。已看预览后的材料或选择变化，需要明确重看；不会静默改用同名新文件。</p>{previewError && <p className="verification-error" role="alert">{previewError}</p>}{previewNeedsRefresh && <p className="verification-error" role="status">材料或选择与已看预览不同，请重新查看；问题、选材和人工清单保留。</p>}{preview && previewOpen && <section className="verification-preview-content" aria-label="本次预览" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setPreviewOpen(false); requestAnimationFrame(() => previewButton.current?.focus()); } }}><h3>{previewNeedsRefresh ? '先前预览，仅供回看' : '本次材料与业务语义预览'}</h3><p className="verification-hint">{preview.value.configuration.name ?? preview.value.configuration.model} · {preview.value.configuration.model} · 配置修订 {preview.value.configuration.revision}</p><PreviewMaterials value={preview.value} /><h4>事前业务语义与未决内容</h4><ul>{preview.value.semantics.sources.map((source, index) => <li key={`${source.kind}-${index}`}>{source.kind.toUpperCase()}{source.id ? ` ${source.id}` : ''}{source.version ? ` · ${source.version}` : ''} · {source.confirmed === true ? '已确认来源' : source.confirmed === false ? '未自动确认' : '确认状态未记录'}{source.note ? ` · ${source.note}` : ''}</li>)}</ul><pre>{preview.value.semantics.text}</pre>{preview.value.semantics.sha256 && <p className="verification-hint">预览指纹：{preview.value.semantics.sha256}</p>}<p className="verification-hint">{preview.value.note}</p><button type="button" className="secondary-button" onClick={() => { setPreviewOpen(false); requestAnimationFrame(() => previewButton.current?.focus()); }}>收起预览，保留选材</button></section>}</div>
        {retryOf && <p className="verification-hint">新尝试关联旧核算：{retryOf}。旧结果和失败现场保留。</p>}
        <p id={`${uid}-start-reason`} className="verification-hint" role="status">{previewNeedsRefresh ? '请先重新查看变化后的材料。' : invalidSelection ?? '可以明确开始；普通分析不会因未核算而受限。'}</p><div className="verification-actions"><button type="button" className="secondary-button" disabled={locked} onClick={() => { setFormOpen(false); requestAnimationFrame(() => heading.current?.focus()); }}>收起表单，保留输入</button><button type="submit" className="primary-button" disabled={locked || archived || taskBusy || previewNeedsRefresh || Boolean(invalidSelection)} aria-describedby={`${uid}-start-reason`}>{posting ? '正在登记…' : retryOf ? '明确发起新尝试' : '开始核算'}</button></div>
      </form>}
      <div className="verification-list-heading"><h3>已有核算</h3><button type="button" className="text-button" disabled={loading || posting} onClick={() => { void refresh(); }}>只读刷新</button></div>
      {loading && <p className="verification-hint" role="status">正在读取核算记录…</p>}
      {!loading && !records.length && <p className="verification-empty">还没有核算记录。发起后会保存固定输入、独立依据和对照结果。</p>}
      {records.length > 0 && <ul className="verification-list">{records.map(record => <li key={record.id}><button type="button" className={selected?.id === record.id ? 'selected' : ''} aria-current={selected?.id === record.id ? 'true' : undefined} disabled={posting} onClick={() => { setFormOpen(false); setSelected(record); void refresh(record.id); }}><span>{record.question}</span><small>{verificationStatusLabel[record.status] ?? '状态未知'} · {dateText(record.createdAt)}</small></button></li>)}</ul>}
      {selected && <article className="verification-detail" aria-label="核算详情"><div className="verification-detail-heading"><h3>{verificationStatusLabel[selected.status] ?? '状态未知'}</h3><span>{selected.phase ? verificationPhaseLabel[selected.phase] ?? selected.phase : '阶段待确认'}</span></div><p>{selected.question}</p><p className="verification-hint">{selected.model ? `${selected.model.name ?? selected.model.model} · ${selected.model.model} · 配置修订 ${selected.model.revision}` : '模型配置尚待记录'}</p><p className="verification-hint">{independenceText(selected)}</p>
        {selected.uiRequests?.map(request => <VerificationQuestion key={request.id} request={request} disabled={posting || archived} onAnswer={answer} />)}
        {selected.independence?.details && <p className="verification-hint">{Array.isArray(selected.independence.details) ? selected.independence.details.join('；') : selected.independence.details}</p>}
        {diagnostic && <p className="verification-error">{diagnostic}</p>}
        <details><summary>本次选择与版本依据</summary><p>源数据：{selected.selection.dataFiles.join('、')}</p><p>作者产物：{selected.selection.authorFiles.join('、')}</p><p>{selected.selection.requirementContext ? `RAP ${selected.selection.requirementContext.instanceId} · ${selected.selection.requirementContext.version ?? '选定时的已确认快照'}` : '未选 RAP'}</p><p>{selected.selection.caseId ? `Case ${selected.selection.caseId} · 修订 ${selected.selection.caseRevision ?? '待核对'}` : '未选 Case'}</p><p>{selected.selection.useCurrentSap ? '本次按明确选择使用当前启用 SAP；不回填历史采用状态。' : '未明确选择当前启用 SAP。'}</p>{selected.selection.businessContext && <p>用户补充：{selected.selection.businessContext}</p>}<p className="verification-hint">核算编号：{selected.id} · 保存于 {dateText(selected.updatedAt)}</p></details>
        <VerificationMaterials record={selected} />
        {selected.authorReports?.map((report, index) => <details key={`${report.path}-${index}`}><summary>作者固定版本：{report.path}</summary>{report.sha256 && <p className="verification-hint">SHA-256：{report.sha256}</p>}<p className="verification-hint">{report.textStatus === 'not-utf8' ? '固定字节存在，但不能解码为UTF-8文字；没有文字预览。' : report.start === undefined || report.end === undefined || report.totalLength === undefined || report.start === null || report.end === null || report.totalLength === null ? '此记录没有文字显示范围，不能据此确认是全文。' : `界面文字范围 [${report.start}, ${report.end}) / ${report.totalLength.toLocaleString()} UTF-16${report.truncated ? '，已截取，不是全文。' : '。'}`}</p>{report.fixedPath && <p className="verification-hint">完整固定副本：{report.fixedPath}</p>}{report.text !== '' && <pre>{report.text}</pre>}{report.fixedPath && <button type="button" className="text-button" onClick={() => { void downloadVerificationAuthorFile(project.id, task.id, selected.id, report.path).catch(error => setError(errorText(error))); }}>下载此固定副本全文：{report.path.split('/').at(-1)}</button>}</details>)}
        {selected.coldResult && <details open><summary>首次依据 · Agent原文</summary><pre>{selected.coldResult.text}</pre></details>}{selected.comparisonResult && <details open><summary>对照结果与分歧 · Agent原文</summary><pre>{selected.comparisonResult.text}</pre></details>}{!revisionWasStarted && selected.status === 'completed' && <p className="verification-hint">同一核算记录只另存一次新稿，之后一次知情复查明确对应这份稿件。修订仅依据固定文字，不提供执行工具；不会改写原稿或原任务会话。全文上限20,000 UTF-16，不能放下或需要重新计算时保留未知。普通分析工具能力不变。</p>}
        {revisionWasStarted && <section className="verification-revision-basis" aria-label="本记录新稿与复查对应"><h4>本记录唯一新稿</h4><p className="verification-hint">本记录已发起过一次出稿；保留稿件和来源，不再次覆盖，也不自动复查。</p>{selected.revision?.files?.map(file => <p key={file}>{file}</p>)}{revisionAssociation?.status === 'recorded' ? <><p className="verification-hint">出稿请求：{revisionAssociation.revisionRequestId}</p><p className="verification-hint">{revisionAssociation.note}</p>{revisionAssociation.recheckRequestId && <p className="verification-hint">对应知情复查请求：{revisionAssociation.recheckRequestId}</p>}</> : <p className="verification-hint">{revisionAssociation?.note ?? '旧记录缺少可确认的稿件对应信息，保持未知，不用当前文件补填。'}</p>}{selected.revision?.text && <details><summary>新稿原文</summary><pre>{selected.revision.text}</pre></details>}</section>}
        {selected.recheckResult && <details open><summary>{revisionAssociation?.status === 'recorded' ? '知情复查 · 对应本记录唯一新稿' : '历史复查 · 稿件归属未确认'}</summary><p className="verification-hint">{revisionAssociation?.status === 'recorded' ? `只对应出稿请求 ${revisionAssociation.revisionRequestId}，不是新的冷读；不代表用户采用。` : '仅保留当时意见原文，不能声称当前新稿已经复查。'}</p><pre>{selected.recheckResult.text}</pre></details>}
        <div className="verification-actions"><button type="button" className="secondary-button" disabled={loading || posting} onClick={() => { void refresh(selected.id); }}>重新读取本记录</button>{running(selected) && !archived && <button type="button" className="secondary-button" disabled={posting} onClick={() => { void action('stop'); }}>停止本次核算</button>}{selected.status === 'completed' && selected.comparisonResult && !archived && <button type="button" className="secondary-button" disabled={posting || taskBusy || revisionWasStarted} onClick={() => { void action('author-revision'); }}>{revisionWasStarted ? '本记录已发起出稿' : '依据核算意见生成新稿'}</button>}{selected.revision?.status === 'completed' && !archived && <button type="button" className="secondary-button" disabled={posting || taskBusy || recheckWasStarted} onClick={() => { void action('recheck'); }}>{recheckWasStarted ? '本记录已发起一次复查' : '发起一次知情复查'}</button>}{selected.comparisonResult && !archived && <button type="button" className="secondary-button" disabled={posting || running(selected)} onClick={() => { void action('export'); }}>另存核算报告</button>}{['failed', 'cancelled', 'interrupted', 'unknown'].includes(selected.status) && !archived && <button type="button" className="secondary-button" disabled={locked || taskBusy} onClick={() => openForm(selected)}>显式新建一次核算</button>}</div>
        {selected.exportedFile && <button type="button" className="text-button" onClick={() => { const path = selected.exportedFile!; void downloadFile(project.id, { kind: 'file', name: path.split('/').at(-1) ?? '核算报告.md', path }).catch(error => setError(errorText(error))); }}>下载已导出的核算报告</button>}
      </article>}
    </div>}
  </section>;
}
