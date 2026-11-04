import { SemanticContextPanel } from './SemanticContextPanel.tsx';
import { semanticRecordsForAssistant } from './semantic-context-history.ts';
import { PersonalContextHistory } from './PersonalContextHistory.tsx';
import { PersonalContextTargetPicker, PersonalContextSelectionNotice, personalTargetLabel, type PersonalContextChoice } from './PersonalContextControls.tsx';
import type { PersonalContextSelection } from '../personal-context-types.ts';
import { readRunDiagnostic } from '../../agent/run-diagnostics.ts';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CatalogPage } from './CatalogPage.tsx';
import { DecisionBoardPage } from '../../../extensions/business-plugins/decision-board/ui/DecisionBoardPage.tsx';
import '../../../extensions/business-plugins/decision-board/ui/decision-board.css';
import { HelpPage } from './HelpPage.tsx';
import { EnterpriseMaterialsPage } from './EnterpriseMaterialsPage.tsx';
import { PersonalMaterialsPage } from './PersonalMaterialsPage.tsx';
import { ExperienceComparisonDialog, type ComparisonContext } from './ExperienceComparisonDialog.tsx';
import type { PersonalRetentionEntry } from './personal-retention-client.ts';
import { EnterpriseMaterialPicker, EnterpriseContextReceipt, EnterpriseContextHistory, type EnterpriseCaseSelection } from './EnterpriseMaterialPicker.tsx';
import type { EnterpriseMaterialSelection } from '../enterprise-materials-types.ts';
import { ProjectDataSelectionNotice, ProjectDataContextHistory } from './ProjectDataContextPanel.tsx';
import { addTaskProjectDataSelection, projectDataSelectionKey, type TaskProjectDataSelections } from './project-data-context-client.ts';
import type { FeedbackContextSelection } from '../decision-feedback-types.ts';
import { FeedbackContextPanel, FeedbackReceiptHistory, FeedbackRequirementDialog, type FeedbackNextSource, type FeedbackReviewStart } from './FeedbackContextPanel.tsx';
import './help-page.css';
import { NewProjectDialog, ProjectFiles } from './ProjectSpace.tsx';
import { ModelSettings } from './ModelSettings.tsx';
import { BrowserInteraction } from './BrowserInteraction.tsx';
import { TaskCaseDialog } from './TaskCaseDialog.tsx';
import { VerificationPanel } from './VerificationPanel.tsx';
import { TaskWorkflow } from './TaskWorkflow.tsx';
import type { AutomaticSettingsHandle } from './AutomaticVerificationPanel.tsx';
import { CaseBoard } from './CaseBoard.tsx';
import { emptyCaseDecisionUiState, type CaseDecisionUiState } from './CaseDecisionsPanel.tsx';
import { ProjectBoard } from './ProjectBoard.tsx';
import * as caseClient from './case-client.ts';
import type { CaseContextSelection, CaseRecord, ProjectWorkRecord } from '../case-types.ts';
import './case-board.css';
import { ProjectNavigation } from './ProjectNavigation.tsx';
import { RenameProjectDialog, TaskDialog } from './ProjectDialogs.tsx';
import { TaskCapabilityList } from './TaskCapabilities.tsx';
import { TASK_CAPABILITIES, type TaskCapability, type TaskCapabilities } from '../task-capabilities.ts';
import { answerInteraction, archiveProject, createTask as createDiskTask, createProject as createDiskProject, HostRequestError, listProjects, openTask, readConfigurations, readTask, renameProject, restoreProject, runCommand, saveDraft, saveReport, sendMessage, setTaskCapability, stopTask, observeTask, type TaskObservationState } from './runtime-client.ts';
import { messageText, nativeMessageText, taskKey, type BrowserUIRequest, type BrowserUIResponse, type ClientProject, type ClientTask, type NativeMessage, type ProjectEvent, type PublicModelConfiguration, type SessionSnapshot } from './project-types.ts';
import { catalogCategories, catalogMeta, type CatalogCategory, type CatalogEntry } from './catalog-data.ts';
import { MetricFactoryPage } from '../../../extensions/business-plugins/metric-factory/ui/MetricFactoryPage.tsx';
import { RequirementPage } from '../../../extensions/business-plugins/requirements-elaboration/ui/RequirementPage.tsx';
import { RefinerPage, type RefinerSource, type RefinerLeaveGuard } from '../../../extensions/business-plugins/ppt-refiner/ui/RefinerPage.tsx';
import { SimLabPage } from '../../../extensions/business-plugins/sim-lab/ui/SimLabPage.tsx';
import { freezeSuggestionFor, type FreezeSuggestion } from '../../../extensions/business-plugins/sim-lab/ui/task-suggestions.ts';
import '../../../extensions/business-plugins/sim-lab/ui/simlab.css';
import type { RequirementContextSelection } from './requirement-types.ts';

type AppView = 'cases' | 'projects' | 'chat' | 'settings' | 'decision' | 'metric' | 'requirement' | 'refiner' | 'enterprise-materials' | 'personal-materials' | 'simlab' | CatalogCategory;

type IconName = 'panel' | 'plus' | 'chat' | 'settings' | 'arrow' | 'stop' | 'check' | 'warning' | 'moon' | 'sun' | 'back' | 'assets' | 'scenarios' | 'connector' | 'plugin' | 'folder' | 'help';
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const shapes: Record<IconName, ReactNode> = {
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4m0 3v.1" /></>,
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
    panel: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    chat: <path d="M21 11a8 8 0 0 1-8 8H6l-4 3 1-6a8 8 0 0 1-1-5 9 9 0 0 1 19 0Z" />,
    settings: <><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3Z" /><circle cx="12" cy="11" r="3" /></>,
    arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    check: <path d="m5 12 4 4L19 6" />,
    warning: <><path d="m12 3 10 17H2L12 3Z" /><path d="M12 9v4m0 3v1" /></>,
    moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" /></>,
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    assets: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" /></>,
    scenarios: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/><path d="M17 10V7h-3M7 14v3h3"/></>,
    connector: <><path d="m9 14-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 4 2-2a4 4 0 1 1 6 6l-4 4a4 4 0 0 1-6 0m-3-4 8-8"/></>,
    plugin: <><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M9 5V2m6 3V2M4 11h16M9 15v2m6-2v2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}
const catalogIcons: Record<CatalogCategory, IconName> = { assets: 'assets', scenarios: 'scenarios', connectors: 'connector', plugins: 'plugin' };

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true"><span /><i /></span>;
}

type TaskUI = { observation?: TaskObservationState; snapshot?: SessionSnapshot; streaming: string; status: 'connecting' | 'idle' | 'running' | 'stopping'; connected: boolean; posting: boolean; opening?: boolean; uiRequests: BrowserUIRequest[]; deferredRequestId?: string; extensionStatus?: Record<string, string>; finalReceived?: boolean; requestId?: string; optimistic?: string; error?: string; failedPrompt?: string; unavailablePersonal?: PersonalContextSelection[]; uncertainPersonalSend?: { args: Parameters<typeof sendMessage> }; toolStatus?: string; draftSaving?: boolean; commandResult?: string; notice?: string };
const initialUI = (): TaskUI => ({ streaming: '', status: 'connecting', connected: false, posting: false, uiRequests: [] });
const safeError = (error: unknown): string => error instanceof HostRequestError ? error.code === 'project_busy' ? '项目中还有运行、打开或待回应的任务，请先停止或等待后归档。' : error.message : '本地服务暂时不可用，请重新连接。';
const messagesOf = (snapshot?: SessionSnapshot) => snapshot?.messages.filter(message => ['user', 'assistant', 'toolResult', 'bashExecution'].includes(message.role) || (message.role === 'custom' && message.display === true)) ?? [];
const diagnosticText = (value: unknown): string | undefined => { const diagnostic = readRunDiagnostic(value); return diagnostic ? `${diagnostic.message}${diagnostic.retryCount ? `（原生重试 ${diagnostic.retryCount} 次）` : ''}` : undefined; };
const lastRunError = (task: ClientTask) => task.lastRun?.status === 'interrupted' ? `${diagnosticText(task.lastRun.diagnostic) ?? ''} 上次运行已中断，远端结果未知；不会自动重放。`.trim() : task.lastRun?.status === 'failed' ? diagnosticText(task.lastRun.diagnostic) ?? '上次回复未完成，可在检查配置后继续。' : undefined;

