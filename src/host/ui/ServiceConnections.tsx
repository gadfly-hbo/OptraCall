import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { SERVICE_IDS, SERVICE_SCOPES, SERVICE_URLS, TENCENT_MAIL_SERVERS, type ServiceConnection, type ServiceConnectionConfig, type ServiceConnectionCredentials, type ServiceId, type ServiceScope } from '../service-connection-types.ts';
import { actOnServiceConnection, cancelServiceAuthorization, listServiceConnections, readServiceConnection, saveServiceConnection, serviceAuthorizationObservation, serviceConnectionErrorText, serviceMailboxLabel, serviceNames, serviceScopeSelection, serviceScopeSummary, serviceStateLabels, type ServiceAuthorization, type ServiceConnectionSnapshot } from './service-connections-client.ts';
import './service-connections.css';
export { TaskServiceConnections } from './TaskServiceConnections.tsx';

const descriptions: Record<ServiceId, string> = {
  github: '查找仓库、Issue、PR 与 Actions；按所选范围参与协作。',
  gmail: '搜索和阅读邮件，按需开启草稿、标签与发送能力。',
  tencent: '连接 QQ / Foxmail 或腾讯企业邮箱，搜索、阅读并按需发送邮件。',
  feishu: '使用本人飞书账号读取云文档与会话，按需开放文档写入和消息发送。',
};
const scopeDescriptions: Partial<Record<ServiceScope, string>> = {
  read: '仅查找与读取账号获准的内容。', collaborate: '另可创建与更新 Issue、PR、评论和评审。', merge: '另可合并 PR；操作时核对仓库、PR 与准确版本。',
  manage: '另可创建与更新草稿、管理标签。', send: '另可发送、回复与转发；发送时核对具体邮件。', write: '另可创建与更新云文档；覆盖已有内容时核对具体修改。', message: '另可向准确的会话发送消息；使用已核验的本人身份。',
};
const monograms: Record<ServiceId, string> = { github: 'GH', gmail: 'G', tencent: '邮', feishu: '飞' };
const helpLinks: Record<ServiceId, { url: string; label: string }> = {
  github: { url: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app', label: 'GitHub 应用配置说明' },
  gmail: { url: 'https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server', label: 'Google 官方账号设置说明' },
  tencent: { url: 'https://help.mail.qq.com/detail/106/985', label: 'QQ 邮箱授权码设置说明' },
  feishu: { url: 'https://open.larkoffice.com/document/mcp_open_tools/end-user-use-remote-mcp-server', label: '飞书官方接入与管理员说明' },
};
function lastVerified(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return '尚未完成核验';
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function ServiceConnectionDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose(): void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), headingId = useId();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    dialog.current?.showModal();
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="service-connection-dialog" aria-labelledby={headingId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="dialog-heading"><h2 id={headingId}>{title}</h2><button type="button" className="icon-button" aria-label={`关闭${title}`} disabled={busy} onClick={onClose}>✕</button></header>
    {children}
  </dialog>;
}
export function ServiceScopePicker({ service, value, allowed = SERVICE_SCOPES[service], disabled, onChange }: { service: ServiceId; value: readonly ServiceScope[]; allowed?: readonly ServiceScope[]; disabled?: boolean; onChange(scopes: ServiceScope[]): void }) {
  const name = useId();
  const chosen = [...SERVICE_SCOPES[service]].reverse().find(scope => value.includes(scope));
  return <fieldset className="service-connection-scopes" disabled={disabled}><legend>允许的能力</legend>{SERVICE_SCOPES[service].map(scope => {
    const scopes = serviceScopeSelection(service, scope), available = scopes.every(item => allowed.includes(item));
    return <label key={scope}><input type="radio" name={name} value={scope} aria-label={serviceScopeSummary(scopes)} aria-describedby={`${name}-${scope}-help`} checked={chosen === scope} disabled={!available} onChange={() => onChange(scopes)} /><span><strong>{serviceScopeSummary(scopes)}</strong><small id={`${name}-${scope}-help`}>{scopeDescriptions[scope]}{!available && ' 当前账号未开放。'}</small></span></label>;
  })}</fieldset>;
}
export function useServiceConnections() {
  const [connections, setConnections] = useState<ServiceConnection[]>(), [error, setError] = useState('');
  const requestSequence = useRef(0);
  const refresh = async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    try { const values = await listServiceConnections(signal); if (!signal?.aborted && sequence === requestSequence.current) { setConnections(values); setError(''); } }
    catch (fault) { if (!signal?.aborted && sequence === requestSequence.current) setError(serviceConnectionErrorText(fault)); }
  };
  useEffect(() => {
    const controller = new AbortController(), focus = () => { void refresh(controller.signal); };
    void refresh(controller.signal); window.addEventListener('focus', focus); window.addEventListener('optracall:service-connections-changed', focus);
    return () => { controller.abort(); requestSequence.current++; window.removeEventListener('focus', focus); window.removeEventListener('optracall:service-connections-changed', focus); };
  }, []);
  const update = (connection: ServiceConnection) => { requestSequence.current++; setConnections(previous => [...(previous ?? []).filter(item => item.service !== connection.service), connection]); window.dispatchEvent(new Event('optracall:service-connections-changed')); };
  return { connections, error, refresh, update };
}

