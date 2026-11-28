import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CaseList, WorkEvent } from '../case-types.ts';
import { taskPurpose, taskTypes, type TaskType } from '../task-assignment.ts';
import type { ClientProject, ClientTask } from './project-types.ts';
import * as api from './case-client.ts';
import { CaseFormError, EventHistory, NoteDialog, WorkEditor, caseDate, caseError, caseStatusLabel, workStatusLabel, focusCaseButton } from './CaseDialogs.tsx';
import { summarizeProjectTaskTypes } from './workspace-home-model.ts';
import './case-board.css';
import './daily-projects.css';

export type ProjectBoardProps = {
  visible?: boolean;
  projects: ClientProject[]; mode?: 'cards' | 'list'; onModeChange?: (mode: 'cards' | 'list') => void;
  onOpenTask: (project: ClientProject, task: ClientTask) => void;
  onOpenCase?: (caseId: string, projectId?: string) => void;
  onOpenPlan?: (project: ClientProject) => void;
  onOpenWorkflow?: (project: ClientProject, target: 'requirement' | 'refiner' | 'simlab') => void;
  onOpenCollaboration?: (project: ClientProject) => void;
  onAdvancedTask?: (project: ClientProject) => void;
  onCreateProject: () => void; onCreateTask: (project: ClientProject) => void;
  onRename: (project: ClientProject, trigger: HTMLElement) => void;
  onArchive: (project: ClientProject) => void; onRestore: (project: ClientProject) => void;
  onProjectChange: () => Promise<void>;
  initialProjectId?: string; initialProjectSeq?: number; onInitialProjectClose?: () => void;
};
export function ProjectBoard({ visible = true, onOpenCase, onOpenCollaboration, onOpenPlan, onOpenWorkflow, onAdvancedTask, projects, onOpenTask, onCreateProject, onCreateTask, onRename, onArchive, onRestore, onProjectChange, initialProjectId, initialProjectSeq, onInitialProjectClose }: ProjectBoardProps) {
  const [filter, setFilter] = useState<'all' | 'independent' | 'shared' | 'archived'>('all'), [query, setQuery] = useState(''), [caseData, setCaseData] = useState<CaseList | null>(null), [caseState, setCaseState] = useState<'loading' | 'ready' | 'uninitialized' | 'unavailable'>('loading'), [error, setError] = useState(''), [notice, setNotice] = useState(''), [selectedId, setSelectedId] = useState<string | null>(null), [taskTypeFilter, setTaskTypeFilter] = useState<'all' | TaskType | 'unassigned'>('all'), [editing, setEditing] = useState<{ kind: 'work' | 'note'; project: ClientProject } | null>(null), [events, setEvents] = useState<WorkEvent[]>([]), [eventError, setEventError] = useState(''), [eventLoading, setEventLoading] = useState(false);
  const selectedRef = useRef(selectedId), eventRequest = useRef(0); selectedRef.current = selectedId;
  const id = useId(), selected = projects.find(project => project.id === selectedId);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const lastProjectTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (visible) pageHeading.current?.focus({ preventScroll: true }); }, [visible, selectedId]);
  useEffect(() => { if (initialProjectId) { if (initialProjectId !== selectedRef.current) setTaskTypeFilter('all'); setSelectedId(initialProjectId); } }, [initialProjectId, initialProjectSeq]);
  const dismissProject = () => { setSelectedId(null); setTaskTypeFilter('all'); if (initialProjectId && selectedId === initialProjectId) onInitialProjectClose?.(); requestAnimationFrame(() => { if (lastProjectTrigger.current?.isConnected) lastProjectTrigger.current.focus({ preventScroll: true }); }); };
  const openProject = (project: ClientProject, trigger?: HTMLButtonElement) => { if (trigger) lastProjectTrigger.current = trigger; setSelectedId(project.id); setTaskTypeFilter('all'); };
  const caseRequest = useRef<AbortController | null>(null);
  const readCases = useCallback(async () => {
    caseRequest.current?.abort();
    const controller = new AbortController();
    caseRequest.current = controller;
    const { signal } = controller;
    setCaseData(null);
    setCaseState('loading');
    setError('');
    try {
      const storage = await api.status(signal);
      const data = storage.state === 'ready' ? await api.list(signal) : null;
      if (!signal.aborted) {
        setCaseData(data);
        setCaseState(storage.state);
      }
    } catch (error) {
      if (!signal.aborted) {
        setCaseState('unavailable');
        if (error instanceof api.CaseRequestError && error.status === 403) { setEditing(null); setEvents([]); }
        setError(error instanceof api.CaseRequestError && error.status === 403 ? '当前身份无权读取 Case 关联。' : caseError(error));
      }
    }
  }, []);
  useEffect(() => {
    if (!visible) { caseRequest.current?.abort(); return; }
    void readCases();
    return () => caseRequest.current?.abort();
  }, [readCases, visible]);
  const readEvents = async (projectId: string) => { const request = ++eventRequest.current; setEventLoading(true); setEventError(''); try { const result = await api.projectEvents(projectId); if (selectedRef.current === projectId && eventRequest.current === request) setEvents(result.events); } catch (error) { if (selectedRef.current === projectId && eventRequest.current === request) { if (error instanceof api.CaseRequestError && error.status === 403) setEvents([]); setEventError(caseError(error)); } } finally { if (selectedRef.current === projectId && eventRequest.current === request) setEventLoading(false); } };
  useEffect(() => {
    setEvents([]);
    setEventError('');
    setEventLoading(false);
    if (selectedId && caseState === 'ready') void readEvents(selectedId);
    return () => { eventRequest.current++; };
  }, [selectedId, caseState]);
  const afterSave = async () => { setNotice('项目工作信息已保存，所有关联 Case 共用这次修改。'); try { await Promise.all([onProjectChange(), readCases()]); } catch (error) { setError(`保存已完成，刷新时遇到问题：${caseError(error)}`); } };
  const links = (project: ClientProject) => caseData?.projectLinks.filter(link => link.projectId === project.id) ?? [];
  const associationsKnown = caseState === 'ready' || caseState === 'uninitialized';
  const matchesFilter = (project: ClientProject, value: typeof filter) => value === 'all' || (value === 'archived' ? Boolean(project.archivedAt) : associationsKnown && (value === 'shared' ? links(project).length > 1 : links(project).length === 0));
  const filtered = projects.filter(project => matchesFilter(project, filter) && [project.name, project.work?.workScope ?? '', project.work?.assignee ?? '', project.work?.nextStep ?? '', ...links(project).map(link => caseData?.cases.find(record => record.id === link.caseId)?.title ?? '')].join('\n').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const countLabel = (project: ClientProject) => associationsKnown ? links(project).length ? `${links(project).length} 个关联 Case` : '独立项目，无关联 Case' : caseState === 'loading' ? '正在读取 Case 关联' : 'Case 关联暂不可用';
  const workLabel = (project: ClientProject) => project.workUnavailable || caseState === 'unavailable' ? '工作信息暂不可用' : project.work?.workStatus ? workStatusLabel[project.work.workStatus] : '未设置状态';
  const canEdit = (project: ClientProject) => caseState === 'ready' && !project.archivedAt && !project.workUnavailable;
  const assignee = (project: ClientProject) => project.workUnavailable ? '承接人暂不可读取' : project.work?.assignee || '承接人未设置';
  const nextStep = (project: ClientProject) => project.workUnavailable ? '下一步暂不可读取' : project.work?.nextStep || '下一步待补充';
  const status = (project: ClientProject) => project.archivedAt ? '已归档' : workLabel(project);
  const taskState = (task: ClientTask) => task.archivedAt ? '已归档' : task.lastRun ? ({ running: '运行中', completed: '最近运行完成', cancelled: '最近运行已取消', failed: '最近运行失败', interrupted: '最近运行已中断' })[task.lastRun.status] : '尚无运行记录';
  const caseLinks = (project: ClientProject) => !associationsKnown
    ? <span className="daily-project-independent">{countLabel(project)}</span>
    : links(project).length ? links(project).map(link => {
      const record = caseData?.cases.find(item => item.id === link.caseId);
      return record && onOpenCase ? <button type="button" className="daily-project-case-chip" key={link.caseId} title={`${record.title} · ${caseStatusLabel[record.status]}`} onClick={() => onOpenCase(record.id, project.id)}>{record.title}<span aria-hidden="true"> →</span></button> : <span className="daily-project-independent" key={link.caseId}>{record?.title ?? '关联 Case 暂不可用'}</span>;
    }) : <span className="daily-project-independent">独立项目 · 无关联 Case</span>;
  const selectedTypeSummary = selected ? summarizeProjectTaskTypes(selected.tasks) : null;
  const filteredSelectedTasks = selected ? selected.tasks.filter(task => taskTypeFilter === 'all' ? true : taskTypeFilter === 'unassigned' ? !task.assignment : task.assignment?.type === taskTypeFilter) : [];
  const agreement = selected?.agreements?.reduce<(NonNullable<ClientProject['agreements']>[number]) | undefined>((latest, current) => !latest || current.version > latest.version ? current : latest, undefined);
  const refresh = async () => { setError(''); try { await Promise.all([onProjectChange(), readCases()]); } catch (error) { setError(caseError(error)); } };
  const projectActions = (project: ClientProject) => <div className="case-project-actions">
    {onOpenCollaboration && <button type="button" className="secondary-button" onClick={() => onOpenCollaboration(project)}>Project Agent</button>}
    {onOpenPlan && <button type="button" className="text-button" onClick={() => onOpenPlan(project)}>项目需求与任务方案</button>}
    {!project.archivedAt && <button type="button" className="text-button" onClick={event => onRename(project, event.currentTarget)}>重命名项目</button>}
    {onOpenWorkflow && <><button type="button" className="text-button" onClick={() => onOpenWorkflow(project, 'requirement')}>需求与 RAP 历史</button><button type="button" className="text-button" onClick={() => onOpenWorkflow(project, 'simlab')}>方案比较与经营推演</button><button type="button" className="text-button" onClick={() => onOpenWorkflow(project, 'refiner')}>PPT 精修与版本历史</button></>}
    {onAdvancedTask && !project.archivedAt && <button type="button" className="text-button" onClick={() => onAdvancedTask(project)}>旧版任务配置</button>}
  </div>;
  return <section className="case-board project-board daily-projects" aria-labelledby={selected ? `${id}-project-title` : 'project-board-title'} onClickCapture={focusCaseButton}>
    <div className="daily-projects-inner">
      <CaseFormError error={error} />
      {notice && <p className="case-notice" role="status">{notice}</p>}
      {caseState === 'uninitialized' && <p className="daily-project-notice">项目和任务可直接使用。启用 Case 记录后可补充工作信息与关联。</p>}
      {caseState === 'unavailable' && <p className="daily-project-notice">Case 关联和工作信息暂不可读取，项目、原任务与文件仍可使用。<button type="button" className="text-button" onClick={() => { void readCases(); }}>重新检查</button></p>}
      {!selected && <>
        <header className="daily-project-heading">
          <div><p className="daily-project-eyebrow">PROJECTS · ALL WORKSPACES</p><h1 id="project-board-title" ref={pageHeading} tabIndex={-1}>全部项目</h1><p>同一项目只出现一次。跨 Case 共用、独立工作和归档资料，都从这里找回。</p></div>
          <div className="daily-project-heading-actions"><span>全局项目集合 · 不随当前 Case 改变</span><button type="button" className="secondary-button" onClick={onCreateProject}>＋ 新建项目</button></div>
        </header>
        {selectedId && <p className="daily-project-notice">原项目当前不可读取，仍可浏览其他获准项目。<button type="button" className="text-button" onClick={dismissProject}>返回全部项目</button></p>}
        <div className="daily-project-tools">
          <div className="daily-project-filters" role="group" aria-label="项目筛选">
            {([['all', '全部'], ['independent', '独立'], ['shared', '共享'], ['archived', '归档']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} disabled={(value === 'independent' || value === 'shared') && !associationsKnown} onClick={() => setFilter(value)}>{label}<span>{(value === 'independent' || value === 'shared') && !associationsKnown ? '—' : projects.filter(project => matchesFilter(project, value)).length}</span></button>)}
          </div>
          <div className="daily-project-search-actions"><label className="daily-project-search" htmlFor={`${id}-search`}><span aria-hidden="true">⌕</span><input type="search" id={`${id}-search`} placeholder="搜索项目、承接人或关联 Case" aria-label="搜索项目" value={query} onChange={event => setQuery(event.target.value)} /></label><button type="button" className="text-button" onClick={() => { void refresh(); }}>刷新</button></div>
        </div>
        <div className="daily-project-list">
          <div className="daily-project-row daily-project-row-head" aria-hidden="true"><span>项目与关联 Case</span><span>当前状态</span><span>承接人与下一步</span><span>任务</span><span /></div>
          {filtered.length ? filtered.map(project => <article className="daily-project-row" key={project.id}>
            <div className="daily-project-name"><h2><button type="button" onClick={event => openProject(project, event.currentTarget)}>{project.name}</button></h2><div className="daily-project-case-links">{caseLinks(project)}</div></div>
            <div><span className={`daily-project-status ${project.archivedAt ? 'archived' : project.work?.workStatus === 'awaiting_feedback' ? 'waiting' : ''}`}>{status(project)}</span></div>
            <div className="daily-project-next"><strong>{assignee(project)}</strong>{project.archivedAt ? '资料只读留存，恢复后可继续工作' : nextStep(project)}</div>
            <div className="daily-project-task-count" aria-label={`${project.tasks.length} 个任务`}>{project.tasks.length}</div>
            <button type="button" className="daily-project-open" aria-label={`打开项目 ${project.name}`} onClick={event => openProject(project, event.currentTarget)}>→</button>
          </article>) : <div className="daily-project-empty"><h2>{projects.length ? '没有匹配的项目' : '建立第一个项目空间'}</h2><p>{!associationsKnown && (filter === 'independent' || filter === 'shared') ? 'Case 关联尚不可读取，请切换“全部”或稍后重试。' : projects.length ? '可以调整搜索词或切换筛选。' : '可以直接创建项目和任务，按需要再关联 Case。'}</p>{!projects.length && <button type="button" className="secondary-button" onClick={onCreateProject}>新建项目</button>}</div>}
        </div>
        <p className="daily-project-caption">显示 {filtered.length} / {projects.length} 个项目 · “全部”包含归档；“独立”表示未关联 Case</p>
      </>}
      {selected && <div className="daily-project-detail" data-project-id={selected.id}>
        <button type="button" className="daily-project-back" onClick={dismissProject}><span aria-hidden="true">←</span>{initialProjectId && selectedId === initialProjectId && onInitialProjectClose ? '返回来源位置' : '返回全部项目 · 保留搜索与筛选'}</button>
        <header className="daily-project-detail-header">
          <div><p className="daily-project-eyebrow">PROJECT · SHARED WORKSPACE</p><div className="daily-project-detail-title"><h1 id={`${id}-project-title`} ref={pageHeading} tabIndex={-1}>{selected.name}</h1><span className={`daily-project-status ${selected.archivedAt ? 'archived' : ''}`}>{status(selected)}</span></div><p className="daily-project-detail-meta">{assignee(selected)} · {selected.tasks.length} 个原任务 · {countLabel(selected)}</p></div>
          <button type="button" className="secondary-button" onClick={() => selected.archivedAt ? onRestore(selected) : onArchive(selected)}>{selected.archivedAt ? '恢复项目' : '归档项目'}</button>
        </header>
        {selected.archivedAt && <p className="daily-project-readonly">此项目已归档，任务、资料与原记录只读。恢复只改变本项目状态，不改变任何 Case、事项或历史结论。</p>}
        <section className="daily-project-shared-info" aria-label="项目共用工作信息">
          <div className="daily-project-information">
            <div><h2>项目共用工作信息</h2><p>{selected.workUnavailable ? '工作范围暂不可读取。' : selected.work?.workScope || '尚未设置项目工作范围。'}</p>{agreement ? <><p>{agreement.text}</p><small>已确认项目约定 v{agreement.version} · {caseDate(agreement.confirmedAt)}</small></> : <p className="daily-project-muted">共用资料和约定按项目原记录保留。</p>}<div className="daily-project-info-links">{onOpenCollaboration && <button type="button" className="text-button" onClick={() => onOpenCollaboration(selected)}>打开项目空间，查看资料与约定 ↗</button>}{canEdit(selected) && <button type="button" className="text-button" onClick={() => setEditing({ kind: 'work', project: selected })}>编辑工作信息</button>}</div></div>
            <div><h2>当前承接与下一步</h2><p>{assignee(selected)}</p><p>{selected.archivedAt ? '资料留存，需继续时恢复项目。' : nextStep(selected)}</p>{selected.work?.statusReason && <p>{selected.work.statusReason}</p>}<small>项目工作范围独立于任何一次 Case 浏览。</small></div>
          </div>
          <div className="daily-project-detail-cases"><span>关联 Case</span>{caseLinks(selected)}</div>
        </section>
        <section className="daily-project-tasks" aria-labelledby={`${id}-tasks-title`}>
          <div className="daily-project-section-heading"><div><h2 id={`${id}-tasks-title`}>项目内任务</h2><p>六类用途按需要使用；未出现的类型无需补齐。查看原任务不会自动带入任何 Case 或事项。</p></div>{!selected.archivedAt && <button type="button" className="secondary-button" onClick={() => onCreateTask(selected)}>＋ 新建任务</button>}</div>
          {selectedTypeSummary && <div className="daily-project-type-tabs project-task-types" role="group" aria-label="按六类任务筛选">
            <button type="button" aria-pressed={taskTypeFilter === 'all'} onClick={() => setTaskTypeFilter('all')}>全部 <span>{selectedTypeSummary.total}</span></button>
            {taskTypes.map(type => <button key={type} type="button" aria-pressed={taskTypeFilter === type} onClick={() => setTaskTypeFilter(type)}>{taskPurpose[type].label} <span>{selectedTypeSummary.byType[type]}</span></button>)}
            {selectedTypeSummary.unassigned > 0 && <button type="button" aria-pressed={taskTypeFilter === 'unassigned'} onClick={() => setTaskTypeFilter('unassigned')}>未分类 <span>{selectedTypeSummary.unassigned}</span></button>}
          </div>}
          {filteredSelectedTasks.length ? <div className="daily-project-task-scroll"><table className="daily-project-task-table"><colgroup><col style={{ width: '43%' }} /><col style={{ width: '23%' }} /><col style={{ width: '18%' }} /><col style={{ width: '16%' }} /></colgroup><thead><tr><th scope="col">原任务</th><th scope="col">用途</th><th scope="col">已保存状态</th><th scope="col">查看</th></tr></thead><tbody>{filteredSelectedTasks.map(task => <tr key={task.id}><td><button type="button" className="daily-project-task-name" onClick={() => onOpenTask(selected, task)}>{task.name}</button><small>{task.assignment?.issue ? `原关联：${caseData?.cases.find(record => record.id === task.assignment?.issue?.caseId)?.title ?? 'Case 暂不可读'} · 具体事项见原任务` : '项目共用工作 · 未绑定具体事项'}</small></td><td><span className="daily-project-task-purpose">{task.assignment ? taskPurpose[task.assignment.type].label : '未分类'}</span></td><td><span className={`daily-project-task-status ${task.lastRun?.status === 'completed' ? 'settled' : ''}`}>{taskState(task)}</span></td><td><button type="button" className="text-button" onClick={() => onOpenTask(selected, task)}>{selected.archivedAt || task.archivedAt ? '只读查看' : '打开原任务'} ↗</button></td></tr>)}</tbody></table></div> : <p className="daily-project-no-tasks">{selected.tasks.length ? '此项目尚无这类用途的任务；不会为了齐全而自动创建。' : '此项目还没有任务。已有项目资料和工作信息仍可查看。'}</p>}
          <details className="daily-project-type-guide"><summary>六类任务的用途说明</summary><div>{taskTypes.map(type => <article key={type}><h3>{taskPurpose[type].label}</h3><p>{taskPurpose[type].deliverable}</p></article>)}</div></details>
        </section>
        <details className="daily-project-management"><summary>项目协作、管理与其他业务入口</summary>{projectActions(selected)}</details>
        <details className="daily-project-history"><summary>项目工作记录</summary><div className="daily-project-section-heading"><p>全局记录保留反馈来源与工作信息变更。</p>{canEdit(selected) && <button type="button" className="text-button" onClick={() => setEditing({ kind: 'note', project: selected })}>追加说明</button>}</div>{eventLoading ? <p className="case-help" role="status">正在读取项目记录…</p> : eventError ? <CaseFormError error={eventError} /> : caseState === 'ready' ? <EventHistory events={events} projects={projects} /> : <p className="case-help">{caseState === 'uninitialized' ? 'Case 记录尚未启用。' : '项目工作记录暂不可用。'}</p>}</details>
        <p className="daily-project-caption">共用项目保持同一个身份，进入关联 Case 只改变查看位置。项目资料需要明确关联后才会进入对应 Case 的成果与依据。<br />更新于 {caseDate(selected.updatedAt)}</p>
      </div>}
    </div>
    {visible && editing?.kind === 'work' && <WorkEditor project={editing.project} onClose={() => setEditing(null)} onSave={async (input, operationId) => { await api.saveProjectWork(editing.project.id, { ...input, expectedRevision: editing.project.work?.revision ?? 0, operationId }); await afterSave(); }} />}
    {visible && editing?.kind === 'note' && <NoteDialog title="追加项目工作说明" onClose={() => setEditing(null)} onSave={async (note, feedbackSource, operationId) => { await api.projectNote(editing.project.id, { note, feedbackSource, expectedRevision: editing.project.work?.revision ?? 0, operationId }); await afterSave(); }} />}
  </section>;
}
