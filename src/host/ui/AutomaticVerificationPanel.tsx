import { useEffect, useId, useRef, useState } from 'react';
import type { AutomaticSettings, AutomaticVersion } from '../automatic-verification-types.ts';
import type { ClientProject, ClientTask } from './project-types.ts';
import { readVerification, type VerificationRecord } from './verification-client.ts';
import {
  AutomaticVerificationRequestError, automaticChainRunning, automaticChainLabel, automaticCleanupConfirmed,
  automaticPhaseLabel, automaticReasonLabel, listAutomaticChains, mergeAutomaticChains, readAutomaticCapabilities,
  readAutomaticChain, automaticReportBlob, automaticReportPreview, readAutomaticReport, readAutomaticSettings,
  readAutomaticStatus, type AutomaticChainView, type AutomaticReport, type AutomaticStatus,
} from './automatic-verification-client.ts';
import './automatic-verification.css';

type Props = {
  project: ClientProject; task: ClientTask; taskBusy: boolean; filesRevision: number;
};
const errorText = (error: unknown) => error instanceof AutomaticVerificationRequestError
  ? error.message : '暂未读回自动核算记录。可以只读重新查询，不会自动重发。';
const dateText = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : value ?? '未记录';
const freshSettings = (projectId: string, taskId: string): AutomaticSettings => ({ formatVersion: 1, projectId, taskId, revision: 0, enabled: false, dataFiles: [], processFiles: [], maxAuthorTurns: 2 });
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