export function ServiceConnectionsSettings({ onProject }: { onProject?: () => void } = {}) {
  const { connections, error, refresh, update } = useServiceConnections();
  const [editing, setEditing] = useState<ServiceId>(), [disconnecting, setDisconnecting] = useState<ServiceId>(), [affectedTasks, setAffectedTasks] = useState<string[]>(), [busy, setBusy] = useState<ServiceId>(), [notice, setNotice] = useState(''), [actionError, setActionError] = useState('');
  const headingId = useId();
  useEffect(() => {
    if (!disconnecting) return;
    const controller = new AbortController();
    void readServiceConnection(disconnecting, controller.signal).then(value => { if (!controller.signal.aborted) setAffectedTasks(value.affectedTasks ?? []); }, fault => { if (!controller.signal.aborted) setActionError(serviceConnectionErrorText(fault)); });
    return () => controller.abort();
  }, [disconnecting]);
  async function verify(connection: ServiceConnection) {
    setBusy(connection.service); setActionError(''); setNotice('');
    try { const result = await actOnServiceConnection(connection.service, 'verify', connection.revision); update(result.connection); setNotice(`${serviceNames[connection.service]}：${serviceStateLabels[result.connection.status]}。`); }
    catch (fault) { setActionError(serviceConnectionErrorText(fault)); try { update((await readServiceConnection(connection.service)).connection); } catch { /* Observation never retries verification. */ } }
    finally { setBusy(undefined); }
  }
  return <section className="service-connections" aria-labelledby={headingId}>
    <header className="service-connections-intro"><div><h3 id={headingId}>连接你自己的账号</h3><p>先连接，再为需要的任务单独开启。每项服务使用一个当前账号。</p></div>{onProject && <button type="button" className="text-button" onClick={onProject}>返回任务开启连接</button>}</header>
    {(error || actionError) && <div className="service-connection-notice" data-tone="error" role="alert">{actionError || error}<div className="service-connection-actions"><button type="button" className="text-button" onClick={() => { setActionError(''); void refresh(); }}>刷新连接状态</button></div></div>}
    {notice && <p className="service-connection-notice" role="status">{notice}</p>}
    {!connections && !error && <p className="service-connection-notice" role="status">正在读取本机连接…</p>}
    <div className="service-connections-grid">{SERVICE_IDS.map(service => {
      const connection = connections?.find(item => item.service === service), status = connection?.status ?? 'disconnected';
      return <article className="service-connection-card" key={service} aria-labelledby={`${headingId}-${service}`}>
        <header className="service-connection-heading"><div className="service-connection-name"><span className="service-connection-monogram" aria-hidden="true">{monograms[service]}</span><h4 id={`${headingId}-${service}`}>{serviceNames[service]}</h4></div><span className="service-connection-state" data-state={status}>{connections ? serviceStateLabels[status] : '正在读取'}</span></header>
        <p className="service-connection-description">{descriptions[service]}</p>
        {service === 'gmail' && <p className="field-help">发送、回复、转发及部分更新工具需要 Google partner access，仅在当前账号实际开放时可用。<a href="https://developers.google.com/workspace/gmail/api/guides/quotas" target="_blank" rel="noreferrer">查看官方开放范围 ↗</a></p>}
        {connection?.accountId ? <><p className="service-connection-account">{connection.accountLabel || connection.accountId}</p><p className="service-connection-summary">{service === 'tencent' && `${serviceMailboxLabel(connection.mailboxType)} · `}{connection.tenantId && `企业 ${connection.tenantId} · `}{serviceScopeSummary(connection.scopes)}{service === 'github' && connection.repositories?.length ? ` · ${connection.repositories.join('、')}` : ''}</p></> : <p className="service-connection-summary">{status === 'unverified' ? '配置已保存，等待核验实际账号与权限。' : status === 'authorizing' ? '请完成浏览器授权，再核验账号与工具。' : '尚无已核验账号'}</p>}
        {status === 'expired' && <p className="service-connection-notice" data-tone="warning">授权已失效。重新连接同一账号后，可恢复原任务绑定。</p>}
        {status === 'unknown' && <p className="service-connection-notice" data-tone="warning">上次连接操作的结果待核，请先刷新状态。</p>}
        {status === 'error' && <p className="service-connection-notice" data-tone="warning">连接未通过核验。请核对权限、{service === 'feishu' ? '企业管理员放行与' : ''}服务设置和网络。</p>}
        <div className="service-connection-actions"><button type="button" className="primary-button" disabled={!connections || busy === service || status === 'disconnecting'} onClick={() => { setNotice(''); setActionError(''); setEditing(service); }}>{status === 'authorizing' ? '继续授权' : status === 'verified' ? '管理连接' : status === 'expired' ? '重新连接' : `连接 ${serviceNames[service]}`}</button>
          {connection && status !== 'disconnected' && <button type="button" className="text-button" disabled={busy === service || status === 'disconnecting' || status === 'authorizing'} onClick={() => void verify(connection)}>{busy === service ? '正在核验…' : '核验连接'}</button>}
          {connection && status !== 'disconnected' && <button type="button" className="text-button service-connection-danger" disabled={busy === service || status === 'disconnecting'} onClick={() => { setActionError(''); setAffectedTasks(undefined); setDisconnecting(service); }}>断开</button>}
        </div>
        <details className="service-connection-details"><summary>应用配置与最近核验</summary><dl><div><dt>最近核验</dt><dd>{lastVerified(connection?.verifiedAt)}</dd></div><div><dt>凭据</dt><dd>{connection && Object.values(connection.credentialsConfigured).some(Boolean) ? '已配置 · 保存后不回显' : '尚未配置'}</dd></div><div><dt>获准能力</dt><dd>{connection?.scopes.length ? serviceScopeSummary(connection.scopes) : '尚未核验'}</dd></div><div><dt>可用工具</dt><dd>{status === 'verified' ? `${connection?.tools.length ?? 0} 项实际核验工具` : '尚未完成工具核验'}</dd></div><div><dt>服务地址</dt><dd><code>{service === 'tencent' ? `${TENCENT_MAIL_SERVERS[connection?.mailboxType ?? 'qq'].imapHost}:993 / ${TENCENT_MAIL_SERVERS[connection?.mailboxType ?? 'qq'].smtpHost}:465` : SERVICE_URLS[service]}</code></dd></div></dl><p><a href={helpLinks[service].url} target="_blank" rel="noreferrer">{helpLinks[service].label} ↗</a></p></details>
      </article>;
    })}</div>
    <p className="service-connections-note">授权在当前设备保存。连接完成不会自动读取资料或运行任务；更换账号、邮箱类型或企业后，原任务须核对并重新选择。</p>
    {editing && <ConnectionEditor key={editing} service={editing} initial={connections?.find(item => item.service === editing)} onUpdate={update} onClose={message => { if (message) setNotice(message); setEditing(undefined); }} />}
    {disconnecting && <ServiceConnectionDialog title={`断开 ${serviceNames[disconnecting]}`} busy={busy === disconnecting} onClose={() => setDisconnecting(undefined)}><p>断开后，使用该连接的任务将失去调用资格，并收尾正在使用的连接资源。任务原有账号选择和草稿继续保留。</p>{actionError && <p className="service-connection-notice" data-tone="error" role="alert">{actionError}</p>}{affectedTasks?.length ? <div className="service-connection-notice">受影响任务：<ul>{affectedTasks.map(task => <li key={task}>{task}</li>)}</ul></div> : <p className="field-help">{affectedTasks ? '当前没有已绑定该连接的任务。' : '正在核对受影响任务…'}</p>}<div className="service-connection-dialog-actions"><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => setDisconnecting(undefined)}>保留连接</button><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={async () => {
      const connection = connections?.find(item => item.service === disconnecting); if (!connection) return;
      setBusy(disconnecting); setActionError('');
      try { const result = await actOnServiceConnection(disconnecting, 'disconnect', connection.revision); update(result.connection); setNotice((result.connection.status === 'disconnected' ? `${serviceNames[disconnecting]} 已断开，原任务选择继续保留。` : '已撤销后续调用资格，资源收尾结果尚待核对。') + (result.affectedTasks?.length ? ` 受影响任务：${result.affectedTasks.join('、')}。` : '')); setDisconnecting(undefined); }
      catch (fault) { setActionError(serviceConnectionErrorText(fault)); try { update((await readServiceConnection(disconnecting)).connection); } catch { /* Keep the original result uncertain. */ } setDisconnecting(undefined); }
      finally { setBusy(undefined); }
    }}>{busy ? '正在收尾…' : '断开连接'}</button></div></ServiceConnectionDialog>}
  </section>;
}

