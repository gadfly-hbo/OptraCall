import { createHash } from 'node:crypto';
import type { ServiceConnectionsPort, ServiceConnectionCallContext, ServiceConnectionToolResult } from '../agent/service-connection-tools.ts';
import { validateServiceConnectionToolArguments } from '../agent/service-connection-tools.ts';
import { ServiceConnectionStore } from './service-connection-store.ts';
import { ServiceOAuthManager, createServiceOAuthCredentialStore, parseServiceOAuthProviderId } from './service-connection-oauth.ts';
import { RemoteServiceBackend, ServiceRemoteError } from './service-connection-mcp.ts';
import { answerServiceForm } from './service-connection-approval.ts';
import { prepareMailAction } from './service-connection-mail-preview.ts';
import { callTencent, verifyTencent, type TencentMailConfig } from './service-connection-mail.ts';
import { ServiceConnectionError, SERVICE_IDS, isServiceId, parseServiceJson, parseServiceConnectionConfig, parseServiceConnectionCredentials, parseServiceScopes, parseServiceRepositories, servicePolicyFingerprint, serviceText, validateTaskServiceBindings, type JsonValue, type ServiceId, type ServiceScope, type ServiceConnection, type ServiceConnectionCredentials, type ServiceConnectionVerification, type TaskServiceBindings, type TaskServiceBinding, type ServiceOperationAttempt } from './service-connection-types.ts';

type RemoteBackend = Pick<RemoteServiceBackend, 'verify' | 'invoke' | 'close'>;
type Cleanup = (options: { retryFailed?: boolean }) => Promise<void>;
type PrivateStage = { token: symbol; epoch: number; connection: ServiceConnection; version: number; fingerprint: string; credentials: ServiceConnectionCredentials; controller: AbortController; active: boolean; committing?: boolean };
type PendingAuthorization = { attemptId: string; url: string; stage: PrivateStage; completion: Promise<void> };
type VerificationResource = { controller: AbortController; cleanup: Cleanup; registerCleanup(cleanup: Cleanup): void; failed: boolean };
type AuthorizationResult = { attemptId: string; status: 'failed' | 'cancelled' | 'succeeded'; code?: string };
type Snapshot = { authorizationResult?: AuthorizationResult; connection: ServiceConnection; authorization?: { attemptId: string; url: string }; affectedTasks?: string[] };
type Options = {
  dataRoot: string;
  /** Uses the existing project-tasks domain to retire only affected owners. */
  invalidate(service: ServiceId): Promise<void>;
  assertOwner(projectId: string, taskId: string, bindings: TaskServiceBindings): Promise<void>;
  affectedTasks?(service: ServiceId): Promise<string[]>;
  store?: ServiceConnectionStore;
  backend?: RemoteBackend;
  oauthFactory?: (credentials: ReturnType<typeof createServiceOAuthCredentialStore>) => Promise<ServiceOAuthManager>;
  mail?: { verify: typeof verifyTencent; call: typeof callTencent };
};
const labels: Record<ServiceId, string> = { github: 'GitHub', gmail: 'Gmail', tencent: '腾讯邮箱', feishu: '飞书' };
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ServiceConnectionError('invalid_service_revision');
  return Number(value);
}
function mailConfig(connection: ServiceConnection): TencentMailConfig {
  if (!connection.mailboxType || !connection.email) throw new ServiceConnectionError('invalid_service_configuration');
  return { mailboxType: connection.mailboxType, login: connection.email, connectionId: connection.connectionId };
}
function preview(value: JsonValue, key = ''): JsonValue {
  if (typeof value === 'string' && /^(?:base64|contentBase64|data)$/i.test(key)) return { bytes: Buffer.byteLength(value, 'base64'), sha256: createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex') };
  if (Array.isArray(value)) return value.map(item => preview(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, preview(item, name)]));
  return value;
}
function outcome(value: unknown): 'succeeded' | 'rejected' | 'unknown' {
  if (!value || typeof value !== 'object') return 'succeeded';
  const result = value as Record<string, unknown>;
  if (result.status === 'unknown' || result.outcome === 'unknown' || result.isError === true) return 'unknown';
  if (result.status === 'failed' || result.status === 'rejected') return 'rejected';
  return 'succeeded';
}
/** One call may own several protocol resources, all retired under its original Host request. */
function verificationResource(controller = new AbortController()): VerificationResource {
  const entries: { callback: Cleanup; task?: Promise<void>; failed: boolean }[] = [];
  const resource: VerificationResource = {
    controller, failed: false,
    registerCleanup(callback) { entries.push({ callback, failed: false }); },
    async cleanup(options) {
      const settled = await Promise.allSettled(entries.map(async entry => {
        if (!entry.task || entry.failed && options.retryFailed === true) {
          entry.failed = false;
          entry.task = Promise.resolve().then(() => entry.callback(options)).catch(error => { entry.failed = true; throw error; });
        }
        await entry.task;
      }));
      resource.failed = settled.some(item => item.status === 'rejected');
      if (resource.failed) throw new ServiceConnectionError('service_cleanup_unknown', 409);
    },
  };
  return resource;
}
function operationTarget(binding: TaskServiceBinding, connection: ServiceConnection, args: Record<string, JsonValue>): Record<string, JsonValue> {
  // Public receipts identify the exact target; full content remains in the private journal.
  const target: Record<string, JsonValue> = { service: binding.service, connectionId: binding.connectionId, accountId: binding.accountId, accountLabel: binding.accountLabel, revision: binding.revision };
  if (binding.tenantId) target.tenantId = binding.tenantId;
  if (binding.appId) target.appId = binding.appId;
  if (binding.mailboxType) target.mailboxType = binding.mailboxType;
  if (binding.repositories) target.repositories = [...binding.repositories];
  if (binding.service === 'tencent') target.from = connection.email ?? binding.accountLabel;
  if (binding.service === 'gmail') target.from = binding.accountLabel;
  const keys = /^(?:owner|repo|repository|pull_?number|issue_?number|sha|merge_?method|to|cc|bcc|message_?id|thread_?id|replyToMessageId|replyThreadId|document_?id|doc_?id|documentId|docId|page_?id|chat_?id|receive_?id|receive_?id_?type|version|revision|expectedVersion|expectedRevision|folder|uid|uidValidity|source)$/i;
  for (const [key, value] of Object.entries(args)) if (keys.test(key)) target[key] = value;
  if (typeof args.subject === 'string') target.subjectSha256 = createHash('sha256').update(args.subject).digest('hex');
  return target;
}

