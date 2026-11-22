import { createHash } from 'node:crypto';
import path from 'node:path';
import type { StudioAssessmentEvidence, StudioSourceRef, StudioUseAssessment } from '../../extensions/business-plugins/studio/contracts.ts';
import { sourceRef, text } from '../../extensions/business-plugins/studio/validation.ts';

const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function projectFileLocator(value: unknown, directory: '020_clean' | '060_reports'): value is string {
  return typeof value === 'string' && value.startsWith(directory + '/') &&
    value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !/[\\\x00-\x1f\x7f]/u.test(part));
}

export function exactTaskReport(a: StudioSourceRef, b: StudioSourceRef): boolean {
  return a.authority === 'task' && b.authority === 'task' && !!a.projectId && !!a.taskId && !!a.locator && !!a.sha256
    && a.projectId === b.projectId && a.taskId === b.taskId && a.id === a.taskId && b.id === b.taskId
    && a.locator === b.locator && a.version === a.sha256 && b.version === b.sha256 && a.sha256 === b.sha256;
}

export function readCoversSource(actual: StudioSourceRef, required: StudioSourceRef): boolean {
  return actual.authority === required.authority && actual.id === required.id && actual.version === required.version
    && !!actual.sha256 && (required.sha256 === undefined || actual.sha256 === required.sha256)
    && (required.projectId === undefined || actual.projectId === required.projectId)
    && (required.taskId === undefined || actual.taskId === required.taskId)
    && (required.locator === undefined || actual.locator === required.locator);
}

export interface NativeEvidenceCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  index: number;
  turnIndex: number;
  entryId: string;
  sessionId: string;
}
export interface NativeEvidenceResult {
  call: NativeEvidenceCall;
  message: Record<string, any>;
  index: number;
}

export function collectNativeEvidence(messages: readonly Record<string, any>[]) {
  const calls: NativeEvidenceCall[] = [];
  const results: NativeEvidenceResult[] = [];
  const pending = new Map<string, NativeEvidenceCall>();
  let turnIndex = 0;
  for (const [index, message] of messages.entries()) {
    if (message.role === 'user') {
      turnIndex++;
      pending.clear();
    } else if (message.role === 'assistant' && typeof message.nativeEntryId === 'string' && typeof message.nativeSessionId === 'string') {
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block?.type !== 'toolCall' || typeof block.id !== 'string' || typeof block.name !== 'string' || !object(block.arguments)) continue;
        const call = { id: block.id, name: block.name, args: block.arguments, index, turnIndex, entryId: message.nativeEntryId, sessionId: message.nativeSessionId };
        calls.push(call);
        pending.set(call.id, call);
      }
    } else if (message.role === 'toolResult') {
      const call = pending.get(message.toolCallId);
      pending.delete(message.toolCallId);
      if (call && !message.isError && call.name === message.toolName) results.push({ call, message, index });
    }
  }
  return { calls, results };
}

export function nativeAssessmentEvidence(
  messages: readonly Record<string, any>[],
  systemId: string,
  studioUseId: string,
  assessment: StudioUseAssessment,
  resolveAssessmentLocator: (ref: StudioSourceRef) => StudioSourceRef,
) {
  const { nativeCall } = assessment;
  if (!nativeCall) return;
  const { calls, results } = collectNativeEvidence(messages);
  const boundaries = calls.filter(call => call.id === nativeCall.toolCallId && call.sessionId === nativeCall.sessionId);
  if (boundaries.length !== 1) return;
  const [boundary] = boundaries;
  if (!boundary || boundary.name !== 'studio_assets' || boundary.args.action !== 'assess-use' ||
      boundary.args.systemId !== systemId || !object(boundary.args.payload)) return;
  const { payload } = boundary.args;
  if (payload.useId !== studioUseId || payload.status !== assessment.status) return;
  try {
    if (!exactTaskReport(resolveAssessmentLocator(sourceRef(payload.report)), assessment.report)) return;
  } catch {
    return;
  }
  const carried = new Set(assessment.evidence?.carriedReadToolCallIds ?? []);
  return {
    boundary,
    results: results.filter(result => result.index < boundary.index && result.call.sessionId === boundary.sessionId &&
      (result.call.turnIndex === boundary.turnIndex || carried.has(result.call.id))),
  };
}

export function readNativeFileEvidence(
  read: NativeEvidenceResult,
  owner: { projectId: string; taskId: string; cleanDir: string; reportsDir: string },
): { locator: string; sha256: string; body: string } | undefined {
  const { call, message } = read;
  if (message.details?.truncation || call.args.limit !== undefined || (call.args.offset !== undefined && call.args.offset !== 1)) return;
  if (!Array.isArray(message.content) || message.content.length !== 1 ||
      message.content[0]?.type !== 'text' || typeof message.content[0]?.text !== 'string') return;
  const content = message.content[0].text as string;
  if (call.name === 'read_input') {
    const details = message.details;
    if (details?.type !== 'optracall.project-file-read' || details.projectId !== owner.projectId ||
        details.taskId !== owner.taskId || details.sessionId !== call.sessionId || details.toolCallId !== call.id ||
        typeof call.args.filename !== 'string' || call.args.filename.includes('/') ||
        details.relativePath !== '020_clean/' + call.args.filename ||
        !projectFileLocator(details.relativePath, '020_clean') || !/^[a-f0-9]{64}$/u.test(details.sha256)) return;
    const note = details.authorizedViewFiltered && typeof details.restrictionNote === 'string'
      ? '[Host 授权视图] ' + details.restrictionNote + '\n' : '';
    const body = note && content.startsWith(note) ? content.slice(note.length) : content;
    if (hash(body) === details.sha256 && Buffer.byteLength(body) === details.bytes) {
      return { locator: details.relativePath, sha256: details.sha256, body };
    }
    return;
  }
  if (call.name !== 'read' || typeof call.args.path !== 'string') return;
  const absolute = path.resolve(owner.cleanDir, call.args.path);
  for (const [directory, root] of [['020_clean', owner.cleanDir], ['060_reports', owner.reportsDir]] as const) {
    const locator = directory + '/' + path.relative(root, absolute);
    if (projectFileLocator(locator, directory)) return { locator, sha256: hash(content), body: content };
  }
}

