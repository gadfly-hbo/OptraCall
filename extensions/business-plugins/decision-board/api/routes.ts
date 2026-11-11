import type { IncomingMessage } from 'node:http';
import { DecisionBoardFault, createDecisionBoardStore } from '../storage/store.ts';
import type { ConfirmedConclusionRecord, BoardItemRecord, BoardItemView, BoardTaskRecord, BoardTaskView, ExtractionRecord, ExtractionStatus, FeedbackEffect, SaveFeedbackInput, TaskFeedbackRevision } from '../types.ts';

export class BoardRouteError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

export type BoardProjectSummary = { id: string; name: string; archivedAt: string | null };
export type BoardConfirmedConclusionView = (ConfirmedConclusionRecord & { readStatus: 'available'; fixedReportAvailable: boolean; limitations: string[] }) | (Pick<ConfirmedConclusionRecord, 'id' | 'reportId' | 'projectId' | 'taskId' | 'reviewId' | 'reportSha256' | 'relativePath' | 'confirmedBy' | 'confirmedAt'> & { readStatus: 'unavailable' });
export type BoardReportView = {
  currentSha256?: string | null;
  reportId?: number; confirmations: BoardConfirmedConclusionView[];
  projectId: string; projectName: string; relativePath: string; name: string; bytes: number;
  registered: boolean; observedBytes: number | null; lastExtractionAt: string | null;
  availability: 'available' | 'changed' | 'missing';
  extraction: { id: string; status: ExtractionStatus; error: string | null; createdAt: string; itemCount: number | null } | null;
};
export type BoardStats = { reports: number; suggested: number; adopted: number; dismissed: number; manual: number; highPrioritySuggested: number; runningExtractions: number };
export type BoardView = { projects: BoardProjectSummary[]; reports: BoardReportView[]; items: BoardItemView[]; stats: BoardStats };

type FileNode = { name: string; path: string; kind: 'file' | 'directory'; bytes?: number; children?: FileNode[] };

export type DecisionBoardRoutesOptions = {
  store: ReturnType<typeof createDecisionBoardStore>;
  readBody: (request: IncomingMessage) => Promise<Record<string, unknown>>;
  mutate: <T>(operation: () => T | Promise<T>) => Promise<T>;
  projectOverview: () => Promise<readonly BoardProjectSummary[]>;
  projectFiles: (projectId: string) => Promise<FileNode[]>;
  assertActiveProject: (projectId: string) => Promise<void>;
  startExtraction: (projectId: string, relativePath: string) => Promise<ExtractionRecord>;
  stopExtraction: (extractionId: string) => Promise<ExtractionRecord>;
  observeReport?: (projectId: string, relativePath: string) => Promise<{ sha256: string; bytes: number }>;
  assertItemReadable?: (item: BoardItemRecord) => Promise<void>;
  presentConfirmation?: (record: ConfirmedConclusionRecord) => Promise<BoardConfirmedConclusionView>;
};

const projectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const messages: Record<string, { status: number; message: string }> = {
  extraction_busy: { status: 409, message: '该报告已有进行中的抽取，请等待完成或停止后再试。' },
  extraction_conflict: { status: 409, message: '该抽取已结束，请刷新查看结果。' },
  extraction_not_found: { status: 404, message: '未找到该抽取记录。' },
  item_not_found: { status: 404, message: '未找到该建议条目。' },
  task_not_found: { status: 404, message: '未找到该行动任务。' },
  report_not_found: { status: 404, message: '未找到该报告登记。' },
  configuration_required: { status: 409, message: '请先在模型设置中选择并配置模型。' },
  report_not_utf8: { status: 415, message: '报告不是有效的 UTF-8 文本，无法抽取。' },
  invalid_report_path: { status: 400, message: '仅支持 060_reports 下的报告文件。' },
  invalid_dismiss_reason: { status: 400, message: '驳回必须填写至少 2 个字符的理由。' },
  item_already_dismissed: { status: 409, message: '该建议已驳回，不能直接改为采纳；可重新抽取或人工补充。' },
  invalid_item_decision: { status: 409, message: '该建议已有决策，请刷新核对后再操作。' },
  task_requires_adoption: { status: 409, message: '只有已采纳的建议才能添加行动任务。' },
  invalid_text: { status: 400, message: '输入内容不完整、为空或超过长度限制。' },
  invalid_feedback: { status: 400, message: '请明确是否按建议执行；评分可不填，填写时须为 1–5 的整数。' },
  feedback_client_upgrade_required: { status: 409, message: '请刷新升级页面后保存反馈；旧页面缺少保存意图或当前修订身份，本次未写入。' },
  feedback_operation_conflict: { status: 409, message: '此保存意图已有不同内容，请先查询原操作并保留当前输入。' },
  feedback_revision_conflict: { status: 409, message: '反馈已有新修订，请对照最新内容后重新保存；当前输入应保留。' },
  feedback_revision_not_found: { status: 404, message: '未找到该反馈修订。' },
  project_not_found: { status: 404, message: '未找到反馈所属项目。' },
  invalid_observation: { status: 400, message: '报告观测信息无效，请刷新后重试。' },
  project_archived: { status: 409, message: '项目已归档，请先恢复后继续操作。' },
  project_busy: { status: 409, message: '项目正在归档或仍有运行中的工作，请稍后重试。' },
  host_closing: { status: 503, message: '本地服务正在关闭，请稍后重试。' },
  file_not_found: { status: 404, message: '报告文件不存在，请刷新后重试。' },
  report_changed_during_extraction: { status: 409, message: '报告在读取期间发生变化，请重试。' },
  board_store_unavailable: { status: 503, message: '决策看板存储暂不可用，请稍后重试。' },
  unsafe_board_storage: { status: 503, message: '决策看板存储位置异常，已停止写入。' },
  unsupported_board_schema: { status: 503, message: '决策看板存储版本不受支持。' },
  invalid_board_database: { status: 503, message: '决策看板存储校验未通过，原库已保留并停止写入。' },
  board_migration_failed: { status: 503, message: '决策看板升级未完成，已回滚本次升级并保留原库，请先检查。' },
  board_store_busy: { status: 503, message: '决策看板存储正被其他实例使用。' },
};

function fault(error: unknown): BoardRouteError {
  if (error instanceof DecisionBoardFault) {
    const mapped = messages[error.code] ?? { status: 400, message: '决策看板操作未完成，请检查输入后重试。' };
    return new BoardRouteError(mapped.status, error.code, mapped.message);
  }
  if (error instanceof BoardRouteError) return error;
  const code = (error as { code?: string }).code ?? 'board_request_failed';
  const mapped = messages[code] ?? { status: 500, message: '决策看板请求未完成，请检查本地服务后重试。' };
  return new BoardRouteError(mapped.status, code, mapped.message);
}

function string(input: Record<string, unknown>, key: string, required = true): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) { if (required) throw new BoardRouteError(400, 'invalid_text', messages.invalid_text!.message); return ''; }
  return value;
}

function feedbackInput(input: Record<string, unknown>): SaveFeedbackInput {
  if (!input.operationId || !Object.hasOwn(input, 'expectedLatestRevisionId')) throw new BoardRouteError(409, 'feedback_client_upgrade_required', messages.feedback_client_upgrade_required!.message);
  const score = input.score === undefined ? null : input.score, effect = input.effect === undefined ? 'unknown' : input.effect;
  if (typeof input.operationId !== 'string' || !projectIdPattern.test(input.operationId)
    || (input.expectedLatestRevisionId !== null && (typeof input.expectedLatestRevisionId !== 'string' || !projectIdPattern.test(input.expectedLatestRevisionId)))
    || typeof input.adopted !== 'boolean' || (score !== null && (typeof score !== 'number' || !Number.isSafeInteger(score) || score < 1 || score > 5))
    || typeof effect !== 'string' || !['unknown', 'positive', 'negative', 'none'].includes(effect)) throw new BoardRouteError(400, 'invalid_feedback', messages.invalid_feedback!.message);
  const content = (key: string) => {
    if (input[key] === undefined) return '';
    if (typeof input[key] !== 'string') throw new BoardRouteError(400, 'invalid_feedback', messages.invalid_feedback!.message);
    return input[key];
  };
  return { operationId: input.operationId, expectedLatestRevisionId: input.expectedLatestRevisionId, adopted: input.adopted,
    outcome: content('outcome'), metricDelta: content('metricDelta'), review: content('review'), score, effect: effect as FeedbackEffect };
}

