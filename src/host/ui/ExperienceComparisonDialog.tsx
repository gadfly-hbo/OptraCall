import { useId, useState } from 'react';
import type { ClientProject, ClientTask } from './project-types.ts';
import type { PersonalContextChoice } from './PersonalContextControls.tsx';
import { createTask, HostRequestError, readTask, saveDraft } from './runtime-client.ts';
import { comparisonGroupNames, comparisonTaskDraft, type ComparisonDraftInput, type ComparisonGroup } from './experience-learning-client.ts';
import { PersonalDialog } from './PersonalDialog.tsx';
export type ComparisonContext = { project: ClientProject; task: ClientTask; personal: PersonalContextChoice[] };
export function ExperienceComparisonDialog({ open, context, onClose, onCreated, onOpenTask }: {
  open: boolean; context: ComparisonContext; onClose: () => void; onCreated: (task: ClientTask) => void; onOpenTask: (task: ClientTask) => void;
}) {
  const id = useId();
  const [input, setInput] = useState<ComparisonDraftInput>({ group: context.personal.length ? 'memory' : 'baseline', question: context.task.draft, materials: '', method: '', reportPath: '060_reports/增量验证报告.md' });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [created, setCreated] = useState<ClientTask | null>(null), [createUnknown, setCreateUnknown] = useState(false), [draftUnknown, setDraftUnknown] = useState(false), [saved, setSaved] = useState(false);
  const [submittedDraft, setSubmittedDraft] = useState(''), [submittedPersonal, setSubmittedPersonal] = useState<PersonalContextChoice[]>([]);
  const personal = created || createUnknown ? submittedPersonal : context.personal;
  const needsMemory = input.group === 'memory' || input.group === 'combined', needsMethod = input.group === 'method' || input.group === 'combined';
  const unavailable = needsMemory && !personal.length || needsMethod && !input.method.trim();
  const locked = busy || createUnknown || Boolean(created);
  const fail = (error: unknown) => error instanceof Error ? error.message : '请求未能核定；保留原输入，先核对。';
  async function prepare() {
    if (locked || unavailable || !input.question.trim() || context.project.archivedAt) return;
    const draft = comparisonTaskDraft(input, context.task, personal);
    if (draft.length > 20000) { setError('准备草稿超过原普通任务的20,000字符上限；本次尚未创建任务。请缩短共同问题、材料或方法说明，原输入保持。'); return; }
    setBusy(true); setError(''); setSubmittedDraft(draft); setSubmittedPersonal(structuredClone(personal));
    let task: ClientTask;
    try { task = await createTask(context.project.id, `增量验证 · ${comparisonGroupNames[input.group]}`, context.task.configuration.id); setCreated(task); onCreated(task); }
    catch (error) { const unknown = !(error instanceof HostRequestError && error.status && error.status >= 400 && error.status < 500); setCreateUnknown(unknown); setError(`${unknown ? '创建任务结果 UNKNOWN，尚无准确任务 ID。' : '任务未创建。'}原输入保持；${unknown ? '先到原项目目录核对，不自动再次创建。' : ''}${fail(error)}`); setBusy(false); return; }
    try { await saveDraft(context.project.id, task.id, draft); const next = { ...task, draft }; setCreated(next); onCreated(next); setSaved(true); setMessage('已明确保存这一组任务草稿；尚未发送，尚无评估结果。'); }
    catch (error) { setDraftUnknown(true); setError(`任务已创建，但草稿保存结果 UNKNOWN。保留准确任务与原输入；先回查该任务，不再创建。${fail(error)}`); }
    finally { setBusy(false); }
  }
  async function recheck() {
    if (!created || busy) return; setBusy(true); setError('');
    try { const read = await readTask(context.project.id, created.id); setCreated(read.task); onCreated(read.task); const equal = read.task.draft === submittedDraft; setSaved(equal); setDraftUnknown(!equal); setMessage(equal ? '回查确认原任务草稿已保存；尚未发送。' : '已回查原任务，草稿与原输入不同。原输入保持；可明确向同一任务保存，不会再创建。'); }
    catch (error) { setError(`原任务回查仍未完成，UNKNOWN保持。${fail(error)}`); }
    finally { setBusy(false); }
  }
  async function continueDraft() {
    if (!created || busy || !draftUnknown) return; setBusy(true); setError('');
    try { await saveDraft(context.project.id, created.id, submittedDraft); const next = { ...created, draft: submittedDraft }; setCreated(next); onCreated(next); setDraftUnknown(false); setSaved(true); setMessage('已明确保存这一组任务草稿；尚未发送，尚无评估结果。'); }
    catch (error) { setError(`同一任务草稿保存仍未核定。${fail(error)}`); }
    finally { setBusy(false); }
  }
  if (!open) return null;
  return <PersonalDialog title="准备增量验证" subtitle={`当前项目：${context.project.name} · 自愿准备一个普通任务草稿`} busy={busy} onClose={onClose} footer={<><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>稍后继续</button><button className="primary-button" type="submit" form={`${id}-form`} disabled={locked || unavailable || !input.question.trim() || Boolean(context.project.archivedAt)}>只创建这一组任务草稿</button>{created && saved && <><button className="secondary-button" type="button" onClick={() => onOpenTask(created)}>打开已准备任务</button><button className="text-button" type="button" onClick={() => { setCreated(null); setSaved(false); setSubmittedDraft(''); setMessage('共同问题与材料保持；请选择下一适用组，再明确创建。'); }}>准备另一组</button></>}</>}>
    <p className="pr-note">共同条件按这一轮问题固定，差异如实说明。任务创建不发送消息；原任务草稿与历史保持。新任务不保证环境没有候选答案，比较条件不齐时不能归因。</p>
    <form id={`${id}-form`} onSubmit={event => { event.preventDefault(); void prepare(); }}><fieldset disabled={locked} className="pr-field-grid"><legend>这一轮可选准备</legend>
      <label className="pr-wide"><span>共同代表问题</span><textarea required rows={3} value={input.question} onChange={event => setInput({ ...input, question: event.target.value })} /></label>
      <label className="pr-wide"><span>共同材料与版本（可选）</span><textarea rows={2} value={input.materials} placeholder="沿原项目材料，说明各组共同使用的准确版本、权限与预算；未知可说明。" onChange={event => setInput({ ...input, materials: event.target.value })} /></label>
      <label><span>当前准备组</span><select value={input.group} onChange={event => setInput({ ...input, group: event.target.value as ComparisonGroup })}>{Object.entries(comparisonGroupNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label><span>原 Markdown 报告位置（可选）</span><input value={input.reportPath} onChange={event => setInput({ ...input, reportPath: event.target.value })} /></label>
      <label className="pr-wide"><span>方法候选及准确来源（可选）</span><textarea rows={2} value={input.method} placeholder="已有方法参考的位置与版本；不自动安装，也不强制 Agent 执行。" onChange={event => setInput({ ...input, method: event.target.value })} /></label>
    </fieldset></form>
    {needsMethod && !input.method.trim() && <p className="pr-note pr-warning" role="status">没有选定的方法候选，本组未运行；不会为凑组数创建或安装方法。</p>}
    {needsMemory && !personal.length && <p className="pr-note pr-warning" role="status">当前任务未指定经验候选或个人资料，本组未运行。可在原个人资料入口选择准确材料后再准备。</p>}
    {needsMemory && personal.length > 0 && <div className="pr-note"><strong>当前明确指定的资料</strong><ul>{personal.map((item, index) => <li key={index}>{item.title}</li>)}</ul><p>准确引用预填到草稿，不把准备成功当作已交付、已读或已采用。</p></div>}
    {context.project.archivedAt && <p className="pr-note pr-warning">该项目已归档，不能新建任务；人的全局个人资料维护仍独立可用。</p>}
    {error && <p className="pr-note pr-warning" role="alert">{error}</p>}{message && <p className="pr-note" role="status">{message}</p>}
    {createUnknown && <p className="pr-footnote">没有可核定的任务 ID，不能伪造查询操作。关闭后到原项目目录人工核对；本页原输入继续保留。</p>}
    {created && draftUnknown && <div className="pr-row"><button className="secondary-button" type="button" disabled={busy} onClick={() => { void recheck(); }}>回查已创建任务</button><button className="text-button" type="button" disabled={busy} onClick={() => { void continueDraft(); }}>明确向原任务保存草稿</button></div>}
    <details><summary>报告与可比条件提醒</summary><p className="pr-footnote">原报告保留首次、重复、取消、失败、无增益和退化。时间／成本未知不填0；费用估计与实际结算分开。候选暴露、配置或基础材料不同，明确写不可归因；报告保存不代表专业评估通过。</p></details>
  </PersonalDialog>;
}
