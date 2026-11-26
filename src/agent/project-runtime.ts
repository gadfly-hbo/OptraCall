import type {GoalContextSourcePort} from './goal-context-source.ts';
import { STRATEGY_DISCUSSION_ACTIONS, type StrategyDiscussionPort } from './strategy-discussion.ts';
import type { MethodIssuePort } from './method-issue.ts';
import type { QuotedDecisionAction, QuotedDecisionToolResult, QuotedDecisionCallContext } from './quoted-decisions.ts';
import type { AnalysisDeliveryPort } from './analysis-delivery.ts';
import type { ProjectTaskResultsRunPort } from './project-task-results.ts';
import { STUDIO_ACTIONS, STUDIO_READ_ACTIONS, type StudioPort, type StudioReadPort } from './studio.ts';
import type { AnalysisPythonEnvironment } from './analysis-python.ts';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RunDiagnostic } from './run-diagnostics.ts';
import type { RuntimeModelConfiguration } from '../host/config-store.ts';
import type { EnterpriseContextProvision } from '../host/enterprise-materials-types.ts';
import type { FeedbackContextReceipt } from '../host/decision-feedback-types.ts';
import { runtimeEnvironment } from '../../scripts/runtime-process.ts';
import type { ProtectedExecutionScope } from './protected-tools.ts';
import type { ProjectDataContextProvision } from '../host/project-data-context-context.ts';
import type { PersonalContextPort, PersonalContextReceipt } from './personal-context.ts';
import type { CaseDecisionPort } from './case-decisions.ts';
import type { CaseRelationsPort } from './case-relations.ts';
import type { CaseSourcesPort } from './case-sources.ts';
import type { SemanticContextPort, SemanticContextReadPort } from './semantic-context.ts';
import type { SapMethodSourcePort } from './sap-method-extraction.ts';
import type { WebSearchToolsPort } from './web-search-tools.ts';
import type { ProjectFilesPort } from './project-files.ts';
import { parseReportCalculationBundleRead, type ReportCalculationPrepared, type ReportCalculationReviewPort, type ReportCalculationSelection } from './report-calculation-review.ts';
import { DB_LINK_ACTIONS, validateDbLinkToolInput, type DbLinkPort } from './db-link-tools.ts';

