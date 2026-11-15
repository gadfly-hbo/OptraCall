// Private synthetic PostgreSQL v0.5 fixture; local + enterprise SELECT-only accounts. Does not qualify product queries or change any system service.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, connect } from 'node:net';
import { mkdir, mkdtemp, writeFile, readFile, chmod, open } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const exec = promisify(execFile), repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pgBin = path.join(repo, '.local/db-link/native-fixtures/pgsql-18.1/bin');
const openssl = '/opt/homebrew/opt/openssl@3/bin/openssl';
const evidence = path.join(repo, '.local/db-link/pg-v05-fixture');
const environment = { PATH: '/opt/homebrew/bin:/usr/bin:/bin', LANG: 'C', TZ: 'UTC' };
const expectedPostgresSha256 = '1e733e9107af5f2b08329a8038ff9764811f9bb14fac637d06356d869f44264f';
const sha = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, closed, port, directory, stopping;
const lines = createInterface({ input: process.stdin });
const stopRequested = new Promise(resolve => { lines.on('line', line => { if (line.trim() === 'stop' || line.includes('"command":"stop"')) resolve(); }); lines.once('close', resolve); });
async function portOpen() { return new Promise(resolve => { const socket = connect({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => { socket.destroy(); resolve(false); }); }); }
async function freePort() { const server = createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }
async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    if (!child) return;
    const requestedAt = new Date().toISOString(), sent = child.exitCode === null && child.signalCode === null ? child.kill('SIGINT') : false;
    const result = await Promise.race([closed, delay(5000).then(() => null)]);
    let terminal = result, escalated = false;
    if (!terminal) { escalated = child.kill('SIGKILL'); terminal = await closed; }
    await writeFile(path.join(directory, 'teardown.json'), JSON.stringify({ requestedAt, ownPostgresPid: child.pid, sent, escalated, terminal, port, portClosed: !(await portOpen()), syntheticOnly: true }, null, 2) + '\n', { mode: 0o600 });
  })();
  return stopping;
}
process.once('SIGTERM', () => { stop().finally(() => process.exit(0)); });
process.once('SIGINT', () => { stop().finally(() => process.exit(0)); });
try {
  if (sha(await readFile(path.join(pgBin, 'postgres'))) !== expectedPostgresSha256) throw new Error('fixture_postgres_identity_mismatch');
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  directory = await mkdtemp(path.join(evidence, 'run-')); await chmod(directory, 0o700);
  const sockets = await mkdtemp('/tmp/oc-pgv05-'); await chmod(sockets, 0o700);
  const tls = path.join(directory, 'tls'), data = path.join(directory, 'data'); await mkdir(tls, { mode: 0o700 }); port = await freePort();
  await exec(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tls, 'ca.key'), '-out', path.join(tls, 'ca.crt'), '-days', '2', '-subj', '/CN=OptraCall v05 synthetic CA'], { env: environment });
  await exec(openssl, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tls, 'server.key'), '-out', path.join(tls, 'server.csr'), '-subj', '/CN=localhost'], { env: environment });
  await writeFile(path.join(tls, 'server.ext'), 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n', { mode: 0o600 });
  await exec(openssl, ['x509', '-req', '-in', path.join(tls, 'server.csr'), '-CA', path.join(tls, 'ca.crt'), '-CAkey', path.join(tls, 'ca.key'), '-CAcreateserial', '-out', path.join(tls, 'server.crt'), '-days', '2', '-extfile', path.join(tls, 'server.ext')], { env: environment });
  for (const name of ['server.key', 'ca.key']) await chmod(path.join(tls, name), 0o600);
  const ca = await readFile(path.join(tls, 'ca.crt'), 'utf8');
  await exec(path.join(pgBin, 'initdb'), ['-D', data, '--username=fixture_admin', '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--locale=C'], { env: environment });
  await writeFile(path.join(data, 'postgresql.conf'), `listen_addresses='127.0.0.1'\nport=${port}\nunix_socket_directories='${sockets}'\nssl=on\nssl_cert_file='${path.join(tls, 'server.crt')}'\nssl_key_file='${path.join(tls, 'server.key')}'\ntimezone='UTC'\nshared_buffers='16MB'\nmax_connections=20\nfsync=off\nsynchronous_commit=off\nfull_page_writes=off\nlog_line_prefix='%m [%p] %a '\nlog_connections=on\nlog_disconnections=on\n`, { mode: 0o600 });
  await writeFile(path.join(data, 'pg_hba.conf'), 'local all fixture_admin trust\nhostssl oc_pg_v05 oc_reader,oc_analyst_a,oc_analyst_b,oc_viewer 127.0.0.1/32 scram-sha-256\nhostnossl all all 127.0.0.1/32 reject\n', { mode: 0o600 });
  const log = await open(path.join(directory, 'postgres.log'), 'a', 0o600);
  child = spawn(path.join(pgBin, 'postgres'), ['-D', data], { cwd: directory, env: environment, stdio: ['ignore', log.fd, log.fd] }); await log.close();
  closed = new Promise((resolve, reject) => { child.once('close', (code, signal) => resolve({ code, signal, at: new Date().toISOString() })); child.once('error', reject); });
  let ready = false;
  const startupDeadline = Date.now() + 10000;
  while (Date.now() < startupDeadline) {
    if (child.exitCode !== null) throw new Error('fixture_postgres_exited');
    // A listening socket can still return FATAL while PostgreSQL starts up.
    // Use the official readiness probe before the fixture setup connection.
    try {
      await exec(path.join(pgBin, 'pg_isready'), ['-h', sockets, '-p', String(port), '-U', 'fixture_admin', '-d', 'postgres', '-t', '1'], { env: environment, timeout: 1500 });
      ready = true; break;
    } catch { await delay(25); }
  }
  if (!ready) throw new Error('fixture_postgres_not_ready');
  const adminBase = { host: sockets, port, user: 'fixture_admin', database: 'postgres' }, admin = new Client(adminBase); await admin.connect();
  try { await admin.query('CREATE DATABASE oc_pg_v05'); } finally { await admin.end(); }
  const password = randomBytes(24).toString('hex'), setup = new Client({ ...adminBase, database: 'oc_pg_v05' }); await setup.connect();
  const repetitions = 262145, note = 'Aé🧪'.repeat(repetitions), payload = Buffer.alloc(1024 * 1024 + 3);
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
  try {
    await setup.query('REVOKE TEMPORARY ON DATABASE oc_pg_v05 FROM PUBLIC'); await setup.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await setup.query(`CREATE ROLE oc_reader LOGIN PASSWORD '${password}'`); await setup.query('ALTER ROLE oc_reader SET default_transaction_read_only=on');
    await setup.query('CREATE SCHEMA sales');
    await setup.query('CREATE TABLE sales.orders(id bigint PRIMARY KEY, amount numeric(30,12), note text, payload bytea, document jsonb, status text, created_at timestamptz)');
    await setup.query('INSERT INTO sales.orders VALUES($1,$2,$3,$4,$5,$6,$7)', ['9007199254740993', '9007199254740993.123456789012', note, payload, JSON.stringify({ kind: 'fixture', value: note }), 'paid', '2026-11-14 12:34:56.123456+00']);
    await setup.query("INSERT INTO sales.orders VALUES(2,0,NULL,''::bytea,'null'::jsonb,'refunded','2026-01-01 00:00:00+00')");
    await setup.query('CREATE SCHEMA synthetic'); await setup.query('CREATE TABLE synthetic.numbers(n integer PRIMARY KEY)'); await setup.query('INSERT INTO synthetic.numbers SELECT generate_series(1,128)');
    await setup.query('GRANT USAGE ON SCHEMA sales,synthetic TO oc_reader'); await setup.query('GRANT SELECT ON sales.orders,synthetic.numbers TO oc_reader');
    // The test subjects have SELECT only. The private fixture administrator
    // creates enterprise data and policies; no product code changes grants.
    await setup.query('REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC');
    for (const role of ['oc_analyst_a', 'oc_analyst_b', 'oc_viewer']) {
      await setup.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
      await setup.query(`ALTER ROLE ${role} SET default_transaction_read_only=on`);
    }
    await setup.query('CREATE SCHEMA enterprise');
    await setup.query('CREATE TABLE enterprise.raw_orders(tenant text NOT NULL,id bigint PRIMARY KEY,amount numeric(30,12) NOT NULL,note text)');
    await setup.query("INSERT INTO enterprise.raw_orders VALUES('A',101,120.25,'department A'),('A',102,79.75,'department A'),('B',201,300.125,'department B')");
    await setup.query('ALTER TABLE enterprise.raw_orders ENABLE ROW LEVEL SECURITY');
    await setup.query("CREATE POLICY analyst_scope ON enterprise.raw_orders FOR SELECT USING (tenant = CASE current_user WHEN 'oc_analyst_a' THEN 'A' WHEN 'oc_analyst_b' THEN 'B' ELSE '' END)");
    await setup.query("CREATE VIEW enterprise.a_orders AS SELECT id,amount,note FROM enterprise.raw_orders WHERE tenant='A'");
    await setup.query('CREATE VIEW enterprise.invoker_orders WITH(security_invoker=true) AS SELECT tenant,id,amount FROM enterprise.raw_orders');
    await setup.query('GRANT USAGE ON SCHEMA enterprise TO oc_analyst_a,oc_analyst_b,oc_viewer');
    await setup.query('GRANT SELECT ON enterprise.raw_orders,enterprise.invoker_orders TO oc_analyst_a,oc_analyst_b');
    await setup.query('GRANT SELECT ON enterprise.a_orders,enterprise.invoker_orders TO oc_viewer');
  } finally { await setup.end(); }
  const connection = { host: 'localhost', port, user: 'oc_reader', password, database: 'oc_pg_v05', ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 2500 };
  const reader = new Client({ ...adminBase, database: 'oc_pg_v05' }); reader.on('error', () => {}); await reader.connect();
  let source;
  try { source = (await reader.query('SELECT current_setting(\'server_version_num\') AS version,(pg_catalog.pg_control_system()).system_identifier::text AS system_id,pg_catalog.pg_postmaster_start_time()::text AS postmaster_start')).rows[0]; }
  finally { await reader.end(); }
  if (source.version !== '180001') throw new Error('fixture_postgres_version_mismatch');
  const runtime = { id: 'pg-v05-synthetic', revision: 1, fingerprint: sha(`${directory}:${port}`), name: 'PG v0.5 synthetic only', engine: 'postgresql', host: 'localhost', port, database: 'oc_pg_v05', username: 'oc_reader', password, tls: { ca, rejectUnauthorized: true, verifyIdentity: true }, budget: { connectTimeoutMs: 2500, queryTimeoutMs: 5000, lockTimeoutMs: 500, maxRows: 10000, maxBytes: 16 * 1024 * 1024, maxCellBytes: 16384, chunkBytes: 64 * 1024, maxConcurrent: 4 } };
  const configPath = path.join(directory, 'config.json');
  const subjects = Object.fromEntries(['oc_analyst_a', 'oc_analyst_b', 'oc_viewer'].map(user => [user, {
    runtime: { ...structuredClone(runtime), id: `pg-v05-${user}`, name: `PG v0.5 ${user} synthetic`, username: user, fingerprint: sha(`${directory}:${port}:${user}`) },
    connection: { ...connection, user },
  }]));
  await writeFile(configPath, JSON.stringify({ runtime, connection, subjects, admin: { ...adminBase, database: 'oc_pg_v05' }, fixture: { directory, sockets, port, postgresPid: child.pid, postgresSha256: expectedPostgresSha256, source, environment, syntheticOnly: true }, truth: { enterprise: { aIds: ['101', '102'], bIds: ['201'], aTotal: '200.000000000000', bTotal: '300.125000000000' }, exactId: '9007199254740993', exactAmount: '9007199254740993.123456789012', exactCreatedAt: '2026-11-14 12:34:56.123456+00', note: { pattern: 'Aé🧪', repetitions, bytes: Buffer.byteLength(note), sha256: sha(Buffer.from(note)) }, payload: { bytes: payload.length, modulus: 251, sha256: sha(payload) } } }, null, 2) + '\n', { mode: 0o600 });
  await writeFile(path.join(directory, 'provenance.json'), JSON.stringify({ at: new Date().toISOString(), controllerSha256: sha(await readFile(fileURLToPath(import.meta.url))), postgresSha256: expectedPostgresSha256, source, port, pid: child.pid, caSha256: sha(ca), environment, syntheticOnly: true }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ configPath, port, pid: child.pid }));
  await stopRequested;
} catch (error) { console.error(error instanceof Error ? error.message : 'fixture_setup_failed'); process.exitCode = 1; }
finally { await stop(); lines.close(); process.stdin.pause(); }
