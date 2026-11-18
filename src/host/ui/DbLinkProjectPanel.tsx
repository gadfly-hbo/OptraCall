import { useEffect, useId, useRef, useState } from 'react';
import type { ClientProject } from './project-types.ts';
import type { DbLinkModelExport, DbLinkProjectGrantInput, DbLinkPublicConnection, DbLinkSource } from '../db-link-types.ts';
import type { DbResultCell, DbResultReceipt } from '../db-link-results.ts';
import { DbLinkDialog, dbConnectionStatus } from './DbLinkConnections.tsx';
import { dbLinkLimitation, dbLinkError, DbLinkRequestError, grantDbSource, listDbConnections, listDbResults, listDbSources, readDbResult, revokeDbSource, updateDbTaskSource, prepareDbGrant, dbGrantMatches, dbModelTargetAllowed, type DbLinkResultDetail, type DbLinkTaskSources } from './db-link-client.ts';

type Props = {
  project: ClientProject; taskId?: string; refreshToken: number; modelTarget?: string;
  onManageConnections: () => void; onOpenDataContext?: (trigger: HTMLButtonElement) => void; onOpenStudio?: () => void;
};
const emptyExport = (target?: string): DbLinkModelExport => ({ targets: target ? [target] : [], structure: true, comments: true, queryText: true, results: true });
const contentLabels = { structure: '结构与字段', comments: '注释', queryText: 'SQL 与参数', results: '样例与查询结果' } as const;
const resultStatus = (value: DbResultReceipt): string => value.status === 'complete' ? '本次结果已完整保存' : value.status === 'partial' ? '部分结果 · 不完整' : value.status === 'cancelled' ? '已请求取消 · 结果不完整' : '获取失败 · 原记录保留';
const cellText = (cell: DbResultCell): string => cell === null ? 'NULL' : typeof cell === 'string' ? cell : cell.type === 'binary' ? `[二进制 base64] ${cell.base64}` : cell.type === 'segmented' ? `[分段值 · ${cell.bytes} 字节 · 正文未展开]` : cell.value;