export function App() {
  const [projects, setProjects] = useState<ClientProject[]>([]), [activeId, setActiveId] = useState<string>(), [activeTaskId, setActiveTaskId] = useState<string>(), [ui, setUI] = useState<Record<string, TaskUI>>({});
  const [view, setViewState] = useState<AppView>(() => new URL(window.location.href).searchParams.has('project') ? 'chat' : 'cases'); const lastWorkspace = useRef<'chat' | 'decision' | 'cases' | 'projects'>('cases'), settingsReturnView = useRef<AppView>('chat');
  const [refinerSource, setRefinerSource] = useState<RefinerSource>();
  const [personalCurrentKey, setPersonalCurrentKey] = useState<string>();
  const [personalChoice, setPersonalChoice] = useState<PersonalContextChoice>();
  const [personalEntry, setPersonalEntry] = useState<PersonalRetentionEntry>();
  const [personalMounted, setPersonalMounted] = useState(false);
  const [comparisonContexts, setComparisonContexts] = useState<Record<string, ComparisonContext>>({}), [comparisonKey, setComparisonKey] = useState<string>();
  const [materialFocus, setMaterialFocus] = useState<{ materialId: string; revisionId?: string }>();
  const [refinerDeckId, setRefinerDeckId] = useState<string>();
  const refinerLeave = useRef<RefinerLeaveGuard | null>(null), refinerLeaving = useRef<Promise<boolean> | null>(null);
  const registerRefinerLeave = useCallback((guard: RefinerLeaveGuard | null) => { refinerLeave.current = guard; }, []);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpTrigger = useRef<HTMLButtonElement>(null);
  const closeHelp = () => { setHelpOpen(false); requestAnimationFrame(() => helpTrigger.current?.focus()); };
  const [taskCaseOpen, setTaskCaseOpen] = useState(false), [caseFocus, setCaseFocus] = useState<string>();
  const [caseMode, setCaseMode] = useState<'cards' | 'list'>('cards'), [projectMode, setProjectMode] = useState<'cards' | 'list'>('cards');
  const [caseDecisionUi, setCaseDecisionUi] = useState<Record<string, CaseDecisionUiState>>({});
  const [caseContexts, setCaseContexts] = useState<Record<string, { selection: CaseContextSelection; record: CaseRecord; work: ProjectWorkRecord | null }>>({});
  const [requirementContexts, setRequirementContexts] = useState<Record<string, RequirementContextSelection>>({});
  const [simlabTarget, setSimlabTarget] = useState<FreezeSuggestion>();
  const [enterpriseMaterials, setEnterpriseMaterials] = useState<Record<string, EnterpriseMaterialSelection[]>>({});
  const [personalContexts, setPersonalContexts] = useState<Record<string, { selection: PersonalContextSelection; title: string }[]>>({});
  const [projectDataSelections, setProjectDataSelections] = useState<TaskProjectDataSelections>({});
  const [feedbackContexts, setFeedbackContexts] = useState<Record<string, FeedbackContextSelection>>({});
  const [feedbackReview, setFeedbackReview] = useState<FeedbackReviewStart>(), [feedbackNextSource, setFeedbackNextSource] = useState<FeedbackNextSource>(), [requirementFocus, setRequirementFocus] = useState<string>();
  const [requirementReturnTask, setRequirementReturnTask] = useState<{ projectId: string; taskId: string }>();
  const [enterpriseCases, setEnterpriseCases] = useState<Record<string, EnterpriseCaseSelection | undefined>>({});
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 760), [filesOpen, setFilesOpen] = useState(() => window.innerWidth > 1100);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false), [taskDialogProject, setTaskDialogProject] = useState<ClientProject>(), [renameTarget, setRenameTarget] = useState<ClientProject>(), [projectActionId, setProjectActionId] = useState<string>();
  const [capabilityUpdating, setCapabilityUpdating] = useState(false);
  const automaticSettings = useRef<AutomaticSettingsHandle>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [configurations, setConfigurations] = useState<PublicModelConfiguration[]>([]), [selectedId, setSelectedId] = useState<string | null>(null);
  const [hostStatus, setHostStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading'), [globalError, setGlobalError] = useState(''), [globalNotice, setGlobalNotice] = useState(''), [filesRevision, setFilesRevision] = useState(0);
  const setView = (next: AppView) => {
    if (view !== 'refiner' || next === 'refiner' || !refinerLeave.current) { setViewState(next); return; }
    const waiting = refinerLeaving.current ?? refinerLeave.current(); refinerLeaving.current = waiting;
    void waiting.then(allowed => { if (allowed) setViewState(next); }).catch(error => setGlobalError(safeError(error))).finally(() => { if (refinerLeaving.current === waiting) refinerLeaving.current = null; });
  };
  const textarea = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null), resultsPanel = useRef<HTMLElement>(null), settingsTrigger = useRef<HTMLButtonElement | null>(null), dialogTrigger = useRef<HTMLElement | null>(null);
  const uiRef = useRef(ui);
  const streams = useRef(new Map<string, { controller: AbortController; ready: Promise<void> }>()), draftQueues = useRef(new Map<string, Promise<void>>()), draftEpochs = useRef(new Map<string, number>()), draftVersions = useRef(new Map<string, number>()), pending = useRef(new Set<string>());
  const archivingProjects = useRef(new Set<string>()), deferredStreamErrors = useRef(new Map<string, string>());
  const eventHandler = useRef<(projectId: string, taskId: string, event: ProjectEvent) => void>(() => {}), mounted = useRef(true);
  const active = projects.find(item => item.id === activeId), activeTask = active?.tasks.find(item => item.id === activeTaskId), activeKey = active && activeTask ? taskKey(active.id, activeTask.id) : undefined;
  const selectedCase = activeKey ? caseContexts[activeKey] : undefined;
  const attachedRequirement = activeKey ? requirementContexts[activeKey] : undefined;
  const attachedEnterprise = activeKey ? enterpriseMaterials[activeKey] ?? [] : [];
  const attachedPersonal = activeKey ? personalContexts[activeKey] ?? [] : [];
  const attachedProjectData = activeKey ? projectDataSelections[activeKey] ?? [] : [];
  const attachedFeedback = activeKey ? feedbackContexts[activeKey] : undefined;
  const attachedEnterpriseCase = activeKey && selectedCase && enterpriseCases[activeKey]?.caseId === selectedCase.record.id ? enterpriseCases[activeKey] : undefined;
  const current = activeKey ? ui[activeKey] ?? initialUI() : undefined, archived = Boolean(active?.archivedAt);
  const busy = current?.status === 'running' || current?.status === 'stopping' || Boolean(current?.posting) || Boolean(current?.opening) || Boolean(current?.uiRequests?.length);
  const contextLocked = busy || Boolean(current?.uncertainPersonalSend);
  const question = current?.uiRequests?.[0], modalOpen = taskCaseOpen || projectDialogOpen || Boolean(taskDialogProject) || Boolean(renameTarget) || Boolean(feedbackNextSource), config = configurations.find(value => value.id === selectedId);
  const changeUI = (key: string, update: (previous: TaskUI) => TaskUI) => { if (mounted.current) { const next = { ...uiRef.current, [key]: update(uiRef.current[key] ?? initialUI()) }; uiRef.current = next; setUI(next); } };
  const updateTask = (projectId: string, taskId: string, update: (task: ClientTask) => ClientTask) => setProjects(previous => previous.map(project => project.id === projectId ? { ...project, tasks: project.tasks.map(task => task.id === taskId ? update(task) : task) } : project));
  const mergeProject = (value: ClientProject, refreshedTaskId?: string, version?: number, hadPending = false) => setProjects(previous => {
    const old = previous.find(project => project.id === value.id);
    const project = { ...value, tasks: value.tasks.map(task => { const local = old?.tasks.find(item => item.id === task.id), key = taskKey(value.id, task.id); const acceptDraft = refreshedTaskId === task.id && !hadPending && !draftQueues.current.has(key) && (draftVersions.current.get(key) ?? 0) === version; return local && !acceptDraft ? { ...task, draft: local.draft } : task; }) };
    return old ? previous.map(item => item.id === project.id ? project : item) : [...previous, project];
  });
  const refreshConfigurations = async () => { try { const value = await readConfigurations(); if (!mounted.current) return; setConfigurations(value.configurations); setSelectedId(value.selectedId); setHostStatus('ready'); setGlobalError(''); } catch (error) { if (mounted.current) { setHostStatus('unavailable'); setGlobalError(safeError(error)); } throw error; } };
  const applySnapshot = (key: string, snapshot: SessionSnapshot) => changeUI(key, old => ({ ...old, snapshot, streaming: snapshot.status === 'running' ? old.streaming : '', optimistic: undefined, status: snapshot.status === 'running' ? 'running' : 'idle', requestId: snapshot.status === 'running' ? snapshot.lastRun?.requestId ?? old.requestId : undefined, uiRequests: snapshot.uiRequests ?? [], toolStatus: undefined, finalReceived: false }));
  const refreshTask = async (projectId: string, taskId: string) => {
    const key = taskKey(projectId, taskId), version = draftVersions.current.get(key) ?? 0, hadPending = draftQueues.current.has(key), value = await readTask(projectId, taskId);
    if (!mounted.current) return value;
    if (value.project.id !== projectId || value.task.id !== taskId) throw new HostRequestError('原任务归属未能核对；保留原请求与问题。');
    const uncertain = uiRef.current[key]?.uncertainPersonalSend;
    if (uncertain && value.task.lastRun?.id === uncertain.args[3]) { changeUI(key, old => ({ ...old, uncertainPersonalSend: undefined, failedPrompt: undefined, notice: '已核对原请求已接受；未重新发送。' })); await persistDraft(projectId, taskId, ''); }
    mergeProject(value.project, taskId, version, hadPending); applySnapshot(key, value.snapshot); changeUI(key, old => ({ ...old, error: lastRunError(value.task) ?? old.error })); setFilesRevision(previous => previous + 1); return value;
  };
  const connect = (projectId: string, taskId: string): Promise<void> => {
    const key = taskKey(projectId, taskId), existing = streams.current.get(key); if (existing) return existing.ready;
    const controller = new AbortController(); let resolveReady!: () => void, rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }); void ready.catch(() => {});
    streams.current.set(key, { controller, ready }); changeUI(key, old => ({ ...old, connected: false }));
    const isCurrent = () => !controller.signal.aborted && streams.current.get(key)?.controller === controller;
    void observeTask(projectId, taskId, event => { if (isCurrent()) { eventHandler.current(projectId, taskId, event); if (event.type === 'snapshot') resolveReady(); } }, controller.signal, {
      expectedRequestId: () => uiRef.current[key]?.requestId,
      onConnection: observation => {
        if (!isCurrent()) return;
        changeUI(key, old => ({ ...old, connected: observation.state === 'connected', observation }));
        if (observation.state === 'disconnected') {
          const error = new HostRequestError(observation.message ?? '任务观察暂未恢复，请显式重新连接。', {}, 'observation_unavailable');
          rejectReady(error);
          if (archivingProjects.current.has(projectId)) deferredStreamErrors.current.set(key, error.message);
        }
      },
      onReadback: (value, requestId) => {
        if (!isCurrent() || (uiRef.current[key]?.requestId && uiRef.current[key]?.requestId !== requestId)) return;
        // Observation must not overwrite an unsent draft with a stale GET response.
        mergeProject(value.project); applySnapshot(key, value.snapshot);
        const terminal = value.task.lastRun?.status !== 'running';
        changeUI(key, old => ({ ...old, ...(terminal ? { posting: false, failedPrompt: value.task.lastRun?.status === 'failed' ? old.failedPrompt : undefined } : {}), error: lastRunError(value.task) ?? old.error, notice: value.task.lastRun?.status === 'cancelled' ? '已读回停止状态，已保存的部分输出仍保留。' : old.notice }));
        setFilesRevision(previous => previous + 1);
      },
    }).catch(error => {
      rejectReady(error);
      if (isCurrent()) {
        if (archivingProjects.current.has(projectId)) { deferredStreamErrors.current.set(key, safeError(error)); changeUI(key, old => ({ ...old, connected: false })); }
        else changeUI(key, old => ({ ...old, connected: false, error: safeError(error) }));
      }
    }).finally(() => { rejectReady(new DOMException('Task observation closed', 'AbortError')); if (streams.current.get(key)?.controller === controller) streams.current.delete(key); });
    return ready;
  };
  eventHandler.current = (projectId, taskId, event) => {
    if ((event.projectId && event.projectId !== projectId) || (event.taskId && event.taskId !== taskId)) return;
    const key = taskKey(projectId, taskId);
    if (event.type === 'snapshot') { applySnapshot(key, event.snapshot); changeUI(key, old => ({ ...old, connected: true })); return; }
    if (event.type === 'ui.request') { changeUI(key, old => { const requests = old.uiRequests ?? []; return { ...old, uiRequests: requests.some(request => request.id === event.request.id) ? requests.map(request => request.id === event.request.id ? event.request : request) : [...requests, event.request] }; }); return; }
    if (event.type === 'ui.dismiss') { changeUI(key, old => ({ ...old, uiRequests: (old.uiRequests ?? []).filter(request => request.id !== event.id), deferredRequestId: old.deferredRequestId === event.id ? undefined : old.deferredRequestId })); return; }
    if (event.type === 'ui.notification') { changeUI(key, old => ({ ...old, notice: event.message })); return; }
    if (event.type === 'ui.status') { changeUI(key, old => { const extensionStatus = { ...old.extensionStatus }; if (event.text) extensionStatus[event.key] = event.text; else delete extensionStatus[event.key]; return { ...old, extensionStatus }; }); return; }
    if (event.type === 'ui.editor') { draftEpochs.current.set(key, (draftEpochs.current.get(key) ?? 0) + 1); draftVersions.current.set(key, (draftVersions.current.get(key) ?? 0) + 1); updateTask(projectId, taskId, task => ({ ...task, draft: event.text })); return; }
    if (event.type === 'text.delta') { changeUI(key, old => old.finalReceived || old.status === 'idle' || (old.requestId && old.requestId !== event.requestId) ? old : ({ ...old, streaming: old.streaming + event.text, status: 'running', requestId: event.requestId })); return; }
    if (event.type === 'native') {
      const native = event.event;
      if (native.type === 'message_start' && native.message?.role === 'assistant') changeUI(key, old => ({ ...old, streaming: '', finalReceived: false }));
      if (native.type === 'tool_execution_start') changeUI(key, old => ({ ...old, toolStatus: `正在执行 ${native.toolName ?? '工具'}`, status: 'running' }));
      if (native.type === 'tool_execution_end') changeUI(key, old => ({ ...old, toolStatus: undefined }));
      if (native.type === 'message_end' && native.message) { const message = native.message; changeUI(key, old => { const snapshot = old.snapshot ?? { sessionId: key, messages: [], tools: [], status: 'running' as const, sdkVersion: '' }, previous = snapshot.messages.at(-1), duplicate = previous && JSON.stringify(previous) === JSON.stringify(message); return { ...old, snapshot: { ...snapshot, messages: duplicate ? snapshot.messages : [...snapshot.messages, message] }, ...(message.role === 'assistant' ? { streaming: '', finalReceived: true } : {}), ...(message.role === 'user' ? { optimistic: undefined } : {}) }; }); }
      return;
    }
    if (event.type === 'run.settled') {
      changeUI(key, old => old.requestId && event.requestId !== old.requestId ? old : ({ ...old, status: 'idle', posting: false, toolStatus: undefined, streaming: '', optimistic: undefined, requestId: undefined, uiRequests: [], deferredRequestId: undefined, error: event.outcome === 'failed' ? [diagnosticText(event.diagnostic), event.error].filter(Boolean).join(' ') || '本次回复未完成，请检查配置后显式重试。' : undefined, failedPrompt: event.outcome === 'failed' ? old.failedPrompt : undefined, notice: event.outcome === 'cancelled' ? '已停止，已保存的部分输出仍保留。' : diagnosticText(event.diagnostic) ?? old.notice }));
      void refreshTask(projectId, taskId).catch(error => changeUI(key, old => ({ ...old, error: safeError(error) })));
    }
  };
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    void Promise.all([readConfigurations(controller.signal), listProjects(controller.signal)]).then(([models, saved]) => {
      if (controller.signal.aborted) return; setConfigurations(models.configurations); setSelectedId(models.selectedId); setProjects(saved); const url = new URL(window.location.href), selected = saved.find(project => project.id === url.searchParams.get('project')) ?? saved.filter(project => !project.archivedAt).at(-1) ?? saved.at(-1); setActiveId(selected?.id); setActiveTaskId(selected?.tasks.find(task => task.id === url.searchParams.get('task'))?.id ?? (url.searchParams.has('project') && !url.searchParams.has('task') ? undefined : selected?.tasks.at(-1)?.id)); setHostStatus('ready');
      for (const project of saved) for (const task of project.tasks) changeUI(taskKey(project.id, task.id), old => ({ ...old, error: lastRunError(task) }));
    }, error => { if (!controller.signal.aborted) { setHostStatus('unavailable'); setGlobalError(safeError(error)); } });
    return () => { mounted.current = false; controller.abort(); for (const stream of streams.current.values()) stream.controller.abort(); streams.current.clear(); };
  }, []);
  const subscriptionKeys = projects.flatMap(project => project.archivedAt ? [] : project.tasks.filter(task => (view === 'chat' && taskKey(project.id, task.id) === activeKey) || task.lastRun?.status === 'running' || ['running', 'stopping'].includes(ui[taskKey(project.id, task.id)]?.status ?? '') || ui[taskKey(project.id, task.id)]?.opening || ui[taskKey(project.id, task.id)]?.uiRequests.length).map(task => taskKey(project.id, task.id))).join(',');
  useEffect(() => { const wanted = new Set(subscriptionKeys.split(',').filter(Boolean)); for (const [key, stream] of streams.current) if (!wanted.has(key)) { stream.controller.abort(); streams.current.delete(key); } for (const key of wanted) { const [projectId, taskId] = key.split('/') as [string, string]; void connect(projectId, taskId).then(() => refreshTask(projectId, taskId)).catch(error => { if (!(error instanceof DOMException && error.name === 'AbortError')) changeUI(key, old => ({ ...old, error: safeError(error) })); }); } }, [subscriptionKeys]);
  useEffect(() => { if (active?.archivedAt && activeTask) { const key = taskKey(active.id, activeTask.id); void refreshTask(active.id, activeTask.id).then(() => changeUI(key, old => ({ ...old, connected: true, observation: undefined }))).catch(error => changeUI(key, old => ({ ...old, error: safeError(error) }))); } }, [active?.archivedAt, active?.id, activeTask?.id]);
  useEffect(() => { const media = window.matchMedia('(max-width: 760px)'); const resize = () => setSidebarOpen(!media.matches); media.addEventListener('change', resize); resize(); return () => media.removeEventListener('change', resize); }, []);
  useEffect(() => { const media = window.matchMedia('(max-width: 1100px)'); const resize = () => setFilesOpen(!media.matches); media.addEventListener('change', resize); return () => media.removeEventListener('change', resize); }, []);
  useEffect(() => { if (view === 'chat') end.current?.scrollIntoView({ block: 'end' }); }, [current?.snapshot?.messages, current?.streaming, view]);
  const persistDraft = (projectId: string, taskId: string, text: string): Promise<void> => {
    const key = taskKey(projectId, taskId), epoch = draftEpochs.current.get(key) ?? 0; draftVersions.current.set(key, (draftVersions.current.get(key) ?? 0) + 1);
    updateTask(projectId, taskId, task => ({ ...task, draft: text })); changeUI(key, old => ({ ...old, draftSaving: true }));
    const previous = draftQueues.current.get(key) ?? Promise.resolve(), next = previous.catch(() => {}).then(() => { if ((draftEpochs.current.get(key) ?? 0) === epoch) return saveDraft(projectId, taskId, text); }); draftQueues.current.set(key, next);
    void next.then(() => { if (draftQueues.current.get(key) === next) { draftQueues.current.delete(key); changeUI(key, old => ({ ...old, draftSaving: false })); } }, () => { if (draftQueues.current.get(key) === next) { draftQueues.current.delete(key); changeUI(key, old => ({ ...old, draftSaving: false, error: '草稿尚未保存，请检查本地服务后继续。' })); } }); return next;
  };
  const openWorkspace = (next: 'chat' | 'decision' | 'cases' | 'projects') => { setHelpOpen(false); lastWorkspace.current = next; if (next === 'cases') setCaseFocus(undefined); setView(next); if (next === 'chat') requestAnimationFrame(() => textarea.current?.focus()); };
  const openCatalog = (next: CatalogCategory) => { setHelpOpen(false); setView(next); if (window.innerWidth <= 760) setSidebarOpen(false); };
  const openCatalogEntry = (entry: CatalogEntry) => { if (entry === 'requirement') { setRequirementReturnTask(undefined); setRequirementFocus(undefined); } if (entry === 'enterprise-materials') setMaterialFocus(undefined); if (entry === 'simlab') setSimlabTarget(undefined); if (entry === 'decision') openWorkspace('decision'); else if (entry === 'ppt-report' || entry === 'target-forecast' || entry === 'coupon-forecast' || entry === 'roi-forecast' || entry === 'trade-area-mcp' || entry === 'weather-mcp') openWorkspace('projects'); else { setHelpOpen(false); if (entry === 'refiner' && view !== 'refiner') { setRefinerSource(undefined); setRefinerDeckId(undefined); } setView(entry); } if (window.innerWidth <= 760) setSidebarOpen(false); };
  const openPersonal = (entry?: PersonalRetentionEntry) => { setPersonalCurrentKey(view === 'chat' && activeTask && !archived ? activeKey : undefined); setPersonalMounted(true); setPersonalEntry(entry); setHelpOpen(false); setView('personal-materials'); if (window.innerWidth <= 760) setSidebarOpen(false); };
  const openPersonalProject = (projectId: string) => { const project = projects.find(value => value.id === projectId); if (!project) { setGlobalError('原项目未能核对，请刷新项目列表；来源引用仍保留。'); return; } if (project.tasks[0]) void chooseTask(project, project.tasks[0], false); else { selectContext(project.id); openWorkspace('chat'); } };
  const openPersonalMaterial = (materialId: string, revisionId?: string) => { setMaterialFocus({ materialId, revisionId }); setHelpOpen(false); setView('enterprise-materials'); };
  const organizeReply = async (item: NativeMessage, kind: 'knowledge' | 'experience') => {
    if (!active || !activeTask || item.role !== 'assistant' || !item.nativeEntryId || !item.nativeSessionId) return;
    const projectId = active.id, taskId = activeTask.id, text = nativeMessageText(item);
    try { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); const expectedTextSha256 = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join(''); if (mounted.current) openPersonal({ ref: { type: 'native-reply', projectId, taskId, sessionId: item.nativeSessionId, messageId: item.nativeEntryId, expectedTextSha256 }, kind }); } catch { if (mounted.current) setGlobalError('原生回复身份尚未核定，请保留原回复，重读后再整理。'); }
  };
  const activeCatalogCategory = view === 'metric' || view === 'enterprise-materials' ? 'assets' : view === 'requirement' || view === 'simlab' ? 'plugins' : view;
  const selectContext = (projectId: string, taskId?: string) => { setActiveId(projectId); setActiveTaskId(taskId); const url = new URL(window.location.href); url.searchParams.set('project', projectId); if (taskId) url.searchParams.set('task', taskId); else url.searchParams.delete('task'); window.history.replaceState(null, '', url); };
  const openTaskRequirements = () => {
    if (!active || !activeTask) return;
    setRequirementReturnTask({ projectId: active.id, taskId: activeTask.id });
    setRequirementFocus(attachedRequirement?.instanceId); setHelpOpen(false); setView('requirement');
  };
  const returnFromRequirements = () => {
    const project = projects.find(value => value.id === requirementReturnTask?.projectId);
    const task = project?.tasks.find(value => value.id === requirementReturnTask?.taskId);
    if (!project || !task) { setRequirementReturnTask(undefined); openCatalog('plugins'); return; }
    selectContext(project.id, task.id); openWorkspace('chat');
  };
  const chooseTask = async (project: ClientProject, task: ClientTask, activate = true, context?: { selection: CaseContextSelection; record: CaseRecord; work: ProjectWorkRecord | null }) => {
    setCaseContexts(previous => { const next = { ...previous }; if (context) next[taskKey(project.id, task.id)] = context; else delete next[taskKey(project.id, task.id)]; return next; });
    const key = taskKey(project.id, task.id); selectContext(project.id, task.id); setGlobalError(''); openWorkspace('chat'); if (window.innerWidth <= 760) setSidebarOpen(false);
    if (project.archivedAt) return;
    try { if (activate) changeUI(key, old => ({ ...old, opening: true })); await connect(project.id, task.id); if (activate) {
      // Browsing a new task must not execute untrusted startup resources before
      // the user can choose its execution permissions. First send initializes it.
      const value = task.sessionFile || task.lastRun ? await openTask(project.id, task.id) : await readTask(project.id, task.id);
      mergeProject(value.project); applySnapshot(key, value.snapshot);
    } } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) changeUI(key, old => ({ ...old, error: safeError(error) })); } finally { if (activate) changeUI(key, old => ({ ...old, opening: false })); }
    requestAnimationFrame(() => textarea.current?.focus());
  };
  const reconnect = async (projectId: string, taskId: string) => { const key = taskKey(projectId, taskId); streams.current.get(key)?.controller.abort(); streams.current.delete(key); changeUI(key, old => ({ ...old, error: undefined })); try { await refreshConfigurations(); if (projects.find(project => project.id === projectId)?.archivedAt) { await refreshTask(projectId, taskId); changeUI(key, old => ({ ...old, connected: true, observation: undefined })); return; } await connect(projectId, taskId); await refreshTask(projectId, taskId); } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) changeUI(key, old => ({ ...old, error: safeError(error) })); } };
  const stop = async () => { if (!active || !activeTask || !activeKey || !busy || current?.status === 'stopping') return; const projectId = active.id, taskId = activeTask.id, key = activeKey; changeUI(key, old => ({ ...old, status: 'stopping' })); try { if (current?.opening && question) await answerInteraction(projectId, taskId, { id: question.id, cancelled: true }); await stopTask(projectId, taskId); await refreshTask(projectId, taskId); } catch (error) { changeUI(key, old => ({ ...old, error: safeError(error), status: 'running' })); } };
  useEffect(() => { const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape' && !helpOpen && view === 'chat' && !modalOpen && !document.querySelector('dialog[open]') && busy && !archived) { event.preventDefault(); void stop(); } }; document.addEventListener('keydown', keyboard); return () => document.removeEventListener('keydown', keyboard); });
  const createProject = async (name: string, configurationId: string) => { const project = await createDiskProject(name, configurationId); setProjects(previous => [...previous, project]); selectContext(project.id); setProjectDialogOpen(false); setFilesOpen(window.innerWidth > 1100); openWorkspace('chat'); if (window.innerWidth <= 760) setSidebarOpen(false); };
  const showTaskDialog = (project: ClientProject, trigger: HTMLElement) => { dialogTrigger.current = trigger; setTaskDialogProject(project); };
  const closeDialog = () => { setTaskDialogProject(undefined); setRenameTarget(undefined); requestAnimationFrame(() => { if (dialogTrigger.current?.isConnected) dialogTrigger.current.focus(); else textarea.current?.focus(); }); };
  const createTask = async (name: string, configurationId: string, capabilities: TaskCapabilities) => { if (!taskDialogProject) return; const project = taskDialogProject, task = await createDiskTask(project.id, name, configurationId || undefined, capabilities), updated = { ...project, tasks: [...project.tasks, task] }; setProjects(previous => previous.map(item => item.id === project.id ? { ...item, tasks: [...item.tasks, task] } : item)); setTaskDialogProject(undefined); dialogTrigger.current = null; void chooseTask(updated, task); };
  const toggleTaskCapability = async (capability: TaskCapability, enabled: boolean) => {
    if (!active || !activeTask || !activeKey || capabilityUpdating || contextLocked) return;
    const projectId = active.id, taskId = activeTask.id, key = activeKey;
    setCapabilityUpdating(true);
    try {
      const task = await setTaskCapability(projectId, taskId, capability, enabled);
      updateTask(projectId, taskId, () => task);
      await refreshTask(projectId, taskId);
      const label = TASK_CAPABILITIES.find(item => item.id === capability)!.label;
      changeUI(key, old => ({ ...old, notice: `已${enabled ? '开启' : '关闭'}${label}，下次打开会话或发送消息时生效，历史保留。` }));
    } finally { setCapabilityUpdating(false); }
  };
  const projectAction = async (project: ClientProject, operation: 'archive' | 'restore') => {
    const prefix = project.id + '/'; setProjectActionId(project.id); setGlobalError('');
    try {
      if (operation === 'archive') { await Promise.all([...draftQueues.current].filter(([key]) => key.startsWith(prefix)).map(([, promise]) => promise)); archivingProjects.current.add(project.id); }
      const value = await (operation === 'archive' ? archiveProject(project.id) : restoreProject(project.id)); mergeProject(value);
      setGlobalNotice(operation === 'archive' ? '项目已归档，任务、文件与历史完整保留。' : '项目已恢复，可继续原有任务。');
      if (operation === 'archive') for (const [key, stream] of streams.current) if (key.startsWith(prefix)) { stream.controller.abort(); streams.current.delete(key); }
    } catch (error) {
      setGlobalError(safeError(error));
      // A failed archive must not hide a genuine connection failure that happened
      // while its response was pending. Existing task failures remain visible.
      for (const [key, message] of deferredStreamErrors.current) if (key.startsWith(prefix)) changeUI(key, old => ({ ...old, error: old.error && old.error !== message ? old.error + '\n' + message : message }));
    } finally {
      archivingProjects.current.delete(project.id);
      for (const key of deferredStreamErrors.current.keys()) if (key.startsWith(prefix)) deferredStreamErrors.current.delete(key);
      setProjectActionId(undefined);
    }
  };
  const send = async (text = activeTask?.draft ?? '', retry = false, personalOverride?: { selection: PersonalContextSelection; title: string }[]) => {
    if (!active || !activeTask || !activeKey || archived || projectActionId === active.id || !text.trim() || busy || capabilityUpdating || current?.uncertainPersonalSend || !current?.connected || current.status === 'connecting' || pending.current.has(activeKey)) return;
    const personal = personalOverride ?? attachedPersonal;
    const projectId = active.id, taskId = activeTask.id, key = activeKey, requestId = crypto.randomUUID(), command = text.trim().startsWith('/');
    const messageArgs: Parameters<typeof sendMessage> = structuredClone([projectId, taskId, text, requestId, selectedCase?.selection, attachedRequirement, attachedEnterprise.length ? attachedEnterprise : undefined, attachedEnterpriseCase, attachedFeedback, attachedProjectData.length ? attachedProjectData : undefined, personal.map(item => item.selection)]);
    pending.current.add(key);
    changeUI(key, old => ({ ...old, posting: true, status: 'running', error: undefined, unavailablePersonal: undefined, notice: undefined, commandResult: undefined, streaming: '', finalReceived: false, requestId, failedPrompt: text, optimistic: command ? undefined : text }));
    try { if (!retry) await persistDraft(projectId, taskId, ''); if (command) { const operation = runCommand(projectId, taskId, text.trim(), requestId); changeUI(key, old => ({ ...old, posting: false })); const result = await operation; applySnapshot(key, result.snapshot); changeUI(key, old => ({ ...old, commandResult: result.result == null ? undefined : typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2), status: 'idle', requestId: undefined })); } else await sendMessage(...messageArgs); }
    catch (error) { let accepted = false, recoveredStatus: 'idle' | 'running' | undefined; try { const restored = await refreshTask(projectId, taskId); accepted = restored.task.lastRun?.id === requestId; recoveredStatus = restored.snapshot.status; } catch {} const unavailable = !accepted && error instanceof HostRequestError && error.unavailablePersonalContext?.every(index => index < personal.length) ? error.unavailablePersonalContext.map(index => personal[index]!.selection) : undefined; const definitelyRejected = error instanceof HostRequestError && error.accepted === false && Boolean(error.status && error.status >= 400 && error.status < 500); const uncertainPersonalSend = !command && personal.length > 0 && !accepted && !definitelyRejected ? { args: messageArgs } : undefined; if (!accepted && personal.length > 0) await persistDraft(projectId, taskId, text).catch(() => {}); changeUI(key, old => ({ ...old, uncertainPersonalSend, unavailablePersonal: unavailable, status: recoveredStatus ?? (error instanceof HostRequestError ? 'idle' : 'connecting'), error: accepted ? old.error : error instanceof HostRequestError ? error.message : '发送状态尚未确认，请重新连接任务核对；不会自动重发。', failedPrompt: accepted || !(error instanceof HostRequestError) ? undefined : text, optimistic: accepted ? undefined : old.optimistic })); }
    finally { pending.current.delete(key); changeUI(key, old => ({ ...old, posting: false })); }
  };
  const inspectPersonalSend = async (projectId: string, taskId: string) => {
    const key = taskKey(projectId, taskId); if (!uiRef.current[key]?.uncertainPersonalSend) return;
    changeUI(key, old => ({ ...old, posting: true }));
    try { await refreshTask(projectId, taskId); if (uiRef.current[key]?.uncertainPersonalSend) changeUI(key, old => ({ ...old, notice: '尚未核对到原请求已接受，状态仍为 UNKNOWN。问题、原请求和选择保持；没有重新发送。' })); }
    catch (error) { changeUI(key, old => ({ ...old, error: safeError(error) })); }
    finally { changeUI(key, old => ({ ...old, posting: false })); }
  };
  const retryPersonalSend = async (projectId: string, taskId: string) => {
    const key = taskKey(projectId, taskId), uncertain = uiRef.current[key]?.uncertainPersonalSend;
    if (!uncertain || pending.current.has(key) || projects.find(project => project.id === projectId)?.archivedAt) return;
    pending.current.add(key); changeUI(key, old => ({ ...old, posting: true }));
    try {
      await sendMessage(...uncertain.args);
      const restored = await refreshTask(projectId, taskId);
      const savedRun = restored.task.lastRun;
      if (savedRun?.id !== uncertain.args[3]) throw new HostRequestError('原请求尚未在此任务中核对，状态仍为 UNKNOWN；保留原标识与选择。');
      changeUI(key, old => ({ ...old, uncertainPersonalSend: undefined, error: lastRunError(restored.task), failedPrompt: savedRun.status === 'failed' ? uncertain.args[2] : undefined, optimistic: undefined, notice: '已按原标识回读任务实际状态与保存消息；没有新建运行或重复加入问题。' }));
    }
    catch (error) { changeUI(key, old => ({ ...old, error: safeError(error) })); }
    finally { pending.current.delete(key); changeUI(key, old => ({ ...old, posting: false })); }
  };
  const respond = async (projectId: string, taskId: string, response: BrowserUIResponse) => { await answerInteraction(projectId, taskId, response); changeUI(taskKey(projectId, taskId), old => ({ ...old, uiRequests: (old.uiRequests ?? []).filter(request => request.id !== response.id), deferredRequestId: old.deferredRequestId === response.id ? undefined : old.deferredRequestId })); };
  const openSettings = (trigger?: HTMLButtonElement) => { setHelpOpen(false); if (trigger) settingsTrigger.current = trigger; if (view !== 'settings') settingsReturnView.current = view; setView('settings'); if (window.innerWidth <= 760) setSidebarOpen(false); };
  const back = () => { setView(settingsReturnView.current); requestAnimationFrame(() => { if (settingsTrigger.current?.isConnected) settingsTrigger.current.focus(); else document.querySelector<HTMLButtonElement>('.model-button')?.focus(); }); };
  const refreshProjects = async () => { const saved = await listProjects(); for (const project of saved) mergeProject(project); };
  const boardTask = async (project: ClientProject, task: ClientTask, selection?: CaseContextSelection) => {
    try {
      if (!selection) { await chooseTask(project, task, false); return; }
      const detail = await caseClient.detail(selection.caseId);
      if (detail.case.revision !== selection.caseRevision) throw new caseClient.CaseRequestError('revision_conflict', 409);
      await chooseTask(project, task, false, { selection, record: detail.case, work: project.work ?? null });
    } catch (error) { setGlobalError(error instanceof Error ? error.message : 'Case背景未能读取，请刷新后核对。'); }
  };
  const openFeedbackTask = async (target: { projectId: string; taskId: string; handoffId: string }) => { const value = await readTask(target.projectId, target.taskId); mergeProject(value.project); await chooseTask(value.project, value.task, false); };
  const generatePptx = async (project: ClientProject, file: { name: string; path: string }) => {
    const task = await createDiskTask(project.id, `PPT 生成 · ${file.name.replace(/\.md$/i, '')}`, undefined);
    setProjects(previous => previous.map(item => item.id === project.id ? { ...item, tasks: [...item.tasks, task] } : item));
    await chooseTask(project, task);
    await persistDraft(project.id, task.id, `请读取 060_reports 正式报告 ${file.path}，使用 ppt-report skill 生成候选版 PPTX（保存到 060_reports 同目录，文件名加 _候选版）。数字必须逐字来自该报告，版式遵循 skill 规范。`);
  };
  const startFeedbackAnalysis = (source: FeedbackReviewStart) => { setFeedbackReview(source); openWorkspace('decision'); };
  const pageTitle = view === 'cases' ? 'Case 看板' : view === 'projects' ? '项目看板' : view === 'chat' ? active ? activeTask ? `${active.name} / ${activeTask.name}` : active.name : '项目工作台' : view === 'settings' ? '设置' : view === 'decision' ? '决策工作台' : view === 'enterprise-materials' ? '企业业务资料' : view === 'personal-materials' ? '个人资料' : view === 'metric' ? '指标体系' : view === 'requirement' ? '需求梳理' : view === 'refiner' ? 'PPT 逐页精修' : view === 'simlab' ? '经营推演' : catalogMeta[view].label;
  const returnView = settingsReturnView.current, settingsBackLabel = returnView === 'cases' ? '返回Case看板' : returnView === 'projects' ? '返回项目看板' : returnView === 'chat' ? '返回项目空间' : returnView === 'decision' ? '返回决策工作台' : returnView === 'enterprise-materials' ? '返回企业业务资料' : returnView === 'personal-materials' ? '返回个人资料' : returnView === 'metric' ? '返回指标体系' : returnView === 'requirement' ? '返回需求梳理' : returnView === 'refiner' ? '返回PPT 逐页精修' : returnView === 'simlab' ? '返回经营推演' : returnView === 'settings' ? '返回项目空间' : `返回${catalogMeta[returnView].label}`;
  const messages = messagesOf(current?.snapshot), lastAssistant = [...messages].reverse().find(message => message.role === 'assistant' && messageText(message));
  const currentStatus = current?.observation?.message && current.observation.state !== 'connected' ? current.observation.message : question ? 'Pi 等待你的回应' : current?.opening ? '正在打开任务' : current?.status === 'running' ? current.toolStatus ?? 'Pi 正在回复' : current?.status === 'stopping' ? '正在停止' : !current?.connected ? '任务连接待恢复' : current.draftSaving ? '正在保存草稿…' : '任务和历史已保存在本机';
  const message = (item: NativeMessage, index: number) => { const semanticRecords = item.role === 'assistant' && active && activeTask ? semanticRecordsForAssistant(messages, index, current?.snapshot?.sessionId, { projectId: active.id, taskId: activeTask.id }) : []; const suggestion = active ? freezeSuggestionFor(messages, index, active.id) : undefined; const text = messageText(item), calls = Array.isArray(item.content) ? item.content.filter(part => part.type === 'toolCall') : []; if (item.role === 'toolResult' || item.role === 'bashExecution') return <div key={`tool-wrapper-${index}`}><details key={`tool-${index}`} className={`tool-message ${item.isError ? 'tool-error' : ''}`}><summary>{item.toolName ?? (item.role === 'bashExecution' ? 'bash' : '工具结果')}{item.isError ? ' · 执行失败' : ' · 执行结果'}</summary>{item.command && <code>{item.command}</code>}<pre>{text || '无文本输出。'}</pre></details>{suggestion && <section className="task-link-card" aria-label="固化建议"><div><strong>Agent 固化建议 · {suggestion.runId}</strong><p>{suggestion.reason}</p><small>方案 {suggestion.variantId} · 草稿 rev {suggestion.draftRevision} · 仅为建议，固化状态以页面回执为准</small></div><button className="secondary-button" onClick={() => { setSimlabTarget(suggestion); setHelpOpen(false); setView('simlab'); }}>查看建议并固化</button></section>}</div>; return <article key={`${item.role}-${item.timestamp ?? index}-${index}`} className={`message ${item.role}`}><div className="message-author">{item.role === 'assistant' || item.role === 'custom' ? <><BrandMark small /><strong>{item.role === 'custom' ? 'Pi 扩展' : 'OptraCall'}</strong><span>{item.role === 'custom' ? '扩展消息' : activeTask?.configuration.model}</span></> : <><span className="user-mark">你</span><strong>你</strong></>}</div>{text && <div className="message-content">{text}</div>}{item.role === 'assistant' && text && active && activeTask && <SemanticContextPanel projectId={active.id} taskId={activeTask.id} records={semanticRecords} onFollowup={!archived && !current?.uncertainPersonalSend && !current?.posting && projectActionId !== active.id ? draft => { const next = [activeTask.draft.trim(), draft].filter(Boolean).join('\n\n'); if (next.length > 20000) { setGlobalError('追问未加入：当前草稿加上补充内容超过输入长度，原草稿保持。'); return; } void persistDraft(active.id, activeTask.id, next); requestAnimationFrame(() => requestAnimationFrame(() => textarea.current?.focus())); } : undefined} />}{item.role === 'user' && typeof item.originalUserText === 'string' && <details className="eb-native-context"><summary>随问题发送的完整上下文</summary><pre>{nativeMessageText(item)}</pre></details>}{item.role === 'assistant' && text && <div className="report-action-row"><button type="button" className="text-button" disabled={!item.nativeEntryId || !item.nativeSessionId} title={!item.nativeEntryId ? '等待原生回复保存并核对准确身份' : undefined} onClick={() => { void organizeReply(item, 'knowledge'); }}>整理为知识</button><button type="button" className="text-button" disabled={!item.nativeEntryId || !item.nativeSessionId} onClick={() => { void organizeReply(item, 'experience'); }}>整理为经验</button></div>}{calls.map((call, callIndex) => <div className="tool-call" key={call.id ?? callIndex}>调用工具 · <code>{call.name}</code></div>)}{item.stopReason === 'aborted' && <p className="message-meta">已停止 · 部分输出已保留</p>}{item.stopReason === 'error' && <p className="message-meta failed-meta">此条回复未完成</p>}{item.role === 'assistant' && activeTask?.feedbackOrigin && text && <div className="report-action-row"><button type="button" className="text-button" disabled={archived || busy || !item.nativeEntryId || !item.nativeSessionId} title={!item.nativeEntryId ? '等待保存后重读真实回复身份，或明确保存为报告后选择' : undefined} onClick={() => setFeedbackNextSource({ kind: 'reply', message: item })}>基于这条回复梳理新需求</button></div>}</article>; };
  return <div className="app" data-theme={theme} data-build="decision-case-phase1-20261029">
    {personalChoice && <PersonalContextTargetPicker projects={projects} lockedTaskKeys={Object.keys(ui).filter(key => Boolean(ui[key]?.uncertainPersonalSend))} title={personalChoice.title} onClose={() => setPersonalChoice(undefined)} onSelect={(project, task) => {
      if (project.archivedAt) return;
      const key = taskKey(project.id, task.id), choice = personalChoice;
      if (uiRef.current[key]?.uncertainPersonalSend) { setGlobalError('该任务有发送状态 UNKNOWN，先核对原请求；选择与原问题保持。'); return; }
      setPersonalContexts(previous => ({ ...previous, [key]: [...(previous[key] ?? []).filter(item => JSON.stringify(item.selection) !== JSON.stringify(choice.selection)), choice] }));
      setPersonalChoice(undefined); void chooseTask(project, task, false); requestAnimationFrame(() => textarea.current?.focus());
    }} />}
    <a className="skip-link" href="#main-content">跳到主内容</a>
    {sidebarOpen && <aside id="sidebar" className="sidebar" aria-label="工作台导航"><div className="brand"><BrandMark small /><div><strong>OptraCall</strong><span>持续做出更好的决策</span></div></div><button className="new-chat" aria-label="新建项目" onClick={() => setProjectDialogOpen(true)}><Icon name="plus" />新建项目</button><button className={`nav-item ${view === 'cases' ? 'selected' : ''}`} aria-current={view === 'cases' ? 'page' : undefined} onClick={() => openWorkspace('cases')}><Icon name="panel" />Case 看板</button><button className={`nav-item ${view === 'projects' ? 'selected' : ''}`} aria-current={view === 'projects' ? 'page' : undefined} onClick={() => openWorkspace('projects')}><Icon name="folder" />项目看板</button><button className={`nav-item ${view === 'personal-materials' ? 'selected' : ''}`} aria-current={view === 'personal-materials' ? 'page' : undefined} onClick={() => openPersonal()}><Icon name="assets" />个人资料</button><nav className="capability-nav" aria-label="能力目录">{catalogCategories.map(category => <button key={category} className={`nav-item ${activeCatalogCategory === category ? 'selected' : ''}`} aria-current={activeCatalogCategory === category ? 'page' : undefined} onClick={() => openCatalog(category)}><Icon name={catalogIcons[category]} />{catalogMeta[category].label}</button>)}</nav>
      <ProjectNavigation projects={projects} activeProjectId={activeId} activeTaskId={activeTaskId} states={ui} loading={hostStatus === 'loading'} onProject={project => { setCaseContexts({}); selectContext(project.id); openWorkspace('chat'); if (window.innerWidth <= 760) setSidebarOpen(false); }} onTask={(project, task) => { void chooseTask(project, task); }} onCreateTask={showTaskDialog} onRename={(project, trigger) => { dialogTrigger.current = trigger; setRenameTarget(project); }} onArchive={project => { void projectAction(project, 'archive'); }} onRestore={project => { void projectAction(project, 'restore'); }} />
      <div className="sidebar-bottom"><button className={`nav-item ${view === 'settings' ? 'selected' : ''}`} aria-label="模型设置" aria-current={view === 'settings' ? 'page' : undefined} onClick={event => openSettings(event.currentTarget)}><Icon name="settings" />模型设置{config?.hasApiKey && <span className="configured-dot" aria-label="已保存本机配置" />}</button><div className="local-profile"><span className="avatar">O</span><div><strong>本地工作台</strong><span>项目与 Pi Agent</span></div></div></div>
    </aside>}
    <main id="main-content" className="main" tabIndex={-1}><header className="topbar"><div className="topbar-context"><button className="icon-button" aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'} aria-expanded={sidebarOpen} aria-controls={sidebarOpen ? 'sidebar' : undefined} onClick={() => setSidebarOpen(value => !value)}><Icon name="panel" /></button><span className="topbar-title">{helpOpen ? '帮助' : pageTitle}</span></div><div className="workspace-switch" role="group" aria-label="工作区切换"><button aria-pressed={!helpOpen && view === 'chat'} onClick={() => openWorkspace('chat')}>分析</button><button aria-pressed={!helpOpen && view === 'decision'} onClick={() => openWorkspace('decision')}>决策</button></div><div className="topbar-actions">{active && !helpOpen && <button className="icon-button files-toggle" aria-label={filesOpen ? '收起项目文件' : '展开项目文件'} aria-expanded={filesOpen} aria-controls={filesOpen ? 'project-files' : undefined} onClick={() => setFilesOpen(value => !value)}><Icon name="panel" /></button>}<button ref={helpTrigger} className="help-trigger" type="button" aria-label="帮助" aria-expanded={helpOpen} aria-controls="product-help" onClick={() => helpOpen ? closeHelp() : setHelpOpen(true)}><Icon name="help" size={17} />帮助</button><button className="icon-button" aria-label={theme === 'light' ? '切换为深色' : '切换为浅色'} onClick={() => setTheme(old => old === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button></div></header>
      {globalError && <div className="global-notice" role="alert"><span>{globalError}</span><button className="text-button" onClick={async () => { try { await refreshConfigurations(); const saved = await listProjects(); for (const project of saved) mergeProject(project); setGlobalError(''); } catch {} }}>重新连接</button><button className="text-button" onClick={() => setGlobalError('')}>关闭提示</button></div>}{globalNotice && <p className="project-notice" role="status">{globalNotice}</p>}
      <HelpPage open={helpOpen} onBack={closeHelp} />
      <div hidden={helpOpen} className={`workbench-content ${view === 'chat' && filesOpen && active ? 'files-visible' : ''}`}><div className="workbench-view">
      {personalMounted && <div hidden={view !== 'personal-materials'}><PersonalMaterialsPage active={view === 'personal-materials' && !helpOpen} initialSource={personalEntry} onSourceConsumed={() => setPersonalEntry(undefined)} onOpenProject={openPersonalProject} onOpenMaterial={openPersonalMaterial} currentTaskLabel={personalCurrentKey === activeKey && active && activeTask && !archived && !current?.uncertainPersonalSend ? personalTargetLabel(active, activeTask) : undefined} onOther={(selection, title) => setPersonalChoice({selection, title})} onUse={personalCurrentKey === activeKey && activeKey && !archived && !current?.uncertainPersonalSend ? (selection, title) => {
        const key = activeKey; setPersonalContexts(previous => ({ ...previous, [key]: [...(previous[key] ?? []).filter(item => JSON.stringify(item.selection) !== JSON.stringify(selection)), { selection, title }] }));
        setHelpOpen(false); setView('chat'); requestAnimationFrame(() => textarea.current?.focus());
      } : undefined} /></div>}
      {view === 'cases' ? <CaseBoard decisionUi={caseDecisionUi} onDecisionUiChange={(ownerKey, update) => setCaseDecisionUi(previous => ({ ...previous, [ownerKey]: update(previous[ownerKey] ?? emptyCaseDecisionUiState) }))} currentWork={activeId && activeTaskId ? { projectId: activeId, taskId: activeTaskId } : undefined} onOpenDecisionBoard={() => { setFeedbackReview(undefined); openWorkspace('decision'); }} initialCaseId={caseFocus} mode={caseMode} onModeChange={setCaseMode} projects={projects} configurations={configurations} onOpenTask={(project, task, context) => { void boardTask(project, task, context); }} onCreateTask={project => showTaskDialog(project, document.activeElement as HTMLElement)} onProjectChange={refreshProjects} /> : view === 'projects' ? <ProjectBoard mode={projectMode} onModeChange={setProjectMode} projects={projects} onOpenTask={(project, task) => { void boardTask(project, task); }} onCreateProject={() => setProjectDialogOpen(true)} onCreateTask={project => showTaskDialog(project, document.activeElement as HTMLElement)} onRename={(project, trigger) => { dialogTrigger.current = trigger; setRenameTarget(project); }} onArchive={project => { void projectAction(project, 'archive'); }} onRestore={project => { void projectAction(project, 'restore'); }} onProjectChange={refreshProjects} /> : view === 'settings' ? <ModelSettings configurations={configurations} selectedId={selectedId} hostStatus={hostStatus} onChange={refreshConfigurations} onBack={back} backLabel={settingsBackLabel} /> : view === 'decision' ? <DecisionBoardPage initialReview={feedbackReview} onOpenFeedbackTask={openFeedbackTask} onOrganize={openPersonal} /> : view === 'personal-materials' ? null : view === 'enterprise-materials' ? <EnterpriseMaterialsPage initialMaterialId={materialFocus?.materialId} initialRevisionId={materialFocus?.revisionId} onOrganize={openPersonal} onBack={() => openCatalog('assets')} onMetrics={() => openCatalogEntry('metric')} onRequirements={() => openCatalogEntry('requirement')} /> : view === 'metric' ? <MetricFactoryPage projects={projects} onOpenTask={(project, task) => { void chooseTask(project, task); }} onProjectsChanged={() => { void listProjects().then(value => { if (mounted.current) setProjects(value); }).catch(() => {}); }} onBack={() => openCatalog('assets')} /> : view === 'requirement' ? <RequirementPage backLabel={requirementReturnTask ? '返回分析任务' : undefined} initialInstanceId={requirementFocus} projects={projects} onOpenTask={(project, task) => { void chooseTask(project, task); }} onProjectsChanged={() => { void listProjects().then(value => { if (mounted.current) setProjects(value); }).catch(() => {}); }} onBack={() => requirementReturnTask ? returnFromRequirements() : openCatalog('plugins')} onSendToTask={(project, task, requirement) => { setRequirementContexts(previous => ({ ...previous, [taskKey(project.id, task.id)]: requirement })); void chooseTask(project, task); }} /> : view === 'refiner' ? <RefinerPage key={refinerSource ? JSON.stringify(refinerSource) : 'refiner-records'} source={refinerSource} initialDeckId={refinerDeckId} onDeckChange={setRefinerDeckId} onNavigationGuard={registerRefinerLeave} onBack={() => { if (refinerSource) { setRefinerSource(undefined); setRefinerDeckId(undefined); openWorkspace('chat'); } else openCatalog('plugins'); }} /> : view === 'simlab' ? <SimLabPage initialSelection={simlabTarget} projects={projects} onOpenTask={(project, task) => { void chooseTask(project, task); }} onBack={() => openCatalog('plugins')} /> : view !== 'chat' ? <CatalogPage key={view} category={view} onCategoryChange={openCatalog} onOpenEntry={openCatalogEntry} onBack={() => openWorkspace(lastWorkspace.current)} /> : !active ? <div className="project-start"><BrandMark /><p className="eyebrow">你好，欢迎来到 OptraCall</p><h1>从一个项目开始</h1><p>让问题、分析与决策，拥有同一个工作空间。</p><button className="primary-button" onClick={() => setProjectDialogOpen(true)}><Icon name="plus" />创建第一个项目</button><span>项目、文件与任务历史保存在本机</span></div> : !activeTask ? <div className="project-start"><BrandMark /><p className="eyebrow">{archived ? '已归档项目' : '项目空间'}</p><h1>{active.name}</h1><p>{archived ? '任务、文件与历史完整保留，恢复项目后可继续工作。' : '文件在项目中共享，对话在任务中独立进行。'}</p>{archived ? <button className="primary-button" disabled={Boolean(projectActionId)} onClick={() => { void projectAction(active, 'restore'); }}>恢复此项目</button> : <button className="primary-button" onClick={event => showTaskDialog(active, event.currentTarget)}>{active.tasks.length ? '新建任务' : '新建第一个任务'}</button>}<span>{active.tasks.length} 个任务 · 三个共享项目文件夹</span></div> : <div className={`chat-page ${messages.length || current?.streaming || current?.optimistic ? 'has-messages' : ''}`}>
        {archived && <div className="archive-banner" role="status"><span>项目已归档，当前为只读查看。</span><button className="secondary-button" disabled={Boolean(projectActionId)} onClick={() => { void projectAction(active, 'restore'); }}>恢复此项目</button></div>}
        <TaskWorkflow projectName={active.name} taskName={activeTask.name} status={archived ? '已归档 · 只读' : currentStatus} busy={busy} hasMessages={Boolean(messages.length)} hasReply={Boolean(lastAssistant)} requirementTitle={attachedRequirement?.title} onFiles={() => setFilesOpen(true)} onRequirements={openTaskRequirements} onAnalyze={() => { textarea.current?.focus(); }} onResults={() => { resultsPanel.current?.scrollIntoView({ block: 'nearest' }); resultsPanel.current?.focus({ preventScroll: true }); }} />
        {!messages.length && !current?.streaming && !current?.optimistic ? <p className="task-start-hint">{archived ? '此任务尚无对话，恢复项目后可继续。' : '从一个问题开始，告诉 Pi 你想了解什么。'}</p> : <div className="message-scroll"><div className="messages" role="log" aria-label="对话记录" aria-live="off">{messages.map(message)}{current?.optimistic && <article className="message user"><div className="message-author"><span className="user-mark">你</span><strong>你</strong><span>正在确认发送</span></div><div className="message-content">{current.optimistic}</div></article>}{current?.streaming && <article className="message assistant streaming-message"><div className="message-author"><BrandMark small /><strong>OptraCall</strong><span>正在回复</span></div><div className="message-content">{current.streaming}</div></article>}{busy && !current?.streaming && <p className="run-progress" role="status">{current?.toolStatus ?? (current?.opening ? '正在打开任务…' : 'Pi 正在处理…')}</p>}<div ref={end} /></div></div>}
        <div className="composer-area">
          <details key={`context-${activeKey}`} className="task-context-options"><summary>本次分析背景<span>{[selectedCase && 'Case', attachedRequirement && '需求', attachedEnterprise.length > 0 && '企业资料', attachedFeedback && '反馈'].filter(Boolean).join(' · ') || '按需选择'}</span></summary>
          {selectedCase && <div className="case-context-banner" role="status"><div><strong>本次背景：{selectedCase.record.title}</strong><span>Case v{selectedCase.selection.caseRevision} · 项目进度 v{selectedCase.selection.projectWorkRevision}</span><details><summary>查看本次背景</summary><p>{selectedCase.record.description || '尚未填写背景'}</p><p>判断与未知：{selectedCase.record.judgement || '尚未填写'}</p><p>下一步：{selectedCase.record.nextStep || '尚未填写'}</p><p>项目范围：{selectedCase.work?.workScope || '尚未填写'}；承接人：{selectedCase.work?.assignee || '尚未填写'}；项目下一步：{selectedCase.work?.nextStep || '尚未填写'}</p><p>已选引用：{selectedCase.selection.selectedReferenceIds.length} 项。此任务原有历史可能含其他 Case 信息；如需独立上下文，请在原项目新建任务。</p></details></div><button type="button" className="text-button" disabled={contextLocked} onClick={() => setCaseContexts(previous => { const next = { ...previous }; delete next[activeKey!]; return next; })}>改为项目独立发送</button></div>}
          {attachedRequirement && <div className="case-context-banner" role="status"><div><strong>附带需求契约：{attachedRequirement.title}</strong><span>实例 {attachedRequirement.instanceId}{attachedRequirement.version ? ` · RAP ${attachedRequirement.version}` : ' · 已确认快照'} · 发送时注入结构化摘要</span></div><button type="button" className="text-button" disabled={contextLocked} onClick={() => setRequirementContexts(previous => { const next = { ...previous }; delete next[activeKey!]; return next; })}>移除附带</button></div>}
          <FeedbackContextPanel key={`feedback-${activeKey}`} project={active} task={activeTask} value={attachedFeedback} onChange={value => setFeedbackContexts(previous => ({ ...previous, [activeKey!]: value }))} disabled={contextLocked} filesRevision={filesRevision} onNextSource={setFeedbackNextSource} onNextAnalysis={startFeedbackAnalysis} onGoCase={caseId => { setCaseFocus(caseId); setView('cases'); lastWorkspace.current = 'cases'; }} onFilesChanged={() => setFilesRevision(previous => previous + 1)} />
          {activeTask.feedbackOrigin && <FeedbackReceiptHistory key={`feedback-history-${activeKey}`} projectId={active.id} taskId={activeTask.id} revision={current?.snapshot?.lastRun?.requestId ?? activeTask.lastRun?.id} />}
          {!archived && <EnterpriseMaterialPicker key={`enterprise-${activeKey}`} value={attachedEnterprise} onChange={value => setEnterpriseMaterials(previous => ({ ...previous, [activeKey!]: value }))} caseId={selectedCase?.record.id} caseValue={attachedEnterpriseCase} onCaseChange={value => setEnterpriseCases(previous => ({ ...previous, [activeKey!]: value }))} disabled={contextLocked} />}
          <PersonalContextSelectionNotice choices={attachedPersonal} disabled={busy || archived || Boolean(current?.uncertainPersonalSend)} onRemove={index => setPersonalContexts(previous => ({ ...previous, [activeKey!]: (previous[activeKey!] ?? []).filter((_value,at)=>at!==index) }))} onChange={(index,selection)=>setPersonalContexts(previous=>({...previous,[activeKey!]:(previous[activeKey!]??[]).map((item,at)=>at===index?{...item,selection}:item)}))} />
          <ProjectDataSelectionNotice value={attachedProjectData} disabled={contextLocked || archived} onOpen={() => setFilesOpen(true)} onRemove={selectionKey => { const key = activeKey!; setProjectDataSelections(previous => ({ ...previous, [key]: (previous[key] ?? []).filter(item => projectDataSelectionKey(item) !== selectionKey) })); }} />
          <EnterpriseContextReceipt requestId={current?.snapshot?.lastRun?.requestId ?? activeTask.lastRun?.id} recordedRun={Boolean(current?.snapshot?.lastRun || activeTask.lastRun)} value={(current?.snapshot?.capabilities?.semanticContext as { enterprise?: unknown } | undefined)?.enterprise} />
          <EnterpriseContextHistory key={`enterprise-history-${activeKey}`} projectId={active.id} taskId={activeTask.id} />
          <PersonalContextHistory key={`personal-history-${activeKey}`} projectId={active.id} taskId={activeTask.id} requestId={current?.snapshot?.lastRun?.requestId ?? activeTask.lastRun?.id}  completionKey={`${current?.snapshot?.lastRun?.outcome ?? activeTask.lastRun?.status ?? ''}:${current?.status ?? ''}:${current?.snapshot?.status ?? ''}`} />
          <ProjectDataContextHistory key={`project-data-history-${activeKey}`} projectId={active.id} taskId={activeTask.id} requestId={current?.snapshot?.lastRun?.requestId ?? activeTask.lastRun?.id} currentValue={(current?.snapshot?.capabilities?.semanticContext as { projectData?: unknown } | undefined)?.projectData} />
          </details>
          {!archived && question && current?.deferredRequestId === question.id && <div className="pi-pending-notice" role="status"><span>Pi 等待回应：{question.title}</span><button className="secondary-button" onClick={() => changeUI(activeKey!, old => ({ ...old, deferredRequestId: undefined }))}>回应 Pi</button></div>}
          {current?.observation?.message && current.observation.state !== 'connected' && <div className="pi-pending-notice" role="status"><span>{current.observation.message}</span>{current.observation.state === 'disconnected' && <button className="secondary-button" onClick={() => { void reconnect(active.id, activeTask.id); }}>恢复任务观察</button>}</div>}
          {current?.uncertainPersonalSend && <section className="pr-note pr-warning" role="alert"><strong>此次发送状态 UNKNOWN</strong><p>原问题、准确选择与请求标识已保留。先读取原任务状态，核对期间不发新请求、不更改选材。</p><code>{current.uncertainPersonalSend.args[3]}</code><div className="pr-row"><button type="button" className="secondary-button" disabled={current.posting} onClick={() => { void inspectPersonalSend(active.id, activeTask.id); }}>核对此次发送</button>{!archived && <button type="button" className="text-button" disabled={current.posting} onClick={() => { void retryPersonalSend(active.id, activeTask.id); }}>按原请求重试此次发送</button>}</div></section>}
          {current?.unavailablePersonal && current.unavailablePersonal.length > 0 && !archived && <section className="pr-note pr-warning" role="alert"><strong>请求尚未接受，以下指定资料不可用</strong><ul>{current.unavailablePersonal.map(selection => <li key={JSON.stringify(selection)}>{attachedPersonal.find(item => JSON.stringify(item.selection) === JSON.stringify(selection))?.title ?? '原指定资料'}<details><summary>准确目标</summary><pre>{JSON.stringify(selection, null, 2)}</pre></details></li>)}</ul><p>问题与选择已保留。你可核对原资料，或明确移除这些资料后发送。</p><button type="button" className="secondary-button" disabled={busy} onClick={() => { const unavailable = new Set(current.unavailablePersonal!.map(item => JSON.stringify(item))), remaining = attachedPersonal.filter(item => !unavailable.has(JSON.stringify(item.selection))); setPersonalContexts(previous => ({ ...previous, [activeKey!]: remaining })); void send(activeTask.draft, false, remaining); }}>移除不可用资料并发送</button></section>}
          {current?.error && <div className="error-notice" role="alert"><Icon name="warning" /><div><strong>任务状态提示</strong><p>{current.error}</p></div>{!archived && current.failedPrompt && !current.uncertainPersonalSend && !current.unavailablePersonal?.length && !busy && <button className="secondary-button" onClick={() => { void send(current.failedPrompt, true); }}>重试本次消息</button>}<button className="text-button" disabled={current?.posting} onClick={() => { void reconnect(active.id, activeTask.id); }}>重新连接任务</button>{!archived && <button className="text-button" onClick={event => openSettings(event.currentTarget)}>模型设置</button>}</div>}
          {current?.notice && <p className="message-meta" role="status">{current.notice}</p>}{current?.extensionStatus && Object.keys(current.extensionStatus).length > 0 && <div className="pi-extension-status" role="status">{Object.entries(current.extensionStatus).map(([key, text]) => <p key={key}>{text}</p>)}</div>}{current?.commandResult && <details className="command-result" open><summary>Pi 命令结果</summary><pre>{current.commandResult}</pre></details>}
          {!archived && <div className="task-analysis-options"><div><strong>自动核算与修订<span>可选</span></strong><p>希望本轮报告自动核算，请在首次分析前配置；已有报告可手动核算。</p></div><button type="button" className="secondary-button" disabled={contextLocked || capabilityUpdating || !current?.connected} onClick={event => automaticSettings.current?.openSettings(event.currentTarget)}>配置自动核算</button></div>}
          {!archived && <><form className="composer" onSubmit={event => { event.preventDefault(); void send(); }} aria-label="发送消息"><label className="sr-only" htmlFor="message-input">消息</label><textarea ref={textarea} id="message-input" value={activeTask.draft} rows={3} readOnly={Boolean(current?.uncertainPersonalSend)} placeholder="今天想讨论什么？" maxLength={20000} disabled={current?.posting || projectActionId === active.id} onChange={event => { void persistDraft(active.id, activeTask.id, event.target.value).catch(() => {}); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!busy) void send(); } }} aria-describedby="composer-help" /><div className="composer-toolbar"><button type="button" className="model-button" onClick={event => openSettings(event.currentTarget)}><span className="model-dot" />{activeTask.configuration.model}<span className="down-chevron">⌄</span></button><div className="composer-actions"><button className="text-button" type="button" aria-label="打开项目文件上传" onClick={() => setFilesOpen(true)}>＋ 文件</button>{busy ? <button className="stop-button" type="button" aria-label="停止生成" disabled={current?.status === 'stopping'} onClick={() => { void stop(); }}><Icon name="stop" size={15} />{current?.status === 'stopping' ? '正在停止' : '停止'}</button> : <button className="send-button" type="submit" aria-label="发送消息" disabled={Boolean(current?.uncertainPersonalSend) || capabilityUpdating || !activeTask.draft.trim() || !current?.connected || current?.status === 'connecting' || pending.current.has(activeKey!)} title="发送消息"><Icon name="arrow" size={20} /></button>}</div></div></form><div className="composer-helper"><span id="composer-help">Enter 发送 · Shift + Enter 换行{busy ? ' · Esc 停止' : ''}</span><span role="status" aria-live="polite">{currentStatus}</span></div><div className="report-action-row">{lastAssistant && !busy && <button className="secondary-button" type="button" onClick={async () => { const projectId = active.id, key = activeKey!; try { await saveReport(projectId, messageText(lastAssistant)); setFilesRevision(previous => previous + 1); changeUI(key, old => ({ ...old, notice: '这条回复已明确保存为 060_reports 中的最终报告。' })); } catch (error) { changeUI(key, old => ({ ...old, error: safeError(error) })); } }}>将最新回复保存为最终报告</button>}</div><details className="harness-panel"><summary>Pi 能力与命令</summary><p>可用工具：{current?.snapshot?.tools.join(' · ') || '执行任务或打开会话后显示'}</p><TaskCapabilityList key={activeKey} settings={activeTask} disabled={contextLocked || capabilityUpdating || !current?.connected} context="session" onChange={(capability, enabled) => { const key = activeKey!; void toggleTaskCapability(capability, enabled).catch(error => changeUI(key, old => ({ ...old, error: safeError(error) }))); }} /><p>Python 通过 bash 执行。默认从 020_clean 读取分析资料并保存过程文件；最终报告由 Pi 写入 060_reports，也可明确保存。目录用途约定不提供敏感数据隔离。</p><div>{['/tools', '/skills', '/session', '/tree', '/compact', '/reload'].map(command => <button className="text-button" type="button" key={command} disabled={contextLocked || !current?.connected} onClick={() => { void persistDraft(active.id, activeTask.id, command).catch(() => {}); textarea.current?.focus(); }}>{command}</button>)}</div></details></>}
          <section ref={resultsPanel} tabIndex={-1} className="task-results" aria-label="结果与核算"><h2>结果与核算</h2>
          <VerificationPanel automaticSettingsRef={automaticSettings} key={activeKey} project={active} task={activeTask} configurations={configurations} taskBusy={busy} filesRevision={filesRevision} requirementContext={attachedRequirement} caseContext={selectedCase ? { id: selectedCase.record.id, title: selectedCase.record.title, description: selectedCase.record.description, revision: selectedCase.record.revision } : undefined} semanticContext={current?.snapshot?.capabilities?.semanticContext} onFilesChanged={() => setFilesRevision(value => value + 1)} />
          <button type="button" className="text-button task-case-trigger" disabled={archived || busy} onClick={() => { setComparisonContexts(previous => ({ ...previous, [activeKey!]: { project: structuredClone(active), task: structuredClone(activeTask), personal: structuredClone(attachedPersonal) } })); setComparisonKey(activeKey); }}>准备增量验证</button>
          {!archived && <button type="button" className="text-button task-case-trigger" onClick={event => { event.currentTarget.focus({ preventScroll: true }); setTaskCaseOpen(true); }}>从当前任务建立 Case</button>}
          </section>
        </div><footer className="workspace-footer">本机持久项目 · 任务独立对话 · 020_clean 分析与过程 · 060_reports 最终报告 · 请勿上传敏感数据</footer>
      </div>}
      </div>{view === 'chat' && filesOpen && active && <ProjectFiles key={activeKey ?? active.id} project={active} taskId={activeTask?.id} refreshToken={filesRevision} dataSelections={attachedProjectData} taskBusy={contextLocked} onOpenConcepts={() => { setMaterialFocus(undefined); setView('enterprise-materials'); }} onOrganize={openPersonal} onDataSelect={selection => { if (activeTask) { const projectId = active.id, taskId = activeTask.id; setProjectDataSelections(previous => addTaskProjectDataSelection(previous, projectId, taskId, selection)); } }} onGeneratePptx={file => { void generatePptx(active, file).catch(error => changeUI(activeKey!, old => ({ ...old, error: safeError(error) }))); }} onRefinePptx={(file, reportPath) => { setRefinerDeckId(undefined); setRefinerSource({ projectId: active.id, sourcePptx: file.path, reportPath, title: file.name.replace(/\.pptx$/i, '') }); setView('refiner'); }} onClose={() => { setFilesOpen(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.files-toggle')?.focus()); }} />}</div>
    </main>
    {Object.entries(comparisonContexts).map(([key, context]) => <ExperienceComparisonDialog key={key} open={comparisonKey === key} context={{ ...context, project: projects.find(value => value.id === context.project.id) ?? context.project }} onClose={() => setComparisonKey(undefined)} onCreated={task => setProjects(previous => previous.map(project => project.id === context.project.id ? { ...project, tasks: project.tasks.some(value => value.id === task.id) ? project.tasks.map(value => value.id === task.id ? task : value) : [...project.tasks, task] } : project))} onOpenTask={task => { const project = projects.find(value => value.id === context.project.id); if (project) { setComparisonKey(undefined); void chooseTask(project, task, false); } }} />)}
    {projectDialogOpen && <NewProjectDialog configurations={configurations} selectedId={selectedId} onCreate={createProject} onSettings={() => { setProjectDialogOpen(false); openSettings(); }} onClose={() => setProjectDialogOpen(false)} />}
    {taskCaseOpen && active && activeTask && <TaskCaseDialog project={active} task={activeTask} onClose={() => setTaskCaseOpen(false)} onGoToBoard={() => openWorkspace('cases')} onDone={caseId => { setCaseFocus(caseId); setView('cases'); lastWorkspace.current = 'cases'; void refreshProjects().catch(error => setGlobalError(safeError(error))); }} />}
    {taskDialogProject && <TaskDialog project={taskDialogProject} configurations={configurations} onCreate={createTask} onClose={closeDialog} />}
    {feedbackNextSource && active && activeTask && <FeedbackRequirementDialog key={`${activeKey}/${feedbackNextSource.kind === 'reply' ? feedbackNextSource.message.nativeEntryId : feedbackNextSource.relativePath}`} project={active} task={activeTask} source={feedbackNextSource} onClose={() => setFeedbackNextSource(undefined)} onOpenRequirement={instanceId => { setFeedbackNextSource(undefined); setRequirementReturnTask({ projectId: active.id, taskId: activeTask.id }); setRequirementFocus(instanceId); setView('requirement'); }} />}
    {renameTarget && <RenameProjectDialog project={renameTarget} onRename={async name => { const project = await renameProject(renameTarget.id, name); mergeProject(project); closeDialog(); }} onClose={closeDialog} />}
    {active && activeTask && !archived && question && view === 'chat' && !helpOpen && current?.deferredRequestId !== question.id && !modalOpen && <BrowserInteraction key={`${activeKey}:${question.id}`} request={question} onAnswer={response => respond(active.id, activeTask.id, response)} onLater={() => changeUI(activeKey!, old => ({ ...old, deferredRequestId: question.id }))} onStop={stop} onRestoreFocus={() => textarea.current?.focus()} />}
  </div>;
}