/**
 * Stable service-journal identity for one external publication, derived from
 * the work identity only — never from a foreground tool call — so turns,
 * tool-call numbering and restarts converge on the same durable operation.
 */
export function hostPublicationOperationId(workId: string, revision: number, action: 'issue-create' | 'issue-comment'): string {
  return createHash('sha256').update(JSON.stringify(['optracall-host-publish-v1', workId, revision, action])).digest('hex');
}
/** External issue receipt from a GitHub MCP result; nothing else counts as an issue identity. */
function githubIssueNumber(value: unknown): number | undefined {
  const visit = (item: unknown, depth: number): number | undefined => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || depth > 3) return undefined;
    const record = item as Record<string, unknown>;
    if (Number.isSafeInteger(record.number) && Number(record.number) >= 1) return Number(record.number);
    if (typeof record.html_url === 'string') { const match = /\/issues\/(\d+)$/.exec(record.html_url); if (match) return Number(match[1]); }
    for (const key of ['structuredContent', 'data', 'result']) { const found = visit(record[key], depth + 1); if (found !== undefined) return found; }
    if (Array.isArray(record.content)) for (const part of record.content) { const found = visit(part, depth + 1); if (found !== undefined) return found; }
    return undefined;
  };
  return visit(value, 0);
}
/**
 * Transient store-lock contention (lock released inside the EEXIST check
 * window surfaces as `unsafe_service_storage`, not as a mutation result) is
 * retried with a bounded backoff; genuine integrity errors keep failing.
 */
const TRANSIENT_STORE_CODES = new Set(['unsafe_service_storage', 'service_store_busy']);
async function withStoreRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (attempt < 3 && error instanceof ServiceConnectionError && TRANSIENT_STORE_CODES.has(error.code)) { await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1))); continue; }
      throw error;
    }
  }
}

/** Host permission and side-effect boundary. No Agent loop or task lifecycle is created here. */
export type HostDispatchRequest = {
  projectId: string;
  taskId: string;
  workId: string;
  revision: number;
  action: 'issue-create' | 'issue-comment';
  repositoryId: string;
  title?: string;
  issueNumber?: number;
  body: string;
  bodyHash: string;
  /** Built by the Host for the external work; never a borrowed foreground session context. */
  hostContext?: {
    signal?: AbortSignal;
    assertCurrent?(): void;
    registerCleanup?(cleanup: (options: { retryFailed?: boolean }) => Promise<void>): void;
  };
};
export type HostDispatchResult = {
  outcome: 'succeeded' | 'rejected' | 'unknown';
  operationId?: string;
  operationStatus?: string;
  repositoryId?: string;
  issueNumber?: number;
  resultId?: string;
  code?: string;
};