/** Replacement workspace for non-project agent sessions (e.g. business plugins). */
export type AgentWorkspace = { discussionTools?: 'project-sources'|'goal-draft'|'goal-estimate'|'goal-decomposition'|'goal-plan'|'goal-review'; cwd: string; systemPrompt: readonly string[]; defaultTools?: readonly string[]; capabilityPolicy?: 'fixed-draft' | 'text-only' | 'source-reader' | 'public-search' | 'strategy-discussion' | 'strategy-initiative' };
/** Host-provided context receipt; this describes delivery, not business adoption. */
export type ProvidedContextInput = import('../host/task-round-receipts.ts').TaskRoundReceipts & { projectGoalOrigin?:import('../host/strategy-goals-types.ts').GoalRef; businessRole?:{owner:import('../host/business-role-types.ts').BusinessRoleOwner;version:string;contextSha256:string;sourceRights?:string[]}; taskAssignment?: import('../host/task-assignment.ts').TaskAssignment; goalSourceRefs?:import('../host/strategy-goals-types.ts').GoalRef[]; userQuoteEligible?: boolean; assetFindings?: import('../host/analysis-delivery.ts').DeclaredAssetFinding[]; conclusionReviews?: { reviewId: string; reportPath: string; reportSha256: string; claim: 'provided-not-adopted' }[]; automaticSource?: { kind: 'review-feedback' | 'case-feedback' | 'asset-findings'; parentRequestId: string }; projectPlanPreparation?: { projectId: string; inputHash: string; expectedRevision: number; capturedContext?:{usageContextOrigin?:import('../host/usage-context-types.ts').UsageContextOrigin;usageContext?:import('../host/usage-context-types.ts').UsageContext;goalBasis?:import('../host/strategy-goals-types.ts').GoalBasis} }; projectPlan?: import('../host/project-plan-host.ts').ProjectPlanDelivery; rap?: { instanceId: string; version?: string; frameworkVersion?: string; basisSha256?: string; text: string }; case?: { operationId: string; summary?: string }; enterprise?: EnterpriseContextProvision; feedback?: FeedbackContextReceipt; projectData?: ProjectDataContextProvision[]; personal?: { text: string; receipt: PersonalContextReceipt }; reportCalculationReview?: { contract: 'foreground-report-calculation-v1' }; strategyDiscussion?: { discussionId:string; mapExposure?:import('../host/strategy-map-exposure.ts').MapExposure[]; importSourceIds?:string[]; selectedImportPages?:Record<string,number[]>; importMode?:'review-draft'; draftGroupId?:string; supersedesDraftEntryId?:string; targetMapRef?:{mapId:string;version:number}; workingDraftImportSources?:Array<{sourceId:string;sha256:string;selectedPages?:number[]}>; usageContext?:import('../host/usage-context-types.ts').UsageContext|null; methods:import('../host/strategy-discussion-types.ts').StrategyMethodSelection[]; sources?:import('../host/strategy-discussion-types.ts').StrategyDiscussionSource[]; sourceScope?:import('../host/strategy-discussion-types.ts').StrategyDiscussionSourceScope; projectId?:string; goalBasis?:import('../host/strategy-goals-types.ts').GoalBasis; goal?:import('../host/strategy-goals-types.ts').GoalRef }; originalUserText?: string; studio?: { systemId: string; purpose: 'construction' | 'analysis'; text: string; refs: import('../../extensions/business-plugins/studio/contracts.ts').StudioSourceRef[] } };
export type MemberPackToolGuardPort = (input: { toolName: string; input: Record<string, unknown> }) => { allowed: boolean; reason?: string } | Promise<{ allowed: boolean; reason?: string }>;
export type ProjectAgentOptions = { assignment?: import('../host/task-assignment.ts').TaskAssignment; projectId: string; taskId?: string; projectDirectory?: string; memberPackWorkspaceRoot?: string; memberPackContextStartAt?: number; memberPackPermissionCurrent?: () => boolean; memberPackExecutionScope?: ProtectedExecutionScope; workspace?: AgentWorkspace; analysisPython?: AnalysisPythonEnvironment; protectedExecution?: ProtectedExecutionScope; sessionDirectory: string; sessionFile?: string; draft?: string; codeRoot: string; resourceRoot: string; configuration: Readonly<RuntimeModelConfiguration>; managementPorts: number[]; metricIndexText?: string; goalContextSource?:GoalContextSourcePort; strategyDiscussion?: StrategyDiscussionPort; personalContext?: PersonalContextPort; caseDecisions?: CaseDecisionPort; caseRelations?: CaseRelationsPort; caseSources?: CaseSourcesPort; semanticContext?: SemanticContextPort; semanticContextRead?: SemanticContextReadPort; sapMethodSources?: SapMethodSourcePort; studio?: StudioPort; studioRead?: StudioReadPort; webSearch?: WebSearchToolsPort; dbLink?: DbLinkPort; methodIssue?: MethodIssuePort; quotedDecisions?: (action: QuotedDecisionAction, input: Record<string, unknown>, context: QuotedDecisionCallContext & { originalUserText: string; caseOperationId?: string; projectPlan?: ProvidedContextInput['projectPlan'] }) => Promise<QuotedDecisionToolResult>; analysisDelivery?: AnalysisDeliveryPort; projectTaskResults?: ProjectTaskResultsRunPort; projectFiles?: ProjectFilesPort; memberPackGuard?: MemberPackToolGuardPort; reportCalculationReview?: ReportCalculationReviewPort; simulationTools?: { storeRoot: string; projectId: string }; tradeAreaConnector?: { dataRoot: string }; weatherConnector?: { cacheRoot: string }; modelPackTools?: { modelsRoot: string } };
/** Host callbacks never cross IPC; only the granted capability bit does. */
export type ProjectAgentWireOptions = Omit<ProjectAgentOptions, 'goalContextSource' | 'strategyDiscussion' | 'personalContext' | 'caseDecisions' | 'caseRelations' | 'caseSources' | 'semanticContext' | 'semanticContextRead' | 'sapMethodSources' | 'studio' | 'studioRead' | 'webSearch' | 'dbLink' | 'projectFiles' | 'memberPackGuard' | 'memberPackPermissionCurrent' | 'projectTaskResults' | 'analysisDelivery' | 'quotedDecisions' | 'methodIssue' | 'reportCalculationReview'> & { goalContextSourceEnabled?:boolean; strategyDiscussionEnabled?:boolean; personalContextEnabled?: boolean; caseDecisionsEnabled?: boolean; caseRelationsEnabled?: boolean; experienceLearningEnabled?: boolean; semanticContextEnabled?: boolean; semanticContextReadEnabled?: boolean; sapMethodSourcesEnabled?: boolean; studioEnabled?: boolean; studioReadEnabled?: boolean; webSearchEnabled?: boolean; dbLinkEnabled?: boolean; methodIssueEnabled?: boolean; quotedDecisionsEnabled?: boolean; analysisDeliveryEnabled?: boolean; projectTaskResultsEnabled?: boolean; projectFilesEnabled?: boolean; memberPackGuardEnabled?: boolean; reportCalculationReviewEnabled?: boolean };
export type BrowserUIRequest = { id: string; method: 'select' | 'confirm' | 'input' | 'editor'; title: string; message?: string; options?: string[]; placeholder?: string; prefill?: string };
export type ProjectSnapshot = { cleanupRequestId?: string; sessionId: string; sessionFile?: string; messages: Record<string, any>[]; tools: string[]; status: 'idle' | 'running'; sdkVersion: string; capabilities: Record<string, unknown>; lastRun?: { requestId: string; outcome?: 'completed' | 'cancelled' | 'failed'; diagnostic?: RunDiagnostic }; uiRequests?: BrowserUIRequest[] };
export type ProjectEvent = { type: 'snapshot'; snapshot: ProjectSnapshot } | { type: 'text.delta'; text: string; requestId: string } | { type: 'native'; event: Record<string, any>; requestId?: string } | { type: 'run.settled'; outcome: 'completed' | 'cancelled' | 'failed'; requestId: string; error?: string; diagnostic?: RunDiagnostic } | { type: 'run.accepted'; requestId: string; sessionFile?: string } | { type: 'ui.request'; request: BrowserUIRequest; requestId?: string } | { type: 'ui.dismiss'; id: string } | { type: 'ui.notification'; message: string; level?: string } | { type: 'ui.status'; key: string; text?: string } | { type: 'ui.editor'; text: string };
export class ProjectRuntimeError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

type HostContextRequest = {
  controller: AbortController; owned: boolean; completion: Promise<void>; settled: boolean;
  cleanup?: (options: { retryFailed?: boolean }) => Promise<void>;
  cleanupTask?: Promise<void>; cleanupError?: unknown;
};

function safeToolFault(error: unknown) {
  if (!error || typeof error !== 'object' || (error as { exposure?: unknown }).exposure !== 'safe-tool-error-v1') return {};
  const message = (error as { message?: unknown }).message;
  const raw = (error as { details?: unknown }).details;
  const result: { message?: string; details?: { issues: Record<string, unknown>[] } } = {};
  if (typeof message === 'string' && message.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) result.message = message;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray((raw as { issues?: unknown }).issues)) return result;
  const issues = (raw as { issues: unknown[] }).issues;
  if (issues.length > 20) return result;
  const safe: Record<string, unknown>[] = [];
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) return result;
    const value = issue as Record<string, unknown>, output: Record<string, unknown> = {};
    // Recognize the legacy itemId field without forwarding it, so callers retain structural details.
    if (Object.keys(value).some(key => !['reason','path','itemKind','itemId','page'].includes(key)) || typeof value.reason !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(value.reason)) return result;
    output.reason = value.reason;
    if (value.path !== undefined) {
      if (typeof value.path !== 'string' || value.path.length > 200 || !/^[A-Za-z0-9_.[\]]*$/.test(value.path)) return result;
      output.path = value.path;
    }
    if (value.itemKind !== undefined) {
      if (value.itemKind !== 'node' && value.itemKind !== 'edge' && value.itemKind !== 'source') return result;
      output.itemKind = value.itemKind;
    }
    if (value.page !== undefined) {
      if (!Number.isSafeInteger(value.page) || Number(value.page) < 1) return result;
      output.page = value.page;
    }
    safe.push(output);
  }
  if (Buffer.byteLength(JSON.stringify({ issues: safe }), 'utf8') <= 16 * 1024) result.details = { issues: safe };
  return result;
}

