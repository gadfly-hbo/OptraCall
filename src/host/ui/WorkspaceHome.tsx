import { useEffect, useRef, useState } from 'react';
import type { CaseDetail, CaseProjectLink, CaseRecord } from '../case-types.ts';
import type { StrategyGoalsIndex } from '../strategy-goals-types.ts';
import * as caseClient from './case-client.ts';
import type { ClientProject } from './project-types.ts';
import { listInitiatives, listPublications } from './strategy-initiative-client.ts';
import { listStudioEnterprises, listStudioSystems, readStudioFoundation } from './studio-api.ts';
import {
  buildWorkspaceHomeModel,
  type HomeActivityTarget,
  type HomeCaseAccessState,
  type HomeFoundationId,
  type HomeFoundationSnapshot,
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
  refreshToken: number;
  preferredCaseId?: string;
  onCasesLoaded?: (cases: CaseRecord[]) => void;
  onCreateCase: () => void;
  onOpenCase: (caseId: string) => void;
  onOpenStarMap: () => void;
  onOpenProjectMap: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenTask: (projectId: string, taskId: string, sourceCase?: { caseId: string; caseTitle?: string }) => void;
  onOpenReport: (target: WorkspaceHomeReportTarget) => void;
  onOpenFoundation: (id: HomeFoundationId) => void;
}

function todayHeadingLabel(): { iso: string; text: string } {
  const now = new Date();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { iso, text: `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekdays[now.getDay()]}` };
}

function classifyHttpFailure(error: unknown): { state: 'forbidden' | 'unavailable'; message: string } {
  const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 0;
  if (status === 403) {
    return {
      state: 'forbidden',
      message: error instanceof Error && error.message ? error.message : '当前身份暂无权读取 Case 记录，可继续使用获准项目或调整权限。',
    };
  }
  return {
    state: 'unavailable',
    message: error instanceof Error && error.message ? error.message : '工作台数据暂时无法读取，现有项目仍可独立打开。',
  };
}

