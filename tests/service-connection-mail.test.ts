import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type TLSSocket } from 'node:tls';
import SMTPConnection from 'nodemailer/lib/smtp-connection/index.js';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { simpleParser } from 'mailparser';
import { ImapFlow } from 'imapflow';
import { createTencentMailAdapter, type TencentMailDependencies } from '../src/host/service-connection-mail.ts';

const config = { mailboxType: 'qq' as const, login: 'synthetic@qq.com', connectionId: 'synthetic-connection' };
const source = { ...config, folder: 'INBOX', uidValidity: '23', uid: 700 };
const context = () => ({ signal: new AbortController().signal, isCurrent: () => true, operationId: 'explicit-operation-1' });

function fixture(options: { validity?: bigint; smtpError?: Record<string, unknown>; consumeData?: boolean; holdData?: boolean; connectError?: boolean; loginError?: boolean; pendingConnect?: boolean; closeError?: boolean; composeHook?: () => void } = {}) {
  const calls: Array<[string, unknown?]> = [];
  let smtpCloses = 0;
  let imapCloses = 0;
  let resumeData: (() => void) | undefined;
  let submittedBytes = 0;
  class Imap extends EventEmitter {
    mailbox = { uidValidity: options.validity ?? 23n, uidNext: 1001, exists: 1000 };
    async connect() { calls.push(['imap-connect']); if (options.connectError) throw new Error('synthetic-secret must never escape'); if (options.pendingConnect) await new Promise(() => {}); }
    async mailboxOpen(folder: string, args: unknown) { calls.push(['open', { folder, args }]); }
    async list(args: unknown) { calls.push(['list', args]); return [{ path: 'INBOX', name: 'INBOX', delimiter: '/', flags: new Set<string>() }]; }
    async search(query: unknown, args: unknown) { calls.push(['search', { query, args }]); return [700, 999]; }
    async fetchOne(uid: number, query: Record<string, unknown>, args: unknown) {
      calls.push(['fetch', { uid, query, args }]);
      return { uid, size: Buffer.byteLength('synthetic MIME'), flags: new Set(['\\Seen']), envelope: { messageId: '<original@example.test>', subject: 'Original', from: [{ address: 'author@example.test' }], to: [{ address: config.login }] }, source: Buffer.from('synthetic MIME'), bodyStructure: { type: 'multipart/mixed', childNodes: [{ part: '1', type: 'text/plain' }, { part: '2', type: 'application/pdf', size: 6, disposition: 'attachment', dispositionParameters: { filename: 'report.pdf' } }] } };
    }
    async download(uid: number, part: string, args: unknown) { calls.push(['download', { uid, part, args }]); return { meta: { filename: 'report.pdf', contentType: 'application/pdf' }, content: Readable.from([Buffer.from('report')]) }; }
    close() { imapCloses++; this.emit('close'); if (options.closeError) throw new Error('synthetic cleanup failure'); }
  }
  class Smtp extends EventEmitter {
    connect(callback: (error?: unknown) => void) { calls.push(['smtp-connect']); callback(); }
    login(auth: unknown, callback: (error?: unknown) => void) { calls.push(['smtp-login', auth]); callback(options.loginError ? { code: 'EAUTH', message: 'synthetic-secret' } : undefined); }
    send(envelope: unknown, message: Readable, callback: (error: unknown, info?: Record<string, unknown>) => void) {
      calls.push(['smtp-send', envelope]);
      if (options.consumeData === false) { callback(options.smtpError ?? { command: 'RCPT TO', responseCode: 550 }); return; }
      message.once('error', callback);
      const startData = () => {
        message.on('data', (chunk: Buffer) => { submittedBytes += chunk.length; });
        message.on('end', () => callback(options.smtpError ?? null, options.smtpError ? undefined : { response: '250 queued', accepted: ['to@example.test'], rejected: [] }));
        message.resume();
      };
      if (options.holdData) resumeData = startData;
      else startData();
    }
    close() { smtpCloses++; this.emit('end'); }
  }
  const dependencies: TencentMailDependencies = {
    imap(args) { calls.push(['imap-options', args]); return new Imap(); },
    smtp(args) { calls.push(['smtp-options', args]); return new Smtp(); },
    async parse() { return { text: 'Body', messageId: '<original@example.test>', attachments: [] }; },
    async compose(args) { calls.push(['compose', args]); options.composeHook?.(); return Buffer.from('synthetic compiled MIME'); },
  };
  return { adapter: createTencentMailAdapter(dependencies), calls, closes: () => ({ imap: imapCloses, smtp: smtpCloses }), submittedBytes: () => submittedBytes, resumeData: () => { assert.ok(resumeData); resumeData(); } };
}