// This adapter only transports SDK calls and events. It never chooses analysis
// steps, parses business data, or implements an agent/tool loop.
export class ProjectAgent {
  #options: ProjectAgentOptions;
  #child?: ChildProcess;
  #opening?: Promise<ProjectSnapshot>;
  #snapshot?: ProjectSnapshot;
  #pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  #listeners = new Set<(event: ProjectEvent) => void>();
  #running?: { id: string; completion: Promise<any>; cancelRequested?: boolean; providedContext?: ProvidedContextInput; reportReview?: { toolCallId: string; prepared?: ReportCalculationPrepared } };
  #accepted = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  #personalRequests = new Map<string, HostContextRequest>();
  #questions = new Map<string, Extract<ProjectEvent, { type: 'ui.request' }>>();
  #closed = false;
  #editorReady = false;
  #closeTask?: Promise<void>;
  #stopTask?: Promise<void>;
  #managedCleanupAcknowledged = false;
  constructor(options: ProjectAgentOptions) { this.#options = options; }
  /** The common Host layer may capture this construction fact. An Agent's
   * snapshot, text, or tool result cannot mint a managed transition proof. */
  get executionMode(): 'unmanaged' | 'ordinary' | 'protected' {
    return this.#options.protectedExecution
      ? this.#options.protectedExecution.profile ?? 'protected'
      : this.#options.memberPackExecutionScope
        ? this.#options.memberPackExecutionScope.profile ?? 'ordinary'
        : 'unmanaged';
  }
  get busy() { return Boolean(this.#running) || [...this.#personalRequests.values()].some(request => request.owned); }
  get alive() { return !this.#closed && Boolean(this.#child?.connected) && this.#child?.exitCode === null && this.#child?.signalCode === null; }
  get pendingUI() { return [...this.#questions.values()]; }
  subscribe(listener: (event: ProjectEvent) => void) { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  #presentSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
    return [...this.#personalRequests.values()].some(request => request.owned) ? { ...snapshot, status: 'running' } : snapshot;
  }
  #emit(event: ProjectEvent) {
    if (event.type === 'snapshot') event = { ...event, snapshot: this.#presentSnapshot(event.snapshot) };
    for (const listener of this.#listeners) listener(event);
  }
  #rpc(method: string, input?: unknown): Promise<any> {
    if (!this.#child?.connected) return Promise.reject(new ProjectRuntimeError('runtime_unavailable'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#child!.send({ kind: 'request', id, method, input }, error => { if (error) { this.#pending.delete(id); reject(new ProjectRuntimeError('runtime_unavailable')); } });
    });
  }
  #cleanupPersonalRequest(request: HostContextRequest, options: { retryFailed?: boolean } = {}): Promise<void> {
    if (!request.cleanup) return Promise.resolve();
    if (request.cleanupError && options.retryFailed === true) { request.cleanupTask = undefined; request.cleanupError = undefined; }
    if (!request.cleanupTask) {
      request.cleanupTask = Promise.resolve().then(() => request.cleanup!({ retryFailed: options.retryFailed === true })).catch(error => { request.cleanupError = error; throw error; });
    }
    return request.cleanupTask;
  }
  #cancelPersonalRequests() {
    for (const [id, request] of this.#personalRequests) {
      request.controller.abort();
      if (!request.owned) this.#personalRequests.delete(id);
      else void this.#cleanupPersonalRequest(request).catch(() => {});
    }
  }
  async #waitPersonalRequests(options: { retryFailed?: boolean } = {}) {
    const requests = [...this.#personalRequests.entries()].filter(([, request]) => request.owned);
    await Promise.all(requests.map(([, request]) => request.completion));
    for (const [id, request] of requests) {
      if (request.cleanupError && options.retryFailed === true) {
        await this.#cleanupPersonalRequest(request, options).catch(() => {});
        if (!request.cleanupError && this.#personalRequests.get(id) === request) this.#personalRequests.delete(id);
      }
    }
    if ([...this.#personalRequests.values()].some(request => request.owned)) throw new ProjectRuntimeError('semantic_context_cleanup_unknown');
  }
  async #personalRequest(child: ChildProcess, raw: any) {
    const current = this.#running, controller = new AbortController();
    const isCase = raw.feature === 'case-decisions', isRelations = raw.feature === 'case-relations', isSources = raw.feature === 'case-sources', isSemantic = raw.feature === 'semantic-context', isSapMethod = raw.feature === 'sap-method-source', isStudio = raw.feature === 'studio';
    const isGoalContextSource = raw.feature === 'goal-context-source';
    const isStrategyDiscussion = raw.feature === 'strategy-discussion';
    const isMethodIssue = raw.feature === 'method-issue';
    const isQuotedDecisions = raw.feature === 'quoted-decisions';
    const isAnalysisDelivery = raw.feature === 'analysis-delivery';
    const isProjectTaskResults = raw.feature === 'project-task-results';
    const isDbLink = raw.feature === 'db-link', isWebSearch = raw.feature === 'web-search', isProjectFiles = raw.feature === 'project-files', isMemberPackGuard = raw.feature === 'member-pack-guard', isReportCalculation = raw.feature === 'report-calculation-review';
    const knownFeature = isGoalContextSource || isStrategyDiscussion || isMethodIssue || isQuotedDecisions || isAnalysisDelivery || isProjectTaskResults || isDbLink || isReportCalculation || isProjectFiles || isMemberPackGuard || isWebSearch || raw.feature === undefined || raw.feature === 'personal' || isCase || isRelations || isSources || isSemantic || isSapMethod || isStudio;
    const semanticRead = isSemantic && raw.action !== 'record' && this.#options.semanticContextRead;
    const studioRead = isStudio && (STUDIO_READ_ACTIONS as readonly string[]).includes(raw.action) && this.#options.studioRead;
    const port = isGoalContextSource ? this.#options.goalContextSource : isStrategyDiscussion ? this.#options.strategyDiscussion : isMethodIssue ? this.#options.methodIssue : isQuotedDecisions ? this.#options.quotedDecisions : isAnalysisDelivery ? this.#options.analysisDelivery : isProjectTaskResults ? this.#options.projectTaskResults : isDbLink ? this.#options.dbLink : isReportCalculation ? this.#options.reportCalculationReview : isProjectFiles ? this.#options.projectFiles : isMemberPackGuard ? this.#options.memberPackGuard : isWebSearch ? this.#options.webSearch : isStudio ? studioRead || this.#options.studio : isSapMethod ? this.#options.sapMethodSources : isCase ? this.#options.caseDecisions : isRelations ? this.#options.caseRelations : isSources ? this.#options.caseSources : isSemantic ? semanticRead || this.#options.semanticContext : this.#options.personalContext;
    const errorCode = isGoalContextSource ? 'goal_context_source_unavailable' : isStrategyDiscussion ? 'strategy_discussion_run_unavailable' : isMethodIssue ? 'method_issue_run_unavailable' : isQuotedDecisions ? 'quoted_decision_run_unavailable' : isAnalysisDelivery ? 'analysis_delivery_run_unavailable' : isProjectTaskResults ? 'project_task_results_run_unavailable' : isDbLink ? 'db_link_run_unavailable' : isReportCalculation ? 'report_calculation_run_unavailable' : isProjectFiles ? 'project_files_run_unavailable' : isMemberPackGuard ? 'member_pack_guard_unavailable' : isWebSearch ? 'web_search_run_unavailable' : isStudio ? 'studio_run_unavailable' : isSapMethod ? 'sap_method_source_run_unavailable' : isCase ? 'case_decision_run_unavailable' : isRelations ? 'case_relation_run_unavailable' : isSources ? 'case_sources_run_unavailable' : isSemantic ? 'semantic_context_run_unavailable' : 'personal_context_run_unavailable';
    const managedGraph = Boolean(semanticRead && raw.action === 'graph' && !this.#options.workspace && this.#options.protectedExecution?.profile === 'ordinary');
    const managedStudioRead = Boolean(studioRead && !this.#options.workspace && this.#options.protectedExecution?.profile === 'ordinary');
    const ordinaryDbLink = isDbLink && this.#options.protectedExecution?.profile === 'ordinary';
    const ordinarySearch = isWebSearch && this.#options.protectedExecution?.profile === 'ordinary';
    const ordinaryReportCalculation = isReportCalculation && this.#options.protectedExecution?.profile === 'ordinary';
    const requiresToolIdentity = isGoalContextSource || isStrategyDiscussion || isMethodIssue || isQuotedDecisions || isAnalysisDelivery || isProjectTaskResults || isDbLink || isReportCalculation || isProjectFiles || isCase || isRelations || isSources || isSemantic || isSapMethod || isStudio || isWebSearch;
    const sourceWorkspace = this.#options.workspace?.capabilityPolicy === 'source-reader' && !this.#options.protectedExecution;
    const scopedRead = sourceWorkspace && semanticRead && ['find', 'read', 'trace'].includes(raw.action);
    const strategyAllowed = isStrategyDiscussion && (this.#options.workspace?.capabilityPolicy === 'strategy-discussion' || this.#options.workspace?.capabilityPolicy === 'strategy-initiative') && !this.#options.protectedExecution;
    const workspaceAllowed = strategyAllowed || (isSapMethod ? sourceWorkspace : scopedRead || !this.#options.workspace);
    const available = () => Boolean(knownFeature && !this.#closed && child === this.#child && child.connected && current && !current.cancelRequested &&
      this.#running === current && raw.requestId === current.id && raw.sessionId === this.#snapshot?.sessionId && !controller.signal.aborted &&
      // The Host checks each database source's held resource/permission domain.
      // A failed cleanup must not withdraw unrelated sources from a valid turn.
      // Parent cancellation and the original owned cleanup still gate this call.
      (this.#options.memberPackPermissionCurrent?.() ?? true) && workspaceAllowed && (!this.#options.protectedExecution || isGoalContextSource && this.#options.protectedExecution.profile === 'ordinary' || managedGraph || managedStudioRead || ordinaryDbLink || ordinarySearch || ordinaryReportCalculation) && this.#options.projectId && (strategyAllowed || scopedRead || this.#options.taskId) &&
      port && (!requiresToolIdentity || typeof raw.toolCallId === 'string' && raw.toolCallId.trim()) && (!(isCase || isRelations || isQuotedDecisions && !['read', 'arrange-actions'].includes(raw.action) && !(raw.action === 'authorize-action' && raw.input?.decision === 'revoke')) || current.providedContext?.case?.operationId) && (!isQuotedDecisions || raw.action === 'read' || current.providedContext?.userQuoteEligible === true && typeof current.providedContext.originalUserText === 'string') &&
      (!isProjectTaskResults || current.providedContext?.projectPlan || current.providedContext?.taskAssignment?.sources?.length) && (!isReportCalculation || current.providedContext?.reportCalculationReview?.contract === 'foreground-report-calculation-v1'));
    if (typeof raw.id !== 'string' || this.#personalRequests.has(raw.id)) return;
    const reply = (value: object) => { if (child.connected) child.send({ kind: 'personal-context-reply', id: raw.id, ...value }, () => {}); };
    const actions = isGoalContextSource ? ['read'] : isStrategyDiscussion ? [...STRATEGY_DISCUSSION_ACTIONS] : isMethodIssue ? ['report'] : isQuotedDecisions ? ['read', 'choose-strategy', 'authorize-action', 'record-feedback', 'arrange-actions'] : isAnalysisDelivery ? ['declare'] : isProjectTaskResults ? ['find', 'read'] : isDbLink ? [...DB_LINK_ACTIONS] : isReportCalculation ? ['prepare', 'validate', 'read-db-bundle'] : isProjectFiles ? ['read-input', 'read-catalog', 'write-report'] : isMemberPackGuard ? ['check'] : isWebSearch ? ['search', 'fetch'] : isStudio ? this.#options.studio && !this.#options.protectedExecution ? [...STUDIO_ACTIONS] : [...STUDIO_READ_ACTIONS] : isSapMethod ? ['catalog', 'read-session', 'find-memory', 'read-memory', 'find-methods', 'read-method'] : isCase || isRelations ? ['read', 'save'] : isSemantic ? ['find', 'read', 'trace', 'record', ...(semanticRead ? ['graph'] : [])] : ['find', 'read'];
    if (!available() || !actions.includes(raw.action) || !raw.input || typeof raw.input !== 'object' || Array.isArray(raw.input) || isRelations && Buffer.byteLength(JSON.stringify(raw.input), 'utf8') > 64 * 1024) { reply({ error: errorCode }); return; }
    const request: HostContextRequest = { controller, owned: Boolean(isGoalContextSource || isStrategyDiscussion || isMethodIssue || isQuotedDecisions || isAnalysisDelivery || isProjectTaskResults || isDbLink || isReportCalculation || isProjectFiles || semanticRead || isStudio || isWebSearch), completion: Promise.resolve(), settled: false };
    this.#personalRequests.set(raw.id, request);
    request.completion = (async () => {
      let response: object;
      let currentDelivery: ReportCalculationPrepared['withCurrentDelivery'];
      try {
        const assertCurrent = () => { if (!available()) throw new ProjectRuntimeError(errorCode); };
        const context = { signal: controller.signal, requestId: current!.id, sessionId: this.#snapshot!.sessionId, toolCallId: raw.toolCallId, assertCurrent,
          ...(isStrategyDiscussion || isDbLink || semanticRead || isStudio ? { runToken: current!, registerCleanup: (cleanup: (options: { retryFailed?: boolean }) => Promise<void>) => {
            if (request.settled) throw new ProjectRuntimeError('semantic_context_run_unavailable');
            if (request.cleanup && request.cleanup !== cleanup) throw new ProjectRuntimeError('semantic_context_cleanup_already_registered');
            request.cleanup = cleanup;
            if (controller.signal.aborted) void this.#cleanupPersonalRequest(request).catch(() => {});
          } } : {}) };
        const result = isMemberPackGuard ? await this.#options.memberPackGuard!({ toolName: String(raw.input.toolName ?? ''), input: (raw.input.input && typeof raw.input.input === 'object' ? raw.input.input : {}) as Record<string, unknown> }) : isReportCalculation ? await (async () => {
          if (raw.action === 'prepare') {
            if (current!.reportReview) throw new ProjectRuntimeError('report_calculation_already_attempted');
            const binding: { toolCallId: string; prepared?: ReportCalculationPrepared } = { toolCallId: raw.toolCallId };
            current!.reportReview = binding;
            try {
              const prepared = await this.#options.reportCalculationReview!(raw.input as ReportCalculationSelection, { ...context, providedContext: current!.providedContext });
              assertCurrent();
              if (typeof prepared.prompt !== 'string' || !prepared.prompt.trim() || prepared.prompt.length > 20_000 || typeof prepared.assertFeedbackCurrent !== 'function') throw new ProjectRuntimeError('report_calculation_materials_unavailable');
              await prepared.assertFeedbackCurrent();
              assertCurrent();
              const packet = { prompt: prepared.prompt, receipt: prepared.receipt, ...(typeof prepared.readDbBundle === 'function' ? { hasDbBundleReader: true } : {}) };
              if (Buffer.byteLength(JSON.stringify(packet), 'utf8') > 256 * 1024) throw new ProjectRuntimeError('personal_context_payload_limit');
              binding.prepared = prepared;
              currentDelivery = prepared.withCurrentDelivery;
              return packet;
            } catch (error) {
              if (current!.reportReview === binding) current!.reportReview = undefined;
              throw error;
            }
          }
          const binding = current!.reportReview;
          if (!binding?.prepared || binding.toolCallId !== raw.toolCallId) throw new ProjectRuntimeError('report_calculation_run_unavailable');
          await binding.prepared.assertFeedbackCurrent();
          assertCurrent();
          currentDelivery = binding.prepared.withCurrentDelivery;
          if (raw.action === 'read-db-bundle') {
            if (typeof binding.prepared.readDbBundle !== 'function') throw new ProjectRuntimeError('report_calculation_bundle_not_selected');
            const range = parseReportCalculationBundleRead(raw.input);
            const value = await binding.prepared.readDbBundle(range, { signal: controller.signal, assertCurrent });
            assertCurrent();
            if (Buffer.byteLength(JSON.stringify(value)) > (range.maxBytes ?? 20_000)) throw new ProjectRuntimeError('report_calculation_materials_too_large');
            await binding.prepared.assertFeedbackCurrent(); assertCurrent();
            return { value };
          }
          return { receipt: binding.prepared.receipt };
        })() : isGoalContextSource ? await this.#options.goalContextSource!(raw.input,{...context,goalRefs:current!.providedContext?.goalSourceRefs??[]}) : isStrategyDiscussion ? await this.#options.strategyDiscussion!(raw.action,raw.input,{...context,originalUserText:current!.providedContext?.originalUserText??'',userQuoteEligible:current!.providedContext?.userQuoteEligible===true,goalBasis:current!.providedContext?.strategyDiscussion?.goalBasis,importSourceIds:current!.providedContext?.strategyDiscussion?.importSourceIds,selectedImportPages:current!.providedContext?.strategyDiscussion?.selectedImportPages,importMode:current!.providedContext?.strategyDiscussion?.importMode,draftGroupId:current!.providedContext?.strategyDiscussion?.draftGroupId,supersedesDraftEntryId:current!.providedContext?.strategyDiscussion?.supersedesDraftEntryId,targetMapRef:current!.providedContext?.strategyDiscussion?.targetMapRef}) : isMethodIssue ? await this.#options.methodIssue!(raw.input, context) : isQuotedDecisions ? await this.#options.quotedDecisions!(raw.action, raw.input, { ...context, originalUserText: current!.providedContext?.originalUserText ?? '', caseOperationId: current!.providedContext?.case?.operationId, projectPlan: current!.providedContext?.projectPlan }) : isAnalysisDelivery ? await this.#options.analysisDelivery!(raw.input, { ...context, providedContext: current!.providedContext }) : isProjectTaskResults ? await this.#options.projectTaskResults!(raw.action, raw.input, { ...context, projectPlan: current!.providedContext!.projectPlan, assignment: current!.providedContext!.taskAssignment }) : isDbLink ? await this.#options.dbLink!(raw.action, validateDbLinkToolInput(raw.action, raw.input), context) : isProjectFiles ? await this.#options.projectFiles!(raw.action, raw.input, context) : isWebSearch
          ? raw.action === 'search' ? await this.#options.webSearch!.search(raw.input.query, controller.signal)
            : await this.#options.webSearch!.fetchPage(raw.input.url, controller.signal)
          : isStudio ? studioRead ? await studioRead(raw.action, raw.input, context) : await this.#options.studio!(raw.action, raw.input, context) : isSapMethod ? await this.#options.sapMethodSources!(raw.action, raw.input, context) : isCase ? await this.#options.caseDecisions!(raw.action, raw.input, { ...context, caseOperationId: current!.providedContext!.case!.operationId }) : isRelations ? await this.#options.caseRelations!(raw.action, raw.input, { ...context, caseOperationId: current!.providedContext!.case!.operationId }) : isSemantic ? semanticRead ? await semanticRead(raw.action, raw.input, context) : await this.#options.semanticContext!(raw.action, raw.input, context) : isSources ? await this.#options.caseSources!(raw.action, raw.input, context) : await this.#options.personalContext!(raw.action, raw.input, { signal: controller.signal });
        assertCurrent();
        // The entire envelope is bounded before crossing IPC. Model content has
        // its separate SDK-side character and graph-byte bounds.
        const hasStrategyImage = isStrategyDiscussion && raw.action === 'read-import-source' && result && typeof result === 'object' && 'content' in result && Array.isArray((result as { content?: unknown[] }).content) && (result as { content: Array<{ type?: string }> }).content.some(part => part?.type === 'image');
        const payloadLimit = hasStrategyImage ? 24 * 1024 * 1024 : 256 * 1024;
        if (Buffer.byteLength(JSON.stringify(result), 'utf8') > payloadLimit) throw new ProjectRuntimeError('personal_context_payload_limit');
        response = { result };
      } catch (error) {
        const validCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && (/^[a-z0-9_]{1,100}$/.test(error.code) || isMethodIssue && /^METHOD_[A-Z0-9_]{1,100}$/.test(error.code)) ? error.code : undefined;
        const safe = safeToolFault(error);
        if (validCode) response = { error: validCode, ...safe };
        else {
          const diagnosticId = randomUUID();
          console.error(`[host_tool_failed ${diagnosticId}]`, error);
          response = { error: 'host_tool_failed', message: 'Host 工具执行未完成，请按诊断关联编号核对本机运行记录。', diagnosticId };
        }
      }
      await this.#cleanupPersonalRequest(request).catch(() => {});
      request.settled = true;
      if (request.cleanupError) response = { error: 'semantic_context_cleanup_unknown' };
      else if (this.#personalRequests.get(raw.id) === request) {
        this.#personalRequests.delete(raw.id);
        if (request.owned && !this.#closed && this.#snapshot?.status === 'idle') this.#emit({ type: 'snapshot', snapshot: this.#snapshot });
      }
      // A revoked run can receive an error acknowledgement, never late content.
      if (controller.signal.aborted || this.#running !== current || this.#closed) response = { error: errorCode };
      if (currentDelivery && 'result' in response) {
        try { await currentDelivery(() => { if (!available()) throw new ProjectRuntimeError(errorCode); reply(response); }); }
        catch (error) {
          if (raw.action === 'prepare' && current && current.reportReview?.toolCallId === raw.toolCallId) current.reportReview = undefined;
          const code = (error as { code?: unknown }).code;
          reply({ error: typeof code === 'string' && /^[a-z0-9_]{1,100}$/.test(code) ? code : errorCode });
        }
      } else reply(response);
    })();
    await request.completion;
  }
  open(): Promise<ProjectSnapshot> {
    if (this.#closed) return Promise.reject(new ProjectRuntimeError('runtime_closed'));
    if (!this.#opening) this.#opening = this.#open();
    return this.#opening;
  }
  async #open(): Promise<ProjectSnapshot> {
    const o = this.#options;
    if (!o.workspace && !o.projectDirectory) throw new ProjectRuntimeError('runtime_workspace_missing');
    const workspaceRoot = o.workspace?.cwd ?? path.join(o.projectDirectory!, '020_clean');
    await mkdir(o.resourceRoot, { recursive: true, mode: 0o700 });
    await mkdir(o.sessionDirectory, { recursive: true, mode: 0o700 });
    const temp = o.protectedExecution ? path.join(o.sessionDirectory, '.protected-tmp') : path.join(workspaceRoot, '.tmp');
    await mkdir(temp, { recursive: true, mode: 0o700 });
    if (this.#closed) throw new ProjectRuntimeError('runtime_closed');
    // Optional libraries never replace an unmanaged worker's original Python.
    // Managed tool entrypoints are constructed inside createProtectedTools.
    const child = spawn(process.execPath, [path.join(o.codeRoot, 'scripts/project-entry.mjs')], { cwd: workspaceRoot, detached: process.platform !== 'win32', env: { ...runtimeEnvironment(), PI_CODING_AGENT_DIR: o.resourceRoot, TMPDIR: temp }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    this.#child = child;
    // Provider and extension output is not a log transport. In particular it
    // cannot bypass secret masking through stderr or stdout.
    child.stdout?.resume();
    let startupDiagnostic = '';
    const startupOutput = (chunk: Buffer) => { startupDiagnostic = (startupDiagnostic + chunk.toString()).slice(-2000); };
    child.stderr?.on('data', startupOutput);
    child.on('message', (raw: any) => {
      if (raw?.kind === 'personal-context-request') { void this.#personalRequest(child, raw); return; }
      if (raw?.kind === 'personal-context-cancel') { const request = this.#personalRequests.get(raw.id); if (request) { request.controller.abort(); if (request.owned) void this.#cleanupPersonalRequest(request).catch(() => {}); else this.#personalRequests.delete(raw.id); } return; }
      if (raw?.kind === 'reply') {
        const pending = this.#pending.get(raw.id); if (!pending) return;
        this.#pending.delete(raw.id);
        if (raw.error) { const error = new ProjectRuntimeError(raw.error); error.cause = raw.detail; pending.reject(error); } else pending.resolve(raw.result);
      }
      if (raw?.kind === 'event') {
        if (raw.event?.type === 'snapshot') this.#snapshot = raw.event.snapshot;
        if (raw.event?.type === 'ui.request') this.#questions.set(raw.event.request.id, raw.event);
        if (raw.event?.type === 'ui.dismiss') this.#questions.delete(raw.event.id);
        if (raw.event?.type === 'run.accepted') {
          const ticket = this.#accepted.get(raw.event.requestId);
          const file = raw.event.sessionFile;
          const relative = typeof file === 'string' ? path.relative(this.#options.sessionDirectory, file) : '..';
          if (!file || relative.startsWith('..') || path.isAbsolute(relative)) ticket?.reject(new ProjectRuntimeError('session_persistence_failed'));
          else void (async () => { const handle = await open(file, 'r'); try { await handle.sync(); } finally { await handle.close(); } })().then(() => ticket?.resolve(), () => { ticket?.reject(new ProjectRuntimeError('session_persistence_failed')); void this.stop().catch(() => {}); });
        }
        this.#emit(raw.event);
      }
    });
    const fail = () => { this.#cancelPersonalRequests(); for (const p of this.#pending.values()) p.reject(new ProjectRuntimeError('runtime_process_stopped')); this.#pending.clear(); for (const p of this.#accepted.values()) p.reject(new ProjectRuntimeError('runtime_process_stopped')); this.#accepted.clear(); for (const id of this.#questions.keys()) this.#emit({ type: 'ui.dismiss', id }); this.#questions.clear(); };
    child.on('error', fail); child.on('exit', fail);
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.#signal(child, 'SIGTERM'); reject(new ProjectRuntimeError('runtime_start_timeout')); }, 30_000);
      child.once('exit', () => { clearTimeout(timer); const error = new ProjectRuntimeError('runtime_start_failed'); error.cause = startupDiagnostic; reject(error); });
      child.on('message', (message: any) => { if (message?.kind === 'ready') { clearTimeout(timer); child.stderr?.off('data', startupOutput); child.stderr?.resume(); startupDiagnostic = ''; resolve(); } });
    });
    await ready;
    this.#editorReady = true;
    const { goalContextSource, strategyDiscussion, personalContext, caseDecisions, caseRelations, caseSources, semanticContext, semanticContextRead, sapMethodSources, studio, studioRead, webSearch, dbLink, projectFiles, memberPackGuard, memberPackPermissionCurrent: _memberPackPermissionCurrent, projectTaskResults, analysisDelivery, quotedDecisions, methodIssue, reportCalculationReview, ...serializable } = o;
    const ordinary = !o.workspace && !o.protectedExecution && o.projectId && o.taskId;
    const sourceWorkspace = o.workspace?.capabilityPolicy === 'source-reader' && !o.protectedExecution;
    const graphWorkspace = !o.workspace && (!o.protectedExecution || o.protectedExecution.profile === 'ordinary') && o.taskId;
    const wire: ProjectAgentWireOptions = { ...serializable, goalContextSourceEnabled:Boolean(goalContextSource && graphWorkspace && o.projectId), strategyDiscussionEnabled:Boolean(strategyDiscussion && (o.workspace?.capabilityPolicy === 'strategy-discussion' || o.workspace?.capabilityPolicy === 'strategy-initiative') && !o.protectedExecution), dbLinkEnabled: Boolean(typeof dbLink === 'function' && graphWorkspace && o.projectId), reportCalculationReviewEnabled: Boolean(reportCalculationReview && graphWorkspace && o.projectId), projectFilesEnabled: Boolean(projectFiles && ordinary), memberPackGuardEnabled: Boolean(memberPackGuard && ordinary), projectTaskResultsEnabled: Boolean(projectTaskResults && ordinary), analysisDeliveryEnabled: Boolean(analysisDelivery && ordinary), quotedDecisionsEnabled: Boolean(quotedDecisions && ordinary), methodIssueEnabled: Boolean(methodIssue && ordinary), webSearchEnabled: Boolean(webSearch && graphWorkspace && o.projectId), studioEnabled: Boolean(studio && ordinary), studioReadEnabled: Boolean(studioRead && graphWorkspace && o.projectId), personalContextEnabled: Boolean(personalContext && ordinary), caseDecisionsEnabled: Boolean(caseDecisions && ordinary), caseRelationsEnabled: Boolean(caseRelations && ordinary), experienceLearningEnabled: Boolean(caseSources && ordinary), semanticContextEnabled: Boolean(semanticContext && ordinary), semanticContextReadEnabled: Boolean(semanticContextRead && o.projectId && (sourceWorkspace || graphWorkspace)), sapMethodSourcesEnabled: Boolean(sapMethodSources && sourceWorkspace) };
    this.#snapshot = await this.#rpc('open', wire);
    return this.#presentSnapshot(this.#snapshot!);
  }
  async recordAutomaticAction(data: Record<string, unknown>): Promise<void> {
    if (this.busy) throw new ProjectRuntimeError('session_busy');
    if (!this.alive) throw new ProjectRuntimeError('runtime_unavailable');
    await this.#rpc('record-automatic-action', data);
  }
  async snapshot(): Promise<ProjectSnapshot> { await this.open(); this.#snapshot = await this.#rpc('snapshot'); return this.#presentSnapshot(this.#snapshot!); }
  #execute(method: 'prompt' | 'command', text: string, requestId: string, requestFingerprint?: string, providedContext?: ProvidedContextInput) {
    if (this.busy) throw new ProjectRuntimeError('session_busy');
    // Ordinary Host messages can include a separately bounded source envelope.
    // The fixed-draft resource keeps its approved full-input 20k limit.
    const policy = this.#options.workspace?.capabilityPolicy;
    const textLimit = policy === 'fixed-draft' ? 20_000 : policy === 'text-only' ? 65_536 : providedContext !== undefined ? 131_072 : 20_000;
    if (!text.trim() || text.length > textLimit) throw new ProjectRuntimeError('invalid_message');
    if (requestFingerprint !== undefined && (method !== 'prompt' || typeof requestFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(requestFingerprint))) throw new ProjectRuntimeError('invalid_request_fingerprint');
    const accepted = new Promise<void>((resolve, reject) => { this.#accepted.set(requestId, { resolve, reject }); });
    void accepted.catch(() => {});
    const completion = this.open().then(() => this.#rpc(method, { text, requestId, ...(requestFingerprint === undefined ? {} : { requestFingerprint }), ...(providedContext === undefined ? {} : { providedContext }) })).then(async result => { await this.#waitPersonalRequests(); return result; }, async error => { await this.#waitPersonalRequests(); throw error; }).catch(error => { this.#accepted.get(requestId)?.reject(error); throw error; }).finally(() => { this.#running = undefined; this.#accepted.delete(requestId); });
    this.#running = { id: requestId, completion, providedContext };
    return { requestId, completion, accepted };
  }
  start(text: string, requestId: string, requestFingerprint?: string, providedContext?: ProvidedContextInput) { return this.#execute('prompt', text, requestId, requestFingerprint, providedContext); }
  startCommand(text: string, requestId: string) { return this.#execute('command', text, requestId); }
  async drain() {
    // Unmanaged business workspaces cannot acquire attached subagents. Keep
    // their legacy transport contract: no new drain RPC is required there.
    if (!this.#options.protectedExecution && this.#options.workspace) return;
    if (!this.#child && !this.#opening) return;
    if (this.#opening) await this.#opening;
    if (this.#closed) throw new ProjectRuntimeError('runtime_closed');
    // No SDK turn is created: the common lease waits for its already-owned
    // local calculations while a concurrent stop can still revoke the scope.
    await Promise.all([this.#rpc('drain'), this.#waitPersonalRequests()]);
  }
  async stop(cleanup: { retryFailed?: boolean } = {}) {
    if (this.#running) this.#running.cancelRequested = true;
    this.#cancelPersonalRequests();
    const hasManagedExecutor = Boolean(this.#options.protectedExecution || this.#options.memberPackExecutionScope);
    if (!hasManagedExecutor) { const running = this.#running; if (running) { await this.open(); await this.#rpc('stop'); } await this.#waitPersonalRequests(); await running?.completion; return; }
    if (!this.#stopTask) this.#stopTask = (async () => {
      // A managed scope can contain legitimate background work even after its
      // current SDK turn settled. The driver's close already stops that turn,
      // closes owned tools and waits for SDK idle before acknowledging cleanup.
      // Share its one close task with concurrent turn retirement; a separate
      // stop RPC can otherwise be interrupted by retirement's disconnect.
      if (this.#opening) await this.#opening;
      await this.close({ retryFailed: cleanup.retryFailed === true });
    })();
    return this.#stopTask;
  }
  async command(text: string, requestId: string = randomUUID()) { const run = this.#execute('command', text, requestId); const [result] = await Promise.all([run.completion, run.accepted]); return result; }
  respondUI(input: { id: string; value?: string | boolean; cancelled?: boolean }) { return this.#rpc('ui-response', input); }
  setEditorState(text: string) { this.#options.draft = text; return this.#editorReady ? this.#rpc('editor-state', { text }) : Promise.resolve(); }
  close(cleanup: { retryFailed?: boolean } = {}): Promise<void> {
    if (!this.#closeTask) {
      this.#closed = true; this.#cancelPersonalRequests();
      const task = this.#dispose(cleanup); this.#closeTask = task;
      const hasManagedExecutor = Boolean(this.#options.protectedExecution || this.#options.memberPackExecutionScope);
      // Retry only resource cleanup on an explicit close, never a model turn.
      void task.catch(error => { if ((hasManagedExecutor || error instanceof ProjectRuntimeError && ['subagent_cleanup_unknown', 'semantic_context_cleanup_unknown'].includes(error.code)) && this.#closeTask === task) this.#closeTask = undefined; });
    }
    return this.#closeTask;
  }
  #signal(child: ChildProcess, signal: NodeJS.Signals) {
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* owned process group has exited */ }
  }
  async #dispose(cleanup: { retryFailed?: boolean }) {
    // Revoke the SDK caller immediately as well as the Host request. Waiting
    // for Python before closing the caller could let its tool error dispatch
    // another model turn in the interval between reap and driver shutdown.
    const results = await Promise.allSettled([
      this.#waitPersonalRequests({ retryFailed: cleanup.retryFailed !== false }),
      this.#disposeDriver(cleanup),
    ]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
  async #disposeDriver(cleanup: { retryFailed?: boolean }) {
    if (!this.#child) return;
    const child = this.#child;
    const hasManagedExecutor = Boolean(this.#options.protectedExecution || this.#options.memberPackExecutionScope);
    let protectedCleanupAcknowledged = this.#managedCleanupAcknowledged;
    if (child.exitCode === null && child.signalCode === null) {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let cleanupError: unknown;
      await Promise.race([this.#rpc('close', { retryFailed: cleanup.retryFailed !== false }).then(result => { protectedCleanupAcknowledged = result?.closed === true; if (protectedCleanupAcknowledged) this.#managedCleanupAcknowledged = true; }, error => { cleanupError = error; }), new Promise<void>(resolve => { deadline = setTimeout(() => { if (!hasManagedExecutor) this.#signal(child, 'SIGTERM'); resolve(); }, hasManagedExecutor ? 8000 : 3000); })]);
      if (deadline) clearTimeout(deadline);
      // A responsive ordinary driver can also own an attached SDK resource
      // whose shutdown failed. Retain that exact handle for explicit cleanup;
      // killing the driver must not stand in for its acknowledgement.
      if (!protectedCleanupAcknowledged && child.connected && cleanupError instanceof ProjectRuntimeError && (cleanupError.cause as { message?: string } | undefined)?.message === 'subagent_cleanup_unknown') {
        const error = new ProjectRuntimeError('subagent_cleanup_unknown'); error.cause = cleanupError; throw error;
      }
      // Keep a responsive driver and its exact executor ownership available for
      // explicit cleanup retry. Killing it after an error loses that authority.
      if (hasManagedExecutor && !protectedCleanupAcknowledged && child.connected) {
        const error = new ProjectRuntimeError('protected_cleanup_unknown'); error.cause = cleanupError; throw error;
      }
    }
    // A signal exit has exitCode=null too. Do not wait for an event that already
    // happened when the terminal process group interrupted the native runtime.
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.#signal(child, 'SIGKILL'); }, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    // A reaped group's numeric ID may be reused; a successful managed close
    // already proves its execution resources are gone and needs no stale kill.
    if (!hasManagedExecutor) this.#signal(child, 'SIGKILL');
    this.#listeners.clear();
    // Killing the trusted SDK driver does not establish that its separately
    // sandboxed tool processes were cleaned up. Preserve the shared owner's
    // quarantine unless that driver explicitly completed executor cleanup.
    if (hasManagedExecutor && !protectedCleanupAcknowledged) throw new ProjectRuntimeError('protected_cleanup_unknown');
  }
}
