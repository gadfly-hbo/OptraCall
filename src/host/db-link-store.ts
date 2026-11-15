import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type {
  DbLinkStoreOptions, DbLinkConnectionInput, DbLinkPublicConnection, DbLinkTestReceipt,
  DbLinkRuntimeConnection, DbLinkTestObservation, DbLinkBudget, DbLinkProjectGrant, DbLinkTaskPolicy,
  DbLinkProjectGrantInput, DbLinkSource,
  DbLinkScope, DbLinkModelExport, DbLinkReadOwner, DbLinkProbeResourceState,
} from './db-link-types.ts';

export class DbLinkStoreError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

// A persisted unfinished technical fact on its original revision, not live lifecycle authority.
type UnconfirmedRead = { owner: DbLinkReadOwner; startedAt: string };
type StoredConnection = DbLinkRuntimeConnection & { testedAt: string; observation: DbLinkTestObservation; unconfirmedRead?: UnconfirmedRead };
type TaskPolicyRecord = { projectId: string; taskId: string; connectionId: string; policy: DbLinkTaskPolicy };
type ReadDomain = Pick<DbLinkRuntimeConnection, 'engine' | 'host' | 'port' | 'database' | 'username'>;
type UnconfirmedTest = ReadDomain & { id: string; startedAt: string };
type State = { schema: 1; fingerprintKey: string; connections: StoredConnection[]; grants: DbLinkProjectGrant[]; taskPolicies: TaskPolicyRecord[]; unconfirmedTests?: UnconfirmedTest[] };
type Candidate = { configuration: DbLinkRuntimeConnection; baseRevision: number };
type Receipt = { value?: DbLinkTestReceipt; candidate: Candidate; cleanup?: () => Promise<DbLinkProbeResourceState> };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const clone = <T>(value: T): T => structuredClone(value);
function last<T>(values: T[], predicate: (value: T) => boolean): T | undefined { for (let index = values.length - 1; index >= 0; index--) if (predicate(values[index])) return values[index]; return undefined; }
function fail(code = 'invalid_db_configuration'): never { throw new DbLinkStoreError(code); }
function exactKeys(value: Record<string, unknown>, keys: string[]): void { if (Object.keys(value).some(key => !keys.includes(key))) fail(); }
function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail();
  return value.trim();
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function readOwner(value: unknown): DbLinkReadOwner {
  if (!record(value)) fail('invalid_db_read_owner');
  exactKeys(value, ['projectId', 'taskId', 'requestId', 'operationId']);
  if (!validId(value.projectId) || !validId(value.taskId) || [value.requestId, value.operationId].some(item => typeof item !== 'string' || item.length < 1 || item.length > 200 || /[\x00-\x1f\x7f]/.test(item))) fail('invalid_db_read_owner');
  return { projectId: value.projectId, taskId: value.taskId, requestId: value.requestId as string, operationId: value.operationId as string };
}
function sameReadDomain(left: Readonly<ReadDomain>, right: Readonly<ReadDomain>): boolean {
  return left.engine === right.engine && left.host.toLowerCase() === right.host.toLowerCase() && left.port === right.port && left.database === right.database && left.username === right.username;
}
function probeEnded(value: unknown): value is DbLinkProbeResourceState {
  return record(value) && ['remoteTerminal', 'connectionEnded', 'commandTerminal', 'transactionEnded'].every(key => value[key] === true);
}
function budget(value: unknown): DbLinkBudget {
  if (!record(value)) fail();
  const limits: Record<keyof DbLinkBudget, number> = { connectTimeoutMs: 120000, queryTimeoutMs: 3600000, lockTimeoutMs: 120000, maxRows: 10000000, maxBytes: 1073741824, maxCellBytes: 52428800, chunkBytes: 52428800, maxConcurrent: 16 };
  exactKeys(value, Object.keys(limits));
  for (const [key, maximum] of Object.entries(limits)) if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1 || Number(value[key]) > maximum) fail();
  if (Number(value.maxCellBytes) > Number(value.maxBytes) || Number(value.chunkBytes) > Number(value.maxBytes) || Number(value.lockTimeoutMs) > Number(value.queryTimeoutMs)) fail();
  return Object.fromEntries(Object.keys(limits).map(key => [key, value[key]])) as DbLinkBudget;
}
function observation(value: unknown): DbLinkTestObservation {
  if (!record(value) || value.reachable !== true || typeof value.queryQualified !== 'boolean' || !['verified', 'unverified'].includes(String(value.cancelCapability)) || !Array.isArray(value.limitations)) fail('db_test_failed');
  const result: DbLinkTestObservation = { reachable: true, sourceIdentity: text(value.sourceIdentity, 500), permissionBinding: text(value.permissionBinding, 500), queryQualified: value.queryQualified, cancelCapability: value.cancelCapability as 'verified' | 'unverified', limitations: value.limitations.map(item => text(item, 1000)) };
  return result;
}
function scope(value: unknown): DbLinkScope {
  if (!record(value) || !Array.isArray(value.objects) || value.objects.length < 1 || value.objects.length > 200) fail('invalid_db_scope');
  exactKeys(value, ['objects', 'description']);
  const objects = [...new Set(value.objects.map(item => text(item, 500)))].sort();
  if (objects.some(item => item.includes('*') && item !== '*') || (objects.includes('*') && objects.length !== 1)) fail('invalid_db_scope');
  return { objects, ...(value.description === undefined ? {} : { description: text(value.description, 2000) }) };
}
const exportKinds = ['structure', 'comments', 'queryText', 'results'] as const;
function modelExport(value: unknown): DbLinkModelExport {
  if (!record(value) || !Array.isArray(value.targets) || value.targets.length > 100 || exportKinds.some(key => typeof value[key] !== 'boolean')) fail('invalid_db_model_export');
  exactKeys(value, ['targets', ...exportKinds]);
  const targets = [...new Set(value.targets.map(item => text(item, 200)))].sort();
  if (targets.includes('*') || (!targets.length && exportKinds.some(key => value[key] === true))) fail('invalid_db_model_export');
  return { targets, structure: value.structure as boolean, comments: value.comments as boolean, queryText: value.queryText as boolean, results: value.results as boolean };
}
function narrowerScope(child: DbLinkScope, parent: DbLinkScope): boolean { return parent.objects.includes('*') || child.objects.every(item => parent.objects.includes(item)); }
function narrowerExport(child: DbLinkModelExport, parent: DbLinkModelExport): boolean { return child.targets.every(item => parent.targets.includes(item)) && exportKinds.every(key => !child[key] || parent[key]); }
async function regularOrMissing(file: string): Promise<void> {
  try { const entry = await lstat(file); if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) fail('db_store_corrupt'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = path.join(path.dirname(file), `.db-link-${randomUUID()}.tmp`);
  let handle;
  try {
    await regularOrMissing(file);
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.chmod(0o600); await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); await handle.close(); handle = undefined;
    await rename(temporary, file);
    const directory = await open(path.dirname(file), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch { fail('db_store_write_failed'); }
  finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
}

export class DbLinkStore {
  readonly dataRoot: string;
  readonly settingsPath: string;
  #options: DbLinkStoreOptions;
  #state: State = { schema: 1, fingerprintKey: randomBytes(32).toString('hex'), connections: [], grants: [], taskPolicies: [] };
  #receipts = new Map<string, Receipt>();
  // Pending authorization writes deny new dispatch immediately; this is not query/run state.
  #pendingRevocations = new Map<string, number>();
  #ready = false;
  #gate = Promise.resolve();
  constructor(options: DbLinkStoreOptions) {
    this.#options = options;
    this.dataRoot = path.join(path.resolve(options.dataRoot), 'db-link');
    this.settingsPath = path.join(this.dataRoot, 'connections.json');
    const ttl = options.testReceiptTtlMs ?? 300000;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 900000) fail();
  }
  #now(): number { return this.#options.now?.() ?? Date.now(); }
  #assertReady(): void { if (!this.#ready) fail('db_store_not_initialized'); }
  #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#gate.then(operation); this.#gate = result.then(() => {}, () => {}); return result;
  }
  async #persist(next: State): Promise<void> {
    try { await atomicJson(this.settingsPath, next); this.#state = next; }
    catch (error) { this.#ready = false; throw error; }
  }
  async init(): Promise<void> {
    this.#ready = false;
    try {
      await mkdir(this.dataRoot, { recursive: true, mode: 0o700 });
      const directory = await lstat(this.dataRoot); if (!directory.isDirectory() || directory.isSymbolicLink()) fail('db_store_corrupt');
      await chmod(this.dataRoot, 0o700);
      await regularOrMissing(this.settingsPath);
      let handle;
      try {
        handle = await open(this.settingsPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        if ((await handle.stat()).nlink !== 1) fail('db_store_corrupt');
        const value: unknown = JSON.parse(await handle.readFile('utf8'));
        if (!record(value) || value.schema !== 1 || typeof value.fingerprintKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprintKey) || !Array.isArray(value.connections) || !Array.isArray(value.grants) || !Array.isArray(value.taskPolicies)) fail('db_store_corrupt');
        this.#state = value as State;
        this.#validateState();
        await chmod(this.settingsPath, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await atomicJson(this.settingsPath, this.#state);
      } finally { await handle?.close(); }
      this.#receipts.clear(); this.#pendingRevocations.clear(); this.#ready = true;
    } catch { fail('db_store_corrupt'); }
  }
  #current(id: string): StoredConnection | undefined { return last(this.#state.connections, item => item.id === id); }
  #normalize(input: unknown): Candidate {
    if (!record(input)) fail();
    exactKeys(input, ['id', 'name', 'engine', 'host', 'port', 'database', 'username', 'password', 'tls', 'budget']);
    if (input.id !== undefined && !validId(input.id)) fail();
    const current = typeof input.id === 'string' ? this.#current(input.id) : undefined;
    if (input.id !== undefined && !current) fail('db_connection_not_found');
    const name = text(input.name, 80), host = text(input.host, 253).toLowerCase(), database = text(input.database), username = text(input.username);
    if (!['postgresql', 'mysql'].includes(String(input.engine)) || isIP(host) || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host)) fail();
    if (!Number.isSafeInteger(input.port) || Number(input.port) < 1 || Number(input.port) > 65535 || !record(input.tls)) fail();
    exactKeys(input.tls, ['ca', 'rejectUnauthorized', 'verifyIdentity']);
    if (input.tls.rejectUnauthorized !== true || input.tls.verifyIdentity !== true) fail();
    const sameTarget = current && current.engine === input.engine && current.host === host && current.port === input.port && current.database === database && current.username === username;
    const password = input.password === undefined && sameTarget ? current.password : input.password;
    if (typeof password !== 'string' || !password.length || password.length > 8192 || /[\x00\r\n]/.test(password)) fail();
    const ca = input.tls.ca === undefined && sameTarget ? current.tls.ca : input.tls.ca;
    if (ca !== undefined && (typeof ca !== 'string' || !ca.trim() || ca.length > 262144 || ca.includes('\x00'))) fail();
    const clean = { name, engine: input.engine as 'postgresql' | 'mysql', host, port: input.port as number, database, username, password, tls: { ...(ca === undefined ? {} : { ca }), rejectUnauthorized: true as const, verifyIdentity: true as const }, budget: budget(input.budget) };
    const baseRevision = current?.revision ?? 0;
    const fingerprint = createHmac('sha256', this.#state.fingerprintKey).update(JSON.stringify({ ...clean, id: input.id ?? null, baseRevision })).digest('hex');
    return { baseRevision, configuration: { ...clean, id: current?.id ?? randomUUID(), revision: baseRevision + 1, fingerprint } };
  }
  #validateState(): void {
    exactKeys(this.#state, ['schema', 'fingerprintKey', 'connections', 'grants', 'taskPolicies', 'unconfirmedTests']);
    if (this.#state.unconfirmedTests !== undefined) {
      if (!Array.isArray(this.#state.unconfirmedTests)) fail('db_store_corrupt');
      const testIds = new Set<string>();
      for (const value of this.#state.unconfirmedTests) {
        if (!record(value) || !validId(value.id) || testIds.has(value.id) || !['postgresql', 'mysql'].includes(value.engine) || typeof value.host !== 'string' || value.host !== value.host.toLowerCase() || isIP(value.host) || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(value.host) || !Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535 || typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))) fail('db_store_corrupt');
        exactKeys(value, ['id', 'engine', 'host', 'port', 'database', 'username', 'startedAt']);
        if (text(value.database) !== value.database || text(value.username) !== value.username) fail('db_store_corrupt');
        testIds.add(value.id);
      }
    }
    const identities = new Set<string>();
    const revisions = new Map<string, number>();
    for (const value of this.#state.connections) {
      if (!record(value) || !validId(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint) || !Number.isFinite(Date.parse(value.testedAt))) fail('db_store_corrupt');
      exactKeys(value, ['id', 'name', 'engine', 'host', 'port', 'database', 'username', 'password', 'tls', 'budget', 'revision', 'fingerprint', 'testedAt', 'observation', 'unconfirmedRead']);
      if (value.unconfirmedRead !== undefined) {
        if (!record(value.unconfirmedRead) || typeof value.unconfirmedRead.startedAt !== 'string' || !Number.isFinite(Date.parse(value.unconfirmedRead.startedAt))) fail('db_store_corrupt');
        exactKeys(value.unconfirmedRead, ['owner', 'startedAt']); readOwner(value.unconfirmedRead.owner);
      }
      const identity = `${value.id}:${value.revision}`; if (identities.has(identity)) fail('db_store_corrupt'); identities.add(identity);
      if (value.revision !== (revisions.get(value.id) ?? 0) + 1) fail('db_store_corrupt'); revisions.set(value.id, value.revision);
      // Reuse the same input parser without interpreting persisted observations as fresh proof.
      const candidate = this.#normalize({ id: value.id, name: value.name, engine: value.engine, host: value.host, port: value.port, database: value.database, username: value.username, password: value.password, tls: value.tls, budget: value.budget });
      const { id: _id, revision: _revision, fingerprint: _fingerprint, ...clean } = candidate.configuration;
      const expected = createHmac('sha256', this.#state.fingerprintKey).update(JSON.stringify({ ...clean, id: value.revision === 1 ? null : value.id, baseRevision: value.revision - 1 })).digest('hex');
      if (expected !== value.fingerprint || !record(value.observation)) fail('db_store_corrupt');
      exactKeys(value.observation, ['reachable', 'sourceIdentity', 'permissionBinding', 'queryQualified', 'cancelCapability', 'limitations']);
      observation(value.observation);
    }
    const grantIds = new Set<string>();
    for (const grant of this.#state.grants) {
      if (!record(grant) || !validId(grant.id) || !validId(grant.projectId) || !validId(grant.connectionId) || !Number.isSafeInteger(grant.connectionRevision) || !Number.isFinite(Date.parse(grant.grantedAt)) || (grant.revokedAt !== null && !Number.isFinite(Date.parse(grant.revokedAt))) || grantIds.has(grant.id)) fail('db_store_corrupt');
      exactKeys(grant, ['id', 'projectId', 'connectionId', 'connectionRevision', 'connectionFingerprint', 'permissionBinding', 'scope', 'modelExport', 'grantedAt', 'revokedAt']);
      const connection = this.#state.connections.find(item => item.id === grant.connectionId && item.revision === grant.connectionRevision);
      if (!connection || connection.fingerprint !== grant.connectionFingerprint || connection.observation.permissionBinding !== grant.permissionBinding) fail('db_store_corrupt');
      scope(grant.scope); modelExport(grant.modelExport); grantIds.add(grant.id);
    }
    const taskKeys = new Set<string>();
    for (const item of this.#state.taskPolicies) {
      if (!record(item) || !validId(item.projectId) || !validId(item.taskId) || !validId(item.connectionId) || !record(item.policy) || typeof item.policy.excluded !== 'boolean') fail('db_store_corrupt');
      exactKeys(item, ['projectId', 'taskId', 'connectionId', 'policy']); exactKeys(item.policy, ['excluded', 'scope', 'modelExport']);
      const key = `${item.projectId}:${item.taskId}:${item.connectionId}`;
      if (taskKeys.has(key) || !this.#state.grants.some(grant => grant.projectId === item.projectId && grant.connectionId === item.connectionId)) fail('db_store_corrupt');
      if (item.policy.scope !== undefined) scope(item.policy.scope);
      if (item.policy.modelExport !== undefined) modelExport(item.policy.modelExport);
      taskKeys.add(key);
    }
  }
  #public(value: StoredConnection): DbLinkPublicConnection {
    const { password: _password, tls, unconfirmedRead: _unconfirmedRead, ...rest } = value;
    return clone({ ...rest, hasPassword: true, tls: { rejectUnauthorized: true, verifyIdentity: true, hasCa: !!tls.ca } });
  }
  list(): DbLinkPublicConnection[] {
    this.#assertReady(); return this.#state.connections.filter(item => this.#current(item.id) === item).map(item => this.#public(item));
  }
  read(id: string, revision?: number): DbLinkPublicConnection | null {
    this.#assertReady(); const value = revision === undefined ? this.#current(id) : this.#state.connections.find(item => item.id === id && item.revision === revision);
    return value ? this.#public(value) : null;
  }
  /** Host-only credential resolution; never expose this return value over HTTP or to Agent tools. */
  connectionSnapshot(id: string, revision?: number): Readonly<DbLinkRuntimeConnection> {
    this.#assertReady(); const value = revision === undefined ? this.#current(id) : this.#state.connections.find(item => item.id === id && item.revision === revision);
    if (!value) fail('db_connection_not_found');
    const { testedAt: _testedAt, observation: _observation, unconfirmedRead: _unconfirmedRead, ...configuration } = value;
    return freeze(clone(configuration));
  }
  /** Host admission only. Reopening or renaming a connection never clears an old read. */
  assertReadClear(configuration: Readonly<DbLinkRuntimeConnection>): void {
    this.#assertReady();
    if (this.#state.connections.some(item => item.unconfirmedRead && sameReadDomain(item, configuration)) || this.#state.unconfirmedTests?.some(item => sameReadDomain(item, configuration))) fail('db_read_unconfirmed');
  }
  /** Host must await this durable fact before opening a saved source for physical reading. */
  recordReadStarted(connectionId: string, revision: number, owner: DbLinkReadOwner): Promise<void> {
    return this.#mutate(async () => {
      this.#assertReady(); const identity = readOwner(owner);
      const connection = this.#state.connections.find(item => item.id === connectionId && item.revision === revision);
      if (!connection) fail('db_connection_not_found');
      this.assertReadClear(connection);
      const started: StoredConnection = { ...connection, unconfirmedRead: { owner: identity, startedAt: new Date(this.#now()).toISOString() } };
      await this.#persist({ ...this.#state, connections: this.#state.connections.map(item => item === connection ? started : item) });
    });
  }
  /** Host calls only after proving the original command/transaction/local resource terminals. */
  recordReadFinished(connectionId: string, revision: number, owner: DbLinkReadOwner): Promise<void> {
    return this.#mutate(async () => {
      this.#assertReady(); const identity = readOwner(owner);
      const connection = this.#state.connections.find(item => item.id === connectionId && item.revision === revision);
      if (!connection) fail('db_connection_not_found');
      if (!connection.unconfirmedRead) return;
      if ((Object.keys(identity) as (keyof DbLinkReadOwner)[]).some(key => identity[key] !== connection.unconfirmedRead!.owner[key])) fail('db_read_owner_mismatch');
      const { unconfirmedRead: _unconfirmedRead, ...finished } = connection;
      await this.#persist({ ...this.#state, connections: this.#state.connections.map(item => item === connection ? finished : item) });
    });
  }
  async #clearTestFact(id: string): Promise<void> {
    await this.#mutate(async () => {
      this.#assertReady();
      if (!this.#state.unconfirmedTests?.some(item => item.id === id)) return;
      const remaining = this.#state.unconfirmedTests.filter(item => item.id !== id), { unconfirmedTests: _unconfirmedTests, ...rest } = this.#state;
      await this.#persist(remaining.length ? { ...rest, unconfirmedTests: remaining } : rest);
      this.#receipts.delete(id);
    });
  }
  async testConnection(input: DbLinkConnectionInput): Promise<DbLinkTestReceipt> {
    this.#assertReady(); let candidate = this.#normalize(input);
    const previous = this.#state.unconfirmedTests?.find(item => sameReadDomain(item, candidate.configuration));
    if (previous) {
      const pending = this.#receipts.get(previous.id);
      // An explicit retest may only retry the original retained cleanup, never a new DSN.
      if (!pending?.cleanup || pending.candidate.configuration.fingerprint !== candidate.configuration.fingerprint) fail('db_read_unconfirmed');
      let ended: unknown; try { ended = await pending.cleanup(); } catch { fail('db_read_unconfirmed'); }
      if (!probeEnded(ended)) fail('db_read_unconfirmed');
      await this.#clearTestFact(previous.id);
    }
    const id = randomUUID();
    await this.#mutate(async () => {
      this.#assertReady(); candidate = this.#normalize(input); this.assertReadClear(candidate.configuration);
      const { engine, host, port, database, username } = candidate.configuration;
      const fact: UnconfirmedTest = { id, engine, host, port, database, username, startedAt: new Date(this.#now()).toISOString() };
      await this.#persist({ ...this.#state, unconfirmedTests: [...(this.#state.unconfirmedTests ?? []), fact] });
      this.#receipts.set(id, { candidate });
    });
    let result: unknown;
    try { result = await this.#options.probe(freeze(clone(candidate.configuration))); } catch { fail('db_read_unconfirmed'); }
    const pending = this.#receipts.get(id)!;
    if (record(result) && typeof result.cleanup === 'function') pending.cleanup = result.cleanup as () => Promise<DbLinkProbeResourceState>;
    if (!record(result) || !probeEnded(result.resourceState)) fail('db_read_unconfirmed');
    await this.#clearTestFact(id);
    let observed: DbLinkTestObservation;
    try {
      observed = observation(result.observation);
      // A driver error or probe message must never echo a password back into public receipts.
      if (JSON.stringify(observed).includes(candidate.configuration.password)) fail('db_test_failed');
    } catch { fail('db_test_failed'); }
    const now = this.#now();
    const value: DbLinkTestReceipt = { ...observed, id, fingerprint: candidate.configuration.fingerprint, testedAt: new Date(now).toISOString(), expiresAt: new Date(now + (this.#options.testReceiptTtlMs ?? 300000)).toISOString() };
    this.#receipts.set(value.id, { value, candidate });
    for (const [id, receipt] of this.#receipts) if (receipt.value && Date.parse(receipt.value.expiresAt) <= now) this.#receipts.delete(id);
    return clone(value);
  }
  saveConnection(input: DbLinkConnectionInput, receiptId: string): Promise<DbLinkPublicConnection> {
    return this.#mutate(async () => {
      this.#assertReady(); const candidate = this.#normalize(input), receipt = this.#receipts.get(receiptId);
      this.assertReadClear(candidate.configuration);
      if (!receipt?.value || Date.parse(receipt.value.expiresAt) <= this.#now() || receipt.value.fingerprint !== candidate.configuration.fingerprint || receipt.candidate.baseRevision !== candidate.baseRevision) fail('db_test_required');
      const saved: StoredConnection = { ...receipt.candidate.configuration, testedAt: receipt.value.testedAt, observation: clone(receipt.value) };
      // Strip receipt identity/times from the persisted technical observation.
      saved.observation = observation(saved.observation);
      const next = { ...this.#state, connections: [...this.#state.connections, saved] };
      await this.#persist(next); this.#receipts.delete(receiptId);
      return this.#public(saved);
    });
  }
  #project(projectId: string, writable = false): void {
    this.#assertReady(); const state = validId(projectId) ? this.#options.projectState(projectId) : null;
    if (!state) fail('db_project_not_found');
    if (writable && state.archived) fail('db_project_archived');
  }
  #task(projectId: string, taskId: string, writable = false): void {
    this.#project(projectId, writable);
    if (!validId(taskId) || this.#options.taskProject(taskId) !== projectId) fail('db_task_not_found');
  }
  #grant(projectId: string, connectionId: string): DbLinkProjectGrant | undefined { return last(this.#state.grants, item => item.projectId === projectId && item.connectionId === connectionId); }
  #source(grant: DbLinkProjectGrant): DbLinkSource {
    const connection = this.read(grant.connectionId, grant.connectionRevision);
    if (!connection || connection.fingerprint !== grant.connectionFingerprint) fail('db_store_corrupt');
    return { grant: clone(grant), connection, scope: clone(grant.scope), modelExport: clone(grant.modelExport), configurationChanged: this.#current(grant.connectionId)?.fingerprint !== grant.connectionFingerprint };
  }
  grantProject(projectId: string, input: DbLinkProjectGrantInput): Promise<DbLinkProjectGrant> {
    return this.#mutate(async () => {
      this.#project(projectId, true);
      if (!record(input)) fail('invalid_db_grant');
      exactKeys(input, ['connectionId', 'connectionRevision', 'scope', 'modelExport']);
      if (!validId(input.connectionId)) fail('invalid_db_grant');
      const connection = this.#current(input.connectionId);
      if (!connection || (input.connectionRevision !== undefined && input.connectionRevision !== connection.revision)) fail('db_connection_changed');
      const grant: DbLinkProjectGrant = { id: randomUUID(), projectId, connectionId: connection.id, connectionRevision: connection.revision, connectionFingerprint: connection.fingerprint, permissionBinding: connection.observation.permissionBinding, scope: scope(input.scope), modelExport: modelExport(input.modelExport), grantedAt: new Date(this.#now()).toISOString(), revokedAt: null };
      const next = { ...this.#state, grants: [...this.#state.grants, grant] };
      await this.#persist(next); return clone(grant);
    });
  }
  revokeProject(projectId: string, connectionId: string): Promise<DbLinkProjectGrant> {
    try { this.#project(projectId, true); if (!this.#grant(projectId, connectionId)) fail('db_source_not_authorized'); }
    catch (error) { return Promise.reject(error); }
    const key = `${projectId}:${connectionId}`;
    this.#pendingRevocations.set(key, (this.#pendingRevocations.get(key) ?? 0) + 1);
    return this.#mutate(async () => {
      this.#project(projectId, true); const current = this.#grant(projectId, connectionId);
      if (!current) fail('db_source_not_authorized');
      if (current.revokedAt) { this.#completeRevocation(key); return clone(current); }
      const revoked = { ...current, revokedAt: new Date(this.#now()).toISOString() };
      const next = { ...this.#state, grants: this.#state.grants.map(item => item === current ? revoked : item) };
      // Deny dispatch before awaiting persistence; a disk failure stays fail-closed in this Host.
      this.#state = next; await this.#persist(next); this.#completeRevocation(key); return clone(revoked);
    });
  }
  #completeRevocation(key: string): void {
    const count = this.#pendingRevocations.get(key) ?? 0;
    if (count <= 1) this.#pendingRevocations.delete(key); else this.#pendingRevocations.set(key, count - 1);
  }
  listProjectSources(projectId: string): DbLinkSource[] {
    this.#project(projectId);
    return this.#state.grants.filter(item => item.projectId === projectId && this.#grant(projectId, item.connectionId) === item).map(item => this.#source(item));
  }
  listTaskSources(projectId: string, taskId: string): DbLinkSource[] {
    this.#task(projectId, taskId);
    return this.listProjectSources(projectId).filter(source => !source.grant.revokedAt && !this.#pendingRevocations.has(`${projectId}:${source.connection.id}`)).flatMap(source => {
      const policy = this.#state.taskPolicies.find(item => item.projectId === projectId && item.taskId === taskId && item.connectionId === source.connection.id)?.policy;
      if (policy?.excluded) return [];
      if (policy?.scope) {
        // A later, narrower project grant cannot restore previously excluded objects.
        const objects = source.scope.objects.includes('*') ? policy.scope.objects : policy.scope.objects.includes('*') ? source.scope.objects : policy.scope.objects.filter(item => source.scope.objects.includes(item));
        if (!objects.length) return [];
        source.scope = { ...policy.scope, objects };
      }
      if (policy?.modelExport) source.modelExport = { targets: policy.modelExport.targets.filter(item => source.modelExport.targets.includes(item)), structure: policy.modelExport.structure && source.modelExport.structure, comments: policy.modelExport.comments && source.modelExport.comments, queryText: policy.modelExport.queryText && source.modelExport.queryText, results: policy.modelExport.results && source.modelExport.results };
      return [source];
    });
  }
  setTaskPolicy(projectId: string, taskId: string, connectionId: string, input: DbLinkTaskPolicy): Promise<void> {
    return this.#mutate(async () => {
      this.#task(projectId, taskId, true);
      const grant = this.#grant(projectId, connectionId); if (!grant || grant.revokedAt) fail('db_source_not_authorized');
      if (!record(input) || typeof input.excluded !== 'boolean') fail('invalid_db_task_policy');
      exactKeys(input, ['excluded', 'scope', 'modelExport']);
      const policy: DbLinkTaskPolicy = { excluded: input.excluded, ...(input.scope === undefined ? {} : { scope: scope(input.scope) }), ...(input.modelExport === undefined ? {} : { modelExport: modelExport(input.modelExport) }) };
      if ((policy.scope && !narrowerScope(policy.scope, grant.scope)) || (policy.modelExport && !narrowerExport(policy.modelExport, grant.modelExport))) fail('db_task_scope_expanded');
      const next = { ...this.#state, taskPolicies: [...this.#state.taskPolicies.filter(item => !(item.projectId === projectId && item.taskId === taskId && item.connectionId === connectionId)), { projectId, taskId, connectionId, policy }] };
      await this.#persist(next);
    });
  }
  /** Authorization gate only: the driver must separately enforce query qualification/native scope. */
  requireTaskSource(projectId: string, taskId: string, connectionId: string, options: { modelTarget?: string; content?: typeof exportKinds[number]; grantId?: string; fingerprint?: string } = {}): DbLinkSource {
    this.#task(projectId, taskId, true);
    const source = this.listTaskSources(projectId, taskId).find(item => item.connection.id === connectionId);
    if (!source) fail('db_source_not_authorized');
    if (source.configurationChanged || (options.fingerprint !== undefined && options.fingerprint !== source.connection.fingerprint) || (options.grantId !== undefined && options.grantId !== source.grant.id)) fail('db_connection_changed');
    if ((options.modelTarget !== undefined && !source.modelExport.targets.includes(options.modelTarget)) || (options.content !== undefined && !source.modelExport[options.content])) fail('db_model_export_not_authorized');
    return source;
  }
}
