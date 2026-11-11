import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ProjectRecord, TaskRecord } from './project-store.ts';
import type { HistoricalReportFramework } from './report-calculation-materials.ts';
import { readNativeSessionSnapshot } from './native-session-snapshot.ts';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** Only the current native branch and its actual user messages prove past delivery.
 * No publication lookup, parent-file traversal, worker startup or history rewrite. */
export async function readHistoricalReportFrameworks(project: ProjectRecord, task: TaskRecord, requestId: string): Promise<HistoricalReportFramework[]> {
  if (!task.sessionFile) return [];
  const { manager } = await readNativeSessionSnapshot(task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean'));
  const result: HistoricalReportFramework[] = [];
  const deliveredVersions = new Set<string>();
  let pending: { requestId: string; sessionId: string; context: Record<string, unknown> } | undefined;
  for (const entry of manager.getBranch()) {
    if (entry.type === 'custom' && entry.customType === 'optracall.run') {
      const data: unknown = entry.data;
      if (!object(data) || data.phase !== 'started' && data.phase !== undefined) continue;
      pending = undefined;
      if (data.requestId === requestId || typeof data.requestId !== 'string' || typeof data.sessionId !== 'string' || !object(data.providedContext) || data.providedContext.version !== 1) continue;
      pending = { requestId: data.requestId, sessionId: data.sessionId, context: data.providedContext };
    }
    if (entry.type !== 'message' || entry.message.role !== 'user' || !pending) continue;
    const { requestId: deliveredRequest, sessionId, context } = pending;
    pending = undefined;
    const rap = context.rap;
    const content = entry.message.content;
    const text = typeof content === 'string' ? content : content.map(part => part.type === 'text' ? part.text : '').join('');
    if (!object(rap) || typeof rap.instanceId !== 'string' || typeof rap.text !== 'string' || !rap.text ||
      typeof context.requestTextSha256 !== 'string' || hash(text) !== context.requestTextSha256 || !text.includes(rap.text)) continue;
    const supplied = { instanceId: rap.instanceId, text: rap.text,
      ...(typeof rap.version === 'string' ? { version: rap.version } : {}),
      ...(typeof rap.frameworkVersion === 'string' ? { frameworkVersion: rap.frameworkVersion } : {}),
      ...(typeof rap.basisSha256 === 'string' ? { basisSha256: rap.basisSha256 } : {}),
    };
    // Repeated delivery of identical version and bytes needs one proof. This
    // does not choose a newer version or infer any user scope adjustment.
    const identity = hash(JSON.stringify(supplied));
    if (deliveredVersions.has(identity)) continue;
    deliveredVersions.add(identity);
    result.push({
      requestId: deliveredRequest, sessionId, entryId: entry.id,
      ...(typeof context.providedAt === 'string' ? { providedAt: context.providedAt } : {}),
      rap: supplied,
    });
  }
  return result;
}
