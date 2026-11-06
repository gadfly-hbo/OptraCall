/** One JSON batch in, one JSON result out. S3 engineering only; no Host/SDK. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const result = (ref, state, gaps, observedHash, payload) => ({ ref, state, gaps,
  ...(observedHash === undefined ? {} : { observedHash }), ...(payload === undefined ? {} : { payload }) });
const errorResult = (ref, error) => {
  const code = typeof error?.code === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,120}$/.test(error.code) ? error.code : 'native-authority-source-unknown';
  const state = /hash_mismatch|hash_conflict/.test(code) ? 'hash-conflict'
    : /ENOENT|not_found|NOT_FOUND|NOT_PUBLISHED|missing/.test(code) ? 'missing'
    : /disabled/.test(code) ? 'disabled' : /excluded/.test(code) ? 'excluded' : 'unknown';
  return result(ref, state, [code]);
};

/** Check every ancestor so native readers cannot traverse a symlink directory. */
async function plainDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory) fail('native-authority-invalid-root');
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('native-authority-unsafe-directory');
  }
}

/** Only original SemanticTarget fields; no inferred versions or reconstructed IDs. */
function validate(ref) {
  if (!object(ref)) fail('native-authority-invalid-ref');
  const keys = {
    sap: ['kind', 'packageId', 'version', 'metricName', 'publishedHash'],
    'sap-method': ['kind', 'methodId', 'version', 'publishedHash'],
    enterprise: ['kind', 'storeId', 'materialId', 'revisionId', 'location'],
    'data-input': ['kind', 'projectId', 'datasetId', 'inputVersionId'],
    'data-description': ['kind', 'projectId', 'datasetId', 'inputVersionId', 'descriptionRevisionId'],
  }[ref.kind];
  if (!keys) fail('native-authority-unsupported-kind');
  if (Object.keys(ref).some(key => !keys.includes(key))) fail('native-authority-invalid-ref');
  if (ref.kind === 'sap') {
    if (typeof ref.packageId !== 'string' || !/^[a-z][a-z0-9-]*$/.test(ref.packageId)
      || typeof ref.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(ref.version)
      || typeof ref.metricName !== 'string' || !/^[a-z][a-z0-9_]*$/.test(ref.metricName)) fail('native-authority-exact-sap-ref-required');
  } else if (ref.kind === 'sap-method') {
    if (!uuid(ref.methodId) || !positive(ref.version)) fail('native-authority-exact-method-ref-required');
  } else if (ref.kind === 'enterprise') {
    if (![ref.storeId, ref.materialId, ref.revisionId].every(uuid)) fail('native-authority-exact-enterprise-ref-required');
    if (ref.location !== undefined && (!object(ref.location) || Object.keys(ref.location).some(key => !['start', 'end'].includes(key))
      || !Number.isSafeInteger(ref.location.start) || !Number.isSafeInteger(ref.location.end)
      || ref.location.start < 0 || ref.location.end <= ref.location.start)) fail('native-authority-invalid-location');
  } else if (![ref.projectId, ref.datasetId, ref.inputVersionId, ...(ref.kind === 'data-description' ? [ref.descriptionRevisionId] : [])].every(uuid)) {
    fail('native-authority-exact-m2-ref-required');
  }
  if ('publishedHash' in ref && ref.publishedHash != null && !sha(ref.publishedHash)) fail('native-authority-invalid-published-hash');
}

function businessKey(ref) {
  validate(ref);
  if (ref.kind === 'sap') return JSON.stringify([ref.kind, ref.packageId, ref.version, ref.metricName]);
  if (ref.kind === 'sap-method') return JSON.stringify([ref.kind, ref.methodId, ref.version]);
  if (ref.kind === 'enterprise') return JSON.stringify([ref.kind, ref.storeId, ref.materialId, ref.revisionId]);
  return JSON.stringify([ref.kind, ref.projectId, ref.datasetId, ref.inputVersionId,
    ...(ref.kind === 'data-description' ? [ref.descriptionRevisionId] : [])]);
}

