import { CaseStoreError } from './case-store.ts';
import type { CaseRelationKind } from './case-relation-types.ts';
import type { CaseRelationsService } from './case-relations-service.ts';

type Request = { pathname: string; method: string; input?: unknown; searchParams?: URLSearchParams };
export function createCaseRelationRoutes(service: CaseRelationsService) {
  return async ({ pathname, method, input = {}, searchParams = new URLSearchParams() }: Request): Promise<{ status?: number; body: unknown } | null> => {
    const page = () => {
      const rawPage = searchParams.get('pageSize');
      if (rawPage !== null && !/^\d+$/.test(rawPage)) throw new CaseStoreError('invalid_case_relation_page');
      return { ...(rawPage === null ? {} : { pageSize: Number(rawPage) }), continuation: searchParams.get('continuation') };
    };
    if (pathname === '/api/case-relations' && method === 'GET') {
      const kind = searchParams.get('kind');
      if (kind !== null && !['follows_up', 'supports'].includes(kind)) throw new CaseStoreError('invalid_case_relation_page');
      return { body: service.list({ ...(searchParams.get('caseId') ? { caseId: searchParams.get('caseId')! } : {}), ...(kind ? { kind: kind as CaseRelationKind } : {}), includeUnlinked: searchParams.get('includeUnlinked') === 'true', ...page() }) };
    }
    const match = /^\/api\/cases\/([a-f0-9-]+)\/relations(?:\/(.*))?$/.exec(pathname);
    if (!match) return null;
    const toCaseId = match[1]!, action = match[2];
    if (action === 'sources' && method === 'GET') return { body: service.sources(toCaseId, page()) };
    const receipt = /^operations\/([a-f0-9-]+)$/.exec(action ?? '');
    if (receipt && method === 'GET') return { body: service.operation(toCaseId, receipt[1]!) };
    if (!action && method === 'POST') return { status: 201, body: { revision: await service.saveUser(toCaseId, input) } };
    const history = /^([a-f0-9-]+)\/history$/.exec(action ?? '');
    if (history && method === 'GET') return { body: service.history(toCaseId, history[1]!, page()) };
    const relation = /^([a-f0-9-]+)$/.exec(action ?? '');
    if (relation && method === 'GET') {
      const rawRevision = searchParams.get('revision');
      if (rawRevision !== null && !/^[1-9]\d*$/.test(rawRevision)) throw new CaseStoreError('invalid_case_relation_revision');
      return { body: await service.read(toCaseId, relation[1]!, rawRevision === null ? undefined : Number(rawRevision)) };
    }
    if (relation && method === 'POST') return { body: { revision: await service.saveUser(toCaseId, input, relation[1]!) } };
    return null;
  };
}
