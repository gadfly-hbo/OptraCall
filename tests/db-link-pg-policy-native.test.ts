import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client, type ClientConfig } from 'pg';
import Cursor from 'pg-cursor';
import { validateDbLinkPgQuery, type PgAdmissionTable } from '../src/host/db-link-pg-policy.ts';
import type { DbResultParameter } from '../src/host/db-link-results.ts';

const configurationPath = process.env.OPTRACALL_DB_PG_V04_CONFIG;
const skip = !configurationPath && 'requires the explicitly started private PostgreSQL v0.4 synthetic fixture';

type FixtureConfiguration = {
  connection: ClientConfig;
  runtime: { budget: { maxCellBytes: number; maxBytes: number; maxRows: number } };
  fixture: { source: { version: string }; syntheticOnly: boolean };
  truth: { exactId: string; exactAmount: string; exactCreatedAt: string; note: { pattern: string; repetitions: number; bytes: number; sha256: string }; payload: { bytes: number; modulus: number; sha256: string } };
};
async function fixture() {
  const config: FixtureConfiguration = JSON.parse(await readFile(configurationPath!, 'utf8'));
  assert.equal(config.fixture.syntheticOnly, true); assert.equal(config.fixture.source.version, '180001');
  const client = new Client({ ...config.connection, options: '-c DateStyle=ISO,YMD -c bytea_output=hex -c client_encoding=UTF8 -c extra_float_digits=3 -c search_path=pg_catalog -c statement_timeout=3000 -c transaction_timeout=5000 -c lock_timeout=300', application_name: 'oc_pg_v04_policy_native' });
  client.on('error', () => {}); await client.connect();
  const rows = (await client.query(`SELECT a.attname AS name,a.attnum AS ordinal,a.atttypid AS type_id,
    CASE WHEN a.atttypid=1700 AND a.atttypmod>=4 THEN ((a.atttypmod-4)>>16)&65535 ELSE NULL END AS precision,
    CASE WHEN a.atttypid=1700 AND a.atttypmod>=4 THEN (((a.atttypmod-4)&2047)#1024)-1024 ELSE NULL END AS scale,
    pg_catalog.has_column_privilege(a.attrelid,a.attnum,'SELECT') AS readable
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='sales' AND c.relname='orders' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`)).rows;
  const objects: PgAdmissionTable[] = [{ object: 'sales.orders', queryable: true, columns: rows.map(row => ({ name: row.name, ordinal: row.ordinal, typeId: row.type_id, precision: row.precision, scale: row.scale, readable: row.readable })) }];
  const budget = { ...config.runtime.budget, maxCellBytes: 1024, maxBytes: 4096 };
  return { config, client, objects, budget };
}
function values(parameters: DbResultParameter[]): unknown[] { return parameters.map(parameter => parameter.value); }
const types = { getTypeParser: () => (value: string) => value };

test('private PG: scalar wire output obeys admitted native types without losing numeric or microsecond precision', { skip }, async () => {
  const { config, client, objects, budget } = await fixture();
  try {
    const sql = 'SELECT id, amount, created_at FROM sales.orders WHERE id=$1', parameters: DbResultParameter[] = [{ kind: 'number', value: config.truth.exactId }];
    const admission = validateDbLinkPgQuery(sql, { objects, budget, parameters });
    const cursor = client.query(new Cursor(admission.sql, values(parameters), { rowMode: 'array', types }));
    try {
      const rows = await cursor.read(1);
      assert.deepEqual(rows[0], [config.truth.exactId, config.truth.exactAmount, config.truth.exactCreatedAt]);
      rows[0]!.forEach((value, index) => assert.ok(Buffer.byteLength(String(value)) <= admission.projections[index]!.maxWireBytes));
      assert.deepEqual(await cursor.read(1), []);
    } finally { await cursor.close(); }
    assert.equal(admission.diagnosticBounded, false, 'this native output test does not qualify all error/notice/startup paths');
  } finally { await client.end(); }
});

