import path from 'node:path';
import fs from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import type { ProjectRecord, TaskRecord } from './project-store.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';
import type { SapMethodStore } from '../../extensions/business-plugins/metric-factory/methods/store.ts';
import type { SapMethodSource } from '../../extensions/business-plugins/metric-factory/methods/types.ts';
import { SapMethodStoreError, id, object, uuidPattern } from '../../extensions/business-plugins/metric-factory/methods/validate.ts';
import { createSapMethodSessions, type SapMethodOwner } from './sap-method-sessions.ts';
import { createSapMethodSources, type SapMethodAdditionalSources } from './sap-method-sources.ts';
import { atomicJson, canonical, digest, exists, isMissing, jsonBytes, parse, readBytes, safePath, writeExclusive } from './project-data-context-io.ts';
import type { SapMethodRouteResult, SapMethodSourceText } from './sap-method-routes.ts';
import type { SessionFilter } from './agent-sessions.ts';
import type { PersonalContextResult } from './personal-context-types.ts';
import type { SemanticQueryResult } from '../../extensions/business-plugins/semantic-context/types.ts';
import { readNativeSessionSnapshot } from './native-session-snapshot.ts';

export type SapMethodExtractionRecord = {
  schemaVersion: 1; requestId: string; projectId: string; taskId: string; incomplete: boolean;
  status: 'running' | 'saved' | 'reused' | 'empty' | 'failed' | 'cancelled' | 'unknown';
  configuration: { id: string; revision: number; provider: string };
  createdAt: string; settledAt?: string; methodId?: string; version?: number; message?: string; error?: string;
};
type SourceArchive = { source: SapMethodSource; text: string; payloadSha256: string; complete: boolean; limitation?: string; identity?: unknown;
  locator?: { kind: 'memory' | 'method'; input: Record<string, unknown> }; readerMetadata?: unknown };
type Options = {
  dataRoot: string; codeRoot: string; resourceRoot: string; store: SapMethodStore;
  enabled?: boolean;
  managementPorts(): number[];
  configurationSnapshot(id?: string, revision?: number): Readonly<RuntimeModelConfiguration> | null | undefined;
  pair(projectId: string, taskId: string, writable?: boolean): Promise<{ project: ProjectRecord; task: TaskRecord }>;
  sourceBusy(project: ProjectRecord, task: TaskRecord): boolean;
  mutate<T>(use: () => T | Promise<T>): Promise<T>; isClosing(): boolean;
  personal(action: 'find' | 'read', input: Record<string, unknown>, signal: AbortSignal): Promise<PersonalContextResult>;
  methods(projectId: string, taskId: string, action: 'find' | 'read', input: Record<string, unknown>, signal: AbortSignal, purpose?: 'human-fixed-preview'): Promise<SemanticQueryResult>;
  readBody(request: IncomingMessage): Promise<Record<string, unknown>>;
};
function failure(code: string, status = 409): never { throw new SapMethodStoreError(code, status); }
const errorCode = (error: unknown) => {
  const code = (error as { code?: unknown })?.code ?? (error instanceof Error ? error.message : 'METHOD_EXTRACTION_UNKNOWN');
  return typeof code === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,120}$/.test(code) ? code : 'METHOD_EXTRACTION_UNKNOWN';
};
const ownerOf = (record: SapMethodExtractionRecord) => ({ projectId: record.projectId, taskId: record.taskId, extractionId: record.requestId });