async function batch(input) {
  const refs = input.refs;
  if (!Array.isArray(refs) || refs.length > 4096 || !['check', 'read'].includes(input.action)) fail('native-authority-invalid-batch');
  const read = input.action === 'read';
  let projects;
  try {
    await plainDirectory(input.sourceRoot);
    await plainDirectory(input.dataRoot);
    await plainDirectory(input.projectsRoot);
    const load = relative => import(pathToFileURL(path.join(input.sourceRoot, relative)).href);
    const [{ createMetricLibrary }, { createSapMethodStore }, { parseSapDraft },
      { EnterpriseMaterialsStore }, { ProjectStore }, { ProjectDataContextStore }, { readBytes, safePath }] = await Promise.all([
      load('extensions/business-plugins/metric-factory/library/store.ts'),
      load('extensions/business-plugins/metric-factory/methods/store.ts'),
      load('extensions/business-plugins/metric-factory/sap/validate.ts'),
      load('src/host/enterprise-materials-store.ts'), load('src/host/project-store.ts'),
      load('src/host/project-data-context-store.ts'), load('src/host/project-data-context-io.ts'),
    ]);
    const metricRoot = path.join(input.dataRoot, 'metric-assets');
    const library = createMetricLibrary(metricRoot), methods = createSapMethodStore(metricRoot);
    const enterprise = new EnterpriseMaterialsStore(input.dataRoot);
    let data;
    // Only M2 needs ProjectStore.init. Native schema2 decoration reconstructs
    // rootPath from projectsRoot and never follows copied metadata.rootPath.
    async function m2() {
      if (!data) {
        const metadataRoot = path.join(input.dataRoot, 'projects');
        await plainDirectory(metadataRoot);
        // init can migrate schema1, which this read-only S3 bridge must refuse.
        for (const entry of await fs.readdir(metadataRoot, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.isSymbolicLink() || !uuid(entry.name)) fail('native-authority-unsafe-project');
          const file = await safePath(metadataRoot, `${entry.name}/project.json`);
          const metadata = JSON.parse((await readBytes(file, 2 * 1024 * 1024)).toString('utf8'));
          if (metadata.schemaVersion !== 2) fail('native-authority-project-migration-refused');
        }
        projects = new ProjectStore({ dataRoot: input.dataRoot, projectsRoot: input.projectsRoot });
        await projects.init();
        data = new ProjectDataContextStore({ dataRoot: input.dataRoot, projects });
      }
      return data;
    }
    const hashes = new Map(), conflicts = new Set();
    for (const ref of refs) {
      try {
        const key = businessKey(ref);
        if (sha(ref.publishedHash)) {
          if (hashes.has(key) && hashes.get(key) !== ref.publishedHash) conflicts.add(key);
          else hashes.set(key, ref.publishedHash);
        }
      } catch { /* Individual invalid refs receive explicit unknown results. */ }
    }
    const exactMemo = new Map(); // only within this operation; never governance across calls
    async function resolve(ref) {
      try {
        const key = businessKey(ref);
        if (conflicts.has(key)) return result(ref, 'hash-conflict', ['conflicting-reference-hashes']);
        const cacheKey = JSON.stringify(ref);
        if (exactMemo.has(cacheKey)) return exactMemo.get(cacheKey);
        const value = await resolveExact(ref);
        exactMemo.set(cacheKey, value);
        return value;
      } catch (error) { return errorResult(ref, error); }
    }
    const hashGaps = ref => !ref.publishedHash ? ['missing-hash'] : [];
    const hashConflict = (ref, observed) => sha(ref.publishedHash) && ref.publishedHash !== observed;
    async function resolveExact(ref) {
      if (ref.kind === 'sap') {
        await plainDirectory(path.join(metricRoot, ref.packageId));
        const value = library.read(ref.packageId, ref.version);
        if (!value.entry.metricNames.includes(ref.metricName)) return result(ref, 'missing', ['sap-metric-not-found']);
        if (hashConflict(ref, value.entry.bytesSha256)) return result(ref, 'hash-conflict', ['published-hash-conflict'], value.entry.bytesSha256);
        const document = parseSapDraft(Buffer.from(value.canonicalYaml, 'utf8'));
        const metric = document.metrics.find(metric => metric.name === ref.metricName);
        if (!metric || document.package.id !== ref.packageId || document.package.version !== ref.version) fail('native-authority-sap-identity-mismatch');
        return result(ref, 'available', hashGaps(ref), value.entry.bytesSha256,
          read ? { entry: value.entry, document, metric, canonicalYaml: value.canonicalYaml } : undefined);
      }
      if (ref.kind === 'sap-method') {
        const value = methods.getPublished(ref.methodId, ref.version), observed = value.version.contentSha256;
        if (hashConflict(ref, observed)) return result(ref, 'hash-conflict', ['published-hash-conflict'], observed);
        if (value.issue?.status === 'confirmed') return result(ref, 'excluded', ['known-error-not-default-recommended'], observed);
        return result(ref, 'available', hashGaps(ref), observed, read ? value : undefined);
      }
      if (ref.kind === 'enterprise') {
        const metadata = await enterprise.referenceIndex({ readOnly: true });
        if (metadata.storeId !== ref.storeId) fail('native-authority-store-mismatch');
        const material = metadata.materials.find(material => material.materialId === ref.materialId);
        if (!material || !material.revisions.some(revision => revision.revisionId === ref.revisionId)) return result(ref, 'missing', ['enterprise-revision-not-found']);
        if (!material.enabled) return result(ref, 'disabled', ['enterprise-source-disabled']);
        const revision = await enterprise.readRevision(ref.materialId, ref.revisionId, { readOnly: true });
        if (ref.location) {
          const { start, end } = ref.location, body = revision.body;
          const boundary = offset => !(offset > 0 && offset < body.length && /[\uD800-\uDBFF]/.test(body[offset - 1]) && /[\uDC00-\uDFFF]/.test(body[offset]));
          if (end > body.length || !boundary(start) || !boundary(end)) fail('native-authority-invalid-location');
        }
        return result(ref, 'available', [], revision.bodySha256,
          read ? { revision, storeId: metadata.storeId, material } : undefined);
      }
      const store = await m2();
      if (ref.kind === 'data-input') {
        const record = await store.readVersion(ref.projectId, ref.datasetId, ref.inputVersionId);
        return result(ref, 'available', [], record.sha256, read ? record : undefined);
      }
      const record = await store.readDescription(ref.projectId, ref.datasetId, ref.descriptionRevisionId);
      if (record.inputVersionId !== ref.inputVersionId) fail('native-authority-input-version-mismatch');
      // readDescription verifies exact version bytes and original field/ref shape.
      // Admission additionally checks every declared current source recursively.
      const sources = record.mappings.flatMap(mapping => [
        ...mapping.conceptRefs.map(ref => ({ kind: 'enterprise', ...ref })),
        ...mapping.sapRefs.map(ref => ({ kind: 'sap', ...ref })),
      ]);
      const sourceResults = [];
      for (const source of sources) sourceResults.push(await resolve(source));
      const refused = sourceResults.filter(value => value.state !== 'available');
      if (refused.length) {
        const state = ['disabled', 'excluded', 'hash-conflict', 'missing', 'unknown'].find(state => refused.some(value => value.state === state));
        return result(ref, state, ['m2-source-unavailable', ...new Set(refused.map(value => `m2-source-${value.state}`))]);
      }
      if (record.observation.nativeEvidence || record.observation.artifactEvidence) return result(ref, 'unknown', ['m2-evidence-kind-not-admitted']);
      const index = await store.getIndex(ref.projectId);
      const observed = index?.datasets.find(dataset => dataset.datasetId === ref.datasetId)?.descriptions.find(description => description.descriptionRevisionId === ref.descriptionRevisionId)?.recordSha256;
      if (!observed) fail('native-authority-description-hash-unknown');
      return result(ref, 'available', [...new Set(sourceResults.flatMap(value => value.gaps))], observed, read ? record : undefined);
    }
    const values = [];
    for (const ref of refs) values.push(await resolve(ref));
    return values;
  } catch (error) { return refs.map(ref => errorResult(ref, error)); }
  finally { if (projects) await projects.close(); }
}

try {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) fail('native-authority-request-limit');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  process.stdout.write(JSON.stringify(await batch(input)));
} catch {
  process.exitCode = 1;
}
