import { useEffect, useRef, useState } from 'react';
import { caseIssues } from './case-decisions-client.ts';
import { list as listCases, status as caseStorage } from './case-client.ts';
import { BusinessRoleConversation } from './BusinessRoleConversation.tsx';
import { confirmProjectAgreement, setProjectStage, setDefaultTaskSkill, taskResults } from './runtime-client.ts';
import { approvedTaskSkills, taskPurpose, type TaskCreateIntent, type ProjectStageInput, type TaskSourceSelection } from '../task-assignment.ts';
import type { ProjectTaskResultDescriptor } from '../project-task-results-types.ts';
import type { ClientProject, ClientTask } from './project-types.ts';

const failure = (error: unknown) => error instanceof Error ? error.message : '读取失败，请核对原记录。';
type Create = (intent?: TaskCreateIntent) => void;
type IssueScope = { caseId: string; issueId: string };

function ResultPicker({ project, sourceTask, onCreate }: { project: ClientProject; sourceTask?: ClientTask; onCreate: Create }) {
  const [taskId, setTaskId] = useState(sourceTask?.id ?? '');
  const [rows, setRows] = useState<ProjectTaskResultDescriptor[]>([]), [next, setNext] = useState<string>();
  const [selections, setSelections] = useState<ProjectTaskResultDescriptor[]>([]), [reload, setReload] = useState(0);
  const [error, setError] = useState(''), [preview, setPreview] = useState(''), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    generation.current++;
    setRows([]); setNext(undefined); setError(''); setPreview('');
    setLoading(!!taskId);
    if (taskId) void taskResults(project.id, taskId, {}, controller.signal).then(value => {
      if (controller.signal.aborted || value.details.action !== 'find') return;
      setRows(value.details.results); setNext(value.details.cursor);
      setError(value.details.limitations.map(item => item.code).join(' · '));
    }).catch(reason => { if (!controller.signal.aborted) setError(failure(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { generation.current++; controller.abort(); };
  }, [project.id, taskId, reload]);
  async function more() {
    const owner = generation.current;
    try {
      const { details } = await taskResults(project.id, taskId, { cursor: next });
      if (owner !== generation.current || details.action !== 'find') return;
      setRows(values => [...values, ...details.results]); setNext(details.cursor);
    } catch (reason) { if (owner === generation.current) setError(failure(reason)); }
  }
  async function show(row: ProjectTaskResultDescriptor) {
    const owner = generation.current;
    try {
      const page = await taskResults(project.id, row.taskId, { id: row.id });
      if (owner !== generation.current || page.details.action !== 'read') return;
      const content = JSON.parse(page.content[0]!.text) as { text: string };
      setPreview(content.text + (page.details.complete ? '' : '\n…（正文节选）')); setError('');
    } catch (reason) { if (owner === generation.current) { setPreview(''); setError(failure(reason)); } }
  }
  function handoff() {
    const refs: TaskSourceSelection[] = selections.map(row => ({ taskId: row.taskId, key: row.id }));
    const issues = selections.map(row => project.tasks.find(task => task.id === row.taskId)?.assignment?.issue).filter(issue => !!issue);
    const issue = issues[0];
    if (issues.some(other => other.caseId !== issue?.caseId || other.issueId !== issue.issueId)) { setError('请选择同一 Case 事项的成果。'); return; }
    const nextType = { requirement: 'analysis', analysis: 'plan', plan: 'decision', decision: 'do', do: 'teach', teach: 'analysis' } as const;
    onCreate({ type: sourceTask?.assignment ? nextType[sourceTask.assignment.type] : 'analysis', ...issue, sources: refs });
  }
  return <section className="project-plan-section">
    {!sourceTask && <label>成果所属 Task <select value={taskId} onChange={event => setTaskId(event.target.value)}><option value="">选择原任务</option>{project.tasks.map(task => <option key={task.id} value={task.id}>{task.name}</option>)}</select></label>}
    {taskId && <button className="text-button" type="button" onClick={() => setReload(value => value + 1)}>刷新准确成果</button>}
    {loading ? <p role="status">正在读取原任务…</p> : taskId && !rows.length && !error && <p>原任务尚无可供交接的准确成果。</p>}
    {rows.map(row => <div key={row.id}><label><input type="checkbox" checked={selections.some(s => s.id === row.id)} onChange={event => setSelections(prev => event.target.checked ? [...prev, row] : prev.filter(s => s.id !== row.id))}/> {row.kind === 'report' ? row.relativePath : '原会话回复 · ' + row.messageId} <small>{row.sha256.slice(0, 12)}</small></label> <button className="text-button" type="button" onClick={() => void show(row)}>查看准确来源</button></div>)}
    {next && <button type="button" onClick={() => void more()}>更多成果</button>}
    {preview && <pre className="case-evidence-text">{preview}</pre>}
    {error && <p role="alert">{error}</p>}
    {!!selections.length && <><p>已选 {selections.map(row => row.taskName + ' · ' + row.sha256.slice(0, 8)).join('、')}</p><button type="button" className="primary-button" disabled={!!project.archivedAt} onClick={handoff}>核对输入并新建 Task</button></>}
  </section>;
}

export function TaskAssignmentPanel({ project, task, busy, onUpdated, onCreate }: { project: ClientProject; task: ClientTask; busy: boolean; onUpdated: (task: ClientTask) => void; onCreate: Create }) {
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [openSources, setOpenSources] = useState(false);
  const choice = task.assignment, agreement = choice?.agreementVersion && project.agreements?.find(row => row.version === choice.agreementVersion);
  return <details className="harness-panel"><summary>{choice ? taskPurpose[choice.type].label : '旧任务 · 未分类'} · 交接与依据</summary>
    {choice && <><p>{taskPurpose[choice.type].deliverable}</p>
      <label><input type="checkbox" checked={!!choice.skill} disabled={busy || saving || !!project.archivedAt || !!task.archivedAt || !approvedTaskSkills[choice.type]} onChange={async event => {
        const enabled = event.target.checked; setSaving(true); setError('');
        try { onUpdated(await setDefaultTaskSkill(project.id, task.id, enabled)); } catch (reason) { setError(failure(reason)); } finally { setSaving(false); }
      }}/> {taskPurpose[choice.type].skill} {choice.skill?.version ?? (approvedTaskSkills[choice.type] ? '（已取消）' : '（等待独立测评确认）')}</label></>}
    {project.goalOrigin && !choice?.issue && <p>项目承接 GSA · 目标准确版 v{project.goalOrigin.goal.version} · {project.goalOrigin.goal.goalId}</p>}
    {agreement && <p>本任务共用约定 v{agreement.version} · {agreement.text}</p>}
    {choice?.planAgreement && <p>本任务复用原确认方案 v{choice.planAgreement.version} · {choice.planAgreement.confirmationId}</p>}
    {choice?.issue && <p>Case {choice.issue.caseId} · 事项 {choice.issue.issueId}{choice.issue.choiceId && ' · 取舍 ' + choice.issue.choiceId}</p>}
    {choice?.sources?.map(source => <p key={source.key}>输入 · {project.tasks.find(t => t.id === source.taskId)?.name ?? source.taskId} · <code>{source.key}</code></p>)}
    <button className="text-button" type="button" onClick={() => setOpenSources(value => !value)} aria-expanded={openSources}>交给下一 Task</button>
    {openSources && <ResultPicker project={project} sourceTask={task} onCreate={onCreate}/>}
    {error && <p role="alert">{error}</p>}
  </details>;
}

function StagePanel({ project, onRefresh }: { project: ClientProject; onRefresh: () => Promise<void> }) {
  const latest = project.stages?.at(-1);
  const [draft, setDraft] = useState<ProjectStageInput>();
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  function edit(done: boolean) {
    setError('');
    setDraft({ expectedVersion: latest?.version ?? 0, operationId: crypto.randomUUID(),
      goal: latest?.done ? '' : latest?.goal ?? '', condition: latest?.done ? '' : latest?.condition ?? '', done });
  }
  async function save() {
    if (!draft || saving) return;
    setSaving(true); setError('');
    try { await setProjectStage(project.id, draft); await onRefresh(); setDraft(undefined); }
    catch (reason) { setError(failure(reason)); await onRefresh().catch(() => {}); }
    finally { setSaving(false); }
  }
  return <section className="project-plan-section"><h2>阶段目标</h2>
    {latest && <p>{[latest.goal, latest.condition].filter(Boolean).join(' · ')} · {latest.done ? '已结束' : '进行中'}</p>}
    {draft ? <><label>阶段目标<textarea maxLength={2000} value={draft.goal} disabled={saving || draft.done} onChange={e => setDraft({ ...draft, goal: e.target.value, operationId: crypto.randomUUID() })}/></label>
      <label>结束条件<textarea maxLength={2000} value={draft.condition} disabled={saving || draft.done} onChange={e => setDraft({ ...draft, condition: e.target.value, operationId: crypto.randomUUID() })}/></label>
      <button type="button" className="primary-button" disabled={saving || !(draft.goal.trim() || draft.condition.trim())} onClick={() => void save()}>{draft.done ? '确认结束阶段' : '保存阶段目标'}</button> <button type="button" disabled={saving} className="text-button" onClick={() => setDraft(undefined)}>取消</button></> :
      <><button type="button" className="secondary-button" onClick={() => edit(false)}>{latest && !latest.done ? '调整阶段目标' : '设置阶段目标'}</button> {latest && !latest.done && <button type="button" className="text-button" onClick={() => edit(true)}>结束本阶段</button>}</>}
    {!!project.stages?.length && <details><summary>阶段记录</summary>{project.stages.map(row => <p key={row.version}>v{row.version} · {[row.goal, row.condition].filter(Boolean).join(' · ')} · {row.done ? '已结束' : '进行中'}</p>)}</details>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function ProjectWorkBasis({projectId,issue,version}:{projectId:string;issue?:IssueScope;version?:number}) {
  const [basis,setBasis]=useState<{goal?:{title:string;goal:{version:number};outcome:string;usageContext:{background:string};scope:{name:string};strategies?:string[];source?:{authority:string;id:string;version:string|number};evidence?:{original?:{description?:string}}[]};case?:{description?:string};strategy?:string;decision?:{reason?:string}}>();
  const [error,setError]=useState('');
  const owner=JSON.stringify({role:'project',projectId,...(issue?{issue}:{})});
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/api/business-role?'+ new URLSearchParams({owner,action:'origin'}),{signal:controller.signal,credentials:'omit',cache:'no-store',headers:{'x-optracall-client':'1'}}).then(async response=>{
      if(!response.ok)throw Error('原目标或事项依据当前不可读，请核对权限及准确来源。');
      const value=await response.json();if(!controller.signal.aborted)setBasis(value.origin);
    }).catch(reason=>{if(!controller.signal.aborted){setBasis(undefined);setError(failure(reason));}});
    return ()=>controller.abort();
  },[owner]);
  return <section className="project-plan-section" aria-label="项目承接依据"><h2>{issue?'事项依据':'来源 GSA'}{version ? ' · v'+version : ''}</h2>
    {basis?.goal && <><p>{basis.goal.title} · v{basis.goal.goal.version} · {basis.goal.scope.name}</p><p>{basis.goal.outcome}</p>
      {basis.goal.strategies?.map(strategy=><p key={strategy}>{strategy}</p>)}<p>{basis.goal.usageContext.background}</p>
      {basis.goal.source && <p>原依据 · {basis.goal.source.authority} · {basis.goal.source.id} · v{basis.goal.source.version}</p>}
      {basis.goal.evidence?.map((item,index)=>item.original?.description && <p key={index}>{item.original.description}</p>)}</>}
    {basis?.case?.description && <p>{basis.case.description}</p>}{basis?.decision?.reason && <p>{basis.decision.reason}</p>}{error && <p role="alert">{error}</p>}</section>;
}

