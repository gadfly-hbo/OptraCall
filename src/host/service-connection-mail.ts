import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { TENCENT_MAIL_SERVERS, type ServiceTool } from './service-connection-types.ts';

export interface TencentMailConfig {
  mailboxType: 'qq' | 'exmail';
  login: string;
  connectionId: string;
}

export interface TencentMailContext {
  signal: AbortSignal;
  isCurrent(): boolean;
  operationId?: string;
  registerCleanup?(cleanup: (options: { retryFailed?: boolean }) => Promise<void>): void;
}

export interface TencentMessageRef extends TencentMailConfig {
  folder: string;
  uidValidity: string;
  uid: number;
}

export interface MailImapClient {
  mailbox: false | { uidValidity: bigint; uidNext: number; exists: number };
  connect(): Promise<void>;
  mailboxOpen(folder: string, options: { readOnly: true }): Promise<unknown>;
  list(options: Record<string, unknown>): Promise<Array<{ path: string; name: string; delimiter: string; flags: Set<string> }>>;
  search(query: Record<string, unknown>, options: { uid: true; strict: true }): Promise<number[] | false>;
  fetchOne(uid: number, query: Record<string, unknown>, options: { uid: true }): Promise<false | Record<string, unknown>>;
  download(uid: number, part: string, options: Record<string, unknown>): Promise<{ meta: Record<string, unknown>; content: Readable }>;
  close(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface MailSmtpClient {
  connect(callback: (error?: unknown) => void): void;
  login(auth: { user: string; pass: string }, callback: (error?: unknown) => void): void;
  send(envelope: { from: string; to: string[] }, message: Readable, callback: (error: unknown, info?: Record<string, unknown>) => void): void;
  close(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface TencentMailDependencies {
  imap(options: Record<string, unknown>): MailImapClient;
  smtp(options: Record<string, unknown>): MailSmtpClient;
  parse(source: Buffer): Promise<Record<string, unknown>>;
  compose(options: Record<string, unknown>): Promise<Buffer>;
}

const MAX_RAW = 5 * 1024 * 1024;
const MAX_ATTACHMENT = 2 * 1024 * 1024;
const MAX_TEXT = 64 * 1024;
const MAX_SEND_TEXT = 256 * 1024;
const MAX_UID_WINDOW = 500;
const TIMEOUT = 30_000;

const stringSchema = { type: 'string', minLength: 1 };
const refSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    mailboxType: { enum: ['qq', 'exmail'] }, login: stringSchema, connectionId: stringSchema,
    folder: stringSchema, uidValidity: { type: 'string', pattern: '^[1-9][0-9]*$' }, uid: { type: 'integer', minimum: 1 },
  },
  required: ['mailboxType', 'login', 'connectionId', 'folder', 'uidValidity', 'uid'],
};
const addressSchema = { type: 'array', maxItems: 50, items: { type: 'string', format: 'email' } };
const sendProperties = {
  to: { ...addressSchema, minItems: 1 }, cc: addressSchema, bcc: addressSchema,
  subject: { type: 'string', maxLength: 998 }, text: { type: 'string', maxLength: MAX_SEND_TEXT },
  attachments: { type: 'array', maxItems: 10, items: {
    type: 'object', additionalProperties: false,
    properties: { filename: stringSchema, contentType: stringSchema, contentBase64: { type: 'string', maxLength: Math.ceil(MAX_ATTACHMENT / 3) * 4 } },
    required: ['filename', 'contentBase64'],
  } },
};

/** Exact product allowlist: adding server tools cannot widen this collection. */
export const mailTools: ServiceTool[] = [
  { name: 'tencent_mail_list_folders', semanticName: 'list_folders', scope: 'read', action: 'read', write: false, requiresConfirmation: false,
    inputSchema: { type: 'object', additionalProperties: false, properties: { parent: { type: 'string' }, offset: { type: 'integer', minimum: 0, maximum: 10000 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  { name: 'tencent_mail_search', semanticName: 'search_messages', scope: 'read', action: 'read', write: false, requiresConfirmation: false,
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      folder: stringSchema, beforeUid: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 50 },
      text: { type: 'string', maxLength: 1000 }, from: { type: 'string', maxLength: 320 }, to: { type: 'string', maxLength: 320 }, subject: { type: 'string', maxLength: 1000 },
      since: { type: 'string', format: 'date' }, before: { type: 'string', format: 'date' }, seen: { type: 'boolean' },
    }, required: ['folder'] } },
  { name: 'tencent_mail_read', semanticName: 'read_message', scope: 'read', action: 'read', write: false, requiresConfirmation: false,
    inputSchema: { type: 'object', additionalProperties: false, properties: { source: refSchema, offset: { type: 'integer', minimum: 0 }, maxChars: { type: 'integer', minimum: 1, maximum: MAX_TEXT } }, required: ['source'] } },
  { name: 'tencent_mail_attachment', semanticName: 'read_attachment', scope: 'read', action: 'read', write: false, requiresConfirmation: false,
    inputSchema: { type: 'object', additionalProperties: false, properties: { source: refSchema, part: stringSchema, maxBytes: { type: 'integer', minimum: 1, maximum: MAX_ATTACHMENT } }, required: ['source', 'part'] } },
  ...(['send', 'reply', 'forward'] as const).map((operation): ServiceTool => ({
    name: 'tencent_mail_' + operation, semanticName: operation + '_message', scope: 'send', action: 'send', write: true, requiresConfirmation: true,
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...sendProperties, ...(operation === 'send' ? {} : { source: refSchema }) }, required: ['to', 'subject', 'text', ...(operation === 'send' ? [] : ['source'])] },
  })),
];

class MailFailure extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new MailFailure(code); }
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('invalid_arguments');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value) || value.length > max || /\u0000/.test(value)) return fail('invalid_arguments');
  return value;
}
function integer(value: unknown, min: number, max: number, defaultValue?: number): number {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) return fail('invalid_arguments');
  return Number(value);
}
function validConfig(config: TencentMailConfig, secret: string): void {
  if (!config || !['qq', 'exmail'].includes(config.mailboxType) || typeof config.connectionId !== 'string' || !config.connectionId || config.connectionId.length > 200) fail('invalid_configuration');
  if (typeof config.login !== 'string' || !validAddress(config.login) || typeof secret !== 'string' || !secret || secret.length > 4096 || /[\r\n\u0000]/.test(secret)) fail('invalid_configuration');
}
function validAddress(value: string): boolean { return value.length <= 320 && /^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/.test(value); }
function assertCurrent(ctx: TencentMailContext): void {
  if (ctx.signal.aborted) fail('cancelled');
  if (!ctx.isCurrent()) fail('connection_changed');
}
function sourceOf(config: TencentMailConfig) { return { mailboxType: config.mailboxType, login: config.login, connectionId: config.connectionId }; }
function messageRef(value: unknown, config: TencentMailConfig): TencentMessageRef {
  const ref = record(value);
  if (ref.mailboxType !== config.mailboxType || ref.login !== config.login || ref.connectionId !== config.connectionId) fail('account_mismatch');
  const folder = text(ref.folder, 1024);
  if (/[\r\n]/.test(folder) || !/^[1-9][0-9]{0,19}$/.test(String(ref.uidValidity))) fail('invalid_arguments');
  return { ...sourceOf(config), folder, uidValidity: String(ref.uidValidity), uid: integer(ref.uid, 1, 0xffffffff) };
}
function errorCode(error: unknown): string {
  if (error instanceof MailFailure) return error.code;
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  if (value.authenticationFailed || value.code === 'EAUTH' || value.responseCode === 535) return 'authentication_failed';
  return 'connection_error';
}
function failure(error: unknown): Record<string, unknown> {
  const code = errorCode(error);
  return { status: 'failed', code, message: ({
    cancelled: 'The mailbox operation was cancelled.', connection_changed: 'The mailbox binding changed; choose the current account again.',
    stale_message: 'The folder UIDVALIDITY changed; search again before reading this message.',
    authentication_failed: 'Mailbox authentication failed; check the authorization code and IMAP/SMTP availability.',
    connection_error: 'The mailbox service could not complete the operation.',
    send_result_unknown: 'The SMTP result is unknown. Do not automatically resend this operation.',
  } as Record<string, string>)[code] ?? 'The mailbox operation was rejected (' + code + ').' };
}