export class ServiceConnectionManager {
  readonly store: ServiceConnectionStore;
  readonly #options: Options;
  #oauth?: ServiceOAuthManager;
  #backend?: RemoteBackend;
  #pending = new Map<ServiceId, PendingAuthorization>();
  #authorizationResults = new Map<ServiceId, AuthorizationResult>();
  #verification = new Map<ServiceId, VerificationResource>();
  #staging = new Map<ServiceId, PrivateStage>();
  #changes = new Map<ServiceId, symbol>();
  #unsafe = new Set<ServiceId>();
  #epochs = new Map<ServiceId, number>();
  #secrets = new Map<ServiceId, Set<string>>();
  #closed = false;
  #initializing?: Promise<void>;
  constructor(options: Options) { this.#options = options; this.store = options.store ?? new ServiceConnectionStore({ dataRoot: options.dataRoot }); this.#backend = options.backend; }
  #remember(service: ServiceId, credentials: ServiceConnectionCredentials): ServiceConnectionCredentials {
    const values = this.#secrets.get(service) ?? new Set<string>();
    const collect = (input: unknown) => {
      if (!input || typeof input !== 'object') return;
      for (const [key, value] of Object.entries(input)) {
        if (/^(?:access|refresh|access_?token|refresh_?token|id_?token|client_?secret|authorization_?code|password|key)$/i.test(key) && typeof value === 'string' && value) {
          values.add(value); values.add(encodeURIComponent(value));
          let escaped = value; for (let i = 0; i < 2; i++) { escaped = JSON.stringify(escaped).slice(1, -1); values.add(escaped); }
        } else if (value && typeof value === 'object') collect(value);
      }
    };
    collect(credentials);
    if (credentials.oauthState) { try { collect(JSON.parse(credentials.oauthState)); } catch { /* Invalid canonical state is rejected by the credential adapter. */ } }
    this.#secrets.set(service, values); return credentials;
  }
  #scrub<T>(service: ServiceId, value: T): T {
    const values = [...this.#secrets.get(service) ?? []].sort((a, b) => b.length - a.length);
    return JSON.parse(JSON.stringify(value, (_key, item) => {
      if (typeof item !== 'string') return item;
      for (const secret of values) item = item.split(secret).join('[凭据已隐藏]');
      return item;
    })) as T;
  }
  #error(service: ServiceId, error: unknown): ServiceConnectionError {
    if (error instanceof ServiceConnectionError && /^[a-z][a-z0-9_]{0,99}$/.test(error.code) && this.#scrub(service, error.code) === error.code) return error;
    return new ServiceConnectionError('service_request_failed', 502);
  }
  #result(service: ServiceId, value: unknown, operation?: ServiceOperationAttempt): ServiceConnectionToolResult {
    return this.#scrub(service, { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: { serviceConnection: true, ...(operation ? { operation } : {}) } });
  }
  #externalResultId(service: ServiceId, value: unknown): string | undefined {
    const candidates: Record<string, unknown>[] = [];
    const visit = (item: unknown, depth: number) => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || depth > 3) return;
      const record = item as Record<string, unknown>; candidates.push(record);
      for (const key of ['structuredContent', 'data', 'result', 'document', 'message']) visit(record[key], depth + 1);
      if (Array.isArray(record.content) && record.content.length === 1) {
        const part = record.content[0] as { type?: unknown; text?: unknown };
        if (part?.type === 'text' && typeof part.text === 'string' && part.text.length <= 65536) { try { visit(JSON.parse(part.text), depth + 1); } catch { /* A free-text success is not an external receipt. */ } }
      }
    };
    visit(value, 0);
    for (const record of candidates) {
      for (const key of service === 'tencent' ? ['messageId'] : service === 'github' ? ['sha', 'html_url', 'id'] : ['messageId', 'documentId', 'doc_id', 'id', 'url']) {
        const candidate = record[key];
        if (typeof candidate !== 'string' || !candidate || candidate.length > 500 || this.#scrub(service, candidate) !== candidate) continue;
        if (key === 'sha') { if (/^[a-fA-F0-9]{40}$/.test(candidate)) return candidate; continue; }
        if (key === 'url' || key === 'html_url') {
          try {
            const url = new URL(candidate), trusted = service === 'github' ? url.hostname === 'github.com' : service === 'gmail' ? url.hostname === 'mail.google.com' : /(?:^|\.)(?:feishu\.cn|larksuite\.com)$/.test(url.hostname);
            if (trusted && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return candidate;
          } catch { /* Only a bounded trusted-service URL is a receipt. */ }
          continue;
        }
        if (service === 'tencent' ? /^<[A-Za-z0-9][A-Za-z0-9_.@:+-]{0,254}>$/.test(candidate) : /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(candidate)) return candidate;
      }
    }
    return undefined;
  }
  #stageCurrent(stage: PrivateStage): void {
    stage.controller.signal.throwIfAborted();
    if (this.#closed || !stage.active || this.#staging.get(stage.connection.service) !== stage || this.#changes.get(stage.connection.service) !== stage.token || (this.#epochs.get(stage.connection.service) ?? 0) !== stage.epoch) throw new ServiceConnectionError('service_connection_changed', 409);
  }
  #eligible(service: ServiceId): void {
    if (this.#closed) throw new ServiceConnectionError('service_host_closing', 503);
    if (this.#changes.has(service) || this.#unsafe.has(service)) throw new ServiceConnectionError('service_connection_changing', 409);
  }
  /** Revocation is synchronous, before the first file read, close or provider request. */
  #beginChange(service: ServiceId): symbol {
    if (this.#closed) throw new ServiceConnectionError('service_host_closing', 503);
    const token = Symbol(service);
    this.#authorizationResults.delete(service);
    this.#epochs.set(service, (this.#epochs.get(service) ?? 0) + 1); this.#changes.set(service, token);
    const stage = this.#staging.get(service); if (stage) { stage.active = false; stage.controller.abort(); this.#staging.delete(service); }
    const pending = this.#pending.get(service); if (pending) { this.#pending.delete(service); this.#authorizationResults.set(service, { attemptId: pending.attemptId, status: 'cancelled', code: 'service_authorization_superseded' }); this.#oauth?.cancel(pending.attemptId); }
    this.#verification.get(service)?.controller.abort();
    return token;
  }
  #changeCurrent(service: ServiceId, token: symbol): void { if (this.#closed || this.#changes.get(service) !== token) throw new ServiceConnectionError('service_connection_changed', 409); }
  #finishChange(service: ServiceId, token: symbol): void { if (this.#changes.get(service) === token) this.#changes.delete(service); }
  init(): Promise<void> {
    return this.#initializing ??= (async () => {
      await this.store.init();
      const credentials = createServiceOAuthCredentialStore({
        modify: async (id, operation) => {
          const parsed = parseServiceOAuthProviderId(id), stage = this.#staging.get(parsed.service);
          if (stage && stage.connection.connectionId === parsed.connectionId) {
            this.#stageCurrent(stage); const next = await operation(structuredClone(stage.credentials)); this.#stageCurrent(stage);
            stage.credentials = this.#remember(parsed.service, parseServiceConnectionCredentials(next.credentials)); return next.result;
          }
          const version = await this.store.version(), epoch = this.#epochs.get(parsed.service) ?? 0;
          this.#eligible(parsed.service);
          const snapshot = await this.store.privateConnectionSnapshot(parsed.service), connection = snapshot.connection;
          if (!connection || connection.connectionId !== parsed.connectionId) throw new ServiceConnectionError('service_connection_changed', 409);
          return this.store.modifyCredentials(parsed.service, async saved => {
            this.#eligible(parsed.service); const next = await operation(this.#remember(parsed.service, saved)); this.#eligible(parsed.service);
            if (epoch !== (this.#epochs.get(parsed.service) ?? 0)) throw new ServiceConnectionError('service_connection_changed', 409);
            return { ...next, credentials: this.#remember(parsed.service, next.credentials) };
          }, version, snapshot.fingerprint);
        },
        read: async id => {
          const parsed = parseServiceOAuthProviderId(id), stage = this.#staging.get(parsed.service);
          if (stage && stage.connection.connectionId === parsed.connectionId) { this.#stageCurrent(stage); return structuredClone(stage.credentials); }
          this.#eligible(parsed.service); const connection = await this.store.get(parsed.service);
          if (!connection || connection.connectionId !== parsed.connectionId) return undefined;
          return this.#remember(parsed.service, await this.store.getCredentials(parsed.service));
        },
        write: async (id, secrets) => {
          const parsed = parseServiceOAuthProviderId(id), stage = this.#staging.get(parsed.service);
          if (stage && stage.connection.connectionId === parsed.connectionId) { this.#stageCurrent(stage); stage.credentials = this.#remember(parsed.service, parseServiceConnectionCredentials(secrets)); return; }
          const version = await this.store.version(); this.#eligible(parsed.service);
          const connection = await this.store.get(parsed.service);
          if (!connection || connection.connectionId !== parsed.connectionId) throw new ServiceConnectionError('service_connection_changed', 409);
          await this.store.updateCredentials(parsed.service, this.#remember(parsed.service, secrets), connection.revision, version);
        },
        remove: async id => {
          const parsed = parseServiceOAuthProviderId(id), stage = this.#staging.get(parsed.service);
          if (stage && stage.connection.connectionId === parsed.connectionId) { this.#stageCurrent(stage); stage.credentials = {}; return; }
          throw new ServiceConnectionError('service_oauth_removal_unavailable', 409);
        },
      });
      this.#oauth = await (this.#options.oauthFactory ? this.#options.oauthFactory(credentials) : ServiceOAuthManager.create({ credentials }));
      this.#backend ??= new RemoteServiceBackend({ oauth: this.#oauth });
    })();
  }
  policyFingerprint(bindings: TaskServiceBindings | undefined): string { return JSON.stringify(SERVICE_IDS.flatMap(service => bindings?.[service] ? [[servicePolicyFingerprint(bindings[service]!), this.#epochs.get(service) ?? 0]] : [])); }
  async #connection(service: ServiceId, expected?: number): Promise<ServiceConnection> {
    if (this.#closed) throw new ServiceConnectionError('service_host_closing', 503);
    const connection = await this.store.get(service);
    if (!connection) throw new ServiceConnectionError('service_connection_unverified', 409);
    if (expected !== undefined && connection.revision !== expected) throw new ServiceConnectionError('service_revision_conflict', 409);
    return connection;
  }
  async #retire(service: ServiceId, token: symbol): Promise<void> {
    const verification = this.#verification.get(service); verification?.controller.abort();
    const connection = await this.store.get(service); this.#changeCurrent(service, token);
    const settled = await Promise.allSettled([this.#options.invalidate(service), ...(verification ? [verification.cleanup({ retryFailed: true })] : []), ...(connection && this.#backend ? [this.#backend.close(connection.connectionId)] : [])]);
    this.#changeCurrent(service, token);
    if (settled.some(item => item.status === 'rejected')) {
      this.#unsafe.add(service); if (connection) await this.store.setStatus(service, 'unknown', connection.revision).catch(() => {});
      throw new ServiceConnectionError('service_cleanup_unknown', 409);
    }
    this.#unsafe.delete(service);
    if (this.#verification.get(service) === verification) this.#verification.delete(service);
  }
  async #createStage(service: ServiceId, token: symbol, expectedRevision: number): Promise<PrivateStage> {
    const version = await this.store.version(), snapshot = await this.store.privateConnectionSnapshot(service), connection = snapshot.connection, credentials = this.#remember(service, snapshot.credentials);
    this.#changeCurrent(service, token);
    if (connection.revision !== expectedRevision) throw new ServiceConnectionError('service_revision_conflict', 409);
    const stage: PrivateStage = { token, epoch: this.#epochs.get(service) ?? 0, connection, credentials, version, fingerprint: snapshot.fingerprint, controller: new AbortController(), active: true };
    this.#staging.set(service, stage); return stage;
  }
  #clearStage(stage: PrivateStage): void { stage.active = false; if (this.#staging.get(stage.connection.service) === stage) this.#staging.delete(stage.connection.service); }
  async #probe(stage: PrivateStage): Promise<ServiceConnectionVerification> {
    this.#stageCurrent(stage); const service = stage.connection.service, resource = verificationResource(stage.controller), signal = AbortSignal.any([stage.controller.signal, AbortSignal.timeout(60000)]);
    this.#verification.set(service, resource);
    const isCurrent = () => { try { this.#stageCurrent(stage); return !signal.aborted; } catch { return false; } };
    try {
      let verified: ServiceConnectionVerification;
      if (service === 'tencent') {
        const raw = await (this.#options.mail?.verify ?? verifyTencent)(mailConfig(stage.connection), stage.credentials.authorizationCode ?? '', signal, { registerCleanup: resource.registerCleanup });
        if (raw.status === 'unknown' || raw.cleanup === 'failed') { resource.failed = true; throw new ServiceConnectionError('service_cleanup_unknown', 503); }
        if (raw.status !== 'verified' || typeof raw.accountId !== 'string' || typeof raw.accountLabel !== 'string' || !Array.isArray(raw.scopes) || !Array.isArray(raw.tools)) throw new ServiceConnectionError('service_authentication_required', 401);
        const scopes = (raw.scopes as ServiceScope[]).filter(scope => stage.connection.scopes.includes(scope));
        verified = { accountId: raw.accountId, accountLabel: raw.accountLabel, mailboxType: stage.connection.mailboxType, scopes, tools: (raw.tools as ServiceConnectionVerification['tools']).filter(tool => scopes.includes(tool.scope)) };
      } else verified = await this.#backend!.verify(stage.connection, stage.credentials, { signal, isCurrent, registerCleanup: resource.registerCleanup });
      await resource.cleanup({ retryFailed: false }); this.#stageCurrent(stage); return verified;
    } catch (error) {
      // Backends may fail while retiring before they return a result. Observe the
      // cached close failure without retrying the same network/resource action.
      try { await resource.cleanup({ retryFailed: false }); } catch { resource.failed = true; }
      if (resource.failed) { this.#unsafe.add(service); throw new ServiceConnectionError('service_cleanup_unknown', 409); }
      throw error;
    } finally { if (this.#verification.get(service) === resource && !resource.failed) this.#verification.delete(service); }
  }
  async #adopt(stage: PrivateStage): Promise<void> {
    const verified = await this.#probe(stage); this.#stageCurrent(stage);
    stage.committing = true;
    await this.store.adoptVerification(stage.connection.service, verified, stage.credentials, stage.connection.revision, stage.version, stage.controller.signal, stage.fingerprint);
  }
  async #recordProbeFailure(stage: PrivateStage, error: unknown, preserveVerified: boolean): Promise<void> {
    if (this.#staging.get(stage.connection.service) !== stage || !stage.active || this.#closed) return;
    const status = this.#unsafe.has(stage.connection.service) ? 'unknown' : (error as { status?: number }).status === 401 ? 'expired' : 'error';
    if (preserveVerified && stage.connection.status === 'verified' && status !== 'unknown') return;
    await this.store.setStatus(stage.connection.service, status, stage.connection.revision, stage.version, stage.fingerprint).catch(() => {});
  }
  async snapshot(service: ServiceId): Promise<Snapshot> {
    const stored = await this.#connection(service), pending = this.#pending.get(service);
    const connection = pending ? { ...stored, status: 'authorizing' as const } : stored;
    return { connection, ...(this.#authorizationResults.has(service) ? { authorizationResult: this.#authorizationResults.get(service)! } : {}), ...(this.#options.affectedTasks ? { affectedTasks: await this.#options.affectedTasks(service) } : {}), ...(pending ? { authorization: { url: pending.url, attemptId: pending.attemptId } } : {}) };
  }
  async list() { return (await this.store.list()).map(connection => this.#pending.has(connection.service) ? { ...connection, status: 'authorizing' as const } : connection); }
  async save(service: ServiceId, input: { config: unknown; credentials?: unknown; expectedRevision: unknown }): Promise<Snapshot> {
    const expected = revision(input.expectedRevision), config = parseServiceConnectionConfig(service, input.config), credentials = input.credentials === undefined ? undefined : this.#remember(service, parseServiceConnectionCredentials(input.credentials));
    const token = this.#beginChange(service);
    try {
      const version = await this.store.version(), old = await this.store.get(service); this.#changeCurrent(service, token);
      if ((old?.revision ?? 0) !== expected) throw new ServiceConnectionError('service_revision_conflict', 409);
      await this.#retire(service, token); this.#changeCurrent(service, token);
      await this.store.saveConfiguration(service, { ...config, ...(credentials ? { credentials } : {}) }, expected, version);
      return await this.snapshot(service);
    } finally { this.#finishChange(service, token); }
  }
  async verify(service: ServiceId, expectedRevision: unknown): Promise<Snapshot> {
    const expected = revision(expectedRevision), token = this.#beginChange(service); let stage: PrivateStage | undefined;
    try {
      await this.#connection(service, expected); await this.#retire(service, token);
      stage = await this.#createStage(service, token, expected); await this.#adopt(stage); return await this.snapshot(service);
    } catch (error) { if (stage) await this.#recordProbeFailure(stage, error, false); throw this.#error(service, error); }
    finally { if (stage) this.#clearStage(stage); this.#finishChange(service, token); }
  }
  async authorize(service: ServiceId, expectedRevision: unknown): Promise<Snapshot> {
    if (service === 'tencent') return this.verify(service, expectedRevision);
    const expected = revision(expectedRevision), token = this.#beginChange(service); let stage: PrivateStage | undefined;
    try {
      await this.#connection(service, expected); await this.#retire(service, token);
      stage = await this.#createStage(service, token, expected);
      const attempt = await this.#oauth!.begin(stage.connection, structuredClone(stage.credentials), { signal: stage.controller.signal }); this.#stageCurrent(stage);
      const ownedStage = stage;
      const pending: PendingAuthorization = { attemptId: attempt.attemptId, url: attempt.authorizationUrl, stage, completion: Promise.resolve() };
      this.#pending.set(service, pending);
      pending.completion = attempt.completion.then(async () => {
        this.#stageCurrent(ownedStage); if (this.#pending.get(service) !== pending) return;
        await this.#adopt(ownedStage); this.#stageCurrent(ownedStage);
        if (this.#pending.get(service) === pending) this.#authorizationResults.set(service, { attemptId: pending.attemptId, status: 'succeeded' });
      }).catch(async error => {
        if (this.#pending.get(service) === pending && ownedStage.active) this.#authorizationResults.set(service, { attemptId: pending.attemptId, status: 'failed', code: this.#error(service, error).code });
        await this.#recordProbeFailure(ownedStage, error, true);
      }).finally(() => {
        if (this.#pending.get(service) === pending) this.#pending.delete(service);
        this.#clearStage(ownedStage); this.#finishChange(service, token);
      });
      return await this.snapshot(service);
    } catch (error) {
      if (stage) { stage.controller.abort(); this.#clearStage(stage); }
      this.#finishChange(service, token); throw this.#error(service, error);
    }
  }
  async cancelAuthorization(service: ServiceId, attemptId: unknown): Promise<Snapshot> {
    const pending = this.#pending.get(service);
    if (typeof attemptId !== 'string' || !pending || pending.attemptId !== attemptId || pending.stage.committing) throw new ServiceConnectionError('service_authorization_changed', 409);
    pending.stage.active = false; pending.stage.controller.abort(); this.#epochs.set(service, (this.#epochs.get(service) ?? 0) + 1);
    this.#authorizationResults.set(service, { attemptId: pending.attemptId, status: 'cancelled' });
    this.#pending.delete(service); this.#oauth?.cancel(pending.attemptId); await pending.completion;
    return this.snapshot(service);
  }
  async disconnect(service: ServiceId, expectedRevision: unknown): Promise<Snapshot> {
    const expected = revision(expectedRevision), token = this.#beginChange(service);
    try { const connection = await this.#connection(service, expected); await this.#retire(service, token); this.#changeCurrent(service, token); await this.store.disconnect(service, connection.revision); return await this.snapshot(service); }
    finally { this.#finishChange(service, token); }
  }
  async binding(service: ServiceId, input: { expectedConnectionRevision: unknown; scopes?: unknown; repositories?: unknown }): Promise<TaskServiceBinding> {
    this.#eligible(service); const epoch = this.#epochs.get(service) ?? 0;
    await this.#connection(service, revision(input.expectedConnectionRevision)); this.#eligible(service);
    const binding = await this.store.createBinding(service, { ...(input.scopes === undefined ? {} : { scopes: parseServiceScopes(service, input.scopes) }), ...(input.repositories === undefined ? {} : { repositories: parseServiceRepositories(input.repositories) }) });
    this.#eligible(service); if (epoch !== (this.#epochs.get(service) ?? 0)) throw new ServiceConnectionError('service_connection_changed', 409); return binding;
  }
  port(projectId: string, taskId: string, bindings: TaskServiceBindings): ServiceConnectionsPort {
    const snapshot = validateTaskServiceBindings(structuredClone(bindings));
    return { call: (input, context) => this.#call(projectId, taskId, snapshot, input, context) };
  }
  /**
   * Host-only external publication dispatch (Issue #155 S2). The journal
   * identity derives from the work/revision/action, never from a foreground
   * tool call; the caller supplies a Host-built context (assertCurrent /
   * registerCleanup / signal) and no sessionId/toolCallId exists here. One
   * identity invokes at most once; a lost response stays UNKNOWN and is never
   * blindly re-invoked — settlement happens through explicit read-only
   * reconciliation in the external publisher.
   */
  async dispatchHostOperation(binding: TaskServiceBinding, request: HostDispatchRequest): Promise<HostDispatchResult> {
    const refused = (code: string, extra: Omit<HostDispatchResult, 'outcome' | 'code'> = {}): HostDispatchResult => ({ ...extra, outcome: 'rejected', code });
    if (!binding || binding.service !== 'github') return refused('invalid_service');
    const action = request.action;
    if (action !== 'issue-create' && action !== 'issue-comment') return refused('invalid_service_operation');
    if (!Number.isSafeInteger(request.revision) || request.revision < 1) return refused('invalid_service_operation');
    if (typeof request.body !== 'string' || !request.body.length || request.body.length > 200000 || request.body.includes('\u0000')) return refused('invalid_service_operation');
    if (typeof request.bodyHash !== 'string' || !/^[a-f0-9]{64}$/.test(request.bodyHash)) return refused('invalid_service_operation');
    if (request.bodyHash !== createHash('sha256').update(request.body).digest('hex')) return refused('service_body_hash_mismatch');
    let projectId: string, taskId: string, workId: string, repositoryId: string;
    try {
      projectId = serviceText(request.projectId, 100); taskId = serviceText(request.taskId, 100);
      workId = serviceText(request.workId, 100); repositoryId = serviceText(request.repositoryId, 300).toLowerCase();
    } catch { return refused('invalid_service_operation'); }
    const owner = repositoryId.split('/')[0]!, repo = repositoryId.split('/')[1] ?? '';
    const allowed = new Set(binding.repositories?.map(item => item.toLowerCase()) ?? []);
    if (!/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9_.-]+$/.test(repositoryId) || !allowed.size || !allowed.has(repositoryId)) return refused('service_repository_outside_scope');
    const operationId = hostPublicationOperationId(workId, request.revision, action);
    const toolName = action === 'issue-create' ? 'issue_write' : 'add_issue_comment';
    const tool = binding.tools.find(item => item.name === toolName);
    if (!tool || !binding.scopes.includes(tool.scope) || !tool.write) return refused('service_permission_missing', { operationId });
    let title: string | undefined, issueNumber: number | undefined;
    if (action === 'issue-create') {
      try { title = serviceText(request.title, 400); } catch { return refused('invalid_service_operation', { operationId }); }
    } else {
      if (!Number.isSafeInteger(request.issueNumber) || Number(request.issueNumber) < 1) return refused('invalid_service_operation', { operationId });
      issueNumber = Number(request.issueNumber);
    }
    let args: Record<string, JsonValue>;
    if (action === 'issue-create') args = { owner, repo, title: title as string, body: request.body };
    else args = { owner, repo, issueNumber: issueNumber as number, body: request.body };
    try { validateServiceConnectionToolArguments(tool, args); } catch { return refused('service_connection_invalid_arguments', { operationId }); }

    const epoch = this.#epochs.get('github') ?? 0;
    const current = () => {
      request.hostContext?.signal?.throwIfAborted();
      request.hostContext?.assertCurrent?.();
      this.#eligible('github');
      if (epoch !== (this.#epochs.get('github') ?? 0)) throw new ServiceConnectionError('service_binding_changed', 409);
    };
    try { current(); } catch { return refused('service_dispatch_context_invalid', { operationId }); }

    let credentials: ServiceConnectionCredentials;
    try { credentials = this.#remember('github', (await this.store.privateConnectionSnapshot('github')).credentials); }
    catch (error) {
      if (error instanceof ServiceConnectionError) return refused(error.code, { operationId });
      throw error;
    }
    // Exact outbound content is screened against every known credential value.
    const secrets = [...this.#secrets.get('github') ?? []];
    if (secrets.some(secret => secret && request.body.includes(secret)) || secrets.some(secret => secret && title !== undefined && title.includes(secret))) {
      return refused('service_outbound_secret_rejected', { operationId });
    }

    const requestId = `host:${workId}:${request.revision}:${action}`;
    const toolCallId = `host:${operationId.slice(0, 32)}`;
    let connection: ServiceConnection, target: Record<string, JsonValue>;
    try {
      const check = await this.store.validateBinding(binding);
      if (!check.available) return refused('service_binding_changed', { operationId });
      connection = { ...check.connection, scopes: [...binding.scopes], tools: structuredClone([...binding.tools]), ...(binding.repositories ? { repositories: [...binding.repositories] } : {}) };
      target = operationTarget(binding, connection, args);
      const operation = await withStoreRetry(() => this.store.prepareOperation({ operationId, projectId, taskId, requestId, toolCallId, binding, toolName, target, arguments: args, requiresConfirmation: false }));
      // A journal attempt that already left `prepared` was submitted before: never invoke again.
      if (operation.status !== 'prepared') {
        const outcome: 'succeeded' | 'rejected' | 'unknown' = operation.status === 'succeeded' ? 'succeeded' : operation.status === 'rejected' ? 'rejected' : 'unknown';
        return { outcome, operationId, operationStatus: operation.status, repositoryId, ...(outcome !== 'succeeded' && outcome !== 'rejected' ? { code: 'service_dispatch_already_recorded' } : {}) };
      }
      await withStoreRetry(() => this.store.transitionOperation(operationId, 'submitted', { expectedStatus: 'prepared' }));
    } catch (error) {
      if (error instanceof ServiceConnectionError) {
        const existing = await this.store.getOperation(operationId).catch(() => undefined);
        if (existing && existing.status !== 'prepared') return { outcome: 'unknown' as const, operationId, operationStatus: existing.status, repositoryId, code: 'service_dispatch_in_flight' };
        return refused(error.code, { operationId });
      }
      throw error;
    }

    const resources = verificationResource();
    request.hostContext?.registerCleanup?.(resources.cleanup);
    try {
      const value = await this.#backend!.invoke({ connection, credentials, toolName, arguments: args, signal: request.hostContext?.signal, registerCleanup: resources.registerCleanup, isCurrent: () => { try { current(); return true; } catch { return false; } } });
      this.#remember('github', credentials);
      this.#remember('github', await this.store.getCredentials('github'));
      const status = outcome(value);
      const resultId = status === 'succeeded' ? this.#externalResultId('github', value) : undefined;
      const issue = status === 'succeeded' ? githubIssueNumber(value) : undefined;
      const attempt = await withStoreRetry(() => this.store.transitionOperation(operationId, status, { expectedStatus: 'submitted', ...(resultId ? { resultId } : {}) }));
      return { outcome: status, operationId, operationStatus: attempt.status, repositoryId, ...(issue !== undefined ? { issueNumber: issue } : {}), ...(resultId ? { resultId } : {}) };
    } catch (error) {
      const knownNotSubmitted = error instanceof ServiceRemoteError && error.unknownOutcome === false;
      const stored = await this.store.getOperation(operationId).catch(() => undefined);
      if (stored && (stored.status === 'submitted' || stored.status === 'confirmed')) {
        const attempt = await withStoreRetry(() => this.store.transitionOperation(operationId, knownNotSubmitted ? 'rejected' : 'unknown', { expectedStatus: stored.status })).catch(() => undefined);
        return { outcome: knownNotSubmitted ? 'rejected' : 'unknown', operationId, operationStatus: attempt?.status ?? stored.status, repositoryId, code: knownNotSubmitted ? (error as ServiceConnectionError).code : 'service_request_failed' };
      }
      if (error instanceof ServiceConnectionError) return refused(error.code, { operationId });
      throw error;
    }
  }
  async #call(projectId: string, taskId: string, bindings: TaskServiceBindings, input: Parameters<ServiceConnectionsPort['call']>[0], context: ServiceConnectionCallContext): Promise<ServiceConnectionToolResult> {
    if (!input || !isServiceId(input.service)) throw new ServiceConnectionError('invalid_service');
    this.#eligible(input.service);
    const service = input.service, binding = bindings[service];
    if (!binding || context.projectId !== projectId || context.taskId !== taskId) throw new ServiceConnectionError('service_binding_changed', 403);
    let tool = binding.tools.find(item => item.name === input.toolName);
    if (!tool || !binding.scopes.includes(tool.scope)) throw new ServiceConnectionError('service_permission_missing', 403);
    if (service === 'tencent' && ['tencent_mail_reply', 'tencent_mail_forward'].includes(tool.name) && !binding.scopes.includes('read')) throw new ServiceConnectionError('service_mail_source_unavailable', 403);
    let args = parseServiceJson(input.args, 4 * 1024 * 1024); validateServiceConnectionToolArguments(tool, args);
    const epoch = this.#epochs.get(service) ?? 0;
    const current = () => { context.signal.throwIfAborted(); context.assertCurrent(); this.#eligible(service); if (epoch !== (this.#epochs.get(service) ?? 0)) throw new ServiceConnectionError('service_binding_changed', 409); };
    const check = async () => {
      current(); await this.#options.assertOwner(projectId, taskId, structuredClone(bindings)); current(); const valid = await this.store.validateBinding(binding); current();
      if (!valid.available) throw new ServiceConnectionError('service_binding_changed', 409);
      return { ...valid.connection, scopes: [...binding.scopes], tools: structuredClone([...binding.tools]), ...(binding.repositories ? { repositories: [...binding.repositories] } : {}) };
    };
    let connection = await check(), operation: ServiceOperationAttempt | undefined;
    const resources = verificationResource(); context.registerCleanup(resources.cleanup);
    const privateSnapshot = await this.store.privateConnectionSnapshot(service), credentials = this.#remember(service, privateSnapshot.credentials); current();
    let mailPreview: Awaited<ReturnType<typeof prepareMailAction>>['preview'] | undefined;
    if (service === 'gmail' && tool.write && ['send_message', 'reply', 'forward'].includes(tool.name)) {
      const send = binding.tools.find(item => item.name === 'send_message' && item.scope === 'send' && item.write && item.requiresConfirmation);
      if (!send) throw new ServiceConnectionError('service_mail_exact_send_unavailable', 409);
      const prepared = await prepareMailAction({ toolName: tool.name, arguments: args, accountLabel: binding.accountLabel, signal: context.signal, assertCurrent: current,
        readMessage: async messageId => {
          const reader = binding.tools.find(item => item.name === 'get_message' && item.scope === 'read' && !item.write);
          if (!reader || !binding.scopes.includes('read')) throw new ServiceConnectionError('service_mail_source_unavailable', 403);
          const readArgs = { messageId, messageFormat: input.toolName === 'reply' ? 'MINIMAL' : 'RAW' }; validateServiceConnectionToolArguments(reader, readArgs); connection = await check();
          const value = await this.#backend!.invoke({ connection, credentials, toolName: reader.name, arguments: readArgs, signal: context.signal, registerCleanup: resources.registerCleanup, isCurrent: () => { try { current(); return true; } catch { return false; } }, elicit: async form => { current(); await check(); const response = await answerServiceForm(form, context); await check(); return response; } });
          await resources.cleanup({ retryFailed: false }); current(); return value;
        },
      });
      current(); args = parseServiceJson(prepared.arguments, 4 * 1024 * 1024); validateServiceConnectionToolArguments(send, args); tool = send; mailPreview = prepared.preview;
    }
    if (tool.write) {
      const operationId = createHash('sha256').update(JSON.stringify([projectId, taskId, context.requestId, context.toolCallId])).digest('hex');
      const target = operationTarget(binding, connection, args);
      if (input.toolName !== tool.name) target.originalToolName = input.toolName;
      if (mailPreview?.source) { const { subject, ...source } = mailPreview.source; target.source = parseServiceJson(source); target.sourceSubjectSha256 = createHash('sha256').update(subject).digest('hex'); }
      const shown = `账号：${binding.accountLabel}\n${target.from ? `发件人：${target.from}\n` : ''}${binding.tenantId ? `租户：${binding.tenantId}\n应用：${binding.appId}\n` : ''}操作：${tool.semanticName}\n${JSON.stringify(mailPreview ?? preview(args), null, 2)}\n确认仅适用于本次准确内容。`;
      if (tool.requiresConfirmation && Buffer.byteLength(shown) > 120 * 1024) throw new ServiceConnectionError('service_preview_too_large', 413);
      operation = await this.store.prepareOperation({ operationId, projectId, taskId, requestId: context.requestId, toolCallId: context.toolCallId, binding, toolName: tool.name, target, arguments: args, requiresConfirmation: tool.requiresConfirmation });
      if (operation.status !== 'prepared') return this.#result(service, { status: operation.status, operationId: operation.operationId, message: '原操作已有记录，本次未重复提交。' }, operation);
      if (tool.requiresConfirmation && !await context.confirm(`确认${labels[service]}操作`, shown)) { operation = await this.store.transitionOperation(operationId, 'rejected', { expectedStatus: 'prepared' }); return this.#result(service, { status: 'cancelled', operationId }, operation); }
      connection = await check(); operation = await this.store.transitionOperation(operationId, 'confirmed', { expectedStatus: 'prepared' });
      connection = await check(); operation = await this.store.transitionOperation(operationId, 'submitted', { expectedStatus: 'confirmed' });
    }
    try {
      connection = await check();
      const value = service === 'tencent'
        ? await (this.#options.mail?.call ?? callTencent)(tool.name, args, mailConfig(connection), credentials.authorizationCode ?? '', { signal: context.signal, registerCleanup: resources.registerCleanup, isCurrent: () => { try { current(); return true; } catch { return false; } }, ...(operation ? { operationId: operation.operationId } : {}) })
        : await this.#backend!.invoke({ connection, credentials, toolName: tool.name, arguments: args, signal: context.signal, registerCleanup: resources.registerCleanup, isCurrent: () => { try { current(); return true; } catch { return false; } }, elicit: async form => {
          current(); await check(); const response = await answerServiceForm(form, context, operation?.requiresConfirmation && operation.status === 'submitted' ? { toolName: tool!.name, args } : undefined); await check(); return response;
        } });
      this.#remember(service, credentials); this.#remember(service, await this.store.getCredentials(service));
      const status = outcome(value), resultId = status === 'succeeded' ? this.#externalResultId(service, value) : undefined;
      if (operation) operation = await this.store.transitionOperation(operation.operationId, status, { expectedStatus: 'submitted', ...(resultId ? { resultId } : {}) });
      current(); return this.#result(service, value, operation);
    } catch (error) {
      const knownNotSubmitted = error instanceof ServiceRemoteError && error.unknownOutcome === false;
      if (operation?.status === 'submitted') operation = await this.store.transitionOperation(operation.operationId, knownNotSubmitted ? 'rejected' : 'unknown', { expectedStatus: 'submitted' });
      if (error instanceof ServiceConnectionError && error.status === 401 && !context.signal.aborted && !this.#closed && epoch === (this.#epochs.get(service) ?? 0) && !this.#changes.has(service)) await this.store.setStatus(service, 'expired', binding.revision, undefined, privateSnapshot.fingerprint).catch(() => {});
      if (context.signal.aborted || this.#closed || epoch !== (this.#epochs.get(service) ?? 0)) throw this.#error(service, error);
      if (operation) return this.#result(service, { status: operation.status, operationId: operation.operationId, message: knownNotSubmitted ? '该操作在提交前被拒绝，请修正连接或权限后明确发起新操作。' : '原操作结果尚未确认，请核对原服务记录；不会自动重复提交。' }, operation);
      throw this.#error(service, error);
    }
  }
  async close(): Promise<void> {
    this.#closed = true;
    for (const service of SERVICE_IDS) this.#epochs.set(service, (this.#epochs.get(service) ?? 0) + 1);
    for (const stage of this.#staging.values()) { stage.active = false; stage.controller.abort(); }
    for (const resource of this.#verification.values()) resource.controller.abort();
    const pending = [...this.#pending.values()]; this.#pending.clear();
    for (const item of pending) this.#oauth?.cancel(item.attemptId);
    const connections = await this.store.list();
    const cleanups = [...this.#verification.entries()];
    const settled = await Promise.allSettled([
      this.#oauth?.close(), ...pending.map(item => item.completion),
      ...cleanups.map(async ([service, resource]) => { await resource.cleanup({ retryFailed: true }); if (this.#verification.get(service) === resource) this.#verification.delete(service); }),
      ...connections.map(connection => this.#backend?.close(connection.connectionId)),
    ]);
    if (settled.some(item => item.status === 'rejected')) throw new ServiceConnectionError('service_cleanup_unknown', 409);
    this.#staging.clear(); this.#changes.clear(); this.#secrets.clear();
  }
}
