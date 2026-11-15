import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DbLinkSqlError, validateDbLinkSql } from '../src/host/db-link-sql.ts';

const rejects = (sql: string, engine: 'postgresql' | 'mysql', code?: string) => assert.throws(
  () => validateDbLinkSql(sql, engine),
  (error: unknown) => error instanceof DbLinkSqlError && (!code || error.code === code),
);

test('database queries preserve the original parameterized grouped analysis and identify actual source objects', () => {
  for (const engine of ['postgresql', 'mysql'] as const) {
    const parameter = engine === 'postgresql' ? '$1' : '?';
    const sql = ` SELECT o.store_id, SUM(o.amount) AS total, COUNT(*) AS n FROM sales.orders o LEFT JOIN sales.refunds r ON o.order_id = r.order_id AND o.tenant_id = r.tenant_id WHERE o.status = ${parameter} GROUP BY o.store_id HAVING COUNT(*) > 0 ORDER BY total DESC LIMIT 25 `;
    assert.deepEqual(validateDbLinkSql(sql, engine), { sql, objects: ['sales.orders', 'sales.refunds'], functions: ['sum', 'count'] });
  }
});

test('comments and executable hints never disappear behind a successful SELECT AST', () => {
  for (const engine of ['postgresql', 'mysql'] as const) {
    for (const sql of ['SELECT /* ordinary */ 1', 'SELECT 1 -- trailing', 'SELECT 1--2', 'SELECT /*+ MAX_EXECUTION_TIME(999999) */ 1', 'SELECT 1 /*!80000 + GET_LOCK(\'shared\', 1) */']) rejects(sql, engine, 'db_sql_comments_not_allowed');
    const sql = "SELECT 'literal -- /*+ GET_LOCK */ # only'";
    assert.deepEqual(validateDbLinkSql(sql, engine), { sql, objects: [], functions: [] });
  }
  rejects('SELECT 1 # trailing', 'mysql', 'db_sql_comments_not_allowed');
});

test('known built-in expression functions work while arbitrary, quoted and qualified routines are rejected', () => {
  for (const engine of ['postgresql', 'mysql'] as const) {
    const sql = "SELECT LOWER(status), COALESCE(amount, 0), ROUND(ABS(amount), 2) FROM sales.orders";
    assert.deepEqual(validateDbLinkSql(sql, engine).functions, ['lower', 'coalesce', 'round', 'abs']);
    for (const name of ['GET_LOCK', 'RELEASE_LOCK', 'SLEEP', 'BENCHMARK', 'LOAD_FILE', 'pg_sleep', 'pg_cancel_backend', 'pg_terminate_backend', 'set_config', 'pg_notify', 'nextval', 'user_function', 'sales.lower']) rejects(`SELECT ${name}('x') FROM sales.orders`, engine);
    const quoted = engine === 'mysql' ? '`lower`' : '"lower"';
    rejects(`SELECT ${quoted}(status) FROM sales.orders`, engine);
  }
  assert.deepEqual(validateDbLinkSql('SELECT pg_catalog.lower(status) FROM sales.orders', 'postgresql').functions, ['lower']);
  rejects('SELECT pg_catalog.lower(status) FROM sales.orders', 'mysql', 'db_sql_function_not_allowed');
});

test('parser-erased quoting cannot turn a different physical relation into a local CTE', () => {
  rejects('WITH t AS (SELECT 1) SELECT * FROM "T"', 'postgresql');
  rejects('WITH T AS (SELECT 1) SELECT * FROM "T"', 'postgresql');
  rejects('WITH t AS (SELECT 1) SELECT * FROM `T`', 'mysql');
});

test('write, control, multi-statement, locks, INTO and variables have no executable path', () => {
  for (const engine of ['postgresql', 'mysql'] as const) {
    for (const sql of ['SET statement_timeout=0', 'COMMIT', 'KILL QUERY 42', 'DELETE FROM sales.orders', 'UPDATE sales.orders SET amount=0', 'CALL sales.do_work()', 'SELECT 1; SELECT 2', 'SELECT 1; SET statement_timeout=0', 'SELECT * INTO saved FROM sales.orders', 'SELECT @secret', 'SELECT @@version', 'SELECT @x := 1']) rejects(sql, engine);
  }
  rejects('SELECT * FROM sales.orders FOR UPDATE', 'mysql', 'db_sql_locking_not_allowed');
  rejects('SELECT * FROM sales.orders LOCK IN SHARE MODE', 'mysql', 'db_sql_locking_not_allowed');
  rejects('SELECT * FROM sales.orders FOR UPDATE', 'postgresql');
  rejects("SELECT amount INTO OUTFILE '/tmp/query.csv' FROM sales.orders", 'mysql', 'db_sql_into_not_allowed');
});

