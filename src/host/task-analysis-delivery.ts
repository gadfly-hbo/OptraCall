import { createHash } from 'node:crypto';
import { canonicalDataContextValue } from './project-data-context-request.ts';
import path from 'node:path';
import { readNativeSessionSnapshot } from './native-session-snapshot.ts';
import { canonicalCandidateJson } from '../agent/agent-candidate.ts';
import type { AnalysisDeliveryReceipt } from './analysis-delivery.ts';
import type { ProjectRecord, TaskRecord } from './project-store.ts';
type NativeEntry = Awaited<ReturnType<typeof readNativeSessionSnapshot>>['entries'][number];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const equal = (left: unknown, right: unknown) => { try { return canonicalDataContextValue(left) === canonicalDataContextValue(right); } catch { return false; } };
function originalCall(byId: Map<string, NativeEntry>, entry: NativeEntry, requestId: string, sessionId: string, toolCallId: string, name: string) {
  let parent = entry.parentId, call: { arguments: unknown } | undefined;
  // Same ancestor/nearest-run qualification as the existing native context history.
  while (parent !== null) {
    const ancestor = byId.get(parent); if (!ancestor) return undefined;
    if (ancestor.type === 'message' && ancestor.message.role === 'assistant' && Array.isArray(ancestor.message.content)) {
      const found = ancestor.message.content.find(part => part.type === 'toolCall' && part.id === toolCallId && part.name === name);
      if (found?.type === 'toolCall') call ??= found;
    }
    if (ancestor.type === 'custom' && ancestor.customType === 'optracall.run') return object(ancestor.data) && ancestor.data.phase === 'started' && ancestor.data.requestId === requestId && ancestor.data.sessionId === sessionId ? call : undefined;
    parent = ancestor.parentId;
  }
  return undefined;
}
function containsAncestor(byId: Map<string, NativeEntry>, parent: string | null, id: string) { while (parent !== null) { if (parent === id) return true; const entry = byId.get(parent); if (!entry) return false; parent = entry.parentId; } return false; }
function nearestRun(byId: Map<string, NativeEntry>, entry: NativeEntry): NativeEntry | undefined {
  let parent = entry.parentId;
  while (parent !== null) { const ancestor = byId.get(parent); if (!ancestor) return undefined; if (ancestor.type === 'custom' && ancestor.customType === 'optracall.run') return ancestor; parent = ancestor.parentId; }
  return undefined;
}
/** Same exact-body / later saved-confirmation qualification as the existing candidate reader. */
function hasSaveConfirmation(entries: NativeEntry[], byId: Map<string, NativeEntry>, entry: NativeEntry, data: AnalysisDeliveryReceipt, terminal: NativeEntry): boolean {
  const started = nearestRun(byId, entry);
  if (!started || started.type !== 'custom' || !object(started.data) || started.data.phase !== 'started' || started.data.requestId !== data.requestId || started.data.sessionId !== data.sessionId) return false;
  const expected = { projectId: data.projectId, taskId: data.taskId, requestId: data.requestId, sessionId: data.sessionId, toolCallId: data.toolCallId, entryId: entry.id, sha256: createHash('sha256').update(canonicalCandidateJson(data)).digest('hex') };
  return entries.some(candidate => candidate.type === 'custom' && candidate.customType === 'optracall.analysis-delivery-receipt' && object(candidate.data) && candidate.data.schemaVersion === 1 && candidate.data.type === candidate.customType && candidate.data.status === 'saved' && equal(candidate.data.delivery, expected) && containsAncestor(byId, candidate.parentId, entry.id) && containsAncestor(byId, terminal.parentId, candidate.id) && nearestRun(byId, candidate)?.id === started.id);
}
function sourceIsCurrent(data: AnalysisDeliveryReceipt): boolean {
  if (data.reportSources !== undefined && !equal(data.reportSources, data.reports.map(report => ({ type: 'report', label: report.relativePath, ref: `project-report:${report.projectId}:${report.taskId}:${report.relativePath}`, version: report.sha256, sha256: report.sha256 })))) return false;
  if (data.source === undefined) return true;
  const { source, reportSources: _reports, ...basis } = data;
  return object(source) && source.type === 'session' && source.ref === `analysis-delivery:${data.projectId}:${data.taskId}:${data.requestId}:${data.sessionId}:${data.toolCallId}` && source.version === data.requestId && source.sha256 === createHash('sha256').update(canonicalDataContextValue(basis)).digest('hex');
}
function declaredArguments(argumentsValue: unknown, data: AnalysisDeliveryReceipt): boolean {
  if (!object(argumentsValue) || !Array.isArray(argumentsValue.reports) || !Array.isArray(data.reports) || !object(data.save)) return false;
  const fields = ['completion', 'format', 'summary', 'limitations', 'selfCheck', 'methodChecks', 'reviewBasis', 'caseFindings', 'assetFindings'];
  if (Object.keys(argumentsValue).some(key => ![...fields, 'reports', 'save'].includes(key)) || !equal(Object.fromEntries(fields.filter(key => argumentsValue[key] !== undefined).map(key => [key, argumentsValue[key]])), Object.fromEntries(fields.filter(key => (data as unknown as Record<string, unknown>)[key] !== undefined).map(key => [key, (data as unknown as Record<string, unknown>)[key]])))) return false;
  const declared = argumentsValue.reports;
  if (declared.some(ref => !object(ref) || Object.keys(ref).some(key => !['relativePath', 'sha256'].includes(key)) || !data.reports.some(report => report.relativePath === ref.relativePath && report.sha256 === ref.sha256))) return false;
  const save = argumentsValue.save;
  if (save === undefined && data.save.status !== 'not-requested' || save !== undefined && (!object(save) || Object.keys(save).sort().join(',') !== 'content,filename' || typeof save.filename !== 'string' || typeof save.content !== 'string' || data.save.status === 'not-requested')) return false;
  const saved = object(save) && ['saved', 'reused'].includes(data.save.status) ? { relativePath: '060_reports/' + save.filename, sha256: createHash('sha256').update(String(save.content)).digest('hex'), bytes: Buffer.byteLength(String(save.content)) } : undefined;
  if (saved && !data.reports.some(report => report.projectId === data.projectId && report.taskId === data.taskId && report.relativePath === saved.relativePath && report.sha256 === saved.sha256 && report.bytes === saved.bytes && (data.save.status !== 'saved' || report.requestId === data.requestId && report.sessionId === data.sessionId && report.toolCallId === data.toolCallId))) return false;
  return data.reports.every(report => report.projectId === data.projectId && report.taskId === data.taskId && (declared.some(ref => object(ref) && ref.relativePath === report.relativePath && ref.sha256 === report.sha256) || !!saved && report.relativePath === saved.relativePath && report.sha256 === saved.sha256 && report.bytes === saved.bytes));
}
function nestedProof(byId: Map<string, NativeEntry>, entry: NativeEntry, data: AnalysisDeliveryReceipt, saved: boolean): boolean {
  if (entry.type !== 'message' || entry.message.role !== 'toolResult' || entry.message.isError !== false) return false;
  const message = entry.message, nested = message.nestedCalls;
  if (!nested || !Array.isArray(nested.calls) || nested.calls.length > 256 || !data.toolCallId.startsWith(message.toolCallId + '/') || !originalCall(byId, entry, data.requestId, data.sessionId, message.toolCallId, message.toolName)) return false;
  const suffix = data.toolCallId.slice(message.toolCallId.length + 1); if (!/^[1-9]\d*(?:\/[1-9]\d*)*$/.test(suffix)) return false;
  let id = message.toolCallId;
  for (const segment of suffix.split('/')) { id += '/' + segment; const matches = nested.calls.filter(call => call.id === id); if (matches.length !== 1 || matches[0].status !== 'ok') return false; }
  const child = nested.calls.find(call => call.id === data.toolCallId)!;
  // Pi deliberately omits large arguments and can mark the aggregate incomplete.
  // The retained exact child status plus the verified original saved body still
  // qualifies that call; missing metadata is never reconstructed from parent text.
  return child.name === 'declare_analysis_delivery' && (child.arguments !== undefined ? declaredArguments(child.arguments, data) : saved);
}
/** An explicit qualified tool receipt in this original native session, followed by an actual completed run. */
export async function readTaskAnalysisDelivery(project: ProjectRecord, task: TaskRecord, requestId: string): Promise<AnalysisDeliveryReceipt | undefined> {
  if (!task.sessionFile) return undefined;
  const { manager } = await readNativeSessionSnapshot(task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean'));
  const entries = manager.getEntries();
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const terminal = [...entries].reverse().find(entry => entry.type === 'custom' && entry.customType === 'optracall.run' && (entry.data as any)?.sessionId === manager.getSessionId() && (entry.data as any)?.requestId === requestId && (entry.data as any)?.phase === 'settled');
  if (!terminal || terminal.type !== 'custom' || (terminal.data as any)?.outcome !== 'completed') return undefined;
  for (const entry of [...entries].reverse()) {
    if (entry.type !== 'custom' || entry.customType !== 'optracall.analysis-delivery') continue;
    const data = entry.data as AnalysisDeliveryReceipt | undefined;
    if (!data || data.schemaVersion !== 1 || data.type !== 'optracall.analysis-delivery' || data.projectId !== project.id || data.taskId !== task.id || data.requestId !== requestId || data.sessionId !== manager.getSessionId() || typeof data.toolCallId !== 'string' || data.claim !== 'declared-not-professionally-verified') continue;
    const saved = hasSaveConfirmation(entries, byId, entry, data, terminal);
    const saveClaim = entries.some(candidate => candidate.type === 'custom' && candidate.customType === 'optracall.analysis-delivery-receipt' && object(candidate.data) && object(candidate.data.delivery) && candidate.data.delivery.entryId === entry.id);
    const proof = entries.find(candidate => {
      if (candidate.type !== 'message' || candidate.message.role !== 'toolResult' || candidate.message.isError !== false || !containsAncestor(byId, candidate.parentId, entry.id) || !containsAncestor(byId, terminal.parentId, candidate.id)) return false;
      const message = candidate.message;
      if (message.toolName !== 'declare_analysis_delivery' || message.toolCallId !== data.toolCallId) return nestedProof(byId, candidate, data, saved);
      const call = originalCall(byId, candidate, data.requestId, data.sessionId, data.toolCallId, message.toolName);
      return !!call && declaredArguments(call.arguments, data) && equal(message.details, data);
    });
    if (!proof || saveClaim && !saved || !sourceIsCurrent(data)) throw Object.assign(new Error('analysis_delivery_receipt_unavailable'), { code: 'analysis_delivery_receipt_unavailable' });
    return structuredClone(data);
  }
  return undefined;
}

/** Verify only exact declared native provenance; this returns no session body for extraction. */
export async function qualifyAnalysisDeliverySource(project: ProjectRecord, task: TaskRecord, source: { ref: string; version: string | null; sha256: string | null }): Promise<void> {
  if (!task.sessionFile) throw Object.assign(new Error('method_issue_source_unavailable'), { code: 'method_issue_source_unavailable' });
  const { manager } = await readNativeSessionSnapshot(task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean'));
  for (const entry of manager.getEntries()) {
    if (entry.type !== 'custom' || entry.customType !== 'optracall.analysis-delivery') continue;
    const data = entry.data as AnalysisDeliveryReceipt;
    if (data.projectId === project.id && data.taskId === task.id && data.sessionId === manager.getSessionId() && data.source?.ref === source.ref && data.source.version === source.version && data.source.sha256 === source.sha256) { if (!sourceIsCurrent(data)) throw Object.assign(new Error('method_issue_source_changed'), { code: 'method_issue_source_changed' }); return; }
  }
  throw Object.assign(new Error('method_issue_source_unavailable'), { code: 'method_issue_source_unavailable' });
}
