import type { BoardActionAuthorization, TaskFeedbackRevision } from '../../extensions/business-plugins/decision-board/types.ts';
import { listTaskBoundReports } from './project-task-result-sources.ts';
import type { ProjectStore } from './project-store.ts';

type ProjectReader = Pick<ProjectStore, 'get' | 'getTask'>;
type Arguments = Record<string, unknown>;
const object = (value: unknown): value is Arguments => !!value && typeof value === 'object' && !Array.isArray(value);
const callKey = (sessionId: string, requestId: string, callId: string) => JSON.stringify([sessionId, requestId, callId]);

/** Index only feedback calls in this Task's original native runs, including retained Pi child calls. */
async function readCalls(projects: ProjectReader, projectId: string, taskId: string) {
  const project = await projects.get(projectId);
  const task = await projects.getTask(projectId, taskId);
  const calls = new Map<string, Arguments | null>();
  await listTaskBoundReports(project, task, { onSession({ manager, entries }) {
    const session = manager.getSessionId();
    const runs = new Map<string, string>();
    function add(request: string, id: string, name: string, args: unknown) {
      if (name !== 'record_user_decision' || !object(args) || args.action !== 'record-feedback') return;
      const key = callKey(session, request, id);
      calls.set(key, calls.has(key) ? null : args);
    }
    for (const entry of entries) {
      let request = entry.parentId ? runs.get(entry.parentId) : undefined;
      if (entry.type === 'custom' && entry.customType === 'optracall.run') {
        const marker = entry.data;
        request = object(marker) && marker.phase === 'started' && marker.sessionId === session && typeof marker.requestId === 'string'
          ? marker.requestId : undefined;
      }
      if (!request) continue;
      runs.set(entry.id, request);
      if (entry.type !== 'message') continue;
      const message = entry.message;
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'toolCall') add(request, part.id, part.name, part.arguments);
        }
      } else if (message.role === 'toolResult' && message.nestedCalls) {
        for (const child of message.nestedCalls.calls) {
          if (child.status === 'ok' && child.id.startsWith(message.toolCallId + '/')) add(request, child.id, child.name, child.arguments);
        }
      }
    }
  } });
  return calls;
}

/** Compare the round named in the user's tool call with the Board assignment at the time of observation. */
export function quotedFeedbackMatches(projects: ProjectReader) {
  const tasks = new Map<string, ReturnType<typeof readCalls>>();
  return async (feedback: TaskFeedbackRevision, auth: BoardActionAuthorization) => {
    const quote = feedback.quoteProvenance, source = auth.source;
    if (!quote) return true;
    if (quote.projectId !== auth.projectId || 'kind' in source) return false;
    const owner = JSON.stringify([quote.projectId, quote.taskId]);
    if (!tasks.has(owner)) tasks.set(owner, readCalls(projects, quote.projectId, quote.taskId));
    const calls = await tasks.get(owner)!.catch(() => undefined);
    const args = calls?.get(callKey(quote.sessionId, quote.requestId, quote.toolCallId));
    if (!args || args.choiceId !== source.choiceId || args.taskId !== feedback.taskId || args.itemId !== auth.itemId) return false;
    const ref = args.strategyRef, range = args.quote;
    return object(ref) && ref.type === 'case-decision' && ref.caseStoreId === source.caseStoreId && ref.caseId === source.caseId &&
      ref.recordId === source.strategyRef.recordId && ref.revision === source.strategyRef.revision &&
      object(range) && range.text === quote.quote.text && range.start === quote.quote.start && range.end === quote.quote.end;
  };
}
