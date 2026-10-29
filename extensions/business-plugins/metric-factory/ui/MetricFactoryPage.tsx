import { useEffect, useMemo, useRef, useState } from 'react';
import { HostRequestError, createTask as createDiskTask, projectFiles, saveDraft } from '../../../../src/host/ui/runtime-client.ts';
import type { ClientProject, ClientTask, FileNode } from '../../../../src/host/ui/project-types.ts';
import type { SapDocument } from '../sap/validate.ts';

type LibraryEntry = { id: string; version: string; namespace: string; packageFingerprint: string; contentFingerprint: string; bytesSha256: string; bytes: number; publishedAt: string; publishedBy: string; metricNames: string[]; scenarioIds: string[] };
type EnablementRecord = { packageId: string; version: string; enabledAt: string; entry?: LibraryEntry };
type Tab = 'overview' | 'detail' | 'review' | 'enable';

async function metricRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/metric-factory/${path}`, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new HostRequestError(value.message ?? '指标资产请求未完成，请重试。', {}, value.code ?? 'metric_request_failed');
  return value as T;
}

const shortSha = (value: string) => `${value.slice(0, 11)}…${value.slice(-4)}`;
const dateOf = (value: string) => value.slice(0, 10);
const compareVersion = (a: string, b: string) => { const left = a.split('.').map(Number), right = b.split('.').map(Number); return left[0]! - right[0]! || left[1]! - right[1]! || left[2]! - right[2]!; };
const draftFilesOf = (files: FileNode[]): string[] => (files.find(node => node.name === '020_clean')?.children ?? [])
  .filter(node => node.kind === 'file' && /\.ya?ml$/.test(node.name))
  .map(node => `020_clean/${node.name}`)
  .sort((a, b) => a.localeCompare(b));

export const MODELING_GUIDE = `请帮我起草一份分析指标体系（SAP 0.2 语义资产包），沉淀可复用的指标口径与分析方法。

建议步骤：
1. 先向我确认业务背景：要支持什么决策、有哪些维度与时间粒度、已有哪些口径共识。
2. 起草 YAML 草稿并保存到 020_clean/，文件名建议 <体系id>@<版本>.draft.yaml。
3. SAP 0.2 结构（未知字段会被拒绝）：
   - sap: "0.2"
   - package: { id: 小写字母与中划线, version: 语义化版本, namespace: mf.<id>, fingerprint: "" }
   - dimensions: 顶层维度清单（小写下划线命名）
   - metrics: name/display_name/type(simple|ratio|derived|cumulative)/definition(中文口径)/dimensions/time_grains(day|week|month|quarter|year)/owner_role/caliber_switches/type_params(numerator|denominator/expr/measure/window/grain_to_date)/provenance(origin: llm, model: 当前模型, reviewed_by: 留待用户审核)
   - scenarios: id/version/title/decision_purpose/metric_usages(metric + role: outcome|driver|guardrail)/method_refs/evidence_requirements
