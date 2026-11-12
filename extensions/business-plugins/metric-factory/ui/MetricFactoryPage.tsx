import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HostRequestError, createTask as createDiskTask, projectFiles, saveDraft } from '../../../../src/host/ui/runtime-client.ts';
import type { ClientProject, ClientTask, FileNode } from '../../../../src/host/ui/project-types.ts';
import type { SapDocument } from '../sap/validate.ts';
import { PersonalDialog } from '../../../../src/host/ui/PersonalDialog.tsx';
import { MODELING_GUIDE } from '../session/modeling-guide.ts';
import { readMetricPublicationAttempts, saveMetricPublicationAttempts, type MetricPublicationAttempt } from './publication-pending.ts';

export { MODELING_GUIDE };

type LibraryEntry = { id: string; version: string; namespace: string; packageFingerprint: string; contentFingerprint: string; bytesSha256: string; bytes: number; publishedAt: string; publishedBy: string; metricNames: string[]; scenarioIds: string[] };
type EnablementRecord = { packageId: string; version: string; enabledAt: string; entry?: LibraryEntry };
type PackageUsage = { projectId: string; projectName: string; archived: boolean; version?: string; enabledAt?: string; error?: string };
type Tab = 'overview' | 'detail' | 'review' | 'enable';

async function metricRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/metric-factory/${path}`, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new HostRequestError(value.message ?? '指标资产请求未完成，请重试。', { ...(value.detail ? { detail: value.detail } : {}) }, value.code ?? 'metric_request_failed', undefined, undefined, response.status);
  return value as T;
}

const shortSha = (value: string) => `${value.slice(0, 11)}…${value.slice(-4)}`;
const dateOf = (value: string) => value.slice(0, 10);
const compareVersion = (a: string, b: string) => { const left = a.split('.').map(Number), right = b.split('.').map(Number); return left[0]! - right[0]! || left[1]! - right[1]! || left[2]! - right[2]!; };
const draftFilesOf = (files: FileNode[]): string[] => {
  const walk = (nodes: FileNode[], directory: string): string[] => nodes.flatMap(node => {
    const current = `${directory}/${node.name}`;
    if (node.kind === 'file') return /\.ya?ml$/.test(node.name) ? [current] : [];
    return walk(node.children ?? [], current);
  });
  return walk(files.find(node => node.name === '020_clean')?.children ?? [], '020_clean').sort((a, b) => a.localeCompare(b));
};

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

export function MetricFactoryPage({ projects, onOpenTask, onProjectsChanged, onBack, embedded = false, active = true, readOnly = false, enterpriseId, allowedIds, initialTarget, onTargetConsumed, onSaved, onNavigationGuard }: {
  embedded?: boolean; active?: boolean; readOnly?: boolean; enterpriseId?: string; allowedIds?: string[]; initialTarget?: { id: string; version: string }; onTargetConsumed?: () => void; onSaved?: (id: string) => void | Promise<void>; onNavigationGuard?: (guard: (() => Promise<boolean>) | null) => void;
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
  const [usage, setUsage] = useState<PackageUsage[]>([]);
  const [storedAttempts] = useState(() => { try { return { attempts: readMetricPublicationAttempts(typeof window === 'undefined' ? undefined : window.sessionStorage), error: '' }; } catch { return { attempts: [] as MetricPublicationAttempt[], error: '本标签页的原发布尝试暂存不可读；原记录保持，暂不能发起新的指标发布。请核对浏览器存储权限后刷新，其他工作仍可继续。' }; } });
  const [pendingAttempts, setPendingAttempts] = useState(storedAttempts.attempts), [attemptStorageError, setAttemptStorageError] = useState(storedAttempts.error);
  const attemptsRef = useRef(pendingAttempts); attemptsRef.current = pendingAttempts;
  const retainAttempt = (attempt: MetricPublicationAttempt) => {
    if (attemptStorageError) throw new Error(attemptStorageError);
    const next = [...attemptsRef.current, attempt];
    try { saveMetricPublicationAttempts(typeof window === 'undefined' ? undefined : window.sessionStorage, next); }
    catch { setAttemptStorageError('本标签页无法保留发布尝试，未发送本次发布；原输入保持。请核对存储权限后刷新，其他工作仍可继续。'); throw new Error('本标签页无法保留发布尝试，未发送本次发布。'); }
    attemptsRef.current = next; setPendingAttempts(next);
  };
  const settleAttempt = (attemptId: string) => {
    const next = attemptsRef.current.filter(attempt => attempt.attemptId !== attemptId);
    try { saveMetricPublicationAttempts(typeof window === 'undefined' ? undefined : window.sessionStorage, next); attemptsRef.current = next; setPendingAttempts(next); }
    catch { setAttemptStorageError('已收到原发布响应，但本标签页的旧暂存清理未核定；暂存不是原库回执，请保留核对。'); }
  };
  const [reviewState, setReviewState] = useState({ busy: false, dirty: false, uncertain: false }), [leaveOpen, setLeaveOpen] = useState(false);
  const leaveResolver = useRef<((value: boolean) => void) | null>(null);
  const handleReviewState = useCallback((next: { busy: boolean; dirty: boolean; uncertain: boolean }) => setReviewState(previous => previous.busy === next.busy && previous.dirty === next.dirty && previous.uncertain === next.uncertain ? previous : next), []);
  const allowLeave = useCallback(async () => { if (reviewState.busy) { setError('指标发布请求仍在进行，原输入保持，请先等待本次响应。'); return false; } if (!reviewState.dirty && !reviewState.uncertain) return true; if (leaveResolver.current) return false; return new Promise<boolean>(resolve => { leaveResolver.current = resolve; setLeaveOpen(true); }); }, [reviewState]);
  const finishLeave = (allowed: boolean) => { const resolve = leaveResolver.current; leaveResolver.current = null; setLeaveOpen(false); if (allowed) { setTab('overview'); setReviewState({ busy: false, dirty: false, uncertain: false }); } resolve?.(allowed); };
  useEffect(() => { onNavigationGuard?.(allowLeave); return () => onNavigationGuard?.(null); }, [allowLeave, onNavigationGuard]);
  useEffect(() => () => { leaveResolver.current?.(false); }, []);
  const [modelingOpen, setModelingOpen] = useState(false);
  const [modelingProject, setModelingProject] = useState('');
  const activeProjects = useMemo(() => projects.filter(project => project.archivedAt === null), [projects]);
  const heading = useRef<HTMLHeadingElement>(null);

  const reload = async () => {
    try { setEntries((await metricRequest<{ entries: LibraryEntry[] }>('library', 'GET')).entries); setError(''); }
    catch (caught) { setError(caught instanceof HostRequestError ? caught.message : '指标库暂时不可用，请刷新重试。'); }
  };
  useEffect(() => { if (active) void reload(); }, [active]);
  useEffect(() => { heading.current?.focus(); }, [tab]);

  const packages = useMemo(() => {
    const grouped = new Map<string, LibraryEntry[]>();
    for (const entry of entries.filter(entry => !embedded || allowedIds?.includes(entry.id))) grouped.set(entry.id, [...(grouped.get(entry.id) ?? []), entry]);
    const needle = query.trim().toLocaleLowerCase('zh-CN');
    return [...grouped.entries()]
      .map(([id, versions]) => ({ id, versions: versions.sort((a, b) => compareVersion(b.version, a.version)), latest: versions[0]! }))
      .filter(({ latest }) => !needle || [latest.id, ...latest.metricNames, ...latest.scenarioIds].join(' ').toLocaleLowerCase('zh-CN').includes(needle));
  }, [entries, query, embedded, allowedIds]);

  const openDetail = async (id: string, version: string) => {
    if (embedded && !allowedIds?.includes(id)) { setError('此指标尚未核定归属当前企业，未读取其他企业或待核内容。'); return; }
    setTab('detail');
    setUsage([]);
    try {
      const value = await metricRequest<{ entry: LibraryEntry; document: SapDocument }>(`library/${encodeURIComponent(id)}/${encodeURIComponent(version)}`, 'GET');
      if (value.entry.id !== id || value.entry.version !== version) throw new Error('指标准确版本不匹配，未改用其他版本。');
      setDetail(value);
      if (!readOnly) setUsage((await metricRequest<{ usages: PackageUsage[] }>(`usage/${encodeURIComponent(id)}`, 'GET')).usages);
      setError('');
    } catch (caught) { setError(caught instanceof HostRequestError ? caught.message : '资产包详情读取失败。'); }
  };

  useEffect(() => { if (active && initialTarget) { void openDetail(initialTarget.id, initialTarget.version).finally(() => onTargetConsumed?.()); } }, [active, initialTarget]);
  const Header = embedded ? 'h2' : 'h1';

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

  return <div className={`mf-page${embedded ? ' is-embedded' : ''}`} data-build="metric-factory-mvp">
    <div className="page-heading">
      <div>
        <p className="eyebrow">METRIC FACTORY · 分析资产</p>
        <Header ref={heading} tabIndex={-1}>{embedded ? '分析指标' : '指标体系'}</Header>
        <p>{embedded ? '与 Pi 在原项目任务中建设指标，沿原专业主库校验发布；本企业正式资产按资格供给，实际采用保留准确版本。' : '在任务中与 Pi 协作起草指标体系，审核发布到本机全局库；项目按精确版本启用，分析时引用口径并注明版本。'}</p>
      </div>
      {!embedded && <span className="mf-store">全局库 · ~/.optracall/metric-assets/</span>}
    </div>
    {error && <div className="error-notice" role="alert"><div><strong>指标体系提示</strong><p>{error}</p></div><button className="text-button" onClick={() => { setError(''); void reload(); }}>重试</button></div>}
    {notice && <p className="project-notice" role="status">{notice}<button className="text-button" onClick={() => setNotice('')}>知道了</button></p>}
    {!readOnly && attemptStorageError && <p className="error-notice" role="alert">{attemptStorageError}</p>}
    {!readOnly && pendingAttempts.some(attempt => !embedded || attempt.enterpriseId === enterpriseId) && <section aria-label="保留的指标发布尝试"><details><summary>保留的指标发布尝试 · {pendingAttempts.filter(attempt => !embedded || attempt.enterpriseId === enterpriseId).length} 项 UNKNOWN</summary><p>仅在本浏览器标签页暂存原尝试定位信息，不是 Host 或原指标主库的操作回执，不跨设备同步。查看和离开均不自动重发。</p>{pendingAttempts.filter(attempt => !embedded || attempt.enterpriseId === enterpriseId).map(attempt => <UnknownMetricPublication key={attempt.attemptId} attempt={attempt} />)}</details></section>}
    {!readOnly && <nav className="mf-tabs" role="group" aria-label="指标体系视图">
      {([['overview', '库总览'], ['detail', '包详情'], ['review', '审核发布'], ...(!embedded ? [['enable', '项目启用']] : [])] as [Tab, string][]).map(([key, label]) =>
        <button key={key} className={tab === key ? 'active' : ''} aria-pressed={tab === key} onClick={() => { void allowLeave().then(ok => { if (ok) setTab(key); }); }}>{label}</button>)}
    </nav>}

    {!readOnly && tab === 'overview' && <section aria-label="库总览">
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
      </div> : <div className="mf-empty"><h2>{query ? '没有匹配的资产包' : embedded ? '本企业尚无已关联指标' : '全局库还没有资产包'}</h2><p>{query ? '试试其他关键词。' : '在项目任务中与 Pi 协作起草指标体系草稿，然后到「审核发布」导入发布。'}</p>{!query && <button className="primary-button" onClick={() => setModelingOpen(true)} disabled={!activeProjects.length}>＋ 发起建模任务</button>}</div>}
      <p className="mf-footer">{embedded ? '发布版本不可覆盖；企业供给与当前任务实际采用分别记录，旧报告保留原依据。' : '发布即不可变：内容未变拒绝重发，版本不可覆盖 · 更新=新版本+项目显式升级'}</p>
    </section>}

    {tab === 'detail' && <section aria-label="包详情">
      {detail ? <>
        {!readOnly && <button className="text-button" onClick={() => setTab('overview')}>← 返回库总览</button>}
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
        <h3 className="mf-section-title">版本历史</h3>
        <table className="mf-table">
          <thead><tr><th>版本</th><th>发布时间</th><th>内容指纹</th><th>说明</th></tr></thead>
          <tbody>{entries.filter(entry => entry.id === detail.entry.id).sort((a, b) => compareVersion(b.version, a.version)).map(entry => <tr key={entry.version}>
            <td><code>{entry.version}</code>{entry.version === detail.entry.version ? '（当前查看）' : ''}</td>
            <td>{dateOf(entry.publishedAt)}</td>
            <td><code>{shortSha(entry.contentFingerprint)}</code></td>
            <td>{entry.version === detail.entry.version ? <button className="text-button" disabled>当前</button> : <button className="text-button" disabled={readOnly} onClick={() => void openDetail(entry.id, entry.version)}>查看</button>}</td>
          </tr>)}</tbody>
        </table>
        <p className="mf-note">版本不可变、不可覆盖；内容未变时拒绝重发。启用项目固定精确版本，不自动跟随。</p>
        {!readOnly && <><h3 className="mf-section-title">各项目启用状态</h3>
        {usage.length ? <table className="mf-table">
          <thead><tr><th>项目</th><th>启用版本</th><th>启用时间</th><th>状态</th></tr></thead>
          <tbody>{usage.map(item => <tr key={item.projectId}>
            <td>{item.projectName}{item.archived ? '（已归档）' : ''}</td>
            <td><code>{item.version ?? '—'}</code></td>
            <td>{item.enabledAt ? dateOf(item.enabledAt) : '—'}</td>
            <td>{item.error ? '启用记录异常' : item.archived ? '归档中，恢复后生效' : '启用中'}</td>
          </tr>)}</tbody>
        </table> : <p className="mf-sub">尚无项目启用此资产包。</p>}</>}
      </> : <p className="mf-footer">从库总览选择一个资产包查看详情。</p>}
    </section>}

    {!readOnly && tab === 'review' && <ReviewView enterpriseId={enterpriseId} pendingAttempts={pendingAttempts} onRetain={retainAttempt} onSettled={settleAttempt} onStateChange={handleReviewState} activeProjects={activeProjects} onPublished={async id => { if (onSaved) { try { await onSaved(id); } catch { setError('指标原版已发布，企业归属关联尚未核定；保留原发布和草稿，不自动重发。'); } } void reload(); setNotice('指标已发布，草稿仍保留在 020_clean；企业供给资格与实际使用分别核对。'); setTab('overview'); }} onError={setError} onReload={reload} />}

    {!readOnly && tab === 'enable' && <EnableView activeProjects={activeProjects} entries={entries} onError={setError} />}

    {!readOnly && modelingOpen && <dialog className="project-dialog" open aria-labelledby="modeling-title" onClose={() => setModelingOpen(false)}>
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
    {leaveOpen && <PersonalDialog title={reviewState.uncertain ? '保留未知发布尝试并离开？' : '保留未完成的指标审核？'} onClose={() => finishLeave(false)} footer={<><button type="button" className="primary-button" onClick={() => finishLeave(false)}>继续核对</button><button type="button" className="secondary-button" onClick={() => finishLeave(true)}>{reviewState.uncertain ? '保留未知并离开' : '放弃本次未提交审核'}</button></>}>{reviewState.uncertain ? <p>原尝试的准确目标、指纹、项目和草稿路径已保留在本浏览器标签页。离开不确认原请求成功或失败；返回此企业的指标管理可展开原尝试核对，其他工作可继续。</p> : <p>当前口径勾选和署名尚未提交。原项目草稿与已发布版本保持。</p>}</PersonalDialog>}
    {!embedded && <p className="mf-footer"><button className="text-button" onClick={onBack}>返回分析资产 →</button> · Agent 对全局库只读；发布与启用均为显式操作</p>}
  </div>;
}

function UnknownMetricPublication({ attempt }: { attempt: MetricPublicationAttempt }) {
  const [inspected, setInspected] = useState<{ entry: LibraryEntry; document: SapDocument }>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const inspect = async () => {
    if (busy) return; setBusy(true); setError(''); setInspected(undefined);
    try {
      const value = await metricRequest<{ entry: LibraryEntry; document: SapDocument }>(`library/${encodeURIComponent(attempt.packageId)}/${encodeURIComponent(attempt.version)}`, 'GET');
      if (value.entry.id !== attempt.packageId || value.entry.version !== attempt.version || value.entry.packageFingerprint !== attempt.packageFingerprint || value.document.package.id !== attempt.packageId || value.document.package.version !== attempt.version) throw new Error('准确目标内容未匹配。');
      if (mounted.current) setInspected(value);
    } catch { if (mounted.current) setError('尚未核到匹配的原库准确目标，原请求继续保留 UNKNOWN；不重发。'); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <article className="mf-panel"><p>原发布请求结果 UNKNOWN；此处仅核对准确目标是否存在，不重新发布。</p><details><summary>原尝试定位信息</summary><dl className="mf-meta"><div><dt>本地尝试标识（非原库回执）</dt><dd>{attempt.attemptId}</dd></div><div><dt>原项目 / 草稿路径</dt><dd>{attempt.projectId} / {attempt.path}</dd></div><div><dt>原准确目标</dt><dd>{attempt.packageId}@{attempt.version}</dd></div><div><dt>原审核指纹</dt><dd><code>{attempt.packageFingerprint}</code></dd></div><div><dt>原署名 / 尝试时间</dt><dd>{attempt.reviewer} / {attempt.attemptedAt}</dd></div></dl></details><button type="button" className="secondary-button" disabled={busy} onClick={() => { void inspect(); }}>核对准确发布版</button>{error && <p role="alert">{error}</p>}{inspected && <section aria-label="已核准确指标目标"><p role="status">原指标主库准确目标已存在，企业供给资格另核；原请求仍UNKNOWN</p><details><summary>查看已核准确目标</summary><p>{inspected.entry.id}@{inspected.entry.version} · 指纹 {shortSha(inspected.entry.packageFingerprint)}</p>{inspected.document.metrics.map(metric => <MetricCard key={metric.name} metric={metric} />)}</details></section>}</article>;
}

function ReviewView({ activeProjects, enterpriseId, pendingAttempts, onRetain, onSettled, onPublished, onError, onReload, onStateChange }: { enterpriseId?: string; pendingAttempts: MetricPublicationAttempt[]; onRetain: (attempt: MetricPublicationAttempt) => void; onSettled: (attemptId: string) => void; onStateChange?: (value: { busy: boolean; dirty: boolean; uncertain: boolean }) => void; activeProjects: ClientProject[]; onPublished: (id: string) => void | Promise<void>; onError: (message: string) => void; onReload: () => Promise<void> }) {
  const [projectId, setProjectId] = useState('');
  const [drafts, setDrafts] = useState<string[]>([]);
  const [draftPath, setDraftPath] = useState('');
  const [validated, setValidated] = useState<{ document: SapDocument; packageFingerprint: string; contentFingerprint: string } | null>(null);
  const [fault, setFault] = useState<{ code: string; message: string; detail?: string } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [reviewer, setReviewer] = useState('');
  const [uncertain, setUncertain] = useState<MetricPublicationAttempt>();
  const [busy, setBusy] = useState(false);

  useEffect(() => { onStateChange?.({ busy, dirty: Boolean(reviewer.trim() || checked.size), uncertain: Boolean(uncertain) }); }, [busy, reviewer, checked.size, uncertain, onStateChange]);
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
    if (busy || uncertain || !validated || pendingAttempts.some(attempt => attempt.packageId === validated.document.package.id && attempt.version === validated.document.package.version)) return;
    const attempt: MetricPublicationAttempt = { attemptId: crypto.randomUUID(), packageId: validated.document.package.id, version: validated.document.package.version, packageFingerprint: validated.packageFingerprint, projectId, path: draftPath, reviewer, attemptedAt: new Date().toISOString(), ...(enterpriseId ? { enterpriseId } : {}) };
    let dispatched = false, published = false;
    setBusy(true);
    try {
      onRetain(attempt);
      dispatched = true;
      await metricRequest('publish', 'POST', { projectId, path: draftPath, publishedBy: reviewer, expectedPackageFingerprint: validated.packageFingerprint });
      published = true; onSettled(attempt.attemptId);
      await onReload(); await onPublished(validated.document.package.id);
    } catch (caught) {
      if (!dispatched) onError(caught instanceof Error ? caught.message : '无法保留本标签页尝试，未发送发布请求。');
      else if (published) onError('原发布响应成功已收到，后续目录或关联未核定；不重发发布。');
      else if (!(caught instanceof HostRequestError) || (caught.status ?? 0) >= 500) { setUncertain(attempt); onError('指标发布结果 UNKNOWN。原尝试定位信息已保留在本浏览器标签页，不自动重发；可核对准确原库目标，或保留未知并离开。'); }
      else { onSettled(attempt.attemptId); onError(caught.message); }
    }
    finally { setBusy(false); }
  };

  const allChecked = Boolean(validated) && validated!.document.metrics.every(metric => checked.has(metric.name));
  const retainedTarget = Boolean(validated && pendingAttempts.some(attempt => attempt.packageId === validated.document.package.id && attempt.version === validated.document.package.version));
  return <section aria-label="审核发布">{uncertain && <UnknownMetricPublication attempt={uncertain} />}
    <div className="mf-panel">
      <h3>草稿来源</h3>
      <p className="mf-sub">草稿来自项目任务写入 020_clean 的 YAML；发布后草稿原样保留。</p>
      <div className="field"><label htmlFor="review-project">项目</label>
        <select id="review-project" disabled={busy || Boolean(uncertain)} value={projectId} onChange={event => setProjectId(event.target.value)}>
          <option value="">选择项目…</option>
          {activeProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></div>
      <div className="field"><label htmlFor="review-draft">草稿文件（020_clean）</label>
        <select id="review-draft" value={draftPath} onChange={event => setDraftPath(event.target.value)} disabled={!projectId || busy || Boolean(uncertain)}>
          <option value="">{drafts.length ? '选择草稿…' : projectId ? '该项目的 020_clean 暂无 YAML 文件' : '请先选择项目'}</option>
          {drafts.map(draft => <option key={draft} value={draft}>{draft}</option>)}
        </select></div>
      <div className="mf-actions"><button className="primary-button" disabled={!projectId || !draftPath || busy || Boolean(uncertain)} onClick={() => void validate()}>校验草稿</button></div>
    </div>
    {fault && <div className="error-notice" role="alert"><div><strong>校验未通过（{fault.code}{fault.detail ? ` · ${fault.detail}` : ''}）</strong><p>{fault.message}</p></div></div>}
    {validated && <div className="mf-panel">
      <h3>人工确认</h3>
      <p className="mf-sub">{validated.document.package.id}@{validated.document.package.version} · 指标 ×{validated.document.metrics.length} · 场景 ×{validated.document.scenarios.length} · 指纹 {shortSha(validated.packageFingerprint)}</p>
      <div className="mf-review-rows">
        {validated.document.metrics.map(metric => <label key={metric.name} className={checked.has(metric.name) ? 'checked' : ''}>
          <input type="checkbox" disabled={busy || Boolean(uncertain)} checked={checked.has(metric.name)} onChange={event => setChecked(previous => { const next = new Set(previous); event.target.checked ? next.add(metric.name) : next.delete(metric.name); return next; })} />
          <div><strong>{metric.display_name} <code>{metric.name}</code></strong><span>{metric.definition.slice(0, 80)}{metric.definition.length > 80 ? '…' : ''}</span></div>
        </label>)}
      </div>
      <div className="field"><label htmlFor="reviewer">审核人（reviewed_by）</label>
        <input id="reviewer" disabled={busy || Boolean(uncertain)} value={reviewer} placeholder="确认口径后署名" onChange={event => setReviewer(event.target.value)} maxLength={200} />
        <p className="field-help">与版本一同不可变保存；Agent 起草（origin=llm）的指标未经逐项确认不能发布。</p></div>
      <div className="mf-actions">
        <span className="mf-hint">{allChecked && reviewer.trim() ? '已全部确认，可发布' : `待完成 ${validated.document.metrics.length - checked.size} 项口径确认${reviewer.trim() ? '' : '与审核人署名'}`}</span>
        <button className="primary-button" disabled={!allChecked || !reviewer.trim() || busy || Boolean(uncertain) || retainedTarget} onClick={() => void publish()}>发布 {validated.document.package.version} 到全局库</button>
      </div>
      {retainedTarget && !uncertain && <p className="mf-note">此准确指标版本已有保留的 UNKNOWN 尝试，请从上方原尝试核对；不会再次提交。其他准确目标可独立审核。</p>}
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
