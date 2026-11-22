import type {
  EnterprisePackPurpose,
  EnterprisePanoramaRecommendation,
} from './enterprise-pack.ts';

function normalizeStoreBase(storeName: string): string {
  return storeName
    .trim()
    .replace(/^(?:仅|只|限|单店|针对|聚焦|对比|衡量|核查|统计|分析|输出|覆盖)/u, '')
    .replace(/(?:两家?|双|多)?(?:直营门店|直营店|旗舰店|加盟店|单店|两店|多店|门店|直营|店)$/u, '')
    .trim()
    .toLowerCase();
}

function storeMatchTokens(storeName: string): string[] {
  const trimmed = storeName.trim().toLowerCase();
  if (!trimmed) return [];
  const base = normalizeStoreBase(storeName);
  const tokens = [trimmed];
  if (base && base.length >= 2 && base !== trimmed) tokens.push(base);
  return tokens;
}

function singleStoreMatches(a: string, b: string): boolean {
  const ta = storeMatchTokens(a);
  const tb = storeMatchTokens(b);
  if (!ta.length || !tb.length) return false;
  const ba = normalizeStoreBase(a);
  const bb = normalizeStoreBase(b);
  if (ba && bb && ba === bb) return true;
  return ta.some(x => tb.some(y => x === y));
}

/**
 * Exact set equality between two store lists (bijective matching).
 * A single-store scope (e.g. ['湖庭直营店']) NEVER matches a two-store superset
 * (e.g. ['湖庭直营店', '杉岸直营店']) or an unscoped/brand-wide purpose ([]).
 */
export function storesMatchExactSet(wanted: readonly string[], actual: readonly string[]): boolean {
  const wNorm = [...new Set(wanted.map(normalizeStoreBase).filter(Boolean))];
  const aNorm = [...new Set(actual.map(normalizeStoreBase).filter(Boolean))];
  if (wNorm.length === 0 || aNorm.length === 0) return false;
  if (wNorm.length !== aNorm.length) return false;
  const used = new Set<number>();
  for (const w of wNorm) {
    const idx = aNorm.findIndex((a, i) => !used.has(i) && singleStoreMatches(w, a));
    if (idx === -1) return false;
    used.add(idx);
  }
  return used.size === aNorm.length;
}

const GENERIC_NON_STORE_BASES = new Set([
  '直营', '加盟', '全部', '全品牌', '全渠道', '品牌', '渠道', '会员', '核心', '首批', '本期',
  '自然月', '跨店', '同店', '同城', '首购', '再购', '复购', '活跃', '门店', '单', '两', '多',
  '本企业', '企业', '区域', '华东', '华南', '华北', '全国', '对比', '衡量', '核查', '聚焦',
  '复盘', '观察', '试算', '分析', '统计', '全店', '各店', '所有', '整体',
]);

/**
 * Extract explicit store mentions from a recommendation's structured `stores` field
 * or natural-language title/deliverable (e.g. "湖庭单店 30 日", "湖庭及杉岸两店",
 * "星桥与柳岸直营店"). Checks `title` first so exclusion/contrast prose in
 * `priorityReason` (e.g. "不可扩大到湖庭与杉岸两店") NEVER pollutes the explicit scope.
 */
