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

function normalizeStoreBase(value: string): string {
  return value
    .trim()
    .replace(/(?:直营门店|直营店|旗舰店|加盟店|单店|门店|直营|店)$/u, '')
    .trim()
    .toLowerCase();
}

function rowStoreMatchesGrant(rowStore: string, grantStores: readonly string[]): boolean {
  const rRaw = rowStore.trim().toLowerCase();
  const rBase = normalizeStoreBase(rowStore);
  if (!rRaw) return false;
  return grantStores.some(gs => {
    const gRaw = gs.trim().toLowerCase();
    const gBase = normalizeStoreBase(gs);
    if (rRaw === gRaw) return true;
    if (rBase && gBase && rBase === gBase) return true;
    return false;
  });
}

function parseDateBounds(value: string): { start: number; end: number } | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const ym = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (ym) {
    const year = Number(ym[1]), month = Number(ym[2]);
    if (month >= 1 && month <= 12) {
      const start = Date.UTC(year, month - 1, 1);
      const end = Date.UTC(year, month, 0, 23, 59, 59, 999);
      return { start, end };
    }
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (ymd) {
    const ms = Date.parse(`${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00Z`);
    if (Number.isFinite(ms)) return { start: ms, end: ms + 86_399_999 };
  }
  const ms = Date.parse(trimmed);
  if (Number.isFinite(ms)) return { start: ms, end: ms };
  return undefined;
}

function rowDateWithinGrant(rowDate: string, periodFrom?: string, periodTo?: string): boolean {
  if (!periodFrom && !periodTo) return true;
  const rowBounds = parseDateBounds(rowDate);
  if (!rowBounds) return false;
  if (periodFrom) {
    const fromBounds = parseDateBounds(periodFrom);
    if (fromBounds && rowBounds.end < fromBounds.start) return false;
  }
  if (periodTo) {
    const toBounds = parseDateBounds(periodTo);
    if (toBounds && rowBounds.start > toBounds.end) return false;
  }
  return true;
}

