import path from 'node:path';
import { createHash } from 'node:crypto';
import { createProjectEnablement } from '../../extensions/business-plugins/metric-factory/project/enablement.ts';
import { parseSapDraft } from '../../extensions/business-plugins/metric-factory/sap/validate.ts';
import { parseSemanticQueryInput } from '../../extensions/business-plugins/semantic-context/reader.ts';
import type { SemanticGraphSourceRef, StudioSemanticGraphSourceRef } from '../../extensions/business-plugins/semantic-context/graph.ts';
import type { SemanticGraphAuthority, SemanticGraphAuthorityCheck, SemanticGraphAuthorityContext, SemanticGraphAuthoritySource, SemanticGraphBinding } from './semantic-graph-service.ts';
import type { SemanticContextService } from './semantic-context-service.ts';
import type { ProjectStore } from './project-store.ts';
import type { ProjectDataContextStore } from './project-data-context-store.ts';
import type { EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import { canonical, readBytes, safePath } from './project-data-context-io.ts';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const object = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const allowedKinds = new Set(['sap', 'sap-method', 'enterprise', 'data-input', 'data-description', 'studio-source']);
const privateLocation = /(?:\/Users\/|\/home\/|\/private\/|\.codex\/attachments|synthetic_net_controls|credentials\.json)/;
const current = (ctx: SemanticGraphAuthorityContext) => { ctx.signal.throwIfAborted(); ctx.assertCurrent(); };

export type StudioGraphSourceContext = SemanticGraphAuthorityContext & { projectId: string; taskId: string };
export type StudioGraphSourceAuthority = {
  check(ref: StudioSemanticGraphSourceRef, context: StudioGraphSourceContext): Promise<SemanticGraphAuthorityCheck>;
  read(ref: StudioSemanticGraphSourceRef, context: StudioGraphSourceContext): Promise<{ state: SemanticGraphAuthorityCheck['state']; body: string | null; gaps: string[]; nature?: string }>;
};
const validStudioRef = (ref: StudioSemanticGraphSourceRef) => {
  const fields = ['kind', 'systemId', 'assetId', 'version', 'publishedHash', 'projectId'];
  return Object.keys(ref).every(key => fields.includes(key)) && fields.every(key => typeof ref[key as keyof StudioSemanticGraphSourceRef] === 'string' && ref[key as keyof StudioSemanticGraphSourceRef].length > 0 && !ref[key as keyof StudioSemanticGraphSourceRef].includes('\0')) && /^[a-f0-9]{64}$/.test(ref.publishedHash);
};

/** Source authorization stays with the real Host Stores, never a graph label. */
export function createSemanticGraphAuthority(options: {
  projectId: string; taskId: string; projects: ProjectStore; data: ProjectDataContextStore;
  enterprise: EnterpriseMaterialsStore; reader: SemanticContextService; dataRoot: string; binding: SemanticGraphBinding;
  studioSources?: StudioGraphSourceAuthority;
}): SemanticGraphAuthority {
  const enablement = () => createProjectEnablement(path.join(options.dataRoot, 'projects', options.projectId)).list();
  // This facet accepts exactly the verified snapshot declarations. Native Store
  // access alone must not turn a metric Ref into an entire-package read.
  let declarations: Promise<{ refs: Set<string>; builds: Set<string> }> | undefined;
  const declared = () => declarations ??= (async () => {
    if (!/^[a-f0-9-]{36}$/.test(options.binding.snapshotId)) throw new Error('semantic_graph_snapshot_invalid');
    const prefix = `snapshots/${options.binding.snapshotId}/`;
    const receipt = JSON.parse((await readBytes(await safePath(options.binding.runRoot, prefix + 'receipt.json'))).toString('utf8'));
    const file = receipt.files?.graph;
    if (receipt.snapshotId !== options.binding.snapshotId || file?.name !== 'graph.json') throw new Error('semantic_graph_snapshot_invalid');
    const bytes = await readBytes(await safePath(options.binding.runRoot, prefix + file.name), 32 * 1024 * 1024);
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error('semantic_graph_snapshot_invalid');
    const graph = JSON.parse(bytes.toString('utf8'));
    if (graph.graph_id !== receipt.snapshotId || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('semantic_graph_snapshot_invalid');
    const refs = new Set<string>(), builds = new Set<string>();
    for (const item of [...graph.nodes, ...graph.edges]) {
      for (const ref of item.properties.sourceRefs) refs.add(canonical(ref));
      for (const source of item.properties.buildSources) {
        const input = receipt.inputs.find((entry: any) => entry.inputKey === source.inputKey);
        if (!input) throw new Error('semantic_graph_snapshot_invalid');
        builds.add(canonical({ kind: 'build', inputKey: source.inputKey, locator: source.locator, sha256: input.sha256, nature: input.nature }));
      }
    }
    return { refs, builds };
  })();
  async function checked(ref: SemanticGraphSourceRef, ctx: SemanticGraphAuthorityContext, memo: Map<string, Promise<SemanticGraphAuthorityCheck>>, recursive = false): Promise<SemanticGraphAuthorityCheck> {
    current(ctx);
    const identity = canonical([recursive, ref]);
    const existing = memo.get(identity); if (existing) return existing;
    const promise = (async (): Promise<SemanticGraphAuthorityCheck> => {
      const reject = (state: SemanticGraphAuthorityCheck['state'], gap: string): SemanticGraphAuthorityCheck => ({ ref, state, gaps: [gap], revision: hash(canonical([ref, state, gap])) });
      try {
        if (!object(ref) || !allowedKinds.has(ref.kind) || 'sourceHandle' in ref) return reject('forbidden', 'source-kind-not-authorized');
        if (!recursive && !(await declared()).refs.has(canonical(ref))) return reject('forbidden', 'source-not-declared-by-snapshot');
        current(ctx);
        if (ref.kind === 'studio-source') {
          if (!validStudioRef(ref) || !options.studioSources) return reject('forbidden', 'studio-source-not-authorized');
          await options.projects.getTask(options.projectId, options.taskId); current(ctx);
          if ((await options.projects.get(options.projectId)).archivedAt !== null) return reject('forbidden', 'project-not-active');
          const checked = await options.studioSources.check(ref, { ...ctx, projectId: options.projectId, taskId: options.taskId }); current(ctx);
          if (checked.state === 'available' && checked.observedHash !== ref.publishedHash) return reject('hash-conflict', 'studio-source-hash-mismatch');
          if (!Array.isArray(checked.gaps) || checked.gaps.some(gap => typeof gap !== 'string')) return reject('unknown', 'studio-source-validation-failed');
          return { ...checked, ref, revision: checked.revision ?? hash(canonical([ref, checked.state, checked.gaps, checked.observedHash])) };
        }
        parseSemanticQueryInput({ action: 'read', target: ref });
        if ('projectId' in ref && ref.projectId !== options.projectId) return reject('forbidden', 'source-owner-mismatch');
        await options.projects.getTask(options.projectId, options.taskId); current(ctx);
        if ((await options.projects.get(options.projectId)).archivedAt !== null) return reject('forbidden', 'project-not-active');
        current(ctx);
        const enabled = enablement();
        if (ref.kind === 'sap' && !enabled.some(r => r.packageId === ref.packageId && r.version === ref.version)) return reject('forbidden', 'package-not-enabled-for-project');
        const result = await options.reader.query(options.projectId, options.taskId, { action: 'read', target: ref }, { signal: ctx.signal, assertCurrent: ctx.assertCurrent, audience: 'agent' });
        current(ctx);
        const item = result.items[0] ?? result.unknownTime[0];
        if (!item) return reject('missing', 'source-not-found');
        // Source-body pagination does not revoke an otherwise valid exact source.
        let state = item.state === 'partial' && !item.code ? 'available' as const : item.state;
        const gaps = item.gaps.filter(g => !g.startsWith('original-content-or-relations-continued') && !g.startsWith('oversized-original-metadata'));
        if (ref.kind === 'sap-method' && object(item.governance?.issue) && item.governance.issue.status === 'confirmed') state = 'excluded';
        if ((ref.kind === 'sap' || ref.kind === 'sap-method') && ref.publishedHash == null) gaps.push('missing-hash');
        if (state === 'available' && ref.kind === 'data-description') {
          const description = await options.data.readDescription(ref.projectId, ref.datasetId, ref.descriptionRevisionId); current(ctx);
          const refs: SemanticGraphSourceRef[] = description.mappings.flatMap(m => [...m.conceptRefs.map(r => ({ kind: 'enterprise' as const, ...r })), ...m.sapRefs.map(r => ({ kind: 'sap' as const, ...r }))]);
          const distinct = [...new Map(refs.map(r => [canonical(r), r])).values()];
          // Native M2 dependencies are checked internally for eligibility only;
          // they never become additional externally readable declarations.
          for (const source of distinct) { const qualified = await checked(source, ctx, memo, true); if (qualified.state !== 'available') return { ref, state: qualified.state, gaps: ['description-source-ineligible'], revision: qualified.revision }; }
        }
        let nativeRevision = '';
        if (ref.kind === 'enterprise' || ref.kind === 'sap-method') {
          const name = ref.kind === 'enterprise' ? 'enterprise-business-materials/index.json' : 'metric-assets/methods/index.json';
          nativeRevision = hash(await readBytes(await safePath(options.dataRoot, name), 16 * 1024 * 1024)); current(ctx);
        }
        const indexRevision = (await options.data.getIndex(options.projectId))?.revision ?? null; current(ctx);
        return { ref, state, gaps: [...new Set(gaps)], observedHash: item.sha256,
          revision: hash(canonical({ enabled, indexRevision, nativeRevision, state, sha256: item.sha256, governance: item.governance })) };
      } catch (error) {
        current(ctx);
        const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
        const state = /hash_conflict|hash_mismatch/.test(code) ? 'hash-conflict' : /unsafe|forbidden|owner/.test(code) ? 'forbidden' : /missing|not_found|NOT_FOUND|ENOENT/.test(code) ? 'missing' : 'unknown';
        return reject(state, 'source-validation-failed');
      }
    })(); memo.set(identity, promise); return promise;
  }
  async function checkMany(refs: SemanticGraphSourceRef[], ctx: SemanticGraphAuthorityContext) {
    if (!Array.isArray(refs) || refs.length > 4096) throw new Error('semantic_graph_source_limit');
    const memo = new Map<string, Promise<SemanticGraphAuthorityCheck>>();
    const results: SemanticGraphAuthorityCheck[] = [];
    for (const ref of refs) results.push(await checked(ref, ctx, memo));
    current(ctx); return results;
  }
  const blocked = (state: SemanticGraphAuthorityCheck['state'], gap: string) => ({ state, body: null, gaps: [gap] });
  async function readSource(source: SemanticGraphAuthoritySource, ctx: SemanticGraphAuthorityContext): ReturnType<SemanticGraphAuthority['readSource']> {
    current(ctx); await options.projects.getTask(options.projectId, options.taskId); current(ctx);
    let body: string | null = null, nature = 'source-projection';
    let qualificationGaps: string[] = [];
    if (source.kind === 'ref') {
      const before = (await checkMany([source.ref], ctx))[0]!;
      if (before.state !== 'available') return blocked(before.state, 'source-ineligible');
      const ref = source.ref;
      if (ref.kind === 'studio-source') {
        if (!options.studioSources || !validStudioRef(ref)) return blocked('forbidden', 'studio-source-not-authorized');
        const value = await options.studioSources.read(ref, { ...ctx, projectId: options.projectId, taskId: options.taskId }); current(ctx);
        if (value.state !== 'available' || typeof value.body !== 'string') return blocked(value.state, 'studio-source-unavailable');
        body = value.body; nature = value.nature ?? 'asset-publication';
      } else if (ref.kind === 'sap') {
        const library = typeof options.reader.options.metricLibrary === 'function' ? options.reader.options.metricLibrary() : options.reader.options.metricLibrary;
        const publication = library!.read(ref.packageId, ref.version);
        const document = parseSapDraft(new Uint8Array(Buffer.from(publication.canonicalYaml)));
        body = JSON.stringify(ref.metricName ? document.metrics.find(m => m.name === ref.metricName) : document.metrics);
      } else if (ref.kind === 'sap-method') {
        const original = options.reader.options.methodLibrary!.getPublished(ref.methodId, ref.version).version;
        body = JSON.stringify({ methodId: original.methodId, version: original.version, title: original.title, content: original.content, relation: original.relation });
      } else if (ref.kind === 'enterprise') {
        const revision = await options.enterprise.readRevision(ref.materialId, ref.revisionId, { readOnly: true });
        body = ref.location ? revision.body.slice(ref.location.start, ref.location.end) : revision.body;
      } else if (ref.kind === 'data-input') {
        const { record } = await options.data.readInputEvidence(ref.projectId, ref.datasetId, ref.inputVersionId);
        body = JSON.stringify({ kind: 'fixed-input-metadata', projectId: record.projectId, datasetId: record.datasetId, inputVersionId: record.inputVersionId, sha256: record.sha256, bytes: record.bytes });
      } else {
        const record = await options.data.readDescription(ref.projectId, ref.datasetId, ref.descriptionRevisionId);
        body = JSON.stringify({ projectId: record.projectId, datasetId: record.datasetId, inputVersionId: record.inputVersionId, descriptionRevisionId: record.descriptionRevisionId, statements: record.statements, mappings: record.mappings });
      }
      current(ctx);
      const after = (await checkMany([source.ref], ctx))[0]!;
      if (after.state !== 'available' || after.revision !== before.revision) return blocked('unknown', 'source-scope-changed');
      qualificationGaps = after.gaps;
    } else {
      const receiptPath = await safePath(options.binding.runRoot, `snapshots/${options.binding.snapshotId}/receipt.json`);
      const receipt = JSON.parse((await readBytes(receiptPath)).toString('utf8')); current(ctx);
      const input = receipt.inputs.find((r: any) => r.inputKey === source.inputKey);
      if (!input || source.sha256 !== input.sha256 || source.nature !== input.nature) return blocked('hash-conflict', 'frozen-source-identity-mismatch');
      if (!(await declared()).builds.has(canonical(source))) return blocked('forbidden', 'source-not-declared-by-snapshot');
      current(ctx);
      if (receipt.formatVersion === 2 && /^studio-[a-f0-9]{64}$/.test(source.inputKey)) {
        if (source.locator !== '/body' || source.nature !== 'asset-publication' || !/^inputs\//.test(input.relativePath)) return blocked('forbidden', 'nonsemantic-input-location');
        const raw = await readBytes(await safePath(options.binding.runRoot, input.relativePath), 1024 * 1024); current(ctx);
        if (raw.length !== input.bytes || hash(raw) !== input.sha256) return blocked('hash-conflict', 'frozen-input-changed');
        const original = JSON.parse(raw.toString('utf8'));
        if (!object(original) || !object(original.ref) || !allowedKinds.has(original.ref.kind) || typeof original.body !== 'string') return blocked('forbidden', 'invalid-studio-source');
        const fresh = await readSource({ kind: 'ref', ref: original.ref as SemanticGraphSourceRef }, ctx); current(ctx);
        if (fresh.state !== 'available' || fresh.body === null) return fresh;
        if (original.ref.kind === 'studio-source' && fresh.body !== original.body) return blocked('hash-conflict', 'frozen-source-body-mismatch');
        return { ...fresh, nature: 'asset-publication' };
      }
      const roots: Record<string, string[]> = {
        'metric-excerpt': ['/candidates', '/source_id', '/review_findings'], 'metric-publication': ['/metrics', '/package'],
        'method-publication': ['/content', '/sources', '/title', '/relation'],
        'enterprise-revision': ['/revisionId', '/title', '/scope', '/effectiveTime'],
        'input-version': ['/projectId', '/datasetId', '/inputVersionId', '/sha256', '/bytes'],
        'm2-description': ['/mappings', '/statements', '/descriptionRevisionId'],
        'synthetic-input': ['/scope', '/periods', '/synthetic_assumptions', '/conditions'],
      };
      if (!roots[source.inputKey]?.some(prefix => source.locator === prefix || source.locator.startsWith(prefix + '/'))) return blocked('forbidden', 'nonsemantic-input-location');
      if (!/^inputs\//.test(input.relativePath)) return blocked('forbidden', 'unsafe-input-location');
      const raw = await readBytes(await safePath(options.binding.runRoot, input.relativePath), 64 * 1024 * 1024); current(ctx);
      if (raw.length !== input.bytes || hash(raw) !== input.sha256) return blocked('hash-conflict', 'frozen-input-changed');
      let value: unknown = JSON.parse(raw.toString('utf8'));
      for (const token of source.locator.slice(1).split('/').map(t => t.replace(/~1/g, '/').replace(/~0/g, '~'))) {
        if (!object(value) && !Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, token) || ['__proto__', 'prototype', 'constructor'].includes(token)) return blocked('missing', 'source-location-missing');
        value = (value as Record<string, unknown>)[token];
      }
      body = typeof value === 'string' ? value : JSON.stringify(value); nature = input.nature;
    }
    current(ctx);
    if (body === undefined || body === null) return blocked('missing', 'source-location-missing');
    if (privateLocation.test(body)) return blocked('forbidden', 'private-source-location-withheld');
    return { state: 'available' as const, body, gaps: [...new Set([...qualificationGaps, 'semantic-fragment-not-full-original-record'])], nature };
  }
  return { checkMany, readSource };
}
