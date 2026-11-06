import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createMetricLibrary } from '../../extensions/business-plugins/metric-factory/library/store.ts';
import { createProjectEnablement } from '../../extensions/business-plugins/metric-factory/project/enablement.ts';
import { preparePublication } from '../../extensions/business-plugins/metric-factory/sap/validate.ts';
import { createSapMethodStore } from '../../extensions/business-plugins/metric-factory/methods/store.ts';
import type { SapMethodContent } from '../../extensions/business-plugins/metric-factory/methods/types.ts';
import { EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import type { EnterpriseMaterialFields } from './enterprise-materials-types.ts';
import { ProjectStore, type ProjectConfiguration } from './project-store.ts';
import { ProjectDataContextStore } from './project-data-context-store.ts';
import { createProjectDataContextReferences } from './project-data-context-references.ts';
import type { DataContextMapping, DataContextStatement } from './project-data-context-types.ts';
import { canonical } from './project-data-context-io.ts';

export type TrialAssetSource = { path: string; sha256: string };
export type TrialMetricName = 'terminal_sales_amount' | 'retail_refund_amount' | 'net_retail_sales';
/** Engineering input only; not a new product document or persistent authority. */
export type TrialSemantics = {
  enterprise: Omit<EnterpriseMaterialFields, 'sourceFileId'>;
  fieldRules: { pointerPattern: string; meaning: string; metricNames: TrialMetricName[]; unit: string | null }[];
  statements: { scope: DataContextStatement['scope']; text: string; pointer?: string; unit?: string | null }[];
};
export type TrialAssetOptions = {
  dataRoot: string; projectsRoot: string; projectName: string;
  configuration: ProjectConfiguration; publishedBy: string;
  sources: Record<'analysisInput' | 'sapPackage' | 'method' | 'metricExcerpt' | 'semantics', TrialAssetSource>;
};
/** Caller-held continuation of original Store operations, not a second Store or
 * automatic recovery loop. Original operation UUIDs remain authoritative.
 */
export type SemanticAssetContinuation = {
  schemaVersion: 1; inputFingerprint: string; stage: string; projectId?: string;
  methodSaveRequestId: string; methodPublishRequestId: string;
  enterpriseMaterialId?: string; enterpriseRevisionId?: string;
  datasetId: string; inputVersionId: string; descriptionRevisionId: string;
  mappingIds: string[]; statementIds: string[]; descriptionBaseIndexRevision?: number;
  metricEnabledAt?: string;
  metricEnableAttempted?: true;
};
export class SemanticAssetPreparationError extends Error {
  readonly continuation: SemanticAssetContinuation;
  constructor(cause: unknown, continuation: SemanticAssetContinuation) {
    super(cause instanceof Error ? cause.message : 'semantic_adoption_interrupted', { cause });
    this.name = 'SemanticAssetPreparationError'; this.continuation = structuredClone(continuation);
  }
}
const metricNames: TrialMetricName[] = ['terminal_sales_amount', 'retail_refund_amount', 'net_retail_sales'];
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const contains = (parent: string, child: string) => { const relative = path.relative(parent, child); return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const escaped = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
const forbiddenKeys = new Set(['gold', 'reference_answer', 'target_totals', 'readiness', 'synthetic_net_controls']);

async function sourceBytes(source: TrialAssetSource): Promise<Buffer> {
  if (!path.isAbsolute(source.path) || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('S5 requires an explicit absolute source and SHA-256.');
  const before = await fs.lstat(source.path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 10n * 1024n * 1024n) throw new Error('S5 unsafe source file.');
  const handle = await fs.open(source.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true }), bytes = await handle.readFile(), after = await handle.stat({ bigint: true }), current = await fs.lstat(source.path, { bigint: true });
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.nlink !== 1n || opened.size !== before.size || BigInt(bytes.length) !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs || current.ino !== opened.ino || current.dev !== opened.dev || current.mtimeNs !== opened.mtimeNs || current.ctimeNs !== opened.ctimeNs || current.nlink !== 1n || current.isSymbolicLink() || hash(bytes) !== source.sha256) throw new Error('S5 source bytes changed.');
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return bytes;
  } finally { await handle.close(); }
}
function rejectControls(value: unknown): void {
  if (Array.isArray(value)) value.forEach(rejectControls);
  else if (object(value)) for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key.toLowerCase())) throw new Error('S5 semantic source contains evaluation/control fields.');
    rejectControls(child);
  }
}
function analysisView(value: unknown, removed: string[], pointer = ''): unknown {
  if (Array.isArray(value)) return value.map((child, index) => analysisView(child, removed, pointer + '/' + index));
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const location = pointer + '/' + escaped(key);
    if (key.toLowerCase() === 'synthetic_net_controls') { removed.push(location); return []; }
    return [[key, analysisView(child, removed, location)]];
  }));
}
function leaves(value: unknown, pointer = ''): { pointer: string; value: unknown }[] {
  if (Array.isArray(value)) return value.flatMap((child, index) => leaves(child, pointer + '/' + index));
  if (object(value)) return Object.entries(value).flatMap(([key, child]) => leaves(child, pointer + '/' + escaped(key)));
  return [{ pointer, value }];
}
function matches(pattern: string, pointer: string) {
  const parts = pattern.split('/'), actual = pointer.split('/');
  return parts.length === actual.length && parts.every((part, index) => part === '*' && /^\d+$/.test(actual[index]!) || part === actual[index]);
}
function semanticsInput(value: unknown): TrialSemantics {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'enterprise,fieldRules,statements' || !object(value.enterprise) || !Array.isArray(value.fieldRules) || !Array.isArray(value.statements)) throw new Error('S5 invalid semantic preparation input.');
  const fields = ['title', 'category', 'body', 'source', 'owner', 'scope', 'effectiveTime'];
  const enterprise = value.enterprise;
  if (Object.keys(enterprise).sort().join(',') !== fields.sort().join(',') || !fields.every(key => typeof enterprise[key] === 'string')) throw new Error('S5 requires explicit deidentified enterprise fields.');
  for (const rule of value.fieldRules) {
    if (!object(rule) || typeof rule.pointerPattern !== 'string' || !rule.pointerPattern.startsWith('/') || /~(?![01])/.test(rule.pointerPattern) || typeof rule.meaning !== 'string' || !rule.meaning.trim() || !Array.isArray(rule.metricNames) || !rule.metricNames.every(name => metricNames.includes(name as TrialMetricName)) || rule.unit !== null && typeof rule.unit !== 'string') throw new Error('S5 invalid explicit field rule.');
  }
  for (const statement of value.statements) if (!object(statement) || !['row-meaning', 'business-time', 'field', 'source-and-limitations'].includes(String(statement.scope)) || typeof statement.text !== 'string' || !statement.text.trim() || statement.pointer !== undefined && typeof statement.pointer !== 'string' || statement.scope === 'field' && statement.pointer === undefined) throw new Error('S5 invalid explicit statement.');
  rejectControls(value);
  return value as unknown as TrialSemantics;
}