function parseCsvLine(line: string, delimiter: string): string[] {
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

function looksLikeMixedFilename(relativePath: string): boolean {
  const base = path.basename(relativePath).toLowerCase();
  return /(?:^|[_-])(?:all|mixed|multi|combined|global|full|master)(?:[_.-]|$)|全店|混合|多店|全量/u.test(base);
}

/**
 * Builds a Host-verified authorized view of a project detail data file (`020_clean/...`)
 * enforcing grant-level `allowedDataPaths`, `stores`, `periodFrom`/`periodTo`, and `purposeKeys`.
 *
 * - Mixed-store / mixed-period CSV/TSV/JSON files are filtered row-by-row so unauthorized
 *   stores and out-of-period rows are physically omitted (never leaked, never zero-filled).
 * - Unfilterable opaque files or mixed files missing verifiable store/period columns FAIL CLOSED
 *   with an explicit restriction code and reason.
 */
export function buildAuthorizedDataView(
  bytes: Buffer,
  relativePath: string,
  grants: readonly ResourceAuthorizationGrant[],
  query: { purposeKey?: string; at?: string } = {},
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

  const hasStoreRestriction = matchedGrants.some(g => Boolean(g.scope.stores?.length));
  const hasPeriodRestriction = matchedGrants.some(g => Boolean(g.scope.periodFrom || g.scope.periodTo));
  if (!hasStoreRestriction && !hasPeriodRestriction) {
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
      reason: '该明细文件非 UTF-8 可解析结构化数据，无法按授权门店/期间生成可验证授权视图，已限制交付原文件。',
    };
  }
  if (bytes.includes(0)) {
    return {
      allowed: false,
      code: 'authorized_view_unavailable_unfilterable_source',
      reason: '该明细文件包含二进制内容，无法按授权门店/期间生成可验证授权视图，已限制交付原文件。',
    };
  }

  const rowAllowedByAnyGrant = (rowStore: string | undefined, rowDate: string | undefined): boolean =>
    matchedGrants.some(g => {
      if (g.scope.stores?.length) {
        if (rowStore !== undefined && !rowStoreMatchesGrant(rowStore, g.scope.stores)) return false;
      }
      if (g.scope.periodFrom || g.scope.periodTo) {
        if (rowDate === undefined || !rowDateWithinGrant(rowDate, g.scope.periodFrom, g.scope.periodTo)) return false;
      }
      return true;
    });

  // 1. CSV / TSV row-level store + period view filtering
  if (ext === '.csv' || ext === '.tsv') {
    const delimiter = ext === '.tsv' ? '\t' : ',';
    const eol = textContent.includes('\r\n') ? '\r\n' : '\n';
    const rawLines = textContent.split(/\r?\n/);
    const nonEmptyLines = rawLines.filter(line => line.trim().length > 0);
    if (nonEmptyLines.length === 0) {
      return { allowed: true, bytes, filtered: false, keptRows: 0, omittedRows: 0, grantedStores };
    }
    const headerCells = parseCsvLine(nonEmptyLines[0]!, delimiter);
    const normalizedHeaders = headerCells.map(h => h.replace(/^\uFEFF/, '').trim().toLowerCase());
    const storeIdx = normalizedHeaders.findIndex(h => STORE_HEADER_NAMES.has(h));
    const dateIdx = normalizedHeaders.findIndex(h => DATE_HEADER_NAMES.has(h));

    if (hasStoreRestriction && storeIdx === -1 && looksLikeMixedFilename(normalizedPath)) {
      return {
        allowed: false,
        code: 'authorized_view_unavailable_missing_store_column',
        reason: `明细文件 ${normalizedPath} 为共享/混合来源且缺少可核验门店列，无法建立授权门店视图，已限制交付。`,
      };
    }
    if (hasPeriodRestriction && dateIdx === -1) {
      return {
        allowed: false,
        code: 'authorized_view_unavailable_missing_period_column',
        reason: `明细文件 ${normalizedPath} 缺少可核验日期/期间列，无法建立授权期间视图，已限制交付。`,
      };
    }

    const keptLines: string[] = [nonEmptyLines[0]!];
    let keptRows = 0;
    let omittedRows = 0;
    for (let i = 1; i < nonEmptyLines.length; i++) {
      const cells = parseCsvLine(nonEmptyLines[i]!, delimiter);
      const rowStore = storeIdx >= 0 ? (cells[storeIdx] ?? '') : undefined;
      const rowDate = dateIdx >= 0 ? (cells[dateIdx] ?? '') : undefined;
      if (rowAllowedByAnyGrant(rowStore, rowDate)) {
        keptLines.push(cells.map(c => formatCsvCell(c, delimiter)).join(delimiter));
        keptRows += 1;
      } else {
        omittedRows += 1;
      }
    }
    const outText = keptLines.join(eol) + (textContent.endsWith('\n') ? eol : '');
    const filtered = omittedRows > 0;
    return {
      allowed: true,
      bytes: Buffer.from(outText, 'utf8'),
      filtered,
      keptRows,
      omittedRows,
      ...(grantedStores.length ? { grantedStores } : {}),
      ...(effectivePeriodFrom ? { periodFrom: effectivePeriodFrom } : {}),
      ...(effectivePeriodTo ? { periodTo: effectivePeriodTo } : {}),
      ...(filtered
        ? {
            restrictionNote: `已按授权范围生成受控视图（保留 ${keptRows} 行，隐藏 ${omittedRows} 行非授权门店或超期间记录；不可读门店绝不视为 0）。`,
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
    if (!Array.isArray(parsed)) {
      return {
        allowed: false,
        code: 'authorized_view_unavailable_unfilterable_source',
        reason: `JSON 明细文件 ${normalizedPath} 非记录数组结构，无法按门店/期间建立行级授权视图，已限制交付。`,
      };
    }
    const records = parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
    const sampleKeys = [...new Set(records.flatMap(r => Object.keys(r)))];
    const storeKey = sampleKeys.find(k => STORE_HEADER_NAMES.has(k.trim().toLowerCase()));
    const dateKey = sampleKeys.find(k => DATE_HEADER_NAMES.has(k.trim().toLowerCase()));
    if (hasStoreRestriction && !storeKey && looksLikeMixedFilename(normalizedPath)) {
      return {
        allowed: false,
        code: 'authorized_view_unavailable_missing_store_column',
        reason: `明细文件 ${normalizedPath} 缺少可核验门店字段，无法建立授权门店视图，已限制交付。`,
      };
    }
    if (hasPeriodRestriction && !dateKey) {
      return {
        allowed: false,
        code: 'authorized_view_unavailable_missing_period_column',
        reason: `明细文件 ${normalizedPath} 缺少可核验日期/期间字段，无法建立授权期间视图，已限制交付。`,
      };
    }
    const kept: Record<string, unknown>[] = [];
    let omittedRows = 0;
    for (const row of records) {
      const rowStore = storeKey ? String(row[storeKey] ?? '') : undefined;
      const rowDate = dateKey ? String(row[dateKey] ?? '') : undefined;
      if (rowAllowedByAnyGrant(rowStore, rowDate)) kept.push(row);
      else omittedRows += 1;
    }
    return {
      allowed: true,
      bytes: Buffer.from(JSON.stringify(kept, null, 2) + '\n', 'utf8'),
      filtered: omittedRows > 0,
      keptRows: kept.length,
      omittedRows,
      ...(grantedStores.length ? { grantedStores } : {}),
      ...(effectivePeriodFrom ? { periodFrom: effectivePeriodFrom } : {}),
      ...(effectivePeriodTo ? { periodTo: effectivePeriodTo } : {}),
      ...(omittedRows > 0
        ? {
            restrictionNote: `已按授权范围生成受控 JSON 视图（保留 ${kept.length} 条，隐藏 ${omittedRows} 条非授权门店或超期间记录；不可读门店绝不视为 0）。`,
          }
        : {}),
    };
  }

  // 3. Opaque / unstructured file when store or period restriction is active -> FAIL CLOSED!
  return {
    allowed: false,
    code: 'authorized_view_unavailable_unfilterable_source',
    reason: `明细文件 ${normalizedPath}（格式 ${ext || '无扩展名'}）无法按授权门店/期间建立可验证授权视图，已限制交付原文件。`,
  };
}
