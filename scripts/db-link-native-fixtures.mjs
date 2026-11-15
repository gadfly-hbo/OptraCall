import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, connect as connectSocket } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile, chmod, open, rm, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import mysql from 'mysql2';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));
const defaultRoot = path.join(repository, '.local/db-link/native-fixtures');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitPort(port, child) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (child.exitCode !== null) throw new Error(`fixture_server_exited:${child.exitCode}`);
    const listening = await new Promise(resolve => {
      const socket = connectSocket({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
    });
    if (listening) return;
    await delay(50);
  }
  throw new Error('fixture_start_timeout');
}

export async function checkNativeFixtures(root = defaultRoot) {
  const pgBin = path.join(root, 'pgsql-18.1/bin');
  const mysqlBase = path.join(root, 'mysql-8.4.0-macos14-arm64');
  await access(path.join(pgBin, 'postgres')); await access(path.join(mysqlBase, 'bin/mysqld'));
  const postgres = (await exec(path.join(pgBin, 'postgres'), ['--version'])).stdout.trim();
  const my = (await exec(path.join(mysqlBase, 'bin/mysqld'), ['--no-defaults', '--version'])).stdout.trim();
  if (!postgres.endsWith('18.1') || !my.includes('Ver 8.4.0 ')) throw new Error('fixture_version_mismatch');
  const packages = {};
  for (const name of ['pg', 'pg-cursor', 'mysql2', 'node-sql-parser']) {
    packages[name] = JSON.parse(await readFile(path.join(repository, 'node_modules', name, 'package.json'), 'utf8')).version;
  }
  if (packages.pg !== '8.23.1' || packages['pg-cursor'] !== '2.22.1' || packages.mysql2 !== '3.24.6' || packages['node-sql-parser'] !== '5.4.0') throw new Error('fixture_driver_tuple_mismatch');
  return { pgBin, mysqlBase, postgres, mysql: my, packages,
    postgresSource: JSON.parse(await readFile(path.join(root, 'downloads/postgresql-source.json'), 'utf8')),
    mysqlSource: JSON.parse(await readFile(path.join(root, 'downloads/mysql-source.json'), 'utf8')) };
}