test('private PG: UTF8 and binary segments return only admitted final hex bytes including multibyte boundaries', { skip }, async () => {
  const { config, client, objects, budget } = await fixture();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const column of ['note', 'payload', 'document'] as const) {
      const raw = column === 'payload' ? 'payload' : column === 'note' ? "convert_to(note, 'UTF8')" : "convert_to(document::text, 'UTF8')";
      for (const start of [1, 3, 7, 127]) {
        const sql = `SELECT octet_length(${raw}) AS total_bytes, substring(${raw}, $1, $2) AS segment FROM sales.orders WHERE id=$3`;
        const parameters: DbResultParameter[] = [{ kind: 'number', value: start }, { kind: 'number', value: 128 }, { kind: 'number', value: config.truth.exactId }];
        const admission = validateDbLinkPgQuery(sql, { objects, budget, parameters });
        const cursor = client.query(new Cursor(sql, values(parameters), { rowMode: 'array', types }));
        try {
          const [row] = await cursor.read(1); assert.ok(row);
          assert.equal(Buffer.byteLength(String(row[1])), 258); assert.ok(Buffer.byteLength(String(row[1])) <= admission.projections[1]!.maxWireBytes);
          const bytes = Buffer.from(String(row[1]).slice(2), 'hex'); assert.equal(bytes.length, 128);
          if (column === 'note') {
            const truth = Buffer.from(config.truth.note.pattern.repeat(20));
            // The byte range intentionally splits UTF8 characters; compare bytes, never replacement-decoded strings.
            const expected = Buffer.from(config.truth.note.pattern.repeat(40)).subarray(start - 1, start - 1 + 128);
            assert.equal(Number(row[0]), config.truth.note.bytes); assert.deepEqual(bytes, expected); assert.ok(truth.length < config.truth.note.bytes);
          } else if (column === 'payload') {
            assert.equal(Number(row[0]), config.truth.payload.bytes);
            assert.deepEqual(bytes, Buffer.from(Array.from({ length: 128 }, (_, index) => (start - 1 + index) % config.truth.payload.modulus)));
          } else {
            assert.ok(Number(row[0]) > config.truth.note.bytes);
            const expectedPrefix = Buffer.from(`{"kind": "fixture", "value": "${config.truth.note.pattern.repeat(64)}`);
            assert.deepEqual(bytes, expectedPrefix.subarray(start - 1, start - 1 + 128));
          }
        } finally { await cursor.close(); }
      }
    }
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
});

test('private PG: finite working blocks can hash a larger original bytea value in one repeatable-read observation', { skip }, async () => {
  const { config, client, objects } = await fixture();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const hash = createHash('sha256'), blockBytes = 32768;
    for (let start = 1; start <= config.truth.payload.bytes; start += blockBytes) {
      const sql = 'SELECT substring(payload, $1, $2) AS segment FROM sales.orders WHERE id=$3';
      const parameters: DbResultParameter[] = [{ kind: 'number', value: start }, { kind: 'number', value: blockBytes }, { kind: 'number', value: config.truth.exactId }];
      const admission = validateDbLinkPgQuery(sql, { objects, parameters, budget: { maxCellBytes: 65538, maxBytes: 131072, maxRows: 1 } });
      const cursor = client.query(new Cursor(sql, values(parameters), { rowMode: 'array', types }));
      try {
        const [row] = await cursor.read(1); assert.ok(row);
        assert.ok(Buffer.byteLength(String(row[0])) <= admission.projections[0]!.maxWireBytes);
        const block = Buffer.from(String(row[0]).slice(2), 'hex'); assert.ok(block.length <= blockBytes); hash.update(block);
      } finally { await cursor.close(); }
    }
    assert.equal(hash.digest('hex'), config.truth.payload.sha256);
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
});

test('private PG: unsafe large/error-generating expressions are refused before this test dispatches a business query', { skip }, async () => {
  const { client, objects, budget } = await fixture(); let dispatched = 0;
  const execute = async (sql: string) => {
    const admission = validateDbLinkPgQuery(sql, { objects, budget, parameters: [] });
    dispatched++; return client.query(admission.sql);
  };
  try {
    for (const sql of ['SELECT note FROM sales.orders LIMIT 1', 'SELECT CAST(note AS INTEGER) FROM sales.orders', 'SELECT MIN(note) FROM sales.orders', "SELECT substring(convert_to(CAST(note AS INTEGER)::text,'UTF8'),1,16) FROM sales.orders", "SELECT set_config('statement_timeout','0',false)"]) await assert.rejects(execute(sql));
    assert.equal(dispatched, 0);
  } finally { await client.end(); }
});
