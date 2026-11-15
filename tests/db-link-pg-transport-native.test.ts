import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { constants as cryptoConstants } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';
import { Client, type ClientConfig } from 'pg';
import { createDbLinkPgStream } from '../src/host/db-link-pg-transport.ts';

const configurationPath = process.env.OPTRACALL_DB_PG_V04_CONFIG;
const skip = !configurationPath && 'requires the explicitly started private PostgreSQL v0.4 synthetic fixture';
async function settings(): Promise<ClientConfig> {
  const configuration = JSON.parse(await readFile(configurationPath!, 'utf8'));
  assert.equal(configuration.fixture.syntheticOnly, true); assert.equal(configuration.fixture.source.version, '180001');
  return configuration.connection;
}
function boundedClient(configuration: ClientConfig, limit: number, identity?: (valid: boolean) => void) {
  const transport = createDbLinkPgStream(limit), ssl = configuration.ssl as Exclude<ClientConfig['ssl'], boolean | undefined>;
  const client = new Client({ ...configuration, stream: () => transport, ssl: { ...ssl, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', secureOptions: cryptoConstants.SSL_OP_NO_COMPRESSION,
    checkServerIdentity(host, certificate) { const error = checkServerIdentity(host, certificate); identity?.(!error); return error; } },
    application_name: 'oc_pg_v04_transport_native', options: '-c statement_timeout=2000 -c transaction_timeout=3000 -c client_min_messages=ERROR' });
  client.on('error', () => {}); return { client, transport };
}

test('private PG: official pg public stream factory retains TLS certificate validation and exact normal output', { skip }, async () => {
  const identities: boolean[] = [], { client, transport } = boundedClient(await settings(), 65536, valid => identities.push(valid));
  try {
    await client.connect(); const result = await client.query({ text: 'SELECT $1::bigint AS exact', values: ['9007199254740993'], types: { getTypeParser: () => (value: string) => value } });
    assert.equal(result.rows[0].exact, '9007199254740993'); assert.deepEqual(identities, [true]); assert.equal(transport.facts.rejected, false);
  } finally { await client.end().catch(() => {}); await transport.completion; }
  assert.equal(transport.facts.closed, true); assert.ok(transport.facts.forwardedBytes <= 65536);
});

for (const kind of ['DataRow', 'ErrorResponse', 'INFO'] as const) test(`private PG: oversized ${kind} is cut before official field/message decoding`, { skip }, async () => {
  const { client, transport } = boundedClient(await settings(), 65536); let parserCalls = 0, notices = 0;
  client.on('notice', () => { notices++; });
  try {
    await client.connect();
    const sql = kind === 'DataRow' ? "SELECT repeat('r',1048576) AS huge" : kind === 'ErrorResponse' ? "SELECT repeat('x',1048576)::integer" : "DO $$ BEGIN RAISE INFO '%', repeat('n',1048576); END $$";
    await assert.rejects(client.query({ text: sql, types: { getTypeParser: () => (value: string) => { parserCalls++; return value; } } }), error => error instanceof Error && 'code' in error && error.code === 'db_receive_budget_exhausted' && error.message.length < 256);
  } finally { await client.end().catch(() => {}); await transport.completion; }
  assert.equal(parserCalls, 0); assert.equal(notices, 0);
  assert.equal(transport.facts.rejected, true); assert.equal(transport.facts.closed, true);
  assert.ok(transport.facts.forwardedBytes <= 65536); assert.ok(transport.facts.receivedBytes <= 65536 + 16384); assert.ok(transport.facts.maxReadBytes <= 16384);
});

test('private PG: untrusted CA and hostname mismatch reject before any query or field parser', { skip }, async () => {
  const configuration = await settings();
  for (const kind of ['ca', 'hostname'] as const) {
    const ssl = configuration.ssl as Exclude<ClientConfig['ssl'], boolean | undefined>, identities: boolean[] = [];
    const changed: ClientConfig = kind === 'ca' ? { ...configuration, ssl: { ...ssl, ca: undefined } } : { ...configuration, host: '127.0.0.1' };
    const { client, transport } = boundedClient(changed, 65536, valid => identities.push(valid)); let connected = false;
    try { await assert.rejects(client.connect().then(() => { connected = true; })); }
    finally { await client.end().catch(() => {}); await transport.completion; }
    assert.equal(connected, false); assert.equal(transport.facts.rejected, false, 'PKI refusal must not be explained by receive-budget exhaustion');
    assert.deepEqual(identities, kind === 'hostname' ? [false] : [], 'wrong CA fails before hostname verification; mismatch returns standard verifier error');
    assert.equal(transport.facts.closed, true);
  }
});
