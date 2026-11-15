import { Client } from 'pg';
import type { ClientConfig } from 'pg';
import Cursor from 'pg-cursor';
import type { Readable } from 'node:stream';
import mysql from 'mysql2';
import type { ConnectionOptions } from 'mysql2';
import { constants as cryptoConstants, createHash } from 'node:crypto';
import { isIP, Socket } from 'node:net';
import type { DbLinkRuntimeConnection, DbLinkScope, DbLinkTestObservation } from './db-link-types.ts';
import type { DbResultCell, DbResultColumn, DbResultParameter, DbResultValueRef } from './db-link-results.ts';
import { DbLinkSqlError, validateDbLinkSql } from './db-link-sql.ts';
import { createDbLinkPgStream } from './db-link-pg-transport.ts';
import type { DbLinkPgReceiveFacts, DbLinkPgStream } from './db-link-pg-transport.ts';

export type DbLinkPgClient = {
  connect(): Promise<void>;
  query(input: unknown, values?: unknown[]): unknown;
  end(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
};
export type DbLinkMysqlClient = {
  /** The Host's own socket observation, never mysql2's private connection.stream. */
  transportClosed?: Promise<void>;
  connect(callback: (error: Error | null) => void): void;
  query(input: unknown, values: unknown, callback: (error: Error | null, rows: unknown) => void): unknown;
  end(callback: (error?: Error) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  execute?(sql: string, values: unknown[]): DbLinkMysqlQuery;
};
export type DbLinkMysqlQuery = { on(event: string, listener: (...args: unknown[]) => void): unknown; stream(options: { highWaterMark: number }): Readable };
type PgField = { name: string; dataTypeID: number; tableID?: number; columnID?: number };
export type DbLinkPgCursor = {
  read(rows: number, callback: (error: Error | undefined, rows: unknown[][], result?: { fields: PgField[]; rowCount?: number | null }) => void): unknown;
  close(): Promise<void>;
};
export type DbLinkDriverDependencies = {
  postgresClient?: (configuration: ClientConfig) => DbLinkPgClient;
  postgresCursor?: (sql: string, parameters: unknown[], options: { rowMode: 'array'; types: { getTypeParser(oid: number, format?: string): (value: string) => string } }) => DbLinkPgCursor;
  mysqlConnection?: (configuration: ConnectionOptions) => DbLinkMysqlClient;
};
type NativeRow = Record<string, unknown>;
export type DbLinkColumn = DbResultColumn & { comment: string | null; commentBytes?: number | null; commentTruncated?: boolean; readable: boolean };
export type DbLinkForeignKey = { name: string; columns: string[]; referencedObject: string; referencedColumns: string[] };
export type DbLinkTable = {
  object: string; schema: string; name: string; kind: string; queryable: boolean; limitations: string[];
  nativeId?: string; comment: string | null; commentBytes?: number | null; commentTruncated?: boolean; columns: DbLinkColumn[]; primaryKey: string[]; foreignKeys: DbLinkForeignKey[];
};
export type DbLinkCatalog = {
  observation: DbLinkTestObservation; objects: DbLinkTable[]; completeness: 'complete' | 'partial';
  identifierCase?: 'exact' | 'fold';
  limitations: string[]; session: { timezone: string; encoding: string; isolation: string; sqlMode?: string; loginRole?: string; effectiveRole?: string; visibleScope?: 'current-account-visible'; serverVersionNum?: string };
  resourceState?: DbLinkCleanupState;
  /** Host-only retained resource; never serialize or expose as an Agent capability. */
  cleanup?: () => Promise<DbLinkCleanupState>;
  receiveFacts?: { original: Readonly<DbLinkPgReceiveFacts>; observer?: Readonly<DbLinkPgReceiveFacts> };
};
export type DbLinkCleanupState = { remoteTerminal: boolean; connectionEnded: boolean; commandTerminal: boolean; transactionEnded: boolean };
export type DbLinkQueryRequest = {
  sql: string; parameters: DbResultParameter[]; scope: DbLinkScope;
  /** Legacy field name: Host project authorization ceiling, not a native database isolation claim. */
  nativeScope?: DbLinkScope;
  expectedSourceIdentity: string; expectedPermissionBinding: string; signal?: AbortSignal;
  remainingBudgetMs?: () => number;
  segmentRead?: { valueColumn: number; totalBytesColumn: number; keyColumns: number[] };
  onValueSegment?: (segment: { row: number; column: number; totalBytes: number; representation: 'utf8' | 'binary'; databaseType: string; stableKey: string[]; offset: number; base64: string; transportParameters?: { parameter: number; value: string | number }[] }) => Promise<DbResultValueRef | undefined>;
  onColumns: (columns: DbResultColumn[], context: Pick<DbLinkCatalog, 'observation' | 'session'> & Partial<Pick<DbLinkCatalog, 'objects' | 'limitations'>>) => void | Promise<void>;
  onRows: (rows: DbResultCell[][]) => void | Promise<void>;
};

function validateSegmentRequest(request: DbLinkQueryRequest): void {
  if (!request.segmentRead) return;
  const plan = request.segmentRead;
  const index = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < 64;
  if (!index(plan.valueColumn) || !index(plan.totalBytesColumn) || plan.valueColumn === plan.totalBytesColumn || !Array.isArray(plan.keyColumns)
    || !plan.keyColumns.length || plan.keyColumns.length > 32 || plan.keyColumns.some(value => !index(value) || value === plan.valueColumn || value === plan.totalBytesColumn)
    || new Set(plan.keyColumns).size !== plan.keyColumns.length || typeof request.onValueSegment !== 'function') throw new DbLinkDriverError('db_segment_plan_invalid');
  throw new DbLinkDriverError('db_segment_read_unsupported');
}
export type DbLinkQueryTerminal = {
  /** false proves no native operation resource was created; true includes connection/preparation, not only business SQL. */
  dispatched?: boolean;
  status: 'completed' | 'cancelled' | 'error' | 'unknown'; remoteTerminal: boolean; connectionEnded: boolean;
  rowsReceived: number; serverRowCount: string | null; columns: DbResultColumn[]; limitations: string[];
  sourceIdentity: string; permissionBinding: string; session: DbLinkCatalog['session']; errorCode?: string;
  resourceState?: DbLinkCleanupState;
  cleanup?: () => Promise<DbLinkCleanupState>;
  receiveFacts?: { original: Readonly<DbLinkPgReceiveFacts>; observer?: Readonly<DbLinkPgReceiveFacts> };
};

export class DbLinkDriverError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'DbLinkDriverError'; this.code = code; }
}

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown): string => typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
const flag = (value: unknown): boolean => value === true || value === 't' || value === 1 || value === '1';
const integer = (value: unknown): number | null => value === null || value === undefined || value === '' ? null : Number.isSafeInteger(Number(value)) ? Number(value) : null;
const identifier = /^[a-z_][a-z0-9_$]*$/i;
const blankObservation = (): DbLinkTestObservation => ({ reachable: false, queryQualified: false, sourceIdentity: '', permissionBinding: '', cancelCapability: 'unverified', limitations: [] });
const blankCatalog = (): DbLinkCatalog => ({ observation: blankObservation(), objects: [], completeness: 'partial', limitations: [], session: { timezone: 'unknown', encoding: 'unknown', isolation: 'unknown' } });

async function pgRows(client: DbLinkPgClient, sql: string, values: unknown[] = []): Promise<NativeRow[]> {
  const result = await client.query({ text: sql, values });
  if (!result || typeof result !== 'object' || !Array.isArray((result as { rows?: unknown }).rows)) throw new Error('db_metadata_response_invalid');
  return (result as { rows: NativeRow[] }).rows;
}

// Fixed Host catalog queries contain no business samples or session query history.
const PG_IDENTITY = `/* db-link:identity */ SELECT current_setting('server_version_num') AS server_version_num,
  current_database() AS database, current_user, session_user, inet_server_addr()::text AS server_address,
  inet_server_port() AS server_port, current_setting('TimeZone') AS timezone,
  current_setting('client_encoding') AS encoding, current_setting('transaction_isolation') AS isolation,
  current_setting('DateStyle') AS datestyle,current_setting('IntervalStyle') AS intervalstyle,current_setting('bytea_output') AS bytea_output,
  current_setting('extra_float_digits') AS extra_float_digits,
  current_setting('search_path') AS search_path, current_setting('statement_timeout') AS statement_timeout,
  current_setting('lock_timeout') AS lock_timeout,
  (SELECT setting::int FROM pg_catalog.pg_settings WHERE name='statement_timeout') AS statement_timeout_ms,
  (SELECT setting::int FROM pg_catalog.pg_settings WHERE name='lock_timeout') AS lock_timeout_ms`;
