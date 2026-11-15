export class DbLinkSqlError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'DbLinkSqlError'; this.code = code; }
}

type Engine = 'postgresql' | 'mysql';
type Node = Record<string, unknown>;
const parser = new sqlParser.Parser();
// Execution capability boundary, not a catalogue of analysis methods. Remote resolution remains a driver admission check.
const commonFunctions = new Set(['count', 'sum', 'min', 'max', 'avg', 'abs', 'ceil', 'ceiling', 'floor', 'round', 'sqrt', 'power', 'mod', 'coalesce', 'nullif', 'greatest', 'least', 'lower', 'upper', 'length', 'char_length', 'character_length', 'concat', 'concat_ws', 'substring', 'substr', 'left', 'right', 'replace', 'trim', 'ltrim', 'rtrim', 'lpad', 'rpad', 'current_date', 'current_time', 'current_timestamp']);
const engineFunctions: Record<Engine, Set<string>> = {
  postgresql: new Set(['octet_length', 'convert_to', 'date_trunc', 'date_part', 'to_char', 'now', 'bool_and', 'bool_or', 'every', 'stddev', 'stddev_pop', 'stddev_samp', 'variance', 'var_pop', 'var_samp']),
  mysql: new Set(['ifnull', 'if', 'pow', 'truncate', 'date', 'year', 'month', 'day', 'dayofmonth', 'weekday', 'hour', 'minute', 'second', 'date_format', 'datediff', 'stddev', 'stddev_pop', 'stddev_samp', 'variance', 'var_pop', 'var_samp']),
};
const castTypes: Record<Engine, Set<string>> = {
  postgresql: new Set(['SMALLINT', 'INT', 'INTEGER', 'BIGINT', 'INT2', 'INT4', 'INT8', 'NUMERIC', 'DECIMAL', 'REAL', 'FLOAT', 'FLOAT4', 'FLOAT8', 'DOUBLE PRECISION', 'BOOLEAN', 'BOOL', 'TEXT', 'CHAR', 'CHARACTER', 'VARCHAR', 'CHARACTER VARYING', 'DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'TIME', 'TIMETZ']),
  mysql: new Set(['SIGNED', 'UNSIGNED', 'DECIMAL', 'CHAR', 'DATE', 'DATETIME', 'TIME', 'FLOAT', 'DOUBLE', 'REAL']),
};
const fail = (code = 'db_sql_unsupported', message = '查询包含尚未核定的语法，请在当前获准范围内调整查询。'): never => { throw new DbLinkSqlError(code, message); };
const record = (value: unknown): Node => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Node : fail();
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : fail();
const shape = (value: unknown, allowed: string[]): Node => {
  const node = record(value);
  if (Object.keys(node).some(key => !allowed.includes(key))) fail();
  if (node.parentheses != null && typeof node.parentheses !== 'boolean' || node.parentheses_symbol != null && typeof node.parentheses_symbol !== 'boolean') fail();
  return node;
};
const identifier = (value: unknown): string => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value) ? value : fail('db_sql_identifier_unsupported', '对象或标识符尚不能准确核定，请使用明确的 schema.table 与普通标识符。');

/** Only checks lexical boundaries the upstream grammar discards; it does not parse or rewrite SQL. */
function checkLexicalBoundary(sql: string, engine: Engine): void {
  if (/[\\\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(sql)) fail('db_sql_lexical_unsupported', '暂不接受反斜杠或控制字符，以避免 SQL mode 与字符串转义歧义。请用数据参数传值。');
  let nesting = 0;
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index]!;
    if (char === "'" || char === '"' || char === '`') {
      const start = index;
      let closed = false;
      for (index++; index < sql.length; index++) if (sql[index] === char) {
        if (sql[index + 1] === char) { index++; continue; }
        closed = true; break;
      }
      if (!closed) fail('db_sql_lexical_unsupported', '查询中的引号未闭合。');
      // The public PostgreSQL grammar drops FROM quote identity (also with includeLocations).
      // Canonical lowercase ASCII names have the same identity quoted and unquoted. Reject
      // the other quoted names locally rather than folding a different relation into a CTE.
      if (char !== "'" && (engine !== 'postgresql' || char !== '"' || !/^[a-z_][a-z0-9_$]*$/.test(sql.slice(start + 1, index)))) fail('db_sql_identifier_unsupported', '当前仅支持普通标识符或等义的小写 ASCII 双引号标识符；混合大小写等名称无法准确核对，本条查询未执行。');
      continue;
    }
    if (char === '/' && sql[index + 1] === '*' || char === '-' && sql[index + 1] === '-' || char === '#' && engine === 'mysql') fail('db_sql_comments_not_allowed', '本接缝暂不接受 SQL 注释或提示，避免执行型注释、预算提示和方言差异被解析器忽略。');
    if (char === ';' && sql.slice(index + 1).trim()) fail('db_sql_multiple_statements', '每次只允许一条查询，可带一个末尾分号。');
    if (char === '$' && engine === 'postgresql') {
      const parameter = /^\$[1-9][0-9]*(?![A-Za-z0-9_$])/.exec(sql.slice(index));
      if (!parameter) return fail('db_sql_lexical_unsupported', '暂不接受 dollar 引号或不明确的参数，请使用 $n 数据参数。');
      index += parameter[0].length - 1;
    }
    if (char === '(' && ++nesting > 100) fail('db_sql_too_complex', '查询嵌套过深，请拆分为独立查询。');
    if (char === ')') nesting--;
    if (char.charCodeAt(0) > 127) fail('db_sql_lexical_unsupported', 'SQL 标记仅接受当前已核定的字符；文本数据请使用字符串或参数。');
  }
}

