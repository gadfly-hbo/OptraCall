import { HomeDailyQuickPanel } from './HomeDailyQuickPanel.tsx';
import type { HomePendingItem } from '../home-pending.ts';
import type { ClientProject } from './project-types.ts';
import { useWorkspaceDeskData } from './use-workspace-desk-data.ts';
import {
  buildWorkspaceHomeModel,
  type HomeActivityTarget,
  type HomeFoundationId,
} from './workspace-home-model.ts';
import './workspace-home.css';

export interface WorkspaceHomeReportTarget {
  caseId: string;
  caseTitle: string;
  projectId: string;
  taskId: string;
  relativePath: string;
  sha256: string;
}

export interface WorkspaceHomeProps {
  active: boolean;
  projects: ClientProject[];
  currentProjectId?: string;
  selectedEnterpriseId?: string;
  onEnterpriseChange?: (enterpriseId: string | undefined) => void;
  onResolvedEnterpriseName?: (name: string | undefined) => void;
  refreshToken: number;
  preferredCaseId?: string;
  onCreateCase: () => void;
  onOpenCase: (caseId: string, issueId?: string) => void;
  onOpenRequest?: (item: HomePendingItem) => void;
  hidePreparation?: boolean;
  onOpenStarMap: () => void;
  onOpenProjectMap: () => void;
  onOpenDecisionBoard: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenTask: (projectId: string, taskId: string, sourceCase?: { caseId: string; caseTitle?: string }) => void;
  onOpenReport: (target: WorkspaceHomeReportTarget) => void;
  onOpenFoundation: (id: HomeFoundationId) => void;
  onOpenFoundationOverview: () => void;
}

function todayHeadingLabel(): { iso: string; text: string } {
  const now = new Date();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { iso, text: `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekdays[now.getDay()]}` };
}

