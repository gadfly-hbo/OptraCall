import { DecisionCaseTabs } from './DecisionCaseTabs.tsx';
import { ConversationDrawer } from "./ConversationDrawer.tsx";
import { ResponsiveWorkspacePanel, useViewport } from './ResponsiveWorkspacePanel.tsx';
import { TaskReportEvidence } from './TaskReportEvidence.tsx';
import type { ConclusionReviewReportCandidate } from '../conclusion-review-materials.ts';
import { BrandMark } from "./BrandMark.tsx";
import { AgentAuthor, AssistantOutcome, Foldable, ProcessGroup, groupConversation, isPartialAssistantReply, type ConversationItem } from "./conversation-collapse.tsx";
import { managementTitle,type ManagementRoute,type ManagementStage } from "./ManagementTabs.tsx";
import "./management-workspace.css";
import { studioLibraryTitle, studioLibraryProfessionalArea, type StudioLibraryArea, type StudioLibraryRequest } from "./StudioLibraryTabs.tsx";
import { TaskUsageContext } from './TaskUsageContext.tsx';
import type { UsageContext } from '../usage-context-types.ts';
import { UsageContextSettingsPage } from './UsageContextSettingsPage.tsx';
import { AutomaticActionSettingsPage, AutomaticActionLocalSwitch } from './AutomaticActionSettingsPage.tsx';
import { ProjectPlanPage } from './ProjectPlanPage.tsx';
import { resolveProjectLocation } from './project-location.ts';
import { SkillCapabilitySettings, ConnectorCapabilitySettings, CapabilityPlansSettings, TaskCapabilityNavigation, type TaskCapabilityDestination } from './CapabilitySettings.tsx';
import { ProjectCollaboration, TaskAssignmentPanel } from './ProjectCollaboration.tsx';
import type { TaskAssignment, TaskCreateIntent } from '../task-assignment.ts';
import { StrategyGoalsPage } from './StrategyGoalsPage.tsx';
import { StrategyDiscussionReply } from './StrategyDiscussionReply.tsx';
import type { GoalRef } from '../strategy-goals-types.ts';
import { StudioPage, type StudioLeaveGuard, type StudioProfessionalTarget } from './StudioPage.tsx';
import { StudioFeedbackDialog } from './StudioFeedbackDialog.tsx';
import { studioExecutionOwner } from '../../../extensions/business-plugins/studio/contracts.ts';
import { associateStudioEnterprise, studioRequest, readStudioOperation, readStudioWorkspace, checkedStudioAnalysisTarget, studioTaskUrl, StudioRequestError } from './studio-api.ts';
import type { StudioSystem, StudioWorkspace } from './studio-api.ts';
import { SemanticContextPanel } from './SemanticContextPanel.tsx';
import { semanticRecordsForAssistant } from './semantic-context-history.ts';
import { PersonalContextHistory } from './PersonalContextHistory.tsx';
import { PersonalContextTargetPicker, PersonalContextSelectionNotice, personalTargetLabel, type PersonalContextChoice } from './PersonalContextControls.tsx';
import type { PersonalContextSelection } from '../personal-context-types.ts';
import { readRunDiagnostic } from '../../agent/run-diagnostics.ts';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { DecisionBoardPage } from '../../../extensions/business-plugins/decision-board/ui/DecisionBoardPage.tsx';
import '../../../extensions/business-plugins/decision-board/ui/decision-board.css';
import { HelpPage } from './HelpPage.tsx';
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
import { DbLinkConnections } from './DbLinkConnections.tsx';
import { ModelSettings } from './ModelSettings.tsx';
import { WebSearchSettings } from './WebSearchSettings.tsx';
import { BrowserInteraction } from './BrowserInteraction.tsx';
import type { CaseCreationSource } from '../case-types.ts';
import { ConclusionReviewPanel } from './ConclusionReviewPanel.tsx';
import { carryConclusionReview } from './conclusion-review-client.ts';
import { ReportCalculationReview } from './ReportCalculationReview.tsx';
import { TaskWorkflow } from './TaskWorkflow.tsx';
import { CaseBoard } from './CaseBoard.tsx';
import { initialCaseMapView } from './case-star-map-view.ts';
import { initialCaseRelationUi } from './CaseRelationsPanel.tsx';
import { emptyCaseDecisionUiState, type CaseDecisionUiState } from './CaseDecisionsPanel.tsx';
import { ProjectBoard } from './ProjectBoard.tsx';
import * as caseClient from './case-client.ts';
import type { CaseContextSelection, CaseRecord, ProjectWorkRecord } from '../case-types.ts';
import './case-board.css';
import { ProjectNavigation } from './ProjectNavigation.tsx';
import { RenameProjectDialog, TaskDialog } from './ProjectDialogs.tsx';
import { TaskCapabilityList } from './TaskCapabilities.tsx';
import { ServiceConnectionsSettings, TaskServiceConnections } from './ServiceConnections.tsx';
import { TASK_CAPABILITIES, type TaskCapability, type TaskCapabilities } from '../task-capabilities.ts';
import { bindProjectContext, answerInteraction, archiveTask as archiveDiskTask, restoreTask as restoreDiskTask, archiveProject, createTask as createDiskTask, createProject as createDiskProject, HostRequestError, listProjects, openTask, readConfigurations, readTask, renameProject, restoreProject, runCommand, saveDraft, saveReport, sendMessage, setTaskCapability, stopTask, observeTask, type TaskObservationState } from './runtime-client.ts';
import { messageText, nativeMessageText, taskKey, type BrowserUIRequest, type BrowserUIResponse, type ClientProject, type ClientTask, type NativeMessage, type ProjectEvent, type PublicModelConfiguration, type SessionSnapshot } from './project-types.ts';
import { SapMethodExtractionPanel } from './SapMethodExtractionPanel.tsx';
import type { SapMethodRef } from '../../../extensions/business-plugins/metric-factory/methods/types.ts';
import { RequirementPage } from '../../../extensions/business-plugins/requirements-elaboration/ui/RequirementPage.tsx';
import { RefinerPage, type RefinerSource, type RefinerLeaveGuard } from '../../../extensions/business-plugins/ppt-refiner/ui/RefinerPage.tsx';
import { SimLabPage } from '../../../extensions/business-plugins/sim-lab/ui/SimLabPage.tsx';
import { freezeSuggestionFor, type FreezeSuggestion } from '../../../extensions/business-plugins/sim-lab/ui/task-suggestions.ts';
import '../../../extensions/business-plugins/sim-lab/ui/simlab.css';
import { ModelRegistryPage } from '../../../extensions/business-plugins/model-pack/ui/ModelRegistryPage.tsx';
import '../../../extensions/business-plugins/model-pack/ui/model-pack.css';
import type { RequirementContextSelection } from './requirement-types.ts';
import { taskPurpose } from '../task-assignment.ts';
import { FoundationOverview } from './FoundationOverview.tsx';
import { TaskReportDesk, type TaskReportDeskPersistedState } from './TaskReportDesk.tsx';
import { WorkspaceHome, type WorkspaceHomeReportTarget } from './WorkspaceHome.tsx';
import { WorkspaceSearchDialog } from './WorkspaceSearchDialog.tsx';
import { resolveInitialWorkspaceView, type HomeFoundationId, type WorkspaceSearchTarget } from './workspace-home-model.ts';

type SettingsView = 'usage-context-settings' | 'settings' | 'personal-materials' | 'web-search-settings' | 'automatic-action-settings' | 'skill-settings' | 'connection-settings' | 'capability-plans' | 'model-pack-settings';
type CapabilityView = 'requirement' | 'refiner' | 'simlab' | 'model-pack';
type LegacyAssetView = 'metric' | 'enterprise-materials';
type AppView = 'home' | 'foundation' | 'project-plan' | 'goals' | 'studio' | 'cases' | 'projects' | 'chat' | 'decision' | 'requirement' | 'refiner' | 'simlab' | 'model-pack' | SettingsView;

