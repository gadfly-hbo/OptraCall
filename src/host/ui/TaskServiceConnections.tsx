import { useEffect, useId, useRef, useState } from 'react';
import { SERVICE_IDS, type ServiceConnection, type ServiceId, type ServiceScope, type TaskServiceBinding, type TaskServiceBindings } from '../service-connection-types.ts';
import type { ClientTask } from './project-types.ts';
import { ServiceConnectionDialog, ServiceScopePicker, useServiceConnections } from './ServiceConnections.tsx';
import { serviceBindingAvailability, serviceConnectionErrorText, serviceMailboxLabel, serviceNames, serviceScopeSummary, setTaskServiceConnection } from './service-connections-client.ts';

type TaskServiceConnectionsProps = { projectId: string; taskId: string; bindings?: TaskServiceBindings; disabled: boolean; unavailableReason?: string; archived?: boolean; onChanged(task: ClientTask): void; onSettings?: () => void };
export function TaskServiceConnections({ projectId, taskId, bindings = {}, disabled, unavailableReason, archived = false, onChanged, onSettings }: TaskServiceConnectionsProps) {
  const { connections, error: readError, refresh } = useServiceConnections();
  const [editing, setEditing] = useState<ServiceId>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const id = useId(), owner = `${projectId}/${taskId}`, currentOwner = useRef(owner);
  currentOwner.current = owner;
  useEffect(() => { setEditing(undefined); setError(''); setBusy(false); }, [projectId, taskId]);
  const unavailable = disabled || archived || Boolean(unavailableReason);
  async function change(service: ServiceId, input: { enabled: boolean; scopes?: ServiceScope[]; repositories?: string[]; expectedConnectionRevision: number }) {
    const requestOwner = owner;
    setBusy(true); setError('');
    try {
      const task = await setTaskServiceConnection(projectId, taskId, service, input);
      if (currentOwner.current !== requestOwner) return;
      onChanged(task); setEditing(undefined);
    } catch (fault) { if (currentOwner.current === requestOwner) setError(serviceConnectionErrorText(fault)); }
    finally { if (currentOwner.current === requestOwner) setBusy(false); }
  }
  const current = editing ? connections?.find(value => value.service === editing) : undefined;
  return <fieldset className="task-capability-list task-service-connections" aria-describedby={`${id}-help`}>
    <legend>个人账号连接（仅空闲时可切换）</legend>
    {(error || readError) && <div className="service-connection-notice" data-tone="error" role="alert">{error || readError}<div className="service-connection-actions"><button type="button" className="text-button" onClick={() => { setError(''); void refresh(); }}>刷新账号与连接状态</button></div></div>}
    {SERVICE_IDS.map(service => {
      const binding = bindings[service], connection = connections?.find(value => value.service === service), verified = connection?.status === 'verified' && Boolean(connection.accountId);
      const availability = binding ? serviceBindingAvailability(connection, binding) : undefined;
      const labelId = `${id}-${service}`, account = binding?.accountLabel || binding?.accountId || connection?.accountLabel || connection?.accountId;
      return <section className="task-service-connection-entry" key={service}>
        <label className="task-capability-row" htmlFor={labelId}><input id={labelId} type="checkbox" checked={Boolean(binding)} disabled={unavailable || busy || !connections || !binding && !verified} aria-describedby={`${labelId}-description`} onChange={event => {
          setError('');
          if (event.target.checked) setEditing(service);
          else void change(service, { enabled: false, expectedConnectionRevision: connection?.revision ?? binding?.revision ?? 0 });
        }} /><span><strong>{serviceNames[service]}</strong><small id={`${labelId}-description`} className={availability && !availability.available ? 'service-connection-unavailable' : undefined}>
          {!connections ? '正在读取账号…' : binding ? <>{account} · {serviceScopeSummary(binding.scopes)}{service === 'tencent' && ` · ${serviceMailboxLabel(binding.mailboxType)}`}{binding.tenantId && ` · 企业 ${binding.tenantId}`}<br />{availability?.label}</> : verified ? <>{account} · 默认关闭</> : '尚无可用连接，请先到设置连接账号'}
        </small></span></label>
        {binding?.repositories?.length ? <small className="service-connection-summary" style={{ display: 'block', margin: '4px 0 0 25px' }}>仓库：{binding.repositories.join('、')}</small> : null}
        <div className="service-connection-actions">
          {binding && verified && <button type="button" className="text-button" disabled={unavailable || busy} onClick={() => { setError(''); setEditing(service); }}>{availability?.available ? '核对账号与缩小范围' : '核对当前账号并重新选择'}</button>}
          {onSettings && (!verified || !binding) && <button type="button" className="text-button" onClick={onSettings}>管理 {serviceNames[service]} 连接</button>}
        </div>
      </section>;
    })}
    <p className="task-capability-help" id={`${id}-help`}>{unavailableReason || (archived ? '项目已归档，任务授权只读。' : disabled ? '任务当前正在使用资源，结束运行并完成收尾后可更改。' : '默认关闭，仅对本任务生效。')} 开启后，Agent 可向所选外部服务发送查询和操作所需信息；工具结果与出处进入本任务所选模型的上下文。受限执行环境不提供这些工具。</p>
    {editing && current && <TaskServiceScopeDialog key={`${owner}/${editing}/${current.revision}`} connection={current} binding={bindings[editing]} busy={busy} disabled={unavailable} error={error} onClose={() => { if (!busy) { setEditing(undefined); setError(''); } }} onConfirm={(scopes, repositories) => void change(editing, { enabled: true, scopes, ...(repositories ? { repositories } : {}), expectedConnectionRevision: current.revision })} />}
  </fieldset>;
}