/** Host-owned HTTP transport calls these handlers; the plugin never binds a port itself. */
export function createDecisionBoardRoutes(options: DecisionBoardRoutesOptions) {
  const store = options.store;

  function itemView(item: BoardItemRecord, tasksByItem: Map<string, BoardTaskView[]>): BoardItemView {
    return { ...item, tasks: tasksByItem.get(item.id) ?? [] };
  }
  function taskView(task: BoardTaskRecord, feedbackByTask: Map<string, TaskFeedbackRevision>): BoardTaskView {
    const feedback = feedbackByTask.get(task.id);
    return feedback ? { ...task, feedback } : { ...task };
  }

  async function assertReadable(item: BoardItemRecord) {
    if (item.sourceKind !== 'report-confirmation') return;
    if (!options.assertItemReadable) throw new BoardRouteError(409, 'confirmation_source_unavailable', '确认来源当前不可读取。');
    try { await options.assertItemReadable(item); } catch { throw new BoardRouteError(409, 'confirmation_source_unavailable', '确认来源当前不可读取。'); }
  }
  async function readableTask(taskId: string): Promise<BoardTaskRecord> {
    const task = store.getTask(taskId), item = store.getItem(task.itemId);
    if (!(await options.projectOverview()).some(project => project.id === item.projectId)) throw new BoardRouteError(404, 'project_not_found', messages.project_not_found!.message);
    await assertReadable(item);
    return task;
  }

  async function viewWithinMutation(): Promise<BoardView> {
    const [projects, reports, extractions, items, tasks, feedback] = await (async () => {
      const overview = await options.projectOverview();
      return [overview, store.listReports(), store.listExtractions(), store.listItems(), store.listTasks(), store.listFeedback()] as const;
    })();
    const confirmations = store.listConfirmedConclusions();
    const presented = await Promise.all(confirmations.map(async record => {
      if (options.presentConfirmation) return options.presentConfirmation(record);
      const { id, reportId, projectId, taskId, reviewId, reportSha256, relativePath, confirmedBy, confirmedAt } = record;
      return { id, reportId, projectId, taskId, reviewId, reportSha256, relativePath, confirmedBy, confirmedAt, readStatus: 'unavailable' as const };
    }));
    const projectNames = new Map(projects.map(project => [project.id, project]));
    const scanned = new Map<string, number>();
    for (const project of projects) {
      for (const node of await options.projectFiles(project.id)) {
        if (node.kind !== 'directory' || node.name !== '060_reports') continue;
        for (const child of node.children ?? []) if (child.kind === 'file') scanned.set(`${project.id}/${child.path}`, child.bytes ?? 0);
      }
    }
    const latestByReport = new Map<number, ExtractionRecord>();
    for (const extraction of extractions) if (!latestByReport.has(extraction.reportId)) latestByReport.set(extraction.reportId, extraction);
    const reportViews: BoardReportView[] = [];
    const seen = new Set<string>();
    for (const [key, bytes] of scanned) {
      const [projectId, relativePath] = [key.slice(0, 36), key.slice(37)];
      const project = projectNames.get(projectId);
      const registered = reports.find(report => report.projectId === projectId && report.relativePath === relativePath);
      const extraction = registered ? latestByReport.get(registered.id) ?? null : null;
      seen.add(key);
      let currentSha256: string | null | undefined;
      if (registered && presented.some(entry => entry.reportId === registered.id)) {
        try { currentSha256 = (await options.observeReport?.(projectId, relativePath))?.sha256 ?? null; } catch { currentSha256 = null; }
      }
      reportViews.push({
        projectId, projectName: project?.name ?? projectId, relativePath, name: relativePath.split('/').pop()!, bytes,
        currentSha256, reportId: registered?.id, confirmations: presented.filter(entry => entry.reportId === registered?.id),
        registered: Boolean(registered), observedBytes: registered?.observedBytes ?? null, lastExtractionAt: registered?.lastExtractionAt ?? null,
        availability: registered ? currentSha256 ? currentSha256 === registered.observedSha256 ? 'available' : 'changed' : registered.observedBytes === bytes ? 'available' : 'changed' : 'available',
        extraction: extraction ? { id: extraction.id, status: extraction.status, error: extraction.error, createdAt: extraction.createdAt, itemCount: extraction.itemCount } : null,
      });
    }
    for (const report of reports) {
      const key = `${report.projectId}/${report.relativePath}`;
      if (seen.has(key)) continue;
      const project = projectNames.get(report.projectId);
      const extraction = latestByReport.get(report.id) ?? null;
      reportViews.push({
        projectId: report.projectId, projectName: project?.name ?? report.projectId, relativePath: report.relativePath, name: report.relativePath.split('/').pop()!, bytes: report.observedBytes ?? 0,
        currentSha256: null, reportId: report.id, confirmations: presented.filter(entry => entry.reportId === report.id),
        registered: true, observedBytes: report.observedBytes, lastExtractionAt: report.lastExtractionAt,
        availability: 'missing', extraction: extraction ? { id: extraction.id, status: extraction.status, error: extraction.error, createdAt: extraction.createdAt, itemCount: extraction.itemCount } : null,
      });
    }
    const feedbackByTask = new Map(feedback.map(entry => [entry.taskId, entry]));
    const tasksByItem = new Map<string, BoardTaskView[]>();
    for (const task of tasks) {
      const list = tasksByItem.get(task.itemId) ?? [];
      list.push(taskView(task, feedbackByTask));
      tasksByItem.set(task.itemId, list);
    }
    const itemViews: BoardItemView[] = [];
    for (const item of items) { try { await assertReadable(item); itemViews.push(itemView(item, tasksByItem)); } catch { /* Current source authority also governs derived task/feedback bodies. */ } }
    return {
      projects: projects.map(({ id, name, archivedAt }) => ({ id, name, archivedAt })),
      reports: reportViews.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.relativePath.localeCompare(b.relativePath)),
      items: itemViews,
      stats: {
        reports: reportViews.length,
        suggested: itemViews.filter(item => item.status === 'suggested').length,
        adopted: itemViews.filter(item => item.status === 'adopted').length,
        dismissed: itemViews.filter(item => item.status === 'dismissed').length,
        manual: itemViews.filter(item => item.sourceKind === 'manual').length,
        highPrioritySuggested: itemViews.filter(item => item.status === 'suggested' && item.priority === 'high').length,
        runningExtractions: extractions.filter(extraction => extraction.status === 'running').length,
      },
    };
  }

  const view = () => options.mutate(viewWithinMutation);
  async function routes(request: IncomingMessage, url: URL): Promise<{ status: number; value: unknown } | null> {
    if (!url.pathname.startsWith('/api/decision-board/') && url.pathname !== '/api/decision-board') return null;
    const route = url.pathname.replace(/^\/api\/decision-board\/?/, '');
    const input = ['POST', 'PATCH', 'PUT'].includes(request.method ?? '') ? await options.readBody(request) : {};
    try {
      if (route === '' && request.method === 'GET') return { status: 200, value: await view() };
      if (route === 'feedback/history' && request.method === 'GET') {
        return { status: 200, value: await options.mutate(async () => {
          const task = await readableTask(url.searchParams.get('taskId') ?? '');
          return { revisions: store.listFeedbackHistory(task.id) };
        }) };
      }
      const revisionRoute = /^feedback\/revisions\/([0-9a-f-]{36})$/.exec(route);
      if (revisionRoute && request.method === 'GET') {
        return { status: 200, value: await options.mutate(async () => {
          const feedback = store.getFeedbackRevision(revisionRoute[1]!);
          if (!feedback) throw new BoardRouteError(404, 'feedback_revision_not_found', messages.feedback_revision_not_found!.message);
          await readableTask(feedback.taskId);
          return { feedback };
        }) };
      }
      const operationRoute = /^feedback\/operations\/([0-9a-f-]{36})$/.exec(route);
      if (operationRoute && request.method === 'GET') {
        return { status: 200, value: await options.mutate(async () => {
          const feedback = store.getFeedbackOperation(operationRoute[1]!);
          if (feedback) await readableTask(feedback.taskId);
          return { feedback };
        }) };
      }
      if (route === 'reports/extract' && request.method === 'POST') {
        const projectId = string(input, 'projectId'), relativePath = string(input, 'path');
        if (!projectIdPattern.test(projectId)) throw new BoardRouteError(400, 'invalid_text', messages.invalid_text!.message);
        return { status: 202, value: { extraction: await options.startExtraction(projectId, relativePath) } };
      }
      const stopRoute = /^extraction\/([0-9a-f-]{36})\/stop$/.exec(route);
      if (stopRoute && request.method === 'POST') return { status: 200, value: { extraction: await options.stopExtraction(stopRoute[1]!) } };
      if (route === 'items' && request.method === 'POST') {
        const projectId = string(input, 'projectId');
        if (!projectIdPattern.test(projectId)) throw new BoardRouteError(400, 'invalid_text', messages.invalid_text!.message);
        await options.assertActiveProject(projectId);
        return { status: 201, value: { item: await options.mutate(() => store.addManualItem({ projectId, title: string(input, 'title'), rationale: string(input, 'rationale'), ...(input.expectedImpact === undefined ? {} : { expectedImpact: string(input, 'expectedImpact', false) }), ...(input.priority === undefined ? {} : { priority: string(input, 'priority') }) })) } };
      }
      const adoptRoute = /^items\/([0-9a-f-]{36})\/adopt$/.exec(route);
      if (adoptRoute && request.method === 'POST') {
        const id = adoptRoute[1]!;
        return { status: 200, value: { item: await options.mutate(async () => { const item = store.getItem(id); await options.assertActiveProject(item.projectId); await assertReadable(item); return store.decideItem(id, { status: 'adopted' }); }) } };
      }
      const dismissRoute = /^items\/([0-9a-f-]{36})\/dismiss$/.exec(route);
      if (dismissRoute && request.method === 'POST') {
        const id = dismissRoute[1]!;
        return { status: 200, value: { item: await options.mutate(async () => { const item = store.getItem(id); await options.assertActiveProject(item.projectId); await assertReadable(item); return store.decideItem(id, { status: 'dismissed', reason: string(input, 'reason') }); }) } };
      }
      const taskRoute = /^items\/([0-9a-f-]{36})\/tasks$/.exec(route);
      if (taskRoute && request.method === 'POST') {
        const id = taskRoute[1]!;
        return { status: 201, value: { task: await options.mutate(async () => { const item = store.getItem(id); await options.assertActiveProject(item.projectId); await assertReadable(item); return store.addTask(id, {
          title: string(input, 'title'),
          ...(input.owner === undefined ? {} : { owner: string(input, 'owner', false) }),
          ...(input.dueDate === undefined ? {} : { dueDate: string(input, 'dueDate', false) }),
          ...(input.priority === undefined ? {} : { priority: string(input, 'priority') }),
          ...(input.note === undefined ? {} : { note: string(input, 'note', false) }),
        }); }) } };
      }
      const statusRoute = /^tasks\/([0-9a-f-]{36})\/status$/.exec(route);
      if (statusRoute && request.method === 'POST') {
        return { status: 200, value: { task: await options.mutate(async () => { const task = await readableTask(statusRoute[1]!); const item = store.getItem(task.itemId); await options.assertActiveProject(item.projectId); return store.setTaskStatus(task.id, string(input, 'status')); }) } };
      }
      const feedbackRoute = /^tasks\/([0-9a-f-]{36})\/feedback$/.exec(route);
      if (feedbackRoute && request.method === 'POST') {
        const clean = feedbackInput(input);
        return { status: 200, value: { feedback: await options.mutate(async () => {
          const task = store.getTask(feedbackRoute[1]!);
          const item = store.getItem(task.itemId); await options.assertActiveProject(item.projectId); await assertReadable(item);
          return store.saveFeedback(task.id, clean);
        }) } };
      }
      return null;
    } catch (error) {
      const mapped = fault(error);
      return { status: mapped.status, value: { code: mapped.code, message: mapped.message } };
    }
  }
  return { routes, view, viewWithinMutation, fault };
}