/** Syntax admission only. The driver must separately verify remote object/role/type/function privileges and budgets. */
export function validateDbLinkSql(sql: string, engine: Engine): { sql: string; objects: string[]; functions: string[] } {
  if (typeof sql !== 'string' || !sql.trim() || sql.length > 32768 || !['postgresql', 'mysql'].includes(engine)) fail('db_sql_invalid', '请提供不超过 32768 字符的单条受支持查询。');
  checkLexicalBoundary(sql, engine);
  let ast: unknown;
  try { ast = parser.astify(sql, { database: engine === 'mysql' ? 'MySQL' : 'Postgresql' }); }
  catch { fail('db_sql_parse_failed', '查询无法按当前数据库方言完整解析；没有执行或改写 SQL。'); }
  if (Array.isArray(ast)) {
    if (ast.length !== 1) fail('db_sql_multiple_statements', '每次只允许一条查询，不接受多语句。');
    ast = ast[0];
  }
  const objects = new Set<string>(), functions = new Set<string>();
  const column = (value: unknown) => {
    if (value === '*') return;
    if (typeof value === 'string') { identifier(value); return; }
    const wrapped = shape(value, ['expr']);
    const name = shape(wrapped.expr, ['type', 'value']);
    if (name.type !== 'default' && name.type !== 'double_quote_string') fail();
    identifier(name.value);
  };
  const expression = (value: unknown, depth: number, ctes: Set<string>): void => {
    if (depth > 100) fail('db_sql_too_complex', '查询嵌套过深，请拆分为独立查询。');
    const node = record(value);
    if (node.ast != null) {
      shape(node, ['ast', 'tableList', 'columnList', 'parentheses']);
      query(node.ast, depth + 1, ctes); return;
    }
    switch (node.type) {
      case 'single_quote_string':
      case 'date':
      case 'time':
      case 'timestamp':
        shape(node, ['type', 'value']); if (typeof node.value !== 'string') fail(); return;
      case 'null':
        shape(node, ['type', 'value']); if (node.value !== null) fail(); return;
      case 'bool':
        shape(node, ['type', 'value']); if (typeof node.value !== 'boolean') fail(); return;
      case 'number':
        shape(node, ['type', 'value']);
        if (typeof node.value !== 'number' && typeof node.value !== 'string') fail();
        return;
      case 'star':
        shape(node, ['type', 'value']); if (node.value !== '*') fail(); return;
      case 'column_ref':
        shape(node, ['type', 'table', 'column', 'collate']);
        if (node.collate != null) fail();
        if (node.table != null) identifier(node.table);
        column(node.column); return;
      case 'origin':
        shape(node, ['type', 'value']);
        if (engine !== 'mysql' || node.value !== '?') fail('db_sql_variable_not_allowed', '仅允许本引擎的数据参数占位符。');
        return;
      case 'var':
        shape(node, ['type', 'name', 'members', 'quoted', 'prefix']);
        if (engine !== 'postgresql' || node.prefix !== '$' || !Number.isSafeInteger(node.name) || Number(node.name) < 1 || Number(node.name) > 65535 || node.quoted != null || list(node.members).length) fail('db_sql_variable_not_allowed', '仅允许本引擎的数据参数占位符。');
        return;
      case 'binary_expr':
        shape(node, ['type', 'operator', 'left', 'right', 'parentheses']);
        if (!['=', '!=', '<>', '<', '>', '<=', '>=', '+', '-', '*', '/', '%', 'AND', 'OR', 'IS', 'IS NOT', 'IN', 'NOT IN', 'BETWEEN', 'NOT BETWEEN', 'LIKE', 'NOT LIKE', ...(engine === 'postgresql' ? ['ILIKE', 'NOT ILIKE', '||'] : ['<=>'])].includes(String(node.operator))) fail('db_sql_operator_not_allowed', '此运算符尚未核定为允许的内建运算。');
        expression(node.left, depth + 1, ctes); expression(node.right, depth + 1, ctes); return;
      case 'unary_expr':
        shape(node, ['type', 'operator', 'expr', 'parentheses']);
        if (!['NOT', '-', '+'].includes(String(node.operator))) fail('db_sql_operator_not_allowed', '此一元运算尚未核定。');
        expression(node.expr, depth + 1, ctes); return;
      case 'expr_list':
        shape(node, ['type', 'value', 'parentheses']); list(node.value).forEach(value => expression(value, depth + 1, ctes)); return;
      case 'case':
        shape(node, ['type', 'expr', 'args']);
        if (node.expr != null) expression(node.expr, depth + 1, ctes);
        for (const value of list(node.args)) {
          const branch = shape(value, ['type', 'cond', 'result']);
          if (branch.type === 'when') expression(branch.cond, depth + 1, ctes);
          else if (branch.type !== 'else' || branch.cond != null) fail();
          expression(branch.result, depth + 1, ctes);
        }
        return;
      case 'cast': {
        shape(node, ['type', 'keyword', 'expr', 'symbol', 'target']);
        if (node.keyword !== 'cast' || !['as', ...(engine === 'postgresql' ? ['::'] : [])].includes(String(node.symbol))) fail();
        const targets = list(node.target);
        if (targets.length !== 1) fail('db_sql_type_not_allowed', '仅允许已核定的内建标量类型转换。');
        const target = shape(targets[0], ['dataType', 'length', 'scale', 'parentheses', 'suffix']);
        const suffix = target.suffix == null ? [] : list(target.suffix);
        const timezoneSuffix = engine === 'postgresql' && ['TIMESTAMP', 'TIME'].includes(String(target.dataType)) && ['WITH TIME ZONE', 'WITHOUT TIME ZONE'].includes(suffix.join(' '));
        if (!castTypes[engine].has(String(target.dataType)) || suffix.length && !timezoneSuffix || [target.length, target.scale].some(value => value != null && (!Number.isSafeInteger(value) || Number(value) < 0))) fail('db_sql_type_not_allowed', '此类型或类型修饰尚未核定为允许的内建转换。');
        expression(node.expr, depth + 1, ctes); return;
      }
      case 'interval': {
        shape(node, ['type', 'expr', 'unit']);
        if (engine !== 'postgresql' || !['', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND'].includes(String(node.unit).toUpperCase())) fail();
        expression(node.expr, depth + 1, ctes); return;
      }
      case 'extract': {
        shape(node, ['type', 'args']);
        const args = shape(node.args, ['field', 'source', 'cast_type']);
        if (args.cast_type != null || !['YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'DOW', 'DOY', 'WEEK', 'QUARTER', 'EPOCH', 'ISODOW', 'ISOYEAR', 'DECADE', 'CENTURY', 'MILLENNIUM', 'MILLISECONDS', 'MICROSECONDS', 'TIMEZONE', 'TIMEZONE_HOUR', 'TIMEZONE_MINUTE'].includes(String(args.field).toUpperCase())) fail();
        functions.add('extract'); expression(args.source, depth + 1, ctes); return;
      }
      case 'aggr_func': {
        shape(node, ['type', 'name', 'args', 'over']);
        const name = String(node.name).toLowerCase();
        if (!['count', 'sum', 'min', 'max', 'avg'].includes(name) || node.over != null) fail('db_sql_function_not_allowed', '此函数或窗口语法尚未核定。');
        functions.add(name);
        const args = shape(node.args, ['expr', 'distinct', 'orderby', 'separator']);
        if (args.orderby != null || args.separator != null) fail();
        if (args.distinct != null && args.distinct !== 'DISTINCT') fail();
        expression(args.expr, depth + 1, ctes); return;
      }
      case 'function': {
        shape(node, ['type', 'name', 'args', 'over']);
        const nameNode = shape(node.name, ['name', 'schema']), parts = list(nameNode.name);
        if (parts.length !== 1) fail('db_sql_function_not_allowed', '函数名称或资格尚未核定。');
        const part = shape(parts[0], ['type', 'value']);
        if (part.type !== 'default' && part.type !== 'origin') fail('db_sql_function_not_allowed', '暂不接受带引号的函数名，请使用明确获准的内建函数。');
        const name = identifier(part.value).toLowerCase();
        if (nameNode.schema != null) {
          const schema = shape(nameNode.schema, ['type', 'value']);
          if (engine !== 'postgresql' || schema.type !== 'default' || String(schema.value).toLowerCase() !== 'pg_catalog') fail('db_sql_function_not_allowed', '不允许自定义 schema 的函数或过程。');
        }
        if (name !== 'exists' && !commonFunctions.has(name) && !engineFunctions[engine].has(name) || node.over != null) fail('db_sql_function_not_allowed', '此函数或窗口语法尚未核定为允许的内建能力。');
        if (name !== 'exists') functions.add(name);
        if (node.args == null && ['current_date', 'current_time', 'current_timestamp'].includes(name)) return;
        const args = shape(node.args, ['type', 'value']);
        if (args.type !== 'expr_list') fail();
        list(args.value).forEach(value => expression(value, depth + 1, ctes)); return;
      }
      default: fail();
    }
  };
  const query = (value: unknown, depth: number, inheritedCtes: Set<string>): void => {
    if (depth > 100) fail('db_sql_too_complex', '查询嵌套过深，请拆分为独立查询。');
    if (record(value).type !== 'select') fail('db_sql_statement_not_allowed', '这里只允许获准的单条只读查询，不执行写入、管理或会话命令。');
    const select = shape(value, ['with', 'type', 'options', 'distinct', 'columns', 'into', 'from', 'where', 'groupby', 'having', 'orderby', 'limit', 'locking_read', 'window', 'collate', '_next', 'set_op', 'parentheses', 'parentheses_symbol']);
    const ctes = new Set(inheritedCtes), localCtes = new Set<string>();
    if (select.with != null) for (const value of list(select.with)) {
      const cte = shape(value, ['name', 'stmt', 'columns']);
      const nameNode = shape(cte.name, ['type', 'value']);
      if (nameNode.type !== 'default' && !(engine === 'postgresql' && nameNode.type === 'double_quote_string')) fail();
      const name = identifier(nameNode.value).toLowerCase();
      if (localCtes.has(name)) fail();
      if (cte.columns != null) list(cte.columns).forEach(column);
      if (record(cte.stmt).ast != null) expression(cte.stmt, depth + 1, ctes); else query(cte.stmt, depth + 1, ctes);
      ctes.add(name); localCtes.add(name);
    }
    if (select.locking_read != null) fail('db_sql_locking_not_allowed', '不允许锁定读取；只读事务不能替代锁与副作用边界。');
    if (select.options != null || select.window != null || select.collate != null) fail();
    if (select.into != null && Object.entries(record(select.into)).some(([key, value]) => key !== 'position' || value != null)) fail('db_sql_into_not_allowed', '不允许 SELECT INTO、文件导出或变量写入。');
    if (select.distinct != null) {
      if (engine !== 'mysql' || select.distinct !== 'DISTINCT') {
        const distinct = shape(select.distinct, ['type']);
        if (distinct.type != null && distinct.type !== 'DISTINCT') fail();
      }
    }
    for (const value of list(select.columns)) { const item = shape(value, ['expr', 'as', 'type']); if (item.type != null && item.type !== 'expr') fail(); if (item.as != null) identifier(item.as); expression(item.expr, depth + 1, ctes); }
    if (select.from != null) for (const value of list(select.from)) {
      const source = shape(value, ['db', 'table', 'as', 'join', 'on', 'using', 'prefix', 'expr']);
      if (source.prefix != null) fail();
      if (source.expr != null) {
        if (source.table != null || source.db != null) fail();
        expression(source.expr, depth + 1, ctes);
      } else {
        const table = identifier(source.table);
        if (source.db == null) {
          if (!ctes.has(table.toLowerCase())) fail('db_sql_object_unqualified', '物理对象须使用明确的 schema.table；不能从 search_path 或默认库猜归属。');
        } else {
          const object = `${identifier(source.db)}.${table}`;
          objects.add(engine === 'postgresql' ? object.toLowerCase() : object);
        }
      }
      if (source.as != null) identifier(source.as);
      if (source.join != null && !['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN'].includes(String(source.join))) fail();
      if (source.on != null) expression(source.on, depth + 1, ctes);
      if (source.using != null) list(source.using).forEach(column);
    }
    for (const key of ['where', 'having']) if (select[key] != null) expression(select[key], depth + 1, ctes);
    if (select.groupby != null) {
      const group = shape(select.groupby, ['columns', 'modifiers']);
      if (group.modifiers != null && list(group.modifiers).some(item => item != null)) fail();
      list(group.columns).forEach(item => expression(item, depth + 1, ctes));
    }
    if (select.orderby != null) for (const value of list(select.orderby)) {
      const order = shape(value, ['expr', 'type', 'nulls']);
      if (order.nulls != null && (engine !== 'postgresql' || !['NULLS FIRST', 'NULLS LAST'].includes(String(order.nulls)))) fail();
      if (order.type != null && !['ASC', 'DESC'].includes(String(order.type))) fail();
      expression(order.expr, depth + 1, ctes);
    }
    if (select.limit != null) { const limit = shape(select.limit, ['seperator', 'value']); if (!['', ',', 'offset'].includes(String(limit.seperator).toLowerCase())) fail(); list(limit.value).forEach(item => expression(item, depth + 1, ctes)); }
    if (select._next != null) {
      if (!['union', 'union all', 'intersect', 'intersect all', 'except', 'except all'].includes(String(select.set_op).toLowerCase())) fail();
      // A WITH owned by a parenthesized branch ends at that branch. Propagating it
      // to the sibling would mistake a search_path relation for an authorized CTE.
      query(select._next, depth + 1, select.parentheses_symbol ? inheritedCtes : ctes);
    } else if (select.set_op != null) fail();
  };
  query(ast, 0, new Set());
  return { sql, objects: [...objects], functions: [...functions] };
}
import sqlParser from 'node-sql-parser';
