import type { ReactNode } from 'react';
import type { CaseDecisionIssue } from '../case-decision-types.ts';
import type { CaseProjectLink, CaseRecord } from '../case-types.ts';
import { taskPurpose, taskTypes } from '../task-assignment.ts';
import { caseTasksInScope, type CaseAuxScope } from './case-board-navigation-model.ts';
import { caseDate, workStatusLabel } from './CaseDialogs.tsx';
import type { ClientProject, ClientTask } from './project-types.ts';
import './daily-case-projects.css';

export type DailyCaseProjectsProps = {
  record: CaseRecord;
  issues: readonly CaseDecisionIssue[];
  scope: CaseAuxScope;
  scopeControl: ReactNode;
  /** Already filtered by the Case board; an empty project remains reachable in all-Case scope. */
  linkedProjects: readonly { link: CaseProjectLink; project: ClientProject | undefined }[];
  projectLinks: readonly CaseProjectLink[];
  onLinkProject: () => void;
  onEditWork: (project: ClientProject) => void;
  onUnlinkProject: (projectId: string, projectName: string) => void;
  onOpenTask: (project: ClientProject, task: ClientTask) => void;
  onContinueTask: (project: ClientProject, task: ClientTask) => void;
  onOpenProject?: (project: ClientProject) => void;
  onCreateTask: (project: ClientProject) => void;
};

const runLabels = {
  running: '正在运行', completed: '最近运行完成', cancelled: '最近运行已取消',
  failed: '最近运行失败', interrupted: '最近运行已中断',
};

function FolderIcon() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 6.5h6l2 2h10v10H3z" /><path d="M3 6.5v-2h7l2 2h9v2" /></svg>;
}

function ExternalIcon() {
  return <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 5H4v15h15v-6" /></svg>;
}

