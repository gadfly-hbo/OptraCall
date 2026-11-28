import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  SERVICE_IDS, ServiceConnectionError, checkServiceBinding, isServiceId,
  parseServiceConnectionConfig, parseServiceConnectionCredentials, parseServiceJson,
  parseServiceRepositories, parseServiceScopes, parseServiceTools, serviceKeys,
  servicePolicyFingerprint, serviceRecord, serviceText, validateTaskServiceBindings,
} from './service-connection-types.ts';
import type {
  JsonValue, ServiceBindingCheck, ServiceConnection, ServiceConnectionConfig,
  ServiceConnectionCredentials, ServiceConnectionStatus, ServiceConnectionVerification,
  ServiceId, ServiceOperationAttempt, ServiceOperationInput, ServiceOperationStatus,
  TaskServiceBinding,
} from './service-connection-types.ts';

type ConnectionMetadata = Omit<ServiceConnection, keyof ServiceConnectionConfig | 'credentialsConfigured'> & Pick<ServiceConnectionConfig, 'scopes' | 'repositories' | 'mailboxType'>;
type StoredConnection = { config: ServiceConnectionConfig; connection: ConnectionMetadata; credentials: ServiceConnectionCredentials };
type StoredOperation = { attempt: ServiceOperationAttempt; arguments: { [key: string]: JsonValue }; submissionProcess?: string };
type StoredState = { schema: 1; version: number; connections: Partial<Record<ServiceId, StoredConnection>>; operations: StoredOperation[] };
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ARGUMENT_BYTES = 4 * 1024 * 1024;
const MAX_OPERATIONS = 10000;
const PROCESS_INSTANCE = `${process.pid}:${randomUUID()}`;
const statuses: readonly ServiceConnectionStatus[] = ['disconnected', 'unverified', 'authorizing', 'verified', 'expired', 'error', 'disconnecting', 'unknown'];
const operationStatuses: readonly ServiceOperationStatus[] = ['prepared', 'confirmed', 'submitted', 'succeeded', 'rejected', 'unknown'];
const stamp = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (serviceRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const stable = (value: unknown) => JSON.stringify(canonical(value));
const digest = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
function date(value: unknown): string { const result = serviceText(value, 40); if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw new ServiceConnectionError('service_store_corrupt', 503); return result; }
function revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ServiceConnectionError('invalid_service_revision'); return Number(value); }
function publicConnection(value: StoredConnection): ServiceConnection {
  const credentials = value.credentials;
  return clone({ ...value.config, ...value.connection, credentialsConfigured: { accessToken: Boolean(credentials.accessToken || credentials.oauthState), refreshToken: Boolean(credentials.refreshToken), clientSecret: Boolean(credentials.clientSecret), authorizationCode: Boolean(credentials.authorizationCode) } });
}
function verification(service: ServiceId, input: unknown, config: ServiceConnectionConfig): ServiceConnectionVerification {
  if (!serviceRecord(input)) throw new ServiceConnectionError('invalid_service_verification');
  serviceKeys(input, ['accountId', 'accountLabel', 'scopes', 'tools', 'repositories', 'mailboxType', 'tenantId', 'appId']);
  const result: ServiceConnectionVerification = { accountId: serviceText(input.accountId, 500), accountLabel: serviceText(input.accountLabel, 500), scopes: parseServiceScopes(service, input.scopes), tools: parseServiceTools(service, input.tools) };
  if (result.scopes.some(scope => !config.scopes.includes(scope)) || result.tools.some(tool => !result.scopes.includes(tool.scope))) throw new ServiceConnectionError('service_permission_mismatch');
  if (service === 'github') { result.repositories = parseServiceRepositories(input.repositories); if (result.repositories.some(repo => !config.repositories?.includes(repo))) throw new ServiceConnectionError('service_permission_mismatch'); }
  else if (input.repositories !== undefined) throw new ServiceConnectionError('invalid_service_verification');
  if (service === 'tencent') { if (input.mailboxType !== config.mailboxType) throw new ServiceConnectionError('service_identity_mismatch'); result.mailboxType = config.mailboxType; }
  else if (input.mailboxType !== undefined) throw new ServiceConnectionError('invalid_service_verification');
  if (service === 'feishu') { result.tenantId = serviceText(input.tenantId, 500); result.appId = serviceText(input.appId, 500); }
  else if (input.tenantId !== undefined || input.appId !== undefined) throw new ServiceConnectionError('invalid_service_verification');
  return result;
}
function parseStoredConnection(service: ServiceId, input: unknown): StoredConnection {
  if (!serviceRecord(input) || !serviceRecord(input.connection)) throw new ServiceConnectionError('service_store_corrupt', 503);
  serviceKeys(input, ['config', 'connection', 'credentials']);
  const config = parseServiceConnectionConfig(service, input.config), credentials = parseServiceConnectionCredentials(input.credentials), c = input.connection;
  serviceKeys(c, ['connectionId', 'service', 'revision', 'status', 'accountId', 'accountLabel', 'tenantId', 'appId', 'tools', 'verifiedAt', 'updatedAt', 'scopes', 'repositories', 'mailboxType']);
  if (c.service !== service || !statuses.includes(c.status as ServiceConnectionStatus)) throw new ServiceConnectionError('service_store_corrupt', 503);
  const connection: ConnectionMetadata = { connectionId: serviceText(c.connectionId, 100), service, revision: revision(c.revision), status: c.status as ServiceConnectionStatus, scopes: parseServiceScopes(service, c.scopes), tools: parseServiceTools(service, c.tools), updatedAt: date(c.updatedAt) };
  if (connection.scopes.some(scope => !config.scopes.includes(scope)) || connection.tools.some(tool => !connection.scopes.includes(tool.scope))) throw new ServiceConnectionError('service_store_corrupt', 503);
  if (service === 'github') { connection.repositories = parseServiceRepositories(c.repositories); if (connection.repositories.some(repo => !config.repositories?.includes(repo))) throw new ServiceConnectionError('service_store_corrupt', 503); }
  else if (c.repositories !== undefined) throw new ServiceConnectionError('service_store_corrupt', 503);
  if (service === 'tencent') { if (c.mailboxType !== config.mailboxType) throw new ServiceConnectionError('service_store_corrupt', 503); connection.mailboxType = config.mailboxType; }
  else if (c.mailboxType !== undefined) throw new ServiceConnectionError('service_store_corrupt', 503);
  for (const key of ['accountId', 'accountLabel', 'tenantId', 'appId'] as const) if (c[key] !== undefined) connection[key] = serviceText(c[key], 500);
  if (c.verifiedAt !== undefined) connection.verifiedAt = date(c.verifiedAt);
  if (Boolean(connection.accountId) !== Boolean(connection.accountLabel) || connection.status === 'verified' && (!connection.accountId || !connection.verifiedAt)) throw new ServiceConnectionError('service_store_corrupt', 503);
  if (service !== 'feishu' && (connection.tenantId !== undefined || connection.appId !== undefined) || service === 'feishu' && connection.accountId && (!connection.tenantId || !connection.appId)) throw new ServiceConnectionError('service_store_corrupt', 503);
  return { config, connection, credentials };
}
function operationIdentity(input: ServiceOperationInput, args: { [key: string]: JsonValue }, target: { [key: string]: JsonValue }): object {
  const b = input.binding;
  return { projectId: input.projectId, taskId: input.taskId, requestId: input.requestId, toolCallId: input.toolCallId, service: b.service, connectionId: b.connectionId, accountId: b.accountId, revision: b.revision, tenantId: b.tenantId, appId: b.appId, mailboxType: b.mailboxType, toolName: input.toolName, target, arguments: args, requiresConfirmation: input.requiresConfirmation };
}
function parseStoredOperation(input: unknown): StoredOperation {
  if (!serviceRecord(input) || !serviceRecord(input.attempt)) throw new ServiceConnectionError('service_store_corrupt', 503);
  serviceKeys(input, ['attempt', 'arguments', 'submissionProcess']);
  const raw = input.attempt;
  serviceKeys(raw, ['operationId', 'projectId', 'taskId', 'requestId', 'toolCallId', 'service', 'connectionId', 'accountId', 'accountLabel', 'revision', 'tenantId', 'appId', 'mailboxType', 'toolName', 'target', 'argumentsDigest', 'contentDigest', 'requiresConfirmation', 'status', 'createdAt', 'updatedAt', 'resultId']);
  if (!isServiceId(raw.service) || !operationStatuses.includes(raw.status as ServiceOperationStatus) || typeof raw.requiresConfirmation !== 'boolean') throw new ServiceConnectionError('service_store_corrupt', 503);
  const attempt: ServiceOperationAttempt = { operationId: serviceText(raw.operationId, 100), projectId: serviceText(raw.projectId, 100), taskId: serviceText(raw.taskId, 100), requestId: serviceText(raw.requestId, 200), toolCallId: serviceText(raw.toolCallId, 200), service: raw.service, connectionId: serviceText(raw.connectionId, 100), accountId: serviceText(raw.accountId, 500), accountLabel: serviceText(raw.accountLabel, 500), revision: revision(raw.revision), toolName: serviceText(raw.toolName, 200), target: parseServiceJson(raw.target, 32 * 1024), argumentsDigest: serviceText(raw.argumentsDigest, 64), contentDigest: serviceText(raw.contentDigest, 64), requiresConfirmation: raw.requiresConfirmation, status: raw.status as ServiceOperationStatus, createdAt: date(raw.createdAt), updatedAt: date(raw.updatedAt) };
  for (const key of ['tenantId', 'appId'] as const) if (raw[key] !== undefined) attempt[key] = serviceText(raw[key], 500);
  if (raw.mailboxType !== undefined) { if (raw.mailboxType !== 'qq' && raw.mailboxType !== 'exmail' || raw.service !== 'tencent') throw new ServiceConnectionError('service_store_corrupt', 503); attempt.mailboxType = raw.mailboxType; }
  if (raw.service === 'tencent' && !attempt.mailboxType || raw.service === 'feishu' && (!attempt.tenantId || !attempt.appId) || raw.service !== 'feishu' && (attempt.tenantId || attempt.appId)) throw new ServiceConnectionError('service_store_corrupt', 503);
  if (raw.resultId !== undefined) attempt.resultId = serviceText(raw.resultId, 500);
  const args = parseServiceJson(input.arguments, MAX_ARGUMENT_BYTES);
  if (!/^[a-f0-9]{64}$/.test(attempt.argumentsDigest) || !/^[a-f0-9]{64}$/.test(attempt.contentDigest) || attempt.argumentsDigest !== digest(args)) throw new ServiceConnectionError('service_store_corrupt', 503);
  const binding = { ...attempt, scopes: ['read'], tools: [] } as unknown as TaskServiceBinding;
  const identity = { ...attempt, binding, arguments: args } satisfies ServiceOperationInput;
  if (attempt.contentDigest !== digest(operationIdentity(identity, args, attempt.target))) throw new ServiceConnectionError('service_store_corrupt', 503);
  return { attempt, arguments: args, ...(input.submissionProcess === undefined ? {} : { submissionProcess: serviceText(input.submissionProcess, 100) }) };
}
function parseState(input: unknown): StoredState {
  try {
    if (!serviceRecord(input) || input.schema !== 1 || !Number.isSafeInteger(input.version) || Number(input.version) < 0 || !serviceRecord(input.connections) || !Array.isArray(input.operations) || input.operations.length > MAX_OPERATIONS) throw new Error();
    serviceKeys(input, ['schema', 'version', 'connections', 'operations']); serviceKeys(input.connections, SERVICE_IDS);
    const connections: StoredState['connections'] = {};
    for (const [service, value] of Object.entries(input.connections)) { if (!isServiceId(service)) throw new Error(); connections[service] = parseStoredConnection(service, value); }
    const operations = input.operations.map(parseStoredOperation);
    if (new Set(operations.map(value => value.attempt.operationId)).size !== operations.length) throw new Error();
    if (new Set(Object.values(connections).map(value => value.connection.connectionId)).size !== Object.keys(connections).length) throw new Error();
    return { schema: 1, version: Number(input.version), connections, operations };
  } catch { throw new ServiceConnectionError('service_store_corrupt', 503); }
}