export function extractRecommendationStores(
  rec: EnterprisePanoramaRecommendation,
  knownStores: readonly string[] = [],
): string[] {
  if (Array.isArray(rec.stores) && rec.stores.length > 0) {
    return [...new Set(rec.stores.map(s => s.trim()).filter(Boolean))];
  }

  const stripNegations = (input: string): string =>
    input.replace(/(?:不(?:可|得|含|包括|纳入|扩大到?|涉及|涵盖|统计|计入)|未(?:含|纳入|包括)|排除|区别于|而非|除了?)[^，,。；;\n]*/gu, ' ');

  const extractFromSegment = (segment: string): string[] => {
    const cleanedSeg = stripNegations(segment);
    if (!cleanedSeg.trim()) return [];
    const found: string[] = [];
    const seenBase = new Set<string>();
    const addStore = (raw: string) => {
      const cleaned = raw.trim().replace(/^[（(「【\s]+|[）)」】\s]+$/gu, '');
      const base = normalizeStoreBase(cleaned);
      if (!base || base.length < 2 || GENERIC_NON_STORE_BASES.has(base)) return;
      if (/^\d+$/u.test(base)) return;
      if (seenBase.has(base)) return;
      seenBase.add(base);
      found.push(cleaned);
    };

    // 1. Match known store names from existing purposes first (preserves exact canonical store names)
    const lowerSeg = cleanedSeg.toLowerCase();
    for (const ks of knownStores) {
      const tokens = storeMatchTokens(ks);
      if (tokens.some(tok => tok.length >= 2 && lowerSeg.includes(tok))) {
        addStore(ks);
      }
    }

    // 2. Match multi-store phrases like "星桥与柳岸直营店" / "湖庭及杉岸两店"
    const multiRe = /(?:^|[\s，,。、：:（(「【])([\u4e00-\u9fa5]{2,4}?)\s*[与及和、,，/]\s*([\u4e00-\u9fa5]{2,4}?)(?:两家?|双|多)?(?:直营门店|直营店|旗舰店|加盟店|门店|店)/gu;
    for (const m of cleanedSeg.matchAll(multiRe)) {
      if (m[1]) addStore(`${m[1]}门店`);
      if (m[2]) addStore(`${m[2]}门店`);
    }

    // 3. Match single-store phrases like "湖庭单店" / "湖庭直营店"
    const singleRe = /(?:^|[\s，,。、：:（(「【])([\u4e00-\u9fa5]{2,5}?(?:直营门店|直营店|旗舰店|加盟店|单店))/gu;
    for (const m of cleanedSeg.matchAll(singleRe)) {
      const candidate = m[1] ?? '';
      if (!/[与及和、,，/]/u.test(candidate)) {
        addStore(candidate);
      }
    }
    return found;
  };

  // Precedence: title -> deliverableNow -> completionCriteria -> priorityReason
  // Returning as soon as a higher-authority field specifies explicit store(s) prevents
  // contrast/rationale prose in later fields from expanding a narrow store scope.
  for (const field of [rec.title, rec.deliverableNow, rec.completionCriteria, rec.priorityReason]) {
    if (!field) continue;
    const hits = extractFromSegment(field);
    if (hits.length > 0) return hits;
  }
  return [];
}

export function extractRecommendationWindowDays(rec: EnterprisePanoramaRecommendation): number | undefined {
  if (typeof rec.windowDays === 'number' && Number.isFinite(rec.windowDays) && rec.windowDays > 0) {
    return rec.windowDays;
  }
  const textBlob = `${rec.title} ${rec.deliverableNow} ${rec.completionCriteria} ${rec.priorityReason}`;
  const match = /(\d{1,4})\s*[日天]/u.exec(textBlob);
  if (match) {
    const num = Number(match[1]);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return undefined;
}

/**
 * Browser-safe deterministic matcher for panorama recommendation continuation.
 * - Auto-matches ONLY when identity AND scope (scopeKey, windowDays, exact store set) align.
 * - Single-store intent (e.g. "湖庭单店 30 日") NEVER expands into a multi-store superset
 *   (e.g. "湖庭及杉岸两店 30 日") or an unscoped brand-wide superset.
 * - Reports `scopeConflictCandidates` when broader/conflicting scopes exist under the same
 *   `purposeKey`, and `ambiguous: true` when multiple identical-scope candidates remain.
 */
export function matchPanoramaRecommendationPurposes(
  purposes: readonly EnterprisePackPurpose[],
  rec: EnterprisePanoramaRecommendation,
): {
  matched?: EnterprisePackPurpose;
  candidates: EnterprisePackPurpose[];
  ambiguous: boolean;
  scopeConflictCandidates: EnterprisePackPurpose[];
  conflictReason?: string;
} {
  if (rec.targetPurposeId) {
    const exact = purposes.find(p => p.id === rec.targetPurposeId);
    if (!exact) return { candidates: [], ambiguous: false, scopeConflictCandidates: [] };
    const knownStores = purposes
      .filter(p => p.purposeKey === exact.purposeKey || p.purposeKey === rec.purposeKey)
      .flatMap(p => p.scope.stores ?? []);
    const wantedWindow = extractRecommendationWindowDays(rec);
    const explicitStores = extractRecommendationStores(rec, knownStores);
    const reasons: string[] = [];
    if (rec.purposeKey?.trim() && rec.purposeKey.trim() !== exact.purposeKey) {
      reasons.push(`用途键不一致（建议：${rec.purposeKey.trim()}，目标：${exact.purposeKey}）`);
    }
    if (rec.scopeKey?.trim() && rec.scopeKey.trim().toLowerCase() !== exact.scope.scopeKey.trim().toLowerCase()) {
      reasons.push(`范围键不一致（建议：${rec.scopeKey.trim()}，目标：${exact.scope.scopeKey}）`);
    }
    if (wantedWindow !== undefined && exact.windowDays !== wantedWindow) {
      reasons.push(`窗口不一致（建议：${wantedWindow}日，目标：${exact.windowDays ?? '未指定'}日）`);
    }
    if (explicitStores.length > 0 && (!exact.scope.stores?.length || !storesMatchExactSet(explicitStores, exact.scope.stores))) {
      reasons.push(`门店范围不一致（建议：${explicitStores.join('、')}，目标：${exact.scope.stores?.join('、') || '未限门店'}）`);
    }
    if (reasons.length > 0) {
      return {
        candidates: [exact],
        ambiguous: true,
        scopeConflictCandidates: [exact],
        conflictReason: `建议指向已有用途「${exact.title}」(${exact.id})，但与建议明确范围冲突：${reasons.join('；')}。已阻止自动续建，请显式选择按建议新建单用途或改选目标。`,
      };
    }
    return { matched: exact, candidates: [exact], ambiguous: false, scopeConflictCandidates: [] };
  }

  const sameKey = purposes.filter(p => p.purposeKey === rec.purposeKey);
  if (sameKey.length === 0) return { candidates: [], ambiguous: false, scopeConflictCandidates: [] };

  let candidates = [...sameKey];

  // 1. Explicit scopeKey must match strictly if provided
  if (rec.scopeKey?.trim()) {
    const wantedScope = rec.scopeKey.trim().toLowerCase();
    const byScope = candidates.filter(p => p.scope.scopeKey.trim().toLowerCase() === wantedScope);
    if (byScope.length === 1) {
      // Still verify explicit stores / windowDays do not conflict with the scopeKey hit!
      const hit = byScope[0]!;
      const wantedWin = extractRecommendationWindowDays(rec);
      const explicitStores = extractRecommendationStores(rec, sameKey.flatMap(p => p.scope.stores ?? []));
      const winConflict = wantedWin !== undefined && hit.windowDays !== undefined && hit.windowDays !== wantedWin;
      const storeConflict = explicitStores.length > 0 && (!hit.scope.stores?.length || !storesMatchExactSet(explicitStores, hit.scope.stores));
      if (!winConflict && !storeConflict) {
        return { matched: hit, candidates: [hit], ambiguous: false, scopeConflictCandidates: [] };
      }
      return { candidates: [], ambiguous: false, scopeConflictCandidates: [hit] };
    }
    if (byScope.length > 1) {
      candidates = byScope;
    } else {
      return { candidates: [], ambiguous: false, scopeConflictCandidates: sameKey };
    }
  }

  // 2. Explicit windowDays must match strictly (never silently attach a 30d rec to a 90d or windowless purpose)
  const wantedWindow = extractRecommendationWindowDays(rec);
  if (wantedWindow !== undefined) {
    const withWindow = candidates.filter(p => p.windowDays === wantedWindow);
    if (withWindow.length > 0) {
      candidates = withWindow;
    } else {
      return { candidates: [], ambiguous: false, scopeConflictCandidates: candidates };
    }
  }

  // 3. Explicit store scope (from rec.stores OR natural-language text) MUST match exact store set!
  //    Single-store intent (e.g. 湖庭单店) MUST NEVER match a two-store superset (湖庭+杉岸) or brand-wide (stores: []).
  const knownStores = sameKey.flatMap(p => p.scope.stores ?? []);
  const explicitStores = extractRecommendationStores(rec, knownStores);
  if (explicitStores.length > 0) {
    const exactStoreMatches = candidates.filter(p =>
      Array.isArray(p.scope.stores) && p.scope.stores.length > 0 && storesMatchExactSet(explicitStores, p.scope.stores),
    );
    if (exactStoreMatches.length === 1) {
      return { matched: exactStoreMatches[0], candidates: exactStoreMatches, ambiguous: false, scopeConflictCandidates: [] };
    }
    if (exactStoreMatches.length > 1) {
      return { candidates: exactStoreMatches, ambiguous: true, scopeConflictCandidates: [] };
    }
    // Zero exact store matches -> scope conflict / no match (DO NOT expand into a superset!)
    return { candidates: [], ambiguous: false, scopeConflictCandidates: candidates };
  }

  // 4. Recommendation did NOT specify explicit stores:
  //    - If multiple candidates remain -> ambiguous (user must pick explicitly!)
  //    - If exactly 1 candidate remains -> safe single-match continuation
  if (candidates.length === 1) {
    return { matched: candidates[0], candidates, ambiguous: false, scopeConflictCandidates: [] };
  }
  return { candidates, ambiguous: candidates.length > 1, scopeConflictCandidates: [] };
}
