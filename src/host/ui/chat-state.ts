import type { Outcome, PresentationEvent } from '../../agent/events.ts';
export type { Outcome, PresentationEvent } from '../../agent/events.ts';
export type Message = {
  id: string; role: 'user' | 'assistant'; text: string;
  status: 'complete' | 'streaming' | 'cancelled' | 'failed'; finalReceived?: boolean;
};
export type ProjectSpace = {
  id: string; name: string; folders: readonly string[]; modelLabel: string; draft: string; messages: Message[];
  status: 'idle' | 'running' | 'stopping' | Outcome;
  activeRequestId?: string; failedPrompt?: string; error?: string;
};
export type ChatState = { activeId: string | null; projects: ProjectSpace[] };
export type Action =
  { type: 'create-project'; sessionId: string; name: string; modelLabel: string } |
  { type: 'select'; sessionId: string } |
  { type: 'draft'; sessionId: string; text: string } |
  { type: 'send'; sessionId: string; requestId: string; text: string; source?: 'composer' | 'retry' } |
  { type: 'stop'; sessionId: string; requestId: string } |
  { type: 'event'; event: PresentationEvent };
export type DemoConfig = { name: string; provider: string; baseUrl: string; model: string };
export type ConfigErrors = Partial<Record<'name' | 'baseUrl' | 'model', string>>;

export function isBusy(conversation: ProjectSpace): boolean {
  return conversation.status === 'running' || conversation.status === 'stopping';
}
export function createState(): ChatState {
  return { activeId: null, projects: [] };
}
export function reduceChat(state: ChatState, action: Action): ChatState {
  if (action.type === 'create-project') {
    const name = action.name.trim();
    if (!name || name.length > 60 || !action.sessionId || state.projects.some(item => item.id === action.sessionId)) return state;
    const project: ProjectSpace = { id: action.sessionId, name, folders: ['010_draw', '020_clean', '060_reports'], modelLabel: action.modelLabel, draft: '', messages: [], status: 'idle' };
    return { activeId: project.id, projects: [...state.projects, project] };
  }
  if (action.type === 'select') {
    return state.projects.some(item => item.id === action.sessionId) ? { ...state, activeId: action.sessionId } : state;
  }
  const sessionId = action.type === 'event' ? action.event.sessionId : action.sessionId;
  const index = state.projects.findIndex(item => item.id === sessionId);
  const current = state.projects[index];
  if (!current) return state;
  let next = current;
  if (action.type === 'draft') next = { ...current, draft: action.text };
  if (action.type === 'send') {
    const text = action.text.trim();
    if (isBusy(current) || !text) return state;
    next = { ...current, draft: action.source === 'retry' ? current.draft : '', status: 'running', activeRequestId: action.requestId, error: undefined, failedPrompt: undefined,
      messages: [...current.messages, { id: `${action.requestId}:user`, role: 'user', text, status: 'complete' }, { id: `${action.requestId}:assistant`, role: 'assistant', text: '', status: 'streaming', finalReceived: false }] };
  }
  if (action.type === 'stop') {
    if (current.activeRequestId !== action.requestId || current.status !== 'running') return state;
    next = { ...current, status: 'stopping' };
  }
  if (action.type === 'event') {
    const event = action.event;
    if (current.activeRequestId !== event.requestId || !isBusy(current)) return state;
    const messageId = `${event.requestId}:assistant`;
    const message = current.messages.find(item => item.id === messageId);
    if (!message) return state;
    if (event.type === 'text.delta' && message.finalReceived) return state;
    if (event.type === 'text.delta' || event.type === 'message.final') {
      const updated = event.type === 'text.delta'
        ? { ...message, text: message.text + event.text }
        : { ...message, text: event.text, finalReceived: true };
      next = { ...current, messages: current.messages.map(item => item.id === messageId ? updated : item) };
    } else {
      const missingFinal = event.outcome === 'completed' && !message.finalReceived;
      const outcome = missingFinal ? 'failed' : event.outcome;
      const error = missingFinal ? '未收到完整消息，未标记为成功。' : event.error;
      const prompt = [...current.messages].reverse().find(item => item.role === 'user')?.text;
      next = { ...current, status: outcome, activeRequestId: undefined, error,
        failedPrompt: outcome === 'failed' ? prompt : undefined,
        messages: current.messages.map(item => item.id === messageId ? { ...item, status: outcome === 'completed' ? 'complete' : outcome } : item) };
    }
  }
  if (next === current) return state;
  return { ...state, projects: state.projects.map((item, i) => i === index ? next : item) };
}
export function validateConfig(config: DemoConfig): ConfigErrors {
  const errors: ConfigErrors = {};
  if (!config.name.trim()) errors.name = '请为这份演示配置命名。';
  if (!config.model.trim()) errors.model = '请输入模型名称。';
  try {
    const url = new URL(config.baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('invalid');
  } catch {
    errors.baseUrl = '请输入完整的 HTTP 或 HTTPS 地址，不包含账户凭据。';
  }
  return errors;
}