function ConnectionEditor({ service, initial, onUpdate, onClose }: { service: ServiceId; initial?: ServiceConnection; onUpdate(connection: ServiceConnection): void; onClose(message?: string): void }) {
  const [connection, setConnection] = useState(initial), [authorization, setAuthorization] = useState<ServiceAuthorization>(), [mode, setMode] = useState<'oauth' | 'pat'>(service === 'github' && initial?.credentialsConfigured.accessToken && !initial.clientId ? 'pat' : 'oauth');
  const [scopes, setScopes] = useState<ServiceScope[]>(initial?.scopes.length ? [...initial.scopes] : ['read']), [repositories, setRepositories] = useState(initial?.repositories?.join(', ') ?? ''), [email, setEmail] = useState(initial?.email ?? ''), [mailboxType, setMailboxType] = useState<'qq' | 'exmail'>(initial?.mailboxType ?? 'qq');
  const [clientId, setClientId] = useState(initial?.clientId ?? ''), [redirectUri, setRedirectUri] = useState(initial?.redirectUri ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const token = useRef<HTMLInputElement>(null), secret = useRef<HTMLInputElement>(null), authCode = useRef<HTMLInputElement>(null), active = useRef(true), sequence = useRef(0), trackedAttempt = useRef<string>(undefined), fieldsId = useId();
  const clearSecrets = () => { for (const ref of [token, secret, authCode]) if (ref.current) ref.current.value = ''; };
  function accept(value: ServiceConnectionSnapshot, adoptAttempt = false) {
    if (adoptAttempt && !trackedAttempt.current) trackedAttempt.current = value.authorization?.attemptId ?? value.authorizationResult?.attemptId;
    const observation = trackedAttempt.current ? serviceAuthorizationObservation(value, trackedAttempt.current) : undefined;
    setConnection(value.connection);
    setAuthorization(observation?.status === 'pending' && value.authorization?.attemptId === trackedAttempt.current ? value.authorization : undefined);
    onUpdate(value.connection);
    if (observation) {
      if (observation.status === 'failed' || observation.status === 'unknown') { setError(observation.message); setNotice(''); }
      else { setError(''); setNotice(observation.message); }
    }
    return observation;
  }
  useEffect(() => {
    active.current = true;
    const current = ++sequence.current;
    if (initial && service !== 'tencent') void readServiceConnection(service).then(value => { if (active.current && sequence.current === current) accept(value, Boolean(value.authorization)); }, fault => { if (active.current && sequence.current === current) setError(serviceConnectionErrorText(fault)); });
    return () => { active.current = false; sequence.current++; clearSecrets(); };
  }, []);
  useEffect(() => {
    if (!authorization) return;
    const controller = new AbortController();
    const interval = window.setInterval(() => {
      const current = ++sequence.current;
      void readServiceConnection(service, controller.signal).then(value => {
        if (!controller.signal.aborted && active.current && current === sequence.current) {
          accept(value);
        }
      }, fault => { if (!controller.signal.aborted && active.current && current === sequence.current) setError(serviceConnectionErrorText(fault)); });
    }, 2200);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [authorization?.attemptId]);
  async function close() {
    if (busy) return;
    clearSecrets();
    if (authorization) {
      setBusy(true); sequence.current++;
      try {
        const observation = accept(await cancelServiceAuthorization(service, authorization.attemptId));
        if (observation?.status === 'cancelled' || observation?.status === 'succeeded') { onClose(observation.message); return; }
        setBusy(false); return;
      }
      catch (fault) { setError(serviceConnectionErrorText(fault)); try { accept(await readServiceConnection(service)); } catch { /* Do not repeat cancellation or cancel a replacement attempt. */ } setBusy(false); return; }
    }
    onClose();
  }
  async function submit(connect: boolean) {
    setError(''); setNotice('');
    const config: ServiceConnectionConfig = { scopes: [...scopes] };
    if (service === 'github') {
      const repos = repositories.split(',').map(value => value.trim()).filter(Boolean);
      if (!repos.length || repos.some(value => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_.-]+$/.test(value)) || new Set(repos.map(value => value.toLowerCase())).size !== repos.length) { setError('请填写不重复的 owner/repository 仓库，多个仓库用英文逗号分隔。'); return; }
      config.repositories = repos;
    }
    if (service === 'tencent') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('请填写完整的邮箱地址。'); return; }
      config.email = email.trim(); config.mailboxType = mailboxType;
      if (connect && !authCode.current?.value && (!connection?.credentialsConfigured.authorizationCode || email.trim() !== connection.email || mailboxType !== connection.mailboxType)) { setError('请填写当前邮箱官方生成的客户端授权码。'); authCode.current?.focus(); return; }
    } else if (mode === 'oauth' || service !== 'github') {
      if (service !== 'feishu' && !clientId.trim()) { setError('请先填写已注册应用的 OAuth Client ID。'); return; }
      if (clientId.trim()) config.clientId = clientId.trim();
      if (redirectUri.trim()) config.redirectUri = redirectUri.trim();
      config.issuer = service === 'github' ? 'github' : service === 'gmail' ? 'google' : 'feishu';
    } else if (connect && !token.current?.value && !connection?.credentialsConfigured.accessToken) { setError('请填写细粒度访问令牌。'); token.current?.focus(); return; }
    const credentials: ServiceConnectionCredentials = {};
    if (token.current?.value) credentials.accessToken = token.current.value;
    if (secret.current?.value) credentials.clientSecret = secret.current.value;
    if (authCode.current?.value) credentials.authorizationCode = authCode.current.value;
    clearSecrets(); setBusy(true); sequence.current++; trackedAttempt.current = undefined; setAuthorization(undefined);
    try {
      const saved = await saveServiceConnection(service, connection?.revision ?? 0, config, credentials); if (!active.current) return; accept(saved);
      if (!connect) setNotice('配置已保存。尚需连接并核验实际账号与权限。');
      else {
        const direct = service === 'tencent' || service === 'github' && mode === 'pat';
        const result = await actOnServiceConnection(service, direct ? 'connect' : 'oauth/start', saved.connection.revision); if (!active.current) return;
        const observation = accept(result, !direct);
        if (direct) setNotice(result.connection.status === 'verified' ? '已核验实际账号与工具。回到原任务后可单独开启。' : '连接尚未通过实际核验，请核对状态后继续。');
        else if (!observation) setError('本次账号授权结果尚未确认。请查询当前状态后继续。');
      }
    } catch (fault) { if (active.current) { setError(serviceConnectionErrorText(fault)); try { const observed = await readServiceConnection(service); if (active.current) accept(observed); } catch { /* Query only; never repeat the save or connect action. */ } } }
    finally { if (active.current) setBusy(false); }
  }
  const oauth = service !== 'tencent' && (service !== 'github' || mode === 'oauth');
  return <ServiceConnectionDialog title={`连接 ${serviceNames[service]}`} busy={busy} onClose={() => void close()}>
    <p>{descriptions[service]} 账号以实际核验结果为准。</p>
    {error && <div className="service-connection-notice" data-tone="error" role="alert">{error}<div className="service-connection-actions"><button type="button" className="text-button" aria-disabled={busy} aria-busy={busy} onClick={async () => { if (busy) return; setBusy(true); try { if (!accept(await readServiceConnection(service))) setError(''); } catch (fault) { setError(serviceConnectionErrorText(fault)); } finally { setBusy(false); } }}>查询当前连接状态</button></div></div>}
    {notice && <p className="service-connection-notice" role="status">{notice}</p>}
    {connection?.status === 'verified' && <p className="service-connection-account">当前已核验：{connection.accountLabel || connection.accountId}{connection.tenantId && ` · 企业 ${connection.tenantId}`}</p>}
    {authorization ? <div className="service-connection-authorization"><div className="service-connection-notice" role="status">等待本人账号授权。当前页面会核对授权结果。</div><a href={authorization.url} target="_blank" rel="noreferrer" className="primary-button">前往 {serviceNames[service]} 官方授权页面 ↗</a><p>在运行 OptraCall 的设备上完成授权，然后返回本页。关闭授权页面不会自动取消此请求。</p><div className="service-connection-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void close()}>{busy ? '正在取消…' : '取消本次授权'}</button></div></div> : <form className="service-connection-form" onSubmit={event => { event.preventDefault(); const submitter = (event.nativeEvent as SubmitEvent).submitter; void submit(submitter?.getAttribute('data-action') !== 'save'); }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}>
        {service === 'github' && <label>连接方式<select value={mode} onChange={event => { clearSecrets(); setMode(event.target.value as 'oauth' | 'pat'); setError(''); }}><option value="oauth">注册应用 OAuth</option><option value="pat">细粒度访问令牌（PAT）</option></select></label>}
        {service === 'github' && <label htmlFor={`${fieldsId}-repos`}>允许使用的仓库<input id={`${fieldsId}-repos`} autoFocus type="text" autoComplete="off" value={repositories} onChange={event => setRepositories(event.target.value)} placeholder="owner/repository" spellCheck={false} /><small className="field-help">仅限明确列出的仓库，多个仓库以英文逗号分隔。令牌或账号须同时拥有这些仓库的权限。</small></label>}
        {service === 'github' && mode === 'pat' && <label>细粒度访问令牌<input ref={token} aria-label="细粒度访问令牌" type="password" autoComplete="new-password" spellCheck={false} maxLength={16384} placeholder={connection?.credentialsConfigured.accessToken ? '已配置；留空继续使用' : '填写 GitHub 细粒度 PAT'} /><small className="field-help">令牌只交给本机 Host 保存；保存后不再显示。请在 GitHub 中限制仓库和权限。</small></label>}
        {service === 'tencent' && <><label>邮箱类型<select value={mailboxType} onChange={event => { clearSecrets(); setMailboxType(event.target.value as 'qq' | 'exmail'); }}><option value="qq">QQ / Foxmail 邮箱</option><option value="exmail">腾讯企业邮箱</option></select></label><label>邮箱地址<input type="email" autoFocus autoComplete="off" value={email} maxLength={254} onChange={event => { if (email !== event.target.value) clearSecrets(); setEmail(event.target.value); }} placeholder="name@qq.com" /></label><label>客户端授权码<input ref={authCode} aria-label="客户端授权码" type="password" autoComplete="new-password" spellCheck={false} maxLength={16384} placeholder={connection?.credentialsConfigured.authorizationCode && email === connection.email && mailboxType === connection.mailboxType ? '已配置；留空继续使用' : '填写邮箱官方生成的专用授权码'} /><small className="field-help">先在官方邮箱设置开启 IMAP / SMTP。QQ / Foxmail 使用客户端授权码，企业邮箱按管理员的安全登录要求配置。</small></label></>}
        {oauth && service !== 'feishu' && <label>OAuth Client ID<input type="text" autoFocus={service === 'gmail'} autoComplete="off" spellCheck={false} value={clientId} maxLength={512} onChange={event => setClientId(event.target.value)} placeholder={service === 'gmail' ? 'Desktop app Client ID' : '已注册的 GitHub 应用 Client ID'} /></label>}
        {service === 'gmail' && <p className="service-connection-notice">首次在 Google Cloud 配置 Desktop app 与 AI-powered-agent client，并启用 Gmail API 和 Gmail MCP API。之后由本人完成浏览器授权。<a href={helpLinks.gmail.url} target="_blank" rel="noreferrer">查看官方说明 ↗</a></p>}
        {service === 'feishu' && <p className="service-connection-notice">使用飞书官方应用 OAuth 与本人用户身份。企业管理员须安装官方 MCP 应用，并向本人开放所需工具。<a href={helpLinks.feishu.url} target="_blank" rel="noreferrer">管理员接入说明 ↗</a></p>}
        <ServiceScopePicker service={service} value={scopes} onChange={setScopes} />
        {oauth && service !== 'feishu' && <details><summary>应用密钥与回调设置</summary><label>Client Secret（应用要求时填写）<input ref={secret} aria-label="Client Secret" type="password" autoComplete="new-password" spellCheck={false} maxLength={16384} placeholder={connection?.credentialsConfigured.clientSecret ? '已配置；留空继续使用' : '填写注册应用的客户端密钥'} /></label><label>本机回调地址<input type="url" autoComplete="off" value={redirectUri} maxLength={1000} onChange={event => setRedirectUri(event.target.value)} placeholder="由本机授权服务提供，通常可留空" /></label><p>应用登记的回调须与当前运行设备一致。<a href={helpLinks[service].url} target="_blank" rel="noreferrer">查看官方应用设置 ↗</a></p></details>}
        <p className="field-help">保存配置不表示已连接。任务授权各自独立；发送、合并或覆盖时仍核对本次具体目标与内容。</p>
      </fieldset>
      <div className="service-connection-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void close()}>取消</button><button type="submit" className="secondary-button" data-action="save" disabled={busy}>仅保存配置</button><button type="submit" className="primary-button" disabled={busy}>{busy ? '正在连接…' : oauth ? '保存并开始授权' : '保存并核验连接'}</button></div>
    </form>}
  </ServiceConnectionDialog>;
}
