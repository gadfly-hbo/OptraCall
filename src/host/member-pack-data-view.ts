import path from 'node:path';
import {
  evaluateResourceAccess,
  isGrantActive,
  type ResourceAuthorizationGrant,
} from '../../extensions/business-plugins/studio/enterprise-pack.ts';

export type AuthorizedDataViewResult =
  | {
      allowed: true;
      bytes: Buffer;
      filtered: boolean;
      keptRows?: number;
      omittedRows?: number;
      unattributableRows?: number;
      grantedStores?: string[];
      periodFrom?: string;
      periodTo?: string;
      restrictionNote?: string;
    }
  | {
      allowed: false;
      code: string;
      reason: string;
    };

function normalizeRelPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
}

const UNATTRIBUTABLE_SCOPE_TOKENS = new Set([
  '', 'null', 'undefined', 'n/a', 'na', 'none', 'unknown', 'unassigned', '-', '--', '未归属', '未知', '空', '无',
]);

function isUnattributableScopeValue(value: string | undefined): boolean {
  if (value === undefined) return true;
  const trimmed = value.trim().toLowerCase();
  return UNATTRIBUTABLE_SCOPE_TOKENS.has(trimmed);
}

export function dataPeriodBounds(value: string): { start: number; end: number } | undefined {
  const trimmed = value.trim();
  const month = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (month) {
    const start = Date.parse(`${trimmed}-01T00:00:00.000Z`);
    if (!Number.isFinite(start)) return undefined;
    const next = new Date(start);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return { start, end: next.getTime() - 1 };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const start = Date.parse(`${trimmed}T00:00:00.000Z`);
    if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== trimmed) return undefined;
    return { start, end: start + 86_399_999 };
  }
  if (/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed)) {
    const instant = Date.parse(trimmed);
    if (Number.isFinite(instant)) return { start: instant, end: instant };
  }
  return undefined;
}

export function isPeriodCovered(period: string | undefined, periodFrom?: string, periodTo?: string): boolean {
  if (!periodFrom && !periodTo) return true;
  const bounds = period && dataPeriodBounds(period);
  if (!bounds) return false;
  const lowerBound = periodFrom ? dataPeriodBounds(periodFrom)?.start : Number.NEGATIVE_INFINITY;
  const upperBound = periodTo ? dataPeriodBounds(periodTo)?.end : Number.POSITIVE_INFINITY;
  return lowerBound !== undefined && upperBound !== undefined && bounds.start >= lowerBound && bounds.end <= upperBound;
}

function parseCsvLine(line: string, delimiter: string): string[] | undefined {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (inQuotes) return undefined;
  cells.push(cur);
  return cells;
}