const PG_ROLES = `/* db-link:roles */ SELECT oid, rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls,
  pg_has_role(session_user,oid,'USAGE') AS inherited_now, pg_has_role(session_user,oid,$1) AS can_set_role
  FROM pg_catalog.pg_roles WHERE rolname=session_user OR pg_has_role(session_user,oid,'USAGE') OR pg_has_role(session_user,oid,$1) ORDER BY oid`;
const PG_NAMESPACE = `/* db-link:namespace */ SELECT
  EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE
    (pg_has_role(session_user,r.oid,'USAGE') OR pg_has_role(session_user,r.oid,$1)) AND
    (EXISTS(SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname=current_database() AND
      (d.datdba=r.oid OR has_database_privilege(r.oid,d.oid,'CREATE,TEMPORARY')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE
      n.nspowner=r.oid OR has_schema_privilege(r.oid,n.oid,'CREATE')))) AS unsafe`;
const PG_RELATIONS = `/* db-link:relations */ SELECT c.oid,n.nspname AS schema,c.relname AS name,c.relkind AS kind,
  (pg_has_role(session_user,c.relowner,'USAGE') OR pg_has_role(session_user,c.relowner,$2)) AS owner_reachable,
  EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE
    (pg_has_role(session_user,r.oid,'USAGE') OR pg_has_role(session_user,r.oid,$2)) AND
    (has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR CASE WHEN current_setting('server_version_num')::int>=170000 THEN has_table_privilege(r.oid,c.oid,'MAINTAIN') ELSE false END)) AS writable,
  has_any_column_privilege(c.oid,'SELECT') AS readable,c.relrowsecurity AS row_security,c.relforcerowsecurity AS forced_row_security,
  am.amname AS access_method,pg_catalog.left(obj_description(c.oid,'pg_class'),$1) AS comment,
  pg_catalog.octet_length(obj_description(c.oid,'pg_class')) AS comment_bytes,
  COALESCE(pg_catalog.octet_length(obj_description(c.oid,'pg_class'))>pg_catalog.octet_length(pg_catalog.left(obj_description(c.oid,'pg_class'),$1)),false) AS comment_truncated,
  EXISTS(SELECT 1 FROM pg_catalog.pg_inherits h WHERE h.inhparent=c.oid OR h.inhrelid=c.oid) AS inherited,
  EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
    JOIN pg_catalog.pg_am ia ON ia.oid=ic.relam WHERE i.indrelid=c.oid AND
      (i.indexprs IS NOT NULL OR i.indpred IS NOT NULL OR ia.amname NOT IN ('btree','hash','gist','spgist','gin','brin')
      OR EXISTS(SELECT 1 FROM unnest(i.indclass::oid[]) oc(oid) JOIN pg_catalog.pg_opclass op ON op.oid=oc.oid
        JOIN pg_catalog.pg_namespace ns ON ns.oid=op.opcnamespace WHERE ns.nspname<>'pg_catalog'))) AS unsafe_index
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_catalog.pg_am am ON am.oid=c.relam WHERE c.relkind IN ('r','p','v','m','f') ORDER BY n.nspname,c.relname`;
const PG_COLUMNS = `/* db-link:columns */ SELECT a.attrelid AS relation_oid,a.attname AS name,a.attnum AS ordinal,
  a.atttypid AS type_id,pg_catalog.format_type(a.atttypid,a.atttypmod) AS database_type,tn.nspname AS type_schema,
  en.nspname AS element_schema,has_column_privilege(a.attrelid,a.attnum,'SELECT') AS readable,
  EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE
    (pg_has_role(session_user,r.oid,'USAGE') OR pg_has_role(session_user,r.oid,$2)) AND
    has_column_privilege(r.oid,a.attrelid,a.attnum,'INSERT,UPDATE,REFERENCES')) AS writable,
  a.attgenerated AS generated,NOT a.attnotnull AS nullable,pg_catalog.left(col_description(a.attrelid,a.attnum),$1) AS comment,
  pg_catalog.octet_length(col_description(a.attrelid,a.attnum)) AS comment_bytes,
  COALESCE(pg_catalog.octet_length(col_description(a.attrelid,a.attnum))>pg_catalog.octet_length(pg_catalog.left(col_description(a.attrelid,a.attnum),$1)),false) AS comment_truncated,
  CASE WHEN a.atttypid=1700 AND a.atttypmod>=4 THEN ((a.atttypmod-4)>>16)&65535 ELSE NULL END AS precision,
  CASE WHEN a.atttypid=1700 AND a.atttypmod>=4 THEN (((a.atttypmod-4)&2047)#1024)-1024 ELSE NULL END AS scale
  FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
  JOIN pg_catalog.pg_type t ON t.oid=a.atttypid JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace
  LEFT JOIN pg_catalog.pg_type et ON et.oid=t.typelem LEFT JOIN pg_catalog.pg_namespace en ON en.oid=et.typnamespace
  WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f') ORDER BY a.attrelid,a.attnum`;
const PG_KEYS = `/* db-link:keys */ SELECT k.conrelid AS relation_oid,k.conname AS name,k.contype AS kind,
  array_agg(a.attname::text ORDER BY u.ordinality) AS columns,
  rn.nspname||'.'||rc.relname AS referenced_object,array_agg(ra.attname::text ORDER BY u.ordinality) AS referenced_columns
  FROM pg_catalog.pg_constraint k JOIN LATERAL unnest(k.conkey) WITH ORDINALITY u(attnum,ordinality) ON true
  JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.attnum
  LEFT JOIN pg_catalog.pg_class rc ON rc.oid=k.confrelid LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid=rc.relnamespace
  LEFT JOIN pg_catalog.pg_attribute ra ON ra.attrelid=k.confrelid AND ra.attnum=k.confkey[u.ordinality]
  WHERE k.contype IN ('p','f') GROUP BY k.oid,k.conrelid,k.conname,k.contype,rn.nspname,rc.relname ORDER BY k.conrelid,k.conname`;