/** Taskless, single-writer engineering preparation. The returned paths are Host-only receipts.
 * No task, Provider, graph builder, runtime or model tool is created here.
 */
export async function prepareSemanticTrialAssets(options: TrialAssetOptions) {
  return prepareSemanticAssetStores(options, 'trial');
}

/** Shared original Store calls. Adoption is an explicit offline Host operation;
 * the trial entry above always retains its empty-Store guard.
 */
export async function prepareSemanticAssetStores(options: TrialAssetOptions, mode: 'trial' | 'adoption', suppliedContinuation?: SemanticAssetContinuation) {
  const { dataRoot, projectsRoot } = options;
  if (![dataRoot, projectsRoot].every(root => root && path.isAbsolute(root)) || contains(path.resolve(dataRoot), path.resolve(projectsRoot)) || contains(path.resolve(projectsRoot), path.resolve(dataRoot))) throw new Error('S5 requires explicit separate absolute Store roots.');
  const keys = ['analysisInput', 'sapPackage', 'method', 'metricExcerpt', 'semantics'] as const;
  const sources = {} as Record<typeof keys[number], Buffer>;
  for (const key of keys) {
    const source = options.sources[key];
    if ([dataRoot, projectsRoot].some(root => contains(path.resolve(root), path.resolve(source.path)))) throw new Error('S5 source must be outside the new Store roots.');
    sources[key] = await sourceBytes(source);
  }
  const originalInput: unknown = JSON.parse(sources.analysisInput.toString('utf8'));
  if (!object(originalInput)) throw new Error('S5 analysis input must be a JSON object.');
  const removedControlPointers: string[] = [];
  // The analysis view is a new document; the source bytes are never changed.
  const analysis = analysisView(originalInput, removedControlPointers);
  rejectControls(analysis);
  const analysisBytes = jsonBytes(analysis);
  const semantics = semanticsInput(JSON.parse(sources.semantics.toString('utf8')));
  const excerpt: unknown = JSON.parse(sources.metricExcerpt.toString('utf8')); rejectControls(excerpt);
  const suppliedMethod: unknown = JSON.parse(sources.method.toString('utf8'));
  if (!object(suppliedMethod) || suppliedMethod.origin !== 'other' || typeof suppliedMethod.title !== 'string' || !object(suppliedMethod.content) || Object.keys(suppliedMethod.content).sort().join(',') !== 'conditions,judgment,limits,logic' || !Object.values(suppliedMethod.content).every(value => typeof value === 'string')) throw new Error('S5 requires an explicit manually prepared method.');
  const methodSource = { origin: 'other' as const, title: suppliedMethod.title, content: suppliedMethod.content as SapMethodContent };
  rejectControls(methodSource);
  const publication = preparePublication(sources.sapPackage); rejectControls(publication.document);
  if (publication.document.metrics.length !== 3 || !metricNames.every(name => publication.document.metrics.some(metric => metric.name === name))) throw new Error('S5 requires exactly the three approved core metrics.');
  const inputLeaves = leaves(analysis);
  if (!inputLeaves.length || inputLeaves.some(leaf => !leaf.pointer)) throw new Error('S5 analysis input has no fields.');
  for (const rule of semantics.fieldRules) if (!inputLeaves.some(leaf => matches(rule.pointerPattern, leaf.pointer))) throw new Error('S5 field rule has no actual input location.');
  for (const statement of semantics.statements) if (statement.pointer !== undefined && !inputLeaves.some(leaf => leaf.pointer === statement.pointer)) throw new Error('S5 statement has no actual input location.');
  if (inputLeaves.some(leaf => semantics.fieldRules.filter(rule => matches(rule.pointerPattern, leaf.pointer)).length > 1)) throw new Error('S5 ambiguous field rules.');
  const statementCount = inputLeaves.filter(leaf => semantics.fieldRules.some(rule => matches(rule.pointerPattern, leaf.pointer))).length + semantics.statements.length;
  const inputFingerprint = hash(jsonBytes({ roots: [path.resolve(dataRoot), path.resolve(projectsRoot)], projectName: options.projectName.trim(), publishedBy: options.publishedBy, configuration: options.configuration,
    sources: Object.fromEntries(keys.map(key => [key, hash(sources[key])])) }));
  const continuation: SemanticAssetContinuation = suppliedContinuation ? structuredClone(suppliedContinuation) : {
    schemaVersion: 1, inputFingerprint, stage: 'prepared', methodSaveRequestId: randomUUID(), methodPublishRequestId: randomUUID(),
    datasetId: randomUUID(), inputVersionId: randomUUID(), descriptionRevisionId: randomUUID(),
    mappingIds: inputLeaves.map(() => randomUUID()), statementIds: Array.from({ length: statementCount }, () => randomUUID()),
  };
  if (mode === 'adoption') {
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    const ids = [continuation.methodSaveRequestId, continuation.methodPublishRequestId, continuation.datasetId, continuation.inputVersionId, continuation.descriptionRevisionId, ...continuation.mappingIds, ...continuation.statementIds,
      ...[continuation.projectId, continuation.enterpriseMaterialId, continuation.enterpriseRevisionId].filter((id): id is string => id !== undefined)];
    if (continuation.schemaVersion !== 1 || continuation.inputFingerprint !== inputFingerprint || continuation.mappingIds.length !== inputLeaves.length || continuation.statementIds.length !== statementCount || ids.some(id => !uuid.test(id))) throw new Error('semantic_adoption_continuation_conflict');
  }
  const projects = new ProjectStore({ dataRoot, projectsRoot });
  await projects.init();
  let failure: unknown;
  try {
    const library = createMetricLibrary(path.join(dataRoot, 'metric-assets')), methods = createSapMethodStore(path.join(dataRoot, 'metric-assets')), enterprise = new EnterpriseMaterialsStore(dataRoot);
    if (mode === 'trial' && ((await projects.list()).length || library.list().length || methods.list().length || (await enterprise.referenceIndex()).materials.length)) throw new Error('S5 preparation requires empty business Stores.');
    if (mode === 'adoption') {
      const existing = library.list().find(entry => entry.id === publication.document.package.id && entry.version === publication.document.package.version);
      if (existing) {
        const exact = library.read(existing.id, existing.version).entry;
        if (exact.bytesSha256 !== publication.bytesSha256 || exact.packageFingerprint !== publication.packageFingerprint || exact.contentFingerprint !== publication.contentFingerprint) throw new Error('LIBRARY_VERSION_CONFLICT');
      }
    }
    if (mode === 'adoption' && !continuation.projectId && (await projects.list()).some(project => project.name === options.projectName.trim())) throw new Error('semantic_adoption_resume_required');
    if (mode === 'adoption' && suppliedContinuation && !continuation.projectId && continuation.stage === 'project-create') throw new Error('semantic_adoption_project_creation_unknown');
    // ProjectStore copies only its existing public configuration fields.
    continuation.stage = 'project-create';
    const project = mode === 'adoption' && continuation.projectId ? await projects.get(continuation.projectId) : await projects.create({ name: options.projectName, configuration: options.configuration });
    continuation.projectId = project.id;
    if (mode === 'adoption' && (project.name !== options.projectName.trim() || project.tasks.length || project.archivedAt !== null || Object.entries(options.configuration).some(([key, value]) => project.configuration[key as keyof typeof project.configuration] !== value))) throw new Error('semantic_adoption_project_conflict');
    continuation.stage = 'metric-publication';
    const metricPublication = library.publish(publication, options.publishedBy);
    const enablement = createProjectEnablement(path.join(dataRoot, 'projects', project.id));
    const currentEnablement = mode === 'adoption' ? enablement.enabled(metricPublication.id) : undefined;
    if (mode === 'adoption' && continuation.metricEnabledAt && (!currentEnablement || currentEnablement.version !== metricPublication.version || currentEnablement.enabledAt !== continuation.metricEnabledAt)) throw new Error('semantic_adoption_metric_unavailable');
    if (mode === 'adoption' && continuation.metricEnableAttempted && !currentEnablement) throw new Error('semantic_adoption_metric_enablement_unknown');
    if (mode === 'adoption' && currentEnablement && currentEnablement.version !== metricPublication.version) throw new Error('semantic_adoption_metric_conflict');
    let metricEnablement = currentEnablement;
    if (!metricEnablement) {
      // The Store can commit its rename and still fail the durability reply.
      // Keep the attempted operation before calling it: no state on a later
      // explicit continuation is UNKNOWN, never permission to enable again.
      if (mode === 'adoption') { continuation.metricEnableAttempted = true; continuation.stage = 'metric-enable'; }
      metricEnablement = enablement.enable(metricPublication.id, metricPublication.version);
    }
    continuation.metricEnabledAt = metricEnablement.enabledAt;
    const upload = async (name: string, bytes: Buffer) => {
      continuation.stage = 'upload:' + name;
      if (mode === 'adoption') {
        const relativePath = '020_clean/' + name, current = await projects.get(project.id);
        const existing = current.uploads.find(file => file.path === relativePath);
        if (existing) {
          const actual = await projects.readFile(project.id, relativePath);
          if (existing.sha256 !== hash(bytes) || existing.bytes !== bytes.length || !actual.bytes.equals(bytes)) throw new Error('semantic_adoption_file_conflict');
          return existing;
        }
        try { await projects.readFile(project.id, relativePath); throw new Error('semantic_adoption_unregistered_file'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      return projects.upload({ projectId: project.id, name, bytes, directory: '020_clean' });
    };
    const analysisFile = await upload('analysis-input.json', analysisBytes);
    const excerptFile = await upload('metric-excerpt.json', sources.metricExcerpt);
    const packageFile = await upload('published-metrics.txt', Buffer.from(publication.canonicalYaml));
    const methodFile = await upload('method-source.json', jsonBytes(methodSource));
    continuation.stage = 'method-save';
    const methodSaved = methods.save({ requestId: mode === 'adoption' ? continuation.methodSaveRequestId : randomUUID(), ...methodSource, sources: [{ type: 'manual', label: 'Explicit engineering method source', ref: methodFile.path, version: null, sha256: methodFile.sha256 }] });
    continuation.stage = 'method-publish';
    const methodPublished = methods.publish(methodSaved.method.id, { requestId: mode === 'adoption' ? continuation.methodPublishRequestId : randomUUID(), version: methodSaved.version.version, expectedSha256: methodSaved.version.contentSha256 });
    if (mode === 'adoption' && methods.getPublished(methodSaved.method.id, methodSaved.version.version).issue?.status === 'confirmed') throw new Error('semantic_adoption_method_unavailable');
    const enterpriseFields = { ...semantics.enterprise, body: semantics.enterprise.body + '\n\n' + sources.metricExcerpt.toString('utf8'), sourceFileId: null };
    if (mode === 'adoption' && suppliedContinuation?.stage === 'enterprise-create' && !continuation.enterpriseMaterialId) throw new Error('semantic_adoption_enterprise_creation_unknown');
    continuation.stage = 'enterprise-create';
    const created = mode === 'adoption' && continuation.enterpriseMaterialId ? await enterprise.get(continuation.enterpriseMaterialId) : await enterprise.create(enterpriseFields);
    continuation.enterpriseMaterialId = created.material.id;
    if (mode === 'adoption' && Object.entries(enterpriseFields).some(([key, value]) => created.material.draft[key as keyof typeof enterpriseFields] !== value)) throw new Error('semantic_adoption_enterprise_conflict');
    if (mode === 'adoption' && (continuation.enterpriseRevisionId ? !created.material.enabled || created.material.activeRevisionId !== continuation.enterpriseRevisionId : !created.material.enabled && created.material.revisions.length > 0)) throw new Error('semantic_adoption_enterprise_unavailable');
    continuation.stage = 'enterprise-enable';
    const enabled = mode === 'adoption' && created.material.enabled ? created : await enterprise.enable(created.material.id, created.material.version);
    const enterpriseRevision = enabled.material.revisions.find(revision => revision.revisionId === enabled.material.activeRevisionId)!;
    continuation.enterpriseRevisionId = enterpriseRevision.revisionId;
    const enterpriseRef = { kind: 'enterprise' as const, storeId: enabled.storeId, materialId: enabled.material.id, revisionId: enterpriseRevision.revisionId };
    const conceptRef = { storeId: enabled.storeId, materialId: enabled.material.id, revisionId: enterpriseRevision.revisionId };
    const metricRefs = metricNames.map(metricName => ({ kind: 'sap' as const, packageId: metricPublication.id, version: metricPublication.version, metricName, publishedHash: metricPublication.bytesSha256 }));
    const references = createProjectDataContextReferences({ dataRoot, projects, enterpriseMaterials: enterprise });
    const data = new ProjectDataContextStore({ dataRoot, projects, validateReferences: references.validate });
    const datasetId = mode === 'adoption' ? continuation.datasetId : randomUUID(), inputVersionId = mode === 'adoption' ? continuation.inputVersionId : randomUUID(), descriptionRevisionId = mode === 'adoption' ? continuation.descriptionRevisionId : randomUUID();
    continuation.stage = 'freeze-input';
    const frozen = await data.freezeInput(project.id, { operationId: inputVersionId, datasetId, inputVersionId, baseIndexRevision: 0, name: 'Explicit synthetic analysis input', sourcePath: analysisFile.path, expectedSha256: analysisFile.sha256, expectedBytes: analysisFile.bytes, uploadId: analysisFile.id, sourceNote: 'New analysis view of the explicitly hashed engineering source; not business confirmation.' });
    const mappings: DataContextMapping[] = inputLeaves.map((leaf, index) => {
      const rule = semantics.fieldRules.find(rule => matches(rule.pointerPattern, leaf.pointer));
      return { mappingId: mode === 'adoption' ? continuation.mappingIds[index]! : randomUUID(), location: { kind: 'json-pointer', pointer: leaf.pointer }, conceptRefs: [conceptRef], sapRefs: metricRefs.filter(ref => rule?.metricNames.includes(ref.metricName)).map(({ kind: _kind, ...ref }) => ref), provenance: 'agent-inference', dispute: rule?.meaning ?? 'Exact input location only; business meaning and metric applicability are unknown.', confirmed: false, confirmedAt: null, confirmedBy: null };
    });
    const fieldStatements: DataContextStatement[] = inputLeaves.flatMap(leaf => {
      const rule = semantics.fieldRules.find(rule => matches(rule.pointerPattern, leaf.pointer));
      return rule ? [{ statementId: randomUUID(), scope: 'field' as const, location: { kind: 'json-pointer' as const, pointer: leaf.pointer }, text: rule.meaning, unit: rule.unit, provenance: 'agent-inference' as const, confirmed: false, confirmedAt: null, confirmedBy: null }] : [];
    });
    const statements: DataContextStatement[] = [...fieldStatements, ...semantics.statements.map(statement => ({ statementId: randomUUID(), scope: statement.scope, location: statement.pointer === undefined ? null : { kind: 'json-pointer' as const, pointer: statement.pointer }, text: statement.text, unit: statement.unit ?? null, provenance: 'agent-inference' as const, confirmed: false, confirmedAt: null, confirmedBy: null }))];
    if (mode === 'adoption') statements.forEach((statement, index) => { statement.statementId = continuation.statementIds[index]!; });
    continuation.stage = 'save-description';
    continuation.descriptionBaseIndexRevision ??= frozen.indexRevision;
    const described = await data.saveDescription(project.id, { operationId: descriptionRevisionId, datasetId, inputVersionId, descriptionRevisionId, baseIndexRevision: mode === 'adoption' ? continuation.descriptionBaseIndexRevision : frozen.indexRevision, observation: { author: 'unknown', format: 'json', encoding: null, recordRule: null, coverage: 'unobserved', scannedRows: null, totalRows: null, fields: [], limitations: 'Engineering source preparation and exact JSON locations; no product Agent observation or business confirmation.', generatedAt: null, nativeEvidence: null, artifactEvidence: null }, mappings, statements });
    const methodRef = { kind: 'sap-method' as const, methodId: methodPublished.method.id, version: methodPublished.version.version, publishedHash: methodPublished.version.contentSha256 };
    const refs = { metrics: metricRefs, method: methodRef, enterprise: enterpriseRef, input: { kind: 'data-input' as const, ...frozen.record.resultRef }, description: { kind: 'data-description' as const, ...described.record.resultRef } };
    const declaredConditions = object(analysis) ? Object.fromEntries(['scope', 'periods', 'synthetic_assumptions', 'conditions', 'extra_conditions'].filter(key => Object.hasOwn(analysis, key)).map(key => [key, analysis[key]])) : {};
    const semanticView = { purpose: mode === 'adoption' ? 'Explicit SC-01S synthetic semantic assets; exact source refs remain authoritative, not professional verification.' : 'Same-source semantic material for either trial arm; exact sources remain authoritative.', refs, input: { path: analysisFile.path, sha256: analysisFile.sha256, bytes: analysisFile.bytes }, conditions: { kind: 'source-projection', sourceRef: refs.input, values: declaredConditions }, metrics: publication.document.metrics, scenarios: publication.document.scenarios, method: { title: methodPublished.version.title, content: methodPublished.version.content, ref: methodRef }, enterprise: { title: enterpriseRevision.title, body: enterpriseRevision.body, bodySha256: enterpriseRevision.bodySha256, scope: enterpriseRevision.scope, effectiveTime: enterpriseRevision.effectiveTime, ref: enterpriseRef }, fieldRoles: mappings.map(mapping => ({ pointer: (mapping.location as { pointer: string }).pointer, meaning: mapping.dispute, provenance: mapping.provenance, confirmed: mapping.confirmed, conceptRefs: mapping.conceptRefs, sapRefs: mapping.sapRefs })), statements: described.record.statements, provenance: { metricExcerpt: { path: excerptFile.path, sha256: excerptFile.sha256 }, metricPublication: { path: packageFile.path, sha256: packageFile.sha256 }, methodSource: { path: methodFile.path, sha256: methodFile.sha256 } } };
    const semanticFile = await upload('semantic-assets.json', jsonBytes(mode === 'adoption' ? JSON.parse(canonical(semanticView)) : semanticView));
    const finalProject = await projects.get(project.id);
    if (finalProject.tasks.length) throw new Error('S5 asset preparation must remain taskless.');
    continuation.stage = 'completed';
    return { project: finalProject, refs, metricPublication, metricEnablement, methodSaved, methodPublished, enterpriseRevision, frozen, described, mappingCount: mappings.length, removedControlPointers, ...(mode === 'adoption' ? { continuation } : {}), sourceBytes: Object.fromEntries(keys.map(key => [key, { path: options.sources[key].path, sha256: hash(sources[key]), bytes: sources[key].length }])), analysisInput: { path: path.join(project.rootPath, analysisFile.path), relativePath: analysisFile.path, sha256: analysisFile.sha256, bytes: analysisFile.bytes }, semanticView: { path: path.join(project.rootPath, semanticFile.path), relativePath: semanticFile.path, sha256: semanticFile.sha256, bytes: semanticFile.bytes } };
  } catch (error) {
    failure = error;
    if (mode === 'adoption') throw new SemanticAssetPreparationError(error, continuation);
    throw error;
  } finally {
    try { await projects.close(); }
    catch (error) {
      if (mode === 'adoption') throw new SemanticAssetPreparationError(failure ? new AggregateError([failure, error], 'semantic_adoption_close_unknown') : error, continuation);
      throw error;
    }
  }
}