function formatCsvCell(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const STORE_HEADER_NAMES = new Set([
  'store', 'store_name', 'store_id', 'shop', 'shop_name', 'first_store',
  '门店', '门店名称', '门店id', '店铺', '店铺名称', '首购门店',
]);

const DATE_HEADER_NAMES = new Set([
  'order_date', 'first_order_date', 'purchase_date', 'trade_date', 'event_date',
  'date', 'month', 'period', 'stat_month', 'biz_date',
  '交易日期', '下单日期', '首购日期', '日期', '月份', '统计月份', '期间',
]);

const SCOPED_COLUMNS = {
  store: { headers: STORE_HEADER_NAMES, label: '门店' },
  period: { headers: DATE_HEADER_NAMES, label: '日期/期间' },
  brand: { headers: new Set(['brand', '品牌']), label: '品牌' },
  channel: { headers: new Set(['channel', '渠道']), label: '渠道' },
};
type ScopeColumn = keyof typeof SCOPED_COLUMNS;
type GrantScope = ResourceAuthorizationGrant['scope'];
type RowScope = Partial<Record<ScopeColumn, string>>;

const scopeColumns = Object.keys(SCOPED_COLUMNS) as ScopeColumn[];
const normalizeColumn = (name: string) => name.replace(/^\uFEFF/, '').trim().toLowerCase();

function constrainedColumns(scope: GrantScope): ScopeColumn[] {
  const constraints: Record<ScopeColumn, boolean> = {
    store: Boolean(scope.stores?.length),
    period: Boolean(scope.periodFrom || scope.periodTo),
    brand: Boolean(scope.brand),
    channel: Boolean(scope.channel),
  };
  return scopeColumns.filter(column => constraints[column]);
}

function knownScopeValue(values: unknown[]): string | undefined {
  const normalized = values.map(value =>
    typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : undefined,
  );
  const first = normalized[0];
  return first && !isUnattributableScopeValue(first) && normalized.every(value => value === first) ? first : undefined;
}

/**
 * Builds a Host-verified view of project detail data using all dimensions of
 * each applicable grant. A row must meet one grant on its own. A missing or
 * ambiguous dimension only bars grants that restrict that dimension.
 */
export type AuthorizedDataPurpose = {
  purposeKey?: string;
  purposeScope?: Pick<ResourceAuthorizationGrant['scope'], 'brand' | 'channel' | 'stores'>;
};

export function buildAuthorizedDataView(
  bytes: Buffer,
  relativePath: string,
  grants: readonly ResourceAuthorizationGrant[],
  query: AuthorizedDataPurpose & { at?: string } = {},
): AuthorizedDataViewResult {
  const normalizedPath = normalizeRelPath(relativePath);
  const access = evaluateResourceAccess(grants, {
    operation: 'read-detail-recalculate',
    dataPath: normalizedPath,
    ...(query.purposeKey ? { purposeKey: query.purposeKey } : {}),
    ...(query.at ? { at: query.at } : {}),
  });
  if (!access.allowed) {
    const rawReason = access.restrictionReason ?? 'resource_detail_not_authorized';
    const sanitized = rawReason.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 96) || 'resource_detail_not_authorized';
    const code = sanitized.includes('not_authorized') || sanitized.includes('no_active_grant')
      ? sanitized
      : `detail_access_not_authorized_${sanitized}`.slice(0, 100);
    return { allowed: false, code, reason: rawReason };
  }

  const atMs = query.at && Number.isFinite(Date.parse(query.at)) ? Date.parse(query.at) : Date.now();
  const matchedGrants = grants.filter(g => {
    if (!access.matchedGrantIds.includes(g.id)) return false;
    return isGrantActive(g, atMs);
  });

  const purposeColumns = query.purposeScope ? constrainedColumns(query.purposeScope) : [];
  const rowGrants = matchedGrants.map(grant => ({
    scope: grant.scope,
    constrained: constrainedColumns(grant.scope),
  }));
  if (!purposeColumns.length && rowGrants.some(grant => !grant.constrained.length)) {
    return { allowed: true, bytes, filtered: false };
  }

  const grantedStores = [...new Set(matchedGrants.flatMap(g => g.scope.stores ?? []))];
  const periodFroms = matchedGrants.map(g => g.scope.periodFrom).filter((v): v is string => Boolean(v)).sort();
  const periodTos = matchedGrants.map(g => g.scope.periodTo).filter((v): v is string => Boolean(v)).sort();
  const effectivePeriodFrom = periodFroms[0];
  const effectivePeriodTo = periodTos.at(-1);

  const ext = path.extname(normalizedPath).toLowerCase();
  let textContent: string;
  try {
    textContent = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return {
      allowed: false,
      code: 'authorized_view_unavailable_unfilterable_source',
      reason: '该明细文件非 UTF-8 可解析结构化数据，无法按授权范围生成可验证授权视图，已限制交付原文件。',
    };
  }
  if (bytes.includes(0)) {
    return {
      allowed: false,
      code: 'authorized_view_unavailable_unfilterable_source',
      reason: '该明细文件包含二进制内容，无法按授权范围生成可验证授权视图，已限制交付原文件。',
    };
  }

  const columnPositions = (headings: string[], column: ScopeColumn) => {
    const matching = headings.flatMap((heading, index) => SCOPED_COLUMNS[column].headers.has(normalizeColumn(heading)) ? [index] : []);
    return column === 'store' || column === 'period' ? matching.slice(0, 1) : matching;
  };
  const missingScope = (hasColumn: (column: ScopeColumn) => boolean) => {
    const purposeMissing = purposeColumns.find(column => !hasColumn(column));
    if (purposeMissing) return purposeMissing;
    if (rowGrants.some(grant => grant.constrained.every(hasColumn))) return undefined;
    return scopeColumns.find(column => !hasColumn(column) && rowGrants.some(grant => grant.constrained.includes(column)));
  };
  const missingColumn = (column: ScopeColumn): AuthorizedDataViewResult => ({
    allowed: false,
    code: `authorized_view_unavailable_missing_${column}_column`,
    reason: `明细文件 ${normalizedPath} 缺少可核验${SCOPED_COLUMNS[column].label}字段，无法建立授权视图，已限制交付。`,
  });

  const dimensionKnown = (row: RowScope, column: ScopeColumn): boolean =>
    column === 'period' ? !!(row.period && dataPeriodBounds(row.period)) : row[column] !== undefined;
  const isRowUnattributable = (row: RowScope): boolean =>
    purposeColumns.some(column => !dimensionKnown(row, column))
    || rowGrants.some(grant => grant.constrained.some(column => !dimensionKnown(row, column)));
  const matchesScope = (row: RowScope, scope: ResourceAuthorizationGrant['scope'], constrained: ScopeColumn[]) =>
    constrained.every(column => {
      if (!dimensionKnown(row, column)) return false;
      if (column === 'period') return isPeriodCovered(row.period, scope.periodFrom, scope.periodTo);
      if (column === 'store') return scope.stores?.some(store => store.trim() === row.store);
      return scope[column]?.trim() === row[column];
    });
  const rowAllowedByAnyGrant = (row: RowScope): boolean =>
    (!query.purposeScope || matchesScope(row, query.purposeScope, purposeColumns))
      && rowGrants.some(({ scope, constrained }) => matchesScope(row, scope, constrained));

  const unauditableDelimitedFile: AuthorizedDataViewResult = {
    allowed: false,
    code: 'authorized_view_unavailable_unfilterable_source',
    reason: `明细文件 ${normalizedPath} 含不可准确解析的行，无法建立授权视图，已限制交付。`,
  };

  if (ext === '.csv' || ext === '.tsv') {
    const delimiter = ext === '.tsv' ? '\t' : ',';
    const eol = textContent.includes('\r\n') ? '\r\n' : '\n';
    const rawLines = textContent.split(/\r?\n/);
    const nonEmptyLines = rawLines.filter(line => line.trim().length > 0);
    if (nonEmptyLines.length === 0) {
      return { allowed: true, bytes, filtered: false, keptRows: 0, omittedRows: 0, unattributableRows: 0, grantedStores };
    }
    const headerCells = parseCsvLine(nonEmptyLines[0]!, delimiter);
    if (!headerCells) return unauditableDelimitedFile;
    const positions = new Map(scopeColumns.map(column => [column, columnPositions(headerCells, column)]));
    const missing = missingScope(column => !!positions.get(column)?.length);
    if (missing) return missingColumn(missing);

    const keptLines: string[] = [nonEmptyLines[0]!];
    let keptRows = 0;
    let omittedRows = 0;
    let unattributableRows = 0;
    for (let i = 1; i < nonEmptyLines.length; i++) {
      const cells = parseCsvLine(nonEmptyLines[i]!, delimiter);
      if (!cells || cells.length !== headerCells.length) return unauditableDelimitedFile;
      const row = Object.fromEntries(scopeColumns.map(column =>
        [column, knownScopeValue(positions.get(column)!.map(index => cells[index]))],
      )) as RowScope;
      if (rowAllowedByAnyGrant(row)) {
        keptLines.push(cells.map(c => formatCsvCell(c, delimiter)).join(delimiter));
        keptRows += 1;
      } else {
        omittedRows += 1;
        if (isRowUnattributable(row)) unattributableRows += 1;
      }
    }
    if (keptRows === 0 && unattributableRows > 0) {
      return {
        allowed: false,
        code: 'authorized_view_unattributable_records',
        reason: `明细文件 ${normalizedPath} 中 ${unattributableRows} 行记录缺少可核验的授权范围，无法生成授权视图，已限制交付。`,
      };
    }
    const outText = keptLines.join(eol) + (textContent.endsWith('\n') ? eol : '');
    const filtered = omittedRows > 0;
    return {
      allowed: true,
      bytes: filtered ? Buffer.from(outText, 'utf8') : bytes,
      filtered,
      keptRows,
      omittedRows,
      unattributableRows,
      ...(grantedStores.length ? { grantedStores } : {}),
      ...(effectivePeriodFrom ? { periodFrom: effectivePeriodFrom } : {}),
      ...(effectivePeriodTo ? { periodTo: effectivePeriodTo } : {}),
      ...(filtered
        ? {
            restrictionNote: `已按授权范围生成受控视图（保留 ${keptRows} 行，隐藏 ${omittedRows} 行超出授权范围的记录${unattributableRows > 0 ? `，其中 ${unattributableRows} 行授权范围无法确认` : ''}；不可读门店绝不视为 0）。`,
          }
        : {}),
    };
  }

  // 2. JSON array of records filtering
  if (ext === '.json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent);
    } catch {
      return {
        allowed: false,
        code: 'authorized_view_unavailable_unfilterable_source',
        reason: `JSON 明细文件 ${normalizedPath} 无法解析，无法建立授权视图，已限制交付。`,
      };
    }
    if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      return {
        allowed: false,
        code: 'authorized_view_unavailable_unfilterable_source',
        reason: `JSON 明细文件 ${normalizedPath} 非记录数组结构，无法按授权范围建立行级授权视图，已限制交付。`,
      };
    }
    if (parsed.length === 0) return { allowed: true, bytes, filtered: false, keptRows: 0, omittedRows: 0, unattributableRows: 0, grantedStores };
    const records = parsed as Record<string, unknown>[];
    const sampleKeys = [...new Set(records.flatMap(record => Object.keys(record)))];
    const keys = new Map(scopeColumns.map(column =>
      [column, columnPositions(sampleKeys, column).map(index => sampleKeys[index]!)],
    ));
    const missing = missingScope(column => !!keys.get(column)?.length);
    if (missing) return missingColumn(missing);
    const kept: Record<string, unknown>[] = [];
    let omittedRows = 0;
    let unattributableRows = 0;
    for (const row of records) {
      const dimensions = Object.fromEntries(scopeColumns.map(column => [column,
        knownScopeValue(keys.get(column)!.filter(key => Object.hasOwn(row, key)).map(key => row[key])),
      ])) as RowScope;
      if (rowAllowedByAnyGrant(dimensions)) {
        kept.push(row);
      } else {
        omittedRows += 1;
        if (isRowUnattributable(dimensions)) unattributableRows += 1;
      }
    }
    if (kept.length === 0 && unattributableRows > 0) {
      return {
        allowed: false,
        code: 'authorized_view_unattributable_records',
        reason: `JSON 明细文件 ${normalizedPath} 中 ${unattributableRows} 条记录缺少可核验的授权范围，无法生成授权视图，已限制交付。`,
      };
    }
    return {
      allowed: true,
      bytes: omittedRows ? Buffer.from(JSON.stringify(kept, null, 2) + '\n', 'utf8') : bytes,
      filtered: omittedRows > 0,
      keptRows: kept.length,
      omittedRows,
      unattributableRows,
      ...(grantedStores.length ? { grantedStores } : {}),
      ...(effectivePeriodFrom ? { periodFrom: effectivePeriodFrom } : {}),
      ...(effectivePeriodTo ? { periodTo: effectivePeriodTo } : {}),
      ...(omittedRows > 0
        ? {
            restrictionNote: `已按授权范围生成受控 JSON 视图（保留 ${kept.length} 条，隐藏 ${omittedRows} 条超出授权范围的记录${unattributableRows > 0 ? `，其中 ${unattributableRows} 条授权范围无法确认` : ''}；不可读门店绝不视为 0）。`,
          }
        : {}),
    };
  }

  return {
    allowed: false,
    code: 'authorized_view_unavailable_unfilterable_source',
    reason: `明细文件 ${normalizedPath}（格式 ${ext || '无扩展名'}）无法按授权范围建立可验证授权视图，已限制交付原文件。`,
  };
}