async function inspectPg(client: DbLinkPgClient, c: Readonly<DbLinkRuntimeConnection>): Promise<DbLinkCatalog> {
  const catalog = blankCatalog(); catalog.observation.reachable = true;
  const global = catalog.observation.limitations;
  const [identity] = await pgRows(client, PG_IDENTITY);
  if (!identity || !Number.isSafeInteger(Number(identity.server_version_num))) global.push('db_server_version_unknown');
  // This release has real dependency evidence for PG18.1 only. This is not
  // an API minimum or an instruction to upgrade other trusted sources.
  if (text(identity?.server_version_num) !== '180001') global.push('db_pg_version_not_validated');
  const roleReach = Number(identity?.server_version_num) >= 160000 ? 'SET' : 'MEMBER';
  catalog.session = { timezone: text(identity?.timezone) || 'unknown', encoding: text(identity?.encoding) || 'unknown', isolation: text(identity?.isolation) || 'unknown',
    ...(text(identity?.server_version_num) ? { serverVersionNum: text(identity?.server_version_num) } : {}),
    ...(text(identity?.session_user) && text(identity?.current_user) ? { loginRole: text(identity?.session_user), effectiveRole: text(identity?.current_user), visibleScope: 'current-account-visible' as const } : {}) };
  if (catalog.session.timezone !== 'UTC' || catalog.session.encoding !== 'UTF8' || identity?.datestyle !== 'ISO, YMD'
    || identity?.intervalstyle !== 'postgres' || identity?.bytea_output !== 'hex' || text(identity?.extra_float_digits) !== '3') global.push('db_output_format_unverified');
  if (text(identity?.current_user) !== text(identity?.session_user) || text(identity?.session_user) !== c.username) global.push('db_login_role_changed');
  if (!text(identity?.database) || !text(identity?.session_user)) global.push('db_source_identity_unknown');
  else catalog.observation.sourceIdentity = `postgresql:${hash({
    connection: { id: c.id, revision: c.revision, fingerprint: c.fingerprint, host: c.host, port: c.port, database: c.database, username: c.username },
    observed: { database: identity.database, login: identity.session_user, effective: identity.current_user,
      address: identity.server_address ?? null, port: identity.server_port ?? null, version: identity.server_version_num },
  })}`;
  catalog.limitations.push('db_endpoint_identity_not_physical_instance_proof');
  if (text(identity?.search_path) !== 'pg_catalog') global.push('db_search_path_unverified');
  if (!(Number(identity?.statement_timeout_ms) > 0 && Number(identity?.statement_timeout_ms) <= c.budget.queryTimeoutMs)) global.push('db_statement_budget_unverified');
  if (!(Number(identity?.lock_timeout_ms) > 0 && Number(identity?.lock_timeout_ms) <= c.budget.lockTimeoutMs)) global.push('db_lock_budget_unverified');
  const roles = await pgRows(client, PG_ROLES, [roleReach]);
  if (!roles.length) global.push('db_native_role_unknown');
  const administrativeRoles = new Set(['pg_signal_backend','pg_signal_autovacuum_worker','pg_execute_server_program','pg_read_server_files','pg_write_server_files','pg_write_all_data','pg_maintain','pg_create_subscription','pg_checkpoint','pg_monitor','pg_read_all_stats','pg_read_all_settings','pg_use_reserved_connections']);
  if (roles.some(role => administrativeRoles.has(text(role.rolname)) || ['rolsuper','rolcreaterole','rolcreatedb','rolreplication','rolbypassrls'].some(key => flag(role[key])))) global.push('db_native_privileged_role');
  if ((await pgRows(client, PG_NAMESPACE, [roleReach])).some(row => flag(row.unsafe))) global.push('db_native_ddl_privilege');
  // UTF8 uses at most four bytes per character. This is a server-side prefix,
  // independent of a large operation total; full comments never enter pg's decoder.
  const commentCharacters = Math.floor(Math.min(c.budget.maxCellBytes, 16 * 1024) / 4);
  const relations = await pgRows(client, PG_RELATIONS, [commentCharacters, roleReach]), columns = await pgRows(client, PG_COLUMNS, [commentCharacters, roleReach]);
  const commentsPartial = [...relations, ...columns].some(row => flag(row.comment_truncated));
  if (commentsPartial) catalog.limitations.push('db_metadata_comment_truncated');
  const builtinSessionView = (row: NativeRow): boolean => row.schema === 'pg_catalog' && row.name === 'pg_settings' && row.kind === 'v';
  const ignoredWriteOids = new Set(relations.filter(builtinSessionView).map(row => text(row.oid)));
  if (relations.some(row => !builtinSessionView(row) && (flag(row.writable) || flag(row.owner_reachable)))
    || columns.some(row => !ignoredWriteOids.has(text(row.relation_oid)) && flag(row.writable))) global.push('db_native_write_privilege');
  for (const relation of relations) {
    if (!flag(relation.readable) || ['pg_catalog','information_schema'].includes(text(relation.schema)) || text(relation.schema).startsWith('pg_')) continue;
    const limitations: string[] = [];
    if (!['r','v'].includes(text(relation.kind))) limitations.push('db_relation_kind_not_supported');
    if (!identifier.test(text(relation.schema)) || !identifier.test(text(relation.name))) limitations.push('db_object_identifier_not_supported');
    const nativeColumns = columns.filter(column => text(column.relation_oid) === text(relation.oid));
    if (!nativeColumns.length) limitations.push('db_columns_unknown');
    if (nativeColumns.some(column => text(column.type_schema) !== 'pg_catalog' || text(column.element_schema) && text(column.element_schema) !== 'pg_catalog')) limitations.push('db_custom_type_not_verified');
    const queryable = limitations.length === 0;
    if (relation.kind === 'v') limitations.push('db_view_scope_not_independently_verified');
    if (flag(relation.row_security)) limitations.push('db_current_role_policy_visible_scope');
    catalog.objects.push({ object: `${relation.schema}.${relation.name}`, nativeId: text(relation.oid), schema: text(relation.schema), name: text(relation.name), kind: text(relation.kind),
      queryable, limitations, comment: relation.comment === null ? null : text(relation.comment), commentBytes: integer(relation.comment_bytes), commentTruncated: flag(relation.comment_truncated), primaryKey: [], foreignKeys: [],
      columns: nativeColumns.map(column => ({ ordinal: integer(column.ordinal) ?? 0, name: text(column.name), databaseType: text(column.database_type),
        typeId: text(column.type_id), precision: integer(column.precision), scale: integer(column.scale), nullable: flag(column.nullable),
        readable: flag(column.readable), comment: column.comment === null ? null : text(column.comment), commentBytes: integer(column.comment_bytes), commentTruncated: flag(column.comment_truncated) })) });
  }
  await pgRows(client, 'SAVEPOINT db_link_optional_keys');
  try {
    for (const key of await pgRows(client, PG_KEYS)) {
      const relation = relations.find(row => text(row.oid) === text(key.relation_oid));
      const table = catalog.objects.find(object => object.object === `${relation?.schema}.${relation?.name}`);
      if (!table || !Array.isArray(key.columns)) continue;
      if (key.kind === 'p') table.primaryKey = key.columns.map(text);
      if (key.kind === 'f' && Array.isArray(key.referenced_columns)) table.foreignKeys.push({ name: text(key.name), columns: key.columns.map(text), referencedObject: text(key.referenced_object), referencedColumns: key.referenced_columns.map(text) });
    }
    catalog.completeness = commentsPartial ? 'partial' : 'complete';
  } catch (error) {
    // An optional catalog SQL error aborts the real PostgreSQL transaction.
    // Restore only after an original native error response; lost responses or
    // failed recovery cannot be converted into a partial-but-usable source.
    if (!remoteError(error)) throw error;
    await pgRows(client, 'ROLLBACK TO SAVEPOINT db_link_optional_keys');
    catalog.limitations.push('db_relationships_unknown');
  }
  await pgRows(client, 'RELEASE SAVEPOINT db_link_optional_keys');
  const roleFacts = roles.map(row => ['oid','rolname','rolsuper','rolcreaterole','rolcreatedb','rolreplication','rolbypassrls','inherited_now','can_set_role'].map(key => row[key] ?? null));
  const domain = relations.filter(row => !['pg_catalog','information_schema'].includes(text(row.schema)) && !text(row.schema).startsWith('pg_')
    && (flag(row.readable) || flag(row.writable) || flag(row.owner_reachable)));
  const domainIds = new Set(domain.map(row => text(row.oid)));
  // Authorization binds reachable roles, native objects/ACL and real types. Source
  // comments, optional relationships and unavailable descriptive text are not grants.
  const relationFacts = domain.map(row => ['oid','schema','name','kind','owner_reachable','writable','readable','row_security','forced_row_security'].map(key => row[key] ?? null));
  const columnFacts = columns.filter(row => domainIds.has(text(row.relation_oid))).map(row =>
    ['relation_oid','name','ordinal','type_id','database_type','type_schema','element_schema','readable','writable','generated','nullable','precision','scale'].map(key => row[key] ?? null));
  catalog.observation.permissionBinding = hash({ identity: catalog.observation.sourceIdentity, roles: roleFacts, relations: relationFacts, columns: columnFacts });
  catalog.observation.queryQualified = global.length === 0;
  return catalog;
}

function parameterValues(parameters: DbResultParameter[], engine: 'postgresql' | 'mysql'): unknown[] {
  if (!Array.isArray(parameters) || parameters.length > 65535) throw new DbLinkDriverError('db_parameters_invalid');
  return parameters.map(parameter => {
    let value: unknown;
    if (parameter.kind === 'null' && parameter.value === null) value = null;
    else if (parameter.kind === 'text' && typeof parameter.value === 'string') value = parameter.value;
    else if (parameter.kind === 'boolean' && typeof parameter.value === 'boolean') value = parameter.value;
    else if (parameter.kind === 'number' && typeof parameter.value === 'number' && Number.isFinite(parameter.value)
      && (!Number.isInteger(parameter.value) || Number.isSafeInteger(parameter.value))) value = parameter.value;
    else if (engine === 'postgresql' && parameter.kind === 'number' && typeof parameter.value === 'string' && parameter.value.length <= 1024
      && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(parameter.value)) value = parameter.value;
    else if (parameter.kind === 'binary' && typeof parameter.value === 'string' && Buffer.from(parameter.value, 'base64').toString('base64') === parameter.value) value = Buffer.from(parameter.value, 'base64');
    else throw new DbLinkDriverError('db_parameter_invalid_or_inexact');
    if (engine === 'postgresql') return value;
    if (value === null) return mysql.TypedParameter.NULL();
    if (Buffer.isBuffer(value)) return mysql.TypedParameter.BLOB(value);
    if (typeof value === 'boolean') return mysql.TypedParameter.TINY(value);
    if (typeof value === 'number') return mysql.TypedParameter.DOUBLE(value);
    // Temporal strings deliberately use VARCHAR, never the driver's Date encoder.
    const declared = parameter.databaseType?.toLowerCase();
    if (declared === 'bigint') return mysql.TypedParameter.LONGLONG(value as string);
    if (declared === 'decimal' || declared === 'numeric') return mysql.TypedParameter.NEWDECIMAL(value as string);
    return mysql.TypedParameter.VARCHAR(value as string);
  });
}