/** Business receipts are persisted here; the shared session domain alone owns busy/cancel/close. */
export function createSapMethodFeature(options: Options) {
  const extractionRelative = (requestId: string) => `metric-assets/methods/extractions/${id(requestId)}`;
  const recordPath = (requestId: string, create = false) => safePath(options.dataRoot, `${extractionRelative(requestId)}/record.json`, create);
  const readRecord = async (requestId: string): Promise<SapMethodExtractionRecord | null> => {
    try {
      const file = await recordPath(requestId);
      if (!await exists(file)) return null;
      const value = parse(await readBytes(file, 1024 * 1024));
      if (!object(value) || value.schemaVersion !== 1 || value.requestId !== id(requestId) || typeof value.projectId !== 'string' || typeof value.taskId !== 'string' || !uuidPattern.test(value.projectId) || !uuidPattern.test(value.taskId) || typeof value.incomplete !== 'boolean' || !object(value.configuration) || !['running', 'saved', 'reused', 'empty', 'failed', 'cancelled', 'unknown'].includes(String(value.status))) failure('METHOD_EXTRACTION_RECORD_CORRUPT');
      return value as SapMethodExtractionRecord;
    } catch (error) { if (isMissing(error)) return null; throw error; }
  };
  const writeRecord = async (record: SapMethodExtractionRecord) => { await atomicJson(await recordPath(record.requestId, true), record); return record; };
  const checkOwner = (record: SapMethodExtractionRecord, projectId: string, taskId: string) => {
    if (record.projectId !== projectId || record.taskId !== taskId) failure('METHOD_EXTRACTION_OWNER_MISMATCH', 403);
  };
  const admit = async (owner: SapMethodOwner) => {
    if (options.isClosing()) failure('METHOD_HOST_CLOSING');
    const { project, task } = await options.pair(owner.projectId, owner.taskId, true);
    if (task.configuration.id !== owner.configuration.id || task.configuration.revision !== owner.configuration.revision) failure('METHOD_CONFIGURATION_CHANGED');
    if (!options.configurationSnapshot(owner.configuration.id, owner.configuration.revision)) failure('METHOD_CONFIGURATION_REQUIRED');
    if (options.sourceBusy(project, task)) failure('METHOD_SOURCE_BUSY');
  };
  const archive = async (requestId: string, value: SourceArchive, key: string) => {
    const file = await safePath(options.dataRoot, `${extractionRelative(requestId)}/sources/${key}.json`, true);
    if (await exists(file)) {
      const old = parse(await readBytes(file, 50 * 1024 * 1024));
      if (canonical(old) !== canonical(value)) failure('METHOD_SOURCE_CONFLICT');
    } else await writeExclusive(file, jsonBytes(value));
  };
  const additional = (owner: SapMethodOwner, kind: 'memory' | 'method'): SapMethodAdditionalSources => async (action, input, context) => {
    context.assertCurrent(); context.signal.throwIfAborted(); await admit(owner);
    const result = kind === 'memory' ? await options.personal(action, input, context.signal)
      : await options.methods(owner.projectId, owner.taskId, action, input, context.signal);
    context.assertCurrent(); context.signal.throwIfAborted();
    const text = 'text' in result ? result.text : JSON.stringify(result);
    if (action === 'find') return { content: [{ type: 'text', text }], details: result };
    if ('coverage' in result && !result.items.some(item => item.body !== null && ['available', 'partial'].includes(item.state))) {
      return { content: [{ type: 'text', text }], details: { original: result, sources: [] } };
    }
    if ('details' in result && !result.details.items.some(item => ['full', 'fragment'].includes(item.extent))) {
      return { content: [{ type: 'text', text }], details: { original: result.details, sources: [] } };
    }
    // Keep exactly the returned fragment and its original reader metadata; a read is not adoption.
    const payloadSha256 = digest(text), key = digest(canonical({ kind, input, payloadSha256 }));
    const metadata = 'details' in result ? result.details : result;
    const target = object(input.target) ? input.target : input;
    const version = kind === 'method' && Number.isSafeInteger(target.version) ? String(target.version)
      : typeof target.revisionId === 'string' ? target.revisionId : object(target.candidate) && typeof target.candidate.expectedDetailsSha256 === 'string' ? target.candidate.expectedDetailsSha256 : null;
    const ref: SapMethodSource = { type: kind, label: kind === 'memory' ? '当次读取的准确记忆资料／片段' : '当次读取的已发布SAP方法／片段',
      ref: `sap-material:${owner.extractionId}:${key}`, version, sha256: payloadSha256 };
    const complete = 'coverage' in result ? result.coverage.complete : !result.details.partial;
    await archive(owner.extractionId, { source: ref, text, payloadSha256, complete, locator: { kind, input: structuredClone(input) }, readerMetadata: metadata, ...(!complete ? { limitation: '原读取回执明确为部分材料；未假定全文已读。' } : {}) }, key);
    return { content: [{ type: 'text', text: JSON.stringify({ source: ref, material: text, readerMetadata: metadata }) }], details: { original: metadata, sources: [ref] } };
  };
  const sessions = createSapMethodSessions({
    extractionRoot: path.join(options.dataRoot, 'metric-assets', 'methods', 'extractions'), codeRoot: options.codeRoot,
    resourceRoot: options.resourceRoot, managementPorts: options.managementPorts,
    configurationSnapshot: options.configurationSnapshot, mutate: options.mutate, isClosing: options.isClosing, admit,
    prepareSources: async owner => {
      const { project, task } = await options.pair(owner.projectId, owner.taskId, true);
      if (!task.sessionFile) failure('METHOD_SOURCE_SESSION_REQUIRED');
      const record = await readRecord(owner.extractionId);
      if (!record) failure('METHOD_EXTRACTION_NOT_FOUND', 404);
      const sources = await createSapMethodSources({ projectId: project.id, taskId: task.id, extractionId: owner.extractionId,
        sessionFile: task.sessionFile!, sessionDirectory: task.sessionDirectory, cwd: path.join(project.rootPath, '020_clean'),
        incomplete: record.incomplete, personal: additional(owner, 'memory'), methods: additional(owner, 'method') });
      await archive(owner.extractionId, { source: sources.sourceRef, identity: sources.sessionIdentity, text: sources.sessionText,
        payloadSha256: digest(sources.sessionText), complete: !record.incomplete,
        ...(record.incomplete ? { limitation: '来源分析尚未完成；这里只保留当时已有材料。' } : {}) }, 'session');
      return sources;
    },
  });
  // These promises only flush business receipts on shutdown; they never grant execution or deduplicate runs.
  const settlements = new Set<{ owner: SapMethodExtractionRecord; promise: Promise<void> }>();
  const run = (initial: SapMethodExtractionRecord, configuration: Readonly<RuntimeModelConfiguration>) => {
    const operation = sessions.execute({ ...ownerOf(initial), configuration }, async (outcome, context) => options.mutate(async () => {
      context.assertCurrent(); await admit({ ...ownerOf(initial), configuration }); context.assertCurrent();
      const current = await readRecord(initial.requestId);
      context.assertCurrent();
      if (!current || current.status !== 'running') failure('METHOD_EXTRACTION_NOT_CURRENT');
      if (outcome.kind === 'none') return writeRecord({ ...current, status: 'empty', settledAt: new Date().toISOString(), message: outcome.reason.slice(0, 2000) });
      if (outcome.kind === 'reuse') {
        const method = options.store.getPublished(outcome.methodId, outcome.version);
        return writeRecord({ ...current, status: 'reused', settledAt: new Date().toISOString(), methodId: method.version.methodId, version: method.version.version,
          message: method.issue?.status === 'confirmed' ? '仅关联原发布版本；该版有已知错误，停止默认推荐，历史保持。' : '完整复用原发布版本，仅关联准确来源，未生成重复方法。' });
      }
      const allowed = context.sources.references().map(ref => canonical(ref));
      const declared = outcome.sources ?? [];
      if (declared.some(ref => !allowed.includes(canonical(ref)))) failure('METHOD_SOURCE_NOT_PROVIDED');
      const sources = [context.sources.sourceRef, ...declared.filter(ref => canonical(ref) !== canonical(context.sources.sourceRef))];
      const prior = outcome.methodId ? options.store.read(outcome.methodId) : null;
      const saved = options.store.save({ requestId: current.requestId, title: outcome.title, content: outcome.content, sources,
        origin: prior?.origin ?? 'ir', ...(outcome.methodId ? { methodId: outcome.methodId, baseVersion: outcome.baseVersion } : {}), relation: outcome.relation ?? null });
      return writeRecord({ ...current, status: 'saved', settledAt: new Date().toISOString(), methodId: saved.version.methodId, version: saved.version.version,
        message: '方法已保存为未发布版本；发布成功后才可供后续任务参考。' });
    }));
    const pending = { owner: initial, promise: Promise.resolve() };
    pending.promise = operation.then(async result => {
      if (result.outcome === 'completed') return;
      await options.mutate(async () => {
        const current = await readRecord(initial.requestId); if (!current) return;
        await writeRecord({ ...current, status: current.methodId ? 'unknown' : result.outcome === 'cancelled' ? 'cancelled' : 'failed', settledAt: new Date().toISOString(),
          error: result.error ?? 'METHOD_EXTRACTION_FAILED', message: current.methodId ? '已保存结果保持，但提取资源终态未完整核定，请先查看原记录。' : '本次提取未完成；原分析与来源保持，未自动重试。' });
      });
    }).catch(async error => {
      await options.mutate(async () => {
        const current = await readRecord(initial.requestId); if (!current) return;
        const receipt = options.store.operation(initial.requestId);
        const saved = receipt?.kind === 'save' && receipt.status === 'committed' ? { methodId: receipt.methodId, version: receipt.version } : {};
        const code = errorCode(error), cancelled = /cancel|abort|generation_cancelled/i.test(code);
        const uncertain = Boolean(receipt || current.methodId || sessions.busy(ownerOf(initial)));
        await writeRecord({ ...current, ...saved, status: uncertain ? 'unknown' : cancelled ? 'cancelled' : 'failed', settledAt: new Date().toISOString(), error: code,
          message: uncertain ? '部分结果、关闭状态或写入回执未完全核定，已有记录保持；请先查看原记录，不会自动重跑。' : '本次提取未完成；原分析与来源保持，未自动重试。' });
      });
    }).catch(() => { /* An unreadable receipt remains UNKNOWN on the next explicit read, never replayed. */ })
      .finally(() => { settlements.delete(pending); });
    settlements.add(pending);
  };
  const read = async (projectId: string, taskId: string, requestId: string) => {
    await options.pair(projectId, taskId);
    const record = await options.mutate(() => readRecord(requestId)); if (!record) failure('METHOD_EXTRACTION_NOT_FOUND', 404);
    checkOwner(record, projectId, taskId);
    if (record.status === 'running') {
      if (!sessions.busy(ownerOf(record))) {
        const pending = [...settlements].find(entry => entry.owner.requestId === requestId);
        if (pending) { await pending.promise; const settled = await options.mutate(() => readRecord(requestId)); if (settled && settled.status !== 'running') return settled; }
        return { ...record, status: 'unknown' as const, message: '此提取没有可核定的在途资源；原记录保持，未自动恢复或重跑。' };
      }
    }
    return record;
  };
  const start = async (projectId: string, taskId: string, input: Record<string, unknown>) => options.mutate(async () => {
    if (options.enabled === false) failure('METHOD_FEATURE_DISABLED');
    const requestId = id(input.requestId);
    if (Object.keys(input).some(key => !['requestId', 'incomplete'].includes(key)) || typeof input.incomplete !== 'boolean') failure('METHOD_INPUT_INVALID', 400);
    const existing = await readRecord(requestId);
    if (existing) { checkOwner(existing, projectId, taskId); if (existing.incomplete !== input.incomplete) failure('METHOD_REQUEST_CONFLICT'); return existing; }
    const { project, task } = await options.pair(projectId, taskId, true);
    if (options.isClosing()) failure('METHOD_HOST_CLOSING');
    if (options.sourceBusy(project, task) || sessions.busyForTask(projectId, taskId)) failure('METHOD_SOURCE_BUSY');
    if (!task.sessionFile) failure('METHOD_SOURCE_SESSION_REQUIRED');
    if (!input.incomplete && task.lastRun?.status !== 'completed') failure('METHOD_SOURCE_INCOMPLETE');
    const configuration = options.configurationSnapshot(task.configuration.id, task.configuration.revision);
    if (!configuration) failure('METHOD_CONFIGURATION_REQUIRED');
    const record: SapMethodExtractionRecord = { schemaVersion: 1, requestId, projectId, taskId, incomplete: input.incomplete,
      status: 'running', configuration: { id: configuration.id, revision: configuration.revision, provider: configuration.provider }, createdAt: new Date().toISOString(), message: '正在按需查读来源并提炼；尚未保存或发布。' };
    await writeRecord(record);
    run(record, configuration);
    return record;
  });
  return {
    busyInScope: sessions.busyInScope,
    closeAll: sessions.closeAll,
    flushReceipts: async (filter: SessionFilter = {}) => { await Promise.all([...settlements].filter(entry => (!filter.projectId || entry.owner.projectId === filter.projectId) && (!filter.provider || entry.owner.configuration.provider === filter.provider)).map(entry => entry.promise)); },
    readSource: async (methodId: string, version: number, index: number): Promise<SapMethodSourceText> => {
      const method = options.store.read(methodId, version), selected = method.versions.find(item => item.version === version);
      const source = selected?.sources[index]; if (!source) failure('METHOD_SOURCE_NOT_FOUND', 404);
      const match = /^(sap-session|sap-material):([a-f0-9-]{36})(?::([a-f0-9]{64}))?$/.exec(source.ref);
      if (!match || (match[1] === 'sap-material' && !match[3])) return { label: source.label, text: '', complete: false, limitation: '此来源仅有定位信息，尚无可核定原文；未自动访问外部地址或猜测文件。' };
      const record = await options.mutate(() => readRecord(match[2]!)); if (!record) failure('METHOD_SOURCE_NOT_FOUND', 404);
      const { project, task } = await options.pair(record.projectId, record.taskId);
      const file = await safePath(options.dataRoot, `${extractionRelative(record.requestId)}/sources/${match[1] === 'sap-session' ? 'session' : match[3]}.json`);
      const value = parse(await readBytes(file, 50 * 1024 * 1024));
      if (!object(value) || canonical(value.source) !== canonical(source) || typeof value.text !== 'string' || value.payloadSha256 !== digest(value.text) || typeof value.complete !== 'boolean') failure('METHOD_SOURCE_CONFLICT');
      let governance: string | undefined, currentLimitation: string | undefined;
      if (match[1] === 'sap-material') {
        if (!object(value.locator) || !['memory', 'method'].includes(String(value.locator.kind)) || !object(value.locator.input)) {
          return { label: source.label, text: '', complete: false, limitation: '原固定材料保留，但缺少原来源准确定位，无法核对当前权限与治理；未重新提供正文。' };
        }
        try {
          const signal = AbortSignal.timeout(15_000), input = value.locator.input;
          const current = value.locator.kind === 'memory' ? await options.personal('read', input, signal)
            : await options.methods(record.projectId, record.taskId, 'read', input, signal, 'human-fixed-preview');
          if ('coverage' in current && !current.items.some(item => item.body !== null && ['available', 'partial'].includes(item.state))) {
            return { label: source.label, text: '', complete: false, limitation: '原来源当前缺失、权限失效或内容身份变化；固定材料与引用保留，未改读其他版本或重新提供正文。' };
          }
          if ('details' in current && !current.details.items.some(item => ['full', 'fragment'].includes(item.extent))) {
            return { label: source.label, text: '', complete: false, limitation: '原来源当前仅有元信息或正文已排除；固定材料与引用保留，未重新提供正文。' };
          }
          const metadata = 'details' in current ? current.details : current;
          if (canonical(metadata) !== canonical(value.readerMetadata)) {
            currentLimitation = '来源已有后续治理或读取状态变化；下方原文仍为提取当时的固定材料，当前治理另列。';
            if ('details' in current) {
              governance = JSON.stringify(current.details.items.map(item => ({ title: item.title, governance: item.governance, caution: item.caution, limitations: item.limitations })), null, 2);
              if (current.details.items.some(item => item.governance.latestCorrectionOperationId)) {
                const corrections = await options.personal('read', { target: input.target, part: 'corrections' }, signal);
                governance += '\n' + corrections.text.slice(0, 16000);
              }
            } else governance = JSON.stringify(current.items.map(item => ({ target: item.target, state: item.state, governance: item.governance, gaps: item.gaps })), null, 2);
          }
        } catch (error) {
          return { label: source.label, text: '', complete: false, limitation: `原来源当前治理、权限或准确版本无法核定（${errorCode(error)}）；固定材料与原引用保持，未重新提供正文或替换版本。` };
        }
      } else {
        try {
          if (!task.sessionFile || !object(value.identity)) throw new Error('METHOD_SOURCE_SESSION_UNAVAILABLE');
          const current = await readNativeSessionSnapshot(task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean'));
          if (current.sha256 !== value.identity.nativeSha256 || current.manager.getSessionId() !== value.identity.sessionId) currentLimitation = '原任务会话现已发生变化；以下保留本次提取当时的固定来源，未用当前会话替换。';
        } catch (error) { currentLimitation = `原任务会话当前无法核定（${errorCode(error)}）；以下仅为提取时保留的固定材料，原引用保持。`; }
      }
      let end = Math.min(value.text.length, 30_000);
      if (end > 0 && /[\uD800-\uDBFF]/.test(value.text[end - 1]!) && /[\uDC00-\uDFFF]/.test(value.text[end] ?? '')) end--;
      const partial = end < value.text.length;
      const limitation = [currentLimitation, partial ? `本次预览仅返回前${end}个UTF-16字符，完整固定材料共${value.text.length}字符；这不是全文覆盖证明。` : typeof value.limitation === 'string' ? value.limitation : undefined].filter(Boolean).join('\n');
      return { label: source.label, text: value.text.slice(0, end), complete: value.complete && !partial,
        ...(limitation ? { limitation } : {}), ...(governance ? { governance } : {}) };
    },
    handle: async (request: IncomingMessage, url: URL): Promise<SapMethodRouteResult | undefined> => {
      const match = /^\/api\/projects\/([a-f0-9-]{36})\/tasks\/([a-f0-9-]{36})\/sap-method-extractions(?:\/([a-f0-9-]{36})(?:\/(stop))?)?$/.exec(url.pathname);
      if (!match) return;
      try {
        const projectId = id(match[1]), taskId = id(match[2]), requestId = match[3] ? id(match[3]) : null;
        if (!requestId && request.method === 'POST') return { status: 202, value: { extraction: await start(projectId, taskId, await options.readBody(request)) } };
        if (requestId && !match[4] && request.method === 'GET') return { status: 200, value: { extraction: await read(projectId, taskId, requestId) } };
        if (requestId && match[4] === 'stop' && request.method === 'POST') {
          await options.readBody(request); await options.pair(projectId, taskId);
          // Revoke this exact public owner before waiting for the business mutation gate.
          await sessions.stop({ projectId, taskId, extractionId: requestId });
          await [...settlements].find(entry => entry.owner.requestId === requestId)?.promise;
          return { status: 200, value: { extraction: await read(projectId, taskId, requestId) } };
        }
        if (!requestId && request.method === 'GET') {
          await options.pair(projectId, taskId);
          let ids: string[] = [];
          try { const directory = path.dirname(await safePath(options.dataRoot, 'metric-assets/methods/extractions/.scan')); ids = (await fs.readdir(directory)).filter(name => uuidPattern.test(name)); }
          catch (error) { if (!isMissing(error)) throw error; }
          const records: SapMethodExtractionRecord[] = [];
          for (const key of ids) { const record = await options.mutate(() => readRecord(key)); if (record?.projectId === projectId && record.taskId === taskId) records.push(await read(projectId, taskId, key)); }
          return { status: 200, value: { extractions: records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) } };
        }
        return { status: 404, value: { code: 'METHOD_ROUTE_NOT_FOUND', message: '提取入口不存在。' } };
      } catch (error) {
        const status = error instanceof SapMethodStoreError ? error.status : typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 500;
        return { status, value: { code: errorCode(error), message: status >= 500 ? '提取回执未能完整核定，请保留原请求并先读取记录；未自动重跑。' : '当前来源或操作不可用，请核对项目、任务、模型和来源完整性；原材料保持。' } };
      }
    },
  };
}