async function certificates(directory, openssl) {
  await mkdir(directory, { recursive: true });
  await exec(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,'ca.key'),'-out',path.join(directory,'ca.crt'),'-days','1','-subj','/CN=OptraCall synthetic native CA']);
  await exec(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,'untrusted.key'),'-out',path.join(directory,'untrusted.crt'),'-days','1','-subj','/CN=Untrusted synthetic CA']);
  for (const [name, dns] of [['server','localhost'],['wrong','wrong.fixture.invalid']]) {
    await writeFile(path.join(directory,`${name}.ext`), `subjectAltName=DNS:${dns}\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n`);
    await exec(openssl, ['req','-new','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,`${name}.key`),'-out',path.join(directory,`${name}.csr`),'-subj',`/CN=${dns}`]);
    await exec(openssl, ['x509','-req','-in',path.join(directory,`${name}.csr`),'-CA',path.join(directory,'ca.crt'),'-CAkey',path.join(directory,'ca.key'),'-CAcreateserial','-out',path.join(directory,`${name}.crt`),'-days','1','-extfile',path.join(directory,`${name}.ext`)]);
    await chmod(path.join(directory,`${name}.key`), 0o600);
  }
}

/** Creates only disposable synthetic databases. It never finds or controls an existing service. */
export async function startNativeFixtures(options = {}) {
  const root = options.root ?? defaultRoot, sources = await checkNativeFixtures(root);
  const directory = await mkdtemp(path.join(await mkdir(path.join(root, 'runs'), { recursive: true }).then(() => path.join(root, 'runs')), 'run-'));
  const sockets = await mkdtemp(path.join(tmpdir(), 'ocdn-')); await chmod(sockets, 0o700);
  const tls = path.join(directory, 'tls'), pgData = path.join(directory, 'postgres'), mysqlData = path.join(directory, 'mysql');
  const password = randomBytes(24).toString('hex');
  const postgresPort = await freePort(), mysqlPort = await freePort();
  const children = new Map(), ownedPids = [], stops = [];
  const ca = () => readFile(path.join(tls,'ca.crt'),'utf8');
  const budget = { connectTimeoutMs: 4000, queryTimeoutMs: 10000, lockTimeoutMs: 1000, maxRows: 2000, maxBytes: 4_000_000, maxCellBytes: 1_000_000, chunkBytes: 100_000, maxConcurrent: 1 };
  let stopped = false;

  async function stopServer(engine) {
    const child = children.get(engine); if (!child) return;
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      let stopTimer;
      const expired = new Promise(resolve => { stopTimer = setTimeout(() => resolve(false),15000); });
      const finished = await Promise.race([exited.then(() => true), expired]); clearTimeout(stopTimer);
      if (!finished) { child.kill('SIGKILL'); await exited; }
    }
    stops.push({ engine, pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode }); children.delete(engine);
  }
  async function stop() {
    if (stopped) return { stopped: true, ownedPids, stops };
    await stopServer('mysql'); await stopServer('postgresql'); stopped = true;
    await rm(sockets, { recursive: true, force: true });
    const receipt = { stopped: true, ownedPids, stops };
    await writeFile(path.join(directory,'teardown.json'),JSON.stringify(receipt,null,2)+'\n'); return receipt;
  }
  async function startServer(engine, certificate = 'server') {
    const logfile = await open(path.join(directory,`${engine}-${certificate}.log`), 'a', 0o600);
    let executable, args, port;
    if (engine === 'postgresql') {
      const config = `listen_addresses='127.0.0.1'\nport=${postgresPort}\nunix_socket_directories='${sockets}'\nssl=on\nssl_ca_file='${path.join(tls,'ca.crt')}'\nssl_cert_file='${path.join(tls,certificate+'.crt')}'\nssl_key_file='${path.join(tls,certificate+'.key')}'\ntimezone='UTC'\nshared_buffers='16MB'\nmax_connections=12\nfsync=off\nsynchronous_commit=off\nfull_page_writes=off\n`;
      await writeFile(path.join(pgData,'postgresql.conf'),config);
      executable = path.join(sources.pgBin,'postgres'); args = ['-D',pgData]; port = postgresPort;
    } else {
      executable = path.join(sources.mysqlBase,'bin/mysqld'); port = mysqlPort;
      args = ['--no-defaults',`--basedir=${sources.mysqlBase}`,`--datadir=${mysqlData}`,'--bind-address=127.0.0.1',`--port=${mysqlPort}`,`--socket=${path.join(sockets,'mysql.sock')}`,`--pid-file=${path.join(directory,'mysql.pid')}`,
        '--mysqlx=0','--skip-log-bin','--local-infile=0','--lower-case-table-names=1','--max-connections=12','--innodb-buffer-pool-size=67108864','--innodb-redo-log-capacity=33554432',
        '--require-secure-transport=ON',`--ssl-ca=${path.join(tls,'ca.crt')}`,`--ssl-cert=${path.join(tls,certificate+'.crt')}`,`--ssl-key=${path.join(tls,certificate+'.key')}`];
    }
    const child = spawn(executable,args,{ cwd: directory, stdio: ['ignore',logfile.fd,logfile.fd] });
    child.once('error', () => {}); children.set(engine,child); ownedPids.push({ engine,pid:child.pid }); await logfile.close();
    await waitPort(port,child);
  }
  async function pgAdmin(database = 'oc_native') {
    const client = new Client({ host: 'localhost', port: postgresPort, database, user: 'fixture_admin', ssl: { ca: await ca(), rejectUnauthorized: true } });
    client.on('error', () => {}); await client.connect(); return client;
  }
  async function mysqlAdmin() {
    const client = mysql.createConnection({ socketPath: path.join(sockets,'mysql.sock'), user: 'root', multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, jsonStrings: true });
    client.on('error', () => {}); await client.promise().connect(); return client.promise();
  }
  try {
    await certificates(tls, options.openssl ?? '/opt/homebrew/opt/openssl@3/bin/openssl');
    await exec(path.join(sources.pgBin,'initdb'),['-D',pgData,'--username=fixture_admin','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--locale=C']);
    await writeFile(path.join(pgData,'pg_hba.conf'), 'local all all trust\nhostssl all oc_reader 127.0.0.1/32 scram-sha-256\nhostssl all all 127.0.0.1/32 trust\nhostnossl all all 127.0.0.1/32 reject\n');
    await mkdir(mysqlData, { recursive: true });
    const init = await exec(path.join(sources.mysqlBase,'bin/mysqld'), ['--no-defaults','--initialize-insecure',`--basedir=${sources.mysqlBase}`,`--datadir=${mysqlData}`,'--lower-case-table-names=1'], { maxBuffer: 4_000_000 });
    await writeFile(path.join(directory,'mysql-initialize.log'), init.stdout+init.stderr);
    await startServer('postgresql'); await startServer('mysql');
    const pgBootstrap = await pgAdmin('postgres');
    await pgBootstrap.query('CREATE DATABASE oc_native'); await pgBootstrap.end();
    const pg = await pgAdmin();
    try {
      await pg.query('REVOKE TEMPORARY ON DATABASE oc_native FROM PUBLIC');
      await pg.query(`CREATE ROLE oc_reader LOGIN PASSWORD '${password}'`);
      await pg.query('GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO oc_reader');
      await pg.query('CREATE SCHEMA synthetic');
      await pg.query('CREATE TABLE synthetic.parents(tenant_key integer,parent_key bigint,PRIMARY KEY(tenant_key,parent_key))');
      await pg.query('CREATE TABLE synthetic.orders(tenant_id integer,parent_id bigint,amount numeric(30,12),big bigint,day date,local_ts timestamp(6),instant timestamptz(6),j json,b bytea,FOREIGN KEY(tenant_id,parent_id) REFERENCES synthetic.parents(tenant_key,parent_key))');
      await pg.query('CREATE TABLE synthetic.numbers(n integer PRIMARY KEY)');
      await pg.query('INSERT INTO synthetic.parents VALUES(7,9007199254740993)');
      await pg.query('INSERT INTO synthetic.orders VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [7,'9007199254740993','9007199254740993.123456789012','9007199254740993','2026-11-14','2026-11-14 12:34:56.123456','2026-11-14 12:34:56.123456+00','{"big":9007199254740993,"fraction":"123456789.123456789012"}',Buffer.from([0,1,254,255])]);
      await pg.query('ALTER TABLE synthetic.orders ADD COLUMN amounts numeric(30,12)[]');
      await pg.query("UPDATE synthetic.orders SET amounts=ARRAY['9007199254740993.123456789012']::numeric(30,12)[]");
      await pg.query('INSERT INTO synthetic.numbers SELECT generate_series(1,1200)');
      await pg.query('GRANT USAGE ON SCHEMA synthetic TO oc_reader');
      await pg.query('GRANT SELECT ON ALL TABLES IN SCHEMA synthetic TO oc_reader');
    } finally { await pg.end(); }
    const my = await mysqlAdmin();
    try {
      await my.query('CREATE DATABASE oc_native');
      await my.query(`CREATE USER 'oc_reader'@'localhost' IDENTIFIED BY '${password}' REQUIRE SSL`);
      await my.query('CREATE TABLE oc_native.parents(tenant_key integer,parent_key bigint,PRIMARY KEY(tenant_key,parent_key)) ENGINE=InnoDB');
      await my.query('CREATE TABLE oc_native.orders(tenant_id integer,parent_id bigint,amount decimal(30,12),big bigint,day date,local_ts datetime(6),instant timestamp(6),j json,b blob,FOREIGN KEY(tenant_id,parent_id) REFERENCES oc_native.parents(tenant_key,parent_key)) ENGINE=InnoDB');
      await my.query('CREATE TABLE oc_native.numbers(n integer PRIMARY KEY) ENGINE=InnoDB');
      await my.query('SET SESSION time_zone = \'+00:00\'');
      await my.execute('INSERT INTO oc_native.parents VALUES(?,?)',[7,'9007199254740993']);
      await my.execute('INSERT INTO oc_native.orders VALUES(?,?,?,?,?,?,?,?,?)',[7,'9007199254740993','9007199254740993.123456789012','9007199254740993','2026-11-14','2026-11-14 12:34:56.123456','2026-11-14 12:34:56.123456','{"big":9007199254740993,"fraction":"123456789.123456789012"}',Buffer.from([0,1,254,255])]);
      await my.query('INSERT INTO oc_native.numbers(n) VALUES '+Array.from({length:1200},(_,index)=>`(${index+1})`).join(','));
      for (const table of ['parents','orders','numbers']) await my.query(`GRANT SELECT ON oc_native.${table} TO 'oc_reader'@'localhost'`);
    } finally { await my.end(); }
    const common = { id: 'native-synthetic', revision: 1, fingerprint: 'synthetic-fixture-config', name: 'Isolated native synthetic fixture', host: 'localhost', database: 'oc_native', username: 'oc_reader', password,
      tls: { ca: await ca(), rejectUnauthorized: true, verifyIdentity: true }, budget };
    const configs = { postgresql: { ...common, engine: 'postgresql', port: postgresPort }, mysql: { ...common, engine: 'mysql', port: mysqlPort } };
    const receipt = { sources, directory, sockets, ports: { postgresql: postgresPort, mysql: mysqlPort }, ownedPids, data: 'synthetic only', mysqlInitialization: 'private --initialize-insecure, Unix socket administration only', productionCompatibility: 'NOT_PROVED' };
    await writeFile(path.join(directory,'fixture.json'),JSON.stringify(receipt,null,2)+'\n');
    return { configs, sources, directory, receipt, pgAdmin, mysqlAdmin, untrustedCa: await readFile(path.join(tls,'untrusted.crt'),'utf8'),
      async restartCertificate(engine, wrong) { await stopServer(engine); await startServer(engine, wrong ? 'wrong' : 'server'); }, stop };
  } catch (error) { await stop().catch(() => {}); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'check') throw new Error('Use: node scripts/db-link-native-fixtures.mjs check; native tests start and stop their own fixtures.');
  console.log(JSON.stringify(await checkNativeFixtures(), null, 2));
}
