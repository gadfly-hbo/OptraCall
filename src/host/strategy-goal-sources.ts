import type { CaseStore } from './case-store.ts';
import type { ProjectStore } from './project-store.ts';
import type { createDecisionBoardStore } from '../../extensions/business-plugins/decision-board/storage/store.ts';
import type { BoardItemRecord } from '../../extensions/business-plugins/decision-board/types.ts';
import type { createMetricLibrary } from '../../extensions/business-plugins/metric-factory/library/store.ts';
import type { GoalSourceRef, GoalScope, GoalDiscussionSourceRef } from './strategy-goals-types.ts';
import type { EnterpriseScopeStore } from './enterprise-scope-store.ts';
import { StrategyGoalsError, parseGoalSourceRef } from './strategy-goals-store.ts';
import { createHash } from 'node:crypto';

export interface StrategyGoalSourcesOptions {
  cases: Pick<CaseStore, 'listCases' | 'getCase' | 'getEvents' | 'getStrategyChoice'>;
  projects: Pick<ProjectStore, 'list' | 'get' | 'getTask'>;
  board: Pick<ReturnType<typeof createDecisionBoardStore>, 'listItems' | 'getItem' | 'listTasks' | 'getTask' | 'listFeedbackHistory' | 'getFeedbackRevision' | 'getActionAuthorization' | 'listActionAuthorizations'>;
  metrics: Pick<ReturnType<typeof createMetricLibrary>, 'list' | 'read'>;
  assertBoardItemReadable(item: BoardItemRecord): Promise<void>;
  /** Resolve only Host-owned discussion metadata/native paths, never a client sessionFile. */
  readDiscussionSource?(source: GoalDiscussionSourceRef): Promise<void>;
}
export interface StrategyGoalSourceDirectory { sources: { label: string; ref: GoalSourceRef }[]; unavailable: { authority: GoalSourceRef['authority']; code: string }[] }
function unavailable(): never { throw new StrategyGoalsError('strategy_goal_feedback_source_unavailable', 409); }
function changed(): never { throw new StrategyGoalsError('strategy_goal_feedback_source_changed', 409); }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** A department may declare a known enterprise, or retain an unknown upper organization without inventing one. */
export function validateStrategyGoalScope(scope: GoalScope, directory: Pick<EnterpriseScopeStore, 'get'>): void {
  try {
    if (!scope || !['enterprise', 'department', 'personal'].includes(scope.kind) || typeof scope.id !== 'string' || !scope.id.trim() || typeof scope.name !== 'string' || !scope.name.trim()) throw new Error();
    if (scope.kind === 'personal') { if (scope.enterpriseId !== undefined) throw new Error(); return; }
    if (scope.kind === 'enterprise') {
      const enterprise = directory.get(scope.id);
      if (scope.enterpriseId !== undefined && scope.enterpriseId !== enterprise.id || scope.name !== enterprise.name) throw new Error();
      return;
    }
    if (scope.enterpriseId !== undefined) directory.get(scope.enterpriseId);
  } catch { throw new StrategyGoalsError('strategy_goal_scope_unavailable', 409); }
}
export function createStrategyGoalSources(options: StrategyGoalSourcesOptions) {
  async function readSource(source: GoalSourceRef): Promise<void> {
    if (source.authority === 'strategy-discussion') {
      let ref: GoalDiscussionSourceRef;
      try { ref = parseGoalSourceRef(source) as GoalDiscussionSourceRef; } catch { return unavailable(); }
      if (!options.readDiscussionSource) return unavailable();
      await options.readDiscussionSource(ref);
      return;
    }
    if (source.authority === 'case') {
      if (typeof source.version === 'string') {
        const choice = options.cases.getStrategyChoice(source.id, source.version), quote = choice.quoteProvenance;
        if (quote ? source.projectId !== quote.projectId || source.taskId !== quote.taskId : source.projectId !== undefined || source.taskId !== undefined) return unavailable();
        if (source.sha256 && source.sha256 !== hash(choice)) return changed();
        if (quote) await options.projects.getTask(quote.projectId, quote.taskId);
        if (hash(options.cases.getStrategyChoice(source.id, source.version)) !== hash(choice)) return changed();
        return;
      }
      if (!Number.isSafeInteger(source.version) || Number(source.version) < 1 || source.projectId || source.taskId || source.sha256) return unavailable();
      const record = options.cases.getCase(source.id);
      if (record.revision !== source.version && !options.cases.getEvents('case', record.id).some(event => event.revision === source.version)) return changed();
      return;
    }
    if (source.authority === 'project') {
      if (source.taskId || source.projectId && source.projectId !== source.id) return unavailable();
      const record = await options.projects.get(source.id);
      if (source.version !== record.updatedAt || source.sha256 !== hash(record)) return changed();
      return;
    }
    if (source.authority === 'task') {
      if (!source.projectId || source.taskId !== source.id) return unavailable();
      const record = await options.projects.getTask(source.projectId, source.id);
      if (source.version !== record.updatedAt || source.sha256 !== hash(record)) return changed();
      return;
    }
    if (source.authority === 'sap-metric') {
      if (typeof source.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(source.version) || source.projectId || source.taskId) return unavailable();
      let read;
      try { read = options.metrics.read(source.id, source.version); } catch { return unavailable(); }
      if (source.sha256 !== read.entry.bytesSha256) return changed();
      return;
    }
    if (source.authority !== 'decision-board') return unavailable();
    if (typeof source.version === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(source.version)) {
      const authorization = options.board.getActionAuthorization(source.version), feedback = options.board.getFeedbackRevision(source.version);
      if (authorization && feedback) return unavailable();
      const record = authorization ?? feedback;
      if (!record || record.taskId !== source.id || source.taskId !== undefined && source.taskId !== record.taskId) return unavailable();
      const task = options.board.getTask(record.taskId), item = options.board.getItem(task.itemId);
      if (item.projectId !== source.projectId || authorization && (authorization.projectId !== item.projectId || authorization.itemId !== item.id || (authorization.quoteProvenance ? authorization.quoteProvenance.projectId !== item.projectId : !authorization.caseConfirmation))) return unavailable();
      if (source.sha256 && source.sha256 !== hash(record)) return changed();
      await options.projects.get(item.projectId); await options.assertBoardItemReadable(item);
      const reread = authorization ? options.board.getActionAuthorization(source.version) : options.board.getFeedbackRevision(source.version);
      if (!reread || hash(reread) !== hash(record) || options.board.getTask(task.id).itemId !== item.id || options.board.getItem(item.id).projectId !== item.projectId) return unavailable();
      return;
    }
    if (!source.taskId) {
      const item = options.board.getItem(source.id);
      if (source.projectId !== item.projectId) return unavailable();
      if (source.version !== item.updatedAt || source.sha256 !== hash(item)) return changed();
      await options.projects.get(item.projectId); await options.assertBoardItemReadable(item);
      if (hash(options.board.getItem(item.id)) !== source.sha256) return changed();
      return;
    }
    return unavailable();
  }
  async function validate(source: GoalSourceRef): Promise<void> {
    try { await readSource(source); }
    catch (error) { if (error instanceof StrategyGoalsError) throw error; return unavailable(); }
  }
  async function list(): Promise<StrategyGoalSourceDirectory> {
    const result: StrategyGoalSourceDirectory = { sources: [], unavailable: [] };
    const gap = (authority: GoalSourceRef['authority']) => { if (!result.unavailable.some(value => value.authority === authority)) result.unavailable.push({ authority, code: 'strategy_goal_feedback_source_unavailable' }); };
    const attempt = async (authority: GoalSourceRef['authority'], read: () => void | Promise<void>) => { try { await read(); } catch { gap(authority); } };
    const add = (label: string, ref: GoalSourceRef) => attempt(ref.authority, async () => { await validate(ref); result.sources.push({ label, ref }); });
    await attempt('case', async () => {
      for (const record of options.cases.listCases()) {
        await add(`Case · ${record.title} · 第${record.revision}版`, { authority: 'case', id: record.id, version: record.revision });
        for (const event of options.cases.getEvents('case', record.id).filter(event => event.eventType === 'case_strategy_choice')) await attempt('case', async () => {
          const choice = options.cases.getStrategyChoice(record.id, event.id), quote = choice.quoteProvenance;
          await add(`Case选择记录 · ${record.title} · ${choice.occurredAt}`, { authority: 'case', id: record.id, version: choice.choiceId, ...(quote ? { projectId: quote.projectId, taskId: quote.taskId } : {}) });
        });
      }
    });
    await attempt('project', async () => {
      for (const project of await options.projects.list()) {
        await add(`项目 · ${project.name}`, { authority: 'project', id: project.id, version: project.updatedAt, sha256: hash(project) });
        for (const task of project.tasks) await add(`任务 · ${project.name} / ${task.name}`, { authority: 'task', id: task.id, projectId: project.id, taskId: task.id, version: task.updatedAt, sha256: hash(task) });
      }
    });
    await attempt('sap-metric', async () => {
      for (const entry of options.metrics.list()) await add(`SAP指标 · ${entry.id} · ${entry.version}`, { authority: 'sap-metric', id: entry.id, version: entry.version, sha256: entry.bytesSha256 });
    });
    await attempt('decision-board', async () => {
      for (const item of options.board.listItems()) await add(`看板选择 · ${item.title}`, { authority: 'decision-board', id: item.id, version: item.updatedAt, projectId: item.projectId, sha256: hash(item) });
      for (const task of options.board.listTasks()) {
        for (const authorization of options.board.listActionAuthorizations(task.id)) await add(`行动授权／撤回记录 · ${task.title} · 第${authorization.revision}版`, { authority: 'decision-board', id: task.id, version: authorization.authorizationId, taskId: task.id, projectId: authorization.projectId });
        for (const feedback of options.board.listFeedbackHistory(task.id)) await attempt('decision-board', async () => {
          const item = options.board.getItem(task.itemId);
          await add(`行动反馈 · ${task.title} · 第${feedback.revisionNumber}版`, { authority: 'decision-board', id: task.id, version: feedback.revisionId, taskId: task.id, projectId: item.projectId });
        });
      }
    });
    return result;
  }
  return { validate, list };
}
