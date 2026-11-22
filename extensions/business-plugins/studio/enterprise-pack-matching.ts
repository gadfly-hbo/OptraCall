import type {
  EnterprisePackPurpose,
  EnterprisePanoramaRecommendation,
} from './enterprise-pack.ts';

function storeMatchTokens(storeName: string): string[] {
  const trimmed = storeName.trim();
  if (!trimmed) return [];
  const base = trimmed.replace(/(?:直营店|旗舰店|加盟店|门店|直营|店)$/u, '').trim();
  const tokens = [trimmed];
  if (base && base.length >= 2 && base !== trimmed) tokens.push(base);
  return tokens;
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
 * Never silently falls back to `candidates[0]` when multiple scopes coexist under
 * the same `purposeKey`; distinguishes explicit targetPurposeId, scopeKey,
 * windowDays, and store mentions, or returns `ambiguous: true` so UI/API requires
 * explicit user disambiguation.
 */
export function matchPanoramaRecommendationPurposes(
  purposes: readonly EnterprisePackPurpose[],
  rec: EnterprisePanoramaRecommendation,
): {
  matched?: EnterprisePackPurpose;
  candidates: EnterprisePackPurpose[];
  ambiguous: boolean;
} {
  if (rec.targetPurposeId) {
    const exact = purposes.find(p => p.id === rec.targetPurposeId);
    if (exact) return { matched: exact, candidates: [exact], ambiguous: false };
    return { candidates: [], ambiguous: false };
  }

  let candidates = purposes.filter(p => p.purposeKey === rec.purposeKey);
  if (candidates.length === 0) return { candidates: [], ambiguous: false };

  if (rec.scopeKey?.trim()) {
    const wantedScope = rec.scopeKey.trim().toLowerCase();
    const byScope = candidates.filter(p => p.scope.scopeKey.trim().toLowerCase() === wantedScope);
    if (byScope.length === 1) return { matched: byScope[0], candidates: byScope, ambiguous: false };
    if (byScope.length > 1) candidates = byScope;
    else return { candidates: [], ambiguous: false };
  }

  const wantedWindow = extractRecommendationWindowDays(rec);
  if (wantedWindow !== undefined) {
    const withWindow = candidates.filter(p => p.windowDays === wantedWindow);
    const allHaveExplicitDifferentWindow = candidates.every(p => p.windowDays !== undefined && p.windowDays !== wantedWindow);
    if (withWindow.length > 0) {
      candidates = withWindow;
    } else if (allHaveExplicitDifferentWindow) {
      return { candidates: [], ambiguous: false };
    }
  }

  const recText = [rec.title, rec.deliverableNow, rec.priorityReason, rec.completionCriteria, rec.scopeKey ?? ''].join(' ').toLowerCase();
  if (rec.stores?.length) {
    const wantedStores = rec.stores.map(s => s.trim().toLowerCase()).filter(Boolean);
    const byStores = candidates.filter(p => {
      const pStores = (p.scope.stores ?? []).map(s => s.trim().toLowerCase());
      return wantedStores.every(ws => pStores.some(ps => ps === ws || ps.includes(ws) || ws.includes(ps)));
    });
    if (byStores.length === 1) return { matched: byStores[0], candidates: byStores, ambiguous: false };
    if (byStores.length > 1) candidates = byStores;
    else return { candidates: [], ambiguous: false };
  } else {
    const storeMatches = candidates.filter(p =>
      (p.scope.stores ?? []).some(store =>
        storeMatchTokens(store).some(token => recText.includes(token.toLowerCase())),
      ),
    );
    if (storeMatches.length > 0 && storeMatches.length < candidates.length) {
      candidates = storeMatches;
    } else if (storeMatches.length === 1) {
      return { matched: storeMatches[0], candidates: storeMatches, ambiguous: false };
    }
  }

  if (candidates.length === 1) {
    const sole = candidates[0]!;
    if (rec.stores?.length && sole.scope.stores?.length) {
      const soleStores = sole.scope.stores.map(s => s.toLowerCase());
      const allMatch = rec.stores.every(rs => soleStores.some(ss => ss.includes(rs.toLowerCase()) || rs.toLowerCase().includes(ss)));
      if (!allMatch) return { candidates: [], ambiguous: false };
    }
    return { matched: sole, candidates: [sole], ambiguous: false };
  }

  return { candidates, ambiguous: candidates.length > 1 };
}