function TaskServiceScopeDialog({ connection, binding, busy, disabled, error, onClose, onConfirm }: { connection: ServiceConnection; binding?: TaskServiceBinding; busy: boolean; disabled: boolean; error: string; onClose(): void; onConfirm(scopes: ServiceScope[], repositories?: string[]): void }) {
  const [scopes, setScopes] = useState<ServiceScope[]>(() => binding ? binding.scopes.filter(scope => connection.scopes.includes(scope)) : ['read']);
  const [repositories, setRepositories] = useState<string[]>(() => binding?.repositories ? binding.repositories.filter(repo => connection.repositories?.includes(repo)) : [...(connection.repositories ?? [])]);
  const [scopeError, setScopeError] = useState('');
  const changed = binding && !serviceBindingAvailability(connection, binding).available;
  return <ServiceConnectionDialog title={`${binding ? '核对' : '开启'} ${serviceNames[connection.service]} 任务权限`} busy={busy} onClose={onClose}>
    <p>本次选择只用于当前任务。请核对实际账号及允许的动作。</p>
    {changed && <div className="service-connection-notice" data-tone="warning">原任务绑定：{binding.accountLabel || binding.accountId}{binding.tenantId && ` · 企业 ${binding.tenantId}`}{binding.mailboxType && ` · ${serviceMailboxLabel(binding.mailboxType)}`}<p>账号、企业或权限已经变化；确认后才改绑到下方当前账号。</p></div>}
    <p className="service-connection-account">当前已核验：{connection.accountLabel || connection.accountId}{connection.tenantId && ` · 企业 ${connection.tenantId}`}{connection.mailboxType && ` · ${serviceMailboxLabel(connection.mailboxType)}`}</p>
    <form className="service-connection-form" onSubmit={event => { event.preventDefault(); if (!scopes.length || connection.service === 'github' && !repositories.length) { setScopeError('请选择可用能力，以及至少一个明确仓库。'); return; } onConfirm(scopes, connection.service === 'github' ? repositories : undefined); }}>
      {(error || scopeError) && <p className="service-connection-notice" data-tone="error" role="alert">{error || scopeError}</p>}
      <ServiceScopePicker service={connection.service} value={scopes} allowed={connection.scopes} disabled={busy || disabled} onChange={value => { setScopeError(''); setScopes(value); }} />
      {connection.service === 'github' && <fieldset className="service-connection-scopes" disabled={busy || disabled}><legend>本任务可使用的仓库</legend>{connection.repositories?.map(repo => <label key={repo}><input type="checkbox" checked={repositories.includes(repo)} onChange={event => { setScopeError(''); setRepositories(previous => event.target.checked ? [...previous, repo] : previous.filter(value => value !== repo)); }} /><span>{repo}</span></label>)}</fieldset>}
      <p className="field-help">查询与操作所需信息会发送给 {serviceNames[connection.service]}；工具结果与出处会进入所选任务模型上下文。发信、合并 PR 或覆盖已有内容时，核对本次具体目标与内容后再执行。</p>
      {disabled && <p className="service-connection-notice" data-tone="warning">任务当前不可修改权限，请关闭此窗口，待任务空闲后再选择。</p>}
      <div className="service-connection-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy || disabled || connection.status !== 'verified'}>{busy ? '正在保存…' : changed ? '确认账号并重新绑定' : binding ? '保存本任务范围' : '仅为本任务开启'}</button></div>
    </form>
  </ServiceConnectionDialog>;
}
