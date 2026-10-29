import type { PublicModelConfiguration } from '../config-store.ts';
export type { PublicModelConfiguration };
export type ProjectConfiguration = Omit<PublicModelConfiguration, 'hasApiKey'>;
export type ClientTask = {
  id: string; name: string; draft: string; configuration: ProjectConfiguration;
  createdAt: string; updatedAt: string; sessionStorage: 'legacy' | 'task'; sessionFile?: string;
  lastRun?: { id: string; status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'; startedAt: string; settledAt?: string };
};
export type ClientProject = {
  schemaVersion: 2; id: string; name: string; configuration: ProjectConfiguration;
  rootPath: string; createdAt: string; updatedAt: string; archivedAt: string | null; tasks: ClientTask[];
};
export type TaskState = { project: ClientProject; task: ClientTask; snapshot: SessionSnapshot };
export const taskKey = (projectId: string, taskId: string) => `${projectId}/${taskId}`;
export type FileNode = { name: string; path: string; kind: 'file' | 'directory'; bytes?: number; children?: FileNode[] };
export type NativeContent = { type: string; text?: string; name?: string; id?: string; arguments?: unknown };
export type NativeMessage = { role: string; content?: string | NativeContent[]; timestamp?: number; toolCallId?: string; toolName?: string; isError?: boolean; stopReason?: string; command?: string; output?: string; display?: boolean; customType?: string };
export type BrowserUIRequest = { id: string; method: 'select' | 'confirm' | 'input' | 'editor'; title: string; message?: string; options?: string[]; placeholder?: string; prefill?: string; timeout?: number };
export type BrowserUIResponse = { id: string; value?: string | boolean; cancelled?: boolean };
export type SessionSnapshot = { sessionId: string; sessionFile?: string; messages: NativeMessage[]; tools: string[]; status: 'idle' | 'running'; sdkVersion: string; lastRun?: { requestId: string; outcome?: 'completed' | 'failed' | 'cancelled' }; uiRequests?: BrowserUIRequest[]; capabilities?: Record<string, unknown> };
export type ProjectEvent = ({ type: 'snapshot'; snapshot: SessionSnapshot } | { type: 'text.delta'; text: string; requestId: string } | { type: 'native'; event: { type: string; message?: NativeMessage; toolName?: string; [key: string]: unknown } } | { type: 'run.settled'; outcome: 'completed' | 'failed' | 'cancelled'; requestId: string; error?: string } | { type: 'ui.request'; requestId?: string; request: BrowserUIRequest } | { type: 'ui.dismiss'; id: string } | { type: 'ui.notification'; message: string; level?: string } | { type: 'ui.status'; key: string; text?: string } | { type: 'ui.editor'; text: string }) & { projectId?: string; taskId?: string };
export function messageText(message: NativeMessage): string { return typeof message.content === 'string' ? message.content : message.content?.filter(part => part.type === 'text').map(part => part.text ?? '').join('') ?? message.output ?? ''; }