export function ProjectCollaboration({ project, issue, onChangeScope, onReturnIssue, onCreate, onRefresh, onHistory }: { project: ClientProject; issue?: IssueScope; onChangeScope: (issue?: IssueScope) => void; onReturnIssue: (issue: IssueScope) => void; onCreate: Create; onRefresh: () => Promise<void>; onHistory: () => void }) {
  const [linkedIssues, setLinkedIssues] = useState<(IssueScope & {title:string})[]>([]);
  useEffect(() => {
    let current = true;
    async function loadIssues() {
      if ((await caseStorage()).state !== 'ready') return;
      const { projectLinks } = await listCases();
      const links = projectLinks.filter(link => link.projectId === project.id);
      const results = await Promise.allSettled(links.map(link => caseIssues(link.caseId)));
      if (current) setLinkedIssues(results.flatMap(result => result.status === 'fulfilled' ? result.value.issues.map(row => ({caseId:row.caseId,issueId:row.id,title:row.title})) : []));
    }
    void loadIssues().catch(() => { if (current) setLinkedIssues([]); });
    return () => { current = false; };
  }, [project.id]);
  const scopes = new Map<string, IssueScope & {title?:string}>();
  for (const scope of [issue, ...linkedIssues]) if (scope) scopes.set(scope.caseId + '/' + scope.issueId, scope);
  const scopedTasks = project.tasks.filter(task => !task.assignment?.issue || task.assignment.issue.caseId === issue?.caseId && task.assignment.issue.issueId === issue.issueId);
  const create: Create = intent => onCreate({ ...issue, ...intent });

  const [tab, setTab] = useState<'work' | 'terms' | 'results' | 'stage'>('work');
  const [draft, setDraft] = useState<{ text: string; expectedVersion: number; operationId: string }>();
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const latest = project.agreements?.at(-1);
  async function save() {
    if (!draft || saving) return;
    setSaving(true); setError('');
    try { await confirmProjectAgreement(project.id, draft); await onRefresh(); setDraft(undefined); }
    catch (reason) { setError(failure(reason)); await onRefresh().catch(() => {}); }
    finally { setSaving(false); }
  }
  return <section className="project-plan-page" aria-label="项目协作">
    <header className="case-board-heading"><div><p className="eyebrow">项目空间</p><h1>{project.name}</h1></div><button className="primary-button" type="button" onClick={() => create()}>{project.tasks.length ? '新建任务' : '新建第一个任务'}</button></header>
    <nav className="case-project-actions" aria-label="项目协作栏目">{([['work','Project Agent'], ['terms','共用约定'], ['results','成果交接'], ['stage','阶段目标']] as const).map(([value, label]) => <button type="button" key={value} className={tab === value ? 'primary-button' : 'secondary-button'} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</nav>
    {!!scopes.size && <div className="case-inline-actions"><label>项目工作范围 <select value={issue ? issue.caseId + '/' + issue.issueId : ''} onChange={event => onChangeScope(scopes.get(event.target.value))}>
      <option value="">独立项目工作</option>{[...scopes].map(([key, value]) => <option key={key} value={key}>{value.title ?? '原事项'} · {value.caseId.slice(0,8)} / {value.issueId.slice(0,8)}</option>)}</select></label>
      {issue && <button type="button" className="text-button" onClick={() => onReturnIssue(issue)}>返回原 Case 事项</button>}</div>}
    {tab==='work' && (issue||project.goalOrigin) && <ProjectWorkBasis projectId={project.id} issue={issue} version={issue?undefined:project.goalOrigin?.goal.version}/>}
    <div hidden={tab !== 'work'}><BusinessRoleConversation owner={{ role: 'project', projectId: project.id, ...(issue ? {issue} : {}) }}/></div>
    {tab === 'terms' && <section className="project-plan-section"><h2>共用约定</h2>{!latest && <p>多个任务需要相同口径、范围或前提时，可在这里共同确定。</p>}
      {project.agreements?.map(item => <p key={item.version}><strong>v{item.version}</strong> · {item.text}</p>)}
      {draft ? <><label>待确认内容<textarea maxLength={8000} value={draft.text} disabled={saving} onChange={event => setDraft({ ...draft, text: event.target.value, operationId: crypto.randomUUID() })}/></label><button className="primary-button" type="button" disabled={!draft.text.trim() || saving || draft.text.trim() === latest?.text} onClick={() => void save()}>确认共用约定</button><button className="text-button" type="button" disabled={saving} onClick={() => { setDraft(undefined); setError(''); }}>取消</button></> : <button className="secondary-button" type="button" onClick={() => setDraft({ text: latest?.text ?? '', expectedVersion: latest?.version ?? 0, operationId: crypto.randomUUID() })}>{latest ? '调整共用约定' : '拟定共用约定'}</button>}
      {error && <p role="alert">{error}</p>}<button type="button" className="text-button" onClick={onHistory}>查看原项目方案与历史回执</button></section>}
    {tab === 'stage' && <StagePanel project={project} onRefresh={onRefresh}/>}
    {tab === 'results' && <ResultPicker project={{ ...project, tasks: scopedTasks }} onCreate={create}/>}
  </section>;
}
