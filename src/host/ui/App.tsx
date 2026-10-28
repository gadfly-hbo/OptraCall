import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CatalogPage } from './CatalogPage.tsx';
import { DecisionPage } from './DecisionPage.tsx';
import { NewProjectDialog, ProjectFiles } from './ProjectSpace.tsx';
import { ModelSettings } from './ModelSettings.tsx';
import { BrowserInteraction } from './BrowserInteraction.tsx';
import { answerInteraction, createProject as createDiskProject, HostRequestError, listProjects, readConfigurations, readProject, runCommand, saveDraft, saveReport, sendMessage, stopProject, watchProject } from './runtime-client.ts';
import { messageText, type BrowserUIRequest, type BrowserUIResponse, type ClientProject, type NativeMessage, type ProjectEvent, type PublicModelConfiguration, type SessionSnapshot } from './project-types.ts';
import { catalogCategories, catalogMeta, type CatalogCategory } from './catalog-data.ts';

type AppView = 'chat' | 'settings' | 'decision' | CatalogCategory;

type IconName = 'panel' | 'plus' | 'chat' | 'settings' | 'arrow' | 'stop' | 'check' | 'warning' | 'moon' | 'sun' | 'back' | 'assets' | 'scenarios' | 'connector' | 'plugin' | 'folder';
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const shapes: Record<IconName, ReactNode> = {
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

type ProjectUI = { snapshot?: SessionSnapshot; streaming: string; status: 'connecting' | 'idle' | 'running' | 'stopping'; connected: boolean; posting: boolean; uiRequests: BrowserUIRequest[]; deferredRequestId?: string; extensionStatus?: Record<string, string>; finalReceived?: boolean; requestId?: string; optimistic?: string; error?: string; failedPrompt?: string; toolStatus?: string; draftSaving?: boolean; commandResult?: string; notice?: string };
const initialUI = (): ProjectUI => ({ streaming: '', status: 'connecting', connected: false, posting: false, uiRequests: [] });
const safeError = (error: unknown): string => error instanceof HostRequestError ? error.message : '本地服务暂时不可用，请重新连接。';
const messagesOf = (snapshot?: SessionSnapshot) => snapshot?.messages.filter(message => ['user', 'assistant', 'toolResult', 'bashExecution'].includes(message.role) || (message.role === 'custom' && message.display === true)) ?? [];

export function App() {
  const [projects, setProjects] = useState<ClientProject[]>([]); const [activeId, setActiveId] = useState<string>(); const [ui, setUI] = useState<Record<string, ProjectUI>>({});
  const [view, setView] = useState<AppView>('chat'); const lastWorkspace = useRef<'chat' | 'decision'>('chat'); const settingsReturnView = useRef<AppView>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 760); const [filesOpen, setFilesOpen] = useState(() => window.innerWidth > 1100);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false); const [projectListOpen, setProjectListOpen] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [configurations, setConfigurations] = useState<PublicModelConfiguration[]>([]); const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hostStatus, setHostStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading'); const [globalError, setGlobalError] = useState(''); const [filesRevision, setFilesRevision] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null); const end = useRef<HTMLDivElement>(null); const settingsTrigger = useRef<HTMLButtonElement | null>(null);
  const streams = useRef(new Map<string, AbortController>()); const draftQueues = useRef(new Map<string, Promise<void>>()); const draftEpochs = useRef(new Map<string, number>()); const pending = useRef(new Set<string>());
  const eventHandler = useRef<(id: string, event: ProjectEvent) => void>(() => {}); const mounted = useRef(true);
  const active = projects.find(item => item.id === activeId); const current = active ? ui[active.id] ?? initialUI() : undefined;
  const busy = current?.status === 'running' || current?.status === 'stopping' || Boolean(current?.posting) || Boolean(current?.uiRequests?.length);
  const question = current?.uiRequests?.[0];
  const config = configurations.find(value => value.id === selectedId);
  const changeUI = (id: string, update: (previous: ProjectUI) => ProjectUI) => { if (mounted.current) setUI(previous => ({ ...previous, [id]: update(previous[id] ?? initialUI()) })); };
  const refreshConfigurations = async () => { try { const value = await readConfigurations(); if (!mounted.current) return; setConfigurations(value.configurations); setSelectedId(value.selectedId); setHostStatus('ready'); setGlobalError(''); } catch (error) { if (mounted.current) { setHostStatus('unavailable'); setGlobalError(safeError(error)); } throw error; } };
  const applySnapshot = (id: string, snapshot: SessionSnapshot) => changeUI(id, old => ({ ...old, snapshot, streaming: '', optimistic: undefined, status: snapshot.status === 'running' ? 'running' : 'idle', requestId: snapshot.status === 'running' ? snapshot.lastRun?.requestId ?? old.requestId : undefined, uiRequests: snapshot.uiRequests ?? [], toolStatus: undefined, finalReceived: false }));
  const refreshProject = async (id: string) => {
    const value = await readProject(id); if (!mounted.current) return value;
    setProjects(previous => previous.map(item => item.id === id ? { ...value.project, draft: item.draft } : item)); applySnapshot(id, value.snapshot); setFilesRevision(previous => previous + 1); return value;
  };
  const connect = (id: string) => {
    if (streams.current.has(id)) return; const controller = new AbortController(); streams.current.set(id, controller);
    changeUI(id, old => ({ ...old, connected: false }));
    void watchProject(id, event => eventHandler.current(id, event), controller.signal).catch(error => { if (!controller.signal.aborted) changeUI(id, old => ({ ...old, connected: false, error: safeError(error) })); }).finally(() => { if (streams.current.get(id) === controller) streams.current.delete(id); });
  };
  eventHandler.current = (id, event) => {
    if (event.type === 'snapshot') { applySnapshot(id, event.snapshot); changeUI(id, old => ({ ...old, connected: true })); return; }
    if (event.type === 'ui.request') { changeUI(id, old => { const requests = old.uiRequests ?? []; return { ...old, uiRequests: requests.some(request => request.id === event.request.id) ? requests.map(request => request.id === event.request.id ? event.request : request) : [...requests, event.request] }; }); return; }
    if (event.type === 'ui.dismiss') { changeUI(id, old => ({ ...old, uiRequests: (old.uiRequests ?? []).filter(request => request.id !== event.id), deferredRequestId: old.deferredRequestId === event.id ? undefined : old.deferredRequestId })); return; }
    if (event.type === 'ui.notification') { changeUI(id, old => ({ ...old, notice: event.message })); return; }
    if (event.type === 'ui.status') { changeUI(id, old => { const extensionStatus = { ...old.extensionStatus }; if (event.text) extensionStatus[event.key] = event.text; else delete extensionStatus[event.key]; return { ...old, extensionStatus }; }); return; }
    if (event.type === 'ui.editor') { draftEpochs.current.set(id, (draftEpochs.current.get(id) ?? 0) + 1); setProjects(previous => previous.map(project => project.id === id ? { ...project, draft: event.text } : project)); return; }
    if (event.type === 'text.delta') { changeUI(id, old => old.finalReceived || old.status === 'idle' || (old.requestId && old.requestId !== event.requestId) ? old : ({ ...old, streaming: old.streaming + event.text, status: 'running', requestId: event.requestId })); return; }
    if (event.type === 'native') {
      const native = event.event;
      if (native.type === 'message_start' && native.message?.role === 'assistant') changeUI(id, old => ({ ...old, streaming: '', finalReceived: false }));
      if (native.type === 'tool_execution_start') changeUI(id, old => ({ ...old, toolStatus: `正在执行 ${native.toolName ?? '工具'}`, status: 'running' }));
      if (native.type === 'tool_execution_end') changeUI(id, old => ({ ...old, toolStatus: undefined }));
      if (native.type === 'message_end' && native.message) {
        const message = native.message; changeUI(id, old => {
          const snapshot = old.snapshot ?? { sessionId: id, messages: [], tools: [], status: 'running' as const, sdkVersion: '' };
          const previous = snapshot.messages.at(-1); const duplicate = previous && JSON.stringify(previous) === JSON.stringify(message);
          return { ...old, snapshot: { ...snapshot, messages: duplicate ? snapshot.messages : [...snapshot.messages, message] }, ...(message.role === 'assistant' ? { streaming: '', finalReceived: true } : {}), ...(message.role === 'user' ? { optimistic: undefined } : {}) };
        });
      }
      return;
    }
    if (event.type === 'run.settled') {
      changeUI(id, old => ({ ...old, status: 'idle', posting: false, toolStatus: undefined, streaming: '', optimistic: undefined, requestId: undefined, uiRequests: [], deferredRequestId: undefined, error: event.outcome === 'failed' ? event.error ?? '本次回复未完成，请检查配置后显式重试。' : undefined, failedPrompt: event.outcome === 'failed' ? old.failedPrompt : undefined, notice: event.outcome === 'cancelled' ? '已停止，已保存的部分输出仍保留。' : old.notice }));
      void refreshProject(id).catch(error => changeUI(id, old => ({ ...old, error: safeError(error) })));
    }
  };
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    void Promise.all([readConfigurations(controller.signal), listProjects(controller.signal)]).then(([models, saved]) => {
      if (controller.signal.aborted) return; setConfigurations(models.configurations); setSelectedId(models.selectedId); setProjects(saved); setActiveId(saved.at(-1)?.id); setHostStatus('ready');
      for (const project of saved) changeUI(project.id, old => ({ ...old, error: project.lastRun?.status === 'interrupted' ? '上次运行已中断，远端结果未知；不会自动重放。' : project.lastRun?.status === 'failed' ? '上次回复未完成，可在检查配置后继续。' : undefined }));
    }, error => { if (!controller.signal.aborted) { setHostStatus('unavailable'); setGlobalError(safeError(error)); } });
    return () => { mounted.current = false; controller.abort(); for (const stream of streams.current.values()) stream.abort(); streams.current.clear(); };
  }, []);
  const projectIds = projects.map(item => item.id).join(',');
  useEffect(() => { for (const id of projectIds.split(',').filter(Boolean)) connect(id); }, [projectIds]);
  useEffect(() => { const media = window.matchMedia('(max-width: 760px)'); const resize = () => setSidebarOpen(!media.matches); media.addEventListener('change', resize); resize(); return () => media.removeEventListener('change', resize); }, []);
  useEffect(() => { const media = window.matchMedia('(max-width: 1100px)'); const resize = () => setFilesOpen(!media.matches); media.addEventListener('change', resize); return () => media.removeEventListener('change', resize); }, []);
  useEffect(() => { if (view === 'chat') end.current?.scrollIntoView({ block: 'end' }); }, [current?.snapshot?.messages, current?.streaming, view]);
  const persistDraft = (id: string, text: string): Promise<void> => {
    const epoch = draftEpochs.current.get(id) ?? 0;
    setProjects(previous => previous.map(item => item.id === id ? { ...item, draft: text } : item)); changeUI(id, old => ({ ...old, draftSaving: true }));
    const previous = draftQueues.current.get(id) ?? Promise.resolve(); const next = previous.catch(() => {}).then(() => { if ((draftEpochs.current.get(id) ?? 0) === epoch) return saveDraft(id, text); }); draftQueues.current.set(id, next);
    void next.then(() => { if (draftQueues.current.get(id) === next) changeUI(id, old => ({ ...old, draftSaving: false })); }, () => { if (draftQueues.current.get(id) === next) changeUI(id, old => ({ ...old, draftSaving: false, error: '草稿尚未保存，请检查本地服务后继续。' })); }); return next;
  };
  const reconnect = async (id: string) => { changeUI(id, old => ({ ...old, error: undefined })); try { await refreshConfigurations(); await refreshProject(id); streams.current.get(id)?.abort(); streams.current.delete(id); connect(id); } catch (error) { changeUI(id, old => ({ ...old, error: safeError(error) })); } };
  const stop = async () => { if (!active || !busy || current?.status === 'stopping') return; const id = active.id; changeUI(id, old => ({ ...old, status: 'stopping' })); try { await stopProject(id); await refreshProject(id); } catch (error) { changeUI(id, old => ({ ...old, error: safeError(error), status: 'running' })); } };
  useEffect(() => { const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape' && view === 'chat' && !projectDialogOpen && !document.querySelector('dialog[open]') && busy) { event.preventDefault(); void stop(); } }; document.addEventListener('keydown', keyboard); return () => document.removeEventListener('keydown', keyboard); });
  const openWorkspace = (next: 'chat' | 'decision') => { lastWorkspace.current = next; setView(next); if (next === 'chat') requestAnimationFrame(() => textarea.current?.focus()); };
  const openCatalog = (next: CatalogCategory) => { setView(next); if (window.innerWidth <= 760) setSidebarOpen(false); };
  const createProject = async (name: string, configurationId: string) => { const project = await createDiskProject(name, configurationId); setProjects(previous => [...previous, project]); setActiveId(project.id); setProjectDialogOpen(false); setProjectListOpen(true); setFilesOpen(window.innerWidth > 1100); openWorkspace('chat'); if (window.innerWidth <= 760) setSidebarOpen(false); };
  const send = async (text = active?.draft ?? '', retry = false) => {
    if (!active || !text.trim() || busy || !current?.connected || current.status === 'connecting' || pending.current.has(active.id)) return;
    const id = active.id; const requestId = crypto.randomUUID(); const command = text.trim().startsWith('/'); pending.current.add(id);
    changeUI(id, old => ({ ...old, posting: true, status: 'running', error: undefined, notice: undefined, commandResult: undefined, streaming: '', finalReceived: false, requestId, failedPrompt: text, optimistic: command ? undefined : text }));
    try {
      if (!retry) await persistDraft(id, '');
      if (command) { const operation = runCommand(id, text.trim(), requestId); changeUI(id, old => ({ ...old, posting: false })); const result = await operation; applySnapshot(id, result.snapshot); changeUI(id, old => ({ ...old, commandResult: result.result == null ? undefined : typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2), status: 'idle', requestId: undefined })); }
      else await sendMessage(id, text, requestId);
    } catch (error) {
      let accepted = false; let recoveredStatus: 'idle' | 'running' | undefined;
      try { const restored = await refreshProject(id); accepted = restored.project.lastRun?.id === requestId; recoveredStatus = restored.snapshot.status; } catch {}
      changeUI(id, old => ({ ...old, status: recoveredStatus ?? (error instanceof HostRequestError ? 'idle' : 'connecting'), error: accepted ? old.error : error instanceof HostRequestError ? error.message : '发送状态尚未确认，请重新连接项目核对；不会自动重发。', failedPrompt: accepted || !(error instanceof HostRequestError) ? undefined : text, optimistic: accepted ? undefined : old.optimistic }));
    } finally { pending.current.delete(id); changeUI(id, old => ({ ...old, posting: false })); }
  };
  const respond = async (projectId: string, response: BrowserUIResponse) => {
    await answerInteraction(projectId, response);
    changeUI(projectId, old => ({ ...old, uiRequests: (old.uiRequests ?? []).filter(request => request.id !== response.id), deferredRequestId: old.deferredRequestId === response.id ? undefined : old.deferredRequestId }));
  };
  const openSettings = (trigger?: HTMLButtonElement) => { if (trigger) settingsTrigger.current = trigger; if (view !== 'settings') settingsReturnView.current = view; setView('settings'); if (window.innerWidth <= 760) setSidebarOpen(false); };
  const back = () => { setView(settingsReturnView.current); requestAnimationFrame(() => { if (settingsTrigger.current?.isConnected) settingsTrigger.current.focus(); else document.querySelector<HTMLButtonElement>('.model-button')?.focus(); }); };
  const pageTitle = view === 'chat' ? active?.name ?? '项目工作台' : view === 'settings' ? '设置' : view === 'decision' ? '决策工作台' : catalogMeta[view].label;
  const returnView = settingsReturnView.current; const settingsBackLabel = returnView === 'chat' ? '返回项目空间' : returnView === 'decision' ? '返回决策工作台' : returnView === 'settings' ? '返回项目空间' : `返回${catalogMeta[returnView].label}`;
  const messages = messagesOf(current?.snapshot); const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant' && messageText(message));
  const currentStatus = question ? 'Pi 等待你的回应' : current?.status === 'running' ? current.toolStatus ?? 'Pi 正在回复' : current?.status === 'stopping' ? '正在停止' : !current?.connected ? '项目连接待恢复' : current.draftSaving ? '正在保存草稿…' : '项目和历史已保存在本机';
  const message = (item: NativeMessage, index: number) => {
    const text = messageText(item); const calls = Array.isArray(item.content) ? item.content.filter(part => part.type === 'toolCall') : [];
    if (item.role === 'toolResult' || item.role === 'bashExecution') return <details key={`tool-${index}`} className={`tool-message ${item.isError ? 'tool-error' : ''}`}><summary>{item.toolName ?? (item.role === 'bashExecution' ? 'bash' : '工具结果')}{item.isError ? ' · 执行失败' : ' · 执行结果'}</summary>{item.command && <code>{item.command}</code>}<pre>{text || '无文本输出。'}</pre></details>;
    return <article key={`${item.role}-${item.timestamp ?? index}-${index}`} className={`message ${item.role}`}><div className="message-author">{item.role === 'assistant' || item.role === 'custom' ? <><BrandMark small /><strong>{item.role === 'custom' ? 'Pi 扩展' : 'OptraCall'}</strong><span>{item.role === 'custom' ? '扩展消息' : active?.configuration.model}</span></> : <><span className="user-mark">你</span><strong>你</strong></>}</div>{text && <div className="message-content">{text}</div>}{calls.map((call, callIndex) => <div className="tool-call" key={call.id ?? callIndex}>调用工具 · <code>{call.name}</code></div>)}{item.stopReason === 'aborted' && <p className="message-meta">已停止 · 部分输出已保留</p>}{item.stopReason === 'error' && <p className="message-meta failed-meta">此条回复未完成</p>}</article>;
  };
  return <div className="app" data-theme={theme} data-build="step4-persistent-agent-20261028">
    <a className="skip-link" href="#main-content">跳到主内容</a>
    {sidebarOpen && <aside id="sidebar" className="sidebar" aria-label="工作台导航">
      <div className="brand"><BrandMark small /><div><strong>OptraCall</strong><span>持续做出更好的决策</span></div></div>
      <button className="new-chat" aria-label="新建项目" onClick={() => setProjectDialogOpen(true)}><Icon name="plus" />新建项目</button>
      <button className={`nav-item ${view === 'chat' ? 'selected' : ''}`} aria-current={view === 'chat' ? 'page' : undefined} onClick={() => openWorkspace('chat')}><Icon name="folder" />项目工作台</button>
      <nav className="capability-nav" aria-label="能力目录">{catalogCategories.map(category => <button key={category} className={`nav-item ${view === category ? 'selected' : ''}`} aria-current={view === category ? 'page' : undefined} onClick={() => openCatalog(category)}><Icon name={catalogIcons[category]} />{catalogMeta[category].label}</button>)}</nav>
      <button className="history-heading project-list-heading" aria-expanded={projectListOpen} aria-controls="project-list" onClick={() => setProjectListOpen(value => !value)}>项目空间 ({projects.length})<span aria-hidden="true">{projectListOpen ? '⌄' : '›'}</span></button>
      <nav id="project-list" className="history" aria-label="项目空间列表" hidden={!projectListOpen}>{projects.length ? <ul>{[...projects].reverse().map(item => <li key={item.id}><button className={item.id === active?.id ? 'active' : ''} aria-current={item.id === active?.id ? 'true' : undefined} title={item.name} aria-label={item.name} onClick={() => { setActiveId(item.id); openWorkspace('chat'); if (window.innerWidth <= 760) setSidebarOpen(false); }}><Icon name="folder" size={17} /><span>{item.name}</span>{item.draft.length > 0 && <span className="draft-tag" aria-hidden="true">草稿</span>}{['running', 'stopping'].includes(ui[item.id]?.status ?? '') && <span className="running-dot" aria-label="正在生成" />}</button></li>)}</ul> : <p className="no-projects">{hostStatus === 'loading' ? '正在读取项目…' : '还没有项目'}</p>}</nav>
      <div className="sidebar-bottom"><button className={`nav-item ${view === 'settings' ? 'selected' : ''}`} aria-label="模型设置" aria-current={view === 'settings' ? 'page' : undefined} onClick={event => openSettings(event.currentTarget)}><Icon name="settings" />模型设置{config?.hasApiKey && <span className="configured-dot" aria-label="已保存本机配置" />}</button><div className="local-profile"><span className="avatar">O</span><div><strong>本地工作台</strong><span>项目与 Pi Agent</span></div></div></div>
    </aside>}
    <main id="main-content" className="main" tabIndex={-1}>
      <header className="topbar"><div className="topbar-context"><button className="icon-button" aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'} aria-expanded={sidebarOpen} aria-controls={sidebarOpen ? 'sidebar' : undefined} onClick={() => setSidebarOpen(value => !value)}><Icon name="panel" /></button><span className="topbar-title">{pageTitle}</span></div><div className="workspace-switch" role="group" aria-label="工作区切换"><button aria-pressed={view === 'chat'} onClick={() => openWorkspace('chat')}>分析</button><button aria-pressed={view === 'decision'} onClick={() => openWorkspace('decision')}>决策</button></div><div className="topbar-actions">{active && <button className="icon-button files-toggle" aria-label={filesOpen ? '收起项目文件' : '展开项目文件'} aria-expanded={filesOpen} aria-controls={filesOpen ? 'project-files' : undefined} onClick={() => setFilesOpen(value => !value)}><Icon name="panel" /></button>}<span className="demo-badge">Pi Agent</span><button className="icon-button" aria-label={theme === 'light' ? '切换为深色' : '切换为浅色'} onClick={() => setTheme(old => old === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button></div></header>
      {globalError && <div className="global-notice" role="alert"><span>{globalError}</span><button className="text-button" onClick={async () => { try { await refreshConfigurations(); const saved = await listProjects(); setProjects(saved); setActiveId(previous => previous ?? saved.at(-1)?.id); setGlobalError(''); } catch {} }}>重新连接</button></div>}
      <div className={`workbench-content ${filesOpen && active ? 'files-visible' : ''}`}><div className="workbench-view">
      {view === 'settings' ? <ModelSettings configurations={configurations} selectedId={selectedId} hostStatus={hostStatus} onChange={refreshConfigurations} onBack={back} backLabel={settingsBackLabel} /> : view === 'decision' ? <DecisionPage /> : view !== 'chat' ? <CatalogPage key={view} category={view} onCategoryChange={openCatalog} onBack={() => openWorkspace(lastWorkspace.current)} /> : !active ? <div className="project-start"><BrandMark /><p className="eyebrow">你好，欢迎来到 OptraCall</p><h1>从一个项目开始</h1><p>让问题、分析与决策，拥有同一个工作空间。</p><button className="primary-button" onClick={() => setProjectDialogOpen(true)}><Icon name="plus" />创建第一个项目</button><span>项目、文件与对话历史保存在本机</span></div> : <div className={`chat-page ${messages.length || current?.streaming || current?.optimistic ? 'has-messages' : ''}`}>
        {!messages.length && !current?.streaming && !current?.optimistic ? <div className="welcome"><BrandMark /><p className="eyebrow">项目空间</p><h1>{active.name}</h1><p>将分析资料放入 020_clean，然后告诉 Pi 你想了解什么。</p></div> : <div className="message-scroll"><div className="messages" role="log" aria-label="对话记录" aria-live="off">{messages.map(message)}{current?.optimistic && <article className="message user"><div className="message-author"><span className="user-mark">你</span><strong>你</strong><span>正在确认发送</span></div><div className="message-content">{current.optimistic}</div></article>}{current?.streaming && <article className="message assistant streaming-message"><div className="message-author"><BrandMark small /><strong>OptraCall</strong><span>正在回复</span></div><div className="message-content">{current.streaming}</div></article>}{busy && !current?.streaming && <p className="run-progress" role="status">{current?.toolStatus ?? 'Pi 正在处理…'}</p>}<div ref={end} /></div></div>}
        <div className="composer-area">
          {question && current?.deferredRequestId === question.id && <div className="pi-pending-notice" role="status"><span>Pi 等待回应：{question.title}</span><button className="secondary-button" onClick={() => changeUI(active.id, old => ({ ...old, deferredRequestId: undefined }))}>回应 Pi</button></div>}
          {current?.error && <div className="error-notice" role="alert"><Icon name="warning" /><div><strong>项目状态提示</strong><p>{current.error}</p></div>{current.failedPrompt && !busy && <button className="secondary-button" onClick={() => { void send(current.failedPrompt, true); }}>重试本次消息</button>}<button className="text-button" disabled={current?.posting} onClick={() => { void reconnect(active.id); }}>重新连接项目</button><button className="text-button" onClick={event => openSettings(event.currentTarget)}>模型设置</button></div>}
          {current?.notice && <p className="message-meta" role="status">{current.notice}</p>}
          {current?.extensionStatus && Object.keys(current.extensionStatus).length > 0 && <div className="pi-extension-status" role="status">{Object.entries(current.extensionStatus).map(([key, text]) => <p key={key}>{text}</p>)}</div>}
          {current?.commandResult && <details className="command-result" open><summary>Pi 命令结果</summary><pre>{current.commandResult}</pre></details>}
          <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }} aria-label="发送消息">
            <label className="sr-only" htmlFor="message-input">消息</label><textarea ref={textarea} id="message-input" value={active.draft} rows={3} placeholder="今天想讨论什么？" maxLength={20000} disabled={current?.posting} onChange={event => { void persistDraft(active.id, event.target.value).catch(() => {}); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!busy) void send(); } }} aria-describedby="composer-help" />
            <div className="composer-toolbar"><button type="button" className="model-button" onClick={event => openSettings(event.currentTarget)}><span className="model-dot" />{active.configuration.model}<span className="down-chevron">⌄</span></button><div className="composer-actions"><button className="text-button" type="button" aria-label="打开项目文件上传" onClick={() => setFilesOpen(true)}>＋ 文件</button>{busy ? <button className="stop-button" type="button" aria-label="停止生成" disabled={current?.status === 'stopping'} onClick={() => { void stop(); }}><Icon name="stop" size={15} />{current?.status === 'stopping' ? '正在停止' : '停止'}</button> : <button className="send-button" type="submit" aria-label="发送消息" disabled={!active.draft.trim() || !current?.connected || current?.status === 'connecting' || pending.current.has(active.id)} title="发送消息"><Icon name="arrow" size={20} /></button>}</div></div>
          </form>
          <div className="composer-helper"><span id="composer-help">Enter 发送 · Shift + Enter 换行{busy ? ' · Esc 停止' : ''}</span><span role="status" aria-live="polite">{currentStatus}</span></div>
          <div className="report-action-row">{lastAssistant && !busy && <button className="secondary-button" type="button" onClick={async () => { const id = active.id; try { await saveReport(id, messageText(lastAssistant)); setFilesRevision(previous => previous + 1); changeUI(id, old => ({ ...old, notice: '这条回复已明确保存为 060_reports 中的最终报告。' })); } catch (error) { changeUI(id, old => ({ ...old, error: safeError(error) })); } }}>将最新回复保存为最终报告</button>}</div>
          <details className="harness-panel"><summary>Pi 能力与命令</summary><p>可用工具：{current?.snapshot?.tools.join(' · ') || '正在读取'}</p><p>Python 通过 bash 执行。默认从 020_clean 读取分析资料并保存过程文件；最终报告由 Pi 写入 060_reports，也可明确保存。目录用途约定不提供敏感数据隔离。</p><div>{['/tools', '/skills', '/session', '/tree', '/compact', '/reload'].map(command => <button className="text-button" type="button" key={command} disabled={busy || !current?.connected} onClick={() => { void persistDraft(active.id, command).catch(() => {}); textarea.current?.focus(); }}>{command}</button>)}</div></details>
        </div>
        <footer className="workspace-footer">本机持久项目 · 020_clean 分析与过程 · 060_reports 最终报告 · 请勿上传敏感数据</footer>
      </div>}
      </div>{filesOpen && active && <ProjectFiles key={active.id} project={active} refreshToken={filesRevision} onClose={() => { setFilesOpen(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.files-toggle')?.focus()); }} />}</div>
    </main>
    {projectDialogOpen && <NewProjectDialog configurations={configurations} selectedId={selectedId} onCreate={createProject} onSettings={() => { setProjectDialogOpen(false); openSettings(); }} onClose={() => setProjectDialogOpen(false)} />}
    {active && question && view === 'chat' && current?.deferredRequestId !== question.id && !projectDialogOpen && <BrowserInteraction key={`${active.id}:${question.id}`} request={question} onAnswer={response => respond(active.id, response)} onLater={() => changeUI(active.id, old => ({ ...old, deferredRequestId: question.id }))} onStop={stop} onRestoreFocus={() => textarea.current?.focus()} />}
  </div>;
}