export function AutomaticVerificationPanel({ project, task, taskBusy, filesRevision }: Props) {
  const uid = useId(), mounted = useRef(true), selectedTarget = useRef<string | undefined>(undefined), requestSerial = useRef(0);
  const [settings, setSettings] = useState(() => freshSettings(project.id, task.id)), [status, setStatus] = useState<AutomaticStatus>();
  const [chains, setChains] = useState<AutomaticChainView[]>([]), [selected, setSelected] = useState<AutomaticChainView>(), [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [observeVersion, setObserveVersion] = useState(0);
  const [initial, setInitial] = useState<VerificationRecord>(), [initialLoading, setInitialLoading] = useState(false), [initialError, setInitialError] = useState('');
  const archived = Boolean(project.archivedAt), active = chains.some(automaticChainRunning);
  const apply = (value: AutomaticChainView) => {
    if (!mounted.current || selectedTarget.current !== value.chainId) return;
    setSelected(old => old?.chainId === value.chainId && old.revision > value.revision ? old : value);
    setChains(old => mergeAutomaticChains(old, [value]));
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestSerial.current++; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setLoading(true); setError('');
    void Promise.allSettled([readAutomaticSettings(project.id, task.id, controller.signal), listAutomaticChains(project.id, task.id, controller.signal), readAutomaticCapabilities(project.id, task.id, controller.signal), readAutomaticStatus(project.id, task.id, controller.signal)]).then(async ([configuration, history, capability, observed]) => {
      if (!alive) return;
      if (configuration.status === 'fulfilled') setSettings(configuration.value);
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
  const readInitial = async () => {
    const id = selected?.firstVerification?.verificationId, chainId = selected?.chainId;
    if (!id || !chainId) return;
    setInitialLoading(true); setInitialError('');
    try { const value = await readVerification(project.id, task.id, id, AbortSignal.timeout(10000)); if (mounted.current && selectedTarget.current === chainId) setInitial(value); }
    catch { if (mounted.current && selectedTarget.current === chainId) setInitialError('首次核算记录暂未读回，当前链和已保存结果不变。'); }
    finally { if (mounted.current && selectedTarget.current === chainId) setInitialLoading(false); }
  };
  return <details className="automatic-verification" aria-busy={loading}>
    <summary className="automatic-fold-heading"><strong>自动核算与修订记录</strong><span className="automatic-badge" role="status">{loading ? '读取中' : '已停用'}</span></summary>
    <div className="automatic-fold-content">
    <header className="automatic-heading"><div><h2>旧自动核算与修订 · 已停用</h2><p>{settings.enabled ? '历史设置为开启' : '历史设置为关闭'} · 设置修订 {settings.revision}</p><details><summary>查看历史设置</summary><pre>{JSON.stringify(settings, null, 2)}</pre></details></div></header>
    <p className="verification-hint">历史链、固定稿件及原意见按当时版本回看。</p>
    {archived && <p className="verification-hint">项目已归档，只可回看已有记录。</p>}{active && <p className="verification-hint">本任务正在自动处理中；停止并安全收尾后可继续普通分析。</p>}
    {status?.observation && <div className="automatic-observation"><strong>最近一次报告观察</strong><p>{status.observation.reason !== 'none' ? automaticReasonLabel[status.observation.reason] ?? '观察结果尚待确认' : status.observation.chainId ? '指定报告新版本已关联自动处理记录' : status.busy && !status.observation.after ? '等待本次分析完成，再观察指定报告版本' : '已保存技术观察，自动交接以实际链记录为准'}。</p><p className="verification-hint">设置修订{status.observation.settingsSnapshot.revision} · {dateText(status.observation.observedAt ?? status.observation.admittedAt)}。文件版本变化不证明写入者，也不代表已读取或正确。</p></div>}
    {error && <p className="verification-error" role="alert">{error}</p>}{notice && <p className="verification-hint" role="status">{notice}</p>}
    <div className="automatic-record-heading"><h3>报告与意见记录</h3><button type="button" className="text-button" disabled={loading} onClick={() => { void query(); }}>只读查询原记录</button></div>
    {chains.length > 0 ? <div className="verification-field"><label htmlFor={`${uid}-history`}>查看自动处理记录</label><select id={`${uid}-history`} value={selectedId ?? ''} onChange={event => { void selectChain(event.target.value); }}>{chains.map(chain => <option key={chain.chainId} value={chain.chainId}>{dateText(chain.createdAt)} · {automaticChainLabel(chain) ?? '状态待确认'} · {chain.settingsSnapshot.reportPath ?? '报告路径未记录'}</option>)}</select></div> : <p className="automatic-empty">{loading ? '正在读取…' : '没有已记录的旧自动处理链。'}</p>}
    {selected && <article className="automatic-detail" aria-label="自动处理详情"><div className="automatic-record-heading"><h3>{automaticChainLabel(selected) ?? '状态待确认'}</h3><span>{automaticPhaseLabel[selected.phase] ?? '阶段待确认'}</span></div>{selected.reason !== 'none' && <p className="automatic-reason">{automaticReasonLabel[selected.reason] ?? '结束原因尚未识别，保留原记录。'}</p>}<p>{selected.settingsSnapshot.question}</p><p className="verification-hint">本链主Agent：{selected.configuration.name ?? selected.configuration.model} · {selected.configuration.model}；核算：{selected.verificationConfiguration.name ?? selected.verificationConfiguration.model} · {selected.verificationConfiguration.model}</p><dl className="automatic-summary"><div><dt>主Agent已接受意见请求</dt><dd>{selected.authorAccepted} / {selected.settingsSnapshot.maxAuthorTurns}</dd></div><div><dt>已记录报告版本</dt><dd>{selected.versions.length}</dd></div><div><dt>当时设置修订</dt><dd>{selected.settingsSnapshot.revision}</dd></div></dl>
      <p className="verification-hint">次数是原主Agent实际接受意见请求的次数，不是专业评分。结束、一致或未提交新稿都不表示报告已正确。</p>
      {selected.cleanup?.state === 'unknown' && <p className="automatic-warning" role="status">执行资源清理尚未确认。历史结果继续保留，查询不会重发分析。</p>}
      {selected.state === 'unknown' && automaticCleanupConfirmed(selected) && <p className="verification-hint" role="status">资源清理已确认；原处理结果仍待确认，历史记录保持不变。</p>}
      <ChainMaterials chain={selected} initial={initial?.id === selected.firstVerification?.verificationId ? initial : undefined} reading={initialLoading} error={initialError} onRead={() => { void readInitial(); }} />
      <section className="automatic-versions"><h4>稿件版本与复查对应</h4>{selected.versions.length ? <ol>{selected.versions.map(version => <li key={version.version}><strong>{version.version === 1 ? '原稿' : `第${version.version - 1}次修订`} · 版本{version.version}</strong><p className="automatic-path">{version.relativePath}</p><details><summary>版本身份与来源</summary><dl className="automatic-identity"><div><dt>SHA-256</dt><dd><code>{version.sha256}</code></dd></div><div><dt>固定副本</dt><dd>{version.snapshotPath}</dd></div><div><dt>字节数</dt><dd>{version.bytes.toLocaleString()} B</dd></div><div><dt>作者请求</dt><dd>{version.requestId ?? '未记录'}</dd></div><div><dt>对应复查请求</dt><dd>{version.recheckRequestId ?? (version.version === 1 ? '原稿沿首次核算对照' : '尚无可确认的复查请求')}</dd></div></dl></details><FixedReport key={`${project.id}/${task.id}/${selected.chainId}/${version.version}/${version.sha256}`} projectId={project.id} taskId={task.id} chainId={selected.chainId} version={version} /></li>)}</ol> : <p className="verification-hint">尚未记录可回读的报告版本。</p>}</section>
      <section className="automatic-steps"><h4>交接与Agent原文</h4>{selected.steps.map(step => <details key={step.stepId}><summary>{automaticPhaseLabel[step.phase]} · {step.status === 'completed' ? '已有终态' : step.status === 'accepted' ? '请求已接受' : step.status === 'planned' ? '尚未证实接受' : step.status === 'unknown' ? '结果待确认' : step.status === 'cancelled' ? '已停止' : '运行失败'}</summary>{step.phase === 'recheck' && <p className="verification-hint">这是已见作者信息后的知情复查，不是新的冷读。</p>}{step.result?.text !== undefined ? <pre>{step.result.text}</pre> : <p className="verification-hint">{step.verificationRef ? '原文由首次核算记录保存，可在本链材料区只读回看。' : '尚未回读原文，不用当前材料补造。'}</p>}<dl className="automatic-identity"><div><dt>实际请求</dt><dd>{step.requestId}</dd></div><div><dt>接受时间</dt><dd>{dateText(step.acceptedAt)}</dd></div><div><dt>对应报告SHA</dt><dd>{step.inputSha256 ?? '未记录'}</dd></div>{step.result && <div><dt>结果SHA</dt><dd>{step.result.sha256}</dd></div>}</dl></details>)}</section>
      <div className="verification-actions"><button type="button" className="secondary-button" disabled={loading} onClick={() => { void query(); }}>重新读取本链</button></div><p className="verification-hint">旧稿和意见保留。末次意见若未实际交回，不称主Agent已读；采用报告与经营动作仍需显式操作。</p>
    </article>}
    </div>
  </details>;
}