type IconName = 'home' | 'panel' | 'plus' | 'chat' | 'settings' | 'arrow' | 'stop' | 'check' | 'warning' | 'moon' | 'sun' | 'back' | 'assets' | 'market' | 'folder' | 'help' | 'search';
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const shapes: Record<IconName, ReactNode> = {
    home: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4m0 3v.1" /></>,
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
    panel: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    chat: <path d="M21 11a8 8 0 0 1-8 8H6l-4 3 1-6a8 8 0 0 1-1-5 9 9 0 0 1 19 0Z" />,
    settings: <><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3Z" /><circle cx="12" cy="11" r="3" /></>,
    arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
    search: <><circle cx="10.8" cy="10.8" r="5.8" /><path d="m15.1 15.1 4.1 4.1" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    check: <path d="m5 12 4 4L19 6" />,
    warning: <><path d="m12 3 10 17H2L12 3Z" /><path d="M12 9v4m0 3v1" /></>,
    moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" /></>,
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    assets: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" /></>,
    market: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

type TaskUI = { observation?: TaskObservationState; snapshot?: SessionSnapshot; streaming: string; status: 'connecting' | 'idle' | 'running' | 'stopping'; connected: boolean; posting: boolean; opening?: boolean; uiRequests: BrowserUIRequest[]; deferredRequestId?: string; extensionStatus?: Record<string, string>; finalReceived?: boolean; requestId?: string; optimistic?: string; error?: string; failedPrompt?: string; unavailablePersonal?: PersonalContextSelection[]; uncertainPersonalSend?: { args: Parameters<typeof sendMessage> }; toolStatus?: string; draftSaving?: boolean; commandResult?: string; notice?: string };
const initialUI = (): TaskUI => ({ streaming: '', status: 'connecting', connected: false, posting: false, uiRequests: [] });
function safeError(error: unknown): string {
  if (!(error instanceof HostRequestError)) return '本地服务暂时不可用，请重新连接。';
  if (error.code === 'project_busy') return '项目中还有运行、打开或待回应的任务，请先停止或等待后归档。';
  if (error.code === 'requirement_history_source_unavailable') return '此任务曾送入的分析框架包含当前不可读取的来源，消息未发送。可以在有权限的任务继续，或新建任务。';
  return error.message;
}
const messagesOf = (snapshot?: SessionSnapshot) => snapshot?.messages.filter(message => ['user', 'assistant', 'toolResult', 'bashExecution'].includes(message.role) || (message.role === 'custom' && message.display === true)) ?? [];
const diagnosticText = (value: unknown): string | undefined => { const diagnostic = readRunDiagnostic(value); return diagnostic ? `${diagnostic.message}${diagnostic.retryCount ? `（原生重试 ${diagnostic.retryCount} 次）` : ''}` : undefined; };
function lastRunError(task: ClientTask): string | undefined {
  const last = task.lastRun;
  if (last?.status === 'interrupted') {
    const diagnostic = diagnosticText(last.diagnostic);
    if (last.diagnostic?.code === 'native_run_start_rejected') return diagnostic;
    return `${diagnostic ?? ''} 上次运行已中断，远端结果未知；不会自动重放。`.trim();
  }
  if (last?.status === 'failed') return diagnosticText(last.diagnostic) ?? '上次回复未完成，可在检查配置后继续。';
}
function rejectedNativeStart(value: { task: ClientTask; snapshot: SessionSnapshot }, requestId: string): boolean {
  const last = value.task.lastRun;
  return last?.id === requestId && last.status === 'interrupted' &&
    last.diagnostic?.code === 'native_run_start_rejected' && value.snapshot.lastRun?.requestId !== requestId;
}

type RejectedSendRecord = { code: string; message: string; lastRunId: string | null; at: string };
const rejectedSendStorageKey = (projectId: string, taskId: string) => `optracall:send-rejected:v1:${projectId}/${taskId}`;
function readRejectedSend(projectId: string, taskId: string, task: Pick<ClientTask, 'draft' | 'lastRun'>): RejectedSendRecord | undefined {
  try {
    const raw = window.localStorage.getItem(rejectedSendStorageKey(projectId, taskId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<RejectedSendRecord>;
    if (!parsed || typeof parsed.message !== 'string' || !parsed.message.trim()) return undefined;
    const currentRunId = task.lastRun?.id ?? null;
    if (currentRunId !== (parsed.lastRunId ?? null) || !task.draft.trim()) {
      window.localStorage.removeItem(rejectedSendStorageKey(projectId, taskId));
      return undefined;
    }
    return { code: typeof parsed.code === 'string' ? parsed.code : 'host_request_failed', message: parsed.message, lastRunId: currentRunId, at: typeof parsed.at === 'string' ? parsed.at : '' };
  } catch { return undefined; }
}
function writeRejectedSend(projectId: string, taskId: string, record: RejectedSendRecord | null) {
  try {
    const key = rejectedSendStorageKey(projectId, taskId);
    if (!record) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(record));
  } catch { /* ignore storage quota/privacy errors */ }
}

export function App() {
  const [dbConnectionsOpen, setDbConnectionsOpen] = useState(false), [dbConnectionsProjectId, setDbConnectionsProjectId] = useState<string>();
  const [projects, setProjects] = useState<ClientProject[]>([]), [activeId, setActiveId] = useState<string>(), [activeTaskId, setActiveTaskId] = useState<string>(), [ui, setUI] = useState<Record<string, TaskUI>>({});
  const [view, setViewState] = useState<AppView>(() => resolveInitialWorkspaceView(window.location.href));
  const inSettings = ['settings', 'personal-materials', 'web-search-settings', 'automatic-action-settings', 'skill-settings', 'connection-settings', 'capability-plans', 'usage-context-settings', 'model-pack-settings'].includes(view);
  const [capabilityMounted, setCapabilityMounted] = useState<CapabilityView[]>([]);
  const capabilityReturn = useRef<Partial<Record<CapabilityView, { view: AppView; projectId?: string; taskId?: string; url: string }>>>({});
  const lastWorkspace = useRef<'home' | 'foundation' | 'chat' | 'decision' | 'cases' | 'projects' | 'studio' | 'goals'>('home'), settingsReturnView = useRef<Exclude<AppView, SettingsView>>('home');
  const [homeRefreshToken, setHomeRefreshToken] = useState(0);
  const [caseCreatePending, setCaseCreatePending] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const [activeTaskSourceCase, setActiveTaskSourceCase] = useState<{ taskKey: string; caseId: string; caseTitle?: string } | undefined>(() => {
    const params = new URL(window.location.href).searchParams;
    const projectId = params.get('project'), taskId = params.get('task'), caseId = params.get('case');
    return projectId && taskId && caseId ? { taskKey: taskKey(projectId, taskId), caseId } : undefined;
  });
  const [taskPanelByTask, setTaskPanelByTask] = useState<Record<string, 'chat' | 'report'>>(() => {
    const params = new URL(window.location.href).searchParams;
    const projectId = params.get('project'), taskId = params.get('task');
    return projectId && taskId && params.get('panel') === 'report' ? { [taskKey(projectId, taskId)]: 'report' } : {};
  });
  const [reportPreviewOpenByTask, setReportPreviewOpenByTask] = useState<Record<string, boolean>>({});
  const [deskStateByTask, setDeskStateByTask] = useState<Record<string, TaskReportDeskPersistedState>>({});
  const [autoOpenReportKey, setAutoOpenReportKey] = useState<string>();
  const [sidebarEnterpriseName, setSidebarEnterpriseName] = useState<string>();
  const [goalMounted, setGoalMounted] = useState(()=>new URL(window.location.href).searchParams.has('management'));
  const [management,setManagement] = useState<ManagementRoute>(()=>new URL(window.location.href).searchParams.get('management')==='gsa'?{area:'gsa',stage:'goals'}:{area:'strategy',stage:'co-create'});
  useEffect(()=>{
    const url=new URL(window.location.href);
    if(view==='goals')url.searchParams.set('management',management.area);else url.searchParams.delete('management');
    window.history.replaceState(null,'',url);
  },[view,management.area]);
  const [planProjectId, setPlanProjectId] = useState<string>(), [mountedPlans, setMountedPlans] = useState<string[]>([]);
  const [taskIntent, setTaskIntent] = useState<TaskCreateIntent>();
  const openProjectPlan = (project: ClientProject) => { setPlanProjectId(project.id); setMountedPlans(previous => previous.includes(project.id) ? previous : [...previous, project.id]); setHelpOpen(false); setView('project-plan'); if (window.innerWidth <= 760) setSidebarOpen(false); };
  const [goalUsageForProject, setGoalUsageForProject] = useState<UsageContext>();
  const [goalProjectEntrances, setGoalProjectEntrances] = useState<Record<string, { goal: GoalRef; usageContext?: UsageContext }>>({});
  const [goalForCase, setGoalForCase] = useState<import('../case-types.ts').CaseGoalEntry>(), [goalForProject, setGoalForProject] = useState<GoalRef>(), [handoffForProject, setHandoffForProject] = useState<{ goalId: string; handoffId: string }>();
  const [studioLibraryArea, setStudioLibraryArea] = useState<StudioLibraryArea>('semantic');
  const [studioLibraryRequest, setStudioLibraryRequest] = useState<StudioLibraryRequest>();
  const [studioMounted, setStudioMounted] = useState(() => new URL(window.location.href).searchParams.has('studio'));
  const [studioFocus, setStudioFocus] = useState<string>(() => new URL(window.location.href).searchParams.get('studio') || '');
  const [studioProfessionalTarget, setStudioProfessionalTarget] = useState<StudioProfessionalTarget>();
  const [studioEnterpriseId, setStudioEnterpriseId] = useState<string>();
  const [studioProjectAssociationPending, setStudioProjectAssociationPending] = useState<{ requestId: string; projectId: string; enterpriseId: string }>();
  const [studioDialogOpen, setStudioDialogOpen] = useState(false), [studioFeedback, setStudioFeedback] = useState<{ project: ClientProject; task: ClientTask; message: NativeMessage }>();
  const [studioTaskContexts, setStudioTaskContexts] = useState<Record<string, { systemId: string; purpose: 'construction' | 'analysis' }>>({});
  const [studioUsePending, setStudioUsePending] = useState<{ requestId: string; systemId: string; projectId: string }>();
  const studioLeave = useRef<StudioLeaveGuard | null>(null), studioLeaving = useRef<Promise<boolean> | null>(null), studioSelectionEpoch = useRef(0);
  const registerStudioLeave = useCallback((guard: StudioLeaveGuard | null) => { studioLeave.current = guard; }, []);
  const [refinerSource, setRefinerSource] = useState<RefinerSource>();
  const [personalCurrentKey, setPersonalCurrentKey] = useState<string>();
  const [personalChoice, setPersonalChoice] = useState<PersonalContextChoice>();
  const [personalEntry, setPersonalEntry] = useState<PersonalRetentionEntry>();
  const [personalMounted, setPersonalMounted] = useState(false);
  const [webSearchMounted, setWebSearchMounted] = useState(false);
  const [comparisonContexts, setComparisonContexts] = useState<Record<string, ComparisonContext>>({}), [comparisonKey, setComparisonKey] = useState<string>();
  const [refinerDeckId, setRefinerDeckId] = useState<string>();
  const refinerLeave = useRef<RefinerLeaveGuard | null>(null), refinerLeaving = useRef<Promise<boolean> | null>(null);
  const registerRefinerLeave = useCallback((guard: RefinerLeaveGuard | null) => { refinerLeave.current = guard; }, []);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpTrigger = useRef<HTMLButtonElement>(null);
  const closeHelp = () => { setHelpOpen(false); requestAnimationFrame(() => helpTrigger.current?.focus()); };
  const [teachReview,setTeachReview]=useState<import('../business-role-types.ts').TeachReviewOwner>();
  const [caseSource,setCaseSource]=useState<CaseCreationSource>(), [caseFocus, setCaseFocus] = useState<string | undefined>(() => new URL(window.location.href).searchParams.get('returnCase') ?? undefined);
  const [caseFocusSeq, setCaseFocusSeq] = useState(0);
  const [reportCaseReturn, setReportCaseReturn] = useState<{ caseId: string; projectId: string; taskId: string }>();
  const [caseIssueFocus, setCaseIssueFocus] = useState<string | undefined>(() => new URL(window.location.href).searchParams.get('returnIssue') ?? undefined);
  const [projectIssue, setProjectIssue] = useState<{projectId:string;caseId:string;issueId:string} | undefined>(() => {
    const params = new URL(window.location.href).searchParams;
    const projectId = params.get('project'), caseId = params.get('projectCase'), issueId = params.get('projectIssue');
    return projectId && caseId && issueId && !params.has('task') ? { projectId,caseId,issueId } : undefined;
  });
  const [caseMode, setCaseMode] = useState<'cards' | 'list'>('cards'), [projectMode, setProjectMode] = useState<'cards' | 'list'>('cards');
  const [caseMapView, setCaseMapView] = useState(initialCaseMapView), [caseRelationUi, setCaseRelationUi] = useState(initialCaseRelationUi), [caseProjectTarget, setCaseProjectTarget] = useState<string>();
  const [projectFocusSeq, setProjectFocusSeq] = useState(0);
  const [projectReturnFocus, setProjectReturnFocus] = useState<string>();
  const [caseDecisionUi, setCaseDecisionUi] = useState<Record<string, CaseDecisionUiState>>({});
  const [caseContexts, setCaseContexts] = useState<Record<string, { selection: CaseContextSelection; record: CaseRecord; work: ProjectWorkRecord | null }>>({});
  const [requirementContexts, setRequirementContexts] = useState<Record<string, RequirementContextSelection>>({});
  const [simlabTarget, setSimlabTarget] = useState<FreezeSuggestion>();
  const [enterpriseMaterials, setEnterpriseMaterials] = useState<Record<string, EnterpriseMaterialSelection[]>>({});
  const [personalContexts, setPersonalContexts] = useState<Record<string, { selection: PersonalContextSelection; title: string }[]>>({});
  const [projectDataSelections, setProjectDataSelections] = useState<TaskProjectDataSelections>({});
  const [feedbackContexts, setFeedbackContexts] = useState<Record<string, FeedbackContextSelection>>({});
  const [boardReportFocus, setBoardReportFocus] = useState<{ projectId: string; relativePath: string; reportSha256: string }>();
  const [feedbackReview, setFeedbackReview] = useState<FeedbackReviewStart>(), [feedbackNextSource, setFeedbackNextSource] = useState<FeedbackNextSource>(), [requirementFocus, setRequirementFocus] = useState<string>();
  const [requirementReturnTask, setRequirementReturnTask] = useState<{ projectId: string; taskId: string }>();
  const [enterpriseCases, setEnterpriseCases] = useState<Record<string, EnterpriseCaseSelection | undefined>>({});
  const [primaryNavOpen, setPrimaryNavOpen] = useState(true);
  const [projectSpaceOpen, setProjectSpaceOpen] = useState(true);
  const sidebarModal = useViewport('(max-width: 760px)');
  const inspectorModal = useViewport('(max-width: 1100px)');
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 760), [filesOpen, setFilesOpen] = useState(() => window.innerWidth > 1100 && new URL(window.location.href).searchParams.get('panel') !== 'report');
  const [projectDialogOpen, setProjectDialogOpen] = useState(false), [taskDialogProject, setTaskDialogProject] = useState<ClientProject>(), [renameTarget, setRenameTarget] = useState<ClientProject>(), [projectActionId, setProjectActionId] = useState<string>();
  const [capabilityUpdating, setCapabilityUpdating] = useState(false);
  const [taskInspector, setTaskInspector] = useState<{ key: string; section: 'report' | 'conclusion' }>();
  const [inspectedReport, setInspectedReport] = useState<{ key: string; version: ConclusionReviewReportCandidate } | undefined>(() => {
    const params = new URL(window.location.href).searchParams;
    const projectId = params.get('project'), taskId = params.get('task'), report = params.get('report'), sha256 = params.get('sha256');
    return projectId && taskId && report && sha256 ? { key: taskKey(projectId, taskId), version: { relativePath: report, sha256, textStatus: 'utf8', reviewable: true, current: false } } : undefined;
  });
  const [carryingTasks, setCarryingTasks] = useState<Record<string, boolean>>({});
  const visibleTask = useRef<string | undefined>(undefined);
  const inspectorTrigger = useRef<HTMLButtonElement | null>(null), filesToggle = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [configurations, setConfigurations] = useState<PublicModelConfiguration[]>([]), [selectedId, setSelectedId] = useState<string | null>(null);
  const [hostStatus, setHostStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading'), [globalError, setGlobalError] = useState(''), [globalNotice, setGlobalNotice] = useState(''), [filesRevision, setFilesRevision] = useState(0);
  const setView = (requested: AppView | LegacyAssetView, onEnter?: () => void) => {
    const next = requested === 'metric' || requested === 'enterprise-materials' ? 'studio' : requested;
    const enter = () => { if (requested === 'metric' || requested === 'enterprise-materials') setStudioProfessionalTarget({ kind: requested === 'metric' ? 'metrics' : 'materials' }); if (next === 'requirement' || next === 'refiner' || next === 'simlab' || next === 'model-pack') setCapabilityMounted(previous => previous.includes(next) ? previous : [...previous, next]); onEnter?.(); setViewState(next); };
    if (next === 'studio') setStudioMounted(true);
    if (next === 'goals') setGoalMounted(true);
    if (view === 'studio' && next !== 'studio' && studioLeave.current) {
      const waiting = studioLeaving.current ?? studioLeave.current(); studioLeaving.current = waiting;
      void waiting.then(allowed => { if (allowed) enter(); }).catch(error => setGlobalError(safeError(error))).finally(() => { if (studioLeaving.current === waiting) studioLeaving.current = null; }); return;
    }
    if (view !== 'refiner' || next === 'refiner' || !refinerLeave.current) { enter(); return; }
    const waiting = refinerLeaving.current ?? refinerLeave.current(); refinerLeaving.current = waiting;
    void waiting.then(allowed => { if (allowed) enter(); }).catch(error => setGlobalError(safeError(error))).finally(() => { if (refinerLeaving.current === waiting) refinerLeaving.current = null; });
  };
  const textarea = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null), resultsPanel = useRef<HTMLElement>(null), settingsTrigger = useRef<HTMLElement | null>(null), sidebarToggle = useRef<HTMLButtonElement>(null), dialogTrigger = useRef<HTMLElement | null>(null);
  const uiRef = useRef(ui);
  const streams = useRef(new Map<string, { controller: AbortController; ready: Promise<void>; statusOnly: boolean }>()), draftQueues = useRef(new Map<string, Promise<void>>()), draftEpochs = useRef(new Map<string, number>()), draftVersions = useRef(new Map<string, number>()), pending = useRef(new Set<string>());
  const archivingProjects = useRef(new Set<string>()), deferredStreamErrors = useRef(new Map<string, string>());
  const unconfirmedReplies = useRef(new WeakSet<NativeMessage>());
  const eventHandler = useRef<(projectId: string, taskId: string, event: ProjectEvent) => void>(() => {}), mounted = useRef(true);
  const active = projects.find(item => item.id === activeId), activeTask = active?.tasks.find(item => item.id === activeTaskId), activeKey = active && activeTask ? taskKey(active.id, activeTask.id) : undefined;
  const canOpenProjectFiles = Boolean(active) && (view === 'chat' || (view === 'studio' && Boolean(activeKey)));
  const visibleTaskInspector = view === 'chat' && taskInspector?.key === activeKey ? taskInspector?.section : undefined;
  const showConclusion = visibleTaskInspector === 'conclusion', showReport = visibleTaskInspector === 'report';
  const inspectedVersion = inspectedReport?.key === activeKey ? inspectedReport?.version : undefined;
  const [boundProjectId, setBoundProjectId] = useState<string>();
  const projectBinding = useRef<{ projectId: string; controller: AbortController; ready: Promise<void> } | undefined>(undefined);
  const ensureProjectContext = (projectId: string): Promise<void> => {
    if (projectBinding.current?.projectId === projectId) return projectBinding.current.ready;
    projectBinding.current?.controller.abort();
    const controller = new AbortController();
    const ready = bindProjectContext(projectId, controller.signal).then(() => {
      if (!controller.signal.aborted) setBoundProjectId(projectId);
    }, error => {
      if (projectBinding.current?.controller === controller) {
        projectBinding.current = undefined;
        setBoundProjectId(undefined);
      }
      throw error;
    });
    projectBinding.current = { projectId, controller, ready };
    return ready;
  };
  const readTaskForNavigation = async (projectId: string, taskId: string) => {
    await ensureProjectContext(projectId);
    return readTask(projectId, taskId);
  };
  const showProjectFiles = canOpenProjectFiles && filesOpen && !showConclusion && !showReport && boundProjectId === activeId;
  const showInspector = showProjectFiles || showConclusion || showReport;
  const selectedCase = activeKey ? caseContexts[activeKey] : undefined;
  const attachedRequirement = activeKey ? requirementContexts[activeKey] : undefined;
  const attachedEnterprise = activeKey ? enterpriseMaterials[activeKey] ?? [] : [];
  const attachedPersonal = activeKey ? personalContexts[activeKey] ?? [] : [];
  const attachedProjectData = activeKey ? projectDataSelections[activeKey] ?? [] : [];
  const attachedFeedback = activeKey ? feedbackContexts[activeKey] : undefined;
  const attachedEnterpriseCase = activeKey && selectedCase && enterpriseCases[activeKey]?.caseId === selectedCase.record.id ? enterpriseCases[activeKey] : undefined;
  const current = activeKey ? ui[activeKey] ?? initialUI() : undefined, archived = Boolean(active?.archivedAt || activeTask?.archivedAt);
  const busy = current?.status === 'running' || current?.status === 'stopping' || Boolean(current?.posting) || Boolean(current?.opening) || Boolean(current?.uiRequests?.length);
  visibleTask.current = activeKey;
  const carrying = Boolean(activeKey && carryingTasks[activeKey]);
  const contextLocked = busy || carrying || Boolean(current?.uncertainPersonalSend);
  const question = current?.uiRequests?.[0], modalOpen = studioDialogOpen || Boolean(studioFeedback) || projectDialogOpen || Boolean(taskDialogProject) || Boolean(renameTarget) || Boolean(feedbackNextSource), config = configurations.find(value => value.id === selectedId);
  const changeUI = (key: string, update: (previous: TaskUI) => TaskUI) => { if (mounted.current) { const next = { ...uiRef.current, [key]: update(uiRef.current[key] ?? initialUI()) }; uiRef.current = next; setUI(next); } };
  const updateTask = (projectId: string, taskId: string, update: (task: ClientTask) => ClientTask) => setProjects(previous => previous.map(project => project.id === projectId ? { ...project, tasks: project.tasks.map(task => task.id === taskId ? update(task) : task) } : project));
  const mergeProject = (value: ClientProject, refreshedTaskId?: string, version?: number, hadPending = false) => setProjects(previous => {
    const old = previous.find(project => project.id === value.id);
    const project = { ...value, tasks: value.tasks.map(task => { const local = old?.tasks.find(item => item.id === task.id), key = taskKey(value.id, task.id); const acceptDraft = refreshedTaskId === task.id && !hadPending && !draftQueues.current.has(key) && (draftVersions.current.get(key) ?? 0) === version; return local && !acceptDraft ? { ...task, draft: local.draft } : task; }) };
    return old ? previous.map(item => item.id === project.id ? project : item) : [...previous, project];
  });
  const refreshConfigurations = async () => { try { const value = await readConfigurations(); if (!mounted.current) return; setConfigurations(value.configurations); setSelectedId(value.selectedId); setHostStatus('ready'); setGlobalError(''); } catch (error) { if (mounted.current) { setHostStatus('unavailable'); setGlobalError(safeError(error)); } throw error; } };
  const applySnapshot = (key: string, snapshot: SessionSnapshot) => changeUI(key, old => ({ ...old, snapshot, streaming: snapshot.status === 'running' ? old.streaming : '', optimistic: undefined, status: snapshot.status === 'running' ? 'running' : 'idle', requestId: snapshot.status === 'running' ? snapshot.lastRun?.requestId ?? old.requestId : undefined, uiRequests: snapshot.uiRequests ?? [], toolStatus: undefined, finalReceived: false }));
  const requestAcceptedInSnapshot = (value: { task: ClientTask; snapshot: SessionSnapshot }, requestId: string) =>
    value.snapshot.lastRun?.requestId === requestId
    || (value.task.lastRun?.id === requestId && ['completed', 'cancelled', 'failed'].includes(value.task.lastRun.status));
  const refreshTask = async (projectId: string, taskId: string) => {
    const key = taskKey(projectId, taskId), version = draftVersions.current.get(key) ?? 0, hadPending = draftQueues.current.has(key), value = await readTask(projectId, taskId);
    if (!mounted.current) return value;
    if (value.project.id !== projectId || value.task.id !== taskId) throw new HostRequestError('原任务归属未能核对；保留原请求与问题。');
    const uncertain = uiRef.current[key]?.uncertainPersonalSend;
    if (uncertain && requestAcceptedInSnapshot(value, uncertain.args[3])) {
      writeRejectedSend(projectId, taskId, null);
      changeUI(key, old => ({ ...old, uncertainPersonalSend: undefined, failedPrompt: undefined, notice: '已核对原请求已接受；未重新发送。' }));
    } else if (uncertain && rejectedNativeStart(value, uncertain.args[3])) {
      changeUI(key, old => ({ ...old, uncertainPersonalSend: undefined, failedPrompt: value.task.draft, notice: '已核对原请求未被接受。原问题和选择保留，可手动发送。' }));
    }
    const runErr = lastRunError(value.task);
    const interrupted = value.task.lastRun?.status === 'interrupted';
    const rejected = interrupted ? undefined : readRejectedSend(projectId, taskId, value.task);
    mergeProject(value.project, taskId, version, hadPending); applySnapshot(key, value.snapshot); changeUI(key, old => ({ ...old, error: interrupted ? runErr : rejected?.message ?? runErr ?? old.error, failedPrompt: interrupted ? old.failedPrompt : rejected ? value.task.draft : old.failedPrompt })); setFilesRevision(previous => previous + 1); return value;
  };
  const connect = (projectId: string, taskId: string, statusOnly = false): Promise<void> => {
    const key = taskKey(projectId, taskId), existing = streams.current.get(key);
    if (existing?.statusOnly === statusOnly) return existing.ready;
    existing?.controller.abort();
    const controller = new AbortController(); let resolveReady!: () => void, rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }); void ready.catch(() => {});
    streams.current.set(key, { controller, ready, statusOnly }); changeUI(key, old => ({ ...old, connected: false }));
    const isCurrent = () => !controller.signal.aborted && streams.current.get(key)?.controller === controller;
    void observeTask(projectId, taskId, event => { if (isCurrent()) { eventHandler.current(projectId, taskId, event); if (event.type === 'snapshot') resolveReady(); } }, controller.signal, {
      statusOnly,
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
    if (event.type === 'snapshot') {
      if (!event.statusOnly) applySnapshot(key, event.snapshot);
      changeUI(key, old => ({ ...old, connected: true, ...(event.statusOnly ? {
        status: event.snapshot.status, requestId: event.snapshot.status === 'running' ? event.snapshot.lastRun?.requestId : undefined,
      } : {}) }));
      return;
    }
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
      if (native.type === 'message_end' && native.message) { const message = native.message; if (message.role === 'assistant' && !message.nativeEntryId) unconfirmedReplies.current.add(message); changeUI(key, old => { const snapshot = old.snapshot ?? { sessionId: key, messages: [], tools: [], status: 'running' as const, sdkVersion: '' }, previous = snapshot.messages.at(-1), duplicate = previous && JSON.stringify(previous) === JSON.stringify(message); return { ...old, snapshot: { ...snapshot, messages: duplicate ? snapshot.messages : [...snapshot.messages, message] }, ...(message.role === 'assistant' ? { streaming: '', finalReceived: true } : {}), ...(message.role === 'user' ? { optimistic: undefined } : {}) }; }); }
      return;
    }
    if (event.type === 'run.settled') {
      changeUI(key, old => old.requestId && event.requestId !== old.requestId ? old : ({ ...old, status: 'idle', posting: false, toolStatus: undefined, streaming: '', optimistic: undefined, requestId: undefined, uiRequests: [], deferredRequestId: undefined, error: event.outcome === 'failed' ? [diagnosticText(event.diagnostic), event.error].filter(Boolean).join(' ') || '本次回复未完成，请检查配置后显式重试。' : undefined, failedPrompt: event.outcome === 'failed' ? old.failedPrompt : undefined, notice: event.outcome === 'cancelled' ? '已停止，已保存的部分输出仍保留。' : diagnosticText(event.diagnostic) ?? old.notice }));
      if (event.statusOnly) updateTask(projectId, taskId, task => task.lastRun?.id === event.requestId ? { ...task, lastRun: { ...task.lastRun, status: event.outcome } } : task);
      else void refreshTask(projectId, taskId).catch(error => changeUI(key, old => ({ ...old, error: safeError(error) })));
    }
  };
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    void Promise.all([readConfigurations(controller.signal), listProjects(controller.signal)]).then(([models, saved]) => {
      if (controller.signal.aborted) return; setConfigurations(models.configurations); setSelectedId(models.selectedId); setProjects(saved); const selected = resolveProjectLocation(saved, window.location.href); setActiveId(selected.projectId); setActiveTaskId(selected.taskId); if (selected.missing) setGlobalError('原链接指定的' + (selected.missing === 'project' ? '项目' : '任务') + '暂不可读取。保留原定位，未替换为其他对象；请核对来源或当前权限。'); setHostStatus('ready');
      for (const project of saved) for (const task of project.tasks) {
        const runErr = lastRunError(task);
        const interrupted = task.lastRun?.status === 'interrupted';
        const rejected = interrupted ? undefined : readRejectedSend(project.id, task.id, task);
        changeUI(taskKey(project.id, task.id), old => ({ ...old, error: interrupted ? runErr : rejected?.message ?? runErr, failedPrompt: interrupted ? old.failedPrompt : rejected ? task.draft : old.failedPrompt }));
      }
    }, error => { if (!controller.signal.aborted) { setHostStatus('unavailable'); setGlobalError(safeError(error)); } });
    return () => { mounted.current = false; controller.abort(); projectBinding.current?.controller.abort(); projectBinding.current = undefined; for (const stream of streams.current.values()) stream.controller.abort(); streams.current.clear(); };
  }, []);
  useEffect(() => {
    if (!activeId) { projectBinding.current?.controller.abort(); projectBinding.current = undefined; setBoundProjectId(undefined); return; }
    void ensureProjectContext(activeId).catch(error => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setGlobalError(safeError(error));
    });
  }, [activeId]);
  const subscriptionKeys = projects.flatMap(project => project.archivedAt ? [] : project.tasks.filter(task => (['chat', 'studio'].includes(view) && taskKey(project.id, task.id) === activeKey) || task.lastRun?.status === 'running' || ['running', 'stopping'].includes(ui[taskKey(project.id, task.id)]?.status ?? '') || ui[taskKey(project.id, task.id)]?.opening || ui[taskKey(project.id, task.id)]?.uiRequests.length).map(task => taskKey(project.id, task.id))).join(',');
  useEffect(() => {
    const wanted = new Set(subscriptionKeys.split(',').filter(Boolean));
    for (const [key, stream] of streams.current) if (!wanted.has(key)) { stream.controller.abort(); streams.current.delete(key); }
    for (const key of wanted) {
      const [projectId, taskId] = key.split('/') as [string, string];
      const statusOnly = Boolean(projects.find(project => project.id === projectId)?.memberPackScoped &&
        (activeId !== projectId || boundProjectId !== projectId));
      void connect(projectId, taskId, statusOnly).then(() => statusOnly ? undefined : refreshTask(projectId, taskId)).catch(error => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) changeUI(key, old => ({ ...old, error: safeError(error) }));
      });
    }
  }, [subscriptionKeys, activeId, boundProjectId]);
  useEffect(() => { if (active?.archivedAt && activeTask && (active.memberPackScoped ? boundProjectId === active.id : true)) { const key = taskKey(active.id, activeTask.id); void refreshTask(active.id, activeTask.id).then(() => changeUI(key, old => ({ ...old, connected: true, observation: undefined }))).catch(error => changeUI(key, old => ({ ...old, error: safeError(error) }))); } }, [active?.archivedAt, active?.id, activeTask?.id, boundProjectId]);
  useEffect(() => { setSidebarOpen(!sidebarModal); }, [sidebarModal]);
  useEffect(() => { if (view === 'chat' || view === 'studio') end.current?.scrollIntoView({ block: 'end' }); }, [current?.snapshot?.messages, current?.streaming, view]);
  const persistDraft = (projectId: string, taskId: string, text: string): Promise<void> => {
    const key = taskKey(projectId, taskId), epoch = draftEpochs.current.get(key) ?? 0; draftVersions.current.set(key, (draftVersions.current.get(key) ?? 0) + 1);
    updateTask(projectId, taskId, task => ({ ...task, draft: text }));
    if (!text.trim()) {
      writeRejectedSend(projectId, taskId, null);
      changeUI(key, old => ({ ...old, draftSaving: true, failedPrompt: undefined, ...(old.error?.startsWith('发送未获 Host 接受：') ? { error: undefined } : {}) }));
    } else {
      changeUI(key, old => ({ ...old, draftSaving: true, ...(old.failedPrompt !== undefined ? { failedPrompt: text } : {}) }));
    }
    const previous = draftQueues.current.get(key) ?? Promise.resolve(), next = previous.catch(() => {}).then(() => { if ((draftEpochs.current.get(key) ?? 0) === epoch) return saveDraft(projectId, taskId, text); }); draftQueues.current.set(key, next);
    void next.then(() => { if (draftQueues.current.get(key) === next) { draftQueues.current.delete(key); changeUI(key, old => ({ ...old, draftSaving: false })); } }, () => { if (draftQueues.current.get(key) === next) { draftQueues.current.delete(key); changeUI(key, old => ({ ...old, draftSaving: false, error: '草稿尚未保存，请检查本地服务后继续。' })); } }); return next;
  };
  const focusComposerOnEntry = () => { requestAnimationFrame(() => textarea.current?.focus()); };
  const openWorkspace = (next: 'home' | 'foundation' | 'chat' | 'decision' | 'cases' | 'projects' | 'studio' | 'goals') => { setHelpOpen(false); if (next === 'decision') setBoardReportFocus(undefined); if (next === 'home' || next === 'foundation') setHomeRefreshToken(value => value + 1); lastWorkspace.current = next; if (next === 'cases') { setCaseFocus(undefined); setCaseIssueFocus(undefined); setReportCaseReturn(undefined); } setView(next, () => { if (sidebarModal && sidebarOpen) closeSidebar(); if (next === 'chat') focusComposerOnEntry(); }); };
  const openQuickSearch = () => setSearchOpen(true);
  const closeQuickSearch = () => { setSearchOpen(false); requestAnimationFrame(() => searchTrigger.current?.focus()); };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || searchOpen) return;
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      openQuickSearch();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);
  const openStudioLibrary = (area: StudioLibraryArea) => {
    const enter = () => setView('studio', () => { setStudioLibraryArea(area); setStudioLibraryRequest({area}); setStudioProfessionalTarget(undefined); setStudioFocus(''); setFilesOpen(false); setHelpOpen(false); lastWorkspace.current = 'studio'; if (window.innerWidth <= 760) setSidebarOpen(false); });
    if (view !== 'studio' || !studioLeave.current) { enter(); return; }
    const waiting = studioLeaving.current ?? studioLeave.current(); studioLeaving.current = waiting;
    void waiting.then(allowed => { if (allowed) enter(); }).catch(error => setGlobalError(safeError(error))).finally(() => { if (studioLeaving.current === waiting) studioLeaving.current = null; });
  };
  const openStudioProfessional = (target: StudioProfessionalTarget) => { setView('studio', () => { setStudioLibraryArea(studioLibraryProfessionalArea(target.kind)); setStudioProfessionalTarget(target); setFilesOpen(false); setHelpOpen(false); }); };
  const openSapMethod = (target: SapMethodRef) => openStudioProfessional({ kind: 'methods', id: target.methodId, version: target.version });
  const rememberCapabilityReturn = (target: CapabilityView, project?: ClientProject) => { capabilityReturn.current[target] = { view, projectId: project?.id || activeId, taskId: project && project.id !== activeId ? undefined : activeTaskId, url: window.location.href }; };
  const openCapability = (target: CapabilityView, project?: ClientProject) => { rememberCapabilityReturn(target, project); if (target === 'requirement') { setRequirementReturnTask(undefined); setRequirementFocus(undefined); } if (target === 'simlab') setSimlabTarget(undefined); if (target === 'refiner') { setRefinerSource(undefined); setRefinerDeckId(undefined); } setHelpOpen(false); setView(target); if (window.innerWidth <= 760) setSidebarOpen(false); };
  const backFromCapability = (target: CapabilityView) => { const original = capabilityReturn.current[target]; if (!original) { openWorkspace('projects'); return; } if (original.projectId) { const project = projects.find(value => value.id === original.projectId), task = original.taskId && project?.tasks.find(value => value.id === original.taskId); if (!project || original.taskId && !task) { setGlobalError('原工作对象暂不可读取，原记录与请求保留；请在项目中核对，不会替换为其他任务。'); openWorkspace('projects'); return; } selectContext(project.id, task ? task.id : undefined); } window.history.replaceState(null, '', original.url); if (original.view === 'projects') setProjectReturnFocus(original.projectId); setView(original.view); };
  function closeSidebar() {
    setSidebarOpen(false);
    requestAnimationFrame(() => sidebarToggle.current?.focus({ preventScroll: true }));
  }
  function selectInspector(section: 'files' | 'report' | 'conclusion') {
    setFilesOpen(section === 'files');
    setTaskInspector(section !== 'files' && activeKey ? { key: activeKey, section } : undefined);
  }
  function openTaskFiles(trigger: HTMLButtonElement) {
    inspectorTrigger.current = trigger;
    selectInspector('files');
    requestAnimationFrame(() => document.querySelector<HTMLElement>('#project-files h2')?.focus({ preventScroll: true }));
  }
  function toggleProjectFiles(trigger: HTMLButtonElement) {
    if (showProjectFiles) closeInspector();
    else {
      inspectorTrigger.current = trigger;
      selectInspector('files');
    }
  }
  function closeInspector() {
    const trigger = inspectorTrigger.current;
    inspectorTrigger.current = null;
    setFilesOpen(false);
    setTaskInspector(undefined);
    setInspectedReport(undefined);
    requestAnimationFrame(() => {
      const target = trigger?.getClientRects().length ? trigger : filesToggle.current;
      target?.focus({ preventScroll: true });
    });
  }
  const openProjectSources = () => { if (active) { selectContext(active.id, activeTask?.id); setView('chat'); selectInspector('files'); } else openWorkspace('projects'); };
  const openSettingsView = (next: SettingsView, trigger?: HTMLButtonElement, entry?: PersonalRetentionEntry) => {
    const source = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setView(next, () => {
      if (!inSettings) {
        settingsReturnView.current = view as Exclude<AppView, SettingsView>;
        settingsTrigger.current = source;
        setPersonalCurrentKey(view === 'chat' && activeTask && !archived ? activeKey : undefined);
      }
      if (!inSettings || entry) setPersonalEntry(entry);
      if (next === 'personal-materials') setPersonalMounted(true);
      if (next === 'web-search-settings') setWebSearchMounted(true);
      setHelpOpen(false);
      if (window.innerWidth <= 760) setSidebarOpen(false);
    });
  };
  const openPersonal = (entry?: PersonalRetentionEntry) => openSettingsView('personal-materials', undefined, entry);
  const openPersonalProject = (projectId: string) => { const project = projects.find(value => value.id === projectId); if (!project) { setGlobalError('原项目未能核对，请刷新项目列表；来源引用仍保留。'); return; } if (project.tasks[0]) void chooseTask(project, project.tasks[0], false); else { selectContext(project.id); openWorkspace('chat'); } };
  const openPersonalMaterial = (materialId: string, revisionId?: string) => openStudioProfessional({ kind: 'materials', id: materialId, version: revisionId });
  const organizeReply = async (item: NativeMessage, kind: 'knowledge' | 'experience' | 'goal') => {
    if (!active || !activeTask || item.role !== 'assistant' || !item.nativeEntryId || !item.nativeSessionId) return;
    const projectId = active.id, taskId = activeTask.id, text = nativeMessageText(item);
    try { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); const expectedTextSha256 = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join(''); const ref={type:'native-reply' as const,projectId,taskId,sessionId:item.nativeSessionId,messageId:item.nativeEntryId,expectedTextSha256}; if (mounted.current) { if(kind==='goal') showManagement({area:'gsa',stage:'goals'},{kind:'task',projectId,taskId,reply:ref}); else openPersonal({ref,kind}); } } catch { if (mounted.current) setGlobalError('原生回复身份尚未核定，请保留原回复，重读后再整理。'); }
  };
  const selectContext = (projectId: string, taskId?: string, studioSystemId?: string) => { if (projectId !== activeId) setBoundProjectId(undefined); setProjectIssue(undefined);setActiveId(projectId); setActiveTaskId(taskId); window.history.replaceState(null, '', studioTaskUrl(window.location.href, projectId, taskId, studioSystemId)); };
  const openProjectCollaboration = (project: ClientProject, issue?: {caseId:string;issueId:string}) => {
    selectContext(project.id); openWorkspace('chat');
    if (issue) {
      const url = new URL(window.location.href);
      url.searchParams.set('projectCase', issue.caseId); url.searchParams.set('projectIssue', issue.issueId);
      window.history.replaceState(null, '', url); setProjectIssue({ projectId:project.id, ...issue });
    }
  };
  const returnToProjectIssue = (issue: {caseId:string;issueId:string}) => {
    const url = new URL(window.location.href);
    for (const key of ['project','task','studio','projectCase','projectIssue']) url.searchParams.delete(key);
    url.searchParams.set('returnCase',issue.caseId); url.searchParams.set('returnIssue',issue.issueId);
    window.history.replaceState(null,'',url); openWorkspace('cases'); setCaseFocus(issue.caseId); setCaseIssueFocus(issue.issueId);
  };
  const openTaskRequirements = () => {
    if (!active || !activeTask) return;
    rememberCapabilityReturn('requirement'); setRequirementReturnTask({ projectId: active.id, taskId: activeTask.id });
    setRequirementFocus(attachedRequirement?.instanceId); setHelpOpen(false); setView('requirement');
  };
  const returnFromRequirements = () => {
    const project = projects.find(value => value.id === requirementReturnTask?.projectId);
    const task = project?.tasks.find(value => value.id === requirementReturnTask?.taskId);
    if (!project || !task) { setRequirementReturnTask(undefined); setGlobalError('原需求所属任务暂不可读取；保留准确需求引用，请回项目核对。'); openWorkspace('projects'); return; }
    selectContext(project.id, task.id); openWorkspace('chat');
  };
  const chooseTask = async (project: ClientProject, task: ClientTask, activate = true, context?: { selection: CaseContextSelection; record: CaseRecord; work: ProjectWorkRecord | null }, destination: 'chat' | 'studio' = 'chat', settledNavigation = false, studioSystemId?: string) => {
    const studioNavigationAllowed = view === 'studio' && destination !== 'studio' && !settledNavigation && studioLeave.current ? await studioLeave.current() : false;
    if (view === 'studio' && destination !== 'studio' && !settledNavigation && studioLeave.current && !studioNavigationAllowed) return;
    if (destination === 'chat') setCaseContexts(previous => { const next = { ...previous }; if (context) next[taskKey(project.id, task.id)] = context; else delete next[taskKey(project.id, task.id)]; return next; });
    const key = taskKey(project.id, task.id);
    selectContext(project.id, task.id, destination === 'studio' ? studioSystemId : undefined);
    setGlobalError('');
    if (destination === 'studio') {
      setStudioMounted(true);
      setViewState('studio');
    } else if (settledNavigation || studioNavigationAllowed) {
      lastWorkspace.current = 'chat';
      setViewState('chat');
      focusComposerOnEntry();
    } else {
      openWorkspace('chat');
    }
    if (window.innerWidth <= 760) setSidebarOpen(false);
    await ensureProjectContext(project.id);
    if (project.archivedAt || task.archivedAt) { const value = await readTask(project.id, task.id); mergeProject(value.project); applySnapshot(key, value.snapshot); return; }
    try { if (activate) changeUI(key, old => ({ ...old, opening: true })); await connect(project.id, task.id); if (activate) {
      // Browsing a new task must not execute untrusted startup resources before
      // the user can choose its execution permissions. First send initializes it.
      const value = task.sessionFile || task.lastRun ? await openTask(project.id, task.id) : await readTask(project.id, task.id);
      const runErr = lastRunError(value.task);
      const interrupted = value.task.lastRun?.status === 'interrupted';
      const rejected = interrupted ? undefined : readRejectedSend(project.id, task.id, value.task);
      mergeProject(value.project); applySnapshot(key, value.snapshot);
      if (runErr || rejected) changeUI(key, old => ({ ...old, error: interrupted ? runErr : rejected?.message ?? runErr ?? old.error, failedPrompt: interrupted ? old.failedPrompt : rejected ? value.task.draft : old.failedPrompt }));
    } } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) changeUI(key, old => ({ ...old, error: safeError(error) })); } finally { if (activate) changeUI(key, old => ({ ...old, opening: false })); }
    if (destination === 'studio' && visibleTask.current === key) focusComposerOnEntry();
  };
  const reconnect = async (projectId: string, taskId: string) => {
    const key = taskKey(projectId, taskId);
    const cleanupRequestId = uiRef.current[key]?.snapshot?.cleanupRequestId;
    streams.current.get(key)?.controller.abort();
    streams.current.delete(key);
    changeUI(key, old => ({ ...old, error: undefined }));
    try {
      await refreshConfigurations();
      if (projects.find(project => project.id === projectId)?.archivedAt) {
        await refreshTask(projectId, taskId);
        changeUI(key, old => ({ ...old, connected: true, observation: undefined }));
        return;
      }
      await connect(projectId, taskId);
      if (cleanupRequestId) await stopTask(projectId, taskId, cleanupRequestId);
      await refreshTask(projectId, taskId);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) changeUI(key, old => ({ ...old, error: safeError(error) }));
    }
  };
  const taskArchiveAction = async (restore = false) => {
    if (!active || !activeTask || busy) return;
    try { const updated = await (restore ? restoreDiskTask : archiveDiskTask)(active.id, activeTask.id); mergeProject({ ...active, tasks: active.tasks.map(task => task.id === updated.id ? updated : task) }); setGlobalNotice(restore ? '已恢复原任务，未自动执行。' : '任务已归档，原会话、草稿和成果保留。'); }
    catch (fault) { setGlobalError(safeError(fault)); }
  };
  const stop = async () => { if (!active || !activeTask || !activeKey || !busy || current?.status === 'stopping') return; const projectId = active.id, taskId = activeTask.id, key = activeKey; changeUI(key, old => ({ ...old, status: 'stopping' })); try { if (current?.opening && question) await answerInteraction(projectId, taskId, { id: question.id, cancelled: true }); await stopTask(projectId, taskId, current?.snapshot?.cleanupRequestId); await refreshTask(projectId, taskId); } catch (error) { changeUI(key, old => ({ ...old, error: safeError(error), status: 'running' })); } };
  useEffect(() => { const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape' && !helpOpen && (view === 'chat' || view === 'studio') && !modalOpen && !document.querySelector('dialog[open]') && busy && !archived) { event.preventDefault(); void stop(); } }; document.addEventListener('keydown', keyboard); return () => document.removeEventListener('keydown', keyboard); });
  function openProjectCreation(goal?: GoalRef, usageContext?: UsageContext, decompositionHandoff?: { goalId: string; handoffId: string }) {
    setGoalForProject(goal);
    setGoalUsageForProject(usageContext);
    setHandoffForProject(decompositionHandoff);
    setProjectDialogOpen(true);
  }
  function closeProjectCreation() {
    setProjectDialogOpen(false);
    setGoalForProject(undefined);
    setGoalUsageForProject(undefined);
    setHandoffForProject(undefined);
  }
  const createProject = async (name: string, configurationId: string) => {
    const fromStudio = view === 'studio', enterpriseId = fromStudio ? studioEnterpriseId : undefined;
    const project = await createDiskProject(
      name,
      configurationId,
      goalForProject
        ? {
            goal: goalForProject,
            ...(handoffForProject ? { decompositionHandoff: handoffForProject } : {}),
          }
        : undefined,
    );
    if (goalForProject) setGoalProjectEntrances(previous => ({ ...previous, [project.id]: { goal: structuredClone(goalForProject), ...(goalUsageForProject ? { usageContext: structuredClone(goalUsageForProject) } : {}) } }));
    closeProjectCreation();
    if (enterpriseId) {
      const requestId = crypto.randomUUID();
      try { await associateStudioEnterprise({ kind: 'project', entityId: project.id, enterpriseId, requestId }); }
      catch (error) { if (error instanceof StudioRequestError && error.uncertain) setStudioProjectAssociationPending({ requestId, projectId: project.id, enterpriseId }); setGlobalError(`项目已创建，企业关联尚未核定，请保留该项目并核对归属。${safeError(error)}`); }
    }
    setProjects(previous => [...previous.filter(p => p.id !== project.id), project]); selectContext(project.id); setFilesOpen(window.innerWidth > 1100);
    if (!fromStudio) openWorkspace('chat');
    if (window.innerWidth <= 760) setSidebarOpen(false);
  };
  const inspectStudioProjectAssociation = async () => { const pending = studioProjectAssociationPending; if (!pending) return; try { const value = await readStudioOperation(pending.requestId); if (value.status === 'unknown') { setGlobalNotice('原企业关联请求仍为 UNKNOWN；项目已建立，未重新创建或重发关联。'); return; } setStudioProjectAssociationPending(current => current?.requestId === pending.requestId ? undefined : current); setGlobalNotice(value.status === 'succeeded' ? '已核定原企业关联请求成功，项目与输入保留，未重新创建。' : `原关联请求已核失败，项目保留；请在 Studio 核对范围后关联。${value.error || ''}`); } catch (error) { setGlobalError(safeError(error)); } };
  const showTaskDialog = (project: ClientProject, trigger: HTMLElement, intent?: TaskCreateIntent) => {
    dialogTrigger.current = trigger; setTaskIntent(intent); setTaskDialogProject(project);
  };
  const closeDialog = () => { setTaskDialogProject(undefined); setRenameTarget(undefined); requestAnimationFrame(() => { if (dialogTrigger.current?.isConnected) dialogTrigger.current.focus(); else textarea.current?.focus(); }); };
  const createTask = async (name: string, configurationId: string, capabilities: TaskCapabilities, assignment: TaskAssignment, operationId: string) => {
    if (!taskDialogProject) return;
    const project = taskDialogProject;
    const task = await createDiskTask(project.id, name, configurationId || undefined, capabilities, assignment, operationId);
    setProjects(previous => previous.map(item => item.id === project.id ? { ...item, tasks: [...item.tasks.filter(prior => prior.id !== task.id), task] } : item));
    setTaskDialogProject(undefined); dialogTrigger.current = null;
    await chooseTask({ ...project, tasks: [...project.tasks.filter(prior => prior.id !== task.id), task] }, task);
  };
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
  const send = async (text = activeTask?.draft ?? '', _retry = false, personalOverride?: { selection: PersonalContextSelection; title: string }[], studioTarget?: { project: ClientProject; task: ClientTask; context: { systemId: string; purpose: 'construction' | 'analysis' } }) => {
    const targetProject = studioTarget?.project ?? active, targetTask = studioTarget?.task ?? activeTask;
    if (!targetProject || !targetTask) return;
    const projectId = targetProject.id, taskId = targetTask.id, key = taskKey(projectId, taskId), targetUI = uiRef.current[key];
    const targetBusy = targetUI?.status === 'running' || targetUI?.status === 'stopping' || targetUI?.posting || targetUI?.opening || Boolean(targetUI?.uiRequests.length);
    if (targetProject.archivedAt || projectActionId === projectId || carryingTasks[key] || !text.trim() || targetBusy || capabilityUpdating || targetUI?.uncertainPersonalSend || !targetUI?.connected || targetUI.status === 'connecting' || pending.current.has(key)) return;
    const personal = personalOverride ?? personalContexts[key] ?? [], targetCase = caseContexts[key], targetEnterprise = enterpriseMaterials[key] ?? [], targetData = projectDataSelections[key] ?? [];
    const targetEnterpriseCase = targetCase && enterpriseCases[key]?.caseId === targetCase.record.id ? enterpriseCases[key] : undefined;
    const requestId = crypto.randomUUID(), command = text.trim().startsWith('/');
    const context = studioTarget?.context ?? studioTaskContexts[key] ?? targetTask.studioContext;
    const messageArgs: Parameters<typeof sendMessage> = structuredClone([projectId, taskId, text, requestId, targetCase?.selection, requirementContexts[key], targetEnterprise.length ? targetEnterprise : undefined, targetEnterpriseCase, feedbackContexts[key], targetData.length ? targetData : undefined, personal.map(item => item.selection), context]);
    pending.current.add(key);
    changeUI(key, old => ({ ...old, posting: true, status: 'running', error: undefined, unavailablePersonal: undefined, notice: undefined, commandResult: undefined, streaming: '', finalReceived: false, requestId, failedPrompt: text, optimistic: command ? undefined : text }));
    const inflightDraft = draftQueues.current.get(key);
    if (inflightDraft) await inflightDraft.catch(() => {});
    const draftVersionBeforeSend = draftVersions.current.get(key) ?? 0;
    const clearLocalDraftIfUnchanged = () => {
      if ((draftVersions.current.get(key) ?? 0) !== draftVersionBeforeSend || draftQueues.current.has(key)) return;
      updateTask(projectId, taskId, task => ((command ? task.draft.trim() === text.trim() : task.draft === text) ? { ...task, draft: '' } : task));
    };
    try {
      if (command) {
        const operation = runCommand(projectId, taskId, text.trim(), requestId);
        changeUI(key, old => ({ ...old, posting: false }));
        const result = await operation;
        writeRejectedSend(projectId, taskId, null);
        clearLocalDraftIfUnchanged();
        applySnapshot(key, result.snapshot);
        changeUI(key, old => ({ ...old, commandResult: result.result == null ? undefined : typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2), status: 'idle', requestId: undefined, failedPrompt: old.failedPrompt === text ? undefined : old.failedPrompt }));
      } else {
        await sendMessage(...messageArgs);
        writeRejectedSend(projectId, taskId, null);
        clearLocalDraftIfUnchanged();
        changeUI(key, old => ({ ...old, failedPrompt: old.failedPrompt === text ? undefined : old.failedPrompt }));
      }
    }
    catch (error) {
      let definitelyRejected = error instanceof HostRequestError && error.accepted === false &&
        (Boolean(error.status && error.status >= 400 && error.status < 500) ||
          error.status === 500 && error.code === 'sdk_operation_failed');
      let verifiedRejectionMessage: string | undefined;
      let accepted = false, recoveredStatus: 'idle' | 'running' | undefined, recoveredLastRunId: string | null = targetTask.lastRun?.id ?? null;
      try {
        const restored = await refreshTask(projectId, taskId);
        if (rejectedNativeStart(restored, requestId)) {
          definitelyRejected = true;
          verifiedRejectionMessage = lastRunError(restored.task);
        }
        accepted = !definitelyRejected && requestAcceptedInSnapshot(restored, requestId);
        recoveredStatus = restored.snapshot.status;
        recoveredLastRunId = restored.task.lastRun?.id ?? null;
      } catch {}
      const unavailable = !accepted && error instanceof HostRequestError && error.unavailablePersonalContext?.every(index => index < personal.length) ? error.unavailablePersonalContext.map(index => personal[index]!.selection) : undefined;
      const uncertainPersonalSend = !command && personal.length > 0 && !accepted && !definitelyRejected ? { args: messageArgs } : undefined;
      const rejectedMessage = verifiedRejectionMessage ?? (definitelyRejected ? `发送未获 Host 接受：${safeError(error)} 原消息已保留在输入框，未计入已发送对话；可修改后发送或点击重试。` : undefined);
      if (accepted) {
        writeRejectedSend(projectId, taskId, null);
        clearLocalDraftIfUnchanged();
      } else if (definitelyRejected || personal.length > 0 || error instanceof HostRequestError) {
        if ((draftVersions.current.get(key) ?? 0) === draftVersionBeforeSend && !draftQueues.current.has(key)) {
          await persistDraft(projectId, taskId, text).catch(() => {});
        }
        if (definitelyRejected && rejectedMessage) {
          writeRejectedSend(projectId, taskId, { code: error instanceof HostRequestError ? error.code : 'host_request_failed', message: rejectedMessage, lastRunId: recoveredLastRunId, at: new Date().toISOString() });
        }
      }
      changeUI(key, old => ({
        ...old,
        uncertainPersonalSend,
        unavailablePersonal: unavailable,
        status: recoveredStatus ?? (error instanceof HostRequestError ? 'idle' : 'connecting'),
        requestId: accepted ? old.requestId : undefined,
        error: accepted ? old.error : rejectedMessage ?? (error instanceof HostRequestError ? safeError(error) : '发送状态尚未确认，请重新连接任务核对；不会自动重发。'),
        failedPrompt: accepted || !(error instanceof HostRequestError) ? undefined : text,
        optimistic: accepted || definitelyRejected ? undefined : old.optimistic,
      }));
    }
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
      if (!requestAcceptedInSnapshot(restored, uncertain.args[3])) throw new HostRequestError('原请求尚未在此任务中核对，状态仍为 UNKNOWN；保留原标识与选择。');
      changeUI(key, old => ({ ...old, uncertainPersonalSend: undefined, error: lastRunError(restored.task), failedPrompt: savedRun?.status === 'failed' ? uncertain.args[2] : undefined, optimistic: undefined, notice: '已按原标识回读任务实际状态与保存消息；没有新建运行或重复加入问题。' }));
    }
    catch (error) { changeUI(key, old => ({ ...old, error: safeError(error) })); }
    finally { pending.current.delete(key); changeUI(key, old => ({ ...old, posting: false })); }
  };
  const respond = async (projectId: string, taskId: string, response: BrowserUIResponse) => { await answerInteraction(projectId, taskId, response); changeUI(taskKey(projectId, taskId), old => ({ ...old, uiRequests: (old.uiRequests ?? []).filter(request => request.id !== response.id), deferredRequestId: old.deferredRequestId === response.id ? undefined : old.deferredRequestId })); };
  const openSettings = (trigger?: HTMLButtonElement) => openSettingsView('settings', trigger);
  const openTaskServiceConnections = () => {
    if (!active || !activeTask) { openWorkspace('projects'); return; }
    const key = taskKey(active.id, activeTask.id);
    selectContext(active.id, activeTask.id);
    // This explicit action opens account permissions; ordinary settings Back retains the report.
    setTaskPanelByTask(previous => ({ ...previous, [key]: 'chat' }));
    setView('chat');
    requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLDetailsElement>('details.task-account-panel');
      if (panel) panel.open = true;
      textarea.current?.focus();
    });
  };
  const backFromSettings = () => {
    const target = settingsReturnView.current;
    setView(target);
    requestAnimationFrame(() => {
      const trigger = settingsTrigger.current;
      if (trigger?.isConnected && trigger.getClientRects().length) { trigger.focus(); return; }
      const modelButton = target === 'chat' ? document.querySelector<HTMLButtonElement>('.model-button') : null;
      (modelButton ?? sidebarToggle.current)?.focus();
    });
  };
  const refreshProjects = async () => { const saved = await listProjects(); for (const project of saved) mergeProject(project); };
  const boardTask = async (project: ClientProject, task: ClientTask, selection?: CaseContextSelection) => {
    const key = taskKey(project.id, task.id);
    try {
      setTaskPanelByTask(previous => ({ ...previous, [key]: 'chat' }));
      if (!selection) {
        setActiveTaskSourceCase(undefined);
        await chooseTask(project, task, false);
        setReportCaseReturn(undefined);
        return;
      }
      const detail = await caseClient.detail(selection.caseId);
      if (detail.case.revision !== selection.caseRevision) throw new caseClient.CaseRequestError('revision_conflict', 409);
      setActiveTaskSourceCase({ taskKey: key, caseId: detail.case.id, caseTitle: detail.case.title });
      await chooseTask(project, task, false, { selection, record: detail.case, work: project.work ?? null });
      setReportCaseReturn(undefined);
    } catch (error) { setGlobalError(error instanceof Error ? error.message : 'Case背景未能读取，请刷新后核对。'); }
  };
  const openFeedbackTask = async (target: { projectId: string; taskId: string; handoffId: string }) => { const value = await readTaskForNavigation(target.projectId, target.taskId); setActiveTaskSourceCase(undefined); mergeProject(value.project); await chooseTask(value.project, value.task, false); };
  const generatePptx = async (project: ClientProject, file: { name: string; path: string }) => {
    const task = await createDiskTask(project.id, `PPT 生成 · ${file.name.replace(/\.md$/i, '')}`, undefined);
    setProjects(previous => previous.map(item => item.id === project.id ? { ...item, tasks: [...item.tasks, task] } : item));
    setActiveTaskSourceCase(undefined);
    await chooseTask(project, task);
    await persistDraft(project.id, task.id, `请读取 060_reports 正式报告 ${file.path}，使用 ppt-report skill 生成候选版 PPTX（保存到 060_reports 同目录，文件名加 _候选版）。数字必须逐字来自该报告，版式遵循 skill 规范。`);
  };
  const startFeedbackAnalysis = (source: FeedbackReviewStart) => { setFeedbackReview(source); openWorkspace('decision'); };
  const openHomeFoundation = (id: HomeFoundationId) => {
    if (id === 'strategy') showManagement({ area: 'strategy', stage: 'co-create' });
    else if (id === 'goals') showManagement({ area: 'gsa', stage: 'goals' });
    else if (id === 'semantic') openStudioLibrary('semantic');
    else openStudioLibrary('analytics');
  };
  const openHomeCase = (caseId: string, issueId?: string) => {
    setHelpOpen(false);
    setCaseCreatePending(false);
    setCaseFocus(caseId);
    setCaseFocusSeq(seq => seq + 1);
    setCaseIssueFocus(issueId);
    setReportCaseReturn(undefined);
    lastWorkspace.current = 'cases';
    setView('cases');
  };
  const openHomeCreateCase = () => {
    setHelpOpen(false);
    setCaseFocus(undefined);
    setCaseIssueFocus(undefined);
    setCaseCreatePending(true);
    lastWorkspace.current = 'cases';
    setView('cases');
  };
  const openHomeProject = (projectId: string) => {
    setCaseProjectTarget(projectId);
    setProjectFocusSeq(seq => seq + 1);
    openWorkspace('projects');
  };
  const openHomeTask = async (projectId: string, taskId: string, sourceCase?: { caseId: string; caseTitle?: string }, initialPanel: 'chat' | 'report' = 'chat') => {
    try {
      const existingProject = projects.find(item => item.id === projectId);
      const existingTask = existingProject?.tasks.find(item => item.id === taskId);
      const key = taskKey(projectId, taskId);
      setActiveTaskSourceCase(sourceCase ? { taskKey: key, ...sourceCase } : undefined);
      setTaskPanelByTask(previous => ({ ...previous, [key]: initialPanel }));
      if (existingProject && existingTask) { await chooseTask(existingProject, existingTask, false); return; }
      const value = await readTaskForNavigation(projectId, taskId);
      mergeProject(value.project);
      await chooseTask(value.project, value.task, false);
    } catch (error) { setGlobalError(safeError(error)); }
  };
  const openHomeReport = async (target: WorkspaceHomeReportTarget) => {
    const key = taskKey(target.projectId, target.taskId);
    setInspectedReport({ key, version: { relativePath: target.relativePath, sha256: target.sha256, textStatus: 'utf8', reviewable: true, current: false } });
    setAutoOpenReportKey(key);
    setReportPreviewOpenByTask(previous => ({ ...previous, [key]: true }));
    setDeskStateByTask(previous => ({ ...previous, [key]: { selectedReportKey: `${target.relativePath}#${target.sha256}` } }));
    setTaskInspector(undefined);
    setFilesOpen(false);
    await openHomeTask(target.projectId, target.taskId, { caseId: target.caseId, caseTitle: target.caseTitle }, 'report');
  };
  const handleSearchSelect = (target: WorkspaceSearchTarget) => {
    if (target.kind === 'view') {
      if (target.view === 'help') { setHelpOpen(true); return; }
      if (target.view === 'projects') setCaseProjectTarget(undefined);
      openWorkspace(target.view);
      return;
    }
    if (target.kind === 'foundation') { openHomeFoundation(target.foundation); return; }
    if (target.kind === 'settings') { openSettingsView(target.settingsView); return; }
    if (target.kind === 'case') { openHomeCase(target.caseId); return; }
    if (target.kind === 'project') { openHomeProject(target.projectId); return; }
    void openHomeTask(target.projectId, target.taskId, undefined, 'chat');
  };
  const pageTitle = view === 'home' ? '工作台首页' : view === 'foundation' ? '基础建设总览' : view === 'project-plan' ? '项目需求与任务方案' : view === 'goals' ? managementTitle(management) : view === 'studio' ? studioLibraryTitle(studioLibraryArea) : view === 'cases' ? 'Decision Case · Case 总览' : view === 'projects' ? '项目地图' : view === 'chat' ? active ? activeTask ? `${active.name} / ${activeTask.name}` : active.name : '项目工作台' : inSettings ? '设置' : view === 'decision' ? '决策工作台' : view === 'requirement' ? '需求梳理' : view === 'refiner' ? 'PPT 逐页精修' : view === 'simlab' ? '经营推演' : view === 'model-pack' ? '模型注册表' : '项目工作台';
  const returnView = settingsReturnView.current, settingsBackLabel = returnView === 'home' ? '返回工作台首页' : returnView === 'foundation' ? '返回基础建设总览' : returnView === 'project-plan' ? '返回项目需求方案' : returnView === 'goals' ? '返回' + managementTitle(management) : returnView === 'studio' ? '返回Studio资产体系' : returnView === 'cases' ? '返回决策星图' : returnView === 'projects' ? '返回项目地图' : returnView === 'chat' ? '返回项目空间' : returnView === 'decision' ? '返回决策工作台' : returnView === 'requirement' ? '返回需求梳理' : returnView === 'refiner' ? '返回PPT 逐页精修' : returnView === 'simlab' ? '返回经营推演' : returnView === 'model-pack' ? '返回模型注册表' : '返回当前工作';
  const messages = messagesOf(current?.snapshot), lastAssistant = [...messages].reverse().find(message => message.role === 'assistant' && messageText(message));
  const currentStatus = current?.observation?.message && current.observation.state !== 'connected' ? current.observation.message : current?.snapshot?.cleanupRequestId ? '上次运行的资源清理未完成，可重新连接任务。' : question ? 'Pi 等待你的回应' : current?.opening ? '正在打开任务' : current?.status === 'running' ? current.toolStatus ?? 'Pi 正在回复' : current?.status === 'stopping' ? '正在停止' : !current?.connected ? '任务连接待恢复' : current.draftSaving ? '正在保存草稿…' : '任务和历史已保存在本机';
  const renderAssistantText = (text: string) => view === 'chat' ? <StrategyDiscussionReply text={text} /> : text;
  const conversationItems = groupConversation(messages, { includeToolDetails: true });
  const conversationFoldKey = active && activeTask ? `task:${active.id}/${activeTask.id}` : 'task:unbound';
  const renderConversationItem = (item: ConversationItem) => {
    if (item.kind === 'process') {
      const suggestions = active ? item.entries.map(entry => freezeSuggestionFor(messages, entry.index, active.id)).filter((suggestion): suggestion is FreezeSuggestion => Boolean(suggestion)) : [];
      return <div key={item.identity} className="process-group-slot">
        <ProcessGroup conversationKey={conversationFoldKey} identity={item.identity} steps={item.steps} entries={item.entries} />
        {suggestions.map(suggestion => <section key={suggestion.runId} className="task-link-card" aria-label="固化建议"><div><strong>Agent 固化建议 · {suggestion.runId}</strong><p>{suggestion.reason}</p><small>方案 {suggestion.variantId} · 草稿 rev {suggestion.draftRevision} · 仅为建议，固化状态以页面回执为准</small></div><button className="secondary-button" onClick={() => { rememberCapabilityReturn('simlab'); setSimlabTarget(suggestion); setHelpOpen(false); setView('simlab'); }}>查看建议并固化</button></section>)}
      </div>;
    }
    const entry = item.message, index = item.index;
    const semanticRecords = entry.role === 'assistant' && active && activeTask ? semanticRecordsForAssistant(messages, index, current?.snapshot?.sessionId, { projectId: active.id, taskId: activeTask.id }) : [];
    const text = messageText(entry);
    if (item.kind === 'custom') return <article key={item.identity} className="message custom"><div className="message-author"><BrandMark small /><strong>Pi 扩展</strong><span>扩展消息</span></div>{text && <div className="message-content">{text}</div>}</article>;
    if (item.kind === 'user') return <article key={item.identity} className="message user"><div className="message-author"><span className="user-mark">你</span><strong>你</strong></div>{text && <Foldable className="message-content" conversationKey={conversationFoldKey} identity={item.identity} lines={3}>{text}</Foldable>}{typeof entry.originalUserText === 'string' && <details className="eb-native-context"><summary>随问题发送的完整上下文</summary><pre>{nativeMessageText(entry)}</pre></details>}</article>;
    return <article key={item.identity} className={`message ${entry.role}`}><AgentAuthor model={activeTask?.configuration.model} />
      {text && (unconfirmedReplies.current.has(entry) || isPartialAssistantReply(entry)
        ? <div className="message-content">{renderAssistantText(text)}</div>
        : <Foldable className="message-content" conversationKey={conversationFoldKey} identity={item.identity} lines={5}>{renderAssistantText(text)}</Foldable>)}
      {entry.role === 'assistant' && text && active && activeTask && <SemanticContextPanel projectId={active.id} taskId={activeTask.id} sessionId={entry.nativeSessionId ?? current?.snapshot?.sessionId} messageId={entry.nativeEntryId} records={semanticRecords} onFollowup={!archived && !current?.uncertainPersonalSend && !current?.posting && projectActionId !== active.id ? draft => { const next = [activeTask.draft.trim(), draft].filter(Boolean).join('\n\n'); if (next.length > 20000) { setGlobalError('追问未加入：当前草稿加上补充内容超过输入长度，原草稿保持。'); return; } void persistDraft(active.id, activeTask.id, next); requestAnimationFrame(() => requestAnimationFrame(() => textarea.current?.focus())); } : undefined} />}
      {entry.role === 'assistant' && text && <div className="report-action-row"><button type="button" className="text-button" disabled={!entry.nativeEntryId || !entry.nativeSessionId} title={!entry.nativeEntryId ? '等待原生回复保存并核对准确身份' : undefined} onClick={() => { void organizeReply(entry, 'knowledge'); }}>整理为知识</button><button type="button" className="text-button" disabled={!entry.nativeEntryId || !entry.nativeSessionId} onClick={() => { void organizeReply(entry, 'experience'); }}>整理为经验</button></div>}
      {entry.role === 'assistant' && text && active && activeTask && <div className="report-action-row"><button type="button" className="text-button" disabled={busy || !entry.nativeEntryId || !entry.nativeSessionId} title={!entry.nativeEntryId || !entry.nativeSessionId ? '等待原生回复保存并重读准确身份；不伪造来源。' : undefined} onClick={() => setStudioFeedback({ project: active, task: activeTask, message: entry })}>反馈到资产体系</button>{!archived && <button type="button" className="text-button" disabled={busy || !entry.nativeEntryId || !entry.nativeSessionId} onClick={() => void organizeReply(entry, 'goal')}>带这条原回复核对目标</button>}</div>}
      <AssistantOutcome message={entry} />
      {entry.role === 'assistant' && activeTask?.feedbackOrigin && text && <div className="report-action-row"><button type="button" className="text-button" disabled={archived || busy || !entry.nativeEntryId || !entry.nativeSessionId} title={!entry.nativeEntryId ? '等待保存后重读真实回复身份，或明确保存为报告后选择' : undefined} onClick={() => setFeedbackNextSource({ kind: 'reply', message: entry })}>基于这条回复梳理新需求</button></div>}
    </article>;
  };
  const selectStudioConstruction = async (system: StudioSystem, supplied?: StudioWorkspace) => {
    const selection = ++studioSelectionEpoch.current, value = supplied ?? await readStudioWorkspace(system.id);
    if (selection !== studioSelectionEpoch.current) return;
    const owner = studioExecutionOwner(value.system);
    if (value.system.id !== system.id || value.project.id !== owner.projectId || value.task.id !== owner.taskId) throw new HostRequestError('体系与当前建设任务归属未能核对，原会话保持。');
    mergeProject(value.project); setStudioTaskContexts(previous => ({ ...previous, [taskKey(owner.projectId, owner.taskId)]: { systemId: system.id, purpose: 'construction' } }));
    if (value.snapshot) applySnapshot(taskKey(owner.projectId, owner.taskId), value.snapshot);
    if (activeId !== owner.projectId || activeTaskId !== owner.taskId || !uiRef.current[taskKey(owner.projectId, owner.taskId)]?.connected) await chooseTask(value.project, value.task, false, undefined, 'studio', false, system.id);
    else selectContext(owner.projectId, owner.taskId, system.id);
  };
  const runStudioConstruction = async (system: StudioSystem, initial: boolean, goal?: string) => {
    const value = await readStudioWorkspace(system.id);
    await selectStudioConstruction(system, value);
    if (value.project.archivedAt) throw new HostRequestError('当前建设项目已归档，请在 Studio 选择获准新任务接续；原会话保持只读。');
    const targetKey = taskKey(value.project.id, value.task.id);
    if (value.running || uiRef.current[targetKey]?.status === 'running' || pending.current.has(targetKey)) throw new HostRequestError('原建设任务正在运行，请在同一会话查看进展；没有另开运行或重放旧请求。');
    if (!uiRef.current[targetKey]?.connected || uiRef.current[targetKey]?.status === 'connecting') throw new HostRequestError('体系记录已保留，原建设任务连接尚未就绪。请在原会话重新连接后明确继续；本次没有发送模型请求。');
    const topic = system.topics.find(item => item.id === system.currentTopicId);
    const text = initial ? `请开始本体系本轮建设。目标：${topic?.goal || '依据用户已表达的目标继续'}。请阅读本轮明确选用的获准资料，盘点已有资产并优先复用，实际建设和核查必要源稿、映射、指标与方法；资料无法决定的实质问题集中提问，准备明确版本与范围的正式发布预览。由你自主选择方法和按需协作，不另建固定专家流水线。` : '请读取本体系已保存的目标、成果、准确来源、待处理反馈与未完成事项，按实际影响接续原建设。先核对未知副作用，不重放旧发布，不重启全部专家；已有明确答案沿用，只有实质业务问题与正式发布需要必要确认。';
    await send(goal?.trim() || text, false, undefined, { project: value.project, task: value.task, context: { systemId: system.id, purpose: 'construction' } });
  };
  const openStudioAnalysisTarget = async (value: unknown, systemId: string, projectId: string) => {
    const target = checkedStudioAnalysisTarget(value, systemId, projectId), exact = await readTaskForNavigation(target.project.id, target.task.id);
    if (exact.project.id !== target.project.id || exact.task.id !== target.task.id) throw new HostRequestError('新分析任务归属未能核定，未切换会话。');
    mergeProject(exact.project); applySnapshot(taskKey(exact.project.id, exact.task.id), exact.snapshot);
    setStudioTaskContexts(previous => ({ ...previous, [taskKey(exact.project.id, exact.task.id)]: { systemId, purpose: 'analysis' } }));
    await chooseTask(exact.project, exact.task, false, undefined, 'chat', true);
    setGlobalNotice('已在原项目创建普通分析任务并关联准确体系；只预填草稿，尚未发送模型请求。');
  };
  const useStudioSystem = async (system: StudioSystem, projectId: string) => {
    if (studioUsePending) throw new HostRequestError('上次进入分析的结果尚未核定，请先核对原请求；未再次创建任务。');
    const requestId = crypto.randomUUID();
    try { const value = await studioRequest(`systems/${encodeURIComponent(system.id)}/use`, 'POST', { requestId, projectId }); await openStudioAnalysisTarget(value, system.id, projectId); }
    catch (error) { if (error instanceof StudioRequestError && error.uncertain) setStudioUsePending({ requestId, systemId: system.id, projectId }); throw error; }
  };
  const inspectStudioUse = async () => {
    if (!studioUsePending) return;
    try { const operation = await readStudioOperation(studioUsePending.requestId);
      if (operation.status === 'unknown') { setGlobalNotice('原进入分析请求仍为UNKNOWN，未重复创建任务。'); return; }
      if (operation.status === 'failed') { setStudioUsePending(undefined); setGlobalError(operation.error || '已核原请求失败，原体系保持。'); return; }
      if (!operation.result) throw new HostRequestError('原请求虽记成功，创建任务的准确回执尚未完整返回，继续核对，勿猜测任务。');
      await openStudioAnalysisTarget(operation.result, studioUsePending.systemId, studioUsePending.projectId); setStudioUsePending(undefined);
    } catch (error) { setGlobalError(error instanceof Error ? error.message : '原请求结果尚未核定。'); }
  };
  const openTaskCapability = (destination: TaskCapabilityDestination) => {
    if (!active || !activeTask) return;
    if (destination === 'plan') openProjectPlan(active);
    else if (destination === 'requirement') openTaskRequirements();
    else if (destination === 'reports' || destination === 'connections') openProjectSources();
    else if (destination === 'permissions') { const panel = Array.from(document.querySelectorAll<HTMLDetailsElement>('details.task-pi-capabilities')).find(value => value.getClientRects().length > 0); if (panel) { panel.open = true; panel.scrollIntoView({ block: 'nearest' }); } else setGlobalNotice('本任务只读；原能力设置保留，恢复原任务后可核对启用。'); }
    else openCapability(destination);
  };
  const showManagement = (route: ManagementRoute, source?:CaseCreationSource, review?:import('../business-role-types.ts').TeachReviewOwner) => {
    setView('goals', () => {
      setCaseSource(source); setTeachReview(review); setManagement(route); setFilesOpen(false); setHelpOpen(false);
      lastWorkspace.current='goals'; if (window.innerWidth <= 760) setSidebarOpen(false);
    });
  };
  const switchManagementStage = (stage: ManagementStage) => { if(stage==='goals'||stage==='adopt'||stage==='cases'||stage==='history') setManagement({area:'gsa',stage}); else setManagement({area:'strategy',stage}); };
  const currentTaskSourceCase = selectedCase
    ? { caseId: selectedCase.record.id, caseTitle: selectedCase.record.title }
    : activeKey && activeTaskSourceCase?.taskKey === activeKey
      ? { caseId: activeTaskSourceCase.caseId, caseTitle: activeTaskSourceCase.caseTitle }
      : undefined;
  const currentTaskPanel: 'chat' | 'report' = view === 'chat' && activeKey ? (taskPanelByTask[activeKey] ?? 'chat') : 'chat';
  useEffect(() => {
    if (view !== 'chat' || !activeId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('project') !== activeId || url.searchParams.get('task') !== (activeTaskId ?? null)) return;
    const reportOpen = Boolean(activeTaskId && currentTaskPanel === 'report');
    const location = {
      case: activeTaskId && currentTaskSourceCase?.caseId,
      panel: reportOpen ? 'report' : undefined,
      report: reportOpen ? inspectedVersion?.relativePath : undefined,
      sha256: reportOpen ? inspectedVersion?.sha256 : undefined,
    };
    for (const [key, value] of Object.entries(location)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    if (url.href !== window.location.href) window.history.replaceState(null, '', url);
  }, [view, activeId, activeTaskId, currentTaskPanel, currentTaskSourceCase?.caseId, inspectedVersion?.relativePath, inspectedVersion?.sha256]);
  const switchTaskPanel = (panel: 'chat' | 'report') => {
    if (!activeKey) return;
    setTaskPanelByTask(previous => ({ ...previous, [activeKey]: panel }));
    if (panel === 'report') {
      setTaskInspector(undefined);
      setFilesOpen(false);
    }
  };
  const chatContent = active && activeTask ? (view === 'chat' && currentTaskPanel === 'report' ? (
    <TaskReportDesk
      key={`desk-${activeKey}`}
      projectId={active.id}
      projectName={active.name}
      taskId={activeTask.id}
      taskName={activeTask.name}
      taskTypeLabel={activeTask.assignment ? taskPurpose[activeTask.assignment.type].label : undefined}
      initialReport={inspectedVersion}
      sourceCase={currentTaskSourceCase}
      persistedState={activeKey ? deskStateByTask[activeKey] : undefined}
      onPersistedStateChange={next => {
        if (!activeKey) return;
        setDeskStateByTask(previous => ({ ...previous, [activeKey]: next }));
      }}
      onReportChange={version => {
        setInspectedReport(activeKey && version ? { key: activeKey, version } : undefined);
      }}
      onSwitchToChat={() => switchTaskPanel('chat')}
      onOpenProject={() => openHomeProject(active.id)}
      onOpenCase={caseId => {
        setAutoOpenReportKey(undefined);
        setCaseFocus(caseId);
        setCaseFocusSeq(seq => seq + 1);
        setCaseIssueFocus(undefined);
        setReportCaseReturn({ caseId, projectId: active.id, taskId: activeTask.id });
        lastWorkspace.current = 'cases';
        setView('cases');
      }}
      onOpenFiles={trigger => openTaskFiles(trigger)}
      onOpenConclusionReview={trigger => {
        inspectorTrigger.current = trigger;
        selectInspector('conclusion');
      }}
    />
  ) : <div className={`chat-page ${view === 'chat' ? 'analysis-chat-page' : ''} ${messages.length || current?.streaming || current?.optimistic ? 'has-messages' : ''}`}>
        {view !== 'studio' && (
          <div className="task-mode-strip" role="region" aria-label="任务视图与来源">
            <div className="task-mode-strip-inner">
              <div className="task-mode-tabs" role="group" aria-label="任务工作视图">
                <button type="button" aria-pressed={true} onClick={() => switchTaskPanel('chat')}>
                  <span className="pv-chat-icon" aria-hidden="true" />
                  任务对话
                </button>
                <button type="button" aria-pressed={false} onClick={() => switchTaskPanel('report')}>
                  <span className="pv-paper-icon" aria-hidden="true" />
                  结论报告
                </button>
              </div>
              {currentTaskSourceCase && (
                <div className="task-mode-source-case">
                  <span>来源 Case · <strong>{currentTaskSourceCase.caseTitle || currentTaskSourceCase.caseId}</strong></span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setCaseFocus(currentTaskSourceCase.caseId);
                      setCaseFocusSeq(seq => seq + 1);
                      setCaseIssueFocus(undefined);
                      setReportCaseReturn({ caseId: currentTaskSourceCase.caseId, projectId: active.id, taskId: activeTask.id });
                      lastWorkspace.current = 'cases';
                      setView('cases');
                    }}
                  >
                    返回来源 Case
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {view !== 'studio' && <TaskUsageContext projectId={active.id} task={activeTask} providedContext={current?.snapshot?.capabilities?.semanticContext} />}
        {archived && <div className="archive-banner" role="status"><span>{active.archivedAt ? '项目' : '任务'}已归档，当前为只读查看。</span><button className="secondary-button" disabled={Boolean(projectActionId)} onClick={() => { if (active.archivedAt) void projectAction(active, 'restore'); else void taskArchiveAction(true); }}>恢复原记录</button></div>}
        {view !== 'studio' && <><TaskWorkflow projectName={active.name} taskName={activeTask.name} status={archived ? '已归档 · 只读' : currentStatus} busy={busy} hasMessages={Boolean(messages.length)} hasReply={Boolean(lastAssistant)} requirementTitle={attachedRequirement?.title} onFiles={openTaskFiles} onRequirements={openTaskRequirements} onAnalyze={() => { textarea.current?.focus(); }} onResults={() => { resultsPanel.current?.scrollIntoView({ block: 'nearest' }); resultsPanel.current?.focus({ preventScroll: true }); }} /><div className="task-workflow"><button type="button" className="text-button" disabled={busy || Boolean(active.archivedAt)} onClick={() => { void taskArchiveAction(Boolean(activeTask.archivedAt)); }}>{activeTask.archivedAt ? '恢复原任务' : '归档此任务'}</button></div></>}
        {view !== 'studio' && <TaskCapabilityNavigation onOpen={openTaskCapability} />}
        <ConversationDrawer key={activeKey} title={view === 'studio' ? '资产建设 Agent' : '任务对话 · ' + activeTask.name} className="workspace-conversation-task">
        {!messages.length && !current?.streaming && !current?.optimistic ? <p className="task-start-hint">{archived ? '此任务尚无对话，恢复原记录后可继续。' : '从一个问题开始，告诉 Pi 你想了解什么。'}</p> : <div className="message-scroll"><div className="messages" role="log" aria-label="对话记录" aria-live="off">{conversationItems.map(renderConversationItem)}{current?.optimistic && <article className="message user"><div className="message-author"><span className="user-mark">你</span><strong>你</strong><span>正在确认发送</span></div><div className="message-content">{current.optimistic}</div></article>}{current?.streaming && <article className="message assistant streaming-message"><AgentAuthor model={activeTask.configuration.model} status="正在回复" /><div className="message-content">{renderAssistantText(current.streaming)}</div></article>}{busy && !current?.streaming && <p className="run-progress" role="status">{current?.toolStatus ?? (current?.opening ? '正在打开任务…' : 'Pi 正在处理…')}</p>}<div ref={end} /></div></div>}
        <div className="composer-area">
          <details key={`context-${activeKey}`} className="task-context-options" open={selectedCase ? true : undefined}><summary>本次分析背景<span>{[selectedCase && 'Case', attachedRequirement && '需求', attachedEnterprise.length > 0 && '企业资料', attachedFeedback && '反馈'].filter(Boolean).join(' · ') || '按需选择'}</span></summary>
          {selectedCase && <div className="case-context-banner" role="status"><div><strong>本次背景：{selectedCase.record.title}</strong><span>Case v{selectedCase.selection.caseRevision} · 项目进度 v{selectedCase.selection.projectWorkRevision}</span><details><summary>查看本次背景</summary><p>{selectedCase.record.description || '尚未填写背景'}</p><p>判断与未知：{selectedCase.record.judgement || '尚未填写'}</p><p>下一步：{selectedCase.record.nextStep || '尚未填写'}</p><p>项目范围：{selectedCase.work?.workScope || '尚未填写'}；承接人：{selectedCase.work?.assignee || '尚未填写'}；项目下一步：{selectedCase.work?.nextStep || '尚未填写'}</p><p>已选引用：{selectedCase.selection.selectedReferenceIds.length} 项。此任务原有历史可能含其他 Case 信息；如需独立上下文，请在原项目新建任务。</p></details></div><button type="button" className="text-button" disabled={contextLocked} onClick={() => setCaseContexts(previous => { const next = { ...previous }; delete next[activeKey!]; return next; })}>改为项目独立发送</button></div>}
          {attachedRequirement && <div className="case-context-banner" role="status"><div><strong>{attachedRequirement.frameworkVersion ? '附带分析框架' : '附带需求契约'}：{attachedRequirement.title}</strong><span>实例 {attachedRequirement.instanceId} · {attachedRequirement.frameworkVersion ? `框架版本 ${attachedRequirement.frameworkVersion}` : attachedRequirement.version ? `RAP ${attachedRequirement.version}` : '已确认快照'} · 发送时注入结构化摘要</span></div><button type="button" className="text-button" disabled={contextLocked} onClick={() => setRequirementContexts(previous => { const next = { ...previous }; delete next[activeKey!]; return next; })}>移除附带</button></div>}
          <FeedbackContextPanel key={`feedback-${activeKey}`} project={active} task={activeTask} value={attachedFeedback} onChange={value => setFeedbackContexts(previous => ({ ...previous, [activeKey!]: value }))} disabled={contextLocked} filesRevision={filesRevision} onNextSource={setFeedbackNextSource} onNextAnalysis={startFeedbackAnalysis} onGoCase={caseId => { setCaseFocus(caseId); setCaseFocusSeq(seq => seq + 1); setView('cases'); lastWorkspace.current = 'cases'; }} onFilesChanged={() => setFilesRevision(previous => previous + 1)} />
          {activeTask.feedbackOrigin && <FeedbackReceiptHistory key={`feedback-history-${activeKey}`} projectId={active.id} taskId={activeTask.id} revision={current?.snapshot?.lastRun?.requestId ?? activeTask.lastRun?.id} />}
          {!archived && <EnterpriseMaterialPicker key={`enterprise-${activeKey}`} value={attachedEnterprise} onChange={value => setEnterpriseMaterials(previous => ({ ...previous, [activeKey!]: value }))} caseId={selectedCase?.record.id} caseValue={attachedEnterpriseCase} onCaseChange={value => setEnterpriseCases(previous => ({ ...previous, [activeKey!]: value }))} disabled={contextLocked} />}
          <PersonalContextSelectionNotice choices={attachedPersonal} disabled={busy || archived || Boolean(current?.uncertainPersonalSend)} onRemove={index => setPersonalContexts(previous => ({ ...previous, [activeKey!]: (previous[activeKey!] ?? []).filter((_value,at)=>at!==index) }))} onChange={(index,selection)=>setPersonalContexts(previous=>({...previous,[activeKey!]:(previous[activeKey!]??[]).map((item,at)=>at===index?{...item,selection}:item)}))} />
          <ProjectDataSelectionNotice value={attachedProjectData} disabled={contextLocked || archived} onOpen={openTaskFiles} onRemove={selectionKey => { const key = activeKey!; setProjectDataSelections(previous => ({ ...previous, [key]: (previous[key] ?? []).filter(item => projectDataSelectionKey(item) !== selectionKey) })); }} />
          <EnterpriseContextReceipt requestId={current?.snapshot?.lastRun?.requestId ?? activeTask.lastRun?.id} recordedRun={Boolean(current?.snapshot?.lastRun || activeTask.lastRun)} value={(current?.snapshot?.capabilities?.semanticContext as { enterprise?: unknown } | undefined)?.enterprise} />
          <EnterpriseContextHistory key={`enterprise-history-${activeKey}`} projectId={active.id} taskId={activeTask.id} />
          <PersonalContextHistory key={`personal-history-${activeKey}`} projectId={active.id} taskId={activeTask.id} requestId={current?.snapshot?.lastRun?.requestId ?? activeTask.lastRun?.id}  completionKey={`${current?.snapshot?.lastRun?.outcome ?? activeTask.lastRun?.status ?? ''}:${current?.status ?? ''}:${current?.snapshot?.status ?? ''}`} />
          <ProjectDataContextHistory key={`project-data-history-${activeKey}`} projectId={active.id} taskId={activeTask.id} requestId={current?.snapshot?.lastRun?.requestId ?? activeTask.lastRun?.id} currentValue={(current?.snapshot?.capabilities?.semanticContext as { projectData?: unknown } | undefined)?.projectData} />
          </details>
          {!archived && question && current?.deferredRequestId === question.id && <div className="pi-pending-notice" role="status"><span>Pi 等待回应：{question.title}</span><button className="secondary-button" onClick={() => changeUI(activeKey!, old => ({ ...old, deferredRequestId: undefined }))}>回应 Pi</button></div>}
          {current?.observation?.message && current.observation.state !== 'connected' && <div className="pi-pending-notice" role="status"><span>{current.observation.message}</span>{current.observation.state === 'disconnected' && <button className="secondary-button" onClick={() => { void reconnect(active.id, activeTask.id); }}>恢复任务观察</button>}</div>}
          {current?.uncertainPersonalSend && <section className="pr-note pr-warning" role="alert"><strong>此次发送状态 UNKNOWN</strong><p>原问题、准确选择与请求标识已保留。先读取原任务状态，核对期间不发新请求、不更改选材。</p><code>{current.uncertainPersonalSend.args[3]}</code><div className="pr-row"><button type="button" className="secondary-button" disabled={current.posting} onClick={() => { void inspectPersonalSend(active.id, activeTask.id); }}>核对此次发送</button>{!archived && <button type="button" className="text-button" disabled={current.posting} onClick={() => { void retryPersonalSend(active.id, activeTask.id); }}>按原请求重试此次发送</button>}</div></section>}
          {current?.unavailablePersonal && current.unavailablePersonal.length > 0 && !archived && <section className="pr-note pr-warning" role="alert"><strong>请求尚未接受，以下指定资料不可用</strong><ul>{current.unavailablePersonal.map(selection => <li key={JSON.stringify(selection)}>{attachedPersonal.find(item => JSON.stringify(item.selection) === JSON.stringify(selection))?.title ?? '原指定资料'}<details><summary>准确目标</summary><pre>{JSON.stringify(selection, null, 2)}</pre></details></li>)}</ul><p>问题与选择已保留。你可核对原资料，或明确移除这些资料后发送。</p><button type="button" className="secondary-button" disabled={busy} onClick={() => { const unavailable = new Set(current.unavailablePersonal!.map(item => JSON.stringify(item))), remaining = attachedPersonal.filter(item => !unavailable.has(JSON.stringify(item.selection))); setPersonalContexts(previous => ({ ...previous, [activeKey!]: remaining })); void send(activeTask.draft, false, remaining); }}>移除不可用资料并发送</button></section>}
          {current?.error && <div className="error-notice" role="alert"><Icon name="warning" /><div><strong>任务状态提示</strong><p>{current.error}</p></div>{!archived && current.failedPrompt && !current.uncertainPersonalSend && !current.unavailablePersonal?.length && !busy && <button className="secondary-button" onClick={() => { void send(activeTask.draft || current.failedPrompt, true); }}>重试本次消息</button>}<button className="text-button" disabled={current?.posting} onClick={() => { void reconnect(active.id, activeTask.id); }}>重新连接任务</button>{!archived && <button className="text-button" onClick={event => openSettings(event.currentTarget)}>模型设置</button>}</div>}
          {current?.notice && <p className="message-meta" role="status">{current.notice}</p>}{current?.extensionStatus && Object.keys(current.extensionStatus).length > 0 && <div className="pi-extension-status" role="status">{Object.entries(current.extensionStatus).map(([key, text]) => <p key={key}>{text}</p>)}</div>}{current?.commandResult && <details className="command-result" open><summary>Pi 命令结果</summary><pre>{current.commandResult}</pre></details>}
          {!archived && <><form className="composer" onSubmit={event => { event.preventDefault(); void send(); }} aria-label="发送消息"><label className="sr-only" htmlFor="message-input">消息</label><textarea ref={textarea} id="message-input" value={activeTask.draft} rows={3} readOnly={Boolean(current?.uncertainPersonalSend)} placeholder="今天想讨论什么？" maxLength={20000} disabled={current?.posting || carrying || projectActionId === active.id} onChange={event => { void persistDraft(active.id, activeTask.id, event.target.value).catch(() => {}); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!busy) void send(); } }} aria-describedby="composer-help" /><div className="composer-toolbar"><button type="button" className="model-button" data-return-to-workspace onClick={event => openSettings(event.currentTarget)}><span className="model-dot" />{activeTask.configuration.model}<span className="down-chevron">⌄</span></button><div className="composer-actions"><button className="text-button" type="button" data-return-to-workspace aria-label="打开项目文件上传" onClick={event => openTaskFiles(event.currentTarget)}>＋ 文件</button>{busy ? <button className="stop-button" type="button" aria-label={current?.snapshot?.cleanupRequestId ? '重试清理' : '停止生成'} disabled={current?.status === 'stopping'} onClick={() => { void stop(); }}><Icon name="stop" size={15} />{current?.snapshot?.cleanupRequestId ? '重试清理' : current?.status === 'stopping' ? '正在停止' : '停止'}</button> : <button className="send-button" type="submit" aria-label="发送消息" disabled={Boolean(current?.uncertainPersonalSend) || carrying || capabilityUpdating || !activeTask.draft.trim() || !current?.connected || current?.status === 'connecting' || pending.current.has(activeKey!)} title="发送消息"><Icon name="arrow" size={20} /></button>}</div></div></form><div className="composer-helper"><span id="composer-help">Enter 发送 · Shift + Enter 换行{busy && !current?.snapshot?.cleanupRequestId ? ' · 点击停止可中止本次生成' : ''}</span><span role="status" aria-live="polite">{currentStatus}</span></div></>}
        </div>
        </ConversationDrawer>
        <div className="task-workspace-tools">
          {!archived && <><div className="report-action-row">{lastAssistant && !busy && <button className="secondary-button" type="button" onClick={async () => { const projectId = active.id, key = activeKey!; try { await saveReport(projectId, messageText(lastAssistant)); setFilesRevision(previous => previous + 1); changeUI(key, old => ({ ...old, notice: '这条回复已明确保存为 060_reports 中的最终报告。' })); } catch (error) { changeUI(key, old => ({ ...old, error: safeError(error) })); } }}>将最新回复保存为最终报告</button>}</div><details className="harness-panel task-account-panel"><summary>任务账号连接</summary><TaskServiceConnections key={`services-${activeKey}`} projectId={active.id} taskId={activeTask.id} bindings={activeTask.serviceConnections} unavailableReason={active.memberPackScoped ? '当前任务使用企业会员包的受限资源，个人账号连接不可用。' : current?.snapshot?.capabilities?.protectedExecution ? '当前任务采用受管执行环境，个人账号连接不可用。' : (current?.snapshot?.capabilities?.serviceConnections as { supported?: boolean; reason?: string } | undefined)?.supported === false ? (current?.snapshot?.capabilities?.serviceConnections as { reason?: string }).reason : undefined} disabled={contextLocked || capabilityUpdating} archived={archived} onSettings={() => openSettingsView('connection-settings')} onChanged={task => { updateTask(active.id, activeTask.id, () => task); void refreshTask(active.id, activeTask.id); }} /></details><details className="harness-panel task-pi-capabilities"><summary>Pi 能力与命令</summary><p>可用工具：{current?.snapshot?.tools.join(' · ') || '执行任务或打开会话后显示'}</p><TaskCapabilityList key={activeKey} settings={activeTask} disabled={contextLocked || capabilityUpdating || !current?.connected} context="session" onChange={(capability, enabled) => { const key = activeKey!; void toggleTaskCapability(capability, enabled).catch(error => changeUI(key, old => ({ ...old, error: safeError(error) }))); }} /><p>Python 通过 bash 执行。默认从 020_clean 读取分析资料并保存过程文件；最终报告由 Pi 写入 060_reports，也可明确保存。目录用途约定不提供敏感数据隔离。</p><div>{['/tools', '/skills', '/session', '/tree', '/compact', '/reload'].map(command => <button className="text-button" type="button" key={command} disabled={contextLocked || !current?.connected} onClick={() => { void persistDraft(active.id, activeTask.id, command).catch(() => {}); textarea.current?.focus(); }}>{command}</button>)}</div></details></>}
          {view !== 'studio' && <TaskAssignmentPanel key={activeKey} project={active} task={activeTask} busy={contextLocked || capabilityUpdating} onUpdated={task => updateTask(active.id, task.id, () => task)} onCreate={intent => showTaskDialog(active, document.activeElement as HTMLElement, intent)} />}
          {view !== 'studio' && <section ref={resultsPanel} tabIndex={-1} className="task-results" aria-label="结果与审查"><h2>结果与审查</h2><AutomaticActionLocalSwitch node="save" /><AutomaticActionLocalSwitch node="review" /><AutomaticActionLocalSwitch node="ir" /><AutomaticActionLocalSwitch node="case" /><AutomaticActionLocalSwitch node="assets" /><button type="button" className="text-button" onClick={() => openProjectPlan(active)}>项目需求与任务方案</button>
          <ReportCalculationReview projectId={active.id} taskId={activeTask.id} value={current?.snapshot?.capabilities?.reportCalculationReview} />
          <SapMethodExtractionPanel key={`sap-method-extraction-${activeKey}`} project={active} task={activeTask} taskBusy={busy} hasHistory={Boolean(lastAssistant)} onOpenMethod={openSapMethod} />
          <div className="task-result-links">
            <button type="button" className="secondary-button" aria-expanded={showReport} aria-haspopup={inspectorModal ? 'dialog' : undefined} onClick={event => { inspectorTrigger.current = event.currentTarget; selectInspector('report'); }}>查看报告与依据</button>
            <button type="button" className="text-button verification-trigger" aria-expanded={showConclusion} aria-haspopup={inspectorModal ? 'dialog' : undefined} onClick={event => { inspectorTrigger.current = event.currentTarget; selectInspector('conclusion'); }}>审查结论与建议</button>
          </div>
          <button type="button" className="text-button task-case-trigger" disabled={archived || busy} onClick={() => { setComparisonContexts(previous => ({ ...previous, [activeKey!]: { project: structuredClone(active), task: structuredClone(activeTask), personal: structuredClone(attachedPersonal) } })); setComparisonKey(activeKey); }}>准备增量验证</button>
          {!archived && <button type="button" className="text-button task-case-trigger" onClick={event => { event.currentTarget.focus({preventScroll:true}); showManagement({area:'gsa',stage:'adopt'},{kind:'task',projectId:active.id,taskId:activeTask.id}); }}>带着本任务去核对新增 Case</button>}
          </section>}
        </div><footer className="workspace-footer">本机持久项目 · 任务独立对话 · 020_clean 分析与过程 · 060_reports 最终报告 · 请勿上传敏感数据</footer>
      </div>) : null;
  const sidebarWorkspaceLabel = sidebarEnterpriseName || '当前工作区';
  return <div className="app" data-theme={theme} data-build="decision-case-phase1-20261029">
    {personalChoice && <PersonalContextTargetPicker projects={projects} lockedTaskKeys={Object.keys(ui).filter(key => Boolean(ui[key]?.uncertainPersonalSend))} title={personalChoice.title} onClose={() => setPersonalChoice(undefined)} onSelect={(project, task) => {
      if (project.archivedAt || task.archivedAt) return;
      const key = taskKey(project.id, task.id), choice = personalChoice;
      if (uiRef.current[key]?.uncertainPersonalSend) { setGlobalError('该任务有发送状态 UNKNOWN，先核对原请求；选择与原问题保持。'); return; }
      setPersonalContexts(previous => ({ ...previous, [key]: [...(previous[key] ?? []).filter(item => JSON.stringify(item.selection) !== JSON.stringify(choice.selection)), choice] }));
      setPersonalChoice(undefined); setActiveTaskSourceCase(undefined); void chooseTask(project, task, false);
    }} />}
    <a className="skip-link" href="#main-content">跳到主内容</a>
    {sidebarOpen && <ResponsiveWorkspacePanel label="工作台导航" kind="navigation" modal={sidebarModal} onClose={closeSidebar}>
    <aside id="sidebar" className="sidebar" aria-label="工作台导航">
      <div className="brand"><BrandMark small /><div><strong>OptraCall</strong><span>持续做出更好的决策</span></div>
        {sidebarModal && <button type="button" className="icon-button sidebar-close" data-panel-focus aria-label="关闭侧栏" onClick={closeSidebar}>×</button>}
      </div>
      <div className="sidebar-workspace">
        <span className="sidebar-workspace-avatar" aria-hidden="true">{sidebarWorkspaceLabel.slice(0, 1)}</span>
        <div><strong>{sidebarWorkspaceLabel}</strong><small>经营工作区</small></div>
      </div>
      <button type="button" className="new-chat" aria-label="新建项目" onClick={() => openProjectCreation()}><Icon name="plus" />新建项目</button>
      <button type="button" className="history-heading archived-heading workspace-sidebar-disclosure" aria-expanded={primaryNavOpen} aria-controls="workspace-primary-links" onClick={() => setPrimaryNavOpen(open => !open)}>主导航<span aria-hidden="true">{primaryNavOpen ? '⌄' : '›'}</span></button>
      <nav className="primary-nav" id="workspace-primary-links" aria-label="主导航" hidden={!primaryNavOpen}>
        <p className="nav-group-heading" aria-hidden="true">日常工作</p>
        <button type="button" className={`nav-item ${view === 'home' ? 'selected' : ''}`} aria-current={view === 'home' ? 'page' : undefined} onClick={() => openWorkspace('home')}><Icon name="home" />工作台首页</button>
        <button type="button" className={`nav-item ${view === 'cases' || view === 'projects' ? 'selected' : ''}`} aria-current={view === 'cases' || view === 'projects' ? 'page' : undefined} onClick={() => openWorkspace('cases')}><Icon name="panel" />Decision Case</button>
        <button type="button" className="nav-foundation-index" aria-current={view === 'foundation' ? 'page' : undefined} onClick={() => openWorkspace('foundation')}><span>基础建设总览</span><span aria-hidden="true">›</span></button>
        <button type="button" className={`nav-item ${view === 'goals' && management.area === 'strategy' ? 'selected' : ''}`} aria-current={view === 'goals' && management.area === 'strategy' ? 'page' : undefined} onClick={() => showManagement({area: 'strategy', stage: 'co-create'})}><Icon name="chat" />战略选择</button>
        <button type="button" className={`nav-item ${view === 'goals' && management.area === 'gsa' ? 'selected' : ''}`} aria-current={view === 'goals' && management.area === 'gsa' ? 'page' : undefined} onClick={() => showManagement({area: 'gsa', stage: 'goals'})}><Icon name="check" />目标管理</button>
        <button type="button" className={`nav-item ${view === 'studio' && studioLibraryArea === 'semantic' ? 'selected' : ''}`} aria-current={view === 'studio' && studioLibraryArea === 'semantic' ? 'page' : undefined} onClick={() => openStudioLibrary('semantic')}><Icon name="assets" />语义资产</button>
        <button type="button" className={`nav-item ${view === 'studio' && studioLibraryArea === 'analytics' ? 'selected' : ''}`} aria-current={view === 'studio' && studioLibraryArea === 'analytics' ? 'page' : undefined} onClick={() => openStudioLibrary('analytics')}><Icon name="market" />分析资产</button>
      </nav>
      <ProjectNavigation spaceOpen={projectSpaceOpen} onSpaceToggle={() => setProjectSpaceOpen(open => !open)} projects={projects} activeProjectId={activeId} activeTaskId={activeTaskId} states={ui} loading={hostStatus === 'loading'} onProject={project => { setCaseContexts({}); setActiveTaskSourceCase(undefined); selectContext(project.id); openWorkspace('chat'); if (window.innerWidth <= 760) setSidebarOpen(false); }} onTask={(project, task) => { const key = taskKey(project.id, task.id); setActiveTaskSourceCase(undefined); setTaskPanelByTask(previous => ({ ...previous, [key]: 'chat' })); void chooseTask(project, task); }} onCreateTask={showTaskDialog} onRename={(project, trigger) => { dialogTrigger.current = trigger; setRenameTarget(project); }} onArchive={project => { void projectAction(project, 'archive'); }} onRestore={project => { void projectAction(project, 'restore'); }} />
      <div className="sidebar-bottom workspace-sidebar-bottom"><button type="button" className={`nav-item ${inSettings ? 'selected' : ''}`} aria-label="设置" aria-current={inSettings ? 'page' : undefined} aria-describedby={config?.hasApiKey ? 'settings-configured' : undefined} onClick={event => openSettings(event.currentTarget)}><Icon name="settings" />设置{config?.hasApiKey && <span className="configured-dot" aria-hidden="true" />}</button>{config?.hasApiKey && <span id="settings-configured" className="sr-only">已保存本机配置</span>}<button type="button" className="text-button workspace-locale" disabled title="界面语言切换后续支持" aria-label="中英界面切换，后续支持">中／EN</button></div>
    </aside></ResponsiveWorkspacePanel>}
    <main id="main-content" className="main" tabIndex={-1}><header className="topbar"><div className="topbar-context"><button ref={sidebarToggle} className="icon-button" aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'} aria-expanded={sidebarOpen} aria-controls={sidebarOpen ? 'sidebar' : undefined} aria-haspopup={sidebarModal ? 'dialog' : undefined} onClick={() => sidebarOpen ? closeSidebar() : setSidebarOpen(true)}><Icon name="panel" /></button><span className="topbar-title">{helpOpen ? '帮助' : pageTitle}</span></div><div className="workspace-switch" role="group" aria-label="工作区切换"><button aria-pressed={!helpOpen && view === 'chat'} onClick={() => openWorkspace('chat')}>分析</button><button aria-pressed={!helpOpen && view === 'decision'} onClick={() => openWorkspace('decision')}>决策</button></div><div className="topbar-actions"><button ref={searchTrigger} type="button" className="topbar-search-button" aria-label="搜索工作区" onClick={openQuickSearch}><Icon name="search" size={15} /><span>搜索工作区</span><kbd aria-hidden="true">/</kbd></button>{canOpenProjectFiles && !helpOpen && <button type="button" ref={filesToggle} className="icon-button files-toggle" aria-label={showProjectFiles ? '收起项目文件' : '展开项目文件'} aria-expanded={showProjectFiles} aria-controls={showProjectFiles ? 'project-files' : undefined} aria-haspopup={inspectorModal ? 'dialog' : undefined} onClick={event => toggleProjectFiles(event.currentTarget)}><Icon name="panel" /></button>}<button ref={helpTrigger} className="help-trigger" type="button" aria-label="帮助" aria-expanded={helpOpen} aria-controls="product-help" onClick={() => helpOpen ? closeHelp() : setHelpOpen(true)}><Icon name="help" size={17} />帮助</button><button className="icon-button" aria-label={theme === 'light' ? '切换为深色' : '切换为浅色'} onClick={() => setTheme(old => old === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button></div></header>
      {globalError && <div className="global-notice" role="alert"><span>{globalError}</span><button className="text-button" onClick={async () => { try { await refreshConfigurations(); const saved = await listProjects(); for (const project of saved) mergeProject(project); setGlobalError(''); } catch {} }}>重新连接</button><button className="text-button" onClick={() => setGlobalError('')}>关闭提示</button></div>}{globalNotice && <p className="project-notice" role="status">{globalNotice}</p>}
      {studioProjectAssociationPending && <div className="global-notice" role="alert"><span>项目 {studioProjectAssociationPending.projectId} 已创建；企业关联结果 UNKNOWN，原请求保持。</span><button type="button" className="secondary-button" onClick={() => { void inspectStudioProjectAssociation(); }}>核对原企业关联结果</button></div>}
      {studioUsePending && <div className="global-notice" role="alert"><span>进入分析结果 UNKNOWN；原请求 {studioUsePending.requestId} 保留，未重复创建任务。</span><button type="button" className="secondary-button" onClick={() => { void inspectStudioUse(); }}>核对原创建结果</button></div>}
      <HelpPage open={helpOpen} onBack={closeHelp} />
      <div hidden={helpOpen} className="workbench-content"><div className="workbench-view">
      {(inSettings || personalMounted || webSearchMounted) && <section className="settings-page" aria-labelledby="settings-title" hidden={!inSettings}>
        <header className="page-heading settings-heading">
          <div><h1 id="settings-title">设置</h1><p>管理资料、模型、连接与自动模式。</p></div>
          <button type="button" className="text-button back-button" onClick={backFromSettings}><span aria-hidden="true">←</span>{settingsBackLabel}</button>
        </header>
        <div className="settings-layout">
        <div className="catalog-tabs settings-tabs" role="group" aria-label="设置分类">
          <p className="settings-group-label" aria-hidden="true">基础与模型</p>
          <button type="button" className={view === 'usage-context-settings' ? 'active' : undefined} aria-pressed={view === 'usage-context-settings'} aria-controls="settings-usage-panel" onClick={() => openSettingsView('usage-context-settings')}><Icon name="chat" size={16} />使用用途</button>
          <button type="button" className={view === 'settings' ? 'active' : undefined} aria-pressed={view === 'settings'} aria-controls="settings-model-panel" onClick={() => openSettingsView('settings')}><Icon name="settings" size={16} />模型设置</button>
          <button type="button" className={view === 'web-search-settings' ? 'active' : undefined} aria-pressed={view === 'web-search-settings'} aria-controls="settings-web-search-panel" onClick={() => openSettingsView('web-search-settings')}><Icon name="search" size={16} />网络检索</button>
          <p className="settings-group-label" aria-hidden="true">能力与连接</p>
          <button type="button" className={view === 'automatic-action-settings' ? 'active' : undefined} aria-pressed={view === 'automatic-action-settings'} aria-controls="settings-automatic-panel" onClick={() => openSettingsView('automatic-action-settings')}><Icon name="check" size={16} />自动模式</button>
          <button type="button" className={view === 'skill-settings' ? 'active' : undefined} aria-pressed={view === 'skill-settings'} aria-controls="settings-skill-panel" onClick={() => openSettingsView('skill-settings')}><Icon name="folder" size={16} />Skill 资料与依赖</button>
          <button type="button" className={view === 'connection-settings' ? 'active' : undefined} aria-pressed={view === 'connection-settings'} aria-controls="settings-connections-panel" onClick={() => openSettingsView('connection-settings')}><Icon name="panel" size={16} />连接配置</button>
          <p className="settings-group-label" aria-hidden="true">资料与资产包</p>
          <button type="button" className={view === 'personal-materials' ? 'active' : undefined} aria-pressed={view === 'personal-materials'} aria-controls="settings-personal-panel" onClick={() => openSettingsView('personal-materials')}><Icon name="assets" size={16} />个人资料</button>
          <button type="button" className={view === 'model-pack-settings' ? 'active' : undefined} aria-pressed={view === 'model-pack-settings'} aria-controls="settings-model-pack-panel" onClick={() => openSettingsView('model-pack-settings')}><Icon name="market" size={16} />业务模型包</button>
          <button type="button" className={view === 'capability-plans' ? 'active' : undefined} aria-pressed={view === 'capability-plans'} aria-controls="settings-domain-pack-panel" onClick={() => openSettingsView('capability-plans')}><Icon name="assets" size={16} />领域资产包</button>
        </div>
        <div className="settings-content">
        <div id="settings-usage-panel" hidden={view !== 'usage-context-settings'}>{view === 'usage-context-settings' && <UsageContextSettingsPage />}</div>
        <div id="settings-model-panel" hidden={view !== 'settings'}>
          {view === 'settings' && <ModelSettings configurations={configurations} selectedId={selectedId} hostStatus={hostStatus} onChange={refreshConfigurations} />}
        </div>
        <div id="settings-personal-panel" className="settings-personal" hidden={view !== 'personal-materials'}>
          {personalMounted && <PersonalMaterialsPage headingLevel={2} active={view === 'personal-materials' && !helpOpen} initialSource={personalEntry} onSourceConsumed={() => setPersonalEntry(currentEntry => currentEntry === personalEntry ? undefined : currentEntry)} onOpenProject={openPersonalProject} onOpenMaterial={openPersonalMaterial} currentTaskLabel={personalCurrentKey === activeKey && active && activeTask && !archived && !current?.uncertainPersonalSend ? personalTargetLabel(active, activeTask) : undefined} onOther={(selection, title) => setPersonalChoice({selection, title})} onUse={personalCurrentKey === activeKey && activeKey && !archived && !current?.uncertainPersonalSend ? (selection, title) => {
            const key = activeKey; setPersonalContexts(previous => ({ ...previous, [key]: [...(previous[key] ?? []).filter(item => JSON.stringify(item.selection) !== JSON.stringify(selection)), { selection, title }] }));
            setHelpOpen(false); setView('chat'); requestAnimationFrame(() => textarea.current?.focus());
          } : undefined} />}
        </div>
        <div id="settings-web-search-panel" hidden={view !== 'web-search-settings'}>
          {webSearchMounted && <WebSearchSettings active={view === 'web-search-settings' && !helpOpen} onModelSettings={() => openSettingsView('settings')} />}
        </div>
        <div id="settings-automatic-panel" hidden={view !== 'automatic-action-settings'}>{view === 'automatic-action-settings' && <AutomaticActionSettingsPage active={!helpOpen} />}</div>
        <div id="settings-skill-panel" hidden={view !== 'skill-settings'}>{view === 'skill-settings' && <SkillCapabilitySettings active={!helpOpen} onProject={() => active ? openProjectPlan(active) : openWorkspace('projects')} onModelSettings={() => openSettingsView('settings')} />}</div>
        <div id="settings-connections-panel" hidden={view !== 'connection-settings'}>{view === 'connection-settings' && <><ServiceConnectionsSettings onProject={openTaskServiceConnections} /><ConnectorCapabilitySettings onSharedConnections={() => { setDbConnectionsProjectId(undefined); setDbConnectionsOpen(true); }} onProjectSources={openProjectSources} onHelp={() => setHelpOpen(true)} /></>}</div>
        <div id="settings-model-pack-panel" hidden={view !== 'model-pack-settings'}>{view === 'model-pack-settings' && <ModelRegistryPage embedded onBack={backFromSettings} />}</div>
        <div id="settings-domain-pack-panel" hidden={view !== 'capability-plans'}>{view === 'capability-plans' && <CapabilityPlansSettings onOpenStudio={() => { setStudioMounted(true); setHelpOpen(false); setView('studio'); }} />}</div>
        </div></div>
      </section>}
      {goalMounted && <div hidden={view !== 'goals'} style={{ display: view === 'goals' ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0 }}><StrategyGoalsPage teachReview={teachReview} clearTeachReview={()=>setTeachReview(undefined)} onReturnReview={()=>{if(!teachReview)return;setCaseFocus(teachReview.teachReview.caseId);setCaseFocusSeq(seq => seq + 1);setCaseIssueFocus(teachReview.teachReview.issueId);setTeachReview(undefined);setView('cases');lastWorkspace.current='cases';}} caseSource={caseSource} clearCaseSource={()=>setCaseSource(undefined)} onInspectCase={id=>{setCaseFocus(id);setCaseFocusSeq(seq => seq + 1);setView('cases');lastWorkspace.current='cases';}} management={management} onStage={switchManagementStage} projects={projects} configurations={configurations} selectedConfigurationId={selectedId} onSettings={() => openSettings()} onOpenBoard={() => openWorkspace('decision')} active={view === 'goals' && !helpOpen} onOpenCase={goal => { setGoalForCase(goal); openWorkspace('cases'); }} onStartProject={(goal, usageContext, handoff) => { openWorkspace('projects'); openProjectCreation(goal, usageContext, handoff); }} onManageMetrics={() => openStudioProfessional({ kind: 'metrics' })} /></div>}
      {mountedPlans.map(projectId => { const project = projects.find(value => value.id === projectId); return project && <div key={projectId} hidden={view !== 'project-plan' || planProjectId !== projectId} style={{ display: view === 'project-plan' && planProjectId === projectId ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0 }}><ProjectPlanPage historyOnly project={project} initialGoal={project.goalOrigin?.goal ?? goalProjectEntrances[projectId]?.goal} initialUsageContext={goalProjectEntrances[projectId]?.usageContext} onBack={() => openWorkspace('projects')} onConfirmed={async () => { await refreshProjects(); setGoalProjectEntrances(previous => { const next = { ...previous }; delete next[projectId]; return next; }); }} onOpenTask={taskId => { void readTaskForNavigation(projectId, taskId).then(value => { setActiveTaskSourceCase(undefined); mergeProject(value.project); return chooseTask(value.project, value.task); }).catch(error => setGlobalError(safeError(error))); }} onManageCapabilities={() => { selectContext(project.id); openWorkspace('chat'); setFilesOpen(true); }} /></div>; })}
      {studioMounted && <div hidden={view !== 'studio'} className="studio-workspace"><StudioPage libraryArea={studioLibraryArea} libraryRequest={studioLibraryRequest} onLibraryAreaChange={setStudioLibraryArea} onSwitchLibraryArea={openStudioLibrary} active={view === 'studio' && !helpOpen} currentProjectId={activeId} operatorProjectReady={boundProjectId === activeId} projects={projects} initialSystemId={studioFocus || undefined} onTargetConsumed={() => setStudioFocus('')} onSelectConstruction={selectStudioConstruction} onStartConstruction={system => runStudioConstruction(system, true)} onContinueConstruction={(system, goal) => runStudioConstruction(system, false, goal)} onOpenTask={(projectId, taskId) => { setActiveTaskSourceCase(undefined); const project = projects.find(value => value.id === projectId), task = project?.tasks.find(value => value.id === taskId); if (project && task) void chooseTask(project, task, false); else void readTaskForNavigation(projectId, taskId).then(value => { mergeProject(value.project); return chooseTask(value.project, value.task, false); }).catch(error => setGlobalError(safeError(error))); }} renderConversation={(_system, workspace) => view === 'studio' && active?.id === workspace.project.id && activeTask?.id === workspace.task.id ? chatContent : <p className="studio-muted">正在核对当前建设任务与会话…</p>} onUseSystem={useStudioSystem} initialProfessionalTarget={studioProfessionalTarget} onProfessionalTargetConsumed={() => setStudioProfessionalTarget(undefined)} onCreateProject={() => openProjectCreation()} selectedEnterpriseId={studioEnterpriseId} onEnterpriseChange={setStudioEnterpriseId} onNavigationGuard={registerStudioLeave} onModalChange={setStudioDialogOpen} /></div>}
      {capabilityMounted.includes('requirement') && <div hidden={view !== 'requirement'} style={{ display: view === 'requirement' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}><RequirementPage backLabel={requirementReturnTask ? '返回分析任务' : '返回原工作'} initialInstanceId={requirementFocus} projects={projects} onProjectsChanged={() => { void listProjects().then(value => { if (mounted.current) setProjects(value); }).catch(() => {}); }} onBack={() => requirementReturnTask ? returnFromRequirements() : backFromCapability('requirement')} onSendToTask={(project, task, requirement) => { setRequirementContexts(previous => ({ ...previous, [taskKey(project.id, task.id)]: requirement })); void chooseTask(project, task); }} /></div>}
      {capabilityMounted.includes('refiner') && <div hidden={view !== 'refiner'} style={{ display: view === 'refiner' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}><RefinerPage key={refinerSource ? JSON.stringify(refinerSource) : 'refiner-records'} source={refinerSource} initialDeckId={refinerDeckId} projects={projects} configurations={configurations} onDeckChange={setRefinerDeckId} onNavigationGuard={registerRefinerLeave} onBack={() => backFromCapability('refiner')} /></div>}
      {capabilityMounted.includes('simlab') && <div className="workspace-page-gutter" hidden={view !== 'simlab'} style={{ display: view === 'simlab' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}><SimLabPage backLabel="返回原工作" key={simlabTarget ? JSON.stringify(simlabTarget) : `simlab-records:${capabilityReturn.current.simlab?.projectId || ''}`} initialProjectId={capabilityReturn.current.simlab?.projectId} initialSelection={simlabTarget} projects={projects} onOpenTask={(project, task) => { void chooseTask(project, task); }} onBack={() => backFromCapability('simlab')} /></div>}
      {capabilityMounted.includes('model-pack') && <div className="workspace-page-gutter" hidden={view !== 'model-pack'} style={{ display: view === 'model-pack' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}><ModelRegistryPage backLabel="返回原工作" onBack={() => backFromCapability('model-pack')} /></div>}
      {!inSettings && !helpOpen && (view === 'cases' || view === 'projects') && <DecisionCaseTabs area={view === 'projects' ? 'projects' : 'overview'} onSelect={next => { if (next === 'projects') { setCaseProjectTarget(undefined); openWorkspace('projects'); } else openWorkspace('cases'); }} />}
      {inSettings ? null : view === 'home' ? <WorkspaceHome active={view === 'home' && !helpOpen} projects={projects} currentProjectId={activeId} selectedEnterpriseId={studioEnterpriseId} onEnterpriseChange={setStudioEnterpriseId} onResolvedEnterpriseName={setSidebarEnterpriseName} refreshToken={homeRefreshToken} preferredCaseId={caseFocus} onCreateCase={openHomeCreateCase} onOpenCase={openHomeCase} onOpenStarMap={() => openWorkspace('cases')} onOpenProjectMap={() => { setCaseProjectTarget(undefined); openWorkspace('projects'); }} onOpenDecisionBoard={() => openWorkspace('decision')} onOpenProject={openHomeProject} onOpenTask={(projectId, taskId, sourceCase) => { void openHomeTask(projectId, taskId, sourceCase); }} onOpenReport={target => { void openHomeReport(target); }} onOpenFoundation={openHomeFoundation} onOpenFoundationOverview={() => openWorkspace('foundation')} /> : view === 'foundation' ? <FoundationOverview active={view === 'foundation' && !helpOpen} projects={projects} currentProjectId={activeId} selectedEnterpriseId={studioEnterpriseId} onEnterpriseChange={setStudioEnterpriseId} onResolvedEnterpriseName={setSidebarEnterpriseName} refreshToken={homeRefreshToken} preferredCaseId={caseFocus} onOpenFoundation={openHomeFoundation} onOpenCase={openHomeCase} onCreateCase={openHomeCreateCase} onOpenProjectMap={() => { setCaseProjectTarget(undefined); openWorkspace('projects'); }} onOpenSettings={trigger => openSettings(trigger)} /> : view === 'project-plan' || view === 'goals' ? null : view === 'cases' ? <CaseBoard initialCreate={caseCreatePending} onInitialCreateConsumed={() => setCaseCreatePending(false)} onCaseChanged={() => setHomeRefreshToken(value => value + 1)} onTeachReview={owner=>showManagement(owner.role==='goal'?{area:'gsa',stage:'goals'}:{area:'strategy',stage:'strategy-versions'},undefined,owner)} onReviewGoals={source=>showManagement({area:'gsa',stage:'adopt'},source)} initialSource={caseSource} initialGoal={goalForCase} onInitialGoalConsumed={() => setGoalForCase(undefined)} mapView={caseMapView} onMapViewChange={setCaseMapView} relationUi={caseRelationUi} onRelationUiChange={setCaseRelationUi} onOpenProject={(project, issue) => { if (issue) openProjectCollaboration(project,issue); else { setCaseProjectTarget(project.id); setProjectFocusSeq(seq => seq + 1); openWorkspace('projects'); } }} decisionUi={caseDecisionUi} onDecisionUiChange={(ownerKey, update) => setCaseDecisionUi(previous => ({ ...previous, [ownerKey]: update(previous[ownerKey] ?? emptyCaseDecisionUiState) }))} currentWork={activeId && activeTaskId ? { projectId: activeId, taskId: activeTaskId } : undefined} onOpenDecisionBoard={target => { setFeedbackReview(target); openWorkspace('decision'); }} initialCaseId={caseFocus} initialCaseSeq={caseFocusSeq} initialIssueId={caseIssueFocus} reportReturn={reportCaseReturn} mode={caseMode} onModeChange={setCaseMode} projects={projects} configurations={configurations} onOpenTask={(project, task, context) => { void boardTask(project, task, context); }} onCreateTask={(project, intent) => showTaskDialog(project, document.activeElement as HTMLElement, intent)} onProjectChange={refreshProjects} /> : view === 'projects' ? <ProjectBoard onOpenCase={openHomeCase} onOpenWorkflow={(project, target) => openCapability(target, project)} onOpenCollaboration={project => openProjectCollaboration(project)} onOpenPlan={openProjectPlan} initialProjectId={caseProjectTarget || projectReturnFocus} initialProjectSeq={projectFocusSeq} onInitialProjectClose={() => { setProjectReturnFocus(undefined); if (caseProjectTarget) { setCaseProjectTarget(undefined); openWorkspace('cases'); } }} mode={projectMode} onModeChange={setProjectMode} projects={projects} onOpenTask={(project, task) => { void boardTask(project, task); }} onCreateProject={() => openProjectCreation()} onCreateTask={project => showTaskDialog(project, document.activeElement as HTMLElement)} onRename={(project, trigger) => { dialogTrigger.current = trigger; setRenameTarget(project); }} onArchive={project => { void projectAction(project, 'archive'); }} onRestore={project => { void projectAction(project, 'restore'); }} onProjectChange={refreshProjects} /> : view === 'decision' ? <DecisionBoardPage initialReport={boardReportFocus} initialReview={feedbackReview} onOpenFeedbackTask={openFeedbackTask} onOrganize={openPersonal} /> : view === 'requirement' || view === 'refiner' || view === 'simlab' || view === 'model-pack' ? null : view === 'studio' ? null : !active && projects.length > 0 ? <div className="project-start"><BrandMark /><p className="eyebrow">原工作定位待核</p><h1>选择已有项目继续</h1><p>原链接对象暂不可读取，未替换到其他项目或任务。可在 项目地图查找准确原记录。</p><button type="button" className="primary-button" onClick={() => openWorkspace('projects')}>查看已有项目</button></div> : !active ? <div className="project-start"><BrandMark /><p className="eyebrow">你好，欢迎来到 OptraCall</p><h1>从一个项目开始</h1><p>让问题、分析与决策，拥有同一个工作空间。</p><button className="primary-button" onClick={() => openProjectCreation()}><Icon name="plus" />创建第一个项目</button><span>项目、文件与任务历史保存在本机</span></div>  : !activeTask && !archived ? <ProjectCollaboration key={active.id + (projectIssue?.projectId === active.id ? projectIssue.issueId : '')} project={active} issue={projectIssue?.projectId === active.id ? {caseId:projectIssue.caseId,issueId:projectIssue.issueId} : undefined} onChangeScope={scope => openProjectCollaboration(active,scope)} onReturnIssue={returnToProjectIssue} onCreate={intent => showTaskDialog(active, document.activeElement as HTMLElement, intent)} onRefresh={refreshProjects} onHistory={() => openProjectPlan(active)}/> : !activeTask ? <div className="project-start"><BrandMark /><p className="eyebrow">{archived ? '已归档项目' : '项目空间'}</p><h1>{active.name}</h1><p>{archived ? '任务、文件与历史完整保留，恢复项目后可继续工作。' : '文件在项目中共享，对话在任务中独立进行。'}</p>{archived ? <button className="primary-button" disabled={Boolean(projectActionId)} onClick={() => { void projectAction(active, 'restore'); }}>恢复此项目</button> : <button className="primary-button" onClick={event => showTaskDialog(active, event.currentTarget)}>{active.tasks.length ? '新建任务' : '新建第一个任务'}</button>}<span>{active.tasks.length} 个任务 · 三个共享项目文件夹</span></div> : chatContent}
      </div>
      {!helpOpen && showInspector && <ResponsiveWorkspacePanel label="任务检视区" kind="inspector" modal={inspectorModal} onClose={closeInspector}>
        <div className="workspace-inspector" role="region" aria-label="任务检视区">
          <header className="workspace-inspector-toolbar">
            <nav aria-label="检视区分类">
              <button type="button" aria-pressed={showProjectFiles} onClick={() => selectInspector('files')}>项目文件</button>
              {view === 'chat' && activeTask && <>
                <button type="button" aria-pressed={showReport} onClick={() => selectInspector('report')}>报告与依据</button>
                <button type="button" aria-pressed={showConclusion} onClick={() => selectInspector('conclusion')}>审查结论</button>
              </>}
            </nav>
            <button type="button" className="icon-button" aria-label="关闭检视区" onClick={closeInspector}>×</button>
          </header>
          {showReport && active && activeTask && <TaskReportEvidence key={activeKey} projectId={active.id} taskId={activeTask.id} initialReport={inspectedVersion} sourceCase={currentTaskSourceCase} autoOpen={Boolean(activeKey && autoOpenReportKey === activeKey)} previewOpen={Boolean(activeKey && reportPreviewOpenByTask[activeKey])} onPreviewOpenChange={open => {
            if (!activeKey) return;
            setReportPreviewOpenByTask(previous => ({ ...previous, [activeKey]: open }));
          }} onOpenDesk={report => {
            if (!activeKey) return;
            if (report) setInspectedReport({ key: activeKey, version: report });
            switchTaskPanel('report');
          }} onReportChange={version => {
            setInspectedReport(activeKey && version ? { key: activeKey, version } : undefined);
          }} onOpenCase={caseId => {
            setTaskInspector(undefined); inspectorTrigger.current = null;
            setAutoOpenReportKey(undefined);
            setCaseFocus(caseId); setCaseFocusSeq(seq => seq + 1); setCaseIssueFocus(undefined);
            setReportCaseReturn({ caseId, projectId: active.id, taskId: activeTask.id });
            lastWorkspace.current = 'cases'; setView('cases');
          }} />}
          {showConclusion && active && activeTask && <ConclusionReviewPanel key={activeKey} project={active} task={activeTask} taskBusy={busy || carrying || Boolean(current?.uncertainPersonalSend)} filesRevision={filesRevision} requestedReport={inspectedVersion} requirementContext={attachedRequirement} caseContext={selectedCase ? { id: selectedCase.record.id, title: selectedCase.record.title, description: selectedCase.record.description, revision: selectedCase.record.revision } : undefined} enterpriseMaterials={attachedEnterprise} semanticContext={current?.snapshot?.capabilities?.semanticContext} onClose={closeInspector} onOpenBoard={target => { setFeedbackReview(undefined); openWorkspace('decision'); setBoardReportFocus(target); }} onCarry={async reviewId => {
        const projectId = active.id, taskId = activeTask.id, key = taskKey(projectId, taskId);
        setCarryingTasks(previous => ({ ...previous, [key]: true }));
        try {
          await draftQueues.current.get(key);
          const result = await carryConclusionReview(projectId, taskId, reviewId);
          if (result.task.id !== taskId || result.reviewId !== reviewId) throw new HostRequestError('带回意见的任务或记录归属未能核对。');
          updateTask(projectId, taskId, task => ({ ...task, draft: result.task.draft }));
          if (inspectorModal && visibleTask.current === key) setTaskInspector(undefined);
          requestAnimationFrame(() => { if (visibleTask.current === key) { textarea.current?.focus(); textarea.current?.scrollIntoView({ block: 'center' }); } });
          return result.appended;
        } finally { setCarryingTasks(previous => { const next = { ...previous }; delete next[key]; return next; }); }
      }} />}{showProjectFiles && active && <ProjectFiles key={activeKey ?? active.id} onManageConnections={() => { setDbConnectionsProjectId(active.id); setDbConnectionsOpen(true); }} project={active} taskId={activeTask?.id} refreshToken={filesRevision} dataSelections={attachedProjectData} taskBusy={contextLocked} onOpenConcepts={() => openStudioProfessional({ kind: 'materials' })} onOrganize={openPersonal} onDataSelect={selection => { if (activeTask) { const projectId = active.id, taskId = activeTask.id; setProjectDataSelections(previous => addTaskProjectDataSelection(previous, projectId, taskId, selection)); } }} onGeneratePptx={file => {
        void generatePptx(active, file).catch(error => {
          if (activeKey) changeUI(activeKey, old => ({ ...old, error: safeError(error) }));
          else setGlobalError(safeError(error));
        });
      }} onRefinePptx={(file, reportPath) => { rememberCapabilityReturn('refiner'); setRefinerDeckId(undefined); setRefinerSource({ projectId: active.id, sourcePptx: file.path, reportPath, title: file.name.replace(/\.pptx$/i, '') }); setView('refiner'); }} onClose={closeInspector} />}
        </div>
      </ResponsiveWorkspacePanel>}
      </div>
    </main>
    {searchOpen && <WorkspaceSearchDialog onClose={closeQuickSearch} onSelect={handleSearchSelect} />}
    <DbLinkConnections readOnly={Boolean(dbConnectionsProjectId && projects.find(project => project.id === dbConnectionsProjectId)?.archivedAt)} open={dbConnectionsOpen} onClose={() => setDbConnectionsOpen(false)} onChanged={() => setFilesRevision(value => value + 1)} />
    {Object.entries(comparisonContexts).map(([key, context]) => <ExperienceComparisonDialog key={key} open={comparisonKey === key} context={{ ...context, project: projects.find(value => value.id === context.project.id) ?? context.project }} onClose={() => setComparisonKey(undefined)} onCreated={task => setProjects(previous => previous.map(project => project.id === context.project.id ? { ...project, tasks: project.tasks.some(value => value.id === task.id) ? project.tasks.map(value => value.id === task.id ? task : value) : [...project.tasks, task] } : project))} onOpenTask={task => { const project = projects.find(value => value.id === context.project.id); if (project) { setComparisonKey(undefined); void chooseTask(project, task, false); } }} />)}
    {studioFeedback && <StudioFeedbackDialog project={studioFeedback.project} task={studioFeedback.task} message={studioFeedback.message} initialSystemId={studioTaskContexts[taskKey(studioFeedback.project.id, studioFeedback.task.id)]?.systemId || studioFeedback.task.studioContext?.systemId} onClose={() => setStudioFeedback(undefined)} onOpenSystem={systemId => { setStudioFeedback(undefined); setStudioFocus(systemId); setStudioMounted(true); setHelpOpen(false); setView('studio'); }} />}
    {projectDialogOpen && <NewProjectDialog configurations={configurations} selectedId={selectedId} onCreate={createProject} onSettings={() => { closeProjectCreation(); openSettings(); }} onClose={closeProjectCreation} />}
    {taskDialogProject && <TaskDialog intent={taskIntent} project={taskDialogProject} configurations={configurations} onCreate={createTask} onClose={closeDialog} />}
    {feedbackNextSource && active && activeTask && <FeedbackRequirementDialog key={`${activeKey}/${feedbackNextSource.kind === 'reply' ? feedbackNextSource.message.nativeEntryId : feedbackNextSource.relativePath}`} project={active} task={activeTask} source={feedbackNextSource} onClose={() => setFeedbackNextSource(undefined)} onOpenRequirement={instanceId => { rememberCapabilityReturn('requirement'); setFeedbackNextSource(undefined); setRequirementReturnTask({ projectId: active.id, taskId: activeTask.id }); setRequirementFocus(instanceId); setView('requirement'); }} />}
    {renameTarget && <RenameProjectDialog project={renameTarget} onRename={async name => { const project = await renameProject(renameTarget.id, name); mergeProject(project); closeDialog(); }} onClose={closeDialog} />}
    {active && activeTask && !archived && question && (view === 'chat' || view === 'studio') && !helpOpen && current?.deferredRequestId !== question.id && !modalOpen && <BrowserInteraction key={`${activeKey}:${question.id}`} request={question} onAnswer={response => respond(active.id, activeTask.id, response)} onLater={() => changeUI(activeKey!, old => ({ ...old, deferredRequestId: question.id }))} onStop={stop} onRestoreFocus={() => textarea.current?.focus()} />}
  </div>;
}