/** Each protocol client belongs to this call. Parent Host owns cancellation and policy. */
function callScope(ctx: TencentMailContext) {
  const controller = new AbortController();
  const resources: Array<{ close(): void; closed: boolean; failed: boolean }> = [];
  const closeResources = (retryFailed: boolean) => {
    for (const resource of resources) {
      if (resource.closed || resource.failed && !retryFailed) continue;
      try { resource.close(); resource.closed = true; resource.failed = false; } catch { resource.failed = true; }
    }
    return resources.some(resource => resource.failed);
  };
  // The Host retains this exact client set when its public lifecycle reports a
  // failed close. Only an explicit retryFailed close retries failed actions.
  ctx.registerCleanup?.(async options => { if (closeResources(options?.retryFailed === true)) fail('cleanup_failed'); });
  const cancel = () => { controller.abort(); closeResources(false); };
  const timeout = setTimeout(cancel, TIMEOUT);
  timeout.unref();
  ctx.signal.addEventListener('abort', cancel, { once: true });
  if (ctx.signal.aborted) cancel();
  return {
    ctx: { ...ctx, signal: controller.signal },
    add(close: () => void) { resources.push({ close, closed: false, failed: false }); if (controller.signal.aborted) closeResources(false); },
    async wait<T>(operation: () => Promise<T>): Promise<T> {
      assertCurrent({ ...ctx, signal: controller.signal });
      return new Promise<T>((resolve, reject) => {
        const aborted = () => reject(new MailFailure(ctx.signal.aborted ? 'cancelled' : 'operation_timeout'));
        controller.signal.addEventListener('abort', aborted, { once: true });
        Promise.resolve().then(() => { assertCurrent({ ...ctx, signal: controller.signal }); return operation(); }).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', aborted));
      });
    },
    finish() {
      clearTimeout(timeout); ctx.signal.removeEventListener('abort', cancel);
      return closeResources(false);
    },
  };
}
type MailScope = ReturnType<typeof callScope>;
function smtpWait<T>(smtp: MailSmtpClient, scope: MailScope, start: (resolve: (result: T) => void, reject: (error: unknown) => void) => void): Promise<T> {
  return scope.wait(() => new Promise<T>((resolve, reject) => {
    // SMTPConnection reports dropped sockets through events and may discard its
    // pending send callback while closing. The original await must still settle.
    smtp.on('error', reject);
    smtp.on('end', () => reject(new MailFailure('connection_error')));
    start(resolve, reject);
  }));
}

