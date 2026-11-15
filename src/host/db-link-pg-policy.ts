import sqlParser from 'node-sql-parser';
import { DbLinkSqlError, validateDbLinkSql } from './db-link-sql.ts';
import type { DbResultParameter } from './db-link-results.ts';
import type { DbLinkBudget } from './db-link-types.ts';

// Historical v0.4 successful-DataRow proof helper only. v0.5 ordinary SELECT admission
// uses validateDbLinkSql plus the driver's native privileges and receive-time budgets.
// This retained calculation is not a transport or pre-decode memory guarantee.
const LEGACY_PG_RESPONSE_WINDOW_BYTES = 512 * 1024;

export const DB_LINK_PG_OUTPUT_SETTINGS = Object.freeze({ client_encoding: 'UTF8', DateStyle: 'ISO, YMD', bytea_output: 'hex', extra_float_digits: '3', search_path: 'pg_catalog' } as const);

export type PgAdmissionColumn = { name: string; ordinal: number; typeId?: string | number; precision: number | null; scale: number | null; readable: boolean };
export type PgAdmissionTable = { object: string; queryable: boolean; columns: readonly PgAdmissionColumn[] };
export type PgQueryProjection = { ordinal: number; name: string; typeId: number; maxWireBytes: number; source?: { object: string; column: string; ordinal: number }; lengthOf?: { source: { object: string; column: string; ordinal: number }; representation: 'bytea' | 'utf8-text' | 'utf8-json' | 'utf8-jsonb' }; segment?: { startParameter?: number; lengthParameter?: number; start: number; length: number; representation: 'bytea' | 'utf8-text' | 'utf8-json' | 'utf8-jsonb' } };
export type PgQueryAdmission = { sql: string; objects: string[]; projections: PgQueryProjection[]; maxRowWireBytes: number; batchRows: number; parameterUses: Record<number, number>; diagnosticBounded: false; requiredSessionSettings: typeof DB_LINK_PG_OUTPUT_SETTINGS };
export type PgQueryAdmissionInput = { objects: readonly PgAdmissionTable[]; parameters: readonly DbResultParameter[]; budget: Pick<DbLinkBudget, 'maxCellBytes' | 'maxBytes' | 'maxRows'> };
type Ast = Record<string, any>;
type Value = { typeId: number; maxWireBytes: number | null; source?: PgQueryProjection['source']; column?: PgAdmissionColumn; name?: string; parameter?: number; contextOnly?: boolean; segment?: PgQueryProjection['segment']; lengthOf?: PgQueryProjection['lengthOf'] };
const parser = new sqlParser.Parser();
const reject = (code: string, message: string): never => { throw new DbLinkSqlError(code, message); };
const node = (value: unknown): Ast => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Ast : reject('db_pg_expression_unsupported', '当前仅支持已核实类型和最终表示的查询表达式。');
const id = (value: unknown): string => typeof value === 'string' && /^[a-z_][a-z0-9_$]*$/i.test(value) && value.length <= 63 ? value.toLowerCase() : reject('db_pg_identifier_unsupported', '请使用准确的普通 schema.table 和列标识符。');
const fieldName = (value: unknown): string => value === '*' ? '*' : typeof value === 'string' ? id(value) : id(node(node(value).expr).value);
// Exact pg_catalog min/max input OIDs present in PostgreSQL18.1, restricted to our bounded scalar subset.
const extremaInputOids = new Set([20, 21, 23, 26, 700, 701, 1082, 1083, 1114, 1184, 1266, 1700]);
const fixedBytes = new Map<number, number>([[16, 1], [20, 20], [21, 6], [23, 11], [26, 10], [2950, 36], [1082, 16], [1083, 24], [1114, 40], [1184, 48], [1266, 32], [700, 32], [701, 32]]);
function scalarBytes(column: PgAdmissionColumn): number | null {
  const oid = Number(column.typeId);
  if (fixedBytes.has(oid)) return fixedBytes.get(oid)!;
  if (oid === 1700 && Number.isSafeInteger(column.precision) && Number(column.precision) >= 1 && Number(column.precision) <= 1000 && Number.isSafeInteger(column.scale) && Math.abs(Number(column.scale)) <= 1000) {
    const precision = Number(column.precision), scale = Number(column.scale);
    return Math.max(3, 1 + Math.max(1, precision - scale) + (scale > 0 ? 1 + scale : 0)); // NUMERIC NaN remains valid even with a small typmod.
  }
  return null;
}

