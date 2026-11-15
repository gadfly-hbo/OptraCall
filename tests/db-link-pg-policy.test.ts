import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateDbLinkPgQuery, type PgAdmissionTable } from '../src/host/db-link-pg-policy.ts';

const objects: PgAdmissionTable[] = [{ object: 'sales.orders', queryable: true, columns: [
  { name: 'id', ordinal: 1, typeId: 20, precision: null, scale: null, readable: true },
  { name: 'amount', ordinal: 2, typeId: 1700, precision: 18, scale: 2, readable: true },
  { name: 'note', ordinal: 3, typeId: 25, precision: null, scale: null, readable: true },
  { name: 'payload', ordinal: 4, typeId: 17, precision: null, scale: null, readable: true },
  { name: 'document', ordinal: 5, typeId: 3802, precision: null, scale: null, readable: true },
  { name: 'unbounded_amount', ordinal: 6, typeId: 1700, precision: null, scale: null, readable: true },
] }];
const budget = { maxCellBytes: 1024, maxBytes: 4096, maxRows: 100 };

test('a large operation total never enlarges the independent response working batch', () => {
  const largeBudget = { maxCellBytes: 1024 * 1024, maxBytes: 1024 * 1024 * 1024, maxRows: 10000 };
  assert.throws(() => validateDbLinkPgQuery('SELECT substring(payload,1,140000) FROM sales.orders', { objects, budget: largeBudget, parameters: [] }), /组合|工作|批次/);
  const result = validateDbLinkPgQuery('SELECT substring(payload,1,16000) FROM sales.orders', { objects, budget: largeBudget, parameters: [] });
  assert.ok(result.batchRows * result.maxRowWireBytes <= 256 * 1024);
});

test('PG admission preserves exact SQL and computes final message bounds from actual column types', () => {
  const sql = ' SELECT o.id, o.amount FROM sales.orders o WHERE o.id = $1 LIMIT $2 ';
  const admitted = validateDbLinkPgQuery(sql, { objects, budget, parameters: [{ kind: 'number', value: '9007199254740993' }, { kind: 'number', value: 10 }] });
  assert.equal(admitted.sql, sql);
  assert.deepEqual(admitted.objects, ['sales.orders']);
  assert.deepEqual(admitted.projections.map(column => [column.name, column.typeId, column.maxWireBytes]), [['id', 20, 20], ['amount', 1700, 20]]);
  assert.equal(admitted.maxRowWireBytes, 55); // type(1) + length(4) + field count(2) + two field lengths(8) + data(40)
  assert.equal(admitted.diagnosticBounded, false, 'success-message proof alone cannot qualify the source diagnostic path');
});

test('raw text, bytea and JSONB use bounded byte segments with explicit UTF8 representation', () => {
  const variants = [
    { raw: "convert_to(note, 'UTF8')", representation: 'utf8-text', column: 'note' },
    { raw: 'payload', representation: 'bytea', column: 'payload' },
    { raw: "pg_catalog.convert_to(document::text, 'UTF8')", representation: 'utf8-jsonb', column: 'document' },
  ];
  for (const { raw, representation, column } of variants) {
    const sql = `SELECT id, octet_length(${raw}) AS total_bytes, substring(${raw}, $1, $2) AS segment, ${column} IS NULL AS is_null FROM sales.orders WHERE id=$3`;
    const result = validateDbLinkPgQuery(sql, { objects, budget, parameters: [{ kind: 'number', value: 1 }, { kind: 'number', value: 128 }, { kind: 'number', value: '9007199254740993' }] });
    assert.equal(result.sql, sql);
    assert.deepEqual(result.projections.map(p => [p.typeId, p.maxWireBytes]), [[20, 20], [23, 11], [17, 258], [16, 1]]);
    assert.deepEqual(result.projections[2]!.segment, { startParameter: 1, lengthParameter: 2, start: 1, length: 128, representation });
    assert.equal(result.projections[2]!.source?.column, column);
    assert.equal(result.maxRowWireBytes, 313);
  }
  assert.throws(() => validateDbLinkPgQuery('SELECT substring(note, 1, 128) FROM sales.orders', { objects, budget, parameters: [] }), /字节|bytea/);
});

test('count and extrema use known bounded signatures while aggregates cannot hide unbounded values', () => {
  const sql = 'SELECT COUNT(*) AS n, MIN(amount) AS smallest, MAX(id) AS largest FROM sales.orders WHERE id >= $1';
  const result = validateDbLinkPgQuery(sql, { objects, budget, parameters: [{ kind: 'number', value: 0 }] });
  assert.deepEqual(result.projections.map(p => [p.name, p.typeId, p.maxWireBytes]), [['n', 20, 20], ['smallest', 1700, 20], ['largest', 20, 20]]);
  for (const expression of ['MIN(note)', 'MAX(document)', 'SUM(amount)', 'AVG(amount)']) assert.throws(() => validateDbLinkPgQuery(`SELECT ${expression} FROM sales.orders`, { objects, budget, parameters: [] }));
});