test('Tencent verification authenticates both protocol capabilities at fixed TLS endpoints', async () => {
  const f = fixture();
  const result = await f.adapter.verifyTencent(config, 'synthetic-secret', context().signal);
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.capabilities, { read: true, send: true, remoteDrafts: false });
  const options = Object.fromEntries(f.calls.filter(([name]) => name.endsWith('options')));
  assert.equal((options['imap-options'] as Record<string, unknown>).host, 'imap.qq.com');
  assert.equal((options['smtp-options'] as Record<string, unknown>).host, 'smtp.qq.com');
  assert.deepEqual(f.closes(), { imap: 1, smtp: 1 });
});

test('Tencent bounded search uses read-only folder, UID window and stable source references', async () => {
  const f = fixture();
  const result = await f.adapter.callTencent('tencent_mail_search', { folder: 'INBOX', text: 'quarter', limit: 1 }, config, 'synthetic-secret', context());
  assert.equal(result.status, 'ok');
  assert.deepEqual(f.calls.find(([name]) => name === 'open')?.[1], { folder: 'INBOX', args: { readOnly: true } });
  const search = f.calls.find(([name]) => name === 'search')?.[1] as { query: Record<string, unknown> };
  assert.equal(search.query.uid, '501:1000');
  assert.equal(search.query.body, 'quarter');
  assert.deepEqual((result.messages as Array<{ source: unknown }>)[0].source, { ...source, uid: 999 });
  assert.equal(result.nextBeforeUid, 998);
  assert.equal(f.closes().imap, 1);
});

test('Tencent stale UIDVALIDITY cannot fetch a replacement message', async () => {
  const f = fixture({ validity: 24n });
  const result = await f.adapter.callTencent('tencent_mail_read', { source }, config, 'synthetic-secret', context());
  assert.equal(result.code, 'stale_message');
  assert.equal(f.calls.some(([name]) => name === 'fetch'), false);
});

test('Tencent exact attachment identity and bounded download preserve source and read flags', async () => {
  const f = fixture();
  const result = await f.adapter.callTencent('tencent_mail_attachment', { source, part: '2', maxBytes: 100 }, config, 'synthetic-secret', context());
  assert.equal(result.status, 'ok');
  assert.equal(result.contentBase64, Buffer.from('report').toString('base64'));
  const download = f.calls.find(([name]) => name === 'download')?.[1] as { args: Record<string, unknown> };
  assert.equal(download.args.maxBytes, 101);
  assert.deepEqual(f.closes(), { imap: 1, smtp: 0 });
});

for (const operation of ['send', 'reply', 'forward']) {
  test(`Tencent ${operation} records server acceptance for one explicit operation`, async () => {
    const f = fixture();
    const result = await f.adapter.callTencent('tencent_mail_' + operation, { to: ['to@example.test'], subject: 'Subject', text: 'Body', ...(operation === 'send' ? {} : { source }) }, config, 'synthetic-secret', context());
    assert.equal(result.status, 'accepted');
    assert.equal(result.serverAccepted, true);
    assert.equal(result.delivery, 'unconfirmed');
    assert.equal(result.operationId, 'explicit-operation-1');
    assert.equal(f.calls.filter(([name]) => name === 'smtp-send').length, 1);
    assert.equal(f.closes().smtp, 1);
  });
}