/** Historical successful DataRow bounds only; not a v0.5 ordinary-query prerequisite. */
export function validateDbLinkPgQuery(sql: string, input: PgQueryAdmissionInput): PgQueryAdmission {
  const checked = validateDbLinkSql(sql, 'postgresql');
  for (const n of [input.budget.maxCellBytes, input.budget.maxBytes, input.budget.maxRows]) if (!Number.isSafeInteger(n) || n <= 0) reject('db_pg_budget_invalid', '单次接收预算必须是有限正整数。');
  if (!Array.isArray(input.parameters) || input.parameters.length > 256) reject('db_pg_parameter_invalid', '数据参数数量或格式无效。');
  const parameterTypes = new Set(['BOOLEAN', 'BOOL', 'SMALLINT', 'INT2', 'INT', 'INTEGER', 'INT4', 'BIGINT', 'INT8', 'NUMERIC', 'DECIMAL', 'REAL', 'FLOAT4', 'FLOAT8', 'DOUBLE PRECISION', 'TEXT', 'VARCHAR', 'CHARACTER VARYING', 'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'UUID']);
  let parameterBytes = 0;
  for (const p of input.parameters) {
    if (!p || typeof p !== 'object' || p.databaseType !== undefined && (typeof p.databaseType !== 'string' || !parameterTypes.has(p.databaseType.toUpperCase()) || p.databaseType.length > 64)) reject('db_pg_parameter_invalid', '参数声明类型尚未核实，只允许已核定的内建数据类型。');
    const size = typeof p.value === 'string' ? Buffer.byteLength(p.value) : 32;
    parameterBytes += size;
    if (size > (p.kind === 'number' ? 1024 : 65536) || parameterBytes > 128 * 1024) reject('db_pg_parameter_invalid', '参数超出单次有界输入资格。');
  }
  const parsed = parser.astify(sql, { database: 'Postgresql' });
  const ast = node(Array.isArray(parsed) ? parsed[0] : parsed);
  if (ast.with != null || ast._next != null) reject('db_pg_query_shape_unsupported', '当前输出证明不支持CTE、集合组合或派生查询，请在授权内拆分查询。');
  const bindings: { alias: string; table: PgAdmissionTable }[] = [];
  for (const value of ast.from ?? []) {
    const source = node(value);
    if (source.expr != null || !source.db || !source.table || source.using != null || source.join && !['INNER JOIN', 'LEFT JOIN'].includes(source.join)) reject('db_pg_query_shape_unsupported', '当前仅支持准确物理表和已核实的INNER／LEFT关联。');
    const object = `${id(source.db)}.${id(source.table)}`, table = input.objects.find(table => table.object === object && table.queryable);
    if (!table) reject('db_pg_object_unverified', `对象 ${object} 尚未通过本次来源／权限／类型核查。`);
    const alias = id(source.as ?? source.table);
    if (bindings.some(binding => binding.alias === alias)) reject('db_pg_column_ambiguous', '表别名重复，无法核实列的实际来源。');
    bindings.push({ alias, table: table! });
  }
  const resolve = (expression: Ast): Value => {
    const name = fieldName(expression.column);
    if (name === '*') reject('db_pg_wildcard_not_allowed', '请明确所需列；行数LIMIT不能约束单字段返回大小。');
    const tables = expression.table ? bindings.filter(binding => binding.alias === id(expression.table)) : bindings;
    const matches = tables.flatMap(({ table }) => table.columns.filter(column => column.name === name && column.readable).map(column => ({ table, column })));
    if (matches.length !== 1) reject('db_pg_column_unverified', '列不存在、未获读取资格或来源不唯一；请使用本次结构中的准确表别名和列。');
    const { table, column } = matches[0]!;
    if (!fixedBytes.has(Number(column.typeId)) && ![17, 25, 1043, 1042, 114, 3802, 1700].includes(Number(column.typeId))) reject('db_pg_type_unverified', '该实际列类型／输出函数尚未核实，不能借布尔或聚合表达式绕过类型资格。');
    return { typeId: Number(column.typeId), maxWireBytes: scalarBytes(column), source: { object: table.object, column: column.name, ordinal: column.ordinal }, column, name };
  };
  const used = new Set<number>(), parameterUses: Record<number, number> = {};
  const functionParts = (raw: unknown): { name: string; args: unknown[] } => {
    const fn = node(raw), name = node(fn.name);
    if (fn.type !== 'function' || !Array.isArray(name.name) || name.name.length !== 1 || name.schema && id(node(name.schema).value) !== 'pg_catalog' || fn.over != null || node(fn.args).type !== 'expr_list' || !Array.isArray(node(fn.args).value)) reject('db_pg_function_unverified', '函数签名尚未核实。');
    return { name: id(node(name.name[0]).value), args: node(fn.args).value };
  };
  const bytes = (raw: unknown): Value & { representation: NonNullable<PgQueryProjection['segment']>['representation'] } => {
    const expr = node(raw);
    if (expr.type === 'column_ref') {
      const value = resolve(expr);
      if (value.typeId !== 17) reject('db_pg_segment_representation', '大字段必须采用bytea字节段；文本字符数不等于字节数。');
      return { ...value, representation: 'bytea' };
    }
    const fn = functionParts(raw);
    if (fn.name !== 'convert_to' || fn.args.length !== 2 || node(fn.args[1]).type !== 'single_quote_string' || node(fn.args[1]).value !== 'UTF8') reject('db_pg_segment_representation', '文本仅支持明确UTF8编码的原列字节表示。');
    const from = node(fn.args[0]);
    if (from.type === 'column_ref') {
      const value = resolve(from);
      if (![25, 1043].includes(value.typeId)) reject('db_pg_segment_representation', 'UTF8转换只接受已核实的text／varchar原列，不能转换任意表达式。');
      return { ...value, typeId: 17, maxWireBytes: null, representation: 'utf8-text' };
    }
    if (from.type === 'cast' && from.expr?.type === 'column_ref' && from.keyword === 'cast' && ['::', 'as'].includes(from.symbol) && Array.isArray(from.target) && from.target.length === 1 && from.target[0].dataType === 'TEXT' && Object.keys(from.target[0]).every(k => k === 'dataType')) {
      const value = resolve(node(from.expr));
      if ([114, 3802].includes(value.typeId)) return { ...value, typeId: 17, maxWireBytes: null, representation: value.typeId === 114 ? 'utf8-json' : 'utf8-jsonb' };
    }
    return reject('db_pg_segment_representation', '只支持已核实JSON／JSONB原列的text表示再转UTF8；一般类型转换不准入。');
  };
  const expression = (raw: unknown, depth = 0): Value => {
    if (depth > 64) reject('db_pg_expression_too_complex', '表达式嵌套过深，请拆分查询。');
    const value = node(raw);
    if (value.type === 'column_ref') return resolve(value);
    if (value.type === 'var') {
      const index = Number(value.name), p = input.parameters[index - 1];
      if (!p || !Number.isSafeInteger(index) || index <= 0) reject('db_pg_parameter_invalid', '参数占位符未绑定准确数据值。');
      used.add(index); parameterUses[index] = (parameterUses[index] ?? 0) + 1;
      if (p.kind === 'boolean' && typeof p.value === 'boolean') return { typeId: 16, maxWireBytes: 1, parameter: index, contextOnly: true };
      if (p.kind === 'null' && p.value === null) return { typeId: 0, maxWireBytes: 0, parameter: index, contextOnly: true };
      if (p.kind === 'number' && (typeof p.value === 'number' && Number.isSafeInteger(p.value) || typeof p.value === 'string' && /^-?\d+(?:\.\d+)?$/.test(p.value))) return { typeId: 1700, maxWireBytes: Buffer.byteLength(String(p.value)), parameter: index, contextOnly: true };
      if (p.kind === 'text' && typeof p.value === 'string') return { typeId: 25, maxWireBytes: Buffer.byteLength(p.value), parameter: index, contextOnly: true };
      reject('db_pg_parameter_invalid', '此参数表示尚未核定，请使用明确的精确数值／文本／布尔／NULL参数。');
    }
    if (value.type === 'number' && Number.isSafeInteger(Number(value.value))) return { typeId: 1700, maxWireBytes: String(value.value).length, contextOnly: true };
    if (value.type === 'bool') return { typeId: 16, maxWireBytes: 1 };
    if (value.type === 'null') return { typeId: 0, maxWireBytes: 0, contextOnly: true };
    if (value.type === 'single_quote_string') return { typeId: 25, maxWireBytes: Buffer.byteLength(value.value) };
    if (value.type === 'aggr_func') {
      const name = String(value.name).toLowerCase(), args = node(value.args);
      if (name === 'count' && node(args.expr).type === 'star' && args.distinct == null) return { typeId: 20, maxWireBytes: 20, name: 'count' };
      const argument = expression(args.expr, depth + 1);
      if (argument.maxWireBytes === null || !argument.source || !['count', 'min', 'max'].includes(name)) reject('db_pg_aggregate_unverified', '该聚合的输入类型、最终表示或错误路径尚未核实；请读取有界明细后自主选择已有计算工具。');
      if (name !== 'count' && !extremaInputOids.has(argument.typeId)) reject('db_pg_aggregate_unverified', '该实际类型没有已核定的MIN／MAX聚合签名；有界原列不等于存在该聚合。');
      return name === 'count' ? { typeId: 20, maxWireBytes: 20, name } : { ...argument, name };
    }
    if (value.type === 'function') {
      const fn = functionParts(value);
      if (fn.name === 'convert_to') return bytes(value);
      if (fn.name === 'octet_length' && fn.args.length === 1) { const raw = bytes(fn.args[0]); return { typeId: 23, maxWireBytes: 11, name: 'octet_length', lengthOf: { source: raw.source!, representation: raw.representation } }; }
      if (['substring', 'substr'].includes(fn.name) && fn.args.length === 3) {
        const raw = bytes(fn.args[0]), startValue = expression(fn.args[1], depth + 1), lengthValue = expression(fn.args[2], depth + 1);
        const integer = (raw: unknown, result: Value): number => {
          const literal = result.parameter ? input.parameters[result.parameter - 1]!.value : node(raw).value;
          if (result.parameter && input.parameters[result.parameter - 1]!.kind !== 'number' || !/^\d+$/.test(String(literal)) || !Number.isSafeInteger(Number(literal)) || Number(literal) < 1 || Number(literal) > 2147483647) reject('db_pg_segment_range_invalid', '段起点／长度须为有效的正整数字节范围。');
          return Number(literal);
        };
        const start = integer(fn.args[1], startValue), length = integer(fn.args[2], lengthValue);
        if (start + length > 2147483647 || 2 * length + 2 > input.budget.maxCellBytes) reject('db_pg_segment_range_invalid', '段范围溢出或hex最终表示超过单字段预算。');
        return { typeId: 17, maxWireBytes: 2 * length + 2, source: raw.source, name: fn.name, segment: { ...(startValue.parameter ? { startParameter: startValue.parameter } : {}), ...(lengthValue.parameter ? { lengthParameter: lengthValue.parameter } : {}), start, length, representation: raw.representation } };
      }
      reject('db_pg_function_unverified', '此函数签名和最终表示尚未核实；请选择有界原列或明确的字节分段。');
    }
    if (value.type === 'binary_expr') {
      const left = expression(value.left, depth + 1), right = expression(value.right, depth + 1), op = String(value.operator);
      if (!['=', '<>', '!=', '<', '>', '<=', '>=', 'IS', 'IS NOT', 'AND', 'OR'].includes(op)) reject('db_pg_operator_unverified', '此运算签名的输出或错误路径尚未核实，请改用获准比较／逻辑条件或已有计算工具。');
      if (['AND', 'OR'].includes(op) && (left.typeId !== 16 || right.typeId !== 16)) reject('db_pg_operator_unverified', '逻辑条件须为已核实的布尔表达式。');
      if (['IS', 'IS NOT'].includes(op) && (right.typeId !== 0 && (right.typeId !== 16 || left.typeId !== 16))) reject('db_pg_operator_unverified', 'IS签名仅支持NULL判断或明确布尔值判断。');
      if (!['IS', 'IS NOT', 'AND', 'OR'].includes(op)) {
        const numeric = [20, 21, 23, 26, 1700, 700, 701], text = [25, 1043];
        const compatible = left.typeId === 0 || right.typeId === 0 || left.typeId === right.typeId || numeric.includes(left.typeId) && numeric.includes(right.typeId) || text.includes(left.typeId) && text.includes(right.typeId);
        if (!compatible) reject('db_pg_operator_unverified', '比较运算输入类型签名不一致；请使用准确类型参数，不能隐式尝试任意文本转换。');
      }
      return { typeId: 16, maxWireBytes: 1 };
    }
    return reject('db_pg_expression_unsupported', '此表达式的最终类型／字节上界尚未核实，请选择获准原列或已支持的计算。');
  };
  for (const source of ast.from ?? []) if (source.on) if (expression(source.on).typeId !== 16) reject('db_pg_condition_invalid', '关联条件必须是布尔表达式。');
  for (const key of ['where', 'having']) if (ast[key] && expression(ast[key]).typeId !== 16) reject('db_pg_condition_invalid', '过滤条件必须是布尔表达式。');
  for (const entry of ast.groupby?.columns ?? []) expression(entry);
  const projections: PgQueryProjection[] = (ast.columns ?? []).map((raw: unknown, index: number) => {
    const item = node(raw), result = expression(item.expr), name = item.as ? id(item.as) : result.name ?? '?column?';
    if (result.contextOnly) reject('db_pg_output_type_unverified', '独立参数／数值字面量的服务器返回类型尚未核实，请返回明确类型原列或已支持的表达式。');
    if (result.maxWireBytes === null || !Number.isSafeInteger(result.maxWireBytes) || result.maxWireBytes > input.budget.maxCellBytes) reject('db_pg_output_unbounded', `第${index + 1}列（${name}）最终值无已核实字节上界或超过单值预算；请使用获准字节分段，不能直接返回／截断整值。`);
    return { ordinal: index + 1, name, typeId: result.typeId, maxWireBytes: result.maxWireBytes, ...(result.source ? { source: result.source } : {}), ...(result.segment ? { segment: result.segment } : {}), ...(result.lengthOf ? { lengthOf: result.lengthOf } : {}) };
  });
  if (!projections.length || projections.length > 64) reject('db_pg_output_columns_limit', '请明确选择1至64个有界返回列。');
  for (const entry of ast.orderby ?? []) {
    const v = node(entry.expr), name = v.type === 'column_ref' && !v.table ? fieldName(v.column) : null;
    if (!name || !projections.some(p => p.name === name)) expression(entry.expr);
  }
  for (const raw of ast.limit?.value ?? []) {
    const value = expression(raw), actual = value.parameter ? input.parameters[value.parameter - 1]!.value : node(raw).value;
    if (!Number.isSafeInteger(Number(actual)) || Number(actual) < 0 || Number(actual) > input.budget.maxRows) reject('db_pg_limit_invalid', 'LIMIT／OFFSET须为单次行预算内的非负整数。');
  }
  if (used.size !== input.parameters.length || input.parameters.some((_p, index) => !used.has(index + 1))) reject('db_pg_parameter_invalid', '参数必须与SQL占位符完整一一绑定，不接受未使用参数。');
  const maxRowWireBytes = 7 + projections.reduce((sum, column) => sum + 4 + column.maxWireBytes, 0);
  const batchBytes = Math.min(input.budget.maxBytes, LEGACY_PG_RESPONSE_WINDOW_BYTES / 2);
  if (!Number.isSafeInteger(maxRowWireBytes) || maxRowWireBytes > batchBytes) reject('db_pg_output_row_limit', '有界列组合仍超过独立工作批次或本次消息预算，请减少同时返回的列／分段长度。');
  return { sql, objects: checked.objects, projections, maxRowWireBytes, batchRows: Math.min(input.budget.maxRows, 128, Math.floor(batchBytes / maxRowWireBytes)), parameterUses, diagnosticBounded: false, requiredSessionSettings: DB_LINK_PG_OUTPUT_SETTINGS };
}
