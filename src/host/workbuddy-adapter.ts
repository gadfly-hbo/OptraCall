import { createHash } from 'node:crypto';
import { ExternalWorkError, externalAssetRefText, externalRevision, externalText } from './external-work-types.ts';
import type { ExternalWork, WorkGrant } from './external-work-types.ts';
import { WORKBUDDY_TRIGGER_QUOTA } from './external-work-store.ts';
import type { ExternalWorkStore, ExecutorAttempt, WorkBuddyConfigRecord, WorkBuddyTestStatus } from './external-work-store.ts';

/**
 * Optional WorkBuddy local-assistant adapter (Issue #155 S5/E05).
 *
 * The official local-assistant API is reached only through the injected transport; this
 * adapter never holds OAuth/MCP credentials and never sends them to the model. The config
 * state machine starts at `integration_unverified` and disabled; only a joint closed loop
 * (API trigger → same-MCP claim/read → deliver → original-task review) through the injected
 * seams marks the specific configuration ready for the user to select. Engineering proof
 * uses an isolated synthetic vendor simulation; the real-account joint test is E08.
 *
 * `message_id` is only the account message-history cursor / trigger receipt — never a task,
 * session or claim identity. Attribution of any reply requires an exact correlation marker
 * checked against existing work/revision/trigger attempts (plus authenticated claim/delivery
 * identities); uncorrelated message bodies never enter the ledger, a task or a model.
 * One connection carries at most one OptraCall work in a triggered/claimed execution phase;
 * each external grant may use at most three API triggers (revisions included), where
 * submitted/UNKNOWN occupy and no turn or revision resets the count.
 */
export const WORKBUDDY_CORRELATION_PREFIX = 'wb-correlation:';
export const WORKBUDDY_TRIGGER_LIMIT = WORKBUDDY_TRIGGER_QUOTA;
const CLAIM_EVIDENCE_PREFIX = 'claim:';
const DELIVERY_EVIDENCE_PREFIX = 'delivery:';
const MAX_MESSAGE_CHARS = 200_000;

export type WorkBuddyApiOutcome = 'succeeded' | 'rejected' | 'unknown';
/** Thin seam over the official API contract (integration-research §2); credentials stay inside the Host transport. */
export type WorkBuddyTransport = {
  getLocalAssistant(): Promise<{ outcome: WorkBuddyApiOutcome; online?: boolean }>;
  postMessage(input: { content: string; msgType: 'text' }): Promise<{ outcome: WorkBuddyApiOutcome; messageId?: string }>;
  getMessages(input: { afterMessageId?: string }): Promise<{ outcome: WorkBuddyApiOutcome; messages?: Array<{ messageId: string; text: string }> }>;
};
export type WorkBuddyJointTestHarness = {
  trigger(): Promise<{ outcome: WorkBuddyApiOutcome; messageId?: string }>;
  claim(): Promise<{ ok: boolean; claimId?: string }>;
  readAsset(): Promise<{ ok: boolean }>;
  deliver(): Promise<{ ok: boolean; deliveryId?: string }>;
  review(): Promise<{ ok: boolean }>;
};
export type WorkBuddyTriggerResult = { attempt: ExecutorAttempt; dispatched: boolean };
export type WorkBuddyReplyAssociation = { messageId: string; workId: string; revision: number; kind: 'work' | 'claim-evidence' | 'delivery-evidence' };
export type WorkBuddyReplyScan = { associated: WorkBuddyReplyAssociation[]; unassociated: Array<{ messageId: string }>; cursor: string };

export const workBuddyCorrelationMarker = (workId: string, revision: number): string =>
  `${WORKBUDDY_CORRELATION_PREFIX}${externalText(workId, 100)}@${externalRevision(revision)}`;