export function WorkspaceHome({
  active,
  projects,
  refreshToken,
  preferredCaseId,
  onCasesLoaded,
  onCreateCase,
  onOpenCase,
  onOpenStarMap,
  onOpenProjectMap,
  onOpenProject,
  onOpenTask,
  onOpenReport,
  onOpenFoundation,
}: WorkspaceHomeProps) {
  const [loading, setLoading] = useState(true);
  const [manualReload, setManualReload] = useState(0);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [caseAccessState, setCaseAccessState] = useState<HomeCaseAccessState>('empty');
  const [caseAccessMessage, setCaseAccessMessage] = useState<string | undefined>();
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [projectLinks, setProjectLinks] = useState<CaseProjectLink[]>([]);
  const [focusDetail, setFocusDetail] = useState<CaseDetail | null>(null);
  const [goals, setGoals] = useState<StrategyGoalsIndex | null>(null);
  const [enterpriseName, setEnterpriseName] = useState<string | undefined>();
  const [foundations, setFoundations] = useState<Partial<Record<HomeFoundationId, HomeFoundationSnapshot>>>({});
  const onCasesLoadedRef = useRef(onCasesLoaded);
  onCasesLoadedRef.current = onCasesLoaded;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);

    void (async () => {
      const nextFoundations: Partial<Record<HomeFoundationId, HomeFoundationSnapshot>> = {};

      // 1. Read Cases (read-only).
      let loadedCases: CaseRecord[] = [];
      let loadedLinks: CaseProjectLink[] = [];
      let accessState: HomeCaseAccessState = 'empty';
      let accessMessage: string | undefined;
      try {
        const storage = await caseClient.status(signal);
        if (signal.aborted) return;
        if (storage.state === 'ready') {
          const list = await caseClient.list(signal);
          if (signal.aborted) return;
          loadedCases = list.cases;
          loadedLinks = list.projectLinks;
          accessState = loadedCases.length ? 'ready' : 'empty';
        } else if (storage.state === 'uninitialized') {
          accessState = 'empty';
        } else {
          accessState = 'unavailable';
          accessMessage = 'Case 存储暂时不可用，现有项目仍保留并可独立打开。';
        }
      } catch (error) {
        if (signal.aborted) return;
        const classified = classifyHttpFailure(error);
        accessState = classified.state;
        accessMessage = classified.message;
      }

      // 2. Read focused Case detail (read-only) when cases exist.
      let loadedDetail: CaseDetail | null = null;
      if (loadedCases.length) {
        const activeList = loadedCases
          .filter(item => item.status !== 'closed')
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const target =
          (preferredCaseId ? loadedCases.find(item => item.id === preferredCaseId) : undefined) ??
          activeList[0] ??
          loadedCases[0];
        if (target) {
          try {
            loadedDetail = await caseClient.detail(target.id, signal);
          } catch {
            loadedDetail = null;
          }
        }
      }

      // 3. Read four foundation statuses in parallel (pure read-only, partial failure tolerant).
      const [goalsRes, initiativesRes, studioRes] = await Promise.allSettled([
        caseClient.strategyGoals(),
        listInitiatives(signal),
        Promise.all([listStudioEnterprises(signal), listStudioSystems(signal)]),
      ]);
      if (signal.aborted) return;

      let loadedGoals: StrategyGoalsIndex | null = null;
      if (goalsRes.status === 'fulfilled') {
        loadedGoals = goalsRes.value;
        const adoptedCount = loadedGoals.goals.filter(g => g.adoptedVersion !== null && g.adoptedVersion !== undefined).length;
        const totalGoals = loadedGoals.goals.length;
        nextFoundations.goals = {
          state: 'ready',
          status: adoptedCount > 0 ? '已采用' : totalGoals > 0 ? '待确认' : '未开始',
          detail: adoptedCount > 0 ? `${adoptedCount} 项已采用目标` : totalGoals > 0 ? `${totalGoals} 项候选待核对` : '尚未设定年度目标',
        };
      } else {
        const fail = classifyHttpFailure(goalsRes.reason);
        nextFoundations.goals = { state: fail.state, status: fail.state === 'forbidden' ? '无权限' : '暂不可读', detail: fail.message };
      }

      if (initiativesRes.status === 'fulfilled') {
        const items = initiativesRes.value.initiatives;
        let hasPublished = false;
        if (items.length > 0) {
          const pubChecks = await Promise.allSettled(items.slice(0, 5).map(item => listPublications(item.id)));
          hasPublished = pubChecks.some(
            res => res.status === 'fulfilled' && res.value.publications.some(pub => pub.state === 'active'),
          );
        }
        nextFoundations.strategy = {
          state: 'ready',
          status: hasPublished ? '已发布' : items.length > 0 ? '进行中' : '未开始',
          detail: hasPublished ? '存在已发布战略版本' : items.length > 0 ? `${items.length} 项战略讨论进行中` : '尚未开展战略选择',
        };
      } else {
        const fail = classifyHttpFailure(initiativesRes.reason);
        nextFoundations.strategy = { state: fail.state, status: fail.state === 'forbidden' ? '无权限' : '暂不可读', detail: fail.message };
      }

      let resolvedEnterprise: string | undefined;
      if (studioRes.status === 'fulfilled') {
        const [directory, systems] = studioRes.value;
        const primaryEnterprise = directory.enterprises[0];
        resolvedEnterprise = primaryEnterprise?.name;
        let semanticCount = 0;
        let analyticsCount = 0;
        if (primaryEnterprise) {
          try {
            const foundation = await readStudioFoundation(primaryEnterprise.id, signal);
            if (!signal.aborted) {
              for (const item of foundation.items) {
                const isAnalytics = item.authority === 'sap-metric' || item.authority === 'sap-method';
                if (isAnalytics) analyticsCount += 1;
                else semanticCount += 1;
              }
            }
          } catch {
            // Fall back to system counts only.
          }
        }
        const systemCount = systems.length;
        nextFoundations.semantic = {
          state: 'ready',
          status: semanticCount > 0 ? '已发布' : systemCount > 0 ? '建设中' : '未开始',
          detail: semanticCount > 0 ? `${semanticCount} 项正式语义资产` : systemCount > 0 ? `${systemCount} 个体系建设中` : '尚未发布语义资产',
        };
        nextFoundations.analysis = {
          state: 'ready',
          status: analyticsCount > 0 ? '已发布' : systemCount > 0 ? '建设中' : '未开始',
          detail: analyticsCount > 0 ? `${analyticsCount} 项正式分析资产` : systemCount > 0 ? `${systemCount} 个体系建设中` : '尚未发布分析资产',
        };
      } else {
        const fail = classifyHttpFailure(studioRes.reason);
        const label = fail.state === 'forbidden' ? '无权限' : '暂不可读';
        nextFoundations.semantic = { state: fail.state, status: label, detail: fail.message };
        nextFoundations.analysis = { state: fail.state, status: label, detail: fail.message };
      }

      if (signal.aborted) return;
      setCaseAccessState(accessState);
      setCaseAccessMessage(accessMessage);
      setCases(loadedCases);
      setProjectLinks(loadedLinks);
      setFocusDetail(loadedDetail);
      setGoals(loadedGoals);
      setEnterpriseName(resolvedEnterprise);
      setFoundations(nextFoundations);
      onCasesLoadedRef.current?.(loadedCases);
      setLoading(false);
    })();

    return () => { controller.abort(); };
  }, [active, refreshToken, manualReload, preferredCaseId]);

  const model = buildWorkspaceHomeModel({
    caseAccessState,
    caseAccessMessage,
    enterpriseName,
    cases,
    projectLinks,
    focusCaseId: preferredCaseId,
    focusDetail,
    projects,
    goals,
    foundations,
  });

  const dateInfo = todayHeadingLabel();
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
        <header className="dh-head">
          <div>
            <p className="dh-date"><time dateTime={dateInfo.iso}>{dateInfo.text}</time></p>
            <h1>{model.headline}</h1>
            <p className="dh-intro">
              {model.enterpriseName}
              <span aria-hidden="true"> / </span>
              {model.focusCase
                ? `${model.counts.activeCases} 个 Case 正在推进${model.counts.inProgressActions ? ` · ${model.counts.inProgressActions} 项行动执行中` : ''}`
                : '从业务问题出发，按需补齐四项基础建设'}
            </p>
          </div>
          <div className="dh-head-actions">
            <button type="button" className="text-button" disabled={loading} onClick={() => setManualReload(value => value + 1)}>
              {loading ? '正在刷新…' : '刷新'}
            </button>
            {model.focusCase && (
              <button type="button" className="dh-new" onClick={onCreateCase}>
                <b aria-hidden="true">+</b> 新建 Case
              </button>
            )}
          </div>
        </header>

        {(model.caseAccessState === 'forbidden' || model.caseAccessState === 'unavailable') && (
          <div className="dh-banner" role="alert">
            <p>
              <strong>{model.caseAccessState === 'forbidden' ? '暂无权限读取部分记录：' : '部分工作台记录暂不可读取：'}</strong>
              {model.caseAccessMessage}
            </p>
            <div className="dh-head-actions">
              <button type="button" className="secondary-button" onClick={() => setManualReload(value => value + 1)}>重试读取</button>
              <button type="button" className="text-button" onClick={onOpenProjectMap}>打开项目地图</button>
            </div>
          </div>
        )}

        <section className="dh-hero" aria-labelledby="focus-case">
          <div className="dh-case">
            <div className="dh-case-top">
              <span className="dh-case-tag"><i aria-hidden="true" />{model.focusCase ? '当前 Case' : '首个 Case'}</span>
              <span>{model.focusStatusLabel}</span>
              {model.focusActionBadge && <span className="dh-action-badge">{model.focusActionBadge}</span>}
            </div>
            <h2 id="focus-case">{model.focusCase ? model.focusCase.title : '把一个经营问题带进工作台'}</h2>
            <div className="dh-gs">
              <p><b aria-label="目标">G</b><span>{model.goalSummary.goalText}</span></p>
              <p><b aria-label="策略">S</b><span>{model.goalSummary.strategyText}</span></p>
            </div>
            <div className="dh-case-actions">
              {model.focusCase ? (
                <button type="button" className="dh-primary-cta" onClick={() => onOpenCase(model.focusCase!.id)}>
                  继续推进 Case
                </button>
              ) : (
                <button type="button" className="dh-primary-cta" onClick={onCreateCase}>
                  新建 Case
                </button>
              )}
              {model.linkedProject ? (
                <button type="button" className="dh-case-project" onClick={() => onOpenProject(model.linkedProject!.id)}>
                  {model.linkedProject.name}
                </button>
              ) : (
                <button type="button" className="dh-case-project" onClick={onOpenProjectMap}>
                  打开项目地图
                </button>
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
            ) : (
              <button type="button" className="dh-source" onClick={onCreateCase}>
                {model.proof.kind === 'readiness' ? model.proof.nextActionLabel : '新建 Case'}
              </button>
            )}
          </aside>
        </section>

        <div className="dh-sections">
          <section aria-labelledby="my-queue">
            <div className="dh-section-head">
              <h2 id="my-queue">需要你处理</h2>
              <button type="button" className="dh-link-btn" onClick={onOpenStarMap}>查看全部 Case</button>
            </div>
            {model.queue.length ? (
              <ul className="dh-queue-list" aria-label="需要你处理">
                {model.queue.map(item => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="dh-queue-row"
                      onClick={() => {
                        if (item.kind === 'case') onOpenCase(item.caseId);
                        else onOpenReport(item);
                      }}
                    >
                      <span className={`dh-status ${item.tone}`}>{item.statusLabel}</span>
                      <span className="dh-queue-topic">
                        <strong>{item.title}</strong>
                        <small>{item.context}</small>
                      </span>
                      <span className="dh-owner">
                        <span>{item.owner}</span>
                        <small>{item.dateLabel}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="dh-empty">
                <strong>还没有待处理事项</strong>
                <p>可以从一个业务问题创建 Case，或到项目地图继续独立分析任务。</p>
                <button type="button" className="text-button" onClick={onOpenProjectMap}>打开项目地图</button>
              </div>
            )}
          </section>

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
                <strong>暂无工作记录</strong>
                <p>创建 Case 或在项目任务中记录第一条消息后，会在这里按时间回看。</p>
              </div>
            )}
          </section>
        </div>

        <div className="dh-maps">
          <button type="button" onClick={onOpenStarMap}>
            <span className="dh-mini-map" aria-hidden="true"><i /><i /><i /></span>
            <span>
              <strong>决策星图</strong>
              <small>{model.counts.totalCases} 个 Case · 查看关联关系</small>
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
              aria-expanded={overviewOpen}
              onClick={() => setOverviewOpen(open => !open)}
            >
              {overviewOpen ? '收起建设总览' : '查看建设总览'}
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
          {overviewOpen && (
            <div className="dh-foundation-overview" role="region" aria-label="基础建设总览">
              <p>四项基础建设按各自节奏维护，不阻塞日常 Case 推进与项目分析。</p>
              {model.foundations.map(item => (
                <div key={item.id} className="project-case-link-row">
                  <span><strong>{item.title}</strong> · {item.detail}</span>
                  <button type="button" className="text-button" onClick={() => onOpenFoundation(item.id)}>进入{item.title}</button>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