export function WorkspaceHome({
  active,
  projects,
  currentProjectId,
  selectedEnterpriseId,
  onEnterpriseChange,
  onResolvedEnterpriseName,
  refreshToken,
  preferredCaseId,
  onCreateCase,
  onOpenCase,
  onOpenRequest,
  hidePreparation,
  onOpenStarMap,
  onOpenProjectMap,
  onOpenDecisionBoard,
  onOpenProject,
  onOpenTask,
  onOpenReport,
  onOpenFoundation,
  onOpenFoundationOverview,
}: WorkspaceHomeProps) {
  const desk = useWorkspaceDeskData({
    active,
    refreshToken,
    preferredCaseId,
    selectedEnterpriseId,
    currentProjectId,
    onResolvedEnterpriseName,
  });

  if (desk.caseAccessState === 'loading') {
    return (
      <div className="workspace-home-scroll">
        <section className="desk-home" aria-busy="true">
          <p role="status">正在读取工作区记录…</p>
          <button type="button" className="text-button" onClick={onOpenProjectMap}>打开项目地图</button>
        </section>
      </div>
    );
  }

  const model = buildWorkspaceHomeModel({
    caseAccessState: desk.caseAccessState,
    caseAccessMessage: desk.caseAccessMessage,
    enterpriseName: desk.enterpriseName,
    cases: desk.cases,
    projectLinks: desk.projectLinks,
    focusCaseId: preferredCaseId,
    focusDetail: desk.focusDetail,
    projects,
    goals: desk.goals,
    boardActions: desk.boardActions,
    actionReadState: desk.actionReadState,
    foundations: desk.foundations,
  });

  const dateInfo = todayHeadingLabel();
  const isCaseRestricted = model.caseAccessState === 'forbidden' || model.caseAccessState === 'unavailable';
  const latestActiveTask = projects
    .filter(project => !project.archivedAt)
    .flatMap(project => project.tasks.filter(task => !task.archivedAt).map(task => ({ project, task })))
    .sort((a, b) => b.task.updatedAt.localeCompare(a.task.updatedAt))[0];

  const handleActivityClick = (target: HomeActivityTarget) => {
    if (target.kind === 'case') { onOpenCase(target.caseId); return; }
    if (target.kind === 'project') { onOpenProject(target.projectId); return; }
    onOpenTask(target.projectId, target.taskId, target.caseId ? { caseId: target.caseId, caseTitle: target.caseTitle } : undefined);
  };

  return (
    <div className="workspace-home-scroll">
      <section className="desk-home" role="region" aria-label="工作台首页">
        <HomeDailyQuickPanel hidePreparation={hidePreparation} refreshToken={refreshToken} onOpenCase={(caseId: string, issueId?: string) => onOpenCase(caseId, issueId)} onOpenRequest={onOpenRequest} onCreateCase={onCreateCase} onOpenAllProjects={onOpenProjectMap} />
        <header className="dh-head">
          <div>
            <p className="dh-date"><time dateTime={dateInfo.iso}>{dateInfo.text}</time></p>
            <h1>{model.headline}</h1>
            <p className="dh-intro">
              {desk.enterprises.length > 1 ? (
                <label className="dh-enterprise-inline">
                  <span className="sr-only">当前企业</span>
                  <select
                    aria-label="当前企业"
                    value={desk.enterpriseUnselected ? '' : desk.activeEnterpriseId}
                    onChange={event => onEnterpriseChange?.(event.target.value)}
                  >
                    {desk.enterpriseUnselected && <option value="">尚未明确企业</option>}
                    {desk.enterprises.map(ent => (
                      <option key={ent.id} value={ent.id}>{ent.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <span>{model.enterpriseName}</span>
              )}
              <span aria-hidden="true"> / </span>
              {isCaseRestricted
                ? `${model.counts.activeProjects} 个项目可独立打开 · Case 记录${model.caseAccessState === 'forbidden' ? '无读取权限' : '暂不可读'}`
                : model.focusCase
                  ? `${model.counts.activeCases} 个 Case 正在推进${model.counts.inProgressActions ? ` · ${model.counts.inProgressActions} 项行动执行中` : ''}`
                  : '从业务问题出发，按需补齐四项基础建设'}
            </p>
          </div>
          <div className="dh-head-actions">
            <button type="button" className="text-button" disabled={desk.loading} onClick={desk.reload}>
              {desk.loading ? '正在刷新…' : '刷新'}
            </button>
            {!isCaseRestricted && model.focusCase && (
              <button type="button" className="dh-new" onClick={onCreateCase}>
                <b aria-hidden="true">+</b> 新建 Case
              </button>
            )}
          </div>
        </header>

        {isCaseRestricted && (
          <div className="dh-banner" role="alert">
            <p>
              <strong>{model.caseAccessState === 'forbidden' ? '暂无权限读取 Case 记录：' : 'Case 记录暂不可读取：'}</strong>
              {model.caseAccessMessage}
            </p>
            <div className="dh-head-actions">
              <button type="button" className="secondary-button" onClick={desk.reload}>重试读取</button>
              <button type="button" className="text-button" onClick={onOpenProjectMap}>打开项目地图</button>
            </div>
          </div>
        )}

        <section className="dh-hero" aria-labelledby="focus-case">
          <div className="dh-case">
            <div className="dh-case-top">
              <span className="dh-case-tag">
                <i aria-hidden="true" />
                {model.caseAccessState === 'forbidden'
                  ? 'Case 权限受限'
                  : model.caseAccessState === 'unavailable'
                    ? 'Case 暂不可读'
                    : model.focusCase
                      ? model.focusCase.status === 'closed'
                        ? '最近完结 Case'
                        : '当前 Case'
                      : '首个 Case'}
              </span>
              <span>{model.focusStatusLabel}</span>
              {model.focusActionBadge && <span className="dh-action-badge">{model.focusActionBadge}</span>}
            </div>
            <h2 id="focus-case">
              {model.caseAccessState === 'forbidden'
                ? '无法读取当前工作区的 Decision Case'
                : model.caseAccessState === 'unavailable'
                  ? 'Decision Case 存储暂时无法访问'
                  : model.focusCase
                    ? model.focusCase.title
                    : '把一个经营问题带进工作台'}
            </h2>
            <div className="dh-gs">
              <p><b aria-label="目标">G</b><span>{model.goalSummary.goalText}</span></p>
              <p><b aria-label="策略">S</b><span>{model.goalSummary.strategyText}</span></p>
            </div>
            <div className="dh-case-actions">
              {isCaseRestricted ? (
                <>
                  <button type="button" className="dh-primary-cta" onClick={onOpenProjectMap}>
                    打开项目地图
                  </button>
                  <button type="button" className="dh-case-project" onClick={desk.reload}>
                    重试读取 Case
                  </button>
                </>
              ) : model.focusCase ? (
                <>
                  <button type="button" className="dh-primary-cta" onClick={() => onOpenCase(model.focusCase!.id)}>
                    {model.focusCase.status === 'closed' ? '查看完结 Case' : '继续推进 Case'}
                  </button>
                  {model.linkedProject ? (
                    <button type="button" className="dh-case-project" onClick={() => onOpenProject(model.linkedProject!.id)}>
                      {model.linkedProject.name}
                    </button>
                  ) : (
                    <button type="button" className="dh-case-project" onClick={onOpenProjectMap}>
                      打开项目地图
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button type="button" className="dh-primary-cta" onClick={onCreateCase}>
                    新建 Case
                  </button>
                  <button type="button" className="dh-case-project" onClick={onOpenProjectMap}>
                    打开项目地图
                  </button>
                </>
              )}
            </div>
          </div>

          <aside className="dh-proof" aria-label={model.proof.caption}>
            <h3>{model.proof.caption}</h3>
            {model.proof.kind === 'grouped' ? (
              <>
                <div className="dh-chart" style={{ ['--portion' as string]: `${model.proof.portion}%` }}>
                  <div>
                    <strong>{model.proof.total}</strong>
                    <small>{model.proof.unit}</small>
                  </div>
                </div>
                <dl className="dh-legend">
                  {model.proof.groups.map(group => (
                    <div key={group.label}>
                      <dt><i aria-hidden="true" />{group.label}</dt>
                      <dd>{group.count} {group.unit}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <>
                <div className="dh-chart dh-chart-facts" style={{ ['--portion' as string]: `${model.proof.portion}%` }}>
                  <div>
                    <strong>{model.proof.completedCount}<em>/{model.proof.totalCount}</em></strong>
                    <small>类已记录</small>
                  </div>
                </div>
                <ul className="dh-checklist">
                  {model.proof.facts.map(fact => (
                    <li key={fact.text}>
                      <span className={fact.confirmed ? 'is-complete' : ''} aria-hidden="true">{fact.confirmed ? '✓' : '○'}</span>
                      <span>{fact.text}</span>
                      <small>{fact.confirmed ? '已有' : '待补'}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {model.proof.source?.kind === 'report' ? (
              <button
                type="button"
                className="dh-source"
                onClick={() => onOpenReport(model.proof.source as WorkspaceHomeReportTarget)}
              >
                {model.proof.source.label}
              </button>
            ) : model.proof.source?.kind === 'case' ? (
              <button type="button" className="dh-source" onClick={() => onOpenCase(model.proof.source!.kind === 'case' ? model.proof.source!.caseId : '')}>
                {model.proof.source.label}
              </button>
            ) : model.proof.source?.kind === 'projects' ? (
              <button type="button" className="dh-source" onClick={onOpenProjectMap}>
                {model.proof.source.label}
              </button>
            ) : model.proof.source?.kind === 'decision' ? (
              <button type="button" className="dh-source" onClick={onOpenDecisionBoard}>
                {model.proof.source.label}
              </button>
            ) : (
              <button type="button" className="dh-source" onClick={isCaseRestricted ? onOpenProjectMap : onCreateCase}>
                {model.proof.kind === 'readiness' ? model.proof.nextActionLabel : '新建 Case'}
              </button>
            )}
          </aside>
        </section>

        <div className="dh-sections">
          <section aria-labelledby="recent-activity">
            <div className="dh-section-head">
              <h2 id="recent-activity">最近活动</h2>
              {latestActiveTask ? (
                <button
                  type="button"
                  className="dh-link-btn"
                  onClick={() => onOpenTask(latestActiveTask.project.id, latestActiveTask.task.id)}
                >
                  继续任务
                </button>
              ) : (
                <button type="button" className="dh-link-btn" onClick={onOpenProjectMap}>打开项目</button>
              )}
            </div>
            {model.activities.length ? (
              <ol className="dh-events" aria-label="最近活动">
                {model.activities.map(event => (
                  <li key={event.id}>
                    <span className="dh-event-time">{event.timeLabel}</span>
                    <button type="button" onClick={() => handleActivityClick(event.target)}>
                      <strong>{event.title}</strong>
                      <small>{event.detail}</small>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="dh-empty">
                <strong>{isCaseRestricted ? '当前仅可查看获准的项目活动' : '暂无工作记录'}</strong>
                <p>{isCaseRestricted ? 'Case 活动待读取恢复后核对。' : '创建 Case 或在项目任务中记录第一条消息后，会在这里按时间回看。'}</p>
              </div>
            )}
          </section>
        </div>

        <div className="dh-maps">
          <button type="button" onClick={onOpenStarMap}>
            <span className="dh-mini-map" aria-hidden="true"><i /><i /><i /></span>
            <span>
              <strong>决策星图</strong>
              <small>
                {model.caseAccessState === 'forbidden'
                  ? '无权限读取 Case · 点击查看权限提示'
                  : model.caseAccessState === 'unavailable'
                    ? 'Case 存储暂不可读 · 点击重新检查'
                    : `${model.counts.totalCases} 个 Case · 查看关联关系`}
              </small>
            </span>
          </button>
          <button type="button" onClick={onOpenProjectMap}>
            <span className="dh-folders" aria-hidden="true"><i /><i /><i /></span>
            <span>
              <strong>项目地图</strong>
              <small>{model.counts.activeProjects} 个项目 · 推进六类任务</small>
            </span>
          </button>
        </div>

        <section className="dh-foundation" aria-labelledby="foundations-title">
          <div className="dh-section-head">
            <h2 id="foundations-title">基础建设</h2>
            <button
              type="button"
              className="dh-link-btn"
              onClick={onOpenFoundationOverview}
            >
              查看建设总览
            </button>
          </div>
          <div className="dh-foundation-tiles">
            {model.foundations.map(item => (
              <button
                key={item.id}
                type="button"
                className="dh-foundation-tile"
                onClick={() => onOpenFoundation(item.id)}
              >
                <span className="dh-foundation-label">
                  <strong>{item.title}</strong>
                  <span className={`dh-pill ${item.tone}`}>{item.status}</span>
                </span>
                <p>{item.rhythm}</p>
              </button>
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}