test('Tencent SMTP receipt loss after DATA remains unknown, with no protocol retry', async () => {
  const f = fixture({ smtpError: { command: 'CONN', code: 'ECONNECTION', message: 'synthetic-secret' } });
  const result = await f.adapter.callTencent('tencent_mail_send', { to: ['to@example.test'], subject: 'Subject', text: 'Body' }, config, 'synthetic-secret', context());
  assert.equal(result.status, 'unknown');
  assert.equal(result.code, 'send_result_unknown');
  assert.equal(f.calls.filter(([name]) => name === 'smtp-send').length, 1);
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
});

test('Tencent SMTP explicit rejection and pre-DATA failure remain failed', async () => {
  for (const opts of [{ consumeData: false }, { smtpError: { command: 'DATA', responseCode: 550 } }]) {
    const f = fixture(opts);
    const result = await f.adapter.callTencent('tencent_mail_send', { to: ['to@example.test'], subject: 'Subject', text: 'Body' }, config, 'synthetic-secret', context());
    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'send_rejected');
  }
});

test('Tencent rejects stale calls, invalid identities and implicit send before connecting', async () => {
  const f = fixture();
  for (const [args, cfg, ctx] of [
    [{ source: { ...source, connectionId: 'other' } }, config, context()],
    [{}, { ...config, mailboxType: 'custom' as 'qq' }, context()],
    [{}, config, { ...context(), isCurrent: () => false }],
  ] as const) {
    const result = await f.adapter.callTencent('tencent_mail_read', args, cfg, 'synthetic-secret', ctx);
    assert.equal(result.status, 'failed');
  }
  const sent = await f.adapter.callTencent('tencent_mail_send', { to: ['to@example.test'], subject: 'Subject', text: 'Body' }, config, 'synthetic-secret', { ...context(), operationId: undefined });
  assert.equal(sent.code, 'operation_required');
  assert.equal(f.calls.length, 0);
});

test('Tencent IMAP reading is bounded and SMTP capability must authenticate independently', async () => {
  const f = fixture({ loginError: true });
  const verified = await f.adapter.verifyTencent({ ...config, mailboxType: 'exmail' }, 'synthetic-secret', context().signal);
  assert.equal(verified.status, 'verified');
  assert.deepEqual(verified.capabilities, { read: true, send: false, remoteDrafts: false });
  assert.equal((verified.tools as Array<{ write: boolean }>).some(tool => tool.write), false);
  const smtp = f.calls.find(([name]) => name === 'smtp-options')?.[1] as Record<string, unknown>;
  assert.equal(smtp.host, 'smtp.exmail.qq.com');
  assert.equal(smtp.port, 465);
  assert.deepEqual(smtp.tls, { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: 'smtp.exmail.qq.com' });
  const read = await f.adapter.callTencent('tencent_mail_read', { source, offset: 1, maxChars: 2 }, config, 'synthetic-secret', context());
  assert.equal(read.status, 'ok');
  assert.equal(read.text, 'od');
  assert.deepEqual(read.readRange, { rawBytes: 14, maxRawBytes: 5 * 1024 * 1024, offset: 1, chars: 2, totalChars: 4, nextOffset: 3 });
  const fetch = f.calls.filter(([name]) => name === 'fetch').at(-1)?.[1] as { query: Record<string, unknown> };
  assert.deepEqual(fetch.query.source, { start: 0, maxLength: 5 * 1024 * 1024 + 1 });
});