4. 校验规则：指标 dimensions 必须取自顶层清单；场景引用的指标必须存在；ratio 必须有 numerator 与 denominator；type_params 引用的指标必须存在。
5. 完成后提醒我到「指标体系」页审核发布；发布后草稿仍保留在 020_clean。
如存在已发布包，可参考 ~/.optracall/metric-assets/<id>/<版本>.sap.yaml 的写法。`;

function MetricCard({ metric }: { metric: SapDocument['metrics'][number] }) {
  return <article className="mf-metric">
    <div className="mf-metric-head">
      <strong>{metric.display_name}</strong>
      <code>{metric.name}</code>
      <span className="mf-type">{metric.type}</span>
      {metric.provenance.origin === 'llm' && <span className="mf-prov">LLM 起草 · {metric.provenance.reviewed_by ? `已由 ${metric.provenance.reviewed_by} 审核` : '未审核'}</span>}
      {metric.provenance.origin !== 'llm' && <span className="mf-prov">{metric.provenance.origin === 'template' ? `模板 ${metric.provenance.template_ref ?? ''}` : '人工录入'}</span>}
    </div>
    <p className="mf-definition">{metric.definition}</p>
    <div className="mf-metric-props">
      {metric.type_params && <span><b>计算构成</b>{Object.entries(metric.type_params).map(([key, value]) => `${key}: ${value}`).join(' · ')}</span>}
      {Object.keys(metric.caliber_switches).length > 0 && <span><b>口径开关</b>{Object.entries(metric.caliber_switches).map(([key, value]) => `${key}=${value}`).join(' · ')}</span>}
      <span><b>维度 / 粒度</b>{metric.dimensions.join(' · ') || '无'} / {metric.time_grains.join(' · ')}</span>
      <span><b>负责角色</b>{metric.owner_role}</span>
    </div>
  </article>;
}

export function MetricFactoryPage({ projects, onOpenTask, onProjectsChanged, onBack }: {
  projects: ClientProject[];
  onOpenTask: (project: ClientProject, task: ClientTask) => void;
  onProjectsChanged: () => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<{ entry: LibraryEntry; document: SapDocument } | null>(null);
  const [modelingOpen, setModelingOpen] = useState(false);
  const [modelingProject, setModelingProject] = useState('');
  const activeProjects = useMemo(() => projects.filter(project => project.archivedAt === null), [projects]);
  const heading = useRef<HTMLHeadingElement>(null);

  const reload = async () => {
    try { setEntries((await metricRequest<{ entries: LibraryEntry[] }>('library', 'GET')).entries); setError(''); }
    catch (caught) { setError(caught instanceof HostRequestError ? caught.message : '指标库暂时不可用，请刷新重试。'); }
  };
  useEffect(() => { void reload(); }, []);
  useEffect(() => { heading.current?.focus(); }, [tab]);

  const packages = useMemo(() => {
    const grouped = new Map<string, LibraryEntry[]>();
    for (const entry of entries) grouped.set(entry.id, [...(grouped.get(entry.id) ?? []), entry]);
    const needle = query.trim().toLocaleLowerCase('zh-CN');
    return [...grouped.entries()]
      .map(([id, versions]) => ({ id, versions: versions.sort((a, b) => compareVersion(b.version, a.version)), latest: versions[0]! }))
      .filter(({ latest }) => !needle || [latest.id, ...latest.metricNames, ...latest.scenarioIds].join(' ').toLocaleLowerCase('zh-CN').includes(needle));
  }, [entries, query]);

  const openDetail = async (id: string, version: string) => {
    setTab('detail');
    try { setDetail(await metricRequest<{ entry: LibraryEntry; document: SapDocument }>(`library/${encodeURIComponent(id)}/${encodeURIComponent(version)}`, 'GET')); setError(''); }
    catch (caught) { setError(caught instanceof HostRequestError ? caught.message : '资产包详情读取失败。'); }
  };

  const createModelingTask = async () => {
    const project = activeProjects.find(item => item.id === modelingProject);
    if (!project) return;
    try {
      const task = await createDiskTask(project.id, '指标体系建模');
      await saveDraft(project.id, task.id, MODELING_GUIDE);
      setModelingOpen(false); setModelingProject(''); setNotice('建模任务已创建并预填引导草稿，可直接发送或先修改。');
      onProjectsChanged();
      onOpenTask({ ...project, tasks: [...project.tasks, task] }, task);
    } catch (caught) { setError(caught instanceof HostRequestError ? caught.message : '建模任务创建失败，请重试。'); }
  };

  return <div className="mf-page" data-build="metric-factory-mvp">
    <div className="page-heading">
      <div>
        <p className="eyebrow">METRIC FACTORY · 业务插件</p>
        <h1 ref={heading} tabIndex={-1}>指标体系</h1>
        <p>在任务中与 Pi 协作起草指标体系，审核发布到本机全局库；项目按精确版本启用，分析时引用口径并注明版本。</p>
      </div>
      <span className="mf-store">全局库 · ~/.optracall/metric-assets/</span>
    </div>
    {error && <div className="error-notice" role="alert"><div><strong>指标体系提示</strong><p>{error}</p></div><button className="text-button" onClick={() => { setError(''); void reload(); }}>重试</button></div>}
    {notice && <p className="project-notice" role="status">{notice}<button className="text-button" onClick={() => setNotice('')}>知道了</button></p>}
    <nav className="mf-tabs" role="group" aria-label="指标体系视图">
      {([['overview', '库总览'], ['detail', '包详情'], ['review', '审核发布'], ['enable', '项目启用']] as const).map(([key, label]) =>
        <button key={key} className={tab === key ? 'active' : ''} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
    </nav>

    {tab === 'overview' && <section aria-label="库总览">
      <div className="mf-toolbar">
        <label className="mf-search"><span aria-hidden="true">⌕</span><span className="sr-only">搜索资产包</span><input value={query} placeholder="搜索资产包、指标或场景" onChange={event => setQuery(event.target.value)} /></label>
        <div className="mf-actions">
          <button className="secondary-button" onClick={() => setTab('review')}>导入草稿</button>
          <button className="primary-button" onClick={() => setModelingOpen(true)} disabled={!activeProjects.length}>＋ 发起建模任务</button>
        </div>
      </div>
      {packages.length ? <div className="mf-grid">
        {packages.map(({ id, latest, versions }) => <article className="mf-card" key={id}>
          <div className="mf-card-top"><span className="mf-symbol" aria-hidden="true">◆</span><span className="mf-count">{versions.length} 个版本</span></div>
          <h2>{id}</h2>
          <p>{latest.metricNames.join(' · ')}</p>
          <div className="mf-tags">{versions.slice(0, 3).map(entry => <span key={entry.version} className={entry === latest ? 'latest' : ''}>{entry.version}</span>)}{versions.length > 3 && <span>…</span>}</div>
          <div className="mf-card-bottom">
            <span>最新 {latest.version} · {dateOf(latest.publishedAt)} · 指标 ×{latest.metricNames.length} · 场景 ×{latest.scenarioIds.length}</span>
            <button className="text-button" onClick={() => void openDetail(id, latest.version)}>查看详情 →</button>
          </div>
        </article>)}
      </div> : <div className="mf-empty"><h2>{query ? '没有匹配的资产包' : '全局库还没有资产包'}</h2><p>{query ? '试试其他关键词。' : '在项目任务中与 Pi 协作起草指标体系草稿，然后到「审核发布」导入发布。'}</p>{!query && <button className="primary-button" onClick={() => setModelingOpen(true)} disabled={!activeProjects.length}>＋ 发起建模任务</button>}</div>}
      <p className="mf-footer">发布即不可变：内容未变拒绝重发，版本不可覆盖 · 更新=新版本+项目显式升级</p>
    </section>}

    {tab === 'detail' && <section aria-label="包详情">
      {detail ? <>
        <button className="text-button" onClick={() => setTab('overview')}>← 返回库总览</button>
        <div className="mf-detail-head">
          <div><h2>{detail.entry.id}<code>@{detail.entry.version}</code></h2><p>{detail.entry.namespace} · SAP 0.2</p></div>
          <span className="mf-pill">已发布 · 不可变</span>
        </div>
        <dl className="mf-meta">
          <div><dt>包指纹</dt><dd>{shortSha(detail.entry.packageFingerprint)}</dd></div>
          <div><dt>内容指纹</dt><dd>{shortSha(detail.entry.contentFingerprint)}</dd></div>
          <div><dt>发布时间 / 审核人</dt><dd>{dateOf(detail.entry.publishedAt)} · {detail.entry.publishedBy}</dd></div>
          <div><dt>库文件</dt><dd>~/.optracall/metric-assets/{detail.entry.id}/{detail.entry.version}.sap.yaml</dd></div>
        </dl>
        <h3 className="mf-section-title">指标定义（{detail.document.metrics.length}）</h3>
        {detail.document.metrics.map(metric => <MetricCard key={metric.name} metric={metric} />)}
        <h3 className="mf-section-title">分析场景（{detail.document.scenarios.length}）</h3>
        {detail.document.scenarios.map(scenario => <article className="mf-metric" key={`${scenario.id}@${scenario.version}`}>
          <div className="mf-metric-head"><strong>{scenario.title}</strong><code>{scenario.id}@{scenario.version}</code></div>
          <p className="mf-definition">{scenario.decision_purpose}</p>
          <div className="mf-metric-props">
            <span><b>指标用法</b>{scenario.metric_usages.map(usage => `${usage.metric}(${usage.role})`).join(' · ') || '无'}</span>
            <span><b>方法引用</b>{scenario.method_refs.join(' · ') || '无'}</span>
            <span><b>证据要求</b>{scenario.evidence_requirements}</span>
          </div>
        </article>)}
      </> : <p className="mf-footer">从库总览选择一个资产包查看详情。</p>}
    </section>}

    {tab === 'review' && <ReviewView activeProjects={activeProjects} onPublished={async () => { void reload(); setNotice('已发布到全局库；草稿仍保留在 020_clean。'); setTab('overview'); }} onError={setError} onReload={reload} />}

    {tab === 'enable' && <EnableView activeProjects={activeProjects} entries={entries} onError={setError} />}

    {modelingOpen && <dialog className="project-dialog" open aria-labelledby="modeling-title" onClose={() => setModelingOpen(false)}>
      <h2 id="modeling-title">发起建模任务</h2>
      <p className="mf-dialog-hint">在所选项目内创建普通任务，草稿预填 SAP 0.2 建模引导；不预装 skill，不自动调用模型。</p>
      <div className="field"><label htmlFor="modeling-project">项目</label>
        <select id="modeling-project" value={modelingProject} onChange={event => setModelingProject(event.target.value)}>
          <option value="">选择项目…</option>
          {activeProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        {!activeProjects.length && <p className="field-error">暂无可用项目，请先在项目工作台创建。</p>}
      </div>
      <div className="project-dialog-actions">
        <button className="secondary-button" onClick={() => setModelingOpen(false)}>取消</button>
        <button className="primary-button" disabled={!modelingProject} onClick={() => void createModelingTask()}>创建并打开任务</button>
      </div>
    </dialog>}
    <p className="mf-footer"><button className="text-button" onClick={onBack}>返回工作区 →</button> · Agent 对全局库只读；发布与启用均为显式操作</p>
  </div>;
}

function ReviewView({ activeProjects, onPublished, onError, onReload }: { activeProjects: ClientProject[]; onPublished: () => void | Promise<void>; onError: (message: string) => void; onReload: () => Promise<void> }) {
  const [projectId, setProjectId] = useState('');
  const [drafts, setDrafts] = useState<string[]>([]);
  const [draftPath, setDraftPath] = useState('');
  const [validated, setValidated] = useState<{ document: SapDocument; packageFingerprint: string; contentFingerprint: string } | null>(null);
  const [fault, setFault] = useState<{ code: string; message: string; detail?: string } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [reviewer, setReviewer] = useState('');
  const [busy, setBusy] = useState(false);

  const projectsRef = useRef(activeProjects);
  projectsRef.current = activeProjects;
  useEffect(() => {
    setDraftPath(''); setValidated(null); setFault(null); setChecked(new Set());
    const project = projectsRef.current.find(item => item.id === projectId);
    if (!project) { setDrafts([]); return; }
    void projectFiles(project.id).then(files => setDrafts(draftFilesOf(files))).catch(() => setDrafts([]));
  }, [projectId]);

  const validate = async () => {
    setBusy(true); setValidated(null); setFault(null); setChecked(new Set());
    try {
      const result = await metricRequest<{ document: SapDocument; packageFingerprint: string; contentFingerprint: string }>('draft/validate', 'POST', { projectId, path: draftPath });
      setValidated(result);
    } catch (caught) {
      if (caught instanceof HostRequestError) setFault({ code: caught.code, message: caught.message, ...(caught.fields?.detail ? { detail: String(caught.fields.detail) } : {}) });
      else onError('草稿校验未完成，请重试。');
    } finally { setBusy(false); }
  };

  const publish = async () => {
    setBusy(true);
    try {
      await metricRequest('publish', 'POST', { projectId, path: draftPath, publishedBy: reviewer });
      await onReload(); await onPublished();
    } catch (caught) { onError(caught instanceof HostRequestError ? caught.message : '发布未完成，请检查后重试。'); }
    finally { setBusy(false); }
  };

  const allChecked = Boolean(validated) && validated!.document.metrics.every(metric => checked.has(metric.name));
  return <section aria-label="审核发布">
    <div className="mf-panel">
      <h3>草稿来源</h3>
      <p className="mf-sub">草稿来自项目任务写入 020_clean 的 YAML；发布后草稿原样保留。</p>
      <div className="field"><label htmlFor="review-project">项目</label>
        <select id="review-project" value={projectId} onChange={event => setProjectId(event.target.value)}>
          <option value="">选择项目…</option>
          {activeProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></div>
      <div className="field"><label htmlFor="review-draft">草稿文件（020_clean）</label>
        <select id="review-draft" value={draftPath} onChange={event => setDraftPath(event.target.value)} disabled={!projectId}>
          <option value="">{drafts.length ? '选择草稿…' : projectId ? '该项目的 020_clean 暂无 YAML 文件' : '请先选择项目'}</option>
          {drafts.map(draft => <option key={draft} value={draft}>{draft}</option>)}
        </select></div>
      <div className="mf-actions"><button className="primary-button" disabled={!projectId || !draftPath || busy} onClick={() => void validate()}>校验草稿</button></div>
    </div>
    {fault && <div className="error-notice" role="alert"><div><strong>校验未通过（{fault.code}{fault.detail ? ` · ${fault.detail}` : ''}）</strong><p>{fault.message}</p></div></div>}
    {validated && <div className="mf-panel">
      <h3>人工确认</h3>
      <p className="mf-sub">{validated.document.package.id}@{validated.document.package.version} · 指标 ×{validated.document.metrics.length} · 场景 ×{validated.document.scenarios.length} · 指纹 {shortSha(validated.packageFingerprint)}</p>
      <div className="mf-review-rows">
        {validated.document.metrics.map(metric => <label key={metric.name} className={checked.has(metric.name) ? 'checked' : ''}>
          <input type="checkbox" checked={checked.has(metric.name)} onChange={event => setChecked(previous => { const next = new Set(previous); event.target.checked ? next.add(metric.name) : next.delete(metric.name); return next; })} />
          <div><strong>{metric.display_name} <code>{metric.name}</code></strong><span>{metric.definition.slice(0, 80)}{metric.definition.length > 80 ? '…' : ''}</span></div>
        </label>)}
      </div>
      <div className="field"><label htmlFor="reviewer">审核人（reviewed_by）</label>
        <input id="reviewer" value={reviewer} placeholder="确认口径后署名" onChange={event => setReviewer(event.target.value)} maxLength={200} />
        <p className="field-help">与版本一同不可变保存；Agent 起草（origin=llm）的指标未经逐项确认不能发布。</p></div>
      <div className="mf-actions">
        <span className="mf-hint">{allChecked && reviewer.trim() ? '已全部确认，可发布' : `待完成 ${validated.document.metrics.length - checked.size} 项口径确认${reviewer.trim() ? '' : '与审核人署名'}`}</span>
        <button className="primary-button" disabled={!allChecked || !reviewer.trim() || busy} onClick={() => void publish()}>发布 {validated.document.package.version} 到全局库</button>
      </div>
    </div>}
  </section>;
}

function EnableView({ activeProjects, entries, onError }: { activeProjects: ClientProject[]; entries: LibraryEntry[]; onError: (message: string) => void }) {
  const [projectId, setProjectId] = useState('');
  const [records, setRecords] = useState<EnablementRecord[]>([]);
  const [packageId, setPackageId] = useState('');
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const packageIds = useMemo(() => [...new Set(entries.map(entry => entry.id))].sort(), [entries]);
  const versions = useMemo(() => entries.filter(entry => entry.id === packageId).map(entry => entry.version).sort(compareVersion).reverse(), [entries, packageId]);

  const reload = async () => {
    if (!projectId) { setRecords([]); return; }
    try { setRecords((await metricRequest<{ records: EnablementRecord[] }>(`projects/${encodeURIComponent(projectId)}`, 'GET')).records); }
    catch (caught) { onError(caught instanceof HostRequestError ? caught.message : '启用记录读取失败。'); }
  };
  useEffect(() => { void reload(); setPackageId(''); setVersion(''); }, [projectId]);

  const enable = async () => {
    setBusy(true);
    try { await metricRequest(`projects/${encodeURIComponent(projectId)}/enable`, 'POST', { packageId, version }); await reload(); }
    catch (caught) { onError(caught instanceof HostRequestError ? caught.message : '启用未完成，请重试。'); }
    finally { setBusy(false); }
  };
  const disable = async (target: string) => {
    setBusy(true);
    try { await metricRequest(`projects/${encodeURIComponent(projectId)}/disable`, 'POST', { packageId: target }); await reload(); }
    catch (caught) { onError(caught instanceof HostRequestError ? caught.message : '停用未完成，请重试。'); }
    finally { setBusy(false); }
  };

  return <section aria-label="项目启用">
    <div className="mf-panel">
      <h3>启用资产到项目</h3>
      <p className="mf-sub">项目固定精确版本，不自动跟随新版本；升级版本在此显式操作。</p>
      <div className="field"><label htmlFor="enable-project">项目</label>
        <select id="enable-project" value={projectId} onChange={event => setProjectId(event.target.value)}>
          <option value="">选择项目…</option>
          {activeProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></div>
      {projectId && <>
        <div className="field"><label htmlFor="enable-package">资产包</label>
          <select id="enable-package" value={packageId} onChange={event => { setPackageId(event.target.value); setVersion(''); }}>
            <option value="">{packageIds.length ? '选择资产包…' : '全局库为空'}</option>
            {packageIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select></div>
        <div className="field"><label htmlFor="enable-version">版本</label>
          <select id="enable-version" value={version} onChange={event => setVersion(event.target.value)} disabled={!packageId}>
            <option value="">选择版本…</option>
            {versions.map(item => <option key={item} value={item}>{item}</option>)}
          </select></div>
        <div className="mf-actions"><button className="primary-button" disabled={!packageId || !version || busy} onClick={() => void enable()}>启用到项目</button></div>
      </>}
    </div>
    {projectId && <div className="mf-panel">
      <h3>当前项目的启用资产</h3>
      {records.length ? <table className="mf-table">
        <thead><tr><th>资产包</th><th>启用版本</th><th>启用时间</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>{records.map(record => <tr key={record.packageId}>
          <td>{record.packageId}</td>
          <td><code>{record.version}</code></td>
          <td>{dateOf(record.enabledAt)}</td>
          <td>{record.entry ? `指标 ×${record.entry.metricNames.length}` : '版本不在库中'}</td>
          <td><button className="text-button" disabled={busy} onClick={() => void disable(record.packageId)}>停用</button></td>
        </tr>)}</tbody>
      </table> : <p className="mf-sub">尚未启用任何资产包。</p>}
      <p className="mf-note">启用后该项目的分析会话将在系统提示中注入资产索引（包、版本、指标名、库文件路径），Agent 按需读取并在引用口径时注明指标与版本。</p>
    </div>}
  </section>;
}
