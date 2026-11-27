import { createHash } from 'node:crypto';
import { ServiceConnectionError, serviceRecord, type JsonValue } from './service-connection-types.ts';

/** Published Gmail MCP contracts checked 2026-11-27 (no provider/account calls):
 * https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/send_message
 * https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/reply
 * https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/forward
 * https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/get_message
 * https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/get_draft
 * draftId ignores explicit send fields; forward inherits content/attachments; signatures are mutable.
 * Reply/forward are therefore frozen as an explicit send_message, never an opaque native send.
 */
const MAX_BODY = 256 * 1024, MAX_RAW = 2 * 1024 * 1024, MAX_ATTACHMENTS = 32, MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024, MAX_PAYLOAD = 4 * 1024 * 1024;
const instructions: Record<string, string> = {
  gmail_mail_draft_requires_explicit_content: 'Read the draft first, then compose a new send_message with the exact recipients, subject, body and attachment bytes. Sending a mutable draft ID cannot reuse content approval.',
  gmail_mail_signature_requires_explicit_content: 'Read or compose the desired signature into the explicit body and set includeSignature to false before requesting approval.',
  gmail_mail_recipients_required: 'Specify complete To, Cc and Bcc recipients explicitly. Reply defaults and replyAll cannot be approved as exact recipients.',
  gmail_mail_source_required: 'Read the original message with the bound get_message tool before composing an exact reply or forward.',
  gmail_mail_attachment_unresolved: 'The original message has unresolved attachment content. Read the complete RAW message or attachment bytes, then compose a fully explicit send_message; no forward was sent.',
  gmail_mail_inline_attachment_unresolved: 'Inline attachment references cannot be matched to exact bytes. Compose a complete explicit message with valid cid:attN references before requesting approval.',
};
export class MailActionPreparationError extends ServiceConnectionError {
  readonly exposure = 'safe-tool-error-v1' as const;
  constructor(code: string) { super(code, 409); this.name = 'MailActionPreparationError'; this.message = instructions[code] ?? 'The mail action needs fully explicit recipients, subject, complete content and immutable attachment bytes before approval.'; }
}
function fail(code = 'gmail_mail_action_not_explicit'): never { throw new MailActionPreparationError(code); }
type MailAttachment = { filename: string; mimeType: string; content: string; inline: boolean };
export type MailActionPreview = {
  from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text?: string; html?: string;
  attachments: { filename: string; mimeType: string; bytes: number; sha256: string; inline: boolean }[];
  source?: { messageId: string; subject: string; sender: string; contentSha256: string; threadId?: string };
};
export type PreparedMailAction = { toolName: 'send_message'; arguments: Record<string, JsonValue>; preview: MailActionPreview };
export type PrepareMailActionInput = {
  toolName: string; arguments: Record<string, unknown>; accountLabel: string;
  /** Host-owned, current-account get_message result: RAW for forwards, MINIMAL suffices
   * for explicit replies (published MCP MINIMAL includes subject and sender).
   * Return the actual Message or MCP result envelope, never an Agent-supplied snapshot.
   * The caller checks the bound read grant/schema and cancellation around this read.
   */
  readMessage?: (messageId: string) => Promise<unknown>;
  signal?: AbortSignal; assertCurrent?: () => void;
};
type SourceMessage = { id: string; subject: string; sender: string; to: string[]; cc: string[]; date?: string; text?: string; html?: string; threadId?: string; attachments: MailAttachment[]; contentSha256: string };
function current(input: PrepareMailActionInput): void { input.signal?.throwIfAborted(); input.assertCurrent?.(); }
function keys(value: Record<string, unknown>, allowed: readonly string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) fail(); }
function text(value: unknown, max = MAX_BODY): string { if (typeof value !== 'string' || value.length > max || /\u0000/.test(value)) fail(); return value; }
function header(value: unknown, max = 998, empty = true): string { const result = text(value, max); if ((!empty && !result) || /[\r\n\u0000-\u001f\u007f]/.test(result)) fail(); return result; }
function address(value: unknown): string { const result = header(value, 254, false); if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/.test(result) || result.includes('..')) fail('gmail_mail_recipients_required'); return result; }
function addresses(value: unknown, required = false): string[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.length > 500 || required && !value.length) fail('gmail_mail_recipients_required');
  return value.map(address);
}
function bytes(content: unknown, limit = MAX_ATTACHMENT_BYTES, base64url = false): Buffer {
  if (typeof content !== 'string' || content.length > Math.ceil(limit / 3) * 4 + 4 || !(base64url ? /^[A-Za-z0-9+/_-]*={0,2}$/ : /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).test(content)) fail('gmail_mail_attachment_unresolved');
  const normalized = content.replaceAll('-', '+').replaceAll('_', '/'), result = Buffer.from(normalized, 'base64');
  if (result.length > limit || result.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) fail('gmail_mail_attachment_unresolved');
  return result;
}
function attachments(value: unknown): MailAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) fail('gmail_mail_attachment_unresolved');
  return value.map(item => {
    if (!serviceRecord(item)) fail('gmail_mail_attachment_unresolved'); keys(item, ['filename', 'mimeType', 'content', 'inline']);
    const filename = header(item.filename, 255, false), mimeType = item.mimeType === undefined ? 'application/octet-stream' : header(item.mimeType, 200, false);
    if (!/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mimeType) || item.inline !== undefined && typeof item.inline !== 'boolean') fail('gmail_mail_attachment_unresolved');
    return { filename, mimeType, content: bytes(item.content).toString('base64'), inline: item.inline === true };
  });
}
function body(value: Record<string, unknown>, plainKey = 'body'): { text?: string; html?: string } {
  const result = { ...(value[plainKey] === undefined ? {} : { text: text(value[plainKey]) }), ...(value.htmlBody === undefined ? {} : { html: text(value.htmlBody) }) };
  if (result.text === undefined && result.html === undefined) fail();
  return result;
}
function signature(value: Record<string, unknown>): void { if (value.includeSignature !== undefined && value.includeSignature !== false) fail('gmail_mail_signature_requires_explicit_content'); }
function cidHtml(html: string, files: readonly MailAttachment[]): string {
  for (const match of html.matchAll(/\bcid:([^\s"'<>]+)/gi)) {
    const index = /^att(0|[1-9][0-9]*)$/.exec(match[1]!);
    if (!index || !files[Number(index[1])]?.inline) fail('gmail_mail_inline_attachment_unresolved');
  }
  // Gmail removes non-cid images; do not preview them as deliverable content.
  for (const image of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) if (!/^cid:/i.test(image[1] ?? image[2] ?? image[3] ?? '')) fail('gmail_mail_inline_attachment_unresolved');
  return html;
}
function messageResult(input: unknown): Record<string, unknown> {
  if (!serviceRecord(input) || input.isError === true) fail('gmail_mail_source_required');
  if (serviceRecord(input.structuredContent)) return input.structuredContent;
  if (Array.isArray(input.content)) {
    const parts = input.content.filter(part => serviceRecord(part) && part.type === 'text');
    if (parts.length !== 1 || !serviceRecord(parts[0]) || typeof parts[0].text !== 'string' || Buffer.byteLength(parts[0].text) > MAX_PAYLOAD) fail('gmail_mail_source_required');
    try { const parsed: unknown = JSON.parse(parts[0].text); if (serviceRecord(parsed)) return parsed; } catch { /* A prose snippet cannot prove complete source content. */ }
    fail('gmail_mail_source_required');
  }
  return input;
}
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function parsedAddresses(value: unknown): string[] { if (value === undefined) return []; if (!serviceRecord(value) || !Array.isArray(value.value)) fail('gmail_mail_source_required'); return value.value.map(item => { if (!serviceRecord(item)) fail('gmail_mail_source_required'); return address(item.address); }); }
async function sourceMessage(input: PrepareMailActionInput, messageId: string, includeOriginal: boolean): Promise<SourceMessage> {
  if (!input.readMessage) fail('gmail_mail_source_required');
  current(input); const result = messageResult(await input.readMessage(messageId)); current(input);
  if (result.id !== messageId) fail('gmail_mail_source_required');
  const threadId = result.threadId === undefined ? undefined : header(result.threadId, 256, false);
  if (result.raw === undefined) {
    if (!includeOriginal) return { id: messageId, subject: header(result.subject), sender: address(result.sender), to: addresses(result.toRecipients), cc: addresses(result.ccRecipients), threadId, attachments: [], contentSha256: sha256(JSON.stringify(result)) };
    if (Array.isArray(result.attachments) && result.attachments.length || Array.isArray(result.attachmentIds) && result.attachmentIds.length || result.attachments !== undefined && !Array.isArray(result.attachments) || result.attachmentIds !== undefined && !Array.isArray(result.attachmentIds)) fail('gmail_mail_attachment_unresolved');
    const content = body(result, 'plaintextBody');
    return { id: messageId, subject: header(result.subject ?? ''), sender: address(result.sender), to: addresses(result.toRecipients), cc: addresses(result.ccRecipients), ...(result.date ? { date: header(result.date, 100) } : {}), ...content, threadId, attachments: [], contentSha256: sha256(JSON.stringify(result)) };
  }
  if (typeof result.raw !== 'string') fail('gmail_mail_source_required');
  const raw = /\r?\n\r?\n/.test(result.raw) ? Buffer.from(result.raw, 'utf8') : bytes(result.raw, MAX_RAW, true);
  if (!raw.length || raw.length > MAX_RAW || !/\r?\n\r?\n/.test(raw.toString('utf8'))) fail('gmail_mail_source_required');
  const { simpleParser } = await import('mailparser'); current(input);
  const parsed = await simpleParser(raw, { maxHeadSize: 65536, maxChildNodes: 100, maxHtmlLengthToParse: MAX_RAW, skipImageLinks: true, skipTextToHtml: true, skipHtmlToText: true }); current(input);
  if (parsed.attachments.length > MAX_ATTACHMENTS) fail('gmail_mail_attachment_unresolved');
  const cidMap = new Map<string, string>();
  const files = parsed.attachments.map((file, index): MailAttachment => {
    if (!Buffer.isBuffer(file.content) || file.content.length > MAX_ATTACHMENT_BYTES) fail('gmail_mail_attachment_unresolved');
    const cid = file.cid ?? file.contentId?.replace(/^<|>$/g, '');
    if (cid) { if (cidMap.has(cid)) fail('gmail_mail_inline_attachment_unresolved'); cidMap.set(cid, `att${index}`); }
    return { filename: header(file.filename ?? `attachment-${index + 1}`, 255, false), mimeType: header(file.contentType, 200, false), content: file.content.toString('base64'), inline: Boolean(cid) || file.contentDisposition === 'inline' };
  });
  const html = typeof parsed.html === 'string' ? text(parsed.html).replace(/\bcid:([^\s"'<>]+)/gi, (_match, cid: string) => { let decoded: string; try { decoded = decodeURIComponent(cid); } catch { return fail('gmail_mail_inline_attachment_unresolved'); } const mapped = cidMap.get(decoded); if (!mapped) fail('gmail_mail_inline_attachment_unresolved'); return `cid:${mapped}`; }) : undefined;
  if (parsed.text === undefined && html === undefined) fail('gmail_mail_source_required');
  const senders = parsedAddresses(parsed.from); if (senders.length !== 1) fail('gmail_mail_source_required');
  return { id: messageId, subject: header(parsed.subject ?? ''), sender: senders[0]!, to: parsedAddresses(parsed.to), cc: parsedAddresses(parsed.cc), ...(parsed.date ? { date: parsed.date.toISOString() } : {}), ...(parsed.text === undefined ? {} : { text: text(parsed.text) }), ...(html === undefined ? {} : { html }), threadId, attachments: files, contentSha256: sha256(raw) };
}
function freeze<T>(input: T): T { if (input && typeof input === 'object') { for (const value of Object.values(input)) freeze(value); Object.freeze(input); } return input; }
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Resolves only reads, then freezes the exact invocation and preview before operation preparation.
 * Caller MUST validate the transformed send_message against the current bound catalog and use
 * these returned arguments for its journal, confirmation, provider form matching and actual call.
 */
export async function prepareMailAction(input: PrepareMailActionInput): Promise<PreparedMailAction> {
  current(input);
  if (!serviceRecord(input.arguments)) fail();
  const args = structuredClone(input.arguments), from = address(input.accountLabel);
  if (Object.hasOwn(args, 'draftId')) fail('gmail_mail_draft_requires_explicit_content');
  signature(args);
  let to: string[], cc: string[], bcc: string[], subject: string, content: { text?: string; html?: string }, files: MailAttachment[], source: SourceMessage | undefined;
  const outgoing: Record<string, JsonValue> = {};
  if (input.toolName === 'send_message') {
    keys(args, ['to', 'cc', 'bcc', 'subject', 'body', 'htmlBody', 'attachments', 'includeSignature', 'replyToMessageId', 'replyThreadId']);
    to = addresses(args.to, true); cc = addresses(args.cc); bcc = addresses(args.bcc); subject = header(args.subject); content = body(args); files = attachments(args.attachments);
    if (args.replyToMessageId !== undefined && args.replyThreadId !== undefined) fail();
    for (const key of ['replyToMessageId', 'replyThreadId'] as const) if (args[key] !== undefined) outgoing[key] = header(args[key], 256, false);
  } else if (input.toolName === 'reply' || input.toolName === 'forward') {
    keys(args, input.toolName === 'reply' ? ['messageId', 'to', 'cc', 'bcc', 'body', 'htmlBody', 'attachments', 'includeSignature', 'replyAll'] : ['messageId', 'to', 'cc', 'bcc', 'forwardText', 'htmlBody', 'attachments', 'includeSignature']);
    if (input.toolName === 'reply' && (args.replyAll !== undefined && args.replyAll !== false || !Object.hasOwn(args, 'cc') || !Object.hasOwn(args, 'bcc'))) fail('gmail_mail_recipients_required');
    to = addresses(args.to, true); cc = addresses(args.cc); bcc = addresses(args.bcc); files = attachments(args.attachments);
    const messageId = header(args.messageId, 256, false);
    source = await sourceMessage(input, messageId, input.toolName === 'forward'); current(input);
    if (input.toolName === 'reply') {
      subject = /^re:/i.test(source.subject) ? source.subject : `Re: ${source.subject}`; content = body(args); outgoing.replyToMessageId = source.id;
    } else {
      subject = /^fwd:/i.test(source.subject) ? source.subject : `Fwd: ${source.subject}`;
      const comment = args.forwardText === undefined ? undefined : text(args.forwardText), htmlComment = args.htmlBody === undefined ? undefined : text(args.htmlBody);
      if (source.attachments.length && htmlComment && /\bcid:/i.test(htmlComment)) fail('gmail_mail_inline_attachment_unresolved');
      const headers = ['---------- Forwarded message ----------', `From: ${source.sender}`, ...(source.date ? [`Date: ${source.date}`] : []), `Subject: ${source.subject}`, `To: ${source.to.join(', ')}`, ...(source.cc.length ? [`Cc: ${source.cc.join(', ')}`] : [])].join('\n');
      content = {
        ...(source.text === undefined || htmlComment !== undefined && comment === undefined ? {} : { text: `${comment ? `${comment}\n\n` : ''}${headers}\n\n${source.text}` }),
        ...(source.html === undefined && htmlComment === undefined ? {} : { html: `${htmlComment ?? (comment ? `<div>${escapeHtml(comment).replaceAll('\n', '<br>')}</div>` : '')}<div>${escapeHtml(headers).replaceAll('\n', '<br>')}</div><blockquote>${source.html ?? `<pre>${escapeHtml(source.text ?? '')}</pre>`}</blockquote>` }),
      };
      files = [...source.attachments, ...files];
    }
  } else return fail('gmail_mail_action_unsupported');
  if (to.length + cc.length + bcc.length > 500 || files.length > MAX_ATTACHMENTS || files.reduce((sum, file) => sum + bytes(file.content).length, 0) > MAX_ATTACHMENT_BYTES) fail('gmail_mail_attachment_unresolved');
  if (content.html !== undefined) cidHtml(content.html, files);
  if (content.text === undefined && content.html === undefined) fail();
  Object.assign(outgoing, { to, cc, bcc, subject, ...(content.text === undefined ? {} : { body: content.text }), ...(content.html === undefined ? {} : { htmlBody: content.html }), attachments: files, includeSignature: false });
  if (Buffer.byteLength(JSON.stringify(outgoing)) > MAX_PAYLOAD) fail('gmail_mail_attachment_unresolved');
  current(input);
  return freeze({ toolName: 'send_message', arguments: outgoing, preview: { from, to: [...to], cc: [...cc], bcc: [...bcc], subject, ...content, attachments: files.map(file => { const content = bytes(file.content); return { filename: file.filename, mimeType: file.mimeType, bytes: content.length, sha256: sha256(content), inline: file.inline }; }), ...(source ? { source: { messageId: source.id, subject: source.subject, sender: source.sender, contentSha256: source.contentSha256, ...(source.threadId ? { threadId: source.threadId } : {}) } } : {}) } });
}