/** Stable per-connection configuration identity (uuid-shaped, derived, never a message/claim id). */
export const workBuddyConfigId = (connection: string): string => {
  const hash = createHash('sha256').update(JSON.stringify(['optracall-workbuddy-config-v1', externalText(connection, 200)])).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${((parseInt(hash[16]!, 16) & 3) | 8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

const CREDENTIAL_PATTERNS: RegExp[] = [
  /ghp_[A-Za-z0-9]{16,}/, /gho_[A-Za-z0-9]{16,}/, /github_pat_[A-Za-z0-9_]{16,}/,
  /AKIA[0-9A-Z]{16}/, /ASIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
];

/** The trigger message carries work instructions and locating info only — never token material. */
function assertNoCredentialMaterial(message: string, knownValues: string[]): void {
  if (!message.length || message.length > MAX_MESSAGE_CHARS || message.includes('\u0000')) throw new ExternalWorkError('external_workbuddy_invalid', 400);
  if (CREDENTIAL_PATTERNS.some(pattern => pattern.test(message))) throw new ExternalWorkError('external_workbuddy_secret_rejected', 400);
  if (knownValues.some(secret => typeof secret === 'string' && secret.length >= 8 && message.includes(secret))) throw new ExternalWorkError('external_workbuddy_secret_rejected', 400);
}

function composeTriggerMessage(input: { work: ExternalWork; grant: WorkGrant; issueId?: string; mcpEndpoint: string }): string {
  const locate = `GitHub ${input.grant.repository.stableId}${input.issueId === undefined ? '' : `#${input.issueId}`}`;
  const refs = (items: WorkGrant['assetRefs']) => items.map(externalAssetRefText).join(', ');
  return [
    '[OptraCall 外派工作]',
    workBuddyCorrelationMarker(input.work.workId, input.work.revision),
    `定位: ${locate}`,
    `工单: ${input.work.summary}`,
    `目标: ${input.grant.goal}`,
    `范围: ${input.grant.scope}`,
    `禁做: ${input.grant.forbidden === '' ? '（无）' : input.grant.forbidden}`,
    `交付标准: ${input.work.deliveryCriteria}`,
    `输入定位: ${refs(input.work.inputs) || '（无）'}`,
    `资产范围: ${refs(input.grant.assetRefs) || '（无）'}`,
    `工作入口(MCP): ${input.mcpEndpoint}`,
    '执行要求: 以认证身份经受保护工作 MCP 领取上述 work/revision 后执行，成果经 work.deliver 回交；本消息只是工作指令与定位信息，不含任何凭据。',
  ].join('\n');
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CORRELATION_PATTERN = new RegExp(`${escapeRegExp(WORKBUDDY_CORRELATION_PREFIX)}(\\S+)@(\\d+)`);

export class WorkBuddyAdapter {
  readonly #store: ExternalWorkStore;
  readonly #transport: WorkBuddyTransport;
  readonly connection: string;
  readonly configId: string;
  readonly #mcpEndpoint: string;
  readonly #credentialValues?: () => string[];
  constructor(options: { store: ExternalWorkStore; transport: WorkBuddyTransport; connection: string; mcpEndpoint: string; configId?: string; credentialValues?: () => string[] }) {
    this.#store = options.store;
    this.#transport = options.transport;
    this.connection = externalText(options.connection, 200);
    this.configId = options.configId === undefined ? workBuddyConfigId(this.connection) : externalText(options.configId, 100);
    this.#mcpEndpoint = externalText(options.mcpEndpoint, 2000);
    this.#credentialValues = options.credentialValues;
  }

  /** Idempotently register this connection's configuration (integration_unverified, disabled). */
  async ensureConfig(): Promise<WorkBuddyConfigRecord> {
    return this.#store.recordWorkBuddyConfig({ configId: this.configId, connection: this.connection });
  }

  async settingsView(): Promise<{ optional: true; defaultState: 'integration_unverified'; connection: string; ready: boolean; verification: { apiOnline: WorkBuddyTestStatus; connector: WorkBuddyTestStatus; joint: WorkBuddyTestStatus }; quota: { limit: number } }> {
    const config = await this.#store.getWorkBuddyConfig(this.configId);
    return {
      optional: true,
      defaultState: 'integration_unverified',
      connection: this.connection,
      ready: config?.ready === true,
      verification: {
        apiOnline: config?.apiOnline ?? 'unverified',
        connector: config?.connector ?? 'unverified',
        joint: config?.joint ?? 'unverified',
      },
      quota: { limit: WORKBUDDY_TRIGGER_QUOTA },
    };
  }

  async recordSingleTest(kind: 'api-online' | 'connector', outcome: 'passed' | 'failed'): Promise<WorkBuddyConfigRecord> {
    await this.ensureConfig();
    return this.#store.recordWorkBuddySingleTest({ configId: this.configId, kind, outcome });
  }

  /**
   * Drive the joint closed loop through the injected harness; every stage must independently
   * confirm its fact before the configuration may be marked ready. Any failure records the
   * failed joint fact and the configuration stays disabled.
   */
  async runJointTest(harness: WorkBuddyJointTestHarness): Promise<{ passed: boolean; stages: Record<string, string> }> {
    await this.ensureConfig();
    const stages: Record<string, string> = {};
    let passed = true;
    try {
      const triggered = await harness.trigger();
      stages.trigger = `${triggered.outcome}${triggered.messageId === undefined ? '' : `:${triggered.messageId}`}`;
      if (triggered.outcome !== 'succeeded' || triggered.messageId === undefined) passed = false;
      if (passed) {
        const claimed = await harness.claim();
        stages.claim = `${claimed.ok ? 'ok' : 'failed'}${claimed.claimId === undefined ? '' : `:${claimed.claimId}`}`;
        if (!claimed.ok || claimed.claimId === undefined) passed = false;
      }
      if (passed) {
        const read = await harness.readAsset();
        stages['readAsset'] = read.ok ? 'ok' : 'failed';
        if (!read.ok) passed = false;
      }
      if (passed) {
        const delivered = await harness.deliver();
        stages.deliver = `${delivered.ok ? 'ok' : 'failed'}${delivered.deliveryId === undefined ? '' : `:${delivered.deliveryId}`}`;
        if (!delivered.ok || delivered.deliveryId === undefined) passed = false;
      }
      if (passed) {
        const reviewed = await harness.review();
        stages.review = reviewed.ok ? 'ok' : 'failed';
        if (!reviewed.ok) passed = false;
      }
    } catch (error) {
      passed = false;
      stages.error = error instanceof Error ? error.name : 'unknown';
    }
    await this.#store.markWorkBuddyJointTest({ configId: this.configId, outcome: passed ? 'passed' : 'failed', evidence: 'synthetic-vendor-simulation' });
    return { passed, stages };
  }

  /**
   * Trigger one work revision through the official API. Gates run in order: ready config →
   * existing work/grant → GitHub anchor (the locating info) → composed-message credential
   * screen → atomic store reservation (idempotency/quota/serial). A lost receipt stays
   * UNKNOWN and is never re-sent; an offline assistant is a definitive rejection that does
   * not consume quota.
   */
  async trigger(input: { workId: string; revision: number }): Promise<WorkBuddyTriggerResult> {
    const workId = externalText(input.workId, 100);
    const revision = externalRevision(input.revision);
    const config = await this.#store.getWorkBuddyConfig(this.configId);
    if (!config || config.connection !== this.connection || config.ready !== true) throw new ExternalWorkError('external_workbuddy_not_ready', 403);
    const work = await this.#store.getWork(workId);
    if (!work) throw new ExternalWorkError('external_work_not_found', 404);
    const grant = await this.#store.getGrant(work.grantId);
    if (!grant || grant.grantVersion !== work.grantVersion) throw new ExternalWorkError('external_work_not_found', 404);
    const anchor = (await this.#store.listPublications(workId)).find(item => item.action === 'issue-create' && item.status === 'succeeded');
    if (!anchor || anchor.issueId === undefined) throw new ExternalWorkError('external_workbuddy_anchor_missing', 409);
    const message = composeTriggerMessage({ work: { ...work, revision }, grant, issueId: anchor.issueId, mcpEndpoint: this.#mcpEndpoint });
    assertNoCredentialMaterial(message, this.#credentialValues?.() ?? []);
    const bodyHash = createHash('sha256').update(message).digest('hex');

    const reserved = await this.#store.recordExecutorAttempt({ grantId: grant.grantId, grantVersion: grant.grantVersion, workId, revision, connection: this.connection, bodyHash });
    if (reserved.status !== 'prepared') return { attempt: reserved, dispatched: false };
    await this.#store.transitionExecutorAttempt(reserved.attemptId, 'submitted', { expectedStatus: 'prepared' });

    // Online fact first: a definitively offline assistant is a refusal, never a silent retry.
    try {
      const status = await this.#transport.getLocalAssistant();
      if (status.outcome === 'succeeded' && status.online === false) {
        return { attempt: await this.#store.transitionExecutorAttempt(reserved.attemptId, 'rejected', { expectedStatus: 'submitted', reason: 'assistant_offline' }), dispatched: false };
      }
    } catch { /* The online fact is unknown; the message POST decides the outcome. */ }
    try {
      const result = await this.#transport.postMessage({ content: message, msgType: 'text' });
      if (result.outcome === 'succeeded' && typeof result.messageId === 'string' && result.messageId.length) {
        return { attempt: await this.#store.transitionExecutorAttempt(reserved.attemptId, 'succeeded', { expectedStatus: 'submitted', messageId: result.messageId }), dispatched: true };
      }
      if (result.outcome === 'rejected') return { attempt: await this.#store.transitionExecutorAttempt(reserved.attemptId, 'rejected', { expectedStatus: 'submitted' }), dispatched: true };
      return { attempt: await this.#store.transitionExecutorAttempt(reserved.attemptId, 'unknown', { expectedStatus: 'submitted' }), dispatched: true };
    } catch {
      return { attempt: await this.#store.transitionExecutorAttempt(reserved.attemptId, 'unknown', { expectedStatus: 'submitted' }), dispatched: true };
    }
  }

  /**
   * Incremental reply read over the account message history. Attribution needs the exact
   * correlation marker checked against an existing work/revision with a recorded trigger on
   * this connection; claim/delivery evidence is accepted only when the referenced identity
   * exactly exists bound to that work/revision. Uncorrelated bodies are dropped here — only
   * message ids leave this method, and no message text is ever persisted.
   */
  async readReplies(): Promise<WorkBuddyReplyScan> {
    const config = await this.#store.getWorkBuddyConfig(this.configId);
    if (!config || config.connection !== this.connection) throw new ExternalWorkError('external_workbuddy_config_missing', 404);
    let batch;
    try {
      batch = await this.#transport.getMessages(config.replyCursor === undefined ? {} : { afterMessageId: config.replyCursor });
    } catch {
      throw new ExternalWorkError('external_workbuddy_read_unknown', 503);
    }
    if (batch.outcome !== 'succeeded' || !Array.isArray(batch.messages)) throw new ExternalWorkError('external_workbuddy_read_unknown', 503);
    const associated: WorkBuddyReplyAssociation[] = [];
    const unassociated: Array<{ messageId: string }> = [];
    for (const message of batch.messages) {
      const attribution = await this.#attribute(message.text);
      if (attribution) associated.push({ messageId: message.messageId, ...attribution });
      else unassociated.push({ messageId: message.messageId });
    }
    let cursor = config.replyCursor ?? '';
    if (batch.messages.length) {
      cursor = batch.messages[batch.messages.length - 1]!.messageId;
      await this.#store.setWorkBuddyReplyCursor(this.configId, cursor);
    }
    return { associated, unassociated, cursor };
  }

  async #attribute(text: string): Promise<{ workId: string; revision: number; kind: WorkBuddyReplyAssociation['kind'] } | null> {
    const match = CORRELATION_PATTERN.exec(text);
    if (!match) return null;
    const workId = match[1]!;
    const revision = Number(match[2]!);
    if (!Number.isSafeInteger(revision) || revision < 1) return null;
    const work = await this.#store.getWork(workId);
    if (!work || work.revision < revision) return null;
    const attempts = await this.#store.listExecutorAttempts(workId);
    if (!attempts.some(item => item.revision === revision && item.connection === this.connection && item.status !== 'rejected')) return null;
    let kind: WorkBuddyReplyAssociation['kind'] = 'work';
    const claimMatch = new RegExp(`${escapeRegExp(CLAIM_EVIDENCE_PREFIX)}([^\\s]+)`).exec(text);
    if (claimMatch) {
      const claims = await this.#store.listClaims(workId);
      if (claims.some(item => item.claimId === claimMatch[1] && item.revision === revision)) kind = 'claim-evidence';
    }
    const deliveryMatch = new RegExp(`${escapeRegExp(DELIVERY_EVIDENCE_PREFIX)}([^\\s]+)`).exec(text);
    if (deliveryMatch) {
      const deliveries = await this.#store.listDeliveries(workId);
      if (deliveries.some(item => item.deliveryId === deliveryMatch[1] && item.revision === revision)) kind = 'delivery-evidence';
    }
    return { workId, revision, kind };
  }

  /** Occupied trigger quota of one external grant: every non-rejected attempt counts. */
  async quotaUsed(grantId: string): Promise<number> {
    const target = externalText(grantId, 100);
    return (await this.#store.listExecutorAttempts()).filter(item => item.grantId === target && item.status !== 'rejected').length;
  }
}