export function DbLinkProjectPanel({ project, taskId, refreshToken, modelTarget, onManageConnections, onOpenDataContext, onOpenStudio }: Props) {
  const context = `${project.id}/${taskId ?? ''}`, visible = useRef(context); visible.current = context;
  const projectNow = useRef(project); projectNow.current = project;
  const [state, setState] = useState<DbLinkTaskSources>({ sources: [], projectSources: [] }), [results, setResults] = useState<DbResultReceipt[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [grantOpen, setGrantOpen] = useState(false), [connections, setConnections] = useState<DbLinkPublicConnection[]>([]), [connectionId, setConnectionId] = useState('');
  const [objectText, setObjectText] = useState(''), [targetText, setTargetText] = useState(''), [exportContent, setExportContent] = useState(emptyExport(modelTarget));
  const [writing, setWriting] = useState(false), [uncertain, setUncertain] = useState(false), [mutatingSources, setMutatingSources] = useState<string[]>([]);
  const unknownGrant = useRef<DbLinkProjectGrantInput | undefined>(undefined), previousContext = useRef(context);
  const [detail, setDetail] = useState<DbLinkResultDetail>(), [detailLoading, setDetailLoading] = useState(false);
  const grantErrorId = useId(), targetsId = useId(), detailRequest = useRef<AbortController | undefined>(undefined), detailTrigger = useRef<HTMLButtonElement | null>(null);
  const archived = Boolean(project.archivedAt);
  const selectedModel = (taskId ? project.tasks.find(task => task.id === taskId)?.configuration : project.configuration), selectedReference = selectedModel ? `${selectedModel.id}@${selectedModel.revision}` : undefined;
  const currentModelTarget = state.currentModelTarget?.reference === selectedReference ? state.currentModelTarget : undefined;
  const isCurrent = (captured: string) => visible.current === captured;
  const refresh = async (captured = context) => {
    const [sources, observedResults] = await Promise.all([listDbSources(project.id, taskId), listDbResults(project.id, taskId)]);
    if (isCurrent(captured)) { setState(sources); setResults(observedResults); }
  };
  useEffect(() => {
    const controller = new AbortController(), captured = context; setLoading(true);
    if (previousContext.current !== context) { setState({ sources: [], projectSources: [] }); setResults([]); setDetail(undefined); setGrantOpen(false); setError(''); setNotice(''); setUncertain(false); unknownGrant.current = undefined; setWriting(false); setMutatingSources([]); }
    previousContext.current = context;
    void Promise.all([listDbSources(project.id, taskId, controller.signal), listDbResults(project.id, taskId, controller.signal)]).then(([sources, observedResults]) => { if (!controller.signal.aborted && isCurrent(captured)) { setState(sources); setResults(observedResults); } }, reason => { if (!controller.signal.aborted && isCurrent(captured)) setError(dbLinkError(reason)); }).finally(() => { if (!controller.signal.aborted && isCurrent(captured)) setLoading(false); });
    return () => { controller.abort(); detailRequest.current?.abort(); };
  }, [context, refreshToken, selectedReference]);
  const beginGrant = async (source?: DbLinkSource) => {
    if (projectNow.current.archivedAt || uncertain) { setError(uncertain ? '原授权结果尚未核定，请先读取原记录。' : '项目已归档，只能查看现有授权。'); return; }
    const captured = context; setError('');
    try {
      const available = await listDbConnections(); if (!isCurrent(captured)) return;
      setConnections(available); setConnectionId(source?.connection.id ?? ''); setObjectText(source?.scope.objects.join('\n') ?? '');
      const exporter = source?.modelExport ?? emptyExport(currentModelTarget?.reference ?? selectedReference); setExportContent(exporter); setTargetText(exporter.targets.join('\n')); setUncertain(false); setGrantOpen(true);
    } catch (reason) { if (isCurrent(captured)) setError(dbLinkError(reason)); }
  };
  const grant = async () => {
    if (writing || uncertain || projectNow.current.archivedAt) return;
    const captured = context, selected = connections.find(item => item.id === connectionId), objects = objectText.split(/[\n,，]/).map(value => value.trim()).filter(Boolean), targets = targetText.split(/[\n,，]/).map(value => value.trim()).filter(Boolean);
    if (!selected || !objects.length || !targets.length || targets.includes('*')) { setError('请选择连接，并明确对象范围及模型配置标识；不能填写任意模型通配符。'); return; }
    const input: DbLinkProjectGrantInput = { connectionId, connectionRevision: selected.revision, scope: { objects }, modelExport: { ...exportContent, targets } };
    let expected: DbLinkProjectGrantInput | undefined;
    setWriting(true); setError('');
    try {
      const prepared = await prepareDbGrant(project.id, input); if (!isCurrent(captured) || projectNow.current.archivedAt) return;
      expected = prepared.expected;
      await grantDbSource(project.id, prepared.input);
      if (!isCurrent(captured)) return; await refresh(captured); if (!isCurrent(captured)) return; setGrantOpen(false); setNotice('本项目范围与模型出口已授权；任务默认继承。');
    } catch (reason) { if (isCurrent(captured)) { setError(dbLinkError(reason)); if (expected && reason instanceof DbLinkRequestError && reason.uncertain) { unknownGrant.current = expected; setUncertain(true); } } }
    finally { if (isCurrent(captured)) setWriting(false); }
  };
  const reconcileGrant = async () => {
    const expected = unknownGrant.current, captured = context; if (!expected) return;
    try {
      const current = await listDbSources(project.id, taskId); if (!isCurrent(captured)) return; setState(current);
      const observed = current.projectSources.find(source => source.connection.id === expected.connectionId && source.connection.revision === expected.connectionRevision && !source.grant.revokedAt);
      if (dbGrantMatches(observed, expected)) {
        unknownGrant.current = undefined; setUncertain(false); setGrantOpen(false); setError(''); setNotice('已读取到原授权的确切范围与模型出口；原请求未重发。');
      } else setError('尚未读取到原授权的确切范围与出口，结果仍为 UNKNOWN；未重新提交。');
    } catch (reason) { if (isCurrent(captured)) setError(dbLinkError(reason)); }
  };
  const changeSource = async (source: DbLinkSource, action: 'revoke' | 'exclude' | 'include') => {
    if (projectNow.current.archivedAt) { setError('项目已归档，不能修改授权。'); return; }
    const captured = context, id = source.connection.id; setMutatingSources(previous => [...previous, id]); setError('');
    try {
      if (action === 'revoke') await revokeDbSource(project.id, id);
      else if (taskId) await updateDbTaskSource(project.id, taskId, id, { excluded: action === 'exclude' });
      if (!isCurrent(captured)) return; await refresh(captured); if (!isCurrent(captured)) return;
      setNotice(action === 'revoke' ? '本项目已撤权，新派发被拒绝；已有材料保留。原查询的服务端收尾另行核定。' : action === 'exclude' ? '当前任务已排除此来源；其他任务与项目授权保持。' : '当前任务已恢复继承项目授权。');
    } catch (reason) { if (isCurrent(captured)) setError(dbLinkError(reason)); }
    finally { if (isCurrent(captured)) setMutatingSources(previous => previous.filter(value => value !== id)); }
  };
  const showResult = async (id: string, trigger: HTMLButtonElement) => {
    detailTrigger.current = trigger;
    detailRequest.current?.abort(); const controller = new AbortController(); detailRequest.current = controller;
    const captured = context; setDetailLoading(true); setError('');
    try { const value = await readDbResult(project.id, id, taskId, controller.signal); if (!controller.signal.aborted && isCurrent(captured)) setDetail(value); }
    catch (reason) { if (!controller.signal.aborted && isCurrent(captured)) setError(dbLinkError(reason)); }
    finally { if (!controller.signal.aborted && isCurrent(captured)) setDetailLoading(false); }
  };
  return <section className="db-link-project" aria-label="项目数据库资料" aria-busy={loading}>
    <div className="db-link-heading"><h3>数据库</h3><button type="button" className="text-button" onClick={onManageConnections}>共享连接</button></div>
    <p className="db-link-muted">任务默认继承项目来源，可仅在此任务排除。直接在对话中提出分析问题。</p>
    {loading && <p role="status">正在读取本项目来源…</p>}
    {!loading && !state.projectSources.length && <p className="db-link-empty">本项目尚未授权数据库。已有文件仍可继续分析。</p>}
    <ul className="db-link-list">{state.projectSources.map(source => {
      const active = state.sources.find(item => item.connection.id === source.connection.id), revoked = Boolean(source.grant.revokedAt), excluded = !revoked && Boolean(taskId) && !active;
      const pending = mutatingSources.includes(source.connection.id), exportAllowed = dbModelTargetAllowed(currentModelTarget, active ?? source);
      return <li key={source.grant.id} className="db-link-source">
        <strong>{source.connection.name}</strong><p className="db-link-muted">修订 {source.connection.revision} · {revoked ? '本项目已撤权' : source.configurationChanged ? '配置已有变化，需核对授权' : excluded ? '本任务已排除' : '继承项目授权'}</p>
        <p className="db-link-status">{dbConnectionStatus(source.connection)}</p>
        {!source.connection.observation.queryQualified && <p className="db-link-warning">{source.connection.observation.limitations.map(dbLinkLimitation).join('；') || '当前配置尚未满足读取条件，不能派发查询。'}</p>}
        {!exportAllowed && !revoked && <p className="db-link-warning">{currentModelTarget ? '当前模型配置不在此来源出口中；请核对后明确调整授权。' : '当前模型出口尚未核定，请刷新后核对。'}</p>}
        <details><summary>范围与模型出口</summary><p className="db-link-mono">{(active?.scope ?? source.scope).objects.join('、')}</p><p>允许模型：{(active?.modelExport ?? source.modelExport).targets.join('、') || '无'}</p><p className="db-link-muted">对象范围由原生权限与受信执行约束共同落实；授权记录不代替实际权限证明。</p></details>
        <div className="db-link-actions"><button type="button" className="text-button" disabled={archived || writing || uncertain} onClick={() => { void beginGrant(source); }}>{revoked ? '重新授权' : '调整授权'}</button>{!revoked && <button type="button" className="text-button db-link-danger" disabled={archived || pending} onClick={() => { void changeSource(source, 'revoke'); }}>撤销本项目资格</button>}</div>
        {taskId && !revoked && <label className="db-link-check"><input type="checkbox" checked={excluded} disabled={archived || pending} onChange={event => { void changeSource(source, event.target.checked ? 'exclude' : 'include'); }} /><span>仅此任务排除</span></label>}
      </li>;
    })}</ul>
    <button type="button" className="secondary-button" disabled={archived || writing || uncertain} onClick={() => { void beginGrant(); }}>引用连接并授权</button>
    {archived && <p className="db-link-warning">归档只读：保留来源和结果；禁止新查询与授权变更。</p>}
    <div className="db-link-heading db-link-result-heading"><h3>查询结果与来源</h3><button type="button" className="text-button" disabled={loading} onClick={() => { const captured = context; void refresh(captured).catch(reason => { if (isCurrent(captured)) setError(dbLinkError(reason)); }); }}>刷新</button></div>
    {!results.length && !loading && <p className="db-link-muted">尚无本任务结果。Agent 可按问题自主发现、取数和保存采用依据，无需先填写数据说明或进入 Studio。</p>}
    <ul className="db-link-list">{results.map(result => <li key={result.id} className="db-link-result"><button type="button" className="text-button db-link-mono" disabled={detailLoading} onClick={event => { void showResult(result.id, event.currentTarget); }}>{result.id}</button><p>{resultStatus(result)}</p><small>{result.rows} 行 · {result.bytes.toLocaleString()} 字节</small>{result.status !== 'complete' && <p className="db-link-warning">不能将局部结果当作完整总体或完整取数验证。</p>}</li>)}</ul>
    <div className="db-link-actions">{onOpenDataContext && <button type="button" className="text-button" onClick={event => onOpenDataContext(event.currentTarget)}>数据说明 / 来源</button>}{onOpenStudio && <button type="button" className="text-button" onClick={onOpenStudio}>前往 Studio</button>}</div>
    <p className="db-link-muted">报告计算复核沿原父请求；结论建议审查沿原入口。取数覆盖与固定结果上的重算分别表达。</p>
    {(error || notice) && <p className={error ? 'db-link-callout db-link-error' : 'db-link-callout'} role={error ? 'alert' : 'status'}>{error || notice}</p>}
    {grantOpen && <DbLinkDialog title="授权项目使用数据库" onClose={() => setGrantOpen(false)}>
      <p>当前项目：<strong>{project.name}</strong>。范围与模型出口一次明确，后续普通读取无需逐条确认。</p>
      {archived && <p className="db-link-warning" role="alert">项目已归档，此窗口只读，不能提交授权。</p>}
      <form onSubmit={event => { event.preventDefault(); void grant(); }}>
        <fieldset disabled={archived || writing || uncertain} className="db-link-fields db-link-single"><legend className="sr-only">项目授权</legend>
          <label>共享连接<select required value={connectionId} aria-describedby={grantErrorId} onChange={event => setConnectionId(event.target.value)}><option value="">请选择连接</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name} · 修订 {connection.revision}</option>)}</select></label>
          <label>允许对象范围<textarea required value={objectText} aria-describedby={grantErrorId} placeholder={'完整 schema.表名，每行一项\n仅明确允许全部原生范围时填写 *'} onChange={event => setObjectText(event.target.value)} /></label>
          <label>允许的模型配置标识<textarea required value={targetText} aria-describedby={grantErrorId} placeholder="每行一个准确配置标识" onChange={event => setTargetText(event.target.value)} /></label>
          {(selectedReference ?? modelTarget) && <p className="db-link-muted">当前任务模型配置：<code id={targetsId}>{selectedReference ?? modelTarget}</code>。扩大出口须明确提交授权。</p>}
          <div>{(Object.keys(contentLabels) as (keyof typeof contentLabels)[]).map(key => <label key={key} className="db-link-check"><input type="checkbox" checked={exportContent[key]} onChange={event => setExportContent(previous => ({ ...previous, [key]: event.target.checked }))} /><span>{contentLabels[key]}可进入已选模型</span></label>)}</div>
        </fieldset>
        <p className="db-link-muted">连接密码不进入模型。共享定义不附带活库权限或其他项目明细。</p>
        <p id={grantErrorId} className={error ? 'db-link-error' : 'db-link-muted'} role={error ? 'alert' : undefined}>{error}</p>
        {uncertain && <button type="button" className="secondary-button" onClick={() => { void reconcileGrant(); }}>读取原授权结果</button>}
        <div className="db-link-actions"><button type="button" className="secondary-button" onClick={() => setGrantOpen(false)}>关闭</button><button type="submit" className="primary-button" disabled={archived || writing || uncertain}>{writing ? '正在保存…' : '确认项目范围与模型出口'}</button></div>
      </form>
    </DbLinkDialog>}
    {detail && <DbLinkDialog title="查询结果与准确来源" onClose={() => setDetail(undefined)} returnFocusTo={detailTrigger.current} wide>
      <p className={detail.receipt.status === 'complete' ? 'db-link-callout' : 'db-link-callout db-link-warning'}>{resultStatus(detail.receipt)}。{detail.manifest.reason ?? ''}</p>
      <dl className="db-link-definition"><dt>结果版本</dt><dd>{detail.receipt.id}</dd><dt>项目 / 任务</dt><dd>{detail.receipt.owner.projectId} / {detail.receipt.owner.taskId}</dd><dt>来源配置</dt><dd>{detail.manifest.source.connectionId} · 修订 {detail.manifest.source.connectionRevision}</dd><dt>实际源身份</dt><dd>{detail.manifest.source.sourceIdentity}</dd><dt>原生数据库版本号</dt><dd>{detail.manifest.source.session.serverVersionNum ?? '未知'}</dd><dt>登录 / 有效身份</dt><dd>{detail.manifest.source.session.loginRole ?? '未知'} / {detail.manifest.source.session.effectiveRole ?? '未知'}</dd><dt>可见范围</dt><dd>{detail.manifest.source.session.visibleScope === 'current-account-visible' ? '当前账号可见数据；视图或行级权限可能进一步限制范围' : '未知；旧记录未捕获账号范围'}</dd><dt>获取时段</dt><dd>{detail.manifest.source.startedAt} — {detail.manifest.finishedAt}</dd><dt>驱动已解码</dt><dd>{detail.manifest.acquisition?.driverReceivedRows ?? '未知'} 行</dd><dt>交付结果存储 / 已保存</dt><dd>{detail.manifest.receivedRows} / {detail.manifest.persistedRows} 行</dd><dt>服务端总行数</dt><dd>{detail.manifest.serverRowCount ?? '未知'}</dd><dt>一致性依据</dt><dd>{detail.manifest.source.session.snapshot ?? '未取得可复现快照；获取时间不代表数据库快照'}</dd><dt>材料位置</dt><dd>{detail.receipt.relativePath}</dd></dl>
      <p className="db-link-muted">隐藏数据、视图底表和取数总体的完整性未经核查；本次材料只支持已提供范围内的分析。当前原生验证范围为 PostgreSQL 18.1。</p>
      {Boolean(detail.manifest.source.limitations?.length) && <details><summary>来源范围与技术限制</summary><ul>{detail.manifest.source.limitations!.map((limitation, index) => <li key={index}>{dbLinkLimitation(limitation)}</li>)}</ul></details>}
      <details><summary>SQL、参数与对象依据</summary><pre>{detail.manifest.source.sql}</pre><pre>{JSON.stringify(detail.manifest.source.parameters, null, 2)}</pre><p>实际观察：{detail.manifest.source.observedObjects.join('、') || '未知'}</p><p>Agent 声明依赖：{detail.manifest.source.declaredObjects.join('、') || '未声明'}</p><p>未覆盖 / 未知：{detail.manifest.source.unknownObjects.join('、') || '未另行列出；不推断完整血缘'}</p></details>
      <div className="db-link-table-wrap"><table><caption>已保存结果预览 · {detail.rowsPreview.length} 行，预览不代表全部材料已读取</caption><thead><tr>{detail.manifest.columns.map(column => <th key={column.ordinal} scope="col">{column.name}<small>{column.databaseType} · 精度 {column.precision ?? '未知'} / 标度 {column.scale ?? '未知'}</small></th>)}</tr></thead><tbody>{detail.rowsPreview.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cellText(cell)}</td>)}</tr>)}</tbody></table></div>
      <p className="db-link-muted">固定结果上的重算只核这些输入；不能据此证明原 SQL 没有漏对象、期间、关联或过滤。</p>
    </DbLinkDialog>}
  </section>;
}
