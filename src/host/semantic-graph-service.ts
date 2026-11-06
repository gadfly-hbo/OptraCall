import type { SemanticSourceState } from '../../extensions/business-plugins/semantic-context/types.ts';
import { parseSemanticGraphQuery, type SemanticGraphSourceRef, type SemanticGraphQuery, type SemanticGraphResult, type SemanticGraphNode, type SemanticGraphEdge, type SemanticGraphPath, type SemanticGraphMetadata, type SemanticGraphSnapshot, type SemanticGraphSource } from '../../extensions/business-plugins/semantic-context/graph.ts';
import { createHash, randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { runSemanticGraphProcess, type SemanticGraphProcessOptions } from './semantic-graph-process.ts';
import type { SemanticContextCallContext } from '../agent/semantic-context.ts';
import type { SemanticGraphBinding } from './semantic-graph-process.ts';
export type { SemanticGraphBinding } from './semantic-graph-process.ts';
export type SemanticGraphAuthorityCheck = { ref?: SemanticGraphSourceRef; state: SemanticSourceState; gaps: string[]; observedHash?: string | null; revision?: string };
export type SemanticGraphAuthoritySource = { kind: 'ref'; ref: SemanticGraphSourceRef } | { kind: 'build'; inputKey: string; locator: string; sha256: string; nature: string };
export type SemanticGraphAuthorityContext = { signal: AbortSignal; assertCurrent: () => void };
export type SemanticGraphAuthority = {
  checkMany: (refs: SemanticGraphSourceRef[], context: SemanticGraphAuthorityContext) => Promise<SemanticGraphAuthorityCheck[]>;
  readSource: (source: SemanticGraphAuthoritySource, context: SemanticGraphAuthorityContext) => Promise<{ state: SemanticSourceState; body: string | null; gaps: string[]; nature?: string }>;
};
export type SemanticGraphWorkerResult = {
  snapshot: SemanticGraphSnapshot; state: SemanticSourceState; nodes: SemanticGraphNode[]; edges: SemanticGraphEdge[];
  paths: SemanticGraphPath[]; gaps: string[]; exhausted: boolean; depthLimit?: number; depthReached?: number;
  currentRefs: SemanticGraphSourceRef[]; inputFingerprint: string; receiptSha256: string;
};
export class SemanticGraphServiceFault extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
type RunReadState = { owner: string; binding: SemanticGraphBinding; key: Buffer; identity?: string; sources: Map<string, SemanticGraphAuthoritySource> };
type Cursor = { kind: 'cursor'; query: string; identity: string; scope: string; offset: number; fragment: number };
type SourceToken = { kind: 'source'; query: string; identity: string; scope: string; source: SemanticGraphAuthoritySource };
type Unit = { nodes: SemanticGraphNode[]; edges: SemanticGraphEdge[]; paths: SemanticGraphPath[] };
const MAX_BYTES = 24 * 1024;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const pathKey = (path: SemanticGraphPath) => canonical([path.nodeIds, path.steps.map(step => [step.edgeId, step.direction])]);
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().filter(k => object[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(object[k])).join(',') + '}';
};
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const error = (code: string, status?: number) => new SemanticGraphServiceFault(code, status);
function seal(state: RunReadState, value: Cursor | SourceToken) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', state.key, iv);
  const ciphertext = Buffer.concat([cipher.update(canonical(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
function unseal(state: RunReadState, token: string): Cursor | SourceToken {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(token) || token.length > 4096) throw error('invalid');
    const bytes = Buffer.from(token, 'base64url'); if (bytes.toString('base64url') !== token || bytes.length < 29) throw error('invalid');
    const cipher = createDecipheriv('aes-256-gcm', state.key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')) as Cursor | SourceToken;
  } catch { throw error('semantic_graph_invalid_continuation'); }
}
function cleanRef(ref: SemanticGraphSourceRef): SemanticGraphSourceRef {
  const { sourceHandle: _handle, ...original } = ref; return original as SemanticGraphSourceRef;
}
function metadataSources(metadata: SemanticGraphMetadata): SemanticGraphAuthoritySource[] {
  return [...metadata.sourceRefs.map(ref => ({ kind: 'ref' as const, ref: cleanRef(ref) })),
    ...metadata.buildSources.filter(source => source.sha256 && source.nature).map(source => ({ kind: 'build' as const, inputKey: source.inputKey, locator: source.locator, sha256: source.sha256!, nature: source.nature! }))];
}
function utf16End(body: string, end: number) {
  if (end > 0 && end < body.length && /[\uD800-\uDBFF]/.test(body[end - 1]!) && /[\uDC00-\uDFFF]/.test(body[end]!)) return end - 1;
  return end;
}
const withinBudget = (value: SemanticGraphResult) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_BYTES;
function base(operation: SemanticGraphQuery['operation'], code?: string): SemanticGraphResult {
  return { schemaVersion: 1, type: 'optracall.semantic-graph-result', action: 'graph', operation, state: 'unknown', snapshot: null,
    nodes: [], edges: [], paths: [], sources: [], coverage: { complete: false, continuation: null, gaps: code ? [code] : [] }, ...(code ? { code } : {}) };
}

/** Recheck after the final asynchronous Store reads, without another job. */
async function verifySnapshot(binding: SemanticGraphBinding, expected: SemanticGraphWorkerResult) {
  const root = path.resolve(binding.runRoot);
  const read = async (relative: string) => {
    if (!relative || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw error('semantic_graph_snapshot_changed', 409);
    const parts = relative.split('/'); let directory = root;
    for (const part of ['', ...parts.slice(0, -1)]) {
      if (part) directory = path.join(directory, part);
      const stat = await lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw error('semantic_graph_snapshot_changed', 409);
    }
    const file = path.join(root, relative); const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw error('semantic_graph_snapshot_changed', 409);
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const actual = await handle.stat();
      if (!actual.isFile() || actual.nlink !== 1 || actual.dev !== before.dev || actual.ino !== before.ino || actual.size > 32 * 1024 * 1024) throw error('semantic_graph_snapshot_changed', 409);
      return await handle.readFile();
    } finally { await handle.close(); }
  };
  try {
    if (!/^[a-f0-9-]{36}$/.test(binding.snapshotId)) throw error('semantic_graph_snapshot_changed', 409);
    const prefix = `snapshots/${binding.snapshotId}/`;
    const bytes = await read(prefix + 'receipt.json');
    if (createHash('sha256').update(bytes).digest('hex') !== expected.receiptSha256) throw error('semantic_graph_snapshot_changed', 409);
    const receipt = JSON.parse(bytes.toString('utf8')) as { snapshotId: string; files: Record<string, {name:string;sha256:string;bytes:number}>; inputs: {relativePath:string;sha256:string;bytes:number}[] };
    if (receipt.snapshotId !== binding.snapshotId || hash(receipt.inputs) !== expected.inputFingerprint || receipt.inputs.length !== 9) throw error('semantic_graph_snapshot_changed', 409);
    for (const [kind, sha] of [['graph', expected.snapshot.graphSha256], ['ontology', expected.snapshot.ontologySha256]]) {
      const item = receipt.files[kind!]; if (!item || item.name.includes('/') || item.sha256 !== sha) throw error('semantic_graph_snapshot_changed', 409);
      const content = await read(prefix + item.name); if (content.length !== item.bytes || createHash('sha256').update(content).digest('hex') !== sha) throw error('semantic_graph_snapshot_changed', 409);
    }
    for (const item of receipt.inputs) {
      if (!item.relativePath.startsWith('inputs/')) throw error('semantic_graph_snapshot_changed', 409);
      const content = await read(item.relativePath);
      if (content.length !== item.bytes || createHash('sha256').update(content).digest('hex') !== item.sha256) throw error('semantic_graph_snapshot_changed', 409);
    }
  } catch { throw error('semantic_graph_snapshot_changed', 409); }
}

export function createSemanticGraphService(options: {
  bindingFor: (projectId: string, taskId: string) => SemanticGraphBinding | undefined;
  authorityFor: (projectId: string, taskId: string, binding: SemanticGraphBinding) => SemanticGraphAuthority;
  isClosing?: () => boolean;
  /** External trusted-Python seam. No query or runtime may supply this function. */
  runProcess?: (options: SemanticGraphProcessOptions) => Promise<SemanticGraphWorkerResult>;
}) {
  // Only transient read pins and cryptographic capabilities, keyed by the
  // existing Resource's actual run object. This is not a lifecycle authority.
  const runs = new WeakMap<object, RunReadState>();
  return { async query(projectId: string, taskId: string, input: unknown, context: SemanticContextCallContext): Promise<SemanticGraphResult> {
    let query: SemanticGraphQuery;
    try { query = parseSemanticGraphQuery(input); } catch { throw error('semantic_graph_invalid_query'); }
    const current = () => { context.signal.throwIfAborted(); context.assertCurrent(); if (options.isClosing?.()) throw error('semantic_graph_run_unavailable', 409); };
    current(); if (!context.runToken || typeof context.runToken !== 'object') throw error('semantic_graph_run_unavailable', 403);
    const owner = canonical([projectId, taskId, context.requestId, context.sessionId]);
    let state = runs.get(context.runToken);
    if (state && state.owner !== owner) throw error('semantic_graph_owner_mismatch', 403);
    if (!state) {
      const binding = options.bindingFor(projectId, taskId);
      if (!binding) return base(query.operation, 'semantic_graph_not_configured');
      state = { owner, binding: { ...binding }, key: randomBytes(32), sources: new Map() }; runs.set(context.runToken, state);
    }
    const run = state;
    const authority = options.authorityFor(projectId, taskId, run.binding);
    const authorityContext = { signal: context.signal, assertCurrent: current };
    const canonicalQuery = { ...query, continuation: null };
    if (query.operation === 'find' && query.nodeTypes) (canonicalQuery as { nodeTypes?: string[] }).nodeTypes = [...query.nodeTypes].sort();
    if (query.operation === 'neighbors' && query.relationTypes) (canonicalQuery as { relationTypes?: string[] }).relationTypes = [...query.relationTypes].sort();
    const queryHash = hash(canonicalQuery);
    let cursor: Cursor | undefined;
    if (query.continuation) {
      const decoded = unseal(run, query.continuation);
      if (decoded.kind !== 'cursor' || decoded.query !== queryHash || !Number.isSafeInteger(decoded.offset) || decoded.offset < 0 || !Number.isSafeInteger(decoded.fragment) || decoded.fragment < 0) throw error('semantic_graph_invalid_continuation');
      cursor = decoded;
    }
    const checks = new Map<string, SemanticGraphAuthorityCheck>();
    const checkMany = async (refs: SemanticGraphSourceRef[]) => {
      current(); const values = await authority.checkMany(refs, authorityContext); current();
      if (!Array.isArray(values) || values.length !== refs.length || values.some(value => !value || !Array.isArray(value.gaps) || typeof value.state !== 'string')) throw error('semantic_graph_authority_failed', 409);
      refs.forEach((ref, index) => {
        const key = canonical(cleanRef(ref)); const value = values[index]!;
        const prior = checks.get(key); if (prior && canonical(prior) !== canonical(value)) throw error('semantic_graph_scope_changed', 409);
        checks.set(key, value);
      });
      return values;
    };
    let worker: SemanticGraphWorkerResult;
    try {
      worker = await (options.runProcess ?? runSemanticGraphProcess<SemanticGraphWorkerResult>)({ binding: run.binding, query: canonicalQuery as Record<string, unknown>,
        signal: context.signal, assertCurrent: current, registerCleanup: context.registerCleanup,
        checkMany: refs => checkMany(refs as SemanticGraphSourceRef[]) });
    } catch (failure) {
      current();
      // Cleanup failures must reach the Resource, which retains its UNKNOWN
      // quarantine and retry handle. Never turn those into a successful read.
      const code = failure && typeof failure === 'object' && 'code' in failure && typeof failure.code === 'string' ? failure.code : 'semantic_graph_query_failed';
      if (/cleanup|scope_changed/.test(code)) throw failure;
      return base(query.operation, /^semantic_graph_[a-z0-9_-]{1,90}$/.test(code) ? code : 'semantic_graph_query_failed');
    }
    current();
    if (!worker?.snapshot || worker.snapshot.id !== run.binding.snapshotId || !Array.isArray(worker.currentRefs) || !Array.isArray(worker.nodes) || !Array.isArray(worker.edges) || !Array.isArray(worker.paths) || typeof worker.inputFingerprint !== 'string' || typeof worker.receiptSha256 !== 'string') return base(query.operation, 'semantic_graph_invalid_worker_result');
    const identity = hash([worker.snapshot, worker.inputFingerprint, worker.receiptSha256]);
    if (run.identity && run.identity !== identity) throw error('semantic_graph_snapshot_changed', 409);
    run.identity ??= identity;
    // Every original ref, including currently excluded ones, participates in
    // the private eligibility fingerprint. Hidden identities/counts stay here.
    const refs = [...new Map(worker.currentRefs.map(ref => [canonical(cleanRef(ref)), cleanRef(ref)])).values()].sort((a, b) => compare(canonical(a), canonical(b)));
    if (refs.some(ref => !checks.has(canonical(ref)))) throw error('semantic_graph_authority_failed', 409);
    await checkMany(refs);
    const scope = hash(refs.map(ref => [ref, checks.get(canonical(ref))]));
    if (cursor && (cursor.identity !== identity || cursor.scope !== scope)) throw error('semantic_graph_scope_changed', 409);
    const makeCursor = (offset: number, fragment = 0) => seal(run, { kind: 'cursor', query: queryHash, identity, scope, offset, fragment });
    const sourceHandle = (source: SemanticGraphAuthoritySource) => {
      const sourceKey = hash(source); run.sources.set(sourceKey, source);
      const payload = Buffer.concat([Buffer.from(queryHash, 'hex'), Buffer.from(scope, 'hex'), Buffer.from(sourceKey, 'hex')]);
      const mac = createHmac('sha256', run.key).update(identity).update(payload).digest().subarray(0, 16);
      return Buffer.concat([payload, mac]).toString('base64url');
    };
    const readSourceHandle = (token: string): SourceToken => {
      try {
        const bytes = Buffer.from(token, 'base64url'); if (bytes.length !== 112 || bytes.toString('base64url') !== token) throw error('invalid');
        const payload = bytes.subarray(0, 96); const mac = createHmac('sha256', run.key).update(identity).update(payload).digest().subarray(0, 16);
        if (!timingSafeEqual(bytes.subarray(96), mac)) throw error('invalid');
        const source = run.sources.get(bytes.subarray(64, 96).toString('hex')); if (!source) throw error('invalid');
        return { kind: 'source', identity, query: bytes.subarray(0, 32).toString('hex'), scope: bytes.subarray(32, 64).toString('hex'), source };
      } catch { throw error('semantic_graph_invalid_continuation'); }
    };
    const decorate = (metadata: SemanticGraphMetadata): SemanticGraphMetadata => ({ ...metadata,
      sourceRefs: metadata.sourceRefs.map(ref => { const original = cleanRef(ref); return { ...original, sourceHandle: sourceHandle({ kind: 'ref', ref: original }) }; }),
      buildSources: metadata.buildSources.map(source => ({ ...source, ...(source.sha256 && source.nature ? { sourceHandle: sourceHandle({ kind: 'build', inputKey: source.inputKey, locator: source.locator, sha256: source.sha256, nature: source.nature }) } : {}) })),
    });
    const result = base(query.operation); result.snapshot = worker.snapshot; result.state = worker.state;
    result.coverage = { complete: false, continuation: null, gaps: [...worker.gaps], ...(typeof worker.depthLimit === 'number' ? { depthLimit: worker.depthLimit, depthReached: worker.depthReached, exhausted: worker.exhausted } : {}) };
    const finish = async () => {
      await verifySnapshot(run.binding, worker); current();
      if (!withinBudget(result)) throw error('semantic_graph_output_limit', 409);
      // Current source qualification is the last asynchronous operation. A
      // revocation during snapshot IO must discard the prepared result, and
      // no unrelated IO may reopen that gap after this check.
      await checkMany(refs); current();
      return result;
    };
    if (query.operation === 'source') {
      const decoded = readSourceHandle(query.sourceHandle);
      if (decoded.kind !== 'source' || decoded.identity !== identity || decoded.scope !== scope) throw error('semantic_graph_source_handle_unavailable', 403);
      const availableSources = new Set([...worker.nodes, ...worker.edges].flatMap(item => metadataSources(item.metadata)).map(canonical));
      if (!availableSources.has(canonical(decoded.source))) throw error('semantic_graph_source_handle_unavailable', 403);
      current(); const source = await authority.readSource(decoded.source, authorityContext); current();
      if (source.state !== 'available' || typeof source.body !== 'string') {
        result.state = source.state; result.code = 'semantic_graph_source_unavailable'; result.coverage.gaps.push('source-unavailable'); return finish();
      }
      const start = cursor?.fragment ?? 0; if (start > source.body.length || utf16End(source.body, start) !== start) throw error('semantic_graph_invalid_continuation');
      const originalSource: SemanticGraphSource = { sourceHandle: query.sourceHandle,
        ...(decoded.source.kind === 'ref' ? { ref: decoded.source.ref } : { buildSource: { inputKey: decoded.source.inputKey, locator: decoded.source.locator, sha256: decoded.source.sha256, nature: decoded.source.nature as NonNullable<SemanticGraphSource['buildSource']>['nature'] } }),
        body: '', range: { start, end: start, total: source.body.length }, nature: source.nature ?? (decoded.source.kind === 'build' ? decoded.source.nature : 'original-source'), gaps: source.gaps };
      result.sources = [originalSource];
      let low = start; let high = source.body.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2); const end = utf16End(source.body, middle);
        originalSource.body = source.body.slice(start, end); originalSource.range!.end = end;
        result.coverage.continuation = end < source.body.length ? makeCursor(0, end) : null;
        if (withinBudget(result)) low = middle; else high = middle - 1;
      }
      const end = utf16End(source.body, low); originalSource.body = source.body.slice(start, end); originalSource.range!.end = end;
      result.coverage.continuation = end < source.body.length ? makeCursor(0, end) : null;
      result.coverage.complete = end === source.body.length && worker.exhausted;
      if (end === start && start < source.body.length) { result.sources = []; result.code = 'semantic_graph_too_large'; result.coverage.continuation = null; result.coverage.gaps.push('source-metadata-too-large'); }
      return finish();
    }
    const nodes = worker.nodes.map(node => ({ ...node, metadata: decorate(node.metadata) })).sort((a, b) => compare(a.id, b.id));
    const edges = worker.edges.map(edge => ({ ...edge, metadata: decorate(edge.metadata) })).sort((a, b) => compare(a.id, b.id));
    const nodeMap = new Map(nodes.map(node => [node.id, node])); const edgeMap = new Map(edges.map(edge => [edge.id, edge]));
    const paths = [...worker.paths].sort((a, b) => compare(pathKey(a), pathKey(b)));
    const units: Unit[] = (query.operation === 'dependencies' || query.operation === 'impact') && paths.length ? paths.map(path => ({
      nodes: [...new Set(path.nodeIds)].map(id => nodeMap.get(id)!), edges: [...new Set(path.steps.map(step => step.edgeId))].map(id => edgeMap.get(id)!), paths: [path],
    })) : query.operation === 'neighbors' && edges.length ? edges.map(edge => ({ nodes: [...new Set([edge.source, edge.target])].map(id => nodeMap.get(id)!), edges: [edge], paths: [] }))
      : nodes.map(node => ({ nodes: [node], edges: [], paths: [] }));
    if (units.some(unit => unit.nodes.some(node => !node) || unit.edges.some(edge => !edge))) return base(query.operation, 'semantic_graph_invalid_worker_result');
    const offset = cursor?.offset ?? 0; if (offset > units.length) throw error('semantic_graph_invalid_continuation');
    const selected: Unit[] = [];
    const apply = (values: Unit[]) => {
      result.nodes = [...new Map(values.flatMap(unit => unit.nodes).map(node => [node.id, node])).values()].sort((a, b) => compare(a.id, b.id));
      result.edges = [...new Map(values.flatMap(unit => unit.edges).map(edge => [edge.id, edge])).values()].sort((a, b) => compare(a.id, b.id));
      result.paths = values.flatMap(unit => unit.paths);
    };
    let next = offset;
    for (; next < units.length && selected.length < (query.pageSize ?? 20); next++) {
      apply([...selected, units[next]!]); result.coverage.continuation = next + 1 < units.length ? makeCursor(next + 1) : null;
      if (!withinBudget(result)) { apply(selected); break; }
      selected.push(units[next]!);
    }
    result.coverage.continuation = next < units.length ? makeCursor(next) : null;
    result.coverage.complete = next === units.length && worker.exhausted;
    if (next < units.length && !selected.length) {
      const unit = units[next]!;
      if (unit.nodes.length === 1 && !unit.edges.length && !unit.paths.length) {
        const node = unit.nodes[0]!; const body = node.content; const start = cursor?.fragment ?? 0;
        if (start > body.length || utf16End(body, start) !== start) throw error('semantic_graph_invalid_continuation');
        const fragment = { ...node, content: '', contentRange: { start, end: start, total: body.length } };
        result.nodes = [fragment]; result.coverage.gaps.push('semantic-content-fragment');
        let low = start; let high = body.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2); const end = utf16End(body, middle);
          fragment.content = body.slice(start, end); fragment.contentRange.end = end; result.coverage.continuation = makeCursor(next, end);
          if (withinBudget(result)) low = middle; else high = middle - 1;
        }
        const end = utf16End(body, low); fragment.content = body.slice(start, end); fragment.contentRange.end = end;
        result.coverage.continuation = end < body.length ? makeCursor(next, end) : next + 1 < units.length ? makeCursor(next + 1) : null;
        result.coverage.complete = end === body.length && next + 1 === units.length && worker.exhausted;
        if (end === start) { result.nodes = []; result.coverage.continuation = null; result.code = 'semantic_graph_too_large'; result.coverage.gaps.push('semantic-metadata-too-large'); }
      } else { result.nodes = []; result.edges = []; result.paths = []; result.code = 'semantic_graph_too_large'; result.coverage.continuation = null; result.coverage.gaps.push('complete-structure-unit-too-large'); }
    }
    if (result.code === 'semantic_graph_too_large' && next < units.length) {
      const entries = [...new Map([...units[next]!.nodes, ...units[next]!.edges].flatMap(item => metadataSources(item.metadata)).map(source => [canonical(source), source])).values()];
      result.coverage.gaps.push('bounded-qualified-source-entry-points');
      for (const source of entries) {
        const entry: SemanticGraphSource = { sourceHandle: sourceHandle(source),
          ...(source.kind === 'ref' ? { ref: source.ref } : { buildSource: { inputKey: source.inputKey, locator: source.locator, sha256: source.sha256, nature: source.nature as NonNullable<SemanticGraphSource['buildSource']>['nature'] } }),
          body: null, range: null, nature: source.kind === 'build' ? source.nature : 'original-source', gaps: ['source-entry-not-complete-graph-unit'] };
        result.sources.push(entry); if (!withinBudget(result)) { result.sources.pop(); break; }
      }
    }
    return finish();
  } };
}
