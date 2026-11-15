import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { DbLinkBudget, DbLinkConnectionInput, DbLinkPublicConnection, DbLinkTestReceipt } from '../db-link-types.ts';
import { dbLinkLimitation, dbLinkError, DbLinkRequestError, listDbConnections, saveDbConnection, testDbConnection } from './db-link-client.ts';
import './db-link.css';

export function DbLinkDialog({ title, onClose, children, wide = false, returnFocusTo }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; returnFocusTo?: HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useId();
  useEffect(() => {
    const trigger = returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialog.current?.showModal();
    return () => { dialog.current?.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className={`catalog-dialog db-link-dialog${wide ? ' db-link-wide' : ''}`} aria-labelledby={heading} onClose={onClose}>
    <header className="db-link-heading"><h2 id={heading}>{title}</h2><button type="button" className="icon-button" aria-label={`关闭${title}`} onClick={() => dialog.current?.close()}>✕</button></header>{children}
  </dialog>;
}

const defaultBudget: DbLinkBudget = { connectTimeoutMs: 10000, queryTimeoutMs: 30000, lockTimeoutMs: 3000, maxRows: 10000, maxBytes: 16777216, maxCellBytes: 1048576, chunkBytes: 1048576, maxConcurrent: 2 };
const emptyConfiguration = (): DbLinkConnectionInput => ({ name: '', engine: 'postgresql', host: '', port: 5432, database: '', username: '', password: '', tls: { rejectUnauthorized: true, verifyIdentity: true }, budget: { ...defaultBudget } });
const budgetLabels: Record<keyof DbLinkBudget, string> = { connectTimeoutMs: '连接超时（毫秒）', queryTimeoutMs: '查询截止（毫秒）', lockTimeoutMs: '锁等待上限（毫秒）', maxRows: '返回行数上限', maxBytes: '返回总字节上限', maxCellBytes: '单值字节上限', chunkBytes: '结果分块字节上限', maxConcurrent: '并发操作上限' };
export const dbConnectionStatus = (value: DbLinkPublicConnection): string => value.observation.queryQualified ? '已连通 · 查询已准入' : '已连通 · 查询未准入';

export function DbLinkConnections({ open, onClose, onChanged, readOnly = false }: { open: boolean; onClose: () => void; onChanged?: () => void; readOnly?: boolean }) {
  const readOnlyNow = useRef(readOnly); readOnlyNow.current = readOnly;
  const [connections, setConnections] = useState<DbLinkPublicConnection[]>([]), [editing, setEditing] = useState(false);
  const [configuration, setConfiguration] = useState<DbLinkConnectionInput>(emptyConfiguration), draft = useRef(configuration);
  const [receipt, setReceipt] = useState<DbLinkTestReceipt>(), [pending, setPending] = useState<'test' | 'save' | 'read'>();
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [unknownFingerprint, setUnknownFingerprint] = useState<string>();
  const errorId = useId(), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return; const controller = new AbortController();
    void listDbConnections(controller.signal).then(value => { if (!controller.signal.aborted) setConnections(value); }, reason => { if (!controller.signal.aborted) setError(dbLinkError(reason)); });
    return () => controller.abort();
  }, [open]);
  useEffect(() => { if (!receipt) return; const timer = window.setTimeout(() => { setReceipt(undefined); setNotice('本次测试已过期，请重新测试后保存。'); }, Math.max(0, Date.parse(receipt.expiresAt) - Date.now())); return () => window.clearTimeout(timer); }, [receipt]);
  const change = (next: DbLinkConnectionInput) => { draft.current = next; setConfiguration(next); setReceipt(undefined); setNotice('配置已修改，保存前需重新测试。'); setError(''); };
  const begin = (connection?: DbLinkPublicConnection) => {
    if (pending || unknownFingerprint || readOnlyNow.current) return;
    const next = connection ? { id: connection.id, name: connection.name, engine: connection.engine, host: connection.host, port: connection.port, database: connection.database, username: connection.username, tls: { rejectUnauthorized: true as const, verifyIdentity: true as const }, budget: { ...connection.budget } } : emptyConfiguration();
    draft.current = next; setConfiguration(next); setReceipt(undefined); setError(''); setNotice(''); setEditing(true);
  };
  const test = async () => {
    if (pending || unknownFingerprint || readOnlyNow.current) return;
    const captured = configuration, identity = JSON.stringify(captured); setPending('test'); setError(''); setReceipt(undefined);
    try {
      const tested = await testDbConnection(captured); if (!mounted.current) return;
      if (JSON.stringify(draft.current) !== identity) { setNotice('测试期间配置已变化，本次回执不能用于保存。'); return; }
      setReceipt(tested); setNotice(tested.queryQualified ? '确切配置已通过连接与查询准入核对。' : '连接可达；查询能力仍受下列准入限制。');
    } catch (reason) { if (mounted.current) setError(dbLinkError(reason)); }
    finally { if (mounted.current) setPending(undefined); }
  };
  const save = async () => {
    if (pending || unknownFingerprint || readOnlyNow.current || !receipt || Date.parse(receipt.expiresAt) <= Date.now()) return;
    const captured = receipt; setPending('save'); setError('');
    try {
      const saved = await saveDbConnection(configuration, captured.id, captured.fingerprint); if (!mounted.current) return;
      setConnections(previous => [...previous.filter(item => item.id !== saved.id), saved]); setEditing(false); setReceipt(undefined); setNotice('已保存确切配置；项目授权分别管理。'); onChanged?.();
    } catch (reason) { if (mounted.current) { setError(dbLinkError(reason)); if (reason instanceof DbLinkRequestError && reason.uncertain) setUnknownFingerprint(captured.fingerprint); } }
    finally { if (mounted.current) setPending(undefined); }
  };
  const reconcile = async () => {
    if (!unknownFingerprint || pending) return; setPending('read');
    try {
      const values = await listDbConnections(); if (!mounted.current) return; setConnections(values);
      if (values.some(item => item.fingerprint === unknownFingerprint)) { setUnknownFingerprint(undefined); setReceipt(undefined); setEditing(false); setError(''); setNotice('已读取到原保存的确切配置，保存完成。'); onChanged?.(); }
      else setError('尚未读取到该确切配置，保存结果仍为 UNKNOWN；未重新提交。');
    } catch (reason) { if (mounted.current) setError(dbLinkError(reason)); }
    finally { if (mounted.current) setPending(undefined); }
  };
  if (!open) return null;
  return <DbLinkDialog title="数据库连接" onClose={onClose} wide>
    <p className="db-link-muted">配置一次，项目分别授权。授权后的任务可直接提问，无需逐条批准查询。</p>
    {readOnly && <p className="db-link-warning" role="status">来源项目已归档，此窗口只读；现有连接依据保持。</p>}
    <div className="db-link-toolbar"><span>{connections.length} 个共享连接</span><button type="button" className="secondary-button" disabled={readOnly || Boolean(pending || unknownFingerprint)} onClick={() => begin()}>添加连接</button></div>
    {!connections.length && !editing && <p className="db-link-empty">尚未配置数据库。添加 PostgreSQL 或 MySQL 连接后，在项目资料区授权使用。</p>}
    <ul className="db-link-list">{connections.map(connection => <li key={connection.id} className="db-link-connection">
      <div className="db-link-heading"><strong>{connection.name}</strong><button type="button" className="text-button" disabled={readOnly || Boolean(pending || unknownFingerprint)} onClick={() => begin(connection)}>配置</button></div>
      <p>{connection.engine === 'postgresql' ? 'PostgreSQL' : 'MySQL'} · 修订 {connection.revision} <span className="db-link-status">{dbConnectionStatus(connection)}</span></p>
      <p className="db-link-mono">{connection.host}:{connection.port} / {connection.database}</p>
      {connection.observation.limitations.length > 0 && <ul className="db-link-limitations">{connection.observation.limitations.map((item, index) => <li key={index}>{dbLinkLimitation(item)}</li>)}</ul>}
      <details><summary>连接身份与测试依据</summary><dl className="db-link-definition"><dt>源身份</dt><dd>{connection.observation.sourceIdentity}</dd><dt>实际权限绑定</dt><dd>{connection.observation.permissionBinding}</dd><dt>测试时间</dt><dd>{new Date(connection.testedAt).toLocaleString()}</dd><dt>TLS</dt><dd>证书链与 DNS 目标名均须核验{connection.tls.hasCa ? ' · 已保存 CA' : ' · 系统 CA'}</dd><dt>取消能力</dt><dd>{connection.observation.cancelCapability === 'verified' ? '所属取消已核对' : '尚未证明服务端终止'}</dd></dl></details>
    </li>)}</ul>
    {editing && <form className="db-link-form" aria-busy={Boolean(pending)} onSubmit={event => { event.preventDefault(); void test(); }}>
      <h3>{configuration.id ? '修改连接配置' : '添加命名连接'}</h3>
      <p className="db-link-muted">密码只由 Host 保存。连通、查询准入与业务正确性分别核定。</p>
      <fieldset disabled={readOnly || pending === 'save' || Boolean(unknownFingerprint)} className="db-link-fields" aria-describedby={errorId}><legend className="sr-only">连接信息</legend>
        <label>连接名称<input required maxLength={80} value={configuration.name} aria-describedby={errorId} onChange={event => change({ ...configuration, name: event.target.value })} /></label>
        <label>数据库类型<select value={configuration.engine} onChange={event => change({ ...configuration, engine: event.target.value as DbLinkConnectionInput['engine'], port: event.target.value === 'mysql' ? 3306 : 5432 })}><option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option></select></label>
        <label>DNS 主机名<input required value={configuration.host} placeholder="db.example.com" aria-describedby={errorId} onChange={event => change({ ...configuration, host: event.target.value })} /></label>
        <label>端口<input type="number" required min={1} max={65535} value={configuration.port} onChange={event => change({ ...configuration, port: Number(event.target.value) })} /></label>
        <label>数据库名<input required value={configuration.database} onChange={event => change({ ...configuration, database: event.target.value })} /></label>
        <label>受限用户名<input required autoComplete="off" value={configuration.username} onChange={event => change({ ...configuration, username: event.target.value })} /></label>
        <label className="db-link-full">密码{configuration.id && <small>留空保留同一目标的原凭据</small>}<input type="password" required={!configuration.id} autoComplete="new-password" value={configuration.password ?? ''} onChange={event => change({ ...configuration, password: event.target.value || undefined })} /></label>
      </fieldset>
      <details><summary>TLS 与资源预算</summary><p className="db-link-muted">强制验证证书链和 DNS 目标名；不接受关闭验证或任意连接串参数。</p><label>CA 证书（可选）<textarea value={configuration.tls.ca ?? ''} disabled={readOnly || pending === 'save' || Boolean(unknownFingerprint)} placeholder={configuration.id ? '留空保留原 CA；系统 CA 无需填写' : '使用系统 CA 时留空'} onChange={event => change({ ...configuration, tls: { ...configuration.tls, ca: event.target.value || undefined } })} /></label><fieldset className="db-link-fields" disabled={readOnly || pending === 'save' || Boolean(unknownFingerprint)}><legend className="sr-only">资源预算</legend>{(Object.keys(budgetLabels) as (keyof DbLinkBudget)[]).map(key => <label key={key}>{budgetLabels[key]}<input type="number" required min={1} value={configuration.budget[key]} onChange={event => change({ ...configuration, budget: { ...configuration.budget, [key]: Number(event.target.value) } })} /></label>)}</fieldset></details>
      {receipt && <div className="db-link-callout" role="status"><strong>{receipt.queryQualified ? '连接与查询准入已核对' : '已连通，查询尚未准入'}</strong><p>本回执仅适用于当前配置，有效至 {new Date(receipt.expiresAt).toLocaleTimeString()}。</p>{receipt.limitations.length > 0 && <ul>{receipt.limitations.map((item, index) => <li key={index}>{dbLinkLimitation(item)}</li>)}</ul>}</div>}
      <div className="db-link-actions"><button type="button" className="secondary-button" disabled={readOnly || Boolean(pending || unknownFingerprint)} onClick={() => setEditing(false)}>取消编辑</button><button type="submit" className="secondary-button" disabled={readOnly || Boolean(pending || unknownFingerprint)}>{pending === 'test' ? '正在测试…' : '测试连接'}</button><button type="button" className="primary-button" disabled={readOnly || !receipt || Boolean(pending || unknownFingerprint)} onClick={() => { void save(); }}>{pending === 'save' ? '正在保存…' : '保存已测配置'}</button></div>
      {!receipt && <p className="db-link-muted">保存前请测试当前配置；修改字段会使原测试失效。</p>}
    </form>}
    <p id={errorId} className={error ? 'db-link-callout db-link-error' : 'db-link-muted'} role={error ? 'alert' : 'status'} aria-live="polite">{error || notice}</p>
    {unknownFingerprint && <button type="button" className="secondary-button" disabled={Boolean(pending)} onClick={() => { void reconcile(); }}>读取原保存结果</button>}
  </DbLinkDialog>;
}