/** One private atomic file keeps verified policy and credentials from different revisions apart. */
export class ServiceConnectionStore {
  readonly dataRoot: string;
  readonly root: string;
  readonly file: string;
  readonly lockPath: string;
  #ready = false;
  constructor(options: { dataRoot: string }) {
    this.dataRoot = path.resolve(options.dataRoot); this.root = path.join(this.dataRoot, 'service-connections'); this.file = path.join(this.root, 'connections.json'); this.lockPath = path.join(this.root, '.store.lock');
  }
  async #directory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ServiceConnectionError('unsafe_service_storage', 503);
    await chmod(directory, 0o700);
  }
  async init(): Promise<void> {
    await this.#directory(this.dataRoot); await this.#directory(this.root);
    await this.#locked(async () => {
      const state = await this.#load(true);
      let changed = !(await this.#exists());
      for (const operation of state.operations) {
        // An interrupted submission can have taken effect; startup never retries it.
        if (operation.attempt.status === 'submitted' && operation.submissionProcess !== PROCESS_INSTANCE) { operation.attempt.status = 'unknown'; operation.attempt.updatedAt = stamp(); changed = true; }
      }
      if (changed) await this.#save(state);
      else await chmod(this.file, 0o600);
    });
    this.#ready = true;
  }
  async #exists(): Promise<boolean> { try { await lstat(this.file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw new ServiceConnectionError('unsafe_service_storage', 503); } }
  #assertReady(): void { if (!this.#ready) throw new ServiceConnectionError('service_store_not_initialized', 503); }
  async #regular(file: string, allowMissing = false): Promise<void> {
    try { const entry = await lstat(file); if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new ServiceConnectionError('unsafe_service_storage', 503); }
    catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return; if (error instanceof ServiceConnectionError) throw error; throw new ServiceConnectionError('unsafe_service_storage', 503); }
  }
  async #load(allowMissing = false): Promise<StoredState> {
    for (const directory of [this.dataRoot, this.root]) { const entry = await lstat(directory); if (!entry.isDirectory() || entry.isSymbolicLink()) throw new ServiceConnectionError('unsafe_service_storage', 503); }
    let handle;
    try {
      handle = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const entry = await handle.stat();
      // Atomic replacement may unlink this already-open snapshot; extra links remain unsafe.
      if (!entry.isFile() || entry.nlink > 1 || entry.size > MAX_FILE_BYTES) throw new Error();
      const bytes = await handle.readFile();
      if (bytes.byteLength > MAX_FILE_BYTES) throw new Error();
      return parseState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 1, version: 0, connections: {}, operations: [] };
      throw new ServiceConnectionError('service_store_corrupt', 503);
    } finally { await handle?.close(); }
  }
  async #save(state: StoredState): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(state) + '\n');
    if (bytes.length > MAX_FILE_BYTES) throw new ServiceConnectionError('service_store_full', 413);
    const temporary = path.join(this.root, `.connections-${randomUUID()}.tmp`);
    let handle;
    try {
      await this.#regular(this.file, true);
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.chmod(0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
      await rename(temporary, this.file);
      const directory = await open(this.root, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) { if (error instanceof ServiceConnectionError) throw error; throw new ServiceConnectionError('service_store_write_failed', 503); }
    finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
  }
  async #locked<T>(operation: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 5000;
    let handle;
    while (!handle) {
      try { handle = await open(this.lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new ServiceConnectionError('unsafe_service_storage', 503);
        // The owner may release its lock between O_EXCL and this path check.
        await this.#regular(this.lockPath, true);
        if (Date.now() >= deadline) throw new ServiceConnectionError('service_store_busy', 409);
        await new Promise(resolve => setTimeout(resolve, 10 + Math.floor(Math.random() * 15)));
      }
    }
    const own = await handle.stat();
    try { await handle.writeFile(JSON.stringify({ process: PROCESS_INSTANCE, createdAt: stamp() })); return await operation(); }
    finally {
      await handle.close();
      try { const current = await lstat(this.lockPath); if (current.ino === own.ino && current.dev === own.dev && current.isFile() && current.nlink === 1) await unlink(this.lockPath); }
      catch { /* A changed lock is never removed on another writer's behalf. */ }
    }
  }
  async #mutate<T>(operation: (state: StoredState) => T | Promise<T>, expectedVersion?: number, signal?: AbortSignal, expectedConnection?: { service: ServiceId; fingerprint: string }): Promise<T> {
    this.#assertReady();
    return this.#locked(async () => {
      const state = await this.#load();
      if (signal?.aborted) throw new ServiceConnectionError('service_authorization_cancelled', 409);
      if (expectedConnection) {
        if (!isServiceId(expectedConnection.service)) throw new ServiceConnectionError('invalid_service');
        const current = state.connections[expectedConnection.service];
        if (typeof expectedConnection.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(expectedConnection.fingerprint) || !current || digest(current) !== expectedConnection.fingerprint) throw new ServiceConnectionError('service_connection_conflict', 409);
      } else if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion !== state.version)) throw new ServiceConnectionError('service_connection_conflict', 409);
      const value = await operation(state);
      if (signal?.aborted) throw new ServiceConnectionError('service_authorization_cancelled', 409);
      state.version++; await this.#save(state); return clone(value);
    });
  }
  #get(state: StoredState, service: ServiceId, expectedRevision?: number): StoredConnection {
    if (!isServiceId(service)) throw new ServiceConnectionError('invalid_service');
    const found = state.connections[service];
    if (!found) throw new ServiceConnectionError('service_connection_not_found', 404);
    if (expectedRevision !== undefined && revision(expectedRevision) !== found.connection.revision) throw new ServiceConnectionError('service_connection_conflict', 409);
    return found;
  }
  async version(): Promise<number> { this.#assertReady(); return (await this.#load()).version; }
  async list(): Promise<ServiceConnection[]> { this.#assertReady(); const state = await this.#load(); return SERVICE_IDS.flatMap(service => state.connections[service] ? [publicConnection(state.connections[service]!)] : []); }
  async get(service: ServiceId): Promise<ServiceConnection | null> { this.#assertReady(); if (!isServiceId(service)) throw new ServiceConnectionError('invalid_service'); const value = (await this.#load()).connections[service]; return value ? publicConnection(value) : null; }
  async saveConfiguration(service: ServiceId, input: unknown, expectedRevision?: number, expectedVersion?: number): Promise<ServiceConnection> {
    if (!isServiceId(service) || !serviceRecord(input)) throw new ServiceConnectionError('invalid_service_configuration');
    const { credentials: rawCredentials, ...rawConfig } = input;
    const config = parseServiceConnectionConfig(service, rawConfig), credentials = rawCredentials === undefined ? undefined : parseServiceConnectionCredentials(rawCredentials);
    return this.#mutate(state => {
      const current = state.connections[service];
      if (expectedRevision !== undefined && (current ? current.connection.revision : 0) !== expectedRevision) throw new ServiceConnectionError('service_connection_conflict', 409);
      const changed = current && stable(current.config) !== stable(config);
      const connection: ConnectionMetadata = current ? { ...current.connection, status: 'unverified', updatedAt: stamp(), ...(changed ? { revision: current.connection.revision + 1, scopes: config.scopes, tools: [], repositories: config.repositories, mailboxType: config.mailboxType } : {}) } : { connectionId: randomUUID(), service, revision: 1, status: 'unverified', scopes: config.scopes, tools: [], updatedAt: stamp(), ...(config.repositories ? { repositories: config.repositories } : {}), ...(config.mailboxType ? { mailboxType: config.mailboxType } : {}) };
      const authenticationChanged = current && ['clientId', 'redirectUri', 'issuer', 'email', 'mailboxType'].some(key => current.config[key as keyof ServiceConnectionConfig] !== config[key as keyof ServiceConnectionConfig]);
      let previousCredentials: ServiceConnectionCredentials = authenticationChanged ? {} : { ...current?.credentials };
      // User-supplied credentials choose a new authentication mode. A PAT must not
      // remain shadowed by the old canonical OAuth record; refresh uses modifyCredentials.
      if (credentials?.accessToken !== undefined) {
        const { clientSecret } = previousCredentials;
        previousCredentials = clientSecret === undefined ? {} : { clientSecret };
      }
      // Tencent has no registered OAuth client: a new mailbox code replaces every
      // credential from its previous login, including in legacy/corrupt-mode inputs.
      if (service === 'tencent' && credentials?.authorizationCode !== undefined) previousCredentials = {};
      const next = { config, connection, credentials: { ...previousCredentials, ...(credentials ?? {}) } };
      state.connections[service] = next; return publicConnection(next);
    }, expectedVersion);
  }
  #verifiedMetadata(service: ServiceId, current: StoredConnection, input: ServiceConnectionVerification): ConnectionMetadata {
    if (current.connection.status === 'disconnected' || current.connection.status === 'disconnecting') throw new ServiceConnectionError('service_connection_unavailable', 409);
    const checked = verification(service, input, current.config);
    const next: ConnectionMetadata = { ...current.connection, ...checked, status: 'verified', verifiedAt: stamp(), updatedAt: stamp() };
    if (current.connection.accountId) {
      const policy = (value: ConnectionMetadata) => servicePolicyFingerprint({ ...value, accountId: value.accountId!, revision: 1 });
      if (policy(current.connection) !== policy(next)) next.revision++;
    }
    return next;
  }
  async verifyConnection(service: ServiceId, input: ServiceConnectionVerification, expectedRevision?: number, expectedVersion?: number): Promise<ServiceConnection> {
    return this.#mutate(state => {
      const current = this.#get(state, service, expectedRevision);
      current.connection = this.#verifiedMetadata(service, current, input); return publicConnection(current);
    }, expectedVersion);
  }
  /** Adopt a completed private OAuth/probe attempt only after trusted identity verification succeeds. */
  async adoptVerification(service: ServiceId, input: ServiceConnectionVerification, stagedCredentials: ServiceConnectionCredentials, expectedRevision?: number, expectedVersion?: number, signal?: AbortSignal, expectedConnectionFingerprint?: string): Promise<ServiceConnection> {
    const credentials = parseServiceConnectionCredentials(stagedCredentials);
    return this.#mutate(state => {
      const current = this.#get(state, service, expectedRevision);
      const connection = this.#verifiedMetadata(service, current, input);
      current.connection = connection; current.credentials = credentials; return publicConnection(current);
    }, expectedVersion, signal, expectedConnectionFingerprint === undefined ? undefined : { service, fingerprint: expectedConnectionFingerprint });
  }
  /** Host-only credential transport. The returned copy must never be added to ordinary responses. */
  /** Host-only coherent snapshot; neither credentials nor fingerprint belong in ordinary API responses. */
  async privateConnectionSnapshot(service: ServiceId): Promise<{ connection: ServiceConnection; credentials: ServiceConnectionCredentials; fingerprint: string }> {
    this.#assertReady(); const current = this.#get(await this.#load(), service);
    return { connection: publicConnection(current), credentials: clone(current.credentials), fingerprint: digest(current) };
  }
  async getCredentials(service: ServiceId): Promise<ServiceConnectionCredentials> { this.#assertReady(); return clone(this.#get(await this.#load(), service).credentials); }
  async updateCredentials(service: ServiceId, input: unknown, expectedRevision?: number, expectedVersion?: number): Promise<ServiceConnection> {
    const credentials = parseServiceConnectionCredentials(input);
    return this.#mutate(state => { const current = this.#get(state, service, expectedRevision); if (current.connection.status === 'disconnected' || current.connection.status === 'disconnecting') throw new ServiceConnectionError('service_connection_unavailable', 409); current.credentials = { ...current.credentials, ...credentials }; current.connection.updatedAt = stamp(); return publicConnection(current); }, expectedVersion);
  }
  /** Host-only atomic native OAuth refresh. A late refresh cannot revive a disconnected connection. */
  async modifyCredentials<T>(service: ServiceId, operation: (current: ServiceConnectionCredentials) => Promise<{ credentials: ServiceConnectionCredentials; result: T }> | { credentials: ServiceConnectionCredentials; result: T }, expectedVersion?: number, expectedConnectionFingerprint?: string): Promise<T> {
    return this.#mutate(async state => {
      const current = this.#get(state, service);
      if (current.connection.status === 'disconnected' || current.connection.status === 'disconnecting') throw new ServiceConnectionError('service_connection_unavailable', 409);
      let modified;
      try { modified = await operation(clone(current.credentials)); } catch (error) { if (error instanceof ServiceConnectionError) throw error; throw new ServiceConnectionError('service_credentials_update_failed', 503); }
      const credentials = parseServiceConnectionCredentials(modified.credentials);
      // Native getAuth uses modify for valid-token reads as well as real refreshes.
      if (stable(credentials) !== stable(current.credentials)) { current.credentials = credentials; current.connection.updatedAt = stamp(); }
      return modified.result;
    }, expectedVersion, undefined, expectedConnectionFingerprint === undefined ? undefined : { service, fingerprint: expectedConnectionFingerprint });
  }
  async setStatus(service: ServiceId, status: Exclude<ServiceConnectionStatus, 'verified'>, expectedRevision?: number, expectedVersion?: number, expectedConnectionFingerprint?: string): Promise<ServiceConnection> {
    if (!statuses.includes(status) || status as string === 'verified') throw new ServiceConnectionError('invalid_service_status');
    return this.#mutate(state => { const current = this.#get(state, service, expectedRevision); current.connection.status = status; current.connection.updatedAt = stamp(); return publicConnection(current); }, expectedVersion, undefined, expectedConnectionFingerprint === undefined ? undefined : { service, fingerprint: expectedConnectionFingerprint });
  }
  async disconnect(service: ServiceId, expectedRevision?: number): Promise<ServiceConnection> {
    return this.#mutate(state => { const current = this.#get(state, service, expectedRevision); current.connection.status = 'disconnected'; current.connection.updatedAt = stamp(); current.credentials = {}; return publicConnection(current); });
  }
  async createBinding(service: ServiceId, input?: unknown): Promise<TaskServiceBinding> {
    const current = await this.get(service);
    if (!current || current.status !== 'verified' || !current.accountId || !current.accountLabel) throw new ServiceConnectionError('service_connection_unavailable', 409);
    if (input !== undefined && !serviceRecord(input)) throw new ServiceConnectionError('invalid_service_binding');
    const selection = input as Record<string, unknown> | undefined;
    if (selection) serviceKeys(selection, ['scopes', 'repositories', 'toolNames']);
    const scopes = selection?.scopes === undefined ? current.scopes : parseServiceScopes(service, selection.scopes);
    const repositories = selection?.repositories === undefined ? current.repositories : parseServiceRepositories(selection.repositories);
    if (scopes.some(scope => !current.scopes.includes(scope)) || repositories?.some(repo => !current.repositories?.includes(repo))) throw new ServiceConnectionError('service_permission_mismatch');
    const toolNames = selection?.toolNames;
    if (toolNames !== undefined && (!Array.isArray(toolNames) || toolNames.length > 250 || toolNames.some(name => typeof name !== 'string' || !current.tools.some(tool => tool.name === name && scopes.includes(tool.scope))))) throw new ServiceConnectionError('service_permission_mismatch');
    const tools = current.tools.filter(tool => scopes.includes(tool.scope) && (toolNames === undefined || (toolNames as string[]).includes(tool.name)));
    return validateTaskServiceBindings({ [service]: { service, connectionId: current.connectionId, accountId: current.accountId, accountLabel: current.accountLabel, revision: current.revision, scopes, tools, ...(repositories ? { repositories } : {}), ...(current.mailboxType ? { mailboxType: current.mailboxType } : {}), ...(current.tenantId ? { tenantId: current.tenantId } : {}), ...(current.appId ? { appId: current.appId } : {}) } })[service]!;
  }
  async validateBinding(binding: TaskServiceBinding): Promise<ServiceBindingCheck> { return checkServiceBinding(await this.get(binding.service), binding); }
  async prepareOperation(input: ServiceOperationInput): Promise<ServiceOperationAttempt> {
    if (!serviceRecord(input)) throw new ServiceConnectionError('invalid_service_operation');
    serviceKeys(input, ['operationId', 'binding', 'toolName', 'target', 'arguments', 'requiresConfirmation', 'projectId', 'taskId', 'requestId', 'toolCallId']);
    const binding = validateTaskServiceBindings({ [input.binding?.service]: input.binding })[input.binding?.service];
    if (!binding || typeof input.requiresConfirmation !== 'boolean') throw new ServiceConnectionError('invalid_service_operation');
    const args = parseServiceJson(input.arguments, MAX_ARGUMENT_BYTES), target = parseServiceJson(input.target, 32 * 1024);
    if (Object.keys(target).some(key => /^(?:body|content|text|subject|attachments)$/i.test(key))) throw new ServiceConnectionError('invalid_service_target');
    const projectId = serviceText(input.projectId, 100), taskId = serviceText(input.taskId, 100), requestId = serviceText(input.requestId, 200), toolCallId = serviceText(input.toolCallId, 200), toolName = serviceText(input.toolName, 200), operationId = input.operationId === undefined ? randomUUID() : serviceText(input.operationId, 100);
    const normalized = { ...input, projectId, taskId, requestId, toolCallId, toolName, binding };
    const argumentsDigest = digest(args), contentDigest = digest(operationIdentity(normalized, args, target));
    return this.#mutate(state => {
      const existing = state.operations.find(value => value.attempt.operationId === operationId);
      if (existing) { if (existing.attempt.contentDigest !== contentDigest) throw new ServiceConnectionError('service_operation_conflict', 409); return existing.attempt; }
      // SDK/model retries can create a new tool call ID inside the original user
      // request. An uncertain identical write retains its original immutable attempt.
      const uncertain = state.operations.find(({ attempt }) =>
        (attempt.status === 'submitted' || attempt.status === 'unknown')
        && attempt.projectId === projectId && attempt.taskId === taskId && attempt.requestId === requestId
        && attempt.service === binding.service && attempt.connectionId === binding.connectionId
        && attempt.accountId === binding.accountId && attempt.revision === binding.revision
        && attempt.toolName === toolName && attempt.argumentsDigest === argumentsDigest
        && stable(attempt.target) === stable(target));
      if (uncertain) return uncertain.attempt;
      if (state.operations.length >= MAX_OPERATIONS) throw new ServiceConnectionError('service_operation_store_full', 413);
      const current = state.connections[binding.service];
      if (!current || !checkServiceBinding(publicConnection(current), binding).available) throw new ServiceConnectionError('service_binding_changed', 409);
      const tool = binding.tools.find(value => value.name === toolName);
      if (!tool?.write || tool.requiresConfirmation && !input.requiresConfirmation) throw new ServiceConnectionError('service_operation_not_allowed', 403);
      const attempt: ServiceOperationAttempt = { operationId, projectId, taskId, requestId, toolCallId, service: binding.service, connectionId: binding.connectionId, accountId: binding.accountId, accountLabel: binding.accountLabel, revision: binding.revision, toolName, target, argumentsDigest, contentDigest, requiresConfirmation: input.requiresConfirmation, status: 'prepared', createdAt: stamp(), updatedAt: stamp(), ...(binding.tenantId ? { tenantId: binding.tenantId } : {}), ...(binding.appId ? { appId: binding.appId } : {}), ...(binding.mailboxType ? { mailboxType: binding.mailboxType } : {}) };
      state.operations.push({ attempt, arguments: args }); return attempt;
    });
  }
  async transitionOperation(operationId: string, status: ServiceOperationStatus, options: { expectedStatus?: ServiceOperationStatus; resultId?: string; reconciled?: boolean } = {}): Promise<ServiceOperationAttempt> {
    serviceText(operationId, 100);
    if (!operationStatuses.includes(status) || !serviceRecord(options)) throw new ServiceConnectionError('invalid_service_operation');
    serviceKeys(options, ['expectedStatus', 'resultId', 'reconciled']);
    const resultId = options.resultId === undefined ? undefined : serviceText(options.resultId, 500);
    if (options.expectedStatus !== undefined && !operationStatuses.includes(options.expectedStatus) || options.reconciled !== undefined && typeof options.reconciled !== 'boolean') throw new ServiceConnectionError('invalid_service_operation');
    return this.#mutate(state => {
      const stored = state.operations.find(value => value.attempt.operationId === operationId);
      if (!stored) throw new ServiceConnectionError('service_operation_not_found', 404);
      const current = stored.attempt;
      if (options.expectedStatus !== undefined && current.status !== options.expectedStatus) throw new ServiceConnectionError('service_operation_conflict', 409);
      const allowed: Record<ServiceOperationStatus, ServiceOperationStatus[]> = { prepared: current.requiresConfirmation ? ['confirmed', 'rejected'] : ['confirmed', 'submitted', 'rejected'], confirmed: ['submitted', 'rejected'], submitted: ['succeeded', 'rejected', 'unknown'], succeeded: [], rejected: [], unknown: options.reconciled ? ['succeeded', 'rejected'] : [] };
      if (!allowed[current.status].includes(status)) throw new ServiceConnectionError('service_operation_transition_forbidden', 409);
      if (status === 'submitted') {
        const connection = state.connections[current.service];
        if (!connection || connection.connection.status !== 'verified' || connection.connection.connectionId !== current.connectionId || connection.connection.accountId !== current.accountId || connection.connection.revision !== current.revision) throw new ServiceConnectionError('service_binding_changed', 409);
        stored.submissionProcess = PROCESS_INSTANCE;
      }
      current.status = status; current.updatedAt = stamp();
      if (resultId !== undefined) current.resultId = resultId;
      return current;
    });
  }
  async getOperation(operationId: string): Promise<ServiceOperationAttempt | null> { this.#assertReady(); serviceText(operationId, 100); return clone((await this.#load()).operations.find(value => value.attempt.operationId === operationId)?.attempt ?? null); }
  /** Explicit content review only; ordinary operation listings contain no message/document body. */
  async getOperationReview(operationId: string): Promise<(ServiceOperationAttempt & { arguments: { [key: string]: JsonValue } }) | null> { this.#assertReady(); serviceText(operationId, 100); const found = (await this.#load()).operations.find(value => value.attempt.operationId === operationId); return found ? clone({ ...found.attempt, arguments: found.arguments }) : null; }
  async listOperations(options: { projectId: string; taskId: string; limit?: number; offset?: number }): Promise<{ operations: ServiceOperationAttempt[]; total: number; nextOffset: number | null }> {
    this.#assertReady(); if (!serviceRecord(options)) throw new ServiceConnectionError('invalid_service_operation'); serviceKeys(options, ['projectId', 'taskId', 'limit', 'offset']);
    const projectId = serviceText(options.projectId, 100), taskId = serviceText(options.taskId, 100), limit = options.limit ?? 50, offset = options.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > MAX_OPERATIONS) throw new ServiceConnectionError('invalid_service_pagination');
    const matches = (await this.#load()).operations.filter(value => value.attempt.projectId === projectId && value.attempt.taskId === taskId).reverse();
    return { operations: clone(matches.slice(offset, offset + limit).map(value => value.attempt)), total: matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null };
  }
}
