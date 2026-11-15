import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { createDbLinkDriver } from '../src/host/db-link-driver.ts';
import type { DbLinkColumn } from '../src/host/db-link-driver.ts';

const configPath = process.env.OPTRACALL_DB_PG_V05_CONFIG ?? process.env.OPTRACALL_DB_PG_V04_CONFIG;
test('private PG: comment prefixes are bounded before decoding, with exact length and explicit partial coverage', { skip: !configPath && 'requires the explicitly managed synthetic PostgreSQL fixture' }, async () => {
  const config = JSON.parse(await readFile(configPath!, 'utf8'));
  assert.equal(config.fixture.syntheticOnly, true);
  const admin = new Client(config.admin); await admin.connect();
  try {
    await admin.query('CREATE TABLE synthetic.v04_comments (empty text, exact text, over text, emoji text, absent text)');
    await admin.query('GRANT SELECT ON synthetic.v04_comments TO oc_reader');
    const comments = { empty: '', exact: 'a'.repeat(256), over: 'a'.repeat(257), emoji: '🧪'.repeat(262145) };
    for (const [column, value] of Object.entries(comments)) await admin.query(`COMMENT ON COLUMN synthetic.v04_comments.${column} IS '${value}'`);
    await admin.query(`COMMENT ON TABLE synthetic.v04_comments IS '${'é'.repeat(524289)}'`);
    const runtime = structuredClone(config.runtime); runtime.budget.maxBytes = 1024 * 1024 * 1024; runtime.budget.maxCellBytes = 1024;
    const catalog = await createDbLinkDriver().catalog(runtime);
    assert.equal(catalog.observation.reachable, true);
    const table = catalog.objects.find(value => value.object === 'synthetic.v04_comments'); assert.ok(table);
    assert.equal(table.comment, 'é'.repeat(256)); assert.equal(table.commentTruncated, true); assert.equal(table.commentBytes, 1048578);
    assert.equal(catalog.completeness, 'partial'); assert.ok(catalog.limitations.includes('db_metadata_comment_truncated'));
    for (const [column, value] of Object.entries(comments)) {
      const actual: DbLinkColumn = table.columns.find(item => item.name === column)!;
      // PostgreSQL COMMENT ... IS '' removes the comment, just like IS NULL.
      assert.equal(actual.comment, value === '' ? null : [...value].slice(0, 256).join(''));
      assert.equal(actual.commentTruncated, [...value].length > 256);
      assert.equal(actual.commentBytes, value === '' ? null : Buffer.byteLength(value)); assert.ok(Buffer.byteLength(actual.comment ?? '') <= 1024);
    }
    const absent = table.columns.find(item => item.name === 'absent')!;
    assert.equal(absent.comment, null); assert.equal(absent.commentBytes, null); assert.equal(absent.commentTruncated, false);
    assert.deepEqual(catalog.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
  } finally { await admin.query('DROP TABLE IF EXISTS synthetic.v04_comments'); await admin.end(); }
});