test('CTEs, derived tables, correlated subqueries and UNION branches retain their own physical source checks', () => {
  for (const engine of ['postgresql', 'mysql'] as const) {
    const sql = 'WITH t AS (SELECT amount FROM sales.orders) SELECT SUM(amount) FROM t UNION ALL SELECT SUM(r.amount) FROM (SELECT amount FROM sales.refunds) r WHERE EXISTS (SELECT 1 FROM sales.stores s WHERE s.amount = r.amount)';
    assert.deepEqual(validateDbLinkSql(sql, engine), { sql, objects: ['sales.orders', 'sales.refunds', 'sales.stores'], functions: ['sum'] });
    rejects('WITH t AS (SELECT GET_LOCK(\'shared\', 1)) SELECT * FROM t', engine);
    rejects('SELECT 1 UNION ALL SELECT user_function(amount) FROM sales.orders', engine);
    rejects('SELECT * FROM (SELECT set_config(\'x\', \'y\', false)) s', engine);
    rejects('SELECT * FROM sales.orders WHERE EXISTS (SELECT pg_notify(\'x\', \'y\'))', engine);
    rejects('SELECT * FROM orders', engine, 'db_sql_object_unqualified');
  }
  // The real 5.4.0 grammar rejects this RETURNING form before returning an AST; either rejection keeps it unexecuted.
  rejects('WITH stolen AS (DELETE FROM sales.orders RETURNING *) SELECT * FROM stolen', 'postgresql');
  rejects('WITH stolen AS (DELETE FROM sales.orders) SELECT 1', 'postgresql', 'db_sql_statement_not_allowed');
});

test('conditional arithmetic, built-in numeric casts and ordinary filters remain available without custom types or operators', () => {
  for (const engine of ['postgresql', 'mysql'] as const) {
    const type = engine === 'postgresql' ? 'NUMERIC(18,2)' : 'DECIMAL(18,2)';
    const sql = `SELECT CASE WHEN amount IS NULL THEN CAST(0 AS ${type}) ELSE -amount END AS net, TRUE, COUNT(DISTINCT member_id) FROM sales.orders WHERE status IN ('paid', 'refunded') AND amount BETWEEN 0 AND 100 AND NOT deleted GROUP BY amount`;
    assert.deepEqual(validateDbLinkSql(sql, engine), { sql, objects: ['sales.orders'], functions: ['count'] });
    rejects('SELECT CAST(amount AS custom_type) FROM sales.orders', engine);
    rejects('SELECT CAST(user_function(amount) AS DECIMAL(18,2)) FROM sales.orders', engine);
    rejects('SELECT CASE WHEN true THEN 1 ELSE SLEEP(10) END', engine);
  }
  assert.deepEqual(validateDbLinkSql('SELECT amount::numeric FROM sales.orders', 'postgresql').objects, ['sales.orders']);
  rejects('SELECT amount::sales.evil FROM sales.orders', 'postgresql');
  rejects('SELECT amount OPERATOR(sales.+) 1 FROM sales.orders', 'postgresql');
});

test('PostgreSQL unquoted object identity follows server case folding before authorization checks', () => {
  const sql = 'SELECT COUNT(*) FROM Sales.Orders';
  assert.deepEqual(validateDbLinkSql(sql, 'postgresql'), { sql, objects: ['sales.orders'], functions: ['count'] });
});

test('ordinary distinct and temporal grouping syntax is checked without changing its data', () => {
  for (const engine of ['postgresql', 'mysql'] as const) {
    const sql = "SELECT DISTINCT EXTRACT(YEAR FROM created_at), CURRENT_DATE, DATE '2026-01-01' FROM sales.orders";
    assert.deepEqual(validateDbLinkSql(sql, engine), { sql, objects: ['sales.orders'], functions: ['extract', 'current_date'] });
    rejects('SELECT EXTRACT(YEAR FROM pg_sleep(10))', engine);
  }
});

test('one final terminator and parenthesized UNION remain one query, while separators inside data remain data', () => {
  for (const engine of ['postgresql', 'mysql'] as const) {
    for (const sql of ['SELECT 1; ', "SELECT '; KILL QUERY 42'", 'SELECT 1 UNION ALL (SELECT 2)']) assert.deepEqual(validateDbLinkSql(sql, engine), { sql, objects: [], functions: [] });
    rejects('SELECT 1;;', engine, 'db_sql_multiple_statements');
    rejects('SELECT 1; ; SELECT 2', engine, 'db_sql_multiple_statements');
  }
});

test('unsupported lexical forms and unhandled AST constructs refuse the affected query', () => {
  rejects("SELECT $$set_config('x', 'y', false)$$", 'postgresql', 'db_sql_lexical_unsupported');
  rejects("SELECT E'\\x'", 'postgresql', 'db_sql_lexical_unsupported');
  rejects("SELECT 'a\\'b'", 'mysql', 'db_sql_lexical_unsupported');
  rejects('SELECT 1\u0000', 'mysql', 'db_sql_lexical_unsupported');
  rejects('SELECT\u00a01', 'postgresql', 'db_sql_lexical_unsupported');
  rejects('SELECT $0', 'postgresql', 'db_sql_lexical_unsupported');
  rejects('SELECT $65536', 'postgresql', 'db_sql_variable_not_allowed');
  for (const engine of ['postgresql', 'mysql'] as const) {
    rejects('SELECT COUNT(*) OVER (PARTITION BY status) FROM sales.orders', engine);
    rejects('SELECT SUM(amount) FILTER (WHERE user_function(amount)) FROM sales.orders', engine);
    rejects('WITH RECURSIVE t AS (SELECT 1 UNION ALL SELECT 1 FROM t) SELECT * FROM t', engine);
    rejects(`SELECT ${'('.repeat(101)}1${')'.repeat(101)}`, engine, 'db_sql_too_complex');
    rejects(' '.repeat(32769) + 'SELECT 1', engine, 'db_sql_invalid');
    rejects('   ', engine, 'db_sql_invalid');
  }
});