function authorizeQuery(catalog: DbLinkCatalog, request: DbLinkQueryRequest, objects: string[]): void {
  if (catalog.observation.sourceIdentity !== request.expectedSourceIdentity || catalog.observation.permissionBinding !== request.expectedPermissionBinding) throw new DbLinkDriverError('db_source_binding_changed');
  const normalize = (object: string): string => catalog.identifierCase === 'fold' ? object.toLowerCase() : object;
  const native = catalog.objects.map(object => normalize(object.object)).sort();
  const project = request.nativeScope ?? request.scope;
  const projectObjects = project.objects.length === 1 && project.objects[0] === '*' ? native : [...new Set(project.objects.map(normalize))].sort();
  // Native account domain N, Host project ceiling P and task scope T are
  // independent facts: Q subset T subset P subset N. Host scope does not
  // pretend to change the server account, view or RLS permission domain.
  if (projectObjects.some(object => !native.includes(object))) throw new DbLinkDriverError('db_native_scope_mismatch');
  const taskObjects = request.scope.objects.length === 1 && request.scope.objects[0] === '*' ? projectObjects : request.scope.objects.map(normalize);
  if (taskObjects.some(object => !projectObjects.includes(object))) throw new DbLinkDriverError('db_task_scope_exceeds_project');
  for (const object of objects) {
    if (!taskObjects.includes(normalize(object))) throw new DbLinkDriverError('db_query_object_not_authorized');
    if (!catalog.objects.find(table => normalize(table.object) === normalize(object))?.queryable) throw new DbLinkDriverError('db_query_object_not_qualified');
  }
  if (!catalog.observation.queryQualified) throw new DbLinkDriverError('db_native_not_qualified');
}

function resultCell(value: unknown, pgType?: number): DbResultCell {
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return { type: 'binary', base64: value.toString('base64') };
  if (typeof value === 'string') {
    if (pgType === 17) {
      if (!/^\\x(?:[0-9a-f]{2})*$/i.test(value)) throw new DbLinkDriverError('db_binary_encoding_unverified');
      return { type: 'binary', base64: Buffer.from(value.slice(2), 'hex').toString('base64') };
    }
    return value;
  }
  if (typeof value === 'number') return { type: 'float', value: String(value) };
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  throw new DbLinkDriverError('db_result_type_not_preserved');
}
function resultBudget(c: Readonly<DbLinkRuntimeConnection>) {
  let rows = 0, bytes = 0;
  return (batch: DbResultCell[][]): void => {
    if (rows + batch.length > c.budget.maxRows) throw new DbLinkDriverError('db_result_row_limit');
    for (const row of batch) for (const cell of row) {
      const size = cell && typeof cell === 'object' && cell.type === 'binary' ? Buffer.from(cell.base64, 'base64').length : Buffer.byteLength(typeof cell === 'string' ? cell : JSON.stringify(cell));
      if (size > c.budget.maxCellBytes) throw new DbLinkDriverError('db_result_cell_limit');
    }
    bytes += batch.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row)) + 1, 0);
    if (bytes > c.budget.maxBytes) throw new DbLinkDriverError('db_result_byte_limit');
    rows += batch.length;
  };
}
function remoteError(error: unknown): boolean {
  const e = error as { code?: string; sqlState?: string; fatal?: boolean };
  return !e?.fatal && (typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) && !e.code.startsWith('08')
    || typeof e?.sqlState === 'string' && /^[0-9A-Z]{5}$/.test(e.sqlState) && !e.sqlState.startsWith('08'));
}
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && /^[a-zA-Z0-9_]{1,100}$/.test(code) ? code : 'db_driver_operation_failed';
}

function queryTerminal(): DbLinkQueryTerminal {
  return { status: 'error', remoteTerminal: false, connectionEnded: false, rowsReceived: 0, serverRowCount: null, columns: [], limitations: [], sourceIdentity: '', permissionBinding: '',
    session: { timezone: 'unknown', encoding: 'unknown', isolation: 'unknown' } };
}

type PgPending = { promise: Promise<unknown>; settled: boolean };
function pgBefore<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const ms = Math.floor(deadline - performance.now());
  if (ms <= 0) return Promise.reject(new DbLinkDriverError('db_operation_budget_exhausted'));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DbLinkDriverError('db_operation_budget_exhausted')), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

/** One native resource held by the existing owner; no independent lifecycle registry. */
class PgOwnedOperation {
  readonly configuration: Readonly<DbLinkRuntimeConnection>;
  readonly client: DbLinkPgClient;
  readonly deadline: number;
  private pending?: PgPending;
  private localEnded = false;
  private ending?: Promise<void>;
  private cleanupPending?: Promise<DbLinkCleanupState>;
  private cursor?: DbLinkPgCursor;
  private rollback?: Promise<void>;
  private readonly signal?: AbortSignal;
  private readonly remainingBudgetMs?: () => number;
  private readonly transport?: DbLinkPgStream;
  commandTerminal = true;
  transactionEnded = true;
  wireLost = false;
  closing = false;