export function createTencentMailAdapter(dependencies: TencentMailDependencies) {
  async function openImap(config: TencentMailConfig, secret: string, scope: MailScope, folder?: string): Promise<MailImapClient> {
    assertCurrent(scope.ctx);
    const preset = TENCENT_MAIL_SERVERS[config.mailboxType];
    const client = dependencies.imap({
      host: preset.imapHost, port: preset.imapPort, secure: true,
      auth: { user: config.login, pass: secret }, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: preset.imapHost },
      logger: false, logRaw: false, disableAutoIdle: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: TIMEOUT,
      maxLiteralSize: MAX_RAW + 1024, maxResponseSize: MAX_RAW + 1024 * 1024, maxLineLength: 65536, maxResponseTokens: 100000,
    });
    client.on('error', () => {});
    scope.add(() => client.close());
    await scope.wait(() => client.connect());
    assertCurrent(scope.ctx);
    if (folder !== undefined) await scope.wait(() => client.mailboxOpen(folder, { readOnly: true }));
    assertCurrent(scope.ctx);
    return client;
  }
  async function openMessage(ref: TencentMessageRef, config: TencentMailConfig, secret: string, scope: MailScope) {
    const client = await openImap(config, secret, scope, ref.folder);
    if (!client.mailbox || String(client.mailbox.uidValidity) !== ref.uidValidity) fail('stale_message');
    return client;
  }
  async function fetchMeta(client: MailImapClient, uid: number, scope: MailScope) {
    const message = await scope.wait(() => client.fetchOne(uid, { uid: true, envelope: true, flags: true, size: true, bodyStructure: true }, { uid: true }));
    assertCurrent(scope.ctx);
    if (!message || message.uid !== uid) return fail('message_not_found');
    return message;
  }
  async function openSmtp(config: TencentMailConfig, secret: string, scope: MailScope) {
    assertCurrent(scope.ctx);
    const preset = TENCENT_MAIL_SERVERS[config.mailboxType];
    const smtp = dependencies.smtp({ host: preset.smtpHost, port: preset.smtpPort, secure: true,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: preset.smtpHost },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: TIMEOUT, socketCloseTimeout: 0, logger: false, debug: false,
    });
    smtp.on('error', () => {});
    scope.add(() => smtp.close());
    await smtpWait<void>(smtp, scope, (resolve, reject) => smtp.connect(error => error ? reject(error) : resolve()));
    assertCurrent(scope.ctx);
    await smtpWait<void>(smtp, scope, (resolve, reject) => smtp.login({ user: config.login, pass: secret }, error => error ? reject(error) : resolve()));
    assertCurrent(scope.ctx);
    return smtp;
  }
  async function verifyTencent(config: TencentMailConfig, secret: string, signal: AbortSignal, lifecycle?: Pick<TencentMailContext, 'registerCleanup'>): Promise<Record<string, unknown>> {
    const scope = callScope({ signal, isCurrent: () => true, registerCleanup: lifecycle?.registerCleanup });
    let outcome: Record<string, unknown> = { status: 'failed', code: 'connection_error' };
    try {
      validConfig(config, secret);
      const issues: Record<string, string> = {};
      let read = false; let send = false;
      try { await openImap(config, secret, scope, 'INBOX'); read = true; } catch (error) { issues.read = errorCode(error); }
      assertCurrent(scope.ctx);
      try { await openSmtp(config, secret, scope); send = true; } catch (error) { issues.send = errorCode(error); }
      assertCurrent(scope.ctx);
      if (!read) return outcome = { ...failure(new MailFailure(issues.read)), capabilities: { read, send, remoteDrafts: false }, issues };
      return outcome = { status: 'verified', accountId: createHash('sha256').update(JSON.stringify(['tencent', config.mailboxType, config.login, config.connectionId])).digest('hex'),
        accountLabel: config.login, mailboxType: config.mailboxType, source: sourceOf(config), scopes: ['read', ...(send ? ['send'] : [])],
        capabilities: { read, send, remoteDrafts: false }, tools: mailTools.filter(tool => tool.scope === 'read' || send), issues };
    } catch (error) { return outcome = failure(error); }
    finally { if (scope.finish()) { outcome.status = 'unknown'; outcome.code = 'cleanup_failed'; outcome.cleanup = 'failed'; } }
  }
  async function callTencent(name: string, input: unknown, config: TencentMailConfig, secret: string, ctx: TencentMailContext): Promise<Record<string, unknown>> {
    const scope = callScope(ctx);
    let dataStarted = false;
    let dataBlocked: string | undefined;
    let outboundMessageId: string | undefined;
    let write = false;
    let result: Record<string, unknown>;
    try {
      validConfig(config, secret); assertCurrent(scope.ctx);
      const tool = mailTools.find(value => value.name === name);
      if (!tool) fail('tool_not_allowed');
      write = tool.write;
      if (write && (!ctx.operationId || ctx.operationId.length > 200)) fail('operation_required');
      const args = record(input);
      const allowedKeys = Object.keys(record(record(tool.inputSchema).properties));
      if (Object.keys(args).some(key => !allowedKeys.includes(key))) fail('invalid_arguments');
      if (name === 'tencent_mail_list_folders') {
        const parent = args.parent === undefined ? '' : text(args.parent, 1024, true);
        if (/[\r\n*%]/.test(parent)) fail('invalid_arguments');
        const offset = integer(args.offset, 0, 10000, 0); const limit = integer(args.limit, 1, 100, 50);
        const client = await openImap(config, secret, scope);
        const folders = await scope.wait(() => client.list({ reference: parent, mailbox: '%' }));
        assertCurrent(scope.ctx);
        result = { status: 'ok', source: sourceOf(config), folders: folders.slice(offset, offset + limit).map(folder => ({ path: folder.path, name: folder.name, delimiter: folder.delimiter, flags: [...folder.flags] })),
          nextOffset: offset + limit < folders.length ? offset + limit : null, range: { parent, depth: 1, offset, limit } };
      } else if (name === 'tencent_mail_search') {
        const folder = text(args.folder, 1024); if (/[\r\n]/.test(folder)) fail('invalid_arguments');
        const limit = integer(args.limit, 1, 50, 20);
        const client = await openImap(config, secret, scope, folder);
        if (!client.mailbox) fail('folder_unavailable');
        const upper = Math.min(integer(args.beforeUid, 1, 0xffffffff, 0xffffffff), client.mailbox.uidNext - 1);
        const lower = Math.max(1, upper - MAX_UID_WINDOW + 1);
        const query: Record<string, unknown> = { uid: lower + ':' + upper };
        for (const key of ['text', 'from', 'to', 'subject']) if (args[key] !== undefined) query[key === 'text' ? 'body' : key] = text(args[key], 1000);
        for (const key of ['since', 'before']) if (args[key] !== undefined) {
          const date = text(args[key], 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) fail('invalid_arguments');
          query[key] = new Date(date + 'T00:00:00Z');
        }
        if (args.seen !== undefined) { if (typeof args.seen !== 'boolean') fail('invalid_arguments'); query.seen = args.seen; }
        const all = upper < 1 ? [] : await scope.wait(() => client.search(query, { uid: true, strict: true }));
        assertCurrent(scope.ctx);
        const uids = [...new Set(all || [])].filter(uid => uid >= lower && uid <= upper).sort((a, b) => b - a);
        const selected = uids.slice(0, limit); const messages = [];
        for (const uid of selected) {
          const message = await fetchMeta(client, uid, scope);
          messages.push({ source: { ...sourceOf(config), folder, uidValidity: String(client.mailbox.uidValidity), uid }, ...summary(message) });
        }
        result = { status: 'ok', source: sourceOf(config), messages, searchedUidRange: upper < 1 ? null : { from: lower, to: upper },
          nextBeforeUid: uids.length > limit ? selected.at(-1)! - 1 : lower > 1 ? lower - 1 : null, bodyRead: false };
      } else if (name === 'tencent_mail_read' || name === 'tencent_mail_attachment') {
        const ref = messageRef(args.source, config);
        const client = await openMessage(ref, config, secret, scope); const meta = await fetchMeta(client, ref.uid, scope);
        if (name === 'tencent_mail_attachment') {
          const part = text(args.part, 80); if (!/^[1-9][0-9]*(?:\.[1-9][0-9]*)*$/.test(part)) fail('invalid_arguments');
          const attachment = attachments(meta.bodyStructure).find(item => item.part === part);
          if (!attachment) fail('attachment_not_found');
          const max = integer(args.maxBytes, 1, MAX_ATTACHMENT, MAX_ATTACHMENT);
          const { content } = await scope.wait(() => client.download(ref.uid, part, { uid: true, maxBytes: max + 1, chunkSize: 65536, decodeText: false }));
          scope.add(() => content.destroy());
          const contentBuffer = await scope.wait(() => collect(content, max, scope.ctx));
          result = { status: 'ok', source: ref, attachment, contentBase64: contentBuffer.toString('base64'), readRange: { bytes: contentBuffer.length, complete: true, maxBytes: max } };
        } else {
          const offset = integer(args.offset, 0, MAX_RAW, 0); const maxChars = integer(args.maxChars, 1, MAX_TEXT, MAX_TEXT);
          if (!Number.isSafeInteger(meta.size) || Number(meta.size) > MAX_RAW) fail('message_too_large');
          const raw = await scope.wait(() => client.fetchOne(ref.uid, { uid: true, source: { start: 0, maxLength: MAX_RAW + 1 } }, { uid: true }));
          assertCurrent(scope.ctx);
          if (!raw || raw.uid !== ref.uid || !Buffer.isBuffer(raw.source) || raw.source.length > MAX_RAW || raw.source.length < Number(meta.size)) fail('message_incomplete');
          const parsed = await scope.wait(() => dependencies.parse(raw.source as Buffer)); assertCurrent(scope.ctx);
          const body = typeof parsed.text === 'string' ? parsed.text : '';
          result = { status: 'ok', source: ref, ...summary(meta), text: body.slice(offset, offset + maxChars),
            readRange: { rawBytes: raw.source.length, maxRawBytes: MAX_RAW, offset, chars: Math.min(maxChars, Math.max(0, body.length - offset)), totalChars: body.length, nextOffset: offset + maxChars < body.length ? offset + maxChars : null }, attachments: attachments(meta.bodyStructure) };
        }
      } else {
        const message = prepareSend(args, config);
        if (name !== 'tencent_mail_send') {
          const ref = messageRef(args.source, config); const client = await openMessage(ref, config, secret, scope); const original = await fetchMeta(client, ref.uid, scope);
          message.source = ref;
          if (name === 'tencent_mail_reply') {
            const id = record(original.envelope).messageId;
            if (typeof id !== 'string' || id.length > 998 || /[\r\n]/.test(id)) fail('reply_reference_unavailable');
            message.inReplyTo = id; message.references = id;
          }
        }
        assertCurrent(scope.ctx);
        const messageId = outboundMessageId = '<' + createHash('sha256').update(config.connectionId + ':' + ctx.operationId).digest('hex') + '@optracall.local>';
        const mime = await scope.wait(() => dependencies.compose({ ...message, messageId, disableFileAccess: true, disableUrlAccess: true }));
        assertCurrent(scope.ctx);
        if (mime.length > MAX_RAW + MAX_SEND_TEXT + 1024 * 1024) fail('message_too_large');
        const smtp = await openSmtp(config, secret, scope);
        const stream = new Readable({ read() {
          // DATA permission can arrive after Host revocation but before its
          // abort signal. Recheck at first byte, while submission is reversible.
          try { assertCurrent(scope.ctx); }
          catch (error) { dataBlocked = errorCode(error); this.destroy(new MailFailure(dataBlocked)); return; }
          dataStarted = true; this.push(mime); this.push(null);
        } });
        scope.add(() => stream.destroy());
        assertCurrent(scope.ctx);
        const info = await smtpWait<Record<string, unknown>>(smtp, scope, (resolve, reject) => {
          smtp.send({ from: config.login, to: message.recipients }, stream, (error, value) => error ? reject(error) : resolve(value ?? {}));
        });
        // A real final receipt remains evidence even when cancellation races its arrival.
        result = { status: 'accepted', operationId: ctx.operationId, messageId, source: sourceOf(config), serverAccepted: true, delivery: 'unconfirmed',
          accepted: Array.isArray(info.accepted) ? info.accepted.filter(address => message.recipients.includes(String(address))) : message.recipients,
          rejected: Array.isArray(info.rejected) ? info.rejected.filter(address => message.recipients.includes(String(address))) : [] };
      }
    } catch (error) {
      // Nodemailer can replace the source Error.code while wrapping it. Retain
      // our safe primitive cause independently from that third-party mutation.
      const actualError = dataBlocked ? new MailFailure(dataBlocked) : error;
      const value = actualError && typeof actualError === 'object' ? actualError as Record<string, unknown> : {};
      const rejected = Number(value.responseCode) >= 400 && Number(value.responseCode) <= 599;
      result = write && dataStarted && !rejected
        ? { ...failure(new MailFailure('send_result_unknown')), status: 'unknown', operationId: ctx.operationId, messageId: outboundMessageId, source: sourceOf(config), mayHaveBeenAccepted: true }
        : { ...failure(actualError), ...(write ? { operationId: ctx.operationId } : {}), ...(write && !(actualError instanceof MailFailure) ? { code: 'send_rejected' } : {}) };
    }
    const closeFailed = scope.finish();
    if (closeFailed) result.cleanup = 'failed';
    return result;
  }
  return { verifyTencent, callTencent };
}