test('unknown source types and context-dependent projected parameters cannot borrow a small boolean or guessed numeric type', () => {
  const custom = objects.map(table => ({ ...table, columns: [...table.columns, { name: 'custom', ordinal: 7, typeId: 90001, precision: null, scale: null, readable: true }] }));
  assert.throws(() => validateDbLinkPgQuery('SELECT custom IS NULL FROM sales.orders', { objects: custom, budget, parameters: [] }), /类型/);
  assert.throws(() => validateDbLinkPgQuery('SELECT $1 FROM sales.orders', { objects, budget, parameters: [{ kind: 'number', value: '42' }] }), /参数|类型/);
  assert.throws(() => validateDbLinkPgQuery('SELECT 1.0 FROM sales.orders', { objects, budget, parameters: [] }), /类型/);
  assert.throws(() => validateDbLinkPgQuery('SELECT id FROM sales.orders WHERE id=$1', { objects, budget, parameters: [{ kind: 'number', value: '42', databaseType: 'CUSTOM_TYPE' }] }), /参数|类型/);
});

test('all branches and final wire expansion remain checked rather than trusting LIMIT or function names', () => {
  for (const projection of ['note', 'document', 'payload', 'unbounded_amount', 'CASE WHEN TRUE THEN id ELSE note END', "COALESCE(note, '')", 'note || note', 'CAST(note AS INTEGER)', "substring(convert_to(CAST(id AS TEXT), 'UTF8'), 1, 10)", "convert_to(note, 'UTF8')"]) {
    assert.throws(() => validateDbLinkPgQuery(`SELECT ${projection} FROM sales.orders LIMIT 1`, { objects, budget, parameters: [] }), projection);
  }
  for (const parameters of [
    [{ kind: 'number' as const, value: 0 }, { kind: 'number' as const, value: 128 }],
    [{ kind: 'number' as const, value: 1 }, { kind: 'number' as const, value: 512 }],
    [{ kind: 'number' as const, value: 2147483647 }, { kind: 'number' as const, value: 1 }],
  ]) assert.throws(() => validateDbLinkPgQuery('SELECT substring(payload, $1, $2) FROM sales.orders', { objects, budget, parameters }), /段/);
  const smallNumeric: PgAdmissionTable[] = [{ object: 'sales.tiny', queryable: true, columns: [{ name: 'value', ordinal: 1, typeId: 1700, precision: 1, scale: 0, readable: true }] }];
  assert.equal(validateDbLinkPgQuery('SELECT value FROM sales.tiny', { objects: smallNumeric, budget, parameters: [] }).projections[0]!.maxWireBytes, 3, 'NUMERIC(1,0) may still contain NaN');
  assert.throws(() => validateDbLinkPgQuery('SELECT id, id, id FROM sales.orders', { objects, budget: { ...budget, maxBytes: 64 }, parameters: [] }), /组合/);
});

test('binding ambiguity, hidden columns, unmatched parameters and unsupported query shapes refuse without exposing values', () => {
  const hidden = structuredClone(objects); hidden[0]!.columns[0]!.readable = false;
  assert.throws(() => validateDbLinkPgQuery('SELECT id FROM sales.orders', { objects: hidden, budget, parameters: [] }), /读取|列/);
  assert.throws(() => validateDbLinkPgQuery('SELECT id FROM sales.orders a INNER JOIN sales.orders b ON a.id=b.id', { objects, budget, parameters: [] }), /唯一|别名/);
  for (const sql of ['SELECT * FROM sales.orders', 'SELECT id FROM sales.orders UNION ALL SELECT id FROM sales.orders', 'WITH x AS (SELECT id FROM sales.orders) SELECT id FROM x', 'SELECT id FROM (SELECT id FROM sales.orders) x']) assert.throws(() => validateDbLinkPgQuery(sql, { objects, budget, parameters: [] }));
  assert.throws(() => validateDbLinkPgQuery('SELECT id FROM sales.orders WHERE id=$1', { objects, budget, parameters: [] }), /参数/);
  assert.throws(() => validateDbLinkPgQuery('SELECT id FROM sales.orders', { objects, budget, parameters: [{ kind: 'text', value: 'UNUSED_SECRET' }] }), error => error instanceof Error && !error.message.includes('UNUSED_SECRET'));
  assert.throws(() => validateDbLinkPgQuery('SELECT id FROM sales.orders WHERE id=$1', { objects, budget, parameters: [{ kind: 'number', value: '9'.repeat(1025) }] }), /参数/);
});

