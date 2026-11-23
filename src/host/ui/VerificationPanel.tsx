import { useEffect, useId, useRef, useState } from 'react';
import type { ClientProject, ClientTask } from './project-types.ts';
import { downloadFile } from './runtime-client.ts';
import { downloadVerificationAuthorFile, listVerifications, readSapProvision, readVerification, verificationPhaseLabel, verificationStatusLabel, VerificationRequestError, type VerificationFixedMaterial, type VerificationRecord } from './verification-client.ts';
import './verification-panel.css';
import { AutomaticVerificationPanel } from './AutomaticVerificationPanel.tsx';

type Props = {
  project: ClientProject; task: ClientTask; taskBusy: boolean; filesRevision: number;
  semanticContext?: unknown;
};
const pendingKey = (projectId: string, taskId: string) => `optracall.verification-intent:${projectId}/${taskId}`;
function savedPending(key: string): string | undefined { try { return sessionStorage.getItem(key) ?? undefined; } catch { return undefined; } }
const errorText = (error: unknown) => error instanceof VerificationRequestError ? error.message : '核算服务暂不可用，请重新读取记录。';
const running = (record?: VerificationRecord) => Boolean(record && (['preparing', 'ready', 'running'].includes(record.status) || record.revision?.status === 'running'));
const dateText = (value: string) => Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString('zh-CN', { hour12: false });
function independenceText(record: VerificationRecord): string {
  const status = record.independence?.status;
  if (status === 'informed' || status === 'contaminated') return '知情复核：已接触作者信息';
  if (status === 'observed') return '捕获范围内未发现直接提前读取；不代表安全隔离';
  return '独立性尚未确认';
}