/** Presents existing Case/project/task records; navigation and all writes remain with the board. */
export function DailyCaseProjects({ record, issues, scope, scopeControl, linkedProjects, projectLinks, onLinkProject, onEditWork, onUnlinkProject, onOpenTask, onContinueTask, onOpenProject, onCreateTask }: DailyCaseProjectsProps) {
  const active = record.status !== 'closed';
  return <section className="daily-case-tab-page daily-case-projects" aria-label="项目与任务">
    <header className="dcp-page-heading">
      <div><h2>项目与任务</h2><p>在共享项目里做具体工作，保留任务原来的会话与成果。</p></div>
      <span className="dcp-scope-badge">{record.title}</span>
    </header>
    {scopeControl}
    {!linkedProjects.length && <p className="dcp-outcome-note">{scope.mode === 'issue' ? '当前事项范围内暂无明确关联任务。可以切换全部当前 Case 查看已有项目。' : '尚未关联项目。可以关联现有项目，也可以新建并关联。'}切换浏览范围不会创建任务。</p>}
    {linkedProjects.map(({ link, project }) => {
      const tasks = project ? caseTasksInScope(project.tasks, record.id, scope) : [];
      const canWork = active && project && !project.archivedAt;
      return <section className="dcp-project-section" key={link.projectId} aria-label={project?.name ?? '原项目暂不可用'}>
        <div className="dcp-project-heading">
          <div className="dcp-project-title"><FolderIcon /><h3>{project && onOpenProject ? <button type="button" onClick={() => onOpenProject(project)}>{project.name}</button> : project?.name ?? '原项目暂不可用'}</h3><small>原项目 · {project?.archivedAt ? '已归档只读' : project ? '查看全局工作' : '关联仍保留'}</small></div>
          <span className="dcp-scope-badge">{tasks.length} 个任务</span>
        </div>
        {project ? <>
          {tasks.length > 0 ? <div className="dcp-table-wrap" tabIndex={0} role="region" aria-label={`${project.name}原任务表`}>
            <table className="dcp-task-table">
              <colgroup><col style={{ width: '43%' }} /><col style={{ width: '24%' }} /><col style={{ width: '17%' }} /><col style={{ width: '16%' }} /></colgroup>
              <thead><tr><th scope="col">原任务</th><th scope="col">用途</th><th scope="col">当前记录</th><th scope="col">继续工作</th></tr></thead>
              <tbody>{tasks.map(task => <tr key={task.id}>
                <td><button type="button" className="dcp-task-name" onClick={() => onOpenTask(project, task)}>{task.name}<small>原关联：{record.title} / {issues.find(issue => issue.id === task.assignment?.issue?.issueId)?.title ?? '原事项暂不可读取'}</small></button></td>
                <td><span className="dcp-task-type">{task.assignment ? taskPurpose[task.assignment.type].label : '用途未设置'}</span></td>
                <td><span className={`dcp-task-status${task.lastRun?.status === 'completed' && !task.archivedAt ? ' is-recorded' : ''}`}>{task.archivedAt ? '任务已归档' : task.lastRun ? runLabels[task.lastRun.status] : '尚无运行记录'}</span><small className="dcp-updated">更新于 {caseDate(task.updatedAt)}</small></td>
                <td><button type="button" className="dcp-source-link" onClick={() => onOpenTask(project, task)}>打开原任务 <ExternalIcon /></button></td>
              </tr>)}</tbody>
            </table>
          </div> : <p className="dcp-empty">{scope.mode === 'all' ? '尚无明确归属本 Case 的任务。' : '当前事项范围内暂无明确关联任务。'}原项目的其他 Case 任务和未绑定任务仍在原项目中；项目关联不改变任务归属。</p>}
          {project.archivedAt && <p className="dcp-readonly-note">项目已归档。可以查看原任务；请先从全部项目恢复，再编辑或继续任务。</p>}
          <details className="dcp-project-management">
            <summary>项目共用信息与管理</summary>
            <p>{project.tasks.length} 个原任务 · {projectLinks.filter(item => item.projectId === project.id).length} 个 Case 共用 · {project.workUnavailable ? '工作信息暂不可用' : project.work?.workStatus ? workStatusLabel[project.work.workStatus] : '工作状态未设置'}</p>
            <dl><div><dt>承接人</dt><dd>{project.workUnavailable ? '暂不可读取' : project.work?.assignee || '未设置'}</dd></div><div><dt>工作范围</dt><dd>{project.workUnavailable ? '暂不可读取' : project.work?.workScope || '未设置'}</dd></div><div><dt>下一步</dt><dd>{project.workUnavailable ? '暂不可读取' : project.work?.nextStep || '未设置'}</dd></div>{!project.workUnavailable && project.work?.statusReason && <div><dt>状态说明</dt><dd>{project.work.statusReason}</dd></div>}</dl>
            <div className="dcp-management-actions">
              {onOpenProject && <button type="button" className="dcp-source-link" onClick={() => onOpenProject(project)}>打开原项目（全部任务） <ExternalIcon /></button>}
              {canWork && <button type="button" className="dcp-source-link" onClick={() => onCreateTask(project)}>＋ 在项目中新建任务</button>}
              {canWork && !project.workUnavailable && <button type="button" className="dcp-source-link" onClick={() => onEditWork(project)}>编辑工作信息</button>}
              {active && <button type="button" className="dcp-source-link" onClick={() => onUnlinkProject(link.projectId, project.name)}>解除关联</button>}
            </div>
            {canWork && tasks.length > 0 && <div className="dcp-continue-options"><p>带着此 Case 继续协作（明确选择后进入原任务）</p>{tasks.map(task => <div key={task.id}><span>{task.name}</span><button type="button" className="dcp-source-link" disabled={Boolean(project.workUnavailable || task.archivedAt)} onClick={() => onContinueTask(project, task)}>按此 Case 继续</button></div>)}</div>}
          </details>
        </> : <><p className="dcp-empty">关联仍保留，请检查项目目录。</p>{active && <details className="dcp-project-management"><summary>管理项目关联</summary><button type="button" className="dcp-source-link" onClick={() => onUnlinkProject(link.projectId, '此项目')}>解除关联</button></details>}</>}
      </section>;
    })}
    <details className="dcp-type-guide">
      <summary>六类任务分别用来做什么？<span>按需要选用，可以重复，也可以缺少</span></summary>
      <div className="dcp-type-grid">{taskTypes.map(type => <div key={type}><strong>{taskPurpose[type].label}</strong><p>{taskPurpose[type].deliverable}</p></div>)}</div>
    </details>
    <div className="dcp-outcome-note">项目由多个事项共享。打开原任务只是查看已有内容；带着此 Case 继续协作需要明确选择。最近运行完成不等于目标已经达成。</div>
    {active && <details className="dcp-project-management dcp-link-management"><summary>关联项目</summary><p>项目业务信息全局共享，任务与文件仍属于原项目；共享项目不代表其中全部资料自动属于此 Case。</p><button type="button" className="secondary-button" onClick={onLinkProject}>＋ 关联项目</button></details>}
  </section>;
}
