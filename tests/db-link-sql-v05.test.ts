import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DbLinkSqlError, validateDbLinkSql } from '../src/host/db-link-sql.ts';

test('v0.5 admits canonical quoted PostgreSQL objects and CTEs without changing physical scope or original SQL', () => {
  const sql = ' WITH "picked" AS (SELECT "o"."amount" FROM "sales"."orders" AS "o") SELECT SUM("amount") FROM "picked" UNION ALL SELECT AVG("amount") FROM "sales"."refunds" ';
  assert.deepEqual(validateDbLinkSql(sql, 'postgresql'), { sql, objects: ['sales.orders', 'sales.refunds'], functions: ['sum', 'avg'] });
  const shadow = 'WITH "orders" AS (SELECT 1) SELECT * FROM "sales"."orders"';
  assert.deepEqual(validateDbLinkSql(shadow, 'postgresql').objects, ['sales.orders']);
  for (const sql of ['WITH t AS (SELECT 1) SELECT * FROM "T"', 'WITH T AS (SELECT 1) SELECT * FROM "T"', 'SELECT * FROM "Sales"."Orders"', 'SELECT * FROM "sales.orders"', 'SELECT * FROM "销售"."订单"']) {
    assert.throws(() => validateDbLinkSql(sql, 'postgresql'), error => error instanceof DbLinkSqlError && error.code === 'db_sql_identifier_unsupported');
  }
  assert.equal(validateDbLinkSql('SELECT \'"Sales"."Orders" pg_sleep --\'', 'postgresql').sql, 'SELECT \'"Sales"."Orders" pg_sleep --\'');
});

test('v0.5 ordinary temporal analysis supports native timestamps and intervals without a static output proof', () => {
  const sql = "SELECT date_trunc('month', created_at::timestamptz) AS month, SUM(amount), AVG(amount), substring(note,1,12) FROM sales.orders WHERE created_at >= now() - INTERVAL '30 days' GROUP BY date_trunc('month', created_at::timestamptz) ORDER BY month DESC NULLS LAST";
  assert.deepEqual(validateDbLinkSql(sql, 'postgresql'), { sql, objects: ['sales.orders'], functions: ['date_trunc', 'sum', 'avg', 'substring', 'now'] });
  assert.deepEqual(validateDbLinkSql("SELECT created_at::timestamp with time zone, INTERVAL '1' DAY FROM sales.orders", 'postgresql').objects, ['sales.orders']);
  assert.throws(() => validateDbLinkSql("SELECT INTERVAL(set_config('statement_timeout','0',false))", 'postgresql'), error => error instanceof DbLinkSqlError);
});

test('a CTE inside a parenthesized set branch never authorizes an unqualified physical relation in its sibling', () => {
  for (const sql of [
    '(WITH t AS (SELECT * FROM sales.orders) SELECT * FROM t) UNION SELECT * FROM t',
    'SELECT 1 UNION (WITH t AS (SELECT * FROM sales.orders) SELECT * FROM t) UNION SELECT * FROM t',
    'SELECT * FROM (WITH t AS (SELECT * FROM sales.orders) SELECT * FROM t) d UNION SELECT * FROM t',
  ]) assert.throws(() => validateDbLinkSql(sql, 'postgresql'), error => error instanceof DbLinkSqlError && error.code === 'db_sql_object_unqualified');
  const sql = 'WITH t AS (SELECT * FROM sales.orders) SELECT * FROM t UNION SELECT * FROM t';
  assert.deepEqual(validateDbLinkSql(sql, 'postgresql').objects, ['sales.orders']);
});

test('nested side effects, system execution and unknown direct functions remain local technical refusals', () => {
  for (const fn of ["set_config('statement_timeout','0',false)", 'pg_sleep(1)', 'pg_advisory_lock(1)', "pg_read_file('/etc/passwd')", "pg_ls_dir('.')", "pg_notify('channel','value')", "dblink_exec('connection','DELETE FROM orders')", 'sales.unknown(amount)']) {
    for (const sql of [
      `SELECT COALESCE(${fn}, 0) FROM sales.orders`,
      `SELECT CASE WHEN FALSE THEN ${fn} ELSE 1 END FROM sales.orders`,
      `SELECT id FROM sales.orders ORDER BY ${fn}`,
      `WITH picked AS (SELECT ${fn} FROM sales.orders) SELECT * FROM picked`,
      `SELECT * FROM sales.orders WHERE EXISTS (SELECT ${fn} FROM sales.refunds)`,
    ]) assert.throws(() => validateDbLinkSql(sql, 'postgresql'), error => error instanceof DbLinkSqlError);
  }
  for (const sql of [
    'SET ROLE analyst', 'EXPLAIN SELECT * FROM sales.orders', 'EXECUTE saved_query',
    'SELECT * INTO saved FROM sales.orders', 'SELECT * FROM sales.orders FOR SHARE',
    'WITH changed AS (UPDATE sales.orders SET amount=0) SELECT 1',
    'SELECT 1; COMMIT',
  ]) assert.throws(() => validateDbLinkSql(sql, 'postgresql'), error => error instanceof DbLinkSqlError);
  const sql = "SELECT 'set_config pg_sleep pg_advisory_lock; SET ROLE admin -- not code' AS note, AVG(amount) FROM sales.orders";
  assert.deepEqual(validateDbLinkSql(sql, 'postgresql'), { sql, objects: ['sales.orders'], functions: ['avg'] });
});

test('explicit view and RLS names are reported as direct sources without inventing hidden dependencies', () => {
  const sql = 'WITH visible AS (SELECT member_id, amount FROM enterprise.member_sales_view) SELECT v.member_id, SUM(v.amount), AVG(v.amount) FROM visible v JOIN enterprise.member_inventory_rls i ON i.member_id=v.member_id GROUP BY v.member_id';
  assert.deepEqual(validateDbLinkSql(sql, 'postgresql'), { sql, objects: ['enterprise.member_sales_view', 'enterprise.member_inventory_rls'], functions: ['sum', 'avg'] });
  const nested = 'SELECT o.id FROM sales.orders o WHERE EXISTS (WITH picked AS (SELECT * FROM private.refunds) SELECT * FROM picked r WHERE r.order_id=o.id)';
  assert.deepEqual(validateDbLinkSql(nested, 'postgresql').objects, ['sales.orders', 'private.refunds']);
  assert.throws(() => validateDbLinkSql('WITH picked AS (SELECT * FROM sales.orders) SELECT * FROM picked JOIN orders o ON TRUE', 'postgresql'), error => error instanceof DbLinkSqlError && error.code === 'db_sql_object_unqualified');
});

test('on-demand text prefixes and lengths remain ordinary SQL derived values', () => {
  const sql = 'SELECT left(note,3) AS prefix, right(note,2) AS suffix, octet_length(note) AS total_bytes FROM sales.orders';
  assert.deepEqual(validateDbLinkSql(sql, 'postgresql'), { sql, objects: ['sales.orders'], functions: ['left', 'right', 'octet_length'] });
  for (const fn of ['left', 'right', 'octet_length']) assert.throws(() => validateDbLinkSql(`SELECT ${fn}(set_config('statement_timeout','0',false),3) FROM sales.orders`, 'postgresql'), error => error instanceof DbLinkSqlError);
});