  constructor(c: Readonly<DbLinkRuntimeConnection>, dependencies: DbLinkDriverDependencies, deadline = performance.now() + c.budget.queryTimeoutMs, request?: Pick<DbLinkQueryRequest, 'signal' | 'remainingBudgetMs'>) {
    this.configuration = structuredClone(c); this.deadline = deadline;
    this.signal = request?.signal; this.remainingBudgetMs = request?.remainingBudgetMs;
    if (dependencies.postgresClient) this.client = dependencies.postgresClient(pgConfiguration(c));
    else {
      this.transport = createDbLinkPgStream(c.budget.maxBytes);
      this.client = new Client(pgConfiguration(c, this.transport)) as unknown as DbLinkPgClient;
    }
    this.client.on('error', () => { this.wireLost = true; });
    this.client.on('end', () => { this.localEnded = true; if (!this.closing) this.wireLost = true; });
  }
  remaining(): number { return Math.floor(Math.min(this.deadline - performance.now(), this.remainingBudgetMs?.() ?? this.configuration.budget.queryTimeoutMs)); }
  admit(): void {
    if (this.signal?.aborted) throw new DbLinkDriverError('db_query_stopped');
    if (!Number.isFinite(this.remaining()) || this.remaining() <= 0) throw new DbLinkDriverError('db_operation_budget_exhausted');
  }
  private track<T>(work: () => Promise<T>, deadline: number): Promise<T> {
    if (this.pending && !this.pending.settled) return Promise.reject(new DbLinkDriverError('db_original_command_pending'));
    if (performance.now() >= deadline) return Promise.reject(new DbLinkDriverError('db_operation_budget_exhausted'));
    const pending: PgPending = { promise: Promise.resolve().then(work), settled: false };
    pending.promise.then(() => { pending.settled = true; }, () => { pending.settled = true; }); this.pending = pending;
    return pgBefore(pending.promise as Promise<T>, deadline);
  }
  async connect(): Promise<void> { this.admit(); await this.track(() => this.client.connect(), this.deadline); }
  async rows(sql: string, values: unknown[] = []): Promise<NativeRow[]> {
    this.admit();
    return this.track(async () => {
      // A settled connect rejection dispatched no command. Once an actual SQL
      // call starts, only its original success/SQLSTATE response can close it.
      this.commandTerminal = false;
      try { const rows = await pgRows(this.client, sql, values); this.commandTerminal = true; return rows; }
      catch (error) { if (remoteError(error)) this.commandTerminal = true; else this.wireLost = true; throw error; }
    }, this.deadline);
  }
  async beginReadOnly(): Promise<void> {
    const [capabilities] = await this.rows(`/* db-link:capabilities */ SELECT
      pg_catalog.current_setting('transaction_timeout',true) AS transaction_timeout`);
    const budget = this.remaining(), lock = Math.min(budget, this.configuration.budget.lockTimeoutMs);
    if (budget <= 0) throw new DbLinkDriverError('db_operation_budget_exhausted');
    // PG17+ has an additional total transaction bound. Older endpoints retain
    // statement, lock and idle-transaction bounds and the one operation deadline.
    const transactionTimeout = capabilities?.transaction_timeout !== null && capabilities?.transaction_timeout !== undefined;
    await this.rows(`SELECT pg_catalog.set_config('statement_timeout',$1,false),pg_catalog.set_config('idle_in_transaction_session_timeout',$1,false),pg_catalog.set_config('lock_timeout',$2,false)${transactionTimeout ? ",pg_catalog.set_config('transaction_timeout',$1,false)" : ''}`, [`${budget}ms`, `${lock}ms`]);
    const [settings] = await this.rows(`/* db-link:transaction-settings */ SELECT
      (SELECT setting::int FROM pg_catalog.pg_settings WHERE name='transaction_timeout') AS transaction_timeout_ms,
      (SELECT setting::int FROM pg_catalog.pg_settings WHERE name='statement_timeout') AS statement_timeout_ms,
      (SELECT setting::int FROM pg_catalog.pg_settings WHERE name='idle_in_transaction_session_timeout') AS idle_timeout_ms,
      (SELECT setting::int FROM pg_catalog.pg_settings WHERE name='lock_timeout') AS lock_timeout_ms,
      pg_catalog.current_setting('default_transaction_read_only') AS read_only`);
    if (!(Number(settings?.statement_timeout_ms) > 0 && Number(settings?.statement_timeout_ms) <= budget
      && Number(settings?.idle_timeout_ms) > 0 && Number(settings?.idle_timeout_ms) <= budget
      && Number(settings?.lock_timeout_ms) > 0 && Number(settings?.lock_timeout_ms) <= lock && settings?.read_only === 'on')
      || transactionTimeout && !(Number(settings?.transaction_timeout_ms) > 0 && Number(settings?.transaction_timeout_ms) <= budget)) throw new DbLinkDriverError('db_transaction_budget_unverified');
    this.transactionEnded = false;
    await this.rows('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  }
  attachCursor(cursor: DbLinkPgCursor): void {
    this.admit();
    if (this.cursor) throw new DbLinkDriverError('db_original_cursor_pending');
    this.cursor = cursor; this.commandTerminal = false; this.client.query(cursor);
  }
  async readCursor(rows: number, onDecoded: (rowCount: number) => void): Promise<{ rows: unknown[][]; fields?: PgField[] }> {
    this.admit();
    if (!this.cursor) throw new DbLinkDriverError('db_query_cursor_missing');
    return this.track(() => new Promise<{ rows: unknown[][]; fields?: PgField[] }>((resolve, reject) => {
      this.cursor!.read(rows, (error, values, metadata) => {
        if (error) { reject(error); return; }
        // The public cursor callback is the earliest known decoded acquisition.
        // Retain this technical fact even after a local deadline/stop wins; it
        // does not authorize subsequent column/row delivery or a new read.
        if (!Array.isArray(values)) { reject(new DbLinkDriverError('db_result_shape_invalid')); return; }
        onDecoded(values.length);
        resolve({ rows: values, fields: metadata?.fields });
      });
    }), this.deadline);
  }
  async deliver(work: () => void | Promise<void>): Promise<void> {
    this.admit();
    try { await this.track(async () => { await work(); }, this.deadline); }
    catch (error) { if (error instanceof DbLinkDriverError) throw error; throw new DbLinkDriverError('db_result_delivery_failed'); }
    this.admit();
  }
  state(): DbLinkCleanupState {
    // remoteTerminal names the original command/transaction terminal, not the
    // disappearance of a server session. A lost wire cannot supply missing facts.
    return { remoteTerminal: this.commandTerminal && this.transactionEnded && (!this.pending || this.pending.settled),
      connectionEnded: this.localEnded && (!this.transport || this.transport.facts.closed),
      commandTerminal: this.commandTerminal && (!this.pending || this.pending.settled), transactionEnded: this.transactionEnded };
  }
  receiveFacts(): DbLinkCatalog['receiveFacts'] { return this.transport ? { original: this.transport.facts } : undefined; }
  cleanup = (): Promise<DbLinkCleanupState> => {
    const known = this.state();
    if (known.remoteTerminal && known.connectionEnded && known.commandTerminal && known.transactionEnded) return Promise.resolve(known);
    if (this.cleanupPending) return this.cleanupPending;
    const running = this.finish(); this.cleanupPending = running;
    void running.finally(() => { if (this.cleanupPending === running) this.cleanupPending = undefined; });
    return running;
  };
  private async finish(): Promise<DbLinkCleanupState> {
    const deadline = performance.now() + this.configuration.budget.queryTimeoutMs;
    try {
      // The original callback must settle before portal close or rollback. No
      // guessed ReadyForQuery, PID signal, replacement connection or replay.
      if (this.pending && !this.pending.settled) await pgBefore(this.pending.promise.then(() => undefined, () => undefined), deadline);
      if (this.cursor && !this.wireLost && !this.localEnded) {
        const cursor = this.cursor;
        await this.track(async () => { await cursor.close(); this.cursor = undefined; this.commandTerminal = true; }, deadline);
      }
      if (!this.transactionEnded && !this.wireLost && !this.localEnded) {
        if (!this.rollback) {
          this.rollback = this.track(async () => { await pgRows(this.client, 'ROLLBACK'); this.transactionEnded = true; }, deadline);
          // The original rollback remains authoritative if its response arrives late.
          void this.rollback.catch(() => {});
        }
        await pgBefore(this.rollback, deadline);
      }
      this.closing = true;
      if (!this.localEnded) {
        if (!this.ending) {
          this.ending = Promise.resolve().then(() => this.client.end()).then(() => { this.localEnded = true; });
          void this.ending.catch(() => {});
        }
        await pgBefore(this.ending, deadline);
      }
      if (this.transport) await pgBefore(this.transport.completion, deadline);
    } catch { /* Retain the original handle and each known fact for explicit cleanup. */ }
    return this.state();
  }
}

async function executePg(c: Readonly<DbLinkRuntimeConnection>, request: DbLinkQueryRequest, dependencies: DbLinkDriverDependencies): Promise<DbLinkQueryTerminal> {
  const admittedAt = performance.now(), terminal = queryTerminal(); let operation: PgOwnedOperation | undefined;
  try {
    assertConfiguration(c);
    validateSegmentRequest(request);
    const checked = validateDbLinkSql(request.sql, 'postgresql'), parameters = parameterValues(request.parameters, 'postgresql');
    if (checked.objects.some(object => !/^[a-z_][a-z0-9_$]*\.[a-z_][a-z0-9_$]*$/i.test(object)
      || !(request.scope.objects.includes('*') || request.scope.objects.includes(object)))) throw new DbLinkDriverError('db_query_object_not_authorized');
    if (request.signal?.aborted) throw new DbLinkDriverError('db_query_stopped');
    const initialBudget = Math.floor(Math.min(c.budget.queryTimeoutMs, request.remainingBudgetMs?.() ?? c.budget.queryTimeoutMs));
    if (!Number.isFinite(initialBudget) || initialBudget <= 0) throw new DbLinkDriverError('db_operation_budget_exhausted');
    operation = new PgOwnedOperation(c, dependencies, admittedAt + initialBudget, request);
    terminal.dispatched = true;
    await operation.connect(); await operation.beginReadOnly();
    const owned = operation;
    const guarded: DbLinkPgClient = { connect: async () => {}, end: async () => {}, on: () => {}, async query(input) { return { rows: await owned.rows((input as { text: string }).text, (input as { values?: unknown[] }).values) }; } };
    const catalog = await inspectPg(guarded, c);
    terminal.sourceIdentity = catalog.observation.sourceIdentity; terminal.permissionBinding = catalog.observation.permissionBinding; terminal.session = catalog.session;
    terminal.limitations.push(...catalog.observation.limitations, ...catalog.limitations, ...catalog.objects.filter(object => checked.objects.includes(object.object)).flatMap(object => object.limitations));
    authorizeQuery(catalog, request, checked.objects); operation.admit();
    const options = { rowMode: 'array' as const, types: { getTypeParser(_oid: number, format?: string) { if (format && format !== 'text') throw new DbLinkDriverError('db_binary_pg_not_allowed'); return (value: string) => value; } } };
    const cursor = dependencies.postgresCursor?.(checked.sql, parameters, options) ?? new Cursor(checked.sql, parameters, options) as unknown as DbLinkPgCursor;
    operation.attachCursor(cursor);
    const enforce = resultBudget(c); let columnsSent = false, lastFields: PgField[] = [];
    for (;;) {
      operation.admit();
      const batch = await operation.readCursor(Math.min(100, c.budget.maxRows - terminal.rowsReceived + 1), count => { terminal.rowsReceived += count; });
      if (batch.fields) lastFields = batch.fields;
      operation.admit();
      if (!columnsSent) {
        terminal.columns = lastFields.map((field, ordinal) => {
          const column = catalog.objects.find(table => table.nativeId === String(field.tableID))?.columns.find(column => column.ordinal === field.columnID);
          return { ordinal, name: field.name, databaseType: column?.databaseType ?? `pg_oid_${field.dataTypeID}`, typeId: field.dataTypeID, precision: column?.precision ?? null, scale: column?.scale ?? null, nullable: column?.nullable };
        });
        if (lastFields.length > 256) throw new DbLinkDriverError('db_result_column_limit');
        await operation.deliver(() => request.onColumns(terminal.columns, catalog));
        columnsSent = true;
      }
      if (!batch.rows.length) break;
      const rows = batch.rows.map(row => {
        if (!Array.isArray(row) || row.length !== lastFields.length) throw new DbLinkDriverError('db_result_shape_invalid');
        return row.map((value, index) => resultCell(value, lastFields[index]?.dataTypeID));
      });
      enforce(rows); operation.admit();
      await operation.deliver(() => request.onRows(rows));
    }
    terminal.serverRowCount = String(terminal.rowsReceived);
    terminal.status = 'completed';
  } catch (error) {
    terminal.errorCode = errorCode(error);
    terminal.status = request.signal?.aborted || terminal.errorCode === 'db_query_stopped' ? 'cancelled' : 'error';
    if (operation && !(error instanceof DbLinkDriverError) && !(error instanceof DbLinkSqlError) && !remoteError(error)) operation.wireLost = true;
  } finally {
    if (operation) {
      terminal.cleanup = operation.cleanup; terminal.resourceState = await operation.cleanup();
      terminal.receiveFacts = operation.receiveFacts();
      terminal.remoteTerminal = terminal.resourceState.remoteTerminal;
      terminal.connectionEnded = terminal.resourceState.connectionEnded;
      if (!terminal.resourceState.remoteTerminal || !terminal.resourceState.connectionEnded || !terminal.resourceState.commandTerminal || !terminal.resourceState.transactionEnded) {
        terminal.status = 'unknown'; terminal.limitations.push('db_remote_termination_unknown');
      }
    } else {
      // No original native resource existed: these are no-operation facts, not
      // a claim that an unobserved server query or backend disappeared.
      terminal.dispatched = false;
      terminal.resourceState = { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true };
      terminal.remoteTerminal = true; terminal.connectionEnded = true;
    }
  }
  return terminal;
}

function mysqlConfiguration(c: Readonly<DbLinkRuntimeConnection>): ConnectionOptions {
  return { host: c.host, port: c.port, database: c.database, user: c.username, password: c.password,
    ssl: { ca: c.tls.ca, rejectUnauthorized: true, verifyIdentity: true }, connectTimeout: c.budget.connectTimeoutMs,
    multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false,
    flags: ['-LOCAL_FILES','-MULTI_STATEMENTS','-MULTI_RESULTS','-PS_MULTI_RESULTS'],
    dateStrings: true, jsonStrings: true, rowsAsArray: true, timezone: 'Z' };
}
function createMysqlClient(c: Readonly<DbLinkRuntimeConnection>, dependencies: DbLinkDriverDependencies): DbLinkMysqlClient {
  const options = mysqlConfiguration(c);
  if (dependencies.mysqlConnection) return dependencies.mysqlConnection(options);
  // Public stream factory: Host owns this plain TCP socket, mysql2 alone
  // upgrades it to TLS with the original DNS hostname and verification options.
  const socket = new Socket();
  const transportClosed = new Promise<void>(resolve => socket.once('close', () => resolve()));
  const connection = mysql.createConnection({ ...options, stream: () => socket.connect({ host: c.host, port: c.port }) });
  return { transportClosed, connect: callback => connection.connect(callback),
    query: (input, values, callback) => connection.query(input as mysql.QueryOptions, values as never, (error, rows) => callback(error, rows)),
    execute: (sql, values) => connection.execute(sql, values as never) as unknown as DbLinkMysqlQuery,
    end: callback => connection.end(error => callback(error ?? undefined)),
    on: (event, listener) => connection.on(event, listener), once: (event, listener) => connection.once(event, listener) };
}
async function mysqlRows(client: DbLinkMysqlClient, sql: string, values: unknown[] = []): Promise<NativeRow[]> {
  const rows = await new Promise<unknown>((resolve, reject) => client.query({ sql, rowsAsArray: false }, values, (error, rows) => error ? reject(error) : resolve(rows)));
  if (!Array.isArray(rows)) return []; // Host SET statements have an OK packet, not rows.
  return rows as NativeRow[];
}
async function mysqlEnd(client: DbLinkMysqlClient): Promise<void> {
  // mysql2's QUIT callback runs before its packet is sent. Only public end
  // establishes that the connection actually ended; there is no remote kill.
  await new Promise<void>((resolve, reject) => {
    if (client.transportClosed) void client.transportClosed.then(resolve, reject);
    else client.once('end', () => resolve());
    client.once('error', error => reject(error));
    client.end(error => { if (error) reject(error); });
  });
}
async function setMysqlBudget(client: DbLinkMysqlClient, c: Readonly<DbLinkRuntimeConnection>, remainingMs: number): Promise<void> {
  await mysqlRows(client, "SET SESSION max_execution_time=?, lock_wait_timeout=?, innodb_lock_wait_timeout=?, time_zone='+00:00'",
    [Math.max(1, Math.floor(remainingMs)), Math.max(1, Math.floor(c.budget.lockTimeoutMs / 1000)), Math.max(1, Math.floor(c.budget.lockTimeoutMs / 1000))]);
}
async function inspectMysql(client: DbLinkMysqlClient, c: Readonly<DbLinkRuntimeConnection>): Promise<DbLinkCatalog> {
  const catalog = blankCatalog(); catalog.observation.reachable = true;
  const global = catalog.observation.limitations;
  const [identity] = await mysqlRows(client, `/* db-link:identity */ SELECT @@version AS version,@@server_uuid AS server_uuid,
    @@port AS server_port,DATABASE() AS \`database\`,CURRENT_USER() AS \`current_user\`,USER() AS session_user,
    @@session.time_zone AS timezone,@@session.character_set_connection AS encoding,@@session.transaction_isolation AS isolation,
    @@session.sql_mode AS sql_mode,@@global.have_statement_timeout AS timer_available,
    @@session.max_execution_time AS max_execution_time,@@session.lock_wait_timeout AS lock_wait_timeout,@@lower_case_table_names AS lower_case_table_names`);
  catalog.identifierCase = Number(identity?.lower_case_table_names) === 0 ? 'exact' : 'fold';
  if (!/^8\.4\.\d+(?:[-+].*)?$/.test(text(identity?.version))) global.push('db_server_version_not_supported');
  if (!text(identity?.server_uuid)) global.push('db_source_identity_unknown');
  else catalog.observation.sourceIdentity = `mysql:${hash([identity.server_uuid, identity.database, identity.server_port, c.host])}`;
  if (!text(identity?.current_user).startsWith(`${c.username}@`)) global.push('db_login_role_changed');
  if (identity?.timer_available !== 'YES') global.push('db_statement_timer_unavailable');
  if (!(Number(identity?.max_execution_time) > 0 && Number(identity?.max_execution_time) <= c.budget.queryTimeoutMs)) global.push('db_statement_budget_unverified');
  if (c.budget.lockTimeoutMs < 1000 || !(Number(identity?.lock_wait_timeout) > 0 && Number(identity?.lock_wait_timeout) * 1000 <= c.budget.lockTimeoutMs)) global.push('db_lock_budget_unverified');
  catalog.session = { timezone: text(identity?.timezone) || 'unknown', encoding: text(identity?.encoding) || 'unknown', isolation: text(identity?.isolation) || 'unknown',
    ...(text(identity?.server_version_num) ? { serverVersionNum: text(identity?.server_version_num) } : {}), sqlMode: text(identity?.sql_mode) };
  const grants = (await mysqlRows(client, 'SHOW GRANTS')).map(row => text(Object.values(row)[0])).sort();
  const roles = await mysqlRows(client, 'SELECT ROLE_NAME,ROLE_HOST,IS_DEFAULT,IS_MANDATORY FROM information_schema.ENABLED_ROLES');
  if (!grants.length) global.push('db_native_role_unknown');
  if (roles.length || grants.some(grant => !/^GRANT (?:USAGE ON \*\.\*|SELECT(?:\s*\([^)]+\))? ON `[^`]+`\.`[^`]+`) TO .+$/i.test(grant)
    || /WITH GRANT OPTION| ON `(?:mysql|information_schema|performance_schema|sys)`\./i.test(grant))) global.push('db_native_grants_not_readonly');
  const tables = await mysqlRows(client, `/* db-link:tables */ SELECT TABLE_SCHEMA AS \`schema\`,TABLE_NAME AS name,TABLE_TYPE AS kind,ENGINE AS engine,TABLE_COMMENT AS comment
    FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys') ORDER BY TABLE_SCHEMA,TABLE_NAME`);
  const columns = await mysqlRows(client, `/* db-link:columns */ SELECT TABLE_SCHEMA AS \`schema\`,TABLE_NAME AS \`table\`,COLUMN_NAME AS name,ORDINAL_POSITION AS ordinal,
    COLUMN_TYPE AS database_type,DATA_TYPE AS type_id,NUMERIC_PRECISION AS \`precision\`,NUMERIC_SCALE AS \`scale\`,IS_NULLABLE AS \`nullable\`,
    PRIVILEGES AS \`privileges\`,GENERATION_EXPRESSION AS \`generated\`,EXTRA AS \`extra\`,COLUMN_COMMENT AS \`comment\`
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys') ORDER BY TABLE_SCHEMA,TABLE_NAME,ORDINAL_POSITION`);
  if (columns.some(column => text(column.privileges).split(',').some(privilege => ['insert','update','references'].includes(privilege.toLowerCase())))) global.push('db_native_write_privilege');
  for (const table of tables) {
    const nativeColumns = columns.filter(column => column.schema === table.schema && column.table === table.name);
    if (!nativeColumns.some(column => text(column.privileges).split(',').includes('select'))) continue;
    const limitations: string[] = [];
    if (table.kind !== 'BASE TABLE' || table.engine !== 'InnoDB') limitations.push('db_relation_kind_not_supported');
    if (!identifier.test(text(table.schema)) || !identifier.test(text(table.name))) limitations.push('db_object_identifier_not_supported');
    if (nativeColumns.some(column => /VIRTUAL GENERATED/i.test(text(column.extra)) || text(column.generated) && !/STORED GENERATED/i.test(text(column.extra)))) limitations.push('db_generated_column_not_verified');
    catalog.objects.push({ object: `${table.schema}.${table.name}`, schema: text(table.schema), name: text(table.name), kind: text(table.kind),
      queryable: limitations.length === 0, limitations, comment: text(table.comment) || null, primaryKey: [], foreignKeys: [],
      columns: nativeColumns.map(column => ({ ordinal: integer(column.ordinal) ?? 0, name: text(column.name), databaseType: text(column.database_type), typeId: text(column.type_id), precision: integer(column.precision), scale: integer(column.scale),
        nullable: column.nullable === 'YES', readable: text(column.privileges).split(',').includes('select'), comment: text(column.comment) || null })) });
  }
  try {
    const keys = await mysqlRows(client, `/* db-link:keys */ SELECT TABLE_SCHEMA AS \`schema\`,TABLE_NAME AS \`table\`,CONSTRAINT_NAME AS name,COLUMN_NAME AS \`column\`,ORDINAL_POSITION AS ordinal,
      REFERENCED_TABLE_SCHEMA AS referenced_schema,REFERENCED_TABLE_NAME AS referenced_table,REFERENCED_COLUMN_NAME AS referenced_column
      FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_NAME='PRIMARY' OR REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION`);
    for (const key of keys) {
      const table = catalog.objects.find(table => table.object === `${key.schema}.${key.table}`); if (!table) continue;
      if (key.name === 'PRIMARY') { table.primaryKey.push(text(key.column)); continue; }
      let fk = table.foreignKeys.find(fk => fk.name === key.name);
      if (!fk) { fk = { name: text(key.name), columns: [], referencedObject: `${key.referenced_schema}.${key.referenced_table}`, referencedColumns: [] }; table.foreignKeys.push(fk); }
      fk.columns.push(text(key.column)); fk.referencedColumns.push(text(key.referenced_column));
    }
    catalog.completeness = 'complete';
  } catch { catalog.limitations.push('db_relationships_unknown'); }
  catalog.observation.permissionBinding = hash({ identity: catalog.observation.sourceIdentity, grants, roles, tables, columns, lowerCaseTableNames: identity?.lower_case_table_names });
  // mysql2 yields full decoded fields, and MySQL's SELECT execution timer
  // does not cover the initial PREPARE/its cumulative metadata-lock waits.
  global.push('db_receive_memory_budget_unenforced', 'db_prepare_total_budget_unenforced');
  catalog.observation.queryQualified = global.length === 0;
  return catalog;
}

async function executeMysql(c: Readonly<DbLinkRuntimeConnection>, request: DbLinkQueryRequest, dependencies: DbLinkDriverDependencies): Promise<DbLinkQueryTerminal> {
  const terminal = queryTerminal(); let client: DbLinkMysqlClient | undefined;
  let connected = false, wireLost = false, closing = false, transaction = false;
  const deadline = performance.now() + c.budget.queryTimeoutMs;
  const remaining = (): number => Math.floor(Math.min(deadline - performance.now(), request.remainingBudgetMs?.() ?? c.budget.queryTimeoutMs));
  const admit = (): void => { if (request.signal?.aborted) throw new DbLinkDriverError('db_query_stopped'); if (!Number.isFinite(remaining()) || remaining() <= 0) throw new DbLinkDriverError('db_operation_budget_exhausted'); };
  try {
    assertConfiguration(c);
    const checked = validateDbLinkSql(request.sql, 'mysql'), parameters = parameterValues(request.parameters, 'mysql'); admit();
    client = createMysqlClient(c, dependencies);
    client.on('error', () => { wireLost = true; }); client.on('end', () => { if (!closing) wireLost = true; });
    await new Promise<void>((resolve, reject) => client!.connect(error => error ? reject(error) : resolve())); connected = true;
    await setMysqlBudget(client, c, remaining());
    const catalog = await inspectMysql(client, c);
    terminal.sourceIdentity = catalog.observation.sourceIdentity; terminal.permissionBinding = catalog.observation.permissionBinding; terminal.session = catalog.session;
    terminal.limitations.push(...catalog.observation.limitations, ...catalog.limitations);
    authorizeQuery(catalog, request, checked.objects); admit();
    await mysqlRows(client, 'START TRANSACTION READ ONLY'); transaction = true;
    const budget = remaining(); if (budget <= 0) throw new DbLinkDriverError('db_operation_budget_exhausted');
    await setMysqlBudget(client, c, budget);
    const [settings] = await mysqlRows(client, '/* db-link:budget */ SELECT @@session.max_execution_time AS max_execution_time,@@session.lock_wait_timeout AS lock_wait_timeout');
    if (!(Number(settings?.max_execution_time) > 0 && Number(settings?.max_execution_time) <= budget && Number(settings?.lock_wait_timeout) > 0 && Number(settings?.lock_wait_timeout) * 1000 <= c.budget.lockTimeoutMs)) throw new DbLinkDriverError('db_statement_budget_unverified');
    const stats = async (): Promise<{ set: number; failed: number }> => {
      const rows = await mysqlRows(client!, "SHOW SESSION STATUS WHERE Variable_name IN ('Max_execution_time_set','Max_execution_time_set_failed')");
      return { set: Number(rows.find(row => row.Variable_name === 'Max_execution_time_set')?.Value), failed: Number(rows.find(row => row.Variable_name === 'Max_execution_time_set_failed')?.Value) };
    };
    const before = await stats(); if (!Number.isSafeInteger(before.set) || !Number.isSafeInteger(before.failed)) throw new DbLinkDriverError('db_statement_timer_unverified');
    admit(); if (!client.execute) throw new DbLinkDriverError('db_prepared_stream_unavailable');
    const query = client.execute(checked.sql, parameters);
    let columnsReady: Promise<void> = Promise.resolve(), deliveryError: DbLinkDriverError | undefined, fieldsSeen = false;
    const enforce = resultBudget(c);
    query.on('error', error => { if (!remoteError(error)) wireLost = true; });
    query.on('end', () => { terminal.remoteTerminal = true; });
    query.on('fields', fieldsValue => {
      if (fieldsSeen || !Array.isArray(fieldsValue)) { deliveryError = new DbLinkDriverError('db_multiple_results_not_allowed'); return; }
      fieldsSeen = true;
      terminal.columns = (fieldsValue as NativeRow[]).map((field, ordinal) => {
        const column = catalog.objects.find(table => table.object === `${field.db}.${field.orgTable}`)?.columns.find(column => column.name === field.orgName);
        return { ordinal: ordinal + 1, name: text(field.name), databaseType: column?.databaseType ?? `mysql_type_${field.columnType}`, typeId: text(field.columnType), precision: column?.precision ?? null, scale: column?.scale ?? null, nullable: column?.nullable };
      });
      if (!request.signal?.aborted) columnsReady = Promise.resolve().then(() => request.onColumns(terminal.columns, catalog)).catch(() => { deliveryError = new DbLinkDriverError('db_result_delivery_failed'); });
    });
    // No callback is supplied to execute: the public stream consumes packets
    // with backpressure instead of constructing the callback's entire result.
    for await (const row of query.stream({ highWaterMark: 1 })) {
      await columnsReady; terminal.rowsReceived++;
      if (request.signal?.aborted || deliveryError) continue; // drain to the original command's real terminal
      try {
        if (!Array.isArray(row)) throw new DbLinkDriverError('db_result_shape_invalid');
        const batch = [row.map(value => resultCell(value))]; enforce(batch); await request.onRows(batch);
      } catch (error) { deliveryError = error instanceof DbLinkDriverError ? error : new DbLinkDriverError('db_result_delivery_failed'); }
    }
    await columnsReady;
    if (!fieldsSeen || !terminal.remoteTerminal) throw new DbLinkDriverError('db_prepared_result_terminal_unverified');
    const after = await stats();
    if (!(after.set > before.set && after.failed === before.failed)) throw new DbLinkDriverError('db_statement_timer_unverified');
    if (deliveryError) throw deliveryError;
    terminal.serverRowCount = Number.isSafeInteger(terminal.rowsReceived) ? String(terminal.rowsReceived) : null;
    terminal.status = request.signal?.aborted ? 'cancelled' : 'completed';
  } catch (error) {
    terminal.errorCode = errorCode(error); terminal.status = request.signal?.aborted || terminal.errorCode === 'db_query_stopped' ? 'cancelled' : 'error';
    if (!(error instanceof DbLinkDriverError) && !remoteError(error) && connected) wireLost = true;
  } finally {
    try {
      if (!wireLost && transaction && client) await mysqlRows(client, 'ROLLBACK');
      if (!wireLost) terminal.remoteTerminal = true;
      closing = true;
      if (client && !wireLost) await mysqlEnd(client);
      else client?.end(() => {});
      if (!wireLost) terminal.connectionEnded = true;
    } catch { wireLost = true; }
    if (wireLost) { terminal.status = 'unknown'; terminal.remoteTerminal = false; terminal.connectionEnded = false; terminal.limitations.push('db_remote_termination_unknown'); }
  }
  return terminal;
}

function pgConfiguration(c: Readonly<DbLinkRuntimeConnection>, transport?: DbLinkPgStream): ClientConfig {
  return { host: c.host, port: c.port, database: c.database, user: c.username, password: c.password,
    ssl: { rejectUnauthorized: true, ca: c.tls.ca, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', secureOptions: cryptoConstants.SSL_OP_NO_COMPRESSION },
    ...(transport ? { stream: () => transport } : {}), connectionTimeoutMillis: c.budget.connectTimeoutMs,
    statement_timeout: c.budget.queryTimeoutMs, lock_timeout: c.budget.lockTimeoutMs,
    options: `-c search_path=pg_catalog -c idle_in_transaction_session_timeout=${c.budget.queryTimeoutMs} -c default_transaction_read_only=on -c DateStyle=ISO,YMD -c TimeZone=UTC -c IntervalStyle=postgres -c client_encoding=UTF8 -c bytea_output=hex -c extra_float_digits=3`, application_name: 'OptraCall db-link' };
}

function assertConfiguration(c: Readonly<DbLinkRuntimeConnection>): void {
  if (isIP(c.host) || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(c.host)
    || c.tls.rejectUnauthorized !== true || c.tls.verifyIdentity !== true) throw new DbLinkDriverError('db_verified_dns_tls_required');
  if ([c.budget.connectTimeoutMs,c.budget.queryTimeoutMs,c.budget.lockTimeoutMs,c.budget.maxRows,c.budget.maxBytes,c.budget.maxCellBytes].some(value => !Number.isSafeInteger(value) || value < 1)) throw new DbLinkDriverError('db_budget_invalid');
  if (c.engine === 'postgresql' && [c.budget.connectTimeoutMs,c.budget.queryTimeoutMs,c.budget.lockTimeoutMs].some(value => value > 2147483647)) throw new DbLinkDriverError('db_budget_invalid');
}

export function createDbLinkDriver(dependencies: DbLinkDriverDependencies = {}) {
  // Driver capability facts are separate from the Host's release/adoption gate.
  async function catalog(configuration: Readonly<DbLinkRuntimeConnection>, request?: Pick<DbLinkQueryRequest, 'signal' | 'remainingBudgetMs'>): Promise<DbLinkCatalog> {
      const admittedAt = performance.now(); let result = blankCatalog(), initialBudget: number;
      try {
        assertConfiguration(configuration);
        if (request?.signal?.aborted) throw new DbLinkDriverError('db_query_stopped');
        initialBudget = Math.floor(Math.min(configuration.budget.queryTimeoutMs, request?.remainingBudgetMs?.() ?? configuration.budget.queryTimeoutMs));
        if (!Number.isFinite(initialBudget) || initialBudget <= 0) throw new DbLinkDriverError('db_operation_budget_exhausted');
      } catch (error) {
        result.observation.limitations.push(errorCode(error));
        result.resourceState = { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true };
        return result;
      }
      if (configuration.engine === 'mysql') {
        const client = createMysqlClient(configuration, dependencies);
        let uncertain = false, closing = false;
        client.on('error', () => { if (result.observation.reachable) uncertain = true; });
        client.on('end', () => { if (!closing && result.observation.reachable) uncertain = true; });
        try {
          await new Promise<void>((resolve, reject) => client.connect(error => error ? reject(error) : resolve())); result.observation.reachable = true;
          await setMysqlBudget(client, configuration, configuration.budget.queryTimeoutMs);
          result = await inspectMysql(client, configuration); return result;
        } catch (error) { if (result.observation.reachable && !remoteError(error)) uncertain = true; result.observation.limitations.push(result.observation.reachable ? 'db_native_qualification_not_proved' : 'db_connection_failed'); }
        finally {
          closing = true; await mysqlEnd(client).catch(() => { uncertain = true; });
          if (uncertain) { result.observation.queryQualified = false; result.observation.limitations.push('db_probe_connection_close_unknown'); }
        }
        return result;
      }
      const operation = new PgOwnedOperation(configuration, dependencies, admittedAt + initialBudget, request);
      try {
        await operation.connect(); result.observation.reachable = true;
        await operation.beginReadOnly();
        const guarded: DbLinkPgClient = { connect: async () => {}, end: async () => {}, on: () => {}, async query(input) { return { rows: await operation.rows((input as { text: string }).text, (input as { values?: unknown[] }).values) }; } };
        result = await inspectPg(guarded, configuration);
      } catch (error) {
        if (!(error instanceof DbLinkDriverError) && !(error instanceof DbLinkSqlError) && !remoteError(error)) operation.wireLost = true;
        if (error instanceof DbLinkDriverError && ['db_query_stopped','db_operation_budget_exhausted'].includes(error.code)) result.observation.limitations.push(error.code);
        result.observation.limitations.push(result.observation.reachable ? 'db_native_qualification_not_proved' : 'db_connection_failed');
      }
      finally {
        result.cleanup = operation.cleanup; result.resourceState = await operation.cleanup();
        result.receiveFacts = operation.receiveFacts();
        if (!result.resourceState.remoteTerminal || !result.resourceState.connectionEnded) { result.observation.queryQualified = false; result.observation.limitations.push('db_probe_connection_close_unknown'); }
      }
      return result;
  }
  return {
    catalog,
    async openQuery(configuration: Readonly<DbLinkRuntimeConnection>, request: DbLinkQueryRequest): Promise<DbLinkQueryTerminal> {
      return configuration.engine === 'postgresql' ? await executePg(configuration, request, dependencies) : await executeMysql(configuration, request, dependencies);
    },
    async probe(configuration: Readonly<DbLinkRuntimeConnection>): Promise<DbLinkTestObservation> { return (await catalog(configuration)).observation; },
    async describe(configuration: Readonly<DbLinkRuntimeConnection>, object: string): Promise<DbLinkTable> {
      const table = (await catalog(configuration)).objects.find(table => table.object === object);
      if (!table) throw new Error('db_object_not_available'); return table;
    },
  };
}