test('Tencent cancellation closes an in-flight client and binding changes prevent SMTP dispatch', async () => {
  const controller = new AbortController();
  const f = fixture({ pendingConnect: true });
  const pending = f.adapter.callTencent('tencent_mail_read', { source }, config, 'synthetic-secret', { ...context(), signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  assert.equal((await pending).code, 'cancelled');
  assert.equal(f.closes().imap, 1);
  let current = true;
  const stale = fixture({ composeHook: () => { current = false; } });
  const result = await stale.adapter.callTencent('tencent_mail_send', { to: ['to@example.test'], subject: 'Subject', text: 'Body' }, config, 'synthetic-secret', { ...context(), isCurrent: () => current });
  assert.equal(result.code, 'connection_changed');
  assert.equal(stale.calls.some(([name]) => name.startsWith('smtp')), false);
});

test('Tencent revoked binding while waiting for SMTP DATA submits zero MIME bytes before abort arrives', async () => {
  const f = fixture({ holdData: true });
  const controller = new AbortController();
  let current = true;
  const pending = f.adapter.callTencent('tencent_mail_send', { to: ['to@example.test'], subject: 'Subject', text: 'Body' }, config, 'synthetic-secret', { ...context(), signal: controller.signal, isCurrent: () => current });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(([name]) => name === 'smtp-send').length, 1);
  assert.equal(f.submittedBytes(), 0);
  current = false;
  assert.equal(controller.signal.aborted, false);
  f.resumeData();
  const result = await pending;
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'connection_changed');
  assert.equal(f.submittedBytes(), 0);
  assert.equal(f.calls.filter(([name]) => name === 'smtp-send').length, 1);
  assert.equal(f.closes().smtp, 1);
});

test('Tencent attachment overflow, forged parts and URL/file attachments are rejected safely', async () => {
  const f = fixture();
  const overflow = await f.adapter.callTencent('tencent_mail_attachment', { source, part: '2', maxBytes: 3 }, config, 'synthetic-secret', context());
  assert.equal(overflow.code, 'attachment_too_large');
  const missing = await f.adapter.callTencent('tencent_mail_attachment', { source, part: '3' }, config, 'synthetic-secret', context());
  assert.equal(missing.code, 'attachment_not_found');
  assert.equal(f.calls.filter(([name]) => name === 'download').length, 1);
  const malicious = fixture();
  for (const args of [
    { to: ['to@example.test'], subject: 'Subject\r\nBcc: extra@example.test', text: 'Body' },
    { to: ['to@example.test'], subject: 'Subject', text: 'Body', attachments: [{ filename: 'a', path: 'https://example.test/secret' }] },
    { to: ['to@example.test'], subject: 'Subject', text: 'Body', attachments: [{ filename: 'a', contentBase64: '!!!!' }] },
  ]) assert.equal((await malicious.adapter.callTencent('tencent_mail_send', args, config, 'synthetic-secret', context())).status, 'failed');
  assert.equal(malicious.calls.length, 0);
});

test('Tencent no failed authentication or resource close is presented as fully verified', async () => {
  const failed = fixture({ connectError: true });
  const result = await failed.adapter.verifyTencent(config, 'synthetic-secret', context().signal);
  assert.equal(result.status, 'failed');
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
  const closing = fixture({ closeError: true });
  const unknown = await closing.adapter.verifyTencent(config, 'synthetic-secret', context().signal);
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.cleanup, 'failed');
});

test('Tencent Host cleanup retains exact failed resources and retries only explicit failed cleanup', async () => {
  const f = fixture({ closeError: true });
  let cleanup: ((options: { retryFailed?: boolean }) => Promise<void>) | undefined;
  const result = await f.adapter.callTencent('tencent_mail_read', { source }, config, 'synthetic-secret', { ...context(), registerCleanup: action => { cleanup = action; } });
  assert.equal(result.status, 'ok');
  assert.equal(result.cleanup, 'failed');
  assert.equal(f.closes().imap, 1);
  assert.ok(cleanup);
  await assert.rejects(cleanup({}), /cleanup_failed/);
  assert.equal(f.closes().imap, 1);
  await assert.rejects(cleanup({ retryFailed: true }), /cleanup_failed/);
  assert.equal(f.closes().imap, 2);
});

