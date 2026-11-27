import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareMailAction, MailActionPreparationError } from '../src/host/service-connection-mail-preview.ts';
import { validateServiceConnectionToolArguments } from '../src/agent/service-connection-tools.ts';
import type { ServiceTool } from '../src/host/service-connection-types.ts';

// The published SendRequest fields, not the unsafe synthetic {body} approval fixture.
const sendSchema: ServiceTool = { name: 'send_message', semanticName: 'send_message', scope: 'send', action: 'send', write: true, requiresConfirmation: true, inputSchema: {
  type: 'object', additionalProperties: false, properties: {
    to: { type: 'array', items: { type: 'string' } }, cc: { type: 'array', items: { type: 'string' } }, bcc: { type: 'array', items: { type: 'string' } },
    subject: { type: 'string' }, body: { type: 'string' }, htmlBody: { type: 'string' }, includeSignature: { type: 'boolean' }, draftId: { type: 'string' }, replyToMessageId: { type: 'string' }, replyThreadId: { type: 'string' },
    attachments: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { filename: { type: 'string' }, mimeType: { type: 'string' }, content: { type: 'string' }, inline: { type: 'boolean' } }, required: ['content'] } },
  },
} };
const accountLabel = 'bound-account@example.test';
const explicit = { to: ['recipient@example.test'], cc: ['copy@example.test'], bcc: ['private@example.test'], subject: 'Exact approved subject', body: 'Exact approved body', includeSignature: false };
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const sourceRaw = ['From: Original Person <original@example.test>', 'To: old-recipient@example.test', 'Cc: original-copy@example.test', 'Subject: Original subject', 'Date: Fri, 27 Nov 2026 12:00:00 +0000', 'Message-ID: <immutable-original@example.test>', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="synthetic-boundary"', '', '--synthetic-boundary', 'Content-Type: text/plain; charset=utf-8', '', 'Complete original content.', '--synthetic-boundary', 'Content-Type: application/pdf; name="original.pdf"', 'Content-Disposition: attachment; filename="original.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from('synthetic PDF bytes').toString('base64'), '--synthetic-boundary--', ''].join('\r\n');
const envelope = (raw = sourceRaw) => ({ content: [{ type: 'text', text: JSON.stringify({ id: 'message-1', threadId: 'thread-1', raw: Buffer.from(raw).toString('base64url') }) }] });
const input = (toolName: string, args: Record<string, unknown>) => ({ toolName, arguments: args, accountLabel });
const fails = (code: string) => (error: unknown) => error instanceof MailActionPreparationError && error.code === code;

test('GG08 explicit published send_message freezes exact recipients, alternatives and attachment bytes before approval', async () => {
  const args = { ...explicit, htmlBody: '<p>Exact approved body</p>', attachments: [{ filename: 'proposal.pdf', mimeType: 'application/pdf', content: Buffer.from('unchanging attachment').toString('base64') }] };
  const original = structuredClone(args), prepared = await prepareMailAction(input('send_message', args));
  assert.equal(prepared.toolName, 'send_message');
  validateServiceConnectionToolArguments(sendSchema, prepared.arguments);
  assert.deepEqual(prepared.preview, { from: accountLabel, to: explicit.to, cc: explicit.cc, bcc: explicit.bcc, subject: explicit.subject, text: explicit.body, html: args.htmlBody, attachments: [{ filename: 'proposal.pdf', mimeType: 'application/pdf', bytes: 21, sha256: hash('unchanging attachment'), inline: false }] });
  assert.equal(prepared.arguments.includeSignature, false);
  assert.equal(Object.hasOwn(prepared.arguments, 'draftId'), false);
  assert.deepEqual(args, original);
  assert.throws(() => { (prepared.arguments.to as string[])[0] = 'changed@example.test'; }, TypeError);
  assert.throws(() => { prepared.preview.attachments[0]!.filename = 'changed.pdf'; }, TypeError);
});

test('GG08 draftId ignores other fields at Google and cannot masquerade as the displayed explicit send', async () => {
  for (const args of [{ draftId: 'mutable-draft' }, { ...explicit, draftId: 'mutable-draft' }, { ...explicit, draftId: '' }]) await assert.rejects(prepareMailAction(input('send_message', args)), fails('gmail_mail_draft_requires_explicit_content'));
  await assert.rejects(prepareMailAction(input('send_message', { draftId: 'private-draft-id-sentinel' })), (error: unknown) => error instanceof MailActionPreparationError && error.exposure === 'safe-tool-error-v1' && /Read the draft first/.test(error.message) && !error.message.includes('private-draft-id-sentinel'));
});

test('GG08 automatic server signature is rejected for all three published sending tools', async () => {
  for (const toolName of ['send_message', 'reply', 'forward']) await assert.rejects(prepareMailAction(input(toolName, { ...explicit, includeSignature: true })), fails('gmail_mail_signature_requires_explicit_content'));
});

test('GG08 native reply defaults and replyAll cannot select recipients behind the approval', async () => {
  for (const args of [{ messageId: 'message-1', body: 'Reply' }, { messageId: 'message-1', body: 'Reply', replyAll: true }, { messageId: 'message-1', to: explicit.to, body: 'Reply' }, { messageId: 'message-1', to: explicit.to, cc: [], body: 'Reply' }]) {
    let reads = 0;
    await assert.rejects(prepareMailAction({ ...input('reply', args), readMessage: async () => { reads++; return envelope(); } }), fails('gmail_mail_recipients_required'));
    assert.equal(reads, 0);
  }
});

test('GG08 explicit reply resolves exact source subject and becomes a fully specified send_message with official reply threading', async () => {
  const reads: string[] = [], args = { messageId: 'message-1', to: ['chosen-reply@example.test'], cc: [], bcc: [], body: 'Only this reply body.', replyAll: false };
  const prepared = await prepareMailAction({ ...input('reply', args), readMessage: async id => { reads.push(id); return envelope(); } });
  validateServiceConnectionToolArguments(sendSchema, prepared.arguments);
  assert.deepEqual(reads, ['message-1']);
  assert.deepEqual(prepared.arguments, { to: args.to, cc: [], bcc: [], subject: 'Re: Original subject', body: args.body, attachments: [], includeSignature: false, replyToMessageId: 'message-1' });
  assert.equal(prepared.preview.source?.messageId, 'message-1');
  assert.equal(prepared.preview.source?.contentSha256, hash(sourceRaw));
  assert.equal(prepared.preview.subject, 'Re: Original subject');
  assert.equal(prepared.preview.text?.includes('Complete original content.'), false, 'Reply does not silently append source body');
  assert.deepEqual(prepared.preview.attachments, [], 'Reply does not inherit original attachments');
});

test('GG08 forward freezes complete quoted body and original plus additional attachment bytes instead of inheriting opaque state', async () => {
  const prepared = await prepareMailAction({ ...input('forward', { messageId: 'message-1', to: explicit.to, forwardText: 'Please review this exact original.', attachments: [{ filename: 'new.txt', content: Buffer.from('new bytes').toString('base64') }] }), readMessage: async () => envelope() });
  validateServiceConnectionToolArguments(sendSchema, prepared.arguments);
  assert.equal(prepared.toolName, 'send_message');
  assert.equal(prepared.arguments.subject, 'Fwd: Original subject');
  assert.equal(Object.hasOwn(prepared.arguments, 'messageId'), false);
  assert.equal(Object.hasOwn(prepared.arguments, 'forwardText'), false);
  assert.match(String(prepared.arguments.body), /^Please review this exact original\.\n\n---------- Forwarded message ----------/);
  assert.match(String(prepared.arguments.body), /From: original@example\.test/);
  assert.match(String(prepared.arguments.body), /Complete original content\./);
  assert.deepEqual(prepared.preview.attachments.map(file => ({ filename: file.filename, sha256: file.sha256 })), [{ filename: 'original.pdf', sha256: hash('synthetic PDF bytes') }, { filename: 'new.txt', sha256: hash('new bytes') }]);
  assert.deepEqual(prepared.preview.to, explicit.to);
  assert.deepEqual(prepared.preview.cc, []);
  assert.deepEqual(prepared.preview.bcc, []);
});

test('GG08 published MCP MINIMAL subject metadata suffices for explicit reply without inheriting large original attachments', async () => {
  const source = { id: 'message-1', snippet: 'A source snippet is not the reply body.', subject: 'Published MINIMAL subject', sender: 'source@example.test', toRecipients: ['old-recipient@example.test'], ccRecipients: [], bccRecipients: [], date: '2026-11-27T12:00:00Z', labelIds: ['INBOX'], viewUrl: 'https://mail.google.com/mail/#all/message-1' };
  const prepared = await prepareMailAction({ ...input('reply', { messageId: 'message-1', to: explicit.to, cc: [], bcc: [], body: 'Complete explicit reply' }), readMessage: async () => ({ structuredContent: source }) });
  assert.equal(prepared.arguments.subject, 'Re: Published MINIMAL subject');
  assert.equal(prepared.arguments.body, 'Complete explicit reply');
  assert.deepEqual(prepared.arguments.attachments, []);
  assert.deepEqual(prepared.preview.to, explicit.to);
  await assert.rejects(prepareMailAction({ ...input('reply', { messageId: 'message-1', to: explicit.to, cc: [], bcc: [], body: 'Reply' }), readMessage: async () => ({ structuredContent: { ...source, subject: undefined } }) }), MailActionPreparationError);
});

test('GG08 HTML forward retains original inline bytes under explicit stable cid:attN identities', async () => {
  const raw = ['From: original@example.test', 'To: original-to@example.test', 'Subject: Inline original', 'MIME-Version: 1.0', 'Content-Type: multipart/related; boundary="inline-boundary"', '', '--inline-boundary', 'Content-Type: text/html; charset=utf-8', '', '<p>Original HTML</p><img src="cid:source-logo">', '--inline-boundary', 'Content-Type: image/png', 'Content-Disposition: inline; filename="logo.png"', 'Content-ID: <source-logo>', 'Content-Transfer-Encoding: base64', '', Buffer.from('synthetic image bytes').toString('base64'), '--inline-boundary--', ''].join('\r\n');
  const prepared = await prepareMailAction({ ...input('forward', { messageId: 'message-1', to: explicit.to, forwardText: 'Plain comment before HTML.' }), readMessage: async () => ({ structuredContent: { id: 'message-1', raw } }) });
  assert.match(String(prepared.arguments.htmlBody), /Original HTML/);
  assert.match(String(prepared.arguments.htmlBody), /src="cid:att0"/);
  assert.equal(prepared.preview.attachments[0]?.inline, true);
  assert.equal(prepared.preview.attachments[0]?.sha256, hash('synthetic image bytes'));
  assert.equal(prepared.arguments.body, undefined, 'No incomplete plain alternative is invented for an HTML-only source');
});

test('GG08 FULL_CONTENT metadata alone cannot promise original attachment content, but complete attachment-free reads can be forwarded', async () => {
  const source = { id: 'message-1', subject: 'Complete plain source', sender: 'source@example.test', plaintextBody: 'Entire body', toRecipients: ['old@example.test'], attachments: [{ id: 'opaque-attachment', filename: 'unresolved.pdf', mimeType: 'application/pdf' }] };
  await assert.rejects(prepareMailAction({ ...input('forward', { messageId: 'message-1', to: explicit.to }), readMessage: async () => ({ structuredContent: source }) }), fails('gmail_mail_attachment_unresolved'));
  const prepared = await prepareMailAction({ ...input('forward', { messageId: 'message-1', to: explicit.to }), readMessage: async () => ({ structuredContent: { ...source, attachments: [] } }) });
  assert.match(String(prepared.arguments.body), /Entire body/);
  assert.equal(prepared.arguments.subject, 'Fwd: Complete plain source');
});

test('GG08 malformed bytes, output-only attachment IDs, recipient/header injection and remote images fail closed', async () => {
  const variants = [{ ...explicit, to: ['Alice <alice@example.test>'] }, { ...explicit, subject: 'Subject\r\nBcc: hidden@example.test' }, { ...explicit, attachments: [{ id: 'opaque-id', filename: 'x.pdf', content: 'eA==' }] }, { ...explicit, attachments: [{ filename: 'x.pdf', content: 'invalid!!!!' }] }, { ...explicit, htmlBody: '<img src="https://external.invalid/image.png">' }];
  for (const args of variants) await assert.rejects(prepareMailAction(input('send_message', args)), MailActionPreparationError);
});

test('GG08 missing, erroneous, ambiguous and wrong-ID source results cannot be used as approved content', async () => {
  for (const result of [{ isError: true, content: [] }, { structuredContent: { id: 'another-message', raw: sourceRaw } }, { content: [{ type: 'text', text: 'a snippet' }] }, { content: [{ type: 'text', text: '{}' }, { type: 'text', text: '{}' }] }]) await assert.rejects(prepareMailAction({ ...input('forward', { messageId: 'message-1', to: explicit.to }), readMessage: async () => result }), MailActionPreparationError);
});

test('GG08 source-read cancellation or binding retirement cannot yield a sendable approval snapshot', async () => {
  const controller = new AbortController(); let checks = 0;
  await assert.rejects(prepareMailAction({ ...input('forward', { messageId: 'message-1', to: explicit.to }), signal: controller.signal, assertCurrent: () => { checks++; }, readMessage: async () => { controller.abort(); return envelope(); } }), error => error instanceof Error && error.name === 'AbortError');
  assert.ok(checks >= 1);
  await assert.rejects(prepareMailAction({ ...input('forward', { messageId: 'message-1', to: explicit.to }), assertCurrent: () => { throw Error('binding retired'); }, readMessage: async () => { throw Error('must not read'); } }), /binding retired/);
});

test('GG08 explicit send threading uses supported published fields and cannot append inherited source or fake From', async () => {
  const prepared = await prepareMailAction(input('send_message', { ...explicit, replyThreadId: 'thread-exact' }));
  assert.equal(prepared.arguments.replyThreadId, 'thread-exact');
  assert.equal(prepared.preview.from, accountLabel);
  for (const args of [{ ...explicit, from: 'another-account@example.test' }, { ...explicit, replyThreadId: 'thread-a', replyToMessageId: 'message-b' }, { ...explicit, inReplyTo: '<invented-header>' }, { ...explicit, raw: 'opaque MIME' }]) await assert.rejects(prepareMailAction(input('send_message', args)), MailActionPreparationError);
});