export function parseStudioAssessmentEvidence(raw: unknown): StudioAssessmentEvidence | undefined {
  if (!object(raw)) return;
  try {
    const evidence: StudioAssessmentEvidence = { targetReport: sourceRef(raw.targetReport) };
    if (raw.purposeId !== undefined) evidence.purposeId = text(raw.purposeId, 200, false);
    if (Array.isArray(raw.carriedReadToolCallIds) && raw.carriedReadToolCallIds.length <= 200) {
      evidence.carriedReadToolCallIds = raw.carriedReadToolCallIds.map((id: unknown) => text(id, 200, false));
    }
    if (object(raw.coverage)) {
      const inputPaths = raw.coverage.inputPaths ?? [];
      if (!Array.isArray(inputPaths) || inputPaths.length > 200 ||
          !inputPaths.every(locator => projectFileLocator(locator, '020_clean'))) return;
      evidence.coverage = {
        scope: text(raw.coverage.scope, 2000, false),
        detail: text(raw.coverage.detail, 4000, false),
        inputPaths,
        ...(raw.coverage.summaryRef ? { summaryRef: sourceRef(raw.coverage.summaryRef) } : {}),
      };
    }
    if (object(raw.comparison)) {
      const { metrics } = raw.comparison;
      if (!Array.isArray(metrics) || metrics.length < 1 || metrics.length > 100 || !metrics.every(metric =>
        object(metric) && Number.isFinite(metric.reported) && Number.isFinite(metric.recomputed))) return;
      evidence.comparison = {
        metrics: metrics.map(metric => ({ name: text(metric.name, 200, false), reported: metric.reported, recomputed: metric.recomputed })),
        facts: text(raw.comparison.facts, 4000, false),
      };
    }
    if (object(raw.finding)) {
      if (!['wrong-version', 'mismatch', 'consistent'].includes(raw.finding.kind)) return;
      evidence.finding = {
        kind: raw.finding.kind,
        detail: text(raw.finding.detail, 4000, false),
        reportLocator: text(raw.finding.reportLocator, 1000, false),
        ...(raw.finding.sourceLocator ? { sourceLocator: text(raw.finding.sourceLocator, 1000, false) } : {}),
        ...(raw.finding.observedRef ? { observedRef: sourceRef(raw.finding.observedRef) } : {}),
      };
    }
    return evidence;
  } catch {
    return;
  }
}

export function readStudioEvidence(read: NativeEvidenceResult): {
  ref: StudioSourceRef; complete: boolean; range?: { start: number; end: number; total: number }; body?: string;
}[] {
  const { call, message } = read;
  const details = message.details;
  try {
    if (call.name === 'studio_assets' && details?.type === 'optracall.studio' &&
        call.args.action === details.action && ['read-source', 'read'].includes(details.action)) {
      const result = details.result;
      if (!result?.ref || typeof result.text !== 'string' || result.itemId || result.metricName) return [];
      return [{ ref: sourceRef(result.ref), complete: result.complete === true, body: result.text,
        ...(result.range?.unit === 'unicode-codepoints' ? { range: result.range } : {}) }];
    }
    if (call.name !== 'read_semantic_context' || details?.type !== 'optracall.semantic-context-result' ||
        !['read', 'trace'].includes(details.action)) return [];
    return (details.items ?? []).flatMap((item: any) => {
      const target = item?.target;
      if (typeof item?.body !== 'string' || !target || typeof item.sha256 !== 'string') return [];
      const base = { sha256: item.sha256 };
      const ref = target.kind === 'sap' ? { ...base, authority: 'sap-metric', id: target.packageId, version: target.version }
        : target.kind === 'sap-method' ? { ...base, authority: 'sap-method', id: target.methodId, version: String(target.version) }
        : target.kind === 'enterprise' ? { ...base, authority: 'enterprise', id: target.materialId, version: target.revisionId, locator: target.storeId }
        : target.kind === 'studio-source' ? { ...base, authority: 'studio-source', id: target.assetId, version: String(target.version), locator: target.systemId }
        : undefined;
      return ref ? [{ ref: sourceRef(ref), complete: item.complete === true, body: item.body }] : [];
    });
  } catch {
    return [];
  }
}

export function studioPagesComplete(reads: readonly ReturnType<typeof readStudioEvidence>[number][]): boolean {
  if (reads.some(read => read.complete)) return true;
  const ranges = reads.flatMap(read => read.range && read.body !== undefined &&
    Number.isSafeInteger(read.range.total) && read.range.start >= 0 && read.range.end <= read.range.total &&
    read.range.end - read.range.start === Array.from(read.body).length ? [read.range] : []);
  ranges.sort((a, b) => a.start - b.start);
  const total = ranges[0]?.total;
  if (!total || ranges.some(range => range.total !== total)) return false;
  let covered = 0;
  for (const range of ranges) {
    if (range.start > covered) return false;
    covered = Math.max(covered, range.end);
  }
  return covered === total;
}