function summary(message: Record<string, unknown>) {
  const envelope = message.envelope && typeof message.envelope === 'object' ? message.envelope as Record<string, unknown> : {};
  const addresses = (value: unknown) => Array.isArray(value) ? value.slice(0, 50).map(item => {
    const entry = record(item); return { address: String(entry.address ?? '').slice(0, 320), name: String(entry.name ?? '').slice(0, 200) };
  }) : [];
  return { subject: String(envelope.subject ?? '').slice(0, 2000), from: addresses(envelope.from), to: addresses(envelope.to), cc: addresses(envelope.cc),
    messageId: typeof envelope.messageId === 'string' ? envelope.messageId.slice(0, 998) : null,
    date: envelope.date instanceof Date ? envelope.date.toISOString() : null, size: message.size,
    flags: message.flags instanceof Set ? [...message.flags].map(value => String(value).slice(0, 100)).slice(0, 100) : [] };
}
function attachments(value: unknown, output: Array<Record<string, unknown>> = [], depth = 0): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || depth > 20 || output.length >= 100) return output;
  const node = value as Record<string, unknown>;
  const disposition = node.dispositionParameters && typeof node.dispositionParameters === 'object' ? node.dispositionParameters as Record<string, unknown> : {};
  const parameters = node.parameters && typeof node.parameters === 'object' ? node.parameters as Record<string, unknown> : {};
  if (typeof node.part === 'string' && (node.disposition === 'attachment' || disposition.filename || parameters.name)) output.push({
    part: node.part, filename: String(disposition.filename ?? parameters.name ?? 'attachment').slice(0, 255), contentType: String(node.type ?? 'application/octet-stream').slice(0, 200), size: node.size,
  });
  if (Array.isArray(node.childNodes)) for (const child of node.childNodes) attachments(child, output, depth + 1);
  return output;
}
async function collect(stream: Readable, max: number, ctx: TencentMailContext): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of stream) {
    assertCurrent(ctx); const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length;
    if (size > max) { stream.destroy(); fail('attachment_too_large'); }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
function prepareSend(args: Record<string, unknown>, config: TencentMailConfig) {
  const list = (value: unknown, required = false): string[] => {
    if (value === undefined && !required) return [];
    if (!Array.isArray(value) || value.length > 50 || (required && value.length === 0) || value.some(address => typeof address !== 'string' || !validAddress(address))) return fail('invalid_recipients');
    return value as string[];
  };
  const to = list(args.to, true); const cc = list(args.cc); const bcc = list(args.bcc); const recipients = [...new Set([...to, ...cc, ...bcc])];
  if (recipients.length > 50) fail('invalid_recipients');
  const subject = text(args.subject, 998, true); if (/[\r\n]/.test(subject)) fail('invalid_arguments');
  const body = text(args.text, MAX_SEND_TEXT, true);
  const files = args.attachments === undefined ? [] : args.attachments;
  if (!Array.isArray(files) || files.length > 10) fail('invalid_arguments');
  let totalBytes = 0;
  const attachments = files.map(value => {
    const file = record(value);
    if (Object.keys(file).some(key => !['filename', 'contentType', 'contentBase64'].includes(key))) fail('invalid_arguments');
    const filename = text(file.filename, 255); if (/[\r\n/\\]/.test(filename)) fail('invalid_arguments');
    const contentType = file.contentType === undefined ? 'application/octet-stream' : text(file.contentType, 200);
    if (!/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(contentType)) fail('invalid_arguments');
    const encoded = text(file.contentBase64, Math.ceil(MAX_ATTACHMENT / 3) * 4, true);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail('invalid_arguments');
    const content = Buffer.from(encoded, 'base64'); totalBytes += content.length;
    if (content.length > MAX_ATTACHMENT || totalBytes > MAX_RAW) fail('attachment_too_large');
    return { filename, contentType, content };
  });
  return { from: config.login, to, cc, bcc, subject, text: body, attachments, recipients, source: undefined as TencentMessageRef | undefined, inReplyTo: undefined as string | undefined, references: undefined as string | undefined };
}

let production: Promise<ReturnType<typeof createTencentMailAdapter>> | undefined;
function productionAdapter() {
  production ??= Promise.all([import('imapflow'), import('nodemailer/lib/smtp-connection/index.js'), import('nodemailer/lib/mail-composer/index.js'), import('mailparser')]).then(([imap, smtp, composer, parser]) =>
    createTencentMailAdapter({
      imap: options => new imap.ImapFlow(options as unknown as ConstructorParameters<typeof imap.ImapFlow>[0]) as unknown as MailImapClient,
      smtp: options => new smtp.default(options) as unknown as MailSmtpClient,
      compose: async options => new composer.default(options).compile().build(),
      parse: async source => parser.simpleParser(source, { maxHeadSize: 65536, maxChildNodes: 100, maxHtmlLengthToParse: MAX_RAW, ignoreEmbedded: true, skipImageLinks: true, skipTextToHtml: true }) as unknown as Record<string, unknown>,
    }));
  return production;
}
export async function verifyTencent(config: TencentMailConfig, secret: string, signal: AbortSignal, lifecycle?: Pick<TencentMailContext, 'registerCleanup'>): Promise<Record<string, unknown>> {
  return (await productionAdapter()).verifyTencent(config, secret, signal, lifecycle);
}
export async function callTencent(name: string, args: unknown, config: TencentMailConfig, secret: string, ctx: TencentMailContext): Promise<Record<string, unknown>> {
  return (await productionAdapter()).callTencent(name, args, config, secret, ctx);
}