test('operator input signatures are verified even when every projected result is a small boolean', () => {
  assert.throws(() => validateDbLinkPgQuery("SELECT id = 'not-an-integer' FROM sales.orders", { objects, budget, parameters: [] }), /签名|参数|类型/);
  assert.throws(() => validateDbLinkPgQuery('SELECT id = TRUE FROM sales.orders', { objects, budget, parameters: [] }), /签名|类型/);
  assert.throws(() => validateDbLinkPgQuery('SELECT id IS TRUE FROM sales.orders', { objects, budget, parameters: [] }), /签名|布尔/);
  assert.throws(() => validateDbLinkPgQuery('SELECT id FROM sales.orders WHERE id=$1', { objects, budget, parameters: [{ kind: 'text', value: 'not-an-integer' }] }), /签名|参数|类型/);
  const sql = 'SELECT note = $1 AS matched FROM sales.orders';
  assert.deepEqual(validateDbLinkPgQuery(sql, { objects, budget, parameters: [{ kind: 'text', value: 'paid' }] }).projections.map(p => [p.typeId, p.maxWireBytes]), [[16, 1]]);
});

test('wire proofs declare the fixed session representation required from the driver', () => {
  const result = validateDbLinkPgQuery('SELECT id FROM sales.orders', { objects, budget, parameters: [] });
  assert.deepEqual(result.requiredSessionSettings, { client_encoding: 'UTF8', DateStyle: 'ISO, YMD', bytea_output: 'hex', extra_float_digits: '3', search_path: 'pg_catalog' });
});

test('technical rejection identifies the failed projection so the Agent can revise its own SQL', () => {
  assert.throws(() => validateDbLinkPgQuery('SELECT id, note AS detail FROM sales.orders', { objects, budget, parameters: [] }), error => error instanceof Error && /第2列/.test(error.message) && /detail/.test(error.message) && /分段/.test(error.message));
});

test('overlength identifiers cannot exploit PostgreSQL truncation or widen metadata output', () => {
  assert.throws(() => validateDbLinkPgQuery(`SELECT id AS ${'x'.repeat(64)} FROM sales.orders`, { objects, budget, parameters: [] }), /标识符/);
});

test('length controls identify the same original column and representation as their segment', () => {
  const sql = "SELECT octet_length(convert_to(note,'UTF8')) AS total_bytes, substring(convert_to(note,'UTF8'),1,64) AS segment FROM sales.orders";
  const result = validateDbLinkPgQuery(sql, { objects, budget, parameters: [] });
  assert.deepEqual(result.projections[0]!.lengthOf, { source: { object: 'sales.orders', column: 'note', ordinal: 3 }, representation: 'utf8-text' });
  assert.deepEqual(result.projections[1]!.source, result.projections[0]!.lengthOf!.source);
  assert.equal(result.projections[1]!.segment!.representation, result.projections[0]!.lengthOf!.representation);
});

test('parameter use counts expose transport parameters reused in business expressions without refusing ordinary one-segment queries', () => {
  const sql = 'SELECT id, substring(payload,$1,$2) AS segment FROM sales.orders WHERE id=$1';
  const result = validateDbLinkPgQuery(sql, { objects, budget, parameters: [{ kind: 'number', value: 1 }, { kind: 'number', value: 64 }] });
  assert.deepEqual(result.parameterUses, { 1: 2, 2: 1 });
  assert.equal(result.sql, sql);
  const shared = validateDbLinkPgQuery('SELECT substring(payload,$1,$1) FROM sales.orders', { objects, budget, parameters: [{ kind: 'number', value: 64 }] });
  assert.deepEqual(shared.parameterUses, { 1: 2 });
  const independent = validateDbLinkPgQuery('SELECT substring(payload,$1,$2) FROM sales.orders WHERE id=$3', { objects, budget, parameters: [{ kind: 'number', value: 1 }, { kind: 'number', value: 64 }, { kind: 'number', value: 2 }] });
  assert.deepEqual(independent.parameterUses, { 1: 1, 2: 1, 3: 1 });
  const literal = validateDbLinkPgQuery("SELECT '$1' AS marker, substring(payload,$1,$2) FROM sales.orders WHERE id=$3", { objects, budget, parameters: [{ kind: 'number', value: 1 }, { kind: 'number', value: 64 }, { kind: 'number', value: 2 }] });
  assert.deepEqual(literal.parameterUses, { 1: 1, 2: 1, 3: 1 }, 'placeholder-looking text in a SQL literal is data, not a parameter use');
});

test('MIN and MAX require an aggregate signature present for the exact native source type', () => {
  const bounded = objects.map(table => ({ ...table, columns: [...table.columns,
    { name: 'active', ordinal: 7, typeId: 16, precision: null, scale: null, readable: true },
    { name: 'external_id', ordinal: 8, typeId: 2950, precision: null, scale: null, readable: true },
  ] }));
  for (const aggregate of ['MIN(active)', 'MAX(active)', 'MIN(external_id)', 'MAX(external_id)']) assert.throws(() => validateDbLinkPgQuery(`SELECT ${aggregate} FROM sales.orders`, { objects: bounded, budget, parameters: [] }), /签名/);
  const count = validateDbLinkPgQuery('SELECT COUNT(active), COUNT(external_id) FROM sales.orders', { objects: bounded, budget, parameters: [] });
  assert.deepEqual(count.projections.map(column => [column.typeId, column.maxWireBytes]), [[20, 20], [20, 20]]);
});