test('Tencent real Nodemailer TLS submits once and distinguishes SMTP rejection from lost DATA receipt', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'optracall-mail-tls-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
    const key = await readFile(path.join(directory, 'key.pem')); const cert = await readFile(path.join(directory, 'cert.pem'));
    for (const scenario of ['accepted', 'lost', 'pre-data', 'rejected', 'untrusted-certificate', 'revoked-before-354'] as const) {
      const sockets = new Set<TLSSocket>(); const transactions: string[] = []; let submissions = 0; let current = true; let dataCommands = 0; let receivedDataBytes = 0;
      const server = createServer({ key, cert }, socket => {
        sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); socket.setEncoding('utf8');
        let buffer = ''; let body: string[] | undefined;
        socket.write('220 localhost synthetic SMTP\r\n');
        socket.on('data', chunk => {
          if (body) receivedDataBytes += Buffer.byteLength(chunk);
          buffer += chunk;
          for (let index = buffer.indexOf('\r\n'); index >= 0; index = buffer.indexOf('\r\n')) {
            const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
            if (body) {
              if (line !== '.') { body.push(line); continue; }
              submissions++; transactions.push(body.join('\r\n')); body = undefined;
              if (scenario === 'lost') socket.destroy();
              else socket.write(scenario === 'rejected' ? '550 synthetic DATA rejected\r\n' : '250 queued synthetic\r\n');
            } else if (/^EHLO /.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
            else if (/^AUTH PLAIN/.test(line)) socket.write('235 synthetic authenticated\r\n');
            else if (/^(?:MAIL FROM|RCPT TO):/.test(line)) socket.write('250 synthetic accepted\r\n');
            else if (line === 'DATA') {
              dataCommands++;
              if (scenario === 'pre-data') socket.write('550 synthetic DATA unavailable\r\n');
              else { body = []; if (scenario === 'revoked-before-354') current = false; socket.write('354 send body\r\n'); }
            } else if (line === 'QUIT') socket.end('221 closing\r\n');
            else socket.write('250 synthetic OK\r\n');
          }
        });
      });
      server.on('tlsClientError', () => {});
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const port = (server.address() as { port: number }).port;
        const adapter = createTencentMailAdapter({
          imap() { throw new Error('A standalone send must not open IMAP'); },
          smtp(options) {
            return new SMTPConnection({ ...options, host: '127.0.0.1', port,
              tls: { ...(options.tls as Record<string, unknown>), servername: 'localhost', ...(scenario === 'untrusted-certificate' ? {} : { ca: cert }) },
            }) as unknown as ReturnType<TencentMailDependencies['smtp']>;
          },
          async compose(options) { return new MailComposer(options).compile().build(); },
          async parse(value) { return await simpleParser(value) as unknown as Record<string, unknown>; },
        });
        const ctx = { ...context(), isCurrent: () => current };
        const result = await adapter.callTencent('tencent_mail_send', { to: ['to@example.test'], bcc: ['private@example.test'], subject: 'TLS subject', text: 'TLS body', attachments: [{ filename: 'report.txt', contentType: 'text/plain', contentBase64: Buffer.from('attachment bytes').toString('base64') }] }, config, 'synthetic-secret', ctx);
        assert.equal(result.status, scenario === 'accepted' ? 'accepted' : scenario === 'lost' ? 'unknown' : 'failed', scenario);
        assert.equal(submissions, scenario === 'pre-data' || scenario === 'untrusted-certificate' || scenario === 'revoked-before-354' ? 0 : 1, scenario);
        assert.equal(dataCommands, scenario === 'untrusted-certificate' ? 0 : 1, scenario);
        assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
        if (scenario === 'revoked-before-354') {
          assert.equal(result.code, 'connection_changed');
          assert.equal(ctx.signal.aborted, false);
          assert.equal(receivedDataBytes, 0);
        }
        if (scenario === 'accepted') {
          const parsed = await simpleParser(transactions[0]);
          assert.equal(parsed.subject, 'TLS subject');
          assert.equal(parsed.text?.trim(), 'TLS body');
          assert.equal(parsed.attachments[0].content.toString(), 'attachment bytes');
          assert.equal(parsed.bcc, undefined);
        }
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Tencent real ImapFlow uses EXAMINE and BODY.PEEK and retains folder UID identity', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'optracall-imap-tls-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
    const key = await readFile(path.join(directory, 'key.pem')); const cert = await readFile(path.join(directory, 'cert.pem'));
    const sockets = new Set<TLSSocket>(); const commands: string[] = [];
    const raw = Buffer.from('From: author@example.test\r\nTo: synthetic@qq.com\r\nSubject: Synthetic subject\r\nMessage-ID: <original@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBody\r\n');
    const server = createServer({ key, cert }, socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); socket.setEncoding('utf8');
      let buffer = ''; let authenticateTag: string | undefined;
      socket.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] synthetic IMAP ready\r\n');
      socket.on('data', chunk => {
        buffer += chunk;
        for (let index = buffer.indexOf('\r\n'); index >= 0; index = buffer.indexOf('\r\n')) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          if (authenticateTag) { socket.write(authenticateTag + ' OK authenticated\r\n'); authenticateTag = undefined; continue; }
          const [tag, command, ...args] = line.split(' ');
          commands.push(command === 'AUTHENTICATE' ? 'AUTHENTICATE' : [command, ...args].join(' '));
          if (command === 'CAPABILITY') socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n' + tag + ' OK capability\r\n');
          else if (command === 'AUTHENTICATE') { authenticateTag = tag; socket.write('+ \r\n'); }
          else if (command === 'LIST' || command === 'LSUB') socket.write('* ' + command + ' (\\HasNoChildren) "/" "INBOX"\r\n' + tag + ' OK folders\r\n');
          else if (command === 'EXAMINE') socket.write('* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 23] stable\r\n* OK [UIDNEXT 701] next\r\n' + tag + ' OK [READ-ONLY] examined\r\n');
          else if (command === 'UID' && args[0] === 'SEARCH') socket.write('* SEARCH 700\r\n' + tag + ' OK searched\r\n');
          else if (command === 'UID' && args[0] === 'FETCH') {
            if (line.includes('BODY.PEEK[]')) {
              socket.write('* 1 FETCH (UID 700 BODY[]<0> {' + raw.length + '}\r\n'); socket.write(raw); socket.write(')\r\n' + tag + ' OK fetched\r\n');
            } else socket.write('* 1 FETCH (UID 700 FLAGS (\\Seen) RFC822.SIZE ' + raw.length + ' ENVELOPE ("Fri, 27 Nov 2026 09:00:00 +0000" "Synthetic subject" (("Author" NIL "author" "example.test")) NIL NIL ((NIL NIL "synthetic" "qq.com")) NIL NIL NIL "<original@example.test>") BODYSTRUCTURE ("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 6 1 NIL NIL NIL NIL))\r\n' + tag + ' OK fetched\r\n');
          } else if (command === 'LOGOUT') socket.end('* BYE closing\r\n' + tag + ' OK logout\r\n');
          else socket.write(tag + ' BAD unsupported command\r\n');
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const adapter = createTencentMailAdapter({
        imap(options) { return new ImapFlow({ ...options, host: '127.0.0.1', port, tls: { ...(options.tls as Record<string, unknown>), ca: cert, servername: 'localhost' } } as ConstructorParameters<typeof ImapFlow>[0]) as unknown as ReturnType<TencentMailDependencies['imap']>; },
        smtp() { throw new Error('Read must not open SMTP'); },
        async compose() { throw new Error('Read must not compose outgoing mail'); },
        async parse(value) { return await simpleParser(value) as unknown as Record<string, unknown>; },
      });
      const read = await adapter.callTencent('tencent_mail_read', { source }, config, 'synthetic-secret', context());
      assert.equal(read.status, 'ok', JSON.stringify({ read, commands }));
      assert.equal(String(read.text).trim(), 'Body');
      assert.deepEqual(read.source, source);
      assert.deepEqual(read.flags, ['\\Seen']);
      assert.equal(commands.some(command => command.startsWith('EXAMINE ')), true);
      assert.equal(commands.some(command => command.includes('BODY.PEEK[]')), true);
      assert.equal(commands.some(command => /^(?:SELECT|STORE|APPEND)\b/.test(command) || command.includes('BODY[]')), false);
      const search = await adapter.callTencent('tencent_mail_search', { folder: 'INBOX', text: 'Body' }, config, 'synthetic-secret', context());
      assert.equal(search.status, 'ok', JSON.stringify({ search, commands }));
      assert.deepEqual((search.messages as Array<{ source: unknown }>)[0].source, source);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