function MaterialIdentity({ file, fixedPath }: { file: VerificationFixedMaterial; fixedPath?: string }) {
  return <dl className="verification-identity"><div><dt>SHA-256</dt><dd><code>{file.sha256}</code></dd></div><div><dt>字节数</dt><dd>{file.bytes.toLocaleString()} B</dd></div>{file.sourcePath && <div><dt>原来源</dt><dd>{file.sourcePath}</dd></div>}{fixedPath && <div><dt>固定副本</dt><dd>{fixedPath}</dd></div>}</dl>;
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

export function VerificationPanel({ project, task, taskBusy, filesRevision, semanticContext }: Props) {
  const uid = useId(), mounted = useRef(true), detailRequest = useRef(0), detailTarget = useRef<string | undefined>(undefined);
  const [open, setOpen] = useState(true), [records, setRecords] = useState<VerificationRecord[]>([]);
  const [selected, setSelected] = useState<VerificationRecord>(), [loading, setLoading] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [observation, setObservation] = useState(0);
  const [pendingId] = useState(() => savedPending(pendingKey(project.id, task.id)));
  const archived = Boolean(project.archivedAt), sapProvision = readSapProvision(semanticContext);
  const apply = (value: VerificationRecord) => {
    if (!mounted.current) return;
    detailTarget.current = value.id;
    setSelected(value); setRecords(old => [value, ...old.filter(item => item.id !== value.id)]);
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; detailRequest.current++; }; }, []);
  useEffect(() => {
    if (!open) return;
    let alive = true; const controller = new AbortController(); setLoading(true); setError('');
    void listVerifications(project.id, task.id, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])).then(list => {
      if (!alive) return;
      const history = list.filter(item => (item as { mode?: string }).mode !== 'conclusion-review');
      setRecords(history);
      setSelected(old => { const value = old ? history.find(item => item.id === old.id) ?? old : history[0]; detailTarget.current = value?.id; return value; });
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
        if (!running(value)) return;
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
        apply(value);
        setNotice('已只读核对原记录，没有重新发送核算。'); setObservation(value => value + 1);
      } else {
        const list = await listVerifications(project.id, task.id, AbortSignal.timeout(10000));
        if (mounted.current && serial === detailRequest.current) setRecords(list.filter(item => (item as { mode?: string }).mode !== 'conclusion-review'));
      }
    } catch (error) { if (mounted.current && serial === detailRequest.current) setError(pendingId ? '原核算暂未读回，操作编号继续保留。请稍后查询，不会自动重发。' : errorText(error)); }
    finally { if (mounted.current && serial === detailRequest.current) setLoading(false); }
  };
  const diagnostic = typeof selected?.diagnostic === 'string' ? selected.diagnostic : selected?.diagnostic?.message;
  const revisionAssociation = selected?.contextEvidence?.revisionAssociation;
  const revisionWasStarted = Boolean(selected?.revision || selected?.revisionCount);
  return <section className="verification" aria-label="独立核算">
    <AutomaticVerificationPanel key={`${project.id}/${task.id}`} project={project} task={task} taskBusy={taskBusy} filesRevision={filesRevision} />
    <button type="button" className="text-button verification-trigger" aria-expanded={open} aria-controls={`${uid}-panel`} onClick={() => setOpen(value => !value)}>旧独立核算记录{Boolean(selected?.uiRequests?.length) && <span className="verification-waiting">等待回应</span>}<span aria-hidden="true">{open ? '⌃' : '⌄'}</span></button>
    {open && <div id={`${uid}-panel`} className="verification-panel">
      <header className="verification-heading"><div><h2 tabIndex={-1}>旧独立核算记录</h2><p>另一会话自主形成依据，差异与未知分别保留。</p></div></header>
      <p className="verification-scope">历史记录只读，稿件、依据及意见沿原版本回看。</p>
      <details className="verification-context"><summary>当前会话的 SAP 提供记录</summary><p className="verification-hint">仅展示当前资源或历史回执实际提供的索引，不等于业务采用。</p>{sapProvision ? <><p className="verification-hint">{sapProvision.basis === 'runtime-initialization' ? '来源：当前运行资源初始化' : sapProvision.basis === 'historical-receipt' || sapProvision.basis === 'native-receipt' ? '来源：历史提供回执' : `来源标记：${sapProvision.basis ?? '未记录'}`}</p><pre>{sapProvision.indexText}</pre><p className="verification-hint">指纹：{sapProvision.sha256 ?? '未记录'}</p></> : <p className="verification-hint">当前资源／历史回执没有可确认的 SAP 索引记录；不会用当前项目启用版本补填。需要新 SAP 时请显式新建任务，原会话保留。</p>}</details>
      {archived && <p className="verification-hint">项目已归档，仅可查看已有核算。</p>}
      {pendingId && <div className="verification-pending" role="status"><strong>原提交尚待核对</strong><p>操作编号：<code>{pendingId}</code></p><button type="button" className="secondary-button" disabled={loading} onClick={() => { void refresh(pendingId); }}>查询原核算</button></div>}
      {error && <p className="verification-error" role="alert">{error}</p>}{notice && <p className="verification-hint" role="status">{notice}</p>}
      <div className="verification-list-heading"><h3>已有核算</h3><button type="button" className="text-button" disabled={loading} onClick={() => { void refresh(); }}>只读刷新</button></div>
      {loading && <p className="verification-hint" role="status">正在读取核算记录…</p>}
      {!loading && !records.length && <p className="verification-empty">没有已记录的旧独立核算。</p>}
      {records.length > 0 && <ul className="verification-list">{records.map(record => <li key={record.id}><button type="button" className={selected?.id === record.id ? 'selected' : ''} aria-current={selected?.id === record.id ? 'true' : undefined} onClick={() => { setSelected(record); void refresh(record.id); }}><span>{record.question}</span><small>{verificationStatusLabel[record.status] ?? '状态未知'} · {dateText(record.createdAt)}</small></button></li>)}</ul>}
      {selected && <article className="verification-detail" aria-label="核算详情"><div className="verification-detail-heading"><h3>{verificationStatusLabel[selected.status] ?? '状态未知'}</h3><span>{selected.phase ? verificationPhaseLabel[selected.phase] ?? selected.phase : '阶段待确认'}</span></div><p>{selected.question}</p><p className="verification-hint">{selected.model ? `${selected.model.name ?? selected.model.model} · ${selected.model.model} · 配置修订 ${selected.model.revision}` : '模型配置尚待记录'}</p><p className="verification-hint">{independenceText(selected)}</p>
        {selected.independence?.details && <p className="verification-hint">{Array.isArray(selected.independence.details) ? selected.independence.details.join('；') : selected.independence.details}</p>}
        {diagnostic && <p className="verification-error">{diagnostic}</p>}
        <details><summary>本次选择与版本依据</summary><p>源数据：{selected.selection.dataFiles.join('、')}</p><p>作者产物：{selected.selection.authorFiles.join('、')}</p><p>{selected.selection.requirementContext ? `RAP ${selected.selection.requirementContext.instanceId} · ${selected.selection.requirementContext.version ?? '选定时的已确认快照'}` : '未选 RAP'}</p><p>{selected.selection.caseId ? `Case ${selected.selection.caseId} · 修订 ${selected.selection.caseRevision ?? '待核对'}` : '未选 Case'}</p><p>{selected.selection.useCurrentSap ? '本次按明确选择使用当前启用 SAP；不回填历史采用状态。' : '未明确选择当前启用 SAP。'}</p>{selected.selection.businessContext && <p>用户补充：{selected.selection.businessContext}</p>}<p className="verification-hint">核算编号：{selected.id} · 保存于 {dateText(selected.updatedAt)}</p></details>
        <VerificationMaterials record={selected} />
        {selected.authorReports?.map((report, index) => <details key={`${report.path}-${index}`}><summary>作者固定版本：{report.path}</summary>{report.sha256 && <p className="verification-hint">SHA-256：{report.sha256}</p>}<p className="verification-hint">{report.textStatus === 'not-utf8' ? '固定字节存在，但不能解码为UTF-8文字；没有文字预览。' : report.start === undefined || report.end === undefined || report.totalLength === undefined || report.start === null || report.end === null || report.totalLength === null ? '此记录没有文字显示范围，不能据此确认是全文。' : `界面文字范围 [${report.start}, ${report.end}) / ${report.totalLength.toLocaleString()} UTF-16${report.truncated ? '，已截取，不是全文。' : '。'}`}</p>{report.fixedPath && <p className="verification-hint">完整固定副本：{report.fixedPath}</p>}{report.text !== '' && <pre>{report.text}</pre>}{report.fixedPath && <button type="button" className="text-button" onClick={() => { void downloadVerificationAuthorFile(project.id, task.id, selected.id, report.path).catch(error => setError(errorText(error))); }}>下载此固定副本全文：{report.path.split('/').at(-1)}</button>}</details>)}
        {selected.coldResult && <details open><summary>首次依据 · Agent原文</summary><pre>{selected.coldResult.text}</pre></details>}{selected.comparisonResult && <details open><summary>对照结果与分歧 · Agent原文</summary><pre>{selected.comparisonResult.text}</pre></details>}
        {revisionWasStarted && <section className="verification-revision-basis" aria-label="本记录新稿与复查对应"><h4>本记录唯一新稿</h4><p className="verification-hint">本记录已发起过一次出稿；保留稿件和来源，不再次覆盖，也不自动复查。</p>{selected.revision?.files?.map(file => <p key={file}>{file}</p>)}{revisionAssociation?.status === 'recorded' ? <><p className="verification-hint">出稿请求：{revisionAssociation.revisionRequestId}</p><p className="verification-hint">{revisionAssociation.note}</p>{revisionAssociation.recheckRequestId && <p className="verification-hint">对应知情复查请求：{revisionAssociation.recheckRequestId}</p>}</> : <p className="verification-hint">{revisionAssociation?.note ?? '旧记录缺少可确认的稿件对应信息，保持未知，不用当前文件补填。'}</p>}{selected.revision?.text && <details><summary>新稿原文</summary><pre>{selected.revision.text}</pre></details>}</section>}
        {selected.recheckResult && <details open><summary>{revisionAssociation?.status === 'recorded' ? '知情复查 · 对应本记录唯一新稿' : '历史复查 · 稿件归属未确认'}</summary><p className="verification-hint">{revisionAssociation?.status === 'recorded' ? `只对应出稿请求 ${revisionAssociation.revisionRequestId}，不是新的冷读；不代表用户采用。` : '仅保留当时意见原文，不能声称当前新稿已经复查。'}</p><pre>{selected.recheckResult.text}</pre></details>}
        <div className="verification-actions"><button type="button" className="secondary-button" disabled={loading} onClick={() => { void refresh(selected.id); }}>重新读取本记录</button></div>
        {selected.exportedFile && <button type="button" className="text-button" onClick={() => { const path = selected.exportedFile!; void downloadFile(project.id, { kind: 'file', name: path.split('/').at(-1) ?? '核算报告.md', path }).catch(error => setError(errorText(error))); }}>下载已导出的核算报告</button>}
      </article>}
    </div>}
  </section>;
}
