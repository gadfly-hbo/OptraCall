import { useEffect, useRef, useState } from 'react';
import type { ClientProject, PublicModelConfiguration } from './project-types.ts';
import { HostRequestError } from './runtime-client.ts';

const errorText = (error: unknown) => error instanceof HostRequestError ? error.message : '本地服务暂时不可用，请重试。';
export function TaskDialog({ project, configurations, onCreate, onClose }: { project: ClientProject; configurations: PublicModelConfiguration[]; onCreate: (name: string, configurationId: string) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(''), [configurationId, setConfigurationId] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const configured = configurations.find(item => item.id === (configurationId || project.configuration.id))?.hasApiKey;
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); }, []);
  return <dialog ref={dialog} className="catalog-dialog project-dialog" aria-labelledby="new-task-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={onClose}>
    <div className="dialog-heading"><span className="eyebrow">{project.name}</span><button className="icon-button" aria-label="关闭新建任务" disabled={busy} onClick={() => dialog.current?.close()}>✕</button></div>
    <h2 id="new-task-title">新建任务</h2><p className="detail-summary">任务独立保存对话和草稿，共享此项目的文件。</p>
    <form noValidate onSubmit={async event => { event.preventDefault(); const cleaned = name.trim(); if (!cleaned || cleaned.length > 80) { setError('请输入1–80个字符的任务名称。'); input.current?.focus(); return; } if (!configured) { setError('请先在模型设置中配置所选模型。'); return; } setBusy(true); setError(''); try { await onCreate(cleaned, configurationId); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }}>
      <div className="field"><label htmlFor="task-name">任务名称</label><input ref={input} id="task-name" value={name} maxLength={80} required disabled={busy} placeholder="例如：销售变化与原因" aria-invalid={Boolean(error)} aria-describedby="task-name-help" onChange={event => { setName(event.target.value); setError(''); }} /><p id="task-name-help" className={error ? 'field-error' : 'field-help'} role={error ? 'alert' : undefined}>{error || '同一项目下可以创建多个独立任务。'}</p></div>
      <div className="field"><label htmlFor="task-model">任务模型</label><select id="task-model" value={configurationId} disabled={busy} onChange={event => { setConfigurationId(event.target.value); setError(''); }}><option value="">继承项目配置 · {project.configuration.model}</option>{configurations.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}{item.hasApiKey ? '' : ' · 需要配置'}</option>)}</select><p className="field-help">默认继承项目配置，可为此任务另选模型。</p></div>
      <div className="project-dialog-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => dialog.current?.close()}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? '正在创建…' : '创建任务'}</button></div>
    </form>
  </dialog>;
}

export function RenameProjectDialog({ project, onRename, onClose }: { project: ClientProject; onRename: (name: string) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(project.name), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); input.current?.select(); }, []);
  return <dialog ref={dialog} className="catalog-dialog project-dialog" aria-labelledby="rename-project-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={onClose}>
    <div className="dialog-heading"><span className="eyebrow">项目空间</span><button className="icon-button" aria-label="关闭项目重命名" disabled={busy} onClick={() => dialog.current?.close()}>✕</button></div><h2 id="rename-project-title">重命名项目</h2>
    <p className="detail-summary">只修改显示名称，项目文件和任务保持原位。</p>
    <form noValidate onSubmit={async event => { event.preventDefault(); const cleaned = name.trim(); if (!cleaned || cleaned.length > 80) { setError('请输入1–80个字符的项目名称。'); input.current?.focus(); return; } setBusy(true); setError(''); try { await onRename(cleaned); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }}>
      <div className="field"><label htmlFor="rename-project-name">项目名称</label><input ref={input} id="rename-project-name" value={name} maxLength={80} required disabled={busy} aria-invalid={Boolean(error)} aria-describedby="rename-project-help" onChange={event => { setName(event.target.value); setError(''); }} /><p id="rename-project-help" className={error ? 'field-error' : 'field-help'} role={error ? 'alert' : undefined}>{error || '名称不影响项目UUID或文件路径。'}</p></div>
      <div className="project-dialog-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => dialog.current?.close()}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存名称'}</button></div>
    </form>
  </dialog>;
}
