import { approvedTaskSkills, makeTaskAssignment, taskPurpose, taskTypes, type TaskAssignment, type TaskCreateIntent, type TaskType } from '../task-assignment.ts';
import { useEffect, useRef, useState } from 'react';
import type { ClientProject, PublicModelConfiguration } from './project-types.ts';
import { read as readPlan } from './project-plan-client.ts';
import { HostRequestError } from './runtime-client.ts';
import { TaskCapabilityList } from './TaskCapabilities.tsx';
import type { TaskCapabilities } from '../task-capabilities.ts';

const errorText = (error: unknown) => error instanceof HostRequestError ? error.message : '本地服务暂时不可用，请重试。';
export function TaskDialog({ project, configurations, intent, onCreate, onClose }: { intent?: TaskCreateIntent; project: ClientProject; configurations: PublicModelConfiguration[]; onCreate: (name: string, configurationId: string, capabilities: TaskCapabilities, assignment: TaskAssignment, operationId: string) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(''), [configurationId, setConfigurationId] = useState(''), [capabilities, setCapabilities] = useState<TaskCapabilities>({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const intentRef = useRef<{ id: string; values: string } | undefined>(undefined);
  const [type, setType] = useState<TaskType>(intent?.type ?? 'analysis');
  const [enableSkill, setEnableSkill] = useState(Boolean(approvedTaskSkills[type]));
  const agreement = project.agreements?.at(-1);
  const [useAgreement, setUseAgreement] = useState(Boolean(agreement));
  const [legacyTerms, setLegacyTerms] = useState<{ ref: NonNullable<TaskAssignment['planAgreement']>; text: string }>();
  useEffect(() => {
    let current = true;
    if (!agreement) void readPlan(project.id).then(state => {
      const original = state.confirmed;
      if (!current || !original || original.plan.caseContext && original.plan.caseContext.caseId !== intent?.caseId) return;
      setLegacyTerms({ ref: { confirmationId: original.id, version: original.planVersion }, text: [original.plan.request, ...original.plan.premises].join(' · ') });
      setUseAgreement(true);
    }).catch(() => {});
    return () => { current = false; };
  }, [project.id, agreement, intent?.caseId]);
  const configured = configurations.find(item => item.id === (configurationId || project.configuration.id))?.hasApiKey;
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); }, []);
  return <dialog ref={dialog} className="catalog-dialog project-dialog" aria-labelledby="new-task-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={onClose}>
    <div className="dialog-heading"><span className="eyebrow">{project.name}</span><button className="icon-button" aria-label="关闭新建任务" disabled={busy} onClick={() => dialog.current?.close()}>✕</button></div>
    <h2 id="new-task-title">新建任务</h2><p className="detail-summary">任务独立保存对话和草稿，共享此项目的文件。</p>
    <form noValidate onSubmit={async event => { event.preventDefault(); const cleaned = name.trim(); if (!cleaned || cleaned.length > 80) { setError('请输入1–80个字符的任务名称。'); input.current?.focus(); return; } if (!configured) { setError('请先在模型设置中配置所选模型。'); return; } setBusy(true); setError(''); try { const assignment: TaskAssignment = {
        ...makeTaskAssignment(type, enableSkill),
        ...(useAgreement && agreement ? { agreementVersion: agreement.version } : useAgreement && legacyTerms ? { planAgreement: legacyTerms.ref } : {}),
        ...(intent?.caseId && intent.issueId ? { issue: { caseId: intent.caseId, issueId: intent.issueId, ...(intent.choiceId ? { choiceId: intent.choiceId } : {}), ...(type === 'teach' && intent.feedbackRevisionId ? {feedbackRevisionId:intent.feedbackRevisionId} : {}) } } : {}),
        ...(intent?.sources?.length ? { sources: intent.sources } : {}),
      };
      const values = JSON.stringify([cleaned, configurationId, capabilities, assignment]);
      if (values !== intentRef.current?.values) intentRef.current = { id: crypto.randomUUID(), values };
      await onCreate(cleaned, configurationId, capabilities, assignment, intentRef.current.id); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }}>
      <div className="field"><label htmlFor="task-name">任务名称</label><input ref={input} id="task-name" value={name} maxLength={80} required disabled={busy} placeholder="例如：销售变化与原因" aria-invalid={Boolean(error)} aria-describedby="task-name-help" onChange={event => { setName(event.target.value); setError(''); }} /><p id="task-name-help" className={error ? 'field-error' : 'field-help'} role={error ? 'alert' : undefined}>{error || '同一项目下可以创建多个独立任务。'}</p></div>
      <div className="field"><label htmlFor="task-type">Task 类型</label><select id="task-type" value={type} disabled={busy} onChange={event => { const next = event.target.value as TaskType; setType(next); setEnableSkill(Boolean(approvedTaskSkills[next])); }}>{taskTypes.map(key => <option key={key} value={key}>{taskPurpose[key].label}</option>)}</select><p>{taskPurpose[type].deliverable}</p></div>
      <label><input type="checkbox" disabled={busy || !approvedTaskSkills[type]} checked={enableSkill} onChange={event => setEnableSkill(event.target.checked)}/> 默认 Skill · {taskPurpose[type].skill} {approvedTaskSkills[type]?.version ?? '（等待独立测评确认）'}</label>
      {(agreement || legacyTerms) && <label><input type="checkbox" checked={useAgreement} disabled={busy} onChange={event => setUseAgreement(event.target.checked)}/> 复用{agreement ? '共用约定 v' + agreement.version : '原确认方案 v' + legacyTerms?.ref.version} · {agreement?.text ?? legacyTerms?.text}</label>}
      {intent?.issueId && <p>Case {intent.caseId} · 事项 {intent.issueId}{intent.choiceId && ' · 取舍 ' + intent.choiceId}{type === 'teach' && intent.feedbackRevisionId && ' · 原看板反馈 '+intent.feedbackRevisionId}</p>}
      {intent?.sources?.length ? <p>带入已选准确成果 {intent.sources.length} 项，发送时按本任务权限读取。</p> : null}
      <div className="field"><label htmlFor="task-model">任务模型</label><select id="task-model" value={configurationId} disabled={busy} onChange={event => { setConfigurationId(event.target.value); setError(''); }}><option value="">继承项目配置 · {project.configuration.model}</option>{configurations.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}{item.hasApiKey ? '' : ' · 需要配置'}</option>)}</select><p className="field-help">默认继承项目配置，可为此任务另选模型。</p></div>
      <TaskCapabilityList settings={capabilities} disabled={busy} context="create" onChange={(capability, enabled) => setCapabilities(previous => ({ ...previous, [capability]: enabled }))} />
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
